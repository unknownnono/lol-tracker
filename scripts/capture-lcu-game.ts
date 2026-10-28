// 테스트 픽스처 저장: 실행 중인 롤 클라이언트(LCU)에서 내 최근 Mayhem 경기 상세 1개를 읽어
// 개인 정보(이름·puuid·계정 ID·경기 ID·시각)를 가명 처리한 뒤 test/fixtures/lcu-game-2400.json에 저장합니다. 읽기 전용 GET만 씁니다.
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
  // 공개 저장소에서 실제 경기를 역추적하지 못하도록 경기 ID와 시각도 가짜 값으로 바꿉니다.
  const realId = game.gameId;
  game.gameId = 1000000001;
  game.gameCreation = 1767225600000;
  game.gameCreationDate = '2026-01-01T00:00:00.000Z';
  const json = JSON.stringify(game, null, 2).split(String(realId)).join('1000000001');
  writeFileSync('test/fixtures/lcu-game-2400.json', json);
  console.log(`저장: test/fixtures/lcu-game-2400.json (참가자 ${game.participants?.length}명)`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
