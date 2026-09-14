# China Battery Lens — 기능 목록 (draw.io 다이어그램용)

기준일: 2026-09-04. 코드 기준(`api/`, `lib/`, `app/`, `supabase/`, `vercel.json`)으로 정리했다.
draw.io에서 **Arrange → Insert → Advanced → CSV**로 4절 CSV를 붙여 넣으면 기능 트리가 자동 생성된다.

## 1. 기능 도메인 9개

| ID | 도메인 | 한 줄 정의 |
|---|---|---|
| F1 | 접근 제어 | 키 기반 입장과 보호 API 인증 |
| F2 | 소스 수집 | 중국 뉴스·공시 후보 발견과 회사 매칭 |
| F3 | 본문 분석·검증 | 원문 읽기, 사실 추출, 이벤트화 |
| F4 | Daily 리포트 | 오늘의 한국어 리포트와 근거 Top 10 |
| F5 | 기업 시계열 | 레이어 × 분기 매트릭스와 기업 프로필 |
| F6 | 기업 비교 | 두 기업 비교 리포트 생성·검증·히스토리 |
| F7 | 지식 검색 | 청킹·임베딩·pgvector 질의응답 |
| F8 | 내보내기 | Excel(Raw·시계열) 다운로드 |
| F9 | 운영·스케줄 | 크론, 단계 체이닝, 백필, 추적 |

## 2. 기능 상세

### F1 접근 제어
| ID | 기능 | 구현 | 비고 |
|---|---|---|---|
| F1.1 | 입장 키 검증 | `api/access.js`, `api/lib/access.js` | `APP_ACCESS_KEY` 비교 |
| F1.2 | HttpOnly 쿠키 발급·세션 유지 | `issueAccessCookie()` | 모든 API가 `requireAccess`로 게이트 |
| F1.3 | 프런트 입장 화면 | `app/access-gate.js`, `app/access.css` | 미인증 시 앱 셸 숨김 |
| F1.4 | 크론·보호 API Bearer 인증 | `isCronRequest()` (`api/ingest-rss.js`) | `CRON_SECRET` |
| F1.5 | 실행 버튼 재확인 | `app/app.js` `confirmAccessCode()` | 백필·임베딩 실행 전 키 재입력 |

### F2 소스 수집
| ID | 기능 | 구현 | 비고 |
|---|---|---|---|
| F2.1 | 추적 Universe 마스터(31개사) | `lib/china-sources.js` `COMPANIES` | 셀 10·양극재 12·음극재 9, SNE 기준 `priority` |
| F2.2 | 그룹·계열사 마스터(15그룹) | `lib/company-groups.js` | 연차보고서 근거 `evidence` 필수 |
| F2.3 | OpenAI 웹 검색 3회 | `discoverChinaSources()` | 폭넓은 주요 출처 |
| F2.4 | DeepSeek 웹 검색 3회 | 〃 | 중국어 현지·지역·기업 출처 |
| F2.5 | CATL 뉴스룸 수집 | 〃 | 공식 채널 |
| F2.6 | CNINFO 공시 수집(22개사) | 〃 | 본문 분석 대상에 포함됨(선별 보너스 +25) |
| F2.7 | Google News URL 해석 | `api/lib/google-news.js` | 리다이렉트 원문 URL 복원 |
| F2.8 | URL 중복 제거·회사 매칭 | `companiesFor()`, `groupAliases()` | 계열사명 → 모회사 ID 연결 |
| F2.9 | 회사 마스터 upsert·기사 저장 | `api/ingest-rss.js` | `company`, `article`, `article_company` |
| F2.10 | 소스 등급 부여 | `api/ingest-rss.js` | `official_disclosure` / `web_search_*` / `needs_review` |
| F2.11 | 후보 소스 조회 API | `GET /api/news` | 저장 전 후보 목록 |

