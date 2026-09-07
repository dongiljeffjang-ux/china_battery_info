# Codex → Claude Code 인수인계

> **2026-09-07 최신 추가 사항 — Reshine 수집 공백을 다음 작업의 최우선으로 둔다.**
>
> 이 절은 아래의 예전 인수인계보다 최신이다. 구현은 아직 시작하지 않았다. 작업 트리는 깨끗하고,
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

마지막 갱신: 2026-09-07 저녁 (커밋 `509fb25`까지)

이 문서는 **가장 최근 세션의 변경과 다음에 할 일**만 모은다. 세부 경위는 `docs/HANDOFF.md`의 같은 날짜
절에, 각 항목의 근거는 커밋 메시지에 있다. 지침은 `CLAUDE.md` 하나이며 `AGENTS.md`는 그 포인터다.
이 문서는 `docs/HANDOFF-2026-09-08-CLAUDE.md`(그 앞 세션의 인수인계)를 대체하지 않고 이어받는다.

## 0. 지금 상태 한 줄

`main`이 `509fb25`까지 푸시·배포됐고, 운영 DB SQL은 모두 적용돼 있다.
**아직 아무도 확인하지 못한 것: 09-07 23:00 KST 크론이 처음으로 유지 훅을 끝까지 도는지.**
그 결과 점검은 09-08 08:00에 뜨는 예약 작업(`china-battery-lens-nightly-check`)이 맡는다.

## 1. 이 세션의 커밋 (오래된 순)

| 커밋 | 내용 |
|---|---|
| `9874cb9` | `digestReport`가 `parse_quality`·`visual_pages`·`source_sha256`을 호출자에게 넘기도록 수정. 안 넘겨서 이미지 도표 완전성 표시가 모든 보고서 경로에서 무력화돼 있었다 |
| `46f7746` | 유지 훅 체인 재설계(508 회피), 함수 한도 300초 명시, 비교 리포트 함의 종합 기능, 벡터 1단계 검증 |
| `db2f6fb` | `report-synthesis.sql` 적용 기록 |
| `9907b20` | "발췌 300자 상한이 원인"이라는 앞선 진단을 데이터로 반증하고 정정 |
| `35a6f3b` | 비교 화면 A·B 선택창 좌우 확장, A/B 색을 아래 비교표와 맞춤, 기본 선택 변경 |
| `01068bb` | 사실 추출 단위를 "같은 문장에서 나온 수치"로 쪼갬. `DIGEST_MAX_EVENTS` 14→30 |
| `531da63` | `core` 등급은 거래소 공시에만. 모델이 아니라 서버가 등급을 정한다 |
| `509fb25` | 표 후처리(붙은 셀 분리·단위 주석·행 문장화), 갱신을 바꿔 넣기로 |

## 2. 구조적으로 바뀐 것

### 2.1 유지 훅 체인과 함수 한도 — 전제가 틀렸었다

세 가지를 운영 로그와 Vercel 문서로 확인했다.

1. **함수 한도는 60초가 아니라 300초다.** 이 프로젝트는 Fluid compute가 기본이고, `api/*.js` Node 함수는
   `export const config = { maxDuration }` 형식만 읽는다. 그동안 쓰던 `export const maxDuration = 60`은
   **무시돼** 왔다. 78~110초짜리 훅이 죽지 않고 로그까지 남긴 이유다.
2. **체인이 4훅에서 끊긴 원인은 508 Loop Detected다.** 배포가 자기 자신을 이어 부르는 체인은 훅 소요와
   무관하게 예외 없이 4훅에서 멈췄다(09-06~07 실행 전부).
3. **야간 크론의 유지 단계는 한 번도 돌지 않았다.** 크론 체인이 수집 → 본문×3 → Daily로 내부 호출 4번을
   다 써서 `curate` 훅 1이 5번째 호출이라 나가지 못했다.

그래서 09-07 오전에 codex가 한 조정("훅 예산 50→45초", "헤드라인 30→10건", "호출 상한 30초")은 잘못된
전제 위의 대응이었고, 오히려 정상 완료될 보고서 읽기(기본 45초 timeout)와 웹 백필(35초)을 중단시켜
`aborted due to timeout` 실패를 만들고 있었다.

