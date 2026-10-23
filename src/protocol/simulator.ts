/**
 * Real-time & deterministic GNSS RTK Base Station + Rover Simulator for NTRIP Edge.
 * Generates bit-valid RTCM 3.x binary packets, Sourcetable entries, VRS base coordinates,
 * and Rover RTK ambiguity resolution convergence telemetry.
 */

import { bytesToBase64, bytesToHex } from "./crc24q";
import {
  computeBaselineEnu,
  geodeticToEcef,
  haversineDistanceKm,
  type BaselineVector,
  type EcefCoord,
  type GeodeticCoord,
} from "./coordinates";
import { buildNmeaGga, type NmeaFixQuality } from "./nmea";
import {
  concatRtcmFrames,
  decodeRtcm3Stream,
  encodeRtcm1005,
  encodeRtcm1033,
  encodeRtcm1230,
  encodeRtcm4072Extension,
  encodeRtcmMsm7,
  type MsmSatelliteSignal,
  type Rtcm3Frame,
} from "./rtcm3";
import type { CasRecord, NetRecord, SourcetableRecord, StrRecord } from "./sourcetable";

export interface ReferenceStation {
  readonly mountpoint: string;
  readonly stationId: number;
  readonly identifier: string;
  readonly city: string;
  readonly country: string;
  readonly coord: GeodeticCoord;
  readonly antennaDescriptor: string;
  readonly receiverDescriptor: string;
  readonly isVrs: boolean;
  readonly formatDetails: string;
  readonly bitrate: number;
}

export const REFERENCE_STATIONS: readonly ReferenceStation[] = [
  {
    mountpoint: "HAN0-VN",
    stationId: 1001,
    identifier: "Hanoi CORS Base",
    city: "Hanoi",
    country: "VNM",
    coord: { latDeg: 21.028511, lonDeg: 105.804817, heightM: 24.8 },
    antennaDescriptor: "SEPCHOKE_B3E6   SPKE",
    receiverDescriptor: "SEPT POLARX5",
    isVrs: false,
    formatDetails: "1005(5),1033(10),1077(1),1087(1),1097(1),1127(1),1230(5)",
    bitrate: 11200,
  },
  {
    mountpoint: "SGN0-VN",
    stationId: 1002,
    identifier: "Ho Chi Minh CORS Base",
    city: "Ho Chi Minh City",
    country: "VNM",
    coord: { latDeg: 10.776889, lonDeg: 106.700806, heightM: 19.2 },
    antennaDescriptor: "TRM59800.00     SCIS",
    receiverDescriptor: "TRIMBLE ALLOY",
    isVrs: false,
    formatDetails: "1005(5),1033(10),1077(1),1087(1),1097(1),1127(1),1230(5)",
    bitrate: 11200,
  },
  {
    mountpoint: "SFO0-US",
    stationId: 2001,
    identifier: "San Francisco Bay CORS",
    city: "San Francisco",
    country: "USA",
    coord: { latDeg: 37.774929, lonDeg: -122.419416, heightM: 32.4 },
    antennaDescriptor: "JAVRINGANT_DM   JVDM",
    receiverDescriptor: "UBLOX ZED-F9P",
    isVrs: false,
    formatDetails: "1005(5),1033(10),1077(1),1087(1),1097(1),1127(1),1230(5)",
    bitrate: 10800,
  },
  {
    mountpoint: "FFMJ-DE",
    stationId: 3001,
    identifier: "Frankfurt Main Reference",
    city: "Frankfurt",
    country: "DEU",
    coord: { latDeg: 50.090556, lonDeg: 8.664722, heightM: 158.3 },
    antennaDescriptor: "LEIAR25.R4      LEIT",
    receiverDescriptor: "LEICA GR50",
    isVrs: false,
    formatDetails: "1005(5),1033(10),1077(1),1087(1),1097(1),1127(1),1230(5)",
    bitrate: 11200,
  },
  {
    mountpoint: "TYO0-JP",
    stationId: 4001,
    identifier: "Tokyo Bay GEONET Sim",
    city: "Tokyo",
    country: "JPN",
    coord: { latDeg: 35.676192, lonDeg: 139.650311, heightM: 44.1 },
    antennaDescriptor: "TRM59800.80     NONE",
    receiverDescriptor: "TOPCON NET-G5",
    isVrs: false,
    formatDetails: "1005(5),1033(10),1077(1),1087(1),1097(1),1127(1),1230(5)",
    bitrate: 11600,
  },
  {
    mountpoint: "VRS-AUTO",
    stationId: 9000,
    identifier: "Dynamic Virtual Ref Station (Ntrip-GGA)",
    city: "Global Edge VRS",
    country: "WLD",
    coord: { latDeg: 21.028511, lonDeg: 105.804817, heightM: 25.0 },
    antennaDescriptor: "ADVNULLANTENNA  NONE",
    receiverDescriptor: "AIKIT EDGE VRS 2.0",
    isVrs: true,
    formatDetails: "1005(1),1033(5),1077(1),1087(1),1097(1),1127(1),1230(5),4072(1)",
    bitrate: 12800,
  },
];

