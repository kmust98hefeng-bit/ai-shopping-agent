export const SORT_RULE_EN =
  "Drop products that fail a hard constraint, are off sale, or have a price that has not been updated for more than 30 days. Then sort by required-field completeness descending, price ascending, and stock descending. Completeness counts only confirmed required fields whose condition matches. Unknown counts as incomplete. Marketing copy does not raise completeness. The platform does not promise a specific rank.";

export const ATTRIBUTE_EN = {
  continuous_power_w: { nameEn: "Continuous output power", conditionEn: "Continuous output" },
  peak_power_w: { nameEn: "Peak output power", conditionEn: "Peak" },
  pd31: { nameEn: "PD 3.1 compatibility", conditionEn: "PD 3.1" },
  includes_cable: { nameEn: "Power cable included", conditionEn: "Packaging list" },
  input_voltage: { nameEn: "Input voltage", conditionEn: "Input" },
  model_code: { nameEn: "Model code", conditionEn: "Model" },
  gtin: { nameEn: "GTIN", conditionEn: "GTIN" },
  safety_cert: { nameEn: "Safety certification", conditionEn: "Certification" },
};

export const PRODUCT_EN = {
  "prod-65w": "65W GaN adapter",
  "prod-peak": "100W peak-rated adapter",
  "prod-nopd": "Adapter that does not support PD 3.1",
  "prod-partial": "65W adapter, cable unknown",
  "prod-candidate": "GaN adapter awaiting confirmation",
  "prod-conflict": "Adapter with conflicting power",
  "prod-stale": "65W adapter with a stale price",
  "prod-ask": "65W adapter awaiting a compatibility answer",
  "prod-preorder": "65W adapter on preorder",
};

export const SELLER_EN = {
  "seller-a": "Steady Voltage Studio",
  "seller-b": "Peak Electronics",
};

export const GLOSS = {
  支持: "Supported",
  不兼容: "Not compatible",
  含电源线: "Cable included",
  不含电源线: "Cable not included",
  未知: "Unknown",
  冲突: "Conflict",
  缺失: "Missing",
  "冲突，不可采信": "Conflict, not reliable",
  规格: "Spec",
  确认参数: "Seller-confirmed parameter",
  晋升事实: "Promoted fact",
  未确认问答: "Unconfirmed answer",
  候选: "Candidate",
  持续输出: "Continuous output",
  峰值: "Peak",
  包装清单: "Packaging list",
  输入: "Input",
  型号: "Model",
  GTIN: "GTIN",
  补充: "Additional",
  外观: "Appearance",
  认证: "Certification",
  待冲正: "Pending reversal",
  pending: "Pending",
};

export const ERROR_EN = {
  属性标识无效: "Invalid attribute id",
  属性已存在: "Attribute already exists",
  "属性缺少名称、类型或种类": "Attribute is missing a name, type, or kind",
  属性不存在: "Attribute not found",
  卖家不存在: "Seller not found",
  缺少商品标题: "Product title is required",
  缺少英文标题: "English title is required",
  价格无效: "Invalid price",
  库存无效: "Invalid stock",
  商品不存在: "Product not found",
  商品状态无效: "Invalid product status",
  属性不在类目模板中: "Attribute is not in the category template",
  事实不存在: "Fact not found",
  只有候选事实可以确认: "Only a candidate fact can be confirmed",
  只能修改已确认事实: "Only a confirmed fact can be revised",
  请选择一条冲突事实: "Choose one conflicting fact",
  冲突事实与商品属性不匹配: "The conflicting fact does not match the product attribute",
  至少选择两个商品: "Choose at least two products",
  提问缺少字段: "The question is missing fields",
  问题不在待处理中: "The question is not open",
  缺少回答: "Answer is required",
  缺少买家或代理标识: "Buyer id or agent id is required",
  商品不满足当前约束: "The product does not meet the current constraints",
  商品标价已过期: "The product price is stale",
  归因记录混入了买家隐私: "The attribution record contains buyer private data",
  归因不存在: "Attribution not found",
  缺少订单号: "Order number is required",
  订单金额无效: "Invalid order amount",
  订单状态无效: "Invalid order status",
  缺少卖家: "Seller is required",
  服务器错误: "Server error",
  没有这个接口: "No such endpoint",
  禁止访问: "Access denied",
  没有这个页面: "Page not found",
  请求体过大: "Request body is too large",
  请求体不是JSON: "Request body is not JSON",
  "请求体不是 JSON": "Request body is not JSON",
  最低持续功率无效: "Invalid minimum continuous power",
  价格上限无效: "Invalid price ceiling",
  取值不能为空: "Value is required",
  需要数字: "A number is required",
  取值不在允许范围内: "Value is not allowed",
  缺少幂等键: "Idempotency key is required",
  幂等键与请求内容不一致: "Idempotency key was reused with a different body",
  商品不是现货: "The product is not in stock",
  可售日期无效: "Invalid availability date",
  可售状态无效: "Invalid availability",
  预售或延期交货需要可售日期: "Preorder and backorder require an availability date",
  请求失败: "Request failed",
  缺少归因标识: "Attribution id is required",
};

export function gloss(text) {
  if (text == null || text === "") return null;
  return GLOSS[text] || null;
}

export function englishAttribute(id) {
  return ATTRIBUTE_EN[id] || { nameEn: null, conditionEn: null };
}

export function englishError(message) {
  return ERROR_EN[message] || null;
}
