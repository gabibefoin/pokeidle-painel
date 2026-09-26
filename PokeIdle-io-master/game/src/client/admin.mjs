// A tela do painel de lucro.
//
// Ela é UM CONSUMIDOR de `/admin/painel` e nada mais: não decide quem é admin, não calcula
// sobra e não sabe quais carteiras existem. Tudo isso vem do servidor a cada carga, porque
// tudo isso é decisão de segurança — e decisão de segurança que mora no navegador é decisão
// de quem abrir o DevTools.
//
// A sessão é a MESMA do jogo (`localStorage.sessao`). Quem não tiver token, ou tiver um de
// conta que não está em `ADMIN_EMAILS` nem em `AUDITORIA_RESOLVER_EMAILS`, recebe 404 do
// servidor e vê a mesma tela de "não encontrado" que qualquer estranho veria.

const $ = (s) => document.querySelector(s);

const escapar = (t) =>
  String(t ?? '').replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' })[c]);

const usdt = (n) => `${Number(n ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 6 })} USDT`;
const brl = (centavos) => (Number(centavos ?? 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const num = (n) => Number(n ?? 0).toLocaleString('pt-BR');

const FUSO_BR = 'America/Sao_Paulo';
const hojeBr = () => new Date().toLocaleDateString('sv-SE', { timeZone: FUSO_BR });

const ajustarDia = (dia, delta) => {
  const [y, m, d] = String(dia).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  return dt.toISOString().slice(0, 10);
};

const rotuloDia = (dia) => {
  const hoje = hojeBr();
  if (dia === hoje) return 'Hoje';
  if (dia === ajustarDia(hoje, -1)) return 'Ontem';
  const [y, m, d] = String(dia).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('pt-BR', {
    weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric',
  });
};

const sessao = () => {
  try {
    return JSON.parse(localStorage.getItem('sessao') ?? 'null');
  } catch {
    return null;
  }
};

async function pedir(rota, corpo = {}) {
  const r = await fetch(`/admin/${rota}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: sessao()?.token, ...corpo }),
  });
  const dados = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(dados.erro ?? 'falhou');
  return dados;
}

const bloco = (rotulo, valor, extra = '', classe = '') =>
  `<div class="adm-bloco ${classe}"><b>${escapar(valor)}</b><span>${escapar(rotulo)}</span>${
    extra ? `<em>${escapar(extra)}</em>` : ''
  }</div>`;

// ------------------------------------------------------------------- fiat

function secaoFiat(f) {
  const resumo = f.porMetodo.length
    ? f.porMetodo
        .map(
          (m) => `<tr><td>${escapar(m.metodo)}</td><td>${escapar(m.provedor)}</td>
                  <td class="n">${num(m.pagamentos)}</td>
                  <td class="n">${brl(m.centavos)}</td>
                  <td class="n">${brl(m.liquidoCentavos)}</td>
                  <td class="n">${brl(m.taxaCentavos)}</td></tr>`,
        )
        .join('')
    : '<tr><td colspan="6">nenhum pagamento confirmado ainda</td></tr>';

  return `<section class="adm-secao">
    <h2>Diamantes — PIX e cartão</h2>
    <p class="adm-legenda">Bruto = pago pelo jogador. Líquido = após taxa (Efí 1,19%; Stripe 3,99% + R$ 0,39; pagamentos antigos do LivePix a 5%).</p>
    <div class="adm-blocos">
      ${bloco('bruto', brl(f.totalCentavos), 'total pago pelos jogadores')}
      ${bloco('líquido', brl(f.totalLiquidoCentavos), 'chegou na conta')}
      ${bloco('taxas', brl(f.totalTaxaCentavos), 'Efí + Stripe')}
      ${bloco('diamantes emitidos', num(f.diamantes.emitidos))}
      ${bloco('gastos no jogo', num(f.diamantes.gastos))}
      ${bloco('em circulação', num(f.diamantes.circulando))}
    </div>
    <p class="adm-legenda">Resumo por método — histórico paginado na aba <b>Diamantes</b>.</p>
    <table class="adm-tabela" style="margin-top:6px">
      <tr><th>método</th><th>provedor</th><th style="text-align:right">pagamentos</th><th style="text-align:right">bruto</th><th style="text-align:right">líquido</th><th style="text-align:right">taxa</th></tr>
      ${resumo}
    </table>
  </section>`;
}

// ----------------------------------------------------------------- crypto

function secaoCrypto(c) {
  // `naCarteira` nulo quer dizer que o RPC não respondeu. Nesse caso o servidor já zerou a
  // sobra; aqui a tela explica por quê, em vez de mostrar um zero sem motivo.
  const semRpc = c.naCarteira === null;
  return `<section class="adm-secao">
    <h2>Gemas — lastro em USDT</h2>
    <div class="adm-blocos">
      ${bloco('caixa', usdt(c.caixa), semRpc ? 'contábil (RPC fora)' : 'o menor entre contábil e on-chain')}
      ${bloco('passivo', usdt(c.passivo), `${num(c.orbsPassivoTotal ?? c.orbsEmCirculacao)} gemas × ${c.precoSaque}`, 'passivo')}
      ${bloco('lucro', usdt(c.lucro), 'caixa − passivo')}
      ${bloco('sobra segura', usdt(c.sobra), `colchão de ${c.colchao}× o passivo`, 'sobra')}
    </div>
    <table class="adm-tabela" style="margin-top:10px">
      <tr><th>conta</th><th style="text-align:right">valor</th></tr>
      <tr><td>depositado (histórico)</td><td class="n">${usdt(c.compradoUsdt)}</td></tr>
      <tr><td>sacado por jogadores</td><td class="n">${usdt(c.sacadoUsdt)}</td></tr>
      <tr><td>caixa contábil</td><td class="n">${usdt(c.contabil)}</td></tr>
      <tr><td>saldo na carteira (on-chain)</td><td class="n">${semRpc ? '— RPC não respondeu' : usdt(c.naCarteira)}</td></tr>
      <tr><td>gemas em circulação (ledger)</td><td class="n">${num(c.orbsEmCirculacao)}</td></tr>
      <tr><td>gemas pendentes em referrals</td><td class="n">${num(c.gemasAfiliadoPendentes ?? 0)}</td></tr>
      <tr><td><b>passivo total (gemas)</b></td><td class="n"><b>${num(c.orbsPassivoTotal ?? c.orbsEmCirculacao)}</b></td></tr>
    </table>
    <p class="adm-legenda" style="margin-top:8px">Comissões de gemas em Indique &amp; Ganhe entram no passivo assim que são geradas, mesmo antes do indicador clicar em Recolher — quando recolhe, só migram do referral para o ledger.</p>
  </section>`;
}

// --------------------------------------------------------------- colheita

function secaoVarredura(v) {
  const disponivel = !!v?.disponivel;
  return `<section class="adm-secao">
    <h2>Varredura para a tesouraria</h2>
    <div class="adm-colher">
      <p class="adm-aviso" style="margin:0 0 12px">
        Recolhe USDT dos endereços de depósito dos jogadores para a carteira do projeto.
        O cron diário (4h UTC) faz o mesmo com piso de $1; aqui recolhe a partir de $0,01.
      </p>
      <div class="adm-linha">
        <button class="adm-botao" id="adm-varredura" ${disponivel ? '' : 'disabled'}>
          Forçar varredura
        </button>
      </div>
      <p class="adm-aviso" id="adm-varredura-msg">
        ${disponivel
          ? 'Pode levar alguns minutos se houver muitos endereços. Não feche a página até terminar.'
          : 'Indisponível: configure CHAIN_REDE, ORB_SEED_DEPOSITOS e CARTEIRA_PROJETO no servidor.'}
      </p>
    </div>
  </section>`;
}

function secaoColher(c, carteiras) {
  if (!carteiras.length) {
    return `<section class="adm-secao"><h2>Transferir a sobra</h2>
      <div class="adm-colher"><p class="adm-aviso">
        Nenhuma carteira cadastrada. Defina <code>CARTEIRAS_LUCRO=nome:endereco</code> no
        <code>.env</code> do servidor e reinicie. O campo é uma lista fechada de propósito:
        se esta sessão for roubada, o dinheiro só pode ir para onde você já autorizou.
      </p></div></section>`;
  }

  const opcoes = carteiras
    .map((w) => `<option value="${escapar(w.endereco)}">${escapar(w.nome)} · ${escapar(w.endereco.slice(0, 8))}…</option>`)
    .join('');

  return `<section class="adm-secao">
    <h2>Transferir a sobra</h2>
    <div class="adm-colher">
      <div class="adm-linha">
        <div class="adm-campo">
          <label for="adm-carteira">carteira de destino</label>
          <select id="adm-carteira">${opcoes}</select>
        </div>
        <div class="adm-campo" style="max-width:200px">
          <label for="adm-valor">valor em USDT</label>
          <input id="adm-valor" type="number" step="0.000001" min="0" max="${c.sobra}" value="${c.sobra.toFixed(6)}">
        </div>
        <button class="adm-botao" id="adm-enviar" ${c.sobra <= 0 ? 'disabled' : ''}>Transferir</button>
      </div>
      <p class="adm-aviso" id="adm-msg">
        ${c.sobra > 0
          ? `Máximo ${usdt(c.sobra)} — é o que passa do colchão de ${c.colchao}× o passivo. O servidor recalcula na hora do envio e recusa o que passar disso.`
          : 'Sem sobra: o caixa ainda não passa do colchão sobre o passivo.'}
      </p>
    </div>
  </section>`;
}

function secaoHistorico(h) {
  if (!h.length) return '';
  const linhas = h
    .map(
      (c) => `<tr>
        <td>${new Date(c.em).toLocaleString('pt-BR')}</td>
        <td class="n">${usdt(c.usdt)}</td>
        <td>${escapar(c.carteira.slice(0, 10))}…</td>
        <td>${c.erro ? `<span style="color:#ffd0c6">${escapar(c.erro.slice(0, 60))}</span>` : escapar((c.assinatura ?? '').slice(0, 16) + '…')}</td>
      </tr>`,
    )
    .join('');
  return `<section class="adm-secao"><h2>Colheitas anteriores</h2>
    <table class="adm-tabela">
      <tr><th>quando</th><th style="text-align:right">valor</th><th>destino</th><th>transação / erro</th></tr>
      ${linhas}
    </table></section>`;
}

const ROTULO_CARGO = { moderador: 'Moderador', helper: 'Helper', streamer: 'Streamer', admin: 'Admin' };

const ROTULO_MUTE_MIN = { 5: '5 min', 30: '30 min', 60: '1 h', 1440: '24 h' };

/** "faltam 1h 12min" — tempo restante de um mute. */
function restanteDoMute(restanteMs) {
  const ms = Number(restanteMs) || 0;
  if (ms <= 0) return 'encerrado';
  const min = Math.ceil(ms / 60000);
  if (min < 60) return `faltam ${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h >= 24) {
    const d = Math.floor(h / 24);
    const hr = h % 24;
    return hr > 0 ? `faltam ${d}d ${hr}h` : `faltam ${d}d`;
  }
  return m > 0 ? `faltam ${h}h ${m}min` : `faltam ${h}h`;
}

function secaoMutes(mutes) {
  const linhas = mutes?.length
    ? mutes
        .map((m) => {
          const por = m.porNick
            ? `${escapar(m.porNick)}${m.porCargo ? ` (${escapar(ROTULO_CARGO[m.porCargo] ?? m.porCargo)})` : ''}`
            : '—';
          const duracao = ROTULO_MUTE_MIN[m.minutos] ?? (m.minutos ? `${num(m.minutos)} min` : '—');
          return `<tr>
            <td><b>${escapar(m.nick)}</b></td>
            <td>${duracao}</td>
            <td>${restanteDoMute(m.restanteMs)}</td>
            <td>${new Date(m.ate).toLocaleString('pt-BR')}</td>
            <td>${por}</td>
            <td><button class="adm-botao-mini adm-mute-revogar" data-nick="${escapar(m.nick)}">Revogar</button></td>
          </tr>`;
        })
        .join('')
    : '<tr><td colspan="6">nenhum jogador mutado no momento</td></tr>';

  return `<section class="adm-secao">
    <h2>Usuários mutados</h2>
    <p class="adm-legenda">Mutes aplicados por moderadores, helpers ou admins no chat. A lista atualiza ao abrir esta seção.</p>
    <div class="adm-linha" style="margin-bottom:10px">
      <button class="adm-botao-mini" id="adm-mutes-atualizar">Atualizar</button>
    </div>
    <p class="adm-aviso" id="adm-mutes-msg" hidden></p>
    <table class="adm-tabela">
      <tr><th>nick</th><th>mute aplicado</th><th>restante</th><th>expira em</th><th>por</th><th></th></tr>
      ${linhas}
    </table>
  </section>`;
}

function secaoCargos(cargos) {
  const linhas = cargos?.length
    ? cargos
        .map(
          (c) => `<tr>
            <td><b>${escapar(c.nick)}</b></td>
            <td><span class="adm-tag adm-tag-${escapar(c.cargo)}">${escapar(ROTULO_CARGO[c.cargo] ?? c.cargo)}</span></td>
            <td>${new Date(c.em).toLocaleString('pt-BR')}</td>
            <td>${escapar(c.por)}</td>
            <td><button class="adm-botao-mini" data-nick="${escapar(c.nick)}">Remover</button></td>
          </tr>`,
        )
        .join('')
    : '<tr><td colspan="5">nenhuma tag atribuída ainda</td></tr>';

  return `<section class="adm-secao">
    <h2>Tags do chat</h2>
    <p class="adm-legenda">Atribua [Moderador] (verde), [Helper] (rosa claro) ou [STREAMER] (roxo) por nick — igual ao [Admin], mas manual.</p>
    <div class="adm-colher">
      <div class="adm-linha">
        <div class="adm-campo">
          <label for="adm-cargo-nick">nick do jogador</label>
          <input id="adm-cargo-nick" type="text" maxlength="16" placeholder="Fulano">
        </div>
        <div class="adm-campo" style="max-width:200px">
          <label for="adm-cargo-tipo">tag</label>
          <select id="adm-cargo-tipo">
            <option value="moderador">Moderador — verde</option>
            <option value="helper">Helper — rosa claro</option>
            <option value="streamer">Streamer — roxo</option>
          </select>
        </div>
        <button class="adm-botao" id="adm-cargo-salvar">Atribuir</button>
      </div>
      <p class="adm-aviso" id="adm-cargo-msg">O jogador precisa reconectar para a tag aparecer no chat.</p>
    </div>
    <table class="adm-tabela" style="margin-top:12px">
      <tr><th>nick</th><th>tag</th><th>desde</th><th>por</th><th></th></tr>
      ${linhas}
    </table>
  </section>`;
}

const paginacaoHtml = ({ total, offset, limite, prevId, nextId, label = 'registros' }) => {
  const pagina = Math.floor(offset / limite) + 1;
  const paginas = Math.max(1, Math.ceil(total / limite));
  return `<div class="adm-paginacao">
    <span>${num(total)} ${label} · pág. ${pagina}/${paginas}</span>
    <button class="adm-botao-mini" id="${prevId}" ${offset <= 0 ? 'disabled' : ''}>← Anterior</button>
    <button class="adm-botao-mini" id="${nextId}" ${offset + limite >= total ? 'disabled' : ''}>Próxima →</button>
  </div>`;
};

const ROTULO_STATUS_SAQUE = {
  aguardando_aprovacao: 'aguardando aprovação',
  pendente: 'na fila',
  enviando: 'enviando',
  confirmado: 'confirmado',
  falhou: 'falhou',
  cancelado: 'cancelado',
};

function secaoDiamantes(d) {
  const linhas = d.pagamentos?.length
    ? d.pagamentos
        .map(
          (p) => `<tr>
            <td>${new Date(p.em).toLocaleString('pt-BR')}</td>
            <td><b>${escapar(p.nick)}</b></td>
            <td>${escapar(p.metodo)}</td>
            <td>${escapar(p.provedor)}</td>
            <td class="n">${num(p.qtd)}</td>
            <td class="n">${brl(p.centavos)}</td>
            <td class="n">${brl(p.liquidoCentavos ?? p.centavos)}</td>
          </tr>`,
        )
        .join('')
    : '<tr><td colspan="7">nenhum pagamento encontrado</td></tr>';

  const dia = d.dia ?? hojeBr();
  const resumo = d.resumoDia ?? { pagamentos: 0, diamantes: 0, centavos: 0, liquidoCentavos: 0 };

  return `<section class="adm-secao">
    <h2>Histórico de depósitos (PIX / cartão)</h2>
    <p class="adm-legenda">Filtro por dia (horário de Brasília) — abre sempre em <b>Hoje</b>. Crédito manual de diamantes ficou na aba <b>Resolver Auditoria</b>.</p>
    <p class="adm-aviso" id="adm-dia-msg" hidden></p>
    <div class="adm-blocos">
      ${bloco('bruto no dia', brl(resumo.centavos), `${rotuloDia(dia)} · ${num(resumo.pagamentos)} pagamento(s)`)}
      ${bloco('líquido no dia', brl(resumo.liquidoCentavos ?? resumo.centavos), 'após taxas dos provedores')}
      ${bloco('diamantes no dia', num(resumo.diamantes))}
    </div>
    <div class="adm-busca">
      <div class="adm-campo" style="max-width:170px">
        <label for="adm-dia-hist-dia">dia</label>
        <input id="adm-dia-hist-dia" type="date" value="${escapar(dia)}">
      </div>
      <button class="adm-botao neutro" type="button" id="adm-dia-hist-hoje">Hoje</button>
      <button class="adm-botao neutro" type="button" id="adm-dia-hist-prev" title="dia anterior">◀</button>
      <button class="adm-botao neutro" type="button" id="adm-dia-hist-prox" title="dia seguinte">▶</button>
      <div class="adm-campo">
        <label for="adm-dia-hist-nick">buscar nick</label>
        <input id="adm-dia-hist-nick" type="text" value="${escapar(d.nick ?? '')}" placeholder="NickDoJogador">
      </div>
      <button class="adm-botao neutro" id="adm-dia-hist-buscar">Buscar</button>
    </div>
    <table class="adm-tabela">
      <tr><th>quando</th><th>nick</th><th>método</th><th>provedor</th><th style="text-align:right">diamantes</th><th style="text-align:right">bruto</th><th style="text-align:right">líquido</th></tr>
      ${linhas}
    </table>
    ${paginacaoHtml({
      total: d.total ?? 0,
      offset: d.offset ?? 0,
      limite: d.limite ?? 40,
      prevId: 'adm-dia-hist-prev',
      nextId: 'adm-dia-hist-next',
      label: 'pagamentos',
    })}
  </section>`;
}

function secaoResolverAuditoria(d) {
  const opts = (d.catalogo ?? []).length
    ? (d.catalogo ?? [])
        .map((i) => `<option value="${i.id}">${escapar(i.nome)}</option>`)
        .join('')
    : '<option value="">carregando…</option>';

  const linhas = d.historico?.length
    ? d.historico
        .map(
          (h) => `<tr>
            <td>${new Date(h.em).toLocaleString('pt-BR')}</td>
            <td>${escapar(h.por)}</td>
            <td><b>${escapar(h.nick)}</b></td>
            <td>${escapar(h.itemNome)}</td>
            <td class="n">${num(h.qtd)}</td>
          </tr>`,
        )
        .join('')
    : '<tr><td colspan="5">nenhuma entrega registrada ainda</td></tr>';

  return `<section class="adm-secao">
    <h2>Resolver Auditoria</h2>
    <p class="adm-legenda">Entrega itens ou diamantes a um jogador. Use quantidade negativa para remover. Tudo fica registrado com quem entregou.</p>
    <div class="adm-colher">
      <div class="adm-linha">
        <div class="adm-campo">
          <label for="adm-res-nick">nick do jogador</label>
          <input id="adm-res-nick" type="text" maxlength="16" placeholder="Fulano">
        </div>
        <div class="adm-campo">
          <label for="adm-res-item">item</label>
          <select id="adm-res-item">${opts}</select>
        </div>
        <div class="adm-campo" style="max-width:160px">
          <label for="adm-res-qtd">quantidade</label>
          <input id="adm-res-qtd" type="number" step="1" value="1">
        </div>
        <button class="adm-botao" id="adm-res-enviar">Entregar</button>
      </div>
      <p class="adm-aviso" id="adm-res-msg">Se estiver online, o inventário ou saldo atualiza na hora.</p>
    </div>
  </section>
  <section class="adm-secao">
    <h2>Histórico de entregas</h2>
    <table class="adm-tabela">
      <tr><th>quando</th><th>admin</th><th>jogador</th><th>item</th><th style="text-align:right">qtd</th></tr>
      ${linhas}
    </table>
  </section>`;
}

function ligarResolverAuditoria() {
  const msg = $('#adm-res-msg');
  const botao = $('#adm-res-enviar');
  if (!botao) return;

  let confirmando = false;
  botao.onclick = async () => {
    const nick = $('#adm-res-nick').value.trim();
    const itemId = Number($('#adm-res-item').value);
    const qtd = Number($('#adm-res-qtd').value);
    const itemNome = $('#adm-res-item').selectedOptions[0]?.textContent ?? 'item';

    if (!nick) {
      msg.className = 'adm-aviso ruim';
      msg.textContent = 'digite o nick do jogador';
      return;
    }
    if (!Number.isFinite(itemId)) {
      msg.className = 'adm-aviso ruim';
      msg.textContent = 'escolha um item';
      return;
    }
    if (!Number.isInteger(qtd) || qtd === 0) {
      msg.className = 'adm-aviso ruim';
      msg.textContent = 'quantidade tem de ser um inteiro diferente de zero (ex.: 10 ou -10)';
      return;
    }
    if (!confirmando) {
      confirmando = true;
      botao.textContent = qtd > 0 ? 'Confirmar entrega' : 'Confirmar remoção';
      botao.classList.add('confirmar');
      msg.className = 'adm-aviso ruim';
      msg.textContent = qtd > 0
        ? `Entregar ${num(qtd)}× ${itemNome} para ${nick}? Clique de novo para confirmar.`
        : `Remover ${num(Math.abs(qtd))}× ${itemNome} de ${nick}? Clique de novo para confirmar.`;
      setTimeout(() => {
        if (!confirmando) return;
        confirmando = false;
        botao.textContent = 'Entregar';
        botao.classList.remove('confirmar');
      }, 30_000);
      return;
    }

    botao.disabled = true;
    botao.textContent = 'enviando…';
    try {
      const r = await pedir('resolver-auditoria/entregar', { nick, itemId, qtd });
      msg.className = 'adm-aviso bom';
      const extra = r.saldoApos != null ? ` Saldo de diamantes: ${num(r.saldoApos)}.` : '';
      msg.textContent = `${num(r.qtd)}× ${r.itemNome} ${r.qtd > 0 ? 'entregue(s) a' : 'removido(s) de'} ${r.nick}.${extra}`;
      confirmando = false;
      botao.textContent = 'Entregar';
      botao.classList.remove('confirmar');
      await carregarResolverAuditoria();
      renderSecao();
    } catch (err) {
      msg.className = 'adm-aviso ruim';
      msg.textContent = err.message;
      confirmando = false;
      botao.textContent = 'Entregar';
      botao.classList.remove('confirmar');
    } finally {
      botao.disabled = false;
    }
  };
}

function secaoAprovacaoSaquesGemas(d) {
  const linhas = d.saques?.length
    ? d.saques
        .map(
          (s) => `<tr>
            <td>${new Date(s.criadoEm).toLocaleString('pt-BR')}</td>
            <td><b>${escapar(s.nick)}</b></td>
            <td class="n">${num(s.orbs)}</td>
            <td class="n">${usdt(s.usdt)}</td>
            <td>${escapar(s.rede)}</td>
            <td><code>${escapar(s.endereco)}</code></td>
            <td class="adm-acoes">
              <button class="adm-botao-mini adm-ok" data-aprovar-saque="${escapar(s.id)}">Aprovar</button>
              <button class="adm-botao-mini perigo" data-rejeitar-saque="${escapar(s.id)}">Recusar</button>
            </td>
          </tr>`,
        )
        .join('')
    : '<tr><td colspan="7">nenhum saque aguardando aprovação</td></tr>';

  return `<section class="adm-secao">
    <h2>Aprovação saque gemas</h2>
    <p class="adm-legenda">Segunda camada de segurança no beta: todo pedido de saque fica aqui até aprovar. Ao recusar, as gemas voltam para o jogador.</p>
    <table class="adm-tabela">
      <tr><th>quando</th><th>nick</th><th style="text-align:right">gemas</th><th style="text-align:right">USDT</th><th>rede</th><th>carteira</th><th></th></tr>
      ${linhas}
    </table>
    ${paginacaoHtml({
      total: d.total ?? 0,
      offset: d.offset ?? 0,
      limite: d.limite ?? 40,
      prevId: 'adm-saq-ap-prev',
      nextId: 'adm-saq-ap-next',
      label: 'pendentes',
    })}
    <p class="adm-aviso" id="adm-saq-ap-msg"></p>
  </section>`;
}

function secaoHistoricoGemas(d) {
  const aba = d.aba ?? 'depositos';
  const dep = aba === 'depositos';
  const linhasDep = d.depositos?.length
    ? d.depositos
        .map(
          (r) => `<tr>
            <td>${new Date(r.em).toLocaleString('pt-BR')}</td>
            <td><b>${escapar(r.nick)}</b></td>
            <td>${escapar(r.rede)}</td>
            <td class="n">${num(r.orbs)}</td>
            <td class="n">${usdt(r.usdt)}</td>
            <td><code title="${escapar(r.txHash)}">${escapar((r.txHash ?? '').slice(0, 12))}…</code></td>
          </tr>`,
        )
        .join('')
    : '<tr><td colspan="6">nenhum depósito encontrado</td></tr>';

  const linhasSaq = d.saques?.length
    ? d.saques
        .map(
          (s) => `<tr>
            <td>${new Date(s.criadoEm).toLocaleString('pt-BR')}</td>
            <td><b>${escapar(s.nick)}</b></td>
            <td><span class="adm-badge adm-badge-gema">${escapar(ROTULO_STATUS_SAQUE[s.status] ?? s.status)}</span></td>
            <td class="n">${num(s.orbs)}</td>
            <td class="n">${usdt(s.usdt)}</td>
            <td>${escapar(s.rede)}</td>
            <td><code title="${escapar(s.endereco)}">${escapar(s.endereco.slice(0, 10))}…</code></td>
          </tr>`,
        )
        .join('')
    : '<tr><td colspan="7">nenhum saque encontrado</td></tr>';

  return `<section class="adm-secao">
    <h2>Histórico gemas</h2>
    <p class="adm-legenda">Depósitos (USDT → gemas) e saques (gemas → USDT) — separado do histórico de diamantes.</p>
    <div class="adm-abas">
      <button type="button" class="adm-nav-btn${dep ? ' ativo' : ''}" data-gem-aba="depositos">Depósitos</button>
      <button type="button" class="adm-nav-btn${!dep ? ' ativo' : ''}" data-gem-aba="saques">Saques</button>
    </div>
    <div class="adm-busca" style="margin-top:12px">
      <div class="adm-campo">
        <label for="adm-gem-hist-nick">buscar nick</label>
        <input id="adm-gem-hist-nick" type="text" value="${escapar(d.nick ?? '')}" placeholder="NickDoJogador">
      </div>
      <button class="adm-botao neutro" id="adm-gem-hist-buscar">Buscar</button>
    </div>
    ${
      dep
        ? `<table class="adm-tabela">
      <tr><th>quando</th><th>nick</th><th>rede</th><th style="text-align:right">gemas</th><th style="text-align:right">USDT</th><th>tx</th></tr>
      ${linhasDep}
    </table>
    ${paginacaoHtml({
      total: d.totalDep ?? 0,
      offset: d.offsetDep ?? 0,
      limite: d.limite ?? 40,
      prevId: 'adm-gem-dep-prev',
      nextId: 'adm-gem-dep-next',
      label: 'depósitos',
    })}`
        : `<table class="adm-tabela">
      <tr><th>quando</th><th>nick</th><th>status</th><th style="text-align:right">gemas</th><th style="text-align:right">USDT</th><th>rede</th><th>carteira</th></tr>
      ${linhasSaq}
    </table>
    ${paginacaoHtml({
      total: d.totalSaq ?? 0,
      offset: d.offsetSaq ?? 0,
      limite: d.limite ?? 40,
      prevId: 'adm-gem-saq-prev',
      nextId: 'adm-gem-saq-next',
      label: 'saques',
    })}`
    }
  </section>`;
}

// ---------------------------------------------------------------- eventos
//
// O buff global: três porcentagens e um prazo, valendo para todo jogador conectado. A tela é
// deliberadamente seca — quem liga isso está mexendo na economia inteira do servidor, e o que
// ela precisa deixar claro é o que está valendo AGORA e quando acaba, não enfeite.

/** Teto de cada buff — espelha `EVENTO_PCT_MAX` em `server/game/eventos.mjs`. */
const EVENTO_PCT_MAX = 50_000;

/** "faltam 1h 12min" — o tempo que resta de um evento, do jeito que se lê em voz alta. */
function restanteDoEvento(terminaEm) {
  const ms = (Number(terminaEm) || 0) - Date.now();
  if (ms <= 0) return 'encerrado';
  const min = Math.ceil(ms / 60000);
  if (min < 60) return `faltam ${min} min`;
  const h = Math.floor(min / 60);
  return `faltam ${h}h ${min % 60}min`;
}

function secaoEventos(d) {
  const v = d.vigente;
  const vigente = v
    ? `<div class="adm-blocos">
        ${bloco('XP treinador', `+${num(v.xpTreinadorPct)}%`)}
        ${bloco('XP pokémon', `+${num(v.xpPokemonPct)}%`)}
        ${bloco('Farm', `+${num(v.farmPct)}%`)}
        ${bloco('Duração', `${num(v.minutos)} min`, restanteDoEvento(v.terminaEm))}
      </div>
      <div class="adm-linha" style="margin-top:10px">
        <button class="adm-botao perigo" id="adm-evt-encerrar">Encerrar agora</button>
        <span class="adm-legenda">Termina ${new Date(v.terminaEm).toLocaleString('pt-BR')} · ligado por ${escapar(v.criadoPor ?? '—')}</span>
      </div>`
    : `<p class="adm-aviso">Nenhum evento em andamento. Os jogadores estão com os multiplicadores normais.</p>`;

  const historico = d.historico?.length
    ? d.historico
        .map(
          (e) => `<tr>
            <td>${new Date(e.criadoEm).toLocaleString('pt-BR')}</td>
            <td class="n">+${num(e.xpTreinadorPct)}%</td>
            <td class="n">+${num(e.xpPokemonPct)}%</td>
            <td class="n">+${num(e.farmPct)}%</td>
            <td class="n">${num(e.minutos)} min</td>
            <td>${new Date(e.terminaEm).toLocaleString('pt-BR')}</td>
            <td>${escapar(e.criadoPor ?? '—')}${e.encerradoPor ? ` · cortado por ${escapar(e.encerradoPor)}` : ''}</td>
          </tr>`,
        )
        .join('')
    : '<tr><td colspan="7">nenhum evento ainda</td></tr>';

  return `<section class="adm-secao">
    <h2>Eventos</h2>
    <p class="adm-legenda">
      O buff vale para <b>todos os jogadores</b> ao mesmo tempo e entra <b>na hora</b> — quem está
      online vê a faixa piscando no topo da batalha. XP se multiplica em cima do que o jogador já
      tem (boost e VIP continuam contando); farm soma aos bônus de guild e ranking.
    </p>
    ${vigente}

    <div class="adm-colher" style="margin-top:14px">
      <div class="adm-linha">
        <div class="adm-campo" style="max-width:180px">
          <label for="adm-evt-xp-treinador">BUFF XP Treinador (%)</label>
          <input id="adm-evt-xp-treinador" type="number" step="1" min="0" max="${EVENTO_PCT_MAX}" value="0">
        </div>
        <div class="adm-campo" style="max-width:180px">
          <label for="adm-evt-xp-pokemon">BUFF XP Pokémon (%)</label>
          <input id="adm-evt-xp-pokemon" type="number" step="1" min="0" max="${EVENTO_PCT_MAX}" value="0">
        </div>
        <div class="adm-campo" style="max-width:180px">
          <label for="adm-evt-farm">BUFF Farm (%)</label>
          <input id="adm-evt-farm" type="number" step="1" min="0" max="${EVENTO_PCT_MAX}" value="0">
        </div>
        <div class="adm-campo" style="max-width:160px">
          <label for="adm-evt-minutos">Minutos</label>
          <input id="adm-evt-minutos" type="number" step="1" min="1" max="10080" value="60">
        </div>
        <button class="adm-botao" id="adm-evt-criar">Ligar evento</button>
      </div>
      <p class="adm-aviso" id="adm-evt-msg">
        Ligar um evento novo <b>substitui</b> o que estiver em andamento. Máximo ${num(EVENTO_PCT_MAX)}% por buff e 7 dias de duração.
      </p>
    </div>

    ${blocoAgendaEventos(d.agenda)}

    <h2 style="margin-top:18px">Histórico</h2>
    <table class="adm-tabela">
      <tr><th>quando</th><th style="text-align:right">XP treinador</th><th style="text-align:right">XP pokémon</th>
          <th style="text-align:right">farm</th><th style="text-align:right">duração</th><th>termina</th><th>por</th></tr>
      ${historico}
    </table>
  </section>`;
}

// ---- a agenda: os eventos que se repetem toda semana sem ninguém clicar
//
// A ordem dos dias é a do `dow` do Postgres (0 = domingo), e não a da semana brasileira, de
// propósito: é o mesmo número que vai para o banco e volta dele. Traduzir só na hora de
// escrever a etiqueta é um lugar a menos para errar em silêncio.

const DIAS_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

const horaDaAgenda = (r) => `${String(r.hora).padStart(2, '0')}:${String(r.minuto).padStart(2, '0')}`;

/** "12h de sexta" em português de gente, com o fuso dito por extenso uma vez só na legenda. */
const diasDaAgenda = (dias) => (dias.length === 7
  ? 'todo dia'
  : dias.map((d) => DIAS_SEMANA[d] ?? '?').join(', '));

const duracaoDaAgenda = (min) => {
  if (min < 60) return `${num(min)} min`;
  const h = Math.floor(min / 60);
  const resto = min % 60;
  return `${num(h)}h${resto ? ` ${resto}min` : ''} (${num(min)} min)`;
};

function blocoAgendaEventos(agenda) {
  const linhas = agenda?.length
    ? agenda.map((r) => `<tr${r.ativa ? '' : ' class="adm-agenda-off"'}>
        <td><b>${escapar(diasDaAgenda(r.dias))}</b></td>
        <td>${horaDaAgenda(r)}</td>
        <td class="n">+${num(r.xpTreinadorPct)}%</td>
        <td class="n">+${num(r.xpPokemonPct)}%</td>
        <td class="n">+${num(r.farmPct)}%</td>
        <td class="n">${escapar(duracaoDaAgenda(r.minutos))}</td>
        <td>${r.ativa
          ? (r.proximoEm ? new Date(r.proximoEm).toLocaleString('pt-BR') : '—')
          : '<span class="adm-badge adm-badge-off">pausada</span>'}</td>
        <td>${r.ultimoEm ? new Date(r.ultimoEm).toLocaleString('pt-BR') : 'nunca'}</td>
        <td>
          <button class="adm-botao-mini" data-agenda-alternar="${r.id}" data-ativa="${r.ativa ? '' : '1'}">${r.ativa ? 'Pausar' : 'Retomar'}</button>
          <button class="adm-botao-mini perigo" data-agenda-remover="${r.id}">Apagar</button>
        </td>
      </tr>`).join('')
    : '<tr><td colspan="9">nenhum evento agendado — o jogo só terá evento quando alguém ligar na mão</td></tr>';

  const dias = DIAS_SEMANA
    .map((d, i) => `<button type="button" class="adm-dia" data-dia="${i}" aria-pressed="false">${d}</button>`)
    .join('');

  return `<h2 style="margin-top:22px">Eventos automáticos</h2>
    <p class="adm-legenda">
      A regra que se repete <b>toda semana</b>: escolha os dias, a hora e os bônus, e o evento
      entra sozinho. A hora é a de <b>Brasília</b> (a mesma do resto do painel), e a duração
      conta a partir do disparo. Quando um evento agendado entra, ele <b>substitui</b> o que
      estiver no ar — é a mesma regra do botão acima, e é o que garante que o evento anunciado
      à comunidade não falte. Se o servidor estiver fora no horário marcado, o evento ainda
      entra em até 30 minutos de atraso; passou disso, aquela semana é pulada.
    </p>
    <table class="adm-tabela">
      <tr><th>dias</th><th>hora</th><th style="text-align:right">XP treinador</th><th style="text-align:right">XP pokémon</th>
          <th style="text-align:right">farm</th><th style="text-align:right">duração</th><th>próximo</th><th>último</th><th>ações</th></tr>
      ${linhas}
    </table>

    <div class="adm-colher" style="margin-top:12px">
      <div class="adm-campo" style="max-width:none">
        <label>dias da semana</label>
        <div class="adm-dias" id="adm-agd-dias">${dias}</div>
      </div>
      <div class="adm-linha">
        <div class="adm-campo" style="max-width:140px">
          <label for="adm-agd-hora">começa às</label>
          <input id="adm-agd-hora" type="time" value="12:00" step="60">
        </div>
        <div class="adm-campo" style="max-width:180px">
          <label for="adm-agd-xp-treinador">BUFF XP Treinador (%)</label>
          <input id="adm-agd-xp-treinador" type="number" step="1" min="0" max="${EVENTO_PCT_MAX}" value="0">
        </div>
        <div class="adm-campo" style="max-width:180px">
          <label for="adm-agd-xp-pokemon">BUFF XP Pokémon (%)</label>
          <input id="adm-agd-xp-pokemon" type="number" step="1" min="0" max="${EVENTO_PCT_MAX}" value="0">
        </div>
        <div class="adm-campo" style="max-width:180px">
          <label for="adm-agd-farm">BUFF Farm (%)</label>
          <input id="adm-agd-farm" type="number" step="1" min="0" max="${EVENTO_PCT_MAX}" value="0">
        </div>
        <div class="adm-campo" style="max-width:160px">
          <label for="adm-agd-minutos">Duração (minutos)</label>
          <input id="adm-agd-minutos" type="number" step="1" min="1" max="10080" value="720">
        </div>
        <button class="adm-botao" id="adm-agd-criar">Agendar</button>
      </div>
      <p class="adm-aviso" id="adm-agd-msg">
        Exemplo: <b>sex</b> às <b>12:00</b>, 15 / 15 / 5, duração 720 min — toda sexta ao meio-dia,
        12 horas de evento.
      </p>
    </div>`;
}

function ligarEventos() {
  const msg = $('#adm-evt-msg');
  const botao = $('#adm-evt-criar');
  let confirmando = false;

  // `renderSecao` já vai buscar o estado novo — recarregar aqui de novo seria pedir duas vezes.
  const recarregar = () => renderSecao();

  if (botao) {
    botao.onclick = async () => {
      const xpTreinadorPct = Number($('#adm-evt-xp-treinador').value) || 0;
      const xpPokemonPct = Number($('#adm-evt-xp-pokemon').value) || 0;
      const farmPct = Number($('#adm-evt-farm').value) || 0;
      const minutos = Number($('#adm-evt-minutos').value) || 0;
      if (!xpTreinadorPct && !xpPokemonPct && !farmPct) {
        msg.className = 'adm-aviso ruim';
        msg.textContent = 'informe pelo menos um bônus maior que zero';
        return;
      }
      if (!(minutos > 0)) {
        msg.className = 'adm-aviso ruim';
        msg.textContent = 'a duração tem de ser maior que zero';
        return;
      }
      // Dois cliques, como o crédito de diamantes: isto alcança TODOS os jogadores de uma vez
      // e não há como desfazer o que já foi ganho durante um evento aberto por engano.
      if (!confirmando) {
        confirmando = true;
        botao.textContent = 'Confirmar';
        botao.classList.add('confirmar');
        msg.className = 'adm-aviso ruim';
        msg.textContent =
          `Ligar para TODOS: treinador +${xpTreinadorPct}%, pokémon +${xpPokemonPct}%, ` +
          `farm +${farmPct}%, por ${minutos} min. Clique de novo para confirmar.`;
        setTimeout(() => {
          if (!confirmando) return;
          confirmando = false;
          botao.textContent = 'Ligar evento';
          botao.classList.remove('confirmar');
        }, 30_000);
        return;
      }
      botao.disabled = true;
      try {
        await pedir('eventos/criar', { xpTreinadorPct, xpPokemonPct, farmPct, minutos });
        confirmando = false;
        await recarregar();
      } catch (err) {
        msg.className = 'adm-aviso ruim';
        msg.textContent = err.message;
        confirmando = false;
        botao.textContent = 'Ligar evento';
        botao.classList.remove('confirmar');
        botao.disabled = false;
      }
    };
  }

  // ---- agenda semanal
  const msgAgd = $('#adm-agd-msg');
  const diasEscolhidos = () => [...document.querySelectorAll('#adm-agd-dias .adm-dia')]
    .filter((b) => b.getAttribute('aria-pressed') === 'true')
    .map((b) => Number(b.dataset.dia));

  for (const btn of document.querySelectorAll('#adm-agd-dias .adm-dia')) {
    btn.addEventListener('click', () => {
      const ligado = btn.getAttribute('aria-pressed') === 'true';
      btn.setAttribute('aria-pressed', ligado ? 'false' : 'true');
    });
  }

  const botaoAgd = $('#adm-agd-criar');
  if (botaoAgd) {
    botaoAgd.onclick = async () => {
      const dias = diasEscolhidos();
      const [hora, minuto] = String($('#adm-agd-hora').value || '').split(':').map(Number);
      const xpTreinadorPct = Number($('#adm-agd-xp-treinador').value) || 0;
      const xpPokemonPct = Number($('#adm-agd-xp-pokemon').value) || 0;
      const farmPct = Number($('#adm-agd-farm').value) || 0;
      const minutos = Number($('#adm-agd-minutos').value) || 0;
      const recusar = (texto) => {
        msgAgd.className = 'adm-aviso ruim';
        msgAgd.textContent = texto;
      };
      if (!dias.length) return recusar('escolha pelo menos um dia da semana');
      if (!Number.isInteger(hora)) return recusar('informe a hora de início');
      if (!xpTreinadorPct && !xpPokemonPct && !farmPct) return recusar('informe pelo menos um bônus maior que zero');
      if (!(minutos > 0)) return recusar('a duração tem de ser maior que zero');
      // Sem o passo de confirmar do botão de cima: agendar não liga nada agora, e a regra
      // aparece na tabela com um "Apagar" ao lado antes de valer qualquer coisa.
      botaoAgd.disabled = true;
      try {
        await pedir('eventos/agenda/criar', {
          dias, hora, minuto: minuto || 0, xpTreinadorPct, xpPokemonPct, farmPct, minutos,
        });
        await recarregar();
      } catch (err) {
        recusar(err.message);
        botaoAgd.disabled = false;
      }
    };
  }

  for (const btn of document.querySelectorAll('[data-agenda-alternar]')) {
    btn.addEventListener('click', async () => {
      try {
        await pedir('eventos/agenda/alternar', {
          id: Number(btn.dataset.agendaAlternar),
          ativa: !!btn.dataset.ativa,
        });
        await recarregar();
      } catch (err) {
        msgAgd.className = 'adm-aviso ruim';
        msgAgd.textContent = err.message;
      }
    });
  }

  for (const btn of document.querySelectorAll('[data-agenda-remover]')) {
    btn.addEventListener('click', async () => {
      if (!confirm('Apagar esta regra? Os eventos que ela já ligou continuam no histórico.')) return;
      try {
        await pedir('eventos/agenda/remover', { id: Number(btn.dataset.agendaRemover) });
        await recarregar();
      } catch (err) {
        msgAgd.className = 'adm-aviso ruim';
        msgAgd.textContent = err.message;
      }
    });
  }

  $('#adm-evt-encerrar')?.addEventListener('click', async () => {
    if (!confirm('Encerrar o evento agora? Os multiplicadores voltam ao normal na hora.')) return;
    try {
      await pedir('eventos/encerrar');
      await recarregar();
    } catch (err) {
      msg.className = 'adm-aviso ruim';
      msg.textContent = err.message;
    }
  });
}

// ---------------------------------------------------------------- contagem online
//
// Acréscimos manuais no número "X online" que os jogadores veem. Cada valor vira um card
// removível; a soma de todos alimenta o `/saude` até serem apagados.

function quandoContagem(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleString('pt-BR', { timeZone: FUSO_BR });
}

function secaoContagemOnline(d) {
  const real = d.onlineReal >= 0 ? num(d.onlineReal) : '–';
  const exibido = d.onlineExibido >= 0 ? num(d.onlineExibido) : '–';
  const cards = d.extras?.length
    ? d.extras
        .map(
          (e) => `
        <div class="adm-oc-card">
          <b>+${num(e.qtd)}</b>
          <span>${escapar(quandoContagem(e.criadoEm))}${e.criadoPor ? ` · ${escapar(e.criadoPor)}` : ''}</span>
          <button type="button" class="adm-botao-mini perigo" data-remover-oc="${e.id}">Remover</button>
        </div>`,
        )
        .join('')
    : '<p class="adm-legenda">Nenhum acréscimo ativo — os jogadores veem só a contagem real.</p>';

  return `<section class="adm-secao">
    <h2>Adicionar contagem de jogadores</h2>
    <p class="adm-legenda">
      Soma valores ao número de <b>online</b> que aparece no canto da tela de todos os jogadores.
      Cada incremento fica listado abaixo e pode ser removido separadamente.
    </p>
    <div class="adm-blocos">
      ${bloco('Online real', real, 'presença no Redis')}
      ${bloco('Acréscimo total', `+${num(d.totalExtra ?? 0)}`, `${num(d.extras?.length ?? 0)} incremento(s)`)}
      ${bloco('Exibido aos jogadores', exibido, 'real + acréscimos', 'sobra')}
    </div>

    <div class="adm-colher" style="margin-top:14px">
      <div class="adm-linha">
        <div class="adm-campo" style="max-width:180px">
          <label for="adm-oc-qtd">Adicionar (+)</label>
          <input id="adm-oc-qtd" type="number" step="1" min="1" value="50">
        </div>
        <button class="adm-botao" id="adm-oc-adicionar">Adicionar</button>
      </div>
      <p class="adm-aviso" id="adm-oc-msg">Cada clique soma mais um card — remova um de cada vez quando não precisar.</p>
    </div>

    <div class="adm-linha adm-oc-topo">
      <h2>Incrementos ativos</h2>
      ${d.extras?.length
        ? `<button type="button" class="adm-botao perigo" id="adm-oc-remover-tudo">Remover tudo</button>`
        : ''}
    </div>
    <div class="adm-oc-cards">${cards}</div>
  </section>`;
}

function ligarContagemOnline() {
  const msg = $('#adm-oc-msg');
  $('#adm-oc-adicionar')?.addEventListener('click', async () => {
    const qtd = Number($('#adm-oc-qtd').value);
    if (!(qtd > 0) || !Number.isInteger(qtd)) {
      msg.className = 'adm-aviso ruim';
      msg.textContent = 'informe um inteiro maior que zero';
      return;
    }
    const botao = $('#adm-oc-adicionar');
    botao.disabled = true;
    try {
      await pedir('online-contagem/adicionar', { qtd });
      await renderSecao();
    } catch (err) {
      msg.className = 'adm-aviso ruim';
      msg.textContent = err.message;
      botao.disabled = false;
    }
  });

  document.querySelectorAll('[data-remover-oc]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = Number(btn.dataset.removerOc);
      const qtd = btn.closest('.adm-oc-card')?.querySelector('b')?.textContent ?? '';
      if (!confirm(`Remover o incremento ${qtd}?`)) return;
      btn.disabled = true;
      try {
        await pedir('online-contagem/remover', { id });
        await renderSecao();
      } catch (err) {
        msg.className = 'adm-aviso ruim';
        msg.textContent = err.message;
        btn.disabled = false;
      }
    });
  });

  $('#adm-oc-remover-tudo')?.addEventListener('click', async () => {
    const n = contagemOnlineCache.extras?.length ?? 0;
    const total = contagemOnlineCache.totalExtra ?? 0;
    if (!n) return;
    if (!confirm(`Remover todos os ${num(n)} incrementos (+${num(total)} no total)?`)) return;
    const botao = $('#adm-oc-remover-tudo');
    botao.disabled = true;
    try {
      await pedir('online-contagem/remover-tudo');
      await renderSecao();
    } catch (err) {
      msg.className = 'adm-aviso ruim';
      msg.textContent = err.message;
      botao.disabled = false;
    }
  });
}

