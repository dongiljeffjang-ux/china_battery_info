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
import { COMPANIES, companySearchTerms } from "./china-sources.js";
import { matchCompanies, matchPeriods, parseMetricQuestion, lookupMetrics } from "./metric-lookup.js";

// 프롬프트에 넣을 근거 수. ANSWER_SCHEMA의 used_sources 상한과 같아야 한다.
const MATCH_COUNT = 10;
// 검색기 하나가 뽑는 후보 수. 하이브리드는 후보를 줄이는 장치가 아니라 늘리는 장치다.
// 의미 10 + 단어 10을 뽑으면 겹치는 것을 빼고 최대 20건이 후보가 되고, 그중 상위 MATCH_COUNT만
// LLM에 넘긴다. 겹친 청크는 양쪽에서 점수를 받아 위로 올라간다. 몇 건을 프롬프트에 넣을지는
// 후보를 몇 건 뽑을지와 별개로 정하는 값이다.
const RETRIEVER_LIMIT = 10;
// 회사를 짚은 질문에서 단어 검색이 훑는 후보 수. 회사 조건은 "본문에 이름이 있으면 통과"라
// 경쟁사 나열로 그 회사를 한 번 언급한 긴 기사도 통과하고, 길이 미보정 점수 때문에 그런 기사가
// 그 회사 소속의 짧은 이벤트 청크를 밀어낸다(2026-09-10 실측: "룽바이 LFP 증설 계획"의 단어 검색
// 상위 10건 중 6건이 CALB·후난위넝·Easpring 기사였고, 다른 회사 청크 22건이 容百를 언급한다).
// 그래서 더 넓게 뽑아 소속 청크를 앞세운 뒤 RETRIEVER_LIMIT로 자른다. SQL 상한(30)과 같다.
const LEXICAL_POOL = 30;
// RRF 상수. 점수는 weight/(k+rank)라 k가 후보 수보다 훨씬 크면 순위가 신호를 못 싣는다.
// 관례값 60은 수천 건 중 상위 1000위를 다루던 벤치마크에서 온 것이고, 여기는 검색기당 10~20건이다.
// k=60이면 1위와 20위의 점수 차가 1.3배뿐이라 "몇 위였나"보다 "몇 검색기에 걸렸나"가 순위를 정했다.
// 2026-09-09 기준선에서 1~3위 정밀도(0.39)가 4~5위(0.50)보다 낮았다 — 순위가 작동하지 않았다는 뜻이다.
// 10이면 1위/20위 차가 2.7배로 벌어진다. 후보 규모(20)에 비례해 잡은 값이다.
const RRF_K = 10;
// 두 검색기의 가중치. 2026-09-09 기준선(판정 42건): 단어 검색만 건진 근거는 정밀도 0.17, 의미 검색만은
// 0.46, 양쪽 다 걸린 것은 0.50. 못 씀 25건 중 15건을 단어 검색이 혼자 만들었다. 단어 검색은 단독으로는
// 해롭고 확인용으로는 유용하므로 없애지 않고 비중만 낮춘다. 0을 주면 양쪽 겹침 보너스가 사라진다.
const VECTOR_WEIGHT = 0.7;
const LEXICAL_WEIGHT = 0.3;

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
  company.name_zh, company.name_en, ...companySearchTerms(company),
].filter(Boolean));

// 밸류체인 라벨은 주제어와 회사 범위를 함께 뜻할 수 있다. "양극재"만으로는
// 소재 주제 검색을 넓히지만, "양극재 회사"·"셀사의"처럼 회사 표현이 붙으면
// 해당 type_tags 회사 집합을 단어 검색의 필수 OR 그룹으로 건다.
const VALUE_CHAIN_LABELS = [
  { tag: "cell", terms: ["셀사", "셀 회사", "배터리 셀 회사", "cell maker"] },
  { tag: "cathode", terms: ["양극재 회사", "양극재 업체", "양극재 기업", "양극재사"] },
  { tag: "anode", terms: ["음극재 회사", "음극재 업체", "음극재 기업", "음극재사"] },
];
const COMPANY_CONTEXT = /회사|업체|기업|제조사|공급사|메이커|사\b/;

function valueChainCompanyIds(tag) {
  return COMPANIES.filter((company) => company.type_tags?.includes(tag)).map((company) => company.id);
}

