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

export type ModelDefinition = {
  id: string;
  name: string;
  modelId: string;
  categories: Exclude<ModelCategory, "all">[];
  context: string;
  speed: "Fast" | "Balanced" | "Deep";
  inputPerMillion: number;
  outputPerMillion: number;
  available: boolean;
  tagline: { en: string; zh: string };
  maxOutput: string;
  features: ModelFeatures;
  provenance: {
    status: "review-required" | "live";
    label: Record<"en" | "zh", string>;
    licenseHref: string | null;
  };
  servingRole: Record<"en" | "zh", string>;
  region: string | null;
};

export const MODEL_CATALOG: ModelDefinition[] = [
  {
    id: "glm-5.2-fp8",
    name: "GLM 5.2 FP8",
    modelId: "glm-5.2-fp8",
    categories: ["reasoning", "multilingual", "coding"],
    context: "131K",
    speed: "Fast",
    inputPerMillion: 0.93,
    outputPerMillion: 3.00,
    available: true,
    tagline: {
      en: "Frontier bilingual reasoning model with extended thinking.",
      zh: "前沿雙語推理模型，支援延伸思考鏈。",
    },
    maxOutput: "16K",
    features: { tools: true, structuredOutput: true, reasoning: true, streaming: true },
    provenance: {
      status: "live",
      label: { en: "Live", zh: "已上線" },
      licenseHref: null,
    },
    servingRole: {
      en: "Primary LLM for chat, reasoning, and coding workloads.",
      zh: "主力 LLM，用於對話、推理與程式開發。",
    },
    region: "TH",
  },
  {
    id: "qwen3-vl-30b",
    name: "Qwen3-VL 30B",
    modelId: "qwen3-vl-30b",
    categories: ["vision", "multilingual", "general"],
    context: "32K",
    speed: "Fast",
    inputPerMillion: 0.30,
    outputPerMillion: 1.20,
    available: true,
    tagline: {
      en: "Multimodal vision-language model for OCR, charts, and images.",
      zh: "多模態視覺語言模型，支援 OCR、圖表與圖片理解。",
    },
    maxOutput: "4K",
    features: { tools: false, structuredOutput: true, reasoning: false, streaming: true },
    provenance: {
      status: "live",
      label: { en: "Live", zh: "已上線" },
      licenseHref: null,
    },
    servingRole: {
      en: "Vision and OCR inference for document and image understanding.",
      zh: "視覺與 OCR 推理，用於文件與圖片理解。",
    },
    region: "TH",
  },
  {
    id: "flux-schnell",
    name: "Flux Schnell",
    modelId: "flux-schnell",
    categories: ["image"],
    context: "—",
    speed: "Fast",
    inputPerMillion: 0.01,
    outputPerMillion: 0,
    available: true,
    tagline: {
      en: "Ultra-fast text-to-image generation, 4-step diffusion.",
      zh: "超快文生圖，4 步擴散生成。",
    },
    maxOutput: "1 image",
    features: { tools: false, structuredOutput: false, reasoning: false, streaming: false },
    provenance: {
      status: "live",
      label: { en: "Live", zh: "已上線" },
      licenseHref: null,
    },
    servingRole: {
      en: "Text-to-image generation for marketing and creative use.",
      zh: "文生圖生成，用於行銷與創意場景。",
    },
    region: "TH",
  },
  {
    id: "chroma1-hd",
    name: "Chroma1 HD",
    modelId: "chroma1-hd",
    categories: ["image"],
    context: "—",
    speed: "Balanced",
    inputPerMillion: 0.01,
    outputPerMillion: 0,
    available: true,
    tagline: {
      en: "High-definition image generation with fine detail.",
      zh: "高畫質圖像生成，細節豐富。",
    },
    maxOutput: "1 image",
    features: { tools: false, structuredOutput: false, reasoning: false, streaming: false },
    provenance: {
      status: "live",
      label: { en: "Live", zh: "已上線" },
      licenseHref: null,
    },
    servingRole: {
      en: "Premium HD image generation for high-quality output.",
      zh: "高品質 HD 圖像生成。",
    },
    region: "TH",
  },
  {
    id: "whisper-large-v3",
    name: "Whisper Large v3",
    modelId: "whisper-large-v3",
    categories: ["audio"],
    context: "—",
    speed: "Fast",
    inputPerMillion: 0.01,
    outputPerMillion: 0,
    available: true,
    tagline: {
      en: "State-of-the-art speech-to-text transcription.",
      zh: "頂級語音轉文字辨識。",
    },
    maxOutput: "transcript",
    features: { tools: false, structuredOutput: false, reasoning: false, streaming: false },
    provenance: {
      status: "live",
      label: { en: "Live", zh: "已上線" },
      licenseHref: null,
    },
    servingRole: {
      en: "Audio transcription and subtitle generation.",
      zh: "音訊轉錄與字幕生成。",
    },
    region: "TH",
  },
  {
    id: "indextts2",
    name: "IndexTTS2",
    modelId: "indextts2",
    categories: ["audio"],
    context: "2K",
    speed: "Fast",
    inputPerMillion: 0.03,
    outputPerMillion: 0,
    available: true,
    tagline: {
      en: "Voice cloning and text-to-speech with reference audio.",
      zh: "語音克隆與文字轉語音，需參考音檔。",
    },
    maxOutput: "audio",
    features: { tools: false, structuredOutput: false, reasoning: false, streaming: false },
    provenance: {
      status: "live",
      label: { en: "Live", zh: "已上線" },
      licenseHref: null,
    },
    servingRole: {
      en: "Text-to-speech with voice cloning capabilities.",
      zh: "文字轉語音與語音克隆。",
    },
    region: "TH",
  },
  {
    id: "bge-m3",
    name: "BGE-M3",
    modelId: "bge-m3",
    categories: ["embedding", "multilingual"],
    context: "8K",
    speed: "Fast",
    inputPerMillion: 0.02,
    outputPerMillion: 0,
    available: true,
    tagline: {
      en: "Multilingual embedding model for semantic search.",
      zh: "多語言嵌入模型，用於語意搜尋。",
    },
    maxOutput: "vector",
    features: { tools: false, structuredOutput: false, reasoning: false, streaming: false },
    provenance: {
      status: "live",
      label: { en: "Live", zh: "已上線" },
      licenseHref: null,
    },
    servingRole: {
      en: "Embedding generation for RAG and semantic search.",
      zh: "嵌入向量生成，用於 RAG 與語意搜尋。",
    },
    region: "TH",
  },
  {
    id: "bge-reranker-v2-m3",
    name: "BGE Reranker v2-m3",
    modelId: "bge-reranker-v2-m3",
    categories: ["embedding"],
    context: "8K",
    speed: "Fast",
    inputPerMillion: 0.02,
    outputPerMillion: 0,
    available: true,
    tagline: {
      en: "Cross-encoder reranker for precision retrieval.",
      zh: "交叉編碼重排器，用於精確檢索。",
    },
    maxOutput: "scores",
    features: { tools: false, structuredOutput: false, reasoning: false, streaming: false },
    provenance: {
      status: "live",
      label: { en: "Live", zh: "已上線" },
      licenseHref: null,
    },
    servingRole: {
      en: "Document reranking for retrieval-augmented generation.",
      zh: "文件重排，用於檢索增強生成。",
    },
    region: "TH",
  },
];

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
