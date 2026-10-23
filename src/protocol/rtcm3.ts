/**
 * Bit-level RTCM 10403.x (RTCM 3.x) transport framing, message encoder, and stream decoder.
 * Clean-room open-source implementation under the MIT License.
 */

import { bytesToBase64, bytesToHex, computeCrc24q } from "./crc24q";
import { ecefToGeodetic, geodeticToEcef, type EcefCoord, type GeodeticCoord } from "./coordinates";

export const RTCM3_PREAMBLE = 0xd3;

export type GnssConstellation = "GPS" | "GLONASS" | "GALILEO" | "BEIDOU";

export interface Rtcm1005Payload {
  readonly kind: "RTCM_1005";
  readonly messageNumber: 1005;
  readonly stationId: number;
  readonly itrfYear: number;
  readonly gpsIndicator: boolean;
  readonly glonassIndicator: boolean;
  readonly galileoIndicator: boolean;
  readonly referenceStationIndicator: boolean;
  readonly ecef: EcefCoord;
  readonly geodetic: GeodeticCoord;
}

export interface Rtcm1006Payload {
  readonly kind: "RTCM_1006";
  readonly messageNumber: 1006;
  readonly stationId: number;
  readonly itrfYear: number;
  readonly gpsIndicator: boolean;
  readonly glonassIndicator: boolean;
  readonly galileoIndicator: boolean;
  readonly referenceStationIndicator: boolean;
  readonly ecef: EcefCoord;
  readonly geodetic: GeodeticCoord;
  readonly antennaHeightM: number;
}

export interface Rtcm1033Payload {
  readonly kind: "RTCM_1033";
  readonly messageNumber: 1033;
  readonly stationId: number;
  readonly antennaDescriptor: string;
  readonly antennaSetupId: number;
  readonly antennaSerialNumber: string;
  readonly receiverTypeDescriptor: string;
  readonly receiverFirmwareVersion: string;
  readonly receiverSerialNumber: string;
}

export interface MsmSatelliteSignal {
  readonly prn: number;
  readonly roughRangeMs: number;
  readonly cnrDbHz: number;
}

export interface RtcmMsm7Payload {
  readonly kind: "RTCM_MSM7";
  readonly messageNumber: 1077 | 1087 | 1097 | 1127;
  readonly constellation: GnssConstellation;
  readonly stationId: number;
  readonly epochTowMs: number;
  readonly multipleMessageBit: boolean;
  readonly iods: number;
  readonly satellites: readonly MsmSatelliteSignal[];
  readonly signalIds: readonly number[];
}

export interface Rtcm1230Payload {
  readonly kind: "RTCM_1230";
  readonly messageNumber: 1230;
  readonly stationId: number;
  readonly codePhaseBiasIndicator: boolean;
  readonly fdmaSignalsMask: number;
  readonly l1CaBiasM: number;
  readonly l1PBiasM: number;
  readonly l2CaBiasM: number;
  readonly l2PBiasM: number;
}

export interface Rtcm4072ExtensionPayload {
  readonly kind: "RTCM_4072_EXT";
  readonly messageNumber: 4072;
  readonly subTypeId: number;
  readonly vendorTag: string;
  readonly telemetryJson: string;
}

export interface RtcmGenericPayload {
  readonly kind: "RTCM_GENERIC";
  readonly messageNumber: number;
  readonly stationId: number | null;
  readonly description: string;
}

export type DecodedRtcmPayload =
  | Rtcm1005Payload
  | Rtcm1006Payload
  | Rtcm1033Payload
  | RtcmMsm7Payload
  | Rtcm1230Payload
  | Rtcm4072ExtensionPayload
  | RtcmGenericPayload;

export interface Rtcm3Frame {
  readonly byteOffset: number;
  readonly payloadLengthBytes: number;
  readonly totalLengthBytes: number;
  readonly messageNumber: number;
  readonly messageName: string;
  readonly crcExpected: number;
  readonly crcActual: number;
  readonly crcValid: boolean;
  readonly rawHex: string;
  readonly rawBase64: string;
  readonly decoded: DecodedRtcmPayload;
}

/**
 * Bit-stream writer for packing big-endian unsigned and signed integer bitfields into a byte buffer.
 */
export class BitWriter {
  private readonly bytes: number[] = [];
  private bitPos = 0;

  public get byteLength(): number {
    return this.bytes.length;
  }

