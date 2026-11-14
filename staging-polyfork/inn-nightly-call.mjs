// Staging-local Inn occupancy glow + Bandstand Nightly Call card updaters.
// Mirrors town-3d/town.js (updateInnOccupancy / splitNightlyCallLines /
// updateNightlyCallCard) adapted for the Polyfork Village Tavern's single
// interior night zone. No THREE import; no top-level document access.

export const INN_ROOM_KEYS = ['lantern', 'window', 'quiet'];
const DEFAULT_LIT_EMISSIVE_INTENSITY = 1.15;

/**
 * Determine whether the Ghostlight Inn taproom should be lit from `state.inn`.
 * Returns:
 *   - `true`  if any known room (`lantern`, `window`, `quiet`) has a non-null object claim
 *   - `false` if `innState` is a valid object and all three rooms are vacant
 *   - `null`  if `innState` is missing or malformed (caller must no-op)
 */
export function isInnOccupied(innState) {
  if (!innState || typeof innState !== 'object' || Array.isArray(innState)) {
    return null;
  }
  for (const room of INN_ROOM_KEYS) {
    const claim = Object.prototype.hasOwnProperty.call(innState, room) ? innState[room] : null;
    if (claim && typeof claim === 'object' && !Array.isArray(claim)) {
      return true;
    }
  }
  return false;
}

/**
 * Collect unique glow materials (`material.userData.glow === true`) inside the
 * placed Village Tavern group. `camp.light()` carves the tavern's single
 * `interior` night zone into `:lit` meshes with unique cloned materials, so
 * toggling their `emissiveIntensity` drives the taproom without touching any
 * other building or kit module.
 */
export function collectTavernGlowMaterials(tavernGroup) {
  if (!tavernGroup || typeof tavernGroup.traverse !== 'function') return [];
  const seen = new Set();
  const materials = [];
  tavernGroup.traverse((node) => {
    if (!node?.isMesh || !node.material) return;
    const mats = Array.isArray(node.material) ? node.material : [node.material];
    for (const mat of mats) {
      if (!mat || !mat.userData?.glow || seen.has(mat)) continue;
      if (typeof mat.userData.litEmissiveIntensity !== 'number') {
        mat.userData.litEmissiveIntensity =
          typeof mat.emissiveIntensity === 'number' && mat.emissiveIntensity > 0
            ? mat.emissiveIntensity
            : DEFAULT_LIT_EMISSIVE_INTENSITY;
      }
      seen.add(mat);
      materials.push(mat);
    }
  });
  return materials;
}

/**
 * Toggle the Village Tavern's single-zone taproom glow from `state.inn`.
 * Missing/non-object `innState` or missing `tavernGroup` is a no-op.
 */
export function updateStagingInnOccupancy(tavernGroup, innState) {
  const occupied = isInnOccupied(innState);
  if (occupied === null || !tavernGroup) return null;
  const materials = collectTavernGlowMaterials(tavernGroup);
  for (const mat of materials) {
    const litIntensity =
      typeof mat.userData?.litEmissiveIntensity === 'number' && mat.userData.litEmissiveIntensity > 0
        ? mat.userData.litEmissiveIntensity
        : DEFAULT_LIT_EMISSIVE_INTENSITY;
    mat.emissiveIntensity = occupied ? litIntensity : 0;
  }
  return occupied;
}

/**
 * Wrap a Nightly Call topic onto at most two lines near the middle when longer
 * than `maxLineLen` (mirrors `splitNightlyCallLines` in `town-3d/town.js`).
 */
export function splitNightlyCallLines(topic, maxLineLen = 60) {
  if (topic.length <= maxLineLen) return [topic];
  const mid = Math.floor(topic.length / 2);
  let splitIdx = -1;
  for (let offset = 0; offset < topic.length; offset++) {
    if (mid - offset > 0 && topic[mid - offset] === ' ') {
      splitIdx = mid - offset;
      break;
    }
    if (mid + offset < topic.length && topic[mid + offset] === ' ') {
      splitIdx = mid + offset;
      break;
    }
  }
  if (splitIdx === -1) {
    return [topic.slice(0, mid), topic.slice(mid)];
  }
  return [topic.slice(0, splitIdx).trim(), topic.slice(splitIdx + 1).trim()];
}

/**
 * Redraw the Bandstand's `nightly_call_card` texture from live `state.nightly_call`.
 * Missing card, missing/malformed `nightlyCall`, or unchanged topic is a no-op.
 */
export function updateStagingNightlyCallCard(
  { THREE, bandstandBuilt, liveStore, makeTextTexture },
  nightlyCall
) {
  if (!nightlyCall || typeof nightlyCall !== 'object' || Array.isArray(nightlyCall)) return false;
  if (typeof nightlyCall.topic !== 'string') return false;
  const topic = nightlyCall.topic.trim();
  if (!topic) return false;

  const card =
    bandstandBuilt?.nightlyCallCard ||
    (bandstandBuilt?.group?.children || []).find((c) => c && c.name === 'nightly_call_card') ||
    null;
  if (!card || !card.material || !THREE || !liveStore || typeof makeTextTexture !== 'function') {
    return false;
  }

  if (liveStore.nightlyCallTopic === topic) return false;

  card.material.map = makeTextTexture(THREE, ['THE NIGHTLY CALL', ...splitNightlyCallLines(topic)], {
    width: 512,
    height: 256,
    titleSize: 30,
    subSize: 20,
    bg: '#f2e6cf',
    border: '#b59449',
    fg: '#2b1e14',
  });
  card.material.needsUpdate = true;
  liveStore.nightlyCallTopic = topic;
  return true;
}
