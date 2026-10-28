# 칼바람 빌드 어시스턴트 설계

- 작성일: 2026-10-28 (2판: 2026-10-29, Mayhem 데이터 수집 방식 변경)
- 상태: 사용자 검토 대기
- 앱 이름: 미정 (임시로 `lol-tracker-desktop`, 룬 페이지·아이템 세트 접두어 `[LT]` 사용 — 이름 확정 시 일괄 변경)

## 1. 목표

OP.GG 데스크톱 앱처럼, 롤 클라이언트에 붙어 **칼바람 증강(Mayhem, 큐 2400) 챔피언 선택 시 추천 룬·스펠·아이템 세트를 자동 적용**하고 **증강 추천을 보여주는** Windows 데스크톱 앱을 만든다.

추천 데이터는 데스크톱 앱이 롤 클라이언트(LCU)에서 읽은 Mayhem 경기를 기존 사이트 `lol.dec03.kr`(이 저장소)로 보내고, 사이트가 모아서 집계해 제공한다.

### 성공 기준
- Mayhem 챔피언 선택에서 챔피언이 정해지거나 바뀌면, 수 초 안에 추천 룬 페이지·스펠·아이템 세트가 클라이언트에 적용된다.
- 앱 창에 추천 룬·스펠·아이템·증강이 선택 비율·승률·표본 수와 함께 표시된다.
- 사용자의 기존 룬 페이지·아이템 세트는 절대 삭제·변경되지 않는다.
- 데이터 수집은 사용자가 끌 수 있고, 켜져 있어도 LCU 요청은 10초에 1건·하루 300건을 넘지 않으며, 챔피언 선택·게임 중에는 멈춘다.
- 전적 검색 기능은 지금처럼 동작한다.

### 범위 밖 (이번에 하지 않음)
- Mayhem 외 큐 (일반 칼바람 450은 서버가 받을 수는 있게 두되, 앱은 수집·추천하지 않음), KR 이외 지역
- 시작 아이템, 아이템 구매 순서, 스킬 순서
- 게임 화면 위 오버레이 (별도 창 + 항상 위로 대체)
- 벤치 챔피언 승률 비교
- 공개 배포 (프로덕션 키, 수집 데이터 위조 방지)

## 2. 제약 조건과 확인된 사실

- Riot API **개인용(Personal) 키**: 1초 20회 / 2분 100회. 본인·소수 지인 용도.
- **Riot 공개 API로는 Mayhem 경기를 받을 수 없다** (2026-10-28 확인, 8절). 그래서 서버가 Riot API로 칼바람 경기를 수집하던 1판 설계는 폐기한다.
- **LCU로는 Mayhem 경기를 받을 수 있다** (2026-10-29 확인, 8절): 내 경기 목록, 경기 상세(10명의 증강·아이템·룬·스펠·승패), 다른 유저의 경기 목록.
- LCU 사용은 Riot이 공식 지원하지 않는다. 다른 유저 전적을 자동으로 조회하는 것은 약관상 회색지대이며 계정 제재 위험이 0이 아니다 → 아주 느리게, 끌 수 있게 만든다 (사용자 결정 2026-10-29).
- 사이트는 **Vercel**(서버리스), 저장소는 **Upstash Redis** 무료 플랜 (월 50만 명령, 파이프라인 안의 명령도 각각 과금).

## 3. 전체 구조

```
[데스크톱 앱 (Electron)]
   │  LCU(127.0.0.1): 챔피언 선택 감지, 룬·스펠·아이템 세트 적용, 경기 기록 읽기
   │
   ├── POST /api/aram/ingest  (Mayhem 경기 묶음, X-Ingest-Key) ──▶ [lol-tracker (Vercel)] ──▶ Upstash Redis
   └── GET  /api/aram/build   (챔피언별 추천)                  ◀──        (집계 · 패치 · 처리 기록)
```

- 데스크톱 앱에는 Riot API 키가 없다.
- 저장소 두 개: 이 저장소(`lol-tracker`)에 서버 부분, 데스크톱 앱은 별도 저장소 `lol-tracker-desktop`.
- 공유 타입(`lib/aram/types.ts`: 빌드 응답 + 수집 요청)은 앱 쪽에 복사해 사용한다.

## 4. 서버 (lol-tracker)

### 4.1 이미 구현된 것 중 유지
- **전역 호출 한도기 `lib/rateLimit.ts`** (전적 검색 보호): 검색 1초 16회, 2분 90회 슬라이딩 창 근사, 검색 1회는 15회 일괄 예약, `service` 429는 전역 차단 안 함, Riot 호출 8초 시간 제한. 수집(`collect`) 종류는 더 이상 쓰지 않으므로 제거한다.
- **집계 `lib/aram/aggregate.ts`**: 챔피언별 누적값 `ChampAgg`(JSON), `applySamples`, `pruneAgg`.
- **빌드 계산 `lib/aram/build.ts`**, **조회 `GET /api/aram/build`**, 아이템 분류 `lib/aram/items.ts`.
- **Upstash 래퍼** `lib/kv.ts` (URL 형식 검사 포함), `RedisLike`, 잠금(토큰).

