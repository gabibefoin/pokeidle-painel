// Rotas HTTP do programa de indicação (`/affiliate/*`).
import { lerSessao } from './auth.mjs';
import { ErroAfiliado } from './game/afiliados.mjs';
import {
  aplicarCodigo,
  painelDe,
  recolherEntregas,
  registrarVisita,
  tentarAtribuirReferencia,
} from './afiliados-db.mjs';
import { pool } from './db.mjs';
import { ipCliente } from './ip-cliente.mjs';

const json = (res, codigo, corpo) => {
  res.writeHead(codigo, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(corpo));
};

function lerCorpo(req, limite = 4096) {
  return new Promise((ok, err) => {
    let dados = '';
    req.on('data', (p) => {
      dados += p;
      if (dados.length > limite) {
        req.destroy();
        err(new Error('corpo grande demais'));
      }
    });
    req.on('end', () => {
      try {
        ok(JSON.parse(dados || '{}'));
      } catch {
        err(new Error('json inválido'));
      }
    });
    req.on('error', err);
  });
}

const baldes = new Map();
function passouDoLimite(ip, limite = 30, janelaMs = 60_000) {
  const agora = Date.now();
  const b = baldes.get(ip);
  if (!b || agora > b.zeraEm) {
    baldes.set(ip, { n: 1, zeraEm: agora + janelaMs });
    return false;
  }
  b.n += 1;
  return b.n > limite;
}
setInterval(() => {
  const agora = Date.now();
  for (const [ip, b] of baldes) if (agora > b.zeraEm) baldes.delete(ip);
}, 60_000).unref();

/** O IP do jogador. A regra de confianca mora em `ip-cliente.mjs` - leia la antes de mexer. */
const ipDe = (req) => ipCliente(req);

async function sessaoDe(req, url, corpo) {
  const token = corpo?.token
    ?? url.searchParams.get('sessao')
    ?? (req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.slice(7)
      : null);
  return lerSessao(token);
}

export async function rotasDeAfiliados(req, res, url) {
  const rota = url.pathname;
  if (!rota.startsWith('/affiliate/')) return false;

  if (rota === '/affiliate/visita' && req.method === 'POST') {
    if (passouDoLimite(ipDe(req), 60)) return json(res, 429, { erro: 'afiliados.muitasTentativas' }), true;
    try {
      const { code } = await lerCorpo(req);
      await registrarVisita(code);
      json(res, 200, { ok: true });
    } catch {
      json(res, 400, { erro: 'afiliados.falhou' });
    }
    return true;
  }

  if (rota === '/affiliate/me' && req.method === 'POST') {
    try {
      const corpo = await lerCorpo(req);
      const sessao = await sessaoDe(req, url, corpo);
      if (!sessao?.contaId) return json(res, 401, { erro: 'login.falhou' }), true;
      json(res, 200, await painelDe(sessao.contaId));
    } catch {
      json(res, 500, { erro: 'afiliados.falhou' });
    }
    return true;
  }

  if (rota === '/affiliate/aplicar' && req.method === 'POST') {
    if (passouDoLimite(ipDe(req), 12)) return json(res, 429, { erro: 'afiliados.muitasTentativas' }), true;
    try {
      const corpo = await lerCorpo(req);
      const sessao = await sessaoDe(req, url, corpo);
      if (!sessao?.contaId) return json(res, 401, { erro: 'login.falhou' }), true;
      await aplicarCodigo(sessao.contaId, corpo.code);
      json(res, 200, await painelDe(sessao.contaId));
    } catch (err) {
      json(res, err instanceof ErroAfiliado ? 400 : 500, { erro: err.chave ?? 'afiliados.falhou' });
    }
    return true;
  }

  if (rota === '/affiliate/recolher' && req.method === 'POST') {
    if (passouDoLimite(ipDe(req), 8)) return json(res, 429, { erro: 'afiliados.muitasTentativas' }), true;
    try {
      const corpo = await lerCorpo(req);
      const sessao = await sessaoDe(req, url, corpo);
      if (!sessao?.contaId) return json(res, 401, { erro: 'login.falhou' }), true;
      const { rows } = await pool.query(
        `SELECT p.id FROM accounts a
          JOIN players p ON lower(p.nick) = lower(a.nick)
         WHERE a.id = $1`,
        [sessao.contaId],
      );
      if (!rows[0]) return json(res, 400, { erro: 'afiliados.falhou' }), true;
      const r = await recolherEntregas(Number(rows[0].id));
      if (!r.itens.length) return json(res, 400, { erro: 'afiliados.nadaPendente' }), true;
      json(res, 200, {
        ...await painelDe(sessao.contaId),
        recolhido: r.recolhido ?? r.itens,
      });
    } catch {
      json(res, 500, { erro: 'afiliados.falhou' });
    }
    return true;
  }

  return json(res, 404, { erro: 'afiliados.falhou' }), true;
}

/** Usado pelas rotas de auth no cadastro — não propaga erro de código inválido. */
export async function atribuirNoCadastro(contaId, code) {
  if (!code) return;
  try {
    await tentarAtribuirReferencia(contaId, code);
  } catch (err) {
    console.warn('[afiliados] atribuição no cadastro:', err.message);
  }
}
