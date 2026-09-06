# 2026-09-06 운영 점검 후 수정

Claude 작업과 병행 중. 이 문서의 코드 수정은 커밋/배포하지 않았다.

## 운영 DB 적용 완료

기존 `supabase/headline-knowledge.sql`을 실행했다. `headline`을 거부하던
knowledge_chunk 제약조건을 수정하고, 검색 함수에 include_unverified=false
기본값을 적용했다. headline INSERT 후 ROLLBACK 테스트 성공: 시험 행은 남기지 않았다.

## 로컬 코드 수정 완료

- pipeline-log: 하위 처리 error/failed/rejected가 있으면 전체를 partial로 기록.
- ingest-rss: 누락되던 제공자/밸류체인별 web_search 실행 결과를 DB 기록에 포함.
- llm-provider: 용도·제공자·모델·토큰·검색 횟수·출력 종류·실패를 pipeline_log의 llm 단계로 기록.
  키/프롬프트/응답 본문은 기록하지 않는다. 검색 도구 미실행은 검색 성공으로 인정하지 않는다.
  검색 요청 35초, 다른 LLM 요청 45초 네트워크 제한. 시간초과의 usage=null은 0원이라는 뜻이 아니다.
- check-pipeline-status.mjs / check-llm-search.mjs: API 과금 없는 회귀 검사.

검증: 두 회귀 검사와 npm run check(API 10개 import), git diff --check 통과.

## DeepSeek 미해결

과금은 검색 이외 교차검증에서도 생긴다. 발견 출처 deepseek인 기사 0건만으로 원인을 단정하면 안 된다.
로컬 probe는 마스킹된 환경값 때문에 401로 끝났다. 운영 키 오류를 의미하지 않는다.
운영 WEB_SEARCH_FAILED 로그 검색에서는 결과를 얻지 못했다.
운영 전체 환경변수 다운로드는 자동 승인 검토에서 범위가 과도한 비밀키 접근으로 거절됐다.
실제 DeepSeek 키를 안전하게 진단 환경에 제공받거나, 수정 코드를 배포한 뒤
운영 pipeline_log의 llm/collect 기록으로 검색 실패를 재현해야 한다.
실검색 성공/후보 저장/원문 검증까지 아직 확인하지 못했다. 검색 복구 완료로 표시하지 말 것.

## 나머지

공시 원문 소급 저장과 시점 미기록 백필은 아직 실행하지 않았다.
진행 중 Claude 커밋 6da8af6이 확인됐으며 관련 없는 변경은 보존했다.
