import { hasDatabaseConfig, supabaseRest } from "../lib/supabase.js";
import { flushTraces } from "../lib/tracing.js";
import { resolveGoogleNewsUrl } from "../lib/google-news.js";
import { createJsonResponse, llmConfig } from "../lib/llm-provider.js";
import { COMPANIES, POLICY_COMPANY, POLICY_COMPANY_ID } from "../lib/china-sources.js";
import { groupSummary, matchGroupEntities } from "../lib/company-groups.js";
import { embedVerifiedArticle, embedEvents } from "../lib/vector-ingestion.js";
import { LAYER_ENUM, LAYER_PROMPT_GUIDE, normalizeLayerKey } from "../lib/timeline-layers.js";
import { sameFact } from "../lib/curation.js";
import { extractPdfText } from "../lib/report-reader.js";
import { checkRobots, waitForHostSlot, CRAWLER_UA } from "../lib/robots.js";
import { sourcePublishedDay, sourceDayWithinTolerance } from "../lib/source-published-at.js";
import { SIGNAL_SUBJECT_PROPERTIES, SIGNAL_SUBJECT_RULE, attachSubjects, linkedCompanyLines } from "../lib/signal-subjects.js";

const MAX_BODY_CHARS = 30000;
export const ARTICLE_ANALYSIS_PROMPT_BODY = " 중국 배터리 산업 기사에서 출처에 명시된 사실만 한국어로 구조화한다. 전망·인과 추정·성공 가능성을 만들지 않는다. summary_ko는 서술형 문단이 아니라 개조식으로 쓴다: 확인된 사실 하나당 '- '로 시작하는 한 줄을 만들고, 각 줄은 명사형으로 끝내며 회사명과 핵심 수치를 앞에 둔다(예: '- CATL, 헝가리 1공장 1기 라인 가동 개시 - 연 40GWh'). 접속사·수식어 없이 사실만 나열하고 2~4줄로 쓴다. title_ko는 기사 자체의 주제를 그대로 쓴다. 기사가 여러 회사를 함께 다루거나 정책·산업 전반을 다루면 특정 회사 관점으로 좁히지 않는다(예: 여러 업체의 진척을 곁들인 정책 기사는 ‘중국, 전고체 배터리 정의·과세 기준 마련’). 한 회사만 다루는 기사일 때만 그 회사를 제목의 주어로 쓴다. 기사에 회사가 여럿 나오면 summary_ko에 회사마다 한 줄씩 담아, 어느 회사로 이 기사를 보더라도 그 회사 사실이 보이게 한다. 반면 event_title_ko와 event_fact_ko는 시계열에 넣을 한 건이므로 제공된 ‘서비스 표준 회사명’ 회사의 사실만 쓴다. 제공된 ‘서비스 표준 회사명’이 본문 주체와 일치하면 title_ko, summary_ko, event_title_ko, event_fact_ko에서 그 한국어 표준명을 반드시 사용한다. 원문 중국어·영어 법인명과 한국어 표준명을 섞어 새 이름을 만들지 않는다. keywords_ko에는 회사명 대신 사건을 대표하는 짧은 한국어 핵심 키워드 1~3개만 넣는다(예: 증설, 고객 인증, 실리콘 음극, 해외 생산). headline_signals는 이 기사가 산업의 무엇을 확대(expansion) 또는 축소(contraction)시키는 신호인지 신호별로 판단한 것이다. keyword_ko에는 회사명·기관명·부처명·매체명·일반 산업명을 쓰지 않는다(예: 공업정보화부, 리튬전지 산업, 출하량 순위는 신호가 아니다). 생산능력·출하·수주·고객·가격·투자·기술 같은 실제로 늘거나 주는 대상을 쓴다. direction은 본문에 적힌 사실을 근거로 정하고, 판단 근거가 약하면 neutral을 쓴다. reason_ko에는 왜 그 방향인지 본문 사실을 들어 한 문장으로 쓴다. timeline_eligibility는 이 사실을 시계열에 넣을지만 고른다. 회사·산업의 사실이면 reference를 고르고, 시계열에 넣을 사실이 아니면(광고, 소비자 리뷰, 주가 단신, 회사와 무관한 내용) exclude를 고른다. core는 고르지 않는다 — 거래소 공시 원문인지 여부는 서버가 판단해 정한다. original_excerpt에는 핵심 근거 원문을 300자 이내로만 발췌하고, original_excerpt_ko에는 그 발췌문의 충실한 한국어 번역만 쓴다. event_fact_ko에 쓴 수치는 하나도 빠짐없이 이 발췌 안에 있어야 한다. 본문 여기저기의 수치를 event_fact_ko 한 문장에 모으지 말고, 발췌 한 대목으로 뒷받침되는 사실만 남긴다. ";

