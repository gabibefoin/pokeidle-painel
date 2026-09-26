/**
 * DE ONDE cada conta entra — o carimbo que alimenta a visão de multi-conta do painel.
 *
 * ### Era só um registro; agora é registro E teto
 *
 * Este arquivo nasceu sem recusar nada, de propósito: a regra que se queria um dia ("N contas
 * por máquina") depende de um número — 4? 6? 10? — e escolher esse número sem dado é escolher
 * quantos jogadores legítimos trancar do lado de fora. No Brasil isso não é hipótese:
 * operadora móvel põe milhares de assinantes atrás de um IPv4 (CGNAT), e provedor de bairro,
 * lan house, escola e república fazem o mesmo em menor escala.
 *
 * O parque foi medido no painel, o número escolhido foi 4, e o teto agora existe: ver
 * `podeCriarNoIp`. Ele recusa a CRIAÇÃO de conta, nunca o login — e carrega três travas
 * contra o erro que este arquivo existiu para evitar até aqui, o de trancar gente de verdade
 * do lado de fora:
 *
 * 1. conta só quem NASCEU naquela rede, e não quem passou por ela;
 * 2. falha ABERTA — sem IP legível ou com o banco fora, o cadastro passa;
 * 3. a moderação isenta um IP num clique (`liberarIp`), e cada recusa é contada
 *    (`origem_recusas`) para que um CGNAT mal classificado apareça sozinho no painel.
 *
 * ### Uma linha por (conta, origem), não uma por login
 *
 * Gravar toda entrada faria uma tabela que cresce com o tráfego e não responde melhor: o que
 * a pergunta "quantas contas nesta máquina?" precisa é do PAR, não do histórico. Então o
 * `ON CONFLICT` transforma a repetição em `ultimo_em`/`vezes`, e a tabela cresce com o número
 * de origens distintas — que é pequeno e estável por jogador.
 *
 * ### Sem FK para `accounts`, de propósito
 *
 * Um `REFERENCES ... ON DELETE CASCADE` faria "apagar a conta" virar "apagar a prova": bastaria
 * excluir e recriar para zerar a contagem daquela máquina. A coluna guarda o id solto; conta
 * que não existe mais aparece no painel como id sem nick, que é exatamente a informação certa.
 *
 * ### Os dois sinais, e o que cada um vale
 *
 * - **`ip_bucket`** (ver `bucketDeIp`): confiável na origem (o `ip-cliente.mjs` explica por
 *   quê), mas mede a SAÍDA da rede, não a máquina. Erra para mais no CGNAT e para menos em IP
 *   dinâmico — quem reinicia o modem ganha origem nova.
 * - **`dispositivo`**: um id que o próprio cliente gera e guarda no `localStorage`. É o mais
 *   próximo de "máquina" que um navegador entrega, e o preço é honesto: some quando se limpa o
 *   site, quando se abre uma aba anônima ou quando se troca de navegador. Em compensação ele
 *   nunca acusa duas máquinas diferentes de serem a mesma, que é o erro caro. Digital de
 *   navegador (canvas/fontes/tela) resolveria a evasão e traria justamente esse erro de volta:
 *   dois aparelhos iguais do modelo mais vendido do país dariam a mesma digital.
 */
import { isIPv4 } from 'node:net';
import { pool } from './db.mjs';
import { bucketDeIp, ehCloudflare, ipParaGravar } from './ip-cliente.mjs';

export async function migrar() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS conta_origens (
      id           BIGSERIAL PRIMARY KEY,
      conta_id     BIGINT NOT NULL,
      nick         TEXT,
      evento       TEXT NOT NULL,          -- 'criar' | 'entrar'
      -- Os dois sinais de origem. String vazia (e não NULL) para "não sei": eles entram numa
      -- chave única, e NULL nunca é igual a NULL num índice — com NULL, cada login sem
      -- dispositivo inseriria uma linha nova para sempre, e a tabela cresceria com o tráfego.
      ip           TEXT,
      ip_bucket    TEXT NOT NULL DEFAULT '',
      dispositivo  TEXT NOT NULL DEFAULT '',
      vezes        INT NOT NULL DEFAULT 1,
      primeiro_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
      ultimo_em    TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  // Chave por COLUNA, sem expressão. O `ON CONFLICT` lá embaixo precisa inferir exatamente
  // este índice, e inferência por expressão é o tipo de detalhe que passa na leitura e falha
  // no banco — com as colunas `NOT NULL DEFAULT ''` acima, a chave vira trivial.
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_origem_par
        ON conta_origens (conta_id, ip_bucket, dispositivo)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_origem_ip ON conta_origens (ip_bucket, ultimo_em)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_origem_disp ON conta_origens (dispositivo, ultimo_em)`);

  // O IP que a moderação ISENTOU do teto de contas. Ver `podeCriarNoIp` para o porquê de isto
  // ser obrigatório, e não um luxo.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS origem_liberada (
      ip_bucket  TEXT PRIMARY KEY,
      nota       TEXT,
      por_email  TEXT,
      criado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);

  // Quantas vezes o teto RECUSOU um cadastro naquele IP. Uma linha por IP, não por tentativa:
  // o que se quer saber é "este IP está batendo na trave demais?", e não o histórico.
  //
  // É o que transforma o teto de uma regra cega numa regra auditável: um IP doméstico recusa
  // duas ou três vezes e para; um bloco de CGNAT recusa dezenas de pessoas DIFERENTES por
  // semana — e é esse número que denuncia que ele precisa entrar na isenção.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS origem_recusas (
      ip_bucket   TEXT PRIMARY KEY,
      vezes       INT NOT NULL DEFAULT 1,
      primeiro_em TIMESTAMPTZ NOT NULL DEFAULT now(),
      ultimo_em   TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);

  // O IP BANIDO — o contrário da whitelist. Ver `ipBanido` e o bloco "banimento de IP" abaixo.
  // `expira_em` nulo é para sempre. `bloqueios` conta o que o ban barrou, para o painel mostrar
  // se ele ainda está pegando alguém.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS origem_banida (
      ip_bucket          TEXT PRIMARY KEY,
      motivo             TEXT,
      por_email          TEXT,
      criado_em          TIMESTAMPTZ NOT NULL DEFAULT now(),
      expira_em          TIMESTAMPTZ,
      bloqueios          INT NOT NULL DEFAULT 0,
      ultimo_bloqueio_em TIMESTAMPTZ
    )`);
}

