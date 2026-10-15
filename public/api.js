export async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {}),
    },
  });
  const body = await response.json();
  if (!response.ok) {
    const error = new Error(body.error || "请求失败");
    error.errorEn = body.errorEn || "Request failed";
    error.body = body;
    throw error;
  }
  return body;
}

export function yuan(cents) {
  return (Number(cents) / 100).toFixed(2);
}

export function h(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null) continue;
    if (key === "text") node.textContent = value;
    else if (key === "className") node.className = value;
    else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2).toLowerCase(), value);
    else node.setAttribute(key, value);
  }
  for (const child of children) node.append(child);
  return node;
}

export function line(zh, en) {
  const children = [h("span", { text: zh == null ? "" : String(zh) })];
  if (en) children.push(h("span", { className: "en", text: String(en) }));
  return h("span", { className: "bi" }, children);
}

export function showError(error) {
  const node = document.querySelector("#error");
  if (!node) return;
  const zh = error.message || String(error);
  const en = error.errorEn || (zh === "请求失败" ? "Request failed" : "");
  node.replaceChildren(line(zh, en));
}
