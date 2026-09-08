// 벡터 지식 검색과 근거 인용 답변.
//
// data-model.md 6절의 질의응답 정책을 따른다.
//   1. 질문에서 기업·기간·주제를 파악한다
//   2. 구조화 Event/Fact를 먼저 검색한다 (knowledge_chunk의 event_fact)
//   3. 내부 근거가 없으면 답을 만들지 않고 무엇을 확인해야 하는지 안내한다
//   4. 각 핵심 주장에 Citation을 연결한다
//   5. 상충된 출처는 하나를 고르지 않고 차이를 설명한다

import { supabaseRest } from "./supabase.js";
import { createJsonResponse } from "./llm-provider.js";
import { traced } from "./tracing.js";
import { COMPANIES, companyAliases } from "./china-sources.js";

// 프롬프트에 넣을 근거 수. ANSWER_SCHEMA의 used_sources 상한과 같아야 한다.
const MATCH_COUNT = 10;
// 검색기 하나가 뽑는 후보 수. 하이브리드는 후보를 줄이는 장치가 아니라 늘리는 장치다.
// 의미 10 + 단어 10을 뽑으면 겹치는 것을 빼고 최대 20건이 후보가 되고, 그중 상위 MATCH_COUNT만
// LLM에 넘긴다. 겹친 청크는 양쪽에서 점수를 받아 위로 올라간다. 몇 건을 프롬프트에 넣을지는
// 후보를 몇 건 뽑을지와 별개로 정하는 값이다.
const RETRIEVER_LIMIT = 10;
// RRF 상수. 순위 차이가 상위에서만 크게 벌어지도록 눌러 주는 값이고 60이 관례다.
const RRF_K = 60;
// 두 검색기의 가중치. 반반에서 시작한다. 한쪽을 올리면 그쪽 1위가 항상 최종 1위가 된다.
const VECTOR_WEIGHT = 0.5;
const LEXICAL_WEIGHT = 0.5;

