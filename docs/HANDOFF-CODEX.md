# Codex → Claude Code 인수인계

> **2026-09-08 갱신 — 기업 질의응답에 하이브리드 검색 도입. 커밋·SQL 적용 완료, 배포·화면 확인 남음.**
>
> ## 무엇을 왜
>
> 기업 페이지의 근거 인용 질의응답(`api/company.js` `runAsk` → `lib/knowledge-search.js`
> `answerFromKnowledge`)이 임베딩 코사인 단일 경로였다. `SW-2413` 같은 코드·모델명·정확한 수치는
> 임베딩이 주변 문맥에 녹여 버려 상위 k에 들어오지 못한다. 의미 검색(기존)과 단어 검색(신규)을
> 나란히 돌려 RRF(Reciprocal Rank Fusion)로 순위를 합치는 구조로 바꿨다. 하이브리드는 후보를
> 좁히는 장치가 아니라 넓히는 장치다 — 검색기당 10건 → 합집합 후보 최대 20건 → 프롬프트 10건.
>
> ## 무엇을 바꿨나
>
> - `supabase/hybrid-search.sql` (신규, **운영 DB에 적용 완료**): `pgroonga` 확장,
>   `knowledge_chunk.search_text` 생성 컬럼(`content_ko + original_excerpt + content_original`),
>   `TokenBigramSplitSymbolAlphaDigit` 토크나이저 인덱스, `lexical_knowledge_chunks()` RPC.
> - `lib/knowledge-search.js`: `buildLexicalQuery()`(질문 토큰화 → 불용어 제거 → 조사 변형 OR
>   확장 → 연산자 문자 차단), `fuseByRrf()`(k=60, 가중치 0.5/0.5), `searchKnowledge()`가 두
>   검색기를 `Promise.allSettled`로 병렬 실행하고 **독립적으로 실패**한다(아래 참고).
>   `MATCH_COUNT`(프롬프트에 넣는 근거 수)는 `ANSWER_SCHEMA`의 `used_sources` 상한과 같아야
>   하고, 회귀가 이 등식을 검사한다.
> - `api/company.js`: `[KNOWLEDGE_ASK]` 로그에 `retrieval` 통계(`vector_matched`,
>   `lexical_matched`, `candidates`, `overlapped`, `*_available`) 추가.
> - `app/app.js`·`app/styles.css`: 근거마다 `의미+단어` / `단어 검색` / `의미 검색` 칩, 하단에
>   융합 통계 문구. 의미 검색이 끊긴 경우와 단어 검색 색인이 없는 경우를 다른 문구로 구분.
> - `scripts/check-hybrid-search.mjs` (신규): 합집합·겹침 보너스가 가중치로 안 뒤집힘·연산자
>   삽입 차단·양방향 물러남(단어 검색 404 / 임베딩 429 / 둘 다 실패) 회귀. 26개 회귀 스크립트,
>   `npm run check`, `git diff --check` 모두 통과.
> - 커밋 `e6b772e`(`main`, **아직 push 안 함** — 배포는 사용자 승인 대기).
>
> ## 왜 Kiwi가 아니라 PGroonga인가 (측정 기반 정정 포함)
>
> 처음에 "`content_ko`에 한국어·중국어가 섞여 있다"를 표본 1건(`article_chunk`)만 보고
> 단정했는데, 사용자가 "번역된 한국어 아니냐"고 되물어 실제 분포를 셌더니 절반만 맞았다.
>
> | source_type | 행 | 한글 | 한자 | 30자↑ 중국어 덩어리 |
> |---|---|---|---|---|
> | `event_fact` | 749 | 43% | 1% | 0 |
> | `article_chunk` | 598 | 13% | 29% | 79 |
> | `headline` | 340 | 34% | 15% | 36 |
> | `original_excerpt`(컬럼) | 1064 | 0% | 65% | — |
>
> `event_fact`는 사실상 순수 한국어다. 다만 기본 검색 풀(헤드라인 제외 1359행)의 44%인
> `article_chunk`는 한자가 한글의 2배가 넘고 `original_excerpt`는 한글 0%라, 한국어 전용
> 분석기는 여전히 절반을 놓친다. 더 중요한 이유는 이 검색이 건져야 하는 게 형태소가 아니라
> 부서지지 않은 코드·모델명·고유명사이고, kiwi 모델(58.7MB, 공식 ONNX 빌드 없음)을 Vercel
> 함수에 실을 이유도 없다는 것이다.
>
> **LLM 회계**(사용자의 "최대한 LLM 안 쓰는 방향" 요구): 단어 검색은 Postgres 안에서 끝나 외부
> 호출이 0이다. 이 기능의 외부 호출은 질문 임베딩(OpenAI) 1회와 답변 생성(LLM) 1회 그대로다.
> 처음 구현에서 임베딩 실패 시 단어 검색이 멀쩡해도 전체를 throw하던 것을 고쳤다 — 이제 두
> 검색기가 독립 실패하고, 한쪽만 살아 있으면 그것으로 답하며, 둘 다 죽었을 때만 오류를 올린다.
>
> **리랭킹(bge-reranker-v2-m3)은 검토 후 보류했다.** 568M 크로스인코더(safetensors 2.27GB,
> ONNX 빌드 없음)라 Vercel에 못 싣고 호스팅 API(외부 호출 1회 추가, 질문당 ~$0.0003)만
> 가능한데, 회사별 청크가 중앙값 35건(32개사 중 28곳이 60건 이하)이라 "넓게 뽑기"가 사실상
> 전수 조회가 된다. 코퍼스가 회사당 수백 건대로 쌓이면 재검토할 만하다. 사용자 판단으로 구현
> 안 함(코드 변경 없음).
>
> ## 운영 DB에서 확인한 것 (읽기 전용 검증, 파괴적 작업 없음)
>
> - `pgroonga` 3.2.5, `search_text` 컬럼, 인덱스, RPC 네 가지 모두 설치 확인.
> - 색인 재현율이 `LIKE` 원문 대조와 정확히 일치: `NCM` 4/4, `811`(문자열 안 숫자 조각) 2/2,
>   `NCM811`은 코퍼스에 원래 없어 0/0(색인 문제 아님).
> - 점수 변별력 확인(30건 중 6.0/5.0/4.0 세 구간, 동점 아님).
> - `search_text` 추가로 테이블 용량 +1.4MB(1,699행 기준). 무시할 수준.
>
> ## 다음에 확인할 것
>
> 1. **배포 여부를 사용자에게 확인 후 push.** push하면 Vercel이 `main`을 배포한다.
> 2. 배포된 기업 페이지에서 질문을 던져 하단에 "의미 검색 N건 + 단어 검색 M건 …" 문구와
>    근거별 `단어 검색`/`의미+단어` 칩이 실제로 뜨는지 확인(이 부분은 SQL·RPC 단위로만
>    검증했고 앱을 통한 전체 경로는 아직 안 봤다).
> 3. `lexical_matched`가 계속 0으로 로그에 남으면 `buildLexicalQuery()`가 그 질문에서 빈
>    문자열을 냈거나(불용어만 남음) RPC 권한 문제다.
> 4. 재현율이 지나치면(무관한 근거가 단어 검색으로 많이 들어오면) `LEXICAL_WEIGHT`를 낮추거나
>    `QUESTION_STOPWORDS`를 넓힌다. 반대로 놓치는 게 많으면 `KO_SUFFIX_*` 조사 목록을 넓힌다.

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

