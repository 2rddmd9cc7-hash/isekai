import { G } from '../core/state.js';
import { makePortrait } from '../core/utils.js';
import { ELEMENTS, ELEMENT_ORDER, spellOf } from '../combat/spells.js';

const NPC_INFO = {
  mira: { name: 'Anciã Mira', title: 'Guardiã do Cristal', cfg: { hair: '#d9d4e8', hair2: '#f2edff', eye: '#65e6d8', cloth: '#2c5a63', cloth2: '#d8b45c', accessory: 'circlet', skin: '#e2b58e', bg1: '#1d4250' } },
  brann: { name: 'Brann', title: 'Ferreiro', cfg: { hair: '#8a4a2a', hair2: '#c47a3a', eye: '#ffb84a', cloth: '#5a4632', cloth2: '#a3723d', accessory: 'beard', skin: '#d9a274', bg1: '#3a2a1a' } },
  lys: { name: 'Lys', title: 'Alquimista', cfg: { hair: '#6a4a8a', hair2: '#a882d8', eye: '#8ff0b8', cloth: '#2f5058', cloth2: '#8fd8b8', skin: '#f0c39b', bg1: '#1e3a3a' } },
  tuli: { name: 'Tuli', title: 'Mercador', cfg: { hair: '#c4692a', hair2: '#f0a04a', eye: '#ffd76e', cloth: '#6a3a35', cloth2: '#e0b25a', skin: '#c98a5a', bg1: '#3a2a1a' } },
  rowan: { name: 'Capitão Rowan', title: 'Guarda de Aetheria', cfg: { hair: '#3a3a4a', hair2: '#5a5a70', eye: '#6ab8ff', cloth: '#3a5a7a', cloth2: '#c8d6e4', skin: '#e8b98a', bg1: '#20303a' } },
};

const ALTAR_INFO = {
  shrine: { name: 'Altar do Santuário', pos: { x: 12, z: -20 } },
  ruins: { name: 'Altar das Ruínas', pos: { x: 36, z: -52 } },
  cave: { name: 'Altar da Caverna', pos: { x: -76, z: 7 } },
};

export class QuestSystem {
  constructor() {
    this.quests = {
      q1: { title: 'Ecos de Aetheria', state: 'available', shards: 0 },
      q2: { title: 'A Sombra do Acampamento', state: 'locked' },
      brann: { title: 'A Forja de Brann', state: 'available' },
      lys: { title: 'Ervas da Lys', state: 'available' },
      tuli: { title: 'Caçada de Tuli', state: 'available' },
    };
    this.items = { ore: 0, flower: 0 };
    this.tuliKills = 0;
    this.purchases = { sword: 0, vitality: 0, magic: 0, mana: 0, amulet: false };
    this.portraits = {};
    for (const id in NPC_INFO) {
      const cfg = NPC_INFO[id].cfg;
      this.portraits[id] = makePortrait({ ...cfg, accessory: cfg.accessory });
    }
    this.lastTracker = '';
  }

  /* ------------------------------------------------------------------ */
  /*  Helpers                                                            */
  /* ------------------------------------------------------------------ */
  get q1() { return this.quests.q1; }
  get q2() { return this.quests.q2; }

  open(npcId, nodes) {
    const info = NPC_INFO[npcId];
    if (!G.ui) return;
    G.ui.openDialogue({
      name: info ? info.name : npcId,
      title: info ? info.title : '',
      portrait: this.portraits[npcId],
      nodes,
      onClose: () => this.refresh(),
    });
  }

  toast(t, type = '') { if (G.ui) G.ui.toast(t, type); }
  sfx(n) { if (G.audio) G.audio.sfx(n); }

