// 평가 세트를 로컬 검색 코드로 채점한다 — 배포 전에 "이 수정이 16문항에 무슨 짓을 하는지" 보는 용도.
//
//   node --env-file=.env.local scripts/eval-benchmark-local.mjs [--label 설명]
//
// api/admin.js benchmarkRun과 같은 계산(Hit@10·MRR·Recall@10)을 같은 케이스로 돌리되,
// rag_eval_run/result에는 쓰지 않는다. 결과는 outputs/benchmark-local/에만 남긴다.
// 운영 기준선과 숫자가 같아야 로컬 채점을 믿을 수 있다 — 첫 실행에서 그것부터 확인한다.

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { supabaseRest } from "../lib/supabase.js";
import { searchKnowledge } from "../lib/knowledge-search.js";

const args = process.argv.slice(2);
const label = (() => { const i = args.indexOf("--label"); return i >= 0 ? args[i + 1] : ""; })();
const commit = (() => { try { return execSync("git rev-parse --short HEAD").toString().trim(); } catch { return "?"; } })();
const dirty = (() => { try { return execSync("git status --porcelain -- lib/").toString().trim() ? "+dirty" : ""; } catch { return ""; } })();

const cases = await supabaseRest("rag_eval_case?select=*&active=eq.true&order=updated_at.desc&limit=50");
const rows = [];
for (const item of cases) {
  const started = Date.now();
  const found = await searchKnowledge({ question: item.question, companyId: item.company_id || null, limit: 10, includeUnverified: item.include_unverified });
  const ids = found.map((row) => row.id);
  const expected = new Set(item.reference_chunk_ids || []);
  const ranks = ids.map((id, index) => (expected.has(id) ? index + 1 : null)).filter(Boolean);
  rows.push({
    question: item.question, hit: ranks.length ? 1 : 0, first_rank: ranks[0] || null,
    recall: expected.size ? ranks.length / expected.size : null, found: ranks.length, expected: expected.size,
    overlapped: found.retrieval?.overlapped ?? null, ms: Date.now() - started,
  });
}
const avg = (key) => { const v = rows.map((r) => r[key]).filter((x) => Number.isFinite(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
const metrics = { hit_rate_at_10: avg("hit"), mrr: rows.reduce((s, r) => s + (r.first_rank ? 1 / r.first_rank : 0), 0) / rows.length, recall_at_10: avg("recall"), cases: rows.length };

console.log(`\n== ${commit}${dirty} ${label} ==`);
console.log(`Hit@10 ${metrics.hit_rate_at_10.toFixed(3)}  MRR ${metrics.mrr.toFixed(3)}  Recall@10 ${metrics.recall_at_10.toFixed(3)}  (${rows.length}문항)\n`);
for (const r of rows.sort((a, b) => (a.first_rank || 99) - (b.first_rank || 99) || a.question.localeCompare(b.question))) {
  console.log(`${r.hit ? "○" : "×"} rank ${String(r.first_rank ?? "-").padStart(2)}  recall ${r.found}/${r.expected}  ovl ${String(r.overlapped ?? "-").padStart(2)}  ${r.question.slice(0, 34)}`);
}
fs.mkdirSync(path.join("outputs", "benchmark-local"), { recursive: true });
const file = path.join("outputs", "benchmark-local", `${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}-${commit}${dirty ? "-dirty" : ""}.json`);
fs.writeFileSync(file, JSON.stringify({ commit, dirty: Boolean(dirty), label, metrics, rows }, null, 2), "utf8");
console.log(`\n→ ${file}`);
