/**
 * NTRIP Revision 1 (v1.0 — RTCM 10410.0) and Revision 2 (v2.0 — RTCM 10410.1)
 * Protocol Negotiation, Wire-Level Handshake Builders, and Spec Comparators.
 */

export type NtripRevision = "rev1" | "rev2";
export type NtripServerMode = "rev1" | "rev2" | "dual";

export interface NtripWireTranscript {
  readonly revision: NtripRevision;
  readonly specStandard: "RTCM 10410.0 (NTRIP v1.0)" | "RTCM 10410.1 (NTRIP v2.0)";
  readonly clientSourcetableRequest: string;
  readonly casterSourcetableResponseHeaders: string;
  readonly clientStreamRequest: string;
  readonly casterStreamResponseHeaders: string;
  readonly serverIngestRequestHeaders: string;
  readonly casterIngestResponseHeaders: string;
  readonly transportCharacteristics: {
    readonly httpVersion: "HTTP/1.0 (Non-standard ICY/SOURCETABLE status)" | "HTTP/1.1 (Strict RFC 7230)";
    readonly sourcetableStatusLine: "SOURCETABLE 200 OK" | "HTTP/1.1 200 OK";
    readonly streamStatusLine: "ICY 200 OK" | "HTTP/1.1 200 OK";
    readonly sourcetableContentType: "text/plain" | "gnss/sourcetable";
    readonly streamContentType: "application/octet-stream (implicit)" | "gnss/data";
    readonly serverIngestMethod: "SOURCE <password> /<mountpoint>" | "POST /<mountpoint> HTTP/1.1";
    readonly transferEncoding: "raw unchunked TCP byte stream" | "chunked (HTTP/1.1 Transfer-Encoding)";
    readonly ggaTransmission: "Inline NMEA sentence after headers" | "Ntrip-GGA HTTP Header (or inline)";
  };
}

export interface BuildTranscriptOptions {
  readonly mountpoint: string;
  readonly host?: string;
  readonly port?: number;
  readonly sourcePassword?: string;
  readonly sampleGga?: string;
  readonly sourcetableByteLength?: number;
}

const DEFAULT_SAMPLE_GGA =
  "$GNGGA,180000.00,2101.7107,N,10548.2890,E,4,24,0.58,52.200,M,-27.400,M,0.8,1001*7E";

/**
 * Generate the complete wire-level HTTP/TCP handshake transcripts for either NTRIP Rev 1 (v1.0) or NTRIP Rev 2 (v2.0).
 */
