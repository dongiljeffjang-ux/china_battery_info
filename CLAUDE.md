# China Battery Lens — Claude 작업 지침

이 저장소는 중국 배터리 셀·양극재·음극재 기업의 뉴스·공시를 수집하고, 한국어 팩트 리포트·기업 시계열·벡터 지식으로 제공하는 내부 서비스다.

## 작업 시작

1. `docs/HANDOFF.md`에서 운영 상태·배포·미완료 항목을 읽는다.
2. 제품 요구를 바꿀 때 `prd.md`, 데이터 구조를 바꿀 때 `data-model.md`, 파이프라인을 바꿀 때 `architecture.md`를 확인한다.
3. 수정 전 `git status --short`를 확인하고 사용자 변경을 보존한다.
4. JavaScript 수정 후 `node --check <파일>`, `npm run check`, `git diff --check`를 실행한다.
5. `lib/`나 `api/` 수정 후 `scripts/check-*.mjs` 회귀 검사를 전부 돌린다. 네트워크를 가짜로 물려 돌리므로 API 과금이 없다.

## 제품 불변조건

- 사용자 표시 언어는 한국어다. 중국어·영어 원문과 회사 별칭은 검색·근거용이다.
- 사실만 표시한다. 전망·인과·투자 추천을 만들지 않는다.
- 예외: Daily 리포트의 `insight_ko`는 해석을 허용한다. 수집된 사실이 한국 배터리사·소재사에 갖는
  사업적 함의를 오늘의 근거로 설명 가능한 범위에서 한 단계까지 추론해 쓴다. 근거를 여러 단계 건너뛴
  결론과 투자 추천은 여전히 금지다. 사실(`summary_ko`)과 해석(`insight_ko`)은 컬럼과 화면 영역을
  분리해 섞이지 않게 한다.
- 원문 URL·매체·날짜·원문 발췌를 유지한다.
- 자동 본문 대조 통과 상태는 현재 `pending_review`라는 레거시 이름을 쓰지만 사람 승인을 뜻하지 않는다.
- Daily Top 10과 기업 시계열 중요성은 별도 개념이다.
- 기업 시계열은 시장/기술 레이어를 행, `YYYY Q1~Q4`를 열로 표시한다.
- 그룹 검색은 모회사와 공식적으로 확인된 배터리 관련 주요 계열사를 포함한다. 추정 계열사를 넣지 않는다.

## 구현 가드레일

- Vercel Hobby 함수 수 제한 때문에 새 `api/*.js` 파일을 추가하기 전에 기존 API 재사용을 검토한다. 공유 코드는 루트 `lib/`에 둔다.
- 브라우저에 `SUPABASE_SERVICE_ROLE_KEY`, LLM 키, `CRON_SECRET`, `APP_ACCESS_KEY`를 노출하지 않는다.
- 운영 배포는 GitHub `main` 푸시가 Vercel을 트리거한다. 로컬 폴더에서 별도 Vercel 프로젝트를 만들지 않는다.
- Supabase 스키마 변경은 재실행 가능한 SQL을 `supabase/`에 추가하고 SQL Editor 실행 여부를 사용자에게 확인한다.
- `.env`와 실제 키는 커밋하지 않는다.
- 운영 DB에 DELETE/UPDATE를 돌리기 전에 지울 행을 먼저 SELECT로 눈으로 확인한다. 2026-09-07에 `knowledge_chunk`의 정상 행을 중복으로 오판해 지운 사고가 있었다.
- `knowledge_chunk`는 한 기사에 여러 행이 정상이다. `article_chunk`·`event_fact`·`headline`·`daily_report`·`report_chunk`가 `article_id`를 공유한다. 행 수를 셀 때 `source_type`을 함께 본다. 중복은 `content_hash` 유니크 제약이 이미 막는다.
- 에이전트 작업 지침은 이 파일 하나로 관리한다. `AGENTS.md`는 이 파일을 가리키는 포인터다.

## 핵심 문서

- 현재 인수인계: `docs/HANDOFF.md`
- 제품 요구: `prd.md`
- 데이터 모델: `data-model.md`
- 시스템 설계: `architecture.md`
- 계획: `plan.md`
- 현재 그림: `architecture/current-architecture.svg`

