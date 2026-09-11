import assert from "node:assert/strict";
import { publishedDayInWindow } from "../lib/china-sources.js";
import { sourcePublishedDay, sourceDayWithinTolerance } from "../lib/source-published-at.js";
import { searchInstructions } from "../lib/china-sources.js";

const easpring = '<span class="date" data-article-publish-time="1662983256"></span>';
assert.equal(sourcePublishedDay(easpring), "2022-09-12", "界面新闻의 실제 발행 시각을 읽어야 한다");
assert.equal(sourcePublishedDay('<script type="application/ld+json">{"@type":"NewsArticle","datePublished":"2026-09-10T08:00:00+08:00"}</script>'), "2026-09-10");
assert.equal(sourcePublishedDay('<script type="application/ld+json">{"@type":"WebPage","datePublished":"2026-01-06"}</script>'), null, "목록·아카이브 페이지 갱신일을 기사 발행일로 쓰면 안 된다");
assert.equal(sourcePublishedDay('<meta property="article:published_time" content="2026-09-09T22:00:00Z">'), "2026-09-09");
assert.equal(sourcePublishedDay('<p>2022년 기사와 9월 9일 사건을 회고한다.</p>'), null, "본문의 일반 날짜를 발행일로 오인하면 안 된다");
assert.equal(sourceDayWithinTolerance("2026-09-08", "2026-09-10"), true, "일반 검색의 근접 날짜는 허용한다");
assert.equal(sourceDayWithinTolerance("2022-09-12", "2026-09-09"), false, "현재 연도로 둔갑한 과거 기사는 거부한다");

assert.equal(publishedDayInWindow("2026-09-09", "2026-09-08", "2026-09-11"), true);
assert.equal(publishedDayInWindow("2022-09-12", "2026-09-08", "2026-09-11"), false);
assert.equal(publishedDayInWindow(null, "2026-09-08", "2026-09-11"), false, "날짜 미상 기사를 오늘 기사로 치환하면 안 된다");
const prompt = searchInstructions("provider");
assert.match(prompt, /현재 연도를 붙이지 않는다/);
assert.match(prompt, /요청 기간 밖이면 반환하지 않/);
assert.match(prompt, /published_at을 null/);

console.log("source published date checks passed");
