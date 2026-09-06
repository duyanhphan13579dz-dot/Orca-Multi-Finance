/**
 * SIMPLIZE PROVIDER LAYER — audit + rights-aware contract tests.
 *
 * Verifies Phase 0–4 decisions that are encoded in code:
 *  - Không có row nào tuyên bố OFFICIAL-PUBLIC-API (audit finding).
 *  - Data getter never returns data → always honest UNAVAILABLE w/ reason.
 *  - Order book / recommendations never fabricated.
 *  - Embed descriptor is the only sanctioned surface (normalize + validate).
 *  - Provider chain keeps VNDirect primary; Simplize can't join without
 *    SIMPLIZE_DATA_ACCESS=approved-api.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  CAPABILITY_MATRIX,
  capabilityReport,
  getCapability,
  normalizeEmbedDescriptor,
  validateEmbedDescriptor,
  SimplizeProvider,
  SimplizeClient,
} from "../providers/simplize";
import { resolveVnProviderChain } from "../providers/vn-provider-chain";

test("capabilities: mọi VN data type có row, và KHÔNG row nào là official public API", () => {
  const types = CAPABILITY_MATRIX.map((c) => c.dataType);
  assert.deepEqual(
    [...types].sort(),
    [
      "analysis-reports",
      "buy-sell-signals",
      "chart-history",
      "financial-statements",
      "market-indices",
      "order-book",
      "stock-detail",
      "stock-quotes",
      "valuation-fundamentals",
    ].sort(),
  );
  assert.equal(capabilityReport().officialPublicApi, 0, "audit: không có official public API");
});

test("capabilities: chart-history = EMBED-ONLY; order-book = NOT-PERMITTED (không fake L2)", () => {
  assert.equal(getCapability("chart-history").productionUsable, "EMBED-ONLY");
  assert.equal(getCapability("chart-history").officialStatus, "WIDGET-EMBED");
  assert.equal(getCapability("order-book").productionUsable, "NOT-PERMITTED");
  assert.match(getCapability("order-book").note, /UNAVAILABLE/);
});

test("provider: mọi data getter trả UNAVAILABLE với reason quyền + source/freshness metadata", async () => {
  const p = new SimplizeProvider();
  const q = await p.quote("VNM");
  assert.equal(q.available, false);
  assert.equal(q.source, "simplize");
  assert.equal(q.freshness, "UNAVAILABLE");
  assert.match((q as { reason: string }).reason, /không có official public API/);

  const ind = await p.indices();
  assert.equal(ind.available, false);
  assert.ok((ind as { reason: string }).reason.length > 60); // reason đầy đủ, không mơ hồ

  const ob = await p.orderBook("HPG");
  assert.equal(ob.available, false);
  assert.match((ob as { reason: string }).reason, /không tạo dữ liệu giả/);

  const rec = await p.recommendations("HPG");
  assert.equal(rec.available, false);
  assert.match((rec as { reason: string }).reason, /BROKER_RECOMMENDATION/);
});

test("provider: embed cần template đã xác minh — KHÔNG hard-code URL chưa xác minh", async () => {
  const p = new SimplizeProvider(new SimplizeClient(undefined, undefined));
  const e = await p.embed("HPG");
  assert.equal(e.ok, false);
  assert.match(e.reason ?? "", /Template widget chưa được xác minh/);
});

test("adapter: normalize + validate embed descriptor (chỉ visualization, https, source simplize)", () => {
  const d = normalizeEmbedDescriptor("hpg", "https://simplize.vn/widget/hpg?period=1Y", "1Y");
  assert.ok(d);
  assert.equal(d.symbol, "HPG");
  assert.equal(d.allowedUse, "embed-visualization");
  assert.equal(d.source, "simplize");
  const v = validateEmbedDescriptor(d);
  assert.equal(v.ok, true);
  assert.equal(v.errors.length, 0);

  assert.equal(normalizeEmbedDescriptor("BAD_SYMBOL!!", "https://x", "1Y"), null);
  assert.equal(normalizeEmbedDescriptor("HPG", "http://insecure", "1Y"), null);
  assert.equal(normalizeEmbedDescriptor("HPG", "https://simplize.vn/widget/hpg", "3d"), null); // timeframe ngoài allowlist
});

test("provider chain: VNDirect luôn primary; Simplize candidate cho tới khi approved-api", () => {
  const chain = resolveVnProviderChain();
  assert.equal(chain.order[0], "vndirect");
  const simplize = chain.entries.find((e) => e.id === "simplize");
  assert.equal(simplize?.role, "candidate-embed-only");
  assert.ok(chain.entries[0].role === "primary");
  assert.equal(chain.verdict, "OPTION_C_EMBED_ONLY");
});