  public writeBit(bit: number | boolean): void {
    const byteIndex = this.bitPos >>> 3;
    const bitOffset = 7 - (this.bitPos & 7);
    if (byteIndex >= this.bytes.length) {
      this.bytes.push(0);
    }
    if (bit === 1 || bit === true) {
      this.bytes[byteIndex] = (this.bytes[byteIndex] ?? 0) | (1 << bitOffset);
    }
    this.bitPos++;
  }

  public writeUint(value: number, bitCount: number): void {
    const safeVal = Math.max(0, Math.trunc(value));
    for (let i = bitCount - 1; i >= 0; i--) {
      const bit = Math.floor(safeVal / Math.pow(2, i)) & 1;
      this.writeBit(bit);
    }
  }

  public writeInt(value: number, bitCount: number): void {
    const maxMag = Math.pow(2, bitCount - 1);
    let truncated = Math.round(value);
    if (truncated < -maxMag) truncated = -maxMag;
    if (truncated >= maxMag) truncated = maxMag - 1;
    const unsigned = truncated < 0 ? Math.pow(2, bitCount) + truncated : truncated;
    this.writeUint(unsigned, bitCount);
  }

  public writeAsciiString(text: string, maxLen = 31): void {
    const encoded = new TextEncoder().encode(text.slice(0, maxLen));
    this.writeUint(encoded.length, 8);
    for (let i = 0; i < encoded.length; i++) {
      this.writeUint(encoded[i] ?? 0, 8);
    }
  }

  public toUint8Array(): Uint8Array {
    return new Uint8Array(this.bytes);
  }
}

/**
 * Bit-stream reader for unpacking big-endian unsigned and signed integer bitfields from a byte buffer.
 */
export class BitReader {
  private bitPos = 0;
  private readonly totalBits: number;

  public constructor(private readonly bytes: Uint8Array) {
    this.totalBits = bytes.length * 8;
  }

  public get bitsRemaining(): number {
    return Math.max(0, this.totalBits - this.bitPos);
  }

  public readBit(): number {
    if (this.bitPos >= this.totalBits) {
      return 0;
    }
    const byteIndex = this.bitPos >>> 3;
    const bitOffset = 7 - (this.bitPos & 7);
    this.bitPos++;
    return ((this.bytes[byteIndex] ?? 0) >>> bitOffset) & 1;
  }

  public readUint(bitCount: number): number {
    let value = 0;
    for (let i = 0; i < bitCount; i++) {
      value = value * 2 + this.readBit();
    }
    return value;
  }

  public readInt(bitCount: number): number {
    const unsigned = this.readUint(bitCount);
    const signThreshold = Math.pow(2, bitCount - 1);
    if (unsigned >= signThreshold) {
      return unsigned - Math.pow(2, bitCount);
    }
    return unsigned;
  }

  public readAsciiString(): string {
    const len = this.readUint(8);
    const out = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      out[i] = this.readUint(8);
    }
    return new TextDecoder().decode(out);
  }
}

/**
 * Wrap an RTCM 3.x payload in a transport frame:
 * [0xD3 (8b)][000000 (6b) + Length (10b)][Payload (Length * 8b)][CRC-24Q (24b)]
 */
export function wrapRtcm3Frame(payload: Uint8Array): Uint8Array {
  const len = payload.length & 0x3ff;
  const frame = new Uint8Array(3 + len + 3);
  frame[0] = RTCM3_PREAMBLE;
  frame[1] = (len >>> 8) & 0x03;
  frame[2] = len & 0xff;
  frame.set(payload, 3);

  const crc = computeCrc24q(frame, 0, 3 + len);
  frame[3 + len] = (crc >>> 16) & 0xff;
  frame[3 + len + 1] = (crc >>> 8) & 0xff;
  frame[3 + len + 2] = crc & 0xff;
  return frame;
}

/**
 * Human-readable RTCM 3 message description.
 */
