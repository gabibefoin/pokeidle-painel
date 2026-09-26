// O motivo do ban na TELA do jogador — o lado do cliente.
//
// `teste-multicontas.mjs` prova que o servidor manda o motivo pelas três portas (senha, OAuth
// e socket). Este prova a outra metade: que a tela o RECEBE e o mostra. Eram duas metades
// independentes — o socket, por exemplo, já mandava o motivo há tempos em `msg`, e o cliente
// o descartava porque preferia a `chave` traduzível.
//
// `app.js` é um módulo de navegador de 25 mil linhas que se conecta a um socket ao carregar,
// então aqui se recorta só o que interessa (`erroLogin` e `motivoDoBan`) e roda contra um `$`
// e um elemento dublados.
//
//   node tools/teste-ban-motivo.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { t, _dicionarios, IDIOMAS } from '../src/client/i18n.mjs';

let falhas = 0;
let testes = 0;
const ok = (cond, nome, extra = '') => {
  testes++;
  if (cond) return console.log(`  ✓ ${nome}`);
  falhas++;
  console.log(`  ✗ ${nome}${extra ? `  — ${extra}` : ''}`);
};
const secao = (nome) => console.log(`\n${nome}`);

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const fonte = readFileSync(join(raiz, 'src/client/app.js'), 'utf8');

function recortar(nome) {
  const ini = fonte.search(new RegExp(`^const ${nome} = `, 'm'));
  if (ini < 0) throw new Error(`não achei ${nome} em app.js`);
  const resto = fonte.slice(ini + 1);
  const fim = resto.search(/^(?:\/\*\*|const |let |function |async function )/m);
  return fonte.slice(ini, fim < 0 ? undefined : ini + 1 + fim);
}

/** Um `#login-erro` de mentira, com só o que `erroLogin` encosta. */
function elementoFalso() {
  return {
    textContent: '',
    filhos: [],
    classList: { toggle() {} },
    append(filho) { this.filhos.push(filho); },
  };
}
let alvo = elementoFalso();

const documentoFalso = {
  createElement: () => ({ className: '', textContent: '' }),
};

const partes = [recortar('erroLogin'), recortar('motivoDoBan')].join('\n');
const { erroLogin, motivoDoBan } = new Function(
  '$', 't', 'document',
  `${partes}\n return { erroLogin, motivoDoBan };`,
)(() => alvo, t, documentoFalso);

console.log('Motivo do ban na tela\n=====================');

// ------------------------------------------------------------ os dois transportes
secao('De onde o motivo vem');
const MOTIVO = 'Multi Account (4 max por IP) - Diamantes e gemas devolvidos para: Ash';

ok(motivoDoBan({ motivoBan: MOTIVO }) === `Motivo: ${MOTIVO}`, 'do corpo JSON (login com senha)');
ok(
  motivoDoBan(new URLSearchParams(`erroAuth=login.contaBanida&motivoBan=${encodeURIComponent(MOTIVO)}`))
    === `Motivo: ${MOTIVO}`,
  'da query da URL (volta do Google/Discord)',
);
ok(motivoDoBan(undefined) === '', 'sem fonte nenhuma, string vazia');
ok(motivoDoBan({}) === '', 'erro que não é de ban não inventa motivo');
ok(motivoDoBan(new URLSearchParams('erroAuth=state')) === '', 'e nem quando o OAuth falha por outro motivo');
ok(motivoDoBan({ motivoBan: null }) === '', 'ban sem motivo escrito não vira "Motivo: null"');

// ------------------------------------------------------------------- a tela
secao('O que aparece');
alvo = elementoFalso();
erroLogin(t('auth.contaBanida'), false, motivoDoBan({ motivoBan: MOTIVO }));
ok(alvo.textContent === 'Conta banida — você não pode entrar no jogo.', 'a linha de cima é a frase traduzida');
ok(alvo.filhos.length === 1, 'e ganha uma segunda linha');
ok(alvo.filhos[0]?.className === 'erro-motivo', 'com a classe que a pinta de vermelho');
ok(alvo.filhos[0]?.textContent === `Motivo: ${MOTIVO}`, 'contendo o motivo inteiro');

alvo = elementoFalso();
erroLogin(t('login.credenciaisInvalidas'), false, motivoDoBan({}));
ok(alvo.filhos.length === 0, 'senha errada NÃO ganha segunda linha');

alvo = elementoFalso();
erroLogin(t('conta.emailConfirmadoEntre'), true);
ok(alvo.filhos.length === 0, 'nem a mensagem verde de sucesso');

// ------------------------------------------------------------------- escape
secao('O motivo é texto de quem baniu, não HTML');
alvo = elementoFalso();
erroLogin('x', false, motivoDoBan({ motivoBan: '<img src=x onerror=alert(1)>' }));
ok(
  alvo.filhos[0]?.textContent === 'Motivo: <img src=x onerror=alert(1)>',
  'vai por textContent — o navegador mostra como texto, não executa',
);
ok(
  !/innerHTML|insertAdjacentHTML/.test(recortar('erroLogin')),
  'e `erroLogin` não usa innerHTML em lugar nenhum',
);

// -------------------------------------------------------------------- i18n
secao('Traduções');
for (const { id } of IDIOMAS) {
  const d = _dicionarios[id];
  ok(!!d?.['login.banMotivo'], `${id}: tem o rótulo do motivo`);
  ok(!!d?.['auth.contaBanida'], `${id}: tem a frase do ban`);
}

console.log('\n==============================================');
console.log(falhas ? `${falhas} de ${testes} FALHARAM` : `${testes} passaram`);
process.exit(falhas ? 1 : 0);
