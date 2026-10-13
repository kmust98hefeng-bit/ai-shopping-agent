import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { evaluateOrder } from "./domain/attribution.js";
import { buildView, isPriceFresh, presentFact } from "./domain/facts.js";
import { compareCatalog, normalizeConstraints, passesFacts, searchCatalog } from "./domain/catalog.js";
import { extractSpec } from "./domain/extract.js";
import { fail } from "./domain/errors.js";
import { ASK_DAILY_LIMIT, dayKey, decideAsk, missingAskFields, publicAskInput } from "./domain/questions.js";
import {
  CATEGORY,
  DEFAULT_ATTRIBUTES,
  SORT_RULE,
  assertAttributeValue,
  findAttribute,
  sameValue,
} from "./domain/template.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sellers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS attributes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  data_type TEXT NOT NULL,
  unit TEXT,
  required INTEGER NOT NULL,
  kind TEXT NOT NULL,
  condition TEXT,
  example TEXT,
  enum_values TEXT,
  sort_order INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL,
  category_id TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  stock INTEGER NOT NULL,
  returnable INTEGER NOT NULL,
  price_updated_at INTEGER NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  stored_path TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS facts (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  attribute_id TEXT NOT NULL,
  value TEXT,
  unit TEXT,
  condition TEXT NOT NULL DEFAULT '',
  trust_level TEXT NOT NULL,
  status TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_ref TEXT,
  source_excerpt TEXT,
  confirmed_by TEXT,
  confirmed_at INTEGER,
  version INTEGER NOT NULL,
  supersedes_id TEXT,
  question_id TEXT,
  document_id TEXT,
  line_no INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS question_clusters (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  seller_id TEXT NOT NULL,
  attribute_id TEXT NOT NULL,
  condition TEXT NOT NULL,
  status TEXT NOT NULL,
  promoted_fact_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (product_id, attribute_id, condition)
);
CREATE TABLE IF NOT EXISTS answers (
  id TEXT PRIMARY KEY,
  cluster_id TEXT NOT NULL,
  body TEXT NOT NULL,
  trust_level TEXT NOT NULL,
  created_by TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS ask_log (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  seller_id TEXT NOT NULL,
  cluster_id TEXT,
  created_human INTEGER NOT NULL,
  day TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS handoffs (
  id TEXT PRIMARY KEY,
  buyer_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  seller_id TEXT NOT NULL,
  shortlist_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  handoff_id TEXT NOT NULL UNIQUE,
  order_no TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  status TEXT NOT NULL,
  commission_status TEXT,
  counted INTEGER NOT NULL,
  reported_at INTEGER NOT NULL,
  reported_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_facts_product ON facts(product_id);
`;

export function createStore(filename, options = {}) {
  const db = new DatabaseSync(filename);
  db.exec(SCHEMA);
  const store = new Store(db, options);
  store.ensureAttributes();
  return store;
}

export class Store {
  constructor(db, options = {}) {
    this.db = db;
    this.uploadDir = options.uploadDir || null;
  }

  close() {
    this.db.close();
  }

  tx(fn) {
    this.db.exec("BEGIN");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  ensureAttributes() {
    const count = Number(this.db.prepare("SELECT COUNT(*) AS n FROM attributes").get().n);
    if (count > 0) return;
    const insert = this.db.prepare(`
      INSERT INTO attributes (
        id, name, data_type, unit, required, kind, condition, example, enum_values, sort_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const attribute of DEFAULT_ATTRIBUTES) insert.run(...attributeParams(attribute));
  }

  countProducts() {
    return Number(this.db.prepare("SELECT COUNT(*) AS n FROM products").get().n);
  }

  listAttributes() {
    return this.db.prepare("SELECT * FROM attributes ORDER BY sort_order, id").all().map(rowToAttribute);
  }

  attribute(id) {
    const row = this.db.prepare("SELECT * FROM attributes WHERE id = ?").get(id);
    return row ? rowToAttribute(row) : null;
  }

  addAttribute(input) {
    const id = String(input.id || "").trim();
    if (!/^[a-z][a-z0-9_]*$/.test(id)) throw fail(400, "属性标识无效");
    if (this.attribute(id)) throw fail(400, "属性已存在");
    if (!input.name || !input.dataType || !input.kind) throw fail(400, "属性缺少名称、类型或种类");
    const sort = Number(this.db.prepare("SELECT COALESCE(MAX(sort_order), 0) AS n FROM attributes").get().n) + 1;
    const attribute = {
      id,
      name: String(input.name).trim(),
      dataType: input.dataType,
      unit: input.unit || null,
      required: Boolean(input.required),
      kind: input.kind,
      condition: input.condition || null,
      example: input.example || null,
      enumValues: input.enumValues || null,
      sortOrder: sort,
    };
    this.db.prepare(`
      INSERT INTO attributes (
        id, name, data_type, unit, required, kind, condition, example, enum_values, sort_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(...attributeParams(attribute));
    return this.attribute(id);
  }

  updateAttribute(id, patch) {
    const current = this.attribute(id);
    if (!current) throw fail(404, "属性不存在");
    const next = {
      ...current,
      name: patch.name ?? current.name,
      dataType: patch.dataType ?? current.dataType,
      unit: patch.unit === undefined ? current.unit : patch.unit,
      required: patch.required === undefined ? current.required : Boolean(patch.required),
      kind: patch.kind ?? current.kind,
      condition: patch.condition === undefined ? current.condition : patch.condition,
      example: patch.example === undefined ? current.example : patch.example,
      enumValues: patch.enumValues === undefined ? current.enumValues : patch.enumValues,
    };
    this.db.prepare(`
      UPDATE attributes
      SET name = ?, data_type = ?, unit = ?, required = ?, kind = ?, condition = ?, example = ?, enum_values = ?
      WHERE id = ?
    `).run(
      next.name,
      next.dataType,
      next.unit,
      next.required ? 1 : 0,
      next.kind,
      next.condition,
      next.example,
      next.enumValues ? JSON.stringify(next.enumValues) : null,
      id,
    );
    return this.attribute(id);
  }

  listSellers() {
    return this.db.prepare("SELECT id, name FROM sellers ORDER BY name").all();
  }

  ensureSeller(id, name) {
    this.db.prepare("INSERT INTO sellers (id, name) VALUES (?, ?) ON CONFLICT(id) DO NOTHING").run(id, name);
  }

  listProducts() {
    const attributes = this.listAttributes();
    return this.db.prepare("SELECT * FROM products ORDER BY created_at, id").all().map((row) => {
      const product = rowToProduct(row);
      const view = buildView(attributes, this.factsFor(product.id));
      return {
        id: product.id,
        sellerId: product.sellerId,
        title: product.title,
        status: product.status,
        priceCents: product.priceCents,
        stock: product.stock,
        returnable: product.returnable,
        completeness: view.completeness,
        missing: view.completeness.missing,
        conflicts: view.conflicts.map((group) => group.name),
      };
    });
  }

  createProduct(input, now) {
    const seller = this.db.prepare("SELECT id FROM sellers WHERE id = ?").get(input.sellerId);
    if (!seller) throw fail(400, "卖家不存在");
    const title = String(input.title || "").trim();
    if (!title) throw fail(400, "缺少商品标题");
    const priceCents = Number(input.priceCents);
    const stock = Number(input.stock);
    if (!Number.isInteger(priceCents) || priceCents < 0) throw fail(400, "价格无效");
    if (!Number.isInteger(stock) || stock < 0) throw fail(400, "库存无效");
    const id = input.id || randomUUID();
    this.db.prepare(`
      INSERT INTO products (
        id, seller_id, category_id, title, status, price_cents, stock, returnable,
        price_updated_at, description, notes, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?)
    `).run(
      id,
      input.sellerId,
      CATEGORY.id,
      title,
      input.status || "on_sale",
      priceCents,
      stock,
      input.returnable === false ? 0 : 1,
      input.priceUpdatedAt ?? now,
      input.description || "",
      now,
    );
    return this.product(id);
  }

  updateProduct(id, patch) {
    const product = this.product(id);
    if (!product) throw fail(404, "商品不存在");
    const status = patch.status ?? product.status;
    const returnable = patch.returnable === undefined ? product.returnable : Boolean(patch.returnable);
    if (status !== "on_sale" && status !== "off_sale") throw fail(400, "商品状态无效");
    this.db.prepare("UPDATE products SET status = ?, returnable = ? WHERE id = ?").run(status, returnable ? 1 : 0, id);
    return this.product(id);
  }

  product(id) {
    const row = this.db.prepare("SELECT * FROM products WHERE id = ?").get(id);
    return row ? rowToProduct(row) : null;
  }

  getSellerProduct(id) {
    const product = this.product(id);
    if (!product) throw fail(404, "商品不存在");
    const attributes = this.listAttributes();
    const facts = this.factsFor(id);
    const view = buildView(attributes, facts);
    const candidates = facts
      .filter((fact) => fact.status === "candidate")
      .map((fact) => presentFact(fact, findAttribute(attributes, fact.attributeId)));
    const documents = this.db.prepare(
      "SELECT id, product_id, filename, stored_path, body, created_at FROM documents WHERE product_id = ? ORDER BY created_at",
    ).all(id).map(rowToDocument);
    return {
      sortRule: SORT_RULE,
      product: presentProduct(product),
      documents,
      candidates,
      ...view,
      agentView: this.getAgentProduct(id),
    };
  }

  getAgentProduct(id) {
    const product = this.product(id);
    if (!product) throw fail(404, "商品不存在");
    const attributes = this.listAttributes();
    const view = buildView(attributes, this.factsFor(id));
    return {
      role: "data",
      product: presentProduct(product),
      ...view,
      notes: { role: "data", text: product.notes },
    };
  }

  addDocument(productId, { filename, text }, now) {
    const product = this.product(productId);
    if (!product) throw fail(404, "商品不存在");
    const extracted = extractSpec(text);
    const docId = randomUUID();
    let storedPath = "";
    if (this.uploadDir) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
      const safe = String(filename || "spec.txt").replace(/[^a-zA-Z0-9._-]/g, "_") || "spec.txt";
      storedPath = path.join(this.uploadDir, `${docId}-${safe}`);
      fs.writeFileSync(storedPath, String(text ?? ""), "utf8");
    }
    return this.tx(() => {
      this.db.prepare(`
        INSERT INTO documents (id, product_id, filename, stored_path, body, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(docId, productId, filename || "spec.txt", storedPath, String(text ?? ""), now);
      if (extracted.notes.length) {
        const notes = [product.notes, ...extracted.notes].filter(Boolean).join("\n");
        this.db.prepare("UPDATE products SET notes = ? WHERE id = ?").run(notes, productId);
      }
      const candidates = [];
      for (const candidate of extracted.candidates) {
        const attribute = this.attribute(candidate.attributeId);
        if (!attribute) continue;
        const fact = this.insertFact({
          productId,
          attributeId: candidate.attributeId,
          value: candidate.value,
          unit: candidate.unit || attribute.unit,
          condition: candidate.condition,
          trustLevel: "候选",
          status: "candidate",
          sourceType: "spec",
          sourceRef: `${docId}#L${candidate.lineNo}`,
          sourceExcerpt: candidate.excerpt,
          version: this.maxVersion(productId, candidate.attributeId, candidate.condition) + 1,
          documentId: docId,
          lineNo: candidate.lineNo,
          createdAt: now,
        });
        candidates.push(presentFact(fact, attribute));
      }
      return { documentId: docId, candidates, notes: extracted.notes };
    });
  }

  createSellerFact(productId, input, now) {
    const product = this.product(productId);
    if (!product) throw fail(404, "商品不存在");
    const attribute = this.attribute(input.attributeId);
    if (!attribute) throw fail(400, "属性不在类目模板中");
    const value = assertAttributeValue(attribute, input.value);
    const condition = input.condition || attribute.condition || "";
    const by = input.by || product.sellerId;
    const fact = this.insertFact({
      productId,
      attributeId: attribute.id,
      value,
      unit: attribute.unit,
      condition,
      trustLevel: "候选",
      status: "candidate",
      sourceType: "seller",
      sourceExcerpt: input.excerpt || null,
      version: this.maxVersion(productId, attribute.id, condition) + 1,
      createdAt: now,
    });
    return this.confirmFact(fact.id, { by, now });
  }

  confirmFact(id, { value, by, now }) {
    const fact = this.fact(id);
    if (!fact) throw fail(404, "事实不存在");
    if (fact.status !== "candidate") throw fail(400, "只有候选事实可以确认");
    const attribute = this.attribute(fact.attributeId);
    const nextValue = value == null || value === "" ? fact.value : assertAttributeValue(attribute, value);
    if (value == null || value === "") assertAttributeValue(attribute, nextValue);
    const condition = fact.condition || attribute.condition || "";
    return this.tx(() => this.confirmInside(fact, attribute, nextValue, condition, by, now));
  }

  confirmInside(fact, attribute, nextValue, condition, by, now) {
    const existing = this.confirmedFacts(fact.productId, fact.attributeId, condition);
    const conflicts = existing.filter((row) => !sameValue(attribute, row.value, nextValue));
    if (conflicts.length) {
      for (const row of existing) this.setFactState(row.id, { status: "conflict", trustLevel: "冲突", confirmedBy: by, confirmedAt: now });
      this.setFactState(fact.id, {
        status: "conflict",
        trustLevel: "冲突",
        value: nextValue,
        confirmedBy: by,
        confirmedAt: now,
      });
      return this.fact(fact.id);
    }
    for (const row of existing) this.setFactState(row.id, { status: "superseded", confirmedBy: by, confirmedAt: now });
    const trustLevel = trustForSource(fact.sourceType);
    this.setFactState(fact.id, {
      status: "confirmed",
      trustLevel,
      value: nextValue,
      condition,
      version: existing.length ? this.maxVersion(fact.productId, fact.attributeId, condition) + 1 : fact.version,
      supersedesId: existing[0]?.id || fact.supersedesId,
      confirmedBy: by,
      confirmedAt: now,
    });
    if (fact.questionId) this.promoteCluster(fact.questionId, fact.id, now);
    return this.fact(fact.id);
  }

  reviseFact(id, { value, by, now }) {
    const fact = this.fact(id);
    if (!fact) throw fail(404, "事实不存在");
    if (fact.status !== "confirmed") throw fail(400, "只能修改已确认事实");
    const attribute = this.attribute(fact.attributeId);
    const nextValue = assertAttributeValue(attribute, value);
    return this.tx(() => {
      const version = this.maxVersion(fact.productId, fact.attributeId, fact.condition) + 1;
      const created = this.insertFact({
        productId: fact.productId,
        attributeId: fact.attributeId,
        value: nextValue,
        unit: fact.unit || attribute.unit,
        condition: fact.condition,
        trustLevel: "确认参数",
        status: "confirmed",
        sourceType: "seller",
        sourceRef: fact.sourceRef,
        sourceExcerpt: fact.sourceExcerpt,
        confirmedBy: by,
        confirmedAt: now,
        version,
        supersedesId: fact.id,
        questionId: fact.questionId,
        documentId: fact.documentId,
        lineNo: fact.lineNo,
        createdAt: now,
      });
      this.setFactState(fact.id, { status: "superseded", confirmedBy: by, confirmedAt: now });
      if (fact.questionId) this.promoteCluster(fact.questionId, created.id, now);
      return this.fact(created.id);
    });
  }

  rejectFact(id, { by, now }) {
    const fact = this.fact(id);
    if (!fact) throw fail(404, "事实不存在");
    this.setFactState(id, { status: "rejected", confirmedBy: by, confirmedAt: now });
    return this.fact(id);
  }

  markUnknown(id, { by, now }) {
    const fact = this.fact(id);
    if (!fact) throw fail(404, "事实不存在");
    this.setFactState(id, {
      status: "unknown",
      trustLevel: "未知",
      value: null,
      confirmedBy: by,
      confirmedAt: now,
    });
    return this.fact(id);
  }

  resolveConflict({ productId, attributeId, condition, chosenFactId, by, now }) {
    const chosen = this.fact(chosenFactId);
    if (!chosen || chosen.status !== "conflict") throw fail(400, "请选择一条冲突事实");
    if (chosen.productId !== productId || chosen.attributeId !== attributeId || chosen.condition !== condition) {
      throw fail(400, "冲突事实与商品属性不匹配");
    }
    const attribute = this.attribute(attributeId);
    return this.tx(() => {
      const group = this.db.prepare(`
        SELECT * FROM facts
        WHERE product_id = ? AND attribute_id = ? AND condition = ? AND status = 'conflict'
      `).all(productId, attributeId, condition).map(rowToFact);
      const version = this.maxVersion(productId, attributeId, condition) + 1;
      const created = this.insertFact({
        productId,
        attributeId,
        value: chosen.value,
        unit: chosen.unit || attribute?.unit,
        condition,
        trustLevel: trustForSource(chosen.sourceType),
        status: "confirmed",
        sourceType: chosen.sourceType,
        sourceRef: chosen.sourceRef,
        sourceExcerpt: chosen.sourceExcerpt,
        confirmedBy: by,
        confirmedAt: now,
        version,
        supersedesId: chosen.id,
        questionId: chosen.questionId,
        documentId: chosen.documentId,
        lineNo: chosen.lineNo,
        createdAt: now,
      });
      for (const row of group) {
        this.setFactState(row.id, {
          status: row.id === chosen.id ? "superseded" : "rejected",
          confirmedBy: by,
          confirmedAt: now,
        });
      }
      if (chosen.questionId) this.promoteCluster(chosen.questionId, created.id, now);
      return this.fact(created.id);
    });
  }

  getFactHistory(id) {
    const fact = this.fact(id);
    if (!fact) throw fail(404, "事实不存在");
    const attribute = this.attribute(fact.attributeId);
    return this.db.prepare(`
      SELECT * FROM facts
      WHERE product_id = ? AND attribute_id = ? AND condition = ?
      ORDER BY version, created_at
    `).all(fact.productId, fact.attributeId, fact.condition).map((row) => presentFact(rowToFact(row), attribute));
  }

  search(input, now) {
    const constraints = normalizeConstraints(input);
    const records = this.records();
    return searchCatalog(records, this.listAttributes(), constraints, now);
  }

  compare(ids) {
    if (!Array.isArray(ids) || ids.length < 2) throw fail(400, "至少选择两个商品");
    return compareCatalog(this.records(), this.listAttributes(), ids.slice(0, 8));
  }

  askSeller(input, now) {
    const visible = publicAskInput(input);
    const missing = missingAskFields(visible);
    if (missing.length) throw fail(400, "提问缺少字段", { missing });
    const condition = String(visible.condition).trim();
    const product = this.product(visible.productId);
    if (!product) throw fail(404, "商品不存在");
    const attribute = this.attribute(visible.attributeId);
    if (!attribute) throw fail(400, "属性不在类目模板中");
    const usable = this.confirmedFacts(product.id, attribute.id, condition).find((fact) =>
      !attribute.condition || fact.condition === attribute.condition,
    );
    const cluster = this.cluster(product.id, attribute.id, condition);
    const humanCount = this.humanAskCount(visible.agentId, product.sellerId, dayKey(now));
    const decision = decideAsk({
      usableFact: usable,
      cluster,
      humanCount,
    });
    if (decision.action === "cite") {
      return { ok: true, inboxCreated: false, unknown: false, fact: presentFact(usable, attribute), source: "assistant" };
    }
    if (decision.action === "cite-promoted") {
      const fact = this.fact(cluster.promotedFactId);
      return {
        ok: true,
        inboxCreated: false,
        unknown: false,
        clusterId: cluster.id,
        fact: presentFact(fact, attribute),
        source: "promoted",
      };
    }
    if (decision.action === "join") {
      this.insertAskLog({ agentId: visible.agentId, sellerId: product.sellerId, clusterId: cluster.id, createdHuman: 0, now });
      return { ok: true, inboxCreated: false, unknown: true, clusterId: cluster.id, fact: null, trustLevel: "未知" };
    }
    if (decision.action === "limit") {
      return { ok: true, limited: true, inboxCreated: false, unknown: true, fact: null, trustLevel: "未知" };
    }
    const clusterId = randomUUID();
    this.tx(() => {
      this.db.prepare(`
        INSERT INTO question_clusters (
          id, product_id, seller_id, attribute_id, condition, status, promoted_fact_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'open', NULL, ?, ?)
      `).run(clusterId, product.id, product.sellerId, attribute.id, condition, now, now);
      this.insertAskLog({ agentId: visible.agentId, sellerId: product.sellerId, clusterId, createdHuman: 1, now });
    });
    return { ok: true, inboxCreated: true, unknown: true, clusterId, fact: null, trustLevel: "未知" };
  }

  listInbox(sellerId) {
    const rows = this.db.prepare(`
      SELECT c.*, p.title AS product_title
      FROM question_clusters c
      JOIN products p ON p.id = c.product_id
      WHERE c.seller_id = ? AND c.status = 'open'
      ORDER BY c.created_at, c.id
    `).all(sellerId);
    return rows.map((row) => {
      const attribute = this.attribute(row.attribute_id);
      const answers = this.db.prepare("SELECT * FROM answers WHERE cluster_id = ? ORDER BY created_at").all(row.id);
      const candidates = this.db.prepare(`
        SELECT * FROM facts WHERE question_id = ? AND status = 'candidate' ORDER BY created_at
      `).all(row.id).map((fact) => presentFact(rowToFact(fact), attribute));
      const conflict = this.db.prepare(`
        SELECT COUNT(*) AS n FROM facts
        WHERE product_id = ? AND attribute_id = ? AND condition = ? AND status = 'conflict'
      `).get(row.product_id, row.attribute_id, row.condition);
      return {
        id: row.id,
        productId: row.product_id,
        productTitle: row.product_title,
        attributeId: row.attribute_id,
        attributeName: attribute?.name || row.attribute_id,
        condition: row.condition,
        status: row.status,
        createdAt: row.created_at,
        conflict: Number(conflict.n) > 0,
        answers: answers.map((answer) => ({
          id: answer.id,
          trustLevel: answer.trust_level,
          createdAt: answer.created_at,
          body: { role: "data", text: answer.body },
        })),
        candidates,
      };
    });
  }

  answerCluster(clusterId, { text, value, by, now }) {
    const cluster = this.clusterById(clusterId);
    if (!cluster || cluster.status !== "open") throw fail(404, "问题不在待处理中");
    const attribute = this.attribute(cluster.attributeId);
    const body = String(text || "").trim();
    if (!body && (value == null || value === "")) throw fail(400, "缺少回答");
    let candidateValue = value == null || value === "" ? null : assertAttributeValue(attribute, value);
    let excerpt = body;
    let lineNo = null;
    if (!candidateValue && body) {
      const extracted = extractSpec(body).candidates.find((item) => item.attributeId === attribute.id);
      if (extracted) {
        candidateValue = assertAttributeValue(attribute, extracted.value);
        excerpt = extracted.excerpt;
        lineNo = extracted.lineNo;
      }
    }
    return this.tx(() => {
      const answerId = randomUUID();
      this.db.prepare(`
        INSERT INTO answers (id, cluster_id, body, trust_level, created_by, created_at)
        VALUES (?, ?, ?, '未确认问答', ?, ?)
      `).run(answerId, clusterId, body || String(candidateValue), by || null, now);
      if (!candidateValue) return { answerId, candidate: null };
      const fact = this.insertFact({
        productId: cluster.productId,
        attributeId: attribute.id,
        value: candidateValue,
        unit: attribute.unit,
        condition: cluster.condition,
        trustLevel: "候选",
        status: "candidate",
        sourceType: "answer",
        sourceExcerpt: excerpt,
        version: this.maxVersion(cluster.productId, attribute.id, cluster.condition) + 1,
        questionId: clusterId,
        lineNo,
        createdAt: now,
      });
      return { answerId, candidate: presentFact(fact, attribute) };
    });
  }

  createHandoff(input, now) {
    const addressLeak = input.address || input.identity || input.budget;
    const product = this.product(input.productId);
    if (!product) throw fail(404, "商品不存在");
    if (!input.buyerId || !input.agentId) throw fail(400, "缺少买家或代理标识");
    const constraints = normalizeConstraints(input.constraints || {});
    const attributes = this.listAttributes();
    const view = buildView(attributes, this.factsFor(product.id));
    const record = { product, facts: this.factsFor(product.id) };
    if (product.status !== "on_sale" || !passesFacts(view, constraints)) {
      throw fail(409, "商品不满足当前约束");
    }
    if (!isPriceFresh(product, now)) throw fail(409, "商品标价已过期");
    const result = searchCatalog([record], attributes, { ...constraints, page: 1, pageSize: 1 }, now);
    const item = result.products[0];
    if (!item) throw fail(409, "商品不满足当前约束");
    const id = randomUUID();
    const shortlist = {
      role: "data",
      constraints,
      product: item,
    };
    if (addressLeak) {
      const serialized = JSON.stringify(shortlist);
      for (const secret of [input.address, input.identity, input.budget].filter(Boolean)) {
        if (serialized.includes(String(secret))) throw fail(500, "归因记录混入了买家隐私");
      }
    }
    this.db.prepare(`
      INSERT INTO handoffs (id, buyer_id, agent_id, product_id, seller_id, shortlist_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.buyerId, input.agentId, product.id, product.sellerId, JSON.stringify(shortlist), now);
    return {
      id,
      productId: product.id,
      sellerId: product.sellerId,
      checkoutPath: `/checkout.html?id=${id}`,
      createdAt: now,
    };
  }

  getHandoff(id) {
    const row = this.db.prepare("SELECT * FROM handoffs WHERE id = ?").get(id);
    if (!row) throw fail(404, "归因不存在");
    return {
      id: row.id,
      buyerId: row.buyer_id,
      agentId: row.agent_id,
      productId: row.product_id,
      sellerId: row.seller_id,
      createdAt: row.created_at,
      shortlist: JSON.parse(row.shortlist_json),
    };
  }

  listHandoffs(sellerId) {
    return this.db.prepare(`
      SELECT h.id, h.product_id, h.created_at, p.title
      FROM handoffs h JOIN products p ON p.id = h.product_id
      WHERE h.seller_id = ?
      ORDER BY h.created_at DESC
    `).all(sellerId).map((row) => ({
      id: row.id,
      productId: row.product_id,
      productTitle: row.title,
      createdAt: row.created_at,
    }));
  }

  reportOrder(input) {
    const handoff = this.db.prepare("SELECT * FROM handoffs WHERE id = ?").get(input.attributionId);
    if (!handoff) throw fail(404, "归因不存在");
    if (!input.orderNo) throw fail(400, "缺少订单号");
    const amountCents = Number(input.amountCents);
    if (!Number.isInteger(amountCents) || amountCents < 0) throw fail(400, "订单金额无效");
    if (input.status !== "paid" && input.status !== "refunded") throw fail(400, "订单状态无效");
    const reportedAt = input.reportedAt;
    const evaluation = evaluateOrder({
      handoffCreatedAt: handoff.created_at,
      reportedAt,
      status: input.status,
    });
    const existing = this.db.prepare("SELECT * FROM orders WHERE handoff_id = ?").get(handoff.id);
    if (existing) {
      this.db.prepare(`
        UPDATE orders
        SET order_no = ?, amount_cents = ?, status = ?, commission_status = ?, counted = ?, reported_at = ?, reported_by = ?
        WHERE id = ?
      `).run(
        input.orderNo,
        amountCents,
        input.status,
        evaluation.commissionStatus,
        evaluation.counted ? 1 : 0,
        reportedAt,
        input.reportedBy || null,
        existing.id,
      );
      return this.orderByHandoff(handoff.id);
    }
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO orders (
        id, handoff_id, order_no, amount_cents, status, commission_status, counted, reported_at, reported_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      handoff.id,
      input.orderNo,
      amountCents,
      input.status,
      evaluation.commissionStatus,
      evaluation.counted ? 1 : 0,
      reportedAt,
      input.reportedBy || null,
    );
    return this.orderByHandoff(handoff.id);
  }

  orderByHandoff(handoffId) {
    const row = this.db.prepare("SELECT * FROM orders WHERE handoff_id = ?").get(handoffId);
    if (!row) return null;
    return {
      id: row.id,
      handoffId: row.handoff_id,
      orderNo: row.order_no,
      amountCents: row.amount_cents,
      status: row.status,
      commissionStatus: row.commission_status,
      counted: row.counted === 1,
      platformSale: row.counted === 1 && row.status === "paid",
      reportedAt: row.reported_at,
      reportedBy: row.reported_by,
    };
  }

  listPlatformSales() {
    return this.db.prepare("SELECT handoff_id FROM orders WHERE counted = 1 AND status = 'paid'").all().map((row) =>
      this.orderByHandoff(row.handoff_id),
    );
  }

  inspectQuestions() {
    return {
      clusters: this.db.prepare("SELECT * FROM question_clusters").all(),
      answers: this.db.prepare("SELECT * FROM answers").all(),
      askLog: this.db.prepare("SELECT * FROM ask_log").all(),
    };
  }

  records() {
    const products = this.db.prepare("SELECT * FROM products").all().map(rowToProduct);
    return products.map((product) => ({ product, facts: this.factsFor(product.id) }));
  }

  factsFor(productId) {
    return this.db.prepare("SELECT * FROM facts WHERE product_id = ?").all(productId).map(rowToFact);
  }

  fact(id) {
    const row = this.db.prepare("SELECT * FROM facts WHERE id = ?").get(id);
    return row ? rowToFact(row) : null;
  }

  confirmedFacts(productId, attributeId, condition) {
    return this.db.prepare(`
      SELECT * FROM facts
      WHERE product_id = ? AND attribute_id = ? AND condition = ? AND status = 'confirmed'
    `).all(productId, attributeId, condition).map(rowToFact);
  }

  maxVersion(productId, attributeId, condition) {
    const row = this.db.prepare(`
      SELECT COALESCE(MAX(version), 0) AS n FROM facts
      WHERE product_id = ? AND attribute_id = ? AND condition = ?
    `).get(productId, attributeId, condition);
    return Number(row.n);
  }

  insertFact(input) {
    const id = input.id || randomUUID();
    this.db.prepare(`
      INSERT INTO facts (
        id, product_id, attribute_id, value, unit, condition, trust_level, status, source_type,
        source_ref, source_excerpt, confirmed_by, confirmed_at, version, supersedes_id, question_id,
        document_id, line_no, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.productId,
      input.attributeId,
      input.value ?? null,
      input.unit ?? null,
      input.condition || "",
      input.trustLevel,
      input.status,
      input.sourceType,
      input.sourceRef ?? null,
      input.sourceExcerpt ?? null,
      input.confirmedBy ?? null,
      input.confirmedAt ?? null,
      input.version,
      input.supersedesId ?? null,
      input.questionId ?? null,
      input.documentId ?? null,
      input.lineNo ?? null,
      input.createdAt,
    );
    return this.fact(id);
  }

  setFactState(id, patch) {
    const current = this.fact(id);
    this.db.prepare(`
      UPDATE facts
      SET status = ?, trust_level = ?, value = ?, condition = ?, version = ?, supersedes_id = ?,
          confirmed_by = ?, confirmed_at = ?
      WHERE id = ?
    `).run(
      patch.status ?? current.status,
      patch.trustLevel ?? current.trustLevel,
      patch.value === undefined ? current.value : patch.value,
      patch.condition ?? current.condition,
      patch.version ?? current.version,
      patch.supersedesId === undefined ? current.supersedesId : patch.supersedesId,
      patch.confirmedBy === undefined ? current.confirmedBy : patch.confirmedBy,
      patch.confirmedAt === undefined ? current.confirmedAt : patch.confirmedAt,
      id,
    );
  }

  cluster(productId, attributeId, condition) {
    const row = this.db.prepare(`
      SELECT * FROM question_clusters WHERE product_id = ? AND attribute_id = ? AND condition = ?
    `).get(productId, attributeId, condition);
    return row ? rowToCluster(row) : null;
  }

  clusterById(id) {
    const row = this.db.prepare("SELECT * FROM question_clusters WHERE id = ?").get(id);
    return row ? rowToCluster(row) : null;
  }

  promoteCluster(clusterId, factId, now) {
    this.db.prepare(`
      UPDATE question_clusters SET status = 'promoted', promoted_fact_id = ?, updated_at = ? WHERE id = ?
    `).run(factId, now, clusterId);
  }

  humanAskCount(agentId, sellerId, day) {
    const row = this.db.prepare(`
      SELECT COUNT(*) AS n FROM ask_log
      WHERE agent_id = ? AND seller_id = ? AND day = ? AND created_human = 1
    `).get(agentId, sellerId, day);
    return Number(row.n);
  }

  insertAskLog({ agentId, sellerId, clusterId, createdHuman, now }) {
    this.db.prepare(`
      INSERT INTO ask_log (id, agent_id, seller_id, cluster_id, created_human, day, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(randomUUID(), agentId, sellerId, clusterId, createdHuman ? 1 : 0, dayKey(now), now);
  }
}

function trustForSource(sourceType) {
  if (sourceType === "answer") return "晋升事实";
  if (sourceType === "seller") return "确认参数";
  return "规格";
}

function attributeParams(attribute) {
  return [
    attribute.id,
    attribute.name,
    attribute.dataType,
    attribute.unit,
    attribute.required ? 1 : 0,
    attribute.kind,
    attribute.condition,
    attribute.example,
    attribute.enumValues ? JSON.stringify(attribute.enumValues) : null,
    attribute.sortOrder,
  ];
}

function rowToAttribute(row) {
  return {
    id: row.id,
    name: row.name,
    dataType: row.data_type,
    unit: row.unit,
    required: row.required === 1,
    kind: row.kind,
    condition: row.condition,
    example: row.example,
    enumValues: row.enum_values ? JSON.parse(row.enum_values) : null,
    sortOrder: row.sort_order,
  };
}

function rowToProduct(row) {
  return {
    id: row.id,
    sellerId: row.seller_id,
    categoryId: row.category_id,
    title: row.title,
    status: row.status,
    priceCents: row.price_cents,
    stock: row.stock,
    returnable: row.returnable === 1,
    priceUpdatedAt: row.price_updated_at,
    description: row.description,
    notes: row.notes,
    createdAt: row.created_at,
  };
}

function presentProduct(product) {
  return {
    id: product.id,
    sellerId: product.sellerId,
    categoryId: product.categoryId,
    title: product.title,
    status: product.status,
    priceCents: product.priceCents,
    stock: product.stock,
    returnable: product.returnable,
    priceUpdatedAt: product.priceUpdatedAt,
    description: { role: "data", text: product.description },
  };
}

function rowToDocument(row) {
  return {
    id: row.id,
    productId: row.product_id,
    filename: row.filename,
    body: { role: "data", text: row.body },
    createdAt: row.created_at,
  };
}

function rowToFact(row) {
  return {
    id: row.id,
    productId: row.product_id,
    attributeId: row.attribute_id,
    value: row.value,
    unit: row.unit,
    condition: row.condition,
    trustLevel: row.trust_level,
    status: row.status,
    sourceType: row.source_type,
    sourceRef: row.source_ref,
    sourceExcerpt: row.source_excerpt,
    confirmedBy: row.confirmed_by,
    confirmedAt: row.confirmed_at,
    version: row.version,
    supersedesId: row.supersedes_id,
    questionId: row.question_id,
    documentId: row.document_id,
    lineNo: row.line_no,
    createdAt: row.created_at,
  };
}

function rowToCluster(row) {
  return {
    id: row.id,
    productId: row.product_id,
    sellerId: row.seller_id,
    attributeId: row.attribute_id,
    condition: row.condition,
    status: row.status,
    promotedFactId: row.promoted_fact_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const DAY = 24 * 60 * 60 * 1000;

export function seedDemo(store, now) {
  store.ensureSeller("seller-a", "稳压工作室");
  store.ensureSeller("seller-b", "峰值电子");
  const fresh = now - DAY;
  const stale = now - 31 * DAY;

  const full = [
    "持续输出功率: 65W",
    "PD 3.1: 支持",
    "是否含电源线: 不含电源线",
    "输入电压: 100-240V",
    "手感极佳，官方正品",
  ].join("\n");

  store.createProduct({
    id: "prod-65w",
    sellerId: "seller-a",
    title: "65W 氮化镓适配器",
    priceCents: 9900,
    stock: 20,
    returnable: true,
    description: "手感极佳，官方正品",
    priceUpdatedAt: fresh,
  }, now);
  confirmAll(store, store.addDocument("prod-65w", { filename: "65w.txt", text: full }, now).candidates, "seller-a", now);

  store.createProduct({
    id: "prod-peak",
    sellerId: "seller-a",
    title: "峰值标称 100W 适配器",
    priceCents: 12900,
    stock: 15,
    returnable: false,
    description: "",
    priceUpdatedAt: fresh,
  }, now);
  store.createSellerFact("prod-peak", {
    attributeId: "continuous_power_w",
    value: "100",
    condition: "峰值",
    by: "seller-a",
    excerpt: "持续输出功率栏位填写了峰值条件",
  }, now);
  store.createSellerFact("prod-peak", { attributeId: "pd31", value: "支持", by: "seller-a" }, now);
  store.createSellerFact("prod-peak", { attributeId: "includes_cable", value: "含电源线", by: "seller-a" }, now);

  store.createProduct({
    id: "prod-nopd",
    sellerId: "seller-b",
    title: "不兼容 PD 3.1 适配器",
    priceCents: 4900,
    stock: 50,
    returnable: true,
    description: "",
    priceUpdatedAt: fresh,
  }, now);
  confirmAll(store, store.addDocument("prod-nopd", {
    filename: "nopd.txt",
    text: ["持续输出功率: 65W", "PD 3.1: 不兼容", "是否含电源线: 含电源线"].join("\n"),
  }, now).candidates, "seller-b", now);

  store.createProduct({
    id: "prod-partial",
    sellerId: "seller-a",
    title: "65W 线材未知适配器",
    priceCents: 7900,
    stock: 8,
    returnable: true,
    description: "",
    priceUpdatedAt: fresh,
  }, now);
  confirmAll(store, store.addDocument("prod-partial", {
    filename: "partial.txt",
    text: ["持续输出功率: 65W", "PD 3.1: 支持"].join("\n"),
  }, now).candidates, "seller-a", now);

  store.createProduct({
    id: "prod-candidate",
    sellerId: "seller-a",
    title: "待确认氮化镓适配器",
    priceCents: 10900,
    stock: 6,
    returnable: true,
    description: "",
    priceUpdatedAt: fresh,
  }, now);
  store.addDocument("prod-candidate", { filename: "pending.txt", text: full }, now);

  store.createProduct({
    id: "prod-conflict",
    sellerId: "seller-b",
    title: "功率冲突适配器",
    priceCents: 8800,
    stock: 4,
    returnable: true,
    description: "",
    priceUpdatedAt: fresh,
  }, now);
  confirmAll(store, store.addDocument("prod-conflict", {
    filename: "conflict-a.txt",
    text: ["持续输出功率: 65W", "PD 3.1: 支持", "是否含电源线: 含电源线"].join("\n"),
  }, now).candidates, "seller-b", now);
  const second = store.addDocument("prod-conflict", {
    filename: "conflict-b.txt",
    text: "持续输出功率: 100W",
  }, now);
  store.confirmFact(second.candidates[0].id, { by: "seller-b", now });

  store.createProduct({
    id: "prod-stale",
    sellerId: "seller-a",
    title: "标价过期的 65W 适配器",
    priceCents: 5900,
    stock: 30,
    returnable: false,
    description: "",
    priceUpdatedAt: stale,
  }, now);
  confirmAll(store, store.addDocument("prod-stale", {
    filename: "stale.txt",
    text: ["持续输出功率: 65W", "PD 3.1: 支持", "是否含电源线: 含电源线"].join("\n"),
  }, now).candidates, "seller-a", now);

  store.createProduct({
    id: "prod-ask",
    sellerId: "seller-a",
    title: "待问兼容的 65W 适配器",
    priceCents: 6900,
    stock: 12,
    returnable: true,
    description: "",
    priceUpdatedAt: fresh,
  }, now);
  confirmAll(store, store.addDocument("prod-ask", {
    filename: "ask.txt",
    text: ["持续输出功率: 65W", "是否含电源线: 含电源线"].join("\n"),
  }, now).candidates, "seller-a", now);
}

function confirmAll(store, candidates, by, now) {
  for (const candidate of candidates) store.confirmFact(candidate.id, { by, now });
}