### 4.2 제거
- Riot API 수집: `lib/aram/collect.ts`, `collectDeps`/`runCollectStep`, `scripts/seed-aram.ts`, 대기열·`aram:crawled:*` 관련 저장소 함수, 빌드 API의 `waitUntil` 수집 실행, `@vercel/functions` 의존성, Riot 경기 → 표본 변환(`extractSamples`)과 그 픽스처 테스트.
- 데이터 검증 스크립트 `scripts/inspect-match.ts`는 기록용으로 남긴다.

### 4.3 수집 API — `POST /api/aram/ingest`
- 인증: 헤더 `X-Ingest-Key`가 환경변수 `INGEST_KEY`와 같아야 한다 (상수 시간 비교). 없거나 다르면 401. `INGEST_KEY`가 서버에 설정되지 않았으면 503.
- 요청 본문 (`lib/aram/types.ts`):

```ts
interface IngestParticipant {
  championId: number;
  win: boolean;
  spell1Id: number;
  spell2Id: number;
  items: number[];          // item0~6, 정확히 7개 (빈 칸 0)
  perks: number[];          // perk0~5, 정확히 6개 (핵심 4 + 보조 2)
  perkPrimaryStyle: number;
  perkSubStyle: number;
  augments: number[];       // playerAugment1~6 중 0이 아닌 값, 최대 6개
}
interface IngestGame {
  gameId: number;           // LCU gameId (KR)
  queueId: 450 | 2400;
  gameVersion: string;      // 예: "16.21.123.4567"
  gameDuration: number;     // 초
  earlySurrender: boolean;  // 참가자 중 하나라도 gameEndedInEarlySurrender
  participants: IngestParticipant[]; // 정확히 10명
}
interface IngestRequest { games: IngestGame[] }   // 1~20개
interface IngestResponse { accepted: number; duplicates: number; rejected: number }
```

- 검증: 형식이 틀린 경기는 `rejected`로 세고 나머지는 처리한다. 본문 전체가 형식에 안 맞거나 21개 이상이면 400. 본문 크기 상한 200KB.
- 제외(=`rejected`): 큐가 450·2400이 아님, 참가자 10명이 아님, `gameDuration < 300`, `earlySurrender`.
- 처리 순서 (잠금 안에서):
  1. 잠금 `aram:lock` (토큰, 60초) — 실패하면 503 `{ error, retryAfter: 5 }` (앱이 나중에 다시 보냄)
  2. `SMISMEMBER aram:seen:game` → 이미 처리한 경기는 `duplicates`
  3. 새 경기 → 표본 변환(4.4) → `MGET` → `applySamples` → `pruneAgg` → `MSET`
  4. `ZADD aram:patches`, `SADD aram:seen:game`
  5. 잠금 해제 (토큰 일치 시)
- 비용: 요청 1건(최대 20경기)에 Upstash 명령 약 9개.
- 응답: 200 `IngestResponse`. 캐시 금지.

### 4.4 표본 변환 — `samplesFromIngest(game, itemClasses) → Sample[]`
- 패치: `gameVersion` 앞 두 자리
- 룬 키 (LCU에는 룬 파편 정보가 없으므로 파편 제외): `"{primaryStyle}:{p0}-{p1}-{p2}-{p3}:{subStyle}:{p4}-{p5}"`
- 스펠 키: `"{작은ID}-{큰ID}"`
- 아이템: `items` 중 완성 아이템(중복 제거), 신발 1개 (분류는 4.1의 Data Dragon 규칙)
- 증강: `augments`

### 4.5 조회 — `GET /api/aram/build?champion={id}&queue={450|2400}` (기존 유지)
- 최신 패치와 직전 패치, 30판 미만이면 합산. 응답 `AramBuildResponse` (형식 변경 없음; `runes[].key`는 4.4의 새 룬 키).
- `champion`, `queue` 외 파라미터나 10,000 초과 챔피언 ID는 400. `s-maxage=300`.
- 증강은 2400에서만.

### 4.6 Redis 키
| 키 | 내용 |
|---|---|
| `aram:agg:{queue}:{patch}:{championId}` | `ChampAgg` JSON |
| `aram:patches` | 패치 정렬 집합 |
| `aram:seen:game` | 처리한 LCU gameId 집합 |
| `aram:lock` | 집계 잠금 (토큰) |
| `rl:*` | 전적 검색 호출 한도 |

