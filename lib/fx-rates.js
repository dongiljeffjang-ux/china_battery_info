// 기간별 평균 환율. 화면에서 위안화 실적을 달러로도 볼 수 있게 하는 표시용 보조 데이터다.
//
// 왜 "기간 평균"인가. 중국 분기 재무는 누적(YTD)이다. 2025Q3는 1~9월 합이므로, 그 값을 달러로
// 보려면 같은 1~9월 구간의 평균 환율을 써야 한다. 기말 환율 하나로 누적 매출을 나누면 연중
// 환율이 움직인 만큼 틀린다. 그래서 기간마다 그 기간 전체의 일별 환율을 평균한다.
//
// 출처는 유럽중앙은행 기준환율(Frankfurter가 그대로 서빙한다). 키가 필요 없고 문서화돼 있으며,
// 주말·휴일은 고시가 없어 영업일만 평균한다(sample_days에 며칠을 썼는지 남긴다).
//
// 이 값은 회사가 공시한 사실이 아니라 표시 편의를 위한 환산 계수다. 화면은 환산값임을 밝히고
// 원래 통화(CNY) 값을 함께 보여 준다.

const FX_URL = "https://api.frankfurter.dev/v1";
export const FX_SOURCE = "ecb:frankfurter";
const UA = "Mozilla/5.0 (compatible; ChinaBatteryLens/0.1; research)";

// 회계 기간 → 그 기간이 덮는 날짜 구간. 누적 공시라 모두 1월 1일에서 시작한다.
export function periodWindow(period) {
  const match = String(period || "").match(/^(\d{4})(H1|H2|Q1|Q2|Q3|Q4)?$/);
  if (!match) return null;
  const [, year, part] = match;
  const end = { Q1: "03-31", H1: "06-30", Q3: "09-30" }[part] || (part ? null : "12-31");
  if (!end) return null;
  return { start: `${year}-01-01`, end: `${year}-${end}` };
}

export function averageRates(payload, periods) {
  const rates = payload?.rates || {};
  const days = Object.keys(rates).sort();
  const out = [];
  for (const period of periods) {
    const window = periodWindow(period);
    if (!window) continue;
    const inside = days.filter((day) => day >= window.start && day <= window.end);
    const values = inside.map((day) => Number(rates[day]?.CNY)).filter((value) => Number.isFinite(value) && value > 0);
    // 표본이 너무 적으면(예: 아직 시작도 안 한 분기) 평균을 만들지 않는다.
    if (values.length < 5) continue;
    const sum = values.reduce((total, value) => total + value, 0);
    out.push({
      period, base: "USD", quote: "CNY",
      rate_avg: sum / values.length,
      sample_days: values.length,
      window_start: window.start, window_end: window.end,
      source: FX_SOURCE,
    });
  }
  return out;
}

// 필요한 기간 목록을 받아 그 기간들의 평균 환율을 만든다. 외부 요청은 1회다.
export async function fetchPeriodRates(periods, { timeoutMs = 20000 } = {}) {
  const windows = periods.map(periodWindow).filter(Boolean);
  if (!windows.length) return [];
  const start = windows.map((window) => window.start).sort()[0];
  const end = windows.map((window) => window.end).sort().at(-1);
  const today = new Date().toISOString().slice(0, 10);
  const url = `${FX_URL}/${start}..${end > today ? today : end}?base=USD&symbols=CNY`;
  const response = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`HTTP_${response.status}`);
  return averageRates(await response.json(), periods);
}