### F3 본문 분석·검증
| ID | 기능 | 구현 | 비고 |
|---|---|---|---|
| F3.1 | 헤드라인 신호 Top 10 선별 | `selectHeadlineTop10()`, `supabase/headline-signals.sql` | 규칙 점수(LLM 아님). `web_search_*`·CATL·거래소 공시 대상, 최근 3일 |
| F3.2 | 원문 HTML 수집 | `api/process-article.js` | 60초 함수 제약 |
| F3.3 | OpenAI 한국어 사실·이벤트 1차 추출 | `api/process-article.js` | 요약·키워드·이벤트 |
| F3.4 | 원문 추출 상태 전환 | 〃 | 원문 확보·구조화 추출 성공 시 `verified` |
| F3.5 | 검증 상태 저장 | `article.verification_status` | `pending` → `verified` |
| F3.6 | 레이어 정규화 | `lib/timeline-layers.js` | 시장 4 + 기술 4, 규격 밖은 `null`→미분류 |
| F3.7 | 계열사 발생 법인 표기 | `matchGroupEntities()` → `event.entity_names` | `supabase/company-entity.sql` |
| F3.8 | 구조화 사실 추출 | `lib/fact-extraction.js` → `event_fact` | 7종 factType, 단위·세그먼트·상태 enum |
| F3.9 | 시점 정밀도·재확인 | `supabase/event-occurred-precision.sql`, `redateReportEvents()` | 분기 배치 정확도 |
| F3.10 | 근거 등급 구분 | `event.timeline_eligibility` = core / reference / exclude | 화면 "보조 데이터 포함" 토글 |
| F3.11 | 처리 결과 기록 | `supabase/article-processing-outcome.sql` | 실패 원인 추적 |

### F4 Daily 리포트
| ID | 기능 | 구현 | 비고 |
|---|---|---|---|
| F4.1 | Daily 한국어 리포트 생성 | `api/generate-daily.js` → `daily_report` | Top 10 + 최근 피드백 반영 |
| F4.2 | 사실(`summary_ko`)·해석(`insight_ko`) 분리 | `supabase/daily-insight.sql` | 컬럼·화면 영역 분리 |
| F4.3 | 날짜별 리포트 열람 | `GET /api/dashboard?report=YYYY-MM-DD` | 최근 90일 목록 |
| F4.4 | 근거 Top 10 카드 | `api/dashboard.js` `top10` | 순위·출처·원문 링크 |
| F4.5 | 좋아요/싫어요 피드백 | `POST /api/news` → `article_feedback` | Daily 생성 프롬프트 + Top 10 선별 점수(회사·매체 선호 ±20)에 반영 |
| F4.6 | 헤드라인 Sankey(확대/축소) | `lib/sankey-normalization.js` `THEMES` | 검증 기사 + 미검증 헤드라인(토글, 기본 포함)을 고정 테마 10개로 접어 방향별 상위 4. 툴팁에 검증·헤드라인 건수 분리 |
| F4.7 | 기간 필터 | Sankey·회사별 뉴스 각각 | 뉴스 기본 어제~오늘 |
| F4.8 | 밸류체인·회사별 뉴스 피드 | `api/dashboard.js` `companyNews` | 세그먼트 + 회사 셀렉트 |
| F4.9 | 수집·분석 1회 수동 실행 | `/api/ingest-rss?process=1` + `waitForDailyReport()` | 화면 버튼, 1훅 |
| F4.10 | 리포트 임베딩 | `embedDailyReport()` | 지식 검색 대상에 포함 |

### F5 기업 시계열
| ID | 기능 | 구현 | 비고 |
|---|---|---|---|
| F5.1 | 회사 카탈로그·정렬 | `GET /api/company` | 밸류체인 → SNE `priority` → 한국어명 |
| F5.2 | 선정 기준 표시 | `SELECTION_BASIS` | 점유율·출하량 수치는 저장하지 않음 |
| F5.3 | 기업 프로필·그룹 계열사 | `groupSummary()`, `#company-profile` | 근거 연차보고서 링크 |
| F5.4 | 연차보고서 핵심 사실 스냅샷 | `#snapshot-grid`, `report_digest` | `supabase/report-digest-ledger.sql` |
| F5.5 | 레이어 × 분기 매트릭스 | `renderCompany()` | (올해-3년) Q1 ~ 당해 분기, 빈 칸 `—` |
| F5.6 | 미분류 행 표시 | `layer_key = null` | 레이어 정의 보정 신호 |
| F5.7 | 보조 데이터 포함 토글 | `#include-supporting` | core만 ↔ reference 포함 |
| F5.8 | 이벤트 카드·원문 근거 | `GET /api/company?companyId=` | URL·매체·날짜·발췌 유지 |
| F5.9 | 시계열 백필 1회 실행 | `POST /api/ingest-rss?curate_run=1` | 20~30분, 최대 40훅 |

