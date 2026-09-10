// LLM 자동 판정 시험 — 로컬 실행용 진단 도구.
//
//   node --env-file=.env scripts/probe-llm-judge.mjs --mode retrieval [--max 114] [--provider deepseek]
//   node --env-file=.env scripts/probe-llm-judge.mjs --mode chunk --max 50
//
// 무엇을 하는가
//   retrieval — 사람이 이미 판정한 (질문, 근거) 쌍을 LLM에 다시 물어 일치율을 잰다.
//               사람 판정은 프롬프트에 넣지 않는다. 넣으면 측정이 아니라 따라쓰기가 된다.
//   chunk     — 청크를 표본으로 뽑아 LLM 판정만 받아 본다. 사람 판정이 1건뿐이라 일치율은 못 낸다.
//
// DB에는 쓰지 않는다. 결과는 outputs/llm-judge/에만 남긴다.
// pipeline_log에도 남기지 않는다(skipTelemetry) — 진단 실행이 운영 장부를 오염시키지 않게 한다.

import fs from "node:fs";
import path from "node:path";
import { supabaseRest, hasDatabaseConfig } from "../lib/supabase.js";
import { createJsonResponse, llmConfig } from "../lib/llm-provider.js";
import { buildChunkJudgePrompt, buildRetrievalJudgePrompt, judgeAgreement } from "../lib/rag-llm-judge.js";

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const MODE = argOf("--mode", "retrieval");
const MAX = Number(argOf("--max", "200"));
const PROVIDER = argOf("--provider", "auto");
// 동시 호출 수. 올리면 빨라지지만 제공자 레이트리밋에 걸린다.
const CONCURRENCY = Number(argOf("--concurrency", "4"));
const OUT_DIR = path.join("outputs", "llm-judge");

if (!hasDatabaseConfig()) {
  console.error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 없습니다. --env-file=.env 로 실행하세요.");
  process.exit(1);
}
const config = llmConfig(PROVIDER);
if (!config) {
  console.error("LLM 키가 없습니다. --env-file=.env 로 실행하세요.");
  process.exit(1);
}

const CHUNK_SELECT = "id,source_type,company_id,source_name,published_at,content_ko";

// 사람이 판정한 검색 결과 + 그 근거의 실제 본문.
// 청크가 지워졌으면(재수집으로 교체 등) 판정할 대상이 없으므로 뺀다.
async function loadRetrievalPairs() {
  const rows = [];
  for (let offset = 0; offset < 5000; offset += 500) {
    const batch = await supabaseRest(
      `rag_evaluation?select=id,chunk_id,question,result_rank,verdict,issue_tags,evaluator&subject_type=eq.retrieval&order=created_at.asc&limit=500&offset=${offset}`,
    );
    rows.push(...(batch || []));
    if (!batch || batch.length < 500) break;
  }
  const ids = [...new Set(rows.map((row) => row.chunk_id))];
  const chunks = new Map();
  for (let index = 0; index < ids.length; index += 100) {
    const slice = ids.slice(index, index + 100);
    const batch = await supabaseRest(`knowledge_chunk?select=${CHUNK_SELECT}&id=in.(${slice.join(",")})`);
    for (const chunk of batch || []) chunks.set(chunk.id, chunk);
  }
  const pairs = [];
  let missing = 0;
  for (const row of rows) {
    const chunk = chunks.get(row.chunk_id);
    if (!chunk) { missing += 1; continue; }
    pairs.push({ ...row, chunk });
  }
  return { pairs: pairs.slice(0, MAX), missing, human_total: rows.length };
}

async function loadChunks() {
  const rows = await supabaseRest(
    `knowledge_chunk?select=${CHUNK_SELECT}&order=created_at.desc&limit=${Math.min(200, MAX)}`,
  );
  return rows || [];
}

// 한 건 판정. 실패는 던지지 않고 error로 담아 배치 전체가 멈추지 않게 한다.
async function judge(prompt) {
  const started = Date.now();
  try {
    const payload = await createJsonResponse({
      ...prompt,
      provider: PROVIDER,
      skipTelemetry: true,
      timeoutMs: 60000,
    });
    // createJsonResponse는 이미 스키마 검증까지 끝낸 { data, telemetry }를 돌려준다.
    // 원시 응답을 다시 파싱하려 들면 안 된다.
    return { ok: true, ...(payload.data || {}), ms: Date.now() - started, usage: payload.telemetry?.usage || null };
  } catch (error) {
    return { ok: false, error: String(error.message || error).slice(0, 300), ms: Date.now() - started };
  }
}

// 동시 실행 풀. Promise.all로 한꺼번에 던지면 레이트리밋에 걸린다.
async function pooled(items, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.max(1, CONCURRENCY) }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
      const done = results.filter(Boolean).length;
      if (done % 10 === 0 || done === items.length) process.stdout.write(`  ${done}/${items.length}\r`);
    }
  });
  await Promise.all(runners);
  return results;
}

