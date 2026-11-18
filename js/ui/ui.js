import * as THREE from 'three';
import { G, isTouch } from '../core/state.js';
import { makePortrait, projectToScreen, clamp } from '../core/utils.js';
import { ROADS, riverX, heightAt } from '../world/terrain.js';

const $ = id => document.getElementById(id);

const PLAYER_PORTRAIT_CFG = {
  hair: '#2b2848', hair2: '#4a4478', eye: '#65e6d8',
  cloth: '#254a5f', cloth2: '#d8b45c', skin: '#f6c9a2',
  accessory: 'circlet', bg1: '#1d4250', bg2: '#08121c',
};

const COOLDOWN_MAX = { fire: 2.7, bolt: 4.5, ice: 3.4, dodge: 1.15 };
const DIRS = [
  [0, 'N'], [45, 'NE'], [90, 'L'], [135, 'SE'], [180, 'S'], [225, 'SO'], [270, 'O'], [315, 'NO'], [360, 'N'],
];

/* ================================================================== */
/*  Interface                                                         */
/* ================================================================== */
export class UI {
  constructor() {
    this.el = {};
    for (const id of [
      'hud', 'portrait', 'levelBadge', 'hpFill', 'hpText', 'mpFill', 'mpText', 'stFill',
      'compassBar', 'zoneTitle', 'minimap', 'goldText', 'potionText', 'questTitle',
      'questObjectives', 'bossBar', 'bossName', 'bossPhase', 'bossFill', 'bossGhost',
      'enemyBars', 'skillbar', 'interactPrompt', 'interactText', 'lockHint', 'toast',
      'subtitle', 'crosshair', 'damageLayer', 'dialogue', 'dlgPortrait', 'dlgName',
      'dlgText', 'dlgChoices', 'dlgNext', 'shopPanel', 'shopTitle', 'shopGold',
      'shopItems', 'shopFoot', 'mapPanel', 'bigmap', 'pausePanel', 'helpText',
      'pausePanel', 'ending', 'endingTitle', 'endingText', 'endingStats', 'mobile',
      'loading', 'loadFill', 'loadTip', 'start', 'startBtn', 'resumeBtn', 'helpBtn',
      'muteBtn', 'restartBtn', 'againBtn', 'continueBtn', 'flash', 'grade',
    ]) this.el[id] = $(id);
    this.el.dlgNext = document.querySelector('.dlg-next');

    this.dialogueOpen = false;
    this.dialogueNodes = [];
    this.dialogueIndex = 0;
    this.dialogueOnClose = null;
    this.shopKind = null;
    this.shopPayload = null;
    this.activePanel = null;
    this.zone = '';
    this.lastHeading = -999;
    this.mapTimer = 0;
    this.compassTimer = 0;
    this.lastGold = -1;
    this.lastLevel = -1;
    this.chargeHideT = 0;
    this.callbacks = {};

    this.drawPlayerPortrait();
    this.buildChargeRing();
    this.wire();
    this.updateHUD(true);
  }

  /* ------------------------------------------------------------------ */
  /*  Setup                                                             */
  /* ------------------------------------------------------------------ */
  drawPlayerPortrait() {
    const c = makePortrait(PLAYER_PORTRAIT_CFG);
    const ctx = this.el.portrait.getContext('2d');
    ctx.clearRect(0, 0, 128, 128);
    ctx.drawImage(c, 0, 0, 128, 128);
  }

  buildChargeRing() {
    const ring = document.createElement('div');
    ring.className = 'charge-ring';
    ring.style.display = 'none';
    this.el.hud.appendChild(ring);
    this.chargeRing = ring;
    const label = document.createElement('div');
    label.className = 'charge-label';
    label.style.display = 'none';
    this.chargeLabel = label;
    this.el.hud.appendChild(label);
  }

