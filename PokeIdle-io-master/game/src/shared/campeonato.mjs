// OS CAMPEONATOS — o calendário, a regra de inscrição, a ordem das seeds e o desenho da chave.
//
// Mora em `shared/` porque três lugares precisam da MESMA conta: o servidor (que congela as
// seeds e recusa inscrição fora do prazo), a tela (que desenha a chave e conta o tempo) e o
// teste. Uma cópia da regra no cliente seria uma tela que promete um confronto que o
// servidor não vai montar.
//
// ### Dois campeonatos, todo mês, para sempre
//
// Não há mais "o campeonato": há um CALENDÁRIO que se gera sozinho, mês a mês, a partir de duas
// regras. Nada é cadastrado à mão — `campeonatoDe('mundial', 2027, 3)` devolve a edição de março
// de 2027 com as datas todas calculadas, e é o mesmo objeto que o servidor e a tela leem.
//
//   **MUNDIAL** — o das lutas no ÚLTIMO dia do mês. Inscrições abrem no dia 16, sem restrição de
//   equipe, prêmio de R$ 1.750 (1000/500/250) e nível 300 de treinador para entrar. É o
//   campeonato "de verdade", em que o topo da tabela se enfrenta com shiny e P5 na mesa.
//
//   **AMADOR** — o das lutas no dia 15. Inscrições abrem no dia 1º, prêmio de R$ 500
//   (300/150/50), nível 100 — e **nem shiny nem P5 entram na equipe**. É essa proibição que dá
//   sentido ao nome: sem ela o amador seria o mundial com prêmio menor, e quem ganharia seria
//   exatamente quem já ganha o outro. Com ela, o que decide é montagem e nível, e não quem
//   abriu a carteira ou teve sorte na captura.
//
// A conta das datas é a MESMA nos dois, e é isso que faz o calendário caber em vinte linhas: o
// dia das lutas (D) é o único parâmetro que muda.
//
//     inscricoesDe   00:00 do dia 16 (mundial) ou do dia 1º (amador)
//     inscricoesAte  00:00 de D−1  — fecham as inscrições, as seeds congelam, a CHAVE aparece
//     equipeAte      23:00 de D−1  — a equipe e a ordem travam, e o retrato de cada uma é tirado
//     lutasEm        00:00 de D    — a primeira onda de partidas roda
//     fimEm          00:00 de D+1
//
// Tudo em horário de Brasília, que é o fuso de quem organiza e paga.
//
// O vão entre `inscricoesAte` e `lutasEm` é o DIA DE ANÁLISE, e é a razão de os instantes serem
// três e não um: com a chave publicada no mesmo instante em que a primeira onda dispara — que
// era como estava —, ninguém chegava a ver contra quem ia lutar. Agora o inscrito passa o dia
// inteiro olhando a chave que já existe e ajustando a equipe contra o adversário que ele JÁ SABE
// qual é, até as 23h.
//
// As seeds congelam em `inscricoesAte` e a equipe em `equipeAte` por motivos diferentes: a seed
// precisa parar para a chave poder ser desenhada e anunciada, e a equipe precisa continuar para
// o dia de análise ter o que analisar. São dois congelamentos, em dois momentos (ver
// `congelarChave` e `congelarEquipes` em `campeonato-db.mjs`).
//
// ### O formato da chave
//
// Eliminação dupla com SEED, e grande final ÚNICA: o campeão da chave dos vencedores contra o
// da chave dos perdedores, e quem vence é o campeão — sem partida de desempate.
//
// A seed é a posição do jogador no PvP Ranqueado entre os inscritos: quem está mais alto na
// tabela é a Seed 1. Na primeira rodada a Seed 1 enfrenta a última, a 2 enfrenta a
// penúltima, e assim por diante — e a ordem das partidas na chave é a clássica (1-8, 4-5, 2-7,
// 3-6 numa chave de 8), que põe a 1 e a 2 em lados opostos: as duas só podem se cruzar na
// final.
//
// Quando os inscritos não fecham uma chave cheia (4, 8, 16, 32…), as vagas que sobram são
// BYE, e elas caem para as melhores seeds — é o que a regra "1 contra a última" dá sozinha
// numa chave do tamanho da próxima potência de 2. É o padrão do start.gg e do Battlefy.
//
// ### As partidas rodam sozinhas
//
// Fechadas as inscrições, a chave é jogada inteira pelo servidor, em ONDAS: a cada
// `intervaloOndaMs`, toda partida cujos dois lados já são conhecidos é simulada de uma vez (a
// mesma luta do PvP Ranqueado). Quem perde na chave dos vencedores cai para a dos perdedores;
// quem perde na dos perdedores está fora. Cada partida guarda a fita, e qualquer jogador assiste.
//
// ### As fitas têm prazo de validade
//
// Guardar o replay de toda partida de todo campeonato, para sempre, é encher o banco com vídeo
// que ninguém abre. A regra é: as fitas de um campeonato ficam assistíveis até a CHAVE DO
// CAMPEONATO SEGUINTE ser publicada (`inscricoesAte` do próximo, de qualquer tipo). Dali em
// diante a tela mostra só o pódio, e as fitas são apagadas do banco de vez — ver
// `replaysAbertos` e `apagarReplaysVencidos` em `campeonato-db.mjs`.
//
// Na prática: o Mundial de 30/09 fica assistível até o dia 14/10, quando a chave do Amador de
// 15/10 é publicada; o Amador de 15/10 fica até 30/10, quando sai a chave do Mundial de 31/10.