function ligarDiamantes() {
  const msg = $('#adm-dia-msg');
  if (msg) msg.hidden = false;

  const recarregarHist = async (off = diamantesHistCache.offset) => {
    const nick = $('#adm-dia-hist-nick')?.value?.trim() ?? diamantesHistCache.nick;
    const dia = $('#adm-dia-hist-dia')?.value || diamantesHistCache.dia || hojeBr();
    const limite = diamantesHistCache.limite ?? 40;
    const dados = await pedir('diamantes/historico', { nick, dia, offset: off, limite });
    diamantesHistCache = { ...dados, nick, dia, offset: off, limite };
    return diamantesHistCache;
  };

  const irParaDia = async (dia, off = 0) => {
    const inp = $('#adm-dia-hist-dia');
    if (inp) inp.value = dia;
    try {
      await recarregarHist(off);
      renderSecao();
    } catch (err) {
      if (msg) {
        msg.className = 'adm-aviso ruim';
        msg.textContent = err.message;
      }
    }
  };

  $('#adm-dia-hist-hoje')?.addEventListener('click', () => irParaDia(hojeBr(), 0));
  $('#adm-dia-hist-prev')?.addEventListener('click', () => {
    const dia = $('#adm-dia-hist-dia')?.value || diamantesHistCache.dia || hojeBr();
    irParaDia(ajustarDia(dia, -1), 0);
  });
  $('#adm-dia-hist-prox')?.addEventListener('click', () => {
    const dia = $('#adm-dia-hist-dia')?.value || diamantesHistCache.dia || hojeBr();
    irParaDia(ajustarDia(dia, 1), 0);
  });
  $('#adm-dia-hist-dia')?.addEventListener('change', () => {
    const dia = $('#adm-dia-hist-dia')?.value;
    if (dia) irParaDia(dia, 0);
  });

  $('#adm-dia-hist-buscar')?.addEventListener('click', async () => {
    try {
      await recarregarHist(0);
      renderSecao();
    } catch (err) {
      if (msg) {
        msg.className = 'adm-aviso ruim';
        msg.textContent = err.message;
      }
    }
  });
  $('#adm-dia-hist-nick')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('#adm-dia-hist-buscar')?.click();
  });
  $('#adm-dia-hist-prev')?.addEventListener('click', async () => {
    try {
      await recarregarHist(Math.max(0, diamantesHistCache.offset - diamantesHistCache.limite));
      renderSecao();
    } catch (err) {
      if (msg) {
        msg.className = 'adm-aviso ruim';
        msg.textContent = err.message;
      }
    }
  });
  $('#adm-dia-hist-next')?.addEventListener('click', async () => {
    try {
      await recarregarHist(diamantesHistCache.offset + diamantesHistCache.limite);
      renderSecao();
    } catch (err) {
      if (msg) {
        msg.className = 'adm-aviso ruim';
        msg.textContent = err.message;
      }
    }
  });
}

// ---------------------------------------------------------- emissão de notas
//
// Aba que empacota as compras confirmadas da Efí para importar na contabilidade. O servidor
// (`admin.emissaoNotas` / `admin.exportarNotas`) é quem decide o que entra — aqui só desenha a
// lista de meses e dispara o download do arquivo.

const MES_NOME = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];
const rotuloMes = (m) => {
  const [y, mm] = String(m ?? '').split('-').map(Number);
  return y && mm ? `${MES_NOME[mm - 1]}/${y}` : String(m ?? '');
};
const dataBrCurta = (d) => new Date(d).toLocaleDateString('pt-BR', { timeZone: FUSO_BR });

/** Blob + clique num <a> temporário — a rota devolve o texto do arquivo, não um stream. */
function baixarArquivo(nome, mime, conteudo) {
  const blob = new Blob([conteudo], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function secaoNotas(d) {
  const linhasMes = d.meses?.length
    ? d.meses
        .map(
          (m) => `<tr class="${m.mes === d.mes ? 'adm-pl-destaque' : ''}">
            <td><b>${escapar(rotuloMes(m.mes))}</b></td>
            <td class="n">${num(m.pagamentos)}<br><span class="adm-pl-extra">${num(m.efi)} Efí · ${num(m.stripe)} Stripe</span></td>
            <td class="n">${brl(m.brutoCentavos)}</td>
            <td class="n">${brl(m.liquidoCentavos)}</td>
            <td class="n">${num(m.comCpf)}/${num(m.pagamentos)}</td>
            <td class="adm-acoes">
              <button class="adm-botao-mini" data-ver-mes="${escapar(m.mes)}">Ver</button>
              <button class="adm-botao-mini" data-baixar-mes="${escapar(m.mes)}" data-fmt="csv">Baixar CSV</button>
              <button class="adm-botao-mini" data-baixar-mes="${escapar(m.mes)}" data-fmt="xml">XML</button>
            </td>
          </tr>`,
        )
        .join('')
    : '<tr><td colspan="6">nenhuma compra confirmada da Efí/Stripe ainda</td></tr>';

  const r = d.resumo;
  const preview = d.mes && d.notas
    ? `<h2 style="margin-top:20px">${escapar(rotuloMes(d.mes))} — ${num(r.pagamentos)} nota(s)</h2>
      <p class="adm-legenda">
        ${num(r.efi)} Efí · ${num(r.stripe)} Stripe · bruto ${brl(r.brutoCentavos)} · taxa ${brl(r.taxaCentavos)}
        · <b>líquido ${brl(r.liquidoCentavos)}</b> · com CPF ${num(r.comCpf)}/${num(r.pagamentos)}.
        O arquivo usa o <b>valor líquido</b> como valor da nota.
      </p>
      <table class="adm-tabela">
        <tr><th>data</th><th>provedor</th><th>tomador</th><th>e-mail</th><th>CPF</th>
            <th style="text-align:right">qtd</th><th style="text-align:right">bruto</th>
            <th style="text-align:right">líquido</th><th>descrição</th></tr>
        ${d.notas
          .map(
            (n) => `<tr>
              <td>${dataBrCurta(n.em)}</td>
              <td>${escapar(n.provedor)}</td>
              <td>${escapar(n.tomadorNome || '—')}</td>
              <td>${escapar(n.tomadorEmail || '—')}</td>
              <td>${escapar(n.tomadorCpf || '—')}</td>
              <td class="n">${num(n.qtd)}</td>
              <td class="n">${brl(n.brutoCentavos)}</td>
              <td class="n">${brl(n.liquidoCentavos)}</td>
              <td>${escapar(n.descricao)}</td>
            </tr>`,
          )
          .join('')}
      </table>`
    : '';

  const marco = d.marco
    ? `Contando a partir de <b>${new Date(d.marco).toLocaleString('pt-BR', { timeZone: FUSO_BR })}</b> — 1º pagamento pela Efí. Stripe anterior a essa data era pessoa física e não entra.`
    : 'Nenhum pagamento pela Efí ainda — sem marco, nada é exportado.';

  return `<section class="adm-secao">
    <h2>Emissão de Notas</h2>
    <p class="adm-legenda" style="margin-bottom:14px">
      Empacota as compras confirmadas para lançar como NFS-e na contabilidade
      (Contabilizei → <b>Importar notas fiscais</b>, XML ou CSV) — um arquivo por mês.<br>
      ${marco}<br>
      <b>Efí + Stripe</b> entram (a Stripe só a partir do marco); LivePix nunca entra.<br>
      As compras antigas vão <b>sem CPF</b> (não era coletado); as novas já levam o CPF digitado no checkout.<br>
      O <b>valor</b> de cada nota é o <b>líquido</b> recebido (bruto − taxa do provedor); bruto e taxa vão no arquivo para conferência.
    </p>
    <table class="adm-tabela">
      <tr><th>competência</th><th style="text-align:right">pagamentos</th>
          <th style="text-align:right">bruto</th><th style="text-align:right">líquido</th>
          <th style="text-align:right">com CPF</th><th></th></tr>
      ${linhasMes}
    </table>
    ${preview}
    <p class="adm-aviso" id="adm-notas-msg"></p>
  </section>`;
}

function ligarNotas() {
  const msg = $('#adm-notas-msg');
  const erro = (e) => {
    if (!msg) return;
    msg.className = 'adm-aviso ruim';
    msg.textContent = e.message ?? String(e);
  };

  for (const btn of document.querySelectorAll('[data-ver-mes]')) {
    btn.addEventListener('click', async () => {
      try {
        notasCache = await pedir('notas/listar', { mes: btn.dataset.verMes });
        renderSecao();
      } catch (e) {
        erro(e);
      }
    });
  }

  for (const btn of document.querySelectorAll('[data-baixar-mes]')) {
    btn.addEventListener('click', async () => {
      const mes = btn.dataset.baixarMes;
      const formato = btn.dataset.fmt || 'csv';
      btn.disabled = true;
      try {
        const arq = await pedir('notas/exportar', { mes, formato });
        baixarArquivo(arq.arquivo, arq.mime, arq.conteudo);
        if (msg) {
          msg.className = 'adm-aviso bom';
          msg.textContent = `${arq.arquivo} baixado — importe em Contabilizei › Importar notas fiscais.`;
        }
      } catch (e) {
        erro(e);
      } finally {
        btn.disabled = false;
      }
    });
  }
}

function ligarCargos() {
  const msg = $('#adm-cargo-msg');
  const salvar = async () => {
    const nick = $('#adm-cargo-nick').value.trim();
    const cargo = $('#adm-cargo-tipo').value;
    if (!nick) {
      msg.className = 'adm-aviso ruim';
      msg.textContent = 'digite o nick do jogador';
      return;
    }
    try {
      await pedir('cargos/definir', { nick, cargo });
      msg.className = 'adm-aviso bom';
      msg.textContent = `Tag ${ROTULO_CARGO[cargo]} atribuída a ${nick}. Reconectar para aparecer no chat.`;
      dadosPainel = await pedir('painel');
      setTimeout(renderSecao, 400);
    } catch (err) {
      msg.className = 'adm-aviso ruim';
      msg.textContent = err.message;
    }
  };

  $('#adm-cargo-salvar')?.addEventListener('click', salvar);
  $('#adm-cargo-nick')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') salvar();
  });

  for (const btn of document.querySelectorAll('.adm-botao-mini[data-nick]')) {
    btn.addEventListener('click', async () => {
      const nick = btn.dataset.nick;
      if (!nick || !confirm(`Remover a tag de ${nick}?`)) return;
      try {
        await pedir('cargos/remover', { nick });
        dadosPainel = await pedir('painel');
        setTimeout(renderSecao, 400);
      } catch (err) {
        msg.className = 'adm-aviso ruim';
        msg.textContent = err.message;
      }
    });
  }
}

let mutesCache = { mutes: [] };

async function carregarMutes() {
  mutesCache = await pedir('chat/mutes/listar');
}

function ligarMutes() {
  const msg = $('#adm-mutes-msg');
  const atualizar = async () => {
    try {
      await carregarMutes();
      if (secaoAtiva === 'mutes') await renderSecao();
    } catch (err) {
      if (msg) {
        msg.hidden = false;
        msg.className = 'adm-aviso ruim';
        msg.textContent = err.message;
      }
    }
  };

  $('#adm-mutes-atualizar')?.addEventListener('click', atualizar);

  for (const btn of document.querySelectorAll('.adm-mute-revogar')) {
    btn.addEventListener('click', async () => {
      const nick = btn.dataset.nick;
      if (!nick || !confirm(`Revogar o mute de ${nick}?`)) return;
      try {
        await pedir('chat/mutes/revogar', { nick });
        if (msg) {
          msg.hidden = false;
          msg.className = 'adm-aviso bom';
          msg.textContent = `Mute de ${nick} revogado.`;
        }
        await carregarMutes();
        setTimeout(renderSecao, 300);
      } catch (err) {
        if (msg) {
          msg.hidden = false;
          msg.className = 'adm-aviso ruim';
          msg.textContent = err.message;
        }
      }
    });
  }
}

// ---------------------------------------------------------- documentos para MED
//
// A aba que compila, para UMA conta, o relatório de auditoria enviado ao banco numa MED ou
// contestação PIX. Conteúdo, permissão, número do documento e hash são do servidor (`med.mjs`);
// aqui só o formulário, a prévia e o download.
//
// A prévia vai num `<iframe sandbox>` sem `allow-scripts`: o HTML dela traz nick, nome de produto
// e anotação que vieram do banco, e o sandbox é a segunda trava depois do escape do servidor.
// O PDF chega como binário (não JSON) — por isso ele tem o seu próprio `fetch`.

let medCache = {
  busca: { nick: '', transacao: '' },
  jogador: null,
  empresaFaltando: [],
  form: { protocolo: '', valorContestado: '', dataContestacao: '', instituicao: '', pixId: '', observacao: '' },
  emissao: null,
  historico: null,
  verificacao: null,
};

const dataHoraBr = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: FUSO_BR }) : '—');

async function baixarPdfMed(codigo) {
  const r = await fetch('/admin/med/pdf', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: sessao()?.token, codigo }),
  });
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    throw new Error(d.erro ?? 'falhou');
  }
  const blob = await r.blob();
  const nome = (r.headers.get('content-disposition') ?? '').match(/filename="([^"]+)"/)?.[1] ?? `${codigo}.pdf`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { nome, hash: r.headers.get('x-hash-pdf') };
}

