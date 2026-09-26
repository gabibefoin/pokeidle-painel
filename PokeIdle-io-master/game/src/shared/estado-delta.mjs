// A remontagem do estado que chega em DELTA.
//
// O servidor parou de mandar o quadro inteiro do jogador a cada meio segundo. A coleção de
// pokémon de quem joga há um mês passa de 200 bichos, e reenviá-la a cada golpe recebido era
// 97% de toda a banda do jogo — 2,7 TB por dia. Agora vêm só as chaves que mudaram e só os
// pokémon que mudaram (ver `estadoParaEnviar` em `server/sim.mjs`).
//
// Este arquivo é o outro lado dessa conversa, e mora em `shared/` por um motivo prático: o
// cliente do jogo e as ferramentas de teste (`tools/teste-*.mjs`) são DOIS consumidores do
// mesmo protocolo. Uma implementação em cada lugar seria uma chance de elas divergirem em
// silêncio, e a que divergisse seria justamente a que testa a outra.
//
// A remontagem devolve sempre o quadro COMPLETO — as telas continuam lendo `estado.eu` como
// sempre leram, sem saber que ele chegou em pedaços.

/**
 * Cria um mesclador com memória própria. Um por conexão.
 *
 * ```js
 * const mesclar = criarMescladorDeEstado();
 * socket.on('estado', (m) => aplicar(mesclar(m.estado)));
 * ```
 *
 * **A ordem da coleção é preservada de graça pelo `Map`**: `set` numa chave que já existe
 * mantém a posição, e chave nova entra no fim — exatamente o que o `p.pokemons` do servidor
 * faz. Como os dois lados partem do mesmo quadro completo e aplicam as mesmas adições e
 * remoções, a ordem não pode divergir. Isso importa porque a aba do Depot e a chave de cache
 * da Shop dependem dela.
 */
export function criarMescladorDeEstado() {
  let campos = null;
  let pokemons = new Map();

  return function mesclar(parcial) {
    if (!parcial) return campos ? montar() : null;
    const { cheio, pokemons: lista, pkMud, pkFora, dexMud, dexFora, ...resto } = parcial;

    // `cheio` é o marco zero: welcome, login e reconexão. Joga fora o que havia e recomeça.
    // O `!campos` cobre o caso de um delta chegar antes de qualquer quadro completo — não
    // deveria acontecer, mas tratar como base é melhor do que remontar em cima do nada.
    if (cheio || !campos) {
      campos = resto;
      pokemons = new Map((lista ?? []).map((k) => [k.id, k]));
      return montar();
    }

    // Chave ausente quer dizer "não mudou"; `null` explícito é o servidor apagando.
    Object.assign(campos, resto);
    // Uma lista completa ainda pode chegar fora de um pacote `cheio`; nesse caso ela
    // SUBSTITUI a coleção em vez de somar a ela.
    if (lista) pokemons = new Map(lista.map((k) => [k.id, k]));
    for (const k of pkMud ?? []) pokemons.set(k.id, k);
    for (const id of pkFora ?? []) pokemons.delete(id);
    // A Pokédex vem pelo mesmo caminho da coleção: só as espécies que mudaram. O objeto é
    // RECRIADO em vez de mutado — há tela que guarda a referência anterior para comparar, e
    // mutar em cima faria as duas apontarem para o mesmo lugar e o "mudou?" dar sempre não.
    if (dexMud || dexFora) {
      campos.pokedex = { ...(campos.pokedex ?? {}), ...(dexMud ?? {}) };
      for (const chave of dexFora ?? []) delete campos.pokedex[chave];
    }
    return montar();
  };

  function montar() {
    return { ...campos, pokemons: [...pokemons.values()] };
  }
}
