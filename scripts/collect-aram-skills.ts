// 일반 칼바람(450) 경기 타임라인을 Riot API로 모아 챔피언별 스킬 순서를 쌓습니다 (아수라장은 Riot API가 막아서 대신 씀).
// 지난번에 남은 대기 유저부터 이어서, 없으면 무작위 랭크 유저에서 시작해 읽은 경기의 다른 참가자로 넓혀 갑니다.
// 이미 읽은 경기와 대기 유저는 로컬 파일로 기억합니다.
// 사용법: npm run collect:skills -- [--max=300]   (Ctrl+C로 멈추면 모은 데까지 저장)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isRecentPatch, patchOf } from '@/lib/aram/aggregate';
import { Pacer } from '@/lib/aram/pacer';
import { upstash } from '@/lib/aram/redis';
import { SKILL_PATCH_WINDOW, applySkillSamples, mergeSkillAggs, pruneSkillAgg, skillSamples, type SkillAgg } from '@/lib/aram/skills';
import { loadAggs, saveAggs } from '@/lib/aram/store';
import { getLatestDdragonVersion } from '@/lib/riot';

const KR = 'https://kr.api.riotgames.com';
const ASIA = 'https://asia.api.riotgames.com';
const SEED_TIERS = ['SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND'];
const SEED_DIVS = ['I', 'II', 'III', 'IV'];
const SEED_MIN = 300; // 대기 유저가 이보다 적으면 무작위 랭크 유저로 채움
const FLUSH_EVERY = 25;
const QUEUE_MAX = 5000;
const CACHE_DIR = join(process.cwd(), 'scripts', '.cache');
const SEEN_FILE = join(CACHE_DIR, 'skill-seen.json');
const QUEUE_FILE = join(CACHE_DIR, 'skill-queue.json');
const SEEN_MAX = 50_000;
const RECENT_DAYS = 180; // 12패치 ≈ 반년: 경기 목록부터 이 기간만 받아 오래된 경기를 열어 보는 요청을 아낌

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pacer = new Pacer();

// 요청 한도(429)면 Riot이 알려준 시간만큼 쉽니다. 키 만료(403)면 멈춥니다. Redis를 쓰지 않는 직접 호출.
async function riot<T>(url: string): Promise<T | null> {
  for (let attempt = 0; attempt < 4; attempt++) {
    let wait: number;
    while ((wait = pacer.waitMs(Date.now())) > 0) await sleep(wait);
    pacer.record(Date.now());
    let res: Response;
    try {
      res = await fetch(url, { headers: { 'X-Riot-Token': process.env.RIOT_API_KEY ?? '' }, signal: AbortSignal.timeout(10_000) });
    } catch {
      await sleep(3000);
      continue;
    }
    if (res.ok) return (await res.json()) as T;
    if (res.status === 404) return null;
    if (res.status === 403 || res.status === 401) throw new Error(`Riot API 키 오류 (${res.status})`);
    if (res.status === 429) {
      const retry = Number(res.headers.get('retry-after') ?? '10') || 10;
      const path = new URL(url).pathname.replace(/[A-Za-z0-9_-]{40,}/, '{puuid}').replace(/KR_\d+/, '{match}');
      console.log(`  요청 한도 (${res.headers.get('x-rate-limit-type') ?? '?'}, ${path}) → ${retry}초 쉼`);
      await sleep(retry * 1000);
      continue;
    }
    await sleep(3000);
  }
  return null;
}

function loadSeen(): Set<string> {
  try {
    return new Set(JSON.parse(readFileSync(SEEN_FILE, 'utf8')) as string[]);
  } catch {
    return new Set();
  }
}

function saveSeen(seen: Set<string>) {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(SEEN_FILE, JSON.stringify([...seen].slice(-SEEN_MAX)));
}

