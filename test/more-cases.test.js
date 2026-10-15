import assert from "node:assert/strict";
import test from "node:test";
import { createStore, seedDemo } from "../src/db.js";
import { WINDOW_MS } from "../src/domain/attribution.js";
import { extractSpec } from "../src/domain/extract.js";
import { PRICE_MAX_AGE_MS } from "../src/domain/facts.js";
import { createApp } from "../src/server.js";

const DAY = 24 * 60 * 60 * 1000;

function setup() {
  const now = Date.UTC(2026, 9, 13);
  const store = createStore(":memory:");
  seedDemo(store, now);
  return { store, now };
}

function confirmAll(store, candidates, by, now) {
  for (const candidate of candidates) store.confirmFact(candidate.id, { by, now });
}

function withFacts(store, id, text, by, now, extra = {}) {
  const product = store.createProduct({
    id,
    sellerId: "seller-a",
    title: id,
    priceCents: 1000,
    stock: 1,
    returnable: true,
    ...extra,
  }, now);
  confirmAll(store, store.addDocument(product.id, { filename: `${id}.txt`, text }, now).candidates, by, now);
  return product;
}

const FULL = ["持续输出功率: 65W", "PD 3.1: 支持", "是否含电源线: 含电源线"].join("\n");

test("extract accepts fullwidth punctuation and keeps unlabeled lines as notes", () => {
  const extracted = extractSpec("持续输出功率：65W\n峰值输出功率: 100W\nPD  3.1：不兼容\n65W 很强\n");
  assert.deepEqual(extracted.candidates.map((item) => [item.attributeId, item.value, item.condition]), [
    ["continuous_power_w", "65", "持续输出"],
    ["peak_power_w", "100", "峰值"],
    ["pd31", "不兼容", "PD 3.1"],
  ]);
  assert.deepEqual(extracted.notes, ["65W 很强"]);
});

test("reject and mark-unknown never become searchable specs", (t) => {
  const { store, now } = setup();
  t.after(() => store.close());
  const seller = store.getSellerProduct("prod-candidate");
  const cable = seller.candidates.find((fact) => fact.attributeId === "includes_cable");
  const power = seller.candidates.find((fact) => fact.attributeId === "continuous_power_w");
  store.rejectFact(cable.id, { by: "seller-a", now });
  const unknown = store.markUnknown(power.id, { by: "seller-a", now });
  assert.equal(unknown.trustLevel, "未知");
  assert.equal(unknown.value, null);
  const agent = store.getAgentProduct("prod-candidate");
  assert.equal(agent.facts.some((fact) => fact.value === "65" || fact.value === "不含电源线"), false);
  assert.ok(agent.unknown.some((item) => item.attributeId === "continuous_power_w" && item.value === null));
  assert.ok(agent.unknown.some((item) => item.attributeId === "includes_cable"));
  assert.equal(store.search({ minContinuousPowerW: 65, requirePd31: true }, now).products.some((product) => product.id === "prod-candidate"), false);
});

test("seller can correct a candidate before it is confirmed", (t) => {
  const { store, now } = setup();
  t.after(() => store.close());
  const seller = store.getSellerProduct("prod-candidate");
  const power = seller.candidates.find((fact) => fact.attributeId === "continuous_power_w");
  const confirmed = store.confirmFact(power.id, { value: "70", by: "seller-a", now });
  assert.equal(confirmed.value, "70");
  assert.equal(confirmed.trustLevel, "规格");
  const pd = store.getSellerProduct("prod-candidate").candidates.find((fact) => fact.attributeId === "pd31");
  const cable = store.getSellerProduct("prod-candidate").candidates.find((fact) => fact.attributeId === "includes_cable");
  store.confirmFact(pd.id, { by: "seller-a", now });
  store.confirmFact(cable.id, { by: "seller-a", now });
  const at70 = store.search({ minContinuousPowerW: 70, requirePd31: true }, now).products.map((product) => product.id);
  assert.ok(at70.includes("prod-candidate"));
  assert.equal(at70.includes("prod-65w"), false);
});

test("the same number written as 65.0 does not open a conflict", (t) => {
  const { store, now } = setup();
  t.after(() => store.close());
  const added = store.addDocument("prod-65w", { filename: "same.txt", text: "持续输出功率: 65.0W" }, now);
  const confirmed = store.confirmFact(added.candidates[0].id, { by: "seller-a", now });
  assert.equal(confirmed.status, "confirmed");
  assert.equal(store.getAgentProduct("prod-65w").conflicts.length, 0);
  assert.ok(store.search({ minContinuousPowerW: 65, requirePd31: true }, now).products.some((product) => product.id === "prod-65w"));
});

