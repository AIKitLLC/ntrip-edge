import { Hono } from "hono";
import type { Env } from "../types/env";
import { MCP_TOOLS } from "./mcp";

export const openapiRouter = new Hono<{ Bindings: Env }>();

export const OPENAPI_SPEC = {
  openapi: "3.1.0",
  info: {
    title: "AI Kit NTRIP Edge — Rev 1 & Rev 2 Caster, RTCM 3.x Codec, GNSS RTK Simulator & MCP Server API",
    version: "1.2.0",
    description:
      "Open-source (MIT) NTRIP Rev 1 (v1.0 — RTCM 10410.0) & Rev 2 (v2.0 — RTCM 10410.1) Edge Caster, bit-level RTCM 3.x encoder/decoder (CRC-24Q), NMEA-0183 GGA VRS router, NTRIP Server Spec Validator, and Model Context Protocol (MCP) server with ICP Internet Identity (II) authentication.",
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
      },
      post: {
        summary: "MCP JSON-RPC 2.0 Streamable HTTP Endpoint",
      },
    },
    "/rev1/sourcetable": {
      get: {
        summary: "Dedicated NTRIP Rev 1 (v1.0 — RTCM 10410.0) Sourcetable",
        description: "Returns Sourcetable with Rev 1 framing (SOURCETABLE 200 OK / text/plain). Pass ?wire=true for raw status line preamble.",
      },
    },
    "/rev1/{mountpoint}": {
      get: {
        summary: "Dedicated NTRIP Rev 1 (v1.0 — ICY 200 OK) Mountpoint Stream",
        description: "Streams raw unchunked RTCM 3.x binary bytes (ICY 200 OK framing when ?wire=true).",
      },
      post: {
        summary: "Dedicated NTRIP Rev 1 Server Ingest ('SOURCE <password> /<mountpoint>')",
        description: "Parses NTRIP Rev 1 SOURCE command preamble + raw binary RTCM 3.x frames and verifies CRC-24Q.",
      },
    },
    "/rev2/sourcetable": {
      get: {
        summary: "Dedicated NTRIP Rev 2 (v2.0 — RTCM 10410.1) Sourcetable",
        description: "Returns HTTP/1.1 200 OK with Ntrip-Version: Ntrip/2.0 and Content-Type: gnss/sourcetable.",
      },
    },
    "/rev2/{mountpoint}": {
      get: {
        summary: "Dedicated NTRIP Rev 2 (v2.0 — HTTP/1.1 gnss/data) Mountpoint Stream",
        description: "Streams HTTP/1.1 chunked binary RTCM 3.x frames with Content-Type: gnss/data and Ntrip-Version: Ntrip/2.0.",
      },
      post: {
        summary: "Dedicated NTRIP Rev 2 Server Ingest ('POST /<mountpoint> HTTP/1.1')",
        description: "Accepts HTTP/1.1 chunked RTCM 3.x frames and verifies CRC-24Q.",
      },
    },
    "/api/v1/ntrip/revisions": {
      get: {
        summary: "Compare NTRIP Rev 1 (v1.0) vs Rev 2 (v2.0) Wire Transcripts & Specs",
      },
    },
    "/api/v1/auth/icp-ii/challenge": {
      get: { summary: "Request ICP Internet Identity (II) Authentication Challenge" },
      post: { summary: "Request ICP Internet Identity (II) Authentication Challenge" },
    },
    "/api/v1/auth/icp-ii/verify": {
      post: { summary: "Verify ICP Internet Identity Signature/Delegation & Issue Session Token" },
    },
    "/api/v1/ntrip/validate": {
      post: { summary: "Validate Candidate NTRIP Rev 1 / Rev 2 / Dual Server Config Against Specs" },
    },
    "/api/v1/configs": {
      get: { summary: "List Active & Custom Registered NTRIP Configurations" },
      post: { summary: "Create New NTRIP Configuration (Requires ICP II Auth + Spec Compliance)" },
    },
  },
};

