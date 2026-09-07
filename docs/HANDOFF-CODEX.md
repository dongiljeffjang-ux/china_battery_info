# Codex → Claude Code 인수인계

> **2026-09-07 밤 갱신 — Reshine bootstrap 구현·배포 완료. 실제 실행 검증은 아직.**
>
> 아래 C절 계획대로 구현해 커밋 `1b1459b`(`main`)까지 푸시했다. 사용자 요청으로 검색 기간은
> 계획한 180일이 아니라 **365일**로 넓혔다(단독 그룹이라 요청 수는 늘지 않는다).
>
> - `lib/china-sources.js`: `buildSearchGroups(provider, pilot, bootstrapCompanyIds)`가 bootstrap
>   대상을 일반 묶음에서 빼고 회사당 단독 그룹(`windowDays=365`)으로 낸다. 후보 기사에
>   `bootstrap: true`가 붙는다.
> - `api/ingest-rss.js`: `bootstrapCompanyIds()`가 `article_company` 연결 0건인 회사만
>   (`reshine`, `kaijin-new-energy`) 매 실행 다시 계산한다(읽기 전용, 기사 1건만 생겨도 다음 실행부터
>   빠짐). bootstrap 후보는 `source_tier=web_search_bootstrap_<provider>`로 저장. 파일럿(3사 검증)은
>   bootstrap을 켜지 않는다. `selectHeadlineTop10()`이 3일 창과 별도로 bootstrap 기사 최대 2건을 뽑아
>   본문대조까지 보낸다(news/bootstrap 중복은 article id로 dedupe).
> - `scripts/check-search-plan.mjs`에 회귀 4종 추가(단독 그룹·365일 창·일반 그룹 미중복·기본 호출 불변).
>   19개 회귀 스크립트·`npm run check`·`git diff --check` 모두 통과.
>
> **다음에 확인할 것**: 09-07 23:00 크론(또는 사용자가 직접 누르는 수집 버튼) 이후 Supabase에서
> Reshine·Kaijin의 `article`/`article_company`/`event`를 확인한다. 특히
> `source_tier=web_search_bootstrap_*`가 저장만 되고 Top 10(`pipeline_log`의 `process` 단계 로그)에서
> 빠지지 않았는지, 연결되면 다음 실행부터 `bootstrap_ids`가 그 회사를 뺐는지(`collect` 로그) 본다.
> 이 검증은 **아직 하지 않았다.** 아래 수동 백필로 채운 것은 `event`이지 `article`이 아니므로
> bootstrap 수집 경로는 여전히 두 회사 모두에 켜져 있다(정상).
>
> ## 같은 날 이어서 — 3년치 시계열 수동 백필과 그 과정에서 드러난 결함 2개
>
> 사용자 요청은 "다른 회사는 2023년 이후 연차보고서가 다 반영돼 있으니 Reshine 같은 회사도 3년치를
> 축적해 임베딩하고 싶다"였다. 비상장사는 정기보고서가 없어 `backfillCompanyEvents()`(웹 검색 1회)로
> 채우는 경로가 이미 있었고(`lib/curation.js`의 `pickDueWebBackfill`, `WEB_BACKFILL_SINCE="2023-01-01"`,
> 90일 주기), 그것을 수동으로 한 번 당겨 실행했다. 그 과정에서 결함 두 개를 찾아 고쳤다.
>
> | 커밋 | 내용 |
> |---|---|
> | `952c336` | 관리자 수동 `?backfill=`·`?digest=` 경로가 LLM 호출에 `timeoutMs`를 안 넘겨 기본값(웹 검색 35초)에 걸려 있었다. 유지 훅은 이미 60·85초로 고쳐져 있었는데 이 경로만 빠져 있었다. 함수 한도가 300초이므로 200초를 준다 |
> | `ac83ef3` | 웹 백필 결과의 한국어 강제. 프롬프트에 필드 이름을 짚어 다시 못박고, **서버가** `title_ko`·`fact_ko`에 한글이 없으면 그 건을 버린다(`dropped.notKorean`). `scripts/check-backfill-korean.mjs` 추가 |
>
> ### 진단 기록 (같은 실수를 반복하지 않기 위해)
>
> - **타임아웃**: 200초로 고친 뒤에도 실패해 "고쳤는데 왜 안 되나"로 보였다. `pipeline_log`의 실패 시각
>   (07:42:46 UTC)과 `vercel inspect`의 배포 생성 시각(07:41:49 + 빌드 17초)을 맞춰 보니 요청이
>   **정확히 35초 만에** 끊겼다. 200초가 적용됐다면 불가능한 시각이므로 그 요청은 별칭이 새 배포로
>   넘어가기 직전 옛 배포로 들어간 것이었다. 배포 별칭이 안정된 뒤 재시도하니 통과했다.
>   **교훈: 배포 직후 재시도는 배포 별칭이 실제로 새 배포를 가리키는지 확인하고 한다.**
> - **한국어**: 첫 Reshine 실행이 12건을 저장했는데 `title_ko`·`fact_ko`·`original_excerpt_ko`가 전부
>   중국어 원문이었다. 전체 문제인지 세어 보니 `event` 712건 중 중국어 제목은 그 12건뿐이었고
>   다른 `web_backfill` 49건은 정상이었다. 즉 상시 결함이 아니라 그 호출에서 모델이 목록 가운데
>   한 줄짜리 한국어 지시를 무시한 것이다. 프롬프트만 고치면 재발하므로 서버 가드를 같이 넣었다.
>
> ### 운영 DB에 직접 한 일
>
> - 중국어로 저장된 Reshine `event` 12건을 삭제했다(`knowledge_chunk` 12개 cascade, `event_fact` 0건).
>   지우기 전에 대상 12건과 파생 행 수를 SELECT로 확인했고, 그 12건이 DB 전체의 중국어 이벤트
>   전부와 일치함을 확인했다. 먼저 있던 한국어 2건(09-03 생성)은 청크까지 그대로 두었다.
> - 삭제 후 수정본 배포 상태에서 두 회사를 다시 실행했다. 결과: Reshine `returned=11 inserted=11`,
>   Kaijin `returned=12 inserted=12`, 양쪽 다 `dropped.notKorean=0`.
>
> ### 지금 상태 (2026-09-07 밤, 확인함)
>
> | 회사 | event | 한글 없는 행 | 기간 | 연도별(23/24/25/26) |
> |---|---|---|---|---|
> | Reshine | 13 | 0 | 2023-01-28 ~ 2026-07-22 | 2 / 4 / 2 / 5 |
> | Kaijin | 14 | 0 | 2023-01-01 ~ 2025-12-31 | 5 / 5 / 4 / 0 |
>
> 인수인계 B절이 "빠져 있다"고 지목한 Reshine 사실 세 가지가 모두 들어왔다 — 2026-06-29 IPO 접수
> (37.8억 위안), 2026-07-22 질의 단계 진입, 란저우 인산철리튬 10만 톤.
>
> **남은 문제 하나 (아직 안 고침)**: Kaijin은 `returned=12`로 `BACKFILL_MAX_EVENTS=12` 상한에 정확히
> 닿았고 2026년 건이 0이다. 상한이 실제로 구속력을 갖고 있으므로 2026년 소식이 잘렸을 가능성이 높다
> (Reshine은 11 < 12라 구속력이 없었다). 유지 훅은 연도별로 따로 호출(연당 10건)하므로 며칠 밤이면
> 자연히 채워진다. 급하면 이 수동 경로의 상한을 올리거나 연도별로 쪼개 병렬 호출하도록 바꾼다.
>
> ---
>
> **2026-09-07 최신 추가 사항 — Reshine 수집 공백을 다음 작업의 최우선으로 둔다.**
>
> 이 절은 아래의 예전 인수인계보다 최신이다. (구현 완료 상태는 위 갱신 참고.) 작업 트리는 깨끗하고,
> `main`에는 아래 두 커밋까지 푸시·Vercel Production 배포가 완료됐다.
>
> | 커밋 | 상태 | 내용 |
> |---|---|---|
> | `7e7156c` | 배포 완료 | 교차검증의 `corrected_pass`를 버리지 않고 보수적 수정본으로 저장 |
> | `b2104f0` | 배포 완료 | `occurred_at='2026-09'` 같은 부분 날짜를 `2026-09-01`로 정규화해 event 적재 실패 방지 |
>
> ## A. 방금 운영에서 검증한 것
>
> 1. 수동 수집·분석 1회를 실행했다. 이번 코호트의 결과는 본문대조 통과 4건,
>    `corrected_pass` 1건, 기각 1건이었다. `corrected_pass`가 실제로
>    `source_tier=openai_deepseek_corrected`로 저장된 것을 Supabase에서 확인했다.
> 2. 그 수정 통과 기사(샨샨 인조흑연 가격)는 event 저장 단계에서 모델이 `occurred_at='2026-09'`를
>    반환해 PostgreSQL date 오류가 났다. 기사 본문대조 결과 자체는 보존됐지만
>    `processing_status=processing_failed`가 남았다. `b2104f0`이 이후 실행을 고쳤다.
>    **이미 실패한 이 한 건은 pending이 아니므로 자동 재처리되지 않는다.** 후속 작업자는 배포 뒤
>    안전한 재처리 경로(기사 상태를 무작정 UPDATE하지 말 것)를 마련하거나 event를 검증해 보완해야 한다.
> 3. Youshan은 검증 기사 0→1건이 됐다. Hithium 4건, SVOLT 4건은 유지됐다.
>    Reshine과 Kaijin은 검증 기사가 아직 0건이다.
>
> ## B. Reshine 공백의 확인된 원인 (추측 아님)
>
> Reshine에 기사가 없는 것이 아니다. 외부 검색으로 아래의 최근·직접 기사를 확인했다.
>
> - 2026-06-29 창업판 IPO 접수, 37.8억 위안 조달 계획과 LFP 50만 톤 증설
> - 2026-07-22 IPO `已问询`(질의 단계) 전환
> - 난퉁 기지 삼원계 20.26만 톤, 란저우 LFP 10만 톤 생산능력 관련 보도
>
> 근거 URL(Claude Code에서도 브라우저로 열어 확인 가능):
>
> - https://www.stcn.com/ipo/detail/3777.html
> - https://news.smm.cn/live/detail/103986980
> - https://finance.sina.com.cn/roll/2026-07-02/doc-inifmfcu5895386.shtml
>
> 코드·운영 데이터로 확인한 원인은 세 가지다.
>
> 1. `lib/china-sources.js`의 `discoverWebSearchNews()`가 모든 회사에 **최근 3일**만 검색한다.
>    위 핵심 기사는 6~7월 것이므로 후보가 될 수 없다.
> 2. Reshine은 `listed: false`라 `cninfo` 수집기가 없다. 상장사 공시를 받는 우회 경로도 없다.
> 3. 별칭 매칭은 원인이 아니다. `金川瑞翔`, `甘肃金川瑞翔`, `瑞翔新材`, `湖南瑞翔`,
>    `南通瑞翔`, `Jinchuan Reshine`, `Reshine`가 이미 등록돼 있고, 발견된 후보는 연결될 수 있다.
>
> 추가로, Reshine은 OpenAI에서는 `reshine,youshan`, DeepSeek에서는
> `wanrun-new-energy,lopal,reshine` 묶음에 들어간다. 단독 검색이 아니므로 작은 비상장사가
> 그룹의 결과 상한에 밀릴 위험도 있다. DeepSeek은 그룹당 회사별 검색을 한 번만 하라는 프롬프트와
> 3개 기사 상한을 같이 받는다.
>
> ## C. 다음 구현 순서 (사용자가 “진행하자”라고 승인했고, 이번에는 중단 요청으로 실제 변경 전 멈춤)
>
> 목표는 Reshine·Kaijin처럼 **기사가 0건인 비상장 핵심사만** 처음 한 번 과거 기사를 확보하고,
> 평상시에는 지금의 최근 3일 수집 비용으로 돌아가게 하는 것이다.
>
> 1. `api/ingest-rss.js`에서 `article_company`를 읽어 bootstrap 후보
>    (`reshine`, `kaijin-new-energy`) 중 연결 기사가 0건인 ID만 계산한다. 읽기 전용 쿼리다.
>    raw 기사 1건만 생겨도 반복 과거 검색은 멈추도록 한다.
> 2. `lib/china-sources.js`의 `buildSearchGroups()` / `plannedSearchRequests()` /
>    `discoverWebSearchNews()`에 `bootstrapCompanyIds`를 전달한다. bootstrap 대상은 일반 묶음에서
>    빼고 **단독 검색**, 기간은 180일로 한다. 일반 회사는 현재의 3일·그룹 크기를 그대로 유지한다.
>    `api/news.js`의 공개 조회는 비용 폭증을 막기 위해 bootstrap을 켜지 않는다.
> 3. bootstrap 검색에서 나온 후보에는 `bootstrap: true`를 붙이고,
>    `api/ingest-rss.js`는 `source_tier=web_search_bootstrap_<provider>`로 저장한다.
>    `selectHeadlineTop10()`은 기존 최근 3일 Top 10과 별도로 bootstrap 기사 최대 1~2건을 골라
>    실제 본문대조까지 보내야 한다. 이 단계를 빼면 6~7월 기사는 DB에만 쌓이고 화면에는 여전히 없다.
> 4. `scripts/check-search-plan.mjs`에 다음 회귀 조건을 추가한다.
>    - bootstrap 회사가 provider별 단독 그룹이며 `windowDays=180`
>    - 일반 그룹에는 bootstrap ID가 중복되지 않음
>    - 기본 호출(bootstrap 없음)의 기존 그룹·예산은 유지
>    - `plannedSearchRequests(...bootstrapIds)`와 실제 그룹 수가 일치
> 5. `node --check api/ingest-rss.js`, `node --check lib/china-sources.js`,
>    `npm run check`, 모든 `scripts/check-*.mjs`, `git diff --check`를 돌린다.
> 6. `main` 푸시 후 Vercel Ready를 확인하고, **사용자가 직접 수집 버튼을 한 번 실행**하게 하거나
>    정상 크론을 기다린다. 실행 후 Supabase에서 Reshine의 article/article_company/event를 각각 확인한다.
>    특히 `web_search_bootstrap_*`가 저장만 되고 Top 10에서 누락되지 않았는지 확인한다.
>
> 범위를 넓혀 SZSE IPO 공식 문서 전용 수집기를 새로 만드는 것은 다음 단계다. 먼저 위 180일 단독
> 백필로 실제 기사 확보·본문대조가 되는지 검증한다. 새 API 파일을 만들기 전에는 CLAUDE.md의
> Vercel 함수 수 가드레일을 따른다.