/** Fuso de Brasília em ms (UTC−3). O dia dos campeonatos vira às 03:00 UTC. */
const FUSO_MS = 3 * 60 * 60 * 1000;

export const FUSO_CAMPEONATO = 'America/Sao_Paulo';

/** O instante (ms) de `dia/mes/ano hora:00` em Brasília. `mes` é 1..12. */
const instante = (ano, mes, dia, hora = 0) => Date.UTC(ano, mes - 1, dia, hora) + FUSO_MS;

/** Quantos dias tem o mês. `Date.UTC(ano, mes, 0)` é o último dia de `mes` (1..12). */
export const ultimoDiaDoMes = (ano, mes) => new Date(Date.UTC(ano, mes, 0)).getUTCDate();

const doisDigitos = (n) => String(n).padStart(2, '0');

export const TIPO = Object.freeze({ MUNDIAL: 'mundial', AMADOR: 'amador' });

/**
 * As duas regras. Tudo o que distingue um campeonato do outro está aqui — o resto do arquivo
 * não sabe que existem dois tipos.
 *
 * `dia(ano, mes)` é o dia das LUTAS, e é o único parâmetro de onde saem os outros quatro
 * instantes. `desde` é o mês da edição nº 1: é dele que sai o `numero` de toda edição seguinte,
 * e é ele que impede o calendário de inventar um "Mundial nº 0" em agosto de 2026.
 *
 * `restricoes` é lido pelo servidor na hora de aceitar uma equipe e na hora de congelar o
 * retrato dela (ver `conferirTime` em `pvp-ranqueado-db.mjs`). Um campeonato sem restrição tem
 * o objeto vazio, e não `null`: quem lê nunca precisa testar a existência.
 */
export const REGRAS = Object.freeze({
  [TIPO.MUNDIAL]: Object.freeze({
    tipo: TIPO.MUNDIAL,
    dia: (ano, mes) => ultimoDiaDoMes(ano, mes),
    inscricoesDe: 16,
    premios: Object.freeze([1000, 500, 250]),
    nivelMin: 300,
    restricoes: Object.freeze({}),
    logo: '/img/campeonato-logo.png',
    desde: Object.freeze({ ano: 2026, mes: 9 }),
  }),
  [TIPO.AMADOR]: Object.freeze({
    tipo: TIPO.AMADOR,
    dia: () => 15,
    inscricoesDe: 1,
    premios: Object.freeze([300, 150, 50]),
    // 100, e não os 300 do Mundial. O amador existe para quem ainda não chegou lá — uma trava
    // de 300 deixaria de fora exatamente o público dele. Baixa o bastante para ser alcançável
    // em algumas semanas de jogo, alta o bastante para uma conta criada na véspera não entrar
    // numa disputa com R$ 500 na mesa.
    nivelMin: 100,
    // Sem shiny e sem P5 (potência máxima). Ver o cabeçalho.
    restricoes: Object.freeze({ semShiny: true, semP5: true }),
    logo: '/img/campeonato-amador-logo.png',
    desde: Object.freeze({ ano: 2026, mes: 10 }),
  }),
});

