import assert from "node:assert/strict";
import test from "node:test";
import { createStore, seedDemo } from "../src/db.js";
import { createApp } from "../src/server.js";

test("tool routes search, hide unconfirmed facts, and create a handoff", async (t) => {
  const store = createStore(":memory:");
  seedDemo(store, Date.now());
  const server = createApp(store);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const origin = `http://127.0.0.1:${port}`;
  t.after(() => new Promise((resolve) => server.close(() => {
    store.close();
    resolve();
  })));

  const search = await post(origin, "/api/tools/search_products", {
    minContinuousPowerW: 65,
    requirePd31: true,
  });
  assert.equal(search.status, 200);
  assert.equal(search.body.products[0].id, "prod-65w");
  assert.equal(search.body.products.some((product) => product.id === "prod-nopd"), false);

  const hidden = await post(origin, "/api/tools/get_product", { productId: "prod-candidate" });
  assert.equal(hidden.body.facts.some((fact) => fact.value === "65"), false);
  assert.ok(hidden.body.unknown.some((item) => item.attributeId === "continuous_power_w" && item.value === null));

  const handoff = await post(origin, "/api/tools/create_handoff", {
    buyerId: "buyer-http",
    agentId: "agent-http",
    productId: "prod-65w",
    constraints: { minContinuousPowerW: 65, requirePd31: true },
    address: "secret-addr-http",
  });
  assert.equal(handoff.status, 201);
  assert.match(handoff.body.checkoutPath, /^\/checkout\.html\?id=/);
  const page = await fetch(`${origin}${handoff.body.checkoutPath}`);
  assert.equal(page.status, 200);
  const detail = await fetch(`${origin}/api/handoffs/${handoff.body.id}`);
  const saved = await detail.json();
  assert.equal(saved.id, handoff.body.id);
  assert.equal(JSON.stringify(saved).includes("secret-addr-http"), false);
});

async function post(origin, pathname, body) {
  const response = await fetch(`${origin}${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}
