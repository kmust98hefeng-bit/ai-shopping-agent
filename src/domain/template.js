import { SORT_RULE_EN } from "./i18n.js";

export const CATEGORY = {
  id: "usb-c-adapter",
  name: "USB-C 电源适配器",
  nameEn: "USB-C power adapter",
};

export const ATTR = {
  continuous: "continuous_power_w",
  peak: "peak_power_w",
  pd31: "pd31",
  cable: "includes_cable",
  input: "input_voltage",
  model: "model_code",
  gtin: "gtin",
  cert: "safety_cert",
};

export const AVAILABILITY = ["in_stock", "out_of_stock", "preorder", "backorder"];

export const SORT_RULE =
  "先排除不满足硬性约束、已下架和标价超过 30 天未更新的商品，再按必填完整度从高到低、价格从低到高、库存从高到低排列。完整度只统计条件匹配的已确认必填字段。未知计入未完成。营销文案不提高完整度。平台不承诺具体名次。";

export { SORT_RULE_EN };

export const DEFAULT_ATTRIBUTES = [
  {
    id: ATTR.continuous,
    name: "持续输出功率",
    nameEn: "Continuous output power",
    dataType: "number",
    unit: "W",
    required: true,
    kind: "measurement",
    condition: "持续输出",
    conditionEn: "Continuous output",
    example: "65",
    enumValues: null,
    sortOrder: 1,
  },
  {
    id: ATTR.peak,
    name: "峰值输出功率",
    nameEn: "Peak output power",
    dataType: "number",
    unit: "W",
    required: false,
    kind: "measurement",
    condition: "峰值",
    conditionEn: "Peak",
    example: "100",
    enumValues: null,
    sortOrder: 2,
  },
  {
    id: ATTR.pd31,
    name: "PD 3.1 兼容",
    nameEn: "PD 3.1 compatibility",
    dataType: "enum",
    unit: null,
    required: true,
    kind: "negation",
    condition: "PD 3.1",
    conditionEn: "PD 3.1",
    example: "支持",
    enumValues: ["支持", "不兼容"],
    sortOrder: 3,
  },
  {
    id: ATTR.cable,
    name: "是否含电源线",
    nameEn: "Power cable included",
    dataType: "enum",
    unit: null,
    required: true,
    kind: "negation",
    condition: "包装清单",
    conditionEn: "Packaging list",
    example: "不含电源线",
    enumValues: ["含电源线", "不含电源线"],
    sortOrder: 4,
  },
  {
    id: ATTR.input,
    name: "输入电压",
    nameEn: "Input voltage",
    dataType: "text",
    unit: null,
    required: false,
    kind: "constraint",
    condition: "输入",
    conditionEn: "Input",
    example: "100-240V",
    enumValues: null,
    sortOrder: 5,
  },
  {
    id: ATTR.model,
    name: "型号",
    nameEn: "Model code",
    dataType: "text",
    unit: null,
    required: true,
    kind: "identity",
    condition: "型号",
    conditionEn: "Model",
    example: "GAN-65",
    enumValues: null,
    sortOrder: 6,
  },
  {
    id: ATTR.gtin,
    name: "GTIN",
    nameEn: "GTIN",
    dataType: "text",
    unit: null,
    required: false,
    kind: "identity",
    condition: "GTIN",
    conditionEn: "GTIN",
    example: "6901234567890",
    enumValues: null,
    sortOrder: 7,
  },
  {
    id: ATTR.cert,
    name: "安全认证",
    nameEn: "Safety certification",
    dataType: "certification",
    unit: null,
    required: false,
    kind: "certification",
    condition: "认证",
    conditionEn: "Certification",
    example: "CE",
    enumValues: null,
    sortOrder: 8,
  },
];

export function findAttribute(attributes, id) {
  return attributes.find((attribute) => attribute.id === id) || null;
}

export function sameValue(attribute, left, right) {
  if (attribute?.dataType === "number") return Number(left) === Number(right);
  return String(left).trim() === String(right).trim();
}

export function assertAttributeValue(attribute, value) {
  if (value == null || String(value).trim() === "") {
    throw failValue("取值不能为空");
  }
  const text = String(value).trim();
  if (attribute.dataType === "number" && !Number.isFinite(Number(text))) {
    throw failValue("需要数字");
  }
  if (attribute.enumValues && !attribute.enumValues.includes(text)) {
    throw failValue("取值不在允许范围内");
  }
  return text;
}

function failValue(message) {
  const err = new Error(message);
  err.status = 400;
  err.extra = {};
  return err;
}