export function describeRtcmMessageNumber(messageNumber: number): string {
  switch (messageNumber) {
    case 1004:
      return "Extended L1&L2 GPS RTK Observables";
    case 1005:
      return "Stationary RTK Reference Station ARP";
    case 1006:
      return "Stationary RTK Ref Station ARP with Antenna Height";
    case 1007:
      return "Antenna Descriptor";
    case 1008:
      return "Antenna Descriptor & Serial Number";
    case 1012:
      return "Extended L1&L2 GLONASS RTK Observables";
    case 1019:
      return "GPS Ephemerides";
    case 1020:
      return "GLONASS Ephemerides";
    case 1033:
      return "Receiver and Antenna Descriptors";
    case 1074:
      return "GPS MSM4 (Full Pseudoranges and PhaseRanges plus CNR)";
    case 1077:
      return "GPS MSM7 (High-Resolution Pseudoranges, PhaseRanges, Doppler & CNR)";
    case 1084:
      return "GLONASS MSM4";
    case 1087:
      return "GLONASS MSM7 (High-Resolution Observables)";
    case 1094:
      return "Galileo MSM4";
    case 1097:
      return "Galileo MSM7 (High-Resolution Observables)";
    case 1124:
      return "BeiDou MSM4";
    case 1127:
      return "BeiDou MSM7 (High-Resolution Observables)";
    case 1230:
      return "GLONASS L1 and L2 Code-Phase Biases";
    case 4072:
      return "Proprietary / Open Extension Frame (AI Kit NTRIP Telemetry)";
    default:
      return `RTCM3 Message ${messageNumber}`;
  }
}

export interface Encode1005Options {
  readonly stationId: number;
  readonly ecef?: EcefCoord;
  readonly geodetic?: GeodeticCoord;
  readonly itrfYear?: number;
  readonly gps?: boolean;
  readonly glonass?: boolean;
  readonly galileo?: boolean;
}

/**
 * Encode RTCM 1005 (Stationary RTK Reference Station ARP) into a full RTCM 3.x binary frame.
 */
export function encodeRtcm1005(options: Encode1005Options): Uint8Array {
  const ecef =
    options.ecef ??
    geodeticToEcef(options.geodetic ?? { latDeg: 21.028511, lonDeg: 105.804817, heightM: 18.5 });

  const writer = new BitWriter();
  writer.writeUint(1005, 12); // DF002: Message Number = 1005
  writer.writeUint(options.stationId & 0xfff, 12); // DF003: Reference Station ID
  writer.writeUint((options.itrfYear ?? 0) & 0x3f, 6); // DF021: ITRF Realization Year
  writer.writeBit(options.gps ?? true); // DF022: GPS Indicator
  writer.writeBit(options.glonass ?? true); // DF023: GLONASS Indicator
  writer.writeBit(options.galileo ?? true); // DF024: Galileo Indicator
  writer.writeBit(false); // DF141: Reference-Station Indicator (0 = Physical, 1 = Virtual/Computed)
  writer.writeInt(Math.round(ecef.xM * 10000), 38); // DF025: ARP ECEF-X (0.0001 m)
  writer.writeBit(true); // DF142: Single Receiver Oscillator Indicator
  writer.writeBit(false); // DF001: Reserved
  writer.writeInt(Math.round(ecef.yM * 10000), 38); // DF026: ARP ECEF-Y (0.0001 m)
  writer.writeUint(0, 2); // DF364: Quarter Cycle Indicator
  writer.writeInt(Math.round(ecef.zM * 10000), 38); // DF027: ARP ECEF-Z (0.0001 m)

  return wrapRtcm3Frame(writer.toUint8Array());
}

export interface Encode1006Options extends Encode1005Options {
  readonly antennaHeightM: number;
}

/**
 * Encode RTCM 1006 (Stationary RTK Reference Station ARP with Antenna Height).
 */
export function encodeRtcm1006(options: Encode1006Options): Uint8Array {
  const ecef =
    options.ecef ??
    geodeticToEcef(options.geodetic ?? { latDeg: 21.028511, lonDeg: 105.804817, heightM: 18.5 });

  const writer = new BitWriter();
  writer.writeUint(1006, 12);
  writer.writeUint(options.stationId & 0xfff, 12);
  writer.writeUint((options.itrfYear ?? 0) & 0x3f, 6);
  writer.writeBit(options.gps ?? true);
  writer.writeBit(options.glonass ?? true);
  writer.writeBit(options.galileo ?? true);
  writer.writeBit(false);
  writer.writeInt(Math.round(ecef.xM * 10000), 38);
  writer.writeBit(true);
  writer.writeBit(false);
  writer.writeInt(Math.round(ecef.yM * 10000), 38);
  writer.writeUint(0, 2);
  writer.writeInt(Math.round(ecef.zM * 10000), 38);
  writer.writeUint(Math.max(0, Math.min(65535, Math.round(options.antennaHeightM * 10000))), 16);

  return wrapRtcm3Frame(writer.toUint8Array());
}

