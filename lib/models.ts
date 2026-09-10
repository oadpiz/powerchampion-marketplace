/**
 * Presentation metadata for the model catalogue.
 *
 * What a model *is* — price, context, availability — comes from the gateway
 * (lib/catalog.ts). What a model *looks like* on this site — which filter
 * chips it answers to, how fast we call it, what the card says in Chinese —
 * lives here, keyed by model id. mergeCatalog() joins the two.
 *
 * A model the gateway serves but this file has never heard of still renders,
 * from a derived default. A model in this file that the gateway does not serve
 * does not render at all — that direction is how stale entries used to leak
 * onto the price list.
 */
import { CATALOG_SNAPSHOT, type CatalogModel } from "./catalog";

export type ModelCategory =
  | "all"
  | "coding"
  | "reasoning"
  | "general"
  | "multilingual"
  | "vision"
  | "image"
  | "audio"
  | "embedding";

export type ModelFeatures = {
  tools: boolean;
  structuredOutput: boolean;
  reasoning: boolean;
  streaming: boolean;
};

/** The unit a price is shown in — not the unit the meter bills in. */
export type BillingUnit = "token" | "image" | "audio-minute";

export type ModelProvenance = {
  status: "review-required" | "live";
  label: Record<"en" | "zh", string>;
  licenseHref: string | null;
};

export type ModelPresentation = {
  /** Display name, overriding whatever the gateway calls the model. */
  name: string;
  categories: Exclude<ModelCategory, "all">[];
  speed: "Fast" | "Balanced" | "Deep";
  tagline: Record<"en" | "zh", string>;
  servingRole: Record<"en" | "zh", string>;
  /** Human-readable output ceiling; omit to derive from max_output_length. */
  maxOutput?: string;
  features: ModelFeatures;
  provenance: ModelProvenance;
  region: string | null;
  /** Rendered on the card when a model needs a caveat before it is used. */
  notice?: Record<"en" | "zh", string>;
};

export type ModelDefinition = {
  id: string;
  name: string;
  modelId: string;
  description: string;
  categories: Exclude<ModelCategory, "all">[];
  context: string;
  speed: "Fast" | "Balanced" | "Deep";
  inputPerMillion: number;
  outputPerMillion: number;
  billingUnit: BillingUnit;
  /** Price in the displayed unit (per image / per audio minute), else null. */
  unitPrice: number | null;
  billingNote: string | null;
  available: boolean;
  uptime: number | null;
  tagline: Record<"en" | "zh", string>;
  maxOutput: string;
  features: ModelFeatures;
  provenance: ModelProvenance;
  servingRole: Record<"en" | "zh", string>;
  region: string | null;
  notice: Record<"en" | "zh", string> | null;
};

const LIVE_PROVENANCE: ModelProvenance = {
  status: "live",
  label: { en: "Live", zh: "已上線" },
  licenseHref: null,
};

