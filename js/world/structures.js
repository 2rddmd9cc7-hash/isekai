import * as THREE from 'three';
import {
  toon, box, cyl, cone, sphere, plane, addOutline, rand, randInt, TAU, makeSignTexture,
  makeRuneTexture, makeGlowTexture, makeStoneTexture, makeWoodTexture, glowSprite, makeSoftTexture,
  makePlasterTexture, makeRoofTexture
} from '../core/utils.js';
import { heightAt } from './terrain.js';

/* ---------------- shared painted materials ---------------- */
const M = {
  plaster: toon(0xf0e3c6, { map: makePlasterTexture('#f2e6c9'), rim: .14, rimColor: 0xfff2d0 }),
  plasterWarm: toon(0xe8d3ae, { map: makePlasterTexture('#e9d5b2', '#cbb28c', '#f7e8c8'), rim: .14, rimColor: 0xffe9c4 }),
  plasterCool: toon(0xd7ddd2, { map: makePlasterTexture('#dbe0d6', '#b9c2b6', '#eef4e8'), rim: .14, rimColor: 0xd8f2ff }),
  stone: toon(0xa9a29a, { rim: .16, rimColor: 0xe4f2ff }),
  stoneDark: toon(0x7c767c, { rim: .14, rimColor: 0xd4e2ff }),
  stoneLight: toon(0xc6beb0, { rim: .16, rimColor: 0xfff0d8 }),
  stoneMoss: toon(0x8b8f78, { rim: .14, rimColor: 0xd8f0d4 }),
  wood: toon(0x8a5c36, { rim: .12, rimColor: 0xffd9a8 }),
  woodDark: toon(0x543520, { rim: .1, rimColor: 0xffc890 }),
  woodLight: toon(0xb08a55, { rim: .12, rimColor: 0xffe6bc }),
  roofRed: toon(0xffffff, { map: makeRoofTexture('#b4503d'), rim: .2, rimColor: 0xffc8a8 }),
  roofOrange: toon(0xffffff, { map: makeRoofTexture('#c4693a'), rim: .2, rimColor: 0xffd0a0 }),
  roofTeal: toon(0xffffff, { map: makeRoofTexture('#2f6f78'), rim: .2, rimColor: 0xa8f0ff }),
  roofBlue: toon(0xffffff, { map: makeRoofTexture('#33588c'), rim: .22, rimColor: 0xa8c8ff }),
  roofPurple: toon(0xffffff, { map: makeRoofTexture('#5a4670'), rim: .22, rimColor: 0xd8c0ff }),
  gold: toon(0xd8ad54, { rim: .35, rimColor: 0xfff0b0, emissive: 0x3a2600, emissiveIntensity: .3 }),
  iron: toon(0x4e5560, { rim: .3, rimColor: 0xbfe0ff }),
  ironDark: toon(0x33373f, { rim: .2, rimColor: 0x9fc0e0 }),
  window: toon(0xffd58a, { emissive: 0xffb347, emissiveIntensity: 1.15, rim: .1 }),
  windowCool: toon(0x9fe8ff, { emissive: 0x54c9ff, emissiveIntensity: .8, rim: .1 }),
  clothRed: toon(0xa6363c, { rim: .18, rimColor: 0xffb0a0 }),
  clothBlue: toon(0x2f5c88, { rim: .18, rimColor: 0xa8d8ff }),
  clothGreen: toon(0x3c6e55, { rim: .18, rimColor: 0xb0ffd8 }),
  clothCream: toon(0xe8ddc0, { rim: .16, rimColor: 0xfff4d0 }),
  goblin: toon(0x6b8547, { rim: .2, rimColor: 0xd0ffa0 }),
  goblinDark: toon(0x485a33, { rim: .16, rimColor: 0xb0e090 }),
  bone: toon(0xd8cfb4, { rim: .18, rimColor: 0xfff6dc }),
  rune: new THREE.MeshBasicMaterial({ color: 0x8ff4ff, transparent: true, opacity: .8, blending: THREE.AdditiveBlending, depthWrite: false }),
  crystalCyan: new THREE.MeshBasicMaterial({ color: 0x9af2ff }),
  crystalGold: new THREE.MeshBasicMaterial({ color: 0xffe49a }),
  crystalPink: new THREE.MeshBasicMaterial({ color: 0xffb6dd }),
  dark: new THREE.MeshBasicMaterial({ color: 0x0b1118 }),
  water: new THREE.MeshBasicMaterial({ color: 0x7fe4ee, transparent: true, opacity: .7 }),
  glowTex: makeGlowTexture('#ffffff'),
  stoneTex: makeStoneTexture(),
};

M.stoneWall = new THREE.MeshLambertMaterial({ map: M.stoneTex, color: 0xb2aaa0 });

function castleMesh(geo, mat, x, y, z) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; return m;
}
function beam(w, h, d, mat, x, y, z, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z); m.rotation.set(rx, ry, rz); return m;
}
function addGlow(g, color, size, x, y, z) {
  const s = glowSprite(color, size, M.glowTex);
  s.position.set(x, y, z); g.add(s); return s;
}
function windowsOn(g, w, d, y, count, front = true) {
  for (let i = 0; i < count; i++) {
    const x = -w / 2 + (i + .5) * (w / count);
    for (const z of front ? [d / 2 + .02] : [d / 2 + .02, -d / 2 - .02]) {
      g.add(beam(.52, .62, .06, M.window, x, y, z));
      g.add(beam(.62, .07, .1, M.woodDark, x, y - .34, z));
    }
  }
}
/** Windows with wooden shutters and sills on every face of a house. */
function windowsAll(g, w, d, y, count) {
  for (let i = 0; i < count; i++) {
    const x = -w / 2 + (i + .5) * (w / count);
    for (const z of [d / 2 + .02, -d / 2 - .02]) {
      const s = Math.sign(z);
      g.add(beam(.52, .62, .06, M.window, x, y, z));
      g.add(beam(.66, .08, .12, M.woodDark, x, y - .36, z + s * .02));
      g.add(beam(.56, .05, .08, M.wood, x, y + .34, z + s * .02));
      for (const sd of [-1, 1]) {
        const sh = beam(.15, .66, .05, M.wood, x + sd * .35, y, z + s * .03);
        sh.rotation.y = -sd * .1 * s; g.add(sh);
        g.add(beam(.15, .04, .07, M.woodDark, x + sd * .35, y - .2, z + s * .05));
      }
    }
    const zz = -d / 2 + (i + .5) * (d / count);
    for (const xx of [w / 2 + .02, -w / 2 - .02]) {
      const s = Math.sign(xx);
      g.add(beam(.06, .62, .52, M.window, xx, y, zz));
      g.add(beam(.12, .08, .66, M.woodDark, xx + s * .02, y - .36, zz));
      g.add(beam(.08, .05, .56, M.wood, xx + s * .02, y + .34, zz));
      for (const sd of [-1, 1]) {
        const sh = beam(.05, .66, .15, M.wood, xx + s * .03, y, zz + sd * .35);
        g.add(sh);
      }
    }
  }
}
function gableRoof(g, w, d, y, rise, mat, eave = .5) {
  const len = Math.hypot(w / 2 + eave, rise);
  const ang = Math.atan2(rise, w / 2 + eave);
  for (const s of [-1, 1]) {
    const slab = beam(len + .2, .12, d + eave * 2, mat, s * (w / 4 + eave * .25), y + rise / 2, 0, 0, 0, -s * ang);
    slab.castShadow = true;
    g.add(slab);
  }
  g.add(beam(w + .7, .14, d + .7, M.woodDark, 0, y + rise + .02, 0));
}

