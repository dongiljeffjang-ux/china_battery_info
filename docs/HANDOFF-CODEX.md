# Codex → Claude Code 인수인계

> **2026-09-09 (Codex) — 기업분석 질의 재작성 fallback 및 기간 범위 해석 배포 완료.**
>
> ## 이번 작업
>
> 사용자 질문 `BYD의 2023년부터의 연도별 매출`이 2023년만 해석되던 문제를 수정했다.
> `2023년부터`, `2023년부터의`, `2023년 이후`는 현재 연도를 제외한 최근 완료 연도까지 확장한다.
> 기준일이 2026년이면 `2023`, `2024`, `2025`가 정량 조회 기간이 된다. 명시적인 `2023~2025` 범위는
> 기존처럼 끝 연도를 우선한다. 회귀는 `scripts/check-metric-lookup.mjs`에 BYD 케이스를 추가했다.
>
> 1차 근거 답변이 `sufficient=false`이면 OpenAI RAG 모델이 검색용 질의를 최대 3개로 재작성하고,
> 재검색한 근거를 합쳐 한 번만 최종 답변을 만든다. 재작성은 답변을 생성하지 않으며, 원 질문의 회사·지표·기간
> 의미를 유지해야 한다. `sanitizeRewrittenQueries()`가 원 질문에 없던 회사를 포함한 질의를 버리고,
> 정량 질문의 검색 결과도 원 회사의 `company_id`만 통과시킨다. 재작성 실행 여부와 질의 수는 화면 하단에 표시한다.
>
> ## 운영 배포
>
> - `f2922eb` — 기간 범위 + 검색 재작성 fallback 1차 배포
> - `f0e0f82` — 재작성 회사 범위 이탈 차단(최신)
> - 최신 Production 배포는 Vercel `Ready`, alias `https://china-battery-lens.vercel.app`에 연결됨.
> - 전체 `scripts/check-*.mjs`, `npm run check`, `git diff --check` 통과.
>
> ## 스크린샷에서 확인한 실패와 해석
>
> 입력은 BYD 하나였는데 답변이 BTR·CALB까지 질문에 포함된 것처럼 말했고, 2023~2025가 표시되지 않았다.
> 이는 배포 전후 캐시 문제가 아니라 의미 검색 청크에 다른 회사가 섞인 상태에서 답변 모델이 질문 대상을 확장한
> 사례로 판단했다. 최신 수정은 모델 지시만 믿지 않고 재작성 질의와 정량 결과를 코드에서 회사 기준으로 제한한다.
> 배포 후 반드시 `byd 2023년 이후 연도별 매출`을 다시 실행해 정량 조회 배지와 2023·2024·2025 행을 확인한다.
>
> ## 다음 Claude Code가 할 일
>
> 1. 운영 화면에서 위 BYD 질문을 새로고침 후 실행한다. 기존 탭의 캐시가 남으면 강력 새로고침한다.
> 2. 답변의 `retrieval.metric_lookup.periods`가 `['2023','2024','2025']`인지 확인한다. `metric_rows`가 3 이상이고,
>    근거에 BTR·CALB가 섞이지 않아야 한다.
> 3. 기간 없는 `BYD 매출`은 최신순 상한 동작이므로 범위 질문과 혼동하지 않는다.
> 4. 재작성 fallback을 실제로 검증할 때는 정답이 1차 상위 검색에 없는 질문을 사용하고, 운영 로그/비용을 확인한다.
>    재작성은 최대 3개 질의 + 최종 답변 호출로 비용과 지연이 늘어난다.
>
> ## 주의
>
> `lib/metric-lookup.js`, `lib/knowledge-search.js`는 현재 작업에서 수정된 상태다. 기존 사용자 변경인
> `.claude/settings.local.json`, `docs/PRESENTATION-2026-09-16.md`, `docs/PRESENTATION-2026-09-16.pptx`는 건드리지 않는다.

> **2026-09-09 (Claude Code) — 근거 검색을 7커밋 배포. 배포는 끝났고 운영 재구성 하나가 남았다.**
>
> ## 시작한 이유와 지금 상태
>
> "CATL의 2025년 매출은?"에 근거가 없다고 나온 것이 출발점이었다. 그 값은 그래프에 이미 그려지고
> 있었다. **이 문제는 해결됐고 사용자가 실화면에서 4,237억 위안을 확인했다.**
>
> 그 과정에서 근거 검색의 다른 결함이 연달아 나왔고 전부 고쳐 배포했다. 다만 **마지막 수정(T15)은
> 앞으로 들어올 기사에만 적용된다.** 이미 저장된 기사 227건은 옛 형식 그대로라 검색 품질은 아직
> 그만큼 안 좋아졌다. 아래 "다음 사람이 바로 할 일" 1번이 그것이다.
>
> ## 오늘 배포한 것 (전부 main, Vercel 자동 배포)
>
> | 커밋 | 내용 | 근거 |
> |---|---|---|
> | `34a1879` | **정량 사전조회(T4)**. 회사·지표를 짚은 질문은 검색 대신 `report_metric`·`market_financial`을 SELECT해 근거 앞에 붙인다. LLM 0회 | 사용자 실화면 |
> | `368a28b` | RAG 평가 저장 버그 2건. 정량 행 id를 결정적 UUID로, `isSchemaMissing`의 과잉 매칭 수정 | DB 재현 |
> | `867ea23` | **한국어 회사 표기 10개사 + 단어 검색 회사 필수 조건** | 상위 10건 회사 순도 6개사→1개사 |
> | `343704a` | 융합 뒤 회사 후처리, 가중치 0.5/0.5→0.7/0.3, RRF k 60→10 | 사람 판정 42건(T6) |
> | `12a9f0f` | 기사당 청크 상한 2건, 핵심 사실 카드 불릿(사용자 요청) | 실화면 |
> | `966f488` | 회사별 필수 그룹 분리, `guidance_ko` 두 문장 상한 | DB 실측 |
> | `7e5f155` | **청크마다 요약을 복사하던 것을 멈춤(근본 원인)** | 청크 627개 중 61.2% 중복 |
>
> ## 다음 사람이 바로 할 일
>
> ### 1. 기존 기사 청크 재구성 — **가장 중요하고, 막혀 있다**
>
> `7e5f155`가 저장 규칙을 고쳤지만 기존 227건은 그대로다. 재구성 스크립트가 있다.
>
> ```
> node --env-file=.env.local scripts/restructure-article-chunks.mjs          # dry-run(쓰기 없음)
> node --env-file=.env.local scripts/restructure-article-chunks.mjs --apply
> ```
>
> - **막힌 이유**: 재임베딩에 실제 `OPENAI_API_KEY`가 필요한데 로컬은 플레이스홀더다(U1과 같은 막힘).
> - **추가 확인 필요**: 사용자가 "로컬에 키를 넣었더니 유출됐다고 한 적 있다"고 했다. 저장소 기록에
>   유출 사고는 **없고**, `[SENSITIVE]`는 Bash 도구와 `vercel env pull`이 값을 **가리는** 표시다.
>   이전 세션이 그걸 유출로 오판했을 가능성이 있으나 확인되지 않았다. **키 재발급 여부를 사용자와
>   먼저 정리한 뒤** 진행한다.
> - 스크립트 성질: dry-run 기본, 기사 하나씩 **먼저 넣고 나중에 옛 조각만 지운다**(반대로 하면 실패한
>   기사의 근거가 사라진다), 두 번 돌려도 결과가 같다, 원문을 다시 받지 않고 저장된 `content_ko`에서
>   본문을 되살린다(`body_original`은 임베딩 뒤 지워지므로 재번역 경로가 없다).
>
> ### 2. T6 5문항 재판정 (사람)
>
> `/admin → RAG 평가 → 검색 정밀도`에서 아래 5문항. 기준선은 **정밀도 0.34**(판정 42건).
>
> 1. 완룬신에너지 나트륨이온 정극재 개발 현황 2. CATL 2019년 영업이익 3. 룽바이 LFP 증설 계획
> 4. 파라시스 2026년 상반기 신규 고객 5. 전고체 배터리 양산 시점(회사 필터 없음)
>
> 1번을 먼저 돌리고 재판정하는 것이 낫다. 지금 재판정하면 청크 재구성 효과가 빠진 값이 나온다.
>
> ### 3. 다중 회사 귀속을 검색에 연결 (미착수)
>
> `article_company`에 **두 회사 이상 묶인 기사가 95건**인데 `knowledge_chunk.company_id`는 하나만
> 담고 검색 RPC도 그것만 본다. 그래서 오늘 본문 문자열을 검사하는 후처리를 세 겹 쌓았다
> (`questionCompanyTerms`·`demoteUnrelatedCompanies`·회사별 필수 그룹). `company_ids` 배열을 두고
> `article_company`에서 채워 RPC가 그 배열을 보게 하면 그 세 겹을 걷어낼 수 있다.
> **스키마 변경 + 운영 UPDATE**라 SQL 파일을 만들고 실행 전 사용자 확인이 필요하다.
>
> ## 오늘 확인한 사실 (재조사 불필요)
>
> - **단어 검색 0.17 / 의미 검색 0.46 / 양쪽 겹침 0.50** (사람 판정 42건). 못 씀 25건 중 15건을 단어
>   검색이 혼자 만들었다. 최대 실패 원인은 "다른 회사" 12건이고 의미 검색도 회사를 틀린다(못 씀 5건 중 4건).
> - **PGroonga 점수는 길이 보정이 없다.** 104자짜리 정답(7점)이 긴 무관 기사(41점)에 진다. 검색어를
>   손봐도 안 고쳐진다. 정량 질문을 표에서 읽게 한(T4) 이유다.
> - **임베딩은 회사와 연도를 잘 못 가린다.** 같은 회사 2023~2026년 매출 청크가 유사도 0.80~0.89에 뒤섞인다.
> - **`report_metric` vs `market_financial` 교차 대조**: 겹치는 145칸 중 141칸 일치. 어긋난 4칸은
>   전부 계정 오선택(자회사·제품 매출을 전사 매출로). **단위 오류 0건.** `scripts/crosscheck-report-metrics.mjs`
> - **추적 32개사 중 16개사에 한국어 표기가 없었다.** 10개사는 DB에 실제로 쓰인 표기로 채웠고, 근거가
>   없는 6개사(hithium·rept·svolt·lopal·kuntian·carbon-one)는 **여전히 한국어로 검색이 안 된다.**
>
> ## 손대면 안 되는 것 / 알아둘 것
>
> - **`aliases`를 넓히지 않는다.** 그 필드는 기사→회사 귀속(`companiesFor`)과 데이터 감사가 함께 쓴다.
>   검색용은 `search_aliases`와 `companySearchTerms()`가 따로 있다.
> - **`isSchemaMissing`은 `PGRST205`만 본다.** 예전처럼 테이블 이름을 부분 문자열로 잡으면 이 테이블의
>   모든 제약 위반이 "SQL 미실행"으로 오진단된다.
> - **`rag_evaluation.chunk_id`의 외래키는 없앴다**(`supabase/rag-evaluation-metric-rows.sql`, 09-09 실행 완료).
>   정량 조회 행은 `knowledge_chunk`에 없는 결정적 UUID를 쓰기 때문이다.
> - **T8(표 단위 꼬리표) 미수정.** `lib/report-metrics.js`가 `[单位:千元]` 꼬리표를 못 읽어 1000배 작은 값이
>   나온다. 꼬리표가 붙은 `event` 528건이 전부 마지막 백필 이후에 생겨 **아직 DB는 깨끗하다.**
>   `backfill-report-metrics.mjs --write`를 T8 수정 전에 돌리면 그때 처음 오염된다.
> - **회귀 42개는 전부 통과 상태다.** `check-*.mjs`가 소스를 글자로 대조하므로 Windows CRLF에 깨질 수
>   있다. 오늘 두 개를 줄바꿈 무시하도록 고쳤다.
>
> ## 이 세션의 반성 (다음 사람이 같은 실수를 피하도록)
>
> 확인하지 않은 것을 원인으로 단정한 적이 여러 번이다. "오염 38건"(전부 정상이었다), "중복 기사가
> 상위를 밀어냈다"(실제 원인은 점수 계산), T5 원문 임베딩 제안(계획서에 하지 말라고 적혀 있었다).
> 사용자가 화면을 보여줄 때마다 그 화면에만 매달려 근본 원인을 늦게 찾았다 — `7e5f155`가 원인인데
> `12a9f0f`에서 증상을 순위로 가린 뒤에야 도달했다. **코드가 미흡한 것과 그것이 지금 문제를 일으키는
> 것은 다르다. 세어 보고 원인이라고 부른다.**