/** Os tipos na ordem em que a lista da tela os mostra. */
export const TIPOS = Object.freeze([TIPO.MUNDIAL, TIPO.AMADOR]);

/** O intervalo entre duas ondas. Uma chave de 128 dá ~14 ondas — pouco mais de uma hora. */
export const INTERVALO_ONDA_MS = 5 * 60_000;

const cache = new Map();

/**
 * A edição de um tipo num mês. Objeto congelado, memoizado — o mesmo `id` devolve sempre o
 * mesmo objeto, então dá para comparar por identidade.
 *
 * Devolve `null` para um mês anterior ao `desde` daquele tipo.
 */
export function campeonatoDe(tipo, ano, mes) {
  const r = REGRAS[tipo];
  if (!r) return null;
  const numero = (ano - r.desde.ano) * 12 + (mes - r.desde.mes) + 1;
  if (numero < 1) return null;
  const chave = `${tipo}:${ano}-${mes}`;
  if (cache.has(chave)) return cache.get(chave);

  const D = r.dia(ano, mes);
  const c = Object.freeze({
    tipo,
    numero,
    // A chave das inscrições no banco. É a data das lutas, que é o que distingue uma edição da
    // seguinte — e o que ninguém confunde lendo uma linha de `campeonato_inscricoes`.
    id: `${ano}-${doisDigitos(mes)}-${doisDigitos(D)}`,
    ano,
    mes,
    // O dia das lutas, como a tela escreve (AAAA-MM-DD, em Brasília).
    dia: `${ano}-${doisDigitos(mes)}-${doisDigitos(D)}`,
    // O último dia em que dá para se inscrever. As inscrições fecham na VIRADA de D−2 para
    // D−1, então o último dia inteiro de inscrição é D−2.
    ultimoDiaInscricao: `${ano}-${doisDigitos(mes)}-${doisDigitos(D - 2)}`,
    // O dia e a hora em que a equipe trava, como a tela escreve.
    diaEquipe: `${ano}-${doisDigitos(mes)}-${doisDigitos(D - 1)}`,
    horaEquipe: '23:00',
    inscricoesDe: instante(ano, mes, r.inscricoesDe),
    // Virada de D−2 para D−1. A partir daqui não entra nem sai ninguém, as seeds congelam e a
    // CHAVE é publicada — é o começo do dia de análise.
    inscricoesAte: instante(ano, mes, D - 1),
    // 23:00 de D−1: a equipe e a ordem travam, e o retrato de cada uma é tirado. Uma hora antes
    // das lutas, de propósito — é a folga para o congelamento rodar com calma e para ninguém
    // salvar equipe no mesmo segundo em que a primeira onda começa.
    equipeAte: instante(ano, mes, D - 1, 23),
    // Quando a primeira onda de partidas roda: 00:00 do dia D.
    lutasEm: instante(ano, mes, D),
    // Fim do dia D. Até aqui a equipe dos inscritos fica oculta na ficha pública.
    fimEm: instante(ano, mes, D + 1),
    intervaloOndaMs: INTERVALO_ONDA_MS,
    nivelMin: r.nivelMin,
    premios: r.premios,
    restricoes: r.restricoes,
    logo: r.logo,
  });
  cache.set(chave, c);
  return c;
}

const RE_ID = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * A edição de um `id` (`'2026-09-30'`), ou `null`.
 *
 * Reconstrói pelo calendário em vez de consultar uma tabela: o id só é válido se algum tipo de
 * fato luta naquele dia daquele mês. É isto que faz o `campeonato.info` do cliente poder receber
 * um id qualquer sem virar uma consulta a uma tabela arbitrária do banco — um id que não sai do
 * calendário não existe, e ponto.
 */
