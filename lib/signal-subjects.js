import { createJsonResponse } from "./llm-provider.js";
import { supabaseRest } from "./supabase.js";
import { COMPANIES } from "./china-sources.js";

// ── 신호의 주체 ────────────────────────────────────────────────────────────
// 기사의 확대·축소 신호(headline_signals)가 누구의 신호인지. 예전에는 이 정보가 없어 Sankey가
// 기사에 연결된 모든 회사에 같은 신호를 붙였다. 2026-09-11 운영 DB 점검: 여러 회사에 연결된 검증 기사
// 51건의 신호 124개가 선 380개로 복사됐고, 근거 문장에 이름 매칭으로 주체를 가려도 51개(41%)는
// 산업 전반 수치·추적 외 회사(샤오미·체리 등)·한국어 표기 차이·주어 생략 때문에 가려지지 않았다.
// 그래서 모델이 신호마다 주체를 고르게 한다. 서버는 모델이 고른 이름이 실제 연결 회사인지만 확인한다.
//
// 저장 모양(headline_signals 원소에 추가):
//   subject_scope: "company" | "industry" | "other_company"
//   subject_company_ids: 연결 회사 id 배열(scope가 company일 때만 비지 않음)
//   subjects_ko: 모델이 적은 이름(감사용)

export const SUBJECT_SCOPES = ["company", "industry", "other_company"];

// 분석·검증 스키마의 headline_signals 원소에 넣을 필드.
export const SIGNAL_SUBJECT_PROPERTIES = {
  subject_scope: { type: "string", enum: SUBJECT_SCOPES },
  subjects_ko: { type: "array", maxItems: 4, items: { type: "string" } },
};

export const SIGNAL_SUBJECT_RULE =
  "headline_signals의 각 항목에는 그 신호의 주체를 적는다. 주체는 그 변화(증설·출하·실적·가격·고객 변화 등)가 실제로 일어나는 회사다. " +
  "subjects_ko에는 입력의 [연결 회사] 목록에 있는 표준명 중 이 신호의 주체만 그대로 옮겨 적고 subject_scope는 company로 둔다. 기사에 이름만 언급됐거나 비교 대상·경쟁사로 나온 회사는 넣지 않는다. " +
  "예: 'A사 배터리를 빼고 B사 배터리로 교체'는 A사의 축소 신호, B사의 확대 신호로 항목을 나눈다. " +
  "주체가 [연결 회사] 목록 밖의 회사(완성차·해외 배터리사·비추적 소재사 등)면 subject_scope를 other_company로, 산업·시장 전체 수치, 여러 회사 합산, 정부 정책·규제면 industry로 두고 subjects_ko는 빈 배열로 둔다.";

// 한국어 기사·모델 출력에 쓰이는 다른 표기. 회사 마스터 별칭은 수집 매칭에도 쓰이므로 건드리지 않고
// 여기서만 주체 판정용으로 더한다(2026-09-11 점검에서 이름을 못 찾은 표기들).
const EXTRA_NAME_TERMS = {
  "hunan-yuneng": ["후난위능", "후난 위넝"],
  "reshine": ["금천루이샹", "진촨 루이샹", "진촨루이샹"],
  "fulin-precision": ["푸린정궁", "푸린징궁", "푸린 정궁"],
  "sunwoda": ["흔왕달", "신왕다동력", "신왕다파워"],
  "dynanonic": ["다이나노닉", "더팡나미"],
  "shanshan": ["산산 테크놀로지", "상하이 산산", "산산 과기"],
  "hithium": ["하이천", "하이첸"],
  "easpring": ["이스프링", "당승과기"],
  "rept": ["렙트", "루이푸란쥔"],
};

