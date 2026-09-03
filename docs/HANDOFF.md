# China Battery Lens 인수인계

기준일: 2026-09-02

## 1. 운영 자산

| 항목 | 값 |
|---|---|
| GitHub | `https://github.com/dongiljeffjang-ux/china_battery_info` |
| 기본 브랜치 | `main` |
| 운영 서비스 | `https://china-battery-lens.vercel.app/` |
| Vercel 프로젝트 | `dongiljeffjang-uxs-projects/china-battery-lens` |
| Supabase project ref | `dtgtzkfapuwddtinixdk` |
| Supabase URL | `https://dtgtzkfapuwddtinixdk.supabase.co` |

비밀키 값은 저장소에 없다. Vercel 환경변수에서 관리한다.

## 2. 현재 사용자 요구

- 셀사·양극재·음극재 주요 중국 기업과 공식적으로 확인된 그룹 계열사를 추적한다.
- 추적 대상 선정 기준은 SNE Research다. 셀은 EV·ESS 배터리 사용량, 양극재는 LFP·NCM 화학계별 출하량, 음극재는 총 출하량 기준으로 밸류체인별 상위 5~10개사를 본다.
- OpenAI와 DeepSeek가 각각 웹 검색한다. OpenAI는 폭넓은 주요 출처, DeepSeek는 중국어 현지 산업·지역·기업 출처를 우선한다.
- 전체 후보에서 헤드라인으로 Top 10을 고른 뒤 원문을 읽고 OpenAI 1차 추출·DeepSeek 교차검증을 수행한다.
- 첫 화면은 Daily 한국어 리포트, 근거 Top 10, 날짜 범위 확대/축소 Sankey, 밸류체인·회사별 뉴스 순서다.
- 사람 최종 승인 단계는 없다. 자동 검증 통과 기사를 표시하고 좋아요/싫어요를 다음 Daily 선별 보조 신호로 쓴다.
- 기업 분석은 최근 3년 이상을 시장/기술 레이어 행 × 분기 열로 보여주고, 출처·원문·한국어 번역을 Excel로 내보낸다.
- 계열사에서 일어난 사실은 모회사 시계열에 넣되 발생 법인을 병기한다.
- 검증 통과 원문을 보관하고 청킹·임베딩해 회사별 벡터 지식으로 저장한다.

## 3. 실제 파이프라인

1. `api/ingest-rss.js`가 회사 마스터를 Supabase에 upsert한다. DB 컬럼(`id`, `name_ko`, `name_zh`, `name_en`, `type_tags`)만 보낸다.
2. `lib/china-sources.js`가 네 경로를 병렬 수집한다. OpenAI 검색 3회, DeepSeek 검색 3회, CATL 뉴스룸, CNINFO 공시(22개사).
3. URL 중복을 제거하고 회사 별칭과 **그룹 계열사 별칭**으로 `article_company`를 연결한다.
4. 헤드라인 신호로 최대 10건을 선택한다. **선별 대상은 `source_tier`가 `web_search_*`이거나 `CATL Newsroom`인 기사뿐이다.**
5. `api/process-article.js`가 원문 HTML을 가져온다.
6. OpenAI가 한국어 사실·이벤트를 추출하고 DeepSeek가 같은 본문으로 교차검증한다.
7. 통과 기사는 `pending_review`로 저장된다. 이 상태명은 레거시이며 현재 의미는 "자동 팩트체크 통과"다.
8. 이벤트를 저장할 때 `layer_key`를 8개 규격 값으로 정규화하고, 등록된 계열사 별칭 매칭으로 `entity_names`를 채운다.
9. 원문을 약 1,800자, 180자 중첩으로 나누고 `text-embedding-3-small` 기본 모델로 배치 임베딩한다.
10. `knowledge_chunk`에 회사·기사·출처·청크 순서·원문·한국어 요약 결합 텍스트를 저장한다.
11. `api/generate-daily.js`가 Top 10과 최근 피드백을 사용해 Daily를 생성한다.

