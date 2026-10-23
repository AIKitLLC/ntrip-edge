/**
 * NTRIP v1.0 / v2.0 Sourcetable (STR, CAS, NET records) parser, serializer, and validator.
 * Clean-room open-source implementation under the MIT License.
 */

export interface StrRecord {
  readonly type: "STR";
  readonly mountpoint: string;
  readonly identifier: string;
  readonly format: string;
  readonly formatDetails: string;
  readonly carrier: 0 | 1 | 2;
  readonly navSystem: string;
  readonly network: string;
  readonly country: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly nmeaRequired: boolean;
  readonly solution: 0 | 1; // 0 = single base, 1 = network/VRS
  readonly generator: string;
  readonly compression: string;
  readonly authentication: "N" | "B" | "D"; // None, Basic, Digest
  readonly fee: boolean;
  readonly bitrate: number;
  readonly misc: string;
}

export interface CasRecord {
  readonly type: "CAS";
  readonly host: string;
  readonly port: number;
  readonly identifier: string;
  readonly operator: string;
  readonly nmeaSupport: boolean;
  readonly country: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly fallbackHost: string;
  readonly fallbackPort: number;
  readonly misc: string;
}

export interface NetRecord {
  readonly type: "NET";
  readonly identifier: string;
  readonly operator: string;
  readonly authentication: "N" | "B" | "D";
  readonly fee: boolean;
  readonly webNet: string;
  readonly webStr: string;
  readonly webReg: string;
  readonly misc: string;
}

export type SourcetableRecord = StrRecord | CasRecord | NetRecord;

export interface ParsedSourcetable {
  readonly streams: readonly StrRecord[];
  readonly casters: readonly CasRecord[];
  readonly networks: readonly NetRecord[];
  readonly warnings: readonly string[];
  readonly hasEndSourcetable: boolean;
}

/**
 * Serialize a single STR, CAS, or NET record into its semicolon-delimited NTRIP Sourcetable line.
 */
export function formatSourcetableRecord(record: SourcetableRecord): string {
  switch (record.type) {
    case "STR":
      return [
        "STR",
        record.mountpoint,
        record.identifier,
        record.format,
        record.formatDetails,
        record.carrier.toString(),
        record.navSystem,
        record.network,
        record.country,
        record.latitude.toFixed(4),
        record.longitude.toFixed(4),
        record.nmeaRequired ? "1" : "0",
        record.solution.toString(),
        record.generator,
        record.compression,
        record.authentication,
        record.fee ? "Y" : "N",
        record.bitrate.toString(),
        record.misc,
      ].join(";");

    case "CAS":
      return [
        "CAS",
        record.host,
        record.port.toString(),
        record.identifier,
        record.operator,
        record.nmeaSupport ? "1" : "0",
        record.country,
        record.latitude.toFixed(4),
        record.longitude.toFixed(4),
        record.fallbackHost,
        record.fallbackPort.toString(),
        record.misc,
      ].join(";");

    case "NET":
      return [
        "NET",
        record.identifier,
        record.operator,
        record.authentication,
        record.fee ? "Y" : "N",
        record.webNet,
        record.webStr,
        record.webReg,
        record.misc,
      ].join(";");
  }
}

/**
 * Build a complete NTRIP Sourcetable body (`STR;...`, `CAS;...`, `NET;...`, `ENDSOURCETABLE`).
 */
export function serializeSourcetable(records: readonly SourcetableRecord[]): string {
  const lines = records.map(formatSourcetableRecord);
  lines.push("ENDSOURCETABLE");
  return lines.join("\r\n") + "\r\n";
}

/**
 * Parse raw NTRIP Sourcetable text into typed STR, CAS, and NET records with validation diagnostics.
 */
