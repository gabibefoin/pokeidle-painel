// Termos de Uso, Política de Privacidade e Aviso de Direitos Autorais.
//
// ### Por que o texto mora em JS e não em três HTMLs
//
// São três idiomas do MESMO documento. Em HTML separado, a numeração das seções, o índice
// lateral e as âncoras teriam de ser mantidos em três lugares — e a primeira seção nova
// entraria só em português. Aqui a ESTRUTURA é uma só (`SECOES`, com o id de cada âncora) e o
// que muda por idioma é apenas o texto.
//
// ### O que este documento NÃO faz
//
// Não inventa fato. Todo número aqui — spread da Gema, comissão do Mercado, chance de shiny e
// de potência — foi lido do código que os aplica, e o comentário de cada bloco diz de onde.
// Um termo de uso que promete uma taxa diferente da cobrada é pior do que não ter termo.

// Mudou em 17/08/2026: entrou a tag do Google Ads (medição de conversão de anúncio), e com
// ela as seções 6, 7 e 8 — que até então afirmavam que o site não usava rastreador de
// publicidade nenhum. A data é o que diz ao jogador que o texto que ele leu antes mudou.
//
// Mudou em 15/09/2026, duas vezes no mesmo dia: a seção 5 deixou de dizer que automações são
// permitidas e, horas depois, voltou a permiti-las — agora apontando a extensão de automação do
// PokéIdle, distribuída no Discord (#how-to-play). A proibição de explorar vulnerabilidade para
// obter Gemas continua igual.
const ATUALIZADO = '2026-09-15';
const CONTATO = 'support@pokeidle.io';

/**
 * A ordem das seções e o id da âncora de cada uma. O índice lateral sai daqui.
 *
 * Direitos autorais vem em SEGUNDO, logo depois de "o que é isto": é a informação que um
 * detentor de marca chegando aqui veio buscar, e enterrá-la na seção 9 seria esconder.
 */
const SECOES = [
  'oque', 'direitos', 'remocao', 'conta', 'conduta',
  'privacidade', 'dados', 'cookies', 'diamantes', 'orbs', 'mercado',
  'sorteios', 'menores', 'garantias', 'mudancas', 'contato',
];

// ---------------------------------------------------------------- português

