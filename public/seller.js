import { api, h, showError, yuan } from "./api.js";

const sellerSelect = document.querySelector("#seller");
const list = document.querySelector("#product-list");
const detail = document.querySelector("#detail");
const detailTitle = document.querySelector("#detail-title");
const inbox = document.querySelector("#inbox");
const inboxCount = document.querySelector("#inbox-count");
const attributions = document.querySelector("#attributions");
const template = document.querySelector("#template");
let selectedId = null;

sellerSelect.addEventListener("change", () => {
  loadInbox();
  loadAttributions();
});

document.querySelector("#create-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const created = await api("/api/products", {
      method: "POST",
      body: JSON.stringify({
        sellerId: sellerSelect.value,
        title: document.querySelector("#title").value,
        priceCents: Math.round(Number(document.querySelector("#price").value) * 100),
        stock: Number(document.querySelector("#stock").value),
        returnable: document.querySelector("#returnable").checked,
        description: document.querySelector("#description").value,
      }),
    });
    selectedId = created.id;
    await refresh();
    await openProduct(created.id);
  } catch (error) {
    showError(error);
  }
});

document.querySelector("#attribute-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await api("/api/admin/attributes", {
      method: "POST",
      body: JSON.stringify({
        id: document.querySelector("#attr-id").value.trim(),
        name: document.querySelector("#attr-name").value.trim(),
        dataType: "text",
        kind: "constraint",
        required: document.querySelector("#attr-required").checked,
        condition: "补充",
      }),
    });
    await loadTemplate();
    if (selectedId) await openProduct(selectedId);
  } catch (error) {
    showError(error);
  }
});

async function refresh() {
  const [sellers, products, info] = await Promise.all([
    api("/api/sellers"),
    api("/api/products"),
    api("/api/template"),
  ]);
  document.querySelector("#sort-rule").textContent = info.sortRule;
  const current = sellerSelect.value;
  sellerSelect.replaceChildren(
    ...sellers.map((seller) => h("option", { value: seller.id, text: seller.name })),
  );
  sellerSelect.value = current || "seller-a";
  list.replaceChildren();
  for (const product of products) {
    const gaps = [
      ...product.missing.map((item) => item.name),
      ...(product.conflicts || []).map((name) => `${name}（冲突）`),
    ];
    const missing = gaps.join("、") || "无";
    list.append(h("div", { className: "row" }, [
      h("div", {}, [
        h("strong", { text: product.title }),
        h("div", { className: "muted", text: `完整度 ${product.completeness.filled}/${product.completeness.required}，缺少：${missing}` }),
      ]),
      h("button", {
        type: "button",
        className: "secondary",
        text: "查看",
        "data-product-id": product.id,
        onclick: () => openProduct(product.id).catch(showError),
      }),
    ]));
  }
  renderTemplate(info.attributes);
  await loadInbox();
  await loadAttributions();
}

function renderTemplate(attributes) {
  template.replaceChildren();
  for (const attribute of attributes) {
    template.append(h("div", {
      text: `${attribute.name}（${attribute.id}）${attribute.required ? "必填" : "可选"} ${attribute.condition || ""}`,
    }));
  }
}

async function loadTemplate() {
  const info = await api("/api/template");
  renderTemplate(info.attributes);
}

async function openProduct(id) {
  selectedId = id;
  const data = await api(`/api/products/${id}`);
  detailTitle.textContent = data.product.title;
  detail.replaceChildren();
  detail.append(h("p", { text: `价格 ${yuan(data.product.priceCents)} 元，库存 ${data.product.stock}` }));
  detail.append(h("h3", { text: "上传规格书" }));
  const area = h("textarea", { id: "spec-text", placeholder: "持续输出功率: 65W\nPD 3.1: 支持\n是否含电源线: 不含电源线" });
  const file = h("input", { id: "spec-file", type: "file", accept: ".txt,text/plain" });
  file.addEventListener("change", async () => {
    const chosen = file.files?.[0];
    if (!chosen) return;
    area.value = await chosen.text();
  });
  detail.append(file, area, h("button", {
    type: "button",
    text: "抽取候选事实",
    onclick: () => uploadSpec(id, area.value).catch(showError),
  }));
  detail.append(h("h3", { text: "待确认候选" }));
  const candidates = h("div", { id: "candidates" });
  if (!data.candidates.length) candidates.append(h("p", { className: "muted", text: "没有待确认候选。" }));
  for (const candidate of data.candidates) {
    candidates.append(h("div", { className: "row" }, [
      h("div", { text: `${candidate.name}：${candidate.value}${candidate.unit || ""}（${candidate.condition}，第 ${candidate.source.lineNo || "-"} 行）` }),
      h("div", {}, [
        h("button", { type: "button", text: "确认", "data-fact-id": candidate.id, onclick: () => act(candidate.id, "confirm") }),
        h("button", { type: "button", className: "secondary", text: "驳回", onclick: () => act(candidate.id, "reject") }),
        h("button", { type: "button", className: "secondary", text: "标为未知", onclick: () => act(candidate.id, "unknown") }),
      ]),
    ]));
  }
  detail.append(candidates);
  detail.append(h("h3", { text: "代理详情（未确认候选不会出现在这里）" }));
  detail.append(h("pre", { id: "agent-view", text: agentText(data.agentView) }));
  if (data.conflicts.length) {
    detail.append(h("h3", { text: "冲突，不可采信" }));
    for (const group of data.conflicts) {
      const box = h("div");
      for (const fact of group.facts) {
        box.append(h("div", { className: "row" }, [
          h("span", { text: `${fact.name} ${fact.value}${fact.unit || ""} 来源 ${fact.source.excerpt || fact.source.type}` }),
          h("button", {
            type: "button",
            text: "采用此条",
            onclick: () => resolve(data.product.id, group, fact.id).catch(showError),
          }),
        ]));
      }
      detail.append(box);
    }
  }
  detail.append(h("h3", { text: "已确认事实" }));
  for (const fact of data.facts.filter((item) => item.matchesTemplateCondition)) {
    const input = h("input", { value: fact.value });
    detail.append(h("div", { className: "row" }, [
      h("div", { text: `${fact.name}：${fact.value}${fact.unit || ""}，${fact.trustLevel}，版本 ${fact.version}，事实 ${fact.id}` }),
      h("div", {}, [
        input,
        h("button", {
          type: "button",
          className: "secondary",
          text: "保存修改",
          onclick: () => revise(fact.id, input.value).catch(showError),
        }),
      ]),
    ]));
  }
}