export function campeonatoPorId(id) {
  const m = RE_ID.exec(String(id ?? ''));
  if (!m) return null;
  const [, ano, mes, dia] = m.map(Number);
  if (mes < 1 || mes > 12) return null;
  for (const tipo of TIPOS) {
    const c = campeonatoDe(tipo, ano, mes);
    if (c && REGRAS[tipo].dia(ano, mes) === dia) return c;
  }
  return null;
}

/** Um mês para frente ou para trás, sem estourar o ano. */
const passo = (ano, mes, n) => {
  const t = (ano * 12 + (mes - 1)) + n;
  return { ano: Math.floor(t / 12), mes: (t % 12) + 1 };
};

/**
 * TODAS as edições que a tela precisa conhecer: as que ainda vão acontecer e as que já
 * aconteceram, ordenadas da mais próxima de agora para a mais antiga.
 *
 * O calendário é infinito para os dois lados, então os dois lados são cortados: `futuros` conta
 * quantas edições adiante de cada tipo entram (uma basta — a seguinte ainda nem abriu inscrição)
 * e `passados` quantas edições encerradas a lista guarda. Sem o corte, a lista de 2030 teria
 * cinquenta linhas mortas.
 */
export function listaDeCampeonatos(agora = Date.now(), { passados = 8, futuros = 1 } = {}) {
  const { ano, mes } = { ano: new Date(agora).getUTCFullYear(), mes: new Date(agora).getUTCMonth() + 1 };
  const todos = [];
  for (const tipo of TIPOS) {
    // Da edição nº 1 até `futuros` meses à frente. O limite de 240 meses é uma trava de
    // sanidade: vinte anos de calendário é muito mais do que a lista jamais vai mostrar, e é o
    // que impede um `desde` errado de virar um laço infinito.
    const r = REGRAS[tipo];
    for (let n = 0; n < 240; n++) {
      const p = passo(r.desde.ano, r.desde.mes, n);
      const c = campeonatoDe(tipo, p.ano, p.mes);
      if (!c) continue;
      todos.push(c);
      const adiante = (p.ano * 12 + p.mes) - (ano * 12 + mes);
      if (adiante >= futuros && c.lutasEm > agora) break;
    }
  }
  const vivos = todos.filter((c) => agora < c.fimEm).sort((a, b) => a.lutasEm - b.lutasEm);
  const mortos = todos.filter((c) => agora >= c.fimEm).sort((a, b) => b.lutasEm - a.lutasEm);
  return [...vivos, ...mortos.slice(0, passados)];
}

/**
 * O campeonato que a tela abre por padrão: o mais próximo de acontecer que ainda não acabou; se
 * nenhum, o último que acabou.
 */
export function campeonatoAtivo(agora = Date.now()) {
  const lista = listaDeCampeonatos(agora);
  return lista.find((c) => agora < c.fimEm) ?? lista[0] ?? null;
}

/**
 * Os campeonatos que já começaram a aceitar inscrição e ainda não acabaram — os que o servidor
 * precisa acordar para congelar, jogar e concluir.
 */
export const campeonatosVivos = (agora = Date.now()) =>
  listaDeCampeonatos(agora, { passados: 2 }).filter((c) => agora >= c.inscricoesDe && agora < c.fimEm);

/**
 * O campeonato seguinte a `c` no calendário, de qualquer tipo, ou `null`.
 *
 * Sai do CALENDÁRIO, e não de `listaDeCampeonatos`: a lista é podada por "agora" (ela existe
 * para a tela), e o seguinte a uma edição de 2026 continua sendo o mesmo em 2030, mesmo que a
 * lista de então já não mostre nenhum dos dois. Foi exatamente esse o bug que a janela de fitas
 * pegou: perguntando à lista, o seguinte ao Mundial de setembro mudava conforme o dia em que se
 * perguntava, e uma fita que devia estar fechada voltava a abrir.
 *
 * Varre o mês de `c` e os dois seguintes — com uma edição por tipo por mês, o próximo nunca
 * está mais longe do que isso.
 */
export function proximoDepois(c) {
  if (!c) return null;
  let melhor = null;
  for (let n = 0; n <= 2; n++) {
    const p = passo(c.ano, c.mes, n);
    for (const tipo of TIPOS) {
      const x = campeonatoDe(tipo, p.ano, p.mes);
      if (!x || x.lutasEm <= c.lutasEm) continue;
      if (!melhor || x.lutasEm < melhor.lutasEm) melhor = x;
    }
  }
  return melhor;
}

