import {
  buildProceduralOilLamp,
  buildProceduralTypewriter,
  buildProceduralTeapot,
} from './interior-room.mjs';

// Cottage-local placement beside the front door, left of the porch deck
// (deck spans x in [-2.4, 2.4], z in [2.3, 3.5]) and clear of the signpost
// at (2.3, 0.18, 2.6) and unfolded manifest porch props.
const SEED_DOOR_PROP_POS = [-2.9, 0, 2.9];

// Approximation: world rotY values from town-3d/town.js PROP_PLACEMENTS
// reused verbatim as cottage-local rotY.
const SEED_DOOR_PROPS = {
  wick: { build: buildProceduralOilLamp, rotY: -1.1733 },
  maren: { build: buildProceduralTypewriter, rotY: -0.6525 },
  tomas: { build: buildProceduralTeapot, rotY: -0.1322 },
};

/**
 * Attach a seed resident's procedural door-side character prop to a cottage.
 * Returns the attached group, or null for unknown handles and 'milo'.
 */
export function attachSeedDoorProp(THREE, cottage, handle) {
  if (typeof handle !== 'string' || !Object.prototype.hasOwnProperty.call(SEED_DOOR_PROPS, handle)) {
    return null;
  }
  const spec = SEED_DOOR_PROPS[handle];
  const group = spec.build(THREE);
  group.name = `seed_door_prop_${handle}`;
  group.position.set(SEED_DOOR_PROP_POS[0], SEED_DOOR_PROP_POS[1], SEED_DOOR_PROP_POS[2]);
  group.rotation.y = spec.rotY;
  cottage.add(group);
  return group;
}