# Claude → codex 인수인계

마지막 갱신: 2026-09-07 밤 (커밋 `d4861b5`까지 + 대화 중 SQL 작업·수동 백필 2회, 커밋 없음)

이 문서는 **가장 최근 세션의 변경과 다음에 할 일**만 모은다. 이전 세션(509fb25까지)의 상세 구조 설명은
git 히스토리와 `docs/HANDOFF.md`에 남아 있다. 지침은 `CLAUDE.md` 하나이며 `AGENTS.md`는 그 포인터다.

## 0. 지금 상태 한 줄

이번 세션 주제는 이 파일 위쪽 "Codex → Claude Code" 절의 **Reshine 수집 공백**이었다. 두 갈래로 메웠다.
(1) 뉴스 수집 자체를 365일 단독 검색으로 넓히는 **bootstrap 경로**(배포됐지만 실전 미검증),
(2) 3년치 시계열 `event`를 웹 백필로 즉시 채우는 **수동 실행**(완료, Supabase에서 직접 확인함).
`main`은 `d4861b5`까지 푸시·Vercel Production 배포 완료. 운영 DB에는 이 세션에서 새 SQL을 적용하지
않았다(4번 참고).

## 1. 이 세션의 커밋 (오래된 순)

| 커밋 | 내용 |
|---|---|
| `1b1459b` | bootstrap 뉴스 수집: 검증 기사 0건 회사만 일반 3일 그룹에서 빼 회사당 단독 365일 검색 |
| `3eb40af` | 문서 갱신 |
| `952c336` | 관리자 수동 `?backfill=`/`?digest=` 경로가 LLM `timeoutMs`를 안 넘겨 기본값(35초)에 걸리던 버그 수정. 200초로 |
| `ac83ef3` | 웹 백필 결과 한국어 강제. 서버가 `title_ko`/`fact_ko`에 한글이 없으면 저장 전 버린다(`dropped.notKorean`) |
| `d4861b5` | 문서 갱신 |

