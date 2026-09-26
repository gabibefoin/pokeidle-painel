/**
 * Drops que o espelho não tem: a fonte da Sun Stone, e a pedra própria de nove espécies dele.
 *
 * ### O buraco
 *
 * Das dezoito pedras de evolução do jogo, dezesseis caem de alguma hunt: a Water Stone de 61
 * espécies, a Leaf Stone de 54, a Cocoon Stone de 23. **A Sun Stone cai de zero.** E ela não é
 * decorativa: é a pedra do tipo NORMAL, e **34 evoluções dependem dela** — Rattata→Raticate no
 * nv 30, Meowth→Persian no 50, Chansey→Blissey no 1.125, Ursaring→Ursaluna no 58.900. Todas
 * inalcançáveis por caça.
 *
 * ### Quem dropa
 *
 * A regra que o espelho segue, medida espécie a espécie: **a pedra cai de pokémon do tipo
 * dela.** Water Stone vem de WATER em 84% dos casos, Fire de FIRE em 88%, Leaf de GRASS em 91%,
 * Cocoon de BUG em 100%. A lista abaixo é NORMAL, e só espécies que estão numa hunt jogável —
 * drop em bicho inalcançável não é drop.
 *
 * A cobertura acompanha a escada das regiões (nv 1 → 34.650) porque a demanda também acompanha:
 * não adianta a única fonte estar em Alola quando o Rattata precisa da pedra no nv 30. A faixa
 * de Hoenn usa os clones `13xxx`, que são as espécies que aquelas hunts de fato spawnam.
 *
 * ### A porcentagem
 *
 * `chance / 1000 = %` (ver `rolarLoot` em `game/combate.mjs`). Os valores ficam em 0,30%–0,60%,
 * que é a faixa das outras pedras em hunt: mediana 0,37% na Water Stone, 0,40% na Fire, 0,47%
 * na Leaf e na Cocoon. Os 3,03% que aparecem na Water Stone são do **Brave Blastoise**, uma
 * variante de Outland — outro patamar de raridade, não a norma de hunt.
 */

