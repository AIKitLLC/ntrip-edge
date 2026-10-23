/**
 * Protocol Extension Guide & REST API Documentation Page (`/docs`).
 */

import { renderPage, type PageInfo } from "./layout";

export function renderDocsPage(info: PageInfo): string {
  const body = `
  <section class="hero">
    <div class="eyebrow">Protocol Specification &amp; API Reference</div>
    <h1>NTRIP v2.0 &amp; RTCM 3.x Open Extension Architecture</h1>
    <p class="lead">
      How to implement, extend, and interoperate with NTRIP v1.0/v2.0 and RTCM 10403.x cleanly under the MIT License without breaking legacy GNSS receivers.
    </p>
  </section>

  <section class="block">
    <h2>1. Direct NTRIP v2.0 Caster Endpoints</h2>
    <ul class="ep">
      <li><span class="verb">GET</span><code>/sourcetable</code><span class="d">Returns standard <code>gnss/sourcetable</code> with STR, CAS, NET records and ENDSOURCETABLE.</span></li>
      <li><span class="verb">GET</span><code>/:mountpoint</code><span class="d">Streams binary <code>gnss/data</code> (RTCM 3.3 frames) for <code>HAN0-VN</code>, <code>SGN0-VN</code>, <code>SFO0-US</code>, <code>FFMJ-DE</code>, <code>TYO0-JP</code>, or <code>VRS-AUTO</code>.</span></li>
      <li><span class="verb">POST</span><code>/:mountpoint</code><span class="d">NTRIP v2.0 Server ingest test: accepts binary RTCM 3.x bytes and verifies CRC-24Q on every frame.</span></li>
    </ul>
  </section>

  <section class="block">
    <h2>2. JSON &amp; Real-Time Streaming API (<code>/api/v1</code>)</h2>
    <ul class="ep">
      <li><span class="verb">GET</span><code>/api/v1/sourcetable?lat=&amp;lon=</code><span class="d">Parsed JSON Sourcetable + automatic Haversine nearest-base &amp; VRS routing.</span></li>
      <li><span class="verb">POST</span><code>/api/v1/sourcetable/parse</code><span class="d">Validates and parses custom NTRIP Sourcetable text into typed STR/CAS/NET objects.</span></li>
      <li><span class="verb">POST</span><code>/api/v1/rtcm/decode</code><span class="d">Decodes Hex or Base64 RTCM 3.x streams, verifies 24-bit Qualcomm CRC-24Q, and unpacks bitfields.</span></li>
      <li><span class="verb">POST</span><code>/api/v1/rtcm/encode</code><span class="d">Encodes RTCM 1005, 1006, 1033, 1230, or 4072 binary frames from WGS-84 coordinates.</span></li>
      <li><span class="verb">POST</span><code>/api/v1/nmea/gga</code><span class="d">Parses or generates NMEA-0183 <code>$GNGGA</code> sentences and computes ENU baseline vectors.</span></li>
      <li><span class="verb">GET</span><code>/api/v1/simulate/epoch</code><span class="d">Synthesizes a complete 1 Hz GNSS RTK epoch (RTCM3 binary + Rover GGA + convergence metrics).</span></li>
      <li><span class="verb">GET</span><code>/api/v1/stream/:mountpoint</code><span class="d">Server-Sent Events (SSE) stream emitting real-time 1 Hz RTK epochs.</span></li>
    </ul>
  </section>

  <section class="block">
    <h2>3. How This Project Extends NTRIP Safely (Backward-Compatible)</h2>
    <div class="cards">
      <div class="card">
        <h3>HTTP/1.1 &amp; HTTP/2 Headers</h3>
        <p>Standard GNSS rovers send <code>Ntrip-Version: Ntrip/2.0</code> and <code>Ntrip-GGA: $GNGGA...</code>. Custom edge extensions use <code>X-Ntrip-*</code> headers, which legacy receivers safely ignore.</p>
      </div>
      <div class="card">
        <h3>RTCM 4072 Extension Frame</h3>
        <p>Custom JSON/binary telemetry is wrapped inside a valid <code>0xD3</code> + <code>CRC-24Q</code> RTCM 3.x frame (Message 4072), allowing standard NTRIP casters and muxers to forward it transparently.</p>
      </div>
      <div class="card">
        <h3>Sourcetable <code>misc</code> Field</h3>
        <p>Additional capabilities (e.g. <code>ext=vrs,4072;open-mit</code>) are placed in the 19th field (<code>misc</code>) of <code>STR</code> records, preserving strict semicolon field indexing for RTKLIB and u-blox parsers.</p>
      </div>
    </div>
  </section>
  `;

  return renderPage(info, {
    title: "Protocol & API Docs — AI Kit NTRIP Edge",
    description: "API reference and protocol extension guide for AI Kit NTRIP Edge (NTRIP v2.0, RTCM 3.x, NMEA-0183 GGA).",
    body,
  });
}