export function buildNtripWireTranscript(
  revision: NtripRevision,
  options: BuildTranscriptOptions
): NtripWireTranscript {
  const mp = options.mountpoint.trim().toUpperCase() || "HAN0-VN";
  const host = options.host ?? "ntrip.ai-kit.net";
  const port = options.port ?? 2101;
  const pwd = options.sourcePassword ?? "ntrip123";
  const gga = options.sampleGga ?? DEFAULT_SAMPLE_GGA;
  const stLen = options.sourcetableByteLength ?? 1024;
  const basicAuth = btoa(`rover:${pwd}`);
  const serverAuth = btoa(`base:${pwd}`);

  if (revision === "rev1") {
    return {
      revision: "rev1",
      specStandard: "RTCM 10410.0 (NTRIP v1.0)",
      clientSourcetableRequest: [
        "GET / HTTP/1.0",
        `Host: ${host}:${port}`,
        "User-Agent: NTRIP AIKitRover/1.0",
        "Accept: */*",
        "Connection: close",
        "",
        "",
      ].join("\r\n"),
      casterSourcetableResponseHeaders: [
        "SOURCETABLE 200 OK",
        "Server: NTRIP AIKit-Edge-Caster/1.0",
        "Content-Type: text/plain",
        `Content-Length: ${stLen}`,
        "Connection: close",
        "",
        "STR;...",
        "ENDSOURCETABLE",
      ].join("\r\n"),
      clientStreamRequest: [
        `GET /${mp} HTTP/1.0`,
        `Host: ${host}:${port}`,
        "User-Agent: NTRIP AIKitRover/1.0",
        `Authorization: Basic ${basicAuth}`,
        "",
        gga,
      ].join("\r\n"),
      casterStreamResponseHeaders: [
        "ICY 200 OK",
        "Server: NTRIP AIKit-Edge-Caster/1.0",
        "",
        "<raw unchunked RTCM 3.x binary stream: 0xD3 ... CRC24Q>",
      ].join("\r\n"),
      serverIngestRequestHeaders: [
        `SOURCE ${pwd} /${mp}`,
        "Source-Agent: NTRIP AIKitBaseServer/1.0",
        `STR: ;${mp};${mp} Base;RTCM 3.3;1005(5),1077(1);2;GPS+GLO+GAL+BDS;AIKIT;VNM;0.00;0.00;0;0;AIKIT;none;B;N;9600;rev1`,
        "",
        "<raw unchunked RTCM 3.x binary stream: 0xD3 ... CRC24Q>",
      ].join("\r\n"),
      casterIngestResponseHeaders: ["ICY 200 OK", "Server: NTRIP AIKit-Edge-Caster/1.0", "", ""].join("\r\n"),
      transportCharacteristics: {
        httpVersion: "HTTP/1.0 (Non-standard ICY/SOURCETABLE status)",
        sourcetableStatusLine: "SOURCETABLE 200 OK",
        streamStatusLine: "ICY 200 OK",
        sourcetableContentType: "text/plain",
        streamContentType: "application/octet-stream (implicit)",
        serverIngestMethod: "SOURCE <password> /<mountpoint>",
        transferEncoding: "raw unchunked TCP byte stream",
        ggaTransmission: "Inline NMEA sentence after headers",
      },
    };
  }

  return {
    revision: "rev2",
    specStandard: "RTCM 10410.1 (NTRIP v2.0)",
    clientSourcetableRequest: [
      "GET / HTTP/1.1",
      `Host: ${host}`,
      "Ntrip-Version: Ntrip/2.0",
      "User-Agent: NTRIP AIKitRover/2.0",
      "Connection: close",
      "",
      "",
    ].join("\r\n"),
    casterSourcetableResponseHeaders: [
      "HTTP/1.1 200 OK",
      "Ntrip-Version: Ntrip/2.0",
      "Server: NTRIP AIKit-Edge-Caster/2.0",
      "Content-Type: gnss/sourcetable",
      `Content-Length: ${stLen}`,
      "Connection: close",
      "",
      "STR;...",
      "ENDSOURCETABLE",
    ].join("\r\n"),
    clientStreamRequest: [
      `GET /${mp} HTTP/1.1`,
      `Host: ${host}`,
      "Ntrip-Version: Ntrip/2.0",
      "User-Agent: NTRIP AIKitRover/2.0",
      `Authorization: Basic ${basicAuth}`,
      `Ntrip-GGA: ${gga}`,
      "Connection: close",
      "",
      "",
    ].join("\r\n"),
    casterStreamResponseHeaders: [
      "HTTP/1.1 200 OK",
      "Ntrip-Version: Ntrip/2.0",
      "Server: NTRIP AIKit-Edge-Caster/2.0",
      "Content-Type: gnss/data",
      "Transfer-Encoding: chunked",
      "Cache-Control: no-store, no-transform",
      "",
      "<HTTP/1.1 chunked RTCM 3.x binary stream: 0xD3 ... CRC24Q>",
    ].join("\r\n"),
    serverIngestRequestHeaders: [
      `POST /${mp} HTTP/1.1`,
      `Host: ${host}`,
      "Ntrip-Version: Ntrip/2.0",
      "User-Agent: NTRIP AIKitBaseServer/2.0",
      `Authorization: Basic ${serverAuth}`,
      "Content-Type: gnss/data",
      "Transfer-Encoding: chunked",
      "Connection: close",
      "",
      "<HTTP/1.1 chunked RTCM 3.x binary stream: 0xD3 ... CRC24Q>",
    ].join("\r\n"),
    casterIngestResponseHeaders: [
      "HTTP/1.1 200 OK",
      "Ntrip-Version: Ntrip/2.0",
      "Server: NTRIP AIKit-Edge-Caster/2.0",
      "",
      "",
    ].join("\r\n"),
    transportCharacteristics: {
      httpVersion: "HTTP/1.1 (Strict RFC 7230)",
      sourcetableStatusLine: "HTTP/1.1 200 OK",
      streamStatusLine: "HTTP/1.1 200 OK",
      sourcetableContentType: "gnss/sourcetable",
      streamContentType: "gnss/data",
      serverIngestMethod: "POST /<mountpoint> HTTP/1.1",
      transferEncoding: "chunked (HTTP/1.1 Transfer-Encoding)",
      ggaTransmission: "Ntrip-GGA HTTP Header (or inline)",
    },
  };
}

