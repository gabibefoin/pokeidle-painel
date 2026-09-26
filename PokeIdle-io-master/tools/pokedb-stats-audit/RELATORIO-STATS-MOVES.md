# Auditoria de stats base e moves — referência pokemondb.net

Gerado em 2026-09-01 19:52 UTC. Fonte: `https://pokemondb.net/pokedex/<especie>` (seção *Moves learnt by level up*, versão de jogo mais recente).

| | |
|---|---|
| Espécies em escopo (têm sprite **e** página no pokemondb) | 773 — 766 da dex + 6 Megas + Castform-Fire |
| **Gravadas em `creatures-novos.json` neste passe** | 411 |
| **Gravadas no patch `creatures-audit-overrides.json` (base-only)** | 362 |
| Pendentes de fetch (têm sprite, cache ainda não baixado) | 0 |
| Stats base corrigidos | 0 |
| Stats já corretos | 772 |
| Espécies com moveset ajustado | 360 |
| Learnset oficial menor que nº de slots | 13 |
| Ignoradas — na dex mas **sem sprite** (não estão no jogo) | 259 |
| Fora de escopo — Outland/Orre/fantasma sem página no pokemondb | 180 |

## Regras aplicadas

- **Stats base** → valores oficiais da forma normal (Megas: stats da Mega-evolução).
- **Moves** → cada espécie manteve a mesma quantidade de golpes não-assinatura. Os slots foram preenchidos, em ordem, pelos primeiros golpes **de dano** da tabela *Moves learnt by level up* (golpes de status pulados; nomes repetidos removidos). Faltando golpe de dano, completa com golpe de status.
- **Por golpe foi reajustado**: `name`, `type`, `category` (PHYSICAL/SPECIAL), `power`. **Preservados**: `cooldownMs`, `learnLevel`.
- `power` vem do pokemondb; quando lá é dano variável (“—”), o `power` atual do slot foi mantido.
- **Golpes de assinatura** (power ≥ 300: os 18 “600 por tipo” + Draconic Soul) não foram contados nem alterados.

## 1. Stats base corrigidos

| # | Espécie | Antes · HP/ATK/DEF/SpA/SpD/SPE | Depois |
|--:|---|---|---|

## 2. Learnset oficial menor que o nº de slots

_Nesses casos os slots sem golpe oficial mantiveram o nome; só a categoria foi recalibrada pelo tipo._

- 10 Caterpie (BUG) — 2 do pokemondb + 1 fabricado(s) mantido(s) [cache: 2 dano + 0 TM]
- 11 Metapod (BUG) — 0 do pokemondb + 2 fabricado(s) mantido(s) · 2 descartado(s) [cache: 0 dano + 0 TM]
- 14 Kakuna (BUG/POISON) — 3 do pokemondb + 1 fabricado(s) mantido(s) [cache: 1 dano + 3 TM]
- 201 Unown (PSYCHIC) — 1 do pokemondb + 5 fabricado(s) mantido(s) [cache: 1 dano + 0 TM]
- 202 Wobbuffet (PSYCHIC) — 2 do pokemondb + 4 fabricado(s) mantido(s) [cache: 2 dano + 0 TM]
- 235 Smeargle (NORMAL) — 0 do pokemondb + 6 fabricado(s) mantido(s) [cache: 0 dano + 0 TM]
- 265 Wurmple (BUG) — 2 do pokemondb + 5 fabricado(s) mantido(s) [cache: 2 dano + 0 TM]
- 266 Silcoon (BUG) — 2 do pokemondb + 4 fabricado(s) mantido(s) [cache: 2 dano + 0 TM]
- 268 Cascoon (BUG) — 2 do pokemondb + 6 fabricado(s) mantido(s) [cache: 2 dano + 0 TM]
- 360 Wynaut (PSYCHIC) — 2 do pokemondb + 6 fabricado(s) mantido(s) [cache: 2 dano + 0 TM]
- 412 Burmy (Plant Cloak) (PLANT/CLOAK) — 1 do pokemondb + 4 fabricado(s) mantido(s) [cache: 1 dano + 0 TM]
- 602 Tynamo (ELECTRIC) — 6 do pokemondb + 1 fabricado(s) mantido(s) [cache: 3 dano + 5 TM]
- 665 Spewpa (BUG) — 7 do pokemondb + 2 fabricado(s) mantido(s) [cache: 2 dano + 8 TM]

## 3. Golpes com dano variável (power atual mantido)

- 12 Butterfree: Aerial Ace (56→56)
- 19 Rattata: Super Fang (72→72)
- 20 Raticate: Super Fang (56→56)
- 20 Raticate: Endeavor (120→120)
- 25 Pikachu: Electro Ball (56→56)
- 26 Raichu: Electro Ball (72→72)
- 39 Jigglypuff: Spit Up (96→96)
- 42 Golbat: Aerial Ace (120→120)
- 44 Gloom: Magical Leaf (120→120)
- 45 Vileplume: Magical Leaf (96→96)
- 47 Parasect: Aerial Ace (56→56)
- 51 Dugtrio: Fissure (72→72)
- 56 Mankey: Low Kick (56→56)
- 56 Mankey: Seismic Toss (56→56)
- 56 Mankey: Final Gambit (56→56)
- 57 Primeape: Low Kick (56→56)
- 57 Primeape: Seismic Toss (56→56)
- 57 Primeape: Final Gambit (56→56)
- 62 Poliwrath: Low Kick (64→64)
- 81 Magnemite: Electro Ball (56→56)
- 81 Magnemite: Gyro Ball (56→56)
- 82 Magneton: Electro Ball (56→56)
- 82 Magneton: Gyro Ball (56→56)
- 83 Farfetchd: Swift (96→96)
- 85 Dodrio: Endeavor (120→120)
- 92 Gastly: Night Shade (56→56)
- 93 Haunter: Night Shade (56→56)
- 94 Gengar: Night Shade (56→56)
- 100 Voltorb: Electro Ball (96→96)
- 101 Electrode: Electro Ball (96→96)
- 106 Hitmonlee: Low Kick (56→56)
- 106 Hitmonlee: Reversal (0→70)
- 106 Hitmonlee: Aura Sphere (0→70)
- 107 Hitmonchan: Counter (56→56)
- 107 Hitmonchan: Low Kick (0→70)
- 107 Hitmonchan: Aura Sphere (0→70)
- 119 Seaking: Flail (160→120)
- 123 Scyther: Aerial Ace (56→56)
- 125 Electabuzz: Electro Ball (96→96)
- 127 Pinsir: Seismic Toss (56→56)
- 131 Lapras: Sheer Cold (120→120)
- 135 Jolteon: Electro Ball (96→96)
- 137 Porygon: Swift (96→96)
- 143 Snorlax: Flail (56→56)
- 144 Articuno: Sheer Cold (96→96)
- 144 Articuno: Aerial Ace (96→96)
- 145 Zapdos: Aerial Ace (96→96)
- 145 Zapdos: Electro Ball (200→120)
- 146 Moltres: Aerial Ace (160→120)
- 149 Dragonite: Aerial Ace (160→120)
- 165 Ledyba: Aerial Ace (56→56)
- 166 Ledian: Aerial Ace (56→56)
- 169 Crobat: Aerial Ace (120→120)
- 170 Chinchou: Electro Ball (56→56)
- 171 Lanturn: Electro Ball (64→64)
- 174 Igglybuff: Swift (120→120)
- 176 Togetic: Aerial Ace (80→80)
- 177 Natu: Aerial Ace (56→56)
- 177 Natu: Night Shade (120→120)
- 178 Xatu: Aerial Ace (80→80)
- 179 Mareep: Electro Ball (56→56)
- 180 Flaaffy: Electro Ball (56→56)
- 181 Ampharos: Electro Ball (96→96)
- 182 Bellossom: Magical Leaf (120→120)
- 182 Bellossom: Grass Knot (0→70)
- 183 Marill: Disarming Voice (160→120)
- 184 Azumarill: Disarming Voice (160→120)
- 187 Hoppip: Aerial Ace (120→120)
- 188 Skiploom: Aerial Ace (120→120)
- 189 Jumpluff: Aerial Ace (120→120)
- 200 Misdreavus: Night Shade (80→80)
- 202 Wobbuffet: Mirror Coat (56→56)
- 202 Wobbuffet: Counter (56→56)
- 205 Forretress: Gyro Ball (56→56)
- 205 Forretress: Heavy Slam (120→120)
- 206 Dunsparce: Flail (56→56)
- 206 Dunsparce: Endeavor (80→80)
- 207 Gligar: Aerial Ace (56→56)
- 208 Steelix: Heavy Slam (56→56)
- 214 Heracross: Counter (56→56)
- 215 Sneasel: Beat Up (56→56)
- 215 Sneasel: Fling (72→72)
- 227 Skarmory: Aerial Ace (80→80)
- 228 Houndour: Beat Up (120→120)
- 228 Houndour: Comeuppance (80→80)
- 229 Houndoom: Beat Up (120→120)
- 229 Houndoom: Comeuppance (80→80)
- 233 Porygon2: Swift (120→120)
- 234 Stantler: Swift (120→120)
- 236 Tyrogue: Low Kick (56→56)
- 237 Hitmontop: Counter (56→56)
- 237 Hitmontop: Low Kick (56→56)
- 237 Hitmontop: Reversal (120→120)
- 249 Lugia: Aerial Ace (80→80)
- 250 Ho-oh: Aerial Ace (80→80)
- 256 Combusken: Reversal (56→56)
- 257 Blaziken: Reversal (96→96)
- 263 Zigzagoon: Flail (120→120)
- 264 Linoone: Flail (120→120)
- 267 Beautifly: Aerial Ace (40→40)
- 269 Dustox: Aerial Ace (56→56)
- 272 Ludicolo: Magical Leaf (80→80)
- 272 Ludicolo: Grass Knot (100→100)
- 273 Seedot: Magical Leaf (120→120)
- 275 Shiftry: Magical Leaf (80→80)
- 275 Shiftry: Fling (100→100)
- 276 Taillow: Endeavor (160→120)
- 277 Swellow: Endeavor (120→120)
- 279 Pelipper: Aerial Ace (160→120)
- 284 Masquerain: Aerial Ace (56→56)
- 285 Shroomish: Magical Leaf (40→40)
- 285 Shroomish: Grass Knot (100→100)
- 286 Breloom: Counter (60→60)
- 286 Breloom: Low Kick (70→70)
- 286 Breloom: Magical Leaf (40→40)
- 287 Slakoth: Flail (96→96)
- 289 Slaking: Flail (96→96)
- 296 Makuhita: Seismic Toss (100→100)
- 296 Makuhita: Reversal (120→120)
- 296 Makuhita: Low Kick (80→80)
- 297 Hariyama: Seismic Toss (120→120)
- 297 Hariyama: Reversal (75→75)
- 297 Hariyama: Low Kick (80→80)
- 302 Sableye: Night Shade (100→100)
- 304 Aron: Heavy Slam (10→40)
- 305 Lairon: Heavy Slam (140→120)
- 305 Lairon: Metal Burst (80→80)
- 306 Aggron: Heavy Slam (140→120)
- 306 Aggron: Metal Burst (80→80)
- 307 Meditite: Reversal (140→120)
- 307 Meditite: Counter (0→70)
- 308 Medicham: Counter (10→40)
- 311 Plusle: Electro Ball (65→65)
- 312 Minun: Electro Ball (65→65)
- 323 Camerupt: Fissure (56→56)
- 327 Spinda: Flail (90→90)
- 331 Cacnea: Magical Leaf (40→40)
- 331 Cacnea: Grass Knot (70→70)
- 332 Cacturne: Magical Leaf (160→120)
- 332 Cacturne: Fling (120→120)
- 333 Swablu: Aerial Ace (56→56)
- 333 Swablu: Swift (160→120)
- 334 Altaria: Aerial Ace (0→70)
- 335 Zangoose: Swift (144→120)
- 339 Barboach: Fissure (50→50)
- 340 Whiscash: Fissure (120→120)
- 346 Cradily: Grass Knot (96→96)
- 352 Kecleon: Swift (75→75)
- 353 Shuppet: Night Shade (56→56)
- 354 Banette: Night Shade (56→56)
- 354 Banette: Shadow Punch (56→56)
- 355 Duskull: Night Shade (56→56)
- 356 Dusclops: Night Shade (56→56)
- 357 Tropius: Aerial Ace (56→56)
- 360 Wynaut: Mirror Coat (56→56)
- 360 Wynaut: Counter (56→56)
- 362 Glalie: Sheer Cold (56→56)
- 379 Registeel: Heavy Slam (50→50)
- 379 Registeel: Hard Press (60→60)
- 383 Groudon: Fissure (60→60)
- 384 Rayquaza: Aerial Ace (80→80)
- 387 Turtwig: Magical Leaf (60→60)
- 388 Grotle: Magical Leaf (60→60)
- 389 Torterra: Magical Leaf (72→72)
- 391 Monferno: Low Kick (40→40)
- 392 Infernape: Low Kick (40→40)
- 396 Starly: Endeavor (56→56)
- 397 Staravia: Endeavor (80→80)
- 397 Staravia: Swift (56→56)
- 398 Staraptor: Endeavor (120→120)
- 398 Staraptor: Swift (120→120)
- 399 Bidoof: Swift (40→40)
- 400 Bibarel: Swift (80→80)
- 403 Shinx: Electro Ball (80→80)
- 404 Luxio: Electro Ball (80→80)
- 405 Luxray: Electro Ball (80→80)
- 410 Shieldon: Metal Burst (96→96)
- 410 Shieldon: Heavy Slam (120→120)
- 411 Bastiodon: Metal Burst (96→96)
- 411 Bastiodon: Heavy Slam (120→120)
- 414 Mothim: Aerial Ace (50→50)
- 417 Pachirisu: Electro Ball (96→96)
- 420 Cherubi: Magical Leaf (40→40)
- 421 Cherrim: Magical Leaf (40→40)
- 425 Drifloon: Aerial Ace (120→120)
- 425 Drifloon: Night Shade (120→120)
- 426 Drifblim: Aerial Ace (120→120)
- 426 Drifblim: Night Shade (56→56)
- 429 Mismagius: Night Shade (80→80)
- 430 Honchkrow: Comeuppance (40→40)
- 430 Honchkrow: Aerial Ace (70→70)
- 431 Glameow: Swift (70→70)
- 431 Glameow: Aerial Ace (56→56)
- 432 Purugly: Swift (100→100)
- 436 Bronzor: Gyro Ball (40→40)
- 436 Bronzor: Heavy Slam (100→100)
- 437 Bronzong: Gyro Ball (50→50)
- 437 Bronzong: Heavy Slam (50→50)
- 441 Chatot: Aerial Ace (90→90)
- 442 Spiritomb: Night Shade (56→56)
- 446 Munchlax: Flail (60→60)
- 447 Riolu: Counter (80→80)
- 447 Riolu: Final Gambit (56→56)
- 447 Riolu: Reversal (0→70)
- 448 Lucario: Final Gambit (80→80)
- 448 Lucario: Reversal (80→80)
- 448 Lucario: Counter (140→120)
- 449 Hippopotas: Fissure (40→40)
- 450 Hippowdon: Fissure (60→60)
- 453 Croagunk: Low Kick (65→65)
- 454 Toxicroak: Low Kick (65→65)
- 455 Carnivine: Magical Leaf (40→40)
- 459 Snover: Sheer Cold (120→120)
- 460 Abomasnow: Sheer Cold (120→120)
- 461 Weavile: Beat Up (40→40)
- 461 Weavile: Fling (80→80)
- 462 Magnezone: Electro Ball (40→40)
- 462 Magnezone: Gyro Ball (65→65)
- 465 Tangrowth: Aerial Ace (0→70)
- 466 Electivire: Electro Ball (0→70)
- 468 Togekiss: Aerial Ace (40→40)
- 469 Yanmega: Aerial Ace (40→40)
- 471 Glaceon: Sheer Cold (60→60)
- 472 Gliscor: Aerial Ace (120→120)
- 474 Porygon-Z: Swift (80→80)
- 476 Probopass: Heavy Slam (90→90)
- 477 Dusknoir: Night Shade (120→120)
- 479 Rotom: Electro Ball (56→56)
- 483 Dialga: Metal Burst (100→100)
- 483 Dialga: Heavy Slam (90→90)
- 485 Heatran: Heat Crash (60→60)
- 485 Heatran: Heavy Slam (80→80)
- 486 Regigigas: Crush Grip (50→50)
- 497 Serperior: Grass Knot (96→96)
- 498 Tepig: Heat Crash (90→90)
- 499 Pignite: Heat Crash (90→90)
- 500 Emboar: Heat Crash (90→90)
- 504 Patrat: Super Fang (60→60)
- 504 Patrat: Bide (60→60)
- 505 Watchog: Super Fang (90→90)
- 505 Watchog: Bide (80→80)
- 505 Watchog: Swift (64→64)
- 511 Pansage: Grass Knot (40→40)
- 522 Blitzle: Electro Ball (65→65)
- 523 Zebstrika: Electro Ball (65→65)
- 530 Excadrill: Fissure (50→50)
- 532 Timburr: Low Kick (40→40)
- 532 Timburr: Reversal (80→80)
- 533 Gurdurr: Low Kick (56→56)
- 533 Gurdurr: Reversal (80→80)
- 534 Conkeldurr: Low Kick (100→100)
- 534 Conkeldurr: Reversal (120→120)
- 538 Throh: Seismic Toss (140→120)
- 538 Throh: Reversal (120→120)
- 539 Sawk: Counter (140→120)
- 539 Sawk: Reversal (120→120)
- 540 Sewaddle: Magical Leaf (120→120)
- 541 Swadloon: Magical Leaf (120→120)
- 542 Leavanny: Magical Leaf (56→56)
- 542 Leavanny: Grass Knot (120→120)
- 560 Scrafty: Low Kick (70→70)
- 560 Scrafty: Beat Up (120→120)
- 562 Yamask: Night Shade (65→65)
- 562 Yamask: Shadow Punch (56→56)
- 563 Cofagrigus: Night Shade (56→56)
- 563 Cofagrigus: Shadow Punch (56→56)
- 570 Zorua: Fling (80→80)
- 571 Zoroark: Fling (40→40)
- 573 Cinccino: Swift (80→80)
- 579 Reuniclus: Endeavor (64→64)
- 582 Vanillite: Sheer Cold (120→120)
- 584 Vanilluxe: Sheer Cold (40→40)
- 586 Sawsbuck: Magical Leaf (80→80)
- 589 Escavalier: Metal Burst (120→120)
- 589 Escavalier: Flail (40→40)
- 592 Frillish: Night Shade (40→40)
- 593 Jellicent: Night Shade (40→40)
- 595 Joltik: Electro Ball (60→60)
- 596 Galvantula: Electro Ball (40→40)
- 597 Ferroseed: Gyro Ball (80→80)
- 598 Ferrothorn: Gyro Ball (80→80)
- 603 Eelektrik: Electro Ball (40→40)
- 607 Litwick: Night Shade (40→40)
- 608 Lampent: Night Shade (40→40)
- 609 Chandelure: Night Shade (56→56)
- 613 Cubchoo: Sheer Cold (40→40)
- 614 Beartic: Sheer Cold (40→40)
- 615 Cryogonal: Sheer Cold (40→40)
- 618 Stunfisk: Fissure (80→80)
- 619 Mienfoo: Reversal (60→60)
- 619 Mienfoo: Low Kick (40→40)
- 620 Mienshao: Reversal (40→40)
- 620 Mienshao: Low Kick (65→65)
- 622 Golett: Night Shade (60→60)
- 623 Golurk: Night Shade (60→60)
- 624 Pawniard: Fling (70→70)
- 625 Bisharp: Metal Burst (50→50)
- 625 Bisharp: Fling (70→70)
- 630 Mandibuzz: Aerial Ace (96→96)
- 638 Cobalion: Metal Burst (90→90)
- 638 Cobalion: Heavy Slam (90→90)
- 646 Kyurem: Sheer Cold (60→60)
- 659 Bunnelby: Flail (90→90)
- 659 Bunnelby: Super Fang (55→55)
- 660 Diggersby: Flail (60→60)
- 660 Diggersby: Super Fang (85→85)
- 661 Fletchling: Flail (55→55)
- 661 Fletchling: Swift (120→120)
- 667 Litleo: Endeavor (40→40)
- 668 Pyroar: Endeavor (90→90)
- 669 Flabebe: Disarming Voice (140→120)
- 670 Floette: Disarming Voice (140→120)
- 674 Pancham: Low Kick (0→70)
- 679 Honedge: Gyro Ball (70→70)
- 680 Doublade: Gyro Ball (70→70)
- 683 Aromatisse: Flail (56→56)
- 685 Slurpuff: Endeavor (100→100)
- 704 Goomy: Flail (90→90)
- 705 Sliggoo: Flail (85→85)
- 707 Klefki: Magnet Bomb (95→95)
- 713 Avalugg: Sheer Cold (90→90)
- 714 Noibat: Aerial Ace (40→40)
- 715 Noivern: Aerial Ace (40→40)
- 723 Dartrix: Aerial Ace (40→40)
- 723 Dartrix: Magical Leaf (40→40)
- 727 Incineroar: Fling (120→120)
- 732 Trumbeak: Aerial Ace (56→56)
- 733 Toucannon: Aerial Ace (96→96)
- 733 Toucannon: Swift (56→56)
- 734 Yungoos: Super Fang (50→50)
- 734 Yungoos: Endeavor (80→80)
- 735 Gumshoos: Super Fang (40→40)
- 737 Charjabug: Electro Ball (80→80)
- 738 Vikavolt: Electro Ball (80→80)
- 759 Stufful: Flail (50→50)
- 760 Bewear: Flail (40→40)
- 761 Bounsweet: Grass Knot (120→120)
- 762 Steenee: Grass Knot (120→120)
- 763 Tsareena: Grass Knot (120→120)
- 766 Passimian: Reversal (60→60)
- 766 Passimian: Low Kick (40→40)
- 783 Hakamo-o: Low Kick (40→40)
- 783 Hakamo-o: Reversal (56→56)
- 784 Kommo-o: Low Kick (40→40)
- 784 Kommo-o: Aura Sphere (120→120)
- 799 Guzzlord: Fling (85→85)
- 869 Alcremie: Disarming Voice (40→40)
- 885 Dreepy: Swift (120→120)
- 959 Tinkaton: Heavy Slam (40→40)
- 959 Tinkaton: Hard Press (40→40)
- 979 Annihilape: Counter (100→100)
- 979 Annihilape: Low Kick (50→50)
- 979 Annihilape: Seismic Toss (120→120)
- 979 Annihilape: Final Gambit (40→40)
- 1001 Wo-Chien: Ruination (120→120)
- 1002 Chien-Pao: Ruination (56→56)
- 1003 Ting-Lu: Ruination (120→120)
- 1003 Ting-Lu: Fissure (56→56)
- 1004 Chi-Yu: Ruination (120→120)
- 1006 Iron Valiant: Low Kick (40→40)
- 1006 Iron Valiant: Aura Sphere (120→120)
- 1006 Iron Valiant: Reversal (70→70)
- 1007 Koraidon: Counter (120→120)
- 1007 Koraidon: Low Kick (90→90)
- 1010 Iron Leaves: Grass Knot (120→120)
- 1011 Dipplin: Grass Knot (100→100)
- 1012 Poltchageist: Magical Leaf (56→56)
- 1013 Sinistcha: Magical Leaf (120→120)
- 1013 Sinistcha: Night Shade (72→72)
- 1014 Okidogi: Low Kick (50→50)
- 1014 Okidogi: Counter (120→120)
- 1018 Archaludon: Metal Burst (56→56)
- 1018 Archaludon: Heavy Slam (80→80)
- 1019 Hydrapple: Magical Leaf (120→120)
- 1019 Hydrapple: Grass Knot (120→120)
- 1025 Pecharunt: Night Shade (120→120)
- 14302 Mega Sableye: Night Shade (100→100)
- 14448 Mega Lucario: Final Gambit (80→80)
- 14448 Mega Lucario: Reversal (80→80)
- 14448 Mega Lucario: Counter (140→120)

## 3b. Revisões — slots extras (lutadores / eeveelutions / evos gen-4)

_Lutadores priorizam golpes FIGHTING (level-up + TM); eeveelutions e evoluções que só surgiram na gen 4 priorizam o próprio tipo. Slots extras usam cooldown/learnLevel de uma escada padrão. Teto de 10 golpes não-assinatura; espécie nunca perde slot._

- 56 Mankey (FIGHTING) — 5 → 10 slots, prioridade FIGHTING
- 57 Primeape (FIGHTING) — 8 → 10 slots, prioridade FIGHTING
- 62 Poliwrath (WATER/FIGHTING) — 9 → 10 slots, prioridade FIGHTING/WATER
- 66 Machop (FIGHTING) — 5 → 10 slots, prioridade FIGHTING
- 67 Machoke (FIGHTING) — 7 → 10 slots, prioridade FIGHTING
- 68 Machamp (FIGHTING) — 8 → 10 slots, prioridade FIGHTING
- 106 Hitmonlee (FIGHTING) — 4 → 10 slots, prioridade FIGHTING
- 107 Hitmonchan (FIGHTING) — 7 → 10 slots, prioridade FIGHTING
- 134 Vaporeon (WATER) — 8 → 10 slots, prioridade WATER
- 135 Jolteon (ELECTRIC) — 9 → 10 slots, prioridade ELECTRIC
- 136 Flareon (FIRE) — 8 → 10 slots, prioridade FIRE
- 169 Crobat (POISON/FLYING) — 8 → 10 slots, prioridade POISON/FLYING
- 182 Bellossom (GRASS) — 6 → 10 slots, prioridade GRASS
- 186 Politoed (WATER) — 6 → 10 slots, prioridade WATER
- 196 Espeon (PSYCHIC) — 6 → 10 slots, prioridade PSYCHIC
- 197 Umbreon (DARK) — 6 → 10 slots, prioridade DARK
- 199 Slowking (WATER/PSYCHIC) — 8 → 10 slots, prioridade WATER/PSYCHIC
- 208 Steelix (STEEL/GROUND) — 8 → 10 slots, prioridade STEEL/GROUND
- 212 Scizor (BUG/STEEL) — 8 → 10 slots, prioridade BUG/STEEL
- 214 Heracross (BUG/FIGHTING) — 8 → 10 slots, prioridade FIGHTING/BUG
- 224 Octillery (WATER) — 6 → 10 slots, prioridade WATER
- 229 Houndoom (DARK/FIRE) — 8 → 10 slots, prioridade DARK/FIRE
- 230 Kingdra (WATER/DRAGON) — 8 → 10 slots, prioridade WATER/DRAGON
- 233 Porygon2 (NORMAL) — 6 → 10 slots, prioridade NORMAL
- 236 Tyrogue (FIGHTING) — 6 → 10 slots, prioridade FIGHTING
- 237 Hitmontop (FIGHTING) — 6 → 10 slots, prioridade FIGHTING
- 256 Combusken (FIRE/FIGHTING) — 8 → 10 slots, prioridade FIGHTING/FIRE
- 296 Makuhita (FIGHTING) — 7 → 10 slots, prioridade FIGHTING
- 307 Meditite (FIGHTING/PSYCHIC) — 6 → 10 slots, prioridade FIGHTING/PSYCHIC
- 308 Medicham (FIGHTING/PSYCHIC) — 8 → 10 slots, prioridade FIGHTING/PSYCHIC
- 428 Lopunny (NORMAL) — 2 → 10 slots, prioridade NORMAL
- 447 Riolu (FIGHTING) — 5 → 10 slots, prioridade FIGHTING
- 464 Rhyperior (GROUND/ROCK) — 6 → 10 slots, prioridade GROUND/ROCK
- 465 Tangrowth (GRASS) — 6 → 10 slots, prioridade GRASS
- 466 Electivire (ELECTRIC) — 6 → 10 slots, prioridade ELECTRIC
- 467 Magmortar (FIRE) — 6 → 10 slots, prioridade FIRE
- 472 Gliscor (GROUND/FLYING) — 6 → 10 slots, prioridade GROUND/FLYING
- 477 Dusknoir (GHOST) — 6 → 10 slots, prioridade GHOST
- 538 Throh (FIGHTING) — 6 → 10 slots, prioridade FIGHTING
- 539 Sawk (FIGHTING) — 6 → 10 slots, prioridade FIGHTING
- 674 Pancham (FIGHTING) — 6 → 10 slots, prioridade FIGHTING
- 675 Pangoro (FIGHTING/DARK) — 6 → 10 slots, prioridade FIGHTING/DARK

## 4. Movesets ajustados — diff por espécie

Formato: `nome/tipo/categoria/power  →  nome/tipo/categoria/power`

### 1 Bulbasaur
  Poison Powder/POISON/SPECIAL/56  →  Vine Whip/GRASS/PHYSICAL/45
  Razor Leaf/GRASS/SPECIAL/56  →  Razor Leaf/GRASS/PHYSICAL/55
  Sleep Powder/GRASS/SPECIAL/56  →  Seed Bomb/GRASS/PHYSICAL/80
  Tackle/NORMAL/PHYSICAL/56  →  Power Whip/GRASS/PHYSICAL/120
  Vine Whip/GRASS/SPECIAL/72  →  Solar Beam/GRASS/SPECIAL/120
  Bullet Seed/GRASS/SPECIAL/120  →  Magical Leaf/GRASS/SPECIAL/30
  Leech Seed/GRASS/SPECIAL/120  →  Sludge Wave/POISON/SPECIAL/95
  Solar Beam/GRASS/SPECIAL/120  →  Energy Ball/GRASS/SPECIAL/90

### 2 Ivysaur
  Bullet Seed/GRASS/SPECIAL/120  →  Vine Whip/GRASS/PHYSICAL/45
  Poison Powder/POISON/SPECIAL/56  →  Razor Leaf/GRASS/PHYSICAL/55
  Razor Leaf/GRASS/SPECIAL/56  →  Seed Bomb/GRASS/PHYSICAL/80
  Sleep Powder/GRASS/SPECIAL/56  →  Power Whip/GRASS/PHYSICAL/120
  Tackle/NORMAL/PHYSICAL/56  →  Solar Beam/GRASS/SPECIAL/120
  Vine Whip/GRASS/SPECIAL/72  →  Magical Leaf/GRASS/SPECIAL/30
  Headbutt/NORMAL/PHYSICAL/80  →  Sludge Wave/POISON/SPECIAL/95
  Giga Drain/GRASS/PHYSICAL/96  →  Energy Ball/GRASS/SPECIAL/90
  Leech Seed/GRASS/SPECIAL/120  →  Bullet Seed/GRASS/PHYSICAL/25
  Solar Beam/GRASS/SPECIAL/120  →  Giga Drain/GRASS/SPECIAL/75

### 3 Venusaur
  Bullet Seed/GRASS/SPECIAL/120  →  Petal Dance/GRASS/SPECIAL/120
  Poison Powder/POISON/SPECIAL/56  →  Vine Whip/GRASS/PHYSICAL/45
  Razor Leaf/GRASS/SPECIAL/56  →  Razor Leaf/GRASS/PHYSICAL/55
  Sleep Powder/GRASS/SPECIAL/56  →  Seed Bomb/GRASS/PHYSICAL/80
  Sludge/POISON/SPECIAL/56  →  Power Whip/GRASS/PHYSICAL/120
  Tackle/NORMAL/PHYSICAL/56  →  Solar Beam/GRASS/SPECIAL/120
  Vine Whip/GRASS/SPECIAL/72  →  Magical Leaf/GRASS/SPECIAL/30
  Giga Drain/GRASS/PHYSICAL/96  →  Sludge Wave/POISON/SPECIAL/95
  Leech Seed/GRASS/SPECIAL/120  →  Energy Ball/GRASS/SPECIAL/90
  Solar Beam/GRASS/SPECIAL/120  →  Bullet Seed/GRASS/PHYSICAL/25
  Petal Blizzard/GRASS/PHYSICAL/160  →  Giga Drain/GRASS/SPECIAL/75

### 4 Charmander
  Fire Fang/FIRE/SPECIAL/56  →  Ember/FIRE/SPECIAL/40
  Rage/NORMAL/PHYSICAL/56  →  Fire Fang/FIRE/PHYSICAL/65
  Scratch/NORMAL/PHYSICAL/56  →  Flamethrower/FIRE/SPECIAL/90
  Ember/FIRE/SPECIAL/80  →  Fire Spin/FIRE/SPECIAL/35
  Flamethrower/FIRE/SPECIAL/80  →  Inferno/FIRE/SPECIAL/100
  Fire Ball/FIRE/SPECIAL/80  →  Flare Blitz/FIRE/PHYSICAL/120
  Fire Blast/FIRE/SPECIAL/160  →  Fire Punch/FIRE/PHYSICAL/75

### 5 Charmeleon
  Fire Fang/FIRE/SPECIAL/56  →  Ember/FIRE/SPECIAL/40
  Fire Punch/FIRE/SPECIAL/56  →  Fire Fang/FIRE/PHYSICAL/65
  Rage/NORMAL/PHYSICAL/56  →  Flamethrower/FIRE/SPECIAL/90
  Ember/FIRE/SPECIAL/80  →  Inferno/FIRE/SPECIAL/100
  Flamethrower/FIRE/SPECIAL/80  →  Flare Blitz/FIRE/PHYSICAL/120
  Fire Ball/FIRE/SPECIAL/80  →  Fire Spin/FIRE/SPECIAL/35
  Flame Burst/FIRE/SPECIAL/120  →  Fire Punch/FIRE/PHYSICAL/75
  Fire Blast/FIRE/SPECIAL/160  →  Fire Blast/FIRE/SPECIAL/110

### 6 Charizard
  Fire Punch/FIRE/SPECIAL/56  →  Ember/FIRE/SPECIAL/40
  Sunny Day/FIRE/PHYSICAL/56  →  Heat Wave/FIRE/SPECIAL/95
  Ancient Fury/ROCK/PHYSICAL/56  →  Fire Fang/FIRE/PHYSICAL/65
  Ember/FIRE/SPECIAL/80  →  Flamethrower/FIRE/SPECIAL/90
  Flamethrower/FIRE/SPECIAL/80  →  Fire Spin/FIRE/SPECIAL/35
  Fire Ball/FIRE/SPECIAL/80  →  Inferno/FIRE/SPECIAL/100
  Air Slash/FLYING/PHYSICAL/96  →  Flare Blitz/FIRE/PHYSICAL/120
  Flame Burst/FIRE/SPECIAL/120  →  Fire Punch/FIRE/PHYSICAL/75
  Wing Attack/FLYING/PHYSICAL/120  →  Fire Blast/FIRE/SPECIAL/110
  Fire Blast/FIRE/SPECIAL/160  →  Fly/FLYING/PHYSICAL/90
  Magma Storm/FIRE/SPECIAL/200  →  Overheat/FIRE/SPECIAL/130

### 7 Squirtle
  Harden/NORMAL/PHYSICAL/10  →  Water Gun/WATER/SPECIAL/40
  Bubbles/WATER/SPECIAL/56  →  Water Pulse/WATER/SPECIAL/60
  Aqua Tail/WATER/PHYSICAL/64  →  Aqua Tail/WATER/PHYSICAL/90
  Water Gun/WATER/PHYSICAL/64  →  Hydro Pump/WATER/SPECIAL/110
  Water Ball/WATER/SPECIAL/64  →  Wave Crash/WATER/PHYSICAL/120
  Headbutt/NORMAL/PHYSICAL/80  →  Bubble Beam/WATER/SPECIAL/65
  Water Pulse/WATER/SPECIAL/120  →  Aqua Jet/WATER/PHYSICAL/40

### 8 Wartortle
  Harden/NORMAL/PHYSICAL/10  →  Water Gun/WATER/SPECIAL/40
  Skull Bash/NORMAL/PHYSICAL/56  →  Water Pulse/WATER/SPECIAL/60
  Bubbles/WATER/SPECIAL/56  →  Aqua Tail/WATER/PHYSICAL/90
  Aqua Tail/WATER/PHYSICAL/64  →  Hydro Pump/WATER/SPECIAL/110
  Water Gun/WATER/PHYSICAL/64  →  Wave Crash/WATER/PHYSICAL/120
  Water Ball/WATER/SPECIAL/64  →  Bubble Beam/WATER/SPECIAL/65
  Headbutt/NORMAL/PHYSICAL/80  →  Aqua Jet/WATER/PHYSICAL/40
  Brine/WATER/PHYSICAL/120  →  Liquidation/WATER/PHYSICAL/85
  Hydro Cannon/WATER/SPECIAL/120  →  Flip Turn/WATER/PHYSICAL/60

### 9 Blastoise
  Headbutt/NORMAL/PHYSICAL/80  →  Water Gun/WATER/SPECIAL/40
  Bubbles/WATER/SPECIAL/56  →  Water Pulse/WATER/SPECIAL/60
  Water Ball/WATER/SPECIAL/64  →  Aqua Tail/WATER/PHYSICAL/90
  Water Gun/WATER/PHYSICAL/64  →  Hydro Pump/WATER/SPECIAL/110
  Water Pulse/WATER/SPECIAL/120  →  Wave Crash/WATER/PHYSICAL/120
  Muddy Water/WATER/PHYSICAL/96  →  Bubble Beam/WATER/SPECIAL/65
  Hydro Pump/WATER/SPECIAL/136  →  Aqua Jet/WATER/PHYSICAL/40
  Hydro Cannon/WATER/SPECIAL/120  →  Liquidation/WATER/PHYSICAL/85
  Harden/NORMAL/PHYSICAL/10  →  Flip Turn/WATER/PHYSICAL/60

### 10 Caterpie
  String Shot/BUG/PHYSICAL/56  →  Bug Bite/BUG/PHYSICAL/60
  Bug Bite/BUG/PHYSICAL/72  →  Tackle/NORMAL/PHYSICAL/40

### 11 Metapod
  − Harden/NORMAL/10 (slot descartado; é golpe de status e cache sem golpe pra repor)
  − String Shot/BUG/56 (slot descartado; é golpe de status e cache sem golpe pra repor)

### 12 Butterfree
  Air Cutter/FLYING/PHYSICAL/56  →  Bug Bite/BUG/PHYSICAL/60
  Poison Powder/POISON/SPECIAL/56  →  Gust/FLYING/SPECIAL/40
  Psybeam/PSYCHIC/SPECIAL/56  →  Air Slash/FLYING/SPECIAL/75
  Safeguard/NORMAL/PHYSICAL/56  →  Bug Buzz/BUG/SPECIAL/90
  Sleep Powder/GRASS/SPECIAL/56  →  Aerial Ace/FLYING/PHYSICAL/56
  Super Sonic/NORMAL/PHYSICAL/56  →  U-turn/BUG/PHYSICAL/70
  Confusion/PSYCHIC/SPECIAL/80  →  Tackle/NORMAL/PHYSICAL/40
  Air Slash/FLYING/PHYSICAL/96  →  Confusion/PSYCHIC/SPECIAL/50
  Silver Wind/BUG/PHYSICAL/120  →  Psybeam/PSYCHIC/SPECIAL/65

### 13 Weedle
  Poison Sting/POISON/PHYSICAL/56  →  Poison Sting/POISON/PHYSICAL/15
  String Shot/BUG/PHYSICAL/56  →  Bug Bite/BUG/PHYSICAL/60
  Horn Attack/NORMAL/PHYSICAL/96  →  Electroweb/ELECTRIC/SPECIAL/55

### 14 Kakuna
  Harden/NORMAL/PHYSICAL/10  →  Poison Sting/POISON/PHYSICAL/15
  String Shot/BUG/PHYSICAL/56  →  Electroweb/ELECTRIC/SPECIAL/55
  Bug Bite/BUG/PHYSICAL/72  →  Facade/NORMAL/PHYSICAL/70

### 15 Beedrill
  Fury Cutter/BUG/PHYSICAL/56  →  Bug Bite/BUG/PHYSICAL/60
  Pin Missile/BUG/PHYSICAL/56  →  Poison Sting/POISON/PHYSICAL/15
  Poison Jab/POISON/PHYSICAL/56  →  Fury Cutter/BUG/PHYSICAL/40
  Poison Sting/POISON/PHYSICAL/56  →  Venoshock/POISON/SPECIAL/65
  Rage/NORMAL/PHYSICAL/56  →  Pin Missile/BUG/PHYSICAL/25
  String Shot/BUG/PHYSICAL/56  →  Poison Jab/POISON/PHYSICAL/80
  Toxic Spikes/BUG/PHYSICAL/56  →  Fell Stinger/BUG/PHYSICAL/50
  Strafe/BUG/PHYSICAL/56  →  X-Scissor/BUG/PHYSICAL/80

### 16 Pidgey
  Drill Peck/FLYING/PHYSICAL/56  →  Tackle/NORMAL/PHYSICAL/40
  Quick Attack/NORMAL/PHYSICAL/56  →  Gust/FLYING/SPECIAL/40
  Sand Attack/GROUND/PHYSICAL/56  →  Quick Attack/NORMAL/PHYSICAL/40
  Wing Attack/FLYING/PHYSICAL/120  →  Wing Attack/FLYING/PHYSICAL/60

### 17 Pidgeotto
  Drill Peck/FLYING/PHYSICAL/56  →  Gust/FLYING/SPECIAL/40
  Gust/FLYING/SPECIAL/56  →  Tackle/NORMAL/PHYSICAL/40
  Quick Attack/NORMAL/PHYSICAL/56  →  Quick Attack/NORMAL/PHYSICAL/40
  Sand Attack/GROUND/PHYSICAL/56  →  Wing Attack/FLYING/PHYSICAL/60
  Tornado/FLYING/PHYSICAL/56  →  Aerial Ace/FLYING/PHYSICAL/52
  Wing Attack/FLYING/PHYSICAL/120  →  Air Slash/FLYING/SPECIAL/75

### 18 Pidgeot
  Agility/PSYCHIC/PHYSICAL/10  →  Gust/FLYING/SPECIAL/40
  Drill Peck/FLYING/PHYSICAL/56  →  Hurricane/FLYING/SPECIAL/110
  Quick Attack/NORMAL/PHYSICAL/56  →  Quick Attack/NORMAL/PHYSICAL/40
  Whirlwind/NORMAL/PHYSICAL/56  →  Tackle/NORMAL/PHYSICAL/40
  Feather Dance/FLYING/PHYSICAL/96  →  Wing Attack/FLYING/PHYSICAL/60
  Wing Attack/FLYING/PHYSICAL/120  →  Aerial Ace/FLYING/PHYSICAL/56
  Tornado/FLYING/PHYSICAL/56  →  Air Slash/FLYING/SPECIAL/75
  Hurricane/FLYING/PHYSICAL/160  →  Brave Bird/FLYING/PHYSICAL/120
  Air Slash/FLYING/PHYSICAL/96  →  Headbutt/NORMAL/PHYSICAL/70

### 19 Rattata
  Quick Attack/NORMAL/PHYSICAL/56  →  Tackle/NORMAL/PHYSICAL/40
  Scratch/NORMAL/PHYSICAL/56  →  Quick Attack/NORMAL/PHYSICAL/40
  Super Fang/NORMAL/PHYSICAL/56  →  Take Down/NORMAL/PHYSICAL/90
  Bite/DARK/PHYSICAL/72  →  Super Fang/NORMAL/PHYSICAL/72

### 20 Raticate
  Quick Attack/NORMAL/PHYSICAL/56  →  Quick Attack/NORMAL/PHYSICAL/40
  Scary Face/NORMAL/PHYSICAL/10  →  Tackle/NORMAL/PHYSICAL/40
  Scratch/NORMAL/PHYSICAL/56  →  Take Down/NORMAL/PHYSICAL/90
  Bite/DARK/PHYSICAL/72  →  Double-Edge/NORMAL/PHYSICAL/120
  Pursuit/DARK/PHYSICAL/120  →  Endeavor/NORMAL/PHYSICAL/120

### 21 Spearow
  Agility/PSYCHIC/PHYSICAL/10  →  Peck/FLYING/PHYSICAL/35
  Drill Peck/FLYING/PHYSICAL/56  →  Fury Attack/NORMAL/PHYSICAL/15
  Peck/FLYING/PHYSICAL/56  →  Aerial Ace/FLYING/PHYSICAL/15
  Sand Attack/GROUND/PHYSICAL/56  →  Wing Attack/FLYING/PHYSICAL/60
  Wing Attack/FLYING/PHYSICAL/120  →  Take Down/NORMAL/PHYSICAL/90

### 22 Fearow
  Aerial Ace/FLYING/PHYSICAL/56  →  Peck/FLYING/PHYSICAL/35
  Air Cutter/FLYING/PHYSICAL/56  →  Pluck/FLYING/PHYSICAL/60
  Drill Peck/FLYING/PHYSICAL/56  →  Fury Attack/NORMAL/PHYSICAL/15
  Gust/FLYING/SPECIAL/56  →  Aerial Ace/FLYING/PHYSICAL/15
  Peck/FLYING/PHYSICAL/56  →  Wing Attack/FLYING/PHYSICAL/60
  Sand Attack/GROUND/PHYSICAL/56  →  Take Down/NORMAL/PHYSICAL/90
  Confide/NORMAL/PHYSICAL/56  →  Drill Peck/FLYING/PHYSICAL/80
  Wing Attack/FLYING/PHYSICAL/120  →  Hyper Beam/NORMAL/SPECIAL/150

### 23 Ekans
  Acid/POISON/SPECIAL/56  →  Poison Sting/POISON/PHYSICAL/15
  Gunk Shot/POISON/PHYSICAL/56  →  Acid/POISON/SPECIAL/40
  Poison Fang/POISON/PHYSICAL/56  →  Acid Spray/POISON/SPECIAL/40
  Fear/GHOST/PHYSICAL/56  →  Sludge Bomb/POISON/SPECIAL/90
  Bite/DARK/PHYSICAL/72  →  Belch/POISON/SPECIAL/120

### 24 Arbok
  Acid/POISON/SPECIAL/56  →  Poison Sting/POISON/PHYSICAL/15
  Gunk Shot/POISON/PHYSICAL/56  →  Acid/POISON/SPECIAL/40
  Iron Tail/STEEL/PHYSICAL/56  →  Acid Spray/POISON/SPECIAL/40
  Pin Missile/BUG/PHYSICAL/56  →  Sludge Bomb/POISON/SPECIAL/90
  Poison Fang/POISON/PHYSICAL/56  →  Belch/POISON/SPECIAL/120
  Poison Jab/POISON/PHYSICAL/56  →  Gunk Shot/POISON/PHYSICAL/120
  Wrap/NORMAL/PHYSICAL/56  →  Poison Jab/POISON/PHYSICAL/80
  Bite/DARK/PHYSICAL/72  →  Poison Fang/POISON/PHYSICAL/50

### 25 Pikachu
  Agility/PSYCHIC/PHYSICAL/10  →  Nuzzle/ELECTRIC/PHYSICAL/20
  Charm/FAIRY/PHYSICAL/56  →  Thunder Shock/ELECTRIC/SPECIAL/40
  Quick Attack/NORMAL/PHYSICAL/56  →  Electro Ball/ELECTRIC/SPECIAL/56
  Thunder Punch/ELECTRIC/SPECIAL/56  →  Spark/ELECTRIC/PHYSICAL/65
  Thunder Shock/ELECTRIC/SPECIAL/56  →  Discharge/ELECTRIC/SPECIAL/80
  Thunderbolt/ELECTRIC/SPECIAL/72  →  Thunderbolt/ELECTRIC/SPECIAL/90
  Shock Wave/ELECTRIC/SPECIAL/80  →  Thunder/ELECTRIC/SPECIAL/110
  Thunder/ELECTRIC/SPECIAL/96  →  Volt Tackle/ELECTRIC/PHYSICAL/120
  Electric Storm/ELECTRIC/SPECIAL/200  →  Thunder Punch/ELECTRIC/PHYSICAL/75

### 26 Raichu
  Flash/NORMAL/PHYSICAL/10  →  Discharge/ELECTRIC/SPECIAL/80
  Swift/NORMAL/PHYSICAL/72  →  Electro Ball/ELECTRIC/SPECIAL/72
  Thunder Shock/ELECTRIC/SPECIAL/56  →  Nuzzle/ELECTRIC/PHYSICAL/20
  Thunderbolt/ELECTRIC/SPECIAL/72  →  Spark/ELECTRIC/PHYSICAL/65
  Wild Charge/ELECTRIC/PHYSICAL/120  →  Thunder/ELECTRIC/SPECIAL/110
  Volt Tackle/ELECTRIC/PHYSICAL/120  →  Thunder Shock/ELECTRIC/SPECIAL/40
  Thunder Wrath/ELECTRIC/SPECIAL/200  →  Thunderbolt/ELECTRIC/SPECIAL/90
  Electric Storm/ELECTRIC/SPECIAL/200  →  Volt Tackle/ELECTRIC/PHYSICAL/120

### 27 Sandshrew
  Scratch/NORMAL/PHYSICAL/56  →  Bulldoze/GROUND/PHYSICAL/60
  Sand Attack/GROUND/PHYSICAL/56  →  Dig/GROUND/PHYSICAL/80
  Mud Shot/GROUND/PHYSICAL/72  →  Earthquake/GROUND/PHYSICAL/100
  Rollout/ROCK/PHYSICAL/96  →  Mud-Slap/GROUND/SPECIAL/20
  Bulldoze/GROUND/PHYSICAL/200  →  Mud Shot/GROUND/SPECIAL/55

### 28 Sandslash
  Dig/GROUND/PHYSICAL/40  →  Bulldoze/GROUND/PHYSICAL/60
  Earthquake/GROUND/PHYSICAL/56  →  Sand Tomb/GROUND/PHYSICAL/35
  Scratch/NORMAL/PHYSICAL/56  →  Dig/GROUND/PHYSICAL/80
  Smack Down/ROCK/PHYSICAL/56  →  Earthquake/GROUND/PHYSICAL/100
  Slashing Blow/NORMAL/PHYSICAL/56  →  Mud-Slap/GROUND/SPECIAL/20
  Rollout/ROCK/PHYSICAL/96  →  Mud Shot/GROUND/SPECIAL/55
  Earth Power/GROUND/PHYSICAL/120  →  Stomping Tantrum/GROUND/PHYSICAL/75
  Fissure/GROUND/PHYSICAL/120  →  Drill Run/GROUND/PHYSICAL/80
  Sandstorm/ROCK/SPECIAL/160  →  Earth Power/GROUND/SPECIAL/90

### 29 Nidoran Female
  Quick Attack/NORMAL/PHYSICAL/56  →  Poison Sting/POISON/PHYSICAL/15
  Bite/DARK/PHYSICAL/72  →  Sludge Bomb/POISON/SPECIAL/90
  Horn Attack/NORMAL/PHYSICAL/96  →  Poison Jab/POISON/PHYSICAL/80
  Poison Sting/POISON/PHYSICAL/56  →  Scratch/NORMAL/PHYSICAL/40
  Poison Fang/POISON/PHYSICAL/56  →  Fury Swipes/NORMAL/PHYSICAL/18

### 30 Nidorina
  Agility/PSYCHIC/PHYSICAL/10  →  Poison Sting/POISON/PHYSICAL/15
  Cross Poison/POISON/PHYSICAL/56  →  Sludge Bomb/POISON/SPECIAL/90
  Dig/GROUND/PHYSICAL/40  →  Poison Jab/POISON/PHYSICAL/80
  Poison Jab/POISON/PHYSICAL/56  →  Scratch/NORMAL/PHYSICAL/40
  Quick Attack/NORMAL/PHYSICAL/56  →  Fury Swipes/NORMAL/PHYSICAL/18
  Horn Attack/NORMAL/PHYSICAL/96  →  Double Kick/FIGHTING/PHYSICAL/30
  Earth Power/GROUND/PHYSICAL/120  →  Bite/DARK/PHYSICAL/60

### 31 Nidoqueen
  Earthquake/GROUND/PHYSICAL/56  →  Earth Power/GROUND/SPECIAL/90
  Quick Attack/NORMAL/PHYSICAL/56  →  Poison Sting/POISON/PHYSICAL/15
  Smack Down/ROCK/PHYSICAL/56  →  Sludge Wave/POISON/SPECIAL/95
  Ground Collapse/GROUND/PHYSICAL/56  →  Earthquake/GROUND/PHYSICAL/100
  Horn Attack/NORMAL/PHYSICAL/96  →  Dig/GROUND/PHYSICAL/80
  Sand Tomb/GROUND/PHYSICAL/120  →  Sludge Bomb/POISON/SPECIAL/90
  Horn Burst/NORMAL/SPECIAL/120  →  Bulldoze/GROUND/PHYSICAL/60
  Bulldoze/GROUND/PHYSICAL/200  →  Poison Jab/POISON/PHYSICAL/80
  Fissure/GROUND/PHYSICAL/120  →  Bite/DARK/PHYSICAL/60

### 32 Nidoran Male
  Quick Attack/NORMAL/PHYSICAL/56  →  Poison Sting/POISON/PHYSICAL/15
  Bite/DARK/PHYSICAL/72  →  Poison Jab/POISON/PHYSICAL/80
  Horn Attack/NORMAL/PHYSICAL/96  →  Sludge Bomb/POISON/SPECIAL/90
  Poison Sting/POISON/PHYSICAL/56  →  Peck/FLYING/PHYSICAL/35
  Poison Fang/POISON/PHYSICAL/56  →  Fury Attack/NORMAL/PHYSICAL/15

### 33 Nidorino
  Cross Poison/POISON/PHYSICAL/56  →  Poison Sting/POISON/PHYSICAL/15
  Dig/GROUND/PHYSICAL/40  →  Poison Jab/POISON/PHYSICAL/80
  Poison Fang/POISON/PHYSICAL/56  →  Sludge Bomb/POISON/SPECIAL/90
  Poison Jab/POISON/PHYSICAL/56  →  Peck/FLYING/PHYSICAL/35
  Quick Attack/NORMAL/PHYSICAL/56  →  Fury Attack/NORMAL/PHYSICAL/15
  Rage/NORMAL/PHYSICAL/56  →  Double Kick/FIGHTING/PHYSICAL/30
  Horn Attack/NORMAL/PHYSICAL/96  →  Horn Attack/NORMAL/PHYSICAL/65
  Toxic Spikes/BUG/PHYSICAL/56  →  Earth Power/GROUND/SPECIAL/90

### 34 Nidoking
  Quick Attack/NORMAL/PHYSICAL/56  →  Earth Power/GROUND/SPECIAL/90
  Rage/NORMAL/PHYSICAL/56  →  Poison Jab/POISON/PHYSICAL/80
  Smack Down/ROCK/PHYSICAL/56  →  Poison Sting/POISON/PHYSICAL/15
  Venoshock/POISON/SPECIAL/56  →  Sludge Wave/POISON/SPECIAL/95
  Horn Burst/NORMAL/SPECIAL/120  →  Earthquake/GROUND/PHYSICAL/100
  Poison Fang/POISON/PHYSICAL/56  →  Dig/GROUND/PHYSICAL/80
  Poison Tail/POISON/PHYSICAL/96  →  Sludge Bomb/POISON/SPECIAL/90
  Sludge Bomb/POISON/SPECIAL/104  →  Bulldoze/GROUND/PHYSICAL/60
  Poison Jab/POISON/PHYSICAL/56  →  Double Kick/FIGHTING/PHYSICAL/30
  Toxic/POISON/PHYSICAL/120  →  Fury Attack/NORMAL/PHYSICAL/15

### 35 Clefairy
  Defense Curl/NORMAL/PHYSICAL/10  →  Disarming Voice/FAIRY/SPECIAL/1
  Double Slap/NORMAL/PHYSICAL/56  →  Moonblast/FAIRY/SPECIAL/95
  Sing/NORMAL/PHYSICAL/10  →  Fairy Wind/FAIRY/SPECIAL/40
  Multi-Slap/NORMAL/PHYSICAL/56  →  Draining Kiss/FAIRY/SPECIAL/50
  Healarea/FAIRY/PHYSICAL/56  →  Dazzling Gleam/FAIRY/SPECIAL/80
  Body Slam/NORMAL/PHYSICAL/72  →  Play Rough/FAIRY/PHYSICAL/90
  Metronome/NORMAL/PHYSICAL/120  →  Misty Explosion/FAIRY/SPECIAL/100
  Great Love/FAIRY/PHYSICAL/120  →  Alluring Voice/FAIRY/SPECIAL/80

### 36 Clefable
  Dazzling Gleam/FAIRY/PHYSICAL/56  →  Moonblast/FAIRY/SPECIAL/95
  Defense Curl/NORMAL/PHYSICAL/10  →  Fairy Wind/FAIRY/SPECIAL/40
  Protect/NORMAL/PHYSICAL/10  →  Disarming Voice/FAIRY/SPECIAL/8
  Multi-Slap/NORMAL/PHYSICAL/56  →  Draining Kiss/FAIRY/SPECIAL/50
  Doubleslap/NORMAL/PHYSICAL/80  →  Dazzling Gleam/FAIRY/SPECIAL/80
  Heart Pound/FAIRY/PHYSICAL/96  →  Play Rough/FAIRY/PHYSICAL/90
  Metronome/NORMAL/PHYSICAL/120  →  Misty Explosion/FAIRY/SPECIAL/100
  Great Love/FAIRY/PHYSICAL/120  →  Alluring Voice/FAIRY/SPECIAL/80

### 37 Vulpix
  Iron Tail/STEEL/PHYSICAL/56  →  Ember/FIRE/SPECIAL/40
  Quick Attack/NORMAL/PHYSICAL/56  →  Incinerate/FIRE/SPECIAL/60
  Ember/FIRE/SPECIAL/80  →  Flamethrower/FIRE/SPECIAL/90
  Flamethrower/FIRE/SPECIAL/80  →  Fire Spin/FIRE/SPECIAL/35
  Flame Circle/FIRE/SPECIAL/96  →  Inferno/FIRE/SPECIAL/100
  Fire Blast/FIRE/SPECIAL/160  →  Fire Blast/FIRE/SPECIAL/110

### 38 Ninetales
  Dig/GROUND/PHYSICAL/40  →  Flamethrower/FIRE/SPECIAL/90
  Ember/FIRE/SPECIAL/80  →  Fire Spin/FIRE/SPECIAL/35
  Flame Wheel/FIRE/PHYSICAL/60  →  Flame Charge/FIRE/PHYSICAL/50
  Headbutt/NORMAL/PHYSICAL/80  →  Heat Wave/FIRE/SPECIAL/95
  Inferno/FIRE/PHYSICAL/200  →  Fire Blast/FIRE/SPECIAL/110
  Iron Tail/STEEL/PHYSICAL/56  →  Overheat/FIRE/SPECIAL/130
  Nasty Plot/DARK/PHYSICAL/120  →  Flare Blitz/FIRE/PHYSICAL/120
  Quick Attack/NORMAL/PHYSICAL/56  →  Burning Jealousy/FIRE/SPECIAL/70
  Fire Ball/FIRE/SPECIAL/80  →  Quick Attack/NORMAL/PHYSICAL/40
  Hellfire Storm/FIRE/SPECIAL/200  →  Take Down/NORMAL/PHYSICAL/90
  Burning Jealousy/FIRE/PHYSICAL/200  →  Facade/NORMAL/PHYSICAL/70

### 39 Jigglypuff
  Dazzling Gleam/FAIRY/PHYSICAL/56  →  Disarming Voice/FAIRY/SPECIAL/1
  Play Rough/FAIRY/PHYSICAL/72  →  Pound/NORMAL/PHYSICAL/40
  Sing/NORMAL/PHYSICAL/10  →  Echoed Voice/NORMAL/SPECIAL/40
  Disarming Voice/FAIRY/PHYSICAL/56  →  Covet/NORMAL/PHYSICAL/60
  Heart Pound/FAIRY/PHYSICAL/96  →  Spit Up/NORMAL/SPECIAL/96
  Charm/FAIRY/PHYSICAL/56  →  Round/NORMAL/SPECIAL/60

### 40 Wigglytuff
  Dazzling Gleam/FAIRY/PHYSICAL/56  →  Body Slam/NORMAL/PHYSICAL/85
  Defense Curl/NORMAL/PHYSICAL/10  →  Covet/NORMAL/PHYSICAL/60
  Disarming Voice/FAIRY/PHYSICAL/56  →  Disarming Voice/FAIRY/SPECIAL/1
  Heal Pulse/NORMAL/SPECIAL/56  →  Double-Edge/NORMAL/PHYSICAL/120
  Sing/NORMAL/PHYSICAL/10  →  Echoed Voice/NORMAL/SPECIAL/40
  Play Rough/FAIRY/PHYSICAL/72  →  Hyper Voice/NORMAL/SPECIAL/90
  Heart Pound/FAIRY/PHYSICAL/96  →  Pound/NORMAL/PHYSICAL/40
  Soft-Boiled/NORMAL/PHYSICAL/96  →  Round/NORMAL/SPECIAL/60

### 41 Zubat
  Leech Life/BUG/PHYSICAL/56  →  Gust/FLYING/SPECIAL/40
  Poison Fang/POISON/PHYSICAL/56  →  Wing Attack/FLYING/PHYSICAL/60
  Super Sonic/NORMAL/PHYSICAL/56  →  Poison Fang/POISON/PHYSICAL/50
  Bite/DARK/PHYSICAL/72  →  Air Slash/FLYING/SPECIAL/75
  Toxic/POISON/PHYSICAL/120  →  Air Cutter/FLYING/SPECIAL/60

### 42 Golbat
  Air Cutter/FLYING/PHYSICAL/56  →  Gust/FLYING/SPECIAL/40
  Gust/FLYING/SPECIAL/56  →  Wing Attack/FLYING/PHYSICAL/60
  Poison Fang/POISON/PHYSICAL/56  →  Poison Fang/POISON/PHYSICAL/50
  Super Sonic/NORMAL/PHYSICAL/56  →  Air Slash/FLYING/SPECIAL/75
  Bite/DARK/PHYSICAL/72  →  Air Cutter/FLYING/SPECIAL/60
  Toxic/POISON/PHYSICAL/120  →  Cross Poison/POISON/PHYSICAL/70
  Wing Attack/FLYING/PHYSICAL/120  →  Aerial Ace/FLYING/PHYSICAL/120

### 43 Oddish
  Absorb/GRASS/PHYSICAL/56  →  Absorb/GRASS/SPECIAL/20
  Acid/POISON/SPECIAL/56  →  Acid/POISON/SPECIAL/40
  Poison Powder/POISON/SPECIAL/56  →  Mega Drain/GRASS/SPECIAL/40
  Sleep Powder/GRASS/SPECIAL/56  →  Giga Drain/GRASS/SPECIAL/75
  Stun Spore/GRASS/SPECIAL/56  →  Petal Dance/GRASS/SPECIAL/120
  Leech Seed/GRASS/SPECIAL/120  →  Acid Spray/POISON/SPECIAL/40

### 44 Gloom
  Absorb/GRASS/PHYSICAL/56  →  Absorb/GRASS/SPECIAL/20
  Acid/POISON/SPECIAL/56  →  Acid/POISON/SPECIAL/40
  Poison Powder/POISON/SPECIAL/56  →  Mega Drain/GRASS/SPECIAL/40
  Sleep Powder/GRASS/SPECIAL/56  →  Giga Drain/GRASS/SPECIAL/75
  Stun Spore/GRASS/SPECIAL/56  →  Petal Dance/GRASS/SPECIAL/120
  Poison Bomb/GRASS/SPECIAL/56  →  Acid Spray/POISON/SPECIAL/40
  Poison Gas/POISON/PHYSICAL/96  →  Trailblaze/GRASS/PHYSICAL/50
  Leech Seed/GRASS/SPECIAL/120  →  Magical Leaf/GRASS/SPECIAL/120

### 45 Vileplume
  Absorb/GRASS/PHYSICAL/56  →  Absorb/GRASS/SPECIAL/20
  Acid/POISON/SPECIAL/56  →  Acid/POISON/SPECIAL/40
  Poison Powder/POISON/SPECIAL/56  →  Giga Drain/GRASS/SPECIAL/75
  Sleep Powder/GRASS/SPECIAL/56  →  Mega Drain/GRASS/SPECIAL/40
  Stun Spore/GRASS/SPECIAL/56  →  Petal Dance/GRASS/SPECIAL/120
  Poison Bomb/GRASS/SPECIAL/56  →  Acid Spray/POISON/SPECIAL/40
  Petal Dance/GRASS/PHYSICAL/96  →  Trailblaze/GRASS/PHYSICAL/50
  Poison Gas/POISON/PHYSICAL/96  →  Magical Leaf/GRASS/SPECIAL/96
  Leech Seed/GRASS/SPECIAL/120  →  Venoshock/POISON/SPECIAL/65
  Solar Beam/GRASS/SPECIAL/120  →  Bullet Seed/GRASS/PHYSICAL/25

### 46 Paras
  Poison Powder/POISON/SPECIAL/56  →  Absorb/GRASS/SPECIAL/20
  Poison Sting/POISON/PHYSICAL/56  →  X-Scissor/BUG/PHYSICAL/80
  Scratch/NORMAL/PHYSICAL/56  →  Energy Ball/GRASS/SPECIAL/90
  Sleep Powder/GRASS/SPECIAL/56  →  Leech Life/BUG/PHYSICAL/80
  Stun Spore/GRASS/SPECIAL/56  →  Venoshock/POISON/SPECIAL/65
  Slash/NORMAL/PHYSICAL/72  →  Slash/NORMAL/PHYSICAL/70

### 47 Parasect
  Absorb/GRASS/PHYSICAL/56  →  Absorb/GRASS/SPECIAL/20
  Fury Cutter/BUG/PHYSICAL/56  →  X-Scissor/BUG/PHYSICAL/80
  Leech Life/BUG/PHYSICAL/56  →  Energy Ball/GRASS/SPECIAL/90
  Poison Powder/POISON/SPECIAL/56  →  Leech Life/BUG/PHYSICAL/80
  Poison Sting/POISON/PHYSICAL/56  →  Venoshock/POISON/SPECIAL/65
  Sleep Powder/GRASS/SPECIAL/56  →  Slash/NORMAL/PHYSICAL/70
  Stun Spore/GRASS/SPECIAL/56  →  Aerial Ace/FLYING/PHYSICAL/56
  Poison Bomb/GRASS/SPECIAL/56  →  False Swipe/NORMAL/PHYSICAL/40
  Slash/NORMAL/PHYSICAL/72  →  Giga Impact/NORMAL/PHYSICAL/150
  X-Scissor/BUG/PHYSICAL/120  →  Hyper Beam/NORMAL/SPECIAL/150

### 48 Venonat
  Poison Powder/POISON/SPECIAL/56  →  Bug Buzz/BUG/SPECIAL/90
  Psybeam/PSYCHIC/SPECIAL/56  →  Leech Life/BUG/PHYSICAL/80
  Sleep Powder/GRASS/SPECIAL/56  →  Poison Fang/POISON/PHYSICAL/50
  Stun Spore/GRASS/SPECIAL/56  →  Acid Spray/POISON/SPECIAL/40
  Super Sonic/NORMAL/PHYSICAL/56  →  Struggle Bug/BUG/SPECIAL/50
  Confusion/PSYCHIC/SPECIAL/80  →  Pounce/BUG/PHYSICAL/50
  Psychic/PSYCHIC/SPECIAL/96  →  Venoshock/POISON/SPECIAL/65
  Silver Wind/BUG/PHYSICAL/120  →  Sludge Bomb/POISON/SPECIAL/90

### 49 Venomoth
  Bug Buzz/BUG/PHYSICAL/56  →  Bug Buzz/BUG/SPECIAL/90
  Poison Powder/POISON/SPECIAL/56  →  Leech Life/BUG/PHYSICAL/80
  Psybeam/PSYCHIC/SPECIAL/56  →  Poison Fang/POISON/PHYSICAL/50
  Signal Beam/BUG/SPECIAL/56  →  Acid Spray/POISON/SPECIAL/40
  Sleep Powder/GRASS/SPECIAL/56  →  Struggle Bug/BUG/SPECIAL/50
  Super Sonic/NORMAL/PHYSICAL/56  →  Pounce/BUG/PHYSICAL/50
  Confusion/PSYCHIC/SPECIAL/80  →  Venoshock/POISON/SPECIAL/65
  Psychic/PSYCHIC/SPECIAL/96  →  U-turn/BUG/PHYSICAL/70
  Silver Wind/BUG/PHYSICAL/120  →  Sludge Bomb/POISON/SPECIAL/90

### 50 Diglett
  Mud-Slap/GROUND/PHYSICAL/56  →  Mud-Slap/GROUND/SPECIAL/20
  Sand Attack/GROUND/PHYSICAL/56  →  Bulldoze/GROUND/PHYSICAL/60
  Mud Shot/GROUND/PHYSICAL/72  →  Dig/GROUND/PHYSICAL/80
  Slash/NORMAL/PHYSICAL/72  →  Earth Power/GROUND/SPECIAL/90
  Earth Power/GROUND/PHYSICAL/120  →  Earthquake/GROUND/PHYSICAL/100

### 51 Dugtrio
  Dig/GROUND/PHYSICAL/40  →  Mud-Slap/GROUND/SPECIAL/20
  Earthquake/GROUND/PHYSICAL/56  →  Bulldoze/GROUND/PHYSICAL/60
  Mud-Slap/GROUND/PHYSICAL/56  →  Dig/GROUND/PHYSICAL/80
  Rage/NORMAL/PHYSICAL/56  →  Earth Power/GROUND/SPECIAL/90
  Sand Attack/GROUND/PHYSICAL/56  →  Earthquake/GROUND/PHYSICAL/100
  Mud Shot/GROUND/PHYSICAL/72  →  Fissure/GROUND/PHYSICAL/72
  Slash/NORMAL/PHYSICAL/72  →  Mud Shot/GROUND/SPECIAL/55
  Earth Power/GROUND/PHYSICAL/120  →  Stomping Tantrum/GROUND/PHYSICAL/75

### 52 Meowth
  Scratch/NORMAL/PHYSICAL/56  →  Fake Out/NORMAL/PHYSICAL/40
  Pay Day/NORMAL/PHYSICAL/56  →  Feint/NORMAL/PHYSICAL/30
  Bite/DARK/PHYSICAL/72  →  Scratch/NORMAL/PHYSICAL/40
  Slash/NORMAL/PHYSICAL/72  →  Pay Day/NORMAL/PHYSICAL/40
  Night Slash/DARK/PHYSICAL/120  →  Fury Swipes/NORMAL/PHYSICAL/18

### 53 Persian
  Scratch/NORMAL/PHYSICAL/56  →  Fake Out/NORMAL/PHYSICAL/40
  Fear/GHOST/PHYSICAL/56  →  Feint/NORMAL/PHYSICAL/30
  Pay Day/NORMAL/PHYSICAL/56  →  Scratch/NORMAL/PHYSICAL/40
  Torment/NORMAL/PHYSICAL/56  →  Pay Day/NORMAL/PHYSICAL/40
  Bite/DARK/PHYSICAL/72  →  Fury Swipes/NORMAL/PHYSICAL/18
  Slash/NORMAL/PHYSICAL/72  →  Slash/NORMAL/PHYSICAL/70
  Night Slash/DARK/PHYSICAL/120  →  Take Down/NORMAL/PHYSICAL/90
  Power Gem/ROCK/SPECIAL/80  →  Headbutt/NORMAL/PHYSICAL/70

### 54 Psyduck
  Aqua Tail/WATER/PHYSICAL/64  →  Water Gun/WATER/SPECIAL/40
  Water Gun/WATER/PHYSICAL/64  →  Water Pulse/WATER/SPECIAL/60
  Water Ball/WATER/SPECIAL/64  →  Aqua Tail/WATER/PHYSICAL/90
  Confusion/PSYCHIC/SPECIAL/80  →  Chilling Water/WATER/SPECIAL/50
  Headbutt/NORMAL/PHYSICAL/80  →  Waterfall/WATER/PHYSICAL/80
  Stunning Confusion/WATER/SPECIAL/96  →  Liquidation/WATER/PHYSICAL/85

### 55 Golduck
  Water Gun/WATER/PHYSICAL/64  →  Aqua Jet/WATER/PHYSICAL/40
  Water Pulse/WATER/SPECIAL/120  →  Water Gun/WATER/SPECIAL/40
  Confusion/PSYCHIC/SPECIAL/80  →  Water Pulse/WATER/SPECIAL/60
  Fury Swipes/NORMAL/PHYSICAL/96  →  Aqua Tail/WATER/PHYSICAL/90
  Psychic/PSYCHIC/SPECIAL/96  →  Hydro Pump/WATER/SPECIAL/110
  Stunning Confusion/WATER/SPECIAL/96  →  Chilling Water/WATER/SPECIAL/50
  Hydro Pump/WATER/SPECIAL/136  →  Waterfall/WATER/PHYSICAL/80
  Surf/WATER/SPECIAL/160  →  Liquidation/WATER/PHYSICAL/85

### 56 Mankey
  Cross Chop/FIGHTING/PHYSICAL/56  →  Low Kick/FIGHTING/PHYSICAL/56
  Karate Chop/FIGHTING/PHYSICAL/56  →  Seismic Toss/FIGHTING/PHYSICAL/56
  Rage/NORMAL/PHYSICAL/56  →  Cross Chop/FIGHTING/PHYSICAL/100
  Scratch/NORMAL/PHYSICAL/56  →  Close Combat/FIGHTING/PHYSICAL/120
  Triple Kick/FIGHTING/PHYSICAL/56  →  Final Gambit/FIGHTING/SPECIAL/56
  + Rock Smash/FIGHTING/PHYSICAL/40  (slot novo · cd 26000 · lv 20)
  + Low Sweep/FIGHTING/PHYSICAL/65  (slot novo · cd 30000 · lv 28)
  + Brick Break/FIGHTING/PHYSICAL/75  (slot novo · cd 36000 · lv 36)
  + Dynamic Punch/FIGHTING/PHYSICAL/100  (slot novo · cd 42000 · lv 44)
  + Power-Up Punch/FIGHTING/PHYSICAL/40  (slot novo · cd 50000 · lv 52)

### 57 Primeape
  Close Combat/FIGHTING/PHYSICAL/56  →  Low Kick/FIGHTING/PHYSICAL/56
  Cross Chop/FIGHTING/PHYSICAL/56  →  Seismic Toss/FIGHTING/PHYSICAL/56
  Karate Chop/FIGHTING/PHYSICAL/56  →  Cross Chop/FIGHTING/PHYSICAL/100
  Rage/NORMAL/PHYSICAL/56  →  Close Combat/FIGHTING/PHYSICAL/120
  Scratch/NORMAL/PHYSICAL/56  →  Final Gambit/FIGHTING/SPECIAL/56
  Triple Kick/FIGHTING/PHYSICAL/56  →  Rock Smash/FIGHTING/PHYSICAL/40
  Mega Kick/NORMAL/PHYSICAL/96  →  Low Sweep/FIGHTING/PHYSICAL/65
  Mega Punch/NORMAL/PHYSICAL/96  →  Brick Break/FIGHTING/PHYSICAL/75
  + Dynamic Punch/FIGHTING/PHYSICAL/100  (slot novo · cd 42000 · lv 44)
  + Power-Up Punch/FIGHTING/PHYSICAL/40  (slot novo · cd 50000 · lv 52)

### 58 Growlithe
  Fire Fang/FIRE/SPECIAL/56  →  Ember/FIRE/SPECIAL/40
  Heat Wave/FIRE/SPECIAL/56  →  Flame Wheel/FIRE/PHYSICAL/60
  Roar/NORMAL/PHYSICAL/56  →  Fire Fang/FIRE/PHYSICAL/65
  War Dog/FIRE/PHYSICAL/56  →  Flamethrower/FIRE/SPECIAL/90
  Bite/DARK/PHYSICAL/72  →  Flare Blitz/FIRE/PHYSICAL/120
  Ember/FIRE/SPECIAL/80  →  Fire Spin/FIRE/SPECIAL/35
  Flamethrower/FIRE/SPECIAL/80  →  Flame Charge/FIRE/PHYSICAL/50
  Fire Ball/FIRE/SPECIAL/80  →  Heat Wave/FIRE/SPECIAL/95

### 59 Arcanine
  Extreme Speed/NORMAL/PHYSICAL/56  →  Ember/FIRE/SPECIAL/40
  Fire Fang/FIRE/SPECIAL/56  →  Fire Fang/FIRE/PHYSICAL/65
  War Dog/FIRE/PHYSICAL/56  →  Flame Wheel/FIRE/PHYSICAL/60
  Burn Up/FIRE/PHYSICAL/56  →  Flare Blitz/FIRE/PHYSICAL/120
  Bite/DARK/PHYSICAL/72  →  Flamethrower/FIRE/SPECIAL/90
  Ember/FIRE/SPECIAL/80  →  Fire Spin/FIRE/SPECIAL/35
  Fire Ball/FIRE/SPECIAL/80  →  Flame Charge/FIRE/PHYSICAL/50
  Flare Blitz/FIRE/PHYSICAL/160  →  Heat Wave/FIRE/SPECIAL/95
  Hellfire Storm/FIRE/SPECIAL/200  →  Fire Blast/FIRE/SPECIAL/110

### 60 Poliwag
  Hypnosis/PSYCHIC/PHYSICAL/56  →  Water Gun/WATER/SPECIAL/40
  Bubbles/WATER/SPECIAL/56  →  Bubble Beam/WATER/SPECIAL/65
  Aqua Tail/WATER/PHYSICAL/64  →  Hydro Pump/WATER/SPECIAL/110
  Water Gun/WATER/PHYSICAL/64  →  Water Pulse/WATER/SPECIAL/60
  Doubleslap/NORMAL/PHYSICAL/80  →  Chilling Water/WATER/SPECIAL/50

### 61 Poliwhirl
  Brick Break/FIGHTING/PHYSICAL/56  →  Water Gun/WATER/SPECIAL/40
  Hypnosis/PSYCHIC/PHYSICAL/56  →  Bubble Beam/WATER/SPECIAL/65
  Water Gun/WATER/PHYSICAL/64  →  Hydro Pump/WATER/SPECIAL/110
  Mud Shot/GROUND/PHYSICAL/72  →  Water Pulse/WATER/SPECIAL/60
  Doubleslap/NORMAL/PHYSICAL/80  →  Chilling Water/WATER/SPECIAL/50
  Bubble Beam/WATER/SPECIAL/80  →  Waterfall/WATER/PHYSICAL/80
  Ice Beam/ICE/SPECIAL/96  →  Liquidation/WATER/PHYSICAL/85
  Dynamic Punch/FIGHTING/PHYSICAL/120  →  Surf/WATER/SPECIAL/90

### 62 Poliwrath
  Hypnosis/PSYCHIC/PHYSICAL/56  →  Bubble Beam/WATER/SPECIAL/65
  Mud-Slap/GROUND/PHYSICAL/56  →  Water Pulse/WATER/SPECIAL/60
  Water Gun/WATER/PHYSICAL/64  →  Low Kick/FIGHTING/PHYSICAL/64
  Doubleslap/NORMAL/PHYSICAL/80  →  Chilling Water/WATER/SPECIAL/50
  Bubble Beam/WATER/SPECIAL/80  →  Low Sweep/FIGHTING/PHYSICAL/65
  Dynamic Punch/FIGHTING/PHYSICAL/120  →  Brick Break/FIGHTING/PHYSICAL/75
  Liquidation/WATER/PHYSICAL/160  →  Drain Punch/FIGHTING/PHYSICAL/75
  Surf/WATER/SPECIAL/160  →  Waterfall/WATER/PHYSICAL/80
  Hydro Pump/WATER/SPECIAL/136  →  Liquidation/WATER/PHYSICAL/85
  + Surf/WATER/SPECIAL/90  (slot novo · cd 50000 · lv 52)

### 63 Abra
  Calm Mind/PSYCHIC/PHYSICAL/56  →  Zen Headbutt/PSYCHIC/PHYSICAL/80
  Psychic/PSYCHIC/SPECIAL/96  →  Psychic/PSYCHIC/SPECIAL/90
  Psy Pulse/PSYCHIC/SPECIAL/96  →  Dream Eater/PSYCHIC/SPECIAL/100
  Recover/NORMAL/PHYSICAL/160  →  Thunder Punch/ELECTRIC/PHYSICAL/75

### 64 Kadabra
  Calm Mind/PSYCHIC/PHYSICAL/56  →  Psybeam/PSYCHIC/SPECIAL/65
  Hypnosis/PSYCHIC/PHYSICAL/56  →  Psycho Cut/PSYCHIC/PHYSICAL/70
  Miracle Eye/PSYCHIC/PHYSICAL/10  →  Psyshock/PSYCHIC/SPECIAL/80
  Psybeam/PSYCHIC/SPECIAL/56  →  Psychic/PSYCHIC/SPECIAL/90
  Psywave/PSYCHIC/SPECIAL/56  →  Future Sight/PSYCHIC/SPECIAL/120
  Reflect/PSYCHIC/PHYSICAL/10  →  Confusion/PSYCHIC/SPECIAL/50
  Confusion/PSYCHIC/SPECIAL/80  →  Zen Headbutt/PSYCHIC/PHYSICAL/80
  Psychic/PSYCHIC/SPECIAL/96  →  Dream Eater/PSYCHIC/SPECIAL/100
  Psy Pulse/PSYCHIC/SPECIAL/96  →  Thunder Punch/ELECTRIC/PHYSICAL/75
  Recover/NORMAL/PHYSICAL/160  →  Ice Punch/ICE/PHYSICAL/75

### 65 Alakazam
  Calm Mind/PSYCHIC/PHYSICAL/56  →  Psybeam/PSYCHIC/SPECIAL/65
  Confusion/PSYCHIC/SPECIAL/80  →  Psycho Cut/PSYCHIC/PHYSICAL/70
  Future Sight/PSYCHIC/PHYSICAL/56  →  Psyshock/PSYCHIC/SPECIAL/80
  Psychic/PSYCHIC/SPECIAL/96  →  Psychic/PSYCHIC/SPECIAL/90
  Kinesis/PSYCHIC/PHYSICAL/56  →  Future Sight/PSYCHIC/SPECIAL/120
  Psybeam/PSYCHIC/SPECIAL/56  →  Confusion/PSYCHIC/SPECIAL/50
  Psyshock/PSYCHIC/SPECIAL/144  →  Zen Headbutt/PSYCHIC/PHYSICAL/80
  Psycho Cut/PSYCHIC/PHYSICAL/200  →  Dream Eater/PSYCHIC/SPECIAL/100

### 66 Machop
  Agility/PSYCHIC/PHYSICAL/10  →  Rock Smash/FIGHTING/PHYSICAL/40
  Karate Chop/FIGHTING/PHYSICAL/56  →  Power-Up Punch/FIGHTING/PHYSICAL/40
  Triple Punch/FIGHTING/PHYSICAL/56  →  Brick Break/FIGHTING/PHYSICAL/75
  Focus Blast/FIGHTING/SPECIAL/96  →  Dynamic Punch/FIGHTING/PHYSICAL/100
  Mega Punch/NORMAL/PHYSICAL/96  →  Mach Punch/FIGHTING/PHYSICAL/40
  + Close Combat/FIGHTING/PHYSICAL/120  (slot novo · cd 26000 · lv 20)
  + Focus Blast/FIGHTING/SPECIAL/120  (slot novo · cd 30000 · lv 28)
  + Low Sweep/FIGHTING/PHYSICAL/65  (slot novo · cd 36000 · lv 36)
  + Drain Punch/FIGHTING/PHYSICAL/75  (slot novo · cd 42000 · lv 44)
  + Brutal Swing/DARK/PHYSICAL/60  (slot novo · cd 50000 · lv 52)

### 67 Machoke
  Agility/PSYCHIC/PHYSICAL/10  →  Rock Smash/FIGHTING/PHYSICAL/40
  Karate Chop/FIGHTING/PHYSICAL/56  →  Power-Up Punch/FIGHTING/PHYSICAL/40
  Triple Punch/FIGHTING/PHYSICAL/56  →  Brick Break/FIGHTING/PHYSICAL/75
  Focus Blast/FIGHTING/SPECIAL/96  →  Dynamic Punch/FIGHTING/PHYSICAL/100
  Mega Kick/NORMAL/PHYSICAL/96  →  Mach Punch/FIGHTING/PHYSICAL/40
  Mega Punch/NORMAL/PHYSICAL/96  →  Close Combat/FIGHTING/PHYSICAL/120
  Arm Thrust/FIGHTING/PHYSICAL/120  →  Focus Blast/FIGHTING/SPECIAL/120
  + Low Sweep/FIGHTING/PHYSICAL/65  (slot novo · cd 36000 · lv 36)
  + Drain Punch/FIGHTING/PHYSICAL/75  (slot novo · cd 42000 · lv 44)
  + Brutal Swing/DARK/PHYSICAL/60  (slot novo · cd 50000 · lv 52)

### 68 Machamp
  Agility/PSYCHIC/PHYSICAL/10  →  Rock Smash/FIGHTING/PHYSICAL/40
  Karate Chop/FIGHTING/PHYSICAL/56  →  Power-Up Punch/FIGHTING/PHYSICAL/40
  Triple Punch/FIGHTING/PHYSICAL/56  →  Brick Break/FIGHTING/PHYSICAL/75
  Low Kick/FIGHTING/PHYSICAL/80  →  Dynamic Punch/FIGHTING/PHYSICAL/100
  Focus Blast/FIGHTING/SPECIAL/96  →  Mach Punch/FIGHTING/PHYSICAL/40
  Arm Thrust/FIGHTING/PHYSICAL/120  →  Drain Punch/FIGHTING/PHYSICAL/75
  Dynamic Punch/FIGHTING/PHYSICAL/120  →  Close Combat/FIGHTING/PHYSICAL/120
  Vacuum Wave/FIGHTING/SPECIAL/200  →  Focus Blast/FIGHTING/SPECIAL/120
  + Low Sweep/FIGHTING/PHYSICAL/65  (slot novo · cd 42000 · lv 44)
  + Storm Throw/FIGHTING/PHYSICAL/60  (slot novo · cd 50000 · lv 52)

### 69 Bellsprout
  Acid/POISON/SPECIAL/56  →  Vine Whip/GRASS/PHYSICAL/45
  Razor Leaf/GRASS/SPECIAL/56  →  Acid/POISON/SPECIAL/40
  Slash/NORMAL/PHYSICAL/72  →  Razor Leaf/GRASS/PHYSICAL/55
  Vine Whip/GRASS/SPECIAL/72  →  Poison Jab/POISON/PHYSICAL/80

### 70 Weepinbell
  Poison Powder/POISON/SPECIAL/56  →  Vine Whip/GRASS/PHYSICAL/45
  Razor Leaf/GRASS/SPECIAL/56  →  Acid/POISON/SPECIAL/40
  Sleep Powder/GRASS/SPECIAL/56  →  Razor Leaf/GRASS/PHYSICAL/55
  Stun Spore/GRASS/SPECIAL/56  →  Poison Jab/POISON/PHYSICAL/80
  Poison Bomb/GRASS/SPECIAL/56  →  Power Whip/GRASS/PHYSICAL/120
  Growth/NORMAL/PHYSICAL/56  →  Magical Leaf/GRASS/SPECIAL/23
  Vine Whip/GRASS/SPECIAL/72  →  Sludge Wave/POISON/SPECIAL/95
  Magical Leaf/GRASS/PHYSICAL/96  →  Leaf Storm/GRASS/SPECIAL/130
  Leaf Storm/GRASS/SPECIAL/160  →  Energy Ball/GRASS/SPECIAL/90

### 71 Victreebel
  Poison Powder/POISON/SPECIAL/56  →  Razor Leaf/GRASS/PHYSICAL/55
  Razor Leaf/GRASS/SPECIAL/56  →  Vine Whip/GRASS/PHYSICAL/45
  Sleep Powder/GRASS/SPECIAL/56  →  Leaf Blade/GRASS/PHYSICAL/90
  Growth/NORMAL/PHYSICAL/56  →  Magical Leaf/GRASS/SPECIAL/23
  Vine Whip/GRASS/SPECIAL/72  →  Poison Jab/POISON/PHYSICAL/80
  Giga Drain/GRASS/PHYSICAL/96  →  Sludge Wave/POISON/SPECIAL/95
  Magical Leaf/GRASS/PHYSICAL/96  →  Power Whip/GRASS/PHYSICAL/120
  Leaf Tornado/GRASS/PHYSICAL/120  →  Leaf Storm/GRASS/SPECIAL/130
  Leaf Storm/GRASS/SPECIAL/160  →  Energy Ball/GRASS/SPECIAL/90

### 72 Tentacool
  Acid/POISON/SPECIAL/56  →  Poison Sting/POISON/PHYSICAL/15
  Poison Jab/POISON/PHYSICAL/56  →  Water Gun/WATER/SPECIAL/40
  Wrap/NORMAL/PHYSICAL/56  →  Acid/POISON/SPECIAL/40
  Bubbles/WATER/SPECIAL/56  →  Water Pulse/WATER/SPECIAL/60
  Super Sonic/NORMAL/PHYSICAL/56  →  Bubble Beam/WATER/SPECIAL/65
  Water Ball/WATER/SPECIAL/64  →  Poison Jab/POISON/PHYSICAL/80

### 73 Tentacruel
  Acid Armor/WATER/SPECIAL/56  →  Acid/POISON/SPECIAL/40
  Screech/NORMAL/PHYSICAL/56  →  Poison Sting/POISON/PHYSICAL/15
  Wrap/NORMAL/PHYSICAL/56  →  Water Gun/WATER/SPECIAL/40
  Bubbles/WATER/SPECIAL/56  →  Water Pulse/WATER/SPECIAL/60
  Venomous Sting/POISON/SPECIAL/56  →  Bubble Beam/WATER/SPECIAL/65
  Water Ball/WATER/SPECIAL/64  →  Poison Jab/POISON/PHYSICAL/80
  Water Pulse/WATER/SPECIAL/120  →  Surf/WATER/SPECIAL/90
  Bubble Beam/WATER/SPECIAL/80  →  Sludge Wave/POISON/SPECIAL/95
  Hydro Pump/WATER/SPECIAL/136  →  Hydro Pump/WATER/SPECIAL/110
  Surf/WATER/SPECIAL/160  →  Acid Spray/POISON/SPECIAL/40

### 74 Geodude
  Tackle/NORMAL/PHYSICAL/56  →  Rollout/ROCK/PHYSICAL/30
  Rock Throw/ROCK/PHYSICAL/96  →  Bulldoze/GROUND/PHYSICAL/60
  Earth Power/GROUND/PHYSICAL/120  →  Rock Throw/ROCK/PHYSICAL/50
  Rock Slide/ROCK/PHYSICAL/120  →  Smack Down/ROCK/PHYSICAL/50

### 75 Graveler
  Harden/NORMAL/PHYSICAL/10  →  Rollout/ROCK/PHYSICAL/30
  Stone Edge/ROCK/PHYSICAL/56  →  Bulldoze/GROUND/PHYSICAL/60
  Selfdestruction/NORMAL/PHYSICAL/56  →  Rock Throw/ROCK/PHYSICAL/50
  Rock Throw/ROCK/PHYSICAL/96  →  Smack Down/ROCK/PHYSICAL/50
  Earth Power/GROUND/PHYSICAL/120  →  Rock Blast/ROCK/PHYSICAL/25
  Rock Slide/ROCK/PHYSICAL/120  →  Earthquake/GROUND/PHYSICAL/100
  Falling Rocks/ROCK/PHYSICAL/200  →  Stone Edge/ROCK/PHYSICAL/100

### 76 Golem
  Harden/NORMAL/PHYSICAL/10  →  Rock Throw/ROCK/PHYSICAL/50
  Rock Slide/ROCK/PHYSICAL/120  →  Smack Down/ROCK/PHYSICAL/50
  Rock Throw/ROCK/PHYSICAL/96  →  Bulldoze/GROUND/PHYSICAL/60
  Rollout/ROCK/PHYSICAL/96  →  Rock Blast/ROCK/PHYSICAL/25
  Rock Blast/ROCK/SPECIAL/120  →  Earthquake/GROUND/PHYSICAL/100
  Ancient Power/ROCK/PHYSICAL/160  →  Stone Edge/ROCK/PHYSICAL/100
  Rock Wrecker/ROCK/PHYSICAL/200  →  Mud-Slap/GROUND/SPECIAL/20
  Falling Rocks/ROCK/PHYSICAL/200  →  Mud Shot/GROUND/SPECIAL/55

### 77 Ponyta
  Quick Attack/NORMAL/PHYSICAL/56  →  Ember/FIRE/SPECIAL/40
  Ember/FIRE/SPECIAL/80  →  Flame Wheel/FIRE/PHYSICAL/60
  Flamethrower/FIRE/SPECIAL/80  →  Fire Blast/FIRE/SPECIAL/110
  Stomp/NORMAL/PHYSICAL/80  →  Flare Blitz/FIRE/PHYSICAL/120
  Fire Ball/FIRE/SPECIAL/80  →  Flamethrower/FIRE/SPECIAL/90

### 78 Rapidash
  Lightning Horn/ELECTRIC/PHYSICAL/56  →  Ember/FIRE/SPECIAL/40
  Blue Flames/FIRE/SPECIAL/10  →  Flame Wheel/FIRE/PHYSICAL/60
  Thunder Sphere/ELECTRIC/SPECIAL/72  →  Fire Blast/FIRE/SPECIAL/110
  Ember/FIRE/SPECIAL/80  →  Flare Blitz/FIRE/PHYSICAL/120
  Flame Charge/FIRE/SPECIAL/96  →  Flamethrower/FIRE/SPECIAL/90
  Tail Whip/NORMAL/PHYSICAL/120  →  Mystical Fire/FIRE/SPECIAL/75
  Wild Charge/ELECTRIC/PHYSICAL/120  →  Tackle/NORMAL/PHYSICAL/40
  Morning Sun/NORMAL/PHYSICAL/200  →  Double Hit/NORMAL/PHYSICAL/35

### 79 Slowpoke
  Iron Tail/STEEL/PHYSICAL/56  →  Water Gun/WATER/SPECIAL/40
  Aqua Tail/WATER/PHYSICAL/64  →  Confusion/PSYCHIC/SPECIAL/50
  Water Gun/WATER/PHYSICAL/64  →  Water Pulse/WATER/SPECIAL/60
  Water Ball/WATER/SPECIAL/64  →  Zen Headbutt/PSYCHIC/PHYSICAL/80
  Confusion/PSYCHIC/SPECIAL/80  →  Surf/WATER/SPECIAL/90
  Headbutt/NORMAL/PHYSICAL/80  →  Psychic/PSYCHIC/SPECIAL/90

### 80 Slowbro
  Iron Tail/STEEL/PHYSICAL/56  →  Water Gun/WATER/SPECIAL/40
  Yawn/WATER/PHYSICAL/56  →  Confusion/PSYCHIC/SPECIAL/50
  Aqua Tail/WATER/PHYSICAL/64  →  Water Pulse/WATER/SPECIAL/60
  Water Gun/WATER/PHYSICAL/64  →  Zen Headbutt/PSYCHIC/PHYSICAL/80
  Water Ball/WATER/SPECIAL/64  →  Surf/WATER/SPECIAL/90
  Confusion/PSYCHIC/SPECIAL/80  →  Psychic/PSYCHIC/SPECIAL/90
  Headbutt/NORMAL/PHYSICAL/80  →  Psybeam/PSYCHIC/SPECIAL/65
  Psychic/PSYCHIC/SPECIAL/96  →  Future Sight/PSYCHIC/SPECIAL/120

### 81 Magnemite
  Electro Ball/ELECTRIC/SPECIAL/56  →  Thunder Shock/ELECTRIC/SPECIAL/40
  Thunder Shock/ELECTRIC/SPECIAL/56  →  Electro Ball/ELECTRIC/SPECIAL/56
  Super Sonic/NORMAL/PHYSICAL/56  →  Gyro Ball/STEEL/PHYSICAL/56
  Sonicboom/ELECTRIC/PHYSICAL/56  →  Spark/ELECTRIC/PHYSICAL/65
  Spark/ELECTRIC/PHYSICAL/96  →  Flash Cannon/STEEL/SPECIAL/80

### 82 Magneton
  Iron Spiner/ELECTRIC/PHYSICAL/56  →  Thunder Shock/ELECTRIC/SPECIAL/40
  Gravity/PSYCHIC/PHYSICAL/56  →  Electro Ball/ELECTRIC/SPECIAL/56
  Thunder Shock/ELECTRIC/SPECIAL/56  →  Gyro Ball/STEEL/PHYSICAL/56
  Scrap Throw/ELECTRIC/PHYSICAL/96  →  Spark/ELECTRIC/PHYSICAL/65
  Tri-Attack/ELECTRIC/PHYSICAL/120  →  Flash Cannon/STEEL/SPECIAL/80
  Magnet Pull/ELECTRIC/PHYSICAL/160  →  Discharge/ELECTRIC/SPECIAL/80
  Gyro Ball/ELECTRIC/SPECIAL/200  →  Zap Cannon/ELECTRIC/SPECIAL/120
  Heavy Metal/ELECTRIC/PHYSICAL/200  →  Charge Beam/ELECTRIC/SPECIAL/50

### 83 Farfetchd
  Tackle/NORMAL/PHYSICAL/56  →  Peck/FLYING/PHYSICAL/35
  Poison Jab/POISON/PHYSICAL/56  →  Cut/NORMAL/PHYSICAL/50
  Sand-Attack/GROUND/STATUS/0  →  Aerial Ace/FLYING/PHYSICAL/20
  Fury Attack/NORMAL/PHYSICAL/15  →  Air Cutter/FLYING/SPECIAL/60
  Aerial Ace/FLYING/PHYSICAL/56  →  False Swipe/NORMAL/PHYSICAL/40
  Wing Attack/FLYING/PHYSICAL/120  →  Slash/NORMAL/PHYSICAL/70
  Roost/FLYING/PHYSICAL/160  →  Air Slash/FLYING/SPECIAL/75
  Slash/NORMAL/PHYSICAL/72  →  Brave Bird/FLYING/PHYSICAL/120
  Air Cutter/FLYING/PHYSICAL/56  →  Gust/FLYING/SPECIAL/40
  Acrobatics/FLYING/PHYSICAL/55  →  Quick Attack/NORMAL/PHYSICAL/40
  Air Slash/FLYING/PHYSICAL/96  →  Swift/NORMAL/SPECIAL/96
  Agility/PSYCHIC/PHYSICAL/10  →  Body Slam/NORMAL/PHYSICAL/85
  Mirror Move/FLYING/STATUS/0  →  Fly/FLYING/PHYSICAL/90
  Brave Bird/FLYING/PHYSICAL/120  →  Facade/NORMAL/PHYSICAL/70
  Swords Dance/BUG/PHYSICAL/56  →  Dual Wingbeat/FLYING/PHYSICAL/40

### 84 Doduo
  Agility/PSYCHIC/PHYSICAL/10  →  Peck/FLYING/PHYSICAL/35
  Drill Peck/FLYING/PHYSICAL/56  →  Quick Attack/NORMAL/PHYSICAL/40
  Peck/FLYING/PHYSICAL/56  →  Fury Attack/NORMAL/PHYSICAL/15
  Rage/NORMAL/PHYSICAL/56  →  Pluck/FLYING/PHYSICAL/60
  Sand Attack/GROUND/PHYSICAL/56  →  Double Hit/NORMAL/PHYSICAL/35

### 85 Dodrio
  Agility/PSYCHIC/PHYSICAL/10  →  Peck/FLYING/PHYSICAL/35
  Drill Peck/FLYING/PHYSICAL/56  →  Quick Attack/NORMAL/PHYSICAL/40
  Peck/FLYING/PHYSICAL/56  →  Fury Attack/NORMAL/PHYSICAL/15
  Rage/NORMAL/PHYSICAL/56  →  Pluck/FLYING/PHYSICAL/60
  Sand Attack/GROUND/PHYSICAL/56  →  Double Hit/NORMAL/PHYSICAL/35
  Pluck/FLYING/PHYSICAL/96  →  Uproar/NORMAL/SPECIAL/90
  Roost/FLYING/PHYSICAL/160  →  Drill Peck/FLYING/PHYSICAL/80
  Tri-Attack/ELECTRIC/PHYSICAL/120  →  Endeavor/NORMAL/PHYSICAL/120
  Aerial Ace/FLYING/PHYSICAL/56  →  Thrash/NORMAL/PHYSICAL/120

### 86 Seel
  Aurora Beam/WATER/SPECIAL/56  →  Aqua Jet/WATER/PHYSICAL/40
  Icy Wind/ICE/PHYSICAL/56  →  Brine/WATER/SPECIAL/65
  Aqua Tail/WATER/PHYSICAL/64  →  Dive/WATER/PHYSICAL/80
  Headbutt/NORMAL/PHYSICAL/80  →  Aqua Tail/WATER/PHYSICAL/90
  Ice Beam/ICE/SPECIAL/96  →  Water Pulse/WATER/SPECIAL/60
  Ice Shard/ICE/PHYSICAL/120  →  Chilling Water/WATER/SPECIAL/50

### 87 Dewgong
  Aurora Beam/WATER/SPECIAL/56  →  Icy Wind/ICE/SPECIAL/55
  Icy Wind/ICE/PHYSICAL/56  →  Ice Shard/ICE/PHYSICAL/40
  Safeguard/NORMAL/PHYSICAL/56  →  Aurora Beam/ICE/SPECIAL/65
  Ice Shards/ICE/PHYSICAL/56  →  Aqua Jet/WATER/PHYSICAL/40
  Aqua Tail/WATER/PHYSICAL/64  →  Brine/WATER/SPECIAL/65
  Headbutt/NORMAL/PHYSICAL/80  →  Dive/WATER/PHYSICAL/80
  Ice Beam/ICE/SPECIAL/96  →  Aqua Tail/WATER/PHYSICAL/90
  Brine/WATER/PHYSICAL/120  →  Ice Beam/ICE/SPECIAL/90
  Rest/PSYCHIC/PHYSICAL/160  →  Water Pulse/WATER/SPECIAL/60
  Blizzard/ICE/PHYSICAL/200  →  Chilling Water/WATER/SPECIAL/50

### 88 Grimer
  Acid/POISON/SPECIAL/56  →  Sludge/POISON/SPECIAL/65
  Harden/NORMAL/PHYSICAL/10  →  Sludge Bomb/POISON/SPECIAL/90
  Mud Bomb/GROUND/SPECIAL/56  →  Sludge Wave/POISON/SPECIAL/95
  Sludge/POISON/SPECIAL/56  →  Gunk Shot/POISON/PHYSICAL/120
  Poison Bomb/GRASS/SPECIAL/56  →  Belch/POISON/SPECIAL/120
  Mud Shot/GROUND/PHYSICAL/72  →  Acid Spray/POISON/SPECIAL/40

### 89 Muk
  Acid/POISON/SPECIAL/56  →  Sludge/POISON/SPECIAL/65
  Harden/NORMAL/PHYSICAL/10  →  Sludge Bomb/POISON/SPECIAL/90
  Sludge/POISON/SPECIAL/56  →  Sludge Wave/POISON/SPECIAL/95
  Mud Shot/GROUND/PHYSICAL/72  →  Gunk Shot/POISON/PHYSICAL/120
  Sludge Bomb/POISON/SPECIAL/104  →  Belch/POISON/SPECIAL/120
  Toxic/POISON/PHYSICAL/120  →  Acid Spray/POISON/SPECIAL/40
  Mortal Gas/POISON/PHYSICAL/120  →  Venoshock/POISON/SPECIAL/65
  Swamp Mist/POISON/PHYSICAL/200  →  Poison Jab/POISON/PHYSICAL/80
  Poison Touch/POISON/PHYSICAL/200  →  Mud-Slap/GROUND/SPECIAL/20

### 90 Shellder
  Clamp/WATER/PHYSICAL/56  →  Water Gun/WATER/SPECIAL/40
  Harden/NORMAL/PHYSICAL/10  →  Whirlpool/WATER/SPECIAL/35
  Lick/GHOST/PHYSICAL/56  →  Razor Shell/WATER/PHYSICAL/75
  Bubbles/WATER/SPECIAL/56  →  Hydro Pump/WATER/SPECIAL/110
  Super Sonic/NORMAL/PHYSICAL/56  →  Water Pulse/WATER/SPECIAL/60
  Ice Beam/ICE/SPECIAL/96  →  Chilling Water/WATER/SPECIAL/50

### 91 Cloyster
  Aurora Beam/WATER/SPECIAL/56  →  Aurora Beam/ICE/SPECIAL/65
  Clamp/WATER/PHYSICAL/56  →  Hydro Pump/WATER/SPECIAL/110
  Harden/NORMAL/PHYSICAL/10  →  Ice Beam/ICE/SPECIAL/90
  Lick/GHOST/PHYSICAL/56  →  Ice Shard/ICE/PHYSICAL/40
  Bubbles/WATER/SPECIAL/56  →  Icicle Crash/ICE/PHYSICAL/85
  Super Sonic/NORMAL/PHYSICAL/56  →  Water Gun/WATER/SPECIAL/40
  Ice Beam/ICE/SPECIAL/96  →  Whirlpool/WATER/SPECIAL/35
  Blizzard/ICE/PHYSICAL/200  →  Razor Shell/WATER/PHYSICAL/75

### 92 Gastly
  Hypnosis/PSYCHIC/PHYSICAL/56  →  Lick/GHOST/PHYSICAL/30
  Lick/GHOST/PHYSICAL/56  →  Hex/GHOST/SPECIAL/65
  Night Shade/GHOST/PHYSICAL/56  →  Night Shade/GHOST/SPECIAL/56
  Shadow Ball/GHOST/SPECIAL/56  →  Shadow Ball/GHOST/SPECIAL/80
  Fear/GHOST/PHYSICAL/56  →  Shadow Sneak/GHOST/PHYSICAL/40
  Invisible/GHOST/PHYSICAL/56  →  Sludge Bomb/POISON/SPECIAL/90

### 93 Haunter
  Hypnosis/PSYCHIC/PHYSICAL/56  →  Lick/GHOST/PHYSICAL/30
  Lick/GHOST/PHYSICAL/56  →  Hex/GHOST/SPECIAL/65
  Night Shade/GHOST/PHYSICAL/56  →  Night Shade/GHOST/SPECIAL/56
  Nightmare/GHOST/PHYSICAL/56  →  Shadow Ball/GHOST/SPECIAL/80
  Shadow Ball/GHOST/SPECIAL/56  →  Shadow Sneak/GHOST/PHYSICAL/40
  Fear/GHOST/PHYSICAL/56  →  Shadow Claw/GHOST/PHYSICAL/70
  Invisible/GHOST/PHYSICAL/56  →  Sludge Wave/POISON/SPECIAL/95
  Dark Accurate/DARK/PHYSICAL/56  →  Phantom Force/GHOST/PHYSICAL/90
  Shadow Storm/GHOST/SPECIAL/200  →  Sludge Bomb/POISON/SPECIAL/90

### 94 Gengar
  Hypnosis/PSYCHIC/PHYSICAL/56  →  Lick/GHOST/PHYSICAL/30
  Nightmare/GHOST/PHYSICAL/56  →  Shadow Punch/GHOST/PHYSICAL/1
  Shadow Ball/GHOST/SPECIAL/56  →  Hex/GHOST/SPECIAL/65
  Shadow Punch/GHOST/PHYSICAL/56  →  Night Shade/GHOST/SPECIAL/56
  Dark Accurate/DARK/PHYSICAL/56  →  Shadow Ball/GHOST/SPECIAL/80
  Creepy Lick/GHOST/PHYSICAL/56  →  Shadow Sneak/GHOST/PHYSICAL/40
  Vanish/GHOST/PHYSICAL/56  →  Shadow Claw/GHOST/PHYSICAL/70
  Astonish/GHOST/PHYSICAL/136  →  Sludge Wave/POISON/SPECIAL/95
  Shadow Claw/GHOST/PHYSICAL/144  →  Phantom Force/GHOST/PHYSICAL/90
  Shadow Storm/GHOST/SPECIAL/200  →  Sludge Bomb/POISON/SPECIAL/90

### 95 Onix
  Tackle/NORMAL/PHYSICAL/56  →  Rock Throw/ROCK/PHYSICAL/50
  Rock Throw/ROCK/PHYSICAL/96  →  Rock Slide/ROCK/PHYSICAL/75
  Slam/NORMAL/PHYSICAL/56  →  Sand Tomb/GROUND/PHYSICAL/35
  Rage/NORMAL/PHYSICAL/56  →  Dig/GROUND/PHYSICAL/80
  Rock Blast/ROCK/SPECIAL/120  →  Stone Edge/ROCK/PHYSICAL/100
  Harden/NORMAL/PHYSICAL/10  →  Head Smash/ROCK/PHYSICAL/150
  Smack Down/ROCK/PHYSICAL/56  →  Rollout/ROCK/PHYSICAL/30
  Stealth Rock/ROCK/STATUS/100  →  Bulldoze/GROUND/PHYSICAL/60
  Iron Tail/STEEL/PHYSICAL/56  →  High Horsepower/GROUND/PHYSICAL/95
  Sand Tomb/GROUND/PHYSICAL/120  →  Rock Tomb/ROCK/PHYSICAL/60
  Earthquake/GROUND/PHYSICAL/56  →  Earthquake/GROUND/PHYSICAL/100

### 96 Drowzee
  Dream Eater/PSYCHIC/PHYSICAL/56  →  Confusion/PSYCHIC/SPECIAL/50
  Hypnosis/PSYCHIC/PHYSICAL/56  →  Psybeam/PSYCHIC/SPECIAL/65
  Psybeam/PSYCHIC/SPECIAL/56  →  Zen Headbutt/PSYCHIC/PHYSICAL/80
  Confusion/PSYCHIC/SPECIAL/80  →  Psychic/PSYCHIC/SPECIAL/90
  Headbutt/NORMAL/PHYSICAL/80  →  Psyshock/PSYCHIC/SPECIAL/80
  Nasty Plot/DARK/PHYSICAL/120  →  Future Sight/PSYCHIC/SPECIAL/120
  Psywave/PSYCHIC/SPECIAL/56  →  Stored Power/PSYCHIC/SPECIAL/20

### 97 Hypno
  Dream Eater/PSYCHIC/PHYSICAL/56  →  Confusion/PSYCHIC/SPECIAL/50
  Hypnosis/PSYCHIC/PHYSICAL/56  →  Psybeam/PSYCHIC/SPECIAL/65
  Miracle Eye/PSYCHIC/PHYSICAL/10  →  Zen Headbutt/PSYCHIC/PHYSICAL/80
  Psybeam/PSYCHIC/SPECIAL/56  →  Psychic/PSYCHIC/SPECIAL/90
  Psywave/PSYCHIC/SPECIAL/56  →  Psyshock/PSYCHIC/SPECIAL/80
  Synchronoise/PSYCHIC/PHYSICAL/56  →  Future Sight/PSYCHIC/SPECIAL/120
  Confusion/PSYCHIC/SPECIAL/80  →  Stored Power/PSYCHIC/SPECIAL/20
  Psy Pulse/PSYCHIC/SPECIAL/96  →  Expanding Force/PSYCHIC/SPECIAL/80
  Nasty Plot/DARK/PHYSICAL/120  →  Psychic Noise/PSYCHIC/SPECIAL/75
  Psychic/PSYCHIC/SPECIAL/96  →  Pound/NORMAL/PHYSICAL/40

### 98 Krabby
  Harden/NORMAL/PHYSICAL/10  →  Water Gun/WATER/SPECIAL/40
  Bubbles/WATER/SPECIAL/56  →  Bubble Beam/WATER/SPECIAL/65
  Mud Shot/GROUND/PHYSICAL/72  →  Razor Shell/WATER/PHYSICAL/75
  Bubble Beam/WATER/SPECIAL/80  →  Crabhammer/WATER/PHYSICAL/100
  Crabhammer/WATER/PHYSICAL/96  →  Water Pulse/WATER/SPECIAL/60

### 99 Kingler
  Guillotine/NORMAL/PHYSICAL/56  →  Water Gun/WATER/SPECIAL/40
  Harden/NORMAL/PHYSICAL/10  →  Bubble Beam/WATER/SPECIAL/65
  Metal Claw/STEEL/PHYSICAL/56  →  Razor Shell/WATER/PHYSICAL/75
  Bubbles/WATER/SPECIAL/56  →  Crabhammer/WATER/PHYSICAL/100
  Mud Shot/GROUND/PHYSICAL/72  →  Water Pulse/WATER/SPECIAL/60
  Bubble Beam/WATER/SPECIAL/80  →  Scald/WATER/SPECIAL/80
  Crabhammer/WATER/PHYSICAL/96  →  Brine/WATER/SPECIAL/65
  Brine/WATER/PHYSICAL/120  →  Surf/WATER/SPECIAL/90
  Hyper Beam/NORMAL/SPECIAL/120  →  Hammer Arm/FIGHTING/PHYSICAL/100

### 100 Voltorb
  Thunder Shock/ELECTRIC/SPECIAL/56  →  Thunder Shock/ELECTRIC/SPECIAL/40
  Selfdestruction/NORMAL/PHYSICAL/56  →  Spark/ELECTRIC/PHYSICAL/65
  Rollout/ROCK/PHYSICAL/96  →  Charge Beam/ELECTRIC/SPECIAL/50
  Spark/ELECTRIC/PHYSICAL/96  →  Electro Ball/ELECTRIC/SPECIAL/96
  Thunder Wave/ELECTRIC/SPECIAL/120  →  Discharge/ELECTRIC/SPECIAL/80

### 101 Electrode
  Charge Beam/ELECTRIC/SPECIAL/56  →  Thunder Shock/ELECTRIC/SPECIAL/40
  Thunder Shock/ELECTRIC/SPECIAL/56  →  Spark/ELECTRIC/PHYSICAL/65
  Selfdestruction/NORMAL/PHYSICAL/56  →  Charge Beam/ELECTRIC/SPECIAL/50
  Rollout/ROCK/PHYSICAL/96  →  Electro Ball/ELECTRIC/SPECIAL/96
  Spark/ELECTRIC/PHYSICAL/96  →  Discharge/ELECTRIC/SPECIAL/80
  Thunder Wave/ELECTRIC/SPECIAL/120  →  Volt Switch/ELECTRIC/SPECIAL/70
  Electric Storm/ELECTRIC/SPECIAL/200  →  Thunderbolt/ELECTRIC/SPECIAL/90

### 102 Exeggcute
  Egg Bomb/NORMAL/SPECIAL/56  →  Absorb/GRASS/SPECIAL/20
  Hypnosis/PSYCHIC/PHYSICAL/56  →  Mega Drain/GRASS/SPECIAL/40
  Confusion/PSYCHIC/SPECIAL/80  →  Confusion/PSYCHIC/SPECIAL/50
  Leech Seed/GRASS/SPECIAL/120  →  Bullet Seed/GRASS/PHYSICAL/25

### 103 Exeggutor
  Egg Bomb/NORMAL/SPECIAL/56  →  Absorb/GRASS/SPECIAL/20
  Hypnosis/PSYCHIC/PHYSICAL/56  →  Bullet Seed/GRASS/PHYSICAL/25
  Seed Bomb/GRASS/SPECIAL/56  →  Confusion/PSYCHIC/SPECIAL/50
  Wood Hammer/GRASS/PHYSICAL/56  →  Extrasensory/PSYCHIC/SPECIAL/80
  Confusion/PSYCHIC/SPECIAL/80  →  Giga Drain/GRASS/SPECIAL/75
  Leaf Blade/GRASS/PHYSICAL/80  →  Leaf Storm/GRASS/SPECIAL/130
  Psyshock/PSYCHIC/SPECIAL/144  →  Mega Drain/GRASS/SPECIAL/40
  Solar Beam/GRASS/SPECIAL/120  →  Psyshock/PSYCHIC/SPECIAL/80
  Leaf Storm/GRASS/SPECIAL/160  →  Seed Bomb/GRASS/PHYSICAL/80

### 104 Cubone
  Bone Rush/GROUND/PHYSICAL/56  →  Mud-Slap/GROUND/SPECIAL/20
  Bonemerang/GROUND/PHYSICAL/56  →  Stomping Tantrum/GROUND/PHYSICAL/75
  Rage/NORMAL/PHYSICAL/56  →  Bone Rush/GROUND/PHYSICAL/25
  Bone club/GROUND/PHYSICAL/56  →  Bonemerang/GROUND/PHYSICAL/50
  Headbutt/NORMAL/PHYSICAL/80  →  Bulldoze/GROUND/PHYSICAL/60

### 105 Marowak
  Bone Rush/GROUND/PHYSICAL/56  →  Mud-Slap/GROUND/SPECIAL/20
  Bonemerang/GROUND/PHYSICAL/56  →  Stomping Tantrum/GROUND/PHYSICAL/75
  Rage/NORMAL/PHYSICAL/56  →  Bone Rush/GROUND/PHYSICAL/25
  Smack Down/ROCK/PHYSICAL/56  →  Bonemerang/GROUND/PHYSICAL/50
  Bone club/GROUND/PHYSICAL/56  →  Bulldoze/GROUND/PHYSICAL/60
  Mud Shot/GROUND/PHYSICAL/72  →  Dig/GROUND/PHYSICAL/80
  Headbutt/NORMAL/PHYSICAL/80  →  Earth Power/GROUND/SPECIAL/90
  Earth Power/GROUND/PHYSICAL/120  →  Earthquake/GROUND/PHYSICAL/100
  Bulldoze/GROUND/PHYSICAL/200  →  Scorching Sands/GROUND/SPECIAL/70

### 106 Hitmonlee
  Hi Jump Kick/FIGHTING/PHYSICAL/56  →  Low Sweep/FIGHTING/PHYSICAL/65
  Triple Kick Lee/FIGHTING/PHYSICAL/56  →  Double Kick/FIGHTING/PHYSICAL/30
  Furious Legs/FIGHTING/PHYSICAL/56  →  Low Kick/FIGHTING/PHYSICAL/56
  Mega Kick/NORMAL/PHYSICAL/96  →  Close Combat/FIGHTING/PHYSICAL/120
  + Reversal/FIGHTING/PHYSICAL/70  (slot novo · cd 22000 · lv 12)
  + High Jump Kick/FIGHTING/PHYSICAL/130  (slot novo · cd 26000 · lv 20)
  + Axe Kick/FIGHTING/PHYSICAL/120  (slot novo · cd 30000 · lv 28)
  + Brick Break/FIGHTING/PHYSICAL/75  (slot novo · cd 36000 · lv 36)
  + Aura Sphere/FIGHTING/SPECIAL/70  (slot novo · cd 42000 · lv 44)
  + Focus Blast/FIGHTING/SPECIAL/120  (slot novo · cd 50000 · lv 52)

### 107 Hitmonchan
  Focus Punch/FIGHTING/PHYSICAL/56  →  Mach Punch/FIGHTING/PHYSICAL/40
  Triple Punch/FIGHTING/PHYSICAL/56  →  Vacuum Wave/FIGHTING/SPECIAL/40
  Ultimate Champion/FIGHTING/PHYSICAL/56  →  Close Combat/FIGHTING/PHYSICAL/120
  Elemental Hands/FIGHTING/PHYSICAL/56  →  Counter/FIGHTING/PHYSICAL/56
  Mega Punch/NORMAL/PHYSICAL/96  →  Focus Punch/FIGHTING/PHYSICAL/150
  Detect/FIGHTING/STATUS/0  →  Low Kick/FIGHTING/PHYSICAL/70
  Revenge/BUG/PHYSICAL/56  →  Low Sweep/FIGHTING/PHYSICAL/65
  + Brick Break/FIGHTING/PHYSICAL/75  (slot novo · cd 36000 · lv 36)
  + Drain Punch/FIGHTING/PHYSICAL/75  (slot novo · cd 42000 · lv 44)
  + Aura Sphere/FIGHTING/SPECIAL/70  (slot novo · cd 50000 · lv 52)

### 108 Lickitung
  Defense Curl/NORMAL/PHYSICAL/10  →  Tackle/NORMAL/PHYSICAL/40
  Iron Tail/STEEL/PHYSICAL/56  →  Double-Edge/NORMAL/PHYSICAL/120
  Lick/GHOST/PHYSICAL/56  →  Giga Impact/NORMAL/PHYSICAL/150
  Shadow Ball/GHOST/SPECIAL/56  →  Hyper Beam/NORMAL/SPECIAL/150
  Slam/NORMAL/PHYSICAL/56  →  Bulldoze/GROUND/PHYSICAL/60
  Super Sonic/NORMAL/PHYSICAL/56  →  Zen Headbutt/PSYCHIC/PHYSICAL/80
  Squishy Licking/NORMAL/PHYSICAL/56  →  Rollout/ROCK/PHYSICAL/30
  Body Slam/NORMAL/PHYSICAL/72  →  Aqua Tail/WATER/PHYSICAL/90
  Mega Punch/NORMAL/PHYSICAL/96  →  Fire Punch/FIRE/PHYSICAL/75

### 109 Koffing
  Acid/POISON/SPECIAL/56  →  Smog/POISON/SPECIAL/30
  Mud Bomb/GROUND/SPECIAL/56  →  Clear Smog/POISON/SPECIAL/50
  Poison Bomb/GRASS/SPECIAL/56  →  Sludge/POISON/SPECIAL/65
  Selfdestruction/NORMAL/PHYSICAL/56  →  Sludge Bomb/POISON/SPECIAL/90
  Mud Shot/GROUND/PHYSICAL/72  →  Belch/POISON/SPECIAL/120
  Headbutt/NORMAL/PHYSICAL/80  →  Acid Spray/POISON/SPECIAL/40
  Poison Gas/POISON/PHYSICAL/96  →  Venoshock/POISON/SPECIAL/65

### 110 Weezing
  Acid/POISON/SPECIAL/56  →  Smog/POISON/SPECIAL/30
  Mud Bomb/GROUND/SPECIAL/56  →  Clear Smog/POISON/SPECIAL/50
  Poison Bomb/GRASS/SPECIAL/56  →  Sludge/POISON/SPECIAL/65
  Selfdestruction/NORMAL/PHYSICAL/56  →  Sludge Bomb/POISON/SPECIAL/90
  Mud Shot/GROUND/PHYSICAL/72  →  Belch/POISON/SPECIAL/120
  Headbutt/NORMAL/PHYSICAL/80  →  Acid Spray/POISON/SPECIAL/40
  Poison Gas/POISON/PHYSICAL/96  →  Venoshock/POISON/SPECIAL/65
  Mortal Gas/POISON/PHYSICAL/120  →  Gunk Shot/POISON/PHYSICAL/120

### 111 Rhyhorn
  Dig/GROUND/PHYSICAL/40  →  Smack Down/ROCK/PHYSICAL/50
  Drill Run/GROUND/PHYSICAL/56  →  Bulldoze/GROUND/PHYSICAL/60
  Stone Edge/ROCK/PHYSICAL/56  →  Rock Blast/ROCK/PHYSICAL/25
  Horn Attack/NORMAL/PHYSICAL/96  →  Drill Run/GROUND/PHYSICAL/80
  Rock Throw/ROCK/PHYSICAL/96  →  Earthquake/GROUND/PHYSICAL/100
  Bulldoze/GROUND/PHYSICAL/200  →  Stone Edge/ROCK/PHYSICAL/100

### 112 Rhydon
  Scary Face/NORMAL/PHYSICAL/10  →  Bulldoze/GROUND/PHYSICAL/60
  Smack Down/ROCK/PHYSICAL/56  →  Smack Down/ROCK/PHYSICAL/50
  Horn Attack/NORMAL/PHYSICAL/96  →  Rock Blast/ROCK/PHYSICAL/25
  Horn Drill/NORMAL/PHYSICAL/96  →  Drill Run/GROUND/PHYSICAL/80
  Earth Power/GROUND/PHYSICAL/120  →  Earthquake/GROUND/PHYSICAL/100
  Horn Burst/NORMAL/SPECIAL/120  →  Stone Edge/ROCK/PHYSICAL/100
  Bulldoze/GROUND/PHYSICAL/200  →  Mud-Slap/GROUND/SPECIAL/20
  Ground Collapse/GROUND/PHYSICAL/56  →  Mud Shot/GROUND/SPECIAL/55
  Fissure/GROUND/PHYSICAL/120  →  Rock Tomb/ROCK/PHYSICAL/60

### 113 Chansey
  Captivate/NORMAL/PHYSICAL/56  →  Covet/NORMAL/PHYSICAL/60
  Egg Bomb/NORMAL/SPECIAL/56  →  Pound/NORMAL/PHYSICAL/40
  Healing Wish/NORMAL/PHYSICAL/56  →  Echoed Voice/NORMAL/SPECIAL/40
  Protection/NORMAL/PHYSICAL/10  →  Take Down/NORMAL/PHYSICAL/90
  Egg Rain/NORMAL/PHYSICAL/56  →  Double-Edge/NORMAL/PHYSICAL/120
  Doubleslap/NORMAL/PHYSICAL/80  →  Last Resort/NORMAL/PHYSICAL/140
  Great Love/FAIRY/PHYSICAL/120  →  Facade/NORMAL/PHYSICAL/70

### 114 Tangela
  Absorb/GRASS/PHYSICAL/56  →  Absorb/GRASS/SPECIAL/20
  Poison Powder/POISON/SPECIAL/56  →  Energy Ball/GRASS/SPECIAL/90
  Power Whip/GRASS/PHYSICAL/56  →  Acid Spray/POISON/SPECIAL/40
  Sleep Powder/GRASS/SPECIAL/56  →  Double Hit/NORMAL/PHYSICAL/35
  Stun Spore/GRASS/SPECIAL/56  →  Ancient Power/ROCK/SPECIAL/60
  Vine Whip/GRASS/SPECIAL/72  →  Giga Impact/NORMAL/PHYSICAL/150
  Leech Seed/GRASS/SPECIAL/120  →  Hyper Beam/NORMAL/SPECIAL/150

### 115 Kangaskhan
  Dizzy Punch/NORMAL/PHYSICAL/56  →  Pound/NORMAL/PHYSICAL/40
  Rage/NORMAL/PHYSICAL/56  →  Fake Out/NORMAL/PHYSICAL/40
  Bite/DARK/PHYSICAL/72  →  Stomp/NORMAL/PHYSICAL/65
  Crunch/DARK/PHYSICAL/72  →  Headbutt/NORMAL/PHYSICAL/70
  Headbutt/NORMAL/PHYSICAL/80  →  Double Hit/NORMAL/PHYSICAL/35
  Mega Punch/NORMAL/PHYSICAL/96  →  Last Resort/NORMAL/PHYSICAL/140
  Sucker Punch/DARK/PHYSICAL/120  →  Tackle/NORMAL/PHYSICAL/40
  Comet Punch/NORMAL/PHYSICAL/160  →  Take Down/NORMAL/PHYSICAL/90
  Epicenter/NORMAL/PHYSICAL/200  →  Body Slam/NORMAL/PHYSICAL/85

### 116 Horsea
  Bubbles/WATER/SPECIAL/56  →  Water Gun/WATER/SPECIAL/40
  Water Gun/WATER/PHYSICAL/64  →  Bubble Beam/WATER/SPECIAL/65
  Water Ball/WATER/SPECIAL/64  →  Water Pulse/WATER/SPECIAL/60
  Mud Shot/GROUND/PHYSICAL/72  →  Hydro Pump/WATER/SPECIAL/110
  Bubble Beam/WATER/SPECIAL/80  →  Chilling Water/WATER/SPECIAL/50

### 117 Seadra
  Dragon Pulse/DRAGON/SPECIAL/56  →  Water Gun/WATER/SPECIAL/40
  Bubbles/WATER/SPECIAL/56  →  Bubble Beam/WATER/SPECIAL/65
  Smokescreen/NORMAL/PHYSICAL/56  →  Water Pulse/WATER/SPECIAL/60
  Water Gun/WATER/PHYSICAL/64  →  Hydro Pump/WATER/SPECIAL/110
  Mud Shot/GROUND/PHYSICAL/72  →  Chilling Water/WATER/SPECIAL/50
  Water Pulse/WATER/SPECIAL/120  →  Waterfall/WATER/PHYSICAL/80
  Bubble Beam/WATER/SPECIAL/80  →  Liquidation/WATER/PHYSICAL/85
  Hydro Cannon/WATER/SPECIAL/120  →  Surf/WATER/SPECIAL/90

### 118 Goldeen
  Poison Sting/POISON/PHYSICAL/56  →  Water Pulse/WATER/SPECIAL/60
  Super Sonic/NORMAL/PHYSICAL/56  →  Waterfall/WATER/PHYSICAL/80
  Aqua Tail/WATER/PHYSICAL/64  →  Scald/WATER/SPECIAL/80
  Water Gun/WATER/PHYSICAL/64  →  Surf/WATER/SPECIAL/90
  Water Pulse/WATER/SPECIAL/120  →  Peck/FLYING/PHYSICAL/35
  Horn Attack/NORMAL/PHYSICAL/96  →  Horn Attack/NORMAL/PHYSICAL/65

### 119 Seaking
  Horn Drill/NORMAL/PHYSICAL/96  →  Water Pulse/WATER/SPECIAL/60
  Super Sonic/NORMAL/PHYSICAL/56  →  Waterfall/WATER/PHYSICAL/80
  Aqua Tail/WATER/PHYSICAL/64  →  Scald/WATER/SPECIAL/80
  Water Gun/WATER/PHYSICAL/64  →  Surf/WATER/SPECIAL/90
  Water Pulse/WATER/SPECIAL/120  →  Peck/FLYING/PHYSICAL/35
  Horn Attack/NORMAL/PHYSICAL/96  →  Horn Attack/NORMAL/PHYSICAL/65
  Aqua Ring/WATER/PHYSICAL/160  →  Flail/NORMAL/PHYSICAL/120
  Waterfall/WATER/PHYSICAL/160  →  Megahorn/BUG/PHYSICAL/120

### 120 Staryu
  Harden/NORMAL/PHYSICAL/10  →  Water Gun/WATER/SPECIAL/40
  Swift/NORMAL/PHYSICAL/72  →  Brine/WATER/SPECIAL/65
  Water Gun/WATER/PHYSICAL/64  →  Surf/WATER/SPECIAL/90
  Bubble Beam/WATER/SPECIAL/80  →  Hydro Pump/WATER/SPECIAL/110
  Psychic/PSYCHIC/SPECIAL/96  →  Aqua Jet/WATER/PHYSICAL/40
  Psyshock/PSYCHIC/SPECIAL/144  →  Bubble Beam/WATER/SPECIAL/65
  Recover/NORMAL/PHYSICAL/160  →  Flip Turn/WATER/PHYSICAL/60

### 121 Starmie
  Swift/NORMAL/PHYSICAL/72  →  Brine/WATER/SPECIAL/65
  Psy Ball/PSYCHIC/SPECIAL/56  →  Hydro Pump/WATER/SPECIAL/110
  Thunderbolt/ELECTRIC/SPECIAL/72  →  Psybeam/PSYCHIC/SPECIAL/65
  Bubble Beam/WATER/SPECIAL/80  →  Psychic/PSYCHIC/SPECIAL/90
  Psychic/PSYCHIC/SPECIAL/96  →  Surf/WATER/SPECIAL/90
  Psyshock/PSYCHIC/SPECIAL/144  →  Water Gun/WATER/SPECIAL/40
  Rapid Spin/NORMAL/PHYSICAL/120  →  Aqua Jet/WATER/PHYSICAL/40
  Hydro Pump/WATER/SPECIAL/136  →  Bubble Beam/WATER/SPECIAL/65
  Recover/NORMAL/PHYSICAL/160  →  Liquidation/WATER/PHYSICAL/85

### 122 Mr. Mime
  Tackle/NORMAL/PHYSICAL/56  →  Confusion/PSYCHIC/SPECIAL/50
  Magical Leaf/GRASS/PHYSICAL/96  →  Dream Eater/PSYCHIC/SPECIAL/100
  Psybeam/PSYCHIC/SPECIAL/56  →  Psybeam/PSYCHIC/SPECIAL/65
  Confusion/PSYCHIC/SPECIAL/80  →  Dazzling Gleam/FAIRY/SPECIAL/80
  Barrier/PSYCHIC/STATUS/0  →  Psychic/PSYCHIC/SPECIAL/90
  Dazzling Gleam/FAIRY/PHYSICAL/56  →  Zen Headbutt/PSYCHIC/PHYSICAL/80
  Psychic/PSYCHIC/SPECIAL/96  →  Psyshock/PSYCHIC/SPECIAL/80
  Mimic/NORMAL/STATUS/0  →  Play Rough/FAIRY/PHYSICAL/90
  Reflect/PSYCHIC/PHYSICAL/10  →  Future Sight/PSYCHIC/SPECIAL/120
  Psyshock/PSYCHIC/SPECIAL/144  →  Tackle/NORMAL/PHYSICAL/40
  Substitute/NORMAL/STATUS/0  →  Infestation/BUG/SPECIAL/20
  Future Sight/PSYCHIC/PHYSICAL/56  →  Mystical Fire/FIRE/SPECIAL/75
  Safeguard/NORMAL/PHYSICAL/56  →  Headbutt/NORMAL/PHYSICAL/70
  Psywave/PSYCHIC/SPECIAL/56  →  Brick Break/FIGHTING/PHYSICAL/75

### 123 Scyther
  Agility/PSYCHIC/PHYSICAL/10  →  Fury Cutter/BUG/PHYSICAL/40
  Fury Cutter/BUG/PHYSICAL/56  →  Wing Attack/FLYING/PHYSICAL/60
  Quick Attack/NORMAL/PHYSICAL/56  →  Air Slash/FLYING/SPECIAL/75
  Quick Guard/BUG/PHYSICAL/56  →  X-Scissor/BUG/PHYSICAL/80
  Swords Dance/BUG/PHYSICAL/56  →  Bug Buzz/BUG/SPECIAL/90
  Shredder Team/BUG/PHYSICAL/56  →  Lunge/BUG/PHYSICAL/80
  Team Slice/BUG/PHYSICAL/56  →  Aerial Ace/FLYING/PHYSICAL/56
  Air Slash/FLYING/PHYSICAL/96  →  U-turn/BUG/PHYSICAL/70
  Wing Attack/FLYING/PHYSICAL/120  →  Silver Wind/BUG/SPECIAL/60
  X-Scissor/BUG/PHYSICAL/120  →  Dual Wingbeat/FLYING/PHYSICAL/40

### 124 Jynx
  Draining Kiss/FAIRY/PHYSICAL/56  →  Powder Snow/ICE/SPECIAL/40
  Heart Stamp/PSYCHIC/PHYSICAL/56  →  Confusion/PSYCHIC/SPECIAL/50
  Lovely Kiss/NORMAL/PHYSICAL/56  →  Ice Punch/ICE/PHYSICAL/75
  Miracle Eye/PSYCHIC/PHYSICAL/10  →  Psychic/PSYCHIC/SPECIAL/90
  Psywave/PSYCHIC/SPECIAL/56  →  Blizzard/ICE/SPECIAL/110
  Mean Look/NORMAL/PHYSICAL/56  →  Ice Beam/ICE/SPECIAL/90
  Ice Punch/ICE/PHYSICAL/72  →  Avalanche/ICE/PHYSICAL/60
  Ice Beam/ICE/SPECIAL/96  →  Dream Eater/PSYCHIC/SPECIAL/100
  Psychic/PSYCHIC/SPECIAL/96  →  Lick/GHOST/PHYSICAL/30
  Psy Pulse/PSYCHIC/SPECIAL/96  →  Pound/NORMAL/PHYSICAL/40
  Psychock/PSYCHIC/PHYSICAL/96  →  Covet/NORMAL/PHYSICAL/60
  Blizzard/ICE/PHYSICAL/200  →  Focus Punch/FIGHTING/PHYSICAL/150

### 125 Electabuzz
  Swift/NORMAL/PHYSICAL/72  →  Thunder Shock/ELECTRIC/SPECIAL/40
  Thunder Punch/ELECTRIC/SPECIAL/56  →  Shock Wave/ELECTRIC/SPECIAL/16
  Thunder Shock/ELECTRIC/SPECIAL/56  →  Thunder Punch/ELECTRIC/PHYSICAL/75
  Thunder Wrath/ELECTRIC/SPECIAL/200  →  Discharge/ELECTRIC/SPECIAL/80
  Electrify/ELECTRIC/PHYSICAL/56  →  Thunderbolt/ELECTRIC/SPECIAL/90
  Mamaragan/ELECTRIC/PHYSICAL/56  →  Thunder/ELECTRIC/SPECIAL/110
  Vital Spirit/ELECTRIC/PHYSICAL/56  →  Charge Beam/ELECTRIC/SPECIAL/50
  Thunderbolt/ELECTRIC/SPECIAL/72  →  Volt Switch/ELECTRIC/SPECIAL/70
  Flame Charge/FIRE/SPECIAL/96  →  Electro Ball/ELECTRIC/SPECIAL/96

### 126 Magmar
  Clear Smog/POISON/PHYSICAL/56  →  Ember/FIRE/SPECIAL/40
  Fire Punch/FIRE/SPECIAL/56  →  Flame Wheel/FIRE/PHYSICAL/60
  Scratch/NORMAL/PHYSICAL/56  →  Fire Punch/FIRE/PHYSICAL/75
  Smog/POISON/PHYSICAL/56  →  Lava Plume/FIRE/SPECIAL/80
  Sunny Day/FIRE/PHYSICAL/56  →  Flamethrower/FIRE/SPECIAL/90
  Ember/FIRE/SPECIAL/80  →  Fire Blast/FIRE/SPECIAL/110
  Fire Ball/FIRE/SPECIAL/80  →  Fire Spin/FIRE/SPECIAL/35
  Lava Plume/FIRE/PHYSICAL/120  →  Flame Charge/FIRE/PHYSICAL/50
  Hellfire Storm/FIRE/SPECIAL/200  →  Heat Wave/FIRE/SPECIAL/95

### 127 Pinsir
  Brick Break/FIGHTING/PHYSICAL/56  →  Bug Bite/BUG/PHYSICAL/60
  Fury Cutter/BUG/PHYSICAL/56  →  X-Scissor/BUG/PHYSICAL/80
  Guillotine/NORMAL/PHYSICAL/56  →  Lunge/BUG/PHYSICAL/80
  Harden/NORMAL/PHYSICAL/10  →  Vise Grip/NORMAL/PHYSICAL/55
  Revenge/BUG/PHYSICAL/56  →  Bind/NORMAL/PHYSICAL/15
  Swords Dance/BUG/PHYSICAL/56  →  Seismic Toss/FIGHTING/PHYSICAL/56
  Bind/BUG/PHYSICAL/56  →  Storm Throw/FIGHTING/PHYSICAL/60
  Crunch/DARK/PHYSICAL/72  →  Double Hit/NORMAL/PHYSICAL/35
  Focus Blast/FIGHTING/SPECIAL/96  →  Vital Throw/FIGHTING/PHYSICAL/28

### 128 Tauros
  Quick Attack/NORMAL/PHYSICAL/56  →  Tackle/NORMAL/PHYSICAL/40
  Rage/NORMAL/PHYSICAL/56  →  Horn Attack/NORMAL/PHYSICAL/65
  Scary Face/NORMAL/PHYSICAL/10  →  Raging Bull/NORMAL/PHYSICAL/90
  Headbutt/NORMAL/PHYSICAL/80  →  Thrash/NORMAL/PHYSICAL/120
  Horn Attack/NORMAL/PHYSICAL/96  →  Double-Edge/NORMAL/PHYSICAL/120
  Hyper Beam/NORMAL/SPECIAL/120  →  Giga Impact/NORMAL/PHYSICAL/150
  Thrash/NORMAL/PHYSICAL/120  →  Take Down/NORMAL/PHYSICAL/90
  Rest/PSYCHIC/PHYSICAL/160  →  Facade/NORMAL/PHYSICAL/70

### 129 Magikarp
  Splash/NORMAL/PHYSICAL/56  →  Hydro Pump/WATER/SPECIAL/110

### 130 Gyarados
  Splash/NORMAL/PHYSICAL/56  →  Whirlpool/WATER/SPECIAL/35
  Aqua Tail/WATER/PHYSICAL/64  →  Brine/WATER/SPECIAL/65
  Crunch/DARK/PHYSICAL/72  →  Waterfall/WATER/PHYSICAL/80
  Dragon Tail/DRAGON/PHYSICAL/80  →  Aqua Tail/WATER/PHYSICAL/90
  Ice Fang/ICE/PHYSICAL/80  →  Hydro Pump/WATER/SPECIAL/110
  Dragon Breath/DRAGON/SPECIAL/120  →  Hurricane/FLYING/SPECIAL/110
  Hydro Cannon/WATER/SPECIAL/120  →  Bounce/FLYING/PHYSICAL/85
  Hydro Pump/WATER/SPECIAL/136  →  Water Pulse/WATER/SPECIAL/60
  Surf/WATER/SPECIAL/160  →  Surf/WATER/SPECIAL/90

### 131 Lapras
  Sing/NORMAL/PHYSICAL/10  →  Water Gun/WATER/SPECIAL/40
  Ice Shards/ICE/PHYSICAL/56  →  Ice Shard/ICE/PHYSICAL/40
  Ice Wind/ICE/PHYSICAL/56  →  Water Pulse/WATER/SPECIAL/60
  Ice Storm/ICE/SPECIAL/56  →  Brine/WATER/SPECIAL/65
  Body Slam/NORMAL/PHYSICAL/72  →  Ice Beam/ICE/SPECIAL/90
  Ice Beam/ICE/SPECIAL/96  →  Hydro Pump/WATER/SPECIAL/110
  Powder Snow/ICE/SPECIAL/120  →  Sheer Cold/ICE/SPECIAL/120
  Blizzard/ICE/PHYSICAL/200  →  Chilling Water/WATER/SPECIAL/50
  Frost Power/WATER/PHYSICAL/200  →  Icy Wind/ICE/SPECIAL/55

### 133 Eevee
  Iron Tail/STEEL/PHYSICAL/56  →  Covet/NORMAL/PHYSICAL/60
  Quick Attack/NORMAL/PHYSICAL/56  →  Tackle/NORMAL/PHYSICAL/40
  Sand Attack/GROUND/PHYSICAL/56  →  Quick Attack/NORMAL/PHYSICAL/40
  Bite/DARK/PHYSICAL/72  →  Swift/NORMAL/SPECIAL/20
  Headbutt/NORMAL/PHYSICAL/80  →  Take Down/NORMAL/PHYSICAL/90
  Great Love/FAIRY/PHYSICAL/120  →  Double-Edge/NORMAL/PHYSICAL/120

### 134 Vaporeon
  Bubble Beam/WATER/SPECIAL/80  →  Water Pulse/WATER/SPECIAL/60
  Tackle/NORMAL/PHYSICAL/56  →  Muddy Water/WATER/SPECIAL/90
  Water Gun/WATER/PHYSICAL/64  →  Hydro Pump/WATER/SPECIAL/110
  Water Ball/WATER/SPECIAL/64  →  Bubble Beam/WATER/SPECIAL/65
  Water Pulse/WATER/SPECIAL/120  →  Surf/WATER/SPECIAL/90
  Flip Turn/WATER/PHYSICAL/160  →  Flip Turn/WATER/PHYSICAL/60
  Surf/WATER/SPECIAL/160  →  Whirlpool/WATER/SPECIAL/35
  Hydro Pump/WATER/SPECIAL/136  →  Liquidation/WATER/PHYSICAL/85
  + Waterfall/WATER/PHYSICAL/80  (slot novo · cd 42000 · lv 44)
  + Chilling Water/WATER/SPECIAL/50  (slot novo · cd 50000 · lv 52)

### 135 Jolteon
  Agility/PSYCHIC/PHYSICAL/10  →  Thunder Fang/ELECTRIC/PHYSICAL/65
  Charge/ELECTRIC/PHYSICAL/10  →  Discharge/ELECTRIC/SPECIAL/80
  Copycat/NORMAL/PHYSICAL/10  →  Thunder/ELECTRIC/SPECIAL/110
  Light Screen/PSYCHIC/PHYSICAL/10  →  Thunderbolt/ELECTRIC/SPECIAL/90
  Thunderbolt/ELECTRIC/SPECIAL/72  →  Volt Switch/ELECTRIC/SPECIAL/70
  Pin Missile/BUG/PHYSICAL/56  →  Wild Charge/ELECTRIC/PHYSICAL/90
  Baton Pass/NORMAL/PHYSICAL/160  →  Electroweb/ELECTRIC/SPECIAL/55
  Thunder/ELECTRIC/SPECIAL/96  →  Charge Beam/ELECTRIC/SPECIAL/50
  Flame Charge/FIRE/SPECIAL/96  →  Electro Ball/ELECTRIC/SPECIAL/96
  + Bite/DARK/PHYSICAL/60  (slot novo · cd 50000 · lv 52)

### 136 Flareon
  Blaze Kick/FIRE/PHYSICAL/56  →  Fire Fang/FIRE/PHYSICAL/65
  Quick Attack/NORMAL/PHYSICAL/56  →  Fire Spin/FIRE/SPECIAL/35
  Ember/FIRE/SPECIAL/80  →  Lava Plume/FIRE/SPECIAL/80
  Incinerate/FIRE/PHYSICAL/96  →  Flare Blitz/FIRE/PHYSICAL/120
  Flame Circle/FIRE/SPECIAL/96  →  Flame Wheel/FIRE/PHYSICAL/60
  Lava Plume/FIRE/PHYSICAL/120  →  Fire Blast/FIRE/SPECIAL/110
  Burning Jealousy/FIRE/PHYSICAL/200  →  Flamethrower/FIRE/SPECIAL/90
  Hellfire Storm/FIRE/SPECIAL/200  →  Heat Wave/FIRE/SPECIAL/95
  + Flame Charge/FIRE/PHYSICAL/50  (slot novo · cd 42000 · lv 44)
  + Overheat/FIRE/SPECIAL/130  (slot novo · cd 50000 · lv 52)

### 137 Porygon
  Focus Energy/NORMAL/PHYSICAL/10  →  Tackle/NORMAL/PHYSICAL/40
  Magic Coat/NORMAL/PHYSICAL/56  →  Tri Attack/NORMAL/SPECIAL/80
  Psybeam/PSYCHIC/SPECIAL/56  →  Double-Edge/NORMAL/PHYSICAL/120
  Psycho Cut/PSYCHIC/PHYSICAL/200  →  Self-Destruct/NORMAL/PHYSICAL/200
  Super Sonic/NORMAL/PHYSICAL/56  →  Headbutt/NORMAL/PHYSICAL/70
  Psychic/PSYCHIC/SPECIAL/96  →  Swift/NORMAL/SPECIAL/96
  Zap Cannon/ELECTRIC/SPECIAL/120  →  Hyper Beam/NORMAL/SPECIAL/150
  Recover/NORMAL/PHYSICAL/160  →  Giga Impact/NORMAL/PHYSICAL/150

### 138 Omanyte
  Harden/NORMAL/PHYSICAL/10  →  Rollout/ROCK/PHYSICAL/30
  Water Gun/WATER/PHYSICAL/64  →  Water Gun/WATER/SPECIAL/40
  Water Ball/WATER/SPECIAL/64  →  Ancient Power/ROCK/SPECIAL/60
  Bite/DARK/PHYSICAL/72  →  Brine/WATER/SPECIAL/65
  Mud Shot/GROUND/PHYSICAL/72  →  Rock Blast/ROCK/PHYSICAL/25
  Rock Throw/ROCK/PHYSICAL/96  →  Surf/WATER/SPECIAL/90
  Brine/WATER/PHYSICAL/120  →  Hydro Pump/WATER/SPECIAL/110
  Ancient Power/ROCK/PHYSICAL/160  →  Water Pulse/WATER/SPECIAL/60

### 139 Omastar
  Harden/NORMAL/PHYSICAL/10  →  Rollout/ROCK/PHYSICAL/30
  Rain Dance/WATER/PHYSICAL/10  →  Water Gun/WATER/SPECIAL/40
  Rock Throw/ROCK/PHYSICAL/96  →  Ancient Power/ROCK/SPECIAL/60
  Rollout/ROCK/PHYSICAL/96  →  Brine/WATER/SPECIAL/65
  Rock Slide/ROCK/PHYSICAL/120  →  Rock Blast/ROCK/PHYSICAL/25
  Ancient Power/ROCK/PHYSICAL/160  →  Surf/WATER/SPECIAL/90
  Rock Wrecker/ROCK/PHYSICAL/200  →  Hydro Pump/WATER/SPECIAL/110
  Falling Rocks/ROCK/PHYSICAL/200  →  Water Pulse/WATER/SPECIAL/60

### 140 Kabuto
  Harden/NORMAL/PHYSICAL/10  →  Aqua Jet/WATER/PHYSICAL/40
  Scratch/NORMAL/PHYSICAL/56  →  Ancient Power/ROCK/SPECIAL/60
  Bubbles/WATER/SPECIAL/56  →  Brine/WATER/SPECIAL/65
  Mud Shot/GROUND/PHYSICAL/72  →  Liquidation/WATER/PHYSICAL/85
  Slash/NORMAL/PHYSICAL/72  →  Stone Edge/ROCK/PHYSICAL/100
  Night Slash/DARK/PHYSICAL/120  →  Water Pulse/WATER/SPECIAL/60
  Ancient Power/ROCK/PHYSICAL/160  →  Rock Tomb/ROCK/PHYSICAL/60

### 141 Kabutops
  Leech Life/BUG/PHYSICAL/56  →  Aqua Jet/WATER/PHYSICAL/40
  Ancient Absorb/ROCK/PHYSICAL/56  →  Ancient Power/ROCK/SPECIAL/60
  Mud Shot/GROUND/PHYSICAL/72  →  Brine/WATER/SPECIAL/65
  Aqua Jet/WATER/PHYSICAL/96  →  Liquidation/WATER/PHYSICAL/85
  Rock Throw/ROCK/PHYSICAL/96  →  Stone Edge/ROCK/PHYSICAL/100
  X-Scissor/BUG/PHYSICAL/120  →  Water Pulse/WATER/SPECIAL/60
  Ancient Power/ROCK/PHYSICAL/160  →  Rock Tomb/ROCK/PHYSICAL/60
  Liquidation/WATER/PHYSICAL/160  →  Scald/WATER/SPECIAL/80

### 142 Aerodactyl
  Air Cutter/FLYING/PHYSICAL/56  →  Ancient Power/ROCK/SPECIAL/60
  Roar/NORMAL/PHYSICAL/56  →  Wing Attack/FLYING/PHYSICAL/60
  Super Sonic/NORMAL/PHYSICAL/56  →  Rock Slide/ROCK/PHYSICAL/75
  Bite/DARK/PHYSICAL/72  →  Stone Edge/ROCK/PHYSICAL/100
  Pluck/FLYING/PHYSICAL/96  →  Rock Blast/ROCK/PHYSICAL/25
  Rock Throw/ROCK/PHYSICAL/96  →  Rock Tomb/ROCK/PHYSICAL/60
  Hyper Beam/NORMAL/SPECIAL/120  →  Fly/FLYING/PHYSICAL/90
  Rock Slide/ROCK/PHYSICAL/120  →  Hurricane/FLYING/SPECIAL/110
  Wing Attack/FLYING/PHYSICAL/120  →  Dual Wingbeat/FLYING/PHYSICAL/40
  Ancient Power/ROCK/PHYSICAL/160  →  Sky Attack/FLYING/PHYSICAL/140
  Falling Rocks/ROCK/PHYSICAL/200  →  Meteor Beam/ROCK/SPECIAL/120

### 143 Snorlax
  Giga Impact/NORMAL/PHYSICAL/56  →  Covet/NORMAL/PHYSICAL/60
  Lick/GHOST/PHYSICAL/56  →  Flail/NORMAL/PHYSICAL/56
  Crusher Stomp/NORMAL/PHYSICAL/56  →  Last Resort/NORMAL/PHYSICAL/140
  Bite/DARK/PHYSICAL/72  →  Tackle/NORMAL/PHYSICAL/40
  Body Slam/NORMAL/PHYSICAL/72  →  Snore/NORMAL/SPECIAL/50
  Crunch/DARK/PHYSICAL/72  →  Body Slam/NORMAL/PHYSICAL/85
  Ice Punch/ICE/PHYSICAL/72  →  Giga Impact/NORMAL/PHYSICAL/150
  Hyper Beam/NORMAL/SPECIAL/120  →  Take Down/NORMAL/PHYSICAL/90
  Rest/PSYCHIC/PHYSICAL/160  →  Facade/NORMAL/PHYSICAL/70

### 144 Articuno
  Aerial Ace/FLYING/PHYSICAL/56  →  Gust/FLYING/SPECIAL/40
  Air Cutter/FLYING/PHYSICAL/56  →  Powder Snow/ICE/SPECIAL/40
  Aurora Beam/WATER/SPECIAL/56  →  Ice Shard/ICE/PHYSICAL/40
  Drill Peck/FLYING/PHYSICAL/56  →  Freeze-Dry/ICE/SPECIAL/70
  Peck/FLYING/PHYSICAL/56  →  Ice Beam/ICE/SPECIAL/90
  Iceshock/ICE/SPECIAL/56  →  Hurricane/FLYING/SPECIAL/110
  Frost Tornado/ICE/PHYSICAL/56  →  Blizzard/ICE/SPECIAL/110
  Ice Beam/ICE/SPECIAL/96  →  Sheer Cold/ICE/SPECIAL/96
  Pluck/FLYING/PHYSICAL/96  →  Aerial Ace/FLYING/PHYSICAL/96
  Frost Breath/ICE/SPECIAL/120  →  Icy Wind/ICE/SPECIAL/55
  Ice Shard/ICE/PHYSICAL/120  →  Air Cutter/FLYING/SPECIAL/60
  Powder Snow/ICE/SPECIAL/120  →  Avalanche/ICE/PHYSICAL/60
  Ancient Power/ROCK/PHYSICAL/160  →  Air Slash/FLYING/SPECIAL/75
  Blizzard/ICE/PHYSICAL/200  →  Fly/FLYING/PHYSICAL/90

### 145 Zapdos
  Aerial Ace/FLYING/PHYSICAL/56  →  Peck/FLYING/PHYSICAL/35
  Ancient Power/ROCK/PHYSICAL/160  →  Thunder Shock/ELECTRIC/SPECIAL/40
  Charge Beam/ELECTRIC/SPECIAL/56  →  Pluck/FLYING/PHYSICAL/60
  Drill Peck/FLYING/PHYSICAL/56  →  Drill Peck/FLYING/PHYSICAL/80
  Electro Ball/ELECTRIC/SPECIAL/56  →  Discharge/ELECTRIC/SPECIAL/80
  Peck/FLYING/PHYSICAL/56  →  Thunder/ELECTRIC/SPECIAL/110
  Thunder Shock/ELECTRIC/SPECIAL/56  →  Zap Cannon/ELECTRIC/SPECIAL/120
  Thunder Wave/ELECTRIC/SPECIAL/120  →  Acrobatics/FLYING/PHYSICAL/55
  Thunder/ELECTRIC/SPECIAL/96  →  Aerial Ace/FLYING/PHYSICAL/96
  Thunderbolt/ELECTRIC/SPECIAL/72  →  Air Cutter/FLYING/SPECIAL/60
  Wing Attack/FLYING/PHYSICAL/120  →  Volt Switch/ELECTRIC/SPECIAL/70
  Electric Storm/ELECTRIC/SPECIAL/200  →  Electro Ball/ELECTRIC/SPECIAL/120
  Electro Field/ELECTRIC/PHYSICAL/10  →  Fly/FLYING/PHYSICAL/90
  Lightning Hell/ELECTRIC/PHYSICAL/10  →  Thunderbolt/ELECTRIC/SPECIAL/90

### 146 Moltres
  Aerial Ace/FLYING/PHYSICAL/56  →  Gust/FLYING/SPECIAL/40
  Drill Peck/FLYING/PHYSICAL/56  →  Ember/FIRE/SPECIAL/40
  Peck/FLYING/PHYSICAL/56  →  Wing Attack/FLYING/PHYSICAL/60
  Blast Burn/FIRE/SPECIAL/56  →  Incinerate/FIRE/SPECIAL/60
  Hell Fire/FIRE/SPECIAL/56  →  Air Slash/FLYING/SPECIAL/75
  Ember/FIRE/SPECIAL/80  →  Heat Wave/FIRE/SPECIAL/95
  Flamethrower/FIRE/SPECIAL/80  →  Hurricane/FLYING/SPECIAL/110
  Air Slash/FLYING/PHYSICAL/96  →  Overheat/FIRE/SPECIAL/130
  Eruption/FIRE/PHYSICAL/120  →  Sky Attack/FLYING/PHYSICAL/140
  Solar Beam/GRASS/SPECIAL/120  →  Acrobatics/FLYING/PHYSICAL/55
  Ancient Power/ROCK/PHYSICAL/160  →  Fire Spin/FIRE/SPECIAL/35
  Fire Blast/FIRE/SPECIAL/160  →  Aerial Ace/FLYING/PHYSICAL/120
  Inferno/FIRE/PHYSICAL/200  →  Flame Charge/FIRE/PHYSICAL/50
  Magma Storm/FIRE/SPECIAL/200  →  Air Cutter/FLYING/SPECIAL/60

### 147 Dratini
  Slam/NORMAL/PHYSICAL/56  →  Twister/DRAGON/SPECIAL/40
  Twister/DRAGON/PHYSICAL/56  →  Dragon Tail/DRAGON/PHYSICAL/60
  Aqua Tail/WATER/PHYSICAL/64  →  Dragon Rush/DRAGON/PHYSICAL/100
  Dragon Breath/DRAGON/SPECIAL/120  →  Outrage/DRAGON/PHYSICAL/120
  Hyper Beam/NORMAL/SPECIAL/120  →  Breaking Swipe/DRAGON/PHYSICAL/60
  Thunder Wave/ELECTRIC/SPECIAL/120  →  Draco Meteor/DRAGON/SPECIAL/130

### 148 Dragonair
  Slam/NORMAL/PHYSICAL/56  →  Twister/DRAGON/SPECIAL/40
  Twister/DRAGON/PHYSICAL/56  →  Dragon Tail/DRAGON/PHYSICAL/60
  Wrap/NORMAL/PHYSICAL/56  →  Dragon Rush/DRAGON/PHYSICAL/100
  Aqua Tail/WATER/PHYSICAL/64  →  Outrage/DRAGON/PHYSICAL/120
  Dragon Tail/DRAGON/PHYSICAL/80  →  Breaking Swipe/DRAGON/PHYSICAL/60
  Dragon Breath/DRAGON/SPECIAL/120  →  Draco Meteor/DRAGON/SPECIAL/130
  Hyper Beam/NORMAL/SPECIAL/120  →  Dragon Pulse/DRAGON/SPECIAL/85
  Thunder Wave/ELECTRIC/SPECIAL/120  →  Scale Shot/DRAGON/PHYSICAL/25

### 149 Dragonite
  Outrage/DRAGON/PHYSICAL/56  →  Twister/DRAGON/SPECIAL/40
  Slam/NORMAL/PHYSICAL/56  →  Wing Attack/FLYING/PHYSICAL/60
  Twister/DRAGON/PHYSICAL/56  →  Dragon Tail/DRAGON/PHYSICAL/60
  Scale Shot/DRAGON/PHYSICAL/56  →  Dragon Rush/DRAGON/PHYSICAL/100
  Dragon Flight/DRAGON/PHYSICAL/56  →  Outrage/DRAGON/PHYSICAL/120
  Inner Focus/NORMAL/PHYSICAL/56  →  Air Slash/FLYING/SPECIAL/75
  Dragon Tail/DRAGON/PHYSICAL/80  →  Breaking Swipe/DRAGON/PHYSICAL/60
  Dragon Claw/DRAGON/PHYSICAL/96  →  Dragon Claw/DRAGON/PHYSICAL/80
  Draco Meteor/DRAGON/PHYSICAL/160  →  Aerial Ace/FLYING/PHYSICAL/120

### 150 Mewtwo
  Tackle/NORMAL/PHYSICAL/56  →  Confusion/PSYCHIC/SPECIAL/50
  Confusion/PSYCHIC/SPECIAL/80  →  Psycho Cut/PSYCHIC/PHYSICAL/70
  Swift/NORMAL/PHYSICAL/72  →  Psychic/PSYCHIC/SPECIAL/90
  Recover/NORMAL/PHYSICAL/160  →  Psystrike/PSYCHIC/SPECIAL/100
  Ancient Power/ROCK/PHYSICAL/160  →  Future Sight/PSYCHIC/SPECIAL/120
  Amnesia/PSYCHIC/STATUS/0  →  Psybeam/PSYCHIC/SPECIAL/65
  Barrier/PSYCHIC/STATUS/0  →  Psyshock/PSYCHIC/SPECIAL/80
  Metronome/NORMAL/PHYSICAL/120  →  Zen Headbutt/PSYCHIC/PHYSICAL/80
  Psycho Cut/PSYCHIC/PHYSICAL/200  →  Dream Eater/PSYCHIC/SPECIAL/100
  Safeguard/NORMAL/PHYSICAL/56  →  Stored Power/PSYCHIC/SPECIAL/20
  Psychic/PSYCHIC/SPECIAL/96  →  Expanding Force/PSYCHIC/SPECIAL/80
  Aura Sphere/FIGHTING/SPECIAL/80  →  Psychic Noise/PSYCHIC/SPECIAL/75
  Disable/NORMAL/STATUS/0  →  Swift/NORMAL/SPECIAL/1
  Future Sight/PSYCHIC/PHYSICAL/56  →  Ancient Power/ROCK/SPECIAL/60
  Psystrike/PSYCHIC/SPECIAL/100  →  Aura Sphere/FIGHTING/SPECIAL/40

### 151 Mew
  Tackle/NORMAL/PHYSICAL/56  →  Psychic/PSYCHIC/SPECIAL/90
  Pound/NORMAL/PHYSICAL/40  →  Psybeam/PSYCHIC/SPECIAL/65
  Mega Punch/NORMAL/PHYSICAL/96  →  Stored Power/PSYCHIC/SPECIAL/20
  Confusion/PSYCHIC/SPECIAL/80  →  Psyshock/PSYCHIC/SPECIAL/80
  Ancient Power/ROCK/PHYSICAL/160  →  Zen Headbutt/PSYCHIC/PHYSICAL/80
  Transform/NORMAL/STATUS/0  →  Psychic Fangs/PSYCHIC/PHYSICAL/85
  Metronome/NORMAL/PHYSICAL/120  →  Future Sight/PSYCHIC/SPECIAL/120
  Amnesia/PSYCHIC/STATUS/0  →  Expanding Force/PSYCHIC/SPECIAL/80
  Barrier/PSYCHIC/STATUS/0  →  Psychic Noise/PSYCHIC/SPECIAL/75
  Psychic/PSYCHIC/SPECIAL/96  →  Pound/NORMAL/PHYSICAL/40
  Psyshock/PSYCHIC/SPECIAL/144  →  Ancient Power/ROCK/SPECIAL/60
  Reflect Type/NORMAL/STATUS/0  →  Aura Sphere/FIGHTING/SPECIAL/90
  Solar Beam/GRASS/SPECIAL/120  →  Take Down/NORMAL/PHYSICAL/90
  Overheat/FIRE/SPECIAL/130  →  Mud-Slap/GROUND/SPECIAL/20
  Hydro Cannon/WATER/SPECIAL/120  →  Fire Fang/FIRE/PHYSICAL/65
  Blizzard/ICE/PHYSICAL/200  →  Thunder Fang/ELECTRIC/PHYSICAL/65

### 152 Chikorita
  Absorb/GRASS/PHYSICAL/56  →  Razor Leaf/GRASS/PHYSICAL/55
  Tackle/NORMAL/PHYSICAL/56  →  Magical Leaf/GRASS/SPECIAL/20
  Mega Drain/GRASS/SPECIAL/40  →  Giga Drain/GRASS/SPECIAL/75
  Headbutt/NORMAL/PHYSICAL/80  →  Solar Beam/GRASS/SPECIAL/120
  Solar Beam/GRASS/SPECIAL/120  →  Leafage/GRASS/PHYSICAL/40
  Double-Edge/NORMAL/PHYSICAL/120  →  Leaf Storm/GRASS/SPECIAL/130

### 153 Bayleef
  Absorb/GRASS/PHYSICAL/56  →  Razor Leaf/GRASS/PHYSICAL/55
  Tackle/NORMAL/PHYSICAL/56  →  Magical Leaf/GRASS/SPECIAL/22
  Mega Drain/GRASS/SPECIAL/40  →  Giga Drain/GRASS/SPECIAL/75
  Headbutt/NORMAL/PHYSICAL/80  →  Solar Beam/GRASS/SPECIAL/120
  Solar Beam/GRASS/SPECIAL/120  →  Leafage/GRASS/PHYSICAL/40
  Double-Edge/NORMAL/PHYSICAL/120  →  Leaf Storm/GRASS/SPECIAL/130

### 154 Meganium
  Absorb/GRASS/PHYSICAL/56  →  Petal Blizzard/GRASS/PHYSICAL/90
  Tackle/NORMAL/PHYSICAL/56  →  Razor Leaf/GRASS/PHYSICAL/55
  Mega Drain/GRASS/SPECIAL/40  →  Magical Leaf/GRASS/SPECIAL/22
  Headbutt/NORMAL/PHYSICAL/80  →  Giga Drain/GRASS/SPECIAL/75
  Double-Edge/NORMAL/PHYSICAL/120  →  Leafage/GRASS/PHYSICAL/40

### 155 Cyndaquil
  Ember/FIRE/SPECIAL/80  →  Ember/FIRE/SPECIAL/40
  Tackle/NORMAL/PHYSICAL/56  →  Flame Wheel/FIRE/PHYSICAL/60
  Flamethrower/FIRE/SPECIAL/80  →  Flame Charge/FIRE/PHYSICAL/50
  Headbutt/NORMAL/PHYSICAL/80  →  Lava Plume/FIRE/SPECIAL/80
  Fire Blast/FIRE/SPECIAL/160  →  Flamethrower/FIRE/SPECIAL/90
  Double-Edge/NORMAL/PHYSICAL/120  →  Inferno/FIRE/SPECIAL/100

### 156 Quilava
  Ember/FIRE/SPECIAL/80  →  Ember/FIRE/SPECIAL/40
  Tackle/NORMAL/PHYSICAL/56  →  Flame Wheel/FIRE/PHYSICAL/60
  Flamethrower/FIRE/SPECIAL/80  →  Flame Charge/FIRE/PHYSICAL/50
  Headbutt/NORMAL/PHYSICAL/80  →  Lava Plume/FIRE/SPECIAL/80
  Fire Blast/FIRE/SPECIAL/160  →  Flamethrower/FIRE/SPECIAL/90
  Double-Edge/NORMAL/PHYSICAL/120  →  Inferno/FIRE/SPECIAL/100

### 157 Typhlosion
  Ember/FIRE/SPECIAL/80  →  Ember/FIRE/SPECIAL/40
  Tackle/NORMAL/PHYSICAL/56  →  Eruption/FIRE/SPECIAL/150
  Flamethrower/FIRE/SPECIAL/80  →  Flame Wheel/FIRE/PHYSICAL/60
  Headbutt/NORMAL/PHYSICAL/80  →  Flame Charge/FIRE/PHYSICAL/50
  Fire Blast/FIRE/SPECIAL/160  →  Lava Plume/FIRE/SPECIAL/80
  Double-Edge/NORMAL/PHYSICAL/120  →  Flamethrower/FIRE/SPECIAL/90

### 158 Totodile
  Water Gun/WATER/PHYSICAL/64  →  Water Gun/WATER/SPECIAL/40
  Tackle/NORMAL/PHYSICAL/56  →  Aqua Tail/WATER/PHYSICAL/90
  Water Pulse/WATER/SPECIAL/120  →  Hydro Pump/WATER/SPECIAL/110
  Headbutt/NORMAL/PHYSICAL/80  →  Bubble Beam/WATER/SPECIAL/65
  Surf/WATER/SPECIAL/160  →  Aqua Jet/WATER/PHYSICAL/40
  Double-Edge/NORMAL/PHYSICAL/120  →  Liquidation/WATER/PHYSICAL/85

### 159 Croconaw
  Water Gun/WATER/PHYSICAL/64  →  Water Gun/WATER/SPECIAL/40
  Tackle/NORMAL/PHYSICAL/56  →  Aqua Tail/WATER/PHYSICAL/90
  Water Pulse/WATER/SPECIAL/120  →  Hydro Pump/WATER/SPECIAL/110
  Headbutt/NORMAL/PHYSICAL/80  →  Bubble Beam/WATER/SPECIAL/65
  Surf/WATER/SPECIAL/160  →  Aqua Jet/WATER/PHYSICAL/40
  Double-Edge/NORMAL/PHYSICAL/120  →  Liquidation/WATER/PHYSICAL/85

### 160 Feraligatr
  Water Gun/WATER/PHYSICAL/64  →  Water Gun/WATER/SPECIAL/40
  Tackle/NORMAL/PHYSICAL/56  →  Aqua Tail/WATER/PHYSICAL/90
  Water Pulse/WATER/SPECIAL/120  →  Hydro Pump/WATER/SPECIAL/110
  Headbutt/NORMAL/PHYSICAL/80  →  Bubble Beam/WATER/SPECIAL/65
  Surf/WATER/SPECIAL/160  →  Aqua Jet/WATER/PHYSICAL/40
  Double-Edge/NORMAL/PHYSICAL/120  →  Liquidation/WATER/PHYSICAL/85

### 161 Sentret
  Tackle/NORMAL/PHYSICAL/56  →  Scratch/NORMAL/PHYSICAL/40
  Scratch/NORMAL/PHYSICAL/56  →  Quick Attack/NORMAL/PHYSICAL/40
  Headbutt/NORMAL/PHYSICAL/80  →  Fury Swipes/NORMAL/PHYSICAL/18
  Stomp/NORMAL/PHYSICAL/80  →  Slam/NORMAL/PHYSICAL/80
  Thrash/NORMAL/PHYSICAL/120  →  Hyper Voice/NORMAL/SPECIAL/90

### 162 Furret
  Tackle/NORMAL/PHYSICAL/56  →  Quick Attack/NORMAL/PHYSICAL/40
  Scratch/NORMAL/PHYSICAL/56  →  Scratch/NORMAL/PHYSICAL/40
  Headbutt/NORMAL/PHYSICAL/80  →  Fury Swipes/NORMAL/PHYSICAL/18
  Stomp/NORMAL/PHYSICAL/80  →  Slam/NORMAL/PHYSICAL/80
  Thrash/NORMAL/PHYSICAL/120  →  Hyper Voice/NORMAL/SPECIAL/90

### 163 Hoothoot
  Tackle/NORMAL/PHYSICAL/56  →  Peck/FLYING/PHYSICAL/35
  Scratch/NORMAL/PHYSICAL/56  →  Tackle/NORMAL/PHYSICAL/40
  Peck/FLYING/PHYSICAL/56  →  Echoed Voice/NORMAL/SPECIAL/40
  Headbutt/NORMAL/PHYSICAL/80  →  Air Slash/FLYING/SPECIAL/75
  Stomp/NORMAL/PHYSICAL/80  →  Take Down/NORMAL/PHYSICAL/90
  Drill Peck/FLYING/PHYSICAL/56  →  Uproar/NORMAL/SPECIAL/90
  Double-Edge/NORMAL/PHYSICAL/120  →  Acrobatics/FLYING/PHYSICAL/55
  Thrash/NORMAL/PHYSICAL/120  →  Facade/NORMAL/PHYSICAL/70

### 164 Noctowl
  Tackle/NORMAL/PHYSICAL/56  →  Echoed Voice/NORMAL/SPECIAL/40
  Scratch/NORMAL/PHYSICAL/56  →  Peck/FLYING/PHYSICAL/35
  Peck/FLYING/PHYSICAL/56  →  Sky Attack/FLYING/PHYSICAL/140
  Headbutt/NORMAL/PHYSICAL/80  →  Tackle/NORMAL/PHYSICAL/40
  Stomp/NORMAL/PHYSICAL/80  →  Air Slash/FLYING/SPECIAL/75
  Drill Peck/FLYING/PHYSICAL/56  →  Take Down/NORMAL/PHYSICAL/90
  Double-Edge/NORMAL/PHYSICAL/120  →  Uproar/NORMAL/SPECIAL/90
  Thrash/NORMAL/PHYSICAL/120  →  Acrobatics/FLYING/PHYSICAL/55

### 165 Ledyba
  Leech Life/BUG/PHYSICAL/56  →  Struggle Bug/BUG/SPECIAL/50
  Peck/FLYING/PHYSICAL/56  →  Bug Buzz/BUG/SPECIAL/90
  Tackle/NORMAL/PHYSICAL/56  →  Air Slash/FLYING/SPECIAL/75
  Signal Beam/BUG/SPECIAL/56  →  Aerial Ace/FLYING/PHYSICAL/56
  Drill Peck/FLYING/PHYSICAL/56  →  U-turn/BUG/PHYSICAL/70
  Headbutt/NORMAL/PHYSICAL/80  →  Tackle/NORMAL/PHYSICAL/40
  X-Scissor/BUG/PHYSICAL/120  →  Swift/NORMAL/SPECIAL/8
  Double-Edge/NORMAL/PHYSICAL/120  →  Mach Punch/FIGHTING/PHYSICAL/40

### 166 Ledian
  Leech Life/BUG/PHYSICAL/56  →  Struggle Bug/BUG/SPECIAL/50
  Peck/FLYING/PHYSICAL/56  →  Bug Buzz/BUG/SPECIAL/90
  Tackle/NORMAL/PHYSICAL/56  →  Air Slash/FLYING/SPECIAL/75
  Signal Beam/BUG/SPECIAL/56  →  Aerial Ace/FLYING/PHYSICAL/56
  Drill Peck/FLYING/PHYSICAL/56  →  U-turn/BUG/PHYSICAL/70
  Headbutt/NORMAL/PHYSICAL/80  →  Swift/NORMAL/SPECIAL/1
  X-Scissor/BUG/PHYSICAL/120  →  Tackle/NORMAL/PHYSICAL/40
  Double-Edge/NORMAL/PHYSICAL/120  →  Mach Punch/FIGHTING/PHYSICAL/40

### 167 Spinarak
  Leech Life/BUG/PHYSICAL/56  →  Poison Sting/POISON/PHYSICAL/15
  Poison Sting/POISON/PHYSICAL/56  →  Infestation/BUG/SPECIAL/20
  Tackle/NORMAL/PHYSICAL/56  →  Pin Missile/BUG/PHYSICAL/25
  Signal Beam/BUG/SPECIAL/56  →  Poison Jab/POISON/PHYSICAL/80
  Sludge/POISON/SPECIAL/56  →  Cross Poison/POISON/PHYSICAL/70
  Headbutt/NORMAL/PHYSICAL/80  →  X-Scissor/BUG/PHYSICAL/80
  X-Scissor/BUG/PHYSICAL/120  →  Bug Buzz/BUG/SPECIAL/90
  Double-Edge/NORMAL/PHYSICAL/120  →  Leech Life/BUG/PHYSICAL/80

### 168 Ariados
  Leech Life/BUG/PHYSICAL/56  →  Bug Bite/BUG/PHYSICAL/60
  Poison Sting/POISON/PHYSICAL/56  →  Fell Stinger/BUG/PHYSICAL/50
  Tackle/NORMAL/PHYSICAL/56  →  Poison Sting/POISON/PHYSICAL/15
  Signal Beam/BUG/SPECIAL/56  →  Infestation/BUG/SPECIAL/20
  Sludge/POISON/SPECIAL/56  →  Pin Missile/BUG/PHYSICAL/25
  Headbutt/NORMAL/PHYSICAL/80  →  Poison Jab/POISON/PHYSICAL/80
  X-Scissor/BUG/PHYSICAL/120  →  Cross Poison/POISON/PHYSICAL/70
  Double-Edge/NORMAL/PHYSICAL/120  →  X-Scissor/BUG/PHYSICAL/80

### 169 Crobat
  Poison Sting/POISON/PHYSICAL/56  →  Gust/FLYING/SPECIAL/40
  Peck/FLYING/PHYSICAL/56  →  Wing Attack/FLYING/PHYSICAL/60
  Tackle/NORMAL/PHYSICAL/56  →  Poison Fang/POISON/PHYSICAL/50
  Sludge/POISON/SPECIAL/56  →  Air Slash/FLYING/SPECIAL/75
  Drill Peck/FLYING/PHYSICAL/56  →  Brave Bird/FLYING/PHYSICAL/120
  Headbutt/NORMAL/PHYSICAL/80  →  Air Cutter/FLYING/SPECIAL/60
  Sludge Bomb/POISON/SPECIAL/104  →  Cross Poison/POISON/PHYSICAL/70
  Double-Edge/NORMAL/PHYSICAL/120  →  Aerial Ace/FLYING/PHYSICAL/120
  + Fly/FLYING/PHYSICAL/90  (slot novo · cd 42000 · lv 44)
  + Sludge Bomb/POISON/SPECIAL/90  (slot novo · cd 50000 · lv 52)

### 170 Chinchou
  Water Gun/WATER/PHYSICAL/64  →  Water Gun/WATER/SPECIAL/40
  Thunder Shock/ELECTRIC/SPECIAL/56  →  Electro Ball/ELECTRIC/SPECIAL/56
  Tackle/NORMAL/PHYSICAL/56  →  Bubble Beam/WATER/SPECIAL/65
  Water Pulse/WATER/SPECIAL/120  →  Spark/ELECTRIC/PHYSICAL/65
  Spark/ELECTRIC/PHYSICAL/96  →  Discharge/ELECTRIC/SPECIAL/80
  Headbutt/NORMAL/PHYSICAL/80  →  Hydro Pump/WATER/SPECIAL/110
  Surf/WATER/SPECIAL/160  →  Water Pulse/WATER/SPECIAL/60
  Double-Edge/NORMAL/PHYSICAL/120  →  Chilling Water/WATER/SPECIAL/50

### 171 Lanturn
  Water Gun/WATER/PHYSICAL/64  →  Electro Ball/ELECTRIC/SPECIAL/64
  Thunder Shock/ELECTRIC/SPECIAL/56  →  Water Gun/WATER/SPECIAL/40
  Tackle/NORMAL/PHYSICAL/56  →  Bubble Beam/WATER/SPECIAL/65
  Water Pulse/WATER/SPECIAL/120  →  Spark/ELECTRIC/PHYSICAL/65
  Spark/ELECTRIC/PHYSICAL/96  →  Discharge/ELECTRIC/SPECIAL/80
  Headbutt/NORMAL/PHYSICAL/80  →  Hydro Pump/WATER/SPECIAL/110
  Surf/WATER/SPECIAL/160  →  Water Pulse/WATER/SPECIAL/60
  Double-Edge/NORMAL/PHYSICAL/120  →  Chilling Water/WATER/SPECIAL/50

### 172 Pichu
  Thunder Shock/ELECTRIC/SPECIAL/56  →  Thunder Shock/ELECTRIC/SPECIAL/40
  Tackle/NORMAL/PHYSICAL/56  →  Nuzzle/ELECTRIC/PHYSICAL/20
  Spark/ELECTRIC/PHYSICAL/96  →  Spark/ELECTRIC/PHYSICAL/65
  Headbutt/NORMAL/PHYSICAL/80  →  Thunderbolt/ELECTRIC/SPECIAL/90
  Thunder/ELECTRIC/SPECIAL/96  →  Thunder/ELECTRIC/SPECIAL/110
  Double-Edge/NORMAL/PHYSICAL/120  →  Volt Tackle/ELECTRIC/PHYSICAL/120

### 173 Cleffa
  Fairy Wind/FAIRY/SPECIAL/40  →  Disarming Voice/FAIRY/SPECIAL/12
  Tackle/NORMAL/PHYSICAL/56  →  Fairy Wind/FAIRY/SPECIAL/40
  Draining Kiss/FAIRY/PHYSICAL/56  →  Draining Kiss/FAIRY/SPECIAL/50
  Headbutt/NORMAL/PHYSICAL/80  →  Moonblast/FAIRY/SPECIAL/95
  Moonblast/FAIRY/SPECIAL/95  →  Play Rough/FAIRY/PHYSICAL/90
  Double-Edge/NORMAL/PHYSICAL/120  →  Dazzling Gleam/FAIRY/SPECIAL/80

### 174 Igglybuff
  Tackle/NORMAL/PHYSICAL/56  →  Pound/NORMAL/PHYSICAL/40
  Scratch/NORMAL/PHYSICAL/56  →  Disarming Voice/FAIRY/SPECIAL/12
  Fairy Wind/FAIRY/SPECIAL/40  →  Tackle/NORMAL/PHYSICAL/40
  Headbutt/NORMAL/PHYSICAL/80  →  Draining Kiss/FAIRY/SPECIAL/50
  Stomp/NORMAL/PHYSICAL/80  →  Facade/NORMAL/PHYSICAL/70
  Draining Kiss/FAIRY/PHYSICAL/56  →  Take Down/NORMAL/PHYSICAL/90
  Double-Edge/NORMAL/PHYSICAL/120  →  Play Rough/FAIRY/PHYSICAL/90
  Thrash/NORMAL/PHYSICAL/120  →  Swift/NORMAL/SPECIAL/120

### 175 Togepi
  Tackle/NORMAL/PHYSICAL/56  →  Draining Kiss/FAIRY/SPECIAL/50
  Draining Kiss/FAIRY/PHYSICAL/56  →  Moonblast/FAIRY/SPECIAL/95
  Headbutt/NORMAL/PHYSICAL/80  →  Dazzling Gleam/FAIRY/SPECIAL/80
  Moonblast/FAIRY/SPECIAL/95  →  Play Rough/FAIRY/PHYSICAL/90
  Double-Edge/NORMAL/PHYSICAL/120  →  Tackle/NORMAL/PHYSICAL/40

### 176 Togetic
  Fairy Wind/FAIRY/SPECIAL/40  →  Air Cutter/FLYING/SPECIAL/60
  Peck/FLYING/PHYSICAL/56  →  Fairy Wind/FAIRY/SPECIAL/40
  Tackle/NORMAL/PHYSICAL/56  →  Draining Kiss/FAIRY/SPECIAL/50
  Draining Kiss/FAIRY/PHYSICAL/56  →  Air Slash/FLYING/SPECIAL/75
  Drill Peck/FLYING/PHYSICAL/56  →  Moonblast/FAIRY/SPECIAL/95
  Headbutt/NORMAL/PHYSICAL/80  →  Aerial Ace/FLYING/PHYSICAL/80
  Moonblast/FAIRY/SPECIAL/95  →  Dazzling Gleam/FAIRY/SPECIAL/80
  Double-Edge/NORMAL/PHYSICAL/120  →  Play Rough/FAIRY/PHYSICAL/90

### 177 Natu
  Psywave/PSYCHIC/SPECIAL/56  →  Peck/FLYING/PHYSICAL/35
  Peck/FLYING/PHYSICAL/56  →  Stored Power/PSYCHIC/SPECIAL/20
  Tackle/NORMAL/PHYSICAL/56  →  Psychic/PSYCHIC/SPECIAL/90
  Heart Stamp/PSYCHIC/PHYSICAL/56  →  Future Sight/PSYCHIC/SPECIAL/120
  Drill Peck/FLYING/PHYSICAL/56  →  Aerial Ace/FLYING/PHYSICAL/56
  Headbutt/NORMAL/PHYSICAL/80  →  Dream Eater/PSYCHIC/SPECIAL/100
  Psychic/PSYCHIC/SPECIAL/96  →  Pluck/FLYING/PHYSICAL/60
  Double-Edge/NORMAL/PHYSICAL/120  →  Night Shade/GHOST/SPECIAL/120

### 178 Xatu
  Psywave/PSYCHIC/SPECIAL/56  →  Air Slash/FLYING/SPECIAL/75
  Peck/FLYING/PHYSICAL/56  →  Peck/FLYING/PHYSICAL/35
  Tackle/NORMAL/PHYSICAL/56  →  Stored Power/PSYCHIC/SPECIAL/20
  Heart Stamp/PSYCHIC/PHYSICAL/56  →  Psychic/PSYCHIC/SPECIAL/90
  Drill Peck/FLYING/PHYSICAL/56  →  Future Sight/PSYCHIC/SPECIAL/120
  Headbutt/NORMAL/PHYSICAL/80  →  Aerial Ace/FLYING/PHYSICAL/80
  Psychic/PSYCHIC/SPECIAL/96  →  Dream Eater/PSYCHIC/SPECIAL/100
  Double-Edge/NORMAL/PHYSICAL/120  →  Pluck/FLYING/PHYSICAL/60

### 179 Mareep
  Thunder Shock/ELECTRIC/SPECIAL/56  →  Thunder Shock/ELECTRIC/SPECIAL/40
  Tackle/NORMAL/PHYSICAL/56  →  Electro Ball/ELECTRIC/SPECIAL/56
  Spark/ELECTRIC/PHYSICAL/96  →  Discharge/ELECTRIC/SPECIAL/80
  Headbutt/NORMAL/PHYSICAL/80  →  Thunder/ELECTRIC/SPECIAL/110
  Thunder/ELECTRIC/SPECIAL/96  →  Thunderbolt/ELECTRIC/SPECIAL/90
  Double-Edge/NORMAL/PHYSICAL/120  →  Volt Switch/ELECTRIC/SPECIAL/70

### 180 Flaaffy
  Thunder Shock/ELECTRIC/SPECIAL/56  →  Thunder Shock/ELECTRIC/SPECIAL/40
  Tackle/NORMAL/PHYSICAL/56  →  Electro Ball/ELECTRIC/SPECIAL/56
  Spark/ELECTRIC/PHYSICAL/96  →  Discharge/ELECTRIC/SPECIAL/80
  Headbutt/NORMAL/PHYSICAL/80  →  Thunder/ELECTRIC/SPECIAL/110
  Thunder/ELECTRIC/SPECIAL/96  →  Thunderbolt/ELECTRIC/SPECIAL/90
  Double-Edge/NORMAL/PHYSICAL/120  →  Volt Switch/ELECTRIC/SPECIAL/70

### 181 Ampharos
  Thunder Shock/ELECTRIC/SPECIAL/56  →  Thunder Shock/ELECTRIC/SPECIAL/40
  Tackle/NORMAL/PHYSICAL/56  →  Zap Cannon/ELECTRIC/SPECIAL/120
  Spark/ELECTRIC/PHYSICAL/96  →  Electro Ball/ELECTRIC/SPECIAL/96
  Headbutt/NORMAL/PHYSICAL/80  →  Discharge/ELECTRIC/SPECIAL/80
  Thunder/ELECTRIC/SPECIAL/96  →  Thunder/ELECTRIC/SPECIAL/110
  Double-Edge/NORMAL/PHYSICAL/120  →  Thunderbolt/ELECTRIC/SPECIAL/90

### 182 Bellossom
  Absorb/GRASS/PHYSICAL/56  →  Absorb/GRASS/SPECIAL/20
  Tackle/NORMAL/PHYSICAL/56  →  Giga Drain/GRASS/SPECIAL/75
  Headbutt/NORMAL/PHYSICAL/80  →  Petal Dance/GRASS/SPECIAL/120
  Solar Beam/GRASS/SPECIAL/120  →  Trailblaze/GRASS/PHYSICAL/50
  Double-Edge/NORMAL/PHYSICAL/120  →  Magical Leaf/GRASS/SPECIAL/120
  + Bullet Seed/GRASS/PHYSICAL/25  (slot novo · cd 30000 · lv 28)
  + Seed Bomb/GRASS/PHYSICAL/80  (slot novo · cd 36000 · lv 36)
  + Grass Knot/GRASS/SPECIAL/70  (slot novo · cd 42000 · lv 44)
  + Energy Ball/GRASS/SPECIAL/90  (slot novo · cd 50000 · lv 52)

### 183 Marill
  Water Gun/WATER/PHYSICAL/64  →  Water Gun/WATER/SPECIAL/40
  Fairy Wind/FAIRY/SPECIAL/40  →  Bubble Beam/WATER/SPECIAL/65
  Tackle/NORMAL/PHYSICAL/56  →  Aqua Tail/WATER/PHYSICAL/90
  Water Pulse/WATER/SPECIAL/120  →  Play Rough/FAIRY/PHYSICAL/90
  Draining Kiss/FAIRY/PHYSICAL/56  →  Hydro Pump/WATER/SPECIAL/110
  Headbutt/NORMAL/PHYSICAL/80  →  Water Pulse/WATER/SPECIAL/60
  Surf/WATER/SPECIAL/160  →  Disarming Voice/FAIRY/SPECIAL/120
  Double-Edge/NORMAL/PHYSICAL/120  →  Chilling Water/WATER/SPECIAL/50

### 184 Azumarill
  Water Gun/WATER/PHYSICAL/64  →  Water Gun/WATER/SPECIAL/40
  Fairy Wind/FAIRY/SPECIAL/40  →  Bubble Beam/WATER/SPECIAL/65
  Tackle/NORMAL/PHYSICAL/56  →  Aqua Tail/WATER/PHYSICAL/90
  Water Pulse/WATER/SPECIAL/120  →  Play Rough/FAIRY/PHYSICAL/90
  Draining Kiss/FAIRY/PHYSICAL/56  →  Hydro Pump/WATER/SPECIAL/110
  Headbutt/NORMAL/PHYSICAL/80  →  Water Pulse/WATER/SPECIAL/60
  Surf/WATER/SPECIAL/160  →  Disarming Voice/FAIRY/SPECIAL/120
  Double-Edge/NORMAL/PHYSICAL/120  →  Chilling Water/WATER/SPECIAL/50

### 185 Sudowoodo
  Rock Throw/ROCK/PHYSICAL/96  →  Rock Throw/ROCK/PHYSICAL/50
  Tackle/NORMAL/PHYSICAL/56  →  Stone Edge/ROCK/PHYSICAL/100
  Rock Blast/ROCK/SPECIAL/120  →  Rock Tomb/ROCK/PHYSICAL/60
  Headbutt/NORMAL/PHYSICAL/80  →  Rock Slide/ROCK/PHYSICAL/75
  Stone Edge/ROCK/PHYSICAL/56  →  Head Smash/ROCK/PHYSICAL/150
  Double-Edge/NORMAL/PHYSICAL/120  →  Rock Blast/ROCK/PHYSICAL/25

### 186 Politoed
  Water Gun/WATER/PHYSICAL/64  →  Hydro Pump/WATER/SPECIAL/110
  Tackle/NORMAL/PHYSICAL/56  →  Water Pulse/WATER/SPECIAL/60
  Water Pulse/WATER/SPECIAL/120  →  Chilling Water/WATER/SPECIAL/50
  Headbutt/NORMAL/PHYSICAL/80  →  Waterfall/WATER/PHYSICAL/80
  Surf/WATER/SPECIAL/160  →  Liquidation/WATER/PHYSICAL/85
  Double-Edge/NORMAL/PHYSICAL/120  →  Surf/WATER/SPECIAL/90
  + Whirlpool/WATER/SPECIAL/35  (slot novo · cd 30000 · lv 28)
  + Muddy Water/WATER/SPECIAL/90  (slot novo · cd 36000 · lv 36)
  + Pound/NORMAL/PHYSICAL/40  (slot novo · cd 42000 · lv 44)
  + Take Down/NORMAL/PHYSICAL/90  (slot novo · cd 50000 · lv 52)

### 187 Hoppip
  Absorb/GRASS/PHYSICAL/56  →  Absorb/GRASS/SPECIAL/20
  Peck/FLYING/PHYSICAL/56  →  Bullet Seed/GRASS/PHYSICAL/25
  Tackle/NORMAL/PHYSICAL/56  →  Mega Drain/GRASS/SPECIAL/40
  Mega Drain/GRASS/SPECIAL/40  →  Acrobatics/FLYING/PHYSICAL/55
  Drill Peck/FLYING/PHYSICAL/56  →  Giga Drain/GRASS/SPECIAL/75
  Headbutt/NORMAL/PHYSICAL/80  →  Bounce/FLYING/PHYSICAL/85
  Solar Beam/GRASS/SPECIAL/120  →  Trailblaze/GRASS/PHYSICAL/50
  Double-Edge/NORMAL/PHYSICAL/120  →  Aerial Ace/FLYING/PHYSICAL/120

### 188 Skiploom
  Absorb/GRASS/PHYSICAL/56  →  Absorb/GRASS/SPECIAL/20
  Peck/FLYING/PHYSICAL/56  →  Bullet Seed/GRASS/PHYSICAL/25
  Tackle/NORMAL/PHYSICAL/56  →  Mega Drain/GRASS/SPECIAL/40
  Mega Drain/GRASS/SPECIAL/40  →  Acrobatics/FLYING/PHYSICAL/55
  Drill Peck/FLYING/PHYSICAL/56  →  Giga Drain/GRASS/SPECIAL/75
  Headbutt/NORMAL/PHYSICAL/80  →  Bounce/FLYING/PHYSICAL/85
  Solar Beam/GRASS/SPECIAL/120  →  Trailblaze/GRASS/PHYSICAL/50
  Double-Edge/NORMAL/PHYSICAL/120  →  Aerial Ace/FLYING/PHYSICAL/120

### 189 Jumpluff
  Absorb/GRASS/PHYSICAL/56  →  Absorb/GRASS/SPECIAL/20
  Peck/FLYING/PHYSICAL/56  →  Bullet Seed/GRASS/PHYSICAL/25
  Tackle/NORMAL/PHYSICAL/56  →  Mega Drain/GRASS/SPECIAL/40
  Mega Drain/GRASS/SPECIAL/40  →  Acrobatics/FLYING/PHYSICAL/55
  Drill Peck/FLYING/PHYSICAL/56  →  Giga Drain/GRASS/SPECIAL/75
  Headbutt/NORMAL/PHYSICAL/80  →  Bounce/FLYING/PHYSICAL/85
  Solar Beam/GRASS/SPECIAL/120  →  Trailblaze/GRASS/PHYSICAL/50
  Double-Edge/NORMAL/PHYSICAL/120  →  Aerial Ace/FLYING/PHYSICAL/120

### 190 Aipom
  Tackle/NORMAL/PHYSICAL/56  →  Scratch/NORMAL/PHYSICAL/40
  Scratch/NORMAL/PHYSICAL/56  →  Fury Swipes/NORMAL/PHYSICAL/18
  Headbutt/NORMAL/PHYSICAL/80  →  Swift/NORMAL/SPECIAL/22
  Stomp/NORMAL/PHYSICAL/80  →  Double Hit/NORMAL/PHYSICAL/35
  Double-Edge/NORMAL/PHYSICAL/120  →  Last Resort/NORMAL/PHYSICAL/140
  Thrash/NORMAL/PHYSICAL/120  →  Take Down/NORMAL/PHYSICAL/90

### 191 Sunkern
  Absorb/GRASS/PHYSICAL/56  →  Absorb/GRASS/SPECIAL/20
  Tackle/NORMAL/PHYSICAL/56  →  Mega Drain/GRASS/SPECIAL/40
  Mega Drain/GRASS/SPECIAL/40  →  Razor Leaf/GRASS/PHYSICAL/55
  Headbutt/NORMAL/PHYSICAL/80  →  Giga Drain/GRASS/SPECIAL/75
  Double-Edge/NORMAL/PHYSICAL/120  →  Seed Bomb/GRASS/PHYSICAL/80

### 192 Sunflora
  Absorb/GRASS/PHYSICAL/56  →  Absorb/GRASS/SPECIAL/20
  Tackle/NORMAL/PHYSICAL/56  →  Mega Drain/GRASS/SPECIAL/40
  Mega Drain/GRASS/SPECIAL/40  →  Razor Leaf/GRASS/PHYSICAL/55
  Headbutt/NORMAL/PHYSICAL/80  →  Giga Drain/GRASS/SPECIAL/75
  Solar Beam/GRASS/SPECIAL/120  →  Bullet Seed/GRASS/PHYSICAL/25
  Double-Edge/NORMAL/PHYSICAL/120  →  Petal Dance/GRASS/SPECIAL/120

### 193 Yanma
  Leech Life/BUG/PHYSICAL/56  →  Air Cutter/FLYING/SPECIAL/60
  Peck/FLYING/PHYSICAL/56  →  Bug Bite/BUG/PHYSICAL/60
  Tackle/NORMAL/PHYSICAL/56  →  Wing Attack/FLYING/PHYSICAL/60
  Signal Beam/BUG/SPECIAL/56  →  U-turn/BUG/PHYSICAL/70
  Drill Peck/FLYING/PHYSICAL/56  →  Air Slash/FLYING/SPECIAL/75
  Headbutt/NORMAL/PHYSICAL/80  →  Bug Buzz/BUG/SPECIAL/90
  X-Scissor/BUG/PHYSICAL/120  →  Struggle Bug/BUG/SPECIAL/50
  Double-Edge/NORMAL/PHYSICAL/120  →  Pounce/BUG/PHYSICAL/50

### 194 Wooper
  Water Gun/WATER/PHYSICAL/64  →  Water Gun/WATER/SPECIAL/40
  Mud-Slap/GROUND/PHYSICAL/56  →  Mud Shot/GROUND/SPECIAL/55
  Tackle/NORMAL/PHYSICAL/56  →  Aqua Tail/WATER/PHYSICAL/90
  Water Pulse/WATER/SPECIAL/120  →  Muddy Water/WATER/SPECIAL/90
  Mud Bomb/GROUND/SPECIAL/56  →  Earthquake/GROUND/PHYSICAL/100
  Headbutt/NORMAL/PHYSICAL/80  →  Mud-Slap/GROUND/SPECIAL/20
  Surf/WATER/SPECIAL/160  →  Water Pulse/WATER/SPECIAL/60
  Double-Edge/NORMAL/PHYSICAL/120  →  Chilling Water/WATER/SPECIAL/50

### 195 Quagsire
  Water Gun/WATER/PHYSICAL/64  →  Mud Shot/GROUND/SPECIAL/55
  Mud-Slap/GROUND/PHYSICAL/56  →  Water Gun/WATER/SPECIAL/40
  Tackle/NORMAL/PHYSICAL/56  →  Aqua Tail/WATER/PHYSICAL/90
  Water Pulse/WATER/SPECIAL/120  →  Muddy Water/WATER/SPECIAL/90
  Mud Bomb/GROUND/SPECIAL/56  →  Earthquake/GROUND/PHYSICAL/100
  Headbutt/NORMAL/PHYSICAL/80  →  Mud-Slap/GROUND/SPECIAL/20
  Surf/WATER/SPECIAL/160  →  Water Pulse/WATER/SPECIAL/60
  Double-Edge/NORMAL/PHYSICAL/120  →  Chilling Water/WATER/SPECIAL/50

### 196 Espeon
  Psywave/PSYCHIC/SPECIAL/56  →  Psybeam/PSYCHIC/SPECIAL/65
  Tackle/NORMAL/PHYSICAL/56  →  Psychic/PSYCHIC/SPECIAL/90
  Heart Stamp/PSYCHIC/PHYSICAL/56  →  Future Sight/PSYCHIC/SPECIAL/120
  Headbutt/NORMAL/PHYSICAL/80  →  Psyshock/PSYCHIC/SPECIAL/80
  Psychic/PSYCHIC/SPECIAL/96  →  Psychic Fangs/PSYCHIC/PHYSICAL/85
  Double-Edge/NORMAL/PHYSICAL/120  →  Dream Eater/PSYCHIC/SPECIAL/100
  + Stored Power/PSYCHIC/SPECIAL/20  (slot novo · cd 30000 · lv 28)
  + Zen Headbutt/PSYCHIC/PHYSICAL/80  (slot novo · cd 36000 · lv 36)
  + Expanding Force/PSYCHIC/SPECIAL/80  (slot novo · cd 42000 · lv 44)
  + Psychic Noise/PSYCHIC/SPECIAL/75  (slot novo · cd 50000 · lv 52)

### 197 Umbreon
  Bite/DARK/PHYSICAL/72  →  Bite/DARK/PHYSICAL/60
  Tackle/NORMAL/PHYSICAL/56  →  Assurance/DARK/PHYSICAL/60
  Pursuit/DARK/PHYSICAL/120  →  Dark Pulse/DARK/SPECIAL/80
  Headbutt/NORMAL/PHYSICAL/80  →  Knock Off/DARK/PHYSICAL/65
  Night Slash/DARK/PHYSICAL/120  →  Crunch/DARK/PHYSICAL/80
  Double-Edge/NORMAL/PHYSICAL/120  →  Thief/DARK/PHYSICAL/60
  + Snarl/DARK/SPECIAL/55  (slot novo · cd 30000 · lv 28)
  + Foul Play/DARK/PHYSICAL/95  (slot novo · cd 36000 · lv 36)
  + Lash Out/DARK/PHYSICAL/75  (slot novo · cd 42000 · lv 44)
  + Throat Chop/DARK/PHYSICAL/80  (slot novo · cd 50000 · lv 52)

### 198 Murkrow
  Bite/DARK/PHYSICAL/72  →  Peck/FLYING/PHYSICAL/35
  Peck/FLYING/PHYSICAL/56  →  Gust/FLYING/SPECIAL/40
  Tackle/NORMAL/PHYSICAL/56  →  Wing Attack/FLYING/PHYSICAL/60
  Pursuit/DARK/PHYSICAL/120  →  Assurance/DARK/PHYSICAL/60
  Drill Peck/FLYING/PHYSICAL/56  →  Foul Play/DARK/PHYSICAL/95
  Headbutt/NORMAL/PHYSICAL/80  →  Sucker Punch/DARK/PHYSICAL/70
  Night Slash/DARK/PHYSICAL/120  →  Acrobatics/FLYING/PHYSICAL/55
  Double-Edge/NORMAL/PHYSICAL/120  →  Thief/DARK/PHYSICAL/60

### 199 Slowking
  Water Gun/WATER/PHYSICAL/64  →  Water Gun/WATER/SPECIAL/40
  Psywave/PSYCHIC/SPECIAL/56  →  Confusion/PSYCHIC/SPECIAL/50
  Tackle/NORMAL/PHYSICAL/56  →  Water Pulse/WATER/SPECIAL/60
  Water Pulse/WATER/SPECIAL/120  →  Surf/WATER/SPECIAL/90
  Heart Stamp/PSYCHIC/PHYSICAL/56  →  Psychic/PSYCHIC/SPECIAL/90
  Headbutt/NORMAL/PHYSICAL/80  →  Psybeam/PSYCHIC/SPECIAL/65
  Surf/WATER/SPECIAL/160  →  Zen Headbutt/PSYCHIC/PHYSICAL/80
  Double-Edge/NORMAL/PHYSICAL/120  →  Future Sight/PSYCHIC/SPECIAL/120
  + Psyshock/PSYCHIC/SPECIAL/80  (slot novo · cd 42000 · lv 44)
  + Whirlpool/WATER/SPECIAL/35  (slot novo · cd 50000 · lv 52)

### 200 Misdreavus
  Lick/GHOST/PHYSICAL/56  →  Astonish/GHOST/PHYSICAL/30
  Tackle/NORMAL/PHYSICAL/56  →  Hex/GHOST/SPECIAL/65
  Shadow Sneak/GHOST/PHYSICAL/40  →  Shadow Ball/GHOST/SPECIAL/80
  Headbutt/NORMAL/PHYSICAL/80  →  Night Shade/GHOST/SPECIAL/80
  Shadow Claw/GHOST/PHYSICAL/144  →  Phantom Force/GHOST/PHYSICAL/90
  Double-Edge/NORMAL/PHYSICAL/120  →  Poltergeist/GHOST/PHYSICAL/110

### 201 Unown
  Psywave/PSYCHIC/SPECIAL/56  →  Hidden Power/NORMAL/SPECIAL/60
  · Heart Stamp/PSYCHIC: PHYSICAL→SPECIAL (mantido; cache truncado — refetch)

### 202 Wobbuffet
  Psywave/PSYCHIC/SPECIAL/56  →  Mirror Coat/PSYCHIC/SPECIAL/56
  Tackle/NORMAL/PHYSICAL/56  →  Counter/FIGHTING/PHYSICAL/56
  · Heart Stamp/PSYCHIC: PHYSICAL→SPECIAL (mantido; cache truncado — refetch)

### 203 Girafarig
  Tackle/NORMAL/PHYSICAL/56  →  Tackle/NORMAL/PHYSICAL/40
  Scratch/NORMAL/PHYSICAL/56  →  Confusion/PSYCHIC/SPECIAL/50
  Psywave/PSYCHIC/SPECIAL/56  →  Stomp/NORMAL/PHYSICAL/65
  Headbutt/NORMAL/PHYSICAL/80  →  Psybeam/PSYCHIC/SPECIAL/65
  Stomp/NORMAL/PHYSICAL/80  →  Double Hit/NORMAL/PHYSICAL/35
  Heart Stamp/PSYCHIC/PHYSICAL/56  →  Twin Beam/PSYCHIC/SPECIAL/40
  Double-Edge/NORMAL/PHYSICAL/120  →  Psychic/PSYCHIC/SPECIAL/90
  Thrash/NORMAL/PHYSICAL/120  →  Take Down/NORMAL/PHYSICAL/90

### 204 Pineco
  Leech Life/BUG/PHYSICAL/56  →  Bug Bite/BUG/PHYSICAL/60
  Tackle/NORMAL/PHYSICAL/56  →  Struggle Bug/BUG/SPECIAL/50
  Signal Beam/BUG/SPECIAL/56  →  Pounce/BUG/PHYSICAL/50
  Headbutt/NORMAL/PHYSICAL/80  →  Bug Buzz/BUG/SPECIAL/90
  X-Scissor/BUG/PHYSICAL/120  →  Lunge/BUG/PHYSICAL/80
  Double-Edge/NORMAL/PHYSICAL/120  →  Tackle/NORMAL/PHYSICAL/40

### 205 Forretress
  Leech Life/BUG/PHYSICAL/56  →  Bug Bite/BUG/PHYSICAL/60
  Metal Claw/STEEL/PHYSICAL/56  →  Gyro Ball/STEEL/PHYSICAL/56
  Tackle/NORMAL/PHYSICAL/56  →  Struggle Bug/BUG/SPECIAL/50
  Signal Beam/BUG/SPECIAL/56  →  Pounce/BUG/PHYSICAL/50
  Iron Head/STEEL/PHYSICAL/80  →  Smart Strike/STEEL/PHYSICAL/70
  Headbutt/NORMAL/PHYSICAL/80  →  Flash Cannon/STEEL/SPECIAL/80
  X-Scissor/BUG/PHYSICAL/120  →  Iron Head/STEEL/PHYSICAL/80
  Double-Edge/NORMAL/PHYSICAL/120  →  Heavy Slam/STEEL/PHYSICAL/120

### 206 Dunsparce
  Tackle/NORMAL/PHYSICAL/56  →  Flail/NORMAL/PHYSICAL/56
  Scratch/NORMAL/PHYSICAL/56  →  Hyper Drill/NORMAL/PHYSICAL/100
  Headbutt/NORMAL/PHYSICAL/80  →  Double-Edge/NORMAL/PHYSICAL/120
  Stomp/NORMAL/PHYSICAL/80  →  Endeavor/NORMAL/PHYSICAL/80
  Double-Edge/NORMAL/PHYSICAL/120  →  Take Down/NORMAL/PHYSICAL/90
  Thrash/NORMAL/PHYSICAL/120  →  Facade/NORMAL/PHYSICAL/70

### 207 Gligar
  Mud-Slap/GROUND/PHYSICAL/56  →  Acrobatics/FLYING/PHYSICAL/55
  Peck/FLYING/PHYSICAL/56  →  Mud-Slap/GROUND/SPECIAL/20
  Tackle/NORMAL/PHYSICAL/56  →  Aerial Ace/FLYING/PHYSICAL/56
  Mud Bomb/GROUND/SPECIAL/56  →  Bulldoze/GROUND/PHYSICAL/60
  Drill Peck/FLYING/PHYSICAL/56  →  Mud Shot/GROUND/SPECIAL/55
  Headbutt/NORMAL/PHYSICAL/80  →  Earth Power/GROUND/SPECIAL/90
  Earthquake/GROUND/PHYSICAL/56  →  Earthquake/GROUND/PHYSICAL/100
  Double-Edge/NORMAL/PHYSICAL/120  →  Sand Tomb/GROUND/PHYSICAL/35

### 208 Steelix
  Metal Claw/STEEL/PHYSICAL/56  →  Sand Tomb/GROUND/PHYSICAL/35
  Mud-Slap/GROUND/PHYSICAL/56  →  Heavy Slam/STEEL/PHYSICAL/56
  Tackle/NORMAL/PHYSICAL/56  →  Dig/GROUND/PHYSICAL/80
  Iron Head/STEEL/PHYSICAL/80  →  Bulldoze/GROUND/PHYSICAL/60
  Mud Bomb/GROUND/SPECIAL/56  →  High Horsepower/GROUND/PHYSICAL/95
  Headbutt/NORMAL/PHYSICAL/80  →  Iron Tail/STEEL/PHYSICAL/100
  Flash Cannon/STEEL/SPECIAL/80  →  Earth Power/GROUND/SPECIAL/90
  Double-Edge/NORMAL/PHYSICAL/120  →  Iron Head/STEEL/PHYSICAL/80
  + Earthquake/GROUND/PHYSICAL/100  (slot novo · cd 42000 · lv 44)
  + Flash Cannon/STEEL/SPECIAL/80  (slot novo · cd 50000 · lv 52)

### 209 Snubbull
  Fairy Wind/FAIRY/SPECIAL/40  →  Play Rough/FAIRY/PHYSICAL/90
  Tackle/NORMAL/PHYSICAL/56  →  Dazzling Gleam/FAIRY/SPECIAL/80
  Draining Kiss/FAIRY/PHYSICAL/56  →  Fire Fang/FIRE/PHYSICAL/65
  Headbutt/NORMAL/PHYSICAL/80  →  Ice Fang/ICE/PHYSICAL/65
  Moonblast/FAIRY/SPECIAL/95  →  Tackle/NORMAL/PHYSICAL/40
  Double-Edge/NORMAL/PHYSICAL/120  →  Thunder Fang/ELECTRIC/PHYSICAL/65

### 210 Granbull
  Fairy Wind/FAIRY/SPECIAL/40  →  Play Rough/FAIRY/PHYSICAL/90
  Tackle/NORMAL/PHYSICAL/56  →  Dazzling Gleam/FAIRY/SPECIAL/80
  Draining Kiss/FAIRY/PHYSICAL/56  →  Fire Fang/FIRE/PHYSICAL/65
  Headbutt/NORMAL/PHYSICAL/80  →  Ice Fang/ICE/PHYSICAL/65
  Moonblast/FAIRY/SPECIAL/95  →  Outrage/DRAGON/PHYSICAL/120
  Double-Edge/NORMAL/PHYSICAL/120  →  Tackle/NORMAL/PHYSICAL/40

### 211 Qwilfish
  Water Gun/WATER/PHYSICAL/64  →  Poison Sting/POISON/PHYSICAL/15
  Poison Sting/POISON/PHYSICAL/56  →  Water Gun/WATER/SPECIAL/40
  Tackle/NORMAL/PHYSICAL/56  →  Brine/WATER/SPECIAL/65
  Water Pulse/WATER/SPECIAL/120  →  Poison Jab/POISON/PHYSICAL/80
  Sludge/POISON/SPECIAL/56  →  Aqua Tail/WATER/PHYSICAL/90
  Headbutt/NORMAL/PHYSICAL/80  →  Bubble Beam/WATER/SPECIAL/65
  Surf/WATER/SPECIAL/160  →  Aqua Jet/WATER/PHYSICAL/40
  Double-Edge/NORMAL/PHYSICAL/120  →  Barb Barrage/POISON/PHYSICAL/60

### 212 Scizor
  Leech Life/BUG/PHYSICAL/56  →  Fury Cutter/BUG/PHYSICAL/40
  Metal Claw/STEEL/PHYSICAL/56  →  Metal Claw/STEEL/PHYSICAL/50
  Tackle/NORMAL/PHYSICAL/56  →  Iron Head/STEEL/PHYSICAL/80
  Signal Beam/BUG/SPECIAL/56  →  X-Scissor/BUG/PHYSICAL/80
  Iron Head/STEEL/PHYSICAL/80  →  Steel Wing/STEEL/PHYSICAL/70
  Headbutt/NORMAL/PHYSICAL/80  →  Bug Buzz/BUG/SPECIAL/90
  X-Scissor/BUG/PHYSICAL/120  →  Lunge/BUG/PHYSICAL/80
  Double-Edge/NORMAL/PHYSICAL/120  →  U-turn/BUG/PHYSICAL/70
  + Flash Cannon/STEEL/SPECIAL/80  (slot novo · cd 42000 · lv 44)
  + Silver Wind/BUG/SPECIAL/60  (slot novo · cd 50000 · lv 52)

### 213 Shuckle
  Leech Life/BUG/PHYSICAL/56  →  Rollout/ROCK/PHYSICAL/30
  Rock Throw/ROCK/PHYSICAL/96  →  Struggle Bug/BUG/SPECIAL/50
  Tackle/NORMAL/PHYSICAL/56  →  Rock Throw/ROCK/PHYSICAL/50
  Signal Beam/BUG/SPECIAL/56  →  Bug Bite/BUG/PHYSICAL/60
  Rock Blast/ROCK/SPECIAL/120  →  Rock Slide/ROCK/PHYSICAL/75
  Headbutt/NORMAL/PHYSICAL/80  →  Stone Edge/ROCK/PHYSICAL/100
  X-Scissor/BUG/PHYSICAL/120  →  Rock Tomb/ROCK/PHYSICAL/60
  Double-Edge/NORMAL/PHYSICAL/120  →  Wrap/NORMAL/PHYSICAL/15

### 214 Heracross
  Leech Life/BUG/PHYSICAL/56  →  Arm Thrust/FIGHTING/PHYSICAL/15
  Karate Chop/FIGHTING/PHYSICAL/56  →  Counter/FIGHTING/PHYSICAL/56
  Tackle/NORMAL/PHYSICAL/56  →  Brick Break/FIGHTING/PHYSICAL/75
  Signal Beam/BUG/SPECIAL/56  →  Pin Missile/BUG/PHYSICAL/25
  Brick Break/FIGHTING/PHYSICAL/56  →  Megahorn/BUG/PHYSICAL/120
  Headbutt/NORMAL/PHYSICAL/80  →  Close Combat/FIGHTING/PHYSICAL/120
  X-Scissor/BUG/PHYSICAL/120  →  Bug Buzz/BUG/SPECIAL/90
  Double-Edge/NORMAL/PHYSICAL/120  →  Lunge/BUG/PHYSICAL/80
  + Rock Smash/FIGHTING/PHYSICAL/40  (slot novo · cd 42000 · lv 44)
  + Focus Blast/FIGHTING/SPECIAL/120  (slot novo · cd 50000 · lv 52)

### 215 Sneasel
  Bite/DARK/PHYSICAL/72  →  Icy Wind/ICE/SPECIAL/55
  Icy Wind/ICE/PHYSICAL/56  →  Beat Up/DARK/PHYSICAL/56
  Tackle/NORMAL/PHYSICAL/56  →  Thief/DARK/PHYSICAL/60
  Pursuit/DARK/PHYSICAL/120  →  Snarl/DARK/SPECIAL/55
  Ice Punch/ICE/PHYSICAL/72  →  Fling/DARK/PHYSICAL/72
  Headbutt/NORMAL/PHYSICAL/80  →  Avalanche/ICE/PHYSICAL/60
  Night Slash/DARK/PHYSICAL/120  →  Foul Play/DARK/PHYSICAL/95
  Double-Edge/NORMAL/PHYSICAL/120  →  Ice Punch/ICE/PHYSICAL/75

### 216 Teddiursa
  Tackle/NORMAL/PHYSICAL/56  →  Covet/NORMAL/PHYSICAL/60
  Scratch/NORMAL/PHYSICAL/56  →  Scratch/NORMAL/PHYSICAL/40
  Headbutt/NORMAL/PHYSICAL/80  →  Fury Swipes/NORMAL/PHYSICAL/18
  Stomp/NORMAL/PHYSICAL/80  →  Slash/NORMAL/PHYSICAL/70
  Double-Edge/NORMAL/PHYSICAL/120  →  Snore/NORMAL/SPECIAL/50

### 217 Ursaring
  Tackle/NORMAL/PHYSICAL/56  →  Covet/NORMAL/PHYSICAL/60
  Scratch/NORMAL/PHYSICAL/56  →  Scratch/NORMAL/PHYSICAL/40
  Headbutt/NORMAL/PHYSICAL/80  →  Fury Swipes/NORMAL/PHYSICAL/18
  Stomp/NORMAL/PHYSICAL/80  →  Slash/NORMAL/PHYSICAL/70
  Double-Edge/NORMAL/PHYSICAL/120  →  Snore/NORMAL/SPECIAL/50

### 218 Slugma
  Ember/FIRE/SPECIAL/80  →  Ember/FIRE/SPECIAL/40
  Tackle/NORMAL/PHYSICAL/56  →  Incinerate/FIRE/SPECIAL/60
  Flamethrower/FIRE/SPECIAL/80  →  Lava Plume/FIRE/SPECIAL/80
  Headbutt/NORMAL/PHYSICAL/80  →  Flamethrower/FIRE/SPECIAL/90
  Fire Blast/FIRE/SPECIAL/160  →  Fire Spin/FIRE/SPECIAL/35
  Double-Edge/NORMAL/PHYSICAL/120  →  Flame Charge/FIRE/PHYSICAL/50

### 219 Magcargo
  Ember/FIRE/SPECIAL/80  →  Ember/FIRE/SPECIAL/40
  Rock Throw/ROCK/PHYSICAL/96  →  Rock Throw/ROCK/PHYSICAL/50
  Tackle/NORMAL/PHYSICAL/56  →  Ancient Power/ROCK/SPECIAL/60
  Flamethrower/FIRE/SPECIAL/80  →  Incinerate/FIRE/SPECIAL/60
  Rock Blast/ROCK/SPECIAL/120  →  Rock Slide/ROCK/PHYSICAL/75
  Headbutt/NORMAL/PHYSICAL/80  →  Lava Plume/FIRE/SPECIAL/80
  Fire Blast/FIRE/SPECIAL/160  →  Flamethrower/FIRE/SPECIAL/90
  Double-Edge/NORMAL/PHYSICAL/120  →  Fire Spin/FIRE/SPECIAL/35

### 220 Swinub
  Icy Wind/ICE/PHYSICAL/56  →  Mud-Slap/GROUND/SPECIAL/20
  Mud-Slap/GROUND/PHYSICAL/56  →  Powder Snow/ICE/SPECIAL/40
  Tackle/NORMAL/PHYSICAL/56  →  Ice Shard/ICE/PHYSICAL/40
  Ice Punch/ICE/PHYSICAL/72  →  Icy Wind/ICE/SPECIAL/55
  Mud Bomb/GROUND/SPECIAL/56  →  Earthquake/GROUND/PHYSICAL/100
  Headbutt/NORMAL/PHYSICAL/80  →  Blizzard/ICE/SPECIAL/110
  Ice Beam/ICE/SPECIAL/96  →  Ice Fang/ICE/PHYSICAL/65
  Double-Edge/NORMAL/PHYSICAL/120  →  Bulldoze/GROUND/PHYSICAL/60

### 221 Piloswine
  Icy Wind/ICE/PHYSICAL/56  →  Mud-Slap/GROUND/SPECIAL/20
  Mud-Slap/GROUND/PHYSICAL/56  →  Powder Snow/ICE/SPECIAL/40
  Tackle/NORMAL/PHYSICAL/56  →  Ice Shard/ICE/PHYSICAL/40
  Ice Punch/ICE/PHYSICAL/72  →  Icy Wind/ICE/SPECIAL/55
  Mud Bomb/GROUND/SPECIAL/56  →  Earthquake/GROUND/PHYSICAL/100
  Headbutt/NORMAL/PHYSICAL/80  →  Blizzard/ICE/SPECIAL/110
  Ice Beam/ICE/SPECIAL/96  →  Ice Fang/ICE/PHYSICAL/65
  Double-Edge/NORMAL/PHYSICAL/120  →  Bulldoze/GROUND/PHYSICAL/60

### 222 Corsola
  Water Gun/WATER/PHYSICAL/64  →  Water Gun/WATER/SPECIAL/40
  Rock Throw/ROCK/PHYSICAL/96  →  Ancient Power/ROCK/SPECIAL/60
  Tackle/NORMAL/PHYSICAL/56  →  Bubble Beam/WATER/SPECIAL/65
  Water Pulse/WATER/SPECIAL/120  →  Power Gem/ROCK/SPECIAL/80
  Rock Blast/ROCK/SPECIAL/120  →  Water Pulse/WATER/SPECIAL/60
  Headbutt/NORMAL/PHYSICAL/80  →  Rock Tomb/ROCK/PHYSICAL/60
  Surf/WATER/SPECIAL/160  →  Scald/WATER/SPECIAL/80
  Double-Edge/NORMAL/PHYSICAL/120  →  Brine/WATER/SPECIAL/65

### 223 Remoraid
  Water Gun/WATER/PHYSICAL/64  →  Bubble/WATER/SPECIAL/40
  Tackle/NORMAL/PHYSICAL/56  →  Water Pulse/WATER/SPECIAL/60
  Water Pulse/WATER/SPECIAL/120  →  Hydro Pump/WATER/SPECIAL/110
  Headbutt/NORMAL/PHYSICAL/80  →  Acid Spray/POISON/SPECIAL/40
  Surf/WATER/SPECIAL/160  →  Charge Beam/ELECTRIC/SPECIAL/50
  Double-Edge/NORMAL/PHYSICAL/120  →  Ice Beam/ICE/SPECIAL/90

### 224 Octillery
  Water Gun/WATER/PHYSICAL/64  →  Octazooka/WATER/SPECIAL/65
  Tackle/NORMAL/PHYSICAL/56  →  Bubble/WATER/SPECIAL/40
  Water Pulse/WATER/SPECIAL/120  →  Water Pulse/WATER/SPECIAL/60
  Headbutt/NORMAL/PHYSICAL/80  →  Hydro Pump/WATER/SPECIAL/110
  Surf/WATER/SPECIAL/160  →  Acid Spray/POISON/SPECIAL/40
  Double-Edge/NORMAL/PHYSICAL/120  →  Charge Beam/ELECTRIC/SPECIAL/50
  + Ice Beam/ICE/SPECIAL/90  (slot novo · cd 30000 · lv 28)
  + Hyper Beam/NORMAL/SPECIAL/150  (slot novo · cd 36000 · lv 36)
  + Energy Ball/GRASS/SPECIAL/90  (slot novo · cd 42000 · lv 44)
  + Flamethrower/FIRE/SPECIAL/90  (slot novo · cd 50000 · lv 52)

### 225 Delibird
  Icy Wind/ICE/PHYSICAL/56  →  Drill Peck/FLYING/PHYSICAL/80
  Peck/FLYING/PHYSICAL/56  →  Peck/FLYING/PHYSICAL/35
  Tackle/NORMAL/PHYSICAL/56  →  Icy Wind/ICE/SPECIAL/55
  Ice Punch/ICE/PHYSICAL/72  →  Aerial Ace/FLYING/PHYSICAL/18
  Drill Peck/FLYING/PHYSICAL/56  →  Ice Shard/ICE/PHYSICAL/40
  Headbutt/NORMAL/PHYSICAL/80  →  Air Slash/FLYING/SPECIAL/75
  Ice Beam/ICE/SPECIAL/96  →  Ice Punch/ICE/PHYSICAL/75
  Double-Edge/NORMAL/PHYSICAL/120  →  Freeze-Dry/ICE/SPECIAL/70

### 226 Mantine
  Water Gun/WATER/PHYSICAL/64  →  Bubble/WATER/SPECIAL/40
  Peck/FLYING/PHYSICAL/56  →  Aerial Ace/FLYING/PHYSICAL/9
  Tackle/NORMAL/PHYSICAL/56  →  Water Pulse/WATER/SPECIAL/60
  Water Pulse/WATER/SPECIAL/120  →  Air Slash/FLYING/SPECIAL/75
  Drill Peck/FLYING/PHYSICAL/56  →  Hydro Pump/WATER/SPECIAL/110
  Headbutt/NORMAL/PHYSICAL/80  →  Aqua Tail/WATER/PHYSICAL/90
  Surf/WATER/SPECIAL/160  →  Tackle/NORMAL/PHYSICAL/40

### 227 Skarmory
  Metal Claw/STEEL/PHYSICAL/56  →  Peck/FLYING/PHYSICAL/35
  Peck/FLYING/PHYSICAL/56  →  Metal Claw/STEEL/PHYSICAL/50
  Tackle/NORMAL/PHYSICAL/56  →  Wing Attack/FLYING/PHYSICAL/60
  Iron Head/STEEL/PHYSICAL/80  →  Steel Wing/STEEL/PHYSICAL/70
  Drill Peck/FLYING/PHYSICAL/56  →  Drill Peck/FLYING/PHYSICAL/80
  Headbutt/NORMAL/PHYSICAL/80  →  Brave Bird/FLYING/PHYSICAL/120
  Flash Cannon/STEEL/SPECIAL/80  →  Aerial Ace/FLYING/PHYSICAL/80
  Double-Edge/NORMAL/PHYSICAL/120  →  Fly/FLYING/PHYSICAL/90

### 228 Houndour
  Bite/DARK/PHYSICAL/72  →  Ember/FIRE/SPECIAL/40
  Ember/FIRE/SPECIAL/80  →  Bite/DARK/PHYSICAL/60
  Tackle/NORMAL/PHYSICAL/56  →  Incinerate/FIRE/SPECIAL/60
  Pursuit/DARK/PHYSICAL/120  →  Beat Up/DARK/PHYSICAL/120
  Flamethrower/FIRE/SPECIAL/80  →  Fire Fang/FIRE/PHYSICAL/65
  Headbutt/NORMAL/PHYSICAL/80  →  Comeuppance/DARK/PHYSICAL/80
  Night Slash/DARK/PHYSICAL/120  →  Foul Play/DARK/PHYSICAL/95
  Double-Edge/NORMAL/PHYSICAL/120  →  Flamethrower/FIRE/SPECIAL/90

### 229 Houndoom
  Bite/DARK/PHYSICAL/72  →  Ember/FIRE/SPECIAL/40
  Ember/FIRE/SPECIAL/80  →  Bite/DARK/PHYSICAL/60
  Tackle/NORMAL/PHYSICAL/56  →  Incinerate/FIRE/SPECIAL/60
  Pursuit/DARK/PHYSICAL/120  →  Beat Up/DARK/PHYSICAL/120
  Flamethrower/FIRE/SPECIAL/80  →  Fire Fang/FIRE/PHYSICAL/65
  Headbutt/NORMAL/PHYSICAL/80  →  Comeuppance/DARK/PHYSICAL/80
  Night Slash/DARK/PHYSICAL/120  →  Foul Play/DARK/PHYSICAL/95
  Double-Edge/NORMAL/PHYSICAL/120  →  Flamethrower/FIRE/SPECIAL/90
  + Crunch/DARK/PHYSICAL/80  (slot novo · cd 42000 · lv 44)
  + Inferno/FIRE/SPECIAL/100  (slot novo · cd 50000 · lv 52)

### 230 Kingdra
  Water Gun/WATER/PHYSICAL/64  →  Twister/DRAGON/SPECIAL/40
  Dragon Rage/DRAGON/SPECIAL/40  →  Water Gun/WATER/SPECIAL/40
  Tackle/NORMAL/PHYSICAL/56  →  Whirlpool/WATER/SPECIAL/35
  Water Pulse/WATER/SPECIAL/120  →  Dragon Breath/DRAGON/SPECIAL/60
  Dragon Tail/DRAGON/PHYSICAL/80  →  Bubble Beam/WATER/SPECIAL/65
  Headbutt/NORMAL/PHYSICAL/80  →  Water Pulse/WATER/SPECIAL/60
  Surf/WATER/SPECIAL/160  →  Dragon Pulse/DRAGON/SPECIAL/85
  Double-Edge/NORMAL/PHYSICAL/120  →  Hydro Pump/WATER/SPECIAL/110
  + Wave Crash/WATER/PHYSICAL/120  (slot novo · cd 42000 · lv 44)
  + Chilling Water/WATER/SPECIAL/50  (slot novo · cd 50000 · lv 52)

### 231 Phanpy
  Mud-Slap/GROUND/PHYSICAL/56  →  Bulldoze/GROUND/PHYSICAL/60
  Tackle/NORMAL/PHYSICAL/56  →  Mud-Slap/GROUND/SPECIAL/20
  Mud Bomb/GROUND/SPECIAL/56  →  Mud Shot/GROUND/SPECIAL/55
  Headbutt/NORMAL/PHYSICAL/80  →  Dig/GROUND/PHYSICAL/80
  Earthquake/GROUND/PHYSICAL/56  →  Stomping Tantrum/GROUND/PHYSICAL/75
  Double-Edge/NORMAL/PHYSICAL/120  →  Earth Power/GROUND/SPECIAL/90

### 232 Donphan
  Mud-Slap/GROUND/PHYSICAL/56  →  Bulldoze/GROUND/PHYSICAL/60
  Tackle/NORMAL/PHYSICAL/56  →  Stomping Tantrum/GROUND/PHYSICAL/75
  Mud Bomb/GROUND/SPECIAL/56  →  Earthquake/GROUND/PHYSICAL/100
  Headbutt/NORMAL/PHYSICAL/80  →  Mud-Slap/GROUND/SPECIAL/20
  Earthquake/GROUND/PHYSICAL/56  →  Mud Shot/GROUND/SPECIAL/55
  Double-Edge/NORMAL/PHYSICAL/120  →  Dig/GROUND/PHYSICAL/80

### 233 Porygon2
  Tackle/NORMAL/PHYSICAL/56  →  Tackle/NORMAL/PHYSICAL/40
  Scratch/NORMAL/PHYSICAL/56  →  Tri Attack/NORMAL/SPECIAL/80
  Headbutt/NORMAL/PHYSICAL/80  →  Hyper Beam/NORMAL/SPECIAL/150
  Stomp/NORMAL/PHYSICAL/80  →  Self-Destruct/NORMAL/PHYSICAL/200
  Double-Edge/NORMAL/PHYSICAL/120  →  Headbutt/NORMAL/PHYSICAL/70
  Thrash/NORMAL/PHYSICAL/120  →  Swift/NORMAL/SPECIAL/120
  + Giga Impact/NORMAL/PHYSICAL/150  (slot novo · cd 30000 · lv 28)
  + Double-Edge/NORMAL/PHYSICAL/120  (slot novo · cd 36000 · lv 36)
  + Facade/NORMAL/PHYSICAL/70  (slot novo · cd 42000 · lv 44)
  + Skull Bash/NORMAL/PHYSICAL/130  (slot novo · cd 50000 · lv 52)

### 234 Stantler
  Tackle/NORMAL/PHYSICAL/56  →  Tackle/NORMAL/PHYSICAL/40
  Scratch/NORMAL/PHYSICAL/56  →  Stomp/NORMAL/PHYSICAL/65
  Headbutt/NORMAL/PHYSICAL/80  →  Take Down/NORMAL/PHYSICAL/90
  Stomp/NORMAL/PHYSICAL/80  →  Double-Edge/NORMAL/PHYSICAL/120
  Double-Edge/NORMAL/PHYSICAL/120  →  Facade/NORMAL/PHYSICAL/70
  Thrash/NORMAL/PHYSICAL/120  →  Swift/NORMAL/SPECIAL/120

### 236 Tyrogue
  Karate Chop/FIGHTING/PHYSICAL/56  →  Low Kick/FIGHTING/PHYSICAL/56
  Tackle/NORMAL/PHYSICAL/56  →  Low Sweep/FIGHTING/PHYSICAL/65
  Brick Break/FIGHTING/PHYSICAL/56  →  Brick Break/FIGHTING/PHYSICAL/75
  Headbutt/NORMAL/PHYSICAL/80  →  Vacuum Wave/FIGHTING/SPECIAL/40
  Close Combat/FIGHTING/PHYSICAL/56  →  Upper Hand/FIGHTING/PHYSICAL/65
  Double-Edge/NORMAL/PHYSICAL/120  →  Fake Out/NORMAL/PHYSICAL/40
  + Tackle/NORMAL/PHYSICAL/40  (slot novo · cd 30000 · lv 28)
  + Take Down/NORMAL/PHYSICAL/90  (slot novo · cd 36000 · lv 36)
  + Thief/DARK/PHYSICAL/60  (slot novo · cd 42000 · lv 44)
  + Facade/NORMAL/PHYSICAL/70  (slot novo · cd 50000 · lv 52)

### 237 Hitmontop
  Karate Chop/FIGHTING/PHYSICAL/56  →  Close Combat/FIGHTING/PHYSICAL/120
  Tackle/NORMAL/PHYSICAL/56  →  Counter/FIGHTING/PHYSICAL/56
  Brick Break/FIGHTING/PHYSICAL/56  →  Low Kick/FIGHTING/PHYSICAL/56
  Headbutt/NORMAL/PHYSICAL/80  →  Low Sweep/FIGHTING/PHYSICAL/65
  Close Combat/FIGHTING/PHYSICAL/56  →  Brick Break/FIGHTING/PHYSICAL/75
  Double-Edge/NORMAL/PHYSICAL/120  →  Reversal/FIGHTING/PHYSICAL/120
  + Focus Blast/FIGHTING/SPECIAL/120  (slot novo · cd 30000 · lv 28)
  + Vacuum Wave/FIGHTING/SPECIAL/40  (slot novo · cd 36000 · lv 36)
  + Upper Hand/FIGHTING/PHYSICAL/65  (slot novo · cd 42000 · lv 44)
  + Fake Out/NORMAL/PHYSICAL/40  (slot novo · cd 50000 · lv 52)

### 238 Smoochum
  Icy Wind/ICE/PHYSICAL/56  →  Powder Snow/ICE/SPECIAL/40
  Psywave/PSYCHIC/SPECIAL/56  →  Confusion/PSYCHIC/SPECIAL/50
  Tackle/NORMAL/PHYSICAL/56  →  Ice Punch/ICE/PHYSICAL/75
  Ice Punch/ICE/PHYSICAL/72  →  Psychic/PSYCHIC/SPECIAL/90
  Heart Stamp/PSYCHIC/PHYSICAL/56  →  Blizzard/ICE/SPECIAL/110
  Headbutt/NORMAL/PHYSICAL/80  →  Ice Beam/ICE/SPECIAL/90
  Ice Beam/ICE/SPECIAL/96  →  Avalanche/ICE/PHYSICAL/60
  Double-Edge/NORMAL/PHYSICAL/120  →  Dream Eater/PSYCHIC/SPECIAL/100

### 239 Elekid
  Thunder Shock/ELECTRIC/SPECIAL/56  →  Thunder Shock/ELECTRIC/SPECIAL/40
  Tackle/NORMAL/PHYSICAL/56  →  Shock Wave/ELECTRIC/SPECIAL/16
  Spark/ELECTRIC/PHYSICAL/96  →  Thunder Punch/ELECTRIC/PHYSICAL/75
  Headbutt/NORMAL/PHYSICAL/80  →  Discharge/ELECTRIC/SPECIAL/80
  Thunder/ELECTRIC/SPECIAL/96  →  Thunderbolt/ELECTRIC/SPECIAL/90
  Double-Edge/NORMAL/PHYSICAL/120  →  Thunder/ELECTRIC/SPECIAL/110

### 240 Magby
  Ember/FIRE/SPECIAL/80  →  Ember/FIRE/SPECIAL/40
  Tackle/NORMAL/PHYSICAL/56  →  Flame Wheel/FIRE/PHYSICAL/60
  Flamethrower/FIRE/SPECIAL/80  →  Fire Punch/FIRE/PHYSICAL/75
  Headbutt/NORMAL/PHYSICAL/80  →  Lava Plume/FIRE/SPECIAL/80
  Fire Blast/FIRE/SPECIAL/160  →  Flamethrower/FIRE/SPECIAL/90
  Double-Edge/NORMAL/PHYSICAL/120  →  Fire Blast/FIRE/SPECIAL/110

### 241 Miltank
  Tackle/NORMAL/PHYSICAL/56  →  Tackle/NORMAL/PHYSICAL/40
  Scratch/NORMAL/PHYSICAL/56  →  Stomp/NORMAL/PHYSICAL/65
  Headbutt/NORMAL/PHYSICAL/80  →  Headbutt/NORMAL/PHYSICAL/70
  Stomp/NORMAL/PHYSICAL/80  →  Body Slam/NORMAL/PHYSICAL/85
  Double-Edge/NORMAL/PHYSICAL/120  →  Hyper Beam/NORMAL/SPECIAL/150
  Thrash/NORMAL/PHYSICAL/120  →  Facade/NORMAL/PHYSICAL/70

### 242 Blissey
  Tackle/NORMAL/PHYSICAL/56  →  Covet/NORMAL/PHYSICAL/60
  Scratch/NORMAL/PHYSICAL/56  →  Pound/NORMAL/PHYSICAL/40
  Headbutt/NORMAL/PHYSICAL/80  →  Echoed Voice/NORMAL/SPECIAL/40
  Stomp/NORMAL/PHYSICAL/80  →  Take Down/NORMAL/PHYSICAL/90
  Thrash/NORMAL/PHYSICAL/120  →  Last Resort/NORMAL/PHYSICAL/140

### 243 Raikou
  Thunder Shock/ELECTRIC/SPECIAL/56  →  Thunder Shock/ELECTRIC/SPECIAL/40
  Tackle/NORMAL/PHYSICAL/56  →  Spark/ELECTRIC/PHYSICAL/65
  Spark/ELECTRIC/PHYSICAL/96  →  Thunder Fang/ELECTRIC/PHYSICAL/65
  Thunder Punch/ELECTRIC/SPECIAL/56  →  Discharge/ELECTRIC/SPECIAL/80
  Headbutt/NORMAL/PHYSICAL/80  →  Thunder/ELECTRIC/SPECIAL/110
  Thunder/ELECTRIC/SPECIAL/96  →  Zap Cannon/ELECTRIC/SPECIAL/120
  Wild Charge/ELECTRIC/PHYSICAL/120  →  Charge Beam/ELECTRIC/SPECIAL/50
  Double-Edge/NORMAL/PHYSICAL/120  →  Volt Switch/ELECTRIC/SPECIAL/70

### 244 Entei
  Ember/FIRE/SPECIAL/80  →  Ember/FIRE/SPECIAL/40
  Tackle/NORMAL/PHYSICAL/56  →  Flame Wheel/FIRE/PHYSICAL/60
  Flamethrower/FIRE/SPECIAL/80  →  Fire Fang/FIRE/PHYSICAL/65
  Fire Punch/FIRE/SPECIAL/56  →  Lava Plume/FIRE/SPECIAL/80
  Headbutt/NORMAL/PHYSICAL/80  →  Fire Blast/FIRE/SPECIAL/110
  Fire Blast/FIRE/SPECIAL/160  →  Eruption/FIRE/SPECIAL/150
  Flare Blitz/FIRE/PHYSICAL/160  →  Fire Spin/FIRE/SPECIAL/35
  Double-Edge/NORMAL/PHYSICAL/120  →  Flame Charge/FIRE/PHYSICAL/50

### 245 Suicune
  Water Gun/WATER/PHYSICAL/64  →  Water Gun/WATER/SPECIAL/40
  Tackle/NORMAL/PHYSICAL/56  →  Water Pulse/WATER/SPECIAL/60
  Water Pulse/WATER/SPECIAL/120  →  Surf/WATER/SPECIAL/90
  Aqua Tail/WATER/PHYSICAL/64  →  Hydro Pump/WATER/SPECIAL/110
  Headbutt/NORMAL/PHYSICAL/80  →  Chilling Water/WATER/SPECIAL/50
  Surf/WATER/SPECIAL/160  →  Waterfall/WATER/PHYSICAL/80
  Hydro Pump/WATER/SPECIAL/136  →  Liquidation/WATER/PHYSICAL/85
  Double-Edge/NORMAL/PHYSICAL/120  →  Scald/WATER/SPECIAL/80

### 246 Larvitar
  Rock Throw/ROCK/PHYSICAL/96  →  Rock Throw/ROCK/PHYSICAL/50
  Mud-Slap/GROUND/PHYSICAL/56  →  Rock Slide/ROCK/PHYSICAL/75
  Tackle/NORMAL/PHYSICAL/56  →  Stomping Tantrum/GROUND/PHYSICAL/75
  Rock Blast/ROCK/SPECIAL/120  →  Smack Down/ROCK/PHYSICAL/50
  Mud Bomb/GROUND/SPECIAL/56  →  Earthquake/GROUND/PHYSICAL/100
  Headbutt/NORMAL/PHYSICAL/80  →  Stone Edge/ROCK/PHYSICAL/100
  Stone Edge/ROCK/PHYSICAL/56  →  Sand Tomb/GROUND/PHYSICAL/35
  Double-Edge/NORMAL/PHYSICAL/120  →  Rock Blast/ROCK/PHYSICAL/25

### 247 Pupitar
  Rock Throw/ROCK/PHYSICAL/96  →  Rock Throw/ROCK/PHYSICAL/50
  Mud-Slap/GROUND/PHYSICAL/56  →  Rock Slide/ROCK/PHYSICAL/75
  Tackle/NORMAL/PHYSICAL/56  →  Stomping Tantrum/GROUND/PHYSICAL/75
  Rock Blast/ROCK/SPECIAL/120  →  Smack Down/ROCK/PHYSICAL/50
  Mud Bomb/GROUND/SPECIAL/56  →  Earthquake/GROUND/PHYSICAL/100
  Headbutt/NORMAL/PHYSICAL/80  →  Stone Edge/ROCK/PHYSICAL/100
  Stone Edge/ROCK/PHYSICAL/56  →  Sand Tomb/GROUND/PHYSICAL/35
  Double-Edge/NORMAL/PHYSICAL/120  →  Rock Blast/ROCK/PHYSICAL/25

### 248 Tyranitar
  Rock Throw/ROCK/PHYSICAL/96  →  Dark Pulse/DARK/SPECIAL/80
  Bite/DARK/PHYSICAL/72  →  Payback/DARK/PHYSICAL/50
  Tackle/NORMAL/PHYSICAL/56  →  Rock Throw/ROCK/PHYSICAL/50
  Rock Blast/ROCK/SPECIAL/120  →  Bite/DARK/PHYSICAL/60
  Rock Slide/ROCK/PHYSICAL/120  →  Rock Slide/ROCK/PHYSICAL/75
  Pursuit/DARK/PHYSICAL/120  →  Smack Down/ROCK/PHYSICAL/50
  Headbutt/NORMAL/PHYSICAL/80  →  Crunch/DARK/PHYSICAL/80
  Stone Edge/ROCK/PHYSICAL/56  →  Stone Edge/ROCK/PHYSICAL/100
  Ancient Power/ROCK/PHYSICAL/160  →  Rock Blast/ROCK/PHYSICAL/25

### 249 Lugia
  Psywave/PSYCHIC/SPECIAL/56  →  Gust/FLYING/SPECIAL/40
  Peck/FLYING/PHYSICAL/56  →  Extrasensory/PSYCHIC/SPECIAL/80
  Tackle/NORMAL/PHYSICAL/56  →  Aeroblast/FLYING/SPECIAL/100
  Heart Stamp/PSYCHIC/PHYSICAL/56  →  Future Sight/PSYCHIC/SPECIAL/120
  Zen Headbutt/PSYCHIC/PHYSICAL/80  →  Sky Attack/FLYING/PHYSICAL/140
  Drill Peck/FLYING/PHYSICAL/56  →  Acrobatics/FLYING/PHYSICAL/55
  Headbutt/NORMAL/PHYSICAL/80  →  Aerial Ace/FLYING/PHYSICAL/80
  Psychic/PSYCHIC/SPECIAL/96  →  Air Cutter/FLYING/SPECIAL/60
  Psyshock/PSYCHIC/SPECIAL/144  →  Psyshock/PSYCHIC/SPECIAL/80

### 250 Ho-oh
  Ember/FIRE/SPECIAL/80  →  Gust/FLYING/SPECIAL/40
  Peck/FLYING/PHYSICAL/56  →  Sacred Fire/FIRE/PHYSICAL/100
  Tackle/NORMAL/PHYSICAL/56  →  Fire Blast/FIRE/SPECIAL/110
  Flamethrower/FIRE/SPECIAL/80  →  Sky Attack/FLYING/PHYSICAL/140
  Fire Punch/FIRE/SPECIAL/56  →  Overheat/FIRE/SPECIAL/130
  Drill Peck/FLYING/PHYSICAL/56  →  Fire Spin/FIRE/SPECIAL/35
  Headbutt/NORMAL/PHYSICAL/80  →  Aerial Ace/FLYING/PHYSICAL/80
  Fire Blast/FIRE/SPECIAL/160  →  Flame Charge/FIRE/PHYSICAL/50
  Flare Blitz/FIRE/PHYSICAL/160  →  Air Cutter/FLYING/SPECIAL/60

### 251 Celebi
  Psywave/PSYCHIC/SPECIAL/56  →  Confusion/PSYCHIC/SPECIAL/50
  Absorb/GRASS/PHYSICAL/56  →  Magical Leaf/GRASS/SPECIAL/10
  Tackle/NORMAL/PHYSICAL/56  →  Future Sight/PSYCHIC/SPECIAL/120
  Heart Stamp/PSYCHIC/PHYSICAL/56  →  Leaf Storm/GRASS/SPECIAL/130
  Zen Headbutt/PSYCHIC/PHYSICAL/80  →  Giga Drain/GRASS/SPECIAL/75
  Mega Drain/GRASS/SPECIAL/40  →  Solar Beam/GRASS/SPECIAL/120
  Headbutt/NORMAL/PHYSICAL/80  →  Psychic/PSYCHIC/SPECIAL/90
  Psychic/PSYCHIC/SPECIAL/96  →  Energy Ball/GRASS/SPECIAL/90
  Psyshock/PSYCHIC/SPECIAL/144  →  Dream Eater/PSYCHIC/SPECIAL/100

### 252 Treecko
  Quick Attack/NORMAL/PHYSICAL/56  →  Leafage/GRASS/PHYSICAL/40
  Bullet Seed/GRASS/SPECIAL/120  →  Mega Drain/GRASS/SPECIAL/40
  Grass Knot/GRASS/SPECIAL/80  →  Giga Drain/GRASS/SPECIAL/75
  Magical Leaf/GRASS/PHYSICAL/96  →  Energy Ball/GRASS/SPECIAL/90
  Leafage/GRASS/SPECIAL/56  →  Leaf Storm/GRASS/SPECIAL/130
  Giga Drain/GRASS/PHYSICAL/96  →  Absorb/GRASS/SPECIAL/20
  Agility/PSYCHIC/PHYSICAL/10  →  Bullet Seed/GRASS/PHYSICAL/25

### 253 Grovyle
  Quick Attack/NORMAL/PHYSICAL/56  →  Leafage/GRASS/PHYSICAL/40
  Bullet Seed/GRASS/SPECIAL/120  →  Mega Drain/GRASS/SPECIAL/40
  Leaf Blade/GRASS/PHYSICAL/80  →  Giga Drain/GRASS/SPECIAL/75
  Magical Leaf/GRASS/PHYSICAL/96  →  Leaf Blade/GRASS/PHYSICAL/90
  Leafage/GRASS/SPECIAL/56  →  Leaf Storm/GRASS/SPECIAL/130
  Giga Drain/GRASS/PHYSICAL/96  →  Absorb/GRASS/SPECIAL/20
  Leaf Storm/GRASS/SPECIAL/160  →  Energy Ball/GRASS/SPECIAL/90
  Agility/PSYCHIC/PHYSICAL/10  →  Bullet Seed/GRASS/PHYSICAL/25

### 254 Sceptile
  Leaf Guard/GRASS/SPECIAL/10  →  Leafage/GRASS/PHYSICAL/40
  Leaf Blade/GRASS/PHYSICAL/80  →  Mega Drain/GRASS/SPECIAL/40
  Magical Leaf/GRASS/PHYSICAL/96  →  Giga Drain/GRASS/SPECIAL/75
  Night Slash/DARK/PHYSICAL/120  →  Leaf Storm/GRASS/SPECIAL/130
  Leafage/GRASS/SPECIAL/56  →  Absorb/GRASS/SPECIAL/20
  Frenzy Plant/GRASS/SPECIAL/190  →  Energy Ball/GRASS/SPECIAL/90
  Leaf Storm/GRASS/SPECIAL/160  →  Leaf Blade/GRASS/PHYSICAL/90
  Swords Dance/NEUTRAL/PHYSICAL/56  →  Bullet Seed/GRASS/PHYSICAL/25

### 255 Torchic
  Quick Attack/NORMAL/PHYSICAL/56  →  Ember/FIRE/SPECIAL/40
  Ember/FIRE/SPECIAL/80  →  Flame Charge/FIRE/PHYSICAL/50
  Flamethrower/FIRE/SPECIAL/80  →  Flamethrower/FIRE/SPECIAL/90
  Feather Dance/FLYING/PHYSICAL/96  →  Flare Blitz/FIRE/PHYSICAL/120
  Fire Spin/FIRE/SPECIAL/56  →  Fire Blast/FIRE/SPECIAL/110
  Agility/PSYCHIC/PHYSICAL/10  →  Heat Wave/FIRE/SPECIAL/95

### 256 Combusken
  Quick Attack/NORMAL/PHYSICAL/56  →  Ember/FIRE/SPECIAL/40
  Ember/FIRE/SPECIAL/80  →  Flame Charge/FIRE/PHYSICAL/50
  Flamethrower/FIRE/SPECIAL/80  →  Blaze Kick/FIRE/PHYSICAL/85
  Fire Punch/FIRE/SPECIAL/56  →  Reversal/FIGHTING/PHYSICAL/56
  Blaze Kick/FIRE/PHYSICAL/56  →  Flare Blitz/FIRE/PHYSICAL/120
  Flare Blitz/FIRE/PHYSICAL/160  →  Flamethrower/FIRE/SPECIAL/90
  Sky Uppercut/FIGHTING/PHYSICAL/120  →  Brick Break/FIGHTING/PHYSICAL/75
  Bulk Up/FIGHTING/PHYSICAL/10  →  Power-Up Punch/FIGHTING/PHYSICAL/40
  + Fire Punch/FIRE/PHYSICAL/75  (slot novo · cd 42000 · lv 44)
  + Fire Blast/FIRE/SPECIAL/110  (slot novo · cd 50000 · lv 52)

### 257 Blaziken
  Low Kick/FIGHTING/PHYSICAL/80  →  Double Kick/FIGHTING/PHYSICAL/30
  Ember/FIRE/SPECIAL/80  →  Flame Charge/FIRE/PHYSICAL/50
  Mega Kick/FIGHTING/PHYSICAL/96  →  Reversal/FIGHTING/PHYSICAL/96
  Double Kick/FIGHTING/PHYSICAL/60  →  Flare Blitz/FIRE/PHYSICAL/120
  Blaze Kick/FIRE/PHYSICAL/56  →  Ember/FIRE/SPECIAL/40
  High Jump Kick/FIGHTING/PHYSICAL/140  →  Flamethrower/FIRE/SPECIAL/90
  Sky Uppercut/FIGHTING/PHYSICAL/120  →  Blaze Kick/FIRE/PHYSICAL/85
  Close Combat/FIGHTING/PHYSICAL/56  →  Brick Break/FIGHTING/PHYSICAL/75
  Flare Blitz/FIRE/PHYSICAL/160  →  Power-Up Punch/FIGHTING/PHYSICAL/40
  Bulk Up/FIGHTING/PHYSICAL/10  →  Fire Punch/FIRE/PHYSICAL/75

### 258 Mudkip
  Tackle/NORMAL/PHYSICAL/56  →  Water Gun/WATER/SPECIAL/40
  Mud-Slap/GROUND/PHYSICAL/56  →  Water Pulse/WATER/SPECIAL/60
  Water Gun/WATER/PHYSICAL/64  →  Surf/WATER/SPECIAL/90
  Aqua Tail/WATER/PHYSICAL/64  →  Hydro Pump/WATER/SPECIAL/110
  Water Ball/WATER/SPECIAL/64  →  Bubble Beam/WATER/SPECIAL/65
  Water Pulse/WATER/SPECIAL/120  →  Muddy Water/WATER/SPECIAL/90
  Earth Power/GROUND/PHYSICAL/120  →  Whirlpool/WATER/SPECIAL/35

### 259 Marshtomp
  Aqua Tail/WATER/PHYSICAL/64  →  Water Gun/WATER/SPECIAL/40
  Mud-Slap/GROUND/PHYSICAL/56  →  Water Pulse/WATER/SPECIAL/60
  Water Gun/WATER/PHYSICAL/64  →  Muddy Water/WATER/SPECIAL/90
  Water Ball/WATER/SPECIAL/64  →  Hydro Pump/WATER/SPECIAL/110
  Muddy Water/WATER/PHYSICAL/96  →  Mud Shot/GROUND/SPECIAL/55
  Hydro Pump/WATER/SPECIAL/136  →  Bubble Beam/WATER/SPECIAL/65
  Protect/NORMAL/PHYSICAL/10  →  Surf/WATER/SPECIAL/90

### 260 Swampert
  Aqua Tail/WATER/PHYSICAL/64  →  Mud Shot/GROUND/SPECIAL/55
  Mud-Slap/GROUND/PHYSICAL/56  →  Water Gun/WATER/SPECIAL/40
  Water Gun/WATER/PHYSICAL/64  →  Water Pulse/WATER/SPECIAL/60
  Water Ball/WATER/SPECIAL/64  →  Muddy Water/WATER/SPECIAL/90
  Hammer Arm/FIGHTING/PHYSICAL/120  →  Hydro Pump/WATER/SPECIAL/110
  Muddy Water/WATER/PHYSICAL/96  →  Sand Tomb/GROUND/PHYSICAL/35
  Earth Power/GROUND/PHYSICAL/120  →  Bubble Beam/WATER/SPECIAL/65
  Earthquake/GROUND/PHYSICAL/56  →  Surf/WATER/SPECIAL/90
  Hydro Pump/WATER/SPECIAL/136  →  Earthquake/GROUND/PHYSICAL/100
  Protect/NORMAL/PHYSICAL/10  →  Flip Turn/WATER/PHYSICAL/60

### 261 Poochyena
  Roar/NORMAL/PHYSICAL/56  →  Bite/DARK/PHYSICAL/60
  Bite/DARK/PHYSICAL/72  →  Assurance/DARK/PHYSICAL/60
  Crunch/DARK/PHYSICAL/72  →  Crunch/DARK/PHYSICAL/80
  Shadow Claw/GHOST/PHYSICAL/144  →  Sucker Punch/DARK/PHYSICAL/70
  Night Slash/DARK/PHYSICAL/120  →  Thief/DARK/PHYSICAL/60

### 262 Mightyena
  Snarl/DARK/SPECIAL/56  →  Bite/DARK/PHYSICAL/60
  Tackle/NORMAL/PHYSICAL/56  →  Crunch/DARK/PHYSICAL/80
  Bite/DARK/PHYSICAL/72  →  Thief/DARK/PHYSICAL/60
  Crunch/DARK/PHYSICAL/72  →  Assurance/DARK/PHYSICAL/60
  Dark Pulse/DARK/SPECIAL/120  →  Sucker Punch/DARK/PHYSICAL/70
  Night Daze/DARK/SPECIAL/100  →  Snarl/DARK/SPECIAL/55
  Payback/DARK/PHYSICAL/100  →  Foul Play/DARK/PHYSICAL/95
  Nasty Plot/DARK/PHYSICAL/120  →  Dark Pulse/DARK/SPECIAL/80
  Howl/DARK/PHYSICAL/56  →  Lash Out/DARK/PHYSICAL/75

### 270 Lotad
  Absorb/GRASS/PHYSICAL/56  →  Absorb/GRASS/SPECIAL/20
  Fury Swipes/NORMAL/PHYSICAL/96  →  Water Gun/WATER/SPECIAL/40
  Bubble Beam/WATER/SPECIAL/80  →  Mega Drain/GRASS/SPECIAL/40
  Scald/WATER/SPECIAL/100  →  Bubble Beam/WATER/SPECIAL/65
  Rain Dance/WATER/PHYSICAL/10  →  Giga Drain/GRASS/SPECIAL/75

### 271 Lombre
  Absorb/GRASS/PHYSICAL/56  →  Absorb/GRASS/SPECIAL/20
  Fury Swipes/NORMAL/PHYSICAL/96  →  Water Gun/WATER/SPECIAL/40
  Water Pulse/WATER/SPECIAL/120  →  Mega Drain/GRASS/SPECIAL/40
  Bubble Beam/WATER/SPECIAL/80  →  Bubble Beam/WATER/SPECIAL/65
  Waterfall/WATER/PHYSICAL/160  →  Giga Drain/GRASS/SPECIAL/75
  Scald/WATER/SPECIAL/100  →  Energy Ball/GRASS/SPECIAL/90
  Rain Dance/WATER/PHYSICAL/10  →  Hydro Pump/WATER/SPECIAL/110

### 272 Ludicolo
  Absorb/GRASS/PHYSICAL/56  →  Bubble Beam/WATER/SPECIAL/65
  Fury Swipes/NORMAL/PHYSICAL/96  →  Water Pulse/WATER/SPECIAL/60
  Water Pulse/WATER/SPECIAL/120  →  Trailblaze/GRASS/PHYSICAL/50
  Bubble Beam/WATER/SPECIAL/80  →  Chilling Water/WATER/SPECIAL/50
  Chilling Water/WATER/SPECIAL/80  →  Magical Leaf/GRASS/SPECIAL/80
  Scald/WATER/SPECIAL/100  →  Bullet Seed/GRASS/PHYSICAL/25
  Hydro Pump/WATER/SPECIAL/136  →  Seed Bomb/GRASS/PHYSICAL/80
  Rain Dance/WATER/PHYSICAL/10  →  Waterfall/WATER/PHYSICAL/80
  Energy Ball/GRASS/SPECIAL/100  →  Grass Knot/GRASS/SPECIAL/100

### 273 Seedot
  Leech Seed/GRASS/SPECIAL/120  →  Absorb/GRASS/SPECIAL/20
  Pound/NORMAL/PHYSICAL/40  →  Mega Drain/GRASS/SPECIAL/40
  Razor Leaf/GRASS/SPECIAL/56  →  Trailblaze/GRASS/PHYSICAL/50
  Dark Pulse/DARK/SPECIAL/120  →  Magical Leaf/GRASS/SPECIAL/120
  Feint Attack/DARK/PHYSICAL/80  →  Bullet Seed/GRASS/PHYSICAL/25

### 274 Nuzleaf
  Pound/NORMAL/PHYSICAL/40  →  Absorb/GRASS/SPECIAL/20
  Razor Leaf/GRASS/SPECIAL/56  →  Mega Drain/GRASS/SPECIAL/40
  Dark Pulse/DARK/SPECIAL/120  →  Payback/DARK/PHYSICAL/50
  Feint Attack/DARK/PHYSICAL/80  →  Sucker Punch/DARK/PHYSICAL/70
  Assurance/DARK/PHYSICAL/80  →  Leaf Blade/GRASS/PHYSICAL/90
  Sunny Day/FIRE/PHYSICAL/56  →  Thief/DARK/PHYSICAL/60

### 275 Shiftry
  Shadow Ball/GHOST/SPECIAL/56  →  Payback/DARK/PHYSICAL/50
  Knock Off/DARK/PHYSICAL/90  →  Thief/DARK/PHYSICAL/60
  Sucker Punch/DARK/PHYSICAL/120  →  Trailblaze/GRASS/PHYSICAL/50
  Beat Up/DARK/PHYSICAL/100  →  Snarl/DARK/SPECIAL/55
  Leaf Blade/GRASS/PHYSICAL/80  →  Magical Leaf/GRASS/SPECIAL/80
  Payback/DARK/PHYSICAL/100  →  Fling/DARK/PHYSICAL/100
  Solar Blade/GRASS/PHYSICAL/160  →  Bullet Seed/GRASS/PHYSICAL/25
  Sunny Day/FIRE/PHYSICAL/56  →  Foul Play/DARK/PHYSICAL/95

### 276 Taillow
  Peck/FLYING/PHYSICAL/56  →  Peck/FLYING/PHYSICAL/35
  Pluck/FLYING/PHYSICAL/96  →  Quick Attack/NORMAL/PHYSICAL/40
  Feather Dance/FLYING/PHYSICAL/96  →  Wing Attack/FLYING/PHYSICAL/60
  Air Slash/FLYING/PHYSICAL/96  →  Aerial Ace/FLYING/PHYSICAL/21
  Tailwind/FLYING/SPECIAL/10  →  Air Slash/FLYING/SPECIAL/75
  Roost/FLYING/PHYSICAL/160  →  Endeavor/NORMAL/PHYSICAL/120

### 277 Swellow
  Peck/FLYING/PHYSICAL/56  →  Air Slash/FLYING/SPECIAL/75
  Feather Dance/FLYING/PHYSICAL/96  →  Brave Bird/FLYING/PHYSICAL/120
  Pluck/FLYING/PHYSICAL/96  →  Peck/FLYING/PHYSICAL/35
  Air Slash/FLYING/PHYSICAL/96  →  Pluck/FLYING/PHYSICAL/60
  Bloomburst/NORMAL/SPECIAL/100  →  Quick Attack/NORMAL/PHYSICAL/40
  Aerial Ace/FLYING/PHYSICAL/56  →  Wing Attack/FLYING/PHYSICAL/60
  Sky Attack/FLYING/PHYSICAL/120  →  Aerial Ace/FLYING/PHYSICAL/21
  Brave Bird/FLYING/PHYSICAL/120  →  Endeavor/NORMAL/PHYSICAL/120
  Quick Guard/FIGHTING/PHYSICAL/56  →  Hyper Beam/NORMAL/SPECIAL/150

### 278 Wingull
  Super Sonic/NORMAL/PHYSICAL/56  →  Water Gun/WATER/SPECIAL/40
  Gust/FLYING/SPECIAL/56  →  Wing Attack/FLYING/PHYSICAL/60
  Bubble/WATER/SPECIAL/40  →  Water Pulse/WATER/SPECIAL/60
  Wing Attack/FLYING/PHYSICAL/120  →  Air Slash/FLYING/SPECIAL/75
  Scald/WATER/SPECIAL/100  →  Hurricane/FLYING/SPECIAL/110
  Rain Dance/WATER/PHYSICAL/10  →  Acrobatics/FLYING/PHYSICAL/55

### 279 Pelipper
  Super Sonic/NORMAL/PHYSICAL/56  →  Air Slash/FLYING/SPECIAL/75
  Gust/FLYING/SPECIAL/56  →  Water Gun/WATER/SPECIAL/40
  Feather Dance/FLYING/PHYSICAL/96  →  Wing Attack/FLYING/PHYSICAL/60
  Surf/WATER/SPECIAL/160  →  Water Pulse/WATER/SPECIAL/60
  Swallow/NORMAL/PHYSICAL/10  →  Hurricane/FLYING/SPECIAL/110
  Stockpile/NORMAL/PHYSICAL/10  →  Hydro Pump/WATER/SPECIAL/110
  Protection/NORMAL/PHYSICAL/10  →  Acrobatics/FLYING/PHYSICAL/55
  Helping Hand/NORMAL/PHYSICAL/10  →  Chilling Water/WATER/SPECIAL/50
  Hurricane/WATER/PHYSICAL/160  →  Aerial Ace/FLYING/PHYSICAL/120

### 280 Ralts
  Charm/FAIRY/PHYSICAL/56  →  Disarming Voice/FAIRY/SPECIAL/1
  Dazzling Gleam/FAIRY/PHYSICAL/56  →  Confusion/PSYCHIC/SPECIAL/50
  Instant Teleportation/PSYCHIC/SPECIAL/10  →  Draining Kiss/FAIRY/SPECIAL/50
  Confusion/PSYCHIC/SPECIAL/80  →  Psybeam/PSYCHIC/SPECIAL/65
  Heart Pound/FAIRY/PHYSICAL/96  →  Psychic/PSYCHIC/SPECIAL/90
  Healing Wish/PSYCHIC/PHYSICAL/56  →  Dream Eater/PSYCHIC/SPECIAL/100

### 281 Kirlia
  Charm/FAIRY/PHYSICAL/56  →  Confusion/PSYCHIC/SPECIAL/50
  Dazzling Gleam/FAIRY/PHYSICAL/56  →  Disarming Voice/FAIRY/SPECIAL/1
  Instant Teleportation/PSYCHIC/SPECIAL/10  →  Draining Kiss/FAIRY/SPECIAL/50
  Confusion/PSYCHIC/SPECIAL/80  →  Psybeam/PSYCHIC/SPECIAL/65
  Heart Pound/FAIRY/PHYSICAL/96  →  Psychic/PSYCHIC/SPECIAL/90
  Healing Wish/PSYCHIC/PHYSICAL/56  →  Dream Eater/PSYCHIC/SPECIAL/100
  Draining Kiss/FAIRY/PHYSICAL/56  →  Future Sight/PSYCHIC/SPECIAL/120

### 282 Gardevoir
  Charm/FAIRY/PHYSICAL/56  →  Confusion/PSYCHIC/SPECIAL/50
  Dazzling Gleam/FAIRY/PHYSICAL/56  →  Disarming Voice/FAIRY/SPECIAL/1
  Instant Teleportation/PSYCHIC/SPECIAL/10  →  Draining Kiss/FAIRY/SPECIAL/50
  Confusion/PSYCHIC/SPECIAL/80  →  Psybeam/PSYCHIC/SPECIAL/65
  Psychic/PSYCHIC/SPECIAL/96  →  Psychic/PSYCHIC/SPECIAL/90
  Stored Power/PSYCHIC/SPECIAL/120  →  Moonblast/FAIRY/SPECIAL/95
  Healing Wish/PSYCHIC/PHYSICAL/56  →  Dream Eater/PSYCHIC/SPECIAL/100
  Moonblast/FAIRY/SPECIAL/95  →  Future Sight/PSYCHIC/SPECIAL/120

### 287 Slakoth
  Yawn/NORMAL/PHYSICAL/56  →  Scratch/NORMAL/PHYSICAL/40
  Scratch/NORMAL/PHYSICAL/56  →  Headbutt/NORMAL/PHYSICAL/70
  Hammer Arm/FIGHTING/PHYSICAL/120  →  Covet/NORMAL/PHYSICAL/60
  Fury Swipes/NORMAL/PHYSICAL/96  →  Flail/NORMAL/PHYSICAL/96
  Focus Punch/FIGHTING/PHYSICAL/56  →  Take Down/NORMAL/PHYSICAL/90
  Focus Blast/FIGHTING/SPECIAL/96  →  Facade/NORMAL/PHYSICAL/70
  Slack Off/NORMAL/PHYSICAL/10  →  False Swipe/NORMAL/PHYSICAL/40

### 288 Vigoroth
  Yawn/NORMAL/PHYSICAL/56  →  Scratch/NORMAL/PHYSICAL/40
  Scratch/NORMAL/PHYSICAL/56  →  Uproar/NORMAL/SPECIAL/90
  Feint Attack/DARK/PHYSICAL/80  →  Fury Swipes/NORMAL/PHYSICAL/18
  Fury Swipes/NORMAL/PHYSICAL/96  →  Slash/NORMAL/PHYSICAL/70
  Dynamic Punch/FIGHTING/PHYSICAL/120  →  Take Down/NORMAL/PHYSICAL/90
  Reversal/FIGHTING/PHYSICAL/100  →  Facade/NORMAL/PHYSICAL/70
  Focus Energy/NORMAL/PHYSICAL/10  →  False Swipe/NORMAL/PHYSICAL/40
  Vital Spirit/ELECTRIC/PHYSICAL/56  →  Body Slam/NORMAL/PHYSICAL/85

### 289 Slaking
  Scratch/NORMAL/PHYSICAL/72  →  Scratch/NORMAL/PHYSICAL/40
  Fury Swipes/NORMAL/PHYSICAL/96  →  Covet/NORMAL/PHYSICAL/60
  Rock Slide/ROCK/PHYSICAL/96  →  Flail/NORMAL/PHYSICAL/96
  Sucker Punch/DARK/PHYSICAL/120  →  Mega Kick/NORMAL/PHYSICAL/120
  Giga Impact/NORMAL/PHYSICAL/120  →  Take Down/NORMAL/PHYSICAL/90
  Earthquake/GROUND/PHYSICAL/140  →  Facade/NORMAL/PHYSICAL/70

### 293 Whismur
  Bite/DARK/PHYSICAL/72  →  Pound/NORMAL/PHYSICAL/40
  Pound/NORMAL/PHYSICAL/40  →  Echoed Voice/NORMAL/SPECIAL/40
  Super Sonic/NORMAL/PHYSICAL/56  →  Stomp/NORMAL/PHYSICAL/65
  Echoed Voice/NORMAL/SPECIAL/64  →  Uproar/NORMAL/SPECIAL/90
  Hyper Voice/NORMAL/SPECIAL/120  →  Hyper Voice/NORMAL/SPECIAL/90

### 294 Loudred
  Bite/DARK/PHYSICAL/72  →  Echoed Voice/NORMAL/SPECIAL/40
  Crunch/DARK/PHYSICAL/72  →  Pound/NORMAL/PHYSICAL/40
  Super Sonic/NORMAL/PHYSICAL/56  →  Stomp/NORMAL/PHYSICAL/65
  Echoed Voice/NORMAL/SPECIAL/64  →  Uproar/NORMAL/SPECIAL/90
  Hyper Voice/NORMAL/SPECIAL/120  →  Hyper Voice/NORMAL/SPECIAL/90
  Hyper Beam/NORMAL/SPECIAL/120  →  Facade/NORMAL/PHYSICAL/70

### 295 Exploud
  Bite/DARK/PHYSICAL/72  →  Echoed Voice/NORMAL/SPECIAL/40
  Crunch/DARK/PHYSICAL/72  →  Pound/NORMAL/PHYSICAL/40
  Fire Fang/FIRE/SPECIAL/56  →  Stomp/NORMAL/PHYSICAL/65
  Take Down/NORMAL/PHYSICAL/100  →  Uproar/NORMAL/SPECIAL/90
  Boomburst/NORMAL/SPECIAL/160  →  Hyper Voice/NORMAL/SPECIAL/90
  Echoed Voice/NORMAL/SPECIAL/64  →  Boomburst/NORMAL/SPECIAL/140
  Hyper Voice/NORMAL/SPECIAL/120  →  Hyper Beam/NORMAL/SPECIAL/150
  Hyper Beam/NORMAL/SPECIAL/120  →  Facade/NORMAL/PHYSICAL/70

### 296 Makuhita
  Tackle/NORMAL/PHYSICAL/56  →  Arm Thrust/FIGHTING/PHYSICAL/15
  Low Kick/FIGHTING/PHYSICAL/80  →  Force Palm/FIGHTING/PHYSICAL/60
  Leap Strike/FIGHTING/PHYSICAL/100  →  Seismic Toss/FIGHTING/PHYSICAL/100
  Cross Chop/FIGHTING/PHYSICAL/56  →  Focus Punch/FIGHTING/PHYSICAL/150
  Close Combat/FIGHTING/PHYSICAL/56  →  Close Combat/FIGHTING/PHYSICAL/120
  Arm Thrust/FIGHTING/PHYSICAL/120  →  Reversal/FIGHTING/PHYSICAL/120
  Smelling Salts/NORMAL/PHYSICAL/80  →  Low Kick/FIGHTING/PHYSICAL/80
  + Low Sweep/FIGHTING/PHYSICAL/65  (slot novo · cd 36000 · lv 36)
  + Brick Break/FIGHTING/PHYSICAL/75  (slot novo · cd 42000 · lv 44)
  + Drain Punch/FIGHTING/PHYSICAL/75  (slot novo · cd 50000 · lv 52)

### 302 Sableye
  Fury Swipes/NORMAL/PHYSICAL/96  →  Astonish/GHOST/PHYSICAL/30
  Shadow Ball/GHOST/SPECIAL/56  →  Shadow Sneak/GHOST/PHYSICAL/40
  Shadow Sphere/GHOST/SPECIAL/100  →  Night Shade/GHOST/SPECIAL/100
  Feint Attack/DARK/PHYSICAL/80  →  Knock Off/DARK/PHYSICAL/65
  Night Shade/GHOST/PHYSICAL/56  →  Shadow Claw/GHOST/PHYSICAL/70
  Shadow Claw/GHOST/PHYSICAL/144  →  Shadow Ball/GHOST/SPECIAL/80
  Shadow Sneak/GHOST/PHYSICAL/40  →  Foul Play/DARK/PHYSICAL/95
  Recover/NORMAL/PHYSICAL/160  →  Night Slash/DARK/PHYSICAL/70

### 303 Mawile
  Iron Head/STEEL/PHYSICAL/80  →  Fairy Wind/FAIRY/SPECIAL/40
  Knock Off/DARK/PHYSICAL/90  →  Iron Head/STEEL/PHYSICAL/80
  Play Rough/FAIRY/PHYSICAL/72  →  Play Rough/FAIRY/PHYSICAL/90
  Bite/DARK/PHYSICAL/72  →  Draining Kiss/FAIRY/SPECIAL/50
  Fire Fang/FIRE/SPECIAL/56  →  Flash Cannon/STEEL/SPECIAL/80
  Sucker Punch/DARK/PHYSICAL/120  →  Dazzling Gleam/FAIRY/SPECIAL/80
  Fairy Wind/FAIRY/SPECIAL/40  →  Steel Beam/STEEL/SPECIAL/140
  Swords Dance/NORMAL/PHYSICAL/56  →  Astonish/GHOST/PHYSICAL/30
  Fake Tears/DARK/SPECIAL/10  →  Bite/DARK/PHYSICAL/60

### 304 Aron
  Iron Head/STEEL/PHYSICAL/80  →  Metal Claw/STEEL/PHYSICAL/50
  Iron Tail/STEEL/PHYSICAL/56  →  Rock Tomb/ROCK/PHYSICAL/60
  Metal Burst/STEEL/PHYSICAL/120  →  Rock Slide/ROCK/PHYSICAL/75
  Stone Edge/ROCK/PHYSICAL/56  →  Iron Head/STEEL/PHYSICAL/80
  Metal Claw/STEEL/PHYSICAL/56  →  Iron Tail/STEEL/PHYSICAL/100
  Harden/NORMAL/PHYSICAL/10  →  Heavy Slam/STEEL/PHYSICAL/40

### 305 Lairon
  Iron Head/STEEL/PHYSICAL/80  →  Metal Claw/STEEL/PHYSICAL/50
  Iron Tail/STEEL/PHYSICAL/56  →  Rock Tomb/ROCK/PHYSICAL/60
  Metal Burst/STEEL/PHYSICAL/120  →  Rock Slide/ROCK/PHYSICAL/75
  Stone Edge/ROCK/PHYSICAL/56  →  Iron Head/STEEL/PHYSICAL/80
  Metal Claw/STEEL/PHYSICAL/56  →  Iron Tail/STEEL/PHYSICAL/100
  Meteor Mash/STEEL/PHYSICAL/140  →  Heavy Slam/STEEL/PHYSICAL/120
  Flash Cannon/STEEL/SPECIAL/80  →  Metal Burst/STEEL/PHYSICAL/80
  Protect/NORMAL/PHYSICAL/10  →  Head Smash/ROCK/PHYSICAL/150
  Sandstorm/ROCK/SPECIAL/160  →  Stone Edge/ROCK/PHYSICAL/100

### 306 Aggron
  Iron Head/STEEL/PHYSICAL/80  →  Metal Claw/STEEL/PHYSICAL/50
  Iron Tail/STEEL/PHYSICAL/56  →  Rock Tomb/ROCK/PHYSICAL/60
  Metal Burst/STEEL/PHYSICAL/120  →  Rock Slide/ROCK/PHYSICAL/75
  Stone Edge/ROCK/PHYSICAL/56  →  Iron Head/STEEL/PHYSICAL/80
  Metal Claw/STEEL/PHYSICAL/56  →  Iron Tail/STEEL/PHYSICAL/100
  Meteor Mash/STEEL/PHYSICAL/140  →  Heavy Slam/STEEL/PHYSICAL/120
  Flash Cannon/STEEL/SPECIAL/80  →  Metal Burst/STEEL/PHYSICAL/80
  Harden/NORMAL/PHYSICAL/10  →  Head Smash/ROCK/PHYSICAL/150
  Sandstorm/ROCK/SPECIAL/160  →  Stone Edge/ROCK/PHYSICAL/100

### 307 Meditite
  Low Kick/FIGHTING/PHYSICAL/80  →  Confusion/PSYCHIC/SPECIAL/50
  Mega Kick/FIGHTING/PHYSICAL/96  →  Force Palm/FIGHTING/PHYSICAL/60
  Drain Punch/FIGHTING/PHYSICAL/100  →  Psybeam/PSYCHIC/SPECIAL/65
  Confusion/PSYCHIC/SPECIAL/80  →  Zen Headbutt/PSYCHIC/PHYSICAL/80
  Psychic/PSYCHIC/SPECIAL/96  →  High Jump Kick/FIGHTING/PHYSICAL/130
  High Jump Kick/FIGHTING/PHYSICAL/140  →  Reversal/FIGHTING/PHYSICAL/120
  + Counter/FIGHTING/PHYSICAL/70  (slot novo · cd 30000 · lv 28)
  + Rock Smash/FIGHTING/PHYSICAL/40  (slot novo · cd 36000 · lv 36)
  + Dynamic Punch/FIGHTING/PHYSICAL/100  (slot novo · cd 42000 · lv 44)
  + Psyshock/PSYCHIC/SPECIAL/80  (slot novo · cd 50000 · lv 52)

### 308 Medicham
  Low Kick/FIGHTING/PHYSICAL/80  →  Confusion/PSYCHIC/SPECIAL/50
  Thunder Punch/ELECTRIC/SPECIAL/56  →  Force Palm/FIGHTING/PHYSICAL/60
  Zen Headbutt/PSYCHIC/PHYSICAL/80  →  Psybeam/PSYCHIC/SPECIAL/65
  Low Sweep/FIGHTING/PHYSICAL/80  →  Zen Headbutt/PSYCHIC/PHYSICAL/80
  Psychic/PSYCHIC/SPECIAL/96  →  High Jump Kick/FIGHTING/PHYSICAL/130
  High Jump Kick/FIGHTING/PHYSICAL/140  →  Axe Kick/FIGHTING/PHYSICAL/120
  Meditate/PSYCHIC/SPECIAL/10  →  Counter/FIGHTING/PHYSICAL/40
  Focus Energy/NORMAL/PHYSICAL/10  →  Rock Smash/FIGHTING/PHYSICAL/40
  + Dynamic Punch/FIGHTING/PHYSICAL/100  (slot novo · cd 42000 · lv 44)
  + Psyshock/PSYCHIC/SPECIAL/80  (slot novo · cd 50000 · lv 52)

### 309 Electrike
  Swift/NORMAL/PHYSICAL/72  →  Shock Wave/ELECTRIC/SPECIAL/16
  Bite/DARK/PHYSICAL/72  →  Thunder Fang/ELECTRIC/PHYSICAL/65
  Thunder Wave/ELECTRIC/SPECIAL/120  →  Discharge/ELECTRIC/SPECIAL/80
  Spark/ELECTRIC/PHYSICAL/96  →  Wild Charge/ELECTRIC/PHYSICAL/90
  Thunder Fang/ELECTRIC/PHYSICAL/80  →  Thunder/ELECTRIC/SPECIAL/110
  Thunder/ELECTRIC/SPECIAL/96  →  Thunder Shock/ELECTRIC/SPECIAL/40
  Charge/NORMAL/PHYSICAL/10  →  Spark/ELECTRIC/PHYSICAL/65

### 310 Manectric
  Quick Attack/NORMAL/PHYSICAL/56  →  Shock Wave/ELECTRIC/SPECIAL/16
  Spark/ELECTRIC/PHYSICAL/96  →  Thunder Fang/ELECTRIC/PHYSICAL/65
  Bite/DARK/PHYSICAL/72  →  Discharge/ELECTRIC/SPECIAL/80
  Thunder Fang/ELECTRIC/PHYSICAL/80  →  Wild Charge/ELECTRIC/PHYSICAL/90
  Thunderbolt/ELECTRIC/SPECIAL/72  →  Thunder/ELECTRIC/SPECIAL/110
  Discharge/ELECTRIC/SPECIAL/120  →  Thunder Shock/ELECTRIC/SPECIAL/40
  Thunder/ELECTRIC/SPECIAL/96  →  Spark/ELECTRIC/PHYSICAL/65
  Agility/PSYCHIC/PHYSICAL/10  →  Thunderbolt/ELECTRIC/SPECIAL/90

### 322 Numel
  Volcano Shot/FIRE/SPECIAL/120  →  Ember/FIRE/SPECIAL/40
  Ember/FIRE/SPECIAL/80  →  Bulldoze/GROUND/PHYSICAL/60
  Rock Slide/ROCK/PHYSICAL/120  →  Incinerate/FIRE/SPECIAL/60
  Flame Burst/FIRE/SPECIAL/120  →  Lava Plume/FIRE/SPECIAL/80
  Lava Plume/FIRE/PHYSICAL/120  →  Earth Power/GROUND/SPECIAL/90
  Scary Face/NORMAL/PHYSICAL/10  →  Earthquake/GROUND/PHYSICAL/100

### 323 Camerupt
  Volcano Shot/FIRE/SPECIAL/120  →  Ember/FIRE/SPECIAL/40
  Ember/FIRE/SPECIAL/80  →  Eruption/FIRE/SPECIAL/150
  Mud Bomb/GROUND/SPECIAL/56  →  Fissure/GROUND/PHYSICAL/56
  Flame Burst/FIRE/SPECIAL/120  →  Bulldoze/GROUND/PHYSICAL/60
  Lava Plume/FIRE/PHYSICAL/120  →  Incinerate/FIRE/SPECIAL/60
  Fire Blast/FIRE/SPECIAL/160  →  Lava Plume/FIRE/SPECIAL/80
  Eruption/FIRE/PHYSICAL/120  →  Earth Power/GROUND/SPECIAL/90
  Scary Face/NORMAL/PHYSICAL/10  →  Earthquake/GROUND/PHYSICAL/100

### 324 Torkoal
  Ember/FIRE/SPECIAL/80  →  Ember/FIRE/SPECIAL/40
  Flamethrower/FIRE/SPECIAL/80  →  Flame Wheel/FIRE/PHYSICAL/60
  Withdraw/WATER/PHYSICAL/10  →  Lava Plume/FIRE/SPECIAL/80
  Smokescreen/NORMAL/PHYSICAL/56  →  Flamethrower/FIRE/SPECIAL/90
  White Smoke/FIRE/SPECIAL/10  →  Heat Wave/FIRE/SPECIAL/95
  Eruption/FIRE/PHYSICAL/120  →  Inferno/FIRE/SPECIAL/100
  Lava Plume/FIRE/PHYSICAL/120  →  Eruption/FIRE/SPECIAL/150
  Heat Wave/FIRE/SPECIAL/56  →  Fire Spin/FIRE/SPECIAL/35
  Heatzone/FIRE/SPECIAL/140  →  Flame Charge/FIRE/PHYSICAL/50
  Drought/FIRE/SPECIAL/10  →  Fire Blast/FIRE/SPECIAL/110

### 325 Spoink
  Headbutt/NORMAL/PHYSICAL/80  →  Confusion/PSYCHIC/SPECIAL/50
  Psywave/PSYCHIC/SPECIAL/56  →  Psybeam/PSYCHIC/SPECIAL/65
  Psy Pulse/PSYCHIC/SPECIAL/96  →  Psyshock/PSYCHIC/SPECIAL/80
  Psychic/PSYCHIC/SPECIAL/96  →  Psychic/PSYCHIC/SPECIAL/90
  Confuse Ray/GHOST/SPECIAL/56  →  Future Sight/PSYCHIC/SPECIAL/120
  Magic Coat/PSYCHIC/PHYSICAL/56  →  Zen Headbutt/PSYCHIC/PHYSICAL/80

### 326 Grumpig
  Headbutt/NORMAL/PHYSICAL/80  →  Confusion/PSYCHIC/SPECIAL/50
  Shadow Ball/GHOST/SPECIAL/56  →  Psybeam/PSYCHIC/SPECIAL/65
  Power Gem/ROCK/SPECIAL/80  →  Zen Headbutt/PSYCHIC/PHYSICAL/80
  Teeter Dance/NORMAL/SPECIAL/56  →  Psyshock/PSYCHIC/SPECIAL/80
  Psychic/PSYCHIC/SPECIAL/96  →  Psychic/PSYCHIC/SPECIAL/90
  Payback/DARK/PHYSICAL/100  →  Future Sight/PSYCHIC/SPECIAL/120
  Bulldoze/GROUND/PHYSICAL/200  →  Dream Eater/PSYCHIC/SPECIAL/100
  Calm Mind/PSYCHIC/PHYSICAL/56  →  Stored Power/PSYCHIC/SPECIAL/20
  Magic Coat/PSYCHIC/PHYSICAL/56  →  Expanding Force/PSYCHIC/SPECIAL/80

### 328 Trapinch
  Sand Attack/GROUND/PHYSICAL/56  →  Mud-Slap/GROUND/SPECIAL/20
  Bite/DARK/PHYSICAL/72  →  Sand Tomb/GROUND/PHYSICAL/35
  Mud Shot/GROUND/PHYSICAL/72  →  Bulldoze/GROUND/PHYSICAL/60
  Mud-Slap/GROUND/PHYSICAL/56  →  Dig/GROUND/PHYSICAL/80
  Dig/GROUND/PHYSICAL/40  →  Earth Power/GROUND/SPECIAL/90
  Earth Power/GROUND/PHYSICAL/120  →  Earthquake/GROUND/PHYSICAL/100

### 329 Vibrava
  Super Sonic/NORMAL/PHYSICAL/56  →  Dig/GROUND/PHYSICAL/80
  Sand Attack/GROUND/PHYSICAL/56  →  Mud-Slap/GROUND/SPECIAL/20
  Sand Tomb/GROUND/PHYSICAL/120  →  Sand Tomb/GROUND/PHYSICAL/35
  Bulldoze/GROUND/PHYSICAL/200  →  Dragon Tail/DRAGON/PHYSICAL/60
  Earthquake/GROUND/PHYSICAL/56  →  Earth Power/GROUND/SPECIAL/90

### 330 Flygon
  Super Sonic/NORMAL/PHYSICAL/56  →  Bulldoze/GROUND/PHYSICAL/60
  Sand Attack/GROUND/PHYSICAL/56  →  Dragon Breath/DRAGON/SPECIAL/60
  Sand Tomb/GROUND/PHYSICAL/120  →  Mud-Slap/GROUND/SPECIAL/20
  Dragon Flight/DRAGON/PHYSICAL/56  →  Sand Tomb/GROUND/PHYSICAL/35
  Bulldoze/GROUND/PHYSICAL/200  →  Dragon Tail/DRAGON/PHYSICAL/60
  Fissure/GROUND/PHYSICAL/120  →  Earth Power/GROUND/SPECIAL/90
  Hyper Beam/NORMAL/SPECIAL/120  →  Earthquake/GROUND/PHYSICAL/100
  Earthquake/GROUND/PHYSICAL/56  →  Dragon Rush/DRAGON/PHYSICAL/100
  Sandstorm/ROCK/SPECIAL/160  →  Mud Shot/GROUND/SPECIAL/55
  Screech/NORMAL/PHYSICAL/56  →  Dig/GROUND/PHYSICAL/80

### 332 Cacturne
  Dark Pulse/DARK/SPECIAL/120  →  Absorb/GRASS/SPECIAL/20
  Sucker Punch/DARK/PHYSICAL/120  →  Bullet Seed/GRASS/PHYSICAL/25
  Foul Play/DARK/PHYSICAL/120  →  Power Trip/DARK/PHYSICAL/20
  Needle Arm/GRASS/PHYSICAL/80  →  Payback/DARK/PHYSICAL/50
  Payback/DARK/PHYSICAL/100  →  Sucker Punch/DARK/PHYSICAL/70
  Shadow Blast/GHOST/SPECIAL/120  →  Energy Ball/GRASS/SPECIAL/90
  Grass Whistle/GRASS/SPECIAL/10  →  Thief/DARK/PHYSICAL/60
  Spiky Shield/GRASS/PHYSICAL/10  →  Trailblaze/GRASS/PHYSICAL/50
  Sandstorm/ROCK/SPECIAL/160  →  Magical Leaf/GRASS/SPECIAL/120
  Nasty Plot/DARK/PHYSICAL/120  →  Fling/DARK/PHYSICAL/120

### 333 Swablu
  Peck/FLYING/PHYSICAL/56  →  Peck/FLYING/PHYSICAL/35
  Pluck/FLYING/PHYSICAL/96  →  Fury Attack/NORMAL/PHYSICAL/15
  Sing/NORMAL/PHYSICAL/10  →  Round/NORMAL/SPECIAL/60
  Dragon Breath/DRAGON/SPECIAL/120  →  Take Down/NORMAL/PHYSICAL/90
  Dragon Mist/DRAGON/SPECIAL/80  →  Brave Bird/FLYING/PHYSICAL/120
  Dragon Pulse/DRAGON/SPECIAL/56  →  Aerial Ace/FLYING/PHYSICAL/56
  Roost/FLYING/PHYSICAL/160  →  Swift/NORMAL/SPECIAL/120
  Tailwind/FLYING/SPECIAL/10  →  Body Slam/NORMAL/PHYSICAL/85

### 334 Altaria
  Attract/NORMAL/PHYSICAL/10  →  Peck/FLYING/PHYSICAL/35
  Pluck/FLYING/PHYSICAL/96  →  Pluck/FLYING/PHYSICAL/60
  Sing/NORMAL/PHYSICAL/10  →  Dragon Breath/DRAGON/SPECIAL/60
  Dragon Breath/DRAGON/SPECIAL/120  →  Sky Attack/FLYING/PHYSICAL/140
  Dragon Mist/DRAGON/SPECIAL/80  →  Twister/DRAGON/SPECIAL/40
  Sky Attack/FLYING/PHYSICAL/120  →  Brave Bird/FLYING/PHYSICAL/120
  Roost/FLYING/PHYSICAL/160  →  Dragon Rush/DRAGON/PHYSICAL/100
  Tailwind/FLYING/SPECIAL/10  →  Dragon Claw/DRAGON/PHYSICAL/80
  Mirror Move/NORMAL/STATUS/0  →  Aerial Ace/FLYING/PHYSICAL/70

### 335 Zangoose
  Scratch/NORMAL/PHYSICAL/56  →  Scratch/NORMAL/PHYSICAL/40
  Slash/NORMAL/PHYSICAL/72  →  Quick Attack/NORMAL/PHYSICAL/40
  Mud-Slap/GROUND/PHYSICAL/56  →  Slash/NORMAL/PHYSICAL/70
  Dig/GROUND/PHYSICAL/40  →  Crush Claw/NORMAL/PHYSICAL/75
  Crush Claw/NEUTRAL/PHYSICAL/80  →  False Swipe/NORMAL/PHYSICAL/40
  Pursuit/DARK/PHYSICAL/120  →  Tackle/NORMAL/PHYSICAL/40
  Fury Swipes/NORMAL/PHYSICAL/96  →  Headbutt/NORMAL/PHYSICAL/70
  Shadow Claw/GHOST/PHYSICAL/144  →  Swift/NORMAL/SPECIAL/120
  Swords Dance/NORMAL/PHYSICAL/56  →  Body Slam/NORMAL/PHYSICAL/85
  Taunt/DARK/PHYSICAL/10  →  Hyper Beam/NORMAL/SPECIAL/150

### 336 Seviper
  Poison Fang/POISON/PHYSICAL/56  →  Poison Tail/POISON/PHYSICAL/50
  Iron Tail/STEEL/PHYSICAL/56  →  Poison Fang/POISON/PHYSICAL/50
  Bite/DARK/PHYSICAL/72  →  Venoshock/POISON/SPECIAL/65
  Acid/POISON/SPECIAL/56  →  Poison Jab/POISON/PHYSICAL/80
  Toxic/POISON/PHYSICAL/120  →  Belch/POISON/SPECIAL/120
  Poison Tail/POISON/PHYSICAL/96  →  Sludge Bomb/POISON/SPECIAL/90
  Venomous Gale/POISON/SPECIAL/140  →  Gunk Shot/POISON/PHYSICAL/120
  Acid Rain/POISON/SPECIAL/120  →  Acid Spray/POISON/SPECIAL/40

### 341 Corphish
  Bubble/WATER/SPECIAL/40  →  Water Gun/WATER/SPECIAL/40
  Bubble Beam/WATER/SPECIAL/80  →  Bubble Beam/WATER/SPECIAL/65
  Dark Pulse/DARK/SPECIAL/120  →  Razor Shell/WATER/PHYSICAL/75
  Crabhammer/WATER/PHYSICAL/96  →  Crabhammer/WATER/PHYSICAL/100
  Night Slash/DARK/PHYSICAL/120  →  Water Pulse/WATER/SPECIAL/60
  Harden/NORMAL/PHYSICAL/10  →  Chilling Water/WATER/SPECIAL/50
  Swords Dance/NORMAL/PHYSICAL/56  →  Waterfall/WATER/PHYSICAL/80

### 342 Crawdaunt
  Hone Claws/DARK/PHYSICAL/10  →  Water Gun/WATER/SPECIAL/40
  Bubble Beam/WATER/SPECIAL/80  →  Bubble Beam/WATER/SPECIAL/65
  Crunch/DARK/PHYSICAL/72  →  Knock Off/DARK/PHYSICAL/65
  Crabhammer/WATER/PHYSICAL/96  →  Night Slash/DARK/PHYSICAL/70
  Void Sphere/DARK/SPECIAL/120  →  Razor Shell/WATER/PHYSICAL/75
  Night Slash/DARK/PHYSICAL/120  →  Crunch/DARK/PHYSICAL/80
  Payback/DARK/PHYSICAL/100  →  Crabhammer/WATER/PHYSICAL/100
  Protect/NORMAL/PHYSICAL/10  →  Water Pulse/WATER/SPECIAL/60

### 343 Baltoy
  Mud-Slap/GROUND/PHYSICAL/56  →  Mud-Slap/GROUND/SPECIAL/20
  Extrasensory/PSYCHIC/SPECIAL/100  →  Confusion/PSYCHIC/SPECIAL/50
  Psybeam/PSYCHIC/SPECIAL/56  →  Psybeam/PSYCHIC/SPECIAL/65
  Psychic/PSYCHIC/SPECIAL/96  →  Extrasensory/PSYCHIC/SPECIAL/80
  Earth Power/GROUND/PHYSICAL/120  →  Earth Power/GROUND/SPECIAL/90
  Guard Split/PSYCHIC/SPECIAL/10  →  Earthquake/GROUND/PHYSICAL/100

### 344 Claydol
  Mud Sport/GROUND/PHYSICAL/10  →  Confusion/PSYCHIC/SPECIAL/50
  Extrasensory/PSYCHIC/SPECIAL/100  →  Mud-Slap/GROUND/SPECIAL/20
  Psybeam/PSYCHIC/SPECIAL/56  →  Psybeam/PSYCHIC/SPECIAL/65
  Psychic/PSYCHIC/SPECIAL/96  →  Extrasensory/PSYCHIC/SPECIAL/80
  Earth Power/GROUND/PHYSICAL/120  →  Earth Power/GROUND/SPECIAL/90
  Earthquake/GROUND/PHYSICAL/56  →  Earthquake/GROUND/PHYSICAL/100
  Sandstorm/ROCK/SPECIAL/160  →  Dig/GROUND/PHYSICAL/80
  Heal Block/PSYCHIC/SPECIAL/10  →  Psychic/PSYCHIC/SPECIAL/90
  Guard Split/PSYCHIC/SPECIAL/10  →  Bulldoze/GROUND/PHYSICAL/60
  Protect/NORMAL/PHYSICAL/10  →  Dream Eater/PSYCHIC/SPECIAL/100

### 349 Feebas
  Tackle/NORMAL/PHYSICAL/72  →  Water Pulse/WATER/SPECIAL/60

### 350 Milotic
  Aqua Tail/WATER/PHYSICAL/72  →  Water Gun/WATER/SPECIAL/40
  Water Gun/WATER/SPECIAL/96  →  Aqua Tail/WATER/PHYSICAL/90
  Water Pulse/WATER/SPECIAL/96  →  Surf/WATER/SPECIAL/90
  Twister/DRAGON/SPECIAL/120  →  Hydro Pump/WATER/SPECIAL/110
  Waterfall/WATER/PHYSICAL/120  →  Whirlpool/WATER/SPECIAL/35
  Hydro Pump/WATER/SPECIAL/140  →  Flip Turn/WATER/PHYSICAL/60

### 354 Banette
  Shadow Ball/GHOST/SPECIAL/56  →  Night Shade/GHOST/SPECIAL/56
  Shadow Sphere/GHOST/SPECIAL/100  →  Shadow Sneak/GHOST/PHYSICAL/40
  Shadow Punch/GHOST/PHYSICAL/56  →  Hex/GHOST/SPECIAL/65
  Ominous Wind/GHOST/SPECIAL/80  →  Shadow Ball/GHOST/SPECIAL/80
  Astonish/GHOST/PHYSICAL/136  →  Phantom Force/GHOST/PHYSICAL/90
  Shadow Claw/GHOST/PHYSICAL/144  →  Lick/GHOST/PHYSICAL/30
  Shadow Storm/GHOST/SPECIAL/200  →  Shadow Claw/GHOST/PHYSICAL/70
  Torment/DARK/PHYSICAL/56  →  Shadow Punch/GHOST/PHYSICAL/56
  Dark Accurate/GHOST/PHYSICAL/56  →  Ominous Wind/GHOST/SPECIAL/60

### 355 Duskull
  Shadow Ball/GHOST/SPECIAL/56  →  Astonish/GHOST/PHYSICAL/30
  Ominous Wind/GHOST/SPECIAL/80  →  Shadow Sneak/GHOST/PHYSICAL/40
  Night Shade/GHOST/PHYSICAL/56  →  Night Shade/GHOST/SPECIAL/56
  Confuse Ray/GHOST/SPECIAL/56  →  Hex/GHOST/SPECIAL/65
  Astonish/GHOST/PHYSICAL/136  →  Shadow Ball/GHOST/SPECIAL/80

### 356 Dusclops
  Curse/NEUTRAL/SPECIAL/56  →  Astonish/GHOST/PHYSICAL/30
  Shadow Ball/GHOST/SPECIAL/56  →  Shadow Sneak/GHOST/PHYSICAL/40
  Shadow Punch/GHOST/PHYSICAL/56  →  Night Shade/GHOST/SPECIAL/56
  Ominous Wind/GHOST/SPECIAL/80  →  Hex/GHOST/SPECIAL/65
  Hollow Wind/DARK/SPECIAL/80  →  Shadow Ball/GHOST/SPECIAL/80
  Hex/GHOST/SPECIAL/100  →  Phantom Force/GHOST/PHYSICAL/90
  Shadow Blast/GHOST/SPECIAL/120  →  Poltergeist/GHOST/PHYSICAL/110
  Confide/NORMAL/PHYSICAL/56  →  Bind/NORMAL/PHYSICAL/15
  Dark Accurate/GHOST/PHYSICAL/56  →  Fire Punch/FIRE/PHYSICAL/75

### 357 Tropius
  Body Slam/NORMAL/PHYSICAL/72  →  Gust/FLYING/SPECIAL/40
  Razor Leaf/GRASS/SPECIAL/56  →  Leaf Storm/GRASS/SPECIAL/130
  Magical Leaf/GRASS/PHYSICAL/96  →  Razor Leaf/GRASS/PHYSICAL/55
  Leafage/GRASS/SPECIAL/56  →  Magical Leaf/GRASS/SPECIAL/16
  Stomp/NORMAL/PHYSICAL/80  →  Air Slash/FLYING/SPECIAL/75
  Leaf Tornado/GRASS/PHYSICAL/120  →  Solar Beam/GRASS/SPECIAL/120
  Leaf Storm/GRASS/SPECIAL/160  →  Trailblaze/GRASS/PHYSICAL/50
  Growth/NORMAL/PHYSICAL/56  →  Aerial Ace/FLYING/PHYSICAL/56

### 359 Absol
  Quick Attack/NORMAL/PHYSICAL/56  →  Knock Off/DARK/PHYSICAL/65
  Knock Off/DARK/PHYSICAL/90  →  Night Slash/DARK/PHYSICAL/70
  Pursuit/DARK/PHYSICAL/120  →  Sucker Punch/DARK/PHYSICAL/70
  Foul Play/DARK/PHYSICAL/120  →  Dark Pulse/DARK/SPECIAL/80
  Night Slash/DARK/PHYSICAL/120  →  Thief/DARK/PHYSICAL/60
  Sucker Punch/DARK/PHYSICAL/120  →  Payback/DARK/PHYSICAL/50
  Razor Wind/NORMAL/SPECIAL/100  →  Snarl/DARK/SPECIAL/55
  Assurance/DARK/PHYSICAL/80  →  Quick Attack/NORMAL/PHYSICAL/40
  Swords Dance/NORMAL/PHYSICAL/56  →  Slash/NORMAL/PHYSICAL/70
  Taunt/DARK/PHYSICAL/10  →  Future Sight/PSYCHIC/SPECIAL/120

### 361 Snorunt
  Bite/DARK/PHYSICAL/72  →  Powder Snow/ICE/SPECIAL/40
  Ice Shards/ICE/PHYSICAL/56  →  Ice Shard/ICE/PHYSICAL/40
  Ice Fang/ICE/PHYSICAL/80  →  Icy Wind/ICE/SPECIAL/55
  Ice Wind/ICE/PHYSICAL/56  →  Frost Breath/ICE/SPECIAL/60
  Ice Beam/ICE/SPECIAL/96  →  Ice Fang/ICE/PHYSICAL/65
  Frost Power/ICE/PHYSICAL/200  →  Blizzard/ICE/SPECIAL/110

### 362 Glalie
  Bite/DARK/PHYSICAL/72  →  Powder Snow/ICE/SPECIAL/40
  Icy Wind/ICE/PHYSICAL/56  →  Sheer Cold/ICE/SPECIAL/56
  Ice Fang/ICE/PHYSICAL/80  →  Ice Shard/ICE/PHYSICAL/40
  Crunch/DARK/PHYSICAL/72  →  Icy Wind/ICE/SPECIAL/55
  Ice Beam/ICE/SPECIAL/96  →  Frost Breath/ICE/SPECIAL/60
  Ice Ball/ICE/PHYSICAL/80  →  Ice Fang/ICE/PHYSICAL/65
  Blizzard/ICE/PHYSICAL/200  →  Blizzard/ICE/SPECIAL/110
  Hail/ICE/SPECIAL/56  →  Icicle Crash/ICE/PHYSICAL/85

### 363 Spheal
  Ice Shards/ICE/PHYSICAL/56  →  Powder Snow/ICE/SPECIAL/40
  Ice Fang/ICE/PHYSICAL/80  →  Water Pulse/WATER/SPECIAL/60
  Ice Beam/ICE/SPECIAL/96  →  Liquidation/WATER/PHYSICAL/85
  Ice Ball/ICE/PHYSICAL/80  →  Ice Beam/ICE/SPECIAL/90
  Frost Breath/ICE/SPECIAL/120  →  Blizzard/ICE/SPECIAL/110
  Powder Snow/ICE/SPECIAL/120  →  Aqua Tail/WATER/PHYSICAL/90
  Defense Curl/NORMAL/PHYSICAL/10  →  Ice Ball/ICE/PHYSICAL/30

### 364 Sealeo
  Ice Shards/ICE/PHYSICAL/56  →  Powder Snow/ICE/SPECIAL/40
  Ice Fang/ICE/PHYSICAL/80  →  Water Pulse/WATER/SPECIAL/60
  Ice Beam/ICE/SPECIAL/96  →  Liquidation/WATER/PHYSICAL/85
  Ice Ball/ICE/PHYSICAL/80  →  Ice Beam/ICE/SPECIAL/90
  Frost Breath/ICE/SPECIAL/120  →  Blizzard/ICE/SPECIAL/110
  Powder Snow/ICE/SPECIAL/120  →  Aqua Tail/WATER/PHYSICAL/90
  Aurora Beam/ICE/SPECIAL/56  →  Ice Ball/ICE/PHYSICAL/30
  Hail/ICE/SPECIAL/56  →  Icy Wind/ICE/SPECIAL/55
  Defense Curl/NORMAL/PHYSICAL/10  →  Rollout/ROCK/PHYSICAL/30

### 365 Walrein
  Ice Shard/ICE/PHYSICAL/120  →  Powder Snow/ICE/SPECIAL/40
  Ice Fang/ICE/PHYSICAL/80  →  Water Pulse/WATER/SPECIAL/60
  Ice Beam/ICE/SPECIAL/96  →  Liquidation/WATER/PHYSICAL/85
  Ice Ball/ICE/PHYSICAL/80  →  Ice Beam/ICE/SPECIAL/90
  Frost Breath/ICE/SPECIAL/120  →  Blizzard/ICE/SPECIAL/110
  Powder Snow/ICE/SPECIAL/120  →  Aqua Tail/WATER/PHYSICAL/90
  Aurora Beam/ICE/SPECIAL/56  →  Ice Ball/ICE/PHYSICAL/30
  Hail/ICE/SPECIAL/56  →  Ice Fang/ICE/PHYSICAL/65
  Growl/NEUTRAL/PHYSICAL/10  →  Icy Wind/ICE/SPECIAL/55

### 371 Bagon
  Tackle/NORMAL/PHYSICAL/56  →  Dragon Breath/DRAGON/SPECIAL/60
  Headbutt/NORMAL/PHYSICAL/80  →  Dragon Claw/DRAGON/PHYSICAL/80
  Dragon Tail/DRAGON/PHYSICAL/80  →  Outrage/DRAGON/PHYSICAL/120
  Dragon Claw/DRAGON/PHYSICAL/96  →  Draco Meteor/DRAGON/SPECIAL/130
  Dragon Breath/DRAGON/SPECIAL/120  →  Dragon Pulse/DRAGON/SPECIAL/85
  Dragon Pulse/DRAGON/SPECIAL/56  →  Dragon Tail/DRAGON/PHYSICAL/60
  Scary Face/NORMAL/PHYSICAL/10  →  Ember/FIRE/SPECIAL/40

### 372 Shelgon
  Tackle/NORMAL/PHYSICAL/56  →  Dragon Breath/DRAGON/SPECIAL/60
  Headbutt/NORMAL/PHYSICAL/80  →  Dragon Claw/DRAGON/PHYSICAL/80
  Scale Shot/DRAGON/PHYSICAL/56  →  Outrage/DRAGON/PHYSICAL/120
  Dragon Claw/DRAGON/PHYSICAL/96  →  Draco Meteor/DRAGON/SPECIAL/130
  Dragon Breath/DRAGON/SPECIAL/120  →  Dragon Pulse/DRAGON/SPECIAL/85
  Draco Meteor/DRAGON/PHYSICAL/160  →  Dragon Tail/DRAGON/PHYSICAL/60
  Focus Energy/NORMAL/PHYSICAL/10  →  Bite/DARK/PHYSICAL/60
  Protect/NORMAL/PHYSICAL/10  →  Ember/FIRE/SPECIAL/40
  Scary Face/NORMAL/PHYSICAL/10  →  Headbutt/NORMAL/PHYSICAL/70

### 373 Salamence
  Dragon Tail/DRAGON/PHYSICAL/72  →  Dragon Breath/DRAGON/SPECIAL/60
  Flamethrower/FIRE/SPECIAL/96  →  Dragon Tail/DRAGON/PHYSICAL/60
  Scale Shot/DRAGON/PHYSICAL/96  →  Dual Wingbeat/FLYING/PHYSICAL/40
  Dragon Breath/DRAGON/SPECIAL/120  →  Dragon Claw/DRAGON/PHYSICAL/80
  Dragon Pulse/DRAGON/SPECIAL/120  →  Outrage/DRAGON/PHYSICAL/120
  Draco Meteor/DRAGON/SPECIAL/140  →  Air Slash/FLYING/SPECIAL/75

### 374 Beldum
  Psy Pulse/PSYCHIC/SPECIAL/96  →  Zen Headbutt/PSYCHIC/PHYSICAL/80
  Hammer Arm/FIGHTING/PHYSICAL/120  →  Steel Beam/STEEL/SPECIAL/140
  Metal Claw/STEEL/PHYSICAL/56  →  Tackle/NORMAL/PHYSICAL/40
  Psychic/PSYCHIC/SPECIAL/96  →  Headbutt/NORMAL/PHYSICAL/70

### 375 Metang
  Iron Head/STEEL/PHYSICAL/80  →  Bullet Punch/STEEL/PHYSICAL/40
  Psy Pulse/PSYCHIC/SPECIAL/96  →  Zen Headbutt/PSYCHIC/PHYSICAL/80
  Scrap Shot/STEEL/SPECIAL/100  →  Flash Cannon/STEEL/SPECIAL/80
  Metal Claw/STEEL/PHYSICAL/56  →  Psychic/PSYCHIC/SPECIAL/90
  Heavy Slam/STEEL/PHYSICAL/120  →  Meteor Mash/STEEL/PHYSICAL/90
  Gyro Ball/STEEL/SPECIAL/200  →  Psycho Cut/PSYCHIC/PHYSICAL/70
  Meteor Mash/STEEL/PHYSICAL/140  →  Iron Head/STEEL/PHYSICAL/80
  Heavy Metal/STEEL/PHYSICAL/200  →  Psyshock/PSYCHIC/SPECIAL/80

### 376 Metagross
  Psychic Fangs/PSYCHIC/PHYSICAL/72  →  Bullet Punch/STEEL/PHYSICAL/40
  Iron Head/STEEL/PHYSICAL/96  →  Confusion/PSYCHIC/SPECIAL/50
  Psychic/PSYCHIC/SPECIAL/120  →  Metal Claw/STEEL/PHYSICAL/50
  Metal Claw/STEEL/PHYSICAL/120  →  Zen Headbutt/PSYCHIC/PHYSICAL/80
  Meteor Mash/STEEL/PHYSICAL/120  →  Flash Cannon/STEEL/SPECIAL/80
  Flash Cannon/STEEL/SPECIAL/140  →  Psychic/PSYCHIC/SPECIAL/90

### 410 Shieldon
  Iron Head/STEEL/PHYSICAL/96  →  Ancient Power/ROCK/SPECIAL/60
  Rock Slide/ROCK/PHYSICAL/96  →  Metal Burst/STEEL/PHYSICAL/96
  Meteor Mash/STEEL/SPECIAL/120  →  Iron Head/STEEL/PHYSICAL/80
  Rock Blast/ROCK/PHYSICAL/120  →  Rock Tomb/ROCK/PHYSICAL/60
  Rock Wrecker/ROCK/PHYSICAL/140  →  Rock Blast/ROCK/PHYSICAL/25

### 411 Bastiodon
  Iron Head/STEEL/PHYSICAL/96  →  Ancient Power/ROCK/SPECIAL/60
  Rock Slide/ROCK/PHYSICAL/96  →  Metal Burst/STEEL/PHYSICAL/96
  Stone Edge/ROCK/PHYSICAL/96  →  Iron Head/STEEL/PHYSICAL/80
  Earth Power/GROUND/PHYSICAL/120  →  Heavy Slam/STEEL/PHYSICAL/120
  Ancient Power/ROCK/PHYSICAL/120  →  Rock Tomb/ROCK/PHYSICAL/60
  Rock Blast/ROCK/PHYSICAL/120  →  Rock Blast/ROCK/PHYSICAL/25

### 416 Vespiquen
  Bug Bite/BUG/PHYSICAL/72  →  Bug Bite/BUG/PHYSICAL/60
  Slash/NORMAL/PHYSICAL/96  →  Gust/FLYING/SPECIAL/40
  Fury Cutter/BUG/PHYSICAL/96  →  Struggle Bug/BUG/SPECIAL/50
  Fell Stinger/BUG/PHYSICAL/120  →  Fury Cutter/BUG/PHYSICAL/40
  Attack Order/BUG/PHYSICAL/120  →  Fell Stinger/BUG/PHYSICAL/50
  Bee Swarm/BUG/PHYSICAL/140  →  Air Slash/FLYING/SPECIAL/75

### 417 Pachirisu
  Spark/ELECTRIC/SPECIAL/72  →  Thunder Shock/ELECTRIC/SPECIAL/40
  Swift/NORMAL/PHYSICAL/72  →  Spark/ELECTRIC/PHYSICAL/65
  Nuzzle/ELECTRIC/SPECIAL/120  →  Nuzzle/ELECTRIC/PHYSICAL/20
  Grass Knot/GRASS/SPECIAL/96  →  Electro Ball/ELECTRIC/SPECIAL/96
  Discharge/ELECTRIC/SPECIAL/140  →  Discharge/ELECTRIC/SPECIAL/80
  Super Fang/NORMAL/PHYSICAL/96  →  Thunder/ELECTRIC/SPECIAL/110

### 428 Lopunny
  Hyper Voice/NORMAL/PHYSICAL/96  →  Tackle/NORMAL/PHYSICAL/40
  Ice Punch/ICE/PHYSICAL/96  →  Quick Attack/NORMAL/PHYSICAL/40
  + Headbutt/NORMAL/PHYSICAL/70  (slot novo · cd 15000 · lv 1)
  + Swift/NORMAL/SPECIAL/10  (slot novo · cd 18000 · lv 1)
  + Double Hit/NORMAL/PHYSICAL/35  (slot novo · cd 22000 · lv 12)
  + Double-Edge/NORMAL/PHYSICAL/120  (slot novo · cd 26000 · lv 20)
  + Hyper Beam/NORMAL/SPECIAL/150  (slot novo · cd 30000 · lv 28)
  + Giga Impact/NORMAL/PHYSICAL/150  (slot novo · cd 36000 · lv 36)
  + Hyper Voice/NORMAL/SPECIAL/90  (slot novo · cd 42000 · lv 44)
  + Comet Punch/NORMAL/PHYSICAL/18  (slot novo · cd 50000 · lv 52)

### 447 Riolu
  Iron Head/STEEL/PHYSICAL/80  →  Counter/FIGHTING/PHYSICAL/80
  Low Kick/FIGHTING/PHYSICAL/80  →  Rock Smash/FIGHTING/PHYSICAL/40
  Vacuum Wave/FIGHTING/SPECIAL/200  →  Vacuum Wave/FIGHTING/SPECIAL/40
  Close Combat/FIGHTING/PHYSICAL/56  →  Force Palm/FIGHTING/PHYSICAL/60
  Bullet Punch/STEEL/PHYSICAL/56  →  Final Gambit/FIGHTING/SPECIAL/56
  + Reversal/FIGHTING/PHYSICAL/70  (slot novo · cd 26000 · lv 20)
  + Brick Break/FIGHTING/PHYSICAL/75  (slot novo · cd 30000 · lv 28)
  + Focus Blast/FIGHTING/SPECIAL/120  (slot novo · cd 36000 · lv 36)
  + Close Combat/FIGHTING/PHYSICAL/120  (slot novo · cd 42000 · lv 44)
  + Low Sweep/FIGHTING/PHYSICAL/65  (slot novo · cd 50000 · lv 52)

### 448 Lucario
  Iron Head/STEEL/PHYSICAL/80  →  Final Gambit/FIGHTING/SPECIAL/80
  Extreme Speed/NORMAL/PHYSICAL/56  →  Metal Claw/STEEL/PHYSICAL/50
  Aura Sphere/FIGHTING/SPECIAL/80  →  Reversal/FIGHTING/PHYSICAL/80
  Metal Claw/STEEL/PHYSICAL/56  →  Rock Smash/FIGHTING/PHYSICAL/40
  Bullet Punch/STEEL/PHYSICAL/56  →  Vacuum Wave/FIGHTING/SPECIAL/40
  Meteor Mash/STEEL/PHYSICAL/140  →  Counter/FIGHTING/PHYSICAL/120
  Metal Sound/STEEL/SPECIAL/10  →  Force Palm/FIGHTING/PHYSICAL/60
  Bulk Up/FIGHTING/PHYSICAL/10  →  Meteor Mash/STEEL/PHYSICAL/90
  Detect/FIGHTING/STATUS/0  →  Close Combat/FIGHTING/PHYSICAL/120
  Agility/PSYCHIC/PHYSICAL/10  →  Bullet Punch/STEEL/PHYSICAL/40

### 464 Rhyperior
  Rock Throw/ROCK/PHYSICAL/96  →  Bulldoze/GROUND/PHYSICAL/60
  Stone Edge/ROCK/PHYSICAL/96  →  Smack Down/ROCK/PHYSICAL/50
  Drill Run/GROUND/PHYSICAL/120  →  Rock Blast/ROCK/PHYSICAL/25
  Bulldoze/GROUND/PHYSICAL/120  →  Drill Run/GROUND/PHYSICAL/80
  Earthquake/GROUND/PHYSICAL/120  →  Earthquake/GROUND/PHYSICAL/100
  Rock Wrecker/ROCK/PHYSICAL/140  →  Stone Edge/ROCK/PHYSICAL/100
  + Rock Wrecker/ROCK/PHYSICAL/150  (slot novo · cd 30000 · lv 28)
  + Mud-Slap/GROUND/SPECIAL/20  (slot novo · cd 36000 · lv 36)
  + Mud Shot/GROUND/SPECIAL/55  (slot novo · cd 42000 · lv 44)
  + Rock Tomb/ROCK/PHYSICAL/60  (slot novo · cd 50000 · lv 52)

### 465 Tangrowth
  Vine Whip/GRASS/PHYSICAL/72  →  Absorb/GRASS/SPECIAL/20
  Fling/DARK/PHYSICAL/96  →  Energy Ball/GRASS/SPECIAL/90
  Knock Off/DARK/PHYSICAL/96  →  Acid Spray/POISON/SPECIAL/40
  Ancient Power/ROCK/SPECIAL/120  →  Double Hit/NORMAL/PHYSICAL/35
  Gloomy Vines/DARK/SPECIAL/140  →  Ancient Power/ROCK/SPECIAL/60
  Giga Drain/GRASS/SPECIAL/140  →  Sludge Bomb/POISON/SPECIAL/90
  + Aerial Ace/FLYING/PHYSICAL/70  (slot novo · cd 30000 · lv 28)
  + Bulldoze/GROUND/PHYSICAL/60  (slot novo · cd 36000 · lv 36)
  + Giga Impact/NORMAL/PHYSICAL/150  (slot novo · cd 42000 · lv 44)
  + Hyper Beam/NORMAL/SPECIAL/150  (slot novo · cd 50000 · lv 52)

### 466 Electivire
  Low Kick/FIGHTING/PHYSICAL/72  →  Thunder Shock/ELECTRIC/SPECIAL/40
  Karate Chop/FIGHTING/PHYSICAL/96  →  Shock Wave/ELECTRIC/SPECIAL/16
  Swift/NORMAL/SPECIAL/96  →  Thunder Punch/ELECTRIC/PHYSICAL/75
  Focus Punch/FIGHTING/PHYSICAL/120  →  Discharge/ELECTRIC/SPECIAL/80
  Shock Wave/ELECTRIC/SPECIAL/120  →  Thunderbolt/ELECTRIC/SPECIAL/90
  Focus Blast/FIGHTING/SPECIAL/140  →  Thunder/ELECTRIC/SPECIAL/110
  + Charge Beam/ELECTRIC/SPECIAL/50  (slot novo · cd 30000 · lv 28)
  + Volt Switch/ELECTRIC/SPECIAL/70  (slot novo · cd 36000 · lv 36)
  + Electro Ball/ELECTRIC/SPECIAL/70  (slot novo · cd 42000 · lv 44)
  + Wild Charge/ELECTRIC/PHYSICAL/90  (slot novo · cd 50000 · lv 52)

### 467 Magmortar
  Ember/FIRE/SPECIAL/72  →  Ember/FIRE/SPECIAL/40
  Thunderbolt/ELECTRIC/SPECIAL/96  →  Flame Wheel/FIRE/PHYSICAL/60
  Volcano Shot/FIRE/SPECIAL/96  →  Fire Punch/FIRE/PHYSICAL/75
  Flamethrower/FIRE/SPECIAL/120  →  Lava Plume/FIRE/SPECIAL/80
  Fire Blast/FIRE/SPECIAL/120  →  Flamethrower/FIRE/SPECIAL/90
  Magma Storm/FIRE/SPECIAL/140  →  Fire Blast/FIRE/SPECIAL/110
  + Fire Spin/FIRE/SPECIAL/35  (slot novo · cd 30000 · lv 28)
  + Flame Charge/FIRE/PHYSICAL/50  (slot novo · cd 36000 · lv 36)
  + Heat Wave/FIRE/SPECIAL/95  (slot novo · cd 42000 · lv 44)
  + Overheat/FIRE/SPECIAL/130  (slot novo · cd 50000 · lv 52)

### 472 Gliscor
  Guillotine/NORMAL/PHYSICAL/120  →  Acrobatics/FLYING/PHYSICAL/55
  Wing Attack/FLYING/PHYSICAL/96  →  Mud-Slap/GROUND/SPECIAL/20
  Air Cutter/FLYING/PHYSICAL/120  →  Aerial Ace/FLYING/PHYSICAL/120
  Ice Fang/ICE/PHYSICAL/96  →  Bulldoze/GROUND/PHYSICAL/60
  Sky Attack/FLYING/SPECIAL/140  →  Mud Shot/GROUND/SPECIAL/55
  Aerial Ace/FLYING/PHYSICAL/140  →  Earth Power/GROUND/SPECIAL/90
  + Earthquake/GROUND/PHYSICAL/100  (slot novo · cd 30000 · lv 28)
  + Sand Tomb/GROUND/PHYSICAL/35  (slot novo · cd 36000 · lv 36)
  + High Horsepower/GROUND/PHYSICAL/95  (slot novo · cd 42000 · lv 44)
  + Dual Wingbeat/FLYING/PHYSICAL/40  (slot novo · cd 50000 · lv 52)

### 477 Dusknoir
  Shadow Ball/GHOST/SPECIAL/72  →  Astonish/GHOST/PHYSICAL/30
  Shadow Punch/GHOST/PHYSICAL/96  →  Shadow Punch/GHOST/PHYSICAL/1
  Ominous Wind/GHOST/SPECIAL/96  →  Shadow Sneak/GHOST/PHYSICAL/40
  Shadow Sneak/GHOST/PHYSICAL/120  →  Night Shade/GHOST/SPECIAL/120
  Shadow Cannon/GHOST/SPECIAL/120  →  Hex/GHOST/SPECIAL/65
  Hex/GHOST/SPECIAL/140  →  Shadow Ball/GHOST/SPECIAL/80
  + Phantom Force/GHOST/PHYSICAL/90  (slot novo · cd 30000 · lv 28)
  + Poltergeist/GHOST/PHYSICAL/110  (slot novo · cd 36000 · lv 36)
  + Bind/NORMAL/PHYSICAL/15  (slot novo · cd 42000 · lv 44)
  + Fire Punch/FIRE/PHYSICAL/75  (slot novo · cd 50000 · lv 52)

### 538 Throh
  Mega Kick/FIGHTING/PHYSICAL/96  →  Circle Throw/FIGHTING/PHYSICAL/60
  Mega Punch/FIGHTING/PHYSICAL/96  →  Revenge/FIGHTING/PHYSICAL/60
  Body Slam/NORMAL/PHYSICAL/96  →  Storm Throw/FIGHTING/PHYSICAL/60
  Revenge/FIGHTING/PHYSICAL/120  →  Vital Throw/FIGHTING/PHYSICAL/35
  Superpower/FIGHTING/PHYSICAL/140  →  Seismic Toss/FIGHTING/PHYSICAL/120
  Storm Throw/FIGHTING/PHYSICAL/120  →  Reversal/FIGHTING/PHYSICAL/120
  + Superpower/FIGHTING/PHYSICAL/120  (slot novo · cd 30000 · lv 28)
  + Low Sweep/FIGHTING/PHYSICAL/65  (slot novo · cd 36000 · lv 36)
  + Brick Break/FIGHTING/PHYSICAL/75  (slot novo · cd 42000 · lv 44)
  + Dynamic Punch/FIGHTING/PHYSICAL/100  (slot novo · cd 50000 · lv 52)

### 539 Sawk
  Low Kick/FIGHTING/PHYSICAL/72  →  Rock Smash/FIGHTING/PHYSICAL/40
  Fire Punch/FIRE/PHYSICAL/96  →  Double Kick/FIGHTING/PHYSICAL/30
  Karate Chop/FIGHTING/PHYSICAL/96  →  Low Sweep/FIGHTING/PHYSICAL/65
  Mega Punch/FIGHTING/PHYSICAL/96  →  Brick Break/FIGHTING/PHYSICAL/75
  Superpower/FIGHTING/PHYSICAL/140  →  Counter/FIGHTING/PHYSICAL/120
  Low Sweep/FIGHTING/PHYSICAL/120  →  Reversal/FIGHTING/PHYSICAL/120
  + Close Combat/FIGHTING/PHYSICAL/120  (slot novo · cd 30000 · lv 28)
  + Mach Punch/FIGHTING/PHYSICAL/40  (slot novo · cd 36000 · lv 36)
  + Power-Up Punch/FIGHTING/PHYSICAL/40  (slot novo · cd 42000 · lv 44)
  + Dynamic Punch/FIGHTING/PHYSICAL/100  (slot novo · cd 50000 · lv 52)

### 564 Tirtouga
  Rock Throw/ROCK/PHYSICAL/72  →  Water Gun/WATER/SPECIAL/40
  Rock Slide/ROCK/PHYSICAL/96  →  Aqua Jet/WATER/PHYSICAL/40
  Stone Edge/ROCK/PHYSICAL/96  →  Smack Down/ROCK/PHYSICAL/50
  Brine/WATER/SPECIAL/120  →  Ancient Power/ROCK/SPECIAL/60
  Rock Blast/ROCK/PHYSICAL/120  →  Brine/WATER/SPECIAL/65
  Ancient Power/ROCK/PHYSICAL/140  →  Rock Slide/ROCK/PHYSICAL/75

### 565 Carracosta
  Rock Throw/ROCK/PHYSICAL/72  →  Aqua Jet/WATER/PHYSICAL/40
  Stone Edge/ROCK/PHYSICAL/96  →  Water Gun/WATER/SPECIAL/40
  Rock Slide/ROCK/PHYSICAL/96  →  Smack Down/ROCK/PHYSICAL/50
  Brine/WATER/SPECIAL/120  →  Ancient Power/ROCK/SPECIAL/60
  Rock Blast/ROCK/PHYSICAL/120  →  Brine/WATER/SPECIAL/65
  Ancient Power/ROCK/PHYSICAL/140  →  Rock Slide/ROCK/PHYSICAL/75

### 566 Archen
  Pluck/FLYING/SPECIAL/72  →  Rock Throw/ROCK/PHYSICAL/50
  Rock Throw/ROCK/PHYSICAL/96  →  Wing Attack/FLYING/PHYSICAL/60
  Rock Slide/ROCK/PHYSICAL/96  →  Ancient Power/ROCK/SPECIAL/60
  Wing Attack/FLYING/PHYSICAL/96  →  Pluck/FLYING/PHYSICAL/60
  Aerial Ace/FLYING/PHYSICAL/140  →  Rock Slide/ROCK/PHYSICAL/75
  Sky Attack/FLYING/SPECIAL/140  →  Rock Tomb/ROCK/PHYSICAL/60

### 567 Archeops
  Pluck/FLYING/SPECIAL/72  →  Rock Throw/ROCK/PHYSICAL/50
  Dragon Claw/DRAGON/PHYSICAL/96  →  Wing Attack/FLYING/PHYSICAL/60
  Dual Wingbeat/FLYING/PHYSICAL/96  →  Ancient Power/ROCK/SPECIAL/60
  Bounce/FLYING/SPECIAL/120  →  Pluck/FLYING/PHYSICAL/60
  Air Slash/FLYING/PHYSICAL/120  →  Rock Slide/ROCK/PHYSICAL/75
  Acrobatics/FLYING/PHYSICAL/120  →  Fly/FLYING/PHYSICAL/90

### 636 Larvesta
  Ember/FIRE/SPECIAL/72  →  Ember/FIRE/SPECIAL/40
  Flamethrower/FIRE/PHYSICAL/96  →  Flame Charge/FIRE/PHYSICAL/50
  Bug Buzz/BUG/PHYSICAL/140  →  Struggle Bug/BUG/SPECIAL/50
  Flame Charge/FIRE/SPECIAL/120  →  Flame Wheel/FIRE/PHYSICAL/60
  Flare Blitz/FIRE/SPECIAL/140  →  Bug Bite/BUG/PHYSICAL/60
  Fiery Dance/FIRE/SPECIAL/140  →  Leech Life/BUG/PHYSICAL/80

### 637 Volcarona
  Ember/FIRE/SPECIAL/72  →  Ember/FIRE/SPECIAL/40
  Flamethrower/FIRE/PHYSICAL/72  →  Fiery Dance/FIRE/SPECIAL/80
  Bug Buzz/BUG/PHYSICAL/120  →  Fire Spin/FIRE/SPECIAL/35
  Flame Charge/FIRE/SPECIAL/120  →  Flame Charge/FIRE/PHYSICAL/50
  Overheat/FIRE/SPECIAL/120  →  Flare Blitz/FIRE/PHYSICAL/120
  Fire Blast/FIRE/SPECIAL/120  →  Struggle Bug/BUG/SPECIAL/50

### 669 Flabebe
  Tackle/NORMAL/PHYSICAL/72  →  Fairy Wind/FAIRY/SPECIAL/40
  Razor Leaf/FAIRY/SPECIAL/72  →  Moonblast/FAIRY/SPECIAL/95
  Dazzling Gleam/FAIRY/SPECIAL/72  →  Draining Kiss/FAIRY/SPECIAL/50
  Fairy Wind/FAIRY/SPECIAL/96  →  Dazzling Gleam/FAIRY/SPECIAL/80
  Floral Storm/FAIRY/SPECIAL/140  →  Disarming Voice/FAIRY/SPECIAL/120

### 670 Floette
  Tackle/NORMAL/PHYSICAL/72  →  Fairy Wind/FAIRY/SPECIAL/40
  Razor Leaf/FAIRY/SPECIAL/72  →  Moonblast/FAIRY/SPECIAL/95
  Dazzling Gleam/FAIRY/SPECIAL/96  →  Draining Kiss/FAIRY/SPECIAL/50
  Heart Pound/FAIRY/PHYSICAL/120  →  Dazzling Gleam/FAIRY/SPECIAL/80
  Floral Storm/FAIRY/SPECIAL/140  →  Disarming Voice/FAIRY/SPECIAL/120
  Fairy Wind/FAIRY/SPECIAL/96  →  Alluring Voice/FAIRY/SPECIAL/80

### 671 Florges
  Tackle/NORMAL/PHYSICAL/72  →  Disarming Voice/FAIRY/SPECIAL/1
  Razor Leaf/FAIRY/SPECIAL/72  →  Moonblast/FAIRY/SPECIAL/95
  Dazzling Gleam/FAIRY/SPECIAL/96  →  Fairy Wind/FAIRY/SPECIAL/40
  Heart Pound/FAIRY/PHYSICAL/120  →  Draining Kiss/FAIRY/SPECIAL/50
  Floral Storm/FAIRY/SPECIAL/140  →  Dazzling Gleam/FAIRY/SPECIAL/80
  Petal Blizzard/FAIRY/SPECIAL/140  →  Misty Explosion/FAIRY/SPECIAL/100

### 674 Pancham
  Dark Pulse/DARK/SPECIAL/96  →  Arm Thrust/FIGHTING/PHYSICAL/15
  Drain Punch/FIGHTING/PHYSICAL/120  →  Circle Throw/FIGHTING/PHYSICAL/60
  Circle Throw/FIGHTING/PHYSICAL/140  →  Low Sweep/FIGHTING/PHYSICAL/65
  Superpower/FIGHTING/PHYSICAL/140  →  Vital Throw/FIGHTING/PHYSICAL/28
  Arm Thrust/FIGHTING/PHYSICAL/120  →  Brick Break/FIGHTING/PHYSICAL/75
  Vital Throw/FIGHTING/PHYSICAL/96  →  Drain Punch/FIGHTING/PHYSICAL/75
  + Storm Throw/FIGHTING/PHYSICAL/60  (slot novo · cd 30000 · lv 28)
  + Low Kick/FIGHTING/PHYSICAL/70  (slot novo · cd 36000 · lv 36)
  + Superpower/FIGHTING/PHYSICAL/120  (slot novo · cd 42000 · lv 44)
  + Tackle/NORMAL/PHYSICAL/40  (slot novo · cd 50000 · lv 52)

### 675 Pangoro
  Karate Chop/FIGHTING/PHYSICAL/72  →  Arm Thrust/FIGHTING/PHYSICAL/15
  Mega Punch/FIGHTING/PHYSICAL/72  →  Night Slash/DARK/PHYSICAL/70
  Circle Throw/FIGHTING/PHYSICAL/140  →  Circle Throw/FIGHTING/PHYSICAL/60
  Superpower/FIGHTING/PHYSICAL/140  →  Low Sweep/FIGHTING/PHYSICAL/65
  Reversal/FIGHTING/PHYSICAL/140  →  Vital Throw/FIGHTING/PHYSICAL/28
  Vital Throw/FIGHTING/PHYSICAL/96  →  Crunch/DARK/PHYSICAL/80
  + Hammer Arm/FIGHTING/PHYSICAL/100  (slot novo · cd 30000 · lv 28)
  + Brick Break/FIGHTING/PHYSICAL/75  (slot novo · cd 36000 · lv 36)
  + Brutal Swing/DARK/PHYSICAL/60  (slot novo · cd 42000 · lv 44)
  + Close Combat/FIGHTING/PHYSICAL/120  (slot novo · cd 50000 · lv 52)

### 681 Aegislash
  Shadow Ball/GHOST/SPECIAL/72  →  Iron Head/STEEL/PHYSICAL/80
  Psycho Cut/PSYCHIC/PHYSICAL/72  →  Shadow Sneak/GHOST/PHYSICAL/40
  Shadow Sneak/GHOST/PHYSICAL/120  →  Shadow Claw/GHOST/PHYSICAL/70
  Shadow Claw/GHOST/PHYSICAL/120  →  Shadow Ball/GHOST/SPECIAL/80
  Flash Cannon/STEEL/SPECIAL/140  →  Flash Cannon/STEEL/SPECIAL/80
  Shadow Blast/GHOST/SPECIAL/140  →  Ominous Wind/GHOST/SPECIAL/60

### 690 Skrelp
  Aqua Tail/WATER/PHYSICAL/72  →  Acid/POISON/SPECIAL/40
  Poison Sting/POISON/SPECIAL/72  →  Water Gun/WATER/SPECIAL/40
  Sludge Wave/POISON/SPECIAL/120  →  Poison Tail/POISON/PHYSICAL/50
  Poison Tail/POISON/PHYSICAL/96  →  Water Pulse/WATER/SPECIAL/60
  Sludge Bomb/POISON/SPECIAL/140  →  Aqua Tail/WATER/PHYSICAL/90

### 691 Dragalge
  Acid/POISON/SPECIAL/72  →  Acid/POISON/SPECIAL/40
  Sludge/POISON/SPECIAL/72  →  Poison Tail/POISON/PHYSICAL/50
  Poison Tail/POISON/PHYSICAL/96  →  Dragon Pulse/DRAGON/SPECIAL/85
  Sludge Bomb/POISON/SPECIAL/120  →  Sludge Bomb/POISON/SPECIAL/90
  Deadly Spikes/POISON/SPECIAL/140  →  Outrage/DRAGON/PHYSICAL/120
  Acid Armor/POISON/PHYSICAL/140  →  Poison Jab/POISON/PHYSICAL/80

### 14009 Mega Blastoise
  Headbutt/NORMAL/PHYSICAL/96  →  Water Gun/WATER/SPECIAL/40
  Bubbles/WATER/SPECIAL/72  →  Water Pulse/WATER/SPECIAL/60
  Water Gun/WATER/SPECIAL/96  →  Aqua Tail/WATER/PHYSICAL/90
  Water Ball/WATER/SPECIAL/96  →  Hydro Pump/WATER/SPECIAL/110
  Water Pulse/WATER/SPECIAL/120  →  Wave Crash/WATER/PHYSICAL/120
  Muddy Water/WATER/SPECIAL/120  →  Bubble Beam/WATER/SPECIAL/65

### 14065 Mega Alakazam
  Psybeam/PSYCHIC/SPECIAL/72  →  Psybeam/PSYCHIC/SPECIAL/65
  Psy Pulse/PSYCHIC/SPECIAL/96  →  Psycho Cut/PSYCHIC/PHYSICAL/70
  Psy Ball/PSYCHIC/SPECIAL/96  →  Psyshock/PSYCHIC/SPECIAL/80
  Confusion/PSYCHIC/SPECIAL/120  →  Psychic/PSYCHIC/SPECIAL/90
  Psychic/PSYCHIC/SPECIAL/120  →  Future Sight/PSYCHIC/SPECIAL/120
  Psychokinesis/PSYCHIC/SPECIAL/140  →  Confusion/PSYCHIC/SPECIAL/50

### 14282 Mega Gardevoir
  Charm/FAIRY/PHYSICAL/56  →  Confusion/PSYCHIC/SPECIAL/50
  Dazzling Gleam/FAIRY/PHYSICAL/56  →  Disarming Voice/FAIRY/SPECIAL/1
  Instant Teleportation/PSYCHIC/SPECIAL/10  →  Draining Kiss/FAIRY/SPECIAL/50
  Confusion/PSYCHIC/SPECIAL/80  →  Psybeam/PSYCHIC/SPECIAL/65
  Psychic/PSYCHIC/SPECIAL/96  →  Psychic/PSYCHIC/SPECIAL/90
  Stored Power/PSYCHIC/SPECIAL/120  →  Moonblast/FAIRY/SPECIAL/95
  Healing Wish/PSYCHIC/PHYSICAL/56  →  Dream Eater/PSYCHIC/SPECIAL/100
  Moonblast/FAIRY/SPECIAL/95  →  Future Sight/PSYCHIC/SPECIAL/120

### 14302 Mega Sableye
  Fury Swipes/NORMAL/PHYSICAL/96  →  Astonish/GHOST/PHYSICAL/30
  Shadow Ball/GHOST/SPECIAL/56  →  Shadow Sneak/GHOST/PHYSICAL/40
  Shadow Sphere/GHOST/SPECIAL/100  →  Night Shade/GHOST/SPECIAL/100
  Feint Attack/DARK/PHYSICAL/80  →  Knock Off/DARK/PHYSICAL/65
  Night Shade/GHOST/PHYSICAL/56  →  Shadow Claw/GHOST/PHYSICAL/70
  Shadow Claw/GHOST/PHYSICAL/144  →  Shadow Ball/GHOST/SPECIAL/80
  Shadow Sneak/GHOST/PHYSICAL/40  →  Foul Play/DARK/PHYSICAL/95
  Recover/NORMAL/PHYSICAL/160  →  Night Slash/DARK/PHYSICAL/70

### 14334 Mega Altaria
  Attract/NORMAL/PHYSICAL/10  →  Disarming Voice/FAIRY/SPECIAL/1
  Pluck/FLYING/PHYSICAL/96  →  Dragon Breath/DRAGON/SPECIAL/60
  Sing/NORMAL/PHYSICAL/10  →  Moonblast/FAIRY/SPECIAL/95
  Dragon Breath/DRAGON/SPECIAL/120  →  Twister/DRAGON/SPECIAL/40
  Dragon Mist/DRAGON/SPECIAL/80  →  Dragon Rush/DRAGON/PHYSICAL/100
  Sky Attack/FLYING/PHYSICAL/120  →  Dragon Claw/DRAGON/PHYSICAL/80
  Roost/FLYING/PHYSICAL/160  →  Play Rough/FAIRY/PHYSICAL/90
  Tailwind/FLYING/SPECIAL/10  →  Draco Meteor/DRAGON/SPECIAL/130
  Mirror Move/NORMAL/STATUS/0  →  Dragon Pulse/DRAGON/SPECIAL/85

### 14351 Castform Fire
  Ember/FIRE/SPECIAL/72  →  Ember/FIRE/SPECIAL/40
  Flame Charge/FIRE/SPECIAL/96  →  Fire Blast/FIRE/SPECIAL/110
  Flamethrower/FIRE/PHYSICAL/96  →  Flamethrower/FIRE/SPECIAL/90
  Fire Spin/FIRE/SPECIAL/120  →  Tackle/NORMAL/PHYSICAL/40
  Fire Blast/FIRE/SPECIAL/140  →  Powder Snow/ICE/SPECIAL/40

### 14448 Mega Lucario
  Iron Head/STEEL/PHYSICAL/80  →  Final Gambit/FIGHTING/SPECIAL/80
  Extreme Speed/NORMAL/PHYSICAL/56  →  Metal Claw/STEEL/PHYSICAL/50
  Aura Sphere/FIGHTING/SPECIAL/80  →  Reversal/FIGHTING/PHYSICAL/80
  Metal Claw/STEEL/PHYSICAL/56  →  Rock Smash/FIGHTING/PHYSICAL/40
  Bullet Punch/STEEL/PHYSICAL/56  →  Vacuum Wave/FIGHTING/SPECIAL/40
  Meteor Mash/STEEL/PHYSICAL/140  →  Counter/FIGHTING/PHYSICAL/120
  Metal Sound/STEEL/SPECIAL/10  →  Force Palm/FIGHTING/PHYSICAL/60
  Bulk Up/FIGHTING/PHYSICAL/10  →  Meteor Mash/STEEL/PHYSICAL/90
  Detect/FIGHTING/STATUS/0  →  Close Combat/FIGHTING/PHYSICAL/120
  Agility/PSYCHIC/PHYSICAL/10  →  Bullet Punch/STEEL/PHYSICAL/40

## 5. Pendentes de fetch — têm sprite, cache ainda não baixado

_Não alterados neste passe. Rodar o fetch do pokemondb e reexecutar `merge.mjs --write` para fechá-los._

_nenhum_

## 6. Ignoradas — na dex nacional mas sem sprite no jogo

_`looktype: 1` (sem arte no atlas). Não estão jogáveis; não foram tocadas._

380 Latias, 381 Latios, 386 Deoxys (Normal Forme), 438 Bonsly, 440 Happiny, 492 Shaymin (Land Forme), 493 Arceus, 507 Herdier, 509 Purrloin, 529 Drilbur, 550 Basculin (Red-Striped Form), 555 Darmanitan (Standard Mode), 559 Scraggy, 583 Vanillish, 594 Alomomola, 600 Klang, 606 Beheeyem, 632 Durant, 641 Tornadus (Incarnate Forme), 642 Thundurus (Incarnate Forme), 645 Landorus (Incarnate Forme), 647 Keldeo (Ordinary Form), 650 Chespin, 651 Quilladin, 653 Fennekin, 654 Braixen, 656 Froakie, 657 Frogadier, 658 Greninja, 672 Skiddo, 673 Gogoat, 676 Furfrou, 697 Tyrantrum, 710 Pumpkaboo (Average Size), 711 Gourgeist (Average Size), 716 Xerneas, 717 Yveltal, 718 Zygarde (50% Forme), 719 Diancie, 720 Hoopa (Hoopa Confined), 721 Volcanion, 722 Rowlet, 724 Decidueye, 739 Crabrawler, 740 Crabominable, 741 Oricorio (Baile Style), 745 Lycanroc (Midday Form), 746 Wishiwashi (Solo Form), 753 Fomantis, 754 Lurantis, 764 Comfey, 765 Oranguru, 769 Sandygast, 770 Palossand, 771 Pyukumuku, 772 Type: Null, 773 Silvally, 774 Minior (Meteor Form), 775 Komala, 776 Turtonator, 778 Mimikyu, 785 Tapu Koko, 786 Tapu Lele, 787 Tapu Bulu, 788 Tapu Fini, 789 Cosmog, 790 Cosmoem, 791 Solgaleo, 792 Lunala, 793 Nihilego, 794 Buzzwole, 795 Pheromosa, 796 Xurkitree, 797 Celesteela, 800 Necrozma, 801 Magearna, 802 Marshadow, 805 Stakataka, 806 Blacephalon, 807 Zeraora, 808 Meltan, 809 Melmetal, 810 Grookey, 811 Thwackey, 812 Rillaboom, 816 Sobble, 817 Drizzile, 818 Inteleon, 819 Skwovet, 820 Greedent, 821 Rookidee, 822 Corvisquire, 823 Corviknight, 824 Blipbug, 825 Dottler, 826 Orbeetle, 827 Nickit, 828 Thievul, 829 Gossifleur, 830 Eldegoss, 831 Wooloo, 832 Dubwool, 833 Chewtle, 834 Drednaw, 835 Yamper, 836 Boltund, 837 Rolycoly, 838 Carkol, 839 Coalossal, 840 Applin, 841 Flapple, 842 Appletun, 843 Silicobra, 844 Sandaconda, 845 Cramorant, 846 Arrokuda, 847 Barraskewda, 848 Toxel, 849 Toxtricity (Amped Form), 850 Sizzlipede, 851 Centiskorch, 852 Clobbopus, 853 Grapploct, 854 Sinistea, 855 Polteageist, 856 Hatenna, 857 Hattrem, 858 Hatterene, 859 Impidimp, 860 Morgrem, 861 Grimmsnarl, 862 Obstagoon, 863 Perrserker, 864 Cursola, 865 Sirfetch'd, 866 Mr. Rime, 867 Runerigus, 870 Falinks, 871 Pincurchin, 872 Snom, 873 Frosmoth, 874 Stonjourner, 875 Eiscue (Ice Face), 876 Indeedee (Male), 877 Morpeko (Full Belly Mode), 878 Cufant, 879 Copperajah, 880 Dracozolt, 881 Arctozolt, 882 Dracovish, 883 Arctovish, 884 Duraludon, 886 Drakloak, 887 Dragapult, 888 Zacian (Hero of Many Battles), 889 Zamazenta (Hero of Many Battles), 890 Eternatus, 891 Kubfu, 892 Urshifu (Single Strike Style), 893 Zarude, 894 Regieleki, 895 Regidrago, 896 Glastrier, 897 Spectrier, 898 Calyrex, 899 Wyrdeer, 900 Kleavor, 902 Basculegion (Male), 903 Sneasler, 904 Overqwil, 905 Enamorus (Incarnate Forme), 906 Sprigatito, 907 Floragato, 908 Meowscarada, 909 Fuecoco, 910 Crocalor, 911 Skeledirge, 912 Quaxly, 913 Quaxwell, 914 Quaquaval, 915 Lechonk, 916 Oinkologne (Male), 917 Tarountula, 918 Spidops, 919 Nymble, 920 Lokix, 921 Pawmi, 922 Pawmo, 923 Pawmot, 924 Tandemaus, 925 Maushold (Family of Four), 926 Fidough, 927 Dachsbun, 928 Smoliv, 929 Dolliv, 930 Arboliva, 931 Squawkabilly (Green Plumage), 932 Nacli, 933 Naclstack, 934 Garganacl, 937 Ceruledge, 938 Tadbulb, 939 Bellibolt, 940 Wattrel, 941 Kilowattrel, 942 Maschiff, 943 Mabosstiff, 944 Shroodle, 945 Grafaiai, 946 Bramblin, 947 Brambleghast, 948 Toedscool, 949 Toedscruel, 950 Klawf, 951 Capsakid, 952 Scovillain, 953 Rellor, 954 Rabsca, 955 Flittle, 956 Espathra, 960 Wiglett, 961 Wugtrio, 962 Bombirdier, 963 Finizen, 964 Palafin (Zero Form), 965 Varoom, 966 Revavroom, 967 Cyclizar, 968 Orthworm, 969 Glimmet, 970 Glimmora, 971 Greavard, 972 Houndstone, 973 Flamigo, 974 Cetoddle, 975 Cetitan, 976 Veluza, 977 Dondozo, 978 Tatsugiri (Curly Form), 980 Clodsire, 981 Farigiraf, 982 Dudunsparce (Two-Segment Form), 983 Kingambit, 984 Great Tusk, 985 Scream Tail, 986 Brute Bonnet, 987 Flutter Mane, 988 Slither Wing, 990 Iron Treads, 991 Iron Bundle, 992 Iron Hands, 993 Iron Jugulis, 994 Iron Moth, 995 Iron Thorns, 996 Frigibax, 997 Arctibax, 998 Baxcalibur, 999 Gimmighoul (Chest Form), 1000 Gholdengo

## 7. Base-only — gravadas no patch `creatures-audit-overrides.json`

_Existem só no espelho `public/data/creatures.json` (regenerável por `npm run fetch`). A auditoria delas vai no patch `game/src/server/dados/creatures-audit-overrides.json`, aplicado no boot pelo `content.mjs` (depois do merge e do rescale de huntLevel). Cada item: `attacks` sempre; `baseXxx` só quando o stat foi corrigido._

1 Bulbasaur, 2 Ivysaur, 3 Venusaur, 4 Charmander, 5 Charmeleon, 6 Charizard, 7 Squirtle, 8 Wartortle, 9 Blastoise, 10 Caterpie, 11 Metapod, 12 Butterfree, 13 Weedle, 14 Kakuna, 15 Beedrill, 16 Pidgey, 17 Pidgeotto, 18 Pidgeot, 19 Rattata, 20 Raticate, 21 Spearow, 22 Fearow, 23 Ekans, 24 Arbok, 25 Pikachu, 26 Raichu, 27 Sandshrew, 28 Sandslash, 29 Nidoran Female, 30 Nidorina, 31 Nidoqueen, 32 Nidoran Male, 33 Nidorino, 34 Nidoking, 35 Clefairy, 36 Clefable, 37 Vulpix, 38 Ninetales, 39 Jigglypuff, 40 Wigglytuff, 41 Zubat, 42 Golbat, 43 Oddish, 44 Gloom, 45 Vileplume, 46 Paras, 47 Parasect, 48 Venonat, 49 Venomoth, 50 Diglett, 51 Dugtrio, 52 Meowth, 53 Persian, 54 Psyduck, 55 Golduck, 56 Mankey, 57 Primeape, 58 Growlithe, 59 Arcanine, 60 Poliwag, 61 Poliwhirl, 62 Poliwrath, 63 Abra, 64 Kadabra, 65 Alakazam, 66 Machop, 67 Machoke, 68 Machamp, 69 Bellsprout, 70 Weepinbell, 71 Victreebel, 72 Tentacool, 73 Tentacruel, 74 Geodude, 75 Graveler, 76 Golem, 77 Ponyta, 78 Rapidash, 79 Slowpoke, 80 Slowbro, 81 Magnemite, 82 Magneton, 83 Farfetchd, 84 Doduo, 85 Dodrio, 86 Seel, 87 Dewgong, 88 Grimer, 89 Muk, 90 Shellder, 91 Cloyster, 92 Gastly, 93 Haunter, 94 Gengar, 95 Onix, 96 Drowzee, 97 Hypno, 98 Krabby, 99 Kingler, 100 Voltorb, 101 Electrode, 102 Exeggcute, 103 Exeggutor, 104 Cubone, 105 Marowak, 106 Hitmonlee, 107 Hitmonchan, 108 Lickitung, 109 Koffing, 110 Weezing, 111 Rhyhorn, 112 Rhydon, 113 Chansey, 114 Tangela, 115 Kangaskhan, 116 Horsea, 117 Seadra, 118 Goldeen, 119 Seaking, 120 Staryu, 121 Starmie, 122 Mr. Mime, 123 Scyther, 124 Jynx, 125 Electabuzz, 126 Magmar, 127 Pinsir, 128 Tauros, 129 Magikarp, 130 Gyarados, 131 Lapras, 132 Ditto, 133 Eevee, 134 Vaporeon, 135 Jolteon, 136 Flareon, 137 Porygon, 138 Omanyte, 139 Omastar, 140 Kabuto, 141 Kabutops, 142 Aerodactyl, 143 Snorlax, 144 Articuno, 145 Zapdos, 146 Moltres, 147 Dratini, 148 Dragonair, 149 Dragonite, 150 Mewtwo, 151 Mew, 152 Chikorita, 153 Bayleef, 154 Meganium, 155 Cyndaquil, 156 Quilava, 157 Typhlosion, 158 Totodile, 159 Croconaw, 160 Feraligatr, 161 Sentret, 162 Furret, 163 Hoothoot, 164 Noctowl, 165 Ledyba, 166 Ledian, 167 Spinarak, 168 Ariados, 169 Crobat, 170 Chinchou, 171 Lanturn, 172 Pichu, 173 Cleffa, 174 Igglybuff, 175 Togepi, 176 Togetic, 177 Natu, 178 Xatu, 179 Mareep, 180 Flaaffy, 181 Ampharos, 182 Bellossom, 183 Marill, 184 Azumarill, 185 Sudowoodo, 186 Politoed, 187 Hoppip, 188 Skiploom, 189 Jumpluff, 190 Aipom, 191 Sunkern, 192 Sunflora, 193 Yanma, 194 Wooper, 195 Quagsire, 196 Espeon, 197 Umbreon, 198 Murkrow, 199 Slowking, 200 Misdreavus, 201 Unown, 202 Wobbuffet, 203 Girafarig, 204 Pineco, 205 Forretress, 206 Dunsparce, 207 Gligar, 208 Steelix, 209 Snubbull, 210 Granbull, 211 Qwilfish, 212 Scizor, 213 Shuckle, 214 Heracross, 215 Sneasel, 216 Teddiursa, 217 Ursaring, 218 Slugma, 219 Magcargo, 220 Swinub, 221 Piloswine, 222 Corsola, 223 Remoraid, 224 Octillery, 225 Delibird, 226 Mantine, 227 Skarmory, 228 Houndour, 229 Houndoom, 230 Kingdra, 231 Phanpy, 232 Donphan, 233 Porygon2, 234 Stantler, 235 Smeargle, 236 Tyrogue, 237 Hitmontop, 238 Smoochum, 239 Elekid, 240 Magby, 241 Miltank, 242 Blissey, 243 Raikou, 244 Entei, 245 Suicune, 246 Larvitar, 247 Pupitar, 248 Tyranitar, 249 Lugia, 250 Ho-oh, 251 Celebi, 252 Treecko, 253 Grovyle, 254 Sceptile, 255 Torchic, 256 Combusken, 257 Blaziken, 258 Mudkip, 259 Marshtomp, 260 Swampert, 261 Poochyena, 262 Mightyena, 270 Lotad, 271 Lombre, 272 Ludicolo, 273 Seedot, 274 Nuzleaf, 275 Shiftry, 276 Taillow, 277 Swellow, 278 Wingull, 279 Pelipper, 280 Ralts, 281 Kirlia, 282 Gardevoir, 287 Slakoth, 288 Vigoroth, 289 Slaking, 293 Whismur, 294 Loudred, 295 Exploud, 296 Makuhita, 302 Sableye, 303 Mawile, 304 Aron, 305 Lairon, 306 Aggron, 307 Meditite, 308 Medicham, 309 Electrike, 310 Manectric, 322 Numel, 323 Camerupt, 324 Torkoal, 325 Spoink, 326 Grumpig, 328 Trapinch, 329 Vibrava, 330 Flygon, 332 Cacturne, 333 Swablu, 334 Altaria, 335 Zangoose, 336 Seviper, 341 Corphish, 342 Crawdaunt, 343 Baltoy, 344 Claydol, 349 Feebas, 350 Milotic, 354 Banette, 355 Duskull, 356 Dusclops, 357 Tropius, 359 Absol, 361 Snorunt, 362 Glalie, 363 Spheal, 364 Sealeo, 365 Walrein, 371 Bagon, 372 Shelgon, 373 Salamence, 374 Beldum, 375 Metang, 376 Metagross, 410 Shieldon, 411 Bastiodon, 416 Vespiquen, 417 Pachirisu, 428 Lopunny, 447 Riolu, 448 Lucario, 464 Rhyperior, 465 Tangrowth, 466 Electivire, 467 Magmortar, 472 Gliscor, 477 Dusknoir, 538 Throh, 539 Sawk, 564 Tirtouga, 565 Carracosta, 566 Archen, 567 Archeops, 636 Larvesta, 637 Volcarona, 669 Flabebe, 670 Floette, 671 Florges, 674 Pancham, 675 Pangoro, 681 Aegislash, 690 Skrelp, 691 Dragalge, 14009 Mega Blastoise, 14065 Mega Alakazam, 14282 Mega Gardevoir, 14302 Mega Sableye, 14334 Mega Altaria, 14351 Castform Fire, 14448 Mega Lucario

## 8. Fora de escopo — conteúdo original sem página no pokemondb

Não alterados por este script.

- **Outland (variantes “Brave/Ancient/Furious…”)** — 47: tratamento à parte (espelham a espécie-base; ver conversa).
- **Orre (clones #13xxx da dex nacional)** — 132 (mesmos nomes da dex nacional, stats propositalmente ajustados).
- **Outros** — 1: Blastoise (#10001)

