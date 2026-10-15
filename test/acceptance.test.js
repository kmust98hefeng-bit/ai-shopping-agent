import assert from "node:assert/strict";
import test from "node:test";
import { createStore, seedDemo } from "../src/db.js";
import { extractSpec } from "../src/domain/extract.js";

const DAY = 24 * 60 * 60 * 1000;

function setup() {
  const now = Date.UTC(2026, 9, 13);
  const store = createStore(":memory:");
  seedDemo(store, now);
  return { store, now };
}

function powerSearch(store, now, extra = {}) {
  return store.search({ minContinuousPowerW: 65, requirePd31: true, ...extra }, now);
}

test("extracts labeled facts and leaves marketing text as notes", () => {
  const extracted = extractSpec("持续输出功率: 65W\n\n手感极佳\n");
  assert.equal(extracted.candidates[0].lineNo, 1);
  assert.equal(extracted.candidates[0].value, "65");
  assert.equal(extracted.candidates[0].condition, "持续输出");
  assert.deepEqual(extracted.notes, ["手感极佳"]);
  assert.equal(extractSpec("今天天气不错").candidates.length, 0);
});

test("search enforces continuous power, PD 3.1, freshness, and completeness order", (t) => {
  const { store, now } = setup();
  t.after(() => store.close());
  const result = powerSearch(store, now, { boostProductId: "prod-partial" });
  assert.deepEqual(result.products.map((product) => product.id), ["prod-65w", "prod-preorder", "prod-partial"]);
  const peak = store.getAgentProduct("prod-peak");
  assert.equal(peak.facts.find((fact) => fact.attributeId === "continuous_power_w").condition, "峰值");
  assert.equal(peak.facts.find((fact) => fact.attributeId === "continuous_power_w").matchesTemplateCondition, false);
  assert.ok(peak.unknown.some((item) => item.attributeId === "continuous_power_w" && item.value === null));
  for (const product of result.products) {
    for (const conclusion of product.conclusions) {
      assert.ok(conclusion.factId);
      assert.ok(conclusion.source);
    }
  }
  const partial = result.products.find((product) => product.id === "prod-partial");
  assert.ok(partial.unknown.some((item) => item.attributeId === "includes_cable" && item.value === null));
  const priced = powerSearch(store, now, { maxPriceCents: 8000 });
  assert.deepEqual(priced.products.map((product) => product.id), ["prod-partial"]);
  store.updateProduct("prod-partial", { returnable: false });
  const returnable = powerSearch(store, now, { requireReturnable: true });
  assert.deepEqual(returnable.products.map((product) => product.id), ["prod-65w"]);
  store.updateProduct("prod-65w", { status: "off_sale" });
  assert.equal(powerSearch(store, now).products.some((product) => product.id === "prod-65w"), false);
});

test("marketing copy does not change completeness", (t) => {
  const { store, now } = setup();
  t.after(() => store.close());
  const product = store.getAgentProduct("prod-65w");
  assert.equal(product.completeness.required, 4);
  assert.equal(product.completeness.filled, 4);
  assert.match(product.product.description.text, /手感极佳/);
  assert.match(product.notes.text, /手感极佳/);
  assert.equal(product.facts.some((fact) => String(fact.value).includes("手感")), false);
});

test("unconfirmed extraction stays hidden until the seller confirms it", (t) => {
  const { store, now } = setup();
  t.after(() => store.close());
  const before = store.getAgentProduct("prod-candidate");
  assert.equal(before.facts.some((fact) => fact.value === "65"), false);
  assert.ok(before.unknown.some((item) => item.attributeId === "continuous_power_w" && item.value === null));
  const seller = store.getSellerProduct("prod-candidate");
  const power = seller.candidates.find((fact) => fact.attributeId === "continuous_power_w");
  const confirmed = store.confirmFact(power.id, { by: "seller-a", now });
  assert.equal(confirmed.trustLevel, "规格");
  assert.equal(confirmed.sourceLineNo || confirmed.lineNo, 1);
  const after = store.getAgentProduct("prod-candidate");
  const fact = after.facts.find((item) => item.attributeId === "continuous_power_w");
  assert.equal(fact.value, "65");
  assert.equal(fact.trustLevel, "规格");
  assert.equal(fact.source.lineNo, 1);
});

test("a failed extract keeps the product and leaves required fields unknown", (t) => {
  const { store, now } = setup();
  t.after(() => store.close());
  const created = store.createProduct({
    sellerId: "seller-a",
    title: "空规格",
    priceCents: 1000,
    stock: 1,
    returnable: true,
  }, now);
  const added = store.addDocument(created.id, { filename: "empty.txt", text: "今天天气不错" }, now);
  assert.equal(added.candidates.length, 0);
  assert.equal(store.product(created.id).title, "空规格");
  assert.equal(store.getAgentProduct(created.id).unknown.length, 5);
});

