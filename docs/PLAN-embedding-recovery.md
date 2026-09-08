# 벡터 지식 복구 계획 — 2026-09-08

> 다른 모델·세션이 이 문서만 읽고 작업을 이어받을 수 있게 쓴다. 각 작업의 "위임 브리프"는
> 그대로 프롬프트로 넘겨도 되는 자족 단위다. 진행 상태는 이 문서 맨 아래 표를 갱신한다.

## 0. 한 줄 요약

질의응답이 보는 벡터 코퍼스(`knowledge_chunk` 1,701행)는 **정기보고서 원문의 약 1%도 안 담고 있고,
그 1%마저 시점이 뭉개져 있으며, 정량 테이블 6,410행은 아예 안 보인다.** 원인은 세 겹이다 —
추출 재현율(가장 큼), 임베딩 텍스트에서 빠진 정밀도 필드, 정량 데이터의 검색 경로 부재.

## 1. 확인된 사실 (2026-09-08 운영 DB 읽기 전용 실측)

| # | 사실 | 근거 |
|---|---|---|
| F1 | `knowledge_chunk` 1,701행 = event_fact 751 / article_chunk 598 / headline 340 / daily_report 12. **정량·보고서 원문 유래 0행** | `select source_type, count(*)` |
| F2 | `report_metric` 312행(발췌 100%), `market_financial` 6,098행(발췌 0%, 출처 `eastmoney`). 둘 다 임베딩 0 | 컬럼 조회 |
| F3 | `report_digest` 125건 전부 `embedded_chunks=0`. `REPORT_TEXT_ONLY_EMBEDDING=0`이라 `embedMissingReports`가 `paused_visual_audit`로 즉시 반환 | `lib/curation.js`, `pipeline_log` |
| F4 | 125건 중 `body_original` 보유 5건(반기만). 연차 50건은 0건 | `count(body_original)` |
| F5 | 보고서 107건(URL 보유) 중 **53건이 이벤트 3건 이하**, 20건 이상은 3건. 그 3건이 정확히 최근 처리분 | 보고서별 이벤트 집계 |
| F6 | 완룬 2026 반기: section 앞 12,000자에서 시계열 후보 **28건**, 저장 **3건**(사실 15개를 뭉친 덩어리). 원문에 `2026年N月` 20회인데 저장 3건 전부 `2026-06-30/half` | `docs/` 옆 `wanrun-recall.md`(세션 산출물), 원문 직접 대조 |
| F7 | 임베딩된 이벤트 751건 중 `occurred_precision<>'day'` **532건(70.8%)**. `embedEvents`는 `[시점] YYYY-MM-DD`만 넣고 정밀도·근거를 안 넣는다 | `lib/vector-ingestion.js:126-133` |
| F8 | `digestReport`는 `report.text`가 아니라 `sliceDiscussion()`이 자른 `section`(MD&A+重要事项, ≤60,000자)만 본다. 실측 원문의 12.6~24.6% | `lib/event-backfill.js:230`, `lib/report-reader.js:374` |
| F9 | 완룬 section 30,000~36,000자 구간은 IPO 승낙사항 보일러플레이트. section 안에서도 밀도가 균일하지 않다 | 원문 직접 확인 |
| F10 | `digestReport`가 `returned`/`dropped{badDate,empty}`를 돌려주지만 **어디에도 저장하지 않는다.** `pipeline_log`는 09-06부터라 보고서 대부분의 추출 기록이 없다 | 코드·로그 |
| F11 | `renewReport`(바꿔 넣기 재처리)가 있고 `HEAVY_TASKS` 맨 끝에 배선돼 있는데 **`renewed_at` 채워진 행 0건.** 재처리 대기 107건 | `lib/curation.js:394,598` |
| F12 | `rag_evaluation` 테이블 생성 완료, 0행 | — |
| F13 | **로컬 `.env`·`.env.local`은 플레이스홀더다.** `OPENAI_401`, `SUPABASE_URL` 파싱 실패. 실제 키는 Vercel에만 있어 `vercel env pull .env.local` 전에는 어떤 진단도 로컬에서 못 돈다 | 09-08 probe 실행 |
| F14 | `digestReport`가 조각을 `Promise.all`로 돌려 **조각 하나의 타임아웃이 앞 조각들의 결과까지 통째로 버렸다.** 09-08 수정(`allSettled`). "보고서 절반이 3건 이하"의 원인 후보 | `lib/event-backfill.js`, 커밋 `50739af` |
| F15 | PDF 다운로드·파싱(`readReport`)은 로컬에서 키 없이 정상 동작한다. 완룬 section은 조각 5개로 나뉜다 | 09-08 probe 실행 |

