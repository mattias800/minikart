import type { Rng } from '../core/math';

export type ItemType = 'mushroom' | 'tripleMushroom' | 'banana' | 'greenShell' | 'redShell' | 'star';

export const ITEM_NAMES: Record<ItemType, string> = {
  mushroom: 'Turbo Shroom',
  tripleMushroom: 'Triple Shrooms',
  banana: 'Banana',
  greenShell: 'Green Shell',
  redShell: 'Red Shell',
  star: 'Super Star',
};

export const ALL_ITEMS: readonly ItemType[] = Object.keys(ITEM_NAMES) as ItemType[];

/** How long the item roulette spins before you get something. */
export const ROULETTE_DURATION = 1.5;
export const MUSHROOM_BOOST_DURATION = 1.25;
export const STAR_DURATION = 7;

type Weights = Partial<Record<ItemType, number>>;

/**
 * Item odds by race position (front → back). Leaders get defensive items,
 * stragglers get the good stuff — the classic catch-up mechanic.
 */
const ODDS_BY_POSITION: readonly Weights[] = [
  { banana: 45, greenShell: 40, mushroom: 15 },
  { banana: 25, greenShell: 30, redShell: 25, mushroom: 20 },
  { redShell: 35, mushroom: 30, tripleMushroom: 20, greenShell: 10, star: 5 },
  { tripleMushroom: 35, redShell: 25, star: 25, mushroom: 15 },
];

export function itemOdds(rank: number, racerCount: number): Weights {
  const t = racerCount <= 1 ? 0 : (rank - 1) / (racerCount - 1);
  return ODDS_BY_POSITION[Math.min(ODDS_BY_POSITION.length - 1, Math.floor(t * ODDS_BY_POSITION.length))];
}

export function rollItem(rank: number, racerCount: number, rng: Rng): ItemType {
  const odds = itemOdds(rank, racerCount);
  const entries = Object.entries(odds) as [ItemType, number][];
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  let pick = rng() * total;
  for (const [item, weight] of entries) {
    pick -= weight;
    if (pick <= 0) return item;
  }
  return entries[entries.length - 1][0];
}

export function itemUses(item: ItemType): number {
  return item === 'tripleMushroom' ? 3 : 1;
}