export const NAME_TERMS = new Map(COMPANIES.map((company) => {
  const base = String(company.name_ko || "").replace(/\s*\(.*?\)\s*/g, "").trim();
  const paren = (String(company.name_ko || "").match(/\(([^)]+)\)/) || [])[1];
  const terms = [company.name_ko, base, paren, company.name_zh, company.name_en, ...(company.aliases || []), ...(EXTRA_NAME_TERMS[company.id] || [])]
    .map((term) => String(term || "").trim().toLowerCase())
    // 짧은 영문 약칭(EVE 등)은 다른 단어 속에 섞여 잘못 걸리므로 3자 이상만 쓴다. 한글·한자는 2자 이상.
    .filter((term) => term.length >= 2 && (!/^[a-z0-9 ]+$/.test(term) || term.length >= 3));
  return [company.id, [...new Set(terms)]];
}));

// 모델이 적은 이름을 연결 회사 id로 되돌린다. 연결 회사가 아닌 이름은 버린다.
export function resolveSubjectIds(names = [], linkedIds = []) {
  const ids = new Set();
  for (const name of names) {
    const lower = String(name || "").trim().toLowerCase();
    if (!lower) continue;
    for (const id of linkedIds) {
      const terms = NAME_TERMS.get(id) || [];
      if (terms.some((term) => lower === term || lower.includes(term) || (term.length >= 3 && term.includes(lower) && lower.length >= 2))) ids.add(id);
    }
  }
  return [...ids];
}

// 모델 출력(signals)에 서버 판정 필드를 붙인다. scope가 company인데 연결 회사로 되돌릴 이름이 없으면
// "unresolved"로 표시해 화면이 예비 규칙(이름 매칭)을 쓰게 한다.
export function attachSubjects(signals = [], linkedIds = []) {
  return (signals || []).map((signal) => {
    if (!signal) return signal;
    const scope = SUBJECT_SCOPES.includes(signal.subject_scope) ? signal.subject_scope : null;
    const names = Array.isArray(signal.subjects_ko) ? signal.subjects_ko.map(String).filter(Boolean).slice(0, 4) : [];
    if (!scope) return { ...signal };
    if (scope !== "company") return { ...signal, subject_scope: scope, subjects_ko: names, subject_company_ids: [] };
    const ids = resolveSubjectIds(names, linkedIds);
    return { ...signal, subject_scope: ids.length ? "company" : "unresolved", subjects_ko: names, subject_company_ids: ids };
  });
}

// 모델에게 보여 줄 연결 회사 목록(표준명). 표준명 그대로 적게 하려고 한 줄씩 준다.
export function linkedCompanyLines(linkedIds = []) {
  return linkedIds.map((id) => COMPANIES.find((company) => company.id === id)).filter(Boolean)
    .map((company) => `- ${company.name_ko} (${[company.name_zh, company.name_en].filter(Boolean).join(" / ")})`).join("\n");
}

// ── 기존 기사 재판정 ────────────────────────────────────────────────────────
// 저장된 제목·요약·신호와 연결 회사 목록만으로 신호마다 주체를 다시 고른다. 본문을 다시 받지 않는다.
// 신호 문장·방향·키워드는 바꾸지 않고 주체 필드만 채운다.
const BACKFILL_BATCH = 8;
const BACKFILL_SHAPE = {
  type: "object", additionalProperties: false, required: ["articles"],
  properties: {
    articles: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["ref", "signals"],
        properties: {
          ref: { type: "string" },
          signals: {
            type: "array",
            items: {
              type: "object", additionalProperties: false, required: ["index", ...Object.keys(SIGNAL_SUBJECT_PROPERTIES)],
              properties: { index: { type: "integer" }, ...SIGNAL_SUBJECT_PROPERTIES },
            },
          },
        },
      },
    },
  },
};
const BACKFILL_RULE =
  "입력은 이미 본문 검증을 거친 중국 배터리 기사 여러 건이다. 기사마다 제목·요약·[연결 회사]·확대/축소 신호 목록(번호, 방향, 키워드, 근거)이 있다. " +
  "신호 문장은 바꾸지 말고 신호마다 주체만 판정한다. articles에는 입력 기사마다 하나씩, ref에 기사 번호(A1, A2 …)를 그대로 적고, signals의 index에는 입력 신호 번호를 그대로 적는다. " + SIGNAL_SUBJECT_RULE +
  " 한 신호의 주체가 두 회사 이상이면 모두 적되, 방향이 회사마다 다르면(한쪽은 늘고 한쪽은 줄면) 그 방향이 맞는 회사만 적는다. 판단 근거는 제목·요약·신호 근거에 있는 사실만 쓴다.";