function valueChainCompanyGroup(question, label) {
  const lower = String(question || "").toLowerCase();
  const direct = label.terms.some((term) => containsTerm(lower, term));
  const labelWord = label.tag === "cell" ? /셀/.test(lower) : label.tag === "cathode" ? /양극재/.test(lower) : /음극재/.test(lower);
  const contextual = labelWord && COMPANY_CONTEXT.test(lower);
  if (!direct && !contextual) return null;
  const ids = new Set(valueChainCompanyIds(label.tag));
  return COMPANY_SYNONYM_GROUPS
    .filter((group, index) => ids.has(COMPANIES[index]?.id))
    .flat()
    .filter(Boolean);
}

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
export function buildLexicalQuery(question, { requiredTerms = [], requiredGroups = [] } = {}) {
  const terms = new Set();
  for (const token of tokenizeQuestion(question)) {
    if (token.length < 2 && !/^[0-9]+$/.test(token)) continue;
    if (QUESTION_STOPWORDS.has(token)) continue;
    for (const form of expandToken(token)) {
      if (form.length < 2) continue;
      terms.add(/[-.]/.test(form) ? `"${form}"` : form);
    }
  }
  const optional = [...terms].slice(0, 40).join(" OR ");
  // 회사별 묶음이 있으면 묶음마다 +그룹 하나. 없으면 requiredTerms 전체를 한 그룹으로.
  const groups = (requiredGroups.length ? requiredGroups : [requiredTerms])
    .map((group) => [...new Set((group || []).map(asPhraseTerm).filter(Boolean))].slice(0, 40))
    .filter((group) => group.length);
  const required = groups.map((group) => `+(${group.join(" OR ")})`).join(" ");
  if (!required) return optional;
  // 회사를 짚은 질문은 그 회사 표기 중 하나를 반드시 포함하게 한다. PGroonga는 공백을 AND로
  // 읽으므로 `+(회사들) (나머지)`는 "회사는 필수, 나머지 그룹도 하나는 필요"가 된다. 그런데
  // expandDomainQuestion이 회사 표기를 나머지 그룹에도 넣어 두기 때문에, 회사 이름만 있고
  // 주제어가 없는 청크도 나머지 그룹을 만족한다. 결과적으로 "회사 필수, 주제어는 점수만"이 된다.
  // 이 순서를 바꾸거나 선택 그룹에서 회사 표기를 빼면 주제어가 사실상 필수가 되어 재현율이 무너진다.
  return optional ? `${required} (${optional})` : required;
}

