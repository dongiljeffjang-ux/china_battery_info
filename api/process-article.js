import { hasDatabaseConfig, supabaseRest } from "../lib/supabase.js";
import { flushTraces } from "../lib/tracing.js";
import { resolveGoogleNewsUrl } from "../lib/google-news.js";
import { createJsonResponse, llmConfig } from "../lib/llm-provider.js";
import { COMPANIES } from "../lib/china-sources.js";
import { groupSummary, matchGroupEntities } from "../lib/company-groups.js";
import { embedVerifiedArticle, embedEvents } from "../lib/vector-ingestion.js";
import { LAYER_ENUM, LAYER_PROMPT_GUIDE, normalizeLayerKey } from "../lib/timeline-layers.js";
import { sameFact } from "../lib/curation.js";
import { extractPdfText } from "../lib/report-reader.js";

const MAX_BODY_CHARS = 30000;

// 사건 시점은 기사 발행일이 아니다. 2026-09-04 大众日报 특집이 2026-03-05 발표된 비야디 2세대
// 블레이드 배터리를 소개했는데, 발행일이 그대로 사건 시점으로 들어가 시계열이 6개월 어긋났다.
// 기사 본문이 시점을 적지 않으면 그 사실을 남기고(occurred_basis=null) 뒤의 웹 검색 재확인 단계가 잡는다.
const DATE_PROMPT_GUIDE = "occurred_at은 그 사실이 실제로 일어난(발표·체결·가동·출시된) 시점이지 기사 발행일이 아니다. 본문에 시점이 적혀 있으면(예: 3月5日, 今年上半年, 去年, 2025年) 그 시점을 쓰고, occurred_basis에 그 근거 문장을 원문 그대로 짧게 인용하며, occurred_precision에 확인된 정밀도(day/month/half/year)를 쓴다. 본문에 시점이 없으면 occurred_at에 발행일을 쓰되 occurred_precision은 month로, occurred_basis는 null로 둔다. 발행일을 근거로 지어 적지 않는다. retrospective는 이 기사가 새 소식이 아니라 이미 발표된 사실을 다시 소개·회고하는 글(특집·회객청·전문가 대담·기업 소개, 此前·曾·早在·回顾 같은 표현)이면 true다. retrospective가 true이고 본문에 발표 시점이 없으면 occurred_at에 발행일을 쓰되 occurred_precision을 year로 두어 시점이 불확실함을 표시한다.";

function isAuthorized(request) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret && request.headers.authorization === `Bearer ${secret}`);
}

