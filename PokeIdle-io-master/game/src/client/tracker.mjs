// O TRACKER — a página `/tracker`, do lado do navegador.
//
// ### O que ela é
//
// Um site de estatística de PvP: pesquisa de treinador, as 20 últimas partidas de cada um com
// dano por pokémon, e o meta da temporada (mais usados, melhor taxa, counters, golpes). Tudo
// que ela mostra vem de `/tracker/api/*`, em JSON, por `fetch` — não há socket aqui, e é de
// propósito (ver o cabeçalho de `tracker-rotas.mjs`).
//
// ### As três regras que este arquivo segue
//
// **1. Nada de `innerHTML` com dado que veio do servidor.** Todo nó é criado por `h()`, e todo
// texto entra por `textContent`. Um nick pode conter qualquer coisa que o cadastro deixou
// passar, e uma página pública que monta HTML por concatenação é um XSS esperando o nick certo.
// O `innerHTML` aparece uma vez só, com as bandeiras do seletor de idioma, que são constantes
// escritas aqui dentro.
//
// **2. A página é ENDEREÇÁVEL.** `/tracker/j/befoin` é um endereço de verdade, com `pushState`,
// botão de voltar e indexável — não um `#hash`. Um perfil colado no Discord tem de mostrar de
// quem é, e o Google não lê nada depois do `#`.
//
// **3. Ela não importa nada do jogo.** Nem `app.js`, nem `i18n.mjs` (663 KB), nem `estilo.css`.
// O visitante do Tracker pode nunca ter jogado; fazê-lo baixar o cliente inteiro para ler uma
// tabela seria cobrar dele o preço de uma coisa que ele não pediu. O que se repete daqui para
// lá — a paleta e as três frases de idioma — está copiado, e o comentário diz de onde veio.
//
// ### O sprite
//
// Sai do `marker-atlas` (um PNG indexado por LOOKTYPE + um JSON com os retângulos), que é o
// mesmo caminho do marcador do mapa e da análise da guerra no jogo. É uma imagem e um JSON,
// contra os ~2 MB do atlas de outfits que o cliente usa para animar — aqui ninguém anda, só se
// mostra o retrato. Quem não está no atlas fica com a pokébola, e não com um quadrado vazio.

// ------------------------------------------------------------------- idioma
//
// Um dicionário próprio, pequeno, em vez do `i18n.mjs` do jogo — ver a regra 3 acima. A chave
// de `localStorage` é a MESMA (`idioma`), então quem trocou o idioma no jogo chega aqui no
// idioma dele.

const BANDEIRAS = {
  pt: `<svg viewBox="0 0 28 20" aria-hidden="true"><rect width="28" height="20" fill="#009c3b"/><path d="M14 3 25 10 14 17 3 10Z" fill="#ffdf00"/><circle cx="14" cy="10" r="4" fill="#002776"/><rect x=".5" y=".5" width="27" height="19" fill="none" stroke="#1b0a12" stroke-width="1.4"/></svg>`,
  en: `<svg viewBox="0 0 28 20" aria-hidden="true"><rect width="28" height="20" fill="#f5f5f5"/><g fill="#b22234"><rect width="28" height="3"/><rect y="6" width="28" height="3"/><rect y="12" width="28" height="3"/><rect y="17" width="28" height="3"/></g><rect width="12" height="11" fill="#3c3b6e"/><rect x=".5" y=".5" width="27" height="19" fill="none" stroke="#1b0a12" stroke-width="1.4"/></svg>`,
  es: `<svg viewBox="0 0 28 20" aria-hidden="true"><rect width="28" height="20" fill="#aa151b"/><rect y="5" width="28" height="10" fill="#f1bf00"/><rect x=".5" y=".5" width="27" height="19" fill="none" stroke="#1b0a12" stroke-width="1.4"/></svg>`,
};

