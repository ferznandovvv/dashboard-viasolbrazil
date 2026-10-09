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

  // Mês passado também, para os "mais vendidos" abrirem na hora; depois de
  // guardado, cada dia não é buscado de novo
  const [y, m] = hoje.split("-").map(Number);
  const ini = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10);
  const fim = new Date(Date.UTC(y, m - 1, 0)).toISOString().slice(0, 10);
  await fetchVendasPorProduto(ini, fim, 10 * 60000);

  return {
    periodo: { de: inicioMes, ate: hoje },
    vendas: { notas: vendasMes.orders.length, erro: vendasMes.error },
    produtos: { linhas: produtos.itens.length, incompleto: produtos.incompleto, erro: produtos.erro },
    estoque: { itens: estoque.itens.length, incompleto: estoque.incompleto, erro: estoque.erro },
  };
}

/**
 * Segunda passada: só continua a foto do estoque, caso a primeira não tenha
 * conseguido varrer o catálogo inteiro dentro do tempo.
 */
export async function continuarEstoque() {
  const estoque = await fetchEstoque(true);
  return {
    estoque: { itens: estoque.itens.length, incompleto: estoque.incompleto, erro: estoque.erro },
  };
}