const pt = {
  titulo: 'Termos, Privacidade e Direitos',
  voltar: 'Voltar ao jogo',
  atualizado: `Última atualização: ${ATUALIZADO}`,
  indice: {
    oque: '1. O que é o Pokéidle.io',
    direitos: '2. Direitos autorais e marcas',
    remocao: '3. Pedido de remoção (titulares de direitos)',
    conta: '4. Sua conta',
    conduta: '5. Regras de conduta',
    privacidade: '6. Privacidade: o compromisso',
    dados: '7. Que dados coletamos',
    cookies: '8. Cookies e armazenamento local',
    diamantes: '9. Diamantes: moeda da Loja',
    orbs: '10. Gemas, compras e saques',
    mercado: '11. Mercado Global entre jogadores',
    sorteios: '12. Sorteios e probabilidades',
    menores: '13. Menores de idade',
    garantias: '14. Garantias e responsabilidade',
    mudancas: '15. Mudanças nestes termos',
    contato: '16. Contato',
  },
  corpo: {
    oque: `
      <h2>1. O que é o Pokéidle.io</h2>
      <p>O Pokéidle.io é um <b>jogo de navegador feito por fãs</b> (<i>fan game</i>), sem fins
      de representação oficial e <b>sem qualquer vínculo, patrocínio, endosso ou afiliação</b>
      com a Nintendo Co., Ltd., a Game Freak Inc., a Creatures Inc. ou a The Pokémon Company
      International.</p>
      <p>Ao acessar ou usar o site e o jogo, você concorda com estes Termos e com a Política
      de Privacidade abaixo. Se não concordar com qualquer parte, por favor não use o serviço.</p>`,

    direitos: `
      <h2>2. Direitos autorais e marcas</h2>
      <div class="doc-aviso">
        <p><b>Pokémon</b>, <b>Pokébola</b>, os nomes e as imagens de todas as criaturas, e todos
        os demais elementos da franquia são <b>marcas registradas e obras protegidas</b> de
        Nintendo, Game Freak, Creatures e The Pokémon Company. <b>Nós não detemos nenhum desses
        direitos.</b></p>
        <p>Este projeto é uma homenagem feita por fãs. Nenhum conteúdo original da franquia é
        vendido por nós, e nenhuma parte deste site deve ser interpretada como um produto,
        serviço ou comunicação oficial dos titulares.</p>
      </div>
      <p>O código-fonte que escrevemos, a arte de interface que produzimos e os textos deste
      documento são nossos. Os materiais de terceiros usados no jogo pertencem aos seus
      respectivos titulares e são empregados aqui em contexto de projeto de fã.</p>
      <p>Se você é titular de direitos sobre algum material presente no jogo e não deseja que
      ele permaneça, leia a seção seguinte — nós atendemos.</p>`,

    remocao: `
      <h2>3. Pedido de remoção (titulares de direitos)</h2>
      <p>Se você é titular — ou representante autorizado do titular — de direitos autorais ou
      de marca sobre qualquer conteúdo presente aqui, e deseja a <b>remoção do material ou do
      site inteiro do ar</b>, escreva para <a href="mailto:${CONTATO}">${CONTATO}</a> com o
      assunto <b>"Pedido de remoção"</b>.</p>
      <h3>O que incluir no pedido</h3>
      <ul>
        <li>Identificação do material e onde ele aparece (URL, tela ou descrição).</li>
        <li>Identificação de quem é o titular do direito.</li>
        <li>Seus dados de contato e, se for representante, a indicação dessa condição.</li>
        <li>Uma declaração de que o uso não foi autorizado pelo titular nem pela lei.</li>
      </ul>
      <h3>O nosso compromisso</h3>
      <p>Confirmamos o recebimento em até <b>72 horas</b> e retiramos o material apontado em
      até <b>7 dias corridos</b> a partir da confirmação. Se o pedido abranger o serviço como
      um todo, <b>tiramos o site do ar</b> dentro do mesmo prazo. Não exigimos ordem judicial
      para cumprir um pedido legítimo de titular, e não discutimos o mérito do pedido antes de
      atendê-lo.</p>`,

    conta: `
      <h2>4. Sua conta</h2>
      <ul>
        <li>Você pode criar conta com <b>e-mail e senha</b> ou entrar por <b>Google</b> ou
        <b>Discord</b>. Contas criadas com senha exigem <b>confirmação do e-mail</b> antes do
        primeiro acesso.</li>
        <li>O <b>nome do personagem (nick)</b> é único no jogo inteiro e é a identidade pública
        da sua conta. Ele pode ser alterado apenas pelo item pago correspondente na Loja.</li>
        <li>Sua senha é guardada apenas como <b>hash scrypt com sal</b>. Não temos como ler,
        recuperar ou informar a sua senha — só substituí-la por uma nova.</li>
        <li>Você é responsável por manter suas credenciais em segurança. Atividade feita com as
        suas credenciais é tratada como sua.</li>
        <li>Você pode encerrar a conta e pedir a exclusão dos seus dados a qualquer momento
        (seção 7).</li>
      </ul>`,

    conduta: `
      <h2>5. Regras de conduta</h2>
      <p>Automações são permitidas, no jogo e no Mercado — inclusive a extensão de automação do
      PokéIdle, disponível no nosso <a href="https://discord.gg/pokeidle" target="_blank" rel="noopener noreferrer">Discord</a>, no canal <b>#how-to-play</b>. As regras abaixo
      valem para todo mundo, jogando na mão ou com automação.</p>
      <p>É proibido, e pode levar à suspensão ou ao encerramento da conta com perda do
      progresso e do saldo:</p>
      <ul>
        <li>Usar vulnerabilidades encontradas e não reportadas à administração para obter Gemas
        por meios não previstos — ou seja, por qualquer forma que não seja a compra direta pelos
        métodos oficiais do jogo.</li>
        <li>Vender, comprar ou transferir contas fora do jogo.</li>
        <li>Combinar resultados de PvP, do Mercado ou de qualquer outro sistema competitivo
        para transferir valor artificialmente.</li>
        <li>Assediar, ameaçar, discriminar ou expor dados de outros jogadores no chat.</li>
        <li>Usar o jogo para lavagem de dinheiro, fraude ou qualquer finalidade ilícita.</li>
      </ul>
      <p>Podemos suspender contas envolvidas em investigação de fraude enquanto ela durar.
      Sempre que possível, avisamos o titular por e-mail.</p>`,

    privacidade: `
      <h2>6. Privacidade: o compromisso</h2>
      <div class="doc-aviso">
        <p><b>Não vendemos, alugamos nem trocamos os seus dados pessoais.</b> Não montamos
        perfil de comportamento para vender a anunciantes e não entregamos a nossa base de
        jogadores a terceiros para marketing.</p>
      </div>
      <p>Coletamos o mínimo necessário para o jogo funcionar, para proteger as contas e para
      cumprir obrigações legais. A base legal é a <b>execução do contrato</b> (você pediu para
      jogar), o <b>legítimo interesse</b> em segurança antifraude e o <b>consentimento</b>,
      quando aplicável.</p>

      <h3>Medição de anúncios</h3>
      <p>O site carrega o <b>Google Tag Manager</b> (GTM-NZLNR5N8) e o <b>Pixel do Meta</b>
      (Facebook/Instagram, ID <b>941286091638419</b>) em todas as páginas públicas. Eles existem
      para medir quantas das pessoas que clicaram num anúncio nosso chegaram ao jogo e criaram
      conta.</p>
      <p>Ao carregar, enviam ao Google e à Meta o seu <b>endereço IP</b>, o <b>navegador</b> e a
      <b>página que você visitou</b>, e podem gravar cookies próprios. Nesse ponto Google e Meta
      atuam como controladores dos dados deles, sob as políticas deles.</p>
      <p>O que eles <b>não</b> recebem da nossa parte: o seu <b>e-mail</b>, o seu
      <b>nome de usuário</b>, a sua <b>carteira</b> nem o seu <b>progresso de jogo</b>, e não
      recebemos de volta nenhuma lista de pessoas. Como recusar está em
      <a href="#cookies">Cookies</a> — e o jogo funciona inteiro sem essas tags.</p>`,

    dados: `
      <h2>7. Que dados coletamos</h2>
      <table class="doc-tabela">
        <tr><th>Dado</th><th>Para quê</th><th>Por quanto tempo</th></tr>
        <tr><td><b>E-mail</b></td><td>Login, confirmação de conta, recuperação de senha e avisos
          sobre saques</td><td>Enquanto a conta existir</td></tr>
        <tr><td><b>Nome de usuário</b></td><td>Identidade pública no jogo, chat e rankings</td>
          <td>Enquanto a conta existir</td></tr>
        <tr><td><b>Senha (hash)</b></td><td>Autenticação. Guardada como hash scrypt com sal —
          nunca em texto claro</td><td>Enquanto a conta existir</td></tr>
        <tr><td><b>ID do Google / Discord</b></td><td>Identificar a sua conta quando você entra
          por provedor externo</td><td>Enquanto a conta existir</td></tr>
        <tr><td><b>Endereço IP</b></td><td>Limitar tentativas de login e conter abuso
          automatizado</td><td>Em memória, poucos minutos</td></tr>
        <tr><td><b>Progresso de jogo</b></td><td>Salvar o seu personagem, time, inventário e
          rankings</td><td>Enquanto a conta existir</td></tr>
        <tr><td><b>Endereço de carteira</b></td><td>Enviar o USDT dos saques que você pedir</td>
          <td>Registro contábil do saque</td></tr>
        <tr><td><b>Extrato de Gemas</b></td><td>Auditar o caixa e provar cada movimento de saldo</td>
          <td>Permanente (registro contábil)</td></tr>
        <tr><td><b>Visita à página</b> (IP, navegador, página)</td><td>Medir quantos cliques em
          anúncio viram conta — a tag do Google da <a href="#privacidade">seção 6</a></td>
          <td>Conforme a retenção do Google Ads</td></tr>
      </table>
      <h3>Com quem compartilhamos</h3>
      <ul>
        <li><b>Provedor de e-mail transacional</b>, para entregar a confirmação de conta e o
        link de troca de senha.</li>
        <li><b>Google e Discord</b>, quando você escolhe entrar por eles — e apenas o suficiente
        para concluir o login.</li>
        <li><b>Google Ads</b>, pela tag de medição descrita na
        <a href="#privacidade">seção 6</a>: IP, navegador e página visitada. Nunca o seu e-mail,
        nome de usuário ou progresso.</li>
        <li><b>Rede blockchain</b>, no caso de um saque: transações em blockchain são públicas
        e permanentes por natureza.</li>
        <li><b>Autoridades</b>, quando houver obrigação legal.</li>
      </ul>
      <h3>Os seus direitos</h3>
      <p>Você pode pedir a qualquer momento: <b>acesso</b> aos seus dados, <b>correção</b>,
      <b>exclusão</b>, <b>portabilidade</b> e <b>revogação de consentimento</b>. Escreva para
      <a href="mailto:${CONTATO}">${CONTATO}</a> a partir do e-mail cadastrado e respondemos em
      até <b>30 dias</b>.</p>
      <p>A exclusão apaga conta, personagem, e-mail e progresso. O <b>extrato financeiro de
      Gemas</b> é mantido de forma dissociada da sua identidade, porque é registro contábil de
      valores movimentados — apagá-lo impediria a auditoria do caixa que protege os demais
      jogadores.</p>`,

    cookies: `
      <h2>8. Cookies e armazenamento local</h2>
      <p><b>O jogo em si não usa cookie nenhum.</b> Ele guarda no armazenamento local do seu
      navegador apenas o necessário para funcionar:</p>
      <ul>
        <li>O <b>token da sua sessão</b>, para você não digitar a senha a cada visita.</li>
        <li>O seu <b>nome de usuário</b>, como conveniência de digitação no próximo login.</li>
        <li><b>Preferências de tela</b>, como idioma e nível de zoom da cena.</li>
      </ul>
      <p>Tudo isso fica no seu navegador e some quando você limpa os dados do site.</p>

      <h3>Cookies de publicidade (Google)</h3>
      <p>A <b>tag do Google</b> descrita na <a href="#privacidade">seção 6</a> pode gravar
      cookies de medição de anúncio — a família <code>_gcl_*</code> e os cookies dos domínios do
      próprio Google. Eles servem para atribuir uma conta criada ao anúncio que trouxe a pessoa,
      e não para montar perfil de navegação para nós.</p>
      <p>Para recusar, qualquer um destes resolve:</p>
      <ul>
        <li>bloquear <b>cookies de terceiros</b> nas configurações do navegador;</li>
        <li>usar um <b>bloqueador de anúncios</b>;</li>
        <li>ajustar as suas preferências em
        <a href="https://adssettings.google.com" target="_blank" rel="noopener noreferrer">adssettings.google.com</a>.</li>
      </ul>
      <p><b>O jogo funciona inteiro com esses cookies bloqueados.</b> Nenhuma parte dele
      depende deles — login, batalha, mercado e saque seguem iguais.</p>`,

    diamantes: `
      <h2>9. Diamantes: moeda da Loja</h2>
      <p>O <b>Diamante</b> é a moeda usada na Loja do jogo (VIP, bônus, outfits e pokébolas).
      Ele entra por <b>PIX</b> ou <b>cartão de crédito</b> e é consumido ao ser gasto: não é
      sacável nem transferível entre jogadores.</p>
      <div class="doc-aviso">
        <p>Ao comprar diamantes, você recebe saldo para usar na Loja do jogo. O valor pago ajuda
        a manter o servidor online, a equipe e o marketing que trazem novos jogadores, além do
        desenvolvimento contínuo do projeto. Você pode solicitar reembolso em até 7 dias: devolvemos
        só o valor dos diamantes <b>comprados</b> que ainda restam na conta (voto e referral não
        contam). Ao prosseguir, você declara que leu, compreendeu e aceita integralmente estas
        condições.</p>
      </div>
      <p>Antes de seguir para o pagamento, o jogo pede a marcação de um aceite com esse mesmo
      texto. O carimbo desse aceite fica gravado junto do pagamento.</p>
      <h3>Política de reembolso</h3>
      <p>O direito de arrependimento de 7 dias (Art. 49 do CDC) aplica-se a diamantes
      <b>comprados</b> que ainda não foram consumidos. Diamantes, VIP, bônus e demais itens da
      Loja são <b>consumíveis</b>: depois de gastos ou ativados, não há como devolvê-los.</p>
      <ul>
        <li><b>O que entra no reembolso:</b> apenas diamantes <b>comprados com dinheiro</b> que
        ainda estão na sua conta. Diamantes recebidos por <b>voto no TopIdle</b> ou por
        <b>indicação (referral)</b> <b>não entram</b> no cálculo — só os que você pagou.</li>
        <li><b>Reembolso parcial:</b> se comprou 100 diamantes, gastou 50 e pede reembolso,
        devolvemos o valor dos <b>50 que sobraram</b> — não o pacote inteiro. Se gastou tudo o
        que comprou, não há diamantes comprados a reembolsar.</li>
        <li><b>Benefícios já usados:</b> se você ativou VIP, comprou beast balls ou usufruiu de
        qualquer vantagem paga na Loja, isso <b>não é revertido</b> — o reembolso limita-se ao
        saldo de diamantes comprados que ainda resta.</li>
        <li><b>Verificação:</b> cada compra, crédito (voto, referral, compra) e gasto fica
        registrado nos logs do jogo. Usamos esses registros para calcular o valor e contestar
        abusos junto aos provedores de pagamento (PIX, cartão).</li>
        <li><b>Má-fé e abuso:</b> pedir reembolso além do saldo comprado restante — ou depois de
        usufruir dos benefícios enquanto tenta recuperar o valor pago — pode resultar em
        <b>recusa do reembolso</b>, banimento da conta e medidas junto ao provedor de pagamento.
        </li>
      </ul>
      <p>Para solicitar, escreva para <b>support@pokeidle.io</b> informando a data da compra e
      o nick da conta.</p>
      <h3>Preço</h3>
      <table class="doc-tabela">
        <tr><th>Quantidade</th><th>Por diamante</th></tr>
        <tr><td>1 a 99</td><td><b>R$ 0,44</b></td></tr>
        <tr><td>100 a 149</td><td><b>R$ 0,42</b></td></tr>
        <tr><td>150 a 199</td><td><b>R$ 0,40</b></td></tr>
        <tr><td>200 ou mais</td><td><b>R$ 0,38</b></td></tr>
      </table>
      <p>O pagamento é processado por terceiros (Efí para PIX, Stripe para cartão) e os
      dados do cartão <b>nunca passam pelos nossos servidores</b>. O saldo é creditado assim que
      o provedor confirma.</p>`,

    orbs: `
      <h2>10. Gemas, compras e saques</h2>
      <p>A <b>Gema</b> é a moeda premium do jogo, lastreada em USDT. Ela é comprada por depósito
      e pode ser convertida de volta por saque.</p>
      <table class="doc-tabela">
        <tr><th>Item</th><th>Valor</th></tr>
        <tr><td>Preço de compra de 1 Gema</td><td><b>US$ 0,01</b></td></tr>
        <tr><td>Preço de recompra (saque) de 1 Gema</td><td><b>US$ 0,007</b></td></tr>
        <tr><td>Margem entre as duas pontas (<i>spread</i>)</td><td><b>30%</b></td></tr>
        <tr><td>Saque mínimo</td><td><b>1.000 Gemas</b> (US$ 7,00)</td></tr>
        <tr><td>Saque máximo por pedido</td><td><b>1.000.000 Gemas</b></td></tr>
      </table>
      <p>O <b>spread de 30%</b> não é uma taxa por transação: é a diferença entre o preço de
      compra e o de recompra, e é dela que saem a infraestrutura, o desenvolvimento e a taxa de
      rede paga em cada saque. Ela está publicada também dentro do jogo, na tela de Gemas.</p>
      <h3>Como o saldo é contabilizado</h3>
      <p>Todo movimento de Gema gera uma linha em um <b>livro-razão que nunca é alterado nem
      apagado</b> (<i>append-only</i>). O saldo mostrado no jogo é um espelho desse livro, e a
      atualização do saldo acontece na mesma transação que grava a linha. É isso que permite
      auditar o caixa somando o livro e comparando com a carteira do projeto, e reconstruir o
      saldo de qualquer jogador se algo der errado.</p>
      <div class="doc-aviso">
        <p><b>Risco.</b> Gemas são um item de jogo, não um investimento, valor mobiliário ou
        depósito bancário. Não há rendimento, garantia de liquidez nem seguro. Transações em
        blockchain são <b>irreversíveis</b>: um endereço de saque digitado errado não tem como
        ser desfeito por nós. Confira o endereço antes de confirmar.</p>
      </div>
      <h3>Troca por valor real (RMT) e golpes entre jogadores</h3>
      <p>O jogo <b>permite</b> a troca de itens e pokémon entre jogadores por valor real — é
      para isso que o Mercado da Comunidade existe, e usá-lo não infringe nenhuma regra.</p>
      <p>Em contrapartida, o projeto <b>não se responsabiliza por golpes entre jogadores e não
      arbitra disputas</b>. Isso inclui, sem se limitar a:</p>
      <ul>
        <li>combinação feita <b>por fora</b> do Mercado (promessa de pagamento, troca no boca a
        boca, intermediário) — sem o escrow do Mercado, não há o que garantir;</li>
        <li><b>compra errada</b>: item, quantidade ou preço diferentes do pretendido;</li>
        <li><b>depósito enviado para um endereço diferente</b> do que foi fornecido a você;</li>
        <li><b>saque pedido para uma carteira errada</b> ou em outra rede.</li>
      </ul>
      <p>Nos dois últimos casos o dinheiro está perdido, e isso não é política nossa: transação
      em blockchain não tem estorno. Confira sempre o endereço e a rede antes de confirmar.</p>
      <p>O que o Mercado <b>garante</b> é o que está sob o nosso controle: o item sai da mão do
      vendedor no instante do anúncio (escrow), a compra é atômica, e o preço cobrado é o que
      estava na tela — um anúncio editado depois do seu clique é recusado, não cobrado.</p>`,

    mercado: `
      <h2>11. Mercado Global entre jogadores</h2>
      <p>O Mercado Global permite anunciar itens e pokémon para outros jogadores, cobrando em
      <b>ouro</b> (moeda de jogo) ou em <b>Gemas</b>.</p>
      <table class="doc-tabela">
        <tr><th>Regra</th><th>Valor</th></tr>
        <tr><td>Comissão sobre venda cobrada em <b>Gema</b></td><td><b>30%</b> do preço</td></tr>
        <tr><td>Comissão sobre venda cobrada em <b>ouro</b></td><td><b>0%</b></td></tr>
        <tr><td>Anúncios abertos por jogador</td><td>até <b>20</b></td></tr>
      </table>
      <h3>Custódia do anúncio</h3>
      <p>Anunciar <b>tira o item da sua mão</b>: ele sai do inventário (ou o pokémon é marcado
      como anunciado) e fica em custódia até a venda ou o cancelamento. Isso existe para o
      comprador nunca pagar por algo que o vendedor já gastou ou vendeu em outro lugar.</p>
      <h3>Pagamento</h3>
      <p>O vendedor recebe o valor <b>já descontada a comissão</b>, e o recebimento é entregue
      no próximo login se ele estiver desconectado no momento da venda. Cancelar um anúncio
      devolve o item; não há devolução após a venda concluída.</p>`,

    sorteios: `
      <h2>12. Sorteios e probabilidades</h2>
      <p>Publicamos as probabilidades porque achamos que quem gasta tempo (ou dinheiro) num
      sistema aleatório tem direito de saber o que está comprando. Os números abaixo são
      exatamente os que o servidor aplica.</p>
      <h3>Potência (sorteada em toda captura)</h3>
      <table class="doc-tabela">
        <tr><th>Potência</th><th>Chance</th><th>Bônus de atributos</th></tr>
        <tr><td>1</td><td><b>74,495%</b></td><td>+0%</td></tr>
        <tr><td>2</td><td><b>20%</b></td><td>+5%</td></tr>
        <tr><td>3</td><td><b>5%</b></td><td>+10%</td></tr>
        <tr><td>4</td><td><b>0,5%</b></td><td>+25%</td></tr>
        <tr><td>5</td><td><b>0,005%</b></td><td>+100%</td></tr>
      </table>
      <h3>Shiny (sorteado ao aparecer o pokémon selvagem)</h3>
      <p>A chance é <b>1 em 24.000</b> por encontro para qualquer espécie com forma shiny, e é
      sorteada <b>no nascimento</b> do selvagem. Um shiny tem o <b>dobro</b> dos atributos da
      forma comum. Itens de <i>boost</i> comprados na Loja multiplicam essa chance, e a
      multiplicação está descrita no próprio item.</p>
      <h3>Captura</h3>
      <p>A chance de cada arremesso depende da espécie, do tipo de bola e de quanto HP falta ao
      alvo, e fica sempre entre <b>0,3%</b> e <b>75%</b>. O jogo mostra a estimativa antes do
      arremesso.</p>
      <h3>Como o sorteio acontece</h3>
      <p>Todo sorteio é executado <b>no servidor</b>, com o gerador de números aleatórios da
      plataforma. O seu navegador <b>não participa</b> do resultado: ele apenas recebe e anima
      o que já foi decidido. Isso significa que nenhum cliente modificado consegue influenciar
      captura, shiny, potência ou <i>drop</i>.</p>
      <p>Para deixar claro o que <b>não</b> oferecemos hoje: o resultado de cada sorteio
      individual <b>não</b> é verificável de forma independente pelo jogador — não publicamos
      semente comprometida previamente nem hash por rodada. O que é auditável é o
      <b>financeiro</b>: o livro-razão de Gemas descrito na seção 9. Se implementarmos
      verificação independente dos sorteios, este documento será atualizado antes do
      lançamento do recurso.</p>`,

    menores: `
      <h2>13. Menores de idade</h2>
      <p>O serviço não se destina a menores de <b>13 anos</b>. Entre 13 e 18 anos (ou a
      maioridade do seu país), o uso depende de <b>consentimento e supervisão</b> de pai, mãe
      ou responsável — em especial para qualquer compra.</p>
      <p>Se soubermos que uma conta pertence a alguém abaixo da idade mínima, ela é encerrada e
      os dados são excluídos. Responsáveis podem pedir a exclusão escrevendo para
      <a href="mailto:${CONTATO}">${CONTATO}</a>.</p>`,

    garantias: `
      <h2>14. Garantias e responsabilidade</h2>
      <p>O serviço é oferecido <b>"como está"</b>, sem garantia de disponibilidade
      ininterrupta, ausência de erros ou adequação a uma finalidade específica. Este é um
      projeto de fãs, mantido sem vínculo comercial com os titulares da franquia, e pode ser
      <b>interrompido a qualquer momento</b> — inclusive por pedido de remoção (seção 3).</p>
      <p>Na máxima extensão permitida pela lei aplicável, não respondemos por lucros cessantes,
      perda de progresso, perda de itens virtuais ou danos indiretos. Nada nestes Termos exclui
      responsabilidades que a lei não permita excluir, inclusive as previstas na legislação
      consumerista aplicável.</p>
      <p>Em caso de encerramento do serviço, comunicaremos com a maior antecedência possível e
      abriremos uma janela para saque dos saldos de Gema existentes.</p>`,

    mudancas: `
      <h2>15. Mudanças nestes termos</h2>
      <p>Podemos atualizar este documento. Mudanças relevantes — em especial as que afetem
      taxas, saques ou tratamento de dados — são anunciadas dentro do jogo com pelo menos
      <b>15 dias</b> de antecedência. A data da última atualização fica sempre no rodapé desta
      página. Continuar usando o serviço após a vigência significa concordar com a versão
      nova.</p>`,

    contato: `
      <h2>16. Contato</h2>
      <p>Para dúvidas, exercício de direitos sobre dados pessoais, denúncias ou pedidos de
      remoção por direitos autorais:</p>
      <p><b><a href="mailto:${CONTATO}">${CONTATO}</a></b></p>
      <p>Pedidos de titulares de direitos sobre a franquia Pokémon têm <b>prioridade</b> na
      nossa fila e o prazo de atendimento está na seção 3.</p>`,
  },
};

