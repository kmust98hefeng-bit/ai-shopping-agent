import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createStore, seedDemo } from "./db.js";
import { fail } from "./domain/errors.js";
import { CATEGORY, SORT_RULE } from "./domain/template.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(root, "public");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

export function createApp(store) {
  return http.createServer((req, res) => {
    handle(req, res, store).catch((error) => {
      if (!error.status) console.error(error);
      sendJson(res, error.status || 500, {
        error: error.status ? error.message : "服务器错误",
        ...(error.extra || {}),
      });
    });
  });
}

async function handle(req, res, store) {
  const url = new URL(req.url, "http://127.0.0.1");
  const { pathname } = url;
  const now = Date.now();

  if (req.method === "GET" && pathname === "/api/health") return sendJson(res, 200, { ok: true });
  if (req.method === "GET" && pathname === "/api/template") {
    return sendJson(res, 200, { category: CATEGORY, attributes: store.listAttributes(), sortRule: SORT_RULE });
  }
  if (req.method === "POST" && pathname === "/api/admin/attributes") {
    return sendJson(res, 201, store.addAttribute(await readJson(req)));
  }
  if (req.method === "GET" && pathname === "/api/sellers") return sendJson(res, 200, store.listSellers());
  if (req.method === "GET" && pathname === "/api/products") return sendJson(res, 200, store.listProducts());
  if (req.method === "POST" && pathname === "/api/products") {
    return sendJson(res, 201, store.createProduct(await readJson(req), now));
  }
  if (req.method === "GET" && pathname === "/api/inbox") {
    const sellerId = url.searchParams.get("sellerId");
    if (!sellerId) throw fail(400, "缺少卖家");
    return sendJson(res, 200, store.listInbox(sellerId));
  }
  if (req.method === "GET" && pathname === "/api/handoffs") {
    const sellerId = url.searchParams.get("sellerId");
    if (!sellerId) throw fail(400, "缺少卖家");
    return sendJson(res, 200, store.listHandoffs(sellerId));
  }

  const attributePatch = pathname.match(/^\/api\/admin\/attributes\/([^/]+)$/);
  if (req.method === "PATCH" && attributePatch) {
    return sendJson(res, 200, store.updateAttribute(decodeURIComponent(attributePatch[1]), await readJson(req)));
  }

  const product = pathname.match(/^\/api\/products\/([^/]+)$/);
  if (req.method === "GET" && product) return sendJson(res, 200, store.getSellerProduct(decodeURIComponent(product[1])));
  if (req.method === "PATCH" && product) {
    return sendJson(res, 200, store.updateProduct(decodeURIComponent(product[1]), await readJson(req)));
  }

  const document = pathname.match(/^\/api\/products\/([^/]+)\/documents$/);
  if (req.method === "POST" && document) {
    return sendJson(res, 201, store.addDocument(decodeURIComponent(document[1]), await readJson(req), now));
  }

  const sellerFact = pathname.match(/^\/api\/products\/([^/]+)\/facts$/);
  if (req.method === "POST" && sellerFact) {
    return sendJson(res, 201, store.createSellerFact(decodeURIComponent(sellerFact[1]), await readJson(req), now));
  }

  const factAction = pathname.match(/^\/api\/facts\/([^/]+)\/(confirm|revise|reject|unknown)$/);
  if (req.method === "POST" && factAction) {
    const id = decodeURIComponent(factAction[1]);
    const body = await readJson(req);
    const payload = { ...body, by: body.by, now };
    if (factAction[2] === "confirm") return sendJson(res, 200, store.confirmFact(id, payload));
    if (factAction[2] === "revise") return sendJson(res, 200, store.reviseFact(id, payload));
    if (factAction[2] === "reject") return sendJson(res, 200, store.rejectFact(id, payload));
    return sendJson(res, 200, store.markUnknown(id, payload));
  }

  const fact = pathname.match(/^\/api\/facts\/([^/]+)$/);
  if (req.method === "GET" && fact) return sendJson(res, 200, store.getFactHistory(decodeURIComponent(fact[1])));

  if (req.method === "POST" && pathname === "/api/conflicts/resolve") {
    return sendJson(res, 200, store.resolveConflict({ ...(await readJson(req)), now }));
  }

  const answer = pathname.match(/^\/api\/inbox\/([^/]+)\/answer$/);
  if (req.method === "POST" && answer) {
    return sendJson(res, 201, store.answerCluster(decodeURIComponent(answer[1]), { ...(await readJson(req)), now }));
  }

  if (req.method === "POST" && pathname === "/api/tools/search_products") {
    return sendJson(res, 200, store.search(await readJson(req), now));
  }
  if (req.method === "POST" && pathname === "/api/tools/get_product") {
    const body = await readJson(req);
    return sendJson(res, 200, store.getAgentProduct(body.productId || body.id));
  }
  if (req.method === "POST" && pathname === "/api/tools/compare_products") {
    const body = await readJson(req);
    return sendJson(res, 200, store.compare(body.productIds || []));
  }
  if (req.method === "POST" && pathname === "/api/tools/ask_seller") {
    return sendJson(res, 200, store.askSeller(await readJson(req), now));
  }
  if (req.method === "POST" && pathname === "/api/tools/create_handoff") {
    return sendJson(res, 201, store.createHandoff(await readJson(req), now));
  }
  if (req.method === "POST" && pathname === "/api/orders/report") {
    const body = await readJson(req);
    return sendJson(res, 200, store.reportOrder({ ...body, reportedAt: body.reportedAt ?? now }));
  }

  const handoff = pathname.match(/^\/api\/handoffs\/([^/]+)$/);
  if (req.method === "GET" && handoff) return sendJson(res, 200, store.getHandoff(decodeURIComponent(handoff[1])));

  if (req.method === "GET") return serveStatic(res, pathname);
  sendJson(res, 404, { error: "没有这个接口" });
}

function serveStatic(res, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const resolved = path.resolve(publicDir, `.${requested}`);
  const relative = path.relative(publicDir, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return sendJson(res, 403, { error: "禁止访问" });
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) return sendJson(res, 404, { error: "没有这个页面" });
  res.writeHead(200, {
    "content-type": MIME[path.extname(resolved)] || "application/octet-stream",
    "cache-control": "no-store",
  });
  fs.createReadStream(resolved).pipe(res);
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) throw fail(413, "请求体过大");
    chunks.push(chunk);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw fail(400, "请求体不是 JSON");
  }
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (entry && path.resolve(fileURLToPath(import.meta.url)) === entry) {
  const dataDir = path.join(root, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  const store = createStore(path.join(dataDir, "app.sqlite"), { uploadDir: path.join(dataDir, "uploads") });
  if (store.countProducts() === 0) seedDemo(store, Date.now());
  const port = Number(process.env.PORT || 3780);
  createApp(store).listen(port, "127.0.0.1", () => {
    console.log(`http://127.0.0.1:${port}`);
  });
}
