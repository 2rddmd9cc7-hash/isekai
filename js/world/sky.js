import * as THREE from 'three';
import { toon, makeCloudTexture, makeGlowTexture, rand, TAU, clamp } from '../core/utils.js';

export const SUN_DIR = new THREE.Vector3(0.40, 0.55, -0.73).normalize();

export function buildSky(scene, quality = 2) {
  const group = new THREE.Group();
  group.name = 'sky';
  scene.add(group);

  const uniforms = {
    uZenith: { value: new THREE.Color('#2f6cb0') },
    uHorizon: { value: new THREE.Color('#bcdcee') },
    uSunColor: { value: new THREE.Color('#fff0cf') },
    uCloud: { value: new THREE.Color('#fff2e6') },
    uSunDir: { value: SUN_DIR.clone() },
    uTime: { value: 0 },
  };
  const skyMat = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    vertexShader: `
      varying vec3 vDir;
      void main(){
        vDir = normalize(position);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 uZenith, uHorizon, uSunColor, uCloud, uSunDir;
      uniform float uTime;
      varying vec3 vDir;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float noise(vec2 p){
        vec2 i = floor(p), f = fract(p);
        vec2 u = f*f*(3.0-2.0*f);
        return mix(mix(hash(i), hash(i+vec2(1,0)), u.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y);
      }
      float fbm(vec2 p){
        float v = 0.0, a = 0.55;
        for(int i=0;i<5;i++){ v += noise(p)*a; p *= 2.03; a *= 0.5; }
        return v;
      }
      void main(){
        vec3 d = normalize(vDir);
        float up = clamp(d.y, 0.0, 1.0);
        vec3 col = mix(uHorizon, uZenith, pow(up, 0.34));
        // warm horizon band
        col = mix(col, vec3(1.0, 0.86, 0.66), smoothstep(0.14, 0.0, abs(d.y)) * 0.22);
        float sd = max(dot(d, uSunDir), 0.0);
        col += uSunColor * pow(sd, 6.0) * 0.32;
        col += uSunColor * pow(sd, 60.0) * 0.55;
        col += vec3(1.0,0.95,0.85) * smoothstep(0.9986, 0.9994, sd) * 1.4;
        // painted cloud strata
        vec2 cp = d.xz / max(d.y + 0.28, 0.1) * 2.4 + vec2(uTime*0.006, uTime*0.002);
        float n = fbm(cp * vec2(1.0, 2.2));
        float band = smoothstep(0.53, 0.72, n) * smoothstep(0.02, 0.13, d.y) * (1.0 - smoothstep(0.42, 0.8, d.y));
        float band2 = smoothstep(0.58, 0.8, fbm(cp*2.3 + 4.0)) * smoothstep(0.12, 0.22, d.y) * (1.0 - smoothstep(0.3, 0.55, d.y));
        col = mix(col, uCloud, band * 0.36 + band2 * 0.22);
        // painted mountain ridges sitting on the horizon (two hazy layers)
        float ang = atan(d.z, d.x);
        float ridgeFar = 0.028 + fbm(vec2(ang * 2.6 + 4.0, 7.3)) * 0.115;
        float farMask = smoothstep(ridgeFar + 0.002, ridgeFar - 0.003, d.y);
        vec3 farCol = mix(vec3(0.62, 0.72, 0.86), uHorizon, 0.34);
        col = mix(col, farCol, farMask * 0.92);
        float ridgeNear = 0.016 + fbm(vec2(ang * 4.1 + 18.0, 2.1)) * 0.072;
        float nearMask = smoothstep(ridgeNear + 0.002, ridgeNear - 0.003, d.y);
        vec3 nearCol = mix(vec3(0.38, 0.50, 0.66), uHorizon, 0.20);
        col = mix(col, nearCol, nearMask * 0.96);
        // subtle dithering to avoid banding
        col += (hash(gl_FragCoord.xy) - 0.5) * 0.012;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(760, 32, 20), skyMat);
  sky.renderOrder = -100;
  sky.frustumCulled = false;
  group.add(sky);

  // sun halo
  const glowTex = makeGlowTexture('#ffffff');
  const sunHalo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, color: 0xffc47a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, opacity: .42,
  }));
  sunHalo.scale.setScalar(118);
  sunHalo.position.copy(SUN_DIR).multiplyScalar(620);
  sunHalo.renderOrder = -90;
  group.add(sunHalo);
  const sunCore = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, color: 0xfff3cf, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, opacity: .85,
  }));
  sunCore.scale.setScalar(30);
  sunCore.position.copy(SUN_DIR).multiplyScalar(618);
  sunCore.renderOrder = -90;
  group.add(sunCore);

  // pale companion moon, for a distinct Aetheria sky
  const moon = new THREE.Mesh(new THREE.CircleGeometry(16, 32), new THREE.MeshBasicMaterial({ color: 0xd9e4ff, transparent: true, opacity: .5, fog: false }));
  moon.position.set(-240, 165, -520);
  moon.lookAt(0, 0, 0);
  moon.renderOrder = -89;
  group.add(moon);
  const moonGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0x9fb6ff, transparent: true, opacity: .22, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  moonGlow.scale.setScalar(90); moonGlow.position.copy(moon.position); moonGlow.renderOrder = -89;
  group.add(moonGlow);

  /* ---------------- drifting cloud billboards ---------------- */
  const cloudTex = makeCloudTexture();
  const clouds = [];
  const N = quality >= 2 ? 16 : 9;
  for (let i = 0; i < N; i++) {
    const m = new THREE.SpriteMaterial({ map: cloudTex, transparent: true, opacity: rand(.42, .8), depthWrite: false, fog: false, color: new THREE.Color().setHSL(rand(.02, .08), rand(.25, .55), rand(.82, .97)) });
    const s = new THREE.Sprite(m);
    const a = rand(0, TAU), r = rand(180, 430);
    s.position.set(Math.cos(a) * r, rand(52, 165), Math.sin(a) * r);
    const sc = rand(70, 170);
    s.scale.set(sc, sc * .55, 1);
    s.renderOrder = -85;
    s.userData = { speed: rand(1.2, 4.2), baseY: s.position.y, phase: rand(0, TAU) };
    group.add(s); clouds.push(s);
  }

  /* ---------------- floating crystal isles ---------------- */
  const isles = [];
  const isleData = [
    { a: 0.62, r: 158, y: 50, s: .8 },
    { a: 2.24, r: 196, y: 42, s: .6 },
    { a: 4.12, r: 175, y: 60, s: .46 },
    { a: 5.42, r: 150, y: 36, s: .36 },
  ];
  const isleRockMat = new THREE.MeshBasicMaterial({ color: 0x625d75, fog: false });
  const isleDirtMat = new THREE.MeshBasicMaterial({ color: 0x8a6a4c, fog: false });
  const isleTopMat = new THREE.MeshBasicMaterial({ color: 0x679c63, fog: false });
  const isleTreeMat = new THREE.MeshBasicMaterial({ color: 0x3f8a58, fog: false });
  const isleCrystalMat = new THREE.MeshBasicMaterial({ color: 0x7fe8ff, fog: false });
  for (let i = 0; i < isleData.length; i++) {
    const d = isleData[i];
    const isle = new THREE.Group();
    // chunky rock underside: two overlapping low-poly boulders instead of a sharp cone
    const rockA = new THREE.Mesh(new THREE.IcosahedronGeometry(9.6, 1), isleRockMat);
    rockA.scale.set(1.0, 1.05, 1.0); rockA.position.y = -6.4; isle.add(rockA);
    const rockB = new THREE.Mesh(new THREE.IcosahedronGeometry(6.4, 1), isleRockMat);
    rockB.scale.set(.9, 1.2, .9); rockB.position.set(1.6, -12.4, -1.2); isle.add(rockB);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(13, 11, 3, 9), isleTopMat);
    top.position.y = 1.5;
    const band = new THREE.Mesh(new THREE.CylinderGeometry(11.4, 12.6, 2.6, 9), isleDirtMat);
    band.position.y = -.9;
    isle.add(band, top);
    // little waterfall spilling off the rim
    const fall = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 12), new THREE.MeshBasicMaterial({ color: 0xa9f2ff, transparent: true, opacity: .55, fog: false, side: THREE.DoubleSide }));
    fall.position.set(8.5, -4.2, 4.2); fall.rotation.y = .5; isle.add(fall);
    // little stylised pines on the isle
    for (let k = 0; k < 3; k++) {
      const tr = new THREE.Group();
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(.35, .45, 3, 5), new THREE.MeshBasicMaterial({ color: 0x6b4a33, fog: false }));
      trunk.position.y = 1.5; tr.add(trunk);
      const crownA = new THREE.Mesh(new THREE.ConeGeometry(2.6, 5.5, 5), isleTreeMat); crownA.position.y = 5; tr.add(crownA);
      const crownB = new THREE.Mesh(new THREE.ConeGeometry(1.9, 4.2, 5), isleTreeMat); crownB.position.y = 7.4; tr.add(crownB);
      tr.position.set(rand(-7, 7), 2.5, rand(-7, 7)); isle.add(tr);
    }
    // a crystal cluster at the heart of the isle
    for (let k = 0; k < 3; k++) {
      const cr = new THREE.Mesh(new THREE.OctahedronGeometry(rand(.9, 1.7), 0), isleCrystalMat);
      cr.position.set(rand(-2.5, 2.5), rand(4, 7.5), rand(-2.5, 2.5));
      cr.rotation.set(rand(0, 3), rand(0, 3), rand(0, 3));
      isle.add(cr);
    }
    const crown = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xcdf7ff, transparent: true, opacity: .3, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    crown.scale.setScalar(9); crown.position.y = 6; isle.add(crown);
    // vines
    for (let k = 0; k < 2; k++) {
      const vine = new THREE.Mesh(new THREE.CylinderGeometry(.1, .03, rand(6, 12), 3), new THREE.MeshBasicMaterial({ color: 0x4f7f4b, fog: false }));
      vine.position.set(rand(-6, 6), -rand(3, 7), rand(-6, 6)); isle.add(vine);
    }
    isle.position.set(Math.cos(d.a) * d.r, d.y, Math.sin(d.a) * d.r);
    isle.scale.setScalar(d.s);
    isle.rotation.y = rand(0, TAU);
    isle.userData = { baseY: d.y, phase: rand(0, TAU) };
    group.add(isle); isles.push(isle);
  }

  /* ---------------- distant birds ---------------- */
  const birds = [];
  const birdMat = new THREE.LineBasicMaterial({ color: 0x2c2a3c, transparent: true, opacity: .55, fog: false });
  for (let i = 0; i < 8; i++) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-2, 0, 0, 0, .5, 0, 2, 0, 0]), 3));
    const line = new THREE.Line(geo, birdMat);
    const a = rand(0, TAU), r = rand(60, 200);
    line.position.set(Math.cos(a) * r, rand(28, 58), Math.sin(a) * r);
    line.scale.setScalar(rand(1.2, 2.4));
    line.userData = { a, r, speed: rand(.02, .05), phase: rand(0, TAU) };
    group.add(line); birds.push(line);
  }

  let t = 0;
  const tmp = new THREE.Vector3();
  return {
    group,
    sunDir: SUN_DIR,
    update(dt, time) {
      t = time;
      uniforms.uTime.value = time;
      for (const c of clouds) {
        c.position.x += c.userData.speed * dt;
        if (c.position.x > 460) c.position.x = -460;
        c.position.y = c.userData.baseY + Math.sin(time * .08 + c.userData.phase) * 4;
      }
      for (const i of isles) {
        i.position.y = i.userData.baseY + Math.sin(time * .18 + i.userData.phase) * 2.4;
        i.rotation.y += dt * .012;
      }
      for (const b of birds) {
        b.userData.a += dt * b.userData.speed;
        b.position.x = Math.cos(b.userData.a) * b.userData.r;
        b.position.z = Math.sin(b.userData.a) * b.userData.r;
        b.position.y += Math.sin(time * 1.4 + b.userData.phase) * dt * .8;
        b.rotation.y = -b.userData.a + Math.PI / 2;
        b.rotation.z = Math.sin(time * 3 + b.userData.phase) * .18;
      }
      sunHalo.position.copy(SUN_DIR).multiplyScalar(620);
      sunCore.position.copy(SUN_DIR).multiplyScalar(618);
    },
  };
}