마지막 갱신: 2026-09-08 (커밋 `aad96ee`까지, Production 배포 확인)

## 2026-09-08 후속 검증 — 관리자 게이트와 크론 체인

### 관리자 입장 코드 게이트: 정상 (코드 변경 없음)

- 쿠키를 보내지 않은 `GET https://china-battery-lens.vercel.app/api/access`는 실제 Production에서
  **401 `access_required`**를 반환했다.
- 관리자 페이지가 게이트 없이 열린 기존 Chrome/in-app 탭은 이전에 발급된 `cbl_access` HttpOnly
  쿠키를 재사용한 상태였다. `document.cookie`가 비어 보이는 것은 HttpOnly 쿠키의 정상 동작이라
  쿠키 부재의 근거가 아니다.
- 따라서 `app/access-gate.js`의 GET 확인 → 폼 표시, `api/access.js`/`api/admin.js`의
  `isAccessAllowed`/`requireAccess` 경로는 Production에서 의도대로 동작한다.

### 크론 유지 훅: 실전 로그에서 체인 깊이 부족을 발견해 수정·배포

- 2026-09-07 23:19~23:29 KST 크론 로그는 collect → process 훅 1~6 → daily까지 수행했으나,
  이어진 curate는 `depth: 5`, `message: "chain depth cap"`으로 skipped였다. 즉 유지 훅은 실제로
  돌지 않았고, Reshine·Kaijin의 90일 웹 백필 순환도 이 실행으로는 검증되지 않았다.
