// 스킬 빌드: Riot API 일반 칼바람(450) 경기 타임라인의 SKILL_LEVEL_UP 기록 → 챔피언별 스킬 순서 통계.
// 아수라장 경기는 Riot API가 막아 두어서, 같은 맵인 일반 칼바람 순서를 대신 씁니다. 순수 함수만 둡니다.
import type { Pair } from './aggregate';
import type { BuildStat, SkillBuild } from './types';

export const SKILL_QUEUE = 450;
// 스킬 순서는 패치 영향이 적어 패치를 나누지 않고 챔피언별 한 키에 쌓되, 약 반년(12패치) 안의 경기만 받습니다.
export const SKILL_PATCH_WINDOW = 12;
export const SEQ_LEVELS = 15; // 레벨별 순서는 15레벨까지
// 15레벨 전에 끝난 판은 순서가 덜 찍혀 있어 버립니다 (짧은 순서가 다른 순서로 따로 집계되는 것 방지)
const SLOT = ['', 'Q', 'W', 'E', 'R'];

export interface SkillAgg {
  g: number;
  w: number;
  q: Record<string, Pair>; // 레벨별 순서 (예: "QWEQQRQEQEREEWW")
  m: Record<string, Pair>; // 기본 스킬 선마 순서 (예: "QEW")
  st?: Record<string, Pair>; // 시작 아이템 (예: "1055,2003,2003"). 예전 누적값에는 없을 수 있음
}
export interface SkillSample { championId: number; win: boolean; seq: string; order: string; start: string | null }

const START_WINDOW_MS = 90_000; // 시작 1분 30초 안에 산 아이템을 시작 아이템으로

// 시작 아이템: 시작 직후 산 아이템에서 되돌리기·판매를 빼고 정렬한 목록 (없으면 null)
export function startItems(timeline: any, participantId: number): string | null {
  const events = (timeline?.info?.frames ?? [])
    .flatMap((f: any) => f?.events ?? [])
    .filter((e: any) => e?.participantId === participantId && (e.timestamp ?? Infinity) <= START_WINDOW_MS)
    .sort((a: any, b: any) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
  const bag: number[] = [];
  const drop = (id: number) => {
    const i = bag.lastIndexOf(id);
    if (i >= 0) bag.splice(i, 1);
  };
  for (const e of events) {
    if (e.type === 'ITEM_PURCHASED' && e.itemId) bag.push(e.itemId);
    else if (e.type === 'ITEM_UNDO' && e.beforeId) drop(e.beforeId);
    else if (e.type === 'ITEM_SOLD' && e.itemId) drop(e.itemId);
  }
  return bag.length > 0 ? bag.sort((a, b) => a - b).join(',') : null;
}

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
    if (full.length < SEQ_LEVELS) return [];
    const seq = full.slice(0, SEQ_LEVELS);
    return [{ championId: p.championId, win: !!p.win, seq, order: maxOrder(full), start: startItems(timeline, p.participantId) }];
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
    if (s.start) bump((agg.st ??= {}), s.start, s.win);
  }
}

// 순서 종류가 너무 많아지면 한 판짜리를 지우고 상위 max개만 남김
export function pruneSkillAgg(agg: SkillAgg, max = 40) {
  for (const rec of [agg.q, agg.st]) {
    if (!rec || Object.keys(rec).length <= max) continue;
    for (const [k, [g]] of Object.entries(rec)) if (g <= 1) delete rec[k];
    const entries = Object.entries(rec).sort(([, [a]], [, [b]]) => b - a);
    for (const [k] of entries.slice(max)) delete rec[k];
  }
}

export function mergeSkillAggs(a: SkillAgg, b: SkillAgg): SkillAgg {
  const out = emptySkillAgg();
  out.g = a.g + b.g;
  out.w = a.w + b.w;
  for (const cat of ['q', 'm', 'st'] as const) {
    for (const src of [a, b]) {
      for (const [k, [g, w]] of Object.entries(src[cat] ?? {})) {
        const rec = (out[cat] ??= {});
        const cur = rec[k] ?? [0, 0];
        rec[k] = [cur[0] + g, cur[1] + w];
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
  // 예전에 15레벨 전에 끝난 판까지 받던 때 쌓인 짧은 순서는 보여주지 않음
  const full = Object.fromEntries(Object.entries(agg.q).filter(([k]) => k.length === SEQ_LEVELS));
  return {
    queue: SKILL_QUEUE,
    sampleSize: agg.g,
    orders: top(agg.m, agg.g, 3, MIN_SKILL_GAMES),
    sequences: top(full, agg.g, 3, MIN_SKILL_GAMES),
    starts: top(agg.st ?? {}, agg.g, 2, MIN_SKILL_GAMES),
  };
}
