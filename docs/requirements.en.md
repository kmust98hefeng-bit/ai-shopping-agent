# Requirements: an AI shopping-agent platform

[中文](AI购物代理需求文档.md)

| Item | Content |
| --- | --- |
| Status | Draft, for review |
| Date | 2026-10-13 |
| Readers | Product, engineering, seller operations |
| First-release goal | In one vertical category, a shopping agent produces a shortlist from checkable facts, and the same question is not sent to the seller again after it has been promoted |

## 1. Background

On high-consideration products, a buyer spends a long time checking specs, manuals, and model numbers before deciding what to buy. Shopping agents can already query a catalog through Shopify UCP, and they can start checkout through the Agentic Commerce Protocol (OpenAI, Stripe, Meta). In March 2026, ChatGPT's in-chat instant checkout was scaled back. People mainly use agents for research, and merchants want to keep checkout and the customer relationship. Large Chinese marketplaces remain mostly closed to outside shopping agents.

The gap in existing catalogs is decision quality. Fields lack units and conditions. Empty values get filled in by the model. Customer-service answers sit in a chat, and the next agent asks again.

## 2. Product definition

The platform is a product fact layer for one vertical category, plus tool endpoints for shopping agents.

- A product is stored as structured facts. Each fact has a unit, a condition, a source, a trust level, and a version.
- When a required field has no value, the endpoint returns "unknown". Unknown is a legal result.
- A shopping agent searches, reads details, compares, and asks through tools. The web pages are for seller entry and for a buyer to check the shortlist.
- A customer-service answer becomes a spec only after the seller confirms it and it does not conflict with an existing fact. Later agents read that spec.
- Checkout and the customer relationship stay with the seller. The platform takes a commission on attributed orders.

The buyer is the principal. The agent may do research. Automatic purchase is allowed later only inside a mandate the buyer wrote ahead of time.

## 3. Goals and non-goals

### 3.1 Goals

1. Turn choosing a product in one category from "a person paging through manuals" into "an agent returning a sourced shortlist".
2. Let sellers complete facts by confirming extracted results, instead of filling a long form by hand.
3. Merge repeated customer-service questions, distill them, and write them back onto the product.
4. Keep a checkable order link for a later attribution commission. This release does not build payments.

### 3.2 Non-goals for this release

- A general multi-category mall, in-house logistics, in-house payments, or on-site ads.
- Automatic charges with no spending limit and no cancellation window.
- Scraping Taobao, JD.com, or Pinduoduo pages.
- Turning marketing copy, or an unconfirmed chat, into a filterable spec.
- Selling a completeness score, or letting a paid placement enter a shortlist that fails a hard constraint.

## 4. Roles

| Role | Need |
| --- | --- |
| Buyer | State constraints in ordinary language, get a checkable shortlist, and pay themselves |
| Shopping agent | Search, compare, and find unknown fields reliably, and ask a reusable question where there is a gap |
| Seller | Confirm a spec once, receive fewer repeated questions, and get orders that match the constraints |
| Seller assistant | Draft answers only from confirmed facts. Hand the question to a person when it cannot |
| Platform operations | Maintain the category template, and handle fact conflicts and abusive questions |

The earlier payer in this release can be the buyer, through seats for a purchasing agent. Listing, being searched, and being asked are free for sellers.

## 5. First category

Only one category is open at first. It has to meet all of these:

- The buy decision is driven mainly by specs, compatibility, and installation conditions.
- The same kind of question keeps appearing in customer-service chats.
- Sellers already have spec sheets or manuals that can be extracted and then confirmed.

Candidates: interface and power compatibility for PC parts, replacement model numbers for industrial wear parts, and size and installation constraints for large appliances. Clothing, food, and cheap standard goods are not in the first release. The category is confirmed at review. See section 12. The prototype locks the category to USB-C power adapters so the acceptance cases can be tested.

## 6. Commercial rules

These rules constrain the product so ranking and fees do not fight each other.

