/* Shared game namespace + tiny helpers to avoid circular imports. */
export const G = {
  scene: null, camera: null, renderer: null, clock: null,
  player: null, world: null, effects: null, ui: null, audio: null,
  enemies: [], npcs: [], interactables: [], pickups: [], projectiles: [],
  keys: {}, mouse: { left: false, right: false, x: 0, y: 0, dx: 0, dy: 0 },
  time: 0, dt: 0, paused: false, running: false, over: false,
  stats: { kills: 0, gold: 120, deaths: 0, startTime: 0, goblinsKilled: 0, shards: 0 },
  settings: { muted: false, quality: 2 },
  cameraMode: 'third',
  target: null,
  zone: 'Vila de Brisa',
  flags: {},
  debug: false,
  // stability telemetry: one bad spell or enemy must never stop the loop
  errors: 0,
  lastError: '',
};
export const isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
export function dist2d(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }
export function angleTo(a, b) { return Math.atan2(b.x - a.x, b.z - a.z); }
export function angleDiff(a, b) { let d = a - b; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; }
export function forwardOf(obj) { return { x: Math.sin(obj.rotation.y), z: Math.cos(obj.rotation.y) }; }