> **2026-09-09 — U1(`vercel env pull`) 원인 발견, 사용자 요청으로 중단. 아직 안 끝났다.**
>
> ## 무엇을 확인했나
>
> `npx vercel env pull .env.local`(인자 없음 → 기본 `development` 환경)을 실행하면 CLI가
> `OPENAI_API_KEY`·`SUPABASE_URL`·`SUPABASE_SERVICE_ROLE_KEY`·`DEEPSEEK_API_KEY` 등을
> **"Kept ... (defined locally, not found in the development Environment)"**로 보고한다. 즉 이
> Vercel 프로젝트의 **Development 환경에는 이 값들이 아예 설정돼 있지 않고**, 로컬에 있던 기존
> 플레이스홀더가 그대로 유지된다. 실제로 갱신된 건 `VERCEL_OIDC_TOKEN` 하나뿐이었다.
>
> `T0.1`(`scripts/probe-digest.mjs wanrun-new-energy semiannual https://static.cninfo.com.cn/finalpage/2026-08-29/1225524978.PDF`)을
> 재실행해 재확인했다. 결과는 09-08과 동일한 실패다.
> - `Error: OPENAI_401: Incorrect API key provided`
> - `[PIPELINE_LOG_FAILED] Failed to parse URL from [SENSITIVE]/rest/v1/pipeline_log`
>   (`SUPABASE_URL`이 유효한 URL이 아니라는 뜻 — 여전히 플레이스홀더)
>
> **결론: U1은 아직 안 끝났다.** `vercel env pull` 자체는 성공(exit 0)했지만 원하는 값을 못
> 받아왔으므로 "실행함"과 "완료됨"을 구분해야 한다.
>
> ## 다음에 시도하려던 것 (사용자가 실행 직전 멈춰 달라고 해서 중단)
>
> `npx vercel env pull .env.local --environment=production`으로 **Production 환경 변수**를 받으려
> 했으나 실행하지 않았다. 이 명령은 운영 시크릿을 로컬 파일로 내려받는 것이라 사용자 승인이 먼저
> 필요하다고 판단해 중단한 상태다.
>
> - `.env.local`은 `.gitignore`에 걸려 있음을 확인했다(`grep '^\.env' .gitignore` → 매치, `git status
>   --short`에도 안 잡힘). 지금 상태로도 커밋 위험은 없다.
> - Bash 도구가 API 키 등 민감값을 자동으로 `[SENSITIVE]`로 마스킹해서 파일 내용을 육안으로 대조
>   검증할 수 없었다(길이 11자 `[SENSITIVE]` 문자열만 보임). 값 자체의 정오는 스크립트 실행 성공/
>   실패로만 판단 가능하다.
>
> ## 다음 사람이 할 일
>
> 1. 사용자에게 **`vercel env pull ... --environment=production`을 실행해도 되는지** 확인한다.
>    동시에 Vercel 대시보드(Settings → Environment Variables)에서 이 변수들이 애초에 Development
>    체크박스 없이 Production 전용으로만 등록돼 있는지도 확인하면 원인이 명확해진다.
> 2. 승인되면 재실행 후 **`T0.1`을 다시 돌려** `OPENAI_401`/`SUPABASE_URL` 오류가 사라지는지로
>    성공 여부를 판정한다(파일 내용 육안 확인이 안 되므로 이게 유일한 검증 방법이다).
> 3. U1이 실제로 끝나야 `T0.1`의 `verdict`가 나오고 T1 범위가 정해진다. 그 전까지 진단 전체가 막혀
>    있다 — U2도 같은 이유로 막혀 있을 가능성이 높다(같은 Supabase 접근이 필요).

> **2026-09-08 밤 — 기업 궤적 그래프의 지표 선택 UI 개편. 배포·실화면 확인 완료.**
>
> 사용자 요청으로 궤적 그래프의 지표 선택을 **그래프 좌우 메뉴**로 바꿨다. 왼쪽은 재무를
> 손익계산서 순(매출 → 매출원가 → 매출총이익 → 영업이익 → 세전이익 → 순이익 → 지배주주·비경상
> 제외)으로, 오른쪽은 물량·생산능력을 출하량/장착량/생산능력으로 묶어 세로로 놓는다. 세 칸의
> 위아래를 맞추고 오른쪽 버튼을 키워 남는 공간을 나눴다. 사용자가 배포 화면에서 확인했다.
>
> | 커밋 | 내용 |
> |---|---|
> | `4a20cc0` | 좌우 메뉴 배치, 손익계산서 순서, 관계 기호(`=`는 매출−매출원가=매출총이익 한 자리만, 나머지는 `↓`) |
> | `044e830` | 세 칸 높이 정렬, 오른쪽 버튼 38px + `space-evenly`, 툴팁에 출처 보고서 표기, 계획값 첫 줄 '누적'→'시점' |
> | `72120e4` | **감사 수정** — `report_kind`의 실제 값은 `annual_report`/`periodic_report`라 사전이 안 맞았다. 반기·분기와 연도는 `period`에서 읽는다 |
>
> 지켜야 할 것과 그 이유:
> - **`=`를 다른 자리에 붙이지 않는다.** 매출총이익→영업이익 사이에는 판관비, 영업이익→세전이익에는
>   영업외손익, 세전이익→순이익에는 법인세가 있는데 우리는 그 계정을 갖고 있지 않다. 없는 항등식을
>   그리면 사용자가 그것을 근거로 계산한다. 화면은 값을 계산하지 않는다(`check-metric-picker.mjs`).
> - **버튼을 늘어나게 두지 않는다.** 한 묶음에 항목이 하나뿐일 때 138px짜리 덩어리가 됐다(실측).
>   크기를 고정하고 여백을 나눈다.
> - **툴팁 출처의 연도는 `occurred_at`이 아니라 `period`에서.** 연차보고서의 사건일이 이듬해 1월로
>   찍힌 행이 있어 `occurred_at`의 해는 회계연도와 어긋날 수 있다(`check-metric-source-label.mjs`).
> - 회귀에 쓰는 표본값은 **DB의 실제 값**으로 쓴다. `72120e4`의 버그는 회귀가 통과했는데도 운영에서
>   모든 툴팁이 '정기보고서'로 나올 뻔한 경우였다 — 회귀가 내가 지어낸 값만 검사했기 때문이다.
>
> 이 작업과 별개로 다른 세션이 T1(추출 근거 정합성, `a50f1d8`·`5ce74a3`·`0566bb0`)을 진행해 푸시했다.
> RAG 복구의 현재 상태는 아래 항목과 `docs/PLAN-embedding-recovery.md`를 본다.

