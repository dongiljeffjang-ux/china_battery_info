// 정기보고서 이벤트의 중문 발췌에서 재무·물량 지표를 뽑는다. LLM을 쓰지 않는다.
//
// 왜 중문인가. 한국어 요약(`fact_ko`)은 원문의 계정 이름을 지운다. 营业总收入(전사 매출)과
// 境外收入(해외 매출)이 둘 다 "매출"이 된다. 2026-09-08 실측에서 한국어만 보고 매출을 잡으면
// CATL 2024·2025년 값으로 해외 매출(1,103억·1,296억)이 전사 매출 자리에 들어갔다. 중문 발췌는
// 계정 이름을 그대로 갖고 있어 그 혼동이 생기지 않는다.
//
// 원칙은 `lib/fact-extraction.js`와 같다 — 숫자는 발췌 안에 글자 그대로 있는 표기에서 코드가 읽는다.
// 계정을 특정하지 못하면 값을 버린다. 화면에 계정 미상인 숫자를 올리지 않는다.

// 금액은 전부 억 위안(CNY_100M)으로 맞춘다. 원문 표기는 quantity_text에 그대로 남는다.
const AMOUNT_SCALE = { "亿元": 1, "亿": 1, "万元": 1e-4, "万": 1e-4, "千元": 1e-5, "元": 1e-8 };
// 단위 없는 숫자는 표(单位：元)에서 온 것만 받는다. 이보다 작으면 순번·개수일 수 있어 버린다.
const BARE_YUAN_MIN = 1e6;

// 계정 사전. 긴 표기가 먼저 와야 한다 — "归属于上市公司股东的净利润" 안의 "净利润"이 따로 잡히면 안 된다.
// line_item_zh에는 여기서 실제로 맞은 표기를 그대로 저장한다.
export const METRIC_ACCOUNTS = [
  { metric: "net_profit_excl", account: /归属于上市公司股东的扣除非经常性损益的净利润|扣除非经常性损益后的净利润|扣非(?:后)?净利润/ },
  { metric: "net_profit_attr", account: /归属于上市公司股东的净利润|归属于母公司(?:所有者|股东)的净利润|归属母公司(?:所有者)?净利润/ },
  { metric: "ocf", account: /经营活动产生的现金流量净额|经营活动现金流量净额/ },
  { metric: "overseas_revenue", account: /境外收入|海外收入/ },
  { metric: "revenue_total", account: /营业总收入|营业收入/, segmentGuard: true },
  { metric: "operating_profit", account: /营业利润/ },
  { metric: "net_profit", account: /净利润/ },
];

// 이 말이 계정 앞에 붙으면 전사 값이 아니라 사업부·제품·자회사 값이다.
// 예: "锂电材料业务的营业收入", "磷酸铁锂正极材料产品实现营业收入".
// 매출에만 적용한다. 이익 계정의 "其中，实现归属于母公司所有者的净利润"은 사업부가 아니라
// 귀속 주체를 가르는 말이라, 여기에 같은 잣대를 대면 지배주주 순이익을 통째로 놓친다.
const SEGMENT_PREFIX = /(其中|产品|业务|板块|分部|该项目|子公司|系统|材料)[^。；]{0,24}(?:公司|有限公司|业务|材料|产品)?$/;
const LOOKBEHIND_CHARS = 36;

// 계정 이름과 숫자 사이에 낄 수 있는 것들: "为人民币", "达", 표의 " | ", 공백.
// 문장 부호를 넘어가면 다른 계정의 숫자를 끌어오므로 막는다.
const GAP = "[^0-9%。；，、\\n]{0,10}?";
const NUMBER = "(-?[0-9][0-9,]*(?:\\.[0-9]+)?)";
const UNIT = "\\s*(亿元|万元|千元|元|亿|万)?";
const TABLE_UNIT = /\[?\s*单位\s*[:：]\s*(亿元|万元|千元|元|亿|万)\s*\]?/;

// 표 추출기는 단위를 행마다 복사하지 않고 표 끝에 한 번 붙인다. 같은 줄 또는
// 현재 발췌 안의 표 꼬리표를 읽되, 다음 문단의 단위를 끌어오지 않는다.
function tableUnitFor(text, from) {
  const tail = text.slice(from);
  const line = tail.split(/\\n/)[0];
  const match = TABLE_UNIT.exec(line);
  return match?.[1] || null;
}