// 사용자가 익숙한 표현과 실제 산업 자료의 표기가 다른 경우를 검색 전에 함께 넣는다.
// 원 질문은 답변 프롬프트에 그대로 유지하고, 검색기에만 확장문을 보낸다.
const DOMAIN_SYNONYM_GROUPS = [
  ["리튬이온", "리튬 이온", "lithium-ion", "lithium ion", "锂离子", "锂电"],
  ["소금", "소듐", "나트륨", "나트륨이온", "sodium", "sodium-ion", "钠电", "钠离子"],
  ["전고체", "전고체전지", "전고체배터리", "all-solid-state", "solid-state battery", "固态电池", "全固态"],
  ["반고체", "반고체전지", "반고체배터리", "semi-solid", "semi-solid-state", "半固态", "半固态电池"],
  ["LFP", "리튬인산철", "인산철리튬", "lithium iron phosphate", "磷酸铁锂"],
  ["LMFP", "인산망간철리튬", "망간인산철리튬", "lithium manganese iron phosphate", "磷酸锰铁锂"],
  ["NCM", "삼원계", "니켈코발트망간", "nickel cobalt manganese", "三元", "镍钴锰"],
  ["NCA", "니켈코발트알루미늄", "nickel cobalt aluminum", "镍钴铝"],
  ["양극재", "양극활물질", "cathode material", "positive electrode material", "正极材料", "正极"],
  ["음극재", "음극활물질", "anode material", "negative electrode material", "负极材料", "负极"],
  ["전구체", "precursor", "precursor material", "前驱体"],
  ["전해액", "전해질", "electrolyte", "电解液", "电解质"],
  ["분리막", "separator", "battery separator", "隔膜"],
  ["실리콘음극", "실리콘 음극", "실리콘계음극", "silicon anode", "silicon-carbon anode", "硅负极", "硅基负极", "硅碳"],
  ["인조흑연", "인조 흑연", "synthetic graphite", "artificial graphite", "人造石墨"],
  ["천연흑연", "천연 흑연", "natural graphite", "天然石墨"],
  ["탄산리튬", "탄산 리튬", "lithium carbonate", "碳酸锂"],
  ["수산화리튬", "수산화 리튬", "lithium hydroxide", "氢氧化锂"],
  ["ESS", "에너지저장장치", "에너지 저장 장치", "energy storage system", "储能系统", "储能"],
  ["생산능력", "생산 능력", "캐파", "capa", "capacity", "产能"],
  ["출하량", "출하", "shipment", "shipments", "出货量"],
  ["판매량", "판매", "sales volume", "销量"],
  ["급속충전", "급속 충전", "고속충전", "fast charging", "fast charge", "快充"],
  ["초급속충전", "초급속 충전", "ultra-fast charging", "superfast charging", "超充", "超快充"],
  ["재활용", "리사이클링", "recycling", "battery recycling", "回收", "电池回收"],
  ["양산", "대량생산", "mass production", "commercial production", "量产", "规模化生产"],
  ["증설", "생산능력확대", "capacity expansion", "capacity increase", "扩产", "扩建"],
  ["점유율", "시장점유율", "market share", "市占率", "市场份额"],
  ["수주", "주문", "order", "contract award", "订单", "获订单"],
  ["가동률", "설비가동률", "utilization rate", "capacity utilization", "产能利用率", "开工率"],
  ["원가", "비용", "cost", "production cost", "成本", "生产成本"],
  ["영업이익", "영업 이익", "operating profit", "operating income", "营业利润"],
  ["순이익", "당기순이익", "net profit", "net income", "净利润"],
  ["매출", "매출액", "revenue", "sales revenue", "营业收入", "营收"],
  ["해외매출", "해외 매출", "overseas revenue", "international revenue", "境外收入", "海外收入"],
  ["공급망", "서플라이체인", "supply chain", "供应链"],
  ["합작", "합작회사", "조인트벤처", "joint venture", "JV", "合资", "合资公司"],
  ["파트너십", "협력", "partnership", "cooperation", "合作"],
  ["특허", "patent", "patents", "专利"],
  ["인증", "certification", "qualification", "认证"],
];

const COMPANY_SYNONYM_GROUPS = COMPANIES.map((company) => [
  company.id, company.name_ko, String(company.name_ko || "").replace(/\([^)]*\)/g, "").trim(),
  company.name_zh, company.name_en, ...companyAliases(company),
].filter(Boolean));

function containsTerm(text, term) {
  const needle = String(term || "").toLowerCase().trim();
  if (!needle) return false;
  if (/^[a-z0-9][a-z0-9 .&+\-]*$/i.test(needle)) {
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(text);
  }
  return text.includes(needle);
}

export function expandDomainQuestion(question) {
  const original = String(question || "").trim();
  if (!original) return "";
  const lower = original.toLowerCase();
  const additions = [];
  for (const group of [...DOMAIN_SYNONYM_GROUPS, ...COMPANY_SYNONYM_GROUPS]) {
    if (group.some((term) => containsTerm(lower, term))) additions.push(...group);
  }
  return [...new Set([original, ...additions])].join(" ");
}

async function embedQuestion(question) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";
  if (!apiKey) throw new Error("EMBEDDING_NOT_CONFIGURED");
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, input: question, encoding_format: "float" }),
  });
  if (!response.ok) throw new Error(`OPENAI_EMBEDDING_${response.status}`);
  const payload = await response.json();
  const embedding = payload.data?.[0]?.embedding;
  if (!embedding?.length) throw new Error("EMPTY_EMBEDDING");
  return embedding;
}

// 질문에서 뜻을 실어 나르지 않는 말들. 이것들이 OR 후보에 들어가면 거의 모든 청크가 걸려
// 단어 검색이 의미 검색의 열화된 사본이 된다. 넓게 막지는 않는다. 지우는 것보다 남기는 쪽이 안전하다.
const QUESTION_STOPWORDS = new Set([
  "무엇", "어떤", "어디", "언제", "얼마", "누가", "어떻게", "정도", "관련", "대해", "대한", "경우",
  "알려줘", "알려", "해줘", "인가요", "인가", "있나요", "있는지", "무슨", "그리고", "그러면", "지금",
  "최근", "현재", "설명", "정리", "요약", "비교", "차이", "이야기", "부분", "내용", "상황", "때문",
]);

