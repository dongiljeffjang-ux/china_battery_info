// 사용: node --env-file=.env.local scripts/process-pending-range.mjs --from 2026-09-01 --to 2026-10-01
// pending 상태를 다시 확인하는 processPendingArticle만 호출한다. verified·종료 상태는 바꾸지 않는다.
import { processPendingArticle, recordProcessing } from "../api/process-article.js";
import { supabaseRest } from "../lib/supabase.js";

const arg = (name, fallback = "") => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || fallback) : fallback;
};
const from = arg("--from", "2026-09-01");
const to = arg("--to", "2026-10-01");
const concurrency = Math.max(1, Math.min(3, Number(arg("--concurrency", "3")) || 3));
const dryRun = process.argv.includes("--dry-run");
if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from >= to) {
  throw new Error("--from/--to는 유효한 YYYY-MM-DD 범위여야 합니다.");
}

const select = "id,title_original,source_name,published_at,source_tier,article_company(company_id)";
const PAGE_SIZE = 300;
const rows = [];
for (let offset = 0; ; offset += PAGE_SIZE) {
  const page = await supabaseRest(
    `article?select=${select}&verification_status=eq.pending&or=(processing_status.is.null,processing_status.eq.processing_failed)&published_at=gte.${from}&published_at=lt.${to}&order=published_at.desc,id.desc&limit=${PAGE_SIZE}&offset=${offset}`
  );
  rows.push(...page);
  if (page.length < PAGE_SIZE) break;
}
const eligible = rows.filter((article) => article.article_company?.length);
const skipped = rows.length - eligible.length;
console.log(JSON.stringify({ from, to, found: rows.length, eligible: eligible.length, skipped_without_company: skipped, order: "published_at.desc", dry_run: dryRun }, null, 2));
if (dryRun) process.exit(0);

const counts = {};
let next = 0;
await Promise.all(Array.from({ length: Math.min(concurrency, eligible.length) }, async () => {
  while (next < eligible.length) {
    const article = eligible[next++];
    const companyId = article.article_company[0].company_id;
    try {
      const result = await processPendingArticle(article.id, companyId);
      counts[result.status] = (counts[result.status] || 0) + 1;
      console.log(JSON.stringify({ id: article.id, published_at: article.published_at, status: result.status, title: article.title_original }));
    } catch (error) {
      await recordProcessing(article.id, "processing_failed", error.message);
      counts.processing_failed = (counts.processing_failed || 0) + 1;
      console.error(JSON.stringify({ id: article.id, published_at: article.published_at, status: "processing_failed", message: error.message }));
    }
  }
}));
console.log(JSON.stringify({ completed: eligible.length, skipped_without_company: skipped, counts }, null, 2));
