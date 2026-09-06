// 파이프라인 단계 결과를 DB에 남긴다.
//
// 지금까지 수집·본문 처리·Daily·유지 단계의 결과는 console 태그로 Vercel 로그에만 남았다.
// 관리자 페이지가 "어제 밤에 무엇이 얼마나 들어왔는지"를 보려면 DB에 있어야 한다.
// 기록 실패가 파이프라인 실패가 되면 안 되므로 항상 삼킨다.
import { hasDatabaseConfig, supabaseRest } from "../api/lib/supabase.js";

const PAYLOAD_LIMIT = 60000;

export async function logPipeline(stage, payload = {}, { hop = null, status = "ok", durationMs = null } = {}) {
  if (!hasDatabaseConfig()) return;
  try {
    let body = JSON.stringify(payload);
    if (body.length > PAYLOAD_LIMIT) body = JSON.stringify({ truncated: true, head: body.slice(0, PAYLOAD_LIMIT) });
    await supabaseRest("pipeline_log", {
      method: "POST", prefer: "return=minimal",
      body: { stage, hop, status, payload: JSON.parse(body), duration_ms: durationMs == null ? null : Math.round(durationMs) },
    });
  } catch (error) {
    console.error("[PIPELINE_LOG_FAILED]", JSON.stringify({ stage, message: error.message }));
  }
}
