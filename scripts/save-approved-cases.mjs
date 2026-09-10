// 승인된 검토표를 rag_eval_case에 넣는다 — 로컬 실행. --write 없이는 미리보기만 한다.
//   node --env-file=.env.local scripts/save-approved-cases.mjs <draft.json> <approved.json> [--write]
// approved.json: [{ question, picks: ["8자리 id", ...], note?, abstain?: true }]
// 정답 청크 ID는 draft.json의 후보에서 8자리로 찾는다(정량 행의 가상 ID도 거기 있다).
// 기준 답변은 관리자 화면과 같은 규칙으로 정답 청크의 사실 줄을 모아 초안으로 넣는다.
import fs from "node:fs";
import { supabaseRest } from "../lib/supabase.js";

const [draftPath, approvedPath, flag] = process.argv.slice(2);
const draft = JSON.parse(fs.readFileSync(draftPath, "utf8"));
const approved = JSON.parse(fs.readFileSync(approvedPath, "utf8"));
const byShort = new Map();
for (const q of draft) for (const c of q.candidates) byShort.set(c.id.slice(0, 8), c);

function factOf(c) {
  const text = String(c.content || "");
  const company = text.match(/\[회사\]\s*([^\[\n]*)/)?.[1]?.trim() || c.company_id || "";
  let fact = text.match(/\[사실\]\s*([\s\S]*?)(?:\s\[[가-힣 ]+\]|$)/)?.[1]
    || text.match(/\[한국어 팩트 요약\]\s*([\s\S]*?)(?:\s\[원문|\s\[한국어 본문|$)/)?.[1]
    || text.match(/\[제목\]\s*([^\n]*)/)?.[1] || "";
  fact = fact.replace(/\s*-\s+/g, " ").replace(/\s{2,}/g, " ").trim().slice(0, 240);
  const short = company.replace(/\([^)]*\)/g, "").trim();
  return fact ? (company && !(short && fact.startsWith(short)) ? `${company} · ${fact}` : fact) : "";
}

const rows = [];
for (const item of approved) {
  const picks = (item.picks || []).map((s) => { const c = byShort.get(s); if (!c) throw new Error(`후보에 없는 ID: ${s} (${item.question})`); return c; });
  const ids = [...new Set(picks.map((c) => c.id))];
  const answer = item.abstain
    ? "코퍼스에 이 질문의 근거가 없다. 근거 부족으로 답하지 않는 것이 정답이다."
    : [...new Set(picks.map(factOf).filter(Boolean))].map((f) => `- ${f}`).join("\n");
  rows.push({
    title: item.question.slice(0, 160), question: item.question, reference_answer: answer.slice(0, 6000),
    reference_chunk_ids: ids, company_id: null, include_unverified: false, active: true,
    note: `[2026-09-10 검토표] ${item.abstain ? "답 없음 문항" : `에이전트 초안·사용자 승인. ${item.note || ""}`}`.trim(),
    updated_at: new Date().toISOString(),
  });
}
for (const r of rows) console.log(`${r.reference_chunk_ids.length}건  ${r.question}\n    ${r.reference_answer.split("\n")[0].slice(0, 110)}${r.reference_answer.includes("\n") ? " …" : ""}`);
if (flag !== "--write") { console.log(`\n(미리보기) ${rows.length}문항. --write 를 붙이면 저장합니다.`); process.exit(0); }
const existing = await supabaseRest("rag_eval_case?select=question&company_id=is.null&include_unverified=eq.false");
const have = new Set((existing || []).map((r) => r.question));
const fresh = rows.filter((r) => !have.has(r.question));
if (fresh.length !== rows.length) console.log(`이미 있는 질문 ${rows.length - fresh.length}건은 건너뜀`);
const saved = await supabaseRest("rag_eval_case?select=id,question", { method: "POST", body: fresh });
console.log(`저장 ${saved?.length ?? 0}건`);
