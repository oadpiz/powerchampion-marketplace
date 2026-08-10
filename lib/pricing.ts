export type CreditPack = {
  id: "starter" | "builder" | "scale";
  price: number;
  credit: number;
  bonusPercent: number;
};

export type TokenRates = {
  inputPerMillion: number;
  outputPerMillion: number;
};

export const CREDIT_PACKS: CreditPack[] = [
  { id: "starter", price: 10, credit: 10, bonusPercent: 0 },
  { id: "builder", price: 50, credit: 52.5, bonusPercent: 5 },
  { id: "scale", price: 200, credit: 224, bonusPercent: 12 },
];

export function calculateUsageCost(
  inputTokens: number,
  outputTokens: number,
  rates: TokenRates,
): number {
  const values = [inputTokens, outputTokens, rates.inputPerMillion, rates.outputPerMillion];
  if (values.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new RangeError("Token amounts and rates must be finite, non-negative numbers.");
  }
  return (inputTokens / 1_000_000) * rates.inputPerMillion
    + (outputTokens / 1_000_000) * rates.outputPerMillion;
}
