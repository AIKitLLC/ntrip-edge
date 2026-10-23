/**
 * Interactive NTRIP v2.0 Caster, RTCM 3.x Frame Inspector, and GNSS RTK Simulator Playground UI.
 */

import {
  getDefaultSourcetableRecords,
  REFERENCE_STATIONS,
  serializeSourcetable,
  simulateGnssEpoch,
} from "../../protocol";
import { escapeHtml, renderPage, type PageInfo } from "./layout";

const PLAYGROUND_SCRIPT = `
(function () {
  var currentMount = "HAN0-VN";
  var currentEpoch = 4;
  var activeStream = null;

  var mountChips = document.querySelectorAll("[data-mount]");
  var btnStep = document.getElementById("btn-step");
  var btnStream = document.getElementById("btn-stream");
  var fixBadge = document.getElementById("rtk-fix-badge");
  var ratioBadge = document.getElementById("rtk-ratio-badge");
  var crcBadge = document.getElementById("rtk-crc-badge");
  var factMount = document.getElementById("fact-mount");
  var factAcc = document.getElementById("fact-acc");
  var factBaseWgs = document.getElementById("fact-base-wgs");
  var factBaseEcef = document.getElementById("fact-base-ecef");
  var factBaseline = document.getElementById("fact-baseline");
  var factSats = document.getElementById("fact-sats");
  var ggaOutput = document.getElementById("rover-gga-out");
  var framesBody = document.getElementById("frames-tbody");
  var cnrGrid = document.getElementById("cnr-grid");

  var rtcmInput = document.getElementById("rtcm-hex-input");
  var btnDecodeRtcm = document.getElementById("btn-decode-rtcm");
  var rtcmDecodeOut = document.getElementById("rtcm-decode-out");

  var encMsg = document.getElementById("enc-msg");
  var encStn = document.getElementById("enc-stn");
  var encLat = document.getElementById("enc-lat");
  var encLon = document.getElementById("enc-lon");
  var encH = document.getElementById("enc-h");
  var btnEncodeRtcm = document.getElementById("btn-encode-rtcm");

  var ggaInput = document.getElementById("gga-input");
  var btnRouteGga = document.getElementById("btn-route-gga");
  var vrsRouteOut = document.getElementById("vrs-route-out");

  function renderEpoch(ep) {
    if (!ep || !ep.rtk) return;
    var rtk = ep.rtk;
    fixBadge.textContent = rtk.fixState + " (" + rtk.horizontalAccuracyCm + " cm H / " + rtk.verticalAccuracyCm + " cm V)";
    fixBadge.className = "badge " + (rtk.fixState === "RTK_FIXED" ? "ok" : "warn");
    ratioBadge.textContent = "AR Ratio: " + rtk.ambiguityRatio.toFixed(2) + " | TOW: " + rtk.gpsTowMs + " ms";
    crcBadge.textContent = ep.frames.length + " RTCM3 Frames (" + ep.packetLengthBytes + " B) · CRC-24Q OK";

    factMount.textContent = ep.mountpoint + " (ID " + ep.stationId + (ep.isVrs ? " · VRS" : " · CORS") + ")";
    factAcc.textContent = "σH " + rtk.horizontalAccuracyCm + " cm · σV " + rtk.verticalAccuracyCm + " cm";
    factBaseWgs.textContent = ep.baseCoord.latDeg.toFixed(6) + "°, " + ep.baseCoord.lonDeg.toFixed(6) + "° (" + ep.baseCoord.heightM + " m)";
    factBaseEcef.textContent = "X " + ep.baseEcef.xM.toFixed(2) + " · Y " + ep.baseEcef.yM.toFixed(2) + " · Z " + ep.baseEcef.zM.toFixed(2);
    factBaseline.textContent = "E " + rtk.baseline.eastM + "m · N " + rtk.baseline.northM + "m · D " + rtk.baseline.distanceKm + " km";
    factSats.textContent = rtk.trackedSatellites + " Sats (GPS+GLO+GAL+BDS) · HDOP " + rtk.hdop;
    ggaOutput.textContent = rtk.roverGga;

    var rowsHtml = "";
    var allSats = [];
    for (var i = 0; i < ep.frames.length; i++) {
      var f = ep.frames[i];
      var summary = f.messageName;
      if (f.decoded.kind === "RTCM_1005" || f.decoded.kind === "RTCM_1006") {
        summary = "ARP ECEF (" + f.decoded.ecef.xM.toFixed(3) + ", " + f.decoded.ecef.yM.toFixed(3) + ", " + f.decoded.ecef.zM.toFixed(3) + ")";
      } else if (f.decoded.kind === "RTCM_1033") {
        summary = f.decoded.antennaDescriptor + " / " + f.decoded.receiverTypeDescriptor;
      } else if (f.decoded.kind === "RTCM_MSM7") {
        summary = f.decoded.constellation + " MSM7 · " + f.decoded.satellites.length + " sats · TOW " + f.decoded.epochTowMs;
        for (var j = 0; j < f.decoded.satellites.length; j++) {
          var s = f.decoded.satellites[j];
          allSats.push({ label: f.decoded.constellation.slice(0, 1) + (s.prn < 10 ? "0" + s.prn : s.prn), cnr: s.cnrDbHz });
        }
      } else if (f.decoded.kind === "RTCM_4072_EXT") {
        summary = "Vendor=" + f.decoded.vendorTag + " " + f.decoded.telemetryJson;
      }
      var shortHex = f.rawHex.length > 36 ? f.rawHex.slice(0, 32) + "…" + f.rawHex.slice(-6) : f.rawHex;
      rowsHtml += "<tr>" +
        "<td><strong>" + f.messageNumber + "</strong></td>" +
        "<td>" + summary + "</td>" +
        "<td>" + f.totalLengthBytes + " B</td>" +
        "<td><span class='badge ok'>0x" + f.crcActual.toString(16).toUpperCase().padStart(6, "0") + "</span></td>" +
        "<td class='mono'>" + shortHex + " <button type='button' class='chip' data-inspect-hex='" + f.rawHex + "'>Inspect</button></td>" +
        "</tr>";
    }
    framesBody.innerHTML = rowsHtml;

    var inspectBtns = framesBody.querySelectorAll("[data-inspect-hex]");
    for (var k = 0; k < inspectBtns.length; k++) {
      inspectBtns[k].addEventListener("click", function () {
        var hex = this.getAttribute("data-inspect-hex");
        if (hex && rtcmInput) {
          rtcmInput.value = hex;
          decodeRtcmNow();
          document.getElementById("inspector").scrollIntoView({ behavior: "smooth" });
        }
      });
    }

    var cnrHtml = "";
    for (var m = 0; m < Math.min(allSats.length, 24); m++) {
      var sat = allSats[m];
      var pct = Math.max(15, Math.min(100, Math.round(((sat.cnr - 28) / 26) * 100)));
      cnrHtml += "<div class='cnr-cell'><strong>" + sat.label + "</strong><div class='cnr-bar'><div class='cnr-fill' style='width:" + pct + "%'></div></div><span>" + sat.cnr.toFixed(1) + "</span></div>";
    }
    cnrGrid.innerHTML = cnrHtml;
  }

  function fetchEpoch(mount, epochNum) {
    btnStep.disabled = true;
    fetch("/api/v1/simulate/epoch?mountpoint=" + encodeURIComponent(mount) + "&epoch=" + epochNum + "&ext4072=true")
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data && data.epoch) renderEpoch(data.epoch);
      })
      .finally(function () { btnStep.disabled = false; });
  }

  for (var i = 0; i < mountChips.length; i++) {
    mountChips[i].addEventListener("click", function () {
      for (var j = 0; j < mountChips.length; j++) mountChips[j].classList.remove("active");
      this.classList.add("active");
      currentMount = this.getAttribute("data-mount") || "HAN0-VN";
      currentEpoch = 4;
      fetchEpoch(currentMount, currentEpoch);
    });
  }

  if (btnStep) {
    btnStep.addEventListener("click", function () {
      currentEpoch = (currentEpoch + 1) % 20;
      fetchEpoch(currentMount, currentEpoch);
    });
  }

  if (btnStream) {
    btnStream.addEventListener("click", function () {
      if (activeStream) {
        activeStream.close();
        activeStream = null;
        btnStream.textContent = "Stream 1 Hz RTK (SSE)";
        return;
      }
      btnStream.textContent = "Stop Live Stream (6 Epochs…)";
      var es = new EventSource("/api/v1/stream/" + encodeURIComponent(currentMount) + "?epochs=6&intervalMs=550");
      activeStream = es;
      es.addEventListener("epoch", function (ev) {
        try {
          var ep = JSON.parse(ev.data);
          renderEpoch(ep);
        } catch (_e) {}
      });
      es.addEventListener("complete", function () {
        es.close();
        activeStream = null;
        btnStream.textContent = "Stream 1 Hz RTK (SSE)";
      });
      es.onerror = function () {
        es.close();
        activeStream = null;
        btnStream.textContent = "Stream 1 Hz RTK (SSE)";
      };
    });
  }

  function decodeRtcmNow() {
    if (!rtcmInput || !rtcmDecodeOut) return;
    var payload = rtcmInput.value.trim();
    if (!payload) return;
    rtcmDecodeOut.textContent = "Decoding RTCM 3.x frame & verifying CRC-24Q…";
    fetch("/api/v1/rtcm/decode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payload: payload, encoding: "auto" })
    })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        rtcmDecodeOut.textContent = JSON.stringify(res, null, 2);
      })
      .catch(function (err) {
        rtcmDecodeOut.textContent = "Error: " + String(err);
      });
  }

  if (btnDecodeRtcm) {
    btnDecodeRtcm.addEventListener("click", decodeRtcmNow);
  }

  if (btnEncodeRtcm) {
    btnEncodeRtcm.addEventListener("click", function () {
      var body = {
        messageNumber: Number(encMsg.value) || 1005,
        stationId: Number(encStn.value) || 1001,
        latDeg: Number(encLat.value) || 21.028511,
        lonDeg: Number(encLon.value) || 105.804817,
        heightM: Number(encH.value) || 24.8
      };
      fetch("/api/v1/rtcm/encode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      })
        .then(function (r) { return r.json(); })
        .then(function (res) {
          if (res && res.rawHex && rtcmInput) {
            rtcmInput.value = res.rawHex;
          }
          if (rtcmDecodeOut) {
            rtcmDecodeOut.textContent = JSON.stringify(res, null, 2);
          }
        });
    });
  }

  if (btnRouteGga) {
    btnRouteGga.addEventListener("click", function () {
      var gga = ggaInput ? ggaInput.value.trim() : "";
      fetch("/api/v1/nmea/gga", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gga: gga })
      })
        .then(function (r) { return r.json(); })
        .then(function (res) {
          if (vrsRouteOut) vrsRouteOut.textContent = JSON.stringify(res, null, 2);
        });
    });
  }
})();
`;