바꾼 것:

- `api/ingest-rss.js`·`api/company.js`에 `export const config = { maxDuration: 300 }`.
- **훅을 한 호출 안에서 이어 돌린다.** `runProcessStage`·`runCurateStage`가 `INVOCATION_BUDGET_MS`(170초)
  동안 훅을 반복하고, 예산이 다하면 그때만 자신을 한 번 더 부른다. 깊이는 `chain=` 쿼리로 세어
  `MAX_CHAIN_DEPTH`(4)를 넘기지 않는다(넘기면 `[STAGE_CHAIN_DEPTH_CAP]` 로그 + `skipped` 기록).
- 훅 예산 `CURATE_BUDGET_MS` 45→90초, 본문 훅 `STAGE_BUDGET_MS` 42→60초.
- 보고서 읽기 LLM 호출 `REPORT_LLM_TIMEOUT_MS`(85초), 웹 백필 `WEB_LLM_TIMEOUT_MS`(60초) 명시.
  `digestReport`·`backfillCompanyEvents`가 `timeoutMs`를 받는다.
- **시간 초과는 실패로 못 박지 않는다.** 보강(`enriched_at`)·갱신(`renewal_status='failed'`)은 timeout이
  아닌 오류에만 기록하고, timeout이면 다음 순환에서 다시 집는다(`isTimeoutError`).
- 헤드라인 번역 `TITLES_PER_CALL` 10→30 복원.
- 검사: `scripts/check-chain-depth.mjs`, `scripts/check-headline-hop-budget.mjs`.

### 2.2 표 추출 — 사용자가 지적한 오독

저장된 보고서 원문 5건(표 행 ~1,160개)에서 실제 빈도를 셌다.

| 형태 | 빈도 | 상태 |
|---|---|---|
| 행이 통째로 뭉개짐(파이프 없이 숫자 나열) | 표 행의 0~1.6%(9개) | 새 `pageToLines`가 대부분 잡음 |
| 셀 두 개가 붙음(`全资子公司114,252.25`) | 보고서당 43~154줄 | **가장 흔함** |
| 단위 머리(`单位：万元`)가 행에서 떨어짐 | 보고서당 137~183개 | **실제 사고 원인** |
| 여러 줄로 감싼 셀이 y좌표 묶기에 흩어짐 | 표마다 다름 | **미해결** |

`lib/report-reader.js`에 세 함수를 넣고 `extractPdfText`가 쪽을 다 모은 뒤
`renderTableRows(annotateTableUnits(text))`를 적용한다.

- `splitGluedCells()`: 한자·괄호 뒤 천단위 숫자, 소수 둘째 자리 뒤 숫자·한자 사이에 `|`를 넣는다.
  `万元·欧元·港币·股` 같은 단위 접미사 앞은 가르지 않는다. 표 행과 "천단위 숫자가 셋 이상 이어진 줄"에만
  적용하고 산문은 손대지 않는다.
- `annotateTableUnits()`: `单位：万元`을 만나면 다음 단위 머리나 절 제목(`第N节`)까지 표 행 끝에
  `[单位:万元]`을 붙인다.
- `renderTableRows()`: **표는 행 단위, 줄글은 문단 단위**로 두 갈래 처리. 헤더가 온전한 표는 행마다
  `표이름 · 행이름: 열1 값, 열2 값 (单位:元)` 문장으로 편다. **헤더 판정은 보수적이다** — 금액·소수·날짜가
  한 셀이라도 있으면 헤더가 아니라고 보고 그 표는 파이프 그대로 둔다. 실제 보고서는 여러 줄 헤더가
  흩어져 첫 파이프 행이 데이터 행인 경우가 흔해, 이 보호가 없으면 뒤 행이 전부 엉뚱한 문장이 된다.

검사: `scripts/check-report-tables.mjs` 8~11번 항목.

### 2.3 갱신은 덧붙이기가 아니라 바꿔 넣기 (사용자 결정)

