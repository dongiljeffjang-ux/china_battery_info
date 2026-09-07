# 2026-09-07 ~ 09-08 작업 인수인계 (Claude → codex)

이 문서는 이틀간의 변경을 한 곳에 모은 것이다. 세부 경위는 `docs/HANDOFF.md`의 같은 날짜 절에
있고, 각 항목의 커밋 메시지에 원인·근거가 적혀 있다. 지침은 `CLAUDE.md` 하나이며 `AGENTS.md`는
그 포인터다.

## 0. 지금 상태 한 줄

- `main` 최신 커밋까지 Vercel에 배포됐다. 마지막 배포 커밋: `a43c516`.
- 운영 DB(Supabase)에 적용한 SQL: `supabase/ingestion-guard.sql`, `supabase/report-embedding-ledger.sql`.
  (`headline-knowledge.sql`은 codex가 09-06에 적용.)
- **다음 확인 항목이 남아 있다** → 4절.

## 1. 커밋 목록 (오래된 순)

| 커밋 | 내용 |
|---|---|
| d406ff6 | 검색 요청을 회사 단위로 쪼갬, 파일럿이 Daily를 덮어쓰지 않게, 원문 캡처는 실패 시에만, 캐시 버스터 |
| eb4a168 | 임베딩 백로그가 500건 밖 이벤트를 놓치던 사각지대 제거(페이지 순회) |
| 857cc98 | 검색 예산을 실제 그룹 수에서 계산(`plannedSearchRequests`, `searchBudgetFor`) |
| cb6793d | DeepSeek 요청당 기사 상한을 회사당 1건으로, 묶음 3곳 |
| bdead28 | 벡터 검증 계획 `docs/VECTOR-VERIFICATION-PLAN.md` |
| ef49463 | 기각·재시도 상한 경로에서 언론 기사 원문 삭제(누수 7건 정리) |
| 888f5ed | 기사 한국어 번역본 보관, 공시 전문 임베딩(이어받기), 사건 시점 재확인 훅 |
| 8383999 | robots.txt 확인·요청 간격, 공시 `extractPdfText().text` 버그, 공시 45일 창 |
| 4c1aa8d | Google News RSS 447건 삭제, 관리자 "파이프라인" 메뉴, 프롬프트 상수 export |
| 7ea853d | `extractMissingFacts`를 유지 훅에 연결(그동안 미연결) |
| fb7a145 | 백필 버튼 툴팁 갱신 |
| 1a39b78 | 연차보고서 표를 좌표로 복원, 헤더 붙여 청킹(`pageToLines`, `chunkStructuredText`) |
| 1d09723 | 추출 호출 분량을 남겨 훅이 60초를 넘지 않게 |
| a708e95 | 유지 훅을 "한 훅에 무거운 단계 하나"로 재구성, `pendingWork()` |
| c3acec1 | 첫 배치 무조건 실행, 유지 훅 예산 50초, pdfjs 워커 번들 포함 |
| a43c516 | pdfjs 워커 경로를 존재 확인 후 선택, `[PDF_WORKER]` 로그 |

## 2. 구조적으로 바뀐 것

### 수집
- 검색 묶음: OpenAI 회사 4곳, DeepSeek 3곳. 예산은 `plannedSearchRequests()` + 여유 4.
- DeepSeek 기사 상한 회사당 1건(최소 2, 최대 6). 검색 원문 캡처는 실패 시에만.
- 파일럿(`?pilot=1`)은 Daily를 만들지 않는다.
- 기사 본문 읽기 전 `lib/robots.js`가 robots.txt 확인, 도메인당 1.5초 간격, 24시간 캐시.

### 본문 처리
- 공시 PDF: `extractPdfText()`가 `{text,pages}`를 돌려주는데 `String()`으로 감싸던 버그 수정.
  이것이 공시가 한 번도 분석되지 않던 진짜 원인이었다.
- 공시 후보 창 45일, 실행당 4건 별도 몫(`DISCLOSURE_WINDOW_DAYS`, `DISCLOSURE_PER_RUN`).
- 사건 시점: `occurred_at`은 발행일이 아님을 프롬프트에 명시, `occurred_basis`/`occurred_precision`/`retrospective` 수집.
- 언론 기사: 원문은 지우고 한국어 번역 문단을 `article_chunk`에 보관(`lib/article-translation.js`).
- 기각·재시도 상한 도달 시 `body_original` 삭제(공시 제외).