export interface Encode1033Options {
  readonly stationId: number;
  readonly antennaDescriptor: string;
  readonly antennaSetupId?: number;
  readonly antennaSerialNumber?: string;
  readonly receiverTypeDescriptor: string;
  readonly receiverFirmwareVersion?: string;
  readonly receiverSerialNumber?: string;
}

/**
 * Encode RTCM 1033 (Receiver and Antenna Descriptors).
 */
export function encodeRtcm1033(options: Encode1033Options): Uint8Array {
  const writer = new BitWriter();
  writer.writeUint(1033, 12);
  writer.writeUint(options.stationId & 0xfff, 12);
  writer.writeAsciiString(options.antennaDescriptor);
  writer.writeUint((options.antennaSetupId ?? 1) & 0xff, 8);
  writer.writeAsciiString(options.antennaSerialNumber ?? "SN-001");
  writer.writeAsciiString(options.receiverTypeDescriptor);
  writer.writeAsciiString(options.receiverFirmwareVersion ?? "1.0.0-EDGE");
  writer.writeAsciiString(options.receiverSerialNumber ?? "AIKIT-001");
  return wrapRtcm3Frame(writer.toUint8Array());
}

export interface EncodeMsm7Options {
  readonly messageNumber: 1077 | 1087 | 1097 | 1127;
  readonly stationId: number;
  readonly epochTowMs: number;
  readonly multipleMessageBit?: boolean;
  readonly satellites: readonly MsmSatelliteSignal[];
}

/**
 * Encode RTCM MSM7 (1077 GPS, 1087 GLONASS, 1097 Galileo, 1127 BeiDou) frame with header,
 * 64-bit satellite mask, 32-bit signal mask, cell mask, rough ranges, and CNR telemetry.
 */
export function encodeRtcmMsm7(options: EncodeMsm7Options): Uint8Array {
  const writer = new BitWriter();
  writer.writeUint(options.messageNumber, 12); // Message Number
  writer.writeUint(options.stationId & 0xfff, 12); // Reference Station ID
  writer.writeUint(options.epochTowMs % 604800000, 30); // GNSS Epoch Time (TOW in ms)
  writer.writeBit(options.multipleMessageBit ?? false); // Multiple Message Bit
  writer.writeUint(0, 3); // Issue of Data Station (IODS)
  writer.writeUint(0, 7); // Reserved
  writer.writeUint(0, 2); // Clock Steering Indicator
  writer.writeUint(0, 2); // External Clock Indicator
  writer.writeBit(false); // Divergence-free Smoothing Indicator
  writer.writeUint(0, 3); // Smoothing Interval

  // 64-bit satellite mask (PRN 1..64)
  const sortedSats = [...options.satellites]
    .filter((s) => s.prn >= 1 && s.prn <= 64)
    .sort((a, b) => a.prn - b.prn);
  const prnSet = new Set(sortedSats.map((s) => s.prn));
  for (let prn = 1; prn <= 64; prn++) {
    writer.writeBit(prnSet.has(prn));
  }

  // 32-bit signal mask: enable L1C/A (signal 2) + L5/L2C (signal 16) for realistic dual-band RTK
  const activeSignals = [2];
  for (let sig = 1; sig <= 32; sig++) {
    writer.writeBit(activeSignals.includes(sig));
  }

  // Cell mask: Nsat * Nsig bits (all 1s for active satellite-signal pairs)
  const cellCount = sortedSats.length * activeSignals.length;
  for (let i = 0; i < cellCount; i++) {
    writer.writeBit(true);
  }

  // Satellite Data:
  // 1) Rough ranges integer milliseconds (DF397: 8 bits per sat)
  for (const sat of sortedSats) {
    const intMs = Math.max(1, Math.min(254, Math.floor(sat.roughRangeMs)));
    writer.writeUint(intMs, 8);
  }
  // 2) Extended satellite info (4 bits per sat)
  for (let i = 0; i < sortedSats.length; i++) {
    writer.writeUint(0, 4);
  }
  // 3) Rough ranges modulo 1 ms (DF398: 10 bits per sat, 1/1024 ms resolution)
  for (const sat of sortedSats) {
    const frac = sat.roughRangeMs - Math.floor(sat.roughRangeMs);
    writer.writeUint(Math.round(frac * 1024) & 0x3ff, 10);
  }
  // 4) Rough PhaseRangeRates (DF399: 14 bits signed per sat)
  for (let i = 0; i < sortedSats.length; i++) {
    writer.writeInt(0, 14);
  }

  // Signal Data (for Ncell = sortedSats.length):
  // Fine Pseudoranges (20b signed), Fine PhaseRanges (24b signed), Lock Time (10b), Half-cycle (1b), CNR (10b, 0.0625 dB-Hz), Fine PhaseRangeRate (15b)
  for (let i = 0; i < sortedSats.length; i++) {
    writer.writeInt(12, 20);
  }
  for (let i = 0; i < sortedSats.length; i++) {
    writer.writeInt(24, 24);
  }
  for (let i = 0; i < sortedSats.length; i++) {
    writer.writeUint(511, 10);
  }
  for (let i = 0; i < sortedSats.length; i++) {
    writer.writeBit(false);
  }
  for (const sat of sortedSats) {
    const cnrScaled = Math.max(1, Math.min(1023, Math.round(sat.cnrDbHz * 16)));
    writer.writeUint(cnrScaled, 10);
  }
  for (let i = 0; i < sortedSats.length; i++) {
    writer.writeInt(0, 15);
  }

  return wrapRtcm3Frame(writer.toUint8Array());
}