test("sellers cannot invent filter fields, and template edits keep existing facts", (t) => {
  const { store, now } = setup();
  t.after(() => store.close());
  assert.throws(
    () => store.createSellerFact("prod-65w", { attributeId: "not_a_field", value: "1", by: "seller-a" }, now),
    (error) => error.status === 400,
  );
  const before = store.getAgentProduct("prod-65w").facts.map((fact) => fact.id).sort();
  store.addAttribute({ id: "color", name: "颜色", dataType: "text", kind: "constraint", required: false, condition: "外观" });
  assert.deepEqual(store.getAgentProduct("prod-65w").facts.map((fact) => fact.id).sort(), before);
  store.updateAttribute("continuous_power_w", { name: "持续功率" });
  assert.equal(store.attribute("continuous_power_w").name, "持续功率");
  assert.equal(store.getAgentProduct("prod-65w").facts.find((fact) => fact.attributeId === "continuous_power_w").value, "65");
  store.addAttribute({ id: "certification", name: "认证", dataType: "text", kind: "constraint", required: true, condition: "认证" });
  const unknown = store.getAgentProduct("prod-65w").unknown.find((item) => item.attributeId === "certification");
  assert.equal(unknown.value, null);
  assert.equal(unknown.trustLevel, "未知");
});

test("revising a fact keeps the previous version", (t) => {
  const { store, now } = setup();
  t.after(() => store.close());
  const current = store.getAgentProduct("prod-65w").facts.find((fact) => fact.attributeId === "continuous_power_w");
  const revised = store.reviseFact(current.id, { value: "67", by: "seller-a", now });
  assert.equal(revised.version, 2);
  assert.equal(revised.trustLevel, "确认参数");
  const history = store.getFactHistory(revised.id);
  assert.equal(history.length, 2);
  assert.equal(history.find((fact) => fact.version === 1).status, "superseded");
  assert.equal(store.getAgentProduct("prod-65w").facts.find((fact) => fact.attributeId === "continuous_power_w").value, "67");
});

test("a contradictory source conflicts instead of overwriting, and the seller can resolve it", (t) => {
  const { store, now } = setup();
  t.after(() => store.close());
  const compared = store.compare(["prod-conflict", "prod-65w"]);
  const cell = compared.rows.find((row) => row.attributeId === "continuous_power_w").cells.find((item) => item.productId === "prod-conflict");
  assert.equal(cell.usable, false);
  assert.equal(cell.label, "冲突，不可采信");
  assert.deepEqual(cell.alternatives.map((fact) => fact.value).sort(), ["100", "65"]);
  assert.equal(powerSearch(store, now).products.some((product) => product.id === "prod-conflict"), false);

  const added = store.addDocument("prod-65w", { filename: "later.txt", text: "持续输出功率: 100W" }, now);
  const conflicted = store.confirmFact(added.candidates[0].id, { by: "seller-a", now });
  assert.equal(conflicted.status, "conflict");
  assert.equal(store.getAgentProduct("prod-65w").facts.some((fact) => fact.attributeId === "continuous_power_w"), false);
  assert.equal(powerSearch(store, now).products.some((product) => product.id === "prod-65w"), false);

  const chosen = store.getSellerProduct("prod-conflict").conflicts[0].facts.find((fact) => fact.value === "65");
  store.resolveConflict({
    productId: "prod-conflict",
    attributeId: "continuous_power_w",
    condition: "持续输出",
    chosenFactId: chosen.id,
    by: "seller-b",
    now,
  });
  assert.equal(store.getAgentProduct("prod-conflict").facts.find((fact) => fact.attributeId === "continuous_power_w").value, "65");
});

