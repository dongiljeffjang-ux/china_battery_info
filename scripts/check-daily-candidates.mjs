// Daily 후보 창: 수동 재실행이 직전 Daily를 얇은 리포트로 덮지 않게 한다(2026-09-11 사례). 네트워크 없이 돈다.
import assert from "node:assert/strict";
import fs from "node:fs";
import { mergeDailyCandidates } from "../api/generate-daily.js";

const a = { id: "a", title_ko: "새 기사" }, b = { id: "b", title_ko: "직전 Top 10" }, a2 = { id: "a", title_ko: "중복" };
assert.deepEqual(mergeDailyCandidates([a], [a2, b], null).map(row => row.id), ["a", "b"], "갈래가 겹쳐도 기사는 한 번만 후보가 된다");

const source = fs.readFileSync(new URL("../api/generate-daily.js", import.meta.url), "utf8");
assert.match(source, /is_top10=eq\.true&limit=10/, "직전 Daily의 Top 10을 후보로 이어받는다");
assert.ok(source.indexOf("is_top10=eq.true&limit=10") < source.indexOf('supabaseRest("article?is_top10=eq.true", { method: "PATCH"'), "Top 10 표시를 지우기 전에 이어받을 기사를 읽는다");
assert.match(source, /processed_at=gte\./, "직전 Daily 이후 검증된 기사는 발행일과 무관하게 후보가 된다");
assert.match(source, /let windowDays = 2;/, "기본 창은 어제·오늘");
assert.match(source, /if \(!selected\.length\) return \{ status: "no_selection"/, "아무것도 못 고르면 직전 Daily를 지우지 않는다");
assert.doesNotMatch(source, /koreaDayBounds/, "리포트 날짜 하루치로 후보를 끊지 않는다");

console.log("daily candidate checks passed");
