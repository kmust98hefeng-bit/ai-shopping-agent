import { CATEGORY } from "./template.js";

export function capabilityProfile() {
  return {
    role: "data",
    name: CATEGORY.name,
    nameEn: CATEGORY.nameEn,
    category: CATEGORY,
    checkout: "seller",
    requiresHumanCheckout: true,
    payment: "卖家收银台收款。本服务只记录归因。",
    paymentEn: "The seller checkout collects payment. This service only records attribution.",
    tools: ["search_products", "get_product", "compare_products", "ask_seller", "create_handoff"],
    hardFilters: [
      "minContinuousPowerW",
      "requirePd31",
      "maxPriceCents",
      "requireReturnable",
      "modelCode",
      "gtin",
      "requireInStock",
    ],
    unknownIsLegal: true,
  };
}