  wire() {
    this.el.startBtn.addEventListener('click', () => this.callbacks.start && this.callbacks.start());
    this.el.resumeBtn.addEventListener('click', () => this.callbacks.resume && this.callbacks.resume());
    this.el.restartBtn.addEventListener('click', () => this.callbacks.restart && this.callbacks.restart());
    this.el.againBtn.addEventListener('click', () => this.callbacks.restart && this.callbacks.restart());
    if (this.el.continueBtn) this.el.continueBtn.addEventListener('click', () => this.callbacks.continue && this.callbacks.continue());
    this.el.muteBtn.addEventListener('click', () => this.callbacks.mute && this.callbacks.mute());
    this.el.helpBtn.addEventListener('click', () => this.el.helpText.classList.toggle('hidden'));

    document.querySelectorAll('[data-close]').forEach(btn => {
      btn.addEventListener('click', () => this.closePanel());
    });
    for (const id of ['shopPanel', 'mapPanel', 'pausePanel']) {
      const p = this.el[id];
      if (!p) continue;
      p.addEventListener('pointerdown', e => { if (e.target === p) this.closePanel(); });
    }
    this.el.dialogue.addEventListener('pointerdown', e => {
      if (e.target.closest('button')) return;
      this.advanceDialogue();
    });
    this.el.skillbar.addEventListener('pointerdown', e => {
      const sk = e.target.closest('.skill');
      if (!sk || !G.player) return;
      e.preventDefault();
      const name = sk.dataset.skill;
      if (name === 'sword') G.player.pressAttack();
      else if (name === 'dodge') G.player.dodge();
      else if (name === 'heal') G.player.usePotion();
      else G.player.magicDown(name);
    });
    this.el.skillbar.addEventListener('pointerup', e => {
      const sk = e.target.closest('.skill');
      if (!sk || !G.player) return;
      const name = sk.dataset.skill;
      if (name === 'sword') G.player.releaseAttack();
      else if (name !== 'dodge' && name !== 'heal') G.player.magicUp(name);
    });
  }

  bind(cbs) { Object.assign(this.callbacks, cbs); }

  get modalOpen() { return this.dialogueOpen || this.activePanel !== null; }

  /* ------------------------------------------------------------------ */
  /*  Loading / start / ending                                          */
  /* ------------------------------------------------------------------ */
  setLoading(pct, tip) {
    if (!this.el.loadFill) return;
    this.el.loadFill.style.width = Math.round(clamp(pct, 0, 100)) + '%';
    if (tip && this.el.loadTip) this.el.loadTip.textContent = tip;
  }

  hideLoading() {
    const l = this.el.loading;
    if (!l) return;
    l.style.opacity = '0';
    setTimeout(() => l.classList.add('hidden'), 750);
  }

  beginGame() {
    this.el.start.classList.add('hidden');
    this.el.hud.classList.remove('hidden');
    if (isTouch) this.el.mobile.classList.remove('hidden');
    this.setCrosshair(false);
    this.toast('Bem-vindo a Aetheria, viajante.', 'good');
    this.subtitle('Siga a estrada até a praça e fale com a Anciã Mira.');
  }

  showEnding(stats = {}) {
    this.closePanel(false);
    this.hideDialogue(false);
    this.el.ending.classList.remove('hidden');
    this.el.endingTitle.textContent = 'O Cristal Desperta';
    this.el.endingText.textContent = 'Grimmjaw caiu. O acampamento goblin se dispersa, os três altares cantam juntos e a luz volta a correr sob as ruínas. Aetheria respira outra vez.';
    const items = [
      ['Goblins abatidos', stats.goblinsKilled ?? 0],
      ['Nível', stats.level ?? 1],
      ['Ouro', stats.gold ?? 0],
      ['Tempo', stats.time || '—'],
    ];
    this.el.endingStats.innerHTML = items.map(([k, v]) => `<div>${k}<b>${v}</b></div>`).join('');
  }

  setMuteButton(muted) {
    if (this.el.muteBtn) this.el.muteBtn.textContent = muted ? 'Som: desligado' : 'Som: ligado';
  }

  /* ------------------------------------------------------------------ */
  /*  Panels / pause / map                                              */
  /* ------------------------------------------------------------------ */
  openPanel(id) {
    if (this.activePanel && this.activePanel !== id) {
      const old = this.el[this.activePanel]; if (old) old.classList.add('hidden');
    }
    const p = this.el[id];
    if (!p) return;
    p.classList.remove('hidden');
    this.activePanel = id;
    if (G.audio) G.audio.sfx('ui');
  }

  closePanel(silent = false) {
    if (!this.activePanel) return;
    const p = this.el[this.activePanel];
    if (p) p.classList.add('hidden');
    this.activePanel = null;
    if (!silent && G.audio) G.audio.sfx('ui');
  }

  openPause() {
    this.openPanel('pausePanel');
    this.el.helpText.classList.add('hidden');
  }
  closePause() { if (this.activePanel === 'pausePanel') this.closePanel(); }

  toggleMap() {
    if (this.activePanel === 'mapPanel') { this.closePanel(); return; }
    if (this.activePanel || this.dialogueOpen) return;
    this.openMap();
  }
  openMap() {
    this.openPanel('mapPanel');
    this.drawBigMap();
  }