/**
 * Encode RTCM 1230 (GLONASS L1 and L2 Code-Phase Biases).
 */
export function encodeRtcm1230(stationId: number): Uint8Array {
  const writer = new BitWriter();
  writer.writeUint(1230, 12);
  writer.writeUint(stationId & 0xfff, 12);
  writer.writeBit(true); // GLONASS Code-Phase bias indicator (1 = aligned)
  writer.writeUint(0, 3); // Reserved
  writer.writeUint(0x0f, 4); // FDMA signals mask (L1 C/A, L1 P, L2 C/A, L2 P)
  writer.writeInt(0, 16); // L1 C/A bias (0.02 m)
  writer.writeInt(0, 16); // L1 P bias (0.02 m)
  writer.writeInt(0, 16); // L2 C/A bias (0.02 m)
  writer.writeInt(0, 16); // L2 P bias (0.02 m)
  return wrapRtcm3Frame(writer.toUint8Array());
}

/**
 * Encode RTCM 4072 Proprietary / Open Extension Frame for custom NTRIP v2.0 edge telemetry.
 */
export function encodeRtcm4072Extension(subTypeId: number, telemetry: Record<string, unknown>): Uint8Array {
  const writer = new BitWriter();
  writer.writeUint(4072, 12);
  writer.writeUint(subTypeId & 0xfff, 12);
  writer.writeAsciiString("AIKIT", 16);
  const jsonText = JSON.stringify(telemetry);
  writer.writeAsciiString(jsonText, 220);
  return wrapRtcm3Frame(writer.toUint8Array());
}

function msmConstellation(msgNum: 1077 | 1087 | 1097 | 1127): GnssConstellation {
  switch (msgNum) {
    case 1077:
      return "GPS";
    case 1087:
      return "GLONASS";
    case 1097:
      return "GALILEO";
    case 1127:
      return "BEIDOU";
  }
}

/**
 * Decode a single RTCM 3.x payload (excluding the 3-byte header and 3-byte CRC-24Q).
 */