/** O id de dispositivo que o cliente mandou, limpo. Formato nosso: hex/uuid curto. */
export const dispositivoLimpo = (v) => {
  const s = String(v ?? '').trim();
  return /^[a-zA-Z0-9-]{8,64}$/.test(s) ? s : null;
};

/**
 * Carimba (ou atualiza) a origem desta entrada.
 *
 * Nunca lança: isto é telemetria de abuso, e derrubar um login de verdade porque a gravação
 * falhou seria trocar um problema pequeno por um grande. O erro vai para o log e a vida segue.
 *
 * `evento` só é gravado na PRIMEIRA vez que o par aparece — o que interessa depois é se a
 * conta NASCEU naquela origem, e um login posterior não pode apagar esse fato.
 */
export async function registrarOrigem({ contaId, nick, evento, ip, ipBucket, dispositivo }) {
  if (!contaId) return;
  try {
    await pool.query(
      `INSERT INTO conta_origens (conta_id, nick, evento, ip, ip_bucket, dispositivo)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (conta_id, ip_bucket, dispositivo)
       DO UPDATE SET vezes = conta_origens.vezes + 1,
                     ultimo_em = now(),
                     nick = COALESCE(EXCLUDED.nick, conta_origens.nick),
                     ip = COALESCE(EXCLUDED.ip, conta_origens.ip)`,
      [
        Number(contaId),
        nick ? String(nick).slice(0, 16) : null,
        String(evento).slice(0, 16),
        ipParaGravar(ip),
        ipBucket ?? '',
        dispositivo ?? '',
      ],
    );
  } catch (err) {
    console.error('[origens] não deu para carimbar:', err.message);
  }
}

// --------------------------------------------------- o teto de contas por IP

/**
 * Quantas contas uma mesma saída de rede pode ABRIR. `0` desliga a regra por inteiro.
 *
 * Lido a cada chamada, e não uma vez no carregamento do módulo: este arquivo é importado por
 * `auth-rotas.mjs`, que entra na árvore de imports antes do `config.mjs` que povoa o `.env` —
 * uma constante de topo leria `undefined` e o teto nasceria no valor errado sem ninguém notar.
 */
const MAX_POR_IP_PADRAO = 4;
export const maxContasPorIp = () => {
  const n = Number(process.env.MAX_CONTAS_POR_IP ?? MAX_POR_IP_PADRAO);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : MAX_POR_IP_PADRAO;
};

/**
 * Quantas contas da mesma rede podem estar CONECTADAS ao mesmo tempo. `0` desliga.
 *
 * É um limite diferente do de cima, e não o mesmo número usado duas vezes — ainda que nasçam
 * iguais. O teto de cadastro governa quantas contas uma rede pode ABRIR; este governa quantas
 * podem estar JOGANDO agora, e ele pega justamente o buraco do outro: quem criou as contas em
 * redes diferentes (celular, trabalho, casa de amigo) e depois roda todas na mesma máquina,
 * com quatro navegadores abertos, nunca encostou no teto de cadastro.
 */
const MAX_ONLINE_PADRAO = 4;
export const maxOnlinePorIp = () => {
  const n = Number(process.env.MAX_ONLINE_POR_IP ?? MAX_ONLINE_PADRAO);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : MAX_ONLINE_PADRAO;
};

/**
 * Quantas contas NASCERAM nesta saída de rede e ainda existem.
 *
 * ### Por que `evento = 'criar'`, e não "toda conta vista aqui"
 *
 * É a diferença entre a regra funcionar e a regra atropelar jogador legítimo — a decisão mais
 * importante deste arquivo.
 *
 * Contar toda conta que já ENTROU por um IP mede o LUGAR, não a pessoa: um bloco de CGNAT de
 * operadora móvel junta milhares de assinantes sem relação nenhuma entre si, e lan house,
 * escola e república fazem o mesmo em menor escala. Com essa contagem, quatro desconhecidos
 * que um dia abriram o jogo naquela rede trancariam o quinto — que nunca criou conta nenhuma
 * na vida. Pior: bastaria alguém LOGAR as próprias contas de um IP alheio para envenenar o
 * cadastro de todo mundo que sai por ele.
 *
 * Contar só quem NASCEU ali responde exatamente a pergunta que o teto faz — "quantas contas
 * esta conexão já abriu?" — e o preço é honesto: quem cria a quinta conta de outra rede
 * passa. Passa mesmo. O teto é freio de atrito, não parede; quem quiser furá-lo troca de
 * rede, e aí o painel de Multi-contas continua enxergando o aglomerado pelo DISPOSITIVO.
 *
 * ### Banida conta; apagada não
 *
 * A conta BANIDA continua ocupando a vaga, e é isso que faz a faxina valer: se o soft ban
 * liberasse o lugar, quem levasse quatro bans abriria quatro contas novas no mesmo minuto.
 *
 * A APAGADA não ocupa. O carimbo dela sobrevive (é o ponto do "sem FK" lá em cima) e continua
 * aparecendo no painel, mas cobrar a vaga de uma conta que não existe mais é uma pena sem
 * prazo e sem recurso — inclusive para quem pediu exclusão por LGPD e um dia quer voltar.
 */
export async function contasNascidasNoIp(ipBucket) {
  const chave = String(ipBucket ?? '').trim();
  if (!chave) return 0;
  const { rows } = await pool.query(
    `SELECT count(DISTINCT o.conta_id)::int AS n
       FROM conta_origens o
       JOIN accounts a ON a.id = o.conta_id
      WHERE o.ip_bucket = $1 AND o.evento = 'criar'`,
    [chave],
  );
  return Number(rows[0]?.n ?? 0);
}

/** Este IP está na whitelist? Consulta direta, para quem não está no caminho quente. */
export async function ipLiberado(ipBucket) {
  const chave = String(ipBucket ?? '').trim();
  if (!chave) return false;
  const { rows } = await pool.query(`SELECT 1 FROM origem_liberada WHERE ip_bucket = $1`, [chave]);
  return rows.length > 0;
}