async function sha256DeArquivo(arquivo) {
  const d = await crypto.subtle.digest('SHA-256', await arquivo.arrayBuffer());
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function cartaoJogadorMed(j) {
  const nd = '<i>Não disponível nos registros</i>';
  const lista = (v) => (v?.length ? v.map(escapar).join('<br>') : nd);
  const pagamentos = j.pagamentos.length
    ? j.pagamentos.map((p) => `<tr class="${p.pago ? '' : 'adm-mc-isento'}">
        <td>${escapar(dataHoraBr(p.em))}</td><td class="n">${brl(p.centavos)}</td><td class="n">${num(p.qtd)}</td>
        <td>${escapar(p.metodo)} · ${escapar(p.provedor)}</td><td>${escapar(p.status)}</td>
        <td><code>${escapar(p.comprovante ?? p.referencia)}</code></td>
        <td>${p.pago ? `<button class="adm-botao-mini" data-med-usar="${escapar(p.referencia)}">Usar na solicitação</button>` : ''}</td>
      </tr>`).join('')
    : '<tr><td colspan="7">nenhum pagamento registrado</td></tr>';
  return `<div class="adm-mc-plano bom">
    <h3>Jogador encontrado</h3>
    <table class="adm-tabela">
      <tr><td>Nickname</td><td><b>${escapar(j.nick)}</b></td></tr>
      <tr><td>Nome completo</td><td>${lista(j.nomes)} <span class="adm-pl-extra">nome do pagador informado pelo provedor</span></td></tr>
      <tr><td>E-mail</td><td>${j.email ? escapar(j.email) : nd}${j.emailsPagamento.length ? `<br><span class="adm-pl-extra">nos pagamentos: ${j.emailsPagamento.map(escapar).join(', ')}</span>` : ''}</td></tr>
      <tr><td>CPF</td><td>${lista(j.cpfs)}${j.cpfIlegivel ? ' <span class="adm-pl-extra">há CPF cifrado sem chave de leitura</span>' : ''}</td></tr>
      <tr><td>ID</td><td>personagem nº ${num(j.playerId)} · conta ${j.contaId ? `nº ${num(j.contaId)}` : '— sem conta vinculada'}</td></tr>
      <tr><td>Data de criação</td><td>conta ${escapar(dataHoraBr(j.contaCriadaEm))} · personagem ${escapar(dataHoraBr(j.personagemCriadoEm))}</td></tr>
      <tr><td>Status da conta</td><td>${escapar(j.status)}</td></tr>
      <tr><td>Saldo de diamantes</td><td>${num(j.saldo)} · ${num(j.comprasConfirmadas)} compra(s) confirmada(s), ${brl(j.totalCentavos)}</td></tr>
    </table>
    <h4>Pagamentos</h4>
    <table class="adm-tabela">
      <tr><th>quando</th><th style="text-align:right">valor</th><th style="text-align:right">💎</th><th>método</th><th>status</th><th>E2E / referência</th><th></th></tr>
      ${pagamentos}
    </table>
  </div>`;
}

function secaoMed(c) {
  const f = c.form;
  const campo = (id, rotulo, valor, extra = '') =>
    `<div class="adm-campo"><label for="med-${id}">${rotulo}</label><input id="med-${id}" data-med-form="${id}" value="${escapar(valor)}" ${extra}></div>`;
  const faltando = c.empresaFaltando?.length
    ? `<p class="adm-aviso ruim">Dados da empresa não configurados (${c.empresaFaltando.map(escapar).join(', ')} no <code>.env</code>): o documento sairá com "Não disponível nos registros do sistema" nesses campos.</p>`
    : '';

  const e = c.emissao;
  const emissao = e
    ? `<div class="adm-mc-plano ${e.divergencia ? '' : 'bom'}">
        <h3>${escapar(e.codigo)} — emitido em ${escapar(dataHoraBr(e.emitidoEm))}</h3>
        <p class="adm-aviso" style="margin:0 0 8px">Conta <b>${escapar(e.nick)}</b> · ${num(e.contagens.operacoesDiamantes)} operação(ões) de diamantes ·
          ${num(e.contagens.comprasConfirmadas)} compra(s) · ${num(e.contagens.utilizacoes)} utilização(ões)<br>
          SHA-256 do conteúdo: <code>${escapar(e.hash)}</code><br>
          ${e.compraIdentificada ? `Compra de referência: ${escapar(e.compraIdentificada.criterio)}` : 'Nenhuma compra específica identificada — o resumo cobre todas as compras.'}</p>
        ${e.divergencia ? '<p class="adm-aviso ruim">ATENÇÃO: o documento aponta divergência nas verificações de integridade (seção 8).</p>' : ''}
        <div class="adm-acoes">
          <button class="adm-botao" data-med-pdf="${escapar(e.codigo)}">Baixar PDF</button>
        </div>
        <iframe class="adm-med-previa" sandbox="" title="Prévia do documento" srcdoc="${escapar(e.html)}"></iframe>
      </div>`
    : '';

  const formulario = c.jogador
    ? `<section class="adm-secao">
        <h2>Caso de MED — ${escapar(c.jogador.nick)}</h2>
        <p class="adm-aviso" style="margin:0 0 10px">Opcional. Contextualiza o documento e aparece nele marcado como <b>informado pelo emissor</b>. Com o ID PIX (ou o valor), a compra contestada é destacada.</p>
        <div class="adm-med-form">
          ${campo('protocolo', 'Protocolo MED', f.protocolo, 'maxlength="80"')}
          ${campo('valorContestado', 'Valor contestado (R$)', f.valorContestado, 'placeholder="22,00" inputmode="decimal"')}
          ${campo('dataContestacao', 'Data da contestação', f.dataContestacao, 'type="date"')}
          ${campo('instituicao', 'Instituição solicitante', f.instituicao, 'maxlength="120"')}
          ${campo('pixId', 'ID PIX (E2E / txid)', f.pixId, 'maxlength="80"')}
        </div>
        <div class="adm-campo" style="margin-top:10px">
          <label for="med-observacao">Motivo / observação administrativa — interna, NÃO vai no documento</label>
          <textarea id="med-observacao" data-med-form="observacao" maxlength="2000" style="min-height:70px">${escapar(f.observacao)}</textarea>
        </div>
        <div class="adm-acoes" style="margin-top:12px">
          <button class="adm-botao" id="med-visualizar">Visualizar documento</button>
          <button class="adm-botao neutro" id="med-gerar-pdf">Gerar PDF</button>
        </div>
        <p class="adm-aviso">Cada clique emite um documento numerado e registrado (quem, quando, qual conta, hash). A prévia e o PDF de um mesmo número têm exatamente o mesmo conteúdo.</p>
        <p class="adm-aviso" id="med-emitir-msg"></p>
        ${emissao}
      </section>`
    : '';

  const v = c.verificacao;
  const verificacao = v
    ? v.encontrado
      ? `<table class="adm-tabela" style="margin-top:10px">
          <tr><td>Documento</td><td><b>${escapar(v.codigo)}</b> · conta ${escapar(v.nick)} (nº ${num(v.playerId)})</td></tr>
          <tr><td>Emitido</td><td>${escapar(dataHoraBr(v.emitidoEm))} por ${escapar(v.emitidoPor)}</td></tr>
          <tr><td>SHA-256 do conteúdo</td><td><code>${escapar(v.hashConteudo)}</code></td></tr>
          <tr><td>SHA-256 do PDF</td><td>${v.hashPdf ? `<code>${escapar(v.hashPdf)}</code>` : 'nenhum PDF gerado ainda'}</td></tr>
          <tr><td>Arquivo conferido</td><td>${v.arquivoConfere === null ? '—' : v.arquivoConfere ? '<b style="color:var(--verde)">CONFERE — é o arquivo emitido</b>' : '<b style="color:#ffd0c6">NÃO CONFERE — o arquivo difere do emitido</b>'}</td></tr>
          <tr><td>Protocolo</td><td>${escapar(v.contexto?.protocolo ?? '—')}</td></tr>
          <tr><td>Observação interna</td><td>${escapar(v.observacao ?? '—')}</td></tr>
        </table>`
      : '<p class="adm-aviso ruim">Nenhum documento com esse código.</p>'
    : '';

  const h = c.historico ?? { emissoes: [], acessos: [] };
  const ACAO = { consulta: 'consulta', emissao: 'emissão', pdf: 'PDF', verificacao: 'verificação' };
  const emissoes = h.emissoes.length
    ? h.emissoes.map((d) => `<tr>
        <td><b>${escapar(d.codigo)}</b></td><td>${escapar(dataHoraBr(d.emitidoEm))}</td><td>${escapar(d.porEmail)}</td>
        <td>${escapar(d.nick)}</td><td>${escapar(d.contexto?.protocolo ?? '—')}</td>
        <td>${d.hashPdf ? `<code>${escapar(d.hashPdf.slice(0, 12))}…</code>` : '—'}</td>
        <td><button class="adm-botao-mini" data-med-pdf="${escapar(d.codigo)}">PDF</button></td>
      </tr>`).join('')
    : '<tr><td colspan="7">nenhum documento emitido ainda</td></tr>';
  const acessos = h.acessos.length
    ? h.acessos.map((a) => `<tr><td>${escapar(dataHoraBr(a.em))}</td><td>${escapar(ACAO[a.acao] ?? a.acao)}</td>
        <td>${escapar(a.codigo ?? '—')}</td><td>${escapar(a.nick ?? '—')}</td><td>${escapar(a.porEmail)}</td></tr>`).join('')
    : '<tr><td colspan="5">sem registros</td></tr>';

  return `<section class="adm-secao">
    <h2>Documentos para MED</h2>
    <p class="adm-aviso" style="margin:0 0 12px">Relatório de auditoria de uma conta (cadastro, compras, histórico e utilização de diamantes, reconciliação e logs) para responder a uma MED ou contestação PIX. Somente leitura — nada no jogo é alterado. Toda busca, emissão, PDF e verificação fica registrada com o seu e-mail.</p>
    ${faltando}
    <div class="adm-busca">
      <div class="adm-campo"><label for="med-nick">Nickname</label><input id="med-nick" value="${escapar(c.busca.nick)}" autocomplete="off"></div>
      <div class="adm-campo"><label for="med-transacao">ou ID da transação (E2E / txid)</label><input id="med-transacao" value="${escapar(c.busca.transacao)}" autocomplete="off"></div>
      <button class="adm-botao" id="med-buscar">Pesquisar</button>
    </div>
    <p class="adm-aviso" id="med-msg"></p>
    ${c.jogador ? cartaoJogadorMed(c.jogador) : ''}
  </section>
  ${formulario}
  <section class="adm-secao">
    <h2>Verificar documento emitido</h2>
    <div class="adm-busca">
      <div class="adm-campo"><label for="med-ver-codigo">Código</label><input id="med-ver-codigo" placeholder="MED-2026-000001"></div>
      <div class="adm-campo"><label for="med-ver-arquivo">PDF recebido (opcional)</label><input id="med-ver-arquivo" type="file" accept="application/pdf,.pdf"></div>
      <button class="adm-botao neutro" id="med-verificar">Verificar</button>
    </div>
    <p class="adm-aviso">O arquivo não é enviado: o navegador calcula o SHA-256 dele e só o hash vai ao servidor para comparar com o registro.</p>
    <p class="adm-aviso" id="med-ver-msg"></p>
    ${verificacao}
  </section>
  <section class="adm-secao">
    <h2>Documentos emitidos</h2>
    <table class="adm-tabela">
      <tr><th>documento</th><th>emitido</th><th>por</th><th>conta</th><th>protocolo</th><th>hash do PDF</th><th></th></tr>
      ${emissoes}
    </table>
    <h3>Registro de acessos</h3>
    <table class="adm-tabela">
      <tr><th>quando</th><th>ação</th><th>documento</th><th>conta</th><th>por</th></tr>
      ${acessos}
    </table>
  </section>`;
}

function ligarMed() {
  const msg = (id, texto, bom = false) => {
    const el = $(id);
    if (!el) return;
    el.className = `adm-aviso ${bom ? 'bom' : 'ruim'}`;
    el.textContent = texto;
  };

  for (const el of document.querySelectorAll('[data-med-form]')) {
    el.addEventListener('input', () => { medCache.form[el.dataset.medForm] = el.value; });
  }

  const buscar = async () => {
    const nick = $('#med-nick').value.trim();
    const transacao = $('#med-transacao').value.trim();
    if (!nick && !transacao) return msg('#med-msg', 'digite o nickname ou o ID da transação');
    const btn = $('#med-buscar');
    btn.disabled = true;
    try {
      const r = await pedir('med/buscar', nick ? { nick } : { transacao });
      const mudouDeConta = medCache.jogador?.playerId !== r.jogador.playerId;
      medCache = {
        ...medCache,
        busca: { nick, transacao },
        jogador: r.jogador,
        empresaFaltando: r.empresaFaltando,
        emissao: mudouDeConta ? null : medCache.emissao,
        form: mudouDeConta
          ? { protocolo: '', valorContestado: '', dataContestacao: '', instituicao: '', pixId: transacao, observacao: '' }
          : medCache.form,
      };
      medCache.historico = await pedir('med/historico');
      renderSecao();
    } catch (e) {
      msg('#med-msg', e.message);
      btn.disabled = false;
    }
  };
  $('#med-buscar')?.addEventListener('click', buscar);
  for (const id of ['#med-nick', '#med-transacao']) {
    $(id)?.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') buscar(); });
  }

  for (const btn of document.querySelectorAll('[data-med-usar]')) {
    btn.addEventListener('click', () => {
      const p = medCache.jogador.pagamentos.find((x) => x.referencia === btn.dataset.medUsar);
      if (!p) return;
      medCache.form.pixId = p.comprovante ?? p.referencia;
      medCache.form.valorContestado = (p.centavos / 100).toFixed(2).replace('.', ',');
      renderSecao();
    });
  }

  const emitir = async (baixar) => {
    const botoes = [$('#med-visualizar'), $('#med-gerar-pdf')];
    botoes.forEach((b) => { if (b) b.disabled = true; });
    msg('#med-emitir-msg', 'emitindo…', true);
    try {
      const { observacao, ...contexto } = medCache.form;
      medCache.emissao = await pedir('med/emitir', { playerId: medCache.jogador.playerId, contexto, observacao });
      if (baixar) await baixarPdfMed(medCache.emissao.codigo);
      medCache.historico = await pedir('med/historico');
      renderSecao();
    } catch (e) {
      msg('#med-emitir-msg', e.message);
      botoes.forEach((b) => { if (b) b.disabled = false; });
    }
  };
  $('#med-visualizar')?.addEventListener('click', () => emitir(false));
  $('#med-gerar-pdf')?.addEventListener('click', () => emitir(true));

  for (const btn of document.querySelectorAll('[data-med-pdf]')) {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        const r = await baixarPdfMed(btn.dataset.medPdf);
        medCache.historico = await pedir('med/historico');
        renderSecao();
        setTimeout(() => msg('#med-msg', `${r.nome} baixado · SHA-256 do arquivo ${r.hash}`, true), 0);
      } catch (e) {
        msg(medCache.jogador ? '#med-emitir-msg' : '#med-msg', e.message);
        btn.disabled = false;
      }
    });
  }

  $('#med-verificar')?.addEventListener('click', async () => {
    const codigo = $('#med-ver-codigo').value.trim();
    if (!codigo) return msg('#med-ver-msg', 'digite o código do documento');
    try {
      const arquivo = $('#med-ver-arquivo').files?.[0];
      const hashArquivo = arquivo ? await sha256DeArquivo(arquivo) : undefined;
      medCache.verificacao = await pedir('med/verificar', { codigo, hashArquivo });
      renderSecao();
    } catch (e) {
      msg('#med-ver-msg', e.message);
    }
  });
}

// ------------------------------------------------------------------ tela

const SECOES_BASE = [
  { id: 'usuarios', rotulo: 'Usuários' },
  { id: 'referrals', rotulo: 'Referrals' },
  { id: 'referral-especial', rotulo: 'Referral Especial' },
  { id: 'convites', rotulo: 'Convites Discord' },
  { id: 'eventos', rotulo: 'Eventos' },
  { id: 'contagem-online', rotulo: 'Contagem online' },
  { id: 'ficha', rotulo: 'Ficha do jogador' },
  { id: 'multicontas', rotulo: 'Multi-contas' },
  { id: 'guilds', rotulo: 'Guilds' },
  { id: 'auditoria', rotulo: 'Auditoria' },
  { id: 'saques-gemas', rotulo: 'Aprovação saques' },
  { id: 'historico-gemas', rotulo: 'Histórico gemas' },
  { id: 'tesouraria', rotulo: 'Tesouraria' },
  { id: 'financeiro', rotulo: 'Custos e Ganhos' },
  { id: 'chat', rotulo: 'Tags do chat' },
  { id: 'mutes', rotulo: 'Usuários mutados' },
  { id: 'diamantes', rotulo: 'Diamantes' },
  { id: 'notas', rotulo: 'Emissão de Notas' },
  { id: 'emails', rotulo: 'Enviar emails' },
];

const SECAO_RESOLVER = { id: 'resolver-auditoria', rotulo: 'Resolver Auditoria' };

/**
 * O que o cargo Resolver Auditoria NÃO vê — a lista curta, e não a das quinze permitidas.
 *
 * É negação por escolha: quando alguém criar a aba dezesseis, ela nasce escondida para o
 * cargo e só aparece se for escrita aqui de propósito. Uma lista de permitidas faria o
 * contrário — a aba nova vazaria sozinha no dia em que entrasse no `SECOES_BASE`.
 *
 * As seis que ficaram de fora são todas de dinheiro ou de papel da empresa: a Tesouraria
 * transfere USDT, Custos e Ganhos abre a margem do jogo, Diamantes credita saldo pago,
 * Emissão de Notas e Documentos para MED carregam CPF, e a Contagem online mexe no número
 * que o jogador lê na tela.
 *
 * Esconder a aba não tranca nada: quem decide é `sessaoPainel` em `admin-rotas.mjs`, e as
 * duas listas têm de andar juntas.
 */
const NEGADAS_AO_RESOLVER = new Set([
  'contagem-online', 'tesouraria', 'financeiro', 'diamantes', 'notas', 'med',
]);

function secoesDoPainel(d) {
  if (!d) return [];
  // O cargo Resolver Auditoria enxerga quase o painel inteiro — tudo menos `NEGADAS_AO_RESOLVER`.
  //
  // A Ficha do jogador continua vindo SEM e-mail, IP e aparelho para ele: quem corta é o
  // servidor, em `fichaDeJogador({ completo })`, não esta lista. A aba Usuários mostra o
  // e-mail de qualquer forma, então o corte hoje vale mais como registro da intenção do que
  // como sigilo — mexer nele é decisão à parte.
  if (!d.adminCompleto && d.podeResolverAuditoria) {
    const lista = SECOES_BASE.filter((s) => !NEGADAS_AO_RESOLVER.has(s.id));
    lista.splice(lista.findIndex((s) => s.id === 'mutes') + 1, 0, SECAO_RESOLVER);
    return lista;
  }
  const lista = [...SECOES_BASE];
  // Documentos para MED: só com a permissão calculada pelo servidor (admin + `MED_EMAILS`). As
  // rotas `/admin/med/*` conferem de novo — esconder a aba não é a trava.
  if (d.podeDocumentosMed) {
    lista.splice(lista.findIndex((s) => s.id === 'notas') + 1, 0, { id: 'med', rotulo: 'Documentos para MED' });
  }
  if (d.podeResolverAuditoria) {
    const i = lista.findIndex((s) => s.id === 'diamantes');
    lista.splice(i + 1, 0, SECAO_RESOLVER);
  }
  return lista;
}

let dadosPainel = null;
let secaoAtiva = location.hash.slice(1) || '';
let usuariosCache = { q: '', offset: 0, limite: 40, total: 0, usuarios: [] };
// O resultado da troca de e-mail, guardado fora do HTML: a seção é redesenhada depois da troca
// (para a tabela mostrar o endereço novo), e a mensagem escrita antes sumiria junto.
let avisoTrocaEmail = null;
let auditoriaCache = { nick: '', filtro: '', eventos: [], resumo: null };
let fichaCache = { nick: '', dados: null };
let multicontasCache = {
  minimo: 2, nicks: 60, incluirApagadas: false, dados: null,
  // A busca por nick (vazio = todas as origens) e o erro dela, que aparece sem apagar o formulário.
  nick: '', erroBusca: null,
  // O estado do teto por IP e a PRÉVIA da faxina. A prévia mora aqui, e não no DOM,
  // porque o `Recarregar` redesenha a seção inteira — e uma prévia que desaparecesse
  // no meio da conferência faria o moderador clicar sem ler.
  teto: null, plano: null, resultado: null, msg: null,
  // A FAXINA GERAL tem prévia e resultado próprios — a de linha e a geral nunca ficam abertas juntas.
  planoGeral: null, resultadoGeral: null,
  // O BANIMENTO DE IP: o formulário (sobrevive ao redesenho), a prévia do IP, o resultado do
  // último ban e a lista dos banidos.
  banIp: { ip: '', motivo: '', horas: 0, previa: null, resultado: null, msg: null },
  banidos: null,
};
let guildsCache = { busca: '', guilds: [] };
let saquesAprovacaoCache = { offset: 0, limite: 40, total: 0, saques: [] };
let historicoGemasCache = {
  aba: 'depositos',
  nick: '',
  limite: 40,
  offsetDep: 0,
  totalDep: 0,
  depositos: [],
  offsetSaq: 0,
  totalSaq: 0,
  saques: [],
};
let diamantesHistCache = {
  nick: '',
  dia: hojeBr(),
  offset: 0,
  limite: 40,
  total: 0,
  pagamentos: [],
  resumoDia: { pagamentos: 0, diamantes: 0, centavos: 0 },
};
let resolverAuditoriaCache = { catalogo: [], historico: [] };
let convitesCache = { q: '', offset: 0, limite: 40, total: 0, resumo: {}, padrinhos: [], resgates: [] };
let referralsCache = { q: '', offset: 0, limite: 40, total: 0, taxaDiamantePct: 10, taxaGemaPct: 5, indicadores: [] };
let referralEspecialCache = { limites: null, itens: [] };
let refEspEditando = null;
let eventosCache = { vigente: null, historico: [] };
let contagemOnlineCache = { onlineReal: 0, onlineExibido: 0, totalExtra: 0, extras: [] };
let financeiroCache = null;
let notasCache = { meses: [], mes: null, notas: [], resumo: null };

const reaisParaCentavos = (v) => Math.max(0, Math.round(Number(String(v).replace(',', '.')) * 100) || 0);
const centavosParaReais = (c) => (Number(c ?? 0) / 100).toFixed(2);

function linhaPlanilha(rotulo, valor, extra = '', destaque = false) {
  return `<tr class="${destaque ? 'adm-pl-destaque' : ''}">
    <td>${escapar(rotulo)}</td>
    <td class="n" colspan="2">${valor}</td>
    <td class="adm-pl-extra">${escapar(extra)}</td>
  </tr>`;
}

function linhaPlanilhaFiat(rotulo, bruto, liquido, extra = '', destaque = false) {
  return `<tr class="${destaque ? 'adm-pl-destaque' : ''}">
    <td>${escapar(rotulo)}</td>
    <td class="n">${bruto}</td>
    <td class="n">${liquido}</td>
    <td class="adm-pl-extra">${escapar(extra)}</td>
  </tr>`;
}

function tabelaCustos(tipo, lista) {
  const linhas = lista.length
    ? lista.map((c) => `
        <tr>
          <td>${escapar(c.descricao)}</td>
          <td class="n">${brl(c.valorCentavos)}</td>
          <td>
            <button type="button" class="adm-botao-mini" data-editar-custo="${c.id}" data-tipo="${tipo}"
              data-desc="${escapar(c.descricao)}" data-valor="${centavosParaReais(c.valorCentavos)}">Editar</button>
            <button type="button" class="adm-botao-mini perigo" data-remover-custo="${c.id}">×</button>
          </td>
        </tr>`).join('')
    : `<tr><td colspan="3">nenhum custo cadastrado</td></tr>`;
  return `<table class="adm-tabela adm-pl-tabela">
    <tr><th>descrição</th><th style="text-align:right">valor</th><th></th></tr>
    ${linhas}
  </table>`;
}

function secaoFinanceiro(d) {
  const f = d.faturamento;
  const o = d.operacional;
  const r = d.resultado;
  const c = d.config;
  const pj = d.custosJogo;
  const p = d.passivo;

  return `<section class="adm-secao">
    <h2>Custos e Ganhos</h2>
    <p class="adm-legenda">Planilha de faturamento, custos operacionais e lucro estimado. Valores USDT usam cotação abaixo.</p>

    <div class="adm-colher adm-fin-config">
      <label class="adm-campo">Cotação USDT → BRL
        <input type="number" id="fin-cotacao" min="0.01" step="0.01" value="${Number(c.cotacaoUsdtBrl).toFixed(2)}">
      </label>
      <label class="adm-campo">Meses de operação (custos mensais ×)
        <input type="number" id="fin-meses" min="1" max="120" step="1" value="${c.mesesOperacao}">
      </label>
      <button type="button" class="adm-botao neutro" id="fin-salvar-config">Salvar parâmetros</button>
    </div>

    <div class="adm-blocos" style="margin-top:12px">
      ${bloco('bruto (BRL)', brl(f.diamantesCentavos), 'pago pelos jogadores')}
      ${bloco('líquido (BRL)', brl(f.diamantesLiquidoCentavos ?? f.diamantesCentavos), 'após taxas PIX/cartão')}
      ${bloco('este mês — líquido', brl(f.diamantesMesLiquidoCentavos ?? f.diamantesMesCentavos), `${f.pagamentosMes} pagamento(s) · bruto ${brl(f.diamantesMesCentavos)}`)}
      ${bloco('depósitos gemas', usdt(f.depositosUsdt), 'USDT recebido')}
      ${bloco('lucro estimado', brl(r.lucroEstimadoCentavos), 'líquido + margem crypto − custos', r.lucroEstimadoCentavos >= 0 ? 'sobra' : 'passivo')}
    </div>

    <h3 class="adm-subtit">Receitas</h3>
    <table class="adm-tabela adm-pl-planilha">
      <tr><th>item</th><th style="text-align:right">bruto</th><th style="text-align:right">líquido</th><th>nota</th></tr>
      ${linhaPlanilhaFiat('Diamantes (PIX/cartão)', brl(f.diamantesCentavos), brl(f.diamantesLiquidoCentavos ?? f.diamantesCentavos), 'acumulado')}
      ${linhaPlanilhaFiat('Diamantes — mês atual', brl(f.diamantesMesCentavos), brl(f.diamantesMesLiquidoCentavos ?? f.diamantesMesCentavos), `${f.pagamentosMes} pagamentos`)}
      ${linhaPlanilha('Depósitos gemas (USDT)', usdt(f.depositosUsdt), 'entrada bruta on-chain')}
      ${linhaPlanilha('Lucro crypto (caixa − passivo)', usdt(f.lucroCryptoUsdt), `passivo ${usdt(p.passivoUsdt)}`)}
      ${linhaPlanilha('Taxa mercado 15% (gemas)', usdt(f.taxaMercadoUsdt), `${num(f.taxaGemas)} gemas queimadas`)}
      ${linhaPlanilha('Margem crypto → BRL', brl(r.margemBrlCentavos), `@ R$ ${Number(c.cotacaoUsdtBrl).toFixed(2)}/USDT`)}
      ${linhaPlanilha('USDT já colhido', usdt(f.colhidoUsdt), 'transferido para carteiras de lucro')}
    </table>

    <h3 class="adm-subtit">Custos do jogo (automáticos)</h3>
    <table class="adm-tabela adm-pl-planilha">
      ${linhaPlanilha(`Comissões afiliados (${pj.pctDiamante}% diamantes)`, `${num(pj.comissaoDiamantes)} 💎`, `≈ ${brl(pj.comissaoDiamantesCentavos)}`)}
      ${linhaPlanilha(`Comissões afiliados (${pj.pctGema}% gemas)`, `${num(pj.comissaoGemas)} gemas`, usdt(pj.comissaoGemasUsdt))}
    </table>

    <h3 class="adm-subtit">Custos operacionais — mensais</h3>
    <p class="adm-legenda">VPS, marketing, ferramentas… somados × ${c.mesesOperacao} mês(es) = <b>${brl(o.totalMensalCentavos * c.mesesOperacao)}</b></p>
    ${tabelaCustos('mensal', o.mensais)}
    <div class="adm-colher adm-fin-add">
      <label class="adm-campo">Descrição
        <input type="text" id="fin-m-desc" placeholder="ex.: VPS Contabo">
      </label>
      <label class="adm-campo">R$/mês
        <input type="number" id="fin-m-valor" min="0" step="0.01" placeholder="0,00">
      </label>
      <button type="button" class="adm-botao" id="fin-add-mensal">+ Mensal</button>
    </div>

    <h3 class="adm-subtit">Custos operacionais — fixos</h3>
    <p class="adm-legenda">Parcerias, setup único, contratos pontuais… total = <b>${brl(o.totalFixoCentavos)}</b></p>
    ${tabelaCustos('fixo', o.fixos)}
    <div class="adm-colher adm-fin-add">
      <label class="adm-campo">Descrição
        <input type="text" id="fin-f-desc" placeholder="ex.: parceria streamer">
      </label>
      <label class="adm-campo">R$ total
        <input type="number" id="fin-f-valor" min="0" step="0.01" placeholder="0,00">
      </label>
      <button type="button" class="adm-botao" id="fin-add-fixo">+ Fixo</button>
    </div>

    <h3 class="adm-subtit">Resultado</h3>
    <table class="adm-tabela adm-pl-planilha">
      ${linhaPlanilha('Custos mensais × meses', brl(o.totalMensalCentavos * c.mesesOperacao), `${brl(o.totalMensalCentavos)}/mês × ${c.mesesOperacao}`)}
      ${linhaPlanilha('Custos fixos', brl(o.totalFixoCentavos))}
      ${linhaPlanilha('Total custos operacionais', brl(o.totalCentavos))}
      ${linhaPlanilhaFiat('Receita diamantes (bruto)', brl(f.diamantesCentavos), brl(f.diamantesLiquidoCentavos ?? f.diamantesCentavos), 'líquido entra no lucro')}
      ${linhaPlanilha('+ Margem crypto (BRL)', brl(r.margemBrlCentavos))}
      ${linhaPlanilha('= Lucro líquido estimado', brl(r.lucroEstimadoCentavos), 'líquido fiat + margem − custos', true)}
      ${linhaPlanilha('Fluxo do mês (líquido − mensais)', brl(r.lucroMesCentavos), 'diamantes do mês − custos/mês', true)}
    </table>
    <p class="adm-legenda" style="margin-top:8px">O lucro crypto já desconta o passivo total de gemas (${num(p.orbsPassivoTotal ?? p.orbsEmCirculacao)} × ${p.precoSaque} USDT — ledger ${num(p.orbsEmCirculacao)} + referrals pendentes ${num(p.gemasAfiliadoPendentes ?? 0)}). Comissões de afiliados na tabela abaixo são histórico contábil; não somam de novo no passivo.</p>
  </section>`;
}

let emailsRecebidosCache = {
  emails: [],
  hasMore: false,
  after: null,
  cursor: null,
  detalhe: null,
  aba: 'recebidos',
};
let emailsEnviadosCache = {
  emails: [],
  hasMore: false,
  offset: 0,
  detalhe: null,
  carregado: false,
};

function fmtEmailData(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR');
}

function tabelaEmailsEnviados(d, selecionadoId) {
  if (!d?.emails?.length) {
    return '<p class="adm-email-vazio">Nenhum e-mail enviado por aqui ainda — use a aba <b>Enviar novo</b>.</p>';
  }
  const linhas = d.emails.map((e) => {
    const cls = e.id === selecionadoId ? 'adm-email-ativo' : '';
    return `<tr class="${cls}" data-enviado-id="${escapar(String(e.id))}">
      <td>${fmtEmailData(e.em)}</td>
      <td>${escapar(e.para)}</td>
      <td>${escapar(e.assunto || '(sem assunto)')}</td>
      <td>${escapar(e.por || '—')}</td>
    </tr>`;
  }).join('');
  return `<table class="adm-tabela adm-email-lista">
    <tr><th>quando</th><th>para</th><th>assunto</th><th>por</th></tr>
    ${linhas}
  </table>`;
}

function painelDetalheEmailEnviado(d) {
  if (!d) {
    return `<div class="adm-email-detalhe"><p class="adm-email-vazio">Selecione um envio na lista para ver a mensagem.</p></div>`;
  }
  const corpo = `<div class="adm-email-corpo" style="white-space:pre-wrap">${escapar(d.mensagem || '')}</div>`;
  return `<div class="adm-email-detalhe">
    <p class="adm-email-meta">
      <b>${escapar(d.assunto || '(sem assunto)')}</b><br>
      Para: ${escapar(d.para)}<br>
      Enviado por: ${escapar(d.por || '—')}<br>
      ${fmtEmailData(d.em)}
    </p>
    ${corpo}
  </div>`;
}