  refresh() {
    // main quest tracker
    let title = 'Prólogo · O Cristal Adormecido';
    let objectives = [{ text: 'Fale com a Anciã Mira na praça da Vila de Brisa', done: false }];
    if (this.q1.state === 'active') {
      title = 'Ecos de Aetheria';
      const active = this.activeAltars();
      objectives = [
        { text: 'Desperte os Altares de Aetheria', count: `${this.q1.shards}/3`, done: this.q1.shards >= 3 },
        ...Object.entries(ALTAR_INFO).map(([id, info]) => ({
          text: info.name, done: !!active[id], small: true,
        })),
      ];
      if (this.q1.shards >= 3) objectives.push({ text: 'Retorne à Anciã Mira', done: false, highlight: true });
    } else if (this.q1.state === 'complete' && this.q2.state === 'available') {
      title = 'Ecos de Aetheria';
      objectives = [{ text: 'Receba a próxima missão com Mira', done: false, highlight: true }];
    } else if (this.q2.state === 'active') {
      title = 'A Sombra do Acampamento';
      const chief = G.world && G.world.chief;
      objectives = [
        { text: chief && chief.dead ? 'Grimmjaw foi derrotado' : 'Derrote Grimmjaw, o chefe goblin', done: !!(chief && chief.dead) },
        { text: 'Siga a fumaça a oeste da vila', done: false, small: true },
      ];
    } else if (this.q2.state === 'complete') {
      title = 'Aetheria Renasce';
      objectives = [{ text: 'O cristal voltou a brilhar. Explore o reino.', done: true }];
    } else if (this.q1.state === 'complete' && this.q2.state === 'locked') {
      title = 'Ecos de Aetheria';
      objectives = [{ text: 'Converse com Mira sobre a ameaça goblin', done: false, highlight: true }];
    }
    // side quests summary
    const sides = [];
    for (const id of ['brann', 'lys', 'tuli']) {
      const q = this.quests[id];
      if (q.state === 'active') {
        let text = q.title;
        if (id === 'brann') text += ` · Minério ${Math.min(3, this.items.ore)}/3`;
        if (id === 'lys') text += ` · Luaflor ${Math.min(4, this.items.flower)}/4`;
        if (id === 'tuli') text += ` · Goblins ${Math.min(5, this.tuliKills)}/5`;
        sides.push({ text, side: true, done: false });
      }
    }
    const sig = JSON.stringify([title, objectives, sides]);
    if (sig !== this.lastTracker) {
      this.lastTracker = sig;
      if (G.ui) G.ui.setQuest(title, objectives, sides);
    }
    // waypoint marker
    if (G.world && G.world.updateWaypoint) G.world.updateWaypoint(this.getWaypoint());
  }

  activeAltars() {
    const active = {};
    if (G.world && G.world.altars) for (const k in G.world.altars) if (G.world.altars[k].active) active[k] = true;
    return active;
  }

  getWaypoint() {
    if (this.q1.state === 'available') {
      const p = G.world && G.world.npcs ? G.world.npcs.mira : null;
      if (p) return { x: p.group.position.x, z: p.group.position.z, label: 'Mira', icon: '!' };
    }
    if (this.q1.state === 'active') {
      const active = this.activeAltars();
      for (const id of ['shrine', 'ruins', 'cave']) {
        if (!active[id]) {
          const alt = G.world && G.world.altarPositions ? G.world.altarPositions[id] : ALTAR_INFO[id].pos;
          return { x: alt.x, z: alt.z, label: ALTAR_INFO[id].name, icon: '◆' };
        }
      }
      const p = G.world && G.world.npcs ? G.world.npcs.mira : null;
      if (p) return { x: p.group.position.x, z: p.group.position.z, label: 'Mira', icon: '?' };
    }
    if (this.q2.state === 'available') {
      const p = G.world && G.world.npcs ? G.world.npcs.mira : null;
      if (p) return { x: p.group.position.x, z: p.group.position.z, label: 'Mira', icon: '!' };
    }
    if (this.q2.state === 'active') {
      if (G.world && G.world.chief && !G.world.chief.dead) return { x: G.world.chief.group.position.x, z: G.world.chief.group.position.z, label: 'Grimmjaw', icon: '☠' };
    }
    return null;
  }

