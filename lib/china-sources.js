import { createJsonResponse, llmConfig } from "./llm-provider.js";
import { groupAliases, groupSearchEntities } from "./company-groups.js";
import { hasDatabaseConfig, supabaseRest } from "./supabase.js";

// 추적 대상 선정 기준. 순위 수치 자체는 저장하지 않는다.
// priority는 SNE Research 공개 보도자료에서 확인한 밸류체인 내 순위이고,
// null은 SNE 상위 명단에서 확인하지 못한 회사다.
export const SELECTION_BASIS = {
  source_ko: "SNE Research 공개 보도자료",
  metric_ko: "셀 = EV·ESS 배터리 사용량, 양극재 = LFP·NCM 화학계별 출하량, 음극재 = 총 출하량",
  reviewed_on: "2026-09-02",
};

export const COMPANIES = [
  { id: "catl", name_ko: "닝더스다이(CATL)", homepage: "catl.com", name_zh: "宁德时代", name_en: "Contemporary Amperex Technology", type_tags: ["cell"], priority: 1, aliases: ["宁德时代", "CATL", "Contemporary Amperex Technology"], cninfo: { column: "szse", query: "宁德时代", codes: ["300750"] } },
  { id: "byd", name_ko: "비야디(BYD)", homepage: "byd.com", name_zh: "比亚迪", name_en: "BYD", type_tags: ["cell"], priority: 2, aliases: ["比亚迪", "BYD", "刀片电池", "Blade Battery"], cninfo: { column: "szse", query: "比亚迪", codes: ["002594"] } },
  { id: "eve-energy", name_ko: "이브에너지(EVE Energy)", name_zh: "亿纬锂能", name_en: "EVE Energy", type_tags: ["cell"], priority: 5, aliases: ["亿纬锂能", "EVE Energy"], cninfo: { column: "szse", query: "亿纬锂能", codes: ["300014"] } },
  { id: "calb", name_ko: "중촹신항(CALB)", name_zh: "中创新航", name_en: "CALB", type_tags: ["cell"], priority: 3, aliases: ["中创新航", "CALB"], hkex: { code: "03931" } },
  { id: "gotion", name_ko: "궈쉬안하이테크(Gotion)", name_zh: "国轩高科", name_en: "Gotion High-tech", type_tags: ["cell"], priority: 4, aliases: ["国轩高科", "Gotion", "Gotion High-tech"], cninfo: { column: "szse", query: "国轩高科", codes: ["002074"] } },
  { id: "sunwoda", name_ko: "신왕다(Sunwoda)", name_zh: "欣旺达", name_en: "Sunwoda", type_tags: ["cell"], priority: 7, aliases: ["欣旺达", "Sunwoda"], cninfo: { column: "szse", query: "欣旺达", codes: ["300207"] } },
  { id: "hithium", name_ko: "Hithium", homepage: "hithium.com", name_zh: "海辰储能", name_en: "Hithium", type_tags: ["cell"], priority: null, aliases: ["海辰储能", "Hithium"] },
  { id: "rept", name_ko: "REPT BATTERO", name_zh: "瑞浦兰钧", name_en: "REPT BATTERO", type_tags: ["cell"], priority: null, aliases: ["瑞浦兰钧", "REPT", "REPT BATTERO"], hkex: { code: "00666" } },
  { id: "svolt", name_ko: "SVOLT", homepage: "svolt.cn", name_zh: "蜂巢能源", name_en: "SVOLT", type_tags: ["cell"], priority: 6, aliases: ["蜂巢能源", "SVOLT"] },
  { id: "farasis", name_ko: "Farasis Energy", name_zh: "孚能科技", name_en: "Farasis Energy", type_tags: ["cell"], priority: null, aliases: ["孚能科技", "Farasis"], search_aliases: ["푸넝", "파라시스"], cninfo: { column: "sse", query: "孚能科技", codes: ["688567"] } },
  { id: "ronbay", name_ko: "룽바이(Ronbay)", name_zh: "容百科技", name_en: "Ronbay", type_tags: ["cathode", "cathode_ncm"], priority: 2, aliases: ["容百科技", "Ronbay", "Ningbo Ronbay"], cninfo: { column: "sse", query: "容百科技", codes: ["688005"] } },
  { id: "hunan-yuneng", name_ko: "후난위넝", name_zh: "湖南裕能", name_en: "Hunan Yuneng", type_tags: ["cathode", "cathode_lfp"], priority: 1, aliases: ["湖南裕能", "Hunan Yuneng"], cninfo: { column: "szse", query: "湖南裕能", codes: ["301358"] } },
  { id: "dynanonic", name_ko: "Dynanonic", name_zh: "德方纳米", name_en: "Dynanonic", type_tags: ["cathode", "cathode_lfp"], priority: 3, aliases: ["德方纳米", "Dynanonic"], search_aliases: ["더팡", "디나노닉", "다이나노닉"], cninfo: { column: "szse", query: "德方纳米", codes: ["300769"] } },
  { id: "xtc-new-energy", name_ko: "XTC New Energy", name_zh: "厦钨新能", name_en: "XTC New Energy", type_tags: ["cathode", "cathode_ncm"], priority: null, aliases: ["厦钨新能", "XTC New Energy"], search_aliases: ["샤우", "샤먼텅스텐"], cninfo: { column: "sse", query: "厦钨新能", codes: ["688778"] } },
  { id: "easpring", name_ko: "Easpring", name_zh: "当升科技", name_en: "Easpring", type_tags: ["cathode", "cathode_ncm"], priority: null, aliases: ["当升科技", "Easpring"], search_aliases: ["당승", "당승과기"], cninfo: { column: "szse", query: "当升科技", codes: ["300073"] } },
  { id: "zhenhua-new-material", name_ko: "Zhenhua New Material", name_zh: "振华新材", name_en: "Zhenhua New Material", type_tags: ["cathode", "cathode_ncm"], priority: null, aliases: ["振华新材", "Zhenhua New Material"], search_aliases: ["진화신소재", "진화신재"], cninfo: { column: "sse", query: "振华新材", codes: ["688707"] } },
  { id: "changyuan-lico", name_ko: "우쾅신넝(Minmetals New Energy)", name_zh: "五矿新能", name_en: "Minmetals New Energy", type_tags: ["cathode", "cathode_ncm"], priority: null, aliases: ["五矿新能", "五矿新能源材料", "长远锂科", "Changyuan Lico"], cninfo: { column: "sse", query: "五矿新能", codes: ["688779"] }, note_ko: "2024-08-09자로 湖南长远锂科 → 五矿新能源材料（湖南）로 사명 변경. 옛 이름도 검색 별칭으로 유지한다." },
  { id: "wanrun-new-energy", name_ko: "Wanrun New Energy", name_zh: "万润新能", name_en: "Wanrun New Energy", type_tags: ["cathode", "cathode_lfp"], priority: 2, aliases: ["万润新能", "Wanrun New Energy"], search_aliases: ["완룬", "완룬신에너지", "완룬신넝", "만런신능"], cninfo: { column: "sse", query: "万润新能", codes: ["688275"] } },
  { id: "lopal", name_ko: "Lopal Tech", name_zh: "龙蟠科技", name_en: "Lopal Tech", type_tags: ["cathode", "cathode_lfp"], priority: 5, aliases: ["龙蟠科技", "Lopal"], cninfo: { column: "sse", query: "龙蟠科技", codes: ["603906"] } },
  { id: "fulin-precision", name_ko: "푸린정공(Fulin Precision)", name_zh: "富临精工", name_en: "Fulin Precision", type_tags: ["cathode", "cathode_lfp"], priority: null, aliases: ["富临精工", "Fulin Precision"], cninfo: { column: "szse", query: "富临精工", codes: ["300432"] }, note_ko: "LFP 양극재는 자회사 江西升华新材料가 담당한다. CATL이 2025~2027년 연 14만톤 이상 구매를 약정하고 15억 위안을 선급했다. SNE 공개 보도자료 상위 명단에서 확인하지 못해 priority는 비워 둔다." },
  { id: "cnrg", name_ko: "중웨이신차이(CNGR)", name_zh: "中伟新材", name_en: "CNGR", type_tags: ["cathode"], priority: null, aliases: ["中伟新材", "中伟新材料", "中伟股份", "CNGR"], cninfo: { column: "szse", query: "中伟新材", codes: ["300919"] }, note_ko: "삼원계 전구체 업체라 SNE 양극재 출하 순위 대상이 아니다. 证券简称이 中伟股份에서 中伟新材로 바뀌어 옛 이름도 별칭으로 남긴다." },
  { id: "reshine", name_ko: "진촨루이샹(Reshine)", name_zh: "甘肃金川瑞翔新材料股份有限公司", name_en: "Gansu Jinchuan Reshine New Material", type_tags: ["cathode", "cathode_ncm"], priority: 1, aliases: ["金川瑞翔", "甘肃金川瑞翔", "瑞翔新材", "湖南瑞翔", "南通瑞翔", "Jinchuan Reshine", "Reshine"], listed: false, note_ko: "SNE 삼원 정극재 출하 1위의 실제 주체. 2026-06-29 심천 창업판 IPO 신청이 접수돼 아직 비상장이라 cninfo 종목코드가 없다. 상장되면 cninfo(column: szse)를 채워 공시 수집을 켠다. 지배구조는 金川集团 → 金川科技园 → 金川瑞翔이며, 金川科技园이 직접 24.46%와 자회사 湖南瑞翔을 통한 33.65%로 합계 58.11%를 지배한다. 옛 추적 대상이던 湖南瑞翔은 지분 보유 주주라 별칭으로만 남긴다." },
  { id: "youshan", name_ko: "유산과기(Youshan)", name_zh: "友山科技", name_en: "Youshan Technology", type_tags: ["cathode", "cathode_lfp"], priority: 4, aliases: ["友山科技", "友山"], listed: false, note_ko: "비상장. 상장사 华友钴业이 아니라 지주사 华友控股集团의 전액출자 자회사다. 연차보고서가 없어 그룹 계열사를 등록하지 않는다." },
  { id: "btr", name_ko: "BTR", name_zh: "贝特瑞", name_en: "BTR", type_tags: ["anode"], priority: 1, aliases: ["贝特瑞", "BTR", "Beijing BTR"], search_aliases: ["베이터루이"], cninfo: { column: "", query: "贝特瑞", codes: ["920185"] } },
  { id: "shanshan", name_ko: "샨샨", name_zh: "杉杉股份", name_en: "Shanshan", type_tags: ["anode"], priority: 2, aliases: ["杉杉股份", "Shanshan"], cninfo: { column: "sse", query: "杉杉股份", codes: ["600884"] } },
  { id: "putailai", name_ko: "푸타이라이", name_zh: "璞泰来", name_en: "Putailai", type_tags: ["anode"], priority: 6, aliases: ["璞泰来", "Putailai", "Zichen"], cninfo: { column: "sse", query: "璞泰来", codes: ["603659"] } },
  { id: "zhongke-electric", name_ko: "중커전기", name_zh: "中科电气", name_en: "Zhongke Electric", type_tags: ["anode"], priority: 3, aliases: ["中科电气", "Zhongke Electric", "Zhongke Xingcheng"], cninfo: { column: "szse", query: "中科电气", codes: ["300035"] } },
  { id: "shangtai-technology", name_ko: "Shangtai Technology", name_zh: "尚太科技", name_en: "Shangtai Technology", type_tags: ["anode"], priority: 4, aliases: ["尚太科技", "Shangtai"], search_aliases: ["상타이"], cninfo: { column: "szse", query: "尚太科技", codes: ["001301"] } },
  { id: "xiangfenghua", name_ko: "Xiangfenghua", name_zh: "翔丰华", name_en: "Xiangfenghua", type_tags: ["anode"], priority: null, aliases: ["翔丰华", "Xiangfenghua"], search_aliases: ["샹펑화"], cninfo: { column: "szse", query: "翔丰华", codes: ["300890"] } },
  { id: "kaijin-new-energy", name_ko: "Kaijin New Energy", name_zh: "凯金新能源", name_en: "Kaijin New Energy", type_tags: ["anode"], priority: 5, aliases: ["凯金新能源", "Kaijin"], search_aliases: ["카이진"] },
  { id: "kuntian-new-energy", name_ko: "Kuntian New Energy", name_zh: "坤天新能源", name_en: "Kuntian New Energy", type_tags: ["anode"], priority: null, aliases: ["坤天新能源", "Kuntian"] },
  { id: "carbon-one", name_ko: "Carbon One", name_zh: "碳一新能源", name_en: "Carbon One", type_tags: ["anode"], priority: null, aliases: ["碳一新能源", "Carbon One"] },
];

