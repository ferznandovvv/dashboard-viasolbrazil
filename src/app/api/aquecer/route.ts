import { NextRequest, NextResponse } from "next/server";
import { fetchEstoque } from "@/lib/connectors/estoque";
import { fetchTotvsSales, fetchVendasPorProduto } from "@/lib/connectors/totvs";
import { todaySpKey } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Deixa o cache pronto antes de alguém abrir a tela: as buscas caras da TOTVS
 * (saldo de estoque e venda por produto) rodam aqui, de madrugada, e durante o
 * dia as telas só leem o que já está guardado.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const hoje = todaySpKey();
  const inicioMes = `${hoje.slice(0, 7)}-01`;

  const [vendasMes, produtos, estoque] = await Promise.all([
    fetchTotvsSales(inicioMes, hoje),
    fetchVendasPorProduto(inicioMes, hoje, 40000),
    fetchEstoque(),
  ]);

  return NextResponse.json({
    periodo: { de: inicioMes, ate: hoje },
    vendas: { notas: vendasMes.orders.length, erro: vendasMes.error },
    produtos: { linhas: produtos.itens.length, incompleto: produtos.incompleto, erro: produtos.erro },
    estoque: { itens: estoque.itens.length, incompleto: estoque.incompleto, erro: estoque.erro },
  });
}
