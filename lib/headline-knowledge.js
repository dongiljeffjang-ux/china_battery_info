// 미검증 헤드라인을 한국어로 옮겨 벡터 지식에 넣는다.
//
// 수집은 하루 수백 건인데 본문을 읽는 것은 상위 몇십 건뿐이라, 나머지는 벡터 DB에 아예 없었다.
// 사용자가 "그런 소식이 있었나"를 찾을 수 있게 제목만이라도 넣되, 본문 대조를 거치지 않았으므로
// 검증된 사실과 같은 등급으로 두지 않는다. 구분은 knowledge_chunk.source_type='headline'이 한다.
//
// 여기서 하는 일은 번역뿐이다. 요약·사실 추출·이벤트 생성은 하지 않는다. 본문이 없으므로
// 그것들을 만들면 근거 없는 문장을 지어내는 셈이 된다.

import { supabaseRest } from "./supabase.js";
import { COMPANIES } from "./china-sources.js";
import { createJsonResponse } from "./llm-provider.js";
import { embedHeadlines } from "./vector-ingestion.js";

// 한 번의 LLM 호출에 넣을 제목 수. 제목은 짧아 넉넉히 묶어도 토큰이 얼마 안 든다.
const TITLES_PER_CALL = 30;
// 한 훅에서 최대 몇 번 부를지. 야간 크론이 40훅까지 도므로 며칠이면 밀린 분이 소화된다.
const CALLS_PER_HOP = 1;

const TRANSLATION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: {
    items: {
      type: "array",
      maxItems: TITLES_PER_CALL,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["n", "title_ko", "keywords_ko"],
        properties: {
          n: { type: "integer", minimum: 1, maximum: TITLES_PER_CALL },
          title_ko: { type: "string" },
          keywords_ko: { type: "array", maxItems: 3, items: { type: "string" } },
        },
      },
    },
  },
};

export const INSTRUCTIONS = [
  "중국 이차전지 산업 기사 제목을 한국어로 옮긴다.",
  "제목에 있는 내용만 옮긴다. 제목에 없는 회사·수치·날짜·배경을 덧붙이지 않고, 요약하거나 해석하지 않는다.",
  "제공된 '서비스 표준 회사명'이 제목의 주체와 같으면 그 한국어 표준명을 그대로 쓴다. 중국어 법인명과 한국어명을 섞어 새 이름을 만들지 않는다.",
  "표준명을 알 수 없는 회사·기관은 원문 표기를 그대로 두고 괄호 없이 쓴다.",
  "keywords_ko에는 회사명 대신 사건을 대표하는 짧은 한국어 키워드를 최대 3개 넣는다(예: 증설, 고객 인증, 실리콘 음극).",
  "n은 입력에 붙은 번호를 그대로 돌려준다. 번호를 새로 매기지 않는다.",
].join(" ");

function companyNameFor(article) {
  const companyId = article.article_company?.[0]?.company_id;
  return COMPANIES.find((item) => item.id === companyId)?.name_ko || null;
}

async function translateBatch(articles, provider) {
  const input = articles
    .map((article, index) => [
      `[${index + 1}]`,
      `서비스 표준 회사명: ${companyNameFor(article) || "미상"}`,
      `매체: ${article.source_name || "미상"}`,
      `제목: ${article.title_original}`,
    ].join(" | "))
    .join("\n");
  const { data } = await createJsonResponse({
    name: "headline_translation",
    schema: TRANSLATION_SCHEMA,
    instructions: INSTRUCTIONS,
    input: `아래 제목을 한국어로 옮긴다.\n\n${input}`,
    provider,
  });
  const byIndex = new Map((data.items || []).map((item) => [item.n, item]));
  return articles
    .map((article, index) => {
      const translated = byIndex.get(index + 1);
      const titleKo = String(translated?.title_ko || "").trim();
      if (!titleKo) return null;
      return {
        id: article.id,
        companyId: article.article_company?.[0]?.company_id || null,
        companyName: companyNameFor(article),
        titleKo,
        titleOriginal: article.title_original,
        keywordsKo: (translated.keywords_ko || []).map((word) => String(word).trim()).filter(Boolean),
        sourceName: article.source_name,
        sourceUrl: article.canonical_url,
        publishedAt: article.published_at,
      };
    })
    .filter(Boolean);
}

// 아직 헤드라인 임베딩을 하지 않은 미처리 기사를 한 훅 분량 처리한다.
// 본문 처리를 통과한 기사(verification_status != 'pending')는 이미 본문 청크가 있으므로 건드리지 않는다.
export async function embedPendingHeadlines({ deadline = Infinity, provider = "auto" } = {}) {
  const limit = TITLES_PER_CALL * CALLS_PER_HOP;
  const pending = await supabaseRest(
    `article?select=id,title_original,source_name,canonical_url,published_at,article_company(company_id)` +
    `&verification_status=eq.pending&headline_embedded_at=is.null&title_original=not.is.null` +
    `&order=published_at.desc&limit=${limit + 1}`
  );
  if (!pending.length) return { status: "done", articles: 0, chunks: 0, remaining: 0 };
  const remaining = Math.max(0, pending.length - limit);
  const targets = pending.slice(0, limit);

  let translated = 0;
  let chunks = 0;
  const failures = [];
  for (let start = 0; start < targets.length; start += TITLES_PER_CALL) {
    if (Date.now() > deadline) break;
    const batch = targets.slice(start, start + TITLES_PER_CALL);
    try {
      const rows = await translateBatch(batch, provider);
      if (rows.length) {
        chunks += (await embedHeadlines(rows)).chunks;
        translated += rows.length;
        // 번역된 제목은 화면·Raw 내보내기에서도 쓸 수 있게 기사에 남긴다.
        // 본문 검증 상태는 건드리지 않는다. 이 제목은 여전히 미검증이다.
        const now = new Date().toISOString();
        for (const row of rows) {
          await supabaseRest(`article?id=eq.${encodeURIComponent(row.id)}`, {
            method: "PATCH", prefer: "return=minimal",
            body: { title_ko: row.titleKo, headline_embedded_at: now, updated_at: now },
          });
        }
      }
      // 번역이 돌아오지 않은 제목은 다음 훅이 같은 배치에서 또 멈추지 않도록 표시만 남긴다.
      const done = new Set(rows.map((row) => row.id));
      const skipped = batch.filter((article) => !done.has(article.id));
      for (const article of skipped) {
        await supabaseRest(`article?id=eq.${encodeURIComponent(article.id)}`, {
          method: "PATCH", prefer: "return=minimal",
          body: { headline_embedded_at: new Date().toISOString() },
        });
      }
    } catch (error) {
      console.error("[HEADLINE_EMBED_FAILED]", JSON.stringify({ size: batch.length, message: error.message }));
      failures.push(error.message);
      break;
    }
  }
  return {
    status: translated ? "embedded" : failures.length ? "failed" : "skipped",
    articles: translated,
    chunks,
    remaining,
    ...(failures.length ? { error: failures[0] } : {}),
  };
}

// 관리자 화면(파이프라인 보기)이 실제 프롬프트를 그대로 읽는다.
export const HEADLINE_TRANSLATION_PROMPT = INSTRUCTIONS;