  npcMarker(id) {
    if (id === 'mira') {
      if (this.q1.state === 'available') return '!';
      if (this.q1.state === 'active' && this.q1.shards >= 3) return '?';
      if (this.q1.state === 'complete' && this.q2.state === 'available') return '!';
      return '';
    }
    const q = this.quests[id];
    if (!q) return '';
    if (q.state === 'available') return '!';
    if (q.state === 'active') {
      if (id === 'brann' && this.items.ore >= 3) return '?';
      if (id === 'lys' && this.items.flower >= 4) return '?';
      if (id === 'tuli' && this.tuliKills >= 5) return '?';
      return '◆';
    }
    return '';
  }

  /* ------------------------------------------------------------------ */
  /*  Events                                                             */
  /* ------------------------------------------------------------------ */
  addItem(kind, name) {
    this.items[kind]++;
    this.toast(`Coletou ${name} (${this.items[kind]})`, 'good');
    if (G.audio) G.audio.sfx('pickup');
    this.refresh();
  }

  onAltarActivated(id) {
    if (this.q1.state !== 'active') return;
    if (this.q1.shards < 3) this.q1.shards++;
    if (this.q1.shards >= 3) {
      this.toast('Os três altares despertaram! Volte a Mira.', 'good');
      if (G.audio) G.audio.sfx('quest');
    }
    this.refresh();
  }

  onEnemyKilled(e) {
    if (this.quests.tuli.state === 'active' && e.type !== 'chief') {
      this.tuliKills++;
      this.toast(`Caçada: goblin abatido (${Math.min(5, this.tuliKills)}/5)`);
      this.refresh();
    }
  }

  onBossDefeated() {
    this.q2.state = 'complete';
    this.refresh();
  }

  /* ------------------------------------------------------------------ */
  /*  Dialogue                                                           */
  /* ------------------------------------------------------------------ */
  talk(id) {
    if (id === 'mira') return this.talkMira();
    if (id === 'brann') return this.talkBrann();
    if (id === 'lys') return this.talkLys();
    if (id === 'tuli') return this.talkTuli();
    if (id === 'rowan') return this.talkRowan();
  }

  talkMira() {
    const q1 = this.q1, q2 = this.q2;
    if (q1.state === 'available') {
      this.open('mira', [
        { text: 'Então você é o viajante que o cristal chamou. Sinto a marca de Aetheria em você, <em>Kael</em>.' },
        { text: 'A luz do reino está se apagando. Três altares antigos guardam fragmentos do Cristal Primordial: o Santuário de Sakura, as Ruínas de Astra e a Caverna Cristalina.' },
        { text: 'Desperte os três altares. Mas cuidado — os goblins desceram das colinas e não estão sozinhos.', choices: [
          { label: 'Aceitar: Ecos de Aetheria', action: () => this.acceptQ1() },
          { label: 'Ainda não', action: () => {} },
        ] },
      ]);
      return;
    }
    if (q1.state === 'active') {
      const nodes = [
        { text: `Os altares aguardam. Sinto ${q1.shards} de 3 fragmentos despertos. Cada altar tem seus guardiões.` },
        { text: 'O Santuário fica a leste da estrada ao norte. As Ruínas, além da ponte. A Caverna, a oeste, perto do acampamento goblin. Siga os marcadores dourados.' },
      ];
      if (q1.shards >= 3) nodes.unshift({ text: 'A luz retornou aos altares! Você conseguiu, viajante.', choices: [{ label: 'Receber recompensa', action: () => this.completeQ1() }] });
      else nodes.push({ text: 'Aetheria resiste enquanto houver alguém disposto a caminhar por ela.', choices: [{ label: 'Seguir em frente', action: () => {} }] });
      this.open('mira', nodes);
      return;
    }
    if (q1.state === 'complete' && q2.state === 'available') {
      this.open('mira', [
        { text: 'Os fragmentos cantam de novo. Mas há uma sombra no oeste: Grimmjaw, o chefe dos goblins, acampou perto das Ruínas.' },
        { text: 'Ele carrega um caco do cristal roubado. Enquanto ele viver, a luz não se firmará. Vá até o acampamento e encerre isso.', choices: [
          { label: 'Aceitar: A Sombra do Acampamento', action: () => this.acceptQ2() },
          { label: 'Preciso me preparar', action: () => {} },
        ] },
      ]);
      return;
    }
    if (q2.state === 'active') {
      this.open('mira', [
        { text: 'Grimmjaw é enorme, mas lento. Observe o chão: quando a luz vermelha aparecer, saia da área. Esquive-se, não bloqueie.' },
        { text: 'Leve poções. E lembre-se: o gelo o torna lento; o raio interrompe seus rituais. Use o que Aetheria lhe deu.', choices: [{ label: 'Entendido', action: () => {} }] },
      ]);
      return;
    }
    this.open('mira', [{ text: 'Aetheria volta a respirar. O cristal brilha no alto do castelo, e os goblins recuaram para as colinas.' }, { text: 'Descanse, viajante. Mas não guarde a espada por muito tempo — o mundo ainda é grande.', choices: [{ label: 'Despedir-se', action: () => {} }] }]);
  }