**커밋 없이 대화 중 실행한 것** (재현 가능, 코드 변경 아님):
- Reshine `event` 중 중국어로 저장된 12건을 SELECT로 확인 후 DELETE(`knowledge_chunk` cascade 12건,
  `event_fact` 0건). 대상 12건이 DB 전체의 중국어 이벤트 전부와 일치함을 먼저 확인했다.
- `952c336`+`ac83ef3` 배포 뒤 `POST /api/ingest-rss?backfill=reshine&since=2023-01-01`,
  `?backfill=kaijin-new-energy&since=2023-01-01` 재실행(관리자 로그인 브라우저에서 GET으로 실행 가능).
- Kaijin은 `since=2023-01-01` 호출이 `BACKFILL_MAX_EVENTS=12` 상한에 정확히 닿아 2026년 몫이 0건이라,
  `?backfill=kaijin-new-energy&since=2026-01-01`을 한 번 더 실행해 2026년 6건을 추가로 채웠다.

## 2. 구조적으로 바뀐 것

### 2.1 뉴스 수집 bootstrap — 배포됐지만 실전 미검증

목표: Reshine·Kaijin처럼 **검증 기사가 0건인 비상장 핵심사**만 뉴스 수집 자체를 365일까지 넓혀 처음
한 번 과거 기사를 찾고, 연결되는 순간 평소의 3일 수집으로 자동 복귀시킨다.

