import { traced } from "./tracing.js";

const OPENAI_URL = "https://api.openai.com/v1/responses";
const DEEPSEEK_URL = "https://api.deepseek.com/responses";

export function llmConfig(provider = "auto") {
  if ((provider === "auto" || provider === "openai") && process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL) {
    return { provider: "openai", url: OPENAI_URL, apiKey: process.env.OPENAI_API_KEY, model: process.env.OPENAI_MODEL };
  }
  if ((provider === "auto" || provider === "deepseek") && process.env.DEEPSEEK_API_KEY) {
    return {
      provider: "deepseek",
      url: DEEPSEEK_URL,
      apiKey: process.env.DEEPSEEK_API_KEY,
      model: process.env.DEEPSEEK_MODEL || "deepseek-v4-flash",
      thinking: String(process.env.DEEPSEEK_THINKING || "false").toLowerCase() === "true"
    };
  }
  return null;
}

export function responseOutputText(payload) {
  return payload.output_text || (payload.output || [])
    .filter((item) => item.type === "message")
    .flatMap((item) => item.content || [])
    .filter((content) => content.type === "output_text" && typeof content.text === "string")
    .map((content) => content.text)
    .join("\n");
}

// 모든 LLM 호출이 이 함수를 지난다. 추적도 여기 한 곳에 건다.
export async function createJsonResponse(options) {
  const config = llmConfig(options.provider || "auto");
  if (!config) throw new Error("LLM_NOT_CONFIGURED");
  return traced(options.name || "llm", () => callJsonResponse(options), {
    runType: "llm",
    inputs: { instructions: options.instructions, input: options.input, web_search: Boolean(options.webSearch) },
    metadata: { provider: config.provider, model: config.model, schema_name: options.name, web_search: Boolean(options.webSearch) },
  });
}

async function callJsonResponse({ instructions, input, schema, name, webSearch = false, provider = "auto" }) {
  const config = llmConfig(provider);
  if (!config) throw new Error("LLM_NOT_CONFIGURED");
  const body = {
    model: config.model,
    instructions,
    input,
    text: { format: { type: "json_schema", name, strict: true, schema } }
  };
  if (config.provider === "openai") body.store = false;
  // DeepSeek Responses API defaults to high-effort thinking.  Search candidate
  // extraction and article fact comparison are structured, bounded tasks, so
  // keep it off unless the operator explicitly opts in.
  if (config.provider === "deepseek") body.reasoning = { effort: config.thinking ? "low" : "none" };
  if (webSearch) {
    body.tools = [{ type: "web_search" }];
    // 검색 사용을 강제하면 DeepSeek이 web_search_call만 되풀이하다 최종 JSON을 내지 못하고
    // 빈 출력으로 끝난다(찾을 회사가 많을수록 잘 걸린다). DeepSeek은 스스로 멈출 수 있게 두고,
    // 강제해도 답을 내는 OpenAI만 그대로 둔다. 검색을 쓰라는 지시는 instructions에 이미 있다.
    if (config.provider === "openai") {
      body.tool_choice = { type: "web_search" };
      body.include = ["web_search_call.action.sources"];
    } else {
      body.tool_choice = "auto";
    }
  }
  const upstream = await fetch(config.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!upstream.ok) {
    const detail = (await upstream.text()).replace(/\s+/g, " ").slice(0, 500);
    throw new Error(`${config.provider.toUpperCase()}_${upstream.status}: ${detail}`);
  }
  const payload = await upstream.json();
  const outputText = responseOutputText(payload);
  if (!outputText) {
    const outputTypes = (payload.output || []).map((item) => item.type).join(",") || "none";
    throw new Error(`${config.provider.toUpperCase()}_EMPTY_OUTPUT:${outputTypes}`);
  }
  const sourceUrls = new Set();
  for (const item of payload.output || []) {
    for (const source of item.action?.sources || []) if (source.url) sourceUrls.add(source.url);
    for (const content of item.content || []) {
      for (const annotation of content.annotations || []) if (annotation.type === "url_citation" && annotation.url) sourceUrls.add(annotation.url);
    }
  }
  try {
    return { data: JSON.parse(outputText), model: config.model, provider: config.provider, sourceUrls: [...sourceUrls] };
  } catch {
    throw new Error(`${config.provider.toUpperCase()}_INVALID_JSON_OUTPUT`);
  }
}
