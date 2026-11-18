/* ================================================================== */
/*  Aetheria — elemental spell codex                                  */
/*                                                                    */
/*  Every element owns five genuinely different spells. The data      */
/*  here is shared by the player, the HUD and the castle sanctum so   */
/*  there is a single source of truth (no more "same spell, new      */
/*  colour" fallbacks).                                               */
/* ================================================================== */

export const ELEMENTS = {
  fire: {
    id: 'fire', name: 'Fogo', short: 'FOGO', icon: '🔥', color: 0xff7a3a, accent: '#ffb05c',
    rune: '#ffb05c', desc: 'Pressão e explosão. Queima e pune grupos.',
    glyph: '✦',
  },
  ice: {
    id: 'ice', name: 'Gelo', short: 'GELO', icon: '❄', color: 0x8fe9ff, accent: '#bfefff',
    rune: '#8fe9ff', desc: 'Controle. Congela, atrasa e isola alvos.',
    glyph: '❅',
  },
  bolt: {
    id: 'bolt', name: 'Raio', short: 'RAIO', icon: '⚡', color: 0xffe86a, accent: '#fff2a8',
    rune: '#ffe98e', desc: 'Velocidade. Executa à distância e em cadeia.',
    glyph: 'ϟ',
  },
  wind: {
    id: 'wind', name: 'Vento', short: 'VENTO', icon: '🍃', color: 0x9df0c0, accent: '#d8ffe8',
    rune: '#9df0c0', desc: 'Movimento. Empurra, puxa e reposiciona.',
    glyph: '≋',
  },
};

/* Ordered to match the 1 / 2 / 3 / 4 quick-cast keys. */
export const ELEMENT_ORDER = ['fire', 'bolt', 'ice', 'wind'];

/* kind drives the cast routine in player.js
   shape: projectile | cone | nova | target | chain | rain | dash | beam */