- `api/ingest-rss.js`의 `bootstrapCompanyIds()`가 매 수집 실행마다 `article_company` 연결 0건인
  후보(`reshine`, `kaijin-new-energy`)만 읽기 전용으로 계산한다. 기사 1건만 연결돼도 다음 실행부터 빠진다.
- `lib/china-sources.js`의 `buildSearchGroups(provider, pilot, bootstrapCompanyIds)`가 bootstrap 대상을
  일반 셀/양극재/음극재 그룹에서 빼고 회사당 **단독 그룹**(`windowDays: 365`)으로 낸다. 일반 회사의
  3일 창·그룹 크기는 그대로다. 파일럿(3사 검증)·`api/news.js`(공개 조회)는 bootstrap을 켜지 않는다.
- bootstrap 후보는 `source_tier=web_search_bootstrap_<provider>`로 저장되고,
  `selectHeadlineTop10()`이 이 태그가 붙은 기사를 3일 창과 별도로 최대 2건 뽑아 본문대조까지 보낸다
  (news/bootstrap 중복은 article id로 dedupe).
- 검사: `scripts/check-search-plan.mjs`에 4개 회귀(단독 그룹·365일 창·일반 그룹 미중복·기본 호출 불변).

**미검증 이유**: 이 경로는 "기사"를 찾아 파이프라인 전체(본문대조까지)를 태우는 것이라 야간 크론이
한 번 돌아야 결과를 볼 수 있다. 이번 세션에서는 대신 아래 2.2의 "이벤트 직접 백필"로 3년치를
당장 채웠으므로, bootstrap이 실제로 기사를 찾아오는지는 09-07 23:00 KST 크론 이후 확인해야 한다.
`pipeline_log`의 `collect` 단계에서 `bootstrap_ids`를, `process` 단계에서 `web_search_bootstrap_*`
기사가 Top 10에 실제로 들어갔는지 본다.

