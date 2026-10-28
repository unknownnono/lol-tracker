# Mayhem 수집 API 서버 구현 계획 (계획 1b)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `lol-tracker`에서 Riot API 기반 칼바람 수집을 제거하고, 데스크톱 앱이 LCU에서 읽은 Mayhem 경기를 받는 `POST /api/aram/ingest`를 추가한다. LCU 경기 상세 → 수집 형식 변환기와, 이 PC의 내 Mayhem 경기를 보내는 스크립트로 끝까지 검증한다.

**Architecture:** 이미 있는 집계(`ChampAgg` JSON, `MGET`/`MSET`), 빌드 계산, 조회 API는 유지한다. 입력만 Riot match-v5 → 앱이 보낸 `IngestGame`으로 바뀐다. 검증·중복 방지·집계는 `lib/aram/ingest.ts`, 변환은 `lib/aram/lcu.ts`(나중에 데스크톱 앱으로 복사).

**Tech Stack:** Next.js 14.2 Pages Router, TypeScript, Upstash Redis REST, Vitest, tsx, Node 24

**Spec:** `docs/superpowers/specs/2026-10-28-aram-build-assistant-design.md` (2판)

## Global Constraints

- 큐: 수집·집계 대상은 `450`, `2400`. 앱은 `2400`만 보낸다.
- `INGEST_KEY`는 서버 환경변수로만 읽고, 로그·응답·커밋에 값을 남기지 않는다. 비교는 상수 시간(`crypto.timingSafeEqual`).
- 수집 요청: 경기 1~20개, 참가자 정확히 10명, `items` 7개, `perks` 6개, `augments` 최대 6개, 본문 상한 200KB.
- 제외 규칙: 큐가 450·2400이 아님, `gameDuration < 300`, `earlySurrender === true`.
- 룬 키: `"{perkPrimaryStyle}:{p0}-{p1}-{p2}-{p3}:{perkSubStyle}:{p4}-{p5}"` (파편 없음).
- Redis 키: 집계 `aram:agg:{queue}:{patch}:{championId}`, 패치 `aram:patches`, 처리 기록 `aram:seen:game`, 잠금 `aram:lock`.
- 서버로 개인 정보(이름, puuid)를 보내거나 저장하지 않는다.
- 사용자에게 보이는 문구·주석은 한국어. 커밋 메시지 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **같은 경기를 여러 번 보내는 경우** (앱 재시작, 재전송, 같은 묶음 안 중복) — 한 번만 집계돼야 한다 (Task 3 테스트 `재전송`, `같은 묶음 안 중복`).
2. **두 앱이 동시에 보내는 경우** — 잠금을 못 잡으면 집계하지 않고 503으로 재시도를 유도해야 한다 (Task 3 `잠겨 있으면 locked`, Task 4 `잠금 실패는 503 + retryAfter`).
3. **키 없이·틀린 키로 보내는 경우** — 401, 서버 키 미설정이면 503이고 어느 쪽도 Redis를 건드리지 않아야 한다 (Task 4).
4. **형식이 일부만 틀린 묶음** — 틀린 경기만 `rejected`로 세고 나머지는 집계해야 한다 (Task 3 `일부만 틀린 묶음`).
5. **LCU 응답에 필드가 빠진 경기** (증강 없는 일반 칼바람, `gameEndedInEarlySurrender` 누락 등) — 변환기가 예외 없이 처리해야 한다 (Task 5 테스트).

## 파일 구조

| 파일 | 변경 | 책임 |
|---|---|---|
| `lib/aram/collect.ts`, `scripts/seed-aram.ts`, `test/collect.test.ts`, `test/smoke.test.ts`, `test/fixtures/makeMatch.ts`, `test/fixtures/match-450.json` | 삭제 | Riot API 수집 (폐기) |
| `lib/aram/service.ts` | 수정 | `getAramBuild`만 남김 |
| `pages/api/aram/build.ts` | 수정 | 수집 실행 제거 |
| `lib/rateLimit.ts` | 수정 | `collect` 종류 제거, `acquire(redis, n, now)` |
| `lib/riot.ts` | 수정 | `acquire` 호출 인자 변경 |
| `lib/aram/store.ts` | 수정 | 대기열 함수 제거, `aram:seen:game` |
| `lib/aram/types.ts` | 수정 | `IngestParticipant`, `IngestGame`, `IngestRequest`, `IngestResponse` 추가 |
| `lib/aram/aggregate.ts` | 수정 | `extractSamples` 등 Riot 변환 제거, `samplesFromIngest` 추가 |
| `lib/aram/ingest.ts` | 신규 | 요청 검증, 중복 방지, 잠금 안 집계 |
| `pages/api/aram/ingest.ts` | 신규 | 수집 API (인증) |
| `lib/aram/lcu.ts` | 신규 | LCU 경기 상세 → `IngestGame` 변환 (앱으로 복사될 파일) |
| `scripts/push-lcu-games.ts`, `scripts/capture-lcu-game.ts`, `scripts/lcu-util.ts` | 신규 | 내 Mayhem 경기 전송, 픽스처 저장, LCU 접속 도우미 |
| `test/fixtures/makeIngest.ts`, `test/fixtures/lcu-game-2400.json` | 신규 | 테스트 자료 |

---

### Task 1: Riot API 수집 제거

**Files:**
- Delete: `lib/aram/collect.ts`, `scripts/seed-aram.ts`, `test/collect.test.ts`
- Modify: `lib/aram/service.ts`, `pages/api/aram/build.ts`, `lib/rateLimit.ts`, `lib/riot.ts`, `lib/aram/store.ts`, `package.json`, `README.md`
- Test: `test/api-build.test.ts`, `test/rateLimit.test.ts`, `test/riot.test.ts`, `test/store.test.ts`

**Interfaces:**
- Produces:
  - `acquire(redis: RedisLike, n?: number, nowMs?: number): Promise<boolean>` (검색 전용)
  - `decide(c: { sec: number; win: number; blocked: boolean }): boolean`
  - `LIMITS = { searchPerSecond: 16, perTwoMinutes: 90 }`
  - store: `SEEN_GAME_KEY = 'aram:seen:game'`, `filterUnseenGames(r, ids)`, `markGamesSeen(r, ids)` (기존 `filterUnseenMatches`/`markMatchesSeen` 이름 변경), 대기열 함수 삭제
  - `getAramBuild(championId, queue, redis?)` (service.ts에 이것만)

- [ ] **Step 1: 테스트를 새 동작에 맞게 먼저 수정**