## 4. 환경변수

필수 이름은 `.env.example`이 기준이다.

| 변수 | 용도 |
|---|---|
| `SUPABASE_URL` | Supabase REST URL |
| `SUPABASE_SERVICE_ROLE_KEY` | 서버 전용 DB 접근 |
| `APP_ACCESS_KEY` | 서비스 입장 키 |
| `OPENAI_API_KEY` | 검색·추출·임베딩 |
| `OPENAI_MODEL` | OpenAI Responses 모델 |
| `OPENAI_EMBEDDING_MODEL` | 기본 `text-embedding-3-small` |
| `DEEPSEEK_API_KEY` | 독립 중국 뉴스 검색·교차검증 |
| `DEEPSEEK_MODEL` | 기본 `deepseek-v4-flash` |
| `DEEPSEEK_THINKING` | 기본 `false`; Responses `reasoning.effort=none` |
| `CRON_SECRET` | Vercel Cron/보호 API Bearer 값 |

## 5. Supabase 적용 SQL

새 프로젝트에서는 `supabase/schema.sql`을 기준으로 초기화한다. 기존 운영 프로젝트에는 다음 SQL이 실행됐다.

- `supabase/feedback.sql`: `article_feedback`
- `supabase/vector-schema.sql`: pgvector 검색 기반
- `supabase/vector-ingestion.sql`: 원문 보관·청크 필드·임베딩 상태
- `supabase/event-facts.sql`: `event_fact` 테이블(구조화 사실) + `event.facts_extracted_at`. 실행됨.

**미실행**: `supabase/company-entity.sql` (`event.entity_names`). 코드 배포 전에 SQL Editor에서 실행해야 한다. 컬럼이 없는 상태로 새 코드가 이벤트를 INSERT하면 Supabase가 거부해 기사 처리가 실패한다.

운영 DB에 SQL을 실행한 뒤 `Success. No rows returned`를 확인한다. 이후 스키마 변경도 재실행 가능한 SQL로 남긴다.

## 6. API 지도

| 경로 | 역할 |
|---|---|
| `/api/access` | 입장 키 검증·HttpOnly 쿠키 발급 |
| `/api/ingest-rss?process=1` | 수집부터 분석·Daily까지 수동 1회 실행 |
| `/api/dashboard` | Daily, Top 10, 회사 뉴스, Sankey 데이터 |
| `/api/company` | companyId 없으면 31개 회사 마스터·그룹·선정 기준, 있으면 그 기업의 이벤트 시계열.  |
| `/api/news` | GET 소스 후보, POST 좋아요/싫어요 |
| `/api/raw-news` | Raw Excel용 기사 데이터 |
| `/api/process-article` | 보호된 단일 기사 처리 |
| `/api/generate-daily` | Daily 생성 내부 로직 |
| `/api/embed-event` | 레거시 수동 이벤트 임베딩 경로 |

## 7. 화면 상태

