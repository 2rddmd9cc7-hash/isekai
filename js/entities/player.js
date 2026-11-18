import * as THREE from 'three';
import { G, angleDiff, angleTo } from '../core/state.js';
import {
  toon, addOutline, clamp, damp, lerp, rand, smoothstep, TAU, makeGlowTexture, glowSprite,
  makePortrait, makeClothTexture, box, sphere, cyl, plane
} from '../core/utils.js';
import { heightAt, surfaceAt, WATER_LEVEL } from '../world/terrain.js';
import { ELEMENTS, ELEMENT_ORDER, SPELLS, spellOf } from '../combat/spells.js';

const GLOW = makeGlowTexture('#ffffff');
const isWaterAt = (x, z) => heightAt(x, z) < WATER_LEVEL + .15;
function dampAngle(a, b, lambda, dt) {
  let d = angleDiff(a, b);
  return a + d * (1 - Math.exp(-lambda * dt));
}

/* ---------------- anime face texture ---------------- */
function makeFaceTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const x = c.getContext('2d');
  x.clearRect(0, 0, 256, 256);
  // soft brows, thin and slightly arched
  x.strokeStyle = '#584466'; x.lineWidth = 3.2; x.lineCap = 'round';
  x.beginPath(); x.moveTo(58, 86); x.quadraticCurveTo(80, 76, 104, 86); x.stroke();
  x.beginPath(); x.moveTo(152, 86); x.quadraticCurveTo(176, 76, 198, 86); x.stroke();
  // eyes (big, anime): pale sclera, wide iris, strong top lid
  const eye = (cx, mirror) => {
    x.save(); x.translate(cx, 130); x.scale(mirror, 1);
    // eye white
    x.fillStyle = '#fbf7ee';
    x.beginPath(); x.ellipse(0, 0, 27, 31, 0, 0, 7); x.fill();
    // iris
    const ig = x.createLinearGradient(0, -28, 0, 30);
    ig.addColorStop(0, '#173b52'); ig.addColorStop(.45, '#2f9fb4'); ig.addColorStop(1, '#7ff0e4');
    x.fillStyle = ig;
    x.beginPath(); x.ellipse(0, 2, 21, 26, 0, 0, 7); x.fill();
    // pupil
    x.fillStyle = '#141a2c';
    x.beginPath(); x.ellipse(0, 5, 9, 13, 0, 0, 7); x.fill();
    // highlights
    x.fillStyle = '#ffffff';
    x.beginPath(); x.ellipse(-8, -9, 8, 9, -.15, 0, 7); x.fill();
    x.beginPath(); x.ellipse(7, 11, 3.6, 4.4, 0, 0, 7); x.fill();
    // upper lid (thick) and lower lash (thin)
    x.strokeStyle = '#241d30'; x.lineWidth = 5.5;
    x.beginPath(); x.ellipse(0, -1, 28, 32, 0, Math.PI * 1.02, Math.PI * 1.98); x.stroke();
    x.lineWidth = 2.2;
    x.beginPath(); x.ellipse(0, -1, 27, 31, 0, Math.PI * .08, Math.PI * .92); x.stroke();
    // lash flick
    x.lineWidth = 4;
    x.beginPath(); x.moveTo(-26, -12); x.lineTo(-33, -22); x.stroke();
    x.restore();
  };
  eye(83, 1); eye(173, -1);
  // nose
  x.strokeStyle = 'rgba(150,92,80,.45)'; x.lineWidth = 2.4; x.lineCap = 'round';
  x.beginPath(); x.moveTo(128, 168); x.lineTo(124, 176); x.stroke();
  // small smile
  x.strokeStyle = '#a85a5a'; x.lineWidth = 3.4;
  x.beginPath(); x.moveTo(116, 198); x.quadraticCurveTo(128, 207, 141, 197); x.stroke();
  // blush
  x.fillStyle = 'rgba(232,110,120,.20)';
  x.beginPath(); x.ellipse(58, 174, 18, 8, 0, 0, 7); x.fill();
  x.beginPath(); x.ellipse(198, 174, 18, 8, 0, 0, 7); x.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

const FACE_TEX = makeFaceTexture();

export class Player {
  constructor(scene, effects, spawn = { x: 0, z: 46 }) {
    this.scene = scene;
    this.effects = effects;
    this.spawn = spawn.clone ? spawn.clone() : new THREE.Vector3(spawn.x, 0, spawn.z);
    this.spawn.y = G.groundAt ? G.groundAt(this.spawn.x, this.spawn.z) : heightAt(this.spawn.x, this.spawn.z);

    this.group = new THREE.Group();
    this.group.position.copy(this.spawn);
    this.group.rotation.y = Math.PI;
    scene.add(this.group);
    this.model = new THREE.Group();
    this.group.add(this.model);

    // ---- stats ----
    this.level = 1;
    this.xp = 0;
    this.xpNext = 90;
    this.maxHp = 120; this.hp = 120;
    this.maxMp = 90; this.mp = 90;
    this.maxStamina = 100; this.stamina = 100;
    this.swordLevel = 0;
    this.magicLevel = 0;
    this.critChance = .16;
    this.dead = false;
    this.respawnTimer = 0;
    this.invuln = 0;
    this.lastHurt = 99;
    this.potions = 3;
    this.gold = 120;

    // ---- movement ----
    this.vel = new THREE.Vector3();
    this.vy = 0;
    this.grounded = true;
    this.facing = Math.PI;
    this.moveSpeed = 0;
    this.walkPhase = 0;
    this.stepTimer = 0;
    this.dodgeTime = 0; this.dodgeCd = 0; this.dodgeDir = new THREE.Vector3();
    this.jumpBuffer = 0;

    // ---- combat ----
    this.action = null;   // {name,t,dur,hitDone}
    this.combo = 0;
    this.comboWindow = 0;
    this.queued = false;
    this.charging = false;
    this.chargeT = 0;
    this.fireCharging = false;
    this.fireChargeT = 0;
    // ---- elemental codex: 4 attunements x 5 distinct spells ----
    this.element = 'fire';
    this.spellIndex = 0;
    this.spellChoice = { fire: 0, bolt: 0, ice: 0, wind: 0 };
    this.unlocked = { fire: true, ice: true, bolt: true, wind: true };
    this.spellCds = {};
    this.castCounts = { fire: 0, bolt: 0, ice: 0, wind: 0 };
    this.cooldowns = { fire: 0, bolt: 0, ice: 0, wind: 0 };
    this.castAnim = 0;
    this.castElement = null;
    this.castSpell = null;
    this.castTarget = null;
    this.castAimPos = new THREE.Vector3();
    this.castPower = 1;
    this.pendingStrikes = [];
    this.pendingVortex = null;
    this.hitStop = 0;
    this.lockedTarget = null;
    this.lastAttackPress = 0;
    this.attackHeld = false;
    this.attackHeldTime = 0;
    this.target = null;
    this.shakeT = 0; this.shakeAmp = 0;
    this.guardBreak = 0;

    // ---- camera ----
    this.camAngle = 0;
    this.camPitch = 0.32;
    this.camDist = 5.6;
    this.camPos = new THREE.Vector3();
    this.camLook = new THREE.Vector3();
    this.firstPerson = false;
    this.viewYaw = Math.PI;
    this.viewPitch = 0;
    this.fpBob = 0;
    this.lastDrag = -10;

    this.buildModel();
    this.buildFirstPerson();
    this.updateCamera(0.016, true);
  }

  /* ================================================================== */
  /*  MODEL                                                             */
  /* ================================================================== */
  buildModel() {
    const skin = toon(0xf6c9a2, { rim: .3, rimColor: 0xfff0d8 });
    const skinShade = toon(0xe2a982, { rim: .25, rimColor: 0xffddc0 });
    const hair = toon(0x4a4288, { rim: .38, rimColor: 0xb8aeff });
    const hairLight = toon(0x6f66b8, { rim: .42, rimColor: 0xd8d0ff });
    const coat = toon(0x2f6579, { rim: .3, rimColor: 0xa8eaff });
    const coatDark = toon(0x1e3c50, { rim: .26, rimColor: 0x8fd4f4 });
    const leather = toon(0x6a4630, { rim: .18, rimColor: 0xffd8a8 });
    const leatherDark = toon(0x49301f, { rim: .16, rimColor: 0xffc890 });
    const cloth = toon(0xe8dcc0, { rim: .2, rimColor: 0xfff4d8 });
    const capeMat = toon(0xffffff, { map: makeClothTexture(), rim: .25, rimColor: 0xffb0a0, side: THREE.DoubleSide });
    const gold = toon(0xe0b25a, { rim: .5, rimColor: 0xfff4c0, emissive: 0x3a2600, emissiveIntensity: .5 });
    const steel = toon(0xc8d6e4, { rim: .6, rimColor: 0xffffff, emissive: 0x1a2430, emissiveIntensity: .35 });
    const dark = toon(0x20213a, { rim: .2, rimColor: 0x7f8fe0 });

    const rig = this.rig = {};
    const hip = rig.hip = new THREE.Group();
    hip.position.y = .92;
    this.model.add(hip);

    // pelvis / tabard
    const pelvis = cyl(.19, .22, .26, 8, coatDark, 0, .04, 0); hip.add(pelvis);
    addOutline(pelvis, .012, 0x141220);
    // tabard front and back
    for (const [z, rz] of [[.14, .04], [-.14, -.04]]) {
      const front = z > 0;
      const p = new THREE.Mesh(new THREE.PlaneGeometry(front ? .27 : .26, front ? .37 : .38), front ? coat : coatDark);
      p.position.set(0, front ? -.145 : -.16, z); p.rotation.x = rz; p.material.side = THREE.DoubleSide;
      hip.add(p);
      const trim = new THREE.Mesh(new THREE.PlaneGeometry(front ? .27 : .26, .05), gold);
      trim.position.set(0, front ? -.32 : -.35, z + (front ? .001 : -.001)); trim.rotation.x = rz; hip.add(trim);
      if (front) {
        const stripe = new THREE.Mesh(new THREE.PlaneGeometry(.045, .3), cloth);
        stripe.position.set(0, -.14, z + .004); hip.add(stripe);
      }
      if (front) {
        const emblem = new THREE.Mesh(new THREE.CircleGeometry(.055, 4), toon(0x2f6f78, { emissive: 0x123a40, emissiveIntensity: .5 }));
        emblem.position.set(0, -.13, z + .006); emblem.rotation.z = Math.PI / 4; hip.add(emblem);
        const rim = new THREE.Mesh(new THREE.RingGeometry(.058, .075, 4), gold);
        rim.position.set(0, -.13, z + .004); rim.rotation.z = Math.PI / 4; hip.add(rim);
      }
    }
    // belt
    hip.add(cyl(.225, .225, .09, 10, leatherDark, 0, .16, 0));
    hip.add(box(.12, .1, .05, gold, 0, .16, .2));

    const torso = rig.torso = new THREE.Group();
    torso.position.y = .2;
    hip.add(torso);

    // chest
    const chest = box(.48, .46, .29, coat, 0, .26, 0); torso.add(chest);
    addOutline(chest, .014, 0x101828);
    // inner shirt V
    const shirt = new THREE.Mesh(new THREE.PlaneGeometry(.17, .27), coatDark);
    shirt.position.set(0, .27, .147); torso.add(shirt);
    for (const sd of [-1, 1]) {
      const collar = new THREE.Mesh(new THREE.PlaneGeometry(.04, .16), cloth);
      collar.position.set(sd * .082, .4, .151); collar.rotation.z = sd * .22; torso.add(collar);
    }
    // vest panels
    for (const s of [-1, 1]) {
      const p = box(.12, .34, .05, leather, s * .17, .28, .13); torso.add(p);
      const strap = box(.05, .46, .04, leatherDark, s * .19, .3, .14); strap.rotation.z = s * .12; torso.add(strap);
    }
    // scarf
    const scarf = new THREE.Mesh(new THREE.TorusGeometry(.15, .042, 6, 12), toon(0x3f7f8f, { rim: .24, rimColor: 0xb8f0ff }));
    scarf.rotation.x = Math.PI / 2; scarf.position.y = .51; torso.add(scarf);
    const scarfTail = new THREE.Mesh(new THREE.PlaneGeometry(.1, .3), cloth);
    scarfTail.position.set(.1, .38, -.14); scarfTail.rotation.x = -.35; torso.add(scarfTail);
    // pendant
    const pendant = new THREE.Mesh(new THREE.OctahedronGeometry(.05, 0), new THREE.MeshBasicMaterial({ color: 0x8ff8ff }));
    pendant.position.set(0, .37, .16); torso.add(pendant);
    rig.pendant = pendant;

    // shoulders / pauldrons — layered leather caps with gold edging
    for (const s of [-1, 1]) {
      const pauldron = new THREE.Mesh(new THREE.SphereGeometry(.125, 10, 7, 0, TAU, 0, Math.PI / 2), leatherDark);
      pauldron.scale.set(1.02, .82, 1.0); pauldron.position.set(s * .265, .46, 0);
      torso.add(pauldron);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(.082, 9, 6, 0, TAU, 0, Math.PI / 2), leather);
      cap.scale.set(1.0, .72, .98); cap.position.set(s * .27, .495, 0); torso.add(cap);
      const stud = new THREE.Mesh(new THREE.SphereGeometry(.02, 6, 5), gold);
      stud.position.set(s * .275, .515, .06); torso.add(stud);
    }