const DIC = {
  pt: {
    'nav.inicio': 'Início', 'nav.meta': 'Meta', 'nav.ladder': 'Ranking', 'nav.guilds': 'Guilds',
    'buscar': 'Buscar', 'buscarDica': 'Buscar treinador…', 'jogar': 'Jogar',
    'carregando': 'Carregando…',
    'erro': 'Não foi possível carregar. Tente de novo em instantes.',
    'erroRede': 'Sem resposta do servidor.',
    'semJogador': 'Nenhum treinador com esse nome.',
    'nickInvalido': 'Nome inválido. Use de 3 a 20 letras, números ou _.',
    'semPokemon': 'Sem dados para este pokémon.',
    'semGuerra': 'Sem análise desta guerra.',
    'muitasRequisicoes': 'Você está pedindo rápido demais. Espere um minuto.',
    'voltar': 'Voltar',
    'rodape': 'Os números saem das partidas de PvP Ranqueado. Atualiza a cada poucos minutos.',

    'inicio.titulo': 'O meta do PvP',
    'inicio.sub': 'O que está sendo jogado nesta temporada, e quem está ganhando com isso.',
    'inicio.buscaTitulo': 'Procure um treinador',
    'inicio.buscaSub': 'Veja as 20 últimas partidas, o dano de cada pokémon e contra quem ele mais perde.',
    'inicio.maisUsados': 'Mais usados',
    'inicio.melhorTaxa': 'Melhor taxa de vitória',
    'inicio.ladder': 'Topo do ranking',
    'inicio.verTudo': 'Ver tudo',
    'inicio.amostra': '{n} aparições nesta temporada',
    'inicio.semDados': 'Ainda não há partidas suficientes nesta temporada.',

    'meta.titulo': 'Meta da temporada',
    'meta.temporada': 'Temporada',
    'meta.ordem.uso': 'Uso', 'meta.ordem.winrate': 'Vitórias',
    'meta.ordem.dano': 'Dano', 'meta.ordem.abates': 'Abates', 'meta.ordem.tanque': 'Tanque',
    'meta.minimo': 'A partir de {n} partidas',
    'meta.col.pokemon': 'Pokémon', 'meta.col.uso': 'Presença', 'meta.col.partidas': 'Partidas',
    'meta.col.winrate': 'Vitórias', 'meta.col.dano': 'Dano / entrada',
    'meta.col.recebido': 'Recebido / entrada', 'meta.col.abates': 'Abates / entrada',
    'meta.col.sobrevive': 'Sobrevive',
    'meta.golpes': 'Golpes que mais causaram dano',
    'meta.col.golpe': 'Golpe', 'meta.col.usos': 'Usos', 'meta.col.medio': 'Média',
    'meta.col.total': 'Total',

    'pk.titulo': '{nome} no PvP',
    'pk.counters': 'Perde mais para', 'pk.vitimas': 'Ganha mais de',
    'pk.jogadores': 'Quem mais usa', 'pk.semConfronto': 'Ainda sem confrontos suficientes.',
    'pk.col.rival': 'Adversário', 'pk.col.treinador': 'Treinador',
    'pk.vidaInteira': 'de todas as temporadas',

    'ladder.titulo': 'Ranking do PvP',
    'ladder.col.pos': '#', 'ladder.col.treinador': 'Treinador', 'ladder.col.pr': 'PR',
    'ladder.col.v': 'V', 'ladder.col.d': 'D', 'ladder.col.winrate': 'Vitórias',
    'ladder.col.pico': 'Pico', 'ladder.total': '{n} classificados',
    'ladder.anterior': 'Anterior', 'ladder.proxima': 'Próxima',

    'guild.titulo': 'Guerra de Guilds',
    'guild.guerras': 'Guerras recentes', 'guild.ranking': 'Ranking de guilds',
    'guild.col.dia': 'Dia', 'guild.col.podio': 'Pódio', 'guild.col.guilds': 'Guilds',
    'guild.col.guild': 'Guild', 'guild.col.gp': 'GP', 'guild.col.gpGlobal': 'GP global',
    'guild.col.membros': 'Membros', 'guild.semGuerras': 'Nenhuma guerra registrada ainda.',
    'guild.analise': 'Análise da guerra',
    'guild.abrirAnalise': 'Ver a análise',
    'guild.semAnalise': 'Esta guerra não guardou a fita — sem análise.',
    'guild.col.lutador': 'Lutador', 'guild.col.dano': 'Dano', 'guild.col.recebido': 'Recebido',
    'guild.col.abates': 'Abates', 'guild.col.caiu': 'Perdeu', 'guild.col.time': 'Time',
    'guild.destaques': 'Destaques', 'guild.especies': 'Espécies que mais renderam',
    'guild.golpes': 'Golpes da guerra',
    'guild.d.dano': 'Mais dano', 'guild.d.abates': 'Mais abates', 'guild.d.muralha': 'Muralha',
    'guild.d.super': 'Super efetivo', 'guild.d.maiorGolpe': 'Maior pancada',
    'guild.d.pokemon': 'Pokémon da guerra',
    'guild.col.guildLutadores': 'Lutadores', 'guild.col.mvp': 'Destaque',
    'guild.col.usos': 'Entradas',
    'guild.porTempo': 'por tempo',

    'j.nivel': 'Nível {n}', 'j.semRank': 'Não classificado', 'j.posicao': '{n}º',
    'j.desde': 'Joga desde {d}',
    'j.resumo': 'Resumo', 'j.pokemons': 'Os seus pokémon', 'j.counters': 'Maiores counters',
    'j.vitimas': 'Presas favoritas', 'j.golpes': 'Golpes', 'j.partidas': 'Últimas partidas',
    'j.partidasN': 'Últimas {n} partidas',
    'j.semPartidas': 'Nenhuma partida de PvP Ranqueado nos últimos 30 dias.',
    'j.semDados': 'Este treinador ainda não jogou PvP Ranqueado.',
    'j.st.partidas': 'Partidas', 'j.st.winrate': 'Vitórias', 'j.st.dano': 'Dano por partida',
    'j.st.recebido': 'Recebido por partida', 'j.st.abates': 'Abates por partida',
    'j.st.duracao': 'Duração média',
    'j.col.pokemon': 'Pokémon', 'j.col.partidas': 'Partidas', 'j.col.winrate': 'Vitórias',
    'j.col.dano': 'Dano', 'j.col.fatia': 'Fatia do dano', 'j.col.recebido': 'Recebido',
    'j.col.abates': 'Abates', 'j.col.caiu': 'Caiu',
    'j.vitoria': 'Vitória', 'j.derrota': 'Derrota', 'j.contra': 'contra',
    'j.rel.meuTime': 'O seu time', 'j.rel.time': 'O time de {nick}',
    'j.rel.timeDele': 'O time adversário',
    'j.rel.golpes': 'Golpes que renderam',
    'j.rel.maior': 'Maior pancada: {v} com {golpe} ({pk})',
    'j.rel.semFicha': 'Esta partida é anterior ao relatório e não tem detalhe.',
    'j.rel.dano': 'Dano', 'j.rel.recebido': 'Recebido', 'j.rel.abates': 'Abates',
    'j.rel.caiu': 'caiu', 'j.rel.vivo': 'de pé',
    'j.emptyBusca': 'Digite um nome na busca do topo.',

    'tempo.agora': 'agora', 'tempo.min': 'há {n} min', 'tempo.h': 'há {n} h',
    'tempo.d': 'há {n} d',
  },
  en: {
    'nav.inicio': 'Home', 'nav.meta': 'Meta', 'nav.ladder': 'Ranking', 'nav.guilds': 'Guilds',
    'buscar': 'Search', 'buscarDica': 'Search trainer…', 'jogar': 'Play',
    'carregando': 'Loading…',
    'erro': 'Could not load. Try again in a moment.',
    'erroRede': 'No answer from the server.',
    'semJogador': 'No trainer with that name.',
    'nickInvalido': 'Invalid name. Use 3 to 20 letters, digits or _.',
    'semPokemon': 'No data for this pokémon.',
    'semGuerra': 'No report for this war.',
    'muitasRequisicoes': 'You are asking too fast. Wait a minute.',
    'voltar': 'Back',
    'rodape': 'Numbers come from Ranked PvP matches. Updated every few minutes.',

    'inicio.titulo': 'The PvP meta',
    'inicio.sub': 'What is being played this season, and who is winning with it.',
    'inicio.buscaTitulo': 'Look up a trainer',
    'inicio.buscaSub': 'See the last 20 matches, each pokémon’s damage and who beats them most.',
    'inicio.maisUsados': 'Most used',
    'inicio.melhorTaxa': 'Best win rate',
    'inicio.ladder': 'Top of the ranking',
    'inicio.verTudo': 'See all',
    'inicio.amostra': '{n} appearances this season',
    'inicio.semDados': 'Not enough matches this season yet.',

    'meta.titulo': 'Season meta',
    'meta.temporada': 'Season',
    'meta.ordem.uso': 'Usage', 'meta.ordem.winrate': 'Win rate',
    'meta.ordem.dano': 'Damage', 'meta.ordem.abates': 'Kills', 'meta.ordem.tanque': 'Tank',
    'meta.minimo': 'From {n} matches up',
    'meta.col.pokemon': 'Pokémon', 'meta.col.uso': 'Presence', 'meta.col.partidas': 'Matches',
    'meta.col.winrate': 'Win rate', 'meta.col.dano': 'Damage / entry',
    'meta.col.recebido': 'Taken / entry', 'meta.col.abates': 'Kills / entry',
    'meta.col.sobrevive': 'Survives',
    'meta.golpes': 'Moves that dealt the most damage',
    'meta.col.golpe': 'Move', 'meta.col.usos': 'Uses', 'meta.col.medio': 'Average',
    'meta.col.total': 'Total',

    'pk.titulo': '{nome} in PvP',
    'pk.counters': 'Loses most to', 'pk.vitimas': 'Beats most often',
    'pk.jogadores': 'Used most by', 'pk.semConfronto': 'Not enough matchups yet.',
    'pk.col.rival': 'Opponent', 'pk.col.treinador': 'Trainer',
    'pk.vidaInteira': 'across all seasons',

    'ladder.titulo': 'PvP ranking',
    'ladder.col.pos': '#', 'ladder.col.treinador': 'Trainer', 'ladder.col.pr': 'RP',
    'ladder.col.v': 'W', 'ladder.col.d': 'L', 'ladder.col.winrate': 'Win rate',
    'ladder.col.pico': 'Peak', 'ladder.total': '{n} ranked',
    'ladder.anterior': 'Previous', 'ladder.proxima': 'Next',

    'guild.titulo': 'Guild War',
    'guild.guerras': 'Recent wars', 'guild.ranking': 'Guild ranking',
    'guild.col.dia': 'Day', 'guild.col.podio': 'Podium', 'guild.col.guilds': 'Guilds',
    'guild.col.guild': 'Guild', 'guild.col.gp': 'GP', 'guild.col.gpGlobal': 'Global GP',
    'guild.col.membros': 'Members', 'guild.semGuerras': 'No war recorded yet.',
    'guild.analise': 'War report',
    'guild.abrirAnalise': 'See the report',
    'guild.semAnalise': 'This war kept no tape — no report.',
    'guild.col.lutador': 'Fighter', 'guild.col.dano': 'Damage', 'guild.col.recebido': 'Taken',
    'guild.col.abates': 'Kills', 'guild.col.caiu': 'Lost', 'guild.col.time': 'Team',
    'guild.destaques': 'Highlights', 'guild.especies': 'Species that paid off',
    'guild.golpes': 'Moves of the war',
    'guild.d.dano': 'Most damage', 'guild.d.abates': 'Most kills', 'guild.d.muralha': 'Wall',
    'guild.d.super': 'Super effective', 'guild.d.maiorGolpe': 'Biggest hit',
    'guild.d.pokemon': 'Pokémon of the war',
    'guild.col.guildLutadores': 'Fighters', 'guild.col.mvp': 'MVP',
    'guild.col.usos': 'Entries',
    'guild.porTempo': 'on time',

    'j.nivel': 'Level {n}', 'j.semRank': 'Unranked', 'j.posicao': '#{n}',
    'j.desde': 'Playing since {d}',
    'j.resumo': 'Summary', 'j.pokemons': 'Their pokémon', 'j.counters': 'Biggest counters',
    'j.vitimas': 'Favourite prey', 'j.golpes': 'Moves', 'j.partidas': 'Latest matches',
    'j.partidasN': 'Last {n} matches',
    'j.semPartidas': 'No Ranked PvP match in the last 30 days.',
    'j.semDados': 'This trainer has not played Ranked PvP yet.',
    'j.st.partidas': 'Matches', 'j.st.winrate': 'Win rate', 'j.st.dano': 'Damage per match',
    'j.st.recebido': 'Taken per match', 'j.st.abates': 'Kills per match',
    'j.st.duracao': 'Average length',
    'j.col.pokemon': 'Pokémon', 'j.col.partidas': 'Matches', 'j.col.winrate': 'Win rate',
    'j.col.dano': 'Damage', 'j.col.fatia': 'Share of damage', 'j.col.recebido': 'Taken',
    'j.col.abates': 'Kills', 'j.col.caiu': 'Fainted',
    'j.vitoria': 'Victory', 'j.derrota': 'Defeat', 'j.contra': 'vs',
    'j.rel.meuTime': 'Their team', 'j.rel.time': '{nick}’s team',
    'j.rel.timeDele': 'Opposing team',
    'j.rel.golpes': 'Moves that paid off',
    'j.rel.maior': 'Biggest hit: {v} with {golpe} ({pk})',
    'j.rel.semFicha': 'This match predates the report and has no detail.',
    'j.rel.dano': 'Damage', 'j.rel.recebido': 'Taken', 'j.rel.abates': 'Kills',
    'j.rel.caiu': 'fainted', 'j.rel.vivo': 'standing',
    'j.emptyBusca': 'Type a name in the search box above.',

    'tempo.agora': 'now', 'tempo.min': '{n} min ago', 'tempo.h': '{n} h ago',
    'tempo.d': '{n} d ago',
  },
  es: {
    'nav.inicio': 'Inicio', 'nav.meta': 'Meta', 'nav.ladder': 'Clasificación', 'nav.guilds': 'Guilds',
    'buscar': 'Buscar', 'buscarDica': 'Buscar entrenador…', 'jogar': 'Jugar',
    'carregando': 'Cargando…',
    'erro': 'No se pudo cargar. Inténtalo de nuevo en un momento.',
    'erroRede': 'Sin respuesta del servidor.',
    'semJogador': 'Ningún entrenador con ese nombre.',
    'nickInvalido': 'Nombre inválido. Usa de 3 a 20 letras, números o _.',
    'semPokemon': 'Sin datos para este pokémon.',
    'semGuerra': 'Sin análisis de esta guerra.',
    'muitasRequisicoes': 'Estás pidiendo demasiado rápido. Espera un minuto.',
    'voltar': 'Volver',
    'rodape': 'Los números salen de las partidas de PvP Clasificatorio. Se actualiza cada pocos minutos.',

    'inicio.titulo': 'El meta del PvP',
    'inicio.sub': 'Qué se está jugando esta temporada, y quién gana con ello.',
    'inicio.buscaTitulo': 'Busca un entrenador',
    'inicio.buscaSub': 'Mira las últimas 20 partidas, el daño de cada pokémon y contra quién pierde más.',
    'inicio.maisUsados': 'Más usados',
    'inicio.melhorTaxa': 'Mejor tasa de victorias',
    'inicio.ladder': 'Cima de la clasificación',
    'inicio.verTudo': 'Ver todo',
    'inicio.amostra': '{n} apariciones esta temporada',
    'inicio.semDados': 'Todavía no hay partidas suficientes esta temporada.',

    'meta.titulo': 'Meta de la temporada',
    'meta.temporada': 'Temporada',
    'meta.ordem.uso': 'Uso', 'meta.ordem.winrate': 'Victorias',
    'meta.ordem.dano': 'Daño', 'meta.ordem.abates': 'Derribos', 'meta.ordem.tanque': 'Tanque',
    'meta.minimo': 'Desde {n} partidas',
    'meta.col.pokemon': 'Pokémon', 'meta.col.uso': 'Presencia', 'meta.col.partidas': 'Partidas',
    'meta.col.winrate': 'Victorias', 'meta.col.dano': 'Daño / entrada',
    'meta.col.recebido': 'Recibido / entrada', 'meta.col.abates': 'Derribos / entrada',
    'meta.col.sobrevive': 'Sobrevive',
    'meta.golpes': 'Ataques que más daño causaron',
    'meta.col.golpe': 'Ataque', 'meta.col.usos': 'Usos', 'meta.col.medio': 'Media',
    'meta.col.total': 'Total',

    'pk.titulo': '{nome} en el PvP',
    'pk.counters': 'Pierde más contra', 'pk.vitimas': 'Gana más a',
    'pk.jogadores': 'Quién más lo usa', 'pk.semConfronto': 'Aún sin enfrentamientos suficientes.',
    'pk.col.rival': 'Rival', 'pk.col.treinador': 'Entrenador',
    'pk.vidaInteira': 'de todas las temporadas',

    'ladder.titulo': 'Clasificación del PvP',
    'ladder.col.pos': '#', 'ladder.col.treinador': 'Entrenador', 'ladder.col.pr': 'PR',
    'ladder.col.v': 'V', 'ladder.col.d': 'D', 'ladder.col.winrate': 'Victorias',
    'ladder.col.pico': 'Pico', 'ladder.total': '{n} clasificados',
    'ladder.anterior': 'Anterior', 'ladder.proxima': 'Siguiente',

    'guild.titulo': 'Guerra de Guilds',
    'guild.guerras': 'Guerras recientes', 'guild.ranking': 'Clasificación de guilds',
    'guild.col.dia': 'Día', 'guild.col.podio': 'Podio', 'guild.col.guilds': 'Guilds',
    'guild.col.guild': 'Guild', 'guild.col.gp': 'GP', 'guild.col.gpGlobal': 'GP global',
    'guild.col.membros': 'Miembros', 'guild.semGuerras': 'Ninguna guerra registrada aún.',
    'guild.analise': 'Análisis de la guerra',
    'guild.abrirAnalise': 'Ver el análisis',
    'guild.semAnalise': 'Esta guerra no guardó la cinta — sin análisis.',
    'guild.col.lutador': 'Luchador', 'guild.col.dano': 'Daño', 'guild.col.recebido': 'Recibido',
    'guild.col.abates': 'Derribos', 'guild.col.caiu': 'Perdió', 'guild.col.time': 'Equipo',
    'guild.destaques': 'Destacados', 'guild.especies': 'Especies que más rindieron',
    'guild.golpes': 'Ataques de la guerra',
    'guild.d.dano': 'Más daño', 'guild.d.abates': 'Más derribos', 'guild.d.muralha': 'Muralla',
    'guild.d.super': 'Súper efectivo', 'guild.d.maiorGolpe': 'Mayor golpe',
    'guild.d.pokemon': 'Pokémon de la guerra',
    'guild.col.guildLutadores': 'Luchadores', 'guild.col.mvp': 'Destacado',
    'guild.col.usos': 'Entradas',
    'guild.porTempo': 'por tiempo',

    'j.nivel': 'Nivel {n}', 'j.semRank': 'Sin clasificar', 'j.posicao': '{n}º',
    'j.desde': 'Juega desde {d}',
    'j.resumo': 'Resumen', 'j.pokemons': 'Sus pokémon', 'j.counters': 'Mayores counters',
    'j.vitimas': 'Presas favoritas', 'j.golpes': 'Ataques', 'j.partidas': 'Últimas partidas',
    'j.partidasN': 'Últimas {n} partidas',
    'j.semPartidas': 'Ninguna partida de PvP Clasificatorio en los últimos 30 días.',
    'j.semDados': 'Este entrenador aún no ha jugado PvP Clasificatorio.',
    'j.st.partidas': 'Partidas', 'j.st.winrate': 'Victorias', 'j.st.dano': 'Daño por partida',
    'j.st.recebido': 'Recibido por partida', 'j.st.abates': 'Derribos por partida',
    'j.st.duracao': 'Duración media',
    'j.col.pokemon': 'Pokémon', 'j.col.partidas': 'Partidas', 'j.col.winrate': 'Victorias',
    'j.col.dano': 'Daño', 'j.col.fatia': 'Parte del daño', 'j.col.recebido': 'Recibido',
    'j.col.abates': 'Derribos', 'j.col.caiu': 'Cayó',
    'j.vitoria': 'Victoria', 'j.derrota': 'Derrota', 'j.contra': 'contra',
    'j.rel.meuTime': 'Su equipo', 'j.rel.time': 'El equipo de {nick}',
    'j.rel.timeDele': 'Equipo rival',
    'j.rel.golpes': 'Ataques que rindieron',
    'j.rel.maior': 'Mayor golpe: {v} con {golpe} ({pk})',
    'j.rel.semFicha': 'Esta partida es anterior al informe y no tiene detalle.',
    'j.rel.dano': 'Daño', 'j.rel.recebido': 'Recibido', 'j.rel.abates': 'Derribos',
    'j.rel.caiu': 'cayó', 'j.rel.vivo': 'en pie',
    'j.emptyBusca': 'Escribe un nombre en la búsqueda de arriba.',

    'tempo.agora': 'ahora', 'tempo.min': 'hace {n} min', 'tempo.h': 'hace {n} h',
    'tempo.d': 'hace {n} d',
  },
};

