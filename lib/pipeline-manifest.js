// 파이프라인 명세. 관리자 화면 "파이프라인" 메뉴가 이 값을 그대로 그린다.
//
// 규칙 하나: 여기서 값을 옮겨 적지 않는다. 실제로 동작하는 모듈에서 상수와 프롬프트를 import 해
// 그대로 내보낸다. 화면에 설명을 따로 써 두면 코드가 바뀔 때 조용히 어긋난다. 설명이 필요한
// 대목은 description에 사람 말로 적되, 숫자와 프롬프트 본문은 반드시 코드에서 읽는다.
import { TRACKED_COMPANIES, SELECTION_BASIS, buildSearchGroups, plannedSearchRequests, searchProviderPrompt, searchInstructions, searchLaneEngine, policySearchEngines } from "./china-sources.js";
import { SEARCH_LIMITS, searchBudgetFor } from "./ingestion-guard.js";
import { LAYER_ENUM, LAYER_PROMPT_GUIDE } from "./timeline-layers.js";
import { CRAWLER_UA } from "./robots.js";
import { ARTICLE_TRANSLATION_PROMPT } from "./article-translation.js";
import { FACT_EXTRACTION_PROMPT } from "./fact-extraction.js";
import { CONCEPT_EDGE_PROMPT } from "./concept-graph.js";
import { HEADLINE_TRANSLATION_PROMPT } from "./headline-knowledge.js";
import { REDATE_INSTRUCTIONS, ARTICLE_REDATE_INSTRUCTIONS } from "./event-backfill.js";
import { ARTICLE_ANALYSIS_PROMPT_BODY, ARTICLE_DATE_GUIDE } from "../api/process-article.js";
import { DAILY_REPORT_PROMPT } from "../api/generate-daily.js";
import { REPORT_SYNTHESIS_PROMPT } from "./compare-report.js";

const env = (name) => (process.env[name] ? "설정됨" : "없음");
const model = (name, fallback) => process.env[name] || fallback;

function tagged(tag) {
  return TRACKED_COMPANIES.filter((company) => company.type_tags.includes(tag)).length;
}