  acceptQ1() {
    this.q1.state = 'active';
    this.sfx('quest');
    this.toast('Nova missão: Ecos de Aetheria', 'good');
    this.refresh();
    if (G.world) G.world.refreshMarkers();
  }
  completeQ1() {
    this.q1.state = 'complete';
    this.q2.state = 'available';
    const p = G.player;
    p.addXP(140); p.addGold(110); p.potions += 2;
    G.stats.shards = 3;
    this.sfx('quest');
    this.toast('Missão concluída! +110 ouro, +2 poções', 'gold');
    this.refresh();
    if (G.world) G.world.refreshMarkers();
  }
  acceptQ2() {
    this.q2.state = 'active';
    this.sfx('war');
    this.toast('Nova missão: A Sombra do Acampamento', 'warn');
    this.refresh();
    if (G.world) G.world.refreshMarkers();
    if (G.ui) G.ui.subtitle('Siga para o oeste. A fumaça do acampamento goblin mancha o céu.');
  }

  talkBrann() {
    const q = this.quests.brann;
    const shop = { label: 'Ver a forja', action: () => this.openShop('brann') };
    if (q.state === 'available') {
      this.open('brann', [
        { text: 'Ha! Um rosto novo. Essa espada está afiada, mas o aço de Aetheria merece mais.' },
        { text: 'Traga <em>3 minérios de ferro</em> das ruínas, do acampamento ou da mina ao noroeste. Eu reforço sua lâmina sem cobrar um tostão.', choices: [
          { label: 'Aceitar: A Forja de Brann', action: () => { q.state = 'active'; this.toast('Missão: A Forja de Brann', 'good'); this.sfx('ui'); this.refresh(); } },
          shop,
        ] },
      ]);
      return;
    }
    if (q.state === 'active') {
      const nodes = [{ text: this.items.ore >= 3 ? 'Três minérios! Isso sim é aço de verdade. Deixe comigo.' : `Minério de ferro: ${this.items.ore}/3. Procure veios brilhantes nas ruínas, no acampamento goblin ou na mina.` }];
      if (this.items.ore >= 3) {
        nodes.push({ choices: [
          { label: 'Entregar o minério', action: () => this.completeBrann() },
          shop,
        ] });
      } else nodes.push({ choices: [shop, { label: 'Continuar procurando', action: () => {} }] });
      this.open('brann', nodes);
      return;
    }
    this.open('brann', [{ text: 'A lâmina canta quando você a move. Isso é bom sinal. Quer melhorar mais alguma coisa?', choices: [shop, { label: 'Adeus', action: () => {} }] }]);
  }
  completeBrann() {
    this.items.ore -= 3;
    this.quests.brann.state = 'complete';
    G.player.upgrade('sword');
    G.player.addGold(60);
    this.sfx('quest');
    this.toast('Lâmina reforjada! Dano da espada aumentou.', 'good');
    this.refresh();
  }

