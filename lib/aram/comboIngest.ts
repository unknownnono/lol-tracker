// POST /api/aram/combo-ingest 처리: 경기 상세 없이 '한 사람의 한 판 증강과 승패'만 받아 증강 조합에 더합니다.
// 데스크톱 앱이 다른 유저 전적 목록(그 사람 기록만 들어 있음)에서 뽑아 보냅니다.
// 같은 판·같은 챔피언은 한 번만 셉니다 (경기 상세로 들어온 경우와도 겹치지 않게 같은 기록을 씀).
import { isRecentPatch, patchOf, type Sample } from './aggregate';
import { applyComboSamples, comboKey, loadCombos, pruneCombo, saveCombos } from './combos';
import type { RedisLike } from './redis';
import { registerPatches, tryLock, unlock } from './store';
import type { ComboSampleIn, IngestResponse } from './types';

export const COMBO_SEEN_KEY = 'aram:seen:combo';
export const MAX_COMBO_SAMPLES = 200;
const MIN_GAME_SECONDS = 300;
const VERSION = /^\d{1,2}\.\d{1,2}\.\d+/;

const isInt = (v: unknown, min: number, max: number): v is number => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;

export function isValidComboSample(x: any): x is ComboSampleIn {
  return (
    x != null &&
    isInt(x.gameId, 1, 1e12) &&
    typeof x.gameVersion === 'string' &&
    VERSION.test(x.gameVersion) &&
    isInt(x.gameDuration, 0, 36_000) &&
    typeof x.earlySurrender === 'boolean' &&
    isInt(x.championId, 1, 999) &&
    typeof x.win === 'boolean' &&
    Array.isArray(x.augments) &&
    x.augments.length <= 6 &&
    x.augments.every((a: unknown) => isInt(a, 0, 99_999))
  );
}

export function parseComboRequest(body: unknown): { samples: unknown[] } | null {
  const samples = (body as any)?.samples;
  if (!Array.isArray(samples) || samples.length === 0 || samples.length > MAX_COMBO_SAMPLES) return null;
  return { samples };
}

export const comboSeenId = (gameId: number, championId: number) => `${gameId}:${championId}`;

// 아직 조합에 안 센 표본만 남김 (SMISMEMBER 1번)
export async function filterUnseenCombos<T extends { gameId: number; championId: number }>(r: RedisLike, xs: T[]): Promise<T[]> {
  if (xs.length === 0) return [];
  const flags = await r.cmd<number[]>(['SMISMEMBER', COMBO_SEEN_KEY, ...xs.map((x) => comboSeenId(x.gameId, x.championId))]);
  return xs.filter((_, i) => !flags[i]);
}

export async function markCombosSeen(r: RedisLike, xs: { gameId: number; championId: number }[]): Promise<void> {
  if (xs.length === 0) return;
  await r.cmd(['SADD', COMBO_SEEN_KEY, ...xs.map((x) => comboSeenId(x.gameId, x.championId))]);
}

const toSample = (x: ComboSampleIn): Sample => ({
  queue: 2400,
  patch: patchOf(x.gameVersion),
  championId: x.championId,
  win: x.win,
  rune: null,
  spell: '',
  items: [],
  boots: null,
  augments: [...new Set(x.augments.filter((a) => a > 0))],
});

export async function ingestComboSamples(redis: RedisLike, latestPatch: string, raw: unknown[]): Promise<IngestResponse | 'locked'> {
  const usable: ComboSampleIn[] = [];
  const inBatch = new Set<string>();
  let rejected = 0;
  let duplicates = 0;
  for (const x of raw) {
    if (
      !isValidComboSample(x) ||
      x.gameDuration < MIN_GAME_SECONDS ||
      x.earlySurrender ||
      x.augments.filter((a) => a > 0).length < 2 ||
      !isRecentPatch(patchOf(x.gameVersion), latestPatch)
    ) {
      rejected++;
      continue;
    }
    const id = comboSeenId(x.gameId, x.championId);
    if (inBatch.has(id)) duplicates++;
    else {
      inBatch.add(id);
      usable.push(x);
    }
  }
  if (usable.length === 0) return { accepted: 0, duplicates, rejected };

  const token = await tryLock(redis);
  if (!token) return 'locked';
  try {
    const fresh = await filterUnseenCombos(redis, usable);
    duplicates += usable.length - fresh.length;
    if (fresh.length > 0) {
      const samples = fresh.map(toSample);
      const combos = await loadCombos(redis, [...new Set(samples.map((s) => comboKey(2400, s.patch)))]);
      applyComboSamples(combos, samples);
      for (const c of combos.values()) pruneCombo(c);
      await registerPatches(redis, [...new Set(samples.map((s) => s.patch))]);
      await saveCombos(redis, combos);
      await markCombosSeen(redis, fresh);
    }
    return { accepted: fresh.length, duplicates, rejected };
  } finally {
    await unlock(redis, token).catch(() => {});
  }
}