### 유지 훅 (`lib/curation.js` `runCurationHop`)
- **한 훅에 무거운 단계 하나.** 훅 번호로 순환:
  `facts → embed_report → embed_article → embed_headline → redate_article → concepts`
- 값싼 `embedMissingEvents`는 매 훅. 보고서 읽기·웹 백필·보강은 예산 남을 때 한 건.
- 체인 계속 여부는 `pendingWork()`(큐마다 한 행 존재 확인, LLM 없음).
- 훅 예산 `CURATE_BUDGET_MS`=50초(수집·본문 처리는 42초 유지). 추출 호출 상한 40초, 첫 배치는 무조건.
- 새로 연결된 단계: `extractMissingFacts`(사업 관계), `redateMissingArticleEvents`(시점 재확인).

### 보고서 원문
- `pageToLines()`: y좌표로 행, x 간격 6pt로 셀. 숫자 있고 간격 2회 이상인 줄만 파이프.
- `chunkStructuredText()`: 표 행을 쪼개지 않고 청크마다 헤더 재부착. 보고서·기사 번역 임베딩이 사용.
- `embedReportChunks()`: 전문 대상, 훅당 120조각, 진행은 `report_digest.embedded_chunks/embedded_total`.
- pdfjs 워커: `loadPdfjs()`가 존재하는 워커 파일을 골라 `workerSrc` 지정, `vercel.json functions.includeFiles`로 번들 포함.

### 관리자
- `/admin#pipeline`: 소스·프롬프트·단계·보관 정책. `lib/pipeline-manifest.js`가 실행 모듈에서 import.
- 프롬프트 상수 export 위치는 `docs/HANDOFF.md` 09-07 밤 절의 표.

## 3. 운영 DB에 직접 한 일

- `knowledge_chunk`에서 `event_fact` 7건을 잘못 삭제했다가(중복 오판) 백로그 페이지 순회 수정으로 자동 복구되게 함. **교훈은 `CLAUDE.md` 가드레일에 적었다.**
- 언론 기사 `body_original` 누수 7건 삭제.
- DOMMatrix로 실패한 공시 39건 상태 초기화(재시도 대상).
- `verification_status=pending`인데 기각인 5건을 `rejected`로.
- Google News RSS 기사 447건 + 회사 연결 491건 삭제(파생 데이터 0 확인 후).
- BYD 2세대 블레이드 이벤트 시점을 2026-09-04 → 2026-03-05로 수정(웹 검색 확인).
- `ingestion_guard` 잔여 claim 행 정리.

## 4. 다음에 확인할 것 (우선순위 순)

1. **백필 1회 실행 결과.** 사용자가 버튼을 누르면 `pipeline_log` `stage='curate'`에서:
   - `duration_ms` < 60000 인지 (한도).
   - `payload.hop_task`가 순환하는지.
   - `facts.events > 0` 인지 (0이면 예산 로직 재점검).
   - `digest`/`enrich`에 `fake worker` 오류가 없는지. Vercel 로그의 `[PDF_WORKER]`에서 `chosen`이 null이 아닌지.
   - `embed_report.embedded > 0`, `knowledge_chunk` `report_chunk` 생성 여부. 청크 본문에 `项目 | 2025年 | …` 같은 헤더가 붙어 있는지 눈으로 확인.
2. **CATL 2024 연차보고서 보강.** `report_digest` `catl` `2025-03-14` 행의 `enriched_at`이 채워지고 `events_inserted`가 4에서 늘었는지.
3. **사업 관계 데이터 축적.** `event_fact` `counterparty is not null` 건수. 25건(09-08 11:30) → 회사당 상대방 분포를 보고 관계망 화면 설계 시작. 설계 합의는 `docs/HANDOFF.md` "2026-09-08 방향" 절.
4. 공시 처리 재시도 39건이 `body_too_short`가 아니라 실제로 분석되는지(`evidence_kind='disclosure'` 이벤트 생성).
5. 미결: 교차검증 기각 시 검증자 수정본 채택(보류), 약관 기반 매체 허용 목록(미착수), 벡터 검증 계획 1단계 실행(미착수).

## 5. 검증 명령

```bash
npm run check
for f in scripts/check-*.mjs; do node $f; done
git diff --check
```
회귀 스크립트 9개 모두 네트워크 없이 돈다. `scripts/restore-missing-event-chunks.mjs`는 `--env-file=.env`가 필요하나 로컬 `.env` 값이 마스킹돼 있어 로컬 실행은 안 된다.