export function parseSourcetable(rawText: string): ParsedSourcetable {
  const streams: StrRecord[] = [];
  const casters: CasRecord[] = [];
  const networks: NetRecord[] = [];
  const warnings: string[] = [];
  let hasEndSourcetable = false;

  const lines = rawText.split(/\r?\n/);
  for (let idx = 0; idx < lines.length; idx++) {
    const line = (lines[idx] ?? "").trim();
    if (!line) continue;

    // Skip HTTP/NTRIP status or header lines if the user pasted a full HTTP response
    if (
      line.startsWith("SOURCETABLE ") ||
      line.startsWith("HTTP/") ||
      /^[A-Za-z0-9-]+:\s/.test(line)
    ) {
      continue;
    }

    if (line.toUpperCase() === "ENDSOURCETABLE") {
      hasEndSourcetable = true;
      break;
    }

    const parts = line.split(";");
    const recordType = (parts[0] ?? "").toUpperCase();

    if (recordType === "STR") {
      if (parts.length < 18) {
        warnings.push(`Line ${idx + 1}: STR record has ${parts.length} fields (expected >= 18)`);
        continue;
      }
      const carrierRaw = Number.parseInt(parts[5] ?? "2", 10);
      const carrier: 0 | 1 | 2 = carrierRaw === 0 || carrierRaw === 1 || carrierRaw === 2 ? carrierRaw : 2;
      const solutionRaw = Number.parseInt(parts[12] ?? "0", 10);
      const solution: 0 | 1 = solutionRaw === 1 ? 1 : 0;
      const authRaw = (parts[15] ?? "N").toUpperCase();
      const authentication: "N" | "B" | "D" = authRaw === "B" || authRaw === "D" ? authRaw : "N";

      streams.push({
        type: "STR",
        mountpoint: parts[1] ?? "",
        identifier: parts[2] ?? "",
        format: parts[3] ?? "RTCM 3.3",
        formatDetails: parts[4] ?? "",
        carrier,
        navSystem: parts[6] ?? "GPS+GLO+GAL+BDS",
        network: parts[7] ?? "AIKIT",
        country: parts[8] ?? "VNM",
        latitude: Number.parseFloat(parts[9] ?? "0") || 0,
        longitude: Number.parseFloat(parts[10] ?? "0") || 0,
        nmeaRequired: (parts[11] ?? "0") === "1",
        solution,
        generator: parts[13] ?? "AIKit-Edge",
        compression: parts[14] ?? "none",
        authentication,
        fee: (parts[16] ?? "N").toUpperCase() === "Y",
        bitrate: Number.parseInt(parts[17] ?? "9600", 10) || 9600,
        misc: parts.slice(18).join(";"),
      });
    } else if (recordType === "CAS") {
      if (parts.length < 11) {
        warnings.push(`Line ${idx + 1}: CAS record has ${parts.length} fields (expected >= 11)`);
        continue;
      }
      casters.push({
        type: "CAS",
        host: parts[1] ?? "",
        port: Number.parseInt(parts[2] ?? "2101", 10) || 2101,
        identifier: parts[3] ?? "",
        operator: parts[4] ?? "",
        nmeaSupport: (parts[5] ?? "0") === "1",
        country: parts[6] ?? "",
        latitude: Number.parseFloat(parts[7] ?? "0") || 0,
        longitude: Number.parseFloat(parts[8] ?? "0") || 0,
        fallbackHost: parts[9] ?? "0.0.0.0",
        fallbackPort: Number.parseInt(parts[10] ?? "0", 10) || 0,
        misc: parts.slice(11).join(";"),
      });
    } else if (recordType === "NET") {
      if (parts.length < 8) {
        warnings.push(`Line ${idx + 1}: NET record has ${parts.length} fields (expected >= 8)`);
        continue;
      }
      const authRaw = (parts[3] ?? "N").toUpperCase();
      const authentication: "N" | "B" | "D" = authRaw === "B" || authRaw === "D" ? authRaw : "N";
      networks.push({
        type: "NET",
        identifier: parts[1] ?? "",
        operator: parts[2] ?? "",
        authentication,
        fee: (parts[4] ?? "N").toUpperCase() === "Y",
        webNet: parts[5] ?? "",
        webStr: parts[6] ?? "",
        webReg: parts[7] ?? "",
        misc: parts.slice(8).join(";"),
      });
    } else {
      warnings.push(`Line ${idx + 1}: Unrecognized sourcetable record type '${recordType}'`);
    }
  }

  return {
    streams,
    casters,
    networks,
    warnings,
    hasEndSourcetable,
  };
}
