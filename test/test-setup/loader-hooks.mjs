/** Stub the Next.js-only 'server-only' module so pure libs run under node:test. */
const STUB = new URL("./server-only-stub.mjs", import.meta.url).href;

export async function resolve(specifier, context, next) {
  if (specifier === "server-only") {
    return { url: STUB, shortCircuit: true };
  }
  return next(specifier, context);
}
