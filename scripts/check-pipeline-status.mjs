import assert from 'node:assert/strict';
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only';
const { logPipeline } = await import('../lib/pipeline-log.js');
const writes = [];
globalThis.fetch = async (_url, options) => {
  writes.push(JSON.parse(options.body));
  return new Response(null, { status: 204 });
};
await logPipeline('curate', { embed: { embedded: 3 }, embed_headline: { status: 'failed', error: '23514' } });
assert.equal(writes.at(-1).status, 'partial');
await logPipeline('collect', { raw: { openai: 4 }, failed: [{ source: 'deepseek' }] });
assert.equal(writes.at(-1).status, 'partial');
await logPipeline('curate', { embed: { embedded: 3 }, more: true });
assert.equal(writes.at(-1).status, 'ok');
await logPipeline('daily', { message: 'failed' }, { status: 'failed' });
assert.equal(writes.at(-1).status, 'failed');
console.log('pipeline status regression checks passed');
