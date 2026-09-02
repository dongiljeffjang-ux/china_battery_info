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

export function sankeyFlowsFromArticles(articles = []) {
  const deduped = new Map();
  for (const article of articles) {
    const direction = headlineDirection(article);
    if (direction === "neutral") continue;
    for (const link of article.article_company || []) {
      for (const rawKeyword of article.keywords_ko || []) {
        const keyword = normalizeSankeyKeyword(rawKeyword);
        if (!keyword) continue;
        // A repeated keyword inside one article must never inflate a flow.
        const key = `${article.id}\u0000${link.company_id}\u0000${direction}\u0000${keyword}`;
        deduped.set(key, { company_id: link.company_id, keyword, direction });
      }
    }
  }
  return [...deduped.values()];
}