**아직 모르는 것**: F6의 미추출이 (a) LLM이 안 냈는지 (b) 냈는데 `/^\d{4}-\d{2}-\d{2}$/` 검증에서 버려졌는지 (c) 조각별 타임아웃인지. T0.1이 가른다.

## 1.5 사람이 해야 하는 것 (이게 막히면 아래가 전부 막힌다)

| # | 조치 | 막히는 것 | 상태 |
|---|---|---|---|
| U1 | `vercel env pull .env.local` — 로컬에 실제 키를 받는다 | T0.1, T1 검증, T2 재생성. **전부** | ⬜ |
| U2 | `supabase/report-digest-diagnostics.sql`을 SQL Editor에서 실행 | 진단값이 안 쌓인다(파이프라인은 돎) | ⬜ |
| U3 | `supabase/rag-evaluation.sql` 실행 | — | ✅ 09-08 완료 |
| U4 | 결정: `market_financial` 6,098행(발췌 없음, eastmoney)을 RAG 근거로 허용할지 | T4 착수 | ⬜ |
| U5 | T6 기준선 판정 (질문 5개 × 근거 10건) | 개선 전후 비교 근거 | ⬜ |

U1이 최우선이다. 키가 없으면 진단·검증이 전부 추측으로 돌아간다.

## 2. 원칙 (모든 작업 공통)

- LLM 호출은 진단·검증에 최소로 쓴다. 대량 재처리는 야간 훅 예산으로 돌린다.
- 운영 DB DELETE/UPDATE 전에 지울 행을 SELECT로 먼저 본다(CLAUDE.md). 진단 스크립트는 **쓰기 금지**.
- 새 `api/*.js`를 만들지 않는다. 공유 코드는 `lib/`.
- 수정 후 `node --check`, `npm run check`, `scripts/check-*.mjs` 전부, `git diff --check`.
- 프롬프트·상한 같은 "의도"는 회귀 스크립트로 고정한다(`check-fact-granularity.mjs` 방식).
- 확인한 것과 추정한 것을 나눠 보고한다.

## 3. 작업 그래프

```
T0.1 완룬 dry-run 진단 ──▶ T1 추출 수정 ──▶ T3 107건 재처리 ──▶ T5 원문 임베딩 결정
T0.2 진단 컬럼 저장 ─────┘                    (renew 경로 수리 포함)
T2 임베딩 텍스트 보강 ─── 독립, 지금
T4 정량 사전조회 ──────── 독립, 지금 (결정 1건 필요)
T6 rag_evaluation 기준선 ─ 독립, 지금 (T1·T2 전에 찍어야 의미 있음)
```

| 작업 | 선행 | LLM 비용 | 권장 모델 | 산출물 |
|---|---|---|---|---|
| T0.1 | — | ~4회 | Sonnet | `scripts/probe-digest.mjs` 실행 결과 |
| T0.2 | — | 0 | Sonnet | SQL + `curation.js` 3곳 |
| T1 | T0.1 | 5건 dry-run × 전후 ≈ 40회 | **Opus** | 프롬프트·검증·slicer 수정 + 회귀 |
| T2 | — | 751 임베딩(무시할 수준) | Sonnet | `vector-ingestion.js`, 재생성 스크립트 |
| T3 | T1 | ~107×4 ≈ 430회, 야간 | 파이프라인 | `renew` 경로 수리, 며칠 |
| T4 | — | 0 | Opus | `knowledge-search.js` 사전조회 |
| T5 | T3 | 결정 후 | — | `REPORT_TEXT_ONLY_EMBEDDING` 판단 |
| T6 | — | 질문 5개×2 | 사람 | 기준선 수치 |

