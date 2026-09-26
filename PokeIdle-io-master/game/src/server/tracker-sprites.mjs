// O RETRATO DE CADA ESPÉCIE, para o Tracker — onde recortá-lo e de qual arquivo.
//
// ### Por que não dá para usar o `marker-atlas`
//
// O jogo tem um atlas de retratos pronto (`site/assets/maps/marker-atlas.png`, um PNG de 1,2 MB
// indexado por looktype) e ele seria perfeito aqui: uma imagem, um JSON, recorte por CSS. Só que
// ele está indexado pela faixa ANTIGA de looktypes — os do espelho (Charizard = 67). Os sprites
// nossos remapearam a espécie para `60000 + pokeId` (`dados/creatures-sprites-lab.json`, 943
// espécies), e o atlas não foi regerado desde então: hoje ele não tem UMA chave acima de 60000.
// O próprio jogo já convive com isso caindo no atlas de outfits em tempo de execução.
//
// Regerar o atlas resolveria — e é o que vale fazer um dia, porque ajuda o jogo também —, mas
// ele mora em `public/data/`, que é espelho local fora do git: a correção não viajaria com o
// código, e o Tracker nasceria dependendo de alguém rodar um script na VPS.
//
// ### O que este arquivo faz, então
//
// Lê o MESMO pack de sprites que o cliente do jogo usa e devolve, por looktype, o retângulo do
// quadro virado para a frente: `{ img, x, y, w, h, pw, ph }`. Com isso o navegador desenha o
// retrato com `background-position`, sem canvas, sem baixar o índice de 1,8 MB e sem uma linha
// de código de sprite na página.
//
// O quadro escolhido é o mesmo do gerador do atlas (`tools/build-marker-atlas.py`): frame 1,
// direção 3 (sul). Assim o Tracker mostra o bicho de frente, como o mapa-múndi mostra.
//
// ### O custo
//
// O índice do pack é lido UMA vez por processo e imediatamente reduzido a um `Map` de
// `looktype → caminho do manifesto` (uns 5.200 pares de string curta). O objeto de 1,8 MB é
// solto logo em seguida — guardá-lo seria carregar, em cada um dos seis gateways, um catálogo
// que ninguém mais consulta.
//
// Cada manifesto é lido no primeiro pedido daquela espécie e o RECORTE fica em memória. São
// ~1.250 espécies no jogo inteiro, a ~120 bytes cada: o teto natural é uma ninharia, e por isso
// não há expiração — o pack só muda com um deploy, que reinicia o processo.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from './config.mjs';

/** Onde o cliente enxerga o pack. O manifesto guarda `/assets-packs/…`; o gateway serve em `/assets/asset-packs/…`. */
const PREFIXO_PACK = '/assets-packs/';
const PREFIXO_WEB = '/assets/asset-packs/';

/** Quantos looktypes um pedido pode trazer. Uma tela cheia do meta mostra ~60. */
export const MAX_POR_PEDIDO = 80;

let indicePromessa = null;
/** looktype → caminho do manifesto, relativo ao pack. */
let indice = null;
/** looktype → recorte (ou `null`, quando já se sabe que aquela espécie não tem retrato). */
const recortes = new Map();
/** Leituras de manifesto em voo, para dois pedidos da mesma espécie não lerem o disco duas vezes. */
const emVoo = new Map();

function carregarIndice() {
  return (indicePromessa ??= (async () => {
    const arq = join(config.assetsDir, 'asset-packs', 'outfits-index.json');
    const bruto = JSON.parse(await readFile(arq, 'utf8'));
    const mapa = new Map();
    for (const [id, o] of Object.entries(bruto?.outfits ?? {})) {
      if (o?.manifest) mapa.set(Number(id), String(o.manifest));
    }
    indice = mapa;
    return mapa;
  })().catch((err) => {
    // Sem pack não há retrato, e a página tem de continuar de pé (ela cai na pokébola). A
    // promessa é zerada para uma segunda visita tentar de novo — o caso típico é o espelho
    // ainda sendo baixado no primeiro boot de uma máquina nova.
    console.warn('[tracker] índice de sprites indisponível:', err.message);
    indicePromessa = null;
    return new Map();
  }));
}

