// A seção Multi-contas do painel, renderizada fora do navegador.
//
// `admin.mjs` chama `montar()` no fim do arquivo e depende do DOM, então não dá para importá-lo
// aqui. O que dá — e é o que interessa — é recortar as funções PURAS de render (elas só
// recebem dados e devolvem string) e rodá-las contra as formas exatas que o servidor devolve.
//
// Pega o que o teste de banco não pega: campo lido de um objeto que veio `null`, lista vazia
// caindo em `.map` de `undefined`, botão que some porque a condição inverteu, e o escape do
// nick — um jogador com `<b>` no nome não pode escrever HTML no painel de quem o investiga.
//
//   node tools/teste-multicontas-ui.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

let falhas = 0;
let testes = 0;
const ok = (cond, nome, extra = '') => {
  testes++;
  if (cond) return console.log(`  ✓ ${nome}`);
  falhas++;
  console.log(`  ✗ ${nome}${extra ? `  — ${extra}` : ''}`);
};
const secao = (t) => console.log(`\n${t}`);

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const fonte = readFileSync(join(raiz, 'src/client/admin.mjs'), 'utf8');

/** Recorta `nome` do fonte até a próxima declaração de topo. */
function recortar(nome) {
  const ini = fonte.search(new RegExp(`^(?:const|let|function|async function) ${nome}\\b`, 'm'));
  if (ini < 0) throw new Error(`não achei ${nome} em admin.mjs`);
  const resto = fonte.slice(ini + 1);
  const fim = resto.search(/^(?:\/\*\*|\/\/ ---|const |let |function |async function )/m);
  return fonte.slice(ini, fim < 0 ? undefined : ini + 1 + fim);
}

const partes = ['escapar', 'num', 'quando', 'bloco', 'nicksDoGrupo', 'secaoMulticontas', 'blocoTetoPorIp', 'blocoFaxina']
  .map(recortar)
  .join('\n');

// `blocoFaxina`/`secaoMulticontas` não tocam no DOM, mas o recorte pode arrastar um `$(...)`
// de vizinhança num refactor futuro — o stub faz isso falhar alto em vez de em silêncio.
const criar = new Function(
  '$', 'FUSO_BR',
  `${partes}\n return { secaoMulticontas, blocoTetoPorIp, blocoFaxina };`,
);
const { secaoMulticontas, blocoTetoPorIp, blocoFaxina } = criar(
  () => { throw new Error('render puro não pode tocar no DOM'); },
  'America/Sao_Paulo',
);

const conta = (nick, level, diamonds = 0, orbs = 0, extra = {}) => ({
  id: level, nick, email: `${nick}@x.invalido`, playerId: level,
  level, gold: 0, diamonds, orbs, diamantesEmAnuncio: 0,
  banido: false, banSoft: false, nasceuAqui: true,
  criadoEm: '2026-01-01T00:00:00Z', ultimoLogin: '2026-09-01T00:00:00Z', ...extra,
});

const grupo = (chave, over = {}) => ({
  chave, contas: 6, banidas: 0, apagadas: 0, nascidas: 6, liberado: false,
  de: '2026-01-01T00:00:00Z', ate: '2026-09-01T00:00:00Z',
  nicks: ['ash', 'misty'], nicksBanidos: [], nicksApagados: [], ...over,
});

console.log('Multi-contas — render do painel\n===============================');

// ------------------------------------------------------------------- vazio
secao('Sem dados (primeira abertura, servidor mudo)');
try {
  const html = secaoMulticontas({ minimo: 2, nicks: 60, incluirApagadas: false, dados: null, teto: null, plano: null, resultado: null, msg: null });
  ok(html.includes('Multi-contas por origem'), 'renderiza sem `dados` e sem `teto`');
  ok(
    html.includes('Limites por rede — 4 contas criadas, 4 on-line ao mesmo tempo'),
    'os dois limites aparecem com o padrão 4',
  );
  ok(html.includes('whitelist vazia'), 'diz que a whitelist está vazia');
  ok(html.includes('nenhum cadastro recusado'), 'diz que não houve recusa');
  ok(!html.includes('undefined'), 'nenhum `undefined` vazou para a tela');
} catch (err) {
  falhas++; console.log(`  ✗ estourou: ${err.message}`);
}