/* ================================================================== */
/*  Village houses                                                     */
/* ================================================================== */
export function house(opts = {}) {
  const {
    w = 4.6, d = 4.2, floors = 1, wall = M.plaster, roof = M.roofRed,
    rot = 0, rich = false, chimney = true, sign = null, balcony = false,
  } = opts;
  const g = new THREE.Group();
  const h = 2.4 * floors;
  g.add(box(w + .4, .5, d + .4, M.stoneDark, 0, .2, 0));
  const base = box(w, h, d, wall, 0, .4 + h / 2, 0); base.castShadow = true; base.receiveShadow = true; g.add(base);
  // timber frame
  const tw = .12;
  for (const sx of [-1, 1]) {
    g.add(beam(tw, h, tw, M.woodDark, sx * (w / 2 - .06), .4 + h / 2, d / 2 - .02));
    g.add(beam(tw, h, tw, M.woodDark, sx * (w / 2 - .06), .4 + h / 2, -d / 2 + .02));
    g.add(beam(w, .1, tw, M.woodDark, 0, .4 + h * .52, sx * (d / 2 + .005)));
  }
  for (const zz of [-d / 2 + .02, d / 2 - .02]) {
    g.add(beam(w + .04, tw, tw, M.woodDark, 0, .42, zz));
    g.add(beam(w + .04, tw, tw, M.woodDark, 0, .4 + h - .06, zz));
    g.add(beam(tw, h, tw, M.woodDark, 0, .4 + h / 2, zz));
  }
  // door
  g.add(beam(1.0, 1.55, .12, M.woodDark, 0, 1.18, d / 2 + .03));
  g.add(beam(.84, 1.3, .05, M.wood, 0, 1.1, d / 2 + .1));
  g.add(sphere(.05, M.gold, .3, 1.05, d / 2 + .16));
  windowsAll(g, w, d, .4 + h * .64, floors > 1 ? 3 : 2);
  if (floors > 1) {
    windowsAll(g, w, d, .4 + h * .3, 2);
    if (balcony) {
      const b = box(w * .8, .12, 1.2, M.woodLight, 0, .4 + h * .55, d / 2 + .6); g.add(b);
      for (let i = -2; i <= 2; i++) g.add(beam(.07, .7, .07, M.woodDark, i * w * .15, .4 + h * .55 + .4, d / 2 + 1.12));
      g.add(beam(w * .8, .07, .07, M.woodDark, 0, .4 + h * .55 + .74, d / 2 + 1.12));
    }
  }
  gableRoof(g, w, d, .4 + h, rich ? 1.8 : 1.5, roof);
  if (chimney) {
    g.add(box(.55, 1.8, .55, M.stoneDark, w * .26, .4 + h + 1.25, -d * .2));
    addGlow(g, 0xcfd8de, 1.5, w * .26, .4 + h + 2.2, -d * .2);
  }
  // flower box
  if (!rich) {
    const fb = box(w * .5, .22, .22, M.woodDark, 0, 1.35, d / 2 + .25); g.add(fb);
    for (let i = 0; i < 5; i++) g.add(sphere(.09, toon(i % 2 ? 0xffb8d0 : 0xffd66e), (i - 2) * .22, 1.48, d / 2 + .25, 6));
  } else {
    // gold trim + banners
    g.add(beam(w + .2, .1, .1, M.gold, 0, .4 + h - .2, d / 2 + .08));
    g.add(beam(.5, 1.3, .04, M.clothRed, -w * .28, .4 + h * .5, d / 2 + .1));
    g.add(beam(.5, 1.3, .04, M.clothRed, w * .28, .4 + h * .5, d / 2 + .1));
  }
  if (sign) {
    const tex = makeSignTexture(sign, opts.sub || '', { bg: 'rgba(42,26,14,.95)' });
    const sm = new THREE.Mesh(new THREE.PlaneGeometry(1.7, .53), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
    sm.position.set(w / 2 + .45, 2.2, d / 2 + .3); sm.rotation.y = .15; g.add(sm);
    const arm = beam(1.1, .08, .08, M.woodDark, w / 2 + .5, 2.55, d / 2 + .3); g.add(arm);
  }
  g.rotation.y = rot;
  return g;
}

export function tavern(opts = {}) {
  const g = house({ w: 6.2, d: 5, floors: 2, wall: M.plasterWarm, roof: M.roofOrange, balcony: true, rich: true, chimney: true, sign: 'TAVERNA', sub: 'O Cervo Errante', ...opts });
  // outdoor tables & barrels
  for (let i = 0; i < 2; i++) {
    const tx = -2.3 + i * 4.3;
    g.add(cyl(.06, .06, .9, 6, M.woodDark, tx, .45, 3.6));
    g.add(cyl(.8, .8, .12, 10, M.woodLight, tx, .92, 3.6));
    for (const s of [-1, 1]) g.add(box(.32, .08, .32, M.wood, tx + s * 1.1, .5, 3.6));
    g.add(cyl(.06, .06, .5, 6, M.woodDark, tx + 1.1, .25, 3.6));
    g.add(cone(.22, .3, 6, M.woodLight, tx, 1.13, 3.6));
  }
  for (let i = 0; i < 3; i++) {
    const b = cyl(.38, .44, .9, 10, M.woodLight, 3.9, .45, -2.3 + i * 1.0);
    g.add(b); g.add(cyl(.4, .4, .06, 10, M.ironDark, 3.9, .9, -2.3 + i * 1.0));
  }
  addGlow(g, 0xffb066, 2.2, 0, 2.6, 2.8);
  return g;
}

export function smithy(opts = {}) {
  const g = new THREE.Group();
  // open workshop with stone base
  g.add(box(7, .4, 5.2, M.stoneDark, 0, .2, 0));
  for (const [x, z] of [[-3.2, -2.2], [3.2, -2.2], [-3.2, 2.2], [3.2, 2.2]]) g.add(beam(.28, 3.2, .28, M.woodDark, x, 1.9, z));
  g.add(beam(7.2, .22, .3, M.woodDark, 0, 3.5, -2.2));
  g.add(beam(7.2, .22, .3, M.woodDark, 0, 3.5, 2.2));
  gableRoof(g, 6.6, 4.8, 3.2, 1.4, M.roofTeal);
  // back wall
  g.add(box(6.6, 2.8, .18, M.stone, 0, 1.9, -2.2));
  g.add(beam(2.2, 1.6, .08, M.window, 2.2, 1.8, -2.1));
  // forge
  g.add(box(2.2, 1.1, 1.5, M.stoneDark, -1.6, .95, -1.2));
  g.add(box(1.2, .4, .9, M.ironDark, -1.6, 1.55, -1.2));
  const ember = box(.75, .25, .55, new THREE.MeshBasicMaterial({ color: 0xff9a3c }), -1.6, 1.6, -1.2);
  g.add(ember);
  addGlow(g, 0xff7a2a, 3.4, -1.6, 1.8, -1.1);
  g.add(beam(1.4, 3.0, 1.2, M.stoneDark, -1.6, 3.4, -1.2));
  // anvil
  g.add(box(.5, .22, .9, M.ironDark, .9, 1.0, .5));
  g.add(box(.3, .5, .5, M.stoneDark, .9, .55, .5));
  g.add(box(.9, .1, .5, M.iron, .9, 1.13, .5));
  // weapon rack
  g.add(beam(2.2, .1, .1, M.woodDark, 2.0, 2.0, -1.4));
  for (let i = 0; i < 3; i++) {
    const blade = box(.09, 1.15, .03, M.iron, 1.2 + i * .75, 1.5, -1.4);
    blade.rotation.z = .15; g.add(blade);
    g.add(beam(.26, .06, .06, M.gold, 1.2 + i * .75, .92, -1.4));
  }
  // grindstone
  g.add(cyl(.5, .5, .18, 12, M.stoneLight, 2.7, .85, 1.1));
  g.add(cyl(.08, .08, .6, 6, M.woodDark, 2.7, .5, 1.1));
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.9, .6), new THREE.MeshBasicMaterial({ map: makeSignTexture('FORJA', 'Brann & Filhos', { bg: 'rgba(48,32,20,.95)' }), transparent: true }));
  sign.position.set(0, 2.8, 2.7); g.add(sign);
  g.rotation.y = opts.rot || 0;
  return g;
}

