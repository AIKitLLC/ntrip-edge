/**
 * NMEA-0183 GGA ($GPGGA / $GNGGA) parser, XOR checksum validator, and sentence generator.
 * Used by NTRIP Rovers to report their approximate or RTK-fixed position to NTRIP Casters (via Ntrip-GGA).
 */

import type { GeodeticCoord } from "./coordinates";

export type NmeaFixQuality =
  | 0 // Invalid
  | 1 // GPS SPS Fix (Autonomous)
  | 2 // DGPS Fix
  | 4 // RTK Fixed Ambiguities
  | 5; // RTK Float Ambiguities

export interface NmeaGgaRecord {
  readonly talker: "GP" | "GN" | "GL" | "GA" | "GB";
  readonly utcTime: string;
  readonly latDeg: number;
  readonly lonDeg: number;
  readonly fixQuality: NmeaFixQuality;
  readonly fixQualityLabel: string;
  readonly satellitesUsed: number;
  readonly hdop: number;
  readonly altitudeM: number;
  readonly geoidSeparationM: number;
  readonly diffAgeSec: number | null;
  readonly diffStationId: string | null;
  readonly checksumExpected: string;
  readonly checksumActual: string;
  readonly checksumValid: boolean;
  readonly rawSentence: string;
}

export type NmeaParseResult =
  | { readonly ok: true; readonly record: NmeaGgaRecord }
  | { readonly ok: false; readonly error: string };

/**
 * Compute NMEA-0183 8-bit XOR checksum over characters between '$' and '*'.
 */
export function computeNmeaChecksum(bodyBetweenDollarAndStar: string): string {
  let xor = 0;
  for (let i = 0; i < bodyBetweenDollarAndStar.length; i++) {
    xor ^= bodyBetweenDollarAndStar.charCodeAt(i);
  }
  return (xor & 0xff).toString(16).toUpperCase().padStart(2, "0");
}

export function describeFixQuality(quality: number): string {
  switch (quality) {
    case 0:
      return "Invalid (No Fix)";
    case 1:
      return "Autonomous GNSS Fix (Single)";
    case 2:
      return "Differential GNSS (DGPS)";
    case 4:
      return "RTK Fixed (Centimeter-level)";
    case 5:
      return "RTK Float (Decimeter-level)";
    default:
      return `Fix Mode ${quality}`;
  }
}

function nmeaDmToDecimalDegrees(dmString: string, hemisphere: string): number | null {
  const trimmed = dmString.trim();
  if (!trimmed) return null;
  const dotIdx = trimmed.indexOf(".");
  const degLen = dotIdx >= 4 ? dotIdx - 2 : 2;
  const degPart = Number.parseFloat(trimmed.slice(0, degLen));
  const minPart = Number.parseFloat(trimmed.slice(degLen));
  if (!Number.isFinite(degPart) || !Number.isFinite(minPart)) {
    return null;
  }
  const absDeg = degPart + minPart / 60.0;
  const hemi = hemisphere.trim().toUpperCase();
  const sign = hemi === "S" || hemi === "W" ? -1 : 1;
  return Math.round(sign * absDeg * 1e7) / 1e7;
}

function decimalDegreesToNmeaDm(deg: number, isLongitude: boolean): { dm: string; hemi: string } {
  const abs = Math.abs(deg);
  const wholeDeg = Math.floor(abs);
  const minutes = (abs - wholeDeg) * 60.0;
  const degFormatted = wholeDeg.toString().padStart(isLongitude ? 3 : 2, "0");
  const minFormatted = minutes.toFixed(4).padStart(7, "0");
  const hemi = isLongitude ? (deg >= 0 ? "E" : "W") : deg >= 0 ? "N" : "S";
  return { dm: `${degFormatted}${minFormatted}`, hemi };
}

/**
 * Parse and validate an NMEA-0183 $GPGGA or $GNGGA sentence.
 */