// 조사 후보. 형태소 분석 없이 흔한 것만 뗀다.
const KO_SUFFIX_2 = ["에서", "으로", "에게", "한테", "부터", "까지", "처럼", "보다", "이나", "라도", "에는", "에도", "이란", "라는", "이며", "과의", "와의"];
const KO_SUFFIX_1 = ["은", "는", "이", "가", "을", "를", "의", "에", "도", "만", "과", "와", "로", "나"];

// 질문을 토큰으로 자른다. 한글·한자 덩어리와 영숫자 덩어리를 각각 하나로 본다.
// 영숫자는 하이픈·마침표로 이어진 것까지 한 토큰으로 묶는다. 'SW-2413'을 'SW'와 '2413'으로
// 쪼개 버리면 이 검색을 붙이는 이유 자체가 없어지기 때문이다.
function tokenizeQuestion(question) {
  return String(question || "").match(/[A-Za-z0-9]+(?:[-.][A-Za-z0-9]+)*|[가-힣]+|[㐀-鿿]+/g) || [];
}

// 한 토큰을 PGroonga 질의 후보들로 펼친다. 원형은 항상 남기고 조사를 뗀 변형을 덧붙인다.
// 잘못 뗀 변형(예: '국가' → '국')은 OR에 노이즈를 하나 더할 뿐 원형 매치를 없애지 못한다.
// 재현율을 지키는 쪽으로 틀린다는 뜻이고, 순위 정리는 RRF와 프롬프트 상한이 맡는다.
function expandToken(token) {
  const forms = new Set([token]);
  if (/^[가-힣]+$/.test(token)) {
    for (const suffix of KO_SUFFIX_2) {
      if (token.length >= 4 && token.endsWith(suffix)) forms.add(token.slice(0, -2));
    }
    for (const suffix of KO_SUFFIX_1) {
      if (token.length >= 3 && token.endsWith(suffix)) forms.add(token.slice(0, -1));
    }
  }
  return [...forms];
}

// 사용자 질문을 PGroonga 질의문으로 조립한다. 사용자 원문을 그대로 넘기지 않는다.
// 토크나이저가 영숫자·한글·한자만 남기므로 질의 연산자(괄호, 따옴표, -, +, ~, :)는 애초에 통과하지 못하고,
// 하이픈이 남은 코드 토큰만 따옴표로 감싸 구문으로 넘긴다.
// 뽑을 것이 없으면 빈 문자열을 돌려준다. 호출자는 그때 단어 검색을 건너뛴다.
export function buildLexicalQuery(question) {
  const terms = new Set();
  for (const token of tokenizeQuestion(question)) {
    if (token.length < 2 && !/^[0-9]+$/.test(token)) continue;
    if (QUESTION_STOPWORDS.has(token)) continue;
    for (const form of expandToken(token)) {
      if (form.length < 2) continue;
      terms.add(/[-.]/.test(form) ? `"${form}"` : form);
    }
  }
  return [...terms].slice(0, 40).join(" OR ");
}

