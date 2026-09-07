import assert from "node:assert/strict";
import fs from "node:fs";

// 사실 한 건이 원문 여기저기의 수치를 모으면 그 건의 발췌로는 일부밖에 뒷받침하지 못한다.
// 2026-09-07 점검: 수치 7개 이상을 담은 건의 90.8%가 발췌에 없는 수치를 갖고 있었다(1개면 22.7%).
// 추출 단위를 "같은 문장에서 나온 수치"로 묶는 규칙과, 그로 인해 늘어난 건수를 받아 줄 상한을 고정한다.
const backfill = fs.readFileSync(new URL("../lib/event-backfill.js", import.meta.url), "utf8");
const article = fs.readFileSync(new URL("../api/process-article.js", import.meta.url), "utf8");
const curation = fs.readFileSync(new URL("../lib/curation.js", import.meta.url), "utf8");

const digest = backfill.slice(backfill.indexOf("const DIGEST_INSTRUCTIONS"), backfill.indexOf("const DIGEST_CHUNK_CHARS"));
assert.ok(digest.includes("같은 표의 같은 행에서 나온 수치만 담는다"), "보고서 추출은 한 건의 수치 출처를 한 문장·한 행으로 묶어야 한다");
assert.ok(digest.includes("별개 건으로 낸다"), "떨어져 있는 수치는 별개 건으로 나누라고 지시해야 한다");
assert.ok(/fact_ko에 쓴 수치는 하나도 빠짐없이 이 발췌 안에/.test(digest), "발췌가 그 건의 모든 수치를 담도록 지시해야 한다");

const web = backfill.slice(backfill.indexOf("const INSTRUCTIONS"), backfill.indexOf("const DIGEST_INSTRUCTIONS"));
assert.ok(web.includes("같은 문단에서 나온 수치만 담는다"), "웹 백필도 같은 단위 규칙을 써야 한다");

assert.ok(article.includes("event_fact_ko에 쓴 수치는 하나도 빠짐없이 이 발췌 안에 있어야 한다"), "기사 추출도 발췌가 수치를 모두 담도록 해야 한다");

// 쪼갠 만큼 건수가 늘어난다. 상한이 그대로면 뒤쪽 사실이 잘려 나간다.
const cap = Number(curation.match(/const DIGEST_MAX_EVENTS = (\d+);/)?.[1]);
assert.ok(cap >= 24, `청크당 사실 상한이 너무 낮다(${cap}). 쪼갠 사실이 잘린다`);

console.log("fact granularity checks passed");
