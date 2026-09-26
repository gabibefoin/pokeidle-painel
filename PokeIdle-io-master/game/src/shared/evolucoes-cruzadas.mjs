/**
 * Os elos evolutivos que os JSONs de espécie não têm — e as duas pontas que precisam deles.
 *
 * Este arquivo mora em `shared/` pelo mesmo motivo que `golpes-especiais.mjs`: o cliente monta
 * o catálogo dele do zero em `carregarCatalogoEspecies`, lendo os mesmos JSONs e sem passar
 * pelo `content.mjs`. Elo que só o servidor escrevesse viraria uma Pokédex mentindo
 * "não evolui" num bicho que evolui — foi exatamente o que aconteceu com Vigoroth e Shelgon.
 *
 * A ORDEM de aplicação é parte do contrato, e as duas pontas seguem a mesma:
 *
 *   1. `CADEIAS_TRUNCADAS`          — antes de `injetarGolpesEspeciais`
 *   2. `injetarGolpesEspeciais`
 *   3. `EVOLUCOES_ENTRE_GERACOES`   — depois
 *
 * O golpe de 600 só entra em quem não tem `evolvesToId` (dex ≥ 252). Vigoroth e Shelgon deixam
 * de ser última evolução ANTES da injeção e por isso não ganham o ultimate — é o comportamento
 * que o servidor já tem hoje. Makuhita entra DEPOIS de propósito: ele carrega o golpe desde
 * sempre, tirá-lo agora nerfaria quem já tem um, e a estranheza é anterior a esta tabela.
 */

/**
 * Cadeias que vieram truncadas do espelho — mesma geração, elo perdido no meio.
 *
 * Vigoroth e Shelgon chegaram com `evolvesToId: 0`, o que deixava Slaking e Salamence
 * inalcançáveis por qualquer caminho: nenhum dos dois tem hunt, e a evolução — que seria a
 * forma canônica — morria no meio. Slakoth e Bagon têm hunt em Orre, então consertar o elo
 * entrega os dois sem inventar hunt nenhuma. Compare com Ralts → Kirlia → Gardevoir, que veio
 * inteira e funciona. O nível é 1.250 — onde Slaking e Salamence de fato aparecem, na hunt de
 * Sinnoh. Ver `NIVEIS_POR_ONDE_O_ALVO_APARECE` abaixo para o porquê de não ser 100.
 */
export const CADEIAS_TRUNCADAS = {
  288: { para: 289, nivel: 1_250 },   // Vigoroth → Slaking
  13288: { para: 289, nivel: 1_250 },
  372: { para: 373, nivel: 1_250 },   // Shelgon  → Salamence
  13372: { para: 373, nivel: 1_250 },
  375: { para: 376, nivel: 1_250 },   // Metang   → Metagross (espelho truncava no 600→100)
  13375: { para: 376, nivel: 1_250 },   // Metang Hoenn → Metagross
};

