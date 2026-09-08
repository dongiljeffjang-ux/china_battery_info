import assert from "node:assert/strict";
import fs from "node:fs";

const admin = fs.readFileSync(new URL("../api/admin.js", import.meta.url), "utf8");
const backfill = fs.readFileSync(new URL("../lib/event-backfill.js", import.meta.url), "utf8");
const provider = fs.readFileSync(new URL("../lib/llm-provider.js", import.meta.url), "utf8");
const adminHtml = fs.readFileSync(new URL("../app/admin.html", import.meta.url), "utf8");
const adminApp = fs.readFileSync(new URL("../app/admin.js", import.meta.url), "utf8");

assert.ok(admin.includes('"probe-digest": probeDigest'), "관리자 API에 보호된 dry-run 경로가 있어야 한다");
for (const preset of ["wanrun-2026h1", "xtc-2024h1", "farasis-2026h1", "minmetals-2024h1", "zhenhua-2024h1"]) {
  assert.ok(admin.includes(`"${preset}"`), `${preset} 진단 대상 보고서는 고정해야 한다`);
}
assert.ok(admin.includes("diagnostic: true"), "dry-run은 진단 모드여야 한다");
const probe = admin.slice(admin.indexOf("async function probeDigest"), admin.indexOf("// 파이프라인 명세"));
assert.ok(!/query\.url/.test(probe), "사용자 URL을 내려받으면 안 된다");
assert.ok(backfill.includes("timeoutMs, diagnostic = false"), "digestReport가 진단 모드를 받아야 한다");
assert.ok(backfill.includes("skipTelemetry: diagnostic"), "진단 호출은 텔레메트리를 끄어야 한다");
assert.ok(provider.includes("if (options.skipTelemetry) return callJsonResponse(options);"), "진단 호출은 외부 추적을 남기면 안 된다");
assert.ok(provider.includes("const log = (...args) => skipTelemetry ? Promise.resolve() : logPipeline(...args);"), "진단 호출은 pipeline_log에 쓰면 안 된다");
assert.ok(adminHtml.includes('id="probe-load"') && adminHtml.includes('id="probe-report"'), "관리자 화면에서 고정 dry-run을 실행할 수 있어야 한다");
assert.ok(adminApp.includes("async function loadProbeDigest()") && adminApp.includes("view: 'probe-digest'"), "관리자 화면은 보호된 진단 API만 호출해야 한다");
assert.ok(adminApp.includes("근거 불일치") && adminApp.includes("텍스트 밖 수치는 저장 안 함"), "관리자 화면은 근거 차단과 이미지 한계를 보여야 한다");
assert.ok(probe.includes("parse_quality") && probe.includes("visual_pages"), "dry-run이 이미지 검토 상태를 돌려줘야 한다");
console.log("probe digest endpoint checks passed");