### 2.2 수동 백필 timeout 버그 — 유지 훅엔 있던 수정이 관리자 경로엔 없었다

`lib/curation.js`의 야간 유지 훅은 이미 `WEB_LLM_TIMEOUT_MS`(60초)·`REPORT_LLM_TIMEOUT_MS`(85초)를
`backfillCompanyEvents`/`digestReport`에 넘긴다. 그런데 관리자가 직접 치는 `?backfill=`/`?digest=`
경로(`api/ingest-rss.js`의 `runBackfill`)는 `timeoutMs`를 아예 넘기지 않아 LLM 제공자 기본값
(웹 검색 35초)에 걸려 있었다. Reshine 수동 백필이 이걸로 두 번 실패했다. `MANUAL_LLM_TIMEOUT_MS=200000`을
새로 두고 두 호출 모두에 넘긴다(함수 한도 300초 안).

**진단 메모**: 200초로 고친 첫 재시도도 실패했는데, `pipeline_log` 실패 시각과 `vercel inspect`의
새 배포 생성 시각을 맞춰 보니 요청이 **정확히 35초 만에** 끊겼다 — 배포 별칭이 새 배포로 넘어가기
직전 옛 배포(고치기 전 코드)로 들어간 것이었다. 배포 후 재시도는 별칭이 실제로 새 배포를 가리키는지
(`npx vercel inspect <alias>`) 먼저 확인하고 한다.