// 신규 수집·백필에 집중할 핵심 26개사. COMPANIES는 과거 데이터 조회와 회사 귀속을 위해
// 그대로 유지하고, 비활성 회사의 기존 event/knowledge_chunk도 삭제하지 않는다.
export const TRACKED_COMPANY_IDS = new Set([
  "catl", "byd", "eve-energy", "calb", "gotion", "sunwoda", "hithium", "rept", "svolt", "farasis",
  "ronbay", "hunan-yuneng", "dynanonic", "xtc-new-energy", "easpring", "zhenhua-new-material",
  "wanrun-new-energy", "lopal", "fulin-precision", "reshine", "youshan",
  "btr", "shanshan", "zhongke-electric", "shangtai-technology", "kaijin-new-energy",
]);
export const TRACKED_COMPANIES = COMPANIES.filter((company) => TRACKED_COMPANY_IDS.has(company.id));

// 관리 화면의 설정은 신규 수집 대상에만 적용한다. SQL을 아직 적용하지 않은 배포나
// DB 읽기 실패에서는 검증된 기본 26개사로 안전하게 되돌아간다.
export async function trackedCompanies() {
  if (!hasDatabaseConfig()) return TRACKED_COMPANIES;
  try {
    const rows = await supabaseRest("company_tracking?select=company_id,is_active");
    const choices = new Map((rows || []).map((row) => [row.company_id, row.is_active]));
    return COMPANIES.filter((company) => choices.has(company.id) ? choices.get(company.id) : TRACKED_COMPANY_IDS.has(company.id));
  } catch (error) {
    console.warn("[COMPANY_TRACKING_FALLBACK]", String(error.message || error).slice(0, 160));
    return TRACKED_COMPANIES;
  }
}