export const SPELLS = {
  fire: [
    {
      id: 'fireSpark', name: 'Faísca Ígnea', kind: 'projectile', icon: '🔥', cost: 8, cd: 1.1, cast: .28,
      dmg: .78, speed: 24, radius: 1.6, burn: 0, color: 0xff8a3a,
      desc: 'Projétil rápido e barato. Bom para terminar alvos feridos.',
    },
    {
      id: 'fireLance', name: 'Lança de Fogo', kind: 'projectile', icon: '🗡', cost: 16, cd: 2.8, cast: .52,
      dmg: 1.55, speed: 19, radius: 2.4, burn: 2, pierce: true, scale: 1.25, color: 0xff6a2a,
      desc: 'Lança incandescente que atravessa a linha inimiga e explode.',
    },
    {
      id: 'fireWave', name: 'Onda Ígnea', kind: 'cone', icon: '🌋', cost: 20, cd: 4.2, cast: .62,
      dmg: 1.35, range: 6.4, arc: 2.3, burn: 2, color: 0xff7a3a,
      desc: 'Leque de chamas curto. Acerta vários inimigos à frente.',
    },
    {
      id: 'fireMeteor', name: 'Meteorito', kind: 'rain', icon: '☄', cost: 32, cd: 8, cast: .95,
      dmg: 2.5, radius: 3.8, delay: .55, color: 0xff7a2a,
      desc: 'Marca o solo e derruba uma rocha em chamas. Dano em área.',
    },
    {
      id: 'fireCrown', name: 'Coroa Solar', kind: 'nova', icon: '☀', cost: 34, cd: 9.5, cast: .75,
      dmg: 1.9, radius: 5.4, burn: 3, color: 0xffb04a,
      desc: 'Explosão ao redor do conjurador. Queima tudo por perto.',
    },
  ],
  ice: [
    {
      id: 'iceShard', name: 'Estilhaço', kind: 'projectile', icon: '❄', cost: 8, cd: 1.2, cast: .3,
      dmg: .74, speed: 28, radius: 1.6, freeze: .9, color: 0x9fefff,
      desc: 'Lasca veloz de gelo. Congela brevemente no impacto.',
    },
    {
      id: 'iceLance', name: 'Lança Glacial', kind: 'projectile', icon: '🧊', cost: 16, cd: 3.2, cast: .55,
      dmg: 1.35, speed: 22, radius: 2.3, freeze: 2.4, pierce: true, scale: 1.35, color: 0x8fe9ff,
      desc: 'Perfura a linha de frente e prende o alvo no gelo.',
    },
    {
      id: 'iceNova', name: 'Nova Glacial', kind: 'nova', icon: '✳', cost: 24, cd: 6, cast: .7,
      dmg: 1.05, radius: 4.8, freeze: 2.2, color: 0xbfefff,
      desc: 'Onda de frio ao redor. Congela todos os inimigos próximos.',
    },
    {
      id: 'icePrison', name: 'Prisão de Gelo', kind: 'target', icon: '🔒', cost: 20, cd: 7, cast: .55,
      dmg: .5, range: 18, freeze: 4.2, color: 0xa8f4ff,
      desc: 'Sela um alvo distante em um sarcófago de gelo.',
    },
    {
      id: 'iceBreath', name: 'Sopro de Inverno', kind: 'cone', icon: '🌬', cost: 18, cd: 4.5, cast: .55,
      dmg: 1.0, range: 7, arc: 1.8, freeze: 1.4, slow: 3, color: 0xd8fbff,
      desc: 'Névoa congelante em cone. Congela e atrasa os sobreviventes.',
    },
  ],
  bolt: [
    {
      id: 'boltSpark', name: 'Faísca', kind: 'target', icon: '⚡', cost: 9, cd: 1.4, cast: .22,
      dmg: .82, range: 16, radius: 1.4, stun: .25, color: 0xffe86a,
      desc: 'Descarga instantânea. Interrompe conjurações curtas.',
    },
    {
      id: 'boltChain', name: 'Cadeia Elétrica', kind: 'chain', icon: '🔗', cost: 20, cd: 4.2, cast: .48,
      dmg: 1.05, range: 15, jumps: 3, radius: 6.5, stun: .35, color: 0xffe86a,
      desc: 'Salta entre até três inimigos próximos.',
    },
    {
      id: 'boltLance', name: 'Lança Trovejante', kind: 'beam', icon: '➶', cost: 24, cd: 5.2, cast: .6,
      dmg: 1.75, range: 18, width: 1.9, stun: .5, color: 0xfff2a8,
      desc: 'Raio em linha reta. Atravessa tudo no caminho.',
    },
    {
      id: 'boltStorm', name: 'Tempestade', kind: 'rain', icon: '🌩', cost: 34, cd: 9, cast: .85,
      dmg: 1.25, radius: 5.2, delay: .35, strikes: 4, color: 0xffe86a,
      desc: 'Quatro descargas caem em sequência na área marcada.',
    },
    {
      id: 'boltCascade', name: 'Cascata Estática', kind: 'nova', icon: '⚡', cost: 28, cd: 7.5, cast: .65,
      dmg: 1.4, radius: 5, stun: .8, color: 0xfff0a0,
      desc: 'Explosão elétrica ao redor. Atordoa e empurra.',
    },
  ],
  wind: [
    {
      id: 'windBlade', name: 'Lâmina de Vento', kind: 'projectile', icon: '🍃', cost: 7, cd: .95, cast: .24,
      dmg: .7, speed: 26, radius: 1.8, color: 0x9df0c0, crescent: true,
      desc: 'Crescente cortante, rápido e barato.',
    },
    {
      id: 'windGust', name: 'Vendaval', kind: 'cone', icon: '🌪', cost: 16, cd: 3.4, cast: .5,
      dmg: 1.0, range: 7, arc: 2.5, knockback: 9, color: 0xb8ffe0,
      desc: 'Rajada em cone que empurra os inimigos para longe.',
    },
    {
      id: 'windCyclone', name: 'Ciclone', kind: 'target', icon: '🌀', cost: 24, cd: 6.5, cast: .7,
      dmg: 1.2, range: 16, radius: 3.6, pull: 1.3, color: 0xa8f0d0,
      desc: 'Vórtice que puxa os inimigos para o centro.',
    },
    {
      id: 'windStep', name: 'Passo do Vento', kind: 'dash', icon: '💨', cost: 14, cd: 4, cast: .16,
      dmg: .9, distance: 6.5, radius: 2.0, color: 0xd8ffe8, invuln: .3,
      desc: 'Impulso cortante. Reposiciona e fere quem estiver no caminho.',
    },
    {
      id: 'windPetal', name: 'Tempestade de Pétalas', kind: 'nova', icon: '🌸', cost: 30, cd: 9, cast: .8,
      dmg: 1.55, radius: 5.6, slow: 2.5, color: 0xffc4d8,
      desc: 'Pétalas cortantes giram ao redor, ferindo e atrasando.',
    },
  ],
};

export function spellOf(element, index) {
  const list = SPELLS[element] || SPELLS.fire;
  return list[Math.max(0, Math.min(list.length - 1, index | 0))];
}

export function elementInfo(element) {
  return ELEMENTS[element] || ELEMENTS.fire;
}

export function allSpells() {
  const out = [];
  for (const el of ELEMENT_ORDER) {
    SPELLS[el].forEach((spell, index) => out.push({ element: el, index, spell }));
  }
  return out;
}
