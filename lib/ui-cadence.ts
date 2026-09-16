// How often the screen is rebuilt, and when it is not rebuilt at all.
//
// The interval belongs to the simulation, not to the drawing: advance() is what has to run on a
// steady cadence, because gaps over 30 seconds fall to the coarse offline settlement instead of the
// per-100ms walk. A hidden tab therefore keeps ticking and only stops painting — skipping the redraw
// costs nothing there, since nobody is looking, and backgrounded play still earns at the live rate.
export const BATTLE_INTERVAL = 100;

/** Whether a frame should redraw, given document.visibilityState. */
export function redraws(visibility: string) {
  return visibility !== 'hidden';
}

// The upgrade panel gets its own, slower snapshot.
//
// This only saves anything because the panel is wrapped in React.memo and receives stable callbacks:
// an unchanged snapshot means React skips the subtree, and that subtree is the longest list on the
// page — a hundred bag items, 103 artifacts, 66 talents. Without the memo the element is rebuilt
// every frame whatever the props say, which is why the cadence alone measured no difference at all.
//
// The cost is bounded: between actions the panel is only waiting for gold to reach the next price,
// so a buy button can light up at most PANEL_INTERVAL−BATTLE_INTERVAL late.
export const PANEL_INTERVAL = 300;

/** Whether a frame at `now` should also rebuild the upgrade panel. */
export function panelDue(now: number, last: number) {
  return now - last >= PANEL_INTERVAL;
}

/**
 * Whether a player action has to rebuild the panel at once rather than wait for the next due frame.
 * Everything the player chooses does: an upgrade, a craft, a prestige changes the lists themselves.
 * Taps do not — they only move gold and health, which the cadence above already covers, and they
 * arrive as fast as the player can hit the titan.
 */
export function panelSyncsOn(type: string) {
  return type !== 'tap';
}