export const LLM_TXT_CONTENT = `# AI Kit NTRIP Edge — Agent & MCP Guide (https://ntrip.ai-kit.net)

> Open-source (MIT) NTRIP Rev 1 (v1.0) & Rev 2 (v2.0) Caster, Bit-Level RTCM 3.x Codec (CRC-24Q), NMEA-0183 GGA VRS Router, NTRIP Specification Validator, and Model Context Protocol (MCP) Server on Cloudflare Workers.
> Repository: https://github.com/AIKitLLC/ntrip-edge
> Live Playground: https://ntrip.ai-kit.net
> MCP Endpoint (Streamable HTTP JSON-RPC 2.0): https://ntrip.ai-kit.net/mcp

---

## 1. Distinct Support for NTRIP Rev 1 (v1.0) vs NTRIP Rev 2 (v2.0) Servers

This Edge Caster and Validator supports both **NTRIP Revision 1 (\`rev1\` — RTCM 10410.0)**, **NTRIP Revision 2 (\`rev2\` — RTCM 10410.1)**, and **Dual-Stack (\`dual\`)** servers:

| Feature | NTRIP Rev 1 (\`rev1\` — RTCM 10410.0) | NTRIP Rev 2 (\`rev2\` — RTCM 10410.1) |
| :--- | :--- | :--- |
| **Dedicated Endpoints** | \`/rev1/sourcetable\`, \`/rev1/:mountpoint\` | \`/rev2/sourcetable\`, \`/rev2/:mountpoint\` |
| **Transport Framing** | HTTP/1.0-style non-standard status lines | Strict HTTP/1.1 (\`Transfer-Encoding: chunked\`) |
| **Sourcetable Status & MIME** | \`SOURCETABLE 200 OK\` / \`text/plain\` | \`HTTP/1.1 200 OK\` / \`gnss/sourcetable\` + \`Ntrip-Version: Ntrip/2.0\` |
| **Stream Status & MIME** | \`ICY 200 OK\` / raw unchunked bytes | \`HTTP/1.1 200 OK\` / \`gnss/data\` + \`Ntrip-Version: Ntrip/2.0\` |
| **Base Server Ingest** | \`SOURCE <password> /<mountpoint>\\r\\nSource-Agent: NTRIP ...\` | \`POST /<mountpoint> HTTP/1.1\\r\\nNtrip-Version: Ntrip/2.0\` |
| **Rover NMEA GGA** | Sent inline in TCP stream after request headers | Sent via \`Ntrip-GGA: $GNGGA...\` HTTP header (or inline) |

* **Strict Revision Enforcement:** If you create a custom NTRIP configuration with \`"ntripRevision": "rev1"\`, it will accept Rev 1 connections (\`/rev1/:mountpoint\` or \`?rev=rev1\`) and reject Rev 2 connections with \`400 NTRIP_REVISION_MISMATCH\`. Conversely, \`"ntripRevision": "rev2"\` rejects Rev 1 requests. Choosing \`"ntripRevision": "dual"\` serves both protocols simultaneously.

---

## 2. Mandatory Policy for AI Agents Creating NTRIP Configurations

To create or register a new NTRIP Mountpoint / Server Configuration (either via MCP tool \`create_ntrip_config\` or REST \`POST /api/v1/configs\`), two strict gates are enforced:

1. **ICP Internet Identity (ICP II) Authentication Required**:
   - Obtain a challenge via \`icp_ii_auth_challenge\` (or \`GET /api/v1/auth/icp-ii/challenge\`), sign/verify with an Internet Computer (ICP) session public key / delegation via \`icp_ii_auth_verify\` (or \`POST /api/v1/auth/icp-ii/verify\`), and pass the resulting \`icp_ii_...\` bearer token as \`icpSessionToken\` (or \`Authorization: Bearer icp_ii_...\`).
   - The ICP Principal is validated against IEEE 802.3 CRC-32 + RFC 4648 Base32 canonical encoding, and anonymous principals (\`2vxsx-fae\`) are rejected.

2. **NTRIP Rev 1 / Rev 2 & RTCM 3.x Specification Validation Required**:
   - Every candidate configuration is validated against 10 mandatory specification gates before registration:
     - \`MOUNTPOINT_SYNTAX\`, \`STATION_ID_12BIT\`, \`COUNTRY_ISO3\`, \`WGS84_COORDINATES\`, \`RTCM_SCHEDULE_SPECS\`, \`NTRIP_REVISION_PROTOCOL_SPECS\` (verifying Rev 1 \`ICY/SOURCE\` vs Rev 2 \`HTTP/1.1 gnss/data\` wire handshakes), \`STR_19_FIELD_SERIALIZATION\`, \`RTCM3_CRC24Q_INTEGRITY\`, \`ARP_ECEF_WGS84_CONSISTENCY\`, and optional \`UPSTREAM_NTRIP_HANDSHAKE\`.

---

## 3. Step-by-Step Workflow for AI Agents (MCP or REST)

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

### Step B — Validate Candidate NTRIP Rev 1 or Rev 2 Server Against Specs
\`\`\`bash
curl -s -X POST https://ntrip.ai-kit.net/api/v1/ntrip/validate \\
  -H "Content-Type: application/json" \\
  -d '{
    "mountpoint": "DANANG-R1",
    "stationId": 1008,
    "identifier": "Da Nang Rev1 Legacy Base",
    "city": "Da Nang",
    "country": "VNM",
    "latDeg": 16.054407,
    "lonDeg": 108.202167,
    "heightM": 15.6,
    "ntripRevision": "rev1",
    "sourcePassword": "secretSourcePwd",
    "formatDetails": "1005(5),1033(10),1077(1),1087(1),1097(1),1127(1),1230(5)"
  }'
\`\`\`

### Step C — Create & Register the Validated NTRIP Config (Requires ICP II Token)
\`\`\`bash
curl -s -X POST https://ntrip.ai-kit.net/api/v1/configs \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer <ICP_II_SESSION_TOKEN>" \\
  -d '{
    "mountpoint": "DANANG-R1",
    "stationId": 1008,
    "identifier": "Da Nang Rev1 Legacy Base",
    "city": "Da Nang",
    "country": "VNM",
    "latDeg": 16.054407,
    "lonDeg": 108.202167,
    "heightM": 15.6,
    "ntripRevision": "rev1",
    "sourcePassword": "secretSourcePwd",
    "formatDetails": "1005(5),1033(10),1077(1),1087(1),1097(1),1127(1),1230(5)"
  }'
\`\`\`

---

## 4. Model Context Protocol (MCP) JSON-RPC 2.0 Usage (\`POST /mcp\`)

Connect any MCP client to \`https://ntrip.ai-kit.net/mcp\`. Available tools:
${MCP_TOOLS.map((t) => `- \`${t.name}\`: ${t.description}`).join("\n")}
`;

openapiRouter.get("/openapi.json", (c) => c.json(OPENAPI_SPEC));
openapiRouter.get("/llm.txt", (c) => c.text(LLM_TXT_CONTENT));
openapiRouter.get("/llms.txt", (c) => c.text(LLM_TXT_CONTENT));