// ------------------------------------------------------------------ tabelas
secao('As tabelas de origem');
try {
  const cache = {
    minimo: 2, nicks: 60, incluirApagadas: false, plano: null, resultado: null, msg: null,
    dados: {
      limitePorIp: 4,
      resumo: { linhas: 10, contas: 8, apagadas: 1, ips: 3, dispositivos: 4, desde: '2026-01-01T00:00:00Z' },
      porIp: [grupo('198.51.100.7'), grupo('203.0.113.9', { contas: 2, nascidas: 2, liberado: true })],
      porDispositivo: [grupo('abc-123')],
    },
    teto: { limite: 4, limiteOnline: 4, liberados: [], recusas: [] },
  };
  const html = secaoMulticontas(cache);
  ok(html.includes('Faxina (−2)'), 'grupo com 6 de pé oferece faxina de 2');
  ok(html.includes('dentro do limite'), 'grupo com 2 de pé não oferece faxina');
  ok(html.includes('data-faxina-tipo="ip"'), 'o botão de IP carrega o tipo');
  ok(html.includes('data-faxina-tipo="dispositivo"'), 'a tabela de aparelho também tem faxina');
  ok(html.includes('data-liberar-ip="198.51.100.7"'), 'IP fora da whitelist oferece o botão de pôr');
  ok(html.includes('data-travar-ip="203.0.113.9"'), 'IP na whitelist oferece o de tirar');
  ok(!html.includes('data-liberar-ip="abc-123"'), 'aparelho NÃO oferece whitelist (os limites são de rede)');
  ok(html.includes('nascidas aqui'), 'a coluna que o teto cobra está na tabela');
  ok(!html.includes('undefined'), 'nenhum `undefined` vazou para a tela');
} catch (err) {
  falhas++; console.log(`  ✗ estourou: ${err.message}`);
}

// -------------------------------------------------------------------- teto
secao('O painel do teto');
try {
  const html = blocoTetoPorIp({
    limite: 4,
    limiteOnline: 4,
    liberados: [{ ipBucket: '2804:14c::/64', nota: 'CGNAT Vivo', porEmail: 'a@b.c', criadoEm: '2026-09-01T00:00:00Z', nascidas: 31, onlineAgora: 8 }],
    recusas: [
      { ipBucket: '198.51.100.7', vezes: 12, primeiroEm: '2026-08-01T00:00:00Z', ultimoEm: '2026-09-10T00:00:00Z', liberado: false, nascidas: 4, onlineAgora: 4 },
      { ipBucket: '2804:14c::/64', vezes: 3, primeiroEm: null, ultimoEm: null, liberado: true, nascidas: 31, onlineAgora: 8 },
    ],
  }, 4);
  ok(html.includes('CGNAT Vivo'), 'a nota da whitelist aparece');
  ok(html.includes('on-line agora'), 'a coluna de quem está conectado agora existe');
  ok(html.includes('Esta rede já está com 4 contas conectadas'), 'a tela explica a frase que o jogador vê');
  ok(html.includes('isenta dos DOIS limites'), 'e deixa claro que a whitelist cobre cadastro E sessão');
  ok(html.includes('>12<'), 'a contagem de recusas aparece');
  ok(html.includes('data-liberar-ip="198.51.100.7"'), 'o IP que recusa muito oferece isenção num clique');
  ok(html.match(/data-travar-ip="2804:14c::\/64"/g)?.length === 2, 'o isento oferece voltar ao teto nas duas listas');
  ok(html.includes('—'), 'data nula vira travessão, não `Invalid Date`');
  ok(!html.includes('undefined') && !html.includes('Invalid Date'), 'nada de `undefined` nem `Invalid Date`');
} catch (err) {
  falhas++; console.log(`  ✗ estourou: ${err.message}`);
}

