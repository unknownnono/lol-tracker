// 증강 조합: 아수라장에서 한 사람이 같이 고른 증강 두 개의 판수·승수 (챔피언 구분 없이, 패치별).
// 같이 골랐을 때 승률이 두 증강 각자의 승률 평균보다 얼마나 높은지(lift)로 좋은 조합을 고릅니다.
import type { Pair, Sample } from './aggregate';
import { upstash, type RedisLike } from './redis';
import { latestPatches } from './store';
import type { ComboResponse, ComboStat } from './types';

export interface ComboAgg {
  s: Record<string, Pair>; // 증강 하나
  p: Record<string, Pair>; // 증강 두 개 "작은id-큰id"
}

export const COMBO = {
  maxPairs: 40_000, // 저장 크기 상한 (넘으면 1판짜리부터 지움)
  minGames: 8, // 응답에 넣을 조합의 최소 판수
} as const;

export const comboKey = (queue: number, patch: string) => `aram:combo:${queue}:${patch}`;
export const emptyCombo = (): ComboAgg => ({ s: {}, p: {} });
export const pairKey = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);

function bump(rec: Record<string, Pair>, key: string, win: boolean) {
  const cur = rec[key] ?? [0, 0];
  cur[0] += 1;
  if (win) cur[1] += 1;
  rec[key] = cur;
}

// 아수라장 표본만, 패치별 누적값에 더함
export function applyComboSamples(aggs: Map<string, ComboAgg>, samples: Sample[]) {
  for (const s of samples) {
    if (s.queue !== 2400 || s.augments.length === 0) continue;
    const key = comboKey(s.queue, s.patch);
    const agg = aggs.get(key) ?? emptyCombo();
    aggs.set(key, agg);
    const ids = [...new Set(s.augments)].sort((a, b) => a - b);
    for (const id of ids) bump(agg.s, String(id), s.win);
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) bump(agg.p, pairKey(ids[i], ids[j]), s.win);
  }
}

export function pruneCombo(agg: ComboAgg, max: number = COMBO.maxPairs) {
  const keys = Object.keys(agg.p);
  if (keys.length <= max) return;
  for (const k of keys) if (agg.p[k][0] <= 1) delete agg.p[k];
  const entries = Object.entries(agg.p);
  if (entries.length <= max) return;
  entries.sort(([, [ga]], [, [gb]]) => gb - ga);
  for (const [k] of entries.slice(max)) delete agg.p[k];
}

const round4 = (x: number) => Math.round(x * 10000) / 10000;

// 패치 여러 개를 합쳐 minGames 이상인 조합. lift = 조합 승률 - (두 증강 각자 승률의 평균)
export function computeCombos(aggs: ComboAgg[], minGames: number = COMBO.minGames): ComboStat[] {
  const s = new Map<string, Pair>();
  const p = new Map<string, Pair>();
  const add = (m: Map<string, Pair>, k: string, [g, w]: Pair) => {
    const cur = m.get(k) ?? [0, 0];
    m.set(k, [cur[0] + g, cur[1] + w]);
  };
  for (const a of aggs) {
    for (const [k, v] of Object.entries(a.s)) add(s, k, v);
    for (const [k, v] of Object.entries(a.p)) add(p, k, v);
  }
  const rate = (k: string) => {
    const v = s.get(k);
    return v && v[0] > 0 ? v[1] / v[0] : null;
  };
  const out: ComboStat[] = [];
  for (const [k, [g, w]] of p) {
    if (g < minGames) continue;
    const [a, b] = k.split('-');
    const ra = rate(a);
    const rb = rate(b);
    if (ra === null || rb === null) continue;
    const winRate = w / g;
    out.push({ a: Number(a), b: Number(b), games: g, winRate: round4(winRate), lift: round4(winRate - (ra + rb) / 2) });
  }
  return out.sort((x, y) => y.lift - x.lift);
}

export async function loadCombos(r: RedisLike, keys: string[]): Promise<Map<string, ComboAgg>> {
  const out = new Map<string, ComboAgg>();
  if (keys.length === 0) return out;
  const values = await r.cmd<(string | null)[]>(['MGET', ...keys]);
  keys.forEach((k, i) => {
    const v = values[i];
    if (v) out.set(k, JSON.parse(v) as ComboAgg);
  });
  return out;
}

export async function saveCombos(r: RedisLike, aggs: Map<string, ComboAgg>): Promise<void> {
  if (aggs.size === 0) return;
  const args: string[] = [];
  for (const [k, v] of aggs) args.push(k, JSON.stringify(v));
  await r.cmd(['MSET', ...args]);
}

// 최신·직전 패치 합산
export async function getCombos(queue: 2400, redis: RedisLike = upstash): Promise<ComboResponse> {
  const patches = await latestPatches(redis, 2);
  const aggs = await loadCombos(redis, patches.map((p) => comboKey(queue, p)));
  return { queue, patches, combos: computeCombos([...aggs.values()]) };
}