- 원인: 본문 처리의 `MAX_PROCESS_HOPS=6`가 60~90초짜리 훅을 여러 내부 호출로 이어 Daily 직전에
  체인 깊이를 4까지 썼다. Daily가 curate를 넘길 때 Vercel이 금지하는 다섯 번째 내부 호출이 됐다.
- `aad96ee`는 야간 본문 처리 상한을 2회로 낮춰 collect → process → daily → curate가 깊이 3 안에서
  끝나게 하고, `scripts/check-chain-depth.mjs`에 이 불변조건을 추가했다. `npm run check`,
  `scripts/check-*.mjs` 20개, `git diff --check`가 통과했고, Vercel Production Ready와 별칭 연결을
  확인했다.
- **다음 확인**: 다음 23:00 KST 크론 뒤 `pipeline_log`에서 `curate`의 `skipped/depth cap`이 아닌
  실제 훅 기록이 남았는지, Reshine·Kaijin web 원장이 90일 재실행 대상에서 빠졌는지 확인한다.

이 문서는 **가장 최근 세션의 변경과 다음에 할 일**만 모은다. 이전 세션(509fb25까지)의 상세 구조 설명은
git 히스토리와 `docs/HANDOFF.md`에 남아 있다. 지침은 `CLAUDE.md` 하나이며 `AGENTS.md`는 그 포인터다.

## 0. 지금 상태 한 줄

이번 세션은 세 가지를 했다. **주제 1**은 이 파일 위쪽 "Codex → Claude Code" 절의 **Reshine 수집
공백**으로, 두 갈래로 메웠다 — (1) 뉴스 수집 자체를 365일 단독 검색으로 넓히는 **bootstrap 경로**
(배포됐지만 실전 미검증), (2) 3년치 시계열 `event`를 웹 백필로 즉시 채우는 **수동 실행**(완료,
Supabase에서 직접 확인함). **주제 2**는 사용자가 스크린샷을 보고 지적한 화면 다듬기 다수 —
기업 비교 카드(연도 그룹 대비·버튼 폭·색), 상단바(만든이 표시·disclaimer, 활성 탭 밑줄→파스텔
알약, 로고 단어별 색), 근거 검색 옵션 배치 — 로, 전부 코드는 작지만 배포·브라우저 확인까지 끝났다.
**주제 3**은 관리자 페이지(`/admin`) 입장 코드 게이트를 사용자가 요청해 코드를 확인한 것인데,
**결론까지 가지 못하고 멈췄다** — 5번 1항 참고. `main`은 `24e2d92`까지 푸시·Vercel Production 배포
완료. 운영 DB에는 이 세션에서 새 SQL을 적용하지 않았다(4번 참고).

## 1. 이 세션의 커밋 (오래된 순)

| 커밋 | 내용 |
|---|---|
| `1b1459b` | bootstrap 뉴스 수집: 검증 기사 0건 회사만 일반 3일 그룹에서 빼 회사당 단독 365일 검색 |
| `3eb40af` | 문서 갱신 |
| `952c336` | 관리자 수동 `?backfill=`/`?digest=` 경로가 LLM `timeoutMs`를 안 넘겨 기본값(35초)에 걸리던 버그 수정. 200초로 |
| `ac83ef3` | 웹 백필 결과 한국어 강제. 서버가 `title_ko`/`fact_ko`에 한글이 없으면 저장 전 버린다(`dropped.notKorean`) |
| `d4861b5` | 문서 갱신 |
| `8b00430` | 문서 갱신(이 절을 이번 세션 기준으로 재작성) |
| `7efa8a9` | 기업 시계열의 연도 대그룹(`.digest-year`)에 회색 밴드+왼쪽 굵은 선을 넣어 그 안의 보고서/월별 줄과 구분 |
| `d070fcf` | 비교 화면 "비교 리포트 생성" 버튼을 A·B 픽커 행과 같은 폭으로 늘림(`flex:1`), 처음엔 진한 파란 채움으로 |
| `adde7ce` | 위 버튼 색을 진한 파랑 → 파스텔(연한 하늘 배경 + 파란 글자, 기존 태그 톤과 통일)로 톤다운. 사용자가 배포 후 "색이 너무 진하다"고 되돌려 달라 함 |
| `a49c7de` | 문서 갱신 |
| `16f2b19` | 상단바 "데이터 기준" 라벨 아래에 "만든이 장동일 · 정보 제공용이며 투자 판단의 근거로 사용할 수 없습니다" 한 줄 추가. `app.js`/`admin.js`가 그 영역 전체를 `textContent`로 덮어쓰고 있어 동적 텍스트를 안쪽 `#as-of-text`/`#admin-asof` span으로 분리 |
| `0dfbf14` | "수집된 근거에 물어보기" 옵션 두 개가 `.ask-head`의 `justify-content:space-between`(자식 3개 기준) 때문에 화면 양끝까지 흩어져 있던 것을 제목 옆으로 붙임 |
| `adb30be` | 상단 탭 활성 표시를 밑줄 → 파스텔 알약(배경)으로 교체. `.topbar nav`에 `align-items:center`를 줘 링크가 topbar 전체 높이로 늘어나 배경이 기둥처럼 보이는 것을 막음 |
| `7aaae1f` | 로고 "China Battery Lens"를 Arial로, 단어별로 다른 색(초안: 시장·기술·양호 축 색) |
| `24e2d92` | 위 로고 색을 사용자가 지정한 빨강(China)·초록(Battery)·파랑(Lens)으로 다시 바꿈(`--alert`/`--good`/`--blue`) |

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

