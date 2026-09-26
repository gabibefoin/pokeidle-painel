// O som da TM Disk Piece que cai de boss — sem navegador e sem servidor.
//
//     node tools/teste-som-tm-boss.mjs
//
// O que este teste protege:
//   · a preferência nasce LIGADA (como os sons de captura) e só `'0'` explícito silencia;
//   · o efeito é o arquivo certo, pré-carregado só quando pedido, e tocado do começo;
//   · o som só toca quando cai TM Disk Piece — Elemental ou AoE, com quantidade — e não com outro
//     drop do boss nem com a peça zerada;
//   · a tela liga as pontas: o `bossMorto` chama o som atrás da preferência, a opção existe nas
//     Configurações com prévia ao ligar, e o texto existe nos três idiomas.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

let testes = 0;
let falhas = 0;
const ok = (cond, nome, detalhe = '') => {
  testes++;
  if (cond) return console.log(`  ✓ ${nome}`);
  falhas++;
  console.log(`  ✗ ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
};

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
// Normaliza o fim de linha: o app.js está em CRLF no Windows, e o recorte da função procura `\n}\n`.
const ler = (rel) => readFileSync(join(raiz, rel), 'utf8').replace(/\r\n/g, '\n');

// ---- navegador de mentira: localStorage, Audio e document
const guardado = new Map();
globalThis.localStorage = {
  getItem: (k) => (guardado.has(k) ? guardado.get(k) : null),
  setItem: (k, v) => guardado.set(k, String(v)),
};
// `preferencias.mjs` aplica tema e imersivo no carregamento: precisa de `classList` e da meta de cor.
globalThis.document = {
  documentElement: { classList: { toggle() {}, add() {}, remove() {}, contains: () => false } },
  querySelector: () => ({ setAttribute() {}, getAttribute: () => null }),
};
const audios = [];
globalThis.Audio = class {
  constructor(src) {
    this.src = src;
    this.cargas = 0;
    this.toques = 0;
    this.currentTime = 99;
    audios.push(this);
  }
  load() { this.cargas++; }
  play() { this.toques++; return Promise.resolve(); }
};

const prefs = await import('../src/client/preferencias.mjs');
const sons = await import('../src/client/sons.mjs');

console.log('SOM DA TM DISK PIECE DE BOSS\n============================');

console.log('\nPreferência');
ok(prefs.somTmBossLigado() === true, 'nasce ligada, sem nada gravado');
prefs.definirSomTmBoss(false);
ok(prefs.somTmBossLigado() === false && guardado.get('cfg-som-tm-boss') === '0', 'desligar grava 0 e silencia');
prefs.definirSomTmBoss(true);
ok(prefs.somTmBossLigado() === true, 'religar volta a tocar');
ok(prefs.somCapturaLigado() === true && prefs.somShinyLigado() === true, 'não mexe nos interruptores de captura e shiny');

console.log('\nEfeito');
sons.prepararSons({ shiny: false, captura: false });
ok(!audios.some((a) => a.src.includes('drop-tm-piece')), 'sem pedir, o arquivo da peça não é baixado');
sons.prepararSons({ shiny: false, captura: false, tmBoss: true });
const tm = audios.find((a) => a.src === 'img/som/drop-tm-piece.mp3');
ok(tm && tm.cargas === 1, 'pedindo, o arquivo img/som/drop-tm-piece.mp3 é pré-carregado');
sons.tocarTmBossDrop();
ok(tm?.toques === 1 && tm.currentTime === 0, 'tocar começa do início');
ok(existsSync(join(raiz, 'src/client/img/som/drop-tm-piece.mp3')), 'o arquivo existe no cliente');

console.log('\nQuando toca');
const app = ler('src/client/app.js');
const ini = app.indexOf('function dropouPecaDeTm(');
const fim = app.indexOf('\n}\n', ini);
ok(ini >= 0 && fim > ini, 'o detector de peça existe no app.js');
const estado = { tmResearcher: { pieceElemental: 59194, pieceAoe: 40530 } };
const dropouPecaDeTm = new Function('estado', 'PIECE_ELEMENTAL_UI', 'PIECE_AOE_UI', `${app.slice(ini, fim + 2)}; return dropouPecaDeTm;`)(estado, 59194, 40530);
ok(dropouPecaDeTm([{ itemId: 59194, qtd: 1 }]) === true, 'TM Disk Piece Elemental toca');
ok(dropouPecaDeTm([{ itemId: 12345, qtd: 3 }, { itemId: 40530, qtd: 2 }]) === true, 'AoE TM Disk Piece no meio de outros drops toca');
ok(dropouPecaDeTm([{ itemId: 70000, qtd: 1 }, { itemId: 12345, qtd: 5 }]) === false, 'boss sem peça não toca');
ok(dropouPecaDeTm([{ itemId: 59194, qtd: 0 }]) === false, 'peça com quantidade zero não toca');
ok(dropouPecaDeTm(undefined) === false && dropouPecaDeTm([]) === false, 'sem drops não toca');
estado.tmResearcher = null;
ok(dropouPecaDeTm([{ itemId: 40530, qtd: 1 }]) === true, 'sem o catálogo do welcome, cai nos ids conhecidos');

console.log('\nNo código');
const caso = app.slice(app.indexOf("case 'bossMorto': {"), app.indexOf("case 'bossPerdeu'"));
ok(/if \(somTmBossLigado\(\) && dropouPecaDeTm\(e\.drops\)\) tocarTmBossDrop\(\);/.test(caso), 'o bossMorto toca o som só com a preferência ligada e a peça no drop');
ok(/id="cfg-som-tm-boss"/.test(app) && /b\.id === 'cfg-som-tm-boss'/.test(app), 'a opção existe nas Configurações e tem clique');
ok(/tmBoss: somTmBossLigado\(\)/.test(app), 'o welcome pré-carrega o som quando a opção está ligada');
const i18n = ler('src/client/i18n.mjs');
const vezes = (k) => (i18n.match(new RegExp(`'${k.replace('.', '\\.')}':`, 'g')) ?? []).length;
ok(vezes('cfg.somTmBoss') === 3 && vezes('cfg.somTmBossAjuda') === 3, 'nome e ajuda da opção nos três idiomas');

console.log(`\n${testes - falhas}/${testes} ok`);
process.exit(falhas ? 1 : 0);
