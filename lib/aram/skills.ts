// 스킬 빌드: Riot API 일반 칼바람(450) 경기 타임라인의 SKILL_LEVEL_UP 기록 → 챔피언별 스킬 순서 통계.
// 아수라장 경기는 Riot API가 막아 두어서, 같은 맵인 일반 칼바람 순서를 대신 씁니다. 순수 함수만 둡니다.
import type { Pair } from './aggregate';
import type { BuildStat, SkillBuild } from './types';

export const SKILL_QUEUE = 450;
// 스킬 순서는 패치 영향이 적어 패치를 나누지 않고 챔피언별 한 키에 쌓되, 약 반년(12패치) 안의 경기만 받습니다.
export const SKILL_PATCH_WINDOW = 12;
export const SEQ_LEVELS = 15; // 레벨별 순서는 15레벨까지
const MIN_LEVELS = 9; // 이보다 일찍 끝난 판(스킬을 덜 찍은 판)은 빼기
const SLOT = ['', 'Q', 'W', 'E', 'R'];

export interface SkillAgg {
  g: number;
  w: number;
  q: Record<string, Pair>; // 레벨별 순서 (예: "QWEQQRQEQEREEWW")
  m: Record<string, Pair>; // 기본 스킬 선마 순서 (예: "QEW")
}
export interface SkillSample { championId: number; win: boolean; seq: string; order: string }

export const emptySkillAgg = (): SkillAgg => ({ g: 0, w: 0, q: {}, m: {} });
export const skillKey = (championId: number) => `aram:skill:${championId}`;

// 한 참가자의 스킬 찍은 순서 (진화 EVOLVE는 제외)
export function skillSequence(timeline: any, participantId: number): string {
  const events = (timeline?.info?.frames ?? []).flatMap((f: any) => f?.events ?? []);
  return events
    .filter((e: any) => e?.type === 'SKILL_LEVEL_UP' && e.participantId === participantId && e.levelUpType !== 'EVOLVE')
    .sort((a: any, b: any) => (a.timestamp ?? 0) - (b.timestamp ?? 0))
    .map((e: any) => SLOT[e.skillSlot] ?? '')
    .join('');
}

// 기본 스킬(Q·W·E) 선마 순서: 5레벨에 먼저 닿은 순, 못 닿은 스킬은 많이 찍은 순, 같으면 먼저 찍은 순
export function maxOrder(seq: string): string {
  const reached: Record<string, number> = {};
  const count: Record<string, number> = { Q: 0, W: 0, E: 0 };
  const first: Record<string, number> = {};
  [...seq].forEach((s, i) => {
    if (!(s in count)) return;
    count[s] += 1;
    first[s] ??= i;
    if (count[s] === 5) reached[s] = i;
  });
  return ['Q', 'W', 'E']
    .sort(
      (a, b) =>
        (reached[a] ?? Infinity) - (reached[b] ?? Infinity) || count[b] - count[a] || (first[a] ?? Infinity) - (first[b] ?? Infinity),
    )
    .join('');
}

// 경기 상세 + 타임라인 → 10명의 표본 (다시하기·조기 항복·너무 짧은 기록 제외)
export function skillSamples(match: any, timeline: any): SkillSample[] {
  const info = match?.info;
  if (info?.queueId !== SKILL_QUEUE || (info.gameDuration ?? 0) < 300) return [];
  return (info.participants ?? []).flatMap((p: any) => {
    if (p.gameEndedInEarlySurrender) return [];
    const full = skillSequence(timeline, p.participantId);
    if (full.length < MIN_LEVELS) return [];
    const seq = full.slice(0, SEQ_LEVELS);
    return [{ championId: p.championId, win: !!p.win, seq, order: maxOrder(full) }];
  });
}

function bump(rec: Record<string, Pair>, key: string, win: boolean) {
  const cur = rec[key] ?? [0, 0];
  cur[0] += 1;
  if (win) cur[1] += 1;
  rec[key] = cur;
}

export function applySkillSamples(aggs: Map<string, SkillAgg>, samples: SkillSample[]) {
  for (const s of samples) {
    const key = skillKey(s.championId);
    const agg = aggs.get(key) ?? emptySkillAgg();
    aggs.set(key, agg);
    agg.g += 1;
    if (s.win) agg.w += 1;
    bump(agg.q, s.seq, s.win);
    bump(agg.m, s.order, s.win);
  }
}

// 순서 종류가 너무 많아지면 한 판짜리를 지우고 상위 max개만 남김
export function pruneSkillAgg(agg: SkillAgg, max = 40) {
  const rec = agg.q;
  if (Object.keys(rec).length <= max) return;
  for (const [k, [g]] of Object.entries(rec)) if (g <= 1) delete rec[k];
  const entries = Object.entries(rec).sort(([, [a]], [, [b]]) => b - a);
  for (const [k] of entries.slice(max)) delete rec[k];
}

export function mergeSkillAggs(a: SkillAgg, b: SkillAgg): SkillAgg {
  const out = emptySkillAgg();
  out.g = a.g + b.g;
  out.w = a.w + b.w;
  for (const cat of ['q', 'm'] as const) {
    for (const src of [a, b]) {
      for (const [k, [g, w]] of Object.entries(src[cat])) {
        const cur = out[cat][k] ?? [0, 0];
        out[cat][k] = [cur[0] + g, cur[1] + w];
      }
    }
  }
  return out;
}

const round4 = (x: number) => Math.round(x * 10000) / 10000;
const top = (rec: Record<string, Pair>, total: number, limit: number, min: number): BuildStat[] =>
  Object.entries(rec)
    .filter(([, [g]]) => g >= min)
    .sort(([, [ga]], [, [gb]]) => gb - ga)
    .slice(0, limit)
    .map(([key, [g, w]]) => ({ key, games: g, winRate: round4(w / g), pickRate: total > 0 ? round4(g / total) : 0 }));

export const MIN_SKILL_GAMES = 3;

export function computeSkills(agg: SkillAgg | null): SkillBuild | null {
  if (!agg || agg.g === 0) return null;
  return {
    queue: SKILL_QUEUE,
    sampleSize: agg.g,
    orders: top(agg.m, agg.g, 3, MIN_SKILL_GAMES),
    sequences: top(agg.q, agg.g, 3, MIN_SKILL_GAMES),
  };
}
