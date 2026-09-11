// Sankey는 편집된 신호 뷰다. 키워드를 그대로 쏟아 놓는 화면이 아니다.
//
// 오른쪽 노드는 아래 THEMES 10개로 고정한다. LLM이 뽑은 키워드(headline_signals.keyword_ko)도,
// 본문을 읽지 않은 헤드라인에서 규칙으로 뽑은 신호도 전부 이 10개로 접는다.
// 표본이 하루 50건에서 수백 건으로 늘어도 노드 수가 그대로여야 그림이 읽힌다.
// "양극재 증설", "증설", "신규 라인 가동", "扩产"이 서로 다른 노드로 갈라져 건수가 흩어지는 문제를
// 라벨 정규화 규칙 몇 줄로 막던 예전 방식은 라벨이 늘수록 규칙도 늘어 유지가 안 됐다.
//
// 각 테마는 확대(expansion)·축소(contraction) 용어 목록을 갖는다. 한국어·중국어·영어를 함께 둔다.
// 번역된 헤드라인(title_ko)과 원문 제목(title_original)을 둘 다 훑기 때문이다.

export const THEMES = [
  {
    key: "capacity", label: "생산능력",
    expansion: ["증설", "신공장", "신규 라인", "라인 가동", "착공", "준공", "가동 개시", "가동 시작", "생산능력 확대", "생산 확대", "증산", "扩产", "扩建", "新建", "投产", "开工", "动工", "奠基", "竣工", "投建", "产能扩张", "产能提升", "增产", "new plant", "capacity expansion", "groundbreaking", "commissioning"],
    contraction: ["감산", "가동 중단", "가동중단", "생산 중단", "생산중단", "공장 폐쇄", "폐쇄", "라인 중단", "가동률 하락", "가동률 저하", "减产", "停产", "停工", "关停", "关闭", "闲置", "产能利用率下降", "shutdown", "idle", "halt production"],
  },
  {
    key: "shipment", label: "출하·판매",
    expansion: ["출하량 증가", "출하 증가", "판매 증가", "출하량 확대", "판매량 증가", "점유율 상승", "점유율 확대", "출하 1위", "판매 1위", "장착량 증가", "出货量增长", "出货增长", "销量增长", "销量大增", "装机量增长", "份额提升", "市占率提升", "出货量第一", "销量第一", "shipments rose", "shipments grew", "sales rose", "market share gain"],
    contraction: ["출하량 감소", "출하 감소", "판매 감소", "판매량 감소", "점유율 하락", "점유율 감소", "장착량 감소", "出货量下降", "出货下滑", "销量下降", "销量下滑", "装机量下降", "份额下滑", "市占率下降", "shipments fell", "sales fell", "market share loss"],
  },
  {
    key: "orders", label: "수주·고객",
    expansion: ["수주", "정점", "공급 계약", "공급계약", "장기 계약", "장기계약", "납품 계약", "공급 협약", "고객 확보", "고객 인증", "인증 획득", "인증 통과", "지정 공급", "订单", "定点", "供货协议", "供应协议", "长期供应", "长协", "中标", "获得认证", "通过认证", "签订供应", "supply agreement", "supply contract", "won order", "nominated", "certification"],
    contraction: ["계약 해지", "계약해지", "계약 취소", "수주 취소", "공급 중단", "고객 이탈", "주문 감소", "수주 감소", "取消订单", "订单取消", "终止合作", "终止供应", "解除合同", "订单减少", "order cancel", "contract terminated", "lost customer"],
  },
  {
    key: "earnings", label: "실적·재무",
    expansion: ["매출 증가", "매출 성장", "영업이익 증가", "순이익 증가", "이익 증가", "흑자 전환", "흑자전환", "흑자", "실적 개선", "실적 호조", "사상 최대", "역대 최대", "营收增长", "收入增长", "净利润增长", "净利增长", "利润增长", "扭亏为盈", "扭亏", "盈利", "业绩增长", "创历史新高", "同比增长", "revenue rose", "profit rose", "record profit", "turned profitable"],
    contraction: ["매출 감소", "영업이익 감소", "순이익 감소", "이익 감소", "적자", "손실", "적자 전환", "적자전환", "실적 악화", "실적 부진", "이익 급감", "营收下降", "收入下降", "净利润下降", "净利下滑", "利润下滑", "亏损", "由盈转亏", "业绩下滑", "同比下降", "预亏", "revenue fell", "profit fell", "net loss", "loss widened"],
  },
  {
    key: "funding", label: "투자·자금조달",
    expansion: ["투자 유치", "투자 확대", "투자 결정", "증자", "유상증자", "상장", "IPO", "홍콩 상장", "회사채 발행", "자금 조달", "자금조달", "펀드 조성", "정부 보조금", "보조금 지원", "투자 계획", "投资", "增资", "上市", "港股上市", "H股", "募资", "融资", "定增", "发债", "可转债", "补贴", "获批", "IPO", "listing", "fundraising", "capital increase", "bond issuance"],
    contraction: ["투자 철회", "투자 중단", "투자 축소", "상장 철회", "상장 연기", "감자", "자금난", "유동성 위기", "채무 불이행", "디폴트", "撤回投资", "终止投资", "投资缩减", "终止上市", "撤回上市", "推迟上市", "减资", "资金链", "债务违约", "违约", "investment cancelled", "withdrew listing", "default"],
  },
  {
    key: "overseas", label: "해외 진출",
    expansion: ["해외 공장", "해외 생산", "해외 진출", "현지 생산", "현지화", "유럽 공장", "미국 공장", "헝가리", "모로코", "인도네시아", "스페인", "독일 공장", "태국 공장", "해외 수주", "수출 증가", "수출 확대", "海外工厂", "海外建厂", "海外基地", "出海", "本地化", "匈牙利", "摩洛哥", "印尼", "西班牙", "德国工厂", "泰国工厂", "出口增长", "overseas plant", "Hungary", "Morocco", "Indonesia", "localization", "exports rose"],
    contraction: ["해외 철수", "해외 사업 중단", "해외 공장 중단", "수출 감소", "관세 부과", "반덤핑", "제재 대상", "수출 통제", "해외 프로젝트 취소", "海外撤出", "退出海外", "海外项目终止", "出口下降", "加征关税", "反补贴", "反倾销", "制裁", "出口管制", "tariff", "anti-dumping", "sanction", "exit market", "exports fell"],
  },
  {
    key: "technology", label: "기술·제품",
    expansion: ["신제품", "신기술", "양산", "양산 개시", "양산 돌입", "전고체", "반고체", "나트륨", "나트륨이온", "실리콘 음극", "실리콘", "LMFP", "인산망간철리튬", "고밀도", "에너지 밀도", "급속충전", "초급속", "특허", "기술 돌파", "출시", "新品", "新技术", "量产", "固态电池", "半固态", "钠电", "钠离子", "硅碳", "硅负极", "磷酸锰铁锂", "能量密度", "快充", "超充", "专利", "技术突破", "推出", "首发", "solid-state", "sodium-ion", "silicon anode", "mass production", "launch", "patent", "fast charging"],
    contraction: ["기술 결함", "제품 결함", "리콜", "품질 문제", "화재", "폭발", "안전 사고", "불량", "양산 지연", "개발 중단", "召回", "缺陷", "质量问题", "起火", "爆炸", "自燃", "安全事故", "不合格", "量产推迟", "研发终止", "recall", "defect", "fire", "explosion", "delayed production"],
  },
  {
    key: "partnership", label: "협력·M&A",
    expansion: ["합작", "합작사", "합작법인", "전략 협력", "전략협력", "전략적 제휴", "제휴", "인수", "지분 인수", "지분 투자", "M&A", "협약 체결", "업무협약", "MOU", "파트너십", "공동 개발", "合资", "合资公司", "战略合作", "签署合作", "战略协议", "收购", "并购", "入股", "参股", "联合开发", "合作协议", "签约", "joint venture", "partnership", "acquisition", "strategic cooperation", "MOU", "stake"],
    contraction: ["합작 결렬", "협력 중단", "협력 종료", "제휴 해지", "매각", "지분 매각", "합작 해소", "인수 무산", "인수 철회", "合作终止", "终止合作", "合资终止", "出售", "转让股权", "出让", "剥离", "收购终止", "收购失败", "divest", "sold stake", "terminated partnership", "deal collapsed"],
  },
  {
    key: "price", label: "가격·원가",
    expansion: ["가격 인상", "가격 상승", "판가 인상", "단가 인상", "가격 반등", "탄산리튬 가격 상승", "리튬 가격 상승", "价格上涨", "涨价", "提价", "调涨", "价格上调", "价格回升", "碳酸锂涨价", "锂价上涨", "price increase", "price hike", "prices rose"],
    contraction: ["가격 인하", "가격 하락", "판가 하락", "단가 인하", "가격 경쟁", "저가 경쟁", "가격 전쟁", "덤핑", "탄산리튬 가격 하락", "리튬 가격 하락", "价格下跌", "降价", "价格下滑", "价格战", "内卷", "碳酸锂跌价", "锂价下跌", "低价竞争", "price cut", "price war", "prices fell"],
  },
  {
    key: "risk", label: "규제·리스크",
    expansion: ["규제 완화", "정책 지원", "지원 정책", "인허가 획득", "승인 획득", "허가 취득", "政策支持", "政策利好", "获批", "取得许可", "放宽", "policy support", "approval granted"],
    contraction: ["벌금", "과징금", "소송", "제소", "피소", "특허 침해", "제재", "조사 착수", "규제 강화", "감원", "구조조정", "인력 감축", "정리해고", "임원 사임", "경영진 교체", "파산", "법정관리", "罚款", "处罚", "诉讼", "起诉", "被诉", "专利侵权", "调查", "裁员", "减员", "重组", "辞职", "离职", "破产", "重整", "lawsuit", "fined", "penalty", "layoff", "restructuring", "bankruptcy", "investigation", "resign"],
  },
];

