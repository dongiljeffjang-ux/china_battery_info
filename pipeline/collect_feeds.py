"""China Battery Lens의 뉴스 발견용 RSS 수집기.

기사 본문을 저장하지 않는다. RSS의 제목, 링크, 발행일, 매체, 스니펫만
수집한 뒤 기업·소재 키워드로 1차 후보를 만든다. 실제 정독·번역은 이 후보 중
승인된 기사에 대해서만 별도 worker가 수행한다.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Iterable


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "data" / "article_candidates.json"
ARCHIVE_DIR = ROOT / "data" / "archives"
USER_AGENT = "ChinaBatteryLens/0.1 (internal research; contact: research@example.invalid)"

COMPANY_ALIASES = {
    "CATL": ["宁德时代", "CATL", "Contemporary Amperex Technology"],
    "BYD": ["比亚迪", "BYD", "Blade Battery", "刀片电池"],
    "Ronbay": ["容百科技", "Ronbay", "Ningbo Ronbay"],
    "Hunan Yuneng": ["湖南裕能", "Hunan Yuneng"],
    "BTR": ["贝特瑞", "BTR", "Beijing BTR"],
    "Shanshan": ["杉杉股份", "Shanshan"],
    "Putailai": ["璞泰来", "Putailai", "Zichen"],
    "Zhongke Electric": ["中科电气", "Zhongke Electric", "Zhongke Xingcheng"],
}

SECTOR_KEYWORDS = {
    "cathode": ["正极", "磷酸铁锂", "磷酸锰铁锂", "三元", "高镍", "LMFP", "钠电正极"],
    "anode": ["负极", "人造石墨", "天然石墨", "硅碳", "硅基", "硬碳", "石墨化"],
}

BASE_FEEDS = [
    ("China News Finance", "https://www.chinanews.com.cn/rss/finance.xml"),
    ("China News Rolling", "https://www.chinanews.com.cn/rss/scroll-news.xml"),
]
FINLIGHT_URL = "https://api.finlight.me/v2/articles"
FINLIGHT_QUERY = (
    "宁德时代 OR CATL OR 比亚迪 OR BYD OR 容百科技 OR Ronbay OR 湖南裕能 "
    "OR Hunan Yuneng OR 贝特瑞 OR BTR OR 杉杉股份 OR Shanshan OR 璞泰来 "
    "OR Putailai OR 中科电气 OR Zhongke Electric"
)


@dataclass(frozen=True)
class Candidate:
    id: str
    source: str
    title: str
    url: str
    published_at: str | None
    snippet: str
    language: str | None
    companies: list[str]
    sectors: list[str]
    discovered_at: str


def text(node: ET.Element | None) -> str:
    return "" if node is None else " ".join(node.itertext()).strip()


def google_news_feed(query: str) -> tuple[str, str]:
    encoded = urllib.parse.urlencode({"q": query, "hl": "zh-CN", "gl": "CN", "ceid": "CN:zh-Hans"})
    return ("Google News zh-CN", f"https://news.google.com/rss/search?{encoded}")


def request(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/rss+xml, application/xml, text/xml"})
    with urllib.request.urlopen(req, timeout=20) as response:
        return response.read()


def fetch_finlight() -> Iterable[dict[str, str | None]]:
    """FINLIGHT_API_KEY가 있을 때만 다국어 금융 뉴스 메타데이터를 가져온다."""
    api_key = os.getenv("FINLIGHT_API_KEY")
    if not api_key:
        return []

    body = json.dumps({
        "query": FINLIGHT_QUERY,
        "categories": ["business", "technology", "energy", "commodities", "regulation"],
        "orderBy": "publishDate",
        "order": "DESC",
        "pageSize": 100,
    }).encode("utf-8")
    req = urllib.request.Request(
        FINLIGHT_URL,
        data=body,
        method="POST",
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "application/json",
            "Content-Type": "application/json",
            "X-API-KEY": api_key,
        },
    )
    with urllib.request.urlopen(req, timeout=25) as response:
        payload = json.loads(response.read().decode("utf-8"))
    return [{
        "source": f"Finlight · {article.get('source', 'unknown')}",
        "title": article.get("title", ""),
        "url": article.get("link", ""),
        "published_at": article.get("publishDate"),
        "snippet": article.get("summary") or "",
        "language": article.get("language"),
    } for article in payload.get("articles", [])]


def parse_feed(source: str, url: str) -> Iterable[dict[str, str | None]]:
    root = ET.fromstring(request(url))
    for item in root.findall(".//item"):
        yield {
            "source": source,
            "title": text(item.find("title")),
            "url": text(item.find("link")),
            "published_at": text(item.find("pubDate")) or None,
            "snippet": re.sub(r"<[^>]+>", "", text(item.find("description"))),
            "language": None,
        }


def classify(title: str, snippet: str) -> tuple[list[str], list[str]]:
    corpus = f"{title} {snippet}".lower()
    companies = [name for name, aliases in COMPANY_ALIASES.items() if any(alias.lower() in corpus for alias in aliases)]
    sectors = [sector for sector, keywords in SECTOR_KEYWORDS.items() if any(keyword.lower() in corpus for keyword in keywords)]
    return companies, sectors


def candidate_id(url: str) -> str:
    return hashlib.sha256(url.encode("utf-8")).hexdigest()[:16]


def collect() -> list[Candidate]:
    feeds = [*BASE_FEEDS]
    for aliases in COMPANY_ALIASES.values():
        feeds.append(google_news_feed(" OR ".join(aliases[:2]) + " 电池 OR 正极 OR 负极"))

    result: dict[str, Candidate] = {}
    errors: list[str] = []
    now = datetime.now(UTC).isoformat()
    for source, url in feeds:
        try:
            for item in parse_feed(source, url):
                companies, sectors = classify(str(item["title"]), str(item["snippet"]))
                if not companies and not sectors:
                    continue
                key = candidate_id(str(item["url"]))
                result.setdefault(key, Candidate(
                    id=key,
                    source=str(item["source"]),
                    title=str(item["title"]),
                    url=str(item["url"]),
                    published_at=item["published_at"],
                    snippet=str(item["snippet"]),
                    language=item.get("language"),
                    companies=companies,
                    sectors=sectors,
                    discovered_at=now,
                ))
        except Exception as error:  # source failure must not stop the daily run
            errors.append(f"{source}: {type(error).__name__}: {error}")

    try:
        for item in fetch_finlight():
            companies, sectors = classify(str(item["title"]), str(item["snippet"]))
            if not companies and not sectors:
                continue
            key = candidate_id(str(item["url"]))
            result.setdefault(key, Candidate(
                id=key,
                source=str(item["source"]),
                title=str(item["title"]),
                url=str(item["url"]),
                published_at=item["published_at"],
                snippet=str(item["snippet"]),
                language=item.get("language"),
                companies=companies,
                sectors=sectors,
                discovered_at=now,
            ))
    except Exception as error:  # API failure must not stop the RSS run
        errors.append(f"Finlight: {type(error).__name__}: {error}")

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "generated_at": now,
        "policy": "Multilingual source metadata is persisted; article bodies are not persisted.",
        "candidate_count": len(result),
        "errors": errors,
        "articles": [asdict(article) for article in sorted(result.values(), key=lambda item: item.published_at or "", reverse=True)],
    }
    OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    archive_path = ARCHIVE_DIR / now[:10] / "article_candidates.json"
    archive_path.parent.mkdir(parents=True, exist_ok=True)
    archive_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Archived daily snapshot to {archive_path}")
    return list(result.values())


if __name__ == "__main__":
    articles = collect()
    print(f"Saved {len(articles)} candidates to {OUTPUT}")
    sys.exit(0)