| Rule | Requirement |
| --- | --- |
| Listing and search | Free. Questions are free |
| Primary revenue | Commission only on attributed orders. The design range is 3%–8%, lower than a general marketplace, because the platform does not handle logistics and does not take the customer relationship. The exact rate is confirmed per category before launch |
| Returns | A successful return reverses that commission |
| Subscription | A later stage. It sells the question inbox, a SKU quota, and multi-channel sync. A free tier may limit SKU count and seats. It may not hide a product that already matches the constraints |
| Spec preparation | Optional project work: extract a spec sheet and submit it for seller confirmation. It is an implementation service, not a replacement for commission |
| Ads and completeness | No ads in the first release. Completeness is computed only from fields, sources, and freshness. It cannot be bought |
| Sort | Filter hard constraints first, then sort by fact completeness, price, and stock. Payment cannot put a product that fails the constraints onto the shortlist |

A cold start can have no commission yet. It only has to record the click and the order link that attribution needs.

## 7. Concepts and trust levels

### 7.1 Objects

| Object | Meaning |
| --- | --- |
| Category template | Attribute definitions for the category: name, type, unit, required or not, and allowed conditions |
| Fact | A value of an attribute under a specific condition, with a source and a trust level |
| Spec sheet | The original file the seller uploaded. It is evidence for retrieval and checking |
| Question cluster | Merged questions about the same product, attribute, and condition |
| Candidate fact | A value extracted from a spec sheet or an answer, not yet confirmed |
| Shortlist | The products an agent proposes. Every hard conclusion points back to a fact |
| Attribution | An order that can be linked to a shortlist inside the window after the shortlist was handed to the buyer |

### 7.2 Trust levels

| Level | Source | Usable as a hard filter | May replace an existing spec |
| --- | --- | --- | --- |
| Spec | Manufacturer spec or a test certificate, and the seller confirmed the extract | Yes | Yes, and the old version is kept |
| Seller-confirmed parameter | The seller confirmed it directly in the template | Yes | Yes, and the confirmer and time are kept |
| Promoted fact | A customer-service answer the seller confirmed, with no conflict | Yes | Yes, and the original question must be attached |
| Unconfirmed answer | A draft just given by an assistant or a person | No | No. It can only be quoted |
| Conflict | Two existing sources disagree | Cannot be relied on by itself | No. Both are shown until the seller decides |
| Unknown | A required or asked field has no value | Cannot be treated as any value | Not applicable |

A marketing sentence, a subjective description with no source, may be shown. It cannot be written as a filterable spec.

## 8. Main flows

### 8.1 The seller completes facts

1. The seller creates a product and chooses the category template.
2. They upload a spec sheet, a manual, or a dimension drawing.
3. The system extracts candidate facts and marks the unit, the condition, and the location in the original text.
4. The seller confirms, corrects, or marks each one unknown.
5. The system computes completeness. Unknown stays unknown.
6. The product can be queried by shopping agents.

### 8.2 The agent chooses

1. The buyer describes the need in ordinary language. The agent writes constraints: budget, size, interface, power, certification, returnability, and so on.
2. The agent calls search. Products that fail a hard constraint are not in the result.
3. The agent calls detail or compare. An empty field returns unknown.
4. The agent builds a shortlist. Every conclusion used as a filter carries a fact id and a source.
5. The buyer checks the evidence on the shortlist page and pays at the seller's checkout. The platform records the attribution.

### 8.3 Ask, then promote

1. The agent finds that a field it needs is unknown and asks a structured question.
2. The system joins an existing question cluster first. If a promoted answer already exists, it is returned and the seller is not notified.
3. When there is no answer, the seller assistant drafts only from confirmed facts. If it cannot, the question enters the human inbox.
4. The answer is extracted into a candidate fact. It becomes a spec only after the seller confirms it and there is no conflict.
5. Any later agent reads that spec.

## 9. Functional requirements

Priority: P0 is required for the first release, P1 is the first batch after that, and P2 is authorized purchase.

### 9.1 Category template (P0)

The system provides one category template for the first release.

- Each attribute has an id, a name, a data type, a unit, whether it is required, a condition, and an example.
- The template separates three kinds of information: measurements, negations (not included, not compatible), and installation or use constraints.
- Operations can add or edit attributes. Existing facts are kept. A template edit does not silently delete them.
- A seller cannot invent a filterable field. Text outside the template goes into notes or the original document. It does not take part in hard filtering.

