import * as THREE from 'three';
import { mergeGeometries } from '../../vendor/BufferGeometryUtils.js';
import {
  toon, rand, randInt, mulberry32, TAU, makeGrassTexture, makeFlowerTexture,
  makeSoftTexture, addOutline, clamp, fbm
} from '../core/utils.js';
import { heightAt, isWater, roadDistance, WORLD_RADIUS } from './terrain.js';

function windMaterial(color, strength = 0.05) {
  const m = toon(color, { rim: 0.1, rimColor: 0xdfffe4 });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <project_vertex>', `
        #ifdef USE_INSTANCING
          float phase = instanceMatrix[3][0] * 0.16 + instanceMatrix[3][2] * 0.13;
        #else
          float phase = 0.0;
        #endif
        float sway = sin(uTime * 0.85 + phase) * ${strength.toFixed(3)};
        transformed.x += sway * max(transformed.y, 0.0);
        transformed.z += cos(uTime * 0.7 + phase) * ${(strength * 0.7).toFixed(3)} * max(transformed.y, 0.0);
        #include <project_vertex>`);
    m.userData.shader = shader;
  };
  m.customProgramCacheKey = () => 'wind-' + strength;
  return m;
}

function makeInstance(geo, mat, entries, { cast = false, receive = false } = {}) {
  const mesh = new THREE.InstancedMesh(geo, mat, entries.length);
  const dummy = new THREE.Object3D();
  const col = new THREE.Color();
  entries.forEach((e, i) => {
    dummy.position.set(e.x, e.y ?? heightAt(e.x, e.z), e.z);
    dummy.rotation.set(e.rx || 0, e.ry ?? rand(0, TAU), e.rz || 0);
    const s = e.s ?? 1;
    dummy.scale.set(e.sx ?? s, e.sy ?? s, e.sz ?? s);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    if (e.color !== undefined) mesh.setColorAt(i, col.set(e.color));
  });
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = cast; mesh.receiveShadow = receive;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}

function treeCanopyGeo(blobs) {
  const parts = [];
  for (const [x, y, z, r] of blobs) {
    const g = new THREE.IcosahedronGeometry(r, 1);
    g.scale(1, .82, 1);
    g.translate(x, y, z);
    parts.push(g);
  }
  return mergeGeometries(parts);
}

