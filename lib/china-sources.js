import { createJsonResponse, llmConfig } from "./llm-provider.js";
import { groupAliases, groupSearchEntities } from "./company-groups.js";

// 추적 대상 선정 기준. 순위 수치 자체는 저장하지 않는다.
// priority는 SNE Research 공개 보도자료에서 확인한 밸류체인 내 순위이고,
// null은 SNE 상위 명단에서 확인하지 못한 회사다.
export const SELECTION_BASIS = {
  source_ko: "SNE Research 공개 보도자료",
  metric_ko: "셀 = EV·ESS 배터리 사용량, 양극재 = LFP·NCM 화학계별 출하량, 음극재 = 총 출하량",
  reviewed_on: "2026-09-02",
};

export const COMPANIES = [
  { id: "catl", name_ko: "닝더스다이(CATL)", name_zh: "宁德时代", name_en: "Contemporary Amperex Technology", type_tags: ["cell"], priority: 1, aliases: ["宁德时代", "CATL", "Contemporary Amperex Technology"], cninfo: { column: "szse", query: "宁德时代", codes: ["300750"] } },
  { id: "byd", name_ko: "비야디(BYD)", name_zh: "比亚迪", name_en: "BYD", type_tags: ["cell"], priority: 2, aliases: ["比亚迪", "BYD", "刀片电池", "Blade Battery"], cninfo: { column: "szse", query: "比亚迪", codes: ["002594"] } },
  { id: "eve-energy", name_ko: "이브에너지(EVE Energy)", name_zh: "亿纬锂能", name_en: "EVE Energy", type_tags: ["cell"], priority: 5, aliases: ["亿纬锂能", "EVE Energy"], cninfo: { column: "szse", query: "亿纬锂能", codes: ["300014"] } },
  { id: "calb", name_ko: "중촹신항(CALB)", name_zh: "中创新航", name_en: "CALB", type_tags: ["cell"], priority: 3, aliases: ["中创新航", "CALB"], hkex: { code: "03931" } },
  { id: "gotion", name_ko: "궈쉬안하이테크(Gotion)", name_zh: "国轩高科", name_en: "Gotion High-tech", type_tags: ["cell"], priority: 4, aliases: ["国轩高科", "Gotion", "Gotion High-tech"], cninfo: { column: "szse", query: "国轩高科", codes: ["002074"] } },
  { id: "sunwoda", name_ko: "신왕다(Sunwoda)", name_zh: "欣旺达", name_en: "Sunwoda", type_tags: ["cell"], priority: 7, aliases: ["欣旺达", "Sunwoda"], cninfo: { column: "szse", query: "欣旺达", codes: ["300207"] } },
  { id: "hithium", name_ko: "Hithium", name_zh: "海辰储能", name_en: "Hithium", type_tags: ["cell"], priority: null, aliases: ["海辰储能", "Hithium"] },
  { id: "rept", name_ko: "REPT BATTERO", name_zh: "瑞浦兰钧", name_en: "REPT BATTERO", type_tags: ["cell"], priority: null, aliases: ["瑞浦兰钧", "REPT", "REPT BATTERO"], hkex: { code: "00666" } },
  { id: "svolt", name_ko: "SVOLT", name_zh: "蜂巢能源", name_en: "SVOLT", type_tags: ["cell"], priority: 6, aliases: ["蜂巢能源", "SVOLT"] },
  { id: "farasis", name_ko: "Farasis Energy", name_zh: "孚能科技", name_en: "Farasis Energy", type_tags: ["cell"], priority: null, aliases: ["孚能科技", "Farasis"], cninfo: { column: "sse", query: "孚能科技", codes: ["688567"] } },
  { id: "ronbay", name_ko: "룽바이(Ronbay)", name_zh: "容百科技", name_en: "Ronbay", type_tags: ["cathode", "cathode_ncm"], priority: 2, aliases: ["容百科技", "Ronbay", "Ningbo Ronbay"], cninfo: { column: "sse", query: "容百科技", codes: ["688005"] } },
  { id: "hunan-yuneng", name_ko: "후난위넝", name_zh: "湖南裕能", name_en: "Hunan Yuneng", type_tags: ["cathode", "cathode_lfp"], priority: 1, aliases: ["湖南裕能", "Hunan Yuneng"], cninfo: { column: "szse", query: "湖南裕能", codes: ["301358"] } },
  { id: "dynanonic", name_ko: "Dynanonic", name_zh: "德方纳米", name_en: "Dynanonic", type_tags: ["cathode", "cathode_lfp"], priority: 3, aliases: ["德方纳米", "Dynanonic"], cninfo: { column: "szse", query: "德方纳米", codes: ["300769"] } },
  { id: "xtc-new-energy", name_ko: "XTC New Energy", name_zh: "厦钨新能", name_en: "XTC New Energy", type_tags: ["cathode", "cathode_ncm"], priority: null, aliases: ["厦钨新能", "XTC New Energy"], cninfo: { column: "sse", query: "厦钨新能", codes: ["688778"] } },
  { id: "easpring", name_ko: "Easpring", name_zh: "当升科技", name_en: "Easpring", type_tags: ["cathode", "cathode_ncm"], priority: null, aliases: ["当升科技", "Easpring"], cninfo: { column: "szse", query: "当升科技", codes: ["300073"] } },
  { id: "zhenhua-new-material", name_ko: "Zhenhua New Material", name_zh: "振华新材", name_en: "Zhenhua New Material", type_tags: ["cathode", "cathode_ncm"], priority: null, aliases: ["振华新材", "Zhenhua New Material"], cninfo: { column: "sse", query: "振华新材", codes: ["688707"] } },
  { id: "changyuan-lico", name_ko: "우쾅신넝(五矿新能)", name_zh: "五矿新能", name_en: "Minmetals New Energy", type_tags: ["cathode", "cathode_ncm"], priority: null, aliases: ["五矿新能", "五矿新能源材料", "长远锂科", "Changyuan Lico"], cninfo: { column: "sse", query: "五矿新能", codes: ["688779"] }, note_ko: "2024-08-09자로 湖南长远锂科 → 五矿新能源材料（湖南）로 사명 변경. 옛 이름도 검색 별칭으로 유지한다." },
  { id: "wanrun-new-energy", name_ko: "Wanrun New Energy", name_zh: "万润新能", name_en: "Wanrun New Energy", type_tags: ["cathode", "cathode_lfp"], priority: 2, aliases: ["万润新能", "Wanrun New Energy"], cninfo: { column: "sse", query: "万润新能", codes: ["688275"] } },
  { id: "lopal", name_ko: "Lopal Tech", name_zh: "龙蟠科技", name_en: "Lopal Tech", type_tags: ["cathode", "cathode_lfp"], priority: 5, aliases: ["龙蟠科技", "Lopal"], cninfo: { column: "sse", query: "龙蟠科技", codes: ["603906"] } },
  { id: "fulin-precision", name_ko: "푸린정공(富临精工)", name_zh: "富临精工", name_en: "Fulin Precision", type_tags: ["cathode", "cathode_lfp"], priority: null, aliases: ["富临精工", "Fulin Precision"], cninfo: { column: "szse", query: "富临精工", codes: ["300432"] }, note_ko: "LFP 양극재는 자회사 江西升华新材料가 담당한다. CATL이 2025~2027년 연 14만톤 이상 구매를 약정하고 15억 위안을 선급했다. SNE 공개 보도자료 상위 명단에서 확인하지 못해 priority는 비워 둔다." },
  { id: "cnrg", name_ko: "중웨이신차이(CNGR)", name_zh: "中伟新材", name_en: "CNGR", type_tags: ["cathode"], priority: null, aliases: ["中伟新材", "中伟新材料", "中伟股份", "CNGR"], cninfo: { column: "szse", query: "中伟新材", codes: ["300919"] }, note_ko: "삼원계 전구체 업체라 SNE 양극재 출하 순위 대상이 아니다. 证券简称이 中伟股份에서 中伟新材로 바뀌어 옛 이름도 별칭으로 남긴다." },
  { id: "reshine", name_ko: "루이샹 신소재(Reshine)", name_zh: "湖南瑞翔新材料股份有限公司", name_en: "Hunan Reshine New Material", type_tags: ["cathode", "cathode_ncm"], priority: 1, aliases: ["瑞翔新材", "湖南瑞翔", "南通瑞翔", "Reshine"], listed: false, note_ko: "비상장. 金川集团 계열이며 연차보고서가 없어 그룹 계열사를 등록하지 않는다." },
  { id: "youshan", name_ko: "유산과기(Youshan)", name_zh: "友山科技", name_en: "Youshan Technology", type_tags: ["cathode", "cathode_lfp"], priority: 4, aliases: ["友山科技", "友山"], listed: false, note_ko: "비상장. 상장사 华友钴业이 아니라 지주사 华友控股集团의 전액출자 자회사다. 연차보고서가 없어 그룹 계열사를 등록하지 않는다." },
  { id: "btr", name_ko: "BTR", name_zh: "贝特瑞", name_en: "BTR", type_tags: ["anode"], priority: 1, aliases: ["贝特瑞", "BTR", "Beijing BTR"], cninfo: { column: "", query: "贝特瑞", codes: ["920185"] } },
  { id: "shanshan", name_ko: "샨샨", name_zh: "杉杉股份", name_en: "Shanshan", type_tags: ["anode"], priority: 2, aliases: ["杉杉股份", "Shanshan"], cninfo: { column: "sse", query: "杉杉股份", codes: ["600884"] } },
  { id: "putailai", name_ko: "푸타이라이", name_zh: "璞泰来", name_en: "Putailai", type_tags: ["anode"], priority: 6, aliases: ["璞泰来", "Putailai", "Zichen"], cninfo: { column: "sse", query: "璞泰来", codes: ["603659"] } },
  { id: "zhongke-electric", name_ko: "중커전기", name_zh: "中科电气", name_en: "Zhongke Electric", type_tags: ["anode"], priority: 3, aliases: ["中科电气", "Zhongke Electric", "Zhongke Xingcheng"], cninfo: { column: "szse", query: "中科电气", codes: ["300035"] } },
  { id: "shangtai-technology", name_ko: "Shangtai Technology", name_zh: "尚太科技", name_en: "Shangtai Technology", type_tags: ["anode"], priority: 4, aliases: ["尚太科技", "Shangtai"], cninfo: { column: "szse", query: "尚太科技", codes: ["001301"] } },
  { id: "xiangfenghua", name_ko: "Xiangfenghua", name_zh: "翔丰华", name_en: "Xiangfenghua", type_tags: ["anode"], priority: null, aliases: ["翔丰华", "Xiangfenghua"], cninfo: { column: "szse", query: "翔丰华", codes: ["300890"] } },
  { id: "kaijin-new-energy", name_ko: "Kaijin New Energy", name_zh: "凯金新能源", name_en: "Kaijin New Energy", type_tags: ["anode"], priority: 5, aliases: ["凯金新能源", "Kaijin"] },
  { id: "kuntian-new-energy", name_ko: "Kuntian New Energy", name_zh: "坤天新能源", name_en: "Kuntian New Energy", type_tags: ["anode"], priority: null, aliases: ["坤天新能源", "Kuntian"] },
  { id: "carbon-one", name_ko: "Carbon One", name_zh: "碳一新能源", name_en: "Carbon One", type_tags: ["anode"], priority: null, aliases: ["碳一新能源", "Carbon One"] },
];

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

