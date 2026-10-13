import { api, h, showError, yuan } from "./api.js";

const shortlist = document.querySelector("#shortlist");
const askProduct = document.querySelector("#ask-product");
const compareA = document.querySelector("#compare-a");
const compareB = document.querySelector("#compare-b");
let products = [];

document.querySelector("#search").addEventListener("click", () => {
  runSearch().catch(showError);
});

document.querySelector("#ask-button").addEventListener("click", () => {
  askSeller().catch(showError);
});

document.querySelector("#compare").addEventListener("click", () => {
  compare().catch(showError);
});

function constraints() {
  const body = {};
  const power = document.querySelector("#min-power").value;
  if (power !== "") body.minContinuousPowerW = Number(power);
  if (document.querySelector("#require-pd").checked) body.requirePd31 = true;
  const price = document.querySelector("#max-price").value;
  if (price !== "") body.maxPriceCents = Math.round(Number(price) * 100);
  if (document.querySelector("#require-returnable").checked) body.requireReturnable = true;
  return body;
}

async function runSearch() {
  document.querySelector("#error").textContent = "";
  const result = await api("/api/tools/search_products", {
    method: "POST",
    body: JSON.stringify(constraints()),
  });
  shortlist.replaceChildren();
  if (!result.products.length) {
    shortlist.append(h("p", { text: "没有满足约束的商品。" }));
    return;
  }
  for (const product of result.products) {
    const article = h("article", { "data-product-id": product.id });
    article.append(h("h3", { text: product.title }));
    article.append(h("p", { text: `${yuan(product.priceCents)} 元，库存 ${product.stock}，完整度 ${product.completeness.filled}/${product.completeness.required}` }));
    const conclusions = h("ul");
    for (const conclusion of product.conclusions) {
      conclusions.append(h("li", {}, [
        h("span", { text: `${conclusion.claim}。来源 ${conclusion.source.excerpt || conclusion.source.type}，版本 ${conclusion.version}，事实 ` }),
        h("span", { className: "fact-id", text: conclusion.factId }),
      ]));
    }
    article.append(h("h4", { text: "命中的约束" }), conclusions);
    const unknown = h("ul", { className: "unknown" });
    if (!product.unknown.length) unknown.append(h("li", { text: "必填项都已确认" }));
    for (const item of product.unknown) unknown.append(h("li", { text: `未知 ${item.name}` }));
    article.append(h("h4", { text: "未知项" }), unknown);
    for (const group of product.conflicts) {
      article.append(h("p", { text: `${group.name}：${group.label}` }));
    }
    article.append(h("button", {
      type: "button",
      className: "checkout",
      text: "前往收银台",
      onclick: () => handoff(product.id).catch(showError),
    }));
    shortlist.append(article);
  }
}

async function handoff(productId) {
  const created = await api("/api/tools/create_handoff", {
    method: "POST",
    body: JSON.stringify({
      buyerId: "buyer-demo",
      agentId: "web-buyer",
      productId,
      constraints: constraints(),
    }),
  });
  location.href = created.checkoutPath;
}

async function askSeller() {
  const result = await api("/api/tools/ask_seller", {
    method: "POST",
    body: JSON.stringify({
      productId: askProduct.value,
      attributeId: "pd31",
      condition: "PD 3.1",
      agentId: "web-agent",
    }),
  });
  const node = document.querySelector("#ask-result");
  if (result.fact) node.textContent = `已有确认事实：${result.fact.value}`;
  else if (result.limited) node.textContent = "今日提问已达上限，返回未知";
  else if (result.inboxCreated) node.textContent = "已记入问题箱";
  else node.textContent = "已并入已有问题，没有新增";
}

async function compare() {
  const result = await api("/api/tools/compare_products", {
    method: "POST",
    body: JSON.stringify({ productIds: [compareA.value, compareB.value] }),
  });
  const table = h("table");
  table.append(h("tr", {}, [h("th", { text: "属性" }), h("th", { text: "商品甲" }), h("th", { text: "商品乙" })]));
  for (const row of result.rows) {
    table.append(h("tr", {}, [
      h("td", { text: row.name }),
      ...row.cells.map((cell) => h("td", { text: cellText(cell) })),
    ]));
  }
  document.querySelector("#compare-result").replaceChildren(table);
}

function cellText(cell) {
  if (cell.state === "冲突") return "冲突，不可采信";
  if (cell.state === "未知" || cell.state === "缺失") return "未知";
  return `${cell.fact.value}${cell.fact.unit || ""}`;
}

async function loadProducts() {
  products = await api("/api/products");
  const options = products.map((product) => h("option", { value: product.id, text: product.title }));
  askProduct.replaceChildren(...options.map((option) => option.cloneNode(true)));
  compareA.replaceChildren(...products.map((product) => h("option", { value: product.id, text: product.title })));
  compareB.replaceChildren(...products.map((product) => h("option", { value: product.id, text: product.title })));
  const askTarget = products.find((product) => product.id === "prod-ask");
  if (askTarget) askProduct.value = askTarget.id;
  if (products[1]) compareB.value = products[1].id;
}

loadProducts().catch(showError);