---

## 4. 위임 브리프

### T0.1 — 완룬 1건 dry-run 재처리로 미추출 원인 가르기

**목표**: 현재 코드로 완룬 2026 반기보고서를 다시 읽었을 때 `returned`/`dropped`/`rows`가 얼마인지 본다. DB에 쓰지 않는다.

**준비돼 있는 것**: `scripts/probe-digest.mjs`(이 계획과 함께 작성됨). `.env`에서 키를 읽고 `digestReport({company, kind:'semiannual', knownUrl, maxEvents:30})`를 호출해 조각별 `returned`, `dropped`, 저장 가능 행, 이벤트 목록(시점·정밀도·제목)을 출력한다.

**선행(U1)**: `vercel env pull .env.local`. 2026-09-08 실행에서 PDF 파싱까지는 갔으나
`OPENAI_401`로 멈췄다. 로컬 `.env`는 플레이스홀더다.

**실행**:
```bash
node scripts/probe-digest.mjs wanrun-new-energy semiannual https://static.cninfo.com.cn/finalpage/2026-08-29/1225524978.PDF
```

출력 JSON의 `verdict`가 판정을 한 줄로 낸다. `per_chunk_returned`(조각별 산출 건수)와
`chunk_errors`(실패한 조각)를 함께 본다. `diagnostics`는 그대로 `report_digest`에 적히는 값이다.

**판정 기준** (결과를 `wanrun-recall.md`의 28건과 대조):
- `rows ≈ 3` → 현재 코드가 재현한다. **T1 필수.** 조각별 `returned`를 보고 프롬프트(적게 냄) vs 검증(많이 버림)을 가른다.
- `rows ≥ 20`, 날짜 명시 사건이 day/month로 나옴 → 완룬은 예전 코드로 처리된 것. T1은 최소로 하고 **T3(재처리)로 직행.**
- `dropped.badDate`가 큼 → LLM이 `2026-03` 같은 형식으로 냄. T1b(정규화) 필요.
- 조각 중 타임아웃 → `Promise.all`이 통째로 실패하는지, 부분 결과가 살아남는지 확인. T1e.

**금지**: `storeEvents`·`writeLedger` 호출 금지. 결과는 stdout과 `outputs/probe-digest-*.json`에만.

### T0.2 — 추출 진단값을 장부에 남긴다

**목표**: 다음부터는 "얼마나 냈고 얼마나 버렸는지"가 로그가 아니라 데이터로 남게 한다.

**변경**:
1. `supabase/report-digest-diagnostics.sql`(신규, 재실행 가능): `report_digest`에 `section_chars int`, `digest_chunks smallint`, `digest_returned smallint`, `digest_dropped_bad_date smallint`, `digest_dropped_empty smallint`, `digest_prompt_version text` 추가. `comment on column`으로 뜻을 적는다.
2. `lib/event-backfill.js` `digestReport`: 반환 객체에 `chunks: chunks.length`, `section_chars: report.section.length` 추가. 조각별 `returned` 배열도 `per_chunk_returned`로.
3. `lib/curation.js`의 `digestCompany`·`runThinReportEnrichment`·`renewReport` 세 곳의 `writeLedger`/PATCH에 위 값을 싣는다. `digest_prompt_version`은 `DIGEST_INSTRUCTIONS`의 sha256 앞 12자(코드에서 계산).
4. 관리자 `개요`·`실행 이력`은 손대지 않는다(범위 밖).

**회귀**: `scripts/check-digest-diagnostics.mjs` 신규 — `digestReport` 반환에 `chunks`·`section_chars`가 있고, 세 저장 경로가 그 값을 PATCH 본문에 싣는지 소스 문자열로 검사. 기존 `check-report-renewal.mjs` 통과 유지.