/**
 * Evoluções que atravessam GERAÇÃO — o elo que o espelho não tinha como ter.
 *
 * O `creatures.json` do PokeIdle.io original é um jogo de Kanto/Johto: cada espécie traz o
 * `evolvesToId` que ela tinha NAQUELE catálogo. Quando a evolução só existe numa geração que o
 * espelho não conhecia, o campo veio zerado — e continuou zerado mesmo depois de as sprites de
 * Sinnoh/Galar/Paldea entrarem pelo Sprite Lab. O resultado: Sneasel (Johto, nv 50) era um beco
 * sem saída enquanto Weavile (Sinnoh, nv 1.500) já existia aqui, com arte e com hunt.
 *
 * Ligar o elo é de graça: nenhuma hunt nova, nenhuma sprite nova, nenhum número inventado. A
 * lista abaixo é a varredura completa da Pokédex nacional (541 cadeias evolutivas) contra o
 * nosso catálogo — só entra o par em que os DOIS lados já existem aqui e o alvo tem arte de
 * verdade (`looktype` real, não o `1` de placeholder).
 *
 * ### O nível é o do ALVO, não o da base
 *
 * Sneasel vira Weavile no nv 1.500 porque 1.500 é o `huntLevel` do Weavile — a mesma regra que
 * `aplicarEscalaHuntLevel` já aplica em toda cadeia de Hoenn+ (`c.evolveLevel =
 * porDexNivel.get(dexDe(c.evolvesToId))`). Sem isso um Sneasel de nv 50 viraria de graça um
 * bicho de degrau 1.500 e atropelaria a escada da região inteira.
 *
 * O número está ESCRITO aqui em vez de lido de `destino.huntLevel` porque as duas pontas
 * precisam concordar e elas não enxergam o mesmo catálogo: o servidor ajusta `huntLevel` com
 * `hunts-sinnoh.json`, que o cliente não baixa. Gliscor é o caso — 100 no JSON cru, 1.000 depois
 * do ajuste. Ler o campo daria "Nv 100" na Pokédex e "precisa estar no nível 1000" ao clicar.
 *
 * ### O que fica de fora, de propósito
 *
 * · **Ramificação.** `evolvesToId` é UM campo, e onze bases já usam o delas — Eevee (Vaporeon),
 *   Kirlia (Gardevoir), Snorunt (Glalie), Nincada (Ninjask), Wurmple (Silcoon), Clamperl
 *   (Huntail), Burmy (Wormadam), Gloom (Vileplume), Poliwhirl (Poliwrath), Slowpoke (Slowbro) e
 *   Tyrogue (Hitmontop). Escrever Espeon aqui APAGARIA o Vaporeon. Escolher entre dois destinos
 *   é feature de tela, não de tabela.
 * · **Alvo sem arte.** Sneasler, Kleavor, Overqwil, Wyrdeer, Perrserker, Cursola, Sirfetch'd,
 *   Mr. Rime, Runerigus, Clodsire, Farigiraf, Dudunsparce e Ceruledge estão no catálogo com
 *   `looktype: 1`, o placeholder. Nomear a sprite no Sprite Lab é o único passo que falta; o par
 *   já está mapeado e entra aqui na hora em que a arte existir.
 * · **Alvo que nem existe.** Dipplin, Archaludon e Gholdengo não estão no catálogo.
 */
export const EVOLUCOES_ENTRE_GERACOES = {
  57: { para: 979, nivel: 114_800 }, // Primeape   Kanto → Annihilape Paldea
  82: { para: 462, nivel: 1_500 },   // Magneton   Kanto → Magnezone  Sinnoh
  108: { para: 463, nivel: 1_500 },  // Lickitung  Kanto → Lickilicky Sinnoh
  176: { para: 468, nivel: 1_500 },  // Togetic    Johto → Togekiss   Sinnoh
  190: { para: 424, nivel: 1_250 },  // Aipom      Johto → Ambipom    Sinnoh
  193: { para: 469, nivel: 1_500 },  // Yanma      Johto → Yanmega    Sinnoh
  198: { para: 430, nivel: 1_500 },  // Murkrow    Johto → Honchkrow  Sinnoh
  200: { para: 429, nivel: 1_250 },  // Misdreavus Johto → Mismagius  Sinnoh
  207: { para: 472, nivel: 1_500 },  // Gligar     Johto → Gliscor    Sinnoh
  215: { para: 461, nivel: 1_500 },  // Sneasel    Johto → Weavile    Sinnoh
  217: { para: 901, nivel: 58_900 }, // Ursaring   Johto → Ursaluna   Galar
  221: { para: 473, nivel: 1_500 },  // Piloswine  Johto → Mamoswine  Sinnoh
  233: { para: 474, nivel: 1_500 },  // Porygon2   Johto → Porygon-Z  Sinnoh
  // Makuhita → Hariyama não atravessa geração: é a mesma cadeia truncada do Vigoroth
  // (`CADEIAS_TRUNCADAS` acima), e o espelho de Hoenn tem as duas metades. Vale para o id
  // do espelho e para o clone 13xxx, que é o que a hunt de Hoenn usa.
  296: { para: 297, nivel: 550 },
  13296: { para: 297, nivel: 550 },
};

/**
 * Escreve os elos de uma tabela na lista de espécies. Devolve quantos entraram.
 *
 * Nunca ROUBA uma cadeia existente: `evolvesToId` já preenchido tem preferência, sempre. E o
 * alvo precisa estar na própria lista — sem a espécie de destino carregada, o elo apontaria
 * para um id que nem o servidor nem a tela sabem resolver.
 */
