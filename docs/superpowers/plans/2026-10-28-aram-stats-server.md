# 칼바람 통계 서버 구현 계획 (계획 1/2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `lol-tracker`(Next.js 14, Vercel)에 칼바람(450)·Mayhem(2400) 경기를 온디맨드로 수집·집계하고 `GET /api/aram/build`로 챔피언별 추천 빌드를 제공하는 기능을 추가한다.

**Architecture:** Riot API 호출은 Upstash Redis 기반 전역 호출 한도기를 거친다(검색 우선, 수집은 2분당 50회까지). 빌드 조회 API가 응답 후 `waitUntil`로 `collectStep`을 한 번 실행해 경기 최대 10개를 가져오고, 챔피언별 누적값(JSON)을 `MGET`/`MSET`으로 갱신한다. 집계·계산 로직은 Redis와 분리된 순수 함수로 두고, Redis 접근은 `RedisLike` 인터페이스로 추상화해 테스트에서 `FakeRedis`로 대체한다.

**Tech Stack:** Next.js 14.2 (Pages Router), TypeScript 5.5, Upstash Redis REST, `@vercel/functions`, Vitest, tsx (스크립트 실행), Node 24

**Spec:** `docs/superpowers/specs/2026-10-28-aram-build-assistant-design.md`

**계획 2/2** (데스크톱 앱 `lol-tracker-desktop`)는 이 계획 완료 후 별도 문서로 작성한다.

## Global Constraints

- 지역은 KR만. 매치·계정 API 리전 호스트는 `https://asia.api.riotgames.com`.
- 큐는 `450`(칼바람), `2400`(Mayhem)만. 그 외 큐의 경기는 집계하지 않는다.
- Riot API 키(`RIOT_API_KEY`)는 서버 코드에서만 읽는다. 로그·응답·커밋에 키 값을 절대 남기지 않는다.
- 호출 한도: 1초 18회, 2분 90회 전체 / 수집은 2분 50회까지.
- Redis 키 접두어: 집계 `aram:agg:{queue}:{patch}:{championId}`, 패치 목록 `aram:patches`, 대기열 `aram:queue:puuid`, 최근 수집 표시 `aram:crawled:{puuid}`, 처리한 경기 `aram:seen:match`, 잠금 `aram:lock`, 한도 `rl:*`.
- Upstash가 설정되지 않은 로컬 환경에서도 기존 전적 검색은 지금처럼 동작해야 한다.
- 표본 기준: `LOW_SAMPLE = 30`판, 항목 최소 표본 `MIN_ITEM_GAMES = 5`판.
- 사용자에게 보이는 문구와 코드 주석은 한국어 (기존 코드와 동일).
- 커밋 메시지는 `feat:`/`test:`/`docs:` 접두어 + 한국어 설명, 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Upstash 미설정 상태의 전적 검색** — `.env.local`에 Upstash 값이 없으면 한도기가 Redis 오류를 삼키고 검색을 허용해야 한다 (Task 3 테스트 `search는 Redis 오류 시 허용`).
2. **다시하기·조기 항복 경기** — 5분 미만 경기나 `gameEndedInEarlySurrender` 참가자는 통계를 오염시키므로 제외해야 한다 (Task 5 테스트 `조기 종료 경기는 제외`).
3. **패치가 막 바뀐 직후** — 새 패치 표본이 30판 미만이면 이전 패치와 합쳐야 하고, 이전 패치가 없어도 오류 없이 응답해야 한다 (Task 6 테스트 두 개).
4. **수집 도중 예외로 잠금이 남는 상황** — 어떤 예외가 나도 `aram:lock`이 풀려야 다음 수집이 막히지 않는다 (Task 8 테스트 `예외가 나도 잠금 해제`).
5. **잘못된 쿼리 파라미터** — `champion=abc`, `queue=420` 같은 값은 400이어야 하고 Redis를 건드리지 않아야 한다 (Task 9 테스트).

## 파일 구조

| 파일 | 책임 |
|---|---|
| `lib/kv.ts` (수정) | Upstash REST 래퍼. 임의 명령 `kvCommand`, 파이프라인 `kvPipeline` 추가 |
| `lib/aram/redis.ts` (신규) | `RedisLike` 인터페이스와 Upstash 구현 `upstash` |
| `lib/rateLimit.ts` (신규) | 전역 호출 한도기 `acquire`, `blockFor`, 순수 판단 함수 `decide` |
| `lib/riot.ts` (수정) | `riotRequest`(한도 없는 원시 호출, 429 차단 처리) 분리, `riotFetch`가 한도기 사용 |
| `lib/aram/items.ts` (신규) | Data Dragon 아이템 분류 (완성 아이템 / 신발) |
| `lib/aram/aggregate.ts` (신규) | 경기 → 표본 추출, 누적값 갱신·정리, 키 규칙 |
| `lib/aram/types.ts` (신규) | API 응답 타입 (`AramBuildResponse`, `BuildStat`) — 데스크톱 앱으로 복사됨 |
| `lib/aram/build.ts` (신규) | 누적값 → 추천 빌드 계산, 패치 합산 |
| `lib/aram/store.ts` (신규) | Redis 키 조작 (누적값 읽기/쓰기, 패치, 대기열, 처리 기록, 잠금) |
| `lib/aram/collect.ts` (신규) | `collectStep` 수집 1회 실행 |
| `lib/aram/service.ts` (신규) | 실제 의존성 연결: `getAramBuild`, `runCollectStep` |
| `pages/api/aram/build.ts` (신규) | 빌드 조회 API |
| `scripts/inspect-match.ts` (신규) | 데이터 검증 스파이크 + 테스트 픽스처 저장 |
| `scripts/seed-aram.ts` (신규) | 초기 데이터 수집 스크립트 |
| `vitest.config.ts`, `test/**` (신규) | 테스트 설정, `FakeRedis`, 경기 생성기, 테스트 |

---

### Task 1: 테스트 환경과 데이터 검증 스파이크

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `test/fixtures/makeMatch.ts`
- Create: `test/smoke.test.ts`
- Create: `scripts/inspect-match.ts`
- Create (스크립트 실행 결과): `test/fixtures/match-450.json`, `test/fixtures/match-2400.json`

**Interfaces:**
- Produces: `makeParticipant(over?)`, `makeMatch(opts?)`, `CLASSES` (테스트 전반에서 사용), 실제 경기 픽스처 2개, 검증 결과(증강 필드 이름).

- [ ] **Step 1: 개발 의존성 설치**

Run (저장소 루트 `C:\Users\Administrator\projects\lol-tracker`):
```bash
npm install
npm install -D vitest@2.1.9 tsx@4.19.2
```
Expected: 오류 없이 설치, `package.json`의 `devDependencies`에 두 패키지 추가.

- [ ] **Step 2: `package.json`에 테스트 스크립트 추가**

`"scripts"`에 다음 줄을 추가한다:
```json
"test": "vitest run",
```

- [ ] **Step 3: `vitest.config.ts` 작성**

```ts
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('.', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
```

- [ ] **Step 4: 테스트용 경기 생성기 `test/fixtures/makeMatch.ts` 작성**

```ts
// 테스트용 가짜 경기 데이터. Riot match-v5 응답에서 집계에 쓰는 필드만 흉내 냅니다.
export const RABADON = 3089; // 완성 아이템
export const SORC_SHOES = 3020; // 신발
export const CLASSES = { completed: new Set([RABADON]), boots: new Set([SORC_SHOES]) };

export const DEFAULT_RUNE_KEY = '8200:8229-8226-8210-8237:8300:8345-8347:5008-5008-5001';

export function makeParticipant(over: Record<string, unknown> = {}) {
  return {
    puuid: 'p',
    championId: 1,
    win: true,
    summoner1Id: 32,
    summoner2Id: 4,
    item0: RABADON,
    item1: SORC_SHOES,
    item2: 0,
    item3: 0,
    item4: 0,
    item5: 0,
    item6: 3340,
    gameEndedInEarlySurrender: false,
    perks: {
      statPerks: { offense: 5008, flex: 5008, defense: 5001 },
      styles: [
        { description: 'primaryStyle', style: 8200, selections: [{ perk: 8229 }, { perk: 8226 }, { perk: 8210 }, { perk: 8237 }] },
        { description: 'subStyle', style: 8300, selections: [{ perk: 8345 }, { perk: 8347 }] },
      ],
    },
    ...over,
  };
}

export function makeMatch(opts: {
  matchId?: string;
  queueId?: number;
  gameVersion?: string;
  gameDuration?: number;
  participants?: ReturnType<typeof makeParticipant>[];
} = {}) {
  const participants =
    opts.participants ??
    Array.from({ length: 10 }, (_, i) => makeParticipant({ puuid: `p${i}`, championId: i + 1, win: i < 5 }));
  return {
    metadata: { matchId: opts.matchId ?? 'KR_1', participants: participants.map((p) => p.puuid) },
    info: {
      queueId: opts.queueId ?? 450,
      gameVersion: opts.gameVersion ?? '16.21.123.4567',
      gameDuration: opts.gameDuration ?? 1200,
      participants,
    },
  };
}
```

- [ ] **Step 5: 테스트 환경 확인용 `test/smoke.test.ts` 작성 후 실행**

```ts
import { describe, expect, it } from 'vitest';
import { makeMatch } from '@/test/fixtures/makeMatch';

describe('테스트 환경', () => {
  it('경로 별칭 @ 로 픽스처를 불러온다', () => {
    expect(makeMatch().info.participants).toHaveLength(10);
  });
});
```

Run: `npm test`
Expected: PASS (1 test)

- [ ] **Step 6: 데이터 검증 스크립트 `scripts/inspect-match.ts` 작성**

이 스크립트는 lib 코드를 쓰지 않는 독립 실행 파일이다 (한도기가 아직 없음, 호출 수 15회 이내).

```ts
// 데이터 검증 스파이크: 실제 KR 칼바람(450)·Mayhem(2400) 경기 JSON에 룬/증강 필드가 있는지 확인하고
// 개인 식별 정보를 가명 처리해 테스트 픽스처로 저장합니다.
// 사용법: npx tsx --env-file=.env.local scripts/inspect-match.ts "이름#태그"
import { writeFileSync, mkdirSync } from 'node:fs';

const ASIA = 'https://asia.api.riotgames.com';
const key = process.env.RIOT_API_KEY;
if (!key) throw new Error('RIOT_API_KEY가 없습니다. .env.local을 확인하세요.');

async function riot<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { 'X-Riot-Token': key! } });
  if (!res.ok) throw new Error(`Riot API ${res.status}: ${url.replace(/by-riot-id\/.*/, 'by-riot-id/...')}`);
  return (await res.json()) as T;
}

function pseudonymize(match: any) {
  const map = new Map<string, string>();
  match.metadata.participants = match.metadata.participants.map((p: string, i: number) => {
    map.set(p, `puuid-${i}`);
    return `puuid-${i}`;
  });
  match.info.participants.forEach((p: any, i: number) => {
    p.puuid = map.get(p.puuid) ?? `puuid-${i}`;
    for (const f of ['riotIdGameName', 'summonerName']) if (f in p) p[f] = `player${i}`;
    for (const f of ['riotIdTagline']) if (f in p) p[f] = 'KR1';
    for (const f of ['summonerId']) if (f in p) p[f] = `summoner-${i}`;
  });
  return match;
}

async function main() {
  const riotId = process.argv[2];
  if (!riotId || !riotId.includes('#')) throw new Error('사용법: scripts/inspect-match.ts "이름#태그"');
  const [name, tag] = riotId.split('#');
  const account = await riot<{ puuid: string }>(
    `${ASIA}/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(name)}/${encodeURIComponent(tag)}`,
  );
  mkdirSync('test/fixtures', { recursive: true });

  for (const queue of [450, 2400]) {
    const ids = await riot<string[]>(`${ASIA}/lol/match/v5/matches/by-puuid/${account.puuid}/ids?queue=${queue}&start=0&count=5`);
    if (ids.length === 0) {
      console.log(`[${queue}] 최근 경기 없음 — 이 큐로 한 판 이상 플레이한 계정으로 다시 실행하세요.`);
      continue;
    }
    const match = await riot<any>(`${ASIA}/lol/match/v5/matches/${ids[0]}`);
    const p = match.info.participants[0];
    const interesting = Object.keys(p).filter((k) => /perk|ugment|rune/i.test(k));
    console.log(`[${queue}] ${ids[0]} gameVersion=${match.info.gameVersion} gameDuration=${match.info.gameDuration}`);
    console.log(`  관련 필드: ${interesting.join(', ') || '(없음)'}`);
    console.log(`  perks.styles 개수: ${p.perks?.styles?.length ?? '없음'}, statPerks: ${JSON.stringify(p.perks?.statPerks ?? null)}`);
    for (const k of Object.keys(p).filter((k) => /ugment/i.test(k))) console.log(`  ${k} = ${JSON.stringify(p[k])}`);
    writeFileSync(`test/fixtures/match-${queue}.json`, JSON.stringify(pseudonymize(match), null, 2));
    console.log(`  저장: test/fixtures/match-${queue}.json`);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
```

