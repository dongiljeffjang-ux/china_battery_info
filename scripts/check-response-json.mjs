import assert from 'node:assert/strict';
import { responseOutputText } from '../lib/llm-provider.js';
const message = (text) => ({ type: 'message', content: [{ type: 'output_text', text }] });
const payload = { output: [message('검색 결과를 확인하겠습니다.'), { type: 'web_search_call' }, message('```json\n{"articles":[]}\n```')] };
assert.deepEqual(JSON.parse(responseOutputText(payload)), { articles: [] });
assert.equal(responseOutputText({ output: [message('before'), message('{"ok":true}')] }), '{"ok":true}');
assert.equal(responseOutputText({ output: [] }), '');
console.log('response JSON regression passed');