export function decodeRtcmPayload(payload: Uint8Array): DecodedRtcmPayload {
  const reader = new BitReader(payload);
  if (reader.bitsRemaining < 12) {
    return {
      kind: "RTCM_GENERIC",
      messageNumber: 0,
      stationId: null,
      description: "Truncated RTCM3 payload (< 12 bits)",
    };
  }

  const messageNumber = reader.readUint(12);

  if ((messageNumber === 1005 || messageNumber === 1006) && reader.bitsRemaining >= 140) {
    const stationId = reader.readUint(12);
    const itrfYear = reader.readUint(6);
    const gpsIndicator = reader.readBit() === 1;
    const glonassIndicator = reader.readBit() === 1;
    const galileoIndicator = reader.readBit() === 1;
    const referenceStationIndicator = reader.readBit() === 1;
    const xMm01 = reader.readInt(38);
    reader.readUint(2); // Oscillator + reserved
    const yMm01 = reader.readInt(38);
    reader.readUint(2); // Quarter cycle indicator
    const zMm01 = reader.readInt(38);

    const ecef: EcefCoord = {
      xM: Math.round(xMm01) / 10000,
      yM: Math.round(yMm01) / 10000,
      zM: Math.round(zMm01) / 10000,
    };
    const geodetic = ecefToGeodetic(ecef);

    if (messageNumber === 1006 && reader.bitsRemaining >= 16) {
      const antHeightRaw = reader.readUint(16);
      return {
        kind: "RTCM_1006",
        messageNumber: 1006,
        stationId,
        itrfYear,
        gpsIndicator,
        glonassIndicator,
        galileoIndicator,
        referenceStationIndicator,
        ecef,
        geodetic,
        antennaHeightM: Math.round(antHeightRaw) / 10000,
      };
    }

    return {
      kind: "RTCM_1005",
      messageNumber: 1005,
      stationId,
      itrfYear,
      gpsIndicator,
      glonassIndicator,
      galileoIndicator,
      referenceStationIndicator,
      ecef,
      geodetic,
    };
  }

  if (messageNumber === 1033 && reader.bitsRemaining >= 20) {
    const stationId = reader.readUint(12);
    const antennaDescriptor = reader.readAsciiString();
    const antennaSetupId = reader.readUint(8);
    const antennaSerialNumber = reader.readAsciiString();
    const receiverTypeDescriptor = reader.readAsciiString();
    const receiverFirmwareVersion = reader.readAsciiString();
    const receiverSerialNumber = reader.readAsciiString();
    return {
      kind: "RTCM_1033",
      messageNumber: 1033,
      stationId,
      antennaDescriptor,
      antennaSetupId,
      antennaSerialNumber,
      receiverTypeDescriptor,
      receiverFirmwareVersion,
      receiverSerialNumber,
    };
  }

  if (
    (messageNumber === 1077 || messageNumber === 1087 || messageNumber === 1097 || messageNumber === 1127) &&
    reader.bitsRemaining >= 157
  ) {
    const stationId = reader.readUint(12);
    const epochTowMs = reader.readUint(30);
    const multipleMessageBit = reader.readBit() === 1;
    const iods = reader.readUint(3);
    reader.readUint(7 + 2 + 2 + 1 + 3); // Reserved + clock + smoothing

    const prns: number[] = [];
    for (let prn = 1; prn <= 64; prn++) {
      if (reader.readBit() === 1) {
        prns.push(prn);
      }
    }

    const signalIds: number[] = [];
    for (let sig = 1; sig <= 32; sig++) {
      if (reader.readBit() === 1) {
        signalIds.push(sig);
      }
    }

    const cellMaskBits = prns.length * signalIds.length;
    let activeCells = 0;
    for (let i = 0; i < cellMaskBits; i++) {
      if (reader.readBit() === 1) {
        activeCells++;
      }
    }

    const intMsList: number[] = [];
    for (let i = 0; i < prns.length; i++) {
      intMsList.push(reader.readUint(8));
    }
    for (let i = 0; i < prns.length; i++) {
      reader.readUint(4); // Extended sat info
    }
    const fracMsList: number[] = [];
    for (let i = 0; i < prns.length; i++) {
      fracMsList.push(reader.readUint(10) / 1024);
    }
    for (let i = 0; i < prns.length; i++) {
      reader.readInt(14); // Rough phase range rate
    }

    // Skip fine pseudorange (20b), fine phaserange (24b), lock time (10b), half-cycle (1b) per active cell
    const bitsBeforeCnr = activeCells * (20 + 24 + 10 + 1);
    for (let b = 0; b < bitsBeforeCnr && reader.bitsRemaining > 0; b++) {
      reader.readBit();
    }

    const cnrList: number[] = [];
    for (let i = 0; i < activeCells; i++) {
      cnrList.push(Math.round((reader.readUint(10) / 16) * 10) / 10);
    }

    const satellites: MsmSatelliteSignal[] = prns.map((prn, idx) => ({
      prn,
      roughRangeMs: Math.round(((intMsList[idx] ?? 70) + (fracMsList[idx] ?? 0)) * 1000) / 1000,
      cnrDbHz: cnrList[idx] ?? 45.0,
    }));

    return {
      kind: "RTCM_MSM7",
      messageNumber,
      constellation: msmConstellation(messageNumber),
      stationId,
      epochTowMs,
      multipleMessageBit,
      iods,
      satellites,
      signalIds,
    };
  }

  if (messageNumber === 1230 && reader.bitsRemaining >= 20) {
    const stationId = reader.readUint(12);
    const codePhaseBiasIndicator = reader.readBit() === 1;
    reader.readUint(3);
    const fdmaSignalsMask = reader.readUint(4);
    const l1CaBiasM = (reader.bitsRemaining >= 16 ? reader.readInt(16) : 0) * 0.02;
    const l1PBiasM = (reader.bitsRemaining >= 16 ? reader.readInt(16) : 0) * 0.02;
    const l2CaBiasM = (reader.bitsRemaining >= 16 ? reader.readInt(16) : 0) * 0.02;
    const l2PBiasM = (reader.bitsRemaining >= 16 ? reader.readInt(16) : 0) * 0.02;
    return {
      kind: "RTCM_1230",
      messageNumber: 1230,
      stationId,
      codePhaseBiasIndicator,
      fdmaSignalsMask,
      l1CaBiasM: Math.round(l1CaBiasM * 100) / 100,
      l1PBiasM: Math.round(l1PBiasM * 100) / 100,
      l2CaBiasM: Math.round(l2CaBiasM * 100) / 100,
      l2PBiasM: Math.round(l2PBiasM * 100) / 100,
    };
  }

  if (messageNumber === 4072 && reader.bitsRemaining >= 20) {
    const subTypeId = reader.readUint(12);
    const vendorTag = reader.readAsciiString();
    const telemetryJson = reader.readAsciiString();
    return {
      kind: "RTCM_4072_EXT",
      messageNumber: 4072,
      subTypeId,
      vendorTag,
      telemetryJson,
    };
  }

  const stationId = reader.bitsRemaining >= 12 ? reader.readUint(12) : null;
  return {
    kind: "RTCM_GENERIC",
    messageNumber,
    stationId,
    description: describeRtcmMessageNumber(messageNumber),
  };
}