  /* ------------------------------------------------------------------ */
  /*  Dialogue                                                          */
  /* ------------------------------------------------------------------ */
  openDialogue({ name, title, portrait, nodes, onClose }) {
    if (!nodes || !nodes.length) { if (onClose) onClose(); return; }
    this.closePanel(true);
    this.dialogueOpen = true;
    this.dialogueNodes = nodes;
    this.dialogueIndex = 0;
    this.dialogueOnClose = onClose || null;
    this.el.dialogue.classList.remove('hidden');
    this.el.dlgName.textContent = title ? `${name} · ${title}` : name;
    if (portrait) {
      const ctx = this.el.dlgPortrait.getContext('2d');
      ctx.clearRect(0, 0, 160, 160);
      ctx.drawImage(portrait, 0, 0, 160, 160);
    }
    this.renderDialogue();
    if (G.audio) G.audio.sfx('ui');
  }

  renderDialogue() {
    const node = this.dialogueNodes[this.dialogueIndex];
    if (!node) { this.hideDialogue(); return; }
    this.el.dlgText.innerHTML = node.text || '';
    this.el.dlgChoices.innerHTML = '';
    if (node.choices && node.choices.length) {
      if (this.el.dlgNext) this.el.dlgNext.style.visibility = 'hidden';
      node.choices.forEach(c => {
        const b = document.createElement('button');
        b.textContent = c.label;
        b.addEventListener('click', () => {
          if (G.audio) G.audio.sfx('ui');
          try { c.action && c.action(); } catch (err) { console.warn(err); }
          if (this.dialogueOpen) this.advanceDialogue();
        });
        this.el.dlgChoices.appendChild(b);
      });
    } else {
      if (this.el.dlgNext) this.el.dlgNext.style.visibility = 'visible';
    }
  }

  advanceDialogue() {
    if (!this.dialogueOpen) return;
    const node = this.dialogueNodes[this.dialogueIndex];
    if (node && node.choices && node.choices.length) return;
    this.dialogueIndex++;
    if (this.dialogueIndex >= this.dialogueNodes.length) this.hideDialogue();
    else { this.renderDialogue(); if (G.audio) G.audio.sfx('ui'); }
  }

  hideDialogue(callClose = true) {
    if (!this.dialogueOpen) return;
    this.dialogueOpen = false;
    this.el.dialogue.classList.add('hidden');
    const cb = this.dialogueOnClose;
    this.dialogueOnClose = null;
    this.dialogueNodes = [];
    if (callClose && cb) cb();
  }

  /* ------------------------------------------------------------------ */
  /*  Shop                                                              */
  /* ------------------------------------------------------------------ */
  openShop({ title, subtitle, items, kind }) {
    this.hideDialogue(true);
    if (!kind) {
      if (/forja/i.test(title)) kind = 'brann';
      else if (/bancada/i.test(title)) kind = 'lys';
      else if (/mercador/i.test(title)) kind = 'tuli';
    }
    this.shopKind = kind || null;
    this.shopPayload = { title, subtitle, items };
    this.el.shopTitle.textContent = title;
    this.renderShop();
    this.openPanel('shopPanel');
  }

  renderShop() {
    const data = this.shopPayload;
    if (!data) return;
    const p = G.player;
    this.el.shopGold.textContent = p ? p.gold : 0;
    if (this.el.shopFoot) this.el.shopFoot.textContent = data.subtitle || 'Melhorias permanentes. Escolha com sabedoria.';
    this.el.shopItems.innerHTML = '';
    data.items.forEach((it, idx) => {
      const row = document.createElement('div');
      row.className = 'shop-item' + (it.owned ? ' owned' : '');
      row.innerHTML = `
        <div class="shop-ico">${it.icon || '✦'}</div>
        <div class="shop-main"><b>${it.title}</b><span>${it.desc}</span></div>`;
      const btn = document.createElement('button');
      btn.className = 'buyBtn';
      if (it.owned) { btn.textContent = it.ownedLabel || 'Esgotado'; btn.disabled = true; }
      else {
        btn.textContent = `✦ ${it.cost}`;
        const affordable = p && p.gold >= it.cost;
        btn.disabled = !affordable;
        btn.addEventListener('click', () => {
          if (!G.player || G.player.gold < it.cost) {
            this.toast('Ouro insuficiente', 'warn');
            if (G.audio) G.audio.sfx('error');
            return;
          }
          G.player.gold -= it.cost;
          G.stats.gold = G.player.gold;
          if (it.action) it.action();
          this.el.shopGold.textContent = G.player.gold;
          this.updateHUD(true);
          if (!G.ui || this.shopKind === null) this.renderShop();
        });
      }
      row.appendChild(btn);
      this.el.shopItems.appendChild(row);
    });
  }

