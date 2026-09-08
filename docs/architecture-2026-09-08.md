# China Battery Lens — 2026-09-08 시점 구조

간략한 그림이다. 실제 런타임은 Vercel 서버리스 + Supabase이며 LangGraph는 쓰지 않는다.
LLM이 붙는 상자만 `🤖`로 표시했다. 나머지는 정규식·API·SQL이라 호출 비용이 없다.

```mermaid
flowchart LR
  subgraph SRC[외부 원천]
    PDF[정기보고서 PDF<br/>cninfo · HKEX]
    NEWS[뉴스<br/>웹 검색]
    EM[거래소 손익 표<br/>datacenter API]
    ECB[USD/CNY 일별<br/>ECB · Frankfurter]
  end

  subgraph CRON[야간 크론 23:00 KST · api/ingest-rss.js]
    C[collect<br/>수집]
    P[process 🤖<br/>본문 대조 · 이벤트]
    D[daily 🤖<br/>Daily 리포트]
    K[curate 🤖<br/>보고서 정독 digestReport<br/>웹 백필 · 임베딩]
    F[refreshFinancialsIfDue<br/>7일 주기 · LLM 0]
    C --> P --> D --> K
    C -.-> F
  end

  subgraph ADMIN[관리자 URL · 로그인 쿠키 필요]
    M1[?metrics=write]
    M2[?financials=write]
    M3[?fx=write]
  end

  subgraph X[추출 · LLM 0]
    RM[lib/report-metrics.js<br/>중문 발췌 → 계정 판정<br/>금액 + 물량(품목 태그)]
    MF[lib/market-financials.js<br/>A주 · 홍콩 · 북경 매핑]
    FX[lib/fx-rates.js<br/>누적 구간 평균]
  end

  subgraph DB[Supabase]
    A[(article)]
    E[(event<br/>original_excerpt)]
    V[(knowledge_chunk<br/>벡터 · pgroonga)]
    R[(report_metric<br/>312행 · 원문 발췌 보유)]
    T[(market_financial<br/>6,098행 · 영업이익 75/75)]
    Q[(fx_rate_period<br/>60행)]
    L[(pipeline_log)]
  end

  NEWS --> C --> A
  P --> E --> V
  PDF --> K --> E
  E --> RM --> R
  M1 --> RM
  EM --> MF --> T
  ECB --> FX --> Q
  F --> MF
  F --> FX
  M2 --> MF
  M3 --> FX
  F --> L

  subgraph UI[화면 · app/app.js]
    U1[Daily]
    U2[기업 분석<br/>정량 궤적 + 월별 사건 플래그<br/>연간 · 분기 · CNY/USD<br/>사실 카드(접힘)]
    U3[시계열 리포트 🤖<br/>정량 표 → 방향 → 사건]
    U4[근거 질의응답 🤖<br/>의미 + 단어 하이브리드]
    U5[비교 🤖]
    U6[관리자 · 데이터 감사]
  end

  D --> U1
  R --> U2
  T --> U2
  Q --> U2
  E --> U2
  L -->|갱신 실패 배너| U2
  R --> U3
  T --> U3
  E --> U3
  V --> U4
  E --> U5
```

## 오늘 붙은 것

| 층 | 무엇 | LLM |
|---|---|---|
| 추출 | `report-metrics.js` — 중문 발췌에서 계정·물량(품목 태그, 누적·계획 분리) | 0 |
| 수집 | `market-financials.js` — 거래소 표준 손익, 25개사 분기 단위 2011~ | 0 |
| 수집 | `fx-rates.js` — 회계 기간 평균 환율 | 0 |
| 자동화 | 크론 안 `refreshFinancialsIfDue`, 실패 시 `pipeline_log` → 화면 배너 | 0 |
| 화면 | 정량 궤적(연간 실선 · 당해 누적 점선 · 분기 토글 · USD) + 월별 플래그 | 0 |
| 리포트 | 시계열 리포트 입력에 정량 표 선행, 사건 시간순, UUID 제거 | 🤖 1회 |

## 아직 안 붙은 것

- 정량 표는 벡터DB에 없다. 질의응답은 사건 문장(`event_fact`)만 본다.
- 출하량·생산능력은 요약이 담은 만큼만(음극재 17건이 최다). 본문 재정독은 P1.5.
- 비상장 7사는 정기보고서가 없어 궤적이 뜨지 않는다(사실 카드만).
