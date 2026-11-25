/** Currency accounting is not a product feature in the private gateway. */
export const isFinancialField = (name: string): boolean =>
  /(?:spend|budget|cost|pricing|price|discount|markup|usd|dollar)/i.test(name);

export const isFinancialLabel = (label: unknown): boolean =>
  typeof label === "string" && /美元|费用|花费|支出|预算|定价|单价|折扣|加价|计费|\$/.test(label);
