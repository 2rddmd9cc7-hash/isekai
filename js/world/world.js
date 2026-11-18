import * as THREE from 'three';
import { G } from '../core/state.js';
import {
  toon, box, cyl, cone, sphere, plane, glowSprite, makeGlowTexture,
  clamp, rand, TAU, makeRuneTexture
} from '../core/utils.js';
import {
  heightAt, isWater, WATER_LEVEL, buildTerrain, buildWater, buildRoads, riverX
} from './terrain.js';
import { buildSky } from './sky.js';
import { buildVegetation } from './props.js';
import {
  house, tavern, smithy, alchemist, shopHouse, temple, barracks, marketStall,
  fountain, well, bench, lamp, fence, crates, bannerPole, cart, clothesline,
  goblinTent, goblinCampProps, ruinsSite, ruinAltar, shrineSite, caveEntrance,
  mineEntrance, bridge, windmill, farmPlot, scarecrow, waterfallSite, signpost,
  abandonedHut, wizardTower, castleGate, castleKeep, castleWalls, campfire,
  stoneLantern, goblinTotem, goblinCage
} from './structures.js';
import { NPC } from './npcs.js';
import { Enemy } from '../entities/enemies.js';

const GLOW = makeGlowTexture('#ffffff');

/* ================================================================== */
/*  World                                                             */
/* ================================================================== */
export class World {
  constructor(scene, effects, quality = 2) {
    this.scene = scene;
    this.effects = effects;
    this.quality = quality;
    this.colliders = G.colliders = [];
    this.exclusions = [];
    this.npcs = {};
    this.npcList = [];
    this.altars = {};
    this.pickups = [];
    this.interactables = G.interactables = [];
    this.mapPOIs = [];
    this.waypoint = null;
    this.zone = '';
    this.markerTimer = 0;
    this.fireLights = [];
    this.animated = [];

    this.altarPositions = {
      shrine: { x: 68, z: -6 },
      ruins: { x: 52, z: -47 },
      cave: { x: -76, z: 11 },
    };

    this.buildBase();
    this.buildVillage();
    this.buildLandmarks();
    this.buildVegetation();
    this.buildNPCs();
    this.buildPickups();
    this.spawnEnemies();
    this.buildBeacon();

    G.world = this;
    G.npcs = this.npcList;
    G.enemies = this.enemies;
    G.zone = 'Vila de Brisa';
    this.refreshMarkers();
  }

  /* ------------------------------------------------------------------ */
  /*  Base terrain                                                      */
  /* ------------------------------------------------------------------ */
  buildBase() {
    this.sky = buildSky(this.scene, this.quality);
    this.terrain = buildTerrain(this.scene, this.quality);
    this.water = buildWater(this.scene);
    this.roads = buildRoads(this.scene);
    this.bridgePos = { x: riverX(-60), z: -60 };
  }

  addExclusion(x, z, r) { this.exclusions.push({ x, z, r }); }
  addCollider(x, z, r) {
    for (const c of this.colliders) {
      if (Math.hypot(c.x - x, c.z - z) < Math.max(3, r) && Math.abs(c.r - r) < .2) return;
    }
    this.colliders.push({ x, z, r });
  }

  place(obj, x, z, rot = 0, y = null) {
    obj.position.set(x, y === null ? heightAt(x, z) : y, z);
    obj.rotation.y = rot;
    this.scene.add(obj);
    return obj;
  }

