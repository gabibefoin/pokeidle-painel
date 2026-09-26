/**
 * Limites de mensagem por CONTA no gateway — o que um bot conversando direto com o socket
 * esbarra, e um jogador de verdade nunca vê.
 *
 * ### Por que por conta, e não só por socket
 *
 * O balde antigo morava no objeto do socket: reconectar dava um balde novo e cheio. Um script
 * que fecha e reabre a conexão zerava o próprio limite a cada volta. Aqui o balde é da conta
 * (o nick minúsculo, o mesmo `playerId` do barramento) e sobrevive à reconexão; some sozinho
 * depois de 10 minutos parado.
 *
 * ### De onde vêm os números
 *
 * Medidos em produção, 14 dias até 15/09/2026, no pico de UM jogador:
 *
 *   · compra no Mercado da Comunidade: 19 em 10 s, 32 em 1 min;
 *   · anúncio: 5 em 10 s, 13 em 1 min · cancelamento: 9 em 10 s, 12 em 1 min;
 *   · compra na loja NPC: 82 em 10 s, 243 em 1 min · venda ao NPC: 40 em 10 s, 105 em 1 min.
 *
 * Cada balde cabe folgado acima desses picos (capacidade + reposição em 10 s e em 1 min). As
 * leituras do mercado não têm registro no banco; a tela pede com `debounce` de 250 ms, e 20 de
 * rajada com 3/s cobre filtro, página e aba sem folga para varredura contínua.
 *
 * ### Custo
 *
 * Um `Map.get` e uma conta de ponto flutuante por mensagem. Nada vai ao banco nem ao Redis.
 * Por processo de gateway: a conta cai sempre no mesmo gateway enquanto está conectada.
 */

/** Espera entre mensagens no chat público (mundo/guild). Staff isenta — ver `podeApagarChat`. */
export const CHAT_COOLDOWN_MS = 5000;

