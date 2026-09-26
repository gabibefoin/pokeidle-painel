// Protocolo do WebSocket. JSON por enquanto: é o suficiente para 2000 conexões e vale muito
// em depurabilidade. O envelope já está pronto para trocar por msgpack/binário sem mexer no
// resto (só `codificar`/`decodificar` mudam).
//
// Convenção: `t` é o tipo, o resto do objeto é o payload.

export const CLIENTE = {
  HELLO: 'hello', // { nick, token }
  STARTER_PICK: 'starter.pick', // { speciesId }  só vale enquanto o treinador não tem pokémon
  HUNT_SELECT: 'hunt.select', // { slug }
  BOSS_ENTRAR: 'boss.entrar', // { key } — paga a entrada e vai para a arena
  BOSS_SAIR: 'boss.sair', // {} — abandona a arena (a entrada não volta)
  // Repetição automática: acabou a luta (ganhando ou perdendo), o sim cura na enfermeira e
  // entra de novo no MESMO boss enquanto houver token. Desliga sozinho quando acabam.
  BOSS_AUTO: 'boss.auto', // { ativo, key? }
  ORBS_PAINEL: 'orbs.painel', // {} — saldo, extrato, saques e o caixa público
  ORBS_SACAR: 'orbs.sacar', // { orbs, rede, endereco } — pede saque em USDT
  ORBS_CANCELAR: 'orbs.cancelar', // { id } — cancela um saque que ainda não saiu
  LOJA_COMPRAR: 'loja.comprar', // { id, nome? } — compra da loja de diamantes
  LOJA_EQUIPAR: 'loja.equipar', // { looktype } — veste uma outfit já comprada
  // Abre uma Caixa de Fundador: outfit para o armário, tag no nick, diamantes no saldo. Não
  // tem volta, e é por isso que a tela pede confirmação antes (ver `shared/caixas-beta.mjs`).
  CAIXA_ABRIR: 'caixa.abrir', // { id } — id da linha em `caixas_beta`
  // ------------------------------------------------------- PvP ranqueado (1v1)
  // A fila de ELO. A equipe é fechada ANTES (`pvp.time.salvar`) e não muda durante a partida —
  // que, aliás, não tem "durante": o pareamento simula tudo de uma vez e devolve a fita. Ver
  // o cabeçalho de `game/pvp-ranqueado.mjs`.
  PVP_INFO: 'pvp.info', // {} — rank, equipe, tabela, histórico e o estado da fila
  PVP_TIME_SALVAR: 'pvp.time.salvar', // { pokemonIds: number[] } — até 5, na ordem de entrada
  PVP_FILA_ENTRAR: 'pvp.fila.entrar', // {} — o servidor monta a entrada; o cliente não manda campo
  PVP_FILA_SAIR: 'pvp.fila.sair', // {} — a resposta diz se ele saiu MESMO (o par pode já estar fechado)
  PVP_PARTIDA_VISTA: 'pvp.partida.vista', // { id } — assistiu ao replay; sai da caixa postal
  RANKING_PEDIR: 'ranking.pedir', // { aba: '…'|'bosses', bossKey? } — bosses exige `bossKey` (ex.: regice)
  RANKING_PERFIL: 'ranking.perfil', // { nick } — cartão de um treinador do placar
  RANKING_POKEMON: 'ranking.pokemon', // { nick, speciesId, level, power } — ficha do pokémon do placar
  GUILD_INFO: 'guild.info', // {} — estado da guild do jogador
  GUILD_CRIAR: 'guild.criar', // { nome, brasao, tag?, tagCor? }
  GUILD_CONVIDAR: 'guild.convidar', // { nick }
  GUILD_ACEITAR: 'guild.aceitar', // { inviteId }
  GUILD_RECUSAR: 'guild.recusar', // { inviteId }
  GUILD_SAIR: 'guild.sair', // {}
  GUILD_EXPULSAR: 'guild.expulsar', // { alvoId } — não usar playerId: o gateway injeta o nick do remetente
  GUILD_APAGAR: 'guild.apagar', // {}
  // O SUB-DONO: faz tudo o que o dono faz, menos apagar a guild, transferir a liderança e
  // nomear outro sub-dono — as três maneiras de tirar o dono do lugar. Só o dono nomeia.
  GUILD_SUBDONO: 'guild.subdono', // { alvoId, ligado }
  GUILD_RANKING: 'guild.ranking', // {}
  // A TAG da guild: até 3 letras ao lado do nick no chat, com cor. Só o dono grava.
  GUILD_TAG: 'guild.tag', // { tag, tagCor }
  // O TIME da guild: a guild não tem teto de membros, mas só `MAX_TIME_GUILD` escalados vão à
  // guerra (e levam o bônus diário e o prêmio do mês). Ler é de qualquer membro; gravar é só do dono.
  GUILD_ESCALACAO: 'guild.escalacao', // {}
  GUILD_ESCALACAO_SALVAR: 'guild.escalacao.salvar', // { playerIds: number[] } — até 10
  // A ficha pública de uma guild do ranking: membros e a equipe de guerra de cada um. Leitura
  // pública — não exige ser membro dela (ver o handler em sim.mjs).
  GUILD_DETALHE: 'guild.detalhe', // { guildId }
  GUILD_PVP_INFO: 'guild.pvp.info', // {}
  GUILD_PVP_REGISTRAR: 'guild.pvp.registrar', // {}
  GUILD_PVP_EQUIPE_SALVAR: 'guild.pvp.equipe.salvar', // { pokemonIds: number[] } — até 5, equipe da guerra
  // A gravação da Guerra de Guilds. Vai por PEDIDO porque é o único conteúdo do jogo que
  // passa de dezenas de KB — ver `game/guild-pvp-sim.mjs`.
  GUILD_PVP_REPLAY: 'guild.pvp.replay', // { dia? } — sem `dia`, a guerra mais recente
  // A análise da guerra (dano, abates e pokémon de cada um), calculada da fita no servidor —
  // a tela recebe os números prontos em vez de baixar os ~600 KB do replay. Ver
  // `game/guild-pvp-analise.mjs`.
  GUILD_PVP_ANALISE: 'guild.pvp.analise', // { dia? } — sem `dia`, a guerra mais recente
  // --------------------------------------------------------------- Ginásios
  // Os 18 ginásios de tipo, disputados entre jogadores. `ginasio.info` traz a grade inteira
  // (líder de cada um + o que eu registrei); `ginasio.painel` abre um só, com o pódio.
  GINASIO_INFO: 'ginasio.info', // {}
  GINASIO_PAINEL: 'ginasio.painel', // { tipo } — pódio de um ginásio
  GINASIO_SALVAR: 'ginasio.salvar', // { tipo, pokemonIds: number[] } — até 5, `[]` sai do ginásio
  // A luta amistosa contra o líder. Não vale título nem prêmio — devolve o replay, que é
  // pesado, e por isso vai por PEDIDO como o da Guerra de Guilds.
  GINASIO_DESAFIAR: 'ginasio.desafiar', // { tipo }
  // --------------------------------------------------------- Área de Treinamento
  // A bancada de testes da aba "Treinamento" do PvP: dois lados montados na mão (pokémon meu ou
  // pokémon de mentira) lutam pelas regras do Ranqueado. Sem prêmio e sem gravar nada — ver
  // `game/treino.mjs`. Uma batalha a cada 5 min por conta.
  TREINO_LUTAR: 'treino.lutar', // { a: [{ meu } | { teste }], b: [...] } — até 5 de cada lado

  // ------------------------------------------------------ Caixas do Market
  // O ralo de Coins: cinco caixas compradas no NPC que trocam ouro (e, das II para cima,
  // diamante) por sorte. As tabelas e as chances moram em `shared/caixas-npc.mjs`, e a tela
  // mostra as mesmas antes do clique.
  //
  // `caixa.npc.abrir`, e não `caixa.abrir`: aquele nome já é da CAIXA DE FUNDADOR, ali em
  // cima. Duas chaves iguais no objeto de comandos do sim e a última cala a primeira.
  CAIXA_NPC_ABRIR: 'caixa.npc.abrir', // { caixaId: 1..5, aposta: 1..10 }
  // --------------------------------------------------------------- Campeonato
  // A aba inteira (inscritos em ordem de seed, a minha inscrição e se a chave já foi gerada) e
  // as duas ações. O nível e o prazo são do SERVIDOR — ver `shared/campeonato.mjs`.
  CAMPEONATO_INFO: 'campeonato.info', // {}
  CAMPEONATO_INSCREVER: 'campeonato.inscrever', // {}
  CAMPEONATO_CANCELAR: 'campeonato.cancelar', // {} — só enquanto as inscrições estão abertas
  CAMPEONATO_EQUIPE: 'campeonato.equipe', // { pokemonIds } — até 5; [] volta a valer a equipe do PvP
  CAMPEONATO_FITA: 'campeonato.fita', // { partida } — a fita de uma partida já jogada ('V2-1', 'P3-1', 'GF')
  // ------------------------------------------------------- Convites do Discord
  // O `/resgatar <codigo>` do chat. O código é gerado pelo BOT (`src/bot/`) quando o jogador
  // cruza um marco de convidados e chega no privado dele — ver `shared/convites.mjs`.
  CONVITE_RESGATAR: 'convite.resgatar', // { codigo }
  // --------------------------------------------------------------- Lista de amigos
  // O grafo de amizade, a DM persistida (7 dias) e a transferência de coins (taxa 15%).
  // Tudo tratado no sim (coeso com a guild); a DM ao vivo é repassada como o sussurro.
  AMIGOS_INFO: 'amigos.info', // {} — lista de amigos + pedidos pendentes
  AMIGO_PEDIR: 'amigo.pedir', // { nick } — pede amizade pelo nick
  AMIGO_ACEITAR: 'amigo.aceitar', // { pedidoId }
  AMIGO_RECUSAR: 'amigo.recusar', // { pedidoId }
  AMIGO_REMOVER: 'amigo.remover', // { amigoId } — desfaz a amizade
  AMIGO_DM_ABRIR: 'amigo.dm.abrir', // { amigoId } — carrega o histórico e marca como lidas
  AMIGO_DM_LER: 'amigo.dm.ler', // { amigoId } — só marca como lidas (não recarrega o histórico)
  AMIGO_DM_ENVIAR: 'amigo.dm.enviar', // { amigoId, texto }
  AMIGO_COINS: 'amigo.coins', // { amigoId, valor } — envia coins; 15% queimados
  // PvP AMISTOSO entre amigos: convite de 5 min pela conversa, luta pelas regras do Ranqueado,
  // espera de 5 min para os dois. Sem PR e sem prêmio. Ver `game/pvp-amistoso.mjs`.
  AMIGO_PVP_CONVIDAR: 'amigo.pvp.convidar', // { amigoId }
  AMIGO_PVP_RESPONDER: 'amigo.pvp.responder', // { conviteId, aceitar: boolean }
  AMIGO_PVP_CANCELAR: 'amigo.pvp.cancelar', // { conviteId } — só quem desafiou
  AMIGO_PVP_FITA: 'amigo.pvp.fita', // { conviteId } — a fita guardada da luta (30 min)
  // PASSE DE BATALHA: a trilha de 30 dias de login. O estado viaja no snapshot (`passe`); estes
  // dois só AGEM. Nenhum campo: o dia e o prêmio são do servidor. Ver `game/passe-batalha.mjs`.
  PASSE_RESGATAR: 'passe.resgatar', // {}
  PASSE_COMPRAR_VIP: 'passe.comprarVip', // {} — 50 💎, 30 dias corridos
  TEAM_ACTIVE: 'team.active', // { pokemonId }
  TEAM_MOVE: 'team.move', // { pokemonId, slot|null }  slot null = manda pro depot
  POKEMON_EVOLUIR: 'pokemon.evoluir', // { pokemonId }
  // MEGA EVOLUIR: gasta a Mega Stone da espécie e troca o pokémon pela mega (#3xxx). A pedra
  // SHINY é a de quem é shiny; o servidor escolhe qual das duas cobrar pelo `pk.shiny`, então
  // não há campo para o cliente mandar. Ver `game/mega.mjs`.
  POKEMON_MEGA: 'pokemon.mega', // { pokemonId }
  // REFINO: compra UM degrau de um stat-base pagando em pedras (ver shared/refino-stats.mjs).
  POKEMON_REFINAR: 'pokemon.refinar', // { pokemonId, stat: 'hp'|'atk'|'def'|'spAtk'|'spDef' }
  // REDUZIR O NÍVEL: leva o pokémon ao nível digitado, com piso no "Nível ao capturar" da
  // espécie. A saída de quem pôs boost de XP no bicho e passou do próprio treinador
  // (`shared/reduzir-nivel.mjs`). `nivelAlvo` só é aceito como inteiro entre o piso e o nível
  // atual − 1, ambos calculados no servidor; qualquer outro valor (negativo, acima do atual,
  // string, fração) é RECUSADO — é isso que impede um cliente adulterado de SUBIR de nível.
  // Sem `nivelAlvo`, cai um nível (abas antigas).
  POKEMON_REDUZIR_NIVEL: 'pokemon.reduzirNivel', // { pokemonId, nivelAlvo }
  // OFERENDA: até 5 pokémon do depot viram UMA pedra de evolução, sorteada numa roleta pintada
  // pelos tipos deles. `pokemonIds` é um PEDIDO — o servidor deduplica, confere posse e as
  // travas de venda, monta a roleta e sorteia; a tela só anima o índice que voltou. Ver
  // `game/oferenda.mjs` para os quatro furos que a validação fecha.
  OFERENDA_GIRAR: 'oferenda.girar', // { pokemonIds: number[] }
  // O Auto Selecionar pergunta, no clique, quais ids só o banco sabe que não podem ir para a roda
  // (as equipes do PvP Ranqueado e do campeonato). Só leitura; a resposta é `OFERENDA`.
  OFERENDA_PROTEGIDOS: 'oferenda.protegidos', // {}
  // COLEÇÃO: põe ou tira um pokémon da Coleção (o antigo cadeado de venda). O destino é
  // explícito; pedir o lado em que ele já está não muda nada. Espera de 3 s por pokémon, e a
  // resposta sempre traz o estado real: `{ k: 'colecao', id, naColecao, recusado? }`.
  COLECAO_MOVER: 'colecao.mover', // { pokemonId, para: 'colecao'|'depot' }
  AUTO_SET: 'auto.set', // { autoBallAteCapturar, autoBallSemParar, ballIds, autoRevive, autoPotion, autoVoltarHunt, … }
  BALL_THROW: 'ball.throw', // { ballId }
  CENTRO_CURAR: 'centro.curar', // {} — a enfermeira cura o time; o jogador FICA no Centro
  CENTRO_IR: 'centro.ir', // {} — vai ao Centro por vontade própria, de dentro de uma hunt
  // A tecla que o jogador está SEGURANDO na praça do Centro (1=N 2=L 3=S 4=O, 0/ausente =
  // parar). Vai só quando muda de valor: quem anda é o tick do servidor, não a mensagem.
  CENTRO_ANDAR: 'centro.andar', // { dir }
  TM_TROCAR: 'tm.trocar', // { modo:'elemental'|'aoe', tipo? }
  TM_APLICAR: 'tm.aplicar', // { itemId, pokemonId }
  ITEM_USE: 'item.use', // { itemId } — hoje só a Escape Rope
  // --------------------------------------------------------------- Casa e XP Share
  // A casa é uma INSTÂNCIA privada: só o dono entra, e só de dentro do Centro Pokémon.
  CASA_ENTRAR: 'casa.entrar', // { casaId } — o NÚMERO da casa; de dentro de outra, troca de sala
  CASA_SAIR: 'casa.sair', // {} — volta ao Centro Pokémon
  // Relê as casas do banco (a venda de uma casa acontece noutro jogador). O modal pede ao abrir.
  CASA_SINCRONIZAR: 'casa.sincronizar', // {}
  // Põe uma casa em uso (até 5 repartem XP) ou a guarda. Guardar solta os pokémon dos postos dela.
  CASA_USAR: 'casa.usar', // { casaId, usar }
  // O registro de casas do servidor — as mais novas primeiro, como o de shinys da Pokédex.
  CASAS_LISTAR: 'casas.listar', // { raridade?, pagina? }
  // O Registro de Bikes — as bicicletas mais novas primeiro, na aba ao lado do registro de casas.
  BICICLETAS_LISTAR: 'bicicletas.listar', // { raridade?, pagina? }
  // Fabricação no Professor Carvalho. As duas SORTEIAM/escolhem e cobram no servidor.
  CASA_FABRICAR: 'casa.fabricar', // {} — 10 Fragmentos de Chave → 1 Casa sorteada
  SHINY_STONE_FABRICAR: 'shinyStone.fabricar', // { tipo } — 10 fragmentos → 1 pedra do tipo
  // 10 Fragmentos de Mega Stone → a Mega Stone da espécie escolhida. `shiny: true` gasta os
  // Fragmentos de Mega SHINY Stone e entrega a pedra shiny.
  MEGA_FABRICAR: 'mega.fabricar', // { dex, shiny? }
  BICICLETA_FABRICAR: 'bicicleta.fabricar', // {} — 10 Fragmentos de Bicicleta → 1 Bicicleta sorteada
  BICICLETA_EQUIPAR: 'bicicleta.equipar', // { bicicletaId|null } — equipa UMA pelo número (substitui a anterior); null guarda
  // XP Share: qual pokémon da EQUIPE ocupa cada posto da casa. A escolha fica gravada
  // (`players.xp_share`) e sobrevive ao logout. `academia.treinar` é o nome antigo do mesmo
  // comando, mantido para um cliente em cache que ainda não recarregou.
  XPSHARE_ESCOLHER: 'xpshare.escolher', // { casaId, slot, pokemonId|null } — null esvazia o posto
  ACADEMIA_TREINAR: 'academia.treinar', // apelido legado de XPSHARE_ESCOLHER
  SHOP_BUY: 'shop.buy', // { kind:'ball'|'item', id, qty }
  // Mercado Global — anúncios entre jogadores. O escrow e o dinheiro estão explicados no
  // cabeçalho de `market-db.mjs`; aqui é só a superfície.
  MARKET_LISTAR: 'market.listar', // { tipo, moeda, busca, pagina }
  // A aba de ITENS virou catálogo: a vitrine desenha toda pedra/TM/ficha e só depois pede
  // os anúncios de uma delas. Por isso duas rotas em vez do `listar` paginado.
  MARKET_ITENS: 'market.itens', // {} — resumo por item (nº de anúncios e menor preço)
  MARKET_ITEM: 'market.item', // { itemId, moeda } — os anúncios de um item, o painel
  MARKET_MEUS: 'market.meus', // {}
  // A estrela dos FAVORITOS, e a aba que lista os anúncios dela — em qualquer estado, para o card
  // poder dizer "Vendido" em vez de o favorito sumir.
  MARKET_FAVORITAR: 'market.favoritar', // { id, ativo }
  MARKET_FAVORITOS: 'market.favoritos', // {}
  // Quantos diamantes o jogador pode vender, e de onde veio a cota. Comando próprio (e não um
  // campo do snapshot) porque a conta é um SUM no ledger — ver o handler no sim.
  MARKET_DIAMANTES_COTA: 'market.diamantes.cota', // {}
  MARKET_CRIAR: 'market.criar', // { tipo:'item'|'pokemon'|'diamante', itemId|pokemonId|casaId|bicicletaId|caixaId, qtd, preco, moeda }
  MARKET_EDITAR: 'market.editar', // { id, preco, moeda }
  MARKET_CANCELAR: 'market.cancelar', // { id }
  // `preco` e `moeda` são os TERMOS QUE O COMPRADOR VIU, não um pedido: a transação recusa se
  // o anúncio tiver piorado desde o clique (ver a trava de preço em `market-db.mjs`).
  MARKET_COMPRAR: 'market.comprar', // { id, qtd?, preco, moeda }
  // A tabela de preços: as vendas mais recentes de TODO MUNDO, para quem está tentando
  // descobrir por quanto anunciar. Mesma resposta para todos — não leva jogador nenhum.
  MARKET_HISTORICO_GLOBAL: 'market.historicoGlobal', // { pagina?, tipo?: 'pokemon'|'item'|'diamante'|'deposito'|'saque', moeda?: 'gold'|'orb', itemId? }
  // O registro de shinys do servidor inteiro (o ícone de lista da Pokédex). `busca` e `tipo`
  // são resolvidos para ids de espécie no sim — ver `shinys-db.mjs`.
  SHINY_LISTAR: 'shiny.listar', // { busca, tipo, soAVenda, ordem, pagina }
  P5_LISTAR: 'p5.listar', // { busca, tipo, soAVenda, ordem, pagina }
  // Troca de aparência DEPOIS do onboarding. Uma vez a cada 24 h, contadas pelo servidor.
  VISUAL_TROCAR: 'visual.trocar', // { genero, visual }
  CHAT_SEND: 'chat.send', // { canal, texto }
  CHAT_COMPARTILHAR: 'chat.compartilhar', // { canal, idioma, pokemonId? } — em campo ou um seu da equipe/depot
  CHAT_VER_POKEMON: 'chat.verPokemon', // { nick, pokemonId } — abre ficha compartilhada
  CHAT_DELETE: 'chat.delete', // { id } — admin, moderador ou helper
  CHAT_HISTORICO: 'chat.historico', // { canal: 'mundo' | 'guild' } — últimas msgs persistidas
  CHAT_MUTE: 'chat.mute', // { nick, minutos } — admin, moderador ou helper (5 | 30 | 60 | 1440)
  // `chat.mute` com outra duração, porque a permissão é outra: o menu de moderação continua
  // com o helper e as quatro durações prontas; o comando é de admin/moderador e aceita
  // qualquer duração. Um campo `viaComando` no `chat.mute` seria só um pedido educado para
  // o cliente — e um cliente adulterado responde o que quiser.
  CHAT_COMANDO: 'chat.comando', // { cmd: 'mute' | 'unmute', nick, minutos? } — admin ou moderador
  // MODO ECONOMIA (`cfg-economia`, nas Configurações): a tela desligou a cena, então não há
  // o que fazer com o campo do outro lado. `campo` é a maior fatia da banda de quem está
  // caçando — um selvagem andando são dezenas de pacotes por minuto que ninguém vai desenhar.
  // Desligar o envio é o que transforma "ignorar" em "não receber": menos rádio no celular,
  // menos JSON para o navegador analisar, menos egress para nós.
  //
  // O sim guarda a escolha no jogador (`p.semCampo`) e reenvia o `campo.init` inteiro quando
  // ela é desfeita — o delta seguinte só traria quem se mexeu, e a cena voltaria vazia.
  ECONOMIA: 'cliente.economia', // { ativo }
  PING: 'ping',
};

