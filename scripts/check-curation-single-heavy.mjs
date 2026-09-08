import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../lib/curation.js", import.meta.url), "utf8");
const api = fs.readFileSync(new URL("../api/ingest-rss.js", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../app/app.js", import.meta.url), "utf8");
const hopBody = source.slice(source.indexOf("export async function runCurationHop"));

assert.ok(hopBody.includes("const [taskName, runTask] = HEAVY_TASKS"), "curation hop must select one heavy task");
assert.ok(!hopBody.includes("log.digest = await digestCompany"), "digest must not run as a second heavy task in the same hop");
assert.ok(!hopBody.includes("log.web = await webBackfillCompany"), "web backfill must not run as a second heavy task in the same hop");
assert.ok(!hopBody.includes("log.enrich = [await enrichReport"), "report enrichment must not run as a second heavy task in the same hop");
assert.ok(api.includes("runManualCurateStep(response, hop)"), "manual curation must expose one non-recursive hop");
assert.ok(app.includes("curate_step=1&task=renew&hop=${hop}"), "browser must orchestrate independent report-renewal hops");
const manualBody = app.slice(app.indexOf("async function runTimelineBackfill"), app.indexOf("async function runEmbedBackfill"));
assert.ok(!manualBody.includes("curate_run=1"), "manual backfill must not start a recursive server chain");

console.log("curation single-heavy-task regression checks passed");