- 정적 프런트엔드: `app/index.html`, `app/app.js`, `app/styles.css`.
- Daily 데이터는 API와 연결돼 있다.
- 기업 분석·비교의 시드 데이터를 제거했다. 회사 목록은 `/api/company`(companyId 없음), 이벤트·매트릭스·비교·Excel 내보내기는 `/api/company?companyId=...`의 실제 `event` 행에서 온다.
- 회사 셀렉트는 밸류체인 → SNE 순위(`priority`, 없으면 뒤) → 한국어명 순으로 정렬된다.
- 기업 시계열 매트릭스는 시장 4개, 기술 4개 레이어 행 × 분기 열이다. 열은 (올해-3년) Q1부터 당해 분기까지 자동 생성하고, 그 밖의 확인된 이벤트가 있으면 해당 분기도 연다. 빈 칸은 `—`로 두고 표 아래에 "확인된 이벤트 없음"의 뜻을 명시한다.
- `layer_key`는 `lib/timeline-layers.js`의 8개 값으로 제한된다. 모델은 `unclassified`를 고를 수 있고, 그 경우와 규격 밖 값은 모두 `null`로 저장돼 화면에서 트랙별 `미분류` 행에 표시된다. 미분류가 쌓이면 레이어 정의를 손봐야 한다는 신호다.
- 계열사에서 일어난 사실은 이벤트 카드·매트릭스 셀·비교 화면·Excel에 발생 법인이 병기된다.
- 기업 프로필에는 그룹 계열사 목록과 근거 연차보고서 링크가 표시된다.
- Sankey는 비-Top 10 기사에서 헤드라인 확대/축소 신호를 분류하고 방향별 상위 4개만 표시한다.
- 프런트 변경 후 브라우저 캐시 문제가 있었으므로 `app/index.html`의 `app.js?v=...`를 변경한다.
- `app/app.js`의 `renderCandidateQueue()`는 호출되지 않는 죽은 코드다. 후보 큐 화면을 되살릴지 결정이 필요하다.

## 8. 회사 범위와 그룹 마스터

### 추적 Universe

`lib/china-sources.js`에 셀 10, 양극재 12, 음극재 9개로 총 31개사가 있다. 한국어 표준명·중문명·영문명·검색 별칭을 유지한다.

`priority`는 SNE Research 공개 보도자료에서 확인한 밸류체인 내 순위이고, `null`은 SNE 상위 명단에서 확인하지 못한 회사다. 선정 기준은 `SELECTION_BASIS`에 기록한다. **점유율·출하량 수치 자체는 저장하지 않는다.** 유료 리서치 재배포를 피하고, 매월 바뀌는 수치가 저장소에 박히지 않게 하기 위함이다.

2026-09-02에 SNE 기준으로 두 곳을 추가했다.

- `reshine` 湖南瑞翔新材料股份有限公司 — SNE 삼원계 양극재 상위. 비상장, 金川集团 계열.
- `youshan` 友山科技 — SNE LFP 양극재 상위. 비상장. 상장사 `华友钴业`이 아니라 지주사 `华友控股集团`의 전액출자 자회사다.

### 그룹·계열사 마스터

`lib/company-groups.js`에 15개 그룹이 있다. 등록 기준은 다음과 같다.

1. 근거는 **모회사가 직접 공시한 연차보고서**다. 각 계열사는 관계를 명시한 원문(`evidence`)을, 그룹은 근거 문서(`source`)를 갖는다. 언론·백과·업계 자료만 있는 관계는 넣지 않는다.
2. `scope`는 **셀·양극재·음극재만** 둔다. 분리막·장비·ESS·무역·R&D·광산·비배터리 사업은 제외한다.
3. **그룹당 5곳 내외**만 둔다. 뉴스에 이름이 등장하고 별도 발표 주체가 되는 법인을 남긴다.
4. 조사 대상은 밸류체인별 SNE 상위 5~10개사다.
5. 비상장사는 연차보고서가 없으므로 그룹을 비워 둔다. 근거 등급을 낮추지 않는다.

| 밸류체인 | 그룹 |
|---|---|
| 셀 | CATL, BYD, EVE Energy, Gotion |
| 양극재 | Ronbay, 후난위넝, Dynanonic, 万润新能, Lopal, 五矿新能 |
| 음극재 | BTR, 샨샨, 푸타이라이, 中科电气, 尚太科技 |

계열사명만 등장하는 헤드라인도 `companiesFor()`가 모회사 ID로 연결한다. 검색 프롬프트에는 `search: true`인 법인만 넣어 프롬프트 길이를 통제한다.

### 그룹을 추가하는 절차

