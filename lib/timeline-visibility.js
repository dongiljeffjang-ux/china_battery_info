// 기업 시계열은 전략의 흐름을 읽는 화면이다. 검색 코퍼스에는 공시의 세부 재무 사실을 모두
// 보존하되, 화면과 그 화면을 근거로 만드는 리포트에는 사업 변화 신호만 남긴다.
const DISCLOSURE_NOISE = /피보증|被担保|보증\s*(?:잔액|대상|한도|금액)|担保余额|고부채|부채비율|자산부채율|关联交易|특수관계자|관계기업|감사(?:의견|보수)|审计意见|임원\s*보수|董事薪酬|배당|현금배당|주당배당|所得税|이연법인세|정부보조금|소송충당|대손충당|매출채권|미수금|应收账款|차입금|유동부채|비유동부채/iu;
const PLAIN_FINANCIAL = /매출(?:액)?|영업이익|순이익|당기순이익|귀속\s*순이익|营业收入|营业利润|净利润|총자산|순자산|현금흐름|资产总额|经营现金流/iu;
const BUSINESS_SIGNAL = /출하|판매량|판매량|생산량|생산능력|생산용량|가동률|이용률|시장점유율|점유율|순위|수주|주문|공급계약|고객|납품|인증|제품\s*믹스|제품구성|ASP|평균판매가격|판가|단가|원가|마진|수익률|매출총이익률|毛利率|销量|出货|产量|产能|开工率|利用率|市占率|市场份额|订单|客户|供货|均价|成本/iu;

export function isTimelineBusinessEvent(event) {
  if (event?.layer_key !== "supply-performance") return true;
  const text = `${event.title_ko || ""} ${event.fact_ko || ""} ${event.original_excerpt_ko || ""}`;
  if (DISCLOSURE_NOISE.test(text)) return false;
  if (PLAIN_FINANCIAL.test(text) && !BUSINESS_SIGNAL.test(text)) return false;
  return true;
}

export function filterTimelineEvents(events) {
  return (events || []).filter(isTimelineBusinessEvent);
}