### 2.4 화면 UI 다듬기 — 사용자 스크린샷·구두 요청 기반 (배포·확인 완료)

`app/styles.css`(+ `app/index.html`, `app/admin.html`, `app/app.js`)만 건드린 순수 프런트엔드 변경
7건. `app/*.css`는 회귀 스크립트 대상이 아니라서 매번
`preview_start`(launch.json의 `ledger-preview`, 저장소 루트를 정적 서빙)로 임시 미리보기 HTML을
`app/` 밑에 만들어 브라우저로 렌더링을 직접 확인한 뒤 지우고 커밋했다. 실제 앱은 `/api/*`가 있어야
데이터가 뜨므로, 정적 서버로는 마크업만 그대로 복제한 스니펫을 봐야 한다.

- **연도 그룹 대비** (`.digest-year`): 기업 시계열 화면에서 "2026년" 같은 연도 대그룹과 그 안의
  "2026년 상반기"/"2026-05" 같은 보고서·월별 줄이 둘 다 흰 배경이라 구분이 안 갔다. 연도 summary에
  `background:var(--band)`(연한 회색)와 `border-left:3px solid var(--ink)`를 줘 바깥쪽 그룹임을
  분명히 했다.
- **비교 버튼 폭**: 기업 비교 화면에서 A/B 픽커 카드는 화면 폭을 꽉 채우는데 그 아래 "비교 리포트
  생성" 버튼은 내용 크기만큼만 좁게 떠 있었다. `.compare-actions-row #compare-report{flex:1 1 240px}`로
  같은 행의 "보조 데이터 포함" 체크박스는 그대로 두고 버튼만 남은 폭을 채우게 했다.
- **비교 버튼 색**: 폭을 늘리면서 처음엔 `background:var(--blue)`(진한 파랑)+흰 글자로 존재감을 줬는데,
  배포 후 사용자가 "너무 진하다"고 해 `background:var(--pale)`(연한 하늘)+`color:var(--blue)`로
  톤다운했다. 이 저장소가 이미 쓰는 pastel 태그(`sector-tag`, `summary-cat`)와 같은 톤이다.
- **만든이 표시·disclaimer**: 상단바 "데이터 기준 ..." 라벨 아래에 "만든이 장동일 · 정보 제공용이며
  투자 판단의 근거로 사용할 수 없습니다" 한 줄을 추가했다. `app.js`의 `updateAsOf()`와 `admin.js`가
  그 영역 전체를 `textContent`로 갈아치우고 있어서, 그대로 뒀으면 데이터 새로고침마다 이 문구가
  사라졌을 것이다 — 동적 텍스트만 안쪽 `#as-of-text`(index)/`#admin-asof`(admin) span으로 분리하고
  disclaimer는 그 형제 span(`.site-credit`)에 고정했다.
- **근거 검색 옵션 배치**: "수집된 근거에 물어보기" 아래 체크박스 두 개가 `.ask-head`의
  `justify-content:space-between`(자식이 제목 블록 포함 3개라 균등 분산됨) 때문에 화면 양끝까지
  흩어져 있었다. `space-between`을 빼 제목 옆에 붙게 했다.