`test/rateLimit.test.ts` 전체 교체:
```ts
import { describe, expect, it } from 'vitest';
import { acquire, blockFor, decide, LIMITS, windowKeys } from '@/lib/rateLimit';
import { FakeRedis } from '@/test/fakeRedis';
import type { RedisLike } from '@/lib/aram/redis';

const WIN = 120_000;
const T0 = 15_000_000 * WIN; // 2분 창의 정확한 시작 시각

describe('decide', () => {
  const ok = { sec: 1, win: 1, blocked: false };
  it('한도 이내면 허용', () => expect(decide(ok)).toBe(true));
  it('차단 중이면 거부', () => expect(decide({ ...ok, blocked: true })).toBe(false));
  it('초당 한도 초과면 거부', () => expect(decide({ ...ok, sec: LIMITS.searchPerSecond + 1 })).toBe(false));
  it('2분 한도 초과면 거부', () => expect(decide({ ...ok, win: LIMITS.perTwoMinutes + 1 })).toBe(false));
});

describe('windowKeys', () => {
  it('현재 창 경과 비율과 이전 창 키', () => {
    const k = windowKeys(T0 + 30_000);
    expect(k.frac).toBe(0.25);
    expect(k.prevWin).toBe(`rl:120s:${T0 / WIN - 1}`);
  });
});

describe('acquire', () => {
  it('초당 16회까지', async () => {
    const r = new FakeRedis();
    expect(await acquire(r, 15, T0)).toBe(true);
    expect(await acquire(r, 1, T0 + 10)).toBe(true);
    expect(await acquire(r, 1, T0 + 20)).toBe(false);
  });

  it('거부되면 카운터를 되돌린다', async () => {
    const r = new FakeRedis();
    await acquire(r, 16, T0);
    await acquire(r, 5, T0 + 10);
    expect(r.strings.get(`rl:1s:${T0 / 1000}`)).toBe('16');
    expect(r.strings.get(`rl:120s:${T0 / WIN}`)).toBe('16');
  });

  it('이전 창 사용량을 남은 비율만큼 더한다 (슬라이딩 창)', async () => {
    const r = new FakeRedis();
    r.strings.set(`rl:120s:${T0 / WIN - 1}`, '90');
    expect(await acquire(r, 1, T0 + 12_000)).toBe(true); // 1 + 81 = 82
    expect(await acquire(r, 9, T0 + 13_000)).toBe(false); // 10 + 80.25 > 90
    expect(await acquire(r, 9, T0 + 60_000)).toBe(true); // 10 + 45
  });

  it('blockFor 이후에는 거부', async () => {
    const r = new FakeRedis();
    await blockFor(r, 7);
    expect(r.log.at(-1)).toEqual(['SET', 'rl:block', '1', 'EX', 7]);
    expect(await acquire(r, 1, T0)).toBe(false);
  });

  it('Redis 오류 시 허용 (Upstash 없는 로컬에서도 검색 동작)', async () => {
    const broken: RedisLike = {
      cmd: async () => { throw new Error('UPSTASH 미설정'); },
      pipe: async () => { throw new Error('UPSTASH 미설정'); },
    };
    expect(await acquire(broken, 1, T0)).toBe(true);
  });
});
```

`test/riot.test.ts`에서 두 군데를 바꾼다:
- `expect(acquire).toHaveBeenCalledWith(expect.anything(), 'search', 1);` → `expect(acquire).toHaveBeenCalledWith(expect.anything(), 1);`
- `expect(acquire).toHaveBeenCalledWith(expect.anything(), 'search', 15);` → `expect(acquire).toHaveBeenCalledWith(expect.anything(), 15);`

`test/store.test.ts`:
- import 줄을 다음으로 교체:
```ts
import {
  filterUnseenGames, latestPatches, loadAggs, markGamesSeen, patchScore, registerPatches, saveAggs, tryLock, unlock,
} from '@/lib/aram/store';
```
- `'빈 입력이면 Redis를 부르지 않는다'` 테스트 본문을 다음으로 교체:
```ts
    const r = new FakeRedis();
    await saveAggs(r, new Map());
    await loadAggs(r, []);
    await registerPatches(r, []);
    await markGamesSeen(r, []);
    expect(await filterUnseenGames(r, [])).toEqual([]);
    expect(r.log).toEqual([]);
```
- `'24시간 안에 수집한 유저는 건너뛴다'`, `'requeue는 …'`, `'대기열은 최대 길이를 넘지 않는다'` 테스트 3개를 삭제.
- `'처리한 경기 걸러내기'` 테스트를 다음으로 교체:
```ts
  it('처리한 경기 걸러내기 (aram:seen:game)', async () => {
    const r = new FakeRedis();
    await markGamesSeen(r, ['1']);
    expect(await filterUnseenGames(r, ['1', '2'])).toEqual(['2']);
    expect(r.sets.get('aram:seen:game')).toEqual(new Set(['1']));
  });
```

`test/api-build.test.ts` 전체 교체:
```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/aram/service', () => ({ getAramBuild: vi.fn() }));

import { getAramBuild } from '@/lib/aram/service';
import handler from '@/pages/api/aram/build';

function call(query: Record<string, string>, method = 'GET') {
  const res: any = {
    statusCode: 0,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    status(code: number) { this.statusCode = code; return this; },
    json(body: unknown) { this.body = body; return this; },
    setHeader(k: string, v: string) { this.headers[k] = v; },
  };
  return handler({ method, query } as any, res).then(() => res);
}

describe('GET /api/aram/build', () => {
  beforeEach(() => vi.mocked(getAramBuild).mockReset());

  it.each([
    [{ champion: 'abc', queue: '450' }],
    [{ champion: '0', queue: '450' }],
    [{ champion: '1', queue: '420' }],
    [{ queue: '450' }],
    [{ champion: '1', queue: '450', x: 'cache-buster' }],
  ])('잘못된 파라미터 %o 는 400이고 Redis를 건드리지 않는다', async (q) => {
    const res = await call(q as Record<string, string>);
    expect(res.statusCode).toBe(400);
    expect(getAramBuild).not.toHaveBeenCalled();
  });

  it('GET이 아니면 405', async () => {
    expect((await call({ champion: '1', queue: '450' }, 'POST')).statusCode).toBe(405);
  });

  it('성공하면 200 + 캐시 헤더', async () => {
    vi.mocked(getAramBuild).mockResolvedValue({ championId: 1 } as any);
    const res = await call({ champion: '1', queue: '2400' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ championId: 1 });
    expect(res.headers['Cache-Control']).toBe('s-maxage=300, stale-while-revalidate=600');
    expect(getAramBuild).toHaveBeenCalledWith(1, 2400);
  });

  it('Redis 오류면 503', async () => {
    vi.mocked(getAramBuild).mockRejectedValue(new Error('Upstash 명령 실패 (500)'));
    expect((await call({ champion: '1', queue: '450' })).statusCode).toBe(503);
  });
});
```

`test/collect.test.ts` 삭제: `git rm test/collect.test.ts`

- [ ] **Step 2: 실패 확인**

Run: `npm test`
Expected: FAIL — rateLimit(`decide`/`acquire` 인자), riot(`acquire` 인자), store(`filterUnseenGames` 없음)

- [ ] **Step 3: `lib/rateLimit.ts` 전체 교체**

```ts
// Riot API 전역 호출 한도기 (전적 검색용). 여러 Vercel 인스턴스가 Upstash 카운터를 공유합니다.
// 개인용 키 한도는 1초 20회, 2분 100회입니다.
// - 2분 한도: 슬라이딩 창 근사(현재 창 + 직전 창 × 남은 비율)로 90회. 창 경계에 몰리는 폭주를 막습니다.
// - 초당 한도: 16회.
import type { Cmd, RedisLike } from '@/lib/aram/redis';

export const LIMITS = { searchPerSecond: 16, perTwoMinutes: 90 } as const;
export const BLOCK_KEY = 'rl:block';

const WINDOW_MS = 120_000;
const WINDOW_TTL_SEC = 250; // 다음 창에서 직전 창 값을 읽을 수 있도록 두 창 이상 보관

export function windowKeys(nowMs: number) {
  const sec = Math.floor(nowMs / 1000);
  const win = Math.floor(nowMs / WINDOW_MS);
  return {
    sec: `rl:1s:${sec}`,
    win: `rl:120s:${win}`,
    prevWin: `rl:120s:${win - 1}`,
    frac: (nowMs % WINDOW_MS) / WINDOW_MS,
  };
}

export function decide(c: { sec: number; win: number; blocked: boolean }): boolean {
  if (c.blocked) return false;
  if (c.sec > LIMITS.searchPerSecond) return false;
  if (c.win > LIMITS.perTwoMinutes) return false;
  return true;
}

// n회 호출할 권한을 한 번에 예약합니다. 거부되면 올린 카운터를 되돌립니다.
export async function acquire(redis: RedisLike, n = 1, nowMs = Date.now()): Promise<boolean> {
  const k = windowKeys(nowMs);
  const cmds: Cmd[] = [
    ['INCRBY', k.sec, n],
    ['EXPIRE', k.sec, 2],
    ['INCRBY', k.win, n],
    ['EXPIRE', k.win, WINDOW_TTL_SEC],
    ['GET', k.prevWin],
    ['GET', BLOCK_KEY],
  ];

  let out: unknown[];
  try {
    out = await redis.pipe(cmds);
  } catch (err) {
    // Upstash가 없거나 장애일 때는 전적 검색이 예전처럼 동작하도록 허용합니다.
    console.warn('[rateLimit] Redis를 쓸 수 없어 한도 확인을 건너뜁니다.', err);
    return true;
  }

  const counts = {
    sec: Number(out[0]),
    win: Number(out[2]) + Number(out[4] ?? 0) * (1 - k.frac),
    blocked: out[5] != null,
  };
  if (decide(counts)) return true;

  await redis.pipe([['DECRBY', k.sec, n], ['DECRBY', k.win, n]]).catch(() => {});
  return false;
}

// Riot이 429를 돌려줬을 때 Retry-After 동안 모든 호출을 막습니다.
export async function blockFor(redis: RedisLike, seconds: number): Promise<void> {
  const s = Math.max(1, Math.ceil(seconds));
  await redis.cmd(['SET', BLOCK_KEY, '1', 'EX', s]);
}
```