> **2026-09-08 저녁 — 벡터 지식(RAG) 복구 착수. 계획 문서 `docs/PLAN-embedding-recovery.md`가 단일 출처다.**
>
> ## 먼저 알아야 할 것
>
> 질의응답이 보는 벡터 코퍼스(`knowledge_chunk` 1,701행)는 **정기보고서에서 뽑아야 할 사실의
> 대부분을 담고 있지 않고, 담긴 것마저 시점이 뭉개져 있으며, 정량 테이블 6,410행은 아예 안
> 보인다.** 완룬신에너지 2026 반기보고서 MD&A 앞 12,000자를 직접 읽어 센 결과 시계열 후보가
> 28건인데 저장된 이벤트는 3건이고, 그 3건은 사실 15개를 뭉친 덩어리였다. 원문에 `2026年N월`
> 표기가 20회 나오는데 저장된 3건은 전부 `2026-06-30 / half`다 — **날짜가 명시된 사건이 하나도
> 살아남지 못했다.** 프롬프트가 "보고 기간 말일로 밀어 넣지 않는다"고 명시하는데도 그렇다.
>
> 실측 근거 15건과 작업 그래프(T0~T6), 각 작업의 자족 브리프는 전부
> **`docs/PLAN-embedding-recovery.md`**에 있다. 이 파일에 요약을 중복해 적지 않는다 —
> 갈라지면 어느 쪽이 맞는지 알 수 없게 된다.
>
> ## 사용자 조치 대기 (이게 막히면 아래가 전부 막힌다)
>
> | # | 조치 | 막히는 것 |
> |---|---|---|
> | **U1** | `vercel env pull .env.local` | **T0.1을 포함한 모든 진단·검증.** 로컬 `.env`는 플레이스홀더다(2026-09-08 확인: `OPENAI_401`, `SUPABASE_URL` 파싱 실패) |
> | U2 | `supabase/report-digest-diagnostics.sql` 실행 | 진단값이 안 쌓인다. 파이프라인은 정상 동작한다(진단 PATCH가 조용히 실패) |
> | U4 | `market_financial` 6,098행(원문 발췌 없음, 출처 eastmoney)을 RAG 근거로 허용할지 결정 | T4(정량 사전조회) 착수 |
> | U5 | `/admin → RAG 평가`에서 기준선 판정 5문항 | 개선 전후 비교 근거. **T1·T2 배포 전에 찍어야 한다** |
>
> `supabase/rag-evaluation.sql`은 이미 실행됐다(`rag_evaluation` 0행).
>
> ## 이번 세션에 푸시된 것
>
> | 커밋 | 내용 |
> |---|---|
> | `498e7b5` | `/admin`에 **RAG 평가** 화면(청크 품질·검색 정밀도·집계)과 `rag_evaluation` 저장소 |
> | `054883c` | 보고서 임베딩을 훅 시간 예산으로 끊고, 품질 메타 `ReferenceError` 수정 |
> | `ab68c39` | 비교 리포트에서 웹 검증 실패와 '고칠 게 없었다'를 구분 |
> | `a62b044` | 2026-09-08 구조도, `hybrid-search.sql` 주석에 실측 분포 반영(DDL 변화 없음) |
> | `4073b92` | 복구 계획 문서 + `scripts/probe-digest.mjs`(T0.1 진단, DB 쓰기 없음) |
> | `50739af` | **T0.2 완료** — 추출 진단값 7개 컬럼, 조각 부분 실패 보존 |
>
> ## `50739af`에서 계획에 없이 고친 버그 (중요)
>
> `digestReport`가 보고서 조각을 `Promise.all`로 돌렸다. **조각 5개 중 하나가 타임아웃하면 앞
> 4개의 결과까지 통째로 버려진다.** `Promise.allSettled`로 바꾸고 실패한 조각 수를 반환한다.
> "보고서 107건 중 53건이 이벤트 3건 이하"의 원인 후보이며, T0.1이 확인해 줄 것이다.
> 곁들여 `renewReport`는 조각이 하나라도 실패하면 건수가 하한을 넘어도 옛 이벤트를 지우지
> 않는다 — 부분 결과로 바꿔 넣으면 실패한 구간의 사실이 영구히 사라진다.
>
> ## 다음 사람이 바로 할 일
>
> 1. U1이 끝났으면 **T0.1 실행**. 출력 JSON의 `verdict`가 T1 범위를 정해 준다.
>    ```
>    node scripts/probe-digest.mjs wanrun-new-energy semiannual https://static.cninfo.com.cn/finalpage/2026-08-29/1225524978.PDF
>    ```
> 2. U1을 기다리는 동안 **T2 코드 작성** — `lib/vector-ingestion.js`의 `embedEvents`가
>    `[시점] 2023-12-31`만 넣고 `occurred_precision`을 안 넣어 RAG가 결산일을 날짜로 읽는다
>    (751건 중 532건, 70.8%). 코드는 키 없이 쓸 수 있고 재생성만 U1이 필요하다.
> 3. U4 결정이 나면 **T4**는 LLM 호출 0회라 언제든 시작할 수 있다.
>
> ## 손대면 안 되는 것
>
> - `lib/compare-report.js`·`app/app.js`는 다른 세션이 작업 중일 수 있다. 커밋 전 `git status`로 확인한다.
> - `knowledge_chunk`·`report_metric`·`market_financial`에 DELETE/UPDATE를 돌리지 않는다.
> - `REPORT_TEXT_ONLY_EMBEDDING`을 지금 켜지 않는다(T5, 이미지 도표 비율이라는 근거가 아직 없다).

> **2026-09-08 — 벡터DB(RAG) 사람 평가 화면 추가. 배포·SQL 적용 완료(`498e7b5`). 아래 '다음에 할 것'의 1·2번은 끝났다.**
>
> ## 무엇을 왜
>
> 벡터DB에 무엇이 들어가 있는지는 `/admin`의 `청크 · 임베딩`과 `벡터 검색 시험`으로 볼 수 있었지만,
> 본 것을 **기록으로 남길 곳이 없었다.** 그래서 "지난주에 봤을 때 나빴다"가 다음 사람에게 전달되지
> 않고, 하이브리드 가중치(의미 0.5 / 단어 0.5)를 조정할 근거도 감이었다. 사람 판정을 테이블에
> 쌓아 집계로 되돌려 준다.
>
> ## 두 가지를 나눠 평가한다 (섞으면 원인을 못 가린다)
>
> | 대상 | 무엇을 잡나 | 화면 |
> |---|---|---|
> | 청크 품질 | 저장 단계의 오염 — 회사 오귀속, 번역 오류, 알맹이 없는 문장 | `/admin` → RAG 평가 → 청크 품질 |
> | 검색 정밀도 | 저장은 멀쩡한데 그 질문에 안 맞는 근거가 상위에 오는 실패 | 같은 화면 → 검색 정밀도 |
>
> 판정은 세 단계뿐이다(쓸 만함 1점 / 애매 0.5점 / 못 씀 0점). 다섯 단계로 늘리면 사람마다 3과 4의
> 기준이 갈려 집계가 흔들린다. 사유 태그는 대상별로 목록이 다르고 `lib/rag-evaluation.js` 한 곳에서만
> 정의한다. 회귀가 lib 목록과 SQL 제약이 갈리지 않는지 검사한다.
>
> ## 바꾼 파일
>
> - `supabase/rag-evaluation.sql` (신규, **아직 운영 DB에 적용 안 함**): `rag_evaluation` 테이블,
>   부분 유니크 인덱스 2개(같은 대상 재평가는 덮어쓴다), RLS·권한 회수. 재실행 가능.
> - `lib/rag-evaluation.js` (신규): 판정·사유 목록, 입력 검증(`buildEvaluationRow`), 질문 키 해시,
>   집계(`summarizeEvaluations`), 질문별 세션·정밀도(`buildRetrievalSessions`). 순수 함수만 둔다.
> - `api/admin.js`: 조회 3종(`eval-summary`·`eval-chunks`·`eval-search`)과 **쓰기 2종**
>   (`POST eval-save`·`eval-delete`). Vercel Hobby 함수 수 제한 때문에 새 `api/*.js`를 만들지 않고
>   기존 관리자 API에 붙였다. 쓰기는 `rag_evaluation`에만 닿고 파이프라인 데이터는 건드리지 않는다.
> - `app/admin.html`·`app/admin.js`: `RAG 평가` 메뉴와 세 하위 화면. 캐시 버전 `v=20260908-eval`.
> - `scripts/check-rag-evaluation.mjs` (신규): 회귀 32종 → 전체 31개 스크립트 통과.
>
> ## 설계에서 일부러 그렇게 한 것
>
> - **판정을 누르면 즉시 저장한다.** 저장 버튼을 따로 두면 라벨링이 절반 속도가 되고 "누른 줄 알았는데
>   안 눌린" 상태가 생긴다. 사유·메모는 판정이 있을 때만 다시 저장한다.
> - **평가하지 않은 근거는 분모에 넣지 않는다.** 넣으면 "아직 안 본 것"이 "무관"과 같은 값이 되어
>   정밀도가 실제보다 낮게 나온다.
> - **`chunk_source_type`·`company_id`를 평가 행에 비정규화해 적는다.** 집계할 때 조인이 필요 없고,
>   재임베딩으로 청크가 갈려도 그 평가가 무엇에 대한 것이었는지 남는다.
> - **`question_key`**(정규화 질문 + 회사 필터 + 미검증 포함 여부의 해시)로 같은 질문을 한 묶음으로
>   센다. 검색 조건이 다르면 애초에 다른 검색이므로 다른 묶음이 된다.
> - **이 판정으로 자동 삭제·자동 가중치 조정을 하지 않는다.** 파이프라인은 이 테이블을 읽지 않는다.
>
> ## 확인한 것과 확인 안 한 것
>
> - 확인: 31개 회귀 스크립트·`npm run check`·`node --check`·`git diff --check` 전부 통과.
>   가짜 API를 물린 미리보기에서 판정 즉시 저장, 사유·메모 재저장, 판정 취소, 세 하위 화면 렌더링,
>   콘솔 오류 없음까지 브라우저로 확인했다.
> - **확인 안 함: 운영 DB·실제 데이터로는 한 번도 돌리지 않았다.** SQL 미적용 상태이므로 지금 화면을
>   열면 노란 안내가 뜨고 저장이 실패한다(조회는 된다).
>
> ## 다음에 할 것
>
> 1. `supabase/rag-evaluation.sql`을 Supabase SQL Editor에서 실행한다.
> 2. 커밋·push 여부를 사용자에게 확인한다(push하면 Vercel이 `main`을 배포한다).
> 3. 배포 후 `/admin` → RAG 평가에서 실제 청크에 판정을 하나 찍어 저장·집계까지 도는지 본다.
> 4. 청크 30~50건, 질문 5~10개쯤 평가가 쌓이면 `집계`의 **어느 검색기가 건졌나** 표를 본다.
>    한쪽 점수가 낮으면 `lib/knowledge-search.js`의 `VECTOR_WEIGHT`/`LEXICAL_WEIGHT`를 조정한다.
>    표본이 적을 때 점수만 보고 가중치를 건드리지 않는다 — 원 건수를 함께 본다.
>

