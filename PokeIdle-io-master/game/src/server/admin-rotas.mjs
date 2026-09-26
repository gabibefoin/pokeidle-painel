// As rotas do painel de lucro. Curtas de propósito — a regra mora em `admin.mjs`.
//
// ### O portão
//
// Toda rota daqui passa por `sessaoAdmin`, e ele é a única coisa que separa o caixa do jogo de
// qualquer pessoa na internet. Três decisões dentro dele valem explicação:
//
// **O cliente nunca diz quem é.** Vem só o token assinado; o e-mail sai do banco, pelo
// `contaId` que estava dentro da assinatura. Um campo `email` no corpo do pedido seria
// exatamente a porta que estamos tentando trancar.
//
// **Quem não é admin leva 404, não 403.** Um 403 confirma que a rota existe e que há um painel
// atrás dela; o 404 não conta nada a quem estiver tateando.
//
// **Sem `ADMIN_EMAILS` configurado, ninguém entra** — nem por engano, nem em desenvolvimento.
// O padrão é o painel não existir.
import { lerSessao, contaPorId } from './auth.mjs';
import * as admin from './admin.mjs';
import { ipCliente } from './ip-cliente.mjs';

const json = (res, codigo, corpo) => {
  res.writeHead(codigo, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(corpo));
};

/**
 * O corpo do pedido como objeto. Corpo ilegível vira `{}`, e não erro.
 *
 * Parece detalhe de estilo e não é: é o que mantém de pé a promessa do 404.
 *
 * Quando isto ATIRAVA em JSON inválido, o `catch` de cada rota respondia 500 ("não deu para
 * montar o painel"). Rota que não existe responde 404. Então bastava mandar `token=abc` como
 * formulário em cada caminho para separar um do outro: 500 = existe, 404 = não existe. Um
 * varredor mapeava o painel inteiro sem nenhuma credencial, e a escolha de devolver 404 em vez
 * de 403 — feita justamente para não contar que há painel ali — não valia mais nada.
 *
 * Devolvendo `{}`, o pedido segue o caminho normal, não acha `token`, não acha sessão, e sai
 * pelo mesmo 404 de todo mundo. De quebra, o log para de encher de 500 a cada scanner que passa.
 *
 * O LIMITE de tamanho continua derrubando a conexão: aí não é pedido torto, é alguém empurrando
 * megabytes para dentro do processo, e a resposta certa é fechar a porta, não responder.
 */
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
        const lido = JSON.parse(dados || '{}');
        // `null`, `[]`, `"texto"` e `7` são JSON válido e nenhum deles é um pedido: quem
        // recebe espera ler `corpo.token`, e um `null` aqui estouraria dentro da rota.
        ok(lido && typeof lido === 'object' && !Array.isArray(lido) ? lido : {});
      } catch {
        ok({});
      }
    });
    req.on('error', err);
  });
}

/** A conta do admin, ou `null`. `null` vira 404 em todas as rotas. */
async function sessaoAdmin(corpo) {
  if (!admin.temPainel()) return null;
  const sessao = await lerSessao(corpo?.token);
  if (!sessao?.contaId) return null;
  const conta = await contaPorId(sessao.contaId);
  if (!conta || !admin.ehAdmin(conta.email)) return null;
  return conta;
}

/**
 * Quem pode abrir o painel — admin completo ou só Resolver Auditoria.
 *
 * É também o portão de TUDO que o cargo Resolver Auditoria enxerga. Esconder uma aba na tela
 * não tranca nada; quem decide é esta função. Hoje o cargo alcança quinze abas:
 *
 *     Ficha do jogador · Auditoria · Aprovação saques · Resolver Auditoria   (o cargo original)
 *     Usuários · Referrals · Referral Especial · Convites Discord · Eventos
 *     Multi-contas · Guilds · Histórico gemas · Tags do chat · Usuários mutados · Enviar emails
 *
 * E o que ele NÃO alcança é a lista curta que ficou com `sessaoAdmin`, toda de dinheiro ou de
 * papel da empresa: Tesouraria (`colher`, `gemas/varredura`), Custos e Ganhos, Diamantes,
 * Contagem online, Emissão de Notas e Documentos para MED. Antes de mover uma rota de um portão
 * para o outro, mexa também em `secoesDoPainel` no cliente — as duas listas andam juntas.
 */
async function sessaoPainel(corpo) {
  if (!admin.temPainel()) return null;
  const sessao = await lerSessao(corpo?.token);
  if (!sessao?.contaId) return null;
  const conta = await contaPorId(sessao.contaId);
  if (!conta) return null;
  if (!admin.ehAdmin(conta.email) && !admin.ehResolverAuditoria(conta.email)) return null;
  return conta;
}

/** Quem pode entregar itens/diamantes na aba Resolver Auditoria. */
async function sessaoResolverAuditoria(corpo) {
  if (!admin.temResolverAuditoria()) return null;
  const sessao = await lerSessao(corpo?.token);
  if (!sessao?.contaId) return null;
  const conta = await contaPorId(sessao.contaId);
  if (!conta || !admin.ehResolverAuditoria(conta.email)) return null;
  return conta;
}