- [ ] **Step 4: `lib/riot.ts` 두 줄 수정**

- `if (metered && !(await acquire(upstash, 'search', 1))) {` → `if (metered && !(await acquire(upstash, 1))) {`
- `if (!(await acquire(upstash, 'search', PROFILE_CALLS))) {` → `if (!(await acquire(upstash, PROFILE_CALLS))) {`

- [ ] **Step 5: `lib/aram/store.ts` 수정**

다음을 삭제: `QUEUE_KEY`, `QUEUE_MAX`, `CRAWLED_TTL_SEC`, `crawledKey`, `nextPuuid`, `requeue`, `enqueuePuuids`.
`SEEN_MATCH_KEY` 선언과 두 함수를 다음으로 교체:
```ts
export const SEEN_GAME_KEY = 'aram:seen:game';
```
```ts
export async function filterUnseenGames(r: RedisLike, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const flags = await r.cmd<number[]>(['SMISMEMBER', SEEN_GAME_KEY, ...ids]);
  return ids.filter((_, i) => !flags[i]);
}

export async function markGamesSeen(r: RedisLike, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await r.cmd(['SADD', SEEN_GAME_KEY, ...ids]);
}
```
파일 첫 줄 주석은 그대로 둔다.

- [ ] **Step 6: 수집 코드 삭제와 서비스·빌드 API 정리**

```bash
git rm lib/aram/collect.ts scripts/seed-aram.ts
npm uninstall @vercel/functions
```

`lib/aram/service.ts` 전체 교체:
```ts
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
```

`pages/api/aram/build.ts` 전체 교체:
```ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { getAramBuild } from '@/lib/aram/service';
import type { Queue } from '@/lib/aram/aggregate';

const QUEUES: readonly Queue[] = [450, 2400];
const ALLOWED_PARAMS = new Set(['champion', 'queue']);
const MAX_CHAMPION_ID = 10_000;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: '허용되지 않는 메서드입니다.' });
  }

  const championId = Number(req.query.champion);
  const queue = Number(req.query.queue) as Queue;
  const unknownParam = Object.keys(req.query).some((k) => !ALLOWED_PARAMS.has(k));
  if (unknownParam || !Number.isInteger(championId) || championId <= 0 || championId > MAX_CHAMPION_ID || !QUEUES.includes(queue)) {
    return res.status(400).json({ error: '잘못된 요청입니다. champion(챔피언 ID)과 queue(450 또는 2400)를 확인하세요.' });
  }

  try {
    const build = await getAramBuild(championId, queue);
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json(build);
  } catch (err) {
    console.error(err);
    return res.status(503).json({ error: '통계 저장소에 연결할 수 없습니다. 잠시 후 다시 시도하세요.' });
  }
}
```

`package.json`의 `"seed:aram"` 스크립트 줄을 삭제한다.

`README.md`의 "## 칼바람 통계 (데스크톱 앱용)" 절 전체(다음 `## 4.` 제목 전까지)를 다음으로 교체하고, "## 3. 프로젝트 구조"의 `scripts/seed-aram.ts` 줄을 삭제하고 `lib/aram/` 줄 설명을 `# Mayhem 통계: 수집 API(ingest) · 집계(aggregate) · 계산(build) · 저장(store)`로 바꾼다:
````markdown
## Mayhem 통계 (데스크톱 앱용)

- 데이터: 데스크톱 앱이 롤 클라이언트(LCU)에서 읽은 Mayhem 경기를 `POST /api/aram/ingest`로 보냅니다 (Riot 공개 API로는 Mayhem 경기를 받을 수 없음).
- 조회: `GET /api/aram/build?champion=103&queue=2400` → 룬·스펠·코어 아이템·신발·증강 추천 (5분 CDN 캐시)
- 이 PC 클라이언트의 내 Mayhem 경기 보내기 (롤 클라이언트 실행 중이어야 함):

```bash
npm run push:lcu -- --api=http://localhost:3000
```

- 테스트: `npm test`
````

- [ ] **Step 7: 통과 확인**

Run: `npm test && npx tsc --noEmit`
Expected: 모든 테스트 PASS, 타입 오류 없음. `grep -rn "collect\|seed-aram\|@vercel/functions\|enqueuePuuids" lib pages scripts test package.json` 결과 없음 (`lib/rateLimit.ts` 주석 포함).

- [ ] **Step 8: Commit**

```bash
git add -A lib pages scripts test package.json package-lock.json README.md
git commit -m "refactor: Riot API 칼바람 수집 제거 (Mayhem은 LCU 수집으로 대체)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: 수집 형식 타입과 표본 변환

**Files:**
- Modify: `lib/aram/types.ts`, `lib/aram/aggregate.ts`
- Create: `test/fixtures/makeIngest.ts`
- Delete: `test/fixtures/makeMatch.ts`, `test/fixtures/match-450.json`, `test/smoke.test.ts`
- Test: `test/aggregate.test.ts` (전체 교체)

**Interfaces:**
- Consumes: `ItemClasses` (`lib/aram/items.ts`)
- Produces:
  - 타입 `IngestParticipant`, `IngestGame`, `IngestRequest`, `IngestResponse` (스펙 4.3 그대로)
  - `runeKeyOf(primary: number, perks: number[], sub: number): string | null`
  - `isEligible(game: IngestGame): boolean` (큐·시간·조기 종료)
  - `samplesFromIngest(game: IngestGame, classes: ItemClasses): Sample[]`
  - 유지: `Queue`, `Pair`, `ChampAgg`, `AGG_CATS`, `Sample`, `emptyAgg`, `aggKey`, `patchOf`, `spellKey`, `applySamples`, `pruneAgg`
  - 삭제: `ARAM_QUEUES`, `runeKey`, `augmentsOf`, `extractSamples`
  - 테스트 도우미: `makeIngestParticipant(over?)`, `makeIngestGame(over?)`, `CLASSES`, `RABADON`, `SORC_SHOES`, `DEFAULT_RUNE_KEY`

- [ ] **Step 1: `lib/aram/types.ts` 끝에 추가**

```ts
// POST /api/aram/ingest 요청·응답. 데스크톱 앱이 LCU 경기 상세를 이 형식으로 바꿔 보냅니다.
export interface IngestParticipant {
  championId: number;
  win: boolean;
  spell1Id: number;
  spell2Id: number;
  items: number[]; // item0~6, 정확히 7개 (빈 칸 0)
  perks: number[]; // perk0~5, 정확히 6개 (핵심 4 + 보조 2)
  perkPrimaryStyle: number;
  perkSubStyle: number;
  augments: number[]; // playerAugment1~6 중 0이 아닌 값, 최대 6개
}

export interface IngestGame {
  gameId: number;
  queueId: 450 | 2400;
  gameVersion: string; // 예: "16.21.123.4567"
  gameDuration: number; // 초
  earlySurrender: boolean;
  participants: IngestParticipant[]; // 정확히 10명
}

export interface IngestRequest {
  games: IngestGame[]; // 1~20개
}

export interface IngestResponse {
  accepted: number;
  duplicates: number;
  rejected: number;
}
```

- [ ] **Step 2: 테스트 도우미 `test/fixtures/makeIngest.ts` 작성**

```ts
// 테스트용 수집 요청 데이터 (LCU에서 읽어 앱이 변환한 형식)
import type { IngestGame, IngestParticipant } from '@/lib/aram/types';