/**
 * Scan and decode all RTCM 3.x frames present in a binary stream.
 */
export function decodeRtcm3Stream(bytes: Uint8Array): readonly Rtcm3Frame[] {
  const frames: Rtcm3Frame[] = [];
  let offset = 0;

  while (offset + 6 <= bytes.length) {
    if (bytes[offset] !== RTCM3_PREAMBLE) {
      offset++;
      continue;
    }

    const reserved = ((bytes[offset + 1] ?? 0) >>> 2) & 0x3f;
    if (reserved !== 0) {
      offset++;
      continue;
    }

    const payloadLength = (((bytes[offset + 1] ?? 0) & 0x03) << 8) | (bytes[offset + 2] ?? 0);
    const totalLength = 3 + payloadLength + 3;
    if (offset + totalLength > bytes.length) {
      break;
    }

    const frameBytes = bytes.subarray(offset, offset + totalLength);
    const payloadBytes = bytes.subarray(offset + 3, offset + 3 + payloadLength);
    const crcExpected = computeCrc24q(frameBytes, 0, 3 + payloadLength);
    const crcActual =
      ((frameBytes[3 + payloadLength] ?? 0) << 16) |
      ((frameBytes[3 + payloadLength + 1] ?? 0) << 8) |
      (frameBytes[3 + payloadLength + 2] ?? 0);

    const crcValid = crcExpected === crcActual;
    const decoded = decodeRtcmPayload(payloadBytes);

    frames.push({
      byteOffset: offset,
      payloadLengthBytes: payloadLength,
      totalLengthBytes: totalLength,
      messageNumber: decoded.messageNumber,
      messageName: describeRtcmMessageNumber(decoded.messageNumber),
      crcExpected,
      crcActual,
      crcValid,
      rawHex: bytesToHex(frameBytes),
      rawBase64: bytesToBase64(frameBytes),
      decoded,
    });

    offset += totalLength;
  }

  return frames;
}

/**
 * Concatenate multiple binary RTCM 3.x frames into a single Uint8Array packet.
 */
export function concatRtcmFrames(frames: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const f of frames) {
    total += f.length;
  }
  const combined = new Uint8Array(total);
  let pos = 0;
  for (const f of frames) {
    combined.set(f, pos);
    pos += f.length;
  }
  return combined;
}
