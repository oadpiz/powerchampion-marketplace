import { MODEL_CATALOG } from "./models";

export const API_BASE_URL = "https://b300.powerchampion.ai/v1";
export type IntegrationLanguage = "python" | "javascript" | "curl";
export type IntegrationKind = "chat" | "vision" | "image" | "transcription" | "speech" | "embedding" | "rerank";

export type IntegrationInputs = {
  prompt: string;
  imageUrl: string;
  audioFile: string;
  documents: string;
};

export const DEFAULT_INTEGRATION_INPUTS: IntegrationInputs = {
  prompt: "Explain how a language model works in three sentences.",
  imageUrl: "https://example.com/image.jpg",
  audioFile: "audio.mp3",
  documents: "A language model learns patterns in text.\nA graphics processor handles parallel computation.\nEmbeddings represent information as vectors.",
};

const MODEL_INTEGRATIONS: Record<string, { kind: IntegrationKind; endpoint: string }> = {
  "glm-5.2-fp8": { kind: "chat", endpoint: "/chat/completions" },
  "qwen3-vl-30b": { kind: "vision", endpoint: "/chat/completions" },
  "flux-schnell": { kind: "image", endpoint: "/images/generations" },
  "chroma1-hd": { kind: "image", endpoint: "/images/generations" },
  "whisper-large-v3": { kind: "transcription", endpoint: "/audio/transcriptions" },
  indextts2: { kind: "speech", endpoint: "/audio/speech" },
  "bge-m3": { kind: "embedding", endpoint: "/embeddings" },
  "bge-reranker-v2-m3": { kind: "rerank", endpoint: "/rerank" },
};

export function getModelIntegration(modelId: string) {
  const model = MODEL_CATALOG.find((item) => item.id === modelId) ?? MODEL_CATALOG[0];
  return { model, ...MODEL_INTEGRATIONS[model.id] };
}

function shellQuote(value: string) {
  return "'" + value.replaceAll("'", "'\\''") + "'";
}