export const RABADON = 3089; // 완성 아이템
export const SORC_SHOES = 3020; // 신발
export const CLASSES = { completed: new Set([RABADON]), boots: new Set([SORC_SHOES]) };
export const DEFAULT_RUNE_KEY = '8200:8229-8226-8210-8237:8300:8345-8347';

export function makeIngestParticipant(over: Partial<IngestParticipant> = {}): IngestParticipant {
  return {
    championId: 1,
    win: true,
    spell1Id: 32,
    spell2Id: 4,
    items: [RABADON, SORC_SHOES, 0, 0, 0, 0, 3340],
    perks: [8229, 8226, 8210, 8237, 8345, 8347],
    perkPrimaryStyle: 8200,
    perkSubStyle: 8300,
    augments: [1336, 1134, 3085, 1238],
    ...over,
  };
}

export function makeIngestGame(over: Partial<IngestGame> = {}): IngestGame {
  return {
    gameId: 1000000001,
    queueId: 2400,
    gameVersion: '16.21.123.4567',
    gameDuration: 1100,
    earlySurrender: false,
    participants: Array.from({ length: 10 }, (_, i) => makeIngestParticipant({ championId: i + 1, win: i < 5 })),
    ...over,
  };
}
```

- [ ] **Step 3: `test/aggregate.test.ts` 전체 교체 (실패하는 테스트)**

```ts
import { describe, expect, it } from 'vitest';
import {
  aggKey, applySamples, emptyAgg, isEligible, patchOf, pruneAgg, runeKeyOf, samplesFromIngest, spellKey, type ChampAgg,
} from '@/lib/aram/aggregate';
import {
  CLASSES, DEFAULT_RUNE_KEY, RABADON, SORC_SHOES, makeIngestGame, makeIngestParticipant,
} from '@/test/fixtures/makeIngest';

describe('키 규칙', () => {
  it('패치는 앞 두 자리', () => expect(patchOf('16.21.123.4567')).toBe('16.21'));
  it('스펠은 순서 무관', () => expect(spellKey(32, 4)).toBe('4-32'));
  it('집계 키', () => expect(aggKey(2400, '16.21', 99)).toBe('aram:agg:2400:16.21:99'));
  it('룬 키 (파편 없음)', () => expect(runeKeyOf(8200, [8229, 8226, 8210, 8237, 8345, 8347], 8300)).toBe(DEFAULT_RUNE_KEY));
  it('룬이 6개가 아니면 null', () => expect(runeKeyOf(8200, [8229], 8300)).toBeNull());
});

describe('isEligible', () => {
  it('정상 Mayhem 경기', () => expect(isEligible(makeIngestGame())).toBe(true));
  it('다른 큐는 제외', () => expect(isEligible(makeIngestGame({ queueId: 420 as any }))).toBe(false));
  it('5분 미만은 제외', () => expect(isEligible(makeIngestGame({ gameDuration: 299 }))).toBe(false));
  it('조기 항복은 제외', () => expect(isEligible(makeIngestGame({ earlySurrender: true }))).toBe(false));
});

describe('samplesFromIngest', () => {
  it('10명분 표본', () => {
    const s = samplesFromIngest(makeIngestGame(), CLASSES);
    expect(s).toHaveLength(10);
    expect(s[0]).toEqual({
      queue: 2400, patch: '16.21', championId: 1, win: true, rune: DEFAULT_RUNE_KEY,
      spell: '4-32', items: [RABADON], boots: SORC_SHOES, augments: [1336, 1134, 3085, 1238],
    });
  });

  it('제외 대상 경기는 빈 배열', () => expect(samplesFromIngest(makeIngestGame({ gameDuration: 10 }), CLASSES)).toEqual([]));

  it('같은 완성 아이템이 두 칸에 있으면 한 번만, 신발 없으면 null', () => {
    const p = makeIngestParticipant({ items: [RABADON, RABADON, 0, 0, 0, 0, 0] });
    const s = samplesFromIngest(makeIngestGame({ participants: Array(10).fill(p) }), CLASSES)[0];
    expect(s.items).toEqual([RABADON]);
    expect(s.boots).toBeNull();
  });

  it('증강 0은 버린다', () => {
    const p = makeIngestParticipant({ augments: [7, 0, 9] });
    expect(samplesFromIngest(makeIngestGame({ participants: Array(10).fill(p) }), CLASSES)[0].augments).toEqual([7, 9]);
  });
});

describe('applySamples / pruneAgg', () => {
  it('챔피언별로 판수·승수와 항목을 누적', () => {
    const aggs = new Map<string, ChampAgg>();
    const samples = samplesFromIngest(makeIngestGame(), CLASSES);
    applySamples(aggs, samples);
    applySamples(aggs, samples);
    const a = aggs.get(aggKey(2400, '16.21', 1))!;
    expect(a.g).toBe(2);
    expect(a.w).toBe(2);
    expect(a.r[DEFAULT_RUNE_KEY]).toEqual([2, 2]);
    expect(a.s['4-32']).toEqual([2, 2]);
    expect(a.i[String(RABADON)]).toEqual([2, 2]);
    expect(a.b[String(SORC_SHOES)]).toEqual([2, 2]);
    expect(a.a['1336']).toEqual([2, 2]);
    expect(aggs.get(aggKey(2400, '16.21', 6))!.w).toBe(0); // 6번 챔피언은 패배 팀
  });

  it('항목이 max를 넘으면 판수 1 이하를 지운다', () => {
    const a = emptyAgg();
    for (let i = 0; i < 5; i++) a.r[`k${i}`] = [1, 0];
    a.r.keep = [3, 1];
    pruneAgg(a, 4);
    expect(Object.keys(a.r)).toEqual(['keep']);
  });
});
```

- [ ] **Step 4: 실패 확인**

Run: `npx vitest run test/aggregate.test.ts`
Expected: FAIL — `runeKeyOf`/`isEligible`/`samplesFromIngest`가 export되지 않음

- [ ] **Step 5: `lib/aram/aggregate.ts` 수정**

(a) import에 타입 추가:
```ts
import type { IngestGame } from './types';
```
(b) 삭제: `ARAM_QUEUES`, `AUGMENT_FIELD`, `ITEM_SLOTS`, `runeKey`, `augmentsOf`, `extractSamples`.
(c) `spellKey` 아래에 추가:
```ts
// LCU 경기 상세에는 룬 파편 정보가 없어서 파편을 뺀 키를 씁니다.
export function runeKeyOf(primary: number, perks: number[], sub: number): string | null {
  if (perks.length !== 6) return null;
  return `${primary}:${perks.slice(0, 4).join('-')}:${sub}:${perks.slice(4).join('-')}`;
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
    augments: p.augments.filter((id) => id > 0),
  }));
}
```
(d) 파일 첫 줄 주석을 `// 수집된 경기 → 챔피언별 표본 → 누적값. Redis와 분리된 순수 함수만 둡니다.`로 바꾼다.

- [ ] **Step 6: 옛 픽스처 삭제와 전체 확인**

```bash
git rm test/fixtures/makeMatch.ts test/fixtures/match-450.json test/smoke.test.ts
```
Run: `npm test && npx tsc --noEmit`
Expected: PASS, 타입 오류 없음. `grep -rn "makeMatch\|extractSamples\|ARAM_QUEUES" lib pages test scripts` 결과 없음.

- [ ] **Step 7: Commit**