export async function rotasDeAdmin(req, res, url) {
  const rota = url.pathname;
  if (!rota.startsWith('/admin/')) return false;

  // ---- os números
  //
  // Esta rota atende os DOIS cargos, e por isso ela monta duas respostas diferentes.
  //
  // O corpo financeiro — `fiat`, `crypto`, `carteiras`, `varredura` e o `historico` de
  // colheitas — sai só para o admin completo. Ele carrega caixa, passivo, lucro, quanto há
  // on-chain e os ENDEREÇOS das carteiras de lucro; é a matéria-prima de quem quer saber se
  // vale a pena atacar o jogo, e para onde o dinheiro sai quando sai. O cargo Resolver
  // Auditoria não tem a aba Tesouraria nem a Custos e Ganhos, então nada disso chega a ser
  // desenhado na tela dele — mandar assim mesmo seria vazar por JSON o que a tela esconde,
  // e um `F12` na aba Rede bastaria para ler.
  //
  // O que sobra para os dois é o que o cargo de fato usa: quem ele é, o que pode, e `cargos`
  // (as tags do chat, que é uma aba dele). Ver `secoesDoPainel` no cliente.
  if (rota === '/admin/painel' && req.method === 'POST') {
    try {
      const corpo = await lerCorpo(req);
      const conta = await sessaoPainel(corpo);
      if (!conta) return json(res, 404, { erro: 'não encontrado' }), true;
      const completo = admin.ehAdmin(conta.email);
      const numeros = completo
        ? { ...(await admin.painel()), historico: await admin.historico() }
        : { cargos: await admin.listarCargos() };
      json(res, 200, {
        ...numeros,
        email: conta.email,
        adminCompleto: completo,
        podeResolverAuditoria: admin.ehResolverAuditoria(conta.email),
        // Só esconde/mostra a aba. Quem decide de verdade é o portão das rotas `/admin/med/*`.
        podeDocumentosMed: (await import('./med.mjs')).podeUsarMed(conta.email, completo),
      });
    } catch (err) {
      console.error('[admin] painel falhou:', err.message);
      json(res, 500, { erro: 'não deu para montar o painel' });
    }
    return true;
  }

  // ---- transferir a sobra
  //
  // O valor e o destino são revalidados em `admin.colher` — o que chega aqui é pedido, não
  // ordem. A tela já limitou os dois, mas tela é sugestão.
  if (rota === '/admin/cargos/definir' && req.method === 'POST') {
    try {
      const corpo = await lerCorpo(req);
      const conta = await sessaoPainel(corpo);
      if (!conta) return json(res, 404, { erro: 'não encontrado' }), true;
      const r = await admin.definirCargo({
        email: conta.email,
        nick: corpo.nick,
        cargo: corpo.cargo,
      });
      console.log(`[admin] ${conta.email} deu tag ${corpo.cargo} para ${r.nick}`);
      json(res, 200, r);
    } catch (err) {
      json(res, 400, { erro: err.message });
    }
    return true;
  }

  if (rota === '/admin/cargos/remover' && req.method === 'POST') {
    try {
      const corpo = await lerCorpo(req);
      const conta = await sessaoPainel(corpo);
      if (!conta) return json(res, 404, { erro: 'não encontrado' }), true;
      await admin.removerCargo({ nick: corpo.nick });
      console.log(`[admin] ${conta.email} removeu tag de ${corpo.nick}`);
      json(res, 200, { ok: true });
    } catch (err) {
      json(res, 400, { erro: err.message });
    }
    return true;
  }

  if (rota === '/admin/chat/mutes/listar' && req.method === 'POST') {
    try {
      const corpo = await lerCorpo(req);
      const conta = await sessaoPainel(corpo);
      if (!conta) return json(res, 404, { erro: 'não encontrado' }), true;
      json(res, 200, { mutes: await admin.listarMutesAtivos() });
    } catch (err) {
      json(res, 500, { erro: err.message });
    }
    return true;
  }

  if (rota === '/admin/chat/mutes/revogar' && req.method === 'POST') {
    try {
      const corpo = await lerCorpo(req);
      const conta = await sessaoPainel(corpo);
      if (!conta) return json(res, 404, { erro: 'não encontrado' }), true;
      const r = await admin.revogarMute({ email: conta.email, nick: corpo.nick });
      json(res, 200, r);
    } catch (err) {
      json(res, 400, { erro: err.message });
    }
    return true;
  }

  if (rota === '/admin/diamantes/creditar' && req.method === 'POST') {
    json(res, 404, { erro: 'não encontrado' });
    return true;
  }

  if (rota === '/admin/resolver-auditoria/catalogo' && req.method === 'POST') {
    try {
      const corpo = await lerCorpo(req);
      const conta = await sessaoResolverAuditoria(corpo);
      if (!conta) return json(res, 404, { erro: 'não encontrado' }), true;
      json(res, 200, { itens: admin.catalogoResolverAuditoria() });
    } catch (err) {
      json(res, 400, { erro: err.message });
    }
    return true;
  }

  if (rota === '/admin/resolver-auditoria/entregar' && req.method === 'POST') {
    try {
      const corpo = await lerCorpo(req);
      const conta = await sessaoResolverAuditoria(corpo);
      if (!conta) return json(res, 404, { erro: 'não encontrado' }), true;
      const r = await admin.resolverAuditoriaEntregar({
        email: conta.email,
        nick: corpo.nick,
        itemId: corpo.itemId,
        qtd: corpo.qtd,
      });
      console.log(`[admin] ${conta.email} resolver · ${r.qtd}× ${r.itemNome} → ${r.nick}`);
      json(res, 200, r);
    } catch (err) {
      json(res, 400, { erro: err.message });
    }
    return true;
  }

  if (rota === '/admin/resolver-auditoria/historico' && req.method === 'POST') {
    try {
      const corpo = await lerCorpo(req);
      const conta = await sessaoResolverAuditoria(corpo);
      if (!conta) return json(res, 404, { erro: 'não encontrado' }), true;
      json(res, 200, { historico: await admin.listarHistoricoResolverAuditoria(corpo.limite) });
    } catch (err) {
      json(res, 400, { erro: err.message });
    }
    return true;
  }

  if (rota === '/admin/colher' && req.method === 'POST') {
    try {
      const corpo = await lerCorpo(req);
      const conta = await sessaoAdmin(corpo);
      if (!conta) return json(res, 404, { erro: 'não encontrado' }), true;
      const r = await admin.colher({ email: conta.email, carteira: corpo.carteira, usdt: corpo.usdt });
      console.log(`[admin] ${conta.email} colheu ${corpo.usdt} USDT para ${corpo.carteira}`);
      json(res, 200, r);
    } catch (err) {
      // A mensagem VAI para a tela: aqui quem lê é o dono, e "não deu" sem dizer por quê o
      // deixaria adivinhando entre carteira fora da lista, valor acima da sobra e RPC fora.
      json(res, 400, { erro: err.message });
    }
    return true;
  }

  if (rota === '/admin/gemas/varredura' && req.method === 'POST') {
    try {
      const corpo = await lerCorpo(req);
      const conta = await sessaoAdmin(corpo);
      if (!conta) return json(res, 404, { erro: 'não encontrado' }), true;
      const r = await admin.varrerDepositos({ email: conta.email });
      json(res, 200, r);
    } catch (err) {
      json(res, 400, { erro: err.message });
    }
    return true;
  }

  if (rota === '/admin/usuarios/listar' && req.method === 'POST') {
    try {
      const corpo = await lerCorpo(req);
      const conta = await sessaoPainel(corpo);
      if (!conta) return json(res, 404, { erro: 'não encontrado' }), true;
      json(res, 200, await admin.listarUsuarios({
        q: corpo.q,
        limite: corpo.limite,
        offset: corpo.offset,
      }));
    } catch (err) {
      json(res, 500, { erro: err.message });
    }
    return true;
  }

  if (rota === '/admin/usuarios/banir' && req.method === 'POST') {
    try {
      const corpo = await lerCorpo(req);
      const conta = await sessaoPainel(corpo);
      if (!conta) return json(res, 404, { erro: 'não encontrado' }), true;
      const r = await admin.banirUsuario({
        email: conta.email,
        nick: corpo.nick,
        motivo: corpo.motivo,
        soft: false,
      });
      console.log(`[admin] ${conta.email} baniu ${r.nick} (hard)`);
      json(res, 200, r);
    } catch (err) {
      json(res, 400, { erro: err.message });
    }
    return true;
  }

  if (rota === '/admin/usuarios/banir-soft' && req.method === 'POST') {
    try {
      const corpo = await lerCorpo(req);
      const conta = await sessaoPainel(corpo);
      if (!conta) return json(res, 404, { erro: 'não encontrado' }), true;
      const r = await admin.banirUsuario({
        email: conta.email,
        nick: corpo.nick,
        motivo: corpo.motivo,
        soft: true,
      });
      console.log(`[admin] ${conta.email} baniu ${r.nick} (soft)`);
      json(res, 200, r);
    } catch (err) {
      json(res, 400, { erro: err.message });
    }
    return true;
  }

  if (rota === '/admin/usuarios/desbanir' && req.method === 'POST') {
    try {
      const corpo = await lerCorpo(req);
      const conta = await sessaoPainel(corpo);
      if (!conta) return json(res, 404, { erro: 'não encontrado' }), true;
      const r = await admin.desbanirUsuario({ nick: corpo.nick });
      console.log(`[admin] ${conta.email} desbaniu ${r.nick}`);
      json(res, 200, r);
    } catch (err) {
      json(res, 400, { erro: err.message });
    }
    return true;
  }

  if (rota === '/admin/usuarios/apagar' && req.method === 'POST') {
    try {
      const corpo = await lerCorpo(req);
      const conta = await sessaoPainel(corpo);
      if (!conta) return json(res, 404, { erro: 'não encontrado' }), true;
      const r = await admin.apagarConta({ email: conta.email, nick: corpo.nick });
      console.log(`[admin] ${conta.email} apagou conta ${r.nick} (${r.email ?? 'sem e-mail'})`);
      json(res, 200, r);
    } catch (err) {
      json(res, 400, { erro: err.message });
    }
    return true;
  }

  if (rota === '/admin/usuarios/coins' && req.method === 'POST') {
    try {
      const corpo = await lerCorpo(req);
      const conta = await sessaoPainel(corpo);
      if (!conta) return json(res, 404, { erro: 'não encontrado' }), true;
      const r = await admin.definirCoinsUsuario({
        email: conta.email,
        nick: corpo.nick,
        gold: corpo.gold,
      });
      console.log(
        `[admin] ${conta.email} definiu coins de ${r.nick}: ${r.anterior} → ${r.gold}`,
      );
      json(res, 200, r);
    } catch (err) {
      json(res, 400, { erro: err.message });
    }
    return true;
  }

  // ---- trocar o e-mail de login (conta cadastrada antes da whitelist de domínios)
  if (rota === '/admin/usuarios/email' && req.method === 'POST') {
    try {
      const corpo = await lerCorpo(req);
      const conta = await sessaoPainel(corpo);
      if (!conta) return json(res, 404, { erro: 'não encontrado' }), true;
      const r = await admin.trocarEmailUsuario({
        email: conta.email,
        nick: corpo.nick,
        novoEmail: corpo.novoEmail,
      });
      console.log(`[admin] ${conta.email} trocou o e-mail de ${r.nick}: ${r.anterior ?? '—'} → ${r.email}`);
      json(res, 200, r);
    } catch (err) {
      json(res, 400, { erro: err.message });
    }
    return true;
  }

  if (rota === '/admin/usuarios/auditoria' && req.method === 'POST') {
    try {
      const corpo = await lerCorpo(req);
      const conta = await sessaoPainel(corpo);
      if (!conta) return json(res, 404, { erro: 'não encontrado' }), true;
      const { listarAuditoriaJogador } = await import('./audit-db.mjs');
      const r = await listarAuditoriaJogador({
        nick: corpo.nick,
        limite: corpo.limite,
        filtro: corpo.filtro,
      });
      json(res, 200, r);
    } catch (err) {
      json(res, 400, { erro: err.message });
    }
    return true;
  }

  // ---- a ficha completa de um jogador (leitura pura: bolsa, depot, anúncios, origens, log)
  //
  // `sessaoPainel`: a Resolver Auditoria também abre a ficha — é ela que precisa conferir se o
  // item que o jogador diz ter perdido está na bolsa ou preso num anúncio. O que muda é o
  // `completo`: sem admin cheio, a ficha vem SEM e-mail, IP e id de aparelho. Esses três não
  // ajudam a resolver um ticket e são dado pessoal — quem investiga multi-conta é o admin, que
  // tem a aba própria para isso.
  if (rota === '/admin/usuarios/ficha' && req.method === 'POST') {
    try {
      const corpo = await lerCorpo(req);
      const conta = await sessaoPainel(corpo);
      if (!conta) return json(res, 404, { erro: 'não encontrado' }), true;
      json(res, 200, await admin.fichaDeJogador({
        nick: corpo.nick,
        completo: admin.ehAdmin(conta.email),
      }));
    } catch (err) {
      json(res, 400, { erro: err.message });
    }
    return true;
  }

  // ---- guilds: moderação de nome
  if (rota === '/admin/guilds/listar' && req.method === 'POST') {
    try {
      const corpo = await lerCorpo(req);
      const conta = await sessaoPainel(corpo);
      if (!conta) return json(res, 404, { erro: 'não encontrado' }), true;
      json(res, 200, { guilds: await admin.listarGuilds({ busca: corpo.busca, limite: corpo.limite }) });
    } catch (err) {
      json(res, 400, { erro: err.message });
    }
    return true;
  }

  if (rota === '/admin/guilds/apagar' && req.method === 'POST') {
    try {
      const corpo = await lerCorpo(req);
      const conta = await sessaoPainel(corpo);
      if (!conta) return json(res, 404, { erro: 'não encontrado' }), true;
      const apagada = await admin.apagarGuild({ email: conta.email, id: corpo.id });
      json(res, 200, { ok: true, apagada });
    } catch (err) {
      json(res, 400, { erro: err.message });
    }
    return true;
  }

  // ---- contas que dividem a mesma origem (IP ou dispositivo)
  if (rota === '/admin/multicontas/listar' && req.method === 'POST') {
    try {
      const corpo = await lerCorpo(req);
      const conta = await sessaoPainel(corpo);
      if (!conta) return json(res, 404, { erro: 'não encontrado' }), true;
      json(res, 200, await admin.multicontas({
        minimo: corpo.minimo,
        limite: corpo.limite,
        nicks: corpo.nicks,
        incluirApagadas: corpo.incluirApagadas,
        nick: corpo.nick,
      }));
    } catch (err) {
      json(res, 400, { erro: err.message });
    }
    return true;
  }

  // ---- a faxina de um aglomerado: prévia e execução, em duas rotas
  //
  // A prévia é uma rota separada, e não um campo da listagem, porque ela é o contrato do
  // clique: o painel mostra EXATAMENTE quem vai cair e para onde vai a moeda, e manda essa
  // mesma lista de volta em `esperado`. Quem decide continua sendo o servidor — ver
  // `faxinaDeMulticontas`.
  if (rota === '/admin/multicontas/plano' && req.method === 'POST') {
    try {
      const corpo = await lerCorpo(req);
      const conta = await sessaoPainel(corpo);
      if (!conta) return json(res, 404, { erro: 'não encontrado' }), true;
      json(res, 200, await admin.planoDeFaxina({
        tipo: corpo.tipo,
        chave: corpo.chave,
        manter: corpo.manter,
      }));
    } catch (err) {
      json(res, 400, { erro: err.message });
    }
    return true;
  }

  if (rota === '/admin/multicontas/faxina' && req.method === 'POST') {
    try {
      const corpo = await lerCorpo(req);
      const conta = await sessaoPainel(corpo);
      if (!conta) return json(res, 404, { erro: 'não encontrado' }), true;
      const r = await admin.faxinaDeMulticontas({
        email: conta.email,
        tipo: corpo.tipo,
        chave: corpo.chave,
        manter: corpo.manter,
        esperado: Array.isArray(corpo.esperado) ? corpo.esperado.map(String) : null,
      });
      console.log(
        `[admin] ${conta.email} fez faxina de multi-conta em ${r.tipo} ${r.chave}: ` +
        `${r.banidos.length} ban soft, ${r.diamantes} 💎 e ${r.gemas} gemas para ${r.principal}` +
        (r.falhas.length ? ` (${r.falhas.length} falha[s])` : ''),
      );
      json(res, 200, r);
    } catch (err) {
      json(res, 400, { erro: err.message });
    }
    return true;
  }

  // ---- a FAXINA GERAL: todos os IPs acima do teto e fora da whitelist, com prévia antes
  if (rota === '/admin/multicontas/plano-geral' && req.method === 'POST') {
    try {
      const corpo = await lerCorpo(req);
      const conta = await sessaoPainel(corpo);
      if (!conta) return json(res, 404, { erro: 'não encontrado' }), true;
      json(res, 200, await admin.planoDeFaxinaGeral());
    } catch (err) {
      json(res, 400, { erro: err.message });
    }
    return true;
  }

  if (rota === '/admin/multicontas/faxina-geral' && req.method === 'POST') {
    try {
      const corpo = await lerCorpo(req);
      const conta = await sessaoPainel(corpo);
      if (!conta) return json(res, 404, { erro: 'não encontrado' }), true;
      const r = await admin.faxinaGeral({ email: conta.email, esperado: corpo.esperado });
      console.log(
        `[admin] ${conta.email} fez a FAXINA GERAL de multi-conta: ${r.grupos} IP(s), ` +
        `${r.banidos} ban soft, ${r.diamantes} 💎 e ${r.gemas} gemas devolvidos` +
        (r.pulados.length ? ` · ${r.pulados.length} IP(s) pulado(s)` : '') +
        (r.falhas.length ? ` · ${r.falhas.length} falha(s)` : ''),
      );
      json(res, 200, r);
    } catch (err) {
      json(res, 400, { erro: err.message });
    }
    return true;
  }

  // ---- o teto de contas por IP: quem está isento, quem está batendo na trave
  if (rota === '/admin/multicontas/teto' && req.method === 'POST') {
    try {
      const corpo = await lerCorpo(req);
      const conta = await sessaoPainel(corpo);
      if (!conta) return json(res, 404, { erro: 'não encontrado' }), true;
      json(res, 200, await admin.estadoDosLimitesDeRede({ limite: corpo.limite }));
    } catch (err) {
      json(res, 400, { erro: err.message });
    }
    return true;
  }

  if (rota === '/admin/multicontas/liberar-ip' && req.method === 'POST') {
    try {
      const corpo = await lerCorpo(req);
      const conta = await sessaoPainel(corpo);
      if (!conta) return json(res, 404, { erro: 'não encontrado' }), true;
      const r = corpo.travar
        ? await admin.travarIpNoTeto({ ipBucket: corpo.ipBucket })
        : await admin.liberarIpDoTeto({ email: conta.email, ipBucket: corpo.ipBucket, nota: corpo.nota });
      console.log(`[admin] ${conta.email} ${corpo.travar ? 'travou' : 'liberou'} o IP ${r.ipBucket} no teto de contas`);
      json(res, 200, r);
    } catch (err) {
      json(res, 400, { erro: err.message });
    }
    return true;
  }

  // ---- banimento de IP: prévia, banir, desbanir e a lista
  //
  // Só admin completo (`sessaoAdmin`). O IP de quem clica sai da REQUISIÇÃO (`ipCliente`, a mesma
  // leitura do gateway), nunca do corpo: é ele que impede o moderador de banir a própria rede, e
  // um campo no corpo seria uma trava que o próprio pedido desliga.
  if (rota === '/admin/multicontas/ip-ban/previa' && req.method === 'POST') {
    try {
      const corpo = await lerCorpo(req);
      const conta = await sessaoPainel(corpo);
      if (!conta) return json(res, 404, { erro: 'não encontrado' }), true;
      json(res, 200, await admin.previaBanDeIp({ ip: corpo.ip, ipDoAdmin: ipCliente(req) }));
    } catch (err) {
      json(res, 400, { erro: err.message });
    }
    return true;
  }

  if (rota === '/admin/multicontas/ip-ban/banir' && req.method === 'POST') {
    try {
      const corpo = await lerCorpo(req);
      const conta = await sessaoPainel(corpo);
      if (!conta) return json(res, 404, { erro: 'não encontrado' }), true;
      const r = await admin.banirIpDoPainel({
        email: conta.email,
        ip: corpo.ip,
        ipDoAdmin: ipCliente(req),
        motivo: corpo.motivo,
        horas: corpo.horas,
        banirContas: corpo.banirContas === true,
        esperado: Number.isInteger(corpo.esperado) ? corpo.esperado : null,
      });
      console.log(
        `[admin] ${conta.email} baniu o IP ${r.ipBucket}`
        + `${r.expiraEm ? ` até ${new Date(r.expiraEm).toISOString()}` : ' (sem prazo)'}: ${r.motivo}`
        + (r.contasBanidas.length ? ` · ${r.contasBanidas.length} conta(s) com ban soft` : '')
        + (r.falhas.length ? ` · ${r.falhas.length} falha(s)` : ''),
      );
      json(res, 200, r);
    } catch (err) {
      json(res, 400, { erro: err.message });
    }
    return true;
  }

  if (rota === '/admin/multicontas/ip-ban/desbanir' && req.method === 'POST') {
    try {
      const corpo = await lerCorpo(req);
      const conta = await sessaoPainel(corpo);
      if (!conta) return json(res, 404, { erro: 'não encontrado' }), true;
      const r = await admin.desbanirIpDoPainel({ ipBucket: corpo.ipBucket });
      console.log(`[admin] ${conta.email} desbaniu o IP ${r.ipBucket}`);
      json(res, 200, r);
    } catch (err) {
      json(res, 400, { erro: err.message });
    }
    return true;
  }

  if (rota === '/admin/multicontas/ip-ban/listar' && req.method === 'POST') {
    try {
      const corpo = await lerCorpo(req);
      const conta = await sessaoPainel(corpo);
      if (!conta) return json(res, 404, { erro: 'não encontrado' }), true;
      json(res, 200, { banidos: await admin.listarBansDeIp({ limite: corpo.limite }) });
    } catch (err) {
      json(res, 400, { erro: err.message });
    }
    return true;
  }

  // ---- aprovação de saques de gemas
  //
  // `sessaoPainel`: as três rotas da aba (listar os pendentes, aprovar, recusar) valem também
  // para a Resolver Auditoria. Quem aprovou fica em `orb_saques.aprovado_por` e quem recusou vai
  // na nota do cancelamento, então as duas ações seguem com nome e sobrenome. O HISTÓRICO de
  // depósitos e saques (`/admin/gemas/*/listar`) continua só do admin completo.
  if (rota === '/admin/gemas/saques/pendentes' && req.method === 'POST') {
    try {
      const corpo = await lerCorpo(req);
      const conta = await sessaoPainel(corpo);
      if (!conta) return json(res, 404, { erro: 'não encontrado' }), true;
      json(res, 200, await admin.listarSaquesAguardandoAprovacao({
        limite: corpo.limite,
        offset: corpo.offset,
      }));
    } catch (err) {
      json(res, 400, { erro: err.message });
    }
    return true;
  }

  if (rota === '/admin/gemas/saques/aprovar' && req.method === 'POST') {
    try {
      const corpo = await lerCorpo(req);
      const conta = await sessaoPainel(corpo);
      if (!conta) return json(res, 404, { erro: 'não encontrado' }), true;
      const r = await admin.aprovarSaqueGemas({ email: conta.email, id: corpo.id });
      console.log(`[admin] ${conta.email} aprovou saque ${corpo.id}`);
      json(res, 200, r);
    } catch (err) {
      json(res, 400, { erro: err.message });
    }
    return true;
  }

  if (rota === '/admin/gemas/saques/rejeitar' && req.method === 'POST') {
    try {
      const corpo = await lerCorpo(req);
      const conta = await sessaoPainel(corpo);
      if (!conta) return json(res, 404, { erro: 'não encontrado' }), true;
      const r = await admin.rejeitarSaqueGemas({
        email: conta.email,
        id: corpo.id,
        motivo: corpo.motivo,
      });
      console.log(`[admin] ${conta.email} recusou saque ${corpo.id}`);
      json(res, 200, r);
    } catch (err) {
      json(res, 400, { erro: err.message });
    }
    return true;
  }

  if (rota === '/admin/gemas/depositos/listar' && req.method === 'POST') {
    try {
      const corpo = await lerCorpo(req);
      const conta = await sessaoPainel(corpo);
      if (!conta) return json(res, 404, { erro: 'não encontrado' }), true;
      json(res, 200, await admin.listarHistoricoDepositosGemas({
        nick: corpo.nick,
        limite: corpo.limite,
        offset: corpo.offset,
      }));
    } catch (err) {
      json(res, 400, { erro: err.message });
    }
    return true;
  }

  if (rota === '/admin/gemas/saques/listar' && req.method === 'POST') {
    try {
      const corpo = await lerCorpo(req);
      const conta = await sessaoPainel(corpo);
      if (!conta) return json(res, 404, { erro: 'não encontrado' }), true;
      json(res, 200, await admin.listarHistoricoSaquesGemas({
        nick: corpo.nick,
        limite: corpo.limite,
        offset: corpo.offset,
      }));
    } catch (err) {
      json(res, 400, { erro: err.message });
    }
    return true;
  }

  // ---- eventos globais (buff de XP/farm para todo mundo)
  //
  // As três porcentagens e os minutos são limitados de novo em `game/eventos.mjs`: o que chega
  // aqui é pedido, e a tela já ter limitado não conta como validação.
  if (rota === '/admin/eventos/estado' && req.method === 'POST') {
    try {
      const corpo = await lerCorpo(req);
      const conta = await sessaoPainel(corpo);
      if (!conta) return json(res, 404, { erro: 'não encontrado' }), true;
      json(res, 200, await admin.estadoDosEventos(corpo.limite));
    } catch (err) {
      json(res, 400, { erro: err.message });
    }
    return true;
  }

  if (rota === '/admin/eventos/criar' && req.method === 'POST') {
    try {
      const corpo = await lerCorpo(req);
      const conta = await sessaoPainel(corpo);
      if (!conta) return json(res, 404, { erro: 'não encontrado' }), true;
      const ev = await admin.criarEvento({
        email: conta.email,
        xpTreinadorPct: corpo.xpTreinadorPct,
        xpPokemonPct: corpo.xpPokemonPct,
        farmPct: corpo.farmPct,
        minutos: corpo.minutos,
      });
      console.log(
        `[admin] ${conta.email} ligou evento: treinador +${ev.xpTreinadorPct}% · ` +
          `pokémon +${ev.xpPokemonPct}% · farm +${ev.farmPct}% por ${ev.minutos} min`,
      );
      json(res, 200, ev);
    } catch (err) {
      json(res, 400, { erro: err.message });
    }
    return true;
  }

  // ---- agenda semanal: a regra que liga o evento sozinho
  if (rota === '/admin/eventos/agenda/criar' && req.method === 'POST') {
    try {
      const corpo = await lerCorpo(req);
      const conta = await sessaoPainel(corpo);
      if (!conta) return json(res, 404, { erro: 'não encontrado' }), true;
      const regra = await admin.criarAgendaDeEvento({
        email: conta.email,
        dias: corpo.dias,
        hora: corpo.hora,
        minuto: corpo.minuto,
        xpTreinadorPct: corpo.xpTreinadorPct,
        xpPokemonPct: corpo.xpPokemonPct,
        farmPct: corpo.farmPct,
        minutos: corpo.minutos,
      });
      console.log(
        `[admin] ${conta.email} agendou evento semanal #${regra.id}: dias ${regra.dias.join(',')} ` +
          `às ${String(regra.hora).padStart(2, '0')}:${String(regra.minuto).padStart(2, '0')} · ` +
          `${regra.xpTreinadorPct}/${regra.xpPokemonPct}/${regra.farmPct} por ${regra.minutos} min`,
      );
      json(res, 200, { ok: true, regra });
    } catch (err) {
      json(res, 400, { erro: err.message });
    }
    return true;
  }

  if (rota === '/admin/eventos/agenda/remover' && req.method === 'POST') {
    try {
      const corpo = await lerCorpo(req);
      const conta = await sessaoPainel(corpo);
      if (!conta) return json(res, 404, { erro: 'não encontrado' }), true;
      const regra = await admin.removerAgendaDeEvento(corpo.id);
      console.log(`[admin] ${conta.email} apagou a agenda de evento #${corpo.id}`);
      json(res, 200, { ok: true, regra });
    } catch (err) {
      json(res, 400, { erro: err.message });
    }
    return true;
  }

  if (rota === '/admin/eventos/agenda/alternar' && req.method === 'POST') {
    try {
      const corpo = await lerCorpo(req);
      const conta = await sessaoPainel(corpo);
      if (!conta) return json(res, 404, { erro: 'não encontrado' }), true;
      const regra = await admin.alternarAgendaDeEvento(corpo.id, corpo.ativa);
      console.log(`[admin] ${conta.email} ${corpo.ativa ? 'ligou' : 'pausou'} a agenda #${corpo.id}`);
      json(res, 200, { ok: true, regra });
    } catch (err) {
      json(res, 400, { erro: err.message });
    }
    return true;
  }

  if (rota === '/admin/eventos/encerrar' && req.method === 'POST') {
    try {
      const corpo = await lerCorpo(req);
      const conta = await sessaoPainel(corpo);
      if (!conta) return json(res, 404, { erro: 'não encontrado' }), true;
      const r = await admin.encerrarEvento({ email: conta.email });
      console.log(`[admin] ${conta.email} encerrou o evento em andamento`);
      json(res, 200, r);
    } catch (err) {
      json(res, 400, { erro: err.message });
    }
    return true;
  }

  // ---- contagem online (acréscimos manuais no /saude)
  if (rota === '/admin/online-contagem/estado' && req.method === 'POST') {
    try {
      const corpo = await lerCorpo(req);
      const conta = await sessaoAdmin(corpo);
      if (!conta) return json(res, 404, { erro: 'não encontrado' }), true;
      json(res, 200, await admin.estadoContagemOnline());
    } catch (err) {
      json(res, 400, { erro: err.message });
    }
    return true;
  }

  if (rota === '/admin/online-contagem/adicionar' && req.method === 'POST') {
    try {
      const corpo = await lerCorpo(req);
      const conta = await sessaoAdmin(corpo);
      if (!conta) return json(res, 404, { erro: 'não encontrado' }), true;
      const item = await admin.adicionarContagemOnline({ email: conta.email, qtd: corpo.qtd });
      json(res, 200, item);
    } catch (err) {
      json(res, 400, { erro: err.message });
    }
    return true;
  }

  if (rota === '/admin/online-contagem/remover' && req.method === 'POST') {
    try {
      const corpo = await lerCorpo(req);
      const conta = await sessaoAdmin(corpo);
      if (!conta) return json(res, 404, { erro: 'não encontrado' }), true;
      const r = await admin.removerContagemOnline({ email: conta.email, id: corpo.id });
      json(res, 200, r);
    } catch (err) {
      json(res, 400, { erro: err.message });
    }
    return true;
  }

  if (rota === '/admin/online-contagem/remover-tudo' && req.method === 'POST') {
    try {
      const corpo = await lerCorpo(req);
      const conta = await sessaoAdmin(corpo);
      if (!conta) return json(res, 404, { erro: 'não encontrado' }), true;
      json(res, 200, await admin.removerTodasContagensOnline({ email: conta.email }));
    } catch (err) {
      json(res, 400, { erro: err.message });
    }
    return true;
  }

  if (rota === '/admin/diamantes/historico' && req.method === 'POST') {
    try {
      const corpo = await lerCorpo(req);
      const conta = await sessaoAdmin(corpo);
      if (!conta) return json(res, 404, { erro: 'não encontrado' }), true;
      json(res, 200, await admin.listarHistoricoDiamantes({
        nick: corpo.nick,
        dia: corpo.dia,
        limite: corpo.limite,
        offset: corpo.offset,
      }));
    } catch (err) {
      json(res, 400, { erro: err.message });
    }
    return true;
  }

  if (rota === '/admin/referrals/listar' && req.method === 'POST') {
    try {
      const corpo = await lerCorpo(req);
      const conta = await sessaoPainel(corpo);
      if (!conta) return json(res, 404, { erro: 'não encontrado' }), true;
      json(res, 200, await admin.listarReferrals({
        q: corpo.q,
        limite: corpo.limite,
        offset: corpo.offset,
      }));
    } catch (err) {
      json(res, 400, { erro: err.message });
    }
    return true;
  }

  // Os CONVITES DO DISCORD. Só leitura: as duas tabelas são escritas pelo bot e pelo sim.
  if (rota === '/admin/convites/listar' && req.method === 'POST') {
    try {
      const corpo = await lerCorpo(req);
      const conta = await sessaoPainel(corpo);
      if (!conta) return json(res, 404, { erro: 'não encontrado' }), true;
      json(res, 200, await admin.convitesDiscord({
        q: corpo.q,
        limite: corpo.limite,
        offset: corpo.offset,
      }));
    } catch (err) {
      json(res, 400, { erro: err.message });
    }
    return true;
  }

  if (rota === '/admin/referral-especial/listar' && req.method === 'POST') {
    try {
      const corpo = await lerCorpo(req);
      const conta = await sessaoPainel(corpo);
      if (!conta) return json(res, 404, { erro: 'não encontrado' }), true;
      json(res, 200, await admin.listarReferralEspecial());
    } catch (err) {
      json(res, 400, { erro: err.message });
    }
    return true;
  }

  if (rota === '/admin/referral-especial/definir' && req.method === 'POST') {
    try {
      const corpo = await lerCorpo(req);
      const conta = await sessaoPainel(corpo);
      if (!conta) return json(res, 404, { erro: 'não encontrado' }), true;
      const r = await admin.definirReferralEspecial({
        email: conta.email,
        nick: corpo.nick,
        slug: corpo.slug,
        taxaGemaPct: corpo.taxaGemaPct,
        taxaDiamantePct: corpo.taxaDiamantePct,
        taxaDiaExtraPct: corpo.taxaDiaExtraPct,
        streamerOficial: corpo.streamerOficial,
        confirmado: corpo.confirmado,
      });
      console.log(
        `[admin] ${conta.email} definiu referral especial de ${r.nick}: ` +
        `gema ${r.taxaGema ?? 'padrão'} · diamante ${r.taxaDiamante ?? 'padrão'} · ` +
        `extra ${r.taxaDiaExtra ?? 0} · link ${r.slug ?? '—'} · streamer ${r.streamerOficial}`,
      );
      json(res, 200, r);
    } catch (err) {
      json(res, 400, { erro: err.message });
    }
    return true;
  }

  if (rota === '/admin/referral-especial/remover' && req.method === 'POST') {
    try {
      const corpo = await lerCorpo(req);
      const conta = await sessaoPainel(corpo);
      if (!conta) return json(res, 404, { erro: 'não encontrado' }), true;
      const r = await admin.removerReferralEspecial({ nick: corpo.nick });
      console.log(`[admin] ${conta.email} removeu o referral especial de ${r.nick}`);
      json(res, 200, r);
    } catch (err) {
      json(res, 400, { erro: err.message });
    }
    return true;
  }

  if (rota === '/admin/financeiro/resumo' && req.method === 'POST') {
    try {
      const corpo = await lerCorpo(req);
      const conta = await sessaoAdmin(corpo);
      if (!conta) return json(res, 404, { erro: 'não encontrado' }), true;
      json(res, 200, await admin.custosGanhos());
    } catch (err) {
      console.error('[admin] financeiro/resumo falhou:', err.message);
      json(res, 500, { erro: 'não deu para montar o resumo financeiro' });
    }
    return true;
  }

  if (rota === '/admin/financeiro/custos/salvar' && req.method === 'POST') {
    try {
      const corpo = await lerCorpo(req);
      const conta = await sessaoAdmin(corpo);
      if (!conta) return json(res, 404, { erro: 'não encontrado' }), true;
      json(res, 200, await admin.salvarCusto({
        email: conta.email,
        id: corpo.id,
        tipo: corpo.tipo,
        descricao: corpo.descricao,
        valorCentavos: corpo.valorCentavos,
      }));
    } catch (err) {
      json(res, 400, { erro: err.message });
    }
    return true;
  }

  if (rota === '/admin/financeiro/custos/remover' && req.method === 'POST') {
    try {
      const corpo = await lerCorpo(req);
      const conta = await sessaoAdmin(corpo);
      if (!conta) return json(res, 404, { erro: 'não encontrado' }), true;
      json(res, 200, await admin.removerCusto({ id: corpo.id }));
    } catch (err) {
      json(res, 400, { erro: err.message });
    }
    return true;
  }

  if (rota === '/admin/financeiro/config' && req.method === 'POST') {
    try {
      const corpo = await lerCorpo(req);
      const conta = await sessaoAdmin(corpo);
      if (!conta) return json(res, 404, { erro: 'não encontrado' }), true;
      json(res, 200, await admin.definirFinConfig({
        cotacaoUsdtBrl: corpo.cotacaoUsdtBrl,
        mesesOperacao: corpo.mesesOperacao,
      }));
    } catch (err) {
      json(res, 400, { erro: err.message });
    }
    return true;
  }

  if (rota === '/admin/emails/enviar' && req.method === 'POST') {
    try {
      const corpo = await lerCorpo(req, 16384);
      const conta = await sessaoPainel(corpo);
      if (!conta) return json(res, 404, { erro: 'não encontrado' }), true;
      const r = await admin.enviarEmailAdmin({
        email: conta.email,
        para: corpo.para,
        assunto: corpo.assunto,
        mensagem: corpo.mensagem,
      });
      json(res, 200, r);
    } catch (err) {
      json(res, 400, { erro: err.message });
    }
    return true;
  }

  if (rota === '/admin/emails/recebidos/listar' && req.method === 'POST') {
    try {
      const corpo = await lerCorpo(req);
      const conta = await sessaoPainel(corpo);
      if (!conta) return json(res, 404, { erro: 'não encontrado' }), true;
      json(res, 200, await admin.listarEmailsRecebidos({ limit: corpo.limite, after: corpo.after }));
    } catch (err) {
      json(res, 400, { erro: err.message });
    }
    return true;
  }

  if (rota === '/admin/emails/recebidos/detalhe' && req.method === 'POST') {
    try {
      const corpo = await lerCorpo(req);
      const conta = await sessaoPainel(corpo);
      if (!conta) return json(res, 404, { erro: 'não encontrado' }), true;
      json(res, 200, await admin.obterEmailRecebido({ id: corpo.id }));
    } catch (err) {
      json(res, 400, { erro: err.message });
    }
    return true;
  }

  if (rota === '/admin/emails/recebidos/responder' && req.method === 'POST') {
    try {
      const corpo = await lerCorpo(req, 16384);
      const conta = await sessaoPainel(corpo);
      if (!conta) return json(res, 404, { erro: 'não encontrado' }), true;
      const r = await admin.responderEmailRecebido({
        email: conta.email,
        id: corpo.id,
        assunto: corpo.assunto,
        mensagem: corpo.mensagem,
      });
      json(res, 200, r);
    } catch (err) {
      json(res, 400, { erro: err.message });
    }
    return true;
  }

  if (rota === '/admin/emails/enviados/listar' && req.method === 'POST') {
    try {
      const corpo = await lerCorpo(req);
      const conta = await sessaoPainel(corpo);
      if (!conta) return json(res, 404, { erro: 'não encontrado' }), true;
      json(res, 200, await admin.listarEmailsMarketingEnviados({
        limit: corpo.limite,
        offset: corpo.offset,
      }));
    } catch (err) {
      json(res, 400, { erro: err.message });
    }
    return true;
  }

  if (rota === '/admin/emails/enviados/detalhe' && req.method === 'POST') {
    try {
      const corpo = await lerCorpo(req);
      const conta = await sessaoPainel(corpo);
      if (!conta) return json(res, 404, { erro: 'não encontrado' }), true;
      json(res, 200, await admin.obterEmailMarketingEnviado({ id: corpo.id }));
    } catch (err) {
      json(res, 400, { erro: err.message });
    }
    return true;
  }

  // ---- emissão de notas (export das compras da Efí para a contabilidade)
  if (rota === '/admin/notas/listar' && req.method === 'POST') {
    try {
      const corpo = await lerCorpo(req);
      const conta = await sessaoAdmin(corpo);
      if (!conta) return json(res, 404, { erro: 'não encontrado' }), true;
      json(res, 200, await admin.emissaoNotas({ mes: corpo.mes }));
    } catch (err) {
      json(res, 400, { erro: err.message });
    }
    return true;
  }

  if (rota === '/admin/notas/exportar' && req.method === 'POST') {
    try {
      const corpo = await lerCorpo(req);
      const conta = await sessaoAdmin(corpo);
      if (!conta) return json(res, 404, { erro: 'não encontrado' }), true;
      const r = await admin.exportarNotas({ mes: corpo.mes, formato: corpo.formato });
      console.log(`[admin] ${conta.email} exportou notas ${corpo.mes} (${corpo.formato || 'csv'})`);
      json(res, 200, r);
    } catch (err) {
      json(res, 400, { erro: err.message });
    }
    return true;
  }

  // ---- Documentos para MED (relatório de auditoria de uma conta, para contestação PIX)
  //
  // O portão é o do admin completo MAIS a lista opcional `MED_EMAILS` (ver `med.mjs`); quem não
  // passa leva o 404 de sempre. Toda resposta sai com `no-store` — ela carrega CPF e e-mail — e
  // os logs daqui só levam e-mail do admin, nick e código do documento, nunca o dado pessoal.
  if (rota.startsWith('/admin/med/') && req.method === 'POST') {
    const med = await import('./med.mjs');
    const jsonMed = (codigo, corpo) => {
      res.writeHead(codigo, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify(corpo));
    };
    try {
      const corpo = await lerCorpo(req, 16384);
      const conta = await sessaoAdmin(corpo);
      if (!conta || !med.podeUsarMed(conta.email, true)) return jsonMed(404, { erro: 'não encontrado' }), true;
      const acao = rota.slice('/admin/med/'.length);

      if (acao === 'buscar') {
        jsonMed(200, await med.buscar({ nick: corpo.nick, transacao: corpo.transacao, porEmail: conta.email }));
      } else if (acao === 'emitir') {
        const r = await med.emitir({
          playerId: corpo.playerId, contexto: corpo.contexto, observacao: corpo.observacao, porEmail: conta.email,
        });
        console.log(`[admin] ${conta.email} emitiu o documento ${r.codigo} (MED) da conta ${r.nick}`);
        jsonMed(200, r);
      } else if (acao === 'pdf') {
        const r = await med.gerarPdf({ codigo: corpo.codigo, porEmail: conta.email });
        console.log(`[admin] ${conta.email} gerou o PDF de ${String(corpo.codigo).toUpperCase()}`);
        res.writeHead(200, {
          'content-type': 'application/pdf',
          'content-disposition': `attachment; filename="${r.arquivo}"`,
          'content-length': r.buffer.length,
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
          'x-hash-pdf': r.hashPdf,
        });
        res.end(r.buffer);
      } else if (acao === 'verificar') {
        jsonMed(200, await med.verificar({ codigo: corpo.codigo, hashArquivo: corpo.hashArquivo, porEmail: conta.email }));
      } else if (acao === 'historico') {
        jsonMed(200, await med.historico());
      } else {
        jsonMed(404, { erro: 'não encontrado' });
      }
    } catch (err) {
      const conhecido = err instanceof med.ErroMed;
      if (!conhecido) console.error('[admin] documento MED falhou:', err.message);
      if (!res.headersSent) jsonMed(conhecido ? err.status : 500, { erro: conhecido ? err.message : 'não deu para concluir — veja o log do servidor' });
    }
    return true;
  }

  json(res, 404, { erro: 'não encontrado' });
  return true;
}