export const MODEL_PRESENTATION: Record<string, ModelPresentation> = {
  "glm-5.2-fp8": {
    name: "GLM 5.2 FP8",
    categories: ["reasoning", "multilingual", "coding"],
    speed: "Fast",
    tagline: {
      en: "Frontier bilingual reasoning model with extended thinking.",
      zh: "前沿雙語推理模型，支援延伸思考鏈。",
    },
    servingRole: {
      en: "Primary LLM for chat, reasoning, and coding workloads.",
      zh: "主力 LLM，用於對話、推理與程式開發。",
    },
    features: { tools: true, structuredOutput: true, reasoning: true, streaming: true },
    provenance: LIVE_PROVENANCE,
    region: "TH",
  },
  "glm-5.3-flash-uncensored": {
    name: "GLM 5.3 Flash Uncensored",
    categories: ["general", "reasoning"],
    speed: "Fast",
    tagline: {
      en: "GLM-5.3 Flash community fine-tune with safety refusals removed.",
      zh: "GLM-5.3 Flash 社群微調版本，已移除安全性拒答。",
    },
    servingRole: {
      en: "Research, red-teaming, and creative work where refusals get in the way.",
      zh: "用於研究、紅隊測試與創作場景——拒答會妨礙工作的情境。",
    },
    features: { tools: true, structuredOutput: false, reasoning: true, streaming: true },
    provenance: LIVE_PROVENANCE,
    region: "TH",
    notice: {
      en: "No content filtering; you are responsible for compliant use.",
      zh: "不套用內容過濾；合規使用由你負責。",
    },
  },
  "qwen3-vl-30b": {
    name: "Qwen3-VL 30B",
    categories: ["vision", "multilingual", "general"],
    speed: "Fast",
    tagline: {
      en: "Multimodal vision-language model for OCR, charts, and images.",
      zh: "多模態視覺語言模型，支援 OCR、圖表與圖片理解。",
    },
    servingRole: {
      en: "Vision and OCR inference for document and image understanding.",
      zh: "視覺與 OCR 推理，用於文件與圖片理解。",
    },
    features: { tools: true, structuredOutput: true, reasoning: false, streaming: true },
    provenance: LIVE_PROVENANCE,
    region: "TH",
  },
  "flux-schnell": {
    name: "Flux Schnell",
    categories: ["image"],
    speed: "Fast",
    tagline: {
      en: "Ultra-fast text-to-image generation, 4-step diffusion.",
      zh: "超快文生圖，4 步擴散生成。",
    },
    servingRole: {
      en: "Text-to-image generation for marketing and creative use.",
      zh: "文生圖生成，用於行銷與創意場景。",
    },
    maxOutput: "1 image",
    features: { tools: false, structuredOutput: false, reasoning: false, streaming: false },
    provenance: LIVE_PROVENANCE,
    region: "TH",
  },
  "chroma1-hd": {
    name: "Chroma1 HD",
    categories: ["image"],
    speed: "Balanced",
    tagline: {
      en: "High-definition image generation with fine detail.",
      zh: "高畫質圖像生成，細節豐富。",
    },
    servingRole: {
      en: "Premium HD image generation for high-quality output.",
      zh: "高品質 HD 圖像生成。",
    },
    maxOutput: "1 image",
    features: { tools: false, structuredOutput: false, reasoning: false, streaming: false },
    provenance: LIVE_PROVENANCE,
    region: "TH",
  },
  "whisper-large-v3": {
    name: "Whisper Large v3",
    categories: ["audio"],
    speed: "Fast",
    tagline: {
      en: "State-of-the-art speech-to-text transcription.",
      zh: "頂級語音轉文字辨識。",
    },
    servingRole: {
      en: "Audio transcription and subtitle generation.",
      zh: "音訊轉錄與字幕生成。",
    },
    maxOutput: "transcript",
    features: { tools: false, structuredOutput: false, reasoning: false, streaming: false },
    provenance: LIVE_PROVENANCE,
    region: "TH",
  },
  indextts2: {
    name: "IndexTTS2",
    categories: ["audio"],
    speed: "Fast",
    tagline: {
      en: "Voice cloning and text-to-speech with reference audio.",
      zh: "語音克隆與文字轉語音，需參考音檔。",
    },
    servingRole: {
      en: "Text-to-speech with voice cloning capabilities.",
      zh: "文字轉語音與語音克隆。",
    },
    maxOutput: "audio",
    features: { tools: false, structuredOutput: false, reasoning: false, streaming: false },
    provenance: LIVE_PROVENANCE,
    region: "TH",
  },
  "bge-m3": {
    name: "BGE-M3",
    categories: ["embedding", "multilingual"],
    speed: "Fast",
    tagline: {
      en: "Multilingual embedding model for semantic search.",
      zh: "多語言嵌入模型，用於語意搜尋。",
    },
    servingRole: {
      en: "Embedding generation for RAG and semantic search.",
      zh: "嵌入向量生成，用於 RAG 與語意搜尋。",
    },
    maxOutput: "vector",
    features: { tools: false, structuredOutput: false, reasoning: false, streaming: false },
    provenance: LIVE_PROVENANCE,
    region: "TH",
  },
  "bge-reranker-v2-m3": {
    name: "BGE Reranker v2-m3",
    categories: ["embedding"],
    speed: "Fast",
    tagline: {
      en: "Cross-encoder reranker for precision retrieval.",
      zh: "交叉編碼重排器，用於精確檢索。",
    },
    servingRole: {
      en: "Document reranking for retrieval-augmented generation.",
      zh: "文件重排，用於檢索增強生成。",
    },
    maxOutput: "scores",
    features: { tools: false, structuredOutput: false, reasoning: false, streaming: false },
    provenance: LIVE_PROVENANCE,
    region: "TH",
  },
};

