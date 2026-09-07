import assert from "node:assert/strict";
import { ARTICLE_DATE_GUIDE, normalizeOccurredAt } from "../api/process-article.js";

assert.equal(normalizeOccurredAt("2026-09-07"), "2026-09-07");
assert.equal(normalizeOccurredAt("2026-09"), "2026-09-01");
assert.equal(normalizeOccurredAt("2026"), "2026-01-01");
assert.equal(normalizeOccurredAt("2026-02-30"), null);
assert.equal(normalizeOccurredAt("2026년 9월"), null);
assert.equal(normalizeOccurredAt(null), null);
assert.ok(ARTICLE_DATE_GUIDE.includes("YYYY-MM-DD"));

console.log("article date normalization checks passed");