export function aplicarElosEvolutivos(lista, tabela) {
  const porId = new Map(lista.map((c) => [c.pokeId, c]));
  let ligados = 0;
  for (const [id, { para, nivel }] of Object.entries(tabela)) {
    const esp = porId.get(Number(id));
    if (!esp || esp.evolvesToId || !porId.has(para)) continue;
    esp.evolvesToId = para;
    esp.evolveLevel = nivel;
    ligados++;
  }
  return ligados;
}

/** Atalho para `EVOLUCOES_ENTRE_GERACOES` — o passo 3 da ordem descrita no topo. */
export function aplicarEvolucoesEntreGeracoes(lista) {
  return aplicarElosEvolutivos(lista, EVOLUCOES_ENTRE_GERACOES);
}

/**
 * O nível que a evolução pede: o degrau da hunt onde o ALVO aparece.
 *
 * ### O bug, no caso que o denunciou
 *
 * Um Tirtouga prometia evoluir no Nv 6.950 enquanto o Carracosta só tinha hunt em Unova a
 * 6.950 — mas a tabela ainda carregava 1.125 de quando existia marcador fantasma em Sinnoh.
 * O mesmo valia para Larvesta, Archen, Flabébé, Pancham e Skrelp.
 *
 * ### A régua é o MARCADOR, e é o MENOR deles
 *
 * `evolveLevel` = o nível da hunt mais baixa em que o alvo aparece — o degrau em que ele passa
 * a existir no jogo. Menor, e não maior, porque algumas espécies tinham marcador fantasma em
 * Sinnoh (removido em v1.33.0) — a tabela precisa seguir só as hunts do Nomeador.
 *
 * Está escrito à mão, e não lido de `huntsJogaveis`, porque o cliente monta o catálogo dele no
 * boot — antes do `welcome`, que é quem traz as hunts. Número em tabela é o preço de as duas
 * pontas concordarem. `game/tools/gerar-tabela-niveis.mjs` regenera o corpo daqui a partir das
 * hunts reais; rodar ele depois de mexer em marcador é o que mantém a tabela honesta.
 *
 * ### O recorte, em duas metades
 *
 * **1. Alvo em Sinnoh, Unova, Kalos ou Alola** (dex 387–809) com hunt — 171 elos, contando os
 * que já estavam certos, porque uma tabela que só lista as exceções não dá para conferir
 * contra as hunts.
 *
 * **2. Os BEBÊS: base de geração POSTERIOR à do alvo.** Mime Jr. é de Sinnoh e o Mr. Mime é de
 * Kanto, então a hunt do bebê (Nv 1.000) fica muito ACIMA da hunt do alvo (Nv 80) — o inverso
 * de toda cadeia normal. O número certo continua sendo o do alvo, e a consequência é a que se
 * quer: o bebê já nasce acima do degrau e evolui livre. O `evolveLevel: 40` que o espelho
 * herdou fazia isso por acidente, mas anunciava na ficha um degrau que não corresponde a hunt
 * nenhuma — e nos dois casos em que o bebê nasce ABAIXO do alvo (Smoochum, hunt 30 para uma
 * Jynx de 100) o 40 nem servia de trava.
 *
 * Fica de fora:
 *
 * · **Alvo sem hunt jogável** (Herdier, Quilladin, Gogoat, Cosmoem…): não há marcador para ler,
 *   e a ficha deles cai no `huntLevel` da espécie — que é o que o `evolveLevel` já traz.
 * · **Cadeias que abrem em mais de um destino**: o nível delas mora em `EVOLUCOES_RAMIFICADAS`,
 *   senão a tela de escolha e este campo contariam histórias diferentes. Estão conferidas
 *   contra os mesmos marcadores.
 * · **Alvo de Kanto/Johto/Hoenn que NÃO é bebê**: os cinco elos preservados no fim da tabela.
 *   Mexer neles é mexer no começo do jogo, que não é o que esta varredura foi conferir.
 * · **Bonsly e Happiny não estão no catálogo.** São os dois únicos bebês canônicos ausentes;
 *   Sudowoodo (hunt 1.000) e Chansey (hunt 60) existem e esperam por eles.
 */
