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

console.log("sankey top10 and headline dedupe checks passed");
