/**
 * NTRIP v1.0/v2.0 (RTCM 10410.1) & RTCM 3.x (RTCM 10403.3) Specification Validator
 * and Custom Mountpoint Configuration Registry.
 */

import { bytesToBase64, bytesToHex, hexToBytes } from "./crc24q";
import { ecefToGeodetic, geodeticToEcef, haversineDistanceKm, type EcefCoord, type GeodeticCoord } from "./coordinates";
import {
  concatRtcmFrames,
  decodeRtcm3Stream,
  encodeRtcm1005,
  encodeRtcm1033,
  encodeRtcm1230,
  encodeRtcmMsm7,
  type Rtcm3Frame,
} from "./rtcm3";
import { formatSourcetableRecord, parseSourcetable, type StrRecord } from "./sourcetable";
import { registerStationInCatalog, type ReferenceStation } from "./simulator";

export interface SpecCheckItem {
  readonly id:
    | "MOUNTPOINT_SYNTAX"
    | "STATION_ID_12BIT"
    | "COUNTRY_ISO3"
    | "WGS84_COORDINATES"
    | "RTCM_SCHEDULE_SPECS"
    | "STR_19_FIELD_SERIALIZATION"
    | "RTCM3_CRC24Q_INTEGRITY"
    | "ARP_ECEF_WGS84_CONSISTENCY"
    | "UPSTREAM_NTRIP_HANDSHAKE";
  readonly specRef: string;
  readonly status: "PASS" | "WARN" | "FAIL";
  readonly detail: string;
}

export interface CustomNtripConfigInput {
  readonly mountpoint: string;
  readonly stationId: number;
  readonly identifier: string;
  readonly city: string;
  readonly country: string;
  readonly latDeg: number;
  readonly lonDeg: number;
  readonly heightM: number;
  readonly format?: string;
  readonly formatDetails?: string;
  readonly carrier?: 0 | 1 | 2;
  readonly navSystem?: string;
  readonly network?: string;
  readonly antennaDescriptor?: string;
  readonly receiverDescriptor?: string;
  readonly isVrs?: boolean;
  readonly bitrate?: number;
  readonly upstreamUrl?: string;
  readonly sampleRtcmHex?: string;
}

export interface UpstreamProbeResult {
  readonly url: string;
  readonly reachable: boolean;
  readonly httpStatus: number | null;
  readonly contentType: string | null;
  readonly ntripVersionHeader: string | null;
  readonly latencyMs: number;
  readonly summary: string;
}

export interface NtripSpecValidationReport {
  readonly compliant: boolean;
  readonly specStandard: "RTCM 10410.1 (NTRIP v2.0) + RTCM 10403.3 (RTCM 3.x)";
  readonly checks: readonly SpecCheckItem[];
  readonly passCount: number;
  readonly warnCount: number;
  readonly failCount: number;
  readonly normalizedStation: ReferenceStation;
  readonly strRecord: StrRecord;
  readonly strRecordLine: string;
  readonly ecef: EcefCoord;
  readonly sampleRtcmHex: string;
  readonly sampleRtcmBase64: string;
  readonly decodedFrames: readonly Rtcm3Frame[];
  readonly upstreamProbe: UpstreamProbeResult | null;
}

export interface RegisteredNtripConfig {
  readonly configId: string;
  readonly ownerPrincipal: string;
  readonly createdAtIso: string;
  readonly station: ReferenceStation;
  readonly strRecord: StrRecord;
  readonly strRecordLine: string;
  readonly validationReport: NtripSpecValidationReport;
}

// Isolate-level registry of custom configs created during runtime
const CUSTOM_CONFIGS = new Map<string, RegisteredNtripConfig>();

export function listCustomConfigs(): readonly RegisteredNtripConfig[] {
  return Array.from(CUSTOM_CONFIGS.values());
}

export function registerValidatedConfig(
  ownerPrincipal: string,
  report: NtripSpecValidationReport
): RegisteredNtripConfig {
  const record: RegisteredNtripConfig = {
    configId: `ntrip-cfg-${report.normalizedStation.mountpoint.toLowerCase()}-${Date.now().toString(36)}`,
    ownerPrincipal,
    createdAtIso: new Date().toISOString(),
    station: report.normalizedStation,
    strRecord: report.strRecord,
    strRecordLine: report.strRecordLine,
    validationReport: report,
  };
  CUSTOM_CONFIGS.set(report.normalizedStation.mountpoint.toUpperCase(), record);
  registerStationInCatalog(report.normalizedStation);
  return record;
}

