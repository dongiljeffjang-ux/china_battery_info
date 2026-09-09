# China Battery Lens 인수인계

기준일: 2026-09-09

**가장 최근 변경 요약과 다음 할 일은 `docs/HANDOFF-CODEX.md`에 있다. 먼저 읽는다.**
(그 앞 세션 분은 `docs/HANDOFF-2026-09-08-CLAUDE.md`에 남아 있다. 두 문서가 겹치면 `HANDOFF-CODEX.md`가 최신이다.)

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
6. OpenAI가 한국어 사실·이벤트를 추출하고 DeepSeek가 같은 본문으로 교차검증한다. 판정은 `pass` / `corrected_pass` / `reject`다. 일부 표현·수치만 잘못됐고 본문으로 확인되는 의미 있는 사실이 남으면 검증자가 보수적으로 고친 기사·이벤트를 채택한다.
7. `pass`와 `corrected_pass` 기사는 `pending_review`로 저장된다. 이 상태명은 레거시이며 현재 의미는 "자동 본문 대조 통과"다. `corrected_pass`는 `source_tier`의 `_corrected` 접미사와 `processing_note`에 교정 이유를 남긴다.
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

2026-09-06~07에 추가로 실행됐다.

- `supabase/headline-knowledge.sql`: `knowledge_chunk`의 `headline` 소스 타입 허용, 검색 함수 `include_unverified` 기본값. 실행됨.
- `supabase/ingestion-guard.sql`: `ingestion_guard` 테이블(수집 체인 잠금). 실행됨.
- `supabase/report-visual-quality.sql`: 공시 PDF의 텍스트/이미지 도표 완전성 상태. 실행됨.

2026-09-07에 운영 DB에서 적용 여부를 직접 확인했다. 아래 둘은 **적용돼 있다**. 이전 판 문서의 "미실행"
표기는 낡은 것이었다.

- `supabase/company-entity.sql`: `event.entity_names` 존재 확인.
- `supabase/report-renewal.sql`: `report_digest`의 `renewed_at`·`renewal_status`·`renewal_inserted`·
  `source_sha256` 네 컬럼, `report_digest_renewal_status_check` 제약, `report_digest_renewal_queue_idx`
  인덱스까지 모두 확인. 갱신 큐 대상은 107건이다(장부 125건 중).

- `supabase/report-synthesis.sql`: 비교 리포트 히스토리 표에 `kind`·`source_history_ids`·`title_ko`를 더하고
  회사 컬럼의 NOT NULL을 푼다. 2026-09-07 저녁 실행됨(컬럼·체크 제약·인덱스 확인, 기존 6건은 `compare`).

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
- Sankey는 비-Top 10 기사(검증 기사 + 번역된 미검증 헤드라인)의 확대/축소 신호를 `lib/sankey-normalization.js`의 고정 테마 10개로 접어 방향별 상위 4개를 표시한다. 미검증 헤드라인은 화면 토글로 뺄 수 있고 툴팁에 건수가 나뉘어 보인다. 헤드라인 번역은 큐레이션 훅의 `embedPendingHeadlines()`가 만든다(`supabase/headline-knowledge.sql` 선행 필요).
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

주요 상장사의 2024년 이후 연차·반기보고서는 기존 데이터를 삭제하지 않고 다시 내려받아 텍스트를 재추출하고, 새 이벤트만 보강하는 갱신 큐가 추가됐다. 원본 PDF 해시를 남기며 큰 이미지가 있는 페이지는 `visual_review_required`로 유지한다. 이 단계는 **PDF 텍스트 갱신**이고 완전성 승인이 아니다. 거래소가 XBRL·Excel·HTML 표 같은 구조화 원본을 함께 제공하는 경우 그 수치를 먼저 수집하는 경로는 아직 구현되지 않았다.