/** O caminho de um arquivo do pack, a partir do que o manifesto escreve. */
const noDisco = (caminho) =>
  join(config.assetsDir, 'asset-packs', String(caminho).replace(PREFIXO_PACK, ''));

/**
 * O recorte de um looktype. `null` quando a espécie não está no pack.
 *
 * O quadro procurado é `1_*_*_3` — frame 1, direção 3 (sul). O `_template` é pulado: ele é a
 * máscara de cor das roupas do treinador, não um quadro desenhável.
 */
async function recorteDe(looktype) {
  if (recortes.has(looktype)) return recortes.get(looktype);
  if (emVoo.has(looktype)) return emVoo.get(looktype);

  const promessa = (async () => {
    const idx = indice ?? await carregarIndice();
    const manifestoRel = idx.get(looktype);
    // NÃO entra no cache: o índice já é um `Map` em memória, então responder "não existe" custa
    // uma busca por chave. Guardar essa resposta era um vazamento de memória com endereço
    // público — o parâmetro `lt` aceita qualquer inteiro, e cada valor inventado virava uma
    // entrada permanente no `Map`. Oitenta por requisição, sem teto, até o processo cair.
    if (!manifestoRel) return { naoCachear: true, recorte: null };
    const m = JSON.parse(await readFile(noDisco(manifestoRel), 'utf8'));

    let alvo = null;
    for (const [chave, asset] of Object.entries(m?.assets ?? {})) {
      const nome = chave.split('/').pop().replace(/\.png$/i, '');
      if (nome.endsWith('_template')) continue;
      const partes = nome.split('_');
      if (partes.length < 4 || partes[0] !== '1' || partes[3] !== '3') continue;
      alvo = asset;
      break;
    }
    const quadro = alvo?.frames?.[0];
    if (!quadro) return null;

    // A PÁGINA do quadro: um atlas por outfit, com uma ou mais folhas. `quadro.page` é o índice.
    const cat = Object.values(m?.categories ?? {})[0];
    const pagina = (cat?.pages ?? []).find((p) => Number(p.index) === Number(quadro.page ?? 0));
    if (!pagina?.image) return null;

    return {
      img: String(pagina.image).replace(PREFIXO_PACK, PREFIXO_WEB),
      x: Number(quadro.x) || 0,
      y: Number(quadro.y) || 0,
      w: Number(quadro.w) || 64,
      h: Number(quadro.h) || 64,
      pw: Number(pagina.width) || 0,
      ph: Number(pagina.height) || 0,
    };
  })()
    .catch((err) => {
      console.warn(`[tracker] sprite ${looktype} falhou:`, err.message);
      return null;
    })
    .then((r) => {
      // O resultado entra no cache inclusive quando é `null` — sem isso, toda visita a uma tela
      // com uma espécie cujo manifesto existe mas não tem o quadro voltaria ao disco. A exceção
      // é o looktype que NÃO ESTÁ no índice: ver a nota lá em cima.
      const recorte = r?.naoCachear ? null : r;
      if (!r?.naoCachear) recortes.set(looktype, recorte);
      emVoo.delete(looktype);
      return recorte;
    });

  emVoo.set(looktype, promessa);
  return promessa;
}

/**
 * Os recortes de vários looktypes de uma vez.
 *
 * @param lista  looktypes (o que não for inteiro positivo é descartado em silêncio)
 * @returns `{ [looktype]: recorte }` — só os que têm retrato.
 */
export async function retratosDe(lista) {
  const ids = [...new Set((lista ?? [])
    .map((x) => Math.trunc(Number(x)))
    .filter((x) => Number.isFinite(x) && x > 0))]
    .slice(0, MAX_POR_PEDIDO);
  if (!ids.length) return {};
  const achados = await Promise.all(ids.map(recorteDe));
  const saida = {};
  ids.forEach((id, i) => { if (achados[i]) saida[id] = achados[i]; });
  return saida;
}