function loadQueue(): string[] {
  try {
    const v = JSON.parse(readFileSync(QUEUE_FILE, 'utf8'));
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function saveQueue(queue: string[]) {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(QUEUE_FILE, JSON.stringify(queue.slice(0, QUEUE_MAX)));
}

const pick = <T>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];

// 모은 증분을 Redis 누적값에 더합니다 (MGET 1번 + MSET 1번).
async function flush(delta: Map<string, SkillAgg>) {
  if (delta.size === 0) return;
  const keys = [...delta.keys()];
  const current = (await loadAggs(upstash, keys)) as unknown as Map<string, SkillAgg>;
  const merged = new Map<string, SkillAgg>();
  for (const k of keys) {
    const m = current.has(k) ? mergeSkillAggs(current.get(k)!, delta.get(k)!) : delta.get(k)!;
    pruneSkillAgg(m);
    merged.set(k, m);
  }
  await saveAggs(upstash, merged as never);
  delta.clear();
}

async function main() {
  const max = Number(process.argv.find((a) => a.startsWith('--max='))?.split('=')[1] ?? 300);
  const latest = patchOf(await getLatestDdragonVersion());
  const seen = loadSeen();
  const delta = new Map<string, SkillAgg>();
  const queue: string[] = [];
  const queued = new Set<string>();
  const enqueue = (p: string) => {
    if (queue.length < QUEUE_MAX && !queued.has(p)) {
      queued.add(p);
      queue.push(p);
    }
  };

  let done = 0;
  let stopping = false;
  process.on('SIGINT', () => {
    if (stopping) process.exit(1);
    stopping = true;
    console.log('\n멈추는 중… 모은 데까지 저장합니다.');
  });

  for (const p of loadQueue()) enqueue(p);
  const resumed = queue.length;
  for (let i = 0; i < 4 && queue.length < SEED_MIN; i++) {
    const page = 1 + Math.floor(Math.random() * 20);
    const entries = await riot<{ puuid?: string }[]>(`${KR}/lol/league/v4/entries/RANKED_SOLO_5x5/${pick(SEED_TIERS)}/${pick(SEED_DIVS)}?page=${page}`);
    for (const e of (entries ?? []).sort(() => Math.random() - 0.5).slice(0, 50)) if (e.puuid) enqueue(e.puuid);
  }
  console.log(`최신 패치 ${latest}, 대기 유저 ${queue.length}명 (지난번에서 이어서 ${resumed}명), 목표 ${max}판`);

  while (!stopping && done < max && queue.length > 0) {
    const puuid = queue.shift()!;
    const since = Math.floor(Date.now() / 1000) - RECENT_DAYS * 86400;
    const ids = (await riot<string[]>(`${ASIA}/lol/match/v5/matches/by-puuid/${puuid}/ids?queue=450&startTime=${since}&start=0&count=5`)) ?? [];
    for (const id of ids) {
      if (stopping || done >= max) break;
      if (seen.has(id)) continue;
      seen.add(id);
      const match = await riot<any>(`${ASIA}/lol/match/v5/matches/${id}`);
      if (!match?.info) continue;
      for (const p of match.metadata?.participants ?? []) if (p !== puuid) enqueue(p);
      const patch = patchOf(String(match.info.gameVersion ?? ''));
      if (!isRecentPatch(patch, latest, SKILL_PATCH_WINDOW)) continue;
      const timeline = await riot<any>(`${ASIA}/lol/match/v5/matches/${id}/timeline`);
      const samples = skillSamples(match, timeline);
      if (samples.length === 0) continue;
      applySkillSamples(delta, samples);
      done += 1;
      if (done % FLUSH_EVERY === 0) {
        await flush(delta);
        saveSeen(seen);
        saveQueue(queue);
        console.log(`${done}판 저장 (대기 유저 ${queue.length}명)`);
      }
    }
  }
  await flush(delta);
  saveSeen(seen);
  saveQueue(queue);
  console.log(`끝: ${done}판 (다음에 이어서 볼 유저 ${queue.length}명)`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