  buildVillage() {
    const S = this.scene;

    // ---- central plaza ----
    const f = fountain();
    this.place(f, 6, 28);
    this.fountain = f;
    this.addCollider(6, 28, 3.4);
    this.addExclusion(6, 28, 7);
    this.mapPOIs.push({ x: 6, z: 28, name: 'Praça do Cristal', icon: '✦', kind: 'town' });

    // ---- main buildings ----
    const tavernG = tavern({ rot: 0 });
    this.place(tavernG, -13, 38);
    this.addCollider(-13, 38, 4.3); this.addExclusion(-13, 38, 7.4);
    this.mapPOIs.push({ x: -13, z: 38, name: 'Taverna O Cervo Errante', icon: '🍺', kind: 'town' });

    const smithyG = smithy({ rot: 0 });
    this.place(smithyG, 14, 37);
    this.addCollider(14, 37, 4.0); this.addExclusion(14, 37, 7);
    this.mapPOIs.push({ x: 14, z: 37, name: 'Forja de Brann', icon: '⚒', kind: 'town' });
    const forgeLight = new THREE.PointLight(0xff8a3a, 7, 12, 2);
    forgeLight.position.set(13, heightAt(14, 37) + 2.4, 36);
    S.add(forgeLight);
    this.fireLights.push({ light: forgeLight, base: 7, phase: 0 });

    const alch = alchemist({ rot: 0 });
    this.place(alch, -20, 30);
    this.addCollider(-20, 30, 2.8); this.addExclusion(-20, 30, 5.6);
    this.mapPOIs.push({ x: -20, z: 30, name: 'Bancada de Lys', icon: '⚗', kind: 'town' });

    const shop = shopHouse({ rot: 0 });
    this.place(shop, 16, 26);
    this.addCollider(16, 26, 3.4); this.addExclusion(16, 26, 6.2);
    this.mapPOIs.push({ x: 16, z: 26, name: 'Mercadorias de Tuli', icon: '🪙', kind: 'town' });

    const temp = temple({ rot: 0 });
    this.place(temp, -14, 9);
    this.addCollider(-14, 9, 4.4); this.addExclusion(-14, 9, 7.5);
    this.mapPOIs.push({ x: -14, z: 9, name: 'Templo de Aetheria', icon: '✧', kind: 'town' });

    const barr = barracks({ rot: 0 });
    this.place(barr, 22, 45);
    this.addCollider(22, 45, 4.4); this.addExclusion(22, 45, 7.6);

    // ---- smaller homes ----
    const homes = [
      [-26, 44, .12], [28, 34, -.12], [-27, 17, -.1], [27, 15, .12],
      [-7, 50, .04], [11, 50, -.05], [-32, 31, .2], [33, 46, -.16],
    ];
    const roofs = [0, 1, 2, 0, 1, 2, 0, 2];
    homes.forEach(([x, z, rot], i) => {
      const h = house({ rot, w: 4.2 + (i % 2) * .6, d: 4.0, floors: i % 3 === 0 ? 2 : 1, balcony: i % 3 === 0 });
      this.place(h, x, z, rot);
      this.addCollider(x, z, 3.2);
      this.addExclusion(x, z, 6.2);
    });

    // ---- street furniture ----
    this.place(well(), -7.5, 23); this.addCollider(-7.5, 23, 1.4);
    this.place(bench(), 2.2, 30, Math.PI / 2);
    this.place(bench(), 9.8, 30, -Math.PI / 2);
    this.place(bench(), 3.4, 23.4, 0);
    this.place(bench(), -2, 39, Math.PI);
    this.place(marketStall(), 1.6, 19, .2);
    this.place(marketStall(), 10.6, 18.5, -.15);
    this.place(crates(), 18.2, 22); this.addCollider(18.2, 22, .9);
    this.place(crates(), -16.5, 35.5); this.addCollider(-16.5, 35.5, .9);
    this.place(cart(), 22.5, 20, .6); this.addCollider(22.5, 20, 1.3);
    this.place(clothesline(), -24, 34, .2);
    this.place(bannerPole(0x2f5c88), 2.4, 44);
    this.place(bannerPole(0xd8ad54), -2.4, 14);
    this.place(fence(6, .9), -32, 24, 0);
    this.place(fence(7, .9), 32, 10, .3);

    for (const [x, z] of [[4.4, 43], [-4.4, 43], [4.4, 35], [-4.4, 35], [4.4, 27], [-4.4, 27], [4.4, 19], [-4.4, 19], [4.4, 11], [-4.4, 11]]) {
      this.place(lamp(), x, z); this.addCollider(x, z, .35);
    }

    // lanterns by the temple
    this.place(stoneLantern(), -9, 14);
    this.place(stoneLantern(), -19, 14);

    // campfire near the inn (warm village mood)
    const camp = campfire();
    this.place(camp, -19, 43.5);
    this.addAnimatedFlames(camp);
    const light = new THREE.PointLight(0xff8a3a, 5, 11, 2);
    light.position.set(-19, heightAt(-19, 43.5) + 1.5, 43.5);
    S.add(light);
    this.fireLights.push({ light, base: 5, phase: 2.1 });

    // ---- signs ----
    this.place(signpost('VILA DE BRISA'), 4.5, 50, -.1);
    this.place(signpost('SANTUÁRIO →'), 3.5, 8, 0);
    this.place(signpost('CASTELO DE AETHERIA'), -3.5, 1, 0);
    this.place(signpost('ACAMPAMENTO GOBLIN ⚠'), -54, -23, 0);
    this.place(signpost('RUÍNAS DE ASTRA'), 35, -55, 0);
    this.place(signpost('LAGO SERENO →'), 61, -66, 0);

    // flower planters along the plaza
    const flowerMat = toon(0xffb8d0, { rim: .3, rimColor: 0xfff0f0 });
    const leafMat = toon(0x5f9a52, { rim: .15, rimColor: 0xc8ffb0 });
    for (let i = 0; i < 16; i++) {
      const a = i / 16 * TAU;
      const x = 6 + Math.cos(a) * 5.4, z = 28 + Math.sin(a) * 5.4;
      const g = new THREE.Group();
      g.add(cyl(.03, .03, .34, 4, leafMat, 0, .17, 0));
      g.add(sphere(.09, i % 3 ? flowerMat : toon(0xffd66e), 0, .36, 0, 6));
      this.place(g, x, z);
    }

    // ---- NPCs ----
    const npcDefs = [
      ['mira', 3, 25.2, .04],
      ['brann', 9.8, 33.2, .15],
      ['lys', -17.4, 26.3, -.12],
      ['tuli', 13.1, 22.3, .2],
      ['rowan', 2.2, 2.4, .1],
    ];
    for (const [id, x, z, rot] of npcDefs) {
      const npc = new NPC(S, id, { x, z }, rot);
      this.npcs[id] = npc;
      this.npcList.push(npc);
      this.interactables.push(npc);
      this.addExclusion(x, z, 2.2);
    }

    // ambient villagers (non-quest flavour)
    const ambient = [
      ['mira', -23, 27, 0.4], ['brann', -2, 33, 2.4], ['tuli', 7.5, 36, -1.8],
    ];
    // ambient duplicates would reuse quest portraits; keep the plaza calm and avoid fake duplicates.

    this.mapPOIs.push({ x: 0, z: 30, name: 'Vila de Brisa', icon: '⌂', kind: 'town', major: true });

    // roads are flattened; ensure the road centre stays walkable
    for (let z = -90; z < 55; z += 8) this.addExclusion(roadCenterX(z), z, 4.5);
  }

