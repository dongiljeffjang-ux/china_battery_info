// Sankey: Top 10 기사를 포함하고, 미검증 헤드라인은 같은 소식이면 한 번만 센다(2026-09-11 샨샨 사례). 네트워크 없이 돈다.
import assert from "node:assert/strict";
import fs from "node:fs";
import { sankeyFlowsFromArticles, themeSignalsFromText, sharedWordCount } from "../lib/sankey-normalization.js";

const link = [{ company_id: "shanshan" }];
const verified = [{
  id: "v6", is_top10: true, published_at: "2026-09-10T02:00:00Z",
  title_ko: "샨샨 일부 제품 가격 조정 완료·창훙에너지 풀탭 배터리 투자 확대",
  title_original: "杉杉股份部分产品完成调价；长虹能源加码全极耳电池｜新能源早参",
  headline_signals: [
    { direction: "expansion", reason_ko: "샨샨이 일부 음극재 제품 가격이 인상됐다고 밝힘", keyword_ko: "음극재 가격 인상" },
    { direction: "expansion", reason_ko: "창훙에너지가 21700 풀탭 배터리 생산능력을 추가할 계획", keyword_ko: "생산능력 확대" },
  ],
  article_company: link,
}];
const headlines = [
  // 같은 기사가 다른 주소로 수집됨: 원문 제목이 검증 기사와 같다.
  { id: "p2", published_at: "2026-09-10T01:00:00Z", title_ko: "샨샨 일부 제품 가격 조정", title_original: "杉杉股份部分产品完成调价；长虹能源加码全极耳电池｜新能源早参", article_company: link },
  // 같은 소식을 다른 매체가 씀.
  { id: "p3", published_at: "2026-09-10T05:00:00Z", title_ko: "중커전기는 음극 제품 가격 인상을 완료했는데, 샨샨도 가격을 인상했나? 샨샨의 답변", title_original: "", article_company: link },
  { id: "p5", published_at: "2026-09-09T05:00:00Z", title_ko: "샨샨(600884.SH): 일부 음극재 제품 가격 이미 인상", title_original: "", article_company: link },
  // 다른 소식: 같은 날·같은 테마(생산능력)라도 단어가 겹치지 않으면 따로 센다.
  { id: "p7", published_at: "2026-09-10T05:00:00Z", title_ko: "샨샨, 헝가리 공장 착공", title_original: "", article_company: link },
];
const flows = sankeyFlowsFromArticles(verified, headlines);
const price = flows.find(flow => flow.theme === "price");
assert.equal(price.grade, "verified");
assert.equal(price.top10, true, "Top 10 기사의 신호에 표시가 붙는다");
assert.equal(price.merged, 2, "같은 소식 헤드라인 두 건은 검증 흐름에 합친다");
assert.equal(flows.filter(flow => flow.theme === "price").length, 1, "같은 소식의 가격 신호는 한 번만 센다");
assert.ok(flows.some(flow => flow.grade === "headline" && flow.theme === "capacity" && /헝가리/.test(flow.title)), "다른 소식은 테마가 같아도 반영한다");
assert.ok(flows.some(flow => flow.grade === "headline" && flow.theme === "overseas"));
assert.equal(flows.duplicates, 3, "원문 제목 일치 1건 + 같은 소식 2건");

assert.ok(themeSignalsFromText("일부 음극재 제품 가격 이미 인상").some(signal => signal.theme === "price" && signal.direction === "positive"), "두 단어 사이 짧은 수식어를 허용한다");
assert.ok(themeSignalsFromText("部分负极材料产品价格已调涨").some(signal => signal.theme === "price"), "调涨도 가격 인상으로 본다");
assert.equal(themeSignalsFromText("가격 동향. 인상 깊은 발표").length, 0, "문장 부호를 넘어서는 잡지 않는다");
assert.equal(sharedWordCount("음극재 가격을 인상", "음극 제품 가격이 인상됐다"), 3, "조사가 붙은 형태도 같은 단어로 본다(음극재·가격을·인상)");
assert.equal(sharedWordCount("생산능력 확대", "생산라인 중단"), 0, "두 글자 이상 갈리는 단어는 다르다");

