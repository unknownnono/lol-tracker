import { describe, expect, it } from 'vitest';
import { aggKey, emptyAgg } from '@/lib/aram/aggregate';
import { getAramBuild } from '@/lib/aram/service';
import { skillKey } from '@/lib/aram/skills';
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

  it('스킬 빌드는 일반 칼바람 순서를 챔피언별로 (아수라장 조회에도)', async () => {
    const r = new FakeRedis();
    await registerPatches(r, ['16.20', '16.21']);
    await saveAggs(r, new Map<string, any>([[skillKey(7), { g: 6, w: 6, q: { QWEQQRQEQEREEWW: [6, 6] }, m: { QEW: [6, 6] } }]]));
    const b = await getAramBuild(7, 2400, r);
    expect(b.skills).toMatchObject({ queue: 450, sampleSize: 6, orders: [{ key: 'QEW', games: 6 }] });
    expect((await getAramBuild(8, 2400, r)).skills).toBeNull();
  });
});
