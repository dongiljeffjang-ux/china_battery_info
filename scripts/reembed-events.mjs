// 모든 event_fact 벡터 청크의 텍스트와 임베딩을 현재 규칙으로 다시 만든다.
// 기본은 건수 확인만 하며, --apply일 때만 OpenAI 호출과 upsert를 수행한다. DELETE는 하지 않는다.
// 실행:
//   node --env-file=.env.local scripts/reembed-events.mjs
//   node --env-file=.env.local scripts/reembed-events.mjs --apply
import { supabaseRest } from "../lib/supabase.js";
import { fetchEmbeddableEvents } from "../lib/curation.js";
import { embedEvents } from "../lib/vector-ingestion.js";

const EVENT_SELECT = "id,company_id,article_id,occurred_at,occurred_precision,occurred_basis,title_ko,fact_ko,trajectory_track,layer_key,entity_names,source_url,source_name,original_excerpt,original_excerpt_ko,evidence_kind,event_fact(counterparty),company(name_ko)";
const APPLY_BATCH = 100;
const apply = process.argv.includes("--apply");

async function fetchEventChunks(pageSize = 1000) {
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const page = await supabaseRest(`knowledge_chunk?select=event_id&source_type=eq.event_fact&order=event_id.asc&limit=${pageSize}&offset=${offset}`);
    rows.push(...(page || []));
    if (!page || page.length < pageSize) return rows;
  }
}

const [events, beforeChunks] = await Promise.all([
  fetchEmbeddableEvents(EVENT_SELECT),
  fetchEventChunks(),
]);
const eligible = events
  .filter((event) => event.id && event.title_ko && event.fact_ko)
  .map((event) => ({ ...event, company_name_ko: event.company?.name_ko || null }));

console.log(`재임베딩 대상 이벤트 ${eligible.length}건, 기존 event_fact 청크 ${beforeChunks.length}건`);
if (!apply) {
  console.log("확인 모드입니다. 실제로 갱신하려면 --apply를 붙이세요. DELETE 없이 upsert합니다.");
  process.exit(0);
}
if (eligible.length !== beforeChunks.length) {
  throw new Error(`COUNT_MISMATCH_BEFORE: 이벤트 ${eligible.length}건, 청크 ${beforeChunks.length}건`);
}

let embedded = 0;
for (let offset = 0; offset < eligible.length; offset += APPLY_BATCH) {
  const result = await embedEvents(eligible.slice(offset, offset + APPLY_BATCH));
  embedded += result.chunks;
  console.log(`진행 ${Math.min(offset + APPLY_BATCH, eligible.length)}/${eligible.length}`);
}

const afterChunks = await fetchEventChunks();
if (afterChunks.length !== beforeChunks.length) {
  throw new Error(`COUNT_MISMATCH_AFTER: 실행 전 ${beforeChunks.length}건, 실행 후 ${afterChunks.length}건`);
}
console.log(`완료: ${embedded}건 재임베딩, event_fact 청크 ${afterChunks.length}건 유지`);
