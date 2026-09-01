"""뉴스 후보를 정독·번역·이벤트 추출 전의 검수 큐에 적재한다.

원문 뉴스 본문은 이 단계에서 저장하지 않는다. 큐는 기사 메타데이터, 정규 기업 ID,
그리고 시점별 출처 정책만 보관한다. 본문 취득과 한국어 요약은 승인된 큐 항목에
대해서만 후속 worker가 수행한다.
"""

from __future__ import annotations

import json
import sqlite3
import hashlib
from datetime import UTC, datetime, timedelta
from email.utils import parsedate_to_datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
INPUT = ROOT / "data" / "article_candidates.json"
DATABASE = ROOT / "data" / "china_battery_lens.sqlite"


SCHEMA = """
CREATE TABLE IF NOT EXISTS article_candidate (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  published_at TEXT,
  snippet TEXT,
  language TEXT,
  companies_json TEXT NOT NULL,
  sectors_json TEXT NOT NULL,
  discovered_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS review_queue (
  candidate_id TEXT PRIMARY KEY REFERENCES article_candidate(id),
  review_status TEXT NOT NULL,
  evidence_policy TEXT NOT NULL,
  source_requirement TEXT NOT NULL,
  timeline_eligibility TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ingestion_run (
  id TEXT PRIMARY KEY,
  generated_at TEXT NOT NULL,
  candidate_count INTEGER NOT NULL,
  payload_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS candidate_observation (
  ingestion_run_id TEXT NOT NULL REFERENCES ingestion_run(id),
  candidate_id TEXT NOT NULL REFERENCES article_candidate(id),
  observed_on TEXT NOT NULL,
  PRIMARY KEY (ingestion_run_id, candidate_id)
);
"""


def parse_date(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(UTC)
    except ValueError:
        try:
            return parsedate_to_datetime(value).astimezone(UTC)
        except (TypeError, ValueError):
            return None


def source_policy(published_at: str | None, now: datetime) -> tuple[str, str]:
    """90일 이전은 공식자료 우선, 최근은 주요 언론 보강을 허용한다."""
    date = parse_date(published_at)
    if date and date < now - timedelta(days=90):
        return ("historical_official_preferred", "official_or_ir_required")
    return ("recent_media_allowed", "official_or_multi_major_media")


def timeline_eligibility(candidate: dict) -> str:
    """중요도를 확정하지 않고, 기업 시계열 검수 후보 여부만 정한다."""
    if candidate.get("companies"):
        return "needs_event_review"
    return "not_company_specific"


def main() -> None:
    raw_payload = INPUT.read_bytes()
    payload = json.loads(raw_payload.decode("utf-8"))
    now = datetime.now(UTC)
    now_text = now.isoformat()
    payload_hash = hashlib.sha256(raw_payload).hexdigest()
    run_id = f"{payload['generated_at']}:{payload_hash[:12]}"
    observed_on = payload["generated_at"][:10]
    connection = sqlite3.connect(DATABASE)
    try:
        connection.executescript(SCHEMA)
        connection.execute(
            """
            INSERT OR IGNORE INTO ingestion_run (id, generated_at, candidate_count, payload_hash, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (run_id, payload["generated_at"], payload["candidate_count"], payload_hash, now_text),
        )
        for item in payload["articles"]:
            policy, requirement = source_policy(item.get("published_at"), now)
            connection.execute(
                """
                INSERT INTO article_candidate (
                  id, source, title, url, published_at, snippet, language,
                  companies_json, sectors_json, discovered_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                  source=excluded.source, title=excluded.title, url=excluded.url,
                  published_at=excluded.published_at, snippet=excluded.snippet,
                  language=excluded.language, companies_json=excluded.companies_json,
                  sectors_json=excluded.sectors_json, discovered_at=excluded.discovered_at
                """,
                (
                    item["id"], item["source"], item["title"], item["url"],
                    item.get("published_at"), item.get("snippet"), item.get("language"),
                    json.dumps(item.get("companies", []), ensure_ascii=False),
                    json.dumps(item.get("sectors", []), ensure_ascii=False),
                    item["discovered_at"],
                ),
            )
            connection.execute(
                """
                INSERT INTO review_queue (
                  candidate_id, review_status, evidence_policy, source_requirement,
                  timeline_eligibility, created_at, updated_at
                ) VALUES (?, 'pending_body_review', ?, ?, ?, ?, ?)
                ON CONFLICT(candidate_id) DO UPDATE SET
                  evidence_policy=excluded.evidence_policy,
                  source_requirement=excluded.source_requirement,
                  timeline_eligibility=excluded.timeline_eligibility,
                  updated_at=excluded.updated_at
                """,
                (item["id"], policy, requirement, timeline_eligibility(item), now_text, now_text),
            )
            connection.execute(
                """
                INSERT OR IGNORE INTO candidate_observation (ingestion_run_id, candidate_id, observed_on)
                VALUES (?, ?, ?)
                """,
                (run_id, item["id"], observed_on),
            )
        connection.commit()
        total = connection.execute("SELECT COUNT(*) FROM review_queue").fetchone()[0]
        recent = connection.execute("SELECT COUNT(*) FROM review_queue WHERE evidence_policy='recent_media_allowed'").fetchone()[0]
        runs = connection.execute("SELECT COUNT(*) FROM ingestion_run").fetchone()[0]
        observations = connection.execute("SELECT COUNT(*) FROM candidate_observation").fetchone()[0]
        print(f"Queued {total} unique candidates ({recent} recent-media-eligible) in {DATABASE}")
        print(f"Stored {runs} daily runs and {observations} candidate observations")
    finally:
        connection.close()


if __name__ == "__main__":
    main()
