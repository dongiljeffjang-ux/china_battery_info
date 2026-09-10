// 기업 시계열은 전략의 흐름을 읽는 화면이다. 검색 코퍼스에는 공시의 세부 재무 사실을 모두
// 보존하되, 화면과 그 화면을 근거로 만드는 리포트에는 사업 변화 신호만 남긴다.
const DISCLOSURE_NOISE = /피보증|被担保|보증\s*(?:잔액|대상|한도|금액)|担保余额|고부채|부채비율|자산부채율|모집자금\s*(?:(?:전용)?계좌\s*잔액|사용\s*현황|누적\s*사용|사용\s*및\s*잔액|프로젝트\s*투자\s*합계|사용\s*합계)|募集资金.*(?:专户|账户).*余额|关联交易|특수관계자|관계기업|감사(?:의견|보수)|审计意见|임원\s*보수|董事薪酬|배당|현금배당|주당배당|所得税|이연법인세|정부보조금|소송충당|대손충당|매출채권|미수금|应收账款|차입금|유동부채|비유동부채/iu;
const PLAIN_FINANCIAL = /매출(?:액)?|영업이익|순이익|당기순이익|귀속\s*순이익|营业收入|营业利润|净利润|총자산|순자산|현금흐름|资产总额|经营现金流/iu;
const BUSINESS_SIGNAL = /출하|판매량|판매량|생산량|생산능력|생산용량|가동률|이용률|시장점유율|점유율|순위|수주|주문|공급계약|고객|납품|인증|제품\s*믹스|제품구성|ASP|평균판매가격|판가|단가|원가|마진|수익률|매출총이익률|毛利率|销量|出货|产量|产能|开工率|利用率|市占率|市场份额|订单|客户|供货|均价|成本/iu;
const REPORT_EVIDENCE = new Set(["annual_report", "periodic_report"]);
// 정기보고서에는 보증·파생상품·자금 사용처럼 검색 근거로는 유용하지만 전략 시계열을
// 읽을 때는 잡음인 수치가 많다. DB와 벡터 지식에는 전부 보존하고, 시계열 API에서만
// 생산능력·출하량·매출·영업이익에 해당하는 핵심 정량 신호를 남긴다.
const REPORT_TIMELINE_QUANT = /생산(?:능력|용량|캐파)|캐파|출하(?:량)?|판매량|영업이익|매출(?!원가|총이익|채권)|产能|出货(?:量)?|销量|营业利润|营业(?:总)?收入|营收/iu;

export function isTimelineBusinessEvent(event) {
  const text = `${event.title_ko || ""} ${event.fact_ko || ""} ${event.original_excerpt_ko || ""}`;
  if (DISCLOSURE_NOISE.test(text)) return false;
  if (REPORT_EVIDENCE.has(event?.evidence_kind)) return REPORT_TIMELINE_QUANT.test(text);
  if (event?.layer_key !== "supply-performance") return true;
  if (PLAIN_FINANCIAL.test(text) && !BUSINESS_SIGNAL.test(text)) return false;
  return true;
}

function quarterOf(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})/);
  return match ? `${match[1]}-Q${Math.floor((Number(match[2]) - 1) / 3) + 1}` : "";
}

function termsFrom(text) {
  // 조사·구두점은 떼되 수치와 업계 고유어는 남긴다. 서로 다른 기사 제목이라도
  // "동박 40만 톤 · 3년 · 공동 신설"처럼 사업 사실의 핵심이 같으면 잡히게 한다.
  return new Set(String(text || "")
    .toLowerCase()
    .replace(/[()\[\],.·:：/]/g, " ")
    .split(/\s+/)
    .map((term) => term.replace(/^(?:닝더스다이\(?catl\)?|catl)$/i, "").trim())
    .filter((term) => term.length >= 2));
}

function termsOf(event) { return termsFrom(`${event.title_ko || ""} ${event.fact_ko || ""}`); }

function normalizedTitle(event) {
  return String(event.title_ko || "").toLowerCase().replace(/[^0-9a-z가-힣]/gi, "").replace(/닝더스다이|catl/g, "");
}

function isSpecificNumber(term) {
  const match = String(term).match(/\d+/);
  if (!match) return false;
  // 보고연도(2025·2026)는 같은 분기의 모든 사실에 붙어 있어 식별력이 없다.
  const number = Number(match[0]);
  return !(number >= 1900 && number <= 2100 && /^\d{4}년?$/.test(String(term)));
}

export function isSameTimelineEvent(a, b) {
  if (!a || !b || a.layer_key !== b.layer_key || quarterOf(a.occurred_at) !== quarterOf(b.occurred_at)) return false;
  const titleA = normalizedTitle(a), titleB = normalizedTitle(b);
  if (titleA.length >= 8 && titleA === titleB) return true;
  const left = termsOf(a), right = termsOf(b);
  if (!left.size || !right.size) return false;
  const shared = [...left].filter((term) => right.has(term));
  const leftFact = termsFrom(a.fact_ko), rightFact = termsFrom(b.fact_ko);
  const sharedFact = [...leftFact].filter((term) => rightFact.has(term));
  const factOverlap = sharedFact.length / Math.min(leftFact.size || 1, rightFact.size || 1);
  if (factOverlap < 0.7) return false;
  // 짧은 일반어("투자", "생산")만 겹치는 별개 일을 합치지 않는다. 제목이 다르면
  // 식별력 있는 수치가 둘 이상 같아야 한다(40만 톤·3년 동박 협약 같은 교차 보도).
  return shared.filter(isSpecificNumber).length >= 2 && shared.length >= 4 && shared.length / Math.min(left.size, right.size) >= 0.55;
}

export function dedupeTimelineEvents(events) {
  const kept = [];
  for (const event of events || []) {
    const existingIndex = kept.findIndex((candidate) => isSameTimelineEvent(candidate, event));
    if (existingIndex < 0) { kept.push(event); continue; }
    const existing = kept[existingIndex];
    // 같은 사업 사실이면 사람이 화면에서 더 많은 판단 재료를 얻는 상세 설명을 남긴다.
    if (String(event.fact_ko || "").length > String(existing.fact_ko || "").length) kept[existingIndex] = event;
  }
  return kept;
}

export function filterTimelineEvents(events) {
  return dedupeTimelineEvents((events || []).filter(isTimelineBusinessEvent));
}