function blocoEnviadosEmail() {
  const d = emailsEnviadosCache;
  const pag = d.hasMore
    ? `<div class="adm-paginacao">
        <button type="button" class="adm-botao neutro" id="adm-enviados-mais">Mais antigos</button>
        <span>${num(d.emails.length)} envio(s) nesta lista</span>
      </div>`
    : `<div class="adm-paginacao"><span>${num(d.emails.length)} envio(s)</span></div>`;
  return `<div id="adm-email-enviados" ${emailsRecebidosCache.aba === 'enviados' ? '' : 'hidden'}>
    <p class="adm-legenda" style="margin:8px 0 12px">
      E-mails enviados manualmente pela aba <b>Enviar novo</b> (marketing/suporte). Confirmações de cadastro e recuperação de senha não aparecem aqui.
    </p>
    <div class="adm-linha" style="margin-bottom:8px">
      <button type="button" class="adm-botao neutro" id="adm-enviados-atualizar">Atualizar</button>
    </div>
    <div class="adm-email-layout">
      <div>
        ${tabelaEmailsEnviados(d, d.detalhe?.id)}
        ${pag}
      </div>
      ${painelDetalheEmailEnviado(d.detalhe)}
    </div>
    <p class="adm-aviso" id="adm-enviados-msg"></p>
  </div>`;
}

function tabelaEmailsRecebidos(d, selecionadoId) {
  if (!d?.emails?.length) {
    return '<p class="adm-email-vazio">Nenhum e-mail recebido ainda — confira se o Receiving está ativo no Resend para support@pokeidle.io.</p>';
  }
  const linhas = d.emails.map((e) => {
    const cls = e.id === selecionadoId ? 'adm-email-ativo' : '';
    return `<tr class="${cls}" data-email-id="${escapar(e.id)}">
      <td>${fmtEmailData(e.em)}</td>
      <td>${escapar(e.de)}</td>
      <td>${escapar(e.assunto || '(sem assunto)')}${e.anexos ? ` 📎${e.anexos}` : ''}</td>
    </tr>`;
  }).join('');
  return `<table class="adm-tabela adm-email-lista">
    <tr><th>quando</th><th>de</th><th>assunto</th></tr>
    ${linhas}
  </table>`;
}

function painelDetalheEmail(d) {
  if (!d) {
    return `<div class="adm-email-detalhe"><p class="adm-email-vazio">Selecione um e-mail na lista para ler e responder.</p></div>`;
  }
  const corpo = d.html
    ? `<div class="adm-email-corpo"><iframe sandbox="" srcdoc="${escapar(d.html)}"></iframe></div>`
    : `<div class="adm-email-corpo">${escapar(d.text || '(sem conteúdo)')}</div>`;
  const anexos = d.anexos?.length
    ? `<p class="adm-legenda">${d.anexos.length} anexo(s): ${d.anexos.map((a) => escapar(a.nome)).join(', ')}</p>`
    : '';
  return `<div class="adm-email-detalhe">
    <p class="adm-email-meta">
      <b>${escapar(d.assunto || '(sem assunto)')}</b><br>
      De: ${escapar(d.de)}<br>
      Para: ${escapar((d.para ?? []).join(', ') || '—')}<br>
      ${fmtEmailData(d.em)}
    </p>
    ${corpo}
    ${anexos}
    <div class="adm-colher" style="margin-top:12px">
      <div class="adm-campo">
        <label for="adm-resp-assunto">assunto da resposta</label>
        <input id="adm-resp-assunto" type="text" maxlength="200" value="${escapar(d.assuntoResposta ?? '')}">
      </div>
      <label class="adm-campo" style="margin-top:8px">
        resposta
        <textarea id="adm-resp-mensagem" rows="6" maxlength="8000" placeholder="Escreva a resposta…"></textarea>
      </label>
      <div class="adm-linha" style="margin-top:10px">
        <button type="button" class="adm-botao" id="adm-resp-enviar" data-id="${escapar(d.id)}">Enviar resposta</button>
      </div>
      <p class="adm-aviso" id="adm-resp-msg">Resposta sai de <b>support@pokeidle.io</b>.</p>
    </div>
  </div>`;
}

function blocoEnviarEmail() {
  return `<div id="adm-email-enviar" ${emailsRecebidosCache.aba === 'enviar' ? '' : 'hidden'}>
    <p class="adm-legenda" style="margin:8px 0 12px">
      Envia e-mail manual pelo Resend. Remetente: <b>support@pokeidle.io</b>.
    </p>
    <div class="adm-colher">
      <div class="adm-linha">
        <div class="adm-campo">
          <label for="adm-email-para">destinatário</label>
          <input id="adm-email-para" type="email" placeholder="jogador@gmail.com" autocomplete="off">
        </div>
        <div class="adm-campo">
          <label for="adm-email-assunto">assunto</label>
          <input id="adm-email-assunto" type="text" maxlength="200" placeholder="Mensagem do suporte Pokéidle.io">
        </div>
      </div>
      <label class="adm-campo" style="margin-top:8px">
        mensagem
        <textarea id="adm-email-mensagem" rows="8" maxlength="8000" placeholder="Escreva a mensagem…"></textarea>
      </label>
      <div class="adm-linha" style="margin-top:10px">
        <button type="button" class="adm-botao" id="adm-email-enviar-btn">Enviar</button>
      </div>
      <p class="adm-aviso" id="adm-email-msg">Requer <code>RESEND_API_KEY</code> no servidor.</p>
    </div>
  </div>`;
}

function blocoRecebidosEmail() {
  const d = emailsRecebidosCache;
  const pag = d.hasMore
    ? `<div class="adm-paginacao">
        <button type="button" class="adm-botao neutro" id="adm-email-mais" ${d.cursor ? '' : 'disabled'}>Mais antigos</button>
        <span>${num(d.emails.length)} e-mail(s) nesta página</span>
      </div>`
    : `<div class="adm-paginacao"><span>${num(d.emails.length)} e-mail(s)</span></div>`;
  return `<div id="adm-email-recebidos" ${d.aba === 'recebidos' ? '' : 'hidden'}>
    <p class="adm-legenda" style="margin:8px 0 12px">
      Caixa de entrada do Resend Receiving (<b>support@pokeidle.io</b>). Clique num e-mail para ler e responder.
    </p>
    <div class="adm-linha" style="margin-bottom:8px">
      <button type="button" class="adm-botao neutro" id="adm-email-atualizar">Atualizar</button>
    </div>
    <div class="adm-email-layout">
      <div>
        ${tabelaEmailsRecebidos(d, d.detalhe?.id)}
        ${pag}
      </div>
      ${painelDetalheEmail(d.detalhe)}
    </div>
    <p class="adm-aviso" id="adm-recebidos-msg"></p>
  </div>`;
}

function secaoEmails() {
  return `<section class="adm-secao">
    <h2>Enviar emails</h2>
    <div class="adm-abas" id="adm-email-abas">
      <button type="button" class="adm-nav-btn ${emailsRecebidosCache.aba === 'recebidos' ? 'on' : ''}" data-aba="recebidos">Recebidos</button>
      <button type="button" class="adm-nav-btn ${emailsRecebidosCache.aba === 'enviados' ? 'on' : ''}" data-aba="enviados">Enviados</button>
      <button type="button" class="adm-nav-btn ${emailsRecebidosCache.aba === 'enviar' ? 'on' : ''}" data-aba="enviar">Enviar novo</button>
    </div>
    ${blocoRecebidosEmail()}
    ${blocoEnviadosEmail()}
    ${blocoEnviarEmail()}
  </section>`;
}

async function carregarEmailsEnviados(offset = 0, manterDetalhe = false) {
  const detalheId = manterDetalhe ? emailsEnviadosCache.detalhe?.id : null;
  const r = await pedir('emails/enviados/listar', { limite: 50, offset: offset || 0 });
  emailsEnviadosCache = {
    ...emailsEnviadosCache,
    emails: offset ? [...emailsEnviadosCache.emails, ...r.emails] : r.emails,
    hasMore: r.hasMore,
    offset: r.offset,
    carregado: true,
    detalhe: manterDetalhe ? emailsEnviadosCache.detalhe : null,
  };
  if (detalheId && !offset) {
    const ainda = r.emails.some((e) => e.id === detalheId);
    if (ainda) await abrirEmailEnviado(detalheId, true);
    else emailsEnviadosCache.detalhe = null;
  }
}

async function abrirEmailEnviado(id, silencioso = false) {
  const msg = $('#adm-enviados-msg');
  try {
    const d = await pedir('emails/enviados/detalhe', { id: Number(id) });
    emailsEnviadosCache.detalhe = d;
    if (!silencioso && msg) { msg.className = 'adm-aviso'; msg.textContent = ''; }
    repintarEmails();
  } catch (err) {
    if (msg) {
      msg.className = 'adm-aviso ruim';
      msg.textContent = err.message;
    }
  }
}

async function carregarEmailsRecebidos(after = null, manterDetalhe = false) {
  const detalheId = manterDetalhe ? emailsRecebidosCache.detalhe?.id : null;
  const r = await pedir('emails/recebidos/listar', { limite: 30, after: after || undefined });
  emailsRecebidosCache = {
    ...emailsRecebidosCache,
    emails: after ? [...emailsRecebidosCache.emails, ...r.emails] : r.emails,
    hasMore: r.hasMore,
    cursor: r.after,
    detalhe: manterDetalhe ? emailsRecebidosCache.detalhe : null,
  };
  if (detalheId && !after) {
    const ainda = r.emails.some((e) => e.id === detalheId);
    if (ainda) await abrirEmailRecebido(detalheId, true);
    else emailsRecebidosCache.detalhe = null;
  }
}

async function abrirEmailRecebido(id, silencioso = false) {
  const msg = $('#adm-recebidos-msg');
  try {
    const d = await pedir('emails/recebidos/detalhe', { id });
    const assunto = String(d.assunto ?? '').trim();
    d.assuntoResposta = assunto && !/^re:/i.test(assunto) ? `Re: ${assunto}` : (assunto || 'Re: sua mensagem');
    emailsRecebidosCache.detalhe = d;
    if (!silencioso && msg) { msg.className = 'adm-aviso'; msg.textContent = ''; }
    repintarEmails();
  } catch (err) {
    if (msg) {
      msg.className = 'adm-aviso ruim';
      msg.textContent = err.message;
    }
  }
}

function repintarEmails() {
  const corpo = $('#adm-corpo');
  if (!corpo || secaoAtiva !== 'emails') return;
  corpo.innerHTML = secaoEmails();
  ligarEmails();
}

function ligarEmails() {
  for (const btn of document.querySelectorAll('#adm-email-abas [data-aba]')) {
    btn.addEventListener('click', async () => {
      emailsRecebidosCache.aba = btn.dataset.aba;
      if (btn.dataset.aba === 'enviados' && !emailsEnviadosCache.carregado) {
        try {
          await carregarEmailsEnviados();
        } catch (err) {
          const msg = $('#adm-enviados-msg');
          if (msg) {
            msg.className = 'adm-aviso ruim';
            msg.textContent = err.message;
          }
        }
      }
      repintarEmails();
    });
  }

  $('#adm-email-atualizar')?.addEventListener('click', async () => {
    const msg = $('#adm-recebidos-msg');
    try {
      await carregarEmailsRecebidos(null, true);
      repintarEmails();
      if (msg) {
        msg.className = 'adm-aviso bom';
        msg.textContent = 'Lista atualizada.';
      }
    } catch (err) {
      if (msg) {
        msg.className = 'adm-aviso ruim';
        msg.textContent = err.message;
      }
    }
  });

  $('#adm-email-mais')?.addEventListener('click', async () => {
    if (!emailsRecebidosCache.cursor) return;
    const msg = $('#adm-recebidos-msg');
    try {
      await carregarEmailsRecebidos(emailsRecebidosCache.cursor, true);
      repintarEmails();
    } catch (err) {
      if (msg) {
        msg.className = 'adm-aviso ruim';
        msg.textContent = err.message;
      }
    }
  });

  for (const row of document.querySelectorAll('[data-email-id]')) {
    row.addEventListener('click', () => abrirEmailRecebido(row.dataset.emailId));
  }

  for (const row of document.querySelectorAll('[data-enviado-id]')) {
    row.addEventListener('click', () => abrirEmailEnviado(row.dataset.enviadoId));
  }

  $('#adm-enviados-atualizar')?.addEventListener('click', async () => {
    const msg = $('#adm-enviados-msg');
    try {
      await carregarEmailsEnviados(0, true);
      repintarEmails();
      if (msg) {
        msg.className = 'adm-aviso bom';
        msg.textContent = 'Lista atualizada.';
      }
    } catch (err) {
      if (msg) {
        msg.className = 'adm-aviso ruim';
        msg.textContent = err.message;
      }
    }
  });

  $('#adm-enviados-mais')?.addEventListener('click', async () => {
    const msg = $('#adm-enviados-msg');
    try {
      await carregarEmailsEnviados(emailsEnviadosCache.offset, true);
      repintarEmails();
    } catch (err) {
      if (msg) {
        msg.className = 'adm-aviso ruim';
        msg.textContent = err.message;
      }
    }
  });

  const btnResp = $('#adm-resp-enviar');
  if (btnResp) {
    btnResp.onclick = async () => {
      const msg = $('#adm-resp-msg');
      const id = btnResp.dataset.id;
      const assunto = $('#adm-resp-assunto')?.value?.trim();
      const mensagem = $('#adm-resp-mensagem')?.value?.trim();
      if (!mensagem) {
        msg.className = 'adm-aviso ruim';
        msg.textContent = 'informe a resposta';
    return;
      }
      if (!confirm('Enviar resposta para o remetente deste e-mail?')) return;
      btnResp.disabled = true;
      btnResp.textContent = 'Enviando…';
      try {
        const r = await pedir('emails/recebidos/responder', { id, assunto, mensagem });
        msg.className = 'adm-aviso bom';
        msg.textContent = `Resposta enviada para ${r.para}.`;
        $('#adm-resp-mensagem').value = '';
      } catch (err) {
        msg.className = 'adm-aviso ruim';
        msg.textContent = err.message;
      } finally {
        btnResp.disabled = false;
        btnResp.textContent = 'Enviar resposta';
      }
    };
  }

  const msg = $('#adm-email-msg');
  const botao = $('#adm-email-enviar-btn');
  if (botao) {
    botao.onclick = async () => {
      const para = $('#adm-email-para')?.value?.trim();
      const assunto = $('#adm-email-assunto')?.value?.trim();
      const mensagem = $('#adm-email-mensagem')?.value?.trim();
      if (!para) {
        msg.className = 'adm-aviso ruim';
        msg.textContent = 'informe o e-mail de destino';
        return;
      }
      if (!mensagem) {
        msg.className = 'adm-aviso ruim';
        msg.textContent = 'informe a mensagem';
        return;
      }
      if (!confirm(`Enviar e-mail para ${para}?`)) return;

      botao.disabled = true;
      botao.textContent = 'Enviando…';
      try {
        const r = await pedir('emails/enviar', { para, assunto, mensagem });
        msg.className = 'adm-aviso bom';
        msg.textContent = `Enviado para ${para}.`;
        $('#adm-email-mensagem').value = '';
        if (r?.id) {
          emailsEnviadosCache.carregado = false;
          if (emailsRecebidosCache.aba === 'enviados') {
            await carregarEmailsEnviados();
            repintarEmails();
          }
        }
      } catch (err) {
        msg.className = 'adm-aviso ruim';
        msg.textContent = err.message;
      } finally {
        botao.disabled = false;
        botao.textContent = 'Enviar';
      }
    };
  }
}

async function carregarFinanceiro() {
  financeiroCache = await pedir('financeiro/resumo');
  return financeiroCache;
}

function ligarFinanceiro() {
  const corpo = $('#adm-corpo');
  const aviso = (msg, bom) => {
    const el = $('#fin-aviso');
    if (!el) return;
    el.textContent = msg;
    el.className = `adm-aviso ${bom ? 'bom' : 'ruim'}`;
    el.hidden = false;
    setTimeout(() => { el.hidden = true; }, 4000);
  };

  $('#fin-salvar-config')?.addEventListener('click', async () => {
    try {
      await pedir('financeiro/config', {
        cotacaoUsdtBrl: Number($('#fin-cotacao')?.value),
        mesesOperacao: Number($('#fin-meses')?.value),
      });
      await carregarFinanceiro();
      corpo.innerHTML = secaoFinanceiro(financeiroCache) + '<div id="fin-aviso" hidden class="adm-aviso"></div>';
      ligarFinanceiro();
      aviso('Parâmetros salvos', true);
    } catch (err) {
      aviso(err.message, false);
    }
  });

  const addCusto = async (tipo) => {
    const pref = tipo === 'fixo' ? 'f' : 'm';
    const desc = $(`#fin-${pref}-desc`)?.value?.trim();
    const valor = reaisParaCentavos($(`#fin-${pref}-valor`)?.value);
    if (!desc) return aviso('descrição obrigatória', false);
    try {
      await pedir('financeiro/custos/salvar', { tipo, descricao: desc, valorCentavos: valor });
      await carregarFinanceiro();
      corpo.innerHTML = secaoFinanceiro(financeiroCache) + '<div id="fin-aviso" hidden class="adm-aviso"></div>';
      ligarFinanceiro();
      aviso('Custo adicionado', true);
    } catch (err) {
      aviso(err.message, false);
    }
  };

  $('#fin-add-mensal')?.addEventListener('click', () => addCusto('mensal'));
  $('#fin-add-fixo')?.addEventListener('click', () => addCusto('fixo'));

  for (const btn of document.querySelectorAll('[data-remover-custo]')) {
    btn.addEventListener('click', async () => {
      if (!confirm('Remover este custo?')) return;
      try {
        await pedir('financeiro/custos/remover', { id: Number(btn.dataset.removerCusto) });
        await carregarFinanceiro();
        corpo.innerHTML = secaoFinanceiro(financeiroCache) + '<div id="fin-aviso" hidden class="adm-aviso"></div>';
        ligarFinanceiro();
      } catch (err) {
        aviso(err.message, false);
      }
    });
  }

  for (const btn of document.querySelectorAll('[data-editar-custo]')) {
    btn.addEventListener('click', async () => {
      const desc = prompt('Descrição:', btn.dataset.desc);
      if (desc == null) return;
      const valorStr = prompt('Valor (R$):', btn.dataset.valor);
      if (valorStr == null) return;
      try {
        await pedir('financeiro/custos/salvar', {
          id: Number(btn.dataset.editarCusto),
          tipo: btn.dataset.tipo,
          descricao: desc,
          valorCentavos: reaisParaCentavos(valorStr),
        });
        await carregarFinanceiro();
        corpo.innerHTML = secaoFinanceiro(financeiroCache) + '<div id="fin-aviso" hidden class="adm-aviso"></div>';
        ligarFinanceiro();
        aviso('Custo atualizado', true);
      } catch (err) {
        aviso(err.message, false);
      }
    });
  }
}

function irSecao(id) {
  if (id === 'diamantes' && id !== secaoAtiva) {
    diamantesHistCache = {
      ...diamantesHistCache,
      dia: hojeBr(),
      offset: 0,
      nick: '',
    };
  }
  secaoAtiva = id;
  location.hash = id;
  renderSecao();
}

function montarNav() {
  const nav = $('#adm-nav');
  if (!nav) return;
  const secoes = secoesDoPainel(dadosPainel);
  nav.hidden = false;
  nav.innerHTML = secoes.map(
    (s) => `<button type="button" class="adm-nav-btn${s.id === secaoAtiva ? ' ativo' : ''}" data-secao="${s.id}">${escapar(s.rotulo)}</button>`,
  ).join('');
  for (const btn of nav.querySelectorAll('[data-secao]')) {
    btn.addEventListener('click', () => irSecao(btn.dataset.secao));
  }
}

function secaoTesouraria(d) {
  return (
    secaoCrypto(d.crypto) +
    secaoVarredura(d.varredura) +
    secaoColher(d.crypto, d.carteiras) +
    secaoFiat(d.fiat) +
    secaoHistorico(d.historico)
  );
}

function secaoUsuariosLista(lista) {
  const linhas = lista.usuarios?.length
    ? lista.usuarios
        .map((u) => {
          const status = u.banido
            ? u.banSoft
              ? `<span class="adm-badge adm-badge-ban-soft">ban soft</span>`
              : `<span class="adm-badge adm-badge-ban">ban hard</span>`
            : u.online
              ? `<span class="adm-badge adm-badge-on">online</span>`
              : `<span class="adm-badge adm-badge-off">offline</span>`;
          const apagar = `<button class="adm-botao-mini perigo" data-apagar-conta="${escapar(u.nick)}" title="Exclusão permanente (LGPD)">Apagar</button>`;
          const acao = u.banido
            ? `<button class="adm-botao-mini" data-desbanir="${escapar(u.nick)}" data-ban-soft="${u.banSoft ? '1' : ''}">Desbanir</button>${
                u.banSoft
                  ? ` <button class="adm-botao-mini" data-ban-hard="${escapar(u.nick)}">Ban hard</button>`
                  : ''
              } <button class="adm-botao-mini" data-editar-coins="${escapar(u.nick)}" data-gold="${u.gold ?? 0}">Coins</button>
               <button class="adm-botao-mini" data-editar-email="${escapar(u.nick)}" data-email="${escapar(u.email ?? '')}">E-mail</button>
               <button class="adm-botao-mini" data-ficha="${escapar(u.nick)}">Ficha</button>
               <button class="adm-botao-mini" data-auditoria="${escapar(u.nick)}">Log</button> ${apagar}`
            : `<button class="adm-botao-mini" data-ban-hard="${escapar(u.nick)}">Ban hard</button>
               <button class="adm-botao-mini" data-banir-soft="${escapar(u.nick)}">Ban soft</button>
               <button class="adm-botao-mini" data-editar-coins="${escapar(u.nick)}" data-gold="${u.gold ?? 0}">Coins</button>
               <button class="adm-botao-mini" data-editar-email="${escapar(u.nick)}" data-email="${escapar(u.email ?? '')}">E-mail</button>
               <button class="adm-botao-mini" data-ficha="${escapar(u.nick)}">Ficha</button>
               <button class="adm-botao-mini" data-auditoria="${escapar(u.nick)}">Log</button> ${apagar}`;
          return `<tr>
            <td><b>${escapar(u.nick)}</b></td>
            <td>${escapar(u.email ?? '—')}</td>
            <td>${escapar(u.provedor)}</td>
            <td class="n">${u.level ?? '—'}</td>
            <td class="n">${u.gold != null ? num(u.gold) : '—'}</td>
            <td class="n">${u.diamonds != null ? num(u.diamonds) : '—'}</td>
            <td class="n">${u.orbs != null ? num(u.orbs) : '—'}</td>
            <td class="n" title="total comprado (PIX/cartão confirmados) — saldo após ban hard">${num(u.diamantesReset ?? 0)}</td>
            <td class="n" title="saldo atual de gemas — quem sacou não recupera">${num(u.gemasReset ?? 0)}</td>
            <td>${status}</td>
            <td>${u.ultimoLogin ? new Date(u.ultimoLogin).toLocaleString('pt-BR') : '—'}</td>
            <td class="adm-acoes">${acao}</td>
          </tr>`;
        })
        .join('')
    : '<tr><td colspan="12">nenhuma conta encontrada</td></tr>';

  const pagina = Math.floor(lista.offset / lista.limite) + 1;
  const paginas = Math.max(1, Math.ceil(lista.total / lista.limite));
  const aviso = avisoTrocaEmail;
  avisoTrocaEmail = null;

  return `<section class="adm-secao">
    <h2>Usuários</h2>
    <p class="adm-legenda"><b>Ban hard</b> zera progresso (nível, coins, ELO, capturas, pokémon) e impede login — desbanir não restaura progresso. Diamantes voltam ao total comprado; gemas ficam no saldo atual (quem sacou não recupera).<br>
    <b>Ban soft</b> só bloqueia login e expulsa quem está online; ao desbanir, o jogador volta com o progresso intacto.<br>
    <b>Apagar conta</b> remove login, e-mail e personagem do banco — irreversível; use para pedidos LGPD (não é ban).<br>
    <b>E-mail</b> troca o e-mail de login — para quem se cadastrou com domínio que saiu da whitelist e hoje não consegue entrar.<br>
    <b>💎 p/ reset</b> — total de diamantes comprados (PIX/cartão confirmados). <b>💠 p/ reset</b> — gemas que ainda estão na conta hoje, não o total já depositado.</p>
    <div class="adm-busca">
      <div class="adm-campo">
        <label for="adm-user-q">buscar nick ou e-mail</label>
        <input id="adm-user-q" type="text" value="${escapar(lista.q)}" placeholder="Fulano ou email@…">
      </div>
      <button class="adm-botao neutro" id="adm-user-buscar">Buscar</button>
    </div>
    <table class="adm-tabela">
      <tr><th>nick</th><th>e-mail</th><th>provedor</th><th style="text-align:right">nível</th><th style="text-align:right">coins</th><th style="text-align:right">diamantes</th><th style="text-align:right">gemas</th><th style="text-align:right">💎 p/ reset</th><th style="text-align:right">💠 p/ reset</th><th>status</th><th>último login</th><th></th></tr>
      ${linhas}
    </table>
    <div class="adm-paginacao">
      <span>${num(lista.total)} contas · pág. ${pagina}/${paginas}</span>
      <button class="adm-botao-mini" id="adm-user-prev" ${lista.offset <= 0 ? 'disabled' : ''}>← Anterior</button>
      <button class="adm-botao-mini" id="adm-user-next" ${lista.offset + lista.limite >= lista.total ? 'disabled' : ''}>Próxima →</button>
    </div>
    <div class="adm-colher" style="margin-top:14px">
      <div class="adm-linha">
        <div class="adm-campo">
          <label for="adm-ban-nick">nick do jogador</label>
          <input id="adm-ban-nick" type="text" maxlength="64" placeholder="NickDoJogador">
        </div>
        <div class="adm-campo" style="flex:2">
          <label for="adm-ban-motivo">motivo (opcional)</label>
          <input id="adm-ban-motivo" type="text" maxlength="500" placeholder="Trapaça, abuso no chat…">
        </div>
        <button class="adm-botao aviso" id="adm-ban-soft-enviar">Ban soft</button>
        <button class="adm-botao perigo" id="adm-ban-enviar">Ban hard</button>
      </div>
      <p class="adm-aviso" id="adm-ban-msg">Ban soft: bloqueia sem apagar. Ban hard: zera progresso e rankings.</p>
    </div>
    <div class="adm-colher" style="margin-top:14px">
      <div class="adm-linha">
        <div class="adm-campo">
          <label for="adm-coins-nick">nick do jogador</label>
          <input id="adm-coins-nick" type="text" maxlength="64" placeholder="NickDoJogador">
        </div>
        <div class="adm-campo" style="max-width:220px">
          <label for="adm-coins-valor">coins (valor final)</label>
          <input id="adm-coins-valor" type="number" step="1" min="0" placeholder="0">
        </div>
        <button class="adm-botao neutro" id="adm-coins-enviar">Definir coins</button>
      </div>
      <p class="adm-aviso" id="adm-coins-msg">Substitui o saldo no banco — não soma nem subtrai. Se estiver online, atualiza na hora.</p>
    </div>
    <div class="adm-colher" style="margin-top:14px">
      <div class="adm-linha">
        <div class="adm-campo">
          <label for="adm-email-nick">nick ou e-mail atual</label>
          <input id="adm-email-nick" type="text" maxlength="128" placeholder="NickDoJogador ou email@…">
        </div>
        <div class="adm-campo" style="flex:2">
          <label for="adm-email-novo">e-mail novo</label>
          <input id="adm-email-novo" type="email" maxlength="254" placeholder="fulano@gmail.com" autocomplete="off">
        </div>
        <button class="adm-botao neutro" id="adm-email-enviar">Trocar e-mail</button>
      </div>
      <p class="adm-aviso ${aviso ? 'bom' : ''}" id="adm-email-msg">${escapar(aviso ?? 'Vale na hora e já conta como confirmado: o jogador entra com o e-mail novo e a senha de sempre. Só domínios da whitelist. Derruba as sessões abertas e invalida links de senha que foram para o e-mail antigo.')}</p>
    </div>
    <div class="adm-colher" style="margin-top:14px">
      <div class="adm-linha">
        <div class="adm-campo">
          <label for="adm-apagar-nick">nick ou e-mail</label>
          <input id="adm-apagar-nick" type="text" maxlength="128" placeholder="NickDoJogador ou email@…">
        </div>
        <button class="adm-botao perigo" id="adm-apagar-enviar">Apagar conta</button>
      </div>
      <p class="adm-aviso" id="adm-apagar-msg">Exclusão permanente: apaga conta, e-mail, progresso e rankings. Não dá para desfazer.</p>
    </div>
  </section>`;
}

