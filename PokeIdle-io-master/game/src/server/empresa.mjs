// Quem emite: os dados da empresa que operam o PokeIdle, num lugar só.
//
// ### Por que existe
//
// O CNPJ do prestador nasceu dentro de `admin.mjs`, para o export das notas fiscais. O documento
// de MED precisa do mesmo número (e de mais campos) no cabeçalho — copiar a constante seria criar
// duas verdades que um dia divergem. Então ela mora aqui e os dois importam.
//
// ### A regra: nada é inventado
//
// Só aparece o que está CONFIGURADO. Razão social, nome fantasia e endereço não existem em lugar
// nenhum do projeto, então dependem de `EMPRESA_*` no `.env`; sem elas o campo sai `null` e quem
// desenha escreve "Não disponível nos registros do sistema". Os três padrões abaixo não são
// palpite — cada um é o valor que o próprio projeto já publica:
//
//   · CNPJ   — o prestador das NFS-e das compras de diamante (export da aba Emissão de Notas);
//   · site   — o `canonical` da landing (`src/client/landing.html`);
//   · e-mail — o contato dos Termos de Uso (`src/client/terms.mjs`).
//
// Lido a cada chamada, e não no carregamento do módulo, pelo mesmo motivo de `origens-db.mjs`:
// este arquivo pode entrar na árvore de imports antes do `config.mjs` povoar o `process.env`.

/** O CNPJ do prestador das notas fiscais das compras de diamante (só dígitos). */
export const CNPJ_PRESTADOR = '68748721000118';

const SITE_PADRAO = 'https://pokeidle.io';
const EMAIL_PADRAO = 'support@pokeidle.io';

const valor = (nome) => {
  const v = String(process.env[nome] ?? '').trim();
  return v || null;
};

/** `68748721000118` → `68.748.721/0001-18`. Qualquer outra coisa volta como veio. */
export function cnpjFormatado(cnpj) {
  const d = String(cnpj ?? '').replace(/\D/g, '');
  if (d.length !== 14) return cnpj ? String(cnpj) : null;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

/**
 * Os dados da empresa para documentos oficiais. Campo sem fonte vem `null`.
 *
 * `faltando` lista o que não está configurado — o painel mostra isso ao administrador, para que
 * o documento não saia com lacuna sem ninguém perceber.
 */
export function dadosDaEmpresa() {
  const dados = {
    razaoSocial: valor('EMPRESA_RAZAO_SOCIAL'),
    nomeFantasia: valor('EMPRESA_NOME_FANTASIA'),
    cnpj: cnpjFormatado(valor('EMPRESA_CNPJ') ?? CNPJ_PRESTADOR),
    site: valor('EMPRESA_SITE') ?? SITE_PADRAO,
    email: valor('EMPRESA_EMAIL') ?? EMAIL_PADRAO,
    endereco: valor('EMPRESA_ENDERECO'),
  };
  const faltando = [
    ['razaoSocial', 'EMPRESA_RAZAO_SOCIAL'],
    ['nomeFantasia', 'EMPRESA_NOME_FANTASIA'],
    ['endereco', 'EMPRESA_ENDERECO'],
  ].filter(([campo]) => !dados[campo]).map(([, env]) => env);
  return { ...dados, faltando };
}
