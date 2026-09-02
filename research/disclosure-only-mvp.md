# 공시 전용 MVP 검증

조사일: 2026-09-01

## 결론

가능하다. 아래 10개사는 모두 중국 본토 또는 북경거래소 상장사이며, 공식 거래소 공시를 정기적으로 확보할 수 있다. 이 범위로 뉴스 기능 없이도 재무·증설·투자·해외법인·고객/계약·기술개발 등 회사 전략 시계열의 출발점을 만들 수 있다.

공시 전용 MVP는 `CNINFO + 북경거래소(BSE)` 두 개의 공식 채널로 충분하다.

## 제안 추적 10개사

| 구분 | 회사 | 코드 | 공식 공시 채널 | 수집 가능 | 검증 |
|---|---|---:|---|---|---|
| 셀 | CATL (宁德时代) | 300750 | CNINFO / SZSE | 예 | CNINFO 검색 API에서 최근 8건과 PDF 경로 반환 |
| 셀 | BYD (比亚迪) | 002594 | CNINFO / SZSE | 예 | 최근 20건 이상과 PDF 경로 반환 |
| 셀 | Gotion High-tech (国轩高科) | 002074 | CNINFO / SZSE | 예 | 최근 20건 이상과 PDF 경로 반환 |
| 셀 | EVE Energy (亿纬锂能) | 300014 | CNINFO / SZSE | 예 | 최근 15건과 PDF 경로 반환 |
| 양극재 | Ronbay (容百科技) | 688005 | CNINFO / SSE | 예 | CNINFO에 공식 PDF 공시 확인 |
| 양극재 | Hunan Yuneng (湖南裕能) | 301358 | CNINFO / SZSE | 예 | 최근 16건과 PDF 경로 반환 |
| 양극재 | XTC New Energy (厦钨新能) | 688778 | CNINFO / SSE | 예 | 최근 25건과 PDF 경로 반환 |
| 음극재 | BTR (贝特瑞) | 920185 | BSE | 예 | 북경거래소 공식 공시 PDF 확인 |
| 음극재 | Shanshan (杉杉股份) | 600884 | CNINFO / SSE | 예 | 최근 9건과 PDF 경로 반환 |
| 음극재 | Putailai (璞泰来) | 603659 | CNINFO / SSE | 예 | 최근 18건과 PDF 경로 반환 |

## 제외·후보군

- CALB, REPT 등 홍콩 상장 셀사는 HKEX 공시 채널을 별도 구현해야 한다.
- SVOLT 등 비상장사는 거래소 공시만으로는 포괄할 수 없다.
- 당승과학, 덕방나노, 중커전기, 샹타이테크, 펑후이에너지, 파라시스는 2차 확대 후보이며 CNINFO 조회도 확인했다.

## 운영 방식

1. 매일 CNINFO와 BSE에서 회사 코드별 신규 공시만 조회한다.
2. 제목·PDF 원문·공시일·회사·공시유형을 저장한다.
3. PDF 원문을 텍스트로 추출한 뒤 LLM이 한국어 팩트 요약과 시장/기술 시계열 분류를 수행한다.
4. ‘일일 뉴스’ 화면 대신 ‘오늘의 신규 공시’와 ‘공시 기반 전략 변화’를 표시한다.

## 확인된 제약

- CNINFO 검색은 본토 거래소 종목에 적합하다. BTR은 BSE를 별도 수집해야 한다.
- 공시는 보도보다 빈도가 낮으므로 매일 새 내용이 없을 수 있다. 이는 오류가 아니라 ‘오늘 신규 공시 없음’으로 표시해야 한다.
- PDF를 실제 본문 분석 대상으로 쓰려면 Vercel 함수에서 PDF 텍스트 추출 또는 문서 입력 지원 LLM 경로를 추가해야 한다.

## 1차 출처

- CNINFO: https://www.cninfo.com.cn/new/fulltextSearch
- BSE 상장사 공시: https://www.bse.cn/disclosure/announcement.html
- BTR 코드 매핑: https://www.bse.cn/service/code_mapping.html
- Ronbay CNINFO 공시 예시: https://static.cninfo.com.cn/finalpage/2025-08-16/1224497699.PDF
- BTR BSE 공시 예시: https://www.bse.cn/disclosure/2023/2023-01-30/1675078007_244614.pdf
