// LLM 검색 호출 계약 회귀 검사. 유료 호출 없음.
// 2026-09-14: DeepSeek 웹 검색을 Responses API에서 Anthropic 호환 경로(/anthropic/v1/messages)로 옮겼다.
// Responses API는 09-10부터 내장 web_search를 무시했고(문서 호환표 Ignored), Anthropic 경로는 실호출에서
// server_tool_use·web_search_tool_result를 실제로 돌려줬다(scripts/probe-deepseek-anthropic.mjs).
import assert from 'node:assert/strict';
process.env.DEEPSEEK_API_KEY = 'test-only';
delete process.env.DEEPSEEK_SEARCH_MODEL;
delete process.env.OPENAI_API_KEY; // JSON 복구 경로(OpenAI)를 끈 채 원 응답 처리만 본다.
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only';
process.env.LANGSMITH_TRACING = 'false';
delete process.env.DEEPSEEK_CAPTURE_RAW;
const { createJsonResponse, anthropicToResponsesPayload, DEEPSEEK_ANTHROPIC_URL, DEEPSEEK_SEARCH_TOOL } = await import('../lib/llm-provider.js');

const logs = [];
const requests = [];
let anthropicContent = [];
let anthropicStop = 'end_turn';
let responsesOutput = [];
globalThis.fetch = async (url, options) => {
  if (url.includes('supabase.co')) { logs.push(JSON.parse(options.body)); return new Response(null, { status: 204 }); }
  requests.push({ url, headers: options.headers, body: JSON.parse(options.body) });
  if (url === DEEPSEEK_ANTHROPIC_URL) {
    return Response.json({ id: 'msg_1', type: 'message', role: 'assistant', model: 'deepseek-flash', content: anthropicContent, stop_reason: anthropicStop,
      usage: { input_tokens: 100, output_tokens: 25, server_tool_use: { web_search_requests: 2 } } });
  }
  return Response.json({ status: 'completed', output: responsesOutput, usage: { input_tokens: 100, output_tokens: 25 } });
};
const search = { provider: 'deepseek', webSearch: true, name: 'search_test', schema: { type: 'object', required: ['articles'], properties: { articles: { type: 'array' } } }, instructions: '리서처다.', input: '기사 후보를 찾아라' };
const toolUse = (query) => ({ type: 'server_tool_use', id: 'call_1', name: 'web_search', input: { query } });
const toolResult = (...urls) => ({ type: 'web_search_tool_result', tool_use_id: 'call_1', content: urls.map((url) => ({ type: 'web_search_result', url, title: 't', encrypted_content: 'x' })) });
const text = (value) => ({ type: 'text', text: value });

// 1) 응답 변환기: 블록 종류를 Responses 모양으로 옮긴다.
{
  const converted = anthropicToResponsesPayload({ id: 'm', model: 'deepseek-flash', stop_reason: 'max_tokens',
    content: [{ type: 'thinking', thinking: '...' }, text('검색을 실행하겠습니다.'), toolUse('宁德时代 最新'), toolResult('https://a.example/1', 'https://b.example/2'), text('```json\n{"articles":[]}\n```')] });
  assert.equal(converted.output.filter((item) => item.type === 'web_search_call').length, 1, 'server_tool_use 하나가 검색 호출 하나다');
  assert.deepEqual(converted.output[0].action.sources.map((s) => s.url), ['https://a.example/1', 'https://b.example/2'], '검색 결과 URL은 인용 대조용 sources로 간다');
  assert.equal(converted.output.at(-1).type, 'message', 'text 블록은 마지막 message로 모인다');
  assert.ok(!JSON.stringify(converted).includes('thinking'), 'thinking 블록은 버린다');
  assert.equal(converted.status, 'incomplete');
  assert.deepEqual(converted.incomplete_details, { reason: 'max_output_tokens' }, 'max_tokens로 잘린 응답을 구분한다');
}

// 2) 검색은 돌았는데 텍스트가 없다 → EMPTY_OUTPUT. usage는 로그에 남는다.
anthropicContent = [toolUse('q'), toolResult('https://a.example/1')];
await assert.rejects(createJsonResponse(search), /EMPTY_OUTPUT/);
assert.equal(logs.at(-1).status, 'failed');
assert.equal(logs.at(-1).payload.usage.input_tokens, 100);

// 3) 텍스트만 오고 검색 호출이 없다 → SEARCH_NOT_EXECUTED (학습 기억으로 만든 답을 버린다).
anthropicContent = [text('{"articles":[]}')];
await assert.rejects(createJsonResponse(search), /SEARCH_NOT_EXECUTED/);

