// Staging-local Inn occupancy glow + Bandstand Nightly Call card updaters.
// Mirrors town-3d/town.js (updateInnOccupancy / splitNightlyCallLines /
// updateNightlyCallCard) adapted for the Polyfork Village Tavern: front upper
// windows glow per-room (`lantern`, `window`, `quiet`) while the fourth front
// upper window (`X(+3.60)`) is the stair window and stays dark; ground, back,
// and side panes keep the any-occupancy taproom rule. No THREE import; no
// top-level document access.

export const INN_ROOM_KEYS = ['lantern', 'window', 'quiet'];
const DEFAULT_LIT_EMISSIVE_INTENSITY = 1.15;

// Front upper windows in tavern-local coordinates (from kit-medieval/tavern.mjs
// at width 10: HZ = 2.90, pane offset WPW = 0.04 => z = 2.94; upper cy = 4.25;
// X(x) = x at width 10). X(+3.60) is the stair window (not a room) and always
// stays dark.
const FRONT_UPPER_Z = 2.94;
const FRONT_UPPER_Y = 4.25;
const FRONT_UPPER_Z_TOL = 0.20;
const FRONT_UPPER_Y_TOL = 0.60;
const FRONT_UPPER_X_TOL = 0.60;
const FRONT_UPPER_WINDOWS = [
  { zone: 'lantern', x: -3.60 },
  { zone: 'window', x: -1.90 },
  { zone: 'quiet', x: 1.90 },
  { zone: 'stair', x: 3.60 },
];

function isRoomClaimed(innState, room) {
  if (!innState || typeof innState !== 'object' || Array.isArray(innState)) return false;
  const claim = Object.prototype.hasOwnProperty.call(innState, room) ? innState[room] : null;
  return Boolean(claim && typeof claim === 'object' && !Array.isArray(claim));
}

function classifyFrontUpperPoint(x, y, z) {
  if (Math.abs(z - FRONT_UPPER_Z) > FRONT_UPPER_Z_TOL) return null;
  if (Math.abs(y - FRONT_UPPER_Y) > FRONT_UPPER_Y_TOL) return null;
  for (const win of FRONT_UPPER_WINDOWS) {
    if (Math.abs(x - win.x) <= FRONT_UPPER_X_TOL) return win.zone;
  }
  return null;
}

function getLitIntensity(mat) {
  if (typeof mat.userData?.litEmissiveIntensity === 'number' && mat.userData.litEmissiveIntensity > 0) {
    return mat.userData.litEmissiveIntensity;
  }
  const intensity =
    typeof mat.emissiveIntensity === 'number' && mat.emissiveIntensity > 0
      ? mat.emissiveIntensity
      : DEFAULT_LIT_EMISSIVE_INTENSITY;
  if (mat.userData) mat.userData.litEmissiveIntensity = intensity;
  return intensity;
}

function cloneGlowMaterial(mat, litIntensity) {
  const cloned = typeof mat.clone === 'function' ? mat.clone() : { ...mat };
  cloned.userData = {
    ...(mat.userData || {}),
    glow: true,
    litEmissiveIntensity: litIntensity,
  };
  return cloned;
}

function sliceBufferGeometry(srcGeo, triIndices) {
  const dstGeo = new srcGeo.constructor();
  for (const [name, attr] of Object.entries(srcGeo.attributes)) {
    const itemSize = attr.itemSize;
    const out = new attr.array.constructor(triIndices.length * 3 * itemSize);
    for (let j = 0; j < triIndices.length; j++) {
      const t = triIndices[j];
      out.set(attr.array.subarray(t * 3 * itemSize, (t + 1) * 3 * itemSize), j * 3 * itemSize);
    }
    dstGeo.setAttribute(name, new attr.constructor(out, itemSize, attr.normalized));
  }
  return dstGeo;
}