export function alchemist(opts = {}) {
  const g = new THREE.Group();
  g.add(cyl(1.9, 2.2, 3.6, 8, M.plasterCool, 0, 1.8, 0));
  g.add(cyl(2.2, 2.3, .35, 8, M.stoneDark, 0, 3.7, 0));
  const dome = new THREE.Mesh(new THREE.SphereGeometry(2.1, 12, 8, 0, TAU, 0, Math.PI / 2), M.roofTeal);
  dome.position.y = 3.85; dome.castShadow = true; g.add(dome);
  g.add(cyl(.08, .08, .7, 6, M.ironDark, 0, 5.9, 0));
  addGlow(g, 0x79f0e0, 3, 0, 6.2, 0);
  // windows + door
  g.add(beam(.6, .6, .32, M.windowCool, 0, 2.55, 2.02));
  g.add(beam(.9, 1.5, .12, M.woodDark, 0, .95, 2.01));
  g.add(beam(.78, 1.35, .06, M.wood, 0, .95, 2.08));
  // hanging bottles
  for (let i = 0; i < 6; i++) {
    const b = sphere(.1, toon(i % 2 ? 0x8bf1c8 : 0xff9cbb, { emissive: i % 2 ? 0x2a7f66 : 0x7f2a4a, emissiveIntensity: .5 }), -1.0 + i * .4, 2.15, 2.2, 8);
    b.scale.y = 1.5; g.add(b);
  }
  // cauldron outside
  g.add(cyl(.55, .45, .6, 10, M.ironDark, 2.3, .3, 1.9));
  g.add(cyl(.5, .5, .04, 10, new THREE.MeshBasicMaterial({ color: 0x76d0a8 }), 2.3, .62, 1.9));
  addGlow(g, 0x7dffc8, 2.2, 2.3, .75, 1.9);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.5, .55), new THREE.MeshBasicMaterial({ map: makeSignTexture('ALQUIMIA', 'Lys', { bg: 'rgba(16,38,40,.95)' }), transparent: true }));
  sign.position.set(0, 2.9, 2.18); g.add(sign);
  g.rotation.y = opts.rot || 0;
  return g;
}

export function shopHouse(opts = {}) {
  const g = house({ w: 5.4, d: 4.4, floors: 1, wall: M.plaster, roof: M.roofBlue, sign: 'MERCADORIAS', sub: 'Tuli', rich: true, ...opts });
  // striped awning
  const colors = [M.clothCream, M.clothBlue];
  for (let i = 0; i < 8; i++) {
    const a = box(.7, .07, 1.5, colors[i % 2], -2.45 + i * .7, 2.35, 2.85);
    a.rotation.x = -.18; g.add(a);
  }
  g.add(beam(5.6, .08, .08, M.woodDark, 0, 2.42, 2.2));
  // crates and display
  for (let i = 0; i < 3; i++) {
    g.add(box(.55, .55, .55, M.woodLight, -2.2 + i * .7, .28, 2.8));
    g.add(beam(.55, .06, .06, M.woodDark, -2.2 + i * .7, .35, 2.8));
  }
  for (let i = 0; i < 4; i++) {
    const jar = sphere(.13, toon([0xffb45c, 0x8fe0ff, 0xff8fb8, 0xbff0a0][i], { emissive: 0x332200, emissiveIntensity: .3 }), 1.3 + (i % 2) * .35, .68, 2.75 + Math.floor(i / 2) * .32, 8);
    g.add(jar);
  }
  return g;
}

export function temple(opts = {}) {
  const g = new THREE.Group();
  g.add(box(8, .5, 7, M.stoneDark, 0, .25, 0));
  // columns
  for (const x of [-3.4, -1.7, 0, 1.7, 3.4]) for (const z of [-3, 3]) g.add(cyl(.24, .28, 4.2, 8, M.stoneLight, x, 2.35, z));
  g.add(box(8.4, .5, 6.6, M.stone, 0, 4.5, 0));
  // pediment
  const ped = new THREE.Mesh(new THREE.CylinderGeometry(.1, 4.3, 1.9, 3), M.stoneLight);
  ped.rotation.y = Math.PI / 2; ped.rotation.z = 0; ped.position.set(0, 5.7, 0); ped.scale.z = .55; g.add(ped);
  // inner shrine + crystal
  g.add(box(3.2, 2.2, 2.2, M.stoneMoss, 0, 1.6, -1.4));
  g.add(box(2.4, 1.2, .1, M.dark, 0, 1.5, -.25));
  const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(.5, 0), M.crystalCyan);
  crystal.position.set(0, 1.5, .4); crystal.scale.y = 2; g.add(crystal);
  addGlow(g, 0x7fefff, 3.4, 0, 1.6, .4);
  // banners
  for (const x of [-2.9, 2.9]) {
    g.add(beam(.8, 2.2, .05, M.clothBlue, x, 3.2, 2.95));
    g.add(beam(.9, .1, .1, M.gold, x, 4.25, 2.95));
  }
  // steps
  for (let i = 0; i < 3; i++) g.add(box(8.8 - i * .3, .18, .6, M.stone, 0, .1 + i * .16, 3.8 + i * .5));
  g.rotation.y = opts.rot || 0;
  return g;
}

export function barracks(opts = {}) {
  const g = house({ w: 7.5, d: 5, floors: 1, wall: M.stoneLight, roof: M.roofBlue, chimney: false, ...opts });
  g.add(beam(7, .1, .1, M.woodDark, 0, 2.1, 2.6));
  for (const x of [-2.5, 2.5]) {
    g.add(cyl(.3, .3, 1.0, 8, M.bone, x, 1.7, 2.75));
    g.add(box(.1, .5, .1, M.bone, x - .2, 2.18, 2.75));
  }
  // banners
  for (const x of [-3.2, 3.2]) g.add(beam(.7, 2.0, .04, M.clothBlue, x, 2.7, 2.72));
  // training dummy
  const mannequin = new THREE.Group();
  mannequin.add(cyl(.08, .08, 1.5, 6, M.woodDark, 0, .75, 0));
  mannequin.add(cyl(.42, .3, .8, 8, M.clothCream, 0, 1.5, 0));
  mannequin.add(sphere(.22, M.clothCream, 0, 2.05, 0, 8));
  mannequin.position.set(5.2, 0, 2.2); g.add(mannequin);
  g.add(beam(1.0, .08, .08, M.woodDark, 5.2, 1.7, 2.2));
  return g;
}

export function marketStall(color = M.clothRed) {
  const g = new THREE.Group();
  g.add(box(2.2, .85, 1.3, M.woodLight, 0, .44, 0));
  for (const x of [-1, 1]) for (const z of [-.55, .55]) g.add(beam(.1, 2.2, .1, M.woodDark, x, 1.3, z));
  for (let i = 0; i < 5; i++) {
    const s = box(.52, .06, 1.8, i % 2 ? color : M.clothCream, -1.0 + i * .5, 2.45, 0);
    s.rotation.x = .08; g.add(s);
  }
  for (let i = 0; i < 5; i++) {
    g.add(sphere(.13, toon([0xff9d5a, 0xffd76e, 0xa8e06a, 0xff8fb8][i % 4]), -1 + i * .5, 1.0, .25, 7));
  }
  return g;
}

