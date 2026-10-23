/**
 * Cloudflare Worker Environment Bindings and Configuration
 */

export interface Env {
  readonly ENVIRONMENT?: string;
  readonly CASTER_OPERATOR?: string;
  readonly CASTER_IDENTIFIER?: string;
  readonly RATE_LIMITER?: RateLimit;
}

export type AppVariables = {
  requestId: string;
  startTime: number;
};