/** `nome do item → { pokeId: chance }`. `chance/1000` é a porcentagem por abate. */
export const DROPS_NOSSOS = {
  'Sun Stone': {
    // --- Kanto / Johto (nv 1–100): onde mora metade da demanda
    19: 300,     // Rattata      nv 1
    161: 300,    // Sentret      nv 10
    52: 350,     // Meowth       nv 20
    206: 400,    // Dunsparce    nv 30
    216: 400,    // Teddiursa    nv 30
    190: 400,    // Aipom        nv 40
    234: 450,    // Stantler     nv 50
    113: 450,    // Chansey      nv 60
    128: 450,    // Tauros       nv 60
    241: 500,    // Miltank      nv 80
    143: 600,    // Snorlax      nv 100
    // --- Hoenn (nv 500–700): clones 13xxx, que é o que essas hunts spawnam
    13263: 450,  // Zigzagoon    nv 500
    13352: 450,  // Kecleon      nv 550
    13335: 500,  // Zangoose     nv 600
    13288: 500,  // Vigoroth     nv 700
    // --- Sinnoh (nv 1.000–1.250)
    399: 500,    // Bidoof       nv 1.000
    427: 500,    // Buneary      nv 1.000
    431: 500,    // Glameow      nv 1.000
    424: 500,    // Ambipom      nv 1.250
    289: 550,    // Slaking      nv 1.250
    // --- Unova (nv 5.000–8.600)
    504: 500,    // Patrat       nv 5.000
    572: 500,    // Minccino     nv 5.000
    531: 550,    // Audino       nv 5.400
    505: 550,    // Watchog      nv 6.950
    508: 550,    // Stoutland    nv 8.600
    // --- Kalos / Alola (nv 10.000–34.650)
    659: 550,    // Bunnelby     nv 10.000
    734: 600,    // Yungoos      nv 25.000
    735: 600,    // Gumshoos     nv 34.650
    760: 600,    // Bewear       nv 34.650
  },

  // ------------------------------------------------------------------------------------
  // A pedra que a PRÓPRIA espécie precisa, nas nove de Sinnoh–Alola que vieram do espelho.
  //
  // O gerador de loot (`tools/povoar-loot-regioes.mjs`) garante isso para as 394 espécies que
  // moram em `creatures-novos.json`, que é arquivo nosso. Estas nove moram em
  // `public/data/creatures.json`, que é espelho regenerável — um `npm run fetch` desfaria
  // qualquer edição lá, então o conserto delas mora aqui, como o da Sun Stone.
  //
  // Todas evoluem, nenhuma soltava a pedra de que precisa, e **cada hunt tem uma espécie só**:
  // quem farmava Tirtouga não tinha como tirar dele a Water Stone que o Carracosta pede. As
  // chances são a MEDIANA daquela pedra em Kanto/Johto, que é a régua do resto do arquivo.
  'Water Stone': {
    564: 312,    // Tirtouga  → Carracosta
  },
  'Rock Stone': {
    410: 300,    // Shieldon  → Bastiodon
    566: 300,    // Archen    → Archeops
  },
  'Punch Stone': {
    447: 556,    // Riolu     → Lucario
    13447: 556,  // Riolu (clone Orre, o que a hunt de Sinnoh usa)
    674: 556,    // Pancham   → Pangoro
  },
  'Cocoon Stone': {
    636: 346,    // Larvesta  → Volcarona
  },
  'Heart Stone': {
    669: 397,    // Flabébé   → Floette
    670: 397,    // Floette   → Florges
  },
  'Venom Stone': {
    690: 466,    // Skrelp    → Dragalge
  },
  // Linha Dratini mora no espelho (`public/data/creatures.json`) — mesma régua dos DRAGON
  // em `creatures-novos.json` (chance 71 ≈ 0,071%).
  'Ancient Stone': {
    147: 71,     // Dratini    nv 30
    148: 71,     // Dragonair  nv 80
    149: 71,     // Dragonite  nv 100 — refino DRAGON
    2011: 71,    // Ancient Dragonair  nv 150 — Outland
  },
  // Dragonite é DRAGON/FLYING: a Crystal Stone do espelho sai; Feather Stone no mesmo patamar.
  'Feather Stone': {
    149: 85,     // Dragonite  nv 100 — refino FLYING (~Crystal Stone que saiu)
  },
};

/** `pokeId → [nome do item]` — tira do espelho o que a curadoria nossa substitui ou não quer. */
export const DROPS_REMOVIDOS = {
  149: ['Crystal Stone'], // Dragonite — Feather Stone no lugar
};

/**
 * Escreve os drops na lista de espécies. Devolve quantas entradas entraram.
 *
 * Não duplica: espécie que já dropa aquele item fica como está — se um dia o espelho passar a
 * trazer a Sun Stone, a tabela daqui sai de cena sozinha em vez de somar duas linhas na ficha.
 *
 * Rode nas DUAS pontas. O cliente monta o catálogo dele do zero em `carregarCatalogoEspecies` e
 * desenha a lista de drops direto de `especie.loot` (`listaDropsEspecie`); drop que só o
 * servidor conhecesse cairia na hunt sem aparecer na Pokédex.
 */
export function aplicarDropsNossos(lista) {
  let escritos = 0;
  for (const c of lista) {
    const tirar = DROPS_REMOVIDOS[c.pokeId];
    if (tirar?.length && c.loot?.length) {
      const set = new Set(tirar);
      c.loot = c.loot.filter((l) => !set.has(l.name));
    }
    for (const [nome, porId] of Object.entries(DROPS_NOSSOS)) {
      const chance = porId[c.pokeId];
      if (!chance) continue;
      c.loot ??= [];
      if (c.loot.some((l) => l.name === nome)) continue;
      c.loot.push({ name: nome, chance, minCount: 1, maxCount: 1 });
      escritos++;
    }
  }
  return escritos;
}
