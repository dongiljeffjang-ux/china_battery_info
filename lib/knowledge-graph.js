import { supabaseRest } from "../api/lib/supabase.js";
import { LAYER_KEYS, MARKET_LAYERS, TECHNOLOGY_LAYERS } from "./timeline-layers.js";

// 벡터 DB를 근거로 키워드·회사·레이어 사이의 연관성을 3차원 그래프로 만든다.
//
// 점: graph_vectors()가 돌려주는 개념별 평균 임베딩(1536차원).
// 선: 코사인 유사도가 높은 이웃(점마다 상위 몇 개)과, 같은 기사에 함께 나온 키워드-회사 쌍.
// 좌표: 1536차원을 PCA로 3차원에 투영한다. 힘 기반 배치의 초기값으로 쓰여 의미가 가까운 것이
//       화면에서도 가깝게 시작한다.

const NEIGHBORS = 3;
const MIN_SIMILARITY = 0.55;

function layerLabel(key) {
  const found = [...MARKET_LAYERS, ...TECHNOLOGY_LAYERS].find((layer) => layer.key === key);
  return found ? found.label_ko : key;
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i += 1) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

// 상위 3개 주성분을 거듭제곱법으로 구한다. 점이 백 개 남짓이라 이 정도면 충분히 빠르다.
function pca3(vectors) {
  const n = vectors.length;
  const d = vectors[0].length;
  const mean = new Float64Array(d);
  for (const v of vectors) for (let i = 0; i < d; i += 1) mean[i] += v[i] / n;
  const centered = vectors.map((v) => v.map((x, i) => x - mean[i]));
  const components = [];
  // 공분산 행렬을 만들지 않고 X^T X v 를 X, X^T 순으로 곱해 메모리를 아낀다.
  const multiply = (v) => {
    const proj = centered.map((row) => row.reduce((s, x, i) => s + x * v[i], 0));
    const out = new Float64Array(d);
    for (let r = 0; r < n; r += 1) { const p = proj[r]; const row = centered[r]; for (let i = 0; i < d; i += 1) out[i] += row[i] * p; }
    return out;
  };
  for (let c = 0; c < 3; c += 1) {
    let v = Float64Array.from({ length: d }, (_, i) => Math.sin(i * (c + 1) * 0.37) + 0.5);
    for (let iter = 0; iter < 40; iter += 1) {
      let w = multiply(v);
      for (const prev of components) { const dot = w.reduce((s, x, i) => s + x * prev[i], 0); w = w.map((x, i) => x - dot * prev[i]); }
      const norm = Math.sqrt(w.reduce((s, x) => s + x * x, 0)) || 1;
      v = w.map((x) => x / norm);
    }
    components.push(v);
  }
  return centered.map((row) => components.map((comp) => row.reduce((s, x, i) => s + x * comp[i], 0)));
}

function parseVector(value) {
  if (Array.isArray(value)) return value.map(Number);
  return String(value).replace(/^\[|\]$/g, "").split(",").map(Number);
}

export async function buildKnowledgeGraph({ minKeywordCount = 2 } = {}) {
  const rows = await supabaseRest("rpc/graph_vectors", { method: "POST", body: { min_keyword_count: minKeywordCount } });
  const points = rows.map((row) => ({
    id: `${row.kind}:${row.key}`,
    kind: row.kind,
    key: row.key,
    label: row.kind === "layer" ? layerLabel(row.key) : row.label,
    count: Number(row.n),
    companies: row.companies || [],
    vector: parseVector(row.centroid),
  })).filter((p) => p.vector.length && Number.isFinite(p.vector[0]));
  if (points.length < 4) return { nodes: [], links: [], note: "벡터가 있는 개념이 아직 적습니다." };

  const coords = pca3(points.map((p) => p.vector));
  const scale = 60 / (Math.max(...coords.flat().map(Math.abs)) || 1);
  const nodes = points.map((p, i) => ({
    id: p.id, kind: p.kind, key: p.key, label: p.label, count: p.count, companies: p.companies,
    x: coords[i][0] * scale, y: coords[i][1] * scale, z: coords[i][2] * scale,
  }));

  // 의미 이웃: 점마다 가장 가까운 몇 개만 잇는다. 전부 이으면 그물이 돼 아무것도 안 보인다.
  const linkMap = new Map();
  const addLink = (a, b, weight, reason) => {
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    const prev = linkMap.get(key);
    if (!prev || prev.weight < weight) linkMap.set(key, { source: a, target: b, weight, reason });
  };
  for (let i = 0; i < points.length; i += 1) {
    const sims = points.map((q, j) => (j === i ? -1 : cosine(points[i].vector, q.vector)));
    sims.map((s, j) => [s, j]).sort((a, b) => b[0] - a[0]).slice(0, NEIGHBORS)
      .filter(([s]) => s >= MIN_SIMILARITY)
      .forEach(([s, j]) => addLink(points[i].id, points[j].id, Number(s.toFixed(3)), "의미 유사"));
  }
  // 함께 나온 관계: 키워드가 걸린 회사, 레이어가 걸린 회사.
  for (const p of points) {
    if (p.kind === "company") continue;
    for (const cid of p.companies) {
      const target = `company:${cid}`;
      if (points.some((q) => q.id === target)) addLink(p.id, target, 0.5, "같은 기사·이벤트");
    }
  }
  return { nodes, links: [...linkMap.values()], generated_at: new Date().toISOString() };
}
