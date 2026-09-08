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

console.log("data audit checks passed");