/**
 * A whitelist inteira, em memória.
 *
 * O limite de sessões simultâneas é conferido a CADA socket que abre — que é o evento mais
 * frequente do gateway. Uma ida ao Postgres ali põe a latência do banco na frente de cada
 * entrada no jogo, e um Postgres lento viraria um jogo lento para todo mundo. A lista é
 * minúscula (dezenas de IPs) e muda quando alguém clica num botão do painel, então ela cabe
 * num `Set` com folga.
 *
 * Os 30 s são o teto do atraso quando a invalidação não chega (um gateway que subiu no meio
 * da publicação, por exemplo). O caminho normal é instantâneo: `esquecerWhitelist` é chamado
 * em todo gateway assim que o painel mexe na lista.
 *
 * Falha ABERTA de novo, mas para o outro lado: com o banco fora, devolve o cache velho — e
 * cache velho aqui só erra a favor de quem já estava liberado.
 */
const VALIDADE_WHITELIST = 30_000;
let whitelist = { em: 0, ips: new Set() };
let refrescando = null;

export async function ipsLiberados() {
  if (Date.now() - whitelist.em < VALIDADE_WHITELIST) return whitelist.ips;

  // Uma consulta por vez, por mais gente que peça ao mesmo tempo.
  //
  // Sem esta trava, a hora mais cara do dia seria justo a pior: logo depois de um deploy,
  // MILHARES de jogadores reconectam em poucos segundos, todos com o cache frio, e cada um
  // dispararia o seu próprio SELECT — uma estampida contra um Postgres que ainda está
  // rodando as migrações do boot. Com a promessa compartilhada, os milhares esperam a MESMA
  // consulta, e o custo do cache frio é uma ida ao banco, não uma por jogador.
  if (!refrescando) {
    refrescando = pool.query(`SELECT ip_bucket FROM origem_liberada`)
      .then(({ rows }) => {
        whitelist = { em: Date.now(), ips: new Set(rows.map((r) => r.ip_bucket)) };
        return whitelist.ips;
      })
      .catch((err) => {
        // Banco fora: segura a lista ANTERIOR e adia a próxima tentativa. Errar para o lado
        // de quem já estava liberado é o lado barato; travar jogador por causa de um SELECT
        // que falhou é o caro.
        console.error('[origens] whitelist não pôde ser lida, mantendo a anterior:', err.message);
        whitelist.em = Date.now();
        return whitelist.ips;
      })
      .finally(() => { refrescando = null; });
  }
  return refrescando;
}

/** Derruba o cache — chamado em todo gateway quando o painel mexe na whitelist. */
export const esquecerWhitelist = () => { whitelist = { em: 0, ips: whitelist.ips }; };

/** O IP está liberado de TODOS os limites de rede? Versão do caminho quente. */
export async function redeLiberada(ipBucket) {
  const chave = String(ipBucket ?? '').trim();
  if (!chave) return false;
  return (await ipsLiberados()).has(chave);
}

/**
 * Esta saída de rede ainda pode abrir conta?
 *
 * ### Falha ABERTA, sempre
 *
 * Sem `ipBucket` (cabeçalho ausente, endereço que não passa no formato) ou com o banco fora, a
 * resposta é SIM. Um cadastro recusado porque o NOSSO lado não conseguiu ler o próprio IP é
 * perda pura: o jogador honesto vai embora e o abusador nem percebe que existia uma regra. O
 * lado seguro do erro, aqui, é deixar entrar.
 *
 * @returns {{pode:boolean, contas:number, limite:number, liberado:boolean}}
 */
export async function podeCriarNoIp(ipBucket) {
  const limite = maxContasPorIp();
  const chave = String(ipBucket ?? '').trim();
  if (!limite || !chave) return { pode: true, contas: 0, limite, liberado: false };
  try {
    const contas = await contasNascidasNoIp(chave);
    if (await ipLiberado(chave)) return { pode: true, contas, limite, liberado: true };
    return { pode: contas < limite, contas, limite, liberado: false };
  } catch (err) {
    console.error('[origens] teto por IP não pôde ser conferido:', err.message);
    return { pode: true, contas: 0, limite, liberado: false };
  }
}

/**
 * Carimba que o teto recusou um cadastro neste IP.
 *
 * Nunca lança, pela mesma razão de `registrarOrigem`: isto é a contabilidade DA regra, e não
 * a regra — a recusa já aconteceu quando esta função é chamada.
 */
export async function registrarRecusaDeIp(ipBucket) {
  const chave = String(ipBucket ?? '').trim();
  if (!chave) return;
  try {
    await pool.query(
      `INSERT INTO origem_recusas (ip_bucket) VALUES ($1)
       ON CONFLICT (ip_bucket)
       DO UPDATE SET vezes = origem_recusas.vezes + 1, ultimo_em = now()`,
      [chave],
    );
  } catch (err) {
    console.error('[origens] não deu para contar a recusa:', err.message);
  }
}

/** Isenta um IP do teto — o CGNAT da operadora, a lan house, a escola. */
export async function liberarIp({ ipBucket, nota, porEmail }) {
  const chave = String(ipBucket ?? '').trim();
  if (!chave) throw new Error('IP obrigatório');
  await pool.query(
    `INSERT INTO origem_liberada (ip_bucket, nota, por_email) VALUES ($1, $2, $3)
     ON CONFLICT (ip_bucket) DO UPDATE
       SET nota = EXCLUDED.nota, por_email = EXCLUDED.por_email, criado_em = now()`,
    [chave, nota ? String(nota).slice(0, 300) : null, porEmail ?? null],
  );
  esquecerWhitelist();
  return { ok: true, ipBucket: chave };
}

/** Devolve o IP ao teto. */
export async function travarIp(ipBucket) {
  const chave = String(ipBucket ?? '').trim();
  if (!chave) throw new Error('IP obrigatório');
  const { rowCount } = await pool.query(`DELETE FROM origem_liberada WHERE ip_bucket = $1`, [chave]);
  if (!rowCount) throw new Error('esse IP não estava na whitelist');
  esquecerWhitelist();
  return { ok: true, ipBucket: chave };
}

/**
 * O painel do teto: quem está isento e quem está batendo na trave.
 *
 * As recusas vêm ordenadas pelo TAMANHO, e não pela data, porque a pergunta que elas existem
 * para responder é "qual IP está recusando gente demais?" — o candidato a CGNAT mal
 * classificado está sempre no topo dessa lista.
 */
