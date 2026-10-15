import { englishAttribute } from "./i18n.js";
import { fail } from "./errors.js";
import { buildView, continuousFact, isPriceFresh, supportedPdFact } from "./facts.js";

export function normalizeConstraints(input = {}) {
  const constraints = {};
  if (input.minContinuousPowerW != null && input.minContinuousPowerW !== "") {
    const value = Number(input.minContinuousPowerW);
    if (!Number.isFinite(value)) throw fail(400, "最低持续功率无效");
    constraints.minContinuousPowerW = value;
  }
  if (input.requirePd31) constraints.requirePd31 = true;
  if (input.maxPriceCents != null && input.maxPriceCents !== "") {
    const value = Number(input.maxPriceCents);
    if (!Number.isFinite(value)) throw fail(400, "价格上限无效");
    constraints.maxPriceCents = value;
  }
  if (input.requireReturnable) constraints.requireReturnable = true;
  if (input.modelCode != null && String(input.modelCode).trim() !== "") {
    constraints.modelCode = String(input.modelCode).trim();
  }
  if (input.gtin != null && String(input.gtin).trim() !== "") {
    constraints.gtin = String(input.gtin).trim();
  }
  if (input.requireInStock) constraints.requireInStock = true;
  const page = Number(input.page || 1);
  const pageSize = Number(input.pageSize || 20);
  constraints.page = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  constraints.pageSize = Number.isFinite(pageSize) && pageSize > 0 ? Math.min(50, Math.floor(pageSize)) : 20;
  return constraints;
}

export function searchCatalog(records, attributes, constraints, now) {
  const matched = [];
  const messages = [];
  for (const record of records) {
    const view = buildView(attributes, record.facts);
    if (record.product.status === "on_sale") {
      messages.push(...exclusionMessages(record.product, view, constraints, now));
    }
    if (record.product.status !== "on_sale") continue;
    if (!isPriceFresh(record.product, now)) continue;
    if (constraints.maxPriceCents != null && record.product.priceCents > constraints.maxPriceCents) continue;
    if (constraints.requireReturnable && !record.product.returnable) continue;
    if (constraints.requireInStock && record.product.availability !== "in_stock") continue;
    if (!passesFacts(view, constraints)) continue;
    matched.push({
      product: record.product,
      view,
      conclusions: buildConclusions(view, constraints),
    });
  }
  matched.sort((left, right) => {
    if (right.view.completeness.filled !== left.view.completeness.filled) {
      return right.view.completeness.filled - left.view.completeness.filled;
    }
    if (left.product.priceCents !== right.product.priceCents) {
      return left.product.priceCents - right.product.priceCents;
    }
    if (right.product.stock !== left.product.stock) return right.product.stock - left.product.stock;
    return left.product.id < right.product.id ? -1 : 1;
  });
  const start = (constraints.page - 1) * constraints.pageSize;
  return {
    role: "data",
    page: constraints.page,
    pageSize: constraints.pageSize,
    total: matched.length,
    products: matched.slice(start, start + constraints.pageSize).map((item) => presentMatch(item, now)),
    messages: messages.slice(0, 50),
  };
}

export function passesFacts(view, constraints) {
  if (constraints.minContinuousPowerW != null) {
    const fact = continuousFact(view);
    if (!fact || Number(fact.value) < constraints.minContinuousPowerW) return false;
  }
  if (constraints.requirePd31 && !supportedPdFact(view)) return false;
  if (constraints.modelCode != null && !identityMatch(view, "model_code", constraints.modelCode)) return false;
  if (constraints.gtin != null && !identityMatch(view, "gtin", constraints.gtin)) return false;
  return true;
}

export function buildConclusions(view, constraints) {
  const conclusions = [];
  if (constraints.minContinuousPowerW != null) {
    const fact = continuousFact(view);
    conclusions.push(conclusion(
      "minContinuousPowerW",
      `持续输出功率 ${fact.value}${fact.unit || ""}，条件为${fact.condition}`,
      `Continuous output ${fact.value}${fact.unit || ""}, condition: ${fact.conditionEn || fact.condition}`,
      fact,
    ));
  }
  if (constraints.requirePd31) {
    const fact = supportedPdFact(view);
    conclusions.push(conclusion("requirePd31", "支持 PD 3.1", "Supports PD 3.1", fact));
  }
  if (constraints.modelCode != null) {
    const fact = identityFact(view, "model_code");
    conclusions.push(conclusion("modelCode", `型号 ${fact.value}`, `Model ${fact.value}`, fact));
  }
  if (constraints.gtin != null) {
    const fact = identityFact(view, "gtin");
    conclusions.push(conclusion("gtin", `GTIN ${fact.value}`, `GTIN ${fact.value}`, fact));
  }
  return conclusions;
}

function identityFact(view, attributeId) {
  return view.facts.find((fact) => fact.attributeId === attributeId && fact.matchesTemplateCondition);
}

function identityMatch(view, attributeId, expected) {
  const fact = identityFact(view, attributeId);
  return Boolean(fact) && String(fact.value) === expected;
}

