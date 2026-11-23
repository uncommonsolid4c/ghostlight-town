// Communal garden bed by the Bandstand for staging-polyfork:
// Fixed 6-slot bed off the bandstand's east edge, with deterministic sprout -> leaf -> bloom stages.

const CEDAR = '#6b492b';
const SOIL = '#3b2a1d';
const SPROUT_GREEN = '#a8c686';
const STEM_GREEN = '#5a8f49';
const LEAF_GREEN = '#7fb069';

// Bandstand deck sits at (0, 0) with radius 4.5 m; placing the 2.4 m x 1.6 m bed
// at x = 6.5, z = 0 leaves 0.8 m clearance from the deck's east edge and stays
// well clear of the well (6, 8), newsstand (6, 14), plot 1 (17.92, 4.60), and 45° shore.
export const GARDEN_BED = Object.freeze({ x: 6.5, z: 0 });

export const SEED_COLORS = Object.freeze({
  moonflower: '#dfe9ff',
  lantern_poppy: '#ff9a3c',
  tea_mint: '#7fb069',
  starwort: '#c9a7eb',
  ghost_bell: '#a8d8ea',
  silver_thyme: '#b8c4b0',
});

const BED_WIDTH = 2.4;
const BED_DEPTH = 1.6;
const FRAME_THICK = 0.1;
const FRAME_HEIGHT = 0.28;
const SOIL_HEIGHT = 0.22;

/**
 * Derive growth stage from whole UTC days since planting (neglect-proof: caps at bloom).
 */
export function gardenStageForAgeDays(ageDays) {
  if (!Number.isFinite(ageDays) || ageDays < 2) return 'sprout';
  if (ageDays < 4) return 'leaf';
  return 'bloom';
}

function addSproutLeaves(THREE, group) {
  const leafMat = new THREE.MeshStandardMaterial({ color: SPROUT_GREEN, roughness: 0.8 });
  for (let i = 0; i < 2; i++) {
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.02, 0.04), leafMat);
    leaf.name = `plant-sprout-leaf-${i}`;
    leaf.position.set(i === 0 ? -0.04 : 0.04, 0.02, 0);
    leaf.rotation.z = i === 0 ? 0.35 : -0.35;
    group.add(leaf);
  }
}

function addStemAndLeaves(THREE, group) {
  const stemMat = new THREE.MeshStandardMaterial({ color: STEM_GREEN, roughness: 0.85 });
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.028, 0.24, 6), stemMat);
  stem.name = 'plant-stem';
  stem.position.set(0, 0.12, 0);
  group.add(stem);

  const leafMat = new THREE.MeshStandardMaterial({ color: LEAF_GREEN, roughness: 0.8 });
  const angles = [0, (2 * Math.PI) / 3, (4 * Math.PI) / 3];
  for (let i = 0; i < 3; i++) {
    const a = angles[i];
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.02, 0.05), leafMat);
    leaf.name = `plant-leaf-${i}`;
    leaf.position.set(Math.cos(a) * 0.07, 0.14 + i * 0.02, Math.sin(a) * 0.07);
    leaf.rotation.y = -a;
    leaf.rotation.z = 0.3;
    group.add(leaf);
  }
}

/**
 * Build a single 3D plant group for { seed, stage }.
 * Unknown seed or stage fails soft to a sprout without throwing.
 */
export function buildGardenPlant(THREE, { seed, stage } = {}) {
  const knownSeed = typeof seed === 'string' && Object.hasOwn(SEED_COLORS, seed);
  const validStage = stage === 'sprout' || stage === 'leaf' || stage === 'bloom';
  const effectiveStage = knownSeed && validStage ? stage : 'sprout';

  const group = new THREE.Group();
  group.name = `garden-plant-${seed || 'unknown'}-${stage || 'sprout'}`;

  if (effectiveStage === 'sprout') {
    addSproutLeaves(THREE, group);
    return group;
  }

  addStemAndLeaves(THREE, group);

  if (effectiveStage === 'bloom') {
    const flowerMat = new THREE.MeshStandardMaterial({
      color: SEED_COLORS[seed],
      roughness: 0.65,
    });
    const flower = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8), flowerMat);
    flower.name = 'plant-flower';
    flower.position.set(0, 0.28, 0);
    group.add(flower);
  }

  return group;
}

