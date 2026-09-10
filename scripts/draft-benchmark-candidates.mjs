// 평가 문항 초안용 후보 수집 — 로컬 진단 도구. DB에 쓰지 않는다.
//
//   node --env-file=.env.local scripts/draft-benchmark-candidates.mjs questions.txt
//
// 질문마다 세 경로로 후보를 모은다. 검색 결과(사용자가 화면에서 보는 것)만 보면 검색이 놓친 정답을
// 못 넣는다 — 룽바이 LFP 4건이 그랬다. 그래서 단어 검색 30건 풀과 회사 한정 검색을 함께 모은다.
//   hybrid  : searchKnowledge 상위 10 (운영과 같음)
//   lex30   : 단어 검색 풀 30건 (회사 조건 포함)
//   co:<id> : 질문이 짚은 회사로 DB 필터를 건 검색 상위 10
// 결과는 outputs/benchmark-draft/<stamp>.json. 여기서 정답을 고르는 것은 사람(또는 검토를 받는 에이전트)이다.

import fs from "node:fs";
import path from "node:path";
import { supabaseRest } from "../lib/supabase.js";
import { searchKnowledge, expandDomainQuestion, buildLexicalQuery, questionCompanyTerms, questionCompanyGroups, questionValueChainGroups } from "../lib/knowledge-search.js";
import { COMPANIES } from "../lib/china-sources.js";

const file = process.argv[2];
if (!file) { console.error("질문 파일 경로가 필요합니다."); process.exit(1); }
const questions = fs.readFileSync(file, "utf8").split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
const ids = new Set(COMPANIES.map((c) => c.id));
const clip = (s, n = 420) => String(s || "").replace(/\s+/g, " ").trim().slice(0, n);

const out = [];
for (const question of questions) {
  const seen = new Map();
  const add = (row, tag) => {
    if (!row?.id) return;
    const e = seen.get(row.id) || { id: row.id, company_id: row.company_id, source_type: row.source_type, published_at: row.published_at ? String(row.published_at).slice(0, 10) : null, similarity: row.similarity ?? null, via: [], content: clip(row.content_ko) };
    e.via.push(tag);
    seen.set(row.id, e);
  };
  const hybrid = await searchKnowledge({ question, limit: 10 }).catch((e) => { console.error("hybrid failed", question, e.message); return []; });
  hybrid.forEach((r, i) => add(r, `hybrid#${i + 1}`));

  const groups = [...questionCompanyGroups(question), ...questionValueChainGroups(question)];
  const terms = questionCompanyTerms(question);
  const lex = buildLexicalQuery(expandDomainQuestion(question), { requiredTerms: terms, requiredGroups: groups });
  if (lex) {
    const pool = await supabaseRest("rpc/lexical_knowledge_chunks", { method: "POST", body: { query_text: lex, match_count: 30, filter_company_id: null, include_unverified: false } }).catch(() => []);
    (pool || []).forEach((r, i) => add(r, `lex#${i + 1}`));
  }
  const companyIds = [...new Set(groups.flat().filter((t) => ids.has(String(t).toLowerCase())).map((t) => String(t).toLowerCase()))].slice(0, 3);
  for (const cid of companyIds) {
    const scoped = await searchKnowledge({ question, companyId: cid, limit: 10 }).catch(() => []);
    scoped.forEach((r, i) => add(r, `co:${cid}#${i + 1}`));
  }
  const candidates = [...seen.values()];
  out.push({ question, company_ids: companyIds, candidates });
  process.stdout.write(`${question}  → 후보 ${candidates.length}건 (hybrid ${hybrid.length}, 회사 ${companyIds.join(",") || "-"})\n`);
}
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const target = path.join("outputs", "benchmark-draft", `${stamp}.json`);
fs.writeFileSync(target, JSON.stringify(out, null, 2), "utf8");
console.log(`→ ${target}`);