### 2.3 웹 백필 결과의 한국어 강제 — 프롬프트만으로는 안 지켜졌다

Reshine 첫 실행(12건)이 `title_ko`·`fact_ko`·`original_excerpt_ko`를 전부 중국어 원문 그대로 돌려줬다.
`event` 712건 전체를 세어 보니 중국어 제목은 그 12건뿐이고 기존 `web_backfill` 49건은 정상이었다 —
상시 결함이 아니라 그 호출에서 모델이 목록 가운데 한 줄짜리 한국어 지시를 무시한 것이다. 프롬프트만
고치면 재발할 수 있어 두 가지를 같이 했다.

- `lib/event-backfill.js`의 `INSTRUCTIONS`에 필드 이름(`title_ko`·`fact_ko`·`original_excerpt_ko`)을
  짚어 "중국어·영어 원문을 그대로 옮기면 그 건은 버려진다"고 재차 못박았다.
- **서버가** `hasKorean()`으로 `title_ko`/`fact_ko`에 한글이 한 글자도 없으면 저장 전에 버린다
  (`dropped.notKorean`). `original_excerpt`(원문 발췌)는 검사하지 않는다 — 중국어가 정상이다.
- 검사: `scripts/check-backfill-korean.mjs` 신규.

## 3. 운영 DB에 직접 한 일

- Reshine `event` 12건(중국어로 저장된 것 전부) 삭제. 지우기 전 대상 12건 = DB 전체 중국어 이벤트
  전부(다른 회사 영향 없음)임을 SELECT로 확인했고, 파생 `knowledge_chunk` 12개는 `on delete cascade`로
  같이 지워졌다(`event_fact` 0건이라 해당 없음). 먼저 있던 한국어 2건(09-03 생성)은 그대로 두었다.
- 삭제 후 수정본 배포 상태에서 Reshine·Kaijin을 다시 실행해 한국어로 채웠다(6번 "지금 수치" 참고).
- **이전 세션(2.5절 언급) 이후로 이번 세션에서 새로 건드린 운영 DB 변경은 위가 전부다.** Farasis 보증
  표 금액 수정 등 그 이전 세션의 DB 작업은 이미 적용된 채로 유지되고 있다(재확인만 함, 재작업 없음).

## 4. Supabase SQL 적용 상태 — 변화 없음

이번 세션에서 새 SQL을 추가하지 않았다. 이전 세션까지의 적용 상태(`report-renewal.sql`,
`report-synthesis.sql`, `company-entity.sql`, `report-visual-quality.sql` 전부 적용됨)는 그대로 유효하다.

## 5. 다음에 할 일 (우선순위 순)

1. **[미검증] bootstrap 뉴스 수집이 실제로 기사를 찾아오는지 확인.** 09-07 23:00 KST 크론(또는 수동
   수집 실행) 이후 `pipeline_log`에서 `collect` 단계의 `bootstrap_ids`, `process` 단계에서
   `source_tier=web_search_bootstrap_*` 기사가 Top 10에 실제로 들어갔는지 본다. 이번 세션에서 채운
   3년치 `event`와는 별개 경로라 서로 방해하지 않지만, 이 확인 없이는 bootstrap이 실전에서 동작하는지
   모른다.
2. **Reshine·Kaijin이 유지 훅(`pickDueWebBackfill`, 90일 리프레시)의 정상 순환에 들어갔는지 확인.**
   이번 세션에서 채운 3년치는 수동 실행 결과라 `report_digest` 원장(`kind='web'`)에 기록이 남았는지
   (남아야 유지 훅이 90일 안에 또 검색해 중복 API 비용을 쓰지 않는다) 확인이 필요하다.
3. (이전 세션 미결, 유효함) **표 오독 잔여 문제.** 여러 줄로 감싼 셀이 y좌표 묶기에 흩어지는 것(R&D 표,
   헤더 행). 지금은 그런 표를 문장으로 펴지 않고 파이프 그대로 두어 피해를 막고만 있다. 제대로
   고치려면 열 x좌표 군집화로 표를 복원해야 한다.