Acceptance:

- For a product missing a required attribute, the detail endpoint returns unknown for that attribute. It does not omit the field or return an empty string as if a value existed.
- A negation can be hit by a search constraint. "Not compatible with PD 3.1" excludes the product from a search that requires PD 3.1.

### 9.2 Products and facts (P0)

- A product has an id, a seller, a category, a title, a sale status, a price, stock, a return policy, an availability state, and an available-on date.
- Availability is in stock, out of stock, preorder, or backorder. Preorder and backorder require an available-on date.
- A fact has an attribute, a value, a unit, a condition, a trust level, a source, a confirmer, a confirmation time, and a version. A safety certification also has an issuer, a certificate id, and a document URL.
- Model code and GTIN are identity facts. An unconfirmed value is unknown. Digits in the title are not a model code or a GTIN.
- Updating a fact creates a new version. The old version can be traced.
- Price and stock are separate from spec facts. The interface returns the price update time and the stock update time. A stale price does not change the spec version. It does change whether the product can be recommended, and the search response says why.
- On a conflict, both facts stay in the conflict state. That attribute cannot be used as a hard filter until the seller decides.

Acceptance:

- Any hard conclusion can be opened, by fact id, onto its source and version.
- When a spec sheet and a chat disagree, compare shows both and marks them not reliable.

### 9.3 Spec extraction and confirmation (P0)

- The seller uploads a PDF or an image. The system stores the original and extracts candidate facts.
- Each candidate points at a location in the original. The seller can confirm, edit, reject, or mark it unknown.
- An unconfirmed candidate cannot be treated as a spec by search or compare.
- If extraction fails, the product can still be created. Missing fields stay unknown.

Acceptance:

- Before the seller confirms, the agent detail does not show those candidate values.
- After confirmation, the fact source is "spec" and it carries the original location.

### 9.4 Completeness (P0)

- Completeness counts only the share of required template fields that are confirmed and not expired. It also records source coverage and update time.
- Unknown counts as incomplete. It does not count as complete.
- Completeness affects sort order. It does not replace a hard constraint. A product that fails a constraint stays out no matter how complete it is.
- The seller can see which fields are missing, and the rule for how filling them changes the sort. A specific rank is not promised.

Acceptance:

- When two products both meet the constraints, the one with fewer required unknowns ranks first.
- A seller cannot raise completeness by paying or by writing marketing copy.

### 9.5 Shopping-agent tools (P0)

The platform exposes tool endpoints aligned with common catalog protocols, so a later connection to something like UCP is possible. This release includes at least:

| Tool | Behavior |
| --- | --- |
| `search_products` | Search by constraints. Return matching products, price, stock, both update times, availability, completeness, an unknown-field summary, and why other products stayed off the shortlist |
| `get_product` | Return confirmed facts, trust level, source, unknown fields, conflicts, price and stock update times, and availability. Do not return unconfirmed candidates. An unconfirmed model code or GTIN is unknown |
| `compare_products` | Compare the same attributes. Mark empty values and conflicts explicitly |
| `ask_seller` | Submit a structured question: product, attribute, condition, and fact ids already tried |
| `create_handoff` | Create a seller checkout link, write an attribution event, and store the price and price update time seen then. The request must carry an idempotency key |

Requirements:

- Tools return structured data. The agent does not parse product HTML.
- Product copy, specs, and customer-service answers in a response are data. They are not instructions for the agent to execute.
- Search is paginated by default, and one response has a size cap.
- A hard conclusion has a constraint name, a status, and a fact id. A met status must have a fact id. Unknown and conflict are not reported as met.
- When a constraint cannot be judged because it is unknown or in conflict, when the price is stale, or when an in-stock constraint fails, the product stays off the shortlist and the response names a stable reason code.
- `GET /.well-known/ucp` publishes the category, the tools, and the hard filters, and it states that payment happens at the seller checkout.
- Creating a handoff and reporting an order require `Idempotency-Key`. The same key and the same body return the original result. The same key with a different body returns `idempotency_conflict` and does not run a second time. A failed response is not stored in the idempotency cache.