> **2026-09-08 최신 갱신 — 관리자 데이터 감사·검색 용어 확장·기업 화면 가독성 개선 완료. 아래의 예전 최상단 하이브리드 인수인계 중 “아직 push 안 함”은 더 이상 유효하지 않다.**
>
> ## 이번 세션에서 푸시된 변경
>
> | 커밋 | 상태 | 내용 |
> |---|---|---|
> | `deb0bd0` | push 완료 | `/admin` 읽기 전용 **데이터 감사** 메뉴. 기사↔회사, 이벤트/청크↔기사 회사 연결을 전수 점검하고 후보 필터·CSV를 제공. 자동 수정은 없다. |
> | `e1ccbb9` | push 완료 | 기업 질의응답 검색어를 배터리 도메인 한·중·영 동의어와 추적 회사 별칭으로 확장. ‘보조 데이터 포함’은 미검증 헤드라인까지 검색 풀을 넓힌다. 검증 통과 기사·이벤트·Daily는 기존에도 기본 검색 대상이었다. |
> | `f1db989` | push 완료 | 데이터 감사 오탐 수정. 다중 회사 기사는 제목·요약만 보지 않고 `article_chunk` 본문도 대조하며, 검사 대상 회사를 따로 표시한다. headline/event_fact의 템플릿 회사명은 귀속 검증 근거로 쓰지 않는다. |
> | `3c6f76d` | push 완료 | 연차·반기보고서 핵심사실을 제목+사실 최대 300자로 확장하고 시장→기술 세로 배열로 바꿨다. |
>
> | `b12b2cc` | push 완료 | 기업 시계열 표의 중앙 **시점** 열을 72px로 고정하고 남는 폭을 시장·기술 4개 레이어에 배분. |
>
> ## 시점 열 폭 조정 상세
>
> - 기업 페이지 `시장·기술 레이어별 시간축`의 중앙 **시점** 열이 고정 레이아웃의 첫 헤더 빈 칸 때문에 화면 폭 약 20%를 먹던 문제를 고쳤다. `colgroup`의 `matrix-time-col=72px`로 고정하고 남은 폭을 시장·기술 4개 레이어에 배분한다.
> - 변경 파일: `app/app.js`, `app/styles.css`, `app/index.html`(캐시 버전).
> - `node --check app/app.js`, `npm run check`, `scripts/check-*.mjs` 전체(26개), `git diff --check` 통과. `.claude/settings.local.json`은 개인 설정 파일이므로 커밋하지 않는다.
> - 이 변경은 `b12b2cc`에 포함돼 `main`에 푸시됐다.
>
> ## 운영 시 확인할 것
>
> - 데이터 감사의 ‘높음’은 자동 확정 오류가 아니다. 본문에도 연결 회사가 없고 단일 회사 귀속인데 다른 추적 회사명이 잡힌 경우만 높음이다. 다중 회사·본문 공백은 ‘확인 필요’로 본다.
> - 검색어 확장은 검색 전처리이며 재임베딩이 필요 없다. `벡터DB 임베딩 채우기` 버튼은 `event_fact`가 없는 이벤트만 복구한다.

> **2026-09-08 갱신 — 기업 질의응답에 하이브리드 검색 도입. 커밋·SQL 적용 완료, 배포·화면 확인 남음.**
>
> ## 무엇을 왜
>
> 기업 페이지의 근거 인용 질의응답(`api/company.js` `runAsk` → `lib/knowledge-search.js`
> `answerFromKnowledge`)이 임베딩 코사인 단일 경로였다. `SW-2413` 같은 코드·모델명·정확한 수치는
> 임베딩이 주변 문맥에 녹여 버려 상위 k에 들어오지 못한다. 의미 검색(기존)과 단어 검색(신규)을
> 나란히 돌려 RRF(Reciprocal Rank Fusion)로 순위를 합치는 구조로 바꿨다. 하이브리드는 후보를
> 좁히는 장치가 아니라 넓히는 장치다 — 검색기당 10건 → 합집합 후보 최대 20건 → 프롬프트 10건.
>
> ## 무엇을 바꿨나
>
> - `supabase/hybrid-search.sql` (신규, **운영 DB에 적용 완료**): `pgroonga` 확장,
>   `knowledge_chunk.search_text` 생성 컬럼(`content_ko + original_excerpt + content_original`),
>   `TokenBigramSplitSymbolAlphaDigit` 토크나이저 인덱스, `lexical_knowledge_chunks()` RPC.
> - `lib/knowledge-search.js`: `buildLexicalQuery()`(질문 토큰화 → 불용어 제거 → 조사 변형 OR
>   확장 → 연산자 문자 차단), `fuseByRrf()`(k=60, 가중치 0.5/0.5), `searchKnowledge()`가 두
>   검색기를 `Promise.allSettled`로 병렬 실행하고 **독립적으로 실패**한다(아래 참고).
>   `MATCH_COUNT`(프롬프트에 넣는 근거 수)는 `ANSWER_SCHEMA`의 `used_sources` 상한과 같아야
>   하고, 회귀가 이 등식을 검사한다.
> - `api/company.js`: `[KNOWLEDGE_ASK]` 로그에 `retrieval` 통계(`vector_matched`,
>   `lexical_matched`, `candidates`, `overlapped`, `*_available`) 추가.
> - `app/app.js`·`app/styles.css`: 근거마다 `의미+단어` / `단어 검색` / `의미 검색` 칩, 하단에
>   융합 통계 문구. 의미 검색이 끊긴 경우와 단어 검색 색인이 없는 경우를 다른 문구로 구분.
> - `scripts/check-hybrid-search.mjs` (신규): 합집합·겹침 보너스가 가중치로 안 뒤집힘·연산자
>   삽입 차단·양방향 물러남(단어 검색 404 / 임베딩 429 / 둘 다 실패) 회귀. 26개 회귀 스크립트,
>   `npm run check`, `git diff --check` 모두 통과.
> - 커밋 `e6b772e`(`main`, **아직 push 안 함** — 배포는 사용자 승인 대기).
>
> ## 왜 Kiwi가 아니라 PGroonga인가 (측정 기반 정정 포함)
>
> 처음에 "`content_ko`에 한국어·중국어가 섞여 있다"를 표본 1건(`article_chunk`)만 보고
> 단정했는데, 사용자가 "번역된 한국어 아니냐"고 되물어 실제 분포를 셌더니 절반만 맞았다.
>
> | source_type | 행 | 한글 | 한자 | 30자↑ 중국어 덩어리 |
> |---|---|---|---|---|
> | `event_fact` | 749 | 43% | 1% | 0 |
> | `article_chunk` | 598 | 13% | 29% | 79 |
> | `headline` | 340 | 34% | 15% | 36 |
> | `original_excerpt`(컬럼) | 1064 | 0% | 65% | — |
>
> `event_fact`는 사실상 순수 한국어다. 다만 기본 검색 풀(헤드라인 제외 1359행)의 44%인
> `article_chunk`는 한자가 한글의 2배가 넘고 `original_excerpt`는 한글 0%라, 한국어 전용
> 분석기는 여전히 절반을 놓친다. 더 중요한 이유는 이 검색이 건져야 하는 게 형태소가 아니라
> 부서지지 않은 코드·모델명·고유명사이고, kiwi 모델(58.7MB, 공식 ONNX 빌드 없음)을 Vercel
> 함수에 실을 이유도 없다는 것이다.
>
> **LLM 회계**(사용자의 "최대한 LLM 안 쓰는 방향" 요구): 단어 검색은 Postgres 안에서 끝나 외부
> 호출이 0이다. 이 기능의 외부 호출은 질문 임베딩(OpenAI) 1회와 답변 생성(LLM) 1회 그대로다.
> 처음 구현에서 임베딩 실패 시 단어 검색이 멀쩡해도 전체를 throw하던 것을 고쳤다 — 이제 두
> 검색기가 독립 실패하고, 한쪽만 살아 있으면 그것으로 답하며, 둘 다 죽었을 때만 오류를 올린다.
>
> **리랭킹(bge-reranker-v2-m3)은 검토 후 보류했다.** 568M 크로스인코더(safetensors 2.27GB,
> ONNX 빌드 없음)라 Vercel에 못 싣고 호스팅 API(외부 호출 1회 추가, 질문당 ~$0.0003)만
> 가능한데, 회사별 청크가 중앙값 35건(32개사 중 28곳이 60건 이하)이라 "넓게 뽑기"가 사실상
> 전수 조회가 된다. 코퍼스가 회사당 수백 건대로 쌓이면 재검토할 만하다. 사용자 판단으로 구현
> 안 함(코드 변경 없음).
>
> ## 운영 DB에서 확인한 것 (읽기 전용 검증, 파괴적 작업 없음)
>
> - `pgroonga` 3.2.5, `search_text` 컬럼, 인덱스, RPC 네 가지 모두 설치 확인.
> - 색인 재현율이 `LIKE` 원문 대조와 정확히 일치: `NCM` 4/4, `811`(문자열 안 숫자 조각) 2/2,
>   `NCM811`은 코퍼스에 원래 없어 0/0(색인 문제 아님).
> - 점수 변별력 확인(30건 중 6.0/5.0/4.0 세 구간, 동점 아님).
> - `search_text` 추가로 테이블 용량 +1.4MB(1,699행 기준). 무시할 수준.
>
> ## 다음에 확인할 것
>
> 1. **배포 여부를 사용자에게 확인 후 push.** push하면 Vercel이 `main`을 배포한다.
> 2. 배포된 기업 페이지에서 질문을 던져 하단에 "의미 검색 N건 + 단어 검색 M건 …" 문구와
>    근거별 `단어 검색`/`의미+단어` 칩이 실제로 뜨는지 확인(이 부분은 SQL·RPC 단위로만
>    검증했고 앱을 통한 전체 경로는 아직 안 봤다).
> 3. `lexical_matched`가 계속 0으로 로그에 남으면 `buildLexicalQuery()`가 그 질문에서 빈
>    문자열을 냈거나(불용어만 남음) RPC 권한 문제다.
> 4. 재현율이 지나치면(무관한 근거가 단어 검색으로 많이 들어오면) `LEXICAL_WEIGHT`를 낮추거나
>    `QUESTION_STOPWORDS`를 넓힌다. 반대로 놓치는 게 많으면 `KO_SUFFIX_*` 조사 목록을 넓힌다.

