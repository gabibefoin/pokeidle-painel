// Cobertura do i18n: os três dicionários têm de ser CONGRUENTES.
//
// O bug que este teste existe para pegar é silencioso: alguém acrescenta uma frase no
// português e esquece do inglês e do espanhol. O `t()` cai no PT-BR e a tela fica bilíngue
// sem que ninguém perceba até um jogador reclamar.
//
// Confere também os `{placeholders}`: se a frase em português tem `{nivel}` e a espanhola
// escreveu `{nivell}`, a interpolação falha em silêncio e o jogador vê a chave crua no meio
// da frase.
//
// E confere que TODA chave usada no HTML e no app.js existe no dicionário — o outro lado do
// mesmo problema.
//
//   node tools/teste-i18n.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { _dicionarios, IDIOMAS, t, aplicarI18n } from '../src/client/i18n.mjs';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');

let falhas = 0;
let testes = 0;
const ok = (cond, nome, extra = '') => {
  testes++;
  if (cond) return console.log(`  ✓ ${nome}`);
  falhas++;
  console.log(`  ✗ ${nome}${extra ? `\n      ${extra}` : ''}`);
};
const secao = (t) => console.log(`\n${t}`);

const placeholders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

console.log('i18n — PT / EN / ES\n===================');

secao('Congruência dos dicionários');
const chavesPt = Object.keys(_dicionarios.pt).sort();
ok(chavesPt.length > 150, `o dicionário base tem ${chavesPt.length} chaves`);
ok(IDIOMAS.length === 3, 'três idiomas declarados');
ok(
  IDIOMAS.every((l) => _dicionarios[l.id]),
  'todo idioma declarado tem dicionário',
);

for (const l of IDIOMAS) {
  if (l.id === 'pt') continue;
  const chaves = Object.keys(_dicionarios[l.id]).sort();
  const faltando = chavesPt.filter((k) => !(k in _dicionarios[l.id]));
  const sobrando = chaves.filter((k) => !(k in _dicionarios.pt));
  ok(!faltando.length, `${l.id}: nenhuma chave faltando`, faltando.slice(0, 8).join(', '));
  ok(!sobrando.length, `${l.id}: nenhuma chave órfã`, sobrando.slice(0, 8).join(', '));
}

secao('Placeholders');
for (const l of IDIOMAS) {
  if (l.id === 'pt') continue;
  const ruins = [];
  for (const k of chavesPt) {
    const a = placeholders(_dicionarios.pt[k]).join(',');
    const b = placeholders(_dicionarios[l.id][k] ?? '').join(',');
    if (a !== b) ruins.push(`${k}: pt{${a}} ≠ ${l.id}{${b}}`);
  }
  ok(!ruins.length, `${l.id}: os {placeholders} batem com o português`, ruins.slice(0, 6).join('\n      '));
}

secao('Frases não traduzidas');

/**
 * Frases que são LEGITIMAMENTE idênticas entre português e espanhol.
 *
 * As duas línguas são próximas o bastante para que frases inteiras coincidam palavra por
 * palavra — "capturado: {nome} Nv{nivel}" é a tradução correta, não um esquecimento. Sem esta
 * lista o teste vira ruído e a primeira reação de quem o vê falhar é desligá-lo.
 *
 * Entrar aqui exige ter conferido a frase à mão.
 */
const IDENTICAS_OK = {
  // `fan.avisoCurto` é a atribuição de direitos do rodapé, e ela é feita só de nomes próprios
  // ("Fan game — Pokémon © Nintendo / Game Freak / Creatures / The Pokémon Company"). Traduzir
  // nome de titular seria errado num aviso legal, então as três línguas dizem o mesmo.
  // `evt.faixa` é a faixa do evento global, e o miolo dela é rótulo fixo de produto em inglês
  // ("XP Bonus Trainer", "Bonus Farm") — o mesmo em qualquer idioma. O que sobra ("por {min}
  // minutos") se escreve igual em português e em espanhol; traduzir daria a MESMA frase.
  // `ev.shinyCapturado` é a mesma frase de `ev.capturado` com "SHINY" na frente — e "SHINY
  // capturado: {nome} Nv{nivel}" é exatamente como se escreve em espanhol também.
  // `aviso.v13Quais1` e `v13Quais2` sao as duas metades da LISTA das 35 megas, e uma lista de
  // nomes proprios ("Venusaur, Charizard Y, Blastoise, ...") nao se traduz: o nome da especie
  // e o mesmo nas tres linguas, aqui e na Pokedex.
  // `item.fragmentoMegaShiny` e "Fragmento de MEGA Shiny Stone" nas duas: "Mega Stone" e
  // "Shiny" sao nome de produto e ficam em ingles no jogo inteiro (a `item.fragmentoShiny` ja
  // e identica pelo mesmo motivo, so que curta o bastante para nao cair neste teste).
  es: new Set(['ev.capturado', 'ev.shinyCapturado', 'ev.pvpMorteToast', 'orbs.precoCompra', 'fan.avisoCurto', 'evt.faixa', 'aviso.v13Quais1', 'aviso.v13Quais2', 'item.fragmentoMegaShiny']),
  en: new Set(['fan.avisoCurto', 'aviso.v13Quais1', 'aviso.v13Quais2']),
};

