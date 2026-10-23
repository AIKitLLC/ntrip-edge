import { Hono } from "hono";
import type { Context } from "hono";
import type { Env } from "../types/env";
import {
  decodeRtcm3Stream,
  getDefaultSourcetableRecords,
  getStationByMountpoint,
  hexToBytes,
  parseNmeaGga,
  serializeSourcetable,
  simulateGnssEpoch,
  type GeodeticCoord,
} from "../protocol";

export const casterRouter = new Hono<{ Bindings: Env }>();

/**
 * Respond with a standards-compliant NTRIP v2.0 Sourcetable (`gnss/sourcetable`).
 */
export function buildSourcetableResponse(c: Context<{ Bindings: Env }>): Response {
  const url = new URL(c.req.url);
  const host = url.hostname || "ntrip.ai-kit.net";
  const port = url.port ? Number.parseInt(url.port, 10) : url.protocol === "https:" ? 443 : 2101;
  const body = serializeSourcetable(getDefaultSourcetableRecords(host, port));

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "gnss/sourcetable; charset=utf-8",
      "Ntrip-Version": "Ntrip/2.0",
      Server: "AIKit-NTRIP-Edge/1.0",
      "Cache-Control": "no-store",
      "X-Powered-By": "AI Kit LLC (https://github.com/AIKitLLC/ntrip-edge)",
    },
  });
}

// Explicit /sourcetable endpoint
casterRouter.get("/sourcetable", (c) => buildSourcetableResponse(c));

// Direct NTRIP v2.0 Mountpoint GET /:mountpoint (e.g. /HAN0-VN, /SGN0-VN, /SFO0-US, /FFMJ-DE, /TYO0-JP, /VRS-AUTO)
casterRouter.get("/:mountpoint", (c, next) => {
  const mountpointParam = c.req.param("mountpoint");
  const station = getStationByMountpoint(mountpointParam);
  if (!station) {
    return next();
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

  // If the client requests JSON inspection via ?format=json or Accept: application/json
  const format = c.req.query("format");
  const accept = c.req.header("Accept") ?? "";
  if (format === "json" || (accept.includes("application/json") && !accept.includes("gnss/data"))) {
    const epoch = simulateGnssEpoch({
      mountpoint: station.mountpoint,
      epochIndex: Number.parseInt(c.req.query("epoch") ?? "4", 10) || 4,
      ...(roverCoordOverride ? { roverCoordOverride } : {}),
    });
    return c.json({
      success: true,
      protocol: "NTRIP/2.0",
      mountpoint: station.mountpoint,
      station,
      epoch,
    });
  }

  // Default NTRIP v2.0 binary RTCM 3.x stream (`gnss/data`)
  const epochsRequested = Number.parseInt(c.req.query("epochs") ?? "1", 10);
  const epochsCount = Math.max(1, Math.min(10, Number.isFinite(epochsRequested) ? epochsRequested : 1));
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

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

  return new Response(payload, {
    status: 200,
    headers: {
      "Content-Type": "gnss/data",
      "Ntrip-Version": "Ntrip/2.0",
      Server: "AIKit-NTRIP-Edge/1.0",
      "Cache-Control": "no-store, no-transform",
      "X-Ntrip-Mountpoint": station.mountpoint,
      "X-Ntrip-Station-Id": station.stationId.toString(),
      "X-Ntrip-Vrs": station.isVrs ? "true" : "false",
    },
  });
});

// NTRIP v2.0 Server ingest simulation: POST /:mountpoint with raw binary RTCM 3.x bytes
casterRouter.post("/:mountpoint", async (c, next) => {
  const mountpointParam = c.req.param("mountpoint");
  const station = getStationByMountpoint(mountpointParam);
  if (!station) {
    return next();
  }

  const buffer = await c.req.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const frames = decodeRtcm3Stream(bytes);
  const validCrcCount = frames.filter((f) => f.crcValid).length;

  return c.json({
    success: true,
    protocol: "NTRIP/2.0-SERVER-INGEST",
    mountpoint: station.mountpoint,
    receivedBytes: bytes.length,
    frameCount: frames.length,
    validCrcCount,
    allCrcValid: frames.length > 0 && validCrcCount === frames.length,
    frames,
  });
});
