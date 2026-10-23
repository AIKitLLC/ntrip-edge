import type { ErrorHandler } from "hono";

/**
 * Safe error boundary complying with high-performance doctrine.
 */
export const errorHandler: ErrorHandler = (err, c) => {
  console.error(`[INTERNAL_SERVER_ERROR] ${c.req.method} ${c.req.path}:`, err);

  return c.json(
    {
      success: false,
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "An unexpected error occurred processing your NTRIP/RTCM request.",
      },
      timestamp: new Date().toISOString(),
    },
    500
  );
};