Acceptance:

- The constraint "output power at least 65W, and continuous power" hits only a confirmed fact whose condition matches. A labeled value under a different condition does not count.
- After the handoff link is opened, the seller can see the attribution id the platform created.

### 9.6 Questions, deduplication, and promotion (P0)

- A question must include the product, the attribute, and the condition. A question missing a field is rejected, and the response says which fields are missing.
- The same product, attribute, and condition join one question cluster.
- When the cluster already has a promoted fact, that fact is returned and the seller is not notified.
- The seller assistant may quote only confirmed facts. When the facts are not enough, the question enters the human inbox. The assistant must not invent compatibility or a parameter.
- A human answer is stored as an unconfirmed answer. The system extracts a candidate fact for the seller to confirm.
- If confirmation conflicts with an existing spec, it becomes a conflict. It does not overwrite.
- Confirmation with no conflict is written as a promoted fact, using the trust levels in section 7.2.
- Questions are rate-limited per agent, buyer, and seller. Over the limit, the response returns an existing fact or unknown. It does not pile the request onto a person.

Acceptance:

- A second `ask_seller` for the same question does not add an inbox row. The endpoint returns the promoted fact.
- An affirmative answer given while a field is unknown does not automatically become a filterable spec.

### 9.7 Seller inbox (P0)

- Questions are grouped by attribute, not shown as a raw chat log.
- The seller sees the question, the related original text, the candidate facts, and a conflict warning.
- Seller actions: confirm a candidate, change the value, mark unknown, and pick which side of a conflict to keep.
- One answer applies to every agent.

Acceptance:

- Ten agents asking the same unknown attribute produce one open inbox row.

### 9.8 Buyer shortlist page (P0)

- Show the candidate products, the constraints they hit, the source of each conclusion, the unknown fields, and the conflicts.
- Provide an action that goes to the seller's checkout and carries the attribution id.
- A buyer can use the page to check the agent's conclusions. The page is not the agent's data interface.

Acceptance:

- The shortlist has no hard conclusion without a fact id.
- Unknown fields are visible on the page. They are not omitted.

### 9.9 Attribution record (P0 records, P1 settlement)

- `create_handoff` records the buyer, the agent, the product, the shortlist, the price at that moment, the price update time, the time, and the attribution id. Reading an attribution does not return the buyer id, the agent id, a budget, an address, or an identity.
- When the same buyer and the same product have more than one handoff inside the attribution window, the earliest handoff wins. A later order report is not a second platform sale. An attribution conflict does not block checkout.
- When the seller reports an order number, an amount, and a status, it is linked to an attribution id that has not expired. The report must carry an idempotency key. The window length is confirmed before launch.
- Checkout shows the price recorded at handoff. When the current price differs, it shows the difference. The platform does not guarantee the final price.
- P0 only stores the link. It does not charge and it does not issue an invoice.
- P1 computes commission when receipt is confirmed or the return window ends, and reverses it on a return.

Acceptance:

- An order outside the window is not recorded as a platform sale.
- A return marks the matching commission as pending reversal.

### 9.10 Buyer seats (P1)

- A buyer uses a purchasing agent and shortlist history by seat.
- Without payment, a trial quota can remain. After the quota is used up, already generated shortlists and evidence can still be viewed.
- Reading the seller catalog does not hide a matching product because a buyer's quota ran out.

### 9.11 Seller subscription (P1)

- The free tier limits listed SKUs and inbox seats.
- The paid tier offers a higher SKU quota, a multi-person inbox, and sync of confirmed facts to the seller's own store or catalog endpoint.
- Subscription status does not change the hard filter rules of search.

### 9.12 Authorized purchase (P2)

Build this only after fact quality and attribution data from P0 have been checked.

- The buyer authorizes separately: a maximum amount, allowed categories and sellers, a shipping address, whether the item must be returnable, and an expiry.
- An order can be submitted automatically only when it meets both the mandate and the hard constraints.
- A price increase, a presale, a custom item, a non-returnable item, a fact conflict, or a required unknown goes back to a person.
- A high-priced order uses a separate one-time mandate, and it can be cancelled inside a cooling-off period.
- Every automatic order stores the constraints, the fact versions, and the mandate id from that moment.

