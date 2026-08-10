export const MODEL_USAGE = [
  { model: "Qwen", percent: 48, tokens: "9.0M" },
  { model: "DeepSeek", percent: 32, tokens: "6.0M" },
  { model: "Llama", percent: 20, tokens: "3.7M" },
] as const;

export const RECENT_REQUESTS = [
  { id: "req_8F21", model: "Qwen", tokens: "18.4K", cost: "$0.011", status: "Complete" },
  { id: "req_8F20", model: "DeepSeek", tokens: "42.1K", cost: "$0.037", status: "Complete" },
  { id: "req_8F19", model: "Llama", tokens: "9.8K", cost: "$0.005", status: "Complete" },
] as const;
