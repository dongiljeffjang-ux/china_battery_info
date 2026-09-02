// 기업 시계열 매트릭스의 행 정의. 화면(app/app.js)의 레이어 라벨과 같은 키를 쓴다.

export const MARKET_LAYERS = [
  { key: "supply-performance", label_ko: "수급·실적" },
  { key: "investment-production", label_ko: "투자·생산기반" },
  { key: "customer-commercialization", label_ko: "고객·상업화" },
  { key: "regional-overseas", label_ko: "지역·해외전략" },
];

export const TECHNOLOGY_LAYERS = [
  { key: "technology-material-chemistry", label_ko: "소재·화학계" },
  { key: "technology-process-performance", label_ko: "공정·성능" },
  { key: "technology-ip-standard", label_ko: "IP·표준" },
  { key: "technology-development", label_ko: "개발·인증·양산" },
];

export const MARKET_LAYER_KEYS = MARKET_LAYERS.map((layer) => layer.key);
export const TECHNOLOGY_LAYER_KEYS = TECHNOLOGY_LAYERS.map((layer) => layer.key);
export const LAYER_KEYS = [...MARKET_LAYER_KEYS, ...TECHNOLOGY_LAYER_KEYS];

export const LAYER_PROMPT_GUIDE = [
  "layer_key는 다음 8개 값 중 하나만 쓴다.",
  `시장(trajectory_track=market): ${MARKET_LAYERS.map((layer) => `${layer.key}(${layer.label_ko})`).join(", ")}.`,
  `기술(trajectory_track=technology): ${TECHNOLOGY_LAYERS.map((layer) => `${layer.key}(${layer.label_ko})`).join(", ")}.`,
  "trajectory_track=both이면 기사에서 더 핵심적인 사실 한 개의 레이어를 고른다.",
].join(" ");

// 모델이 규격 밖 값을 주면 매트릭스 행이 어긋나므로 저장 전에 걸러낸다.
export function normalizeLayerKey(value) {
  const key = String(value || "").trim();
  return LAYER_KEYS.includes(key) ? key : null;
}