export function fountain() {
  const g = new THREE.Group();
  g.add(cyl(3.2, 3.4, .45, 12, M.stone, 0, .22, 0));
  g.add(cyl(2.95, 2.95, .35, 12, M.stoneDark, 0, .47, 0));
  const water = new THREE.Mesh(new THREE.CircleGeometry(2.86, 20), new THREE.MeshBasicMaterial({ color: 0x6fdfe8, transparent: true, opacity: .9 }));
  water.rotation.x = -Math.PI / 2; water.position.y = .47; g.add(water);
  const ripple = new THREE.Mesh(new THREE.RingGeometry(.7, 1.5, 24), new THREE.MeshBasicMaterial({ color: 0xc7fbff, transparent: true, opacity: .25, depthWrite: false }));
  ripple.rotation.x = -Math.PI / 2; ripple.position.y = .48; g.add(ripple);
  g.userData.ripple = ripple;
  g.add(cyl(.55, .75, 1.6, 10, M.stoneLight, 0, 1.35, 0));
  const orb = new THREE.Mesh(new THREE.OctahedronGeometry(.34, 0), M.crystalCyan);
  orb.position.y = 2.5; orb.scale.y = 1.5; g.add(orb);
  const halo = addGlow(g, 0x8ff8ff, 1.5, 0, 2.5, 0);
  halo.material.opacity = .4;
  for (let i = 0; i < 4; i++) {
    const a = i / 4 * TAU;
    g.add(cyl(.14, .18, .8, 6, M.stoneLight, Math.cos(a) * 2.1, .9, Math.sin(a) * 2.1));
  }
  g.userData.spin = orb;
  return g;
}

export function well() {
  const g = new THREE.Group();
  g.add(cyl(1.2, 1.3, .9, 10, M.stone, 0, .45, 0));
  g.add(cyl(1.0, 1.0, .1, 10, new THREE.MeshBasicMaterial({ color: 0x2e5f6b }), 0, .86, 0));
  for (const x of [-.9, .9]) g.add(beam(.12, 2.0, .12, M.woodDark, x, 1.5, 0));
  gableRoof(g, 1.8, 1.4, 2.5, .6, M.roofRed, .2);
  g.add(beam(.1, .8, .1, M.woodDark, 0, 2.1, 0));
  g.add(cyl(.2, .2, .26, 8, M.woodLight, 0, 1.65, 0));
  return g;
}

export function bench() {
  const g = new THREE.Group();
  g.add(box(1.8, .1, .5, M.woodLight, 0, .5, 0));
  g.add(box(1.8, .5, .1, M.wood, 0, .75, -.25));
  for (const x of [-.7, .7]) g.add(beam(.1, .5, .4, M.woodDark, x, .25, 0));
  return g;
}

export function lamp(color = 0xffc978) {
  const g = new THREE.Group();
  g.add(cyl(.07, .1, 3.0, 6, M.ironDark, 0, 1.5, 0));
  // open iron lantern: a bright arcane core under a small iron hood
  g.add(cyl(.16, .19, .08, 8, M.ironDark, 0, 2.9, 0));
  const core = new THREE.Mesh(new THREE.SphereGeometry(.15, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffd899 }));
  core.position.y = 3.1; g.add(core);
  const cage = new THREE.Mesh(new THREE.TorusGeometry(.17, .012, 4, 10), M.ironDark);
  cage.rotation.x = Math.PI / 2; cage.position.y = 3.1; g.add(cage);
  const cage2 = cage.clone(); cage2.rotation.z = Math.PI / 2; g.add(cage2);
  g.add(cone(.25, .22, 4, M.ironDark, 0, 3.34, 0));
  const halo = addGlow(g, color, .38, 0, 3.1, 0);
  halo.material.opacity = .32;
  return g;
}

export function fence(length = 4, h = 1) {
  const g = new THREE.Group();
  const n = Math.max(2, Math.round(length / 1.4));
  for (let i = 0; i <= n; i++) g.add(beam(.1, h, .1, M.woodDark, -length / 2 + i * (length / n), h / 2, 0));
  g.add(beam(length, .09, .06, M.wood, 0, h * .65, 0));
  g.add(beam(length, .09, .06, M.wood, 0, h * .28, 0));
  return g;
}

export function crates() {
  const g = new THREE.Group();
  g.add(box(.6, .6, .6, M.woodLight, 0, .3, 0));
  g.add(box(.5, .5, .5, M.wood, .55, .25, .2));
  g.add(box(.55, .55, .55, M.woodLight, -.45, .27, -.15));
  for (const b of g.children) b.castShadow = true;
  g.add(cyl(.3, .34, .7, 8, M.woodLight, 1.2, .35, -.2));
  return g;
}

export function bannerPole(color = M.clothBlue) {
  const g = new THREE.Group();
  g.add(cyl(.07, .09, 5, 6, M.woodDark, 0, 2.5, 0));
  g.add(beam(1.5, .06, .06, M.woodDark, .7, 4.7, 0));
  const flag = box(1.25, 1.7, .04, color, .72, 3.8, 0);
  g.add(flag);
  g.add(beam(.1, .1, .04, M.gold, .72, 4.7, .02));
  return g;
}

/* ================================================================== */
/*  Goblin camp                                                        */
/* ================================================================== */
export function goblinTent(scale = 1) {
  const g = new THREE.Group();
  const t = new THREE.Mesh(new THREE.ConeGeometry(2.2, 2.8, 6), M.goblinDark);
  t.position.y = 1.4; t.castShadow = true; g.add(t);
  const patch = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.2), M.goblin);
  patch.position.set(0, 1.3, 1.75); patch.rotation.x = .35; g.add(patch);
  for (const [x, z] of [[-1.5, 1.0], [1.4, 1.1], [-1.0, -1.4]]) g.add(beam(.1, 2.2, .1, M.woodDark, x, 1.0, z, rand(-.2, .2), 0, rand(-.2, .2)));
  g.add(beam(.1, 1.4, .1, M.bone, .4, 2.9, 0));
  const skull = sphere(.18, M.bone, .4, 3.6, 0, 7); skull.scale.z = 1.15; g.add(skull);
  const fire = new THREE.Mesh(new THREE.CircleGeometry(.35, 8), new THREE.MeshBasicMaterial({ color: 0xff9a3c }));
  fire.rotation.x = -Math.PI / 2; fire.position.set(1.8, .03, 1.8); g.add(fire);
  g.scale.setScalar(scale);
  return g;
}

export function goblinTotem() {
  const g = new THREE.Group();
  g.add(cyl(.22, .3, 3.2, 6, M.woodDark, 0, 1.6, 0));
  for (let i = 0; i < 3; i++) {
    const skull = sphere(.3, M.bone, 0, 2.2 + i * .6, .12, 8);
    skull.scale.z = 1.2; g.add(skull);
    g.add(beam(.6, .08, .08, M.bone, 0, 2.25 + i * .6, 0));
  }
  g.add(beam(.8, 1.4, .04, M.clothRed, .5, 1.7, 0));
  g.add(beam(1.2, .1, .1, M.woodDark, .4, 2.4, 0));
  return g;
}

export function palisade(length = 20, h = 2.6, curve = 0) {
  const g = new THREE.Group();
  const n = Math.round(length / .8);
  for (let i = 0; i < n; i++) {
    const x = -length / 2 + i * .8;
    const z = curve * Math.cos((i / n - .5) * Math.PI);
    const stake = cyl(.18, .22, h + rand(-.3, .4), 5, i % 3 === 0 ? M.wood : M.woodDark, x, (h) / 2, z);
    stake.rotation.z = rand(-.07, .07);
    g.add(stake);
    g.add(cone(.19, .4, 5, M.woodDark, x, h + .2, z));
  }
  g.add(beam(length, .12, .12, M.woodDark, 0, h * .7, 0));
  return g;
}

export function goblinBonfire() {
  const g = new THREE.Group();
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * TAU;
    g.add(new THREE.Mesh(new THREE.DodecahedronGeometry(.24, 0), M.stoneDark).translateX(Math.cos(a) * 1.3).translateY(.15).translateZ(Math.sin(a) * 1.3));
  }
  for (let i = 0; i < 4; i++) {
    g.add(beam(.16, 1.2, .16, M.woodDark, rand(-.3, .3), .5, rand(-.3, .3), rand(-.4, .4), rand(0, 3), rand(-.4, .4)));
  }
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xff8a3a, transparent: true, opacity: .9 });
  const f1 = new THREE.Mesh(new THREE.ConeGeometry(.5, 1.7, 6), flameMat); f1.position.y = 1.3; g.add(f1);
  const f2 = new THREE.Mesh(new THREE.ConeGeometry(.3, 1.2, 6), new THREE.MeshBasicMaterial({ color: 0xffe17a, transparent: true, opacity: .9 })); f2.position.y = 1.2; g.add(f2);
  addGlow(g, 0xff8a3a, 4.2, 0, 1.4, 0);
  return g;
}