/**
 * Até quando as fitas de `c` ficam assistíveis: até a CHAVE do campeonato seguinte ser
 * publicada. `Infinity` quando não há seguinte (não acontece no calendário real, mas um
 * `Infinity` aqui mantém as fitas em vez de apagá-las por causa de um buraco no calendário).
 */
export const replaysAte = (c) => proximoDepois(c)?.inscricoesAte ?? Infinity;

/** As fitas de `c` ainda podem ser abertas? */
export const replaysAbertos = (c, agora = Date.now()) => agora < replaysAte(c);

// ------------------------------------------------------------------ as fases

/**
 * Em que momento um campeonato está.
 *
 *   `futuro`      as inscrições ainda nem abriram
 *   `inscricoes`  aberto para entrar e sair; as seeds são provisórias e acompanham a tabela
 *   `chaveado`    inscrições encerradas, seeds congeladas, a chave existe
 *   `encerrado`   o dia do campeonato já passou
 *
 * O dia de análise cai dentro de `chaveado`: a chave já existe e as lutas ainda não começaram.
 * Quem precisa separar os dois pergunta a `janelaDeAnalise`, e quem precisa saber se a equipe
 * ainda abre pergunta a `equipeAberta` — a fase sozinha não responde nem uma coisa nem outra.
 */
export function faseDoCampeonato(agora, c) {
  if (!c) return 'encerrado';
  if (agora < c.inscricoesDe) return 'futuro';
  if (agora < c.inscricoesAte) return 'inscricoes';
  if (agora < c.fimEm) return 'chaveado';
  return 'encerrado';
}

export const inscricoesAbertas = (agora, c) =>
  !!c && agora >= c.inscricoesDe && agora < c.inscricoesAte;

/**
 * A equipe e a ordem ainda podem mudar? Vale por todo o dia de análise, até `equipeAte`.
 *
 * É o prazo do jogador, não o do servidor: o retrato congelado é tirado em `equipeAte`, e daí
 * em diante o que vale é ele. Note que isto NÃO exige inscrições abertas — é justamente o
 * contrário, o dia de análise é depois delas.
 */
export const equipeAberta = (agora, c) => !!c && agora >= c.inscricoesDe && agora < c.equipeAte;

/**
 * O dia de análise: a chave já está publicada e a primeira onda ainda não rodou.
 *
 * Devolve `null` fora dele. Dentro, `{ equipeAberta, equipeAte, lutasEm }` — o que a tela
 * precisa para escolher entre "trave sua equipe até as 23h" e "as lutas começam em…".
 */
export function janelaDeAnalise(agora, c) {
  if (!c || agora < c.inscricoesAte || agora >= c.lutasEm) return null;
  return { equipeAberta: equipeAberta(agora, c), equipeAte: c.equipeAte, lutasEm: c.lutasEm };
}

/**
 * A equipe escolhida para um campeonato ainda vale: até o fim do dia dele. É o prazo em que o
 * Auto Selecionar da oferenda não pode pegá-la.
 */
export const equipeDoCampeonatoVale = (agora, c) => !!c && agora < c.fimEm;

/**
 * Pode se inscrever AGORA? `{ ok }` ou `{ ok: false, motivo }` — o motivo é uma chave de texto
 * (`camp.recusa.*`), e é a mesma que o servidor devolve quando recusa.
 */
export function podeInscrever({ nivel, inscrito = false, agora }, c) {
  if (!c) return { ok: false, motivo: 'encerradas' };
  if (agora < c.inscricoesDe) return { ok: false, motivo: 'naoAbriu' };
  if (agora >= c.inscricoesAte) return { ok: false, motivo: 'encerradas' };
  if (inscrito) return { ok: false, motivo: 'jaInscrito' };
  if ((Number(nivel) || 0) < c.nivelMin) return { ok: false, motivo: 'nivel' };
  return { ok: true };
}

// ------------------------------------------------------------- as restrições

