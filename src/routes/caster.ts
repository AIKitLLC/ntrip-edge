import { Hono } from "hono";
import type { Context } from "hono";
import type { Env } from "../types/env";
import {
  buildNtripWireTranscript,
  decodeRtcm3Stream,
  getDefaultSourcetableRecords,
  getStationByMountpoint,
  hexToBytes,
  negotiateNtripRevision,
  parseNmeaGga,
  parseRev1SourceHeader,
  serializeSourcetable,
  simulateGnssEpoch,
  type GeodeticCoord,
  type NtripRevision,
} from "../protocol";

export const casterRouter = new Hono<{ Bindings: Env }>();

/**
 * Respond with a standards-compliant NTRIP Rev 1 (`SOURCETABLE 200 OK` / `text/plain`)
 * or NTRIP Rev 2 (`HTTP/1.1 200 OK` / `gnss/sourcetable`) Sourcetable.
 */
export function buildSourcetableResponse(
  c: Context<{ Bindings: Env }>,
  forcedRevision?: NtripRevision
): Response {
  const url = new URL(c.req.url);
  const host = url.hostname || "ntrip.ai-kit.net";
  const port = url.port ? Number.parseInt(url.port, 10) : url.protocol === "https:" ? 443 : 2101;
  const rev =
    forcedRevision ??
    negotiateNtripRevision({
      queryRev: c.req.query("rev"),
      ntripVersionHeader: c.req.header("Ntrip-Version"),
    });

  const tableBody = serializeSourcetable(getDefaultSourcetableRecords(host, port));
  const includeWirePreamble = c.req.query("wire") === "true" || c.req.header("X-Ntrip-Wire") === "true";

  if (rev === "rev1") {
    const rev1Body = includeWirePreamble
      ? `SOURCETABLE 200 OK\r\nServer: NTRIP AIKit-Edge-Caster/1.0\r\nContent-Type: text/plain\r\nContent-Length: ${tableBody.length}\r\n\r\n${tableBody}`
      : tableBody;

    return new Response(rev1Body, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        Server: "NTRIP AIKit-Edge-Caster/1.0",
        "X-Ntrip-Revision": "rev1",
        "X-Ntrip-Status-Line": "SOURCETABLE 200 OK",
        "Cache-Control": "no-store",
        "X-Powered-By": "AI Kit LLC (https://github.com/AIKitLLC/ntrip-edge)",
      },
    });
  }

  return new Response(tableBody, {
    status: 200,
    headers: {
      "Content-Type": "gnss/sourcetable; charset=utf-8",
      "Ntrip-Version": "Ntrip/2.0",
      Server: "NTRIP AIKit-Edge-Caster/2.0",
      "X-Ntrip-Revision": "rev2",
      "X-Ntrip-Status-Line": "HTTP/1.1 200 OK",
      "Cache-Control": "no-store",
      "X-Powered-By": "AI Kit LLC (https://github.com/AIKitLLC/ntrip-edge)",
    },
  });
}

function handleMountpointGet(
  c: Context<{ Bindings: Env }>,
  mountpointParam: string,
  pathPrefix?: "rev1" | "rev2"
): Response | null {
  const station = getStationByMountpoint(mountpointParam);
  if (!station) {
    return null;
  }

  const rev = negotiateNtripRevision({
    queryRev: c.req.query("rev"),
    ntripVersionHeader: c.req.header("Ntrip-Version"),
    pathPrefix,
    stationDefaultMode: station.ntripRevision,
  });

  // Enforce strict server revision if the station was configured as rev1-only or rev2-only
  if (station.ntripRevision === "rev1" && rev === "rev2") {
    return c.json(
      {
        success: false,
        error: {
          code: "NTRIP_REVISION_MISMATCH",
          message: `Mountpoint '${station.mountpoint}' is configured strictly as an NTRIP Rev 1 (v1.0) server. Connect via /rev1/${station.mountpoint} or ?rev=rev1.`,
        },
      },
      400
    );
  }
  if (station.ntripRevision === "rev2" && rev === "rev1") {
    return c.json(
      {
        success: false,
        error: {
          code: "NTRIP_REVISION_MISMATCH",
          message: `Mountpoint '${station.mountpoint}' is configured strictly as an NTRIP Rev 2 (v2.0) server. Connect via /rev2/${station.mountpoint} or with header 'Ntrip-Version: Ntrip/2.0'.`,
        },
      },
      400
    );
  }

  const ggaInput = c.req.header("Ntrip-GGA") ?? c.req.query("gga");
  let roverCoordOverride: GeodeticCoord | undefined;
  if (ggaInput) {
    const parsed = parseNmeaGga(ggaInput);
    if (parsed.ok) {
      roverCoordOverride = {
        latDeg: parsed.record.latDeg,
        lonDeg: parsed.record.lonDeg,
        heightM: parsed.record.altitudeM,
      };
    }
  }

  const format = c.req.query("format");
  const accept = c.req.header("Accept") ?? "";
  if (format === "json" || (accept.includes("application/json") && !accept.includes("gnss/data"))) {
    const epoch = simulateGnssEpoch({
      mountpoint: station.mountpoint,
      epochIndex: Number.parseInt(c.req.query("epoch") ?? "4", 10) || 4,
      ...(roverCoordOverride ? { roverCoordOverride } : {}),
    });
    const wireTranscript = buildNtripWireTranscript(rev, {
      mountpoint: station.mountpoint,
      sampleGga: epoch.rtk.roverGga,
    });
    return c.json({
      success: true,
      revision: rev,
      protocol: rev === "rev1" ? "NTRIP/1.0 (RTCM 10410.0)" : "NTRIP/2.0 (RTCM 10410.1)",
      mountpoint: station.mountpoint,
      station,
      wireTranscript,
      epoch,
    });
  }

  const epochsRequested = Number.parseInt(c.req.query("epochs") ?? "1", 10);
  const epochsCount = Math.max(1, Math.min(10, Number.isFinite(epochsRequested) ? epochsRequested : 1));
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  if (rev === "rev1" && (c.req.query("wire") === "true" || c.req.header("X-Ntrip-Wire") === "true")) {
    const icyBytes = new TextEncoder().encode("ICY 200 OK\r\nServer: NTRIP AIKit-Edge-Caster/1.0\r\n\r\n");
    chunks.push(icyBytes);
    totalBytes += icyBytes.length;
  }

  for (let i = 0; i < epochsCount; i++) {
    const epoch = simulateGnssEpoch({
      mountpoint: station.mountpoint,
      epochIndex: i,
      ...(roverCoordOverride ? { roverCoordOverride } : {}),
    });
    const bytes = hexToBytes(epoch.packetHex);
    if (bytes) {
      chunks.push(bytes);
      totalBytes += bytes.length;
    }
  }

  const payload = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    payload.set(chunk, offset);
    offset += chunk.length;
  }

  if (rev === "rev1") {
    return new Response(payload, {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        Server: "NTRIP AIKit-Edge-Caster/1.0",
        "Cache-Control": "no-store, no-transform",
        "X-Ntrip-Revision": "rev1",
        "X-Ntrip-Status-Line": "ICY 200 OK",
        "X-Ntrip-Mountpoint": station.mountpoint,
        "X-Ntrip-Station-Id": station.stationId.toString(),
        "X-Ntrip-Vrs": station.isVrs ? "true" : "false",
      },
    });
  }

  return new Response(payload, {
    status: 200,
    headers: {
      "Content-Type": "gnss/data",
      "Ntrip-Version": "Ntrip/2.0",
      Server: "NTRIP AIKit-Edge-Caster/2.0",
      "Cache-Control": "no-store, no-transform",
      "X-Ntrip-Revision": "rev2",
      "X-Ntrip-Status-Line": "HTTP/1.1 200 OK",
      "X-Ntrip-Mountpoint": station.mountpoint,
      "X-Ntrip-Station-Id": station.stationId.toString(),
      "X-Ntrip-Vrs": station.isVrs ? "true" : "false",
    },
  });
}

