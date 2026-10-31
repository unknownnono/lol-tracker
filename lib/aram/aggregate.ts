// 수집된 경기 → 챔피언별 표본 → 누적값. Redis와 분리된 순수 함수만 둡니다.
import type { ItemClasses } from './items';
import type { IngestGame } from './types';

export type Queue = 450 | 2400;
export type Pair = [number, number]; // [판수, 승수]

export interface ChampAgg {
  g: number;
  w: number;
  r: Record<string, Pair>; // 룬 조합
  s: Record<string, Pair>; // 스펠 조합
  i: Record<string, Pair>; // 완성 아이템
  b: Record<string, Pair>; // 신발
  a: Record<string, Pair>; // 증강 (Mayhem)
  // 아이템 빌드 순서: 아이템은 사면 앞 빈칸부터 들어가서 칸 순서 ≈ 산 순서. 예전 누적값에는 없을 수 있음
  c?: Record<string, Pair>; // 완성 아이템 첫 3개 "A>B>C"
  n4?: Record<string, Pair>; // 4번째 완성 아이템
  n5?: Record<string, Pair>;
  n6?: Record<string, Pair>;
}
export const AGG_CATS = ['r', 's', 'i', 'b', 'a', 'c', 'n4', 'n5', 'n6'] as const;

export interface Sample {
  queue: Queue;
  patch: string;
  championId: number;
  win: boolean;
  rune: string | null;
  spell: string;
  items: number[]; // 완성 아이템, 칸 순서
  boots: number | null;
  augments: number[];
}

const MIN_GAME_SECONDS = 300;

export function emptyAgg(): ChampAgg {
  return { g: 0, w: 0, r: {}, s: {}, i: {}, b: {}, a: {}, c: {}, n4: {}, n5: {}, n6: {} };
}

export function aggKey(queue: Queue, patch: string, championId: number) {
  return `aram:agg:${queue}:${patch}:${championId}`;
}

export function patchOf(gameVersion: string) {
  const [major, minor] = gameVersion.split('.');
  return `${major}.${minor}`;
}

export function spellKey(a: number, b: number) {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

// LCU 경기 상세에는 룬 파편 정보가 없어서 파편을 뺀 키를 씁니다.
// Mayhem은 룬 대신 증강을 써서 LCU 기록의 룬 값이 전부 0입니다. 0이 섞이면 룬 정보가 없는 것으로 봅니다.
export function runeKeyOf(primary: number, perks: number[], sub: number): string | null {
  if (perks.length !== 6 || !primary || !sub || perks.some((p) => !p)) return null;
  return `${primary}:${perks.slice(0, 4).join('-')}:${sub}:${perks.slice(4).join('-')}`;
}

const patchParts = (patch: string) => patch.split('.').map(Number) as [number, number];

// 최신 패치와 그 이전 maxBack개 패치까지만 받습니다 (미래 패치나 오래된 패치로 조회가 망가지는 것 방지).
// 한 해의 마지막 패치는 24번으로 보고 연도 경계를 계산합니다.
export function isRecentPatch(patch: string, latestPatch: string, maxBack = 3): boolean {
  const [major, minor] = patchParts(patch);
  const [lMajor, lMinor] = patchParts(latestPatch);
  if (![major, minor, lMajor, lMinor].every(Number.isInteger)) return false;
  const index = (m: number, n: number) => m * 24 + n;
  const diff = index(lMajor, lMinor) - index(major, minor);
  return diff >= 0 && diff <= maxBack;
}

export function isEligible(game: IngestGame): boolean {
  if (game.queueId !== 450 && game.queueId !== 2400) return false;
  if (game.gameDuration < MIN_GAME_SECONDS) return false;
  return !game.earlySurrender;
}

export function samplesFromIngest(game: IngestGame, classes: ItemClasses): Sample[] {
  if (!isEligible(game)) return [];
  const patch = patchOf(game.gameVersion);
  return game.participants.map((p) => ({
    queue: game.queueId,
    patch,
    championId: p.championId,
    win: p.win,
    rune: runeKeyOf(p.perkPrimaryStyle, p.perks, p.perkSubStyle),
    spell: spellKey(p.spell1Id, p.spell2Id),
    items: [...new Set(p.items.filter((id) => classes.completed.has(id)))],
    boots: p.items.find((id) => classes.boots.has(id)) ?? null,
    augments: [...new Set(p.augments.filter((id) => id > 0))],
  }));
}

function bump(rec: Record<string, Pair>, key: string, win: boolean) {
  const cur = rec[key] ?? [0, 0];
  cur[0] += 1;
  if (win) cur[1] += 1;
  rec[key] = cur;
}

export function applySamples(aggs: Map<string, ChampAgg>, samples: Sample[]) {
  for (const s of samples) {
    const key = aggKey(s.queue, s.patch, s.championId);
    const agg = aggs.get(key) ?? emptyAgg();
    aggs.set(key, agg);
    agg.g += 1;
    if (s.win) agg.w += 1;
    if (s.rune) bump(agg.r, s.rune, s.win);
    bump(agg.s, s.spell, s.win);
    for (const id of s.items) bump(agg.i, String(id), s.win);
    if (s.boots != null) bump(agg.b, String(s.boots), s.win);
    for (const id of s.augments) bump(agg.a, String(id), s.win);
    if (s.items.length >= 3) bump((agg.c ??= {}), s.items.slice(0, 3).join('>'), s.win);
    if (s.items[3] != null) bump((agg.n4 ??= {}), String(s.items[3]), s.win);
    if (s.items[4] != null) bump((agg.n5 ??= {}), String(s.items[4]), s.win);
    if (s.items[5] != null) bump((agg.n6 ??= {}), String(s.items[5]), s.win);
  }
}

// JSON 크기를 작게 유지하려고, 항목이 max개를 넘으면 한 판만 나온 항목을 지우고,
// 그래도 넘으면 판수 상위 max개만 남깁니다.
export function pruneAgg(agg: ChampAgg, max = 60) {
  for (const cat of AGG_CATS) {
    const rec = agg[cat];
    if (!rec || Object.keys(rec).length <= max) continue;
    for (const [k, [g]] of Object.entries(rec)) if (g <= 1) delete rec[k];
    const entries = Object.entries(rec);
    if (entries.length <= max) continue;
    entries.sort(([, [ga]], [, [gb]]) => gb - ga);
    for (const [k] of entries.slice(max)) delete rec[k];
  }
}
