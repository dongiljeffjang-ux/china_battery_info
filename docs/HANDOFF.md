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
- OpenAI와 DeepSeek가 각각 웹 검색한다. OpenAI는 폭넓은 주요 출처, DeepSeek는 중국어 현지 산업·지역·기업 출처를 우선한다.
- 전체 후보에서 헤드라인으로 Top 10을 고른 뒤 원문을 읽고 OpenAI 1차 추출·DeepSeek 교차검증을 수행한다.
- 첫 화면은 Daily 한국어 리포트, 근거 Top 10, 날짜 범위 확대/축소 Sankey, 밸류체인·회사별 뉴스 순서다.
- 사람 최종 승인 단계는 없다. 자동 검증 통과 기사를 표시하고 좋아요/싫어요를 다음 Daily 선별 보조 신호로 쓴다.
- 기업 분석은 최근 3년 이상을 시장/기술 레이어 행 × 분기 열로 보여주고, 출처·원문·한국어 번역을 Excel로 내보낸다.
- 검증 통과 원문을 보관하고 청킹·임베딩해 회사별 벡터 지식으로 저장한다.

## 3. 실제 파이프라인

1. `api/ingest-rss.js`가 회사 마스터를 Supabase에 upsert한다.
2. `lib/china-sources.js`가 OpenAI 검색 3회, DeepSeek 검색 3회, CATL 뉴스룸, CNINFO를 병렬 수집한다.
3. URL 중복을 제거하고 회사 중국어·영어·그룹 별칭으로 `article_company`를 연결한다.
4. 헤드라인 신호로 최대 10건을 선택한다.
5. `api/process-article.js`가 원문 HTML을 가져온다.
6. OpenAI가 한국어 사실·이벤트를 추출하고 DeepSeek가 같은 본문으로 교차검증한다.
7. 통과 기사는 `pending_review`로 저장된다. 이 상태명은 레거시이며 현재 의미는 “자동 팩트체크 통과”다.
8. 원문을 약 1,800자, 180자 중첩으로 나누고 `text-embedding-3-small` 기본 모델로 배치 임베딩한다.
9. `knowledge_chunk`에 회사·기사·출처·청크 순서·원문·한국어 요약 결합 텍스트를 저장한다.
10. `api/generate-daily.js`가 Top 10과 최근 피드백을 사용해 Daily를 생성한다.

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

운영 DB에 SQL을 실행한 뒤 `Success. No rows returned`가 확인됐다. 이후 스키마 변경도 재실행 가능한 SQL로 남긴다.

## 6. API 지도

| 경로 | 역할 |
|---|---|
| `/api/access` | 입장 키 검증·HttpOnly 쿠키 발급 |
| `/api/ingest-rss?process=1` | 수집부터 분석·Daily까지 수동 1회 실행 |
| `/api/dashboard` | Daily, Top 10, 회사 뉴스, Sankey 데이터 |
| `/api/company?companyId=...` | 기업 이벤트 시계열 |
| `/api/news` | GET 소스 후보, POST 좋아요/싫어요 |
| `/api/raw-news` | Raw Excel용 기사 데이터 |
| `/api/process-article` | 보호된 단일 기사 처리 |
| `/api/generate-daily` | Daily 생성 내부 로직 |
| `/api/embed-event` | 레거시 수동 이벤트 임베딩 경로 |

## 7. 화면 상태

- 정적 프런트엔드: `app/index.html`, `app/app.js`, `app/styles.css`.
- Daily 데이터는 API와 연결돼 있다.
- 기업 분석·비교의 상세 예시는 아직 `app/app.js`의 하드코딩 시드 회사 중심이다. `/api/company`를 완전히 연결하고 29개 회사를 실제 DB 이벤트로 렌더링하는 작업이 남아 있다.
- 기업 시계열 매트릭스는 시장 4개, 기술 4개 레이어 × 2023~2026 분기 열이다.
- Sankey는 비-Top 10 기사에서 헤드라인 확대/축소 신호를 분류하고 방향별 상위 4개만 표시한다.
- 프런트 변경 후 브라우저 캐시 문제가 있었으므로 `app/index.html`의 `app.js?v=...`를 변경하거나 자산 해시 전략을 도입한다.

## 8. 회사 범위

`lib/china-sources.js`에 셀 10, 양극재 10, 음극재 9개가 있다. 한국어 표준명·중문명·영문명·검색 별칭을 유지한다.

현재 그룹 모델은 CATL에 BRUNP를 넣은 1차 예시뿐이다. 사용자의 의도는 예시 하나가 아니라 각 모회사 아래 배터리 관련 주요 연결·지배 계열사를 모두 관리하는 것이다. 다음 작업은 공식 연차보고서·회사 IR로 `그룹 → 주요 법인 → 별칭 → 모회사 ID` 마스터를 만들고 검색·뉴스·기업 시계열에 연결하는 것이다. 법적 관계가 불명확한 회사는 포함하지 않는다.

## 9. 알려진 기술 부채와 다음 우선순위

1. 29개 회사의 공식 그룹·주요 계열사 마스터 완성.
2. 기업 분석 화면을 하드코딩 시드에서 `/api/company` 실제 데이터로 전환.
3. 기존 검증 기사에 대한 벡터 DB 백필. 현재 자동 임베딩은 새로 처리된 기사부터 적용된다.
4. 임베딩 실패(`embedding_status=failed`) 자동 재시도 작업.
5. `pending_review`를 의미가 분명한 `verified`로 스키마 마이그레이션.
6. 검색 실행별 OpenAI/DeepSeek 발견·중복·본문 성공·팩트 통과·임베딩 청크 수를 운영 화면에 표시.
7. 기사 원문 저장은 사용자의 명시 요구로 현재 활성화됐다. 저작권·보존기간·접근통제 정책을 제품 문서와 일치시키는 결정이 필요하다.
8. Vercel 60초 함수 안에서 검색 6회 + 본문 분석 20회 + 임베딩이 실행되므로 시간초과가 발생하면 큐/비동기 작업으로 분리한다.

## 10. 검증 절차

```powershell
node --check app/app.js
node --check lib/china-sources.js
node --check lib/llm-provider.js
node --check lib/vector-ingestion.js
node --check api/ingest-rss.js
node --check api/process-article.js
git diff --check
```

운영 배포 후에는 Vercel 로그에서 다음 태그를 확인한다.

- `[WEB_SEARCH_FAILED]`
- `[INGEST_OUTCOMES]`
- `[ARTICLE_CROSS_CHECK]`
- `[ARTICLE_EMBEDDING_FAILED]`
- `[FEEDBACK_SAVE_FAILED]`

## 11. 저장소 주의사항

- `research/disclosure-only-mvp.md`는 공시 전용 대안 검증 자료다.
- Python `pipeline/`과 SQLite 설명은 초기 프로토타입 흔적이며 현재 운영 Vercel/Supabase 경로와 동일하지 않다.
- 문서 간 “뉴스 원문 미저장” 표현은 최신 구현과 충돌할 수 있다. 최신 결정은 원문 DB 보관 + 서버 접근통제이며, 향후 정책 확정이 필요하다.