for (const l of IDIOMAS) {
  if (l.id === 'pt') continue;
  // Frase idêntica ao português É legítima em muitos casos ("Pokédex", "Market", "PvP", "xp").
  // O que não pode é uma frase LONGA idêntica sem estar declarada acima — isso é copiar e
  // colar esquecido.
  const iguais = chavesPt.filter(
    (k) =>
      _dicionarios[l.id][k] === _dicionarios.pt[k] &&
      String(_dicionarios.pt[k]).length > 28 &&
      !IDENTICAS_OK[l.id]?.has(k),
  );
  ok(!iguais.length, `${l.id}: nenhuma frase longa deixada em português`, iguais.slice(0, 6).join(', '));

  // A lista não pode envelhecer: uma frase que foi traduzida depois tem de sair dela.
  const obsoletas = [...(IDENTICAS_OK[l.id] ?? [])].filter(
    (k) => _dicionarios[l.id][k] !== _dicionarios.pt[k],
  );
  ok(!obsoletas.length, `${l.id}: a lista de idênticas está em dia`, obsoletas.join(', '));
}

secao('Chaves usadas na interface');
{
  const html = readFileSync(join(raiz, 'src/client/index.html'), 'utf8');
  const app = readFileSync(join(raiz, 'src/client/app.js'), 'utf8');

  const usadas = new Set();
  // data-i18n="x" / data-i18n-html="x" / data-i18n-attr="attr:x;attr2:y"
  for (const m of html.matchAll(/data-i18n(?:-html)?="([^"]+)"/g)) usadas.add(m[1]);
  for (const m of html.matchAll(/data-i18n-attr="([^"]+)"/g)) {
    for (const par of m[1].split(';')) {
      const chave = par.split(':')[1]?.trim();
      if (chave) usadas.add(chave);
    }
  }
  // t('chave') no JS — só as literais; as montadas em runtime ficam de fora por natureza
  for (const m of app.matchAll(/\bt\(\s*'([a-zA-Z][\w.]*)'/g)) usadas.add(m[1]);

  ok(usadas.size > 90, `${usadas.size} chaves referenciadas na interface`);
  const orfas = [...usadas].filter((k) => !(k in _dicionarios.pt));
  ok(!orfas.length, 'toda chave usada existe no dicionário', orfas.slice(0, 10).join(', '));

  // O caminho contrário é só informativo: uma chave a mais no dicionário não quebra nada.
  const naoUsadas = chavesPt.filter((k) => !usadas.has(k));
  console.log(`  · ${naoUsadas.length} chaves no dicionário sem uso literal (montadas em runtime ou reserva)`);
}

secao('Interpolação');
ok(t('ev.bemVindo', { nick: 'Ash' }) === 'bem-vindo, Ash', 'troca o placeholder');
ok(t('ev.equipeCheia', { max: 5 }) === 'equipe cheia (5/5)', 'troca o MESMO placeholder duas vezes');
ok(t('chave.que.nao.existe') === 'chave.que.nao.existe', 'chave inexistente devolve a própria chave');
ok(!/\{nick\}/.test(t('ev.bemVindo', { nick: 'x' })), 'não sobra chaveta na saída');
ok(t('ev.bemVindo', { outro: 1 }).includes('{nick}'), 'placeholder sem valor fica visível (não vira undefined)');

console.log(`\n${'='.repeat(46)}`);
console.log(falhas ? `${falhas} de ${testes} FALHARAM` : `${testes} testes passaram`);
process.exit(falhas ? 1 : 0);
