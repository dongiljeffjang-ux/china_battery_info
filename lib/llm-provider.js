import { traced } from "./tracing.js";
import { logPipeline } from "./pipeline-log.js";

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
  const messages = (payload.output || []).filter((item) => item.type === 'message');
  // 검색 중간 설명을 최종 JSON에 붙이면 유효한 최종 응답도 JSON.parse가 거부한다.
  const finalText = (messages.at(-1)?.content || [])
    .filter((content) => content.type === "output_text" && typeof content.text === "string")
    .map((content) => content.text)
    .join("\n");
  const text = String(finalText || payload.output_text || '').trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text);
  return fenced ? fenced[1].trim() : text;
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
    instructions: `${instructions}\n최종 응답은 요청된 JSON 객체 하나만 반환한다. 마크다운 코드 블록이나 설명을 붙이지 않는다.`,
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
  let upstream;
  try { upstream = await fetch(config.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(webSearch ? 35000 : 45000)
  }); } catch (error) {
    await logPipeline('llm', { provider: config.provider, model: config.model, purpose: name, web_search: webSearch, error: error.name || 'NETWORK_ERROR', usage: null }, { status: 'failed' });
    throw error;
  }
  if (!upstream.ok) {
    await logPipeline('llm', { provider: config.provider, model: config.model, purpose: name, web_search: webSearch, http_status: upstream.status, usage: null }, { status: 'failed' });
    const detail = (await upstream.text()).replace(/\s+/g, " ").slice(0, 500);
    throw new Error(`${config.provider.toUpperCase()}_${upstream.status}: ${detail}`);
  }
  const payload = await upstream.json();
  // Preserve search responses before parsing: a format failure must not erase evidence.
  // Chunk the serialized response so the pipeline logger never truncates it.
  // No request headers, credentials or prompts are included.
  if (webSearch && config.provider === 'deepseek') {
    const raw = JSON.stringify(payload);
    const captureId = crypto.randomUUID();
    const parts = Math.ceil(raw.length / 8000);
    for (let index = 0; index < parts; index++) {
      await logPipeline('llm', {
        kind: 'search_response_raw', capture_id: captureId,
        provider: config.provider, purpose: name, part: index, parts,
        raw: raw.slice(index * 8000, (index + 1) * 8000)
      });
    }
  }
  const telemetry = {
    provider: config.provider, model: config.model, purpose: name,
    web_search: webSearch, response_status: payload.status || null,
    usage: payload.usage || null,
    search_calls: (payload.output || []).filter((item) => item.type === 'web_search_call').length,
    output_types: (payload.output || []).map((item) => item.type),
    incomplete: payload.incomplete_details || null,
  };
  const outputText = responseOutputText(payload);
  if (!outputText) {
    await logPipeline('llm', { ...telemetry, error: 'EMPTY_OUTPUT' }, { status: 'failed' });
    const outputTypes = (payload.output || []).map((item) => item.type).join(",") || "none";
    throw new Error(`${config.provider.toUpperCase()}_EMPTY_OUTPUT:${outputTypes}`);
  }
  if (webSearch && !telemetry.search_calls) {
    await logPipeline('llm', { ...telemetry, error: 'SEARCH_NOT_EXECUTED' }, { status: 'failed' });
    throw new Error(`${config.provider.toUpperCase()}_SEARCH_NOT_EXECUTED`);
  }
  const sourceUrls = new Set();
  for (const item of payload.output || []) {
    for (const source of item.action?.sources || []) if (source.url) sourceUrls.add(source.url);
    for (const content of item.content || []) {
      for (const annotation of content.annotations || []) if (annotation.type === "url_citation" && annotation.url) sourceUrls.add(annotation.url);
    }
  }
  let data;
  try {
    data = JSON.parse(outputText);
  } catch {
    await logPipeline('llm', { ...telemetry, error: 'INVALID_JSON_OUTPUT' }, { status: 'failed' });
    throw new Error(`${config.provider.toUpperCase()}_INVALID_JSON_OUTPUT`);
  }
  await logPipeline('llm', { ...telemetry, articles: Array.isArray(data.articles) ? data.articles.length : null });
  return { data, model: config.model, provider: config.provider, sourceUrls: [...sourceUrls], telemetry };
}
