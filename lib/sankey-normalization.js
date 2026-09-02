// Sankey is an editorial signal view, not a raw keyword dump.  Keep labels
// stable so the same event is not rendered as several near-identical nodes.
const COMPANY_ONLY = /^(?:catl|byd|lg\s*energy\s*solution|lges|gotion|high-tech|calb|eve|(?:닝더)?시대|비야디|국헌|중촹신항|억웨이|고션)(?:[·,、\s/-]+(?:catl|byd|lg\s*energy\s*solution|lges|gotion|high-tech|calb|eve|(?:닝더)?시대|비야디|국헌|중촹신항|억웨이|고션))*$/i;

export function normalizeSankeyKeyword(value = "") {
  const keyword = String(value)
    .replace(/[·•]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!keyword || COMPANY_ONLY.test(keyword)) return null;

  const compact = keyword.replace(/[\s·,，·-]/g, "").toLowerCase();
  if (/구이저우|贵州/.test(keyword) && /프로젝트|项目|일체화|통합/.test(keyword)) return "구이저우 소재 프로젝트";
  if (/홍콩|hk|h주/.test(keyword) && /상장|listing|ipo/.test(keyword)) return "홍콩 상장";
  if (/가동률|产能利用率|생산능력이용률/.test(keyword)) return "가동률";
  if (/(인산철|lfp|磷酸铁).*(양극|正极).*(판매|출하|销量|出货)/.test(keyword)) return "LFP 양극재 판매·출하";
  if (/증설|扩产|产能/.test(keyword) && /양극|正极/.test(keyword)) return "양극재 증설";
  if (/증설|扩产|产能/.test(keyword) && /음극|负极/.test(keyword)) return "음극재 증설";
  if (/프로젝트|项目/.test(keyword) && compact.length < 7) return null;
  return keyword;
}

export function headlineDirection(article = {}) {
  const headline = `${article.title_ko || ""} ${article.title_original || ""}`.toLowerCase();
  const positive = ["증설", "증가", "상승", "가동", "착공", "수주", "인증", "출하", "양산", "투자", "협력", "흑자", "扩产", "增长", "投产", "开工", "订单", "认证", "出货", "量产", "投资", "盈利", "increase", "production", "order"];
  const negative = ["감소", "하락", "적자", "손실", "중단", "철수", "폐쇄", "지연", "리콜", "벌금", "소송", "감원", "축소", "下降", "亏损", "停产", "退出", "关闭", "延期", "召回", "处罚", "诉讼", "裁员", "减产", "decline", "loss", "shutdown", "delay"];
  const score = (terms) => terms.reduce((total, term) => total + (headline.includes(term) ? 1 : 0), 0);
  const up = score(positive); const down = score(negative);
  return up > down ? "positive" : down > up ? "negative" : "neutral";
}

// 신호가 아니라 맥락일 뿐인 라벨. 부처·기관·매체·일반 산업명은 방향을 가질 수 없다.
const NOT_A_SIGNAL = /^(공업정보화부|국가발전개혁위|국가에너지국|재정부|상무부|공신부|중국자동차공업협회|工信部|发改委|能源局|리튬전지 ?산업|이차전지 ?산업|배터리 ?산업|신에너지 ?산업|출하량 ?순위|시장 ?점유율|업계 ?동향|산업 ?동향|정책|규제)$/i;

// 기사 하나가 만드는 신호를 뽑는다.
// headline_signals(LLM이 신호별로 방향과 근거를 판단한 결과)가 있으면 그것을 쓴다.
// 없는 예전 기사는 keywords_ko + 제목 단어 세기라는 기존 방식으로 되돌아간다.
function signalsOf(article) {
  const stored = Array.isArray(article.headline_signals) ? article.headline_signals : [];
  if (stored.length) {
    return stored
      .map((signal) => ({
        keyword: normalizeSankeyKeyword(signal && signal.keyword_ko),
        direction: signal && signal.direction === "expansion" ? "positive" : signal && signal.direction === "contraction" ? "negative" : "neutral",
        reason: String((signal && signal.reason_ko) || "").trim()
      }))
      .filter((signal) => signal.keyword && signal.direction !== "neutral");
  }
  const direction = headlineDirection(article);
  if (direction === "neutral") return [];
  return (article.keywords_ko || [])
    .map((keyword) => ({ keyword: normalizeSankeyKeyword(keyword), direction, reason: "" }))
    .filter((signal) => signal.keyword);
}

export function sankeyFlowsFromArticles(articles = []) {
  const deduped = new Map();
  for (const article of articles) {
    for (const signal of signalsOf(article)) {
      if (NOT_A_SIGNAL.test(signal.keyword)) continue;
      for (const link of article.article_company || []) {
        // A repeated keyword inside one article must never inflate a flow.
        const key = [article.id, link.company_id, signal.direction, signal.keyword].join("|");
        deduped.set(key, {
          company_id: link.company_id,
          keyword: signal.keyword,
          direction: signal.direction,
          reason: signal.reason,
          title: article.title_ko || article.title_original || ""
        });
      }
    }
  }
  return [...deduped.values()];
}
