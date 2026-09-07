// 언론 기사 본문을 한국어로 옮긴다.
//
// 언론 기사 원문은 저작권 때문에 DB에 남기지 않는다. 그동안은 제목과 2~4줄 요약만 벡터에 넣어
// 기사에 있던 세부 사실(수치·고객명·공정·일정)이 검색되지 않았다. 원문은 버리되 한국어로 옮긴
// 본문을 문단 단위로 보관해 검색 가능하게 한다. 해석·전망을 보태지 않고 있는 그대로 옮긴다.
import { createJsonResponse, llmConfig } from "./llm-provider.js";

// 번역 입력 상한. 60초 함수 안에서 추출·교차검증 뒤에 한 번 더 돌아야 하므로 길게 잡지 않는다.
const MAX_TRANSLATE_CHARS = 9000;
const MAX_PARAGRAPHS = 40;
const TRANSLATE_TIMEOUT_MS = 30000;

const SCHEMA = {
  type: "object", additionalProperties: false, required: ["paragraphs_ko", "truncated"],
  properties: {
    paragraphs_ko: { type: "array", maxItems: MAX_PARAGRAPHS, items: { type: "string" } },
    truncated: { type: "boolean" },
  },
};

export const INSTRUCTIONS = "중국 배터리 산업 기사를 한국어로 옮기는 번역가다. 본문을 문단 단위로 충실하게 번역한다. 수치·단위·날짜·회사명·제품명·인용문은 원문 그대로 보존하고, 회사명은 괄호 안에 중국어 원명을 한 번 병기한다. 요약·해석·전망·평가를 보태지 않고, 빠뜨리지도 않는다. 광고·구독 안내·기자 서명·관련 기사 목록 같은 본문 아닌 부분은 뺀다. 본문이 잘려 끝까지 못 옮겼으면 truncated를 true로 둔다. 문단마다 배열 원소 하나씩 넣는다.";

// 실패해도 호출자가 요약만으로 계속 가게 하려고 예외를 밖으로 던지지 않는다.
export async function translateArticleKo({ bodyText, titleOriginal, companyNameKo, provider = "openai" }) {
  if (!llmConfig(provider)) return { paragraphs: [], status: "not_configured" };
  const body = String(bodyText || "").replace(/\s+/g, " ").trim();
  if (body.length < 200) return { paragraphs: [], status: "too_short" };
  const cut = body.length > MAX_TRANSLATE_CHARS;
  try {
    const result = await createJsonResponse({
      name: "article_translation_ko", schema: SCHEMA, instructions: INSTRUCTIONS, provider,
      timeoutMs: TRANSLATE_TIMEOUT_MS,
      input: `회사: ${companyNameKo || "미상"}\n원문 제목: ${titleOriginal || ""}\n본문${cut ? " (앞 " + MAX_TRANSLATE_CHARS + "자만 제공)" : ""}:\n${body.slice(0, MAX_TRANSLATE_CHARS)}`,
    });
    const paragraphs = (result.data?.paragraphs_ko || []).map((p) => String(p).trim()).filter((p) => p.length >= 10);
    if (!paragraphs.length) return { paragraphs: [], status: "empty" };
    return { paragraphs, status: "translated", truncated: cut || Boolean(result.data?.truncated), provider: result.provider };
  } catch (error) {
    console.error("[ARTICLE_TRANSLATION_FAILED]", JSON.stringify({ message: error.message }));
    return { paragraphs: [], status: "failed", error: error.message };
  }
}

// 관리자 화면(파이프라인 보기)이 실제 프롬프트를 그대로 읽는다.
export const ARTICLE_TRANSLATION_PROMPT = INSTRUCTIONS;