const pct = (n) =>
  Number(n ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function secaoReferrals(lista) {
  const linhas = lista.indicadores?.length
    ? lista.indicadores
        .map(
          (r) => `<tr>
            <td><b>${escapar(r.nick)}</b></td>
            <td><code>${escapar(r.code ?? '—')}</code></td>
            <td class="n">${num(r.visitas)}</td>
            <td class="n">${num(r.indicados)}</td>
            <td class="n">${num(r.indicadosNv40)}</td>
            <td class="n">${num(r.comissaoDiamantes)}</td>
            <td class="n">${pct(r.pctDiamantes)}%</td>
            <td class="n">${num(r.comissaoGemas)}</td>
            <td class="n">${pct(r.pctGemas)}%</td>
          </tr>`,
        )
        .join('')
    : '<tr><td colspan="9">nenhum indicador com convites ainda</td></tr>';

  const pagina = Math.floor(lista.offset / lista.limite) + 1;
  const paginas = Math.max(1, Math.ceil(lista.total / lista.limite));
  const taxaDia = lista.taxaDiamantePct ?? 10;
  const taxaGema = lista.taxaGemaPct ?? 5;

  return `<section class="adm-secao">
    <h2>Referrals — Indique &amp; Ganhe</h2>
    <p class="adm-legenda">Quem já trouxe pelo menos um jogador. Comissão PADRÃO: <b>${taxaDia}%</b> dos diamantes comprados e <b>${taxaGema}%</b> das gemas depositadas pelos indicados — quem tem acordo próprio aparece em <a href="#referral-especial">Referral Especial</a>.<br>
    As colunas <b>% diam.</b> e <b>% gemas</b> são a fatia de <em>tudo que aquele nick já recebeu</em> (ledger positivo) que veio de comissão de indicação.</p>
    <div class="adm-busca">
      <div class="adm-campo">
        <label for="adm-ref-q">buscar nick, e-mail ou código</label>
        <input id="adm-ref-q" type="text" value="${escapar(lista.q)}" placeholder="Fulano ou ABC1234">
      </div>
      <button class="adm-botao neutro" id="adm-ref-buscar">Buscar</button>
    </div>
    <table class="adm-tabela">
      <tr>
        <th>nick</th><th>código</th><th style="text-align:right">visitas</th>
        <th style="text-align:right">indicados</th><th style="text-align:right">nv 40+</th>
        <th style="text-align:right">💎 comissão</th><th style="text-align:right">% diam.</th>
        <th style="text-align:right">💠 comissão</th><th style="text-align:right">% gemas</th>
      </tr>
      ${linhas}
    </table>
    <div class="adm-paginacao">
      <span>${num(lista.total)} indicadores · pág. ${pagina}/${paginas}</span>
      <button class="adm-botao-mini" id="adm-ref-prev" ${lista.offset <= 0 ? 'disabled' : ''}>← Anterior</button>
      <button class="adm-botao-mini" id="adm-ref-next" ${lista.offset + lista.limite >= lista.total ? 'disabled' : ''}>Próxima →</button>
    </div>
  </section>`;
}

// -------------------------------------------------------- Convites do Discord

/**
 * A aba dos CONVITES DO DISCORD: quem trouxe quem, e quais marcos viraram prêmio.
 *
 * Três colunas de contagem, e elas NÃO são a mesma coisa — a diferença entre a primeira e as
 * outras é onde uma fazenda de contas aparece:
 *
 *   trouxe       tudo que entrou por um link daquele padrinho
 *   válidos      os que contam: conta de Discord com mais de um ano E ainda no servidor
 *   novas/saíram por que os outros não contam
 *
 * `quem resgatou` pode ser um nick diferente do dono do Discord, e isso não é erro: o código é
 * transferível de propósito (ver `convites-db.mjs`). A coluna existe justamente para a staff
 * conseguir ver para onde cada prêmio foi.
 */
function secaoConvites(d) {
  const r = d.resumo ?? {};
  const linhas = d.padrinhos?.length
    ? d.padrinhos
        .map((p) => {
          const perdidos = [
            p.novosDemais ? `${num(p.novosDemais)} conta nova` : '',
            p.sairam ? `${num(p.sairam)} saiu` : '',
          ].filter(Boolean).join(' · ');
          return `<tr>
            <td><b>${escapar(p.nome ?? '—')}</b><br><code class="adm-mini">${escapar(p.discordId)}</code></td>
            <td class="n">${num(p.trouxe)}</td>
            <td class="n"><b>${num(p.convidados)}</b></td>
            <td>${escapar(perdidos || '—')}</td>
            <td class="n">${num(p.codigos)}</td>
            <td class="n">${num(p.resgatados)}</td>
            <td>${p.marcosAbertos ? escapar(p.marcosAbertos) : '—'}</td>
            <td>${p.quemResgatou ? escapar(p.quemResgatou) : '—'}</td>
          </tr>`;
        })
        .join('')
    : '<tr><td colspan="8">ninguém trouxe convidado ainda</td></tr>';

  const resgates = d.resgates?.length
    ? d.resgates
        .map((g) => `<tr>
            <td><code>${escapar(g.codigo)}</code></td>
            <td class="n">${num(g.marco)}</td>
            <td>${escapar(g.nomeDiscord ?? g.discordId)}</td>
            <td><b>${escapar(g.nick ?? '(conta apagada)')}</b></td>
            <td>${escapar(quando(g.resgatadoEm))}</td>
            <td>${g.entregueEm ? 'entregue' : '<b class="adm-alerta">pendente</b>'}</td>
          </tr>`)
        .join('')
    : '<tr><td colspan="6">nenhum código resgatado ainda</td></tr>';

  const pagina = Math.floor(d.offset / d.limite) + 1;
  const paginas = Math.max(1, Math.ceil(d.total / d.limite));

  return `<section class="adm-secao">
    <h2>Convites do Discord — Convide &amp; Ganhe</h2>
    <p class="adm-legenda">Quem entra no Discord pelo link de um jogador vira ponto dele. Ao cruzar um marco (1, 5, 10, 20, 50, 100, 500), o bot manda um código no privado e o jogador resgata com <b>/resgatar</b> no chat.<br>
    <b>Válidos</b> é o número que move a escada: conta de Discord com <b>mais de 1 ano</b> e ainda dentro do servidor. A diferença para <b>trouxe</b> é onde uma fazenda de contas aparece.</p>

    <div class="adm-blocos">
      ${bloco('membros no Discord', num(r.membros ?? 0), `${num(r.sairam ?? 0)} já saíram`)}
      ${bloco('com padrinho', num(r.atribuidos ?? 0), `${num(r.padrinhos ?? 0)} padrinhos`)}
      ${bloco('convidados válidos', num(r.validos ?? 0), 'contam na escada')}
      ${bloco('códigos gerados', num(r.codigos ?? 0), `${num(r.enviados ?? 0)} enviados no privado`)}
      ${bloco('códigos resgatados', num(r.resgatados ?? 0))}
      ${bloco('💎 pagos em convite', num(r.diamantes ?? 0), 'brinde, não entra na cota')}
    </div>

    <div class="adm-busca" style="margin-top:14px">
      <div class="adm-campo">
        <label for="adm-cv-q">buscar por nome, id do Discord ou nick que resgatou</label>
        <input id="adm-cv-q" type="text" value="${escapar(d.q ?? '')}" placeholder="fulano, 2054638821336, befoin">
      </div>
      <button class="adm-botao neutro" id="adm-cv-buscar">Buscar</button>
    </div>

    <table class="adm-tabela">
      <tr>
        <th>padrinho</th>
        <th style="text-align:right">trouxe</th>
        <th style="text-align:right">válidos</th>
        <th>não contam</th>
        <th style="text-align:right">códigos</th>
        <th style="text-align:right">resgatados</th>
        <th>marcos em aberto</th>
        <th>quem resgatou</th>
      </tr>
      ${linhas}
    </table>
    <div class="adm-paginacao">
      <span>${num(d.total)} padrinhos · pág. ${pagina}/${paginas}</span>
      <button class="adm-botao-mini" id="adm-cv-prev" ${d.offset <= 0 ? 'disabled' : ''}>← Anterior</button>
      <button class="adm-botao-mini" id="adm-cv-next" ${d.offset + d.limite >= d.total ? 'disabled' : ''}>Próxima →</button>
    </div>

    <h3 style="margin-top:22px">Últimos resgates</h3>
    <p class="adm-legenda">O <b>nick</b> é a conta do jogo que trocou o código pelo prêmio, e ele pode ser diferente do dono do Discord: o código é transferível de propósito.<br>
    <b>pendente</b> na última coluna é o caso raro em que o processo caiu entre carimbar o código e gravar o prêmio — o próximo login daquele jogador reentrega sozinho.</p>
    <table class="adm-tabela">
      <tr>
        <th>código</th><th style="text-align:right">marco</th><th>dono no Discord</th>
        <th>resgatou no jogo</th><th>quando</th><th>prêmio</th>
      </tr>
      ${resgates}
    </table>
  </section>`;
}

async function carregarConvites(offset = convitesCache.offset) {
  const q = $('#adm-cv-q')?.value?.trim() ?? convitesCache.q;
  const limite = convitesCache.limite ?? 40;
  const dados = await pedir('convites/listar', { q, offset, limite });
  convitesCache = { ...dados, q, offset, limite };
  return convitesCache;
}

function ligarConvites() {
  const recarregar = async (off = convitesCache.offset) => {
    try {
      await carregarConvites(off);
      $('#adm-corpo').innerHTML = secaoConvites(convitesCache);
      ligarConvites();
    } catch (err) {
      $('#adm-corpo').innerHTML = `<div class="adm-erro">${escapar(err.message)}</div>`;
    }
  };
  $('#adm-cv-buscar')?.addEventListener('click', () => recarregar(0));
  $('#adm-cv-q')?.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') recarregar(0);
  });
  $('#adm-cv-prev')?.addEventListener('click', () => {
    if (convitesCache.offset > 0) recarregar(Math.max(0, convitesCache.offset - convitesCache.limite));
  });
  $('#adm-cv-next')?.addEventListener('click', () => {
    if (convitesCache.offset + convitesCache.limite < convitesCache.total) {
      recarregar(convitesCache.offset + convitesCache.limite);
    }
  });
}

async function carregarReferrals(offset = referralsCache.offset) {
  const q = $('#adm-ref-q')?.value?.trim() ?? referralsCache.q;
  const limite = referralsCache.limite ?? 40;
  const dados = await pedir('referrals/listar', { q, offset, limite });
  referralsCache = { ...dados, q, offset, limite };
  return referralsCache;
}

function ligarReferrals() {
  const recarregar = async (off = referralsCache.offset) => {
    await carregarReferrals(off);
    renderSecao();
  };

  $('#adm-ref-buscar')?.addEventListener('click', () => recarregar(0));
  $('#adm-ref-q')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') recarregar(0);
  });
  $('#adm-ref-prev')?.addEventListener('click', () => {
    if (referralsCache.offset > 0) recarregar(Math.max(0, referralsCache.offset - referralsCache.limite));
  });
  $('#adm-ref-next')?.addEventListener('click', () => {
    if (referralsCache.offset + referralsCache.limite < referralsCache.total) {
      recarregar(referralsCache.offset + referralsCache.limite);
    }
  });
}

// -------------------------------------------------- referral especial
//
// A tela de acordo com streamer. A conta que ela mostra ao vivo é a MESMA de
// `game/afiliados.mjs`; os limites chegam prontos do servidor (`limites`) justamente para que
// nenhum número fique repetido à mão aqui — se o spread mudar, esta tela muda junto.

/** Sobra no caixa, como fração do depósito, para uma taxa de gema. Espelha `margemDoDeposito`. */
function margemGema(taxaPct, lim) {
  const t = Number(taxaPct) / 100;
  if (!Number.isFinite(t) || !lim) return null;
  return 1 - (1 + t) * (lim.precoSaque / lim.precoCompra);
}

/** O parecer sobre uma taxa de gema digitada: a cor, a frase e se precisa de confirmação. */
function pareceGema(taxaPct, lim) {
  const t = Number(taxaPct) / 100;
  if (!lim || taxaPct === '' || taxaPct == null || !Number.isFinite(t)) return null;
  const m = margemGema(taxaPct, lim);
  // Tudo dito por DEPÓSITO DE US$ 10 (= 1.000 gemas), que é como a decisão se apresenta: entram
  // US$ 10, o jogador saca US$ 9, e o US$ 1 de diferença é o único dinheiro que existe.
  const levaUsd = Math.floor(1000 * t) * lim.precoSaque;
  const sobraUsd = 10 * m;
  const equilibrio = m > 0 ? lim.custoRedePrimeiroSaque / m : Infinity;

  if (t > lim.tetoGema) {
    const noTeto = Math.floor(1000 * lim.tetoGema) * lim.precoSaque;
    return {
      classe: 'ruim',
      txt: `RECUSADO: o teto da gema é ${(lim.tetoGema * 100).toFixed(0)}%. A cada US$ 10 depositados `
         + `sobra US$ 1,00 depois do saque do jogador, e é dele que a comissão sai — no teto o parceiro `
         + `já leva US$ ${noTeto.toFixed(2)} desse US$ 1,00. Nesta taxa ele levaria US$ ${levaUsd.toFixed(2)}, `
         + `e o projeto ficaria com US$ ${sobraUsd.toFixed(2)}. Para dar mais, use o bônus em diamante abaixo.`,
    };
  }
  if (t > lim.tetoGemaSeguro) {
    return {
      classe: 'ruim',
      txt: `ATENÇÃO: a cada US$ 10 depositados o parceiro leva US$ ${levaUsd.toFixed(2)} do US$ 1,00 de `
         + `margem e sobram US$ ${sobraUsd.toFixed(2)}. A tesouraria de gema não fica negativa, mas o `
         + `custo de rede do 1º saque (US$ ${lim.custoRedePrimeiroSaque.toFixed(2)}, pago pela receita de `
         + `diamante) só se paga com indicados que depositem mais de US$ ${equilibrio.toFixed(2)}. `
         + `Marque "entendo o risco" para salvar.`,
    };
  }
  return {
    classe: 'bom',
    txt: `OK: a cada US$ 10 depositados o parceiro leva US$ ${levaUsd.toFixed(2)} e sobram `
       + `US$ ${sobraUsd.toFixed(2)} para o projeto. O custo de rede do 1º saque `
       + `(US$ ${lim.custoRedePrimeiroSaque.toFixed(2)}, bancado pela receita de diamante) se paga com `
       + `indicados acima de US$ ${equilibrio.toFixed(2)} depositados.`,
  };
}

/** Fração guardada no banco → o número que o painel edita, em pontos percentuais. */
const pctCampo = (v) => (v == null ? '' : String(Math.round(Number(v) * 1000) / 10));

function linhaEspecial(r, lim) {
  const taxa = (v, padrao) => (v == null
    ? `<span class="adm-badge adm-badge-off">${padrao}% padrão</span>`
    : `<b>${Math.round(v * 1000) / 10}%</b>`);
  const margem = 1 - (1 + (r.taxaGema ?? lim.padraoGema)) * (lim.precoSaque / lim.precoCompra);
  return `<tr>
    <td><b>${escapar(r.nick)}</b>${r.streamerOficial ? ' <span class="adm-tag adm-tag-streamer">Influenciador</span>' : ''}</td>
    <td><code>?ref=${escapar(r.slug || r.code || '—')}</code></td>
    <td class="n">${taxa(r.taxaGema, Math.round(lim.padraoGema * 100))}</td>
    <td class="n">${taxa(r.taxaDiamante, Math.round(lim.padraoDiamante * 100))}</td>
    <td class="n">${r.taxaDiaExtra ? `<b>${Math.round(r.taxaDiaExtra * 1000) / 10}%</b>` : '—'}</td>
    <td class="n">${(margem * 100).toFixed(2)}%</td>
    <td class="n">${num(r.indicados)}</td>
    <td class="n">${num(r.pagoGema)}</td>
    <td class="n">${num(r.pagoDiamante)}</td>
    <td class="adm-acoes">
      <button type="button" class="adm-botao-mini" data-re-editar="${escapar(r.nick)}">Editar</button>
      <button type="button" class="adm-botao-mini perigo" data-re-remover="${escapar(r.nick)}">Remover</button>
    </td>
  </tr>`;
}

function secaoReferralEspecial(d) {
  const lim = d.limites;
  const e = refEspEditando ?? {};
  const linhas = d.itens?.length
    ? d.itens.map((r) => linhaEspecial(r, lim)).join('')
    : '<tr><td colspan="10">nenhum acordo especial — todo mundo está no padrão</td></tr>';

  return `<section class="adm-secao">
    <h2>Referral Especial — streamers parceiros</h2>
    <p class="adm-legenda">
      Taxa por indicador, link personalizado e o selo de <b>Influenciador Oficial</b> dentro do jogo (e a tag roxa [STREAMER] no chat).
      Campo em branco = volta ao padrão (<b>${Math.round(lim.padraoGema * 100)}%</b> em gema,
      <b>${Math.round(lim.padraoDiamante * 100)}%</b> em diamante).
    </p>

    <div class="adm-blocos">
      ${bloco('Teto da gema', `${(lim.tetoGema * 100).toFixed(0)}%`, `empate aritmético em ${(lim.tetoGemaRuina * 100).toFixed(2)}%`, 'passivo')}
      ${bloco('Sem aviso até', `${(lim.tetoGemaSeguro * 100).toFixed(2)}%`, `guarda ${(lim.margemMinimaCaixa * 100).toFixed(0)}% do depósito`, 'sobra')}
      ${bloco('Teto do diamante', `${(lim.tetoDiamanteMax * 100).toFixed(0)}%`, 'diamante não vira USDT')}
      ${bloco('Bônus em diamante', `1 por ${num(lim.gemasPorDiamante)} gemas`, 'sobre o depósito de gema')}
    </div>

    <p class="adm-aviso">
      <b>De onde sai a comissão.</b> Um indicado deposita US$ 10 e recebe 1.000 gemas; se sacar
      tudo, leva US$ 9,00. <b>O US$ 1,00 de diferença é o único dinheiro que a operação gera</b>, e a
      comissão em gema sai inteira dele — a ${Math.round(lim.padraoGema * 100)}% o parceiro leva
      US$ ${(Math.floor(1000 * lim.padraoGema) * lim.precoSaque).toFixed(2)}; a
      ${(lim.tetoGema * 100).toFixed(0)}%, US$ ${(Math.floor(1000 * lim.tetoGema) * lim.precoSaque).toFixed(2)}.
      <br>
      <b>Cuidado com "10% dos US$ 10".</b> US$ 1,00 em dinheiro são 111 gemas, que é
      <b>${(lim.tetoGemaRuina * 100).toFixed(2)}%</b> do depósito, não 10% — a gema é vendida a
      ${lim.precoCompra} e recomprada a ${lim.precoSaque}, então dar 10% do DINHEIRO custa
      ${(lim.tetoGemaRuina * 100).toFixed(2)}% das GEMAS e zera o projeto. Por isso o teto é a taxa,
      não o valor.
      <br>
      <b>Diamante não tem esse teto</b> — não é sacável, então 10% ou 30% dá no mesmo para a
      tesouraria. Para prometer mais do que o teto da gema, use o <b>bônus em diamante sobre o
      depósito</b>. E <b>a taxa do Mercado (15%) não paga essa conta</b>: ela queima gema que já
      existe, e só quando a gema gira entre jogadores — quem deposita e saca direto nunca a paga.
    </p>

    <div class="adm-colher">
      <div class="adm-linha">
        <div class="adm-campo" style="max-width:200px">
          <label for="re-nick">nick no jogo</label>
          <input id="re-nick" type="text" value="${escapar(e.nick ?? '')}" placeholder="mattayahu" autocomplete="off">
        </div>
        <div class="adm-campo" style="max-width:220px">
          <label for="re-slug">link personalizado (?ref=)</label>
          <input id="re-slug" type="text" value="${escapar(e.slug ?? '')}" placeholder="matta" autocomplete="off">
        </div>
      </div>
      <div class="adm-linha" style="margin-top:10px">
        <div class="adm-campo" style="max-width:150px">
          <label for="re-gema">% em gema</label>
          <input id="re-gema" type="number" step="0.1" min="0" value="${pctCampo(e.taxaGema)}" placeholder="${Math.round(lim.padraoGema * 100)}">
        </div>
        <div class="adm-campo" style="max-width:150px">
          <label for="re-diamante">% em diamante</label>
          <input id="re-diamante" type="number" step="0.1" min="0" value="${pctCampo(e.taxaDiamante)}" placeholder="${Math.round(lim.padraoDiamante * 100)}">
        </div>
        <div class="adm-campo" style="max-width:230px">
          <label for="re-extra">% bônus em diamante, sobre o depósito</label>
          <input id="re-extra" type="number" step="0.1" min="0" value="${pctCampo(e.taxaDiaExtra)}" placeholder="0">
        </div>
      </div>
      <p class="adm-aviso" id="re-parecer"></p>
      <p class="adm-aviso" id="re-total"></p>
      <div class="adm-linha" style="margin-top:10px">
        <label class="adm-check"><input type="checkbox" id="re-streamer" ${e.streamerOficial ? 'checked' : ''}> Influenciador Oficial (selo que o jogador vê)</label>
        <label class="adm-check"><input type="checkbox" id="re-confirmado"> entendo o risco desta taxa</label>
      </div>
      <div class="adm-linha" style="margin-top:10px">
        <button class="adm-botao" id="re-salvar">Salvar acordo</button>
        ${refEspEditando ? '<button class="adm-botao neutro" id="re-cancelar">Cancelar edição</button>' : ''}
      </div>
      <p class="adm-aviso" id="re-msg"></p>
    </div>

    <h3 class="adm-subtit">Acordos ativos</h3>
    <table class="adm-tabela">
      <tr>
        <th>nick</th><th>link</th>
        <th style="text-align:right">gema</th><th style="text-align:right">diamante</th>
        <th style="text-align:right">bônus</th><th style="text-align:right">margem/depósito</th>
        <th style="text-align:right">indicados</th>
        <th style="text-align:right">gemas pagas</th><th style="text-align:right">diam. pagos</th>
        <th></th>
      </tr>
      ${linhas}
    </table>
    <p class="adm-legenda">"pago" é o que já NASCEU de comissão — dívida do projeto assim que existe, mesmo que o streamer ainda não tenha recolhido.</p>
  </section>`;
}

async function carregarReferralEspecial() {
  referralEspecialCache = await pedir('referral-especial/listar');
  return referralEspecialCache;
}

function ligarReferralEspecial() {
  const lim = referralEspecialCache.limites;
  const msg = $('#re-msg');
  const parecer = $('#re-parecer');
  const total = $('#re-total');

  const repintarParecer = () => {
    const p = pareceGema($('#re-gema')?.value, lim);
    if (!p) {
      parecer.className = 'adm-aviso';
      parecer.textContent = `Em branco = padrão de ${Math.round(lim.padraoGema * 100)}%`
        + ` (sobram US$ ${(lim.margemPadrao * 100).toFixed(2)} por US$ 100 depositados).`;
    } else {
      parecer.className = `adm-aviso ${p.classe}`;
      parecer.textContent = p.txt;
    }

    // O que o parceiro recebe SOMANDO as duas moedas — é o número que ele negocia ("quero 15%"),
    // e mostrá-lo aqui é o que permite fechar 15% sem ninguém refazer a conta de cabeça.
    const campoG = $('#re-gema');
    const campoX = $('#re-extra');
    const gPct = campoG?.value.trim() ? Number(campoG.value) : lim.padraoGema * 100;
    const xPct = campoX?.value.trim() ? Number(campoX.value) : 0;
    if (!Number.isFinite(gPct) || !Number.isFinite(xPct)) return;
    total.className = 'adm-aviso';
    total.textContent = xPct > 0
      ? `O parceiro recebe ${(gPct + xPct).toFixed(1)}% do depósito: ${gPct.toFixed(1)}% em gema`
        + ` + ${xPct.toFixed(1)}% em diamante (1 diamante a cada ${lim.gemasPorDiamante} gemas).`
        + ` Só a parte em gema pesa no caixa.`
      : `O parceiro recebe ${gPct.toFixed(1)}% do depósito, tudo em gema.`;
  };

  $('#re-gema')?.addEventListener('input', repintarParecer);
  $('#re-extra')?.addEventListener('input', repintarParecer);
  repintarParecer();

  $('#re-salvar')?.addEventListener('click', async () => {
    const botao = $('#re-salvar');
    botao.disabled = true;
    msg.className = 'adm-aviso';
    msg.textContent = 'salvando…';
    try {
      const r = await pedir('referral-especial/definir', {
        nick: $('#re-nick').value.trim(),
        slug: $('#re-slug').value.trim(),
        taxaGemaPct: $('#re-gema').value.trim(),
        taxaDiamantePct: $('#re-diamante').value.trim(),
        taxaDiaExtraPct: $('#re-extra').value.trim(),
        streamerOficial: $('#re-streamer').checked,
        confirmado: $('#re-confirmado').checked,
      });
      refEspEditando = null;
      await renderSecao();
      // Depois do render, senão a mensagem morre com o HTML antigo. O aviso é o caso em que o
      // acordo foi salvo mas a tag do chat não pôde ser trocada — salvar deu certo, e a tela
      // precisa dizer o que ficou de fora.
      const depois = $('#re-msg');
      if (depois && r?.aviso) {
        depois.className = 'adm-aviso ruim';
        depois.textContent = r.aviso;
      } else if (depois) {
        depois.className = 'adm-aviso bom';
        depois.textContent = `acordo de ${r.nick} salvo.`;
      }
    } catch (err) {
      msg.className = 'adm-aviso ruim';
      msg.textContent = err.message;
      botao.disabled = false;
    }
  });

  $('#re-cancelar')?.addEventListener('click', async () => {
    refEspEditando = null;
    await renderSecao();
  });

  document.querySelectorAll('[data-re-editar]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      refEspEditando = referralEspecialCache.itens.find((r) => r.nick === btn.dataset.reEditar) ?? null;
      await renderSecao();
    });
  });

  document.querySelectorAll('[data-re-remover]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const nick = btn.dataset.reRemover;
      if (!confirm(`Remover o acordo especial de ${nick}? Ele volta ao padrão. O código de convite, as visitas e todo o histórico de comissão ficam; só o link personalizado deixa de funcionar.`)) return;
      btn.disabled = true;
      try {
        await pedir('referral-especial/remover', { nick });
        refEspEditando = null;
        await renderSecao();
      } catch (err) {
        msg.className = 'adm-aviso ruim';
        msg.textContent = err.message;
        btn.disabled = false;
      }
    });
  });
}

async function carregarUsuarios(offset = usuariosCache.offset) {
  const q = $('#adm-user-q')?.value?.trim() ?? usuariosCache.q;
  const limite = usuariosCache.limite ?? 40;
  const dados = await pedir('usuarios/listar', { q, offset, limite });
  // A resposta só traz total + usuarios — preservar paginação local ou offset/limite viram NaN.
  usuariosCache = { ...dados, q, offset, limite };
  return usuariosCache;
}

function ligarUsuarios() {
  const msg = $('#adm-ban-msg');
  const msgCoins = $('#adm-coins-msg');
  const msgApagar = $('#adm-apagar-msg');
  let confirmando = false;
  let confirmandoSoft = false;
  let confirmandoCoins = false;
  let confirmandoApagar = false;
  let confirmandoEmail = false;
  const botaoBan = $('#adm-ban-enviar');
  const botaoBanSoft = $('#adm-ban-soft-enviar');
  const botaoCoins = $('#adm-coins-enviar');
  const botaoApagar = $('#adm-apagar-enviar');
  const botaoEmail = $('#adm-email-enviar');
  const msgEmail = $('#adm-email-msg');

  const recarregar = async (off = usuariosCache.offset) => {
    await carregarUsuarios(off);
    renderSecao();
  };

  const resetConfirmacao = () => {
    confirmando = false;
    confirmandoSoft = false;
    confirmandoApagar = false;
    if (botaoBan) {
      botaoBan.textContent = 'Ban hard';
      botaoBan.classList.remove('confirmar');
    }
    if (botaoBanSoft) {
      botaoBanSoft.textContent = 'Ban soft';
      botaoBanSoft.classList.remove('confirmar');
    }
    if (botaoApagar) {
      botaoApagar.textContent = 'Apagar conta';
      botaoApagar.classList.remove('confirmar');
    }
  };

  const resetConfirmacaoCoins = () => {
    confirmandoCoins = false;
    if (botaoCoins) {
      botaoCoins.textContent = 'Definir coins';
      botaoCoins.classList.remove('confirmar');
    }
  };

  const resetConfirmacaoEmail = () => {
    confirmandoEmail = false;
    if (botaoEmail) {
      botaoEmail.textContent = 'Trocar e-mail';
      botaoEmail.classList.remove('confirmar');
    }
  };

  $('#adm-user-buscar')?.addEventListener('click', () => recarregar(0));
  $('#adm-user-q')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') recarregar(0);
  });
  $('#adm-user-prev')?.addEventListener('click', () => recarregar(Math.max(0, usuariosCache.offset - usuariosCache.limite)));
  $('#adm-user-next')?.addEventListener('click', () => recarregar(usuariosCache.offset + usuariosCache.limite));

  botaoBanSoft?.addEventListener('click', async () => {
    const nick = $('#adm-ban-nick').value.trim();
    const motivo = $('#adm-ban-motivo').value.trim();
    if (!nick) {
      msg.className = 'adm-aviso ruim';
      msg.textContent = 'digite o nick do jogador';
    return;
  }
    if (!confirmandoSoft) {
      confirmando = false;
      resetConfirmacao();
      confirmandoSoft = true;
      botaoBanSoft.textContent = 'Confirmar ban soft';
      botaoBanSoft.classList.add('confirmar');
      msg.className = 'adm-aviso';
      msg.textContent = `Ban soft ${nick}? Bloqueia login sem zerar progresso. Clique de novo para confirmar.`;
      setTimeout(() => {
        if (!confirmandoSoft) return;
        confirmandoSoft = false;
        botaoBanSoft.textContent = 'Ban soft';
        botaoBanSoft.classList.remove('confirmar');
      }, 30_000);
      return;
    }
    botaoBanSoft.disabled = true;
    botaoBanSoft.textContent = 'aplicando…';
    try {
      await pedir('usuarios/banir-soft', { nick, motivo });
      msg.className = 'adm-aviso bom';
      msg.textContent = `${nick} banido (soft). Progresso preservado.`;
      resetConfirmacao();
      $('#adm-ban-nick').value = '';
      $('#adm-ban-motivo').value = '';
      await recarregar(usuariosCache.offset);
    } catch (err) {
      msg.className = 'adm-aviso ruim';
      msg.textContent = err.message;
      resetConfirmacao();
    } finally {
      botaoBanSoft.disabled = false;
    }
  });

  botaoBan?.addEventListener('click', async () => {
    const nick = $('#adm-ban-nick').value.trim();
    const motivo = $('#adm-ban-motivo').value.trim();
    if (!nick) {
      msg.className = 'adm-aviso ruim';
      msg.textContent = 'digite o nick do jogador';
      return;
    }
    if (!confirmando) {
      confirmandoSoft = false;
      resetConfirmacao();
      confirmando = true;
      botaoBan.textContent = 'Confirmar ban hard';
      botaoBan.classList.add('confirmar');
      msg.className = 'adm-aviso ruim';
      msg.textContent = `Ban hard ${nick}? Progresso e rankings serão zerados. Clique de novo para confirmar.`;
      setTimeout(() => {
        if (!confirmando) return;
        confirmando = false;
        botaoBan.textContent = 'Ban hard';
        botaoBan.classList.remove('confirmar');
      }, 30_000);
      return;
    }
    botaoBan.disabled = true;
    botaoBanSoft.disabled = true;
    botaoBan.textContent = 'banindo…';
    try {
      await pedir('usuarios/banir', { nick, motivo });
      msg.className = 'adm-aviso bom';
      msg.textContent = `${nick} banido (hard). Progresso zerado.`;
      resetConfirmacao();
      $('#adm-ban-nick').value = '';
      $('#adm-ban-motivo').value = '';
      await recarregar(usuariosCache.offset);
    } catch (err) {
      msg.className = 'adm-aviso ruim';
      msg.textContent = err.message;
      resetConfirmacao();
    } finally {
      botaoBan.disabled = false;
      botaoBanSoft.disabled = false;
    }
  });

  for (const btn of document.querySelectorAll('[data-ban-hard]')) {
    btn.addEventListener('click', () => {
      $('#adm-ban-nick').value = btn.dataset.banHard ?? '';
      $('#adm-ban-motivo').focus();
      resetConfirmacao();
      msg.className = 'adm-aviso ruim';
      msg.textContent = 'Confirme Ban hard (zera tudo) ou Ban soft (só bloqueia) abaixo.';
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    });
  }

  for (const btn of document.querySelectorAll('[data-banir-soft]')) {
    btn.addEventListener('click', () => {
      $('#adm-ban-nick').value = btn.dataset.banirSoft ?? '';
      $('#adm-ban-motivo').focus();
      resetConfirmacao();
      msg.className = 'adm-aviso';
      msg.textContent = 'Confirme Ban soft abaixo — bloqueia login sem apagar progresso.';
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    });
  }

  botaoApagar?.addEventListener('click', async () => {
    const pedido = $('#adm-apagar-nick').value.trim();
    if (!pedido) {
      msgApagar.className = 'adm-aviso ruim';
      msgApagar.textContent = 'digite o nick ou e-mail da conta';
      return;
    }
    if (!confirmandoApagar) {
      confirmando = false;
      confirmandoSoft = false;
      resetConfirmacao();
      confirmandoApagar = true;
      botaoApagar.textContent = 'Confirmar exclusão';
      botaoApagar.classList.add('confirmar');
      msgApagar.className = 'adm-aviso ruim';
      msgApagar.textContent =
        `Apagar ${pedido} para sempre? Login, e-mail e progresso somem do banco. Clique de novo para confirmar.`;
      setTimeout(() => {
        if (!confirmandoApagar) return;
        confirmandoApagar = false;
        botaoApagar.textContent = 'Apagar conta';
        botaoApagar.classList.remove('confirmar');
      }, 30_000);
      return;
    }
    botaoApagar.disabled = true;
    botaoApagar.textContent = 'apagando…';
    try {
      const r = await pedir('usuarios/apagar', { nick: pedido });
      msgApagar.className = 'adm-aviso bom';
      msgApagar.textContent = `Conta ${r.nick} apagada${r.email ? ` (${r.email})` : ''}.`;
      resetConfirmacao();
      $('#adm-apagar-nick').value = '';
      await recarregar(usuariosCache.offset);
    } catch (err) {
      msgApagar.className = 'adm-aviso ruim';
      msgApagar.textContent = err.message;
      resetConfirmacao();
    } finally {
      botaoApagar.disabled = false;
    }
  });

  for (const btn of document.querySelectorAll('[data-apagar-conta]')) {
    btn.addEventListener('click', () => {
      $('#adm-apagar-nick').value = btn.dataset.apagarConta ?? '';
      resetConfirmacao();
      msgApagar.className = 'adm-aviso ruim';
      msgApagar.textContent = 'Confirme Apagar conta abaixo — exclusão permanente, não é ban.';
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    });
  }

  for (const btn of document.querySelectorAll('[data-desbanir]')) {
    btn.addEventListener('click', async () => {
      const nick = btn.dataset.desbanir;
      const soft = btn.dataset.banSoft === '1';
      if (!nick) return;
      const aviso = soft
        ? `Desbanir ${nick}? O jogador poderá entrar de novo com o progresso intacto.`
        : `Desbanir ${nick}? O progresso zerado pelo ban NÃO volta.`;
      if (!confirm(aviso)) return;
      try {
        await pedir('usuarios/desbanir', { nick });
        await recarregar(usuariosCache.offset);
      } catch (err) {
        msg.className = 'adm-aviso ruim';
        msg.textContent = err.message;
      }
    });
  }

  for (const btn of document.querySelectorAll('[data-editar-coins]')) {
    btn.addEventListener('click', () => {
      $('#adm-coins-nick').value = btn.dataset.editarCoins ?? '';
      $('#adm-coins-valor').value = btn.dataset.gold ?? '0';
      resetConfirmacaoCoins();
      if (msgCoins) {
        msgCoins.className = 'adm-aviso';
        msgCoins.textContent = `Saldo atual: ${num(btn.dataset.gold ?? 0)} coins. Edite o valor final e confirme abaixo.`;
      }
      $('#adm-coins-valor').focus();
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    });
  }

  for (const btn of document.querySelectorAll('[data-editar-email]')) {
    btn.addEventListener('click', () => {
      $('#adm-email-nick').value = btn.dataset.editarEmail ?? '';
      $('#adm-email-novo').value = '';
      resetConfirmacaoEmail();
      if (msgEmail) {
        msgEmail.className = 'adm-aviso';
        msgEmail.textContent = `E-mail atual de ${btn.dataset.editarEmail}: ${btn.dataset.email || '(nenhum)'}. Digite o novo e confirme abaixo.`;
      }
      $('#adm-email-novo').focus();
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    });
  }

  // Mudar qualquer um dos dois campos desarma o "Confirmar": o segundo clique confirma
  // exatamente o par que a mensagem mostrou.
  for (const id of ['#adm-email-nick', '#adm-email-novo']) {
    $(id)?.addEventListener('input', () => {
      if (confirmandoEmail) resetConfirmacaoEmail();
    });
  }

  botaoEmail?.addEventListener('click', async () => {
    const nick = $('#adm-email-nick').value.trim();
    const novoEmail = $('#adm-email-novo').value.trim().toLowerCase();
    if (!nick) {
      msgEmail.className = 'adm-aviso ruim';
      msgEmail.textContent = 'digite o nick ou o e-mail atual da conta';
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(novoEmail)) {
      msgEmail.className = 'adm-aviso ruim';
      msgEmail.textContent = 'digite um e-mail novo válido';
      return;
    }
    if (!confirmandoEmail) {
      confirmandoEmail = true;
      botaoEmail.textContent = 'Confirmar troca';
      botaoEmail.classList.add('confirmar');
      msgEmail.className = 'adm-aviso ruim';
      msgEmail.textContent = `Trocar o e-mail de ${nick} para ${novoEmail}? Confira letra por letra: quem controlar essa caixa passa a recuperar a senha da conta. Clique de novo para confirmar.`;
      setTimeout(() => {
        if (!confirmandoEmail) return;
        resetConfirmacaoEmail();
      }, 30_000);
      return;
    }
    botaoEmail.disabled = true;
    botaoEmail.textContent = 'trocando…';
    try {
      const r = await pedir('usuarios/email', { nick, novoEmail });
      avisoTrocaEmail = `${r.nick}: ${r.anterior ?? '(sem e-mail)'} → ${r.email}. Já pode entrar com o e-mail novo.`;
      msgEmail.className = 'adm-aviso bom';
      msgEmail.textContent = avisoTrocaEmail;
      resetConfirmacaoEmail();
      await recarregar(usuariosCache.offset);
    } catch (err) {
      msgEmail.className = 'adm-aviso ruim';
      msgEmail.textContent = err.message;
      resetConfirmacaoEmail();
    } finally {
      botaoEmail.disabled = false;
    }
  });

  for (const btn of document.querySelectorAll('[data-auditoria]')) {
    btn.addEventListener('click', () => {
      auditoriaCache.nick = btn.dataset.auditoria ?? '';
      irSecao('auditoria');
    });
  }

  for (const btn of document.querySelectorAll('[data-ficha]')) {
    btn.addEventListener('click', () => {
      fichaCache = { nick: btn.dataset.ficha ?? '', dados: null };
      irSecao('ficha');
    });
  }

  botaoCoins?.addEventListener('click', async () => {
    const nick = $('#adm-coins-nick').value.trim();
    const goldRaw = $('#adm-coins-valor').value;
    const gold = Math.floor(Number(goldRaw));
    if (!nick) {
      msgCoins.className = 'adm-aviso ruim';
      msgCoins.textContent = 'digite o nick do jogador';
      return;
    }
    if (!Number.isFinite(gold) || gold < 0 || goldRaw === '') {
      msgCoins.className = 'adm-aviso ruim';
      msgCoins.textContent = 'coins tem de ser um inteiro ≥ 0';
      return;
    }
    if (!confirmandoCoins) {
      confirmandoCoins = true;
      botaoCoins.textContent = 'Confirmar coins';
      botaoCoins.classList.add('confirmar');
      msgCoins.className = 'adm-aviso ruim';
      msgCoins.textContent = `Definir ${nick} com ${num(gold)} coins? Substitui o saldo inteiro. Clique de novo para confirmar.`;
      setTimeout(() => {
        if (!confirmandoCoins) return;
        resetConfirmacaoCoins();
      }, 30_000);
      return;
    }
    botaoCoins.disabled = true;
    botaoCoins.textContent = 'salvando…';
    try {
      const r = await pedir('usuarios/coins', { nick, gold });
      msgCoins.className = 'adm-aviso bom';
      msgCoins.textContent = `${r.nick}: ${num(r.anterior)} → ${num(r.gold)} coins.`;
      resetConfirmacaoCoins();
      await recarregar(usuariosCache.offset);
    } catch (err) {
      msgCoins.className = 'adm-aviso ruim';
      msgCoins.textContent = err.message;
      resetConfirmacaoCoins();
    } finally {
      botaoCoins.disabled = false;
    }
  });
}