export const NIVEIS_POR_ONDE_O_ALVO_APARECE = {
  // --- Alvo em SINNOH (dex 387–493)
     82: 1_500, // Magneton   → Magnezone
    108: 1_500, // Lickitung  → Lickilicky
    112: 3_000, // Rhydon     → Rhyperior
    114: 3_000, // Tangela    → Tangrowth
    125: 3_000, // Electabuzz → Electivire
    126: 3_000, // Magmar     → Magmortar
    176: 1_500, // Togetic    → Togekiss
    190: 1_250, // Aipom      → Ambipom
    193: 1_500, // Yanma      → Yanmega
    198: 1_500, // Murkrow    → Honchkrow
    200: 1_250, // Misdreavus → Mismagius
    207: 1_500, // Gligar     → Gliscor
    215: 1_500, // Sneasel    → Weavile
    221: 1_500, // Piloswine  → Mamoswine
    233: 1_500, // Porygon2   → Porygon-Z
    299: 2_000, // Nosepass   → Probopass
    315: 3_500, // Roselia    → Roserade
    356: 3_000, // Dusclops   → Dusknoir
    387: 1_750, // Turtwig    → Grotle
    388: 3_500, // Grotle     → Torterra
    390: 1_750, // Chimchar   → Monferno
    391: 3_500, // Monferno   → Infernape
    393: 1_750, // Piplup     → Prinplup
    394: 3_500, // Prinplup   → Empoleon
    396: 1_750, // Starly     → Staravia
    397: 3_500, // Staravia   → Staraptor
    399: 2_000, // Bidoof     → Bibarel
    401: 2_000, // Kricketot  → Kricketune
    403: 1_750, // Shinx      → Luxio
    404: 3_500, // Luxio      → Luxray
    408: 2_000, // Cranidos   → Rampardos
    410: 3_000, // Shieldon   → Bastiodon
    415: 3_000, // Combee     → Vespiquen
    418: 2_000, // Buizel     → Floatzel
    420: 2_000, // Cherubi    → Cherrim
    422: 2_000, // Shellos    → Gastrodon
    425: 2_000, // Drifloon   → Drifblim
    427: 3_000, // Buneary    → Lopunny
    431: 2_000, // Glameow    → Purugly
    434: 2_000, // Stunky     → Skuntank
    436: 2_000, // Bronzor    → Bronzong
    443: 1_750, // Gible      → Gabite
    444: 3_500, // Gabite     → Garchomp
    447: 2_000, // Riolu      → Lucario
    449: 2_000, // Hippopotas → Hippowdon
    451: 2_000, // Skorupi    → Drapion
    453: 2_000, // Croagunk   → Toxicroak
    456: 2_000, // Finneon    → Lumineon
    459: 2_000, // Snover     → Abomasnow
    489: 2_000, // Phione     → Manaphy
  13299: 2_000, // Nosepass   → Probopass
  13315: 3_500, // Roselia    → Roserade
  13447: 2_000, // Riolu      → Lucario
  // --- Alvo em UNOVA (dex 494–649)
  495: 6_400, // Snivy      → Servine
  496: 8_600, // Servine    → Serperior
  498: 6_400, // Tepig      → Pignite
  499: 8_600, // Pignite    → Emboar
  501: 6_400, // Oshawott   → Dewott
  502: 8_600, // Dewott     → Samurott
  504: 6_950, // Patrat     → Watchog
  507: 8_600, // Herdier    → Stoutland
  509: 6_950, // Purrloin   → Liepard
  511: 6_950, // Pansage    → Simisage
  513: 6_950, // Pansear    → Simisear
  515: 6_950, // Panpour    → Simipour
  517: 6_950, // Munna      → Musharna
  519: 6_400, // Pidove     → Tranquill
  520: 8_600, // Tranquill  → Unfezant
  522: 6_950, // Blitzle    → Zebstrika
  524: 6_400, // Roggenrola → Boldore
  525: 8_600, // Boldore    → Gigalith
  527: 6_950, // Woobat     → Swoobat
  529: 6_950, // Drilbur    → Excadrill
  532: 6_400, // Timburr    → Gurdurr
  533: 8_600, // Gurdurr    → Conkeldurr
  535: 6_400, // Tympole    → Palpitoad
  536: 8_600, // Palpitoad  → Seismitoad
  540: 6_400, // Sewaddle   → Swadloon
  541: 8_600, // Swadloon   → Leavanny
  543: 6_400, // Venipede   → Whirlipede
  544: 8_600, // Whirlipede → Scolipede
  546: 6_950, // Cottonee   → Whimsicott
  548: 6_950, // Petilil    → Lilligant
  551: 6_400, // Sandile    → Krokorok
  552: 8_600, // Krokorok   → Krookodile
  557: 6_950, // Dwebble    → Crustle
  559: 6_950, // Scraggy    → Scrafty
  562: 6_950, // Yamask     → Cofagrigus
  564: 6_950, // Tirtouga   → Carracosta
  566: 8_000, // Archen     → Archeops
  568: 6_950, // Trubbish   → Garbodor
  570: 6_950, // Zorua      → Zoroark
  572: 6_950, // Minccino   → Cinccino
  574: 6_400, // Gothita    → Gothorita
  575: 8_600, // Gothorita  → Gothitelle
  577: 6_400, // Solosis    → Duosion
  578: 8_600, // Duosion    → Reuniclus
  580: 6_950, // Ducklett   → Swanna
  583: 8_600, // Vanillish  → Vanilluxe
  585: 6_950, // Deerling   → Sawsbuck
  588: 6_950, // Karrablast → Escavalier
  590: 6_950, // Foongus    → Amoonguss
  592: 6_950, // Frillish   → Jellicent
  595: 6_950, // Joltik     → Galvantula
  597: 6_950, // Ferroseed  → Ferrothorn
  600: 8_600, // Klang      → Klinklang
  602: 6_400, // Tynamo     → Eelektrik
  603: 8_600, // Eelektrik  → Eelektross
  607: 6_400, // Litwick    → Lampent
  608: 8_600, // Lampent    → Chandelure
  610: 6_400, // Axew       → Fraxure
  611: 8_600, // Fraxure    → Haxorus
  613: 6_950, // Cubchoo    → Beartic
  616: 6_950, // Shelmet    → Accelgor
  619: 6_950, // Mienfoo    → Mienshao
  622: 6_950, // Golett     → Golurk
  624: 6_400, // Pawniard   → Bisharp
  627: 6_950, // Rufflet    → Braviary
  629: 6_950, // Vullaby    → Mandibuzz
  633: 6_400, // Deino      → Zweilous
  634: 8_600, // Zweilous   → Hydreigon
  636: 6_950, // Larvesta   → Volcarona
  // --- Alvo em KALOS (dex 650–721)
  651: 21_200, // Quilladin   → Chesnaught
  654: 21_200, // Braixen     → Delphox
  659: 16_000, // Bunnelby    → Diggersby
  661: 14_350, // Fletchling  → Fletchinder
  662: 21_200, // Fletchinder → Talonflame
  664: 14_350, // Scatterbug  → Spewpa
  665: 21_200, // Spewpa      → Vivillon
  667: 16_000, // Litleo      → Pyroar
  669: 14_350, // Flabebe     → Floette
  670: 21_200, // Floette     → Florges
  674: 20_000, // Pancham     → Pangoro
  679: 14_350, // Honedge     → Doublade
  680:  1_000, // Doublade    → Aegislash
  682: 16_000, // Spritzee    → Aromatisse
  684: 16_000, // Swirlix     → Slurpuff
  686: 16_000, // Inkay       → Malamar
  688: 16_000, // Binacle     → Barbaracle
  690: 20_000, // Skrelp      → Dragalge
  692: 16_000, // Clauncher   → Clawitzer
  694: 16_000, // Helioptile  → Heliolisk
  698: 16_000, // Amaura      → Aurorus
  704: 14_350, // Goomy       → Sliggoo
  705: 21_200, // Sliggoo     → Goodra
  708: 16_000, // Phantump    → Trevenant
  712: 16_000, // Bergmite    → Avalugg
  714: 16_000, // Noibat      → Noivern
  // --- Alvo em ALOLA (dex 722–809)
  722: 32_000, // Rowlet    → Dartrix
  725: 32_000, // Litten    → Torracat
  726: 43_100, // Torracat  → Incineroar
  728: 32_000, // Popplio   → Brionne
  729: 43_100, // Brionne   → Primarina
  731: 32_000, // Pikipek   → Trumbeak
  732: 43_100, // Trumbeak  → Toucannon
  734: 34_650, // Yungoos   → Gumshoos
  736: 32_000, // Grubbin   → Charjabug
  737: 43_100, // Charjabug → Vikavolt
  742: 34_650, // Cutiefly  → Ribombee
  747: 34_650, // Mareanie  → Toxapex
  749: 34_650, // Mudbray   → Mudsdale
  751: 34_650, // Dewpider  → Araquanid
  755: 34_650, // Morelull  → Shiinotic
  757: 34_650, // Salandit  → Salazzle
  759: 34_650, // Stufful   → Bewear
  761: 32_000, // Bounsweet → Steenee
  762: 43_100, // Steenee   → Tsareena
  767: 34_650, // Wimpod    → Golisopod
  782: 32_000, // Jangmo-o  → Hakamo-o
  783: 43_100, // Hakamo-o  → Kommo-o
  // --- BEBÊS — base de geração posterior ao alvo, então a hunt dele fica abaixo da do bebê
    172:  60, // Pichu     → Pikachu
    173:  40, // Cleffa    → Clefairy
    174:  40, // Igglybuff → Jigglypuff
    238: 100, // Smoochum  → Jynx
    239: 100, // Elekid    → Electabuzz
    240: 100, // Magby     → Magmar
    298:  20, // Azurill   → Marill
    360: 100, // Wynaut    → Wobbuffet
    406: 650, // Budew     → Roselia
    433: 700, // Chingling → Chimecho
    439:  80, // Mime Jr.  → Mr. Mime
    446: 100, // Munchlax  → Snorlax
    458: 100, // Mantyke   → Mantine
  13298:  20, // Azurill   → Marill
  13360: 100, // Wynaut    → Wobbuffet
  // --- Alvo FORA de Sinnoh–Alola — os cinco que a tabela já trazia, intactos
  113: 1_125, // Chansey → Blissey
  137: 1_125, // Porygon → Porygon2
  349: 1_125, // Feebas  → Milotic
  375: 1_250, // Metang  → Metagross
  803: 7_500, // Poipole → Naganadel
};