export function parseNmeaGga(sentenceInput: string): NmeaParseResult {
  const rawSentence = sentenceInput.trim();
  if (!rawSentence.startsWith("$")) {
    return { ok: false, error: "NMEA sentence must start with '$'" };
  }

  const starIdx = rawSentence.indexOf("*");
  const body = starIdx >= 0 ? rawSentence.slice(1, starIdx) : rawSentence.slice(1);
  const checksumActual = starIdx >= 0 ? rawSentence.slice(starIdx + 1).toUpperCase() : "";
  const checksumExpected = computeNmeaChecksum(body);
  const checksumValid = starIdx >= 0 ? checksumActual === checksumExpected : false;

  const fields = body.split(",");
  const header = (fields[0] ?? "").toUpperCase();
  if (!/^G[PNLAB]GGA$/.test(header)) {
    return { ok: false, error: `Unsupported NMEA sentence header '${header}' (expected GPGGA or GNGGA)` };
  }

  const talker = header.slice(0, 2) as NmeaGgaRecord["talker"];
  const utcTime = fields[1] ?? "000000.00";
  const latDeg = nmeaDmToDecimalDegrees(fields[2] ?? "", fields[3] ?? "N");
  const lonDeg = nmeaDmToDecimalDegrees(fields[4] ?? "", fields[5] ?? "E");

  if (latDeg === null || lonDeg === null || Math.abs(latDeg) > 90 || Math.abs(lonDeg) > 180) {
    return { ok: false, error: "Invalid latitude/longitude fields in GGA sentence" };
  }

  const rawQuality = Number.parseInt(fields[6] ?? "1", 10);
  const fixQuality: NmeaFixQuality =
    rawQuality === 0 || rawQuality === 1 || rawQuality === 2 || rawQuality === 4 || rawQuality === 5 ? rawQuality : 1;
  const satellitesUsed = Number.parseInt(fields[7] ?? "12", 10) || 0;
  const hdop = Number.parseFloat(fields[8] ?? "1.0") || 1.0;
  const altitudeM = Number.parseFloat(fields[9] ?? "0.0") || 0.0;
  const geoidSeparationM = Number.parseFloat(fields[11] ?? "0.0") || 0.0;
  const diffAgeRaw = fields[13]?.trim() ?? "";
  const diffAgeSec = diffAgeRaw ? Number.parseFloat(diffAgeRaw) : null;
  const diffStationId = fields[14]?.trim() || null;

  return {
    ok: true,
    record: {
      talker,
      utcTime,
      latDeg,
      lonDeg,
      fixQuality,
      fixQualityLabel: describeFixQuality(fixQuality),
      satellitesUsed,
      hdop,
      altitudeM,
      geoidSeparationM,
      diffAgeSec: diffAgeSec !== null && Number.isFinite(diffAgeSec) ? diffAgeSec : null,
      diffStationId,
      checksumExpected,
      checksumActual,
      checksumValid,
      rawSentence,
    },
  };
}

export interface BuildGgaOptions {
  readonly coord: GeodeticCoord;
  readonly utcDate?: Date;
  readonly fixQuality?: NmeaFixQuality;
  readonly satellitesUsed?: number;
  readonly hdop?: number;
  readonly geoidSeparationM?: number;
  readonly diffAgeSec?: number;
  readonly diffStationId?: number | string;
  readonly talker?: "GP" | "GN";
}

/**
 * Generate a standards-compliant NMEA-0183 $GNGGA sentence with valid XOR checksum.
 */
export function buildNmeaGga(options: BuildGgaOptions): string {
  const date = options.utcDate ?? new Date();
  const hh = date.getUTCHours().toString().padStart(2, "0");
  const mm = date.getUTCMinutes().toString().padStart(2, "0");
  const ss = date.getUTCSeconds().toString().padStart(2, "0");
  const hundredths = Math.floor(date.getUTCMilliseconds() / 10)
    .toString()
    .padStart(2, "0");
  const utcTime = `${hh}${mm}${ss}.${hundredths}`;

  const lat = decimalDegreesToNmeaDm(options.coord.latDeg, false);
  const lon = decimalDegreesToNmeaDm(options.coord.lonDeg, true);
  const fixQuality = options.fixQuality ?? 4;
  const sats = (options.satellitesUsed ?? 18).toString().padStart(2, "0");
  const hdop = (options.hdop ?? 0.65).toFixed(2);
  const geoid = options.geoidSeparationM ?? -27.4;
  const orthometricHeight = (options.coord.heightM - geoid).toFixed(3);
  const geoidStr = geoid.toFixed(3);
  const diffAge = options.diffAgeSec !== undefined ? options.diffAgeSec.toFixed(1) : "1.0";
  const stationId =
    options.diffStationId !== undefined ? options.diffStationId.toString().padStart(4, "0") : "0001";
  const talker = options.talker ?? "GN";

  const body = [
    `${talker}GGA`,
    utcTime,
    lat.dm,
    lat.hemi,
    lon.dm,
    lon.hemi,
    fixQuality.toString(),
    sats,
    hdop,
    orthometricHeight,
    "M",
    geoidStr,
    "M",
    diffAge,
    stationId,
  ].join(",");

  const checksum = computeNmeaChecksum(body);
  return `$${body}*${checksum}`;
}