function detalheAuditoria(e) {
  const base = e.detalhe ?? '—';
  const m = e.ref?.match(/^pk:(\d+)$/);
  if (!m) return escapar(base);
  const cod = `#${m[1]}`;
  if (base.includes(cod)) return escapar(base);
  return escapar(`${cod} · ${base}`);
}

// ------------------------------------------------- ficha do jogador e multi-contas

const quando = (v) => (v ? new Date(v).toLocaleString('pt-BR') : '—');

/** `70000` → `Bronze Boss Token`, e o resto da bolsa legível. Ver `admin.fichaDeJogador`. */
function tabelaBolsa(bolsa) {
  if (!bolsa?.length) return '<p class="adm-legenda">bolsa vazia</p>';
  return `<table class="adm-tabela">
    <tr><th>item</th><th>id</th><th style="text-align:right">qtd</th><th>categoria</th></tr>
    ${bolsa.map((i) => `<tr>
      <td><b>${escapar(i.nome)}</b></td>
      <td class="n">${i.itemId}</td>
      <td class="n">${num(i.qtd)}</td>
      <td>${escapar(i.categoria ?? '—')}</td>
    </tr>`).join('')}
  </table>`;
}

function tabelaPokemons(pk) {
  if (!pk?.lista?.length) return '<p class="adm-legenda">nenhum pokémon</p>';
  return `<table class="adm-tabela">
    <tr><th>#</th><th>espécie</th><th style="text-align:right">nível</th><th style="text-align:right">poder</th><th>marcas</th></tr>
    ${pk.lista.map((p) => `<tr>
      <td class="n">${p.id}</td>
      <td><b>${escapar(p.nome)}</b></td>
      <td class="n">${num(p.level)}</td>
      <td class="n">${num(p.poder)}</td>
      <td>${p.shiny ? '<span class="adm-badge adm-badge-jogo">shiny</span> ' : ''}${
        p.potencia > 1 ? `<span class="adm-badge">P${p.potencia}</span> ` : ''
      }${p.anuncioId ? `<span class="adm-badge adm-badge-ban-soft">no anúncio #${p.anuncioId}</span>` : ''}</td>
    </tr>`).join('')}
  </table>
  ${pk.total > pk.lista.length ? `<p class="adm-legenda">mostrando ${pk.lista.length} de ${num(pk.total)}</p>` : ''}`;
}

/**
 * Os anúncios do jogador — e a coluna que mais importa aqui é o ESTADO.
 *
 * Um anúncio `aberto` guarda o item/pokémon em escrow: ele saiu da bolsa e ainda não foi
 * vendido. É o lugar onde "sumiu um item" costuma estar, e é a primeira coisa a checar antes
 * de acreditar em perda de item.
 */
function tabelaAnuncios(lista) {
  if (!lista?.length) return '<p class="adm-legenda">nunca anunciou nada</p>';
  return `<table class="adm-tabela">
    <tr><th>#</th><th>o quê</th><th style="text-align:right">qtd</th><th style="text-align:right">preço</th><th>estado</th><th>criado</th><th>fechado</th><th>comprador</th></tr>
    ${lista.map((a) => `<tr>
      <td class="n">${a.id}</td>
      <td><b>${escapar(a.nome ?? a.tipo)}</b> <span class="adm-legenda">${escapar(a.tipo)}</span></td>
      <td class="n">${num(a.qtd)}</td>
      <td class="n">${num(a.preco)} ${escapar(a.moeda ?? '')}</td>
      <td>${a.estado === 'aberto'
        ? '<span class="adm-badge adm-badge-ban-soft">aberto (em escrow)</span>'
        : `<span class="adm-badge">${escapar(a.estado)}</span>`}</td>
      <td>${quando(a.criadoEm)}</td>
      <td>${quando(a.fechadoEm)}</td>
      <td>${escapar(a.comprador ?? '—')}</td>
    </tr>`).join('')}
  </table>
  <p class="adm-legenda">Numa venda parcial o <b>qtd</b> da linha é o que sobrou, não o que foi anunciado — quanto entrou em escrow está no log, na aba Auditoria.</p>`;
}

/**
 * A coluna "outras contas" de uma origem da ficha.
 *
 * Conta e apagada aparecem separadas porque respondem a perguntas diferentes: quantas contas
 * dividem esta máquina HOJE, e quantas já foram embora dela. Somadas num número só, a faxina
 * do moderador não mudava nada na tela e o número deixava de valer.
 */
function vizinhancaOrigem(o) {
  const parte = (vivas, apagadas, onde) => {
    if (vivas <= 1 && !apagadas) return null;
    const extra = apagadas ? ` <span class="adm-mc-nick apagado">+${num(apagadas)} apagada${apagadas > 1 ? 's' : ''}</span>` : '';
    return `${num(vivas)} ${onde}${extra}`;
  };
  const partes = [
    parte(o.contasNoIp, o.apagadasNoIp ?? 0, 'no IP'),
    parte(o.contasNoDispositivo, o.apagadasNoDispositivo ?? 0, 'no aparelho'),
  ].filter(Boolean);
  return partes.length ? partes.join(' · ') : '—';
}

function tabelaOrigens(origens) {
  if (!origens?.length) {
    return '<p class="adm-legenda">nenhuma origem carimbada ainda — só entra quem cria conta ou entra a partir desta versão</p>';
  }
  return `<table class="adm-tabela">
    <tr><th>IP</th><th>bloco</th><th>dispositivo</th><th>1ª vez</th><th>última</th><th style="text-align:right">vezes</th><th>outras contas</th></tr>
    ${origens.map((o) => `<tr>
      <td>${escapar(o.ip ?? '—')}${o.evento === 'criar' ? ' <span class="adm-badge adm-badge-jogo">criou aqui</span>' : ''}</td>
      <td>${escapar(o.ipBucket ?? '—')}</td>
      <td>${escapar(o.dispositivo ?? '—')}</td>
      <td>${quando(o.primeiroEm)}</td>
      <td>${quando(o.ultimoEm)}</td>
      <td class="n">${num(o.vezes)}</td>
      <td class="n">${vizinhancaOrigem(o)}</td>
    </tr>`).join('')}
  </table>`;
}

function secaoFicha(cache) {
  const d = cache.dados;
  const busca = `<div class="adm-busca">
      <div class="adm-campo">
        <label for="adm-ficha-nick">nick</label>
        <input id="adm-ficha-nick" type="text" value="${escapar(cache.nick ?? '')}" placeholder="NickDoJogador">
      </div>
      <button class="adm-botao neutro" id="adm-ficha-buscar">Abrir ficha</button>
    </div>`;

  if (!d) {
    return `<section class="adm-secao">
      <h2>Ficha do jogador</h2>
      <p class="adm-legenda">Tudo o que o servidor sabe sobre um personagem, em leitura: carteira, bolsa item a item, depot, anúncios no Mercado (inclusive o que está preso em escrow), origens de acesso e o log recente. Nenhum botão daqui mexe em nada — para agir, use Usuários ou Resolver Auditoria.</p>
      ${busca}
    </section>`;
  }

  const j = d.jogador ?? {};
  const c = d.conta;
  const vip = j.vipAte > Date.now();

  return `<section class="adm-secao">
    <h2>Ficha de ${escapar(j.nick ?? cache.nick)}</h2>
    ${busca}
    <div class="adm-blocos" style="margin-bottom:12px">
      ${bloco('nível', num(j.level), `${num(j.xp)} xp`)}
      ${bloco('coins', num(j.gold))}
      ${bloco('diamantes', num(j.diamonds))}
      ${bloco('gemas', num(j.orbs))}
      ${bloco('pokémon', num(d.pokemons?.total ?? 0), `${num(d.bolsa?.length ?? 0)} tipos na bolsa`)}
      ${bloco('estado', j.online ? 'online' : 'offline', `visto ${quando(j.lastSeen)}`)}
      ${bloco('hunt', j.huntSlug ?? '—', `Outland ${j.outlandTier}`)}
      ${bloco('VIP', vip ? 'ativo' : 'não', vip ? `até ${quando(j.vipAte)}` : '')}
      ${bloco('boss', num(j.bossPoints), 'pontos')}
      ${bloco('elo PvP', num(j.elo), `${num(j.pvp?.abates ?? 0)}V / ${num(j.pvp?.mortes ?? 0)}D`)}
    </div>
    <p class="adm-legenda">
      Conta: <b>${c?.emailOculto ? 'e-mail oculto para este cargo' : escapar(c?.email ?? 'sem conta ligada')}</b> · provedor ${escapar(c?.provedor ?? '—')}
      · criada ${quando(c?.criadoEm ?? j.criadoEm)} · último login ${quando(c?.ultimoLogin)}
      ${c?.emailCanon ? ` · caixa <b>${escapar(c.emailCanon)}</b>` : ''}
      ${c?.banido ? ` · <span class="adm-badge adm-badge-ban">banido (${escapar(c.banMotivo ?? '')})</span>` : ''}
    </p>

    <h3>Bolsa</h3>
    ${tabelaBolsa(d.bolsa)}
    ${d.bolas?.length ? `<h3>Bolas</h3><p class="adm-legenda">${d.bolas.map((b) => `${escapar(b.nome)} ×${num(b.qtd)}`).join(' · ')}</p>` : ''}

    <h3>Anúncios no Mercado</h3>
    ${tabelaAnuncios(d.anuncios)}

    <h3>Pokémon</h3>
    ${tabelaPokemons(d.pokemons)}

    ${d.origensOcultas
      ? '<h3>Origens de acesso</h3><p class="adm-legenda">IP e aparelho não aparecem para o cargo Resolver Auditoria — são dado pessoal e não fazem falta para resolver um ticket.</p>'
      : `<h3>Origens de acesso</h3>${tabelaOrigens(d.origens)}`}

    <h3>Últimos movimentos</h3>
    ${d.log?.length
      ? `<table class="adm-tabela">
          <tr><th>quando</th><th>o quê</th><th>detalhe</th></tr>
          ${d.log.map((l) => `<tr>
            <td>${quando(l.em)}</td>
            <td><span class="adm-badge">${escapar(l.categoria)}·${escapar(l.acao)}</span></td>
            <td>${escapar(l.detalhe ?? '')}</td>
          </tr>`).join('')}
        </table>`
      : '<p class="adm-legenda">nada no log recente</p>'}
  </section>`;
}

function ligarFicha() {
  const buscar = async () => {
    const nick = $('#adm-ficha-nick').value.trim();
    if (!nick) return;
    fichaCache = { nick, dados: null };
    try {
      fichaCache.dados = await pedir('usuarios/ficha', { nick });
    } catch (err) {
      $('#adm-corpo').innerHTML = `<div class="adm-erro">${escapar(err.message)}</div>`;
      return;
    }
    $('#adm-corpo').innerHTML = secaoFicha(fichaCache);
    ligarFicha();
  };
  $('#adm-ficha-buscar')?.addEventListener('click', buscar);
  $('#adm-ficha-nick')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') buscar(); });
}

/**
 * As origens com mais de uma conta.
 *
 * O aviso do topo não é decoração: esta tela mostra COINCIDÊNCIA, não fraude. Uma casa com dois
 * irmãos, uma república, uma lan house e um provedor de bairro com CGNAT produzem exatamente o
 * mesmo desenho que uma fazenda de contas — e o IPv4 de operadora móvel junta milhares de
 * assinantes num endereço só. Número alto por IP quase sempre é rede compartilhada; é a coluna
 * por DISPOSITIVO que merece o olhar, porque ali é o mesmo navegador.
 */
// ------------------------------------------------------------------ guilds
//
// Moderação de NOME de guild. O nome é texto de jogador que vai para o ranking, para o placar
// da guerra e para o chat — e quando ele é racista, o que resolve é apagar, não conversar.
//
// A lista vem da mais NOVA para a mais velha de propósito: nome ofensivo aparece logo depois
// de ser criado, e é nesse pedaço da lista que a moderação passa o olho.

function secaoGuilds(cache) {
  const linhas = cache.guilds?.length
    ? cache.guilds.map((g) => `<tr>
        <td><b>${escapar(g.nome)}</b></td>
        <td>${escapar(g.ownerNick ?? '—')}</td>
        <td class="n">${num(g.membros)}</td>
        <td class="n">${num(g.gp)}</td>
        <td class="n">${num(g.gpGlobal)}</td>
        <td>${g.criadoEm ? new Date(g.criadoEm).toLocaleString('pt-BR', { timeZone: FUSO_BR }) : '—'}</td>
        <td><button class="adm-botao-mini perigo" data-guild-apagar="${g.id}" data-nome="${escapar(g.nome)}">Apagar</button></td>
      </tr>`).join('')
    : `<tr><td colspan="7">${cache.busca ? 'nenhuma guild com esse nome' : 'nenhuma guild ainda'}</td></tr>`;

  return `<section class="adm-secao">
    <h2>Guilds</h2>
    <p class="adm-legenda">
      Apagar é <b>imediato e definitivo</b>: os membros saem na hora (quem está online perde o
      painel e o bônus da guild no mesmo segundo), os GP somem e a guild sai dos eventos de PvP
      de Guild. O nome também é <b>trocado por "Guild removida"</b> no placar das guerras, nos
      replays e no pódio mensal — que é onde ele continuaria aparecendo depois de apagada.
      O histórico da guerra em si (posição, GP, abates) fica de pé.
      <b>Não apaga conta nem pokémon de ninguém</b>: para punir o dono, use Usuários.
    </p>
    <div class="adm-busca">
      <div class="adm-campo">
        <label for="adm-guild-busca">procurar por nome</label>
        <input id="adm-guild-busca" type="text" value="${escapar(cache.busca ?? '')}" placeholder="trecho do nome">
      </div>
      <button class="adm-botao neutro" id="adm-guild-buscar">Procurar</button>
    </div>
    <table class="adm-tabela">
      <tr><th>nome</th><th>dono</th><th style="text-align:right">membros</th>
          <th style="text-align:right">GP</th><th style="text-align:right">GP global</th>
          <th>criada</th><th>ação</th></tr>
      ${linhas}
    </table>
    <p class="adm-aviso" id="adm-guild-msg">${cache.guilds?.length ? `${num(cache.guilds.length)} guild(s) na lista, da mais nova para a mais velha.` : ''}</p>
  </section>`;
}

function ligarGuilds() {
  const msg = $('#adm-guild-msg');
  const buscar = async () => {
    guildsCache.busca = $('#adm-guild-busca').value.trim();
    await renderSecao();
  };
  $('#adm-guild-buscar')?.addEventListener('click', buscar);
  $('#adm-guild-busca')?.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') buscar();
  });

  // Dois cliques, como no crédito de diamantes e no evento global: apagar não tem volta, e o
  // botão fica na mesma linha de uma tabela que se percorre com o dedo no mouse.
  for (const btn of document.querySelectorAll('[data-guild-apagar]')) {
    let confirmando = false;
    btn.addEventListener('click', async () => {
      const id = Number(btn.dataset.guildApagar);
      const nome = btn.dataset.nome ?? '';
      if (!confirmando) {
        confirmando = true;
        btn.textContent = 'Confirmar';
        btn.classList.add('confirmar');
        msg.className = 'adm-aviso ruim';
        msg.textContent = `Apagar "${nome}" de vez, com os membros e os GP. Clique de novo para confirmar.`;
        setTimeout(() => {
          if (!confirmando) return;
          confirmando = false;
          btn.textContent = 'Apagar';
          btn.classList.remove('confirmar');
        }, 15_000);
        return;
      }
      btn.disabled = true;
      try {
        const r = await pedir('guilds/apagar', { id });
        await renderSecao();
        const novo = $('#adm-guild-msg');
        if (novo) {
          novo.className = 'adm-aviso bom';
          novo.textContent =
            `"${r.apagada.nome}" apagada · ${r.apagada.membros.length} membro(s) liberado(s)` +
            `${r.apagada.ownerNick ? ` · era de ${r.apagada.ownerNick}` : ''}.`;
        }
      } catch (err) {
        msg.className = 'adm-aviso ruim';
        msg.textContent = err.message;
        btn.disabled = false;
        confirmando = false;
        btn.textContent = 'Apagar';
        btn.classList.remove('confirmar');
      }
    });
  }
}

/** O que vai no corpo do pedido — um lugar só, usado pelo botão e pela entrada na seção. */
const filtroMulticontas = () => ({
  minimo: multicontasCache.minimo,
  nicks: multicontasCache.nicks,
  incluirApagadas: multicontasCache.incluirApagadas,
  nick: multicontasCache.nick || undefined,
});

/**
 * Os nicks de um estado (de pé, banido ou apagado), já como botões de ficha.
 *
 * O apagado NÃO vira botão: não há ficha para abrir, e um botão que erra ao ser clicado é
 * pior do que um rótulo. Ele fica riscado, que é como se lê "isto não existe mais".
 *
 * `total` é a contagem de VERDADE do grupo; a lista vem cortada pelo servidor. Quando sobra
 * gente de fora o rodapé diz quantos — um corte silencioso aqui viraria "só tinha 60".
 */
const nicksDoGrupo = (lista, total, classe, destaque = '') => {
  if (!total) return '';
  // O nick buscado ganha contorno dentro do grupo — é o "você está aqui" da busca por nick.
  const alvo = (n) => (destaque && String(n).toLowerCase() === destaque.toLowerCase() ? ' adm-mc-alvo' : '');
  const botoes = (lista ?? []).map((n) => (classe === 'apagado'
    ? `<span class="adm-mc-nick apagado${alvo(n)}">${escapar(n)}</span>`
    : `<button class="adm-botao-mini${classe ? ` ${classe}` : ''}${alvo(n)}" data-ficha="${escapar(n)}">${escapar(n)}</button>`));
  const sobra = total - (lista?.length ?? 0);
  if (sobra > 0) botoes.push(`<span class="adm-mc-nick">+${num(sobra)} não listados</span>`);
  return `<div class="adm-mc-grupo">${botoes.join(' ')}</div>`;
};

/**
 * O resumo da busca por nick: com quem ESTE jogador divide aparelho ou IP.
 *
 * As tabelas abaixo continuam sendo a verdade — aqui só se juntam os nicks delas, sem repetição,
 * para responder de uma vez "quais são as outras contas dele?".
 */
function blocoAlvo(d) {
  if (!d?.alvo) return '';
  const eu = String(d.alvo.nick).toLowerCase();
  const linhas = [...(d.porDispositivo ?? []), ...(d.porIp ?? [])];
  const juntar = (campo) => [...new Set(linhas.flatMap((l) => l[campo] ?? []))]
    .filter((n) => String(n).toLowerCase() !== eu);
  const vivas = juntar('nicks');
  const banidas = juntar('nicksBanidos');
  const apagadas = juntar('nicksApagados');
  const total = vivas.length + banidas.length + apagadas.length;
  return `<div class="adm-mc-teto">
    <h3>Contas ligadas a ${escapar(d.alvo.nick)}</h3>
    <p class="adm-legenda">
      ${total ? `<b>${num(total)}</b> outra(s) conta(s)` : 'Nenhuma outra conta'} em
      <b>${num(linhas.length)}</b> origem(ns) que ele usou (aparelho e IP). Como no resto desta seção,
      dividir origem <b>não é prova</b> de multi-conta.
    </p>
    ${nicksDoGrupo(vivas, vivas.length, '')}
    ${nicksDoGrupo(banidas, banidas.length, 'perigo')}
    ${nicksDoGrupo(apagadas, apagadas.length, 'apagado')}
  </div>`;
}

function secaoMulticontas(cache) {
  const d = cache.dados;
  const r = d?.resumo;
  const limite = d?.limitePorIp ?? cache.teto?.limite ?? 4;
  const alvoNick = d?.alvo?.nick ?? '';

  // As duas ações de linha. A faxina existe nas duas tabelas — o aparelho é a coluna com mais
  // sinal, e travar a faxina no IP obrigaria a caçar o IP do grupo à mão. A ISENÇÃO é só do
  // IP: o teto de cadastro é por rede, e isentar um aparelho não significaria nada.
  const acoes = (l, tipo) => {
    const sobra = l.contas - limite;
    const faxina = sobra > 0
      ? `<button class="adm-botao-mini perigo" data-faxina-tipo="${tipo}" data-faxina-chave="${escapar(l.chave)}">Faxina (−${num(sobra)})</button>`
      : '<span class="adm-mc-nick">dentro do limite</span>';
    if (tipo !== 'ip') return faxina;
    const whitelist = l.liberado
      ? `<button class="adm-botao-mini" data-travar-ip="${escapar(l.chave)}">Tirar da whitelist</button>`
      : `<button class="adm-botao-mini adm-ok" data-liberar-ip="${escapar(l.chave)}">+ Whitelist</button>`;
    return `${faxina} ${whitelist} <button class="adm-botao-mini perigo" data-banir-ip="${escapar(l.chave)}">Banir IP</button>`;
  };

  const tabela = (lista, rotuloChave, tipo) => (lista?.length
    ? `<table class="adm-tabela">
        <tr><th>${rotuloChave}</th><th style="text-align:right">de pé</th><th style="text-align:right">banidas</th><th style="text-align:right">apagadas</th><th style="text-align:right">nascidas aqui</th><th>nicks</th><th>1ª vez</th><th>última</th><th>ação</th></tr>
        ${lista.map((l) => `<tr${l.liberado ? ' class="adm-mc-isento"' : ''}>
          <td><b>${escapar(l.chave)}</b>${l.liberado ? ' <span class="adm-badge adm-badge-ok">whitelist</span>' : ''}</td>
          <td class="n"><b>${num(l.contas)}</b></td>
          <td class="n">${l.banidas ? num(l.banidas) : '—'}</td>
          <td class="n">${l.apagadas ? num(l.apagadas) : '—'}</td>
          <td class="n"${l.nascidas >= limite && tipo === 'ip' ? ' style="color:#ffb3a0"' : ''}>${num(l.nascidas)}</td>
          <td>
            ${nicksDoGrupo(l.nicks, l.contas, '', alvoNick)}
            ${nicksDoGrupo(l.nicksBanidos, l.banidas, 'perigo', alvoNick)}
            ${nicksDoGrupo(l.nicksApagados, l.apagadas, 'apagado', alvoNick)}
          </td>
          <td>${quando(l.de)}</td>
          <td>${quando(l.ate)}</td>
          <td>${acoes(l, tipo)}</td>
        </tr>`).join('')}
      </table>`
    : '<p class="adm-legenda">nenhuma origem com esse tanto de conta</p>');

  return `<section class="adm-secao">
    <h2>Multi-contas por origem</h2>
    <p class="adm-legenda">
      <b>Uma linha não é prova de fraude:</b> família, república, lan house e provedor com CGNAT
      dão o mesmo desenho que uma fazenda de contas. O IP mede a saída da rede; o
      <b>dispositivo</b> é que mede o navegador, e é a coluna com mais sinal. Antes de clicar em
      <b>Faxina</b>, olhe as duas.
    </p>
    <p class="adm-legenda">
      As contagens são de <b>agora</b>: <b>de pé</b> são as contas que existem e não estão
      banidas. Apagar uma conta derruba a contagem dela aqui, mas <b>não apaga o carimbo de
      origem</b>: ele vira a coluna <b>apagadas</b>, para que excluir e recriar não zere o
      histórico da máquina. <b>Nascidas aqui</b> é a contagem que o <b>teto de cadastro</b>
      cobra — contas que existem hoje e que foram CRIADAS nesta origem, banidas incluídas.
    </p>
    ${r ? `<div class="adm-blocos" style="margin-bottom:12px">
      ${bloco('pares carimbados', num(r.linhas))}
      ${bloco('contas vistas', num(r.contas))}
      ${bloco('já apagadas', num(r.apagadas ?? 0))}
      ${bloco('IPs distintos', num(r.ips))}
      ${bloco('aparelhos distintos', num(r.dispositivos))}
      ${bloco('medindo desde', r.desde ? new Date(r.desde).toLocaleDateString('pt-BR') : '—')}
    </div>` : ''}
    ${blocoBanDeIp(cache)}
    ${blocoTetoPorIp(cache.teto, limite)}
    <div class="adm-busca">
      <div class="adm-campo" style="max-width:220px">
        <label for="adm-mc-min">a partir de quantas contas</label>
        <input id="adm-mc-min" type="number" min="2" max="50" value="${cache.minimo}">
      </div>
      <div class="adm-campo" style="max-width:200px">
        <label for="adm-mc-nicks">nicks por lista</label>
        <input id="adm-mc-nicks" type="number" min="1" max="300" value="${cache.nicks}">
      </div>
      <div class="adm-campo" style="max-width:260px">
        <label for="adm-mc-apagadas">contar também as apagadas</label>
        <select id="adm-mc-apagadas">
          <option value=""${cache.incluirApagadas ? '' : ' selected'}>não — só quem existe hoje</option>
          <option value="1"${cache.incluirApagadas ? ' selected' : ''}>sim — inclui o histórico</option>
        </select>
      </div>
      <div class="adm-campo" style="max-width:260px">
        <label for="adm-mc-nick">nick do jogador — todas as contas dele</label>
        <input id="adm-mc-nick" type="text" maxlength="64" autocomplete="off" placeholder="vazio = todas as origens" value="${escapar(cache.nick)}">
      </div>
      <button class="adm-botao neutro" id="adm-mc-buscar">${cache.nick ? 'Buscar' : 'Recarregar'}</button>
      ${cache.nick ? '<button class="adm-botao neutro" id="adm-mc-limpar-nick">Limpar nick</button>' : ''}
    </div>
    ${cache.erroBusca ? `<p class="adm-aviso ruim">${escapar(cache.erroBusca)}</p>` : ''}
    ${blocoAlvo(d)}
    ${blocoFaxina(cache)}
    ${blocoFaxinaGeral(cache)}
    <h3>Por aparelho (mesmo navegador)</h3>
    ${tabela(d?.porDispositivo, 'dispositivo', 'dispositivo')}
    <div class="adm-mc-geral">
      <h3>Por IP (ou bloco /64 no IPv6)</h3>
      <button class="adm-botao perigo" id="adm-mc-geral">Faxina Geral</button>
    </div>
    <p class="adm-legenda">
      A <b>Faxina Geral</b> faz, de uma vez, a faxina de <b>todos</b> os IPs com mais de
      <b>${num(limite)}</b> contas de pé que <b>não</b> estão na whitelist — a mesma de cada linha:
      ban soft no excedente e a carteira dele para a conta principal do IP. O primeiro clique só
      monta a prévia.
    </p>
    ${tabela(d?.porIp, 'origem', 'ip')}
  </section>`;
}

