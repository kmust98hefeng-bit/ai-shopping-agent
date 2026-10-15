import { englishAttribute, gloss } from "./i18n.js";

export const PRICE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export function isPriceFresh(product, now) {
  return now - product.priceUpdatedAt <= PRICE_MAX_AGE_MS;
}

export function matchesTemplateCondition(attribute, fact) {
  if (!attribute?.condition) return true;
  return fact.condition === attribute.condition;
}

export function presentFact(fact, attribute) {
  const english = englishAttribute(fact.attributeId);
  return {
    id: fact.id,
    attributeId: fact.attributeId,
    name: attribute?.name || fact.attributeId,
    nameEn: attribute?.nameEn || english.nameEn,
    value: fact.value,
    valueEn: gloss(fact.value),
    unit: fact.unit,
    condition: fact.condition,
    conditionEn: attribute?.conditionEn || english.conditionEn || gloss(fact.condition),
    trustLevel: fact.trustLevel,
    trustLevelEn: gloss(fact.trustLevel),
    status: fact.status,
    version: fact.version,
    matchesTemplateCondition: attribute ? matchesTemplateCondition(attribute, fact) : true,
    confirmedBy: fact.confirmedBy,
    confirmedAt: fact.confirmedAt,
    questionId: fact.questionId,
    source: {
      role: "data",
      type: fact.sourceType,
      ref: fact.sourceRef,
      excerpt: fact.sourceExcerpt,
      lineNo: fact.lineNo,
      documentId: fact.documentId,
    },
    certification: attribute?.dataType === "certification"
      ? {
          name: fact.value,
          body: fact.certBody || null,
          id: fact.certId || null,
          url: fact.certUrl || null,
        }
      : null,
  };
}

export function buildView(attributes, facts) {
  const current = facts.filter((fact) => fact.status === "confirmed" || fact.status === "conflict");
  const confirmed = current.filter((fact) => fact.status === "confirmed");
  const presented = confirmed.map((fact) => presentFact(fact, attributes.find((item) => item.id === fact.attributeId)));
  const conflictGroups = groupConflicts(current.filter((fact) => fact.status === "conflict"), attributes);
  const conflictAttributeIds = new Set(conflictGroups.map((group) => group.attributeId));
  const unknown = [];
  for (const attribute of attributes) {
    if (!attribute.required) continue;
    const filled = confirmed.some(
      (fact) => fact.attributeId === attribute.id && matchesTemplateCondition(attribute, fact),
    );
    if (filled || conflictAttributeIds.has(attribute.id)) continue;
    unknown.push(unknownField(attribute));
  }
  for (const attribute of attributes) {
    if (attribute.kind !== "identity" || attribute.required) continue;
    const filled = confirmed.some(
      (fact) => fact.attributeId === attribute.id && matchesTemplateCondition(attribute, fact),
    );
    if (filled || conflictAttributeIds.has(attribute.id)) continue;
    unknown.push(unknownField(attribute));
  }
  const required = attributes.filter((attribute) => attribute.required);
  const filled = required.filter((attribute) =>
    confirmed.some((fact) => fact.attributeId === attribute.id && matchesTemplateCondition(attribute, fact)),
  );
  const sourced = confirmed.filter((fact) => fact.sourceRef || fact.sourceExcerpt).length;
  const updatedAt = confirmed.reduce((latest, fact) => Math.max(latest, fact.confirmedAt || 0), 0);
  return {
    facts: presented,
    unknown,
    conflicts: conflictGroups,
    completeness: {
      required: required.length,
      filled: filled.length,
      ratio: required.length === 0 ? 1 : filled.length / required.length,
      missing: unknown
        .filter((item) => attributes.find((attribute) => attribute.id === item.attributeId)?.required)
        .map((item) => ({ attributeId: item.attributeId, name: item.name, nameEn: item.nameEn })),
      sourced,
      updatedAt,
    },
  };
}

function unknownField(attribute) {
  return {
    attributeId: attribute.id,
    name: attribute.name,
    nameEn: attribute.nameEn || englishAttribute(attribute.id).nameEn,
    value: null,
    trustLevel: "未知",
    trustLevelEn: "Unknown",
    status: "unknown",
  };
}

function groupConflicts(facts, attributes) {
  const groups = new Map();
  for (const fact of facts) {
    const key = `${fact.attributeId}\0${fact.condition || ""}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(fact);
  }
  return [...groups.values()].map((group) => {
    const attribute = attributes.find((item) => item.id === group[0].attributeId);
    return {
      attributeId: group[0].attributeId,
      name: attribute?.name || group[0].attributeId,
      nameEn: attribute?.nameEn || englishAttribute(group[0].attributeId).nameEn,
      condition: group[0].condition,
      conditionEn: attribute?.conditionEn || englishAttribute(group[0].attributeId).conditionEn || gloss(group[0].condition),
      usable: false,
      label: "冲突，不可采信",
      labelEn: "Conflict, not reliable",
      facts: group
        .slice()
        .sort((left, right) => left.version - right.version)
        .map((fact) => presentFact(fact, attribute)),
    };
  });
}

export function continuousFact(view) {
  return view.facts.find(
    (fact) => fact.attributeId === "continuous_power_w" && fact.matchesTemplateCondition,
  );
}

export function supportedPdFact(view) {
  return view.facts.find(
    (fact) => fact.attributeId === "pd31" && fact.matchesTemplateCondition && fact.value === "支持",
  );
}