## 5. 데스크톱 앱 (lol-tracker-desktop)

기술: Electron + React + TypeScript, electron-vite, electron-builder (Windows NSIS 설치 파일), Vitest.

### 5.1 LCU 연결
- `src/main/lcu/credentials.ts`: PowerShell `Get-CimInstance Win32_Process -Filter "name='LeagueClientUx.exe'"`의 `CommandLine`에서 `--app-port`, `--remoting-auth-token` 추출 (순수 파싱 함수 분리).
- `src/main/lcu/client.ts`: `https://127.0.0.1:{port}` + Basic 인증(`riot:{token}`). 자체 서명 인증서는 이 연결에 한해서만 허용.
- `src/main/lcu/events.ts`: LCU 웹소켓(WAMP) 구독
  - `OnJsonApiEvent_lol-gameflow_v1_gameflow-phase`
  - `OnJsonApiEvent_lol-champ-select_v1_session`
  - 연결 끊김 시 3초 간격 재연결.

### 5.2 빌드 자동 적용 — `src/main/features/applyBuild.ts`
- Mayhem 챔피언 선택에서 챔피언 변경 감지 → 500ms 디바운스 → `GET /api/aram/build?queue=2400` → 켜진 기능만 적용
  - 룬: `[LT] ` 접두어 페이지를 찾아 `PUT`, 없으면 `POST`, 이후 현재 페이지로 지정. 룬 파편은 기본값(공격 적응형, 유연 적응형, 방어 체력)으로 채운다. 슬롯이 가득 차면 경고만. **다른 페이지는 삭제·수정하지 않는다.**
  - 스펠: `PATCH /lol-champ-select/v1/session/my-selection`. 점멸 위치(D/F) 설정 반영.
  - 아이템 세트: `[LT]` 접두어 세트만 교체, 나머지 유지. 코어 아이템 + 신발.
- `lowSample`이어도 적용하되 화면에 "데이터 부족" 표시. `sampleSize: 0`이면 적용하지 않는다.

### 5.3 경기 수집기 — `src/main/collector/`
- **내 경기**: 앱 시작 시와 게임 종료(`EndOfGame` 단계) 시 `GET /lol-match-history/v1/products/lol/current-summoner/matches?begIndex=0&endIndex=20` → 큐 2400이고 아직 보내지 않은 경기만 `GET /lol-match-history/v1/games/{gameId}` → `IngestGame`으로 변환 → 서버로 전송.
- **같이 한 유저들의 경기** (설정 `crawlOthers`, 기본 켬):
  - 내 경기 상세의 다른 9명 puuid를 로컬 대기열 뒤에 추가 (중복 제외, 최대 2,000명).
  - 대기열에서 1명씩 `GET /lol-match-history/v1/products/lol/{puuid}/matches?begIndex=0&endIndex=10` → 큐 2400이고 안 보낸 경기의 상세 조회 → 그 경기의 참가자도 대기열에 추가.
  - 24시간 안에 조회한 puuid는 건너뛴다.
- **속도 제한** (내 경기 수집 포함 모든 경기 기록 요청에 적용):
  - LCU 경기 기록 요청 **10초에 1건** (`intervalSec`, 최소 5), **하루 300건** (`dailyCap`, 최대 1,000). 하루는 로컬 날짜 기준.
  - 게임 진행 단계가 `ChampSelect`, `GameStart`, `InProgress`, `Reconnect`이면 멈춘다.
  - LCU가 200이 아닌 응답(404 제외)을 주면 **30분 동안 멈춘다.**
- **전송**: 변환된 경기를 최대 20개씩 묶어 `POST /api/aram/ingest`. 실패하면(네트워크·503) 로컬 전송 대기 목록에 남겨 1분 뒤 다시 시도. 성공한 gameId는 로컬 "보낸 경기" 집합에 기록 (최근 20,000개 유지).
- 변환 시 개인 정보(이름, puuid)는 서버로 보내지 않는다 (4.3 형식에 없음).
- 상태 파일: `userData/collector.json` — 대기열, 최근 조회 시각, 보낸 경기, 오늘 요청 수, 일시 정지 해제 시각. 앱을 껐다 켜도 이어 간다.
- `INGEST_KEY`는 빌드 시 환경변수로 주입한다 (저장소에 커밋하지 않음).

### 5.4 설정 — `userData/settings.json`
`autoRunes`, `autoSpells`, `autoItems`, `flashKey: 'D' | 'F'`, `alwaysOnTopInGame`, `apiBaseUrl` (기본 `https://lol.dec03.kr`), `collectEnabled` (기본 켬), `crawlOthers` (기본 켬), `intervalSec` (기본 10), `dailyCap` (기본 300).

