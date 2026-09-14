// pending 기사는 "아직 처리할 기사"와 "같은 URL을 계속 실패한 기사"가 섞이기 쉽다.
// 재시도는 접근 제한을 우회하는 수단이 아니라, 일시적 네트워크 오류만 천천히 복구하는 장치다.
export const MAX_FETCH_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [60 * 60_000, 6 * 60 * 60_000, 24 * 60 * 60_000];

export function retryPlan(previousAttempts = 0, now = new Date()) {
  const attempts = Math.max(0, Number(previousAttempts) || 0) + 1;
  if (attempts >= MAX_FETCH_ATTEMPTS) return { attempts, status: "retry_exhausted", nextProcessingAt: null };
  const delay = RETRY_DELAYS_MS[Math.min(attempts - 1, RETRY_DELAYS_MS.length - 1)];
  return { attempts, status: "processing_failed", nextProcessingAt: new Date(now.getTime() + delay).toISOString() };
}

export function retryIsDue(article, now = new Date()) {
  if (article?.processing_status !== "processing_failed") return article?.processing_status == null;
  const next = article?.next_processing_at ? new Date(article.next_processing_at) : null;
  return !next || Number.isNaN(next.getTime()) || next <= now;
}
