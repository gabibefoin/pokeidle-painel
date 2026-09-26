// O PACOTE CRU entre o sim e o gateway.
//
// Era um `publish` por jogador por tick — `{ para, msgs }` em JSON —, e o gateway fazia
// `JSON.parse` do pacote inteiro só para, em seguida, `JSON.stringify` de cada mensagem de novo
// antes do `ws.send`. No perfil de produção de 14/09/2026 isso era 17% do tempo do sim (um write
// no socket do Redis por jogador) e 20% do tempo do gateway (desmontar e remontar o que já era
// texto). O Redis via ~3.050 publishes por segundo.
//
// Aqui o sim serializa cada mensagem UMA vez, junta os registros de todos os jogadores de um mesmo
// gateway e publica UM pacote por gateway por volta do laço. O gateway só recorta e repassa. O que
// chega ao navegador é, byte a byte, o mesmo `JSON.stringify(mensagem)` de antes — é o que o
// `tools/teste-saida-crua.mjs` confere.
//
// ### O formato
//
//     \u0002 registro \n registro \n …
//     registro = para \u001f meta \u001f json \u001f json …
//
// Por que estes separadores não colidem com nada: `JSON.stringify` escapa todo caractere de
// controle (U+0000–U+001F) dentro de strings e não emite quebra de linha fora delas — então nem
// `\n`, nem `\u001f`, nem `\u0002` aparecem num texto JSON. O `para` é o nick minúsculo; um nick
// com separador (que o validador de nick já recusa) cai no caminho JSON de sempre.
//
// A MARCA `\u0002` no primeiro caractere separa o pacote cru do JSON (que começa com `{`): o gateway
// entende os dois, e tudo que ainda publica objeto — admin, kick, outro gateway — segue igual.
//
// `meta` é o pouco que o gateway lê ANTES de repassar (hoje em `lerCargo` e no aviso de hello lento),
// já extraído no sim: sem ele o gateway teria de voltar a fazer `JSON.parse` do estado.

export const MARCA_CRU = '\u0002';
const SEP_REGISTRO = '\n';
const SEP_CAMPO = '\u001f';

/** `true` quando a mensagem do Redis é um pacote cru (e não JSON). */
export const ehPacoteCru = (raw) => typeof raw === 'string' && raw.charCodeAt(0) === 2;

/** Um `para` só serve no formato cru se não tiver separador — senão, caminho JSON. */
export const paraCabeNoCru = (para) =>
  typeof para === 'string' && para.length > 0 && para.indexOf(SEP_REGISTRO) < 0 && para.indexOf(SEP_CAMPO) < 0
  && para.indexOf(MARCA_CRU) < 0;

/**
 * O que o gateway precisa das mensagens, na mesma regra de `lerCargo` (gateway.mjs) aplicada em
 * sequência: um campo presente numa mensagem posterior sobrescreve o da anterior, e um campo
 * ausente não mexe no que o socket já tem. `w` avisa que há um `welcome` no registro.
 *
 * Devolve `null` quando não há nada a ler — o caso comum, que vira meta vazio no fio.
 */
export function metaDasMensagens(msgs, tipoWelcome) {
  let meta = null;
  for (const m of msgs) {
    if (m?.t === tipoWelcome) (meta ??= {}).w = 1;
    const e = m?.estado;
    if (!e) continue;
    if (typeof e.level === 'number') (meta ??= {}).l = e.level;
    if (typeof e.loja?.vip === 'boolean') (meta ??= {}).v = e.loja.vip;
    if (e.caixas) (meta ??= {}).f = e.caixas.tag ?? null;
    if ('guild' in e) {
      (meta ??= {}).g = e.guild?.id ? Number(e.guild.id) : null;
      // A TAG pega carona no mesmo `in e` do id: ela vai no carimbo de toda linha do chat
      // (`ws.guildTag`), e perguntar ao sim a cada fala seria uma ida ao banco por mensagem.
      meta.gt = e.guild?.tag ?? null;
      meta.gc = e.guild?.tagCor ?? null;
    }
  }
  return meta;
}

/** Um registro: as mensagens de UM jogador, na ordem em que o sim as mandaria. */
export function registroCru(para, msgs, tipoWelcome) {
  const meta = metaDasMensagens(msgs, tipoWelcome);
  let s = para + SEP_CAMPO + (meta ? JSON.stringify(meta) : '');
  for (const m of msgs) s += SEP_CAMPO + JSON.stringify(m);
  return s;
}

