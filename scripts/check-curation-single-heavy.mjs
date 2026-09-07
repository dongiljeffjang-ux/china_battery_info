import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../lib/curation.js", import.meta.url), "utf8");
const hopBody = source.slice(source.indexOf("export async function runCurationHop"));

assert.ok(hopBody.includes("const [taskName, runTask] = HEAVY_TASKS"), "curation hop must select one heavy task");
assert.ok(!hopBody.includes("log.digest = await digestCompany"), "digest must not run as a second heavy task in the same hop");
assert.ok(!hopBody.includes("log.web = await webBackfillCompany"), "web backfill must not run as a second heavy task in the same hop");
assert.ok(!hopBody.includes("log.enrich = [await enrichReport"), "report enrichment must not run as a second heavy task in the same hop");

console.log("curation single-heavy-task regression checks passed");
