/* LANDING PAGE — o pouco de script que ela precisa.
   ============================================================================
   Quatro coisas, e nenhuma delas é enfeite:

     1. **Quem já joga não vê a página de venda.** Se há sessão no `localStorage`, a landing
        reenvia direto para `/app`, levando a query string junto.
     1b. **Referral (`?ref=`)** — grava no `localStorage` e repassa nos CTAs para `/app`, igual
        ao `app.js`. Sem isto, quem chega pelo link de afiliado e clica em "Jogar grátis" perde
        o código antes de criar a conta.
     2. **O vídeo só baixa quando vale a pena.** 4 MB em `autoplay` no 4G custa o pacote de
        dados de quem chegou pelo anúncio — e a primeira dobra tem de pintar antes disso.
     3. **A fila de gerações e o chat** são montados aqui, para o HTML não carregar dezoito
        blocos quase iguais escritos à mão.
     3d. **O lançamento**: o dia do servidor oficial, os números que sobem do zero e o confete
        da seção de festa — tudo com o valor final já no HTML, para quem lê sem JS.
     4. **O clique no CTA é medido** — é o único número que diz se a página funciona.

   Script clássico, sem módulo e sem dependência: a página tem de pintar e funcionar antes de
   qualquer coisa em rede. */

(function () {
  'use strict';

  // ───────────────────────────────────────────────────── 1. quem já joga, entra
  //
  // A landing é uma página de VENDA. Para quem volta todo dia ela é um pedágio: dois cliques a
  // mais entre o atalho e a hunt. Se o `localStorage` tem sessão, essa pessoa já comprou — vai
  // direto.
  //
  // `location.replace` e não `href`: com `href` a landing fica no histórico e o botão "voltar"
  // do navegador devolve a pessoa para cá, que a manda para o jogo de novo — a armadilha
  // clássica de redirecionamento em página inicial.
  //
  // A query string vai junto porque é por ela que chegam `?sessao=` (retorno do OAuth),
  // `?erroAuth=`, `?emailOk=` e o `?hunt=` das ferramentas.
  try {
    if (localStorage.getItem('sessao')) {
      location.replace('/app' + location.search + location.hash);
      return;
    }
  } catch (_) { /* localStorage bloqueado (aba anônima com cookies off): segue na landing */ }

  // ─────────────────────────────────────────────── 1b. referral (?ref=) na landing
  //
  // O link de afiliado é `/?ref=CODIGO`. Os CTAs do HTML apontam para `/app` sem query — quem
  // clica perde o código antes do `app.js` rodar. Mesma chave e mesma validação do jogo.
  //
  // A forma aceita é FROUXA de propósito, e cobre os dois tipos de link: o código gerado
  // (`ABC2345`) e o slug de streamer (`matta`). Quem decide se existe é o servidor — aqui é
  // só higiene, para não gravar lixo no localStorage nem bater na rota à toa. E NÃO se
  // normaliza mais para maiúscula: o slug é minúsculo, e o `toUpperCase()` o destruía antes
  // mesmo de sair do navegador. A busca no banco é `lower()` nos dois lados, então a caixa
  // que se grava aqui não muda nada.
  var CHAVE_REF = 'pokeidle_ref';
  var paramsRef = new URLSearchParams(location.search);
  var refUrl = paramsRef.get('ref');
  if (refUrl) {
    refUrl = refUrl.trim();
    if (/^[a-z0-9][a-z0-9_-]{1,18}[a-z0-9]$/i.test(refUrl)) {
      try { localStorage.setItem(CHAVE_REF, refUrl); } catch (_) {}
      fetch('/affiliate/visita', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: refUrl }),
      }).catch(function () {});
    }
  }
  var sufixoApp = location.search + location.hash;
  var linksApp = document.querySelectorAll('a[href="/app"]');
  for (var i = 0; i < linksApp.length; i++) {
    linksApp[i].href = '/app' + sufixoApp;
  }

  // ────────────────────────────────────────────────────────────── 2. os vídeos
  //
  // Os dois `<video>` nascem com `preload="none"` e sem `src` — o endereço mora em `data-src`.
  // Enquanto ninguém decidir baixar, o que existe na página é o pôster (244 KB de JPEG).
  //
  // O laço do herói só entra em autoplay quando as TRÊS condições valem:
  //   · a tela é de desktop (≥ 861 px) — no celular o dado é caro e a tela é pequena;
  //   · o visitante não pediu economia de dados (`saveData`);
  //   · a conexão não é lenta (`effectiveType` 2g/3g).
  // Quando alguma falha, aparece o botão de tocar e a decisão é da pessoa.
  var conexao = navigator.connection || {};
  var economizando = conexao.saveData === true || /2g/.test(conexao.effectiveType || '');
  var telaGrande = window.matchMedia('(min-width: 861px)').matches;
  var animacaoOk = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function ligar(video, tocarSozinho) {
    if (video.src) return Promise.resolve();
    video.src = video.dataset.src;
    if (!tocarSozinho) return Promise.resolve();
    var p = video.play();
    // Navegador pode recusar o autoplay mesmo mudo (política de mídia). `catch` para o console
    // não encher de promessa rejeitada — o botão de tocar continua ali como plano B.
    return p && p.catch ? p.catch(function () {}) : Promise.resolve();
  }

  /* Os dois arquivos `.webm` são gitignorados e sobem pelo deploy (ver `HOSPEDAGEM.md`), então
     num clone novo, ou num servidor onde o passo foi esquecido, eles simplesmente não existem.
     `seExistir` pergunta antes de qualquer coisa depender do arquivo.

     É um HEAD, e não o evento `error` do `<video>`: com `preload="none"` e o `src` posto só na
     hora de tocar, o `error` só apareceria DEPOIS do clique, e sumir com o botão debaixo do
     dedo de quem acabou de clicar é pior que o problema. O HEAD custa poucos bytes e resolve
     antes de alguém chegar lá. */
  function seExistir(video, tem, naoTem) {
    fetch(video.dataset.src, { method: 'HEAD' })
      .then(function (r) { (r.ok ? tem : naoTem)(); })
      .catch(naoTem);
    video.addEventListener('error', naoTem);   // rede de segurança: existe, mas está corrompido
  }

  var loop = document.getElementById('video-loop');
  var botaoLoop = document.getElementById('botao-tocar');
  if (loop) {
    seExistir(loop, function () {
      if (telaGrande && !economizando && animacaoOk) {
        ligar(loop, true).then(function () {
          if (loop.paused) botaoLoop.hidden = false;
        });
      } else {
        botaoLoop.hidden = false;
      }
    }, function () {
      /* Sem o vídeo, o herói fica com o PÔSTER, que é um print de verdade do jogo e continua
         fazendo o trabalho. O que não pode sobrar é o botão de tocar, que não tocaria nada. */
      botaoLoop.hidden = true;
    });

    botaoLoop.addEventListener('click', function () {
      botaoLoop.hidden = true;
      ligar(loop, true);
    });
  }

  // O tour de 40 s NUNCA baixa sozinho: são 12 MB, e ninguém deve pagar por um vídeo que não
  // pediu. Ele tem `controls`, então depois do primeiro clique o navegador cuida do resto.
  var tour = document.getElementById('video-tour');
  var botaoTour = document.getElementById('botao-tour');
  if (tour && botaoTour) {
    botaoTour.addEventListener('click', function () {
      botaoTour.hidden = true;
      ligar(tour, true);
    });

    /* Sem o arquivo, a seção INTEIRA sai da página. Aqui não dá para cair no pôster como o
       herói faz: a seção existe só para o vídeo, e um play que não toca nada é pior do que
       seção nenhuma. Nada mais no site aponta para esta âncora, então some sem deixar buraco. */
    seExistir(tour, function () {}, function () {
      var secao = document.getElementById('video');
      if (secao) secao.hidden = true;
    });
  }

  // ────────────────────────────────────────────── 3a. a fila de nove gerações
  //
  // Uma espécie por geração, escolhida por dois critérios ao mesmo tempo: ser reconhecível de
  // longe por quem jogou os jogos, e TER sprite de verdade no pack. O segundo manda — boa
  // parte das gerações 8 e 9 está no catálogo do jogo sem sprite baixado.
  var GERACOES = [
    ['1', 'gen1-charizard', 'Charizard'],
    ['2', 'gen2-lugia', 'Lugia'],
    ['3', 'gen3-rayquaza', 'Rayquaza'],
    ['4', 'gen4-garchomp', 'Garchomp'],
    ['5', 'gen5-hydreigon', 'Hydreigon'],
    ['6', 'gen6-sylveon', 'Sylveon'],
    ['7', 'gen7-kommoo', 'Kommo-o'],
    ['8', 'gen8-cinderace', 'Cinderace'],
    ['9', 'gen9-armarouge', 'Armarouge'],
  ];
  var alvoGer = document.getElementById('geracoes');
  if (alvoGer) {
    alvoGer.innerHTML = GERACOES.map(function (g) {
      return '<div class="ger">'
           +   '<img src="midia/sprites/' + g[1] + '.png" alt="' + g[2] + '" loading="lazy">'
           +   '<span class="rot">GEN ' + g[0] + '</span>'
           +   '<span class="esp">' + g[2] + '</span>'
           + '</div>';
    }).join('');
  }

  // ────────────────────────────────────────────────────────── 3b. o chat falso
  //
  // As cores de nick são as de cargo do jogo (`--ch-*` em `estilo.css`): VIP azul, moderador
  // verde, streamer roxo, admin vermelho. É o brilho que faz o nome saltar numa lista em que
  // todo o resto já é amarelo forte.
  //
  // Linha sem nick é ANÚNCIO do jogo, como no chat de verdade: o drop Lendário sai em ouro e a
  // captura shiny em lilás, sem remetente na frente.
  var FALAS = [
    ['21:43', '', 'lendario', '[DROP Lendário] O jogador Zenryoku dropou uma Bike Lendária!'],
    ['21:43', 'Zenryoku', 'com', 'KKKKKK +100% de velocidade, até mais'],
    ['21:44', '', 'shiny', '✨ O JOGADOR Charles ACABA DE CAPTURAR UM SHINY Gengar!'],
    ['21:45', 'Mendelin', 'mod', 'parabéns aos dois! posta o print no Discord'],
    ['21:46', 'no9527', 'com', 'guerra hoje 22h, quem tá dentro?'],
    ['21:47', 'bleakcim', 'str', 'subi pra Diamante no ranqueado'],
    ['21:48', 'Staff', 'admin', 'evento global ligado: +50% de XP por 2 horas'],
    ['21:49', 'riq', 'com', 'alguém vende Shiny Stone? pago em gema'],
  ];
  var alvoChat = document.getElementById('chat-linhas');
  if (alvoChat) {
    alvoChat.innerHTML = FALAS.map(function (f) {
      if (!f[1]) return '<p class="' + f[2] + '"><span class="hora">' + f[0] + '</span>' + f[3] + '</p>';
      return '<p><span class="hora">' + f[0] + '</span>'
           + '<span class="nick ' + f[2] + '">' + f[1] + ':</span> ' + f[3] + '</p>';
    }).join('');
  }

  // ─────────────────────────────────────────── 3d. o dia do servidor oficial
  //
  // O lançamento foi em 7 de setembro de 2026, meia-noite de Brasília (03:00 UTC), e esse dia é
  // o dia 1. Quem tem `data-dia-oficial` troca o texto pelo molde com `{n}` — um número que muda
  // sozinho e continua verdadeiro sem ninguém editar a página. Sem JS fica o texto do HTML.
  var LANCAMENTO_UTC = Date.UTC(2026, 8, 7, 3, 0, 0);
  var diaOficial = Math.floor((Date.now() - LANCAMENTO_UTC) / 86400000) + 1;
  if (diaOficial >= 1) {
    var alvosDia = document.querySelectorAll('[data-dia-oficial]');
    for (var d = 0; d < alvosDia.length; d++) {
      alvosDia[d].textContent = alvosDia[d].getAttribute('data-dia-oficial').replace('{n}', diaOficial);
    }
  }

  // ─────────────────────────────────────────── 3e. os números sobem na tela
  //
  // O HTML já traz o número final. Só quando a fileira ENTRA na tela ele volta a zero e sobe —
  // antes disso ninguém vê, e quem não pediu movimento fica com o número parado.
  function contar(el) {
    var alvo = Number(el.getAttribute('data-conta'));
    var inicio = null;
    function quadro(t) {
      if (inicio === null) inicio = t;
      var f = Math.min(1, (t - inicio) / 1400);
      el.textContent = Math.round(alvo * (1 - Math.pow(1 - f, 3))).toLocaleString('pt-BR');
      if (f < 1) requestAnimationFrame(quadro);
    }
    requestAnimationFrame(quadro);
  }
  var numeros = document.querySelectorAll('[data-conta]');
  if (numeros.length && animacaoOk && 'IntersectionObserver' in window) {
    var obsNumeros = new IntersectionObserver(function (entradas) {
      for (var n = 0; n < entradas.length; n++) {
        if (!entradas[n].isIntersecting) continue;
        obsNumeros.unobserve(entradas[n].target);
        contar(entradas[n].target);
      }
    }, { threshold: 0.5 });
    for (var k = 0; k < numeros.length; k++) obsNumeros.observe(numeros[k]);
  }

  // ─────────────────────────────────── 3g. a meta de 100 mil treinadores
  //
  // O número é o de CONTAS registradas, contado no banco pelo gateway (`/treinadores`, com um
  // minuto de cache). Não é o "online": aquele soma o acréscimo do painel admin, e a promessa
  // aqui é o contrário — o número de verdade. Sem resposta o bloco continua escondido: uma barra
  // parada no zero diria que ninguém joga.
  var meta = document.getElementById('meta-treinadores');
  function mostrarMeta(total, alvo) {
    var frac = Math.min(1, total / alvo);
    var elTotal = document.getElementById('meta-total');
    var barra = meta.querySelector('.meta-barra');
    elTotal.setAttribute('data-conta', String(total));
    elTotal.textContent = total.toLocaleString('pt-BR');
    meta.querySelector('.meta-pct').textContent =
      (frac * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%';
    document.getElementById('meta-falta').textContent = total >= alvo
      ? 'Meta batida! Obrigado, treinadores!'
      : 'Faltam ' + (alvo - total).toLocaleString('pt-BR') + '. Chama a galera!';
    barra.setAttribute('aria-valuenow', String(total));
    // Abaixo de ~12% o ouro é curto demais para caber o "9,2%" dentro: o rótulo sai para depois
    // da ponta (ver `.pct-fora` no CSS).
    meta.classList.toggle('pct-fora', frac < 0.12);
    var marcos = meta.querySelectorAll('.meta-marco');
    for (var mk = 0; mk < marcos.length; mk++) {
      if (frac * 100 >= Number(marcos[mk].getAttribute('data-em'))) marcos[mk].classList.add('batido');
    }
    meta.hidden = false;
    // A barra enche quando ENTRA na tela. Um fio mínimo fica visível mesmo no começo da meta:
    // 0,4% seria um risco que não se enxerga, e a graça é ver que já andou.
    function encher() {
      barra.style.setProperty('--p', String(Math.max(frac, 0.02)));
      meta.querySelector('.meta-enche').style.setProperty('--p', String(Math.max(frac, 0.02)));
      meta.classList.add('cheia');
      if (animacaoOk) contar(elTotal);
    }
    if (animacaoOk && 'IntersectionObserver' in window) {
      var obsMeta = new IntersectionObserver(function (entradas) {
        if (!entradas[0].isIntersecting) return;
        obsMeta.disconnect();
        encher();
      }, { threshold: 0.4 });
      obsMeta.observe(meta);
    } else {
      encher();
    }
  }
  if (meta && window.fetch) {
    fetch('/treinadores', { headers: { accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (d && d.ok && typeof d.total === 'number' && d.total >= 0 && d.meta > 0) mostrarMeta(d.total, d.meta);
      })
      .catch(function () {});
  }

  // ─────────────────────────────────────────── 3f. o confete da festa
  //
  // 36 peças, cada uma com cor, duração, atraso negativo (para já nascerem espalhadas, e não
  // todas no topo ao mesmo tempo) e vento próprios. A animação só roda com a seção na tela: a
  // classe `.ativo` liga e desliga o `animation-play-state` no CSS.
  var festa = document.querySelector('.lancamento');
  var confete = document.getElementById('lanc-confete');
  if (festa && confete && animacaoOk) {
    var CORES = ['#ffe07a', '#ffa7d7', '#6fd08a', '#7fd4ff', '#b67dff', '#ffffff', '#f0a03c'];
    var pecas = '';
    for (var c = 0; c < 36; c++) {
      pecas += '<i style="left:' + (Math.random() * 100).toFixed(1) + '%;'
             + '--c:' + CORES[c % CORES.length] + ';'
             + '--d:' + (4.5 + Math.random() * 4).toFixed(2) + 's;'
             + '--atraso:-' + (Math.random() * 8).toFixed(2) + 's;'
             + '--vento:' + Math.round(Math.random() * 140 - 70) + 'px"></i>';
    }
    confete.innerHTML = pecas;
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entradas) {
        festa.classList.toggle('ativo', entradas[0].isIntersecting);
      }).observe(festa);
    } else {
      festa.classList.add('ativo');
    }
  }

  // ──────────────────────────────────────── 3c. a barra fixa só quando ela serve
  //
  // Enquanto o botão do herói está na tela, a barra de baixo é ruído: dois "Jogar grátis"
  // idênticos, um em cima do outro, competindo pelo mesmo clique. Ela entra quando ele sai.
  //
  // `IntersectionObserver` e não `scroll`: o listener de rolagem dispara dezenas de vezes por
  // segundo e obriga a ler layout a cada uma — num celular modesto isso aparece como
  // travadinha ao rolar, justamente na página que precisa parecer leve.
  var barra = document.querySelector('.barra-fixa');
  var heroiCta = document.querySelector('.heroi-botoes .cta-grande');
  if (barra && heroiCta && 'IntersectionObserver' in window) {
    new IntersectionObserver(function (entradas) {
      barra.classList.toggle('aparece', !entradas[0].isIntersecting);
    }, { rootMargin: '-10px' }).observe(heroiCta);
  } else if (barra) {
    barra.classList.add('aparece');   // sem observer, melhor sempre visível que nunca
  }

  // ────────────────────────────────────────────────────── 4. medir o que importa
  //
  // Uma landing sem isto é palpite: não dá para saber se o herói converte melhor que o
  // fechamento, nem se a barra do celular vale o espaço que ocupa. `data-cta` diz QUAL botão
  // foi clicado.
  //
  // O clique NÃO é interceptado — nada de `preventDefault` com `setTimeout` para "dar tempo
  // de enviar". Isso atrasa a navegação de quem clicou, e é exatamente o oposto do que uma
  // página de conversão deve fazer.
  document.addEventListener('click', function (e) {
    var alvo = e.target.closest('[data-cta]');
    if (!alvo) return;
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ event: 'clique_jogar', botao: alvo.dataset.cta });
    try { if (typeof fbq === 'function') fbq('track', 'Lead'); } catch (_) {}
  });
})();