1. CNINFO `hisAnnouncement/query`에 `category=category_ndbg_szsh`로 최신 연차보고서 PDF URL을 얻는다. 북경거래소 종목은 이 필터가 듣지 않으므로 카테고리 없이 조회한다.
2. PDF를 내려받아 `pdftotext -enc UTF-8`로 변환한다.
3. `释义`와 `在其他主体中的权益 → 企业集团的构成`, `主要控股参股公司分析`을 읽는다. `释义`가 "指 XXX，公司全资子公司" 형태로 관계를 직접 명시하는 경우가 가장 좋은 근거다.
4. 위 등록 기준 1~5를 적용해 5곳 내외를 고르고 `evidence`에 원문을 그대로 옮긴다.

## 9. 알려진 기술 부채와 다음 우선순위

1. **CNINFO 공시가 수집되지만 분석되지 않는다.** `selectHeadlineTop10()`이 `web_search_*`와 CATL 뉴스룸만 선별 대상으로 삼아, 회당 200건이 넘는 공시가 `pending` 상태로만 쌓인다. `prd.md`의 "공식 공시·IR을 최우선 출처로 한다"와 `data-model.md`의 "과거 구간은 공시·IR 우선 검수"에 어긋난다. 공시는 PDF라 `process-article.js`의 HTML 경로로는 처리되지 않으므로 PDF 텍스트 추출과 Vercel 60초 제약 대응이 함께 필요하다. Top 10과 분리해 회사별 소수만 `timeline_eligibility='core'` 이벤트로 만드는 방향이 검토됐다.
2. `layer_key`가 비어 있는 기존 `event` 행의 재분류 백필. 화면에서는 트랙별 `미분류` 행에 모인다.
3. 기존 검증 기사에 대한 벡터 DB 백필. 현재 자동 임베딩은 새로 처리된 기사부터 적용된다.
4. 임베딩 실패(`embedding_status=failed`) 자동 재시도 작업.
5. `pending_review`를 의미가 분명한 `verified`로 스키마 마이그레이션.
6. 검색 실행별 OpenAI/DeepSeek 발견·중복·본문 성공·팩트 통과·임베딩 청크 수를 운영 화면에 표시.
7. 기사 원문 저장은 사용자의 명시 요구로 활성화됐다. 저작권·보존기간·접근통제 정책을 제품 문서와 일치시키는 결정이 필요하다.
8. Vercel 60초 함수 안에서 검색 6회 + 본문 분석 20회 + 임베딩이 실행되므로 시간초과가 발생하면 큐/비동기 작업으로 분리한다.
9. 남은 밸류체인 상위사의 그룹 마스터 확장. 홍콩 상장사(CALB, REPT)는 HKEXnews 연차보고서를 근거로 인정하기로 했으나 HKEX 수집 경로가 없다.

## 10. 검증 절차

```powershell
node --check app/app.js
node --check api/company.js
node --check lib/china-sources.js
node --check lib/company-groups.js
node --check lib/timeline-layers.js
node --check lib/llm-provider.js
node --check lib/vector-ingestion.js
node --check api/ingest-rss.js
node --check api/process-article.js
git diff --check
```

`node --check`는 구문만 본다. 스크립트로 파일을 편집했다면 **주요 함수가 그대로 남아 있는지 함께 확인한다.** 편집 사고로 함수 본문이 뭉개져도 정규식 리터럴로 파싱돼 `node --check`가 통과한 사례가 있었다.

운영 배포 후에는 Vercel 로그에서 다음 태그를 확인한다.

- `[WEB_SEARCH_FAILED]`
- `[INGEST_OUTCOMES]`
- `[ARTICLE_CROSS_CHECK]`
- `[ARTICLE_EMBEDDING_FAILED]`
- `[FEEDBACK_SAVE_FAILED]`
- `[COMPANY_QUERY_FAILED]`
- `[CNINFO_EMPTY]` — `returned > 0`이면 질의어가 다른 회사 공시를 끌어오고 있다는 뜻이고, `returned = 0`이면 그 기간에 공시가 없거나 종목코드·거래소·사명이 바뀌었다는 뜻이다. 공시 빈도가 낮은 회사는 정상적으로도 0이 나오므로, 여러 회차 연속 0인 회사를 신호로 본다.

