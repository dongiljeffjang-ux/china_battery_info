// 보고서 발췌에서 '수치가 있는 사실 문장'만 남긴다.
// 서술형 전략·전망 문장을 걷어내 읽어야 할 분량을 줄인다.

import fs from "node:fs";
import path from "node:path";

const DIR = path.join("outputs", "reports");
const OUT = path.join("outputs", "reports", "condensed");

// 사실 문장에 붙는 단위·지표. 하나라도 있어야 남긴다.
const FACT = /(万吨|吨|GWh|MWh|亿元|万元|亿美元|万平方米|条产线|产能|产量|出货|销量|销售量|营业收入|净利润|毛利率|产能利用率|投产|开工|竣工|达产|量产|中标|定点|供货|订单|客户|认证|专利|募投|投资额|新增|扩建|收购|控股|参股|海外|出口|工厂|基地)/;
const NUM = /\d/;
// 전망·의지 표현이 들어간 문장은 사실이 아니다.
const FORECAST = /(预计|计划|拟|将于|有望|力争|目标|战略|未来|展望|愿景|致力于|不断|持续推进|积极|努力)/;
const NOISE = /(本报告|详见|请参见|不适用|适用|单位：|币种|注[0-9]|第[一二三四五六七八九十]+节|目录)/;

for (const file of fs.readdirSync(DIR).filter((f) => f.endsWith(".txt"))) {
  const raw = fs.readFileSync(path.join(DIR, file), "utf8");
  const headEnd = raw.indexOf("### ");
  const header = raw.slice(0, headEnd).trim();
  const body = raw.slice(headEnd);
  const kept = [];
  const seen = new Set();
  for (const chunk of body.split(/[。；\n]/)) {
    const line = chunk.replace(/\s+/g, " ").trim();
    if (line.length < 12 || line.length > 260) continue;
    if (!NUM.test(line) || !FACT.test(line)) continue;
    if (FORECAST.test(line) || NOISE.test(line)) continue;
    const key = line.slice(0, 40);
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(line);
  }
  fs.mkdirSync(OUT, { recursive: true });
  const out = `${header}\n\n${kept.map((l) => `- ${l}。`).join("\n")}\n`;
  fs.writeFileSync(path.join(OUT, file), out, "utf8");
  console.log(`${file.replace(".txt", "").padEnd(24)} ${raw.length.toLocaleString().padStart(7)}자 → ${out.length.toLocaleString().padStart(6)}자 · 문장 ${kept.length}`);
}