function splitMergedGlowMesh(mesh) {
  const geo = mesh.geometry;
  const pos = geo?.attributes?.position;
  if (!pos || geo.index || pos.itemSize !== 3 || pos.count < 3 || pos.count % 3 !== 0) {
    return;
  }
  const tris = pos.count / 3;
  const buckets = new Map();
  for (let t = 0; t < tris; t++) {
    const i0 = t * 3;
    const cx = (pos.getX(i0) + pos.getX(i0 + 1) + pos.getX(i0 + 2)) / 3;
    const cy = (pos.getY(i0) + pos.getY(i0 + 1) + pos.getY(i0 + 2)) / 3;
    const cz = (pos.getZ(i0) + pos.getZ(i0 + 1) + pos.getZ(i0 + 2)) / 3;
    const zone = classifyFrontUpperPoint(cx, cy, cz) || 'rest';
    let list = buckets.get(zone);
    if (!list) {
      list = [];
      buckets.set(zone, list);
    }
    list.push(t);
  }

  mesh.userData = { ...(mesh.userData || {}), innRoomSplitDone: true };
  if (buckets.size === 1) {
    mesh.userData.innZone = buckets.keys().next().value;
    return;
  }

  const hasFrontUpper =
    buckets.has('lantern') || buckets.has('window') || buckets.has('quiet') || buckets.has('stair');
  if (!hasFrontUpper) {
    mesh.userData.innZone = 'rest';
    return;
  }

  const restTris = buckets.get('rest') || [];
  mesh.geometry = sliceBufferGeometry(geo, restTris);
  mesh.userData.innZone = 'rest';

  const baseMat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  const litIntensity = getLitIntensity(baseMat);
  for (const [zone, triIndices] of buckets.entries()) {
    if (zone === 'rest') continue;
    const subGeo = sliceBufferGeometry(geo, triIndices);
    const subMat = cloneGlowMaterial(baseMat, litIntensity);
    const subMesh = new mesh.constructor(subGeo, subMat);
    subMesh.name = `${mesh.name || 'tavern-shell:lit'}:${zone}`;
    subMesh.castShadow = false;
    subMesh.receiveShadow = mesh.receiveShadow;
    subMesh.userData = { ...(subMesh.userData || {}), innRoomSplitDone: true, innZone: zone };
    mesh.add(subMesh);
  }
}

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
  return INN_ROOM_KEYS.some((room) => isRoomClaimed(innState, room));
}

/**
 * Collect unique glow materials (`material.userData.glow === true`) inside the
 * placed Village Tavern group. `camp.light()` carves the tavern's single
 * `interior` night zone into one `:lit` mesh (`tavern-shell:lit`), which
 * `updateStagingInnOccupancy` splits once so each front-upper room window has
 * its own cloned material.
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
      getLitIntensity(mat);
      seen.add(mat);
      materials.push(mat);
    }
  });
  return materials;
}

/**
 * Update the Village Tavern's glow from `state.inn`:
 *   - Front upper windows (`cy` 4.25, `z` ~+2.94): `lantern` at `X(-3.60)`,
 *     `window` at `X(-1.90)`, `quiet` at `X(+1.90)` light only when their own
 *     room is claimed; `X(+3.60)` is the stair window and stays dark always.
 *   - Every other glow surface (ground front, back, side panes, interior walls)
 *     lights when ANY room is claimed and dims when all three are vacant.
 * Missing/non-object `innState` or missing `tavernGroup` is a strict no-op.
 */