- [ ] **Step 7: (사용자 작업) `.env.local` 준비**

사용자가 직접 `.env.local.example`을 `.env.local`로 복사하고 `RIOT_API_KEY`에 개인용 키, `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN`에 Vercel에 설정된 것과 같은 값을 넣는다. 에이전트는 키 값을 읽거나 출력하지 않는다. `.env.local`은 `.gitignore`에 이미 포함되어 있다.

- [ ] **Step 8: 스파이크 실행**

Run: `npx tsx --env-file=.env.local scripts/inspect-match.ts "<칼바람·Mayhem을 최근에 한 계정의 이름#태그>"` (계정은 사용자에게 받는다)
Expected: 큐별로 `관련 필드`, `perks.styles 개수: 2`, 증강 필드 값 출력, 픽스처 2개 저장.

결과 기록 — 스펙 문서 8절 아래에 다음 형식으로 추가한다:
```markdown
### 검증 결과 (YYYY-MM-DD)
- 450: perks 있음/없음, 증강 필드: ...
- 2400: perks 있음/없음, 증강 필드 이름: `playerAugment1~N` / 다른 이름 `...` / 없음
- 결정: 증강 기능 포함 / 제외
```
증강 필드 이름이 `playerAugment{숫자}`가 아니면 Task 5의 `augmentsOf` 정규식을 실제 이름에 맞게 바꾼다. 증강 필드가 없으면 `augmentsOf`는 그대로 두고(항상 빈 배열) 스펙에 "제외"로 기록한다.

- [ ] **Step 9: 픽스처에 개인 정보가 남지 않았는지 확인**

Run: `grep -hE '"(riotIdGameName|summonerName)": "' test/fixtures/match-*.json | grep -vE '"player[0-9]+"' || echo OK`
Run: `grep -c '"puuid": "puuid-' test/fixtures/match-450.json`
Expected: 첫 명령 `OK`, 두 번째 `10` (픽스처가 없는 큐는 생략).

- [ ] **Step 10: Commit**

```bash
git add package.json package-lock.json vitest.config.ts test scripts/inspect-match.ts docs/superpowers/specs
git commit -m "test: Vitest 환경과 칼바람 경기 데이터 검증 스크립트 추가

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Upstash 범용 명령과 `RedisLike` / `FakeRedis`

**Files:**
- Modify: `lib/kv.ts` (전체 교체)
- Create: `lib/aram/redis.ts`
- Create: `test/fakeRedis.ts`
- Test: `test/kv.test.ts`, `test/fakeRedis.test.ts`

**Interfaces:**
- Produces:
  - `kvCommand<T = unknown>(args: (string | number)[]): Promise<T>`
  - `kvPipeline(cmds: (string | number)[][]): Promise<unknown[]>`
  - `type Cmd = (string | number)[]`
  - `interface RedisLike { cmd<T = unknown>(args: Cmd): Promise<T>; pipe(cmds: Cmd[]): Promise<unknown[]> }`
  - `const upstash: RedisLike`
  - `class FakeRedis implements RedisLike` — 지원 명령: GET, SET(NX/EX), DEL, MGET, MSET, INCRBY, DECRBY, EXPIRE, LPOP, LPUSH, RPUSH, LTRIM, LLEN, SADD, SMISMEMBER, ZADD, ZREVRANGE. `log: Cmd[]`에 실행한 명령 기록.

- [ ] **Step 1: 실패하는 테스트 `test/kv.test.ts` 작성**

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { kvCommand, kvPipeline } from '@/lib/kv';

describe('kv', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://kv.example');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'tok');
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it('kvCommand는 명령 배열을 루트 URL로 POST하고 result를 돌려준다', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ result: 'OK' })));
    await expect(kvCommand(['SET', 'a', 1])).resolves.toBe('OK');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://kv.example');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(JSON.parse(init.body)).toEqual(['SET', 'a', 1]);
  });

  it('kvPipeline은 /pipeline으로 보내고 결과 배열을 돌려준다', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify([{ result: 1 }, { result: null }])));
    await expect(kvPipeline([['INCRBY', 'x', 1], ['GET', 'y']])).resolves.toEqual([1, null]);
    expect(fetchMock.mock.calls[0][0]).toBe('https://kv.example/pipeline');
  });

  it('파이프라인 항목에 error가 있으면 예외', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify([{ result: 1 }, { error: 'WRONGTYPE' }])));
    await expect(kvPipeline([['INCRBY', 'x', 1], ['GET', 'y']])).rejects.toThrow('WRONGTYPE');
  });

  it('환경변수가 없으면 예외', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
    await expect(kvCommand(['GET', 'a'])).rejects.toThrow('UPSTASH_REDIS_REST_URL');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run test/kv.test.ts`
Expected: FAIL — `kvCommand`/`kvPipeline`이 export되지 않음

- [ ] **Step 3: `lib/kv.ts` 전체 교체**

환경변수를 호출 시점에 읽도록 바꾼다 (테스트·스크립트에서 모듈 로드 이후 설정 가능).

```ts
// Upstash Redis(REST 기반 무료 KV 스토어)에 데이터를 저장하기 위한 아주 얇은 래퍼입니다.
// 서버(API Route, 스크립트)에서만 사용하세요.

function config() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    throw new Error('UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN 환경변수가 설정되지 않았습니다.');
  }
  return { url, token };
}

export async function kvGet<T>(key: string): Promise<T | null> {
  const { url, token } = config();
  const res = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Upstash GET 실패 (${res.status})`);
  const json = await res.json();
  return json.result ? (JSON.parse(json.result) as T) : null;
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  const { url, token } = config();
  const res = await fetch(`${url}/set/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(value),
  });
  if (!res.ok) throw new Error(`Upstash SET 실패 (${res.status})`);
}

// 임의의 Redis 명령 하나를 실행합니다. 예: kvCommand(['INCRBY', 'key', 1])
export async function kvCommand<T = unknown>(args: (string | number)[]): Promise<T> {
  const { url, token } = config();
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(args),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Upstash 명령 실패 (${res.status})`);
  const json = await res.json();
  if (json.error) throw new Error(`Upstash 오류: ${json.error}`);
  return json.result as T;
}