/** capacidade = rajada; porSegundo = reposição. */
export const REGRAS = Object.freeze({
  // O limite geral de sempre (15 de rajada, 20/s), agora preso à conta.
  geral: { capacidade: 15, porSegundo: 20 },
  mercadoCompra: { capacidade: 25, porSegundo: 1 },
  mercadoAnuncio: { capacidade: 15, porSegundo: 0.5 },
  mercadoLeitura: { capacidade: 20, porSegundo: 3 },
  lojaCompra: { capacidade: 100, porSegundo: 5 },
  lojaVenda: { capacidade: 60, porSegundo: 3 },
  // A OFERENDA é a mais cara do jogo por mensagem: cada giro apaga até cinco linhas de `pokemons`
  // e escreve uma de auditoria. Não há pico de jogador a respeitar aqui — carregar cinco pokémon
  // na roleta leva dezenas de segundos de cliques —, então o balde é o mais apertado da tabela:
  // seis de rajada (o jogador que esvazia o depot em sequência) e um a cada 4 s depois disso.
  oferenda: { capacidade: 6, porSegundo: 0.25 },
  // O LOTE ("oferendar tudo do Depot") é a mesma mensagem multiplicada por cinquenta: até 250
  // linhas de `pokemons` apagadas e cinquenta roletas montadas numa chamada. Dividir o balde
  // acima com ele deixaria seis rajadas valerem 1.500 pokémon, então ele tem o seu — e o mais
  // apertado do jogo. Não há pico legítimo a respeitar: entre um lote e outro há um diálogo de
  // confirmação para ler e uma tela de prêmios para fechar.
  oferendaLote: { capacidade: 2, porSegundo: 0.1 },
  // Guild e amigos: cada uma é uma ida ao banco, e ninguém convida 20 pessoas por segundo.
  social: { capacidade: 20, porSegundo: 1 },
  // `hello` por conta: reconectar em laço é o jeito de gastar duas consultas por volta.
  hello: { capacidade: 20, porSegundo: 1 / 3 },
  // As fitas do campeonato: cada uma é uma leitura de dezenas de KB e uma descompressão. Quem
  // assiste clica uma de cada vez; oito de rajada cobrem o "abre, fecha, abre a próxima".
  fita: { capacidade: 8, porSegundo: 0.5 },
  // A espera do CHAT. Ela morava em `ws.ultimoChat` — no socket —, e socket novo nascia sem
  // ela: fechar e reabrir a conexão entre duas mensagens zerava os 5 s. Com o balde de `hello`
  // cheio isso valia uma rajada de 20 mensagens e, depois dela, quase o dobro do ritmo
  // permitido (uma a cada 3 s em vez de 5). É o mesmo furo que tirou os outros baldes de cima
  // do socket, e pela mesma razão está aqui: o carimbo é da CONTA e sobrevive à reconexão.
  //
  // Capacidade 1 é de propósito: isto é uma ESPERA, não uma rajada. Guardar fichas de silêncio
  // para gastar de uma vez é exatamente o que o cooldown do chat não pode permitir.
  chat: { capacidade: 1, porSegundo: 1000 / CHAT_COOLDOWN_MS },
  // A COLEÇÃO: mover um pokémon entre Depot e Coleção é um clique por card, e quem arruma a
  // caixa manda vários seguidos. Vinte de rajada cobrem essa arrumação; dois por segundo depois
  // disso é mais do que a mão faz. Cada troca grava o `automation` no flush, e o laço de
  // "entra e sai" é o que este balde (e a espera por pokémon, no sim) existe para cortar.
  colecao: { capacidade: 20, porSegundo: 2 },
  // A ÁREA DE TREINAMENTO: uma batalha por conta a cada 5 min (`TREINO_COOLDOWN_MS`). Quem
  // decide é o carimbo no Redis, no sim; este balde é o freio do socket, e tem três fichas
  // porque um pedido RECUSADO (lado vazio, pokémon vendido no meio) devolve a vez lá e não
  // pode deixar o jogador esperando cinco minutos por um clique que não lutou.
  treino: { capacidade: 3, porSegundo: 1 / 300 },
  // As CAIXAS do Market: cada abertura é uma transação de diamante (nas II+) e uma linha de
  // auditoria. Quem abre em sequência clica uma vez por caixa; dez de rajada cobrem isso, e
  // uma por segundo depois disso é mais rápido do que a mão faz — e o preço em Coins já é o
  // freio de verdade.
  caixa: { capacidade: 10, porSegundo: 1 },
  // A LIXEIRA da bolsa. Cada descarte é irreversível e deixa linha de auditoria; quem arruma a
  // mochila joga fora meia dúzia de coisas seguidas e para. Dez de rajada cobrem essa arrumação,
  // e um por segundo depois disso é mais rápido do que a mão faz — sem dar a um script o ritmo
  // para varrer a bolsa de alguém que deixou a aba aberta.
  descarte: { capacidade: 10, porSegundo: 1 },
  // O MODO ECONOMIA (`cliente.economia`). Ligar custa nada, mas DESLIGAR faz o sim remontar e
  // mandar a cena inteira (`reenviarCena`) — na praça do Centro, com todo mundo dentro. Só com o
  // limite geral (20/s), um script alternando liga/desliga forçaria dez snapshots por segundo.
  // Gente de verdade liga e desliga na mão, e cada aba reanuncia a escolha uma vez por conexão
  // (o `hello` já é freado à parte): dez de rajada e um a cada 2 s nunca aparecem para ela.
  economia: { capacidade: 10, porSegundo: 0.5 },
});