> **2026-09-07 밤 갱신 — Reshine bootstrap 구현·배포 완료. 실제 실행 검증은 아직.**
>
> 아래 C절 계획대로 구현해 커밋 `1b1459b`(`main`)까지 푸시했다. 사용자 요청으로 검색 기간은
> 계획한 180일이 아니라 **365일**로 넓혔다(단독 그룹이라 요청 수는 늘지 않는다).
>
> - `lib/china-sources.js`: `buildSearchGroups(provider, pilot, bootstrapCompanyIds)`가 bootstrap
>   대상을 일반 묶음에서 빼고 회사당 단독 그룹(`windowDays=365`)으로 낸다. 후보 기사에
>   `bootstrap: true`가 붙는다.
> - `api/ingest-rss.js`: `bootstrapCompanyIds()`가 `article_company` 연결 0건인 회사만
>   (`reshine`, `kaijin-new-energy`) 매 실행 다시 계산한다(읽기 전용, 기사 1건만 생겨도 다음 실행부터
>   빠짐). bootstrap 후보는 `source_tier=web_search_bootstrap_<provider>`로 저장. 파일럿(3사 검증)은
>   bootstrap을 켜지 않는다. `selectHeadlineTop10()`이 3일 창과 별도로 bootstrap 기사 최대 2건을 뽑아
>   본문대조까지 보낸다(news/bootstrap 중복은 article id로 dedupe).
> - `scripts/check-search-plan.mjs`에 회귀 4종 추가(단독 그룹·365일 창·일반 그룹 미중복·기본 호출 불변).
>   19개 회귀 스크립트·`npm run check`·`git diff --check` 모두 통과.
>
> **다음에 확인할 것**: 09-07 23:00 크론(또는 사용자가 직접 누르는 수집 버튼) 이후 Supabase에서
> Reshine·Kaijin의 `article`/`article_company`/`event`를 확인한다. 특히
> `source_tier=web_search_bootstrap_*`가 저장만 되고 Top 10(`pipeline_log`의 `process` 단계 로그)에서
> 빠지지 않았는지, 연결되면 다음 실행부터 `bootstrap_ids`가 그 회사를 뺐는지(`collect` 로그) 본다.
> 이 검증은 **아직 하지 않았다.** 아래 수동 백필로 채운 것은 `event`이지 `article`이 아니므로
> bootstrap 수집 경로는 여전히 두 회사 모두에 켜져 있다(정상).
>
> ## 같은 날 이어서 — 3년치 시계열 수동 백필과 그 과정에서 드러난 결함 2개
>
> 사용자 요청은 "다른 회사는 2023년 이후 연차보고서가 다 반영돼 있으니 Reshine 같은 회사도 3년치를
> 축적해 임베딩하고 싶다"였다. 비상장사는 정기보고서가 없어 `backfillCompanyEvents()`(웹 검색 1회)로
> 채우는 경로가 이미 있었고(`lib/curation.js`의 `pickDueWebBackfill`, `WEB_BACKFILL_SINCE="2023-01-01"`,
> 90일 주기), 그것을 수동으로 한 번 당겨 실행했다. 그 과정에서 결함 두 개를 찾아 고쳤다.
>
> | 커밋 | 내용 |
> |---|---|
> | `952c336` | 관리자 수동 `?backfill=`·`?digest=` 경로가 LLM 호출에 `timeoutMs`를 안 넘겨 기본값(웹 검색 35초)에 걸려 있었다. 유지 훅은 이미 60·85초로 고쳐져 있었는데 이 경로만 빠져 있었다. 함수 한도가 300초이므로 200초를 준다 |
> | `ac83ef3` | 웹 백필 결과의 한국어 강제. 프롬프트에 필드 이름을 짚어 다시 못박고, **서버가** `title_ko`·`fact_ko`에 한글이 없으면 그 건을 버린다(`dropped.notKorean`). `scripts/check-backfill-korean.mjs` 추가 |
>
> ### 진단 기록 (같은 실수를 반복하지 않기 위해)
>
> - **타임아웃**: 200초로 고친 뒤에도 실패해 "고쳤는데 왜 안 되나"로 보였다. `pipeline_log`의 실패 시각
>   (07:42:46 UTC)과 `vercel inspect`의 배포 생성 시각(07:41:49 + 빌드 17초)을 맞춰 보니 요청이
>   **정확히 35초 만에** 끊겼다. 200초가 적용됐다면 불가능한 시각이므로 그 요청은 별칭이 새 배포로
>   넘어가기 직전 옛 배포로 들어간 것이었다. 배포 별칭이 안정된 뒤 재시도하니 통과했다.
>   **교훈: 배포 직후 재시도는 배포 별칭이 실제로 새 배포를 가리키는지 확인하고 한다.**
> - **한국어**: 첫 Reshine 실행이 12건을 저장했는데 `title_ko`·`fact_ko`·`original_excerpt_ko`가 전부
>   중국어 원문이었다. 전체 문제인지 세어 보니 `event` 712건 중 중국어 제목은 그 12건뿐이었고
>   다른 `web_backfill` 49건은 정상이었다. 즉 상시 결함이 아니라 그 호출에서 모델이 목록 가운데
>   한 줄짜리 한국어 지시를 무시한 것이다. 프롬프트만 고치면 재발하므로 서버 가드를 같이 넣었다.
>
> ### 운영 DB에 직접 한 일
>
> - 중국어로 저장된 Reshine `event` 12건을 삭제했다(`knowledge_chunk` 12개 cascade, `event_fact` 0건).
>   지우기 전에 대상 12건과 파생 행 수를 SELECT로 확인했고, 그 12건이 DB 전체의 중국어 이벤트
>   전부와 일치함을 확인했다. 먼저 있던 한국어 2건(09-03 생성)은 청크까지 그대로 두었다.
> - 삭제 후 수정본 배포 상태에서 두 회사를 다시 실행했다. 결과: Reshine `returned=11 inserted=11`,
>   Kaijin `returned=12 inserted=12`, 양쪽 다 `dropped.notKorean=0`.
>
> ### 지금 상태 (2026-09-07 밤, 확인함)
>
> | 회사 | event | 한글 없는 행 | 기간 | 연도별(23/24/25/26) |
> |---|---|---|---|---|
> | Reshine | 13 | 0 | 2023-01-28 ~ 2026-07-22 | 2 / 4 / 2 / 5 |
> | Kaijin | 14 | 0 | 2023-01-01 ~ 2025-12-31 | 5 / 5 / 4 / 0 |
>
> 인수인계 B절이 "빠져 있다"고 지목한 Reshine 사실 세 가지가 모두 들어왔다 — 2026-06-29 IPO 접수
> (37.8억 위안), 2026-07-22 질의 단계 진입, 란저우 인산철리튬 10만 톤.
>
> **남은 문제 하나 (아직 안 고침)**: Kaijin은 `returned=12`로 `BACKFILL_MAX_EVENTS=12` 상한에 정확히
> 닿았고 2026년 건이 0이다. 상한이 실제로 구속력을 갖고 있으므로 2026년 소식이 잘렸을 가능성이 높다
> (Reshine은 11 < 12라 구속력이 없었다). 유지 훅은 연도별로 따로 호출(연당 10건)하므로 며칠 밤이면
> 자연히 채워진다. 급하면 이 수동 경로의 상한을 올리거나 연도별로 쪼개 병렬 호출하도록 바꾼다.
>
> ---
>
> **2026-09-07 최신 추가 사항 — Reshine 수집 공백을 다음 작업의 최우선으로 둔다.**
>
> 이 절은 아래의 예전 인수인계보다 최신이다. (구현 완료 상태는 위 갱신 참고.) 작업 트리는 깨끗하고,
> `main`에는 아래 두 커밋까지 푸시·Vercel Production 배포가 완료됐다.
>
> | 커밋 | 상태 | 내용 |
> |---|---|---|
> | `7e7156c` | 배포 완료 | 교차검증의 `corrected_pass`를 버리지 않고 보수적 수정본으로 저장 |
> | `b2104f0` | 배포 완료 | `occurred_at='2026-09'` 같은 부분 날짜를 `2026-09-01`로 정규화해 event 적재 실패 방지 |
>
> ## A. 방금 운영에서 검증한 것
>
> 1. 수동 수집·분석 1회를 실행했다. 이번 코호트의 결과는 본문대조 통과 4건,
>    `corrected_pass` 1건, 기각 1건이었다. `corrected_pass`가 실제로
>    `source_tier=openai_deepseek_corrected`로 저장된 것을 Supabase에서 확인했다.
> 2. 그 수정 통과 기사(샨샨 인조흑연 가격)는 event 저장 단계에서 모델이 `occurred_at='2026-09'`를
>    반환해 PostgreSQL date 오류가 났다. 기사 본문대조 결과 자체는 보존됐지만
>    `processing_status=processing_failed`가 남았다. `b2104f0`이 이후 실행을 고쳤다.
>    **이미 실패한 이 한 건은 pending이 아니므로 자동 재처리되지 않는다.** 후속 작업자는 배포 뒤
>    안전한 재처리 경로(기사 상태를 무작정 UPDATE하지 말 것)를 마련하거나 event를 검증해 보완해야 한다.
> 3. Youshan은 검증 기사 0→1건이 됐다. Hithium 4건, SVOLT 4건은 유지됐다.
>    Reshine과 Kaijin은 검증 기사가 아직 0건이다.
>
> ## B. Reshine 공백의 확인된 원인 (추측 아님)
>
> Reshine에 기사가 없는 것이 아니다. 외부 검색으로 아래의 최근·직접 기사를 확인했다.
>
> - 2026-06-29 창업판 IPO 접수, 37.8억 위안 조달 계획과 LFP 50만 톤 증설
> - 2026-07-22 IPO `已问询`(질의 단계) 전환
> - 난퉁 기지 삼원계 20.26만 톤, 란저우 LFP 10만 톤 생산능력 관련 보도
>
> 근거 URL(Claude Code에서도 브라우저로 열어 확인 가능):
>
> - https://www.stcn.com/ipo/detail/3777.html
> - https://news.smm.cn/live/detail/103986980
> - https://finance.sina.com.cn/roll/2026-07-02/doc-inifmfcu5895386.shtml
>
> 코드·운영 데이터로 확인한 원인은 세 가지다.
>
> 1. `lib/china-sources.js`의 `discoverWebSearchNews()`가 모든 회사에 **최근 3일**만 검색한다.
>    위 핵심 기사는 6~7월 것이므로 후보가 될 수 없다.
> 2. Reshine은 `listed: false`라 `cninfo` 수집기가 없다. 상장사 공시를 받는 우회 경로도 없다.
> 3. 별칭 매칭은 원인이 아니다. `金川瑞翔`, `甘肃金川瑞翔`, `瑞翔新材`, `湖南瑞翔`,
>    `南通瑞翔`, `Jinchuan Reshine`, `Reshine`가 이미 등록돼 있고, 발견된 후보는 연결될 수 있다.
>
> 추가로, Reshine은 OpenAI에서는 `reshine,youshan`, DeepSeek에서는
> `wanrun-new-energy,lopal,reshine` 묶음에 들어간다. 단독 검색이 아니므로 작은 비상장사가
> 그룹의 결과 상한에 밀릴 위험도 있다. DeepSeek은 그룹당 회사별 검색을 한 번만 하라는 프롬프트와
> 3개 기사 상한을 같이 받는다.
>
> ## C. 다음 구현 순서 (사용자가 “진행하자”라고 승인했고, 이번에는 중단 요청으로 실제 변경 전 멈춤)
>
> 목표는 Reshine·Kaijin처럼 **기사가 0건인 비상장 핵심사만** 처음 한 번 과거 기사를 확보하고,
> 평상시에는 지금의 최근 3일 수집 비용으로 돌아가게 하는 것이다.
>
> 1. `api/ingest-rss.js`에서 `article_company`를 읽어 bootstrap 후보
>    (`reshine`, `kaijin-new-energy`) 중 연결 기사가 0건인 ID만 계산한다. 읽기 전용 쿼리다.
>    raw 기사 1건만 생겨도 반복 과거 검색은 멈추도록 한다.
> 2. `lib/china-sources.js`의 `buildSearchGroups()` / `plannedSearchRequests()` /
>    `discoverWebSearchNews()`에 `bootstrapCompanyIds`를 전달한다. bootstrap 대상은 일반 묶음에서
>    빼고 **단독 검색**, 기간은 180일로 한다. 일반 회사는 현재의 3일·그룹 크기를 그대로 유지한다.
>    `api/news.js`의 공개 조회는 비용 폭증을 막기 위해 bootstrap을 켜지 않는다.
> 3. bootstrap 검색에서 나온 후보에는 `bootstrap: true`를 붙이고,
>    `api/ingest-rss.js`는 `source_tier=web_search_bootstrap_<provider>`로 저장한다.
>    `selectHeadlineTop10()`은 기존 최근 3일 Top 10과 별도로 bootstrap 기사 최대 1~2건을 골라
>    실제 본문대조까지 보내야 한다. 이 단계를 빼면 6~7월 기사는 DB에만 쌓이고 화면에는 여전히 없다.
> 4. `scripts/check-search-plan.mjs`에 다음 회귀 조건을 추가한다.
>    - bootstrap 회사가 provider별 단독 그룹이며 `windowDays=180`
>    - 일반 그룹에는 bootstrap ID가 중복되지 않음
>    - 기본 호출(bootstrap 없음)의 기존 그룹·예산은 유지
>    - `plannedSearchRequests(...bootstrapIds)`와 실제 그룹 수가 일치
> 5. `node --check api/ingest-rss.js`, `node --check lib/china-sources.js`,
>    `npm run check`, 모든 `scripts/check-*.mjs`, `git diff --check`를 돌린다.
> 6. `main` 푸시 후 Vercel Ready를 확인하고, **사용자가 직접 수집 버튼을 한 번 실행**하게 하거나
>    정상 크론을 기다린다. 실행 후 Supabase에서 Reshine의 article/article_company/event를 각각 확인한다.
>    특히 `web_search_bootstrap_*`가 저장만 되고 Top 10에서 누락되지 않았는지 확인한다.
>
> 범위를 넓혀 SZSE IPO 공식 문서 전용 수집기를 새로 만드는 것은 다음 단계다. 먼저 위 180일 단독
> 백필로 실제 기사 확보·본문대조가 되는지 검증한다. 새 API 파일을 만들기 전에는 CLAUDE.md의
> Vercel 함수 수 가드레일을 따른다.