const IDIOMAS = [
  { id: 'pt', lang: 'pt-BR', locale: 'pt-BR' },
  { id: 'en', lang: 'en', locale: 'en-US' },
  { id: 'es', lang: 'es', locale: 'es-ES' },
];

function idiomaInicial() {
  try {
    const salvo = localStorage.getItem('idioma');
    if (salvo && DIC[salvo]) return salvo;
  } catch { /* modo privativo, cookies bloqueados: cai no navegador */ }
  const nav = (navigator.language || 'pt').slice(0, 2).toLowerCase();
  return DIC[nav] ? nav : 'pt';
}

let idioma = idiomaInicial();

/** A frase, com `{chave}` trocada. Chave que falta cai no português — nunca a chave crua. */
function t(chave, params) {
  const txt = DIC[idioma]?.[chave] ?? DIC.pt[chave] ?? chave;
  if (!params) return txt;
  return txt.replace(/\{(\w+)\}/g, (_, k) => (params[k] ?? ''));
}

const localeAtual = () => IDIOMAS.find((l) => l.id === idioma)?.locale ?? 'pt-BR';

// --------------------------------------------------------------- formatação

const num = (n) => new Intl.NumberFormat(localeAtual()).format(Math.round(Number(n) || 0));

/** Número grande em forma curta: 1,2 mi. Dano de partida passa fácil de seis dígitos. */
function numCurto(n) {
  const v = Number(n) || 0;
  if (Math.abs(v) < 10_000) return num(v);
  const fmt = new Intl.NumberFormat(localeAtual(), { maximumFractionDigits: 1 });
  // Espaço que NÃO quebra: numa coluna estreita, "32,9 k" virava "32,9" numa linha e "k" na
  // seguinte — e um número partido no meio é pior do que um número grande.
  if (Math.abs(v) < 1_000_000) return `${fmt.format(v / 1000)}\u00a0k`;
  return `${fmt.format(v / 1_000_000)}\u00a0mi`;
}

const pct = (x, casas = 0) =>
  new Intl.NumberFormat(localeAtual(), {
    style: 'percent', minimumFractionDigits: casas, maximumFractionDigits: casas,
  }).format(Number.isFinite(x) ? x : 0);

const doisDecimais = (x) =>
  new Intl.NumberFormat(localeAtual(), { maximumFractionDigits: 2 }).format(Number(x) || 0);

function duracao(ms) {
  const s = Math.max(0, Math.round((Number(ms) || 0) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** "ago/2026" — o mês de "joga desde". O servidor manda `YYYY-MM`; ver a nota lá. */
function mesCurto(aaaaMm) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(aaaaMm ?? ''));
  if (!m) return '—';
  return new Date(Number(m[1]), Number(m[2]) - 1, 1)
    .toLocaleDateString(localeAtual(), { month: 'short', year: 'numeric' });
}

function dataCurta(iso) {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '—';
  return new Date(ms).toLocaleDateString(localeAtual(), { day: '2-digit', month: '2-digit', year: '2-digit' });
}

/** "há 12 min". A data exata vai no `title` — a relativa é a que se lê rolando. */
function quandoFoi(iso) {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '—';
  const min = Math.floor((Date.now() - ms) / 60_000);
  if (min < 1) return t('tempo.agora');
  if (min < 60) return t('tempo.min', { n: min });
  if (min < 60 * 24) return t('tempo.h', { n: Math.floor(min / 60) });
  return t('tempo.d', { n: Math.floor(min / (60 * 24)) });
}

const dataHora = (iso) => {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? new Date(ms).toLocaleString(localeAtual()) : '';
};

// ------------------------------------------------------------------- DOM
//
// `h()` é o único construtor de nó da página. Texto entra por `textContent`, nunca por
// `innerHTML` — ver a regra 1 no topo.

function h(tag, props = null, ...filhos) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'texto') el.textContent = String(v);
    else if (k === 'estilo') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'dados') for (const [dk, dv] of Object.entries(v)) el.dataset[dk] = String(dv);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const f of filhos.flat(4)) {
    if (f == null || f === false) continue;
    el.append(f instanceof Node ? f : document.createTextNode(String(f)));
  }
  return el;
}

const $ = (s) => document.querySelector(s);

// ------------------------------------------------------------------ sprites
//
// O retrato de cada espécie é um RECORTE de um arquivo do pack de sprites do jogo, e quem diz
// onde recortar é `/tracker/api/sprites` (ver `tracker-sprites.mjs`, no servidor, para o porquê
// de não ser o atlas de marcadores que o jogo usa).
//
// O pedido é em LOTE, e é o detalhe que faz isto valer a pena: a tela é montada inteira, cada
// `retrato()` anota o looktype que precisa, e no fim do quadro sai UMA requisição com todos —
// não uma por linha da tabela. O que já é conhecido é pintado na hora, então trocar de tela
// (ou abrir o relatório de uma partida) não pede nada de novo para as espécies repetidas.
//
// A resposta vale um dia no cache do navegador: o recorte só muda quando o pack muda, o que
// acontece num deploy.

