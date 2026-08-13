export type ModelCategory =
  | "all"
  | "coding"
  | "reasoning"
  | "general"
  | "multilingual";

export type ModelFeatures = {
  tools: boolean;
  structuredOutput: boolean;
  reasoning: boolean;
  streaming: boolean;
};

export type ModelDefinition = {
  id: "qwen" | "deepseek" | "llama" | "mistral" | "glm" | "minimax";
  name: string;
  modelId: string;
  categories: Exclude<ModelCategory, "all">[];
  context: string;
  speed: "Fast" | "Balanced" | "Deep";
  inputPerMillion: number;
  outputPerMillion: number;
  available: boolean;
  tagline: { en: string; zh: string };
  maxOutput: `${number}K`;
  features: ModelFeatures;
  provenance: {
    status: "review-required";
    label: Record<"en" | "zh", string>;
    licenseHref: string | null;
  };
  servingRole: Record<"en" | "zh", string>;
  region: null;
};

export const MODEL_CATALOG: ModelDefinition[] = [
  { id: "qwen", name: "Qwen", modelId: "pc/qwen-coder", categories: ["coding", "multilingual"], context: "128K", speed: "Fast", inputPerMillion: 0.18, outputPerMillion: 0.72, available: false, tagline: { en: "Advanced coding and multilingual intelligence.", zh: "進階程式開發與多語言智慧。" }, maxOutput: "32K", features: { tools: false, structuredOutput: false, reasoning: false, streaming: false }, provenance: { status: "review-required", label: { en: "Review required", zh: "需要審查" }, licenseHref: null }, servingRole: { en: "Illustrative catalog entry for coding and multilingual evaluation.", zh: "供程式開發與多語言評估使用的示意目錄項目。" }, region: null },
  { id: "deepseek", name: "DeepSeek", modelId: "pc/deepseek-reasoning", categories: ["reasoning", "coding"], context: "128K", speed: "Deep", inputPerMillion: 0.27, outputPerMillion: 1.10, available: false, tagline: { en: "Complex reasoning and agentic workflows.", zh: "複雜推理與代理式工作流程。" }, maxOutput: "32K", features: { tools: false, structuredOutput: false, reasoning: false, streaming: false }, provenance: { status: "review-required", label: { en: "Review required", zh: "需要審查" }, licenseHref: null }, servingRole: { en: "Illustrative catalog entry for reasoning and coding evaluation.", zh: "供推理與程式開發評估使用的示意目錄項目。" }, region: null },
  { id: "llama", name: "Llama", modelId: "pc/llama-general", categories: ["general", "multilingual"], context: "128K", speed: "Balanced", inputPerMillion: 0.16, outputPerMillion: 0.64, available: false, tagline: { en: "Versatile general intelligence for products.", zh: "適用於各類產品的通用智慧。" }, maxOutput: "32K", features: { tools: false, structuredOutput: false, reasoning: false, streaming: false }, provenance: { status: "review-required", label: { en: "Review required", zh: "需要審查" }, licenseHref: null }, servingRole: { en: "Illustrative catalog entry for general and multilingual evaluation.", zh: "供通用與多語言評估使用的示意目錄項目。" }, region: null },
  { id: "mistral", name: "Mistral", modelId: "pc/mistral-tools", categories: ["general", "coding"], context: "128K", speed: "Fast", inputPerMillion: 0.20, outputPerMillion: 0.80, available: false, tagline: { en: "Efficient tool-enabled production workloads.", zh: "高效率、支援工具的正式工作負載。" }, maxOutput: "32K", features: { tools: false, structuredOutput: false, reasoning: false, streaming: false }, provenance: { status: "review-required", label: { en: "Review required", zh: "需要審查" }, licenseHref: null }, servingRole: { en: "Illustrative catalog entry for general and coding evaluation.", zh: "供通用與程式開發評估使用的示意目錄項目。" }, region: null },
  { id: "glm", name: "GLM", modelId: "pc/glm-long-context", categories: ["reasoning", "multilingual"], context: "128K", speed: "Balanced", inputPerMillion: 0.22, outputPerMillion: 0.88, available: false, tagline: { en: "Long-context multilingual reasoning.", zh: "長上下文多語言推理。" }, maxOutput: "32K", features: { tools: false, structuredOutput: false, reasoning: false, streaming: false }, provenance: { status: "review-required", label: { en: "Review required", zh: "需要審查" }, licenseHref: null }, servingRole: { en: "Illustrative catalog entry for reasoning and multilingual evaluation.", zh: "供推理與多語言評估使用的示意目錄項目。" }, region: null },
  { id: "minimax", name: "MiniMax", modelId: "pc/minimax-agents", categories: ["reasoning", "general"], context: "128K", speed: "Balanced", inputPerMillion: 0.24, outputPerMillion: 0.96, available: false, tagline: { en: "Agent-ready intelligence for complex products.", zh: "適合複雜產品的代理式智慧。" }, maxOutput: "32K", features: { tools: false, structuredOutput: false, reasoning: false, streaming: false }, provenance: { status: "review-required", label: { en: "Review required", zh: "需要審查" }, licenseHref: null }, servingRole: { en: "Illustrative catalog entry for reasoning and general evaluation.", zh: "供推理與通用評估使用的示意目錄項目。" }, region: null },
];

export function filterModels(
  models: ModelDefinition[],
  query: string,
  category: ModelCategory,
): ModelDefinition[] {
  const normalized = query.trim().toLowerCase();
  return models.filter((model) => {
    const categoryMatches = category === "all" || model.categories.includes(category);
    const queryMatches = !normalized || `${model.name} ${model.modelId}`.toLowerCase().includes(normalized);
    return categoryMatches && queryMatches;
  });
}