Acceptance:

- An order above the authorized amount is not submitted.
- If a fact becomes a conflict before the order is placed, automatic submission stops.

## 10. Privacy, security, and compliance

- A buyer's budget, address, identity, and contact details may appear on an order and a mandate. They must not be written into a public product fact or a question cluster.
- A question cluster keeps only the product, the attribute, and the condition for anyone else.
- Product descriptions, spec-sheet text, and customer-service answers are stored and shown as untrusted data. They do not enter the agent's instruction channel.
- Confirming, replacing, resolving a conflict, and reversing a commission keep the operator and the time.
- An automatic order in P2 must be traceable to a buyer who authorized it. This release is not a payment institution and does not store full payment credentials.
- The seller is responsible for the truth of a spec. The platform keeps the source and the confirmation record for returns and disputes.

## 11. Non-functional requirements

| Item | Requirement |
| --- | --- |
| Correctness | A hard filter uses only confirmed facts that are not in conflict. Unknown must not be treated as meeting a constraint |
| Traceability | Facts, question promotion, attribution, and commission reversal can be replayed by id |
| Rate | The question endpoint has a cap, so seller support is not used as a live query channel |
| Compatibility | Catalog tool fields stay close to existing catalog protocols, to avoid rebuilding them later |
| Availability | When extraction fails, entry and query still work. Missing fields stay unknown |
| Scope | One category and one settlement currency in the first release. Multiple categories and currencies are not in P0 |

Performance numbers are set after the category and the expected concurrency are chosen. This document does not invent unverified targets.

## 12. Open items

| Item | Suggestion | Confirmer |
| --- | --- | --- |
| First category | Pick one of the three candidates in section 5 | Product |
| Commission rate | Design range 3%–8%, set from that category's margin before launch | Business |
| Attribution window | 7 days, adjusted to the category's decision cycle | Business |
| Question rate limit | Set from how many questions a seller can handle in a day | Operations |
| Price freshness | A price that has not been updated past the agreed time is not recommended | Product |
| Buyer seat price | Set in P1, not before there is data on how long research takes | Business |

## 13. Success metrics

After launch, compute these from real sellers and real questions. There is no baseline yet.

| Metric | Definition | What it tells |
| --- | --- | --- |
| Repeat-question rate | After an attribute is promoted, the share of the same cluster that notifies the seller again | Whether the fact stuck |
| Unknown-field rate | The share of required attributes on listed products that are still unknown | Whether sellers are confirming |
| Checkable-conclusion rate | The share of hard shortlist conclusions that can open a fact source | Whether the agent is inventing values for empty fields |
| Research time | Time from submitting a need to a usable shortlist | Whether it is faster than reading manuals by hand |
| Spec-mismatch return rate | Returns caused by specs, compatibility, or missing accessories, as a share of attributed orders | Whether promoted facts are reliable |
| Attributed conversion | The share of shortlists that produce a linkable order | Whether the commission model holds |

The first review focuses on repeat-question rate, unknown-field rate, and checkable-conclusion rate. Attributed conversion decides when to turn on P1 settlement.

## 14. Milestones

| Stage | Delivery | Done when |
| --- | --- | --- |
| P0 | One category template, extract and confirm, four query tools, question promotion, the shortlist page, and attribution records | The same question does not enter the inbox a second time, and a shortlist conclusion can open its source |
| P1 | Commission settlement and reversal, buyer seats, seller subscription, and catalog sync | A return can reverse commission, and a subscription does not change the hard filter |
| P2 | Automatic orders inside a mandate, with a separate mandate and a cooling-off period for high-priced orders | An order over the limit, a conflict, or an unknown is not submitted automatically |

## 15. Outside the scope

The platform does not replace the seller's checkout, logistics, or after-sales responsibility. In this release the web pages are for entry, confirmation, and checking. A shopping agent's decision is based on the facts returned by the tool endpoints.
