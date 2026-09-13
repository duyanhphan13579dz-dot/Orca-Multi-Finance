import "server-only";
import { env } from "../env";

/**
 * SSI FastConnect consumer credentials.
 *
 * Resolution now lives in `src/lib/env.ts` (`env.ssiConsumerId` /
 * `env.ssiConsumerSecret`), which applies the same first-non-empty-wins chain:
 *   1. SSI_FC_CONSUMER_ID / SSI_FC_CONSUMER_SECRET  (canonical)
 *   2. SSI_API_KEY / SSI_API_SECRET                 (Vercel aliases)
 *   3. SSI_CONSUMER_ID / SSI_CONSUMER_SECRET
 *
 * This module stays as the thin, import-friendly accessor used by the SSI
 * adapters, plus `ensureSsiEnvAliases()` for any *external* code that still
 * reads `SSI_FC_*` straight off `process.env` (nothing inside this repo does).
 */

export function ssiConsumerId(): string {
  return env.ssiConsumerId ?? "";
}

export function ssiConsumerSecret(): string {
  return env.ssiConsumerSecret ?? "";
}

export function ssiCredentialsConfigured(): boolean {
  return env.ssiConfigured;
}

/** Mirror resolved aliases into SSI_FC_* so legacy process.env readers keep working. */
export function ensureSsiEnvAliases(): void {
  const id = ssiConsumerId();
  const secret = ssiConsumerSecret();
  if (id && !process.env.SSI_FC_CONSUMER_ID?.trim()) {
    process.env.SSI_FC_CONSUMER_ID = id;
  }
  if (secret && !process.env.SSI_FC_CONSUMER_SECRET?.trim()) {
    process.env.SSI_FC_CONSUMER_SECRET = secret;
  }
}

// Eager map on module load (serverless cold start)
ensureSsiEnvAliases();