`renewReport()`가 새로 읽은 결과가 충분하면(`RENEW_REPLACE_MIN_EVENTS` 3건 이상이고 옛 건수의 50% 이상)
**그 보고서의 옛 이벤트를 지우고** 새 것으로 채운다. `knowledge_chunk`·`event_fact`·`concept_edge`는
`on delete cascade`. 얇은 읽기(timeout)면 옛 것을 지키고 덧붙이기만 한다.

덧붙이기만으로는 못 고치는 이유: `storeEvents`의 `sameFact`가 같은 제목의 옛 오류 건과 새 정답 건을
같은 사실로 보아 **정답을 버린다.** 삭제 범위는 `company_id` + `source_url`로 좁히고 지우기 전에 조회한다.
`scripts/check-report-renewal.mjs`가 이 세 조건(삭제 한 곳·범위 한정·`canReplace` 가드)을 고정한다.

**event 총수가 줄어들 수 있다. 그것 자체는 정상이다.**

### 2.4 사실 추출 단위

한 건이 보고서 여기저기의 수치를 모으는데 발췌는 출발점 한 문단만 인용해, 저장된 근거로 확인되지 않는
수치가 쌓이고 있었다(수치 1개면 확인 불가 22.7%, 7개 이상이면 90.8%).

- `DIGEST_INSTRUCTIONS`: "한 건에는 같은 문장·같은 표 행의 수치만. 실적·프로젝트·생산능력·재무는 각각
  별개 건" + "fact_ko의 수치는 빠짐없이 발췌 안에 있어야 하고, 없으면 빼거나 별개 건으로 만든다".
- 표 금액은 표 머리 단위를 확인하고, 한국어 금액 옆에 원문 표기를 괄호로 병기
  (`15억 위안(150,000.00万元)`). 단위를 못 찾았으면 환산하지 않는다.
- 보고서 발췌 상한 300→400자(공시는 공개 자료라 저작권 제약 없음. 언론 기사는 300자 유지).
- `DIGEST_MAX_EVENTS` 14→30. **14는 이미 걸리고 있었다**(Farasis 반기 52/56, Zhenhua 반기 25/28).
  쪼개면 건수가 늘어 상한을 그대로 두면 뒤쪽 사실이 잘린다.
- 검사: `scripts/check-fact-granularity.mjs`.

### 2.5 근거 등급은 서버가 정한다

기본 화면은 `timeline_eligibility='core'`만 보여 주는데 그 등급을 **모델이 골랐고**, 프롬프트의 금지
문구에도 11건이 `core`로 들어와 있었다(CATL 뉴스룸 5, 新浪财经 공고 전재 4, Gotion 자사 뉴스 1,
Schaeffler 보도자료 1). 전부 거래소 제출 원문이 아니다.

`api/process-article.js`가 `isDisclosure`면 `core`, 그 밖에는 모두 `reference`로 저장한다. 모델 값은
`exclude`만 존중한다. 프롬프트도 "core는 고르지 않는다"로 바꿨다. 검사: `scripts/check-evidence-grade.mjs`.

**화면 변화**: CATL 뉴스룸 발표는 "보조 데이터 포함"을 켜야 보인다. CATL은 자체 수집 경로가 뉴스룸
하나뿐이라 기본 화면의 최근 이벤트가 눈에 띄게 줄어든다. 정기보고서 사실은 그대로다.

### 2.6 비교 리포트 함의 종합 (신규 기능)

비교 화면 "지난 리포트" 목록에서 비교 리포트 2~6건을 골라 공통 흐름·갈리는 지점·한국 기업 관점을
종합한다. 목록은 30건씩 읽고 "더보기"로 이어 붙인다.

- `POST /api/company` `mode=synthesize_reports`, `historyIds: [...]`. 재료는 `kind='compare'` 행만이다.
  종합을 다시 종합에 넣지 않는다 — 해석 위에 해석을 쌓으면 근거를 여러 단계 건너뛴 결론이 된다.
- `lib/compare-report.js` `buildReportSynthesis()`: **웹 검색 없이** 저장된 리포트만 근거로 쓴다.
  모든 항목에 `basis_ko`와 `report_refs`(재료 리포트 번호)가 붙는다.