async function handleMountpointPost(
  c: Context<{ Bindings: Env }>,
  mountpointParam: string,
  pathPrefix?: "rev1" | "rev2"
): Promise<Response | null> {
  const station = getStationByMountpoint(mountpointParam);
  if (!station) {
    return null;
  }

  const buffer = await c.req.arrayBuffer();
  const rawBytes = new Uint8Array(buffer);

  // Check if the payload starts with an NTRIP Rev 1 'SOURCE <password> /<mountpoint>' header
  const rev1Source = parseRev1SourceHeader(rawBytes);
  const rev = rev1Source.valid
    ? "rev1"
    : negotiateNtripRevision({
        queryRev: c.req.query("rev"),
        ntripVersionHeader: c.req.header("Ntrip-Version"),
        pathPrefix,
        stationDefaultMode: station.ntripRevision,
      });

  const rtcmSlice = rev1Source.valid ? rawBytes.subarray(rev1Source.binaryPayloadOffset) : rawBytes;
  const frames = decodeRtcm3Stream(rtcmSlice);
  const validCrcCount = frames.filter((f) => f.crcValid).length;

  return c.json({
    success: true,
    revision: rev,
    protocol: rev === "rev1" ? "NTRIP/1.0-REV1-SOURCE-INGEST" : "NTRIP/2.0-REV2-HTTP-INGEST",
    casterResponseStatusLine: rev === "rev1" ? "ICY 200 OK" : "HTTP/1.1 200 OK",
    mountpoint: station.mountpoint,
    rev1SourceHeader: rev1Source.valid ? rev1Source : null,
    receivedBytes: rawBytes.length,
    rtcmPayloadBytes: rtcmSlice.length,
    frameCount: frames.length,
    validCrcCount,
    allCrcValid: frames.length > 0 && validCrcCount === frames.length,
    frames,
  });
}

// Dedicated NTRIP Rev 1 (v1.0) Caster endpoints
casterRouter.get("/rev1/sourcetable", (c) => buildSourcetableResponse(c, "rev1"));
casterRouter.get("/rev1/:mountpoint", (c, next) => {
  const res = handleMountpointGet(c, c.req.param("mountpoint"), "rev1");
  return res ?? next();
});
casterRouter.post("/rev1/:mountpoint", async (c, next) => {
  const res = await handleMountpointPost(c, c.req.param("mountpoint"), "rev1");
  return res ?? next();
});

// Dedicated NTRIP Rev 2 (v2.0) Caster endpoints
casterRouter.get("/rev2/sourcetable", (c) => buildSourcetableResponse(c, "rev2"));
casterRouter.get("/rev2/:mountpoint", (c, next) => {
  const res = handleMountpointGet(c, c.req.param("mountpoint"), "rev2");
  return res ?? next();
});
casterRouter.post("/rev2/:mountpoint", async (c, next) => {
  const res = await handleMountpointPost(c, c.req.param("mountpoint"), "rev2");
  return res ?? next();
});

// Auto-negotiated /sourcetable and /:mountpoint endpoints
casterRouter.get("/sourcetable", (c) => buildSourcetableResponse(c));
casterRouter.get("/:mountpoint", (c, next) => {
  const res = handleMountpointGet(c, c.req.param("mountpoint"));
  return res ?? next();
});
casterRouter.post("/:mountpoint", async (c, next) => {
  const res = await handleMountpointPost(c, c.req.param("mountpoint"));
  return res ?? next();
});
