import { supabaseRest } from './supabase.js';
import { AsyncLocalStorage } from 'node:async_hooks';
const context = new AsyncLocalStorage();
export const SEARCH_LIMITS = Object.freeze({search: 6, recovery: 2});
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
  await supabaseRest(`ingestion_guard?key=eq.collection&owner=eq.${encodeURIComponent(owner)}`,{method:'DELETE'});
}
export async function claimStage(owner,stage,hop) {
  if (!/^[0-9a-f-]{36}$/i.test(owner || '')) return false;
  const renewed=await supabaseRest(`ingestion_guard?key=eq.collection&owner=eq.${owner}&expires_at=gt.${new Date().toISOString()}`,{method:'PATCH',body:{expires_at:new Date(Date.now()+600000).toISOString()}});
  if (!renewed?.length) return false;
  const rows=await supabaseRest('ingestion_guard?on_conflict=key',{method:'POST',prefer:'resolution=ignore-duplicates,return=representation',body:{key:`${owner}:${stage}:${hop}`,owner,expires_at:new Date(Date.now()+86400000).toISOString()}});
  return Boolean(rows?.length);
}
