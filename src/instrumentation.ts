/**
 * Next.js server instrumentation — runs once at process boot.
 * Maps Vercel env aliases so existing SSI_FC_* readers keep working.
 */
export async function register() {
  if (!process.env.SSI_FC_CONSUMER_ID?.trim() && process.env.SSI_API_KEY?.trim()) {
    process.env.SSI_FC_CONSUMER_ID = process.env.SSI_API_KEY.trim();
  }
  if (!process.env.SSI_FC_CONSUMER_SECRET?.trim() && process.env.SSI_API_SECRET?.trim()) {
    process.env.SSI_FC_CONSUMER_SECRET = process.env.SSI_API_SECRET.trim();
  }
  if (!process.env.SSI_FC_CONSUMER_ID?.trim() && process.env.SSI_CONSUMER_ID?.trim()) {
    process.env.SSI_FC_CONSUMER_ID = process.env.SSI_CONSUMER_ID.trim();
  }
  if (!process.env.SSI_FC_CONSUMER_SECRET?.trim() && process.env.SSI_CONSUMER_SECRET?.trim()) {
    process.env.SSI_FC_CONSUMER_SECRET = process.env.SSI_CONSUMER_SECRET.trim();
  }
}
