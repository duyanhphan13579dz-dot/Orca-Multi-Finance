/** Patch the CJS loader so the Next.js-only 'server-only' import resolves to a stub during tests. */
const Module = require("node:module");
const path = require("node:path");
const orig = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request === "server-only") return path.join(__dirname, "server-only-stub.cjs");
  return orig.call(this, request, ...args);
};
