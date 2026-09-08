// 벡터 청크가 없는 event를 찾아 다시 임베딩한다.
//
// 용도: 임베딩이 실패했거나 청크가 지워진 이벤트를 메운다. 2026-09-07에 잘못된 삭제로
// event_fact 청크 7건이 사라졌고, 당시 백로그 조회가 최근 500건만 봐서 자동 복구되지 않았다.
// 그 한계는 lib/curation.js의 fetchEmbeddableEvents로 고쳤고, 이 스크립트는 같은 방식으로
// 전체를 훑어 누락분만 다시 만든다.
//
// 실행:
//   node --env-file=.env scripts/restore-missing-event-chunks.mjs          (확인만)
//   node --env-file=.env scripts/restore-missing-event-chunks.mjs --apply  (실제 임베딩)
//
// --apply는 OpenAI 임베딩 API를 호출하므로 비용이 발생한다. 기본은 목록만 출력한다.
import { supabaseRest } from "../lib/supabase.js";
import { embedEvents } from "../lib/vector-ingestion.js";
import { fetchEmbeddableEvents } from "../lib/curation.js";

const EVENT_SELECT = "id,company_id,article_id,occurred_at,occurred_precision,occurred_basis,title_ko,fact_ko,trajectory_track,layer_key,entity_names,source_url,source_name,original_excerpt,original_excerpt_ko,evidence_kind,event_fact(counterparty),company(name_ko)";
// 한 번에 되살릴 상한. 이보다 많으면 삭제 사고가 아니라 다른 문제이므로 멈추고 사람이 본다.
const SAFETY_LIMIT = 50;

const apply = process.argv.includes("--apply");

const embedded = await supabaseRest("knowledge_chunk?select=event_id&event_id=not.is.null");
const done = new Set((embedded || []).map((row) => row.event_id));
const all = await fetchEmbeddableEvents(EVENT_SELECT);
const missing = all
  .filter((event) => !done.has(event.id) && event.title_ko && event.fact_ko)
  .map((event) => ({ ...event, company_name_ko: event.company?.name_ko || null }));

console.log(`이벤트 ${all.length}건 중 청크 없는 이벤트 ${missing.length}건`);
for (const event of missing) {
  console.log(`  ${event.occurred_at} | ${event.company_id} | ${String(event.title_ko).slice(0, 50)}`);
}

if (!missing.length) {
  console.log("복구할 대상이 없습니다.");
  process.exit(0);
}
if (missing.length > SAFETY_LIMIT) {
  console.error(`중단: 누락이 ${SAFETY_LIMIT}건을 넘습니다. 원인을 먼저 확인하세요.`);
  process.exit(1);
}
if (!apply) {
  console.log("확인 모드입니다. 실제로 만들려면 --apply를 붙이세요. OpenAI 임베딩 비용이 발생합니다.");
  process.exit(0);
}

const result = await embedEvents(missing);
console.log(`복구한 청크 ${result.chunks}건, 모델 ${result.model}`);
