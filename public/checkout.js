import { api, h, showError, yuan } from "./api.js";

const id = new URLSearchParams(location.search).get("id");

async function load() {
  if (!id) throw new Error("缺少归因标识");
  const handoff = await api(`/api/handoffs/${id}`);
  document.querySelector("#attribution-id").textContent = handoff.id;
  const product = handoff.shortlist.product;
  const detail = document.querySelector("#checkout-detail");
  detail.append(h("p", { text: product.title }));
  detail.append(h("p", { text: `${yuan(product.priceCents)} 元` }));
  for (const conclusion of product.conclusions) {
    detail.append(h("p", {}, [
      h("span", { text: `${conclusion.claim}，事实 ` }),
      h("span", { className: "fact-id", text: conclusion.factId }),
    ]));
  }
}

load().catch(showError);