    // head
    const neck = cyl(.075, .09, .12, 6, skinShade, 0, .56, 0); torso.add(neck);
    const head = rig.head = new THREE.Group();
    head.position.y = .66;
    head.scale.setScalar(.95);
    torso.add(head);
    const skull = sphere(.235, skin, 0, 0, 0, 16); skull.scale.set(1, 1.08, .98); head.add(skull);
    addOutline(skull, .012, 0x1a1420);
    // ears
    for (const s of [-1, 1]) { const e = sphere(.045, skin, s * .23, -.01, 0, 6); e.scale.set(.6, 1, .8); head.add(e); }
    // face
    const face = new THREE.Mesh(new THREE.PlaneGeometry(.32, .32), new THREE.MeshBasicMaterial({ map: FACE_TEX, transparent: true, depthWrite: false }));
    face.position.set(0, -.028, .2375); head.add(face);
    // smooth hair cap — sits close to the skull so the silhouette stays clean
    const hairBack = new THREE.Mesh(new THREE.SphereGeometry(.248, 16, 12, 0, TAU, 0, Math.PI * .64), hair);
    hairBack.position.set(0, .012, -.055); hairBack.scale.set(1.01, 1.08, .94); head.add(hairBack);
    addOutline(hairBack, .011, 0x0e0c1a);
    // layered nape locks — give the back of the head a spiky, painted silhouette
    const backLocks = [
      [0, .015, -.24, .075, .34, 0, 0],
      [-.1, .0, -.225, .065, .29, .2, .12],
      [.1, .0, -.225, .065, .29, -.2, -.12],
      [-.175, .015, -.16, .055, .23, .45, .2],
      [.175, .015, -.16, .055, .23, -.45, -.2],
      [-.06, -.02, -.26, .05, .2, .1, .06],
      [.06, -.02, -.26, .05, .2, -.1, -.06],
    ];
    for (let i = 0; i < backLocks.length; i++) {
      const [bx, by, bz, bw, bh, rz, ry] = backLocks[i];
      const lock = new THREE.Mesh(new THREE.ConeGeometry(bw, bh, 5), i % 2 ? hairLight : hair);
      lock.position.set(bx, by, bz);
      lock.rotation.set(Math.PI - .22, ry, rz);
      lock.scale.z = .62;
      head.add(lock);
    }
    // fringe: a continuous swept band with shallow scallops, plus a few pointed locks in front
    const fringeShape = new THREE.Shape();
    fringeShape.moveTo(-.232, .205);
    fringeShape.lineTo(.228, .205);
    fringeShape.lineTo(.226, .045);
    fringeShape.lineTo(.196, .015);
    fringeShape.lineTo(.168, -.012);
    fringeShape.lineTo(.132, .038);
    fringeShape.lineTo(.086, -.004);
    fringeShape.lineTo(.042, .042);
    fringeShape.lineTo(-.004, -.006);
    fringeShape.lineTo(-.05, .046);
    fringeShape.lineTo(-.104, .004);
    fringeShape.lineTo(-.148, .05);
    fringeShape.lineTo(-.192, .012);
    fringeShape.lineTo(-.226, .04);
    fringeShape.closePath();
    const fringeGeo = new THREE.ShapeGeometry(fringeShape, 4);
    {
      const fp = fringeGeo.attributes.position;
      const R = .254;
      for (let i = 0; i < fp.count; i++) {
        const fx = fp.getX(i), fy = fp.getY(i);
        // wrap the sheet around the skull instead of leaving it flat
        const zz = Math.sqrt(Math.max(.0025, R * R - fx * fx - fy * fy));
        fp.setZ(i, zz + .006);
      }
      fp.needsUpdate = true;
      fringeGeo.computeVertexNormals();
    }
    const fringeMat = hair.clone();
    fringeMat.side = THREE.DoubleSide;
    const fringe = new THREE.Mesh(fringeGeo, fringeMat);
    head.add(fringe);
    // accent locks layered over the fringe — asymmetric, so it reads as hair rather than a crown
    const accentLocks = [
      [-.105, .215, .225, .055, .21, .18],
      [.005, .225, .232, .062, .24, -.06],
      [.115, .212, .225, .05, .19, -.24],
    ];
    for (const [ax, ay, az, aw, al, rz] of accentLocks) {
      const lock = new THREE.Mesh(new THREE.ConeGeometry(aw, al, 5), hair);
      lock.position.set(ax, ay - al * .5, az);
      lock.rotation.set(Math.PI, 0, rz);
      lock.scale.set(1, 1, .6);
      head.add(lock);
      const sheen = new THREE.Mesh(new THREE.ConeGeometry(aw * .4, al * .48, 4), hairLight);
      sheen.position.set(ax + .012, ay - al * .34, az + .028);
      sheen.rotation.set(Math.PI, 0, rz); sheen.scale.z = .4;
      head.add(sheen);
    }
    // long side locks framing the face
    for (const s of [-1, 1]) {
      const lock = new THREE.Mesh(new THREE.ConeGeometry(.055, .42, 5), hair);
      lock.position.set(s * .208, -.13, .05); lock.rotation.set(.04, 0, s * .11); head.add(lock);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(.034, .2, 5), hairLight);
      tip.position.set(s * .213, -.32, .06); tip.rotation.set(.05, 0, s * .07); head.add(tip);
    }
    // short nape wisps
    for (const [nx, ny, nz, nr] of [[-.11, -.13, -.18, .045], [0, -.16, -.2, .05], [.11, -.13, -.18, .045]]) {
      const wisp = new THREE.Mesh(new THREE.ConeGeometry(nr, .2, 5), hair);
      wisp.position.set(nx, ny, nz); wisp.rotation.x = 2.95; head.add(wisp);
    }

    // high ponytail — the silhouette that reads at gameplay distance
    const tail = new THREE.Group();
    tail.position.set(0, .14, -.2);
    tail.rotation.x = .26;
    head.add(tail);
    const tie = new THREE.Mesh(new THREE.TorusGeometry(.052, .016, 5, 10), gold);
    tie.rotation.x = Math.PI / 2; tail.add(tie);
    const tailSegs = [
      [0, -.1, -.03, .095, .22],
      [0, -.27, -.075, .078, .22],
      [0, -.43, -.115, .058, .2],
    ];
    for (const [tx, ty, tz, rr, hh] of tailSegs) {
      const seg = new THREE.Mesh(new THREE.SphereGeometry(rr, 9, 7), hair);
      seg.position.set(tx, ty, tz); seg.scale.set(.82, hh / (rr * 2), .82); tail.add(seg);
    }
    // secondary strand, a touch lighter, wrapping the main tail
    const strand = new THREE.Mesh(new THREE.ConeGeometry(.048, .52, 5), hairLight);
    strand.position.set(.075, -.34, -.09); strand.rotation.set(3.02, 0, .1); tail.add(strand);
    const tailTip = new THREE.Mesh(new THREE.ConeGeometry(.042, .2, 5), hairLight);
    tailTip.position.set(0, -.57, -.14); tailTip.rotation.x = 3.05; tail.add(tailTip);
    rig.hairTail = tail;
    // gem at the hairline
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(.023, 0), new THREE.MeshBasicMaterial({ color: 0xaef6ff }));
    gem.position.set(0, .118, .218); head.add(gem);
    this.addHeadGlow(gem);

    // arms
    const makeArm = (side) => {
      const shoulder = new THREE.Group();
      shoulder.position.set(side * .30, .445, 0);
      torso.add(shoulder);
      const upper = cyl(.07, .075, .3, 7, coat, 0, -.15, 0); shoulder.add(upper);
      addOutline(upper, .01, 0x101828);
      const elbow = new THREE.Group(); elbow.position.y = -.3; shoulder.add(elbow);
      const fore = cyl(.062, .07, .27, 7, coatDark, 0, -.135, 0); elbow.add(fore);
      const cuff = cyl(.075, .075, .07, 7, leather, 0, -.27, 0); elbow.add(cuff);
      const hand = new THREE.Group(); hand.position.y = -.31; elbow.add(hand);
      const palm = sphere(.065, skin, 0, 0, 0, 7); palm.scale.set(1, 1.15, .8); hand.add(palm);
      return { shoulder, elbow, hand };
    };
    const armR = makeArm(-1), armL = makeArm(1);
    rig.armR = armR; rig.armL = armL;
    armR.shoulder.rotation.z = -.16; armL.shoulder.rotation.z = .16;

    // sword
    const sword = rig.sword = new THREE.Group();
    armR.hand.add(sword);
    sword.rotation.x = -.45;
    const grip = cyl(.026, .03, .18, 6, leatherDark, 0, -.03, 0); sword.add(grip);
    const pommel = sphere(.04, gold, 0, -.14, 0, 6); sword.add(pommel);
    const guard = box(.28, .045, .06, gold, 0, .075, 0); sword.add(guard);
    const gemS = new THREE.Mesh(new THREE.OctahedronGeometry(.035, 0), new THREE.MeshBasicMaterial({ color: 0x8ff8ff }));
    gemS.position.set(0, .08, .045); sword.add(gemS);
    const blade = box(.065, .92, .018, steel, 0, .55, 0); sword.add(blade);
    addOutline(blade, .008, 0x202838);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(.046, .16, 4), steel);
    tip.position.y = 1.09; tip.rotation.y = Math.PI / 4; sword.add(tip);
    const fuller = box(.016, .82, .022, new THREE.MeshBasicMaterial({ color: 0xa8f4ff }), 0, .56, 0); sword.add(fuller);
    // grimoire in left hand
    const book = rig.book = new THREE.Group();
    armL.hand.add(book);
    book.position.set(0, -.05, .02); book.rotation.set(.4, .2, -.4);
    const cover = box(.22, .05, .16, leatherDark, 0, 0, 0); book.add(cover);
    const pages = box(.2, .045, .145, cloth, 0, .02, 0); book.add(pages);
    const rune = new THREE.Mesh(new THREE.CircleGeometry(.05, 12), new THREE.MeshBasicMaterial({ color: 0x8ff8ff }));
    rune.rotation.x = -Math.PI / 2; rune.position.y = .05; book.add(rune);
    this.addBookGlow(book);

    // legs
    const makeLeg = (side) => {
      const hipJ = new THREE.Group(); hipJ.position.set(side * .13, -.02, 0); hip.add(hipJ);
      const thigh = cyl(.078, .09, .42, 7, coatDark, 0, -.21, 0); hipJ.add(thigh);
      addOutline(thigh, .01, 0x101018);
      const knee = new THREE.Group(); knee.position.y = -.42; hipJ.add(knee);
      const shin = cyl(.065, .075, .38, 7, leatherDark, 0, -.19, 0); knee.add(shin);
      const boot = box(.15, .17, .26, leather, 0, -.4, .04); knee.add(boot);
      addOutline(boot, .01, 0x100c0c);
      const cuff = cyl(.085, .085, .1, 7, leather, 0, -.31, 0); knee.add(cuff);
      return { hip: hipJ, knee };
    };
    rig.legR = makeLeg(-1); rig.legL = makeLeg(1);

    // cape (vertex animated), tapered at the shoulders and flared at the hem
    const capeGeo = new THREE.PlaneGeometry(.54, .98, 6, 10);
    capeGeo.translate(0, -.49, 0);
    {
      const cp = capeGeo.attributes.position;
      for (let i = 0; i < cp.count; i++) {
        const v = clamp(-cp.getY(i) / .98, 0, 1);
        cp.setX(i, cp.getX(i) * (.66 + .62 * v));
        cp.setY(i, cp.getY(i) + v * v * .035);
      }
      cp.needsUpdate = true;
    }
    const cape = new THREE.Mesh(capeGeo, capeMat);
    cape.position.set(0, .46, -.17);
    torso.add(cape);
    rig.cape = cape;
    rig.capeBase = capeGeo.attributes.position.array.slice();
    const capeTrim = new THREE.Mesh(new THREE.PlaneGeometry(.58, .04), gold);
    capeTrim.position.set(0, -.005, -.008); cape.add(capeTrim);
    // inner cape layer, a touch darker and shorter
    const innerGeo = new THREE.PlaneGeometry(.42, .72, 4, 7);
    innerGeo.translate(0, -.36, 0);
    const inner = new THREE.Mesh(innerGeo, coatDark);
    inner.position.set(0, .38, -.145); torso.add(inner);
    rig.innerCape = inner;
    rig.innerBase = innerGeo.attributes.position.array.slice();
    // back banner-like cloth pieces — narrow ribbons trailing off the cape
    for (const s of [-1, 1]) {
      const strip = new THREE.Mesh(new THREE.PlaneGeometry(.055, .34), capeMat);
      strip.position.set(s * .19, .13, -.215); strip.rotation.z = s * .12; strip.material.side = THREE.DoubleSide;
      torso.add(strip);
      rig['strip' + s] = strip;
      const tip = new THREE.Mesh(new THREE.PlaneGeometry(.055, .05), gold);
      tip.position.set(0, -.19, .002); strip.add(tip);
    }

    // soft blob shadow
    const shadowGeo = new THREE.CircleGeometry(.6, 18);
    const shadowMat = new THREE.MeshBasicMaterial({ color: 0x0a1a12, transparent: true, opacity: .28, depthWrite: false });
    this.shadow = new THREE.Mesh(shadowGeo, shadowMat);
    this.shadow.rotation.x = -Math.PI / 2;
    this.group.add(this.shadow);
    this.shadow.position.y = .04;

    this.group.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
    this.shadow.castShadow = false;
    this.chest = chest;
  }

  addHeadGlow(gem) {
    const s = glowSprite(0x7ff0ff, .13, GLOW); s.material.opacity = .26; gem.add(s);
  }
  addBookGlow(book) {
    // Small, warm-held glow instead of a detached floating orb.
    const s = glowSprite(0x7ff0ff, .22, GLOW);
    s.material.opacity = .16; s.position.set(0, .04, -.01); book.add(s);
    this.bookGlow = s;
  }

  /* ================================================================== */
  /*  FIRST PERSON RIG                                                  */
  /* ================================================================== */
  buildFirstPerson() {
    const fp = this.fp = new THREE.Group();
    fp.visible = false;
    G.camera.add(fp);
    const skin = toon(0xf6c9a2, { rim: .2, rimColor: 0xffe8d0 });
    const sleeve = toon(0x254a5f, { rim: .2, rimColor: 0x9fe4ff });
    const glove = toon(0x49301f, { rim: .16, rimColor: 0xffc890 });
    const steel = toon(0xc8d6e4, { rim: .5, rimColor: 0xffffff, emissive: 0x1a2430, emissiveIntensity: .35 });
    const gold = toon(0xe0b25a, { rim: .5, rimColor: 0xfff4c0 });

    // right arm: comes in from the lower-right corner, forearm foreshortened
    const rArm = new THREE.Group();
    rArm.position.set(.37, -.51, -.72); rArm.rotation.set(.9, -.1, -.35); fp.add(rArm);
    const rFore = cyl(.032, .044, .34, 7, sleeve, 0, 0, -.17); rFore.rotation.x = Math.PI / 2; rArm.add(rFore);
    const rCuff = cyl(.046, .048, .06, 7, glove, 0, 0, -.31); rCuff.rotation.x = Math.PI / 2; rArm.add(rCuff);
    const rHand = sphere(.045, glove, 0, -.006, -.35, 8); rHand.scale.set(1, .92, 1.08); rArm.add(rHand);
    const sword = new THREE.Group();
    sword.position.set(0, .015, -.4);
    sword.rotation.set(-1.15, .8, -.55);
    rArm.add(sword);
    sword.add(box(.036, .52, .012, steel, 0, .27, 0));
    sword.add(box(.012, .44, .014, toon(0x93a6b8, { rim: .2 }), 0, .27, 0));
    sword.add(box(.115, .022, .036, gold, 0, .016, 0));
    sword.add(box(.021, .11, .021, glove, 0, -.06, 0));
    const pommel = new THREE.Mesh(new THREE.OctahedronGeometry(.024, 0), gold); pommel.position.y = -.12; sword.add(pommel);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(.018, .09, 4), steel); tip.position.y = .555; sword.add(tip);
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(.018, 0), new THREE.MeshBasicMaterial({ color: 0x8ff8ff })); gem.position.set(0, .026, .022); sword.add(gem);
    sword.scale.setScalar(.92);
    this.fpSword = sword;
    this.fpRArm = rArm;

    // left arm: grimoire held open at the lower-left
    const lArm = new THREE.Group();
    lArm.position.set(-.37, -.53, -.7); lArm.rotation.set(.85, .12, .3); fp.add(lArm);
    const lFore = cyl(.03, .04, .32, 7, sleeve, 0, 0, -.16); lFore.rotation.x = Math.PI / 2; lArm.add(lFore);
    const lCuff = cyl(.042, .044, .05, 7, glove, 0, 0, -.29); lCuff.rotation.x = Math.PI / 2; lArm.add(lCuff);
    const lHand = sphere(.042, skin, 0, 0, -.33, 8); lArm.add(lHand);
    const book = new THREE.Group(); book.position.set(-.015, .045, -.355); book.rotation.set(1.12, -.28, .12); lArm.add(book);
    book.add(box(.115, .034, .145, toon(0x3c2718, { rim: .1, rimColor: 0xffc890 }), 0, 0, 0));
    book.add(box(.1, .028, .128, toon(0xefe3c6), 0, .018, 0));
    book.add(box(.012, .036, .145, gold, -.055, 0, 0));
    book.add(box(.09, .006, .006, toon(0xbfae8e), 0, .033, .02));
    book.add(box(.09, .006, .006, toon(0xbfae8e), 0, .033, -.02));
    const bookRune = new THREE.Mesh(new THREE.CircleGeometry(.022, 12), new THREE.MeshBasicMaterial({ color: 0x8ff8ff, transparent: true, opacity: .95 }));
    bookRune.rotation.x = -Math.PI / 2; bookRune.position.set(.014, .034, 0); book.add(bookRune);
    const glow = glowSprite(0x7ff0ff, .11, GLOW); glow.material.opacity = .14; glow.position.set(0, .035, 0); book.add(glow);
    this.fpBookGlow = glow;
    this.fpLArm = lArm;
    const handGlow = glowSprite(0xffb066, .01, GLOW); handGlow.material.opacity = 0; handGlow.position.set(0, 0, -.4); lArm.add(handGlow);
    this.fpHandGlow = handGlow;

    // gauntlet-mounted lantern for mood? small glow to light hands visually
    fp.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
  }

  /* ================================================================== */
  /*  INPUT / ACTIONS                                                   */
  /* ================================================================== */
  get alive() { return !this.dead; }
  get pos() { return this.group.position; }

  canAct() {
    return !this.dead && !this.action && this.dodgeTime <= 0;
  }

  pressAttack() {
    if (this.dead) return;
    const now = G.time;
    this.lastAttackPress = now;
    this.attackHeld = true;
    this.attackHeldTime = 0;
    if (this.charging) return;
    if (!this.action || (this.action.name.startsWith('attack') && this.action.t > this.action.dur * .55)) {
      if (this.action && this.action.name.startsWith('attack')) { this.queued = true; return; }
      this.startAttack();
    }
  }

  releaseAttack() {
    this.attackHeld = false;
    if (this.charging) {
      this.charging = false;
      this.heavyAttack(clamp(.7 + this.chargeT * .9, .8, 2.1));
      this.chargeT = 0;
      if (G.ui) G.ui.setCharge(0, null);
      return;
    }
    if (this.attackHeldTime < .18 && this.canAct() && !this.queued) {
      // no-op; single click already attacked
    }
  }

  startAttack(index = null) {
    if (this.dead) return;
    this.snapAimToCamera();
    if (!this.action) this.combo = index !== null ? index : (this.combo + 1) % 3;
    const names = ['attack1', 'attack2', 'attack3'];
    const durations = [.42, .52, .46];
    const name = names[this.combo % 3];
    this.action = { name, t: 0, dur: durations[this.combo % 3], hitDone: false, combo: this.combo % 3 };
    this.queued = false;
    this.comboWindow = 1.1;
    this.charging = false;
    if (G.audio) G.audio.sfx('swing', { pitch: 1 + this.combo * .1 });
  }

  heavyAttack(power = 1) {
    if (this.dead) return;
    this.snapAimToCamera();
    this.action = { name: 'heavy', t: 0, dur: .9, hitDone: false, power };
    this.combo = 0;
    if (G.ui) G.ui.setCharge(0, null);
    if (G.audio) G.audio.sfx('heavySwing');
  }

  /* ---------------- elemental codex ---------------- */
  currentSpellFor(element = this.element) {
    const idx = this.spellChoice[element] ?? 0;
    return spellOf(element, idx);
  }

  currentSpell() { return this.currentSpellFor(this.element); }

  selectElement(element, silent = false) {
    if (!this.unlocked[element] || !ELEMENTS[element]) {
      if (!silent && G.ui) G.ui.toast('Elemento ainda não despertado', 'warn');
      return false;
    }
    this.element = element;
    this.spellIndex = this.spellChoice[element] || 0;
    if (G.ui && G.ui.setSpell) G.ui.setSpell(this.element, this.spellIndex);
    if (!silent) {
      const sp = this.currentSpell();
      if (G.ui) G.ui.toast(`${ELEMENTS[element].icon} ${ELEMENTS[element].name} · ${sp.name}`, 'good');
      if (G.audio) G.audio.sfx('ui');
    }
    return true;
  }

  cycleSpell(delta = 1) {
    const list = SPELLS[this.element];
    if (!list) return;
    const cur = this.spellChoice[this.element] || 0;
    this.spellChoice[this.element] = (cur + delta + list.length) % list.length;
    this.spellIndex = this.spellChoice[this.element];
    const sp = this.currentSpell();
    if (G.ui) {
      G.ui.setSpell(this.element, this.spellIndex);
      G.ui.flashSkill(this.element);
      G.ui.toast(`${ELEMENTS[this.element].icon} ${sp.name} · ${sp.cost} mana`, 'good');
    }
    if (G.audio) G.audio.sfx('ui');
  }

  magicDown(element) {
    if (this.dead) return;
    // element keys always switch attunement, even mid-animation; the cast
    // itself waits for a free moment instead of silently swallowing input.
    if (element) this.selectElement(element, true);
    if (this.action || this.dodgeTime > 0) return;
    this.castCurrent();
  }

  magicUp() { /* casting resolves on press; retained for input compatibility */ }

  castCurrent(element = this.element) {
    if (this.dead || this.action || this.dodgeTime > 0) return false;
    const spell = this.currentSpellFor(element);
    if (!spell) return false;
    const cd = this.spellCds[spell.id] || 0;
    if (cd > 0) {
      if (G.ui) G.ui.toast(`Recarregando ${spell.name} (${cd.toFixed(1)}s)`, 'warn');
      if (G.audio) G.audio.sfx('error');
      return false;
    }
    if (this.mp < spell.cost) {
      if (G.ui) G.ui.toast(`Mana insuficiente · ${spell.name} custa ${spell.cost}`, 'warn');
      if (G.audio) G.audio.sfx('error');
      return false;
    }
    this.mp -= spell.cost;
    this.spellCds[spell.id] = spell.cd;
    this.cooldowns[element] = spell.cd;

    // aim from the camera rather than the last movement direction
    this.snapAimToCamera();

    // target / aim point appropriate to each shape
    const aimRange = spell.range || (spell.kind === 'projectile' ? 26 : spell.kind === 'nova' ? 4 : 18);
    const cone = spell.kind === 'projectile' ? Math.PI * .7 : Math.PI * 2;
    const target = this.pickTarget(aimRange, cone);
    this.castTarget = target;
    this.castElement = element;
    this.castSpell = spell;
    this.castPower = 1;
    this.castAimPos.copy(target ? target.group.position : this.aimPoint(aimRange));
    this.castAimPos.y = this.groundYpos() + .1;

    this.action = {
      name: 'cast', t: 0, dur: Math.max(.34, (spell.cast || .3) + .18),
      element, spell, resolveAt: Math.max(.16, spell.cast || .3), resolved: false,
    };
    if (target) this.faceToward(target.group.position, true);
    else this.faceToward(this.castAimPos, true);

    this.effects.magicCircle(this.pos.clone().setY(this.groundYpos()), element, spell.kind === 'nova' ? 4.4 : 3.1, .8, this.pos);
    const sfx = element === 'bolt' ? 'castBolt' : element === 'ice' ? 'castIce' : element === 'wind' ? 'castWind' : 'castFire';
    if (G.audio) G.audio.sfx(sfx);
    return true;
  }

  aimPoint(dist = 18) {
    const dir = this.getFacingDir();
    return this.pos.clone().addScaledVector(dir, dist).setY(this.groundYpos() + .1);
  }

  groundYpos() {
    return (G.groundAt ? G.groundAt(this.pos.x, this.pos.z) : heightAt(this.pos.x, this.pos.z));
  }

  pickTarget(range = 12, cone = Math.PI) {
    if (this.lockedTarget && !this.lockedTarget.dead) return this.lockedTarget;
    let best = null, bestScore = 1e9;
    const fwd = this.getFacingDir();
    for (const e of G.enemies) {
      if (e.dead) continue;
      const d = e.group.position.distanceTo(this.pos);
      if (d > range + (e.radius || 0)) continue;
      const to = new THREE.Vector3().subVectors(e.group.position, this.pos).setY(0).normalize();
      const ang = Math.acos(clamp(to.dot(fwd), -1, 1));
      if (ang > cone / 2 && (!G.target || G.target !== e)) continue;
      const score = d * (1 + ang * 1.5);
      if (score < bestScore) { bestScore = score; best = e; }
    }
    return best;
  }

  toggleLock() {
    if (this.lockedTarget) { this.lockedTarget = null; G.target = null; if (G.ui) G.ui.toast('Alvo liberado'); return; }
    let best = null, bd = 26;
    for (const e of G.enemies) {
      if (e.dead) continue;
      const d = e.group.position.distanceTo(this.pos);
      if (d < bd) { bd = d; best = e; }
    }
    if (best) { this.lockedTarget = best; G.target = best; if (G.audio) G.audio.sfx('ui'); if (G.ui) G.ui.toast('Alvo: ' + best.name); }
    else if (G.ui) G.ui.toast('Nenhum inimigo por perto');
  }

  dodge() {
    if (this.dead || this.dodgeCd > 0 || this.stamina < 18) return;
    let dir;
    const input = this.moveInput();
    if (input.lengthSq() > .1) dir = input.normalize();
    else dir = this.getFacingDir();
    this.dodgeDir.copy(dir);
    this.dodgeTime = .3;
    this.dodgeCd = 1.15;
    this.invuln = Math.max(this.invuln, .38);
    this.stamina -= 18;
    this.action = null;
    this.charging = false;
    if (G.ui) G.ui.setCharge(0, null);
    if (G.audio) G.audio.sfx('dodge');
    this.effects.dust(this.pos.clone().setY(this.groundYpos() + .1), 0xcfd8c0, 14);
    this.spawnAfterimage();
    if (G.ui) G.ui.flashSkill('dodge');
  }

  spawnAfterimage() {
    // Effects owns the mesh lifetime, so dodge no longer leaks geometry/materials.
    this.effects.afterimage(this.pos.clone().setY(this.groundYpos() + .02), this.group.rotation.y, 0x8fe8ff);
  }

  usePotion() {
    if (this.potions <= 0 || this.dead) { if (G.ui) G.ui.toast('Sem poções', 'warn'); if (G.audio) G.audio.sfx('error'); return; }
    if (this.hp >= this.maxHp && this.mp >= this.maxMp) { if (G.ui) G.ui.toast('Vida e mana já estão cheias'); return; }
    this.potions--;
    this.hp = Math.min(this.maxHp, this.hp + 50);
    this.mp = Math.min(this.maxMp, this.mp + 30);
    this.effects.heal(this.pos.clone().setY(this.groundYpos() + .8));
    if (G.audio) G.audio.sfx('heal');
    if (G.ui) { G.ui.toast('Poção de Aetheria · +50 vida +30 mana'); G.ui.flashSkill('heal'); G.ui.popHeal(this.pos); }
  }

  /* ================================================================== */
  /*  DAMAGE / PROGRESS                                                 */
  /* ================================================================== */
  takeDamage(amount, sourcePos = null, type = 'physical') {
    if (this.dead || this.invuln > 0) return;
    if (this.dodgeTime > 0) return;
    const dmg = Math.max(1, Math.round(amount));
    this.hp -= dmg;
    this.invuln = .7;
    this.lastHurt = 0;
    this.action = null;
    this.hitReact = .35;
    if (this.charging) { this.charging = false; if (G.ui) G.ui.setCharge(0, null); }
    if (G.ui) { G.ui.damage(dmg, this.pos.clone().setY(this.groundYpos() + 1.8), 'player'); G.ui.hurtFlash(); }
    if (G.audio) G.audio.sfx('hurt');
    this.shake(.4, 5);
    if (sourcePos) {
      const dir = new THREE.Vector3().subVectors(this.pos, sourcePos).setY(0).normalize();
      this.vel.addScaledVector(dir, 4);
    }
    if (this.hp <= 0) this.die();
  }

  die() {
    if (this.dead) return;
    this.dead = true;
    this.hp = 0;
    this.respawnTimer = 3;
    this.action = null;
    this.charging = false;
    if (G.ui) { G.ui.setCharge(0, null); G.ui.toast('Você caiu… retornando à Vila de Brisa', 'warn'); }
    if (G.audio) G.audio.sfx('goblinDie');
    if (G.stats) G.stats.deaths++;
    this.model.rotation.z = .8;
    this.model.position.y = .1;
  }

  respawn() {
    this.dead = false;
    this.hp = Math.round(this.maxHp * .7);
    this.mp = Math.round(this.maxMp * .5);
    this.stamina = this.maxStamina;
    this.group.position.copy(this.spawn);
    this.group.position.y = G.groundAt ? G.groundAt(this.spawn.x, this.spawn.z) : heightAt(this.spawn.x, this.spawn.z);
    this.model.rotation.z = 0; this.model.position.y = 0;
    this.vel.set(0, 0, 0); this.vy = 0;
    this.gold = Math.max(0, this.gold - 15);
    this.invuln = 2;
    this.lockedTarget = null; G.target = null;
    if (G.ui) G.ui.toast('O cristal o trouxe de volta. Cuidado, viajante.', 'good');
  }

  addXP(n) {
    this.xp += n;
    while (this.xp >= this.xpNext) {
      this.xp -= this.xpNext;
      this.level++;
      this.xpNext = Math.round(this.xpNext * 1.45 + 25);
      this.maxHp += 12; this.maxMp += 8; this.maxStamina += 3;
      this.hp = this.maxHp; this.mp = this.maxMp;
      this.critChance = Math.min(.4, this.critChance + .01);
      this.effects.levelUp(this.pos.clone());
      if (G.audio) G.audio.sfx('level');
      if (G.ui) { G.ui.toast('Nível ' + this.level + '! Vida e mana restauradas', 'good'); G.ui.levelBurst(); }
    }
  }

  addGold(n) {
    this.gold += n; G.stats.gold = this.gold;
    if (G.ui) G.ui.toast('+' + n + ' ouro', 'gold');
    if (G.audio) G.audio.sfx('coin');
  }

  upgrade(type) {
    if (type === 'sword') {
      this.swordLevel++;
      this.critChance += .02;
      const mat = this.rig.sword.children.find(c => c.isMesh && c.material && c.material.color && c.material.color.getHex() === 0xc8d6e4);
      if (mat) mat.material.emissiveIntensity = .35 + this.swordLevel * .18;
    } else if (type === 'magic') {
      this.magicLevel++;
      this.maxMp += 10;
      this.mp = this.maxMp;
    } else if (type === 'vitality') {
      this.maxHp += 25;
      this.hp = this.maxHp;
    }
  }

  /* ================================================================== */
  /*  UPDATE                                                            */
  /* ================================================================== */
  moveInput() {
    const k = G.keys;
    let x = 0, z = 0;
    if (k['w'] || k['arrowup']) z += 1;
    if (k['s'] || k['arrowdown']) z -= 1;
    if (k['a'] || k['arrowleft']) x -= 1;
    if (k['d'] || k['arrowright']) x += 1;
    if (this.joystick && this.joystick.lengthSq() > .01) { x += this.joystick.x; z += this.joystick.y; }
    const v = new THREE.Vector3(x, 0, z);
    if (v.lengthSq() > 1) v.normalize();
    return v;
  }

  getFacingDir() {
    return new THREE.Vector3(Math.sin(this.group.rotation.y), 0, Math.cos(this.group.rotation.y));
  }

  /** Direction the camera is looking (third-person uses the camera orbit, first-person the view yaw). */
  aimYaw() {
    return this.firstPerson ? this.viewYaw : this.camAngle + Math.PI;
  }

  /** Snap melee/magic aim to the camera unless a target is locked. */
  snapAimToCamera() {
    if (this.lockedTarget && !this.lockedTarget.dead) return;
    this.facing = this.aimYaw();
    this.group.rotation.y = this.facing;
  }

  faceToward(pos, instant = false) {
    const yaw = Math.atan2(pos.x - this.pos.x, pos.z - this.pos.z);
    if (instant) this.group.rotation.y = yaw;
    else this.facing = yaw;
  }

  update(dt) {
    if (this.dead) {
      this.respawnTimer -= dt;
      this.updateCamera(dt);
      this.updateTimers(dt);
      if (this.respawnTimer <= 0) this.respawn();
      return;
    }
    this.updateTimers(dt);
    this.updateMovement(dt);
    this.updateActions(dt);
    this.updateAnimation(dt);
    this.updateCape(dt);
    this.updateCamera(dt);
    this.updateFirstPerson(dt);
    this.hitReact = Math.max(0, (this.hitReact || 0) - dt);
    this.lastHurt += dt;
    this.shadow.position.y = 0.04;
    this.shadow.material.opacity = this.grounded ? .28 : .12;
    // regen
    if (this.lastHurt > 7) this.hp = Math.min(this.maxHp, this.hp + 1.6 * dt);
    this.mp = Math.min(this.maxMp, this.mp + 2.8 * dt);
    if (!this.action && this.dodgeTime <= 0 && !(G.keys['shift'] && this.moveSpeed > 1)) this.stamina = Math.min(this.maxStamina, this.stamina + 20 * dt);
    // charge UI
    if (this.fireCharging) {
      this.fireChargeT = Math.min(1.5, this.fireChargeT + dt);
      const k = this.fireChargeT / 1.5;
      if (G.ui) G.ui.setCharge(k, 'fire');
      if (Math.random() < dt * 14) this.effects.fireCharge(this.handWorldPos(), 1);
    } else if (this.charging) {
      this.chargeT = Math.min(1.6, this.chargeT + dt);
      if (G.ui) G.ui.setCharge(this.chargeT / 1.6, 'sword');
      if (Math.random() < dt * 8) this.effects.particles(this.rig.sword.localToWorld(new THREE.Vector3(0, .9, 0)), 0xffe6a0, { count: 1, speed: .8, size: .08, life: .35, gravity: -.5, up: 1 });
    }
  }

  updateTimers(dt) {
    this.invuln = Math.max(0, this.invuln - dt);
    this.dodgeCd = Math.max(0, this.dodgeCd - dt);
    this.comboWindow = Math.max(0, this.comboWindow - dt);
    for (const k in this.cooldowns) this.cooldowns[k] = Math.max(0, this.cooldowns[k] - dt);
    for (const k in this.spellCds) this.spellCds[k] = Math.max(0, this.spellCds[k] - dt);
    if (this.comboWindow <= 0 && !this.action) this.combo = 0;
    if (this.shakeT > 0) this.shakeT -= dt;
    // held attack -> charge
    if (this.attackHeld) {
      this.attackHeldTime += dt;
      if (!this.charging && this.attackHeldTime > .55 && this.canAct() && !this.fireCharging) {
        this.charging = true; this.chargeT = .12;
        if (G.audio) G.audio.sfx('charge');
      }
    }
    if (this.charging && !this.attackHeld) { /* released via handler */ }
    if (this.charging && this.fireCharging) this.charging = false;
  }

  updateMovement(dt) {
    const input = this.moveInput();
    const runKey = !!(G.keys['shift']);
    const busy = this.action || this.charging || this.fireCharging;
    let speed = this.moveSpeed;
    if (this.dodgeTime > 0) {
      this.dodgeTime -= dt;
      const t = this.dodgeTime / .3;
      this.vel.lerp(this.dodgeDir.clone().multiplyScalar(12 * t), 1 - Math.exp(-dt * 30));
      this.group.position.addScaledVector(this.vel, dt);
      this.faceToward(this.pos.clone().add(this.dodgeDir), false);
    } else {
      let baseSpeed = runKey && this.stamina > 1 ? 7.2 : 4.2;
      if (this.grounded && surfaceAt(this.pos.x, this.pos.z) === 'water') baseSpeed *= .55;
      if (busy) baseSpeed *= .32;
      if (this.firstPerson) baseSpeed *= .96;
      const forwardYaw = this.firstPerson ? this.viewYaw : this.camAngle + Math.PI;
      const camForward = new THREE.Vector3(Math.sin(forwardYaw), 0, Math.cos(forwardYaw));
      // Screen-right for a camera looking along camForward is (-forward.z, 0, forward.x).
      // The old +forward.z form mirrored A/D and was the "inverted controls" report.
      const camRight = new THREE.Vector3(-camForward.z, 0, camForward.x);
      const world = new THREE.Vector3();
      world.addScaledVector(camForward, input.z);
      world.addScaledVector(camRight, input.x);
      if (world.lengthSq() > 1) world.normalize();
      // locked target: strafe, face target
      const target = this.lockedTarget && !this.lockedTarget.dead ? this.lockedTarget : null;
      if (target) this.faceToward(target.group.position, false);
      else if (world.lengthSq() > .01) {
        const yaw = Math.atan2(world.x, world.z);
        this.facing = yaw;
      }
      if (!this.firstPerson) {
        if (this.action && (this.action.name.startsWith('attack') || this.action.name === 'cast')) { /* keep facing the committed target */ }
        else {
          let diff = angleDiff(this.facing, this.group.rotation.y);
          this.group.rotation.y += diff * (1 - Math.exp(-dt * (this.dodgeTime > 0 ? 18 : 12)));
        }
      } else {
        this.group.rotation.y = this.viewYaw;
      }
      const targetVel = world.multiplyScalar(baseSpeed);
      this.vel.x = damp(this.vel.x, targetVel.x, 12, dt);
      this.vel.z = damp(this.vel.z, targetVel.z, 12, dt);
      if (runKey && this.grounded && input.lengthSq() > .1) this.stamina = Math.max(0, this.stamina - 14 * dt);
      if (this.action && this.action.name === 'attack3' && this.action.t < this.action.dur * .5) {
        this.group.position.addScaledVector(this.getFacingDir(), dt * 3.4);
      }
      this.group.position.x += this.vel.x * dt;
      this.group.position.z += this.vel.z * dt;
      this.moveSpeed = Math.hypot(this.vel.x, this.vel.z) * (input.lengthSq() > .1 ? 1 : 0);
      // footsteps
      if (this.grounded && this.moveSpeed > .7) {
        this.walkPhase += dt * (this.moveSpeed > 5.5 ? 11.5 : 8.2);
        this.stepTimer -= dt;
        if (this.stepTimer <= 0) {
          this.stepTimer = this.moveSpeed > 5.5 ? .27 : .4;
          const surface = surfaceAt(this.pos.x, this.pos.z);
          if (G.audio) G.audio.sfx(surface === 'water' ? 'stepWater' : surface === 'stone' ? 'stepStone' : 'stepGrass');
          if (surface === 'water' && Math.random() < .4) this.effects.dust(this.pos.clone().setY(this.groundYpos() + .1), 0xd8f4ff, 5);
          else this.effects.dust(this.pos.clone().setY(this.groundYpos() + .05), 0xb8a882, 2);
        }
      } else this.walkPhase += dt * .8;
      // jump / gravity
      if (G.keys[' '] && this.grounded && this.canAct()) {
        this.vy = 7.4; this.grounded = false;
        if (G.audio) G.audio.sfx('jump');
      }
      let groundY = (G.groundAt ? G.groundAt(this.pos.x, this.pos.z) : heightAt(this.pos.x, this.pos.z));
      if (isWaterAt(this.pos.x, this.pos.z)) groundY = Math.max(groundY, WATER_LEVEL - .72);
      if (!this.grounded) {
        this.vy -= 22 * dt;
        this.group.position.y += this.vy * dt;
        if (this.group.position.y <= groundY) {
          this.group.position.y = groundY; this.vy = 0; this.grounded = true;
          if (G.audio) G.audio.sfx('land');
          this.effects.dust(this.pos.clone().setY(groundY + .1), 0xb8a882, 8);
        }
      } else {
        this.group.position.y = damp(this.group.position.y, groundY, 18, dt);
      }
      if (!this.firstPerson && input.lengthSq() > .1 && input.z > .3 && Math.abs(input.x) < .5 && !this.lockedTarget && G.time - this.lastDrag > 2) {
        this.camAngle = dampAngle(this.camAngle, this.group.rotation.y + Math.PI, .9, dt);
      }
      // collisions
      this.resolveCollisions();
    }
    // world bounds
    const r = Math.hypot(this.pos.x, this.pos.z);
    if (r > 148) { this.pos.x *= 148 / r; this.pos.z *= 148 / r; }
  }

  resolveCollisions() {
    const cols = G.colliders || [];
    for (const c of cols) {
      const dx = this.pos.x - c.x, dz = this.pos.z - c.z;
      const d = Math.hypot(dx, dz);
      const rr = c.r + .35;
      if (d < rr && d > .001) {
        const push = (rr - d);
        this.pos.x += dx / d * push;
        this.pos.z += dz / d * push;
      }
    }
  }

  handWorldPos() {
    const p = new THREE.Vector3();
    if (this.firstPerson) {
      this.fpLArm.getWorldPosition(p);
      p.add(new THREE.Vector3(0, 0, -.5));
    } else {
      this.rig.armL.hand.getWorldPosition(p);
      p.y += .1;
    }
    return p;
  }

  updateActions(dt) {
    // queue follow-up combo
    if (!this.action && this.queued && this.comboWindow > 0) {
      this.queued = false;
      this.startAttack();
    }
    if (!this.action) return;
    const a = this.action;
    a.t += dt;
    const t = a.t / a.dur;
    if (a.name.startsWith('attack') && !a.hitDone && t > .34) {
      a.hitDone = true;
      this.resolveSwordHit(a);
    }
    if (a.name === 'heavy') {
      if (t > .32 && !a.hitDone) {
        a.hitDone = true;
        this.resolveHeavyHit(a.power);
      }
    }
    if (a.name === 'cast') {
      if (!a.resolved && a.t >= (a.resolveAt || .4)) {
        a.resolved = true;
        this.resolveCast(a.element, a.spell);
      }
    }
    if (a.t >= a.dur) {
      this.action = null;
      this.castElement = null;
      this.castSpell = null;
    }
  }

  /* ---------------- damage resolution ---------------- */
  swordBase() { return 9 + this.swordLevel * 4.5 + this.level * 1.6; }
  magicBase() { return 16 + this.magicLevel * 6 + this.level * 2; }

  rollCrit() { return Math.random() < this.critChance; }

  resolveSwordHit(a) {
    const combo = a.combo || 0;
    const range = combo === 2 ? 3.4 : 2.9;
    const arc = combo === 1 ? 2.8 : 2.4;
    const mult = [1, 1.12, 1.35][combo];
    const fwd = this.getFacingDir();
    const center = this.pos.clone().addScaledVector(fwd, 1.2).setY(this.groundYpos() + 1.1);
    // slash vfx
    if (combo === 1) this.effects.slash(center, this.group.rotation.y + Math.PI / 2, { color: 0xfff0c0, vertical: true, radius: 2.5, flip: true });
    else if (combo === 2) this.effects.slash(center, this.group.rotation.y, { color: 0xd8f4ff, radius: 2.2, tilt: .05 });
    else this.effects.slash(center, this.group.rotation.y, { color: 0xfff0c0, radius: 2.7 });
    if (G.audio) G.audio.sfx('swing', { pitch: 1 + combo * .12 });
    let hitAny = false;
    for (const e of G.enemies) {
      if (e.dead) continue;
      const d = e.group.position.distanceTo(this.pos);
      if (d > range + (e.radius || 0)) continue;
      const to = new THREE.Vector3().subVectors(e.group.position, this.pos).setY(0).normalize();
      const ang = Math.abs(angleDiff(Math.atan2(to.x, to.z), this.group.rotation.y));
      if (ang > arc / 2) continue;
      const crit = this.rollCrit();
      const dmg = Math.round(this.swordBase() * mult * (crit ? 1.7 : 1) * rand(.92, 1.08));
      e.takeDamage(dmg, {
        type: 'physical', crit, from: this.pos,
        knockback: combo === 2 ? 3.5 : 1.8,
        effect: (pos) => this.effects.hitSpark(pos, 0xfff0c0, crit),
      });
      hitAny = true;
      if (G.hitStop !== undefined) G.hitStop = Math.max(G.hitStop || 0, crit ? .08 : .045);
      this.shake(.18, crit ? 4 : 2);
      if (G.audio) G.audio.sfx(crit ? 'crit' : 'hit');
    }
    if (!hitAny) {
      // whiff air particle
      this.effects.particles(center, 0xfff4d0, { count: 4, speed: .6, size: .06, life: .25, gravity: 0, additive: true });
    }
  }

  resolveHeavyHit(power) {
    const center = this.pos.clone().setY(this.groundYpos() + .7);
    this.effects.slash(center, this.group.rotation.y, { color: 0xffe6a0, radius: 3.8, tilt: .02, life: .35 });
    this.effects.shockwave(this.pos.clone().setY(this.groundYpos() + .1), 0xffd27a, 4.6, .55);
    this.effects.dust(this.pos.clone().setY(this.groundYpos() + .1), 0xd8c49a, 22);
    this.shake(.35, 5);
    let hit = 0;
    for (const e of G.enemies) {
      if (e.dead) continue;
      const d = e.group.position.distanceTo(this.pos);
      if (d > 3.8 + (e.radius || 0)) continue;
      const crit = this.rollCrit();
      const dmg = Math.round(this.swordBase() * 2.1 * power * (crit ? 1.6 : 1));
      e.takeDamage(dmg, {
        type: 'physical', crit, from: this.pos, knockback: 8,
        effect: (pos) => this.effects.hitSpark(pos, 0xffd27a, true),
      });
      hit++;
    }
    if (hit) { G.hitStop = Math.max(G.hitStop || 0, .1); if (G.audio) G.audio.sfx('crit'); }
    if (G.ui) G.ui.flashSkill('sword');
  }

  /* ---------------- spell resolution ---------------- */
  groundYposAt(x, z) {
    return (G.groundAt ? G.groundAt(x, z) : heightAt(x, z));
  }

  spellStatus(spell) {
    return {
      freeze: spell.freeze,
      burn: spell.burn,
      knockback: spell.knockback || 0,
      slow: spell.slow,
      stun: spell.stun,
      color: spell.color || 0xfff0c0,
    };
  }

  areaDamage(center, radius, mult, element, extra = {}) {
    let hits = 0;
    for (const e of G.enemies) {
      if (e.dead) continue;
      const d = e.group.position.distanceTo(center);
      if (d > radius + (e.radius || 0)) continue;
      const crit = this.rollCrit();
      const falloff = 1 - clamp(d / (radius + 2.2), 0, .4);
      const dmg = Math.round(this.magicBase() * mult * falloff * (crit ? 1.7 : 1) * rand(.94, 1.06));
      e.takeDamage(dmg, {
        type: element, crit, from: this.pos,
        ...extra,
        effect: (ep) => this.effects.hitSpark(ep, extra.color || 0xfff0c0, crit),
      });
      hits++;
    }
    if (hits) {
      G.hitStop = Math.max(G.hitStop || 0, .035);
      this.shake(.16, 3);
    }
    return hits;
  }

  coneDamage(origin, yaw, range, arc, mult, element, extra = {}) {
    const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    let hits = 0;
    for (const e of G.enemies) {
      if (e.dead) continue;
      const to = new THREE.Vector3().subVectors(e.group.position, origin).setY(0);
      const d = to.length();
      if (d > range + (e.radius || 0)) continue;
      if (d > .001) to.normalize();
      const ang = Math.acos(clamp(to.dot(fwd), -1, 1));
      if (ang > arc / 2) continue;
      const crit = this.rollCrit();
      const dmg = Math.round(this.magicBase() * mult * (crit ? 1.7 : 1) * rand(.94, 1.06));
      e.takeDamage(dmg, {
        type: element, crit, from: this.pos,
        ...extra,
        effect: (ep) => this.effects.hitSpark(ep, extra.color || 0xfff0c0, crit),
      });
      hits++;
    }
    if (hits) { G.hitStop = Math.max(G.hitStop || 0, .03); this.shake(.14, 2.6); }
    return hits;
  }

  lineDamage(start, end, width, mult, element, extra = {}) {
    const ab = new THREE.Vector3().subVectors(end, start).setY(0);
    const len2 = Math.max(.0001, ab.lengthSq());
    let hits = 0;
    for (const e of G.enemies) {
      if (e.dead) continue;
      const ap = new THREE.Vector3().subVectors(e.group.position, start).setY(0);
      const t = clamp(ap.dot(ab) / len2, 0, 1);
      const closest = start.clone().addScaledVector(ab, t);
      const d = closest.distanceTo(e.group.position);
      if (d > width / 2 + (e.radius || 0)) continue;
      const crit = this.rollCrit();
      const dmg = Math.round(this.magicBase() * mult * (crit ? 1.7 : 1) * rand(.94, 1.06));
      e.takeDamage(dmg, {
        type: element, crit, from: this.pos,
        ...extra,
        effect: (ep) => this.effects.hitSpark(ep, extra.color || 0xfff0c0, crit),
      });
      hits++;
    }
    if (hits) { G.hitStop = Math.max(G.hitStop || 0, .04); this.shake(.18, 3.4); }
    return hits;
  }

  resolveCast(element, spell) {
    if (!spell) return;
    const from = this.handWorldPos();
    const target = this.castTarget && !this.castTarget.dead ? this.castTarget : null;
    const targetPos = () => target && !target.dead
      ? target.group.position.clone().add(new THREE.Vector3(0, (target.headHeight || 1.2) * .55, 0))
      : this.castAimPos.clone().add(new THREE.Vector3(0, .8, 0));
    const aim = this.castAimPos.clone();
    const groundAim = new THREE.Vector3(aim.x, this.groundYposAt(aim.x, aim.z) + .12, aim.z);
    const status = this.spellStatus(spell);
    const color = spell.color || 0xffffff;
    this.castCounts[element] = (this.castCounts[element] || 0) + 1;
    const kind = spell.kind;

    if (kind === 'projectile') {
      if (spell.pierce) this.lineDamage(from, targetPos(), 1.7, spell.dmg * .8, element, { ...status, knockback: 2.5 });
      const onHit = (p) => {
        this.areaDamage(p, spell.radius || 1.8, spell.dmg * (spell.pierce ? .62 : 1), element, status);
        this.effects.explosion(p, color, .65 + (spell.scale || 1) * .35);
        if (G.audio) G.audio.sfx('explosion');
      };
      if (element === 'fire') this.effects.fireball(from, targetPos, { color, scale: .8 + (spell.scale || 1) * .35, speed: spell.speed || 20, onHit });
      else if (element === 'ice') this.effects.iceShard(from, targetPos, { onHit });
      else if (element === 'bolt') this.effects.boltOrb(from, targetPos, { color, speed: spell.speed || 30, onHit: (p) => { this.effects.lightning(p, {}); onHit(p); } });
      else this.effects.windBlade(from, targetPos, { color, speed: spell.speed || 26, onHit });
      this.effects.particles(from, color, { count: 12, speed: 2.4, size: .12, life: .35, gravity: 0, up: .6, spread: .4 });
    } else if (kind === 'cone') {
      const yaw = target ? Math.atan2(target.group.position.x - this.pos.x, target.group.position.z - this.pos.z) : this.group.rotation.y;
      this.coneDamage(this.pos, yaw, spell.range || 6, spell.arc || 2.2, spell.dmg, element, { ...status, knockback: spell.knockback || 2 });
      this.effects.gust(this.pos.clone().setY(this.groundYpos() + .35), yaw, spell.range || 6, color);
      const mid = this.pos.clone().addScaledVector(new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)), (spell.range || 6) * .45);
      mid.y = this.groundYposAt(mid.x, mid.z) + 1;
      this.effects.particles(mid, color, { count: 26, speed: 5, size: .15, life: .55, gravity: 1, up: .5, spread: 1.2 });
      if (G.audio) G.audio.sfx(element === 'ice' ? 'freeze' : element === 'wind' ? 'windHit' : 'fireCast');
    } else if (kind === 'nova') {
      const pos = this.pos.clone().setY(this.groundYpos() + .1);
      this.areaDamage(pos, spell.radius || 4, spell.dmg, element, status);
      if (element === 'ice') this.effects.frostNova(pos, spell.radius || 4.8, color);
      else {
        this.effects.shockwave(pos, color, spell.radius || 4.5, .55);
        this.effects.ring(pos, color, .5, spell.radius || 4.5, .5, true);
        this.effects.particles(pos.clone().setY(pos.y + .8), color, { count: 40, speed: (spell.radius || 4.5) * 1.2, size: .16, life: .7, gravity: 2, up: .8, spread: 1.3 });
      }
      this.shake(.22, 4);
      if (G.audio) G.audio.sfx(element === 'bolt' ? 'slam' : element === 'wind' ? 'windHit' : 'explosion');
    } else if (kind === 'rain') {
      if (element === 'bolt' && spell.strikes) {
        for (let i = 0; i < spell.strikes; i++) {
          const p = groundAim.clone().add(new THREE.Vector3(rand(-spell.radius, spell.radius) * .7, 0, rand(-spell.radius, spell.radius) * .7));
          this.pendingStrikes.push({ t: .28 + i * .2, pos: p, radius: 2.3, dmg: spell.dmg * .72, element, status: { ...status, stun: spell.stun } });
        }
        this.effects.magicCircle(groundAim, 'bolt', spell.radius, 1.1);
      } else {
        this.effects.meteorStrike(groundAim, spell.radius || 3.8, color, (p) => {
          this.areaDamage(p, spell.radius || 3.8, spell.dmg, element, status);
          if (G.audio) G.audio.sfx('meteor');
        });
        if (G.audio) G.audio.sfx('fireCharge');
      }
    } else if (kind === 'target') {
      if (element === 'ice') {
        const p = target ? target.group.position.clone() : groundAim;
        this.areaDamage(p, target ? 1.9 : 2.4, spell.dmg, element, { ...status, freeze: spell.freeze || 3 });
        if (target) this.effects.freezeShell(target, spell.freeze || 3);
        this.effects.magicCircle(p.clone().setY(this.groundYposAt(p.x, p.z) + .1), 'ice', 2.6, .7);
        if (G.audio) G.audio.sfx('freeze');
      } else if (element === 'wind') {
        this.pendingVortex = { pos: groundAim.clone(), radius: spell.radius || 3.6, t: 1.35, tick: 0, dmg: spell.dmg * .38, color };
        this.effects.cyclone(groundAim, spell.radius || 3.6, color, 1.35);
        if (G.audio) G.audio.sfx('windHit');
      } else {
        const p = target ? target.group.position.clone() : groundAim;
        this.effects.lightning(p, {});
        this.areaDamage(p, spell.radius || 1.7, spell.dmg, element, status);
        if (G.audio) G.audio.sfx('castBolt');
      }
    } else if (kind === 'chain') {
      const points = [from.clone()];
      let current = target ? target.group.position.clone() : groundAim.clone();
      const hitSet = new Set();
      for (let j = 0; j < (spell.jumps || 3); j++) {
        let best = null, bd = j === 0 ? (spell.radius || 6) : 6.5;
        for (const e of G.enemies) {
          if (e.dead || hitSet.has(e)) continue;
          const d = e.group.position.distanceTo(current);
          if (d < bd) { bd = d; best = e; }
        }
        if (!best) break;
        hitSet.add(best);
        current = best.group.position.clone().add(new THREE.Vector3(0, (best.headHeight || 1.2) * .55, 0));
        points.push(current.clone());
      }
      if (points.length > 1) {
        this.effects.chainLightning(points, color);
        for (const e of hitSet) {
          const crit = this.rollCrit();
          const dmg = Math.round(this.magicBase() * spell.dmg * (crit ? 1.7 : 1) * rand(.95, 1.05));
          e.takeDamage(dmg, { type: element, crit, from: this.pos, stun: spell.stun, knockback: 1.5, effect: (ep) => this.effects.hitSpark(ep, color, crit) });
        }
        G.hitStop = Math.max(G.hitStop || 0, .05);
        if (G.audio) G.audio.sfx('castBolt');
      } else {
        this.effects.lightning(groundAim, {});
      }
    } else if (kind === 'beam') {
      const dir = new THREE.Vector3().subVectors(target ? target.group.position : groundAim, this.pos).setY(0);
      if (dir.lengthSq() < .01) dir.set(Math.sin(this.group.rotation.y), 0, Math.cos(this.group.rotation.y));
      dir.normalize();
      const end = this.pos.clone().addScaledVector(dir, spell.range || 18);
      end.y = this.groundYposAt(end.x, end.z) + 1;
      this.effects.chainLightning([from.clone(), end], color);
      this.lineDamage(this.pos, end, spell.width || 1.9, spell.dmg, element, status);
      this.effects.particles(end, color, { count: 18, speed: 4, size: .15, life: .5, gravity: 2, up: .8 });
      if (G.audio) G.audio.sfx('castBolt');
      this.shake(.18, 3);
    } else if (kind === 'dash') {
      const input = this.moveInput();
      const dir = input.lengthSq() > .1 ? input.normalize() : this.getFacingDir();
      const start = this.pos.clone();
      const end = start.clone().addScaledVector(dir, spell.distance || 6);
      this.lineDamage(start, end, 2.4, spell.dmg, element, { ...status, knockback: 5 });
      for (let i = 0; i < 5; i++) this.effects.afterimage(start.clone().lerp(end, i / 4), this.group.rotation.y, color);
      this.group.position.copy(end);
      this.group.position.y = this.groundYposAt(end.x, end.z);
      this.resolveCollisions();
      this.invuln = Math.max(this.invuln, spell.invuln || .3);
      this.effects.gust(end.clone().setY(this.group.position.y + .3), this.group.rotation.y, 3, color);
      if (G.audio) G.audio.sfx('dodge');
    }

    if (G.ui) G.ui.flashSkill(element);
  }

  updatePending(dt) {
    if (this.pendingStrikes && this.pendingStrikes.length) {
      for (let i = this.pendingStrikes.length - 1; i >= 0; i--) {
        const s = this.pendingStrikes[i];
        s.t -= dt;
        if (s.t > 0) continue;
        this.pendingStrikes.splice(i, 1);
        this.effects.lightning(s.pos, {});
        this.areaDamage(s.pos, s.radius, s.dmg, s.element, s.status || {});
        if (G.audio) G.audio.sfx('slam');
      }
    }
    if (this.pendingVortex) {
      const v = this.pendingVortex;
      v.t -= dt; v.tick -= dt;
      for (const e of G.enemies) {
        if (e.dead) continue;
        const to = new THREE.Vector3().subVectors(v.pos, e.group.position).setY(0);
        const d = to.length();
        if (d < v.radius + 2.2 && d > .2) {
          e.group.position.addScaledVector(to.normalize(), Math.min(4.5, d) * 1.7 * dt);
          if (e.attack) e.attack = null;
        }
      }
      if (v.tick <= 0) {
        v.tick = .34;
        this.areaDamage(v.pos, v.radius, v.dmg, 'wind', { slow: 1.4, knockback: 0, color: v.color });
        this.effects.particles(v.pos.clone().setY(v.pos.y + .8), v.color || 0xa8f0d0, { count: 8, speed: 2, size: .14, life: .4, gravity: .5, up: .6, spread: 1 });
      }
      if (v.t <= 0) this.pendingVortex = null;
    }
  }

  /* ---------------- animation ---------------- */
  updateAnimation(dt) {
    const rig = this.rig;
    const speedFactor = clamp(this.moveSpeed / 7.2, 0, 1);
    const phase = this.walkPhase;
    const t = G.time;
    const idle = Math.sin(t * 1.9) * .5 + .5;
    const a = this.action;

    // base resets
    let torsoX = .02 + speedFactor * .12, torsoY = 0, torsoZ = 0;
    let headX = 0, headY = 0;
    let hipY = .92 + Math.sin(phase * 2) * .035 * speedFactor + (this.action ? 0 : Math.sin(t * 1.8) * .012);
    let armRx = 0, armRz = -.16, elbowR = .18;
    let armLx = 0, armLz = .16, elbowL = .3;
    let legLx = 0, legRx = 0, kneeL = .05, kneeR = .05;
    let modelRX = 0, modelZ = 0;
    let swordRotX = -.45, swordRotZ = 0;
    let bookRotX = .4, bookRotZ = -.4;

    if (this.dead) {
      this.rig.hip.position.y = .92;
      this.model.rotation.z = damp(this.model.rotation.z, 1.2, 6, dt);
      this.model.position.y = damp(this.model.position.y, .12, 6, dt);
      return;
    }
    this.model.rotation.z = damp(this.model.rotation.z, 0, 10, dt);
    this.model.position.y = damp(this.model.position.y, 0, 10, dt);
    this.model.rotation.x = damp(this.model.rotation.x, 0, 10, dt);

    // locomotion base
    if (this.grounded && speedFactor > .05) {
      const swing = Math.sin(phase);
      legLx = swing * .62 * speedFactor;
      legRx = -swing * .62 * speedFactor;
      kneeL = Math.max(0, -swing) * .9 * speedFactor + .05;
      kneeR = Math.max(0, swing) * .9 * speedFactor + .05;
      armRx = -swing * .36 * speedFactor - .1;
      armLx = swing * .14 * speedFactor;
      torsoY = swing * .08 * speedFactor;
      headY = -torsoY * .6;
      torsoX += .06 * speedFactor;
      modelRX = speedFactor * .06;
      if (speedFactor > .75) {
        armRx -= .25; elbowR = .55;
      }
    } else if (!this.grounded) {
      legLx = -.55; legRx = .4; kneeL = 1.0; kneeR = .5;
      armRx = -.6; armLx = -.3; armRz = -.7; armLz = .7;
    } else {
      // idle breathing
      armRx = Math.sin(t * 1.7) * .025 - .05;
      armRz = -.16 + Math.sin(t * 1.3) * .02;
      armLx = Math.sin(t * 1.7 + 1) * .02;
      torsoX += Math.sin(t * 1.8) * .012;
      headY = Math.sin(t * .6) * .05;
      swordRotX = -.5 + Math.sin(t * 1.4) * .025;
      // idle flourishes
    }

    // hit react
    if (this.hitReact > 0) {
      const k = this.hitReact / .35;
      torsoX -= .35 * k; headX -= .2 * k; modelZ = .08 * k;
    }

    // ---- action poses ----
    if (a) {
      const p = clamp(a.t / a.dur, 0, 1);
      if (a.name === 'attack1') {
        const wind = smoothstep(0, .3, p), hit = smoothstep(.3, .5, p), rec = smoothstep(.55, 1, p);
        torsoY = lerp(-.65, 1.05, hit) * (1 - rec * .5);
        armRx = lerp(-.5, -1.65, hit) - rec * .3;
        armRz = lerp(-1.3, .55, hit);
        elbowR = lerp(.7, .05, hit);
        swordRotX = -1.15; swordRotZ = lerp(-.7, .9, hit);
        armLx = .1; armLz = .3; elbowL = .7;
        modelRX = lerp(0, .08, hit);
        headY = torsoY * .35;
      } else if (a.name === 'attack2') {
        const raise = smoothstep(0, .36, p), slam = smoothstep(.4, .62, p), rec = smoothstep(.7, 1, p);
        armRx = lerp(-.4, -2.9, raise) + slam * 2.3;
        armRz = -.25;
        elbowR = lerp(.3, .05, raise) + slam * .1;
        swordRotX = lerp(-.4, .2, raise) - slam * 1.4;
        torsoX = lerp(.02, -.15, raise) + slam * .4;
        torsoY = lerp(0, -.2, raise) + slam * .1;
        modelRX = lerp(0, -.06, raise) + slam * .1;
        legLx = .18; legRx = -.25;
        armLx = .2; elbowL = .9;
      } else if (a.name === 'attack3') {
        const wind = smoothstep(0, .3, p), thrust = smoothstep(.32, .5, p), rec = smoothstep(.6, 1, p);
        armRx = lerp(-.3, -1.5, thrust);
        armRz = lerp(-.4, -.05, thrust);
        elbowR = lerp(.9, 0, thrust);
        swordRotX = lerp(-.9, -1.5, thrust);
        torsoY = lerp(.3, -.3, thrust);
        torsoX = .12 + thrust * .18;
        legLx = lerp(.1, .55, thrust); legRx = lerp(-.1, -.5, thrust);
        kneeL = .5; kneeR = .3;
        headY = torsoY * .4;
        modelRX = .1;
      } else if (a.name === 'heavy') {
        const wind = smoothstep(0, .32, p), spin = smoothstep(.32, .62, p), rec = smoothstep(.65, 1, p);
        torsoY = spin * Math.PI * 2.2;
        armRx = lerp(-.3, -1.6, spin);
        armRz = -1.35;
        elbowR = .05;
        swordRotX = -1.2; swordRotZ = 0;
        legLx = .3; legRx = -.35;
        torsoX = .15 + wind * -.15 + spin * .2;
        armLx = 0; armLz = .8;
        modelRX = .1;
      } else if (a.name === 'cast') {
        const prep = smoothstep(0, .4, p), release = smoothstep(.55, .85, p), rec = smoothstep(.85, 1, p);
        armLx = lerp(.1, -1.75, prep) + release * .5;
        armLz = .12;
        elbowL = lerp(.3, .15, prep);
        bookRotX = lerp(.4, -1.1, prep);
        torsoY = -.1 * prep;
        torsoX = lerp(.02, -.08, prep);
        headX = -.1;
        swordRotX = -.7;
        armRx = -.2;
        if (a.element === 'fire') armRx = lerp(-.2, -1.0, prep);
        if (a.element === 'ice') { armLx = -1.3; }
      }
    }

    // smooth apply
    const sp = this.action ? 26 : 14;
    rig.hip.position.y = damp(rig.hip.position.y, hipY, 18, dt);
    rig.torso.rotation.x = damp(rig.torso.rotation.x, torsoX, sp, dt);
    rig.torso.rotation.y = damp(rig.torso.rotation.y, torsoY, sp, dt);
    rig.torso.rotation.z = damp(rig.torso.rotation.z, torsoZ, sp, dt);
    rig.head.rotation.x = damp(rig.head.rotation.x, headX, 14, dt);
    rig.head.rotation.y = damp(rig.head.rotation.y, headY, 14, dt);
    rig.head.rotation.z = damp(rig.head.rotation.z, modelZ * .8, 10, dt);
    rig.armR.shoulder.rotation.x = damp(rig.armR.shoulder.rotation.x, armRx, sp, dt);
    rig.armR.shoulder.rotation.z = damp(rig.armR.shoulder.rotation.z, armRz, sp, dt);
    rig.armR.elbow.rotation.x = damp(rig.armR.elbow.rotation.x, elbowR, sp, dt);
    rig.armL.shoulder.rotation.x = damp(rig.armL.shoulder.rotation.x, armLx, sp, dt);
    rig.armL.shoulder.rotation.z = damp(rig.armL.shoulder.rotation.z, armLz, sp, dt);
    rig.armL.elbow.rotation.x = damp(rig.armL.elbow.rotation.x, elbowL, sp, dt);
    rig.legL.hip.rotation.x = damp(rig.legL.hip.rotation.x, legLx, 16, dt);
    rig.legR.hip.rotation.x = damp(rig.legR.hip.rotation.x, legRx, 16, dt);
    rig.legL.knee.rotation.x = damp(rig.legL.knee.rotation.x, kneeL, 16, dt);
    rig.legR.knee.rotation.x = damp(rig.legR.knee.rotation.x, kneeR, 16, dt);
    rig.sword.rotation.x = damp(rig.sword.rotation.x, swordRotX, sp, dt);
    rig.sword.rotation.z = damp(rig.sword.rotation.z, swordRotZ, sp, dt);
    rig.book.rotation.x = damp(rig.book.rotation.x, bookRotX, sp, dt);
    rig.book.rotation.z = damp(rig.book.rotation.z, bookRotZ, sp, dt);
    this.model.rotation.x = damp(this.model.rotation.x, modelRX, 12, dt);
    // gem pulse
    if (rig.pendant) rig.pendant.rotation.y += dt * 1.4;
    if (this.bookGlow) this.bookGlow.material.opacity = .09 + Math.sin(t * 2.4) * .035 + (a && a.name === 'cast' ? .22 : 0);

    // invulnerability blink
    this.group.visible = this.invuln > 0 && !this.dead ? (Math.floor(G.time * 22) % 2 === 0) : true;
    if (this.firstPerson) this.group.visible = false;
  }

  updateCape(dt) {
    const geo = this.rig.cape.geometry;
    const pos = geo.attributes.position;
    const base = this.rig.capeBase;
    const speed = clamp(this.moveSpeed / 7.2, 0, 1);
    const t = G.time;
    const swirl = this.action && this.action.name === 'heavy' ? 1.5 : 0;
    this.rig.cape.rotation.x = damp(this.rig.cape.rotation.x, .12 + speed * .55 + (this.grounded ? 0 : .3), 8, dt);
    for (let i = 0; i < pos.count; i++) {
      const bx = base[i * 3], by = base[i * 3 + 1];
      const v = clamp(-by / 1.2, 0, 1);
      const wave = Math.sin(t * (3 + speed * 4) + v * 5 + bx * 4) * (.04 + speed * .08 + swirl * .1) * v;
      pos.setX(i, bx + wave * .7);
      pos.setZ(i, Math.sin(t * 3.4 + v * 6) * .03 * v + v * v * speed * .18 + swirl * .2 * v);
      pos.setY(i, by + Math.sin(t * 4 + v * 5) * .02 * v - v * speed * .06);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    // scarf tail sway
    if (this.rig.strip1) this.rig.strip1.rotation.x = .2 + Math.sin(t * 2.6) * .1 + speed * .4;
  }

  updateFirstPerson(dt) {
    if (!this.firstPerson) { this.fp.visible = false; return; }
    this.fp.visible = true;
    const speed = this.moveSpeed;
    this.fpBob += dt * (speed > 5.5 ? 12 : 7) * (speed > .2 ? 1 : .25);
    const bob = Math.sin(this.fpBob) * (.008 + Math.min(speed, 7) * .0022);
    const sway = Math.cos(this.fpBob * .5) * .006;
    this.fp.position.set(sway, bob, 0);
    const t = G.time;
    let rArmX = .9 + Math.sin(this.fpBob * .5) * .015, rArmZ = -.35;
    let lArmX = .85 + Math.sin(this.fpBob * .5 + 1) * .012, lArmZ = .3;
    let swordRoll = 0, swordPitch = 0;
    const a = this.action;
    if (a) {
      const p = clamp(a.t / a.dur, 0, 1);
      if (a.name === 'attack1') {
        const hit = smoothstep(.25, .5, p);
        rArmX = lerp(.9, .2, hit); rArmZ = lerp(-.35, -1.5, hit);
        swordRoll = lerp(0, -2.2, hit);
      } else if (a.name === 'attack2') {
        const up = smoothstep(0, .35, p), down = smoothstep(.4, .65, p);
        rArmX = lerp(.9, 1.9, up) - down * 2.4;
        swordRoll = lerp(0, .5, up) - down * 1.4;
        swordPitch = lerp(0, -.8, up) + down * .4;
      } else if (a.name === 'attack3') {
        const th = smoothstep(.25, .5, p);
        rArmX = lerp(.9, .15, th); rArmZ = lerp(-.35, 0, th);
        swordPitch = lerp(0, -1.1, th);
        this.fpSword.position.z = lerp(-.4, -.78, th);
      } else if (a.name === 'heavy') {
        const spin = smoothstep(.2, .7, p);
        rArmX = .9 + Math.sin(spin * Math.PI * 2) * .8;
        rArmZ = -.35 - spin * 2;
        swordRoll = spin * -6;
      } else if (a.name === 'cast') {
        const prep = smoothstep(0, .45, p);
        lArmX = lerp(.85, 1.65, prep);
        lArmZ = lerp(.3, .05, prep);
        this.fpBookGlow.material.opacity = .12 + prep * .34;
        if (a.element === 'fire') rArmX = .9 - prep * .25;
        this.fpHandGlow.material.opacity = prep * .9;
        this.fpHandGlow.scale.setScalar(.3 + prep * 1.5);
      }
    } else {
      this.fpBookGlow.material.opacity = .11 + Math.sin(t * 2) * .035;
      this.fpHandGlow.material.opacity = this.fireCharging ? .8 : 0;
      if (this.fireCharging) this.fpHandGlow.scale.setScalar(.6 + this.fireChargeT * 1.4);
    }
    if (this.charging) {
      rArmX = -1.9; rArmZ = -.7;
      this.fpSword.rotation.z = -.9 + Math.sin(t * 30) * .02;
    } else {
      this.fpSword.rotation.z = damp(this.fpSword.rotation.z, -.82 + swordRoll, 20, dt);
    }
    this.fpRArm.rotation.x = damp(this.fpRArm.rotation.x, rArmX, 22, dt);
    this.fpRArm.rotation.z = damp(this.fpRArm.rotation.z, rArmZ, 22, dt);
    this.fpSword.rotation.x = damp(this.fpSword.rotation.x, -1.0 + swordPitch, 22, dt);
    this.fpLArm.rotation.x = damp(this.fpLArm.rotation.x, lArmX, 18, dt);
    this.fpLArm.rotation.z = damp(this.fpLArm.rotation.z, lArmZ, 18, dt);
    this.fpSword.position.z = damp(this.fpSword.position.z, -.4, 14, dt);
    // hand fire orb
    if (this.fireCharging) {
      const p = this.fpLArm.localToWorld(new THREE.Vector3(0, 0, -.55));
      if (Math.random() < dt * 20) this.effects.particles(p, 0xff9a3a, { count: 1, speed: .7, size: .09, life: .3, gravity: -.5, up: 1, spread: .2 });
    }
  }

  /* ================================================================== */
  /*  CAMERA                                                            */
  /* ================================================================== */
  updateCamera(dt, instant = false) {
    const cam = G.camera;
    if (!cam) return;
    if (this.firstPerson) {
      const eye = this.pos.clone();
      eye.y += 1.62 + Math.sin(this.fpBob) * .012 + (this.grounded ? 0 : .05);
      // sway with movement
      const right = new THREE.Vector3(Math.cos(this.viewYaw), 0, -Math.sin(this.viewYaw));
      eye.addScaledVector(right, Math.sin(this.fpBob * .5) * .012);
      cam.position.lerp(eye, instant ? 1 : .55);
      // camera forward must match getFacingDir()/movement (+Z at viewYaw 0)
      const e = new THREE.Euler(this.viewPitch, this.viewYaw + Math.PI, 0, 'YXZ');
      cam.quaternion.setFromEuler(e);
      cam.position.y = Math.max(cam.position.y, (G.groundAt ? G.groundAt(cam.position.x, cam.position.z) : heightAt(cam.position.x, cam.position.z)) + .35);
      return;
    }
    // target framing
    let desiredAngle = this.camAngle;
    let lookOffset = new THREE.Vector3(0, 1.2, 0);
    const locked = this.lockedTarget && !this.lockedTarget.dead;
    if (locked) {
      const toT = this.lockedTarget.group.position.clone().sub(this.pos);
      const yaw = Math.atan2(toT.x, toT.z);
      this.camAngle = damp(this.camAngle, yaw + Math.PI, 3, dt);
      desiredAngle = this.camAngle;
      lookOffset = new THREE.Vector3(0, 1.25, 0).addScaledVector(toT.normalize(), 1.1);
    }
    const dist = this.camDist;
    const height = Math.sin(this.camPitch) * dist + .9;
    const horiz = Math.cos(this.camPitch) * dist;
    const offset = new THREE.Vector3(Math.sin(this.camAngle) * horiz, height, Math.cos(this.camAngle) * horiz);
    const targetPos = this.pos.clone().add(offset);
    // keep the camera out of buildings and large round landmarks
    if (G.world && G.world.colliders) {
      const ox = targetPos.x - this.pos.x, oz = targetPos.z - this.pos.z;
      let tMin = 1;
      for (const c of G.world.colliders) {
        if (c.r < 1.9) continue;
        const R = c.r + .45;
        const fx = this.pos.x - c.x, fz = this.pos.z - c.z;
        const a = ox * ox + oz * oz;
        if (a < 1e-5) break;
        const b = 2 * (fx * ox + fz * oz);
        const cc = fx * fx + fz * fz - R * R;
        const disc = b * b - 4 * a * cc;
        if (disc <= 0) continue;
        const t = (-b - Math.sqrt(disc)) / (2 * a);
        if (t > 0 && t < tMin) tMin = t;
      }
      if (tMin < 1) {
        const t = Math.max(.18, tMin - .06);
        targetPos.x = this.pos.x + ox * t;
        targetPos.z = this.pos.z + oz * t;
      }
    }
    const ground = (G.groundAt ? G.groundAt(targetPos.x, targetPos.z) : heightAt(targetPos.x, targetPos.z));
    if (targetPos.y < ground + .7) targetPos.y = ground + .7;
    // camera smoothing
    if (instant) this.camPos.copy(targetPos);
    else this.camPos.lerp(targetPos, 1 - Math.exp(-dt * 9));
    const look = this.pos.clone().add(lookOffset);
    this.camLook.lerp(look, instant ? 1 : 1 - Math.exp(-dt * 12));
    cam.position.copy(this.camPos);
    if (this.shakeT > 0) {
      const k = this.shakeT;
      cam.position.x += rand(-1, 1) * this.shakeAmp * k;
      cam.position.y += rand(-1, 1) * this.shakeAmp * k;
      cam.position.z += rand(-1, 1) * this.shakeAmp * k;
    }
    cam.lookAt(this.camLook);
    // fov subtle run effect
    cam.fov = damp(cam.fov, this.moveSpeed > 5.5 ? 64 : 58, 4, dt);
    cam.updateProjectionMatrix();
  }

  setFirstPerson(v) {
    this.firstPerson = v;
    G.cameraMode = v ? 'first' : 'third';
    if (v) {
      this.viewYaw = this.group.rotation.y;
      this.viewPitch = 0;
      this.fp.visible = true;
      this.model.visible = false;
      this.group.visible = false;
      if (G.ui) G.ui.setCrosshair(true);
    } else {
      this.fp.visible = false;
      this.model.visible = true;
      this.group.visible = true;
      this.camAngle = this.group.rotation.y + Math.PI;
      if (G.ui) G.ui.setCrosshair(false);
    }
  }

  shake(time, amp) {
    this.shakeT = Math.max(this.shakeT, time * .09);
    this.shakeAmp = Math.max(this.shakeAmp, amp * .01);
  }

  /* called by main after damage-number positions */
  tickPending(dt) { this.updatePending(dt); }
}