function exclusionMessages(product, view, constraints, now) {
  const messages = [];
  if (!isPriceFresh(product, now)) {
    messages.push(message(product, {
      code: "price_stale",
      priceUpdatedAt: product.priceUpdatedAt,
      stockUpdatedAt: product.stockUpdatedAt,
      text: `${product.title} 的标价已超过 30 天，未进入短名单`,
      textEn: `${product.titleEn || product.title} has a price older than 30 days, so it is not on the shortlist`,
    }));
  }
  if (constraints.requireInStock && product.availability !== "in_stock") {
    messages.push(message(product, {
      code: "availability_excluded",
      availability: product.availability,
      availableAt: product.availableAt,
      text: `${product.title} 当前不是现货，未进入短名单`,
      textEn: `${product.titleEn || product.title} is not in stock, so it is not on the shortlist`,
    }));
  }
  const checks = [];
  if (constraints.minContinuousPowerW != null) checks.push(["minContinuousPowerW", "continuous_power_w", "持续输出功率", "Continuous output power"]);
  if (constraints.requirePd31) checks.push(["requirePd31", "pd31", "PD 3.1 兼容", "PD 3.1 compatibility"]);
  if (constraints.modelCode != null) checks.push(["modelCode", "model_code", "型号", "Model code"]);
  if (constraints.gtin != null) checks.push(["gtin", "gtin", "GTIN", "GTIN"]);
  for (const [constraint, attributeId, name, nameEn] of checks) {
    const state = attributeState(view, attributeId);
    if (state === "value") continue;
    const code = state === "conflict" ? "constraint_conflict" : "constraint_unknown";
    const reason = state === "conflict" ? "冲突，不可采信" : "未知";
    const reasonEn = state === "conflict" ? "a conflict and cannot be trusted" : "unknown";
    messages.push(message(product, {
      code,
      constraint,
      attributeId,
      status: state === "conflict" ? "conflict" : "unknown",
      text: `${product.title} 的${name}为${reason}，约束 ${constraint} 不能当成已满足`,
      textEn: `${nameEn} on ${product.titleEn || product.title} is ${reasonEn}, so ${constraint} is not treated as met`,
    }));
  }
  return messages;
}

function attributeState(view, attributeId) {
  if (view.conflicts.some((group) => group.attributeId === attributeId)) return "conflict";
  const fact = view.facts.find((item) => item.attributeId === attributeId && item.matchesTemplateCondition);
  return fact ? "value" : "unknown";
}

function message(product, fields) {
  return {
    productId: product.id,
    title: product.title,
    titleEn: product.titleEn || null,
    ...fields,
  };
}

export function compareCatalog(records, attributes, ids) {
  const notFound = ids.filter((id) => !records.some((record) => record.product.id === id));
  const rows = attributes.map((attribute) => ({
    attributeId: attribute.id,
    name: attribute.name,
    nameEn: attribute.nameEn || englishAttribute(attribute.id).nameEn,
    cells: ids.map((id) => cellFor(records, attributes, attribute, id)),
  }));
  return { role: "data", rows, notFound };
}

function cellFor(records, attributes, attribute, id) {
  const record = records.find((item) => item.product.id === id);
  if (!record) return { productId: id, state: "缺失", stateEn: "Missing", usable: false };
  const view = buildView(attributes, record.facts);
  const conflict = view.conflicts.find((group) => group.attributeId === attribute.id);
  if (conflict) {
    return {
      productId: id,
      state: "冲突",
      stateEn: "Conflict",
      usable: false,
      label: "冲突，不可采信",
      labelEn: "Conflict, not reliable",
      alternatives: conflict.facts,
    };
  }
  const fact = view.facts.find((item) => item.attributeId === attribute.id && item.matchesTemplateCondition);
  if (!fact) {
    return { productId: id, state: "未知", stateEn: "Unknown", usable: false, trustLevel: "未知", trustLevelEn: "Unknown", value: null };
  }
  return { productId: id, state: "value", usable: true, fact };
}

function conclusion(constraint, claim, claimEn, fact) {
  return {
    constraint,
    status: "met",
    claim,
    claimEn,
    factId: fact.id,
    attributeId: fact.attributeId,
    name: fact.name,
    nameEn: fact.nameEn,
    value: fact.value,
    unit: fact.unit,
    condition: fact.condition,
    trustLevel: fact.trustLevel,
    version: fact.version,
    source: fact.source,
  };
}

function presentMatch(item, now) {
  return {
    id: item.product.id,
    title: item.product.title,
    titleEn: item.product.titleEn || null,
    sellerId: item.product.sellerId,
    priceCents: item.product.priceCents,
    priceUpdatedAt: item.product.priceUpdatedAt,
    stock: item.product.stock,
    stockUpdatedAt: item.product.stockUpdatedAt,
    priceFresh: isPriceFresh(item.product, now),
    availability: item.product.availability,
    availableAt: item.product.availableAt,
    returnable: item.product.returnable,
    description: { role: "data", text: item.product.description },
    completeness: item.view.completeness,
    conclusions: item.conclusions,
    unknown: item.view.unknown,
    conflicts: item.view.conflicts,
  };
}
