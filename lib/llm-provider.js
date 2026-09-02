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
      model: process.env.DEEPSEEK_MODEL || "deepseek-v4-flash"
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

export async function createJsonResponse({ instructions, input, schema, name, webSearch = false, provider = "auto" }) {
  const config = llmConfig(provider);
  if (!config) throw new Error("LLM_NOT_CONFIGURED");
  const body = {
    model: config.model,
    instructions,
    input,
    text: { format: { type: "json_schema", name, strict: true, schema } }
  };
  if (config.provider === "openai") body.store = false;
  if (webSearch) {
    body.tools = [{ type: "web_search" }];
    body.tool_choice = { type: "web_search" };
    if (config.provider === "openai") body.include = ["web_search_call.action.sources"];
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
