/**
 * OFERENDA DE POKÉMON — o lado do servidor: quem pode entrar na roleta, e quem gira.
 *
 * A matemática da roleta mora em `shared/oferenda.mjs` (a mesma que a tela desenha). Aqui está
 * o que só o servidor pode dizer: **de quem são esses pokémon**, e qual fatia saiu.
 *
 * ### A lista que chega do cliente é um PEDIDO, não um fato
 *
 * `oferenda.girar` traz até cinco números. Nenhum deles é confiável, e são quatro os furos que a
 * validação abaixo fecha — todos exploráveis com uma linha no console do navegador:
 *
 * 1. **id repetido.** Mandar o mesmo Gengar cinco vezes faria uma roleta de 100% Darkness Stone
 *    ao preço de um pokémon. É a fraude mais barata da lista, e por isso a deduplicação vem
 *    antes de qualquer outra conta.
 * 2. **id de outra pessoa.** `p.pokemons` é a coleção EM MEMÓRIA do dono; um id que não está lá
 *    não existe para esta função. Isso cobre de graça o pokémon já vendido, o já anunciado no
 *    Mercado (o escrow o esconde de `carregarPokemons`) e o do vizinho.
 * 3. **o pokémon que ele não quer perder.** Equipe, o que está lutando e Exp. Share equipado —
 *    três das quatro travas de `shop.sellPokemon`, porque o efeito aqui é o mesmo dela: a linha
 *    some para sempre. E mais uma que a venda não tem: o **posto de XP Share de uma Casa**. O
 *    posto só aceita quem está na equipe, então a trava da equipe já o cobria — mas a recusa
 *    tem de dizer ONDE o pokémon está preso, senão o jogador procura na equipe e não na Casa.
 *
 *    **O CADEADO DE VENDA não entra nessa lista, e é de propósito.** Ele existe contra a venda em
 *    LOTE: o botão "vender o depot inteiro" apaga dezenas de linhas num clique, e o cadeado é o
 *    que diz quais ficam de fora. A oferenda não tem nada disso — são cinco escolhas, uma por casa,
 *    cada uma por um card com a ficha do bicho na frente, e um diálogo de confirmação no fim que
 *    conta quantos shinys vão. Herdar o cadeado aqui obrigaria a destravar um a um para usar a
 *    tela, e o cadeado do Mercado NPC passaria a significar duas coisas diferentes.
 *
 *    A consequência é real e está assumida: dá para oferendar um shiny sem destravá-lo antes. O
 *    que segura agora é a escolha explícita mais o aviso do diálogo — ver `confirmarOferenda`,
 *    no cliente.
 * 4. **esvaziar a conta.** Como na venda, o último pokémon não sai — um treinador sem nenhum
 *    fica preso numa tela que não sabe se desenhar.
 *
 * ### O sorteio é do servidor, e é conferível
 *
 * Quem sorteia é o `randomInt` do `node:crypto` (uniforme por rejeição — um `% total` sobre
 * bytes crus enviesaria as primeiras fatias). O cliente recebe a roleta INTEIRA mais o índice
 * que saiu, e anima até ali: a animação é consequência do resultado, nunca a causa. E a linha da
 * auditoria guarda os pesos, o total e a fatia sorteada, então uma reclamação de "a roleta é
 * viciada" se responde com dado, não com opinião.
 */

import { randomInt } from 'node:crypto';
import { ehXpShareHeldItem } from '../../shared/xp-share-held.mjs';
import {
  OFERENDA_CASAS,
  montarRoleta,
  sortearFatia,
  resumoDaRoleta,
  montarLoteDaOferenda,
} from '../../shared/oferenda.mjs';

// `montarLoteDaOferenda` passa direto: a escolha do lote é matemática pura (crivo, ordem e
// grupos de cinco) e mora no `shared` para o cliente prever exatamente o que o sim vai girar.
// O sim importa tudo o que é oferenda por aqui, e abrir uma segunda porta para o `shared` só
// para esta função deixaria o mesmo assunto entrando por dois caminhos.
export { OFERENDA_CASAS, montarLoteDaOferenda };

/**
 * Ids vindos do cliente: inteiros positivos, sem repetição, no máximo as cinco casas.
 *
 * O corte em `OFERENDA_CASAS` é depois da deduplicação de propósito: cortar antes deixaria uma
 * lista de cinco repetições virar um pokémon só e "passar" — só que passando com a roleta errada.
 */
