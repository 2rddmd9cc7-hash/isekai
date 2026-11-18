import * as THREE from 'three';
import { G, isTouch } from './core/state.js';
import { AudioEngine } from './core/audio.js';
import { Effects } from './combat/effects.js';
import { UI } from './ui/ui.js';
import { World } from './world/world.js';
import { Player } from './entities/player.js';
import { QuestSystem } from './world/quests.js';
import { heightAt, riverX } from './world/terrain.js';
import { clamp } from './core/utils.js';

/* ================================================================== */
/*  Aetheria — bootstrap, input, main loop and game flow              */
/* ================================================================== */

const $ = id => document.getElementById(id);
const nextFrame = () => new Promise(resolve => requestAnimationFrame(() => resolve()));

let renderer, scene, camera, ui, audio, effects, world, player, quests;
let sun, fill, hemi;
let currentInteract = null;
let menuT = 0;
let victoryTimer = null;
let lastHudPulse = 0;

const LOAD_TIPS = [
  'Pintando os céus de Aetheria…',
  'Erguendo o Santuário de Sakura…',
  'Semeando os bosques de Brisa…',
  'Acendendo as forjas da vila…',
  'Despertando os goblins das colinas…',
  'Entalhando runas no Cristal…',
];

/* ------------------------------------------------------------------ */
/*  Boot                                                              */
/* ------------------------------------------------------------------ */
async function boot() {
  ui = new UI();
  G.ui = ui;
  ui.bind({ start: startGame, restart: restartGame, resume: resumeGame, mute: toggleMute });

  try {
    ui.setLoading(6, LOAD_TIPS[0]);
    await nextFrame();

    initRenderer();
    ui.setLoading(18, LOAD_TIPS[1]);
    await nextFrame();

    scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0xc6dfe8, 105, 300);
    camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.08, 900);
    camera.position.set(6, 12, 58);
    scene.add(camera);
    G.scene = scene;
    G.camera = camera;
    G.renderer = renderer;
    G.groundAt = (x, z) => heightAt(x, z);
    G.hitStop = 0;
    G.clock = new THREE.Clock();

    initLights();
    audio = new AudioEngine();
    G.audio = audio;
    effects = new Effects(scene);
    G.effects = effects;

    ui.setLoading(34, LOAD_TIPS[2]);
    await nextFrame();

    world = new World(scene, effects, 2);
    G.world = world;

    ui.setLoading(72, LOAD_TIPS[4]);
    await nextFrame();

    player = new Player(scene, effects, { x: 0, z: 46 });
    G.player = player;
    player.updateCamera(0.016, true);

    quests = new QuestSystem();
    G.quests = quests;
    G.mode = 'menu';

    G.onEnemyKilled = handleEnemyKilled;
    G.onBossDefeated = handleBossDefeated;

    quests.refresh();
    world.refreshMarkers();
    world.updateZone();

    ui.setLoading(90, LOAD_TIPS[5]);
    await nextFrame();

    setupInput();
    setupMobile();
    bindGameplayExtras();

    ui.setLoading(100, 'O Cristal aguarda.');
    await nextFrame();
    ui.hideLoading();
    setTimeout(() => ui.hideLoading(), 1200);

    G.ready = true;
    animate();
  } catch (err) {
    console.error('[Aetheria] Falha ao iniciar:', err);
    const tip = $('loadTip');
    if (tip) {
      tip.textContent = 'Falha ao carregar Aetheria — veja o console.';
      tip.style.color = '#ffb0a0';
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Rendering                                                         */
/* ------------------------------------------------------------------ */
function initRenderer() {
  renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
    stencil: false,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isTouch ? 1.4 : 1.85));
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.96;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.id = 'gameCanvas';
  $('viewport').appendChild(renderer.domElement);
  window.addEventListener('resize', onResize);
}

function onResize() {
  if (!renderer || !camera) return;
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isTouch ? 1.4 : 1.85));
  renderer.setSize(innerWidth, innerHeight);
}

