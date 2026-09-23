import { MODEL_CATALOG } from "./models";

export const PLAYGROUND_MODEL_IDS = ["glm-5.2-fp8", "qwen3-vl-30b"] as const;
export const PLAYGROUND_MODELS = MODEL_CATALOG.filter((model) =>
  PLAYGROUND_MODEL_IDS.some((id) => id === model.modelId),
);
export const PLAYGROUND_LIMITS = { prompt: 12000, system: 4000, maxTokens: 4096 };
export type PlaygroundCodeLanguage = "curl" | "python" | "javascript";

export type PlaygroundResult = {
  content: string;
  reasoning: string | null;
  finishReason: "stop" | "length" | "content_filter" | null;
  usage: { input: number | null; output: number | null; total: number | null } | null;
};

export function isPlaygroundModel(value: unknown): value is (typeof PLAYGROUND_MODEL_IDS)[number] {
  return PLAYGROUND_MODEL_IDS.some((id) => id === value);
}

export function buildPlaygroundCode(
  model: string,
  prompt: string,
  system: string,
  maxTokens: number,
  language: PlaygroundCodeLanguage = "curl",
) {
  const payload = {
    model,
    messages: [
      ...(system.trim() ? [{ role: "system", content: system.trim() }] : []),
      { role: "user", content: prompt.trim() || "Explain how an API works in two sentences." },
    ],
    max_tokens: maxTokens,
    stream: false,
  };
  if (language === "python") {
    const messages = payload.messages.map((message) =>
      `        {"role": ${JSON.stringify(message.role)}, "content": ${JSON.stringify(message.content)}}`,
    ).join(",\n");
    return `import json
import os
import urllib.request

payload = {
    "model": ${JSON.stringify(model)},
    "messages": [
${messages}
    ],
    "max_tokens": ${maxTokens},
    "stream": False,
}

request = urllib.request.Request(
    "https://b300.powerchampion.ai/v1/chat/completions",
    data=json.dumps(payload).encode("utf-8"),
    headers={
        "Authorization": "Bearer " + os.environ["POWERCHAMPION_API_KEY"],
        "Content-Type": "application/json",
    },
    method="POST",
)
with urllib.request.urlopen(request, timeout=120) as response:
    result = json.load(response)
    print(result["choices"][0]["message"]["content"])`;
  }
  const body = JSON.stringify(payload, null, 2);
  if (language === "javascript") {
    return `const apiKey = process.env.POWERCHAMPION_API_KEY;
if (!apiKey) throw new Error("Set POWERCHAMPION_API_KEY before running this example.");

const payload = ${body};

const response = await fetch("https://b300.powerchampion.ai/v1/chat/completions", {
  method: "POST",
  headers: {
    Authorization: "Bearer " + apiKey,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(payload),
});
if (!response.ok) throw new Error("Request failed (HTTP " + response.status + ").");

const result = await response.json();
console.log(result.choices[0].message.content);`;
  }
  const shellBody = body.replace(/'/g, "'\\''");
  return `curl https://b300.powerchampion.ai/v1/chat/completions \\\n  -H "Authorization: Bearer $POWERCHAMPION_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '${shellBody}'`;
}
