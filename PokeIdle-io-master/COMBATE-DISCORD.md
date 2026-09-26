# Combate — Dano, HP e Velocidade

> Post para o Discord. A fórmula dos **stats** (base, refino, IV, qualidade, potência, shiny) já foi explicada no vídeo — aqui é o que acontece **na hunt**, quando os golpes começam a cair.

---

## Como o dano é calculado

Cada golpe usa a fórmula clássica da série, adaptada ao PokeIdle:

```
base  = ((2 × nível/5 + 2) × power × atk/def) / 50 + 2
final = base × STAB × efetividade × aleatório(0,85–1,00)
```

### ATK / DEF vs Sp. ATK / Sp. DEF

| Tipo de golpe | Quem ataca | Quem defende |
|---|---|---|
| **Físico** | **ATK** | **DEF** |
| **Especial** | **Sp. ATK** | **Sp. DEF** |

Quanto **maior o atk** (ou Sp. ATK) do atacante e **menor a def** (ou Sp. DEF) do alvo, **mais dano** sai. A defesa entra **no denominador** — não aumenta a barra de vida, mas faz **cada hit doer menos**.

### O que mais entra no dano

- **power** — força do golpe. Cada movimento tem o seu (cooldown de 2 s a 60 s).
- **STAB ×1,5** — golpe do **mesmo tipo** do pokémon (ex.: Charizard usando fogo).
- **Efetividade de tipo** — super efetivo dói mais, resistência dói menos. Na hunt a tabela é **amplificada** (vantagem pesa mais, desvantagem pesa mais).
- **Aleatório 0,85–1,00** — variação por golpe.
- **Mínimo 1** de dano (exceto imunidade total).

### Investida (ataque básico)

Enquanto os golpes “de verdade” estão recarregando, o pokémon dá **Investida**:

- **power 30**
- a cada **2 segundos**
- no **tipo dele**

Sem isso, quem só conhece dois movimentos ficaria parado dez segundos entre combos.

### Selvagem na hunt bate mais forte

Quando **o selvagem** te acerta, o dano final leva **×1,8** por cima da fórmula. Quando **você** bate nele, **não** — a vantagem dele é só na hora de **causar** dano, não de **aguentar**.

---

## HP — a barra que você vê na luta

O número **HP** da ficha **não é** a barra de combate. Ela nasce do stat de HP (vídeo) e vira vida assim:

```
HP de combate = máx(24, arred(hp × 12))
```

| Quem | Barra de vida |
|---|---|
| **Seu pokémon** | stat HP × **12** (piso 24) |
| **Selvagem na hunt** | stat HP × **12** × **5** |

O selvagem leva **cinco vezes** mais vida que o mesmo stat sugere — é o que transforma a hunt em **luta**, não fila de one-shot.

### Como “tankar” de verdade

São **duas coisas diferentes**:

1. **HP de combate alto** — nasce de stat HP alto (base, IV, qualidade, potência, shiny, refino em HP, nível). **Mais barra = aguenta mais hits.**
2. **DEF / Sp. DEF alto** — **não aumenta a barra**, mas cada golpe **tira menos**. Um tanque físico precisa de **DEF**; contra golpes especiais, **Sp. DEF**.

Curar (Centro, poção, auto-potion) repõe a **barra**, não muda os stats.

---

## SPD — o que é e o que **não** é

### O stat SPD na ficha **não entra no dano**

SPD (Velocidade) **não** multiplica ataque, **não** reduz dano recebido e **não** acelera a corrida no mapa da hunt.

### O que importa: **IV de SPD** (sorteado na captura, 1–32)

O IV de Speed encurta **cooldowns**:

- **−10 ms por ponto** de IV (IV 32 → até **−320 ms**)
- **Piso de 400 ms** — ninguém vira metralhadora infinita

Vale para:

- intervalo **global** entre seus golpes (base **0,9 s** → pode cair até **0,4 s** com IV 32)
- cooldown de **cada movimento**
- **Arena PvP** — mesma regra

O selvagem tem intervalo mínimo de **1,4 s** entre golpes (independente do seu IV).

### “Meu pokémon corre mais rápido?”

Na hunt, quem corre na frente do treinador é **ritmo da cena**, não stat. IV de SPD alto faz você **atacar** mais vezes — pode *parecer* que disparou, mas a velocidade de **passo** no mapa não mudou.

---

## Resumo rápido

| Pergunta | Resposta curta |
|---|---|
| O que aumenta **dano causado**? | ATK ou Sp. ATK, power do golpe, STAB, tipo favorable, nível |
| O que reduz **dano recebido**? | DEF ou Sp. DEF (e tipo resistente ao golpe) |
| O que aumenta **vida na barra**? | Stat HP alto → ×12 na barra (selvagem ×5 extra) |
| SPD serve pra quê? | Quase nada no stat — **IV de SPD** encurta cooldown de ataque |
| Por que o selvagem demora a morrer? | **×5 HP** na barra |
| Por que ele dói? | **×1,8 dano** quando ele te acerta |

---

*Detalhes completos: **Poképedia → Combate** dentro do jogo.*
