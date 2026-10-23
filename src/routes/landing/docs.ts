/**
 * Protocol Extension Guide, MCP Server & REST API Documentation Page (`/docs`).
 */

import { renderPage, type PageInfo } from "./layout";

export function renderDocsPage(info: PageInfo): string {
  const body = `
  <section class="hero">
    <div class="eyebrow">Protocol Specification, MCP Server &amp; ICP II Auth Reference</div>
    <h1>NTRIP v2.0, RTCM 3.x &amp; MCP Agent Architecture</h1>
    <p class="lead">
      Complete guide for human developers and AI Agents (<a href="/llm.txt"><code>/llm.txt</code></a>) on authenticating with <strong>ICP Internet Identity (II)</strong>, validating NTRIP servers against <code>RTCM 10410.1 / 10403.3</code> specs, and registering custom mountpoints via REST or <strong>Model Context Protocol (MCP)</strong>.
    </p>
  </section>

  <section class="block">
    <h2>1. Model Context Protocol (MCP) Server &amp; Agent Guide</h2>
    <ul class="ep">
      <li><span class="verb">GET</span><code>/llm.txt</code><span class="d">Step-by-step AI Agent instructions (also served at <code>/llms.txt</code>) for ICP II login, NTRIP spec validation, and MCP tool calls.</span></li>
      <li><span class="verb">GET</span><code>/mcp</code><span class="d">MCP server discovery manifest &amp; tool JSON Schemas.</span></li>
      <li><span class="verb">POST</span><code>/mcp</code><span class="d">MCP JSON-RPC 2.0 Streamable HTTP endpoint (tools: <code>icp_ii_auth_challenge</code>, <code>icp_ii_auth_verify</code>, <code>validate_ntrip_server</code>, <code>create_ntrip_config</code>, <code>simulate_rtk_epoch</code>, <code>decode_rtcm3_stream</code>).</span></li>
    </ul>
  </section>

  <section class="block">
    <h2>2. ICP Internet Identity (II) &amp; Spec-Validated Config API (<code>/api/v1</code>)</h2>
    <ul class="ep">
      <li><span class="verb">GET</span><code>/api/v1/auth/icp-ii/challenge</code><span class="d">Issues a signed challenge message and token for ICP Internet Identity (II) authentication.</span></li>
      <li><span class="verb">POST</span><code>/api/v1/auth/icp-ii/verify</code><span class="d">Verifies ICP II session public key / signature, validates CRC-32 + Base32 Principal, and returns an <code>icp_ii_...</code> bearer token.</span></li>
      <li><span class="verb">POST</span><code>/api/v1/ntrip/validate</code><span class="d">Validates a candidate NTRIP server / mountpoint config against 9 RTCM 10410.1 &amp; 10403.3 specification gates (including optional live <code>upstreamUrl</code> handshake).</span></li>
      <li><span class="verb">POST</span><code>/api/v1/configs</code><span class="d"><strong>Requires ICP II Bearer Token + 100% Spec Validation:</strong> Creates and registers a live custom NTRIP mountpoint on the Caster.</span></li>
      <li><span class="verb">GET</span><code>/api/v1/configs</code><span class="d">Lists all custom registered NTRIP configurations and active stations.</span></li>
    </ul>
  </section>

  <section class="block">
    <h2>3. Direct NTRIP v2.0 Caster &amp; RTCM 3.x Codec Endpoints</h2>
    <ul class="ep">
      <li><span class="verb">GET</span><code>/sourcetable</code><span class="d">Returns standard <code>gnss/sourcetable</code> with STR, CAS, NET records and ENDSOURCETABLE (includes custom created mountpoints).</span></li>
      <li><span class="verb">GET</span><code>/:mountpoint</code><span class="d">Streams binary <code>gnss/data</code> (RTCM 3.3 frames) for default or custom created mountpoints.</span></li>
      <li><span class="verb">POST</span><code>/:mountpoint</code><span class="d">NTRIP v2.0 Server ingest verifier: accepts binary RTCM 3.x bytes and verifies CRC-24Q on every frame.</span></li>
      <li><span class="verb">POST</span><code>/api/v1/rtcm/decode</code><span class="d">Decodes Hex or Base64 RTCM 3.x streams, verifies 24-bit Qualcomm CRC-24Q, and unpacks bitfields.</span></li>
      <li><span class="verb">POST</span><code>/api/v1/rtcm/encode</code><span class="d">Encodes RTCM 1005, 1006, 1033, 1230, or 4072 binary frames from WGS-84 coordinates.</span></li>
      <li><span class="verb">POST</span><code>/api/v1/nmea/gga</code><span class="d">Parses or generates NMEA-0183 <code>$GNGGA</code> sentences and computes ENU baseline vectors.</span></li>
    </ul>
  </section>
  `;

  return renderPage(info, {
    title: "Protocol, MCP & ICP II Docs — AI Kit NTRIP Edge",
    description: "API reference, MCP server guide, and ICP Internet Identity (II) authentication docs for AI Kit NTRIP Edge.",
    body,
  });
}