### F6 기업 비교
| ID | 기능 | 구현 | 비고 |
|---|---|---|---|
| F6.1 | 기업 A/B 선택 | `#compare-a`, `#compare-b` | 밸류체인 세그먼트별 |
| F6.2 | 이벤트 나란히 비교 | `renderComparison()` | 보조 데이터 토글 공유 |
| F6.3 | 비교 리포트 생성 | `POST /api/company` (`mode=compare_report`) → `lib/compare-report.js` | LLM 요약 |
| F6.4 | 리포트 사실 검증·DB 반영 | `applyVerifiedFacts()` | 미확인 사실은 이벤트로 승격 |
| F6.5 | 리포트 히스토리 목록 | `?compare_history=1` → `compare_report_history` | 최근 30건 |
| F6.6 | 히스토리 상세 열람 | `?compare_history_id=` | 모델·검증상태·검색 출처 포함 |
| F6.7 | 문서 폭 리포트 레이아웃 | `app/styles.css` | 커밋 a2e2255 |

### F7 지식 검색
| ID | 기능 | 구현 | 비고 |
|---|---|---|---|
| F7.1 | 원문 청킹 | `chunkArticleBody()` | 약 1,800자·180자 중첩 |
| F7.2 | 배치 임베딩 | `embedVerifiedArticle()`, `embedEvents()` | `text-embedding-3-small` |
| F7.3 | 지식 청크 저장 | `knowledge_chunk` | 회사·기사·출처·순서·원문·한국어 요약 |
| F7.4 | pgvector 유사도 검색 | `match_knowledge_chunks()` | 회사 필터 지원 |
| F7.5 | 근거 기반 질의응답 | `lib/knowledge-search.js`, `#ask-form` | "선택한 기업으로 한정" 옵션 |
| F7.6 | 임베딩 상태 관리 | `embedding_status`, `supabase/vector-ingestion.sql` | `failed` 재시도는 미구현 |
| F7.7 | 벡터DB 채우기 실행 | `POST /api/embed-event` | 누락분 배치 임베딩 |
| F7.8 | 미검증 헤드라인 임베딩 | `lib/headline-knowledge.js` → `knowledge_chunk(source_type='headline')` | 본문 미처리 기사 제목을 한국어로 옮겨 색인. 큐레이션 훅에서 돈다 |
| F7.9 | 근거 등급 토글 | `#ask-include-unverified` → `match_knowledge_chunks(include_unverified)` | 기본은 검증본만. 켜면 헤드라인도 후보에 들고 답변·근거에 미검증 표시 |

### F8 내보내기
| ID | 기능 | 구현 | 비고 |
|---|---|---|---|
| F8.1 | Raw data Excel | `GET /api/raw-news` → `exportRawNews()` | 최근 1,000건 |
| F8.2 | 기업 시계열 Excel | `exportCompanyTimeline()` | 출처·원문·한국어 번역·발생 법인 |