/** As durações do ban de IP. `0` é sem prazo. */
const HORAS_BAN_IP = [[0, 'para sempre'], [24, '24 horas'], [24 * 7, '7 dias'], [24 * 30, '30 dias']];

/** Acima disto, a prévia avisa que muita gente DIFERENTE já entrou por aquele IP. */
const VISTAS_REDE_COMPARTILHADA = 15;

/**
 * O BANIMENTO DE IP: formulário, prévia, resultado e a lista dos banidos.
 *
 * Como a faxina, o primeiro clique só pede a PRÉVIA. É nela que o moderador vê o custo de banir
 * uma rede — quantas contas nasceram ali, quantas pessoas já entraram por ali, quantas estão
 * jogando agora, se o IP está na whitelist —, e só dela sai o botão que bane.
 */
function blocoBanDeIp(cache) {
  const b = cache.banIp;
  const p = b.previa;
  const r = b.resultado;

  const opcoesHoras = HORAS_BAN_IP
    .map(([h, rotulo]) => `<option value="${h}"${Number(b.horas) === h ? ' selected' : ''}>${rotulo}</option>`)
    .join('');

  let previa = '';
  if (p) {
    const nicks = p.nascidas.slice(0, 60).map((c) => c.nick);
    const avisos = [
      p.ehMeuIp ? '<p class="adm-aviso ruim"><b>Esse é o IP de onde você está usando o painel.</b> Banir trancaria você fora do jogo — o servidor recusa.</p>' : '',
      p.liberado ? '<p class="adm-aviso ruim">Este IP está na <b>whitelist</b> — alguém já o marcou como rede compartilhada (CGNAT, lan house, família). Banir tranca <b>todo mundo</b> que sai por ele.</p>' : '',
      p.vistas >= VISTAS_REDE_COMPARTILHADA ? `<p class="adm-aviso">${num(p.vistas)} contas diferentes já entraram por aqui. Pode ser uma fazenda — ou uma rede compartilhada. Olhe os nicks antes.</p>` : '',
      p.jaBanido ? `<p class="adm-aviso">Já está banido${p.jaBanido.expiraEm ? ` até ${quando(p.jaBanido.expiraEm)}` : ' (sem prazo)'}. Banir de novo troca o motivo e o prazo.</p>` : '',
    ].join('');
    const marcarContas = p.nascidas.length > (p.limitePorIp ?? 4);
    previa = `<div class="adm-mc-plano">
      <h3>Prévia — ${escapar(p.ipBucket)}</h3>
      <div class="adm-blocos" style="margin-bottom:10px">
        ${bloco('contas criadas aqui (de pé)', num(p.nascidas.length))}
        ${bloco('contas que já entraram por aqui', num(p.vistas))}
        ${bloco('on-line agora', num(p.onlineAgora))}
      </div>
      ${avisos}
      <p class="adm-legenda">Ao banir: o site, o cadastro, o login e o jogo param de responder para esta rede, e
        ${p.onlineAgora ? `as <b>${num(p.onlineAgora)}</b> conta(s) on-line caem <b>na hora</b>` : 'quem estiver conectado cai na hora'}.
        O painel continua abrindo.</p>
      ${p.nascidas.length ? `
        <label class="adm-linha" style="gap:8px;align-items:center;margin:8px 0">
          <input type="checkbox" id="adm-ipban-contas"${marcarContas ? ' checked' : ''}>
          <span>Também dar <b>ban soft</b> nas <b>${num(p.nascidas.length)}</b> conta(s) criadas neste IP
            (login bloqueado de qualquer rede, progresso intacto — desbanir pela ficha devolve tudo)</span>
        </label>
        ${nicksDoGrupo(nicks, p.nascidas.length, '')}` : '<p class="adm-legenda">Nenhuma conta de pé nasceu neste IP.</p>'}
      <div class="adm-linha" style="margin-top:10px">
        ${p.ehMeuIp ? '' : '<button class="adm-botao perigo" id="adm-ipban-aplicar">Banir IP</button>'}
        <button class="adm-botao neutro" id="adm-ipban-cancelar">Cancelar</button>
      </div>
      <p class="adm-aviso" id="adm-ipban-msg"></p>
    </div>`;
  }

  const resultado = r ? `<div class="adm-mc-plano bom">
      <h3>IP banido — ${escapar(r.ipBucket)}</h3>
      <p class="adm-legenda">${r.expiraEm ? `Até <b>${quando(r.expiraEm)}</b>.` : '<b>Sem prazo.</b>'}
        Motivo: <b>${escapar(r.motivo)}</b>.
        ${r.contasBanidas.length ? `<b>${num(r.contasBanidas.length)}</b> conta(s) com ban soft.` : 'Nenhuma conta banida junto.'}</p>
      ${r.falhas.length ? `<p class="adm-aviso ruim">${r.falhas.map((f) => `${escapar(f.nick)}: ${escapar(f.erro)}`).join(' · ')}</p>` : ''}
      <button class="adm-botao neutro" id="adm-ipban-fechar">Fechar</button>
    </div>` : '';

  const lista = cache.banidos?.length
    ? `<table class="adm-tabela">
        <tr><th>IP banido</th><th>motivo</th><th style="text-align:right">nascidas</th><th style="text-align:right">requisições barradas</th><th>última barrada</th><th>por</th><th>desde</th><th>até</th><th>ação</th></tr>
        ${cache.banidos.map((l) => `<tr${l.vencido ? ' class="adm-mc-isento"' : ''}>
          <td><b>${escapar(l.ipBucket)}</b>${l.vencido ? ' <span class="adm-badge">vencido</span>' : ''}</td>
          <td>${escapar(l.motivo ?? '—')}</td>
          <td class="n">${num(l.nascidas)}</td>
          <td class="n">${num(l.bloqueios)}</td>
          <td>${quando(l.ultimoBloqueioEm)}</td>
          <td>${escapar(l.porEmail ?? '—')}</td>
          <td>${quando(l.criadoEm)}</td>
          <td>${l.expiraEm ? quando(l.expiraEm) : 'sem prazo'}</td>
          <td><button class="adm-botao-mini" data-desbanir-ip="${escapar(l.ipBucket)}">${l.vencido ? 'Remover' : 'Desbanir'}</button></td>
        </tr>`).join('')}
      </table>`
    : '<p class="adm-legenda">nenhum IP banido</p>';

  return `<div class="adm-mc-teto" id="adm-ipban">
    <h3>Banimento de IP</h3>
    <p class="adm-legenda">
      Barra <b>tudo</b> que chega pela rede: o site, o <b>cadastro</b>, o <b>login</b> (senha, Google e
      Discord) e o <b>jogo</b> — quem estiver conectado por ela cai na hora. No IPv4 vale o endereço; no
      IPv6, o bloco <b>/64</b> inteiro (o aparelho troca de endereço dentro dele sozinho). Aceita um IP
      qualquer ou a chave que as tabelas abaixo mostram.
    </p>
    <p class="adm-legenda">
      <b>Um IP não é uma pessoa:</b> operadora móvel (CGNAT), escola e lan house põem muita gente atrás
      do mesmo endereço, e IPv4 residencial muda de dono. Confira a prévia, e prefira um <b>prazo</b>
      quando não tiver certeza.
    </p>
    <div class="adm-busca">
      <div class="adm-campo" style="max-width:280px">
        <label for="adm-ipban-ip">IP ou bloco /64</label>
        <input id="adm-ipban-ip" type="text" maxlength="64" autocomplete="off" placeholder="1.2.3.4 ou 2804:…" value="${escapar(b.ip)}">
      </div>
      <div class="adm-campo" style="max-width:320px">
        <label for="adm-ipban-motivo">motivo (fica no registro)</label>
        <input id="adm-ipban-motivo" type="text" maxlength="300" autocomplete="off" placeholder="Criação de contas em massa" value="${escapar(b.motivo)}">
      </div>
      <div class="adm-campo" style="max-width:160px">
        <label for="adm-ipban-horas">duração</label>
        <select id="adm-ipban-horas">${opcoesHoras}</select>
      </div>
      <button class="adm-botao perigo" id="adm-ipban-previa">Ver prévia</button>
    </div>
    ${b.msg ? `<p class="adm-aviso ${escapar(b.msg.tom)}">${escapar(b.msg.texto)}</p>` : ''}
    ${previa}
    ${resultado}
    <h4>IPs banidos</h4>
    ${lista}
  </div>`;
}

/**
 * O teto de cadastro: quanto é, quem está isento e quem está batendo na trave.
 *
 * As RECUSAS são a metade importante deste bloco, e não um detalhe de telemetria. Um IP
 * doméstico bate na trave duas ou três vezes e para; um bloco de CGNAT de operadora recusa
 * dezenas de pessoas diferentes por semana, e é só olhando esta lista que se descobre isso —
 * o jogador legítimo que não consegue se cadastrar quase nunca escreve para o suporte, ele
 * simplesmente vai jogar outra coisa.
 */
function blocoTetoPorIp(teto, limite) {
  const online = teto?.limiteOnline ?? 4;
  const liberados = teto?.liberados?.length
    ? `<table class="adm-tabela">
        <tr><th>IP na whitelist</th><th style="text-align:right">nascidas</th><th style="text-align:right">on-line agora</th><th>nota</th><th>por</th><th>desde</th><th>ação</th></tr>
        ${teto.liberados.map((l) => `<tr>
          <td><b>${escapar(l.ipBucket)}</b></td>
          <td class="n">${num(l.nascidas)}</td>
          <td class="n">${num(l.onlineAgora ?? 0)}</td>
          <td>${escapar(l.nota ?? '—')}</td>
          <td>${escapar(l.porEmail ?? '—')}</td>
          <td>${quando(l.criadoEm)}</td>
          <td><button class="adm-botao-mini" data-travar-ip="${escapar(l.ipBucket)}">Tirar da whitelist</button></td>
        </tr>`).join('')}
      </table>`
    : '<p class="adm-legenda">whitelist vazia — os dois limites valem para todo mundo</p>';

  const recusas = teto?.recusas?.length
    ? `<table class="adm-tabela">
        <tr><th>IP</th><th style="text-align:right">recusas</th><th style="text-align:right">nascidas</th><th style="text-align:right">on-line agora</th><th>1ª vez</th><th>última</th><th>ação</th></tr>
        ${teto.recusas.map((l) => `<tr>
          <td><b>${escapar(l.ipBucket)}</b>${l.liberado ? ' <span class="adm-badge adm-badge-ok">whitelist</span>' : ''}</td>
          <td class="n"><b>${num(l.vezes)}</b></td>
          <td class="n">${num(l.nascidas)}</td>
          <td class="n">${num(l.onlineAgora ?? 0)}</td>
          <td>${quando(l.primeiroEm)}</td>
          <td>${quando(l.ultimoEm)}</td>
          <td>${l.liberado
            ? `<button class="adm-botao-mini" data-travar-ip="${escapar(l.ipBucket)}">Tirar da whitelist</button>`
            : `<button class="adm-botao-mini adm-ok" data-liberar-ip="${escapar(l.ipBucket)}">+ Whitelist</button>`}
            <button class="adm-botao-mini perigo" data-banir-ip="${escapar(l.ipBucket)}">Banir IP</button></td>
        </tr>`).join('')}
      </table>`
    : '<p class="adm-legenda">nenhum cadastro recusado até agora</p>';

  return `<div class="adm-mc-teto">
    <h3>Limites por rede — ${num(limite)} contas criadas, ${num(online)} on-line ao mesmo tempo</h3>
    <p class="adm-legenda">
      <b>Teto de cadastro:</b> a conta <b>${num(limite + 1)}ª</b> criada numa mesma saída de rede é
      recusada. Conta só quem <b>nasceu</b> ali e ainda existe (banida inclusive; apagada não),
      vale para o formulário e para o botão do Google/Discord, e <b>nunca bloqueia login</b>.
    </p>
    <p class="adm-legenda">
      <b>Teto de sessão:</b> a <b>${num(online + 1)}ª</b> conta a CONECTAR pela mesma rede é
      recusada com <b>"Esta rede já está com ${num(online)} contas conectadas"</b>. Este não olha
      onde a conta nasceu — é o que pega quem criou as contas em redes diferentes e roda todas
      na mesma máquina, em navegadores separados. Abas repetidas da <b>mesma</b> conta contam
      como uma; fechar o jogo devolve a vaga na hora.
    </p>
    <p class="adm-legenda">
      Se não der para ler o IP, os dois <b>deixam passar</b>: recusar um jogador por falha nossa
      é perda pura.
    </p>
    <h4>Whitelist — isenta dos DOIS limites</h4>
    <p class="adm-legenda">
      Para a casa com oito irmãos, a lan house, a república, o CGNAT da operadora. IP na
      whitelist cria e conecta <b>quantas contas quiser</b>. É uma lista só de propósito: liberar
      só um dos limites deixaria o jogador criar a conta e não conseguir entrar nela.
    </p>
    ${liberados}
    <h4>Batendo na trave</h4>
    <p class="adm-legenda">
      Muitas recusas no mesmo IP é sinal de <b>CGNAT ou lan house</b>, não de fazenda de contas —
      quem faz fazenda tenta uma vez e troca de rede. IP com recusa alta é candidato à whitelist,
      e a coluna <b>on-line agora</b> ajuda a decidir: oito contas jogando ao mesmo tempo é
      informação, não alegação.
    </p>
    ${recusas}
  </div>`;
}

/**
 * A PRÉVIA da faxina — e o único lugar onde ela é confirmada.
 *
 * Um `confirm()` do navegador não serviria aqui: a decisão depende de VER quem cai, quem fica,
 * quanto de moeda se move e para quem — e nada disso cabe numa caixinha de texto. Então o
 * clique na tabela não bane ninguém; ele pede o plano ao servidor e desenha isto. O segundo
 * clique, neste bloco, é o que executa.
 *
 * A lista desenhada volta ao servidor em `esperado`: se alguém subir de nível ou criar mais uma
 * conta entre a prévia e o clique, a ordem de força muda, o servidor recusa e ninguém é banido
 * por engano.
 */
function blocoFaxina(cache) {
  if (cache.resultado) {
    const r = cache.resultado;
    const linhas = r.banidos.map((b) => `<tr>
        <td>${escapar(b.nick)}</td>
        <td class="n">${num(b.level)}</td>
        <td class="n">${num(b.diamantes)}</td>
        <td class="n">${num(b.gemas)}</td>
      </tr>`).join('');
    return `<div class="adm-mc-plano bom">
      <h3>Faxina aplicada — ${escapar(r.tipo)} ${escapar(r.chave)}</h3>
      <p class="adm-legenda">
        <b>${num(r.banidos.length)}</b> conta(s) com ban soft. <b>${num(r.diamantes)}</b> 💎 e
        <b>${num(r.gemas)}</b> gema(s) foram para <b>${escapar(r.principal)}</b>.
        Ficaram de pé: ${r.mantidas.map((n) => escapar(n)).join(', ') || '—'}.
      </p>
      <p class="adm-legenda">motivo gravado no ban: <b>${escapar(r.motivo)}</b></p>
      ${linhas ? `<table class="adm-tabela">
        <tr><th>banida</th><th style="text-align:right">nível</th><th style="text-align:right">💎 devolvidos</th><th style="text-align:right">gemas devolvidas</th></tr>
        ${linhas}
      </table>` : ''}
      ${r.diamantesPresos ? `<p class="adm-aviso">${num(r.diamantesPresos)} 💎 estavam presos em anúncios abertos no Mercado e <b>não</b> foram transferidos — escrow não fica na carteira. Cancele os anúncios pela ficha se quiser recuperá-los.</p>` : ''}
      ${r.falhas.length ? `<p class="adm-aviso ruim">${r.falhas.map((f) => `${escapar(f.nick)}: ${escapar(f.erro)}`).join(' · ')}</p>` : ''}
      <button class="adm-botao neutro" id="adm-mc-fechar">Fechar</button>
    </div>`;
  }

  const plano = cache.plano;
  if (!plano) return cache.msg ? `<p class="adm-aviso ${escapar(cache.msg.tom)}">${escapar(cache.msg.texto)}</p>` : '';

  const linha = (c, marca) => `<tr>
      <td>${marca} <b>${escapar(c.nick)}</b></td>
      <td class="n">${num(c.level)}</td>
      <td class="n">${num(c.diamonds)}</td>
      <td class="n">${num(c.orbs)}</td>
      <td class="n">${num(c.gold)}</td>
      <td>${c.nasceuAqui ? 'nasceu aqui' : 'só entrou'}</td>
      <td>${quando(c.ultimoLogin)}</td>
    </tr>`;

  const nada = !plano.banir.length;
  return `<div class="adm-mc-plano">
    <h3>Prévia da faxina — ${escapar(plano.tipo)} ${escapar(plano.chave)}</h3>
    <p class="adm-legenda">
      Ficam as <b>${num(plano.manter)}</b> contas mais fortes (nível, depois 💎, depois gema,
      depois coin; a mais velha desempata). As demais levam <b>ban soft</b> — login bloqueado,
      progresso intacto — e a carteira delas vai para <b>${escapar(plano.principal?.nick ?? '—')}</b>.
    </p>
    ${nada ? '<p class="adm-aviso">Nada a fazer: este grupo já está dentro do limite.</p>' : `
      <p class="adm-aviso ruim">Vai banir <b>${num(plano.banir.length)}</b> conta(s) e mover
        <b>${num(plano.diamantes)}</b> 💎 + <b>${num(plano.gemas)}</b> gema(s).</p>
      <p class="adm-legenda">motivo que será gravado: <b>${escapar(plano.motivo ?? '')}</b></p>`}
    <table class="adm-tabela">
      <tr><th>conta</th><th style="text-align:right">nível</th><th style="text-align:right">💎</th><th style="text-align:right">gemas</th><th style="text-align:right">coins</th><th>origem</th><th>último login</th></tr>
      ${plano.mantidas.map((c, i) => linha(c, i === 0 ? '<span class="adm-mc-tag bom">recebe</span>' : '<span class="adm-mc-tag">fica</span>')).join('')}
      ${plano.banir.map((c) => linha(c, '<span class="adm-mc-tag ruim">ban soft</span>')).join('')}
      ${plano.jaBanidas.map((c) => linha(c, '<span class="adm-mc-tag">já banida</span>')).join('')}
      ${plano.protegidas.map((c) => linha(c, '<span class="adm-mc-tag">admin</span>')).join('')}
    </table>
    ${plano.diamantesPresos ? `<p class="adm-aviso">${num(plano.diamantesPresos)} 💎 das contas a banir estão presos em anúncios abertos no Mercado e <b>não</b> serão transferidos — escrow já saiu da carteira.</p>` : ''}
    ${plano.semDestino ? '<p class="adm-aviso ruim">A conta principal não tem personagem — não há para onde mandar a moeda. Nada será feito.</p>' : ''}
    ${plano.jaBanidas.length ? '<p class="adm-legenda">Contas já banidas não são tocadas: o motivo do ban original continua valendo.</p>' : ''}
    <div class="adm-linha" style="margin-top:10px">
      ${nada || plano.semDestino ? '' : '<button class="adm-botao perigo" id="adm-mc-aplicar">Confirmar faxina</button>'}
      <button class="adm-botao neutro" id="adm-mc-cancelar">Cancelar</button>
    </div>
    <p class="adm-aviso" id="adm-mc-plano-msg"></p>
  </div>`;
}

/**
 * A PRÉVIA e o RESULTADO da faxina geral.
 *
 * A prévia é a lista de IPs na ordem em que a faxina vai rodar, cada um com quem recebe, quem fica
 * e quem cai — já descontando quem caiu num IP anterior da mesma leva (a mesma conta costuma
 * aparecer em mais de um IP). A lista volta ao servidor no "Confirmar", e cada IP é conferido de
 * novo lá: o que mudou é pulado e aparece no resultado.
 */
function blocoFaxinaGeral(cache) {
  const r = cache.resultadoGeral;
  if (r) {
    const linhas = r.feitos.map((f) => `<tr>
        <td><b>${escapar(f.chave)}</b></td>
        <td>${escapar(f.principal)}</td>
        <td>${f.banidos.map((n) => escapar(n)).join(', ')}</td>
        <td class="n">${num(f.diamantes)}</td>
        <td class="n">${num(f.gemas)}</td>
      </tr>`).join('');
    return `<div class="adm-mc-plano bom">
      <h3>Faxina geral aplicada</h3>
      <p class="adm-legenda">
        <b>${num(r.banidos)}</b> conta(s) com ban soft em <b>${num(r.grupos)}</b> IP(s).
        <b>${num(r.diamantes)}</b> 💎 e <b>${num(r.gemas)}</b> gema(s) foram para as contas principais.
      </p>
      ${linhas ? `<div class="adm-mc-rolagem"><table class="adm-tabela">
        <tr><th>IP</th><th>recebeu</th><th>banidas</th><th style="text-align:right">💎</th><th style="text-align:right">gemas</th></tr>
        ${linhas}
      </table></div>` : ''}
      ${r.diamantesPresos ? `<p class="adm-aviso">${num(r.diamantesPresos)} 💎 estavam presos em anúncios abertos no Mercado e <b>não</b> foram transferidos.</p>` : ''}
      ${r.pulados.length ? `<p class="adm-aviso ruim"><b>${num(r.pulados.length)} IP(s) pulado(s):</b> ${r.pulados.map((p) => `${escapar(p.chave)} — ${escapar(p.erro)}`).join(' · ')}</p>` : ''}
      ${r.falhas.length ? `<p class="adm-aviso ruim">${r.falhas.map((f) => `${escapar(f.chave)} / ${escapar(f.nick)}: ${escapar(f.erro)}`).join(' · ')}</p>` : ''}
      <button class="adm-botao neutro" id="adm-mc-geral-fechar">Fechar</button>
    </div>`;
  }

  const p = cache.planoGeral;
  if (!p) return '';
  if (!p.grupos.length) {
    return `<div class="adm-mc-plano">
      <h3>Prévia da faxina geral</h3>
      <p class="adm-aviso">Nada a fazer: nenhum IP fora da whitelist passa de ${num(p.limite)} contas de pé.</p>
      <button class="adm-botao neutro" id="adm-mc-geral-cancelar">Fechar</button>
    </div>`;
  }
  const semDestino = p.grupos.filter((g) => g.semDestino);
  const validos = p.grupos.length - semDestino.length;
  const linhas = p.grupos.map((g) => `<tr${g.semDestino ? ' class="adm-mc-isento"' : ''}>
      <td><b>${escapar(g.chave)}</b></td>
      <td>${g.principal ? `<span class="adm-mc-tag bom">recebe</span> ${escapar(g.principal.nick)} <span class="adm-mc-nick">Nv ${num(g.principal.level)}</span>` : '—'}</td>
      <td>${g.mantidas.slice(1).map((n) => escapar(n)).join(', ') || '—'}</td>
      <td>${g.banir.map((c) => `<span class="adm-mc-tag ruim">ban soft</span> ${escapar(c.nick)} <span class="adm-mc-nick">Nv ${num(c.level)}</span>`).join('<br>')}</td>
      <td class="n">${num(g.diamantes)}</td>
      <td class="n">${num(g.gemas)}</td>
    </tr>`).join('');
  return `<div class="adm-mc-plano">
    <h3>Prévia da faxina geral — ${num(p.grupos.length)} IP(s)</h3>
    <p class="adm-legenda">
      Em cada IP ficam as <b>${num(p.limite)}</b> contas mais fortes (nível, depois 💎, gema e coin;
      a mais velha desempata); as demais levam <b>ban soft</b> — login bloqueado, progresso intacto —
      e a carteira delas vai para a primeira da lista (<b>recebe</b>). Contas já banidas e de admin não
      são tocadas. A ordem é a da execução: quem cai num IP já não conta nos seguintes.
    </p>
    <p class="adm-aviso ruim">Vai banir <b>${num(p.banir)}</b> conta(s) em <b>${num(validos)}</b> IP(s) e mover
      <b>${num(p.diamantes)}</b> 💎 + <b>${num(p.gemas)}</b> gema(s).</p>
    ${p.cortado ? `<p class="adm-aviso">Há mais IPs do que cabem numa leva (${num(p.maxGrupos)}). Depois desta, clique em <b>Faxina Geral</b> de novo para os que sobraram.</p>` : ''}
    ${semDestino.length ? `<p class="adm-aviso">${num(semDestino.length)} IP(s) sem conta principal com personagem (linhas apagadas) — serão pulados.</p>` : ''}
    ${p.diamantesPresos ? `<p class="adm-aviso">${num(p.diamantesPresos)} 💎 das contas a banir estão presos em anúncios abertos no Mercado e <b>não</b> serão transferidos.</p>` : ''}
    <div class="adm-mc-rolagem"><table class="adm-tabela">
      <tr><th>IP</th><th>conta principal</th><th>ficam também</th><th>caem</th><th style="text-align:right">💎</th><th style="text-align:right">gemas</th></tr>
      ${linhas}
    </table></div>
    <div class="adm-linha" style="margin-top:10px">
      ${validos ? `<button class="adm-botao perigo" id="adm-mc-geral-aplicar">Confirmar faxina geral (${num(p.banir)} conta(s))</button>` : ''}
      <button class="adm-botao neutro" id="adm-mc-geral-cancelar">Cancelar</button>
    </div>
    <p class="adm-aviso" id="adm-mc-geral-msg"></p>
  </div>`;
}

/** Recarrega a listagem E o estado do teto — as duas coisas que a seção mostra. */
async function carregarMulticontas() {
  const [dados, teto, bans] = await Promise.all([
    pedir('multicontas/listar', filtroMulticontas()),
    pedir('multicontas/teto', { limite: 40 }).catch(() => null),
    pedir('multicontas/ip-ban/listar', {}).catch(() => null),
  ]);
  multicontasCache.dados = dados;
  multicontasCache.teto = teto;
  multicontasCache.banidos = bans?.banidos ?? [];
}

/** Redesenha a seção inteira a partir do cache, e religa os botões. */
function redesenharMulticontas() {
  $('#adm-corpo').innerHTML = secaoMulticontas(multicontasCache);
  ligarMulticontas();
}