export async function estadoDoTetoPorIp({ limite = 40 } = {}) {
  const lim = Math.max(1, Math.min(200, Number(limite) || 40));
  const nascidas = `(SELECT count(DISTINCT o.conta_id)::int
                       FROM conta_origens o JOIN accounts a ON a.id = o.conta_id
                      WHERE o.ip_bucket = $$CHAVE$$ AND o.evento = 'criar')`;
  const [liberados, recusas] = await Promise.all([
    pool.query(
      `SELECT l.ip_bucket, l.nota, l.por_email, l.criado_em,
              ${nascidas.replace('$$CHAVE$$', 'l.ip_bucket')} AS nascidas
         FROM origem_liberada l
        ORDER BY l.criado_em DESC
        LIMIT $1`,
      [lim],
    ),
    pool.query(
      `SELECT r.ip_bucket, r.vezes, r.primeiro_em, r.ultimo_em,
              (l.ip_bucket IS NOT NULL) AS liberado,
              ${nascidas.replace('$$CHAVE$$', 'r.ip_bucket')} AS nascidas
         FROM origem_recusas r
         LEFT JOIN origem_liberada l ON l.ip_bucket = r.ip_bucket
        ORDER BY r.vezes DESC, r.ultimo_em DESC
        LIMIT $1`,
      [lim],
    ),
  ]);
  return {
    limite: maxContasPorIp(),
    limiteOnline: maxOnlinePorIp(),
    liberados: liberados.rows.map((r) => ({
      ipBucket: r.ip_bucket,
      nota: r.nota,
      porEmail: r.por_email,
      criadoEm: r.criado_em,
      nascidas: Number(r.nascidas ?? 0),
    })),
    recusas: recusas.rows.map((r) => ({
      ipBucket: r.ip_bucket,
      vezes: Number(r.vezes ?? 0),
      primeiroEm: r.primeiro_em,
      ultimoEm: r.ultimo_em,
      liberado: !!r.liberado,
      nascidas: Number(r.nascidas ?? 0),
    })),
  };
}

// ------------------------------------------------------------- banimento de IP
//
// ### O que ele barra
//
// TUDO que chega por aquela saída de rede: o site, o cadastro, o login (senha, Google, Discord)
// e o socket do jogo. Quem já estava jogando é derrubado na hora (o gateway ouve
// `CANAL_IP_BANIDO`). É a ferramenta para quem abre contas aos montes, e é por isso que ela é
// uma lista à parte, e não um "teto 0" no teto de cadastro: o teto só recusa CRIAR, e o
// abusador segue logando nas cem contas que já tem.
//
// ### O preço, dito por extenso
//
// Um IP não é uma pessoa (ver o topo deste arquivo). Banir o CGNAT de uma operadora tranca do
// lado de fora milhares de assinantes que nunca viram o abusador — por isso o painel mostra,
// ANTES do clique, quantas contas nasceram, quantas entraram e quantas estão jogando por ali, e
// avisa quando o IP está na whitelist (que é justamente a lista de redes compartilhadas). E há
// prazo: IPv4 residencial é dinâmico, e o endereço banido para sempre um dia é de outra casa.
//
// ### A régua é a mesma do resto do arquivo
//
// IPv4 é o endereço; IPv6 é o /64 (`bucketDeIp`). Banir o endereço IPv6 cheio não pegaria
// ninguém: o aparelho troca de endereço dentro do /64 sozinho.

/**
 * O que o moderador digitou, reduzido à chave do ban: um IP qualquer ("2804:14c::1", "1.2.3.4")
 * ou a própria chave que o painel mostra ("2804:14c:1:2::/64"). `null` se não for nada disso.
 */
const CHAVE_V6 = /^[0-9a-f]{1,4}(:[0-9a-f]{1,4}){3}::\/64$/;

export function chaveDeBanDeIp(entrada) {
  const s = String(entrada ?? '').trim().toLowerCase();
  if (!s || s.length > 64) return null;
  // A chave de /64 como o painel escreve — `bucketDeIp` recusaria a barra.
  if (CHAVE_V6.test(s)) return s;
  // `bucketDeIp` é tolerante de propósito (ele agrupa o que o cabeçalho trouxer). Aqui a chave
  // vai para uma lista de BLOQUEIO, então só passa o que é endereço de verdade: um IPv4 válido
  // ou um /64 bem formado. "999.1" ou "1:2:3" não viram ban que nunca pega ninguém.
  const chave = bucketDeIp(s);
  return chave && (isIPv4(chave) || CHAVE_V6.test(chave)) ? chave : null;
}

/**
 * Por que esta chave NÃO pode ser banida, ou `null` se pode.
 *
 * São endereços que, se aparecerem como "IP do jogador", apareceram por erro de configuração —
 * e banir um deles derruba todo mundo que passa por ali:
 *
 *   · LOOPBACK / não especificado — é o próprio servidor (ou o proxy local sem cabeçalho);
 *   · uma faixa do CLOUDFLARE — com o `CF-Connecting-IP` mal lido, o "IP" de milhares de
 *     jogadores vira a borda do Cloudflare por onde eles chegam.
 */
export function motivoParaNaoBanir(chave) {
  if (!chave) return 'IP inválido';
  if (isIPv4(chave)) {
    if (chave.startsWith('127.') || chave === '0.0.0.0') return 'esse é um endereço local do próprio servidor';
    if (ehCloudflare(chave)) return 'esse IP é do Cloudflare, não de um jogador — banir derrubaria todo mundo que passa por ele';
    return null;
  }
  const prefixo = chave.replace('::/64', '');
  if (prefixo === '0:0:0:0') return 'esse é um endereço local do próprio servidor';
  if (ehCloudflare(`${prefixo}::1`)) return 'esse bloco é do Cloudflare, não de um jogador — banir derrubaria todo mundo que passa por ele';
  return null;
}

/** O teto do prazo: dez anos. Acima disso é "para sempre", e para sempre é `horas: 0`. */
const MAX_HORAS_BAN_IP = 24 * 365 * 10;

/** Texto livre para o registro e o log: sem quebra de linha nem caractere de controle. */
const textoLimpo = (s, max) =>
  String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) || null;

