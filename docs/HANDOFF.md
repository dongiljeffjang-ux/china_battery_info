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

**미실행**: `supabase/company-entity.sql` (`event.entity_names`). 코드 배포 전에 SQL Editor에서 실행해야 한다. 컬럼이 없는 상태로 새 코드가 이벤트를 INSERT하면 Supabase가 거부해 기사 처리가 실패한다.

운영 DB에 SQL을 실행한 뒤 `Success. No rows returned`를 확인한다. 이후 스키마 변경도 재실행 가능한 SQL로 남긴다.

## 6. API 지도

| 경로 | 역할 |
|---|---|
| `/api/access` | 입장 키 검증·HttpOnly 쿠키 발급 |
| `/api/ingest-rss?process=1` | 수집부터 분석·Daily까지 수동 1회 실행 |
| `/api/dashboard` | Daily, Top 10, 회사 뉴스, Sankey 데이터 |
| `/api/company` | companyId 없으면 31개 회사 마스터·그룹·선정 기준, 있으면 그 기업의 이벤트 시계열 |
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