/**
 * Negotiate NTRIP Revision (`rev1` vs `rev2`) from request query parameter or HTTP headers.
 */
export function negotiateNtripRevision(options: {
  readonly queryRev?: string | undefined;
  readonly ntripVersionHeader?: string | undefined;
  readonly pathPrefix?: "rev1" | "rev2" | undefined;
  readonly stationDefaultMode?: NtripServerMode | undefined;
}): NtripRevision {
  if (options.pathPrefix === "rev1") return "rev1";
  if (options.pathPrefix === "rev2") return "rev2";

  const q = (options.queryRev ?? "").trim().toLowerCase();
  if (q === "1" || q === "v1" || q === "rev1" || q === "ntrip/1.0") {
    return "rev1";
  }
  if (q === "2" || q === "v2" || q === "rev2" || q === "ntrip/2.0") {
    return "rev2";
  }

  const hdr = (options.ntripVersionHeader ?? "").trim().toLowerCase();
  if (hdr.includes("1.0")) {
    return "rev1";
  }
  if (hdr.includes("2.0")) {
    return "rev2";
  }

  if (options.stationDefaultMode === "rev1") {
    return "rev1";
  }
  return "rev2";
}

export interface ParsedRev1SourceCommand {
  readonly valid: boolean;
  readonly password?: string;
  readonly mountpoint?: string;
  readonly sourceAgent?: string;
  readonly strLine?: string;
  readonly binaryPayloadOffset: number;
  readonly error?: string;
}

/**
 * Parse an NTRIP Rev 1 (v1.0) Server `SOURCE <password> /<mountpoint>` wire header preamble.
 */
export function parseRev1SourceHeader(bytes: Uint8Array): ParsedRev1SourceCommand {
  const headerProbeLen = Math.min(bytes.length, 1024);
  const text = new TextDecoder().decode(bytes.subarray(0, headerProbeLen));
  if (!text.startsWith("SOURCE ")) {
    return {
      valid: false,
      binaryPayloadOffset: 0,
      error: "Buffer does not begin with NTRIP Rev 1 'SOURCE <password> /<mountpoint>' command",
    };
  }

  const headerEndIdx = text.indexOf("\r\n\r\n");
  const lfEndIdx = text.indexOf("\n\n");
  const splitIdx = headerEndIdx >= 0 ? headerEndIdx : lfEndIdx;
  const binaryPayloadOffset =
    headerEndIdx >= 0 ? headerEndIdx + 4 : lfEndIdx >= 0 ? lfEndIdx + 2 : text.length;

  const headerBlock = splitIdx >= 0 ? text.slice(0, splitIdx) : text;
  const lines = headerBlock.split(/\r?\n/);
  const firstLine = (lines[0] ?? "").trim();
  const match = /^SOURCE\s+(\S+)\s+\/?([A-Za-z0-9._-]{1,32})$/.exec(firstLine);
  if (!match) {
    return {
      valid: false,
      binaryPayloadOffset: 0,
      error: `Invalid NTRIP Rev 1 SOURCE syntax '${firstLine}' (expected 'SOURCE <password> /<mountpoint>')`,
    };
  }

  let sourceAgent: string | undefined;
  let strLine: string | undefined;
  for (let i = 1; i < lines.length; i++) {
    const line = (lines[i] ?? "").trim();
    if (line.toLowerCase().startsWith("source-agent:")) {
      sourceAgent = line.slice("source-agent:".length).trim();
    } else if (line.toUpperCase().startsWith("STR:")) {
      strLine = line.slice(4).trim();
    }
  }

  return {
    valid: true,
    password: match[1] ?? "",
    mountpoint: (match[2] ?? "").toUpperCase(),
    ...(sourceAgent !== undefined ? { sourceAgent } : {}),
    ...(strLine !== undefined ? { strLine } : {}),
    binaryPayloadOffset,
  };
}
