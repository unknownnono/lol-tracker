// 빌드 조회: 최신 패치와 직전 패치의 누적값을 읽어 추천을 계산합니다.
import { aggKey, type Queue } from './aggregate';
import { computeBuild } from './build';
import { upstash, type RedisLike } from './redis';
import { latestPatches, loadAggs } from './store';
import type { AramBuildResponse } from './types';

export async function getAramBuild(championId: number, queue: Queue, redis: RedisLike = upstash): Promise<AramBuildResponse> {
  const [patch, prevPatch] = await latestPatches(redis, 2);
  if (!patch) {
    return computeBuild({ championId, queue, patch: null, prevPatch: null, current: null, prev: null });
  }
  const currentKey = aggKey(queue, patch, championId);
  const prevKey = prevPatch ? aggKey(queue, prevPatch, championId) : null;
  const aggs = await loadAggs(redis, prevKey ? [currentKey, prevKey] : [currentKey]);
  return computeBuild({
    championId,
    queue,
    patch,
    prevPatch: prevPatch ?? null,
    current: aggs.get(currentKey) ?? null,
    prev: prevKey ? aggs.get(prevKey) ?? null : null,
  });
}
