import { Hono } from "hono";
import type { Env } from "../types/env";
import { MCP_TOOLS } from "./mcp";

export const openapiRouter = new Hono<{ Bindings: Env }>();

export const OPENAPI_SPEC = {
  openapi: "3.1.0",
  info: {
    title: "AI Kit NTRIP Edge — Caster, RTCM 3.x Codec, GNSS RTK Simulator & MCP Server API",
    version: "1.1.0",
    description:
      "Open-source (MIT) NTRIP v1.0/v2.0 Edge Caster, bit-level RTCM 3.x encoder/decoder (CRC-24Q), NMEA-0183 GGA VRS router, NTRIP Server Spec Validator, and Model Context Protocol (MCP) server with ICP Internet Identity (II) authentication.",
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
    { url: "https://ntrip.ai-kit.net", description: "Production Edge Caster, Playground & MCP Server" },
    { url: "https://ntrip-edge.tuannx87.workers.dev", description: "Cloudflare Workers.dev Mirror" },
  ],
  paths: {
    "/mcp": {
      get: {
        summary: "MCP Server Discovery & Tool Schema Manifest",
        description: "Returns Model Context Protocol (MCP) capabilities and tool definitions.",
      },
      post: {
        summary: "MCP JSON-RPC 2.0 Streamable HTTP Endpoint",
        description:
          "Supports initialize, tools/list, and tools/call (icp_ii_auth_challenge, icp_ii_auth_verify, validate_ntrip_server, create_ntrip_config, simulate_rtk_epoch, decode_rtcm3_stream).",
      },
    },
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
          "Returns binary RTCM 3.x frames (1005, 1033, 1077, 1087, 1097, 1127, 1230, 4072) for any default or custom registered mountpoint. Supports Ntrip-GGA header or ?gga= query parameter.",
      },
      post: {
        summary: "NTRIP v2.0 Server Ingest Verifier",
        description: "Accepts raw binary RTCM 3.x frames and returns decoded frame telemetry and CRC-24Q validation.",
      },
    },
    "/api/v1/auth/icp-ii/challenge": {
      get: {
        summary: "Request ICP Internet Identity (II) Authentication Challenge",
        description: "Returns a time-bound signed challengeToken and challengeMessage to be signed by an ICP II session key or delegation.",
      },
      post: {
        summary: "Request ICP Internet Identity (II) Authentication Challenge",
      },
    },
    "/api/v1/auth/icp-ii/verify": {
      post: {
        summary: "Verify ICP Internet Identity Signature/Delegation & Issue Session Token",
        description:
          "Verifies the ICP II public key/signature, validates the CRC-32 + Base32 ICP Principal, and returns an 'icp_ii_...' bearer token.",
      },
    },
    "/api/v1/ntrip/validate": {
      post: {
        summary: "Validate Candidate NTRIP Server & Mountpoint Configuration Against Specs",
        description:
          "Validates mountpoint syntax, 12-bit Station ID, ISO3 country code, WGS-84 bounds, RTCM schedule, 19-field STR serialization, CRC-24Q binary integrity, ARP ECEF/WGS84 consistency, and optional live upstream NTRIP v2.0 HTTP handshake.",
      },
    },
    "/api/v1/configs": {
      get: {
        summary: "List Active & Custom Registered NTRIP Configurations",
      },
      post: {
        summary: "Create New NTRIP Configuration (Requires ICP II Auth + Spec Compliance)",
        description:
          "Requires 'Authorization: Bearer icp_ii_...' (or icpSessionToken in body) AND requires 0 spec failures in validateNtripConfigAgainstSpecs.",
      },
    },
    "/api/v1/sourcetable": {
      get: {
        summary: "Structured JSON Sourcetable & Nearest Base VRS Selector",
      },
    },
    "/api/v1/sourcetable/parse": {
      post: {
        summary: "Parse & Validate Custom NTRIP Sourcetable",
      },
    },
    "/api/v1/rtcm/decode": {
      post: {
        summary: "Decode Binary RTCM 3.x Frames (Hex or Base64)",
      },
    },
    "/api/v1/rtcm/encode": {
      post: {
        summary: "Encode Custom RTCM 3.x Binary Frame",
      },
    },
    "/api/v1/nmea/gga": {
      post: {
        summary: "Parse or Synthesize NMEA-0183 $GNGGA & Compute VRS Baseline",
      },
    },
    "/api/v1/simulate/epoch": {
      get: {
        summary: "Simulate Complete 1 Hz GNSS RTK Epoch",
      },
    },
    "/api/v1/stream/{mountpoint}": {
      get: {
        summary: "Live Server-Sent Events (SSE) 1 Hz RTK Stream",
      },
    },
  },
};