```bash
git add -A lib test
git commit -m "feat: 수집 요청 타입과 LCU 기반 표본 변환 (룬 파편 제외 키)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: 수집 요청 검증과 잠금 안 집계

**Files:**
- Create: `lib/aram/ingest.ts`
- Test: `test/ingest.test.ts`

**Interfaces:**
- Consumes: Task 2 (`IngestGame`, `IngestResponse`, `isEligible`, `samplesFromIngest`, `aggKey`, `applySamples`, `pruneAgg`, `patchOf`), Task 1 store (`filterUnseenGames`, `markGamesSeen`, `loadAggs`, `saveAggs`, `registerPatches`, `tryLock`, `unlock`), `ItemClasses`, `RedisLike`
- Produces:
  - `MAX_GAMES = 20`
  - `isValidGame(g: unknown): g is IngestGame`
  - `parseIngestRequest(body: unknown): { games: unknown[] } | null`
  - `ingestGames(redis: RedisLike, games: unknown[], classes: ItemClasses): Promise<IngestResponse | 'locked'>`

- [ ] **Step 1: 실패하는 테스트 `test/ingest.test.ts` 작성**

```ts
import { describe, expect, it } from 'vitest';
import { aggKey } from '@/lib/aram/aggregate';
import { MAX_GAMES, ingestGames, isValidGame, parseIngestRequest } from '@/lib/aram/ingest';
import { LOCK_KEY, loadAggs, latestPatches } from '@/lib/aram/store';
import { FakeRedis } from '@/test/fakeRedis';
import { CLASSES, makeIngestGame, makeIngestParticipant } from '@/test/fixtures/makeIngest';

describe('isValidGame', () => {
  it('정상 경기', () => expect(isValidGame(makeIngestGame())).toBe(true));
  it.each([
    ['gameId 없음', { ...makeIngestGame(), gameId: undefined }],
    ['gameId 소수', { ...makeIngestGame(), gameId: 1.5 }],
    ['gameVersion 형식', { ...makeIngestGame(), gameVersion: 'abc' }],
    ['참가자 9명', makeIngestGame({ participants: makeIngestGame().participants.slice(0, 9) })],
    ['아이템 6칸', makeIngestGame({ participants: Array(10).fill(makeIngestParticipant({ items: [1, 2, 3, 4, 5, 6] })) })],
    ['룬 5개', makeIngestGame({ participants: Array(10).fill(makeIngestParticipant({ perks: [1, 2, 3, 4, 5] })) })],
    ['증강 7개', makeIngestGame({ participants: Array(10).fill(makeIngestParticipant({ augments: [1, 2, 3, 4, 5, 6, 7] })) })],
    ['win 문자열', makeIngestGame({ participants: Array(10).fill({ ...makeIngestParticipant(), win: 'true' }) })],
    ['음수 아이템', makeIngestGame({ participants: Array(10).fill(makeIngestParticipant({ items: [-1, 0, 0, 0, 0, 0, 0] })) })],
    ['null', null],
  ])('%s → 거부', (_, g) => expect(isValidGame(g)).toBe(false));
});

describe('parseIngestRequest', () => {
  it('정상', () => expect(parseIngestRequest({ games: [1] })).toEqual({ games: [1] }));
  it.each([
    ['객체 아님', 'x'],
    ['games 없음', {}],
    ['games 비어 있음', { games: [] }],
    [`${MAX_GAMES + 1}개`, { games: Array(MAX_GAMES + 1).fill(1) }],
  ])('%s → null', (_, body) => expect(parseIngestRequest(body)).toBeNull());
});

