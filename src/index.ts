import { Hono } from "hono";
import type { Env, AppVariables } from "./types/env";
import { timingMiddleware } from "./middleware/timing";
import { corsMiddleware } from "./middleware/cors";
import { rateLimitMiddleware } from "./middleware/rate-limit";
import { errorHandler } from "./middleware/error";
import { healthRouter } from "./routes/health";
import { openapiRouter } from "./routes/openapi";
import { apiRouter } from "./routes/api";
import { casterRouter } from "./routes/caster";

const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();

// 1. Global middlewares
app.use("*", timingMiddleware());
app.use("*", corsMiddleware());
app.use("*", rateLimitMiddleware());

// 2. Global error handler
app.onError(errorHandler);

// 3. Routes
app.route("/", healthRouter);
app.route("/", openapiRouter);
app.route("/api/v1", apiRouter);
app.route("/", casterRouter);

// 4. 404 handler
app.notFound((c) => {
  return c.json(
    {
      success: false,
      error: {
        code: "ROUTE_NOT_FOUND",
        message: `Route '${c.req.path}' not found. Visit '/' for available NTRIP mountpoints and API endpoints.`,
      },
      timestamp: new Date().toISOString(),
    },
    404
  );
});

export { app };

export default {
  fetch: app.fetch,
};
