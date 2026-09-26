// A FICHA DE UMA PARTIDA DE PvP — o que sobra da fita depois que ela é jogada fora.
//
// ### O problema que isto resolve
//
// O ranqueado não guarda replay, e a decisão está explicada no cabeçalho de
// `pvp-ranqueado-db.mjs`: a fita são ~40 KB que se assistem uma vez, nos dez segundos depois
// da partida, por alguém que já estava online. Guardá-las seria dezenas de MB por dia de um
// conteúdo com uma audiência só.
//
// Só que o jogador não quer a FITA — ele quer o que ela conta. "Qual dos meus cinco apanhou
// sem bater?", "contra que espécie eu perco sempre?", "que golpe rendeu o dano?" são perguntas
// que a fita responde e o placar ("você perdeu, -14 PR") não. Hoje a única forma de respondê-las
// é assistir a todas as partidas ao vivo — o que empurra a análise para quem passa o dia
// logado, exatamente ao contrário de um jogo idle.
//
// A ficha é o meio-termo: a fita é analisada no instante em que a partida acaba, AINDA na
// memória do processo que a simulou, e o que vai para o banco é o RESUMO — de ~40 KB para
// ~1,5 KB, com tudo que as perguntas acima pedem. A fita continua sendo descartada.
//
// ### Por que reusa o analisador da Guerra de Guilds
//
// `analisarGuerra` já percorre a fita golpe a golpe acompanhando o HP de cada slot, casa a
// troca de pokémon com o golpe que a causou e sabe a diferença entre dano BRUTO e EFETIVO (um
// golpe de 400 num alvo com 30 de HP vale 30, senão quem dá o último golpe fica com o crédito
// de um dano que ninguém levou). Escrever isso de novo aqui seria ter duas contas de dano no
// jogo, e um dia elas discordariam — o relatório do PvP diria um número e o da guerra outro
// para a mesma pancada.
//
// O que sai daqui é a MESMA análise, condensada: uma partida de PvP tem dois lados de um
// membro cada, então as listas "por jogador" da guerra viram dois lados, e o ranking de
// golpes — que na guerra é um só, da batalha inteira — vira um por lado (é o que faz sentido
// quando os "times" são duas pessoas).
//
// ### O formato é conservador de propósito
//
// A ficha vai para uma coluna `JSONB` que fica 30 dias (`RETENCAO_PARTIDAS_DIAS`). Chaves
// curtas e listas cortadas no topo: o que não couber aqui já está somado nas tabelas de
// agregado do Tracker (`tracker-db.mjs`), que não vencem.
import { analisarGuerra } from './guild-pvp-analise.mjs';

/** A versão do formato da ficha. Quem lê confere antes de interpretar. */
export const VERSAO_FICHA = 1;

/** Golpes listados por lado. Quatro cobre o time de cinco sem virar tabela. */
const TOP_GOLPES = 4;

/**
 * O resumo analítico de uma partida de PvP (ranqueado, campeonato ou amistoso).
 *
 * @param replay  a fita recém-simulada, ainda em memória
 * @param opts.nickA / opts.nickB  os nicks, só para conferência — a fita já os traz
 * @returns a ficha, ou `null` se a fita não deu para analisar (guerra sem golpe gravado,
 *          fita truncada pelo teto de quadros). `null` é gravado como `null` na coluna, e a
 *          tela simplesmente não mostra o relatório daquela partida — nunca um erro.
 */
export function fichaDaPartida(replay, { nickA = null, nickB = null } = {}) {
  const a = analisarGuerra(replay, {}, { golpesPorLado: true });
  if (!a || !Array.isArray(a.jogadores) || a.jogadores.length !== 2) return null;

  // Sem nenhum golpe gravado não há o que relatar: a fita veio cortada (ver
  // `LIMITE_LUTADORES_GOLPES` no simulador) ou a partida acabou antes da primeira pancada.
  if (a.semGolpes || !(a.totais?.golpes > 0)) return null;

  const golpesDoLado = (g) => (a.golpesPorLado ?? [])
    .filter((x) => x.g === g)
    .slice(0, TOP_GOLPES)
    .map((x) => ({ n: x.n, t: x.t, u: x.usos, d: x.d }));

  const lado = (g) => {
    const j = a.jogadores.find((x) => x.g === g);
    if (!j) return null;
    return {
      nick: j.nick,
      d: j.d,
      r: j.r,
      k: j.k,
      // Pokémon próprios que caíram. O nome do campo vem da análise da guerra (`mo`, de
      // "mortos"), e é mantido para as duas telas lerem o mesmo dicionário.
      mo: j.mo,
      gl: j.gl,
      sup: j.sup,
      // Sobreviveu com alguém de pé? É o "wipe" do lado perdedor visto do outro lado.
      vivo: j.vivo,
      // A ORDEM É A DA ENTRADA EM CAMPO, e ela é informação: o primeiro é a liderança do time,
      // o último é quem segurou (ou nunca entrou, e aí nem aparece aqui).
      pks: (j.pks ?? []).map((pk) => ({
        e: pk.e || 0,
        n: pk.n,
        lt: pk.lt,
        nv: pk.nv,
        sh: pk.sh,
        d: pk.d,
        r: pk.r,
        k: pk.k,
        gl: pk.gl,
        caiu: pk.caiu,
      })),
      maior: j.maior ? { v: j.maior.v, n: j.maior.golpe, t: j.maior.tipo, pk: j.maior.pk } : null,
      golpes: golpesDoLado(g),
    };
  };

  const A = lado(0);
  const B = lado(1);
  if (!A || !B) return null;
  // A fita nomeia os lados pelo nick do treinador; se por algum motivo eles não baterem com os
  // da partida, a ficha é descartada em vez de gravar um relatório atribuído a quem não lutou.
  if ((nickA && A.nick !== nickA) || (nickB && B.nick !== nickB)) return null;

  return {
    v: VERSAO_FICHA,
    dur: a.dur ?? 0,
    golpes: a.totais?.golpes ?? 0,
    lados: [A, B],
  };
}