  refreshShop() {
    if (this.shopKind && G.quests && this.activePanel === 'shopPanel') {
      const kind = this.shopKind;
      G.quests.openShop(kind);
    } else if (this.shopPayload) {
      this.renderShop();
    }
    this.el.shopGold.textContent = G.player ? G.player.gold : 0;
  }

  /* ------------------------------------------------------------------ */
  /*  Quest / boss / toast                                              */
  /* ------------------------------------------------------------------ */
  setQuest(title, objectives = [], sides = []) {
    if (this.el.questTitle.textContent !== title) this.el.questTitle.textContent = title;
    const rows = [];
    for (const o of objectives) {
      const count = o.count ? ` <span class="count">${o.count}</span>` : '';
      rows.push(`<div class="q-obj ${o.done ? 'done' : ''} ${o.small ? 'small' : ''}"><span class="dot">${o.done ? '✓' : '◆'}</span><span>${o.text}${count}</span></div>`);
    }
    for (const s of sides) rows.push(`<div class="q-obj side"><span class="dot">◇</span><span>${s.text}</span></div>`);
    this.el.questObjectives.innerHTML = rows.join('');
  }

  setZone(z) {
    if (this.zone === z) return;
    this.zone = z;
    this.el.zoneTitle.textContent = z;
  }

  toast(text, type = '') {
    const div = document.createElement('div');
    div.className = 'toast-line';
    if (type) div.dataset.type = type;
    if (type === 'gold') div.style.color = '#ffe7a0';
    if (type === 'warn') div.style.color = '#ffb0a0';
    if (type === 'good') div.style.color = '#b8ffd4';
    div.innerHTML = text;
    this.el.toast.appendChild(div);
    while (this.el.toast.children.length > 4) this.el.toast.firstChild.remove();
    setTimeout(() => {
      div.style.transition = 'opacity .4s';
      div.style.opacity = '0';
      setTimeout(() => div.remove(), 420);
    }, 2900);
  }

  subtitle(text, duration = 4.5) {
    clearTimeout(this.subTimer);
    this.el.subtitle.textContent = text;
    this.el.subtitle.style.opacity = '1';
    this.subTimer = setTimeout(() => {
      this.el.subtitle.style.transition = 'opacity .8s';
      this.el.subtitle.style.opacity = '0';
    }, duration * 1000);
  }

  showBoss(name, phase, frac) {
    this.el.bossBar.classList.remove('hidden');
    this.el.bossName.textContent = name;
    this.el.bossPhase.textContent = phase;
    this.updateBoss(frac, phase);
  }
  updateBoss(frac, phase) {
    const s = clamp(frac, 0, 1);
    this.el.bossFill.style.transform = `scaleX(${s})`;
    this.el.bossGhost.style.transform = `scaleX(${s})`;
    if (phase) this.el.bossPhase.textContent = phase;
  }
  hideBoss() { this.el.bossBar.classList.add('hidden'); }

  /* ------------------------------------------------------------------ */
  /*  Combat feedback                                                    */
  /* ------------------------------------------------------------------ */
  damage(value, pos, type = 'physical', crit = false) {
    if (!G.camera) return;
    const s = projectToScreen(pos, G.camera, innerWidth, innerHeight);
    if (!s.visible) return;
    const d = document.createElement('div');
    d.className = 'dmg ' + type + (crit ? ' crit' : '');
    let txt = value;
    if (typeof value === 'number') txt = (type === 'heal' ? '+' : '-') + Math.abs(Math.round(value));
    d.textContent = txt;
    d.style.left = s.x + 'px';
    d.style.top = s.y + 'px';
    this.el.damageLayer.appendChild(d);
    while (this.el.damageLayer.children.length > 70) this.el.damageLayer.firstChild.remove();
    setTimeout(() => d.remove(), 900);
  }

  popHeal(pos) { this.damage('+50', pos, 'heal'); }

