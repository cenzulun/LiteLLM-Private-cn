import type { ParseKeys } from "i18next";

// Define the available test modes
export const TEST_MODES: readonly { value: string; labelKey: ParseKeys; endpoint: string }[] = [
  { value: "chat", endpoint: "/chat/completions", labelKey: "addModel.addModelModes.chat" },
  { value: "completion", endpoint: "/completions", labelKey: "addModel.addModelModes.completion" },
  { value: "embedding", endpoint: "/embeddings", labelKey: "addModel.addModelModes.embedding" },
  { value: "audio_speech", endpoint: "/audio/speech", labelKey: "addModel.addModelModes.audioSpeech" },
  { value: "audio_transcription", endpoint: "/audio/transcriptions", labelKey: "addModel.addModelModes.audioTranscription" },
  { value: "image_generation", endpoint: "/images/generations", labelKey: "addModel.addModelModes.imageGeneration" },
  { value: "image_edit", endpoint: "/images/edits", labelKey: "addModel.addModelModes.imageEdit" },
  { value: "video_generation", endpoint: "/videos", labelKey: "addModel.addModelModes.videoGeneration" },
  { value: "rerank", endpoint: "/rerank", labelKey: "addModel.addModelModes.rerank" },
  { value: "realtime", endpoint: "/realtime", labelKey: "addModel.addModelModes.realtime" },
  { value: "batch", endpoint: "/batch", labelKey: "addModel.addModelModes.batch" },
  { value: "ocr", endpoint: "/ocr", labelKey: "addModel.addModelModes.ocr" },
  { value: "decisions", endpoint: "/v1/decisions", labelKey: "addModel.addModelModes.decisions" },
  { value: "extraction", endpoint: "/v1/extraction", labelKey: "addModel.addModelModes.extraction" },
];

// Define the available auto router routing strategies
export const AUTO_ROUTER_MODES = [
  { value: "simple-shuffle", label: "随机分配：从可用模型中随机选择" },
  { value: "least-busy", label: "最小负载：选择当前负载较低的模型" },
  { value: "latency-based", label: "时延优先：选择历史响应更快的模型" },
  { value: "cost-based", label: "费用优先：选择费用较低的模型" },
  { value: "usage-based", label: "用量分配：根据用量和限额选择模型" },
  { value: "custom", label: "自定义：使用配置的路由逻辑" },
];