// JSON string literals are also valid Python string literals. Payloads below
// deliberately contain no JSON booleans/null that need a Python conversion.
function pythonValue(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(pythonValue).join(", ")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value).map(([key, item]) => `${JSON.stringify(key)}: ${pythonValue(item)}`).join(", ")}}`;
  }
  return String(value);
}

export function buildIntegrationExample(
  modelId: string,
  language: IntegrationLanguage,
  inputs: IntegrationInputs = DEFAULT_INTEGRATION_INPUTS,
): string {
  const { model, kind, endpoint } = getModelIntegration(modelId);
  const payload: Record<string, unknown> = { model: model.modelId };
  if (kind === "chat") payload.messages = [{ role: "user", content: inputs.prompt }];
  if (kind === "vision") payload.messages = [{ role: "user", content: [
    { type: "text", text: inputs.prompt },
    { type: "image_url", image_url: { url: inputs.imageUrl } },
  ] }];
  if (kind === "image") Object.assign(payload, { prompt: inputs.prompt, n: 1 });
  if (kind === "embedding") payload.input = inputs.prompt;
  if (kind === "speech") Object.assign(payload, { input: inputs.prompt, voice: "YOUR_REGISTERED_VOICE_ID" });
  if (kind === "rerank") Object.assign(payload, {
    query: inputs.prompt,
    documents: inputs.documents.split("\n").map((line) => line.trim()).filter(Boolean),
  });

  if (language === "curl") {
    if (kind === "transcription") return `curl --fail-with-body ${API_BASE_URL}${endpoint} \\\n  -H "Authorization: Bearer $POWERCHAMPION_API_KEY" \\\n  -F ${shellQuote(`model=${model.modelId}`)} \\\n  -F ${shellQuote(`file=@${inputs.audioFile}`)}`;
    const speechNote = kind === "speech" ? "# Replace YOUR_REGISTERED_VOICE_ID with your provisioned voice ID.\n" : "";
    return `${speechNote}curl --fail-with-body ${API_BASE_URL}${endpoint} \\\n  -H "Authorization: Bearer $POWERCHAMPION_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  --data-raw ${shellQuote(JSON.stringify(payload, null, 2))}${kind === "speech" ? " \\\n  --output speech.mp3" : ""}`;
  }

  if (language === "python") {
    if (kind === "rerank") return `import os\nimport httpx\n\nresponse = httpx.post(\n    "${API_BASE_URL}${endpoint}",\n    headers={"Authorization": f"Bearer {os.environ['POWERCHAMPION_API_KEY']}"},\n    json=${pythonValue(payload)},\n    timeout=60.0,\n)\nresponse.raise_for_status()\nprint(response.json()["results"])`;
    const setup = `import os\nfrom openai import OpenAI\n\nclient = OpenAI(\n    base_url="${API_BASE_URL}",\n    api_key=os.environ["POWERCHAMPION_API_KEY"],\n)\n\n`;
    if (kind === "transcription") return `${setup}with open(${JSON.stringify(inputs.audioFile)}, "rb") as audio:\n    response = client.audio.transcriptions.create(\n        model="${model.modelId}",\n        file=audio,\n    )\n\nprint(response.text)`;
    if (kind === "speech") return `${setup}# This must identify a reference voice provisioned for your deployment.\nresponse = client.audio.speech.create(\n    model="${model.modelId}",\n    input=${JSON.stringify(inputs.prompt)},\n    voice=os.environ["POWERCHAMPION_VOICE_ID"],\n)\nresponse.stream_to_file("speech.mp3")`;
    const method = kind === "image" ? "images.generate" : kind === "embedding" ? "embeddings.create" : "chat.completions.create";
    const fields = Object.entries(payload).map(([key, value]) => `    ${key}=${pythonValue(value)},`).join("\n");
    const output = kind === "image" ? "response.data[0]" : kind === "embedding" ? "response.data[0].embedding" : "response.choices[0].message.content";
    return `${setup}response = client.${method}(\n${fields}\n)\nprint(${output})`;
  }

  if (kind === "rerank") return `const apiKey = process.env.POWERCHAMPION_API_KEY;\nif (!apiKey) throw new Error("Set POWERCHAMPION_API_KEY first.");\n\nconst response = await fetch("${API_BASE_URL}${endpoint}", {\n  method: "POST",\n  headers: {\n    Authorization: \`Bearer \${apiKey}\`,\n    "Content-Type": "application/json",\n  },\n  body: JSON.stringify(${JSON.stringify(payload, null, 2)}),\n});\nif (!response.ok) throw new Error(\`Request failed: \${response.status}\`);\nconsole.log((await response.json()).results);`;
  const fsImport = kind === "transcription" || kind === "speech" ? '\nimport fs from "node:fs";' : "";
  const setup = `import OpenAI from "openai";${fsImport}\n\nconst apiKey = process.env.POWERCHAMPION_API_KEY;\nif (!apiKey) throw new Error("Set POWERCHAMPION_API_KEY first.");\n\nconst client = new OpenAI({\n  baseURL: "${API_BASE_URL}",\n  apiKey,\n});\n\n`;
  if (kind === "transcription") return `${setup}const response = await client.audio.transcriptions.create({\n  model: "${model.modelId}",\n  file: fs.createReadStream(${JSON.stringify(inputs.audioFile)}),\n});\nconsole.log(response.text);`;
  if (kind === "speech") return `${setup}// A registered reference voice must be provisioned for your deployment.\nconst voiceId = process.env.POWERCHAMPION_VOICE_ID;\nif (!voiceId) throw new Error("Set POWERCHAMPION_VOICE_ID first.");\n\nconst response = await client.audio.speech.create({\n  model: "${model.modelId}",\n  input: ${JSON.stringify(inputs.prompt)},\n  voice: voiceId,\n});\nfs.writeFileSync("speech.mp3", Buffer.from(await response.arrayBuffer()));`;
  const method = kind === "image" ? "images.generate" : kind === "embedding" ? "embeddings.create" : "chat.completions.create";
  const output = kind === "image" ? "response.data[0]" : kind === "embedding" ? "response.data[0].embedding" : "response.choices[0].message.content";
  return `${setup}const response = await client.${method}(${JSON.stringify(payload, null, 2)});\nconsole.log(${output});`;
}