const YOY = /(?:同比|较上年同期|较上年度同比|与上年同期相比|较\s*\d{4}\s*年同期)\s*(增长|上升|增加|下降|减少|降低)\s*([0-9]+(?:\.[0-9]+)?)\s*%/;
const YOY_WINDOW = 40;

// "846,765.46 万元" → 84.676546 (억 위안). 단위가 없으면 元으로 보되 표에서 온 큰 수만 받는다.
export function parseAmountCny(numberText, unitText) {
  const raw = Number(String(numberText || "").replace(/,/g, ""));
  if (!Number.isFinite(raw)) return null;
  if (!unitText) return Math.abs(raw) >= BARE_YUAN_MIN ? raw * AMOUNT_SCALE["元"] : null;
  const scale = AMOUNT_SCALE[unitText];
  return scale === undefined ? null : raw * scale;
}

// 기간 표기. 연차보고서는 그 해 전체, 반기·분기 보고서는 결산월로 구간을 정한다.
export function periodOf(evidenceKind, occurredAt) {
  const date = String(occurredAt || "");
  const year = date.slice(0, 4);
  if (!/^\d{4}$/.test(year)) return null;
  if (evidenceKind === "annual_report") return year;
  const month = Number(date.slice(5, 7));
  if (month === 6) return `${year}H1`;
  if (month === 3) return `${year}Q1`;
  if (month === 9) return `${year}Q3`;
  if (month === 12) return year;
  return year;
}

function statedYoy(text, from) {
  const match = YOY.exec(text.slice(from, from + YOY_WINDOW));
  if (!match) return null;
  const value = Number(match[2]);
  if (!Number.isFinite(value)) return null;
  return /下降|减少|降低/.test(match[1]) ? -value : value;
}

// 발췌 하나에서 지표 행을 뽑는다. 같은 지표가 여러 번 나오면 첫 번째만 쓴다.
export function extractMetricsFromExcerpt(excerpt, { evidenceKind, occurredAt } = {}) {
  const text = String(excerpt || "");
  if (!text) return [];
  const period = periodOf(evidenceKind, occurredAt);
  const claimed = [];
  const rows = [];
  for (const { metric, account, segmentGuard } of METRIC_ACCOUNTS) {
    const pattern = new RegExp(`(${account.source})${GAP}${NUMBER}${UNIT}`, "g");
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const start = match.index;
      const end = start + match[1].length;
      // 더 구체적인 계정이 이미 가져간 자리면 건너뛴다(扣非净利润 안의 净利润).
      if (claimed.some(([from, to]) => start < to && end > from)) continue;
      // 앞말이 사업부·제품을 가리키면 전사 값이 아니다. "연구개발비가 매출의 2.40%"처럼
      // 비율의 분모로 언급된 매출도 전사 매출 행이 아니므로 함께 버린다.
      if (segmentGuard) {
        const before = text.slice(Math.max(0, start - LOOKBEHIND_CHARS), start);
        if (SEGMENT_PREFIX.test(before) || /占\s*$/.test(before)) continue;
      }
      // 뒤가 %면 값이 아니라 비율이다("占本期营业收入 30.48%").
      const after = text.slice(match.index + match[0].length);
      if (/^\s*%/.test(after)) continue;
      const unitText = match[3] || tableUnitFor(text, match.index + match[0].length);
      const value = parseAmountCny(match[2], unitText);
      if (value === null) continue;
      claimed.push([start, end]);
      rows.push({
        metric,
        value,
        unit: "CNY_100M",
        currency: "CNY",
        line_item_zh: match[1],
        // 발췌에 글자 그대로 있는 표기를 그대로 남긴다. 공백까지 원문 그대로여야 검산이 된다.
        quantity_text: match[0].slice(match[0].indexOf(match[2])),
        yoy_pct_stated: statedYoy(text, match.index + match[0].length),
        period,
        excerpt: text,
      });
      break; // 같은 계정의 두 번째 등장은 보통 전년 비교값이다.
    }
  }
  return rows;
}

