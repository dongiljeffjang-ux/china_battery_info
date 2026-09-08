import assert from "node:assert/strict";
import { buildDataAudit } from "../lib/data-audit.js";

const companies = [
  { id: "byd", name_ko: "비야디(BYD)", name_zh: "比亚迪", name_en: "BYD", aliases: ["比亚迪", "BYD"] },
  { id: "hunan-yuneng", name_ko: "후난위넝", name_zh: "湖南裕能", name_en: "Hunan Yuneng", aliases: ["湖南裕能", "Hunan Yuneng"] },
];
const article = { id: "a1", title_original: "宁德时代套现5亿之后，湖南裕能赴港上市", source_name: "第一财经", discovered_via: "web_search_openai", article_company: [{ company_id: "byd" }] };
const result = buildDataAudit({ articles: [article], companies });
assert.equal(result.counts.high, 1);
assert.equal(result.issues[0].kind, "company_subject_mismatch");
assert.deepEqual(result.issues[0].detected_company_ids, ["hunan-yuneng"]);

const aligned = buildDataAudit({
  articles: [{ ...article, title_original: "比亚迪发布新产品", article_company: [{ company_id: "byd" }] }],
  chunks: [{ article_id: "a1", company_id: "hunan-yuneng" }, { article_id: "a1", company_id: "hunan-yuneng" }],
  events: [{ article_id: "missing", company_id: "byd" }], companies,
});
assert.equal(aligned.issues.find((issue) => issue.kind === "chunk_company_mismatch")?.affected_count, 2);
assert.ok(aligned.issues.some((issue) => issue.kind === "event_orphan_article"));

// 제목에는 CATL·BYD만 보이지만 본문에는 EVE까지 등장하는 다중 회사 기사다.
// 본문을 읽지 않고 제목·요약만 보면 EVE 연결을 오분류로 잘못 올린다.
const multiCompany = buildDataAudit({
  articles: [{
    id: "a2", title_ko: "세계 동력배터리 대회에서 CATL·BYD 기술 논의", discovered_via: "web_search_openai",
    article_company: [{ company_id: "byd" }, { company_id: "catl" }, { company_id: "eve-energy" }],
  }],
  chunks: [{ article_id: "a2", company_id: "eve-energy", source_type: "article_chunk", content_ko: "본문에서 EVE Energy의 차세대 배터리 기술도 함께 다뤘다." }],
  companies: [
    ...companies,
    { id: "catl", name_ko: "닝더스다이(CATL)", name_zh: "宁德时代", name_en: "CATL", aliases: ["宁德时代", "CATL"] },
    { id: "eve-energy", name_ko: "이브에너지(EVE Energy)", name_zh: "亿纬锂能", name_en: "EVE Energy", aliases: ["亿纬锂能", "EVE Energy"] },
  ],
});
assert.equal(multiCompany.issues.length, 0, "본문에 EVE가 있으면 회사 불일치 후보가 아니어야 한다");

console.log("data audit checks passed");
