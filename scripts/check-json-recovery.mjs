import assert from 'node:assert/strict';
import { parseResponseJson, validateSearchData } from '../lib/json-recovery.js';
assert.deepEqual(parseResponseJson('설명\n```json\n{"x":"escaped \\\" }", "a":[1]}\n```'), { x: 'escaped " }', a: [1] });
assert.throws(() => parseResponseJson('{} {}'));
assert.throws(() => parseResponseJson('{"x":'));
const schema = {type:'object',required:['articles'],additionalProperties:false,properties:{articles:{type:'array',maxItems:2,items:{type:'object',required:['url'],properties:{url:{type:'string'}}}}}};
assert.throws(() => validateSearchData({articles:[{url:'javascript:alert(1)'}]},schema));
assert.throws(() => validateSearchData({articles:'bad'},schema));
process.env.DEEPSEEK_API_KEY='test'; process.env.OPENAI_API_KEY='test'; process.env.OPENAI_MODEL='test';
process.env.LANGSMITH_TRACING='false';
const {createJsonResponse}=await import('../lib/llm-provider.js');
let calls=[], invented=false, broken=false;
globalThis.fetch=async (url,options)=>{
  const body=JSON.parse(options.body); calls.push(body);
  const deep=url.includes('deepseek');
  // DeepSeek 검색은 Anthropic 호환 경로라 응답도 그 모양이다(2026-09-14). 검색은 돌았지만 최종 텍스트가 JSON이 아닌 경우.
  if (deep) return Response.json({type:'message',stop_reason:'end_turn',content:[
    {type:'server_tool_use',id:'c1',name:'web_search',input:{query:'CATL'}},
    {type:'web_search_tool_result',tool_use_id:'c1',content:[{type:'web_search_result',url:'https://example.com/news'}]},
    {type:'text',text:'기사 링크 https://example.com/news'}]});
  const text=broken?'still not JSON':JSON.stringify({articles:[{url:invented?'https://invented.com/':'https://example.com/news'}]});
  return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text}]}]});
};
const opts={provider:'deepseek',webSearch:true,name:'test',schema,input:'CATL'};
const result=await createJsonResponse(opts);
assert.equal(result.telemetry.recovery,'openai_format_only');
assert.equal(calls.length,2); assert.equal(calls[1].tools,undefined);
invented=true; calls=[];
await assert.rejects(createJsonResponse(opts),/JSON_RECOVERY_FAILED/); assert.equal(calls.length,2);
broken=true; calls=[];
await assert.rejects(createJsonResponse(opts),/JSON_RECOVERY_FAILED/); assert.equal(calls.length,2);
console.log('JSON extraction, validation, one-shot fallback, invented URL rejection passed (no paid requests)');
