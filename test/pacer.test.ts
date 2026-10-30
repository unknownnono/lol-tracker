import { describe, expect, it } from 'vitest';
import { Pacer } from '@/lib/aram/pacer';

describe('Pacer', () => {
  it('초당 한도', () => {
    const p = new Pacer(100, 2);
    p.record(0);
    p.record(10);
    expect(p.waitMs(20)).toBe(980);
    expect(p.waitMs(1000)).toBe(0);
  });
  it('2분 한도', () => {
    const p = new Pacer(3, 10);
    [0, 2000, 4000].forEach((t) => p.record(t));
    expect(p.waitMs(5000)).toBe(115_000);
    expect(p.waitMs(120_000)).toBe(0);
  });
});
