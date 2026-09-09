// 일시적인 제공자 지연만 한 번 더 시도한다. 인증·스키마·입력 오류까지 재시도하면
// 같은 실패를 길게 반복할 뿐이므로 TimeoutError에만 한정한다.
export function isTimeoutError(error) {
  return error?.name === "TimeoutError" || error?.name === "AbortError";
}

export async function retryOnceOnTimeout(work, { delayMs = 1500, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  try {
    return await work({ attempt: 1 });
  } catch (error) {
    if (!isTimeoutError(error)) throw error;
    await sleep(delayMs);
    return work({ attempt: 2, retried: true });
  }
}