test("questions dedupe, stay unconfirmed until promotion, and do not store buyer secrets", (t) => {
  const { store, now } = setup();
  t.after(() => store.close());
  assert.throws(
    () => store.askSeller({ productId: "prod-ask", attributeId: "pd31", agentId: "agent-0" }, now),
    (error) => error.status === 400 && error.missing.includes("condition"),
  );
  const cited = store.askSeller({
    productId: "prod-65w",
    attributeId: "pd31",
    condition: "PD 3.1",
    agentId: "agent-0",
  }, now);
  assert.equal(cited.fact.value, "支持");
  assert.equal(cited.inboxCreated, false);

  const first = store.askSeller({
    productId: "prod-ask",
    attributeId: "pd31",
    condition: "PD 3.1",
    agentId: "agent-0",
    budget: "secret-budget-8848",
    address: "secret-address-77",
    identity: "secret-person-33",
  }, now);
  assert.equal(first.inboxCreated, true);
  assert.equal(first.fact, null);
  for (let index = 1; index < 10; index += 1) {
    const again = store.askSeller({
      productId: "prod-ask",
      attributeId: "pd31",
      condition: "PD 3.1",
      agentId: `agent-${index}`,
    }, now);
    assert.equal(again.inboxCreated, false);
  }
  assert.equal(store.listInbox("seller-a").length, 1);
  const dumped = JSON.stringify(store.inspectQuestions());
  assert.equal(dumped.includes("secret-budget-8848"), false);
  assert.equal(dumped.includes("secret-address-77"), false);
  assert.equal(dumped.includes("secret-person-33"), false);

  const answered = store.answerCluster(first.clusterId, { text: "支持", value: "支持", by: "seller-a", now });
  assert.equal(store.getAgentProduct("prod-ask").facts.some((fact) => fact.attributeId === "pd31"), false);
  assert.equal(powerSearch(store, now).products.some((product) => product.id === "prod-ask"), false);
  const promoted = store.confirmFact(answered.candidate.id, { by: "seller-a", now });
  assert.equal(promoted.trustLevel, "晋升事实");
  assert.equal(powerSearch(store, now).products.some((product) => product.id === "prod-ask"), true);
  const repeat = store.askSeller({
    productId: "prod-ask",
    attributeId: "pd31",
    condition: "PD 3.1",
    agentId: "agent-0",
  }, now);
  assert.equal(repeat.inboxCreated, false);
  assert.equal(repeat.fact.value, "支持");
  assert.equal(store.listInbox("seller-a").length, 0);
  assert.equal(store.inspectQuestions().clusters.length, 1);
});

test("the same agent cannot open more than 20 human questions for one seller in a day", (t) => {
  const { store, now } = setup();
  t.after(() => store.close());
  for (let index = 0; index < 20; index += 1) {
    const created = store.askSeller({
      productId: "prod-peak",
      attributeId: "input_voltage",
      condition: `条件${index}`,
      agentId: "busy-agent",
    }, now);
    assert.equal(created.inboxCreated, true);
  }
  const limited = store.askSeller({
    productId: "prod-peak",
    attributeId: "input_voltage",
    condition: "条件20",
    agentId: "busy-agent",
  }, now);
  assert.equal(limited.limited, true);
  assert.equal(limited.inboxCreated, false);
  assert.equal(limited.trustLevel, "未知");
  assert.equal(store.listInbox("seller-a").filter((item) => item.attributeId === "input_voltage").length, 20);
});

test("handoffs keep attribution inside seven days and mark refunds for reversal", (t) => {
  const { store, now } = setup();
  t.after(() => store.close());
  const handoff = store.createHandoff({
    buyerId: "buyer-1",
    agentId: "agent-1",
    productId: "prod-65w",
    constraints: { minContinuousPowerW: 65, requirePd31: true },
    address: "secret-addr-99",
  }, now);
  assert.equal(handoff.checkoutPath, `/checkout.html?id=${handoff.id}`);
  assert.equal(JSON.stringify(store.getHandoff(handoff.id)).includes("secret-addr-99"), false);
  assert.ok(store.listHandoffs("seller-a").some((row) => row.id === handoff.id));

  const outside = store.reportOrder({
    attributionId: handoff.id,
    orderNo: "OUT-1",
    amountCents: 9900,
    status: "paid",
    reportedAt: now + 8 * DAY,
    reportedBy: "seller-a",
  });
  assert.equal(outside.counted, false);
  assert.equal(store.listPlatformSales().some((order) => order.handoffId === handoff.id), false);

  const second = store.createHandoff({
    buyerId: "buyer-2",
    agentId: "agent-1",
    productId: "prod-65w",
    constraints: { minContinuousPowerW: 65, requirePd31: true },
  }, now);
  const paid = store.reportOrder({
    attributionId: second.id,
    orderNo: "IN-1",
    amountCents: 9900,
    status: "paid",
    reportedAt: now + 6 * DAY,
    reportedBy: "seller-a",
  });
  assert.equal(paid.counted, true);
  assert.equal(paid.platformSale, true);
  const refunded = store.reportOrder({
    attributionId: second.id,
    orderNo: "IN-1",
    amountCents: 9900,
    status: "refunded",
    reportedAt: now + 6 * DAY,
    reportedBy: "seller-a",
  });
  assert.equal(refunded.commissionStatus, "待冲正");
  assert.equal(refunded.counted, true);
  assert.equal(store.listPlatformSales().some((order) => order.handoffId === second.id), false);
});

test("search pages are capped at 50", (t) => {
  const { store, now } = setup();
  t.after(() => store.close());
  const page = store.search({ page: 1, pageSize: 1 }, now);
  assert.equal(page.products.length, 1);
  assert.ok(page.total > 1);
  assert.equal(store.search({ pageSize: 100 }, now).pageSize, 50);
});