/** looktype → recorte `{img,x,y,w,h,pw,ph}` ou `null` (sabidamente sem sprite). */
const RETRATOS = new Map();
/** Elementos esperando o recorte, por looktype. */
const esperando = new Map();
/** Looktypes ainda não pedidos. */
const aPedir = new Set();
let loteAgendado = false;

/** Quantos cabem num pedido — o mesmo teto do servidor (`MAX_POR_PEDIDO`). */
const LOTE_MAX = 80;

/**
 * OS TAMANHOS, num lugar só.
 *
 * O recorte é calculado em PIXELS (o quadro do pack tem 64 px e a folha inteira é escalada
 * junto), então este número tem de ser exatamente o que o CSS dá à célula. Quando os dois
 * discordavam — o cartão do treinador era 74 px e o recorte vinha calculado para 46 — o sprite
 * saía pequeno e encostado num canto, com o resto da caixa vazio.
 *
 * Mudar um tamanho aqui pede mudar `.tk-retrato.<classe>` no estilo, e vice-versa.
 */
const TAM_RETRATO = { p: 22, '': 30, g: 46, xg: 96 };

function pintarRetrato(el, rec) {
  if (!rec) {
    el.classList.add('sem');
    return;
  }
  el.classList.remove('sem');
  // O QUADRO NÃO É QUADRADO, e essa é a parte que não dá para chutar: no pack, Kingdra é 32×64,
  // Charizard 64×64, Tyranitar 64×96 e Metagross 96×96. Escalar pela largura (ou supor 64)
  // faria os altos saírem cortados na altura do pescoço.
  //
  // A regra é a mesma do gerador de retratos do jogo (`tools/build-marker-atlas.py`): o quadro
  // INTEIRO cabe na célula, centrado na horizontal e com o PÉ encostado embaixo. Pé embaixo, e
  // não centro vertical, porque numa fileira de retratos o que alinha a leitura é o chão dos
  // bichos — com o centro, um Kingdra comprido parece flutuar ao lado de um Gengar baixo.
  const px = Number(el.dataset.px) || TAM_RETRATO[''];
  const lw = rec.w || 64;
  const lh = rec.h || 64;
  const k = Math.min(px / lw, px / lh);
  // Um respiro embaixo, proporcional ao tamanho da célula (2 px a cada 64, que é o que o
  // gerador de retratos do jogo usa). Sem ele o pé encosta na borda arredondada e o bicho
  // parece cortado justamente na parte que a moldura já escurece.
  const respiro = Math.round((px / 64) * 2);
  const desloca = (px - lw * k) / 2;        // centrado na horizontal
  const chao = Math.max(0, px - lh * k - respiro); // pé no fundo da célula
  el.style.backgroundImage = `url('${rec.img}')`;
  el.style.backgroundSize = `${(rec.pw || lw) * k}px ${(rec.ph || lh) * k}px`;
  el.style.backgroundPosition = `${desloca - rec.x * k}px ${chao - rec.y * k}px`;
}

async function pedirLote() {
  loteAgendado = false;
  const ids = [...aPedir].slice(0, LOTE_MAX);
  if (!ids.length) return;
  for (const id of ids) aPedir.delete(id);
  let retratos = {};
  try {
    const d = await api('sprites', { lt: ids.join(',') });
    retratos = d?.retratos ?? {};
  } catch { /* sem sprite a página continua inteira, só com a pokébola no lugar */ }
  for (const id of ids) {
    // O que não voltou é marcado como SEM retrato, e não deixado pendente: senão cada tela
    // nova pediria de novo os mesmos looktypes que o pack não tem.
    const rec = retratos[id] ?? null;
    RETRATOS.set(id, rec);
    for (const el of esperando.get(id) ?? []) pintarRetrato(el, rec);
    esperando.delete(id);
  }
  // Sobrou gente na fila (uma tela com mais de 80 espécies distintas): vai no lote seguinte.
  if (aPedir.size) agendarLote();
}

function agendarLote() {
  if (loteAgendado) return;
  loteAgendado = true;
  // `setTimeout(0)` e não microtask: a tela é montada dentro de uma função só, e o que se quer
  // é sair DEPOIS de ela terminar — com a lista completa de looktypes, não com o primeiro.
  setTimeout(pedirLote, 0);
}

/**
 * O retrato de uma espécie (ou de um treinador) pelo LOOKTYPE.
 *
 * @param classe  a chave de `TAM_RETRATO`: `'p'` (22 px), `''` (30), `'g'` (46), `'xg'` (96).
 */
function retrato(looktype, classe = '', extra = '') {
  const lt = Number(looktype) || 0;
  const px = TAM_RETRATO[classe] ?? TAM_RETRATO[''];
  const el = h('span', {
    class: `tk-retrato ${classe} ${extra}`.trim(),
    dados: { lt, px },
    'aria-hidden': 'true',
  });
  if (!lt) {
    el.classList.add('sem');
    return el;
  }
  if (RETRATOS.has(lt)) {
    pintarRetrato(el, RETRATOS.get(lt));
    return el;
  }
  if (!esperando.has(lt)) esperando.set(lt, []);
  esperando.get(lt).push(el);
  aPedir.add(lt);
  agendarLote();
  return el;
}

const selosDeTipo = (tipos) => (tipos ?? []).map((tp) =>
  h('span', { class: 'tk-tipo', estilo: { '--tipo-cor': `var(--t-${String(tp).toUpperCase()}, var(--vao-luz))` }, texto: tp }));

/** A barra de proporção. `cor` é uma variável CSS já resolvida pelo chamador. */
function barra(fracao, rotulo, cor = 'var(--rx)') {
  const f = Math.max(0, Math.min(1, Number(fracao) || 0));
  return h('span', { class: 'tk-barra' },
    h('i', { estilo: { width: `${(f * 100).toFixed(1)}%`, background: cor } }),
    h('span', { texto: rotulo }));
}

/** Verde acima de 50%, vermelho abaixo — a leitura instantânea de uma coluna de winrate. */
const corDaTaxa = (x) => (x >= 0.55 ? 'var(--verde)' : x >= 0.45 ? 'var(--laranja)' : 'var(--vermelho)');

// ------------------------------------------------------------------ a API

class ErroApi extends Error {
  constructor(chave, status) {
    super(chave);
    this.chave = chave;
    this.status = status;
  }
}

async function api(rota, params = {}) {
  const url = new URL(`/tracker/api/${rota}`, location.origin);
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== '') url.searchParams.set(k, String(v));
  }
  let r;
  try {
    r = await fetch(url, { headers: { accept: 'application/json' } });
  } catch {
    throw new ErroApi('erroRede', 0);
  }
  let corpo = null;
  try { corpo = await r.json(); } catch { /* resposta sem JSON: cai no erro genérico */ }
  if (!r.ok) {
    // A chave do servidor vem como `tracker.semJogador`; o dicionário daqui é sem o prefixo.
    const chave = String(corpo?.erro ?? '').replace(/^tracker\./, '');
    throw new ErroApi(DIC.pt[chave] ? chave : 'erro', r.status);
  }
  return corpo;
}

// -------------------------------------------------------------- o roteador

const ROTAS = [
  { re: /^\/tracker\/?$/, tela: 'inicio' },
  { re: /^\/tracker\/meta\/?$/, tela: 'meta' },
  { re: /^\/tracker\/ladder\/?$/, tela: 'ladder' },
  { re: /^\/tracker\/guilds\/?$/, tela: 'guilds' },
  { re: /^\/tracker\/j\/([^/]+)\/?$/, tela: 'jogador' },
  { re: /^\/tracker\/pokemon\/(\d+)\/?$/, tela: 'pokemon' },
];

function rotaAtual() {
  const caminho = decodeURIComponent(location.pathname);
  for (const r of ROTAS) {
    const m = caminho.match(r.re);
    if (m) return { tela: r.tela, arg: m[1] ?? null };
  }
  return { tela: 'inicio', arg: null };
}

function ir(destino, { substituir = false } = {}) {
  if (substituir) history.replaceState(null, '', destino);
  else history.pushState(null, '', destino);
  desenhar();
}

/** Um link interno: navega sem recarregar, mas continua sendo um `<a href>` de verdade. */
function link(destino, conteudo, props = {}) {
  return h('a', {
    href: destino,
    ...props,
    onclick: (ev) => {
      // Ctrl/⌘/meio abrem noutra aba — mexer neles seria tirar do visitante um gesto que ele
      // já tem, e numa página de comparação abrir dois perfis lado a lado é o uso normal.
      if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button !== 0) return;
      ev.preventDefault();
      ir(destino);
    },
  }, conteudo);
}

const linkJogador = (nick, conteudo = null, props = {}) =>
  link(`/tracker/j/${encodeURIComponent(nick)}`, conteudo ?? nick, props);

const linkPokemon = (id, conteudo, props = {}) =>
  (id ? link(`/tracker/pokemon/${id}`, conteudo, props) : h('span', props, conteudo));

// ------------------------------------------------------------ peças comuns

const secao = (titulo, ...conteudo) =>
  h('section', { class: 'tk-quadro tk-tela' },
    titulo ? h('h2', { class: 'tk-h2', texto: titulo }) : null,
    ...conteudo);

const carregando = () => h('div', { class: 'tk-carregando', texto: t('carregando') });

const vazio = (msg) => h('div', { class: 'tk-vazio', texto: msg });

const cartaoNumero = (rotulo, valor, sub = null) =>
  h('div', { class: 'tk-card' },
    h('div', { class: 'tk-card-rot', texto: rotulo }),
    h('div', { class: 'tk-card-val', texto: valor }),
    sub ? h('div', { class: 'tk-card-sub', texto: sub }) : null);

