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