// 순위 융합(Reciprocal Rank Fusion). 두 검색기의 점수는 척도가 달라 직접 더할 수 없다.
// 순위만 쓰면 그 문제가 사라지고, 양쪽에 다 걸린 청크는 두 번 점수를 받아 자연히 위로 올라간다.
// lists: [{ rows, weight, label }]. 반환 행에는 각 검색기에서의 순위를 붙여 어디서 왔는지 남긴다.
export function fuseByRrf(lists, { k = RRF_K } = {}) {
  const merged = new Map();
  for (const { rows, weight = 1, label } of lists) {
    (rows || []).forEach((row, index) => {
      if (!row?.id) return;
      const rank = index + 1;
      const entry = merged.get(row.id) || { ...row, rrf_score: 0, retrieved_by: [], ranks: {} };
      // 같은 청크가 양쪽에서 오면 컬럼 값은 동일하다. 점수·출처 표시만 누적한다.
      entry.rrf_score += weight / (k + rank);
      entry.retrieved_by.push(label);
      entry.ranks[label] = rank;
      if (row.similarity != null) entry.similarity = row.similarity;
      if (row.lexical_score != null) entry.lexical_score = row.lexical_score;
      merged.set(row.id, entry);
    });
  }
  return [...merged.values()].sort((a, b) => b.rrf_score - a.rrf_score);
}

async function vectorSearch({ question, companyId, limit, includeUnverified }) {
  const embedding = await embedQuestion(question);
  const rows = await supabaseRest("rpc/match_knowledge_chunks", {
    method: "POST",
    body: {
      query_embedding: embedding,
      match_count: limit,
      filter_company_id: companyId || null,
      include_unverified: includeUnverified,
    },
  });
  return (rows || []).filter((row) => row.content_ko);
}

async function lexicalSearch({ question, companyId, limit, includeUnverified }) {
  const queryText = buildLexicalQuery(question);
  if (!queryText) return [];
  const rows = await supabaseRest("rpc/lexical_knowledge_chunks", {
    method: "POST",
    body: {
      query_text: queryText,
      match_count: limit,
      filter_company_id: companyId || null,
      include_unverified: includeUnverified,
    },
  });
  return (rows || []).filter((row) => row.content_ko);
}

// includeUnverified: 본문 대조를 거치지 않은 헤드라인 청크(source_type='headline')까지 후보에 넣을지.
// 기본은 제외다. 헤드라인은 한 줄짜리라 검증된 본문 청크와 같은 풀에서 경쟁하면 상위 k를 차지해
// 답변이 오히려 얇아진다. 사용자가 넓게 훑고 싶을 때만 화면 토글로 켠다.
//
// 의미 검색(임베딩)과 단어 검색(PGroonga)을 나란히 돌려 RRF로 합친다. 단어 검색은
// supabase/hybrid-search.sql을 적용해야 살아난다. 적용 전에는 RPC가 404를 내는데, 그때
// 질의응답 화면 전체를 죽이지 않고 의미 검색만으로 조용히 물러난다.
export async function searchKnowledge({ question, companyId = null, limit = MATCH_COUNT, includeUnverified = false }) {
  const searchQuestion = expandDomainQuestion(question);
  const args = { question: searchQuestion, companyId, limit: RETRIEVER_LIMIT, includeUnverified };
  const [vectorResult, lexicalResult] = await Promise.allSettled([vectorSearch(args), lexicalSearch(args)]);

  const vectorRows = vectorResult.status === "fulfilled" ? vectorResult.value : [];
  const lexicalRows = lexicalResult.status === "fulfilled" ? lexicalResult.value : [];
  const vectorError = vectorResult.status === "rejected" ? (vectorResult.reason?.message || "VECTOR_SEARCH_FAILED") : null;
  const lexicalError = lexicalResult.status === "rejected" ? (lexicalResult.reason?.message || "LEXICAL_SEARCH_FAILED") : null;
  if (lexicalError) console.warn("[HYBRID_LEXICAL_SKIPPED]", JSON.stringify({ message: lexicalError }));
  if (vectorError) console.warn("[HYBRID_VECTOR_SKIPPED]", JSON.stringify({ message: vectorError }));

  // 한쪽이 죽어도 다른 쪽이 살아 있으면 검색은 성립한다. 특히 의미 검색은 질문마다 OpenAI 임베딩을
  // 부르는 유일한 외부 호출이라 키 만료·장애·쿼터로 끊길 여지가 가장 크다. 단어 검색은 Postgres 안에서
  // 끝나 외부 호출이 없으므로, 임베딩이 끊긴 동안 질의응답을 통째로 죽이지 않고 단어 검색만으로 버틴다.
  // 둘 다 실패했을 때만 올려보낸다. 그때는 정말로 답할 방법이 없다.
  if (vectorError && lexicalError) throw vectorResult.reason;

  const fused = fuseByRrf([
    { rows: vectorRows, weight: VECTOR_WEIGHT, label: "vector" },
    { rows: lexicalRows, weight: LEXICAL_WEIGHT, label: "lexical" },
  ]);
  const top = fused.slice(0, limit);
  // 융합 통계를 결과 배열에 붙여 보낸다. 호출자가 "무엇이 몇 건 걸렸고 몇 건이 겹쳤는지"를
  // 화면과 로그에 남길 수 있어야 하이브리드가 실제로 일하고 있는지 확인할 수 있다.
  top.retrieval = {
    vector_matched: vectorRows.length,
    lexical_matched: lexicalRows.length,
    candidates: fused.length,
    overlapped: fused.filter((row) => row.retrieved_by.length > 1).length,
    lexical_available: lexicalError === null,
    lexical_error: lexicalError,
    vector_available: vectorError === null,
    vector_error: vectorError,
  };
  return top;
}