- 결과는 같은 표에 `kind='synthesis'`로 저장돼 목록에서 다시 열린다. 문서 전체가 해석임을 머리에 표시.
- 프롬프트 `REPORT_SYNTHESIS_PROMPT`는 관리자 파이프라인 화면 6번 단계에 노출된다.
- 검사: `scripts/check-report-synthesis.mjs`.
- **운영에서 이미 한 번 성공했다**: "중국 배터리 다변화"(09-07 15:03 KST).

### 2.7 화면

- 비교 화면: A·B 선택창이 좌우 50:50으로 꽉 차고, 실행 버튼과 옵션은 아래 줄.
- A/B 고유색(`--pick-a` 네이비 `#10365f` / `--pick-b` 딥그린 `#0c6b4e`)을 픽커와 **아래 비교표 머리글에
  같이** 입혀 어느 열이 A인지 색으로 이어진다. 시장(파랑)·기술(갈색) 축 색과 겹치지 않게 골랐다.
  밸류체인 탭은 채움 알약이 아니라 **밑줄 탭**이므로 배경 대신 밑줄·글자에만 색을 준다(배경을 채웠더니
  글자가 검정으로 남아 네이비 위에서 읽히지 않았다).
- 기본 선택: 기업 분석·비교 A = 셀사 1위, 비교 B = 양극재 1위.
- Daily: `sections`(사실)에서 "산업 총평"을 빼 4개 카테고리로 한정하고, 해석 영역을 사실 목록 위로 올렸다.

## 3. 운영 DB에 직접 한 일

- `event` 11건의 `timeline_eligibility`를 `core` → `reference`(2.5절).
- Farasis 보증 표 **6건의 금액 오류 수정**. 万元을 千元로 읽어 10배 작게 저장돼 있었다.
  `114,252.25万元`→11억4,252만2,500, `150,000`→15억, `230,000`→23억, `53,500`→5억3,500만,
  `60,000`→6억, `67,500`→6억7,500만. `event`(fact_ko·title_ko·original_excerpt_ko)와
  `knowledge_chunk.content_ko`를 함께 고쳤다. 임베딩 벡터는 다시 만들지 않았다(문장 대부분이 같다).
- Farasis 2026 반기보고서의 `renewed_at`을 **비워 갱신 큐에 되돌렸다.** 오늘 옛 추출기로 읽힌 52건이라
  새 추출기로 다시 읽어 바꿔 넣어야 한다.

## 4. Supabase SQL 적용 상태

**전부 적용돼 있다.** 09-07에 직접 확인했다.

- `report-renewal.sql`: 컬럼 4개·체크 제약·인덱스 확인.
- `report-synthesis.sql`: `kind`·`source_history_ids`·`title_ko`, 회사 컬럼 NOT NULL 해제, 인덱스 확인.
- `company-entity.sql`(`event.entity_names`), `report-visual-quality.sql`도 적용돼 있다.
  이전 판 문서의 "미실행" 표기는 낡은 것이었다.

**미적용은 없다.** 새 SQL을 추가하면 이 절에 적는다.

## 5. 다음에 할 일 (우선순위 순)

1. **[자동] 09-08 08:00 예약 점검 결과 확인.** `china-battery-lens-nightly-check`가 A~F를 훑는다.
   핵심 판정: 유지 훅이 10건 안팎 도는가 / `duration_ms > 300000`이 없는가 / Farasis 반기가
   `replaced` ≈ 52로 바꿔 넣어졌는가 / 보증 표 금액이 정확한가 / 새 규칙 이벤트의 수치 확인 불가 비율이
   기존 40%대보다 뚜렷이 낮은가.
2. **표 오독 잔여 문제 해결.** 여러 줄로 감싼 셀이 y좌표 묶기에 흩어지는 것(R&D 표, 헤더 행).
   지금은 그런 표를 문장으로 펴지 않고 파이프 그대로 두어 **피해를 막고만 있다.**
   제대로 고치려면 열 x좌표 군집화로 표를 복원해야 한다.
3. **새 규칙 효과 판정 뒤 조치.** 수치 확인 불가 비율이 신규 코호트에서 20% 밑이면 성공. 30%를 넘으면
   모델이 규칙을 무시하는 것이므로 **저장 전 기계 검사**(발췌에 없는 수치가 있으면 그 건을 버림)를 넣는다.
   스키마·검사 자리는 이미 있다(`lib/event-backfill.js`의 `dropped` 집계).
