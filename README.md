# LoL 전적 검색 (op.gg 스타일)

Riot Games API를 이용한 소환사 검색 / 랭크 / 최근 전적 조회 사이트입니다.

## 1. Riot API 키 발급

1. https://developer.riotgames.com 접속 후 라이엇 계정으로 로그인
2. 로그인하면 바로 **개발용 API 키(Development API Key)**가 발급됩니다 (24시간마다 만료 — 만료되면 다시 발급받아 교체하면 됩니다)
3. 나중에 실제로 배포하려면 "Personal API Key" 또는 "Production API Key"를 신청해야 합니다 (심사 필요, Product Registration 작성)

## 2. 로컬 실행

```bash
npm install
cp .env.local.example .env.local
# .env.local 파일을 열어 RIOT_API_KEY 값을 발급받은 키로 교체

npm run dev
```

http://localhost:3000 접속 → "Hide on bush#KR1" 같은 형식(소환사명#태그)으로 검색

## 3. 프로젝트 구조

```
lib/riot.ts                          # Riot API 호출 로직 전부 (핵심 파일)
pages/api/summoner.ts                # (선택적으로 쓸 수 있는) REST API 엔드포인트
pages/index.tsx                      # 검색 홈 화면
pages/summoner/[region]/[name].tsx   # 소환사 프로필 페이지 (서버사이드 렌더링)
```

## 4. 다음에 추가하면 좋은 기능들

- **챔피언 통계 페이지**: Data Dragon(`ddragon.leagueoflegends.com`)에서 챔피언 목록/스탯을 가져와 티어 리스트 구성
- **매치 상세 페이지**: 지금은 목록만 보여주지만, `getMatchDetail` 결과에 팀별 전체 참가자 정보가 들어있으니 매치 클릭 시 상세 페이지로 확장 가능
- **DB 캐싱 (매우 중요)**: 현재는 검색할 때마다 Riot API를 실시간 호출합니다. 트래픽이 늘면 반드시 PostgreSQL/Redis 등으로 소환사 정보와 매치 데이터를 캐싱해야 API rate limit(개발 키 기준 20req/1초, 100req/2분)에 안 걸립니다
- **자동 갱신**: 랭크 변화, 최근 전적 자동 업데이트를 위한 백그라운드 작업(cron)
- **다국어/지역 자동 감지**

## 5. 주의사항

- **API 키는 절대 클라이언트(브라우저)에 노출하면 안 됩니다.** 이 프로젝트는 `lib/riot.ts`를 서버 코드(`getServerSideProps`, API Route)에서만 호출하도록 설계되어 있습니다.
- Riot API 이용약관(Rate Limit, 상업적 이용 제한 등)을 꼭 확인하세요: https://developer.riotgames.com/policies/general
