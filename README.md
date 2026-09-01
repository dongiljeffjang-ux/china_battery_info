# China Battery Lens MVP

중국 양극재·음극재 Daily 인텔리전스와 기업별 시장/기술 2축 시계열을 확인하는 정적 MVP입니다.

## 실행

PowerShell에서 다음을 실행합니다.

```powershell
Set-Location C:\Users\POSCOFUTUREM\Documents\china_info\app
python -m http.server 8080
```

브라우저에서 `http://localhost:8080`을 엽니다.

## 현재 범위

- Daily: LLM 1페이지 요약 보고서, 전체 뉴스 기반 본문 확인 Top 10, 회사별 승인 뉴스와 출처 링크
- 기업 분석: 최소 최근 3년부터 현재까지의 레이어×시간 매트릭스와 Excel 내보내기
- 기업 비교: 두 기업을 좌·우에 두고, 중앙 시간축의 같은 시점에서 전체 사실 이벤트를 비교

현재 데이터는 화면과 상호작용 검증을 위한 시드 데이터입니다. 다음 단계에서 RSS·검색 RSS 수집, 기사 정독·번역, 저장소, 관리자 검수 흐름을 연결합니다.

## 뉴스 후보 수집

```powershell
python .\pipeline\collect_feeds.py
```

`data/article_candidates.json`에 RSS 메타데이터 후보만 저장합니다. 뉴스 본문을 저장하지 않으며, 소스별 수집 실패는 전체 실행을 중단하지 않습니다.

## 무료 뉴스 수집

`pipeline/collect_feeds.py`와 `/api/news`는 Google News RSS와 중국신문 공식 RSS를 사용합니다. 중국어·영어 키워드로 후보 메타데이터를 모으고, 승인된 기사만 원문 확인·한국어 번역 단계로 넘깁니다. 유료 뉴스 API 키 없이도 수집 파이프라인을 실행할 수 있습니다.

Vercel 배포에서는 별도 뉴스 API 키 없이 `/api/news`를 사용할 수 있습니다.

후보를 정독 검수 큐로 적재하려면 다음을 실행합니다.

```powershell
python pipeline/build_review_queue.py
```

`data/china_battery_lens.sqlite`에는 기사 메타데이터·정규 기업 ID·시점별 출처 정책만 저장됩니다. 본문 취득과 한국어 요약은 승인된 큐 항목의 후속 단계입니다.

수집기는 최신 결과를 `data/article_candidates.json`에 쓰고, 같은 결과를 `data/archives/YYYY-MM-DD/article_candidates.json`에도 일별 스냅샷으로 보관합니다. DB의 `ingestion_run`과 `candidate_observation`은 해당 일자에 관측한 후보를 누적 기록합니다.

## 서비스 API와 배포 DB

1. Supabase 프로젝트를 만들고 SQL Editor에서 `supabase/schema.sql`을 실행합니다.
2. Vercel Project Settings → Environment Variables에 `.env.example`의 `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, `OPENAI_MODEL`, `CRON_SECRET`를 입력합니다.
3. 브라우저는 `/api/dashboard`, `/api/company?companyId=Ronbay`만 호출합니다. `SUPABASE_SERVICE_ROLE_KEY`는 Vercel 서버에서만 사용하며 브라우저 코드에 넣지 않습니다.

`POST /api/process-article`는 승인 전 `articleId`, 정규 `companyId`를 받아 원문 HTML을 일시 처리하고, 한국어 요약과 Event 후보를 DB에 저장합니다. 이 API에는 `Authorization: Bearer $CRON_SECRET` 헤더가 필요합니다. 원문 뉴스 본문은 DB에 저장하지 않습니다.