export function goblinCage() {
  const g = new THREE.Group();
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * TAU;
    g.add(beam(.07, 1.8, .07, M.woodDark, Math.cos(a) * .55, .9, Math.sin(a) * .55));
  }
  g.add(cyl(.6, .6, .08, 8, M.woodDark, 0, 1.8, 0));
  g.add(cyl(.6, .6, .08, 8, M.woodDark, 0, .05, 0));
  g.add(sphere(.13, M.bone, 0, .55, .1, 6));
  return g;
}

export function goblinCampProps() {
  const g = new THREE.Group();
  // palisade ring (broken at south for entrance)
  const gate = 0;
  for (let i = 0; i < 30; i++) {
    const a = i / 30 * TAU;
    if (Math.abs(((a + Math.PI * 2) % (Math.PI * 2)) - Math.PI) < .28) continue;
    const x = Math.cos(a) * 15, z = Math.sin(a) * 15;
    const s = cyl(.2, .26, rand(2.2, 3), 5, i % 3 ? M.woodDark : M.wood, x, 1.3, z);
    s.rotation.z = rand(-.08, .08); g.add(s);
    g.add(cone(.22, .4, 5, M.woodDark, x, 2.9, z));
  }
  // gate posts
  for (const x of [-2.4, 2.4]) {
    g.add(cyl(.3, .38, 4.0, 6, M.woodDark, x, 2, 15));
    g.add(sphere(.3, M.bone, x, 4.1, 15, 7));
  }
  g.add(beam(6.2, .4, .4, M.woodDark, 0, 3.8, 15));
  g.add(beam(4.4, .9, .05, M.clothRed, 0, 3.1, 15.1));
  for (let i = 0; i < 5; i++) {
    const t = goblinTent(rand(.9, 1.25));
    const a = rand(0, TAU), r = rand(5.5, 12);
    t.position.set(Math.cos(a) * r, 0, Math.sin(a) * r - 2);
    t.rotation.y = rand(0, TAU); g.add(t);
  }
  const totem = goblinTotem(); totem.position.set(-9, 0, -7); g.add(totem);
  const totem2 = goblinTotem(); totem2.position.set(8, 0, 6); totem2.rotation.y = 1; g.add(totem2);
  const fire = goblinBonfire(); fire.position.set(0, 0, 0); g.add(fire);
  for (let i = 0; i < 3; i++) {
    const cage = goblinCage();
    cage.position.set(-7 + i * 3.2, 0, 8 + (i % 2)); g.add(cage);
  }
  // loot pile
  for (let i = 0; i < 5; i++) g.add(sphere(.13, M.gold, 6.5 + rand(-.5, .5), .15, -4 + rand(-.6, .6), 6));
  return g;
}

/* ================================================================== */
/*  Ruins / shrine / tower / cave / lake                               */
/* ================================================================== */
export function ruinColumn(h = 4, broken = true) {
  const g = new THREE.Group();
  g.add(box(.9, .3, .9, M.stoneDark, 0, .15, 0));
  const shaft = cyl(.34, .4, h, 8, M.stoneLight, 0, h / 2 + .3, 0);
  g.add(shaft);
  if (broken) {
    shaft.scale.y = 1;
    const top = new THREE.Mesh(new THREE.CylinderGeometry(.36, .34, .3, 8), M.stoneLight);
    top.position.y = h + .3; top.rotation.z = .2; g.add(top);
  } else {
    g.add(box(1.1, .3, 1.1, M.stone, 0, h + .45, 0));
  }
  // vines / runes
  g.add(beam(.05, h * .7, .05, toon(0x4d7a4a), .3, h * .5, .28, 0, 0, .15));
  return g;
}

export function ruinArch() {
  const g = new THREE.Group();
  for (const x of [-2.2, 2.2]) {
    g.add(box(.9, .4, .9, M.stoneDark, x, .2, 0));
    g.add(cyl(.4, .46, 4.6, 8, M.stoneLight, x, 2.5, 0));
    g.add(box(1.1, .35, 1.1, M.stone, x, 4.9, 0));
  }
  g.add(box(5.4, .5, .9, M.stone, 0, 5.3, 0));
  // glowing runes
  for (const x of [-2.2, 2.2]) {
    const rune = new THREE.Mesh(new THREE.PlaneGeometry(.5, 2.2), M.rune);
    rune.position.set(x, 2.6, .47); g.add(rune);
  }
  addGlow(g, 0x7ff0ff, 3.2, 0, 4.6, 0);
  return g;
}

export function ruinAltar() {
  const g = new THREE.Group();
  g.add(box(3.2, .6, 3.2, M.stoneDark, 0, .3, 0));
  g.add(box(2.4, .5, 2.4, M.stone, 0, .8, 0));
  g.add(box(1.2, 1.0, 1.2, M.stoneLight, 0, 1.55, 0));
  const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(.45, 0), M.crystalGold);
  crystal.position.y = 2.55; crystal.scale.y = 1.8; g.add(crystal);
  g.userData.crystal = crystal;
  addGlow(g, 0xffe28a, 4, 0, 2.5, 0);
  const ring = new THREE.Mesh(new THREE.CircleGeometry(2.6, 28), new THREE.MeshBasicMaterial({ map: makeRuneTexture('#ffcf7a', '#fff0c0'), transparent: true, opacity: .55, depthWrite: false, blending: THREE.AdditiveBlending }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = .05; g.add(ring);
  g.userData.ring = ring;
  return g;
}

export function ruinsSite() {
  const g = new THREE.Group();
  g.add(box(8, .2, 8, M.stoneDark, 0, .1, 0));
  // floor tiles
  for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) {
    if (Math.random() < .2) continue;
    const t = box(1.4, .12, 1.4, Math.random() > .5 ? M.stoneLight : M.stone, -3 + i * 1.5, .16 + Math.random() * .06, -3 + j * 1.5);
    t.rotation.y = rand(-.06, .06); g.add(t);
  }
  const arch = ruinArch(); arch.position.set(-4, 0, -5); arch.rotation.y = .2; g.add(arch);
  for (let i = 0; i < 7; i++) {
    const c = ruinColumn(rand(2.4, 4.8), true);
    const a = rand(0, TAU), r = rand(4, 8);
    c.position.set(Math.cos(a) * r, 0, Math.sin(a) * r); c.rotation.z = rand(-.12, .12); g.add(c);
  }
  g.add(box(7, .3, 1.2, M.stone, 0, 4.2, -1));
  const altar = ruinAltar(); altar.position.set(0, 0, 0); g.add(altar);
  g.userData.altar = altar;
  // floating rune shards
  for (let i = 0; i < 3; i++) {
    const shard = new THREE.Mesh(new THREE.TetrahedronGeometry(.22, 0), M.crystalCyan);
    const a = i / 3 * TAU;
    shard.position.set(Math.cos(a) * 2.5, 2.8 + i * .4, Math.sin(a) * 2.5); g.add(shard);
  }
  return g;
}