export function getStationByMountpoint(mountpoint: string): ReferenceStation | undefined {
  const normalized = mountpoint.trim().toUpperCase();
  return REFERENCE_STATIONS.find((s) => s.mountpoint.toUpperCase() === normalized);
}

/**
 * Find the closest physical reference station to a given latitude/longitude.
 */
export function findNearestStation(coord: { latDeg: number; lonDeg: number }): {
  readonly station: ReferenceStation;
  readonly distanceKm: number;
} {
  const physical = REFERENCE_STATIONS.filter((s) => !s.isVrs);
  const first = physical[0] ?? REFERENCE_STATIONS[0]!;
  let bestStation = first;
  let bestDist = haversineDistanceKm(coord, first.coord);

  for (const station of physical) {
    const dist = haversineDistanceKm(coord, station.coord);
    if (dist < bestDist) {
      bestDist = dist;
      bestStation = station;
    }
  }
  return { station: bestStation, distanceKm: bestDist };
}

/**
 * Build the default NTRIP Sourcetable records (`STR`, `CAS`, `NET`) for this caster.
 */
export function getDefaultSourcetableRecords(host = "ntrip.ai-kit.net", port = 443): readonly SourcetableRecord[] {
  const streams: StrRecord[] = REFERENCE_STATIONS.map((s) => ({
    type: "STR",
    mountpoint: s.mountpoint,
    identifier: s.identifier,
    format: "RTCM 3.3",
    formatDetails: s.formatDetails,
    carrier: 2,
    navSystem: "GPS+GLO+GAL+BDS",
    network: "AIKIT",
    country: s.country,
    latitude: s.coord.latDeg,
    longitude: s.coord.lonDeg,
    nmeaRequired: s.isVrs,
    solution: s.isVrs ? 1 : 0,
    generator: s.receiverDescriptor,
    compression: "none",
    authentication: "N",
    fee: false,
    bitrate: s.bitrate,
    misc: s.isVrs ? "ext=vrs,4072;open-mit" : "open-mit",
  }));

  const caster: CasRecord = {
    type: "CAS",
    host,
    port,
    identifier: "AIKit-Edge-NTRIP-Caster",
    operator: "AI Kit LLC",
    nmeaSupport: true,
    country: "VNM",
    latitude: 21.0285,
    longitude: 105.8048,
    fallbackHost: "0.0.0.0",
    fallbackPort: 0,
    misc: "https://github.com/AIKitLLC/ntrip-edge",
  };

  const network: NetRecord = {
    type: "NET",
    identifier: "AIKIT",
    operator: "AI Kit LLC",
    authentication: "N",
    fee: false,
    webNet: "https://ntrip.ai-kit.net",
    webStr: "https://ntrip.ai-kit.net/api/v1/sourcetable",
    webReg: "https://github.com/AIKitLLC/ntrip-edge",
    misc: "MIT Open Source GNSS Network",
  };

  return [...streams, caster, network];
}

export interface SimulateEpochOptions {
  readonly mountpoint?: string;
  readonly baseCoordOverride?: GeodeticCoord;
  readonly roverCoordOverride?: GeodeticCoord;
  readonly epochIndex?: number;
  readonly timestampMs?: number;
  readonly includeExtension4072?: boolean;
}

export interface RtkTelemetry {
  readonly epochIndex: number;
  readonly gpsTowMs: number;
  readonly fixState: "SINGLE" | "DGPS" | "RTK_FLOAT" | "RTK_FIXED";
  readonly fixQuality: NmeaFixQuality;
  readonly ambiguityRatio: number;
  readonly horizontalAccuracyCm: number;
  readonly verticalAccuracyCm: number;
  readonly trackedSatellites: number;
  readonly hdop: number;
  readonly diffAgeSec: number;
  readonly baseline: BaselineVector;
  readonly roverGga: string;
}

