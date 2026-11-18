import * as THREE from 'three';
import { clamp, smoothstep, fbm, valueNoise, makeGroundTexture, makeStoneTexture, rand, TAU, toon } from '../core/utils.js';

export const WATER_LEVEL = -1.05;
export const WORLD_RADIUS = 150;

export const riverX = z => 46 + 8 * Math.sin(z * 0.030) + 2.2 * Math.sin(z * 0.11 + 0.7);
const LAKE = { x: 58, z: -78, r: 20 };

/** Analytic terrain height — used by mesh, movement, props and AI. */
export function heightAt(x, z) {
  let h = 1.35 * Math.sin(x * 0.034 + 0.4) * Math.cos(z * 0.039 - 0.2)
        + 0.55 * Math.sin(x * 0.083 + 1.7) * Math.cos(z * 0.071 + 0.5)
        + 0.22 * Math.sin(x * 0.19 + 0.3) * Math.cos(z * 0.16 + 1.1);

  // flatten village bowl
  const dv = Math.hypot(x, z - 32);
  const flat = smoothstep(15, 34, dv);
  h *= 0.12 + 0.88 * flat;

  // far ridgeline: land rises toward the borders
  const d = Math.hypot(x, z);
  const ridge = smoothstep(78, 148, d);
  h += ridge * (6 + fbm(x * 0.018 + 10, z * 0.018 - 4, 3) * 19);

  // castle plateau
  const dc = Math.hypot(x, z + 105);
  h += Math.max(0, 1 - dc / 46) * 4.6;

  // river channel
  const rx = riverX(z);
  const riverD = Math.abs(x - rx);
  const river = Math.max(0, 1 - riverD / 7.5);
  h -= river * river * 3.1;

  // lake bowl
  const dl = Math.hypot(x - LAKE.x, z - LAKE.z);
  h -= Math.max(0, 1 - dl / LAKE.r) * 4.4;
  if (dl < LAKE.r + 6) h -= (1 - smoothstep(LAKE.r - 2, LAKE.r + 6, dl)) * 1.2;

  // shallow stream joining river -> lake for a nice silhouette
  const st = Math.abs(z + 40 + Math.sin(x * 0.08) * 4) < 3 ? Math.max(0, 1 - Math.abs(x - 48) / 16) : 0;
  h -= st * 1.4;

  // lift the lowlands so only the carved river and lake hold water
  h += 0.8;

  // dry plateau under the goblin camp so the boss arena never floods
  const dg = Math.hypot(x + 64, z + 12);
  if (dg < 27) {
    const k = 1 - smoothstep(13, 27, dg);
    h += k * Math.max(0, -0.28 - h);
  }

  // keep a gentle clearing at spawn
  const ds = Math.hypot(x, z - 48);
  if (ds < 9) h *= smoothstep(4, 9, ds) * 0.8 + 0.2;

  return h;
}

export function terrainNormal(x, z, e = 0.5) {
  const hL = heightAt(x - e, z), hR = heightAt(x + e, z);
  const hD = heightAt(x, z - e), hU = heightAt(x, z + e);
  return new THREE.Vector3(hL - hR, 2 * e, hD - hU).normalize();
}

/* ---------------- roads ---------------- */
export const ROADS = [
  { width: 4.4, pts: [[0, 51], [0, 32], [1, 12], [3, -8], [3, -28], [1, -52], [0, -74], [0, -92], [0, -98]] },
  { width: 3.0, pts: [[0, 32], [-14, 34], [-28, 38], [-34, 42]] },
  { width: 3.0, pts: [[1, 14], [16, 10], [33, 6], [46, 4], [58, 0], [68, -8]] },
  { width: 3.0, pts: [[3, -8], [-14, -12], [-30, -18], [-46, -24], [-58, -30]] },
  { width: 2.4, pts: [[-46, -24], [-40, -36], [-36, -46], [-34, -52]] },
  { width: 2.4, pts: [[-58, -30], [-70, -38], [-80, -46], [-86, -54]] },
  { width: 2.4, pts: [[2, -30], [16, -38], [28, -46], [35, -53], [39, -58]] },
  { width: 2.4, pts: [[-58, -30], [-66, -22], [-64, -8], [-68, 4], [-76, 9]] },
  { width: 2.4, pts: [[68, -8], [64, -24], [60, -44], [58, -60], [58, -68]] },
];

function pointSegDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const t = clamp(((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1), 0, 1);
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}
export function roadDistance(x, z) {
  let best = 999;
  for (const r of ROADS) for (let i = 0; i < r.pts.length - 1; i++) {
    const a = r.pts[i], b = r.pts[i + 1];
    best = Math.min(best, pointSegDist(x, z, a[0], a[1], b[0], b[1]) - r.width * .5);
  }
  return best;
}
export function surfaceAt(x, z) {
  const dl = Math.hypot(x - LAKE.x, z - LAKE.z);
  if (dl < LAKE.r - 2) return 'water';
  if (Math.abs(x - riverX(z)) < 6.2 && heightAt(x, z) < WATER_LEVEL + .6) return 'water';
  const rd = roadDistance(x, z);
  if (rd < 0.4) return 'stone';
  if (rd < 1.6) return 'dirt';
  return 'grass';
}
export function isWater(x, z) {
  return heightAt(x, z) < WATER_LEVEL + 0.15;
}

/* ---------------- terrain mesh ---------------- */
export function buildTerrain(scene, quality = 2) {
  const size = 340;
  const seg = quality >= 2 ? 170 : 120;
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  const greens = ['#5f9457', '#6b9e5b', '#568a4e', '#76a862', '#5d8f53'].map(h => new THREE.Color(h));
  const meadow = new THREE.Color('#9aac61');
  const sand = new THREE.Color('#c8ae7c');
  const rock = new THREE.Color('#837e86');
  const deep = new THREE.Color('#31564a');

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = heightAt(x, z);
    pos.setY(i, h);
    const n = fbm(x * 0.045 + 3, z * 0.045 - 2, 3);
    const n2 = fbm(x * 0.012 + 20, z * 0.012 + 5, 2);
    c.copy(greens[(n * greens.length) | 0] || greens[0]);
    c.lerp(meadow, clamp((n2 - .48) * 2.2, 0, .55));
    const rx = riverX(z);
    const nearBank = Math.abs(x - rx) < 9 || Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r + 5;
    if (nearBank) c.lerp(sand, clamp((WATER_LEVEL + 1.9 - h) * .55, 0, .8));
    if (h < WATER_LEVEL) c.lerp(deep, clamp((WATER_LEVEL - h) * .44, 0, .85));
    if (h > 7.5) c.lerp(rock, clamp((h - 7.5) * .16, 0, .8));
    if (h > 15) c.lerp(new THREE.Color('#a7a0aa'), clamp((h - 15) * .08, 0, .5));
    const tint = .84 + valueNoise(x * .3, z * .3) * .30;
    c.multiplyScalar(tint);
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const tex = makeGroundTexture();
  tex.repeat.set(38, 38);
  const mat = new THREE.MeshToonMaterial({ map: tex, vertexColors: true, gradientMap: null });
  mat.gradientMap = null;
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tex, vertexColors: true }));
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  scene.add(mesh);

  // darker painterly undergrowth patches
  const patchMat = new THREE.MeshBasicMaterial({ color: 0x2f5a3a, transparent: true, opacity: .16, depthWrite: false });
  for (let i = 0; i < 26; i++) {
    const a = rand(0, TAU), r = rand(20, 120);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (isWater(x, z)) continue;
    const m = new THREE.Mesh(new THREE.CircleGeometry(rand(4, 13), 12), patchMat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, heightAt(x, z) + .04, z);
    m.scale.y = rand(.5, 1.2);
    m.renderOrder = 1;
    scene.add(m);
  }
  return { mesh, heightAt, surfaceAt };
}