function addDays(dateStr, days) {
  const date = new Date(`${String(dateStr).slice(0, 10)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

async function analyzeArticle(article, bodyText, provider, companyContext = "") {
  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["title_ko", "summary_ko", "keywords_ko", "headline_signals", "event_title_ko", "event_fact_ko", "original_excerpt", "original_excerpt_ko", "occurred_at", "occurred_precision", "occurred_basis", "retrospective", "trajectory_track", "layer_key", "region_scope", "timeline_eligibility", "confidence_note"],
    properties: {
      title_ko: { type: "string" },
      keywords_ko: { type: "array", minItems: 1, maxItems: 3, items: { type: "string" } },
      headline_signals: {
        type: "array", minItems: 1, maxItems: 3,
        items: {
          type: "object", additionalProperties: false,
          required: ["keyword_ko", "direction", "reason_ko"],
          properties: {
            keyword_ko: { type: "string" },
            direction: { type: "string", enum: ["expansion", "contraction", "neutral"] },
            reason_ko: { type: "string" }
          }
        }
      },
      summary_ko: { type: "string" },
      event_title_ko: { type: "string" },
      event_fact_ko: { type: "string" },
      original_excerpt: { type: "string" },
      original_excerpt_ko: { type: "string" },
      occurred_at: { type: ["string", "null"] },
      occurred_precision: { type: "string", enum: ["day", "month", "half", "year"] },
      occurred_basis: { type: ["string", "null"] },
      retrospective: { type: "boolean" },
      trajectory_track: { type: "string", enum: ["market", "technology"] },
      layer_key: { type: "string", enum: LAYER_ENUM },
      region_scope: { type: ["string", "null"] },
      timeline_eligibility: { type: "string", enum: ["core", "reference", "exclude"] },
      confidence_note: { type: "string" }
    }
  };
  const disclosureNote = article.source_tier === "official_disclosure"
    ? "\n\n이 문서는 거래소에 제출된 회사의 공식 공시 원문이다. 제3자 언론 보도가 아니므로 본문에 적힌 사실은 timeline_eligibility를 core로 둘 수 있다."
    : "";
  const input = `${companyContext}\n원문 제목: ${article.title_original}\n발행일: ${article.published_at || "미상"}\n매체: ${article.source_name}${disclosureNote}\n본문:\n${bodyText}`;
  const { data } = await createJsonResponse({
    name: "battery_article_event", schema,
    instructions: DATE_PROMPT_GUIDE + " 중국 배터리 산업 기사에서 출처에 명시된 사실만 한국어로 구조화한다. 전망·인과 추정·성공 가능성을 만들지 않는다. summary_ko는 서술형 문단이 아니라 개조식으로 쓴다: 확인된 사실 하나당 '- '로 시작하는 한 줄을 만들고, 각 줄은 명사형으로 끝내며 회사명과 핵심 수치를 앞에 둔다(예: '- CATL, 헝가리 1공장 1기 라인 가동 개시 - 연 40GWh'). 접속사·수식어 없이 사실만 나열하고 2~4줄로 쓴다. title_ko는 기사 자체의 주제를 그대로 쓴다. 기사가 여러 회사를 함께 다루거나 정책·산업 전반을 다루면 특정 회사 관점으로 좁히지 않는다(예: 여러 업체의 진척을 곁들인 정책 기사는 ‘중국, 전고체 배터리 정의·과세 기준 마련’). 한 회사만 다루는 기사일 때만 그 회사를 제목의 주어로 쓴다. 기사에 회사가 여럿 나오면 summary_ko에 회사마다 한 줄씩 담아, 어느 회사로 이 기사를 보더라도 그 회사 사실이 보이게 한다. 반면 event_title_ko와 event_fact_ko는 시계열에 넣을 한 건이므로 제공된 ‘서비스 표준 회사명’ 회사의 사실만 쓴다. 제공된 ‘서비스 표준 회사명’이 본문 주체와 일치하면 title_ko, summary_ko, event_title_ko, event_fact_ko에서 그 한국어 표준명을 반드시 사용한다. 원문 중국어·영어 법인명과 한국어 표준명을 섞어 새 이름을 만들지 않는다. keywords_ko에는 회사명 대신 사건을 대표하는 짧은 한국어 핵심 키워드 1~3개만 넣는다(예: 증설, 고객 인증, 실리콘 음극, 해외 생산). headline_signals는 이 기사가 산업의 무엇을 확대(expansion) 또는 축소(contraction)시키는 신호인지 신호별로 판단한 것이다. keyword_ko에는 회사명·기관명·부처명·매체명·일반 산업명을 쓰지 않는다(예: 공업정보화부, 리튬전지 산업, 출하량 순위는 신호가 아니다). 생산능력·출하·수주·고객·가격·투자·기술 같은 실제로 늘거나 주는 대상을 쓴다. direction은 본문에 적힌 사실을 근거로 정하고, 판단 근거가 약하면 neutral을 쓴다. reason_ko에는 왜 그 방향인지 본문 사실을 들어 한 문장으로 쓴다. 단일 제3자 언론 기사만으로는 timeline_eligibility를 core로 두지 않는다. original_excerpt에는 핵심 근거 원문을 300자 이내로만 발췌하고, original_excerpt_ko에는 그 발췌문의 충실한 한국어 번역만 쓴다. " + LAYER_PROMPT_GUIDE,
    input, provider
  });
  return data;
}

async function factCheckArticle(article, bodyText, analysis, provider, companyContext = "") {
  const schema = {
    type: "object", additionalProperties: false, required: ["verdict", "title_ko", "summary_ko", "keywords_ko", "headline_signals", "original_excerpt", "original_excerpt_ko", "reason_ko"],
    properties: {
      verdict: { type: "string", enum: ["pass", "reject"] }, title_ko: { type: "string" }, summary_ko: { type: "string" },
      keywords_ko: { type: "array", minItems: 1, maxItems: 3, items: { type: "string" } },
      headline_signals: {
        type: "array", minItems: 1, maxItems: 3,
        items: {
          type: "object", additionalProperties: false,
          required: ["keyword_ko", "direction", "reason_ko"],
          properties: {
            keyword_ko: { type: "string" },
            direction: { type: "string", enum: ["expansion", "contraction", "neutral"] },
            reason_ko: { type: "string" }
          }
        }
      },
      original_excerpt: { type: "string" }, original_excerpt_ko: { type: "string" }, reason_ko: { type: "string" }
    }
  };
  const { data } = await createJsonResponse({
    name: "battery_article_fact_check", schema,
    instructions: "당신은 독립적인 사실 검증자다. 기사 본문만 증거로 사용한다. 제시된 1차 요약의 각 사실이 본문에 직접 있는지 대조한다. 추정·평가·인과관계·본문에 없는 수치·주체가 있으면 reject한다. pass일 때도 본문에서 확인되는 사실만 남긴 더 보수적인 한국어 제목·요약·키워드·300자 이내 원문 발췌 및 번역을 다시 작성한다. summary_ko는 서술형 문단이 아니라 개조식으로 쓴다: 본문에서 확인되는 사실 하나당 '- '로 시작하는 한 줄을 만들고, 각 줄은 명사형으로 끝내며 회사명과 핵심 수치를 앞에 둔다. 접속사·수식어 없이 사실만 나열하고 2~4줄로 쓴다. title_ko는 기사 자체의 주제를 따른다. 여러 회사를 함께 다루거나 정책·산업 전반을 다루는 기사를 특정 회사 관점으로 좁히지 않으며, 초안이 그렇게 좁혀 놓았으면 기사 주제에 맞게 고친다. 기사에 회사가 여럿 나오면 summary_ko에 회사마다 한 줄씩 남긴다. 제공된 서비스 표준 회사명과 본문 주체가 일치하면 한국어 제목·요약에서 반드시 그 표준명을 유지한다. 키워드에는 회사명을 넣지 않는다. headline_signals도 본문에서 확인되는 사실만 남기고 다시 작성한다. 회사명·기관명·부처명·일반 산업명은 신호가 아니므로 넣지 않으며, 본문 근거가 약한 항목은 direction을 neutral로 낮춘다. reason_ko는 본문에 있는 사실만으로 쓴다.",
    input: `${companyContext}\n기사 제목: ${article.title_original}\n본문:\n${bodyText}\n\n1차 분석 결과:\n${JSON.stringify(analysis)}`,
    provider
  });
  return data;
}

// 본문 처리 결과를 기사에 남긴다. 실행 직후 응답에만 있던 실패 사유를 나중에도 볼 수 있게 하고,
// "시도했다 실패"와 "아직 시도한 적 없음"을 구분하기 위함이다. 기록 실패가 처리 실패가 되면 안 된다.
export async function recordProcessing(articleId, status, note = null) {
  try {
    await supabaseRest(`article?id=eq.${encodeURIComponent(articleId)}`, {
      method: "PATCH",
      body: { processing_status: status, processing_note: note ? String(note).slice(0, 500) : null, processed_at: new Date().toISOString() }
    });
  } catch (error) {
    console.error("[PROCESSING_RECORD_FAILED]", JSON.stringify({ articleId, status, message: error.message }));
  }
}

export async function processPendingArticle(articleId, companyId) {
  const articles = await supabaseRest(`article?select=id,canonical_url,title_original,source_name,published_at,source_tier&id=eq.${encodeURIComponent(articleId)}&verification_status=eq.pending&limit=1`);
  const article = articles[0];
  if (!article) return { status: "not_pending" };
  const resolvedUrl = await resolveGoogleNewsUrl(article.canonical_url);
  // 거래소 공시는 HTML이 아니라 PDF다. 정기보고서에서 쓰는 추출기를 그대로 재사용한다.
  const isDisclosure = article.source_tier === "official_disclosure" || /\.pdf($|\?)/i.test(resolvedUrl);
  let bodyText;
  if (isDisclosure) {
    try {
      bodyText = String(await extractPdfText(resolvedUrl)).slice(0, MAX_BODY_CHARS);
    } catch (error) {
      await recordProcessing(articleId, "body_unavailable", `PDF 추출 실패: ${error.message} · ${resolvedUrl}`);
      return { status: "body_unavailable", reason: "pdf_extract_failed" };
    }
  } else {
    const sourceResponse = await fetch(resolvedUrl, { headers: { "User-Agent": "Mozilla/5.0 (compatible; ChinaBatteryLens/0.1; research)" } });
    const contentType = sourceResponse.headers.get("content-type") || "";
    if (!sourceResponse.ok || !contentType.includes("text/html")) {
      await recordProcessing(articleId, "body_unavailable", `HTTP ${sourceResponse.status} · content-type: ${contentType || "없음"} · ${resolvedUrl}`);
      return { status: "body_unavailable", contentType };
    }
    bodyText = htmlToText(await sourceResponse.text()).slice(0, MAX_BODY_CHARS);
  }
  if (bodyText.length < 500) {
    await recordProcessing(articleId, "body_too_short", `본문 ${bodyText.length}자로 최소 500자에 못 미침 · ${resolvedUrl}`);
    return { status: "body_too_short" };
  }
  await supabaseRest(`article?id=eq.${encodeURIComponent(articleId)}`, {
    method: "PATCH", body: { body_original: bodyText, body_fetched_at: new Date().toISOString(), embedding_status: "pending", updated_at: new Date().toISOString() }
  });

  const primaryProvider = llmConfig("openai") ? "openai" : "deepseek";
  const verifierProvider = llmConfig("deepseek") ? "deepseek" : primaryProvider;
  const company = COMPANIES.find((item) => item.id === companyId);
  const group = company ? groupSummary(company.id) : null;
  const companyContext = company ? `서비스 표준 회사명: ${company.name_ko}${group ? `
그룹: ${group.name_ko}
그룹 포함 검색 법인: ${group.members_ko.join(", ")}` : ""}` : "";
  const result = await analyzeArticle(article, bodyText, primaryProvider, companyContext);
  const factCheck = await factCheckArticle(article, bodyText, result, verifierProvider, companyContext);
  console.info("[ARTICLE_CROSS_CHECK]", JSON.stringify({ articleId, primaryProvider, verifierProvider, verdict: factCheck.verdict }));
  if (factCheck.verdict !== "pass") {
    // 기각은 종착점이다. 언론 기사 원문을 여기서 지우지 않으면 영구히 남는다.
    // 2026-09-07에 기각된 기사 7건의 중국어 전문이 그대로 남아 있는 것을 확인했다.
    // 공시는 공개 자료라 보관 정책이 다르므로 그대로 둔다.
    await supabaseRest(`article?id=eq.${encodeURIComponent(articleId)}`, { method: "PATCH", body: { verification_status: "rejected", source_tier: "fact_check_rejected", processing_status: "fact_check_rejected", processing_note: String(factCheck.reason_ko || "").slice(0, 500) || null, processed_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...(isDisclosure ? {} : { body_original: null }) } });
    return { status: "fact_check_rejected", reason: factCheck.reason_ko };
  }
  await supabaseRest(`article?id=eq.${encodeURIComponent(articleId)}`, {
    method: "PATCH",
    body: { title_ko: factCheck.title_ko, summary_ko: factCheck.summary_ko, keywords_ko: factCheck.keywords_ko, headline_signals: factCheck.headline_signals || result.headline_signals || [], verification_status: "pending_review", source_tier: `${primaryProvider}_${verifierProvider}_fact_checked`, processing_status: "ok", processing_note: null, processed_at: new Date().toISOString(), updated_at: new Date().toISOString() }
  });
  let embedding = { status: "skipped", chunks: 0 };
  try {
    embedding = await embedVerifiedArticle({
      article: { ...article, company_name_ko: company?.name_ko }, companyId, bodyText, titleKo: factCheck.title_ko, summaryKo: factCheck.summary_ko,
      sourceUrl: resolvedUrl, sourceName: article.source_name, publishedAt: article.published_at,
      // 거래소 공시는 공개 자료라 원문을 남기고, 언론 기사는 한국어 요약만 남긴다.
      keepOriginal: isDisclosure,
    });
  } catch (error) {
    console.error("[ARTICLE_EMBEDDING_FAILED]", JSON.stringify({ articleId, message: error.message }));
    await supabaseRest(`article?id=eq.${encodeURIComponent(articleId)}`, {
      method: "PATCH", body: { embedding_status: "failed", updated_at: new Date().toISOString() }
    });
    embedding = { status: "failed", chunks: 0 };
  }
  if (result.timeline_eligibility !== "exclude" && result.occurred_at) {
    // 발생 법인은 등록된 계열사 별칭 매칭으로만 정한다. 본문 전체가 아니라 이벤트 문장과
    // 근거 발췌만 대조해 각주·목록에 스치듯 나온 계열사가 섞이지 않게 한다.
    const entityNames = matchGroupEntities(companyId, [
      article.title_original, result.event_title_ko, result.event_fact_ko, factCheck.original_excerpt
    ].filter(Boolean).join(" "));
    const candidate = { occurred_at: result.occurred_at, title_ko: result.event_title_ko, fact_ko: result.event_fact_ko };
    // 여러 매체가 같은 사건을 보도하면 거의 같은 이벤트가 겹쳐 쌓인다. 같은 회사에서 인접 시점의
    // 기존 이벤트와 같은 사실이면 새로 넣지 않는다(매체만 다른 중복 방지).
    const nearby = await supabaseRest(`event?select=occurred_at,title_ko,fact_ko&company_id=eq.${encodeURIComponent(companyId)}&occurred_at=gte.${addDays(result.occurred_at, -3)}&occurred_at=lte.${addDays(result.occurred_at, 3)}`);
    if ((nearby || []).some((prev) => sameFact(prev, candidate))) {
      console.info("[EVENT_DUP_SKIPPED]", JSON.stringify({ articleId, companyId, title: result.event_title_ko }));
      return { status: "pending_review", analysis: result, fact_check: factCheck, embedding, duplicate: true, primary_provider: primaryProvider, verifier_provider: verifierProvider };
    }
    // 이벤트는 만들어지는 즉시 벡터 검색 대상이 돼야 한다. 크론이나 버튼을 기다리게 하지 않는다.
    // 임베딩 실패는 이벤트 적재를 되돌리지 않는다. 남은 것은 임베딩 크론이 채운다.
    const storedEvents = await supabaseRest("event", { method: "POST", prefer: "return=representation", body: {
      entity_names: entityNames,
      company_id: companyId, article_id: articleId, occurred_at: result.occurred_at,
      // 본문이 시점을 말하지 않은 이벤트는 basis가 null로 남아 웹 검색 재확인 큐에 들어간다.
      occurred_precision: ["day", "month", "half", "year"].includes(result.occurred_precision) ? result.occurred_precision : "month",
      occurred_basis: result.occurred_basis ? String(result.occurred_basis).slice(0, 300) : null,
      title_ko: result.event_title_ko, fact_ko: result.event_fact_ko,
      // layer_key 소속에 맞춰 트랙을 맞춘다. 시장 레이어인데 기술로 들어가는 어긋남을 막는다.
      trajectory_track: normalizeLayerKey(result.layer_key)?.startsWith("technology-") ? "technology"
        : normalizeLayerKey(result.layer_key) ? "market"
        : (result.trajectory_track === "technology" ? "technology" : "market"),
      layer_key: normalizeLayerKey(result.layer_key),
      region_scope: result.region_scope, source_url: resolvedUrl, source_name: article.source_name,
      original_excerpt: factCheck.original_excerpt, original_excerpt_ko: factCheck.original_excerpt_ko,
      // 거래소 공시는 회사가 직접 낸 1차 출처다. 언론 기사와 등급·출처 표기를 구분한다.
      evidence_kind: isDisclosure ? "disclosure" : "article",
      timeline_eligibility: isDisclosure ? "core" : result.timeline_eligibility
    } });
    try {
      await embedEvents((storedEvents || []).map((row) => ({ ...row, company_name_ko: company?.name_ko || companyId })));
    } catch (error) {
      console.error("[EVENT_EMBEDDING_FAILED]", JSON.stringify({ articleId, message: error.message }));
    }
  }
  return { status: "pending_review", analysis: result, fact_check: factCheck, embedding, primary_provider: primaryProvider, verifier_provider: verifierProvider };
}

export default async function handler(request, response) {
  if (request.method !== "POST") return response.status(405).json({ status: "method_not_allowed" });
  if (!isAuthorized(request)) return response.status(401).json({ status: "unauthorized" });
  if (!hasDatabaseConfig()) return response.status(503).json({ status: "db_not_configured" });

  const articleId = String(request.body?.articleId || "").trim();
  const companyId = String(request.body?.companyId || "").trim();
  if (!articleId || !companyId) return response.status(400).json({ status: "invalid_request", message: "articleId and companyId are required." });

  try {
    const result = await processPendingArticle(articleId, companyId);
    return response.status(result.status === "pending_review" ? 200 : 422).json(result);
  } catch (error) {
    return response.status(502).json({ status: "processing_failed", message: error.message });
  } finally {
    // 서버리스 함수는 응답 직후 종료돼 배경 전송이 유실된다. 끝나기 전에 반드시 보낸다.
    await flushTraces();
  }
}
