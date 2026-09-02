import { hasDatabaseConfig, supabaseRest } from "./lib/supabase.js";
import { requireAccess } from "./lib/access.js";
import { COMPANIES } from "../lib/china-sources.js";

const VALUE_CHAINS = ["cell", "cathode", "anode"];

// 화면의 회사 목록은 DB가 비어 있어도 마스터에서 그대로 나와야 하므로 정적 마스터를 기준으로 만든다.
function catalogEntry(company) {
  return {
    id: company.id,
    name_ko: company.name_ko,
    name_zh: company.name_zh,
    name_en: company.name_en,
    type_tags: company.type_tags,
    value_chain: VALUE_CHAINS.find((tag) => company.type_tags.includes(tag)) || "other",
  };
}

const EVENT_SELECT = "id,occurred_at,title_ko,fact_ko,trajectory_track,layer_key,region_scope,source_url,source_name,original_excerpt,original_excerpt_ko,timeline_eligibility,article(canonical_url,source_name,source_tier)";

export default async function handler(request, response) {
  if (!requireAccess(request, response)) return;
  const companyId = String(request.query.companyId || "").trim();
  if (!companyId) return response.status(200).json({ status: "ok", companies: COMPANIES.map(catalogEntry) });

  const master = COMPANIES.find((item) => item.id === companyId);
  if (!master) return response.status(404).json({ status: "unknown_company", message: "추적 대상 회사 마스터에 없는 ID입니다." });
  const company = catalogEntry(master);
  if (!hasDatabaseConfig()) return response.status(503).json({ status: "not_configured", company, events: [] });

  try {
    const events = await supabaseRest(`event?select=${EVENT_SELECT}&company_id=eq.${encodeURIComponent(companyId)}&timeline_eligibility=neq.exclude&order=occurred_at.asc`);
    response.setHeader("Cache-Control", "no-store, max-age=0");
    return response.status(200).json({ status: "ok", company, events });
  } catch (error) {
    console.error("[COMPANY_QUERY_FAILED]", JSON.stringify({ companyId, message: error.message }));
    return response.status(502).json({ status: error.code || "db_error", company, events: [] });
  }
}
