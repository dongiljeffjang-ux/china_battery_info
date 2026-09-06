import assert from 'node:assert/strict';
process.env.DEEPSEEK_API_KEY = 'test-only';
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only';
process.env.LANGSMITH_TRACING = 'false';
const { createJsonResponse } = await import('../lib/llm-provider.js');
const logs = [];
let output = [];
globalThis.fetch = async (url, options) => {
  if (url.includes('supabase.co')) {
    logs.push(JSON.parse(options.body));
    return new Response(null, { status: 204 });
  }
  return Response.json({ status: 'completed', output, usage: { input_tokens: 100, output_tokens: 25 } });
};
const options = { provider: 'deepseek', webSearch: true, name: 'search_test', schema: {}, input: 'test' };
output = [{ type: 'web_search_call', status: 'completed' }];
await assert.rejects(createJsonResponse(options), /EMPTY_OUTPUT/);
assert.equal(logs.at(-1).payload.usage.input_tokens, 100);
assert.equal(logs.at(-1).status, 'failed');
const message = { type: 'message', content: [{ type: 'output_text', text: '{"articles":[]}' }] };
output = [message];
await assert.rejects(createJsonResponse(options), /SEARCH_NOT_EXECUTED/);
output = [{ type: 'web_search_call', status: 'completed' }, message];
const result = await createJsonResponse(options);
assert.equal(result.telemetry.search_calls, 1);
assert.equal(logs.at(-1).status, 'ok');
console.log('LLM search telemetry checks passed (no paid API calls)');