function backfillInput(batch) {
  return batch.map((article, index) => [
    `[기사 A${index + 1}] 제목: ${article.title_ko || article.title_original || ""}`,
    `요약: ${String(article.summary_ko || "").slice(0, 900)}`,
    `[연결 회사]\n${linkedCompanyLines(article.linked_ids)}`,
    "신호:",
    ...(article.headline_signals || []).map((signal, i) => `  ${i}. ${signal?.direction || ""} · ${signal?.keyword_ko || ""} · ${signal?.reason_ko || ""}`),
  ].join("\n")).join("\n\n");
}

export function applyBackfill(article, judged) {
  const byIndex = new Map((judged?.signals || []).map((item) => [Number(item.index), item]));
  const merged = (article.headline_signals || []).map((signal, index) => {
    const verdict = byIndex.get(index);
    if (!signal || !verdict) return signal;
    return { ...signal, subject_scope: verdict.subject_scope, subjects_ko: verdict.subjects_ko };
  });
  return attachSubjects(merged, article.linked_ids);
}

// 한 번 호출에 batchSize건씩, limit건까지 판정한다. 이미 주체가 있는 기사는 건너뛴다.
export async function backfillSignalSubjects({ limit = 40, batchSize = BACKFILL_BATCH, deadline = Infinity } = {}) {
  const rows = await supabaseRest("article?select=id,title_ko,title_original,summary_ko,headline_signals,article_company(company_id)&verification_status=in.(verified,approved)&order=published_at.desc&limit=2000");
  const pending = (rows || [])
    .map((row) => ({ ...row, linked_ids: [...new Set((row.article_company || []).map((link) => link.company_id))] }))
    .filter((row) => Array.isArray(row.headline_signals) && row.headline_signals.some((signal) => signal && signal.direction !== "neutral" && !signal.subject_scope));
  const todo = pending.slice(0, limit);
  let updated = 0, failed = 0;
  for (let start = 0; start < todo.length; start += batchSize) {
    if (Date.now() + 60000 > deadline) break;
    const batch = todo.slice(start, start + batchSize);
    try {
      const { data } = await createJsonResponse({
        name: "signal_subject_backfill", schema: BACKFILL_SHAPE, provider: "openai", timeoutMs: 55000,
        instructions: BACKFILL_RULE, input: backfillInput(batch),
      });
      const byRef = new Map((data?.articles || []).map((item) => [String(item.ref || "").replace(/^\[?기사\s*/, "").replace(/\]$/, ""), item]));
      for (const [index, article] of batch.entries()) {
        const judged = byRef.get(`A${index + 1}`);
        if (!judged) { failed += 1; continue; }
        const signals = applyBackfill(article, judged);
        // 모든 비중립 신호에 주체 판정이 붙었을 때만 저장한다. 빠진 신호가 있으면 다음 회차에 다시 판정한다.
        const complete = signals.every((signal) => !signal || signal.direction === "neutral" || signal.subject_scope);
        if (!complete) { failed += 1; continue; }
        await supabaseRest(`article?id=eq.${encodeURIComponent(article.id)}`, { method: "PATCH", prefer: "return=minimal", body: { headline_signals: signals } });
        updated += 1;
      }
    } catch (error) {
      console.error("[SIGNAL_SUBJECT_BACKFILL_FAILED]", JSON.stringify({ message: error.message }));
      failed += batch.length;
    }
  }
  return { pending: pending.length, attempted: todo.length, updated, failed, remaining: Math.max(0, pending.length - updated) };
}