- **상단 탭 활성 표시**: 밑줄(`border-bottom`) → 파스텔 알약(배경)으로 바꿨다. `.nav-link`가
  `.topbar nav`(`display:flex`)의 기본 `align-items:stretch`로 topbar 전체 높이(76px)까지 늘어나 있어,
  그 상태로 배경만 넣으면 알약이 아니라 세로로 긴 기둥이 된다 — `.topbar nav{align-items:center}`를
  같이 줘 링크가 텍스트 크기만큼만 차지하게 만든 다음에 배경·둥근 모서리를 입혔다.
- **로고 색**: "China Battery Lens"를 Arial로, 단어별로 다른 색으로 나눴다. 처음엔 임의로 시장·기술·
  양호 축 색(파랑·황토·초록)을 썼는데, 사용자가 곧바로 빨강(China)·초록(Battery)·파랑(Lens)을
  지정해 그 값으로 다시 바꿨다(`--alert`/`--good`/`--blue` 재사용). **최종 값은 사용자가 명시한
  이 색이다** — 임의로 다른 배색으로 되돌리지 않는다.

주의: `app/styles.css`에는 `:root` 토큰 정의가 **두 벌**이다(파일 앞쪽 기본 팔레트, 39번째 줄 즈음
"IEA 스타일 디자인 레이어" 주석 아래 두 번째 `:root`). 두 번째가 나중에 로드돼 실제로 이긴다 —
`--navy`가 `#10365f`가 아니라 `#000000`, `--blue`가 `#1674c5`가 아니라 `#0044FF`... 처럼 값이 다르니,
색을 확인·수정할 때는 반드시 파일 뒤쪽(두 번째 `:root`와 그 아래 오버라이드)까지 보고 실제 적용 값을
확인한다. 이번 세션에서도 처음엔 앞쪽 블록만 보고 색을 골랐다가 실제 렌더링에서 다르게 나와 다시 봤다.

### 2.5 관리자 페이지 입장 코드 게이트 — 조사만 하고 결론 못 냄 (다음 세션이 마무리)

사용자가 "관리자페이지 접근시 입장코드 입력하도록 변경"을 요청했다. 코드를 읽어 보면 **이미 구현돼
있다**: `app/admin.html`의 `#access-gate` 폼(`app/access-gate.js`가 `/api/access` GET으로 세션 쿠키
확인 → 없으면 폼 표시 → POST로 `accessKey` 검증 → `issueAccessCookie`)과 `api/admin.js`의
`requireAccess(request, response)`가 이미 붙어 있고, `app/index.html`도 동일한 게이트를 공유한다
(`APP_ACCESS_KEY` 하나로 메인 사이트·관리자 모두 보호). `vercel.json`의 `/admin → app/admin.html`
리라이트도 정상이다.

그런데 이 세션의 Browser pane으로 쿠키 없이(라고 생각하고) `https://china-battery-lens.vercel.app/admin`을
열었더니 **게이트 없이 곧바로 데이터가 떴다**(수집 기사 703건 등). `document.cookie`로는 아무것도
안 보였지만(그 쿠키는 `HttpOnly`라 JS로는 원래도 안 보인다), 네트워크 탭에서 `/api/access`가 200을
반환했다 — 즉 **이 브라우저 프로필에 예전 세션에서 발급된 유효한 `cbl_access` 쿠키가 남아 있었을
가능성이 크다**(HttpOnly라 지워지지 않는 한 재사용된다). 여기서 확인을 마치지 못하고 사용자가 다른
요청으로 대화를 돌렸다.

**다음 세션이 마무리할 것**: 쿠키를 완전히 비운 상태(시크릿 창, 또는 이 Browser pane이면 새 탭 그룹을
만들거나 쿠키를 지운 뒤)에서 `/admin`에 접속해 실제로 게이트가 뜨는지 확인한다.
- 게이트가 뜨면: 기존 구현이 이미 정상 동작하는 것이므로 **코드 변경 없이 "이미 돼 있다"고 사용자에게
  확인만 시켜 주면 된다.**