// ------------------------------------------------------------------- inglês

const en = {
  titulo: 'Terms, Privacy and Rights',
  voltar: 'Back to the game',
  atualizado: `Last updated: ${ATUALIZADO}`,
  indice: {
    oque: '1. What Pokéidle.io is',
    direitos: '2. Copyright and trademarks',
    remocao: '3. Takedown requests (rights holders)',
    conta: '4. Your account',
    conduta: '5. Rules of conduct',
    privacidade: '6. Privacy: our commitment',
    dados: '7. What data we collect',
    cookies: '8. Cookies and local storage',
    diamantes: '9. Diamonds: Shop currency',
    orbs: '10. Gems, purchases and withdrawals',
    mercado: '11. Global Market between players',
    sorteios: '12. Random draws and odds',
    menores: '13. Minors',
    garantias: '14. Warranties and liability',
    mudancas: '15. Changes to these terms',
    contato: '16. Contact',
  },
  corpo: {
    oque: `
      <h2>1. What Pokéidle.io is</h2>
      <p>Pokéidle.io is a <b>browser game made by fans</b>, unofficial in every sense and with
      <b>no connection, sponsorship, endorsement or affiliation</b> with Nintendo Co., Ltd.,
      Game Freak Inc., Creatures Inc. or The Pokémon Company International.</p>
      <p>By accessing or using the site and the game, you agree to these Terms and to the
      Privacy Policy below. If you disagree with any part of it, please do not use the
      service.</p>`,

    direitos: `
      <h2>2. Copyright and trademarks</h2>
      <div class="doc-aviso">
        <p><b>Pokémon</b>, <b>Poké Ball</b>, the names and images of every creature, and all
        other elements of the franchise are <b>registered trademarks and protected works</b> of
        Nintendo, Game Freak, Creatures and The Pokémon Company. <b>We hold none of those
        rights.</b></p>
        <p>This project is a tribute made by fans. We sell no original franchise content, and
        nothing on this site should be read as an official product, service or communication
        from the rights holders.</p>
      </div>
      <p>The source code we wrote, the interface art we produced and the text of this document
      are ours. Third-party materials used in the game belong to their respective owners and
      appear here in a fan-project context.</p>
      <p>If you hold rights over any material present in the game and do not want it to remain,
      read the next section — we comply.</p>`,

    remocao: `
      <h2>3. Takedown requests (rights holders)</h2>
      <p>If you are the owner — or an authorised representative of the owner — of copyright or
      trademark rights over any content here, and you want the <b>material or the entire site
      taken down</b>, write to <a href="mailto:${CONTATO}">${CONTATO}</a> with the subject
      <b>"Takedown request"</b>.</p>
      <h3>What to include</h3>
      <ul>
        <li>Identification of the material and where it appears (URL, screen or description).</li>
        <li>Identification of the rights holder.</li>
        <li>Your contact details and, if you are a representative, a statement of that.</li>
        <li>A statement that the use is not authorised by the owner or by law.</li>
      </ul>
      <h3>Our commitment</h3>
      <p>We acknowledge receipt within <b>72 hours</b> and remove the identified material within
      <b>7 calendar days</b> of that acknowledgement. If the request covers the service as a
      whole, we <b>take the site offline</b> within the same window. We do not require a court
      order to honour a legitimate rights-holder request, and we do not argue the merits before
      complying.</p>`,

    conta: `
      <h2>4. Your account</h2>
      <ul>
        <li>You can create an account with <b>e-mail and password</b>, or sign in with
        <b>Google</b> or <b>Discord</b>. Password accounts require <b>e-mail confirmation</b>
        before first access.</li>
        <li>The <b>character name (nick)</b> is unique across the whole game and is your
        account's public identity. It can only be changed through the corresponding paid item
        in the Shop.</li>
        <li>Your password is stored only as a <b>salted scrypt hash</b>. We cannot read,
        recover or tell you your password — only replace it with a new one.</li>
        <li>You are responsible for keeping your credentials safe. Activity performed with your
        credentials is treated as yours.</li>
        <li>You may close your account and request deletion of your data at any time
        (section 7).</li>
      </ul>`,

    conduta: `
      <h2>5. Rules of conduct</h2>
      <p>Automation is allowed, in the game and on the Market — including the PokéIdle automation
      extension, available on our <a href="https://discord.gg/pokeidle" target="_blank" rel="noopener noreferrer">Discord</a>, in the <b>#how-to-play</b> channel. The rules below
      apply to everyone, playing by hand or with automation.</p>
      <p>The following is forbidden and may lead to suspension or termination of the account,
      with loss of progress and balance:</p>
      <ul>
        <li>Using vulnerabilities you found and did not report to the administration to obtain
        Gems through unapproved means — anything other than direct purchase via the game's
        official payment methods.</li>
        <li>Selling, buying or transferring accounts outside the game.</li>
        <li>Arranging PvP, Market or any other competitive outcome to move value
        artificially.</li>
        <li>Harassing, threatening, discriminating against or doxxing other players in chat.</li>
        <li>Using the game for money laundering, fraud or any unlawful purpose.</li>
      </ul>
      <p>We may suspend accounts under fraud investigation for as long as it lasts. Whenever
      possible we notify the account holder by e-mail.</p>`,

    privacidade: `
      <h2>6. Privacy: our commitment</h2>
      <div class="doc-aviso">
        <p><b>We do not sell, rent or trade your personal data.</b> We build no behavioural
        profiles to sell to advertisers, and we do not hand our player base to third parties
        for marketing.</p>
      </div>
      <p>We collect the minimum needed for the game to work, to protect accounts and to meet
      legal obligations. The legal bases are <b>performance of the contract</b> (you asked to
      play), <b>legitimate interest</b> in anti-fraud security, and <b>consent</b> where
      applicable.</p>

      <h3>Ad measurement</h3>
      <p>The site loads <b>Google Tag Manager</b> (GTM-NZLNR5N8) and the <b>Meta Pixel</b>
      (Facebook/Instagram, ID <b>941286091638419</b>) on every public page. They exist to measure
      how many people who clicked our ads reached the game and created an account.</p>
      <p>When they load, they send Google and Meta your <b>IP address</b>, your <b>browser</b> and
      the <b>page you visited</b>, and they may set their own cookies. At that point Google and
      Meta act as controllers of that data, under their own policies.</p>
      <p>What they do <b>not</b> get from us: your <b>email</b>, <b>username</b>, <b>wallet</b> or
      <b>game progress</b>, and we get no list of people back. How to refuse them is in
      <a href="#cookies">Cookies</a> — and the game works fully without these tags.</p>`,

    dados: `
      <h2>7. What data we collect</h2>
      <table class="doc-tabela">
        <tr><th>Data</th><th>Purpose</th><th>Retention</th></tr>
        <tr><td><b>E-mail</b></td><td>Login, account confirmation, password recovery and
          withdrawal notices</td><td>While the account exists</td></tr>
        <tr><td><b>Username</b></td><td>Public identity in game, chat and rankings</td>
          <td>While the account exists</td></tr>
        <tr><td><b>Password (hash)</b></td><td>Authentication. Stored as a salted scrypt hash —
          never in plain text</td><td>While the account exists</td></tr>
        <tr><td><b>Google / Discord ID</b></td><td>Identifying your account when you sign in
          with an external provider</td><td>While the account exists</td></tr>
        <tr><td><b>IP address</b></td><td>Rate-limiting login attempts and containing automated
          abuse</td><td>In memory, a few minutes</td></tr>
        <tr><td><b>Game progress</b></td><td>Saving your character, team, inventory and
          rankings</td><td>While the account exists</td></tr>
        <tr><td><b>Wallet address</b></td><td>Sending the USDT for withdrawals you request</td>
          <td>Withdrawal accounting record</td></tr>
        <tr><td><b>Gem ledger</b></td><td>Auditing the treasury and proving every balance
          movement</td><td>Permanent (accounting record)</td></tr>
        <tr><td><b>Page visit</b> (IP, browser, page)</td><td>Measuring how many ad clicks turn
          into accounts — the Google tag in <a href="#privacidade">section 6</a></td>
          <td>Per Google Ads retention</td></tr>
      </table>
      <h3>Who we share with</h3>
      <ul>
        <li>A <b>transactional e-mail provider</b>, to deliver account confirmation and
        password-reset links.</li>
        <li><b>Google and Discord</b>, when you choose to sign in with them — and only as much
        as needed to complete the login.</li>
        <li><b>Google Ads</b>, through the measurement tag described in
        <a href="#privacidade">section 6</a>: IP, browser and page visited. Never your e-mail,
        username or progress.</li>
        <li>The <b>blockchain network</b>, in case of a withdrawal: blockchain transactions are
        public and permanent by nature.</li>
        <li><b>Authorities</b>, where legally required.</li>
      </ul>
      <h3>Your rights</h3>
      <p>At any time you may request <b>access</b> to your data, <b>correction</b>,
      <b>deletion</b>, <b>portability</b> and <b>withdrawal of consent</b>. Write to
      <a href="mailto:${CONTATO}">${CONTATO}</a> from your registered e-mail and we answer
      within <b>30 days</b>.</p>
      <p>Deletion erases account, character, e-mail and progress. The <b>Gem financial
      ledger</b> is retained in a form dissociated from your identity, because it is the
      accounting record of moved value — erasing it would break the treasury audit that
      protects every other player.</p>`,

    cookies: `
      <h2>8. Cookies and local storage</h2>
      <p><b>The game itself uses no cookies at all.</b> It stores in your browser's local
      storage only what it needs to work:</p>
      <ul>
        <li>Your <b>session token</b>, so you don't type your password on every visit.</li>
        <li>Your <b>username</b>, as a typing convenience for the next login.</li>
        <li><b>Display preferences</b>, such as language and scene zoom level.</li>
      </ul>
      <p>All of it stays in your browser and disappears when you clear the site's data.</p>

      <h3>Advertising cookies (Google)</h3>
      <p>The <b>Google tag</b> described in <a href="#privacidade">section 6</a> may set ad
      measurement cookies — the <code>_gcl_*</code> family and cookies on Google's own domains.
      They exist to attribute a created account to the ad that brought the person in, not to
      build a browsing profile for us.</p>
      <p>To refuse it, any one of these works:</p>
      <ul>
        <li>block <b>third-party cookies</b> in your browser settings;</li>
        <li>use an <b>ad blocker</b>;</li>
        <li>adjust your preferences at
        <a href="https://adssettings.google.com" target="_blank" rel="noopener noreferrer">adssettings.google.com</a>.</li>
      </ul>
      <p><b>The game works fully with those cookies blocked.</b> No part of it depends on them —
      login, battle, market and withdrawals are unaffected.</p>`,

    diamantes: `
      <h2>9. Diamonds: Shop currency</h2>
      <p>The <b>Diamond</b> is the currency used in the in-game Shop (VIP, boosts, outfits and
      poké balls). It comes in by <b>PIX</b> or <b>credit card</b> and is consumed when spent:
      it cannot be cashed out or transferred between players.</p>
      <div class="doc-aviso">
        <p>When you buy diamonds, you receive balance to spend in the in-game Shop. Your payment
        helps keep the servers online, the team running, and the marketing that brings new
        players — as well as ongoing development of the project. You may request a refund within
        7 days if your balance is still intact; once you spend or activate benefits, the right
        of withdrawal no longer applies to what was already used. By proceeding, you declare
        that you have read, understood and fully accept these conditions.</p>
      </div>
      <p>Before going to checkout, the game asks you to tick an acceptance box carrying this
      same text. The timestamp of that acceptance is stored alongside the payment.</p>
      <h3>Refund policy</h3>
      <p>The 7-day right of withdrawal applies while the digital product <b>has not been
      consumed</b>. Diamonds, VIP, boosts and other Shop items are <b>consumables</b>: once
      spent or activated, they cannot be returned.</p>
      <ul>
        <li><b>Balance untouched:</b> you bought and <b>did not spend</b> any diamonds — full
        refund within 7 days.</li>
        <li><b>Balance spent or benefits used:</b> if you already spent diamonds in the Shop,
        activated VIP, bought beast balls or enjoyed any paid perk, the refund <b>may be
        denied</b> for the portion already consumed — including in full if everything was
        spent.</li>
        <li><b>Verification:</b> every purchase, spend and activation is logged in the game. We
        use these records to assess requests and contest abuse with payment providers (PIX,
        card).</li>
        <li><b>Bad faith and abuse:</b> requesting a refund after enjoying the benefits — such
        as keeping in-game advantages while recovering the payment — may result in <b>refusal of
        the refund</b>, account ban and action with the payment provider.</li>
      </ul>
      <p>To request one, email <b>support@pokeidle.io</b> with the purchase date and account
      nickname.</p>
      <h3>Price</h3>
      <table class="doc-tabela">
        <tr><th>Amount</th><th>Per diamond</th></tr>
        <tr><td>1 to 99</td><td><b>R$ 0.44</b></td></tr>
        <tr><td>100 to 149</td><td><b>R$ 0.42</b></td></tr>
        <tr><td>150 to 199</td><td><b>R$ 0.40</b></td></tr>
        <tr><td>200 or more</td><td><b>R$ 0.38</b></td></tr>
      </table>
      <p>Payment is processed by third parties (Efí for PIX, Stripe for card) and card data
      <b>never touches our servers</b>. The balance is credited as soon as the provider
      confirms.</p>`,

    orbs: `
      <h2>10. Gems, purchases and withdrawals</h2>
      <p>The <b>Gem</b> is the game's premium currency, backed by USDT. It is bought by deposit
      and can be converted back by withdrawal.</p>
      <table class="doc-tabela">
        <tr><th>Item</th><th>Value</th></tr>
        <tr><td>Purchase price of 1 Gem</td><td><b>US$ 0.01</b></td></tr>
        <tr><td>Buy-back (withdrawal) price of 1 Gem</td><td><b>US$ 0.007</b></td></tr>
        <tr><td>Margin between the two sides (<i>spread</i>)</td><td><b>30%</b></td></tr>
        <tr><td>Minimum withdrawal</td><td><b>1,000 Gems</b> (US$ 7.00)</td></tr>
        <tr><td>Maximum per withdrawal</td><td><b>1,000,000 Gems</b></td></tr>
      </table>
      <p>The <b>30% spread</b> is not a per-transaction fee: it is the difference between the
      buy and buy-back prices, and it pays for infrastructure, development and the network fee
      of every withdrawal. It is also published inside the game, on the Gems screen.</p>
      <h3>How the balance is accounted for</h3>
      <p>Every Gem movement writes a line to an <b>append-only ledger</b> that is never updated
      or deleted. The balance shown in the game mirrors that ledger, and the balance update
      happens in the same transaction that writes the line. That is what makes it possible to
      audit the treasury by summing the ledger against the project wallet, and to rebuild any
      player's balance if something goes wrong.</p>
      <div class="doc-aviso">
        <p><b>Risk.</b> Gems are a game item, not an investment, security or bank deposit.
        There is no yield, no liquidity guarantee and no insurance. Blockchain transactions are
        <b>irreversible</b>: a mistyped withdrawal address cannot be undone by us. Check the
        address before confirming.</p>
      </div>
      <h3>Real-money trading (RMT) and scams between players</h3>
      <p>The game <b>allows</b> trading items and pokémon between players for real value — that
      is what the Community Market is for, and using it breaks no rule.</p>
      <p>In return, the project <b>is not responsible for scams between players and does not
      arbitrate disputes</b>. This includes, but is not limited to:</p>
      <ul>
        <li>deals made <b>outside</b> the Market (a promise to pay, a word-of-mouth trade, a
        middleman) — without the Market's escrow there is nothing to guarantee;</li>
        <li><b>a wrong purchase</b>: item, amount or price other than intended;</li>
        <li><b>a deposit sent to an address other than</b> the one given to you;</li>
        <li><b>a withdrawal requested to the wrong wallet</b> or on another network.</li>
      </ul>
      <p>In the last two cases the money is gone, and that is not our policy: a blockchain
      transaction has no chargeback. Always check the address and the network before confirming.</p>
      <p>What the Market <b>does guarantee</b> is what is under our control: the item leaves the
      seller's hands the moment it is listed (escrow), the purchase is atomic, and the price
      charged is the one that was on screen — a listing edited after your click is refused, not
      charged.</p>`,

    mercado: `
      <h2>11. Global Market between players</h2>
      <p>The Global Market lets you list items and pokémon for other players, priced in
      <b>gold</b> (game currency) or in <b>Gems</b>.</p>
      <table class="doc-tabela">
        <tr><th>Rule</th><th>Value</th></tr>
        <tr><td>Commission on sales priced in <b>Gem</b></td><td><b>30%</b> of the price</td></tr>
        <tr><td>Commission on sales priced in <b>gold</b></td><td><b>0%</b></td></tr>
        <tr><td>Open listings per player</td><td>up to <b>20</b></td></tr>
      </table>
      <h3>Listing escrow</h3>
      <p>Listing <b>takes the item out of your hands</b>: it leaves your inventory (or the
      pokémon is flagged as listed) and stays in escrow until sold or cancelled. This exists so
      a buyer never pays for something the seller already spent or sold elsewhere.</p>
      <h3>Payment</h3>
      <p>The seller receives the amount <b>with the commission already deducted</b>, and the
      payment is delivered on next login if they were offline at the time of sale. Cancelling a
      listing returns the item; there are no refunds after a completed sale.</p>`,

    sorteios: `
      <h2>12. Random draws and odds</h2>
      <p>We publish the odds because anyone spending time (or money) on a random system
      deserves to know what they are buying. The numbers below are exactly what the server
      applies.</p>
      <h3>Power (rolled on every capture)</h3>
      <table class="doc-tabela">
        <tr><th>Power</th><th>Chance</th><th>Stat bonus</th></tr>
        <tr><td>1</td><td><b>74.495%</b></td><td>+0%</td></tr>
        <tr><td>2</td><td><b>20%</b></td><td>+5%</td></tr>
        <tr><td>3</td><td><b>5%</b></td><td>+10%</td></tr>
        <tr><td>4</td><td><b>0.5%</b></td><td>+25%</td></tr>
        <tr><td>5</td><td><b>0.005%</b></td><td>+100%</td></tr>
      </table>
      <h3>Shiny (rolled on successful capture)</h3>
      <p>The chance is <b>1 in 24,000</b> per successful capture for any species with a shiny
      form — rolled together with quality, IV and potency. Wild pokémon always look common until
      the ball closes. A shiny has <b>double</b> the stats of the ordinary form. The Shiny Secret
      Lure from the Shop doubles that chance while active.</p>
      <h3>Capture</h3>
      <p>The chance of each throw depends on the species, the ball type and how much HP the
      target has left, and always sits between <b>0.3%</b> and <b>75%</b>. The game shows the
      estimate before the throw.</p>
      <h3>How the draw happens</h3>
      <p>Every draw runs <b>on the server</b>, using the platform's random number generator.
      Your browser <b>takes no part</b> in the outcome: it only receives and animates what has
      already been decided. That means no modified client can influence capture, shiny, power
      or drops.</p>
      <p>To be explicit about what we do <b>not</b> offer today: the outcome of each individual
      draw is <b>not</b> independently verifiable by the player — we do not publish a
      pre-committed seed or a per-round hash. What is auditable is the <b>financial</b> side:
      the Gem ledger described in section 9. If we implement independent verification of draws,
      this document will be updated before the feature ships.</p>`,

    menores: `
      <h2>13. Minors</h2>
      <p>The service is not intended for anyone under <b>13</b>. Between 13 and 18 (or the age
      of majority in your country), use depends on the <b>consent and supervision</b> of a
      parent or guardian — especially for any purchase.</p>
      <p>If we learn that an account belongs to someone below the minimum age, it is closed and
      the data deleted. Guardians may request deletion by writing to
      <a href="mailto:${CONTATO}">${CONTATO}</a>.</p>`,

    garantias: `
      <h2>14. Warranties and liability</h2>
      <p>The service is provided <b>"as is"</b>, with no warranty of uninterrupted
      availability, freedom from errors or fitness for a particular purpose. This is a fan
      project, run with no commercial link to the franchise rights holders, and it may be
      <b>discontinued at any time</b> — including upon a takedown request (section 3).</p>
      <p>To the fullest extent permitted by applicable law, we are not liable for lost profits,
      lost progress, loss of virtual items or indirect damages. Nothing in these Terms excludes
      liabilities that the law does not allow to be excluded, including those under applicable
      consumer legislation.</p>
      <p>Should the service be discontinued, we will give as much notice as possible and open a
      window for withdrawing existing Gem balances.</p>`,

    mudancas: `
      <h2>15. Changes to these terms</h2>
      <p>We may update this document. Material changes — especially those affecting fees,
      withdrawals or data handling — are announced inside the game at least <b>15 days</b> in
      advance. The last-updated date is always in the footer of this page. Continuing to use
      the service after a change takes effect means you accept the new version.</p>`,

    contato: `
      <h2>16. Contact</h2>
      <p>For questions, exercising data-protection rights, reports or copyright takedown
      requests:</p>
      <p><b><a href="mailto:${CONTATO}">${CONTATO}</a></b></p>
      <p>Requests from rights holders of the Pokémon franchise are <b>prioritised</b> in our
      queue, and the response deadline is in section 3.</p>`,
  },
};

