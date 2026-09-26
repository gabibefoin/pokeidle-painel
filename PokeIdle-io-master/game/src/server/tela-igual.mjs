// "Isto o cliente já tem?" — sem serializar, e sem gastar mais memória que o texto gastava.
//
// O delta de estado (`estadoParaEnviar`, em sim.mjs) decidia o que mandar comparando TEXTO: cada
// pokémon da coleção e cada entrada da Pokédex viravam `JSON.stringify` a cada envio, só para
// descobrir que quase nada tinha mudado. No perfil de produção de 14/09/2026 esses stringify eram
// 12,9% do tempo do sim — um jogador veterano paga duzentos pokémon serializados duas vezes por
// segundo para mandar a mudança de UM.
//
// Aqui a lembrança do que foi enviado é um array de tamanho exato: no índice 0, a lista de chaves
// (UMA lista compartilhada por todas as lembranças de mesmo formato — todo pokémon da tela tem as
// mesmas chaves, na mesma ordem); dali em diante, os valores na ordem das chaves. Comparar é andar
// o objeto e a lembrança em paralelo.
//
// A regra que não pode quebrar nunca: dizer "igual" só quando `JSON.stringify` produziria o MESMO
// texto. É o que esta comparação garante — mesmas chaves, na mesma ordem, com os mesmos valores —,
// então o cliente recebe exatamente o que receberia comparando texto. Onde não dá para garantir
// barato, a resposta é "diferente" ou o valor volta a ser lembrado como texto, o caminho de antes.
//
// O que a lembrança sabe guardar: primitivos, `Date` (pelo instante) e UM nível de objeto simples
// ou array com valores primitivos ou `Date` — a forma de um pokémon na tela (`stats`, `ivs`,
// `tipos`, `refino`) e de uma entrada da Pokédex. Mais fundo que isso, texto.
//
// Única diferença em relação ao texto, do lado seguro: `NaN` nunca é igual a si mesmo (o JSON o
// escreve `null`), e num array `undefined` e `null` contam como diferentes — os dois só reenviam.
//
// Memória e tempo medidos com 45 mil pokémon: `tools/teste-tela-igual.mjs`.

const ehPrimitivo = (v) => v === null || (typeof v !== 'object' && typeof v !== 'function');

/** Objeto literal ou `Object.create(null)` — nada de Map, Date, classe ou array. */
const ehObjetoSimples = (v) => {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
};

/** Um `Date` lembrado. Classe própria para nunca se confundir com um número de mesmo valor. */
class Instante {
  constructor(ms) {
    this.ms = ms;
  }
}

const texto = (v) => JSON.stringify(v) ?? '<undefined>';
const FALHOU = Symbol('falhou');

// ------------------------------------------------------------ chaves compartilhadas

const formatos = new Map(); // "tamanho:primeira chave" -> listas de chaves já vistas

/**
 * O formato usado por último para cada (tamanho, primeira chave) — o atalho do caso comum. A
 * lembrança anda as chaves do objeto comparando com ele, sem montar lista nem string de id; só
 * quando uma chave diverge a lista é montada e passa por `internar`.
 */
const ultimoFormato = new Map(); // tamanho -> Map(primeira chave -> lista de chaves)

function candidato(n, primeira) {
  const m = ultimoFormato.get(n);
  return m === undefined ? null : (m.get(primeira) ?? null);
}

/** As `i` primeiras chaves de `formato` numa lista nova de tamanho `n` — onde o atalho divergiu. */
function copiarInicio(formato, i, n) {
  const chaves = new Array(n);
  for (let j = 0; j < i; j++) chaves[j] = formato[j];
  return chaves;
}

/** Uma lista de chaves igual a `chaves` — a MESMA de outras lembranças desse formato, se houver. */
function internar(chaves) {
  const id = `${chaves.length}:${chaves[0] ?? ''}`;
  let lista = formatos.get(id);
  if (!lista) {
    lista = [];
    formatos.set(id, lista);
  }
  let achada = null;
  for (const conhecida of lista) {
    let igual = true;
    for (let i = 0; i < chaves.length; i++) {
      if (conhecida[i] !== chaves[i]) {
        igual = false;
        break;
      }
    }
    if (igual) {
      achada = conhecida;
      break;
    }
  }
  if (achada === null) {
    // Teto por formato: se algo gerar formatos sem fim, para de guardar e só perde o compartilhamento.
    if (lista.length < 64) lista.push(chaves);
    achada = chaves;
  }
  if (achada.length) {
    let m = ultimoFormato.get(achada.length);
    if (m === undefined) {
      m = new Map();
      ultimoFormato.set(achada.length, m);
    }
    // O mesmo teto em espírito: um mapa de atalhos que não cresce sem fim.
    if (m.size < 256 || m.has(achada[0])) m.set(achada[0], achada);
  }
  return achada;
}

