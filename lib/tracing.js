// LangSmith 추적.
//
// 이 저장소는 LangChain을 쓰지 않고 lib/llm-provider.js에서 fetch로 직접 호출한다.
// 그래서 LangChain 자동 계측이 아니라 langsmith SDK의 traceable로 함수를 감싼다.
//
// 서버리스 주의: Vercel 함수는 응답 직후 종료되므로 배경 전송이 유실된다.
// manualFlushMode로 클라이언트를 만들고 핸들러가 끝나기 전에 flush()를 부른다.
//
// 환경변수(Vercel에만 둔다. 로컬 파일에 넣지 않는다):
//   LANGSMITH_TRACING=true        켜기. 없거나 false면 추적을 전부 건너뛴다
//   LANGSMITH_API_KEY=...         LangSmith API 키
//   LANGSMITH_PROJECT=...         선택. 프로젝트 이름
//   LANGSMITH_ENDPOINT=...        선택. 셀프호스트일 때만

let clientPromise = null;
let traceablePromise = null;

export function tracingEnabled() {
  return String(process.env.LANGSMITH_TRACING || "").toLowerCase() === "true" && Boolean(process.env.LANGSMITH_API_KEY);
}

// langsmith 패키지는 추적을 켠 경우에만 불러온다.
// 꺼져 있으면 모듈을 로드하지 않아 콜드스타트와 번들 비용이 들지 않는다.
async function getClient() {
  if (!clientPromise) {
    clientPromise = import("langsmith")
      .then(({ Client }) => new Client({ manualFlushMode: true }))
      .catch((error) => {
        console.error("[LANGSMITH_UNAVAILABLE]", error.message);
        return null;
      });
  }
  return clientPromise;
}

async function getTraceable() {
  if (!traceablePromise) {
    traceablePromise = import("langsmith/traceable")
      .then((module) => module.traceable)
      .catch(() => null);
  }
  return traceablePromise;
}

// 함수 한 번 실행을 추적한다. 추적이 꺼져 있거나 SDK 로드에 실패하면
// 원래 함수를 그대로 실행한다. 추적 실패가 서비스 실패가 되면 안 된다.
export async function traced(name, run, { runType = "chain", inputs = {}, metadata = {} } = {}) {
  if (!tracingEnabled()) return run();
  const [client, traceable] = await Promise.all([getClient(), getTraceable()]);
  if (!client || !traceable) return run();
  try {
    const wrapped = traceable(run, {
      name,
      run_type: runType,
      client,
      project_name: process.env.LANGSMITH_PROJECT || undefined,
      metadata: { service: "china-battery-lens", ...metadata },
    });
    return await wrapped(inputs);
  } catch (error) {
    // traceable이 감싼 함수의 예외는 그대로 올려보낸다.
    throw error;
  }
}

// 서버리스 종료 전에 호출한다. 추적이 꺼져 있으면 아무 일도 하지 않는다.
export async function flushTraces() {
  if (!tracingEnabled() || !clientPromise) return;
  try {
    const client = await clientPromise;
    if (client) await client.flush();
  } catch (error) {
    console.error("[LANGSMITH_FLUSH_FAILED]", error.message);
  }
}
