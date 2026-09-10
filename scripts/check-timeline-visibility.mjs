import assert from "node:assert/strict";
import { dedupeTimelineEvents, isTimelineBusinessEvent } from "../lib/timeline-visibility.js";

const event = (fact, layer_key = "supply-performance", evidence_kind = "article") => ({ layer_key, evidence_kind, title_ko: fact, fact_ko: fact });

assert.equal(isTimelineBusinessEvent(event("고부채 피보증 대상에 대한 보증 잔액 18억 위안")), false);
assert.equal(isTimelineBusinessEvent(event("모집자금 전용계좌 잔액 3억 위안")), false);
assert.equal(isTimelineBusinessEvent(event("모집자금 사용 현황", "investment-production")), false);
assert.equal(isTimelineBusinessEvent(event("2025년 매출 120억 위안, 순이익 8억 위안")), false);
assert.equal(isTimelineBusinessEvent(event("양극재 출하량 12만 톤으로 증가, 시장점유율 3위")), true);
assert.equal(isTimelineBusinessEvent(event("제품 믹스 개선으로 매출총이익률 4%p 상승")), true);
assert.equal(isTimelineBusinessEvent(event("유럽 고객과 5년 공급계약 체결", "customer-commercialization")), true);

// 시장 정기보고서의 세부 공시 사실은 DB·검색 코퍼스에 남기되 기업 시계열에는 핵심 정량 신호만 보인다.
// 기술 정기보고서는 정량 키워드가 없어도 개발·특허·공정 등 사업 사실을 시계열에 보인다.
const report = (fact, layer = "investment-production") => event(fact, layer, "periodic_report");
assert.equal(isTimelineBusinessEvent(report("외환 파생상품 투자 실제 수익 1,240만 위안")), false);
assert.equal(isTimelineBusinessEvent(report("2026년 6월 말 플래시 충전소 7,018기를 구축했다")), false);
assert.equal(isTimelineBusinessEvent(report("자회사 대상 보증 승인 한도 8,890,966만 위안, 실제 발생액 4,314,564만 위안")), false);
assert.equal(isTimelineBusinessEvent(report("동력전지 생산능력은 30GWh이다")), true);
assert.equal(isTimelineBusinessEvent(report("양극재 출하량은 12만 톤이다")), true);
assert.equal(isTimelineBusinessEvent(report("2025년 매출 120억 위안")), true);
assert.equal(isTimelineBusinessEvent(report("2025년 영업이익 8억 위안")), true);
assert.equal(isTimelineBusinessEvent({
  ...report("전고체 배터리 시제품 개발을 진행했다", "technology-development"),
  trajectory_track: "technology",
}), true);
assert.equal(isTimelineBusinessEvent({
  ...report("상반기 특허 180건을 출원했다", "technology-ip-standard"),
  trajectory_track: "technology",
}), true);
assert.equal(isTimelineBusinessEvent({
  ...report("특허 820건·자산부채율 61.35%", "technology-ip-standard"),
  trajectory_track: "technology",
}), true, "기술 보고서에 재무 잡음이 섞여도 기술 사실을 숨기지 않는다");
assert.equal(isTimelineBusinessEvent({
  ...report("2025년 지배주주 순이익 722억 위안"),
  original_excerpt_ko: "회사는 매출 4,237억 위안과 지배주주 순이익 722억 위안을 기록했다.",
}), false, "원문 발췌 주변의 매출 표현 때문에 순이익 이벤트가 통과하면 안 된다");
assert.equal(isTimelineBusinessEvent(report("상위 5대 고객 매출은 1,474.59억 위안이다", "customer-commercialization")), false);
assert.equal(isTimelineBusinessEvent(report("1위 고객 판매금액은 501.17억 위안이다", "customer-commercialization")), false);
assert.equal(isTimelineBusinessEvent(event("플래시 충전소 7,018기 구축", "investment-production", "article")), true,
  "뉴스의 사업 이벤트는 공시 세부 필터로 숨기지 않는다");

const duplicateAgreement = dedupeTimelineEvents([
  { occurred_at: "2026-09-03", layer_key: "investment-production", title_ko: "동박 생산능력 40만 톤 공동 구축 협약 체결", fact_ko: "CATL이 협력사 2곳과 향후 3년간 동박 40만 톤 생산능력을 공동 신설한다." },
  { occurred_at: "2026-09-04", layer_key: "investment-production", title_ko: "선전후이커 등과 동박 40만 톤 생산능력 공동 신설 협약", fact_ko: "CATL은 선전후이커 등 2개 협력사와 향후 3년간 40만 톤의 동박 생산능력을 공동 신설한다." },
]);
assert.equal(duplicateAgreement.length, 1, "표현만 다른 같은 동박 증설 협약은 시계열에서 한 번만 보여야 한다");
assert.equal(dedupeTimelineEvents([
  { occurred_at: "2026-04-01", layer_key: "investment-production", title_ko: "동박 40만 톤 협약", fact_ko: "협력사와 동박 40만 톤 생산능력 공동 신설 협약을 체결했다." },
  { occurred_at: "2026-08-01", layer_key: "investment-production", title_ko: "동박 40만 톤 협약", fact_ko: "협력사와 동박 40만 톤 생산능력 공동 신설 협약을 체결했다." },
]).length, 2, "다른 분기에 발생한 반복 협약은 합치면 안 된다");
assert.equal(dedupeTimelineEvents([
  { occurred_at: "2026-09-01", layer_key: "investment-production", title_ko: "국내 음극재 생산능력 62.25만 톤", fact_ko: "국내 음극재 생산능력은 62.25만 톤이다." },
  { occurred_at: "2026-09-01", layer_key: "investment-production", title_ko: "해외 음극재 생산능력 16만 톤", fact_ko: "해외 음극재 생산능력은 16만 톤이다." },
]).length, 2, "같은 분기의 서로 다른 사업 단위는 공통 단어만으로 합치면 안 된다");
assert.equal(dedupeTimelineEvents([
  { occurred_at: "2026-09-01", layer_key: "investment-production", title_ko: "간저우 연산 30GWh 배터리 프로젝트 진행", fact_ko: "간저우 생산기지는 1기 설비 설치를 진행한다." },
  { occurred_at: "2026-09-01", layer_key: "investment-production", title_ko: "광저우 연산 30GWh 배터리 프로젝트 진행", fact_ko: "광저우 생산기지는 1기 건설 인허가를 진행한다." },
]).length, 2, "같은 용량·단계라도 장소와 실제 진행 내용이 다르면 합치면 안 된다");

console.log("timeline business visibility checks passed");