export function wizardTower() {
  const g = new THREE.Group();
  g.add(box(5, .5, 5, M.stoneDark, 0, .25, 0));
  g.add(cyl(2.4, 3.0, 6.5, 8, M.stoneLight, 0, 3.5, 0));
  g.add(cyl(2.2, 2.4, 4.2, 8, M.stone, 0, 8.7, 0));
  g.add(cyl(2.7, 2.4, .4, 8, M.stoneDark, 0, 10.9, 0));
  const roof = new THREE.Mesh(new THREE.ConeGeometry(3.1, 4.8, 8), M.roofPurple);
  roof.position.y = 13.5; roof.castShadow = true; g.add(roof);
  addGlow(g, 0xb39aff, 5.5, 0, 16, 0);
  // windows
  for (let i = 0; i < 4; i++) {
    const a = i / 4 * TAU + .4;
    g.add(beam(.6, .9, .3, M.windowCool, Math.cos(a) * 2.55, 5.2 + (i % 2) * 2.4, Math.sin(a) * 2.55, 0, -a, 0));
  }
  // floating rocks
  for (let i = 0; i < 5; i++) {
    const a = rand(0, TAU), r = rand(4, 6);
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(rand(.3, .8), 0), M.stoneDark);
    rock.position.set(Math.cos(a) * r, rand(2, 9), Math.sin(a) * r); g.add(rock);
  }
  // arch entrance
  g.add(box(1.6, 2.4, .4, M.dark, 0, 1.4, 2.85));
  g.add(beam(2.0, .25, .5, M.stone, 0, 2.7, 2.85));
  const ring = new THREE.Mesh(new THREE.CircleGeometry(3.3, 30), new THREE.MeshBasicMaterial({ map: makeRuneTexture('#b79cff', '#e6dcff'), transparent: true, opacity: .45, depthWrite: false, blending: THREE.AdditiveBlending }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = .1; g.add(ring);
  g.userData.ring = ring;
  return g;
}

export function caveEntrance() {
  const g = new THREE.Group();
  const rocks = [
    [-4, 1.2, -1, 2.4], [4, 1.0, -1, 2.2], [-2.6, 3.4, -1.5, 1.9], [3.0, 3.6, -1.5, 2.0], [0, 4.8, -2, 2.6],
  ];
  for (const [x, y, z, s] of rocks) {
    const r = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), M.stoneDark);
    r.position.set(x, y, z); r.scale.set(1, .85, .8); r.rotation.set(rand(0, 1), rand(0, 3), rand(0, 1)); r.castShadow = true; g.add(r);
  }
  const mouth = new THREE.Mesh(new THREE.CircleGeometry(2.4, 20), M.dark);
  mouth.position.set(0, 1.5, -1.6); g.add(mouth);
  // crystals
  for (let i = 0; i < 7; i++) {
    const c = new THREE.Mesh(new THREE.ConeGeometry(rand(.15, .4), rand(.7, 1.8), 5), M.crystalCyan);
    const a = rand(0, TAU);
    c.position.set(Math.cos(a) * rand(1.6, 3.2), rand(.4, 1.2), -1.4 + Math.sin(a) * .8);
    c.rotation.z = rand(-.4, .4); g.add(c);
  }
  addGlow(g, 0x79eaff, 5, 0, 1.2, -1.0);
  // warning bones
  for (let i = 0; i < 4; i++) {
    const b = beam(.1, .7, .1, M.bone, rand(-2.5, 2.5), .35, 2.4 + rand(-.3, .3), rand(-.3, .3), 0, rand(-.3, .3)); g.add(b);
  }
  return g;
}

export function mineEntrance() {
  const g = new THREE.Group();
  const hill = new THREE.Mesh(new THREE.DodecahedronGeometry(7, 0), M.stoneDark);
  hill.position.set(0, 2.5, -3); hill.scale.set(1.5, 1, 1.1); g.add(hill);
  // timber portal
  for (const x of [-2.2, 2.2]) g.add(beam(.5, 4.4, .5, M.woodDark, x, 2.2, 2));
  g.add(beam(5.2, .5, .6, M.woodDark, 0, 4.3, 2));
  g.add(box(3.4, 3.6, .2, M.dark, 0, 1.8, 2.05));
  // cart + rails
  for (const x of [-.65, .65]) g.add(beam(.1, .08, 9, M.ironDark, x, .08, 5.5));
  for (let i = 0; i < 12; i++) g.add(beam(1.7, .12, .16, M.woodDark, 0, .02, 2.4 + i * .75));
  const cart = new THREE.Group();
  cart.add(box(1.1, .5, 1.5, M.ironDark, 0, .55, 0));
  for (const x of [-.5, .5]) for (const z of [-.55, .55]) cart.add(cyl(.2, .2, .14, 8, M.woodDark, x, .22, z + 0, 0, 0, Math.PI / 2));
  for (let i = 0; i < 4; i++) cart.add(new THREE.Mesh(new THREE.DodecahedronGeometry(.18, 0), M.stoneDark).translateX(rand(-.35, .35)).translateY(.8).translateZ(rand(-.55, .55)));
  cart.position.set(0, 0, 5); g.add(cart);
  const lampG = lamp(); lampG.position.set(2.0, 0, 2.6); g.add(lampG);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.8, .55), new THREE.MeshBasicMaterial({ map: makeSignTexture('MINA', 'Pedra Cinzenta', { bg: 'rgba(30,28,26,.95)' }), transparent: true }));
  sign.position.set(0, 3.5, 2.4); g.add(sign);
  addGlow(g, 0xffb060, 2.8, 2.0, 2.8, 2.6);
  return g;
}

export function torii(color = 0xb0443c) {
  const g = new THREE.Group();
  const mat = toon(color, { rim: .18, rimColor: 0xffc0a8 });
  for (const x of [-2.3, 2.3]) g.add(cyl(.22, .28, 4.6, 8, mat, x, 2.3, 0));
  g.add(beam(5.8, .35, .45, mat, 0, 4.25, 0));
  g.add(beam(6.6, .22, .5, toon(0x1e1a20), 0, 4.65, 0));
  g.add(beam(4.6, .22, .3, mat, 0, 3.55, 0));
  g.add(beam(2.0, 1.0, .04, M.clothCream, 0, 3.1, .26));
  return g;
}

export function stoneLantern() {
  const g = new THREE.Group();
  g.add(box(.7, .25, .7, M.stoneDark, 0, .12, 0));
  g.add(cyl(.18, .24, 1.3, 6, M.stoneLight, 0, .85, 0));
  g.add(box(.7, .18, .7, M.stoneLight, 0, 1.55, 0));
  g.add(box(.5, .5, .5, M.window, 0, 1.85, 0));
  const roof = new THREE.Mesh(new THREE.ConeGeometry(.65, .35, 4), M.stoneDark);
  roof.position.y = 2.25; roof.rotation.y = Math.PI / 4; g.add(roof);
  addGlow(g, 0xffd28a, 2.2, 0, 1.9, 0);
  return g;
}

export function shrineSite() {
  const g = new THREE.Group();
  g.add(box(9, .25, 9, M.stone, 0, .12, 0));
  const t = torii(); t.position.set(0, 0, 4.2); g.add(t);
  const altar = ruinAltar(); altar.position.set(0, 0, -1.5); g.add(altar);
  g.userData.altar = altar;
  for (const [x, z] of [[-3.5, 1.6], [3.5, 1.6], [-3.8, -3.2], [3.8, -3.2]]) {
    const l = stoneLantern(); l.position.set(x, 0, z); g.add(l);
  }
  // hanging paper charms
  for (let i = 0; i < 6; i++) {
    const p = box(.24, .5, .02, M.clothCream, -2 + i * .8, 4.15, 4.35);
    p.rotation.z = rand(-.1, .1); g.add(p);
  }
  return g;
}

export function bridge() {
  const g = new THREE.Group();
  const len = 24;
  // deck
  g.add(box(len, .35, 5.4, M.stoneDark, 0, .95, 0));
  for (let i = 0; i < 10; i++) g.add(box(len / 10 - .05, .1, 5.1, i % 2 ? M.stone : M.stoneLight, -len / 2 + (i + .5) * len / 10, 1.15, 0));
  // arches
  for (const z of [-2.3, 2.3]) {
    for (let i = 0; i < 4; i++) {
      const x = -len / 2 + 3 + i * 6;
      g.add(cyl(.35, .5, 2.6, 8, M.stone, x, .2, z));
    }
    g.add(box(len, .4, .4, M.stone, 0, 1.2, z));
    // railing
    g.add(beam(len, .14, .14, M.stoneLight, 0, 2.1, z));
    for (let i = 0; i <= 12; i++) g.add(beam(.16, .95, .16, M.stone, -len / 2 + i * 2, 1.65, z));
  }
  return g;
}

