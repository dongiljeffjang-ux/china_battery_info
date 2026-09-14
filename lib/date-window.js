export function koreaDate(value = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(value);
}

const KOREA_OFFSET_MS = 9 * 60 * 60 * 1000;

export function koreaCalendarMidnight(value = new Date()) {
  const [year, month, day] = koreaDate(value).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day) - KOREA_OFFSET_MS).toISOString();
}

// 본문 처리 창은 실행 시각에서 72시간을 빼지 않고, 한국시간 N일 전 00:00부터 시작한다.
// 날짜만 확인된 기사는 DB에 그 날짜 00:00Z로 저장되므로 같은 한국 날짜의 기사 전체가 포함된다.
export function processWindowStart(days, now = new Date()) {
  return koreaCalendarMidnight(new Date(now.getTime() - days * 86400000));
}
