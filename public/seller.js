import { api, h, line, showError, yuan } from "./api.js";

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
        titleEn: document.querySelector("#title-en").value,
        priceCents: Math.round(Number(document.querySelector("#price").value) * 100),
        stock: Number(document.querySelector("#stock").value),
        availability: document.querySelector("#availability").value,
        availableAt: dateValue(document.querySelector("#available-at").value),
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
        nameEn: document.querySelector("#attr-name-en").value.trim(),
        conditionEn: "Additional",
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
  document.querySelector("#sort-rule").replaceChildren(line(info.sortRule, info.sortRuleEn));
  const current = sellerSelect.value;
  sellerSelect.replaceChildren(
    ...sellers.map((seller) => h("option", { value: seller.id, text: seller.nameEn ? `${seller.name} / ${seller.nameEn}` : seller.name })),
  );
  sellerSelect.value = current || "seller-a";
  list.replaceChildren();
  for (const product of products) {
    const gapZh = [
      ...product.missing.map((item) => item.name),
      ...(product.conflicts || []).map((name) => `${name}（冲突）`),
    ].join("、") || "无";
    const gapEn = [
      ...product.missing.map((item) => item.nameEn || item.name),
      ...(product.conflictEns || []).map((name) => `${name || "conflict"} (conflict)`),
    ].join(", ") || "none";
    list.append(h("div", { className: "row" }, [
      h("div", {}, [
        h("strong", {}, [line(product.title, product.titleEn)]),
        h("div", { className: "muted" }, [line(
          `完整度 ${product.completeness.filled}/${product.completeness.required}，缺少：${gapZh}`,
          `Completeness ${product.completeness.filled}/${product.completeness.required}, missing: ${gapEn}`,
        )]),
      ]),
      h("button", {
        type: "button",
        className: "secondary",
        "data-product-id": product.id,
        onclick: () => openProduct(product.id).catch(showError),
      }, [line("查看", "View")]),
    ]));
  }
  renderTemplate(info.attributes);
  await loadInbox();
  await loadAttributions();
}

function renderTemplate(attributes) {
  template.replaceChildren();
  for (const attribute of attributes) {
    template.append(h("div", {}, [line(
      `${attribute.name}（${attribute.id}）${attribute.required ? "必填" : "可选"} ${attribute.condition || ""}`,
      `${attribute.nameEn || attribute.name} (${attribute.id}) ${attribute.required ? "required" : "optional"} ${attribute.conditionEn || attribute.condition || ""}`,
    )]));
  }
}

async function loadTemplate() {
  const info = await api("/api/template");
  renderTemplate(info.attributes);
}

async function openProduct(id) {
  selectedId = id;
  const data = await api(`/api/products/${id}`);
  detailTitle.replaceChildren(line(data.product.title, data.product.titleEn));
  detail.replaceChildren();
  detail.append(h("p", {}, [line(
    `价格 ${yuan(data.product.priceCents)} 元，库存 ${data.product.stock}`,
    `Price ${yuan(data.product.priceCents)} CNY, stock ${data.product.stock}`,
  )]));
  detail.append(h("h3", {}, [line("上传规格书", "Upload a spec sheet")]));
  const area = h("textarea", { id: "spec-text", placeholder: "持续输出功率: 65W\nPD 3.1: 支持\n是否含电源线: 不含电源线" });
  const file = h("input", { id: "spec-file", type: "file", accept: ".txt,text/plain" });
  file.addEventListener("change", async () => {
    const chosen = file.files?.[0];
    if (!chosen) return;
    area.value = await chosen.text();
  });
  detail.append(file, area, h("button", {
    type: "button",
    onclick: () => uploadSpec(id, area.value).catch(showError),
  }, [line("抽取候选事实", "Extract candidate facts")]));
  detail.append(h("h3", {}, [line("待确认候选", "Candidates awaiting confirmation")]));
  const candidates = h("div", { id: "candidates" });
  if (!data.candidates.length) candidates.append(h("p", { className: "muted" }, [line("没有待确认候选。", "No candidates are waiting.")]));
  for (const candidate of data.candidates) {
    candidates.append(h("div", { className: "row" }, [
      h("div", {}, [line(
        `${candidate.name}：${candidate.value}${candidate.unit || ""}（${candidate.condition}，第 ${candidate.source.lineNo || "-"} 行）`,
        `${candidate.nameEn || candidate.name}: ${candidate.valueEn || candidate.value}${candidate.unit || ""} (${candidate.conditionEn || candidate.condition}, line ${candidate.source.lineNo || "-"})`,
      )]),
      h("div", {}, [
        h("button", { type: "button", "data-fact-id": candidate.id, onclick: () => act(candidate.id, "confirm") }, [line("确认", "Confirm")]),
        h("button", { type: "button", className: "secondary", onclick: () => act(candidate.id, "reject") }, [line("驳回", "Reject")]),
        h("button", { type: "button", className: "secondary", onclick: () => act(candidate.id, "unknown") }, [line("标为未知", "Mark unknown")]),
      ]),
    ]));
  }
  detail.append(candidates);
  detail.append(h("h3", {}, [line("代理详情（未确认候选不会出现在这里）", "Agent view (unconfirmed candidates do not appear here)")]));
  detail.append(h("pre", { id: "agent-view", text: agentText(data.agentView) }));
  if (data.conflicts.length) {
    detail.append(h("h3", {}, [line("冲突，不可采信", "Conflict, not reliable")]));
    for (const group of data.conflicts) {
      const box = h("div");
      for (const fact of group.facts) {
        box.append(h("div", { className: "row" }, [
          line(
            `${fact.name} ${fact.value}${fact.unit || ""} 来源 ${fact.source.excerpt || fact.source.type}`,
            `${fact.nameEn || fact.name} ${fact.valueEn || fact.value}${fact.unit || ""} source ${fact.source.excerpt || fact.source.type}`,
          ),
          h("button", {
            type: "button",
            onclick: () => resolve(data.product.id, group, fact.id).catch(showError),
          }, [line("采用此条", "Use this one")]),
        ]));
      }
      detail.append(box);
    }
  }
  detail.append(h("h3", {}, [line("已确认事实", "Confirmed facts")]));
  for (const fact of data.facts.filter((item) => item.matchesTemplateCondition)) {
    const input = h("input", { value: fact.value });
    detail.append(h("div", { className: "row" }, [
      h("div", {}, [line(
        `${fact.name}：${fact.value}${fact.unit || ""}${certLabel(fact, "zh")}，${fact.trustLevel}，版本 ${fact.version}，事实 ${fact.id}`,
        `${fact.nameEn || fact.name}: ${fact.valueEn || fact.value}${fact.unit || ""}${certLabel(fact, "en")}, ${fact.trustLevelEn || fact.trustLevel}, version ${fact.version}, fact ${fact.id}`,
      )]),
      h("div", {}, [
        input,
        h("button", {
          type: "button",
          className: "secondary",
          onclick: () => revise(fact.id, input.value).catch(showError),
        }, [line("保存修改", "Save change")]),
      ]),
    ]));
  }
}

