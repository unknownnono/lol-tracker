// 빌드 조회: 최신 패치와 직전 패치의 누적값을 읽어 추천을 계산합니다.
import { aggKey, type Queue } from './aggregate';
import { computeBuild } from './build';
import { skillKey, type SkillAgg } from './skills';
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
  // 스킬 순서(일반 칼바람 기준, 패치 구분 없음)도 같은 MGET 한 번으로 읽습니다.
  const keys = [currentKey, ...(prevKey ? [prevKey] : [])];
  const aggs = await loadAggs(redis, [...keys, skillKey(championId)]);
  const skills = (aggs.get(skillKey(championId)) as unknown as SkillAgg | undefined) ?? null;
  return computeBuild({
    skills,
    championId,
    queue,
    patch,
    prevPatch: prevPatch ?? null,
    current: aggs.get(currentKey) ?? null,
    prev: prevKey ? aggs.get(prevKey) ?? null : null,
  });
}