test("invalid values and a direct seller entry stay in the template", (t) => {
  const { store, now } = setup();
  t.after(() => store.close());
  const seller = store.getSellerProduct("prod-candidate");
  const pd = seller.candidates.find((fact) => fact.attributeId === "pd31");
  const power = seller.candidates.find((fact) => fact.attributeId === "continuous_power_w");
  assert.throws(() => store.confirmFact(pd.id, { value: "也许", by: "seller-a", now }), (error) => error.status === 400);
  assert.throws(() => store.confirmFact(power.id, { value: "很高", by: "seller-a", now }), (error) => error.status === 400);
  const created = store.createSellerFact("prod-ask", { attributeId: "input_voltage", value: "100-240V", by: "seller-a" }, now);
  assert.equal(created.trustLevel, "确认参数");
  assert.equal(created.status, "confirmed");
  assert.equal(store.getAgentProduct("prod-ask").facts.find((fact) => fact.attributeId === "input_voltage").value, "100-240V");
});

test("price age, exact price ceiling, and stock break ties", (t) => {
  const { store, now } = setup();
  t.after(() => store.close());
  withFacts(store, "prod-age-ok", FULL, "seller-a", now, { priceUpdatedAt: now - PRICE_MAX_AGE_MS, priceCents: 5000, stock: 2 });
  withFacts(store, "prod-age-stale", FULL, "seller-a", now, { priceUpdatedAt: now - PRICE_MAX_AGE_MS - 1, priceCents: 5000, stock: 2 });
  withFacts(store, "prod-stock-low", FULL, "seller-a", now, { priceCents: 1000, stock: 3 });
  withFacts(store, "prod-stock-high", FULL, "seller-a", now, { priceCents: 1000, stock: 30 });
  const ids = store.search({ minContinuousPowerW: 65, requirePd31: true }, now).products.map((product) => product.id);
  assert.ok(ids.includes("prod-age-ok"));
  assert.equal(ids.includes("prod-age-stale"), false);
  assert.ok(ids.indexOf("prod-stock-high") < ids.indexOf("prod-stock-low"));
  const capped = store.search({ minContinuousPowerW: 65, requirePd31: true, maxPriceCents: 9900 }, now);
  assert.ok(capped.products.some((product) => product.id === "prod-65w"));
  const below = store.search({ minContinuousPowerW: 65, requirePd31: true, maxPriceCents: 9899 }, now);
  assert.equal(below.products.some((product) => product.id === "prod-65w"), false);
  const all = store.search({ pageSize: 50 }, now);
  const second = store.search({ page: 2, pageSize: 1 }, now);
  assert.equal(second.products[0].id, all.products[1].id);
  assert.equal(second.total, all.total);
});

test("marking a confirmed power unknown removes the product from a power search", (t) => {
  const { store, now } = setup();
  t.after(() => store.close());
  const power = store.getAgentProduct("prod-partial").facts.find((fact) => fact.attributeId === "continuous_power_w");
  store.markUnknown(power.id, { by: "seller-a", now });
  const agent = store.getAgentProduct("prod-partial");
  assert.equal(agent.facts.some((fact) => fact.attributeId === "continuous_power_w"), false);
  assert.ok(agent.unknown.some((item) => item.attributeId === "continuous_power_w" && item.value === null));
  assert.equal(store.search({ minContinuousPowerW: 65 }, now).products.some((product) => product.id === "prod-partial"), false);
  assert.equal(store.getAgentProduct("prod-partial").product.status, "on_sale");
});

test("an off-sale product can still be read but cannot be handed off", (t) => {
  const { store, now } = setup();
  t.after(() => store.close());
  store.updateProduct("prod-65w", { status: "off_sale" });
  assert.equal(store.getAgentProduct("prod-65w").facts.length > 0, true);
  assert.throws(
    () => store.createHandoff({
      buyerId: "buyer-1",
      agentId: "agent-1",
      productId: "prod-65w",
      constraints: { minContinuousPowerW: 65, requirePd31: true },
    }, now),
    (error) => error.status === 409,
  );
});

