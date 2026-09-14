import assert from "node:assert/strict";

// 하이브리드 검색(의미 + 단어) 회귀 검사. 네트워크는 전부 가짜로 물린다. API 과금이 없다.
//
// 지키려는 성질은 세 가지다.
//   1. 하이브리드는 후보를 늘린다. 두 검색기의 합집합이지 교집합이 아니다.
//   2. 양쪽에 다 걸린 청크는 점수를 두 번 받아 위로 올라간다.
//   3. 단어 검색 색인이 없어도 질의응답이 죽지 않는다(의미 검색만으로 물러난다).

process.env.OPENAI_API_KEY = "test-key";
process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_test";

const { buildLexicalQuery, demotePeriodMismatches, demoteUnrelatedCompanies, expandDomainQuestion, fuseByRrf, questionCompanyTerms, questionCompanyGroups, questionValueChainGroups, questionPeriods, sanitizeRewrittenQueries, searchKnowledge } = await import("../lib/knowledge-search.js");

// --- 1) 질의 조립 -----------------------------------------------------------

const codeQuery = buildLexicalQuery("SW-2413 관련 공시를 알려줘");
// 하이픈이 든 코드는 쪼개지 않고 구문으로 넘긴다. 'SW'와 '2413'으로 갈리면
// 이 검색을 붙이는 이유(임베딩이 놓치는 정확한 토큰 잡기)가 사라진다.
assert.ok(codeQuery.includes('"SW-2413"'), `코드 토큰은 따옴표 구문으로 남아야 한다: ${codeQuery}`);
assert.ok(!/\bSW\b(?!-)/.test(codeQuery.replace(/"SW-2413"/g, "")), "코드를 조각으로 쪼개면 안 된다");
assert.ok(!codeQuery.includes("관련"), "뜻을 싣지 않는 말은 후보에서 뺀다");
assert.ok(!codeQuery.includes("알려줘"), "질문 상투어는 후보에서 뺀다");

const particleQuery = buildLexicalQuery("삼원계의 출하량은 얼마인가");
// 조사를 뗀 형태와 원형을 함께 넣는다. 잘못 뗀 변형은 노이즈일 뿐 원형 매치를 없애지 못한다.
assert.ok(particleQuery.includes("삼원계 "), `조사를 뗀 형태가 있어야 한다: ${particleQuery}`);
assert.ok(particleQuery.includes("삼원계의"), "원형도 남겨야 한다");
assert.ok(particleQuery.includes("출하량"), "조사 '은'을 뗀 형태가 있어야 한다");
assert.ok(particleQuery.includes(" OR "), "여러 후보는 OR로 잇는다");

// PGroonga 질의 연산자가 사용자 입력을 타고 들어오면 안 된다.
const injected = buildLexicalQuery('양극재 OR ((( ~*: \\ "쿼트"');
assert.ok(!/[()~:\\]/.test(injected), `질의 연산자 문자가 새어 나가면 안 된다: ${injected}`);

// 뽑을 것이 없으면 빈 문자열. 호출자는 이때 단어 검색을 건너뛴다.
assert.equal(buildLexicalQuery("무엇"), "", "불용어만 남으면 질의를 만들지 않는다");
assert.equal(buildLexicalQuery(""), "", "빈 질문이면 질의를 만들지 않는다");

const sodiumQuery = expandDomainQuestion("소금 배터리 양산 회사는?");
for (const term of ["소금", "소듐", "나트륨", "sodium-ion", "钠电", "钠离子"]) {
  assert.ok(sodiumQuery.includes(term), `소금 배터리 질문에 ${term} 동의어가 포함돼야 한다`);
}
assert.equal(expandDomainQuestion("업황 흐름"), "업황 흐름", "사전에 없는 질문은 바꾸지 않는다");

// 답변 부족 시 LLM이 만든 검색어는 공백·중복·길이·개수 상한을 코드에서도 다시 제한한다.
assert.deepEqual(sanitizeRewrittenQueries("BYD 매출", [" BYD 2023년 매출 ", "BYD 2023년  매출", "BYD 매출", "", "x", "BYD 2024년 매출", "BYD 2025년 매출", "BYD 2026년 매출"]),
  ["BYD 2023년 매출", "BYD 2024년 매출", "BYD 2025년 매출"]);
assert.deepEqual(sanitizeRewrittenQueries("BYD 2023년 이후 매출", ["BYD 2023 매출", "BTR 2024 매출", "CALB 2025 매출"]),
  ["BYD 2023 매출"], "재작성 모델이 원 질문에 없던 회사를 추가하면 코드가 버려야 한다");

// --- 1.5) 회사를 짚은 질문은 그 회사 표기를 단어 검색의 필수 조건으로 건다 ------------
//
// 2026-09-09 RAG 평가 기준선: 못 씀 25건 중 12건이 "다른 회사"였다. 낱말을 전부 OR로 이으면
// 회사 별칭까지 OR에 섞여 전 산업에서 아무거나 올라온다. 실측(운영 DB)에서 완룬·파라시스 질문은
// 상위 10건에 회사가 6곳씩 섞여 있었는데, 필수 조건을 걸면 정답 회사 한 곳만 남았다.

// 한국어로 회사를 불러도 잡혀야 한다. 추적 32개사 중 16개사는 name_ko가 영문이라
// search_aliases(lib/china-sources.js)가 없으면 회사가 아예 인식되지 않는다.
for (const [question, expected] of [["파라시스 2026년 상반기 신규 고객", "孚能科技"], ["완룬신에너지 나트륨이온 정극재", "万润新能"]]) {
  const terms = questionCompanyTerms(question);
  assert.ok(terms.includes(expected), `${question} → 회사 표기(${expected})를 잡아야 한다: ${terms.join(",")}`);
}
// 회사를 짚지 않은 질문은 예전 그대로 둔다. 이 유형은 기준선에서 정밀도 1.00이었다.
assert.deepEqual(questionCompanyTerms("전고체 배터리 양산 시점"), [], "회사가 없으면 필수 조건도 없다");
assert.equal(buildLexicalQuery("전고체 배터리 양산 시점", { requiredTerms: [] }),
  buildLexicalQuery("전고체 배터리 양산 시점"), "필수 조건이 없으면 질의가 예전과 같아야 한다");