4. (이전 세션 미결, 유효함) **사업 관계망 화면.** 설계 합의는 `docs/HANDOFF.md` "2026-09-08 방향" 절에
   있다. 재료가 아직 얇다.
5. (이전 세션 미결, 유효함) **공시 원문 임베딩(`report_chunk`)이 0건.** `REPORT_TEXT_ONLY_EMBEDDING=1`을
   켜야 도는데, 표 후처리가 좋아졌으니 켤지 다시 판단한다.
6. (이전 세션 미결) 약관 기반 매체 허용 목록(미착수), 벡터 검증 2단계
   (`docs/VECTOR-VERIFICATION-PLAN.md` 3절).

## 6. 지금 수치 (2026-09-07 밤, 확인함)

| 회사 | event | 한글 없는 행 | 기간 |
|---|---|---|---|
| Reshine | 13 | 0 | 2023-01-28 ~ 2026-07-22 |
| Kaijin | 20 | 0 | 2023-01-01 ~ 2026-05-29 |

인수인계 위쪽 B절이 "빠져 있다"고 지목한 Reshine 사실 세 가지가 모두 들어왔다 — 2026-06-29 IPO 접수
(37.8억 위안), 2026-07-22 질의 단계 진입, 란저우 인산철리튬 10만 톤. Kaijin도 CATL 핵심 공급사,
구톈 20만 톤 프로젝트, 2025년 말 생산능력 59만 톤 등이 들어왔다.

이전 세션 수치(전사 `event` 694건 등)는 이 두 회사분(합계 33건 순증)이 반영되지 않은 값이니, 전사
수치가 필요하면 다시 센다.

## 7. 검증 명령

```bash
npm run check
for f in scripts/check-*.mjs; do node $f; done
git diff --check
```

회귀 스크립트가 **20개**로 늘었다(`check-backfill-korean.mjs` 신규). 모두 네트워크 없이 돈다.
`node --check`는 구문만 보므로 `npm run check`(api 모듈 실제 import)를 함께 돌린다.

## 8. 주의 — 이번 세션에서 배운 것

- **배포 직후 재시도는 배포 별칭이 실제로 새 배포를 가리키는지 먼저 확인한다.** 200초 timeout 수정을
  배포한 직후 재시도가 여전히 35초 만에 실패해 "고쳤는데 왜 안 되나"로 보였다. `pipeline_log` 실패
  시각과 `vercel inspect <alias>`의 배포 생성 시각을 맞춰 보니 요청이 별칭 전환 직전 옛 배포로 들어간
  것이었다. `npx vercel inspect china-battery-lens.vercel.app`으로 현재 별칭이 가리키는 배포와 생성
  시각을 먼저 보고 재시도한다.
- **프롬프트의 한국어 지시는 한 번만 적으면 묻힌다.** 웹 백필 프롬프트에 "출처에 명시된 사실만
  한국어로 쓴다"가 이미 있었는데도 모델이 12건 전부 중국어로 냈다. 목록 가운데 한 줄이 아니라 필드
  이름을 짚어 다시 못박고, **서버가 결과를 검사해 강제하는 장치를 항상 같이 넣는다** — 이 저장소가
  근거 등급(`timeline_eligibility`)을 서버가 정하는 것과 같은 원칙이다.
- **Vercel Sensitive 환경변수는 `vercel env pull`로 실제 값을 받을 수 없다.** `CRON_SECRET`·
  `APP_ACCESS_KEY`가 대시보드에서 Sensitive로 표시돼 있어 CLI가 `[SENSITIVE]` placeholder만 준다.
  프로덕션 인증이 필요한 일회성 작업은 관리자 로그인 브라우저에서 URL을 직접 열게 하는 것이 유일한
  경로다(이 프로젝트의 `?backfill=`처럼 GET으로도 동작하는 엔드포인트는 주소창에 붙여넣기만 하면 된다).

(이전 세션이 남긴 "제약의 존재와 구속력을 구분하라" 같은 진단 규칙은 `CLAUDE.md`에 있으므로 여기
반복하지 않는다.)
