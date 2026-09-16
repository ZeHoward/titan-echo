// Save arrays are positional. This module names the catalog ID behind every slot so a
// future data version can move progress by ID instead of by array position.
// It does not change gameplay, balance or the saved format.
import { TT2_HEROES, TT2_PETS, TT2_SETS } from './tt2-data.ts';
import { TT2_ARTIFACTS, TT2_ACTIVE, TT2_TREE, TT2_RULESET } from './tt2-rules.ts';

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

// The TT2 block keeps its own positional arrays against the full catalogs.
export type Tt2IdOrder = { artifacts: string[]; spent: string[]; tree: string[]; petLevels: string[]; scrolls: string[] };
function currentTt2Order(): Tt2IdOrder {
  const artifacts = TT2_ARTIFACTS.map(a => a.id);
  return { artifacts, spent: artifacts, tree: TT2_TREE.map(t => t.id),
    petLevels: TT2_PETS.map(p => p.id), scrolls: TT2_HEROES.map(h => h.id) };
}
export const TT2_ID_ORDERS: Record<string, Tt2IdOrder> = { [TT2_RULESET]: currentTt2Order() };
export const TT2_ARRAY_KEYS = Object.keys(currentTt2Order()) as (keyof Tt2IdOrder)[];

export function tt2IdOrder(ruleset: string): Tt2IdOrder {
  const order = TT2_ID_ORDERS[ruleset];
  if (!order) throw Error(`未知的規則版本：${ruleset}`);
  return order;
}

/** Catalog ID order behind the index lists the TT2 block stores, such as completed sets. */
export function indexListOrder(ruleset: string) {
  if (ruleset !== TT2_RULESET) throw Error(`未知的規則版本：${ruleset}`);
  return { sets: TT2_SETS.map(s => s.id), pieces: TT2_SETS.map(s => s.id), enchanted: TT2_ARTIFACTS.map(a => a.id) };
}

/**
 * Move a stored list of catalog indices to the target order.
 * Indices whose ID the target no longer has are dropped and reported, not left pointing elsewhere.
 */
export function migrateIndexList(list: readonly number[] | undefined, fromIds: readonly string[],
    toIds: readonly string[]): { list: number[]; dropped: string[] } {
  const migrated: number[] = [], dropped: string[] = [];
  for (const index of list ?? []) {
    const id = fromIds[index];
    if (id === undefined) { dropped.push(`索引 ${index}`); continue; }
    const next = toIds.indexOf(id);
    if (next === -1) dropped.push(id); else migrated.push(next);
  }
  return { list: migrated, dropped };
}

/** Same move for the {set, slot} pieces list, which also stores a catalog index. */
export function migrateSetPieces(pieces: readonly { set: number; slot: number }[] | undefined,
    fromIds: readonly string[], toIds: readonly string[]) {
  const migrated: { set: number; slot: number }[] = [], dropped: string[] = [];
  for (const piece of pieces ?? []) {
    const id = fromIds[piece.set];
    if (id === undefined) { dropped.push(`索引 ${piece.set}`); continue; }
    const next = toIds.indexOf(id);
    if (next === -1) dropped.push(id); else migrated.push({ set: next, slot: piece.slot });
  }
  return { pieces: migrated, dropped };
}
