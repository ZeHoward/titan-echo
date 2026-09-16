// Save arrays are positional. This module names the catalog ID behind every slot so a
// future data version can move progress by ID instead of by array position.
// It does not change gameplay, balance or the saved format.
import { TT2_HEROES } from './tt2-data.ts';
import { TT2_ARTIFACTS, TT2_ACTIVE, TT2_RULESET } from './tt2-rules.ts';

// Slot counts the Sheets snapshot format pins. Changing them needs a tested migration first.
export const SAVE_SLOTS = { heroes: 33, artifacts: 30, skillLevels: 6 } as const;
// Skill slots were authored in a fixed display order; the comment in engine.ts pins the same list.
export const SKILL_SAVE_ORDER = [5, 1, 4, 3, 2, 0] as const;

export type SaveIdOrder = {
  heroes: string[]; weapons: string[]; evolutions: string[]; wounded: string[];
  artifacts: string[]; artifactSpent: string[]; skillLevels: string[];
};

function currentOrder(): SaveIdOrder {
  const heroes = TT2_HEROES.slice(0, SAVE_SLOTS.heroes).map(h => h.id);
  const artifacts = TT2_ARTIFACTS.slice(0, SAVE_SLOTS.artifacts).map(a => a.id);
  const skillLevels = SKILL_SAVE_ORDER.map(i => TT2_ACTIVE[i].id);
  return { heroes, weapons: heroes, evolutions: heroes, wounded: heroes,
    artifacts, artifactSpent: artifacts, skillLevels };
}

export const SAVE_ID_ORDERS: Record<string, SaveIdOrder> = { [TT2_RULESET]: currentOrder() };
export const SAVE_ARRAY_KEYS = Object.keys(currentOrder()) as (keyof SaveIdOrder)[];

export function saveIdOrder(ruleset: string): SaveIdOrder {
  const order = SAVE_ID_ORDERS[ruleset];
  if (!order) throw Error(`未知的規則版本：${ruleset}`);
  return order;
}

export type DroppedSlot = { key: keyof SaveIdOrder; id: string; value: number };
export type MigrationResult = { arrays: Record<string, number[]>; dropped: DroppedSlot[]; added: DroppedSlot[] };

/**
 * Move every saved number to the slot its catalog ID occupies in the target order.
 * Values for IDs the target no longer has are reported, never silently discarded.
 * Keyed by ID, so running it again on the same input gives the same output.
 */
export function migrateSaveArrays(arrays: Record<string, readonly number[] | undefined>,
    from: SaveIdOrder, to: SaveIdOrder, options: { allowSlotCountChange?: boolean } = {}): MigrationResult {
  const result: Record<string, number[]> = {}, dropped: DroppedSlot[] = [], added: DroppedSlot[] = [];
  for (const key of SAVE_ARRAY_KEYS) {
    const source = arrays[key] ?? [];
    const fromIds = from[key], toIds = to[key];
    if (!options.allowSlotCountChange && fromIds.length !== toIds.length) {
      throw Error(`${key}: 欄位數量改變需要先測試相容遷移`);
    }
    const byId = new Map<string, number>();
    fromIds.forEach((id, index) => {
      const value = source[index];
      byId.set(id, Number.isFinite(value) ? Number(value) : 0);
    });
    result[key] = toIds.map(id => byId.get(id) ?? 0);
    for (const [id, value] of byId) {
      if (!toIds.includes(id) && value > 0) dropped.push({ key, id, value });
    }
    for (const id of toIds) {
      if (!byId.has(id)) added.push({ key, id, value: 0 });
    }
  }
  return { arrays: result, dropped, added };
}

/** The ID list each slot stands for, for one array, as plain data for tests and evidence. */
export function describeSaveIds(ruleset = TT2_RULESET) {
  const order = saveIdOrder(ruleset);
  return { ruleset, slots: SAVE_SLOTS,
    arrays: Object.fromEntries(SAVE_ARRAY_KEYS.map(key => [key, order[key]])) };
}