function agentText(view) {
  const lines = [view.product.title];
  for (const fact of view.facts) {
    if (!fact.matchesTemplateCondition) {
      lines.push(`其他条件 ${fact.name} ${fact.value}${fact.unit || ""} 条件:${fact.condition}`);
      continue;
    }
    lines.push(`已确认 ${fact.name} ${fact.value}${fact.unit || ""} 事实 ${fact.id}`);
  }
  for (const item of view.unknown) lines.push(`未知 ${item.name}`);
  for (const group of view.conflicts) lines.push(`冲突 ${group.name} 不可采信`);
  return lines.join("\n");
}

async function uploadSpec(productId, text) {
  const result = await api(`/api/products/${productId}/documents`, {
    method: "POST",
    body: JSON.stringify({ filename: "spec.txt", text }),
  });
  if (!result.candidates.length) {
    document.querySelector("#error").textContent = "未能抽出候选事实，必填项保持未知";
  } else {
    document.querySelector("#error").textContent = "";
  }
  await openProduct(productId);
  await refresh();
}

async function act(factId, action) {
  await api(`/api/facts/${factId}/${action}`, {
    method: "POST",
    body: JSON.stringify({ by: sellerSelect.value }),
  });
  if (selectedId) await openProduct(selectedId);
  await refresh();
}

async function revise(factId, value) {
  await api(`/api/facts/${factId}/revise`, {
    method: "POST",
    body: JSON.stringify({ value, by: sellerSelect.value }),
  });
  await openProduct(selectedId);
  await refresh();
}

async function resolve(productId, group, chosenFactId) {
  await api("/api/conflicts/resolve", {
    method: "POST",
    body: JSON.stringify({
      productId,
      attributeId: group.attributeId,
      condition: group.condition,
      chosenFactId,
      by: sellerSelect.value,
    }),
  });
  await openProduct(productId);
  await refresh();
}

async function loadInbox() {
  const rows = await api(`/api/inbox?sellerId=${encodeURIComponent(sellerSelect.value)}`);
  inboxCount.textContent = `待处理 ${rows.length}`;
  inbox.replaceChildren();
  if (!rows.length) {
    inbox.append(h("p", { className: "muted", text: "没有待处理问题。" }));
    return;
  }
  for (const item of rows) {
    const box = h("article");
    box.append(h("h3", { text: `${item.productTitle} / ${item.attributeName}` }));
    box.append(h("p", { text: `条件：${item.condition}${item.conflict ? "，与已有事实冲突" : ""}` }));
    for (const answer of item.answers) {
      box.append(h("p", { text: `未确认问答：${answer.body.text}` }));
    }
    for (const candidate of item.candidates) {
      box.append(h("div", { className: "row" }, [
        h("span", { text: `候选 ${candidate.value}${candidate.unit || ""}` }),
        h("button", {
          type: "button",
          text: "确认晋升",
          "data-fact-id": candidate.id,
          onclick: () => act(candidate.id, "confirm"),
        }),
      ]));
    }
    const value = h("input", { placeholder: "支持" });
    box.append(value, h("button", {
      type: "button",
      text: "提交回答",
      onclick: () => submitAnswer(item.id, value.value).catch(showError),
    }));
    inbox.append(box);
  }
}

async function submitAnswer(clusterId, value) {
  await api(`/api/inbox/${clusterId}/answer`, {
    method: "POST",
    body: JSON.stringify({ text: value, value, by: sellerSelect.value }),
  });
  await loadInbox();
}

async function loadAttributions() {
  const rows = await api(`/api/handoffs?sellerId=${encodeURIComponent(sellerSelect.value)}`);
  attributions.replaceChildren();
  if (!rows.length) {
    attributions.append(h("p", { className: "muted", text: "还没有归因。" }));
    return;
  }
  for (const row of rows) {
    attributions.append(h("p", {}, [
      h("span", { className: "attribution-id", text: row.id }),
      h("span", { text: ` ${row.productTitle}` }),
    ]));
  }
}

refresh().catch(showError);
