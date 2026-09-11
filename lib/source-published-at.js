function validDay(value) {
  const raw = String(value || "").trim();
  const calendarDay = raw.match(/^(\d{4}-\d{2}-\d{2})(?:$|[T\s])/i)?.[1];
  if (calendarDay) return calendarDay;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function articleDatePublished(value) {
  if (Array.isArray(value)) {
    for (const item of value) {
      const day = articleDatePublished(item);
      if (day) return day;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const types = Array.isArray(value["@type"]) ? value["@type"] : [value["@type"]];
  if (types.some((type) => /^(?:NewsArticle|Article|ReportageNewsArticle)$/i.test(String(type || "")))) {
    return validDay(value.datePublished);
  }
  return articleDatePublished(value["@graph"]);
}

// 본문 HTML에 원 매체가 명시한 발행 시각이 있으면 검색 모델이 반환한 날짜보다 우선한다.
// 기사 본문 안의 일반 날짜는 사건 시점일 수 있으므로 구조화된 발행 메타데이터만 읽는다.
export function sourcePublishedDay(html = "") {
  const text = String(html || "");
  const epoch = text.match(/data-article-publish-time=["'](\d{10,13})["']/i)?.[1];
  if (epoch) {
    const millis = Number(epoch) * (epoch.length === 10 ? 1000 : 1);
    const day = validDay(new Date(millis).toISOString());
    if (day) return day;
  }

  for (const match of text.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const day = articleDatePublished(JSON.parse(match[1]));
      if (day) return day;
    } catch {
      // 깨진 JSON-LD는 다른 명시적 기사 발행 메타데이터를 계속 찾는다.
    }
  }

  const patterns = [
    /<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']article:published_time["']/i,
  ];
  for (const pattern of patterns) {
    const day = validDay(text.match(pattern)?.[1]);
    if (day) return day;
  }
  return null;
}

export function sourceDayWithinTolerance(sourceDay, storedDay, toleranceDays = 3) {
  const source = new Date(`${String(sourceDay || "").slice(0, 10)}T00:00:00Z`);
  const stored = new Date(`${String(storedDay || "").slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(source.getTime()) || Number.isNaN(stored.getTime())) return false;
  return Math.abs(source.getTime() - stored.getTime()) <= toleranceDays * 86400000;
}
