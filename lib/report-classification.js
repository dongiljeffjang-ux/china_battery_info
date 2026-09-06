// Copper foil is a current collector, not an anode active material.
// Only move unambiguous foil-only material points; preserve mixed-material points.
export function reportCategory(category, text) {
  if (!['양극재','음극재'].includes(category)) return category;
  const foil = /동박|铜箔|copper\s+foil/i.test(text);
  const active = /흑연|실리콘|인산철|리튬인산철|삼원계|양극\s*활물질|음극\s*활물질|石墨|硅碳|正极材料|负极材料|graphite|silicon|\bLFP\b|\bNCM\b/i.test(text);
  return foil && !active ? '정책·공급망' : category;
}
export function normalizeReportSections(sections) {
  const groups = new Map();
  for (const section of sections) for (const point of section.points || []) {
    const text = typeof point === 'string' ? point : point.fact_ko || '';
    const category = reportCategory(section.category,text);
    if (!groups.has(category)) groups.set(category,[]);
    groups.get(category).push(point);
  }
  return [...groups].map(([category,points])=>({category,points}));
}
export function normalizeStoredReport(text) {
  if (!text || !/^## /m.test(text)) return text;
  const sections=[];
  for (const line of text.split('\n')) {
    if (line.startsWith('## ')) sections.push({category:line.slice(3).trim(),points:[]});
    else if (line.trim() && sections.length) sections.at(-1).points.push(line);
  }
  return normalizeReportSections(sections).map(s=>`## ${s.category}\n${s.points.join('\n')}`).join('\n');
}