  hurtFlash() {
    this.el.flash.style.background = 'radial-gradient(circle at 50% 50%, transparent 30%, rgba(255,40,60,.55) 100%)';
    this.el.flash.style.opacity = '1';
    clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => { this.el.flash.style.opacity = '0'; }, 90);
  }

  screenFlash(alpha = .3, color = 0xffffff) {
    this.el.flash.style.background = `#${(color >>> 0).toString(16).padStart(6, '0')}`;
    this.el.flash.style.opacity = String(alpha);
    clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => { this.el.flash.style.opacity = '0'; }, 70);
  }

  flashSkill(name) {
    const el = this.el.skillbar.querySelector(`[data-skill="${name}"]`);
    if (!el) return;
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 360);
  }

  setCrosshair(show) { this.el.crosshair.classList.toggle('hidden', !show); }

  setCharge(ratio, kind) {
    if (!ratio || ratio <= 0) {
      this.chargeRing.style.display = 'none';
      this.chargeLabel.style.display = 'none';
      return;
    }
    const r = clamp(ratio, 0, 1);
    const color = kind === 'fire' ? '255,150,70' : '255,220,140';
    this.chargeRing.style.display = 'block';
    this.chargeRing.style.background = `conic-gradient(rgba(${color},.95) ${r * 360}deg, rgba(255,255,255,.09) 0deg)`;
    this.chargeRing.style.boxShadow = `0 0 18px rgba(${color},${.25 + r * .45})`;
    this.chargeLabel.style.display = 'block';
    this.chargeLabel.textContent = kind === 'fire' ? 'FOGO' : 'CORTE';
    this.chargeLabel.style.color = kind === 'fire' ? '#ffc08a' : '#ffe8b0';
  }

  levelBurst() {
    const d = document.createElement('div');
    d.className = 'levelup';
    d.innerHTML = `<span>NÍVEL ${G.player ? G.player.level : 1}</span>`;
    this.el.hud.appendChild(d);
    setTimeout(() => d.remove(), 1900);
  }

  showInteract(text) {
    if (!text) { this.el.interactPrompt.classList.add('hidden'); return; }
    this.el.interactText.textContent = text;
    this.el.interactPrompt.classList.remove('hidden');
  }

  /* ------------------------------------------------------------------ */
  /*  Per-frame HUD                                                     */
  /* ------------------------------------------------------------------ */
  update(dt) {
    this.updateHUD(false);
    this.mapTimer -= dt;
    this.compassTimer -= dt;
    if (this.mapTimer <= 0) { this.mapTimer = .12; this.drawMinimap(); }
    if (this.compassTimer <= 0) { this.compassTimer = .1; this.updateCompass(); }
  }

  updateHUD(force = false) {
    const p = G.player;
    if (!p) return;
    const hp = clamp(p.hp / p.maxHp, 0, 1);
    const mp = clamp(p.mp / p.maxMp, 0, 1);
    const st = clamp(p.stamina / p.maxStamina, 0, 1);
    this.el.hpFill.style.transform = `scaleX(${hp})`;
    this.el.mpFill.style.transform = `scaleX(${mp})`;
    this.el.stFill.style.transform = `scaleX(${st})`;
    this.el.hpText.textContent = `${Math.max(0, Math.ceil(p.hp))} / ${p.maxHp}`;
    this.el.mpText.textContent = `${Math.floor(p.mp)} / ${p.maxMp}`;
    if (force || this.lastLevel !== p.level) {
      this.lastLevel = p.level;
      this.el.levelBadge.textContent = p.level;
    }
    if (force || this.lastGold !== p.gold) {
      this.lastGold = p.gold;
      this.el.goldText.textContent = p.gold;
      this.el.potionText.textContent = `Poções ${p.potions}`;
    }
    this.el.lockHint.classList.toggle('hidden', !p.lockedTarget);
    if (p.lockedTarget && p.lockedTarget.dead) { p.lockedTarget = null; G.target = null; }

    // cooldown overlays
    for (const k of ['fire', 'bolt', 'ice']) {
      const el = this.el.skillbar.querySelector(`[data-skill="${k}"]`);
      if (!el) continue;
      const cd = p.cooldowns[k] || 0;
      const ratio = clamp(cd / COOLDOWN_MAX[k], 0, 1);
      const fill = el.querySelector('.sk-cd');
      if (fill) fill.style.transform = `scaleY(${ratio})`;
      el.classList.toggle('cooling', ratio > .02);
    }
    const dodgeEl = this.el.skillbar.querySelector('[data-skill="dodge"]');
    if (dodgeEl) {
      const r = clamp((p.dodgeCd || 0) / COOLDOWN_MAX.dodge, 0, 1);
      const fill = dodgeEl.querySelector('.sk-cd');
      if (fill) fill.style.transform = `scaleY(${r})`;
      dodgeEl.classList.toggle('cooling', r > .02);
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Compass                                                           */
  /* ------------------------------------------------------------------ */
  updateCompass() {
    const p = G.player;
    if (!p || !this.el.compassBar) return;
    const yaw = p.firstPerson ? p.viewYaw : p.camAngle + Math.PI;
    let heading = Math.atan2(Math.sin(yaw), -Math.cos(yaw)) * 180 / Math.PI;
    heading = ((heading % 360) + 360) % 360;
    if (Math.abs(heading - this.lastHeading) < .25) return;
    this.lastHeading = heading;

    let html = '';
    for (let d = 0; d < 360; d += 15) {
      let rel = d - heading;
      while (rel > 180) rel -= 360;
      while (rel < -180) rel += 360;
      if (Math.abs(rel) > 78) continue;
      const left = 50 + rel / 78 * 50;
      const label = DIRS.find(([deg]) => deg === d);
      if (label) html += `<span class="compass-tick major" style="left:${left}%">${label[1]}</span>`;
      else html += `<span class="compass-tick" style="left:${left}%">·</span>`;
    }
    const wp = G.world && G.world.waypoint;
    if (wp) {
      const dx = wp.x - p.pos.x, dz = wp.z - p.pos.z;
      let bearing = Math.atan2(dx, -dz) * 180 / Math.PI;
      bearing = ((bearing % 360) + 360) % 360;
      let rel = bearing - heading;
      while (rel > 180) rel -= 360;
      while (rel < -180) rel += 360;
      if (Math.abs(rel) <= 78) {
        const left = 50 + rel / 78 * 50;
        html += `<span class="compass-mark" style="left:${left}%;color:#ffd479">◆</span>`;
      }
    }
    this.el.compassBar.innerHTML = html;
  }

  /* ------------------------------------------------------------------ */
  /*  Minimap                                                           */
  /* ------------------------------------------------------------------ */
  drawMinimap() {
    const p = G.player;
    if (!p) return;
    const c = this.el.minimap;
    const ctx = c.getContext('2d');
    const W = c.width, H = c.height, cx = W / 2, cy = H / 2;
    const s = .62;
    const px = p.pos.x, pz = p.pos.z;
    const wx = x => cx + (x - px) * s;
    const wy = z => cy + (z - pz) * s;

    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, W / 2, 0, Math.PI * 2); ctx.clip();
    const bg = ctx.createRadialGradient(cx, cy, 8, cx, cy, W / 2);
    bg.addColorStop(0, '#1a3b45'); bg.addColorStop(1, '#0a1722');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

    // water: river + lake
    ctx.strokeStyle = 'rgba(80,205,205,.42)';
    ctx.lineWidth = 8 * s;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.beginPath();
    for (let z = pz - 130; z <= pz + 130; z += 6) {
      const x = riverX(z);
      if (z === pz - 130) ctx.moveTo(wx(x), wy(z)); else ctx.lineTo(wx(x), wy(z));
    }
    ctx.stroke();
    ctx.fillStyle = 'rgba(76,195,205,.35)';
    ctx.beginPath(); ctx.ellipse(wx(58), wy(-78), 20 * s, 20 * s, 0, 0, Math.PI * 2); ctx.fill();

    // roads
    ctx.strokeStyle = 'rgba(226,198,142,.32)';
    ctx.lineWidth = 1.5;
    for (const r of ROADS) {
      ctx.beginPath();
      r.pts.forEach(([x, z], i) => { if (i === 0) ctx.moveTo(wx(x), wy(z)); else ctx.lineTo(wx(x), wy(z)); });
      ctx.stroke();
    }

    // village ring
    ctx.strokeStyle = 'rgba(255,212,121,.22)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(wx(0), wy(32), 34 * s, 0, Math.PI * 2); ctx.stroke();

    // POIs
    for (const poi of (G.world ? G.world.mapPOIs : [])) {
      const x = wx(poi.x), y = wy(poi.z);
      if (x < -10 || x > W + 10 || y < -10 || y > H + 10) continue;
      ctx.font = poi.major ? 'bold 15px Georgia' : '12px Georgia';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = poi.kind === 'danger' ? '#ff8a7a' : poi.kind === 'castle' ? '#c8d8ff' : '#ffe0a0';
      ctx.fillText(poi.icon || '◆', x, y);
    }

    // altars
    if (G.world) {
      for (const id in G.world.altars) {
        const a = G.world.altars[id];
        const x = wx(a.x), y = wy(a.z);
        if (x < 0 || x > W || y < 0 || y > H) continue;
        ctx.fillStyle = a.active ? '#7ff0c0' : '#ffd479';
        ctx.font = '11px Georgia'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('◆', x, y);
      }
    }

    // NPCs
    if (G.world) {
      for (const npc of G.world.npcList) {
        const x = wx(npc.pos.x), y = wy(npc.pos.z);
        if (x < 0 || x > W || y < 0 || y > H) continue;
        ctx.fillStyle = '#ffe8b0';
        ctx.beginPath(); ctx.arc(x, y, 2.4, 0, Math.PI * 2); ctx.fill();
        if (npc.markerSymbol) {
          ctx.fillStyle = '#ffd479'; ctx.font = 'bold 10px Georgia'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
          ctx.fillText(npc.markerSymbol, x, y - 3);
        }
      }
    }

    // enemies
    for (const e of G.enemies) {
      if (e.dead) continue;
      const x = wx(e.group.position.x), y = wy(e.group.position.z);
      if (x < 0 || x > W || y < 0 || y > H) continue;
      ctx.fillStyle = e.isBoss ? '#ff5a3a' : '#ff7d6a';
      ctx.beginPath(); ctx.arc(x, y, e.isBoss ? 5 : 2.2, 0, Math.PI * 2); ctx.fill();
      if (e.isBoss) { ctx.strokeStyle = '#ffd479'; ctx.lineWidth = 1; ctx.stroke(); }
    }

    // waypoint
    const wp = G.world && G.world.waypoint;
    if (wp) {
      let x = wx(wp.x), y = wy(wp.z);
      const dx = x - cx, dy = y - cy;
      const d = Math.hypot(dx, dy);
      if (d > W / 2 - 10) { const k = (W / 2 - 10) / d; x = cx + dx * k; y = cy + dy * k; }
      ctx.fillStyle = '#ffd479';
      ctx.font = 'bold 14px Georgia'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(wp.icon || '◆', x, y);
    }

    // player arrow
    const yaw = p.firstPerson ? p.viewYaw : p.camAngle + Math.PI;
    const ang = Math.atan2(Math.cos(yaw), Math.sin(yaw));
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(ang);
    ctx.fillStyle = '#fff6dc';
    ctx.strokeStyle = 'rgba(10,20,30,.9)'; ctx.lineWidth = 1.3;
    ctx.beginPath(); ctx.moveTo(7, 0); ctx.lineTo(-4.5, 4.5); ctx.lineTo(-2.5, 0); ctx.lineTo(-4.5, -4.5); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();

    // N marker
    ctx.fillStyle = 'rgba(255,235,190,.65)';
    ctx.font = 'bold 10px Georgia'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText('N', cx, 5);

    ctx.restore();
    ctx.strokeStyle = 'rgba(255,212,121,.22)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, W / 2 - 1, 0, Math.PI * 2); ctx.stroke();
  }

  /* ------------------------------------------------------------------ */
  /*  Big map                                                           */
  /* ------------------------------------------------------------------ */
  drawBigMap() {
    const c = this.el.bigmap;
    if (!c) return;
    const ctx = c.getContext('2d');
    const W = c.width, H = c.height;
    const s = 2.45;
    const cx = W / 2, cy = H / 2 + 4;
    const wx = x => cx + x * s;
    const wy = z => cy + z * s;
    ctx.clearRect(0, 0, W, H);

    const bg = ctx.createRadialGradient(cx, cy, 40, cx, cy, W * .6);
    bg.addColorStop(0, '#173b3c'); bg.addColorStop(.6, '#102a2e'); bg.addColorStop(1, '#08141d');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

    // faint contour rings
    ctx.strokeStyle = 'rgba(255,255,255,.035)'; ctx.lineWidth = 1;
    for (let r = 40; r < 180; r += 24) {
      ctx.beginPath(); ctx.arc(cx, cy, r * s, 0, Math.PI * 2); ctx.stroke();
    }

    // water
    ctx.fillStyle = 'rgba(70,190,200,.34)';
    ctx.beginPath(); ctx.ellipse(wx(58), wy(-78), 20 * s, 20 * s, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(90,220,225,.5)';
    ctx.lineWidth = 10;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.beginPath();
    for (let z = -140; z <= 140; z += 5) {
      const x = riverX(z);
      if (z === -140) ctx.moveTo(wx(x), wy(z)); else ctx.lineTo(wx(x), wy(z));
    }
    ctx.stroke();

    // roads
    ctx.strokeStyle = 'rgba(230,205,150,.5)'; ctx.lineWidth = 1.7;
    for (const r of ROADS) {
      ctx.beginPath();
      r.pts.forEach(([x, z], i) => { if (i === 0) ctx.moveTo(wx(x), wy(z)); else ctx.lineTo(wx(x), wy(z)); });
      ctx.stroke();
    }

    // mountains at the rim
    ctx.fillStyle = 'rgba(120,126,150,.28)';
    for (let i = 0; i < 22; i++) {
      const a = i / 22 * Math.PI * 2;
      const rr = 130 + Math.sin(i * 2.7) * 8;
      const x = wx(Math.cos(a) * rr), y = wy(Math.sin(a) * rr);
      ctx.beginPath(); ctx.moveTo(x - 10, y + 7); ctx.lineTo(x, y - 14); ctx.lineTo(x + 10, y + 7); ctx.closePath(); ctx.fill();
    }

    // village ring + castle ring
    ctx.strokeStyle = 'rgba(255,212,121,.15)';
    ctx.setLineDash([4, 5]);
    ctx.beginPath(); ctx.arc(wx(0), wy(32), 34 * s, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(170,200,255,.18)';
    ctx.beginPath(); ctx.arc(wx(0), wy(-105), 36 * s, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);

    // POIs
    for (const poi of (G.world ? G.world.mapPOIs : [])) {
      const x = wx(poi.x), y = wy(poi.z);
      const color = poi.kind === 'danger' ? '#ff9a86' : poi.kind === 'castle' ? '#c8d8ff' : poi.kind === 'town' ? '#ffe6a8' : '#d8e8d8';
      ctx.fillStyle = 'rgba(8,16,22,.7)';
      ctx.beginPath(); ctx.arc(x, y, poi.major ? 12 : 9, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = color + '77'; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = color;
      ctx.font = `${poi.major ? 'bold ' : ''}${poi.major ? 14 : 12}px Georgia`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(poi.icon || '◆', x, y + 1);
      if (poi.major) {
        ctx.font = '10px Arial'; ctx.fillStyle = 'rgba(230,244,242,.72)';
        ctx.textBaseline = 'top';
        ctx.fillText(poi.name, x, y + 14);
      }
    }

    // NPCs
    if (G.world) for (const npc of G.world.npcList) {
      const x = wx(npc.pos.x), y = wy(npc.pos.z);
      ctx.fillStyle = '#ffe8b0';
      ctx.beginPath(); ctx.arc(x, y, 2.6, 0, Math.PI * 2); ctx.fill();
    }

    // enemies
    for (const e of G.enemies) {
      if (e.dead) continue;
      const x = wx(e.group.position.x), y = wy(e.group.position.z);
      ctx.fillStyle = e.isBoss ? '#ff5a3a' : 'rgba(255,120,100,.75)';
      ctx.beginPath(); ctx.arc(x, y, e.isBoss ? 6 : 2.1, 0, Math.PI * 2); ctx.fill();
    }

    // quest waypoint
    const wp = G.world && G.world.waypoint;
    if (wp) {
      const x = wx(wp.x), y = wy(wp.z);
      ctx.fillStyle = '#ffd479';
      ctx.font = 'bold 16px Georgia'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(wp.icon || '◆', x, y);
      ctx.strokeStyle = 'rgba(255,212,121,.5)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(x, y, 10 + Math.sin((G.time || 0) * 3) * 2, 0, Math.PI * 2); ctx.stroke();
    }

    // player
    const p = G.player;
    if (p) {
      const x = wx(p.pos.x), y = wy(p.pos.z);
      const yaw = p.firstPerson ? p.viewYaw : p.camAngle + Math.PI;
      const ang = Math.atan2(Math.cos(yaw), Math.sin(yaw));
      ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
      ctx.fillStyle = '#fff6dc'; ctx.strokeStyle = 'rgba(8,16,22,.9)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(11, 0); ctx.lineTo(-7, 7); ctx.lineTo(-4, 0); ctx.lineTo(-7, -7); ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.restore();
      ctx.fillStyle = 'rgba(255,246,220,.9)';
      ctx.font = 'bold 11px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText('VOCÊ', x, y + 11);
    }

    // compass rose
    ctx.save();
    ctx.translate(W - 56, H - 60);
    ctx.strokeStyle = 'rgba(255,225,170,.4)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(0, 0, 24, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = 'rgba(255,235,190,.8)'; ctx.font = 'bold 11px Georgia'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('N', 0, -30);
    ctx.beginPath(); ctx.moveTo(0, -22); ctx.lineTo(5, 3); ctx.lineTo(0, -2); ctx.lineTo(-5, 3); ctx.closePath();
    ctx.fillStyle = 'rgba(255,225,170,.6)'; ctx.fill();
    ctx.restore();
  }
}