**주의**: SQL은 사용자가 SQL Editor에서 실행한다. 실행 여부를 확인하기 전에는 코드가 새 컬럼 없이도 죽지 않아야 한다(PostgREST는 없는 컬럼 PATCH에 400을 낸다 → 컬럼 존재를 한 번 조회해 캐시하거나, PATCH 실패 시 진단 필드만 빼고 재시도).

### T1 — 추출 재현율 수정 (T0.1 결과에 따라 하위 항목 선택)

**목표**: MD&A 앞 12,000자에서 후보 28건 중 1건이 아니라 **20건 이상**이 나오게 한다. 시점이 원문에 명시된 사건은 `day`/`month`로 저장된다.

**T1a 프롬프트 (`DIGEST_INSTRUCTIONS`)** — LLM이 적게 낼 때:
- 첫 지시를 "빠짐없이"에서 **작업 순서**로 바꾼다: ① 원문에서 `YYYY年M月`·`M月` 표기가 붙은 문장을 먼저 전부 찾아 각각 한 건으로 낸다(정밀도 day/month) ② 그다음 수치 사실 ③ 그다음 무수치 궤적 사실. 순서를 주면 결산일 뭉치기가 줄어든다.
- "한 건 = 한 사건" 예시를 완룬 원문에서 두 개 넣는다(좋은 예/나쁜 예). 나쁜 예는 현재 저장된 3번 이벤트(4개 사실 뭉침).
- 신제품은 **제품마다** 한 건(황산철나트륨 / 焦磷酸磷酸铁钠 / LMFP / 보리제 각각).
- 합작·JV·공급계약은 상대방 이름을 `title_ko`에 넣는다(`event_fact.counterparty` 추출의 입력이 된다).
- `maxEvents`는 조각당 30 유지. 늘리지 않는다 — 조각을 줄이는 쪽(T1d)이 맞다.

**T1b 날짜 검증 (`digestReport` 루프)** — `dropped.badDate`가 클 때:
- `/^\d{4}-\d{2}-\d{2}$/` 실패 시 버리지 말고 정규화: `YYYY-MM` → `YYYY-MM-01`+`month`, `YYYY` → 보고 기간 말일+`year`, `YYYY년 M월` → 위와 같이. 정규화도 실패하면 그때 `badDate`.
- 버린 건은 `dropped.samples`(최대 5개, 원문 `occurred_at` 값)로 반환해 T0.2가 저장하게 한다.

**T1c section 정리 (`sliceDiscussion`)** — 비용·잡음 절감, T0.1 결과와 무관하게 유효:
- `重要事项` 안의 `承诺事项`·`注N：` 반복 블록(IPO 약속, 동업경쟁 회피, 관련거래 규범)을 제거한다. 완룬 기준 section 48,391 → 약 30,000자, 조각 5 → 3.
- 제거 규칙은 회귀로 고정하고, 제거된 글자 수를 `report_digest.section_chars`와 함께 남긴다.

**T1d 조각 크기** — 조각별 `returned`가 앞 조각에 쏠릴 때: `DIGEST_CHUNK_CHARS` 12,000 → 6,000. 호출 수는 2배지만 T1c가 상쇄한다.

**T1e 부분 실패 보존** — ✅ **T0.2에서 먼저 끝냈다(`50739af`).** `Promise.allSettled`, 조각별 산출 건수, `renewReport`의 `canReplace`에 `partial` 반영까지 완료. T1에서 다시 하지 않는다.

**검증**: 본문 보유 5건(완룬·XTC·파라시스·창위안리커·전화신재료)을 `probe-digest.mjs`로 **수정 전/후** 돌려 `rows`·정밀도 분포·조각별 `returned`를 표로 남긴다. 완룬 ≥20, 다른 4건은 감소하지 않아야 한다. `check-fact-granularity.mjs` 갱신.

### T2 — 임베딩 텍스트에 정밀도·근거·상대방을 넣는다

**목표**: RAG가 `[시점] 2023-12-31`을 날짜로 오독하지 않게 한다. 532건이 대상.

