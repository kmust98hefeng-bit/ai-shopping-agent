# AI 购物代理 / AI Shopping Agent

给购买代理用的商品事实层。卖家上传可核对的规格；客服回答经卖家确认后写回商品，避免下一个代理重复提问；结账留在卖家收银台。

A product fact layer for shopping agents. Sellers publish checkable specs. After the seller confirms a customer-service answer, it is written back onto the product so the next agent does not ask again. Checkout stays with the seller.

[English only](README.en.md)

买家选型时，大量时间花在查参数、对手册、对型号上。购买代理已经能帮忙检索和整理，但现有购物平台大多没有给外部代理用的决策级接口：字段缺少单位和适用条件，空着的参数会被模型补全，客服回答留在聊天记录里，下一个代理还要再问一遍。

这个项目想做一层**给购买代理用的商品事实库**，而不是再做一个综合商城，也不是让代理去翻网页。卖家上传规格书和手册，代理按硬性约束搜索、对比、提问。客服答完并经卖家确认后，回答写回商品事实，后面的代理直接读取，不再重复提问。

终极方向是：在买家事先写好的授权范围内，由代理完成购物。首期只做到调研和短名单。付款和客户关系留在卖家自己的收银台。

Choosing a product often means hours of checking specs, manuals, and model numbers. Shopping agents can already search and summarize, but most stores still have no decision-grade interface for an outside agent. Fields lack units and conditions. Empty values get filled in by the model. A customer-service answer stays in one chat, so the next agent asks the same question again.

This project is a product fact layer for shopping agents. It is not another general marketplace, and it does not ask an agent to browse HTML. Sellers upload spec sheets and manuals. Agents search, compare, and ask against hard constraints. After the seller confirms an answer, that answer is written back onto the product. Later agents read the fact instead of asking again.

The long-term direction is for an agent to complete a purchase inside a mandate the buyer wrote ahead of time. The first release only does research and a shortlist. Payment and the customer relationship stay at the seller's own checkout.

## 为什么是现在

目录接口和结账协议已经有人在做。Shopify 有商品目录能力，Agentic Commerce Protocol（OpenAI、Stripe、Meta）能发起结账。2026 年 3 月，ChatGPT 站内即时结账收缩，代理更多被用来做调研；商家也不愿意把结账和客户关系交出去。国内综合电商对外部购买代理仍然基本封闭。

缺的不是「再做一个能下单的网页」，而是**能拿来做排除的事实**：有单位、有条件、有来源、有版本。不知道就返回「未知」，而不是让模型编一个看起来合理的数。

Catalog APIs and checkout protocols already exist. Shopify can expose a catalog. The Agentic Commerce Protocol (OpenAI, Stripe, Meta) can start checkout. In March 2026, ChatGPT's in-chat instant checkout was scaled back, and agents were used more for research. Merchants also do not want to hand over checkout or the customer relationship. Large Chinese marketplaces remain mostly closed to outside shopping agents.

The missing piece is not another page that can place an order. It is a fact an agent can use to exclude a product: a unit, a condition, a source, and a version. When a value is unknown, the interface returns "unknown". It does not let a model invent a plausible number.

## 这个原型在做什么

首期只锁定一个品类：USB-C 电源适配器。验收例子是「持续输出不低于 65W」，以及「不兼容 PD 3.1 的商品必须被排除」。

购买代理可以使用这些工具：

| 工具 | 作用 |
| --- | --- |
| `search_products` | 按持续功率、PD 3.1、价格、是否可退筛选，返回带来源的短名单 |
| `get_product` | 读取已确认事实。未确认的抽取结果不会出现 |
| `compare_products` | 对齐比较。冲突字段标成「不可采信」 |
| `ask_seller` | 向卖家提问。同一商品、同一属性、同一条件只保留一个问题 |
| `create_handoff` | 生成归因，跳到卖家收银台。平台不收款 |

几条已经写进代码的规则：

- 必填项没有已确认取值时，返回「未知」。未知可以参加展示，不能假装成已满足约束。
- 规格书抽取出的候选，卖家确认后才对代理可见。
- 两份资料互相矛盾时，两条都保留。该属性不能用于硬性筛选，直到卖家选定一条。
- 营销文案不提高完整度，也不能靠付费进入不符合约束的短名单。
- 排序先过硬性约束，再按必填完整度、价格、库存。标价超过 30 天未更新的商品不进入推荐。
- 同一个问题被确认晋升后，后来的代理直接拿到事实，不再给卖家添一条工单。
- 提问不接收预算、地址和身份信息。
- 归因窗口 7 天。窗口外的订单不算平台成交。退货只把佣金标成「待冲正」，首期不发生真实扣款。

更完整的规则、角色和验收标准在 [需求文档](docs/AI购物代理需求文档.md)，英文对照在 [requirements.en.md](docs/requirements.en.md)。

The first category is USB-C power adapters. The acceptance cases are "continuous output of at least 65W" and "a product that does not support PD 3.1 must be excluded". Agents can search, read a product, compare, ask the seller, and create a handoff. A required field with no confirmed value returns "unknown". Unconfirmed extracts stay hidden. Conflicting facts cannot be used as a hard filter. Marketing copy does not raise completeness. Prices older than 30 days drop out of recommendations. One question cluster covers the same product, attribute, and condition. The attribution window is 7 days. A refund marks the commission as pending reversal. This release does not move money.

The fuller rules are in the [Chinese requirements](docs/AI购物代理需求文档.md) and the [English requirements](docs/requirements.en.md).

## 现在能试什么

本地需要 Node.js 24（使用内置的 `node:sqlite` 和 `node:test`），不需要 `npm install`。

```bash
node src/server.js
```

浏览器打开 <http://127.0.0.1:3780>。