/** A célula de um pokémon: retrato + nome + tipos. É a primeira coluna de metade das tabelas. */
function celulaPokemon(pk, { tamanho = '', comTipos = true, comLink = true } = {}) {
  const miolo = h('span', { class: 'tk-pk' },
    retrato(pk.looktype, tamanho),
    h('span', { class: 'tk-pk-nome' },
      h('span', { texto: pk.nome }),
      comTipos && pk.tipos?.length ? h('small', {}, selosDeTipo(pk.tipos)) : null));
  return comLink && pk.id ? linkPokemon(pk.id, miolo) : miolo;
}

/**
 * Uma tabela.
 *
 * `op: true` numa coluna quer dizer OPCIONAL: ela some no celular (ver `.tk-tab .op` no
 * estilo). Existe porque as tabelas daqui têm de sete a oito colunas — a leitura que elas
 * permitem no desktop é metade do valor da página —, e em 390 px isso vira uma barra de
 * rolagem lateral dentro de um cartão, que é a pior coisa que uma tabela pode virar. No
 * celular fica o essencial: quem, quantas, quanto ganhou, quanto bateu.
 *
 * A marca é declarada na COLUNA e repetida na célula (`td(x, { op: true })`) porque HTML não
 * tem coluna de verdade: `<colgroup>` não aceita `display:none` por `@media` em todo navegador.
 */
function tabela(colunas, linhas) {
  const thead = h('thead', {}, h('tr', {}, colunas.map((c) =>
    h('th', { class: `${c.num ? 'num' : ''} ${c.op ? 'op' : ''}`.trim(), texto: c.titulo }))));
  const tbody = h('tbody', {}, linhas);
  return h('div', { class: 'tk-tab-caixa' }, h('table', { class: 'tk-tab' }, thead, tbody));
}

const td = (conteudo, { num: n = false, classe = '', op = false } = {}) =>
  h('td', { class: `${n ? 'num' : ''} ${op ? 'op' : ''} ${classe}`.trim() }, conteudo);

// ------------------------------------------------------------------ telas

const main = () => $('#tk-main');

function mostrar(...nos) {
  const m = main();
  m.replaceChildren(...nos.flat(3).filter(Boolean));
  // Toda troca de tela volta ao topo. Sem isto, sair de uma lista longa de partidas para o meta
  // deixaria a pessoa no meio de uma tabela que ela nunca viu começar.
  window.scrollTo({ top: 0, behavior: 'auto' });
}

function mostrarErro(err) {
  const chave = err instanceof ErroApi ? err.chave : 'erro';
  mostrar(h('div', { class: 'tk-quadro' }, h('div', { class: 'tk-vazio tk-erro', texto: t(chave) })));
}

// ---- início

async function telaInicio() {
  mostrar(carregando());
  const d = await api('inicio');
  // O TOPO é um convite a buscar, e não um cabeçalho decorativo: num tracker, quem chega quase
  // sempre chega para procurar alguém. O campo daqui é o MESMO da barra fixa (foca nele em vez
  // de duplicar a lógica) — dois campos de busca na mesma tela seriam dois lugares para o
  // visitante escolher, e um deles sempre pareceria o errado.
  const topo = h('section', { class: 'tk-quadro tk-tela' },
    h('h1', { class: 'tk-h1', texto: t('inicio.titulo') }),
    h('p', { class: 'tk-sub', texto: t('inicio.sub') }),
    h('div', { class: 'tk-hero-busca' },
      h('div', {},
        h('div', { class: 'tk-hero-rot', texto: t('inicio.buscaTitulo') }),
        h('div', { class: 'tk-sub', texto: t('inicio.buscaSub') })),
      h('button', {
        type: 'button', class: 'tk-bt', texto: t('buscar'),
        onclick: () => { $('#tk-q').focus(); $('#tk-q').scrollIntoView({ block: 'center' }); },
      })),
    h('p', { class: 'tk-dim', estilo: { marginTop: '10px', fontSize: '11px' } },
      `${d.temporada} · ${t('inicio.amostra', { n: num(d.amostra) })}`));

  if (!d.maisUsados?.length) {
    return mostrar(topo, h('section', { class: 'tk-quadro' }, vazio(t('inicio.semDados'))));
  }

  const linhaUso = (r) => h('tr', {},
    td(celulaPokemon(r)),
    td(barra(d.amostra ? r.partidas / d.amostra : 0, pct(d.amostra ? r.partidas / d.amostra : 0, 1)), { num: true, op: true }),
    td(barra(r.winrate, pct(r.winrate), corDaTaxa(r.winrate)), { num: true }),
    td(numCurto(r.danoPorEntrada), { num: true }));

  const usados = secao(t('inicio.maisUsados'),
    tabela(
      [{ titulo: t('meta.col.pokemon') }, { titulo: t('meta.col.uso'), num: true, op: true },
       { titulo: t('meta.col.winrate'), num: true }, { titulo: t('meta.col.dano'), num: true }],
      d.maisUsados.map(linhaUso)),
    h('div', { estilo: { marginTop: '10px' } }, link('/tracker/meta', t('inicio.verTudo'), { class: 'tk-bt off' })));

  const taxa = secao(t('inicio.melhorTaxa'),
    tabela(
      [{ titulo: t('meta.col.pokemon') }, { titulo: t('meta.col.partidas'), num: true },
       { titulo: t('meta.col.winrate'), num: true }],
      (d.melhorTaxa ?? []).map((r) => h('tr', {},
        td(celulaPokemon(r)),
        td(num(r.partidas), { num: true }),
        td(barra(r.winrate, pct(r.winrate), corDaTaxa(r.winrate)), { num: true })))));

  const ladder = secao(t('inicio.ladder'),
    tabela(
      [{ titulo: t('ladder.col.pos'), num: true }, { titulo: t('ladder.col.treinador') },
       { titulo: t('ladder.col.pr'), num: true }, { titulo: t('ladder.col.winrate'), num: true }],
      (d.ladder ?? []).map(linhaLadder)),
    h('div', { estilo: { marginTop: '10px' } }, link('/tracker/ladder', t('inicio.verTudo'), { class: 'tk-bt off' })));

  mostrar(topo, h('div', { class: 'tk-colunas dir' }, h('div', {}, usados, taxa), h('div', {}, ladder)));
}

// ---- meta

const ORDENS = ['uso', 'winrate', 'dano', 'abates', 'tanque'];

async function telaMeta() {
  const p = new URLSearchParams(location.search);
  const ordem = ORDENS.includes(p.get('ordem')) ? p.get('ordem') : 'uso';
  const temporada = p.get('temporada') ?? '';
  mostrar(carregando());
  const [d, gol] = await Promise.all([
    api('meta', { ordem, temporada, limite: 60 }),
    api('golpes', { temporada }),
  ]);

  const trocar = (chave, valor) => {
    const q = new URLSearchParams(location.search);
    if (valor) q.set(chave, valor); else q.delete(chave);
    ir(`/tracker/meta${q.toString() ? `?${q}` : ''}`);
  };

  const abas = h('div', { class: 'tk-abas' }, ORDENS.map((o) =>
    h('button', {
      type: 'button',
      class: `tk-bt ${o === d.ordem ? '' : 'off'}`,
      texto: t(`meta.ordem.${o}`),
      onclick: () => trocar('ordem', o === 'uso' ? '' : o),
    })));

  const seletorTemporada = h('select', {
    class: 'tk-bt off',
    estilo: { paddingRight: '8px' },
    'aria-label': t('meta.temporada'),
    onchange: (ev) => trocar('temporada', ev.target.value),
  }, (d.temporadas ?? [{ temporada: d.temporada }]).map((s) =>
    h('option', { value: s.temporada, selected: s.temporada === d.temporada, texto: s.temporada })));

  const cab = h('div', { class: 'tk-cab' },
    h('div', {},
      h('h1', { class: 'tk-h1', texto: t('meta.titulo') }),
      h('p', { class: 'tk-sub', texto: `${d.temporada} · ${t('inicio.amostra', { n: num(d.amostra) })}` }),
      d.minimo > 1 ? h('p', { class: 'tk-dim', estilo: { fontSize: '11px' }, texto: t('meta.minimo', { n: d.minimo }) }) : null),
    h('div', { class: 'tk-cab-dir' }, seletorTemporada));

  const linhas = d.linhas.map((r) => h('tr', {},
    td(celulaPokemon(r)),
    td(barra(d.amostra ? r.partidas / d.amostra : 0, pct(d.amostra ? r.partidas / d.amostra : 0, 1)), { num: true, op: true }),
    td(num(r.partidas), { num: true }),
    td(barra(r.winrate, pct(r.winrate), corDaTaxa(r.winrate)), { num: true }),
    td(numCurto(r.danoPorEntrada), { num: true }),
    td(numCurto(r.recebidoPorEntrada), { num: true, op: true }),
    td(doisDecimais(r.abatesPorEntrada), { num: true, op: true }),
    td(pct(r.sobrevivencia), { num: true, op: true })));

  const tab = d.linhas.length
    ? tabela([
        { titulo: t('meta.col.pokemon') }, { titulo: t('meta.col.uso'), num: true, op: true },
        { titulo: t('meta.col.partidas'), num: true }, { titulo: t('meta.col.winrate'), num: true },
        { titulo: t('meta.col.dano'), num: true },
        { titulo: t('meta.col.recebido'), num: true, op: true },
        { titulo: t('meta.col.abates'), num: true, op: true },
        { titulo: t('meta.col.sobrevive'), num: true, op: true },
      ], linhas)
    : vazio(t('inicio.semDados'));

  const golpes = gol.linhas?.length
    ? secao(t('meta.golpes'), tabela([
        { titulo: t('meta.col.golpe') }, { titulo: t('meta.col.usos'), num: true },
        { titulo: t('meta.col.medio'), num: true, op: true },
        { titulo: t('meta.col.total'), num: true },
      ], gol.linhas.map((g) => h('tr', {},
        td(h('span', {}, g.nome, ' ', selosDeTipo(g.tipo ? [g.tipo] : []))),
        td(num(g.usos), { num: true }),
        td(num(g.medio), { num: true, op: true }),
        td(numCurto(g.dano), { num: true })))))
    : null;

  mostrar(h('section', { class: 'tk-quadro tk-tela' }, cab, abas, tab), golpes);
}

