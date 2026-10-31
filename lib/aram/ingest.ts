// POST /api/aram/ingest 처리: 형식 검증 → 중복 제거 → 잠금 안에서 집계.
import { aggKey, applySamples, isEligible, isRecentPatch, patchOf, pruneAgg, samplesFromIngest } from './aggregate';
import { filterUnseenCombos, markCombosSeen } from './comboIngest';
import { applyComboSamples, comboKey, loadCombos, pruneCombo, saveCombos } from './combos';
import type { ItemClasses } from './items';
import type { RedisLike } from './redis';
import {
  filterUnseenGames, loadAggs, markGamesSeen, registerPatches, saveAggs, tryLock, unlock,
} from './store';
import type { IngestGame, IngestResponse } from './types';

export const MAX_GAMES = 20;
// 값 범위 상한: 이상한 값으로 집계 키나 항목이 끝없이 늘어나는 것을 막습니다.
const MAX = { gameId: 1e12, champion: 999, spell: 99_999, item: 999_999, perk: 99_999, augment: 99_999, duration: 36_000 };
const VERSION = /^\d{1,2}\.\d{1,2}\.\d+/;

const isInt = (v: unknown, min: number, max: number): v is number =>
  Number.isInteger(v) && (v as number) >= min && (v as number) <= max;
const isIntArray = (v: unknown, len: number | [number, number], max: number): v is number[] => {
  if (!Array.isArray(v)) return false;
  const ok = Array.isArray(len) ? v.length >= len[0] && v.length <= len[1] : v.length === len;
  return ok && v.every((x) => isInt(x, 0, max));
};

function isValidParticipant(p: any): boolean {
  return (
    p != null &&
    isInt(p.championId, 1, MAX.champion) &&
    typeof p.win === 'boolean' &&
    isInt(p.spell1Id, 0, MAX.spell) &&
    isInt(p.spell2Id, 0, MAX.spell) &&
    isIntArray(p.items, 7, MAX.item) &&
    isIntArray(p.perks, 6, MAX.perk) &&
    isInt(p.perkPrimaryStyle, 0, MAX.perk) &&
    isInt(p.perkSubStyle, 0, MAX.perk) &&
    isIntArray(p.augments, [0, 6], MAX.augment)
  );
}

export function isValidGame(g: unknown): g is IngestGame {
  const x = g as any;
  return (
    x != null &&
    isInt(x.gameId, 1, MAX.gameId) &&
    isInt(x.queueId, 0, 99_999) &&
    typeof x.gameVersion === 'string' &&
    VERSION.test(x.gameVersion) &&
    isInt(x.gameDuration, 0, MAX.duration) &&
    typeof x.earlySurrender === 'boolean' &&
    Array.isArray(x.participants) &&
    x.participants.length === 10 &&
    x.participants.every(isValidParticipant)
  );
}

export function parseIngestRequest(body: unknown): { games: unknown[] } | null {
  const games = (body as any)?.games;
  if (!Array.isArray(games) || games.length === 0 || games.length > MAX_GAMES) return null;
  return { games };
}

// latestPatch: Data Dragon 최신 버전의 패치 (예: "16.21"). 그보다 새롭거나 너무 오래된 경기는 받지 않습니다.
export async function ingestGames(
  redis: RedisLike,
  latestPatch: string,
  games: unknown[],
  classes: ItemClasses,
): Promise<IngestResponse | 'locked'> {
  const usable: IngestGame[] = [];
  let rejected = 0;
  let duplicates = 0;
  const inBatch = new Set<number>();
  for (const g of games) {
    if (!isValidGame(g) || !isEligible(g) || !isRecentPatch(patchOf(g.gameVersion), latestPatch)) {
      rejected++;
    } else if (inBatch.has(g.gameId)) {
      duplicates++;
    } else {
      inBatch.add(g.gameId);
      usable.push(g);
    }
  }
  if (usable.length === 0) return { accepted: 0, duplicates, rejected };

  const token = await tryLock(redis);
  if (!token) return 'locked';
  try {
    const unseen = new Set(await filterUnseenGames(redis, usable.map((g) => String(g.gameId))));
    const fresh = usable.filter((g) => unseen.has(String(g.gameId)));
    duplicates += usable.length - fresh.length;

    if (fresh.length > 0) {
      const samples = fresh.flatMap((g) => samplesFromIngest(g, classes));
      const keys = [...new Set(samples.map((s) => aggKey(s.queue, s.patch, s.championId)))];
      const aggs = await loadAggs(redis, keys);
      applySamples(aggs, samples);
      for (const agg of aggs.values()) pruneAgg(agg);
      // 증강 조합 (아수라장, 패치별). 전적 목록(/api/aram/combo-ingest)으로 먼저 센 사람은 빼고 셈
      const comboCands = fresh
        .filter((g) => g.queueId === 2400)
        .flatMap((g) => samplesFromIngest(g, classes).map((s) => ({ gameId: g.gameId, championId: s.championId, s })));
      const comboFresh = await filterUnseenCombos(redis, comboCands);
      const combos = await loadCombos(redis, [...new Set(comboFresh.map((x) => comboKey(2400, x.s.patch)))]);
      applyComboSamples(combos, comboFresh.map((x) => x.s));
      for (const c of combos.values()) pruneCombo(c);
      // 패치 등록을 먼저 합니다 (실패해도 집계 전이라 다시 보내면 그대로 복구됨).
      await registerPatches(redis, [...new Set(fresh.map((g) => patchOf(g.gameVersion)))]);
      await saveAggs(redis, aggs);
      await saveCombos(redis, combos);
      // 누적값을 저장한 뒤에 기록합니다 (저장 전에 실패하면 앱이 다시 보낼 수 있도록).
      await markGamesSeen(redis, fresh.map((g) => String(g.gameId)));
      await markCombosSeen(redis, comboFresh);
    }
    return { accepted: fresh.length, duplicates, rejected };
  } finally {
    await unlock(redis, token).catch(() => {});
  }
}