test("handoff rejects incompatible and stale products", (t) => {
  const { store, now } = setup();
  t.after(() => store.close());
  assert.throws(
    () => store.createHandoff({
      buyerId: "buyer-1",
      agentId: "agent-1",
      productId: "prod-nopd",
      constraints: { minContinuousPowerW: 65, requirePd31: true },
    }, now),
    (error) => error.status === 409,
  );
  assert.throws(
    () => store.createHandoff({
      buyerId: "buyer-1",
      agentId: "agent-1",
      productId: "prod-stale",
      constraints: { minContinuousPowerW: 65, requirePd31: true },
    }, now),
    (error) => error.status === 409,
  );
});

test("attribution counts the seventh day and ignores a late refund", (t) => {
  const { store, now } = setup();
  t.after(() => store.close());
  const handoff = store.createHandoff({
    buyerId: "buyer-1",
    agentId: "agent-1",
    productId: "prod-65w",
    constraints: { minContinuousPowerW: 65 },
  }, now);
  const onTime = store.reportOrder({
    attributionId: handoff.id,
    orderNo: "DAY-7",
    amountCents: 9900,
    status: "paid",
    reportedAt: now + WINDOW_MS,
    reportedBy: "seller-a",
  });
  assert.equal(onTime.counted, true);
  assert.equal(onTime.platformSale, true);
  const late = store.createHandoff({
    buyerId: "buyer-2",
    agentId: "agent-1",
    productId: "prod-65w",
    constraints: {},
  }, now);
  const refunded = store.reportOrder({
    attributionId: late.id,
    orderNo: "LATE",
    amountCents: 9900,
    status: "refunded",
    reportedAt: now + WINDOW_MS + 1,
    reportedBy: "seller-a",
  });
  assert.equal(refunded.counted, false);
  assert.equal(refunded.commissionStatus, null);
  assert.equal(store.listPlatformSales().some((order) => order.handoffId === late.id), false);
});

test("questions stay separate across conditions, agents, and sellers", (t) => {
  const { store, now } = setup();
  t.after(() => store.close());
  assert.throws(() => store.askSeller({}, now), (error) => {
    assert.deepEqual(error.missing, ["productId", "attributeId", "condition", "agentId"]);
    return error.status === 400;
  });
  assert.throws(
    () => store.askSeller({ productId: "missing", attributeId: "pd31", condition: "PD 3.1", agentId: "a" }, now),
    (error) => error.status === 404,
  );
  assert.throws(
    () => store.askSeller({ productId: "prod-65w", attributeId: "pd31", condition: "   ", agentId: "a" }, now),
    (error) => error.missing.includes("condition"),
  );
  const otherCondition = store.askSeller({
    productId: "prod-65w",
    attributeId: "continuous_power_w",
    condition: "峰值",
    agentId: "agent-peak",
  }, now);
  assert.equal(otherCondition.inboxCreated, true);
  assert.equal(otherCondition.fact, null);
  assert.equal(store.search({ minContinuousPowerW: 65 }, now).products.some((product) => product.id === "prod-65w"), true);

  for (let index = 0; index < 20; index += 1) {
    store.askSeller({
      productId: "prod-peak",
      attributeId: "input_voltage",
      condition: `甲${index}`,
      agentId: "agent-limited",
    }, now);
  }
  const blocked = store.askSeller({
    productId: "prod-peak",
    attributeId: "input_voltage",
    condition: "甲再问",
    agentId: "agent-limited",
  }, now);
  assert.equal(blocked.limited, true);
  const otherAgent = store.askSeller({
    productId: "prod-peak",
    attributeId: "input_voltage",
    condition: "乙的条件",
    agentId: "agent-other",
  }, now);
  assert.equal(otherAgent.inboxCreated, true);
  const otherSeller = store.askSeller({
    productId: "prod-nopd",
    attributeId: "input_voltage",
    condition: "输入",
    agentId: "agent-limited",
  }, now);
  assert.equal(otherSeller.inboxCreated, true);
});

