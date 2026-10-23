import type { MiddlewareHandler } from "hono";

/**
 * Universal CORS middleware allowing web and GNSS NTRIP v2.0 clients to call the API freely
 */
export const corsMiddleware = (): MiddlewareHandler => {
  return async (c, next) => {
    if (c.req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS, HEAD",
          "Access-Control-Allow-Headers":
            "Content-Type, Authorization, Ntrip-Version, Ntrip-GGA, X-Ntrip-Extension, X-Requested-With",
          "Access-Control-Expose-Headers":
            "Ntrip-Version, X-Ntrip-Mountpoint, X-Ntrip-Station-Id, X-Ntrip-Vrs, X-Response-Time-Ms, Server-Timing",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    await next();

    c.header("Access-Control-Allow-Origin", "*");
    c.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS, HEAD");
    c.header(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, Ntrip-Version, Ntrip-GGA, X-Ntrip-Extension, X-Requested-With"
    );
    c.header(
      "Access-Control-Expose-Headers",
      "Ntrip-Version, X-Ntrip-Mountpoint, X-Ntrip-Station-Id, X-Ntrip-Vrs, X-Response-Time-Ms, Server-Timing"
    );
    c.header("X-Powered-By", "AI Kit LLC (https://github.com/AIKitLLC/ntrip-edge)");
    c.header("X-Repository", "https://github.com/AIKitLLC/ntrip-edge");
    return;
  };
};