  talkLys() {
    const q = this.quests.lys;
    const shop = { label: 'Ver poções', action: () => this.openShop('lys') };
    if (q.state === 'available') {
      this.open('lys', [
        { text: 'Shh… cuidado com os vapores. Esta é a bancada mais delicada da vila.' },
        { text: 'Preciso de <em>4 luaflores</em> para estabilizar uma essência. Elas brilham ao anoitecer, perto do santuário e do lago. Traga-as e eu ampliarei seu dom arcano.', choices: [
          { label: 'Aceitar: Ervas da Lys', action: () => { q.state = 'active'; this.toast('Missão: Ervas da Lys', 'good'); this.sfx('ui'); this.refresh(); } },
          shop,
        ] },
      ]);
      return;
    }
    if (q.state === 'active') {
      const nodes = [{ text: this.items.flower >= 4 ? 'Perfeitas! Veja como elas brilham. Sua mana vai cantar.' : `Luaflor: ${this.items.flower}/4. Elas crescem em manchas azul-prateadas — olhe perto do santuário e das margens do lago.` }];
      if (this.items.flower >= 4) {
        nodes.push({ choices: [
          { label: 'Entregar as luaflores', action: () => this.completeLys() },
          shop,
        ] });
      } else nodes.push({ choices: [shop, { label: 'Continuar procurando', action: () => {} }] });
      this.open('lys', nodes);
      return;
    }
    this.open('lys', [{ text: 'As essências estão estáveis. Se precisar de mana ou poções, é comigo.', choices: [shop, { label: 'Adeus', action: () => {} }] }]);
  }
  completeLys() {
    this.items.flower -= 4;
    this.quests.lys.state = 'complete';
    G.player.upgrade('magic');
    G.player.potions += 2;
    this.sfx('heal');
    this.toast('Dom arcano ampliado! +2 poções.', 'good');
    this.refresh();
  }

  talkTuli() {
    const q = this.quests.tuli;
    const shop = { label: 'Ver mercadorias', action: () => this.openShop('tuli') };
    if (q.state === 'available') {
      this.open('tuli', [
        { text: 'Mercadorias frescas! Sedas de Porto Claro, especiarias de Darun… e informações, se o preço for justo.' },
        { text: 'Os goblins estão atacando as caravanas. Abata <em>5 goblins</em> e eu pagarei bem. O que me diz?', choices: [
          { label: 'Aceitar: Caçada de Tuli', action: () => { q.state = 'active'; this.tuliKills = 0; this.toast('Missão: Caçada de Tuli', 'good'); this.sfx('ui'); this.refresh(); } },
          shop,
        ] },
      ]);
      return;
    }
    if (q.state === 'active') {
      const nodes = [{ text: `Goblins abatidos: ${Math.min(5, this.tuliKills)}/5. ${this.tuliKills >= 5 ? 'Excelente trabalho! Aqui está o combinado.' : 'Ainda não é o bastante. Eles estão por toda parte a oeste.'}` }];
      if (this.tuliKills >= 5) nodes.push({ choices: [
        { label: 'Receber recompensa', action: () => this.completeTuli() },
        shop,
      ] });
      else nodes.push({ choices: [shop, { label: 'Voltar à caçada', action: () => {} }] });
      this.open('tuli', nodes);
      return;
    }
    this.open('tuli', [{ text: 'Um prazer negociar com alguém que cumpre acordos. Veja o que trouxe hoje.', choices: [shop, { label: 'Adeus', action: () => {} }] }]);
  }
  completeTuli() {
    this.quests.tuli.state = 'complete';
    G.player.addGold(90);
    G.player.potions += 1;
    this.sfx('quest');
    this.toast('Caçada concluída! +90 ouro, +1 poção', 'gold');
    this.refresh();
  }