function slotLocalPosition(slot) {
  const row = Math.floor(slot / 3);
  const col = slot % 3;
  return {
    x: (col - 1) * 0.7,
    y: SOIL_HEIGHT,
    z: (row - 0.5) * 0.6,
  };
}

function buildPlantsGroup(THREE, garden) {
  const plantsGroup = new THREE.Group();
  plantsGroup.name = 'garden-plants';
  const slots = Array.isArray(garden?.slots) ? garden.slots : [];
  for (const entry of slots) {
    if (!entry || !Number.isInteger(entry.slot) || entry.slot < 0 || entry.slot > 5) continue;
    const plant = buildGardenPlant(THREE, { seed: entry.seed, stage: entry.stage });
    const pos = slotLocalPosition(entry.slot);
    plant.position.set(pos.x, pos.y, pos.z);
    plantsGroup.add(plant);
  }
  return plantsGroup;
}

/**
 * Build the communal 6-slot garden bed at GARDEN_BED.
 */
export function buildGardenBed(THREE, { garden = { slots: [] }, y = 0 } = {}) {
  const group = new THREE.Group();
  group.name = 'garden-bed';
  group.position.set(GARDEN_BED.x, y, GARDEN_BED.z);

  const cedarMat = new THREE.MeshStandardMaterial({ color: CEDAR, roughness: 0.9 });
  const soilMat = new THREE.MeshStandardMaterial({ color: SOIL, roughness: 0.95 });

  const soil = new THREE.Mesh(
    new THREE.BoxGeometry(BED_WIDTH - FRAME_THICK * 2, SOIL_HEIGHT, BED_DEPTH - FRAME_THICK * 2),
    soilMat
  );
  soil.name = 'garden-soil';
  soil.position.set(0, SOIL_HEIGHT / 2, 0);
  group.add(soil);

  const northRail = new THREE.Mesh(new THREE.BoxGeometry(BED_WIDTH, FRAME_HEIGHT, FRAME_THICK), cedarMat);
  northRail.name = 'garden-frame-north';
  northRail.position.set(0, FRAME_HEIGHT / 2, -(BED_DEPTH - FRAME_THICK) / 2);
  group.add(northRail);

  const southRail = new THREE.Mesh(new THREE.BoxGeometry(BED_WIDTH, FRAME_HEIGHT, FRAME_THICK), cedarMat);
  southRail.name = 'garden-frame-south';
  southRail.position.set(0, FRAME_HEIGHT / 2, (BED_DEPTH - FRAME_THICK) / 2);
  group.add(southRail);

  const westRail = new THREE.Mesh(
    new THREE.BoxGeometry(FRAME_THICK, FRAME_HEIGHT, BED_DEPTH - FRAME_THICK * 2),
    cedarMat
  );
  westRail.name = 'garden-frame-west';
  westRail.position.set(-(BED_WIDTH - FRAME_THICK) / 2, FRAME_HEIGHT / 2, 0);
  group.add(westRail);

  const eastRail = new THREE.Mesh(
    new THREE.BoxGeometry(FRAME_THICK, FRAME_HEIGHT, BED_DEPTH - FRAME_THICK * 2),
    cedarMat
  );
  eastRail.name = 'garden-frame-east';
  eastRail.position.set((BED_WIDTH - FRAME_THICK) / 2, FRAME_HEIGHT / 2, 0);
  group.add(eastRail);

  group.add(buildPlantsGroup(THREE, garden));
  return group;
}

/**
 * Rebuild the 'garden-plants' subgroup inside an existing bedGroup from updated garden state.
 */
export function updateGardenBed(THREE, bedGroup, garden = { slots: [] }) {
  if (!bedGroup) return null;
  const oldIdx = bedGroup.children.findIndex((c) => c.name === 'garden-plants');
  if (oldIdx !== -1) {
    bedGroup.children.splice(oldIdx, 1);
  }
  const nextPlants = buildPlantsGroup(THREE, garden);
  bedGroup.add(nextPlants);
  return nextPlants;
}