export const THEME_LABELS = Object.fromEntries(THEMES.map((theme) => [theme.key, theme.label]));

// 회사명만으로 된 라벨은 신호가 아니다. 예전 LLM 출력에 남아 있어 계속 걸러 준다.
const COMPANY_ONLY = /^(?:catl|byd|lg\s*energy\s*solution|lges|gotion|high-tech|calb|eve|(?:닝더)?시대|비야디|국헌|중촹신항|억웨이|고션)(?:[·,、\s/-]+(?:catl|byd|lg\s*energy\s*solution|lges|gotion|high-tech|calb|eve|(?:닝더)?시대|비야디|국헌|중촹신항|억웨이|고션))*$/i;

// 신호가 아니라 맥락일 뿐인 라벨. 부처·기관·매체·일반 산업명은 방향을 가질 수 없다.
const NOT_A_SIGNAL = /^(공업정보화부|국가발전개혁위|국가에너지국|재정부|상무부|공신부|중국자동차공업협회|工信部|发改委|能源局|리튬전지 ?산업|이차전지 ?산업|배터리 ?산업|신에너지 ?산업|출하량 ?순위|시장 ?점유율|업계 ?동향|산업 ?동향|정책|규제)$/i;

function normalizeText(value = "") {
  return String(value).replace(/[·•]/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
}

// 용어가 텍스트에 들어 있는지. 공백 유무 차이("가동 개시"/"가동개시")를 같은 것으로 본다.
// 띄어 쓴 한국어 두 단어 용어는 사이에 짧은 수식어가 끼어도 잡는다("가격 이미 인상" → 가격 인상).
// 2026-09-11 샨샨 헤드라인 "일부 음극재 제품 가격 이미 인상"이 신호로 안 잡혀 넣었다.
const GAP_CHARS = 6;
const gapPatterns = new Map();
function gapPattern(term) {
  if (!gapPatterns.has(term)) {
    const parts = term.split(/\s+/);
    const korean = parts.length === 2 && parts.every((part) => /^[가-힣]{2,}$/.test(part));
    gapPatterns.set(term, korean ? new RegExp(`${parts[0]}[^.,·;!?]{0,${GAP_CHARS}}?${parts[1]}`) : null);
  }
  return gapPatterns.get(term);
}
function includesTerm(text, compactText, term) {
  const lowered = term.toLowerCase();
  if (text.includes(lowered) || compactText.includes(lowered.replace(/\s+/g, ""))) return true;
  return Boolean(gapPattern(lowered)?.test(text));
}

// 텍스트에서 테마별 방향 신호를 찾는다. 한 테마에서 확대·축소 용어가 함께 잡히면
// 그 테마는 방향을 가릴 수 없으므로 뺀다. 한 제목이 여러 테마를 건드릴 수 있다
// ("헝가리 공장 착공"은 생산능력과 해외 진출 둘 다).
export function themeSignalsFromText(text = "") {
  const lowered = normalizeText(text);
  if (!lowered) return [];
  const compact = lowered.replace(/\s+/g, "");
  const signals = [];
  for (const theme of THEMES) {
    const up = theme.expansion.find((term) => includesTerm(lowered, compact, term));
    const down = theme.contraction.find((term) => includesTerm(lowered, compact, term));
    if (up && down) continue;
    if (up) signals.push({ theme: theme.key, direction: "positive", matched: up });
    else if (down) signals.push({ theme: theme.key, direction: "negative", matched: down });
  }
  return signals;
}

// LLM이 뽑은 자유 키워드를 테마 하나로 접는다. 키워드 자체에서 못 찾으면 판단 근거 문장을 본다.
// 방향은 LLM 판단을 그대로 쓴다. 여기서는 어느 테마인지만 정한다.
export function themeOfKeyword(keyword = "", reason = "") {
  const label = normalizeText(keyword);
  if (!label || COMPANY_ONLY.test(label) || NOT_A_SIGNAL.test(label)) return null;
  for (const source of [label, normalizeText(reason)]) {
    if (!source) continue;
    const compact = source.replace(/\s+/g, "");
    for (const theme of THEMES) {
      if ([...theme.expansion, ...theme.contraction].some((term) => includesTerm(source, compact, term))) return theme.key;
    }
  }
  return null;
}

// 툴팁에 실을 근거 문장. 도착지 라벨만 되풀이하면 왜 그 선이 그려졌는지 알 수 없으므로
// 기사에서 뽑은 실제 문장을 싣는다. 요약 첫 문장이 그 기사가 무엇을 말하는지 가장 잘 담는다.
function evidenceSentence(text, limit = 160) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  // 마침표는 22.99 같은 소수점에도 쓰이므로 뒤에 공백이나 끝이 오는 경우만 문장 끝으로 본다.
  const sentence = clean.match(/^.{15,}?(?:[。！？!?]|\.(?=\s|$))/);
  const head = sentence ? sentence[0] : clean;
  return head.length > limit ? `${head.slice(0, limit - 1)}…` : head;
}