// ------------------------------------------------------------------ prévia
secao('A prévia da faxina');
try {
  const plano = {
    tipo: 'ip', chave: '198.51.100.7', manter: 4, limite: 4,
    principal: conta('ash', 300, 120, 50),
    mantidas: [conta('ash', 300, 120, 50), conta('misty', 200), conta('brock', 150), conta('gary', 100)],
    banir: [conta('mula1', 9, 30, 10), conta('mula2', 3, 1, 0)],
    jaBanidas: [conta('velha', 5, 0, 0, { banido: true })],
    protegidas: [conta('admin1', 400, 0, 0)],
    diamantes: 31, gemas: 10, diamantesPresos: 7, semDestino: false,
    motivo: 'Multi Account (4 max por IP) - Diamantes e gemas devolvidos para: ash',
  };
  const html = blocoFaxina({ plano, resultado: null, msg: null });
  ok(html.includes('id="adm-mc-aplicar"'), 'com contas a banir, o botão de confirmar existe');
  ok(html.includes('Multi Account (4 max por IP) - Diamantes e gemas devolvidos para: ash'), 'mostra o motivo exato que será gravado');
  ok(html.includes('recebe') && html.includes('ban soft') && html.includes('já banida') && html.includes('admin'),
    'as quatro etiquetas de destino aparecem');
  ok(html.includes('7 💎 das contas a banir estão presos'), 'avisa do diamante preso em anúncio');
  ok(!html.includes('undefined'), 'nenhum `undefined` vazou para a tela');

  const vazio = blocoFaxina({ plano: { ...plano, banir: [], diamantes: 0, gemas: 0, diamantesPresos: 0 }, resultado: null, msg: null });
  ok(!vazio.includes('id="adm-mc-aplicar"'), 'sem ninguém a banir, NÃO há botão de confirmar');
  ok(vazio.includes('já está dentro do limite'), 'e diz por quê');

  const sem = blocoFaxina({ plano: { ...plano, semDestino: true }, resultado: null, msg: null });
  ok(!sem.includes('id="adm-mc-aplicar"'), 'sem destino com personagem, NÃO há botão de confirmar');

  ok(blocoFaxina({ plano: null, resultado: null, msg: null }) === '', 'sem plano, o bloco some');
  ok(blocoFaxina({ plano: null, resultado: null, msg: { tom: 'ruim', texto: 'deu ruim' } }).includes('deu ruim'),
    'a mensagem de erro aparece no lugar do plano');
} catch (err) {
  falhas++; console.log(`  ✗ estourou: ${err.message}`);
}

// --------------------------------------------------------------- resultado
secao('O resultado');
try {
  const html = blocoFaxina({
    plano: null, msg: null,
    resultado: {
      tipo: 'ip', chave: '198.51.100.7', principal: 'ash',
      motivo: 'Multi Account (4 max por IP) - Diamantes e gemas devolvidos para: ash',
      banidos: [{ nick: 'mula1', level: 9, diamantes: 30, gemas: 10, diamantesPresos: 0 }],
      falhas: [{ nick: 'mula2', erro: 'saldo de diamantes insuficiente' }],
      diamantes: 30, gemas: 10, diamantesPresos: 7, mantidas: ['ash', 'misty'],
    },
  });
  ok(html.includes('Faxina aplicada'), 'mostra o resultado');
  ok(html.includes('saldo de diamantes insuficiente'), 'a falha de uma conta aparece, não é engolida');
  ok(html.includes('id="adm-mc-fechar"'), 'dá para fechar o resultado');
  ok(!html.includes('undefined'), 'nenhum `undefined` vazou para a tela');
} catch (err) {
  falhas++; console.log(`  ✗ estourou: ${err.message}`);
}

// ------------------------------------------------------------------ escape
secao('Escape (o nick é texto de jogador)');
try {
  const html = blocoFaxina({
    plano: {
      tipo: 'ip', chave: '<img src=x onerror=alert(1)>', manter: 4, limite: 4,
      principal: conta('<b>ash</b>', 300),
      mantidas: [conta('<b>ash</b>', 300)],
      banir: [conta('"><script>x</script>', 1)],
      jaBanidas: [], protegidas: [],
      diamantes: 0, gemas: 0, diamantesPresos: 0, semDestino: false,
      motivo: 'Multi Account (4 max por IP) - Diamantes e gemas devolvidos para: <b>ash</b>',
    },
    resultado: null, msg: null,
  });
  // O que torna a injeção inerte é o ANGULAR virar entidade — `onerror=` continua aparecendo
  // como texto dentro de `&lt;img …&gt;`, e procurar por ele daria alarme falso. O que não pode
  // existir é uma tag ABRINDO com dado de jogador dentro.
  ok(!/<\s*(script|img|svg|iframe)/i.test(html), 'nenhuma tag abre a partir de dado de jogador');
  ok(html.includes('&lt;b&gt;ash&lt;/b&gt;'), 'o nick com tag vira texto');
  ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'), 'a chave da origem também vira texto');
  // A aspa é o outro vetor: um nick que comece com `">` fecharia o atributo em que caísse.
  ok(
    html.includes('&quot;&gt;&lt;script&gt;x&lt;/script&gt;'),
    'aspa e angular do nick saem os dois como entidade',
  );
} catch (err) {
  falhas++; console.log(`  ✗ estourou: ${err.message}`);
}

console.log('\n==============================================');
console.log(falhas ? `${falhas} de ${testes} FALHARAM` : `${testes} passaram`);
process.exit(falhas ? 1 : 0);
