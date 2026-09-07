import { supabaseRest } from './supabase.js';
import { AsyncLocalStorage } from 'node:async_hooks';
const context = new AsyncLocalStorage();
// 예산을 손으로 적으면 회사가 늘 때마다 어긋난다. 2026-09-07 09:28 실행에서 실제 요청은 20회인데
// 상한이 18이라 마지막 2건이 굶었다. 호출자가 이번 실행의 계획 요청 수를 넘겨 주고, 여기서는
// 안전 여유만 더한다. 넘기지 않으면 아래 기본값을 쓴다.
export const SEARCH_LIMITS = Object.freeze({search: 24, recovery: 4});
// 재시도나 예상 밖 경로를 위한 여유. 계획보다 이만큼 더 허용한다.
const SEARCH_HEADROOM = 4;
export function searchBudgetFor(plannedRequests) {
  return {
    search: Math.max(SEARCH_LIMITS.search, (Number(plannedRequests) || 0) + SEARCH_HEADROOM),
    recovery: SEARCH_LIMITS.recovery,
  };
}
export function withSearchBudget(fn, limits = SEARCH_LIMITS) {
  return context.run({search:0, recovery:0, limits}, fn);
}
export function takeSearchBudget(kind) {
  const budget=context.getStore();
  if (!budget) return;
  const limit=(budget.limits || SEARCH_LIMITS)[kind];
  if (budget[kind] >= limit) throw new Error(`${kind.toUpperCase()}_BUDGET_EXHAUSTED`);
  budget[kind]++;
}
export async function acquireRun() {
  const owner=crypto.randomUUID();
  const now=new Date().toISOString();
  const body={owner,expires_at:new Date(Date.now()+600000).toISOString()};
  const inserted=await supabaseRest('ingestion_guard?on_conflict=key',{method:'POST',prefer:'resolution=ignore-duplicates,return=representation',body:{key:'collection',...body}});
  if (inserted?.length) return owner;
  const claimed=await supabaseRest(`ingestion_guard?key=eq.collection&expires_at=lt.${now}`,{method:'PATCH',body});
  return claimed?.length ? owner : null;
}
export async function releaseRun(owner) {
  if (!/^[0-9a-f-]{36}$/i.test(owner || '')) return;
  // collection 리스와 이 실행이 만든 단계 claim 행을 함께 지운다. 만료된 다른 실행의 잔여 행도 정리한다.
  await supabaseRest(`ingestion_guard?owner=eq.${encodeURIComponent(owner)}`,{method:'DELETE'});
  await supabaseRest(`ingestion_guard?key=neq.collection&expires_at=lt.${new Date().toISOString()}`,{method:'DELETE'}).catch(() => {});
}
export async function claimStage(owner,stage,hop) {
  if (!/^[0-9a-f-]{36}$/i.test(owner || '')) return false;
  const renewed=await supabaseRest(`ingestion_guard?key=eq.collection&owner=eq.${owner}&expires_at=gt.${new Date().toISOString()}`,{method:'PATCH',body:{expires_at:new Date(Date.now()+600000).toISOString()}});
  if (!renewed?.length) return false;
  const rows=await supabaseRest('ingestion_guard?on_conflict=key',{method:'POST',prefer:'resolution=ignore-duplicates,return=representation',body:{key:`${owner}:${stage}:${hop}`,owner,expires_at:new Date(Date.now()+86400000).toISOString()}});
  return Boolean(rows?.length);
}
