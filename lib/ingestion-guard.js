import { supabaseRest } from './supabase.js';
import { AsyncLocalStorage } from 'node:async_hooks';
const context = new AsyncLocalStorage();
// 회사 31곳을 4곳씩 나누면 밸류체인별 3+3+3=9그룹, 제공자 2곳이면 요청 18회가 정상 상한이다.
export const SEARCH_LIMITS = Object.freeze({search: 18, recovery: 4});
export function withSearchBudget(fn) { return context.run({search:0,recovery:0},fn); }
export function takeSearchBudget(kind) {
  const budget=context.getStore();
  if (!budget) return;
  if (budget[kind] >= SEARCH_LIMITS[kind]) throw new Error(`${kind.toUpperCase()}_BUDGET_EXHAUSTED`);
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