/**
 * Os IPs banidos, em memória: `Map<ip_bucket, expiraEmMs | null>`.
 *
 * É lido em TODA requisição HTTP e em todo socket que abre — o caminho mais quente do gateway —,
 * então tem o mesmo desenho da whitelist: cache de 30 s, uma consulta por vez, derrubado na
 * hora pelo painel (`esquecerBanidos`, via `CANAL_IP_BANIDO`).
 *
 * Com o banco fora, segura a lista ANTERIOR. Aqui o erro barato é o contrário do da whitelist —
 * deixar de barrar um abusador por alguns segundos —, mas o caro seria o mesmo: travar o site
 * inteiro porque um SELECT falhou.
 */
let banidos = { em: 0, ips: new Map() };
let refrescandoBanidos = null;

export async function ipsBanidos() {
  if (Date.now() - banidos.em < VALIDADE_WHITELIST) return banidos.ips;
  if (!refrescandoBanidos) {
    refrescandoBanidos = pool.query(
      `SELECT ip_bucket, expira_em FROM origem_banida WHERE expira_em IS NULL OR expira_em > now()`,
    )
      .then(({ rows }) => {
        banidos = {
          em: Date.now(),
          ips: new Map(rows.map((r) => [r.ip_bucket, r.expira_em ? new Date(r.expira_em).getTime() : null])),
        };
        return banidos.ips;
      })
      .catch((err) => {
        console.error('[origens] lista de IPs banidos não pôde ser lida, mantendo a anterior:', err.message);
        banidos.em = Date.now();
        return banidos.ips;
      })
      .finally(() => { refrescandoBanidos = null; });
  }
  return refrescandoBanidos;
}

/** Derruba o cache — chamado em todo gateway quando o painel bane ou desbane. */
export const esquecerBanidos = () => { banidos = { em: 0, ips: banidos.ips }; };

/**
 * Esta saída de rede está banida AGORA? Versão do caminho quente.
 *
 * O prazo é conferido aqui também, e não só no SELECT: sem isso, um ban de 24 h continuaria
 * valendo até 30 s além da hora, pelo tempo de vida do cache.
 */
export async function ipBanido(ipBucket) {
  const chave = String(ipBucket ?? '').trim();
  if (!chave) return false;
  const ips = await ipsBanidos();
  if (!ips.has(chave)) return false;
  const ate = ips.get(chave);
  return ate == null || ate > Date.now();
}

/**
 * Conta que o ban barrou alguém. Acumula em memória e grava no máximo uma vez por minuto:
 * quem está banido costuma insistir (F5, script), e uma escrita por requisição barrada seria o
 * abusador ditando o ritmo do Postgres. Nunca lança — é contabilidade, não a regra.
 */
const bloqueiosPendentes = new Map();
let ultimaGravacaoDeBloqueios = 0;

export function registrarBloqueioDeIp(ipBucket) {
  const chave = String(ipBucket ?? '').trim();
  if (!chave) return;
  bloqueiosPendentes.set(chave, (bloqueiosPendentes.get(chave) ?? 0) + 1);
  if (Date.now() - ultimaGravacaoDeBloqueios < 60_000) return;
  ultimaGravacaoDeBloqueios = Date.now();
  const lote = [...bloqueiosPendentes];
  bloqueiosPendentes.clear();
  pool.query(
    `UPDATE origem_banida b
        SET bloqueios = b.bloqueios + n.qtd, ultimo_bloqueio_em = now()
       FROM unnest($1::text[], $2::int[]) AS n(ip_bucket, qtd)
      WHERE b.ip_bucket = n.ip_bucket`,
    [lote.map(([k]) => k), lote.map(([, v]) => v)],
  ).catch((err) => console.error('[origens] não deu para contar os bloqueios:', err.message));
}

/** Bane uma saída de rede. `horas` 0/vazio = para sempre. Banir de novo troca motivo e prazo. */
export async function banirIp({ ipBucket, motivo, porEmail, horas }) {
  const chave = chaveDeBanDeIp(ipBucket);
  if (!chave) throw new Error('IP inválido — use um endereço (1.2.3.4, 2804:…) ou o bloco /64 do painel');
  const intocavel = motivoParaNaoBanir(chave);
  if (intocavel) throw new Error(intocavel);
  const h = Math.min(MAX_HORAS_BAN_IP, Math.max(0, Math.floor(Number(horas) || 0)));
  const { rows } = await pool.query(
    `INSERT INTO origem_banida (ip_bucket, motivo, por_email, expira_em)
     VALUES ($1, $2, $3, CASE WHEN $4::int > 0 THEN now() + $4::int * INTERVAL '1 hour' END)
     ON CONFLICT (ip_bucket) DO UPDATE
       SET motivo = EXCLUDED.motivo, por_email = EXCLUDED.por_email,
           criado_em = now(), expira_em = EXCLUDED.expira_em
     RETURNING expira_em`,
    [chave, textoLimpo(motivo, 300), porEmail ?? null, h],
  );
  esquecerBanidos();
  return { ok: true, ipBucket: chave, expiraEm: rows[0]?.expira_em ?? null };
}

/** Tira o ban. As CONTAS banidas junto (se houve) continuam banidas — ver o painel. */
export async function desbanirIp(ipBucket) {
  const chave = chaveDeBanDeIp(ipBucket);
  if (!chave) throw new Error('IP inválido');
  const { rowCount } = await pool.query(`DELETE FROM origem_banida WHERE ip_bucket = $1`, [chave]);
  if (!rowCount) throw new Error('esse IP não estava banido');
  esquecerBanidos();
  return { ok: true, ipBucket: chave };
}

/** A lista do painel: os bans de pé primeiro, os vencidos por último (ainda aparecem, para limpar). */
export async function listarIpsBanidos({ limite = 100 } = {}) {
  const lim = Math.max(1, Math.min(500, Number(limite) || 100));
  const { rows } = await pool.query(
    `SELECT b.*, (b.expira_em IS NOT NULL AND b.expira_em <= now()) AS vencido,
            (SELECT count(DISTINCT o.conta_id)::int
               FROM conta_origens o JOIN accounts a ON a.id = o.conta_id
              WHERE o.ip_bucket = b.ip_bucket AND o.evento = 'criar') AS nascidas
       FROM origem_banida b
      ORDER BY vencido ASC, b.criado_em DESC
      LIMIT $1`,
    [lim],
  );
  return rows.map((r) => ({
    ipBucket: r.ip_bucket,
    motivo: r.motivo,
    porEmail: r.por_email,
    criadoEm: r.criado_em,
    expiraEm: r.expira_em,
    vencido: !!r.vencido,
    bloqueios: Number(r.bloqueios ?? 0),
    ultimoBloqueioEm: r.ultimo_bloqueio_em,
    nascidas: Number(r.nascidas ?? 0),
  }));
}