function ligarMulticontas() {
  const buscar = async () => {
    multicontasCache.minimo = Math.max(2, Number($('#adm-mc-min').value) || 2);
    multicontasCache.nicks = Math.min(300, Math.max(1, Number($('#adm-mc-nicks').value) || 60));
    multicontasCache.incluirApagadas = !!$('#adm-mc-apagadas').value;
    multicontasCache.nick = ($('#adm-mc-nick')?.value ?? '').trim();
    multicontasCache.erroBusca = null;
    try {
      await carregarMulticontas();
    } catch (err) {
      // Nick que não existe não derruba a seção: o erro aparece embaixo do formulário, que fica.
      if (!multicontasCache.nick) {
        $('#adm-corpo').innerHTML = `<div class="adm-erro">${escapar(err.message)}</div>`;
        return;
      }
      multicontasCache.dados = null;
      multicontasCache.erroBusca = err.message;
    }
    redesenharMulticontas();
  };
  $('#adm-mc-buscar')?.addEventListener('click', buscar);
  $('#adm-mc-nick')?.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') buscar();
  });
  $('#adm-mc-limpar-nick')?.addEventListener('click', () => {
    $('#adm-mc-nick').value = '';
    buscar();
  });

  // Clicar no nick da tabela abre a ficha daquele jogador — é o passo natural depois de ver um
  // aglomerado: "quem são essas seis contas?".
  for (const btn of document.querySelectorAll('[data-ficha]')) {
    btn.addEventListener('click', () => {
      fichaCache = { nick: btn.dataset.ficha ?? '', dados: null };
      irSecao('ficha');
    });
  }

  // ---- a faxina GERAL: o primeiro clique também só pede o plano
  $('#adm-mc-geral')?.addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    btn.disabled = true;
    btn.textContent = 'montando a prévia…';
    multicontasCache.plano = null;
    multicontasCache.resultado = null;
    multicontasCache.resultadoGeral = null;
    try {
      multicontasCache.planoGeral = await pedir('multicontas/plano-geral', {});
      multicontasCache.msg = null;
    } catch (err) {
      multicontasCache.planoGeral = null;
      multicontasCache.msg = { tom: 'ruim', texto: err.message };
    }
    redesenharMulticontas();
    $('.adm-mc-plano')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  $('#adm-mc-geral-cancelar')?.addEventListener('click', () => {
    multicontasCache.planoGeral = null;
    redesenharMulticontas();
  });

  $('#adm-mc-geral-fechar')?.addEventListener('click', () => {
    multicontasCache.resultadoGeral = null;
    redesenharMulticontas();
  });

  $('#adm-mc-geral-aplicar')?.addEventListener('click', async (ev) => {
    const p = multicontasCache.planoGeral;
    if (!p) return;
    const grupos = p.grupos.filter((g) => !g.semDestino);
    // A segunda trava, por cima da prévia: é a única ação do painel que bane dezenas de contas num
    // clique, e o número precisa ser lido em voz alta antes.
    if (!confirm(`Banir (soft) ${p.banir} conta(s) em ${grupos.length} IP(s) e mover a carteira delas?\n\nConfira a prévia antes de confirmar.`)) return;
    const botao = ev.currentTarget;
    const msg = $('#adm-mc-geral-msg');
    botao.disabled = true;
    botao.textContent = 'aplicando…';
    try {
      multicontasCache.resultadoGeral = await pedir('multicontas/faxina-geral', {
        esperado: grupos.map((g) => ({ chave: g.chave, banir: g.banir.map((c) => c.nick) })),
      });
      multicontasCache.planoGeral = null;
      await carregarMulticontas().catch(() => {});
      redesenharMulticontas();
      $('.adm-mc-plano')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      botao.disabled = false;
      botao.textContent = `Confirmar faxina geral (${p.banir} conta(s))`;
      if (msg) {
        msg.className = 'adm-aviso ruim';
        msg.textContent = err.message;
      }
    }
  });

  // ---- a faxina: primeiro clique pede o PLANO, nunca bane
  for (const btn of document.querySelectorAll('[data-faxina-chave]')) {
    btn.addEventListener('click', async () => {
      const tipo = btn.dataset.faxinaTipo ?? 'ip';
      const chave = btn.dataset.faxinaChave ?? '';
      btn.disabled = true;
      btn.textContent = 'montando…';
      multicontasCache.planoGeral = null;
      multicontasCache.resultadoGeral = null;
      try {
        multicontasCache.plano = await pedir('multicontas/plano', { tipo, chave });
        multicontasCache.resultado = null;
        multicontasCache.msg = null;
      } catch (err) {
        multicontasCache.plano = null;
        multicontasCache.msg = { tom: 'ruim', texto: err.message };
      }
      redesenharMulticontas();
      $('.adm-mc-plano')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }

  $('#adm-mc-cancelar')?.addEventListener('click', () => {
    multicontasCache.plano = null;
    multicontasCache.msg = null;
    redesenharMulticontas();
  });

  $('#adm-mc-fechar')?.addEventListener('click', () => {
    multicontasCache.resultado = null;
    redesenharMulticontas();
  });

  // ---- o segundo clique, o que executa
  $('#adm-mc-aplicar')?.addEventListener('click', async (ev) => {
    const plano = multicontasCache.plano;
    if (!plano) return;
    const botao = ev.currentTarget;
    const msg = $('#adm-mc-plano-msg');
    botao.disabled = true;
    botao.textContent = 'aplicando…';
    try {
      multicontasCache.resultado = await pedir('multicontas/faxina', {
        tipo: plano.tipo,
        chave: plano.chave,
        manter: plano.manter,
        // A conferência do outro lado. Ver `faxinaDeMulticontas`.
        esperado: plano.banir.map((c) => c.nick),
      });
      multicontasCache.plano = null;
      await carregarMulticontas().catch(() => {});
      redesenharMulticontas();
    } catch (err) {
      botao.disabled = false;
      botao.textContent = 'Confirmar faxina';
      if (msg) {
        msg.className = 'adm-aviso ruim';
        msg.textContent = err.message;
      }
    }
  });

  // ---- o BANIMENTO DE IP: o primeiro clique só pede a prévia, como a faxina
  const banIp = multicontasCache.banIp;
  const lerFormularioBan = () => {
    banIp.ip = ($('#adm-ipban-ip')?.value ?? '').trim();
    banIp.motivo = ($('#adm-ipban-motivo')?.value ?? '').trim();
    banIp.horas = Number($('#adm-ipban-horas')?.value) || 0;
  };
  const abrirPreviaBan = async (ip) => {
    banIp.resultado = null;
    banIp.msg = null;
    try {
      banIp.previa = await pedir('multicontas/ip-ban/previa', { ip });
      banIp.ip = banIp.previa.ipBucket;
    } catch (err) {
      banIp.previa = null;
      banIp.msg = { tom: 'ruim', texto: err.message };
    }
    redesenharMulticontas();
    $('#adm-ipban')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  $('#adm-ipban-previa')?.addEventListener('click', () => {
    lerFormularioBan();
    if (!banIp.ip) {
      banIp.msg = { tom: 'ruim', texto: 'Digite um IP (1.2.3.4, 2804:…) ou um bloco /64.' };
      banIp.previa = null;
      redesenharMulticontas();
      return;
    }
    abrirPreviaBan(banIp.ip);
  });
  $('#adm-ipban-ip')?.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') $('#adm-ipban-previa')?.click();
  });

  // "Banir IP" nas tabelas: preenche o formulário com a chave da linha e abre a prévia.
  for (const btn of document.querySelectorAll('[data-banir-ip]')) {
    btn.addEventListener('click', () => {
      lerFormularioBan();
      abrirPreviaBan(btn.dataset.banirIp ?? '');
    });
  }

  $('#adm-ipban-cancelar')?.addEventListener('click', () => {
    lerFormularioBan();
    banIp.previa = null;
    redesenharMulticontas();
  });
  $('#adm-ipban-fechar')?.addEventListener('click', () => {
    banIp.resultado = null;
    redesenharMulticontas();
  });

  $('#adm-ipban-aplicar')?.addEventListener('click', async (ev) => {
    const p = banIp.previa;
    if (!p) return;
    lerFormularioBan();
    const banirContas = !!$('#adm-ipban-contas')?.checked;
    const prazo = HORAS_BAN_IP.find(([h]) => h === banIp.horas)?.[1] ?? 'para sempre';
    const contas = banirContas ? `\n+ ban soft em ${p.nascidas.length} conta(s) criadas nele` : '';
    if (!confirm(`Banir o IP ${p.ipBucket} (${prazo})?${contas}\n\nSite, cadastro, login e jogo param para essa rede, e quem estiver on-line por ela cai agora.`)) return;
    const botao = ev.currentTarget;
    const msg = $('#adm-ipban-msg');
    botao.disabled = true;
    botao.textContent = 'banindo…';
    try {
      banIp.resultado = await pedir('multicontas/ip-ban/banir', {
        ip: p.ipBucket,
        motivo: banIp.motivo,
        horas: banIp.horas,
        banirContas,
        // A conferência do outro lado: se nasceu conta nova depois da prévia, o servidor recusa.
        esperado: p.nascidas.length,
      });
      banIp.previa = null;
      banIp.ip = '';
      banIp.motivo = '';
      await carregarMulticontas().catch(() => {});
      redesenharMulticontas();
      $('#adm-ipban')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      botao.disabled = false;
      botao.textContent = 'Banir IP';
      if (msg) {
        msg.className = 'adm-aviso ruim';
        msg.textContent = err.message;
      }
    }
  });

  for (const btn of document.querySelectorAll('[data-desbanir-ip]')) {
    btn.addEventListener('click', async () => {
      const ipBucket = btn.dataset.desbanirIp ?? '';
      if (!confirm(`Tirar o ban de ${ipBucket}? A rede volta a acessar o jogo.\n\nContas banidas junto continuam banidas — desbanir cada uma é pela ficha.`)) return;
      btn.disabled = true;
      lerFormularioBan();
      try {
        await pedir('multicontas/ip-ban/desbanir', { ipBucket });
        await carregarMulticontas();
        banIp.msg = { tom: 'bom', texto: `${ipBucket} desbanido.` };
      } catch (err) {
        banIp.msg = { tom: 'ruim', texto: err.message };
      }
      redesenharMulticontas();
    });
  }

  // ---- a isenção do teto
  for (const btn of document.querySelectorAll('[data-liberar-ip]')) {
    btn.addEventListener('click', async () => {
      const ipBucket = btn.dataset.liberarIp ?? '';
      const nota = prompt(`Pôr ${ipBucket} na whitelist — cria e conecta quantas contas quiser.\n\nPor quê? (CGNAT da operadora, lan house, república, família grande…)`, '');
      if (nota === null) return;
      btn.disabled = true;
      try {
        await pedir('multicontas/liberar-ip', { ipBucket, nota });
        await carregarMulticontas();
        multicontasCache.msg = { tom: 'bom', texto: `${ipBucket} na whitelist — sem limite de contas nem de sessões.` };
      } catch (err) {
        multicontasCache.msg = { tom: 'ruim', texto: err.message };
      }
      redesenharMulticontas();
    });
  }

  for (const btn of document.querySelectorAll('[data-travar-ip]')) {
    btn.addEventListener('click', async () => {
      const ipBucket = btn.dataset.travarIp ?? '';
      const lim = multicontasCache.teto;
      if (!confirm(`Tirar ${ipBucket} da whitelist? Volta a valer ${num(lim?.limite ?? 4)} contas criadas e ${num(lim?.limiteOnline ?? 4)} on-line ao mesmo tempo.`)) return;
      btn.disabled = true;
      try {
        await pedir('multicontas/liberar-ip', { ipBucket, travar: true });
        await carregarMulticontas();
        multicontasCache.msg = { tom: 'bom', texto: `${ipBucket} saiu da whitelist e volta a respeitar os dois limites.` };
      } catch (err) {
        multicontasCache.msg = { tom: 'ruim', texto: err.message };
      }
      redesenharMulticontas();
    });
  }
}

function secaoAuditoria(d) {
  const r = d.resumo ?? {};
  const linhas = d.eventos?.length
    ? d.eventos
        .map((e) => {
          const badge =
            e.tipo === 'gema'
              ? 'adm-badge-gema'
              : e.tipo === 'diamante'
                ? 'adm-badge-dia'
                : e.tipo === 'jogo'
                  ? 'adm-badge-jogo'
                  : 'adm-badge-coin';
          return `<tr>
            <td>${new Date(e.em).toLocaleString('pt-BR')}</td>
            <td><span class="adm-badge ${badge}">${escapar(e.tipo)}</span></td>
            <td>${escapar(e.origemLabel ?? e.origem)}</td>
            <td class="n">${e.valor != null ? num(e.valor) : '—'}</td>
            <td class="n">${e.saldoApos != null ? num(e.saldoApos) : '—'}</td>
            <td>${detalheAuditoria(e)}</td>
          </tr>`;
        })
        .join('')
    : '<tr><td colspan="6">nenhum evento — tente outro filtro ou aguarde movimentos novos</td></tr>';

  return `<section class="adm-secao">
    <h2>Auditoria de jogador</h2>
    <p class="adm-legenda">Histórico de <b>economia</b> (depósitos de Gemas, compras de diamantes, créditos/débitos manuais de admin, loja, afiliado, vendas no mercado, picos de coins ≥ ${num(d.limiteCoinsAudit ?? 1000000)}) e de <b>gameplay</b> (capturas shiny/P5, refino, fragmentos, casa, mercado — anúncios, compras, cancelamentos —, drops de peça TM em boss, loja NPC — compra e venda de itens). <b>Só visível neste painel admin.</b></p>
    <div class="adm-busca">
      <div class="adm-campo">
        <label for="adm-audit-nick">nick</label>
        <input id="adm-audit-nick" type="text" value="${escapar(d.nick ?? '')}" placeholder="NickDoJogador">
      </div>
      <div class="adm-campo" style="max-width:200px">
        <label for="adm-audit-filtro">filtro</label>
        <select id="adm-audit-filtro">
          <option value=""${d.filtro === '' ? ' selected' : ''}>todos</option>
          <optgroup label="economia">
            <option value="gema"${d.filtro === 'gema' ? ' selected' : ''}>gemas</option>
            <option value="diamante"${d.filtro === 'diamante' ? ' selected' : ''}>diamantes</option>
            <option value="market"${d.filtro === 'market' ? ' selected' : ''}>mercado (vendas + anúncios + compras)</option>
            <option value="coins"${d.filtro === 'coins' ? ' selected' : ''}>coins (picos + mercado em coins)</option>
          </optgroup>
          <optgroup label="gameplay">
            <option value="jogo"${d.filtro === 'jogo' ? ' selected' : ''}>gameplay (tudo)</option>
            <option value="capturas_raras"${d.filtro === 'capturas_raras' ? ' selected' : ''}>capturas shiny / P5</option>
            <option value="refino"${d.filtro === 'refino' ? ' selected' : ''}>refino (pedras)</option>
            <option value="fragmentos"${d.filtro === 'fragmentos' ? ' selected' : ''}>fragmentos (drop e gasto)</option>
            <option value="casa"${d.filtro === 'casa' ? ' selected' : ''}>sorteio de casa</option>
            <option value="tm"${d.filtro === 'tm' ? ' selected' : ''}>TM (drop de boss)</option>
            <option value="npc"${d.filtro === 'npc' ? ' selected' : ''}>NPC (compra e venda de itens)</option>
          </optgroup>
        </select>
      </div>
      <button class="adm-botao neutro" id="adm-audit-buscar">Carregar log</button>
    </div>
    ${
      d.nick && r.depositosGema != null
        ? `<div class="adm-blocos" style="margin-bottom:12px">
      ${bloco('gemas depositadas', num(r.gemasDepositadas), `${num(r.depositosGema)} depósito(s) · ${Number(r.usdtDepositado ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2 })} USDT`)}
      ${bloco('diamantes comprados', num(r.diamantesComprados), `${num(r.comprasDiamante)} pagamento(s)`)}
      ${bloco('admin · créditos', num(r.diamantesAdminCreditados ?? 0), `${num(r.ajustesAdminDiamante ?? 0)} ajuste(s)${Number(r.diamantesAdminDebitados ?? 0) > 0 ? ` · ${num(r.diamantesAdminDebitados)} debitado(s)` : ''}`)}
      ${bloco('diamantes na loja', num(r.diamantesGastosLoja ?? 0), `${num(r.comprasLoja ?? 0)} compra(s)${Number(r.diamantesEstornadosLoja ?? 0) > 0 ? ` · ${num(r.diamantesEstornadosLoja)} estornado(s)` : ''}`)}
      ${bloco('afiliado · diamantes', num(r.diamantesAfiliadoRecolhidos ?? 0), `${num(r.recolhasAfiliadoDiamante ?? 0)} recolha(s)`)}
      ${bloco('afiliado · gemas', num(r.gemasAfiliadoRecolhidas ?? 0), `${num(r.recolhasAfiliadoGema ?? 0)} recolha(s)`)}
      ${bloco('coins no mercado', num(r.coinsMercadoLiquido), `${num(r.vendasMercado)} venda(s) · bruto ${num(r.coinsMercadoBruto)}`)}
      ${bloco('gemas no mercado', num(r.gemasMercadoLiquido ?? 0), `${num(r.vendasMercadoGema ?? 0)} venda(s) · bruto ${num(r.gemasMercadoBruto ?? 0)}`)}
      ${bloco('gemas gastas no mercado', num(r.gemasMercadoGasto ?? 0), `${num(r.comprasMercadoGema ?? 0)} compra(s)`)}
      ${bloco('saldo atual', num(d.gold ?? 0), `nível ${d.level ?? '—'}`)}
    </div>`
        : ''
    }
    <table class="adm-tabela">
      <tr><th>quando</th><th>tipo</th><th>origem</th><th style="text-align:right">valor</th><th style="text-align:right">saldo após</th><th>detalhe</th></tr>
      ${linhas}
    </table>
    <p class="adm-aviso" id="adm-audit-msg">Eventos de gameplay passam a ser gravados após o deploy desta versão. Depósitos, loja e vendas no mercado vêm do histórico do banco.</p>
  </section>`;
}

async function carregarAuditoria(nick, filtro = auditoriaCache.filtro) {
  const pedido = String(nick ?? '').trim();
  if (!pedido) throw new Error('digite um nick');
  const dados = await pedir('usuarios/auditoria', { nick: pedido, filtro, limite: 200 });
  auditoriaCache = { nick: dados.nick, filtro, ...dados };
  return auditoriaCache;
}

function ligarAuditoria() {
  const msg = $('#adm-audit-msg');
  $('#adm-audit-buscar')?.addEventListener('click', async () => {
    const nick = $('#adm-audit-nick')?.value?.trim();
    const filtro = $('#adm-audit-filtro')?.value ?? '';
    try {
      await carregarAuditoria(nick, filtro);
      renderSecao();
    } catch (err) {
      if (msg) {
        msg.className = 'adm-aviso ruim';
        msg.textContent = err.message;
      }
    }
  });
  $('#adm-audit-nick')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('#adm-audit-buscar')?.click();
  });
}

async function carregarSaquesAprovacao(offset = saquesAprovacaoCache.offset) {
  const limite = saquesAprovacaoCache.limite ?? 40;
  const dados = await pedir('gemas/saques/pendentes', { offset, limite });
  saquesAprovacaoCache = { ...dados, offset, limite };
  return saquesAprovacaoCache;
}

function ligarSaquesAprovacao() {
  const msg = $('#adm-saq-ap-msg');
  const recarregar = async (off = saquesAprovacaoCache.offset) => {
    await carregarSaquesAprovacao(off);
    renderSecao();
  };

  $('#adm-saq-ap-prev')?.addEventListener('click', () => recarregar(Math.max(0, saquesAprovacaoCache.offset - saquesAprovacaoCache.limite)));
  $('#adm-saq-ap-next')?.addEventListener('click', () => recarregar(saquesAprovacaoCache.offset + saquesAprovacaoCache.limite));

  for (const btn of document.querySelectorAll('[data-aprovar-saque]')) {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.aprovarSaque;
      if (!id || !confirm('Aprovar este saque? O envio segue na fila automática.')) return;
      try {
        await pedir('gemas/saques/aprovar', { id });
        if (msg) {
          msg.className = 'adm-aviso bom';
          msg.textContent = 'Saque aprovado.';
        }
        await recarregar(saquesAprovacaoCache.offset);
      } catch (err) {
        if (msg) {
          msg.className = 'adm-aviso ruim';
          msg.textContent = err.message;
        }
      }
    });
  }

  for (const btn of document.querySelectorAll('[data-rejeitar-saque]')) {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.rejeitarSaque;
      if (!id || !confirm('Recusar este saque? As gemas voltam para o jogador.')) return;
      try {
        await pedir('gemas/saques/rejeitar', { id });
        if (msg) {
          msg.className = 'adm-aviso bom';
          msg.textContent = 'Saque recusado — gemas devolvidas.';
        }
        await recarregar(saquesAprovacaoCache.offset);
      } catch (err) {
        if (msg) {
          msg.className = 'adm-aviso ruim';
          msg.textContent = err.message;
        }
      }
    });
  }
}

async function carregarHistoricoGemas(opts = {}) {
  const aba = opts.aba ?? historicoGemasCache.aba ?? 'depositos';
  const nick = opts.nick ?? historicoGemasCache.nick ?? '';
  const limite = historicoGemasCache.limite ?? 40;
  const offsetDep = opts.offsetDep ?? historicoGemasCache.offsetDep ?? 0;
  const offsetSaq = opts.offsetSaq ?? historicoGemasCache.offsetSaq ?? 0;

  const [dep, saq] = await Promise.all([
    pedir('gemas/depositos/listar', { nick, offset: offsetDep, limite }),
    pedir('gemas/saques/listar', { nick, offset: offsetSaq, limite }),
  ]);

  historicoGemasCache = {
    aba,
    nick,
    limite,
    offsetDep,
    totalDep: dep.total,
    depositos: dep.depositos,
    offsetSaq,
    totalSaq: saq.total,
    saques: saq.saques,
  };
  return historicoGemasCache;
}

function ligarHistoricoGemas() {
  const recarregar = async (patch = {}) => {
    await carregarHistoricoGemas({
      ...patch,
      nick: $('#adm-gem-hist-nick')?.value?.trim() ?? historicoGemasCache.nick,
    });
    renderSecao();
  };

  for (const btn of document.querySelectorAll('[data-gem-aba]')) {
    btn.addEventListener('click', () => {
      historicoGemasCache.aba = btn.dataset.gemAba;
      recarregar({ aba: btn.dataset.gemAba });
    });
  }

  $('#adm-gem-hist-buscar')?.addEventListener('click', () =>
    recarregar({ offsetDep: 0, offsetSaq: 0 }),
  );
  $('#adm-gem-hist-nick')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('#adm-gem-hist-buscar')?.click();
  });
  $('#adm-gem-dep-prev')?.addEventListener('click', () =>
    recarregar({ offsetDep: Math.max(0, historicoGemasCache.offsetDep - historicoGemasCache.limite) }),
  );
  $('#adm-gem-dep-next')?.addEventListener('click', () =>
    recarregar({ offsetDep: historicoGemasCache.offsetDep + historicoGemasCache.limite }),
  );
  $('#adm-gem-saq-prev')?.addEventListener('click', () =>
    recarregar({ offsetSaq: Math.max(0, historicoGemasCache.offsetSaq - historicoGemasCache.limite) }),
  );
  $('#adm-gem-saq-next')?.addEventListener('click', () =>
    recarregar({ offsetSaq: historicoGemasCache.offsetSaq + historicoGemasCache.limite }),
  );
}

async function carregarDiamantesHist(offset = diamantesHistCache.offset, dia = diamantesHistCache.dia ?? hojeBr()) {
  const nick = diamantesHistCache.nick ?? '';
  const limite = diamantesHistCache.limite ?? 40;
  const dados = await pedir('diamantes/historico', { nick, dia, offset, limite });
  diamantesHistCache = { ...dados, nick, dia, offset, limite };
  return diamantesHistCache;
}

async function carregarResolverAuditoria() {
  const [cat, hist] = await Promise.all([
    pedir('resolver-auditoria/catalogo'),
    pedir('resolver-auditoria/historico'),
  ]);
  resolverAuditoriaCache = { catalogo: cat.itens ?? [], historico: hist.historico ?? [] };
  return resolverAuditoriaCache;
}

function ligarVarredura() {
  const botao = $('#adm-varredura');
  if (!botao || botao.disabled) return;

  let confirmando = false;
  botao.onclick = async () => {
    const msg = $('#adm-varredura-msg');

    if (!confirmando) {
      confirmando = true;
      botao.textContent = 'Confirmar varredura';
      botao.classList.add('confirmar');
      msg.className = 'adm-aviso ruim';
      msg.textContent =
        'Vai assinar transações na blockchain para mover USDT dos endereços dos jogadores para a tesouraria. Clique de novo para confirmar.';
      setTimeout(() => {
        if (!confirmando) return;
        confirmando = false;
        botao.textContent = 'Forçar varredura';
        botao.classList.remove('confirmar');
      }, 30_000);
      return;
    }

    botao.disabled = true;
    botao.textContent = 'varrendo…';
    msg.className = 'adm-aviso';
    msg.textContent = 'Varredura em andamento — pode levar alguns minutos…';
    try {
      const r = await pedir('gemas/varredura');
      msg.className = 'adm-aviso bom';
      msg.innerHTML =
        `Concluída: ${num(r.recolhidos)} endereço(s), ${usdt(r.usdt)} para a tesouraria` +
        (r.olhados ? ` · ${num(r.olhados)} olhado(s)` : '') +
        (r.pulados ? ` · ${num(r.pulados)} abaixo do piso` : '') +
        (r.falhas ? ` · ${num(r.falhas)} falha(s)` : '');
      dadosPainel = await pedir('painel');
      setTimeout(renderSecao, 400);
    } catch (err) {
      msg.className = 'adm-aviso ruim';
      msg.textContent = err.message;
      botao.disabled = false;
      botao.textContent = 'Forçar varredura';
      botao.classList.remove('confirmar');
      confirmando = false;
    }
  };
}

function ligarColheita() {
  const botao = $('#adm-enviar');
  if (!botao) return;

  let confirmando = false;
  botao.onclick = async () => {
    const carteira = $('#adm-carteira').value;
    const valor = Number($('#adm-valor').value);
    const msg = $('#adm-msg');

    if (!(valor > 0)) {
      msg.className = 'adm-aviso ruim';
      msg.textContent = 'valor tem de ser maior que zero';
      return;
    }

    if (!confirmando) {
      confirmando = true;
      botao.textContent = 'Confirmar envio';
      botao.classList.add('confirmar');
      const nome = $('#adm-carteira').selectedOptions[0]?.textContent ?? carteira;
      msg.className = 'adm-aviso ruim';
      msg.textContent = `Enviar ${usdt(valor)} para ${nome}? Transação em blockchain NÃO volta. Clique de novo para confirmar.`;
      setTimeout(() => {
        if (!confirmando) return;
        confirmando = false;
        botao.textContent = 'Transferir';
        botao.classList.remove('confirmar');
      }, 30_000);
      return;
    }

    botao.disabled = true;
    botao.textContent = 'enviando…';
    try {
      const r = await pedir('colher', { carteira, usdt: valor });
      msg.className = 'adm-aviso bom';
      msg.innerHTML = `Enviado. Transação: <code>${escapar(r.assinatura ?? '—')}</code>`;
      dadosPainel = await pedir('painel');
      setTimeout(renderSecao, 400);
    } catch (err) {
      msg.className = 'adm-aviso ruim';
      msg.textContent = err.message;
      botao.disabled = false;
      botao.textContent = 'Transferir';
      botao.classList.remove('confirmar');
      confirmando = false;
    }
  };
}

async function renderSecao() {
  if (!dadosPainel) return;
  montarNav();
  const corpo = $('#adm-corpo');
  $('#adm-atualizado').textContent = `atualizado ${new Date().toLocaleTimeString('pt-BR')}`;

  if (secaoAtiva === 'ficha') {
    try {
      // Só busca sozinho quando veio um nick de outra tela (o botão "Ficha" da listagem ou um
      // nick do aglomerado). Entrando pela aba, a tela abre vazia com o campo de busca — pedir
      // a ficha do último jogador consultado seria mostrar dado de outra pessoa sem querer.
      if (fichaCache.nick && !fichaCache.dados) {
        fichaCache.dados = await pedir('usuarios/ficha', { nick: fichaCache.nick });
      }
      corpo.innerHTML = secaoFicha(fichaCache);
      ligarFicha();
    } catch (err) {
      corpo.innerHTML = `<div class="adm-erro">${escapar(err.message)}</div>`;
    }
    return;
  }

  if (secaoAtiva === 'multicontas') {
    // Entrar na seção começa do zero: uma prévia de faxina montada há dez minutos, em outra
    // aba do painel, é exatamente o tipo de tela velha em que se clica sem reler.
    multicontasCache.plano = null;
    multicontasCache.resultado = null;
    multicontasCache.msg = null;
    try {
      multicontasCache.erroBusca = null;
      await carregarMulticontas().catch((err) => {
        if (!multicontasCache.nick) throw err;
        multicontasCache.dados = null;
        multicontasCache.erroBusca = err.message;
      });
      corpo.innerHTML = secaoMulticontas(multicontasCache);
      ligarMulticontas();
    } catch (err) {
      corpo.innerHTML = `<div class="adm-erro">${escapar(err.message)}</div>`;
    }
    return;
  }

  if (secaoAtiva === 'guilds') {
    try {
      guildsCache = { ...guildsCache, ...(await pedir('guilds/listar', { busca: guildsCache.busca })) };
      corpo.innerHTML = secaoGuilds(guildsCache);
      ligarGuilds();
    } catch (err) {
      corpo.innerHTML = `<div class="adm-erro">${escapar(err.message)}</div>`;
    }
    return;
  }

  if (secaoAtiva === 'auditoria') {
    try {
      if (auditoriaCache.nick) {
        await carregarAuditoria(auditoriaCache.nick, auditoriaCache.filtro);
      }
      corpo.innerHTML = secaoAuditoria(auditoriaCache);
      ligarAuditoria();
    } catch (err) {
      corpo.innerHTML = `<div class="adm-erro">${escapar(err.message)}</div>`;
    }
    return;
  }

  if (secaoAtiva === 'usuarios') {
    try {
      await carregarUsuarios(usuariosCache.offset);
      corpo.innerHTML = secaoUsuariosLista(usuariosCache);
      ligarUsuarios();
    } catch (err) {
      corpo.innerHTML = `<div class="adm-erro">${escapar(err.message)}</div>`;
    }
    return;
  }

  if (secaoAtiva === 'referrals') {
    try {
      await carregarReferrals(referralsCache.offset);
      corpo.innerHTML = secaoReferrals(referralsCache);
      ligarReferrals();
    } catch (err) {
      corpo.innerHTML = `<div class="adm-erro">${escapar(err.message)}</div>`;
    }
    return;
  }

  if (secaoAtiva === 'convites') {
    try {
      await carregarConvites(convitesCache.offset);
      corpo.innerHTML = secaoConvites(convitesCache);
      ligarConvites();
    } catch (err) {
      corpo.innerHTML = `<div class="adm-erro">${escapar(err.message)}</div>`;
    }
    return;
  }

  if (secaoAtiva === 'referral-especial') {
    try {
      await carregarReferralEspecial();
      corpo.innerHTML = secaoReferralEspecial(referralEspecialCache);
      ligarReferralEspecial();
    } catch (err) {
      corpo.innerHTML = `<div class="adm-erro">${escapar(err.message)}</div>`;
    }
    return;
  }

  if (secaoAtiva === 'eventos') {
    try {
      eventosCache = await pedir('eventos/estado');
      corpo.innerHTML = secaoEventos(eventosCache);
      ligarEventos();
    } catch (err) {
      corpo.innerHTML = `<div class="adm-erro">${escapar(err.message)}</div>`;
    }
    return;
  }

  if (secaoAtiva === 'contagem-online') {
    try {
      contagemOnlineCache = await pedir('online-contagem/estado');
      corpo.innerHTML = secaoContagemOnline(contagemOnlineCache);
      ligarContagemOnline();
    } catch (err) {
      corpo.innerHTML = `<div class="adm-erro">${escapar(err.message)}</div>`;
    }
    return;
  }

  if (secaoAtiva === 'saques-gemas') {
    try {
      await carregarSaquesAprovacao(saquesAprovacaoCache.offset);
      corpo.innerHTML = secaoAprovacaoSaquesGemas(saquesAprovacaoCache);
      ligarSaquesAprovacao();
    } catch (err) {
      corpo.innerHTML = `<div class="adm-erro">${escapar(err.message)}</div>`;
    }
    return;
  }

  if (secaoAtiva === 'historico-gemas') {
    try {
      await carregarHistoricoGemas();
      corpo.innerHTML = secaoHistoricoGemas(historicoGemasCache);
      ligarHistoricoGemas();
    } catch (err) {
      corpo.innerHTML = `<div class="adm-erro">${escapar(err.message)}</div>`;
    }
    return;
  }

  if (secaoAtiva === 'tesouraria') {
    corpo.innerHTML = secaoTesouraria(dadosPainel);
    ligarVarredura();
    ligarColheita();
    return;
  }
  if (secaoAtiva === 'chat') {
    corpo.innerHTML = secaoCargos(dadosPainel.cargos);
    ligarCargos();
    return;
  }
  if (secaoAtiva === 'mutes') {
    try {
      await carregarMutes();
      corpo.innerHTML = secaoMutes(mutesCache.mutes);
      ligarMutes();
    } catch (err) {
      corpo.innerHTML = `<div class="adm-erro">${escapar(err.message)}</div>`;
    }
    return;
  }
  if (secaoAtiva === 'diamantes') {
    try {
      await carregarDiamantesHist(diamantesHistCache.offset, diamantesHistCache.dia ?? hojeBr());
      corpo.innerHTML = secaoDiamantes(diamantesHistCache);
      ligarDiamantes();
    } catch (err) {
      corpo.innerHTML = `<div class="adm-erro">${escapar(err.message)}</div>`;
    }
    return;
  }

  if (secaoAtiva === 'resolver-auditoria') {
    try {
      await carregarResolverAuditoria();
      corpo.innerHTML = secaoResolverAuditoria(resolverAuditoriaCache);
      ligarResolverAuditoria();
    } catch (err) {
      corpo.innerHTML = `<div class="adm-erro">${escapar(err.message)}</div>`;
    }
    return;
  }

  if (secaoAtiva === 'med') {
    try {
      if (!medCache.historico) medCache.historico = await pedir('med/historico');
      corpo.innerHTML = secaoMed(medCache);
      ligarMed();
    } catch (err) {
      corpo.innerHTML = `<div class="adm-erro">${escapar(err.message)}</div>`;
    }
    return;
  }

  if (secaoAtiva === 'notas') {
    try {
      notasCache = await pedir('notas/listar', notasCache.mes ? { mes: notasCache.mes } : {});
      corpo.innerHTML = secaoNotas(notasCache);
      ligarNotas();
    } catch (err) {
      corpo.innerHTML = `<div class="adm-erro">${escapar(err.message)}</div>`;
    }
    return;
  }

  if (secaoAtiva === 'financeiro') {
    try {
      await carregarFinanceiro();
      corpo.innerHTML = secaoFinanceiro(financeiroCache) + '<div id="fin-aviso" hidden class="adm-aviso"></div>';
      ligarFinanceiro();
    } catch (err) {
      corpo.innerHTML = `<div class="adm-erro">${escapar(err.message)}</div>`;
    }
    return;
  }

  if (secaoAtiva === 'emails') {
    try {
      await carregarEmailsRecebidos();
      corpo.innerHTML = secaoEmails();
      ligarEmails();
    } catch (err) {
      emailsRecebidosCache = { emails: [], hasMore: false, after: null, cursor: null, detalhe: null, aba: 'recebidos' };
      corpo.innerHTML = secaoEmails() + `<div class="adm-erro" style="margin-top:10px">${escapar(err.message)}</div>`;
      ligarEmails();
    }
    return;
  }
}

async function montar() {
  let d;
  try {
    d = await pedir('painel');
  } catch {
    $('#adm-corpo').innerHTML =
      `<div class="adm-erro">Não encontrado. Entre no jogo com uma conta de administrador e volte a esta página.</div>`;
    return;
  }

  dadosPainel = d;
  $('#adm-quem').textContent = d.email;
  const secoes = secoesDoPainel(d);
  const hash = location.hash.slice(1);
  secaoAtiva = secoes.some((s) => s.id === hash) ? hash : (secoes[0]?.id ?? 'usuarios');
  if (location.hash.slice(1) !== secaoAtiva) location.hash = secaoAtiva;
  montarNav();
  await renderSecao();
}

window.addEventListener('hashchange', () => {
  const id = location.hash.slice(1);
  if (secoesDoPainel(dadosPainel).some((s) => s.id === id) && id !== secaoAtiva) irSecao(id);
});

montar();