// 본문 검증을 거친 기사 하나가 만드는 신호.
// headline_signals(LLM이 신호별로 방향과 근거를 판단한 결과)가 있으면 그것을 테마로 접는다.
// 없는 예전 기사는 제목·요약을 규칙으로 훑는다.
function verifiedSignalsOf(article) {
  const fallbackReason = evidenceSentence(article.summary_ko);
  const stored = Array.isArray(article.headline_signals) ? article.headline_signals : [];
  if (stored.length) {
    return stored
      .filter((signal) => signal && signal.direction !== "neutral")
      .map((signal) => ({
        theme: themeOfKeyword(signal.keyword_ko, signal.reason_ko),
        direction: signal.direction === "expansion" ? "positive" : "negative",
        keyword: String(signal.keyword_ko || "").trim(),
        reason: String(signal.reason_ko || "").trim() || fallbackReason,
      }))
      .filter((signal) => signal.theme);
  }
  return themeSignalsFromText(`${article.title_ko || ""} ${article.title_original || ""}`)
    .map((signal) => ({ ...signal, keyword: signal.matched, reason: fallbackReason }));
}

// 본문을 읽지 않은 헤드라인 하나가 만드는 신호. 번역된 제목과 원문 제목을 함께 훑는다.
// 근거 문장은 제목 그 자체다. 그 밖에 아는 게 없으니 그 이상을 적지 않는다.
function headlineSignalsOf(article) {
  return themeSignalsFromText(`${article.title_ko || ""} ${article.title_original || ""}`)
    .map((signal) => ({ ...signal, keyword: signal.matched, reason: "" }));
}