export interface SimulatedEpochResult {
  readonly mountpoint: string;
  readonly stationId: number;
  readonly isVrs: boolean;
  readonly timestampIso: string;
  readonly baseCoord: GeodeticCoord;
  readonly baseEcef: EcefCoord;
  readonly roverCoord: GeodeticCoord;
  readonly rtk: RtkTelemetry;
  readonly packetLengthBytes: number;
  readonly packetHex: string;
  readonly packetBase64: string;
  readonly frames: readonly Rtcm3Frame[];
}

function generateConstellationSatellites(
  prnSeedList: readonly number[],
  epochIndex: number,
  baseCnr: number
): readonly MsmSatelliteSignal[] {
  return prnSeedList.map((prn, idx) => {
    const wave = Math.sin((epochIndex + idx * 3) * 0.25);
    const roughRangeMs = 68.5 + ((prn * 1.73 + idx * 2.1) % 14.0) + wave * 0.02;
    const cnrDbHz = Math.round((baseCnr + Math.cos((epochIndex + prn) * 0.3) * 3.2 - idx * 0.6) * 10) / 10;
    return {
      prn,
      roughRangeMs: Math.round(roughRangeMs * 1000) / 1000,
      cnrDbHz: Math.max(32.0, Math.min(54.0, cnrDbHz)),
    };
  });
}

/**
 * Simulate one complete 1 Hz GNSS RTK epoch:
 * - Synthesizes binary RTCM 3.x frames (1005, 1033, 1077, 1087, 1097, 1127, 1230, and optional 4072)
 * - Computes Rover RTK convergence state, baseline ENU vector, and $GNGGA sentence
 * - Decodes all generated frames to provide a verified round-trip breakdown
 */