const dashboard = fs.readFileSync(new URL("../api/dashboard.js", import.meta.url), "utf8");
const sankeyQuery = dashboard.match(/dashboardQuery\("sankey", `([^`]+)`/)?.[1] || "";
assert.ok(sankeyQuery && !/is_top10=eq\.false/.test(sankeyQuery), "Sankey는 Top 10 기사를 빼지 않는다");
assert.match(dashboard, /sankey_headline_duplicates: flows\.duplicates/);
const app = fs.readFileSync(new URL("../app/app.js", import.meta.url), "utf8");
assert.match(app, /\[Top 10\] /, "툴팁에서 Top 10 근거를 구분한다");
assert.match(app, /같은 소식 헤드라인 \$\{flow\.grades\.merged\}건은 합침/);
assert.doesNotMatch(app, /비-Top 10/, "Top 10 제외 안내 문구를 남기지 않는다");

// 신호의 주체 회사(2026-09-11): 여러 회사에 연결된 기사라도 신호는 근거 문장에 이름이 나온 회사에만 붙인다.
{
  const multi = {
    id: "5b20", published_at: "2026-09-09T02:00:00Z", title_ko: "닝더스다이 주가 하락의 배경: 완성차 업체의 배터리 정의권 경쟁",
    article_company: [{ company_id: "byd" }, { company_id: "calb" }, { company_id: "catl" }],
    headline_signals: [
      { direction: "contraction", keyword_ko: "고급 배터리 주문", reason_ko: "리샹 신형 MEGA가 자체 개발 5C 삼원계 배터리로 전환하고, 6월 출시된 신형 리샹 L8도 신왕다 전지로 전면 교체돼 닝더스다이의 해당 차종 공급이 빠진 사실" },
      { direction: "expansion", keyword_ko: "배터리 공급망 다변화", reason_ko: "리샹이 신왕다동력에 26억5000만 위안을 증자한 사실, 샤오미가 중촹신항·신왕다동력과 룽자 배터리를 발표한 사실" },
    ],
  };
  const split = sankeyFlowsFromArticles([multi], []);
  assert.deepEqual(split.filter(flow => flow.direction === "negative").map(flow => flow.company_id), ["catl"], "CATL 얘기인 축소 신호는 CATL에만 붙는다");
  assert.deepEqual(split.filter(flow => flow.direction === "positive").map(flow => flow.company_id), ["calb"], "중촹신항이 나오는 확대 신호는 중촹신항에만 붙는다");
  assert.ok(!split.some(flow => flow.company_id === "byd"), "근거 문장에 이름이 없는 연결 회사에는 신호를 붙이지 않는다");
  const unnamed = sankeyFlowsFromArticles([{ ...multi, headline_signals: [{ direction: "expansion", keyword_ko: "증설", reason_ko: "3개사가 공동으로 증설을 발표했다" }] }], []);
  assert.equal(unnamed.length, 3, "근거 문장에 아무 회사도 없으면 예전처럼 연결 회사 전체에 붙인다");
}

// 회사 선택(2026-09-11 사용자 요청): 고른 회사만 그리고, 고른 회사는 상위 N개사 자르기에서 빼지 않는다.
const html = fs.readFileSync(new URL("../app/index.html", import.meta.url), "utf8");
assert.match(html, /<details class="sankey-company-filter"><summary id="sankey-company-summary">/, "Sankey 옆에 회사 선택 목록을 둔다");
assert.match(app, /if \(filtering && !sankeyCompanyFilter\.has\(company_id\)\) return;/, "고른 회사의 신호만 센다");
assert.match(app, /const sourceNames = \(!filtering && allCompanies\.length > SANKEY_COMPANY_LIMIT/, "고른 회사는 전부 보인다");
assert.match(app, /localStorage\.setItem\(SANKEY_FILTER_KEY/, "고른 목록은 브라우저에 남긴다");
// 정량 궤적 그래프 값 레이블 크기(2026-09-11 사용자 요청: 너무 작음).
const css = fs.readFileSync(new URL("../app/styles.css", import.meta.url), "utf8");
assert.match(css, /\.traj-point-label\{font-size:15px;font-weight:700/, "그래프 값 레이블을 키운다");
assert.match(css, /\.traj-tick text\{font-size:13px/);

console.log("sankey top10 and headline dedupe checks passed");