function collect(deduped, article, signals, grade) {
  for (const signal of signals) {
    for (const link of article.article_company || []) {
      // 한 기사 안에서 같은 테마가 두 번 잡혀도 흐름을 두 번 세지 않는다.
      const key = [article.id, link.company_id, signal.direction, signal.theme].join("|");
      if (deduped.has(key)) continue;
      deduped.set(key, {
        company_id: link.company_id,
        // 화면은 이 필드를 오른쪽 노드 라벨로 쓴다. 테마 라벨 10개 중 하나만 온다.
        keyword: THEME_LABELS[signal.theme],
        theme: signal.theme,
        direction: signal.direction,
        // 어떤 표현이 신호로 잡혔는지. 규칙 추출이 왜 그 테마로 봤는지 툴팁이 밝힐 수 있게 남긴다.
        matched: signal.keyword,
        reason: signal.reason,
        title: article.title_ko || article.title_original || "",
        // verified: 본문 대조를 거친 기사. headline: 제목만 있는 미검증 기사.
        grade,
        // Daily Top 10 기사에서 나온 신호. 화면이 선·툴팁에서 구분해 보인다.
        top10: article.is_top10 === true,
        published_at: article.published_at || "",
        // 같은 소식으로 보고 합친 미검증 헤드라인 수. 화면 툴팁이 밝힌다.
        merged: 0,
      });
    }
  }
}

