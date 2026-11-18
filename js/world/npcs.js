import * as THREE from 'three';
import { G } from '../core/state.js';
import {
  toon, addOutline, box, cyl, sphere, cone, clamp, damp, rand, TAU,
  makeGlowTexture, glowSprite
} from '../core/utils.js';
import { heightAt } from './terrain.js';

const GLOW = makeGlowTexture('#ffffff');

const NPC_DATA = {
  mira: {
    name: 'Anciã Mira', title: 'Guardiã do Cristal', role: 'elder',
    skin: 0xf0c7a2, hair: 0xd8d2e8, hair2: 0xf4efff, eye: '#65e6d8',
    cloth: 0x2c5a63, cloth2: 0xd8b45c, accent: 0x8ff4ff, scale: .96,
  },
  brann: {
    name: 'Brann', title: 'Ferreiro', role: 'smith',
    skin: 0xd9a274, hair: 0x8a4a2a, hair2: 0xc47a3a, eye: '#ffb84a',
    cloth: 0x5a4632, cloth2: 0xa3723d, accent: 0xff9a4a, scale: 1.06,
  },
  lys: {
    name: 'Lys', title: 'Alquimista', role: 'alchemist',
    skin: 0xf0c39b, hair: 0x6a4a8a, hair2: 0xa882d8, eye: '#8ff0b8',
    cloth: 0x2f5058, cloth2: 0x8fd8b8, accent: 0x7dffc8, scale: .98,
  },
  tuli: {
    name: 'Tuli', title: 'Mercador', role: 'merchant',
    skin: 0xc98a5a, hair: 0xc4692a, hair2: 0xf0a04a, eye: '#ffd76e',
    cloth: 0x6a3a35, cloth2: 0xe0b25a, accent: 0xffc45a, scale: .93,
  },
  rowan: {
    name: 'Capitão Rowan', title: 'Guarda de Aetheria', role: 'guard',
    skin: 0xe8b98a, hair: 0x3a3a4a, hair2: 0x5a5a70, eye: '#6ab8ff',
    cloth: 0x3a5a7a, cloth2: 0xc8d6e4, accent: 0x8fc8ff, scale: 1.1,
  },
};