// 밸류체인 라벨이 회사 범위를 뜻할 때는 type_tags 집합을 하나의 필수 OR 그룹으로
// 만든다. 주제어로만 쓰인 '양극재 증설'은 회사 필터를 만들지 않는다.
const cellGroups = questionValueChainGroups("셀사의 LFP 생산 캐파");
assert.equal(cellGroups.length, 1, "셀사 질문은 셀 회사 집합 하나를 필수 그룹으로 만든다");
assert.ok(cellGroups[0].includes("CATL") && cellGroups[0].includes("BYD"), "셀 그룹에 대표 셀사 별칭이 포함돼야 한다");
const cellQuery = buildLexicalQuery("셀사의 LFP 생산 캐파", { requiredGroups: cellGroups });
assert.equal((cellQuery.match(/\+\(/g) || []).length, 1, "셀사 회사 집합은 필수 그룹 하나여야 한다");
assert.equal(questionValueChainGroups("양극재 증설").length, 0, "주제어만 있는 양극재 질문은 회사 필터를 만들지 않는다");
assert.equal(questionValueChainGroups("양극재 회사의 LFP 캐파").length, 1, "양극재 회사 표현은 소재사 집합을 필수 그룹으로 만든다");
assert.equal(questionValueChainGroups("음극재 업체 생산능력").length, 1, "음극재 업체 표현은 소재사 집합을 필수 그룹으로 만든다");

const scoped = buildLexicalQuery(expandDomainQuestion("파라시스 2026년 상반기 신규 고객"),
  { requiredTerms: questionCompanyTerms("파라시스 2026년 상반기 신규 고객") });
assert.match(scoped, /^\+\([^)]+\) \(/, `필수 그룹이 앞에 오고 선택 그룹이 뒤따라야 한다: ${scoped}`);
// 선택 그룹에도 회사 표기가 남아야 한다. PGroonga는 공백을 AND로 읽으므로, 선택 그룹에서 회사
// 표기를 빼면 주제어가 사실상 필수가 되어 회사만 언급한 청크가 전부 탈락한다.
const optionalPart = scoped.slice(scoped.indexOf(") (") + 3);
assert.ok(optionalPart.includes("파라시스"), `선택 그룹에 회사 표기가 남아야 한다: ${optionalPart}`);

// 공백·하이픈·전각 괄호가 든 표기는 구절로 감싼다. 안 그러면 New·Energy가 따로 떨어져
// 아무 회사나 필수 조건을 통과한다.
const phrased = buildLexicalQuery("매출", { requiredTerms: ["Wanrun New Energy", "万润新能", "鲁北万润智慧能源科技（山东）有限公司"] });
assert.ok(phrased.includes('"Wanrun New Energy"'), `여러 낱말 표기는 구절이어야 한다: ${phrased}`);
assert.ok(phrased.includes('"鲁北万润智慧能源科技（山东）有限公司"'), "괄호가 든 표기도 구절로 감싼다");
assert.ok(phrased.includes("OR 万润新能"), "한자만 있는 표기는 그대로 둔다");

// 필수 조건도 사용자 입력을 타고 연산자가 들어오면 안 된다.
const injectedRequired = buildLexicalQuery("매출", { requiredTerms: ['A" OR B) (', "정상표기"] });
assert.equal((injectedRequired.match(/\(/g) || []).length, 2, `괄호는 필수·선택 그룹 두 개뿐이어야 한다: ${injectedRequired}`);

// --- 1.6) 융합 뒤 후처리: 질문이 짚은 회사 이야기가 아닌 근거를 뒤로 민다 ------------------
//
// 회사 조건은 단어 검색에만 걸 수 있고 의미 검색은 회사를 자주 틀린다(기준선: 의미 검색만 건진
// 못 씀 5건 중 4건이 다른 회사). 그래서 두 검색기를 합친 뒤 한 번 더 본다.
const farasisTerms = questionCompanyTerms("파라시스 2026년 상반기 신규 고객");
const demoted = demoteUnrelatedCompanies([
  { id: "byd", company_id: "byd", content_ko: "비야디 블레이드 배터리 증설" },
  { id: "f", company_id: "farasis", content_ko: "Farasis Energy 상반기 고객 확보" },
  { id: "supplier", company_id: "reshine", content_ko: "孚能科技에 양극재 공급 계약" },
  { id: "shanshan", company_id: "shanshan", content_ko: "샨샨 음극재 출하" },
], farasisTerms).map((row) => row.id);
assert.deepEqual(demoted, ["f", "supplier", "byd", "shanshan"], `회사 언급 근거가 앞, 나머지는 뒤: ${demoted}`);
// 지우지 않는다. 회사 이름이 본문에 없어도 맞는 근거일 수 있어 상한을 못 채우면 따라 들어온다.
assert.equal(demoted.length, 4, "후처리는 순서만 바꾸고 버리지 않는다");
// 공급사 기사는 상대 회사(reshine)로 귀속돼 있어도 본문에 회사 이름이 있으면 통과한다.
// company_id로 걸렀다면 이 근거가 뒤로 밀렸을 것이다 — "CATL에 납품하는 업체" 류 질문이 죽는다.
assert.equal(demoted[1], "supplier", "메타데이터가 아니라 본문 표기로 판단해야 한다");
// 회사를 짚지 않은 질문은 손대지 않는다(기준선에서 이 유형은 1.00이었다).
const untouched = [{ id: "x", company_id: "byd", content_ko: "전고체" }, { id: "y", company_id: "calb", content_ko: "양산" }];
assert.deepEqual(demoteUnrelatedCompanies(untouched, []), untouched, "회사 조건이 없으면 순서를 바꾸지 않는다");

// --- 1.63) 명시 기간과 맞는 근거를 앞에 둔다 ---------------------------------
//
// 일반 검색은 DB에서 기간 필터를 걸 수 없다. [시점]이 질문의 기간과 맞는 청크를 우선하되,
// 날짜가 없는 기존 기사와 보고서 공시일이 이듬해인 연간 데이터는 성급히 버리지 않는다.
assert.deepEqual(questionPeriods("파라시스 2026년 상반기 신규 고객"), ["2026H1"]);
const periodOrdered = demotePeriodMismatches([
  { id: "wrong", content_ko: "[시점] 2025년\n[사실] 이전 해 고객" },
  { id: "unknown", content_ko: "[사실] 시점 미기재 기사", published_at: null },
  { id: "right", content_ko: "[시점] 2026년 상반기 (반기보고서 기준)\n[사실] 신규 고객" },
  { id: "day", content_ko: "[시점] 2026-05-14\n[사실] 고객 인증" },
], ["2026H1"]).map((row) => row.id);
assert.deepEqual(periodOrdered, ["right", "day", "unknown", "wrong"], `질문 기간 일치 → 시점 불명 → 명백한 불일치 순서여야 한다: ${periodOrdered}`);
// [시점]이 없으면 published_at은 마지막 보조 신호다. 보고서의 [시점] 2025년은 2026년 공시일보다 우선한다.
const reportPeriod = demotePeriodMismatches([
  { id: "report-2025", content_ko: "[시점] 2025년 (연차보고서 기준)", published_at: "2026-03-30" },
  { id: "article-2026", content_ko: "본문에 시점 없음", published_at: "2026-02-01" },
], ["2025"]).map((row) => row.id);
assert.deepEqual(reportPeriod, ["report-2025", "article-2026"], "[시점]이 공시일보다 우선해야 한다");
const halfYear = demotePeriodMismatches([
  { id: "h2", content_ko: "[시점] 2026년 하반기\n[사실] 양산" },
  { id: "h1", content_ko: "[시점] 2026년 상반기\n[사실] 개발" },
], ["2026H2"]).map((row) => row.id);
assert.deepEqual(halfYear, ["h2", "h1"], "반기 표기는 해당 반기만 맞아야 한다");

// --- 1.65) 한 기사가 프롬프트를 독점하지 못한다 ------------------------------------------
//
// 2026-09-09: "전고체 배터리 준비중인 회사들"에 근거 10건 중 6건이 같은 SMM 기사였다. 21개 청크가
// 같은 요약 머리말을 달고 있어 검색기 둘 다에 전부 걸렸고, 답변 모델은 회사 두 곳만 보고 "근거 부족"이라
// 답했다. 같은 기사에서는 상위 두 청크만 앞에 두고 나머지는 뒤로 민다. 버리지는 않는다.
const { collapseByArticle } = await import("../lib/knowledge-search.js");
const flooded = [
  { id: "a1", source_type: "article_chunk", article_id: "A" }, { id: "a2", source_type: "article_chunk", article_id: "A" },
  { id: "a3", source_type: "article_chunk", article_id: "A" }, { id: "b1", source_type: "article_chunk", article_id: "B" },
  { id: "ea", source_type: "event_fact", article_id: "A" }, { id: "a4", source_type: "article_chunk", article_id: "A" },
  { id: "m", source_type: "metric_row", article_id: null },
];
const collapsed = collapseByArticle(flooded).map((row) => row.id);
assert.deepEqual(collapsed, ["a1", "a2", "b1", "ea", "m", "a3", "a4"], `기사 A는 두 청크만 앞, 나머지는 뒤: ${collapsed}`);
assert.equal(collapsed.length, flooded.length, "버리지 않고 순서만 바꾼다");
// event_fact와 article_chunk는 같은 기사여도 서로 다른 사실이라 따로 센다.
assert.ok(collapsed.indexOf("ea") < collapsed.indexOf("a3"), "같은 기사의 event_fact는 article_chunk 상한과 무관하게 살아남는다");

// --- 1.66) 두 회사를 물으면 회사별로 필수 조건을 따로 건다 ---------------------------------
//
// 2026-09-09: "reshine과 CATL 협력 관계"에 진촨루이샹·CATL 협력 청크 3건이 있는데도 상위 10건에 없었다.
// 두 회사 표기를 한 그룹에 OR로 넣으면 청크가 많은 CATL이 다른 회사 이야기를 밀어낸다. 회사별로
// +그룹을 나누자 그 3건이 1~3위가 됐다(운영 DB 실측).
const pairGroups = questionCompanyGroups("reshine과 CATL 협력 관계");
assert.equal(pairGroups.length, 2, `두 회사가 각각 묶여야 한다: ${pairGroups.length}`);
const pairQuery = buildLexicalQuery("reshine과 CATL 협력 관계", { requiredGroups: pairGroups });
assert.equal((pairQuery.match(/\+\(/g) || []).length, 2, `필수 그룹이 회사마다 하나씩이어야 한다: ${pairQuery}`);
// 한 회사면 예전과 같은 모양이다.
const soloQuery = buildLexicalQuery("파라시스 신규 고객", { requiredGroups: questionCompanyGroups("파라시스 신규 고객") });
assert.equal((soloQuery.match(/\+\(/g) || []).length, 1, "한 회사는 필수 그룹 하나");
// 후처리도 "둘 다 언급 → 하나만 → 없음" 순이다.
const pairDemoted = demoteUnrelatedCompanies([
  { id: "catl-only", content_ko: "닝더스다이(CATL) 2026년 상반기 매출" },
  { id: "both", content_ko: "진촨루이샹 IPO, 닝더스다이(CATL)와 협력" },
  { id: "none", content_ko: "비야디 블레이드 배터리" },
  { id: "reshine-only", content_ko: "진촨루이샹 인산철리튬 투자" },
], [], pairGroups).map((row) => row.id);
assert.deepEqual(pairDemoted, ["both", "catl-only", "reshine-only", "none"], `둘 다 언급한 근거가 맨 앞: ${pairDemoted}`);

// --- 1.65) 소속 > 언급 > 없음 ------------------------------------------------------------
//
// 2026-09-10 "룽바이 LFP 증설 계획": 다른 회사 청크 22건이 경쟁사 나열로 容百를 언급한다. 언급만으로
// 같은 층에 두면 긴 경쟁사 기사가 룽바이 소속의 짧은 LFP 이벤트를 밀어낸다(정답 4건 중 2건이 10위 밖).
// 소속을 한 층 위에 두자 4/4가 상위 10에 들었고 다른 15문항은 순위가 그대로였다(로컬 채점, run 36b8590d 대비).
const { companyTier } = await import("../lib/knowledge-search.js");
const ronbayGroups = questionCompanyGroups("룽바이 LFP 증설 계획");
const peerMention = { id: "peer", company_id: "hunan-yuneng", content_ko: "후난위넝 LFP 호조. 경쟁사 容百科技·当升科技도 증설" };
const attributed = { id: "own", company_id: "ronbay", content_ko: "구이저우 34만 톤 LFP 프로젝트" };
const unrelated = { id: "none", company_id: "calb", content_ko: "CALB 쓰촨 30만 톤 리튬인산철" };
assert.equal(companyTier(attributed, ronbayGroups), 2, "청크가 그 회사 소속이면 2");
assert.equal(companyTier(peerMention, ronbayGroups), 1, "본문에 표기만 있으면 1");
assert.equal(companyTier(unrelated, ronbayGroups), 0, "둘 다 아니면 0");
// 융합 순위가 경쟁사 기사 쪽이 높아도 소속 청크가 앞이다. 언급 청크는 버리지 않고 그 다음이다.
const tiered = demoteUnrelatedCompanies([peerMention, unrelated, attributed], questionCompanyTerms("룽바이 LFP 증설 계획"), ronbayGroups).map((row) => row.id);
assert.deepEqual(tiered, ["own", "peer", "none"], `소속 > 언급 > 없음: ${tiered}`);
// 공급사 기사(상대 회사 소속, 본문 언급)는 여전히 무관 청크보다 앞이다 — 1.6의 성질을 잃지 않는다.
const supplierTier = companyTier({ id: "s", company_id: "reshine", content_ko: "孚能科技에 양극재 공급" }, questionCompanyGroups("파라시스 신규 고객"));
assert.equal(supplierTier, 1, "공급사 기사는 언급 층(1)에 남는다");
// 두 회사를 물으면 합산이다. 한 회사 소속이면서 다른 회사를 언급한 근거(3)가 한 회사 소속만(2)보다 앞이다.
assert.equal(companyTier({ company_id: "reshine", content_ko: "진촨루이샹, 닝더스다이(CATL)와 협력" }, pairGroups), 3, "소속 2 + 언급 1");
assert.equal(companyTier({ company_id: "catl", content_ko: "닝더스다이(CATL) 매출" }, pairGroups), 2, "한 회사 소속만이면 2");

// 안내문은 작업 계획이 아니라 두 문장이다(2026-09-09 사용자: "없으면 없는 거지 왜 이런 가이드가 나오나").
const promptSource = (await import("node:fs")).readFileSync(new URL("../lib/knowledge-search.js", import.meta.url), "utf8");
assert.match(promptSource, /guidance_ko는 최대 두 문장이다/, "안내문 길이 상한이 프롬프트에 있어야 한다");
assert.match(promptSource, /검색 키워드 목록, 조사 절차, 범위 설정, 라벨링 제안 같은 작업 계획을 쓰지 않는다/, "작업 계획 금지가 프롬프트에 있어야 한다");

// --- 1.7) 융합 상수는 기준선 실측에 맞춘 값이어야 한다 -------------------------------------
const searchSource = (await import("node:fs")).readFileSync(new URL("../lib/knowledge-search.js", import.meta.url), "utf8");
// 2026-09-10 54문항 실측으로 K=30(MRR 0.661→0.676, 다른 지표 동일). 값은 로컬 실험용 환경변수로만 덮어쓸 수 있고 운영 기본은 30이다.
assert.match(searchSource, /const RRF_K = tuned\("RAG_RRF_K", 30\);/, "RRF K 기본값은 54문항 실측에 맞춘 30이어야 한다");
assert.match(searchSource, /const VECTOR_WEIGHT = tuned\("RAG_VECTOR_WEIGHT", 0\.7\);/, "의미 검색 가중치 기본 0.7 — 0.5/0.5는 54문항에서 Hit@10 0.90→0.76으로 떨어졌다");
assert.match(searchSource, /const LEXICAL_WEIGHT = tuned\("RAG_LEXICAL_WEIGHT", 0\.3\);/, "단어 검색 가중치 기본 0.3");
assert.match(searchSource, /const LEXICAL_RESERVE = tuned\("RAG_LEXICAL_RESERVE", 0\);/, "단어 검색 보장 칸은 기본 0 — 2건 보장은 목록형 5문항의 recall을 깎았다");
// 밸류체인 그룹(회사 10여 곳, 표기 98~156개)이 필수 그룹 상한에 잘리면 뒤쪽 회사가 필수 조건에서 빠진다.
const moroccoQuery = buildLexicalQuery(expandDomainQuestion("모로코에 양극재 공장을 추진하는 회사"), { requiredGroups: questionValueChainGroups("모로코에 양극재 공장을 추진하는 회사") });
const moroccoRequired = moroccoQuery.match(/^\+\(([^)]*)\)/)?.[1] || "";
assert.ok(/중웨이신차이|CNGR/.test(moroccoRequired), "양극재 회사 그룹의 필수 조건에 CNGR 표기가 들어 있어야 한다(상한 40에 잘리면 빠진다)");
assert.ok(moroccoRequired.split(" OR ").length > 100, `양극재 그룹 표기가 잘리면 안 된다: ${moroccoRequired.split(" OR ").length}개`);
// k=10·0.7/0.3에서 실제로 달라지는 성질. 양쪽 상위 겹침이 여전히 1등인 것은 맞다(기준선에서 겹침이
// 0.50으로 최고). 달라지는 건 (1) 의미 1위 단독(0.7/11)이 단어 1위 단독(0.3/11)을 이기고 — 0.5/0.5에서는
// 동점이었다 — (2) 의미 1위 단독이 8위쯤의 어중간한 겹침(1.0/18)을 이긴다 — k=60에서는 겹치기만 하면
// 순위와 무관하게 단독 1위를 눌렀다.
const eight = Array.from({ length: 7 }, (_, i) => ({ id: `pad${i}` }));
const rankMatters = fuseByRrf([
  { rows: [{ id: "vec1" }, ...eight, { id: "both8" }], weight: 0.7, label: "vector" },
  { rows: [{ id: "lex1" }, ...eight.map((r) => ({ id: `${r.id}b` })), { id: "both8" }], weight: 0.3, label: "lexical" },
], { k: 10 });
const order = rankMatters.map((row) => row.id);
assert.ok(order.indexOf("vec1") < order.indexOf("lex1"), `의미 1위 단독이 단어 1위 단독보다 앞이어야 한다: ${order}`);
assert.ok(order.indexOf("vec1") < order.indexOf("both8"), `의미 1위 단독이 8위 겹침보다 앞이어야 한다: ${order}`);

const industryQueries = [
  ["전고체 양산", ["固态电池", "mass production", "量产"]],
  ["LFP 양극재 증설", ["磷酸铁锂", "cathode material", "扩产"]],
  ["인조흑연 출하량", ["artificial graphite", "人造石墨", "shipments", "出货量"]],
  ["ESS 급속충전", ["energy storage system", "储能", "fast charging", "快充"]],
  ["CATL 점유율", ["宁德时代", "Contemporary Amperex Technology", "market share", "市场份额"]],
  ["비야디 공급망", ["BYD", "比亚迪", "supply chain", "供应链"]],
  ["영업이익과 해외매출", ["operating profit", "营业利润", "overseas revenue", "境外收入"]],
];
for (const [question, expected] of industryQueries) {
  const expanded = expandDomainQuestion(question);
  for (const term of expected) assert.ok(expanded.includes(term), `${question}에 ${term} 동의어가 포함돼야 한다`);
}

// --- 2) RRF 융합 ------------------------------------------------------------

const row = (id) => ({ id, content_ko: `본문 ${id}` });
const fused = fuseByRrf([
  { rows: [row("A"), row("B"), row("C")], weight: 0.5, label: "vector" },
  { rows: [row("D"), row("E"), row("B")], weight: 0.5, label: "lexical" },
]);

// 합집합이다. 3 + 3에서 겹치는 B 하나를 빼고 5건.
assert.equal(fused.length, 5, "하이브리드는 후보를 줄이지 않는다. 합집합이어야 한다");

// 양쪽에 다 걸린 B는 점수를 두 번 받아, 어느 쪽에서도 1위가 아니었는데도 맨 위로 올라간다.
assert.equal(fused[0].id, "B", "양쪽에 걸린 청크가 최상위여야 한다");
assert.deepEqual(fused[0].retrieved_by.sort(), ["lexical", "vector"]);
assert.deepEqual(fused[0].ranks, { vector: 2, lexical: 3 });

// 각 검색기의 1위끼리는 반반 가중치에서 번갈아 놓인다.
assert.deepEqual([fused[1].id, fused[2].id].sort(), ["A", "D"], "두 1위가 나란히 뒤따라야 한다");

// 가중치를 한쪽으로 몰면 그쪽 1위가 반대쪽 1위를 앞선다.
// 겹침 보너스는 운영 가중치(0.7/0.3)에서는 여전히 가중치보다 세다. 아래에서 B는 어느 쪽 1위도
// 아닌데 최상위다. 양쪽에 다 걸렸다는 사실이 이 정도 기울이기로는 뒤집히지 않는다는 뜻이다.
// 단, 예전(k=60)에는 0.1/0.9처럼 극단으로 기울여도 B가 이겼다. k=10(2026-09-09)부터는 9배 가중치의
// 1위가 2·3위 겹침을 앞선다 — 그것이 k를 줄인 목적이다(순위가 신호를 싣게). 그래서 이 검사는 극단값이
// 아니라 운영 가중치로 겹침 우위를 확인한다.
const lexHeavy = fuseByRrf([
  { rows: [row("A"), row("B"), row("C")], weight: 0.3, label: "vector" },
  { rows: [row("D"), row("E"), row("B")], weight: 0.7, label: "lexical" },
]);
assert.equal(lexHeavy[0].id, "B", "운영 가중치(0.7/0.3)에서는 2·3위 겹침이 어느 쪽 1위보다 앞이다");
assert.ok(
  lexHeavy.findIndex((item) => item.id === "D") < lexHeavy.findIndex((item) => item.id === "A"),
  "가중치를 몰면 그쪽 1위가 반대쪽 1위를 앞선다",
);

// 한쪽이 비어도 융합은 성립한다(단어 검색이 꺼진 경우).
const vectorOnly = fuseByRrf([
  { rows: [row("A"), row("B")], weight: 0.5, label: "vector" },
  { rows: [], weight: 0.5, label: "lexical" },
]);
assert.deepEqual(vectorOnly.map((item) => item.id), ["A", "B"]);

// --- 3) 색인이 없을 때의 물러남 ---------------------------------------------

const EMBEDDING = new Array(1536).fill(0.01);
function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => "application/json" },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

// 단어 검색 RPC만 404. supabase/hybrid-search.sql을 아직 적용하지 않은 운영 상태다.
let lexicalCalls = 0;
globalThis.fetch = async (url) => {
  const target = String(url);
  if (target.includes("openai.com")) return jsonResponse({ data: [{ embedding: EMBEDDING }] });
  if (target.includes("rpc/lexical_knowledge_chunks")) {
    lexicalCalls += 1;
    return jsonResponse({ message: "Could not find the function" }, 404);
  }
  if (target.includes("rpc/match_knowledge_chunks")) {
    return jsonResponse([{ id: "V1", content_ko: "의미 검색 결과", similarity: 0.8 }]);
  }
  throw new Error(`unexpected fetch: ${target}`);
};

const degraded = await searchKnowledge({ question: "삼원계 양극재 출하량" });
assert.equal(lexicalCalls, 1, "단어 검색을 시도는 해야 한다");
assert.equal(degraded.length, 1, "단어 검색이 없어도 의미 검색 결과는 그대로 나와야 한다");
assert.equal(degraded[0].id, "V1");
assert.equal(degraded.retrieval.lexical_available, false, "단어 검색이 꺼졌다는 사실이 드러나야 한다");
assert.equal(degraded.retrieval.vector_matched, 1);
assert.equal(degraded.retrieval.lexical_matched, 0);

// 둘 다 살아 있을 때는 합집합과 겹침 수가 통계에 잡힌다.
globalThis.fetch = async (url) => {
  const target = String(url);
  if (target.includes("openai.com")) return jsonResponse({ data: [{ embedding: EMBEDDING }] });
  if (target.includes("rpc/lexical_knowledge_chunks")) {
    return jsonResponse([
      { id: "L1", content_ko: "단어 검색만 찾은 근거", lexical_score: 12 },
      { id: "V1", content_ko: "의미 검색 결과", lexical_score: 8 },
    ]);
  }
  if (target.includes("rpc/match_knowledge_chunks")) {
    return jsonResponse([
      { id: "V1", content_ko: "의미 검색 결과", similarity: 0.8 },
      { id: "V2", content_ko: "의미 검색만 찾은 근거", similarity: 0.7 },
    ]);
  }
  throw new Error(`unexpected fetch: ${target}`);
};

const hybrid = await searchKnowledge({ question: "SW-2413 출하량" });
assert.equal(hybrid.retrieval.candidates, 3, "2 + 2에서 겹치는 하나를 뺀 3건이 후보다");
assert.equal(hybrid.retrieval.overlapped, 1);
assert.equal(hybrid.retrieval.lexical_available, true);
assert.equal(hybrid[0].id, "V1", "양쪽에 걸린 근거가 최상위여야 한다");
// 의미 검색만 썼다면 top에 없었을 L1이 후보에 들어와 있어야 한다. 하이브리드를 붙인 이유 그 자체다.
assert.ok(hybrid.some((item) => item.id === "L1"), "단어 검색만 찾은 근거가 후보에 들어와야 한다");
// 두 검색기의 점수는 척도가 달라 섞이면 안 된다. 각자 제 필드에 남는다.
assert.equal(hybrid[0].similarity, 0.8);
assert.equal(hybrid[0].lexical_score, 8);

// 기간을 명시한 서술 질문에서는 같은 회사의 오래된 사건이 새 사건보다 앞에 남으면 안 된다.
// 이 검사는 DB의 벡터/단어 후보가 이미 나온 뒤 실제 searchKnowledge가 적용하는 순서를 확인한다.
globalThis.fetch = async (url) => {
  const target = String(url);
  if (target.includes("openai.com")) return jsonResponse({ data: [{ embedding: EMBEDDING }] });
  if (target.includes("rpc/lexical_knowledge_chunks")) return jsonResponse([
    { id: "old", content_ko: "[시점] 2024년\\n[사실] 과거 고객", lexical_score: 20 },
    { id: "current", content_ko: "[시점] 2026년 상반기\\n[사실] 신규 고객", lexical_score: 5 },
  ]);
  if (target.includes("rpc/match_knowledge_chunks")) return jsonResponse([
    { id: "old", content_ko: "[시점] 2024년\\n[사실] 과거 고객", similarity: 0.9 },
    { id: "current", content_ko: "[시점] 2026년 상반기\\n[사실] 신규 고객", similarity: 0.7 },
  ]);
  if (target.includes("report_metric?") || target.includes("market_financial?")) return jsonResponse([]);
  throw new Error(`unexpected fetch: ${target}`);
};
const periodSearch = await searchKnowledge({ question: "파라시스 2026년 상반기 신규 고객" });
assert.deepEqual(periodSearch.slice(0, 2).map((item) => item.id), ["current", "old"], "명시 기간과 맞는 근거가 검색 결과에서 앞서야 한다");
assert.deepEqual(periodSearch.retrieval.question_periods, ["2026H1"], "적용한 기간 조건을 검색 통계에 남겨야 한다");

// --- 3-1b) 회사를 짚은 질문은 단어 검색 후보를 넓게 뽑아 소속 청크를 앞세운 뒤 자른다 -------
//
// 2026-09-10 룽바이 실측의 축소판: 단어 검색 점수는 경쟁사 나열로 容百를 언급한 긴 기사 쪽이 높다.
// 10건만 뽑으면 그 기사들이 단어 검색 몫을 다 차지해 룽바이 소속 LFP 청크는 단어 검색에 "없는" 것이 되고,
// 의미 검색 점수만으로는 위로 못 올라간다. 30건을 뽑아 소속을 앞세우면 융합에서 겹침이 생긴다.
const poolCalls = [];
globalThis.fetch = async (url, init) => {
  const target = String(url);
  if (target.includes("openai.com")) return jsonResponse({ data: [{ embedding: EMBEDDING }] });
  if (target.includes("rpc/lexical_knowledge_chunks")) {
    poolCalls.push(JSON.parse(init?.body || "{}"));
    const peers = Array.from({ length: 10 }, (_, i) => ({ id: `peer${i}`, company_id: "hunan-yuneng", content_ko: `후난위넝 LFP 호조 ${i}. 경쟁사 容百科技도 증설`, lexical_score: 30 - i }));
    const own = [
      { id: "own-lfp", company_id: "ronbay", content_ko: "[회사] 룽바이(Ronbay)\n[사실] 구이저우 34만 톤 LFP 프로젝트", lexical_score: 9 },
      { id: "own-cert", company_id: "ronbay", content_ko: "[회사] 룽바이(Ronbay)\n[사실] 인산철리튬 고객 인증", lexical_score: 8 },
    ];
    return jsonResponse([...peers, ...own]);
  }
  if (target.includes("rpc/match_knowledge_chunks")) return jsonResponse([
    { id: "own-generic", company_id: "ronbay", content_ko: "[회사] 룽바이(Ronbay)\n[사실] 핵심 소재 기술", similarity: 0.9 },
    { id: "own-lfp", company_id: "ronbay", content_ko: "[회사] 룽바이(Ronbay)\n[사실] 구이저우 34만 톤 LFP 프로젝트", similarity: 0.8 },
  ]);
  if (target.includes("report_metric?") || target.includes("market_financial?")) return jsonResponse([]);
  throw new Error(`unexpected fetch: ${target}`);
};
const pooled = await searchKnowledge({ question: "룽바이 LFP 증설 계획" });
assert.equal(poolCalls[0]?.match_count, 30, "회사를 짚은 질문은 단어 검색 후보를 30건 뽑는다");
// 단어 검색 11·12번째였던 소속 청크가 단어 검색 몫에 들어와 융합에서 겹침을 받는다.
assert.ok(pooled.retrieval.overlapped >= 1, `소속 청크가 양쪽에 걸려 겹침이 생겨야 한다: ${JSON.stringify(pooled.retrieval)}`);
const pooledIds = pooled.map((row) => row.id);
assert.ok(pooledIds.indexOf("own-lfp") < pooledIds.indexOf("peer0"), `소속 LFP 청크가 경쟁사 기사보다 앞이어야 한다: ${pooledIds.join(",")}`);
assert.ok(pooledIds.includes("own-cert"), "단어 검색에서만 걸린 소속 청크도 상위 10에 들어와야 한다");
assert.ok(pooledIds.includes("peer0"), "언급 청크는 버리지 않는다 — 소속 청크 뒤에 따라온다");
// 회사를 짚지 않은 질문은 예전 그대로 10건이다. 이 유형은 기준선에서 1.00이었다.
poolCalls.length = 0;
await searchKnowledge({ question: "전고체 배터리 양산 시점" });
assert.equal(poolCalls[0]?.match_count, 10, "회사 조건이 없으면 단어 검색 후보 수를 바꾸지 않는다");

// --- 3-2) 임베딩이 끊겨도 단어 검색만으로 버틴다 -----------------------------

// 의미 검색은 질문마다 OpenAI를 부르는 유일한 외부 호출이라 가장 잘 끊긴다.
// 그때 질의응답 전체가 죽으면 Postgres 안에서 끝나는 단어 검색을 붙인 의미가 없다.
globalThis.fetch = async (url) => {
  const target = String(url);
  if (target.includes("openai.com")) return jsonResponse({ error: "quota" }, 429);
  if (target.includes("rpc/lexical_knowledge_chunks")) {
    return jsonResponse([{ id: "L1", content_ko: "단어 검색만 찾은 근거", lexical_score: 12 }]);
  }
  if (target.includes("rpc/match_knowledge_chunks")) throw new Error("의미 검색은 임베딩 없이 호출되면 안 된다");
  throw new Error(`unexpected fetch: ${target}`);
};

const lexicalOnly = await searchKnowledge({ question: "SW-2413 출하량" });
assert.equal(lexicalOnly.length, 1, "임베딩이 끊겨도 단어 검색 결과는 나와야 한다");
assert.equal(lexicalOnly[0].id, "L1");
assert.equal(lexicalOnly.retrieval.vector_available, false, "의미 검색이 끊겼다는 사실이 드러나야 한다");
assert.equal(lexicalOnly.retrieval.lexical_available, true);

// 둘 다 죽었을 때만 올려보낸다. 그때는 정말로 답할 방법이 없다.
globalThis.fetch = async (url) => {
  const target = String(url);
  if (target.includes("openai.com")) return jsonResponse({ error: "quota" }, 429);
  return jsonResponse({ message: "Could not find the function" }, 404);
};
await assert.rejects(
  () => searchKnowledge({ question: "SW-2413 출하량" }),
  "두 검색기가 모두 실패하면 조용히 빈 결과를 내지 말고 실패를 알려야 한다",
);

// --- 4) 상한 -----------------------------------------------------------------

// 프롬프트에 넣는 근거 수(검증 MATCH_COUNT + 보조 데이터 HEADLINE_QUOTA)는 ANSWER_SCHEMA의 used_sources 상한과 같아야 한다.
// 여기가 어긋나면 모델이 존재하지 않는 번호를 인용하거나 스키마 검증에서 막힌다.
// 2026-09-10부터 '보조 데이터 포함'은 검증 근거를 밀어내지 않고 뒤에 덧붙이므로 번호가 MATCH_COUNT를 넘는다.
const source = await import("node:fs").then((fs) => fs.readFileSync(new URL("../lib/knowledge-search.js", import.meta.url), "utf8"));
const matchCount = Number(source.match(/const MATCH_COUNT = (\d+)/)?.[1]);
const headlineQuota = Number(source.match(/const HEADLINE_QUOTA = (\d+)/)?.[1]);
assert.ok(matchCount > 0 && headlineQuota > 0, "MATCH_COUNT와 HEADLINE_QUOTA를 소스에서 읽을 수 있어야 한다");
assert.match(source, /used_sources: \{ type: "array", maxItems: MATCH_COUNT \+ HEADLINE_QUOTA, items: \{ type: "integer", minimum: 1, maximum: MATCH_COUNT \+ HEADLINE_QUOTA \} \}/,
  "used_sources 상한은 MATCH_COUNT + HEADLINE_QUOTA로 소스 상수에 묶여 있어야 한다");
assert.ok(source.includes('provider: "openai_rag"'), "근거 답변은 전용 경량 RAG 모델 경로를 써야 한다");
assert.match(source, /if \(!data\.sufficient\)/, "1차 답변이 부족할 때만 재작성 비용을 쓴다");
assert.match(source, /intentQuestion: question/, "재작성 검색도 회사·지표 의도는 원 질문에 고정한다");
assert.match(source, /rewrittenQueries\.map[\s\S]*searchKnowledge/, "부족할 때 재작성 질의를 실제 재검색한다");
assert.match(source, /KNOWLEDGE_REWRITE_SKIPPED/, "재작성 실패는 기존 답변으로 안전하게 물러난다");
assert.match(source, /parsed \? ordered\.filter\(\(row\) => parsed\.companies\.includes\(row\.company_id\)\) : ordered/, "정량 질문에 다른 회사 근거를 섞지 않는다");
const providerSource = await import("node:fs").then((fs) => fs.readFileSync(new URL("../lib/llm-provider.js", import.meta.url), "utf8"));
assert.ok(providerSource.includes('provider === "openai_rag"'), "전용 RAG 제공자 설정이 있어야 한다");
assert.ok(providerSource.includes('OPENAI_RAG_MODEL') && providerSource.includes('gpt-5.6-luna'), "RAG 기본 모델은 gpt-5.6-luna여야 한다");

// --- 3-4) '보조 데이터 포함'은 검증 근거를 보존하고 헤드라인을 뒤에 덧붙인다 ----------------
//
// 2026-09-10 사용자 실측: "적자를 보고 있는 중국 기업?"에서 토글을 켜자 정답이던 Farasis 순손실 청크(10위)가
// 사라지고 헤드라인 4건이 그 자리를 차지해 답이 "근거 부족"으로 바뀌었다. 더 넣었는데 결과가 줄어드는 것은
// 토글의 뜻과 어긋난다. 검증 근거는 토글을 끈 것과 같은 검색으로 뽑고, 헤드라인은 별도 패스로 뒤에 붙인다.
const verifiedPool = Array.from({ length: 10 }, (_, i) => ({ id: `v${i}`, company_id: "farasis", source_type: "article_chunk", content_ko: `검증 근거 ${i}`, similarity: 0.5 - i * 0.01 }));
const headlinePool = Array.from({ length: 6 }, (_, i) => ({ id: `h${i}`, company_id: "calb", source_type: "headline", content_ko: `[미검증 헤드라인] ${i}`, similarity: 0.6 - i * 0.01 }));
let embedCalls = 0; const rpcCalls = [];
globalThis.fetch = async (url, init) => {
  const target = String(url);
  if (target.includes("openai.com")) { embedCalls += 1; return jsonResponse({ data: [{ embedding: EMBEDDING }] }); }
  const body = JSON.parse(init?.body || "{}");
  if (target.includes("rpc/match_knowledge_chunks")) {
    rpcCalls.push({ rpc: "vector", unverified: body.include_unverified });
    // 헤드라인은 유사도가 더 높아 같은 풀에서 경쟁시키면 검증 근거를 밀어낸다 — 그 상황을 그대로 흉내 낸다.
    return jsonResponse(body.include_unverified ? [...headlinePool, ...verifiedPool].slice(0, body.match_count) : verifiedPool.slice(0, body.match_count));
  }
  if (target.includes("rpc/lexical_knowledge_chunks")) {
    rpcCalls.push({ rpc: "lexical", unverified: body.include_unverified });
    return jsonResponse(body.include_unverified ? [...headlinePool, ...verifiedPool].slice(0, body.match_count) : verifiedPool.slice(0, body.match_count));
  }
  if (target.includes("report_metric?") || target.includes("market_financial?")) return jsonResponse([]);
  throw new Error(`unexpected fetch: ${target}`);
};
const offRows = await searchKnowledge({ question: "적자를 보고 있는 중국 기업", includeUnverified: false });
const offCalls = rpcCalls.splice(0), offEmbeds = embedCalls; embedCalls = 0;
assert.ok(offRows.every((row) => row.source_type !== "headline"), "토글이 꺼지면 헤드라인이 섞이지 않는다");
assert.ok(offCalls.every((call) => call.unverified === false), "토글이 꺼지면 보조 데이터 패스를 부르지 않는다");
assert.equal(offEmbeds, 1, "임베딩은 질문당 한 번이다");
const onRows = await searchKnowledge({ question: "적자를 보고 있는 중국 기업", includeUnverified: true });
const onCalls = rpcCalls.splice(0);
assert.deepEqual(onRows.slice(0, offRows.length).map((row) => row.id), offRows.map((row) => row.id),
  "토글을 켜도 검증 근거의 목록과 순서는 끈 것과 같아야 한다 — 더하는 것이지 바꾸는 것이 아니다");
const appended = onRows.slice(offRows.length);
assert.ok(appended.length > 0 && appended.length <= 3, `헤드라인은 뒤에 최대 HEADLINE_QUOTA건 덧붙는다: ${appended.length}`);
assert.ok(appended.every((row) => row.source_type === "headline"), "덧붙는 것은 헤드라인뿐이다");
assert.equal(onRows.retrieval.headline_rows, appended.length, "통계에 헤드라인 건수를 남긴다");
assert.ok(onCalls.some((call) => call.unverified === true) && onCalls.some((call) => call.unverified === false), "검증 패스와 보조 패스를 둘 다 돈다");
assert.equal(embedCalls, 1, "보조 패스가 있어도 임베딩은 한 번이다");

console.log("hybrid search checks passed");