4. **사업 관계망 화면.** 설계 합의는 `docs/HANDOFF.md` "2026-09-08 방향" 절에 있다. 재료가 아직 얇다
   (`event_fact` 196건, 상대방 있는 사실 31건, 추출된 이벤트 94/694). 유지 훅이 살아나 `facts` 단계가
   돌면 채워진다. 회사당 상대방 분포를 보고 시작한다.
5. **공시 원문 임베딩(`report_chunk`)이 0건이다.** `REPORT_TEXT_ONLY_EMBEDDING=1`을 켜야 도는데,
   이미지 도표를 못 읽는 텍스트 전용 청크가 보고서 전체를 대표하는 것처럼 보이는 문제 때문에 꺼 뒀다.
   표 후처리가 좋아졌으니 켤지 다시 판단한다.
6. 미결: 약관 기반 매체 허용 목록(미착수), 벡터 검증 2단계(원문 재확보 대조,
   `docs/VECTOR-VERIFICATION-PLAN.md` 3절).

### 교차검증 수정본 채택 — 구현 완료, 배포 대기

교차검증 판정을 `pass` / `corrected_pass` / `reject`로 나눴다. 일부 표현·수치만 잘못됐고 본문에서
확인되는 의미 있는 사실이 남으면 기사 전체를 버리지 않고 검증자가 보수적으로 고친 수정본을 채택한다.

- `acceptedFactCheck(analysis, factCheck)`가 `pass`와 `corrected_pass`를 받아 검증자 수정본을 합친다.
- 기사 제목·요약뿐 아니라 `event_title_ko`·`event_fact_ko`·근거 발췌도 수정본으로 덮어써, 1차 추출에서
  제거된 과장이나 수치가 이벤트로 다시 유입되지 않게 했다.
- `corrected_pass`도 레거시 통과 상태 `pending_review`로 저장하되 `source_tier`에 `_corrected` 접미사를,
  `processing_note`에 교정 이유를 남긴다.
- 기사 경로는 서버 규칙대로 계속 `reference`이며, 거래소 공시만 `core`다.
- `scripts/check-corrected-fact-check.mjs`를 추가했다. 전체 회귀 검사 19개와 모듈 로드 검사가 통과했다.

## 6. 지금 수치 (2026-09-07 저녁)

| 항목 | 값 |
|---|---|
| `event` | 694 (core 535 / reference 159) |
| `knowledge_chunk` | 1,573 (report_chunk 0) |
| `event_fact` | 196 (상대방 있는 사실 31) |
| 사실 추출된 이벤트 | 94 / 694 |
| 갱신된 보고서 / 큐 | 0 / 107 |
| 원문이 저장된 보고서 | 5 |
| 비교 리포트 / 함의 종합 | 6 / 1 |

## 7. 검증 명령

```bash
npm run check
for f in scripts/check-*.mjs; do node $f; done
git diff --check
```

회귀 스크립트 19개 모두 네트워크 없이 돈다. `node --check`는 구문만 보므로 `npm run check`(api 모듈
실제 import)를 함께 돌린다.

## 8. 주의 — 이 세션에서 세 번 반복한 실수

제약이 **존재하는 것**과 제약이 **구속력을 갖는 것**을 구분하지 않아 세 번 오진했다.
"Vercel 60초 한도"는 설정 형식이 틀려 무시되고 있었고, "발췌 300자 상한"은 평균 길이가 110자라 닿지도
않았으며, "선택 탭은 채움 알약"은 나중 규칙이 밑줄 탭으로 덮고 있었다. 세 번 다 한 줄짜리 확인
(`avg(length())`, 계산된 스타일, 공식 문서)이면 몇 초에 깨졌다.

`CLAUDE.md`에 진단 규칙 4개를 남겼다. 요약: **제약을 원인으로 지목하기 전에 실제로 걸리는지 센다 /
코드 주석·문서의 단정은 증거가 아니다 / 가설이 서면 반증을 한 번 찾는다 / 확인한 것과 추정한 것을
나눠 보고한다.**