- 卖家页：上传规格书，确认或驳回候选，处理问题箱，查看归因。
- 买家页：用「持续输出不低于 65W，且支持 PD 3.1」生成短名单，对比两件商品，再跳到模拟收银台。

预置数据里有完整规格、峰值功率、不兼容 PD、未确认候选、事实冲突、标价过期和待提问商品，用来看筛选是否守住约束。

```bash
node --test
```

You need Node.js 24, which provides `node:sqlite` and `node:test`. There is no `npm install`. Run `node src/server.js` and open <http://127.0.0.1:3780>.

- Seller page: upload a spec sheet, confirm or reject candidates, handle the question inbox, and review attributions.
- Buyer page: build a shortlist for "continuous output of at least 65W, and PD 3.1 required", compare two products, then open the simulated checkout.

The seed data includes a complete spec, a peak-power claim, a product that does not support PD, unconfirmed candidates, a conflicting power fact, a stale price, and a product waiting for a question. Use them to see whether search holds the constraints. Run `node --test`.

## 首期明确不做

- 通用多品类商城、自建物流、自建支付、站内广告。
- 没有额度、没有撤销窗口的自动扣款。
- 爬取淘宝、京东、拼多多页面。
- 把营销文案或未确认的聊天记录写成可筛选规格。
- 出售完整度，或让付费商品绕过硬性约束。

买家仍然是委托方。代理现在负责调研。自动下单只考虑放在买家事先写下的授权里，高价、改价、定制和纠纷仍交给人。

Out of scope for this release: a general multi-category mall, in-house logistics, in-house payments, on-site ads, automatic charges with no spending limit and no cancellation window, scraping Taobao, JD.com, or Pinduoduo, turning marketing copy or an unconfirmed chat into a filterable spec, and selling a completeness score or letting a paid placement skip a hard constraint.

The buyer remains the principal. The agent does research. Automatic purchase is only considered inside a written mandate. High prices, price changes, custom goods, and disputes stay with a person.

## 商业化设想，欢迎反驳

这些是当前假设，不是已经验证的模式。希望对此有兴趣的人直接来讨论。

| 假设 | 现在的想法 |
| --- | --- |
| 主收入 | 只对可归因成交抽佣，设计区间大约 3%–8%。低于综合电商，因为平台不包物流，也不拿走客户 |
| 入驻、上架、查询、提问 | 免费，方便冷启动 |
| 更早的付费方 | 可能是买家席位：原来的痛点是选型时间，研究代理可以先按席位收费 |
| 卖家订阅 | 后置。用来卖问题箱、SKU 额度和多渠道同步。免费档可以限数量，不能藏起本来就符合约束的商品 |
| 一次性上架费 | 不作为模式。可选的规格抽取实施费只是服务 |
| 广告 | 不做主收入。完整度不能买。不符合硬性约束的商品不能靠投放进入短名单 |

想听的意见包括：

1. 事实层加代理工具，是不是比「再做一个商城」更站得住？
2. 首期品类锁在 USB-C 电源适配器是否太窄？装机配件、工业易损件、大家电安装条件，哪一个更适合冷启动？
3. 卖家愿不愿意确认规格、回答可复用的问题？什么激励才够？
4. 佣金、买家席位、卖家工具订阅，哪一个该先收费？
5. 归因窗口、提问频率、标价新鲜度，这些界限是否合理？
6. 自动下单应该停在「人确认后付款」，还是可以在书面授权内走得更远？

These are current assumptions, not a proven model.

| Assumption | Current view |
| --- | --- |
| Primary revenue | Commission only on attributed orders, designed around 3%–8%. Lower than a general marketplace, because the platform does not handle logistics and does not take the customer |
| Listing, search, and questions | Free, so the supply side can start |
| Earlier payer | Possibly the buyer, through a seat subscription. The original pain is research time |
| Seller subscription | Later. Inbox, SKU quota, and multi-channel sync. A free tier may limit quantity. It may not hide a product that already matches the constraints |
| One-time listing fee | Not the model. An optional spec-extraction setup fee is a service, not the business |
| Ads | Not the primary revenue. Completeness cannot be bought. A product that fails a hard constraint cannot be placed on the shortlist |

1. Is a fact layer plus agent tools more durable than building another store?
2. Is USB-C power adapters too narrow? PC parts, industrial wear parts, or large-appliance installation constraints: which is a better cold start?
3. Will sellers confirm specs and answer reusable questions? What incentive is enough?
4. Commission, buyer seats, or a seller tool subscription: which should be charged first?
5. Are the attribution window, question rate limit, and price freshness bounds reasonable?
6. Should automatic purchase stop at "a person confirms, then pays", or go further inside a written mandate?

## 怎么参与

- 对产品判断、规则漏洞或原型行为有意见：请开 [Issue](https://github.com/kmust98hefeng-bit/ai-shopping-agent/issues)。
- 想改需求或补测试：可以直接提 Pull Request。需求变更请先在 Issue 里写清楚你要改哪一条规则。
- 想认真讨论商业化和可行性，而不只是留一条公开评论：请发邮件到 hefeng2633@qq.com。邮件标题写上「AI 购物代理」。

讨论时如果能带一个你自己遇到的选型场景（买过什么、卡在哪条参数、问过客服什么），会比抽象建议更有用。

- Product judgment, a hole in the rules, or a bug in the prototype: open an [issue](https://github.com/kmust98hefeng-bit/ai-shopping-agent/issues).
- To change a requirement or add a test, open a pull request. For a rule change, describe which rule you want to change in an issue first.
- For a direct conversation about commercialization and feasibility, email hefeng2633@qq.com with the subject "AI Shopping Agent".

A note that includes a real buying case — what you bought, which spec blocked you, and what you asked customer service — is more useful than an abstract suggestion.