function parseScheduleMessageNumbers(formatDetails: string): readonly number[] {
  const matches = formatDetails.match(/\b(\d{4})\s*(?:\(\d+\))?/g) ?? [];
  const nums: number[] = [];
  for (const m of matches) {
    const id = Number.parseInt(m.slice(0, 4), 10);
    if (Number.isFinite(id)) nums.push(id);
  }
  return nums;
}

/**
 * Probe an upstream NTRIP v2.0 server URL (Sourcetable or Mountpoint) with bounded timeout.
 */
export async function probeUpstreamNtripServer(
  upstreamUrl: string,
  timeoutMs = 3500
): Promise<UpstreamProbeResult> {
  const start = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(upstreamUrl, {
      method: "GET",
      headers: {
        "Ntrip-Version": "Ntrip/2.0",
        "User-Agent": "NTRIP AIKit-Edge-Validator/1.0",
        Accept: "gnss/sourcetable, gnss/data, text/plain, application/json",
      },
      signal: controller.signal,
    });
    const latencyMs = Math.round((performance.now() - start) * 100) / 100;
    const contentType = res.headers.get("Content-Type");
    const ntripVersionHeader = res.headers.get("Ntrip-Version");

    // Read up to 4 KB to inspect either sourcetable or RTCM3 binary frames
    const reader = res.body?.getReader();
    let firstChunk = new Uint8Array(0);
    if (reader) {
      const readRes = await reader.read();
      if (readRes.value) {
        firstChunk = readRes.value.subarray(0, 4096);
      }
      await reader.cancel().catch(() => undefined);
    }

    let summary = `HTTP ${res.status} (${contentType ?? "no content-type"}) in ${latencyMs} ms`;
    const textPreview = new TextDecoder().decode(firstChunk);
    if (textPreview.includes("STR;") || textPreview.includes("ENDSOURCETABLE")) {
      const parsed = parseSourcetable(textPreview);
      summary = `Valid NTRIP Sourcetable (${parsed.streams.length} STR mountpoints detected)`;
    } else if (firstChunk.length >= 6) {
      const frames = decodeRtcm3Stream(firstChunk);
      const validFrames = frames.filter((f) => f.crcValid);
      if (validFrames.length > 0) {
        summary = `Valid binary RTCM 3.x stream (${validFrames.length} CRC-24Q verified frames: ${validFrames
          .map((f) => f.messageNumber)
          .join(", ")})`;
      }
    }

    return {
      url: upstreamUrl,
      reachable: res.status >= 200 && res.status < 300,
      httpStatus: res.status,
      contentType,
      ntripVersionHeader,
      latencyMs,
      summary,
    };
  } catch (err) {
    const latencyMs = Math.round((performance.now() - start) * 100) / 100;
    return {
      url: upstreamUrl,
      reachable: false,
      httpStatus: null,
      contentType: null,
      ntripVersionHeader: null,
      latencyMs,
      summary: `Upstream connection failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Validate a candidate NTRIP server & mountpoint configuration against RTCM 10410.1 (NTRIP v2.0)
 * and RTCM 10403.3 (RTCM 3.x) technical specifications.
 */
export async function validateNtripConfigAgainstSpecs(
  input: CustomNtripConfigInput
): Promise<NtripSpecValidationReport> {
  const checks: SpecCheckItem[] = [];

  // 1. Mountpoint syntax check (RTCM 10410.1 §4.2: 1..32 ASCII chars, no spaces/semicolons/slashes)
  const mountpoint = input.mountpoint.trim().toUpperCase();
  const mountValid = /^[A-Z0-9._-]{1,32}$/.test(mountpoint);
  checks.push({
    id: "MOUNTPOINT_SYNTAX",
    specRef: "RTCM 10410.1 §4.2 (Mountpoint Identifier)",
    status: mountValid ? "PASS" : "FAIL",
    detail: mountValid
      ? `Mountpoint '${mountpoint}' is valid ASCII token (${mountpoint.length} chars, no reserved delimiters).`
      : `Mountpoint '${input.mountpoint}' violates NTRIP mountpoint syntax (must match ^[A-Za-z0-9._-]{1,32}$).`,
  });

  // 2. Station ID 12-bit unsigned integer check (RTCM 10403.3 DF003: 0..4095)
  const stationId = Math.trunc(input.stationId);
  const stationIdValid = Number.isInteger(stationId) && stationId >= 0 && stationId <= 4095;
  checks.push({
    id: "STATION_ID_12BIT",
    specRef: "RTCM 10403.3 DF003 (12-bit Reference Station ID)",
    status: stationIdValid ? "PASS" : "FAIL",
    detail: stationIdValid
      ? `Reference Station ID ${stationId} fits within 12-bit unsigned range [0..4095].`
      : `Reference Station ID ${input.stationId} is outside 12-bit RTCM DF003 range [0..4095].`,
  });

  // 3. Country code ISO 3166-1 alpha-3 check (RTCM 10410.1 Sourcetable field 9)
  const country = input.country.trim().toUpperCase();
  const countryValid = /^[A-Z]{3}$/.test(country);
  checks.push({
    id: "COUNTRY_ISO3",
    specRef: "RTCM 10410.1 §4.2 Field 9 (ISO 3166-1 alpha-3 Country Code)",
    status: countryValid ? "PASS" : "FAIL",
    detail: countryValid
      ? `Country code '${country}' is a 3-letter ISO alpha-3 identifier.`
      : `Country code '${input.country}' must be a 3-letter uppercase ISO 3166-1 alpha-3 code (e.g. VNM, USA, DEU).`,
  });

  // 4. WGS-84 Coordinates & Ellipsoidal Height check
  const { latDeg, lonDeg, heightM } = input;
  const coordsValid =
    Number.isFinite(latDeg) &&
    Number.isFinite(lonDeg) &&
    Number.isFinite(heightM) &&
    latDeg >= -90 &&
    latDeg <= 90 &&
    lonDeg >= -180 &&
    lonDeg <= 180 &&
    heightM >= -1000 &&
    heightM <= 15000 &&
    !(latDeg === 0 && lonDeg === 0);
  checks.push({
    id: "WGS84_COORDINATES",
    specRef: "WGS-84 / ITRF2020 Reference Frame Bounds",
    status: coordsValid ? "PASS" : "FAIL",
    detail: coordsValid
      ? `Geodetic ARP (${latDeg.toFixed(6)}°, ${lonDeg.toFixed(6)}°, ${heightM.toFixed(2)} m) is within valid terrestrial WGS-84 bounds.`
      : `Geodetic coordinates (${latDeg}, ${lonDeg}, ${heightM}) are out of bounds or at Null Island (0, 0).`,
  });

  // 5. RTCM 3.x Message Schedule check (must contain ARP 1005/1006 + observables)
  const formatDetails = (input.formatDetails ?? "1005(5),1033(10),1077(1),1087(1),1097(1),1127(1),1230(5)").trim();
  const msgNums = parseScheduleMessageNumbers(formatDetails);
  const hasArp = msgNums.includes(1005) || msgNums.includes(1006);
  const hasObs = msgNums.some((m) => (m >= 1071 && m <= 1127) || m === 1004 || m === 1012);
  const scheduleValid = hasArp && hasObs;
  checks.push({
    id: "RTCM_SCHEDULE_SPECS",
    specRef: "RTCM 10403.3 §3.5 (Minimum RTK Base Message Set)",
    status: scheduleValid ? "PASS" : "FAIL",
    detail: scheduleValid
      ? `Schedule '${formatDetails}' includes Base Station ARP (${msgNums.includes(1005) ? "1005" : "1006"}) and GNSS observables (${msgNums.join(", ")}).`
      : `Schedule '${formatDetails}' is missing either Base ARP (1005/1006) or GNSS observables (1074..1127 / 1004 / 1012).`,
  });

  // 6. Build normalized ReferenceStation & STR record and verify 19-field round-trip parsing
  const coord: GeodeticCoord = {
    latDeg: Number.isFinite(latDeg) ? latDeg : 21.028511,
    lonDeg: Number.isFinite(lonDeg) ? lonDeg : 105.804817,
    heightM: Number.isFinite(heightM) ? heightM : 24.8,
  };
  const normalizedStation: ReferenceStation = {
    mountpoint: mountValid ? mountpoint : "INVALID",
    stationId: stationIdValid ? stationId : 1001,
    identifier: (input.identifier.trim().replace(/;/g, " ") || `${mountpoint} Base`).slice(0, 64),
    city: (input.city.trim().replace(/;/g, " ") || "Custom City").slice(0, 48),
    country: countryValid ? country : "VNM",
    coord,
    antennaDescriptor: (input.antennaDescriptor?.trim() || "SEPCHOKE_B3E6   SPKE").slice(0, 31),
    receiverDescriptor: (input.receiverDescriptor?.trim() || "AIKIT EDGE VRS 2.0").slice(0, 31),
    isVrs: Boolean(input.isVrs),
    formatDetails,
    bitrate: Math.max(1200, Math.min(256000, Math.trunc(input.bitrate ?? 11200))),
  };

  const strRecord: StrRecord = {
    type: "STR",
    mountpoint: normalizedStation.mountpoint,
    identifier: normalizedStation.identifier,
    format: (input.format?.trim() || "RTCM 3.3").replace(/;/g, ""),
    formatDetails: normalizedStation.formatDetails,
    carrier: input.carrier ?? 2,
    navSystem: (input.navSystem?.trim() || "GPS+GLO+GAL+BDS").replace(/;/g, ""),
    network: (input.network?.trim() || "AIKIT").replace(/;/g, ""),
    country: normalizedStation.country,
    latitude: normalizedStation.coord.latDeg,
    longitude: normalizedStation.coord.lonDeg,
    nmeaRequired: normalizedStation.isVrs,
    solution: normalizedStation.isVrs ? 1 : 0,
    generator: normalizedStation.receiverDescriptor,
    compression: "none",
    authentication: "N",
    fee: false,
    bitrate: normalizedStation.bitrate,
    misc: "icp-ii-verified;open-mit",
  };

  const strRecordLine = formatSourcetableRecord(strRecord);
  const parsedSt = parseSourcetable(`${strRecordLine}\r\nENDSOURCETABLE\r\n`);
  const stRoundtripOk = parsedSt.streams.length === 1 && parsedSt.warnings.length === 0 && parsedSt.hasEndSourcetable;
  checks.push({
    id: "STR_19_FIELD_SERIALIZATION",
    specRef: "RTCM 10410.1 §4.2 (19-Field STR Record Serialization)",
    status: stRoundtripOk ? "PASS" : "FAIL",
    detail: stRoundtripOk
      ? `STR record serializes cleanly into 19 semicolon-delimited fields and parses with 0 warnings.`
      : `STR record failed Sourcetable parser round-trip: ${parsedSt.warnings.join("; ")}`,
  });

  // 7. RTCM 3.x Binary Frame & CRC-24Q Verification
  const ecef = geodeticToEcef(coord);
  let targetBytes: Uint8Array;
  if (input.sampleRtcmHex?.trim()) {
    targetBytes = hexToBytes(input.sampleRtcmHex.trim()) ?? new Uint8Array(0);
  } else {
    targetBytes = concatRtcmFrames([
      encodeRtcm1005({ stationId: normalizedStation.stationId, ecef }),
      encodeRtcm1033({
        stationId: normalizedStation.stationId,
        antennaDescriptor: normalizedStation.antennaDescriptor,
        receiverTypeDescriptor: normalizedStation.receiverDescriptor,
      }),
      encodeRtcmMsm7({
        messageNumber: 1077,
        stationId: normalizedStation.stationId,
        epochTowMs: 172800000,
        satellites: [
          { prn: 2, roughRangeMs: 70.25, cnrDbHz: 48.5 },
          { prn: 12, roughRangeMs: 73.125, cnrDbHz: 46.8 },
          { prn: 24, roughRangeMs: 76.5, cnrDbHz: 45.2 },
        ],
      }),
      encodeRtcm1230(normalizedStation.stationId),
    ]);
  }

  const decodedFrames = decodeRtcm3Stream(targetBytes);
  const allCrcOk = decodedFrames.length > 0 && decodedFrames.every((f) => f.crcValid);
  checks.push({
    id: "RTCM3_CRC24Q_INTEGRITY",
    specRef: "RTCM 10403.3 §4.1 (0xD3 Framing & 24-bit Qualcomm CRC-24Q)",
    status: allCrcOk ? "PASS" : "FAIL",
    detail: allCrcOk
      ? `Verified ${decodedFrames.length} RTCM 3.x binary frames (${targetBytes.length} bytes); all 24-bit CRC-24Q checksums match.`
      : `RTCM 3.x binary stream failed framing or CRC-24Q verification (${decodedFrames.filter((f) => f.crcValid).length}/${decodedFrames.length} valid).`,
  });

  // 8. Check ARP ECEF <-> WGS-84 consistency in MT 1005 / 1006 frame
  const arpFrame = decodedFrames.find(
    (f) => f.decoded.kind === "RTCM_1005" || f.decoded.kind === "RTCM_1006"
  );
  if (arpFrame && (arpFrame.decoded.kind === "RTCM_1005" || arpFrame.decoded.kind === "RTCM_1006")) {
    const recoveredGeo = ecefToGeodetic(arpFrame.decoded.ecef);
    const driftKm = haversineDistanceKm(coord, recoveredGeo);
    const stnMatches = arpFrame.decoded.stationId === normalizedStation.stationId;
    const arpConsistent = driftKm < 0.05 && stnMatches;
    checks.push({
      id: "ARP_ECEF_WGS84_CONSISTENCY",
      specRef: "RTCM 10403.3 MT 1005/1006 (38-bit 0.1 mm ECEF ARP vs WGS-84)",
      status: arpConsistent ? "PASS" : "FAIL",
      detail: arpConsistent
        ? `MT ${arpFrame.messageNumber} Station ID ${arpFrame.decoded.stationId} ECEF (${arpFrame.decoded.ecef.xM}m, ${arpFrame.decoded.ecef.yM}m, ${arpFrame.decoded.ecef.zM}m) matches declared WGS-84 within ${(driftKm * 1000).toFixed(2)} m.`
        : `MT ${arpFrame.messageNumber} ARP mismatch (Station ID ${arpFrame.decoded.stationId} vs ${normalizedStation.stationId}, horizontal drift ${driftKm.toFixed(3)} km).`,
    });
  } else {
    checks.push({
      id: "ARP_ECEF_WGS84_CONSISTENCY",
      specRef: "RTCM 10403.3 MT 1005/1006",
      status: "FAIL",
      detail: "No RTCM 1005 or 1006 Reference Station ARP frame found in binary payload.",
    });
  }

  // 9. Optional Live Upstream NTRIP Server Handshake
  let upstreamProbe: UpstreamProbeResult | null = null;
  if (input.upstreamUrl?.trim()) {
    upstreamProbe = await probeUpstreamNtripServer(input.upstreamUrl.trim());
    checks.push({
      id: "UPSTREAM_NTRIP_HANDSHAKE",
      specRef: "RTCM 10410.1 §5 (NTRIP v2.0 HTTP Handshake & Content-Type)",
      status: upstreamProbe.reachable ? "PASS" : "FAIL",
      detail: upstreamProbe.summary,
    });
  }

  const passCount = checks.filter((c) => c.status === "PASS").length;
  const warnCount = checks.filter((c) => c.status === "WARN").length;
  const failCount = checks.filter((c) => c.status === "FAIL").length;

  return {
    compliant: failCount === 0,
    specStandard: "RTCM 10410.1 (NTRIP v2.0) + RTCM 10403.3 (RTCM 3.x)",
    checks,
    passCount,
    warnCount,
    failCount,
    normalizedStation,
    strRecord,
    strRecordLine,
    ecef,
    sampleRtcmHex: bytesToHex(targetBytes),
    sampleRtcmBase64: bytesToBase64(targetBytes),
    decodedFrames,
    upstreamProbe,
  };
}