function initLights() {
  hemi = new THREE.HemisphereLight(0xd8f0ff, 0x6f7d55, 1.0);
  scene.add(hemi);

  sun = new THREE.DirectionalLight(0xfff0d2, 1.55);
  sun.position.set(48, 62, -96);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 220;
  sun.shadow.camera.left = -42;
  sun.shadow.camera.right = 42;
  sun.shadow.camera.top = 42;
  sun.shadow.camera.bottom = -42;
  sun.shadow.bias = -0.0007;
  sun.shadow.normalBias = 0.03;
  scene.add(sun);
  scene.add(sun.target);

  fill = new THREE.DirectionalLight(0xa8d2ff, 0.55);
  fill.position.set(-52, 28, 64);
  scene.add(fill);
}

function updateSunTarget() {
  if (!sun) return;
  const focus = G.running && player ? player.pos : new THREE.Vector3(6, 0, 28);
  sun.target.position.set(focus.x, heightAt(focus.x, focus.z) + 1, focus.z);
  sun.target.updateMatrixWorld();
  sun.position.set(focus.x + 48, heightAt(focus.x, focus.z) + 66, focus.z - 88);
}

/* ------------------------------------------------------------------ */
/*  Game flow                                                         */
/* ------------------------------------------------------------------ */
function startGame() {
  if (!G.ready || G.running) return;
  G.running = true;
  G.mode = 'play';
  G.stats.startTime = performance.now();
  G.stats.gold = player.gold;
  audio.init();
  audio.setMuted(!!G.settings.muted);
  ui.setMuteButton(!!G.settings.muted);
  ui.beginGame();
  ui.updateHUD(true);
  player.updateCamera(0.016, true);
  updateSunTarget();
  ensurePointerLockIfFirstPerson();
  if (G.audio) G.audio.sfx('quest');
}

function resumeGame() {
  ui.closePanel();
  if (!G.running) startGame();
  else if (G.audio) G.audio.sfx('ui');
}

function restartGame() {
  G.running = false;
  G.over = false;
  if (G.audio) G.audio.setMuted(true);
  try { document.exitPointerLock && document.exitPointerLock(); } catch (_) { /* noop */ }
  window.location.reload();
}

function toggleMute() {
  G.settings.muted = !G.settings.muted;
  audio.setMuted(G.settings.muted);
  ui.setMuteButton(G.settings.muted);
  if (!G.settings.muted && !audio.ready) audio.init();
}

function handleEnemyKilled(enemy) {
  if (quests) quests.onEnemyKilled(enemy);
  if (G.audio) G.audio.sfx('goblinDie');
}

function handleBossDefeated() {
  if (victoryTimer) clearTimeout(victoryTimer);
  if (quests) quests.onBossDefeated();
  if (world) world.updateWaypoint(null);
  if (G.audio) G.audio.sfx('victory');
  ui.hideBoss();
  ui.toast('Grimmjaw foi derrotado. Aetheria respira de novo.', 'good');
  ui.screenFlash(0.32, 0xffe2a0);
  setTimeout(() => ui.screenFlash(0.18, 0xfff4d0), 260);
  victoryTimer = setTimeout(() => {
    G.over = true;
    G.paused = true;
    ui.showEnding({
      goblinsKilled: G.stats.goblinsKilled,
      level: player.level,
      gold: player.gold,
      time: elapsedLabel(),
    });
  }, 1900);
}