/**
 * Escreve os níveis acima. Roda DEPOIS de `normalizarEvolveLevel600`, que ele corrige: os sete
 * do 600 estão todos nesta tabela, então o 100 daquela normalização nunca sobrevive.
 */
export function corrigirNiveisDeEvolucao(lista) {
  let corrigidos = 0;
  for (const c of lista) {
    const nivel = NIVEIS_POR_ONDE_O_ALVO_APARECE[c.pokeId];
    if (!nivel || !c.evolvesToId || c.evolveLevel === nivel) continue;
    c.evolveLevel = nivel;
    corrigidos++;
  }
  return corrigidos;
}

/**
 * O `evolveLevel: 600` que o espelho escreveu por engano — vira 100, o padrão de pedra.
 *
 * O espelho trocou o `huntLevel` da forma final pelo `evolveLevel` do estágio anterior:
 * Electabuzz, Magmar, Rhydon, Dusclops, Metang, Feebas e Tangela vinham pedindo nv 600 para
 * uma evolução que o jogo libera em 100 (Onix, Haunter, Kadabra…). Mora aqui, e não no
 * `content.mjs`, porque a Pokédex do cliente lia o 600 cru e anunciava um degrau seis vezes
 * mais alto do que o servidor de fato cobra.
 *
 * Roda entre os passos 1 e 3 — nenhuma das duas tabelas escreve 600, então a ordem entre elas
 * é indiferente; o que não pode é rodar depois de alguém escrever um 600 legítimo.
 */
export function normalizarEvolveLevel600(lista) {
  for (const c of lista) {
    if (c.evolveLevel === 600) c.evolveLevel = 100;
  }
}

/** Atalho para `CADEIAS_TRUNCADAS` — o passo 1. */
export function aplicarCadeiasTruncadas(lista) {
  return aplicarElosEvolutivos(lista, CADEIAS_TRUNCADAS);
}