const TIPOS = new Map([
  ['market.comprar', 'mercadoCompra'],
  ['market.criar', 'mercadoAnuncio'],
  ['market.editar', 'mercadoAnuncio'],
  ['market.cancelar', 'mercadoAnuncio'],
  ...[
    'market.listar', 'market.item', 'market.itens', 'market.meus', 'market.favoritos', 'market.favoritar',
    'market.historico', 'market.historicoCompras', 'market.historicoGlobal', 'market.diamantes.cota',
    'shiny.listar', 'p5.listar', 'casas.listar', 'bicicletas.listar',
    'ranking.pedir', 'ranking.perfil', 'ranking.pokemon', 'chat.verPokemon',
    'campeonato.info',
    // Duas leituras por chave primária a cada clique no Auto Selecionar. Fora do balde da
    // `oferenda` de propósito: aquele é o do giro, e gastar uma ficha dele para escolher
    // deixaria quem gira em sequência esperando o dobro.
    'oferenda.protegidos',
  ].map((t) => [t, 'mercadoLeitura']),
  ['shop.buy', 'lojaCompra'],
  // O Passe: o resgate é um por dia (o resto é recusa barata) e a compra passa pelo ledger.
  ['passe.resgatar', 'lojaCompra'],
  ['passe.comprarVip', 'lojaCompra'],
  ['shop.sellItem', 'lojaVenda'],
  ['oferenda.girar', 'oferenda'],
  ['oferenda.tudo', 'oferendaLote'],
  ['colecao.mover', 'colecao'],
  ['treino.lutar', 'treino'],
  ['caixa.npc.abrir', 'caixa'],
  ['bolsa.descartar', 'descarte'],
  ['cliente.economia', 'economia'],
  ['shop.lockPokemon', 'colecao'],
  ['campeonato.fita', 'fita'],
  // O replay da guerra é a leitura mais pesada do jogo (~600 KB de jsonb por pedido) e a análise
  // parte dele. Iam pelo balde geral de 20/s — um script pedia doze megabytes por segundo ao banco.
  ['guild.pvp.replay', 'fita'],
  ['guild.pvp.analise', 'fita'],
  // A fita do PvP amistoso é uma leitura de dezenas de KB no Redis — o mesmo balde das outras.
  ['amigo.pvp.fita', 'fita'],
  ...[
    'guild.info', 'guild.criar', 'guild.editarBrasao', 'guild.convidar', 'guild.aceitar', 'guild.recusar',
    'guild.sair', 'guild.expulsar', 'guild.transferirLider', 'guild.apagar', 'guild.ranking', 'guild.detalhe',
    'guild.pvp.registrar', 'guild.pvp.equipe.salvar',
    'guild.escalacao', 'guild.escalacao.salvar', 'guild.tag', 'guild.subdono',
    'amigos.info', 'amigo.pedir', 'amigo.aceitar', 'amigo.recusar', 'amigo.remover',
    'amigo.dm.abrir', 'amigo.dm.ler', 'amigo.dm.enviar', 'amigo.coins',
    // O PvP amistoso: convidar, responder e cancelar são uma ida ao Redis e outra ao banco cada.
    'amigo.pvp.convidar', 'amigo.pvp.responder', 'amigo.pvp.cancelar',
    // A inscrição no campeonato também é uma ida ao banco por clique — e ninguém entra e sai
    // vinte vezes por segundo.
    'campeonato.inscrever', 'campeonato.cancelar', 'campeonato.equipe',
  ].map((t) => [t, 'social']),
]);

const PARADO_MS = 10 * 60_000;

export function criarLimites({ regras = REGRAS, agora = Date.now } = {}) {
  const contas = new Map();

  function estadoDe(chave, t) {
    let e = contas.get(chave);
    if (!e) {
      e = { baldes: Object.create(null), vistoEm: t, recusas: Object.create(null), logadoEm: 0 };
      contas.set(chave, e);
    }
    e.vistoEm = t;
    return e;
  }

  return {
    /** A categoria de um tipo de mensagem, ou `null` (só vale o limite geral). */
    categoriaDe: (tipo) => TIPOS.get(tipo) ?? null,

    /** Consome uma ficha. `false` = recusar esta mensagem. */
    permitir(chave, categoria, t = agora()) {
      const regra = regras[categoria];
      if (!regra) return true;
      const e = estadoDe(chave, t);
      let b = e.baldes[categoria];
      if (!b) {
        b = { fichas: regra.capacidade, em: t };
        e.baldes[categoria] = b;
      } else {
        b.fichas = Math.min(regra.capacidade, b.fichas + ((t - b.em) / 1000) * regra.porSegundo);
        b.em = t;
      }
      if (b.fichas < 1) {
        e.recusas[categoria] = (e.recusas[categoria] ?? 0) + 1;
        return false;
      }
      b.fichas -= 1;
      return true;
    },

    /**
     * As recusas acumuladas desde o último relato, se já é hora de relatar (uma linha por conta
     * por minuto, no máximo). `null` quando não há o que dizer.
     */
    relatoDeRecusas(chave, t = agora()) {
      const e = contas.get(chave);
      if (!e || t - e.logadoEm < 60_000) return null;
      const partes = Object.entries(e.recusas).filter(([, n]) => n > 0);
      if (!partes.length) return null;
      e.logadoEm = t;
      e.recusas = Object.create(null);
      return partes.map(([c, n]) => `${c}=${n}`).join(' ');
    },

    /** Tira da memória quem está parado há mais de 10 minutos. */
    faxina(t = agora()) {
      for (const [chave, e] of contas) if (t - e.vistoEm > PARADO_MS) contas.delete(chave);
    },

    tamanho: () => contas.size,
  };
}
