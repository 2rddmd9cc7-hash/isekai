import * as THREE from 'three';
import { G, angleDiff } from '../core/state.js';
import {
  toon, addOutline, clamp, damp, lerp, rand, smoothstep, TAU, box, cyl, sphere, cone,
  projectToScreen, makeGlowTexture, glowSprite
} from '../core/utils.js';
import { heightAt, WATER_LEVEL } from '../world/terrain.js';

const GLOW = makeGlowTexture('#ffffff');
const ALERT_TEX = (() => {
  const c = document.createElement('canvas'); c.width = 64; c.height = 64;
  const x = c.getContext('2d');
  x.fillStyle = '#ff4a3a'; x.font = 'bold 54px Georgia, serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.strokeStyle = '#2a0808'; x.lineWidth = 7; x.strokeText('!', 32, 34); x.fillText('!', 32, 34);
  return new THREE.CanvasTexture(c);
})();

export const ENEMY_TYPES = {
  scout: {
    name: 'Batedor Goblin', hp: 46, speed: 7.0, damage: 7, radius: .5, scale: .76, xp: 22, gold: 9,
    aggro: 15, melee: 1.8, attackCd: 1.15, color: 0x86a854, leather: 0x5a4030, uniform: 'scout',
  },
  warrior: {
    name: 'Guerreiro Goblin', hp: 92, speed: 4.4, damage: 12, radius: .62, scale: .95, xp: 38, gold: 16,
    aggro: 14, melee: 2.3, attackCd: 1.5, color: 0x6b8c48, leather: 0x53392a, uniform: 'warrior',
  },
  archer: {
    name: 'Arqueiro Goblin', hp: 68, speed: 4.2, damage: 10, radius: .58, scale: .9, xp: 34, gold: 14,
    aggro: 18, melee: 2.0, attackCd: 1.9, color: 0x7f9a54, leather: 0x4e3a2a, uniform: 'archer',
  },
  shaman: {
    name: 'Xamã Goblin', hp: 78, speed: 3.3, damage: 15, radius: .62, scale: .92, xp: 48, gold: 22,
    aggro: 17, melee: 2.0, attackCd: 2.4, color: 0x8fa06a, leather: 0x4a3f5a, uniform: 'shaman',
  },
  berserker: {
    name: 'Berserker Goblin', hp: 155, speed: 3.8, damage: 20, radius: .9, scale: 1.3, xp: 72, gold: 32,
    aggro: 15, melee: 2.9, attackCd: 2.1, color: 0x71803f, leather: 0x453122, uniform: 'berserker',
  },
  chief: {
    name: 'Grimmjaw', hp: 1050, speed: 3.9, damage: 26, radius: 1.55, scale: 2.2, xp: 400, gold: 240,
    aggro: 22, melee: 4.2, attackCd: 2.4, color: 0x5c7038, leather: 0x33251c, uniform: 'chief',
  },
};

const isGoblin = t => t !== 'chief';

export class Enemy {
  constructor(scene, effects, type, position, opts = {}) {
    this.scene = scene;
    this.effects = effects;
    this.type = type;
    this.cfg = ENEMY_TYPES[type];
    this.name = this.cfg.name;
    this.isBoss = type === 'chief';
    this.radius = this.cfg.radius;
    this.radiusBase = this.cfg.radius;
    this.maxHp = Math.round(this.cfg.hp * (opts.hpMul || 1));
    this.hp = this.maxHp;
    this.damage = this.cfg.damage * (opts.dmgMul || 1);
    this.dead = false;
    this.deathT = 0;
    this.aggro = false;
    this.frozen = false;
    this.freezeT = 0;
    this.burnT = 0; this.burnDmg = 0;
    this.attack = null;
    this.cd = rand(.4, 1.2);
    this.state = 'idle';
    this.wanderAngle = rand(0, TAU);
    this.wanderT = rand(1, 3);
    this.fleeing = 0;
    this.moveAmount = 0;
    this.walkPhase = 0;
    this.home = new THREE.Vector3(position.x, 0, position.z);
    this.home.y = (G.groundAt ? G.groundAt(position.x, position.z) : heightAt(position.x, position.z));
    this.vel = new THREE.Vector3();
    this.flash = 0;
    this.respawnAt = 0;
    this.alertT = 0;
    this.phase = 0;
    this.enraged = false;
    this.summoned = { one: false, two: false };
    this.headHeight = 1.7 * this.cfg.scale;
    this.materials = [];
    this.flashMats = [];
    this.telegraph = null;
    this.deadAnim = 0;
    this.bossBarShown = false;

    this.group = new THREE.Group();
    this.group.position.copy(this.home);
    this.scene.add(this.group);
    this.model = new THREE.Group();
    this.model.scale.setScalar(this.cfg.scale);
    this.group.add(this.model);
    this.build();
    this.headHeight = (this.height || 1.7) * this.cfg.scale;
    this.radius = this.radiusBase = this.cfg.radius * (this.cfg.scale > 1.5 ? 1.15 : 1);

    // blob shadow
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(this.isBoss ? 1.5 : .55, 14), new THREE.MeshBasicMaterial({ color: 0x0a1408, transparent: true, opacity: .3, depthWrite: false }));
    this.shadow.rotation.x = -Math.PI / 2; this.shadow.position.y = .04; this.shadow.scale.setScalar(this.cfg.scale * .9);
    this.group.add(this.shadow);

    if (this.isBoss) this.group.traverse(o => { if (o.isMesh) o.castShadow = true; });
    else this.model.traverse(o => { if (o.isMesh) o.castShadow = true; });

    // alert sprite
    this.alert = new THREE.Sprite(new THREE.SpriteMaterial({ map: ALERT_TEX, transparent: true, depthWrite: false, depthTest: false }));
    this.alert.scale.setScalar(.45); this.alert.position.y = this.headHeight + .6; this.alert.visible = false;
    this.group.add(this.alert);

    // health bar
    this.bar = document.createElement('div');
    this.bar.className = 'ebar' + (this.isBoss ? ' boss' : '');
    this.bar.innerHTML = `<div class="en">${this.name}</div><div class="et"><div class="ef"></div></div>`;
    this.barFill = this.bar.querySelector('.ef');
    this.bar.style.display = 'none';
    document.getElementById('enemyBars').appendChild(this.bar);