export function renderPlaygroundPage(info: PageInfo): string {
  const initialEpoch = simulateGnssEpoch({
    mountpoint: "HAN0-VN",
    epochIndex: 4,
    includeExtension4072: true,
  });
  const initialFrame1005 = initialEpoch.frames[0];
  const initialSourcetable = serializeSourcetable(getDefaultSourcetableRecords());

  const mountChipsHtml = REFERENCE_STATIONS.map((s, idx) => {
    const active = idx === 0 ? " active" : "";
    return `<button type="button" class="chip${active}" data-mount="${escapeHtml(s.mountpoint)}">${escapeHtml(s.mountpoint)} (${escapeHtml(s.city)})</button>`;
  }).join("");

  const frameRowsHtml = initialEpoch.frames
    .map((f) => {
      let summary = f.messageName;
      if (f.decoded.kind === "RTCM_1005" || f.decoded.kind === "RTCM_1006") {
        summary = `ARP ECEF (${f.decoded.ecef.xM.toFixed(3)}, ${f.decoded.ecef.yM.toFixed(3)}, ${f.decoded.ecef.zM.toFixed(3)})`;
      } else if (f.decoded.kind === "RTCM_1033") {
        summary = `${f.decoded.antennaDescriptor} / ${f.decoded.receiverTypeDescriptor}`;
      } else if (f.decoded.kind === "RTCM_MSM7") {
        summary = `${f.decoded.constellation} MSM7 · ${f.decoded.satellites.length} sats · TOW ${f.decoded.epochTowMs}`;
      } else if (f.decoded.kind === "RTCM_4072_EXT") {
        summary = `Vendor=${f.decoded.vendorTag} ${f.decoded.telemetryJson}`;
      }
      const shortHex = f.rawHex.length > 36 ? `${f.rawHex.slice(0, 32)}…${f.rawHex.slice(-6)}` : f.rawHex;
      const crcHex = f.crcActual.toString(16).toUpperCase().padStart(6, "0");
      return `<tr>
        <td><strong>${f.messageNumber}</strong></td>
        <td>${escapeHtml(summary)}</td>
        <td>${f.totalLengthBytes} B</td>
        <td><span class="badge ok">0x${crcHex}</span></td>
        <td class="mono">${escapeHtml(shortHex)} <button type="button" class="chip" data-inspect-hex="${escapeHtml(f.rawHex)}">Inspect</button></td>
      </tr>`;
    })
    .join("");

  const initialSats: { label: string; cnr: number }[] = [];
  for (const f of initialEpoch.frames) {
    if (f.decoded.kind === "RTCM_MSM7") {
      const prefix = f.decoded.constellation.slice(0, 1);
      for (const s of f.decoded.satellites) {
        initialSats.push({ label: `${prefix}${s.prn.toString().padStart(2, "0")}`, cnr: s.cnrDbHz });
      }
    }
  }
  const cnrCellsHtml = initialSats
    .slice(0, 24)
    .map((s) => {
      const pct = Math.max(15, Math.min(100, Math.round(((s.cnr - 28) / 26) * 100)));
      return `<div class="cnr-cell"><strong>${escapeHtml(s.label)}</strong><div class="cnr-bar"><div class="cnr-fill" style="width:${pct}%"></div></div><span>${s.cnr.toFixed(1)}</span></div>`;
    })
    .join("");

  const body = `
  <section class="hero">
    <div class="eyebrow">Open-Source GNSS RTK Infrastructure &middot; MIT License</div>
    <h1>NTRIP v2.0 Caster, RTCM 3.x Codec &amp; RTK Simulator at the Edge.</h1>
    <p class="lead">
      Clean-room TypeScript implementation of <code>NTRIP v1.0/v2.0</code>, bit-exact <code>RTCM 10403.3</code> framing with 24-bit Qualcomm <code>CRC-24Q</code>, and <code>NMEA-0183 $GNGGA</code> Virtual Reference Station (VRS) routing — deployed globally on Cloudflare Workers.
    </p>
  </section>

  <!-- 1. LIVE NTRIP CASTER & RTK SIMULATOR -->
  <section id="simulator" class="panel" aria-labelledby="sim-title">
    <div class="panel-head">
      <div>
        <h2 id="sim-title" class="panel-title">1. Live NTRIP v2.0 Mountpoint &amp; RTK Convergence Simulator</h2>
        <div class="chips" role="group" aria-label="Mountpoints">
          <span>Mountpoint:</span>
          ${mountChipsHtml}
        </div>
      </div>
      <div class="row">
        <button type="button" id="btn-step" class="btn ghost">Step Epoch (+1s)</button>
        <button type="button" id="btn-stream" class="btn">Stream 1 Hz RTK (SSE)</button>
      </div>
    </div>

    <div class="badges">
      <span id="rtk-fix-badge" class="badge ok">${escapeHtml(initialEpoch.rtk.fixState)} (${initialEpoch.rtk.horizontalAccuracyCm} cm H / ${initialEpoch.rtk.verticalAccuracyCm} cm V)</span>
      <span id="rtk-ratio-badge" class="badge ok">AR Ratio: ${initialEpoch.rtk.ambiguityRatio.toFixed(2)} | TOW: ${initialEpoch.rtk.gpsTowMs} ms</span>
      <span id="rtk-crc-badge" class="badge ok">${initialEpoch.frames.length} RTCM3 Frames (${initialEpoch.packetLengthBytes} B) &middot; CRC-24Q OK</span>
    </div>

    <dl class="facts">
      <div class="fact"><dt>Active Mountpoint</dt><dd id="fact-mount">${escapeHtml(initialEpoch.mountpoint)} (ID ${initialEpoch.stationId} &middot; CORS)</dd></div>
      <div class="fact"><dt>3D RTK Precision</dt><dd id="fact-acc">&sigma;H ${initialEpoch.rtk.horizontalAccuracyCm} cm &middot; &sigma;V ${initialEpoch.rtk.verticalAccuracyCm} cm</dd></div>
      <div class="fact"><dt>Base ARP (WGS-84)</dt><dd id="fact-base-wgs">${initialEpoch.baseCoord.latDeg.toFixed(6)}&deg;, ${initialEpoch.baseCoord.lonDeg.toFixed(6)}&deg; (${initialEpoch.baseCoord.heightM} m)</dd></div>
      <div class="fact"><dt>Base ARP (ECEF m)</dt><dd id="fact-base-ecef">X ${initialEpoch.baseEcef.xM.toFixed(2)} &middot; Y ${initialEpoch.baseEcef.yM.toFixed(2)} &middot; Z ${initialEpoch.baseEcef.zM.toFixed(2)}</dd></div>
      <div class="fact"><dt>Rover ENU Baseline</dt><dd id="fact-baseline">E ${initialEpoch.rtk.baseline.eastM}m &middot; N ${initialEpoch.rtk.baseline.northM}m &middot; D ${initialEpoch.rtk.baseline.distanceKm} km</dd></div>
      <div class="fact"><dt>Constellations</dt><dd id="fact-sats">${initialEpoch.rtk.trackedSatellites} Sats (GPS+GLO+GAL+BDS) &middot; HDOP ${initialEpoch.rtk.hdop}</dd></div>
    </dl>

    <div>
      <strong style="font-size:0.82rem;text-transform:uppercase;letter-spacing:0.05em;color:var(--muted)">Rover NMEA-0183 Position Report (<code>Ntrip-GGA</code> Header):</strong>
      <pre class="code"><code id="rover-gga-out">${escapeHtml(initialEpoch.rtk.roverGga)}</code></pre>
    </div>

    <div style="margin-top:14px">
      <strong style="font-size:0.82rem;text-transform:uppercase;letter-spacing:0.05em;color:var(--muted)">Multi-GNSS Carrier-to-Noise Density (C/N0 dB-Hz) across L1/E1/B1I:</strong>
      <div id="cnr-grid" class="cnr-grid">${cnrCellsHtml}</div>
    </div>

    <div style="margin-top:16px">
      <strong style="font-size:0.82rem;text-transform:uppercase;letter-spacing:0.05em;color:var(--muted)">Synthesized RTCM 3.x Binary Frames in Epoch:</strong>
      <div class="scroll">
        <table class="attrs">
          <thead>
            <tr>
              <th>Msg</th>
              <th>Decoded Telemetry</th>
              <th>Size</th>
              <th>CRC-24Q</th>
              <th>Binary Frame (Hex)</th>
            </tr>
          </thead>
          <tbody id="frames-tbody">
            ${frameRowsHtml}
          </tbody>
        </table>
      </div>
    </div>
  </section>

  <!-- 2. RTCM 3.x BINARY CODEC & CUSTOM EXTENSION ENCODER -->
  <section id="inspector" class="panel" aria-labelledby="codec-title">
    <div class="panel-head">
      <h2 id="codec-title" class="panel-title">2. RTCM 3.x Bit-Level Frame Inspector &amp; Custom Encoder</h2>
    </div>
    <div class="grid-2">
      <div>
        <label for="rtcm-hex-input" style="font-weight:650;font-size:0.9rem;display:block;margin-bottom:6px">Decode Binary RTCM 3.x Stream (Hex or Base64):</label>
        <textarea id="rtcm-hex-input" class="ta" rows="4" spellcheck="false">${escapeHtml(initialFrame1005?.rawHex ?? "")}</textarea>
        <div class="row" style="margin-top:10px">
          <button type="button" id="btn-decode-rtcm" class="btn">Decode &amp; Verify CRC-24Q</button>
        </div>

        <hr style="border:0;border-top:1px solid var(--border);margin:18px 0">

        <strong style="font-size:0.9rem;display:block;margin-bottom:8px">Encode Custom RTCM 3.x Frame (WGS-84 &rarr; ECEF + CRC-24Q):</strong>
        <div class="row" style="margin-bottom:8px">
          <select id="enc-msg" class="select" aria-label="RTCM Message Type">
            <option value="1005">MT 1005 — Base Station ARP</option>
            <option value="1006">MT 1006 — Base ARP + Antenna Height</option>
            <option value="1033">MT 1033 — Receiver &amp; Antenna Descriptor</option>
            <option value="1230">MT 1230 — GLONASS Code-Phase Biases</option>
            <option value="4072">MT 4072 — Open Extension Frame (AIKIT)</option>
          </select>
          <input id="enc-stn" class="input" type="number" value="1001" style="width:110px" aria-label="Station ID" title="Station ID (0-4095)">
        </div>
        <div class="row" style="margin-bottom:10px">
          <input id="enc-lat" class="input" type="number" step="0.000001" value="21.028511" style="width:135px" aria-label="Latitude">
          <input id="enc-lon" class="input" type="number" step="0.000001" value="105.804817" style="width:135px" aria-label="Longitude">
          <input id="enc-h" class="input" type="number" step="0.1" value="24.8" style="width:105px" aria-label="Height (m)">
          <button type="button" id="btn-encode-rtcm" class="btn ghost">Encode Frame</button>
        </div>
      </div>

      <div>
        <strong style="font-size:0.9rem;display:block;margin-bottom:6px">Decoded Frame &amp; CRC-24Q Verification Output:</strong>
        <pre class="code" style="max-height:330px;margin:0"><code id="rtcm-decode-out">${escapeHtml(JSON.stringify(initialFrame1005 ?? {}, null, 2))}</code></pre>
      </div>
    </div>
  </section>

  <!-- 3. SOURCETABLE & NMEA GGA VRS ROUTER -->
  <section id="sourcetable" class="panel" aria-labelledby="st-title">
    <div class="panel-head">
      <h2 id="st-title" class="panel-title">3. NTRIP Sourcetable (STR / CAS / NET) &amp; NMEA $GNGGA VRS Router</h2>
      <a class="btn ghost" href="/sourcetable">Raw /sourcetable</a>
    </div>
    <div class="grid-2">
      <div>
        <label for="gga-input" style="font-weight:650;font-size:0.9rem;display:block;margin-bottom:6px">Test Rover NMEA-0183 <code>$GNGGA</code> Checksum &amp; Nearest Base Routing:</label>
        <input id="gga-input" class="input" style="width:100%;margin-bottom:10px" value="${escapeHtml(initialEpoch.rtk.roverGga)}">
        <button type="button" id="btn-route-gga" class="btn">Validate GGA &amp; Compute VRS Baseline</button>
        <pre class="code" style="max-height:220px;margin-top:10px"><code id="vrs-route-out">Click "Validate GGA & Compute VRS Baseline" to parse DDMM.MMMM coordinates, verify XOR checksum, and calculate ENU baseline vector.</code></pre>
      </div>
      <div>
        <strong style="font-size:0.9rem;display:block;margin-bottom:6px">Live Edge Caster Sourcetable (<code>GET /sourcetable</code>):</strong>
        <pre class="code" style="max-height:310px;margin:0"><code>${escapeHtml(initialSourcetable)}</code></pre>
      </div>
    </div>
  </section>

  <!-- 4. QUICK CLI & RTKLIB CONNECT -->
  <section class="block">
    <h2>Connect with curl, RTKLIB, or Any NTRIP v2.0 Client</h2>
    <p class="sec-lead">Every mountpoint speaks standard NTRIP v2.0 over HTTPS/HTTP and also exposes structured JSON &amp; Server-Sent Events for modern web/cloud integrations.</p>
    <div class="grid-2">
      <div class="card">
        <h3>1. Fetch NTRIP v2.0 Sourcetable</h3>
        <pre class="code"><code>curl -i -H "Ntrip-Version: Ntrip/2.0" \\
  https://ntrip.ai-kit.net/sourcetable</code></pre>
      </div>
      <div class="card">
        <h3>2. Stream Binary RTCM 3.3 Packet (with Ntrip-GGA)</h3>
        <pre class="code"><code>curl -s -H "Ntrip-Version: Ntrip/2.0" \\
  -H "Ntrip-GGA: ${escapeHtml(initialEpoch.rtk.roverGga)}" \\
  "https://ntrip.ai-kit.net/VRS-AUTO?epochs=2" | xxd | head -n 12</code></pre>
      </div>
    </div>
  </section>
  `;

  return renderPage(info, {
    title: "AI Kit NTRIP Edge — Open-Source NTRIP v2.0 Caster, RTCM3 Codec & RTK Simulator",
    description:
      "Interactive NTRIP v1.0/v2.0 Caster, bit-level RTCM 3.x encoder/decoder (CRC-24Q), NMEA-0183 GGA VRS router, and GNSS RTK simulator on Cloudflare Workers.",
    body,
    script: PLAYGROUND_SCRIPT,
  });
}
