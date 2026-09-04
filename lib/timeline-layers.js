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

// 모델이 억지로 8개 중 하나를 고르지 않도록 "해당 없음"을 명시적 선택지로 준다.
export const UNCLASSIFIED_LAYER = "unclassified";
export const LAYER_ENUM = [...LAYER_KEYS, UNCLASSIFIED_LAYER];

export const LAYER_PROMPT_GUIDE = [
  "layer_key는 다음 8개 값 중 하나만 쓴다.",
  `시장(trajectory_track=market): ${MARKET_LAYERS.map((layer) => `${layer.key}(${layer.label_ko})`).join(", ")}.`,
  `기술(trajectory_track=technology): ${TECHNOLOGY_LAYERS.map((layer) => `${layer.key}(${layer.label_ko})`).join(", ")}.`,
  "시장과 기술 성격을 함께 가진 사실이라도 둘 다로 두지 말고, 더 핵심적인 쪽 하나를 골라 그 레이어를 쓴다.",
  `어느 레이어에도 맞지 않으면 억지로 고르지 말고 ${UNCLASSIFIED_LAYER}를 쓴다.`,
].join(" ");

// 규격 밖 값과 unclassified는 모두 null로 저장한다. 화면은 null을 트랙별 미분류 행에 놓는다.
export function normalizeLayerKey(value) {
  const key = String(value || "").trim();
  return LAYER_KEYS.includes(key) ? key : null;
}
