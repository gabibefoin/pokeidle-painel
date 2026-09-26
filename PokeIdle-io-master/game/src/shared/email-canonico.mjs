/**
 * O e-mail reduzido à CAIXA que ele realmente entrega — a chave de identidade de uma conta.
 *
 * ### O buraco que isto fecha
 *
 * O cadastro guardava `email.toLowerCase()` e mais nada. Só que o Gmail IGNORA os pontos do
 * nome e tudo o que vier depois de um `+`: `pedro@gmail.com`, `p.e.d.r.o@gmail.com` e
 * `pedro+1@gmail.com` são **a mesma caixa** e chegavam aqui como três contas distintas — todas
 * confirmáveis pelo mesmo e-mail, todas passando pela lista de domínios de
 * `email-cadastro.mjs`. Ou seja: uma caixa de Gmail valia contas infinitas, e sem precisar
 * trocar de IP. Qualquer limite por IP ou por máquina montado antes disto estaria trancando a
 * porta da frente com a janela aberta.
 *
 * ### Por que a regra é por domínio, e não uma só para todos
 *
 * Porque a regra é do PROVEDOR, não nossa, e errar tem preços diferentes nos dois sentidos:
 *
 * - **Ponto** só é ignorado no Gmail. No Outlook e no iCloud, `joao.silva@` e `joaosilva@` são
 *   caixas de pessoas diferentes — apagar o ponto lá faria uma conta nova colidir com a de um
 *   estranho e o cadastro seria recusado sem que ninguém entendesse por quê.
 * - **`+apelido`** é cortado em todos os domínios da lista de cadastro. Nos cinco da Microsoft
 *   e do Google/Apple porque o provedor entrega na caixa base; no Yahoo pelo motivo explicado
 *   em `CORTA_MAIS`, que é diferente e vale ler.
 *
 * A régua, sempre: na dúvida, canonizar de MENOS **onde cortar poderia tirar a conta de
 * alguém**. Um apelido que escapa custa uma conta duplicada; juntar duas caixas que não são a
 * mesma tranca um jogador de verdade do lado de fora, e esse é o erro que não se descobre — a
 * pessoa desiste e vai embora sem abrir ticket. É por isso que o PONTO só some no Gmail, onde
 * ele comprovadamente não distingue caixa, e não some no Outlook nem no iCloud.
 *
 * ### O que esta lista NÃO alcança
 *
 * O **Ocultar Meu E-mail** da Apple: ele gera endereços `@icloud.com` aleatórios que chegam na
 * mesma caixa, e não há padrão nenhum a cortar — duas dessas são indistinguíveis de duas
 * pessoas. Nenhuma canonização resolve isso; quem segura esse caso é o carimbo de origem
 * (`origens-db.mjs`) e, um dia, o limite por dispositivo.
 *
 * E os APELIDOS DE DOMÍNIO: `me.com`/`mac.com` são a mesma conta Apple que `icloud.com`, e
 * `googlemail.com` é o mesmo Gmail. Hoje só o `googlemail.com` está mapeado porque os outros
 * não passam pela lista de `email-cadastro.mjs` — ninguém consegue cadastrar com eles. **Se
 * aquela lista crescer, esta tem de crescer junto**, senão a caixa volta a valer duas contas.
 *
 * ### O que isto NÃO é
 *
 * Não é o endereço para onde se manda e-mail. O que se envia continua indo para o que o
 * jogador digitou (`accounts.email`), porque é ele que aparece na caixa dele e é por ele que a
 * pessoa reconhece a mensagem. Isto aqui só responde a uma pergunta: *"já existe conta nesta
 * caixa?"*.
 */

/**
 * Domínios em que o `+apelido` é cortado.
 *
 * Os cinco primeiros porque o provedor documentadamente entrega `nome+seja-o-que-for` na caixa
 * de `nome`. O Yahoo entra por outro motivo, e vale registrar qual: ele **não aceita `+` no
 * nome da conta**, então `a+b@yahoo.com` não é apelido de `a@yahoo.com` — é um endereço que
 * não existe. Cortar ali não pode tirar a conta de ninguém (nenhuma caixa real do Yahoo tem
 * `+`; em produção são zero contas nos dois domínios dele contra 97 nos outros), e cobre o
 * caso de o Yahoo passar a entregar sub-endereço sem avisar. É o lado barato de errar: não
 * cortar custa uma caixa valendo contas infinitas; cortar não custa nada.
 */
const CORTA_MAIS = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'icloud.com',
  'yahoo.com',
  'yahoo.com.br',
]);

/** Domínios em que o PONTO no nome é decorativo. Só o Google faz isso. */
const IGNORA_PONTO = new Set(['gmail.com', 'googlemail.com']);

/** `googlemail.com` é o mesmo serviço que o `gmail.com` — e a mesma caixa. */
const APELIDO_DE_DOMINIO = new Map([['googlemail.com', 'gmail.com']]);

/**
 * A caixa que este endereço realmente atinge, ou `null` se não for um e-mail.
 *
 * @example emailCanonico('P.E.Dro+jogo2@GoogleMail.com') // 'pedro@gmail.com'
 * @example emailCanonico('joao.silva+x@outlook.com')     // 'joao.silva@outlook.com'
 */
export function emailCanonico(email) {
  const norm = String(email ?? '').trim().toLowerCase();
  const at = norm.lastIndexOf('@');
  if (at <= 0 || at === norm.length - 1) return null;

  let nome = norm.slice(0, at);
  const dominio = APELIDO_DE_DOMINIO.get(norm.slice(at + 1)) ?? norm.slice(at + 1);

  if (CORTA_MAIS.has(dominio)) {
    const mais = nome.indexOf('+');
    if (mais >= 0) nome = nome.slice(0, mais);
  }
  if (IGNORA_PONTO.has(dominio)) nome = nome.replaceAll('.', '');

  // `pedro+@gmail.com` e `...@gmail.com` sobram como nome vazio: não é caixa nenhuma, e deixar
  // passar criaria uma chave `@gmail.com` que casaria com qualquer outro endereço estropiado.
  if (!nome) return null;
  return `${nome}@${dominio}`;
}