function clean(value = "") { return String(value).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").trim(); }

async function fetchCatlNewsroom() {
  const response = await fetch("https://www.catl.com/news/", { headers: { "User-Agent": "Mozilla/5.0 (compatible; ChinaBatteryLens/0.1)" } });
  if (!response.ok) return []; const html = await response.text();
  const items = [...html.matchAll(/<a href="(\/news\/\d+\.html)"[^>]*>[\s\S]*?<p[^>]*class="mc_e1_txt"[^>]*>([\s\S]*?)<\/p>[\s\S]*?<div[^>]*class="mc_e1_date"[^>]*>([\s\S]*?)<\/div>/g)];
  return items.map((match) => ({ source: "CATL Newsroom", title: clean(match[2]), url: new URL(match[1], "https://www.catl.com").toString(), publishedAt: clean(match[3]), snippet: "宁德时代 공식 뉴스룸 발표", kind: "news", companyId: "catl" })).filter((item) => item.title && item.url);
}

function koreaDate(value = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(value);
}

// 검색 호출 한 건마다 결과 또는 실패 사유를 쌓는다. discoverChinaSources가 실행마다 비운다.
let webSearchOutcomes = [];
// 검색 요청 하나에 넣는 회사 수 상한. 제공자별로 다르다.
// DeepSeek은 회사 4곳으로도 한 요청에서 내부 검색을 12~17회 돌려 35초를 넘겼다(2026-09-07 09:28
// 전체 모드: 10요청 중 4건 시간초과). 회사 수를 줄이면 내부 검색도 줄어든다. 2곳까지 낮추면
// 제공자당 17요청이 되어 동시 호출이 과해지므로 3곳으로 둔다. 다음 실행 결과를 보고 조정한다.
const SEARCH_GROUP_SIZE = { openai: 4, deepseek: 3 };
const PILOT_COMPANY_IDS = ['catl', 'hunan-yuneng', 'btr'];
// 검증 기사가 0건인 핵심 비상장사를 처음 한 번 과거까지 훑는 창. 평상시 수집(3일)과 분리한다.
// 회사당 검색 요청은 여전히 1회뿐이라(단독 그룹) 창을 늘려도 요청 수·예산은 늘지 않는다.
// Reshine 확인 사례(2026-06-29 IPO 접수)는 90일 안에 들지만, IPO 이전 증설·수주 이력까지
// 걸리도록 365일로 둔다.
export const BOOTSTRAP_WINDOW_DAYS = 365;

// 검색 요청 단위를 만든다. 실제 실행과 예산 계산이 같은 함수를 써야 둘이 어긋나지 않는다.
// bootstrapCompanyIds에 든 회사는 일반 묶음(그룹 검색)에서 빼고, 회사당 단독 그룹으로 따로 낸다.
// 단독 그룹은 windowDays=365로 표시해 discoverWebSearchNews가 검색 기간을 다르게 준다.
export function buildSearchGroups(provider, pilot = false, bootstrapCompanyIds = [], companies = TRACKED_COMPANIES) {
  const size = SEARCH_GROUP_SIZE[provider] || 4;
  const bootstrapSet = new Set(pilot ? [] : bootstrapCompanyIds);
  const chains = [
    { label: "배터리 셀", tag: "cell" },
    { label: "양극재", tag: "cathode" },
    { label: "음극재", tag: "anode" },
  ];
  const normalGroups = chains.flatMap(({ label, tag }) => {
    let ids = companies.filter((company) => company.type_tags.includes(tag) && !bootstrapSet.has(company.id)).map((company) => company.id);
    if (pilot) ids = ids.filter((id) => PILOT_COMPANY_IDS.includes(id));
    const chunks = [];
    for (let index = 0; index < ids.length; index += size) chunks.push(ids.slice(index, index + size));
    return chunks.map((chunk, index) => ({
      label: chunks.length > 1 ? `${label} ${index + 1}/${chunks.length}` : label,
      ids: chunk,
    }));
  }).filter((group) => group.ids.length);
  if (!bootstrapSet.size) return normalGroups;
  const bootstrapGroups = companies
    .filter((company) => bootstrapSet.has(company.id))
    .map((company) => ({ label: `${company.name_ko} 과거 백필`, ids: [company.id], bootstrap: true, windowDays: BOOTSTRAP_WINDOW_DAYS }));
  return [...normalGroups, ...bootstrapGroups];
}

// 이번 실행이 내보낼 검색 요청 수. 키가 없는 제공자는 아예 부르지 않으므로 세지 않는다.
export function plannedSearchRequests(pilot = false, bootstrapCompanyIds = [], companies = TRACKED_COMPANIES) {
  return ["openai", "deepseek"]
    .filter((provider) => llmConfig(provider))
    .reduce((total, provider) => total + buildSearchGroups(provider, pilot, bootstrapCompanyIds, companies).length, 0);
}


// 검색 프롬프트. 관리자 화면(파이프라인 보기)이 같은 함수를 불러 실제 값을 보여 준다.
// 화면에 옮겨 적으면 코드와 어긋나므로 정의를 한 곳에 두고 양쪽이 같이 읽는다.
export function searchProviderPrompt(provider) {
  return provider === "deepseek" ? "당신은 중국 현지 배터리 산업 리서처다. 중국어 원문과 중국 산업 전문매체·지역 정부·기업 발표를 우선한다. 회사마다 검색 1회씩만 하고, 그 결과에 기사가 없으면 그 회사는 건너뛴다. 같은 회사를 다른 검색어로 다시 찾지 않는다. 지금까지 실제 확인한 기사만 JSON으로 반환하며, 목표 건수는 상한일 뿐이라 0건이어도 그대로 반환한다. 찾지 못한 기사는 만들지 않는다." : "당신은 글로벌 배터리 산업 리서처다. 공식 발표와 신뢰 가능한 주요 언론을 우선해, 기업의 사업·생산·고객·기술·재무·해외 전략 변화를 폭넓게 탐색한다.";
}
export function searchInstructions(providerInstructions) {
  return `중국 이차전지 산업 뉴스 리서처다. 웹 검색을 이용한다. ${providerInstructions} 검색 결과에 실제로 제시된 원문 기사 URL만 반환한다. URL·제목·매체·날짜를 추정하거나 만들어내지 않는다. 광고, 자동차 소비자 리뷰, 주가 단신은 제외한다. 중국어/영어 원문 모두 가능하다. 대괄호 안은 서비스의 한국어 표준명과 중국어·영어 검색 별칭이다. 그룹 회사는 모회사뿐 아니라 명시된 주요 계열사 관련 기사도 찾되, 관계가 불명확한 동명사는 포함하지 않는다. 회사 목록은 탐색 범위이며 모든 회사의 기사를 반드시 찾을 필요는 없다. 실제 발견한 기사만 반환한다.`;
}

async function discoverWebSearchNews(provider, pilot = false, bootstrapCompanyIds = [], companies = TRACKED_COMPANIES) {
  if (!llmConfig(provider)) {
    // 키가 없어 아예 부르지 않은 것과, 불렀는데 결과가 없는 것은 원인이 전혀 다르다.
    webSearchOutcomes.push({ provider, group: "all", articles: 0, error: "NOT_CONFIGURED" });
    return [];
  }
  const groups = buildSearchGroups(provider, pilot, bootstrapCompanyIds, companies);
  // 그룹 안 회사 수가 많으면(양극재 13곳 등) 고정 12건으로는 뉴스가 많은 대기업이 슬롯을
  // 대부분 가져가 존재감 작은 회사가 검색되고도 상위 12건에서 밀려날 수 있다.
  // 회사 수에 비례해 여유를 두되 한 번 호출에서 과하게 늘지 않도록 상한을 둔다.
  // 요청 건수를 올리면 모델이 검색을 그만큼 더 돌린다. 너무 올리면 검색만 반복하다
  // 최종 JSON을 못 내고 끝나므로(특히 DeepSeek) 상한을 18로 눌러 둔다.
  // DeepSeek은 이 상한을 목표로 여겨 채울 때까지 검색을 반복한다. 2026-09-07 09:28 실행에서 뉴스가
  // 적은 그룹일수록 검색이 늘었고(7회→12회→17회), 입력 토큰이 4만→10만→20만으로 가속하며 35초를
  // 넘겼다. 하한 6은 회사 1~4곳 그룹에 똑같이 6건을 요구해 묶음을 잘게 쪼개도 효과가 없었다.
  // DeepSeek은 회사당 1건 정도만 요구한다. OpenAI는 없으면 스스로 4~5회에 그만두므로 그대로 둔다.
  const articleCap = (companyCount) => provider === "deepseek"
    ? Math.min(6, Math.max(2, companyCount))
    : Math.min(18, Math.max(6, Math.round(companyCount * 1.5)));
  const schema = (maxItems) => ({
    type: "object", additionalProperties: false, required: ["articles"],
    properties: { articles: { type: "array", maxItems, items: {
      type: "object", additionalProperties: false,
      required: ["title", "url", "source_name", "published_at", "snippet"],
      properties: {
        title: { type: "string" }, url: { type: "string" }, source_name: { type: "string" },
        published_at: { type: ["string", "null"] }, snippet: { type: "string" }
      }
    } } }
  });
  const providerInstructions = searchProviderPrompt(provider);
  const results = await Promise.all(groups.map(async (group) => {
    // 일반 그룹은 최근 3일, bootstrap 그룹(검증 기사 0건인 핵심 비상장사)은 365일을 훑는다.
    const windowDays = group.windowDays || 3;
    const until = koreaDate();
    const since = koreaDate(new Date(Date.now() - windowDays * 86400000));
    try {
      const names = group.ids.map((id) => {
        const company = COMPANIES.find((item) => item.id === id);
        const groupEntities = groupSearchEntities(id).join(" / ");
        return `${company.name_ko} [${company.name_zh}${company.name_en ? `(${company.name_en})` : ""}${groupEntities ? `; ${groupEntities}` : ""}]`;
      }).join("、");
      const maxItems = pilot ? 2 : articleCap(group.ids.length);
      const result = await createJsonResponse({
        name: "china_battery_news_candidates", schema: schema(maxItems), webSearch: true,
        instructions: searchInstructions(providerInstructions),
        input: `${since}부터 ${until}까지 ${group.label} 그룹/기업(${names})의 사업·생산·증설·수주·고객·기술·재무·해외 전략과 직접 관련된 기사 후보를 최대 ${maxItems}건 찾으세요. 목표 건수는 상한이며 적게 찾았거나 없으면 그대로 반환하세요. 각 기사에는 제목, 원문 URL, 원 매체명, 발행일(모르면 null), 검색 결과에 보이는 1~2문장 요약을 반환하세요.`,
        provider
      });
      webSearchOutcomes.push({ provider, group: group.label, articles: (result.data.articles || []).length, telemetry: result.telemetry });
      return { articles: result.data.articles || [], sourceUrls: result.sourceUrls, provider: result.provider, bootstrap: Boolean(group.bootstrap) };
    } catch (error) {
      console.error("[WEB_SEARCH_FAILED]", JSON.stringify({ provider, message: error.message }));
      // 실패를 여기서 삼키고 빈 배열만 돌려주면 호출한 쪽은 "검색은 됐는데 결과가 없다"와
      // 구분하지 못한다. DeepSeek 발견 0건의 원인을 화면에서 볼 수 있도록 사유를 남긴다.
      webSearchOutcomes.push({ provider, group: group.label, articles: 0, error: String(error.message || error).slice(0, 300) });
      return { articles: [], sourceUrls: [], provider, bootstrap: Boolean(group.bootstrap) };
    }
  }));
  return results.flatMap(({ articles, sourceUrls, provider, bootstrap }) => articles.map((item) => ({ ...item, sourceUrls, provider, bootstrap }))).map((item) => {
    try {
      const url = new URL(item.url);
      if (!/^https?:$/.test(url.protocol)) return null;
      const matchesCitation = !item.sourceUrls.length || item.sourceUrls.some((sourceUrl) => {
        try { return new URL(sourceUrl).hostname === url.hostname; } catch { return false; }
      });
      if (!matchesCitation) return null;
      return { source: item.source_name || "Web news", title: clean(item.title), url: url.toString(), publishedAt: item.published_at || new Date().toISOString(), snippet: clean(item.snippet), kind: "web_search_news", searchProvider: item.provider, bootstrap: Boolean(item.bootstrap) };
    } catch { return null; }
  }).filter(Boolean);
}

function cninfoDateRange(days = 14) { const end = new Date(); const start = new Date(end.getTime() - days * 86400000); const format = (value) => value.toISOString().slice(0, 10); return `${format(start)}~${format(end)}`; }

async function fetchCninfo(company) {
  const params = new URLSearchParams({ pageNum: "1", pageSize: "20", tabName: "fulltext", column: company.cninfo.column, stock: "", searchkey: company.cninfo.query, secid: "", plate: "", category: "", trade: "", seDate: cninfoDateRange(), sortName: "", sortType: "", isHLtitle: "true" });
  const response = await fetch("https://www.cninfo.com.cn/new/hisAnnouncement/query", { method: "POST", headers: { "User-Agent": "Mozilla/5.0 (compatible; ChinaBatteryLens/0.1)", "Referer": "https://www.cninfo.com.cn/", "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "X-Requested-With": "XMLHttpRequest" }, body: params });
  if (!response.ok) return [];
  const payload = await response.json();
  const announcements = payload.announcements || [];
  // 전문 검색은 이름이 비슷한 다른 상장사 공시까지 돌려준다. 등록된 종목코드만 채택한다.
  const codes = company.cninfo.codes || [];
  const owned = codes.length ? announcements.filter((item) => codes.includes(String(item.secCode))) : announcements;
  // 종목코드·거래소·사명 변경으로 수집이 조용히 끊기는 것을 드러낸다.
  if (!owned.length) console.warn("[CNINFO_EMPTY]", JSON.stringify({ companyId: company.id, query: company.cninfo.query, column: company.cninfo.column, returned: announcements.length }));
  return owned.map((item) => ({ source: "CNINFO Disclosure", title: clean(item.announcementTitle), url: item.adjunctUrl ? `https://static.cninfo.com.cn/${item.adjunctUrl}` : "", publishedAt: item.announcementTime ? new Date(item.announcementTime).toISOString() : new Date().toISOString(), snippet: `${company.name_zh} (${item.secCode || ""}) 공식 공시`, kind: "disclosure", companyId: company.id })).filter((item) => item.title && item.url);
}

// 마지막 수집의 경로별 건수. 관리자 페이지가 "OpenAI가 몇 건, DeepSeek가 몇 건 찾았는지"를 보려면
// 중복 제거 전 수치가 필요하다. 함수 결과에는 중복 제거 뒤 목록만 남으므로 따로 둔다.
let lastDiscoveryStats = null;
export function discoveryStats() { return lastDiscoveryStats; }

// 후보 항목이 어느 경로에서 왔는지 한 단어로 적는다. article.discovered_via에 저장된다.
export function discoveredVia(item) {
  if (item.kind === "disclosure") return "cninfo";
  if (item.kind === "web_search_news") {
    const providers = item.searchProviders?.length ? item.searchProviders : [item.searchProvider || "discovered"];
    return `web_search_${[...new Set(providers)].sort().join("+")}`;
  }
  if (item.source === "CATL Newsroom") return "catl_newsroom";
  return "other";
}

export async function discoverChinaSources({pilot = false, bootstrapCompanyIds = []} = {}) {
  webSearchOutcomes = [];
  const companies = await trackedCompanies();
  const selected = companies.filter(company => company.cninfo && (!pilot || ['catl','hunan-yuneng','btr'].includes(company.id)));
  const labels = ["web_search_openai", "web_search_deepseek", "catl_newsroom", ...selected.map((company) => `cninfo:${company.id}`)];
  const collectors = [discoverWebSearchNews("openai",pilot,bootstrapCompanyIds,companies), discoverWebSearchNews("deepseek",pilot,bootstrapCompanyIds,companies), fetchCatlNewsroom(), ...selected.map(fetchCninfo)];
  const results = await Promise.allSettled(collectors);
  const items = [];
  const stats = { raw: {}, failed: [] };
  results.forEach((result, index) => {
    const label = labels[index].startsWith("cninfo:") ? "cninfo" : labels[index];
    if (result.status === "fulfilled") {
      items.push(...result.value);
      stats.raw[label] = (stats.raw[label] || 0) + result.value.length;
    } else {
      console.error("[SOURCE_COLLECTION_FAILED]", result.reason?.message || "unknown_error");
      stats.failed.push({ source: labels[index], message: String(result.reason?.message || "unknown_error").slice(0, 200) });
    }
  });
  // 같은 URL을 두 검색 제공자가 모두 찾으면 하나만 남기되, 두 곳이 찾았다는 사실은 남긴다.
  const unique = new Map();
  for (const item of items) {
    const prev = unique.get(item.url);
    if (!prev) { unique.set(item.url, { ...item, searchProviders: item.searchProvider ? [item.searchProvider] : [] }); continue; }
    if (item.searchProvider && !prev.searchProviders.includes(item.searchProvider)) prev.searchProviders.push(item.searchProvider);
  }
  const deduped = [...unique.values()];
  stats.unique = deduped.length;
  stats.by_via = deduped.reduce((acc, item) => ({ ...acc, [discoveredVia(item)]: (acc[discoveredVia(item)] || 0) + 1 }), {});
  // 검색 호출별 결과·실패 사유. "DeepSeek 0건"의 원인이 키 없음인지, 호출 오류인지,
  // 빈 출력인지, 정말 결과가 없는 것인지를 이 목록이 가른다.
  stats.web_search = webSearchOutcomes;
  for (const outcome of webSearchOutcomes) {
    if (outcome.error) stats.failed.push({ source: `${outcome.provider}:${outcome.group}`, message: outcome.error });
  }
  lastDiscoveryStats = stats;
  return deduped;
}

// 회사 별칭에 더해 공식 확인된 그룹 계열사명도 같은 회사 ID로 연결한다.
export function companyAliases(company) {
  return [...new Set([...company.aliases, ...groupAliases(company.id)])];
}

// 검색·질문 해석 전용 회사 표기. aliases와 일부러 나눠 둔다.
//
// aliases는 기사→회사 귀속(companiesFor)과 데이터 감사(data-audit)가 함께 쓴다. 거기에 한국어
// 표기를 섞으면 수집 단계의 귀속 규칙이 같이 바뀌어, 검색을 고치려다 어느 기사가 어느 회사 것인지가
// 달라진다. 그래서 검색 쪽만 넓힌다.
//
// 왜 필요했나(2026-09-09 실측). 추적 32개사 중 16개사는 name_ko가 영문이고 한국어 별칭이 하나도
// 없었다. "완룬신에너지"·"파라시스"라고 물으면 회사가 아예 인식되지 않아 회사 관련 검색어가 추가되지
// 않았고, 정량 사전조회(T4)도 발동하지 않았다. RAG 평가 기준선에서 점수가 낮은 네 질문 중 둘이
// 이 경우였다. 표기는 지어내지 않고 파이프라인이 이미 번역해 쌓아 둔 것을 DB에서 세어 골랐다
// (등장 1회 이상, 다른 회사와 충돌 0).
export function companySearchTerms(company) {
  return [...new Set([...companyAliases(company), ...(company.search_aliases || [])])];
}

export function companiesFor(item, companies = TRACKED_COMPANIES) {
  if (item.companyId) return companies.filter((company) => company.id === item.companyId);
  const corpus = `${item.title} ${item.snippet}`.toLowerCase();
  return companies.filter((company) => companyAliases(company).some((alias) => corpus.includes(alias.toLowerCase())));
}