/**
 * O retrato de um IP ANTES de banir: quem mora ali.
 *
 * `nascidas` são as contas criadas nesta rede que existem e NÃO estão banidas — as candidatas a
 * cair junto. `vistas` é todo mundo que já entrou por ela (nasceu ou não): é o número que mede o
 * estrago de banir uma rede compartilhada.
 */
export async function retratoDoIp(ipBucket) {
  const chave = chaveDeBanDeIp(ipBucket);
  if (!chave) throw new Error('IP inválido — use um endereço (1.2.3.4, 2804:…) ou o bloco /64 do painel');
  const intocavel = motivoParaNaoBanir(chave);
  if (intocavel) throw new Error(intocavel);
  const [nascidas, vistas, liberado, ban] = await Promise.all([
    pool.query(
      `SELECT DISTINCT a.id, a.nick, a.email
         FROM conta_origens o
         JOIN accounts a ON a.id = o.conta_id
         LEFT JOIN account_bans b ON b.account_id = a.id
        WHERE o.ip_bucket = $1 AND o.evento = 'criar' AND b.account_id IS NULL
        ORDER BY a.nick`,
      [chave],
    ),
    pool.query(
      `SELECT count(DISTINCT o.conta_id)::int AS n FROM conta_origens o
         JOIN accounts a ON a.id = o.conta_id WHERE o.ip_bucket = $1`,
      [chave],
    ),
    ipLiberado(chave),
    pool.query(`SELECT motivo, expira_em FROM origem_banida WHERE ip_bucket = $1`, [chave]),
  ]);
  return {
    ipBucket: chave,
    nascidas: nascidas.rows.map((r) => ({ id: Number(r.id), nick: r.nick, email: r.email })),
    vistas: Number(vistas.rows[0]?.n ?? 0),
    liberado,
    jaBanido: ban.rows[0] ? { motivo: ban.rows[0].motivo, expiraEm: ban.rows[0].expira_em } : null,
  };
}

/**
 * O SELECT de um agrupamento (por IP ou por dispositivo). Os dois têm a mesma forma.
 *
 * `coluna` entra por interpolação de texto — nome de coluna não pode ser `$1`. Hoje as duas
 * únicas chamadas passam literais deste arquivo, então não há entrada de fora; o `COLUNAS`
 * abaixo é o que garante que continue assim no dia em que alguém quiser agrupar por um
 * terceiro campo vindo do painel.
 *
 * ### Três contagens, não uma
 *
 * A linha carimbada SOBREVIVE à exclusão da conta — é o ponto do "sem FK" lá em cima. Só que
 * uma contagem única fazia esse acerto virar defeito no painel: quem apagava 29 das 33 contas
 * de uma origem via a mesma linha de 33 no dia seguinte, e não tinha como saber o que ainda
 * estava de pé. Então são três números:
 *
 * - **contas** — existem hoje e não estão banidas. É o número que se compara com o teto que a
 *   moderação anuncia ("no máximo N por máquina"), e o único que cai quando se apaga alguém.
 * - **banidas** — a conta continua lá, punida. Não some sozinha e pode ser desbanida.
 * - **apagadas** — o id sem conta: a prova que o `DELETE` não leva junto.
 *
 * O `HAVING` conta as que EXISTEM (contas + banidas), e não o total: é o que faz uma origem
 * limpa sair da lista depois da faxina, que era o pedido. Com `incluirApagadas`, o corte volta
 * a ser o total — a visão de arqueologia, para quem quer ver quem já foi uma fazenda.
 */
const COLUNAS_AGRUPAVEIS = new Set(['o.ip_bucket', 'o.dispositivo']);

/** Tetos das listas de nick por linha. Ver `multicontas` sobre o número escolhido. */
const NICKS_MAX = 300;
const NICKS_PADRAO = 60;

const agrupamento = (coluna, { nicks = NICKS_PADRAO, incluirApagadas = false, contaId = null } = {}) => {
  if (!COLUNAS_AGRUPAVEIS.has(coluna)) throw new Error(`coluna de agrupamento inválida: ${coluna}`);
  // Vai por interpolação, como a coluna: um `$n` dentro de fatia de array (`[1:$3]`) é
  // justamente o tipo de detalhe que o Postgres não infere. É `Number` já preso à faixa.
  const n = Math.max(1, Math.min(NICKS_MAX, Math.trunc(Number(nicks)) || NICKS_PADRAO));
  const existe = 'a.id IS NOT NULL';
  const viva = `${existe} AND b.account_id IS NULL`;
  const banida = `${existe} AND b.account_id IS NOT NULL`;
  const apagada = 'a.id IS NULL';
  const corte = incluirApagadas
    ? 'count(DISTINCT o.conta_id)'
    : `count(DISTINCT o.conta_id) FILTER (WHERE ${existe})`;
  // `array_agg(...) FILTER` devolve NULL quando nenhuma linha casa — sem o COALESCE o painel
  // receberia `null` no lugar de lista vazia e teria de se defender disso em três lugares.
  const lista = (cond, texto) =>
    `(COALESCE(array_agg(DISTINCT ${texto}) FILTER (WHERE ${cond}), '{}'))[1:${n}]`;
  // `nascidas` é a MESMA conta que `contasNascidasNoIp` faz — contas que existem hoje e que
  // NASCERAM nesta origem. Tem de ser a mesma, e não uma parecida: é o número que o teto de
  // cadastro cobra, e o painel que mostrasse outro faria o moderador prever errado quem ainda
  // consegue criar conta. Substituiu um `count(*)` de LINHAS com `evento = 'criar'`, que
  // contava apagada junto e podia contar a mesma conta duas vezes (dois aparelhos, um IP).
  //
  // `liberado` só faz sentido no agrupamento por IP — a isenção é de rede, não de aparelho —,
  // e por isso sai como `false` no outro.
  const nascidas = `count(DISTINCT o.conta_id) FILTER (WHERE ${existe} AND o.evento = 'criar')::int`;
  const liberado = coluna === 'o.ip_bucket'
    ? `EXISTS (SELECT 1 FROM origem_liberada l WHERE l.ip_bucket = ${coluna})`
    : 'false';
  // Busca por nick: só as origens que ESTA conta usou (`$3`). A contagem de cada uma continua sendo
  // a de todo mundo que passou por ela — é justamente o que mostra as outras contas do jogador.
  const soDaConta = contaId != null
    ? ` AND ${coluna} IN (SELECT x.${coluna.slice(2)} FROM conta_origens x WHERE x.conta_id = $3)`
    : '';
  return `
  SELECT ${coluna}                                   AS chave,
         count(DISTINCT o.conta_id) FILTER (WHERE ${viva})::int    AS contas,
         count(DISTINCT o.conta_id) FILTER (WHERE ${banida})::int  AS banidas,
         count(DISTINCT o.conta_id) FILTER (WHERE ${apagada})::int AS apagadas,
         ${nascidas}                                 AS nascidas,
         ${liberado}                                 AS liberado,
         min(o.primeiro_em)                          AS de,
         max(o.ultimo_em)                            AS ate,
         ${lista(viva, 'a.nick')}                    AS nicks,
         ${lista(banida, 'a.nick')}                  AS nicks_banidos,
         ${lista(apagada, "COALESCE(o.nick, '#' || o.conta_id)")} AS nicks_apagados
    FROM conta_origens o
    LEFT JOIN accounts a     ON a.id = o.conta_id
    LEFT JOIN account_bans b ON b.account_id = o.conta_id
   WHERE ${coluna} <> ''${soDaConta}
   GROUP BY ${coluna}
  HAVING ${corte} >= $1
   ORDER BY ${corte} DESC, max(o.ultimo_em) DESC
   LIMIT $2`;
};