/** O pacote de um gateway: todos os registros da volta do laço, na ordem de chegada. */
export const pacoteCru = (registros) => MARCA_CRU + registros.join(SEP_REGISTRO);

/**
 * Teto de um pacote, em caracteres. Cada `publish` fica perto disto — e isto é CORREÇÃO, não ajuste.
 *
 * Sem teto, a volta do laço em que muita gente entra junto (deploy, queda de internet de uma
 * operadora) juntava dezenas de `welcome` de ~200 kB num único publish de ~20 MB. Enquanto o gateway
 * processava essa string ele não lia o socket do Redis, o buffer de saída do assinante passava dos
 * 32 MB que o Redis tolera para pub/sub, e o Redis DERRUBAVA a conexão — com as mensagens daquela
 * janela perdidas. Medido na bancada em 14/09/2026 (`client-output-buffer-limit`): 204 de 300
 * jogadores sem welcome.
 *
 * 256 kB mantém cada pacote pequeno para o gateway intercalar leituras, e ainda são dezenas de
 * publishes por segundo por shard contra os milhares de antes.
 */
export const LIMITE_PACOTE = 256 * 1024;

/**
 * A saída em lote de um processo: acumula registros por gateway e publica em pacotes de até
 * `limite` caracteres. `publicar(canal, pacote)`, `agendar(fn)` e `canalDe(gatewayId)` vêm de fora —
 * o barramento passa o Redis e o `setImmediate`; o teste passa um gravador.
 *
 * Garantias (conferidas em `tools/teste-saida-crua.mjs`):
 *   · a ordem de chamada se mantém, dentro de um gateway, entre pacotes e dentro de cada pacote;
 *   · nenhum pacote passa do teto, a não ser um registro que sozinho já passe — e esse sai sozinho,
 *     depois de tudo que estava na fila antes dele;
 *   · o que sobrar sai no `agendar` do fim da volta do laço.
 */
export function criarSaidaEmLote({ publicar, agendar, canalDe, tipoWelcome, limite = LIMITE_PACOTE }) {
  const porGateway = new Map(); // gatewayId -> { registros, tamanho }
  let agendado = false;

  function soltar(gatewayId, fila) {
    if (!fila.registros.length) return;
    publicar(canalDe(gatewayId), pacoteCru(fila.registros));
    fila.registros = [];
    fila.tamanho = 0;
  }

  function despejar() {
    agendado = false;
    for (const [gatewayId, fila] of porGateway) soltar(gatewayId, fila);
    porGateway.clear();
  }

  function enviar(gatewayId, para, msgs) {
    const registro = registroCru(para, msgs, tipoWelcome);
    let fila = porGateway.get(gatewayId);
    if (!fila) {
      fila = { registros: [], tamanho: 0 };
      porGateway.set(gatewayId, fila);
    }
    if (fila.tamanho > 0 && fila.tamanho + registro.length > limite) soltar(gatewayId, fila);
    fila.registros.push(registro);
    fila.tamanho += registro.length + 1;
    if (fila.tamanho >= limite) soltar(gatewayId, fila);
    if (!agendado) {
      agendado = true;
      agendar(despejar);
    }
  }

  return { enviar, despejar };
}

/**
 * Lê um pacote cru e chama `entregar(para, meta, frames)` para cada registro, na ordem.
 *
 * `frames` são os textos JSON prontos para o `ws.send`, sem parse. Um registro torto (sem o
 * separador do `para`) é pulado — não derruba os outros do mesmo pacote.
 */
export function lerPacoteCru(raw, entregar) {
  const n = raw.length;
  let ini = 1;
  while (ini < n) {
    let fim = raw.indexOf(SEP_REGISTRO, ini);
    if (fim < 0) fim = n;
    const c1 = raw.indexOf(SEP_CAMPO, ini);
    if (c1 >= 0 && c1 < fim) {
      const c2 = raw.indexOf(SEP_CAMPO, c1 + 1);
      const fimMeta = c2 < 0 || c2 > fim ? fim : c2;
      const metaTxt = raw.slice(c1 + 1, fimMeta);
      const frames = [];
      let i = fimMeta + 1;
      while (i < fim) {
        let j = raw.indexOf(SEP_CAMPO, i);
        if (j < 0 || j > fim) j = fim;
        frames.push(raw.slice(i, j));
        i = j + 1;
      }
      entregar(raw.slice(ini, c1), metaTxt ? JSON.parse(metaTxt) : null, frames);
    }
    ini = fim + 1;
  }
}
