// 벡터 지식 검색과 근거 인용 답변.
//
// data-model.md 6절의 질의응답 정책을 따른다.
//   1. 질문에서 기업·기간·주제를 파악한다
//   2. 구조화 Event/Fact를 먼저 검색한다 (knowledge_chunk의 event_fact)
//   3. 내부 근거가 없으면 답을 만들지 않고 무엇을 확인해야 하는지 안내한다
//   4. 각 핵심 주장에 Citation을 연결한다
//   5. 상충된 출처는 하나를 고르지 않고 차이를 설명한다

import { supabaseRest } from "./supabase.js";
import { createJsonResponse } from "./llm-provider.js";
import { traced } from "./tracing.js";

const MATCH_COUNT = 10;

async function embedQuestion(question) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";
  if (!apiKey) throw new Error("EMBEDDING_NOT_CONFIGURED");
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, input: question, encoding_format: "float" }),
  });
  if (!response.ok) throw new Error(`OPENAI_EMBEDDING_${response.status}`);
  const payload = await response.json();
  const embedding = payload.data?.[0]?.embedding;
  if (!embedding?.length) throw new Error("EMPTY_EMBEDDING");
  return embedding;
}

// includeUnverified: 본문 대조를 거치지 않은 헤드라인 청크(source_type='headline')까지 후보에 넣을지.
// 기본은 제외다. 헤드라인은 한 줄짜리라 검증된 본문 청크와 같은 풀에서 경쟁하면 상위 k를 차지해
// 답변이 오히려 얇아진다. 사용자가 넓게 훑고 싶을 때만 화면 토글로 켠다.
export async function searchKnowledge({ question, companyId = null, limit = MATCH_COUNT, includeUnverified = false }) {
  const embedding = await embedQuestion(question);
  const rows = await supabaseRest("rpc/match_knowledge_chunks", {
    method: "POST",
    body: {
      query_embedding: embedding,
      match_count: limit,
      filter_company_id: companyId || null,
      include_unverified: includeUnverified,
    },
  });
  return (rows || []).filter((row) => row.content_ko);
}

const ANSWER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["sufficient", "answer_ko", "conflicts_ko", "guidance_ko", "used_sources"],
  properties: {
    // 근거만으로 답할 수 있는지. false면 answer_ko를 비우고 guidance_ko로 안내한다.
    sufficient: { type: "boolean" },
    answer_ko: { type: "string" },
    conflicts_ko: { type: "string" },
    guidance_ko: { type: "string" },
    used_sources: { type: "array", maxItems: 10, items: { type: "integer", minimum: 1, maximum: 10 } },
  },
};

const INSTRUCTIONS = [
  "중국 이차전지 산업 인텔리전스 서비스의 근거 인용 답변자다.",
  "제공된 근거 안에 있는 사실만 쓴다. 근거에 없는 수치·회사·날짜를 만들지 않는다.",
  "전망·인과 추정·투자 판단·목표주가를 만들지 않는다. 출처가 말한 사실과 그 사실들 사이의 비교만 한다.",
  "근거가 질문에 답하기에 충분하지 않으면 sufficient를 false로 두고 answer_ko를 빈 문자열로 남긴다. 억지로 답하지 않는다.",
  "guidance_ko에는 사용자가 다음에 무엇을 확인하면 되는지 구체적으로 쓴다. 어느 회사의 어떤 자료(연차보고서, 반기보고서, 특정 공시 항목)를 봐야 하는지, 또는 어떤 수집·요약 작업을 실행해야 하는지 적는다.",
  "여러 근거가 서로 다른 값을 말하면 하나를 고르지 말고 conflicts_ko에 차이를 설명한다. 상충이 없으면 빈 문자열을 쓴다.",
  "used_sources에는 실제로 사용한 근거의 번호만 넣는다. 사용하지 않은 번호를 넣지 않는다.",
  "근거에 [미검증 헤드라인]이라고 표시된 것은 기사 제목만 옮긴 것이고 본문 대조를 거치지 않았다. 그 안에 없는 내용을 채워 넣지 말고, 그것만으로 답이 될 때는 answer_ko에 '헤드라인 수준의 정보'임을 밝힌다. 검증된 근거와 미검증 헤드라인이 서로 다른 값을 말하면 검증된 쪽을 우선하되 차이를 conflicts_ko에 적는다.",
  "[텍스트 전용 PDF] 근거는 이미지 도표가 누락될 수 있다. 검색 결과가 없다는 이유로 보고서에 해당 사실이 없다고 단정하지 말고 guidance_ko에 이미지 도표 미분석 가능성을 밝힌다.",
  "답변은 한국어 개조식으로 쓰고, 회사명과 수치를 앞에 둔다.",
].join(" ");

export async function answerFromKnowledge({ question, companyId = null, provider = "auto", includeUnverified = false }) {
  const chunks = await traced("retrieve_knowledge", () => searchKnowledge({ question, companyId, includeUnverified }), {
    runType: "retriever",
    inputs: { question, company_id: companyId, include_unverified: includeUnverified },
    metadata: { company_id: companyId || "all", include_unverified: includeUnverified },
  });
  if (!chunks.length) {
    return {
      sufficient: false,
      answer_ko: "",
      conflicts_ko: "",
      guidance_ko: "벡터 지식에 관련 근거가 없습니다. 해당 기업의 연차보고서 요약을 먼저 실행하거나, 질문의 회사·기간을 좁혀 다시 물어보세요.",
      sources: [],
      matched: 0,
    };
  }
  const evidence = chunks.map((chunk, index) => [
    `[${index + 1}]${chunk.source_type === "headline" ? " [미검증 헤드라인]" : chunk.source_type === "report_chunk" ? " [텍스트 전용 PDF]" : ""} 회사=${chunk.company_id || "미상"} 시점=${chunk.published_at || "미상"} 출처=${chunk.source_name || "미상"}`,
    chunk.content_ko,
    chunk.original_excerpt ? `원문 발췌: ${chunk.original_excerpt}` : "",
  ].filter(Boolean).join("\n")).join("\n\n---\n\n");

  const { data } = await createJsonResponse({
    name: "knowledge_answer",
    schema: ANSWER_SCHEMA,
    instructions: INSTRUCTIONS,
    input: `질문: ${question}\n\n=== 근거 ===\n${evidence}`,
    provider,
  });

  const used = new Set((data.used_sources || []).filter((index) => index >= 1 && index <= chunks.length));
  const sources = [...used].sort((a, b) => a - b).map((index) => {
    const chunk = chunks[index - 1];
    return {
      n: index,
      company_id: chunk.company_id,
      published_at: chunk.published_at,
      source_name: chunk.source_name,
      source_url: chunk.source_url,
      similarity: Math.round((chunk.similarity || 0) * 1000) / 1000,
      // 화면이 검증본과 미검증 헤드라인을 구분해 보여 줄 수 있게 등급을 함께 내려보낸다.
      verified: chunk.source_type !== "headline",
      excerpt: (chunk.original_excerpt || chunk.content_ko || "").slice(0, 220),
    };
  });
  const unverified = chunks.filter((chunk) => chunk.source_type === "headline").length;
  const textOnlyReports = chunks.filter((chunk) => chunk.source_type === "report_chunk").length;
  return { ...data, sources, matched: chunks.length, unverified_matched: unverified,
    report_text_only_matched: textOnlyReports,
    completeness_warning: textOnlyReports ? "공시 PDF의 이미지 도표는 분석되지 않았으므로 검색 결과가 보고서 전체를 대표하지 않습니다." : null };
}