  /* ------------------------------------------------------------------ */
  /*  Landmarks                                                         */
  /* ------------------------------------------------------------------ */
  buildLandmarks() {
    const S = this.scene;

    // ---- Shrine of Sakura ----
    const shrine = shrineSite();
    shrine.rotation.y = 0;
    this.place(shrine, this.altarPositions.shrine.x, this.altarPositions.shrine.z, 0);
    this.addExclusion(this.altarPositions.shrine.x, this.altarPositions.shrine.z, 9);
    this.addCollider(this.altarPositions.shrine.x, this.altarPositions.shrine.z + 4.2, .7);
    this.altars.shrine = this.makeAltar('shrine', 'Altar do Santuário', shrine.userData.altar, shrine, 68, -6);
    this.decorateShrine(shrine);

    // ---- Ruins of Astra (east of the river) ----
    const ruins = ruinsSite();
    this.place(ruins, 52, -47, -.25);
    this.addExclusion(52, -47, 11);
    this.altars.ruins = this.makeAltar('ruins', 'Altar das Ruínas', ruins.userData.altar, ruins, 52, -47);
    this.addCollider(52, -55.8, 2.8);
    this.addCollider(46.2, -42.8, 2.8);
    this.addCollider(58.2, -49.6, 2.8);

    // ---- Crystal Cave ----
    const cave = caveEntrance();
    this.place(cave, -76, 5.5, 0);
    this.addExclusion(-76, 5.5, 8);
    this.addCollider(-79.8, 5.2, 1.8);
    this.addCollider(-72.2, 5.2, 1.8);
    const caveAltar = ruinAltar();
    this.place(caveAltar, -76, 11.5, 0);
    this.addCollider(-76, 11.5, 1.8);
    this.altars.cave = this.makeAltar('cave', 'Altar da Caverna', caveAltar, caveAltar, -76, 11.5);
    const caveLight = new THREE.PointLight(0x7fefff, 5, 15, 2);
    caveLight.position.set(-76, heightAt(-76, 5.5) + 2, 5);
    S.add(caveLight);

    // ---- Goblin camp ----
    const camp = goblinCampProps();
    this.place(camp, -64, -12, .2);
    this.addExclusion(-64, -12, 18);
    this.addCollider(-64, -12, 2.3); // bonfire
    this.mapPOIs.push({ x: -64, z: -12, name: 'Acampamento Goblin', icon: '☠', kind: 'danger', major: true });
    const campLight = new THREE.PointLight(0xff7a2a, 8, 18, 2);
    campLight.position.set(-64, heightAt(-64, -12) + 2, -12);
    S.add(campLight);
    this.fireLights.push({ light: campLight, base: 8, phase: 1.2 });
    for (const [x, z] of [[-52, -18], [-49, -6], [-70, -22]]) {
      const cage = goblinCage();
      this.place(cage, x, z, rand(0, TAU));
    }
    const totem = goblinTotem();
    this.place(totem, -52, -24, .3);
    this.place(signpost('PERIGO · GOBLINS'), -47, -26, 0);

    // ---- Bridge over the river ----
    this.place(bridge(), this.bridgePos.x, this.bridgePos.z, 0, WATER_LEVEL + .22);
    this.mapPOIs.push({ x: this.bridgePos.x, z: this.bridgePos.z, name: 'Ponte de Astra', icon: '⌒', kind: 'place' });
    this.addPath(this.bridgePos.x + 12, this.bridgePos.z, 52, -47, 1.4);

    // ---- Lake + waterfall + lakeside camp ----
    const fall = waterfallSite();
    this.place(fall, 48.5, -92, .4);
    this.addExclusion(48.5, -92, 10);
    this.mapPOIs.push({ x: 48.5, z: -92, name: 'Cachoeira do Lago', icon: '≋', kind: 'place' });
    this.animated.push({ type: 'waterfall', data: fall });

    const lakeCamp = new THREE.Group();
    lakeCamp.add(campfire());
    for (const [x, z, r] of [[-3, 1.6, .3], [3.4, 2.2, -.4]]) {
      const tent = this.makeTent(0xd8b45c);
      tent.position.set(x, 0, z); tent.rotation.y = r; lakeCamp.add(tent);
    }
    for (let i = 0; i < 3; i++) lakeCamp.add(box(.55, .35, .55, toon(0x8a5c36), -2 + i * 2, .18, 4));
    const lc = this.place(lakeCamp, 62, 62, .15);
    this.addExclusion(62, 62, 6.5);
    const lcLight = new THREE.PointLight(0xff9a4a, 6, 12, 2);
    lcLight.position.set(62, heightAt(62, 62) + 1.4, 62);
    S.add(lcLight);
    this.fireLights.push({ light: lcLight, base: 6, phase: 3.4 });
    this.addAnimatedFlames(lakeCamp);
    this.mapPOIs.push({ x: 62, z: 62, name: 'Acampamento do Viajante', icon: '⛺', kind: 'camp' });

    // ---- Farm ----
    const wm = windmill();
    this.place(wm, -40, 56, -.3);
    this.addCollider(-40, 56, 3.0);
    this.addExclusion(-40, 56, 7);
    this.animated.push({ type: 'windmill', data: wm });
    this.place(farmPlot(9, 8), -47, 49, .2);
    this.place(farmPlot(7, 7), -33, 51, -.3);
    const sc = scarecrow();
    this.place(sc, -44, 52.5, .4);
    for (let i = 0; i < 3; i++) this.place(fence(8, 1), -44 + i * 7, 44, .1);
    this.mapPOIs.push({ x: -42, z: 53, name: 'Fazenda do Moinho', icon: '☼', kind: 'place' });

    // ---- Wizard tower ----
    const tower = wizardTower();
    this.place(tower, -30, 78, .2);
    this.addCollider(-30, 78, 3.4);
    this.addExclusion(-30, 78, 8);
    this.animated.push({ type: 'rune', data: tower });
    this.mapPOIs.push({ x: -30, z: 78, name: 'Torre do Mago', icon: '✦', kind: 'place' });

    // ---- Abandoned hut ----
    const hut = abandonedHut();
    this.place(hut, 94, 36, .5);
    this.addCollider(94, 36, 2.7);
    this.addExclusion(94, 36, 6);
    this.mapPOIs.push({ x: 94, z: 36, name: 'Cabana Abandonada', icon: '⌂', kind: 'place' });

    // ---- Mine ----
    const mine = mineEntrance();
    this.place(mine, -102, -42, -.2);
    this.addCollider(-102, -42, 3.2);
    this.addExclusion(-102, -42, 8);
    this.mapPOIs.push({ x: -102, z: -42, name: 'Mina Pedra Cinzenta', icon: '⛏', kind: 'place' });

    // ---- Castle ----
    const keep = castleKeep();
    this.place(keep, 0, -116, 0);
    const gate = castleGate();
    this.place(gate, 0, -99, 0);
    const walls = castleWalls();
    this.place(walls, 0, -106, 0);
    this.addExclusion(0, -108, 30);
    this.addCollider(0, -98, 7.5);
    this.mapPOIs.push({ x: 0, z: -105, name: 'Castelo de Aetheria', icon: '♜', kind: 'castle', major: true });

    // ---- small roadside shrines ----
    for (const [x, z, r] of [[-29, 14, .2], [31, -34, -.3], [78, 18, .4]]) {
      const sl = stoneLantern();
      this.place(sl, x, z, r);
    }

    // A few extra dramatic rocks / crystals along the borders
    const crystalMat = new THREE.MeshBasicMaterial({ color: 0x9ceaff });
    for (let i = 0; i < 30; i++) {
      const a = rand(0, TAU), r = rand(86, 140);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (isWater(x, z)) continue;
      const size = rand(.3, 1.3);
      const cr = new THREE.Mesh(new THREE.OctahedronGeometry(size, 0), crystalMat);
      cr.position.set(x, heightAt(x, z) + size * .6, z);
      cr.rotation.set(rand(0, 3), rand(0, 3), rand(0, 3));
      cr.scale.y = rand(1.2, 2.4);
      S.add(cr);
    }
  }

