export const DATA_PLAN_CATEGORY_TYPES = ["network", "plan_type"] as const;
export type DataPlanCategoryType = (typeof DATA_PLAN_CATEGORY_TYPES)[number];

export const DEFAULT_DATA_PLAN_NETWORKS = [
  { key: "mtn", label: "MTN" },
  { key: "airtel", label: "Airtel" },
  { key: "glo", label: "Glo" },
  { key: "9mobile", label: "9mobile" },
] as const;

export const DEFAULT_DATA_PLAN_TYPES = [
  "STANDARD",
  "SME",
  "SME2",
  "GIFTING",
  "CORPORATE GIFTING",
  "AWOOF DATA",
] as const;

export function normalizeDataPlanNetwork(raw: string | undefined | null) {
  const value = raw?.trim().toLowerCase() ?? "";
  if (value.includes("mtn")) return "mtn";
  if (value.includes("airtel")) return "airtel";
  if (value.includes("glo")) return "glo";
  if (value.includes("9mobile") || value.includes("etisalat")) return "9mobile";
  return value.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

/** Keep category switch keys aligned with the plan-type normalization used by pricing rules. */
export function normalizeDataPlanType(raw: string | undefined | null): string {
  if (!raw?.trim()) return "STANDARD";
  const value = raw
    .trim()
    .toUpperCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");

  if (/\bSME\s*2\b|\bSME2\b/.test(value)) return "SME2";
  if (/\bSME\b/.test(value) && !/CORPORATE/.test(value)) return "SME";
  if (/CORPORATE\s*GIFT|CORP\s*GIFT|CORPORATE/.test(value))
    return "CORPORATE GIFTING";
  if (/\bAWOOF\b/.test(value)) return "AWOOF DATA";
  if (/\bGIFTING\b|\bGIFT\b/.test(value)) return "GIFTING";
  if (/\bCG\b/.test(value)) return "CORPORATE GIFTING";
  if (/\bSTANDARD\b|\bREGULAR\b|\bDIRECT\b/.test(value)) return "STANDARD";

  if (/\d+\s*(GB|MB)/i.test(value) || /\d+\s*DAY/i.test(value))
    return "STANDARD";
  if (value.length <= 24 && !/\d/.test(value)) return value;
  return "STANDARD";
}

export function getDataPlanCategoryKey(
  type: DataPlanCategoryType,
  raw: string | undefined | null,
) {
  return type === "network"
    ? normalizeDataPlanNetwork(raw)
    : normalizeDataPlanType(raw);
}

export function getDataPlanCategoryLabel(
  type: DataPlanCategoryType,
  key: string,
) {
  if (type === "network") {
    const known = DEFAULT_DATA_PLAN_NETWORKS.find(
      (network) => network.key === key,
    );
    if (known) return known.label;
    return key
      .replace(/_/g, " ")
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }
  return key;
}

export function isDataPlanCategoryDisabled(
  disabled: Array<{ categoryType: DataPlanCategoryType; categoryKey: string }>,
  type: DataPlanCategoryType,
  value: string | undefined | null,
) {
  const key = getDataPlanCategoryKey(type, value);
  return (
    Boolean(key) &&
    disabled.some(
      (item) => item.categoryType === type && item.categoryKey === key,
    )
  );
}
