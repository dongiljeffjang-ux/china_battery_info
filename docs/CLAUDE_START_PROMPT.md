# Claude 시작 프롬프트

아래 문장을 Claude Code의 첫 메시지로 사용한다.

```text
이 저장소는 China Battery Lens 운영 프로젝트다. 먼저 CLAUDE.md와 docs/HANDOFF.md를 전부 읽고, git status와 최근 커밋을 확인해 현재 상태를 요약해줘. 기존 사용자 변경과 비밀키를 보존하고, GitHub main 푸시가 Vercel 운영 배포를 트리거한다는 점을 지켜줘. 다음 우선순위는 공식 자료 기반 29개 회사 그룹·주요 계열사 마스터 구축과 기업 분석 화면의 실제 /api/company 데이터 연결이다. 구현 전 관련 PRD·데이터 모델·아키텍처 문서를 확인하고, 완료 후 node --check와 git diff --check를 실행해줘.
```

Claude가 요약한 내용이 `docs/HANDOFF.md`와 다르면 코드·운영 로그를 확인해 문서를 갱신한 뒤 작업한다.
