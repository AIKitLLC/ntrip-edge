import { describe, expect, it } from "vitest";
import {
  base64ToBytes,
  buildNmeaGga,
  bytesToBase64,
  bytesToHex,
  computeBaselineEnu,
  computeCrc24q,
  concatRtcmFrames,
  decodeRtcm3Stream,
  ecefToGeodetic,
  encodeRtcm1005,
  encodeRtcm1006,
  encodeRtcm1033,
  encodeRtcm1230,
  encodeRtcm4072Extension,
  encodeRtcmMsm7,
  findNearestStation,
  geodeticToEcef,
  getDefaultSourcetableRecords,
  hexToBytes,
  parseNmeaGga,
  parseSourcetable,
  serializeSourcetable,
  simulateGnssEpoch,
} from "../src/protocol";

describe("CRC-24Q and binary helpers", () => {
  it("computes deterministic 24-bit Qualcomm CRC-24Q and round-trips hex/base64", () => {
    const ascii = new TextEncoder().encode("123456789");
    const crc = computeCrc24q(ascii);
    // Standard CRC-24Q check value for ASCII "123456789" is 0xCDE703
    expect(crc).toBe(0xcde703);

    const hex = bytesToHex(ascii);
    expect(hex).toBe("313233343536373839");
    expect(hexToBytes(hex)).toEqual(ascii);
    expect(hexToBytes("invalid-hex")).toBeNull();

    const b64 = bytesToBase64(ascii);
    expect(base64ToBytes(b64)).toEqual(ascii);
  });
});

describe("WGS-84 Geodetic <-> ECEF & ENU baseline geometry", () => {
  it("round-trips geodetic and ECEF coordinates within 1 mm", () => {
    const hanoi = { latDeg: 21.028511, lonDeg: 105.804817, heightM: 24.8 };
    const ecef = geodeticToEcef(hanoi);
    const recovered = ecefToGeodetic(ecef);

    expect(recovered.latDeg).toBeCloseTo(hanoi.latDeg, 6);
    expect(recovered.lonDeg).toBeCloseTo(hanoi.lonDeg, 6);
    expect(recovered.heightM).toBeCloseTo(hanoi.heightM, 3);
  });

  it("computes local East-North-Up baseline vector accurately", () => {
    const base = { latDeg: 21.028511, lonDeg: 105.804817, heightM: 24.8 };
    const rover = { latDeg: 21.029511, lonDeg: 105.805817, heightM: 26.3 };
    const enu = computeBaselineEnu(base, rover);

    expect(enu.northM).toBeGreaterThan(100);
    expect(enu.eastM).toBeGreaterThan(95);
    expect(enu.upM).toBeCloseTo(1.5, 1);
    expect(enu.horizontalDistanceM).toBeGreaterThan(140);
  });
});