export function updateStagingInnOccupancy(tavernGroup, innState) {
  const occupied = isInnOccupied(innState);
  if (occupied === null || !tavernGroup || typeof tavernGroup.traverse !== 'function') return null;

  const initialGlowMeshes = [];
  tavernGroup.traverse((node) => {
    if (!node?.isMesh || !node.material) return;
    const mats = Array.isArray(node.material) ? node.material : [node.material];
    if (mats.some((m) => m && m.userData?.glow)) {
      initialGlowMeshes.push(node);
    }
  });

  for (const mesh of initialGlowMeshes) {
    if (!mesh.userData?.innRoomSplitDone) {
      if (mesh.geometry?.attributes?.position) {
        splitMergedGlowMesh(mesh);
      } else {
        const pos = mesh.position;
        const zone =
          pos && typeof pos.x === 'number' && typeof pos.y === 'number' && typeof pos.z === 'number'
            ? classifyFrontUpperPoint(pos.x, pos.y, pos.z) || 'rest'
            : 'rest';
        mesh.userData = { ...(mesh.userData || {}), innRoomSplitDone: true, innZone: zone };
      }
    }
  }

  const allGlowMeshes = [];
  tavernGroup.traverse((node) => {
    if (!node?.isMesh || !node.material) return;
    const mats = Array.isArray(node.material) ? node.material : [node.material];
    if (mats.some((m) => m && m.userData?.glow)) {
      allGlowMeshes.push(node);
    }
  });

  const seenMats = new Set();
  for (const mesh of allGlowMeshes) {
    const zone = mesh.userData?.innZone || 'rest';
    let lit = false;
    if (zone === 'stair') {
      lit = false;
    } else if (INN_ROOM_KEYS.includes(zone)) {
      lit = isRoomClaimed(innState, zone);
    } else {
      lit = occupied;
    }

    const isArray = Array.isArray(mesh.material);
    const mats = isArray ? mesh.material : [mesh.material];
    const nextMats = mats.map((mat) => {
      if (!mat || !mat.userData?.glow) return mat;
      const litIntensity = getLitIntensity(mat);
      let targetMat = mat;
      if (seenMats.has(mat)) {
        targetMat = cloneGlowMaterial(mat, litIntensity);
      }
      seenMats.add(targetMat);
      targetMat.emissiveIntensity = lit ? litIntensity : 0;
      return targetMat;
    });
    if (isArray) {
      mesh.material = nextMats;
    } else {
      mesh.material = nextMats[0];
    }
  }

  return occupied;
}

/**
 * Greedy word-wrap a Nightly Call topic into lines of at most `maxLineLen`
 * characters. Deliberately NOT the `town-3d/town.js` split: that one only
 * splits topics longer than 60 chars, and a 51-char topic on the card
 * texture overflows both edges (found by the 2026-11-14 go-live check).
 * Two call sites share this helper:
 *   - `updateStagingNightlyCallCard` (and the `concept-bandstand.js`
 *     placeholder) pass `maxLineLen = 22` for 68px bold monospace (~40.8px/char
 *     inside ~992px usable width on the 1024×512 card); every curated topic
 *     (longest 53 chars) wraps to at most 3 lines.
 *   - `event-banner.mjs` calls with the default `30` for its 768px banner.
 * Words longer than `maxLineLen` are hard-chunked.
 */
export function splitNightlyCallLines(topic, maxLineLen = 30) {
  if (topic.length <= maxLineLen) return [topic];
  const lines = [];
  let current = '';
  const pushWord = (word) => {
    if (word.length <= maxLineLen) {
      if (current.length === 0) {
        current = word;
      } else if (current.length + 1 + word.length <= maxLineLen) {
        current += ' ' + word;
      } else {
        lines.push(current);
        current = word;
      }
      return;
    }
    if (current.length > 0) {
      lines.push(current);
      current = '';
    }
    for (let i = 0; i < word.length; i += maxLineLen) {
      lines.push(word.slice(i, i + maxLineLen));
    }
  };
  for (const word of topic.split(' ')) {
    if (word.length > 0) pushWord(word);
  }
  if (current.length > 0) lines.push(current);
  return lines;
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

  card.material.map = makeTextTexture(THREE, ['THE NIGHTLY CALL', ...splitNightlyCallLines(topic, 22)], {
    width: 1024,
    height: 512,
    titleSize: 80,
    subSize: 68,
    borderWidth: 16,
    bg: '#f2e6cf',
    border: '#b59449',
    fg: '#2b1e14',
  });
  card.material.needsUpdate = true;
  liveStore.nightlyCallTopic = topic;
  return true;
}