export function buildVegetation(scene, exclusions = [], quality = 2) {
  const rnd = mulberry32(9231);
  const group = new THREE.Group(); group.name = 'vegetation';
  scene.add(group);

  const blocked = (x, z, pad = 0) => {
    if (isWater(x, z)) return true;
    if (Math.hypot(x, z) > WORLD_RADIUS - 8) return true;
    if (roadDistance(x, z) < 3.2 + pad) return true;
    for (const e of exclusions) if (Math.hypot(x - e.x, z - e.z) < e.r + pad) return true;
    return false;
  };

  /* ---------- trees ---------- */
  const roundTrunk = new THREE.CylinderGeometry(.17, .3, 3.4, 6).translate(0, 1.7, 0);
  const roundCanopy = treeCanopyGeo([[0, 3.9, 0, 1.5], [.8, 4.6, .4, 1.05], [-.85, 4.4, -.3, 1.0], [.1, 5.5, -.2, .95], [-.1, 4.0, .95, .85]]);
  const pineTrunk = new THREE.CylinderGeometry(.14, .26, 3.4, 6).translate(0, 1.7, 0);
  const pineParts = [];
  for (let i = 0; i < 4; i++) {
    const g = new THREE.ConeGeometry(1.5 - i * .27, 1.9, 7);
    g.translate(0, 3.1 + i * 1.05, 0); pineParts.push(g);
  }
  const pineCanopy = mergeGeometries(pineParts);
  const cherryCanopy = treeCanopyGeo([[0, 3.8, 0, 1.65], [1, 4.4, .3, 1.1], [-.9, 4.5, -.4, 1.05], [0, 5.6, -.3, 1.0], [.2, 4.1, 1.0, .9]]);
  const oliveCanopy = treeCanopyGeo([[0, 4.0, 0, 1.35], [.9, 5.0, .2, .95], [-.8, 4.7, -.5, .9], [-.2, 5.8, .3, .75]]);

  const treeSpots = [];
  const forestCenters = [[-100, 35, 24], [105, -22, 22], [-78, 88, 20], [96, 66, 22], [-112, -60, 18], [70, 95, 16], [125, 18, 20], [-60, 110, 18]];
  let attempts = 0;
  while (treeSpots.length < (quality >= 2 ? 300 : 190) && attempts < 3200) {
    attempts++;
    const a = rnd() * TAU, r = Math.sqrt(rnd()) * (WORLD_RADIUS - 12);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const dv = Math.hypot(x, z - 32);
    if (dv < 22) continue;
    if (blocked(x, z, 1)) continue;
    let forestBias = 0.35;
    for (const [fx, fz, fr] of forestCenters) {
      const d = Math.hypot(x - fx, z - fz);
      if (d < fr) forestBias += (1 - d / fr) * 0.8;
    }
    const n = fbm(x * 0.036 + 5, z * 0.036 + 2, 3);
    if (rnd() > forestBias * 0.55 + n * 0.6) continue;
    // keep a rough clearing for sightlines along the road
    if (Math.abs(x) < 8 && z > -90 && z < 55 && rnd() < .7) continue;
    treeSpots.push({ x, z, r: rnd(), scale: rand(.8, 1.35), rot: rnd() * TAU });
  }

  const deciduous = [], pines = [], cherries = [], olives = [], trunks = [], pineTrunks = [], cherryTrunks = [], oliveTrunks = [];
  const shadows = [];
  for (const t of treeSpots) {
    const y = heightAt(t.x, t.z);
    const kind = t.r;
    const color = new THREE.Color();
    if (kind < .3) {
      color.setHSL(rand(.24, .32), rand(.34, .5), rand(.32, .44));
      olives.push({ x: t.x, z: t.z, y, s: t.scale, ry: t.rot, color });
      oliveTrunks.push({ x: t.x, z: t.z, y, s: t.scale, ry: t.rot, color: new THREE.Color().setHSL(.08, .35, rand(.24, .34)) });
    } else if (kind < .56) {
      color.setHSL(rand(.07, .12), rand(.4, .56), rand(.34, .45));
      pines.push({ x: t.x, z: t.z, y, s: t.scale, ry: t.rot, color });
      pineTrunks.push({ x: t.x, z: t.z, y, s: t.scale, ry: t.rot, color: new THREE.Color().setHSL(.07, .3, .27) });
    } else if (kind < .66) {
      color.setHSL(rand(.93, .98), rand(.38, .52), rand(.72, .83));
      cherries.push({ x: t.x, z: t.z, y, s: t.scale, ry: t.rot, color });
      cherryTrunks.push({ x: t.x, z: t.z, y, s: t.scale, ry: t.rot, color: new THREE.Color().setHSL(.06, .22, .3) });
    } else {
      color.setHSL(rand(.19, .3), rand(.36, .54), rand(.33, .46));
      if (rnd() < .18) color.setHSL(rand(.06, .1), rand(.5, .64), rand(.44, .55)); // autumn gold
      deciduous.push({ x: t.x, z: t.z, y, s: t.scale, ry: t.rot, color });
      trunks.push({ x: t.x, z: t.z, y, s: t.scale, ry: t.rot, color: new THREE.Color().setHSL(.07, .34, rand(.23, .32)) });
    }
    shadows.push({ x: t.x, z: t.z, y: y + .03, s: t.scale * 2.4, rx: -Math.PI / 2, ry: 0, color: 0x12331f });
  }

  const trunkMat = toon(0xffffff, { rim: 0.06, rimColor: 0xffe0b0 });
  const leafMat = windMaterial(0xffffff, .045);
  const leafMat2 = windMaterial(0xffffff, .025);

  group.add(makeInstance(roundCanopy, leafMat, deciduous));
  group.add(makeInstance(roundTrunk, trunkMat, trunks));
  group.add(makeInstance(pineCanopy, leafMat2, pines));
  group.add(makeInstance(pineTrunk, trunkMat, pineTrunks));
  group.add(makeInstance(cherryCanopy, leafMat, cherries));
  group.add(makeInstance(roundTrunk, trunkMat, cherryTrunks));
  group.add(makeInstance(oliveCanopy, leafMat2, olives));
  group.add(makeInstance(roundTrunk, trunkMat, oliveTrunks));

  const shadowMat = new THREE.MeshBasicMaterial({ color: 0x18351f, transparent: true, opacity: .22, depthWrite: false });
  const shadowMesh = makeInstance(new THREE.CircleGeometry(1, 10), shadowMat, shadows);
  shadowMesh.renderOrder = 1;
  group.add(shadowMesh);

  /* ---------- rocks ---------- */
  const rockGeo = new THREE.DodecahedronGeometry(.8, 0);
  const rockEntries = [];
  const rockColors = ['#6f6c78', '#5e5b68', '#7a7480', '#55525e', '#837b84'];
  for (let i = 0; i < (quality >= 2 ? 220 : 140); i++) {
    const a = rnd() * TAU, r = Math.sqrt(rnd()) * (WORLD_RADIUS - 6);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (blocked(x, z, -.5)) continue;
    if (Math.hypot(x, z - 32) < 18) continue;
    if (Math.abs(x) < 12 && z > 14 && z < 62) continue;
    if (Math.hypot(x - 24, z - 60) < 16) continue;
    const s = rand(.35, 1.5);
    rockEntries.push({
      x, z, y: heightAt(x, z) + s * .25, s, sy: s * rand(.6, 1.1),
      ry: rnd() * TAU, rx: rand(0, .6), color: rockColors[(rnd() * rockColors.length) | 0],
    });
  }
  group.add(makeInstance(rockGeo, toon(0xffffff, { rim: .16, rimColor: 0xcfe4ff }), rockEntries, { cast: false, receive: true }));

  // big boulder clusters near world rim
  const boulders = [];
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * TAU + rand(-.1, .1);
    const r = rand(132, 152);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const s = rand(3, 9);
    boulders.push({ x, z, y: heightAt(x, z) + s * .3, sx: s, sy: s * rand(.9, 1.6), sz: s, ry: rnd() * TAU, rx: rand(-.3, .3), color: 0x7e7888 });
  }
  group.add(makeInstance(rockGeo, toon(0xffffff, { rim: .12, rimColor: 0xbfd4ff }), boulders));

  /* ---------- bushes ---------- */
  const bushGeo = treeCanopyGeo([[0, .55, 0, .75], [.6, .5, .2, .55], [-.55, .45, -.1, .6]]);
  const bushes = [];
  for (let i = 0; i < (quality >= 2 ? 200 : 120); i++) {
    const a = rnd() * TAU, r = Math.sqrt(rnd()) * 120;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (blocked(x, z, -1)) continue;
    if (Math.hypot(x, z - 32) < 17) continue;
    bushes.push({ x, z, y: heightAt(x, z), s: rand(.55, 1.3), ry: rnd() * TAU, color: new THREE.Color().setHSL(rand(.22, .32), rand(.35, .55), rand(.3, .44)) });
  }
  group.add(makeInstance(bushGeo, leafMat2, bushes));

  /* ---------- grass tufts ---------- */
  const grassTex = makeGrassTexture();
  const grassMat = new THREE.MeshLambertMaterial({ map: grassTex, transparent: true, alphaTest: .35, side: THREE.DoubleSide, depthWrite: true, color: 0xffffff });
  const bladeGeo = mergeGeometries([
    new THREE.PlaneGeometry(1.15, .95).translate(0, .47, 0),
    new THREE.PlaneGeometry(1.15, .95).rotateY(Math.PI / 2).translate(0, .47, 0),
  ]);
  const tufts = [];
  const N = quality >= 2 ? 3400 : 1400;
  for (let i = 0; i < N; i++) {
    const a = rnd() * TAU, r = Math.sqrt(rnd()) * 118;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (isWater(x, z) || roadDistance(x, z) < 1.6) continue;
    if (Math.hypot(x - 0, z - 32) < 10) continue;
    let blockedByPoi = false;
    for (const e of exclusions) if (Math.hypot(x - e.x, z - e.z) < e.r * .8) { blockedByPoi = true; break; }
    if (blockedByPoi) continue;
    tufts.push({
      x, z, y: heightAt(x, z), s: rand(.62, 1.3), sy: rand(.7, 1.5), ry: rnd() * TAU,
      color: new THREE.Color().setHSL(rand(.2, .3), rand(.35, .6), rand(.42, .62)),
    });
  }
  const grassMesh = makeInstance(bladeGeo, grassMat, tufts);
  grassMesh.receiveShadow = false;
  group.add(grassMesh);

  /* ---------- flowers ---------- */
  const flowerColors = ['#ffd6e6', '#ffe58a', '#c9b3ff', '#ffb59b', '#a8e8ff'];
  const flowerGeo = mergeGeometries([
    new THREE.PlaneGeometry(.55, .55).translate(0, .3, 0),
    new THREE.PlaneGeometry(.55, .55).rotateY(Math.PI / 2).translate(0, .3, 0),
  ]);
  flowerColors.forEach((col, idx) => {
    const tex = makeFlowerTexture(col);
    const mat = new THREE.MeshLambertMaterial({ map: tex, transparent: true, alphaTest: .4, side: THREE.DoubleSide, depthWrite: true });
    const arr = [];
    for (let i = 0; i < (quality >= 2 ? 150 : 60); i++) {
      const a = rnd() * TAU, r = Math.sqrt(rnd()) * 100;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (isWater(x, z) || roadDistance(x, z) < 1.5) continue;
      arr.push({ x, z, y: heightAt(x, z), s: rand(.7, 1.4), ry: rnd() * TAU });
    }
    group.add(makeInstance(flowerGeo, mat, arr));
  });

  /* ---------- reeds along water ---------- */
  const reedMat = new THREE.MeshLambertMaterial({ map: grassTex, transparent: true, alphaTest: .3, side: THREE.DoubleSide, color: 0x7c9a54 });
  const reeds = [];
  for (let i = 0; i < 450; i++) {
    const z = rand(-120, 120);
    const side = rnd() > .5 ? 1 : -1;
    const x = riverXLocal(z) + side * rand(5.5, 8.5);
    if (Math.hypot(x, z) > 140) continue;
    reeds.push({ x, z, y: heightAt(x, z), s: rand(.7, 1.4), sy: rand(1, 1.8), ry: rnd() * TAU, color: new THREE.Color().setHSL(rand(.14, .24), .4, rand(.35, .5)) });
  }
  // lake edge
  for (let i = 0; i < 150; i++) {
    const a = rnd() * TAU, r = 18 + rnd() * 5;
    const x = 58 + Math.cos(a) * r, z = -78 + Math.sin(a) * r;
    reeds.push({ x, z, y: heightAt(x, z), s: rand(.7, 1.3), sy: rand(1, 1.7), ry: rnd() * TAU, color: new THREE.Color().setHSL(rand(.14, .24), .4, rand(.35, .5)) });
  }
  group.add(makeInstance(bladeGeo, reedMat, reeds));

  /* ---------- mushrooms ---------- */
  const mushCap = new THREE.SphereGeometry(.16, 8, 5, 0, TAU, 0, Math.PI / 2);
  const mushStem = new THREE.CylinderGeometry(.04, .06, .22, 5).translate(0, .1, 0);
  const mushGeo = mergeGeometries([mushCap, mushStem]);
  const mushrooms = [];
  for (let i = 0; i < 90; i++) {
    const a = rnd() * TAU, r = Math.sqrt(rnd()) * 110;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (blocked(x, z, -2)) continue;
    mushrooms.push({ x, z, y: heightAt(x, z), s: rand(.7, 1.5), ry: rnd() * TAU, color: new THREE.Color(rnd() > .55 ? '#d75f72' : '#c9a2e8') });
  }
  group.add(makeInstance(mushGeo, toon(0xffffff, { rim: .25, rimColor: 0xffe0e0 }), mushrooms));

  /* ---------- fireflies / petals ---------- */
  const fireflyPositions = [], fireflyData = [];
  for (let i = 0; i < 110; i++) {
    const a = rnd() * TAU, r = Math.sqrt(rnd()) * 100;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const y = heightAt(x, z) + rand(.6, 2.4);
    fireflyPositions.push(x, y, z);
    fireflyData.push({ baseX: x, baseY: y, baseZ: z, phase: rnd() * TAU, speed: rand(.3, 1) });
  }
  const ffGeo = new THREE.BufferGeometry();
  ffGeo.setAttribute('position', new THREE.Float32BufferAttribute(fireflyPositions, 3));
  const ffMat = new THREE.PointsMaterial({ color: 0xffe99a, size: .13, map: makeSoftTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: .9, sizeAttenuation: true });
  const ff = new THREE.Points(ffGeo, ffMat);
  ff.renderOrder = 4;
  group.add(ff);

  // floating petals near cherry trees / shrine
  const petals = [];
  const petalGeo = new THREE.PlaneGeometry(.11, .07);
  const petalMat = new THREE.MeshBasicMaterial({ color: 0xffc4d6, transparent: true, opacity: .8, side: THREE.DoubleSide, depthWrite: false });
  const petalMesh = new THREE.InstancedMesh(petalGeo, petalMat, 160);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < 160; i++) {
    petals.push({ x: rand(-30, 40), y: heightAt(0, 0) + rand(.5, 7), z: rand(-40, 50), phase: rand(0, TAU), speed: rand(.3, .9), spin: rand(-2, 2) });
  }
  group.add(petalMesh);
  const tmpColor = new THREE.Color();

  const swayMats = [leafMat, leafMat2];
  function update(time, dt) {
    for (const m of swayMats) if (m.userData.shader) m.userData.shader.uniforms.uTime.value = time;
    // fireflies
    const arr = ffGeo.attributes.position.array;
    for (let i = 0; i < fireflyData.length; i++) {
      const d = fireflyData[i];
      arr[i * 3] = d.baseX + Math.sin(time * d.speed * .7 + d.phase) * 1.4;
      arr[i * 3 + 1] = d.baseY + Math.sin(time * d.speed + d.phase * 2) * .5;
      arr[i * 3 + 2] = d.baseZ + Math.cos(time * d.speed * .55 + d.phase) * 1.4;
    }
    ffGeo.attributes.position.needsUpdate = true;
    ffMat.opacity = .55 + Math.sin(time * 1.2) * .12;
    // petals drift
    for (let i = 0; i < petals.length; i++) {
      const p = petals[i];
      p.y -= dt * p.speed;
      p.x += Math.sin(time * .8 + p.phase) * dt * .35;
      p.z += Math.cos(time * .6 + p.phase) * dt * .25;
      p.phase += dt * p.spin;
      if (p.y < heightAt(p.x, p.z) + .1) { p.y = heightAt(p.x, p.z) + rand(3.5, 8); p.x = rand(-30, 40); p.z = rand(-40, 50); }
      dummy.position.set(p.x, p.y, p.z);
      dummy.rotation.set(p.phase, p.phase * 1.7, p.phase * .6);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      petalMesh.setMatrixAt(i, dummy.matrix);
    }
    petalMesh.instanceMatrix.needsUpdate = true;
  }
  update(0, 0);
  return { group, update };
}

// local helper to avoid importing riverX naming clash in this module's scope usage above
import { riverX as riverXImport } from './terrain.js';
function riverXLocal(z) { return riverXImport(z); }