# Claude → codex 인수인계

마지막 갱신: 2026-09-08 (커밋 `aad96ee`까지, Production 배포 확인)

## 2026-09-08 후속 검증 — 관리자 게이트와 크론 체인

### 관리자 입장 코드 게이트: 정상 (코드 변경 없음)

- 쿠키를 보내지 않은 `GET https://china-battery-lens.vercel.app/api/access`는 실제 Production에서
  **401 `access_required`**를 반환했다.
- 관리자 페이지가 게이트 없이 열린 기존 Chrome/in-app 탭은 이전에 발급된 `cbl_access` HttpOnly
  쿠키를 재사용한 상태였다. `document.cookie`가 비어 보이는 것은 HttpOnly 쿠키의 정상 동작이라
  쿠키 부재의 근거가 아니다.
- 따라서 `app/access-gate.js`의 GET 확인 → 폼 표시, `api/access.js`/`api/admin.js`의
  `isAccessAllowed`/`requireAccess` 경로는 Production에서 의도대로 동작한다.

### 크론 유지 훅: 실전 로그에서 체인 깊이 부족을 발견해 수정·배포

- 2026-09-07 23:19~23:29 KST 크론 로그는 collect → process 훅 1~6 → daily까지 수행했으나,
  이어진 curate는 `depth: 5`, `message: "chain depth cap"`으로 skipped였다. 즉 유지 훅은 실제로
  돌지 않았고, Reshine·Kaijin의 90일 웹 백필 순환도 이 실행으로는 검증되지 않았다.
- 원인: 본문 처리의 `MAX_PROCESS_HOPS=6`가 60~90초짜리 훅을 여러 내부 호출로 이어 Daily 직전에
  체인 깊이를 4까지 썼다. Daily가 curate를 넘길 때 Vercel이 금지하는 다섯 번째 내부 호출이 됐다.
- `aad96ee`는 야간 본문 처리 상한을 2회로 낮춰 collect → process → daily → curate가 깊이 3 안에서
  끝나게 하고, `scripts/check-chain-depth.mjs`에 이 불변조건을 추가했다. `npm run check`,
  `scripts/check-*.mjs` 20개, `git diff --check`가 통과했고, Vercel Production Ready와 별칭 연결을
  확인했다.
- **다음 확인**: 다음 23:00 KST 크론 뒤 `pipeline_log`에서 `curate`의 `skipped/depth cap`이 아닌
  실제 훅 기록이 남았는지, Reshine·Kaijin web 원장이 90일 재실행 대상에서 빠졌는지 확인한다.

이 문서는 **가장 최근 세션의 변경과 다음에 할 일**만 모은다. 이전 세션(509fb25까지)의 상세 구조 설명은
git 히스토리와 `docs/HANDOFF.md`에 남아 있다. 지침은 `CLAUDE.md` 하나이며 `AGENTS.md`는 그 포인터다.

## 0. 지금 상태 한 줄

이번 세션은 세 가지를 했다. **주제 1**은 이 파일 위쪽 "Codex → Claude Code" 절의 **Reshine 수집
공백**으로, 두 갈래로 메웠다 — (1) 뉴스 수집 자체를 365일 단독 검색으로 넓히는 **bootstrap 경로**
(배포됐지만 실전 미검증), (2) 3년치 시계열 `event`를 웹 백필로 즉시 채우는 **수동 실행**(완료,
Supabase에서 직접 확인함). **주제 2**는 사용자가 스크린샷을 보고 지적한 화면 다듬기 다수 —
기업 비교 카드(연도 그룹 대비·버튼 폭·색), 상단바(만든이 표시·disclaimer, 활성 탭 밑줄→파스텔
알약, 로고 단어별 색), 근거 검색 옵션 배치 — 로, 전부 코드는 작지만 배포·브라우저 확인까지 끝났다.
**주제 3**은 관리자 페이지(`/admin`) 입장 코드 게이트를 사용자가 요청해 코드를 확인한 것인데,
**결론까지 가지 못하고 멈췄다** — 5번 1항 참고. `main`은 `24e2d92`까지 푸시·Vercel Production 배포
완료. 운영 DB에는 이 세션에서 새 SQL을 적용하지 않았다(4번 참고).

## 1. 이 세션의 커밋 (오래된 순)

| 커밋 | 내용 |
|---|---|
| `1b1459b` | bootstrap 뉴스 수집: 검증 기사 0건 회사만 일반 3일 그룹에서 빼 회사당 단독 365일 검색 |
| `3eb40af` | 문서 갱신 |
| `952c336` | 관리자 수동 `?backfill=`/`?digest=` 경로가 LLM `timeoutMs`를 안 넘겨 기본값(35초)에 걸리던 버그 수정. 200초로 |
| `ac83ef3` | 웹 백필 결과 한국어 강제. 서버가 `title_ko`/`fact_ko`에 한글이 없으면 저장 전 버린다(`dropped.notKorean`) |
| `d4861b5` | 문서 갱신 |
| `8b00430` | 문서 갱신(이 절을 이번 세션 기준으로 재작성) |
| `7efa8a9` | 기업 시계열의 연도 대그룹(`.digest-year`)에 회색 밴드+왼쪽 굵은 선을 넣어 그 안의 보고서/월별 줄과 구분 |
| `d070fcf` | 비교 화면 "비교 리포트 생성" 버튼을 A·B 픽커 행과 같은 폭으로 늘림(`flex:1`), 처음엔 진한 파란 채움으로 |
| `adde7ce` | 위 버튼 색을 진한 파랑 → 파스텔(연한 하늘 배경 + 파란 글자, 기존 태그 톤과 통일)로 톤다운. 사용자가 배포 후 "색이 너무 진하다"고 되돌려 달라 함 |
| `a49c7de` | 문서 갱신 |
| `16f2b19` | 상단바 "데이터 기준" 라벨 아래에 "만든이 장동일 · 정보 제공용이며 투자 판단의 근거로 사용할 수 없습니다" 한 줄 추가. `app.js`/`admin.js`가 그 영역 전체를 `textContent`로 덮어쓰고 있어 동적 텍스트를 안쪽 `#as-of-text`/`#admin-asof` span으로 분리 |
| `0dfbf14` | "수집된 근거에 물어보기" 옵션 두 개가 `.ask-head`의 `justify-content:space-between`(자식 3개 기준) 때문에 화면 양끝까지 흩어져 있던 것을 제목 옆으로 붙임 |
| `adb30be` | 상단 탭 활성 표시를 밑줄 → 파스텔 알약(배경)으로 교체. `.topbar nav`에 `align-items:center`를 줘 링크가 topbar 전체 높이로 늘어나 배경이 기둥처럼 보이는 것을 막음 |
| `7aaae1f` | 로고 "China Battery Lens"를 Arial로, 단어별로 다른 색(초안: 시장·기술·양호 축 색) |
| `24e2d92` | 위 로고 색을 사용자가 지정한 빨강(China)·초록(Battery)·파랑(Lens)으로 다시 바꿈(`--alert`/`--good`/`--blue`) |

**커밋 없이 대화 중 실행한 것** (재현 가능, 코드 변경 아님):
- Reshine `event` 중 중국어로 저장된 12건을 SELECT로 확인 후 DELETE(`knowledge_chunk` cascade 12건,
  `event_fact` 0건). 대상 12건이 DB 전체의 중국어 이벤트 전부와 일치함을 먼저 확인했다.
- `952c336`+`ac83ef3` 배포 뒤 `POST /api/ingest-rss?backfill=reshine&since=2023-01-01`,
  `?backfill=kaijin-new-energy&since=2023-01-01` 재실행(관리자 로그인 브라우저에서 GET으로 실행 가능).
- Kaijin은 `since=2023-01-01` 호출이 `BACKFILL_MAX_EVENTS=12` 상한에 정확히 닿아 2026년 몫이 0건이라,
  `?backfill=kaijin-new-energy&since=2026-01-01`을 한 번 더 실행해 2026년 6건을 추가로 채웠다.