  makeAltar(id, name, altarMesh, siteMesh, x, z) {
    const marker = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, color: id === 'shrine' ? 0xffd77a : id === 'ruins' ? 0x9ff0ff : 0xb490ff, transparent: true, opacity: .65, depthWrite: false, blending: THREE.AdditiveBlending }));
    marker.scale.setScalar(1.1);
    marker.position.set(0, 3.3, 0);
    siteMesh.add(marker);
    const light = new THREE.PointLight(id === 'shrine' ? 0xffd58a : id === 'ruins' ? 0x8fe8ff : 0xb490ff, 3.2, 11, 2);
    light.position.set(0, 2.2, 0); siteMesh.add(light);
    return { id, name, x, z, active: false, mesh: siteMesh, altar: altarMesh, marker, light };
  }

  decorateShrine(site) {
    // fallen petals and cherry particles are handled by the vegetation system;
    // add extra lanterns and a pair of sacred banners here.
    for (let i = 0; i < 4; i++) {
      const p = box(.32, .9, .02, toon(0xe8ddc0), -2.7 + i * 1.8, 4.0, 4.6);
      site.add(p);
    }
    for (let i = 0; i < 14; i++) {
      const a = rand(0, TAU), r = rand(3, 7);
      const petal = sphere(.06, toon(0xffc4d8, { rim: .3, rimColor: 0xfff0f8 }), Math.cos(a) * r, .08, Math.sin(a) * r, 5);
      petal.scale.y = .4; site.add(petal);
    }
  }

  makeTent(color) {
    const g = new THREE.Group();
    const cloth = toon(color, { rim: .2, rimColor: 0xfff0c8, side: THREE.DoubleSide });
    const tent = new THREE.Mesh(new THREE.ConeGeometry(1.4, 2.0, 4), cloth);
    tent.position.y = 1; tent.rotation.y = Math.PI / 4; g.add(tent);
    const dark = new THREE.Mesh(new THREE.ConeGeometry(.7, 1.1, 4), new THREE.MeshBasicMaterial({ color: 0x2c2016 }));
    dark.position.set(0, .55, .55); dark.rotation.y = Math.PI / 4; g.add(dark);
    g.add(cyl(.03, .035, 2.4, 4, toon(0x543520), 0, 1.2, 0));
    return g;
  }

  addAnimatedFlames(group) {
    group.traverse(o => {
      if (o.userData && o.userData.flames) {
        this.animated.push({ type: 'flames', data: o.userData.flames });
      }
    });
  }

  addPath(x1, z1, x2, z2, width = 1.1) {
    const len = Math.hypot(x2 - x1, z2 - z1);
    const steps = Math.ceil(len / 1.3);
    const mat = toon(0xa9a29a, { rim: .16, rimColor: 0xe4f2ff });
    const g = new THREE.Group();
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = x1 + (x2 - x1) * t, z = z1 + (z2 - z1) * t;
      if (isWater(x, z)) continue;
      const slab = box(width + rand(-.15, .2), .08, 1.15 + rand(0, .2), mat, 0, .06, 0);
      slab.position.set(x, heightAt(x, z) + .06, z);
      slab.rotation.y = Math.atan2(x2 - x1, z2 - z1) + rand(-.06, .06);
      g.add(slab);
    }
    this.scene.add(g);
  }

  /* ------------------------------------------------------------------ */
  /*  Vegetation, npcs, pickups, enemies                                */
  /* ------------------------------------------------------------------ */
  buildVegetation() {
    this.vegetation = buildVegetation(this.scene, this.exclusions, this.quality);
  }

  buildNPCs() {
    // NPCs are created inside buildVillage after their houses.
    // Keep their marker symbols in sync with the quest system.
  }

  buildPickups() {
    const oreSpots = [
      [-57, -5], [-68, -18], [49, -51], [55, -44], [-96, -40], [-84, 3],
      [-99, -48], [57, -56],
    ];
    const flowerSpots = [
      [61, -2], [74, -9], [46, -42], [58, -53], [-15, 21], [-24, 35],
      [51, -85], [73, -69], [-24, 70], [88, 28], [35, 54], [-52, 44],
    ];
    oreSpots.forEach(([x, z], i) => {
      if (isWater(x, z)) return;
      this.createPickup('ore', `Minério de Ferro`, x, z);
    });
    flowerSpots.forEach(([x, z]) => {
      if (isWater(x, z)) return;
      this.createPickup('flower', 'Luaflor', x, z);
    });
  }

  createPickup(kind, name, x, z) {
    const g = new THREE.Group();
    const y = heightAt(x, z);
    g.position.set(x, y, z);
    if (kind === 'ore') {
      for (let i = 0; i < 3; i++) {
        const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(rand(.22, .38), 0), toon(0x676269, { rim: .3, rimColor: 0xd8e8ff }));
        rock.position.set(rand(-.22, .22), rand(.12, .25), rand(-.22, .22));
        rock.rotation.set(rand(0, 3), rand(0, 3), rand(0, 3)); g.add(rock);
      }
      const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(.16, 0), new THREE.MeshBasicMaterial({ color: 0xffb45a }));
      crystal.position.set(0, .43, 0); crystal.scale.y = 1.6; g.add(crystal);
      const gl = glowSprite(0xffb45a, 1.2, GLOW); gl.position.y = .45; gl.material.opacity = .45; g.add(gl);
    } else {
      g.add(cyl(.022, .025, .42, 4, toon(0x5f9a52), 0, .21, 0));
      const petals = new THREE.Group();
      for (let i = 0; i < 5; i++) {
        const p = new THREE.Mesh(new THREE.SphereGeometry(.075, 5, 4), toon(0xbfe8ff, { rim: .5, rimColor: 0xffffff, emissive: 0x3a8fbf, emissiveIntensity: .5 }));
        const a = i / 5 * TAU;
        p.position.set(Math.cos(a) * .1, .48, Math.sin(a) * .1);
        p.scale.set(1, .5, 1); petals.add(p);
      }
      petals.add(sphere(.055, toon(0xfff2b0, { emissive: 0xbf9a3a, emissiveIntensity: .8 }), 0, .5, 0, 6));
      g.add(petals);
      const gl = glowSprite(0x9fe8ff, 1.3, GLOW); gl.position.y = .48; gl.material.opacity = .5; g.add(gl);
      g.userData.petals = petals;
    }
    this.scene.add(g);
    const pickup = {
      kind, name, group: g, active: true, radius: 1.25,
      get pos() { return g.position; },
      get interactLabel() { return `Coletar ${name}`; },
      interact: () => {
        if (!pickup.active) return;
        pickup.active = false;
        g.visible = false;
        if (G.quests) G.quests.addItem(kind, name);
        if (this.effects) {
          this.effects.particles(g.position.clone().add(new THREE.Vector3(0, .5, 0)), kind === 'ore' ? 0xffb45a : 0x9fe8ff, { count: 18, speed: 2.2, size: .12, life: .7, gravity: -1, up: 1.4 });
          this.effects.ring(g.position.clone(), kind === 'ore' ? 0xffb45a : 0x9fe8ff, .2, 1.6, .5, true);
        }
      },
      update: (dt) => {
        if (!pickup.active) return;
        g.rotation.y += dt * .7;
        g.position.y = y + Math.sin((G.time || 0) * 2.1 + x) * .05;
        if (g.userData.petals) g.userData.petals.rotation.y += dt * 1.3;
      },
    };
    this.pickups.push(pickup);
    this.interactables.push(pickup);
    return pickup;
  }

  spawnEnemies() {
    this.enemies = [];
    const add = (type, x, z, opts = {}) => {
      if (isWater(x, z)) return null;
      const e = new Enemy(this.scene, this.effects, type, new THREE.Vector3(x, heightAt(x, z), z), opts);
      this.enemies.push(e);
      return e;
    };

    // Goblin camp (the boss and his warband)
    this.chief = add('chief', -64, -7);
    add('scout', -56, -5);
    add('warrior', -71, -17);
    add('archer', -57, -19);
    add('shaman', -72, -5);
    add('berserker', -62, -23);
    add('scout', -69, -3);
    add('warrior', -52, -12);

    // Ruins guardians
    add('warrior', 48, -42);
    add('archer', 57, -51);
    add('shaman', 47, -53);
    add('warrior', 58, -43);

    // Shrine guardians
    add('warrior', 73, -2);
    add('scout', 62, -11);

    // Cave guardians
    add('warrior', -70, 14);
    add('shaman', -81, 12);
    add('scout', -83, 2);
    add('berserker', -69, 1);

    // Roadside ambushes
    add('scout', 18, -10);
    add('archer', 30, -22);
    add('warrior', -19, -5);
    add('scout', 39, -37);

    // Lake / bridge
    add('shaman', 55, -66);
    add('scout', 62, -61);

    // Mine
    add('berserker', -95, -37);
    add('warrior', -102, -33);
    add('scout', -96, -48);

    // Deep forest wanderers
    add('scout', 84, 54);
    add('warrior', -84, 65);

    G.enemies = this.enemies;
    if (this.chief) {
      this.chief.aggro = false;
      this.chief.bossBarShown = false;
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Waypoint beacon                                                   */
  /* ------------------------------------------------------------------ */
  buildBeacon() {
    const g = this.beacon = new THREE.Group();
    g.visible = false;
    const beamMat = new THREE.MeshBasicMaterial({ color: 0xffe2a0, transparent: true, opacity: .03, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(.1, .32, 2.6, 10, 1, true), beamMat);
    beam.position.y = 1.3; g.add(beam);
    const diamond = new THREE.Mesh(new THREE.OctahedronGeometry(.22, 0), new THREE.MeshBasicMaterial({ color: 0xffe7a0 }));
    diamond.position.y = 2.7; diamond.scale.y = 1.5; g.add(diamond);
    this.beaconGem = diamond;
    const glow = glowSprite(0xffd479, 1.1, GLOW); glow.position.y = 2.7; glow.material.opacity = .4; g.add(glow);
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.0, 1.2, 32), new THREE.MeshBasicMaterial({ color: 0xffd479, transparent: true, opacity: .45, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = .08; g.add(ring);
    this.beaconRing = ring;
    this.scene.add(g);
  }

  updateWaypoint(wp) {
    this.waypoint = wp;
    if (!wp) { this.beacon.visible = false; return; }
    this.beacon.visible = true;
    const y = heightAt(wp.x, wp.z);
    this.beacon.position.set(wp.x, y, wp.z);
  }

  refreshMarkers() {
    if (!G.quests) return;
    for (const npc of this.npcList) npc.setMarker(G.quests.npcMarker(npc.id));
    for (const id in this.altars) {
      const a = this.altars[id];
      const show = G.quests.q1 && G.quests.q1.state === 'active' && !a.active;
      a.marker.visible = show;
    }
    if (this.chief) this.chief.bossBarShown = false;
  }

  activateAltar(id) {
    const a = this.altars[id];
    if (!a || a.active) return false;
    if (!G.quests || G.quests.q1.state !== 'active') {
      if (G.ui) G.ui.toast('O altar está adormecido. Fale com a Anciã Mira primeiro.', 'warn');
      return false;
    }
    a.active = true;
    a.marker.visible = false;
    a.light.intensity = 10;
    if (a.altar && a.altar.userData.crystal) {
      a.altar.userData.crystal.material = new THREE.MeshBasicMaterial({ color: 0xfff0b0 });
      a.altar.userData.crystal.scale.y = 2.4;
    }
    if (a.altar && a.altar.userData.ring) a.altar.userData.ring.material.opacity = .95;
    const glow = glowSprite(0xffe7a0, 9, GLOW);
    glow.position.set(0, 3, 0); glow.material.opacity = .75; a.mesh.add(glow);
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(.25, .7, 22, 10, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffe7a0, transparent: true, opacity: .22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
    );
    beam.position.y = 10; a.mesh.add(beam);
    if (this.effects) {
      const p = new THREE.Vector3(a.x, heightAt(a.x, a.z) + 1.5, a.z);
      this.effects.shockwave(new THREE.Vector3(a.x, heightAt(a.x, a.z) + .1, a.z), 0xffe7a0, 8, .9);
      this.effects.particles(p, 0xffe7a0, { count: 60, speed: 5, size: .2, life: 1.5, gravity: -1.8, up: 2, color2: 0x8ff4ff });
    }
    if (G.audio) G.audio.sfx('quest');
    if (G.player) G.player.addXP(90);
    if (G.quests) G.quests.onAltarActivated(id);
    this.refreshMarkers();
    return true;
  }

  /* ------------------------------------------------------------------ */
  /*  Update                                                            */
  /* ------------------------------------------------------------------ */
  update(dt) {
    const t = G.time || 0;
    if (this.sky) this.sky.update(dt, t);
    if (this.water) this.water.update(dt, t);
    if (this.vegetation) this.vegetation.update(dt, t);

    // ambient animated props
    for (const a of this.animated) {
      if (a.type === 'windmill' && a.data.userData.blades) a.data.userData.blades.rotation.z += dt * .7;
      else if (a.type === 'flames') {
        for (let i = 0; i < a.data.length; i++) {
          const f = a.data[i];
          const s = 1 + Math.sin(t * (9 + i * 2) + i) * .15;
          f.scale.set(.85 + Math.sin(t * 7 + i) * .1, s, .85 + Math.cos(t * 6 + i) * .1);
          f.position.x = Math.sin(t * 3 + i) * .04;
        }
      } else if (a.type === 'waterfall') {
        const mat = a.data.userData.fallMat;
        if (mat) mat.uniforms.uTime.value = t;
        if (a.data.userData.mist) {
          a.data.userData.mist.children.forEach((m, i) => { m.material.opacity = .1 + Math.sin(t * .8 + i) * .05; });
        }
      } else if (a.type === 'rune') {
        if (a.data.userData.ring) a.data.userData.ring.rotation.z += dt * .25;
      }
    }

    // fire light flicker
    for (const f of this.fireLights) f.light.intensity = f.base * (0.82 + Math.sin(t * 8 + f.phase) * .1 + Math.sin(t * 17 + f.phase * 2) * .06);

    // fountain orb
    if (this.fountain && this.fountain.userData.spin) {
      this.fountain.userData.spin.rotation.y += dt * .5;
      this.fountain.userData.spin.position.y = 2.5 + Math.sin(t * 1.4) * .1;
      const ripple = this.fountain.userData.ripple;
      if (ripple) {
        const k = 1 + (t * .35 % 1) * .55;
        ripple.scale.setScalar(k);
        ripple.material.opacity = .32 * (1 - (t * .35 % 1));
      }
    }

    // altars
    for (const id in this.altars) {
      const a = this.altars[id];
      if (a.altar && a.altar.userData.crystal) a.altar.userData.crystal.rotation.y += dt * (a.active ? 1.7 : .45);
      if (a.altar && a.altar.userData.ring) a.altar.userData.ring.rotation.z += dt * .12;
      if (!a.active && a.marker.visible) a.marker.position.y = 3.3 + Math.sin(t * 2.2 + a.x) * .12;
    }

    // npcs
    for (const npc of this.npcList) npc.update(dt);

    // pickups
    for (const p of this.pickups) p.update(dt);

    // beacon
    if (this.beacon.visible) {
      this.beaconGem.rotation.y += dt * 1.4;
      this.beaconGem.position.y = 2.7 + Math.sin(t * 2) * .14;
      this.beaconRing.rotation.z += dt * .8;
      this.beaconRing.scale.setScalar(1 + Math.sin(t * 2.4) * .06);
    }

    // marker refresh
    this.markerTimer -= dt;
    if (this.markerTimer <= 0) {
      this.markerTimer = 1;
      this.refreshMarkers();
    }

    // zone
    this.updateZone();
  }

  updateZone() {
    if (!G.player) return;
    const p = G.player.pos;
    const d = (x, z) => Math.hypot(p.x - x, p.z - z);
    let z = 'Terras de Brisa';
    if (d(0, 32) < 44) z = 'Vila de Brisa';
    if (d(-64, -12) < 24) z = 'Acampamento Goblin';
    if (d(68, -6) < 22) z = 'Santuário de Sakura';
    if (d(52, -47) < 24) z = 'Ruínas de Astra';
    if (d(-76, 8) < 19) z = 'Caverna Cristalina';
    if (Math.hypot(p.x - 58, p.z + 78) < 28) z = 'Lago Sereno';
    if (p.z < -84) z = 'Castelo de Aetheria';
    if (d(62, 62) < 22) z = 'Acampamento do Viajante';
    if (d(-40, 56) < 20) z = 'Fazenda do Moinho';
    if (d(-30, 78) < 20) z = 'Torre do Magus';
    if (z !== this.zone) {
      this.zone = z;
      G.zone = z;
      if (G.ui) G.ui.setZone(z);
    }
  }
}

function roadCenterX(z) {
  // the main north-south road wiggles gently; centre it for vegetation exclusions
  return Math.sin(z * .09) * 1.6;
}
