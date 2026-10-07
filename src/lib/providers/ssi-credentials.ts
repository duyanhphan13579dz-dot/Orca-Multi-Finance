import "server-only";

/**
 * SSI FastConnect consumer credentials.
 *
 * Supported env pairs (first non-empty wins):
 *   1. SSI_FC_CONSUMER_ID / SSI_FC_CONSUMER_SECRET  (canonical)
 *   2. SSI_API_KEY / SSI_API_SECRET                  (Vercel aliases)
 *   3. SSI_CONSUMER_ID / SSI_CONSUMER_SECRET
 *
 * Call ensureSsiEnvAliases() early so any code still reading SSI_FC_* works.
 */

export function ssiConsumerId(): string {
  return (
    process.env.SSI_FC_CONSUMER_ID?.trim() ||
    process.env.SSI_API_KEY?.trim() ||
    process.env.SSI_CONSUMER_ID?.trim() ||
    ""
  );
}

export function ssiConsumerSecret(): string {
  return (
    process.env.SSI_FC_CONSUMER_SECRET?.trim() ||
    process.env.SSI_API_SECRET?.trim() ||
    process.env.SSI_CONSUMER_SECRET?.trim() ||
    ""
  );
}

export function ssiCredentialsConfigured(): boolean {
  return Boolean(ssiConsumerId() && ssiConsumerSecret());
}

/** Mirror aliases into SSI_FC_* so legacy process.env readers keep working. */
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