## 2. 구조적으로 바뀐 것

### 2.1 뉴스 수집 bootstrap — 배포됐지만 실전 미검증

목표: Reshine·Kaijin처럼 **검증 기사가 0건인 비상장 핵심사**만 뉴스 수집 자체를 365일까지 넓혀 처음
한 번 과거 기사를 찾고, 연결되는 순간 평소의 3일 수집으로 자동 복귀시킨다.

- `api/ingest-rss.js`의 `bootstrapCompanyIds()`가 매 수집 실행마다 `article_company` 연결 0건인
  후보(`reshine`, `kaijin-new-energy`)만 읽기 전용으로 계산한다. 기사 1건만 연결돼도 다음 실행부터 빠진다.
- `lib/china-sources.js`의 `buildSearchGroups(provider, pilot, bootstrapCompanyIds)`가 bootstrap 대상을
  일반 셀/양극재/음극재 그룹에서 빼고 회사당 **단독 그룹**(`windowDays: 365`)으로 낸다. 일반 회사의
  3일 창·그룹 크기는 그대로다. 파일럿(3사 검증)·`api/news.js`(공개 조회)는 bootstrap을 켜지 않는다.
- bootstrap 후보는 `source_tier=web_search_bootstrap_<provider>`로 저장되고,
  `selectHeadlineTop10()`이 이 태그가 붙은 기사를 3일 창과 별도로 최대 2건 뽑아 본문대조까지 보낸다
  (news/bootstrap 중복은 article id로 dedupe).
- 검사: `scripts/check-search-plan.mjs`에 4개 회귀(단독 그룹·365일 창·일반 그룹 미중복·기본 호출 불변).

**미검증 이유**: 이 경로는 "기사"를 찾아 파이프라인 전체(본문대조까지)를 태우는 것이라 야간 크론이
한 번 돌아야 결과를 볼 수 있다. 이번 세션에서는 대신 아래 2.2의 "이벤트 직접 백필"로 3년치를
당장 채웠으므로, bootstrap이 실제로 기사를 찾아오는지는 09-07 23:00 KST 크론 이후 확인해야 한다.
`pipeline_log`의 `collect` 단계에서 `bootstrap_ids`를, `process` 단계에서 `web_search_bootstrap_*`
기사가 Top 10에 실제로 들어갔는지 본다.

### 2.2 수동 백필 timeout 버그 — 유지 훅엔 있던 수정이 관리자 경로엔 없었다

`lib/curation.js`의 야간 유지 훅은 이미 `WEB_LLM_TIMEOUT_MS`(60초)·`REPORT_LLM_TIMEOUT_MS`(85초)를
`backfillCompanyEvents`/`digestReport`에 넘긴다. 그런데 관리자가 직접 치는 `?backfill=`/`?digest=`
경로(`api/ingest-rss.js`의 `runBackfill`)는 `timeoutMs`를 아예 넘기지 않아 LLM 제공자 기본값
(웹 검색 35초)에 걸려 있었다. Reshine 수동 백필이 이걸로 두 번 실패했다. `MANUAL_LLM_TIMEOUT_MS=200000`을
새로 두고 두 호출 모두에 넘긴다(함수 한도 300초 안).

**진단 메모**: 200초로 고친 첫 재시도도 실패했는데, `pipeline_log` 실패 시각과 `vercel inspect`의
새 배포 생성 시각을 맞춰 보니 요청이 **정확히 35초 만에** 끊겼다 — 배포 별칭이 새 배포로 넘어가기
직전 옛 배포(고치기 전 코드)로 들어간 것이었다. 배포 후 재시도는 별칭이 실제로 새 배포를 가리키는지
(`npx vercel inspect <alias>`) 먼저 확인하고 한다.

### 2.3 웹 백필 결과의 한국어 강제 — 프롬프트만으로는 안 지켜졌다

Reshine 첫 실행(12건)이 `title_ko`·`fact_ko`·`original_excerpt_ko`를 전부 중국어 원문 그대로 돌려줬다.
`event` 712건 전체를 세어 보니 중국어 제목은 그 12건뿐이고 기존 `web_backfill` 49건은 정상이었다 —
상시 결함이 아니라 그 호출에서 모델이 목록 가운데 한 줄짜리 한국어 지시를 무시한 것이다. 프롬프트만
고치면 재발할 수 있어 두 가지를 같이 했다.

- `lib/event-backfill.js`의 `INSTRUCTIONS`에 필드 이름(`title_ko`·`fact_ko`·`original_excerpt_ko`)을
  짚어 "중국어·영어 원문을 그대로 옮기면 그 건은 버려진다"고 재차 못박았다.
- **서버가** `hasKorean()`으로 `title_ko`/`fact_ko`에 한글이 한 글자도 없으면 저장 전에 버린다
  (`dropped.notKorean`). `original_excerpt`(원문 발췌)는 검사하지 않는다 — 중국어가 정상이다.
- 검사: `scripts/check-backfill-korean.mjs` 신규.

### 2.4 화면 UI 다듬기 — 사용자 스크린샷·구두 요청 기반 (배포·확인 완료)

`app/styles.css`(+ `app/index.html`, `app/admin.html`, `app/app.js`)만 건드린 순수 프런트엔드 변경
7건. `app/*.css`는 회귀 스크립트 대상이 아니라서 매번
`preview_start`(launch.json의 `ledger-preview`, 저장소 루트를 정적 서빙)로 임시 미리보기 HTML을
`app/` 밑에 만들어 브라우저로 렌더링을 직접 확인한 뒤 지우고 커밋했다. 실제 앱은 `/api/*`가 있어야
데이터가 뜨므로, 정적 서버로는 마크업만 그대로 복제한 스니펫을 봐야 한다.

- **연도 그룹 대비** (`.digest-year`): 기업 시계열 화면에서 "2026년" 같은 연도 대그룹과 그 안의
  "2026년 상반기"/"2026-05" 같은 보고서·월별 줄이 둘 다 흰 배경이라 구분이 안 갔다. 연도 summary에
  `background:var(--band)`(연한 회색)와 `border-left:3px solid var(--ink)`를 줘 바깥쪽 그룹임을
  분명히 했다.
- **비교 버튼 폭**: 기업 비교 화면에서 A/B 픽커 카드는 화면 폭을 꽉 채우는데 그 아래 "비교 리포트
  생성" 버튼은 내용 크기만큼만 좁게 떠 있었다. `.compare-actions-row #compare-report{flex:1 1 240px}`로
  같은 행의 "보조 데이터 포함" 체크박스는 그대로 두고 버튼만 남은 폭을 채우게 했다.
- **비교 버튼 색**: 폭을 늘리면서 처음엔 `background:var(--blue)`(진한 파랑)+흰 글자로 존재감을 줬는데,
  배포 후 사용자가 "너무 진하다"고 해 `background:var(--pale)`(연한 하늘)+`color:var(--blue)`로
  톤다운했다. 이 저장소가 이미 쓰는 pastel 태그(`sector-tag`, `summary-cat`)와 같은 톤이다.
- **만든이 표시·disclaimer**: 상단바 "데이터 기준 ..." 라벨 아래에 "만든이 장동일 · 정보 제공용이며
  투자 판단의 근거로 사용할 수 없습니다" 한 줄을 추가했다. `app.js`의 `updateAsOf()`와 `admin.js`가
  그 영역 전체를 `textContent`로 갈아치우고 있어서, 그대로 뒀으면 데이터 새로고침마다 이 문구가
  사라졌을 것이다 — 동적 텍스트만 안쪽 `#as-of-text`(index)/`#admin-asof`(admin) span으로 분리하고
  disclaimer는 그 형제 span(`.site-credit`)에 고정했다.
- **근거 검색 옵션 배치**: "수집된 근거에 물어보기" 아래 체크박스 두 개가 `.ask-head`의
  `justify-content:space-between`(자식이 제목 블록 포함 3개라 균등 분산됨) 때문에 화면 양끝까지
  흩어져 있었다. `space-between`을 빼 제목 옆에 붙게 했다.
- **상단 탭 활성 표시**: 밑줄(`border-bottom`) → 파스텔 알약(배경)으로 바꿨다. `.nav-link`가
  `.topbar nav`(`display:flex`)의 기본 `align-items:stretch`로 topbar 전체 높이(76px)까지 늘어나 있어,
  그 상태로 배경만 넣으면 알약이 아니라 세로로 긴 기둥이 된다 — `.topbar nav{align-items:center}`를
  같이 줘 링크가 텍스트 크기만큼만 차지하게 만든 다음에 배경·둥근 모서리를 입혔다.
- **로고 색**: "China Battery Lens"를 Arial로, 단어별로 다른 색으로 나눴다. 처음엔 임의로 시장·기술·
  양호 축 색(파랑·황토·초록)을 썼는데, 사용자가 곧바로 빨강(China)·초록(Battery)·파랑(Lens)을
  지정해 그 값으로 다시 바꿨다(`--alert`/`--good`/`--blue` 재사용). **최종 값은 사용자가 명시한
  이 색이다** — 임의로 다른 배색으로 되돌리지 않는다.

주의: `app/styles.css`에는 `:root` 토큰 정의가 **두 벌**이다(파일 앞쪽 기본 팔레트, 39번째 줄 즈음
"IEA 스타일 디자인 레이어" 주석 아래 두 번째 `:root`). 두 번째가 나중에 로드돼 실제로 이긴다 —
`--navy`가 `#10365f`가 아니라 `#000000`, `--blue`가 `#1674c5`가 아니라 `#0044FF`... 처럼 값이 다르니,
색을 확인·수정할 때는 반드시 파일 뒤쪽(두 번째 `:root`와 그 아래 오버라이드)까지 보고 실제 적용 값을
확인한다. 이번 세션에서도 처음엔 앞쪽 블록만 보고 색을 골랐다가 실제 렌더링에서 다르게 나와 다시 봤다.

### 2.5 관리자 페이지 입장 코드 게이트 — 조사만 하고 결론 못 냄 (다음 세션이 마무리)

사용자가 "관리자페이지 접근시 입장코드 입력하도록 변경"을 요청했다. 코드를 읽어 보면 **이미 구현돼
있다**: `app/admin.html`의 `#access-gate` 폼(`app/access-gate.js`가 `/api/access` GET으로 세션 쿠키
확인 → 없으면 폼 표시 → POST로 `accessKey` 검증 → `issueAccessCookie`)과 `api/admin.js`의
`requireAccess(request, response)`가 이미 붙어 있고, `app/index.html`도 동일한 게이트를 공유한다
(`APP_ACCESS_KEY` 하나로 메인 사이트·관리자 모두 보호). `vercel.json`의 `/admin → app/admin.html`
리라이트도 정상이다.