// ------------------------------------------------------------------- lembrar

/** Folha lembrável: o próprio primitivo, um `Instante`, ou `FALHOU`. */
function folha(v) {
  if (ehPrimitivo(v)) return v;
  if (v instanceof Date) return new Instante(v.getTime());
  return FALHOU;
}

/** Quantas chaves o JSON escreveria (as de valor `undefined` ele omite). */
function contarChaves(o) {
  let n = 0;
  for (const k in o) if (o[k] !== undefined) n++;
  return n;
}

/** Um nível aninhado: `[chaves|null, ...valores]` — `null` quando é array. */
function lembrarNivel(v) {
  if (Array.isArray(v)) {
    const out = new Array(v.length + 1);
    out[0] = null;
    for (let i = 0; i < v.length; i++) {
      const f = folha(v[i]);
      if (f === FALHOU) return FALHOU;
      out[i + 1] = f;
    }
    return out;
  }
  if (!ehObjetoSimples(v)) return FALHOU;
  const n = contarChaves(v);
  const out = new Array(n + 1);
  let formato = null;
  let chaves = null;
  let i = 0;
  for (const k in v) {
    const x = v[k];
    if (x === undefined) continue;
    const f = folha(x);
    if (f === FALHOU) return FALHOU;
    if (i === 0) formato = candidato(n, k);
    if (chaves === null && (formato === null || formato[i] !== k)) chaves = copiarInicio(formato, i, n);
    if (chaves !== null) chaves[i] = k;
    out[++i] = f;
  }
  out[0] = chaves === null ? (formato ?? internar([])) : internar(chaves);
  return out;
}

/**
 * O que guardar do valor `v` para comparar no próximo envio: a lembrança compacta, ou — quando `v`
 * é mais fundo do que ela sabe guardar — o texto JSON, como antes.
 */
export function lembrarDaTela(v) {
  if (!ehObjetoSimples(v)) return texto(v);
  const n = contarChaves(v);
  const out = new Array(n + 1);
  let formato = null; // o atalho: a lista de chaves de um objeto de mesmo formato já lembrado
  let chaves = null; // só é montada se o atalho não existir ou divergir
  let i = 0;
  for (const k in v) {
    const x = v[k];
    if (x === undefined) continue;
    let guardado = folha(x);
    if (guardado === FALHOU) {
      guardado = lembrarNivel(x);
      if (guardado === FALHOU) return texto(v);
    }
    if (i === 0) formato = candidato(n, k);
    if (chaves === null && (formato === null || formato[i] !== k)) chaves = copiarInicio(formato, i, n);
    if (chaves !== null) chaves[i] = k;
    out[++i] = guardado;
  }
  out[0] = chaves === null ? (formato ?? internar([])) : internar(chaves);
  return out;
}

// ------------------------------------------------------------------ comparar

// O atalho `guardado === x` vem primeiro porque é o caso de quase toda chave (o mesmo número, o
// mesmo texto). Ele não muda resposta nenhuma: um `Instante` ou um array de lembrança só existem
// aqui dentro, nunca num objeto vivo, então nunca são `===` ao valor comparado.
function mesmaFolha(guardado, x) {
  if (guardado === x) return true;
  return guardado instanceof Instante && x instanceof Date && x.getTime() === guardado.ms;
}

function mesmoNivel(nivel, x) {
  const chaves = nivel[0];
  if (chaves === null) {
    if (!Array.isArray(x) || x.length !== nivel.length - 1) return false;
    for (let i = 0; i < x.length; i++) if (!mesmaFolha(nivel[i + 1], x[i])) return false;
    return true;
  }
  if (!ehObjetoSimples(x)) return false;
  let i = 0;
  for (const k in x) {
    const y = x[k];
    if (y === undefined) continue;
    if (i >= chaves.length || chaves[i] !== k || !mesmaFolha(nivel[i + 1], y)) return false;
    i++;
  }
  return i === chaves.length;
}

/** `true` só quando `JSON.stringify(v)` seria igual ao texto do valor lembrado. */
export function igualATela(lembrado, v) {
  if (lembrado === undefined) return false;
  if (typeof lembrado === 'string') return lembrado === texto(v);
  if (!ehObjetoSimples(v)) return false;
  const chaves = lembrado[0];
  let i = 0;
  for (const k in v) {
    const x = v[k];
    if (x === undefined) continue;
    if (i >= chaves.length || chaves[i] !== k) return false;
    const guardado = lembrado[i + 1];
    if (guardado !== x) {
      if (Array.isArray(guardado)) {
        if (!mesmoNivel(guardado, x)) return false;
      } else if (!mesmaFolha(guardado, x)) {
        return false;
      }
    }
    i++;
  }
  return i === chaves.length;
}