/* ---------------- stylized water ---------------- */
export function buildWater(scene) {
  const geo = new THREE.PlaneGeometry(340, 340, 96, 96);
  geo.rotateX(-Math.PI / 2);
  const uniforms = {
    uTime: { value: 0 },
    uDeep: { value: new THREE.Color('#1a667c') },
    uShallow: { value: new THREE.Color('#58d9d0') },
    uSun: { value: new THREE.Color('#ffe9b0') },
    uSunDir: { value: new THREE.Vector3(.40, .55, -.73).normalize() },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    vertexShader: `
      uniform float uTime;
      varying vec3 vWorld;
      varying vec2 vUv;
      void main(){
        vUv = uv;
        vec3 p = position;
        p.y += sin(p.x*0.32 + uTime*1.2)*0.06 + cos(p.z*0.28 - uTime*0.9)*0.055;
        vec4 wp = modelMatrix * vec4(p, 1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: `
      uniform float uTime; uniform vec3 uDeep, uShallow, uSun, uSunDir;
      varying vec3 vWorld; varying vec2 vUv;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
      float noise(vec2 p){
        vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
        return mix(mix(hash(i),hash(i+vec2(1,0)),u.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x),u.y);
      }
      void main(){
        vec2 p = vWorld.xz;
        float n = noise(p*0.9 + vec2(uTime*0.18, uTime*0.1));
        float n2 = noise(p*2.6 - vec2(uTime*0.3, -uTime*0.22));
        // painterly bands
        float bands = smoothstep(0.52,0.62, sin(p.x*0.42 + p.y*0.22 + n*2.4 + uTime*0.9)*0.5+0.5);
        vec3 col = mix(uDeep, uShallow, 0.36 + n*0.34 + bands*0.18);
        // sky reflection tint
        col = mix(col, vec3(0.72,0.88,0.95), 0.10);
        // stylised glitter
        float spark = smoothstep(0.78,0.94, noise(p*7.0 + vec2(uTime*0.5, -uTime*0.4)) * (0.5 + 0.5*n2));
        col += uSun * spark * 0.7;
        // foam contours
        float foam = smoothstep(0.72, 0.84, n2) * smoothstep(0.4, 0.9, n);
        col = mix(col, vec3(0.92,1.0,0.99), foam*0.35);
        // view fresnel
        vec3 v = normalize(cameraPosition - vWorld);
        float fres = pow(1.0 - clamp(v.y, 0.0, 1.0), 2.2);
        col = mix(col, vec3(0.78,0.92,1.0), fres*0.28);
        gl_FragColor = vec4(col, 0.88);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = WATER_LEVEL;
  mesh.name = 'water';
  mesh.renderOrder = 2;
  scene.add(mesh);

  // soft foam edge strips along the river + lake rim
  const foamMat = new THREE.MeshBasicMaterial({ color: 0xd8fff6, transparent: true, opacity: .18, depthWrite: false, side: THREE.DoubleSide });
  const foamPts = [];
  for (let z = -130; z < 130; z += 4) {
    const rx = riverX(z);
    foamPts.push([rx, z, 1]);
  }
  const foamGeo = new THREE.BufferGeometry();
  const verts = [];
  for (let i = 0; i < foamPts.length - 1; i++) {
    const [x1, z1] = foamPts[i], [x2, z2] = foamPts[i + 1];
    const w = 1.5;
    verts.push(x1 - w, WATER_LEVEL + .03, z1, x1 + w, WATER_LEVEL + .03, z1, x2 + w, WATER_LEVEL + .03, z2);
    verts.push(x1 - w, WATER_LEVEL + .03, z1, x2 + w, WATER_LEVEL + .03, z2, x2 - w, WATER_LEVEL + .03, z2);
  }
  foamGeo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  const foam = new THREE.Mesh(foamGeo, foamMat);
  foam.renderOrder = 3;
  scene.add(foam);

  return {
    mesh,
    update(dt, time) { uniforms.uTime.value = time; },
  };
}

/* ---------------- roads ---------------- */
export function buildRoads(scene) {
  const tex = makeStoneTexture();
  tex.repeat.set(3, 3);
  const mat = new THREE.MeshLambertMaterial({ map: tex, color: 0xd9c39c, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const group = new THREE.Group(); group.name = 'roads';
  for (const road of ROADS) {
    const pts = [];
    for (let i = 0; i < road.pts.length - 1; i++) {
      const a = road.pts[i], b = road.pts[i + 1];
      const n = Math.max(2, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 3));
      for (let k = 0; k < n; k++) {
        const t = k / n;
        pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
    }
    pts.push(road.pts[road.pts.length - 1]);
    const positions = [], uvs = [];
    let dist = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const prev = pts[Math.max(0, i - 1)], next = pts[Math.min(pts.length - 1, i + 1)];
      let dx = next[0] - prev[0], dz = next[1] - prev[1];
      const len = Math.hypot(dx, dz) || 1; dx /= len; dz /= len;
      const nx = -dz, nz = dx;
      const w = road.width * .5;
      const y = heightAt(p[0], p[1]) + 0.06;
      const y2 = heightAt(p[0] + nx * w, p[1] + nz * w) + 0.06;
      const y3 = heightAt(p[0] - nx * w, p[1] - nz * w) + 0.06;
      positions.push(p[0] + nx * w, Math.max(y, y2) + .06, p[1] + nz * w);
      positions.push(p[0] - nx * w, Math.max(y, y3) + .06, p[1] - nz * w);
      if (i > 0) dist += Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]);
      const v = dist / 8;
      uvs.push(0, v, 1, v);
    }
    const idx = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, mat);
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  scene.add(group);
  return group;
}
