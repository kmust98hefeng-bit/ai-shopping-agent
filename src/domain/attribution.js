export const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export function evaluateOrder({ handoffCreatedAt, reportedAt, status }) {
  const counted = reportedAt - handoffCreatedAt <= WINDOW_MS;
  if (!counted) return { counted: false, commissionStatus: null, commissionStatusEn: null, platformSale: false };
  if (status === "refunded") {
    return { counted: true, commissionStatus: "待冲正", commissionStatusEn: "Pending reversal", platformSale: false };
  }
  return { counted: true, commissionStatus: "pending", commissionStatusEn: "Pending", platformSale: true };
}