1. **CNINFO 공시가 수집되지만 분석되지 않는다.** `selectHeadlineTop10()`이 `web_search_*`와 CATL 뉴스룸만 선별 대상으로 삼아, 회당 200건이 넘는 공시가 `pending` 상태로만 쌓인다. `prd.md`의 "공식 공시·IR을 최우선 출처로 한다"와 `data-model.md`의 "과거 구간은 공시·IR 우선 검수"에 어긋난다. 공시는 PDF라 `process-article.js`의 HTML 경로로는 처리되지 않으므로 PDF 텍스트 추출과 Vercel 60초 제약 대응이 함께 필요하다. Top 10과 분리해 회사별 소수만 `timeline_eligibility='core'` 이벤트로 만드는 방향이 검토됐다.
2. `layer_key`가 비어 있는 기존 `event` 행의 재분류 백필. 화면에서는 트랙별 `미분류` 행에 모인다.
3. 기존 검증 기사에 대한 벡터 DB 백필. 현재 자동 임베딩은 새로 처리된 기사부터 적용된다.
4. 임베딩 실패(`embedding_status=failed`) 자동 재시도 작업.
5. `pending_review`를 의미가 분명한 `verified`로 스키마 마이그레이션.
6. 검색 실행별 OpenAI/DeepSeek 발견·중복·본문 성공·팩트 통과·임베딩 청크 수를 운영 화면에 표시.
7. 기사 원문 저장은 사용자의 명시 요구로 활성화됐다. 저작권·보존기간·접근통제 정책을 제품 문서와 일치시키는 결정이 필요하다.
8. Vercel 60초 함수 안에서 검색과 본문 분석·임베딩이 실행되므로 시간초과가 계속되면 큐/비동기 작업으로 분리한다. 2026-09-07에 검색 요청을 회사 4곳 단위로 쪼개 요청 하나의 부담을 낮췄으나, 전체 31개사 모드의 성공률은 아직 실측하지 않았다.
9. 파일럿(`?pilot=1`)은 3개사만 돌고 Daily를 만들지 않는다. 전체 모드 1회 실행으로 검색 성공률과 Daily 생성을 확인하는 절차가 남아 있다.
10. 남은 밸류체인 상위사의 그룹 마스터 확장. 홍콩 상장사(CALB, REPT)는 HKEXnews 연차보고서를 근거로 인정하기로 했으나 HKEX 수집 경로가 없다.

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
npm run check
node scripts/check-ingestion-guard.mjs
node scripts/check-json-recovery.mjs
node scripts/check-llm-search.mjs
node scripts/check-pipeline-status.mjs
node scripts/check-report-classification.mjs
node scripts/check-response-json.mjs
node scripts/check-chain-depth.mjs
node scripts/check-headline-hop-budget.mjs
node scripts/check-report-renewal.mjs
node scripts/check-report-synthesis.mjs
```

회귀 스크립트는 모두 네트워크를 가짜로 물려 돌리므로 API 과금이 없다.

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

### 2026-09-04 (4): 연차보고서 추출 보강
- 보고서 한 건에서 1~3건만 남던 원인 둘: (1) 운영 리더의 MD&A 자르기가 목차·감사보고서·과학기술윤리 항목의 같은 표제를 잡아 본문을 놓쳤다(룽바이 2024는 1,715자만 잡힘). `fetch-coverage.mjs`에서 먼저 고쳤던 규칙(뒤에 经营情况讨论与分析/主营业务分析 등이 곧 나오는 위치)을 `lib/report-reader.js`에도 적용. (2) 프롬프트가 "핵심만", 청크당 8건이었다.
- 바꾼 것: MD&A 6만 자 + 重要事项 절의 募集资金·重大合同 부분 2만 자를 덧붙임(`sliceMajorMatters`). 프롬프트는 "수치가 붙은 사실은 빠짐없이". 청크당 14건. 룽바이 2024로 검증: 절 4.9만 자(MD&A 4만 + 중요사항 0.9만).
- **보강 패스**: `report_digest.enriched_at`(실행됨)이 null인 보고서를 사실 적은 순으로 훅마다 3건씩 다시 읽고 새 사실만 더한다(`pickThinReport`/`enrichReport`). 중복은 제목 정규화 일치·포함 또는 같은 날짜에 숫자 집합 70% 겹침으로 판단(`sameFact`). 새로 읽는 보고서는 `enriched_at`을 바로 채운다.
- 현재 읽은 보고서 ~100건이므로 이틀 밤 정도면 보강이 끝난다. 끝난 뒤 회사별 이벤트 수를 다시 세어 기록할 것.

### 2026-09-06: 관리자 페이지(파이프라인 품질 점검)
- `/admin`(`app/admin.html`, `app/admin.js`, `api/admin.js`)을 추가했다. 입장 세션으로만 열리는 읽기 전용 화면이다. 개요 / 실행 이력 / 수집 기사·검색 결과 / 이벤트 / 청크·임베딩 / 벡터 검색 시험 여섯 패널과 기사 상세 서랍(본문 길이·요약·이벤트·청크별 임베딩 입력 텍스트와 원문 조각·벡터 유무·현행 규칙 재청킹 결과)이 있다.
- **선행 SQL: `supabase/admin-observability.sql`** — `article.discovered_via`(발견 경로, 검증 뒤에도 유지), `pipeline_log`(단계별 결과), `admin_overview()` 집계 함수. 되돌려진 검증 기사 33건도 복구한다. 이 SQL 없이는 개요·실행 이력이 502를 낸다. `headline_embedded_at` 열 추가도 들어 있어 `headline-knowledge.sql`이 아직 안 돌았어도 안전하다.
- 수집·본문 처리·Daily·유지 단계가 끝날 때 `lib/pipeline-log.js`로 `pipeline_log`에 결과를 남긴다. 수집 기록에는 경로별 원시 발견 수(OpenAI/DeepSeek/CATL/CNINFO), 검색 실패 사유, 중복 제거 후·회사 매칭·신규 저장 수, 신규 제목, 매칭 안 된 후보 표본이 들어간다. 본문 처리 기록에는 선별 기사·점수·결과·탈락 사유·청크 수가 들어간다.
- **수정한 버그**: 야간 수집 upsert가 `merge-duplicates`라서 이미 검증 통과한 기사가 다음 날 재발견되면 `verification_status=pending`, `source_tier=web_search_*`로 되돌아가 화면에서 사라졌다(CNINFO는 14일 창을 매일 다시 훑어 거의 항상 재발견). `ignore-duplicates`로 바꾸고 기존 행 id는 URL로 따로 찾아 회사 연결에 쓴다. 운영 DB에 33건이 그 상태였고 SQL이 복구한다.
- 같은 URL을 두 검색 제공자가 모두 찾으면 `discovered_via='web_search_deepseek+openai'`로 남긴다. 기존 dedup은 한 제공자만 남겼다.
- **확인된 품질 신호(운영 DB 2026-09-06 기준)**: DeepSeek 검색 발견 기사가 누적 0건이다. 검색 실패(`[WEB_SEARCH_FAILED]`)인지 결과가 전부 OpenAI와 겹치는지 다음 수집의 `pipeline_log.collect.raw`와 `failed`로 판별한다. `headline-knowledge.sql`이 운영에 적용되지 않아 유지 단계의 헤드라인 임베딩이 매일 실패하고 있다(`embed_headline.error`).
- 검증: `node --check`, `npm run check`(api 10개 모듈 로드) 통과. 화면은 목 API로 여섯 패널·서랍 렌더링 확인. 운영 API는 SQL 적용 후 배포해서 확인해야 한다.
- 함수 수: `api/*.js` 10개(Hobby 한도 12).

### 2026-09-06 (2): 배포가 나흘째 멈춰 있던 원인과 PDF 읽기 복구
- **배포가 네 번 연속 실패했다.** Vercel은 `api/` 아래 모든 `.js`를 함수로 센다. `api/lib/`의 supabase·access·google-news 3개를 더하면 Hobby 한도 12개에 정확히 걸려 있었고, `api/admin.js`가 더해지며 13개가 됐다. 빌드는 통과하고 "Deploying outputs"에서 실패해 원인이 화면에 드러나지 않았다. 세 파일을 루트 `lib/`로 옮겨 함수를 10개로 되돌렸다(`CLAUDE.md`의 "공유 코드는 루트 lib/에 둔다"와도 맞는다).
- **파급**: 그날 푸시한 커밋이 모두 배포되지 않았고, 운영은 9월 4일 빌드로 돌고 있었다. 그래서 같은 날 만든 DOMMatrix 폴리필(`1eb11a3`)도 적용되지 않아, 야간 curate가 정기보고서를 읽을 때마다 `DOMMatrix is not defined`로 전부 실패했다. 장부에 실패로 기록된 보고서가 9건, PDF 추출 실패 기사가 39건이다. 마지막으로 성공한 보고서 읽기는 9월 3일이다.
- 배포가 복구됐으므로 폴리필이 적용됐다. 오늘 밤 curate가 실패로 남긴 장부를 다시 집는지 확인할 것. `report_digest.report_url`이 `missing:` 또는 오류 문자열로 시작하는 행은 14일 뒤 재시도 대상이라, 필요하면 그 행을 지워 즉시 다시 읽게 할 수 있다.
- **Vercel 로그는 로컬 CLI로 본다**: `npx vercel logs china-battery-lens.vercel.app --scope dongiljeffjang-uxs-projects --json`, 배포 목록은 `npx vercel ls`, 실패 원인은 `npx vercel inspect --logs <배포 URL>`. CLI는 이 PC에 로그인돼 있다.
- **DeepSeek 검색 진단**: `DEEPSEEK_API_KEY`는 9월 2일부터 Production에 있다. 키 부재가 아니다. 같은 기간 OpenAI 검색 기사는 쌓였는데 DeepSeek 발견 기사는 0건이므로, 검색 호출이 매번 빈 출력이거나 오류로 끝난다는 뜻이다. `scripts/probe-web-search.mjs`로 키를 주고 한 번 호출하면 HTTP 상태·output 항목 종류·빈 출력 여부가 그대로 찍힌다. 배포된 새 코드는 수집 때마다 `pipeline_log`에 경로별 원시 발견 수와 실패 사유를 남기므로, 화면 "수집·분석 1회 실행"을 누른 뒤 관리자 페이지 실행 이력에서도 확인할 수 있다.

## 2026-09-07 변경 요약

전날(2026-09-06) codex가 커밋한 8건을 검토하고 보완했다. codex 변경의 원래 기록은 `docs/FIXES-2026-09-06-CODEX.md`에 있다.

### 수집 체인 잠금과 검색 예산

- `lib/ingestion-guard.js`가 수집 → 본문 처리 → Daily 체인을 UUID 리스 하나로 묶는다. 동시 시작은 409로 막힌다. 리스는 10분이고 단계마다 갱신되며 Daily가 끝나면 해제된다.
- 각 단계 훅은 `claimStage`로 한 번만 실행된다. 가드 배포 전인 2026-09-06 19:52에 같은 훅이 두 번 돌아 기사 4건이 중복 처리된 전례가 있다.
- `releaseRun`은 collection 리스뿐 아니라 그 실행이 만든 단계 claim 행까지 지운다. 만료된 남은 행도 함께 정리한다.
- 검색 요청 예산은 실행당 18회, 포맷 복구 4회다. AsyncLocalStorage로 요청별로 분리된다. **요청 횟수 상한이지 비용 상한이 아니다.** 제공자 내부 검색 도구 호출 수는 우리가 정하지 못한다.

### 검색 요청 분할

밸류체인 하나(회사 10~12곳)를 한 요청에 넣으면 모델이 검색만 반복하다 35초 안에 JSON을 못 냈다. 2026-09-06 19:51 로그에서 DeepSeek 세 그룹이 전부 실패하고 OpenAI도 한 그룹이 시간초과했다. `lib/china-sources.js`의 `SEARCH_GROUP_SIZE`(4)로 회사를 쪼개 요청 하나를 짧게 만든다. 31개사면 제공자당 9그룹이다.

### DeepSeek 검색 반복과 시간초과 (2026-09-07 09:28 전체 모드 분석)

같은 회사 묶음을 두 제공자가 동시에 검색하므로 OpenAI 결과가 그 그룹의 뉴스 풍부도 기준이 된다. 뉴스가 적은 그룹일수록 DeepSeek 검색 횟수가 7→12→17회로 늘고 입력 토큰이 4만→10만→20만으로 가속하며 35초를 넘겼다. 검색이 많은 요청은 JSON 형식도 깨져 복구가 필요했다. OpenAI는 같은 상황에서 4~5회에 그만둔다.

원인은 요청당 기사 상한을 DeepSeek이 목표로 여기는 것이다. 상한 계산에 하한 6이 있어 회사 1~4곳 그룹이 똑같이 6건을 요구했고, 묶음을 쪼개도 효과가 없었다. 대응:

- DeepSeek 묶음은 회사 3곳, 기사 상한은 회사당 1건(최소 2, 최대 6). OpenAI는 4곳·하한 6 유지.
- 검색 예산은 `plannedSearchRequests`로 실제 그룹 수에서 계산한다. 손으로 적은 18이 실제 20건보다 작아 2건이 굶었던 실수의 재발 방지.
- `scripts/check-search-plan.mjs`가 묶음 크기·전체 회사 포함·예산 관계를 고정한다.

아직 안 한 것: 본문 다운로드 실패 사이트(中财网, 大众日报 등 데이터센터 IP 차단 추정) 대응. 교차검증 기각 시 검증자가 함께 반환하는 수정본(title_ko·summary_ko)을 버리는 문제. 후자는 단일 모델 출력을 화면에 올리는 셈이라 제품 결정이 필요하다.

### DeepSeek 응답 처리

- 검색 중간 설명 텍스트를 최종 JSON과 분리해 파싱한다. 마지막 `message`만 최종 응답으로 본다.
- 산문에 섞인 JSON은 `lib/json-recovery.js`가 한 개만 추출하고 스키마·URL을 검증한다.
- 파싱이 실패하면 OpenAI에 도구 없는 포맷 정리 요청을 **한 번만** 보낸다. 원문에 없던 URL이 나오면 거부한다.
- DeepSeek 검색 응답 원문 보존은 **실패했을 때만** 한다. 성공까지 매번 저장하면 진단용 기록이 상시 비용이 된다. `DEEPSEEK_CAPTURE_RAW=1`이면 항상 저장한다.

### 파일럿 모드

`/api/ingest-rss?pilot=1`은 CATL·후난위넝·BTR 세 곳만, 요청당 기사 2건으로 돈다. GET은 실행 버튼 화면이고 POST만 과금된다. **파일럿은 Daily를 만들지 않는다.** 3개사 기사만으로 그날 운영 리포트를 덮어쓰면 안 되기 때문이다. 2026-09-06에 파일럿 실행이 오늘 Daily를 세 번 덮어쓴 전례가 있다.

### 리포트 분류

동박(铜箔)은 집전체이지 음극 활물질이 아니다. `lib/report-classification.js`가 동박만 언급된 항목을 양극재·음극재에서 `정책·공급망`으로 옮긴다. 활물질이 함께 언급되면 그대로 둔다. Daily 생성 시점과 저장된 리포트 표시 시점에 모두 적용된다.

### 실패 기록

`lib/pipeline-log.js`는 하위 결과에 `error`나 `failed` 상태가 있으면 실행 전체를 `partial`로 남긴다. 교차검증 기각(`rejected`)과 본문 미확보(`body_unavailable`, `body_too_short`)는 기사 자체의 결과이지 파이프라인 실패가 아니므로 `partial` 사유에서 제외한다.

### 2026-09-07 벡터 청크 사고

`knowledge_chunk`에 기사당 행이 2~3개인 것을 중복으로 오판하고 삭제 SQL을 실행해 `event_fact` 청크 7건을 지웠다. 실제로는 기사당 `article_chunk` 1건 + 이벤트별 `event_fact` 1건이 정상이고, `content_hash`에 이미 유니크 제약이 있어 **중복 청크는 애초에 발생할 수 없다.**

복구 경로를 확인하다 별개의 버그를 찾았다. 임베딩 백로그는 `knowledge_chunk.event_id`에 없는 `event` 행으로 계산하는데, 그 조회가 `order=occurred_at.desc&limit=500`이었다. 지워진 7건은 567~582위라 **조회 범위 밖이어서 영원히 백로그에 잡히지 않았다.** 청크를 잃은 오래된 이벤트는 무엇이든 같은 사각지대에 빠진다.

`lib/curation.js`의 `fetchEmbeddableEvents`가 전체를 1,000건 페이지로 훑도록 고쳤다. `api/embed-event.js`도 같은 함수를 쓴다. 이 수정이 배포되면 `/api/embed-event` 크론(UTC 16:00, KST 01:00)이 지워진 7건을 다시 만든다.

수동 확인·복구는 `scripts/restore-missing-event-chunks.mjs`를 쓴다. 기본은 목록만 출력하고 `--apply`를 붙여야 임베딩한다. 다만 로컬 `.env`의 값은 마스킹돼 있어 로컬에서는 실행되지 않는다.

**교훈**: `knowledge_chunk`의 행 수를 셀 때 `source_type`을 함께 봐야 한다. `article_chunk`, `event_fact`, `headline`, `daily_report`, `report_chunk`는 같은 `article_id`를 공유하는 별개 행이다.

## 2026-09-07 오후: 원문 보관·시점 검증·공시 전문 임베딩

### 원문 보관 정책 (사용자 결정)

- **언론 기사**: 원문은 저장하지 않는다(저작권). 대신 **한국어로 옮긴 본문을 문단 단위로 보관**한다.
  `lib/article-translation.js`가 본문(앞 9,000자)을 번역하고, `embedVerifiedArticle`이 그 문단을
  1,800자 조각으로 잘라 `article_chunk`에 넣는다. 조각마다 제목·요약 헤더를 붙인다. 번역이 실패하면
  예전처럼 요약 한 조각만 넣는다. 임베딩이 끝나면 `article.body_original`을 지운다.
  팩트체크 기각·임베딩 재시도 상한 도달 경로에서도 지운다(전에는 새고 있었다. 7건 삭제).
- **정기 공시**: 공개 자료라 **원문 전체를 text로 뽑아 임베딩**한다. 예전에는 관리층 논의·중요사항 구간만
  60조각까지 넣었다. 지금은 전문을 최대 400조각(약 60만 자)까지 넣는다. 한 훅에 120조각씩 이어 넣고
  진행은 `report_digest.embedded_chunks/embedded_total`에 기록한다(`supabase/report-embedding-ledger.sql`, 실행됨).
  임베딩 요청은 64개씩 나눠 보낸다(요청당 입력·토큰 한도).
- 공시 원문 임베딩(`report_chunk`)은 아직 0건이다. 다음 크론 curate 훅부터 채워진다. 117개 장부 중
  본문이 없는 것은 PDF를 다시 내려받아 채운다.

### 사건 시점 검증

2026-09-04 大众日报 특집이 2026-03-05 발표된 비야디 2세대 블레이드 배터리(9분 충전)를 소개했는데,
기사 발행일이 그대로 사건 시점으로 들어가 시계열이 6개월 어긋났다. 기사 이벤트 108건 전부
`occurred_basis`가 없고 그중 61건이 발행일과 같은 날짜였다. 기사 본문은 발표일을 적지 않았고
"此前", "介绍企业时" 같은 표현과 특집(会客厅) 형식만 있었다. 본문만으로는 정확한 날짜를 알 수 없고,
"과거 사실을 다시 소개하는 글"이라는 것만 알 수 있다.

대응 두 단계:

1. **추출 시**: `occurred_at`은 발행일이 아니라 사건 시점이라고 명시하고, 본문에 근거가 있으면
   `occurred_basis`에 원문 인용, `occurred_precision`에 정밀도를 적는다. 근거가 없으면 발행일을 쓰되
   `precision=month`, `basis=null`로 둔다. `retrospective`(회고성 기사) 플래그를 받아 근거 없는
   회고 기사는 `precision=year`로 낮춘다.
2. **재확인 훅**: `basis`가 null인 기사 이벤트를 회사 단위로 20건씩 웹 검색으로 재확인한다
   (`redateMissingArticleEvents`, curate 훅에 포함, 훅당 검색 요청 1회). 기사 발행일보다 뒤인 날짜와
   2015년 이전 날짜는 모델 오류로 보고 버린다. 시점이 바뀌면 이벤트 청크를 다시 임베딩한다.

비야디 건은 수동으로 2026-03-05로 고쳤다. 기존 기사 이벤트 108건은 다음 curate 훅들이 회사별로 훑는다.

## 2026-09-07 저녁: 수집 예절과 pending 재고 정리

### robots.txt 확인과 요청 간격

기사 본문 읽기는 검색으로 찾은 임의의 매체 페이지를 그대로 가져왔다. `lib/robots.js`를 두어
본문을 받기 전에 그 도메인의 `robots.txt`에서 우리 UA와 `*`에 대한 규칙을 본다.

- 막혀 있으면 본문을 읽지 않고 `processing_status='robots_disallowed'`로 남긴다. 헤드라인과
  검색 요약은 그대로 쓴다.
- 규칙 우선순위는 표준을 따른다. 이름을 지목한 그룹이 `*`보다 우선하고, 가장 긴 규칙이 이기며,
  같은 길이면 Allow가 이긴다. `*` 와일드카드와 `$` 종료 앵커를 지원한다.
- `Crawl-delay`가 있으면 그 간격을, 없으면 같은 도메인 연속 요청에 1.5초를 둔다.
- `robots.txt`가 401·403이면 전면 차단으로 본다. 404·5xx·연결 실패는 제한 없음으로 본다.
- 결과는 도메인당 24시간 캐시한다(함수 인스턴스 메모리).
- 거래소 공시(CNINFO·HKEX)와 CATL 뉴스룸은 이 경로를 타지 않는다. 법정 공개 자료와 회사가
  배포 목적으로 낸 자료다.
- 약관은 기계적으로 읽을 수 없다. 반복 등장 매체를 허용 목록으로 관리하는 것은 아직 안 했다.
- 검사: `node scripts/check-robots.mjs` (네트워크 없음).

### pending 재고 재검토

`verification_status='pending'` 861건을 훑어 세 가지를 찾았다.

1. **공시가 한 번도 분석되지 않은 진짜 원인.** `api/process-article.js`가
   `String(await extractPdfText(url))`로 받았는데 이 함수는 `{ text, pages }` 객체를 돌려준다.
   `"[object Object]"` 15자가 본문이 되어 항상 `body_too_short`로 떨어졌다. `.text`를 쓰도록 고쳤다.
   codex가 고친 `DOMMatrix` 오류(1eb11a3)와는 별개 버그다. 그 오류로 실패한 39건은 수정 이전
   (09-04~09-05)의 것이라 상태를 비워 다시 시도하게 했다.
2. **공시 257건이 3일 창 밖으로 밀려 있었다.** 공시는 뉴스와 시의성이 다르다.
   `DISCLOSURE_WINDOW_DAYS=45`로 창을 늘리고 `DISCLOSURE_PER_RUN=4`로 뉴스 Top 10과 몫을 나눴다.
   뉴스 자리를 뺏지 않으면서 재고를 조금씩 소화한다. 현재 대상 296건.
3. **상태 불일치 5건.** `processing_status='fact_check_rejected'`인데 `verification_status`가
   `pending`으로 남아 있었다. `rejected`로 맞췄다.

**정리하지 않은 것**: `google_news_rss`로 들어온 447건(2016~2026-09-01)은 `source_tier`가
`needs_review`라 본문 분석 필터를 통과하지 못한다. 지금은 없는 RSS 경로의 잔재다. 헤드라인
번역·Sankey에는 쓰이므로 지우지 않았다. 본문 분석 대상으로 살릴지 결정이 필요하다.

## 2026-09-07 밤: Google News 재고 삭제와 관리자 파이프라인 화면

### Google News RSS 447건 삭제

`discovered_via='google_news_rss'` 기사를 지웠다(article 447, article_company 491).
삭제 전 확인: 파생 데이터가 전혀 없었다(청크 0, 이벤트 0, 피드백 0, 처리 시도 0, 한국어 제목 0).
`canonical_url`이 전부 `news.google.com` 리디렉션 링크이고 `source_tier`가 `needs_review`라
본문 분석 필터를 통과하지 못했다. 지금 코드에는 RSS 수집기가 없어(`discoverChinaSources`의
수집기는 OpenAI 검색·DeepSeek 검색·CATL 뉴스룸·CNINFO 넷) 다시 채워지지도 않는다.
`embedPendingHeadlines`가 이들을 번역 큐에 넣어 2016년 기사까지 번역 비용을 쓸 참이었다.

**제목은 있었다.** `title_original`이 채워져 있어 헤드라인 번역·Sankey 재료로는 쓸 수 있었다.
다만 2016~2026-09-01에 걸쳐 있어 최근 신호를 보는 화면(기본 3일 창)에는 거의 잡히지 않았다.
되살리려면 RSS 수집기를 다시 만들어야 하며, 그때는 `source_tier`를 필터가 받는 값으로 넣어야 한다.

### 관리자 · 파이프라인 메뉴

`/admin#pipeline`에 소스·프롬프트·단계·보관 정책을 보는 화면을 열었다.

핵심 규칙: **화면에 값을 옮겨 적지 않는다.** `lib/pipeline-manifest.js`가 실제 실행 모듈에서
상수와 프롬프트를 import 해 그대로 내보내고, `api/admin.js?view=pipeline`이 그것을 돌려준다.
코드가 바뀌면 화면도 같이 바뀐다. 이를 위해 프롬프트를 정의 위치에서 내보내도록 옮겼다.

| 상수 | 위치 |
|---|---|
| `ARTICLE_ANALYSIS_PROMPT_BODY`, `ARTICLE_FACT_CHECK_PROMPT`, `ARTICLE_DATE_GUIDE` | `api/process-article.js` |
| `DAILY_REPORT_PROMPT` | `api/generate-daily.js` |
| `searchProviderPrompt()`, `searchInstructions()` | `lib/china-sources.js` |
| `ARTICLE_TRANSLATION_PROMPT` | `lib/article-translation.js` |
| `FACT_EXTRACTION_PROMPT` | `lib/fact-extraction.js` |
| `CONCEPT_EDGE_PROMPT` | `lib/concept-graph.js` |
| `HEADLINE_TRANSLATION_PROMPT` | `lib/headline-knowledge.js` |
| `REDATE_INSTRUCTIONS`, `ARTICLE_REDATE_INSTRUCTIONS` | `lib/event-backfill.js` |

화면 구성: 요약 카드 4개(추적 회사·검색 요청·소스 수·임베딩 조각), 수집 소스 6곳(가져오는 곳·모델·
API 키 설정 여부·묶음 수·robots 정책·저장 위치), 단계 5개와 각 단계의 프롬프트 전문(접었다 펴기),
원문 보관 정책 표. 읽기 전용이며 DB를 건드리지 않는다.

프롬프트를 옮긴 뒤 `npm run check`와 회귀 스크립트 8개로 순환 참조·구문을 확인했고,
로컬 임시 서버로 화면을 띄워 렌더링을 눈으로 확인했다.

## 2026-09-08 방향: 기업 분석에 사업 관계망 추가

### 결정

기업 분석 화면의 "연차보고서 핵심 사실" 위에 **선택한 회사의 사업 관계망**을 넣는다.
사용자가 누르면 작은 새 창에서 연다. 개념 관계망이 아니라 **사업 관계 중심**으로 간다.

노드와 엣지는 `event_fact`에서 나온다.

- 노드: 추적 회사(`company_id`)와 상대방(`counterparty`)
- 상대방 종류(`counterparty_kind`): oem, cell, material, resource, government, other
- 엣지 이름(`relation`): 지정, 공급, 합작, 구매약정, 탑재, 인증, 투자
- 근거: `excerpt`, `occurred_at`, `fact_type`, `source_tier`

### 먼저 한 일: 추출을 실제로 돌게 만들었다

`extractMissingFacts`가 **유지 훅에 연결돼 있지 않았다.** 그래서 이벤트 585건 중 10건(1.7%)만
추출돼 있었고, 상대방이 있는 사실은 9건뿐이었다. 관계망을 그릴 데이터가 없던 이유다.

`runCurationHop`에 넣고, 관계망의 재료이므로 이벤트 임베딩 바로 다음(앞쪽)에 둬 42초 예산을
먼저 받게 했다. 훅 종료 판정(`more`)에도 `facts.remaining`과 `redate_article.remaining`을 더해
잔량이 남으면 훅이 이어지게 했다.

처리량은 훅당 6건 × 4호출 = 24건이고 훅은 최대 40회 이어지므로, 남은 575건은 하룻밤에 소화된다.
비용은 사실 추출 약 98회 호출이다(개념 추출까지 함께 돌면 약 190회).

즉시 돌리려면 `/api/ingest-rss?curate_run=1`을 POST 한다. 그러지 않으면 23:00 KST 크론이 돈다.

### 다음 단계 (데이터가 찬 뒤)

화면 설계는 아래로 합의했다. 구현은 추출 결과를 보고 시작한다.

- 사용자 선택권 네 가지: 관계 종류(사업/개념/둘 다), 기간(1년·3년·전체), 최소 근거 수(1회/2회 이상),
  계열사 포함 여부. 레이어 필터와 관계 유형 개별 선택은 손잡이가 잘아 넣지 않는다.
  비교 회사 겹쳐 보기는 단독 회사 그림이 쓸 만해진 뒤에 붙인다.
- 창: `window.open`으로 960x720 팝업, 주소는 `/graph?company=<id>`.
- 제약: Vercel 함수 수 제한 때문에 새 `api/*.js`를 만들지 않는다. 데이터는 기존 `/api/company`에
  `mode=graph`를 더해 받는다. 화면은 `app/graph.html` 하나와 `vercel.json` 재작성 한 줄.
- 그리기: 외부 라이브러리 없이 SVG 힘기반 배치를 직접 넣는다. 노드가 수십 개라 충분하고
  이 저장소가 프런트 의존성을 쓰지 않는 것과도 맞는다.
- 벡터 유사도는 엣지로 쓰지 않는다. "닮았다"는 사실 관계가 아니고 CATL은 청크가 175개라
  털뭉치가 된다. 주제 묶음(배경 영역)에만 쓸지는 나중에 정한다.

## 2026-09-08: 보고서 표를 헤더와 함께 청크로 만든다

### 문제

연차보고서 PDF의 표가 뭉개져 들어가고 있었다. 추출기가 pdfjs 텍스트 조각을 `join("")`로
이어 붙여 행 구분도 셀 구분도 사라졌다. CATL 2025년 연차보고서 11쪽의 실제 결과:

```
项目 2025年 2024年 本年比上年增减 2023年营业收入 423,701,834 362,012,554 17.04% 400,917,045归属于上市公司股东的净利润 72,201,282 ...
```

앞 행의 마지막 숫자(`400,917,045`)와 다음 행 항목명이 한 덩어리가 된다.

여기에 청킹이 표를 몰랐다. `chunkArticleBody`는 1,800자 고정 폭으로 자르고 `。`·마침표에서만
경계를 맞추는데, 시작할 때 `replace(/\s+/g," ")`로 줄바꿈까지 뭉갠다. 재무표처럼 마침표가 없는
구간은 정확히 1,800자에서 잘린다. 그러면 헤더 행은 앞 청크, 데이터 행은 뒷 청크로 갈라져
**그 조각만 보면 어느 숫자가 몇 년도인지 알 수 없다.**

### 수정

- `lib/report-reader.js`의 `pageToLines()`: y좌표로 같은 줄을 묶고 x 간격 6pt 이상을 셀 경계로 본다.
  파이프는 **간격이 두 번 넘게 벌어지고 숫자가 있는 줄에만** 넣는다. 산문과 표제에 파이프가 섞이면
  절 찾기와 읽기가 나빠지기 때문이다. 줄은 줄바꿈으로 잇는다.
- 절 자르기의 `replace(/\s{2,}/g," ")`를 `[ 	]{2,}`로 바꿔 줄바꿈을 살린다.
- `lib/vector-ingestion.js`의 `chunkStructuredText()`: 줄 단위로 담고 **표 행을 중간에서 쪼개지
  않는다.** 표가 여러 청크에 걸치면 청크마다 헤더 행을 다시 붙인다. 산문은 문단(줄) 단위로 담는다.
  보고서 임베딩과 기사 한국어 번역 임베딩이 이 함수를 쓴다.
- `scripts/check-report-tables.mjs`가 동작을 고정한다(네트워크 없음).

### 검증 (CATL 2025년 연차보고서, 232쪽)

```
项目 | 2025年 | 2024年 | 本年比上年增减 | 2023年
营业收入 | 423,701,834 | 362,012,554 | 17.04% | 400,917,045
```

행 붙음 없음, 청크 126개 평균 1,771자, 표 행 중간 절단 0건, 관리층 논의 절 31,614자 유지.

### 타이밍

`report_chunk`가 0건이고 `report_digest.body_original`도 117건 전부 비어 있는 상태에서 고쳤다.
공시 원문 임베딩이 아직 한 번도 돌지 않았으므로 **처음부터 제대로 들어간다.** 기존 장부는 본문이
비어 있어 임베딩 때 PDF를 새 추출기로 다시 내려받는다. 옛 형식으로 저장된 본문은 없다.

## 2026-09-08: 유지 훅이 60초를 넘겨 체인이 끊기던 문제

수동 백필이 훅 4에서 멈췄다. 훅 4의 소요가 **81,922ms**로 Vercel 함수 한도 60초를 넘겨
함수가 죽었고, 다음 훅 호출이 나가지 못해 체인이 거기서 끝났다. 40훅까지 이어져야 하는데
4훅만 돌았다.

원인은 예산 확인이 성기었다. `extractMissingFacts`와 `extractMissingConcepts`가 배치를 시작하기
전에 `Date.now() > deadline`만 봤다. LLM 호출 하나가 20~40초 걸리므로 41초에 시작한 호출이
40초를 더 쓰면 훅이 80초가 된다.

호출 하나 분량(`CALL_BUDGET_MS` 30초)을 남겨 두고 멈추도록 바꾸고, 호출 자체에도 30초 상한을
줬다. 훅당 처리량은 12건에서 6건으로 줄지만 체인이 40훅까지 살아 있으므로 하룻밤 총량은 오히려
늘고, 공시 임베딩·시점 재확인·개념 추출도 예산을 받는다.

### CATL 연차보고서 확보 현황 (질문 확인)

2024년 연차보고서는 확보돼 있다. 2025-03-14 공시 PDF가 장부에 있다. 다만 뽑아낸 사실이 4건뿐이라
화면이 비어 보인다. 2025년 연차는 11건, 반기는 7~9건이다.

| 보고서 | 공시일 | 뽑은 사실 | 보강 여부 |
|---|---|---|---|
| 2026 반기 | 2026-07-24 | 9 | 미실행 |
| 2025 연차 | 2026-04-30 | 11 | 미실행 |
| 2025 반기 | 2025-07-30 | 7 | 미실행 |
| **2024 연차** | **2025-03-14** | **4** | **미실행** |
| 2024 반기 | 2024-07-26 | 7 | 미실행 |

전체로는 연차 45건(23개사), 반기 59건(22개사)이 PDF로 확보됐고 읽기 실패는 연차 5건(3개사),
반기 8건(4개사)이다. 즉 **문제는 보고서 확보가 아니라 얇게 읽힌 것**이다.

`enriched_at`이 전부 비어 있어 보강 패스(`pickThinReport`)가 한 번도 돌지 않았다. 이 패스는
`events_inserted` 오름차순으로 고르므로 CATL 2024 연차(4건)가 앞순위 후보다. 체인이 살아나면
자동으로 다시 읽힌다.

## 2026-09-08: 유지 훅을 한 훅에 무거운 단계 하나로 바꿨다

앞선 수정(호출 분량 남기기)만으로는 부족했다. 재실행에서도 훅이 97초·88초를 써서 2훅에서 끊겼다.

원인은 구조였다. 한 훅이 무거운 단계 여섯 개를 차례로 **전부 시도**했다. LLM 호출 하나가
25~40초라 두세 단계만 돌아도 60초 함수 한도를 넘는다. 단계 사이 예산 확인은 단계가 끝난 뒤라
이미 늦다. 실제 로그에서 헤드라인 번역 한 단계가 40건을 돌려 예산을 다 먹었고, 그 뒤 사실 추출은
30초 상한에 걸려 실패했다.

**한 훅은 무거운 단계 하나만 맡는다.** 훅 번호로 돌아가며 고른다.

```
facts → embed_report → embed_article → embed_headline → redate_article → concepts → (반복)
```

- 값싼 단계(`embedMissingEvents`, 임베딩 API만 사용)는 매 훅 돈다.
- 보고서 읽기·웹 백필·보강은 예산이 남을 때만, 한 훅에 한 건만.
- 체인 계속 여부는 `pendingWork()`가 큐마다 한 행씩 집어 존재만 확인해 정한다. 이번 훅이
  건드리지 않은 큐에 일이 남아 있어도 체인이 이어진다. LLM을 부르지 않아 비용이 없다.
- 사실·개념 추출의 호출 상한을 30초에서 40초로 올렸다. 30초는 6건 배치에 빠듯해 timeout이 났다.

훅당 처리량은 줄지만 체인이 40훅까지 살아 총량은 늘고, 그동안 한 번도 실행되지 못했던
공시 원문 임베딩과 보고서 보강이 자기 차례를 받는다.

## 2026-09-08: 훅 재구성 뒤 드러난 두 가지

훅을 "하나에 무거운 단계 하나"로 바꾸자 소요가 16초·52초로 한도 안에 들어왔다. 그러면서 가려져
있던 문제 둘이 드러났다.

### 1. 사실 추출이 0건을 처리했다

예산 여유 검사(`deadline - CALL_BUDGET_MS`)를 첫 배치에도 적용한 것이 문제였다. 훅 예산이
42초인데 40초를 남기면 2초만 남는다. 앞의 값싼 단계가 몇 초만 써도 곧바로 break 해서 한 건도
처리하지 못한다. 실제로 `remaining: 25`인데 `events: 0`이었다.

- 첫 배치는 무조건 돌리고, 여유 검사는 두 번째 배치부터 한다.
- 유지 훅 예산을 42초에서 **50초**로 올렸다(`CURATE_BUDGET_MS`). 훅이 무거운 단계를 하나만
  맡으므로 60초 한도에서 체인 넘김 여유만 남기면 된다. 수집·본문 처리 단계는 42초 그대로다.

### 2. 보고서 읽기가 pdfjs 워커를 못 찾았다

`digest` 단계가 `Setting up fake worker failed: "Cannot find module ..."`로 실패했다.
Node에는 워커가 없어 pdfjs가 가짜 워커를 쓰는데, 그때 `pdf.worker.mjs`를 동적 import 한다.
Vercel 번들에 그 파일이 없으면 죽는다. 로컬에는 있어서 재현되지 않았다.

- `lib/report-reader.js`에 `loadPdfjs()`를 두고 `GlobalWorkerOptions.workerSrc`에 워커 경로를
  명시한다. pdfjs 모듈은 한 번만 불러 재사용한다.
- `vercel.json`의 `functions.includeFiles`로 워커 파일을 함수 번들에 포함시킨다.
  대상은 PDF를 읽는 `api/ingest-rss.js`, `api/process-article.js`, `api/company.js`다.

이 둘이 그동안 공시 원문 임베딩과 보고서 보강이 한 번도 성공하지 못한 이유다.

## 2026-09-08: 보고서 읽기도 독립 유지 훅으로 분리

운영 백필 재실행에서 훅 1(`facts`)이 78.2초, 훅 2(`embed_report`)가 110.7초 걸리고 체인이
중단됐다. payload를 확인하니 훅 1은 XTC 반기보고서 21건, 훅 2는 Zhenhua New Material
반기보고서 25건을 각각 추가로 읽었다. 순환 작업을 하나만 고른 뒤에도 `digestCompany()`가
예산이 남았다는 이유로 같은 훅에서 실행돼, 실제로는 무거운 작업이 둘이었다.

- `digest`, `web`, `enrich`를 `HEAVY_TASKS`에 편입했다. 이제 사실 추출·보고서 임베딩 등과
  같은 순환에서 각자 독립 훅을 받는다.
- `pendingWork()`가 보고서 커버리지·웹 백필·얇은 보고서 보강 잔량도 확인해, 이 작업들이
  자기 차례 전에 체인이 끝나지 않게 했다.
- `scripts/check-curation-single-heavy.mjs`를 추가해 순환 작업 뒤 두 번째 보고서 작업이 다시
  붙는 회귀를 막았다.
- `scripts/check-llm-search.mjs`는 앞 단계에서 의도적으로 남긴 실패 캡처까지 성공 검색 캡처로
  잘못 세던 검사를, 성공 호출 전후 캡처 수 비교로 고쳤다.

후속 운영 백필에서 훅 1~3은 34.2초·16.9초·3.6초로 정상화됐지만, 훅 4의 헤드라인 번역이
80건(40건 × 2회)을 처리하며 95.8초 걸렸다. 헤드라인 번역을 훅당 30건·LLM 1회로 제한하고
`scripts/check-headline-hop-budget.mjs`로 이 상한을 고정했다.

추적 범위는 셀 10·양극재 10·음극재 5, 총 25개사로 좁혔다. `COMPANIES` 전체 마스터와 기존
이벤트·벡터는 보존하고 `TRACKED_COMPANIES`만 신규 웹 검색, CNINFO 수집, 보고서·웹 백필과
기본 회사 목록에 사용한다. 양극재는 SNE 순위 확인 7개사와 XTC·Easpring·Zhenhua를 유지하고,
음극재는 SNE 1~5위만 유지한다. 비활성 기업은 직접 ID 조회 시 과거 데이터를 계속 볼 수 있다.

## 2026-09-08: PDF 이미지 도표 완전성 표시

pdfjs의 텍스트 레이어만으로는 이미지로 삽입된 표·그래프 수치를 읽을 수 없는데도, 기존
`report_chunk`가 보고서 전체를 대표하는 것처럼 보이는 문제가 있었다.

- 새 보고서 전문 임베딩은 기본 중지했다. 필요할 때만 Vercel 환경변수
  `REPORT_TEXT_ONLY_EMBEDDING=1`로 명시적으로 허용한다.
- PDF 페이지의 연산 목록에서 페이지 면적 10% 이상의 이미지를 탐지해 페이지 번호와
  `visual_review_required` 상태를 `report_digest`에 기록한다.
- 벡터 답변에 `report_chunk`가 포함되면 `[텍스트 전용 PDF]`로 모델에 전달하고, 화면에도
  이미지 도표 미분석으로 보고서 전체를 대표하지 않는다는 경고를 표시한다.
- 기존 청크와 이벤트는 삭제하지 않는다. 운영 DB에는 `supabase/report-visual-quality.sql`을
  먼저 적용해야 품질 상태가 저장된다. 미적용 상태에서도 핵심 파이프라인은 실패하지 않도록
  품질 메타데이터 PATCH만 독립적으로 실패 허용한다.

## 2026-09-07: 핵심 상장사 정기보고서 갱신 큐 (`a3a79bf`)

2024년 이후 연차·반기보고서를 **삭제 없이** 다시 내려받아 새 추출 규칙으로 읽고 새 이벤트만
더하는 큐를 넣었다.

- `pickRenewalReport()`가 `TRACKED_COMPANIES` 중 거래소 코드가 있는 회사의 `renewed_at is null`
  · `published_at >= 2024-01-01` 행을 최신순으로 고른다. `missing:`·`web:` 태그 행은 건너뛴다.
- `renewReport()`는 기존 `storeEvents` 경로로 저장하므로 중복 방지가 그대로 걸린다. 결과를
  `renewed_at`·`renewal_status`·`renewal_inserted`·`source_sha256`에 적고 `events_inserted`를 더한다.
- `extractPdfText()`가 내려받은 PDF 바이트의 SHA-256을 함께 돌려준다. 같은 URL을 다시 읽었을 때
  원본이 바뀌었는지 판별하는 근거다.
- `renew`는 `HEAVY_TASKS`에 들어가 자기 훅을 따로 받고, `pendingWork()`가 잔량을 확인한다.
- 검사: `scripts/check-report-renewal.mjs`(삭제 없음·해시 기록·스키마 컬럼 고정).

## 2026-09-07: 훅이 다시 60초를 넘긴 두 지점 (`42c5b5b`)

`CURATE_BUDGET_MS` 50초는 훅 본체 기준이라 그 뒤의 로그 기록·대기열 확인·다음 홉 호출까지
합치면 60초를 넘긴 사례가 나왔다. **45초로 내렸다.**

헤드라인 번역도 한 호출에 30건을 묶으면 번역 뒤 기사별 상태 기록까지 48초가 걸려 체인 넘길
시간이 남지 않았다. `TITLES_PER_CALL`을 **10건**으로 줄였다. 훅당 처리량은 줄지만 야간 크론이
40훅까지 도므로 며칠이면 밀린 분이 소화된다. `scripts/check-headline-hop-budget.mjs`가 상한을
고정한다.

## 2026-09-07: 수동 백필을 브라우저가 홉 단위로 부른다 (`7255b76`)

화면의 "시계열 백필 1회 실행"은 서버가 자기 자신을 이어 호출하는 방식이었다. **Vercel은 같은
함수의 5번째 재귀 호출을 508 Loop Detected로 막는다.** 그래서 수동 백필이 늘 4홉에서 끊겼다.

- `POST /api/ingest-rss?curate_step=1&hop=N`을 새로 열었다. 한 홉만 돌고 결과(`more`, `task`)를
  돌려줄 뿐 다음 홉을 스스로 부르지 않는다.
- `app/app.js`의 `runTimelineBackfill()`이 `more`가 false가 될 때까지 최대 40번 순차 호출하고
  진행률을 버튼에 표시한다. **탭을 닫으면 다음 홉이 시작되지 않는다.** 확인 문구에 그렇게 적었다.
- 기존 `?curate_run=1`은 크론·내부용으로 남겼다.

## 2026-09-07: Daily의 사실과 해석을 화면에서 분리 (`c82f390`)

`sections`(사실)에 "산업 총평" 카테고리가 있어 해석이 사실 영역으로 새어 들어왔다.
`CLAUDE.md`의 "사실과 해석은 컬럼과 화면 영역을 분리한다"에 어긋난다.

- `SUMMARY_CATEGORIES`에서 "산업 총평"을 빼 셀·양극재·음극재·정책·공급망 넷으로 한정하고,
  스키마 `maxItems`도 4로 내렸다. 프롬프트에 "sections에 산업 총평이나 해석을 만들지 않는다"를 적었다.
- 해석 쪽 머리글을 "오늘의 그림" → **"산업 총평"**으로 옮겼다. `headline_ko`는 한 회사 실적을
  나열하지 말고 여러 회사를 연결·대조해 두세 문장으로 종합하도록 프롬프트를 고쳤다.
- 화면은 해석(`#daily-insight`)을 사실 목록 위로 올렸다. 옛 리포트가 남긴 "산업 총평" 섹션은
  사실 영역에서 "주요 사실"로, "오늘의 그림"은 해석 영역에서 "산업 총평"으로 렌더링한다.
- 검사: `scripts/check-daily-industry-summary.mjs`.

## 2026-09-07: 갱신 결과에 품질 메타가 비어 있던 버그

운영 DB에서 갱신 큐를 확인하다 찾았다. 첫 갱신 성공 건(farasis 2026 반기, 이벤트 47건 추가)의
`source_sha256`이 null이고 `visual_pages`가 빈 배열이었다.

원인은 `lib/event-backfill.js`의 `digestReport()`가 호출자에게 돌려주는 `report` 객체를
`{url, title, published_at, pages, text, section}`으로 **줄여서** 만들고 있던 것이다.
`readReport()`는 `parse_quality`·`visual_pages`·`source_sha256`을 채워 주는데 여기서 떨어졌다.

그래서 `digestReport`를 쓰는 세 경로가 모두 영향을 받았다.

| 경로 | 증상 |
|---|---|
| `renewReport` | `source_sha256` 저장 안 됨. `renewal_status`가 항상 `renewed_text_only` |
| `runDueReport` | `parse_quality`가 항상 `text_only`, `visual_pages` 항상 `[]` |
| `enrichReport` | 같음 |

즉 `ab8415b`이 넣은 이미지 도표 완전성 표시가 **보고서를 읽는 모든 경로에서 무력화돼 있었다.**
`embedReportChunks`가 PDF를 직접 다시 내려받는 경로만 정상이었다.

`digestReport`가 세 필드를 그대로 넘기도록 고쳤고, `scripts/check-report-renewal.mjs`가
반환 객체에 세 필드가 있는지 확인한다. 이미 `renewed_text_only`로 기록된 행은 해시가 없으므로,
필요하면 `renewed_at`을 비워 큐에 되돌린다.

## 2026-09-07 저녁: "60초 한도"는 없었다 — 체인이 끊긴 진짜 원인과 유지 훅 재설계

### 확인한 사실 (운영 로그 `pipeline_log` + Vercel 문서)

1. **함수 한도는 60초가 아니라 300초다.** 이 프로젝트는 2026-09-01 생성이라 Fluid compute가 기본이고,
   Fluid의 Hobby 한도는 기본·최대 300초다. 게다가 `api/*.js` Node 함수는
   `export const config = { maxDuration }` 형식만 읽는다. 그동안 써 온 `export const maxDuration = 60`은
   **무시돼** 왔다. 78·95·102·110초짜리 유지 훅이 죽지 않고 로그까지 남길 수 있었던 이유다.
2. **체인이 4훅에서 끊긴 원인은 508 Loop Detected다.** 서버가 자기 자신을 이어 부르는 체인은 훅 소요가
   3초든 110초든 예외 없이 4훅(내부 호출 4번)에서 멈췄다(09-06 10:15, 09-07 02:18·02:36·03:23·03:36·
   04:08·04:46·04:54 실행 전부). codex가 찾은 대로 5번째 내부 호출을 Vercel이 거부한다.
3. **야간 크론의 유지 단계는 한 번도 돌지 않았다.** 09-06 14:19 크론 체인은 수집 → 본문 훅 1·2·3 →
   Daily로 내부 호출 4번을 다 썼고, 그 다음 `curate` 훅 1은 5번째 호출이라 나가지 못했다.
   `pipeline_log`에 그날 밤 `curate` 행이 없다.
4. 그러므로 09-07에 한 "훅 예산 50→45초", "헤드라인 30→10건", "호출 상한 30초" 같은 조정은 잘못된
   전제 위의 대응이었고, 오히려 정상 완료될 보고서 읽기(45초 기본 timeout)·웹 백필(35초)을 중단해
   `The operation was aborted due to timeout` 실패를 만들고 있었다(룽바이 2024 반기 보강, CATL 2026 웹 백필).

### 바꾼 것

- `api/ingest-rss.js`·`api/company.js`: `export const config = { maxDuration: 300 }`로 올바른 형식 명시.
- **훅을 한 호출 안에서 이어 돌린다.** `runProcessStage`·`runCurateStage`가 `INVOCATION_BUDGET_MS`(170초)
  동안 훅을 반복하고, 예산이 다하면 그때만 자신을 한 번 더 부른다. 내부 호출 깊이는 `chain=` 쿼리로
  세어 `MAX_CHAIN_DEPTH`(4)를 넘기지 않는다(넘기면 `[STAGE_CHAIN_DEPTH_CAP]` 로그와 `skipped` 기록).
  크론 한 번에 유지 훅이 이제 약 10~12회 돈다(호출 2번 × 5~6훅).
- 훅 예산 `CURATE_BUDGET_MS` 45→90초, 본문 훅 `STAGE_BUDGET_MS` 42→60초.
- 보고서 읽기 LLM 호출에 `REPORT_LLM_TIMEOUT_MS`(85초), 웹 백필 검색에 `WEB_LLM_TIMEOUT_MS`(60초)를 명시.
  `digestReport`·`backfillCompanyEvents`가 `timeoutMs`를 받는다.
- **시간 초과는 실패로 못 박지 않는다.** 보강(`enriched_at`)·갱신(`renewal_status=failed`)은 timeout이
  아닌 오류에만 기록하고, timeout이면 다음 순환에서 다시 집는다(`isTimeoutError`). 정기보고서는 한 번만
  제대로 들어오면 되므로, 느린 호출 한 번 때문에 영영 건너뛰는 일을 막는다.
- 헤드라인 번역 `TITLES_PER_CALL` 10→30 복원.
- 검사: `scripts/check-chain-depth.mjs`(깊이 상한·호출 내 반복·훅 단위 재귀 금지),
  `scripts/check-headline-hop-budget.mjs`(호출 예산 + 마지막 훅 + 여유 ≤ 300초, `config` 형식).
- 수동 백필(화면 버튼)은 그대로 브라우저가 홉 단위로 부른다. 홉당 최대 90초.

### 다음 밤 확인할 것

- `pipeline_log` `stage='curate'`가 크론 실행(`trigger` 없음, `chain_depth` 3~4)에서 10건 안팎 생기는지.
- `duration_ms`가 300,000을 넘는 행이 없는지. 넘으면 `INVOCATION_BUDGET_MS`를 내린다.
- `enrich`·`web`의 `error`에 timeout이 사라졌는지.

## 2026-09-07 저녁: 비교 리포트 함의 종합

기업 비교 화면의 "지난 리포트" 목록에서 비교 리포트를 2~6건 골라 **리포트들을 가로지르는 함의**를
OpenAI가 종합한다. 결과는 같은 목록에 `함의 종합` 배지로 저장돼 다시 열 수 있다.

- 목록은 30건씩 읽고 **더보기**로 이어 붙인다(`/api/company?compare_history=1&offset=N`, `has_more`).
- `POST /api/company` `mode=synthesize_reports`, `historyIds: [...]`. 재료는 `kind='compare'` 행만이다.
  종합을 다시 종합에 넣지 않는다 — 해석 위에 해석을 쌓으면 근거에서 여러 단계 건너뛴 결론이 된다.
- `lib/compare-report.js` `buildReportSynthesis()`: 웹 검색 없이 저장된 리포트만 근거로 쓴다.
  출력은 `threads`(두 건 이상에서 되풀이되는 흐름)·`contrasts`(갈리는 지점)·`korea_implications`
  (한국 셀·양극재·음극재 관점)·`limits_ko`(이 종합의 한계). 모든 항목에 `basis_ko`(회사명·수치 한 문장)와
  `report_refs`(재료 리포트 번호)가 붙는다. 프롬프트 `REPORT_SYNTHESIS_PROMPT`는 관리자 파이프라인 화면
  6번 단계에 노출된다.
- 화면: 목록 항목의 체크박스로 고르면 선택 순서가 `R1`·`R2`… 배지가 되고, 그 번호가 문서의 근거 표기와
  같다. 문서 머리에 "해석"임을 적고, 인쇄(PDF)는 비교 리포트와 같은 패널·같은 CSS를 쓴다.
- 저장: `compare_report_history`에 `kind='synthesis'`, `source_history_ids`, `title_ko`로 남긴다.
  **`supabase/report-synthesis.sql` 적용이 먼저다**(5절).
- 검사: `scripts/check-report-synthesis.mjs`.

## 2026-09-07 저녁: 핵심(core) 등급은 거래소 공시에만 준다

기업 시계열의 기본 화면은 `timeline_eligibility='core'`만 보여 주고, `reference`는 "보조 데이터 포함"을
켜야 보인다. 그런데 그 등급을 **모델이 골랐다.** 추출 프롬프트에 "단일 제3자 언론 기사만으로는 core로
두지 않는다"가 있었는데도 11건이 `core`로 들어와 있었다.

| 출처 | 건수 |
|---|---|
| CATL 뉴스룸(`catl.com/news/...`) | 5 |
| 新浪财经의 회사 공고 전재(BYD 4, XTC 1 중 4건) | 4 |
| Gotion 자사 홈페이지 뉴스 | 1 |
| Schaeffler 보도자료 | 1 |

전부 거래소에 제출된 공시 원문이 아니다. 회사가 자기 채널에 낸 보도자료는 1차 출처처럼 보이지만
법정 공시가 아니고, 우리가 CNINFO에서 원문을 받아 대조한 것도 아니다.

- **등급은 서버가 정한다.** `api/process-article.js`가 `isDisclosure`(source_tier가
  `official_disclosure`이거나 URL이 PDF)면 `core`, 그 밖에는 모두 `reference`로 저장한다.
  모델 값은 `exclude`(시계열에 넣지 말 것)만 존중한다.
- 프롬프트도 "core는 고르지 않는다 — 공시 여부는 서버가 판단한다"로 바꿨다.
- 운영 DB의 11건을 `reference`로 고쳤다. 이제 `core`는 `annual_report` 235 + `periodic_report` 300
  = 535건이고 전부 거래소 원문에서 나온 것이다. `reference`는 기사 110 + 웹 백필 49 = 159건이다.
- 임베딩은 다시 만들지 않았다. 청크 본문에 등급이 들어가지 않는다.
- 검사: `scripts/check-evidence-grade.mjs`.

**화면에 보이는 변화**: CATL 뉴스룸 발표는 기본 화면에서 빠지고 "보조 데이터 포함"을 켜야 보인다.
CATL은 뉴스룸이 유일한 자체 수집 경로라 기본 화면의 최근 이벤트가 눈에 띄게 줄어든다. 정기보고서에서
뽑은 사실은 그대로 남는다.

## 2026-09-07 밤: 표 오독 — 실제로 있었던 것, 고친 것, 남은 것

사용자가 걱정한 형태(표가 "78,000 210,000 390,000 헬스 55,000 …"처럼 행·열 구분 없이 숫자 나열로
읽히는 것)를 저장된 보고서 원문 5건(표 행 ~1,160개)에서 직접 셌다. 결과는
`docs/VECTOR-VERIFICATION-PLAN.md` 8.4절. 요약:

| 형태 | 빈도 | 상태 |
|---|---|---|
| 행이 통째로 뭉개짐(파이프 없이 숫자 나열) | 표 행의 0~1.6%(9개) | 새 `pageToLines`가 대부분 잡음. 남은 9개는 숫자끼리 붙어 더 나쁨(`525.3530,302,917.96`) |
| 셀 두 개가 붙음(`全资子公司114,252.25`) | 보고서당 43~154줄 | **가장 흔함** |
| 단위 머리(`单位：万元`)가 행에서 떨어짐 | 보고서당 137~183개 | **실제 사고 원인** — Farasis 보증 표 5건이 万元을 千元로 읽혀 10배 작게 저장 |
| 여러 줄로 감싼 셀이 y좌표 묶기에 흩어짐(R&D 표, 헤더 행) | 표마다 다름 | **미해결**. 열 x좌표 군집화가 필요 |

### 고친 것 (`lib/report-reader.js`)

- `splitGluedCells()`: 한자·괄호 바로 뒤의 천단위 숫자, 소수 둘째 자리 바로 뒤의 숫자·한자 사이에
  `|`를 넣는다. 중국 재무표는 금액이 항상 소수 둘째 자리·천단위 쉼표라 그 모양을 경계로 쓴다.
  `万元·欧元·港币·股` 같은 단위 접미사 앞은 가르지 않는다. 표 행과 "천단위 숫자가 셋 이상 이어진 줄"에만
  적용하고 산문은 손대지 않는다.
- `annotateTableUnits()`: `单位：万元`을 만나면 다음 단위 머리나 절 제목(`第N节`)까지 모든 표 행 끝에
  `[单位:万元]`을 붙인다. 지우는 건 없다.
- `renderTableRows()`: **표는 행 단위, 줄글은 문단 단위**로 두 갈래 처리. 헤더가 온전한 표는 행마다
  `표이름 · 행이름: 열1 값, 열2 값 (单位:元)` 문장으로 편다(사용자가 보여 준 Colab 방식). 헤더 판정은
  보수적이다 — 금액·소수·날짜가 한 셀이라도 있으면 헤더가 아니라고 보고 그 표는 파이프 그대로 둔다.
  실제 보고서는 여러 줄 헤더가 흩어져 첫 파이프 행이 데이터 행인 경우가 흔해, 이 보호가 없으면 뒤
  행이 전부 엉뚱한 문장이 된다.
- `extractPdfText()`가 쪽을 다 모은 뒤 `renderTableRows(annotateTableUnits(text))`를 적용한다.
- 검사: `scripts/check-report-tables.mjs`에 8~11번 항목(붙은 셀·단위 주석·행 문장화·헤더 오판 방지).

### 갱신은 덧붙이기가 아니라 바꿔 넣기 (사용자 결정: "잘못된 정보가 있으면 지우고 다시 채워라")

`renewReport()`가 새로 읽은 결과가 충분하면(`RENEW_REPLACE_MIN_EVENTS` 3건 이상이고 옛 건수의
50% 이상) **그 보고서의 옛 이벤트를 지우고** 새 것으로 채운다(`knowledge_chunk`·`event_fact`·
`concept_edge`는 on delete cascade). 얇은 읽기(timeout)면 옛 것을 지키고 덧붙이기만 한다.
덧붙이기만으로는 못 고치는 이유: `storeEvents`의 `sameFact`가 같은 제목의 옛 오류 건과 새 정답 건을
같은 사실로 보아 정답을 버린다. 삭제 범위는 `company_id` + `source_url`로 좁히고 지우기 전에 조회한다.
검사 `scripts/check-report-renewal.mjs`가 이 세 조건을 고정한다.

운영 DB: Farasis 2026 반기(오늘 옛 추출기로 갱신, 52건)의 `renewed_at`을 비워 큐에 되돌렸다.
다음 갱신에서 새 추출기로 읽어 바꿔 넣는다. 갱신 큐 107건 전부가 같은 경로를 탄다.

### 사실 추출 프롬프트

표 금액은 표 머리 단위를 반드시 확인하고, 한국어 금액 옆에 원문 표기를 괄호로 남긴다
(`15억 위안(150,000.00万元)`). 단위를 못 찾았으면 환산하지 않는다. 검사 `check-fact-granularity.mjs`.

## 2026-09-07 저녁: 벡터 데이터 1단계 검증 결과

`docs/VECTOR-VERIFICATION-PLAN.md`의 1단계(오프라인 자동 검사)를 운영 DB에 SQL로 돌렸다. 결과와 판정은
그 문서의 "1단계 실행 결과" 절에 있다. 요약: 청크·이벤트 정합성은 깨끗하고, 수치 오류는 표본 28개 중
1건(万元→억 환산 10배 오류, 수정함)이며, 구조적 약점은 **발췌 300자 상한** 때문에 사실 한 건에 담긴
수치 여러 개 중 40%가량이 저장된 근거만으로는 확인되지 않는다는 점이다.
