import { COMPANIES, companyAliases } from "./china-sources.js";

const OFFICIAL_DISCOVERY = new Set(["cninfo", "catl_newsroom"]);

function corpus(article, supportingText = "") {
  const keywords = Array.isArray(article.keywords_ko) ? article.keywords_ko : [article.keywords_ko];
  return [article.title_original, article.title_ko, article.summary_ko, ...keywords, supportingText]
    .filter(Boolean).join(" \n");
}

function latinAliasMatch(text, alias) {
  const escaped = alias.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(text);
}

function mentions(text, alias) {
  const needle = String(alias || "").trim().toLowerCase();
  if (needle.length < 3) return false;
  return /^[a-z0-9 .&+\-]+$/i.test(needle) ? latinAliasMatch(text, needle) : text.includes(needle);
}

function companyTerms(company) {
  const koreanName = String(company.name_ko || "").replace(/\([^)]*\)/g, "").trim();
  return [...new Set([...companyAliases(company), company.name_zh, company.name_en, koreanName].filter(Boolean))];
}

function detectedCompanyIds(article, companies, supportingText = "") {
  const text = corpus(article, supportingText).toLowerCase();
  return companies.filter((company) => companyTerms(company).some((alias) => mentions(text, alias))).map((company) => company.id);
}

function articleTitle(article) {
  return article.title_ko || article.title_original || "제목 없음";
}

function baseIssue(article, values = {}) {
  return {
    article_id: article?.id || values.article_id || null,
    title: article ? articleTitle(article) : values.title || "연결된 기사를 찾을 수 없음",
    source_name: article?.source_name || values.source_name || null,
    source_url: article?.canonical_url || values.source_url || null,
    published_at: article?.published_at || values.published_at || null,
    linked_company_ids: values.linked_company_ids || [],
    detected_company_ids: values.detected_company_ids || [],
    affected_count: values.affected_count || 1,
  };
}

// 자동 감사 결과는 수정 명령이 아니라 사람이 원문을 확인할 검토 큐다.
export function buildDataAudit({ articles = [], chunks = [], events = [], companies = COMPANIES } = {}) {
  const issues = [];
  const articleMap = new Map(articles.map((article) => [article.id, article]));
  const linksByArticle = new Map(articles.map((article) => [article.id, new Set((article.article_company || []).map((link) => link.company_id))]));
  const bodyByArticle = new Map();
  for (const chunk of chunks) {
    // headline/event_fact에는 저장된 회사명이 템플릿으로 주입되므로 귀속 검증 근거로 쓰면 안 된다.
    if (!chunk.article_id || chunk.source_type !== "article_chunk") continue;
    const text = [chunk.content_ko, chunk.content_original, chunk.original_excerpt].filter(Boolean).join(" \n");
    if (text) bodyByArticle.set(chunk.article_id, `${bodyByArticle.get(chunk.article_id) || ""} ${text}`);
  }

  for (const article of articles) {
    const linked = [...(linksByArticle.get(article.id) || [])];
    const detected = detectedCompanyIds(article, companies, bodyByArticle.get(article.id));
    if (!linked.length) {
      issues.push({ ...baseIssue(article, { detected_company_ids: detected }), severity: "high", kind: "article_without_company", reason: "기사에 연결된 회사가 없습니다." });
      continue;
    }
    for (const companyId of linked) {
      if (detected.includes(companyId)) continue;
      const official = OFFICIAL_DISCOVERY.has(article.discovered_via) || String(article.source_tier || "").includes("official");
      const otherDetected = detected.filter((id) => id !== companyId);
      issues.push({
        ...baseIssue(article, { linked_company_ids: linked, detected_company_ids: otherDetected }),
        severity: otherDetected.length && linked.length === 1 && !official ? "high" : "review",
        kind: otherDetected.length ? "company_subject_mismatch" : "company_not_mentioned",
        record_company_id: companyId,
        reason: otherDetected.length
          ? "연결 회사명은 제목·요약에 없고 다른 추적 회사명이 발견됐습니다."
          : "연결 회사명이 제목·요약에 없어 원문 확인이 필요합니다.",
      });
    }
  }

  const grouped = new Map();
  function relationIssue(kind, row, reason) {
    const article = articleMap.get(row.article_id);
    const key = `${kind}:${row.article_id || "none"}:${row.company_id || "none"}`;
    const previous = grouped.get(key);
    if (previous) { previous.affected_count += 1; return; }
    grouped.set(key, {
      ...baseIssue(article, { article_id: row.article_id, source_name: row.source_name, source_url: row.source_url, published_at: row.published_at, linked_company_ids: [...(linksByArticle.get(row.article_id) || [])] }),
      severity: "high", kind, record_company_id: row.company_id || null, reason,
    });
  }

  for (const chunk of chunks) {
    if (!chunk.article_id) continue;
    if (!articleMap.has(chunk.article_id)) relationIssue("chunk_orphan_article", chunk, "청크가 존재하지 않는 기사를 참조합니다.");
    else if (chunk.company_id && !linksByArticle.get(chunk.article_id)?.has(chunk.company_id)) relationIssue("chunk_company_mismatch", chunk, "청크 회사와 기사 연결 회사가 다릅니다.");
  }
  for (const event of events) {
    if (!event.article_id) continue;
    if (!articleMap.has(event.article_id)) relationIssue("event_orphan_article", event, "이벤트가 존재하지 않는 기사를 참조합니다.");
    else if (event.company_id && !linksByArticle.get(event.article_id)?.has(event.company_id)) relationIssue("event_company_mismatch", event, "이벤트 회사와 기사 연결 회사가 다릅니다.");
  }
  issues.push(...grouped.values());

  const order = { high: 0, review: 1 };
  issues.sort((a, b) => (order[a.severity] - order[b.severity]) || String(b.published_at || "").localeCompare(String(a.published_at || "")));
  const byKind = issues.reduce((acc, issue) => ({ ...acc, [issue.kind]: (acc[issue.kind] || 0) + 1 }), {});
  return {
    generated_at: new Date().toISOString(),
    scanned: { articles: articles.length, events: events.length, chunks: chunks.length },
    counts: { total: issues.length, high: issues.filter((issue) => issue.severity === "high").length, review: issues.filter((issue) => issue.severity === "review").length, by_kind: byKind },
    issues,
  };
}