// 4) 정상: 요청 계약과 결과.
const capturesBefore = logs.filter((row) => row.payload.kind === 'search_response_raw').length;
anthropicContent = [{ type: 'thinking', thinking: 'x' }, text('검색을 실행하겠습니다.'), toolUse('宁德时代 最新'), { ...toolUse('比亚迪 最新'), id: 'call_2' },
  toolResult('https://gg-lb.com/news/1', 'https://www.cbea.com/n/2'), text('검색 결과입니다.\n```json\n{"articles":[]}\n```\n끝.')];
const result = await createJsonResponse(search);
const request = requests.at(-1);
assert.equal(request.url, DEEPSEEK_ANTHROPIC_URL, 'DeepSeek 검색은 Anthropic 호환 엔드포인트로 간다');
assert.equal(request.headers['x-api-key'], 'test-only', '키는 x-api-key 헤더로 보낸다');
assert.equal(request.headers.Authorization, undefined, 'Bearer 헤더를 함께 보내지 않는다');
assert.equal(request.body.model, 'deepseek-flash', '검색 모델 기본값은 Anthropic 경로의 정식 ID다');
assert.deepEqual(request.body.tools, [{ ...DEEPSEEK_SEARCH_TOOL }], 'Anthropic 규격의 서버 측 web_search 도구를 보낸다');
assert.equal(request.body.tools[0].type, 'web_search_20250305');
assert.ok(request.body.max_tokens >= 4000, '추론·검색·JSON이 한 응답에 들어가므로 max_tokens를 넉넉히 준다(프로브는 1500에서 잘렸다)');
assert.ok(request.body.system.startsWith('리서처다.') && /JSON 객체 하나만 반환/.test(request.body.system), 'instructions는 system으로, JSON 전용 지시를 붙여 보낸다');
assert.deepEqual(request.body.messages, [{ role: 'user', content: '기사 후보를 찾아라' }]);
for (const key of ['text', 'tool_choice', 'reasoning', 'instructions', 'input', 'store']) assert.equal(request.body[key], undefined, `Responses 전용 필드 ${key}를 Anthropic 요청에 섞지 않는다`);
assert.deepEqual(result.data, { articles: [] }, '산문과 코드 펜스 사이의 JSON을 꺼낸다');
assert.equal(result.telemetry.search_calls, 2);
assert.equal(result.telemetry.incomplete, null);
assert.deepEqual(result.sourceUrls, ['https://gg-lb.com/news/1', 'https://www.cbea.com/n/2'], '검색 결과 URL이 인용 대조 목록이 된다');
assert.equal(logs.at(-1).status, 'ok');
assert.equal(logs.at(-1).payload.model, 'deepseek-flash');
assert.equal(logs.filter((row) => row.payload.kind === 'search_response_raw').length, capturesBefore, '성공한 검색은 원문을 저장하지 않는다');

// 5) max_tokens로 잘려도 JSON이 완결됐으면 받되 incomplete를 남긴다.
anthropicStop = 'max_tokens';
assert.deepEqual((await createJsonResponse(search)).telemetry.incomplete, { reason: 'max_output_tokens' });
anthropicStop = 'end_turn';

// 6) JSON이 아니면 INVALID_JSON_OUTPUT이고 원문을 저장한다(키는 들어가지 않는다).
anthropicContent = [toolUse('q'), toolResult('https://a.example/1'), text('宁德时代 https://example.com/news not JSON')];
await assert.rejects(createJsonResponse(search), /INVALID_JSON_OUTPUT/);
const capture = logs.filter((row) => row.payload.kind === 'search_response_raw').at(-1).payload;
assert.ok(capture.raw.includes('web_search_call'), '저장한 원문은 변환된 Responses 모양이다');
assert.equal(capture.raw.includes('test-only'), false);

// 7) 검색이 아닌 DeepSeek 호출은 그대로 Responses API다.
responsesOutput = [{ type: 'message', content: [{ type: 'output_text', text: '{"ok":true}' }] }];
await createJsonResponse({ provider: 'deepseek', webSearch: false, name: 'fact_check', schema: { type: 'object' }, instructions: 'i', input: 'x' });
const plain = requests.at(-1);
assert.equal(plain.url, 'https://api.deepseek.com/responses');
assert.equal(plain.headers.Authorization, 'Bearer test-only');
assert.equal(plain.body.model, 'deepseek-v4-flash', '일반 구조화 작업 모델은 그대로다');
assert.deepEqual(plain.body.reasoning, { effort: 'none' });
assert.equal(plain.body.text?.format?.type, 'json_schema', '검색이 아니면 strict schema를 유지한다');
assert.equal(plain.body.tools, undefined);

console.log('LLM search contract checks passed (no paid API calls)');