/**
 * Os aglomerados de contas por origem.
 *
 * `minimo` é do painel, não uma regra: quem olha escolhe a partir de quantas contas uma origem
 * merece atenção. Uma linha aqui NÃO é prova de fraude — família, república e lan house dão
 * exatamente o mesmo desenho que uma fazenda de contas. É o primeiro lugar a olhar, não o
 * último.
 */
export async function multicontas({ minimo = 2, limite = 60, nicks, incluirApagadas = false, nick = '' } = {}) {
  const min = Math.max(2, Math.min(50, Number(minimo) || 2));
  const lim = Math.max(1, Math.min(200, Number(limite) || 60));
  // Busca por NICK: todas as origens (aparelho e IP) que aquela conta usou, com quem mais passou por
  // cada uma. O mínimo cai para 1 — a origem que só ele usou também aparece, e é o que diz "este
  // aqui não divide máquina com ninguém".
  const pedido = String(nick ?? '').trim().slice(0, 64);
  let alvo = null;
  if (pedido) {
    const { rows } = await pool.query(`SELECT id, nick FROM accounts WHERE lower(nick) = lower($1)`, [pedido]);
    if (!rows[0]) throw new Error(`nenhuma conta com o nick "${pedido}"`);
    alvo = { contaId: Number(rows[0].id), nick: rows[0].nick };
  }
  // 60 nicks por grupo cobre o aglomerado que se investiga de verdade sem transformar um
  // bucket de CGNAT (centenas de contas legítimas atrás de um IPv4) numa resposta de MB. O
  // painel diz na tela quantos ficaram de fora, então o corte nunca mente por omissão.
  const opcoes = { nicks, incluirApagadas: !!incluirApagadas, contaId: alvo?.contaId ?? null };
  const params = alvo ? [1, lim, alvo.contaId] : [min, lim];

  const [porIp, porDispositivo, resumo] = await Promise.all([
    pool.query(agrupamento('o.ip_bucket', opcoes), params),
    pool.query(agrupamento('o.dispositivo', opcoes), params),
    pool.query(`
      SELECT count(*)::int                                  AS linhas,
             count(DISTINCT o.conta_id)::int                AS contas,
             count(DISTINCT o.conta_id)
               FILTER (WHERE a.id IS NULL)::int             AS apagadas,
             count(DISTINCT o.ip_bucket)::int               AS ips,
             count(DISTINCT o.dispositivo)::int             AS dispositivos,
             min(o.primeiro_em)                             AS desde
        FROM conta_origens o
        LEFT JOIN accounts a ON a.id = o.conta_id`),
  ]);

  const linha = (r) => ({
    chave: r.chave,
    contas: r.contas,
    banidas: r.banidas,
    apagadas: r.apagadas,
    nascidas: r.nascidas,
    liberado: !!r.liberado,
    de: r.de,
    ate: r.ate,
    nicks: r.nicks ?? [],
    nicksBanidos: r.nicks_banidos ?? [],
    nicksApagados: r.nicks_apagados ?? [],
  });

  return {
    minimo: min,
    incluirApagadas: !!incluirApagadas,
    alvo,
    limitePorIp: maxContasPorIp(),
    resumo: resumo.rows[0] ?? null,
    porIp: porIp.rows.map(linha),
    porDispositivo: porDispositivo.rows.map(linha),
  };
}

/**
 * Os IPs que a FAXINA GERAL visita: mais contas de pé que o teto, e fora da whitelist.
 *
 * "De pé" é a mesma conta da coluna do painel (existe e não está banida) — é o número que o botão
 * "Faxina (−N)" de cada linha compara com o teto. A whitelist entra no `WHERE`, e não depois: um
 * IP isento não é candidato nem para aparecer na prévia.
 *
 * Do maior aglomerado para o menor (o IP desempata), que é também a ordem em que a faxina geral
 * roda. `prefixo` existe só para os testes isolarem os IPs deles; o painel nunca o manda.
 */
