import * as THREE from 'three';

/* ------------------------------------------------------------------ */
/*  Math & noise                                                       */
/* ------------------------------------------------------------------ */
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const TAU = Math.PI * 2;
export const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const pick = arr => arr[Math.floor(Math.random() * arr.length)];

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(x, y) {
  let h = x * 374761393 + y * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967296;
}
export function valueNoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}
export function fbm(x, y, oct = 4) {
  let s = 0, amp = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += valueNoise(x * f, y * f) * amp; f *= 2.03; amp *= 0.5; }
  return s;
}
export const easeOutCubic = t => 1 - Math.pow(1 - t, 3);
export const easeInCubic = t => t * t * t;

/* ------------------------------------------------------------------ */
/*  Cel-shading materials                                              */
/* ------------------------------------------------------------------ */
function makeGradientMap() {
  const data = new Uint8Array([70, 70, 70, 255, 142, 142, 142, 255, 208, 208, 208, 255, 255, 255, 255, 255]);
  const tex = new THREE.DataTexture(data, 4, 1, THREE.RGBAFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}
export const GRADIENT_MAP = makeGradientMap();

const toonCache = new Map();

/**
 * MeshToonMaterial with a painted rim-light injection.
 * opts: { rim, rimColor, rimPower, rimStrength, emissive, emissiveIntensity, map, vertexColors, transparent, opacity, side }
 */
export function toon(color, opts = {}) {
  const key = color + '|' + (opts.rimColor ?? '') + '|' + (opts.rim ?? 0) + '|' + (opts.flat === false) + '|' + (opts.map ? opts.map.uuid : '') + '|' + (opts.vertexColors ? 'v' : '');
  let base = toonCache.get(key);
  if (!base) {
    base = new THREE.MeshToonMaterial({
      color,
      gradientMap: GRADIENT_MAP,
      map: opts.map || null,
      vertexColors: !!opts.vertexColors,
      emissive: opts.emissive ?? 0x000000,
      emissiveIntensity: opts.emissiveIntensity ?? 1,
      transparent: !!opts.transparent,
      opacity: opts.opacity ?? 1,
      side: opts.side ?? THREE.FrontSide,
      alphaTest: opts.alphaTest ?? 0,
    });
    const rimColor = new THREE.Color(opts.rimColor ?? 0xffe6b8);
    const rimPower = opts.rimPower ?? 3.0;
    const rimStrength = opts.rim ?? 0.22;
    base.onBeforeCompile = shader => {
      shader.uniforms.uRimColor = { value: rimColor };
      shader.uniforms.uRimPower = { value: rimPower };
      shader.uniforms.uRimStrength = { value: rimStrength };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vRimN;\nvarying vec3 vRimV;')
        .replace('#include <project_vertex>', `#include <project_vertex>
          vRimN = normalize(mat3(modelMatrix) * objectNormal);
          vec4 rwp = modelMatrix * vec4(transformed, 1.0);
          vRimV = normalize(cameraPosition - rwp.xyz);`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec3 vRimN; varying vec3 vRimV;
          uniform vec3 uRimColor; uniform float uRimPower; uniform float uRimStrength;`)
        .replace('#include <opaque_fragment>', `
          float rimF = pow(1.0 - clamp(dot(normalize(vRimN), normalize(vRimV)), 0.0, 1.0), uRimPower);
          outgoingLight += uRimColor * rimF * uRimStrength;
          #include <opaque_fragment>`);
    };
    base.customProgramCacheKey = () => 'aetheria-toon-v2';
    toonCache.set(key, base);
  }
  const m = base.clone();
  if (opts.emissive) { m.emissive = new THREE.Color(opts.emissive); m.emissiveIntensity = opts.emissiveIntensity ?? 1; }
  if (opts.transparent) { m.transparent = true; m.opacity = opts.opacity ?? 1; }
  if (opts.side) m.side = opts.side;
  if (opts.map) m.map = opts.map;
  if (opts.alphaTest) m.alphaTest = opts.alphaTest;
  m.vertexColors = !!opts.vertexColors;
  return m;
}

/** Flat vivid material for tiny props - cheaper than full toon. */
export function matte(color, opts = {}) {
  return new THREE.MeshLambertMaterial({ color, ...opts });
}

/* ------------------------------------------------------------------ */
/*  Outlines (inverted hull)                                           */
/* ------------------------------------------------------------------ */
const outlineMatCache = new Map();
function outlineMaterial(thickness, color) {
  const key = thickness + '|' + color;
  if (outlineMatCache.has(key)) return outlineMatCache.get(key);
  const m = new THREE.ShaderMaterial({
    uniforms: { uThickness: { value: thickness }, uColor: { value: new THREE.Color(color) } },
    vertexShader: `
      uniform float uThickness;
      void main(){
        vec3 p = position + normal * uThickness;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 uColor;
      void main(){ gl_FragColor = vec4(uColor, 1.0); }`,
    side: THREE.BackSide,
    depthWrite: true,
  });
  outlineMatCache.set(key, m);
  return m;
}
export function addOutline(mesh, thickness = 0.02, color = 0x1a1418) {
  const o = new THREE.Mesh(mesh.geometry, outlineMaterial(thickness, color));
  o.castShadow = false;
  o.receiveShadow = false;
  o.renderOrder = -1;
  mesh.add(o);
  return o;
}

/* ------------------------------------------------------------------ */
/*  Canvas textures                                                    */
/* ------------------------------------------------------------------ */
function canvas(w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}
function tex(c, { repeat = [1, 1], srgb = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Hand-painted cloth with soft vertical folds, for capes and banners. */
export function makeClothTexture(base = '#a83340', dark = '#7d2230', light = '#c95363') {
  const [c, x] = canvas(256, 256);
  const rnd = mulberry32(23);
  x.fillStyle = base; x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 7; i++) {
    const px = 16 + i * 36 + rnd() * 8;
    const w = 12 + rnd() * 16;
    const g = x.createLinearGradient(px, 0, px + w, 0);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(.45, dark);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    x.globalAlpha = .55; x.fillStyle = g;
    x.fillRect(px, 0, w, 256);
    const g2 = x.createLinearGradient(px + w * .5, 0, px + w * 1.4, 0);
    g2.addColorStop(0, 'rgba(0,0,0,0)');
    g2.addColorStop(.5, light);
    g2.addColorStop(1, 'rgba(0,0,0,0)');
    x.globalAlpha = .3; x.fillStyle = g2;
    x.fillRect(px + w * .4, 0, w, 256);
  }
  // fabric grain
  for (let i = 0; i < 900; i++) {
    x.globalAlpha = .05 + rnd() * .07;
    x.fillStyle = rnd() > .5 ? '#ffffff' : '#000000';
    x.fillRect(rnd() * 256, rnd() * 256, 1 + rnd() * 2, 1 + rnd() * 3);
  }
  x.globalAlpha = 1;
  return tex(c);
}

/** Hand-painted plaster with trowel mottling and hairline cracks. */
export function makePlasterTexture(base = '#f2e6c9', dark = '#d8c6a2', light = '#fff8e4') {
  const [c, x] = canvas(256, 256);
  const rnd = mulberry32(41);
  x.fillStyle = base; x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 220; i++) {
    x.globalAlpha = .04 + rnd() * .1;
    x.fillStyle = rnd() > .5 ? light : dark;
    const w = 20 + rnd() * 70, h = 10 + rnd() * 36;
    x.beginPath(); x.ellipse(rnd() * 256, rnd() * 256, w, h, rnd() * Math.PI, 0, 7); x.fill();
  }
  // hairline cracks
  x.globalAlpha = .18; x.strokeStyle = '#a89476'; x.lineWidth = 1;
  for (let i = 0; i < 7; i++) {
    let px = rnd() * 256, py = rnd() * 256;
    x.beginPath(); x.moveTo(px, py);
    for (let k = 0; k < 4; k++) { px += (rnd() - .5) * 22; py += rnd() * 20; x.lineTo(px, py); }
    x.stroke();
  }
  // timber-grained grain streaks near the bottom
  x.globalAlpha = .1; x.fillStyle = '#8f7a58';
  for (let i = 0; i < 60; i++) x.fillRect(rnd() * 256, 210 + rnd() * 46, 4 + rnd() * 26, 1 + rnd() * 2);
  x.globalAlpha = 1;
  return tex(c, { repeat: [1.6, 1.2] });
}

/** Hand-painted roof tiles: staggered scalloped rows. */
export function makeRoofTexture(base = '#ffffff') {
  const [c, x] = canvas(256, 256);
  const rnd = mulberry32(59);
  x.fillStyle = base; x.fillRect(0, 0, 256, 256);
  const rows = 8, cols = 8;
  for (let r = 0; r < rows; r++) {
    const y = r * 32;
    for (let i = 0; i <= cols; i++) {
      const px = i * 32 + (r % 2 ? 16 : 0);
      const g = x.createLinearGradient(px, y, px, y + 30);
      g.addColorStop(0, 'rgba(255,255,255,.34)');
      g.addColorStop(.55, 'rgba(255,255,255,0)');
      g.addColorStop(1, 'rgba(0,0,0,.30)');
      x.fillStyle = g;
      x.beginPath();
      x.moveTo(px, y); x.lineTo(px + 28, y);
      x.quadraticCurveTo(px + 28, y + 26, px + 14, y + 30);
      x.quadraticCurveTo(px, y + 26, px, y);
      x.fill();
      x.strokeStyle = 'rgba(0,0,0,.22)'; x.lineWidth = 1.5;
      x.beginPath(); x.moveTo(px, y); x.lineTo(px, y + 24); x.stroke();
    }
  }
  for (let i = 0; i < 260; i++) {
    x.globalAlpha = .05 + rnd() * .08;
    x.fillStyle = rnd() > .5 ? '#ffffff' : '#000000';
    x.fillRect(rnd() * 256, rnd() * 256, 2 + rnd() * 6, 1 + rnd() * 3);
  }
  x.globalAlpha = 1;
  return tex(c, { repeat: [3, 2] });
}

/** Hand-painted grass / earth texture with brushy strokes. */
export function makeGroundTexture() {
  const [c, x] = canvas(512, 512);
  const rnd = mulberry32(7);
  x.fillStyle = '#5b8a4f'; x.fillRect(0, 0, 512, 512);
  const pal = ['#659a58', '#4e7d46', '#74ab5f', '#456f3f', '#7fbc68', '#578c4d', '#8ac36f', '#3f6b3c'];
  for (let i = 0; i < 2600; i++) {
    const px = rnd() * 512, py = rnd() * 512;
    const w = 3 + rnd() * 14, h = 1 + rnd() * 4;
    x.globalAlpha = 0.12 + rnd() * 0.3;
    x.fillStyle = pal[(rnd() * pal.length) | 0];
    x.beginPath(); x.ellipse(px, py, w, h, rnd() * Math.PI, 0, 7); x.fill();
  }
  for (let i = 0; i < 900; i++) {
    x.globalAlpha = 0.1 + rnd() * 0.22;
    x.strokeStyle = rnd() > .5 ? '#a9d68c' : '#3d7340';
    x.lineWidth = 1 + rnd();
    const px = rnd() * 512, py = rnd() * 512;
    x.beginPath(); x.moveTo(px, py); x.lineTo(px + (rnd() - .5) * 8, py - 3 - rnd() * 9); x.stroke();
  }
  x.globalAlpha = 1;
  return tex(c, { repeat: [26, 26] });
}

/** Hand-painted cobblestone / cut-stone texture with mortar joints. */
export function makeStoneTexture() {
  const [c, x] = canvas(256, 256);
  const rnd = mulberry32(11);
  x.fillStyle = '#6f5b42'; x.fillRect(0, 0, 256, 256); // mortar / dirt base
  const tones = ['#c9ad80', '#b99b70', '#d4bb90', '#ab8d64', '#c2a478', '#d9c39a'];
  const rows = 6, cols = 6;
  const rh = 256 / rows;
  for (let r = 0; r < rows; r++) {
    const y = r * rh;
    const off = (r % 2) * (256 / cols) * .5;
    for (let i = -1; i <= cols; i++) {
      const px = i * (256 / cols) + off;
      const w = 256 / cols - 4 - rnd() * 5, h = rh - 4 - rnd() * 4;
      const tone = tones[(rnd() * tones.length) | 0];
      const g = x.createLinearGradient(px, y, px + w, y + h);
      g.addColorStop(0, tone);
      g.addColorStop(.55, '#ffffff22');
      g.addColorStop(1, '#00000033');
      x.fillStyle = tone;
      const rad = 5 + rnd() * 6;
      x.beginPath();
      x.roundRect ? x.roundRect(px + 2, y + 2, w, h, rad) : x.rect(px + 2, y + 2, w, h);
      x.fill();
      x.fillStyle = g; x.globalAlpha = .55; x.fill(); x.globalAlpha = 1;
      // worn highlight on the top edge
      x.strokeStyle = 'rgba(255,245,220,.20)'; x.lineWidth = 1.6;
      x.beginPath(); x.moveTo(px + 6, y + 5); x.lineTo(px + w - 4, y + 5); x.stroke();
      // pebble speckles
      for (let k = 0; k < 6; k++) {
        x.globalAlpha = .10 + rnd() * .16;
        x.fillStyle = rnd() > .5 ? '#f4e4c4' : '#5a452f';
        x.beginPath(); x.ellipse(px + 5 + rnd() * w, y + 5 + rnd() * h, 1 + rnd() * 3, 1 + rnd() * 2, rnd() * 3, 0, 7); x.fill();
      }
      x.globalAlpha = 1;
    }
  }
  // moss in the joints
  for (let i = 0; i < 120; i++) {
    x.globalAlpha = .06 + rnd() * .12;
    x.fillStyle = rnd() > .5 ? '#5f7a3f' : '#3f5a2e';
    x.beginPath(); x.ellipse(rnd() * 256, rnd() * 256, 3 + rnd() * 7, 1 + rnd() * 3, rnd() * 3, 0, 7); x.fill();
  }
  x.globalAlpha = 1;
  return tex(c, { repeat: [1, 1] });
}

/** Painted wood grain. */
export function makeWoodTexture() {
  const [c, x] = canvas(128, 128);
  x.fillStyle = '#8a5c36'; x.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 70; i++) {
    x.globalAlpha = .12 + Math.random() * .2;
    x.strokeStyle = Math.random() > .5 ? '#6b4426' : '#a8784c';
    x.lineWidth = 1 + Math.random() * 2;
    const y = Math.random() * 128;
    x.beginPath(); x.moveTo(0, y);
    for (let px = 0; px <= 128; px += 16) x.lineTo(px, y + Math.sin(px * .1 + y) * 2.2);
    x.stroke();
  }
  return tex(c);
}

export function makeGlowTexture(color = '#ffffff') {
  const [c, x] = canvas(128, 128);
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, color); g.addColorStop(.28, color); g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function makeSoftTexture() {
  const [c, x] = canvas(64, 64);
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(.4, 'rgba(255,255,255,.8)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

/** Fluffy stylised cloud billboard. */
export function makeCloudTexture() {
  const [c, x] = canvas(256, 160);
  const puffs = [[80, 90, 52], [126, 70, 60], [176, 92, 46], [106, 104, 40], [150, 100, 44], [56, 104, 34], [205, 106, 30]];
  const g = x.createLinearGradient(0, 20, 0, 140);
  g.addColorStop(0, 'rgba(255,248,238,.98)'); g.addColorStop(.62, 'rgba(255,225,214,.92)'); g.addColorStop(1, 'rgba(238,196,205,0)');
  for (const [px, py, r] of puffs) {
    const rg = x.createRadialGradient(px, py - r * .25, r * .12, px, py, r);
    rg.addColorStop(0, 'rgba(255,253,246,.98)');
    rg.addColorStop(.55, 'rgba(255,238,226,.82)');
    rg.addColorStop(1, 'rgba(250,215,215,0)');
    x.fillStyle = rg; x.beginPath(); x.arc(px, py, r, 0, 7); x.fill();
  }
  x.globalCompositeOperation = 'source-atop'; x.fillStyle = g; x.fillRect(0, 0, 256, 160);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/** Anime profile portrait for HUD and dialogue. */
export function makePortrait(cfg = {}) {
  const skin = cfg.skin || '#f1c39b';
  const skinShade = cfg.skinShade || '#d99b74';
  const hair = cfg.hair || '#2f2a4a';
  const hair2 = cfg.hair2 || '#51477a';
  const eye = cfg.eye || '#49c6d6';
  const cloth = cfg.cloth || '#2a5068';
  const cloth2 = cfg.cloth2 || '#d8b45c';
  const bg1 = cfg.bg1 || '#193444';
  const bg2 = cfg.bg2 || '#0a1721';
  const [c, x] = canvas(256, 256);
  const bg = x.createRadialGradient(128, 100, 10, 128, 128, 150);
  bg.addColorStop(0, bg1); bg.addColorStop(1, bg2);
  x.fillStyle = bg; x.fillRect(0, 0, 256, 256);
  // halo
  x.strokeStyle = 'rgba(255,212,121,.25)'; x.lineWidth = 2;
  x.beginPath(); x.arc(128, 120, 96, 0, 7); x.stroke();
  // shoulders
  x.fillStyle = cloth; x.beginPath(); x.ellipse(128, 262, 96, 62, 0, 0, 7); x.fill();
  x.fillStyle = cloth2; x.beginPath(); x.moveTo(70, 210); x.quadraticCurveTo(128, 246, 186, 210); x.lineTo(176, 256); x.lineTo(80, 256); x.closePath(); x.fill();
  // neck
  x.fillStyle = skinShade; x.fillRect(112, 178, 32, 36);
  // back hair
  x.fillStyle = hair;
  x.beginPath(); x.moveTo(60, 168); x.quadraticCurveTo(42, 76, 128, 52); x.quadraticCurveTo(216, 76, 196, 176);
  x.quadraticCurveTo(190, 208, 172, 206); x.quadraticCurveTo(160, 150, 128, 152); x.quadraticCurveTo(96, 150, 84, 208);
  x.quadraticCurveTo(64, 208, 60, 168); x.closePath(); x.fill();
  // face
  x.fillStyle = skin;
  x.beginPath(); x.moveTo(86, 106); x.quadraticCurveTo(84, 178, 128, 196); x.quadraticCurveTo(172, 178, 170, 106);
  x.quadraticCurveTo(172, 66, 128, 64); x.quadraticCurveTo(84, 66, 86, 106); x.closePath(); x.fill();
  // face shade
  x.fillStyle = 'rgba(201,138,105,.28)'; x.beginPath(); x.ellipse(128, 182, 28, 14, 0, 0, 7); x.fill();
  // eyes
  drawEye(x, 102, 134, eye, 1);
  drawEye(x, 154, 134, eye, 1);
  // brows
  x.strokeStyle = hair; x.lineWidth = 4; x.lineCap = 'round';
  x.beginPath(); x.moveTo(88, 112); x.quadraticCurveTo(101, 104, 116, 111); x.stroke();
  x.beginPath(); x.moveTo(140, 111); x.quadraticCurveTo(155, 104, 168, 112); x.stroke();
  // nose + mouth
  x.strokeStyle = 'rgba(140,84,64,.55)'; x.lineWidth = 2;
  x.beginPath(); x.moveTo(128, 152); x.lineTo(131, 158); x.stroke();
  x.strokeStyle = '#b4615c'; x.lineWidth = 2.4;
  x.beginPath(); x.moveTo(119, 172); x.quadraticCurveTo(128, 178, 137, 172); x.stroke();
  // blush
  x.fillStyle = 'rgba(232,120,120,.18)';
  x.beginPath(); x.ellipse(96, 164, 14, 7, 0, 0, 7); x.fill();
  x.beginPath(); x.ellipse(160, 164, 14, 7, 0, 0, 7); x.fill();
  // front hair bangs
  x.fillStyle = hair;
  x.beginPath(); x.moveTo(78, 112); x.quadraticCurveTo(70, 58, 128, 48); x.quadraticCurveTo(196, 58, 180, 116);
  x.quadraticCurveTo(176, 86, 162, 88); x.quadraticCurveTo(148, 118, 132, 86); x.quadraticCurveTo(120, 120, 105, 88);
  x.quadraticCurveTo(92, 116, 78, 112); x.closePath(); x.fill();
  // hair highlights
  x.fillStyle = hair2; x.globalAlpha = .8;
  x.beginPath(); x.moveTo(94, 68); x.quadraticCurveTo(126, 54, 154, 68); x.quadraticCurveTo(126, 63, 94, 68); x.fill();
  x.globalAlpha = 1;
  // accessory
  if (cfg.accessory === 'circlet') {
    x.strokeStyle = '#f0c66d'; x.lineWidth = 4;
    x.beginPath(); x.arc(128, 106, 50, Math.PI * 1.12, Math.PI * 1.88); x.stroke();
    x.fillStyle = '#66e2dc'; x.beginPath(); x.arc(128, 58, 6, 0, 7); x.fill();
  } else if (cfg.accessory === 'beard') {
    x.fillStyle = '#e9e4d8';
    x.beginPath(); x.moveTo(94, 172); x.quadraticCurveTo(128, 262, 162, 172); x.quadraticCurveTo(128, 200, 94, 172); x.fill();
  } else if (cfg.accessory === 'horns') {
    x.fillStyle = '#d9c9b0';
    x.beginPath(); x.moveTo(80, 70); x.quadraticCurveTo(50, 30, 72, 20); x.quadraticCurveTo(88, 40, 96, 62); x.fill();
    x.beginPath(); x.moveTo(176, 70); x.quadraticCurveTo(206, 30, 184, 20); x.quadraticCurveTo(168, 40, 160, 62); x.fill();
  }
  // rim light
  x.globalAlpha = .25; x.strokeStyle = '#ffe4ad'; x.lineWidth = 5;
  x.beginPath(); x.arc(128, 118, 88, Math.PI * 1.15, Math.PI * 1.75); x.stroke();
  x.globalAlpha = 1;
  return c;
}
function drawEye(x, cx, cy, color, scale = 1) {
  x.save(); x.translate(cx, cy); x.scale(scale, scale);
  x.fillStyle = '#fdf8ef';
  x.beginPath(); x.ellipse(0, 0, 17, 21, 0, 0, 7); x.fill();
  x.fillStyle = '#2a2438';
  x.beginPath(); x.ellipse(0, -2, 13, 18, 0, 0, 7); x.fill();
  x.fillStyle = color;
  x.beginPath(); x.ellipse(0, 3, 12, 14, 0, 0, 7); x.fill();
  x.fillStyle = 'rgba(15,25,35,.65)';
  x.beginPath(); x.ellipse(0, 5, 6, 8, 0, 0, 7); x.fill();
  x.fillStyle = '#ffffff';
  x.beginPath(); x.ellipse(-4.5, -5, 4.4, 5.2, -.2, 0, 7); x.fill();
  x.beginPath(); x.ellipse(4, 6, 2.2, 2.6, 0, 0, 7); x.fill();
  x.strokeStyle = '#2a2438'; x.lineWidth = 3.4; x.lineCap = 'round';
  x.beginPath(); x.ellipse(0, -1, 17, 21, 0, Math.PI * 1.08, Math.PI * 1.92); x.stroke();
  x.beginPath(); x.moveTo(-16, -8); x.lineTo(-17, -18); x.stroke();
  x.restore();
}

/** Casting circle texture, used on ground decals. */
export function makeRuneTexture(colorA = '#ffb05c', colorB = '#ffe6a0') {
  const [c, x] = canvas(512, 512);
  x.translate(256, 256);
  x.strokeStyle = colorA; x.fillStyle = colorB;
  const ring = (r, w, a) => { x.globalAlpha = a; x.lineWidth = w; x.beginPath(); x.arc(0, 0, r, 0, 7); x.stroke(); };
  ring(238, 7, .85); ring(222, 2, .7); ring(170, 3, .8); ring(120, 2, .65); ring(64, 3, .9);
  x.globalAlpha = .9;
  for (let i = 0; i < 12; i++) {
    x.save();
    x.rotate(i / 12 * TAU);
    x.translate(0, -196);
    x.lineWidth = 3;
    x.beginPath();
    x.moveTo(0, -18); x.lineTo(12, 8); x.lineTo(-12, 8); x.closePath(); x.stroke();
    x.fillRect(-2, -12, 4, 12);
    x.restore();
  }
  x.globalAlpha = .55;
  for (let i = 0; i < 6; i++) {
    x.save(); x.rotate(i / 6 * TAU);
    x.beginPath(); x.moveTo(0, -100); x.lineTo(78, 50); x.lineTo(-78, 50); x.closePath(); x.stroke();
    x.restore();
  }
  x.globalAlpha = .35;
  x.lineWidth = 1.5;
  for (let i = 0; i < 48; i++) {
    x.save(); x.rotate(i / 48 * TAU); x.beginPath(); x.moveTo(0, -238); x.lineTo(0, -214); x.stroke(); x.restore();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/** Outline-free leaf / grass blade texture for billboards. */
export function makeGrassTexture() {
  const [c, x] = canvas(128, 128);
  x.clearRect(0, 0, 128, 128);
  const blades = 13;
  for (let i = 0; i < blades; i++) {
    const bx = 20 + Math.random() * 88;
    const h = 44 + Math.random() * 64;
    const lean = (Math.random() - .5) * 40;
    const g = x.createLinearGradient(bx, 128, bx + lean, 128 - h);
    const dark = Math.random() > .5;
    g.addColorStop(0, dark ? '#3e7a40' : '#4c8a46');
    g.addColorStop(1, dark ? '#93c96c' : '#bfe08a');
    x.strokeStyle = g; x.lineWidth = 2.5 + Math.random() * 2.5; x.lineCap = 'round';
    x.beginPath(); x.moveTo(bx, 128);
    x.quadraticCurveTo(bx + lean * .35, 128 - h * .55, bx + lean, 128 - h);
    x.stroke();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.LinearFilter;
  return t;
}

export function makeFlowerTexture(color) {
  const [c, x] = canvas(64, 64);
  x.clearRect(0, 0, 64, 64);
  x.strokeStyle = '#4c8a46'; x.lineWidth = 2;
  x.beginPath(); x.moveTo(32, 62); x.quadraticCurveTo(30, 40, 32, 28); x.stroke();
  x.fillStyle = color;
  for (let i = 0; i < 5; i++) {
    const a = i / 5 * TAU;
    x.beginPath(); x.ellipse(32 + Math.cos(a) * 8, 24 + Math.sin(a) * 8, 6, 4.4, a, 0, 7); x.fill();
  }
  x.fillStyle = '#ffe6a0'; x.beginPath(); x.arc(32, 24, 4.2, 0, 7); x.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/** Glowing text sign for shops / road signs (canvas texture on plane). */
export function makeSignTexture(title, sub = '', opts = {}) {
  const [c, x] = canvas(512, 160);
  x.fillStyle = opts.bg || 'rgba(24,16,10,0.92)'; x.fillRect(0, 0, 512, 160);
  x.strokeStyle = opts.border || '#e4b96b'; x.lineWidth = 6; x.strokeRect(8, 8, 496, 144);
  x.strokeStyle = 'rgba(228,185,107,.3)'; x.lineWidth = 2; x.strokeRect(20, 20, 472, 120);
  x.fillStyle = opts.color || '#ffe6b0'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.font = '600 56px Georgia, serif';
  x.fillText(title, 256, sub ? 68 : 84);
  if (sub) { x.font = '300 25px Georgia, serif'; x.fillStyle = 'rgba(255,230,180,.65)'; x.fillText(sub, 256, 118); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/* ------------------------------------------------------------------ */
/*  Geometry helpers                                                   */
/* ------------------------------------------------------------------ */
export function box(w, h, d, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; return m;
}
export function cyl(rt, rb, h, seg, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), material);
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; return m;
}
export function sphere(r, material, x = 0, y = 0, z = 0, seg = 14) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, seg, seg), material);
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; return m;
}
export function cone(r, h, seg, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, seg), material);
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; return m;
}
export function plane(w, h, material, x = 0, y = 0, z = 0, rx = -Math.PI / 2) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
  m.position.set(x, y, z); m.rotation.x = rx; m.receiveShadow = true; return m;
}

/** Lightweight additive sprite glow. */
export function glowSprite(color, size, texture) {
  const m = new THREE.SpriteMaterial({ map: texture || makeGlowTexture('#ffffff'), color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: .9 });
  const s = new THREE.Sprite(m); s.scale.set(size, size, 1); return s;
}

/* ------------------------------------------------------------------ */
/*  Misc                                                               */
/* ------------------------------------------------------------------ */
export function disposeObject(obj) {
  obj.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach(m => { if (m.map && m.map.dispose) m.map.dispose(); m.dispose(); });
    }
  });
}
export function projectToScreen(pos, camera, w = innerWidth, h = innerHeight) {
  const v = pos.clone().project(camera);
  return { x: (v.x * .5 + .5) * w, y: (-v.y * .5 + .5) * h, visible: v.z < 1 && v.z > -1 };
}
export function formatNum(n) { return Math.round(n).toLocaleString('pt-BR'); }