function agentText(view) {
  const lines = [view.product.titleEn ? `${view.product.title} / ${view.product.titleEn}` : view.product.title];
  for (const fact of view.facts) {
    if (!fact.matchesTemplateCondition) {
      lines.push(`其他条件 ${fact.name} ${fact.value}${fact.unit || ""} 条件:${fact.condition}`);
      lines.push(`Other condition ${fact.nameEn || fact.name} ${fact.valueEn || fact.value}${fact.unit || ""} condition: ${fact.conditionEn || fact.condition}`);
      continue;
    }
    lines.push(`已确认 ${fact.name} ${fact.value}${fact.unit || ""} 事实 ${fact.id}`);
    lines.push(`Confirmed ${fact.nameEn || fact.name} ${fact.valueEn || fact.value}${fact.unit || ""} fact ${fact.id}`);
  }
  for (const item of view.unknown) {
    lines.push(`未知 ${item.name}`);
    lines.push(`Unknown ${item.nameEn || item.name}`);
  }
  for (const group of view.conflicts) {
    lines.push(`冲突 ${group.name} 不可采信`);
    lines.push(`Conflict ${group.nameEn || group.name} not reliable`);
  }
  return lines.join("\n");
}

async function uploadSpec(productId, text) {
  const result = await api(`/api/products/${productId}/documents`, {
    method: "POST",
    body: JSON.stringify({ filename: "spec.txt", text }),
  });
  if (!result.candidates.length) {
    document.querySelector("#error").replaceChildren(line(
      "未能抽出候选事实，必填项保持未知",
      "No candidate facts were extracted. Required fields stay unknown.",
    ));
  } else {
    document.querySelector("#error").replaceChildren();
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
  inboxCount.replaceChildren(line(`待处理 ${rows.length}`, `${rows.length} open`));
  inbox.replaceChildren();
  if (!rows.length) {
    inbox.append(h("p", { className: "muted" }, [line("没有待处理问题。", "No open questions.")]));
    return;
  }
  for (const item of rows) {
    const box = h("article");
    box.append(h("h3", {}, [line(
      `${item.productTitle} / ${item.attributeName}`,
      `${item.productTitleEn || item.productTitle} / ${item.attributeNameEn || item.attributeName}`,
    )]));
    box.append(h("p", {}, [line(
      `条件：${item.condition}${item.conflict ? "，与已有事实冲突" : ""}`,
      `Condition: ${item.conditionEn || item.condition}${item.conflict ? ", conflicts with an existing fact" : ""}`,
    )]));
    for (const answer of item.answers) {
      box.append(h("p", {}, [line(
        `未确认问答：${answer.body.text}`,
        `${answer.trustLevelEn || "Unconfirmed answer"}: ${answer.body.text}`,
      )]));
    }
    for (const candidate of item.candidates) {
      box.append(h("div", { className: "row" }, [
        line(`候选 ${candidate.value}${candidate.unit || ""}`, `Candidate ${candidate.valueEn || candidate.value}${candidate.unit || ""}`),
        h("button", {
          type: "button",
          "data-fact-id": candidate.id,
          onclick: () => act(candidate.id, "confirm"),
        }, [line("确认晋升", "Confirm and promote")]),
      ]));
    }
    const value = h("input", { placeholder: "支持 / Supported" });
    box.append(value, h("button", {
      type: "button",
      onclick: () => submitAnswer(item.id, value.value).catch(showError),
    }, [line("提交回答", "Submit answer")]));
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
    attributions.append(h("p", { className: "muted" }, [line("还没有归因。", "No attributions yet.")]));
    return;
  }
  for (const row of rows) {
    attributions.append(h("p", {}, [
      h("span", { className: "attribution-id", text: row.id }),
      h("span", { text: ` ${row.productTitle}` }),
    ]));
  }
}

function dateValue(value) {
  if (!value) return null;
  const parsed = Date.parse(`${value}T00:00:00`);
  return Number.isFinite(parsed) ? parsed : null;
}

function certLabel(fact, language) {
  if (!fact.certification) return "";
  const cert = fact.certification;
  if (language === "en") {
    return `, ${cert.body || "body unknown"} ${cert.id || ""} ${cert.url || ""}`.trimEnd();
  }
  return `，机构 ${cert.body || "未知"}，编号 ${cert.id || "未知"}，文件 ${cert.url || "无"}`;
}

refresh().catch(showError);