// 이벤트 목록 → 저장할 행. 한 회사·기간·지표에 값이 여럿이면 하나만 남긴다.
export function extractMetricsFromEvents(events) {
  const rows = [];
  for (const event of events || []) {
    const context = { evidenceKind: event.evidence_kind, occurredAt: event.occurred_at };
    const found = [
      ...extractMetricsFromExcerpt(event.original_excerpt, context),
      ...extractVolumesFromExcerpt(event.original_excerpt, context),
    ];
    for (const row of found) {
      if (!row.period) continue;
      rows.push({
        ...row,
        company_id: event.company_id,
        event_id: event.id,
        report_kind: event.evidence_kind,
        source_url: event.source_url || null,
        occurred_at: event.occurred_at,
      });
    }
  }
  return dedupeMetrics(rows);
}

// ── 물량(출하·장착·생산능력) ────────────────────────────────────────────────
// 금액과 달리 물량은 "무엇의" 물량인지가 값만큼 중요하다. CATL 2025년 원문에는 锂离子电池
// 661GWh, 动力电池 541GWh, 储能电池 121GWh가 함께 있다. 이걸 "출하량" 한 줄로 뭉개면 어느
// 값이 잡힐지 정규식 순서가 정하게 된다 — 해외 매출을 전사 매출로 읽을 뻔한 것과 같은 사고다.
// 그래서 품목을 사전으로 특정하고, 품목별로 다른 지표 키를 준다. 사전에 없는 표현은 버린다.
//
// 단위도 GWh(셀)와 만 톤(소재)으로 갈린다. 같은 축에 섞을 수 없으므로 단위를 행마다 남긴다.

// 품목 사전. 긴 표기가 먼저다 — 三元正极材料가 正极材料로 잡히면 안 된다.
const VOLUME_ITEMS = [
  { key: "cathode_lfp", re: /纳米磷酸铁锂|磷酸盐系正极材料|磷酸盐正极材料|磷酸铁锂正极材料|磷酸铁锂/ },
  { key: "cathode_ncm", re: /三元正极材料|三元材料/ },
  { key: "cathode_lco", re: /钴酸锂/ },
  { key: "cathode_na", re: /钠电正极|钠离子正极材料/ },
  { key: "precursor", re: /三元前驱体|固态前驱体|前驱体/ },
  { key: "cathode", re: /正极材料|锂电正极材料/ },
  { key: "anode", re: /负极材料/ },
  { key: "ess", re: /储能电池|储能系统|储能电芯/ },
  { key: "power", re: /动力锂电池|动力电池|刀片电池/ },
  { key: "cell", re: /锂离子电池|锂电池/ },
  // 마지막 그물. "大圆柱电池 공장"처럼 종류를 특정할 수 없는 전지도 품목 미상으로 남긴다.
  { key: "battery", re: /电池|电芯/ },
];
const VOLUME_ITEM_LABEL_ZH = {
  cathode_lfp: "인산철리튬 양극재", cathode_ncm: "삼원계 양극재", cathode_lco: "코발트산리튬",
  cathode_na: "나트륨 양극재", precursor: "전구체", cathode: "양극재", anode: "음극재",
  ess: "ESS 전지", power: "동력전지", cell: "리튬이온전지", battery: "전지(품목 미상)",
};
// 출하·판매는 같은 뜻으로 쓰인다. 장착량(装机量)은 제3자가 센 탑재 실적이라 따로 둔다.
const VOLUME_KINDS = [
  { metric: "shipment", re: /出货量|出货|销售量|销量/ },
  { metric: "installed", re: /装机量/ },
  { metric: "capacity", re: /产能/ },
];
const VOLUME_UNITS = { GWh: { unit: "GWh", scale: 1 }, "万吨": { unit: "t", scale: 1e4 }, "吨": { unit: "t", scale: 1 } };
// 누적과 계획은 그 기간의 실적이 아니다. 그렇다고 버리지는 않는다 — 참고가 되는 값이다.
// 대신 기간 실적과 다른 지표 키를 줘서 한 선에 섞이지 않게 한다.
//   累计  — 창사 이래 누적
//   规划·计划·拟建·预计·目标 — 아직 짓지 않은 계획
const VOLUME_BASES = [
  { basis: "cumulative", tag: "cum_", re: /累计|累积/, label: "누적" },
  { basis: "planned", tag: "plan_", re: /规划|计划|拟建|预计|目标|在建/, label: "계획" },
];
// 규모를 가리키는 말이지 수량이 아니다. 이건 값으로 만들지 않는다.
const VOLUME_EXCLUDE = /吨级|万吨级|级别/;
const VOLUME_WINDOW = 26;
// 뒤쪽에서 품목을 찾을 때 문장을 넘어가지 않게 막는다.
const VOLUME_SENTENCE_BREAK = /[。；，、\n]/;