const ANSWER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["sufficient", "answer_ko", "conflicts_ko", "guidance_ko", "used_sources"],
  properties: {
    // 근거만으로 답할 수 있는지. false면 answer_ko를 비우고 guidance_ko로 안내한다.
    sufficient: { type: "boolean" },
    answer_ko: { type: "string" },
    conflicts_ko: { type: "string" },
    guidance_ko: { type: "string" },
    used_sources: { type: "array", maxItems: 10, items: { type: "integer", minimum: 1, maximum: 10 } },
  },
};

const INSTRUCTIONS = [
  "중국 이차전지 산업 인텔리전스 서비스의 근거 인용 답변자다.",
  "제공된 근거 안에 있는 사실만 쓴다. 근거에 없는 수치·회사·날짜를 만들지 않는다.",
  "전망·인과 추정·투자 판단·목표주가를 만들지 않는다. 출처가 말한 사실과 그 사실들 사이의 비교만 한다.",
  "근거가 질문에 답하기에 충분하지 않으면 sufficient를 false로 두고 answer_ko를 빈 문자열로 남긴다. 억지로 답하지 않는다.",
  "guidance_ko에는 사용자가 다음에 무엇을 확인하면 되는지 구체적으로 쓴다. 어느 회사의 어떤 자료(연차보고서, 반기보고서, 특정 공시 항목)를 봐야 하는지, 또는 어떤 수집·요약 작업을 실행해야 하는지 적는다.",
  "여러 근거가 서로 다른 값을 말하면 하나를 고르지 말고 conflicts_ko에 차이를 설명한다. 상충이 없으면 빈 문자열을 쓴다.",
  "used_sources에는 실제로 사용한 근거의 번호만 넣는다. 사용하지 않은 번호를 넣지 않는다.",
  "근거에 [미검증 헤드라인]이라고 표시된 것은 기사 제목만 옮긴 것이고 본문 대조를 거치지 않았다. 그 안에 없는 내용을 채워 넣지 말고, 그것만으로 답이 될 때는 answer_ko에 '헤드라인 수준의 정보'임을 밝힌다. 검증된 근거와 미검증 헤드라인이 서로 다른 값을 말하면 검증된 쪽을 우선하되 차이를 conflicts_ko에 적는다.",
  "[텍스트 전용 PDF] 근거는 이미지 도표가 누락될 수 있다. 검색 결과가 없다는 이유로 보고서에 해당 사실이 없다고 단정하지 말고 guidance_ko에 이미지 도표 미분석 가능성을 밝힌다.",
  "답변은 한국어 개조식으로 쓰고, 회사명과 수치를 앞에 둔다.",
].join(" ");

