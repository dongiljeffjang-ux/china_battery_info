import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../lib/headline-knowledge.js", import.meta.url), "utf8");
const titles = Number(source.match(/const TITLES_PER_CALL = (\d+);/)?.[1]);
const calls = Number(source.match(/const CALLS_PER_HOP = (\d+);/)?.[1]);

assert.ok(titles > 0 && titles <= 30, "headline translation batch must stay within the hop budget");
assert.equal(calls, 1, "headline translation must make at most one LLM call per hop");
console.log("headline hop budget regression checks passed");