### F9 운영·스케줄
| ID | 기능 | 구현 | 비고 |
|---|---|---|---|
| F9.1 | 일일 수집 크론 | `vercel.json` `0 14 * * *` → `/api/ingest-rss` | KST 23시 |
| F9.2 | 임베딩 크론 | `vercel.json` `0 16 * * *` → `/api/embed-event` | |
| F9.3 | 단계 체이닝(60초 우회) | `chainStage()` + `waitUntil()` | `process` / `daily` / `curate` |
| F9.4 | 큐레이션 훅 루프 | `lib/curation.js` `runCurationHop()` | 보고서 읽기·보강·웹 백필·시점 재확인 |
| F9.5 | 정기보고서 리더 | `lib/report-reader.js` | CNINFO PDF 조회·텍스트 추출·섹션 슬라이스 |
| F9.6 | 이벤트 백필 | `lib/event-backfill.js` | 회사·기간 지정 웹 백필, 인용 제거 |
| F9.7 | LLM 프로바이더 추상화 | `lib/llm-provider.js` | OpenAI / DeepSeek / auto |
| F9.8 | LangSmith 추적 | `lib/tracing.js` `traced()`, `flushTraces()` | 서버리스 종료 전 flush |
| F9.9 | 재실행 가능한 스키마 SQL | `supabase/*.sql` | SQL Editor 수동 적용 |
| F9.10 | 모듈 정합성 체크 | `npm run check` | `scripts/check-modules.mjs` |

## 3. 데이터 흐름 (파이프라인 다이어그램용 엣지 목록)

```
크론/버튼 → ingest-rss → discoverChinaSources → (OpenAI검색 / DeepSeek검색 / CATL뉴스룸 / CNINFO공시)
discoverChinaSources → 중복제거·회사매칭 → article, article_company
article → 헤드라인 Top10 선별 → process-article
process-article → OpenAI 원문 사실추출 → article(verified), event
event → 레이어 정규화 / 발생법인 표기 / event_fact
article 본문 → 청킹 → 임베딩 → knowledge_chunk
event → embed-event → knowledge_chunk
Top10 + article_feedback → generate-daily → daily_report
daily_report, article → dashboard API → Daily 화면
event → company API → 기업 시계열 화면 → Excel
event(A) + event(B) → compare-report → compare_report_history → 비교 화면
knowledge_chunk → match_knowledge_chunks → 질의응답 화면
```

## 4. draw.io CSV (기능 트리)

draw.io → **Arrange → Insert → Advanced → CSV**에 아래 블록 전체를 붙여 넣는다.

