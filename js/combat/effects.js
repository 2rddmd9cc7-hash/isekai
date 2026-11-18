import * as THREE from 'three';
import { G } from '../core/state.js';
import { rand, clamp, TAU, makeGlowTexture, makeSoftTexture, makeRuneTexture, glowSprite } from '../core/utils.js';

const GLOW = makeGlowTexture('#ffffff');
const SOFT = makeSoftTexture();

function disposeMesh(obj) {
  if (!obj || obj.userData?.disposed) return;
  if (obj.userData) obj.userData.disposed = true;
  obj.traverse(o => {
    if (o.geometry && !o.geometry.userData?.shared) o.geometry.dispose();
    if (o.material) {
      if (Array.isArray(o.material)) o.material.forEach(m => { if (m.map && !m.map.userData?.shared) m.map.dispose(); m.dispose(); });
      else { if (o.material.map && !o.material.map.userData?.shared) o.material.map.dispose(); o.material.dispose(); }
    }
  });
}

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.effects = [];
    this.projectiles = [];
    this.runeTex = {
      fire: makeRuneTexture('#ffb05c', '#ffe6a0'),
      bolt: makeRuneTexture('#ffe98e', '#fff6d0'),
      ice: makeRuneTexture('#8fe9ff', '#dffcff'),
      wind: makeRuneTexture('#9df0c0', '#e0fff0'),
      dark: makeRuneTexture('#b47cff', '#e6d0ff'),
      holy: makeRuneTexture('#ffd77a', '#fff2c8'),
    };
    this.sharedGlow = GLOW;
    this.sharedSoft = SOFT;
    // ---- particle system pool: reuses geometry/material/Points objects.
    // Combat used to build thousands of short-lived objects per fight.
    this.particlePool = [];
    this.maxParticleSystems = 34;
    this.activeParticles = [];
    this.sharedMaps = new Set([GLOW, SOFT, ...Object.values(this.runeTex)]);
    this.stats = { particles: 0, pooled: 0 };
  }

  /* ------------------------------------------------------------------ */
  /*  pooled particle bursts                                            */
  /* ------------------------------------------------------------------ */
  acquireParticles(count) {
    const cap = Math.max(24, Math.min(120, count));
    let slot = this.particlePool.find(p => !p.active && p.capacity >= cap);
    if (!slot && this.particlePool.length < this.maxParticleSystems) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(cap * 3), 3));
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(cap * 3), 3));
      const mat = new THREE.PointsMaterial({
        size: .13, vertexColors: true, transparent: true, opacity: 1, depthWrite: false,
        blending: THREE.AdditiveBlending, map: SOFT, sizeAttenuation: true,
      });
      const pts = new THREE.Points(geo, mat);
      pts.frustumCulled = false;
      pts.renderOrder = 5;
      pts.visible = false;
      this.scene.add(pts);
      slot = {
        points: pts, geo, mat, capacity: cap, count: 0, active: false,
        vel: new Float32Array(cap * 3), age: 0, life: 1, gravity: 0, drag: .5,
      };
      this.particlePool.push(slot);
    }
    if (!slot) {
      // pool exhausted: steal the oldest active slot instead of allocating
      slot = this.activeParticles[0] || this.particlePool[0];
      if (!slot) return null;
      slot.active = false;
    }
    return slot;
  }

  releaseParticles(slot) {
    slot.active = false;
    slot.points.visible = false;
    const i = this.activeParticles.indexOf(slot);
    if (i >= 0) this.activeParticles.splice(i, 1);
  }

  add(obj, life, update) {
    this.effects.push({ obj, life, age: 0, update });
    return obj;
  }

  /* ---------------- particles (pooled) ---------------- */
  particles(position, color, opts = {}) {
    const reqCount = opts.count ?? 18;
    if (reqCount <= 0) return null;
    const slot = this.acquireParticles(reqCount);
    if (!slot) return null;
    const count = Math.min(reqCount, slot.capacity);
    const speed = opts.speed ?? 3;
    const size = opts.size ?? 0.13;
    const gravity = opts.gravity ?? 4;
    const life = Math.max(.05, opts.life ?? .8);
    const spread = opts.spread ?? 1;
    const up = opts.up ?? 1;
    const posArr = slot.geo.attributes.position.array;
    const colorArr = slot.geo.attributes.color.array;
    const vel = slot.vel;
    const c = new THREE.Color(color);
    const c2 = new THREE.Color(opts.color2 ?? color);
    for (let i = 0; i < count; i++) {
      posArr[i * 3] = position.x + rand(-.15, .15) * spread;
      posArr[i * 3 + 1] = position.y + rand(-.1, .2) * spread;
      posArr[i * 3 + 2] = position.z + rand(-.15, .15) * spread;
      const a = rand(0, TAU), r = rand(.2, 1) * speed;
      vel[i * 3] = Math.cos(a) * r;
      vel[i * 3 + 1] = rand(.2, 1) * speed * up;
      vel[i * 3 + 2] = Math.sin(a) * r;
      const cc = c.clone().lerp(c2, Math.random());
      colorArr[i * 3] = cc.r; colorArr[i * 3 + 1] = cc.g; colorArr[i * 3 + 2] = cc.b;
    }
    slot.geo.setDrawRange(0, count);
    slot.geo.attributes.position.needsUpdate = true;
    slot.geo.attributes.color.needsUpdate = true;
    slot.mat.size = size;
    slot.mat.opacity = 1;
    slot.mat.blending = opts.additive === false ? THREE.NormalBlending : THREE.AdditiveBlending;
    slot.mat.needsUpdate = true;
    slot.points.visible = true;
    slot.count = count;
    slot.age = 0;
    slot.life = life;
    slot.gravity = gravity;
    slot.drag = opts.drag ?? .5;
    slot.active = true;
    if (this.activeParticles.indexOf(slot) < 0) this.activeParticles.push(slot);
    this.stats.particles++;
    return slot.points;
  }

  updateParticles(dt) {
    for (let s = this.activeParticles.length - 1; s >= 0; s--) {
      const slot = this.activeParticles[s];
      if (!slot || !slot.active) { this.activeParticles.splice(s, 1); continue; }
      slot.age += dt;
      if (slot.age >= slot.life) { this.releaseParticles(slot); continue; }
      const arr = slot.geo.attributes.position.array;
      const vel = slot.vel;
      const drag = 1 - slot.drag * dt;
      for (let i = 0, n = slot.count * 3; i < n; i += 3) {
        vel[i + 1] -= slot.gravity * dt;
        vel[i] *= drag; vel[i + 1] *= drag; vel[i + 2] *= drag;
        arr[i] += vel[i] * dt;
        arr[i + 1] += vel[i + 1] * dt;
        arr[i + 2] += vel[i + 2] * dt;
      }
      slot.geo.attributes.position.needsUpdate = true;
      slot.mat.opacity = Math.pow(1 - slot.age / slot.life, 1.4);
    }
  }

  dust(position, color = 0xd8c49a, count = 10) {
    this.particles(position, color, { count, speed: 1.4, size: .22, gravity: .6, life: .7, up: .7, additive: false, spread: 1.2 });
  }

  /* ---------------- slashes ---------------- */
  slash(position, angle, opts = {}) {
    const color = opts.color ?? 0xfff1c2;
    const radius = opts.radius ?? 2.4;
    const vertical = opts.vertical;
    const flip = opts.flip ? -1 : 1;
    const geo = new THREE.RingGeometry(radius * .32, radius, 22, 1, vertical ? -0.9 : -1.15, 2.3);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .95, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(position); mesh.position.y += opts.y ?? 1.15;
    if (vertical) {
      mesh.rotation.set(0, angle, Math.PI / 2 * .75 * flip);
      mesh.rotation.x = -.25;
    } else {
      mesh.rotation.x = -Math.PI / 2 + (opts.tilt ?? .18);
      mesh.rotation.z = -angle;
    }
    mesh.renderOrder = 6;
    this.scene.add(mesh);
    const obj = this.add(mesh, opts.life ?? .24, (age, dt) => {
      const t = age / (opts.life ?? .24);
      mesh.scale.setScalar(1 + t * .28);
      mesh.position.y += dt * (vertical ? -.3 : .1);
      mat.opacity = (1 - t) * .95;
    });
    // trailing sparks
    this.particles(mesh.position, color, { count: 9, speed: 2.2, size: .11, life: .4, gravity: 1, up: .8 });
    if (opts.once) obj.userData.once = true;
    return obj;
  }

  hitSpark(position, color = 0xfff0c0, crit = false) {
    this.particles(position, color, { count: crit ? 26 : 14, speed: crit ? 5 : 3.4, size: crit ? .18 : .13, life: .5, gravity: 6, up: 1.2 });
    const s = glowSprite(color, crit ? 2.6 : 1.5, GLOW);
    s.material.opacity = .9;
    s.position.copy(position);
    this.scene.add(s);
    this.add(s, .16, (age) => { const t = age / .16; s.scale.setScalar((crit ? 2.6 : 1.5) * (1 + t * 1.5)); s.material.opacity = .9 * (1 - t); });
    if (crit) {
      const ring = this.ring(position, color, .4, 2.2, .3, true);
    }
  }

  ring(position, color = 0xffd88a, from = .3, to = 2.5, life = .5, horizontal = true) {
    const geo = new THREE.RingGeometry(.78, 1, 40);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .9, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(position);
    if (horizontal) mesh.rotation.x = -Math.PI / 2;
    mesh.renderOrder = 6;
    this.scene.add(mesh);
    this.add(mesh, life, (age) => {
      const t = age / life;
      const r = from + (to - from) * Math.min(1, t * 1.4);
      mesh.scale.setScalar(r);
      mat.opacity = (1 - t) * .9;
    });
    return mesh;
  }

  shockwave(position, color = 0xffd88a, radius = 5, life = .55) {
    this.ring(position, color, .2, radius, life, true);
    const ring2 = this.ring(position, 0xffffff, .1, radius * .75, life * .8, true);
    ring2.position.y += .05;
    this.particles(position, color, { count: 24, speed: radius * 1.4, size: .2, life: .55, gravity: 1, up: .3, spread: 1.5 });
  }

  /* ---------------- magic circles ---------------- */
  magicCircle(position, element = 'fire', size = 3.2, duration = .8, follow = null) {
    const mat = new THREE.MeshBasicMaterial({
      map: this.runeTex[element] || this.runeTex.fire, transparent: true, opacity: .9,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.copy(position); mesh.position.y += .06;
    mesh.renderOrder = 3;
    this.scene.add(mesh);
    this.add(mesh, duration, (age, dt) => {
      const t = age / duration;
      mesh.rotation.z += dt * 1.8;
      const s = .2 + Math.min(1, age * 6) * .8;
      mesh.scale.setScalar(s);
      mat.opacity = (1 - t) * .9;
      if (follow) { mesh.position.x = follow.x; mesh.position.z = follow.z; mesh.position.y = follow.y + .06; }
    });
    return mesh;
  }

  /* ---------------- fire ---------------- */
  fireCharge(pos, time = .6) {
    const s = glowSprite(0xffa04a, .5, GLOW);
    s.position.copy(pos);
    this.scene.add(s);
    this.add(s, time, (age) => {
      const t = age / time;
      s.scale.setScalar(.5 + t * 1.7);
      s.material.opacity = .8 * (1 - t * .3);
    });
    this.particles(pos, 0xff9a3a, { count: 10, speed: 1.2, size: .12, life: .4, gravity: -1, up: 1, spread: .5 });
  }

  fireball(from, target, opts = {}) {
    const group = new THREE.Group();
    const core = new THREE.Mesh(new THREE.SphereGeometry(.27, 12, 10), new THREE.MeshBasicMaterial({ color: 0xffe2a0 }));
    const outer = new THREE.Mesh(new THREE.SphereGeometry(.44, 12, 10), new THREE.MeshBasicMaterial({ color: 0xff7a2a, transparent: true, opacity: .42, blending: THREE.AdditiveBlending, depthWrite: false }));
    const glow = glowSprite(0xff9a4a, 1.7, GLOW);
    group.add(core, outer, glow);
    group.position.copy(from);
    this.scene.add(group);
    const speed = opts.speed ?? 20;
    const trailColor = opts.color ?? 0xff8a3a;
    let alive = true;
    const proj = {
      mesh: group, life: opts.life ?? 2.2, age: 0, trail: 0,
      update: (dt) => {
        proj.age += dt;
        const targetPos = typeof target === 'function' ? target() : target;
        if (!targetPos) { cleanup(false); return; }
        const tp = targetPos.clone ? targetPos.clone() : new THREE.Vector3(targetPos.x, targetPos.y, targetPos.z);
        tp.y += .9;
        const d = tp.clone().sub(group.position);
        const dist = d.length();
        group.position.addScaledVector(d.normalize(), speed * dt);
        group.rotation.y += dt * 8;
        proj.trail -= dt;
        if (proj.trail <= 0) {
          proj.trail = .025;
          this.particles(group.position, trailColor, { count: 2, speed: .7, size: .17, life: .34, gravity: -.5, up: 1, spread: .3, color2: 0xffe0a0 });
        }
        if (dist < .7 || proj.age > proj.life) { cleanup(true); }
      },
    };
    const cleanup = (hit) => {
      if (!alive) return; alive = false;
      const p = group.position.clone();
      this.scene.remove(group);
      disposeMesh(group);
      if (hit) {
        this.explosion(p, opts.color ?? 0xff9a3a, opts.scale ?? 1);
        opts.onHit && opts.onHit(p);
      }
      const idx = this.projectiles.indexOf(proj); if (idx >= 0) this.projectiles.splice(idx, 1);
    };
    this.projectiles.push(proj);
    return proj;
  }

  explosion(pos, color = 0xff9a3a, scale = 1) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xffe0a0, transparent: true, opacity: .95, blending: THREE.AdditiveBlending, depthWrite: false });
    const core = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), mat);
    core.position.copy(pos); core.position.y += .7;
    core.renderOrder = 6;
    this.scene.add(core);
    this.add(core, .38, (age) => {
      const t = age / .38;
      core.scale.setScalar((.4 + t * 3) * scale);
      mat.opacity = (1 - t) * .9;
    });
    const outer = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .5, blending: THREE.AdditiveBlending, depthWrite: false }));
    outer.position.copy(core.position); outer.renderOrder = 5;
    this.scene.add(outer);
    this.add(outer, .55, (age) => { const t = age / .55; outer.scale.setScalar((.5 + t * 4.4) * scale); outer.material.opacity = .5 * (1 - t); });
    this.particles(pos, color, { count: 38, speed: 6 * scale, size: .22, life: .8, gravity: 5, up: 1.1, spread: 1.2, color2: 0xffeeb0 });
    this.ring(pos, color, .4, 5 * scale, .5, true);
    this.particles(pos, 0x6e5a4a, { count: 14, speed: 3.5 * scale, size: .4, life: 1.2, gravity: 2.2, up: .9, additive: false, spread: 1.5, color2: 0x2d2824 });
    G.player && G.player.shake && G.player.shake(.25, 3);
    if (G.audio) G.audio.sfx('explosion');
  }

  /* ---------------- lightning ---------------- */
  lightning(target, opts = {}) {
    const p = target.clone ? target.clone() : new THREE.Vector3(target.x, target.y, target.z);
    const ground = new THREE.Vector3(p.x, p.y, p.z);
    const group = new THREE.Group();
    const top = new THREE.Vector3(p.x + rand(-4, 4), p.y + 28, p.z + rand(-4, 4));
    const segments = 22;
    const points = [];
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const pt = top.clone().lerp(ground, t);
      pt.x += rand(-1.4, 1.4) * (1 - Math.abs(t - .5) * 1.5);
      pt.z += rand(-1.4, 1.4) * (1 - Math.abs(t - .5) * 1.5);
      points.push(pt);
    }
    points[segments].copy(ground);
    for (const color of [0xfff6c0, 0xffd24a]) {
      const g = new THREE.BufferGeometry().setFromPoints(points);
      const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity: color === 0xfff6c0 ? 1 : .6, blending: THREE.AdditiveBlending, depthWrite: false }));
      l.renderOrder = 8;
      group.add(l);
    }
    // branches
    for (let b = 0; b < 4; b++) {
      const i = Math.floor(rand(3, segments - 4));
      const start = points[i].clone();
      const bp = [start];
      let dir = new THREE.Vector3(rand(-1, 1), -rand(.3, 1), rand(-1, 1)).normalize();
      for (let k = 0; k < 5; k++) { start.addScaledVector(dir, rand(.7, 1.6)); start.x += rand(-.4, .4); bp.push(start.clone()); }
      const g = new THREE.BufferGeometry().setFromPoints(bp);
      group.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xfff2a8, transparent: true, opacity: .7, blending: THREE.AdditiveBlending, depthWrite: false })));
    }
    const light = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, color: 0xfff3b0, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false }));
    light.scale.setScalar(8); light.position.copy(ground).add(new THREE.Vector3(0, 4, 0));
    group.add(light);
    this.scene.add(group);
    this.add(group, .3, (age) => {
      const t = age / .3;
      group.children.forEach(c => { if (c.material) c.material.opacity = (1 - t) * (c.type === 'Line' ? .9 : .85); });
    });
    this.ring(ground, 0xfff0a0, .5, 4.5, .5, true);
    this.particles(ground, 0xffe86a, { count: 30, speed: 5, size: .16, life: .7, gravity: 7, up: 1.2, spread: 1 });
    this.particles(ground, 0xb08aff, { count: 12, speed: 2, size: .12, life: .5, gravity: -1, up: 1 });
    if (G.ui) G.ui.screenFlash(.35, 0xfff1c0);
    if (G.audio) G.audio.sfx('bolt');
    if (G.player) G.player.shake(.35, 5);
    return group;
  }

  /* ---------------- ice ---------------- */
  iceShard(from, target, opts = {}) {
    const group = new THREE.Group();
    const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(.32, 0), new THREE.MeshBasicMaterial({ color: 0xc8f8ff }));
    crystal.scale.set(.9, 1.8, .9);
    const glow = glowSprite(0x8fe9ff, 2.2, GLOW);
    group.add(crystal, glow);
    group.position.copy(from);
    this.scene.add(group);
    const speed = opts.speed ?? 26;
    let alive = true;
    const proj = {
      mesh: group, life: 1.6, age: 0, trail: 0,
      update: (dt) => {
        proj.age += dt;
        const targetPos = typeof target === 'function' ? target() : target;
        if (!targetPos) { cleanup(false); return; }
        const tp = targetPos.clone ? targetPos.clone() : new THREE.Vector3(targetPos.x, targetPos.y, targetPos.z);
        tp.y += .9;
        const d = tp.clone().sub(group.position);
        const dist = d.length();
        group.position.addScaledVector(d.normalize(), speed * dt);
        group.rotation.y += dt * 12;
        proj.trail -= dt;
        if (proj.trail <= 0) {
          proj.trail = .03;
          this.particles(group.position, 0xa9f0ff, { count: 2, speed: 1, size: .13, life: .4, gravity: .2, up: .5, spread: .4, color2: 0xffffff });
        }
        if (dist < .7 || proj.age > proj.life) cleanup(true);
      },
    };
    const cleanup = (hit) => {
      if (!alive) return; alive = false;
      const p = group.position.clone();
      this.scene.remove(group); disposeMesh(group);
      if (hit) { this.iceBurst(p); opts.onHit && opts.onHit(p); }
      const idx = this.projectiles.indexOf(proj); if (idx >= 0) this.projectiles.splice(idx, 1);
    };
    this.projectiles.push(proj);
    return proj;
  }

  iceBurst(pos) {
    this.particles(pos, 0xa9f0ff, { count: 30, speed: 4.5, size: .17, life: .9, gravity: 4, up: 1.1, spread: 1, color2: 0xffffff });
    for (let i = 0; i < 7; i++) {
      const shard = new THREE.Mesh(new THREE.ConeGeometry(.12, .6, 4), new THREE.MeshBasicMaterial({ color: 0xd8fbff, transparent: true, opacity: .9 }));
      shard.position.copy(pos); shard.position.y += .7;
      const a = rand(0, TAU), s = rand(2, 5);
      const v = new THREE.Vector3(Math.cos(a) * s, rand(2, 6), Math.sin(a) * s);
      this.scene.add(shard);
      const life = .8;
      this.add(shard, life, (age, dt) => {
        v.y -= 9 * dt; shard.position.addScaledVector(v, dt);
        shard.rotation.x += dt * 6; shard.rotation.z += dt * 4;
        shard.material.opacity = 1 - age / life;
      });
    }
    this.ring(pos, 0xb8f4ff, .3, 2.8, .45, true);
  }

  freezeShell(entity, duration = 3) {
    const g = new THREE.Group();
    const color = 0xbfefff;
    for (let i = 0; i < 9; i++) {
      const shard = new THREE.Mesh(new THREE.ConeGeometry(rand(.18, .35), rand(.6, 1.5), 4), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .45, depthWrite: false }));
      const a = rand(0, TAU), r = rand(.3, .7);
      shard.position.set(Math.cos(a) * r, rand(.2, 1.5), Math.sin(a) * r);
      shard.rotation.set(rand(-.4, .4), rand(0, 3), rand(0, 1)); g.add(shard);
    }
    const shell = new THREE.Mesh(new THREE.SphereGeometry(.75, 10, 8), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .2, depthWrite: false }));
    shell.position.y = .8; shell.scale.set(1, 1.2, 1); g.add(shell);
    entity.group.add(g);
    g.position.y = 0;
    entity.frozen = true;
    const ttl = duration;
    const tick = (age) => { if (age >= ttl) { g.removeFromParent(); entity.frozen = false; } };
    this.add(g, ttl, tick);
    return g;
  }

  /* ---------------- misc ---------------- */
  heal(pos) {
    this.particles(pos, 0x9dffb8, { count: 26, speed: 1.8, size: .18, life: 1, gravity: -1.4, up: 2, spread: 1.1, color2: 0x6fffe0 });
    this.ring(pos, 0x9dffb8, .3, 2.2, .7, true);
  }

  levelUp(pos) {
    this.ring(pos, 0xffe7a0, .4, 5, .9, true);
    this.particles(pos, 0xffe7a0, { count: 40, speed: 3.5, size: .2, life: 1.3, gravity: -2.3, up: 2.2, spread: 1.2, color2: 0x9dffb8 });
    if (G.ui) G.ui.screenFlash(.3, 0xffe7a0);
  }

  teleport(pos, color = 0xb490ff) {
    this.particles(pos, color, { count: 30, speed: 4, size: .16, life: .9, gravity: -1, up: 1.4, spread: 1 });
    this.ring(pos, color, .2, 3, .6, true);
  }

  arrow(from, target, opts = {}) {
    const group = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(.035, .035, 1.1, 4), new THREE.MeshBasicMaterial({ color: 0x6b4a2c }));
    shaft.rotation.x = Math.PI / 2;
    const tip = new THREE.Mesh(new THREE.ConeGeometry(.08, .25, 4), new THREE.MeshBasicMaterial({ color: 0xc8d4e0 }));
    tip.rotation.x = Math.PI / 2; tip.position.z = .62;
    const fletch = new THREE.Mesh(new THREE.PlaneGeometry(.22, .3), new THREE.MeshBasicMaterial({ color: 0xd85a4a, side: THREE.DoubleSide }));
    fletch.position.z = -.5;
    group.add(shaft, tip, fletch);
    const start = from.clone(); group.position.copy(start);
    const dest = target.clone();
    const dir = dest.clone().sub(start);
    const dist = dir.length();
    group.lookAt(dest);
    this.scene.add(group);
    const speed = opts.speed ?? 22;
    let age = 0;
    this.add(group, Math.min(2.4, dist / speed + .2), (a, dt) => {
      age += dt;
      group.position.addScaledVector(dir.clone().normalize(), speed * dt);
      if (group.position.distanceTo(dest) < .6 || age > dist / speed + .1) {
        if (G.audio) G.audio.sfx('arrow');
        opts.onHit && opts.onHit();
        this.particles(group.position, 0xd9c49a, { count: 6, speed: 1.2, size: .08, life: .35, gravity: 3, additive: false });
        this.scene.remove(group); disposeMesh(group);
        group.userData.dead = true;
      }
    });
    return group;
  }

  telegraph(position, radius, duration, color = 0xff5a4a) {
    const group = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.RingGeometry(.72, 1, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .55, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
    ring.rotation.x = -Math.PI / 2; group.add(ring);
    const fill = new THREE.Mesh(new THREE.CircleGeometry(1, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .16, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
    fill.rotation.x = -Math.PI / 2; group.add(fill);
    group.position.copy(position); group.position.y += .06;
    this.scene.add(group);
    this.add(group, duration, (age) => {
      const t = Math.min(1, age / duration);
      group.scale.setScalar((.25 + t * .75) * radius);
      ring.material.opacity = .35 + Math.sin(age * 25) * .18;
      fill.material.opacity = .08 + t * .2;
    });
    return group;
  }

  bossSlam(position, radius) {
    this.shockwave(position, 0xffb36a, radius, .65);
    this.particles(position, 0xc9a06a, { count: 40, speed: 6, size: .3, life: 1.1, gravity: 5, up: 1.1, additive: false, spread: 1.6 });
    for (let i = 0; i < 8; i++) {
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(rand(.15, .4), 0), new THREE.MeshLambertMaterial({ color: 0x6b5d55 }));
      rock.position.copy(position); rock.position.y += .2;
      const a = rand(0, TAU), v = new THREE.Vector3(Math.cos(a) * rand(3, 7), rand(3, 7), Math.sin(a) * rand(3, 7));
      this.scene.add(rock);
      this.add(rock, 1, (age, dt) => { v.y -= 14 * dt; rock.position.addScaledVector(v, dt); rock.rotation.x += dt * 4; });
    }
    if (G.audio) G.audio.sfx('slam');
    if (G.player) G.player.shake(.5, 8);
  }

  releaseObject(obj) {
    if (!obj) return;
    if (obj.userData && obj.userData.disposed) return;
    if (obj.userData) obj.userData.disposed = true;
    if (obj.parent) obj.parent.remove(obj);
    obj.traverse(o => {
      if (o.geometry && !o.geometry.userData?.shared) o.geometry.dispose();
      if (!o.material) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (!m || m.userData?.shared) continue;
        // never dispose the shared glow/soft/rune atlas textures
        if (m.map && !this.sharedMaps.has(m.map)) m.map.dispose();
        m.dispose();
      }
    });
  }

  update(dt) {
    this.updateParticles(dt);
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i];
      e.age += dt;
      try { if (e.update) e.update(e.age, dt); } catch (err) { console.warn('[Effects] update failed', err); e.age = e.life; }
      if (e.age >= e.life) {
        if (!e.obj.userData?.keep) this.releaseObject(e.obj);
        else if (e.obj.parent) e.obj.parent.remove(e.obj);
        this.effects.splice(i, 1);
      }
    }
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      try { p.update(dt); } catch (err) { console.warn('[Effects] projectile failed', err); if (p.cleanup) p.cleanup(false); }
    }
  }

  /* ------------------------------------------------------------------ */
  /*  New elemental language                                            */
  /* ------------------------------------------------------------------ */
  boltOrb(from, target, opts = {}) {
    const group = new THREE.Group();
    const core = new THREE.Mesh(new THREE.SphereGeometry(.2, 10, 8), new THREE.MeshBasicMaterial({ color: 0xfff8d0 }));
    const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(.34, 0), new THREE.MeshBasicMaterial({ color: 0xffe86a, transparent: true, opacity: .55, blending: THREE.AdditiveBlending, depthWrite: false }));
    const glow = glowSprite(0xffe86a, 1.7, GLOW);
    group.add(core, shell, glow);
    group.position.copy(from);
    this.scene.add(group);
    const speed = opts.speed ?? 30;
    const life = opts.life ?? 1.4;
    let age = 0;
    const proj = {
      mesh: group,
      update: (dt) => {
        age += dt;
        const tp = typeof target === 'function' ? target() : target;
        if (!tp) { cleanup(false); return; }
        const d = new THREE.Vector3(tp.x, (tp.y ?? from.y) + .9, tp.z).sub(group.position);
        const dist = d.length();
        group.position.addScaledVector(d.normalize(), speed * dt);
        shell.rotation.x += dt * 14; shell.rotation.y += dt * 9;
        if (Math.random() < dt * 40) this.particles(group.position, 0xffe86a, { count: 2, speed: .8, size: .12, life: .25, gravity: 0, up: .3, spread: .25 });
        if (dist < .8 || age > life) cleanup(true);
      },
      cleanup: (hit) => { /* replaced below */ },
    };
    const cleanup = (hit) => {
      if (proj.done) return; proj.done = true;
      const p = group.position.clone();
      this.releaseObject(group);
      if (hit) {
        this.particles(p, 0xfff0a0, { count: 26, speed: 5, size: .14, life: .5, gravity: 3, up: .7 });
        this.ring(p, 0xffe86a, .2, 2.2, .3, true);
        opts.onHit && opts.onHit(p);
      }
      const idx = this.projectiles.indexOf(proj); if (idx >= 0) this.projectiles.splice(idx, 1);
    };
    proj.cleanup = cleanup;
    this.projectiles.push(proj);
    return proj;
  }

  windBlade(from, target, opts = {}) {
    const group = new THREE.Group();
    const geo = new THREE.RingGeometry(.42, .72, 22, 1, -.9, 1.8);
    const mat = new THREE.MeshBasicMaterial({ color: opts.color ?? 0xb8ffe0, transparent: true, opacity: .9, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false });
    const blade = new THREE.Mesh(geo, mat);
    blade.rotation.x = -Math.PI / 2;
    group.add(blade);
    group.position.copy(from);
    this.scene.add(group);
    const speed = opts.speed ?? 26;
    let age = 0;
    const proj = {
      mesh: group,
      update: (dt) => {
        age += dt;
        const tp = typeof target === 'function' ? target() : target;
        if (!tp) { cleanup(false); return; }
        const d = new THREE.Vector3(tp.x, (tp.y ?? from.y) + .9, tp.z).sub(group.position);
        const dist = d.length();
        group.position.addScaledVector(d.normalize(), speed * dt);
        blade.rotation.z += dt * 9;
        group.rotation.y += dt * 4;
        if (Math.random() < dt * 30) this.particles(group.position, 0xc8ffe0, { count: 1, speed: 1.2, size: .1, life: .3, gravity: 0, up: .4, spread: .3 });
        if (dist < .8 || age > 1.4) cleanup(true);
      },
      cleanup: null,
    };
    const cleanup = (hit) => {
      if (proj.done) return; proj.done = true;
      const p = group.position.clone();
      this.releaseObject(group);
      if (hit) {
        this.particles(p, 0xd8ffe8, { count: 20, speed: 4, size: .13, life: .5, gravity: 2, up: .7 });
        this.ring(p, 0xb8ffe0, .3, 2.4, .3, true);
        opts.onHit && opts.onHit(p);
      }
      const idx = this.projectiles.indexOf(proj); if (idx >= 0) this.projectiles.splice(idx, 1);
    };
    proj.cleanup = cleanup;
    this.projectiles.push(proj);
    return proj;
  }

  frostNova(pos, radius = 4.8, color = 0xbfefff) {
    this.ring(pos, color, .3, radius, .6, true);
    this.ring(pos, 0xffffff, .2, radius * .7, .42, true);
    this.particles(pos, color, { count: 34, speed: radius * 1.1, size: .18, life: .8, gravity: 2.4, up: .8, spread: 1.2, color2: 0xffffff });
    for (let i = 0; i < 6; i++) {
      const shard = new THREE.Mesh(new THREE.ConeGeometry(rand(.08, .2), rand(.5, 1.2), 4), new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: .75, depthWrite: false }));
      const a = i / 6 * TAU;
      shard.position.copy(pos).add(new THREE.Vector3(Math.cos(a) * 1.1, .4, Math.sin(a) * 1.1));
      shard.rotation.set(rand(-.3, .3), a, rand(-.3, .3));
      this.scene.add(shard);
      this.add(shard, .55, (age) => {
        shard.position.y += .012;
        shard.material.opacity = .75 * (1 - age / .55);
        shard.rotation.y += .02;
      });
    }
  }

  meteorStrike(pos, radius = 3.8, color = 0xff7a2a, onHit = null) {
    const target = pos.clone();
    const marker = this.telegraph(target, radius, .55, 0xff8a4a);
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(.65, 0), new THREE.MeshLambertMaterial({ color: 0x5a3a2a, emissive: 0x7a2200, emissiveIntensity: .7 }));
    const glow = glowSprite(color, 3.4, GLOW); glow.material.opacity = .7;
    const g = new THREE.Group(); g.add(rock, glow);
    g.position.copy(target).add(new THREE.Vector3(rand(-2, 2), 26, rand(-2, 2)));
    this.scene.add(g);
    let t = 0;
    const dur = .55;
    this.add(g, dur + .1, (age, dt) => {
      t += dt;
      const k = Math.min(1, t / dur);
      g.position.x += (target.x - g.position.x) * k * dt * 8;
      g.position.z += (target.z - g.position.z) * k * dt * 8;
      g.position.y = target.y + 26 * (1 - k);
      rock.rotation.x += dt * 7; rock.rotation.z += dt * 4;
      if (Math.random() < dt * 40) this.particles(g.position, color, { count: 2, speed: 1, size: .22, life: .35, gravity: -1, up: .2, spread: .5 });
      if (k >= 1 && !g.userData.hit) {
        g.userData.hit = true;
        this.releaseObject(g);
        this.explosion(target, color, 1.35);
        onHit && onHit(target);
      }
    });
    return marker;
  }

  chainLightning(points, color = 0xffe86a) {
    if (!points || points.length < 2) return;
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i], b = points[i + 1];
      const mid = a.clone().lerp(b, .5).add(new THREE.Vector3(rand(-1.2, 1.2), rand(.4, 1.4), rand(-1.2, 1.2)));
      const geo = new THREE.BufferGeometry().setFromPoints([a, mid, b]);
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: .95, blending: THREE.AdditiveBlending, depthWrite: false }));
      line.renderOrder = 8;
      this.scene.add(line);
      this.add(line, .22, (age) => { line.material.opacity = .95 * (1 - age / .22); });
      this.particles(mid, color, { count: 8, speed: 3, size: .12, life: .3, gravity: 2, up: .6, spread: .4 });
    }
    this.ring(points[points.length - 1].clone(), color, .2, 2.2, .3, true);
  }

  cyclone(pos, radius = 3.6, color = 0xa8f0d0, duration = 1.3) {
    const group = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const torus = new THREE.Mesh(
        new THREE.TorusGeometry(radius * (.45 + i * .18), .06, 5, 28),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .55 - i * .1, blending: THREE.AdditiveBlending, depthWrite: false })
      );
      torus.rotation.x = Math.PI / 2;
      torus.position.y = .45 + i * .55;
      group.add(torus);
    }
    group.position.copy(pos);
    this.scene.add(group);
    this.add(group, duration, (age, dt) => {
      group.rotation.y += dt * 7;
      group.children.forEach((c, i) => { c.rotation.z += dt * (2 + i); c.scale.setScalar(1 + Math.sin(age * 5 + i) * .05); });
      if (Math.random() < dt * 26) this.particles(group.position.clone().add(new THREE.Vector3(rand(-2, 2), rand(.2, 2), rand(-2, 2))), color, { count: 1, speed: .5, size: .12, life: .4, gravity: 0, up: .3, spread: .3 });
    });
    this.ring(pos, color, .3, radius, .5, true);
  }

  gust(pos, yaw, range = 7, color = 0xb8ffe0) {
    for (let i = 0; i < 4; i++) {
      const geo = new THREE.RingGeometry(.7 + i * .35, 1.1 + i * .35, 22, 1, -1.1, 2.2);
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .45, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false });
      const m = new THREE.Mesh(geo, mat);
      m.rotation.x = -Math.PI / 2 + .12;
      m.rotation.z = -yaw;
      m.position.copy(pos); m.position.y += .3 + i * .06;
      m.scale.setScalar(1 + i * .5);
      this.scene.add(m);
      this.add(m, .45 + i * .04, (age, dt) => {
        const t = age / (.45 + i * .04);
        m.scale.setScalar((1 + i * .5) * (1 + t * 1.4));
        m.position.addScaledVector(new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)), dt * range * .7);
        mat.opacity = .45 * (1 - t);
      });
    }
    this.particles(pos.clone().add(new THREE.Vector3(Math.sin(yaw) * 2, .6, Math.cos(yaw) * 2)), color, { count: 30, speed: 6, size: .14, life: .6, gravity: 0, up: .5, spread: 1.4, drag: 1.2 });
  }

  afterimage(pos, yaw, color = 0x9fe8ff) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .3, depthWrite: false, blending: THREE.AdditiveBlending });
    mat.userData.shared = false;
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(.24, .86, 3, 7), mat);
    body.position.y = .92;
    const head = new THREE.Mesh(new THREE.SphereGeometry(.22, 8, 7), mat);
    head.position.y = 1.62;
    g.add(body, head);
    g.position.copy(pos);
    g.rotation.y = yaw;
    this.scene.add(g);
    this.add(g, .32, (age) => {
      mat.opacity = .3 * (1 - age / .32);
      g.scale.setScalar(1 - age / .32 * .15);
    });
    return g;
  }
}
