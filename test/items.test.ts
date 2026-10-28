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
    '3004': { tags: [], into: ['3042'], gold: { total: 2900, purchasable: true }, maps: aram }, // 마나무네
    '3042': { tags: [], specialRecipe: 3004, gold: { total: 2900, purchasable: false }, maps: aram }, // 무라마나 (변신)
  },
};

describe('classifyItems', () => {
  const c = classifyItems(json);
  it('완성 아이템: 라바돈, 변신 전후 아이템(마나무네·무라마나)', () =>
    expect([...c.completed].sort()).toEqual([3004, 3042, 3089]));
  it('신발은 2단계 이상만', () => expect([...c.boots]).toEqual([3020]));
});
