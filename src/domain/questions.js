export const ASK_DAILY_LIMIT = 20;

const PUBLIC_FIELDS = ["productId", "attributeId", "condition", "agentId"];

export function publicAskInput(input = {}) {
  const picked = {};
  for (const field of PUBLIC_FIELDS) picked[field] = input[field];
  return picked;
}

export function missingAskFields(input) {
  const missing = [];
  if (!input.productId) missing.push("productId");
  if (!input.attributeId) missing.push("attributeId");
  if (input.condition == null || String(input.condition).trim() === "") missing.push("condition");
  if (!input.agentId) missing.push("agentId");
  return missing;
}

export function decideAsk({ usableFact, cluster, humanCount }) {
  if (usableFact) return { action: "cite" };
  if (cluster?.status === "promoted" && cluster.promotedFactId) return { action: "cite-promoted" };
  if (cluster?.status === "open") return { action: "join" };
  if (humanCount >= ASK_DAILY_LIMIT) return { action: "limit" };
  return { action: "create" };
}

export function dayKey(now) {
  return new Date(now).toISOString().slice(0, 10);
}
