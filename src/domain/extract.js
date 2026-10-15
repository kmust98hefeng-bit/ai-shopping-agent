import { ATTR } from "./template.js";

const PATTERNS = [
  {
    attributeId: ATTR.continuous,
    condition: "持续输出",
    unit: "W",
    pattern: /^持续输出功率\s*[:：]\s*(\d+(?:\.\d+)?)\s*W?$/i,
  },
  {
    attributeId: ATTR.peak,
    condition: "峰值",
    unit: "W",
    pattern: /^峰值输出功率\s*[:：]\s*(\d+(?:\.\d+)?)\s*W?$/i,
  },
  {
    attributeId: ATTR.pd31,
    condition: "PD 3.1",
    unit: null,
    pattern: /^PD\s*3\.1\s*[:：]\s*(支持|不兼容)$/i,
  },
  {
    attributeId: ATTR.cable,
    condition: "包装清单",
    unit: null,
    pattern: /^是否含电源线\s*[:：]\s*(含电源线|不含电源线)$/,
  },
  {
    attributeId: ATTR.input,
    condition: "输入",
    unit: null,
    pattern: /^输入电压\s*[:：]\s*(.+)$/i,
  },
  {
    attributeId: ATTR.model,
    condition: "型号",
    unit: null,
    pattern: /^型号\s*[:：]\s*(.+)$/i,
  },
  {
    attributeId: ATTR.gtin,
    condition: "GTIN",
    unit: null,
    pattern: /^GTIN\s*[:：]\s*(\d{8,14})$/i,
  },
  {
    attributeId: ATTR.cert,
    condition: "认证",
    unit: null,
    pattern: /^安全认证\s*[:：]\s*(.+)$/i,
    certification: true,
  },
];

export function extractSpec(text) {
  const lines = String(text ?? "").replace(/\r\n/g, "\n").split("\n");
  const candidates = [];
  const notes = [];
  for (let index = 0; index < lines.length; index += 1) {
    const excerpt = lines[index].trim();
    if (!excerpt) continue;
    const matched = PATTERNS.find((item) => item.pattern.test(excerpt));
    if (!matched) {
      notes.push(excerpt);
      continue;
    }
    const found = excerpt.match(matched.pattern);
    const parsed = matched.certification ? parseCertification(found[1]) : { value: found[1].trim() };
    candidates.push({
      attributeId: matched.attributeId,
      value: parsed.value,
      unit: matched.unit,
      condition: matched.condition,
      lineNo: index + 1,
      excerpt,
      certBody: parsed.body || null,
      certId: parsed.id || null,
      certUrl: parsed.url || null,
    });
  }
  return { candidates, notes };
}

function parseCertification(raw) {
  const parts = String(raw).split("|").map((part) => part.trim()).filter(Boolean);
  const [value, body, id, url] = parts;
  return { value, body: body || null, id: id || null, url: url || null };
}