test("a free-text reply is not a spec until it contains a template value", (t) => {
  const { store, now } = setup();
  t.after(() => store.close());
  const asked = store.askSeller({
    productId: "prod-ask",
    attributeId: "pd31",
    condition: "PD 3.1",
    agentId: "agent-1",
  }, now);
  const answered = store.answerCluster(asked.clusterId, { text: "我觉得可以", by: "seller-a", now });
  assert.equal(answered.candidate, null);
  assert.equal(store.listInbox("seller-a")[0].answers[0].trustLevel, "未确认问答");
  assert.equal(store.getAgentProduct("prod-ask").facts.some((fact) => fact.attributeId === "pd31"), false);
  const structured = store.answerCluster(asked.clusterId, { text: "PD 3.1: 支持", by: "seller-a", now });
  assert.equal(structured.candidate.value, "支持");
  assert.equal(store.search({ requirePd31: true }, now).products.some((product) => product.id === "prod-ask"), false);
});

test("resolving a conflict to 40W keeps the product out of a 65W search", (t) => {
  const { store, now } = setup();
  t.after(() => store.close());
  const added = store.addDocument("prod-partial", { filename: "low.txt", text: "持续输出功率: 40W" }, now);
  const conflicted = store.confirmFact(added.candidates[0].id, { by: "seller-a", now });
  assert.equal(conflicted.status, "conflict");
  assert.equal(store.search({ minContinuousPowerW: 65 }, now).products.some((product) => product.id === "prod-partial"), false);
  const chosen = store.getSellerProduct("prod-partial").conflicts[0].facts.find((fact) => fact.value === "40");
  store.resolveConflict({
    productId: "prod-partial",
    attributeId: "continuous_power_w",
    condition: "持续输出",
    chosenFactId: chosen.id,
    by: "seller-a",
    now,
  });
  const power = store.getAgentProduct("prod-partial").facts.find((fact) => fact.attributeId === "continuous_power_w");
  assert.equal(power.value, "40");
  assert.equal(store.search({ minContinuousPowerW: 65 }, now).products.some((product) => product.id === "prod-partial"), false);
  assert.ok(store.search({ minContinuousPowerW: 40 }, now).products.some((product) => product.id === "prod-partial"));
});

test("compare reports a missing product and rejects a single id", (t) => {
  const { store } = setup();
  t.after(() => store.close());
  const compared = store.compare(["prod-65w", "missing-id"]);
  assert.deepEqual(compared.notFound, ["missing-id"]);
  const cell = compared.rows[0].cells.find((item) => item.productId === "missing-id");
  assert.equal(cell.state, "缺失");
  assert.throws(() => store.compare(["prod-65w"]), (error) => error.status === 400);
  assert.throws(() => store.search({ minContinuousPowerW: "很高" }, Date.UTC(2026, 9, 13)), (error) => error.status === 400);
});

test("http routes reject a bad handoff and a short compare", async (t) => {
  const { store, now } = setup();
  const server = createApp(store);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  t.after(() => new Promise((resolve) => server.close(() => {
    store.close();
    resolve();
  })));

  const handoff = await post(origin, "/api/tools/create_handoff", {
    buyerId: "buyer-http",
    agentId: "agent-http",
    productId: "prod-nopd",
    constraints: { requirePd31: true },
  }, { "idempotency-key": "http-reject" });
  assert.equal(handoff.status, 409);
  assert.equal(handoff.body.errorEn, "The product does not meet the current constraints");

  const compare = await post(origin, "/api/tools/compare_products", { productIds: ["prod-65w"] });
  assert.equal(compare.status, 400);

  const ask = await post(origin, "/api/tools/ask_seller", { productId: "prod-ask" });
  assert.equal(ask.status, 400);
  assert.deepEqual(ask.body.missing, ["attributeId", "condition", "agentId"]);

  const paid = await post(origin, "/api/tools/create_handoff", {
    buyerId: "buyer-http",
    agentId: "agent-http",
    productId: "prod-65w",
    constraints: { minContinuousPowerW: 65 },
  }, { "idempotency-key": "http-paid" });
  const late = await post(origin, "/api/orders/report", {
    attributionId: paid.body.id,
    orderNo: "HTTP-LATE",
    amountCents: 9900,
    status: "paid",
    reportedAt: paid.body.createdAt + WINDOW_MS + DAY,
  }, { "idempotency-key": "http-late-order" });
  assert.equal(late.status, 200);
  assert.equal(late.body.counted, false);
});

