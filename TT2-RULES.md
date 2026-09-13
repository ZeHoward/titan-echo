# TT2 compatibility audit

The user's supplied Bahamut guide refers to **Tap Titans 2**, not TT1. The unpublished TT1 draft was archived outside the source tree. Do not reintroduce TT1 formulas.

- Behavior reference: https://m.gamer.com.tw/forum/C.php?bsn=27714&snA=6761
- Numerical source: https://github.com/rawrzcookie/TT2_CSV/tree/a959d19790af28d994d96bd8a315ca7185c04dfe/csv
- Source version: UpdateInfo says 7.5.0; snapshot dated 2025-02-04.
- `lib/tt2-data.ts` contains transcribed numerical facts and stable IDs, not original engine code or images.
- `lib/tt2-rules.ts` implements composite bonus routing and damage-source reduction exponents.
- Full scope and current limitations: `public/rules.html`. This remains a partial reconstruction.

Keep wire version 2 with legacy hero[33] and artifact[30] arrays for the deployed Sheets service. Actual TT2 artifacts, extra heroes and tree data live in `state.tt2`. Migration refunds tracked old artifact spending once and archives old IDs rather than relabeling them. Browser storage preserves a complete pre-migration backup in its transaction.

Do not describe catalog entries as completed gameplay. In particular, pets, guilds, raids, six full builds, gear drops/crafting, tournaments, seasonal content, exact base curves, ascensions and special tree triggers still require implementation and reference validation. The currently exposed set list and build coefficients are explicitly previews.

Original tests that asserted invented mechanics were replaced with reference-fixture and persistence tests. No browser visual QA was requested for this update.

Collection update: five-slot primary equipment stats follow TT2Master Equipment.PrimaryBonusEfficiency; gear collection/crafting and retained sets are implemented, but drop level/rarity remains an explicit approximation (best/10, common only). Pets have two equip classes, passive steps and 4h eggs; eggs award one level until distribution is verified. The 14-day daily table is implemented; perk tokens and holiday currency are retained pending their consumers. Neither pet combat nor special set triggers are complete. See collection.test.mjs.

2026-09-13: ManaPotion and MakeItRain consume diamonds or preserved login tokens. PerkInfo 7.5 values, 12h independent expiry and 3+set-cap stacks; mana integrates offline expiry. Rain upgrades heroes strongest-first with binary-search affordable levels. Its instant gold/ascension and offline replay are NOT implemented; login token self-selection is explicitly a web approximation. Other perks and seasonal spending remain incomplete.

2.2.0: Pet combat fires on 20 accepted taps minus PetTapCountToAttack from the pinned tree. PetInfo damage coefficients use level 40/80 segments and active/passive sum, connected to existing build damage. The base build curve remains approximate. Pet auto-attack is deliberately not inferred from the obsolete 500-level condition (sources conflict across versions); special QTE/skip mechanics remain incomplete.

2.3.0: 390 short display names matched by stable IDs against extracted 8.2.0 ChineseTrad. Missing/untranslated names retain reviewed fallbacks. Numerical rules remain 7.5. HelperSkillInfo 370 rows match both snapshots. Base passive effects derive from current hero levels without changing saves; additive values sum and multiplicative values multiply. TapDamageFromHelpers, Goldx10Chance, MultiMonstersGold and PetGoldQTEAmount consumers remain pending. Scroll/Tactical Insight amplification and ascensions remain pending; levels above 2000 are not reachable. Existing hero milestone multiplier uses the highest reached row, not a product of cumulative rows.


2.4.0: Tactical Insight now boosts each unlocked, supported hero power before aggregation. For this unascended implementation, the power value is `base * (1 + corresponding TI bonus)`; additive powers then sum, multiplicative powers multiply. The TI bonus is applied per unlocked power, not once to the final total or to the player's base mana/critical chance. Numerical values stay pinned to 7.5 (level 1: 0.0032 multiplicative / 0.02 additive). Cache invalidates on both hero levels and boost changes. Resetting talents immediately clamps mana to the new cap.

Evidence and limits: [GameHive's original description](https://gamehive.com/blog/tap-titans-2-v20-patch-notes/) confirms the two hero-power boost categories. [TT2Master's CalculateHelperBoostEfficiency](https://github.com/nebula2/tt2-master/blob/3837595d662f542b5d8b5b81320eed21fb1a9d9b/src/TT2Master/Model/SP/SPOptSkill.cs) compounds `(1 + TI)` by the number/weight of affected powers; [lemmingllama's formula explanation](https://www.reddit.com/r/TapTitans2/comments/bm6hbx/scrolls_and_ti/) describes TI outside the ascension/scroll exponent. This is a reconstruction supported by tables and community models, not a completed IL2CPP method decompilation or same-version runtime verification. Scroll and ascension effects remain pending. Unsupported hero power consumers remain visibly pending and are not activated by TI.