export function idsDaOferenda(lista) {
  if (!Array.isArray(lista)) return [];
  const vistos = new Set();
  // A varredura tem TETO próprio, e não só o do pacote. Uma lista de dez mil repetições do mesmo
  // id nunca chega às cinco casas — ela sairia do laço pelo fim da lista, não pelo `break` de
  // baixo. Hoje o `maxPayload` de 16 kB do gateway já limita isso a alguns milhares, mas esse
  // número mora noutro arquivo: o teto aqui é o que garante que a conta é curta mesmo se lá mudar.
  for (const v of lista.slice(0, 200)) {
    // `typeof` antes do `Number`: `Number([7])` é 7 em JavaScript (o array vira a string "7"),
    // então sem esta linha um `[[7]]` no JSON passaria por id. Não é exploit — o id ainda teria
    // de ser de um pokémon dele —, mas entrada que se disfarça de número é exatamente o tipo de
    // coisa que se recusa na porta, não três funções adiante.
    if (typeof v !== 'number' && typeof v !== 'string') continue;
    const n = Number(v);
    if (!Number.isSafeInteger(n) || n <= 0) continue;
    vistos.add(n);
    if (vistos.size >= OFERENDA_CASAS) break;
  }
  return [...vistos];
}

/**
 * Confere a lista contra a coleção do jogador e monta a roleta.
 *
 * `{ erro }` com CHAVE de i18n quando alguma trava barra (a tela traduz; ver `oferenda.*` no
 * dicionário), ou `{ pokemons, roleta }` pronto para girar. Nada é alterado aqui — quem cobra é
 * o `girar`, dentro da fila de economia.
 */
export function validarOferenda(p, ids, { pedras = null, emPosto = null } = {}) {
  const pedidos = idsDaOferenda(ids);
  if (!pedidos.length) return { erro: 'oferenda.erroVazia' };

  // O último pokémon da conta não sai. A conta é feita sobre o TAMANHO da coleção e não sobre o
  // que sobra da lista pedida: é a mesma regra de `shop.sellPokemon`, e a ordem importa — barrar
  // aqui, antes de olhar pokémon por pokémon, é o que dá a mensagem certa a quem tem três.
  if (p.pokemons.size <= pedidos.length) return { erro: 'oferenda.erroUltimo' };

  const pokemons = [];
  for (const id of pedidos) {
    const pk = p.pokemons.get(id);
    if (!pk) return { erro: 'oferenda.erroNaoTem' };
    if (pk.id === p.activeId) return { erro: 'oferenda.erroAtivo' };
    // Antes da equipe: todo pokémon de posto está na equipe, e "tire da Casa" é a frase que
    // resolve. `emPosto` vem do sim, que é quem tem as casas (`pokemonNoPostoCasa`).
    if (emPosto?.(pk.id)) return { erro: 'oferenda.erroCasa' };
    if (pk.slot != null) return { erro: 'oferenda.erroEquipe' };
    if (ehXpShareHeldItem(pk.heldItemId)) return { erro: 'oferenda.erroXpShare' };
    pokemons.push(pk);
  }

  const roleta = montarRoleta(pokemons, pedras);
  if (!roleta) return { erro: 'oferenda.erroSemPedra' };
  return { pokemons, roleta };
}

/**
 * Gira a roleta já validada. Não mexe no jogador: devolve o que saiu, e quem credita é o sim.
 *
 * A separação é a mesma de `fabricarShinyStone`: a função que sorteia não é a que escreve, para
 * o handler poder apagar os pokémon no banco ANTES de creditar a pedra. Se o `DELETE` falhar,
 * ninguém ganhou nada — a ordem inversa daria a pedra e deixaria os pokémon vivos.
 */
export function girarOferenda(roleta, aleatorioInt = randomInt) {
  const indice = sortearFatia(roleta, aleatorioInt);
  const fatia = roleta.fatias[indice] ?? null;
  return {
    indice,
    fatia,
    ganhou: !!fatia && !fatia.vazio && fatia.itemId != null,
    auditoria: `${resumoDaRoleta(roleta)} → #${indice} ${fatia?.vazio ? 'vazio' : (fatia?.nome ?? '?')}`,
  };
}
