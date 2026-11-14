import { TOWN_LAYOUT } from './avatar.mjs';

/**
 * Build an empty-pad marker (stone slab + OPEN PLOT #N signpost) matching
 * `buildEmptyPlotPad` in `town-3d/town.js`.
 */
export function buildEmptyPadMarker(THREE, plot, groundY, makeTextTexture) {
  const group = new THREE.Group();
  group.name = `plot_pad_${plot.plotNumber}`;
  group.position.set(plot.x, groundY, plot.z);
  group.rotation.y = plot.rotY;
  group.userData = {
    clickable: true,
    kind: 'open_plot',
    plotNumber: plot.plotNumber,
    label: `OPEN PLOT #${plot.plotNumber}`,
  };

  const stoneMat = new THREE.MeshStandardMaterial({ color: '#6e7278', roughness: 0.95 });
  const pad = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.18, 4.6), stoneMat);
  pad.position.set(0, 0.09, 0);
  group.add(pad);

  const signTex = makeTextTexture(THREE, [`OPEN PLOT #${plot.plotNumber}`], {
    width: 512,
    height: 160,
    titleSize: 30,
    bg: '#3b2b1d',
    border: '#7d5a3c',
  });
  const sign = new THREE.Mesh(
    new THREE.BoxGeometry(1.5, 0.75, 0.1),
    new THREE.MeshStandardMaterial({ map: signTex, roughness: 0.85 })
  );
  sign.name = `plot_${plot.plotNumber}_signpost`;
  sign.userData = { signpostText: `OPEN PLOT #${plot.plotNumber}` };
  sign.position.set(2.0, 0.45, 2.35);
  group.add(sign);

  return group;
}

/**
 * Reconcile empty-pad markers in `scene` against `liveStore.plotAssignments`
 * for plots 2..8. Idempotent; returns the number of markers present.
 */
export function syncEmptyPadMarkers(scene, liveStore, { THREE, makeTextTexture, groundAt }) {
  if (!liveStore.emptyPadMarkers) {
    liveStore.emptyPadMarkers = new Map();
  }
  const usedNumbers = new Set(
    [...liveStore.plotAssignments.values()].map((a) => a.plotNumber)
  );

  for (const plot of TOWN_LAYOUT.plots.slice(1)) {
    const isUsed = usedNumbers.has(plot.plotNumber);
    const existing = liveStore.emptyPadMarkers.get(plot.plotNumber);
    if (isUsed && existing) {
      existing.removeFromParent();
      liveStore.emptyPadMarkers.delete(plot.plotNumber);
    } else if (!isUsed && !existing) {
      const groundY = groundAt(plot.x, plot.z);
      const group = buildEmptyPadMarker(THREE, plot, groundY, makeTextTexture);
      scene.add(group);
      liveStore.emptyPadMarkers.set(plot.plotNumber, group);
    }
  }

  return liveStore.emptyPadMarkers.size;
}
