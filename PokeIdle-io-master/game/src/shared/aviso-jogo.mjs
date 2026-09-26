// O AVISO DE MUDANÇA — o recado que abre uma vez, no primeiro login depois de um deploy que
// mexeu em algo que o jogador já usava.
//
// É irmão do `discord-pop.mjs` e a mecânica é a mesma: um NÚMERO de versão aqui, o último
// número visto gravado no jogador (`players.aviso_visto`), e o pop-up aparece enquanto o
// segundo for menor que o primeiro. Fechar carimba o número atual e ele não volta.
//
// ### Por que no banco, e não no `localStorage`
//
// "Uma vez" tem de valer para a PESSOA, não para o navegador. No `localStorage` o mesmo
// jogador veria o aviso de novo no celular, na aba anônima e depois de limpar o cache — e um
// recado sobre diamante creditado na conta não pode dar a impressão de que foi creditado três
// vezes.
//
// ### Por que uma versão, e não um booleano
//
// O próximo aviso não vai ser este. Com um número, subir o valor abaixo é tudo o que o
// próximo anúncio precisa: quem já leu o anterior volta a ver, e quem nunca leu nada vê só o
// mais recente. Um booleano obrigaria a limpar a coluna de 5.800 linhas a cada recado.
//
// ### Conta nova não vê
//
// Quem criou a conta depois do deploy nunca pescou, e abrir o jogo pela primeira vez com um
// "fechamos a Pesca" no meio da tela é ruído. O `INSERT` de `players` (em `db.mjs`) já nasce
// com `aviso_visto` no valor de agora, então o recado só alcança quem já estava aqui.

/**
 * AS NOVIDADES, da mais recente para a mais antiga. Cada uma é um slide do modal "Novidades no
 * PokéIdle" (`#aviso-jogo`): a `<section class="novidade" data-aviso="N">` mora no `index.html` e
 * os textos `aviso.*` no `i18n.mjs`. O botão "!" abre o modal na primeira desta lista, e as setas
 * voltam para as antigas.
 *
 * **Novidade nova = uma entrada NO TOPO**, com `aviso` um número acima do anterior. É ela que vira
 * o `AVISO_VERSAO`, e quem ainda não a leu vê o modal sozinho no próximo login.
 *
 *   aviso   o número que o jogador carimba ao fechar (`players.aviso_visto`)
 *   versao  a versão do jogo que trouxe a novidade — vai no título
 *   data    AAAA-MM-DD, o dia em que ela entrou no ar — vai no título, no formato do idioma
 *   ok      a chave do texto do botão de fechar, enquanto ela está na tela
 */
export const NOVIDADES = [
  // A GUILD SEM TETO DE MEMBROS e o TIME de 10 que o dono escala para a Guerra de Guilds — com
  // o painel da guild refeito em faixa + abas. Junto: as automações de cuidado ligadas por
  // padrão, a TAG da guild no chat, as duas dicas que o chat dá sozinho a cada 30 min e o
  // ícone de Coins do Mercado.
  { aviso: 14, versao: '1.154.0', data: '2026-09-22', ok: 'aviso.v14Ok' },
  // AS MEGA EVOLUÇÕES: as 35 formas na aba Mega da Pokédex (#3000), os dois fragmentos que caem
  // em boss, as 70 pedras negociáveis e a bancada do Professor que transforma uma coisa na
  // outra. Junto: o shiny do Totodile e os radares do bot no Discord.
  { aviso: 13, versao: '1.146.0', data: '2026-09-22', ok: 'aviso.v13Ok' },
  // CONVIDE & GANHE (a escada de convites do Discord, com o bot contando quem entra por
  // quem) e o CAMPEONATO AMADOR — o segundo torneio do mes, sem shiny e sem P5, com o
  // Mundial virando mensal e o Torneio abrindo numa lista de campeonatos.
  { aviso: 12, versao: '1.137.0', data: '2026-09-21', ok: 'aviso.v12Ok' },
  // O PASSE DE BATALHA (a trilha de 30 dias, grátis e VIP), o PvP amistoso entre amigos, a análise
  // da última Guerra de Guilds e o resto da leva: histórico do Mercado com P·IV·Q·N, o filtro de
  // Outland, boosts sem limite diário e o menu com Torneio e RMT.
  { aviso: 11, versao: '1.128.0', data: '2026-09-18', ok: 'aviso.v11Ok' },
  // O MODO ECONOMIA (o palco sem cena) com a Tela sempre acesa, o PvP Ranqueado semanal e tudo o
  // que entrou desde a v1.120.0: Oferenda Rápida, caixas mais baratas, a diária do Mercado a
  // 100.000 e a tipagem das 38 espécies da Pokédex.
  { aviso: 10, versao: '1.127.0', data: '2026-09-18', ok: 'aviso.v10Ok' },
  // As CAIXAS DO MARKET — o ralo de Coins — e a Área de Treinamento, a bancada de testes do PvP.
  { aviso: 9, versao: '1.119.0', data: '2026-09-17', ok: 'aviso.v9Ok' },
  // Um mês de jogo: o agradecimento com o que a comunidade movimentou em USDT, e o que entrou
  // desde a novidade 7 — a Coleção, o celular refeito, a guerra mais longa e as correções.
  { aviso: 8, versao: '1.116.0', data: '2026-09-17', ok: 'aviso.v8Ok' },
  // O Campeonato abrindo as inscrições, a Oferenda de Pokémon e as correções que foram juntas.
  { aviso: 7, versao: '1.104.0', data: '2026-09-16', ok: 'aviso.v7Ok' },
  { aviso: 6, versao: '1.99.0', data: '2026-09-15', ok: 'aviso.v6Ok' },
  // Era a 4 (v1.94.0, retenção de 8 h o dia todo). Virou a 5 no mesmo dia, com a retenção pelo
  // horário: quem já tinha fechado a 4 precisa ler a regra certa.
  { aviso: 5, versao: '1.96.0', data: '2026-09-15', ok: 'aviso.v4Ok' },
  { aviso: 3, versao: '1.88.0', data: '2026-09-14', ok: 'aviso.v3Ok' },
  { aviso: 2, versao: '1.86.0', data: '2026-09-13', ok: 'aviso.ok' },
  { aviso: 1, versao: '1.69.0', data: '2026-09-11', ok: 'aviso.pescaOk' },
];

/** Versão do aviso atual — sempre a da novidade mais recente. */
export const AVISO_VERSAO = NOVIDADES[0].aviso;

/** @param {number|undefined|null} vista o último aviso que o jogador fechou */
export function avisoDeveMostrar(vista) {
  return (Number(vista) || 0) < AVISO_VERSAO;
}
