import { Hono } from "hono";
import type { Env } from "../types/env";

export const openapiRouter = new Hono<{ Bindings: Env }>();

export const OPENAPI_SPEC = {
  openapi: "3.1.0",
  info: {
    title: "AI Kit NTRIP Edge — Caster, RTCM 3.x Codec & GNSS RTK Simulator API",
    version: "1.0.0",
    description:
      "Open-source (MIT) NTRIP v1.0/v2.0 Edge Caster, bit-level RTCM 3.x encoder/decoder (CRC-24Q), NMEA-0183 GGA VRS router, and real-time GNSS RTK convergence simulator running on Cloudflare Workers.",
    license: {
      name: "MIT",
      url: "https://github.com/AIKitLLC/ntrip-edge/blob/main/LICENSE",
    },
    contact: {
      name: "AI Kit LLC",
      url: "https://github.com/AIKitLLC/ntrip-edge",
    },
  },
  servers: [
    { url: "https://ntrip.ai-kit.net", description: "Production Edge Caster & Playground" },
    { url: "https://ntrip-edge.tuannx87.workers.dev", description: "Cloudflare Workers.dev Mirror" },
  ],
  paths: {
    "/sourcetable": {
      get: {
        summary: "NTRIP v2.0 Sourcetable (gnss/sourcetable)",
        description: "Returns the raw semicolon-delimited NTRIP Sourcetable (STR, CAS, NET, ENDSOURCETABLE).",
      },
    },
    "/{mountpoint}": {
      get: {
        summary: "NTRIP v2.0 Mountpoint Stream (gnss/data)",
        description:
          "Returns binary RTCM 3.x frames (1005, 1033, 1077, 1087, 1097, 1127, 1230, 4072) for HAN0-VN, SGN0-VN, SFO0-US, FFMJ-DE, TYO0-JP, or VRS-AUTO. Supports Ntrip-GGA header or ?gga= query parameter.",
      },
      post: {
        summary: "NTRIP v2.0 Server Ingest Verifier",
        description: "Accepts raw binary RTCM 3.x frames and returns decoded frame telemetry and CRC-24Q validation.",
      },
    },
    "/api/v1/sourcetable": {
      get: {
        summary: "Structured JSON Sourcetable & Nearest Base VRS Selector",
        description: "Returns parsed STR/CAS/NET records and computes Haversine distances when ?lat=&lon= or ?gga= is passed.",
      },
    },
    "/api/v1/sourcetable/parse": {
      post: {
        summary: "Parse & Validate Custom NTRIP Sourcetable",
        description: "Validates and parses any custom NTRIP Sourcetable text into typed JSON records.",
      },
    },
    "/api/v1/rtcm/decode": {
      post: {
        summary: "Decode Binary RTCM 3.x Frames (Hex or Base64)",
        description: "Scans for 0xD3 preambles, verifies 24-bit Qualcomm CRC-24Q, and unpacks 1005/1006/1033/MSM7/1230/4072 payloads.",
      },
    },
    "/api/v1/rtcm/encode": {
      post: {
        summary: "Encode Custom RTCM 3.x Binary Frame",
        description: "Encodes RTCM 1005, 1006, 1033, 1230, or 4072 frames with CRC-24Q from WGS-84 coordinates or telemetry.",
      },
    },
    "/api/v1/nmea/gga": {
      post: {
        summary: "Parse or Synthesize NMEA-0183 $GNGGA & Compute VRS Baseline",
        description: "Validates NMEA XOR checksums, converts DDMM.MMMM <-> decimal degrees, and calculates ENU baseline vectors.",
      },
    },
    "/api/v1/simulate/epoch": {
      get: {
        summary: "Simulate Complete 1 Hz GNSS RTK Epoch",
        description: "Generates binary RTCM 3.x packet, decoded frames, Rover NMEA GGA, and RTK Fixed/Float convergence metrics.",
      },
    },
    "/api/v1/stream/{mountpoint}": {
      get: {
        summary: "Live Server-Sent Events (SSE) 1 Hz RTK Stream",
        description: "Streams real-time simulated epochs over SSE for browser playgrounds and telemetry dashboards.",
      },
    },
  },
};

const LLMS_TXT = `# AI Kit NTRIP Edge (https://ntrip.ai-kit.net)

> Open-source (MIT) NTRIP v1.0/v2.0 Caster, RTCM 3.x Codec (CRC-24Q), NMEA-0183 GGA VRS Router, and GNSS RTK Simulator on Cloudflare Workers.
> Repository: https://github.com/AIKitLLC/ntrip-edge

## Direct NTRIP v2.0 Caster Endpoints
- GET /sourcetable (or GET / with Header "Ntrip-Version: Ntrip/2.0") -> gnss/sourcetable
- GET /HAN0-VN, /SGN0-VN, /SFO0-US, /FFMJ-DE, /TYO0-JP, /VRS-AUTO -> binary gnss/data (RTCM 3.3)
- POST /HAN0-VN -> NTRIP v2.0 Server ingest verifier (decodes binary RTCM3 body)

## JSON & Streaming API
- GET /api/v1/sourcetable?lat=21.0285&lon=105.8048
- POST /api/v1/sourcetable/parse {"sourcetable": "STR;..."}
- POST /api/v1/rtcm/decode {"payload": "D300133ED...", "encoding": "hex"}
- POST /api/v1/rtcm/encode {"messageNumber": 1005, "stationId": 1001, "latDeg": 21.028511, "lonDeg": 105.804817, "heightM": 24.8}
- POST /api/v1/nmea/gga {"latDeg": 21.0309, "lonDeg": 105.8079, "heightM": 26.2, "fixQuality": 4}
- GET /api/v1/simulate/epoch?mountpoint=HAN0-VN&epoch=5
- GET /api/v1/stream/HAN0-VN?epochs=6&intervalMs=600 (Server-Sent Events)
`;

openapiRouter.get("/openapi.json", (c) => c.json(OPENAPI_SPEC));
openapiRouter.get("/llms.txt", (c) => c.text(LLMS_TXT));
