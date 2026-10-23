import type { MiddlewareHandler } from "hono";

/**
 * High precision timing middleware providing Server-Timing and latency metrics
 */
export const timingMiddleware = (): MiddlewareHandler => {
  return async (c, next) => {
    const startTime = performance.now();
    await next();
    const duration = Math.round((performance.now() - startTime) * 100) / 100;

    c.header("X-Response-Time-Ms", `${duration}`);
    c.header("Server-Timing", `edge;dur=${duration}`);
  };
};