describe('ingestGames', () => {
  it('새 경기를 집계하고 패치·처리 기록을 남긴다', async () => {
    const r = new FakeRedis();
    expect(await ingestGames(r, [makeIngestGame()], CLASSES)).toEqual({ accepted: 1, duplicates: 0, rejected: 0 });
    const aggs = await loadAggs(r, [aggKey(2400, '16.21', 1)]);
    expect(aggs.get(aggKey(2400, '16.21', 1))!.g).toBe(1);
    expect(await latestPatches(r, 1)).toEqual(['16.21']);
    expect(r.sets.get('aram:seen:game')).toEqual(new Set(['1000000001']));
    expect(r.strings.has(LOCK_KEY)).toBe(false);
  });

  it('재전송은 duplicates로 세고 다시 집계하지 않는다', async () => {
    const r = new FakeRedis();
    await ingestGames(r, [makeIngestGame()], CLASSES);
    expect(await ingestGames(r, [makeIngestGame()], CLASSES)).toEqual({ accepted: 0, duplicates: 1, rejected: 0 });
    expect((await loadAggs(r, [aggKey(2400, '16.21', 1)])).get(aggKey(2400, '16.21', 1))!.g).toBe(1);
  });

  it('같은 묶음 안 중복도 한 번만', async () => {
    const r = new FakeRedis();
    expect(await ingestGames(r, [makeIngestGame(), makeIngestGame()], CLASSES)).toEqual({ accepted: 1, duplicates: 1, rejected: 0 });
    expect((await loadAggs(r, [aggKey(2400, '16.21', 1)])).get(aggKey(2400, '16.21', 1))!.g).toBe(1);
  });

  it('일부만 틀린 묶음: 틀린 것과 제외 대상은 rejected, 나머지는 집계', async () => {
    const r = new FakeRedis();
    const games = [makeIngestGame(), { bad: true }, makeIngestGame({ gameId: 2, earlySurrender: true })];
    expect(await ingestGames(r, games, CLASSES)).toEqual({ accepted: 1, duplicates: 0, rejected: 2 });
  });

  it('집계할 경기가 없으면 잠금도 잡지 않는다', async () => {
    const r = new FakeRedis();
    expect(await ingestGames(r, [{ bad: true }], CLASSES)).toEqual({ accepted: 0, duplicates: 0, rejected: 1 });
    expect(r.log).toEqual([]);
  });

  it('잠겨 있으면 locked, 집계하지 않는다', async () => {
    const r = new FakeRedis();
    await r.cmd(['SET', LOCK_KEY, 'other']);
    expect(await ingestGames(r, [makeIngestGame()], CLASSES)).toBe('locked');
    expect(r.sets.get('aram:seen:game')).toBeUndefined();
  });

  it('도중에 Redis가 실패해도 잠금을 풀고 예외를 던진다', async () => {
    class Broken extends FakeRedis {
      async cmd<T = unknown>(args: (string | number)[]): Promise<T> {
        if (args[0] === 'MSET') throw new Error('Upstash 명령 실패 (500)');
        return super.cmd<T>(args);
      }
    }
    const r = new Broken();
    await expect(ingestGames(r, [makeIngestGame()], CLASSES)).rejects.toThrow('Upstash');
    expect(r.strings.has(LOCK_KEY)).toBe(false);
    expect(r.sets.get('aram:seen:game')).toBeUndefined();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run test/ingest.test.ts`
Expected: FAIL — `@/lib/aram/ingest` 없음

- [ ] **Step 3: `lib/aram/ingest.ts` 작성**

```ts
// POST /api/aram/ingest 처리: 형식 검증 → 중복 제거 → 잠금 안에서 집계.
import { aggKey, applySamples, isEligible, patchOf, pruneAgg, samplesFromIngest } from './aggregate';
import type { ItemClasses } from './items';
import type { RedisLike } from './redis';
import {
  filterUnseenGames, loadAggs, markGamesSeen, registerPatches, saveAggs, tryLock, unlock,
} from './store';
import type { IngestGame, IngestResponse } from './types';

export const MAX_GAMES = 20;
const MAX_ID = 1_000_000_000_000; // 숫자 ID 상한 (비정상 값 차단)

const isInt = (v: unknown, min = 0): v is number => Number.isInteger(v) && (v as number) >= min && (v as number) < MAX_ID;
const isIntArray = (v: unknown, len: number | [number, number]): v is number[] => {
  if (!Array.isArray(v)) return false;
  const ok = Array.isArray(len) ? v.length >= len[0] && v.length <= len[1] : v.length === len;
  return ok && v.every((x) => isInt(x));
};

function isValidParticipant(p: any): boolean {
  return (
    p != null &&
    isInt(p.championId, 1) &&
    typeof p.win === 'boolean' &&
    isInt(p.spell1Id) &&
    isInt(p.spell2Id) &&
    isIntArray(p.items, 7) &&
    isIntArray(p.perks, 6) &&
    isInt(p.perkPrimaryStyle) &&
    isInt(p.perkSubStyle) &&
    isIntArray(p.augments, [0, 6])
  );
}

export function isValidGame(g: unknown): g is IngestGame {
  const x = g as any;
  return (
    x != null &&
    isInt(x.gameId, 1) &&
    isInt(x.queueId) &&
    typeof x.gameVersion === 'string' &&
    /^\d+\.\d+/.test(x.gameVersion) &&
    isInt(x.gameDuration) &&
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

export async function ingestGames(
  redis: RedisLike,
  games: unknown[],
  classes: ItemClasses,
): Promise<IngestResponse | 'locked'> {
  const usable: IngestGame[] = [];
  let rejected = 0;
  let duplicates = 0;
  const inBatch = new Set<number>();
  for (const g of games) {
    if (!isValidGame(g) || !isEligible(g)) {
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
      await saveAggs(redis, aggs);
      await registerPatches(redis, [...new Set(fresh.map((g) => patchOf(g.gameVersion)))]);
      // 누적값을 저장한 뒤에 기록합니다 (저장 전에 실패하면 앱이 다시 보낼 수 있도록).
      await markGamesSeen(redis, fresh.map((g) => String(g.gameId)));
    }
    return { accepted: fresh.length, duplicates, rejected };
  } finally {
    await unlock(redis, token).catch(() => {});
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run test/ingest.test.ts && npx tsc --noEmit`
Expected: PASS, 타입 오류 없음

- [ ] **Step 5: Commit**

```bash
git add lib/aram/ingest.ts test/ingest.test.ts
git commit -m "feat: Mayhem 경기 수집 요청 검증과 중복 방지 집계

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `POST /api/aram/ingest`

**Files:**
- Create: `pages/api/aram/ingest.ts`
- Modify: `.env.local.example`
- Test: `test/api-ingest.test.ts`

**Interfaces:**
- Consumes: Task 3 (`parseIngestRequest`, `ingestGames`), `getItemClasses` (`lib/aram/items.ts`), `getLatestDdragonVersion` (`lib/riot.ts`), `upstash`
- Produces: HTTP `POST /api/aram/ingest` — 헤더 `X-Ingest-Key`, 본문 `IngestRequest` → 200 `IngestResponse` / 400 / 401 / 405 / 503 `{ error, retryAfter? }`

- [ ] **Step 1: 실패하는 테스트 `test/api-ingest.test.ts` 작성**

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/aram/ingest', async (orig) => ({
  ...(await orig<typeof import('@/lib/aram/ingest')>()),
  ingestGames: vi.fn(),
}));
vi.mock('@/lib/aram/items', () => ({ getItemClasses: vi.fn(async () => ({ completed: new Set(), boots: new Set() })) }));
vi.mock('@/lib/riot', () => ({ getLatestDdragonVersion: vi.fn(async () => '16.21.1') }));

import { ingestGames } from '@/lib/aram/ingest';
import handler, { config } from '@/pages/api/aram/ingest';

const KEY = 'test-ingest-key-1234567890';

function call(opts: { method?: string; key?: string; body?: unknown }) {
  const res: any = {
    statusCode: 0,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    status(code: number) { this.statusCode = code; return this; },
    json(body: unknown) { this.body = body; return this; },
    setHeader(k: string, v: string) { this.headers[k] = v; },
  };
  const headers: Record<string, string> = {};
  if (opts.key !== undefined) headers['x-ingest-key'] = opts.key;
  return handler({ method: opts.method ?? 'POST', headers, body: opts.body ?? { games: [{}] } } as any, res).then(() => res);
}

describe('POST /api/aram/ingest', () => {
  beforeEach(() => {
    vi.stubEnv('INGEST_KEY', KEY);
    vi.mocked(ingestGames).mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  it('본문 크기 상한 200kb', () => expect(config.api.bodyParser.sizeLimit).toBe('200kb'));

  it('POST가 아니면 405', async () => expect((await call({ method: 'GET', key: KEY })).statusCode).toBe(405));

  it('서버에 키가 없으면 503, 집계하지 않는다', async () => {
    vi.stubEnv('INGEST_KEY', '');
    expect((await call({ key: KEY })).statusCode).toBe(503);
    expect(ingestGames).not.toHaveBeenCalled();
  });

  it.each([['키 없음', undefined], ['틀린 키', 'wrong'], ['길이 같은 틀린 키', 'x'.repeat(KEY.length)]])(
    '%s → 401, 집계하지 않는다',
    async (_, key) => {
      expect((await call({ key })).statusCode).toBe(401);
      expect(ingestGames).not.toHaveBeenCalled();
    },
  );

  it('본문 형식이 틀리면 400', async () => {
    expect((await call({ key: KEY, body: { games: [] } })).statusCode).toBe(400);
    expect(ingestGames).not.toHaveBeenCalled();
  });

  it('성공하면 200 + 결과 + no-store', async () => {
    vi.mocked(ingestGames).mockResolvedValue({ accepted: 1, duplicates: 0, rejected: 0 });
    const res = await call({ key: KEY });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ accepted: 1, duplicates: 0, rejected: 0 });
    expect(res.headers['Cache-Control']).toBe('no-store');
  });

  it('잠금 실패는 503 + retryAfter', async () => {
    vi.mocked(ingestGames).mockResolvedValue('locked');
    const res = await call({ key: KEY });
    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({ retryAfter: 5 });
  });

  it('저장소 오류는 503', async () => {
    vi.mocked(ingestGames).mockRejectedValue(new Error('Upstash 명령 실패 (500)'));
    expect((await call({ key: KEY })).statusCode).toBe(503);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run test/api-ingest.test.ts`
Expected: FAIL — `@/pages/api/aram/ingest` 없음

- [ ] **Step 3: `pages/api/aram/ingest.ts` 작성**

```ts
import { timingSafeEqual } from 'node:crypto';
import type { NextApiRequest, NextApiResponse } from 'next';
import { ingestGames, parseIngestRequest } from '@/lib/aram/ingest';
import { getItemClasses } from '@/lib/aram/items';
import { upstash } from '@/lib/aram/redis';
import { getLatestDdragonVersion } from '@/lib/riot';

export const config = { api: { bodyParser: { sizeLimit: '200kb' } } };

function keyMatches(given: unknown, expected: string): boolean {
  if (typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: '허용되지 않는 메서드입니다.' });
  }

  const serverKey = process.env.INGEST_KEY;
  if (!serverKey) {
    return res.status(503).json({ error: '수집 기능이 설정되지 않았습니다.' });
  }
  if (!keyMatches(req.headers['x-ingest-key'], serverKey)) {
    return res.status(401).json({ error: '인증에 실패했습니다.' });
  }

  const parsed = parseIngestRequest(req.body);
  if (!parsed) {
    return res.status(400).json({ error: '잘못된 요청입니다. games는 1~20개의 경기 배열이어야 합니다.' });
  }

  try {
    const classes = await getItemClasses(await getLatestDdragonVersion());
    const result = await ingestGames(upstash, parsed.games, classes);
    if (result === 'locked') {
      return res.status(503).json({ error: '다른 요청을 처리 중입니다. 잠시 후 다시 보내세요.', retryAfter: 5 });
    }
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(result);
  } catch (err) {
    console.error('[ingest]', err);
    return res.status(503).json({ error: '통계 저장소에 연결할 수 없습니다. 잠시 후 다시 보내세요.' });
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm test && npx tsc --noEmit`
Expected: PASS, 타입 오류 없음

- [ ] **Step 5: `.env.local.example` 끝에 추가**

```

# 데스크톱 앱이 Mayhem 경기를 보낼 때 쓰는 공유 비밀키 (아무 긴 무작위 문자열). Vercel 환경변수와 같은 값이어야 합니다.
INGEST_KEY=
```

- [ ] **Step 6: Commit**

```bash
git add pages/api/aram/ingest.ts test/api-ingest.test.ts .env.local.example
git commit -m "feat: Mayhem 경기 수집 API (POST /api/aram/ingest)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: LCU 경기 변환기와 내 경기 전송 스크립트, 끝까지 확인

**Files:**
- Create: `lib/aram/lcu.ts`
- Create: `test/fixtures/lcu-game-2400.json` (실제 LCU 응답을 가명 처리해 저장)
- Create: `scripts/capture-lcu-game.ts` (픽스처 저장용)
- Create: `scripts/lcu-util.ts` (스크립트용 LCU 접속 도우미)
- Create: `scripts/push-lcu-games.ts`
- Modify: `package.json` (`push:lcu` 스크립트)
- Test: `test/lcu.test.ts`

**Interfaces:**
- Consumes: `IngestGame`, `IngestParticipant` (Task 2)
- Produces:
  - `lcuGameToIngest(game: any): IngestGame | null` — 큐가 450·2400이 아니거나 필수 필드가 없으면 null
  - `parseLcuCredentials(commandLine: string): { port: number; token: string } | null`
  - (데스크톱 앱 계획 2/2에서 이 파일을 그대로 복사해 쓴다)

- [ ] **Step 1: 픽스처 저장 스크립트 `scripts/capture-lcu-game.ts` 작성**

```ts
// 테스트 픽스처 저장: 실행 중인 롤 클라이언트(LCU)에서 내 최근 Mayhem 경기 상세 1개를 읽어
// 개인 정보(이름·puuid·계정 ID)를 가명 처리한 뒤 test/fixtures/lcu-game-2400.json에 저장합니다. 읽기 전용 GET만 씁니다.
// 사용법: npx tsx scripts/capture-lcu-game.ts
import { writeFileSync } from 'node:fs';
import { lcuGet, readLcuCredentials } from './lcu-util';

async function main() {
  const creds = readLcuCredentials();
  const hist = await lcuGet<any>(creds, '/lol-match-history/v1/products/lol/current-summoner/matches?begIndex=0&endIndex=20');
  const target = (hist.games?.games ?? []).find((g: any) => g.queueId === 2400);
  if (!target) throw new Error('최근 20판에 Mayhem 경기가 없습니다.');
  const game = await lcuGet<any>(creds, `/lol-match-history/v1/games/${target.gameId}`);
  (game.participantIdentities ?? []).forEach((pi: any, i: number) => {
    pi.player = {
      ...pi.player,
      puuid: `puuid-${i}`,
      summonerId: i,
      accountId: i,
      currentAccountId: i,
      summonerName: `player${i}`,
      gameName: `player${i}`,
      tagLine: 'KR1',
      profileIcon: 0,
    };
  });
  writeFileSync('test/fixtures/lcu-game-2400.json', JSON.stringify(game, null, 2));
  console.log(`저장: test/fixtures/lcu-game-2400.json (gameId ${game.gameId}, 참가자 ${game.participants?.length}명)`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
```

그리고 공용 도우미 `scripts/lcu-util.ts`:
```ts
// 스크립트용 LCU 접속 도우미 (127.0.0.1, 롤 클라이언트 자체 서명 인증서). 토큰은 출력하지 않습니다.
import { execFileSync } from 'node:child_process';
import https from 'node:https';
import { parseLcuCredentials } from '@/lib/aram/lcu';

export interface LcuCreds { port: number; token: string }

export function readLcuCredentials(): LcuCreds {
  const cmd = execFileSync('powershell', [
    '-NoProfile', '-Command',
    "(Get-CimInstance Win32_Process -Filter \"name='LeagueClientUx.exe'\").CommandLine",
  ]).toString();
  const creds = parseLcuCredentials(cmd);
  if (!creds) throw new Error('롤 클라이언트가 실행 중이 아닙니다.');
  return creds;
}

const agent = new https.Agent({ rejectUnauthorized: false }); // LCU 전용 (127.0.0.1)

export function lcuGet<T>(creds: LcuCreds, path: string): Promise<T> {
  const auth = 'Basic ' + Buffer.from(`riot:${creds.token}`).toString('base64');
  return new Promise((resolve, reject) => {
    https
      .get({ host: '127.0.0.1', port: creds.port, path, agent, headers: { Authorization: auth } }, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          if (res.statusCode !== 200) return reject(new Error(`LCU ${res.statusCode} ${path.split('?')[0]}`));
          resolve(JSON.parse(body) as T);
        });
      })
      .on('error', reject);
  });
}
```

- [ ] **Step 2: 실패하는 테스트 `test/lcu.test.ts` 작성**

```ts
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { lcuGameToIngest, parseLcuCredentials } from '@/lib/aram/lcu';
import { isValidGame } from '@/lib/aram/ingest';

function lcuParticipant(i: number, stats: Record<string, unknown> = {}) {
  return {
    participantId: i + 1,
    championId: i + 1,
    teamId: i < 5 ? 100 : 200,
    spell1Id: 32,
    spell2Id: 4,
    stats: {
      win: i < 5,
      gameEndedInEarlySurrender: false,
      item0: 3089, item1: 3020, item2: 0, item3: 0, item4: 0, item5: 0, item6: 3340,
      perk0: 8229, perk1: 8226, perk2: 8210, perk3: 8237, perk4: 8345, perk5: 8347,
      perkPrimaryStyle: 8200, perkSubStyle: 8300,
      playerAugment1: 1336, playerAugment2: 1134, playerAugment3: 0, playerAugment4: 0, playerAugment5: 0, playerAugment6: 0,
      ...stats,
    },
  };
}

function lcuGame(over: Record<string, unknown> = {}) {
  return {
    gameId: 1000000001,
    queueId: 2400,
    gameMode: 'KIWI',
    gameVersion: '16.21.123.4567',
    gameDuration: 1100,
    participants: Array.from({ length: 10 }, (_, i) => lcuParticipant(i)),
    participantIdentities: [],
    ...over,
  };
}

describe('parseLcuCredentials', () => {
  it('실행 인자에서 포트와 토큰', () => {
    const cmd = '"C:/Riot Games/League of Legends/LeagueClientUx.exe" "--remoting-auth-token=AbC-123_x" "--app-port=54321" "--other"';
    expect(parseLcuCredentials(cmd)).toEqual({ port: 54321, token: 'AbC-123_x' });
  });
  it('없으면 null', () => expect(parseLcuCredentials('')).toBeNull());
});

describe('lcuGameToIngest', () => {
  it('LCU 경기 상세 → 수집 형식', () => {
    const g = lcuGameToIngest(lcuGame())!;
    expect(isValidGame(g)).toBe(true);
    expect(g).toMatchObject({ gameId: 1000000001, queueId: 2400, gameVersion: '16.21.123.4567', gameDuration: 1100, earlySurrender: false });
    expect(g.participants[0]).toEqual({
      championId: 1, win: true, spell1Id: 32, spell2Id: 4,
      items: [3089, 3020, 0, 0, 0, 0, 3340],
      perks: [8229, 8226, 8210, 8237, 8345, 8347],
      perkPrimaryStyle: 8200, perkSubStyle: 8300,
      augments: [1336, 1134],
    });
  });

  it('개인 정보는 넣지 않는다', () => {
    const g = lcuGameToIngest(lcuGame({ participantIdentities: [{ player: { gameName: 'secret', puuid: 'p' } }] }))!;
    expect(JSON.stringify(g)).not.toMatch(/secret|puuid/);
  });

  it('조기 항복은 한 명이라도 있으면 true', () => {
    const ps = Array.from({ length: 10 }, (_, i) => lcuParticipant(i, { gameEndedInEarlySurrender: i === 3 }));
    expect(lcuGameToIngest(lcuGame({ participants: ps }))!.earlySurrender).toBe(true);
  });

  it('증강·조기 항복 필드가 없어도 예외 없이 처리 (일반 칼바람)', () => {
    const ps = Array.from({ length: 10 }, (_, i) => {
      const p = lcuParticipant(i, { gameEndedInEarlySurrender: undefined });
      for (let k = 1; k <= 6; k++) delete (p.stats as any)[`playerAugment${k}`];
      return p;
    });
    const g = lcuGameToIngest(lcuGame({ queueId: 450, gameMode: 'ARAM', participants: ps }))!;
    expect(g.participants[0].augments).toEqual([]);
    expect(g.earlySurrender).toBe(false);
  });

  it('다른 큐나 깨진 데이터는 null', () => {
    expect(lcuGameToIngest(lcuGame({ queueId: 420 }))).toBeNull();
    expect(lcuGameToIngest({ queueId: 2400 })).toBeNull();
    expect(lcuGameToIngest(null)).toBeNull();
  });

  const fixture = 'test/fixtures/lcu-game-2400.json';
  it.skipIf(!existsSync(fixture))('실제 LCU 응답(가명 처리)을 유효한 수집 형식으로 바꾼다', () => {
    const g = lcuGameToIngest(JSON.parse(readFileSync(fixture, 'utf8')))!;
    expect(isValidGame(g)).toBe(true);
    expect(g.queueId).toBe(2400);
    expect(g.participants.every((p) => p.augments.length > 0)).toBe(true);
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `npx vitest run test/lcu.test.ts`
Expected: FAIL — `@/lib/aram/lcu` 없음

- [ ] **Step 4: `lib/aram/lcu.ts` 작성**

```ts
// 롤 클라이언트(LCU) 관련 순수 함수. 데스크톱 앱(lol-tracker-desktop)이 이 파일을 그대로 복사해 씁니다.
// - 실행 인자에서 접속 정보 추출
// - 경기 상세(/lol-match-history/v1/games/{gameId}) → 수집 요청 형식 (이름·puuid 등 개인 정보는 넣지 않음)
import type { IngestGame, IngestParticipant } from './types';

export function parseLcuCredentials(commandLine: string): { port: number; token: string } | null {
  const port = commandLine.match(/--app-port=(\d+)/)?.[1];
  const token = commandLine.match(/--remoting-auth-token=([\w-]+)/)?.[1];
  return port && token ? { port: Number(port), token } : null;
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

function toParticipant(p: any): IngestParticipant {
  const s = p.stats ?? {};
  return {
    championId: num(p.championId),
    win: Boolean(s.win),
    spell1Id: num(p.spell1Id),
    spell2Id: num(p.spell2Id),
    items: [0, 1, 2, 3, 4, 5, 6].map((i) => num(s[`item${i}`])),
    perks: [0, 1, 2, 3, 4, 5].map((i) => num(s[`perk${i}`])),
    perkPrimaryStyle: num(s.perkPrimaryStyle),
    perkSubStyle: num(s.perkSubStyle),
    augments: [1, 2, 3, 4, 5, 6].map((i) => num(s[`playerAugment${i}`])).filter((v) => v > 0),
  };
}

export function lcuGameToIngest(game: any): IngestGame | null {
  if (!game || (game.queueId !== 450 && game.queueId !== 2400)) return null;
  if (!Array.isArray(game.participants) || typeof game.gameVersion !== 'string' || !game.gameId) return null;
  return {
    gameId: game.gameId,
    queueId: game.queueId,
    gameVersion: game.gameVersion,
    gameDuration: num(game.gameDuration),
    earlySurrender: game.participants.some((p: any) => p.stats?.gameEndedInEarlySurrender === true),
    participants: game.participants.map(toParticipant),
  };
}
```

- [ ] **Step 5: 통과 확인**

Run: `npx vitest run test/lcu.test.ts && npx tsc --noEmit`
Expected: PASS (픽스처 테스트는 아직 skip), 타입 오류 없음

- [ ] **Step 6: (롤 클라이언트 실행 중) 실제 LCU 픽스처 저장과 개인 정보 확인**

Run: `npx tsx scripts/capture-lcu-game.ts`
Expected: `저장: test/fixtures/lcu-game-2400.json (gameId …, 참가자 10명)`

Run: `grep -ciE '<내 Riot 게임 이름>' test/fixtures/lcu-game-2400.json; grep -oE '"(gameName|summonerName)": "[^"]*"' test/fixtures/lcu-game-2400.json | grep -v player | head -3`
Expected: 첫 명령 `0`, 두 번째 출력 없음

Run: `npx vitest run test/lcu.test.ts`
Expected: PASS (픽스처 테스트 포함)

- [ ] **Step 7: 전송 스크립트 `scripts/push-lcu-games.ts` 작성**

```ts
// 이 PC 롤 클라이언트의 내 최근 Mayhem 경기를 수집 API로 보냅니다 (읽기 전용 LCU GET, 요청 사이 2초 간격).
// 사용법: npm run push:lcu -- [--api=https://lol.dec03.kr] [--count=20]
import { lcuGameToIngest } from '@/lib/aram/lcu';
import type { IngestGame } from '@/lib/aram/types';
import { lcuGet, readLcuCredentials } from './lcu-util';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const args = process.argv.slice(2);
  const api = args.find((a) => a.startsWith('--api='))?.split('=')[1] ?? 'https://lol.dec03.kr';
  const count = Math.min(Number(args.find((a) => a.startsWith('--count='))?.split('=')[1] ?? 20), 20);
  const key = process.env.INGEST_KEY;
  if (!key) throw new Error('INGEST_KEY가 없습니다. .env.local을 확인하세요.');

  const creds = readLcuCredentials();
  const hist = await lcuGet<any>(creds, `/lol-match-history/v1/products/lol/current-summoner/matches?begIndex=0&endIndex=${count}`);
  const ids: number[] = (hist.games?.games ?? []).filter((g: any) => g.queueId === 2400).map((g: any) => g.gameId);
  console.log(`최근 ${count}판 중 Mayhem ${ids.length}판`);

  const games: IngestGame[] = [];
  for (const id of ids) {
    await sleep(2000);
    const g = lcuGameToIngest(await lcuGet<any>(creds, `/lol-match-history/v1/games/${id}`));
    if (g) games.push(g);
  }
  if (games.length === 0) return console.log('보낼 경기가 없습니다.');

  const res = await fetch(`${api}/api/aram/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Ingest-Key': key },
    body: JSON.stringify({ games }),
  });
  console.log(`전송 결과: HTTP ${res.status}`, await res.json());
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
```

`package.json` `"scripts"`에 추가:
```json
"push:lcu": "tsx --env-file=.env.local scripts/push-lcu-games.ts",
```

- [ ] **Step 8: 끝까지 확인 (롤 클라이언트 실행 중, 로컬 서버)**

`.env.local`에 `UPSTASH_REDIS_REST_URL`(https://…), `UPSTASH_REDIS_REST_TOKEN`, `INGEST_KEY`가 있어야 한다.

1. 백그라운드로 `npm run dev` 실행 (http://localhost:3000)
2. Run: `npm run push:lcu -- --api=http://localhost:3000`
   Expected: `전송 결과: HTTP 200 { accepted: N, duplicates: 0, rejected: 0 }` (N은 최근 Mayhem 판수)
3. 같은 명령 다시 실행
   Expected: `{ accepted: 0, duplicates: N, rejected: 0 }`
4. 보낸 경기의 챔피언 중 하나로: `curl -s "http://localhost:3000/api/aram/build?champion=<ID>&queue=2400"`
   Expected: `sampleSize` ≥ 1, `augments` 항목은 5판 이상 나온 증강만 보이므로 비어 있을 수 있음 (정상). `sampleSize`와 `patch`가 채워졌는지 확인.
5. 키 없이 보내면 401: `curl -s -o /dev/null -w "%{http_code}" -X POST -H "Content-Type: application/json" -d '{"games":[{}]}' http://localhost:3000/api/aram/ingest`
   Expected: `401`
6. dev 서버 종료.

- [ ] **Step 9: 전체 확인과 Commit**

Run: `npm test && npx tsc --noEmit && npm run build`
Expected: 모든 테스트 PASS, 빌드 출력에 `ƒ /api/aram/ingest`, `ƒ /api/aram/build`

```bash
git add lib/aram/lcu.ts test/lcu.test.ts test/fixtures/lcu-game-2400.json scripts/capture-lcu-game.ts scripts/lcu-util.ts scripts/push-lcu-games.ts package.json
git commit -m "feat: LCU 경기 변환기와 내 Mayhem 경기 전송 스크립트

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 10: 배포는 사용자 확인 후**

GitHub push와 Vercel 배포는 사용자 확인 후 진행한다. 배포 전 Vercel `UPSTASH_REDIS_REST_URL`이 `https://`로 시작하는지 사용자가 확인한다.
