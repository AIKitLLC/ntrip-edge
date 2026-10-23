# AI Kit NTRIP Edge (`ntrip-edge`)

[![License: MIT](https://img.shields.io/badge/License-MIT-0369a1.svg)](./LICENSE)
[![Protocol: NTRIP v2.0](https://img.shields.io/badge/NTRIP-v1.0%20%2F%20v2.0-15803d.svg)](https://ntrip.ai-kit.net)
[![Codec: RTCM 3.3](https://img.shields.io/badge/RTCM-10403.3%20(CRC--24Q)-0f172a.svg)](https://ntrip.ai-kit.net/#inspector)
[![MCP: JSON-RPC 2.0](https://img.shields.io/badge/MCP-Streamable%20HTTP%20%2B%20ICP%20II-38bdf8.svg)](https://ntrip.ai-kit.net/mcp)

> **Live Edge Caster & Interactive Playground:** [https://ntrip.ai-kit.net](https://ntrip.ai-kit.net) (Mirror: [https://ntrip-edge.tuannx87.workers.dev](https://ntrip-edge.tuannx87.workers.dev))
> **AI Agent Guide (`llm.txt`):** [https://ntrip.ai-kit.net/llm.txt](https://ntrip.ai-kit.net/llm.txt) · [https://ntrip.ai-kit.net/llms.txt](https://ntrip.ai-kit.net/llms.txt)
> **Model Context Protocol (MCP) Server:** [https://ntrip.ai-kit.net/mcp](https://ntrip.ai-kit.net/mcp)
> **OpenAPI 3.1.0 Specification:** [https://ntrip.ai-kit.net/openapi.json](https://ntrip.ai-kit.net/openapi.json)

A clean-room, open-source (**MIT License**) implementation of the **NTRIP v1.0 / v2.0** (Networked Transport of RTCM via Internet Protocol) Caster, bit-level **RTCM 3.x** encoder/decoder with 24-bit Qualcomm **CRC-24Q**, **NMEA-0183 `$GNGGA`** Virtual Reference Station (VRS) router, **NTRIP Specification Validator**, and **Model Context Protocol (MCP)** server with **ICP Internet Identity (II)** authentication on **Cloudflare Workers**.

---

## Features

1. **Proactive NTRIP Config Builder, Spec Validator & ICP Internet Identity (II) Auth (`/#builder`, `/mcp`, `/api/v1/configs`)**
   - Users and AI Agents can proactively create custom NTRIP Mountpoints and Base Stations (custom Mountpoint name, 12-bit Station ID, ISO-3 Country, WGS-84 Latitude/Longitude/Height, RTCM message schedule, Antenna/Receiver descriptors, bitrate, VRS mode, and optional live upstream URL probe).
   - **Mandatory ICP Internet Identity (II) Gate:** Creating a new NTRIP configuration (`POST /api/v1/configs` or MCP tool `create_ntrip_config`) requires an `icp_ii_...` bearer token obtained via **ICP Internet Identity** challenge-sign (`/api/v1/auth/icp-ii/challenge` + `/api/v1/auth/icp-ii/verify`), verifying IEEE 802.3 CRC-32 + RFC 4648 Base32 canonical ICP Principals and rejecting anonymous principals (`2vxsx-fae`).
   - **Mandatory RTCM 10410.1 / 10403.3 Spec Compliance Gate:** Validates 9 technical specification gates (`MOUNTPOINT_SYNTAX`, `STATION_ID_12BIT`, `COUNTRY_ISO3`, `WGS84_COORDINATES`, `RTCM_SCHEDULE_SPECS`, `STR_19_FIELD_SERIALIZATION`, `RTCM3_CRC24Q_INTEGRITY`, `ARP_ECEF_WGS84_CONSISTENCY`, and optional `UPSTREAM_NTRIP_HANDSHAKE`) before registering the mountpoint live into the Caster and Sourcetable.
2. **Model Context Protocol (MCP) Server (`POST /mcp` & `GET /llm.txt`)**
   - JSON-RPC 2.0 Streamable HTTP MCP server exposing 6 tools:
     - `icp_ii_auth_challenge` & `icp_ii_auth_verify`
     - `validate_ntrip_server`
     - `create_ntrip_config` *(requires ICP II token + 100% spec validation)*
     - `simulate_rtk_epoch`
     - `decode_rtcm3_stream`
3. **Standards-Compliant NTRIP v2.0 Edge Caster (`/sourcetable`, `/:mountpoint`)**
   - Responds with `gnss/sourcetable` (`STR`, `CAS`, `NET` records + `ENDSOURCETABLE`) when queried at `/sourcetable` or `GET /` with `Ntrip-Version: Ntrip/2.0`.
   - Streams binary `gnss/data` packets across default global CORS/VRS mountpoints (`HAN0-VN`, `SGN0-VN`, `SFO0-US`, `FFMJ-DE`, `TYO0-JP`, `VRS-AUTO`) plus any custom user/agent-registered mountpoints.
4. **Bit-Exact RTCM 3.x Frame Codec (`src/protocol/rtcm3.ts` & `src/protocol/crc24q.ts`)**
   - Full `0xD3` preamble + 6-bit reserved + 10-bit length + payload + 24-bit Qualcomm `CRC-24Q` (`0x1864CFB`) framing for **MT 1005, 1006, 1033, 1077/1087/1097/1127 (MSM7), 1230, and 4072**.

---

## Quick Start (CLI, REST & MCP)

### 1. Validate a Candidate NTRIP Server Against RTCM / NTRIP Specs
```bash
curl -s -X POST https://ntrip.ai-kit.net/api/v1/ntrip/validate \
  -H "Content-Type: application/json" \
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
  }' | jq .
```

### 2. Call the MCP Server (`POST /mcp`)
```bash
curl -s -X POST https://ntrip.ai-kit.net/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | jq .
```

### 3. Fetch the NTRIP v2.0 Sourcetable
```bash
curl -i -H "Ntrip-Version: Ntrip/2.0" https://ntrip.ai-kit.net/sourcetable
```

---

## Local Development & Deployment

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm dev
pnpm deploy
```

---

## Project Structure

| Path | Description |
| :--- | :--- |
| `src/protocol/icp-ii.ts` | ICP Internet Identity (II) CRC-32 + Base32 Principal encoding, challenge & WebCrypto verification |
| `src/protocol/validator.ts` | RTCM 10410.1 (NTRIP v2.0) & RTCM 10403.3 (RTCM 3.x) specification compliance validator & registry |
| `src/protocol/crc24q.ts` | 24-bit Qualcomm CRC-24Q (`0x1864CFB`) lookup table & hex/base64 codecs |
| `src/protocol/coordinates.ts` | WGS-84 Geodetic ↔ ECEF transformations & local ENU baseline vectors |
| `src/protocol/rtcm3.ts` | Bit-level RTCM 3.x frame encoder & stream decoder (`1005`, `1006`, `1033`, `MSM7`, `1230`, `4072`) |
| `src/protocol/nmea.ts` | NMEA-0183 `$GPGGA` / `$GNGGA` parser, XOR checksum verifier & generator |
| `src/protocol/sourcetable.ts` | NTRIP Sourcetable (`STR`, `CAS`, `NET`) serializer, parser & validator |
| `src/protocol/simulator.ts` | Multi-GNSS RTK convergence simulator & CORS/VRS station catalog |
| `src/routes/mcp.ts` | Model Context Protocol (MCP) JSON-RPC 2.0 Streamable HTTP server (`/mcp`) |
| `src/routes/caster.ts` | Direct NTRIP v2.0 Caster routes (`/sourcetable`, `GET /:mountpoint`, `POST /:mountpoint`) |
| `src/routes/api.ts` | REST, ICP II Auth, Spec Validation & SSE Streaming API (`/api/v1/*`) |
| `src/routes/landing/` | Interactive Web Playground & Protocol Docs UI |

---

## License

MIT License — Copyright (c) 2026 [AI Kit LLC](https://github.com/AIKitLLC).
