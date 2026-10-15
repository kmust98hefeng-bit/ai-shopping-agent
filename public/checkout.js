import { api, h, line, showError, yuan } from "./api.js";

const id = new URLSearchParams(location.search).get("id");

async function load() {
  if (!id) {
    const error = new Error("缺少归因标识");
    error.errorEn = "Attribution id is required";
    throw error;
  }
  const handoff = await api(`/api/handoffs/${id}`);
  document.querySelector("#attribution-id").textContent = handoff.id;
  const product = handoff.shortlist.product;
  const detail = document.querySelector("#checkout-detail");
  detail.append(h("p", {}, [line(product.title, product.titleEn)]));
  if (handoff.priceChanged) {
    detail.append(h("p", {}, [line(
      `交接时标价 ${yuan(handoff.observedPriceCents)} 元，当前收银台 ${yuan(handoff.currentPriceCents)} 元，差额 ${yuan(handoff.deltaCents)} 元`,
      `Price at handoff ${yuan(handoff.observedPriceCents)} CNY, checkout now ${yuan(handoff.currentPriceCents)} CNY, difference ${yuan(handoff.deltaCents)} CNY`,
    )]));
  } else {
    detail.append(h("p", {}, [line(
      `${yuan(handoff.currentPriceCents)} 元，与交接时一致`,
      `${yuan(handoff.currentPriceCents)} CNY, same as at handoff`,
    )]));
  }
  for (const conclusion of product.conclusions) {
    detail.append(h("p", {}, [line(
      `${conclusion.claim}，事实 ${conclusion.factId}`,
      `${conclusion.claimEn || conclusion.claim}, fact ${conclusion.factId}`,
    )]));
  }
}

load().catch(showError);
