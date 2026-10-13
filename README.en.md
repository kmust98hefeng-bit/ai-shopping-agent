# AI Shopping Agent

[中文](README.md)

Choosing a product often means hours of checking specs, manuals, and model numbers. Shopping agents can already search and summarize, but most stores still have no decision-grade interface for an outside agent. Fields lack units and conditions. Empty values get filled in by the model. A customer-service answer stays in one chat, so the next agent asks the same question again.

This project is a **product fact layer for shopping agents**. It is not another general marketplace, and it does not ask an agent to browse HTML. Sellers upload spec sheets and manuals. Agents search, compare, and ask against hard constraints. After the seller confirms an answer, that answer is written back onto the product. Later agents read the fact instead of asking again.

The long-term direction is for an agent to complete a purchase inside a mandate the buyer wrote ahead of time. The first release only does research and a shortlist. Payment and the customer relationship stay at the seller's own checkout.

## Why now

Catalog APIs and checkout protocols already exist. Shopify can expose a catalog. The Agentic Commerce Protocol (OpenAI, Stripe, Meta) can start checkout. In March 2026, ChatGPT's in-chat instant checkout was scaled back, and agents were used more for research. Merchants also do not want to hand over checkout or the customer relationship. Large Chinese marketplaces remain mostly closed to outside shopping agents.

The missing piece is not another page that can place an order. It is **a fact an agent can use to exclude a product**: a unit, a condition, a source, and a version. When a value is unknown, the interface returns "unknown". It does not let a model invent a plausible number.

## What this prototype does

The first category is USB-C power adapters. The acceptance cases are "continuous output of at least 65W" and "a product that does not support PD 3.1 must be excluded".

A shopping agent can call these tools:

| Tool | What it does |
| --- | --- |
| `search_products` | Filter by continuous power, PD 3.1, price, and returnability. Return a sourced shortlist |
| `get_product` | Read confirmed facts. Unconfirmed extracts are not included |
| `compare_products` | Compare products on the same attributes. Conflicting cells are marked not reliable |
| `ask_seller` | Ask the seller. One open question per product, attribute, and condition |
| `create_handoff` | Create an attribution and send the buyer to the seller's checkout. The platform does not take payment |

Rules already implemented:

- A required field with no confirmed value returns "unknown". Unknown may be shown. It may not be treated as if the constraint were met.
- Candidates extracted from a spec sheet stay hidden from agents until the seller confirms them.
- When two sources disagree, both facts are kept. That attribute cannot be used as a hard filter until the seller picks one.
- Marketing copy does not raise completeness. Payment cannot place a product that fails a hard constraint onto the shortlist.
- Sort order is: pass the hard constraints, then required-field completeness, then price, then stock. A price that has not been updated for more than 30 days is left out of recommendations.
- After a question is confirmed and promoted, later agents receive the fact. The seller does not get another inbox item for the same question.
- An ask does not accept budget, address, or identity, and those fields are not stored.
- The attribution window is 7 days. An order outside the window is not a platform sale. A refund only marks the commission as pending reversal. This release does not move money.

The fuller rules, roles, and acceptance criteria are in the [requirements document](docs/AI购物代理需求文档.md) (Chinese).

## Try it

You need Node.js 24, which provides `node:sqlite` and `node:test`. There is no `npm install`.

```bash
node src/server.js
```

Open <http://127.0.0.1:3780>.

- Seller page: upload a spec sheet, confirm or reject candidates, handle the question inbox, and review attributions.
- Buyer page: build a shortlist for "continuous output of at least 65W, and PD 3.1 required", compare two products, then open the simulated checkout.

The seed data includes a complete spec, a peak-power claim, a product that does not support PD, unconfirmed candidates, a conflicting power fact, a stale price, and a product waiting for a question. Use them to see whether search holds the constraints.

```bash
node --test
```

## Out of scope for this release

- A general multi-category mall, in-house logistics, in-house payments, or on-site ads.
- Automatic charges with no spending limit and no cancellation window.
- Scraping Taobao, JD.com, or Pinduoduo pages.
- Turning marketing copy, or an unconfirmed chat, into a filterable spec.
- Selling a completeness score, or letting a paid placement skip a hard constraint.

The buyer remains the principal. The agent does research. Automatic purchase is only considered inside a written mandate. High prices, price changes, custom goods, and disputes stay with a person.

## Commercial hypothesis, open to disagreement

These are current assumptions, not a proven model. If you have a view, please argue with them.

| Assumption | Current view |
| --- | --- |
| Primary revenue | Commission only on attributed orders, designed around 3%–8%. Lower than a general marketplace, because the platform does not handle logistics and does not take the customer |
| Listing, search, and questions | Free, so the supply side can start |
| Earlier payer | Possibly the buyer, through a seat subscription. The original pain is research time, so a research agent can charge for seats first |
| Seller subscription | Later. It would sell the inbox, a SKU quota, and multi-channel sync. A free tier may limit quantity. It may not hide a product that already matches the constraints |
| One-time listing fee | Not the model. An optional spec-extraction setup fee is a service, not the business |
| Ads | Not the primary revenue. Completeness cannot be bought. A product that fails a hard constraint cannot be placed on the shortlist |

Questions worth answering:

1. Is a fact layer plus agent tools more durable than building another store?
2. Is USB-C power adapters too narrow for a first category? PC parts, industrial wear parts, or large-appliance installation constraints: which is a better cold start?
3. Will sellers confirm specs and answer reusable questions? What incentive is enough?
4. Commission, buyer seats, or a seller tool subscription: which should be charged first?
5. Are the attribution window, question rate limit, and price freshness bounds reasonable?
6. Should automatic purchase stop at "a person confirms, then pays", or go further inside a written mandate?

## How to take part

- Product judgment, a hole in the rules, or a bug in the prototype: open an [issue](https://github.com/kmust98hefeng-bit/ai-shopping-agent/issues).
- To change a requirement or add a test, open a pull request. For a rule change, describe which rule you want to change in an issue first.
- For a direct conversation about commercialization and feasibility, rather than a public comment: email hefeng2633@qq.com with the subject "AI Shopping Agent".

A note that includes a real buying case — what you bought, which spec blocked you, and what you asked customer service — is more useful than an abstract suggestion.
