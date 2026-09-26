#!/usr/bin/env node
/**
 * Gera token de sessão local — útil depois de `restore:db` com backup de produção.
 *
 * Contas Google não entram com senha no localhost sem OAuth configurado; este script
 * assina um token válido para o servidor que estiver rodando AGORA.
 *
 * IMPORTANTE: o token só vale se o servidor usar o MESMO `AUTH_SEGREDO`.
 * Coloque no `game/.env` (e reinicie o `npm start`):
 *   AUTH_SEGREDO=dev-local-seu-segredo
 *
 *   node tools/dev-sessao.mjs fasicontato@gmail.com
 *
 * Cole a linha no console do navegador (F12) e dê F5.
 */
import '../src/server/config.mjs';
import { pool } from '../src/server/db.mjs';
import { assinarSessao } from '../src/server/auth.mjs';

const alvo = process.argv[2];
if (!alvo) {
  console.error('Uso: node tools/dev-sessao.mjs <email ou nick>');
  process.exit(1);
}

if (!process.env.AUTH_SEGREDO) {
  console.warn(
    '[aviso] AUTH_SEGREDO não está no .env — cada restart do servidor gera segredo novo.\n'
    + '        Ponha AUTH_SEGREDO=... no game/.env e reinicie o npm start antes de usar este token.\n',
  );
}

const { rows } = await pool.query(
  `SELECT id, nick, email, provedor FROM accounts
    WHERE lower(email) = lower($1) OR lower(nick) = lower($1)
    LIMIT 1`,
  [alvo.trim()],
);
const conta = rows[0];
if (!conta) {
  console.error('Conta não encontrada no banco local.');
  process.exit(1);
}

const { rows: pRows } = await pool.query(
  `SELECT level, (SELECT count(*)::int FROM player_pokemon WHERE player_id = players.id) AS pokemons
     FROM players WHERE lower(nick) = lower($1)`,
  [conta.nick],
);
const jogador = pRows[0];

const sessao = {
  nick: conta.nick,
  token: await assinarSessao({
    nick: conta.nick,
    contaId: Number(conta.id),
    provedor: conta.provedor,
  }),
};
console.log(`Conta: ${conta.email} · nick: ${conta.nick} · provedor: ${conta.provedor}`);
if (jogador) console.log(`Jogador: nv ${jogador.level} · ${jogador.pokemons} pokémon(s)`);
console.log('\nCole no console do navegador (F12) em http://localhost:8080:\n');
console.log(`localStorage.setItem('sessao', ${JSON.stringify(JSON.stringify(sessao))}); location.reload();`);
await pool.end();