## 11. 저장소 주의사항

- `research/disclosure-only-mvp.md`는 공시 전용 대안 검증 자료다.
- Python `pipeline/`과 SQLite 설명은 초기 프로토타입 흔적이며 현재 운영 Vercel/Supabase 경로와 동일하지 않다.
- 문서 간 "뉴스 원문 미저장" 표현은 최신 구현과 충돌한다. 최신 결정은 원문 DB 보관 + 서버 접근통제이며, 향후 정책 확정이 필요하다.
- 2026-09-02 작업의 결정 근거는 `docs/DECISIONS-2026-09-02.md`에 있다.

## 2026-09-03 변경 요약

- 수집 파이프라인을 세 호출로 분리: `ingest-rss`(수집) → `?stage=process`(본문 처리, 42초 예산, 최대 4회 자체 연쇄) → `?stage=daily`(Daily 생성). 연쇄 호출은 `CRON_SECRET` Bearer로 인증하고 `@vercel/functions`의 `waitUntil`로 응답 후에도 일을 마친다. 한 호출 60초에 Daily가 잘리던 문제의 해법이다.
- 크론 시간대 교정: Vercel 크론은 UTC다. 수집 `0 14`(23:00 KST), 임베딩 `0 16`(01:00 KST).
- 기사에서 뽑은 이벤트는 적재 직후 같은 함수에서 임베딩한다. 버튼·크론은 백로그용이다.
- `event.occurred_precision`/`occurred_basis` 도입. 연간 집계는 보고 기간 말일+`year`, 시점 사건은 실제 시기. `?redate=<id>`와 "시점 재확인" 버튼이 미확인(`occurred_basis is null`) 이벤트를 20건씩 처리한다.
- `article.processing_status/note/processed_at`로 본문 처리 실패 사유를 남긴다. `body_unavailable`/`body_too_short`는 헤드라인 선별에서 제외한다.
- 비교 리포트 PDF: `api/company` POST `mode=compare_report`. 초안(화면 이벤트만) → 웹 검증 1회. 인쇄용 창에 A4 한 장.
- 접근 세션 12시간 → 7일.
- Daily Top 10 후보는 최근 3일 검증 통과 기사 전체. 사실 요약은 회사별로 묶고 해석은 줄글.

### 검증 규칙 추가
- `npm run check`가 `api/*.js`를 실제로 import한다. `node --check`는 구문만 보므로 같은 함수 안의 `let`/`const` 이름 충돌처럼 링크 단계 오류를 놓친다. 이 오류는 배포 직후 모든 호출을 500으로 만든 전례가 있다(2026-09-03). JS 수정 후 `node --check`와 함께 반드시 실행한다.

### 2026-09-03 오후: 시계열 백필 자동화
- 기업 시계열 화면의 운영 버튼(보고서 종류·보고서 요약·전체 기업 요약·시점 재확인·벡터 임베딩)을 모두 제거했다. 사용자는 회사만 고른다.
- 수집 파이프라인: `collect` → `process`(≤4회) → `daily` → **`curate`(≤8회)**. `lib/curation.js`의 `runCurationHop`이 호출마다 (1) 벡터 누락 이벤트 임베딩 (2) 미독 정기보고서 1건 읽기 (3) 시점 미확인 이벤트 20건 재확인을 42초 예산 안에서 한다.
- 읽은 보고서 장부 `report_digest`(회사·URL 키). `missing:`으로 시작하는 URL은 못 찾았거나 실패한 기록이며 14일 뒤 재시도. 계절 규칙: 8월 이후 반기, 4~5·10~11월 분기, 연차는 15개월 주기.
- 보고서 본문은 12,000자 청크로 나눠 각각 추출 후 제목 기준으로 합친다(`digestReport`).
- `?digest=`/`?redate=`/`?backfill=` 엔드포인트는 남아 있다(운영·디버그용). 화면에서는 부르지 않는다.