/**
 * Um pokémon pode lutar neste campeonato?
 *
 * `pk` só precisa ter `shiny` e `potencia` — serve tanto para a linha crua do banco quanto para
 * o objeto montado. Devolve `null` (pode) ou a chave de texto do motivo, que é a mesma que o
 * servidor devolve na recusa e a tela escreve no seletor.
 */
export function porQueNaoPodeLutar(pk, c) {
  const r = c?.restricoes;
  if (!r) return null;
  if (r.semShiny && (pk?.shiny === true || pk?.shiny === 1)) return 'camp.recusa.semShiny';
  if (r.semP5 && Number(pk?.potencia) >= POTENCIA_PROIBIDA) return 'camp.recusa.semP5';
  return null;
}

/**
 * A potência que o Amador barra. É a `POTENCIA_MAX` de `shared/nota-pokemon.mjs`, copiada aqui
 * como número porque este arquivo é importado pelo bot, pelo servidor e pela tela, e não vale
 * puxar a cadeia inteira da nota do pokémon por uma constante. `tools/teste-campeonato.mjs`
 * confere as duas contra o catálogo.
 */
export const POTENCIA_PROIBIDA = 5;

export const temRestricao = (c) => !!c && Object.keys(c.restricoes ?? {}).length > 0;

// ------------------------------------------------------------------ as seeds

/**
 * A ordem das seeds entre os inscritos. Menor = melhor seed.
 *
 * Primeiro quem tem POSIÇÃO na tabela do ranqueado (já saiu do posicionamento), na ordem da
 * tabela. Depois quem ainda não tem — posicionando, ou que nunca jogou —, pelo que dá para
 * comparar: pontos, vitórias, nível de treinador e, por fim, quem se inscreveu antes. O id do
 * jogador fecha o empate para a ordem ser a mesma em todo processo.
 *
 * Cada item: `{ playerId, posicao (null = sem posição), pontos, vitorias, nivel, inscritoEm }`.
 */
export function compararSeeds(a, b) {
  const pa = a.posicao ?? Infinity;
  const pb = b.posicao ?? Infinity;
  if (pa !== pb) return pa - pb;
  return (Number(b.pontos) || 0) - (Number(a.pontos) || 0)
    || (Number(b.vitorias) || 0) - (Number(a.vitorias) || 0)
    || (Number(b.nivel) || 0) - (Number(a.nivel) || 0)
    || (Number(a.inscritoEm) || 0) - (Number(b.inscritoEm) || 0)
    || (Number(a.playerId) || 0) - (Number(b.playerId) || 0);
}

/** A menor potência de 2 que cabe `n` inscritos (mínimo 2). */
export function tamanhoDaChave(n) {
  let s = 2;
  while (s < n) s *= 2;
  return s;
}

/**
 * As seeds na ordem em que aparecem na primeira rodada, de cima para baixo.
 *
 * Cada par consecutivo é uma partida, e cada par soma `tamanho + 1` — é a regra "1 contra a
 * última, 2 contra a penúltima". A construção por duplicação é a que espalha as melhores:
 * `[1,2]` → `[1,4,2,3]` → `[1,8,4,5,2,7,3,6]`. A 1 e a 2 ficam em metades opostas, a 1 e a 4
 * em quartos opostos, e assim por diante.
 */
export function ordemDasSeeds(tamanho) {
  let ordem = [1, 2];
  while (ordem.length < tamanho) {
    const soma = ordem.length * 2 + 1;
    ordem = ordem.flatMap((s) => [s, soma - s]);
  }
  return ordem;
}

// ------------------------------------------------------------------ a chave

/**
 * A chave inteira de eliminação dupla para `n` inscritos.
 *
 * Devolve `{ tamanho, vencedores, perdedores, final }`: as duas primeiras são listas de
 * RODADAS (cada rodada uma lista de partidas), a última é a grande final (uma partida só).
 *
 * Cada partida: `{ id, lado, rodada, a, b, bye }`, e cada lado de partida é um de:
 *
 *   { seed: 3 }        um inscrito, já sabido
 *   { bye: true }      vaga vazia — quem está do outro lado avança direto
 *   { vence: 'V1-2' }  quem ganhar aquela partida
 *   { perde: 'V2-1' }  quem perder aquela partida (a queda para a chave dos perdedores)
 *
 * Os byes são RESOLVIDOS aqui: se a partida V1-1 é "Seed 1 × vaga vazia", a V2-1 já mostra a
 * Seed 1 em vez de "vencedor da V1-1", e a queda dela para os perdedores vira vaga vazia. É o
 * que faz a chave de 10 inscritos parecer uma chave de 10, e não de 16 com seis buracos.
 *
 * `bye: true` marca a partida que não acontece (um lado ou os dois vazios).
 */