// 사건 시점은 기사 발행일이 아니다. 2026-09-04 大众日报 특집이 2026-03-05 발표된 비야디 2세대
// 블레이드 배터리를 소개했는데, 발행일이 그대로 사건 시점으로 들어가 시계열이 6개월 어긋났다.
// 기사 본문이 시점을 적지 않으면 그 사실을 남기고(occurred_basis=null) 뒤의 웹 검색 재확인 단계가 잡는다.
export const ARTICLE_DATE_GUIDE = "occurred_at은 그 사실이 실제로 일어난(발표·체결·가동·출시된) 시점이지 기사 발행일이 아니다. 반드시 PostgreSQL date에 저장 가능한 YYYY-MM-DD 형식으로 쓴다. 월까지만 알면 그 달 1일, 연도만 알면 그해 1월 1일을 쓰고 정확도는 occurred_precision으로 구분한다. 본문에 시점이 적혀 있으면(예: 3月5日, 今年上半年, 去年, 2025年) 그 시점을 쓰고, occurred_basis에 그 근거 문장을 원문 그대로 짧게 인용하며, occurred_precision에 확인된 정밀도(day/month/half/year)를 쓴다. 본문에 시점이 없으면 occurred_at에 발행일을 쓰되 occurred_precision은 month로, occurred_basis는 null로 둔다. 발행일을 근거로 지어 적지 않는다. retrospective는 이 기사가 새 소식이 아니라 이미 발표된 사실을 다시 소개·회고하는 글(특집·회객청·전문가 대담·기업 소개, 此前·曾·早在·回顾 같은 표현)이면 true다. retrospective가 true이고 본문에 발표 시점이 없으면 occurred_at에 발행일을 쓰되 occurred_precision을 year로 두어 시점이 불확실함을 표시한다.";

function isAuthorized(request) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret && request.headers.authorization === `Bearer ${secret}`);
}