export function extractVolumesFromExcerpt(excerpt, { evidenceKind, occurredAt } = {}) {
  const text = String(excerpt || "");
  if (!text) return [];
  const period = periodOf(evidenceKind, occurredAt);
  const rows = [];
  const seen = new Set();
  for (const kind of VOLUME_KINDS) {
    const pattern = new RegExp(`(${kind.re.source})[^0-9%。；，、\\n]{0,10}?(-?[0-9][0-9,]*(?:\\.[0-9]+)?)\\s*(GWh|万吨|吨)`, "g");
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const before = text.slice(Math.max(0, match.index - VOLUME_WINDOW), match.index);
      if (VOLUME_EXCLUDE.test(before)) continue;
      // 품목은 동사 바로 앞에서 찾는다. 생산능력은 "연산 20GWh의 원통형 전지 공장"처럼 품목이
      // 수치 뒤에 오는 경우가 있어 뒤쪽도 한 문장 안에서만 본다. 그래도 못 찾으면 무엇의
      // 물량인지 모르므로 만들지 않는다.
      const tail = match.index + match[0].length;
      const after = text.slice(tail, tail + VOLUME_WINDOW).split(VOLUME_SENTENCE_BREAK)[0];
      const item = VOLUME_ITEMS.find((candidate) => candidate.re.test(before))
        || VOLUME_ITEMS.find((candidate) => candidate.re.test(after));
      if (!item) continue;
      const unit = VOLUME_UNITS[match[3]];
      if (!unit) continue;
      const raw = Number(match[2].replace(/,/g, ""));
      if (!Number.isFinite(raw)) continue;
      // 누적·계획은 기간 실적과 다른 키를 준다. 한 선에 섞이면 값의 뜻이 달라진다.
      const base = VOLUME_BASES.find((candidate) => candidate.re.test(before));
      const metric = `${kind.metric}_${base ? base.tag : ""}${item.key}`;
      if (seen.has(metric)) continue;
      seen.add(metric);
      rows.push({
        metric,
        basis: base ? base.basis : "period",
        value: raw * unit.scale,
        unit: unit.unit,
        currency: null,
        line_item_zh: `${(before.match(item.re) || after.match(item.re) || [""])[0]}${match[1]}`,
        quantity_text: match[0].slice(match[0].indexOf(match[2])),
        yoy_pct_stated: statedYoy(text, match.index + match[0].length),
        period,
        excerpt: text,
      });
    }
  }
  return rows;
}

const VOLUME_KIND_LABEL = { shipment: "출하량", installed: "장착량", capacity: "생산능력" };
export const VOLUME_METRIC_LABELS = Object.fromEntries(
  VOLUME_KINDS.flatMap((kind) => VOLUME_ITEMS.flatMap((item) =>
    [{ tag: "", label: "" }, ...VOLUME_BASES].map((base) => [
      `${kind.metric}_${base.tag}${item.key}`,
      `${VOLUME_KIND_LABEL[kind.metric]}${base.label ? `(${base.label})` : ""} · ${VOLUME_ITEM_LABEL_ZH[item.key]}`,
    ]),
  )),
);

// 같은 칸에 값이 둘이면 연차보고서를, 그다음 더 구체적인 계정 표기를 택한다.
const ACCOUNT_RANK = { "营业总收入": 2, "营业收入": 1 };
function rankOf(row) {
  return (row.report_kind === "annual_report" ? 10 : 0) + (ACCOUNT_RANK[row.line_item_zh] || 0);
}

export function dedupeMetrics(rows) {
  const best = new Map();
  for (const row of rows) {
    const key = `${row.company_id} ${row.period} ${row.metric}`;
    const kept = best.get(key);
    if (!kept || rankOf(row) > rankOf(kept)) best.set(key, row);
  }
  return [...best.values()];
}