  talkRowan() {
    this.open('rowan', [
      { text: 'Os portões do Castelo de Aetheria estão selados. O cristal no alto da torre dorme, e o capitão não abre as portas sem a luz dele.' },
      { text: 'Se você realmente é o viajante de que Mira fala… talvez seja você quem vai reacender aquele cristal. Até lá, ninguém entra.', choices: [{ label: 'Entendido', action: () => {} }] },
    ]);
  }

  /* ------------------------------------------------------------------ */
  /*  Castle seal — verifies which magic the player currently controls  */
  /* ------------------------------------------------------------------ */
  inspectCastleSeal() {
    const p = G.player;
    if (!p || !G.ui) return;
    const element = p.element || 'fire';
    const info = ELEMENTS[element] || ELEMENTS.fire;
    const spell = p.currentSpell ? p.currentSpell() : spellOf(element, 0);
    const counts = p.castCounts || {};
    const used = ELEMENT_ORDER.filter(k => (counts[k] || 0) > 0);
    const usedLabel = used.length ? used.map(k => `${ELEMENTS[k].icon} ${ELEMENTS[k].name}`).join(' · ') : 'nenhum elemento conjurado ainda';
    const verified = !!G.flags.castleSealVerified;
    const castLabel = spell.cast > .05 ? `${spell.cast.toFixed(2)}s` : 'instantânea';
    const nodes = [
      { text: 'O selo de pedra do Castelo de Aetheria pulsa quando você se aproxima. Runas antigas sobem do chão e leem a marca em sua mão esquerda.' },
      { text: `Magia ativa: <b>${info.icon} ${spell.name}</b> — ${info.name}.<br>Custo: <b>${spell.cost} mana</b> · Conjuração: <b>${castLabel}</b> · Recarga: <b>${spell.cd}s</b>.<br><span style="opacity:.75">${spell.desc}</span>` },
      { text: `Elementos já conjurados: <b>${usedLabel}</b>.<br>${verified ? 'O selo reconhece sua assinatura e repousa.' : 'Conjure ao menos uma magia de cada elemento e retorne para que o selo confirme seu domínio.'}` },
      { text: 'Escolha a sintonia que deseja apresentar ao selo:', choices: [
        ...ELEMENT_ORDER.map(k => ({
          label: `${ELEMENTS[k].icon} ${ELEMENTS[k].name}`,
          action: () => { p.selectElement(k); this.toast(`Sintonia: ${ELEMENTS[k].name} · ${p.currentSpell().name}`, 'good'); },
        })),
        { label: 'Verificar meu domínio', action: () => this.verifyCastleSeal() },
      ] },
    ];
    G.ui.openDialogue({
      name: 'Selo do Castelo',
      title: 'Guardião de Aetheria',
      portrait: this.portraits.mira,
      nodes,
      onClose: () => this.refresh(),
    });
  }

  verifyCastleSeal() {
    const p = G.player;
    if (!p) return;
    const counts = p.castCounts || {};
    const used = ELEMENT_ORDER.filter(k => (counts[k] || 0) > 0);
    if (used.length >= ELEMENT_ORDER.length) {
      if (!G.flags.castleSealVerified) {
        G.flags.castleSealVerified = true;
        p.addXP(120);
        p.addGold(80);
        p.potions += 1;
        if (G.audio) G.audio.sfx('quest');
        if (G.effects) G.effects.levelUp(p.pos.clone());
        if (G.ui) G.ui.toast('Selo do Castelo: domínio elemental confirmado! +120 XP, +80 ouro, +1 poção', 'gold');
      } else if (G.ui) {
        G.ui.toast('O selo já reconhece seu domínio elemental.', 'good');
      }
      return;
    }
    const missing = ELEMENT_ORDER.filter(k => !(counts[k] > 0)).map(k => ELEMENTS[k].name).join(', ');
    if (G.ui) G.ui.toast(`O selo ainda não sente: ${missing}.`, 'warn');
    if (G.audio) G.audio.sfx('error');
  }

