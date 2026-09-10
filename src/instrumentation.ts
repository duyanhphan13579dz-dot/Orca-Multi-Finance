/**
 * Next.js server instrumentation — runs once at process boot.
 * Maps Vercel SSI_API_* aliases so all SSI readers see SSI_FC_* keys.
 */
export async function register() {
  const { ensureSsiEnvAliases } = await import("./lib/providers/ssi-credentials");
  ensureSsiEnvAliases();
}