export const LLM_TXT_CONTENT = `# AI Kit NTRIP Edge — Agent & MCP Guide (https://ntrip.ai-kit.net)

> Open-source (MIT) NTRIP v1.0/v2.0 Caster, Bit-Level RTCM 3.x Codec (CRC-24Q), NMEA-0183 GGA VRS Router, NTRIP Specification Validator, and Model Context Protocol (MCP) Server on Cloudflare Workers.
> Repository: https://github.com/AIKitLLC/ntrip-edge
> Live Playground: https://ntrip.ai-kit.net
> MCP Endpoint (Streamable HTTP JSON-RPC 2.0): https://ntrip.ai-kit.net/mcp

---

## 1. Mandatory Policy for AI Agents Creating NTRIP Configurations

To create or register a new NTRIP Mountpoint / Server Configuration (either via MCP tool \`create_ntrip_config\` or REST \`POST /api/v1/configs\`), two strict gates are enforced:

1. **ICP Internet Identity (ICP II) Authentication Required**:
   - You MUST first obtain a challenge via \`icp_ii_auth_challenge\` (or \`GET /api/v1/auth/icp-ii/challenge\`), sign/verify with an Internet Computer (ICP) session public key / delegation via \`icp_ii_auth_verify\` (or \`POST /api/v1/auth/icp-ii/verify\`), and pass the resulting \`icp_ii_...\` bearer token as \`icpSessionToken\` (or \`Authorization: Bearer icp_ii_...\`).
   - The ICP Principal is validated against IEEE 802.3 CRC-32 + RFC 4648 Base32 canonical encoding, and anonymous principals (\`2vxsx-fae\`) are rejected.

2. **NTRIP v2.0 (RTCM 10410.1) & RTCM 3.x (RTCM 10403.3) Specification Validation Required**:
   - Every candidate configuration is validated against 8+ mandatory specification gates before registration:
     - \`MOUNTPOINT_SYNTAX\`: 1..32 ASCII chars (\`^[A-Za-z0-9._-]{1,32}$\`), no spaces or semicolons.
     - \`STATION_ID_12BIT\`: 12-bit unsigned integer \`[0..4095]\` (RTCM DF003).
     - \`COUNTRY_ISO3\`: 3-letter uppercase ISO 3166-1 alpha-3 code (e.g. \`VNM\`, \`USA\`, \`DEU\`, \`JPN\`).
     - \`WGS84_COORDINATES\`: Valid terrestrial WGS-84 \`latDeg\` (\`-90..90\`), \`lonDeg\` (\`-180..180\`), \`heightM\` (\`-1000..15000\`), non-Null-Island.
     - \`RTCM_SCHEDULE_SPECS\`: Schedule must include Stationary ARP (\`1005\` or \`1006\`) and at least one GNSS observable message (\`1074..1127\` or \`1004/1012\`).
     - \`STR_19_FIELD_SERIALIZATION\`: Serializes into an exact 19-field \`STR;...\` Sourcetable record and round-trips through the parser with 0 warnings.
     - \`RTCM3_CRC24Q_INTEGRITY\`: All binary RTCM 3.x frames start with \`0xD3\` and pass 24-bit Qualcomm \`CRC-24Q\` (\`0x1864CFB\`) verification.
     - \`ARP_ECEF_WGS84_CONSISTENCY\`: Decoded MT 1005/1006 38-bit ECEF coordinates match declared WGS-84 coordinates within 50 m and matching Station ID.
     - \`UPSTREAM_NTRIP_HANDSHAKE\` (when \`upstreamUrl\` is provided): Live HTTP \`Ntrip-Version: Ntrip/2.0\` handshake and stream check.

---

## 2. Step-by-Step Workflow for AI Agents (MCP or REST)

### Step A — Authenticate with ICP Internet Identity (ICP II)
\`\`\`bash
# 1. Request ICP II Challenge
curl -s https://ntrip.ai-kit.net/api/v1/auth/icp-ii/challenge

# 2. Verify ICP II Session Key / Delegation to receive icp_ii_... token
curl -s -X POST https://ntrip.ai-kit.net/api/v1/auth/icp-ii/verify \\
  -H "Content-Type: application/json" \\
  -d '{
    "challengeToken": "<CHALLENGE_TOKEN_FROM_STEP_1>",
    "publicKeyHex": "302a300506032b6570032100e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
  }'
\`\`\`

### Step B — Validate Candidate NTRIP Server Against RTCM / NTRIP Specs
\`\`\`bash
curl -s -X POST https://ntrip.ai-kit.net/api/v1/ntrip/validate \\
  -H "Content-Type: application/json" \\
  -d '{
    "mountpoint": "DANANG-VN",
    "stationId": 1008,
    "identifier": "Da Nang Coastal CORS Base",
    "city": "Da Nang",
    "country": "VNM",
    "latDeg": 16.054407,
    "lonDeg": 108.202167,
    "heightM": 15.6,
    "formatDetails": "1005(5),1033(10),1077(1),1087(1),1097(1),1127(1),1230(5)",
    "upstreamUrl": "https://ntrip.ai-kit.net/sourcetable"
  }'
\`\`\`

### Step C — Create & Register the Validated NTRIP Config (Requires ICP II Token)
\`\`\`bash
curl -s -X POST https://ntrip.ai-kit.net/api/v1/configs \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer <ICP_II_SESSION_TOKEN>" \\
  -d '{
    "mountpoint": "DANANG-VN",
    "stationId": 1008,
    "identifier": "Da Nang Coastal CORS Base",
    "city": "Da Nang",
    "country": "VNM",
    "latDeg": 16.054407,
    "lonDeg": 108.202167,
    "heightM": 15.6,
    "formatDetails": "1005(5),1033(10),1077(1),1087(1),1097(1),1127(1),1230(5)"
  }'
\`\`\`

---

## 3. Model Context Protocol (MCP) JSON-RPC 2.0 Usage (\`POST /mcp\`)

Connect any MCP client to \`https://ntrip.ai-kit.net/mcp\`. Available tools:
${MCP_TOOLS.map((t) => `- \`${t.name}\`: ${t.description}`).join("\n")}

Example MCP \`tools/call\` request:
\`\`\`bash
curl -s -X POST https://ntrip.ai-kit.net/mcp \\
  -H "Content-Type: application/json" \\
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "validate_ntrip_server",
      "arguments": {
        "mountpoint": "DANANG-VN",
        "stationId": 1008,
        "identifier": "Da Nang Coastal CORS",
        "city": "Da Nang",
        "country": "VNM",
        "latDeg": 16.054407,
        "lonDeg": 108.202167,
        "heightM": 15.6
      }
    }
  }'
\`\`\`
`;

openapiRouter.get("/openapi.json", (c) => c.json(OPENAPI_SPEC));
openapiRouter.get("/llm.txt", (c) => c.text(LLM_TXT_CONTENT));
openapiRouter.get("/llms.txt", (c) => c.text(LLM_TXT_CONTENT));