// ---- pokémon

async function telaPokemon(id) {
  mostrar(carregando());
  const p = new URLSearchParams(location.search);
  const d = await api('pokemon', { id, temporada: p.get('temporada') ?? '' });
  const pk = d.pokemon;

  const cabeca = h('section', { class: 'tk-quadro tk-tela' },
    h('div', { class: 'tk-cab' },
      retrato(pk.looktype, 'g'),
      h('div', {},
        h('h1', { class: 'tk-h1', texto: t('pk.titulo', { nome: pk.nome }) }),
        h('p', { class: 'tk-sub' }, selosDeTipo(pk.tipos), ` · ${d.temporada}`))),
    h('div', { class: 'tk-cards' },
      cartaoNumero(t('meta.col.partidas'), num(pk.partidas)),
      cartaoNumero(t('meta.col.winrate'), pct(pk.winrate, 1)),
      cartaoNumero(t('meta.col.dano'), numCurto(pk.danoPorEntrada)),
      cartaoNumero(t('meta.col.recebido'), numCurto(pk.recebidoPorEntrada)),
      cartaoNumero(t('meta.col.abates'), doisDecimais(pk.abatesPorEntrada)),
      cartaoNumero(t('meta.col.sobrevive'), pct(pk.sobrevivencia))));

  const listaConfronto = (titulo, lista) => secao(titulo, lista.length
    ? tabela([{ titulo: t('pk.col.rival') }, { titulo: t('meta.col.partidas'), num: true },
              { titulo: t('meta.col.winrate'), num: true }],
      lista.map((r) => h('tr', {},
        td(celulaPokemon(r)),
        td(num(r.partidas), { num: true }),
        td(barra(r.winrate, pct(r.winrate), corDaTaxa(r.winrate)), { num: true }))))
    : vazio(t('pk.semConfronto')));

  const donos = secao(`${t('pk.jogadores')} · ${t('pk.vidaInteira')}`, d.jogadores.length
    ? tabela([{ titulo: t('pk.col.treinador') }, { titulo: t('meta.col.partidas'), num: true },
              { titulo: t('meta.col.winrate'), num: true }, { titulo: t('j.col.dano'), num: true }],
      d.jogadores.map((j) => h('tr', {},
        td(linkJogador(j.nick)),
        td(num(j.partidas), { num: true }),
        td(pct(j.winrate), { num: true }),
        td(numCurto(j.dano), { num: true }))))
    : vazio(t('pk.semConfronto')));

  mostrar(cabeca,
    h('div', { class: 'tk-colunas meio' },
      listaConfronto(t('pk.counters'), d.counters),
      listaConfronto(t('pk.vitimas'), d.vitimas)),
    donos);
}

// ---- ladder

function linhaLadder(r) {
  return h('tr', {},
    td(num(r.posicao), { num: true }),
    td(h('span', { class: 'tk-pk' },
      h('img', { src: `/img/ranks/${r.tierId}.webp`, alt: '', width: 22, height: 22, estilo: { imageRendering: 'auto' } }),
      linkJogador(r.nick))),
    td(num(r.pontos), { num: true }),
    td(barra(r.winrate, pct(r.winrate), corDaTaxa(r.winrate)), { num: true }));
}

async function telaLadder() {
  const p = new URLSearchParams(location.search);
  const pagina = Math.max(0, Number(p.get('pagina')) || 0);
  mostrar(carregando());
  const d = await api('ladder', { pagina, limite: 50 });

  const paginas = Math.max(1, Math.ceil(d.total / d.porPagina));
  const irPara = (n) => ir(`/tracker/ladder${n > 0 ? `?pagina=${n}` : ''}`);

  const linhas = d.linhas.map((r) => h('tr', {},
    td(num(r.posicao), { num: true }),
    td(h('span', { class: 'tk-pk' },
      h('img', { src: `/img/ranks/${r.tierId}.webp`, alt: '', width: 24, height: 24, estilo: { imageRendering: 'auto' } }),
      h('span', { class: 'tk-pk-nome' },
        linkJogador(r.nick),
        h('small', { texto: t('j.nivel', { n: num(r.nivel) }) })))),
    td(num(r.pontos), { num: true }),
    td(num(r.pico), { num: true, op: true }),
    td(num(r.vitorias), { num: true, classe: 'tk-vit', op: true }),
    td(num(r.derrotas), { num: true, classe: 'tk-der', op: true }),
    td(barra(r.winrate, pct(r.winrate), corDaTaxa(r.winrate)), { num: true })));

  mostrar(h('section', { class: 'tk-quadro tk-tela' },
    h('div', { class: 'tk-cab' },
      h('div', {},
        h('h1', { class: 'tk-h1', texto: t('ladder.titulo') }),
        h('p', { class: 'tk-sub', texto: t('ladder.total', { n: num(d.total) }) }))),
    d.linhas.length
      ? tabela([
          { titulo: t('ladder.col.pos'), num: true }, { titulo: t('ladder.col.treinador') },
          { titulo: t('ladder.col.pr'), num: true },
          { titulo: t('ladder.col.pico'), num: true, op: true },
          { titulo: t('ladder.col.v'), num: true, op: true },
          { titulo: t('ladder.col.d'), num: true, op: true },
          { titulo: t('ladder.col.winrate'), num: true },
        ], linhas)
      : vazio(t('inicio.semDados')),
    paginas > 1
      ? h('div', { class: 'tk-abas', estilo: { marginTop: '12px', marginBottom: '0' } },
          h('button', { type: 'button', class: 'tk-bt off', disabled: pagina <= 0, texto: t('ladder.anterior'), onclick: () => irPara(pagina - 1) }),
          h('span', { class: 'tk-sub', estilo: { alignSelf: 'center' }, texto: `${pagina + 1} / ${paginas}` }),
          h('button', { type: 'button', class: 'tk-bt off', disabled: pagina + 1 >= paginas, texto: t('ladder.proxima'), onclick: () => irPara(pagina + 1) }))
      : null));
}

// ---- guilds

async function telaGuilds() {
  mostrar(carregando());
  const d = await api('guilds');

  const guerras = secao(t('guild.guerras'), d.guerras.length
    ? h('div', {}, d.guerras.map(linhaGuerra))
    : vazio(t('guild.semGuerras')));

  const ranking = secao(t('guild.ranking'), tabela(
    [{ titulo: t('ladder.col.pos'), num: true }, { titulo: t('guild.col.guild') },
     { titulo: t('guild.col.gpGlobal'), num: true },
     { titulo: t('guild.col.gp'), num: true, op: true },
     { titulo: t('guild.col.membros'), num: true, op: true }],
    d.ranking.map((g) => h('tr', {},
      td(num(g.posicao), { num: true }),
      td(g.nome),
      td(num(g.gpGlobal), { num: true }),
      td(num(g.gp), { num: true, op: true }),
      td(num(g.membros), { num: true, op: true })))));

  mostrar(h('section', { class: 'tk-quadro tk-tela' },
    h('h1', { class: 'tk-h1', texto: t('guild.titulo') })), guerras, ranking);
}

/**
 * Uma guerra na lista: o dia, o pódio e o botão que ABRE a análise.
 *
 * A análise é pedida no primeiro clique, e não junto da lista: são catorze guerras na tela e
 * cada análise é a leitura de uma fita de dezenas de KB no servidor. Quem abre uma quer uma.
 */
function linhaGuerra(g) {
  const caixa = h('div', { class: 'tk-partida' });
  const seta = h('span', { class: 'tk-partida-seta', texto: g.temAnalise ? '▼' : '' });
  const corpo = h('div', { class: 'tk-relatorio' });
  let pedida = false;

  const cab = h('button', {
    type: 'button', class: 'tk-guerra-cab', 'aria-expanded': 'false',
    disabled: !g.temAnalise,
    onclick: async () => {
      const aberta = caixa.classList.toggle('aberta');
      cab.setAttribute('aria-expanded', aberta ? 'true' : 'false');
      seta.textContent = aberta ? '▲' : '▼';
      if (!aberta || pedida) return;
      pedida = true;
      corpo.replaceChildren(carregando());
      try {
        corpo.replaceChildren(analiseDaGuerra(await api('guerra', { dia: g.dia })));
      } catch (err) {
        pedida = false; // deixa tentar de novo no próximo clique
        corpo.replaceChildren(vazio(t(err instanceof ErroApi ? err.chave : 'erro')));
      }
    },
  },
    h('span', { class: 'tk-guerra-dia' },
      h('b', { texto: dataCurta(`${g.dia}T12:00:00Z`) }),
      g.motivo === 'tempo' ? h('small', { class: 'tk-dim', texto: ` ${t('guild.porTempo')}` }) : null),
    h('span', { class: 'tk-guerra-podio' }, g.podio.map((p, i) =>
      h('span', { class: `tk-podio p${i + 1}` },
        h('b', { texto: `${p.pos}º` }), p.nome))),
    h('span', { class: 'tk-dim', texto: `${num(g.guilds)} ${t('guild.col.guilds')}` }),
    seta);

  caixa.append(cab, corpo);
  if (!g.temAnalise) corpo.append(vazio(t('guild.semAnalise')));
  return caixa;
}

