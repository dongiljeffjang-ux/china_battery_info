import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../lib/headline-knowledge.js", import.meta.url), "utf8");
const titles = Number(source.match(/const TITLES_PER_CALL = (\d+);/)?.[1]);
const calls = Number(source.match(/const CALLS_PER_HOP = (\d+);/)?.[1]);

assert.ok(titles > 0 && titles <= 10, "headline translation batch must leave time for the next-hop handoff");
assert.equal(calls, 1, "headline translation must make at most one LLM call per hop");

const ingest = fs.readFileSync(new URL("../api/ingest-rss.js", import.meta.url), "utf8");
const curateBudget = Number(ingest.match(/const CURATE_BUDGET_MS = (\d+);/)?.[1]);
assert.ok(curateBudget > 0 && curateBudget <= 45000, "curation must reserve at least 15 seconds for logging and handoff");
console.log("headline hop budget regression checks passed");
