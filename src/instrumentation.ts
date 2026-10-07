/**
 * Next.js server instrumentation — runs once at process boot.
 * Maps SSI_API_* aliases (host env vars) so all SSI readers see SSI_FC_* keys.
 */
export async function register() {
  const { ensureSsiEnvAliases } = await import("./lib/providers/ssi-credentials");
  ensureSsiEnvAliases();
}
