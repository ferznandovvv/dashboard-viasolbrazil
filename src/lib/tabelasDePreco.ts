/**
 * Tabela de preço que vale em cada loja física. Arquivo sem dependências de
 * servidor: a tela de produtos usa para explicar as colunas e a API, para
 * mostrar ao usuário de loja só o preço da loja dele.
 */
export const TABELA_DA_LOJA: Record<string, string> = {
  "SP — Itaim": "Site",
  "Belo Horizonte": "Site",
  "Praia Grande": "Site",
  "Rio de Janeiro": "Site",
  Centro: "Franca",
  "Loja de Fábrica": "Franca",
  "Ribeirão Preto": "RP",
  Fiusa: "RP",
};

/** Tabelas de preço que valem nestas lojas. */
export const tabelasDasLojas = (lojas: string[]) =>
  Array.from(new Set(lojas.map((l) => TABELA_DA_LOJA[l]).filter(Boolean)));

/** Lojas onde vale esta tabela. */
export const lojasDaTabela = (tabela: string) =>
  Object.keys(TABELA_DA_LOJA).filter((l) => TABELA_DA_LOJA[l] === tabela);
