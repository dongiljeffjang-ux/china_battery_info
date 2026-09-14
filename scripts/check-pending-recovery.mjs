import assert from "node:assert/strict";
import fs from "node:fs";
import { MAX_FETCH_ATTEMPTS, retryIsDue, retryPlan } from "../lib/pending-recovery.js";

const now = new Date("2026-09-14T00:00:00.000Z");
const first = retryPlan(0, now);
assert.equal(first.attempts, 1);
assert.equal(first.status, "processing_failed");
assert.equal(first.nextProcessingAt, "2026-09-14T01:00:00.000Z");
assert.equal(retryIsDue({ processing_status: "processing_failed", next_processing_at: first.nextProcessingAt }, now), false);
assert.equal(retryIsDue({ processing_status: "processing_failed", next_processing_at: first.nextProcessingAt }, new Date(first.nextProcessingAt)), true);
const exhausted = retryPlan(MAX_FETCH_ATTEMPTS - 1, now);
assert.deepEqual(exhausted, { attempts: 3, status: "retry_exhausted", nextProcessingAt: null });
assert.equal(retryIsDue({ processing_status: null }, now), true);
assert.equal(retryIsDue({ processing_status: "robots_disallowed" }, now), false);

const ingest = fs.readFileSync(new URL("../api/ingest-rss.js", import.meta.url), "utf8");
assert.match(ingest, /const BACKLOG_PER_RUN = 4;/, "과거 미시도 기사는 매 회차 4건씩 복구한다");
assert.match(ingest, /processing_status=is\.null&source_tier=neq\.official_disclosure/, "종료 상태·공시는 과거 뉴스 복구 큐에 섞지 않는다");
assert.match(ingest, /stageName === "recover"/, "수집 실패 뒤 본문 전용 복구 단계를 실행한다");
assert.match(ingest, /chainStage\(request, "recover", 1/, "크론 수집 실패가 복구 홉을 예약한다");
console.log("pending recovery regression checks passed");
