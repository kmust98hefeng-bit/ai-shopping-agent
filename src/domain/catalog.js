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
  const page = Number(input.page || 1);
  const pageSize = Number(input.pageSize || 20);
  constraints.page = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  constraints.pageSize = Number.isFinite(pageSize) && pageSize > 0 ? Math.min(50, Math.floor(pageSize)) : 20;
  return constraints;
}

export function searchCatalog(records, attributes, constraints, now) {
  const matched = [];
  for (const record of records) {
    if (record.product.status !== "on_sale") continue;
    if (!isPriceFresh(record.product, now)) continue;
    if (constraints.maxPriceCents != null && record.product.priceCents > constraints.maxPriceCents) continue;
    if (constraints.requireReturnable && !record.product.returnable) continue;
    const view = buildView(attributes, record.facts);
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
    products: matched.slice(start, start + constraints.pageSize).map(presentMatch),
  };
}

export function passesFacts(view, constraints) {
  if (constraints.minContinuousPowerW != null) {
    const fact = continuousFact(view);
    if (!fact || Number(fact.value) < constraints.minContinuousPowerW) return false;
  }
  if (constraints.requirePd31 && !supportedPdFact(view)) return false;
  return true;
}

export function buildConclusions(view, constraints) {
  const conclusions = [];
  if (constraints.minContinuousPowerW != null) {
    const fact = continuousFact(view);
    conclusions.push(conclusion(`持续输出功率 ${fact.value}${fact.unit || ""}，条件为${fact.condition}`, fact));
  }
  if (constraints.requirePd31) {
    const fact = supportedPdFact(view);
    conclusions.push(conclusion("支持 PD 3.1", fact));
  }
  return conclusions;
}

export function compareCatalog(records, attributes, ids) {
  const notFound = ids.filter((id) => !records.some((record) => record.product.id === id));
  const rows = attributes.map((attribute) => ({
    attributeId: attribute.id,
    name: attribute.name,
    cells: ids.map((id) => cellFor(records, attributes, attribute, id)),
  }));
  return { role: "data", rows, notFound };
}

function cellFor(records, attributes, attribute, id) {
  const record = records.find((item) => item.product.id === id);
  if (!record) return { productId: id, state: "缺失", usable: false };
  const view = buildView(attributes, record.facts);
  const conflict = view.conflicts.find((group) => group.attributeId === attribute.id);
  if (conflict) {
    return {
      productId: id,
      state: "冲突",
      usable: false,
      label: "冲突，不可采信",
      alternatives: conflict.facts,
    };
  }
  const fact = view.facts.find((item) => item.attributeId === attribute.id && item.matchesTemplateCondition);
  if (!fact) {
    return { productId: id, state: "未知", usable: false, trustLevel: "未知", value: null };
  }
  return { productId: id, state: "value", usable: true, fact };
}

function conclusion(claim, fact) {
  return {
    claim,
    factId: fact.id,
    attributeId: fact.attributeId,
    name: fact.name,
    value: fact.value,
    unit: fact.unit,
    condition: fact.condition,
    trustLevel: fact.trustLevel,
    version: fact.version,
    source: fact.source,
  };
}

function presentMatch(item) {
  return {
    id: item.product.id,
    title: item.product.title,
    sellerId: item.product.sellerId,
    priceCents: item.product.priceCents,
    stock: item.product.stock,
    returnable: item.product.returnable,
    description: { role: "data", text: item.product.description },
    completeness: item.view.completeness,
    conclusions: item.conclusions,
    unknown: item.view.unknown,
    conflicts: item.view.conflicts,
  };
}