describe("RTCM 3.x frame encoder & decoder", () => {
  it("encodes and decodes RTCM 1005 and 1006 with valid CRC-24Q", () => {
    const coord = { latDeg: 37.774929, lonDeg: -122.419416, heightM: 32.4 };
    const f1005 = encodeRtcm1005({ stationId: 2001, geodetic: coord });
    const f1006 = encodeRtcm1006({ stationId: 2002, geodetic: coord, antennaHeightM: 1.825 });

    const stream = concatRtcmFrames([f1005, f1006]);
    const decoded = decodeRtcm3Stream(stream);

    expect(decoded).toHaveLength(2);
    expect(decoded[0]?.crcValid).toBe(true);
    expect(decoded[0]?.messageNumber).toBe(1005);
    if (decoded[0]?.decoded.kind === "RTCM_1005") {
      expect(decoded[0].decoded.stationId).toBe(2001);
      expect(decoded[0].decoded.geodetic.latDeg).toBeCloseTo(coord.latDeg, 5);
      expect(decoded[0].decoded.geodetic.lonDeg).toBeCloseTo(coord.lonDeg, 5);
    } else {
      expect.unreachable("Expected RTCM_1005 payload");
    }

    expect(decoded[1]?.crcValid).toBe(true);
    if (decoded[1]?.decoded.kind === "RTCM_1006") {
      expect(decoded[1].decoded.stationId).toBe(2002);
      expect(decoded[1].decoded.antennaHeightM).toBeCloseTo(1.825, 3);
    } else {
      expect.unreachable("Expected RTCM_1006 payload");
    }
  });

  it("encodes and decodes RTCM 1033, MSM7 (1077), 1230, and 4072 extension frames", () => {
    const f1033 = encodeRtcm1033({
      stationId: 1001,
      antennaDescriptor: "SEPCHOKE_B3E6",
      receiverTypeDescriptor: "AIKIT EDGE VRS",
    });
    const f1077 = encodeRtcmMsm7({
      messageNumber: 1077,
      stationId: 1001,
      epochTowMs: 123456000,
      satellites: [
        { prn: 2, roughRangeMs: 71.25, cnrDbHz: 48.5 },
        { prn: 12, roughRangeMs: 74.5, cnrDbHz: 45.25 },
      ],
    });
    const f1230 = encodeRtcm1230(1001);
    const f4072 = encodeRtcm4072Extension(7, { vrs: true, mode: "FIXED" });

    const decoded = decodeRtcm3Stream(concatRtcmFrames([f1033, f1077, f1230, f4072]));
    expect(decoded).toHaveLength(4);
    expect(decoded.every((f) => f.crcValid)).toBe(true);

    expect(decoded[0]?.decoded.kind).toBe("RTCM_1033");
    expect(decoded[1]?.decoded.kind).toBe("RTCM_MSM7");
    if (decoded[1]?.decoded.kind === "RTCM_MSM7") {
      expect(decoded[1].decoded.constellation).toBe("GPS");
      expect(decoded[1].decoded.satellites).toHaveLength(2);
      expect(decoded[1].decoded.satellites[0]?.prn).toBe(2);
      expect(decoded[1].decoded.satellites[0]?.cnrDbHz).toBeCloseTo(48.5, 1);
    }
    expect(decoded[2]?.decoded.kind).toBe("RTCM_1230");
    expect(decoded[3]?.decoded.kind).toBe("RTCM_4072_EXT");
  });

  it("flags corrupted CRC-24Q frames", () => {
    const frame = encodeRtcm1230(1001);
    const corrupted = new Uint8Array(frame);
    corrupted[corrupted.length - 1] = (corrupted[corrupted.length - 1] ?? 0) ^ 0xff;

    const decoded = decodeRtcm3Stream(corrupted);
    expect(decoded).toHaveLength(1);
    expect(decoded[0]?.crcValid).toBe(false);
  });
});

describe("NMEA-0183 GGA & Sourcetable", () => {
  it("builds and parses $GNGGA with valid XOR checksum", () => {
    const sentence = buildNmeaGga({
      coord: { latDeg: 21.028511, lonDeg: 105.804817, heightM: 25.4 },
      fixQuality: 4,
      satellitesUsed: 22,
      hdop: 0.58,
      diffStationId: 1001,
    });
    const parsed = parseNmeaGga(sentence);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.record.checksumValid).toBe(true);
      expect(parsed.record.fixQuality).toBe(4);
      expect(parsed.record.latDeg).toBeCloseTo(21.0285, 3);
      expect(parsed.record.lonDeg).toBeCloseTo(105.8048, 3);
    }
  });

  it("serializes and parses NTRIP Sourcetable records and finds nearest station", () => {
    const raw = serializeSourcetable(getDefaultSourcetableRecords("ntrip.ai-kit.net", 443));
    const parsed = parseSourcetable(raw);
    expect(parsed.hasEndSourcetable).toBe(true);
    expect(parsed.streams.length).toBeGreaterThanOrEqual(6);
    expect(parsed.casters).toHaveLength(1);
    expect(parsed.networks).toHaveLength(1);
    expect(parsed.warnings).toHaveLength(0);

    const nearest = findNearestStation({ latDeg: 10.78, lonDeg: 106.7 });
    expect(nearest.station.mountpoint).toBe("SGN0-VN");
    expect(nearest.distanceKm).toBeLessThan(5);
  });

  it("simulates a complete RTK epoch with valid RTCM3 frames", () => {
    const ep = simulateGnssEpoch({ mountpoint: "HAN0-VN", epochIndex: 5, includeExtension4072: true });
    expect(ep.rtk.fixState).toBe("RTK_FIXED");
    expect(ep.frames.length).toBe(8);
    expect(ep.frames.every((f) => f.crcValid)).toBe(true);
  });
});