export function windmill() {
  const g = new THREE.Group();
  g.add(cyl(2.1, 2.8, 6.5, 8, M.plasterWarm, 0, 3.25, 0));
  g.add(cyl(2.9, 2.9, .4, 8, M.stoneDark, 0, .2, 0));
  const roof = new THREE.Mesh(new THREE.ConeGeometry(2.5, 2.4, 8), M.roofRed);
  roof.position.y = 7.6; g.add(roof);
  g.add(box(1.2, 1.9, .3, M.woodDark, 0, 1.2, 2.35));
  g.add(beam(.7, .7, .3, M.window, 0, 4.6, 2.4));
  const hub = new THREE.Group();
  hub.position.set(0, 6.2, 2.4);
  for (let i = 0; i < 4; i++) {
    const blade = new THREE.Group();
    blade.rotation.z = i / 4 * TAU;
    blade.add(beam(.4, 5.2, .1, M.woodLight, 0, 2.3, 0));
    blade.add(beam(1.1, 3.6, .05, M.clothCream, .55, 3.2, .02));
    hub.add(blade);
  }
  hub.add(cyl(.35, .35, .5, 8, M.woodDark, 0, 0, .1, Math.PI / 2));
  g.add(hub);
  g.userData.blades = hub;
  return g;
}

export function farmPlot(w = 8, d = 8) {
  const g = new THREE.Group();
  const soil = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshLambertMaterial({ color: 0x6b4c31 }));
  soil.rotation.x = -Math.PI / 2; soil.position.y = .03; g.add(soil);
  for (let row = 0; row < 5; row++) {
    const z = -d / 2 + (row + .5) * (d / 5);
    for (let i = 0; i < 6; i++) {
      const x = -w / 2 + (i + .5) * (w / 6);
      g.add(cyl(.04, .05, .5, 4, toon(0x6f9a4a), x, .3, z));
      g.add(sphere(.16, toon(row % 2 ? 0x8fbf58 : 0xa8cf68), x, .58, z, 6));
    }
  }
  // fence
  const f1 = fence(w, .9); f1.position.set(0, 0, -d / 2 - .3); g.add(f1);
  const f2 = fence(w, .9); f2.position.set(0, 0, d / 2 + .3); g.add(f2);
  return g;
}

export function scarecrow() {
  const g = new THREE.Group();
  g.add(cyl(.09, .09, 2.4, 5, M.woodDark, 0, 1.2, 0));
  g.add(beam(2.0, .09, .09, M.woodDark, 0, 1.8, 0));
  g.add(cyl(.42, .3, .9, 7, M.clothGreen, 0, 1.4, 0));
  g.add(sphere(.26, M.clothCream, 0, 2.1, 0, 8));
  const hat = new THREE.Mesh(new THREE.ConeGeometry(.55, .4, 8), M.woodLight);
  hat.position.y = 2.45; g.add(hat);
  for (const x of [-1.05, 1.05]) g.add(box(.22, .3, .06, M.clothGreen, x, 1.8, 0));
  return g;
}

export function waterfallSite() {
  const g = new THREE.Group();
  // cliff
  const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(15, 0), M.stoneDark);
  rock.position.set(0, 6, -12); rock.scale.set(1.3, .85, 1); g.add(rock);
  const rock2 = new THREE.Mesh(new THREE.DodecahedronGeometry(9, 0), M.stoneMoss);
  rock2.position.set(-11, 2, -9); rock2.scale.set(1, .7, 1); g.add(rock2);
  // waterfall sheet
  const fallMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 }, uTop: { value: new THREE.Color('#dffcff') }, uBottom: { value: new THREE.Color('#5fcfe0') } },
    vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `
      uniform float uTime; uniform vec3 uTop,uBottom; varying vec2 vUv;
      void main(){
        float stripes = sin((vUv.y*18.0 + uTime*2.2) + sin(vUv.x*22.0)*1.5)*0.5+0.5;
        float foam = smoothstep(.55,.95,stripes) * smoothstep(.25,0.0,vUv.y);
        vec3 col = mix(uTop,uBottom,vUv.y);
        col = mix(col, vec3(1.0), foam*0.45);
        float edge = smoothstep(0.0,.18,vUv.x)*smoothstep(1.0,.82,vUv.x);
        gl_FragColor = vec4(col, .86*edge);
      }`,
  });
  const fall = new THREE.Mesh(new THREE.PlaneGeometry(5.4, 17, 1, 12), fallMat);
  fall.position.set(1, 8.5, 1.5); g.add(fall);
  g.userData.fallMat = fallMat;
  // pool + foam
  const pool = new THREE.Mesh(new THREE.CircleGeometry(7, 22), new THREE.MeshBasicMaterial({ color: 0x6fdfe8, transparent: true, opacity: .7 }));
  pool.rotation.x = -Math.PI / 2; pool.position.set(1, .1, 6); g.add(pool);
  for (let i = 0; i < 16; i++) {
    const a = rand(0, TAU), r = rand(2, 7);
    const f = new THREE.Mesh(new THREE.CircleGeometry(rand(.3, .8), 8), new THREE.MeshBasicMaterial({ color: 0xe8ffff, transparent: true, opacity: .35, depthWrite: false }));
    f.rotation.x = -Math.PI / 2; f.position.set(1 + Math.cos(a) * r, .14, 6 + Math.sin(a) * r); g.add(f);
  }
  const mist = new THREE.Group();
  for (let i = 0; i < 7; i++) {
    const s = glowSprite(0xdffaff, rand(4, 8), M.glowTex);
    s.material.opacity = .14;
    s.position.set(1 + rand(-4, 4), rand(1, 6), 4 + rand(0, 5));
    mist.add(s);
  }
  g.add(mist);
  g.userData.mist = mist;
  return g;
}

export function signpost(label, rot = 0) {
  const g = new THREE.Group();
  g.add(cyl(.09, .11, 2.2, 6, M.woodDark, 0, 1.1, 0));
  const tex = makeSignTexture(label, '', { bg: 'rgba(48,32,20,.95)' });
  const n = Math.ceil(label.length / 12);
  for (let i = 0; i < Math.min(n, 3); i++) {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(1.7, .45), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
    s.position.set(.4, 1.9 - i * .55, .06); s.rotation.y = rot; g.add(s);
  }
  return g;
}

export function abandonedHut() {
  const g = new THREE.Group();
  g.add(box(3.8, 2.2, 3.4, M.stoneMoss, 0, 1.1, 0));
  const roof = new THREE.Mesh(new THREE.ConeGeometry(3.0, 1.6, 4), M.woodDark);
  roof.position.y = 3.0; roof.rotation.y = Math.PI / 4; roof.scale.set(1.2, 1, 1.1); g.add(roof);
  // broken roof hole
  const hole = new THREE.Mesh(new THREE.CircleGeometry(1.2, 8), M.dark);
  hole.rotation.x = -Math.PI / 2; hole.position.set(.6, 2.3, .4); g.add(hole);
  g.add(box(.9, 1.5, .1, M.woodDark, -.6, .8, 1.72));
  g.add(beam(.35, .35, .1, M.dark, 1.1, 1.5, 1.72));
  for (let i = 0; i < 4; i++) g.add(beam(.12, 1.2, .12, M.woodDark, rand(-3, 3), .6, rand(-2, 3), rand(-.5, .5), 0, rand(-.6, .6)));
  // overgrown vines
  for (let i = 0; i < 6; i++) g.add(beam(.06, rand(1, 2.2), .06, toon(0x547f4a), -1.8 + i * .7, 1.8, 1.75, rand(-.1, .1), 0, rand(-.2, .2)));
  return g;
}

