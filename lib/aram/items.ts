// Data Dragon item.json으로 "완성 아이템"과 "신발"을 구분합니다. 칼바람 맵 번호는 12입니다.
export interface DdItem {
  into?: string[];
  tags?: string[];
  depth?: number;
  consumed?: boolean;
  specialRecipe?: number; // 변신 아이템(무라마나 등): 구매는 불가하지만 슬롯에 남는 완성품
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
  const purchasable = (id: string) => Boolean(itemJson.data[id]?.gold?.purchasable);
  for (const [id, item] of Object.entries(itemJson.data)) {
    if (!item.maps?.[ARAM_MAP]) continue;
    if (item.specialRecipe) {
      completed.add(Number(id));
      continue;
    }
    if (!item.gold?.purchasable) continue;
    const tags = item.tags ?? [];
    if (tags.includes('Boots')) {
      if ((item.depth ?? 1) >= 2) boots.add(Number(id));
      continue;
    }
    if (tags.includes('Consumable') || tags.includes('Trinket') || item.consumed) continue;
    // 상위 아이템이 없거나, 상위가 전부 구매 불가(변신 전 단계: 마나무네 등)면 완성품으로 봅니다.
    const upgradable = (item.into ?? []).some(purchasable);
    if (!upgradable && item.gold.total >= MIN_COMPLETED_GOLD) completed.add(Number(id));
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