/* ------------------------------------------------------------------ */
/*  Painted anime face                                                */
/* ------------------------------------------------------------------ */
function makeFace(eyeColor, skin) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const x = c.getContext('2d');
  x.clearRect(0, 0, 256, 256);
  x.lineCap = 'round';

  const eye = (cx, mirror) => {
    x.save(); x.translate(cx, 126); x.scale(mirror, 1);
    x.fillStyle = '#f9f4e8'; x.beginPath(); x.ellipse(0, 0, 26, 30, 0, 0, 7); x.fill();
    x.fillStyle = '#2b2438'; x.beginPath(); x.ellipse(0, -2, 20, 26, 0, 0, 7); x.fill();
    x.fillStyle = eyeColor; x.beginPath(); x.ellipse(0, 4, 17, 21, 0, 0, 7); x.fill();
    x.fillStyle = 'rgba(20,28,40,.55)'; x.beginPath(); x.ellipse(0, 8, 8, 11, 0, 0, 7); x.fill();
    x.fillStyle = '#ffffff'; x.beginPath(); x.ellipse(-7, -7, 6, 8, -.2, 0, 7); x.fill();
    x.beginPath(); x.ellipse(7, 9, 3, 4, 0, 0, 7); x.fill();
    x.strokeStyle = '#241d30'; x.lineWidth = 4;
    x.beginPath(); x.ellipse(0, -2, 25, 29, 0, Math.PI * 1.08, Math.PI * 1.92); x.stroke();
    x.beginPath(); x.moveTo(-24, -10); x.lineTo(-25, -21); x.stroke();
    x.restore();
  };
  eye(88, 1); eye(168, -1);

  x.strokeStyle = '#3a2c3a'; x.lineWidth = 5;
  x.beginPath(); x.moveTo(58, 86); x.quadraticCurveTo(82, 76, 108, 84); x.stroke();
  x.beginPath(); x.moveTo(148, 84); x.quadraticCurveTo(174, 76, 198, 86); x.stroke();
  x.fillStyle = 'rgba(150,92,80,.45)';
  x.beginPath(); x.ellipse(128, 166, 2.4, 3.8, 0, 0, 7); x.fill();
  x.strokeStyle = '#a85a5a'; x.lineWidth = 3.6;
  x.beginPath(); x.moveTo(118, 188); x.quadraticCurveTo(128, 195, 140, 187); x.stroke();
  x.fillStyle = 'rgba(232,110,120,.14)';
  x.beginPath(); x.ellipse(68, 160, 17, 8, 0, 0, 7); x.fill();
  x.beginPath(); x.ellipse(188, 160, 17, 8, 0, 0, 7); x.fill();

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ------------------------------------------------------------------ */
/*  Name plate + quest marker textures                                */
/* ------------------------------------------------------------------ */
function makeNameTexture(name, title, tint = '#ffe2a2') {
  const c = document.createElement('canvas'); c.width = 512; c.height = 128;
  const x = c.getContext('2d');
  x.clearRect(0, 0, 512, 128);
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.font = '600 46px Georgia, serif';
  x.lineWidth = 8; x.strokeStyle = 'rgba(6,12,18,.85)';
  x.strokeText(name, 256, 48);
  const g = x.createLinearGradient(0, 0, 0, 100);
  g.addColorStop(0, '#fff7df'); g.addColorStop(1, tint);
  x.fillStyle = g; x.fillText(name, 256, 48);
  x.font = '500 25px Arial, sans-serif';
  x.fillStyle = 'rgba(190,218,225,.9)';
  x.lineWidth = 5; x.strokeStyle = 'rgba(6,12,18,.8)';
  x.strokeText(title, 256, 94); x.fillText(title, 256, 94);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeMarkerTexture(symbol, color = '#ffd479') {
  const c = document.createElement('canvas'); c.width = 128; c.height = 128;
  const x = c.getContext('2d');
  x.clearRect(0, 0, 128, 128);
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.font = 'bold 88px Georgia, serif';
  x.lineWidth = 7; x.strokeStyle = 'rgba(12,16,24,.85)';
  x.strokeText(symbol, 64, 68);
  x.lineWidth = 3; x.strokeStyle = color;
  x.strokeText(symbol, 64, 68);
  const g = x.createLinearGradient(0, 16, 0, 112);
  g.addColorStop(0, '#fffbe8'); g.addColorStop(1, color);
  x.fillStyle = g; x.fillText(symbol, 64, 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const MARKERS = {
  '!': makeMarkerTexture('!', '#ffd479'),
  '?': makeMarkerTexture('?', '#7ff0e0'),
  '◆': makeMarkerTexture('◆', '#9fe8ff'),
};

/* ================================================================== */
/*  NPC                                                               */
/* ================================================================== */
export class NPC {
  constructor(scene, id, position, rotation = 0) {
    this.scene = scene;
    this.id = id;
    this.cfg = NPC_DATA[id];
    this.name = this.cfg.name;
    this.title = this.cfg.title;
    this.radius = 1.1;
    this.markerSymbol = '';
    this.nearT = 0;
    this.wave = 0;
    this.phase = rand(0, TAU);

    this.group = new THREE.Group();
    this.group.position.set(position.x, heightAt(position.x, position.z), position.z);
    this.group.rotation.y = rotation;
    scene.add(this.group);

    this.build();
    this.buildLabels();
    this.shadow();
    this.update(0);
  }

  get pos() { return this.group.position; }
  get interactLabel() { return 'Falar com ' + this.name; }
  interact() {
    if (G.quests) G.quests.talk(this.id);
  }

  build() {
    const c = this.cfg;
    const skin = toon(c.skin, { rim: .26, rimColor: 0xffeed8 });
    const skinShade = toon(new THREE.Color(c.skin).multiplyScalar(.82).getHex(), { rim: .2, rimColor: 0xffd8b8 });
    const hair = toon(c.hair, { rim: .28, rimColor: c.hair2 });
    const hairL = toon(c.hair2, { rim: .3, rimColor: 0xffffff });
    const cloth = toon(c.cloth, { rim: .2, rimColor: c.hair2 });
    const cloth2 = toon(c.cloth2, { rim: .24, rimColor: 0xfff2c8 });
    const leather = toon(0x5a3c26, { rim: .16, rimColor: 0xffd0a0 });
    const leatherD = toon(0x3a2719, { rim: .12, rimColor: 0xc8a078 });
    const metal = toon(0xa8b4c0, { rim: .45, rimColor: 0xffffff });
    const gold = toon(0xe0b25a, { rim: .45, rimColor: 0xfff4c0, emissive: 0x2a1a00, emissiveIntensity: .35 });
    const accent = toon(c.accent, { rim: .5, rimColor: 0xffffff, emissive: c.accent, emissiveIntensity: .28 });

    const rig = this.rig = {};
    const hip = rig.hip = new THREE.Group();
    hip.position.y = .86;
    hip.scale.setScalar(c.scale);
    this.group.add(hip);

    const torso = rig.torso = new THREE.Group();
    hip.add(torso);

    if (c.role === 'elder') {
      const skirt = new THREE.Mesh(new THREE.CylinderGeometry(.24, .46, .92, 10), cloth);
      skirt.position.y = -.1; hip.add(skirt); addOutline(skirt, .012, 0x101c22);
      const hem = new THREE.Mesh(new THREE.CylinderGeometry(.455, .47, .08, 10), cloth2);
      hem.position.y = -.54; hip.add(hem);
    } else {
      const tunic = new THREE.Mesh(new THREE.CylinderGeometry(.245, .3, .62, 9), cloth);
      tunic.position.y = .1; hip.add(tunic); addOutline(tunic, .011, 0x181820);
      const belt = new THREE.Mesh(new THREE.CylinderGeometry(.305, .305, .09, 9), leatherD);
      belt.position.y = -.14; hip.add(belt);
      hip.add(box(.11, .09, .05, gold, 0, -.14, .3));
    }

    const chest = new THREE.Mesh(new THREE.CylinderGeometry(.255, .235, .5, 9), cloth);
    chest.position.y = .43; torso.add(chest); addOutline(chest, .012, 0x141820);
    // collar / shawl
    if (c.role === 'elder') {
      const shawl = new THREE.Mesh(new THREE.TorusGeometry(.21, .075, 6, 14), cloth2);
      shawl.rotation.x = Math.PI / 2; shawl.position.y = .58; torso.add(shawl);
    } else if (c.role === 'smith') {
      const apron = new THREE.Mesh(new THREE.PlaneGeometry(.40, .7), leather);
      apron.position.set(0, .12, .285); apron.material.side = THREE.DoubleSide; torso.add(apron);
      torso.add(box(.44, .08, .04, leatherD, 0, .48, .3));
    } else if (c.role === 'guard') {
      const breast = box(.46, .4, .08, metal, 0, .45, .255); torso.add(breast);
      for (const s of [-1, 1]) torso.add(box(.05, .42, .1, gold, s * .19, .44, .27));
      const cape = new THREE.Mesh(new THREE.PlaneGeometry(.55, .95), cloth2);
      cape.position.set(0, .2, -.27); cape.material.side = THREE.DoubleSide; torso.add(cape);
    } else if (c.role === 'merchant') {
      const vest = box(.42, .38, .07, cloth2, 0, .42, .26); torso.add(vest);
      for (let i = 0; i < 3; i++) torso.add(sphere(.025, gold, -.11 + i * .11, .36, .31, 5));
    } else if (c.role === 'alchemist') {
      const sash = new THREE.Mesh(new THREE.CylinderGeometry(.26, .25, .09, 9), cloth2);
      sash.rotation.z = .35; sash.position.y = .28; torso.add(sash);
      const vial = cyl(.035, .035, .11, 6, accent, .2, .2, .26); torso.add(vial);
    }

    // arms
    const makeArm = (side) => {
      const shoulder = new THREE.Group();
      shoulder.position.set(side * .29, .53, 0);
      torso.add(shoulder);
      const upper = cyl(.07, .08, .29, 7, cloth, 0, -.15, 0);
      shoulder.add(upper);
      const elbow = new THREE.Group(); elbow.position.y = -.3; shoulder.add(elbow);
      const fore = cyl(.06, .072, .26, 7, c.role === 'smith' ? skinShade : cloth, 0, -.13, 0);
      elbow.add(fore);
      const cuff = cyl(.076, .076, .06, 7, leather, 0, -.25, 0); elbow.add(cuff);
      const hand = new THREE.Group(); hand.position.y = -.29; elbow.add(hand);
      const palm = sphere(.062, skin, 0, 0, 0, 7); palm.scale.set(1, 1.1, .8); hand.add(palm);
      return { shoulder, elbow, hand };
    };
    rig.armR = makeArm(-1); rig.armL = makeArm(1);
    rig.armR.shoulder.rotation.z = -.13;
    rig.armL.shoulder.rotation.z = .13;
    rig.armR.shoulder.rotation.x = -.08;
    rig.armL.shoulder.rotation.x = -.08;

    // head
    const neck = cyl(.07, .085, .12, 7, skinShade, 0, .64, 0); torso.add(neck);
    const head = rig.head = new THREE.Group();
    head.position.y = .76; torso.add(head);
    const skull = sphere(.23, skin, 0, 0, 0, 16); skull.scale.set(1, 1.08, .98); head.add(skull);
    addOutline(skull, .011, 0x1a1420);
    for (const s of [-1, 1]) { const e = sphere(.045, skin, s * .225, -.01, 0, 6); e.scale.set(.6, 1, .8); head.add(e); }
    const face = new THREE.Mesh(new THREE.PlaneGeometry(.34, .34), new THREE.MeshBasicMaterial({ map: makeFace(c.eye, c.skin), transparent: true, depthWrite: false }));
    face.position.set(0, -.012, .216); head.add(face);

    // hair base
    const hairBack = new THREE.Mesh(new THREE.SphereGeometry(.25, 12, 10, 0, TAU, 0, Math.PI * .74), hair);
    hairBack.position.set(0, .02, -.02); hairBack.scale.set(1.04, 1.1, 1.05); head.add(hairBack);
    addOutline(hairBack, .012, 0x0e0c1a);

    if (c.role === 'elder') {
      const bun = sphere(.13, hairL, 0, .18, -.18, 8); head.add(bun);
      // loose silver strands over the bun and down the back
      for (const i of [-1, 0, 1]) {
        const strand = new THREE.Mesh(new THREE.ConeGeometry(.045, .44, 5), i === 0 ? hairL : hair);
        strand.position.set(i * .11, -.2, -.17); strand.rotation.z = i * .12; strand.rotation.x = -.06; head.add(strand);
      }
      const pin = box(.22, .022, .022, gold, 0, .24, -.2); pin.rotation.z = .18; head.add(pin);
      const pinGem = new THREE.Mesh(new THREE.OctahedronGeometry(.028, 0), accent); pinGem.position.set(.11, .25, -.19); head.add(pinGem);
      // silver braid resting over the shawl (visible from behind)
      for (let i = 0; i < 4; i++) {
        const bead = sphere(.07 - i * .008, i % 2 ? hair : hairL, 0, -.23 - i * .12, -.255 - i * .012, 7);
        bead.scale.y = 1.15; head.add(bead);
      }
      const braidTip = new THREE.Mesh(new THREE.ConeGeometry(.04, .16, 5), hair);
      braidTip.position.set(0, -.74, -.29); head.add(braidTip);
      const ribbon = new THREE.Mesh(new THREE.TorusGeometry(.052, .014, 4, 9), gold);
      ribbon.rotation.x = Math.PI / 2; ribbon.position.set(0, -.18, -.25); head.add(ribbon);
      const circlet = new THREE.Mesh(new THREE.TorusGeometry(.195, .017, 5, 16), gold);
      circlet.rotation.set(Math.PI / 2, 0, 0); circlet.position.y = .08; head.add(circlet);
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(.035, 0), new THREE.MeshBasicMaterial({ color: 0x8ff4ff }));
      gem.position.set(0, .12, .195); head.add(gem);
      const s = glowSprite(0x7ff0ff, .45, GLOW); s.material.opacity = .45; gem.add(s);
      for (const side of [-1, 1]) {
        const lock = new THREE.Mesh(new THREE.ConeGeometry(.065, .46, 4), hair);
        lock.position.set(side * .205, -.12, .05); lock.rotation.z = side * .1; head.add(lock);
      }
      const staff = new THREE.Group();
      const pole = cyl(.025, .035, 1.7, 6, leatherD, 0, .1, 0); staff.add(pole);
      const orb = new THREE.Mesh(new THREE.OctahedronGeometry(.09, 0), accent); orb.position.y = .96; staff.add(orb);
      const gl = glowSprite(0x8ff8ff, 1.0, GLOW); gl.position.y = .96; gl.material.opacity = .5; staff.add(gl);
      staff.position.set(0, -.28, .04); rig.armL.hand.add(staff); staff.rotation.x = -.05;
    } else if (c.role === 'smith') {
      const bald = sphere(.23, skin, 0, .12, -.02, 12); bald.scale.set(.95, .7, .95); head.add(bald);
      const beard = new THREE.Mesh(new THREE.ConeGeometry(.2, .44, 7), hairL);
      beard.position.set(0, -.26, .16); head.add(beard);
      const moust = box(.2, .06, .05, hairL, 0, -.1, .215); head.add(moust);
      const hammer = new THREE.Group();
      hammer.add(cyl(.035, .04, .75, 5, leatherD, 0, .25, 0));
      hammer.add(box(.27, .16, .16, metal, 0, .62, 0));
      hammer.position.set(0, 0, -.03); hammer.rotation.z = -.15; rig.armR.hand.add(hammer);
    } else if (c.role === 'alchemist') {
      const hat = new THREE.Group();
      const brim = cyl(.42, .44, .06, 12, cloth2, 0, 0, 0); hat.add(brim);
      const top = new THREE.Mesh(new THREE.ConeGeometry(.25, .62, 10), cloth2); top.position.y = .31; hat.add(top);
      top.rotation.z = .12; top.position.x = .04;
      hat.position.y = .2; hat.rotation.x = -.08; head.add(hat);
      const band = cyl(.26, .26, .06, 10, accent, .02, .078, 0); hat.add(band);
      for (const side of [-1, 1]) {
        const lock = new THREE.Mesh(new THREE.ConeGeometry(.07, .62, 4), hair);
        lock.position.set(side * .2, -.2, -.01); lock.rotation.z = side * .06; head.add(lock);
      }
      const bag = box(.2, .22, .12, leather, .3, -.14, .02); hip.add(bag);
    } else if (c.role === 'merchant') {
      const turban = new THREE.Mesh(new THREE.SphereGeometry(.245, 10, 8, 0, TAU, 0, Math.PI * .55), cloth2);
      turban.position.y = .08; turban.scale.set(1.02, .82, 1.02); head.add(turban);
      const jewel = new THREE.Mesh(new THREE.OctahedronGeometry(.035, 0), accent); jewel.position.set(0, .17, .2); head.add(jewel);
      const stache = box(.22, .045, .04, hair, 0, -.1, .22); head.add(stache);
      const pack = box(.36, .4, .24, leather, 0, .05, -.34); hip.add(pack);
      hip.add(box(.4, .06, .28, gold, 0, .24, -.34));
    } else if (c.role === 'guard') {
      const helm = new THREE.Mesh(new THREE.SphereGeometry(.235, 10, 8, 0, TAU, 0, Math.PI * .62), metal);
      helm.position.y = .06; head.add(helm);
      head.add(box(.36, .07, .08, metal, 0, .06, .2));
      const plume = new THREE.Mesh(new THREE.ConeGeometry(.075, .34, 5), toon(0x2f5c88, { rim: .3, rimColor: 0xa8d8ff }));
      plume.position.set(0, .33, -.02); plume.rotation.x = -.25; head.add(plume);
      const spear = new THREE.Group();
      spear.add(cyl(.025, .035, 2.4, 5, leatherD, 0, .7, 0));
      const tip = new THREE.Mesh(new THREE.ConeGeometry(.075, .34, 4), metal); tip.position.y = 2.03; spear.add(tip);
      spear.position.set(0, -.2, .02); spear.rotation.z = .05; rig.armR.hand.add(spear);
    }

    // legs
    const makeLeg = (side) => {
      const hj = new THREE.Group(); hj.position.set(side * .11, -.02, 0); hip.add(hj);
      const thigh = cyl(.075, .085, .38, 7, c.role === 'elder' ? cloth : leatherD, 0, -.19, 0); hj.add(thigh);
      const knee = new THREE.Group(); knee.position.y = -.38; hj.add(knee);
      const shin = cyl(.06, .072, .34, 7, leatherD, 0, -.17, 0); knee.add(shin);
      const boot = box(.13, .16, .25, leather, 0, -.36, .04); knee.add(boot);
      return { hj, knee };
    };
    rig.legL = makeLeg(1); rig.legR = makeLeg(-1);
    rig.legL.hj.visible = c.role !== 'elder';
    rig.legR.hj.visible = c.role !== 'elder';

    this.group.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
  }

  shadowGround() {
    const geo = new THREE.CircleGeometry(.46 * this.cfg.scale, 14);
    const mat = new THREE.MeshBasicMaterial({ color: 0x0a1a12, transparent: true, opacity: .25, depthWrite: false });
    this.shadowMesh = new THREE.Mesh(geo, mat);
    this.shadowMesh.rotation.x = -Math.PI / 2;
    this.group.add(this.shadowMesh);
  }
  shadow() { this.shadowGround(); }

  buildLabels() {
    const tex = makeNameTexture(this.name, this.title, this.cfg.role === 'guard' ? '#bfe0ff' : '#ffe2a2');
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: true });
    this.nameplate = new THREE.Sprite(mat);
    this.nameplate.scale.set(2.3, .58, 1);
    this.nameplate.position.y = 2.36 * this.cfg.scale;
    this.group.add(this.nameplate);

    this.marker = new THREE.Sprite(new THREE.SpriteMaterial({ map: MARKERS['!'], transparent: true, depthWrite: false, depthTest: false }));
    this.marker.scale.set(.52, .52, 1);
    this.marker.position.y = 2.84 * this.cfg.scale;
    this.marker.visible = false;
    this.group.add(this.marker);
  }

  setMarker(symbol) {
    if (symbol === this.markerSymbol) return;
    this.markerSymbol = symbol;
    if (!symbol) { this.marker.visible = false; return; }
    const tex = MARKERS[symbol] || MARKERS['◆'];
    this.marker.material.map = tex;
    this.marker.material.needsUpdate = true;
    this.marker.visible = true;
  }

  update(dt) {
    const t = G.time || 0;
    const p = G.player;
    let near = false, dist = 99;
    if (p) {
      dist = p.pos.distanceTo(this.group.position);
      near = dist < 9;
    }
    if (near && this.nearT < 1) this.nearT = Math.min(1, this.nearT + dt * 3);
    else if (!near && this.nearT > 0) this.nearT = Math.max(0, this.nearT - dt * 2);

    const idle = Math.sin(t * 1.6 + this.phase);
    this.rig.torso.rotation.x = damp(this.rig.torso.rotation.x, .02 + idle * .014, 4, dt);
    this.rig.hip.position.y = .86 + idle * .012 + (this.cfg.role === 'guard' ? 0 : 0);
    this.rig.armR.shoulder.rotation.x = damp(this.rig.armR.shoulder.rotation.x, -.08 + idle * .05 - this.wave * .9, 5, dt);
    this.rig.armL.shoulder.rotation.x = damp(this.rig.armL.shoulder.rotation.x, -.08 - idle * .04, 5, dt);
    this.rig.armR.elbow.rotation.x = damp(this.rig.armR.elbow.rotation.x, .16, 5, dt);
    this.rig.armL.elbow.rotation.x = damp(this.rig.armL.elbow.rotation.x, .16, 5, dt);

    if (near && p) {
      const yaw = Math.atan2(p.pos.x - this.group.position.x, p.pos.z - this.group.position.z);
      let rel = yaw - this.group.rotation.y;
      while (rel > Math.PI) rel -= TAU;
      while (rel < -Math.PI) rel += TAU;
      this.rig.head.rotation.y = damp(this.rig.head.rotation.y, clamp(rel, -.85, .85), 5, dt);
      this.rig.torso.rotation.y = damp(this.rig.torso.rotation.y, clamp(rel, -.3, .3) * .45, 4, dt);
      this.wave = Math.min(1, this.wave + dt * 1.6);
      this.rig.armR.shoulder.rotation.z = -.13 - Math.sin(t * 5) * .35 * this.wave;
    } else {
      this.rig.head.rotation.y = damp(this.rig.head.rotation.y, 0, 3, dt);
      this.rig.torso.rotation.y = damp(this.rig.torso.rotation.y, 0, 3, dt);
      this.wave = Math.max(0, this.wave - dt * 2);
      this.rig.armR.shoulder.rotation.z = damp(this.rig.armR.shoulder.rotation.z, -.13, 4, dt);
    }

    if (this.marker.visible) {
      this.marker.position.y = 2.84 * this.cfg.scale + Math.sin(t * 2.6) * .1;
      this.marker.material.rotation = Math.sin(t * 1.2) * .06;
    }
    this.nameplate.visible = dist < 31;
    if (this.shadowMesh) {
      const gy = G.groundAt ? G.groundAt(this.group.position.x, this.group.position.z) : heightAt(this.group.position.x, this.group.position.z);
      this.shadowMesh.position.y = gy - this.group.position.y + .04;
    }
  }
}