/**
 * Context windows are shown in thousands of tokens. Image and speech models
 * report a resolution or a zero in this field rather than a context window,
 * so anything under 1K is shown as an em dash instead of a misleading number.
 */
export function formatContextLength(length: number | null): string {
  if (!length || length < 1000) return "—";
  return `${Math.round(length / 1000)}K`;
}

export function billingUnitFor(model: CatalogModel): BillingUnit {
  if (model.modalities.output.includes("image")) return "image";
  if (model.modalities.output.includes("audio") || model.modalities.input.includes("audio")) {
    return "audio-minute";
  }
  return "token";
}

/**
 * The gateway meters media as a 1000-token equivalent — per image, or per 20
 * seconds of audio. Turn that into the unit the site quotes.
 */
export function unitPriceFor(model: CatalogModel, unit: BillingUnit): number | null {
  const perThousandTokens = model.pricing.completion_usd / 1000;
  if (unit === "image") return perThousandTokens;
  if (unit === "audio-minute") return perThousandTokens * 3;
  return null;
}

const EMBEDDING_OUTPUTS = new Set(["embedding", "vector", "score", "scores", "rerank"]);

function defaultCategories(model: CatalogModel, unit: BillingUnit): Exclude<ModelCategory, "all">[] {
  if (unit === "image") return ["image"];
  if (unit === "audio-minute") return ["audio"];
  if (model.modalities.output.some((output) => EMBEDDING_OUTPUTS.has(output))) return ["embedding"];
  return ["general"];
}

function defaultMaxOutput(model: CatalogModel): string {
  const length = model.max_output_length;
  if (!length) return "—";
  return length >= 1000 ? `${Math.round(length / 1000)}K` : String(length);
}

/**
 * Join gateway facts with site presentation. Iteration is over the gateway
 * list, so the site can never advertise a model the gateway is not serving.
 */
export function mergeCatalog(
  models: CatalogModel[],
  presentation: Record<string, ModelPresentation> = MODEL_PRESENTATION,
): ModelDefinition[] {
  return models.map((model) => {
    const meta = presentation[model.id];
    const billingUnit = billingUnitFor(model);
    const fallbackCopy = { en: model.description, zh: model.description };
    return {
      id: model.id,
      name: meta?.name ?? model.name,
      modelId: model.id,
      description: model.description,
      categories: meta?.categories ?? defaultCategories(model, billingUnit),
      context: formatContextLength(model.context_length),
      speed: meta?.speed ?? "Balanced",
      inputPerMillion: model.pricing.prompt_usd,
      outputPerMillion: model.pricing.completion_usd,
      billingUnit,
      unitPrice: unitPriceFor(model, billingUnit),
      billingNote: model.billing_note,
      available: model.ready,
      uptime: model.uptime,
      tagline: meta?.tagline ?? fallbackCopy,
      maxOutput: meta?.maxOutput ?? defaultMaxOutput(model),
      features: meta?.features ?? {
        tools: false,
        structuredOutput: false,
        reasoning: false,
        streaming: false,
      },
      provenance: meta?.provenance ?? LIVE_PROVENANCE,
      servingRole: meta?.servingRole ?? fallbackCopy,
      region: meta?.region ?? null,
      notice: meta?.notice ?? null,
    };
  });
}

/**
 * The catalogue rendered when the gateway cannot be reached. Pages that show
 * this must also show the snapshot notice, so a reader is never told a stale
 * availability flag is live.
 */
export const SNAPSHOT_CATALOG: ModelDefinition[] = mergeCatalog(CATALOG_SNAPSHOT);

export function filterModels(
  models: ModelDefinition[],
  query: string,
  category: ModelCategory,
): ModelDefinition[] {
  const normalized = query.trim().toLowerCase();
  return models.filter((model) => {
    const categoryMatches = category === "all" || model.categories.includes(category as Exclude<ModelCategory, "all">);
    const queryMatches = !normalized || `${model.name} ${model.modelId}`.toLowerCase().includes(normalized);
    return categoryMatches && queryMatches;
  });
}