// ---------------------------------------------------------------- espanhol

const es = {
  titulo: 'Términos, Privacidad y Derechos',
  voltar: 'Volver al juego',
  atualizado: `Última actualización: ${ATUALIZADO}`,
  indice: {
    oque: '1. Qué es Pokéidle.io',
    direitos: '2. Derechos de autor y marcas',
    remocao: '3. Solicitud de retirada (titulares de derechos)',
    conta: '4. Tu cuenta',
    conduta: '5. Normas de conducta',
    privacidade: '6. Privacidad: el compromiso',
    dados: '7. Qué datos recogemos',
    cookies: '8. Cookies y almacenamiento local',
    diamantes: '9. Diamantes: moneda de la Tienda',
    orbs: '10. Gemas, compras y retiros',
    mercado: '11. Mercado Global entre jugadores',
    sorteios: '12. Sorteos y probabilidades',
    menores: '13. Menores de edad',
    garantias: '14. Garantías y responsabilidad',
    mudancas: '15. Cambios en estos términos',
    contato: '16. Contacto',
  },
  corpo: {
    oque: `
      <h2>1. Qué es Pokéidle.io</h2>
      <p>Pokéidle.io es un <b>juego de navegador hecho por fans</b>, sin carácter oficial y
      <b>sin ningún vínculo, patrocinio, aval ni afiliación</b> con Nintendo Co., Ltd., Game
      Freak Inc., Creatures Inc. o The Pokémon Company International.</p>
      <p>Al acceder o usar el sitio y el juego, aceptas estos Términos y la Política de
      Privacidad que sigue. Si no estás de acuerdo con alguna parte, por favor no uses el
      servicio.</p>`,

    direitos: `
      <h2>2. Derechos de autor y marcas</h2>
      <div class="doc-aviso">
        <p><b>Pokémon</b>, <b>Poké Ball</b>, los nombres e imágenes de todas las criaturas y
        los demás elementos de la franquicia son <b>marcas registradas y obras protegidas</b>
        de Nintendo, Game Freak, Creatures y The Pokémon Company. <b>No poseemos ninguno de
        esos derechos.</b></p>
        <p>Este proyecto es un homenaje hecho por fans. No vendemos ningún contenido original
        de la franquicia, y nada en este sitio debe entenderse como un producto, servicio o
        comunicación oficial de los titulares.</p>
      </div>
      <p>El código que escribimos, el arte de interfaz que producimos y los textos de este
      documento son nuestros. Los materiales de terceros usados en el juego pertenecen a sus
      respectivos titulares y aparecen aquí en contexto de proyecto de fans.</p>
      <p>Si eres titular de derechos sobre algún material presente en el juego y no deseas que
      permanezca, lee la sección siguiente — cumplimos.</p>`,

    remocao: `
      <h2>3. Solicitud de retirada (titulares de derechos)</h2>
      <p>Si eres titular — o representante autorizado del titular — de derechos de autor o de
      marca sobre cualquier contenido aquí presente y deseas la <b>retirada del material o del
      sitio completo</b>, escribe a <a href="mailto:${CONTATO}">${CONTATO}</a> con el asunto
      <b>"Solicitud de retirada"</b>.</p>
      <h3>Qué incluir</h3>
      <ul>
        <li>Identificación del material y dónde aparece (URL, pantalla o descripción).</li>
        <li>Identificación del titular del derecho.</li>
        <li>Tus datos de contacto y, si eres representante, la indicación de esa condición.</li>
        <li>Una declaración de que el uso no está autorizado por el titular ni por la ley.</li>
      </ul>
      <h3>Nuestro compromiso</h3>
      <p>Confirmamos la recepción en un plazo de <b>72 horas</b> y retiramos el material
      señalado en un plazo de <b>7 días corridos</b> desde esa confirmación. Si la solicitud
      abarca el servicio completo, <b>retiramos el sitio</b> dentro del mismo plazo. No
      exigimos orden judicial para atender una solicitud legítima de un titular, y no
      discutimos el fondo del asunto antes de cumplir.</p>`,

    conta: `
      <h2>4. Tu cuenta</h2>
      <ul>
        <li>Puedes crear una cuenta con <b>correo y contraseña</b> o entrar con <b>Google</b> o
        <b>Discord</b>. Las cuentas con contraseña requieren <b>confirmación del correo</b>
        antes del primer acceso.</li>
        <li>El <b>nombre del personaje (nick)</b> es único en todo el juego y es la identidad
        pública de tu cuenta. Solo puede cambiarse mediante el artículo de pago correspondiente
        en la Tienda.</li>
        <li>Tu contraseña se guarda únicamente como <b>hash scrypt con sal</b>. No podemos
        leerla, recuperarla ni comunicártela — solo sustituirla por una nueva.</li>
        <li>Eres responsable de mantener tus credenciales seguras. La actividad realizada con
        tus credenciales se considera tuya.</li>
        <li>Puedes cerrar la cuenta y solicitar la eliminación de tus datos en cualquier
        momento (sección 7).</li>
      </ul>`,

    conduta: `
      <h2>5. Normas de conducta</h2>
      <p>Las automatizaciones están permitidas, en el juego y en el Mercado — incluida la extensión de
      automatización de PokéIdle, disponible en nuestro <a href="https://discord.gg/pokeidle" target="_blank" rel="noopener noreferrer">Discord</a>, en el canal <b>#how-to-play</b>.
      Las normas de abajo valen para todos, jugando a mano o con automatización.</p>
      <p>Está prohibido, y puede llevar a la suspensión o el cierre de la cuenta con pérdida
      del progreso y del saldo:</p>
      <ul>
        <li>Usar vulnerabilidades encontradas y no reportadas a la administración para obtener
        Gemas por medios no previstos — es decir, por cualquier vía que no sea la compra directa
        mediante los métodos oficiales del juego.</li>
        <li>Vender, comprar o transferir cuentas fuera del juego.</li>
        <li>Pactar resultados de PvP, del Mercado o de cualquier otro sistema competitivo para
        transferir valor de forma artificial.</li>
        <li>Acosar, amenazar, discriminar o exponer datos de otros jugadores en el chat.</li>
        <li>Usar el juego para blanqueo de capitales, fraude o cualquier fin ilícito.</li>
      </ul>
      <p>Podemos suspender cuentas bajo investigación de fraude mientras esta dure. Siempre que
      sea posible avisamos al titular por correo.</p>`,

    privacidade: `
      <h2>6. Privacidad: el compromiso</h2>
      <div class="doc-aviso">
        <p><b>No vendemos, alquilamos ni intercambiamos tus datos personales.</b> No elaboramos
        perfiles de comportamiento para vender a anunciantes y no entregamos nuestra base de
        jugadores a terceros con fines de marketing.</p>
      </div>
      <p>Recogemos lo mínimo necesario para que el juego funcione, para proteger las cuentas y
      para cumplir obligaciones legales. La base legal es la <b>ejecución del contrato</b> (tú
      pediste jugar), el <b>interés legítimo</b> en la seguridad antifraude y el
      <b>consentimiento</b>, cuando corresponda.</p>

      <h3>Medición de anuncios</h3>
      <p>El sitio carga <b>Google Tag Manager</b> (GTM-NZLNR5N8) y el <b>Pixel de Meta</b>
      (Facebook/Instagram, ID <b>941286091638419</b>) en todas las páginas públicas. Existen para
      medir cuántas de las personas que hicieron clic en un anuncio nuestro llegaron al juego y
      crearon una cuenta.</p>
      <p>Al cargarse, envían a Google y a Meta tu <b>dirección IP</b>, tu <b>navegador</b> y la
      <b>página que visitaste</b>, y pueden guardar cookies propias. En ese punto Google y Meta
      actúan como responsables de esos datos, bajo sus propias políticas.</p>
      <p>Lo que <b>no</b> reciben de nuestra parte: tu <b>correo</b>, tu <b>nombre de
      usuario</b>, tu <b>cartera</b> ni tu <b>progreso de juego</b>, y no recibimos de vuelta
      ninguna lista de personas. Cómo rechazarlos está en <a href="#cookies">Cookies</a> — y el
      juego funciona por completo sin esas etiquetas.</p>`,

    dados: `
      <h2>7. Qué datos recogemos</h2>
      <table class="doc-tabela">
        <tr><th>Dato</th><th>Para qué</th><th>Cuánto tiempo</th></tr>
        <tr><td><b>Correo</b></td><td>Inicio de sesión, confirmación de cuenta, recuperación de
          contraseña y avisos de retiro</td><td>Mientras exista la cuenta</td></tr>
        <tr><td><b>Nombre de usuario</b></td><td>Identidad pública en el juego, el chat y los
          rankings</td><td>Mientras exista la cuenta</td></tr>
        <tr><td><b>Contraseña (hash)</b></td><td>Autenticación. Guardada como hash scrypt con
          sal — nunca en texto claro</td><td>Mientras exista la cuenta</td></tr>
        <tr><td><b>ID de Google / Discord</b></td><td>Identificar tu cuenta cuando entras con un
          proveedor externo</td><td>Mientras exista la cuenta</td></tr>
        <tr><td><b>Dirección IP</b></td><td>Limitar intentos de inicio de sesión y contener
          abuso automatizado</td><td>En memoria, unos minutos</td></tr>
        <tr><td><b>Progreso de juego</b></td><td>Guardar tu personaje, equipo, inventario y
          rankings</td><td>Mientras exista la cuenta</td></tr>
        <tr><td><b>Dirección de cartera</b></td><td>Enviar el USDT de los retiros que
          solicites</td><td>Registro contable del retiro</td></tr>
        <tr><td><b>Libro de Gemas</b></td><td>Auditar la caja y probar cada movimiento de
          saldo</td><td>Permanente (registro contable)</td></tr>
        <tr><td><b>Visita a la página</b> (IP, navegador, página)</td><td>Medir cuántos clics en
          anuncios se convierten en cuentas — la etiqueta de Google de la
          <a href="#privacidade">sección 6</a></td><td>Según la retención de Google Ads</td></tr>
      </table>
      <h3>Con quién compartimos</h3>
      <ul>
        <li>Un <b>proveedor de correo transaccional</b>, para entregar la confirmación de
        cuenta y el enlace de cambio de contraseña.</li>
        <li><b>Google y Discord</b>, cuando eliges entrar con ellos — y solo lo necesario para
        completar el inicio de sesión.</li>
        <li><b>Google Ads</b>, mediante la etiqueta de medición descrita en la
        <a href="#privacidade">sección 6</a>: IP, navegador y página visitada. Nunca tu correo,
        nombre de usuario ni progreso.</li>
        <li>La <b>red blockchain</b>, en caso de retiro: las transacciones en blockchain son
        públicas y permanentes por naturaleza.</li>
        <li><b>Autoridades</b>, cuando exista obligación legal.</li>
      </ul>
      <h3>Tus derechos</h3>
      <p>En cualquier momento puedes solicitar <b>acceso</b> a tus datos, <b>corrección</b>,
      <b>eliminación</b>, <b>portabilidad</b> y <b>revocación del consentimiento</b>. Escribe a
      <a href="mailto:${CONTATO}">${CONTATO}</a> desde el correo registrado y respondemos en un
      plazo de <b>30 días</b>.</p>
      <p>La eliminación borra cuenta, personaje, correo y progreso. El <b>libro financiero de
      Gemas</b> se conserva disociado de tu identidad, porque es el registro contable de los
      valores movidos — borrarlo impediría la auditoría de caja que protege a los demás
      jugadores.</p>`,

    cookies: `
      <h2>8. Cookies y almacenamiento local</h2>
      <p><b>El juego en sí no usa ninguna cookie.</b> Guarda en el almacenamiento local de tu
      navegador solo lo necesario para funcionar:</p>
      <ul>
        <li>El <b>token de tu sesión</b>, para no escribir la contraseña en cada visita.</li>
        <li>Tu <b>nombre de usuario</b>, como comodidad al escribir en el siguiente inicio de
        sesión.</li>
        <li><b>Preferencias de pantalla</b>, como el idioma y el nivel de zoom de la escena.</li>
      </ul>
      <p>Todo eso queda en tu navegador y desaparece cuando borras los datos del sitio.</p>

      <h3>Cookies de publicidad (Google)</h3>
      <p>La <b>etiqueta de Google</b> descrita en la <a href="#privacidade">sección 6</a> puede
      guardar cookies de medición de anuncios — la familia <code>_gcl_*</code> y las cookies de
      los dominios del propio Google. Sirven para atribuir una cuenta creada al anuncio que
      trajo a la persona, no para elaborar un perfil de navegación para nosotros.</p>
      <p>Para rechazarlas, cualquiera de estas opciones sirve:</p>
      <ul>
        <li>bloquear las <b>cookies de terceros</b> en la configuración del navegador;</li>
        <li>usar un <b>bloqueador de anuncios</b>;</li>
        <li>ajustar tus preferencias en
        <a href="https://adssettings.google.com" target="_blank" rel="noopener noreferrer">adssettings.google.com</a>.</li>
      </ul>
      <p><b>El juego funciona por completo con esas cookies bloqueadas.</b> Ninguna parte
      depende de ellas — inicio de sesión, batalla, mercado y retiros siguen igual.</p>`,

    diamantes: `
      <h2>9. Diamantes: moneda de la Tienda</h2>
      <p>El <b>Diamante</b> es la moneda de la Tienda del juego (VIP, bonos, outfits y
      pokébolas). Entra por <b>PIX</b> o <b>tarjeta de crédito</b> y se consume al gastarse: no
      se puede retirar ni transferir entre jugadores.</p>
      <div class="doc-aviso">
        <p>Al comprar diamantes, recibes saldo para usar en la Tienda del juego. Lo que pagas
        ayuda a mantener el servidor en línea, al equipo y al marketing que traen jugadores
        nuevos, además del desarrollo continuo del proyecto. Puedes solicitar reembolso en hasta
        7 días: solo devolvemos el valor de los diamantes <b>comprados</b> que aún quedan en la
        cuenta (voto y referido no cuentan). Al continuar, declaras que has leído, comprendido y
        aceptas íntegramente estas condiciones.</p>
      </div>
      <p>Antes de ir al pago, el juego pide marcar una casilla de aceptación con ese mismo
      texto. La marca de tiempo de esa aceptación queda guardada junto al pago.</p>
      <h3>Política de reembolso</h3>
      <p>El derecho de desistimiento de 7 días aplica a diamantes <b>comprados</b> que aún no
      fueron consumidos. Diamantes, VIP, bonos y demás artículos de la Tienda son
      <b>consumibles</b>: una vez gastados o activados, no se pueden devolver.</p>
      <ul>
        <li><b>Qué entra en el reembolso:</b> solo diamantes <b>comprados con dinero</b> que
        aún están en tu cuenta. Los recibidos por <b>voto en TopIdle</b> o por
        <b>referido</b> <b>no entran</b> en el cálculo — solo los que pagaste.</li>
        <li><b>Reembolso parcial:</b> si compraste 100 diamantes, gastaste 50 y pides reembolso,
        devolvemos el valor de los <b>50 que quedaron</b> — no el paquete entero. Si gastaste
        todo lo comprado, no quedan diamantes comprados para reembolsar.</li>
        <li><b>Beneficios ya usados:</b> si activaste VIP, compraste beast balls o disfrutaste
        cualquier ventaja de pago en la Tienda, eso <b>no se revierte</b> — el reembolso se
        limita al saldo de diamantes comprados que aún resta.</li>
        <li><b>Verificación:</b> cada compra, crédito (voto, referido, compra) y gasto queda
        registrado en los logs del juego. Usamos esos registros para calcular el valor y
        contestar abusos ante los proveedores de pago (PIX, tarjeta).</li>
        <li><b>Mala fe y abuso:</b> pedir reembolso por encima del saldo comprado restante — o
        después de usufruir beneficios mientras intentas recuperar lo pagado — puede resultar en
        <b>rechazo del reembolso</b>, baneo de la cuenta y medidas ante el proveedor de pago.
        </li>
      </ul>
      <p>Para solicitarlo, escribe a <b>support@pokeidle.io</b> con la fecha de compra y el nick
      de la cuenta.</p>
      <h3>Precio</h3>
      <table class="doc-tabela">
        <tr><th>Cantidad</th><th>Por diamante</th></tr>
        <tr><td>1 a 99</td><td><b>R$ 0,44</b></td></tr>
        <tr><td>100 a 149</td><td><b>R$ 0,42</b></td></tr>
        <tr><td>150 a 199</td><td><b>R$ 0,40</b></td></tr>
        <tr><td>200 o más</td><td><b>R$ 0,38</b></td></tr>
      </table>
      <p>El pago lo procesan terceros (Efí para PIX, Stripe para tarjeta) y los datos de la
      tarjeta <b>nunca pasan por nuestros servidores</b>. El saldo se acredita en cuanto el
      proveedor confirma.</p>`,

    orbs: `
      <h2>10. Gemas, compras y retiros</h2>
      <p>La <b>Gema</b> es la moneda premium del juego, respaldada en USDT. Se compra mediante
      depósito y puede convertirse de vuelta mediante retiro.</p>
      <table class="doc-tabela">
        <tr><th>Concepto</th><th>Valor</th></tr>
        <tr><td>Precio de compra de 1 Gema</td><td><b>US$ 0,01</b></td></tr>
        <tr><td>Precio de recompra (retiro) de 1 Gema</td><td><b>US$ 0,007</b></td></tr>
        <tr><td>Margen entre ambos extremos (<i>spread</i>)</td><td><b>30%</b></td></tr>
        <tr><td>Retiro mínimo</td><td><b>1.000 Gemas</b> (US$ 7,00)</td></tr>
        <tr><td>Máximo por retiro</td><td><b>1.000.000 Gemas</b></td></tr>
      </table>
      <p>El <b>spread del 30%</b> no es una comisión por transacción: es la diferencia entre el
      precio de compra y el de recompra, y de ahí salen la infraestructura, el desarrollo y la
      comisión de red de cada retiro. También está publicado dentro del juego, en la pantalla
      de Gemas.</p>
      <h3>Cómo se contabiliza el saldo</h3>
      <p>Todo movimiento de Gema escribe una línea en un <b>libro que nunca se modifica ni se
      borra</b> (<i>append-only</i>). El saldo que ves en el juego es un reflejo de ese libro, y
      la actualización del saldo ocurre en la misma transacción que escribe la línea. Eso es lo
      que permite auditar la caja sumando el libro y comparándolo con la cartera del proyecto, y
      reconstruir el saldo de cualquier jugador si algo sale mal.</p>
      <div class="doc-aviso">
        <p><b>Riesgo.</b> Las Gemas son un artículo de juego, no una inversión, un valor
        negociable ni un depósito bancario. No hay rendimiento, ni garantía de liquidez, ni
        seguro. Las transacciones en blockchain son <b>irreversibles</b>: una dirección de
        retiro mal escrita no puede ser deshecha por nosotros. Verifica la dirección antes de
        confirmar.</p>
      </div>
      <h3>Intercambio por valor real (RMT) y estafas entre jugadores</h3>
      <p>El juego <b>permite</b> el intercambio de objetos y pokémon entre jugadores por valor
      real — para eso existe el Mercado de la Comunidad, y usarlo no infringe ninguna regla.</p>
      <p>A cambio, el proyecto <b>no se responsabiliza por estafas entre jugadores ni arbitra
      disputas</b>. Esto incluye, entre otros:</p>
      <ul>
        <li>acuerdos hechos <b>fuera</b> del Mercado (promesa de pago, trato de palabra,
        intermediario) — sin el escrow del Mercado no hay nada que garantizar;</li>
        <li><b>una compra equivocada</b>: objeto, cantidad o precio distintos de lo previsto;</li>
        <li><b>un depósito enviado a una dirección distinta</b> de la que se te facilitó;</li>
        <li><b>un retiro pedido a una billetera equivocada</b> o en otra red.</li>
      </ul>
      <p>En los dos últimos casos el dinero está perdido, y no es política nuestra: una
      transacción en blockchain no tiene reembolso. Revisa siempre la dirección y la red antes
      de confirmar.</p>
      <p>Lo que el Mercado <b>sí garantiza</b> es lo que está bajo nuestro control: el objeto
      sale de las manos del vendedor en el momento de publicarlo (escrow), la compra es atómica
      y el precio cobrado es el que estaba en pantalla — un anuncio editado después de tu clic
      se rechaza, no se cobra.</p>`,

    mercado: `
      <h2>11. Mercado Global entre jugadores</h2>
      <p>El Mercado Global permite publicar objetos y pokémon para otros jugadores, cobrando en
      <b>oro</b> (moneda del juego) o en <b>Gemas</b>.</p>
      <table class="doc-tabela">
        <tr><th>Regla</th><th>Valor</th></tr>
        <tr><td>Comisión sobre ventas cobradas en <b>Gema</b></td><td><b>30%</b> del precio</td></tr>
        <tr><td>Comisión sobre ventas cobradas en <b>oro</b></td><td><b>0%</b></td></tr>
        <tr><td>Anuncios abiertos por jugador</td><td>hasta <b>20</b></td></tr>
      </table>
      <h3>Custodia del anuncio</h3>
      <p>Publicar <b>saca el objeto de tus manos</b>: sale del inventario (o el pokémon queda
      marcado como publicado) y permanece en custodia hasta la venta o la cancelación. Existe
      para que el comprador nunca pague por algo que el vendedor ya gastó o vendió en otro
      lugar.</p>
      <h3>Pago</h3>
      <p>El vendedor recibe el importe <b>ya descontada la comisión</b>, y el cobro se entrega
      en el siguiente inicio de sesión si estaba desconectado en el momento de la venta.
      Cancelar un anuncio devuelve el objeto; no hay devolución tras una venta concluida.</p>`,

    sorteios: `
      <h2>12. Sorteos y probabilidades</h2>
      <p>Publicamos las probabilidades porque quien invierte tiempo (o dinero) en un sistema
      aleatorio tiene derecho a saber qué está comprando. Los números siguientes son
      exactamente los que aplica el servidor.</p>
      <h3>Potencia (se sortea en cada captura)</h3>
      <table class="doc-tabela">
        <tr><th>Potencia</th><th>Probabilidad</th><th>Bonus de atributos</th></tr>
        <tr><td>1</td><td><b>74,495%</b></td><td>+0%</td></tr>
        <tr><td>2</td><td><b>20%</b></td><td>+5%</td></tr>
        <tr><td>3</td><td><b>5%</b></td><td>+10%</td></tr>
        <tr><td>4</td><td><b>0,5%</b></td><td>+25%</td></tr>
        <tr><td>5</td><td><b>0,005%</b></td><td>+100%</td></tr>
      </table>
      <h3>Shiny (se sortea al aparecer el pokémon salvaje)</h3>
      <p>La probabilidad es <b>1 entre 24.000</b> por encuentro para cualquier especie con forma
      shiny, sorteada al nacer el salvaje. Un shiny tiene el <b>doble</b> de
      atributos que la forma común. Los objetos de <i>boost</i> comprados en la Tienda
      multiplican esa probabilidad, y el multiplicador está descrito en el propio objeto.</p>
      <h3>Captura</h3>
      <p>La probabilidad de cada lanzamiento depende de la especie, del tipo de bola y de
      cuánto HP le queda al objetivo, y siempre está entre <b>0,3%</b> y <b>75%</b>. El juego
      muestra la estimación antes del lanzamiento.</p>
      <h3>Cómo ocurre el sorteo</h3>
      <p>Todo sorteo se ejecuta <b>en el servidor</b>, con el generador de números aleatorios
      de la plataforma. Tu navegador <b>no participa</b> del resultado: solo recibe y anima lo
      que ya fue decidido. Eso significa que ningún cliente modificado puede influir en
      captura, shiny, potencia o botín.</p>
      <p>Para dejar claro lo que <b>no</b> ofrecemos hoy: el resultado de cada sorteo
      individual <b>no</b> es verificable de forma independiente por el jugador — no publicamos
      semilla comprometida previamente ni hash por ronda. Lo que sí es auditable es lo
      <b>financiero</b>: el libro de Gemas descrito en la sección 9. Si implementamos
      verificación independiente de los sorteos, este documento se actualizará antes del
      lanzamiento de la función.</p>`,

    menores: `
      <h2>13. Menores de edad</h2>
      <p>El servicio no está destinado a menores de <b>13 años</b>. Entre los 13 y los 18 (o la
      mayoría de edad de tu país), el uso depende del <b>consentimiento y la supervisión</b> de
      un padre, madre o tutor — en especial para cualquier compra.</p>
      <p>Si sabemos que una cuenta pertenece a alguien por debajo de la edad mínima, se cierra
      y los datos se eliminan. Los tutores pueden solicitar la eliminación escribiendo a
      <a href="mailto:${CONTATO}">${CONTATO}</a>.</p>`,

    garantias: `
      <h2>14. Garantías y responsabilidad</h2>
      <p>El servicio se ofrece <b>"tal cual"</b>, sin garantía de disponibilidad
      ininterrumpida, ausencia de errores o adecuación a un fin concreto. Este es un proyecto
      de fans, mantenido sin vínculo comercial con los titulares de la franquicia, y puede
      <b>interrumpirse en cualquier momento</b> — incluso por una solicitud de retirada
      (sección 3).</p>
      <p>En la máxima medida permitida por la ley aplicable, no respondemos por lucro cesante,
      pérdida de progreso, pérdida de objetos virtuales ni daños indirectos. Nada en estos
      Términos excluye responsabilidades que la ley no permita excluir, incluidas las previstas
      en la legislación de consumo aplicable.</p>
      <p>En caso de cierre del servicio, avisaremos con la mayor antelación posible y
      abriremos una ventana para retirar los saldos de Gema existentes.</p>`,

    mudancas: `
      <h2>15. Cambios en estos términos</h2>
      <p>Podemos actualizar este documento. Los cambios relevantes — en especial los que
      afecten a comisiones, retiros o tratamiento de datos — se anuncian dentro del juego con
      al menos <b>15 días</b> de antelación. La fecha de la última actualización está siempre
      en el pie de esta página. Seguir usando el servicio tras la entrada en vigor significa
      aceptar la nueva versión.</p>`,

    contato: `
      <h2>16. Contacto</h2>
      <p>Para dudas, ejercicio de derechos sobre datos personales, denuncias o solicitudes de
      retirada por derechos de autor:</p>
      <p><b><a href="mailto:${CONTATO}">${CONTATO}</a></b></p>
      <p>Las solicitudes de titulares de derechos de la franquicia Pokémon tienen
      <b>prioridad</b> en nuestra cola, y el plazo de atención está en la sección 3.</p>`,
  },
};

