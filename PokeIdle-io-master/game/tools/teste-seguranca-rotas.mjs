/**
 * Teste das travas de borda: de quem é o IP, e quando o e-mail de um provedor vale como prova.
 *
 * Não precisa de servidor nem de Postgres — as duas coisas são decisões puras, e é justamente
 * por serem pequenas que passaram despercebidas. O que este arquivo fixa:
 *
 *   1. `ipCliente` não aceita IP escolhido pelo cliente. O `X-Forwarded-For` é uma lista em que
 *      qualquer um consegue escrever à ESQUERDA; só o que os proxies acrescentam à direita
 *      (e o `CF-Connecting-IP`, que o Cloudflare sobrescreve) é confiável.
 *   2. O retorno do OAuth só trata o e-mail como credencial quando o provedor confirma —
 *      `undefined` conta como NÃO.
 *
 *   node tools/teste-seguranca-rotas.mjs
 */
import { ipCliente } from '../src/server/ip-cliente.mjs';

let falhas = 0;
let testes = 0;
const ok = (cond, nome, extra = '') => {
  testes++;
  if (cond) return console.log(`  ✓ ${nome}`);
  falhas++;
  console.log(`  ✗ ${nome}${extra ? `  — ${extra}` : ''}`);
};
const secao = (t) => console.log(`\n${t}`);

const req = (headers, remoto = '127.0.0.1') => ({ headers, socket: { remoteAddress: remoto } });

console.log('Travas de borda\n===============');

secao('De quem é o IP');

ok(
  ipCliente(req({ 'x-forwarded-for': '203.0.113.9' })) === '203.0.113.9',
  'sem proxy na frente, o único elemento é o jogador',
);

// Caddy sozinho: o cliente mandou lixo, o Caddy acrescentou o peer real no fim.
ok(
  ipCliente(req({ 'x-forwarded-for': '1.2.3.4, 203.0.113.9' })) === '203.0.113.9',
  'XFF forjado pelo cliente NÃO vence o que o proxy acrescentou',
  ipCliente(req({ 'x-forwarded-for': '1.2.3.4, 203.0.113.9' })),
);

// O ataque real: um cabeçalho diferente por requisição para ganhar um balde novo a cada vez.
const forjados = ['9.9.9.9', '8.8.8.8', '7.7.7.7'].map(
  (falso) => ipCliente(req({ 'x-forwarded-for': `${falso}, 203.0.113.9` })),
);
ok(
  new Set(forjados).size === 1 && forjados[0] === '203.0.113.9',
  'trocar o XFF a cada tentativa não muda a chave do rate limit',
  forjados.join(' / '),
);

secao('Com Cloudflare na frente');

ok(
  ipCliente(req({
    'cf-connecting-ip': '203.0.113.9',
    'x-forwarded-for': '203.0.113.9, 172.68.0.1',
  })) === '203.0.113.9',
  'o CF-Connecting-IP manda — é o que o Cloudflare sobrescreve',
);

// Sem o CF-Connecting-IP (tráfego que não passou pelo Cloudflare), o piso é o peer do Caddy:
// o atacante fica preso ao próprio IP, que é exatamente o comportamento desejado.
ok(
  ipCliente(req({ 'x-forwarded-for': '1.2.3.4, 198.51.100.7' })) === '198.51.100.7',
  'sem CF-Connecting-IP, sobra o peer real — nunca o inventado',
);

// O ataque pela ORIGEM: quem fala direto com o IP da VPS não passa pelo Cloudflare e escreve o
// CF-Connecting-IP que quiser. Só vale quando o peer que entregou a requisição é do Cloudflare.
const pelaOrigem = ['9.9.9.9', '8.8.8.8', '7.7.7.7'].map(
  (falso) => ipCliente(req({ 'cf-connecting-ip': falso, 'x-forwarded-for': '198.51.100.7' })),
);
ok(
  new Set(pelaOrigem).size === 1 && pelaOrigem[0] === '198.51.100.7',
  'CF-Connecting-IP vindo de peer FORA do Cloudflare é ignorado (fica o peer)',
  pelaOrigem.join(' / '),
);
ok(
  ipCliente(req({ 'cf-connecting-ip': '9.9.9.9' }, '198.51.100.7')) === '198.51.100.7',
  'sem proxy nenhum, CF-Connecting-IP forjado direto no socket também é ignorado',
);
ok(
  ipCliente(req({ 'cf-connecting-ip': '203.0.113.9', 'x-forwarded-for': '2606:4700:10::6816:1' })) === '203.0.113.9',
  'peer IPv6 do Cloudflare também vale',
);
ok(
  ipCliente(req({ 'cf-connecting-ip': '203.0.113.9' }, '::ffff:104.16.5.5')) === '203.0.113.9',
  'peer IPv4 embrulhado em IPv6 (::ffff:) do Cloudflare também vale',
);
ok(
  ipCliente(req({ 'cf-connecting-ip': '203.0.113.9', 'x-forwarded-for': '172.63.255.255' })) === '172.63.255.255',
  'um endereço colado na faixa (172.63.255.255, fora de 172.64.0.0/13) não é Cloudflare',
);
process.env.IP_CONFIAR_CF_SEMPRE = '1';
ok(
  ipCliente(req({ 'cf-connecting-ip': '9.9.9.9', 'x-forwarded-for': '198.51.100.7' })) === '9.9.9.9',
  'IP_CONFIAR_CF_SEMPRE=1 volta ao comportamento antigo (válvula de emergência)',
);
delete process.env.IP_CONFIAR_CF_SEMPRE;

secao('Entradas degeneradas');

ok(ipCliente(req({})) === '127.0.0.1', 'sem cabeçalho nenhum, vale o socket');
ok(ipCliente(req({ 'x-forwarded-for': '' })) === '127.0.0.1', 'XFF vazio cai no socket');
ok(ipCliente(req({ 'x-forwarded-for': ' , , ' })) === '127.0.0.1', 'XFF só com vírgulas cai no socket');
ok(
  ipCliente(req({ 'x-forwarded-for': '  1.2.3.4 ,  203.0.113.9  ' })) === '203.0.113.9',
  'espaços em volta não confundem a leitura',
);
ok(ipCliente({ headers: {}, socket: {} }) === '?', 'sem socket também não estoura');

secao('O e-mail do provedor como credencial');

// A regra que o retorno do OAuth aplica. `=== true` é o ponto: ausência de informação não pode
// valer como permissão, porque é assim que um campo que some vira uma porta aberta.
const confirmado = (provedor, perfil) => (provedor === 'google'
  ? perfil.email_verified === true
  : perfil.verified === true);

ok(confirmado('google', { email_verified: true }), 'Google com email_verified true passa');
ok(!confirmado('google', { email_verified: false }), 'Google com email_verified false NÃO passa');
ok(!confirmado('google', {}), 'Google sem o campo NÃO passa (ausência não é permissão)');
ok(!confirmado('google', { email_verified: 'true' }), 'a string "true" não vale por true');
ok(confirmado('discord', { verified: true }), 'Discord com verified true passa');
ok(!confirmado('discord', { verified: false }), 'Discord com verified false NÃO passa');
ok(!confirmado('discord', {}), 'Discord sem o campo NÃO passa');
ok(!confirmado('discord', { email_verified: true }), 'campo do OUTRO provedor não vale');

console.log(`\n${'='.repeat(46)}`);
console.log(falhas ? `${falhas} de ${testes} FALHARAM` : `${testes} testes passaram`);
process.exit(falhas ? 1 : 0);