export async function answerFromKnowledge({ question, companyId = null, provider = "auto", includeUnverified = false }) {
  const chunks = await traced("retrieve_knowledge", () => searchKnowledge({ question, companyId, includeUnverified }), {
    runType: "retriever",
    inputs: { question, company_id: companyId, include_unverified: includeUnverified },
    metadata: { company_id: companyId || "all", include_unverified: includeUnverified },
  });
  // 검색 통계는 배열에 붙여 오지만, 추적 래퍼를 지나며 사라질 여지가 있다.
  // 그때는 상위 결과의 retrieved_by만으로 다시 세운다. 화면 문구가 통계에 기대고 있어서
  // 없으면 "하이브리드가 돌았는지"를 사용자가 확인할 방법이 사라진다.
  const retrieval = chunks.retrieval || {
    vector_matched: chunks.filter((chunk) => (chunk.retrieved_by || []).includes("vector")).length,
    lexical_matched: chunks.filter((chunk) => (chunk.retrieved_by || []).includes("lexical")).length,
    candidates: chunks.length,
    overlapped: chunks.filter((chunk) => (chunk.retrieved_by || []).length > 1).length,
    lexical_available: null,
    lexical_error: null,
  };
  if (!chunks.length) {
    return {
      sufficient: false,
      answer_ko: "",
      conflicts_ko: "",
      guidance_ko: "벡터 지식에 관련 근거가 없습니다. 해당 기업의 연차보고서 요약을 먼저 실행하거나, 질문의 회사·기간을 좁혀 다시 물어보세요.",
      sources: [],
      matched: 0,
      retrieval,
    };
  }
  const evidence = chunks.map((chunk, index) => [
    `[${index + 1}]${chunk.source_type === "headline" ? " [미검증 헤드라인]" : chunk.source_type === "report_chunk" ? " [텍스트 전용 PDF]" : ""} 회사=${chunk.company_id || "미상"} 시점=${chunk.published_at || "미상"} 출처=${chunk.source_name || "미상"}`,
    chunk.content_ko,
    chunk.original_excerpt ? `원문 발췌: ${chunk.original_excerpt}` : "",
  ].filter(Boolean).join("\n")).join("\n\n---\n\n");

  const { data } = await createJsonResponse({
    name: "knowledge_answer",
    schema: ANSWER_SCHEMA,
    instructions: INSTRUCTIONS,
    input: `질문: ${question}\n\n=== 근거 ===\n${evidence}`,
    provider,
  });

  const used = new Set((data.used_sources || []).filter((index) => index >= 1 && index <= chunks.length));
  const sources = [...used].sort((a, b) => a - b).map((index) => {
    const chunk = chunks[index - 1];
    return {
      n: index,
      company_id: chunk.company_id,
      published_at: chunk.published_at,
      source_name: chunk.source_name,
      source_url: chunk.source_url,
      similarity: Math.round((chunk.similarity || 0) * 1000) / 1000,
      // 이 근거를 어느 검색기가 찾았는지. 양쪽에 다 걸린 것이 진짜 관련성이 높은 것이므로
      // 화면에서 구분할 수 있어야 한다. 의미 검색만으로는 안 나왔을 근거가 무엇인지도 여기서 보인다.
      retrieved_by: chunk.retrieved_by || [],
      // 화면이 검증본과 미검증 헤드라인을 구분해 보여 줄 수 있게 등급을 함께 내려보낸다.
      verified: chunk.source_type !== "headline",
      excerpt: (chunk.original_excerpt || chunk.content_ko || "").slice(0, 220),
    };
  });
  const unverified = chunks.filter((chunk) => chunk.source_type === "headline").length;
  const textOnlyReports = chunks.filter((chunk) => chunk.source_type === "report_chunk").length;
  return { ...data, sources, matched: chunks.length, unverified_matched: unverified,
    retrieval,
    report_text_only_matched: textOnlyReports,
    completeness_warning: textOnlyReports ? "공시 PDF의 이미지 도표는 분석되지 않았으므로 검색 결과가 보고서 전체를 대표하지 않습니다." : null };
}
