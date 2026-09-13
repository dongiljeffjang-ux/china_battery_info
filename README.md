# China Battery Lens

중국 배터리 셀·양극재·음극재 기업의 뉴스·공시를 수집하고, 원문 대조 한국어 Daily·기업 시계열·벡터 지식으로 제공하는 내부 서비스입니다.

## 운영 주소

- 서비스: https://china-battery-lens.vercel.app/
- 저장소: https://github.com/dongiljeffjang-ux/china_battery_info

## 로컬 실행

정적 UI 확인:

```powershell
Set-Location C:\Users\POSCOFUTUREM\Documents\china_info\app
python -m http.server 8080
```

로컬 정적 서버에는 Vercel `/api/*`가 없으므로 실제 수집·DB 기능은 운영 배포 또는 Vercel 개발 환경에서 확인합니다.

## 현재 운영 흐름

```text
OpenAI 검색 3회 + DeepSeek 중국 현지 검색 3회 + 공식 소스
→ URL 중복 제거·회사/그룹 별칭 매칭
→ 헤드라인 Top 10
→ 원문 확보·보관
→ 원문 기반 OpenAI 사실 추출
→ 한국어 Daily·회사 이벤트
→ 원문 청킹·배치 임베딩·Supabase pgvector 저장
```

## 설정

1. Supabase 새 프로젝트에서 `supabase/schema.sql`을 실행합니다.
2. Vercel 환경변수에 `.env.example`의 키 이름을 등록합니다.
3. GitHub `main` 푸시가 `china-battery-lens` Vercel 프로젝트의 운영 배포를 트리거합니다.

비밀값은 저장소에 커밋하지 않습니다. `SUPABASE_SERVICE_ROLE_KEY`, LLM 키, `APP_ACCESS_KEY`, `CRON_SECRET`은 서버 환경변수로만 사용합니다.

## 문서

- Claude 작업 시작: `CLAUDE.md`
- 상세 인수인계: `docs/HANDOFF.md`
- 제품 요구: `prd.md`
- 시스템 설계: `architecture.md`
- 데이터 모델: `data-model.md`
- 향후 계획: `plan.md`
- 현재 아키텍처 그림: `architecture/current-architecture.svg`

## 빠른 검증

```powershell
node --check app/app.js
node --check lib/china-sources.js
node --check lib/llm-provider.js
node --check lib/vector-ingestion.js
node --check api/ingest-rss.js
node --check api/process-article.js
git diff --check
```

현재 상태와 남은 작업은 `docs/HANDOFF.md`를 단일 기준으로 봅니다.
