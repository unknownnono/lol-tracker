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
  it('픽스처에는 실제 경기 ID·시각이 없다 (공개 저장소에서 역추적 방지)', () => {
    const raw = JSON.parse(readFileSync(fixture, 'utf8'));
    expect(raw.gameId).toBe(1000000001);
    expect(raw.gameCreation).toBe(1767225600000);
    expect(raw.gameCreationDate).toBe('2026-01-01T00:00:00.000Z');
  });

  it.skipIf(!existsSync(fixture))('실제 LCU 응답(가명 처리)을 유효한 수집 형식으로 바꾼다', () => {
    const g = lcuGameToIngest(JSON.parse(readFileSync(fixture, 'utf8')))!;
    expect(isValidGame(g)).toBe(true);
    expect(g.queueId).toBe(2400);
    expect(g.participants.every((p) => p.augments.length > 0)).toBe(true);
  });
});
