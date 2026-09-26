---
name: pokeidle-master
description: Base de conhecimento técnica, gotchas resolvidos, protocolo e mecânicas do MMO PokéIdle. Use sempre que estiver construindo, depurando ou estendendo projetos sobre o PokéIdle.
---

# PokéIdle Master Skill & Cheatsheet

Esta skill documenta todos os padrões, protocolos e aprendizados críticos acumulados no desenvolvimento do ecossistema PokéIdle.

---

## ⚠️ Gotchas Críticos Já Resolvidos (NÃO REPITA ESSES ERROS)

1. **Cache de Scripts vs Mídia:**
   - **NUNCA** use `Cache-Control: max-age=31536000` em arquivos de código (`.js`, `.mjs`, `.css`).
   - Se você fizer isso, quando o PokéIdle oficial lançar uma atualização (como a que adicionou `bicicletas.mjs`), o navegador do usuário continuará servindo o script antigo do cache e a tela travará em 0% de carregamento.
   - Use `no-cache, no-store, must-revalidate` para scripts e estilos, e cache longo apenas para imagens/áudio.

2. **Compressão Delta de Estado (`estado`):**
   - O servidor oficial não manda o objeto completo do jogador em cada tick. Ele manda deltas (`m.estado`).
   - Se você tentar ler `m.estado.gold` diretamente sem rodar o mesclador (`mesclarEstado` no JS ou `assembler.Mesclar` no Go), você receberá `nil` ou dados fragmentados.

3. **Animações do Canvas (`campo.mjs`):**
   - No `desenharMob`, Pokémon derrotados caem de lado (`rotate(-Math.PI / 2)`), ficam em tons de cinza (`filter = 'grayscale(0.7)'`) e piscam nos últimos 3 segundos antes de desaparecer.
   - **NUNCA** substitua isso por `if (e.morto) return ctx.restore();`, pois isso faz os Pokémon sumirem abruptamente e remove as animações de morte e captura do jogo.

4. **Watchdogs e Anti-Stuck de Hunt:**
   - **NUNCA** coloque loops reenviando `hunt.select` a cada poucos segundos se o combate estiver inativo.
   - Algumas hunts (como `carnivine_sinnoh`) possuem água entre o ponto de spawn e os monstros. Um watchdog agressivo entra em loop resetando o mapa a cada 12 segundos e congela a tela do jogador.

5. **Handshake `hello` e Gateway Oficial:**
   - O gateway oficial (`gateway.mjs`) só aceita um `hello` por conexão WebSocket (`if (ws.playerId) return;`).
   - Repassar `hello` repetido para um socket já autenticado não tem efeito e pode causar penalidade de telemetria se abusado.

6. **Content-Security-Policy (CSP):**
   - O HTML oficial de `pokeidle.io/app` envia CSP estrito com nonces dinâmicos. Ao atuar como proxy reverso local, remova o header `Content-Security-Policy` para permitir a injeção dos scripts locais do painel.

---

## 📁 Onde Encontrar o Código-Fonte de Referência

- **Fórmulas e Regras de Negócio Oficiais:** `PokeidleContext/source-code/official-shared/`
- **Lógica do Servidor Oficial:** `PokeidleContext/source-code/official-server/`
- **Protocolo e Estado em Go:** `PokeidleContext/source-code/go-engine/`
- **Documentação Detalhada:** `PokeidleContext/docs/`