test("visible facts, conclusions, and titles carry an English counterpart", (t) => {
  const { store, now } = setup();
  t.after(() => store.close());
  const found = store.search({ minContinuousPowerW: 65, requirePd31: true }, now);
  const first = found.products.find((product) => product.id === "prod-65w");
  assert.equal(first.titleEn, "65W GaN adapter");
  assert.equal(first.conclusions[0].claimEn.startsWith("Continuous output"), true);
  const agent = store.getAgentProduct("prod-65w");
  const power = agent.facts.find((fact) => fact.attributeId === "continuous_power_w");
  assert.equal(power.nameEn, "Continuous output power");
  assert.equal(power.trustLevelEn, "Spec");
  const compared = store.compare(["prod-65w", "prod-conflict"]);
  const row = compared.rows.find((item) => item.attributeId === "continuous_power_w");
  assert.equal(row.nameEn, "Continuous output power");
  assert.equal(row.cells[1].labelEn, "Conflict, not reliable");
  const sellers = store.listSellers();
  assert.equal(sellers.find((seller) => seller.id === "seller-a").nameEn, "Steady Voltage Studio");
});

test("model, certification, freshness messages, availability, and attribution stay checkable", (t) => {
  const { store, now } = setup();
  t.after(() => store.close());
  const byModel = store.search({ modelCode: "GAN-65" }, now);
  assert.deepEqual(byModel.products.map((product) => product.id), ["prod-65w"]);
  assert.equal(byModel.products[0].conclusions[0].constraint, "modelCode");
  assert.equal(byModel.products[0].conclusions[0].status, "met");
  assert.ok(byModel.products[0].conclusions[0].factId);
  const titled = store.search({ modelCode: "65W" }, now);
  assert.equal(titled.products.some((product) => product.title.includes("65W")), false);
  assert.ok(titled.messages.some((item) => item.code === "constraint_unknown" && item.attributeId === "model_code"));

  const cert = store.getAgentProduct("prod-65w").facts.find((fact) => fact.attributeId === "safety_cert");
  assert.equal(cert.certification.name, "CE");
  assert.equal(cert.certification.body, "CQC");
  assert.equal(cert.certification.id, "CQC-2024-65");
  assert.equal(cert.certification.url, "https://example.com/certs/gan-65.pdf");

  const power = store.search({ minContinuousPowerW: 65, requirePd31: true }, now);
  const stale = power.messages.find((item) => item.productId === "prod-stale");
  assert.equal(stale.code, "price_stale");
  assert.equal(typeof stale.priceUpdatedAt, "number");
  assert.ok(power.products.every((product) => product.priceUpdatedAt && product.stockUpdatedAt));
  assert.ok(power.messages.some((item) => item.code === "constraint_conflict" && item.productId === "prod-conflict"));
  assert.ok(power.products.some((product) => product.id === "prod-preorder" && product.availability === "preorder"));

  const inStock = store.search({ minContinuousPowerW: 65, requirePd31: true, requireInStock: true }, now);
  assert.equal(inStock.products.some((product) => product.id === "prod-preorder"), false);
  assert.ok(inStock.messages.some((item) => item.code === "availability_excluded" && item.productId === "prod-preorder"));

  const first = store.createHandoff({
    buyerId: "buyer-same",
    agentId: "agent-1",
    productId: "prod-65w",
    constraints: { minContinuousPowerW: 65 },
  }, now);
  const second = store.createHandoff({
    buyerId: "buyer-same",
    agentId: "agent-2",
    productId: "prod-65w",
    constraints: { minContinuousPowerW: 65 },
  }, now + 1000);
  const lateClaim = store.reportOrder({
    attributionId: second.id,
    orderNo: "SECOND",
    amountCents: 9900,
    status: "paid",
    reportedAt: now + 2000,
    reportedBy: "seller-a",
  });
  assert.equal(lateClaim.counted, false);
  assert.equal(lateClaim.winningHandoffId, first.id);
  assert.equal(store.listPlatformSales().some((order) => order.handoffId === second.id), false);
  const saved = store.getHandoff(first.id);
  assert.equal(saved.buyerId, undefined);
  assert.equal(saved.priceChanged, false);
  store.updateProduct("prod-65w", { priceCents: 10900 });
  const changed = store.getHandoff(first.id);
  assert.equal(changed.observedPriceCents, 9900);
  assert.equal(changed.currentPriceCents, 10900);
  assert.equal(changed.priceChanged, true);
  assert.equal(changed.deltaCents, 1000);
});

async function post(origin, pathname, body, headers = {}) {
  const response = await fetch(`${origin}${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json(), headers: response.headers };
}