export const SERVIDOR = {
  WELCOME: 'welcome', // { playerId, estado, conteudo }
  // Token de sessão novo, em cima da hora. Vai logo depois do `hello` quando o que o cliente
  // mandou já passou da metade do prazo — ver `valeRenovar` em `auth.mjs`.
  //
  // Existe além da renovação do `/auth/conta` por causa da aba que fica ABERTA por semanas,
  // que é o normal num jogo idle: essa aba não recarrega, então nunca passa pelo `/auth/conta`,
  // e sem isto o token dela venceria no trigésimo dia e a primeira reconexão cairia no login.
  SESSAO_RENOVADA: 'sessao.renovada', // { token }
  // ESTADO — o quadro do jogador, em DELTA.
  //
  //   `cheio: true`  o pacote é o quadro INTEIRO e substitui o que havia. Vai no `welcome`
  //                  (login e reconexão) e de tempos em tempos como seguro contra pacote
  //                  perdido. É a base sobre a qual todo delta seguinte é aplicado.
  //   sem `cheio`    só as chaves que mudaram desde o último envio. Chave AUSENTE quer dizer
  //                  "não mudou"; `null` explícito é o servidor apagando o campo.
  //   `pkMud`        os pokémon que mudaram (objeto completo, casado por `id`). Um id que o
  //                  cliente ainda não tem é uma captura e entra no fim da lista.
  //   `pkFora`       ids que saíram da coleção (venda, anúncio no Mercado, evolução).
  //
  // A coleção NUNCA vem inteira num delta: ela é 99,4% do pacote e era 97% da banda do jogo
  // antes desta mudança. Quem remonta é `shared/estado-delta.mjs`, e é o mesmo módulo no
  // cliente e nas ferramentas de teste — ver `estadoParaEnviar` em `sim.mjs` para o outro lado.
  ESTADO: 'estado', // { cheio?, ...campos que mudaram, pkMud?: [...], pkFora?: [ids] }
  BATALHA: 'batalha', // { ev: [...] }  eventos para animar
  // Campo = a área andável da hunt e quem anda nela. `campo.init` vai uma vez por hunt (com
  // a caixa de tiles e o estado inteiro); `campo` vai a cada tick, mas só com o DELTA — uma
  // entidade só aparece no pacote no tick em que ela começa um passo novo.
  CAMPO_INIT: 'campo.init', // { slug, box:[minTx,minTy,cols,rows], groundZ, heroi, mobs, alvo }
  CAMPO: 'campo', // { seq, ts, alvo, heroi?, mobs?[], fora?[] }
  RANKING: 'ranking', // { aba, linhas, bossKey? }  placar do mundo, lido do Postgres
  ORBS: 'orbs', // { saldo, extrato, saques, referencia, deposito, precos, caixa }
  // Guarda-chuva do PvP ranqueado, como `GUILD` e `GINASIO`: só vêm os campos que a resposta
  // encheu.
  //   `rank`/`posicao`/`ladder`/`historico`/`time`/`fila`/`regras` — a aba inteira (`pvp.info`)
  //   `timeSalvo`   — { pokemonIds }  confirmação da gravação da equipe
  //   `fila`        — { na, desde }   entrou ou saiu da fila
  //   `filaRecusa`  — { motivo, msg } a fila recusou (nível, equipe vazia, espera)
  //   `partida`     — { replay, venci, delta, pontos, oponente, … }  a partida ACABOU de
  //                   acontecer; o cliente toca a fita e revela o delta no fim
  //   `naoVistas`   — resumos que esperavam na caixa postal (caiu no último segundo)
  PVP: 'pvp',
  GUILD: 'guild', // { guild?, ranking?, pvp?, pvpEquipe?, escalacao?, replay?, convites?, detalhe? }
  // Guarda-chuva dos Ginásios, como `GUILD`: só vêm os campos que a resposta encheu.
  //   `info`    — { nivelMin, capNivel, timeMax, podeRegistrar, ginasios: [...] }
  //   `painel`  — { tipo, ranking, total, minhaPos, meuTime }  um ginásio aberto
  //   `salvo`   — { tipo, pokemonIds }  confirmação da gravação do time
  //   `desafio` — { tipo, venci, placar, replay, … }  a luta amistosa contra o líder
  GINASIO: 'ginasio',
  // A Área de Treinamento. `resultado` traz a fita para assistir (e nada mais: não há prêmio);
  // `recusa` é `{ chave, restaMs? }` — a espera de 5 min ou um lado sem lutador.
  TREINO: 'treino',
  // As Caixas do Market (o ralo de Coins). `aberta` é `{ caixaId, aposta, custo, premios,
  // gold, diamonds }` — os prêmios são só bola e item, nunca moeda; `recusa` é `{ chave }`.
  // Nome próprio para não colidir com o `CAIXA` da Caixa de Fundador.
  CAIXA_NPC: 'caixa.npc',
  // O Campeonato. Toda resposta traz a aba inteira; `acao` diz o que acabou de acontecer.
  //   `campeonato`/`inscritos`/`eu`/`chave`/`total`/`servidorAgora` — a aba
  //   `partidas` — os resultados já decididos (sem fita)
  //   `acao`   — 'inscreveu' | 'cancelou'
  //   `recusa` — chave de texto (`camp.recusa.*`) quando a ação não passou
  //   `fita`   — { partida, a, b, vencedor, replay } — resposta de `campeonato.fita`
  //   `andou`  — { onda, concluido } — AVISO global de que uma onda foi jogada; quem está com a
  //              aba aberta pede a aba de novo
  CAMPEONATO: 'campeonato',
  // O resultado de um `/resgatar`:
  //   `marco`   — quantos convidados o código pagava (1, 5, 10, 20, 50, 100, 500)
  //   `premios` — a lista entregue, no vocabulário de `shared/convites.mjs`
  //   `recusa`  — chave de texto (`convite.invalido` | `convite.usado`)
  CONVITE: 'convite', // { marco, premios } | { recusa }
  // `protegidos`: ids da equipe do PvP Ranqueado e da do campeonato (resposta de
  // `oferenda.protegidos`), ou `null` quando a leitura falhou.
  OFERENDA: 'oferenda', // { protegidos: number[] | null }
  // `perfil.pvpTime` é a equipe do PvP Ranqueado, sempre. A do campeonato não vai na ficha.
  PERFIL: 'perfil', // { perfil }  ficha de um treinador do placar
  RANKING_FICHA: 'ranking.ficha', // { pokemon }  ficha de um pokémon do placar de poder
  // `aba` diz o que veio: 'vitrine' (com total/pagina), 'meus' (só linhas) ou 'criado'.
  MARKET: 'market', // { aba, linhas, total?, pagina?, porPagina?, anuncio? }
  // `cargo` ('vip' | 'admin' | 'moderador' | 'helper' | 'streamer' | 'tutor' | null) e `nivel` são só
  // enfeite de LISTA — o gateway carimba admin (cargo de painel: `ADMIN_EMAILS` OU
  // `AUDITORIA_RESOLVER_EMAILS`, via `ehAdminNoJogo`), mod/streamer (painel)
  // e vip (snapshot de estado); o cliente usa para pintar o nick e mostrar o `[42]` do lado.
  //
  // `fundador` (`{ tipo, serie }` ou ausente) é a tag da Caixa de Fundador. Vai SEPARADA de
  // `cargo` de propósito: ela não substitui nem disputa com [Admin] ou [Moderador] — um
  // moderador que comprou a caixa mostra os dois selos, porque dizem coisas diferentes (o que
  // a pessoa PODE e o que ela BANCOU). Como o vip, viaja de carona no snapshot de estado.
  CHAT: 'chat', // { id, canal, idioma, de, texto, ts, cargo, nivel, fundador? }
  // Guarda-chuva da Lista de Amigos, como `GUILD`: só vêm os campos que mudaram.
  //   `lista`    — [{ id, nick, level, looktype, visual, naoLidas }]
  //   `pedidos`  — [{ id, deId, deNick, deLevel, criadoEm }]  (recebidos)
  //   `enviados` — [id, …]  ids para quem já mandei pedido
  //   `conversa` — { amigoId, mensagens: [{ id, deId, texto, ts }] }  histórico carregado
  //   `dm`       — { id, de, deId, para, texto, ts }  uma DM recém-chegada (entrega ao vivo)
  //   `coins`    — { de, valor }  aviso de coins recebidos de um amigo
  //   `dmAtualizada` — { id, texto }  a linha de um convite de PvP amistoso mudou de estado
  //   `pvpAmistoso`  — { id, replay, venci, oponente, meuLado, amistoso: true }  a fita da luta
  //   `pvpa`     — { esperaAte?, saida?, recusou? }  a espera e o convite que mandei
  AMIGOS: 'amigos',
  // O resultado de uma ação do Passe: `resgate` = { degrau, premios, quebrou, fechouCiclo }
  // (a tela anima a abertura) ou `vipComprado` = { vipAte }.
  PASSE: 'passe',
  CHAT_DEL: 'chat.del', // { id }
  CHAT_HISTORICO: 'chat.historico', // { canal, mensagens: [...] }
  CHAT_MUTE: 'chat.mute', // { ate } — expiração do mute (ms); só para quem foi mutado
  CHAT_AVISO: 'chat.aviso', // { chave, nick?, minutos?, tempo? } — aviso local na lista
  SHINY_CAPTURA: 'shiny.captura', // { nick, looktype, vs, pokemon:{ nome, speciesId, level, looktype } }
  SHINY_LISTA: 'shiny.lista', // { total, pagina, porPagina, linhas: [...] }  o registro de shinys
  P5_LISTA: 'p5.lista', // { total, pagina, porPagina, linhas: [...] }  o registro de P5
  // O registro de casas: `{ raridade, pagina, porPagina, total, contagem: { total, comum, … },
  // linhas: [{ id, raridade, dono, criador, criadaEm, anuncio, minha, tirouEle }] }`.
  CASAS_LISTA: 'casas.lista',
  // O Registro de Bikes: o mesmo formato de `casas.lista`.
  BICICLETAS_LISTA: 'bicicletas.lista',
  ERRO: 'erro', // { msg }
  PONG: 'pong',
};

export const CANAIS_CHAT = ['mundo', 'guild'];

/** Nível mínimo do treinador para enviar mensagens no chat. */
export const CHAT_NIVEL_MIN = 10;

/**
 * Idiomas do chat.
 *
 * O canal e o idioma são DUAS dimensões, não uma: "Mundo em espanhol" é um par, não um
 * canal novo. Guardar assim mantém duas abas na tela em vez de seis, e quem fala duas
 * línguas troca a bandeira sem perder o canal em que estava.
 *
 * O idioma vai junto da mensagem e o fan-out continua sendo um só — quem filtra é o
 * cliente. Com o volume de um chat de MMO isso é ordens de grandeza mais barato do que
 * manter três canais de Redis por sala.
 */
export const IDIOMAS_CHAT = ['pt', 'en', 'es'];

export const codificar = (obj) => JSON.stringify(obj);

export function decodificar(raw) {
  try {
    const o = JSON.parse(raw);
    return o && typeof o === 'object' && typeof o.t === 'string' ? o : null;
  } catch {
    return null;
  }
}