### 5.5 화면 (렌더러)
- 상태: 클라이언트 대기 중 / 연결됨 / 챔피언 선택 중 / 게임 중
- 현재 챔피언, 큐
- 추천 룬·스펠·코어 아이템·신발·**증강**: 아이콘 + 선택 비율 + 승률, 표본 수, `lowSample`이면 "데이터 부족"
- 항목별 적용 결과 (성공 / 실패 사유)
- 수집 상태: 오늘 요청 수 / 한도, 보낸 경기 수, 대기열 길이, 일시 정지 여부
- 설정: 기능 토글, 점멸 위치, 수집 켜기/끄기, 다른 유저 수집 켜기/끄기, 간격, 하루 한도, "다시 적용"
- 게임 진행 중 `alwaysOnTopInGame`이면 창을 항상 위로.
- 아이콘: Data Dragon / Community Dragon

### 5.6 프로세스 간 통신
- preload에서 `contextBridge`로 최소 API만 노출: `onState(cb)`, `getSettings()`, `setSettings(patch)`, `reapply()`.
- `nodeIntegration: false`, `contextIsolation: true`.

## 6. 오류 처리

| 상황 | 처리 |
|---|---|
| ingest 키 불일치 | 401 |
| ingest 서버 키 미설정 / Redis 실패 / 잠금 실패 | 503, 앱은 1분 뒤 재전송 |
| ingest 형식 오류 | 경기 단위 `rejected`, 본문 전체 오류면 400 |
| 같은 경기 재전송 | `duplicates`, 집계 안 함 |
| 빌드 조회 Redis 실패 | 503 |
| 표본 없음 | 200 + `sampleSize: 0`, 앱은 적용 안 함 |
| 클라이언트 미실행 | "대기 중" + 3초마다 재탐색 |
| LCU 경기 기록 요청 실패 (404 외) | 수집 30분 정지 |
| 사이트 API 실패 | 화면에 오류, 자동 적용 건너뜀 |
| LCU 적용 실패 | 해당 항목만 경고, 나머지 계속 |

## 7. 테스트

- Vitest (양쪽 저장소).
- 서버: `samplesFromIngest`(룬 키·아이템·증강·조기 종료), ingest 검증·인증·중복·잠금 실패, 빌드 계산, 한도기.
- 앱: LCU 실행 인자 파싱, LCU 경기 상세 → `IngestGame` 변환 (실제 LCU 응답을 가명 처리한 픽스처), 수집기 속도 제한·일시 정지·단계별 정지·하루 한도, 추천 → 룬 페이지·스펠·아이템 세트 요청 변환, 기존 페이지·세트 보존.
- 수동: 실제 Mayhem 챔피언 선택에서 적용 확인, 게임 종료 후 경기 전송 확인.

## 8. 데이터 검증 기록

### Riot 공개 API (2026-10-28)
- 450: `perks` 있음 (styles 2개 + statPerks), `playerAugment1~6` 필드 있음 (값 0). 픽스처 `test/fixtures/match-450.json`.
- 2400: **조회 불가.** 여러 유저의 `ids?queue=2400`이 모두 빈 배열, OP.GG 로그의 2026-10 Mayhem 경기 ID 직접 조회는 403. 같은 키로 2026-02·2026-08 칼바람 경기는 정상.

### LCU (2026-10-29, 읽기 전용 GET)
- `/lol-match-history/v1/products/lol/current-summoner/matches`: 200, 최근 11판 모두 `queueId 2400`, `gameMode "KIWI"`.
- `/lol-match-history/v1/games/{gameId}`: 200, `participants` 10명, 각 `stats`에 `playerAugment1~6`(Mayhem은 4개 채워짐, 예 1336·1134·3085·1238), `item0~6`, `perk0~5`, `perkPrimaryStyle`, `perkSubStyle`, `win`, `gameEndedInEarlySurrender`. 룬 파편 필드 없음. 참가자 키: `championId, spell1Id, spell2Id, stats, teamId, participantId, timeline, highestAchievedSeasonTier`.
- `/lol-match-history/v1/products/lol/{다른 유저 puuid}/matches`: 200, 최근 6판 (모두 2400).
- OP.GG도 게임 종료 시 LCU 게임 종료 통계를 자사 서버(`.../opscore`)로 POST하는 방식으로 수집한다 (OP.GG 앱 로그로 확인, `gameMode "KIWI"`).

## 9. 외부 수치 (2026-10-28 확인)

- Upstash Redis 무료: 월 50만 명령, 저장 256MB, 대역폭 월 10GB, 요청 최대 10MB. 파이프라인 안의 명령은 각각 과금. → 챔피언별 JSON 묶음 저장, ingest 요청 1건에 약 9개 명령.
