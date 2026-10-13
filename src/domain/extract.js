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
    candidates.push({
      attributeId: matched.attributeId,
      value: found[1].trim(),
      unit: matched.unit,
      condition: matched.condition,
      lineNo: index + 1,
      excerpt,
    });
  }
  return { candidates, notes };
}