function tokenTotals(results) {
  let input = 0;
  let output = 0;
  for (const row of results) {
    if (!row?.usage) continue;
    input += Number(row.usage.input_tokens || 0);
    output += Number(row.usage.output_tokens || 0);
  }
  return { input_tokens: input, output_tokens: output };
}

async function runRetrieval() {
  const { pairs, missing, human_total } = await loadRetrievalPairs();
  console.log(`사람 판정 ${human_total}건 중 청크가 살아 있는 ${pairs.length}건을 판정합니다 (청크 삭제로 제외 ${missing}건).`);
  console.log(`모델: ${config.provider} / ${config.model}, 동시 ${CONCURRENCY}\n`);

  const results = await pooled(pairs, (pair) =>
    judge(buildRetrievalJudgePrompt({ question: pair.question, chunk: pair.chunk, rank: pair.result_rank })));

  const rows = pairs.map((pair, index) => {
    const result = results[index] || { ok: false, error: "no_result" };
    return {
      chunk_id: pair.chunk_id,
      question: pair.question,
      rank: pair.result_rank,
      human: pair.verdict,
      human_tags: pair.issue_tags || [],
      llm: result.ok ? result.verdict : null,
      llm_tags: result.ok ? result.issue_tags || [] : [],
      llm_reason: result.ok ? result.reason_ko : null,
      error: result.ok ? null : result.error,
      source_type: pair.chunk.source_type,
      company_id: pair.chunk.company_id,
    };
  });

  const failed = rows.filter((row) => row.error);
  const agreement = judgeAgreement(rows.filter((row) => row.llm));
  return { mode: "retrieval", model: `${config.provider}/${config.model}`, judged: rows.length, failed: failed.length, agreement, usage: tokenTotals(results), rows };
}

async function runChunk() {
  const chunks = await loadChunks();
  console.log(`청크 ${chunks.length}건을 판정합니다. 사람 판정이 1건뿐이라 일치율은 내지 않습니다.`);
  console.log(`모델: ${config.provider} / ${config.model}, 동시 ${CONCURRENCY}\n`);

  const results = await pooled(chunks, (chunk) => judge(buildChunkJudgePrompt(chunk)));
  const rows = chunks.map((chunk, index) => {
    const result = results[index] || { ok: false, error: "no_result" };
    return {
      chunk_id: chunk.id,
      source_type: chunk.source_type,
      company_id: chunk.company_id,
      preview: String(chunk.content_ko || "").slice(0, 160),
      llm: result.ok ? result.verdict : null,
      llm_tags: result.ok ? result.issue_tags || [] : [],
      llm_reason: result.ok ? result.reason_ko : null,
      error: result.ok ? null : result.error,
    };
  });

  const tally = {};
  for (const row of rows) if (row.llm) tally[row.llm] = (tally[row.llm] || 0) + 1;
  const tags = {};
  for (const row of rows) for (const tag of row.llm_tags) tags[tag] = (tags[tag] || 0) + 1;

  return { mode: "chunk", model: `${config.provider}/${config.model}`, judged: rows.length, failed: rows.filter((row) => row.error).length, verdicts: tally, issue_tags: tags, usage: tokenTotals(results), rows };
}

const started = Date.now();
const report = MODE === "chunk" ? await runChunk() : await runRetrieval();
report.elapsed_ms = Date.now() - started;

fs.mkdirSync(OUT_DIR, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const file = path.join(OUT_DIR, `${MODE}-${stamp}.json`);
fs.writeFileSync(file, JSON.stringify(report, null, 2), "utf8");

console.log(`\n\n== ${report.mode} · ${report.model} ==`);
console.log(`판정 ${report.judged}건, 실패 ${report.failed}건, ${Math.round(report.elapsed_ms / 1000)}초`);
console.log(`토큰: 입력 ${report.usage.input_tokens.toLocaleString()} / 출력 ${report.usage.output_tokens.toLocaleString()}`);
if (report.agreement) {
  const a = report.agreement;
  console.log(`\n일치율 (사람 ${a.total}건 대비)`);
  console.log(`  정확 일치      ${a.exact}`);
  console.log(`  쓸수있음/못씀  ${a.usable}`);
  console.log(`  bad 재현율     ${a.bad_recall}   (사람이 bad라 한 것을 LLM이 잡은 비율)`);
  console.log(`  bad 정밀도     ${a.bad_precision}   (LLM이 bad라 한 것 중 사람도 bad)`);
  console.log(`\n판정별 일치`, a.by_verdict);
  console.log(`혼동 행렬 (사람->LLM)`, a.matrix);
}
if (report.verdicts) console.log(`\n판정 분포`, report.verdicts, `\n사유 태그`, report.issue_tags);
console.log(`\n결과: ${file}`);