**변경** (`lib/vector-ingestion.js` `embedEvents`):
```
[시점] 2023년 중 (연차보고서 기준 · 원문에 시점 표기 없음)   ← precision=year
[시점] 2024년 상반기 (반기보고서 기준)                          ← precision=half
[시점] 2026년 3월 (원문: 2026年3月)                              ← precision=month
[시점] 2026-01-15                                                ← precision=day
```
- `occurred_basis`가 있으면 괄호 안에 40자 이내로 넣는다.
- `event_fact` 테이블에서 같은 `event_id`의 `counterparty`를 모아 `[상대] A, B`로 넣는다(있을 때만). `EVENT_SELECT`에 `event_fact(counterparty)` 임베드 추가.
- `lib/knowledge-search.js` `INSTRUCTIONS`에 한 줄: "근거의 [시점]이 '연중'·'상반기'·'하반기'면 특정 날짜로 단정하지 않고 그 기간으로 답한다."
- `api/company.js`의 근거 표시에도 정밀도 라벨이 보이는지 확인(이미 보이면 손대지 않음).

**재생성**: `scripts/reembed-events.mjs`(신규) — 이벤트 전량을 `embedEvents`로 다시 넣는다. `content_hash`가 `event:${id}`로 고정이라 `on_conflict=content_hash` upsert가 `content_ko`·`embedding`을 덮어쓴다. DELETE 없음. 실행 전 `select count(*) where source_type='event_fact'`와 실행 후 count가 같아야 한다.

**회귀**: `scripts/check-event-embedding-text.mjs` 신규 — precision별 `[시점]` 문구, counterparty 유무, 그리고 **`[시점] YYYY-MM-DD` 단독 형식이 precision≠day에서 나오지 않음**을 검사.

### T3 — 107건 재처리 (`renew` 경로 수리)

**목표**: T1이 검증된 뒤 재처리 대기 107건을 며칠 안에 소화한다.

**먼저 진단**: `renewed_at`이 0건인 이유. 후보 — (i) `HEAVY_TASKS` 맨 끝이라 차례가 안 옴(40훅÷10태스크=4회/밤인데 0회는 이상) (ii) 매번 타임아웃 → `isTimeoutError`면 `failed`도 안 찍고 조용히 반복 (iii) `pickRenewalReport`가 항상 같은 행을 집음. `pipeline_log`에서 `hop_task='renew'` 행을 세고 payload를 본다.

**수리**:
- 타임아웃 재시도 상한(같은 보고서 3회) 후 `renewal_status='timeout'`으로 표시하고 다음 행으로 넘어간다.
- `renew`를 `embed_report` 앞으로 옮기거나, `runCurationHop`이 대기 건수 비율로 태스크를 고르게 한다(단순 라운드로빈이 아니라).
- `canReplace` 하한(3건, 옛 건수의 50%)은 유지. T1 후 새 읽기가 20건대면 자연히 통과한다.

**모니터링**: 매일 `select renewal_status, count(*) from report_digest group by 1`. `renewed_text_only`가 하루 4건 이상 늘어야 한다.

### T4 — 정량 데이터 구조화 사전조회

**목표**: "CATL 2019년 영업이익"처럼 DB에 답이 있는 질문을 임베딩이 아니라 SELECT로 답한다. LLM 0회.

**변경** (`lib/knowledge-search.js`):
- `parseMetricQuestion(question)` — 회사(`companyAliases`), 지표(`DOMAIN_SYNONYM_GROUPS`에 있는 매출/영업이익/순이익/출하량/생산능력 등 → `report_metric.metric`/`market_financial.metric` 키), 기간(`2019`, `2024년 상반기`, `2023Q3`, `최근 3년`)을 정규식으로 뽑는다. 셋 중 회사+지표가 잡히면 발동.
- `lookupMetrics()` — `report_metric` 우선, 없으면 `market_financial`. 최대 12행.
- `searchKnowledge()` 반환 배열 앞에 `source_type='metric_row'` 가짜 청크로 붙인다. `content_ko`는 "CATL 2019년 영업이익 XX억 위안(원문: …) — 출처 …" 형식. `report_metric`은 `excerpt`+`source_url`, `market_financial`은 `[제공자 집계값 · 발췌 없음] eastmoney 손익표, report_date`.
- `INSTRUCTIONS`에 "[제공자 집계값] 근거는 원문 발췌가 없으므로 답변에 그 등급을 밝힌다" 추가.
- `retrieval` 통계에 `metric_rows` 추가. 관리자 `벡터 검색 시험`·`RAG 평가 → 검색 정밀도`에 칩 `정량` 표시.