### 2026-09-03 저녁: 화면·리포트 정리
- 비교 화면 시계열 셀과 연차보고서 핵심 사실은 제목+핵심 수치 개조식, 중요도순(`importanceOf`, `keyMetrics`), 전문은 툴팁. 비교 셀은 3줄 뒤 `+N건`.
- 시장·기술 레이어 시간축은 과거→현재 순서를 지키고, 그려진 직후 가로 스크롤을 오른쪽 끝(현재 분기)으로 옮긴다.
- 비교 리포트: 해석에 `implication_ko`(한국 어느 부문에 유리·압박) 추가. 웹 검증 결과를 DB에 되돌린다 — 날짜 오류는 `event.occurred_at/precision/basis` 수정(검증자가 event id를 짚고 출처 URL이 있을 때만), 새 사실은 `web_backfill`·참고 등급 이벤트로 추가 후 임베딩(`applyVerifiedFacts`).
- Daily·비교 리포트 모두 "확인할 것" 제거. 관점은 한국 셀·소재사 임원 겸 시장 애널리스트, 행동 지시 금지.
- 첫 화면 조회 실패는 숨기지 않는다: 401이면 입장 화면 재표시, 서버 조회 실패는 응답 `errors`로 화면에 알림.
- 접근 세션 7일.

### 2026-09-03 밤: 최근 3년 백필 수동 적재
- `scripts/fetch-coverage.mjs`로 상장 23곳의 2024~2026 정기보고서(연차 FY2024·FY2025, 반기 2024·2025·2026)를 받아 `outputs/coverage/`(gitignore)에 텍스트로 뽑고, 에이전트가 읽어 이벤트를 직접 SQL로 넣었다. LLM 키 없이 진행했으므로 임베딩은 유지 단계(`embedMissingEvents`)가 채운다.
- 시점 원칙: 기간 집계는 기간 말일+`half`/`year`, 시점 사건은 보고서에 적힌 월/일 또는 공개 발표일(basis에 근거 명시). 보고서가 시기를 안 밝히면 `half`로 두고 basis에 그렇게 적었다.
- 장부(`report_digest`)에 읽은 보고서를 모두 기록했으므로 유지 단계가 같은 보고서를 다시 읽지 않는다.
- 미해결: BTR(베이징거래소)은 CNINFO 반기·FY2024 연차 분류가 달라 못 받음. 신왕다 2026 반기는 발췌 구간이 빗나가 기사 이벤트로 대체. 비상장 9곳은 유지 단계의 웹 백필(참고 등급)에 맡긴다.