    // boss aura
    if (this.isBoss) {
      this.aura = glowSprite(0xff6a3a, 7, GLOW);
      this.aura.material.opacity = .22;
      this.aura.position.y = 2.4;
      this.group.add(this.aura);
      this.emblem = new THREE.Sprite(new THREE.SpriteMaterial({ map: ALERT_TEX, color: 0xffb060, transparent: true, opacity: .0, depthWrite: false }));
    }
  }

  /* ================================================================== */
  /*  MODEL                                                             */
  /* ================================================================== */
  build() {
    const c = this.cfg;
    const skin = toon(c.color, { rim: .26, rimColor: 0xd8ffa8 });
    const skinDark = toon(new THREE.Color(c.color).multiplyScalar(.7).getHex(), { rim: .2, rimColor: 0xb8e890 });
    const leather = toon(c.leather, { rim: .16, rimColor: 0xffd0a0 });
    const leatherDark = toon(new THREE.Color(c.leather).multiplyScalar(.6).getHex(), { rim: .12, rimColor: 0xd8b080 });
    const cloth = toon(0x7a5c38, { rim: .14, rimColor: 0xffe0a0 });
    const iron = toon(0x6a7480, { rim: .4, rimColor: 0xd8f0ff });
    const ironDark = toon(0x3a414a, { rim: .2, rimColor: 0xa0c0d8 });
    const bone = toon(0xd8cfb4, { rim: .2, rimColor: 0xfff6dc });
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffe066 });
    const pupilMat = new THREE.MeshBasicMaterial({ color: 0x1a1208 });
    const blood = toon(0x8a2e2a, { rim: .2, rimColor: 0xffa080 });
    const gold = toon(0xd8ad54, { rim: .5, rimColor: 0xfff0b0, emissive: 0x3a2600, emissiveIntensity: .35 });
    const robe = toon(0x3e4a63, { rim: .18, rimColor: 0xb0c8ff });
    const steel = toon(0xc8d6e4, { rim: .5, rimColor: 0xffffff });
    this.materials.push(skin, skinDark, leather, leatherDark, cloth, iron, ironDark, bone, blood, gold, robe, steel);
    this.flashMats = [skin, skinDark, leather, leatherDark, cloth, iron, ironDark, robe].map(m => ({ m, e: m.emissive.clone(), i: m.emissiveIntensity }));

    const u = c.uniform;
    const rig = this.rig = {};
    const hip = rig.hip = new THREE.Group();
    hip.position.y = .56;
    this.model.add(hip);

    // torso squashed pear
    const torso = rig.torso = new THREE.Group();
    hip.add(torso);
    const belly = sphere(.34, skin, 0, .24, 0, 10); belly.scale.set(1.15, .9, .95); torso.add(belly);
    const chest = sphere(.3, u === 'berserker' ? skin : leather, 0, .55, 0, 10); chest.scale.set(1.1, .8, .9); torso.add(chest);
    if (u !== 'berserker') {
      const strap = box(.08, .64, .06, leatherDark, .16, .4, .28); strap.rotation.z = -.45; torso.add(strap);
    } else {
      // war paint
      for (let i = 0; i < 3; i++) {
        const p = box(.06, .36, .02, blood, -.14 + i * .14, .5, .3); p.rotation.z = rand(-.3, .3); torso.add(p);
      }
    }
    // loincloth
    const loin = new THREE.Mesh(new THREE.ConeGeometry(.32, .5, 6), cloth);
    loin.rotation.x = Math.PI; loin.position.y = -.05; torso.add(loin);
    // head
    const head = rig.head = new THREE.Group();
    head.position.y = .88; torso.add(head);
    const skull = sphere(.3, skin, 0, 0, 0, 12); skull.scale.set(1.05, .95, 1); head.add(skull);
    addOutline(skull, .013, 0x14200e);
    // nose
    const nose = cone(.08, .22, 6, skinDark, 0, -.03, .29); nose.rotation.x = Math.PI / 2; head.add(nose);
    // ears
    for (const s of [-1, 1]) {
      const ear = cone(.09, .34, 5, skin, s * .32, .05, -.02);
      ear.rotation.z = s * Math.PI / 2; ear.rotation.x = -.2; head.add(ear);
    }
    // eyes
    for (const s of [-1, 1]) {
      const eye = sphere(.065, eyeMat, s * .12, .04, .25, 8); eye.scale.z = .5; head.add(eye);
      const pupil = sphere(.028, pupilMat, s * .12, .04, .29, 6); pupil.scale.z = .5; head.add(pupil);
      const brow = box(.14, .035, .03, skinDark, s * .12, .12, .27); brow.rotation.z = s * -.3; head.add(brow);
    }
    // mouth + tusks
    head.add(box(.2, .04, .02, new THREE.MeshBasicMaterial({ color: 0x3a2018 }), 0, -.16, .28));
    for (const s of [-1, 1]) {
      const tusk = cone(.03, .12, 4, bone, s * .08, -.14, .29); tusk.rotation.x = Math.PI; head.add(tusk);
    }
    // headpieces
    if (u === 'warrior') {
      const helm = new THREE.Mesh(new THREE.SphereGeometry(.32, 10, 8, 0, TAU, 0, Math.PI / 2), iron);
      helm.position.y = .06; head.add(helm);
      head.add(box(.34, .06, .06, ironDark, 0, .06, .29));
      for (const s of [-1, 1]) { const h = cone(.05, .24, 4, bone, s * .27, .22, 0); h.rotation.z = s * -.5; head.add(h); }
    } else if (u === 'scout') {
      const hood = new THREE.Mesh(new THREE.SphereGeometry(.33, 10, 8, 0, TAU, 0, Math.PI * .6), leather);
      hood.position.y = .02; hood.scale.set(1.05, 1, 1.05); head.add(hood);
    } else if (u === 'archer') {
      const hood = new THREE.Mesh(new THREE.ConeGeometry(.34, .5, 7), leatherDark);
      hood.position.y = .22; head.add(hood);
      hood.scale.z = .8;
    } else if (u === 'shaman') {
      const mask = box(.36, .3, .05, bone, 0, -.01, .3); head.add(mask);
      for (const s of [-1, 1]) { const f = cone(.04, .3, 4, blood, s * .18, .2, .1); f.rotation.z = s * -.6; head.add(f); }
      const hood = new THREE.Mesh(new THREE.SphereGeometry(.35, 10, 8, 0, TAU, 0, Math.PI * .65), robe);
      hood.position.y = .02; head.add(hood);
    } else if (u === 'berserker') {
      const mohawk = box(.08, .3, .34, blood, 0, .28, -.02); head.add(mohawk);
      const spike = cone(.06, .28, 4, bone, 0, .42, -.02); head.add(spike);
      for (const s of [-1, 1]) { const h = cone(.05, .3, 4, bone, s * .3, .14, 0); h.rotation.z = s * -.6; head.add(h); }
    } else if (u === 'chief') {
      // horned helm + crown
      const helm = new THREE.Mesh(new THREE.SphereGeometry(.36, 10, 8, 0, TAU, 0, Math.PI * .6), ironDark);
      helm.position.y = .1; head.add(helm);
      for (const s of [-1, 1]) {
        const horn = cone(.09, .55, 5, bone, s * .3, .35, 0);
        horn.rotation.z = s * -.55; horn.rotation.x = -.15; head.add(horn);
      }
      const crown = cyl(.2, .22, .1, 8, gold, 0, .34, .02); head.add(crown);
      for (let i = 0; i < 5; i++) {
        const sp = cone(.035, .14, 4, gold, -.16 + i * .08, .43, .02); head.add(sp);
      }
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(.05, 0), new THREE.MeshBasicMaterial({ color: 0xff3a2a }));
      gem.position.set(0, .09, .34); head.add(gem); this.bossGem = gem;
      // glowing eyes
      for (const s of [-1, 1]) { const e = sphere(.075, new THREE.MeshBasicMaterial({ color: 0xff3a2a }), s * .12, .04, .265, 8); e.scale.z = .5; head.add(e); }
    }

    // arms
    const makeArm = (side) => {
      const sh = new THREE.Group(); sh.position.set(side * .32, .58, 0); torso.add(sh);
      const upper = cyl(.075, .085, .3, 6, u === 'berserker' ? skin : leather, 0, -.15, 0); sh.add(upper);
      const elbow = new THREE.Group(); elbow.position.y = -.3; sh.add(elbow);
      const fore = cyl(.065, .075, .28, 6, skin, 0, -.14, 0); elbow.add(fore);
      const hand = new THREE.Group(); hand.position.y = -.3; elbow.add(hand);
      hand.add(sphere(.07, skin, 0, 0, 0, 6));
      if (u === 'warrior' || u === 'chief') {
        const pauldron = new THREE.Mesh(new THREE.SphereGeometry(.14, 8, 6, 0, TAU, 0, Math.PI / 2), iron);
        pauldron.position.y = .02; sh.add(pauldron);
        if (u === 'chief') { const spike = cone(.06, .3, 4, gold, side * .06, .16, 0); spike.rotation.z = side * -.4; sh.add(spike); }
      }
      if (u === 'berserker') {
        const spike = new THREE.Mesh(new THREE.ConeGeometry(.09, .26, 4), bone);
        spike.position.y = .04; spike.rotation.z = side * .3; sh.add(spike);
      }
      return { sh, elbow, hand };
    };
    rig.armR = makeArm(-1);
    rig.armL = makeArm(1);
    rig.armR.sh.rotation.z = -.14;
    rig.armL.sh.rotation.z = .14;

    // legs
    const makeLeg = (side) => {
      const hj = new THREE.Group(); hj.position.set(side * .15, -.02, 0); hip.add(hj);
      const thigh = cyl(.1, .11, .32, 6, u === 'berserker' ? skin : leatherDark, 0, -.16, 0); hj.add(thigh);
      const knee = new THREE.Group(); knee.position.y = -.32; hj.add(knee);
      const shin = cyl(.08, .1, .26, 6, skinDark, 0, -.13, 0); knee.add(shin);
      const foot = box(.18, .1, .3, leatherDark, 0, -.28, .06); knee.add(foot);
      return { hj, knee };
    };
    rig.legR = makeLeg(-1); rig.legL = makeLeg(1);

    // weapons
    const weapon = new THREE.Group();
    rig.weapon = weapon;
    rig.armR.hand.add(weapon);
    if (u === 'scout') {
      const dagger = box(.045, .42, .012, steel, 0, .2, 0); weapon.add(dagger);
      weapon.add(box(.13, .04, .04, ironDark, 0, -.02, 0));
      weapon.rotation.x = -1.2;
    } else if (u === 'warrior') {
      const sword = box(.06, .62, .018, steel, 0, .3, 0); weapon.add(sword);
      weapon.add(box(.2, .04, .05, ironDark, 0, -.02, 0));
      const tip = cone(.045, .12, 4, steel, 0, .66, 0); weapon.add(tip);
      weapon.rotation.x = -1.0;
      // shield on left arm
      const shield = new THREE.Group();
      const disc = cyl(.34, .34, .06, 10, leather, 0, 0, 0); disc.rotation.x = Math.PI / 2; shield.add(disc);
      shield.add(cyl(.12, .12, .08, 8, iron, 0, 0, .03));
      for (let i = 0; i < 6; i++) { const s = sphere(.025, iron, Math.cos(i / 6 * TAU) * .28, Math.sin(i / 6 * TAU) * .28, .05, 5); shield.add(s); }
      shield.position.set(0, -.18, .08); rig.armL.hand.add(shield);
      rig.shield = shield;
    } else if (u === 'archer') {
      // bow
      const bow = new THREE.Group();
      const arc = new THREE.Mesh(new THREE.TorusGeometry(.42, .028, 5, 16, Math.PI * 1.1), woodMat());
      arc.rotation.z = Math.PI * .45; bow.add(arc);
      const string = new THREE.Mesh(new THREE.CylinderGeometry(.006, .006, .82, 3), new THREE.MeshBasicMaterial({ color: 0xe8e0c8 }));
      string.position.x = .1; bow.add(string);
      bow.position.set(0, -.1, .1); bow.rotation.x = Math.PI / 2; bow.rotation.z = -.5;
      rig.armL.hand.add(bow);
      rig.bow = bow;
      // quiver on back
      const quiver = cyl(.1, .12, .45, 6, leather, -.2, .5, -.3); quiver.rotation.z = .2; torso.add(quiver);
      for (let i = 0; i < 4; i++) { const a = box(.012, .4, .012, woodMat(), -.25 + i * .04, .75, -.3); torso.add(a); const f = box(.06, .1, .01, blood, -.25 + i * .04, .94, -.3); torso.add(f); }
      weapon.add(box(.03, .5, .012, steel, 0, .25, 0)); weapon.rotation.x = -1.2;
    } else if (u === 'shaman') {
      const staff = new THREE.Group();
      const pole = cyl(.035, .045, 1.5, 6, leatherDark, 0, .1, 0); staff.add(pole);
      const skull = sphere(.12, bone, 0, .9, 0, 8); staff.add(skull);
      for (const s of [-1, 1]) staff.add(cone(.03, .14, 4, bone, s * .09, 1.0, 0));
      const orb = new THREE.Mesh(new THREE.OctahedronGeometry(.1, 0), new THREE.MeshBasicMaterial({ color: 0x9bff9a })); orb.position.y = 1.12; staff.add(orb);
      const gl = glowSprite(0x8aff8a, 1.2, GLOW); gl.position.y = 1.12; gl.material.opacity = .6; staff.add(gl);
      staff.rotation.z = .1; rig.armR.hand.add(staff);
      rig.staff = staff;
      // bone necklace
      for (let i = 0; i < 5; i++) {
        const b = sphere(.035, bone, -.12 + i * .06, .38 - Math.abs(i - 2) * .03, .3, 5); torso.add(b);
      }
    } else if (u === 'berserker') {
      for (const s of [-1, 1]) {
        const axe = new THREE.Group();
        axe.add(cyl(.035, .04, .8, 5, leatherDark, 0, .3, 0));
        const blade = new THREE.Mesh(new THREE.CylinderGeometry(.3, .3, .05, 3), steel);
        blade.rotation.z = Math.PI / 2; blade.position.set(s * .26, .6, 0); axe.add(blade);
        axleRotation(axe, s);
        (s > 0 ? rig.armL.hand : rig.armR.hand).add(axe);
        if (s < 0) rig.weapon = axe;
      }
    } else if (u === 'chief') {
      // massive cleaver
      const cleaver = new THREE.Group();
      cleaver.add(cyl(.06, .07, .9, 6, leatherDark, 0, .35, 0));
      const blade = box(.22, 1.3, .06, steel, .1, 1.15, 0); cleaver.add(blade);
      cleaver.add(box(.16, .2, .07, gold, .05, .45, 0));
      const tip = new THREE.Mesh(new THREE.ConeGeometry(.16, .3, 3), steel); tip.position.set(.12, 1.85, 0); cleaver.add(tip);
      cleaver.rotation.x = -.8; rig.armR.hand.add(cleaver);
      rig.weapon = cleaver;
      // cape
      const cape = new THREE.Mesh(new THREE.PlaneGeometry(.9, 1.3, 4, 6), toon(0x6a1f22, { rim: .2, rimColor: 0xffa080, side: THREE.DoubleSide }));
      cape.position.set(0, .5, -.28); cape.rotation.x = .18; torso.add(cape);
      rig.cape = cape;
      // chest plate
      const plate = box(.56, .45, .08, ironDark, 0, .55, .27); torso.add(plate);
      plate.add(new THREE.Mesh(new THREE.BoxGeometry(.4, .06, .1), gold)).position.y = .12;
      // shoulder spikes
      for (const s of [-1, 1]) {
        const sp = cone(.09, .38, 4, gold, s * .38, .72, 0); sp.rotation.z = s * -.5; torso.add(sp);
      }
    }
    // default idle rotations
    rig.armR.sh.rotation.x = -.12;
    rig.armL.sh.rotation.x = -.12;
    rig.armR.elbow.rotation.x = .3;
    rig.armL.elbow.rotation.x = .3;
    this.height = 1.65;
    if (u === 'chief') this.height = 2.0;
    if (u === 'berserker') this.height = 1.75;
    if (u === 'scout') this.height = 1.45;
  }

  /* ================================================================== */
  /*  UPDATE                                                            */
  /* ================================================================== */
  get player() { return G.player; }
  get alive() { return !this.dead; }
  get center() { return this.group.position.clone().add(new THREE.Vector3(0, this.headHeight * .55, 0)); }

  update(dt) {
    if (this.dead) { this.updateDeath(dt); return; }
    this.updateFlash(dt);
    this.frozen = this.freezeT > 0;
    if (this.freezeT > 0) this.freezeT -= dt;
    if (this.burnT > 0) {
      this.burnT -= dt;
      this.burnAcc = (this.burnAcc || 0) + dt;
      if (this.burnAcc > .5) { this.burnAcc = 0; this.applyDamage(this.burnDmg, { type: 'fire', silent: false }); }
    }
    if (!this.player || this.player.dead) { this.aggro = false; }
    const p = this.player.pos;
    const dist = this.group.position.distanceTo(p);
    const playerAlive = this.player && !this.player.dead;

    if (!this.aggro) {
      if (playerAlive && dist < this.cfg.aggro) this.alertNow();
      else { this.updateWander(dt); this.updateRig(dt); this.updateBar(); return; }
    }
    if (!playerAlive || dist > 32) {
      this.aggro = false;
      if (this.isBoss) { G.ui && G.ui.hideBoss(); }
      this.attack = null;
      this.updateWander(dt); this.updateRig(dt); this.updateBar(); return;
    }
    if (this.frozen) {
      this.attack = null;
      this.updateRig(dt); this.updateBar(); this.updateFacing(dt, false); return;
    }
    this.alertT = Math.max(0, this.alertT - dt);
    this.alert.visible = this.alertT > 0;

    // boss phase checks
    if (this.isBoss) this.checkBossPhases();

    this.updateFacing(dt, true);
    if (this.attack) { this.updateAttack(dt); this.updateRig(dt, true); this.updateBar(); return; }

    this.cd -= dt;
    const toward = new THREE.Vector3().subVectors(p, this.group.position).setY(0);
    const flatDist = toward.length();
    let move = new THREE.Vector3();
    const speed = this.cfg.speed * (this.enraged ? 1.28 : 1);
    const u = this.cfg.uniform;

    if (u === 'archer') {
      if (flatDist < 7) move.copy(toward).normalize().multiplyScalar(-1);
      else if (flatDist > 13) move.copy(toward).normalize();
      else { move.set(-toward.z, 0, toward.x).normalize().multiplyScalar(Math.sin(G.time * .7 + this.home.x) > 0 ? 1 : -1); }
      if (this.cd <= 0 && flatDist < 19) this.startAttack('arrow');
    } else if (u === 'shaman') {
      if (flatDist > 14) move.copy(toward).normalize();
      else if (flatDist < 7) move.copy(toward).normalize().multiplyScalar(-1);
      else move.set(0, 0, 0);
      if (this.cd <= 0 && flatDist < 20) this.startAttack('spell');
      // heal allies occasionally
      if (this.cd <= 0 && Math.random() < .25) this.healAllies();
    } else if (u === 'scout') {
      if (flatDist > this.cfg.melee + .2) move.copy(toward).normalize();
      if (this.cd <= 0 && flatDist < this.cfg.melee + .5) this.startAttack('stab');
      if (this.hp < this.maxHp * .3 && Math.random() < .01) this.startFlee();
    } else if (u === 'berserker') {
      if (flatDist > this.cfg.melee) move.copy(toward).normalize();
      if (this.cd <= 0 && flatDist < this.cfg.melee + 1.5) this.startAttack('slam');
    } else if (u === 'chief') {
      this.bossThink(move, toward, flatDist);
    } else {
      if (flatDist > this.cfg.melee) move.copy(toward).normalize();
      if (this.cd <= 0 && flatDist < this.cfg.melee + .6) this.startAttack('slash');
    }

    // scout panic
    if (this.fleeing > 0) {
      this.fleeing -= dt;
      move.copy(toward).normalize().multiplyScalar(-1);
    }

    // movement
    if (move.lengthSq() > .01) {
      // avoid water for non-boss
      const nextX = this.group.position.x + move.x * speed * dt;
      const nextZ = this.group.position.z + move.z * speed * dt;
      if (!this.isBoss && heightAt(nextX, nextZ) < WATER_LEVEL + .1) move.multiplyScalar(.1);
      this.vel.x = damp(this.vel.x, move.x * speed, 8, dt);
      this.vel.z = damp(this.vel.z, move.z * speed, 8, dt);
    } else {
      this.vel.x = damp(this.vel.x, 0, 10, dt);
      this.vel.z = damp(this.vel.z, 0, 10, dt);
    }
    // knockback decay
    this.group.position.x += this.vel.x * dt;
    this.group.position.z += this.vel.z * dt;
    // separation
    for (const o of G.enemies) {
      if (o === this || o.dead) continue;
      const dx = this.group.position.x - o.group.position.x;
      const dz = this.group.position.z - o.group.position.z;
      const d2 = Math.hypot(dx, dz);
      const min = this.radius + o.radius + .2;
      if (d2 < min && d2 > .001) {
        const push = (min - d2) * .5;
        this.group.position.x += dx / d2 * push;
        this.group.position.z += dz / d2 * push;
      }
    }
    // collisions
    for (const c of (G.colliders || [])) {
      const dx = this.group.position.x - c.x, dz = this.group.position.z - c.z;
      const d = Math.hypot(dx, dz);
      if (d < c.r + this.radius * .7 && d > .001) {
        const push = c.r + this.radius * .7 - d;
        this.group.position.x += dx / d * push;
        this.group.position.z += dz / d * push;
      }
    }
    let gy = G.groundAt ? G.groundAt(this.group.position.x, this.group.position.z) : heightAt(this.group.position.x, this.group.position.z);
    if (heightAt(this.group.position.x, this.group.position.z) < WATER_LEVEL && !this.isBoss) gy = Math.max(gy, WATER_LEVEL - .7);
    this.group.position.y = damp(this.group.position.y, gy, 14, dt);

    this.moveAmount = Math.hypot(this.vel.x, this.vel.z);
    this.walkPhase = (this.walkPhase || 0) + dt * (3 + this.moveAmount * 1.6);
    this.updateRig(dt);
    this.updateBar();
  }

  updateFacing(dt, facePlayer) {
    if (!facePlayer) return;
    const targetYaw = Math.atan2(this.player.pos.x - this.group.position.x, this.player.pos.z - this.group.position.z);
    this.group.rotation.y = dampAngle(this.group.rotation.y, targetYaw, 8, dt);
  }

  updateWander(dt) {
    this.wanderT -= dt;
    if (this.wanderT <= 0) { this.wanderT = rand(2, 5); this.wanderAngle = rand(0, TAU); this.wanderMoving = Math.random() < .55; }
    if (this.wanderMoving) {
      const x = Math.sin(this.wanderAngle) * 2.2 * dt;
      const z = Math.cos(this.wanderAngle) * 2.2 * dt;
      const nx = this.group.position.x + x, nz = this.group.position.z + z;
      if (Math.hypot(nx - this.home.x, nz - this.home.z) < 4 && heightAt(nx, nz) > WATER_LEVEL - .1) {
        this.group.position.x = nx; this.group.position.z = nz;
        this.group.rotation.y = dampAngle(this.group.rotation.y, this.wanderAngle, 4, dt);
      }
    }
    const gy = G.groundAt ? G.groundAt(this.group.position.x, this.group.position.z) : heightAt(this.group.position.x, this.group.position.z);
    this.group.position.y = damp(this.group.position.y, gy, 10, dt);
    this.moveAmount = this.wanderMoving ? 2.2 : 0;
    this.walkPhase = (this.walkPhase || 0) + dt * 3.4;
    this.updateBar();
  }

  alertNow() {
    this.aggro = true;
    this.alertT = 1.3;
    this.alert.visible = true;
    if (G.audio) G.audio.sfx('goblin');
    if (this.isBoss) {
      G.ui && G.ui.showBoss(this.name, 'Senhor do Acampamento', this.hp / this.maxHp);
      if (G.audio) G.audio.sfx('roar');
      G.player && G.player.shake(.4, 6);
      this.phase = 0;
    }
  }

  startFlee() {
    this.fleeing = 2.6;
    this.cd = 2;
  }

  /* ---------------- attacks ---------------- */
  startAttack(kind) {
    const cfg = this.cfg;
    let dur = .8, hitAt = .45;
    if (kind === 'stab') { dur = .48; hitAt = .24; }
    else if (kind === 'slash') { dur = .78; hitAt = .4; }
    else if (kind === 'slam') { dur = 1.15; hitAt = .75; }
    else if (kind === 'arrow') { dur = 1.05; hitAt = .78; }
    else if (kind === 'spell') { dur = 1.2; hitAt = .85; }
    else if (kind === 'bossSlam') { dur = 1.3; hitAt = .85; }
    else if (kind === 'bossCleave') { dur = .9; hitAt = .42; }
    else if (kind === 'bossShock') { dur = 1.4; hitAt = .95; }
    else if (kind === 'bossCharge') { dur = 1.1; hitAt = .55; }
    else if (kind === 'roar') { dur = 1.5; hitAt = .6; }
    this.attack = { kind, t: 0, dur, hitAt, resolved: false };
    this.cd = cfg.attackCd * rand(.85, 1.25);
    if (this.isBoss) this.cd = this.enraged ? 1.35 : 2.0;
    if (G.audio && (kind === 'slam' || kind === 'bossSlam')) G.audio.sfx('goblin');
    // telegraphs
    if (kind === 'slam' || kind === 'bossSlam' || kind === 'bossShock') {
      const radius = kind === 'slam' ? 3.6 : kind === 'bossSlam' ? 6.2 : 8;
      const pos = this.group.position.clone(); pos.y = G.groundAt ? G.groundAt(pos.x, pos.z) : heightAt(pos.x, pos.z);
      this.telegraph = this.effects.telegraph(pos, radius, hitAt, kind === 'bossShock' ? 0xff8a4a : 0xff5a4a);
    }
  }

  updateAttack(dt) {
    const a = this.attack;
    a.t += dt;
    if (a.kind === 'bossCharge' && a.t < a.hitAt) {
      // lunge toward player
      const dir = new THREE.Vector3().subVectors(this.player.pos, this.group.position).setY(0).normalize();
      this.group.position.addScaledVector(dir, 6.2 * dt);
    }
    if (!a.resolved && a.t >= a.hitAt) { a.resolved = true; this.resolveAttack(a.kind); }
    if (a.t >= a.dur) { this.attack = null; }
  }

  resolveAttack(kind) {
    const p = this.player;
    const dist = this.group.position.distanceTo(p.pos);
    const forward = new THREE.Vector3(Math.sin(this.group.rotation.y), 0, Math.cos(this.group.rotation.y));
    const toPlayer = new THREE.Vector3().subVectors(p.pos, this.group.position).setY(0).normalize();
    const inArc = forward.dot(toPlayer) > .2;
    const dmg = this.damage * (this.enraged ? 1.22 : 1);
    if (kind === 'stab' || kind === 'slash') {
      const range = kind === 'stab' ? 2.2 : 2.7;
      if (dist < range && inArc) p.takeDamage(dmg, this.group.position, 'physical');
      this.effects.slash(this.group.position.clone().addScaledVector(forward, 1.0).setY(this.group.position.y + .9), this.group.rotation.y, { color: 0xffb890, radius: 2.0, life: .2 });
      if (G.audio) G.audio.sfx('swing', { pitch: .8 });
    } else if (kind === 'slam') {
      const pos = this.group.position.clone(); pos.y = this.group.position.y + .05;
      this.effects.bossSlam(pos, 3.6);
      if (dist < 3.9) p.takeDamage(dmg, this.group.position, 'physical');
    } else if (kind === 'arrow') {
      const from = this.group.position.clone().add(new THREE.Vector3(0, 1.0 * this.cfg.scale, 0)).addScaledVector(forward, .5);
      const target = p.pos.clone(); target.y += 1.0;
      // slight lead
      target.addScaledVector(p.vel, .12);
      this.effects.arrow(from, target, {
        onHit: () => {
          if (p.pos.distanceTo(target.setY(p.pos.y)) < 1.6) p.takeDamage(dmg, this.group.position, 'physical');
        },
      });
      if (G.audio) G.audio.sfx('arrow');
    } else if (kind === 'spell') {
      const from = this.group.position.clone().add(new THREE.Vector3(0, 1.0 * this.cfg.scale, 0));
      const target = p.pos.clone();
      this.effects.fireball(from, () => p.pos.clone(), {
        color: 0x9be05a, scale: .8,
        onHit: (pos) => {
          this.effects.explosion(pos, 0x9be05a, .7);
          if (p.pos.distanceTo(pos) < 2.6) p.takeDamage(dmg, pos, 'magic');
        },
      });
      this.effects.magicCircle(this.group.position.clone().setY(this.group.position.y + .06), 'dark', 2.8, .8);
    } else if (kind === 'bossSlam') {
      const pos = this.group.position.clone(); pos.y = this.group.position.y + .05;
      this.effects.bossSlam(pos, 6.2);
      if (dist < 6.5) p.takeDamage(dmg, this.group.position, 'physical');
      G.player.shake(.6, 10);
    } else if (kind === 'bossCleave') {
      if (dist < 5 && inArc) p.takeDamage(dmg, this.group.position, 'physical');
      this.effects.slash(this.group.position.clone().addScaledVector(forward, 2).setY(this.group.position.y + 1.6), this.group.rotation.y, { color: 0xff8a5a, radius: 4.2, life: .28 });
      this.effects.dust(this.group.position.clone().setY(this.group.position.y + .1), 0xc9a06a, 20);
    } else if (kind === 'bossShock') {
      const pos = this.group.position.clone(); pos.y = this.group.position.y + .05;
      this.effects.shockwave(pos, 0xff8a4a, 8, .7);
      if (dist < 8.4) p.takeDamage(dmg * .8, this.group.position, 'magic');
      if (G.audio) G.audio.sfx('slam');
    } else if (kind === 'bossCharge') {
      if (dist < 3.2) { p.takeDamage(dmg, this.group.position, 'physical'); p.vel.addScaledVector(toPlayer.clone().multiplyScalar(-1), 6); }
      this.effects.dust(this.group.position.clone().setY(this.group.position.y + .1), 0xc9a06a, 18);
    } else if (kind === 'roar') {
      this.effects.shockwave(this.group.position.clone().setY(this.group.position.y + .1), 0xffa060, 7, .7);
      if (dist < 7) p.takeDamage(dmg * .35, this.group.position, 'magic');
      if (G.audio) G.audio.sfx('roar');
      G.player.shake(.5, 7);
    }
  }

  healAllies() {
    const heal = 26;
    let healed = false;
    for (const e of G.enemies) {
      if (e === this || e.dead) continue;
      if (e.group.position.distanceTo(this.group.position) < 12 && e.hp < e.maxHp) {
        e.hp = Math.min(e.maxHp, e.hp + heal);
        this.effects.particles(e.center, 0x9dffb8, { count: 10, speed: 1.2, size: .12, life: .7, gravity: -1, up: 1.4 });
        healed = true;
      }
    }
    if (healed) {
      this.cd = 6;
      this.effects.magicCircle(this.group.position.clone().setY(this.group.position.y + .05), 'holy', 4, .8);
      if (G.audio) G.audio.sfx('heal');
    }
  }

  bossThink(move, toward, flatDist) {
    if (this.cd > 0) {
      if (flatDist > this.cfg.melee) move.copy(toward).normalize();
      return;
    }
    const roll = Math.random();
    if (flatDist < 5.2) {
      this.startAttack(roll < .65 ? 'bossSlam' : 'bossCleave');
    } else if (flatDist < 10) {
      this.startAttack(roll < .5 ? 'bossShock' : 'bossCharge');
    } else {
      this.startAttack(roll < .55 ? 'bossCharge' : 'bossShock');
    }
  }

  checkBossPhases() {
    const frac = this.hp / this.maxHp;
    let newPhase = frac > .65 ? 0 : frac > .3 ? 1 : 2;
    if (newPhase !== this.phase) {
      this.phase = newPhase;
      if (newPhase === 1) {
        if (!this.summoned.one) {
          this.summoned.one = true;
          this.summonGoblins(2);
          G.ui && G.ui.toast('Grimmjaw ruge e chama reforços!', 'warn');
          G.ui && G.ui.showBoss(this.name, 'Fúria Crescente', frac);
        }
        if (G.audio) G.audio.sfx('roar');
      } else if (newPhase === 2) {
        this.enraged = true;
        this.aura.material.color.set(0xff3a2a);
        this.aura.material.opacity = .38;
        this.aura.scale.setScalar(10);
        if (!this.summoned.two) { this.summoned.two = true; this.summonGoblins(3); }
        G.ui && G.ui.toast('Fúria Ancestral! Grimmjaw está enfurecido.', 'warn');
        G.ui && G.ui.showBoss(this.name, 'Fúria Ancestral', Math.max(0, frac));
        if (G.audio) G.audio.sfx('roar');
        G.player && G.player.shake(.6, 8);
      }
    }
    if (this.isBoss && this.bossBarShown === false) {
      this.bossBarShown = true;
      G.ui && G.ui.showBoss(this.name, 'Senhor do Acampamento', frac);
    }
    if (this.isBoss) G.ui && G.ui.updateBoss(frac, this.phase === 2 ? 'Fúria Ancestral' : this.phase === 1 ? 'Fúria Crescente' : 'Senhor do Acampamento');
  }

  summonGoblins(n) {
    for (let i = 0; i < n; i++) {
      const a = i / n * TAU + rand(0, 1);
      const pos = this.group.position.clone().add(new THREE.Vector3(Math.cos(a) * 5, 0, Math.sin(a) * 5));
      const e = new Enemy(this.scene, this.effects, Math.random() < .5 ? 'scout' : 'warrior', pos);
      e.aggro = true;
      G.enemies.push(e);
      this.effects.teleport(pos.clone().setY((G.groundAt ? G.groundAt(pos.x, pos.z) : heightAt(pos.x, pos.z)) + .2), 0x9bff9a);
    }
  }

  /* ---------------- damage & death ---------------- */
  takeDamage(amount, opts = {}) {
    if (this.dead) return;
    let dmg = amount;
    if (this.frozen) dmg = Math.round(dmg * 1.3);
    this.applyDamage(dmg, opts);
    if (opts.freeze && !this.isBoss) {
      this.freezeT = opts.freeze;
      this.effects.freezeShell(this, opts.freeze);
      if (G.audio) G.audio.sfx('freeze');
    } else if (opts.freeze && this.isBoss) {
      this.freezeT = Math.min(1.2, opts.freeze * .35);
      this.effects.particles(this.center, 0x9ff0ff, { count: 12, speed: 1.5, size: .15, life: .6, gravity: 1 });
    }
    if (opts.burn) { this.burnT = opts.burn; this.burnDmg = Math.round(dmg * .18); }
    if (opts.knockback) {
      const dir = opts.from ? new THREE.Vector3().subVectors(this.group.position, opts.from).setY(0).normalize() : new THREE.Vector3(rand(-1, 1), 0, rand(-1, 1)).normalize();
      this.vel.addScaledVector(dir, opts.knockback);
    }
    this.flash = .12;
    this.aggro = true;
    if (this.isBoss && !this.bossBarShown) { this.bossBarShown = true; G.ui && G.ui.showBoss(this.name, 'Senhor do Acampamento', this.hp / this.maxHp); }
    if (opts.effect) opts.effect(this.center);
    this.hp = Math.max(0, this.hp);
    if (this.hp <= 0) this.die();
    else if (Math.random() < .25 && !this.isBoss) { if (G.audio) G.audio.sfx('goblin'); }
  }

  applyDamage(dmg, opts = {}) {
    if (this.dead) return;
    this.hp -= dmg;
    this.flash = .12;
    if (G.ui && !opts.silent) G.ui.damage(dmg, this.center.clone().add(new THREE.Vector3(rand(-.2, .2), .2, 0)), opts.type || 'physical', opts.crit);
    if (this.hp <= 0) this.die();
    else if (this.attack && Math.random() < .3) { /* flinch but keep attack */ }
  }

  die() {
    if (this.dead) return;
    this.dead = true;
    this.deathT = 0;
    this.aggro = false;
    this.attack = null;
    if (this.bar) this.bar.style.display = 'none';
    if (this.isBoss) {
      G.ui && G.ui.hideBoss();
      if (G.audio) G.audio.sfx('bossDie');
      this.effects.shockwave(this.group.position.clone().setY(this.group.position.y + .1), 0xffb060, 10, 1.2);
      this.effects.particles(this.center, 0xffc46a, { count: 80, speed: 8, size: .22, life: 1.8, gravity: 2, up: 1.2, spread: 2, color2: 0xff6a3a });
      G.player && G.player.shake(.8, 10);
    } else {
      if (G.audio) G.audio.sfx('goblinDie');
      this.effects.particles(this.center, 0x9fd86a, { count: 18, speed: 2.6, size: .15, life: .9, gravity: 5, additive: false });
    }
    // rewards
    const p = G.player;
    if (p) {
      p.addXP(this.cfg.xp);
      p.addGold(this.cfg.gold);
      if (!this.isBoss && Math.random() < .16) { p.potions++; G.ui && G.ui.toast('Poção encontrada!'); }
    }
    if (G.stats) {
      G.stats.kills++;
      if (isGoblin(this.type)) G.stats.goblinsKilled++;
    }
    if (G.onEnemyKilled) G.onEnemyKilled(this);
    if (this.isBoss) {
      if (G.onBossDefeated) G.onBossDefeated(this);
    }
    this.respawnAt = G.time + (this.isBoss ? 99999 : 75);
    if (this.telegraph) { this.scene.remove(this.telegraph); this.telegraph = null; }
  }

  updateDeath(dt) {
    this.deathT += dt;
    this.deadAnim = Math.min(1, this.deathT / 1.1);
    this.model.rotation.z = this.deadAnim * (this.isBoss ? 1.4 : 1.6);
    this.model.position.y = this.deadAnim * (this.isBoss ? 1.8 : .5);
    this.shadow.material.opacity = .3 * (1 - this.deadAnim * .8);
    if (this.deathT > 1.6 && this.group.visible) this.group.visible = false;
    if (!this.isBoss && G.time > this.respawnAt) this.respawn();
  }

  respawn() {
    this.dead = false;
    this.deathT = 0;
    this.hp = this.maxHp;
    this.frozen = false; this.freezeT = 0; this.burnT = 0;
    this.aggro = false;
    this.attack = null;
    this.group.visible = true;
    this.group.position.copy(this.home);
    this.model.rotation.set(0, 0, 0);
    this.model.position.y = 0;
    this.shadow.material.opacity = .3;
    this.vel.set(0, 0, 0);
    this.respawnAt = 0;
  }

  updateFlash(dt) {
    this.flash = Math.max(0, this.flash - dt);
    const on = this.flash > 0;
    for (const f of this.flashMats) {
      f.m.emissive.setHex(on ? 0xffffff : f.e.getHex());
      f.m.emissiveIntensity = on ? 1.2 : f.i;
    }
  }

  /* ---------------- animation ---------------- */
  updateRig(dt, attacking = false) {
    const rig = this.rig;
    const t = G.time;
    const u = this.cfg.uniform;
    const moving = (this.moveAmount || 0) > .4;
    const phase = this.walkPhase || 0;
    const sw = Math.sin(phase);
    let hipY = .56;
    let torsoX = .12 + Math.sin(t * 1.6) * .02;
    let torsoY = 0;
    let headY = Math.sin(t * .9) * .06;
    let armRx = -.12 + (moving ? -sw * .5 : Math.sin(t * 1.5) * .03);
    let armRz = -.14, armLx = -.12 + (moving ? sw * .35 : 0), armLz = .14;
    let elbowR = .3, elbowL = .3;
    let legL = moving ? sw * .55 : 0, legR = moving ? -sw * .55 : 0;
    let kneeL = moving ? Math.max(0, -sw) * .6 : 0, kneeR = moving ? Math.max(0, sw) * .6 : 0;
    let crouch = 0;

    if (this.frozen) {
      torsoX = .05; armRx = -.06; armLx = -.06; headY = 0;
    }
    if (this.attack) {
      const p = clamp(this.attack.t / this.attack.dur, 0, 1);
      const wind = smoothstep(0, .5, p);
      const hit = smoothstep(.45, .65, p);
      const k = this.attack.kind;
      if (k === 'stab') {
        armRx = lerp(-.2, -1.5, hit); elbowR = lerp(.6, .05, hit); torsoX = .1;
      } else if (k === 'slash') {
        armRx = lerp(-.5, -2.4, wind) + hit * 2.2; armRz = -.2;
        torsoX = lerp(.12, -.1, wind) + hit * .45;
        torsoY = lerp(0, -.4, wind) + hit * .6;
      } else if (k === 'slam') {
        armRx = lerp(-.3, -2.9, wind); elbowR = .05;
        if (p > .6) armRx += (p - .6) * 6;
        torsoX = lerp(.1, -.3, wind) + hit * .5;
        crouch = hit * .15;
      } else if (k === 'arrow') {
        armLx = lerp(-.2, -1.5, wind); armLz = .35; elbowL = .05;
        armRx = lerp(-.2, -.8, wind);
        torsoY = .25;
      } else if (k === 'spell') {
        armLx = lerp(-.2, -1.9, wind); armLz = .1; elbowL = .1;
        armRx = lerp(-.2, -1.2, wind);
        torsoX = .1; headY = 0;
        if (this.rig.staff) this.rig.staff.rotation.x = -.5;
      } else if (k === 'bossSlam') {
        armRx = lerp(-.3, -3.0, wind); elbowR = .05;
        if (p > .6) armRx += (p - .6) * 5;
        crouch = hit * .35;
        torsoX = lerp(.1, -.35, wind) + hit * .6;
        armLx = lerp(-.2, -2.4, wind);
      } else if (k === 'bossCleave') {
        armRx = lerp(-.4, -2.2, wind) + hit * 2.5;
        armRz = lerp(-.1, .7, hit);
        torsoY = lerp(0, -.8, wind) + hit * 1.2;
      } else if (k === 'bossShock') {
        armLx = lerp(-.2, -2.6, wind); armRx = lerp(-.2, -2.0, wind);
        torsoX = -.2 * wind; crouch = .1;
      } else if (k === 'bossCharge') {
        torsoX = .45; armRx = -1.1; armLx = -1.0; crouch = .12;
      } else if (k === 'roar') {
        torsoX = -.3; armRx = -2.4; armLx = -2.4; armRz = -.9; armLz = .9; headY = 0;
        hipY += .1;
      }
    }
    const amp = attacking ? 34 : 14;
    rig.hip.position.y = damp(rig.hip.position.y, hipY - crouch, 12, dt);
    rig.torso.rotation.x = damp(rig.torso.rotation.x, torsoX, amp, dt);
    rig.torso.rotation.y = damp(rig.torso.rotation.y, torsoY, amp, dt);
    rig.head.rotation.y = damp(rig.head.rotation.y, headY, 10, dt);
    rig.head.rotation.x = damp(rig.head.rotation.x, this.attack ? -.1 : 0, 10, dt);
    rig.armR.sh.rotation.x = damp(rig.armR.sh.rotation.x, armRx, amp, dt);
    rig.armR.sh.rotation.z = damp(rig.armR.sh.rotation.z, armRz, amp, dt);
    rig.armR.elbow.rotation.x = damp(rig.armR.elbow.rotation.x, elbowR, amp, dt);
    rig.armL.sh.rotation.x = damp(rig.armL.sh.rotation.x, armLx, amp, dt);
    rig.armL.sh.rotation.z = damp(rig.armL.sh.rotation.z, armLz, amp, dt);
    rig.armL.elbow.rotation.x = damp(rig.armL.elbow.rotation.x, elbowL, amp, dt);
    rig.legL.hj.rotation.x = damp(rig.legL.hj.rotation.x, legL, 12, dt);
    rig.legR.hj.rotation.x = damp(rig.legR.hj.rotation.x, legR, 12, dt);
    rig.legL.knee.rotation.x = damp(rig.legL.knee.rotation.x, kneeL, 12, dt);
    rig.legR.knee.rotation.x = damp(rig.legR.knee.rotation.x, kneeR, 12, dt);
    if (this.isBoss) {
      // slow menacing breathing
      rig.torso.rotation.z = Math.sin(t * 1.2) * .02;
      if (this.bossGem) this.bossGem.rotation.y += dt * 1.5;
      if (this.aura) this.aura.material.opacity = .18 + Math.sin(t * 2.4) * .06 + (this.enraged ? .12 : 0);
      if (this.rig.cape) this.rig.cape.rotation.x = .18 + Math.sin(t * 1.8) * .05;
    }
    if (this.rig.staff && !this.attack) this.rig.staff.rotation.x = damp(this.rig.staff.rotation.x, .1, 6, dt);
    this.shadow.material.opacity = .3;
    this.shadow.position.y = .04 - (this.group.position.y - (G.groundAt ? G.groundAt(this.group.position.x, this.group.position.z) : heightAt(this.group.position.x, this.group.position.z)));
  }

  updateBar() {
    if (!this.bar) return;
    if (this.isBoss) { this.bar.style.display = 'none'; return; }
    const dist = this.group.position.distanceTo(G.camera.position);
    const show = this.aggro && !this.dead && dist < 45;
    if (!show) { this.bar.style.display = 'none'; return; }
    const pos = this.group.position.clone(); pos.y += this.headHeight + .45;
    const s = projectToScreen(pos, G.camera, innerWidth, innerHeight);
    if (!s.visible || s.x < -80 || s.x > innerWidth + 80 || s.y < -40 || s.y > innerHeight + 80) { this.bar.style.display = 'none'; return; }
    this.bar.style.display = 'block';
    this.bar.style.left = s.x + 'px';
    this.bar.style.top = s.y + 'px';
    this.barFill.style.transform = `scaleX(${clamp(this.hp / this.maxHp, 0, 1)})`;
  }

  dispose() {
    if (this.bar) this.bar.remove();
    this.scene.remove(this.group);
  }
}

function woodMat() {
  return toon(0x8a5c36, { rim: .12, rimColor: 0xffd9a8 });
}
function axleRotation(g, s) {
  g.rotation.z = s > 0 ? .3 : -.3;
}
function dampAngle(a, b, lambda, dt) {
  let d = angleDiff(a, b);
  return a + d * (1 - Math.exp(-lambda * dt));
}
