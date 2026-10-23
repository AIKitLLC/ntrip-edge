import type { MiddlewareHandler } from "hono";
import type { Env } from "../types/env";

const UNLIMITED_PATHS = new Set(["/", "/health", "/sourcetable", "/docs", "/openapi.json", "/llms.txt"]);

/**
 * Per-client rate limit using the Workers Rate Limiting binding (RATE_LIMITER).
 * Fails open in tests and local dev.
 */
export const rateLimitMiddleware = (): MiddlewareHandler<{ Bindings: Env }> => {
  return async (c, next) => {
    const limiter = c.env?.RATE_LIMITER;
    if (!limiter || c.req.method === "OPTIONS" || UNLIMITED_PATHS.has(c.req.path)) return next();

    const client = c.req.header("CF-Connecting-IP") ?? "unknown";
    let allowed = true;
    try {
      allowed = (await limiter.limit({ key: client })).success;
    } catch (err) {
      console.error("[RATE_LIMITER] binding error, allowing request:", err);
    }
    if (allowed) return next();

    c.header("Retry-After", "60");
    return c.json(
      {
        success: false,
        error: {
          code: "RATE_LIMITED",
          message: "Too many requests. Wait a minute and retry.",
        },
        timestamp: new Date().toISOString(),
      },
      429
    );
  };
};