export function montarChave(n) {
  const total = Math.max(0, Math.floor(Number(n) || 0));
  if (total < 2) return null;
  const tamanho = tamanhoDaChave(total);
  const k = Math.log2(tamanho);
  const partidas = new Map();
  const nova = (id, lado, rodada, a, b) => {
    const p = { id, lado, rodada, a, b, bye: false };
    partidas.set(id, p);
    return p;
  };

  // ---- a chave dos vencedores
  const vencedores = [];
  const ordem = ordemDasSeeds(tamanho);
  const r1 = [];
  for (let i = 0; i < tamanho / 2; i++) {
    const lado = (s) => (s <= total ? { seed: s } : { bye: true });
    r1.push(nova(`V1-${i + 1}`, 'V', 1, lado(ordem[2 * i]), lado(ordem[2 * i + 1])));
  }
  vencedores.push(r1);
  for (let r = 2; r <= k; r++) {
    const ant = vencedores[r - 2];
    const rodada = [];
    for (let i = 0; i < ant.length / 2; i++) {
      rodada.push(nova(`V${r}-${i + 1}`, 'V', r, { vence: ant[2 * i].id }, { vence: ant[2 * i + 1].id }));
    }
    vencedores.push(rodada);
  }

  // ---- a chave dos perdedores: 2(k−1) rodadas
  //
  // Rodada ímpar: os vencedores da rodada anterior se enfrentam entre si (na 1ª, os que caíram
  // da primeira rodada dos vencedores). Rodada par: cada sobrevivente enfrenta quem acabou de
  // cair da rodada seguinte dos vencedores. A ordem da queda alterna — invertida numa rodada,
  // direta na outra — para que quem se enfrentou na chave de cima não se reencontre logo de
  // cara na de baixo.
  const perdedores = [];
  for (let j = 1; j <= 2 * (k - 1); j++) {
    const rodada = [];
    if (j === 1) {
      for (let i = 0; i < r1.length / 2; i++) {
        rodada.push(nova(`P1-${i + 1}`, 'P', 1, { perde: r1[2 * i].id }, { perde: r1[2 * i + 1].id }));
      }
    } else if (j % 2 === 0) {
      const m = j / 2;
      const ant = perdedores[j - 2];
      const caem = vencedores[m]; // a rodada m+1 dos vencedores
      const inverte = m % 2 === 1;
      for (let i = 0; i < ant.length; i++) {
        const queda = caem[inverte ? caem.length - 1 - i : i];
        rodada.push(nova(`P${j}-${i + 1}`, 'P', j, { vence: ant[i].id }, { perde: queda.id }));
      }
    } else {
      const ant = perdedores[j - 2];
      for (let i = 0; i < ant.length / 2; i++) {
        rodada.push(nova(`P${j}-${i + 1}`, 'P', j, { vence: ant[2 * i].id }, { vence: ant[2 * i + 1].id }));
      }
    }
    perdedores.push(rodada);
  }

  // ---- a grande final: o campeão dos vencedores contra o dos perdedores, e acabou.
  //
  // Numa chave de dois não há chave dos perdedores: quem perde a única partida É o finalista
  // de baixo, e a grande final é a revanche.
  const campeaoV = vencedores[k - 1][0];
  const deBaixo = perdedores.length
    ? { vence: perdedores[perdedores.length - 1][0].id }
    : { perde: campeaoV.id };
  const gf = nova('GF', 'F', 1, { vence: campeaoV.id }, deBaixo);

  // ---- os byes
  const cache2 = new Map();
  const resolver = (lado) => {
    if (lado.seed != null || lado.bye) return lado;
    const id = lado.vence ?? lado.perde;
    const p = partidas.get(id);
    const a = resolverPartida(p).a;
    const b = resolverPartida(p).b;
    if (lado.vence) {
      if (a.bye && b.bye) return { bye: true };
      if (a.bye) return b;
      if (b.bye) return a;
      return lado;
    }
    // Partida que não acontece não derruba ninguém.
    if (a.bye || b.bye) return { bye: true };
    return lado;
  };
  const resolverPartida = (p) => {
    if (cache2.has(p.id)) return cache2.get(p.id);
    const r = { a: resolver(p.a), b: resolver(p.b) };
    cache2.set(p.id, r);
    return r;
  };
  for (const p of partidas.values()) {
    const r = resolverPartida(p);
    p.a = r.a;
    p.b = r.b;
    p.bye = !!(r.a.bye || r.b.bye);
  }

  return { tamanho, participantes: total, vencedores, perdedores, final: [gf] };
}