/* ================================================================== */
/*  Castle                                                             */
/* ================================================================== */
export function castleGate() {
  const g = new THREE.Group();
  // wall segments
  for (const s of [-1, 1]) {
    g.add(box(18, 6.5, 3.2, M.stoneWall, s * 13.5, 3.25, 0));
    g.add(box(18, .6, 3.8, M.stoneDark, s * 13.5, 6.6, 0));
    // crenellations
    for (let i = 0; i < 9; i++) g.add(box(1.0, .9, 3.4, M.stone, s * 13.5 - 8 + i * 2, 7.15, 0));
  }
  // gate towers
  for (const s of [-1, 1]) {
    g.add(cyl(3.0, 3.3, 11, 8, M.stone, s * 5.6, 5.5, 1.2));
    g.add(cyl(3.4, 3.4, .5, 8, M.stoneDark, s * 5.6, 11.1, 1.2));
    const roof = new THREE.Mesh(new THREE.ConeGeometry(3.7, 3.6, 8), M.roofBlue);
    roof.position.set(s * 5.6, 13.1, 1.2); roof.castShadow = true; g.add(roof);
    g.add(beam(1.0, 2.4, .05, M.clothBlue, s * 5.6, 9.2, 4.15));
    g.add(beam(1.4, .1, .1, M.gold, s * 5.6, 10.45, 4.15));
    addGlow(g, 0x8fd8ff, 3.2, s * 5.6, 8.4, 4.0);
  }
  // gatehouse arch
  g.add(box(8.6, 4.4, 3.4, M.stone, 0, 8.2, 1.1));
  g.add(box(8.9, .6, 3.8, M.stoneDark, 0, 10.6, 1.1));
  for (let i = 0; i < 4; i++) g.add(box(1.1, 1.0, 3.6, M.stone, -3.2 + i * 2.1, 11.25, 1.1));
  // dark gate opening
  g.add(box(5.2, 5.4, .4, M.dark, 0, 2.7, 2.75));
  // portcullis
  for (let i = 0; i < 7; i++) g.add(beam(.14, 4.8, .14, M.ironDark, -2.6 + i * .85, 2.5, 2.9));
  for (let i = 0; i < 4; i++) g.add(beam(5.4, .12, .12, M.ironDark, 0, .7 + i * 1.2, 2.9));
  // banners
  for (const s of [-1, 1]) {
    const b = box(1.4, 3.6, .06, M.clothBlue, s * 2.6, 5.2, 2.95); g.add(b);
    g.add(beam(1.6, .12, .12, M.gold, s * 2.6, 7.1, 2.95));
    const em = new THREE.Mesh(new THREE.OctahedronGeometry(.3, 0), M.crystalGold);
    em.position.set(s * 2.6, 5.4, 3.02); em.scale.set(1, 1.4, .2); g.add(em);
  }
  return g;
}

export function castleKeep() {
  const g = new THREE.Group();
  g.add(box(26, 9, 20, M.stoneWall, 0, 4.5, 0));
  g.add(box(28, .8, 22, M.stoneDark, 0, 9.2, 0));
  // keep tower
  g.add(cyl(5, 5.8, 21, 8, M.stone, 0, 10.5, -1));
  g.add(cyl(6.2, 6.2, .8, 8, M.stoneDark, 0, 21.2, -1));
  const roof = new THREE.Mesh(new THREE.ConeGeometry(7, 7, 8), M.roofBlue);
  roof.position.set(0, 25, -1); roof.castShadow = true; g.add(roof);
  const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(1.2, 0), M.crystalGold);
  crystal.position.set(0, 30.5, -1); crystal.scale.y = 1.8; g.add(crystal);
  addGlow(g, 0xffe28a, 26, 0, 30, -1);
  // side towers
  for (const s of [-1, 1]) {
    g.add(cyl(3.2, 3.8, 14, 8, M.stone, s * 16, 7, 2));
    const r = new THREE.Mesh(new THREE.ConeGeometry(4.2, 4.4, 8), M.roofBlue);
    r.position.set(s * 16, 16.4, 2); g.add(r);
    g.add(beam(1.0, 2.4, .05, M.clothBlue, s * 16, 11.6, 5.2));
  }
  // windows
  for (let i = 0; i < 6; i++) {
    g.add(beam(.8, 1.4, .3, M.window, -9 + i * 3.6, 5.5, 10.05));
    g.add(beam(.6, 1.2, .3, M.window, -6 + i * 2.4, 2.8, 10.05));
  }
  // front stairs
  for (let i = 0; i < 6; i++) g.add(box(14 - i * .8, .25, 1.3, M.stone, 0, .12 + i * .22, 10 + i * .55));
  return g;
}

export function castleWalls() {
  const g = new THREE.Group();
  for (const s of [-1, 1]) {
    g.add(box(3.2, 8, 26, M.stoneWall, s * 22, 4, -26));
    for (let i = 0; i < 12; i++) g.add(box(3.4, .9, 1.0, M.stone, s * 22, 8.4, -38 + i * 2.1));
    // tower
    g.add(cyl(3.4, 3.8, 12, 8, M.stone, s * 22, 6, 0));
    const r = new THREE.Mesh(new THREE.ConeGeometry(4.4, 5, 8), M.roofBlue);
    r.position.set(s * 22, 14.5, 0); g.add(r);
  }
  return g;
}

/* ================================================================== */
/*  Small decorations                                                  */
/* ================================================================== */
export function clothesline() {
  const g = new THREE.Group();
  for (const x of [-2, 2]) g.add(beam(.1, 2.4, .1, M.woodDark, x, 1.2, 0));
  g.add(beam(4.1, .04, .04, M.woodDark, 0, 2.3, 0));
  const colors = [M.clothCream, M.clothRed, M.clothBlue, M.clothGreen];
  for (let i = 0; i < 4; i++) {
    const c = box(.7, .8, .03, colors[i], -1.55 + i * 1.0, 1.9, 0);
    c.rotation.z = rand(-.08, .08); g.add(c);
  }
  return g;
}

export function campfire() {
  const g = new THREE.Group();
  for (let i = 0; i < 7; i++) {
    const a = i / 7 * TAU;
    const s = new THREE.Mesh(new THREE.DodecahedronGeometry(.22, 0), M.stone);
    s.position.set(Math.cos(a) * 1.1, .14, Math.sin(a) * 1.1); g.add(s);
  }
  for (let i = 0; i < 4; i++) g.add(beam(.13, 1.0, .13, M.woodDark, rand(-.25, .25), .4, rand(-.25, .25), rand(-.4, .4), rand(0, 3), rand(-.4, .4)));
  const f1 = new THREE.Mesh(new THREE.ConeGeometry(.45, 1.4, 6), new THREE.MeshBasicMaterial({ color: 0xff8a3a, transparent: true, opacity: .9 })); f1.position.y = 1.1; g.add(f1);
  const f2 = new THREE.Mesh(new THREE.ConeGeometry(.26, .95, 6), new THREE.MeshBasicMaterial({ color: 0xffe17a, transparent: true, opacity: .9 })); f2.position.y = 1.0; g.add(f2);
  addGlow(g, 0xff8a3a, 3.6, 0, 1.2, 0);
  g.userData.flames = [f1, f2];
  return g;
}

export function cart() {
  const g = new THREE.Group();
  g.add(box(1.8, .5, 2.6, M.woodLight, 0, .7, 0));
  for (const x of [-.8, .8]) for (const z of [-1, 1]) {
    const w = cyl(.45, .45, .15, 10, M.woodDark, x, .45, z, 0, 0, Math.PI / 2);
    g.add(w);
    g.add(cyl(.48, .48, .05, 10, M.ironDark, x + (x > 0 ? .05 : -.05), .45, z, 0, 0, Math.PI / 2));
  }
  for (let i = 0; i < 5; i++) g.add(box(.5, .35, .5, M.woodLight, rand(-.5, .5), 1.05, rand(-.8, .8)));
  g.add(cyl(.08, .08, 2.2, 5, M.woodDark, 0, .7, 1.9, Math.PI / 2));
  return g;
}
