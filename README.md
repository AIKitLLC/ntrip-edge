# AI Kit NTRIP Edge (`ntrip-edge`)

[![License: MIT](https://img.shields.io/badge/License-MIT-0369a1.svg)](./LICENSE)
[![Protocol: NTRIP v2.0](https://img.shields.io/badge/NTRIP-v1.0%20%2F%20v2.0-15803d.svg)](https://ntrip.ai-kit.net)
[![Codec: RTCM 3.3](https://img.shields.io/badge/RTCM-10403.3%20(CRC--24Q)-0f172a.svg)](https://ntrip.ai-kit.net/#inspector)

> **Live Edge Caster & Interactive Playground:** [https://ntrip.ai-kit.net](https://ntrip.ai-kit.net) (Mirror: [https://ntrip-edge.tuannx87.workers.dev](https://ntrip-edge.tuannx87.workers.dev))
> **OpenAPI Specification:** [https://ntrip.ai-kit.net/openapi.json](https://ntrip.ai-kit.net/openapi.json)
> **LLM Context:** [https://ntrip.ai-kit.net/llms.txt](https://ntrip.ai-kit.net/llms.txt)

A clean-room, open-source (**MIT License**) implementation of the **NTRIP v1.0 / v2.0** (Networked Transport of RTCM via Internet Protocol) Caster, bit-level **RTCM 3.x** encoder/decoder with 24-bit Qualcomm **CRC-24Q**, **NMEA-0183 `$GNGGA`** Virtual Reference Station (VRS) router, and **GNSS RTK** convergence simulator running globally on **Cloudflare Workers**.

---

## Features

1. **Standards-Compliant NTRIP v2.0 Edge Caster (`/sourcetable`, `/:mountpoint`)**
   - Responds with `gnss/sourcetable` (`STR`, `CAS`, `NET` records + `ENDSOURCETABLE`) when queried at `/sourcetable` or `GET /` with `Ntrip-Version: Ntrip/2.0`.
   - Streams binary `gnss/data` packets containing bit-valid RTCM 3.x frames across 6 pre-configured global CORS & VRS mountpoints:
     - `HAN0-VN` — Hanoi CORS Base (`21.028511°N, 105.804817°E`)
     - `SGN0-VN` — Ho Chi Minh City CORS Base (`10.776889°N, 106.700806°E`)
     - `SFO0-US` — San Francisco Bay CORS (`37.774929°N, -122.419416°E`)
     - `FFMJ-DE` — Frankfurt Main Reference (`50.090556°N, 8.664722°E`)
     - `TYO0-JP` — Tokyo Bay GEONET Sim (`35.676192°N, 139.650311°E`)
     - `VRS-AUTO` — Dynamic Virtual Reference Station (locks onto client `Ntrip-GGA` header or `?gga=` query).
2. **Bit-Exact RTCM 3.x Frame Codec (`src/protocol/rtcm3.ts` & `src/protocol/crc24q.ts`)**
   - Full `0xD3` preamble + 6-bit reserved + 10-bit length + payload + 24-bit Qualcomm `CRC-24Q` (`0x1864CFB`) framing.
   - Encodes and decodes:
     - **MT 1005**: Stationary RTK Reference Station ARP (38-bit signed ECEF X/Y/Z in `0.0001 m` resolution).
     - **MT 1006**: Stationary RTK Reference Station ARP with Antenna Height.
     - **MT 1033**: Receiver and Antenna Descriptors.
     - **MT 1077 / 1087 / 1097 / 1127 (MSM7)**: Multi-Signal Messages for GPS, GLONASS, Galileo, and BeiDou (satellite masks, signal masks, rough ranges, and C/N0 dB-Hz).
     - **MT 1230**: GLONASS L1 and L2 Code-Phase Biases.
     - **MT 4072**: Open Extension Frame (`AIKIT` vendor tag) demonstrating how to embed custom JSON/telemetry inside a CRC-24Q-protected RTCM 3.x stream without breaking legacy NTRIP casters or clients.
3. **WGS-84 Geodetic ↔ ECEF & Local ENU Baseline Geometry (`src/protocol/coordinates.ts`)**
   - Sub-millimeter round-trip conversion between WGS-84 `(latDeg, lonDeg, heightM)` and ECEF `(xM, yM, zM)` using Bowring's method.
   - East-North-Up (ENU) baseline vector and Haversine nearest-base routing.
4. **Interactive Web Playground (`/` and `/docs`)**
   - Zero-dependency, dark/light responsive UI with strict CSP nonce security headers.
   - Stream live 1 Hz RTK epochs over Server-Sent Events (SSE), inspect or encode custom RTCM 3.x frames in hexadecimal/base64, and test NMEA `$GNGGA` sentences.

---

## Quick Start (Connect with `curl` or RTKLIB)

### 1. Fetch the NTRIP v2.0 Sourcetable
```bash
curl -i -H "Ntrip-Version: Ntrip/2.0" https://ntrip.ai-kit.net/sourcetable
```

### 2. Stream Binary RTCM 3.x Frames from a Mountpoint
```bash
curl -s -H "Ntrip-Version: Ntrip/2.0" \
  -H 'Ntrip-GGA: $GNGGA,180000.00,2101.7107,N,10548.2890,E,4,24,0.58,52.200,M,-27.400,M,0.8,1001*7E' \
  "https://ntrip.ai-kit.net/VRS-AUTO?epochs=2" | xxd | head -n 15
```

### 3. Decode Any RTCM 3.x Hex/Base64 Payload via REST API
```bash
curl -s -X POST https://ntrip.ai-kit.net/api/v1/rtcm/decode \
  -H "Content-Type: application/json" \
  -d '{"payload":"D300133ED7D30202980EDEEF34B4BD62AC0941986F33360B98","encoding":"hex"}' | jq .
```

### 4. Encode a Custom RTCM 1005 Reference Station ARP Frame
```bash
curl -s -X POST https://ntrip.ai-kit.net/api/v1/rtcm/encode \
  -H "Content-Type: application/json" \
  -d '{"messageNumber":1005,"stationId":1001,"latDeg":21.028511,"lonDeg":105.804817,"heightM":24.8}' | jq .
```

---

## Local Development & Deployment

```bash
# Install dependencies
pnpm install

# Run strict TypeScript typecheck
pnpm typecheck

# Run unit & integration test suite (Vitest)
pnpm test

# Start local Cloudflare Worker dev server
pnpm dev

# Deploy to Cloudflare Workers production
pnpm deploy
```

---

## Project Structure

| Path | Description |
| :--- | :--- |
| `src/protocol/crc24q.ts` | 24-bit Qualcomm CRC-24Q (`0x1864CFB`) lookup table & hex/base64 codecs |
| `src/protocol/coordinates.ts` | WGS-84 Geodetic ↔ ECEF transformations & local ENU baseline vectors |
| `src/protocol/rtcm3.ts` | Bit-level RTCM 3.x frame encoder & stream decoder (`1005`, `1006`, `1033`, `MSM7`, `1230`, `4072`) |
| `src/protocol/nmea.ts` | NMEA-0183 `$GPGGA` / `$GNGGA` parser, XOR checksum verifier & generator |
| `src/protocol/sourcetable.ts` | NTRIP Sourcetable (`STR`, `CAS`, `NET`) serializer, parser & validator |
| `src/protocol/simulator.ts` | Multi-GNSS RTK convergence simulator & CORS/VRS station catalog |
| `src/routes/caster.ts` | Direct NTRIP v2.0 Caster routes (`/sourcetable`, `GET /:mountpoint`, `POST /:mountpoint`) |
| `src/routes/api.ts` | REST & SSE Streaming API (`/api/v1/*`) |
| `src/routes/landing/` | Interactive Web Playground & Protocol Docs UI |

---

## License

MIT License — Copyright (c) 2026 [AI Kit LLC](https://github.com/AIKitLLC).
