import { MODEL_CATALOG } from "./models";

export const PLAYGROUND_MODEL_IDS = ["glm-5.2-fp8", "qwen3-vl-30b"] as const;
export const PLAYGROUND_MODELS = MODEL_CATALOG.filter((model) =>
  PLAYGROUND_MODEL_IDS.some((id) => id === model.modelId),
);
export const PLAYGROUND_LIMITS = { prompt: 12000, system: 4000, maxTokens: 4096 };

export type PlaygroundResult = {
  content: string;
  reasoning: string | null;
  finishReason: "stop" | "length" | "content_filter" | null;
  usage: { input: number | null; output: number | null; total: number | null } | null;
};

export function isPlaygroundModel(value: unknown): value is (typeof PLAYGROUND_MODEL_IDS)[number] {
  return PLAYGROUND_MODEL_IDS.some((id) => id === value);
}

export function buildPlaygroundCode(model: string, prompt: string, system: string, maxTokens: number) {
  const body = JSON.stringify({
    model,
    messages: [
      ...(system.trim() ? [{ role: "system", content: system.trim() }] : []),
      { role: "user", content: prompt.trim() || "Explain how an API works in two sentences." },
    ],
    max_tokens: maxTokens,
    stream: false,
  }, null, 2).replace(/'/g, "'\\''");
  return `curl https://b300.powerchampion.ai/v1/chat/completions \\\n  -H "Authorization: Bearer $POWERCHAMPION_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '${body}'`;
}
