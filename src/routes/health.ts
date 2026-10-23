import { Hono } from "hono";
import type { Context } from "hono";
import type { Env } from "../types/env";
import { REFERENCE_STATIONS } from "../protocol";
import { buildSourcetableResponse } from "./caster";
import { renderDocsPage, renderPlaygroundPage, type PageInfo } from "./landing";

export const healthRouter = new Hono<{ Bindings: Env }>();

type AppContext = Context<{ Bindings: Env }>;

function pageSecurityHeaders(nonce: string): Record<string, string> {
  return {
    "Content-Security-Policy": [
      "default-src 'none'",
      `style-src 'nonce-${nonce}' 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
      "connect-src 'self'",
      "img-src data:",
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'none'",
    ].join("; "),
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  };
}

function edgeSnapshot(c: AppContext): { colo: string; country: string } {
  const cf = (c.req.raw as Request & { cf?: { colo?: string; country?: string } }).cf;
  return {
    colo: cf?.colo ?? "DEV/LOCAL",
    country: cf?.country ?? "UNKNOWN",
  };
}

function htmlPage(c: AppContext, render: (info: PageInfo) => string): Response {
  const nonce = btoa(crypto.randomUUID());
  const snap = edgeSnapshot(c);
  for (const [name, value] of Object.entries(pageSecurityHeaders(nonce))) {
    c.header(name, value);
  }
  c.header("Cache-Control", "public, max-age=60");
  return c.html(render({ colo: snap.colo, country: snap.country, nonce }), 200);
}

function healthJson(c: AppContext): Response {
  const snap = edgeSnapshot(c);
  return c.json(
    {
      name: "AI Kit NTRIP Edge",
      status: "healthy",
      protocol: "NTRIP/2.0 (RTCM 3.3 + NMEA-0183 GGA)",
      environment: c.env?.ENVIRONMENT ?? "production",
      project: {
        organization: "AI Kit LLC",
        repository: "https://github.com/AIKitLLC/ntrip-edge",
        docs: "https://github.com/AIKitLLC/ntrip-edge#readme",
        license: "MIT",
      },
      edge: {
        location: snap.colo,
        country: snap.country,
      },
      mountpoints: REFERENCE_STATIONS.map((s) => ({
        mountpoint: s.mountpoint,
        city: s.city,
        country: s.country,
        isVrs: s.isVrs,
        format: "RTCM 3.3",
      })),
      endpoints: {
        sourcetable: "GET /sourcetable (or GET / with Ntrip-Version: Ntrip/2.0)",
        mountpointStream: "GET /:mountpoint (HAN0-VN, SGN0-VN, SFO0-US, FFMJ-DE, TYO0-JP, VRS-AUTO)",
        sourcetableJson: "GET /api/v1/sourcetable[?lat=&lon=]",
        sourcetableParse: "POST /api/v1/sourcetable/parse",
        rtcmDecode: "POST /api/v1/rtcm/decode",
        rtcmEncode: "POST /api/v1/rtcm/encode",
        nmeaGga: "POST /api/v1/nmea/gga",
        simulateEpoch: "GET /api/v1/simulate/epoch[?mountpoint=HAN0-VN&epoch=4]",
        sseStream: "GET /api/v1/stream/:mountpoint[?epochs=6&intervalMs=600]",
      },
      timestamp: new Date().toISOString(),
    },
    200
  );
}

healthRouter.get("/", (c) => {
  const format = c.req.query("format");
  const ntripVer = c.req.header("Ntrip-Version") ?? "";
  const userAgent = (c.req.header("User-Agent") ?? "").toUpperCase();

  // Standard NTRIP v1.0 / v2.0 clients requesting GET / receive the Sourcetable directly
  if (format === "sourcetable" || ntripVer.length > 0 || userAgent.includes("NTRIP")) {
    return buildSourcetableResponse(c);
  }

  c.header("Vary", "Accept, Ntrip-Version, User-Agent");
  if ((c.req.header("Accept") ?? "").includes("text/html") && !format) {
    return htmlPage(c, renderPlaygroundPage);
  }

  return healthJson(c);
});

healthRouter.get("/health", (c) => healthJson(c));
healthRouter.get("/docs", (c) => htmlPage(c, renderDocsPage));
