// 누적값 → 추천 빌드 응답
import { AGG_CATS, emptyAgg, type ChampAgg, type Pair, type Queue } from './aggregate';
import type { AramBuildResponse, BuildStat } from './types';

export const LOW_SAMPLE = 30;
export const MIN_ITEM_GAMES = 5;

const round4 = (x: number) => Math.round(x * 10000) / 10000;

export function mergeAggs(a: ChampAgg, b: ChampAgg): ChampAgg {
  const out = emptyAgg();
  out.g = a.g + b.g;
  out.w = a.w + b.w;
  for (const cat of AGG_CATS) {
    for (const src of [a, b]) {
      for (const [k, [g, w]] of Object.entries(src[cat])) {
        const cur = out[cat][k] ?? [0, 0];
        out[cat][k] = [cur[0] + g, cur[1] + w];
      }
    }
  }
  return out;
}

export function topStats(rec: Record<string, Pair>, total: number, limit: number): BuildStat[] {
  return Object.entries(rec)
    .filter(([, [g]]) => g >= MIN_ITEM_GAMES)
    .sort(([, [ga, wa]], [, [gb, wb]]) => gb - ga || wb / gb - wa / ga)
    .slice(0, limit)
    .map(([key, [g, w]]) => ({
      key,
      games: g,
      winRate: round4(w / g),
      pickRate: total > 0 ? round4(g / total) : 0,
    }));
}

export function computeBuild(input: {
  championId: number;
  queue: Queue;
  patch: string | null;
  prevPatch: string | null;
  current: ChampAgg | null;
  prev: ChampAgg | null;
}): AramBuildResponse {
  let agg = input.current ?? emptyAgg();
  const mergedPatches: string[] = [];
  if (agg.g < LOW_SAMPLE && input.prev && input.prevPatch && input.prev.g > 0) {
    agg = mergeAggs(agg, input.prev);
    mergedPatches.push(input.prevPatch);
  }
  return {
    championId: input.championId,
    queue: input.queue,
    patch: input.patch ?? '',
    mergedPatches,
    sampleSize: agg.g,
    lowSample: agg.g < LOW_SAMPLE,
    runes: topStats(agg.r, agg.g, 3),
    spells: topStats(agg.s, agg.g, 2),
    coreItems: topStats(agg.i, agg.g, 6),
    boots: topStats(agg.b, agg.g, 2),
    augments: input.queue === 2400 ? topStats(agg.a, agg.g, 10) : [],
  };
}
