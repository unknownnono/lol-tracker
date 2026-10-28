// 칼바람 통계가 쓰는 Redis 키 조작을 모아둡니다. 명령 수가 곧 요금이라 묶어서 보냅니다.
import { randomUUID } from 'node:crypto';
import type { ChampAgg } from './aggregate';
import type { RedisLike } from './redis';

export const SEEN_GAME_KEY = 'aram:seen:game';
export const PATCHES_KEY = 'aram:patches';
export const LOCK_KEY = 'aram:lock';
export const LOCK_TTL_SEC = 60;

export async function loadAggs(r: RedisLike, keys: string[]): Promise<Map<string, ChampAgg>> {
  const out = new Map<string, ChampAgg>();
  if (keys.length === 0) return out;
  const values = await r.cmd<(string | null)[]>(['MGET', ...keys]);
  keys.forEach((k, i) => {
    const v = values[i];
    if (v) out.set(k, JSON.parse(v) as ChampAgg);
  });
  return out;
}

export async function saveAggs(r: RedisLike, aggs: Map<string, ChampAgg>): Promise<void> {
  if (aggs.size === 0) return;
  const args: string[] = [];
  for (const [k, v] of aggs) args.push(k, JSON.stringify(v));
  await r.cmd(['MSET', ...args]);
}

export function patchScore(patch: string) {
  const [major, minor] = patch.split('.').map(Number);
  return major * 1000 + minor;
}

export async function registerPatches(r: RedisLike, patches: string[]): Promise<void> {
  if (patches.length === 0) return;
  await r.cmd(['ZADD', PATCHES_KEY, ...patches.flatMap((p) => [patchScore(p), p])]);
}

export async function latestPatches(r: RedisLike, n: number): Promise<string[]> {
  return r.cmd<string[]>(['ZREVRANGE', PATCHES_KEY, 0, n - 1]);
}

export async function filterUnseenGames(r: RedisLike, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const flags = await r.cmd<number[]>(['SMISMEMBER', SEEN_GAME_KEY, ...ids]);
  return ids.filter((_, i) => !flags[i]);
}

export async function markGamesSeen(r: RedisLike, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await r.cmd(['SADD', SEEN_GAME_KEY, ...ids]);
}

// 잠금 값으로 무작위 토큰을 써서, 잠금이 만료된 뒤 다른 인스턴스가 잡은 잠금을 지우지 않게 합니다.
export async function tryLock(r: RedisLike, ttlSec = LOCK_TTL_SEC): Promise<string | null> {
  const token = randomUUID();
  return (await r.cmd(['SET', LOCK_KEY, token, 'NX', 'EX', ttlSec])) === 'OK' ? token : null;
}

export async function unlock(r: RedisLike, token: string): Promise<void> {
  if ((await r.cmd<string | null>(['GET', LOCK_KEY])) === token) await r.cmd(['DEL', LOCK_KEY]);
}