- 게이트가 안 뜨면(정말 버그): `lib/access.js`의 `isAccessAllowed()`(APP_ACCESS_KEY 존재 여부·서명
  비교)부터 의심하고, Vercel Production에 `APP_ACCESS_KEY`가 실제로 설정돼 있는지
  (`npx vercel env ls` — 값 자체는 Sensitive라 못 보지만 존재 여부는 보인다) 확인한다.

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

1. **[사용자 요청, 조사만 함] 관리자 페이지 입장 코드 게이트를 쿠키 없는 상태에서 검증.** 2.5절 참고.
   구현은 이미 있어 보이지만 이 세션에서 결론을 내지 못했다 — 다음 세션의 첫 번째 일로 처리한다.
2. **[미검증] bootstrap 뉴스 수집이 실제로 기사를 찾아오는지 확인.** 09-07 23:00 KST 크론(또는 수동
   수집 실행) 이후 `pipeline_log`에서 `collect` 단계의 `bootstrap_ids`, `process` 단계에서
   `source_tier=web_search_bootstrap_*` 기사가 Top 10에 실제로 들어갔는지 본다. 이번 세션에서 채운
   3년치 `event`와는 별개 경로라 서로 방해하지 않지만, 이 확인 없이는 bootstrap이 실전에서 동작하는지
   모른다.
3. **Reshine·Kaijin이 유지 훅(`pickDueWebBackfill`, 90일 리프레시)의 정상 순환에 들어갔는지 확인.**
   이번 세션에서 채운 3년치는 수동 실행 결과라 `report_digest` 원장(`kind='web'`)에 기록이 남았는지
   (남아야 유지 훅이 90일 안에 또 검색해 중복 API 비용을 쓰지 않는다) 확인이 필요하다.
4. (이전 세션 미결, 유효함) **표 오독 잔여 문제.** 여러 줄로 감싼 셀이 y좌표 묶기에 흩어지는 것(R&D 표,
   헤더 행). 지금은 그런 표를 문장으로 펴지 않고 파이프 그대로 두어 피해를 막고만 있다. 제대로
   고치려면 열 x좌표 군집화로 표를 복원해야 한다.
5. (이전 세션 미결, 유효함) **사업 관계망 화면.** 설계 합의는 `docs/HANDOFF.md` "2026-09-08 방향" 절에
   있다. 재료가 아직 얇다.
6. (이전 세션 미결, 유효함) **공시 원문 임베딩(`report_chunk`)이 0건.** `REPORT_TEXT_ONLY_EMBEDDING=1`을
   켜야 도는데, 표 후처리가 좋아졌으니 켤지 다시 판단한다.
7. (이전 세션 미결) 약관 기반 매체 허용 목록(미착수), 벡터 검증 2단계
   (`docs/VECTOR-VERIFICATION-PLAN.md` 3절).
8. **[낮음] UI 다듬기 7건은 전부 배포됐고 로컬 스니펫 미리보기로 확인했다.** 그중 비교 버튼의
   폭 변경만 사용자가 실제 배포 화면에서 직접 봤고(색은 두 번 조정 요청받아 최종 파스텔로 확정),
   나머지(연도 그룹 대비·만든이 표시·근거 검색 옵션 배치·탭 알약·로고 색)는 사용자가 실제 배포에서
   본 적은 없다 — 다음에 화면을 열 때 깨진 곳이 없는지만 눈으로 한 번 확인하면 된다.

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
- **`app/styles.css`의 `:root` 토큰은 두 벌이고 뒤엣것이 이긴다** (2.4절 참고). 색을 바꾸기 전에
  파일 뒤쪽 "IEA 스타일 디자인 레이어" 블록의 실제 값을 먼저 확인한다. 앞쪽 블록만 보고 고치면
  의도한 색과 다르게 렌더링된다.
- **CSS만 바꾼 화면 작업은 회귀 스크립트가 안 잡는다.** `scripts/check-*.mjs`는 `lib/`·`api/`
  로직만 본다. UI 변경은 `preview_start`(`ledger-preview`)로 `app/` 밑에 임시 HTML을 만들어 마크업을
  복제해 브라우저로 직접 렌더링을 보고, 커밋 전에 그 임시 파일을 지운다 — 실제 앱은 `/api/*` 없이는
  데이터가 안 뜨므로 화면 전체가 아니라 건드린 컴포넌트만 스니펫으로 확인하면 된다.

(이전 세션이 남긴 "제약의 존재와 구속력을 구분하라" 같은 진단 규칙은 `CLAUDE.md`에 있으므로 여기
반복하지 않는다.)