/** O relatório de uma guerra: destaques, quem bateu, espécies e golpes. */
function analiseDaGuerra(a) {
  const dest = a.destaques ?? {};
  const cartao = (chave, valor, quem) => (valor == null ? null
    : h('div', { class: 'tk-card' },
        h('div', { class: 'tk-card-rot', texto: t(chave) }),
        h('div', { class: 'tk-card-val', texto: valor }),
        h('div', { class: 'tk-card-sub', texto: quem ?? '' })));

  const destaques = h('div', { class: 'tk-cards' },
    cartao('guild.d.dano', dest.dano ? numCurto(dest.dano.valor) : null, dest.dano?.nick),
    cartao('guild.d.abates', dest.abates ? num(dest.abates.valor) : null, dest.abates?.nick),
    cartao('guild.d.muralha', dest.muralha ? numCurto(dest.muralha.valor) : null, dest.muralha?.nick),
    cartao('guild.d.super', dest.superEfetivo ? num(dest.superEfetivo.valor) : null, dest.superEfetivo?.nick),
    cartao('guild.d.maiorGolpe', dest.maiorGolpe ? num(dest.maiorGolpe.valor) : null,
      dest.maiorGolpe ? `${dest.maiorGolpe.nick} · ${dest.maiorGolpe.golpe}` : null),
    cartao('guild.d.pokemon', dest.pokemon ? numCurto(dest.pokemon.valor) : null,
      dest.pokemon ? `${dest.pokemon.nome} · ${dest.pokemon.nick}` : null));

  const guilds = a.guilds.length ? tabela([
    { titulo: t('ladder.col.pos'), num: true }, { titulo: t('guild.col.guild') },
    { titulo: t('guild.col.dano'), num: true }, { titulo: t('guild.col.abates'), num: true },
    { titulo: t('guild.col.guildLutadores'), num: true, op: true },
    { titulo: t('guild.col.mvp'), op: true },
  ], a.guilds.map((g) => h('tr', {},
    td(num(g.pos), { num: true }),
    td(g.nome),
    td(numCurto(g.dano), { num: true }),
    td(num(g.abates), { num: true }),
    td(`${num(g.vivos)}/${num(g.lutadores)}`, { num: true, op: true }),
    td(g.mvp ?? '—', { op: true })))) : null;

  const maior = Math.max(1, ...a.jogadores.map((j) => j.dano));
  const jogadores = a.jogadores.length ? tabela([
    { titulo: t('guild.col.lutador') }, { titulo: t('guild.col.time'), op: true },
    { titulo: t('guild.col.dano'), num: true },
    { titulo: t('guild.col.recebido'), num: true, op: true },
    { titulo: t('guild.col.abates'), num: true },
    { titulo: t('guild.col.caiu'), num: true, op: true },
  ], a.jogadores.map((j) => h('tr', {},
    td(linkJogador(j.nick)),
    td(h('span', { class: 'tk-partida-time' },
      j.pks.map((pk) => {
        const el = retrato(pk.looktype, 'p', pk.caiu ? 'caiu' : '');
        el.title = `${pk.nome} — ${t('guild.col.dano')} ${num(pk.dano)}`;
        return el;
      })), { op: true }),
    td(barra(j.dano / maior, numCurto(j.dano)), { num: true }),
    td(numCurto(j.recebido), { num: true, op: true }),
    td(num(j.abates), { num: true }),
    td(num(j.mortes), { num: true, op: true })))) : null;

  const especies = a.especies.length ? tabela([
    { titulo: t('meta.col.pokemon') }, { titulo: t('guild.col.usos'), num: true },
    { titulo: t('guild.col.dano'), num: true }, { titulo: t('guild.col.abates'), num: true },
  ], a.especies.map((e) => h('tr', {},
    td(h('span', { class: 'tk-pk' }, retrato(e.looktype), h('span', {}, e.shiny ? '✨ ' : '', e.nome))),
    td(num(e.usos), { num: true }),
    td(numCurto(e.dano), { num: true }),
    td(num(e.abates), { num: true })))) : null;

  const golpes = a.golpes.length ? tabela([
    { titulo: t('meta.col.golpe') }, { titulo: t('meta.col.usos'), num: true },
    { titulo: t('guild.col.dano'), num: true },
  ], a.golpes.map((g) => h('tr', {},
    td(h('span', {}, g.nome, ' ', selosDeTipo(g.tipo ? [g.tipo] : []))),
    td(num(g.usos), { num: true }),
    td(numCurto(g.dano), { num: true })))) : null;

  const tot = a.totais ?? {};
  return h('div', {},
    h('p', { class: 'tk-dim', estilo: { fontSize: '11px', marginBottom: '8px' } },
      [`${num(tot.lutadores ?? 0)} ${t('guild.col.guildLutadores')}`,
       `${num(tot.abates ?? 0)} ${t('guild.col.abates')}`,
       `${numCurto(tot.dano ?? 0)} ${t('guild.col.dano')}`,
       duracao(a.dur)].join(' · ')),
    h('h3', { texto: t('guild.destaques') }), destaques,
    guilds ? h('div', {}, h('h3', { texto: t('guild.ranking') }), guilds) : null,
    jogadores ? h('div', {}, h('h3', { texto: t('guild.col.lutador') }), jogadores) : null,
    h('div', { class: 'tk-relatorio-cols' },
      especies ? h('div', {}, h('h3', { texto: t('guild.especies') }), especies) : null,
      golpes ? h('div', {}, h('h3', { texto: t('guild.golpes') }), golpes) : null));
}

// ---- jogador

async function telaJogador(nick) {
  mostrar(carregando());
  const d = await api('jogador', { nick });
  const j = d.jogador;
  const r = d.rank;
  const tot = d.totais;

  document.title = `${j.nick} · PokéIdle Tracker`;

  const cartaoPerfil = h('section', { class: 'tk-quadro tk-tela' },
    h('div', { class: 'tk-perfil' },
      retrato(j.looktype, 'xg'),
      h('div', { class: 'tk-perfil-nick', texto: j.nick }),
      h('div', { class: 'tk-perfil-linha', texto: t('j.nivel', { n: num(j.nivel) }) }),
      j.guild ? h('div', { class: 'tk-perfil-linha', texto: j.guild.nome }) : null,
      r
        ? h('div', { class: 'tk-tier', dados: { tier: r.tierId } },
            h('img', { src: `/img/ranks/${r.tierId}.webp`, alt: '', width: 22, height: 22 }),
            h('span', {}, `${num(r.pontos)} PR`),
            r.posicao ? h('small', { class: 'tk-dim', texto: ` ${t('j.posicao', { n: r.posicao })}` }) : null)
        : h('div', { class: 'tk-tier', texto: t('j.semRank') }),
      r ? h('div', { class: 'tk-perfil-placar' },
            h('b', { class: 'tk-vit', texto: `${num(r.vitorias)}V` }),
            h('i', { texto: '·' }),
            h('b', { class: 'tk-der', texto: `${num(r.derrotas)}D` }),
            h('i', { texto: '·' }),
            h('b', { texto: pct(r.winrate) })) : null,
      r ? h('div', { estilo: { width: '100%' } },
        barra(r.winrate, pct(r.winrate), corDaTaxa(r.winrate))) : null,
      h('div', { class: 'tk-perfil-linha tk-dim', texto: t('j.desde', { d: mesCurto(j.desde) }) })));

  if (!tot && !d.partidas.length) {
    return mostrar(h('div', { class: 'tk-colunas' },
      cartaoPerfil,
      h('section', { class: 'tk-quadro' }, vazio(t('j.semDados')))));
  }

  const resumo = tot ? secao(t('j.resumo'),
    h('div', { class: 'tk-cards' },
      cartaoNumero(t('j.st.partidas'), num(tot.partidas)),
      cartaoNumero(t('j.st.winrate'), pct(tot.partidas ? tot.vitorias / tot.partidas : 0, 1)),
      cartaoNumero(t('j.st.dano'), numCurto(tot.danoMedio)),
      cartaoNumero(t('j.st.recebido'), numCurto(tot.recebidoMedio)),
      cartaoNumero(t('j.st.abates'), doisDecimais(tot.abatesMedio)),
      cartaoNumero(t('j.st.duracao'), duracao(tot.duracaoMedia)))) : null;

  const pokemons = d.pokemons.length ? secao(t('j.pokemons'), tabela([
    { titulo: t('j.col.pokemon') }, { titulo: t('j.col.partidas'), num: true },
    { titulo: t('j.col.winrate'), num: true }, { titulo: t('j.col.dano'), num: true },
    { titulo: t('j.col.fatia'), num: true, op: true },
    { titulo: t('j.col.recebido'), num: true, op: true },
    { titulo: t('j.col.abates'), num: true }, { titulo: t('j.col.caiu'), num: true, op: true },
  ], d.pokemons.map((pk) => h('tr', {},
    td(celulaPokemon(pk)),
    td(num(pk.partidas), { num: true }),
    td(barra(pk.winrate, pct(pk.winrate), corDaTaxa(pk.winrate)), { num: true }),
    td(numCurto(pk.dano), { num: true }),
    td(barra(pk.fatiaDano, pct(pk.fatiaDano), 'var(--laranja)'), { num: true, op: true }),
    td(numCurto(pk.recebido), { num: true, op: true }),
    td(num(pk.abates), { num: true }),
    td(`${num(pk.mortes)}/${num(pk.entradas)}`, { num: true, op: true }))))) : null;

  const confronto = (titulo, lista, ruim) => lista.length ? secao(titulo, tabela(
    [{ titulo: t('pk.col.rival') }, { titulo: t('meta.col.partidas'), num: true },
     { titulo: t('meta.col.winrate'), num: true }],
    lista.map((c) => h('tr', {},
      td(celulaPokemon(c)),
      td(num(c.partidas), { num: true }),
      td(barra(c.winrate, pct(c.winrate), ruim ? 'var(--vermelho)' : 'var(--verde)'), { num: true }))))) : null;

  const golpes = d.golpes.length ? secao(t('j.golpes'), tabela(
    [{ titulo: t('meta.col.golpe') }, { titulo: t('meta.col.usos'), num: true },
     { titulo: t('meta.col.medio'), num: true, op: true }, { titulo: t('meta.col.total'), num: true }],
    d.golpes.map((g) => h('tr', {},
      td(h('span', {}, g.nome, ' ', selosDeTipo(g.tipo ? [g.tipo] : []))),
      td(num(g.usos), { num: true }),
      td(num(g.medio), { num: true, op: true }),
      td(numCurto(g.dano), { num: true }))))) : null;

  const partidas = secao(t('j.partidasN', { n: d.partidas.length }),
    d.partidas.length
      ? h('div', {}, d.partidas.map((p) => linhaPartida(p, j.nick)))
      : vazio(t('j.semPartidas')));

  mostrar(h('div', { class: 'tk-colunas' },
    h('div', {}, cartaoPerfil, confronto(t('j.counters'), d.counters, true),
      confronto(t('j.vitimas'), d.vitimas, false), golpes),
    h('div', {}, resumo, pokemons, partidas)));
}