// -------------------------------------------------------------------- tela

const DOCS = { pt, en, es };
const NOMES = { pt: 'Português', en: 'English', es: 'Español' };
const LANG_HTML = { pt: 'pt-BR', en: 'en', es: 'es' };

/**
 * O idioma inicial: o que a pessoa escolheu no jogo, senão o do navegador, senão português.
 *
 * Lê a MESMA chave de `localStorage` que o jogo usa, então quem já trocou o idioma lá não
 * precisa trocar de novo aqui — os termos abrem na língua em que ele estava jogando.
 */
function idiomaInicial() {
  const salvo = localStorage.getItem('idioma');
  if (DOCS[salvo]) return salvo;
  const nav = (navigator.language ?? 'pt').slice(0, 2).toLowerCase();
  return DOCS[nav] ? nav : 'pt';
}

function pintar(lang) {
  const doc = DOCS[lang] ?? DOCS.pt;
  document.documentElement.lang = LANG_HTML[lang] ?? 'pt-BR';
  document.title = `${doc.titulo} — Pokéidle.io`;
  document.getElementById('doc-voltar').textContent = doc.voltar;
  document.getElementById('doc-atualizado').textContent = doc.atualizado;

  document.getElementById('doc-indice').innerHTML = SECOES
    .map((id) => `<a href="#${id}">${doc.indice[id]}</a>`)
    .join('');
  document.getElementById('doc-texto').innerHTML = SECOES
    .map((id) => `<section id="${id}">${doc.corpo[id]}</section>`)
    .join('');

  for (const b of document.querySelectorAll('#doc-idiomas button')) {
    b.classList.toggle('on', b.dataset.lang === lang);
  }
  // A escolha feita AQUI vale para o jogo também: são o mesmo produto, e ler os termos em
  // espanhol e voltar para um jogo em português seria um tranco sem motivo.
  localStorage.setItem('idioma', lang);
}

const barra = document.getElementById('doc-idiomas');
barra.innerHTML = Object.entries(NOMES)
  .map(([lang, nome]) => `<button type="button" data-lang="${lang}">${nome}</button>`)
  .join('');
barra.onclick = (ev) => {
  const b = ev.target.closest('button');
  if (b) pintar(b.dataset.lang);
};

pintar(idiomaInicial());