**결정 필요(사용자)**: `market_financial`(발췌 없음)을 근거로 허용할지. 계획은 "등급 표시 후 허용"을 전제로 쓴다. 불허면 `report_metric`만.

**파생 계산(이익률·CAGR)은 하지 않는다.** 저장된 `yoy_pct`만 그대로 낸다.

**회귀**: `scripts/check-metric-lookup.mjs` — 질문 파싱 표(회사×지표×기간 12케이스), 발췌 없는 행의 등급 라벨, 회사 못 잡으면 발동 안 함.

### T5 — 보고서 원문 임베딩 켤지 결정 (T3 후)

T3 재파싱이 `visual_pages`를 채우면 "이미지 도표 있는 보고서 비율"이 나온다. 그 숫자를 보고 `REPORT_TEXT_ONLY_EMBEDDING=1` 여부와 `completeness_warning` 문구를 정한다. **지금 켜지 않는다** — 본문 없는 120건은 재다운로드가 필요하고, 그건 T3와 같은 작업이다.

### T6 — 기준선 측정 (지금, T1·T2 배포 전에)

`/admin → RAG 평가 → 검색 정밀도`에서 아래 5개 질문을 던지고 근거 10건씩 판정한다. T1·T2 배포 후 같은 질문을 다시 판정해 `집계`에서 비교한다.

1. 완룬신에너지 나트륨이온 정극재 개발 현황
2. CATL 2019년 영업이익
3. 룽바이 LFP 증설 계획
4. 파라시스 2026년 상반기 신규 고객
5. 전고체 배터리 양산 시점 (회사 필터 없음)

---

## 5. 진행 상태

| 작업 | 상태 | 막는 것 | 갱신 |
|---|---|---|---|
| T0.1 | 스크립트 준비 완료. **실행이 U1에 막힘** (`OPENAI_401`) | U1 | 09-08 |
| T0.2 | ✅ 완료 (`50739af`). SQL은 U2 대기 | — | 09-08 |
| T1e | ✅ 완료 (T0.2에 포함) | — | 09-08 |
| T1 | 미착수 | T0.1 | |
| T2 | 미착수. 코드는 키 없이 쓸 수 있고 재생성만 U1 필요 | (부분) U1 | |
| T3 | 미착수 | T1 | |
| T4 | 미착수 | U4 | |
| T5 | 보류 | T3 | |
| T6 | 미착수 | U1·사람 | |

### 다음 사람이 바로 할 수 있는 것

1. U1이 끝났으면 **T0.1 실행** → `verdict`를 보고 T1 범위를 정한다.
2. U1을 기다리는 동안 **T2 코드 작성**(`lib/vector-ingestion.js` `embedEvents`에 시점 정밀도·근거·상대방 추가 + 회귀). 재생성 스크립트는 쓰되 실행은 U1 뒤로 미룬다.
3. U4 결정이 나면 **T4**는 LLM 호출 0회라 언제든 시작할 수 있다.

### 손대면 안 되는 것

- `lib/compare-report.js`, `app/app.js`는 다른 세션이 작업 중일 수 있다. 커밋 전 `git status`로 확인한다.
- `market_financial`·`report_metric`·`knowledge_chunk`에 DELETE/UPDATE를 돌리지 않는다. T4는 읽기만 한다.
- `REPORT_TEXT_ONLY_EMBEDDING`을 지금 켜지 않는다(T5, 근거 미확보).
