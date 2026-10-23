/**
 * Interactive NTRIP v2.0 Caster, Proactive Custom Config Builder (with ICP II Auth & Spec Validator),
 * RTCM 3.x Frame Inspector, and GNSS RTK Simulator Playground UI.
 */

import {
  getAllStations,
  getDefaultSourcetableRecords,
  serializeSourcetable,
  simulateGnssEpoch,
} from "../../protocol";
import { escapeHtml, renderPage, type PageInfo } from "./layout";

const PLAYGROUND_SCRIPT = `
(function () {
  var currentMount = "HAN0-VN";
  var currentEpoch = 4;
  var activeStream = null;
  var icpSessionToken = null;
  var icpPrincipal = null;

  var mountChipsContainer = document.getElementById("mount-chips-container");
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

  // Proactive Builder & ICP II elements
  var btnIcpLogin = document.getElementById("btn-icp-login");
  var btnIcpPopup = document.getElementById("btn-icp-popup");
  var icpStatusBadge = document.getElementById("icp-status-badge");
  var icpTokenPreview = document.getElementById("icp-token-preview");

  var cfgMount = document.getElementById("cfg-mount");
  var cfgStnId = document.getElementById("cfg-stn-id");
  var cfgIdentifier = document.getElementById("cfg-identifier");
  var cfgCity = document.getElementById("cfg-city");
  var cfgCountry = document.getElementById("cfg-country");
  var cfgLat = document.getElementById("cfg-lat");
  var cfgLon = document.getElementById("cfg-lon");
  var cfgHeight = document.getElementById("cfg-height");
  var cfgSchedule = document.getElementById("cfg-schedule");
  var cfgAntenna = document.getElementById("cfg-antenna");
  var cfgReceiver = document.getElementById("cfg-receiver");
  var cfgBitrate = document.getElementById("cfg-bitrate");
  var cfgVrs = document.getElementById("cfg-vrs");
  var cfgUpstream = document.getElementById("cfg-upstream");

  var btnValidateCfg = document.getElementById("btn-validate-cfg");
  var btnCreateCfg = document.getElementById("btn-create-cfg");
  var specChecksBody = document.getElementById("spec-checks-tbody");
  var cfgResultOut = document.getElementById("cfg-result-out");
  var stLivePre = document.getElementById("st-live-pre");

  // RTCM3 Codec & GGA elements
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

  function bytesToHex(uint8) {
    var out = "";
    for (var i = 0; i < uint8.length; i++) {
      out += uint8[i].toString(16).padStart(2, "0").toUpperCase();
    }
    return out;
  }

  function bindMountChips() {
    var chips = document.querySelectorAll("[data-mount]");
    for (var i = 0; i < chips.length; i++) {
      chips[i].onclick = function () {
        var all = document.querySelectorAll("[data-mount]");
        for (var j = 0; j < all.length; j++) all[j].classList.remove("active");
        this.classList.add("active");
        currentMount = this.getAttribute("data-mount") || "HAN0-VN";
        currentEpoch = 4;
        fetchEpoch(currentMount, currentEpoch);
      };
    }
  }

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

  bindMountChips();

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

  // ICP Internet Identity (II) Login Handler (WebCrypto ECDSA P-256 Challenge-Sign + Delegation)
  async function performIcpIiLogin() {
    if (!btnIcpLogin) return;
    btnIcpLogin.disabled = true;
    icpStatusBadge.textContent = "Signing ICP II Challenge…";
    icpStatusBadge.className = "badge warn";
    try {
      var chRes = await fetch("/api/v1/auth/icp-ii/challenge");
      var chJson = await chRes.json();
      var challenge = chJson.challenge;

      var keyPair = await window.crypto.subtle.generateKey(
        { name: "ECDSA", namedCurve: "P-256" },
        true,
        ["sign", "verify"]
      );
      var spkiBuf = await window.crypto.subtle.exportKey("spki", keyPair.publicKey);
      var pubKeyHex = bytesToHex(new Uint8Array(spkiBuf));

      var msgBytes = new TextEncoder().encode(challenge.challengeMessage);
      var sigBuf = await window.crypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        keyPair.privateKey,
        msgBytes
      );
      var sigHex = bytesToHex(new Uint8Array(sigBuf));

      var verRes = await fetch("/api/v1/auth/icp-ii/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          challengeToken: challenge.challengeToken,
          publicKeyHex: pubKeyHex,
          signatureHex: sigHex,
          algorithm: "ECDSA_P256"
        })
      });
      var verJson = await verRes.json();
      if (verJson && verJson.success) {
        icpSessionToken = verJson.sessionToken;
        icpPrincipal = verJson.claims.principal;
        icpStatusBadge.textContent = "ICP II Verified: " + icpPrincipal;
        icpStatusBadge.className = "badge ok";
        icpTokenPreview.textContent = "Bearer " + icpSessionToken.slice(0, 44) + "… (Principal: " + icpPrincipal + ")";
      } else {
        icpStatusBadge.textContent = "Auth Failed: " + (verJson.error ? verJson.error.message : "Unknown");
        icpStatusBadge.className = "badge bad";
      }
    } catch (err) {
      icpStatusBadge.textContent = "ICP II Error: " + String(err);
      icpStatusBadge.className = "badge bad";
    } finally {
      btnIcpLogin.disabled = false;
    }
  }

  if (btnIcpLogin) {
    btnIcpLogin.addEventListener("click", performIcpIiLogin);
  }

  if (btnIcpPopup) {
    btnIcpPopup.addEventListener("click", function () {
      window.open("https://identity.ic0.app/#authorize", "icp-ii-auth", "width=520,height=680");
      performIcpIiLogin();
    });
  }

  function readCustomConfigForm() {
    var payload = {
      mountpoint: (cfgMount.value || "").trim(),
      stationId: Number(cfgStnId.value) || 1008,
      identifier: (cfgIdentifier.value || "").trim(),
      city: (cfgCity.value || "").trim(),
      country: (cfgCountry.value || "").trim(),
      latDeg: Number(cfgLat.value),
      lonDeg: Number(cfgLon.value),
      heightM: Number(cfgHeight.value),
      formatDetails: (cfgSchedule.value || "").trim(),
      antennaDescriptor: (cfgAntenna.value || "").trim(),
      receiverDescriptor: (cfgReceiver.value || "").trim(),
      bitrate: Number(cfgBitrate.value) || 11200,
      isVrs: cfgVrs.value === "true"
    };
    var up = (cfgUpstream.value || "").trim();
    if (up) payload.upstreamUrl = up;
    if (icpSessionToken) payload.icpSessionToken = icpSessionToken;
    return payload;
  }

  function renderSpecReport(report) {
    if (!report || !report.checks || !specChecksBody) return;
    var rows = "";
    for (var i = 0; i < report.checks.length; i++) {
      var c = report.checks[i];
      var badgeCls = c.status === "PASS" ? "ok" : c.status === "WARN" ? "warn" : "bad";
      rows += "<tr>" +
        "<td><span class='badge " + badgeCls + "'>" + c.status + "</span></td>" +
        "<td><strong>" + c.id + "</strong></td>" +
        "<td><code>" + c.specRef + "</code></td>" +
        "<td>" + c.detail + "</td>" +
        "</tr>";
    }
    specChecksBody.innerHTML = rows;
  }

  if (btnValidateCfg) {
    btnValidateCfg.addEventListener("click", function () {
      btnValidateCfg.disabled = true;
      cfgResultOut.textContent = "Validating candidate NTRIP server & RTCM 3.x binary stream against RTCM 10410.1 / 10403.3 specs…";
      fetch("/api/v1/ntrip/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(readCustomConfigForm())
      })
        .then(function (r) { return r.json(); })
        .then(function (res) {
          if (res && res.validationReport) {
            renderSpecReport(res.validationReport);
          }
          cfgResultOut.textContent = JSON.stringify(res, null, 2);
        })
        .finally(function () { btnValidateCfg.disabled = false; });
    });
  }

  if (btnCreateCfg) {
    btnCreateCfg.addEventListener("click", function () {
      btnCreateCfg.disabled = true;
      var body = readCustomConfigForm();
      var headers = { "Content-Type": "application/json" };
      if (icpSessionToken) headers["Authorization"] = "Bearer " + icpSessionToken;

      cfgResultOut.textContent = "Verifying ICP II Principal & validating NTRIP Server specs…";
      fetch("/api/v1/configs", {
        method: "POST",
        headers: headers,
        body: JSON.stringify(body)
      })
        .then(function (r) { return r.json(); })
        .then(function (res) {
          if (res && res.validationReport) {
            renderSpecReport(res.validationReport);
          }
          cfgResultOut.textContent = JSON.stringify(res, null, 2);
          if (res && res.success && res.station) {
            var mp = res.station.mountpoint;
            var existing = document.querySelector("[data-mount='" + mp + "']");
            if (!existing && mountChipsContainer) {
              var chip = document.createElement("button");
              chip.type = "button";
              chip.className = "chip active";
              chip.setAttribute("data-mount", mp);
              chip.textContent = mp + " (" + res.station.city + " · Custom)";
              var all = document.querySelectorAll("[data-mount]");
              for (var j = 0; j < all.length; j++) all[j].classList.remove("active");
              mountChipsContainer.appendChild(chip);
              bindMountChips();
            }
            currentMount = mp;
            fetchEpoch(mp, 4);
            fetch("/sourcetable")
              .then(function (r) { return r.text(); })
              .then(function (txt) {
                if (stLivePre) stLivePre.textContent = txt;
              });
          }
        })
        .finally(function () { btnCreateCfg.disabled = false; });
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
  const allStations = getAllStations();

  const mountChipsHtml = allStations
    .map((s, idx) => {
      const active = idx === 0 ? " active" : "";
      return `<button type="button" class="chip${active}" data-mount="${escapeHtml(s.mountpoint)}">${escapeHtml(s.mountpoint)} (${escapeHtml(s.city)})</button>`;
    })
    .join("");

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
    <div class="eyebrow">Open-Source GNSS RTK Infrastructure &middot; MCP + ICP II &middot; MIT License</div>
    <h1>NTRIP v2.0 Caster, RTCM 3.x Codec &amp; RTK Simulator at the Edge.</h1>
    <p class="lead">
      Clean-room TypeScript implementation of <code>NTRIP v1.0/v2.0</code>, bit-exact <code>RTCM 10403.3</code> framing with 24-bit Qualcomm <code>CRC-24Q</code>, <code>NMEA-0183 $GNGGA</code> VRS routing, and a <strong>Model Context Protocol (MCP)</strong> server with <strong>ICP Internet Identity (II)</strong> authentication.
    </p>
  </section>

  <!-- 1. LIVE NTRIP CASTER & RTK SIMULATOR -->
  <section id="simulator" class="panel" aria-labelledby="sim-title">
    <div class="panel-head">
      <div>
        <h2 id="sim-title" class="panel-title">1. Live NTRIP v2.0 Mountpoint &amp; RTK Convergence Simulator</h2>
        <div id="mount-chips-container" class="chips" role="group" aria-label="Mountpoints">
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

  <!-- 2. PROACTIVE CUSTOM NTRIP CONFIG BUILDER, SPEC VALIDATOR & ICP II LOGIN -->
  <section id="builder" class="panel" aria-labelledby="builder-title">
    <div class="panel-head">
      <div>
        <h2 id="builder-title" class="panel-title">2. Proactive NTRIP Config Builder, Spec Validator &amp; ICP Internet Identity (II) Login</h2>
        <p style="margin:4px 0 0;color:var(--muted);font-size:0.9rem">
          Create your own custom NTRIP Mountpoint &amp; Base Station parameters. Creating a live config on the Caster or via <a href="/mcp"><code>POST /mcp</code></a> requires <strong>ICP Internet Identity (II)</strong> login and 100% compliance with <code>RTCM 10410.1</code> (NTRIP v2.0) &amp; <code>RTCM 10403.3</code> (RTCM 3.x) specs.
        </p>
      </div>
      <div class="row">
        <button type="button" id="btn-icp-login" class="btn">Login with ICP II (Sign Challenge)</button>
        <button type="button" id="btn-icp-popup" class="btn ghost">identity.ic0.app</button>
      </div>
    </div>

    <div class="badges" style="margin-bottom:14px">
      <span id="icp-status-badge" class="badge warn">Not Authenticated (Click "Login with ICP II" to derive Principal &amp; Token)</span>
      <code id="icp-token-preview" style="font-size:0.8rem;color:var(--muted)">Required for POST /api/v1/configs &amp; MCP tool create_ntrip_config</code>
    </div>

    <div class="grid-2">
      <div>
        <div class="row" style="margin-bottom:10px">
          <div style="flex:1 1 140px">
            <label for="cfg-mount" style="font-size:0.78rem;font-weight:700;color:var(--muted);display:block">MOUNTPOINT (1..32 ASCII)</label>
            <input id="cfg-mount" class="input" style="width:100%" value="DANANG-VN">
          </div>
          <div style="flex:0 0 110px">
            <label for="cfg-stn-id" style="font-size:0.78rem;font-weight:700;color:var(--muted);display:block">STATION ID (0..4095)</label>
            <input id="cfg-stn-id" class="input" type="number" style="width:100%" value="1008">
          </div>
          <div style="flex:0 0 95px">
            <label for="cfg-country" style="font-size:0.78rem;font-weight:700;color:var(--muted);display:block">ISO-3 COUNTRY</label>
            <input id="cfg-country" class="input" style="width:100%" value="VNM">
          </div>
        </div>

        <div class="row" style="margin-bottom:10px">
          <div style="flex:1 1 180px">
            <label for="cfg-identifier" style="font-size:0.78rem;font-weight:700;color:var(--muted);display:block">STATION IDENTIFIER</label>
            <input id="cfg-identifier" class="input" style="width:100%" value="Da Nang Coastal CORS Base">
          </div>
          <div style="flex:1 1 130px">
            <label for="cfg-city" style="font-size:0.78rem;font-weight:700;color:var(--muted);display:block">CITY</label>
            <input id="cfg-city" class="input" style="width:100%" value="Da Nang">
          </div>
        </div>

        <div class="row" style="margin-bottom:10px">
          <div style="flex:1 1 115px">
            <label for="cfg-lat" style="font-size:0.78rem;font-weight:700;color:var(--muted);display:block">WGS-84 LAT (&deg;)</label>
            <input id="cfg-lat" class="input" type="number" step="0.000001" style="width:100%" value="16.054407">
          </div>
          <div style="flex:1 1 115px">
            <label for="cfg-lon" style="font-size:0.78rem;font-weight:700;color:var(--muted);display:block">WGS-84 LON (&deg;)</label>
            <input id="cfg-lon" class="input" type="number" step="0.000001" style="width:100%" value="108.202167">
          </div>
          <div style="flex:1 1 95px">
            <label for="cfg-height" style="font-size:0.78rem;font-weight:700;color:var(--muted);display:block">HEIGHT (m)</label>
            <input id="cfg-height" class="input" type="number" step="0.1" style="width:100%" value="15.6">
          </div>
        </div>

        <div style="margin-bottom:10px">
          <label for="cfg-schedule" style="font-size:0.78rem;font-weight:700;color:var(--muted);display:block">RTCM 3.x MESSAGE SCHEDULE (Requires ARP 1005/1006 + Observables)</label>
          <input id="cfg-schedule" class="input" style="width:100%" value="1005(5),1033(10),1077(1),1087(1),1097(1),1127(1),1230(5)">
        </div>

        <div class="row" style="margin-bottom:10px">
          <div style="flex:1 1 140px">
            <label for="cfg-antenna" style="font-size:0.78rem;font-weight:700;color:var(--muted);display:block">ANTENNA DESCRIPTOR</label>
            <input id="cfg-antenna" class="input" style="width:100%" value="SEPCHOKE_B3E6   SPKE">
          </div>
          <div style="flex:1 1 140px">
            <label for="cfg-receiver" style="font-size:0.78rem;font-weight:700;color:var(--muted);display:block">RECEIVER DESCRIPTOR</label>
            <input id="cfg-receiver" class="input" style="width:100%" value="AIKIT EDGE VRS 2.0">
          </div>
        </div>

        <div class="row" style="margin-bottom:10px">
          <div style="flex:1 1 110px">
            <label for="cfg-bitrate" style="font-size:0.78rem;font-weight:700;color:var(--muted);display:block">BITRATE (bps)</label>
            <input id="cfg-bitrate" class="input" type="number" style="width:100%" value="11200">
          </div>
          <div style="flex:1 1 140px">
            <label for="cfg-vrs" style="font-size:0.78rem;font-weight:700;color:var(--muted);display:block">SOLUTION MODE</label>
            <select id="cfg-vrs" class="select" style="width:100%">
              <option value="false">0 — Physical Single Base (CORS)</option>
              <option value="true">1 — Virtual Ref Station (VRS)</option>
            </select>
          </div>
        </div>

        <div style="margin-bottom:12px">
          <label for="cfg-upstream" style="font-size:0.78rem;font-weight:700;color:var(--muted);display:block">OPTIONAL LIVE UPSTREAM NTRIP v2.0 URL TO PROBE</label>
          <input id="cfg-upstream" class="input" style="width:100%" placeholder="https://ntrip.ai-kit.net/sourcetable">
        </div>

        <div class="row">
          <button type="button" id="btn-validate-cfg" class="btn ghost">1. Validate Server &amp; Specs</button>
          <button type="button" id="btn-create-cfg" class="btn">2. Create Config (Requires ICP II)</button>
        </div>
      </div>

      <div>
        <strong style="font-size:0.86rem;display:block;margin-bottom:6px">RTCM 10410.1 &amp; 10403.3 Specification Compliance Gates:</strong>
        <div class="scroll" style="max-height:210px;margin-top:0;margin-bottom:10px">
          <table class="attrs">
            <thead>
              <tr>
                <th>Status</th>
                <th>Gate</th>
                <th>Spec Ref</th>
                <th>Verification Detail</th>
              </tr>
            </thead>
            <tbody id="spec-checks-tbody">
              <tr><td colspan="4" style="color:var(--muted)">Click "1. Validate Server &amp; Specs" or "2. Create Config" to run all 9 specification compliance gates.</td></tr>
            </tbody>
          </table>
        </div>

        <strong style="font-size:0.86rem;display:block;margin-bottom:6px">Validated NTRIP Config / STR Record &amp; RTCM 3.x Output:</strong>
        <pre class="code" style="max-height:200px;margin:0"><code id="cfg-result-out">Ready. Authenticate with ICP II above, customize any station parameters on the left, and click "Create Config".</code></pre>
      </div>
    </div>
  </section>

  <!-- 3. RTCM 3.x BINARY CODEC & CUSTOM EXTENSION ENCODER -->
  <section id="inspector" class="panel" aria-labelledby="codec-title">
    <div class="panel-head">
      <h2 id="codec-title" class="panel-title">3. RTCM 3.x Bit-Level Frame Inspector &amp; Custom Encoder</h2>
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

  <!-- 4. SOURCETABLE & NMEA GGA VRS ROUTER -->
  <section id="sourcetable" class="panel" aria-labelledby="st-title">
    <div class="panel-head">
      <h2 id="st-title" class="panel-title">4. NTRIP Sourcetable (STR / CAS / NET) &amp; NMEA $GNGGA VRS Router</h2>
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
        <pre class="code" style="max-height:310px;margin:0"><code id="st-live-pre">${escapeHtml(initialSourcetable)}</code></pre>
      </div>
    </div>
  </section>

  <!-- 5. AGENT / MCP & CLI QUICK CONNECT -->
  <section class="block">
    <h2>Connect AI Agents (MCP + <code>/llm.txt</code>), RTKLIB, or CLI</h2>
    <p class="sec-lead">Read <a href="/llm.txt"><code>/llm.txt</code></a> for full Agent instructions or connect any MCP client to <code>POST https://ntrip.ai-kit.net/mcp</code>.</p>
    <div class="grid-2">
      <div class="card">
        <h3>1. MCP Tool Call: Validate NTRIP Server</h3>
        <pre class="code"><code>curl -s -X POST https://ntrip.ai-kit.net/mcp \\
  -H "Content-Type: application/json" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"validate_ntrip_server","arguments":{"mountpoint":"DANANG-VN","stationId":1008,"identifier":"Da Nang CORS","city":"Da Nang","country":"VNM","latDeg":16.054407,"lonDeg":108.202167,"heightM":15.6}}}'</code></pre>
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
    title: "AI Kit NTRIP Edge — Open-Source NTRIP v2.0 Caster, RTCM3 Codec, RTK Simulator & MCP Server",
    description:
      "Interactive NTRIP v1.0/v2.0 Caster, proactive config builder with ICP Internet Identity (II) login, RTCM 3.x spec validator, and MCP server on Cloudflare Workers.",
    body,
    script: PLAYGROUND_SCRIPT,
  });
}
