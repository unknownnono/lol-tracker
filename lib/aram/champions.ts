// 챔피언 티어표: 최신·직전 패치 누적값의 판수·승수로 아수라장 챔피언별 승률·픽률·등급을 계산합니다.
import { aggKey, type ChampAgg } from './aggregate';
import { upstash, type RedisLike } from './redis';
import { latestPatches, loadAggs } from './store';
import type { ChampionStat, ChampionTierResponse } from './types';

// 판수가 적은 챔피언의 승률이 튀지 않도록, 이 판수만큼 전체 평균 승률을 섞어 보정합니다.
const PRIOR_GAMES = 30;
const round4 = (x: number) => Math.round(x * 10000) / 10000;

// 보정 승률이 평균보다 몇 %p 높은지로 S~D (챔피언 승률은 증강보다 폭이 좁아 기준도 좁게)
export function championTier(diffPct: number): ChampionStat['tier'] {
  return diffPct >= 3 ? 'S' : diffPct >= 1 ? 'A' : diffPct > -1 ? 'B' : diffPct > -3 ? 'C' : 'D';
}

export function computeChampionTiers(byChampion: Map<number, { g: number; w: number }>): ChampionStat[] {
  const entries = [...byChampion.entries()].filter(([, a]) => a.g > 0);
  const totalSamples = entries.reduce((n, [, a]) => n + a.g, 0);
  if (totalSamples === 0) return [];
  const mean = entries.reduce((n, [, a]) => n + a.w, 0) / totalSamples;
  const games = totalSamples / 10; // 한 경기에 챔피언 10명
  return entries
    .map(([championId, a]) => {
      const adjusted = (a.w + PRIOR_GAMES * mean) / (a.g + PRIOR_GAMES);
      return {
        championId,
        games: a.g,
        winRate: round4(a.w / a.g),
        pickRate: round4(a.g / games),
        tier: championTier((adjusted - mean) * 100),
        score: adjusted,
      };
    })
    .sort((x, y) => y.score - x.score)
    .map(({ score: _score, ...rest }) => rest);
}

// 챔피언 ID 전체 × 패치 2개를 MGET 한 번으로 읽습니다 (명령 수 = 요금).
export async function getChampionTiers(championIds: number[], queue: 2400, redis: RedisLike = upstash): Promise<ChampionTierResponse> {
  const patches = await latestPatches(redis, 2);
  if (patches.length === 0) return { queue, patches: [], games: 0, champions: [] };
  const keys = championIds.flatMap((id) => patches.map((p) => aggKey(queue, p, id)));
  const aggs = await loadAggs(redis, keys);
  const by = new Map<number, { g: number; w: number }>();
  for (const id of championIds) {
    for (const p of patches) {
      const a: ChampAgg | undefined = aggs.get(aggKey(queue, p, id));
      if (!a) continue;
      const cur = by.get(id) ?? { g: 0, w: 0 };
      by.set(id, { g: cur.g + a.g, w: cur.w + a.w });
    }
  }
  const champions = computeChampionTiers(by);
  return { queue, patches, games: Math.round(champions.reduce((n, c) => n + c.games, 0) / 10), champions };
}
