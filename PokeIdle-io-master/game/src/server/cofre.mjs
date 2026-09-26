/**
 * Criptografia dos campos que não podem vazar num dump.
 *
 * ### O que isto protege, e do quê
 *
 * O Postgres já está preso ao loopback e o firewall só abre 22/80/443 — ninguém alcança o
 * banco pela rede. O que sobra é o BACKUP: um `.sql.gz` no Desktop, num pendrive, num e-mail
 * para o contador. Esse arquivo sai da máquina protegida e leva a tabela inteira junto.
 *
 * E dentro dela há uma coisa que não é nossa para perder: o CPF de quem comprou diamante.
 * Nick, e-mail e saldo são dados do jogo; CPF é documento, e vazá-lo é problema de LGPD antes
 * de ser problema técnico. Então ele não fica em texto puro nem no banco nem no dump.
 *
 * ### Por que AES-256-GCM
 *
 * GCM é autenticado: quem editar um byte do texto cifrado não consegue um texto decifrado
 * diferente — consegue um ERRO. Sem isso, um CPF cifrado com AES-CBC pode ser adulterado por
 * quem tem escrita no banco sem que a leitura perceba.
 *
 * IV de 12 bytes ALEATÓRIO por gravação, nunca derivado do conteúdo: repetir (chave, IV) em
 * GCM não vaza só o registro repetido, quebra a autenticação dos dois. 12 bytes é o tamanho
 * nativo do GCM (qualquer outro faz o Node re-hashear o IV por dentro).
 *
 * ### O formato guardado
 *
 *   cof1:<iv base64url>:<tag base64url>:<cifrado base64url>
 *
 * O prefixo `cof1:` existe por DOIS motivos. O primeiro é a migração: as linhas gravadas antes
 * desta mudança estão em texto puro, e `decifrar` devolve o que não tem prefixo exatamente
 * como veio — nada quebra, e o valor se converte sozinho na próxima gravação. O segundo é a
 * troca de algoritmo: o dia em que `cof2:` existir, os dois convivem sem coluna de versão.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const PREFIXO = 'cof1:';
const b64u = (b) => Buffer.from(b).toString('base64url');
const deB64u = (s) => Buffer.from(s, 'base64url');

/**
 * A chave, lida uma vez do ambiente.
 *
 * `DADOS_CHAVE` são 32 bytes em hex (`openssl rand -hex 32`, ou o comando que o .env.example
 * mostra). Sem ela, `cifrar` devolve o texto puro e avisa uma vez: um jogo que se recusa a
 * subir porque falta uma variável nova é pior do que um jogo que grava como gravava ontem e
 * diz isso no log. Em produção o aviso é ERRO — ver `exigirChaveEmProducao`.
 */
let chaveCache;
let jaAvisou = false;

function chave() {
  if (chaveCache !== undefined) return chaveCache;
  const hex = String(process.env.DADOS_CHAVE ?? '').trim();
  if (!hex) {
    chaveCache = null;
  } else if (!/^[0-9a-f]{64}$/i.test(hex)) {
    console.error('[cofre] DADOS_CHAVE não são 64 caracteres hex — tratando como ausente.');
    chaveCache = null;
  } else {
    chaveCache = Buffer.from(hex, 'hex');
  }
  return chaveCache;
}

/** Há chave configurada? O painel usa isto para dizer se o CPF está protegido. */
export const cofreAtivo = () => chave() !== null;

/**
 * Grita no boot se produção estiver sem chave. Chamado por `gateway.mjs`.
 *
 * Não derruba o processo de propósito: a alternativa a "sobe avisando" seria o jogo inteiro
 * fora do ar por causa de uma variável que só afeta uma coluna.
 */
export function exigirChaveEmProducao() {
  if (!cofreAtivo() && process.env.NODE_ENV === 'production') {
    console.error(
      '[cofre] DADOS_CHAVE não definida — CPF seria gravado em TEXTO PURO no banco e nos backups.',
    );
  }
}

/**
 * Texto puro → `cof1:…`. Sem chave, devolve o texto como veio.
 *
 * `null`/`undefined`/`''` passam direto: cifrar "vazio" produziria um blob que parece dado e
 * estragaria os `COALESCE`/`filter(Boolean)` que o painel usa para contar quantas notas têm CPF.
 */
export function cifrar(texto) {
  if (texto === null || texto === undefined || texto === '') return texto ?? null;
  const k = chave();
  if (!k) {
    if (!jaAvisou) {
      console.warn('[cofre] sem DADOS_CHAVE — gravando em texto puro.');
      jaAvisou = true;
    }
    return String(texto);
  }
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', k, iv);
  const cifrado = Buffer.concat([c.update(String(texto), 'utf8'), c.final()]);
  return `${PREFIXO}${b64u(iv)}:${b64u(c.getAuthTag())}:${b64u(cifrado)}`;
}

/**
 * `cof1:…` → texto puro. Qualquer outra coisa volta como veio (linha antiga, texto puro).
 *
 * Falha de decifragem devolve `null` e loga, em vez de estourar: uma linha corrompida (ou
 * cifrada com uma chave que não existe mais) não pode derrubar a listagem inteira do painel.
 * `null` aparece como "—" na tela, que é a informação honesta.
 */
export function decifrar(guardado) {
  if (typeof guardado !== 'string' || !guardado.startsWith(PREFIXO)) return guardado ?? null;
  const k = chave();
  if (!k) {
    console.error('[cofre] valor cifrado no banco e nenhuma DADOS_CHAVE para abrir.');
    return null;
  }
  try {
    const [, iv, tag, dados] = guardado.split(':');
    const d = createDecipheriv('aes-256-gcm', k, deB64u(iv));
    d.setAuthTag(deB64u(tag));
    return Buffer.concat([d.update(deB64u(dados)), d.final()]).toString('utf8');
  } catch (err) {
    console.error('[cofre] decifrar falhou:', err.message);
    return null;
  }
}