### 2026-09-04: 전략 장부 탭 (카운팅 프로파일·3D 그래프 폐기)
- 벡터 3D 그래프와 이벤트 건수 프로파일은 둘 다 만들었다가 뺐다. 이유: 건수의 분모가 "우리가 읽은 보고서 수"라 회사 비교가 안 되고, 벡터 근접은 시계열에 이미 보이는 사실의 반복이었다. `graph_vectors()` 함수도 DROP했다.
- 대신 `event_fact`(구조화 사실)를 두고 `전략 장부` 탭에서 회사를 가로질러 같은 축으로 본다: ① 회사×품목 캐파 버블(셀마다 최신 공표값 하나, 합산 안 함) ② 국가 타일(중국 밖) ③ 회사↔상대방 연결도(한국 기업 강조) ④ 실적 선그래프(period 있는 사실만). 모든 그림은 클릭하면 근거 사실 카드(발췌·원문 링크·출처 등급·검토 버튼)가 아래에 열린다.
- 추출은 `lib/fact-extraction.js`. curate 훅이 `embed` 다음에 `extractMissingFacts()`를 호출해 이벤트 6건씩 최대 4호출을 처리한다(`facts_extracted_at`이 null인 것만). **저장 전 검사**: 발췌가 이벤트 원문에 글자 그대로 있어야 하고, 수량 표기가 발췌 안에 있어야 하며, 숫자는 모델이 아니라 `parseQuantity()`가 표기에서 읽는다. 단위·상태·세그먼트는 닫힌 목록. 이 검사에 걸린 건수는 훅 로그 `facts.dropped`에 남는다.
- 첫 소급: 이벤트 392건이 대기 중이며 야간 curate가 채운다. 화면 확인용으로 8개 회사 19건을 수동 시드(`extractor='manual_seed'`, 발췌 대조 SQL로 검증)했다.
- **다음 할 일**: 소급이 끝나면 무작위 30건을 원문과 대조해 정확도를 기록하고 프롬프트를 손본다. 정확도가 부족하면 두 모델(DeepSeek·OpenAI) 교차 추출을 켜서 `agreement`를 채운다(스키마는 이미 있음).
- 출처 등급 기본값은 "공시만". 기사·웹 사실은 화면 상단 셀렉트로 켠다. `review_status='rejected'`는 조회에서 빠진다.

### 2026-09-04 (2): 전략 장부 폐기, 비교 페이지에 집중
- 전략 장부 탭·API 모드(`fact_ledger`, `fact_review`)·curate 훅의 사실 추출 호출을 뺐다. 이유: 회사 31곳 중 데이터가 있는 곳이 일부이고 백필이 얇아 화면이 거의 비어 있었다.
- `event_fact` 테이블과 `lib/fact-extraction.js`는 남겨 두었다(시드 19건). 비교 리포트에 구조화 수치를 넣을 때 재사용할 수 있다. 다시 켜려면 `runCurationHop`에 `extractMissingFacts({ deadline })`를 embed 다음에 넣으면 된다.
- 다음 초점: 기업 비교 페이지의 정보 품질과 백필 보충.

### 2026-09-04 (3): 백필 보충 — FY2023·홍콩 공시·연도별 웹 백필
- 커버리지 창이 연차 3개년(2023·2024·2025)+반기 3개년을 덮도록 고쳤다. 전에는 연차가 두 해만 잡혀 2023년이 비어 있었다. 야간 curate가 빈 창부터 읽는다.
- `lib/report-reader.js`에 홍콩거래소 리더를 붙였다. `company.hkex.code`(CALB 03931, REPT 00666)가 있으면 prefix.do로 stockId를 찾고 titleSearchServlet(t2code 40100 연차 / 40200 중간)으로 목록을 받는다. **영문판**을 읽는다 — 중문판은 글자가 추출되지 않았다(226쪽에 4만 자). 영문 PDF는 단어 사이 공백을 살려 이어 붙이고, MD&A는 대문자 표제 가운데 목차(대문자 비율 높음)를 건너뛴 첫 본문에서 자른다. CALB 2025 연차로 검증: 38k자, 산업 개관→사업 회고→재무 회고.
- Hithium·SVOLT는 홍콩 상장이 아니라(prefix 검색 결과 없음) 웹 백필로 남는다.
- 비상장 웹 백필은 (회사, 연도) 단위로 바꿨다. 장부 태그 `web:<연도>:<날짜>`, 연도마다 최대 10건, 90일 주기. 옛 태그 `web:<날짜>`는 무시된다.
- 비교 화면 머리에 회사별 공시·이벤트 수와 시작 연도를 적고, 두 배 이상 차이 나면 경고를 띄운다.
- 시계열 매트릭스는 위(최근)→아래(과거), 왼쪽 시장 2칸·오른쪽 기술 2칸(`MATRIX_GROUPS`, 표시용 묶음). 연차보고서 핵심 사실은 연도 토글.