그런데 이 세션의 Browser pane으로 쿠키 없이(라고 생각하고) `https://china-battery-lens.vercel.app/admin`을
열었더니 **게이트 없이 곧바로 데이터가 떴다**(수집 기사 703건 등). `document.cookie`로는 아무것도
안 보였지만(그 쿠키는 `HttpOnly`라 JS로는 원래도 안 보인다), 네트워크 탭에서 `/api/access`가 200을
반환했다 — 즉 **이 브라우저 프로필에 예전 세션에서 발급된 유효한 `cbl_access` 쿠키가 남아 있었을
가능성이 크다**(HttpOnly라 지워지지 않는 한 재사용된다). 여기서 확인을 마치지 못하고 사용자가 다른
요청으로 대화를 돌렸다.

**다음 세션이 마무리할 것**: 쿠키를 완전히 비운 상태(시크릿 창, 또는 이 Browser pane이면 새 탭 그룹을
만들거나 쿠키를 지운 뒤)에서 `/admin`에 접속해 실제로 게이트가 뜨는지 확인한다.
- 게이트가 뜨면: 기존 구현이 이미 정상 동작하는 것이므로 **코드 변경 없이 "이미 돼 있다"고 사용자에게
  확인만 시켜 주면 된다.**
- 게이트가 안 뜨면(정말 버그): `lib/access.js`의 `isAccessAllowed()`(APP_ACCESS_KEY 존재 여부·서명
  비교)부터 의심하고, Vercel Production에 `APP_ACCESS_KEY`가 실제로 설정돼 있는지
  (`npx vercel env ls` — 값 자체는 Sensitive라 못 보지만 존재 여부는 보인다) 확인한다.

## 3. 운영 DB에 직접 한 일

- Reshine `event` 12건(중국어로 저장된 것 전부) 삭제. 지우기 전 대상 12건 = DB 전체 중국어 이벤트
  전부(다른 회사 영향 없음)임을 SELECT로 확인했고, 파생 `knowledge_chunk` 12개는 `on delete cascade`로
  같이 지워졌다(`event_fact` 0건이라 해당 없음). 먼저 있던 한국어 2건(09-03 생성)은 그대로 두었다.
- 삭제 후 수정본 배포 상태에서 Reshine·Kaijin을 다시 실행해 한국어로 채웠다(6번 "지금 수치" 참고).
- **이전 세션(2.5절 언급) 이후로 이번 세션에서 새로 건드린 운영 DB 변경은 위가 전부다.** Farasis 보증
  표 금액 수정 등 그 이전 세션의 DB 작업은 이미 적용된 채로 유지되고 있다(재확인만 함, 재작업 없음).

## 4. Supabase SQL 적용 상태 — 변화 없음

이번 세션에서 새 SQL을 추가하지 않았다. 이전 세션까지의 적용 상태(`report-renewal.sql`,
`report-synthesis.sql`, `company-entity.sql`, `report-visual-quality.sql` 전부 적용됨)는 그대로 유효하다.

## 5. 다음에 할 일 (우선순위 순)

1. **[사용자 요청, 조사만 함] 관리자 페이지 입장 코드 게이트를 쿠키 없는 상태에서 검증.** 2.5절 참고.
   구현은 이미 있어 보이지만 이 세션에서 결론을 내지 못했다 — 다음 세션의 첫 번째 일로 처리한다.
2. **[미검증] bootstrap 뉴스 수집이 실제로 기사를 찾아오는지 확인.** 09-07 23:00 KST 크론(또는 수동
   수집 실행) 이후 `pipeline_log`에서 `collect` 단계의 `bootstrap_ids`, `process` 단계에서
   `source_tier=web_search_bootstrap_*` 기사가 Top 10에 실제로 들어갔는지 본다. 이번 세션에서 채운
   3년치 `event`와는 별개 경로라 서로 방해하지 않지만, 이 확인 없이는 bootstrap이 실전에서 동작하는지
   모른다.
3. **Reshine·Kaijin이 유지 훅(`pickDueWebBackfill`, 90일 리프레시)의 정상 순환에 들어갔는지 확인.**
   이번 세션에서 채운 3년치는 수동 실행 결과라 `report_digest` 원장(`kind='web'`)에 기록이 남았는지
   (남아야 유지 훅이 90일 안에 또 검색해 중복 API 비용을 쓰지 않는다) 확인이 필요하다.
4. (이전 세션 미결, 유효함) **표 오독 잔여 문제.** 여러 줄로 감싼 셀이 y좌표 묶기에 흩어지는 것(R&D 표,
   헤더 행). 지금은 그런 표를 문장으로 펴지 않고 파이프 그대로 두어 피해를 막고만 있다. 제대로
   고치려면 열 x좌표 군집화로 표를 복원해야 한다.
5. (이전 세션 미결, 유효함) **사업 관계망 화면.** 설계 합의는 `docs/HANDOFF.md` "2026-09-08 방향" 절에
   있다. 재료가 아직 얇다.
6. (이전 세션 미결, 유효함) **공시 원문 임베딩(`report_chunk`)이 0건.** `REPORT_TEXT_ONLY_EMBEDDING=1`을
   켜야 도는데, 표 후처리가 좋아졌으니 켤지 다시 판단한다.
7. (이전 세션 미결) 약관 기반 매체 허용 목록(미착수), 벡터 검증 2단계
   (`docs/VECTOR-VERIFICATION-PLAN.md` 3절).
8. **[낮음] UI 다듬기 7건은 전부 배포됐고 로컬 스니펫 미리보기로 확인했다.** 그중 비교 버튼의
   폭 변경만 사용자가 실제 배포 화면에서 직접 봤고(색은 두 번 조정 요청받아 최종 파스텔로 확정),
   나머지(연도 그룹 대비·만든이 표시·근거 검색 옵션 배치·탭 알약·로고 색)는 사용자가 실제 배포에서
   본 적은 없다 — 다음에 화면을 열 때 깨진 곳이 없는지만 눈으로 한 번 확인하면 된다.

## 6. 지금 수치 (2026-09-07 밤, 확인함)

| 회사 | event | 한글 없는 행 | 기간 |
|---|---|---|---|
| Reshine | 13 | 0 | 2023-01-28 ~ 2026-07-22 |
| Kaijin | 20 | 0 | 2023-01-01 ~ 2026-05-29 |

인수인계 위쪽 B절이 "빠져 있다"고 지목한 Reshine 사실 세 가지가 모두 들어왔다 — 2026-06-29 IPO 접수
(37.8억 위안), 2026-07-22 질의 단계 진입, 란저우 인산철리튬 10만 톤. Kaijin도 CATL 핵심 공급사,
구톈 20만 톤 프로젝트, 2025년 말 생산능력 59만 톤 등이 들어왔다.

이전 세션 수치(전사 `event` 694건 등)는 이 두 회사분(합계 33건 순증)이 반영되지 않은 값이니, 전사
수치가 필요하면 다시 센다.

## 7. 검증 명령

```bash
npm run check
for f in scripts/check-*.mjs; do node $f; done
git diff --check
```

회귀 스크립트가 **20개**로 늘었다(`check-backfill-korean.mjs` 신규). 모두 네트워크 없이 돈다.
`node --check`는 구문만 보므로 `npm run check`(api 모듈 실제 import)를 함께 돌린다.

## 8. 주의 — 이번 세션에서 배운 것

- **배포 직후 재시도는 배포 별칭이 실제로 새 배포를 가리키는지 먼저 확인한다.** 200초 timeout 수정을
  배포한 직후 재시도가 여전히 35초 만에 실패해 "고쳤는데 왜 안 되나"로 보였다. `pipeline_log` 실패
  시각과 `vercel inspect <alias>`의 배포 생성 시각을 맞춰 보니 요청이 별칭 전환 직전 옛 배포로 들어간
  것이었다. `npx vercel inspect china-battery-lens.vercel.app`으로 현재 별칭이 가리키는 배포와 생성
  시각을 먼저 보고 재시도한다.
- **프롬프트의 한국어 지시는 한 번만 적으면 묻힌다.** 웹 백필 프롬프트에 "출처에 명시된 사실만
  한국어로 쓴다"가 이미 있었는데도 모델이 12건 전부 중국어로 냈다. 목록 가운데 한 줄이 아니라 필드
  이름을 짚어 다시 못박고, **서버가 결과를 검사해 강제하는 장치를 항상 같이 넣는다** — 이 저장소가
  근거 등급(`timeline_eligibility`)을 서버가 정하는 것과 같은 원칙이다.
- **Vercel Sensitive 환경변수는 `vercel env pull`로 실제 값을 받을 수 없다.** `CRON_SECRET`·
  `APP_ACCESS_KEY`가 대시보드에서 Sensitive로 표시돼 있어 CLI가 `[SENSITIVE]` placeholder만 준다.
  프로덕션 인증이 필요한 일회성 작업은 관리자 로그인 브라우저에서 URL을 직접 열게 하는 것이 유일한
  경로다(이 프로젝트의 `?backfill=`처럼 GET으로도 동작하는 엔드포인트는 주소창에 붙여넣기만 하면 된다).
- **`app/styles.css`의 `:root` 토큰은 두 벌이고 뒤엣것이 이긴다** (2.4절 참고). 색을 바꾸기 전에
  파일 뒤쪽 "IEA 스타일 디자인 레이어" 블록의 실제 값을 먼저 확인한다. 앞쪽 블록만 보고 고치면
  의도한 색과 다르게 렌더링된다.
- **CSS만 바꾼 화면 작업은 회귀 스크립트가 안 잡는다.** `scripts/check-*.mjs`는 `lib/`·`api/`
  로직만 본다. UI 변경은 `preview_start`(`ledger-preview`)로 `app/` 밑에 임시 HTML을 만들어 마크업을
  복제해 브라우저로 직접 렌더링을 보고, 커밋 전에 그 임시 파일을 지운다 — 실제 앱은 `/api/*` 없이는
  데이터가 안 뜨므로 화면 전체가 아니라 건드린 컴포넌트만 스니펫으로 확인하면 된다.

(이전 세션이 남긴 "제약의 존재와 구속력을 구분하라" 같은 진단 규칙은 `CLAUDE.md`에 있으므로 여기
반복하지 않는다.)