function elapsedLabel() {
  if (!G.stats.startTime) return '—';
  const sec = Math.max(0, Math.round((performance.now() - G.stats.startTime) / 1000));
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/* ------------------------------------------------------------------ */
/*  Input                                                             */
/* ------------------------------------------------------------------ */
function setupInput() {
  const canvas = renderer.domElement;

  const normalizeKey = e => (e.key || '').toLowerCase();
  const blockedKeys = new Set([' ', 'tab', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright']);

  window.addEventListener('keydown', e => {
    const k = normalizeKey(e);
    if (blockedKeys.has(k)) e.preventDefault();
    if (e.repeat) {
      if (k === 'shift' || k === 'w' || k === 'a' || k === 's' || k === 'd') G.keys[k] = true;
      return;
    }

    // menu / modals
    if (ui.dialogueOpen) {
      if (k === 'e' || k === 'enter' || k === ' ') ui.advanceDialogue();
      if (k === 'escape') ui.hideDialogue();
      return;
    }
    if (ui.activePanel) {
      if (k === 'escape' || k === 'p') ui.closePanel();
      if (k === 'm' && ui.activePanel === 'mapPanel') ui.closePanel();
      return;
    }
    if (!G.running) {
      if (k === 'enter' && !G.over) startGame();
      return;
    }
    if (G.over) return;

    G.keys[k] = true;

    if (k === 'escape') {
      if (document.pointerLockElement) document.exitPointerLock();
      else { ui.openPause(); G.paused = true; }
      return;
    }
    if (k === 'p') {
      ui.openPause();
      G.paused = true;
      return;
    }
    if (k === 'm') { ui.toggleMap(); return; }
    if (k === 'v') {
      player.setFirstPerson(!player.firstPerson);
      if (player.firstPerson) {
        ensurePointerLockIfFirstPerson();
        ui.toast('Primeira pessoa · V alterna', 'good');
      } else {
        try { document.exitPointerLock && document.exitPointerLock(); } catch (_) { /* noop */ }
        ui.toast('Terceira pessoa · arraste com o botão direito para girar');
      }
      return;
    }
    if (k === 'q') { player.dodge(); return; }
    if (k === 'h') { player.usePotion(); return; }
    if (k === 'e') { interact(); return; }
    if (k === 'tab') { player.toggleLock(); return; }
    if (k === '1') { player.magicDown('fire'); return; }
    if (k === '2') { player.magicDown('bolt'); return; }
    if (k === '3') { player.magicDown('ice'); return; }
    if (k === '4') { player.magicDown('wind'); return; }
    if (k === 'r') { player.cycleSpell(1); return; }
  });

  window.addEventListener('keyup', e => {
    const k = normalizeKey(e);
    G.keys[k] = false;
    if (k === '1') player && player.magicUp('fire');
  });

  window.addEventListener('blur', () => { G.keys = {}; G.mouse.left = false; });

  // ---- pointer / camera ----
  canvas.addEventListener('contextmenu', e => e.preventDefault());

  let dragging = false;
  let lastX = 0, lastY = 0;

  canvas.addEventListener('pointerdown', e => {
    if (!G.running || G.over) return;
    if (ui.modalOpen) return;
    if (e.pointerType === 'touch') {
      dragging = true; lastX = e.clientX; lastY = e.clientY;
      canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button === 0) {
      if (player.firstPerson && document.pointerLockElement !== canvas && canvas.requestPointerLock) {
        canvas.requestPointerLock();
      }
      player.pressAttack();
    } else if (e.button === 2) {
      dragging = true; lastX = e.clientX; lastY = e.clientY;
      canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
    }
  });

  const endPointer = e => {
    if (e.pointerType !== 'touch' && e.button === 0 && G.running) player.releaseAttack();
    if (e.pointerType === 'touch' || e.button === 2) dragging = false;
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', e => { dragging = false; player.releaseAttack(); });

  document.addEventListener('mousemove', e => {
    if (!G.running || G.over || ui.modalOpen) return;
    if (document.pointerLockElement === canvas) {
      lookBy(e.movementX || 0, e.movementY || 0);
      return;
    }
    if (!dragging) return;
    lookBy(e.clientX - lastX, e.clientY - lastY);
    lastX = e.clientX; lastY = e.clientY;
  });

  canvas.addEventListener('pointermove', e => {
    if (e.pointerType !== 'touch' || !dragging) return;
    lookBy(e.clientX - lastX, e.clientY - lastY);
    lastX = e.clientX; lastY = e.clientY;
  });

  canvas.addEventListener('wheel', e => {
    if (!G.running || player.firstPerson) return;
    e.preventDefault();
    player.camDist = clamp(player.camDist + Math.sign(e.deltaY) * 0.55, 2.8, 10.5);
  }, { passive: false });

  document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement !== canvas && player && player.firstPerson) {
      // keep first-person, but let the cursor breathe until the next click
      G.keys = G.keys || {};
    }
  });
}

function lookBy(dx, dy) {
  if (!player) return;
  if (player.firstPerson) {
    // mouse right must turn the view right. With our +Z-facing basis that
    // means decreasing yaw (Three.js Y-rotation is counter-clockwise).
    player.viewYaw -= dx * 0.0026;
    player.viewPitch = clamp(player.viewPitch - dy * 0.0022, -1.15, 1.15);
    player.facing = player.viewYaw;
    player.lastDrag = G.time;
  } else {
    player.camAngle -= dx * 0.005;
    player.camPitch = clamp(player.camPitch + dy * 0.0034, -0.16, 0.95);
    player.lastDrag = G.time;
  }
}

function ensurePointerLockIfFirstPerson() {
  const canvas = renderer && renderer.domElement;
  if (!canvas || !player || !player.firstPerson) return;
  if (document.pointerLockElement === canvas) return;
  try { canvas.requestPointerLock && canvas.requestPointerLock(); } catch (_) { /* noop */ }
}

/* ------------------------------------------------------------------ */
/*  Interaction                                                       */
/* ------------------------------------------------------------------ */
function findInteractable() {
  if (!G.running || G.over || !player || player.dead) return null;
  const p = player.pos;
  const candidates = [];

  for (const npc of world.npcList) {
    const d = Math.hypot(npc.pos.x - p.x, npc.pos.z - p.z);
    if (d < 3.1) candidates.push({ d, label: npc.interactLabel, run: () => npc.interact() });
  }

  for (const pickup of world.pickups) {
    if (!pickup.active) continue;
    const d = Math.hypot(pickup.pos.x - p.x, pickup.pos.z - p.z);
    if (d < 2.7) candidates.push({ d, label: pickup.interactLabel, run: () => pickup.interact() });
  }

  for (const id in world.altars) {
    const a = world.altars[id];
    const d = Math.hypot(a.x - p.x, a.z - p.z);
    if (d < 4.3 && !a.active) {
      candidates.push({ d, label: `Despertar ${a.name}`, run: () => world.activateAltar(id) });
    }
  }

  if (world.castleSeal) {
    const s = world.castleSeal;
    const d = Math.hypot(s.x - p.x, s.z - p.z);
    if (d < (s.radius || 4.6)) {
      candidates.push({ d, label: 'Examinar o Selo do Castelo', run: () => quests.inspectCastleSeal() });
    }
  }

  if (!candidates.length) return null;
  candidates.sort((a, b) => a.d - b.d);
  return candidates[0];
}

function updateInteractions() {
  if (!G.running || G.over || ui.modalOpen || player.dead) {
    currentInteract = null;
    ui.showInteract(null);
    return;
  }
  currentInteract = findInteractable();
  ui.showInteract(currentInteract ? currentInteract.label : null);
}

function interact() {
  if (ui.modalOpen || !currentInteract) return;
  const action = currentInteract.run;
  G.keys = {};
  action();
  currentInteract = null;
}

/* ------------------------------------------------------------------ */
/*  Mobile controls                                                   */
/* ------------------------------------------------------------------ */
function setupMobile() {
  if (!isTouch) return;
  const stick = $('stick');
  const knob = $('stickKnob');
  if (stick && knob) {
    let id = null;
    const max = 44;
    const setStick = (x, y, rect) => {
      let dx = x - (rect.left + rect.width / 2);
      let dy = y - (rect.top + rect.height / 2);
      const len = Math.hypot(dx, dy);
      if (len > max) { dx = dx / len * max; dy = dy / len * max; }
      knob.style.transform = `translate(${dx}px,${dy}px)`;
      player.joystick = new THREE.Vector3(dx / max, -dy / max, 0);
    };
    stick.addEventListener('pointerdown', e => {
      e.preventDefault();
      id = e.pointerId;
      stick.setPointerCapture(id);
      setStick(e.clientX, e.clientY, stick.getBoundingClientRect());
    });
    stick.addEventListener('pointermove', e => {
      if (e.pointerId !== id) return;
      e.preventDefault();
      setStick(e.clientX, e.clientY, stick.getBoundingClientRect());
    });
    const release = e => {
      if (id !== null && e.pointerId !== id) return;
      id = null;
      knob.style.transform = '';
      player.joystick = new THREE.Vector3();
    };
    stick.addEventListener('pointerup', release);
    stick.addEventListener('pointercancel', release);
  }

  document.querySelectorAll('.mbtn').forEach(btn => {
    const m = btn.dataset.m;
    let held = false;
    btn.addEventListener('pointerdown', e => {
      e.preventDefault();
      if (!G.running || ui.modalOpen || G.over) return;
      held = true;
      if (m === 'attack') player.pressAttack();
      else if (m === 'fire') player.magicDown('fire');
      else if (m === 'bolt') player.magicDown('bolt');
      else if (m === 'ice') player.magicDown('ice');
      else if (m === 'wind') player.magicDown('wind');
      else if (m === 'dodge') player.dodge();
      else if (m === 'interact') interact();
      else if (m === 'heal') player.usePotion();
    });
    const up = e => {
      e.preventDefault();
      if (!held) return;
      held = false;
      if (m === 'attack') player.releaseAttack();
      else if (m === 'fire') player.magicUp('fire');
    };
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', up);
    btn.addEventListener('pointerleave', up);
  });
}

/* ------------------------------------------------------------------ */
/*  Extra wiring                                                      */
/* ------------------------------------------------------------------ */
function bindGameplayExtras() {
  // pause automatically when the tab loses focus
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && G.running && !G.over) {
      ui.openPause();
      G.paused = true;
    }
  });

  // first-person crosshair follows the mode even if set elsewhere
  if (player) ui.setCrosshair(!!player.firstPerson);

  // debug handle for automated visual checks
  window.__aetheria = {
    G, ui, world, player, quests, effects, audio, camera, renderer, scene,
    start: startGame,
    teleport(x, z) { player.group.position.set(x, heightAt(x, z), z); player.updateCamera(0.016, true); },
    victory: () => handleBossDefeated(),
  };
}

