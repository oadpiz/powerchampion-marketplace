import type { ModelDefinition } from "./models";
import { calculateUsageCost } from "./pricing";

export type Workload = {
  input: number;
  output: number;
  images: number;
  minutes: number;
};
export function billingKind(model: ModelDefinition) {
  return model.categories.includes("image")
    ? "image"
    : model.categories.includes("audio")
      ? "audio"
      : "tokens";
}

export function estimateModelCost(model: ModelDefinition, usage: Workload) {
  const kind = billingKind(model);
  const values =
    kind === "image"
      ? [usage.images]
      : kind === "audio"
        ? [usage.minutes]
        : [usage.input, usage.output];
  if (values.some((value) => !Number.isFinite(value) || value < 0)) return null;
  if (kind === "image" && !Number.isSafeInteger(usage.images)) return null;
  if (
    kind === "tokens" &&
    (!Number.isSafeInteger(usage.input) || !Number.isSafeInteger(usage.output))
  )
    return null;
  if (kind === "image") return usage.images * model.inputPerMillion;
  if (kind === "audio") return usage.minutes * model.inputPerMillion;
  return calculateUsageCost(usage.input, usage.output, model);
}
