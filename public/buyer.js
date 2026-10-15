import { api, h, line, showError, yuan } from "./api.js";

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
  if (document.querySelector("#require-stock").checked) body.requireInStock = true;
  const model = document.querySelector("#model-code").value.trim();
  if (model) body.modelCode = model;
  return body;
}

async function runSearch() {
  document.querySelector("#error").textContent = "";
  const result = await api("/api/tools/search_products", {
    method: "POST",
    body: JSON.stringify(constraints()),
  });
  shortlist.replaceChildren();
  if (result.messages?.length) {
    const notes = h("div", { className: "messages" });
    notes.append(h("h3", {}, [line("未进入短名单的原因", "Why some products are not listed")]));
    const list = h("ul");
    for (const message of result.messages) {
      list.append(h("li", {}, [line(message.text, message.textEn)]));
    }
    notes.append(list);
    shortlist.append(notes);
  }
  if (!result.products.length) {
    shortlist.append(h("p", {}, [line("没有满足约束的商品。", "No product meets the constraints.")]));
    return;
  }
  for (const product of result.products) {
    const article = h("article", { "data-product-id": product.id });
    article.append(h("h3", {}, [line(product.title, product.titleEn)]));
    article.append(h("p", {}, [line(
      `${yuan(product.priceCents)} 元，标价更新于 ${day(product.priceUpdatedAt)}，${availabilityText(product)[0]}，库存 ${product.stock}（更新于 ${day(product.stockUpdatedAt)}），完整度 ${product.completeness.filled}/${product.completeness.required}`,
      `${yuan(product.priceCents)} CNY, price updated ${day(product.priceUpdatedAt)}, ${availabilityText(product)[1]}, stock ${product.stock} (updated ${day(product.stockUpdatedAt)}), completeness ${product.completeness.filled}/${product.completeness.required}`,
    )]));
    const conclusions = h("ul");
    for (const conclusion of product.conclusions) {
      conclusions.append(h("li", {}, [
        line(
          `${conclusion.constraint} · ${conclusion.status} · ${conclusion.claim}。来源 ${conclusion.source?.excerpt || conclusion.source?.type || "—"}，事实 ${conclusion.factId || "—"}`,
          `${conclusion.constraint} · ${conclusion.status} · ${conclusion.claimEn || conclusion.claim}. Source ${conclusion.source?.excerpt || conclusion.source?.type || "—"}, fact ${conclusion.factId || "—"}`,
        ),
      ]));
    }
    article.append(h("h4", {}, [line("命中的约束", "Matched constraints")]), conclusions);
    const unknown = h("ul", { className: "unknown" });
    if (!product.unknown.length) unknown.append(h("li", {}, [line("必填项都已确认", "Every required field is confirmed")]));
    for (const item of product.unknown) unknown.append(h("li", {}, [line(`未知 ${item.name}`, `Unknown ${item.nameEn || item.name}`)]));
    article.append(h("h4", {}, [line("未知项", "Unknown fields")]), unknown);
    for (const group of product.conflicts) {
      article.append(h("p", {}, [line(`${group.name}：${group.label}`, `${group.nameEn || group.name}: ${group.labelEn || group.label}`)]));
    }
    article.append(h("button", {
      type: "button",
      className: "checkout",
      onclick: () => handoff(product.id).catch(showError),
    }, [line("前往收银台", "Go to checkout")]));
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
    headers: { "idempotency-key": crypto.randomUUID() },
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
  if (result.fact) {
    node.replaceChildren(line(
      `已有确认事实：${result.fact.value}`,
      `Confirmed fact already exists: ${result.fact.valueEn || result.fact.value}`,
    ));
  } else if (result.limited) {
    node.replaceChildren(line("今日提问已达上限，返回未知", "The daily question limit was reached. Returning unknown."));
  } else if (result.inboxCreated) {
    node.replaceChildren(line("已记入问题箱", "Added to the question inbox."));
  } else {
    node.replaceChildren(line("已并入已有问题，没有新增", "Joined the existing question. Nothing new was added."));
  }
}

async function compare() {
  const result = await api("/api/tools/compare_products", {
    method: "POST",
    body: JSON.stringify({ productIds: [compareA.value, compareB.value] }),
  });
  const table = h("table");
  table.append(h("tr", {}, [
    h("th", {}, [line("属性", "Attribute")]),
    h("th", {}, [line("商品甲", "Product A")]),
    h("th", {}, [line("商品乙", "Product B")]),
  ]));
  for (const row of result.rows) {
    table.append(h("tr", {}, [
      h("td", {}, [line(row.name, row.nameEn)]),
      ...row.cells.map((cell) => h("td", {}, [cellNode(cell)])),
    ]));
  }
  document.querySelector("#compare-result").replaceChildren(table);
}

function cellNode(cell) {
  if (cell.state === "冲突") return line(cell.label || "冲突，不可采信", cell.labelEn || "Conflict, not reliable");
  if (cell.state === "未知" || cell.state === "缺失") return line("未知", cell.stateEn || "Unknown");
  const value = `${cell.fact.value}${cell.fact.unit || ""}`;
  return line(value, cell.fact.valueEn ? `${cell.fact.valueEn}${cell.fact.unit || ""}` : value);
}

async function loadProducts() {
  products = await api("/api/products");
  const options = products.map((product) => h("option", { value: product.id, text: optionLabel(product) }));
  askProduct.replaceChildren(...options.map((option) => option.cloneNode(true)));
  compareA.replaceChildren(...products.map((product) => h("option", { value: product.id, text: optionLabel(product) })));
  compareB.replaceChildren(...products.map((product) => h("option", { value: product.id, text: optionLabel(product) })));
  const askTarget = products.find((product) => product.id === "prod-ask");
  if (askTarget) askProduct.value = askTarget.id;
  if (products[1]) compareB.value = products[1].id;
}

function optionLabel(product) {
  return product.titleEn ? `${product.title} / ${product.titleEn}` : product.title;
}

function day(value) {
  if (!value) return "—";
  return new Date(value).toISOString().slice(0, 10);
}

function availabilityText(product) {
  const labels = {
    in_stock: ["现货", "In stock"],
    out_of_stock: ["缺货", "Out of stock"],
    preorder: ["预售", "Preorder"],
    backorder: ["延期交货", "Backorder"],
  };
  const pair = labels[product.availability] || [product.availability, product.availability];
  if (!product.availableAt) return pair;
  const date = day(product.availableAt);
  return [`${pair[0]}，可售 ${date}`, `${pair[1]}, available ${date}`];
}

loadProducts().catch(showError);