// ── 미검증 헤드라인의 중복 ─────────────────────────────────────────────────
// 같은 소식을 여러 매체가 쓰거나 같은 기사가 다른 주소로 두 번 수집된다. 헤드라인을 그대로 더하면
// 검증 기사가 이미 센 신호를 한 번 더 센다(2026-09-11 샨샨: 검증 기사 "일부 제품 가격 조정 완료"와
// 미검증 "가격 이미 인상"·"샨샨도 가격을 인상했나?"가 같은 소식). 그래서 헤드라인은
//   ① 원문 제목이 검증 기사와 같으면 버리고,
//   ② 같은 회사·같은 테마·같은 방향의 신호가 발행일 ±2일 안에 이미 있고, 제목(검증 기사는 근거 문장까지)이
//      단어 2개 이상 겹치면 같은 소식으로 보고 그 흐름에 합친다(건수는 늘리지 않음).
//      테마만 같다고 합치면 같은 날 다른 소식("헝가리 공장 착공" 대 "풀탭 배터리 생산능력 추가")까지 사라진다.
// 검증 기사끼리는 본문 처리 단계에서 중복을 걸렀으므로 여기서 합치지 않는다.
const DUP_WINDOW_MS = 2 * 86400000;
const DUP_SHARED_TOKENS = 2;
const normalizedTitle = (value) => String(value || "").toLowerCase().replace(/[^0-9a-zㄱ-ㆎ가-힣一-鿿]/g, "");
function withinWindow(a, b) {
  const x = Date.parse(a), y = Date.parse(b);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return true;
  return Math.abs(x - y) <= DUP_WINDOW_MS;
}
const wordsOf = (text) => [...new Set((String(text || "").toLowerCase().match(/[가-힣a-z0-9]{2,}/g) || []))];
// 조사가 붙은 형태도 같은 단어로 본다. 짧은 쪽이 긴 쪽의 앞부분이거나("가격"·"가격을"),
// 끝 한 글자만 다르면("가격을"·"가격이") 같다. "생산능력"·"생산라인"처럼 두 글자 이상 갈리면 다르다.
function sameWord(x, y) {
  if (x.startsWith(y) || y.startsWith(x)) return true;
  let prefix = 0;
  while (prefix < x.length && x[prefix] === y[prefix]) prefix += 1;
  return prefix >= 2 && prefix >= Math.min(x.length, y.length) - 1;
}
export function sharedWordCount(a, b) {
  const right = wordsOf(b);
  return wordsOf(a).filter((word) => right.some((other) => sameWord(word, other))).length;
}
function sameStory(prev, flow) {
  return sharedWordCount(flow.title, `${prev.title} ${prev.reason || ""}`) >= DUP_SHARED_TOKENS;
}

// verified: 본문 처리를 거친 기사(headline_signals 보유).  headlines: 번역만 된 미검증 기사.
export function sankeyFlowsFromArticles(verified = [], headlines = []) {
  const deduped = new Map();
  for (const article of verified) collect(deduped, article, verifiedSignalsOf(article), "verified");
  const flows = [...deduped.values()];
  const verifiedTitles = new Set(verified.flatMap((article) => [normalizedTitle(article.title_original), normalizedTitle(article.title_ko)]).filter((title) => title.length >= 8));
  let duplicates = 0;
  for (const article of headlines) {
    if ([article.title_original, article.title_ko].some((title) => verifiedTitles.has(normalizedTitle(title)))) { duplicates += 1; continue; }
    const own = new Map();
    collect(own, article, headlineSignalsOf(article), "headline");
    for (const flow of own.values()) {
      const same = flows.find((prev) => prev.company_id === flow.company_id && prev.theme === flow.theme && prev.direction === flow.direction
        && withinWindow(prev.published_at, flow.published_at) && sameStory(prev, flow));
      if (same) { same.merged += 1; duplicates += 1; continue; }
      flows.push(flow);
    }
  }
  flows.duplicates = duplicates;
  return flows;
}
