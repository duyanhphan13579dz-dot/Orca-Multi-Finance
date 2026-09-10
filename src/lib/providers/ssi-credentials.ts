import "server-only";

/**
 * SSI FastConnect consumer credentials.
 * Supports:
 *   - SSI_FC_CONSUMER_ID / SSI_FC_CONSUMER_SECRET (canonical)
 *   - SSI_API_KEY / SSI_API_SECRET (Vercel aliases)
 *   - SSI_CONSUMER_ID / SSI_CONSUMER_SECRET
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