function addDays(dateStr, days) {
  const date = new Date(`${String(dateStr).slice(0, 10)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function normalizeOccurredAt(value) {
  const raw = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const date = new Date(`${raw}T00:00:00Z`);
    return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== raw ? null : raw;
  }
  if (/^\d{4}-\d{2}$/.test(raw)) return `${raw}-01`;
  if (/^\d{4}$/.test(raw)) return `${raw}-01-01`;
  return null;
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
          required: ["keyword_ko", "direction", "reason_ko", ...Object.keys(SIGNAL_SUBJECT_PROPERTIES)],
          properties: {
            keyword_ko: { type: "string" },
            direction: { type: "string", enum: ["expansion", "contraction", "neutral"] },
            reason_ko: { type: "string" },
            ...SIGNAL_SUBJECT_PROPERTIES
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
    instructions: ARTICLE_DATE_GUIDE + ARTICLE_ANALYSIS_PROMPT_BODY + LAYER_PROMPT_GUIDE + " " + SIGNAL_SUBJECT_RULE,
    input, provider
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
      // extractPdfText는 { text, pages } 객체를 돌려준다. String()으로 감싸면 "[object Object]"(15자)가
      // 되어 본문이 항상 body_too_short로 떨어졌다. 공시가 한 건도 분석되지 않은 원인이다.
      const extracted = await extractPdfText(resolvedUrl);
      bodyText = String(extracted?.text || "").slice(0, MAX_BODY_CHARS);
    } catch (error) {
      await recordProcessing(articleId, "body_unavailable", `PDF 추출 실패: ${error.message} · ${resolvedUrl}`);
      return { status: "body_unavailable", reason: "pdf_extract_failed" };
    }
  } else {
    // 남의 사이트다. robots.txt가 막으면 읽지 않고, 같은 도메인 연속 요청에는 간격을 둔다.
    // 막힌 기사는 processing_status가 남아 다시 선별되지 않는다(헤드라인·요약은 그대로 쓴다).
    const robots = await checkRobots(resolvedUrl);
    if (!robots.allowed) {
      await recordProcessing(articleId, "robots_disallowed", `robots.txt가 본문 수집을 허용하지 않음 · ${resolvedUrl}`);
      return { status: "robots_disallowed", reason: robots.reason };
    }
    await waitForHostSlot(robots.host, robots.delayMs);
    const sourceResponse = await fetch(resolvedUrl, { headers: { "User-Agent": CRAWLER_UA }, signal: AbortSignal.timeout(20000) });
    const contentType = sourceResponse.headers.get("content-type") || "";
    if (!sourceResponse.ok || !contentType.includes("text/html")) {
      await recordProcessing(articleId, "body_unavailable", `HTTP ${sourceResponse.status} · content-type: ${contentType || "없음"} · ${resolvedUrl}`);
      return { status: "body_unavailable", contentType };
    }
    const sourceHtml = await sourceResponse.text();
    const sourceDay = sourcePublishedDay(sourceHtml);
    const storedDay = String(article.published_at || "").slice(0, 10);
    if (sourceDay && sourceDay !== storedDay) {
      article.published_at = sourceDay;
      await supabaseRest(`article?id=eq.${encodeURIComponent(articleId)}`, {
        method: "PATCH", body: { published_at: sourceDay, updated_at: new Date().toISOString() }
      });
      console.info("[ARTICLE_SOURCE_DATE_CORRECTED]", JSON.stringify({ articleId, storedDay, sourceDay }));
      const normalWebSearch = String(article.source_tier || "").startsWith("web_search_")
        && !String(article.source_tier || "").startsWith("web_search_bootstrap_");
      if (normalWebSearch && !sourceDayWithinTolerance(sourceDay, storedDay)) {
        const note = `원문 발행일 ${sourceDay}이 검색 결과 날짜 ${storedDay}와 3일 넘게 달라 최근 기사에서 제외`;
        await supabaseRest(`article?id=eq.${encodeURIComponent(articleId)}`, {
          method: "PATCH",
          body: {
            verification_status: "rejected", source_tier: "fact_check_rejected",
            processing_status: "fact_check_rejected", processing_note: note,
            timeline_eligibility: "exclude", headline_signals: [],
            processed_at: new Date().toISOString(), updated_at: new Date().toISOString()
          }
        });
        await supabaseRest(`knowledge_chunk?article_id=eq.${encodeURIComponent(articleId)}&source_type=eq.headline`, {
          method: "DELETE", prefer: "return=minimal"
        }).catch(() => {});
        return { status: "rejected", reason: "source_date_outside_search_window", storedDay, sourceDay };
      }
    }
    bodyText = htmlToText(sourceHtml).slice(0, MAX_BODY_CHARS);
  }
  if (bodyText.length < 500) {
    await recordProcessing(articleId, "body_too_short", `본문 ${bodyText.length}자로 최소 500자에 못 미침 · ${resolvedUrl}`);
    return { status: "body_too_short" };
  }
  await supabaseRest(`article?id=eq.${encodeURIComponent(articleId)}`, {
    method: "PATCH", body: { body_original: bodyText, body_fetched_at: new Date().toISOString(), embedding_status: "pending", updated_at: new Date().toISOString() }
  });

  const primaryProvider = llmConfig("openai") ? "openai" : "deepseek";
  const company = companyId === POLICY_COMPANY_ID ? POLICY_COMPANY : COMPANIES.find((item) => item.id === companyId);
  const group = company ? groupSummary(company.id) : null;
  const companyContext = companyId === POLICY_COMPANY_ID
    ? "분석 대상: 중국 중앙정부의 배터리·NEV·ESS 정책. 정책의 발표·시행·유예·폐지 사실을 하나의 사건으로 추출하고, 특정 기업의 사건으로 바꾸지 마라. trajectory_track은 market, layer_key는 unclassified로 둔다."
    : company ? `서비스 표준 회사명: ${company.name_ko}${group ? `
그룹: ${group.name_ko}
그룹 포함 검색 법인: ${group.members_ko.join(", ")}` : ""}` : "";
  // 신호의 주체를 고르게 하려고 이 기사에 연결된 회사 전체를 함께 준다(2026-09-11).
  const linkRows = await supabaseRest(`article_company?select=company_id&article_id=eq.${encodeURIComponent(articleId)}`).catch(() => []);
  const linkedIds = [...new Set([companyId, ...(linkRows || []).map((row) => row.company_id)].filter((id) => id && id !== POLICY_COMPANY_ID))];
  const fullContext = linkedIds.length ? `${companyContext}
[연결 회사]
${linkedCompanyLines(linkedIds)}` : companyContext;
  // 원문 확보와 구조화 추출을 마친 기사는 바로 표시한다. 별도 DeepSeek 교차대조는 수행하지 않는다.
  const verifiedResult = await analyzeArticle(article, bodyText, primaryProvider, fullContext);
  await supabaseRest(`article?id=eq.${encodeURIComponent(articleId)}`, {
    method: "PATCH",
    body: { title_ko: verifiedResult.title_ko, summary_ko: verifiedResult.summary_ko, keywords_ko: verifiedResult.keywords_ko, headline_signals: attachSubjects(verifiedResult.headline_signals || [], linkedIds), verification_status: "verified", source_tier: `${primaryProvider}_source_extracted`, processing_status: "ok", processing_note: null, processed_at: new Date().toISOString(), updated_at: new Date().toISOString() }
  });
  let embedding = { status: "skipped", chunks: 0 };
  try {
    embedding = await embedVerifiedArticle({
      article: { ...article, company_name_ko: company?.name_ko }, companyId, bodyText, titleKo: verifiedResult.title_ko, summaryKo: verifiedResult.summary_ko,
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
  const occurredAt = normalizeOccurredAt(verifiedResult.occurred_at);
  if (verifiedResult.timeline_eligibility !== "exclude" && occurredAt) {
    // 발생 법인은 등록된 계열사 별칭 매칭으로만 정한다. 본문 전체가 아니라 이벤트 문장과
    // 근거 발췌만 대조해 각주·목록에 스치듯 나온 계열사가 섞이지 않게 한다.
    const entityNames = matchGroupEntities(companyId, [
      article.title_original, verifiedResult.event_title_ko, verifiedResult.event_fact_ko, verifiedResult.original_excerpt
    ].filter(Boolean).join(" "));
    const candidate = { occurred_at: occurredAt, title_ko: verifiedResult.event_title_ko, fact_ko: verifiedResult.event_fact_ko };
    // 여러 매체가 같은 사건을 보도하면 거의 같은 이벤트가 겹쳐 쌓인다. 같은 회사에서 인접 시점의
    // 기존 이벤트와 같은 사실이면 새로 넣지 않는다(매체만 다른 중복 방지).
    const nearby = await supabaseRest(`event?select=occurred_at,title_ko,fact_ko&company_id=eq.${encodeURIComponent(companyId)}&occurred_at=gte.${addDays(occurredAt, -3)}&occurred_at=lte.${addDays(occurredAt, 3)}`);
    if ((nearby || []).some((prev) => sameFact(prev, candidate))) {
      console.info("[EVENT_DUP_SKIPPED]", JSON.stringify({ articleId, companyId, title: verifiedResult.event_title_ko }));
      return { status: "verified", verification_outcome: "source_extracted", analysis: verifiedResult, embedding, duplicate: true, primary_provider: primaryProvider };
    }
    // 이벤트는 만들어지는 즉시 벡터 검색 대상이 돼야 한다. 크론이나 버튼을 기다리게 하지 않는다.
    // 임베딩 실패는 이벤트 적재를 되돌리지 않는다. 남은 것은 임베딩 크론이 채운다.
    const storedEvents = await supabaseRest("event", { method: "POST", prefer: "return=representation", body: {
      entity_names: entityNames,
      company_id: companyId, article_id: articleId, occurred_at: occurredAt,
      // 본문이 시점을 말하지 않은 이벤트는 basis가 null로 남아 웹 검색 재확인 큐에 들어간다.
      occurred_precision: ["day", "month", "half", "year"].includes(verifiedResult.occurred_precision) ? verifiedResult.occurred_precision : "month",
      occurred_basis: verifiedResult.occurred_basis ? String(verifiedResult.occurred_basis).slice(0, 300) : null,
      title_ko: verifiedResult.event_title_ko, fact_ko: verifiedResult.event_fact_ko,
      // layer_key 소속에 맞춰 트랙을 맞춘다. 시장 레이어인데 기술로 들어가는 어긋남을 막는다.
      trajectory_track: normalizeLayerKey(verifiedResult.layer_key)?.startsWith("technology-") ? "technology"
        : normalizeLayerKey(verifiedResult.layer_key) ? "market"
        : (verifiedResult.trajectory_track === "technology" ? "technology" : "market"),
      layer_key: normalizeLayerKey(verifiedResult.layer_key),
      region_scope: verifiedResult.region_scope, source_url: resolvedUrl, source_name: article.source_name,
      original_excerpt: verifiedResult.original_excerpt, original_excerpt_ko: verifiedResult.original_excerpt_ko,
      // 거래소 공시는 회사가 직접 낸 1차 출처다. 언론 기사와 등급·출처 표기를 구분한다.
      evidence_kind: isDisclosure ? "disclosure" : "article",
      // 등급은 서버가 정한다. 모델에 맡겼더니 프롬프트의 금지 문구에도 core를 골랐다(2026-09-07에
      // 11건: CATL 뉴스룸 5, 회사 홈페이지 뉴스 1, 상대 회사 보도자료 1, 新浪财经의 공고 전재 4).
      // core는 거래소에 제출된 공시·정기보고서 원문에만 준다. 회사가 자기 채널에 낸 보도자료는
      // 1차 출처이긴 하나 법정 공시가 아니고 우리가 본문을 대조한 것도 아니라 보조(reference)로 둔다.
      // 모델의 exclude 판단(시계열에 넣지 말 것)은 그대로 존중한다.
      timeline_eligibility: verifiedResult.timeline_eligibility === "exclude" ? "exclude" : isDisclosure ? "core" : "reference"
    } });
    try {
      await embedEvents((storedEvents || []).map((row) => ({ ...row, company_name_ko: company?.name_ko || companyId })));
    } catch (error) {
      console.error("[EVENT_EMBEDDING_FAILED]", JSON.stringify({ articleId, message: error.message }));
    }
  }
  return { status: "verified", verification_outcome: "source_extracted", analysis: verifiedResult, embedding, primary_provider: primaryProvider };
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
    return response.status(result.status === "verified" ? 200 : 422).json(result);
  } catch (error) {
    return response.status(502).json({ status: "processing_failed", message: error.message });
  } finally {
    // 서버리스 함수는 응답 직후 종료돼 배경 전송이 유실된다. 끝나기 전에 반드시 보낸다.
    await flushTraces();
  }
}