// 여러 명령을 HTTP 요청 한 번으로 실행합니다. (Upstash 요금은 명령마다 따로 계산됩니다)
export async function kvPipeline(cmds: (string | number)[][]): Promise<unknown[]> {
  const { url, token } = config();
  const res = await fetch(`${url}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(cmds),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Upstash 파이프라인 실패 (${res.status})`);
  const items = (await res.json()) as { result?: unknown; error?: string }[];
  const failed = items.find((item) => item.error);
  if (failed) throw new Error(`Upstash 오류: ${failed.error}`);
  return items.map((item) => item.result ?? null);
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run test/kv.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: `lib/aram/redis.ts` 작성**

```ts
// 통계 기능이 쓰는 Redis 접근 인터페이스. 테스트에서는 FakeRedis로 바꿔 끼웁니다.
import { kvCommand, kvPipeline } from '@/lib/kv';

export type Cmd = (string | number)[];

export interface RedisLike {
  cmd<T = unknown>(args: Cmd): Promise<T>;
  pipe(cmds: Cmd[]): Promise<unknown[]>;
}

export const upstash: RedisLike = {
  cmd: kvCommand,
  pipe: kvPipeline,
};
```

- [ ] **Step 6: 실패하는 테스트 `test/fakeRedis.test.ts` 작성**

```ts
import { describe, expect, it } from 'vitest';
import { FakeRedis } from '@/test/fakeRedis';

describe('FakeRedis', () => {
  it('SET NX는 이미 있으면 null', async () => {
    const r = new FakeRedis();
    expect(await r.cmd(['SET', 'k', '1', 'NX', 'EX', 60])).toBe('OK');
    expect(await r.cmd(['SET', 'k', '2', 'NX', 'EX', 60])).toBeNull();
    expect(await r.cmd(['GET', 'k'])).toBe('1');
  });

  it('리스트: RPUSH, LPUSH, LPOP, LTRIM, LLEN', async () => {
    const r = new FakeRedis();
    await r.cmd(['RPUSH', 'q', 'a', 'b', 'c']);
    await r.cmd(['LPUSH', 'q', 'z']);
    await r.cmd(['LTRIM', 'q', 0, 2]);
    expect(await r.cmd(['LLEN', 'q'])).toBe(3);
    expect(await r.cmd(['LPOP', 'q'])).toBe('z');
    expect(await r.cmd(['LPOP', 'q'])).toBe('a');
  });

  it('집합과 정렬 집합', async () => {
    const r = new FakeRedis();
    await r.cmd(['SADD', 's', 'x']);
    expect(await r.cmd(['SMISMEMBER', 's', 'x', 'y'])).toEqual([1, 0]);
    await r.cmd(['ZADD', 'z', 16020, '16.20', 16021, '16.21']);
    expect(await r.cmd(['ZREVRANGE', 'z', 0, 1])).toEqual(['16.21', '16.20']);
  });

  it('MGET/MSET, INCRBY/DECRBY, pipe', async () => {
    const r = new FakeRedis();
    await r.cmd(['MSET', 'a', '1', 'b', '2']);
    expect(await r.cmd(['MGET', 'a', 'b', 'c'])).toEqual(['1', '2', null]);
    expect(await r.pipe([['INCRBY', 'n', 5], ['DECRBY', 'n', 2]])).toEqual([5, 3]);
    expect(r.log).toHaveLength(4);
  });
});
```

- [ ] **Step 7: 실패 확인**

Run: `npx vitest run test/fakeRedis.test.ts`
Expected: FAIL — `test/fakeRedis` 모듈 없음

- [ ] **Step 8: `test/fakeRedis.ts` 작성**

```ts
// 테스트용 메모리 Redis. 이 프로젝트가 쓰는 명령만 Upstash REST와 같은 반환 형식으로 흉내 냅니다.
import type { Cmd, RedisLike } from '@/lib/aram/redis';

export class FakeRedis implements RedisLike {
  strings = new Map<string, string>();
  lists = new Map<string, string[]>();
  sets = new Map<string, Set<string>>();
  zsets = new Map<string, Map<string, number>>();
  log: Cmd[] = [];

  async cmd<T = unknown>(args: Cmd): Promise<T> {
    this.log.push(args);
    return this.exec(args) as T;
  }

  async pipe(cmds: Cmd[]): Promise<unknown[]> {
    const out: unknown[] = [];
    for (const c of cmds) out.push(await this.cmd(c));
    return out;
  }

  private list(key: string) {
    const l = this.lists.get(key) ?? [];
    this.lists.set(key, l);
    return l;
  }

  private exec(args: Cmd): unknown {
    const [op, ...rest] = args.map(String);
    switch (op.toUpperCase()) {
      case 'GET':
        return this.strings.get(rest[0]) ?? null;
      case 'SET': {
        const [key, value, ...opts] = rest;
        if (opts.map((o) => o.toUpperCase()).includes('NX') && this.strings.has(key)) return null;
        this.strings.set(key, value);
        return 'OK';
      }
      case 'DEL': {
        let n = 0;
        for (const k of rest) {
          const hit = [this.strings, this.lists, this.sets, this.zsets].some((m) => m.delete(k));
          if (hit) n++;
        }
        return n;
      }
      case 'MGET':
        return rest.map((k) => this.strings.get(k) ?? null);
      case 'MSET':
        for (let i = 0; i < rest.length; i += 2) this.strings.set(rest[i], rest[i + 1]);
        return 'OK';
      case 'INCRBY':
      case 'DECRBY': {
        const sign = op.toUpperCase() === 'INCRBY' ? 1 : -1;
        const v = Number(this.strings.get(rest[0]) ?? 0) + sign * Number(rest[1]);
        this.strings.set(rest[0], String(v));
        return v;
      }
      case 'EXPIRE':
        return 1;
      case 'LPOP': {
        const l = this.lists.get(rest[0]);
        return l && l.length > 0 ? l.shift()! : null;
      }
      case 'LPUSH': {
        const l = this.list(rest[0]);
        l.unshift(...rest.slice(1).reverse());
        return l.length;
      }
      case 'RPUSH': {
        const l = this.list(rest[0]);
        l.push(...rest.slice(1));
        return l.length;
      }
      case 'LTRIM': {
        const l = this.list(rest[0]);
        const start = Number(rest[1]);
        const stop = Number(rest[2]);
        this.lists.set(rest[0], l.slice(start, stop === -1 ? undefined : stop + 1));
        return 'OK';
      }
      case 'LLEN':
        return this.lists.get(rest[0])?.length ?? 0;
      case 'SADD': {
        const s = this.sets.get(rest[0]) ?? new Set<string>();
        this.sets.set(rest[0], s);
        let added = 0;
        for (const m of rest.slice(1)) if (!s.has(m)) (s.add(m), added++);
        return added;
      }
      case 'SMISMEMBER': {
        const s = this.sets.get(rest[0]);
        return rest.slice(1).map((m) => (s?.has(m) ? 1 : 0));
      }
      case 'ZADD': {
        const z = this.zsets.get(rest[0]) ?? new Map<string, number>();
        this.zsets.set(rest[0], z);
        for (let i = 1; i < rest.length; i += 2) z.set(rest[i + 1], Number(rest[i]));
        return 1;
      }
      case 'ZREVRANGE': {
        const z = this.zsets.get(rest[0]) ?? new Map<string, number>();
        const sorted = [...z.entries()].sort((a, b) => b[1] - a[1]).map(([m]) => m);
        return sorted.slice(Number(rest[1]), Number(rest[2]) + 1);
      }
      default:
        throw new Error(`FakeRedis: 지원하지 않는 명령 ${op}`);
    }
  }
}
```

- [ ] **Step 9: 통과 확인**

Run: `npm test`
Expected: PASS (전체)

- [ ] **Step 10: Commit**

```bash
git add lib/kv.ts lib/aram/redis.ts test/fakeRedis.ts test/kv.test.ts test/fakeRedis.test.ts
git commit -m "feat: Upstash 범용 명령·파이프라인과 테스트용 FakeRedis 추가

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: 전역 호출 한도기와 `riot.ts` 연결

**Files:**
- Create: `lib/rateLimit.ts`
- Modify: `lib/riot.ts:4` (상수 `RIOT_API_KEY` 삭제), `lib/riot.ts:26-58` (`riotFetch` 교체)
- Test: `test/rateLimit.test.ts`, `test/riot.test.ts`

**Interfaces:**
- Consumes: `RedisLike`, `Cmd`, `upstash` (Task 2)
- Produces:
  - `type Kind = 'search' | 'collect'`
  - `LIMITS = { perSecond: 18, perTwoMinutes: 90, collectPerTwoMinutes: 50 }`
  - `decide(kind: Kind, c: { sec: number; win: number; collect: number; blocked: boolean }): boolean`
  - `acquire(redis: RedisLike, kind: Kind, n?: number, nowMs?: number): Promise<boolean>`
  - `blockFor(redis: RedisLike, seconds: number): Promise<void>`
  - `riotRequest<T>(url: string): Promise<T>` (lib/riot.ts, 한도기 없이 호출 — 호출자가 미리 `acquire` 해야 함)

- [ ] **Step 1: 실패하는 테스트 `test/rateLimit.test.ts` 작성**

```ts
import { describe, expect, it } from 'vitest';
import { acquire, blockFor, decide, LIMITS } from '@/lib/rateLimit';
import { FakeRedis } from '@/test/fakeRedis';
import type { RedisLike } from '@/lib/aram/redis';

const T0 = 1_800_000_000_000; // 고정 시각 (2분 창 경계 아님)

describe('decide', () => {
  const ok = { sec: 1, win: 1, collect: 1, blocked: false };
  it('한도 이내면 허용', () => {
    expect(decide('search', ok)).toBe(true);
    expect(decide('collect', ok)).toBe(true);
  });
  it('차단 중이면 거부', () => expect(decide('search', { ...ok, blocked: true })).toBe(false));
  it('초당 한도 초과면 거부', () => expect(decide('search', { ...ok, sec: LIMITS.perSecond + 1 })).toBe(false));
  it('2분 한도 초과면 거부', () => expect(decide('search', { ...ok, win: LIMITS.perTwoMinutes + 1 })).toBe(false));
  it('수집은 수집 한도 초과면 거부, 검색은 무관', () => {
    const c = { ...ok, collect: LIMITS.collectPerTwoMinutes + 1 };
    expect(decide('collect', c)).toBe(false);
    expect(decide('search', c)).toBe(true);
  });
});

describe('acquire', () => {
  it('수집은 2분에 50회까지만, 거부되면 카운터를 되돌린다', async () => {
    const r = new FakeRedis();
    expect(await acquire(r, 'collect', 12, T0)).toBe(true);
    expect(await acquire(r, 'collect', 12, T0 + 1000)).toBe(true);
    expect(await acquire(r, 'collect', 12, T0 + 2000)).toBe(true);
    expect(await acquire(r, 'collect', 12, T0 + 3000)).toBe(true); // 48
    expect(await acquire(r, 'collect', 12, T0 + 4000)).toBe(false); // 60 > 50
    // 되돌렸으므로 검색은 남은 한도(90-48=42)를 쓸 수 있다
    const win = Math.floor(T0 / 120_000);
    expect(r.strings.get(`rl:120s:${win}`)).toBe('48');
    expect(await acquire(r, 'search', 1, T0 + 5000)).toBe(true);
  });

  it('blockFor 이후에는 거부', async () => {
    const r = new FakeRedis();
    await blockFor(r, 7);
    expect(r.log.at(-1)).toEqual(['SET', 'rl:block', '1', 'EX', 7]);
    expect(await acquire(r, 'search', 1, T0)).toBe(false);
  });

  it('search는 Redis 오류 시 허용, collect는 거부', async () => {
    const broken: RedisLike = {
      cmd: async () => { throw new Error('UPSTASH 미설정'); },
      pipe: async () => { throw new Error('UPSTASH 미설정'); },
    };
    expect(await acquire(broken, 'search', 1, T0)).toBe(true);
    expect(await acquire(broken, 'collect', 1, T0)).toBe(false);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run test/rateLimit.test.ts`
Expected: FAIL — `@/lib/rateLimit` 없음

- [ ] **Step 3: `lib/rateLimit.ts` 작성**

```ts
// Riot API 전역 호출 한도기. 여러 Vercel 인스턴스가 Upstash 카운터를 공유합니다.
// 개인용 키 한도(1초 20회, 2분 100회)에서 고정 창 오차를 대비해 여유분을 뺐고,
// 통계 수집(collect)은 2분에 50회까지만 써서 전적 검색(search)이 최소 40회를 쓸 수 있게 합니다.
import type { Cmd, RedisLike } from '@/lib/aram/redis';

export type Kind = 'search' | 'collect';

export const LIMITS = { perSecond: 18, perTwoMinutes: 90, collectPerTwoMinutes: 50 } as const;
export const BLOCK_KEY = 'rl:block';

export function windowKeys(nowMs: number) {
  const sec = Math.floor(nowMs / 1000);
  const win = Math.floor(nowMs / 120_000);
  return { sec: `rl:1s:${sec}`, win: `rl:120s:${win}`, collect: `rl:120s:c:${win}` };
}

export function decide(kind: Kind, c: { sec: number; win: number; collect: number; blocked: boolean }): boolean {
  if (c.blocked) return false;
  if (c.sec > LIMITS.perSecond || c.win > LIMITS.perTwoMinutes) return false;
  if (kind === 'collect' && c.collect > LIMITS.collectPerTwoMinutes) return false;
  return true;
}

// n회 호출할 권한을 한 번에 예약합니다. 거부되면 올린 카운터를 되돌립니다.
export async function acquire(redis: RedisLike, kind: Kind, n = 1, nowMs = Date.now()): Promise<boolean> {
  const k = windowKeys(nowMs);
  const cmds: Cmd[] = [
    ['INCRBY', k.sec, n],
    ['EXPIRE', k.sec, 2],
    ['INCRBY', k.win, n],
    ['EXPIRE', k.win, 130],
  ];
  if (kind === 'collect') cmds.push(['INCRBY', k.collect, n], ['EXPIRE', k.collect, 130]);
  cmds.push(['GET', BLOCK_KEY]);

  let out: unknown[];
  try {
    out = await redis.pipe(cmds);
  } catch (err) {
    // Upstash가 없거나 장애일 때: 전적 검색은 예전처럼 동작하게 두고, 수집만 멈춥니다.
    console.warn('[rateLimit] Redis를 쓸 수 없어 한도 확인을 건너뜁니다.', err);
    return kind === 'search';
  }

  const counts = {
    sec: Number(out[0]),
    win: Number(out[2]),
    collect: kind === 'collect' ? Number(out[4]) : 0,
    blocked: out[out.length - 1] != null,
  };
  if (decide(kind, counts)) return true;

  const refund: Cmd[] = [['DECRBY', k.sec, n], ['DECRBY', k.win, n]];
  if (kind === 'collect') refund.push(['DECRBY', k.collect, n]);
  await redis.pipe(refund).catch(() => {});
  return false;
}

// Riot이 429를 돌려줬을 때 Retry-After 동안 모든 호출을 막습니다.
export async function blockFor(redis: RedisLike, seconds: number): Promise<void> {
  const s = Math.max(1, Math.ceil(seconds));
  await redis.cmd(['SET', BLOCK_KEY, '1', 'EX', s]);
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run test/rateLimit.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: 실패하는 테스트 `test/riot.test.ts` 작성**

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/rateLimit', () => ({
  acquire: vi.fn(async () => true),
  blockFor: vi.fn(async () => {}),
}));

import { acquire, blockFor } from '@/lib/rateLimit';
import { getAccountByRiotId, riotRequest, RiotApiError } from '@/lib/riot';

describe('riot', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubEnv('RIOT_API_KEY', 'test-key');
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    vi.mocked(acquire).mockClear();
    vi.mocked(blockFor).mockClear();
  });

  it('riotRequest는 429면 Retry-After만큼 차단하고 RiotApiError(429)', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 429, headers: { 'Retry-After': '7' } }));
    const err = await riotRequest('https://asia.api.riotgames.com/x').catch((e) => e);
    expect(err).toBeInstanceOf(RiotApiError);
    expect(err.status).toBe(429);
    expect(blockFor).toHaveBeenCalledWith(expect.anything(), 7);
  });

  it('riotRequest는 키를 헤더로 보낸다', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: 1 })));
    await expect(riotRequest('https://asia.api.riotgames.com/y')).resolves.toEqual({ ok: 1 });
    expect(fetchMock.mock.calls[0][1].headers['X-Riot-Token']).toBe('test-key');
  });

  it('검색 호출은 한도기를 거치고, 거부되면 fetch 없이 429', async () => {
    vi.mocked(acquire).mockResolvedValueOnce(false);
    const err = await getAccountByRiotId('없는이름', 'KR1', 'kr').catch((e) => e);
    expect(err.status).toBe(429);
    expect(acquire).toHaveBeenCalledWith(expect.anything(), 'search', 1);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: 실패 확인**

Run: `npx vitest run test/riot.test.ts`
Expected: FAIL — `riotRequest`가 export되지 않음

- [ ] **Step 7: `lib/riot.ts` 수정**

(a) 파일 상단 import에 추가하고 `const RIOT_API_KEY = process.env.RIOT_API_KEY;` 줄을 삭제한다:
```ts
import { acquire, blockFor } from '@/lib/rateLimit';
import { upstash } from '@/lib/aram/redis';
```

(b) 기존 `async function riotFetch<T>(...) { ... }` 전체(캐시 맵 선언 아래부터 `RiotApiError` 클래스 위까지)를 다음으로 교체한다:
```ts
// 한도기를 거치지 않는 원시 호출입니다. 호출 전에 acquire()로 한도를 예약해야 합니다.
export async function riotRequest<T>(url: string): Promise<T> {
  const key = process.env.RIOT_API_KEY;
  if (!key) {
    throw new Error('RIOT_API_KEY가 설정되지 않았습니다. .env.local 파일을 확인하세요.');
  }
  const res = await fetch(url, {
    headers: { 'X-Riot-Token': key },
    cache: 'no-store',
  });

  if (!res.ok) {
    if (res.status === 404) throw new RiotApiError('찾을 수 없습니다.', 404);
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get('Retry-After') ?? '10') || 10;
      await blockFor(upstash, retryAfter).catch(() => {});
      throw new RiotApiError('요청이 너무 많습니다. 잠시 후 다시 시도하세요.', 429);
    }
    if (res.status === 403) throw new RiotApiError('API 키가 유효하지 않거나 만료되었습니다.', 403);
    throw new RiotApiError(`Riot API 오류 (${res.status})`, res.status);
  }
  return (await res.json()) as T;
}

// 전적 검색용 호출: 캐시 → 한도기(search) → 원시 호출
async function riotFetch<T>(url: string, ttlMs = 0): Promise<T> {
  if (ttlMs > 0) {
    const hit = cache.get(url);
    if (hit && hit.expires > Date.now()) {
      return hit.data as T;
    }
  }

  if (!(await acquire(upstash, 'search', 1))) {
    throw new RiotApiError('요청이 너무 많습니다. 잠시 후 다시 시도하세요.', 429);
  }
  const data = await riotRequest<T>(url);
  if (ttlMs > 0) cache.set(url, { data, expires: Date.now() + ttlMs });
  return data;
}
```
`RiotApiError` 클래스는 `riotRequest`보다 아래에 선언되어 있어도 호출 시점에는 초기화가 끝나 있으므로 위치를 옮기지 않는다.

- [ ] **Step 8: 통과 확인**

Run: `npm test`
Expected: PASS (전체)

- [ ] **Step 9: 기존 사이트 빌드 확인**

Run: `npx tsc --noEmit`
Expected: 오류 없음

- [ ] **Step 10: Commit**

```bash
git add lib/rateLimit.ts lib/riot.ts test/rateLimit.test.ts test/riot.test.ts
git commit -m "feat: Upstash 기반 Riot API 전역 호출 한도기 추가

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: 아이템 분류

**Files:**
- Create: `lib/aram/items.ts`
- Test: `test/items.test.ts`

**Interfaces:**
- Produces:
  - `interface ItemClasses { completed: Set<number>; boots: Set<number> }`
  - `classifyItems(itemJson: { data: Record<string, DdItem> }): ItemClasses`
  - `getItemClasses(version: string): Promise<ItemClasses>` (인스턴스 메모리 캐시)

- [ ] **Step 1: 실패하는 테스트 `test/items.test.ts` 작성**

```ts
import { describe, expect, it } from 'vitest';
import { classifyItems } from '@/lib/aram/items';

const aram = { '12': true };
const json = {
  data: {
    '3089': { tags: ['SpellDamage'], depth: 3, gold: { total: 3600, purchasable: true }, maps: aram }, // 라바돈
    '3020': { tags: ['Boots', 'MagicPenetration'], depth: 2, into: ['3175'], gold: { total: 1100, purchasable: true }, maps: aram }, // 마법사 신발
    '1001': { tags: ['Boots'], into: ['3020'], gold: { total: 300, purchasable: true }, maps: aram }, // 장화
    '2003': { tags: ['Consumable'], gold: { total: 50, purchasable: true }, maps: aram }, // 물약
    '3340': { tags: ['Trinket'], gold: { total: 0, purchasable: true }, maps: aram }, // 장신구
    '1058': { tags: ['SpellDamage'], into: ['3089'], gold: { total: 1200, purchasable: true }, maps: aram }, // 쓸데없이 큰 지팡이
    '9999': { tags: [], gold: { total: 3000, purchasable: true }, maps: { '12': false } }, // 칼바람 불가
    '3157': { tags: [], gold: { total: 3250, purchasable: false }, maps: aram }, // 구매 불가
    '1500': { tags: [], gold: { total: 500, purchasable: true }, maps: aram }, // 1000골드 미만 완성템
  },
};

describe('classifyItems', () => {
  const c = classifyItems(json);
  it('완성 아이템은 라바돈만', () => expect([...c.completed]).toEqual([3089]));
  it('신발은 2단계 이상만', () => expect([...c.boots]).toEqual([3020]));
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run test/items.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: `lib/aram/items.ts` 작성**

```ts
// Data Dragon item.json으로 "완성 아이템"과 "신발"을 구분합니다. 칼바람 맵 번호는 12입니다.
export interface DdItem {
  into?: string[];
  tags?: string[];
  depth?: number;
  consumed?: boolean;
  gold: { total: number; purchasable: boolean };
  maps: Record<string, boolean>;
}

export interface ItemClasses {
  completed: Set<number>;
  boots: Set<number>;
}

const ARAM_MAP = '12';
const MIN_COMPLETED_GOLD = 1000;

export function classifyItems(itemJson: { data: Record<string, DdItem> }): ItemClasses {
  const completed = new Set<number>();
  const boots = new Set<number>();
  for (const [id, item] of Object.entries(itemJson.data)) {
    if (!item.maps?.[ARAM_MAP] || !item.gold?.purchasable) continue;
    const tags = item.tags ?? [];
    if (tags.includes('Boots')) {
      if ((item.depth ?? 1) >= 2) boots.add(Number(id));
      continue;
    }
    if (tags.includes('Consumable') || tags.includes('Trinket') || item.consumed) continue;
    if ((item.into?.length ?? 0) === 0 && item.gold.total >= MIN_COMPLETED_GOLD) completed.add(Number(id));
  }
  return { completed, boots };
}

const cache = new Map<string, ItemClasses>();

export async function getItemClasses(version: string): Promise<ItemClasses> {
  const hit = cache.get(version);
  if (hit) return hit;
  const res = await fetch(`https://ddragon.leagueoflegends.com/cdn/${version}/data/ko_KR/item.json`);
  if (!res.ok) throw new Error(`Data Dragon item.json 실패 (${res.status})`);
  const classes = classifyItems(await res.json());
  cache.set(version, classes);
  return classes;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run test/items.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/aram/items.ts test/items.test.ts
git commit -m "feat: Data Dragon 기반 칼바람 완성 아이템·신발 분류

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: 경기 집계

**Files:**
- Create: `lib/aram/aggregate.ts`
- Test: `test/aggregate.test.ts`

**Interfaces:**
- Consumes: `ItemClasses` (Task 4), `makeMatch`, `makeParticipant`, `CLASSES`, `DEFAULT_RUNE_KEY` (Task 1)
- Produces:
  - `type Queue = 450 | 2400`, `ARAM_QUEUES: readonly Queue[]` (= `[2400, 450]`)
  - `type Pair = [number, number]`
  - `interface ChampAgg { g; w; r; s; i; b; a }` (스펙 4.3)
  - `AGG_CATS = ['r', 's', 'i', 'b', 'a'] as const`
  - `interface Sample { queue: Queue; patch: string; championId: number; win: boolean; rune: string | null; spell: string; items: number[]; boots: number | null; augments: number[] }`
  - `emptyAgg(): ChampAgg`, `aggKey(queue, patch, championId): string`, `patchOf(gameVersion): string`
  - `runeKey(perks): string | null`, `spellKey(a, b): string`, `augmentsOf(participant): number[]`
  - `extractSamples(match: any, classes: ItemClasses): Sample[]`
  - `applySamples(aggs: Map<string, ChampAgg>, samples: Sample[]): void`
  - `pruneAgg(agg: ChampAgg, max?: number): void`

- [ ] **Step 1: 실패하는 테스트 `test/aggregate.test.ts` 작성**

```ts
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  aggKey, applySamples, augmentsOf, emptyAgg, extractSamples, patchOf, pruneAgg, spellKey, type ChampAgg,
} from '@/lib/aram/aggregate';
import { CLASSES, DEFAULT_RUNE_KEY, RABADON, SORC_SHOES, makeMatch, makeParticipant } from '@/test/fixtures/makeMatch';

describe('키 규칙', () => {
  it('패치는 앞 두 자리', () => expect(patchOf('16.21.123.4567')).toBe('16.21'));
  it('스펠은 순서 무관', () => expect(spellKey(32, 4)).toBe('4-32'));
  it('집계 키', () => expect(aggKey(2400, '16.21', 99)).toBe('aram:agg:2400:16.21:99'));
  it('증강은 0을 빼고 숫자만', () =>
    expect(augmentsOf({ playerAugment1: 101, playerAugment2: 0, playerAugment3: 205, other: 1 })).toEqual([101, 205]));
});

describe('extractSamples', () => {
  it('칼바람 경기에서 10명분 표본', () => {
    const s = extractSamples(makeMatch(), CLASSES);
    expect(s).toHaveLength(10);
    expect(s[0]).toEqual({
      queue: 450, patch: '16.21', championId: 1, win: true, rune: DEFAULT_RUNE_KEY,
      spell: '4-32', items: [RABADON], boots: SORC_SHOES, augments: [],
    });
  });

  it('다른 큐는 무시', () => expect(extractSamples(makeMatch({ queueId: 420 }), CLASSES)).toEqual([]));

  it('조기 종료 경기는 제외', () => {
    expect(extractSamples(makeMatch({ gameDuration: 200 }), CLASSES)).toEqual([]);
    const ps = Array.from({ length: 10 }, (_, i) => makeParticipant({ puuid: `p${i}`, gameEndedInEarlySurrender: true }));
    expect(extractSamples(makeMatch({ participants: ps }), CLASSES)).toEqual([]);
  });

  it('룬 정보가 없으면 rune은 null', () => {
    const ps = [makeParticipant({ perks: { styles: [], statPerks: {} } })];
    expect(extractSamples(makeMatch({ participants: ps }), CLASSES)[0].rune).toBeNull();
  });

  it('같은 완성 아이템이 두 칸에 있으면 한 번만', () => {
    const ps = [makeParticipant({ item2: RABADON })];
    expect(extractSamples(makeMatch({ participants: ps }), CLASSES)[0].items).toEqual([RABADON]);
  });

  it('Mayhem 증강을 읽는다', () => {
    const ps = [makeParticipant({ playerAugment1: 7, playerAugment2: 9 })];
    expect(extractSamples(makeMatch({ queueId: 2400, participants: ps }), CLASSES)[0].augments).toEqual([7, 9]);
  });

  for (const q of [450, 2400]) {
    const path = `test/fixtures/match-${q}.json`;
    it.skipIf(!existsSync(path))(`실제 픽스처(${q})에서 10명분 표본과 룬을 뽑는다`, () => {
      const s = extractSamples(JSON.parse(readFileSync(path, 'utf8')), CLASSES);
      expect(s).toHaveLength(10);
      expect(s.every((x) => x.rune !== null)).toBe(true);
    });
  }
});

describe('applySamples / pruneAgg', () => {
  it('챔피언별로 판수·승수와 항목을 누적', () => {
    const aggs = new Map<string, ChampAgg>();
    const samples = extractSamples(makeMatch(), CLASSES);
    applySamples(aggs, samples);
    applySamples(aggs, samples);
    const a = aggs.get(aggKey(450, '16.21', 1))!;
    expect(a.g).toBe(2);
    expect(a.w).toBe(2);
    expect(a.r[DEFAULT_RUNE_KEY]).toEqual([2, 2]);
    expect(a.s['4-32']).toEqual([2, 2]);
    expect(a.i[String(RABADON)]).toEqual([2, 2]);
    expect(a.b[String(SORC_SHOES)]).toEqual([2, 2]);
    expect(aggs.get(aggKey(450, '16.21', 6))!.w).toBe(0); // 6번 챔피언은 패배 팀
  });

  it('항목이 max를 넘으면 판수 1 이하를 지운다', () => {
    const a = emptyAgg();
    for (let i = 0; i < 5; i++) a.r[`k${i}`] = [1, 0];
    a.r.keep = [3, 1];
    pruneAgg(a, 4);
    expect(Object.keys(a.r)).toEqual(['keep']);
    const b = emptyAgg();
    b.r.x = [1, 0];
    pruneAgg(b, 4);
    expect(Object.keys(b.r)).toEqual(['x']); // max 이하면 그대로
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run test/aggregate.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: `lib/aram/aggregate.ts` 작성**

Task 1 스파이크에서 증강 필드 이름이 다르게 나왔다면 `AUGMENT_FIELD` 정규식을 그 이름에 맞춘다.

```ts
// 경기 데이터 → 챔피언별 표본 → 누적값. Redis와 분리된 순수 함수만 둡니다.
import type { ItemClasses } from './items';

export type Queue = 450 | 2400;
export const ARAM_QUEUES: readonly Queue[] = [2400, 450];
export type Pair = [number, number]; // [판수, 승수]

export interface ChampAgg {
  g: number;
  w: number;
  r: Record<string, Pair>; // 룬 조합
  s: Record<string, Pair>; // 스펠 조합
  i: Record<string, Pair>; // 완성 아이템
  b: Record<string, Pair>; // 신발
  a: Record<string, Pair>; // 증강 (Mayhem)
}
export const AGG_CATS = ['r', 's', 'i', 'b', 'a'] as const;

export interface Sample {
  queue: Queue;
  patch: string;
  championId: number;
  win: boolean;
  rune: string | null;
  spell: string;
  items: number[];
  boots: number | null;
  augments: number[];
}

const MIN_GAME_SECONDS = 300;
const AUGMENT_FIELD = /^playerAugment\d+$/;
const ITEM_SLOTS = ['item0', 'item1', 'item2', 'item3', 'item4', 'item5'] as const;

export function emptyAgg(): ChampAgg {
  return { g: 0, w: 0, r: {}, s: {}, i: {}, b: {}, a: {} };
}

export function aggKey(queue: Queue, patch: string, championId: number) {
  return `aram:agg:${queue}:${patch}:${championId}`;
}

export function patchOf(gameVersion: string) {
  const [major, minor] = gameVersion.split('.');
  return `${major}.${minor}`;
}

export function runeKey(perks: any): string | null {
  const primary = perks?.styles?.find((s: any) => s.description === 'primaryStyle');
  const sub = perks?.styles?.find((s: any) => s.description === 'subStyle');
  const stat = perks?.statPerks;
  if (!primary || !sub || !stat || primary.selections?.length !== 4 || sub.selections?.length !== 2) return null;
  if (stat.offense == null || stat.flex == null || stat.defense == null) return null;
  const p = primary.selections.map((x: any) => x.perk).join('-');
  const s = sub.selections.map((x: any) => x.perk).join('-');
  return `${primary.style}:${p}:${sub.style}:${s}:${stat.offense}-${stat.flex}-${stat.defense}`;
}

export function spellKey(a: number, b: number) {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

export function augmentsOf(participant: Record<string, unknown>): number[] {
  return Object.keys(participant)
    .filter((k) => AUGMENT_FIELD.test(k))
    .map((k) => Number(participant[k]))
    .filter((v) => v > 0);
}

export function extractSamples(match: any, classes: ItemClasses): Sample[] {
  const info = match?.info;
  if (!info) return [];
  const queue = info.queueId;
  if (queue !== 450 && queue !== 2400) return [];
  if (info.gameDuration < MIN_GAME_SECONDS) return [];
  const patch = patchOf(String(info.gameVersion));

  return (info.participants as any[])
    .filter((p) => !p.gameEndedInEarlySurrender)
    .map((p) => {
      const slots: number[] = ITEM_SLOTS.map((k) => Number(p[k] ?? 0));
      return {
        queue,
        patch,
        championId: p.championId,
        win: Boolean(p.win),
        rune: runeKey(p.perks),
        spell: spellKey(p.summoner1Id, p.summoner2Id),
        items: [...new Set(slots.filter((id) => classes.completed.has(id)))],
        boots: slots.find((id) => classes.boots.has(id)) ?? null,
        augments: augmentsOf(p),
      };
    });
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
  }
}

// JSON 크기를 작게 유지하려고, 항목이 max개를 넘으면 한 판만 나온 항목을 지웁니다.
export function pruneAgg(agg: ChampAgg, max = 60) {
  for (const cat of AGG_CATS) {
    const rec = agg[cat];
    if (Object.keys(rec).length <= max) continue;
    for (const [k, [g]] of Object.entries(rec)) if (g <= 1) delete rec[k];
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run test/aggregate.test.ts`
Expected: PASS (픽스처가 있으면 해당 테스트도 PASS, 없으면 skip)

- [ ] **Step 5: Commit**

```bash
git add lib/aram/aggregate.ts test/aggregate.test.ts
git commit -m "feat: 칼바람 경기 표본 추출과 챔피언별 누적 집계

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: 응답 타입과 빌드 계산

**Files:**
- Create: `lib/aram/types.ts`
- Create: `lib/aram/build.ts`
- Test: `test/build.test.ts`

**Interfaces:**
- Consumes: `ChampAgg`, `Pair`, `Queue`, `AGG_CATS`, `emptyAgg` (Task 5)
- Produces:
  - `interface BuildStat { key: string; games: number; winRate: number; pickRate: number }`
  - `interface AramBuildResponse` (스펙 4.4 그대로)
  - `LOW_SAMPLE = 30`, `MIN_ITEM_GAMES = 5`
  - `mergeAggs(a: ChampAgg, b: ChampAgg): ChampAgg`
  - `topStats(rec: Record<string, Pair>, total: number, limit: number): BuildStat[]`
  - `computeBuild(input: { championId: number; queue: Queue; patch: string | null; prevPatch: string | null; current: ChampAgg | null; prev: ChampAgg | null }): AramBuildResponse`

- [ ] **Step 1: `lib/aram/types.ts` 작성**

```ts
// GET /api/aram/build 응답 타입. 데스크톱 앱(lol-tracker-desktop)이 이 파일을 그대로 복사해 씁니다.
export interface BuildStat {
  key: string; // 룬 조합 문자열, "작은ID-큰ID" 스펠, 아이템/증강 ID
  games: number;
  winRate: number; // 0~1, 소수 넷째 자리
  pickRate: number; // 0~1, 소수 넷째 자리
}

export interface AramBuildResponse {
  championId: number;
  queue: 450 | 2400;
  patch: string; // 데이터가 전혀 없으면 ''
  mergedPatches: string[];
  sampleSize: number;
  lowSample: boolean;
  runes: BuildStat[];
  spells: BuildStat[];
  coreItems: BuildStat[];
  boots: BuildStat[];
  augments: BuildStat[];
}
```

- [ ] **Step 2: 실패하는 테스트 `test/build.test.ts` 작성**

```ts
import { describe, expect, it } from 'vitest';
import { emptyAgg, type ChampAgg } from '@/lib/aram/aggregate';
import { computeBuild, mergeAggs, topStats } from '@/lib/aram/build';

function agg(g: number, w: number, extra: Partial<ChampAgg> = {}): ChampAgg {
  return { ...emptyAgg(), g, w, ...extra };
}

describe('topStats', () => {
  it('5판 미만 제외, 판수 내림차순, 비율 계산', () => {
    const out = topStats({ a: [10, 6], b: [4, 4], c: [20, 5] }, 40, 3);
    expect(out).toEqual([
      { key: 'c', games: 20, winRate: 0.25, pickRate: 0.5 },
      { key: 'a', games: 10, winRate: 0.6, pickRate: 0.25 },
    ]);
  });
  it('판수가 같으면 승률 높은 순', () => {
    expect(topStats({ x: [10, 3], y: [10, 7] }, 20, 2).map((s) => s.key)).toEqual(['y', 'x']);
  });
});

describe('mergeAggs', () => {
  it('항목별로 더한다', () => {
    const m = mergeAggs(agg(10, 5, { r: { k: [10, 5] } }), agg(4, 1, { r: { k: [2, 1], j: [2, 0] } }));
    expect(m.g).toBe(14);
    expect(m.w).toBe(6);
    expect(m.r).toEqual({ k: [12, 6], j: [2, 0] });
  });
});

describe('computeBuild', () => {
  const base = { championId: 1, queue: 450 as const, patch: '16.21', prevPatch: '16.20' };

  it('데이터가 없으면 sampleSize 0', () => {
    const b = computeBuild({ ...base, patch: null, prevPatch: null, current: null, prev: null });
    expect(b).toMatchObject({ patch: '', sampleSize: 0, lowSample: true, runes: [], augments: [] });
  });

  it('현재 패치가 30판 미만이면 이전 패치와 합친다', () => {
    const b = computeBuild({ ...base, current: agg(10, 5, { s: { '4-32': [10, 5] } }), prev: agg(50, 25, { s: { '4-32': [50, 25] } }) });
    expect(b.sampleSize).toBe(60);
    expect(b.mergedPatches).toEqual(['16.20']);
    expect(b.lowSample).toBe(false);
    expect(b.spells[0]).toEqual({ key: '4-32', games: 60, winRate: 0.5, pickRate: 1 });
  });

  it('이전 패치가 없으면 합치지 않고 lowSample', () => {
    const b = computeBuild({ ...base, prevPatch: null, current: agg(10, 5), prev: null });
    expect(b).toMatchObject({ sampleSize: 10, lowSample: true, mergedPatches: [] });
  });

  it('30판 이상이면 이전 패치를 쓰지 않는다', () => {
    const b = computeBuild({ ...base, current: agg(30, 15), prev: agg(100, 50) });
    expect(b).toMatchObject({ sampleSize: 30, mergedPatches: [] });
  });

  it('증강은 Mayhem(2400)에서만', () => {
    const a = { '7': [40, 20] as [number, number] };
    expect(computeBuild({ ...base, current: agg(40, 20, { a }), prev: null }).augments).toEqual([]);
    expect(computeBuild({ ...base, queue: 2400, current: agg(40, 20, { a }), prev: null }).augments).toHaveLength(1);
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `npx vitest run test/build.test.ts`
Expected: FAIL — `@/lib/aram/build` 없음

- [ ] **Step 4: `lib/aram/build.ts` 작성**

```ts
// 누적값 → 추천 빌드 응답
import { AGG_CATS, emptyAgg, type ChampAgg, type Pair, type Queue } from './aggregate';
import type { AramBuildResponse, BuildStat } from './types';

export const LOW_SAMPLE = 30;
export const MIN_ITEM_GAMES = 5;

const round4 = (x: number) => Math.round(x * 10000) / 10000;

export function mergeAggs(a: ChampAgg, b: ChampAgg): ChampAgg {
  const out = emptyAgg();
  out.g = a.g + b.g;
  out.w = a.w + b.w;
  for (const cat of AGG_CATS) {
    for (const src of [a, b]) {
      for (const [k, [g, w]] of Object.entries(src[cat])) {
        const cur = out[cat][k] ?? [0, 0];
        out[cat][k] = [cur[0] + g, cur[1] + w];
      }
    }
  }
  return out;
}

export function topStats(rec: Record<string, Pair>, total: number, limit: number): BuildStat[] {
  return Object.entries(rec)
    .filter(([, [g]]) => g >= MIN_ITEM_GAMES)
    .sort(([, [ga, wa]], [, [gb, wb]]) => gb - ga || wb / gb - wa / ga)
    .slice(0, limit)
    .map(([key, [g, w]]) => ({
      key,
      games: g,
      winRate: round4(w / g),
      pickRate: total > 0 ? round4(g / total) : 0,
    }));
}

export function computeBuild(input: {
  championId: number;
  queue: Queue;
  patch: string | null;
  prevPatch: string | null;
  current: ChampAgg | null;
  prev: ChampAgg | null;
}): AramBuildResponse {
  let agg = input.current ?? emptyAgg();
  const mergedPatches: string[] = [];
  if (agg.g < LOW_SAMPLE && input.prev && input.prevPatch && input.prev.g > 0) {
    agg = mergeAggs(agg, input.prev);
    mergedPatches.push(input.prevPatch);
  }
  return {
    championId: input.championId,
    queue: input.queue,
    patch: input.patch ?? '',
    mergedPatches,
    sampleSize: agg.g,
    lowSample: agg.g < LOW_SAMPLE,
    runes: topStats(agg.r, agg.g, 3),
    spells: topStats(agg.s, agg.g, 2),
    coreItems: topStats(agg.i, agg.g, 6),
    boots: topStats(agg.b, agg.g, 2),
    augments: input.queue === 2400 ? topStats(agg.a, agg.g, 10) : [],
  };
}
```

- [ ] **Step 5: 통과 확인**

Run: `npx vitest run test/build.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 6: Commit**

```bash
git add lib/aram/types.ts lib/aram/build.ts test/build.test.ts
git commit -m "feat: 칼바람 추천 빌드 계산과 응답 타입

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Redis 저장소 함수

**Files:**
- Create: `lib/aram/store.ts`
- Test: `test/store.test.ts`

**Interfaces:**
- Consumes: `RedisLike` (Task 2), `ChampAgg` (Task 5), `FakeRedis`
- Produces:
  - 상수 `QUEUE_KEY = 'aram:queue:puuid'`, `QUEUE_MAX = 5000`, `SEEN_MATCH_KEY = 'aram:seen:match'`, `PATCHES_KEY = 'aram:patches'`, `LOCK_KEY = 'aram:lock'`, `crawledKey(puuid)`
  - `loadAggs(r, keys: string[]): Promise<Map<string, ChampAgg>>` (없는 키는 맵에 없음)
  - `saveAggs(r, aggs: Map<string, ChampAgg>): Promise<void>`
  - `patchScore(patch: string): number`
  - `registerPatches(r, patches: string[]): Promise<void>`
  - `latestPatches(r, n: number): Promise<string[]>` (최신순)
  - `nextPuuid(r, tries?: number): Promise<string | null>`
  - `requeue(r, puuid: string): Promise<void>`
  - `enqueuePuuids(r, puuids: string[]): Promise<void>`
  - `filterUnseenMatches(r, ids: string[]): Promise<string[]>`
  - `markMatchesSeen(r, ids: string[]): Promise<void>`
  - `tryLock(r, ttlSec?: number): Promise<boolean>`, `unlock(r): Promise<void>`

- [ ] **Step 1: 실패하는 테스트 `test/store.test.ts` 작성**

```ts
import { describe, expect, it } from 'vitest';
import { emptyAgg } from '@/lib/aram/aggregate';
import {
  QUEUE_KEY, QUEUE_MAX, crawledKey, enqueuePuuids, filterUnseenMatches, latestPatches, loadAggs, markMatchesSeen,
  nextPuuid, patchScore, registerPatches, requeue, saveAggs, tryLock, unlock,
} from '@/lib/aram/store';
import { FakeRedis } from '@/test/fakeRedis';

describe('store', () => {
  it('누적값은 MSET 한 번으로 쓰고 MGET 한 번으로 읽는다', async () => {
    const r = new FakeRedis();
    const a = { ...emptyAgg(), g: 3, w: 1 };
    await saveAggs(r, new Map([['k1', a]]));
    const got = await loadAggs(r, ['k1', 'k2']);
    expect(got.get('k1')).toEqual(a);
    expect(got.has('k2')).toBe(false);
    expect(r.log.map((c) => c[0])).toEqual(['MSET', 'MGET']);
  });

  it('빈 입력이면 Redis를 부르지 않는다', async () => {
    const r = new FakeRedis();
    await saveAggs(r, new Map());
    await loadAggs(r, []);
    await registerPatches(r, []);
    await enqueuePuuids(r, []);
    await markMatchesSeen(r, []);
    expect(await filterUnseenMatches(r, [])).toEqual([]);
    expect(r.log).toEqual([]);
  });

  it('패치는 숫자 크기순 (16.9 < 16.10)', async () => {
    expect(patchScore('16.10')).toBeGreaterThan(patchScore('16.9'));
    const r = new FakeRedis();
    await registerPatches(r, ['16.9', '16.10']);
    await registerPatches(r, ['15.24']);
    expect(await latestPatches(r, 2)).toEqual(['16.10', '16.9']);
  });

  it('24시간 안에 수집한 유저는 건너뛴다', async () => {
    const r = new FakeRedis();
    await enqueuePuuids(r, ['a', 'b', 'a']);
    expect(await nextPuuid(r)).toBe('a');
    await enqueuePuuids(r, ['a']);
    expect(await nextPuuid(r)).toBe('b');
    expect(await nextPuuid(r)).toBeNull(); // 'a'는 최근 수집함 → 건너뛰고 대기열이 비었음
  });

  it('requeue는 최근 수집 표시를 지우고 맨 앞에 넣는다', async () => {
    const r = new FakeRedis();
    await enqueuePuuids(r, ['a', 'b']);
    const p = await nextPuuid(r);
    await requeue(r, p!);
    expect(r.strings.has(crawledKey('a'))).toBe(false);
    expect(await nextPuuid(r)).toBe('a');
  });

  it('대기열은 최대 길이를 넘지 않는다', async () => {
    const r = new FakeRedis();
    await enqueuePuuids(r, Array.from({ length: QUEUE_MAX + 10 }, (_, i) => `p${i}`));
    expect(r.lists.get(QUEUE_KEY)).toHaveLength(QUEUE_MAX);
  });

  it('처리한 경기 걸러내기', async () => {
    const r = new FakeRedis();
    await markMatchesSeen(r, ['KR_1']);
    expect(await filterUnseenMatches(r, ['KR_1', 'KR_2'])).toEqual(['KR_2']);
  });

  it('잠금', async () => {
    const r = new FakeRedis();
    expect(await tryLock(r)).toBe(true);
    expect(await tryLock(r)).toBe(false);
    await unlock(r);
    expect(await tryLock(r)).toBe(true);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run test/store.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: `lib/aram/store.ts` 작성**

```ts
// 칼바람 통계가 쓰는 Redis 키 조작을 모아둡니다. 명령 수가 곧 요금이라 묶어서 보냅니다.
import type { ChampAgg } from './aggregate';
import type { RedisLike } from './redis';

export const QUEUE_KEY = 'aram:queue:puuid';
export const QUEUE_MAX = 5000;
export const SEEN_MATCH_KEY = 'aram:seen:match';
export const PATCHES_KEY = 'aram:patches';
export const LOCK_KEY = 'aram:lock';
const CRAWLED_TTL_SEC = 86_400;

export const crawledKey = (puuid: string) => `aram:crawled:${puuid}`;

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

// 대기열에서 유저를 꺼냅니다. 24시간 안에 이미 수집한 유저는 건너뜁니다 (최대 tries번 시도).
export async function nextPuuid(r: RedisLike, tries = 3): Promise<string | null> {
  for (let i = 0; i < tries; i++) {
    const puuid = await r.cmd<string | null>(['LPOP', QUEUE_KEY]);
    if (!puuid) return null;
    const ok = await r.cmd<string | null>(['SET', crawledKey(puuid), '1', 'NX', 'EX', CRAWLED_TTL_SEC]);
    if (ok === 'OK') return puuid;
  }
  return null;
}

export async function requeue(r: RedisLike, puuid: string): Promise<void> {
  await r.pipe([['DEL', crawledKey(puuid)], ['LPUSH', QUEUE_KEY, puuid]]);
}

export async function enqueuePuuids(r: RedisLike, puuids: string[]): Promise<void> {
  const unique = [...new Set(puuids)];
  if (unique.length === 0) return;
  await r.pipe([['RPUSH', QUEUE_KEY, ...unique], ['LTRIM', QUEUE_KEY, 0, QUEUE_MAX - 1]]);
}

export async function filterUnseenMatches(r: RedisLike, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const flags = await r.cmd<number[]>(['SMISMEMBER', SEEN_MATCH_KEY, ...ids]);
  return ids.filter((_, i) => !flags[i]);
}

export async function markMatchesSeen(r: RedisLike, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await r.cmd(['SADD', SEEN_MATCH_KEY, ...ids]);
}

export async function tryLock(r: RedisLike, ttlSec = 60): Promise<boolean> {
  return (await r.cmd(['SET', LOCK_KEY, '1', 'NX', 'EX', ttlSec])) === 'OK';
}

export async function unlock(r: RedisLike): Promise<void> {
  await r.cmd(['DEL', LOCK_KEY]);
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run test/store.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/aram/store.ts test/store.test.ts
git commit -m "feat: 칼바람 통계 Redis 저장소 함수 (누적값·패치·대기열·잠금)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: 수집 단계 `collectStep`

**Files:**
- Create: `lib/aram/collect.ts`
- Test: `test/collect.test.ts`

**Interfaces:**
- Consumes: Task 5 (`ARAM_QUEUES`, `aggKey`, `applySamples`, `extractSamples`, `pruneAgg`, `Queue`), Task 4 (`ItemClasses`), Task 7 (store 함수 전부), Task 3 (`RiotApiError`는 `@/lib/riot`)
- Produces:
  - `interface CollectDeps { redis: RedisLike; acquire(n: number): Promise<boolean>; getMatchIds(puuid: string, queue: Queue): Promise<string[]>; getMatch(matchId: string): Promise<any>; getItemClasses(): Promise<ItemClasses>; timeLeftMs?(): number }`
  - `type CollectStatus = 'locked' | 'empty-queue' | 'rate-limited' | 'done' | 'error'`
  - `interface CollectResult { status: CollectStatus; matches: number }`
  - `collectStep(deps: CollectDeps, opts?: { maxMatches?: number }): Promise<CollectResult>`

- [ ] **Step 1: 실패하는 테스트 `test/collect.test.ts` 작성**

`@/lib/riot`은 `RiotApiError`만 쓰지만 모듈을 불러오면 rateLimit/redis도 같이 로드된다 — 네트워크 호출은 없으므로 모킹하지 않는다.

```ts
import { describe, expect, it, vi } from 'vitest';
import { aggKey } from '@/lib/aram/aggregate';
import { collectStep, type CollectDeps } from '@/lib/aram/collect';
import { LOCK_KEY, QUEUE_KEY, SEEN_MATCH_KEY, crawledKey, enqueuePuuids, loadAggs, markMatchesSeen } from '@/lib/aram/store';
import { RiotApiError } from '@/lib/riot';
import { FakeRedis } from '@/test/fakeRedis';
import { CLASSES, makeMatch } from '@/test/fixtures/makeMatch';

function setup(over: Partial<CollectDeps> = {}) {
  const redis = new FakeRedis();
  const matches: Record<string, any> = {
    KR_1: makeMatch({ matchId: 'KR_1', queueId: 450 }),
    KR_2: makeMatch({ matchId: 'KR_2', queueId: 2400 }),
  };
  const deps: CollectDeps = {
    redis,
    acquire: vi.fn(async () => true),
    getMatchIds: vi.fn(async (_p: string, q: number) => (q === 450 ? ['KR_1'] : ['KR_2'])),
    getMatch: vi.fn(async (id: string) => matches[id]),
    getItemClasses: async () => CLASSES,
    ...over,
  };
  return { redis, deps };
}

describe('collectStep', () => {
  it('잠겨 있으면 아무것도 안 한다', async () => {
    const { redis, deps } = setup();
    await redis.cmd(['SET', LOCK_KEY, '1']);
    expect(await collectStep(deps)).toEqual({ status: 'locked', matches: 0 });
    expect(deps.getMatchIds).not.toHaveBeenCalled();
  });

  it('대기열이 비면 empty-queue', async () => {
    const { deps } = setup();
    expect(await collectStep(deps)).toEqual({ status: 'empty-queue', matches: 0 });
  });

  it('경기를 가져와 누적하고, 처리 기록·대기열·잠금을 정리한다', async () => {
    const { redis, deps } = setup();
    await enqueuePuuids(redis, ['p0']);
    expect(await collectStep(deps)).toEqual({ status: 'done', matches: 2 });
    expect(deps.acquire).toHaveBeenCalledWith(12); // 큐 2개 + 경기 10개 예약
    const aggs = await loadAggs(redis, [aggKey(450, '16.21', 1), aggKey(2400, '16.21', 1)]);
    expect(aggs.get(aggKey(450, '16.21', 1))!.g).toBe(1);
    expect(aggs.get(aggKey(2400, '16.21', 1))!.g).toBe(1);
    expect(redis.sets.get(SEEN_MATCH_KEY)).toEqual(new Set(['KR_1', 'KR_2']));
    expect(redis.lists.get(QUEUE_KEY)).toEqual(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9']);
    expect(redis.strings.has(LOCK_KEY)).toBe(false);
  });

  it('이미 처리한 경기는 다시 가져오지 않는다', async () => {
    const { redis, deps } = setup();
    await enqueuePuuids(redis, ['p0']);
    await markMatchesSeen(redis, ['KR_1']);
    expect(await collectStep(deps)).toEqual({ status: 'done', matches: 1 });
    expect(deps.getMatch).toHaveBeenCalledTimes(1);
    expect(deps.getMatch).toHaveBeenCalledWith('KR_2');
  });

  it('도중에 429가 나면 그때까지 가져온 경기만 저장하고 rate-limited', async () => {
    const { redis, deps } = setup({
      getMatch: vi.fn(async (id: string) => {
        if (id === 'KR_1') throw new RiotApiError('요청이 너무 많습니다.', 429);
        return makeMatch({ matchId: id, queueId: 2400 });
      }),
    });
    await enqueuePuuids(redis, ['p0']);
    // ARAM_QUEUES 순서가 [2400, 450]이므로 KR_2를 먼저 가져오고 KR_1에서 429
    expect(await collectStep(deps)).toEqual({ status: 'rate-limited', matches: 1 });
    expect(redis.sets.get(SEEN_MATCH_KEY)).toEqual(new Set(['KR_2']));
  });

  it('404 경기는 건너뛰고 처리한 것으로 기록', async () => {
    const { redis, deps } = setup({
      getMatch: vi.fn(async (id: string) => {
        if (id === 'KR_2') throw new RiotApiError('찾을 수 없습니다.', 404);
        return makeMatch({ matchId: id });
      }),
    });
    await enqueuePuuids(redis, ['p0']);
    expect(await collectStep(deps)).toEqual({ status: 'done', matches: 1 });
    expect(redis.sets.get(SEEN_MATCH_KEY)).toEqual(new Set(['KR_1', 'KR_2']));
  });

  it('한도 예약이 거부되면 유저를 대기열 앞으로 되돌린다', async () => {
    const { redis, deps } = setup({ acquire: vi.fn(async () => false) });
    await enqueuePuuids(redis, ['p0', 'p1']);
    expect(await collectStep(deps)).toEqual({ status: 'rate-limited', matches: 0 });
    expect(redis.lists.get(QUEUE_KEY)).toEqual(['p0', 'p1']);
    expect(redis.strings.has(crawledKey('p0'))).toBe(false);
    expect(deps.getMatchIds).not.toHaveBeenCalled();
  });

  it('남은 시간이 5초 미만이면 새 경기를 가져오지 않는다', async () => {
    const { redis, deps } = setup({ timeLeftMs: () => 4000 });
    await enqueuePuuids(redis, ['p0']);
    expect(await collectStep(deps)).toEqual({ status: 'done', matches: 0 });
    expect(deps.getMatch).not.toHaveBeenCalled();
  });

  it('예외가 나도 잠금 해제', async () => {
    const { redis, deps } = setup({ getMatchIds: vi.fn(async () => { throw new Error('네트워크'); }) });
    await enqueuePuuids(redis, ['p0']);
    expect(await collectStep(deps)).toEqual({ status: 'error', matches: 0 });
    expect(redis.strings.has(LOCK_KEY)).toBe(false);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run test/collect.test.ts`
Expected: FAIL — `@/lib/aram/collect` 없음

- [ ] **Step 3: `lib/aram/collect.ts` 작성**

```ts
// 온디맨드 수집 1회: 대기열의 유저 1명 → 칼바람/Mayhem 경기 최대 maxMatches개 → 챔피언별 누적.
import { RiotApiError } from '@/lib/riot';
import { ARAM_QUEUES, aggKey, applySamples, extractSamples, pruneAgg, type Queue } from './aggregate';
import type { ItemClasses } from './items';
import type { RedisLike } from './redis';
import {
  enqueuePuuids, filterUnseenMatches, loadAggs, markMatchesSeen, nextPuuid, registerPatches, requeue, saveAggs,
  tryLock, unlock,
} from './store';

export interface CollectDeps {
  redis: RedisLike;
  acquire(n: number): Promise<boolean>;
  getMatchIds(puuid: string, queue: Queue): Promise<string[]>;
  getMatch(matchId: string): Promise<any>;
  getItemClasses(): Promise<ItemClasses>;
  timeLeftMs?(): number;
}

export type CollectStatus = 'locked' | 'empty-queue' | 'rate-limited' | 'done' | 'error';
export interface CollectResult {
  status: CollectStatus;
  matches: number;
}

const MIN_TIME_LEFT_MS = 5000;

function statusOf(err: unknown): CollectStatus {
  return err instanceof RiotApiError && err.status === 429 ? 'rate-limited' : 'error';
}

export async function collectStep(deps: CollectDeps, opts: { maxMatches?: number } = {}): Promise<CollectResult> {
  const maxMatches = opts.maxMatches ?? 10;
  const { redis } = deps;
  const timeLeft = deps.timeLeftMs ?? (() => Infinity);

  if (!(await tryLock(redis))) return { status: 'locked', matches: 0 };
  try {
    const puuid = await nextPuuid(redis);
    if (!puuid) return { status: 'empty-queue', matches: 0 };

    if (!(await deps.acquire(ARAM_QUEUES.length + maxMatches))) {
      await requeue(redis, puuid);
      return { status: 'rate-limited', matches: 0 };
    }

    const ids: string[] = [];
    for (const queue of ARAM_QUEUES) ids.push(...(await deps.getMatchIds(puuid, queue)));
    const unseen = (await filterUnseenMatches(redis, ids)).slice(0, maxMatches);

    const matches: any[] = [];
    const handled: string[] = [];
    let stopped: CollectStatus | null = null;
    for (const id of unseen) {
      if (timeLeft() < MIN_TIME_LEFT_MS) break;
      try {
        matches.push(await deps.getMatch(id));
        handled.push(id);
      } catch (err) {
        if (err instanceof RiotApiError && err.status === 404) {
          handled.push(id);
          continue;
        }
        stopped = statusOf(err);
        console.error('[collect] 경기 조회 중단', id, err);
        break;
      }
    }

    if (matches.length > 0) {
      const classes = await deps.getItemClasses();
      const samples = matches.flatMap((m) => extractSamples(m, classes));
      const keys = [...new Set(samples.map((s) => aggKey(s.queue, s.patch, s.championId)))];
      const aggs = await loadAggs(redis, keys);
      applySamples(aggs, samples);
      for (const agg of aggs.values()) pruneAgg(agg);
      await saveAggs(redis, aggs);
      await registerPatches(redis, [...new Set(samples.map((s) => s.patch))]);
      const others = matches.flatMap((m) => (m.metadata?.participants ?? []) as string[]).filter((p) => p !== puuid);
      await enqueuePuuids(redis, others);
    }
    // 누적값을 저장한 뒤에 기록합니다 (저장 전에 실패하면 다음에 다시 시도되도록).
    await markMatchesSeen(redis, handled);

    return { status: stopped ?? 'done', matches: matches.length };
  } catch (err) {
    console.error('[collect] 실패', err);
    return { status: statusOf(err), matches: 0 };
  } finally {
    await unlock(redis).catch(() => {});
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run test/collect.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/aram/collect.ts test/collect.test.ts
git commit -m "feat: 칼바람 경기 온디맨드 수집 단계 collectStep

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: 서비스 연결과 `GET /api/aram/build`

**Files:**
- Modify: `package.json` (의존성 `@vercel/functions`)
- Create: `lib/aram/service.ts`
- Create: `pages/api/aram/build.ts`
- Test: `test/service.test.ts`, `test/api-build.test.ts`

**Interfaces:**
- Consumes: Task 2 (`upstash`, `RedisLike`), Task 3 (`acquire`, `riotRequest`, `getLatestDdragonVersion`), Task 4 (`getItemClasses`), Task 5 (`aggKey`, `Queue`), Task 6 (`computeBuild`, `AramBuildResponse`), Task 7 (`loadAggs`, `latestPatches`), Task 8 (`collectStep`, `CollectDeps`, `CollectResult`)
- Produces:
  - `getAramBuild(championId: number, queue: Queue, redis?: RedisLike): Promise<AramBuildResponse>`
  - `collectDeps(redis?: RedisLike): CollectDeps`
  - `runCollectStep(): Promise<CollectResult>`
  - HTTP `GET /api/aram/build?champion={양의 정수}&queue={450|2400}` → 200 `AramBuildResponse` (헤더 `Cache-Control: s-maxage=300, stale-while-revalidate=600`) / 400 `{ error }` / 405 / 503 `{ error }`

- [ ] **Step 1: 의존성 설치**

Run: `npm install @vercel/functions`
Expected: 설치 완료. `node -e "console.log(Object.keys(require('@vercel/functions')))"` 출력에 `waitUntil`, `getDeadline`이 있어야 한다. `getDeadline`이 없으면 `npm install @vercel/functions@latest`로 다시 설치한다.

- [ ] **Step 2: 실패하는 테스트 `test/service.test.ts` 작성**

```ts
import { describe, expect, it } from 'vitest';
import { aggKey, emptyAgg } from '@/lib/aram/aggregate';
import { getAramBuild } from '@/lib/aram/service';
import { registerPatches, saveAggs } from '@/lib/aram/store';
import { FakeRedis } from '@/test/fakeRedis';

describe('getAramBuild', () => {
  it('저장된 패치가 없으면 빈 응답', async () => {
    const b = await getAramBuild(1, 450, new FakeRedis());
    expect(b).toMatchObject({ championId: 1, queue: 450, patch: '', sampleSize: 0 });
  });

  it('최신 패치와 이전 패치를 읽어 합친다', async () => {
    const r = new FakeRedis();
    await registerPatches(r, ['16.20', '16.21']);
    await saveAggs(r, new Map([
      [aggKey(450, '16.21', 1), { ...emptyAgg(), g: 5, w: 3 }],
      [aggKey(450, '16.20', 1), { ...emptyAgg(), g: 40, w: 20 }],
    ]));
    const b = await getAramBuild(1, 450, r);
    expect(b).toMatchObject({ patch: '16.21', mergedPatches: ['16.20'], sampleSize: 45 });
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `npx vitest run test/service.test.ts`
Expected: FAIL — `@/lib/aram/service` 없음

- [ ] **Step 4: `lib/aram/service.ts` 작성**

```ts
// 실제 의존성(Upstash, Riot API, Data Dragon, Vercel 시간 제한)을 연결하는 곳입니다.
import { getDeadline } from '@vercel/functions';
import { acquire } from '@/lib/rateLimit';
import { getLatestDdragonVersion, riotRequest } from '@/lib/riot';
import { aggKey, type Queue } from './aggregate';
import { computeBuild } from './build';
import { collectStep, type CollectDeps, type CollectResult } from './collect';
import { getItemClasses } from './items';
import { upstash, type RedisLike } from './redis';
import { latestPatches, loadAggs } from './store';
import type { AramBuildResponse } from './types';

const ASIA = 'https://asia.api.riotgames.com'; // KR 경기·계정 API 리전

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

export function collectDeps(redis: RedisLike = upstash): CollectDeps {
  return {
    redis,
    acquire: (n) => acquire(redis, 'collect', n),
    getMatchIds: (puuid, queue) =>
      riotRequest<string[]>(
        `${ASIA}/lol/match/v5/matches/by-puuid/${encodeURIComponent(puuid)}/ids?queue=${queue}&start=0&count=20`,
      ),
    getMatch: (matchId) => riotRequest<any>(`${ASIA}/lol/match/v5/matches/${encodeURIComponent(matchId)}`),
    getItemClasses: async () => getItemClasses(await getLatestDdragonVersion()),
    timeLeftMs: () => {
      const deadline = getDeadline();
      return deadline ? deadline.getTime() - Date.now() : Infinity;
    },
  };
}

export function runCollectStep(): Promise<CollectResult> {
  return collectStep(collectDeps());
}
```

- [ ] **Step 5: 통과 확인**

Run: `npx vitest run test/service.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 6: 실패하는 테스트 `test/api-build.test.ts` 작성**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@vercel/functions', () => ({ waitUntil: vi.fn() }));
vi.mock('@/lib/aram/service', () => ({
  getAramBuild: vi.fn(),
  runCollectStep: vi.fn(async () => ({ status: 'done', matches: 0 })),
}));

import { waitUntil } from '@vercel/functions';
import { getAramBuild, runCollectStep } from '@/lib/aram/service';
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
  beforeEach(() => {
    vi.mocked(getAramBuild).mockReset();
    vi.mocked(waitUntil).mockClear();
    vi.mocked(runCollectStep).mockClear();
  });

  it.each([
    [{ champion: 'abc', queue: '450' }],
    [{ champion: '0', queue: '450' }],
    [{ champion: '1', queue: '420' }],
    [{ queue: '450' }],
  ])('잘못된 파라미터 %o 는 400이고 Redis를 건드리지 않는다', async (q) => {
    const res = await call(q as Record<string, string>);
    expect(res.statusCode).toBe(400);
    expect(getAramBuild).not.toHaveBeenCalled();
    expect(waitUntil).not.toHaveBeenCalled();
  });

  it('GET이 아니면 405', async () => {
    expect((await call({ champion: '1', queue: '450' }, 'POST')).statusCode).toBe(405);
  });

  it('성공하면 200 + 캐시 헤더 + 응답 후 수집 1회', async () => {
    vi.mocked(getAramBuild).mockResolvedValue({ championId: 1 } as any);
    const res = await call({ champion: '1', queue: '2400' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ championId: 1 });
    expect(res.headers['Cache-Control']).toBe('s-maxage=300, stale-while-revalidate=600');
    expect(getAramBuild).toHaveBeenCalledWith(1, 2400);
    expect(waitUntil).toHaveBeenCalledTimes(1);
    expect(runCollectStep).toHaveBeenCalledTimes(1);
  });

  it('Redis 오류면 503, 수집하지 않는다', async () => {
    vi.mocked(getAramBuild).mockRejectedValue(new Error('Upstash 명령 실패 (500)'));
    const res = await call({ champion: '1', queue: '450' });
    expect(res.statusCode).toBe(503);
    expect(waitUntil).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 7: 실패 확인**

Run: `npx vitest run test/api-build.test.ts`
Expected: FAIL — `@/pages/api/aram/build` 없음

- [ ] **Step 8: `pages/api/aram/build.ts` 작성**

```ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { waitUntil } from '@vercel/functions';
import { getAramBuild, runCollectStep } from '@/lib/aram/service';
import type { Queue } from '@/lib/aram/aggregate';

const QUEUES: readonly Queue[] = [450, 2400];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET'].join(', '));
    return res.status(405).json({ error: '허용되지 않는 메서드입니다.' });
  }

  const championId = Number(req.query.champion);
  const queue = Number(req.query.queue) as Queue;
  if (!Number.isInteger(championId) || championId <= 0 || !QUEUES.includes(queue)) {
    return res.status(400).json({ error: '잘못된 요청입니다. champion(챔피언 ID)과 queue(450 또는 2400)를 확인하세요.' });
  }

  try {
    const build = await getAramBuild(championId, queue);
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.status(200).json(build);
  } catch (err) {
    console.error(err);
    return res.status(503).json({ error: '통계 저장소에 연결할 수 없습니다. 잠시 후 다시 시도하세요.' });
  }

  // 응답을 보낸 뒤 수집을 한 번 실행합니다. 조회가 곧 수집을 일으키는 구조입니다.
  waitUntil(runCollectStep().catch((err) => console.error('[collect]', err)));
}
```

- [ ] **Step 9: 통과 확인**

Run: `npm test`
Expected: PASS (전체)

- [ ] **Step 10: 타입 검사와 빌드**

Run: `npx tsc --noEmit && npm run build`
Expected: 오류 없음, 빌드 출력에 `ƒ /api/aram/build` 포함

- [ ] **Step 11: Commit**

```bash
git add package.json package-lock.json lib/aram/service.ts pages/api/aram/build.ts test/service.test.ts test/api-build.test.ts
git commit -m "feat: 칼바람 추천 빌드 조회 API와 응답 후 수집 실행

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: 초기 수집 스크립트, 문서, 로컬 확인

**Files:**
- Create: `scripts/seed-aram.ts`
- Modify: `.env.local.example`
- Modify: `README.md`
- Modify: `package.json` (`seed:aram` 스크립트)

**Interfaces:**
- Consumes: `getAccountByRiotId` (lib/riot), `enqueuePuuids` (Task 7), `upstash` (Task 2), `runCollectStep` (Task 9)

- [ ] **Step 1: `scripts/seed-aram.ts` 작성**

```ts
// 초기 데이터 수집: 시작 유저를 대기열에 넣고 정해진 시간 동안 collectStep을 반복합니다.
// 사용법: npm run seed:aram -- "이름#태그" ["이름#태그" ...] [--minutes=30]
import { upstash } from '@/lib/aram/redis';
import { runCollectStep } from '@/lib/aram/service';
import { enqueuePuuids } from '@/lib/aram/store';
import { getAccountByRiotId } from '@/lib/riot';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const args = process.argv.slice(2);
  const minutes = Number(args.find((a) => a.startsWith('--minutes='))?.split('=')[1] ?? 30);
  const riotIds = args.filter((a) => a.includes('#'));
  if (riotIds.length === 0) throw new Error('사용법: npm run seed:aram -- "이름#태그" [--minutes=30]');

  const puuids: string[] = [];
  for (const id of riotIds) {
    const [name, tag] = id.split('#');
    const account = await getAccountByRiotId(name, tag, 'kr');
    puuids.push(account.puuid);
  }
  await enqueuePuuids(upstash, puuids);
  console.log(`시작 유저 ${puuids.length}명을 대기열에 넣었습니다. ${minutes}분 동안 수집합니다.`);

  const deadline = Date.now() + minutes * 60_000;
  let total = 0;
  while (Date.now() < deadline) {
    const r = await runCollectStep();
    total += r.matches;
    console.log(`[${new Date().toLocaleTimeString('ko-KR')}] ${r.status} +${r.matches} (누적 ${total}경기)`);
    if (r.status === 'empty-queue') break;
    if (r.status === 'error') await sleep(30_000);
    else if (r.status === 'rate-limited') await sleep(15_000);
    else if (r.status === 'locked') await sleep(5_000);
    else await sleep(1_000);
  }
  console.log(`완료: ${total}경기 수집`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
```

- [ ] **Step 2: `package.json` `"scripts"`에 추가**

```json
"seed:aram": "tsx --env-file=.env.local scripts/seed-aram.ts",
```

- [ ] **Step 3: `.env.local.example` 교체**

```
# developer.riotgames.com 에서 발급받은 API 키 (개인용 Personal API Key 권장)
# 개발용 키는 24시간마다 만료되니, 만료되면 새로 발급 후 여기에 다시 붙여넣으세요.
RIOT_API_KEY=RGAPI-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx

# Upstash Redis(무료). 칼바람 통계와 Riot API 호출 한도 관리에 필요합니다.
# 없어도 전적 검색은 동작하지만, 즐겨찾기 동기화와 칼바람 통계는 꺼집니다.
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
```

- [ ] **Step 4: `README.md` 갱신**

"## 3. 프로젝트 구조" 코드 블록에 다음 줄을 추가한다:
```
lib/rateLimit.ts                     # Riot API 전역 호출 한도기 (Upstash 공유 카운터)
lib/aram/                            # 칼바람 통계: 수집(collect) · 집계(aggregate) · 계산(build) · 저장(store)
pages/api/aram/build.ts              # 칼바람 추천 빌드 API (?champion=ID&queue=450|2400)
scripts/seed-aram.ts                 # 칼바람 통계 초기 수집 (npm run seed:aram)
```

"## 4." 앞에 다음 절을 추가한다:
````markdown
## 칼바람 통계 (데스크톱 앱용)

- `GET /api/aram/build?champion=103&queue=2400` → 룬·스펠·코어 아이템·신발·증강 추천 (5분 CDN 캐시)
- 조회가 들어올 때마다 응답 후 경기 최대 10개를 추가로 수집합니다 (온디맨드).
- 처음에는 데이터가 없으니 로컬에서 초기 수집을 돌리세요:

```bash
npm run seed:aram -- "이름#태그" --minutes=30
```

- 테스트: `npm test`
````

- [ ] **Step 5: 전체 확인**

Run: `npm test && npx tsc --noEmit && npm run build`
Expected: 모든 테스트 PASS, 타입 오류 없음, 빌드 성공

- [ ] **Step 6: (사용자와 함께) 초기 수집 실행**

`.env.local`이 준비된 상태에서 (Task 1 Step 7) 사용자가 준 Riot ID로 실행:
Run: `npm run seed:aram -- "<이름#태그>" --minutes=5`
Expected: `done +N` 줄이 반복되고 `rate-limited`가 나오면 15초 쉬었다 이어감. 5분 뒤 `완료: N경기 수집` (N은 대략 50~150).

- [ ] **Step 7: 로컬 API 확인**

Run (별도 터미널에서 `npm run dev` 실행 후): `curl "http://localhost:3000/api/aram/build?champion=103&queue=450"`
Expected: `sampleSize`가 0보다 큰 JSON (아리 표본이 없으면 다른 챔피언 ID로 확인). 키 값이 응답에 포함되지 않는지 확인.

- [ ] **Step 8: Commit**

```bash
git add scripts/seed-aram.ts package.json .env.local.example README.md
git commit -m "feat: 칼바람 통계 초기 수집 스크립트와 문서

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 9: 배포는 사용자 확인 후**

GitHub push와 Vercel 배포는 사용자에게 확인을 받은 뒤 진행한다. 배포 전 Vercel 환경변수 `RIOT_API_KEY`가 개인용 키인지 사용자가 확인한다.