```
# label: %name%
# style: rounded=1;whiteSpace=wrap;html=1;fillColor=%fill%;strokeColor=none;fontColor=#FFFFFF;
# namespace: cbl-
# connect: {"from":"parent","to":"id","invert":true,"style":"edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;endArrow=none;"}
# width: 200
# height: 40
# nodespacing: 20
# levelspacing: 60
# edgespacing: 40
# layout: verticaltree
id,name,parent,fill
root,China Battery Lens,,#1F2937
F1,F1 접근 제어,root,#334155
F1.1,입장 키 검증,F1,#64748B
F1.2,HttpOnly 세션 쿠키,F1,#64748B
F1.3,입장 화면,F1,#64748B
F1.4,크론 Bearer 인증,F1,#64748B
F1.5,실행 전 키 재확인,F1,#64748B
F2,F2 소스 수집,root,#1D4ED8
F2.1,추적 31개사 마스터,F2,#60A5FA
F2.2,그룹·계열사 마스터,F2,#60A5FA
F2.3,OpenAI 웹 검색,F2,#60A5FA
F2.4,DeepSeek 웹 검색,F2,#60A5FA
F2.5,CATL 뉴스룸,F2,#60A5FA
F2.6,CNINFO 공시,F2,#60A5FA
F2.7,Google News URL 해석,F2,#60A5FA
F2.8,중복 제거·회사 매칭,F2,#60A5FA
F2.9,기사 저장,F2,#60A5FA
F2.10,소스 등급 부여,F2,#60A5FA
F3,F3 본문 분석·검증,root,#7C3AED
F3.1,헤드라인 Top10 선별,F3,#A78BFA
F3.2,원문 HTML 수집,F3,#A78BFA
F3.3,OpenAI 사실 추출,F3,#A78BFA
F3.4,원문 추출 상태 전환,F3,#A78BFA
F3.5,검증 상태 저장,F3,#A78BFA
F3.6,레이어 정규화,F3,#A78BFA
F3.7,발생 법인 표기,F3,#A78BFA
F3.8,구조화 사실 추출,F3,#A78BFA
F3.9,시점 정밀도·재확인,F3,#A78BFA
F3.10,근거 등급 core/reference,F3,#A78BFA
F4,F4 Daily 리포트,root,#B91C1C
F4.1,Daily 리포트 생성,F4,#F87171
F4.2,사실·해석 분리,F4,#F87171
F4.3,날짜별 리포트 열람,F4,#F87171
F4.4,근거 Top 10,F4,#F87171
F4.5,좋아요/싫어요 피드백,F4,#F87171
F4.6,헤드라인 Sankey,F4,#F87171
F4.7,기간 필터,F4,#F87171
F4.8,회사별 뉴스 피드,F4,#F87171
F4.9,수집·분석 1회 실행,F4,#F87171
F5,F5 기업 시계열,root,#047857
F5.1,회사 카탈로그·정렬,F5,#34D399
F5.2,SNE 선정 기준,F5,#34D399
F5.3,기업 프로필·계열사,F5,#34D399
F5.4,연차보고서 스냅샷,F5,#34D399
F5.5,레이어×분기 매트릭스,F5,#34D399
F5.6,미분류 행,F5,#34D399
F5.7,보조 데이터 토글,F5,#34D399
F5.8,이벤트 카드·원문 근거,F5,#34D399
F5.9,시계열 백필 실행,F5,#34D399
F6,F6 기업 비교,root,#B45309
F6.1,기업 A/B 선택,F6,#FBBF24
F6.2,이벤트 나란히 비교,F6,#FBBF24
F6.3,비교 리포트 생성,F6,#FBBF24
F6.4,리포트 사실 검증,F6,#FBBF24
F6.5,리포트 히스토리,F6,#FBBF24
F6.6,히스토리 상세,F6,#FBBF24
F7,F7 지식 검색,root,#0E7490
F7.1,원문 청킹,F7,#22D3EE
F7.2,배치 임베딩,F7,#22D3EE
F7.3,knowledge_chunk 저장,F7,#22D3EE
F7.4,pgvector 유사도 검색,F7,#22D3EE
F7.5,근거 기반 질의응답,F7,#22D3EE
F7.6,임베딩 상태 관리,F7,#22D3EE
F7.7,벡터DB 채우기,F7,#22D3EE
F7.8,미검증 헤드라인 임베딩,F7,#22D3EE
F7.9,근거 등급 토글,F7,#22D3EE
F8,F8 내보내기,root,#9D174D
F8.1,Raw data Excel,F8,#F472B6
F8.2,기업 시계열 Excel,F8,#F472B6
F9,F9 운영·스케줄,root,#4B5563
F9.1,일일 수집 크론,F9,#9CA3AF
F9.2,임베딩 크론,F9,#9CA3AF
F9.3,단계 체이닝,F9,#9CA3AF
F9.4,큐레이션 훅 루프,F9,#9CA3AF
F9.5,정기보고서 리더,F9,#9CA3AF
F9.6,이벤트 백필,F9,#9CA3AF
F9.7,LLM 프로바이더 추상화,F9,#9CA3AF
F9.8,LangSmith 추적,F9,#9CA3AF
F9.9,재실행 가능 스키마 SQL,F9,#9CA3AF
F9.10,모듈 정합성 체크,F9,#9CA3AF
```

## 5. 다이어그램에 함께 표시하면 좋은 미구현·부채

`docs/HANDOFF.md` 9절 기준. 점선 테두리로 구분해 그리면 현재 상태가 분명해진다.

- `layer_key`가 빈 기존 이벤트 재분류 백필
- 기존 검증 기사 벡터 백필
- `embedding_status=failed` 자동 재시도
- `pending_review` → `verified` 스키마 마이그레이션
- 실행별 수집·처리 카운트 운영 화면
- HKEX(홍콩 상장사) 연차보고서 수집 경로
