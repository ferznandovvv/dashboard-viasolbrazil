import { calcularCategorias, gravarCategorias } from "./categorias";
import { fetchEstoque } from "./connectors/estoque";
import { fetchTotvsSales, fetchVendasPorProduto } from "./connectors/totvs";
import { todaySpKey } from "./types";

/**
 * Deixa o cache pronto antes de alguém abrir a tela: as buscas caras da TOTVS
 * (saldo de estoque e venda por produto) rodam de madrugada, e durante o dia
 * as telas só leem o que já está guardado.
 */
export async function aquecer() {
  const hoje = todaySpKey();
  const inicioMes = `${hoje.slice(0, 7)}-01`;

  const [vendasMes, produtos, estoque] = await Promise.all([
    fetchTotvsSales(inicioMes, hoje),
    fetchVendasPorProduto(inicioMes, hoje, 40000),
    fetchEstoque(true), // varre de novo para a foto ficar fresca
  ]);

  // A lista de categorias sai do mesmo estoque, e fica pronta para a tela
  const categorias = calcularCategorias(estoque.itens);
  if (!estoque.incompleto && estoque.itens.length > 0) await gravarCategorias(categorias);

  return {
    periodo: { de: inicioMes, ate: hoje },
    vendas: { notas: vendasMes.orders.length, erro: vendasMes.error },
    produtos: { linhas: produtos.itens.length, incompleto: produtos.incompleto, erro: produtos.erro },
    estoque: { itens: estoque.itens.length, incompleto: estoque.incompleto, erro: estoque.erro },
    categorias: categorias.length,
  };
}

/**
 * Segunda passada: só continua a foto do estoque, caso a primeira não tenha
 * conseguido varrer o catálogo inteiro dentro do tempo.
 */
export async function continuarEstoque() {
  const estoque = await fetchEstoque(true);
  const categorias = calcularCategorias(estoque.itens);
  if (!estoque.incompleto && estoque.itens.length > 0) await gravarCategorias(categorias);
  return {
    estoque: { itens: estoque.itens.length, incompleto: estoque.incompleto, erro: estoque.erro },
    categorias: categorias.length,
  };
}