export function pipelineManifest() {
  const openaiGroups = buildSearchGroups("openai", false);
  const localGroups = buildSearchGroups("china_local", false);
  const localEngine = searchLaneEngine("china_local");
  const planned = plannedSearchRequests(false);

  return {
    generated_at: new Date().toISOString(),
    note: "이 화면의 숫자와 프롬프트는 실제 실행 코드에서 직접 읽습니다. 화면용으로 따로 적어 둔 값이 아닙니다.",

    // ---------- 1. 어디서 무엇을 가져오는가 ----------
    sources: [
      {
        id: "web_search_openai",
        label: "OpenAI 웹 검색",
        what: "회사 묶음마다 최근 3일치 기사 후보를 검색으로 찾는다. 폭넓은 주요 매체를 본다.",
        endpoint: "OpenAI Responses API · web_search 도구",
        model: model("OPENAI_MODEL", "(OPENAI_MODEL 미설정)"),
        api_key: env("OPENAI_API_KEY"),
        groups: openaiGroups.length,
        companies_per_group: `최대 ${Math.max(...openaiGroups.map((g) => g.ids.length))}`,
        group_labels: openaiGroups.map((g) => `${g.label} (${g.ids.length}곳)`),
        stores: "article (verification_status=pending, source_tier=web_search_openai)",
      },
      {
        id: "web_search_china_local",
        label: "중국 현지 웹 검색",
        what: "같은 기간을 중국어 검색어로 중국 산업 전문매체·지방정부·기업 발표 중심으로 독립 검색한다.",
        endpoint: `${localEngine === "deepseek" ? "DeepSeek" : "OpenAI"} Responses API · web_search 도구 (엔진 ${localEngine}, CHINA_LOCAL_SEARCH_ENGINE으로 선택)`,
        model: localEngine === "deepseek" ? model("DEEPSEEK_SEARCH_MODEL", "deepseek-flash") : model("OPENAI_MODEL", "(OPENAI_MODEL 미설정)"),
        api_key: env(localEngine === "deepseek" ? "DEEPSEEK_API_KEY" : "OPENAI_API_KEY"),
        groups: localGroups.length,
        companies_per_group: `최대 ${Math.max(...localGroups.map((g) => g.ids.length))}`,
        group_labels: localGroups.map((g) => `${g.label} (${g.ids.length}곳)`),
        stores: "article (verification_status=pending, source_tier=web_search_china_local; 2026-09-09 이전 기록은 web_search_deepseek)",
        note: `2026-09-10 DeepSeek V4.1 Flash 전환 뒤 DeepSeek Responses API가 내장 web_search 도구를 무시한다(공식 문서 호환표 'Ignored', 운영 로그 search_calls=0). 기본 엔진을 OpenAI로 옮겼고 공급자가 검색을 되살리면 환경변수로 되돌린다. 정책 검색은 엔진마다 1회만 부른다(현재 ${policySearchEngines().length}회).`,
      },
      {
        id: "catl_newsroom",
        label: "CATL 뉴스룸",
        what: "CATL이 직접 배포하는 보도자료 목록을 읽는다.",
        endpoint: "https://www.catl.com/news/",
        stores: "article (source_name=CATL Newsroom)",
        robots: "확인하지 않음. 회사가 배포 목적으로 공개한 자료다.",
      },
      {
        id: "cninfo",
        label: "CNINFO 거래소 공시",
        what: "심천·상해 거래소 공시 목록을 회사별로 조회하고 PDF 원문을 받는다.",
        endpoint: "https://www.cninfo.com.cn/new/hisAnnouncement/query",
        companies: TRACKED_COMPANIES.filter((c) => c.cninfo).length,
        stores: "article (source_tier=official_disclosure) · report_digest",
        robots: "확인하지 않음. 법정 공개 자료다.",
      },
      {
        id: "hkex",
        label: "HKEX 정기보고서",
        what: "홍콩 상장사의 연차·반기 보고서 PDF를 받아 관리층 논의 구간을 읽는다.",
        endpoint: "https://www1.hkexnews.hk",
        stores: "report_digest · event (evidence_kind=annual_report/semiannual_report)",
        robots: "확인하지 않음. 법정 공개 자료다.",
      },
      {
        id: "article_body",
        label: "기사 본문 읽기",
        what: "선별된 기사의 원문 페이지를 받아 텍스트로 만든다. 남의 사이트라 예절 규칙을 지킨다.",
        endpoint: "기사마다 다름 (검색이 돌려준 URL)",
        user_agent: CRAWLER_UA,
        robots: "본문을 받기 전에 도메인 robots.txt를 확인한다. 막혀 있으면 읽지 않고 robots_disallowed로 남긴다. Crawl-delay가 있으면 그 간격을, 없으면 같은 도메인 연속 요청에 1.5초를 둔다.",
        stores: "article.body_original (임베딩 뒤 언론 기사는 삭제)",
      },
    ],

    // ---------- 2. 추적 대상 ----------
    universe: {
      total: TRACKED_COMPANIES.length,
      cell: tagged("cell"),
      cathode: tagged("cathode"),
      anode: tagged("anode"),
      selection_basis: SELECTION_BASIS,
      layers: LAYER_ENUM,
    },

    // ---------- 3. 한 번 실행에 나가는 요청 ----------
    budget: {
      planned_search_requests: planned,
      allowed_search_requests: searchBudgetFor(planned).search,
      allowed_recovery_requests: searchBudgetFor(planned).recovery,
      floor: SEARCH_LIMITS,
      note: "요청 횟수 상한이지 비용 상한이 아니다. 제공자가 요청 하나 안에서 내부 검색을 몇 번 돌릴지는 우리가 정하지 못한다.",
    },

    // ---------- 4. 단계와 프롬프트 ----------
    stages: [
      {
        id: "collect",
        label: "1. 수집",
        runs: "api/ingest-rss.js · discoverChinaSources()",
        what: "위 소스를 병렬로 훑어 후보를 모으고, URL 중복을 지우고, 회사 별칭·계열사 별칭으로 회사를 붙인다.",
        prompts: [
          { name: "검색 지시 (공통 틀)", provider: "openai · deepseek", text: searchInstructions("{제공자별 지시가 여기 들어간다}") },
          { name: "레인별 지시 · 글로벌", provider: "openai", text: searchProviderPrompt("openai") },
          { name: `레인별 지시 · 중국 현지 (엔진 ${localEngine})`, provider: localEngine, text: searchProviderPrompt("china_local") },
        ],
      },
      {
        id: "select",
        label: "2. 선별",
        runs: "api/ingest-rss.js · selectHeadlineTop10()",
        what: "제목만 보고 점수를 매겨 뉴스 상위 10건과 공시 몫을 고른다. LLM을 쓰지 않는 규칙 기반이다.",
        rules: [
          "증설·수주·양산 같은 신호 단어는 가산, 차량 리뷰·주가 단신은 감점",
          "거래소 공시는 1차 출처라 가산",
          "좋아요·싫어요를 회사와 매체 선호로 일반화해 보조 신호로 사용",
          "뉴스는 최근 3일, 공시는 최근 45일 창",
        ],
        prompts: [],
      },
      {
        id: "process",
        label: "3. 본문 처리",
        runs: "api/process-article.js",
        what: "원문을 받아 OpenAI가 한국어 사실과 이벤트를 구조화하고, 원문 확보·추출이 끝난 기사를 화면에 올린다.",
        prompts: [
          { name: "1차 사실 추출", provider: "openai", text: ARTICLE_ANALYSIS_PROMPT_BODY },
          { name: "시점 판정 지침 (1차 추출에 함께 들어감)", provider: "openai", text: ARTICLE_DATE_GUIDE },
          { name: "레이어 분류 지침 (1차 추출에 함께 들어감)", provider: "openai", text: LAYER_PROMPT_GUIDE },
          { name: "본문 한국어 번역 (언론 기사 보관용)", provider: "openai", text: ARTICLE_TRANSLATION_PROMPT },
        ],
      },
      {
        id: "daily",
        label: "4. Daily 리포트",
        runs: "api/generate-daily.js",
        what: "검증 통과 기사에서 Top 10을 고르고 카테고리별 사실 요약과 해석을 만든다.",
        prompts: [{ name: "Daily 편집", provider: "openai_report", text: DAILY_REPORT_PROMPT }],
      },
      {
        id: "curate",
        label: "5. 유지 (야간)",
        runs: "lib/curation.js · runCurationHop()",
        what: "이벤트·기사·보고서 임베딩을 메우고, 시점을 재확인하고, 정기보고서를 읽고, 개념 관계를 뽑는다. 훅을 이어 붙여 최대 40회 돈다.",
        prompts: [
          { name: "미검증 헤드라인 번역", provider: "auto", text: HEADLINE_TRANSLATION_PROMPT },
          { name: "기사 이벤트 시점 재확인", provider: "openai", text: ARTICLE_REDATE_INSTRUCTIONS },
          { name: "보고서 이벤트 시점 재확인", provider: "openai", text: REDATE_INSTRUCTIONS },
          { name: "구조화 사실 추출", provider: "auto", text: FACT_EXTRACTION_PROMPT },
          { name: "개념 관계 추출", provider: "auto", text: CONCEPT_EDGE_PROMPT },
        ],
      },
      {
        id: "synthesis",
        label: "6. 비교 리포트 함의 종합 (사용자 요청)",
        runs: "api/company.js · mode=synthesize_reports → lib/compare-report.js · buildReportSynthesis()",
        what: "지난 비교 리포트 2~6건을 골라 공통 흐름·갈리는 지점·한국 기업 관점을 뽑는다. 웹 검색 없이 저장된 리포트만 근거로 쓰며, 결과 전체가 해석이다.",
        prompts: [{ name: "함의 종합", provider: "openai_report", text: REPORT_SYNTHESIS_PROMPT }],
      },
    ],

    // ---------- 5. 원문 보관 정책 ----------
    retention: [
      { kind: "언론 기사 원문", policy: "저장하지 않는다", why: "저작권. 임베딩이 끝나면 article.body_original을 지운다. 기각·재시도 상한 도달 경로에서도 지운다." },
      { kind: "언론 기사 한국어 번역", policy: "문단 단위로 보관", why: "원문 없이도 기사 속 세부 사실을 검색할 수 있어야 한다. knowledge_chunk.content_ko에 넣는다." },
      { kind: "거래소 공시·정기보고서 원문", policy: "전문을 보관하고 임베딩", why: "법정 공개 자료라 보관에 제약이 없다. knowledge_chunk.content_original에 조각으로 넣는다." },
      { kind: "근거 발췌", policy: "이벤트마다 300자 이내 원문 발췌와 한국어 번역", why: "화면에서 사실의 근거를 바로 보이기 위함이다." },
    ],

    embedding: {
      model: model("OPENAI_EMBEDDING_MODEL", "text-embedding-3-small"),
      chunk_chars: 1800,
      chunk_overlap: 180,
      types: ["article_chunk", "event_fact", "report_chunk", "headline", "daily_report"],
    },
  };
}