  /* ------------------------------------------------------------------ */
  /*  Shops                                                             */
  /* ------------------------------------------------------------------ */
  openShop(kind) {
    if (!G.ui) return;
    const p = G.player;
    const items = [];
    const add = (icon, title, desc, cost, action, owned = false, ownedLabel = 'Esgotado') => items.push({ icon, title, desc, cost, action, owned, ownedLabel });
    if (kind === 'brann') {
      const sw = this.purchases.sword;
      add('⚔', 'Reforjar a lâmina', sw >= 3 ? 'Aço de Aetheria no limite.' : 'Dano da espada +4,5 e +2% crítico.', sw >= 3 ? 0 : [90, 180, 300][sw], () => { p.upgrade('sword'); this.purchases.sword++; this.afterBuy(); }, sw >= 3);
      const vit = this.purchases.vitality;
      add('🛡', 'Armadura de viajante', vit >= 2 ? 'Sua armadura está completa.' : 'Vida máxima +25 e cura total.', vit >= 2 ? 0 : [100, 170][vit], () => { p.upgrade('vitality'); this.purchases.vitality++; this.afterBuy(); }, vit >= 2);
      add('🧪', 'Poção de Aetheria', 'Recupera 50 de vida e 30 de mana.', 28, () => { p.potions++; this.afterBuy(); });
      this.uiShop('Forja de Brann', 'Martelo, bigorna e aço de verdade.', items);
    } else if (kind === 'lys') {
      const mg = this.purchases.magic;
      add('✦', 'Essência arcana', mg >= 2 ? 'Sua essência está saturada.' : 'Dano mágico +6 e mana máxima +10.', mg >= 2 ? 0 : [120, 210][mg], () => { p.upgrade('magic'); this.purchases.magic++; this.afterBuy(); }, mg >= 2);
      const mn = this.purchases.mana;
      add('🔷', 'Cristal de mana', mn >= 2 ? 'Nenhum cristal resta.' : 'Mana máxima +25.', mn >= 2 ? 0 : [70, 120][mn], () => { p.maxMp += 25; p.mp = p.maxMp; this.purchases.mana++; this.afterBuy(); }, mn >= 2);
      add('🧪', '2× Poção de Aetheria', 'Duas doses de vida e mana.', 46, () => { p.potions += 2; this.afterBuy(); });
      this.uiShop('Bancada de Lys', 'Essências, cristais e vapores duvidosos.', items);
    } else {
      add('🧪', 'Poção de Aetheria', 'Recupera 50 de vida e 30 de mana.', 32, () => { p.potions++; this.afterBuy(); });
      add('🪶', 'Amuleto do Caçador', this.purchases.amulet ? 'Já está com você.' : 'Crítico +6%. Uma peça única.', this.purchases.amulet ? 0 : 160, () => { p.critChance = Math.min(.5, p.critChance + .06); this.purchases.amulet = true; this.afterBuy(); }, this.purchases.amulet);
      add('🍖', 'Provisões de viagem', 'Recupera vida totalmente ao comprar.', 40, () => { p.hp = p.maxHp; p.mp = p.maxMp; this.afterBuy(); });
      this.uiShop('Mercadorias de Tuli', 'Tudo o que um viajante precisa — quase tudo.', items);
    }
  }
  uiShop(title, subtitle, items) {
    G.ui.openShop({ title, subtitle, items, kind: this._shopKind });
  }
  afterBuy() {
    this.sfx('coin');
    if (G.ui && G.ui.refreshShop) G.ui.refreshShop();
    this.refresh();
  }

  openShopWrap(kind) { this._shopKind = kind; this.openShop(kind); }
}