function reportError(scope, err) {
  G.errors = (G.errors || 0) + 1;
  G.lastError = `${scope}: ${err && err.message ? err.message : err}`;
  if (G.errors <= 8) console.warn(`[Aetheria] ${G.lastError}`);
}

/* ------------------------------------------------------------------ */
/*  Main loop                                                         */
/* ------------------------------------------------------------------ */
function animate() {
  requestAnimationFrame(animate);
  if (!renderer || !scene || !camera) return;

  const dt = Math.min(G.clock ? G.clock.getDelta() : 0.016, 0.05);

  if (!G.running) {
    // title-screen camera: slow, cinematic orbit over the village
    menuT += dt;
    G.time += dt;
    if (world) world.update(dt);
    if (effects) effects.update(dt);
    const cx = 6 + Math.sin(menuT * 0.075) * 24;
    const cz = 28 + Math.cos(menuT * 0.075) * 24;
    const cy = heightAt(cx, cz) + 12;
    camera.position.lerp(new THREE.Vector3(cx, cy, cz), 1 - Math.exp(-dt * 1.4));
    camera.lookAt(6, heightAt(6, 28) + 4.2, 28);
    camera.fov += ((61 - camera.fov) * (1 - Math.exp(-dt * 2)));
    camera.updateProjectionMatrix();
    updateSunTarget();
    renderer.render(scene, camera);
    return;
  }

  const modal = ui.modalOpen || G.over;
  G.paused = !!modal || !G.running;

  if (!G.paused) {
    G.time += dt;
    const frozen = (G.hitStop || 0) > 0;
    if (frozen) G.hitStop = Math.max(0, G.hitStop - dt);
    const step = frozen ? dt * 0.16 : dt;

    try { player.update(step); } catch (err) { reportError('player', err); }
    try { player.tickPending(step); } catch (err) { reportError('pending', err); }
    try { world.update(step); } catch (err) { reportError('world', err); }

    const list = G.enemies;
    for (let i = 0; i < list.length; i++) {
      try { list[i].update(step); } catch (err) { reportError('enemy', err); }
    }

    try { effects.update(step); } catch (err) { reportError('effects', err); }
    try { updateInteractions(); } catch (err) { reportError('interactions', err); }
    updateSunTarget();

    if (G.time - lastHudPulse > 0.05) {
      lastHudPulse = G.time;
      try { ui.update(dt); } catch (err) { reportError('ui', err); }
    }
    updateProximityAudio();
    audio.update(dt);
  } else if (G.over) {
    if (world) world.update(dt * 0.4);
    if (effects) effects.update(dt * 0.4);
  }

  renderer.render(scene, camera);
}

function updateProximityAudio() {
  if (!audio || !audio.ready || !player) return;
  const p = player.pos;
  const river = Math.abs(p.x - riverX(p.z));
  const lake = Math.hypot(p.x - 58, p.z + 72);
  const water = clamp(1 - Math.min(river, lake) / 26, 0, 1);
  let fire = 0;
  for (const f of world.fireLights) {
    const d = Math.hypot(p.x - f.light.position.x, p.z - f.light.position.z);
    fire = Math.max(fire, clamp(1 - d / 15, 0, 1));
  }
  audio.setProximity({ water, fire, combat: 0 });
}

/* ------------------------------------------------------------------ */
/*  Go                                                                */
/* ------------------------------------------------------------------ */
boot();
