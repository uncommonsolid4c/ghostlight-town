// Staging-local NPC stand-in Idle animation wrapper (Slice 68).
// No top-level THREE or document access so unit tests can run headless in Node.

/**
 * Attach the vendored Idle clip to a humanoid stand-in via Polyfork's animate().
 * Never throws or rejects: on any failure (missing bones, bad fetch, etc.) it logs
 * one warning and returns null so the stand-in stays still.
 */
export async function attachIdleAnimation(THREE, group, { animateFn, base = './anim/' } = {}) {
  if (!group) return null;
  try {
    const fn = animateFn ?? (await import('./kit-medieval/clips.mjs')).animate;
    return await fn(group, { clips: ['Idle'], base });
  } catch (err) {
    console.warn('[npc-animation] Idle clip failed to attach; stand-in stays still:', err?.message || err);
    return null;
  }
}

/**
 * Advance each stand-in's animation mixer by dt seconds.
 * Skips null/missing handles silently; updates even while yielded (hidden) to keep phase continuous.
 */
export function updateNpcAnimations(standIns, dt) {
  if (!standIns) return;
  const entries = typeof standIns.values === 'function' ? standIns.values() : standIns;
  for (const standIn of entries) {
    if (standIn?.anim && typeof standIn.anim.update === 'function') {
      standIn.anim.update(dt);
    }
  }
}