export async function origensAcimaDoTeto(limite, { prefixo = null, max = 200 } = {}) {
  const teto = Math.max(1, Math.trunc(Number(limite)) || 4);
  const lim = Math.max(1, Math.min(1000, Math.trunc(Number(max)) || 200));
  const { rows } = await pool.query(
    `SELECT o.ip_bucket AS chave,
            count(DISTINCT o.conta_id) FILTER (WHERE a.id IS NOT NULL AND b.account_id IS NULL)::int AS contas
       FROM conta_origens o
       LEFT JOIN accounts a     ON a.id = o.conta_id
       LEFT JOIN account_bans b ON b.account_id = o.conta_id
      WHERE o.ip_bucket <> ''
        AND ($3::text IS NULL OR o.ip_bucket LIKE $3 || '%')
        AND NOT EXISTS (SELECT 1 FROM origem_liberada l WHERE l.ip_bucket = o.ip_bucket)
      GROUP BY o.ip_bucket
     HAVING count(DISTINCT o.conta_id) FILTER (WHERE a.id IS NOT NULL AND b.account_id IS NULL) > $1
      ORDER BY 2 DESC, 1 ASC
      LIMIT $2`,
    [teto, lim + 1, prefixo],
  );
  return { grupos: rows.slice(0, lim).map((r) => ({ chave: r.chave, contas: r.contas })), cortado: rows.length > lim };
}

/** O IP está na whitelist AGORA — lido do banco, sem o cache de `ipsLiberados`. */
export async function ipNaWhitelist(ipBucket) {
  const { rows } = await pool.query(`SELECT 1 FROM origem_liberada WHERE ip_bucket = $1`, [String(ipBucket ?? '')]);
  return rows.length > 0;
}

/**
 * Todas as contas de UM aglomerado, com o que decide quem é forte e quem é fraco.
 *
 * É a leitura que a faxina de multi-conta usa para montar o plano. Traz junto os DOIS saldos
 * (diamante e gema) porque eles vão ser transferidos, e o escrow do Mercado porque ele é a
 * parte do diamante que a transferência NÃO alcança — ver `planoDeFaxina`, em `admin.mjs`.
 *
 * `nasceuAqui` vem do `bool_or`: a conta pode ter várias linhas nesta mesma origem (um IP,
 * dois navegadores) e basta uma delas dizer `criar` para a conta ter nascido ali.
 */
export async function contasDoGrupo({ tipo, chave }) {
  const coluna = tipo === 'dispositivo' ? 'o.dispositivo' : 'o.ip_bucket';
  const valor = String(chave ?? '').trim();
  if (!valor) throw new Error('origem obrigatória');
  const { rows } = await pool.query(
    `SELECT a.id, a.nick, a.email, a.criado_em, a.ultimo_login,
            p.id AS player_id, p.level, p.gold, p.diamonds, p.orbs, p.last_seen,
            (b.account_id IS NOT NULL) AS banido,
            coalesce(b.soft, false)    AS ban_soft,
            bool_or(o.evento = 'criar') AS nasceu_aqui,
            min(o.primeiro_em)          AS visto_de,
            max(o.ultimo_em)            AS visto_ate,
            (SELECT coalesce(sum(m.qtd), 0)::int FROM market_anuncios m
              WHERE m.vendedor_id = p.id AND m.tipo = 'diamante' AND m.estado = 'aberto')
              AS diamantes_em_anuncio
       FROM conta_origens o
       JOIN accounts a          ON a.id = o.conta_id
       LEFT JOIN players p      ON lower(p.nick) = lower(a.nick)
       LEFT JOIN account_bans b ON b.account_id = a.id
      WHERE ${coluna} = $1
      GROUP BY a.id, p.id, b.account_id, b.soft
      ORDER BY coalesce(p.level, 0) DESC, coalesce(p.diamonds, 0) DESC,
               coalesce(p.orbs, 0) DESC, coalesce(p.gold, 0) DESC, a.id ASC`,
    [valor],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    nick: r.nick,
    email: r.email,
    criadoEm: r.criado_em,
    ultimoLogin: r.ultimo_login,
    playerId: r.player_id != null ? Number(r.player_id) : null,
    level: r.level != null ? Number(r.level) : 0,
    gold: r.gold != null ? Number(r.gold) : 0,
    diamonds: r.diamonds != null ? Number(r.diamonds) : 0,
    orbs: r.orbs != null ? Number(r.orbs) : 0,
    diamantesEmAnuncio: Number(r.diamantes_em_anuncio ?? 0),
    lastSeen: r.last_seen,
    banido: !!r.banido,
    banSoft: !!r.ban_soft,
    nasceuAqui: !!r.nasceu_aqui,
    vistoDe: r.visto_de,
    vistoAte: r.visto_ate,
  }));
}

/**
 * As origens de UMA conta — a visão de dentro para fora, usada na ficha do jogador.
 *
 * As contagens de vizinhança separam quem EXISTE de quem já foi apagado, pela mesma razão do
 * agrupamento lá em cima: "6 contas neste IP" que não muda depois da faxina é um número que o
 * moderador aprende a não acreditar.
 */
export async function origensDaConta(contaId) {
  if (!contaId) return [];
  const vizinhanca = (campo, apagadas) => `
    (SELECT count(DISTINCT x.conta_id)::int
       FROM conta_origens x
       LEFT JOIN accounts ax ON ax.id = x.conta_id
      WHERE x.${campo} <> '' AND x.${campo} = o.${campo}
        AND ax.id IS ${apagadas ? '' : 'NOT '}NULL)`;
  const { rows } = await pool.query(
    `SELECT o.ip, o.ip_bucket, o.dispositivo, o.evento, o.vezes, o.primeiro_em, o.ultimo_em,
            ${vizinhanca('ip_bucket', false)}   AS contas_no_ip,
            ${vizinhanca('ip_bucket', true)}    AS apagadas_no_ip,
            ${vizinhanca('dispositivo', false)} AS contas_no_dispositivo,
            ${vizinhanca('dispositivo', true)}  AS apagadas_no_dispositivo
       FROM conta_origens o
      WHERE o.conta_id = $1
      ORDER BY o.ultimo_em DESC
      LIMIT 40`,
    [Number(contaId)],
  );
  return rows.map((r) => ({
    ip: r.ip,
    ipBucket: r.ip_bucket || null,
    dispositivo: r.dispositivo || null,
    evento: r.evento,
    vezes: r.vezes,
    primeiroEm: r.primeiro_em,
    ultimoEm: r.ultimo_em,
    contasNoIp: r.contas_no_ip ?? 0,
    apagadasNoIp: r.apagadas_no_ip ?? 0,
    contasNoDispositivo: r.contas_no_dispositivo ?? 0,
    apagadasNoDispositivo: r.apagadas_no_dispositivo ?? 0,
  }));
}
