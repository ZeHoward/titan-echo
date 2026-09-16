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