export function simulateGnssEpoch(options: SimulateEpochOptions = {}): SimulatedEpochResult {
  const station = getStationByMountpoint(options.mountpoint ?? "HAN0-VN") ?? REFERENCE_STATIONS[0]!;
  const epochIndex = Math.max(0, Math.trunc(options.epochIndex ?? 0));
  const nowMs = options.timestampMs ?? Date.now();
  const nowDate = new Date(nowMs);

  // GPS Time of Week (TOW) in milliseconds (approx modulo 604800000)
  const gpsTowMs = (nowMs - 315964800000 + 18000) % 604800000;

  // If VRS-AUTO and roverCoordOverride is provided, place virtual base ~80 meters southwest of rover
  const defaultRover: GeodeticCoord = options.roverCoordOverride ?? {
    latDeg: Math.round(((options.baseCoordOverride ?? station.coord).latDeg + 0.0024) * 1e7) / 1e7,
    lonDeg: Math.round(((options.baseCoordOverride ?? station.coord).lonDeg + 0.0031) * 1e7) / 1e7,
    heightM: Math.round(((options.baseCoordOverride ?? station.coord).heightM + 1.4) * 100) / 100,
  };

  const baseCoord: GeodeticCoord =
    options.baseCoordOverride ??
    (station.isVrs
      ? {
          latDeg: Math.round((defaultRover.latDeg - 0.0005) * 1e7) / 1e7,
          lonDeg: Math.round((defaultRover.lonDeg - 0.0005) * 1e7) / 1e7,
          heightM: defaultRover.heightM,
        }
      : station.coord);

  const baseEcef = geodeticToEcef(baseCoord);

  // Simulate realistic rover micro-motion (1.2 cm circular jitter around true point as ambiguity converges)
  const baseline = computeBaselineEnu(baseCoord, defaultRover);
  const baselineKm = baseline.distanceKm;

  // Convergence model:
  // Epoch 0: DGPS (45 cm)
  // Epoch 1..2: RTK_FLOAT (8..18 cm, ambiguity ratio 1.8 -> 2.7)
  // Epoch >= 3: RTK_FIXED (1.1..1.6 cm horizontal, ambiguity ratio > 3.0) if baseline <= 50 km
  let fixState: RtkTelemetry["fixState"];
  let fixQuality: NmeaFixQuality;
  let ambiguityRatio: number;
  let horizontalAccuracyCm: number;
  let verticalAccuracyCm: number;

  if (epochIndex === 0) {
    fixState = "DGPS";
    fixQuality = 2;
    ambiguityRatio = 1.15;
    horizontalAccuracyCm = 42.0;
    verticalAccuracyCm = 68.0;
  } else if (epochIndex < 3 || baselineKm > 65) {
    fixState = "RTK_FLOAT";
    fixQuality = 5;
    ambiguityRatio = Math.round((1.65 + epochIndex * 0.55) * 100) / 100;
    horizontalAccuracyCm = Math.round((18.5 / epochIndex + baselineKm * 0.25) * 10) / 10;
    verticalAccuracyCm = Math.round(horizontalAccuracyCm * 1.65 * 10) / 10;
  } else {
    fixState = "RTK_FIXED";
    fixQuality = 4;
    ambiguityRatio = Math.min(99.9, Math.round((3.4 + (epochIndex - 3) * 2.15) * 100) / 100);
    // 8 mm + 1 ppm of baseline
    horizontalAccuracyCm = Math.round((0.8 + baselineKm * 0.1 + Math.abs(Math.sin(epochIndex * 0.5)) * 0.3) * 10) / 10;
    verticalAccuracyCm = Math.round((1.4 + baselineKm * 0.15 + Math.abs(Math.cos(epochIndex * 0.5)) * 0.4) * 10) / 10;
  }

  const gpsSats = generateConstellationSatellites([2, 5, 12, 15, 20, 24, 29, 31], epochIndex, 47.5);
  const gloSats = generateConstellationSatellites([1, 4, 8, 14, 17, 21], epochIndex, 45.8);
  const galSats = generateConstellationSatellites([3, 7, 11, 19, 24, 30], epochIndex, 46.9);
  const bdsSats = generateConstellationSatellites([6, 9, 14, 21, 27, 33], epochIndex, 46.2);
  const totalSatellites = gpsSats.length + gloSats.length + galSats.length + bdsSats.length;

  const rawFrames: Uint8Array[] = [
    encodeRtcm1005({
      stationId: station.stationId,
      ecef: baseEcef,
      gps: true,
      glonass: true,
      galileo: true,
    }),
    encodeRtcm1033({
      stationId: station.stationId,
      antennaDescriptor: station.antennaDescriptor,
      receiverTypeDescriptor: station.receiverDescriptor,
    }),
    encodeRtcmMsm7({
      messageNumber: 1077,
      stationId: station.stationId,
      epochTowMs: gpsTowMs,
      multipleMessageBit: true,
      satellites: gpsSats,
    }),
    encodeRtcmMsm7({
      messageNumber: 1087,
      stationId: station.stationId,
      epochTowMs: gpsTowMs,
      multipleMessageBit: true,
      satellites: gloSats,
    }),
    encodeRtcmMsm7({
      messageNumber: 1097,
      stationId: station.stationId,
      epochTowMs: gpsTowMs,
      multipleMessageBit: true,
      satellites: galSats,
    }),
    encodeRtcmMsm7({
      messageNumber: 1127,
      stationId: station.stationId,
      epochTowMs: gpsTowMs,
      multipleMessageBit: false,
      satellites: bdsSats,
    }),
    encodeRtcm1230(station.stationId),
  ];

  if (options.includeExtension4072 ?? station.isVrs) {
    rawFrames.push(
      encodeRtcm4072Extension(1, {
        mount: station.mountpoint,
        vrs: station.isVrs,
        fix: fixState,
        accCm: horizontalAccuracyCm,
        sats: totalSatellites,
        blKm: baseline.distanceKm,
      })
    );
  }

  const combinedBytes = concatRtcmFrames(rawFrames);
  const decodedFrames = decodeRtcm3Stream(combinedBytes);

  const hdop = 0.58;
  const diffAgeSec = 0.8;
  const roverGga = buildNmeaGga({
    coord: defaultRover,
    utcDate: nowDate,
    fixQuality,
    satellitesUsed: totalSatellites,
    hdop,
    diffAgeSec,
    diffStationId: station.stationId,
  });

  return {
    mountpoint: station.mountpoint,
    stationId: station.stationId,
    isVrs: station.isVrs,
    timestampIso: nowDate.toISOString(),
    baseCoord,
    baseEcef,
    roverCoord: defaultRover,
    rtk: {
      epochIndex,
      gpsTowMs,
      fixState,
      fixQuality,
      ambiguityRatio,
      horizontalAccuracyCm,
      verticalAccuracyCm,
      trackedSatellites: totalSatellites,
      hdop,
      diffAgeSec,
      baseline,
      roverGga,
    },
    packetLengthBytes: combinedBytes.length,
    packetHex: bytesToHex(combinedBytes),
    packetBase64: bytesToBase64(combinedBytes),
    frames: decodedFrames,
  };
}
