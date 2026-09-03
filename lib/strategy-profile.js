import { supabaseRest } from "../api/lib/supabase.js";
import { COMPANIES } from "./china-sources.js";
import { LAYER_KEYS } from "./timeline-layers.js";

// 기업 전략 프로파일의 서버 쪽 재료.
//
// 화면은 두 가지 질문에 답한다.
//   1) 이 회사는 어느 레이어에 힘을 쓰는가 — 분기별 이벤트를 8개 레이어로 세고 동종 그룹과 비교한다.
//   2) 한국 소재사 제품 영역과 어디서 겹치는가 — 이벤트 문장을 네 세그먼트로 분류해 센다.
// 둘 다 이벤트 건수 집계다. 전망이나 추천은 만들지 않는다.
//
// 세그먼트 분류는 LLM이 아니라 용어 규칙으로 한다. 규칙이면 어떤 단어 때문에 분류됐는지
// 그대로 보여 줄 수 있고, 매일 같은 결과가 나오며, 비용이 없다. 대신 놓치는 표현이 있을 수
// 있으므로 화면에 "규칙 기반"임을 밝히고 매칭된 용어를 함께 보낸다.

export const SEGMENTS = [
  { key: "ncm", label_ko: "삼원 양극재", terms: ["삼원", "하이니켈", "고니켈", "중니켈", "ncm", "nca", "ncma", "니켈", "코발트", "전구체", "단결정"], fallback_tag: "cathode_ncm" },
  { key: "lfp", label_ko: "LFP 양극재", terms: ["lfp", "lmfp", "인산철", "인산리튬철", "리튬인산철", "인산망간철", "인산염", "磷酸铁锂", "고압밀"], fallback_tag: "cathode_lfp" },
  { key: "anode", label_ko: "인조흑연 음극재", terms: ["음극", "흑연", "실리콘", "규소", "하드카본", "경질탄소", "흑연화", "코크스", "负极"], fallback_tag: "anode" },
  { key: "cell", label_ko: "셀", terms: ["gwh", "전고체", "반고체", "나트륨", "원통", "46계", "4680", "각형", "파우치", "블레이드", "기린", "에너지밀도", "wh/kg", "급속충전", "초급속", "장착량"], fallback_tag: null },
];

// 양극재 회사가 "양극재 10만 톤 증설"처럼 계열을 안 밝히면 회사의 주력 계열로 본다.
const GENERIC_CATHODE = ["양극"];

export function classifySegments(text, company) {
  const lowered = String(text || "").toLowerCase();
  const tags = company?.type_tags || [];
  const result = [];
  for (const segment of SEGMENTS) {
    const hits = segment.terms.filter((term) => lowered.includes(term));
    let basis = hits;
    if (!hits.length && segment.fallback_tag && tags.includes(segment.fallback_tag)) {
      const generic = segment.key === "anode" ? [] : GENERIC_CATHODE.filter((term) => lowered.includes(term));
      if (generic.length) basis = generic.map((term) => `${term}(주력 계열)`);
    }
    if (basis.length) result.push({ key: segment.key, terms: [...new Set(basis)].slice(0, 4) });
  }
  return result;
}

function quarterOf(date) {
  const [y, m] = String(date).split("-").map(Number);
  return `${y} Q${Math.ceil(m / 3)}`;
}

export async function buildStrategyProfile() {
  const rows = await supabaseRest(
    "event?select=id,company_id,occurred_at,occurred_precision,layer_key,title_ko,fact_ko,evidence_kind,source_url,source_name&timeline_eligibility=neq.exclude&order=occurred_at.desc&limit=2000"
  );
  const byId = new Map(COMPANIES.map((company) => [company.id, company]));
  const events = rows.map((row) => {
    const company = byId.get(row.company_id);
    return {
      id: row.id,
      company_id: row.company_id,
      occurred_at: row.occurred_at,
      quarter: quarterOf(row.occurred_at),
      precision: row.occurred_precision || "day",
      // 표준 8개 레이어 밖의 값(기사에서 자유 서술로 들어온 것)은 '기타'로 묶는다.
      layer_key: LAYER_KEYS.includes(row.layer_key) ? row.layer_key : "other",
      title_ko: row.title_ko,
      evidence_kind: row.evidence_kind,
      source_url: row.source_url,
      source_name: row.source_name,
      segments: classifySegments(`${row.title_ko} ${row.fact_ko}`, company),
    };
  });
  return { events, segments: SEGMENTS.map(({ key, label_ko }) => ({ key, label_ko })), generated_at: new Date().toISOString() };
}
