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

const { buildLexicalQuery, expandDomainQuestion, fuseByRrf, searchKnowledge } = await import("../lib/knowledge-search.js");

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
// 단, 겹침 보너스는 가중치보다 세다. 아래에서 B는 어느 쪽 1위도 아니고 단어 검색 가중치가
// 9배인데도 여전히 최상위다. 양쪽에 다 걸렸다는 사실이 가중치 기울이기로 뒤집히지 않는다는 뜻이고,
// 이것이 RRF를 쓰는 이유다. 가중치는 겹치지 않은 것들 사이의 순서만 흔든다.
const lexHeavy = fuseByRrf([
  { rows: [row("A"), row("B"), row("C")], weight: 0.1, label: "vector" },
  { rows: [row("D"), row("E"), row("B")], weight: 0.9, label: "lexical" },
]);
assert.equal(lexHeavy[0].id, "B", "겹친 청크는 가중치를 기울여도 최상위를 지킨다");
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

// --- 4) 검색 전용 계약 --------------------------------------------------------

// 이 화면은 근거를 LLM 프롬프트에 넣어 종합하지 않는다. Luna 설정 오류가 검색 결과를
// 막지 않도록, 검색 모듈에 생성 호출이 다시 들어오지 않게 고정한다.
const source = await import("node:fs").then((fs) => fs.readFileSync(new URL("../lib/knowledge-search.js", import.meta.url), "utf8"));
const matchCount = Number(source.match(/const MATCH_COUNT = (\d+)/)?.[1]);
assert.equal(matchCount, 10, "화면에 돌려줄 근거 수 상한은 10건이다");
assert.ok(!source.includes("createJsonResponse"), "근거 검색에서 텍스트 생성 모델을 호출하면 안 된다");
assert.ok(!source.includes("knowledge_answer"), "근거를 생성형 답변 프롬프트로 넘기면 안 된다");

console.log("hybrid search checks passed");
