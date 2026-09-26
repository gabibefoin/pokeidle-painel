// Brasão de guild — SVG leve com escudo, emblema e três cores editáveis.
//
// Inspirado nos emblemas de MMO (camadas + slots de cor), sem dependência externa: cabe no
// quadrado 54×54 do painel e no editor de criação.

export const ESCUDOS = [
  { id: 'heater', nome: 'Heater' },
  { id: 'round', nome: 'Round' },
  { id: 'kite', nome: 'Kite' },
  { id: 'square', nome: 'Square' },
  { id: 'banner', nome: 'Banner' },
];

export const EMBLEMAS = [
  { id: 'star', nome: 'Star' },
  { id: 'bolt', nome: 'Bolt' },
  { id: 'leaf', nome: 'Leaf' },
  { id: 'skull', nome: 'Skull' },
  { id: 'diamond', nome: 'Diamond' },
  { id: 'heart', nome: 'Heart' },
  { id: 'crown', nome: 'Crown' },
  { id: 'sword', nome: 'Sword' },
  { id: 'flame', nome: 'Flame' },
  { id: 'moon', nome: 'Moon' },
  { id: 'shield', nome: 'Shield' },
  { id: 'claw', nome: 'Claw' },
];

export const BORDAS = [
  { id: 'none', nome: 'None' },
  { id: 'gold', nome: 'Gold' },
  { id: 'silver', nome: 'Silver' },
  { id: 'double', nome: 'Double' },
  { id: 'thick', nome: 'Thick' },
];

/** Paleta curta para o editor — tons que contrastam bem no escudo escuro. */
export const CORES_BRASAO = [
  '#4a2c6e', '#2d6a4f', '#1d3557', '#7f1d1d', '#3d2c1e', '#212529',
  '#ffd166', '#ef476f', '#06d6a0', '#118ab2', '#ffffff', '#fca311',
  '#e63946', '#8338ec', '#fb5607', '#ff006e',
];

const PATH_ESCUDO = {
  heater: 'M32 4 L56 12 L56 38 Q56 54 32 60 Q8 54 8 38 L8 12 Z',
  round: 'M32 6 A26 26 0 1 1 31.9 6 Z',
  kite: 'M32 4 L54 20 L44 58 L32 52 L20 58 L10 20 Z',
  square: 'M14 10 L50 10 L50 54 L14 54 Z',
  banner: 'M18 8 L46 8 L50 56 L32 48 L14 56 Z',
};

const PATH_EMBLEMA = {
  star: 'M32 14 L36 26 L48 26 L38 34 L42 46 L32 38 L22 46 L26 34 L16 26 L28 26 Z',
  bolt: 'M38 12 L22 34 H30 L26 52 L42 30 H34 Z',
  leaf: 'M32 14 Q48 22 48 38 Q48 50 32 54 Q16 50 16 38 Q16 22 32 14 Z M32 20 L32 48',
  skull: 'M32 16 Q20 16 18 28 Q16 38 22 42 L22 48 L28 44 L32 48 L36 44 L42 48 L42 42 Q48 38 46 28 Q44 16 32 16 Z M26 28 A3 3 0 1 0 26.1 28 M38 28 A3 3 0 1 0 38.1 28',
  diamond: 'M32 12 L48 32 L32 52 L16 32 Z M32 20 L40 32 L32 44 L24 32 Z',
  heart: 'M32 52 S14 40 14 28 Q14 18 22 18 Q28 18 32 24 Q36 18 42 18 Q50 18 50 28 Q50 40 32 52 Z',
  crown: 'M16 40 H48 V46 H16 Z M20 40 L24 22 L32 30 L40 22 L44 40',
  sword: 'M30 12 H34 V42 H30 Z M24 42 H40 V46 H24 Z M28 46 H36 V52 H28 Z',
  flame: 'M32 54 Q18 44 20 32 Q22 22 32 14 Q42 22 44 32 Q46 44 32 54 Z M32 48 Q38 42 36 34 Q34 28 32 26 Q30 28 28 34 Q26 42 32 48 Z',
  moon: 'M40 16 Q28 16 28 32 Q28 48 40 48 Q32 44 32 32 Q32 20 40 16 Z',
  shield: 'M32 12 L48 18 V34 Q48 46 32 52 Q16 46 16 34 V18 Z',
  claw: 'M24 20 L28 36 L20 44 M40 20 L36 36 L44 44 M32 16 L32 40 L26 52 L38 52',
};

const PADRAO = {
  escudo: 'heater',
  emblema: 'star',
  borda: 'none',
  bg: '#4a2c6e',
  pri: '#ffd166',
  sec: '#ffffff',
};

const STROKE_BORDA = {
  none: { w: 2, c: '#1a1018', w2: 0, c2: null },
  gold: { w: 3, c: '#ffd166', w2: 0, c2: null },
  silver: { w: 3, c: '#c0c0c0', w2: 0, c2: null },
  double: { w: 2, c: '#1a1018', w2: 4, c2: '#ffd166' },
  thick: { w: 5, c: '#212529', w2: 0, c2: null },
};

export function normalizarBrasao(b) {
  const raw = b && typeof b === 'object' ? b : {};
  return {
    escudo: PATH_ESCUDO[raw.escudo] ? raw.escudo : PADRAO.escudo,
    emblema: PATH_EMBLEMA[raw.emblema] ? raw.emblema : PADRAO.emblema,
    borda: STROKE_BORDA[raw.borda] ? raw.borda : PADRAO.borda,
    bg: CORES_BRASAO.includes(raw.bg) || /^#[0-9a-fA-F]{6}$/.test(raw.bg ?? '') ? raw.bg : PADRAO.bg,
    pri: CORES_BRASAO.includes(raw.pri) || /^#[0-9a-fA-F]{6}$/.test(raw.pri ?? '') ? raw.pri : PADRAO.pri,
    sec: CORES_BRASAO.includes(raw.sec) || /^#[0-9a-fA-F]{6}$/.test(raw.sec ?? '') ? raw.sec : PADRAO.sec,
  };
}

/** HTML do SVG (viewBox 64×64). */
export function svgBrasao(br, px = 54) {
  const b = normalizarBrasao(br);
  const esc = PATH_ESCUDO[b.escudo] ?? PATH_ESCUDO.heater;
  const emb = PATH_EMBLEMA[b.emblema] ?? PATH_EMBLEMA.star;
  const bd = STROKE_BORDA[b.borda] ?? STROKE_BORDA.none;
  const bordaExtra = bd.w2 && bd.c2
    ? `<path d="${esc}" fill="none" stroke="${bd.c2}" stroke-width="${bd.w2}"/>`
    : '';
  return `<svg class="gd-brasao" width="${px}" height="${px}" viewBox="0 0 64 64" aria-hidden="true">
    ${bordaExtra}
    <path d="${esc}" fill="${b.bg}" stroke="${bd.c}" stroke-width="${bd.w}"/>
    <path d="${emb}" fill="${b.pri}" stroke="${b.sec}" stroke-width="1.5" stroke-linejoin="round"/>
  </svg>`;
}

/** Monta o preview num elemento. */
export function pintarBrasao(el, brasao, px = 54) {
  if (!el) return;
  el.innerHTML = svgBrasao(brasao, px);
}