/** Uma partida do histórico: a fita fechada, e o relatório que abre embaixo dela. */
function linhaPartida(p, meuNick) {
  const caixa = h('div', { class: `tk-partida ${p.venci ? 'v' : 'd'}` });

  const times = h('span', { class: 'tk-partida-time' },
    (p.eu?.pks ?? []).map((pk) => {
      const el = retrato(pk.looktype, 'p', pk.caiu ? 'caiu' : '');
      el.title = `${pk.nome} — ${t('j.rel.dano')} ${num(pk.dano)}`;
      return el;
    }));

  const cab = h('button', {
    type: 'button', class: 'tk-partida-cab', 'aria-expanded': 'false',
    onclick: () => {
      const aberta = caixa.classList.toggle('aberta');
      cab.setAttribute('aria-expanded', aberta ? 'true' : 'false');
      seta.textContent = aberta ? '▲' : '▼';
    },
  });

  const seta = h('span', { class: 'tk-partida-seta', texto: '▼' });

  cab.append(
    h('span', { class: 'tk-partida-res', title: dataHora(p.em) },
      h('b', { class: p.venci ? 'tk-vit' : 'tk-der', texto: t(p.venci ? 'j.vitoria' : 'j.derrota') }),
      h('small', {}, `${quandoFoi(p.em)} · ${duracao(p.duracaoMs)}`)),
    h('span', { class: 'tk-partida-vs' },
      `${t('j.contra')} `, linkJogador(p.oponente.nick, h('b', { texto: p.oponente.nick })),
      h('small', { class: 'tk-dim', texto: ` ${num(p.oponente.pontos)} PR` })),
    times,
    h('span', { class: 'tk-partida-pr' },
      h('b', { class: p.delta >= 0 ? 'tk-vit' : 'tk-der', texto: `${p.delta >= 0 ? '+' : ''}${num(p.delta)}` }),
      ' ', seta));

  const rel = h('div', { class: 'tk-relatorio' });
  if (!p.eu || !p.ele) {
    rel.append(vazio(t('j.rel.semFicha')));
  } else {
    rel.append(h('div', { class: 'tk-relatorio-cols' },
      blocoLado(t('j.rel.meuTime'), p.eu, meuNick),
      blocoLado(t('j.rel.time', { nick: p.oponente.nick }), p.ele, p.oponente.nick)));
  }

  caixa.append(cab, rel);
  return caixa;
}

/** Um lado do relatório: os pokémon com dano/recebido/abates e os golpes que renderam. */
function blocoLado(titulo, lado, nick) {
  const maxDano = Math.max(1, ...lado.pks.map((x) => x.dano));
  const linhas = lado.pks.map((pk) => h('tr', {},
    td(h('span', { class: 'tk-pk' },
      retrato(pk.looktype, '', pk.caiu ? 'caiu' : ''),
      h('span', { class: 'tk-pk-nome' },
        h('span', {}, pk.shiny ? '✨ ' : '', pk.nome),
        h('small', { texto: `Nv ${num(pk.nivel)} · ${pk.caiu ? t('j.rel.caiu') : t('j.rel.vivo')}` })))),
    td(barra(pk.dano / maxDano, numCurto(pk.dano), 'var(--rx)'), { num: true }),
    td(numCurto(pk.recebido), { num: true }),
    td(num(pk.abates), { num: true })));

  return h('div', {},
    h('h3', { texto: titulo }),
    h('p', { class: 'tk-dim', estilo: { fontSize: '11px', marginBottom: '4px' } },
      `${t('j.rel.dano')} ${numCurto(lado.d)} · ${t('j.rel.recebido')} ${numCurto(lado.r)} · ${t('j.rel.abates')} ${num(lado.k)}`),
    tabela([
      { titulo: nick }, { titulo: t('j.rel.dano'), num: true },
      { titulo: t('j.rel.recebido'), num: true }, { titulo: t('j.rel.abates'), num: true },
    ], linhas),
    lado.maior
      ? h('p', { class: 'tk-dim', estilo: { fontSize: '10.5px', marginTop: '5px' },
          texto: t('j.rel.maior', { v: num(lado.maior.valor), golpe: lado.maior.nome, pk: lado.maior.pokemon }) })
      : null,
    lado.golpes?.length
      ? h('div', {}, h('h3', { texto: t('j.rel.golpes') }),
          h('div', {}, lado.golpes.map((g) => h('div', { class: 'tk-pk', estilo: { marginBottom: '3px' } },
            selosDeTipo(g.tipo ? [g.tipo] : []),
            h('span', { texto: g.nome }),
            h('span', { class: 'tk-dim', estilo: { marginLeft: 'auto' }, texto: `${num(g.usos)}× · ${numCurto(g.dano)}` })))))
      : null);
}

// ---------------------------------------------------------------- desenhar

const TITULO_BASE = 'PokéIdle Tracker · estatísticas de PvP, meta e ranking';

async function desenhar() {
  const { tela, arg } = rotaAtual();
  document.title = TITULO_BASE;
  marcarNav(tela);
  fecharMenu();
  try {
    if (tela === 'jogador') await telaJogador(arg);
    else if (tela === 'pokemon') await telaPokemon(arg);
    else if (tela === 'meta') await telaMeta();
    else if (tela === 'ladder') await telaLadder();
    else if (tela === 'guilds') await telaGuilds();
    else await telaInicio();
  } catch (err) {
    mostrarErro(err);
  }
}

// ------------------------------------------------------------ a barra fixa

const NAV = [
  { tela: 'inicio', destino: '/tracker', chave: 'nav.inicio' },
  { tela: 'meta', destino: '/tracker/meta', chave: 'nav.meta' },
  { tela: 'ladder', destino: '/tracker/ladder', chave: 'nav.ladder' },
  { tela: 'guilds', destino: '/tracker/guilds', chave: 'nav.guilds' },
];

function montarNav() {
  $('#tk-nav').replaceChildren(...NAV.map((n) =>
    link(n.destino, t(n.chave), { dados: { tela: n.tela } })));
}

const marcarNav = (tela) => {
  for (const a of $('#tk-nav').children) a.classList.toggle('on', a.dataset.tela === tela);
};

const fecharMenu = () => {
  $('#tk-nav').classList.remove('aberto');
  $('#tk-menu-bt').setAttribute('aria-expanded', 'false');
};

function montarIdiomas() {
  const host = $('#tk-idiomas');
  host.replaceChildren(...IDIOMAS.map((l) => {
    const b = h('button', {
      type: 'button', class: l.id === idioma ? 'on' : '', 'aria-label': l.id,
      onclick: () => trocarIdioma(l.id),
    });
    // O único `innerHTML` da página, e o conteúdo é uma constante escrita aqui em cima.
    b.innerHTML = BANDEIRAS[l.id];
    return b;
  }));
}

function trocarIdioma(id) {
  if (!DIC[id] || id === idioma) return;
  idioma = id;
  try { localStorage.setItem('idioma', id); } catch { /* sem localStorage, vale só esta visita */ }
  document.documentElement.lang = IDIOMAS.find((l) => l.id === id)?.lang ?? 'pt-BR';
  aplicarTextosFixos();
  montarIdiomas();
  desenhar();
}

function aplicarTextosFixos() {
  montarNav();
  $('#tk-q').placeholder = t('buscarDica');
  $('#tk-q').setAttribute('aria-label', t('buscar'));
  $('#tk-busca-bt').querySelector('em').textContent = t('buscar');
  $('#tk-jogar').textContent = t('jogar');
  $('#tk-rodape-nota').textContent = t('rodape');
}

// ------------------------------------------------------------------ busca

let buscaTimer = 0;
let buscaSeq = 0;

function montarBusca() {
  const campo = $('#tk-q');
  const sug = $('#tk-sug');

  const fechar = () => { sug.hidden = true; sug.replaceChildren(); };

  const abrir = (linhas) => {
    if (!linhas.length) return fechar();
    sug.replaceChildren(...linhas.map((l) => h('li', {
      role: 'option',
      onmousedown: (ev) => { ev.preventDefault(); campo.value = l.nick; fechar(); ir(`/tracker/j/${encodeURIComponent(l.nick)}`); },
    },
      retrato(l.looktype, 'p'),
      h('span', { texto: l.nick }),
      h('span', { class: 'tk-sug-nv', texto: l.pontos != null ? `${num(l.pontos)} PR` : t('j.nivel', { n: num(l.nivel) }) }))));
    sug.hidden = false;
  };

  campo.addEventListener('input', () => {
    clearTimeout(buscaTimer);
    const q = campo.value.trim();
    if (q.length < 2) return fechar();
    // Meio segundo de espera. Sem ele, cada tecla de um nick de dez letras seria uma consulta
    // — e o teto por IP da API estouraria com uma pessoa só digitando devagar.
    buscaTimer = setTimeout(async () => {
      const meu = ++buscaSeq;
      try {
        const d = await api('busca', { q });
        // Resposta de uma digitação ANTERIOR chega depois da atual quando a rede varia. Sem
        // esta guarda, a lista piscaria para trás.
        if (meu === buscaSeq) abrir(d.linhas ?? []);
      } catch { fechar(); }
    }, 500);
  });

  campo.addEventListener('blur', () => setTimeout(fechar, 120));
  campo.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') fechar(); });

  $('#tk-busca').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const q = campo.value.trim();
    if (!q) return;
    fechar();
    campo.blur();
    ir(`/tracker/j/${encodeURIComponent(q)}`);
  });
}

// ------------------------------------------------------------------ início

document.documentElement.lang = IDIOMAS.find((l) => l.id === idioma)?.lang ?? 'pt-BR';
aplicarTextosFixos();
montarIdiomas();
montarBusca();

$('#tk-menu-bt').addEventListener('click', () => {
  const nav = $('#tk-nav');
  const aberto = nav.classList.toggle('aberto');
  $('#tk-menu-bt').setAttribute('aria-expanded', aberto ? 'true' : 'false');
});

window.addEventListener('popstate', desenhar);
desenhar();