/** Todas as partidas da chave, na ordem em que a tela e o servidor as percorrem. */
export const partidasDaChave = (chave) =>
  chave ? [...chave.vencedores.flat(), ...chave.perdedores.flat(), ...chave.final] : [];

/**
 * A chave com os RESULTADOS aplicados.
 *
 * `resultados` é um `Map` de id da partida → `{ vencedor, perdedor }` (seeds). Cada lado que
 * dependia de uma partida já jogada vira o inscrito que saiu dela; o resto continua esperando.
 *
 * Devolve um `Map` de id → `{ partida, a, b, pronta, resultado }`. `pronta` = os dois lados são
 * inscritos conhecidos e a partida ainda não foi jogada — é o que o servidor joga na próxima
 * onda e o que a tela marca como "a jogar". As partidas de bye da montagem (`partida.bye`) não
 * entram em jogo nunca: o que elas produziriam já foi dobrado nas vagas seguintes.
 */
export function resolverChave(chave, resultados = new Map()) {
  const saida = new Map();
  const lado = (l) => {
    if (l.seed != null || l.bye) return l;
    const r = resultados.get(l.vence ?? l.perde);
    if (!r) return l;
    const s = l.vence ? r.vencedor : r.perdedor;
    return s == null ? { bye: true } : { seed: s };
  };
  for (const p of partidasDaChave(chave)) {
    const a = lado(p.a);
    const b = lado(p.b);
    const resultado = resultados.get(p.id) ?? null;
    const pronta = !p.bye && !resultado && a.seed != null && b.seed != null;
    saida.set(p.id, { partida: p, a, b, pronta, resultado });
  }
  return saida;
}

/**
 * O pódio, quando a grande final já foi jogada: `{ campeao, vice, terceiro }` (seeds), ou
 * `null`. O 3º é quem perdeu a final da chave dos perdedores — numa chave de dois, não há.
 */
export function podioDaChave(chave, resultados) {
  const gf = resultados.get('GF');
  if (!chave || !gf) return null;
  const finalP = chave.perdedores.length ? resultados.get(chave.perdedores.at(-1)[0].id) : null;
  return { campeao: gf.vencedor ?? null, vice: gf.perdedor ?? null, terceiro: finalP?.perdedor ?? null };
}

/** Quantas derrotas cada seed já tem. Duas = fora do campeonato. */
export function derrotasPorSeed(resultados) {
  const n = new Map();
  for (const r of resultados.values()) {
    if (r.perdedor != null) n.set(r.perdedor, (n.get(r.perdedor) ?? 0) + 1);
  }
  return n;
}

/**
 * A primeira partida DE VERDADE de uma seed — quem ela enfrenta primeiro, pulando o bye.
 * `null` quando não há chave. Serve ao card do participante ("estreia contra a Seed 9").
 */
export function estreiaDaSeed(chave, seed) {
  if (!chave) return null;
  const rodadas = chave.vencedores;
  for (const rodada of rodadas) {
    for (const p of rodada) {
      if (p.bye) continue;
      const lados = [p.a, p.b];
      const eu = lados.findIndex((l) => l.seed === seed);
      if (eu < 0) continue;
      return { partida: p.id, rodada: p.rodada, contra: lados[1 - eu] };
    }
  }
  return null;
}