async function discoverWebSearchNews(provider) {
  if (!llmConfig(provider)) return [];
  const until = koreaDate();
  const since = koreaDate(new Date(Date.now() - 3 * 86400000));
  const groups = [
    { label: "배터리 셀", ids: COMPANIES.filter((company) => company.type_tags.includes("cell")).map((company) => company.id) },
    { label: "양극재", ids: COMPANIES.filter((company) => company.type_tags.includes("cathode")).map((company) => company.id) },
    { label: "음극재", ids: COMPANIES.filter((company) => company.type_tags.includes("anode")).map((company) => company.id) }
  ];
  // 그룹 안 회사 수가 많으면(양극재 13곳 등) 고정 12건으로는 뉴스가 많은 대기업이 슬롯을
  // 대부분 가져가 존재감 작은 회사가 검색되고도 상위 12건에서 밀려날 수 있다.
  // 회사 수에 비례해 여유를 두되 한 번 호출에서 과하게 늘지 않도록 상한을 둔다.
  const articleCap = (companyCount) => Math.min(24, Math.max(12, companyCount * 2));
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
  const providerInstructions = provider === "deepseek"
    ? "당신은 중국 현지 배터리 산업 리서처다. 다른 검색 제공자의 결과를 반복하지 않는 독립 탐색을 수행한다. 중국어 원문을 우선하며, 중국 산업 전문매체·지역 정부/산업단지 발표·상장사/계열사 발표를 적극 탐색한다. 국제 영문 매체에서 쉽게 찾을 수 있는 동일 보도보다 중국 현지의 구체적인 증설·가동·고객·기술·재무·해외 법인 정보를 우선한다."
    : "당신은 글로벌 배터리 산업 리서처다. 공식 발표와 신뢰 가능한 주요 언론을 우선해, 기업의 사업·생산·고객·기술·재무·해외 전략 변화를 폭넓게 탐색한다.";
  const results = await Promise.all(groups.map(async (group) => {
    try {
      const names = group.ids.map((id) => {
        const company = COMPANIES.find((item) => item.id === id);
        const groupEntities = groupSearchEntities(id).join(" / ");
        return `${company.name_ko} [${company.name_zh}${company.name_en ? `(${company.name_en})` : ""}${groupEntities ? `; ${groupEntities}` : ""}]`;
      }).join("、");
      const maxItems = articleCap(group.ids.length);
      const result = await createJsonResponse({
        name: "china_battery_news_candidates", schema: schema(maxItems), webSearch: true,
        instructions: `중국 이차전지 산업 뉴스 리서처다. 웹 검색을 이용한다. ${providerInstructions} 검색 결과에 실제로 제시된 원문 기사 URL만 반환한다. URL·제목·매체·날짜를 추정하거나 만들어내지 않는다. 광고, 자동차 소비자 리뷰, 주가 단신은 제외한다. 중국어/영어 원문 모두 가능하다. 대괄호 안은 서비스의 한국어 표준명과 중국어·영어 검색 별칭이다. 그룹 회사는 모회사뿐 아니라 명시된 주요 계열사 관련 기사도 찾되, 관계가 불명확한 동명사는 포함하지 않는다. 뉴스가 많은 대기업 기사로만 결과를 채우지 말고, 나열된 회사마다 가능한 한 최소 1건씩은 찾아 목록에 넣어 회사별로 고르게 분산시킨다.`,
        input: `${since}부터 ${until}까지 ${group.label} 그룹/기업(${names})의 사업·생산·증설·수주·고객·기술·재무·해외 전략과 직접 관련된 기사 후보를 최대 ${maxItems}건 찾으세요. 특정 회사에 기사가 몰리지 않도록 목록에 나온 회사들을 고르게 다뤄 주세요. 각 기사에는 제목, 원문 URL, 원 매체명, 발행일(모르면 null), 검색 결과에 보이는 1~2문장 요약을 반환하세요.`,
        provider
      });
      return { articles: result.data.articles || [], sourceUrls: result.sourceUrls, provider: result.provider };
    } catch (error) {
      console.error("[WEB_SEARCH_FAILED]", JSON.stringify({ provider, message: error.message }));
      return { articles: [], sourceUrls: [], provider };
    }
  }));
  return results.flatMap(({ articles, sourceUrls, provider }) => articles.map((item) => ({ ...item, sourceUrls, provider }))).map((item) => {
    try {
      const url = new URL(item.url);
      if (!/^https?:$/.test(url.protocol)) return null;
      const matchesCitation = !item.sourceUrls.length || item.sourceUrls.some((sourceUrl) => {
        try { return new URL(sourceUrl).hostname === url.hostname; } catch { return false; }
      });
      if (!matchesCitation) return null;
      return { source: item.source_name || "Web news", title: clean(item.title), url: url.toString(), publishedAt: item.published_at || new Date().toISOString(), snippet: clean(item.snippet), kind: "web_search_news", searchProvider: item.provider };
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

export async function discoverChinaSources() {
  const collectors = [discoverWebSearchNews("openai"), discoverWebSearchNews("deepseek"), fetchCatlNewsroom(), ...COMPANIES.filter((company) => company.cninfo).map(fetchCninfo)];
  const results = await Promise.allSettled(collectors);
  const items = [];
  for (const result of results) {
    if (result.status === "fulfilled") items.push(...result.value);
    else console.error("[SOURCE_COLLECTION_FAILED]", result.reason?.message || "unknown_error");
  }
  return [...new Map(items.map((item) => [item.url, item])).values()];
}

// 회사 별칭에 더해 공식 확인된 그룹 계열사명도 같은 회사 ID로 연결한다.
export function companyAliases(company) {
  return [...new Set([...company.aliases, ...groupAliases(company.id)])];
}

export function companiesFor(item) {
  if (item.companyId) return COMPANIES.filter((company) => company.id === item.companyId);
  const corpus = `${item.title} ${item.snippet}`.toLowerCase();
  return COMPANIES.filter((company) => companyAliases(company).some((alias) => corpus.includes(alias.toLowerCase())));
}