// 필수 그룹에 넣을 표기 하나를 안전한 형태로 만든다. 공백·하이픈이 있으면 구절로 감싼다 —
// "Wanrun New Energy"를 그대로 두면 New·Energy가 따로 떨어져 아무 회사나 걸린다.
function asPhraseTerm(term) {
  // PGroonga 질의 연산자를 먼저 털어낸다. 지금은 회사 마스터에서만 오는 값이라 사용자 입력이
  // 아니지만, 표기 하나가 잘못 들어오면 질의문 전체가 깨져 단어 검색이 통째로 죽는다.
  const text = String(term || "").replace(/["()~:*+\\]/g, " ").replace(/\s+/g, " ").trim();
  if (text.length < 2) return "";
  // 영숫자·한글·한자만으로 된 표기가 아니면 전부 따옴표로 감싼다. 회사 마스터에는 공백("Wanrun New
  // Energy")·하이픈·전각 괄호("鲁北万润智慧能源科技（山东）有限公司")가 섞여 있고, 이런 글자가 그대로
  // 나가면 PGroonga 질의 문법(괄호·연산자)과 충돌하거나 낱말이 흩어져 아무 회사나 걸린다.
  return /^[A-Za-z0-9가-힣㐀-鿿]+$/.test(text) ? text : `"${text}"`;
}

// 질문이 이름을 댄 회사들의 표기 전부(모회사·별칭·계열사·한국어 표기). 없으면 빈 배열.
// 단어 검색의 필수 조건으로 쓴다. company_id로 DB 필터를 거는 방식은 쓰지 않는다 —
// "CATL에 납품하는 양극재 업체" 같은 질문에서 정답(공급사 청크)이 통째로 잘려나간다.
// 본문에 회사 이름이 있기만 하면 되므로 그런 질문도 살아남는다.
export function questionCompanyTerms(question) {
  const lower = String(question || "").trim().toLowerCase();
  if (!lower) return [];
  const terms = [];
  for (const group of COMPANY_SYNONYM_GROUPS) {
    if (group.some((term) => containsTerm(lower, term))) terms.push(...group);
  }
  return [...new Set(terms)];
}

// 같은 것을 회사별 묶음으로. "reshine과 CATL 협력"처럼 두 회사를 물으면 각 회사를 따로 필수 조건으로
// 걸어야 한다. 하나로 합쳐 OR로 걸면 청크가 많은 회사(CATL 수백 건)가 다른 회사 이야기를 밀어낸다 —
// 2026-09-09 실측: 진촨루이샹·CATL 협력 청크 3건이 있는데도 상위 10건에 없었고, 회사별로 +그룹을
// 나누자 1~3위가 됐다.
export function questionCompanyGroups(question) {
  const lower = String(question || "").trim().toLowerCase();
  if (!lower) return [];
  return COMPANY_SYNONYM_GROUPS
    .filter((group) => group.some((term) => containsTerm(lower, term)))
    .map((group) => [...new Set(group)]);
}

// 질문이 회사를 짚었는데 그 회사 이야기가 아닌 근거를 뒤로 민다. 지우지는 않는다.
//
// 왜 검색 뒤에 또 거르나. 회사 조건은 단어 검색에만 걸 수 있다. 의미 검색은 유사도라는 연속값이라
// "반드시 포함"을 표현할 자리가 없고, 실제로 회사를 자주 틀린다 — 2026-09-09 기준선에서 의미 검색만
// 건진 13건 중 못 씀이 5건이었고 그 5건 중 4건이 다른 회사였다. 임베딩은 "무엇에 대한 글인가"는 잡지만
// "어느 회사인가"는 잘 못 가른다(같은 이유로 2023년과 2025년 매출도 못 가른다). 그래서 두 검색기를
// 합친 뒤에 한 번 더 본다.
//
// company_id(메타데이터)가 아니라 본문 표기를 본다. 한 기사는 회사 하나에만 귀속되는데(실측 평균 1.00),
// 공급사 기사가 상대 회사 쪽으로 붙어 있을 수 있다(진촨루이샹 기사가 catl과 reshine으로 갈려 있다).
// 메타데이터로 거르면 "CATL에 납품하는 양극재 업체" 같은 질문에서 정답이 잘린다. 본문에 이름이 있으면
// 통과시키면 그 질문도 살아남는다. company_id도 함께 보는 것은 표기가 번역마다 흔들려도 붙잡기 위해서다.
//
// 자르지 않고 순서만 바꾸는 이유: 회사 이름이 본문에 없어도 맞는 근거일 수 있다(대명사·계열사 표기).
// 관련 근거가 상한을 못 채우면 뒤로 밀린 것들이 그대로 따라 들어온다.
//
// 층은 회사마다 소속(2) > 언급(1) > 없음(0)이고 여러 회사면 합산한다. "소속"은 청크의 company_id가
// 그 회사(그룹에 든 회사 ID 중 하나)인 것, "언급"은 본문에 표기만 있는 것이다. 언급을 버리지 않는
// 이유는 위와 같다(공급사 기사). 소속을 언급보다 앞에 두는 이유는 2026-09-10 룽바이 사례다 —
// 경쟁사 나열로 容百를 한 번 언급한 CALB·후난위넝 기사가 룽바이 소속 LFP 이벤트와 같은 층에 있었고,
// 융합 순위가 그 기사들 쪽이 높아 정답이 5위·10위·10위 밖으로 밀렸다.
export function companyTier(row, groups) {
  const id = String(row?.company_id || "").toLowerCase();
  const text = `${row?.content_ko || ""} ${row?.original_excerpt || ""} ${id}`.toLowerCase();
  let score = 0;
  for (const group of groups || []) {
    if (id && group.some((term) => String(term || "").toLowerCase() === id)) score += 2;
    else if (group.some((term) => containsTerm(text, term))) score += 1;
  }
  return score;
}

export function demoteUnrelatedCompanies(rows, companyTerms, groups = null) {
  if ((!companyTerms?.length && !groups?.length) || !rows?.length) return rows;
  // 회사별 묶음이 있으면 회사마다 층을 매겨 합산한다. 두 회사를 물었을 때 둘 다 나오는 근거가
  // 하나만 나오는 근거보다 앞이다. 같은 층 안에서는 융합 순위를 그대로 지킨다.
  const tiers = groups?.length ? groups : [companyTerms];
  const scored = rows.map((row, index) => ({ row, index, hits: companyTier(row, tiers) }));
  scored.sort((a, b) => b.hits - a.hits || a.index - b.index);
  return scored.map((entry) => entry.row);
}

// 회사명을 직접 쓰지 않은 밸류체인 질문의 회사 범위를 기존 필수 그룹
// 메커니즘으로 전달한다. 회사명 질문 그룹과 함께 반환해도 각 그룹은 AND가 된다.
export function questionValueChainGroups(question) {
  return VALUE_CHAIN_LABELS.map((label) => valueChainCompanyGroup(question, label)).filter(Boolean);
}

// 질문이 명시한 기간과 맞는 근거를 앞에 둔다. 의미 검색은 회사뿐 아니라 연도도 잘 구분하지 못해
// 같은 회사의 2023~2026년 매출·사건을 함께 올린다. 다만 기사 발행일은 보고 기간과 다를 수 있고
// 일부 기존 청크에는 [시점]이 없으므로, 기간이 확인되지 않는 근거는 보존하고 명백히 다른 시점만 뒤로
// 민다. 삭제가 아니라 순위 조정이라 공급사 기사·날짜 없는 근거를 성급히 잃지 않는다.
export function questionPeriods(question) {
  return matchPeriods(question);
}

function periodBounds(period) {
  const [, year, sub = ""] = String(period).match(/^(20\d{2})(H[12]|Q[1-4])?$/) || [];
  if (!year) return null;
  const ranges = {
    "": [`${year}-01-01`, `${year}-12-31`], H1: [`${year}-01-01`, `${year}-06-30`], H2: [`${year}-07-01`, `${year}-12-31`],
    Q1: [`${year}-01-01`, `${year}-03-31`], Q2: [`${year}-04-01`, `${year}-06-30`], Q3: [`${year}-07-01`, `${year}-09-30`], Q4: [`${year}-10-01`, `${year}-12-31`],
  };
  const [from, to] = ranges[sub];
  return { from, to };
}

function rowDates(row) {
  // [시점]은 event_fact의 실제 발생 시점이고 published_at보다 우선한다. 본문에 날짜가 없을 때만
  // 메타데이터 일자를 쓴다. 연차보고서 공시일은 다음 해일 수 있기 때문이다.
  const content = String(row?.content_ko || "");
  const stamp = content.match(/\[시점\]\s*([^\n]+)/)?.[1] || "";
  const dates = [...stamp.matchAll(/20\d{2}[-.]\d{1,2}[-.]\d{1,2}/g)].map((m) => m[0].replace(/\./g, "-").replace(/-(\d)(?=-|$)/g, "-0$1"));
  const koreanMonths = [...stamp.matchAll(/(20\d{2})년\s*(\d{1,2})월/g)].map((m) => `${m[1]}-${m[2].padStart(2, "0")}-01`);
  const koreanPeriods = [...stamp.matchAll(/(20\d{2})년\s*(상반기|하반기|[1-4]분기)/g)].map((m) => {
    const start = { 상반기: "01-01", 하반기: "07-01", "1분기": "01-01", "2분기": "04-01", "3분기": "07-01", "4분기": "10-01" }[m[2]];
    return `${m[1]}-${start}`;
  });
  // 반기·분기로 이미 읽힌 연도는 연간 시작일을 중복해 넣지 않는다. "2026년 하반기"를
  // 1월 사건으로 오인하면 H1 질문에도 맞는 것처럼 보이기 때문이다.
  const koreanYears = [...stamp.matchAll(/(20\d{2})년/g)]
    .filter((m) => !new RegExp(`${m[1]}년\\s*(상반기|하반기|[1-4]분기)`).test(stamp))
    .map((m) => `${m[1]}-01-01`);
  const known = [...dates, ...koreanMonths, ...koreanPeriods, ...koreanYears];
  if (known.length) return known;
  return /^20\d{2}-\d{2}-\d{2}$/.test(String(row?.published_at || "")) ? [row.published_at] : [];
}

export function demotePeriodMismatches(rows, periods) {
  if (!periods?.length || !rows?.length) return rows;
  const bounds = periods.map(periodBounds).filter(Boolean);
  if (!bounds.length) return rows;
  const scored = rows.map((row, index) => {
    const dates = rowDates(row);
    const matches = dates.some((date) => bounds.some(({ from, to }) => date >= from && date <= to));
    // 시점이 확인되지 않으면 유효성을 알 수 없으므로, 명백한 불일치보다 앞에 남긴다.
    return { row, index, tier: matches ? 2 : dates.length ? 0 : 1 };
  });
  scored.sort((a, b) => b.tier - a.tier || a.index - b.index);
  return scored.map((entry) => entry.row);
}

// 한 기사가 프롬프트를 독점하지 못하게 한다. 같은 (source_type, article_id)에서는 상위 두 청크만
// 앞에 두고 나머지는 뒤로 민다. 버리지는 않는다 — 다른 근거가 상한을 못 채우면 따라 들어온다.
//
// 왜 필요한가(2026-09-09 실측). "전고체 배터리 준비중인 회사들"에 근거 10건 중 6건이 같은 SMM 기사였다.
// 그 기사는 21개 청크로 쪼개져 있고 청크마다 같은 한국어 요약 머리말을 달고 있어, 검색기 둘 다에 전부
// 걸렸다. 답변 모델은 회사 두 곳 이야기만 받고 "근거 부족"이라 답했다. 두 개를 남기는 이유는 긴 기사의
// 요약 청크와 본문 청크가 서로 다른 사실을 담을 수 있어서다.
const CHUNKS_PER_ARTICLE = 2;
export function collapseByArticle(rows, perArticle = CHUNKS_PER_ARTICLE) {
  const seen = new Map();
  const kept = [];
  const overflow = [];
  for (const row of rows || []) {
    const key = row?.article_id ? `${row.source_type || ""}:${row.article_id}` : null;
    if (!key) { kept.push(row); continue; }
    const count = seen.get(key) || 0;
    seen.set(key, count + 1);
    (count < perArticle ? kept : overflow).push(row);
  }
  return [...kept, ...overflow];
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

async function lexicalSearch({ question, companyId, limit, includeUnverified, requiredTerms = [], requiredGroups = [] }) {
  const queryText = buildLexicalQuery(question, { requiredTerms, requiredGroups });
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
// 정량 사전조회(T4). 회사·지표를 짚은 질문은 report_metric·market_financial에서 답을 먼저 꺼낸다.
// 2026-09-09 실측에서 "CATL의 2025년 매출은?"의 정답 청크가 코퍼스에 있는데도 단어 검색(길이 미보정
// 점수)과 의미 검색(연도 미구분) 둘 다에서 10위 밖이었다. 구조화 값이 있는 질문은 검색에 맡기지 않는다.
// 프롬프트 상한(MATCH_COUNT)의 절반까지만 차지하게 해서 서술 근거가 밀려나지 않게 한다.
const METRIC_ROW_LIMIT = Math.floor(MATCH_COUNT / 2);

export async function searchKnowledge({ question, intentQuestion = question, companyId = null, limit = MATCH_COUNT, includeUnverified = false }) {
  const searchQuestion = expandDomainQuestion(question);
  // 화면에서 회사를 한정했으면 DB 필터가 이미 걸리므로 단어 검색에 회사 조건을 또 걸지 않는다.
  // 한정하지 않았을 때만 질문이 짚은 회사를 필수 조건으로 쓴다(2026-09-09 기준선에서 못 씀 25건 중
  // 12건이 "다른 회사"였다).
  const requiredTerms = companyId ? [] : questionCompanyTerms(intentQuestion);
  const requiredGroups = companyId ? [] : [
    ...questionCompanyGroups(intentQuestion),
    ...questionValueChainGroups(intentQuestion),
  ];
  const periods = questionPeriods(question);
  const args = { question: searchQuestion, companyId, limit: RETRIEVER_LIMIT, includeUnverified, requiredTerms, requiredGroups };
  const parsed = parseMetricQuestion(question);
  const intentParsed = parseMetricQuestion(intentQuestion);
  if (parsed && intentParsed) {
    parsed.companies = intentParsed.companies;
    parsed.metrics = intentParsed.metrics;
  }
  // 화면에서 회사를 한정했으면 질문의 다른 회사는 무시한다. 한정 회사가 질문에 없어도 그 회사로 본다.
  if (parsed && companyId) parsed.companies = [companyId];
  // 회사를 짚은 질문은 단어 검색을 넓게 뽑아 그 회사 소속 청크를 앞세운 뒤 검색기 몫(RETRIEVER_LIMIT)으로
  // 자른다. 자르기 전에 앞세워야 융합에서 소속 청크가 단어 검색 순위를 받는다 — 경쟁사 기사가 상위 10을
  // 채우면 정답 청크는 단어 검색에 "없는" 것이 되어 의미 검색 점수만 남는다(겹침 0). 회사 조건이 없으면
  // 예전 그대로 10건이다. 후보를 늘리는 것이지 걸러내는 것이 아니다.
  const companyTiers = requiredGroups.length ? requiredGroups : (requiredTerms.length ? [requiredTerms] : []);
  const lexicalArgs = companyTiers.length ? { ...args, limit: LEXICAL_POOL } : args;
  const [vectorResult, lexicalResult, metricResult] = await Promise.allSettled([
    vectorSearch(args), lexicalSearch(lexicalArgs),
    lookupMetrics(parsed, { supabaseRest, limit: METRIC_ROW_LIMIT }),
  ]);
  const metricRows = metricResult.status === "fulfilled" ? metricResult.value : [];
  if (metricResult.status === "rejected") console.warn("[METRIC_LOOKUP_SKIPPED]", JSON.stringify({ message: metricResult.reason?.message }));

  const vectorRows = vectorResult.status === "fulfilled" ? vectorResult.value : [];
  const lexicalPool = lexicalResult.status === "fulfilled" ? lexicalResult.value : [];
  const lexicalRows = companyTiers.length
    ? lexicalPool.map((row, index) => ({ row, index, tier: companyTier(row, companyTiers) }))
        .sort((a, b) => b.tier - a.tier || a.index - b.index)
        .slice(0, RETRIEVER_LIMIT).map((entry) => entry.row)
    : lexicalPool;
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
  // 정량 행이 앞, 검색 결과가 뒤. 정량 행은 RRF에 넣지 않는다 — 점수 척도가 없고, 질문이 그 칸을
  // 직접 가리킨 것이라 순위를 다툴 이유가 없다.
  const metricChunks = metricRows.map((row) => ({ ...row, retrieved_by: ["metric"], ranks: {}, rrf_score: null }));
  // 회사를 짚은 질문이면 그 회사 이야기가 아닌 근거를 뒤로 민 뒤에 상한을 자른다.
  // 기간을 먼저 정렬하고 회사 정렬을 적용한다. 회사 관련성은 더 강한 조건이며, 같은 회사 관련성
  // 층 안에서만 기간 순서가 유지된다.
  const ordered = collapseByArticle(demoteUnrelatedCompanies(demotePeriodMismatches(fused, periods), requiredTerms, requiredGroups));
  // 회사+지표가 명시된 정량 질문에서는 다른 회사의 비슷한 재무 청크를 근거로 섞지 않는다.
  // 공급관계 같은 서술 질문은 기존처럼 본문 회사 표기를 보지만, 매출·이익 질문은 해당 회사 행만 쓴다.
  const scopedOrdered = parsed ? ordered.filter((row) => parsed.companies.includes(row.company_id)) : ordered;
  const top = [...metricChunks, ...scopedOrdered.slice(0, Math.max(0, limit - metricChunks.length))];
  // 융합 통계를 결과 배열에 붙여 보낸다. 호출자가 "무엇이 몇 건 걸렸고 몇 건이 겹쳤는지"를
  // 화면과 로그에 남길 수 있어야 하이브리드가 실제로 일하고 있는지 확인할 수 있다.
  top.retrieval = {
    vector_matched: vectorRows.length,
    lexical_matched: lexicalRows.length,
    candidates: fused.length,
    overlapped: fused.filter((row) => row.retrieved_by.length > 1).length,
    metric_rows: metricChunks.length,
    metric_lookup: parsed ? { companies: parsed.companies, metrics: parsed.metrics, periods: parsed.periods } : null,
    question_periods: periods,
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

const REWRITE_SCHEMA = {
  type: "object", additionalProperties: false, required: ["queries"],
  properties: { queries: { type: "array", minItems: 1, maxItems: 3, items: { type: "string", minLength: 2, maxLength: 180 } } },
};

export function sanitizeRewrittenQueries(original, queries) {
  const source = String(original || "").trim();
  const allowedCompanies = new Set(matchCompanies(source));
  return [...new Set((queries || []).map((query) => String(query || "").replace(/\s+/g, " ").trim())
    .filter((query) => {
      if (query.length < 2 || query.length > 180 || query === source) return false;
      const mentioned = matchCompanies(query);
      // 회사가 명시된 원 질문이면 재작성도 그중 적어도 하나를 유지하고, 새 회사는 절대 추가하지 않는다.
      return !allowedCompanies.size || (mentioned.length > 0 && mentioned.every((id) => allowedCompanies.has(id)));
    }))].slice(0, 3);
}

async function rewriteQuestionForSearch(question) {
  const { data } = await createJsonResponse({
    name: "knowledge_search_rewrite", schema: REWRITE_SCHEMA, provider: "openai_rag", timeoutMs: 20000,
    instructions: [
      "원 질문에 답하지 말고 중국 이차전지 지식 검색에 쓸 독립 검색 질의를 최대 3개 만든다.",
      "원 질문의 회사·지표·제품·기간 의미를 바꾸거나 새 대상을 추가하지 않는다.",
      "기간 범위는 연도별 질의로 나눌 수 있고, 한국어·영어·중국어 자료 표현을 활용한다.",
      "사실이나 수치를 추측해서 질의에 넣지 않는다.",
    ].join(" "),
    input: `원 질문: ${question}`,
  });
  return sanitizeRewrittenQueries(question, data.queries);
}

function mergeRetryChunks(groups) {
  const unique = new Map();
  for (const group of groups) for (const row of group || []) if (row?.id && !unique.has(row.id)) unique.set(row.id, row);
  const rows = [...unique.values()];
  return [...rows.filter((row) => row.source_type === "metric_row"), ...rows.filter((row) => row.source_type !== "metric_row")].slice(0, MATCH_COUNT);
}

function evidenceText(chunks) {
  return chunks.map((chunk, index) => [
    `[${index + 1}]${chunk.source_type === "headline" ? " [미검증 헤드라인]" : chunk.source_type === "report_chunk" ? " [텍스트 전용 PDF]" : chunk.source_type === "metric_row" ? (chunk.metric_grade === "provider" ? " [정량 · 제공자 집계값 · 발췌 없음]" : " [정량 · 보고서 발췌]") : ""} 회사=${chunk.company_id || "미상"} 시점=${chunk.published_at || "미상"} 출처=${chunk.source_name || "미상"}`,
    chunk.content_ko,
    chunk.original_excerpt ? `원문 발췌: ${chunk.original_excerpt}` : "",
  ].filter(Boolean).join("\n")).join("\n\n---\n\n");
}

const INSTRUCTIONS = [
  "중국 이차전지 산업 인텔리전스 서비스의 근거 인용 답변자다.",
  "제공된 근거 안에 있는 사실만 쓴다. 근거에 없는 수치·회사·날짜를 만들지 않는다.",
  "전망·인과 추정·투자 판단·목표주가를 만들지 않는다. 출처가 말한 사실과 그 사실들 사이의 비교만 한다.",
  "근거가 질문에 답하기에 충분하지 않으면 sufficient를 false로 두고 answer_ko를 빈 문자열로 남긴다. 억지로 답하지 않는다.",
  "답변의 회사·지표·기간 대상은 질문에 명시된 것만 사용한다. 근거에 다른 회사가 있어도 질문 대상을 늘리지 않는다.",
  "guidance_ko는 최대 두 문장이다. 첫 문장은 무엇이 근거에 없는지, 둘째 문장은 그것이 있을 만한 자료 하나(예: 특정 회사의 연차보고서, 반기보고서)를 짚는다. 검색 키워드 목록, 조사 절차, 범위 설정, 라벨링 제안 같은 작업 계획을 쓰지 않는다. 근거에 그 회사나 주제가 아예 없으면 '수집된 근거에 없다'고 한 문장으로 끝낸다.",
  "여러 근거가 서로 다른 값을 말하면 하나를 고르지 말고 conflicts_ko에 차이를 설명한다. 상충이 없으면 빈 문자열을 쓴다.",
  "used_sources에는 실제로 사용한 근거의 번호만 넣는다. 사용하지 않은 번호를 넣지 않는다.",
  "근거의 [시점]이 '연중'·'상반기'·'하반기'면 특정 날짜로 단정하지 않고 그 기간으로 답한다.",
  "근거에 [미검증 헤드라인]이라고 표시된 것은 기사 제목만 옮긴 것이고 본문 대조를 거치지 않았다. 그 안에 없는 내용을 채워 넣지 말고, 그것만으로 답이 될 때는 answer_ko에 '헤드라인 수준의 정보'임을 밝힌다. 검증된 근거와 미검증 헤드라인이 서로 다른 값을 말하면 검증된 쪽을 우선하되 차이를 conflicts_ko에 적는다.",
  "[정량 · 보고서 발췌] 근거는 정기보고서 원문에서 코드가 읽은 값이며 원문 발췌가 붙어 있다. 정량 질문에는 이 근거를 우선한다.",
  "[정량 · 제공자 집계값 · 발췌 없음] 근거는 거래소 손익 데이터 제공자의 집계값이라 원문 발췌가 없다. 이 값을 쓰면 answer_ko에 '거래소 집계값(원문 발췌 없음)'임을 밝힌다. 보고서 발췌 근거와 값이 다르면 conflicts_ko에 적는다.",
  "여러 기간의 값을 물으면 저장된 값을 기간별로 나열한다. 합계·평균·성장률을 새로 계산하지 않는다. 근거에 적힌 증감률만 옮긴다.",
  "[텍스트 전용 PDF] 근거는 이미지 도표가 누락될 수 있다. 검색 결과가 없다는 이유로 보고서에 해당 사실이 없다고 단정하지 말고 guidance_ko에 이미지 도표 미분석 가능성을 밝힌다.",
  "답변은 한국어 개조식으로 쓰고, 회사명과 수치를 앞에 둔다.",
].join(" ");

export async function answerFromKnowledge({ question, companyId = null, includeUnverified = false }) {
  let chunks = await traced("retrieve_knowledge", () => searchKnowledge({ question, companyId, includeUnverified }), {
    runType: "retriever",
    inputs: { question, company_id: companyId, include_unverified: includeUnverified },
    metadata: { company_id: companyId || "all", include_unverified: includeUnverified },
  });
  let retrieval = chunks.retrieval || {
    vector_matched: chunks.filter((chunk) => (chunk.retrieved_by || []).includes("vector")).length,
    lexical_matched: chunks.filter((chunk) => (chunk.retrieved_by || []).includes("lexical")).length,
    candidates: chunks.length,
    overlapped: chunks.filter((chunk) => (chunk.retrieved_by || []).length > 1).length,
    metric_rows: chunks.filter((chunk) => chunk.source_type === "metric_row").length,
    lexical_available: null,
    lexical_error: null,
  };
  let evidence = evidenceText(chunks);

  let { data } = await createJsonResponse({
    name: "knowledge_answer",
    schema: ANSWER_SCHEMA,
    instructions: INSTRUCTIONS,
    input: `질문: ${question}\n\n=== 근거 ===\n${evidence}`,
    provider: "openai_rag",
  });

  if (!data.sufficient) {
    try {
      const rewrittenQueries = await rewriteQuestionForSearch(question);
      const retryGroups = await Promise.all(rewrittenQueries.map((rewritten) => searchKnowledge({
        question: rewritten, intentQuestion: question, companyId, includeUnverified,
      })));
      const retried = mergeRetryChunks([chunks, ...retryGroups]);
      if (rewrittenQueries.length && retried.length) {
        chunks = retried;
        retrieval = { ...retrieval, rewritten: true, rewritten_queries: rewrittenQueries, retry_matched: retried.length,
          metric_rows: retried.filter((row) => row.source_type === "metric_row").length };
        evidence = evidenceText(chunks);
        ({ data } = await createJsonResponse({
          name: "knowledge_answer", schema: ANSWER_SCHEMA, instructions: INSTRUCTIONS,
          input: `질문: ${question}\n\n=== 재작성 재검색 근거 ===\n${evidence}`, provider: "openai_rag",
        }));
      }
    } catch (error) {
      console.warn("[KNOWLEDGE_REWRITE_SKIPPED]", JSON.stringify({ message: error?.message || "REWRITE_FAILED" }));
    }
  }

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
      retrieved_by: chunk.retrieved_by || [],
      verified: chunk.source_type !== "headline",
      metric_grade: chunk.source_type === "metric_row" ? chunk.metric_grade : null,
      excerpt: (chunk.original_excerpt || chunk.content_ko || "").slice(0, 220),
    };
  });
  const unverified = chunks.filter((chunk) => chunk.source_type === "headline").length;
  const textOnlyReports = chunks.filter((chunk) => chunk.source_type === "report_chunk").length;
  const providerRows = chunks.filter((chunk) => chunk.source_type === "metric_row" && chunk.metric_grade === "provider").length;
  return { ...data, sources, matched: chunks.length, unverified_matched: unverified,
    provider_metric_matched: providerRows,
    retrieval,
    report_text_only_matched: textOnlyReports,
    completeness_warning: textOnlyReports ? "공시 PDF의 이미지 도표는 분석되지 않았으므로 검색 결과가 보고서 전체를 대표하지 않습니다." : null };
}
