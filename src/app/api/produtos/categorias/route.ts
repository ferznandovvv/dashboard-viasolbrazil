import { NextResponse } from "next/server";
import { calcularCategorias, gravarCategorias, lerCategorias } from "@/lib/categorias";
import { fetchEstoque } from "@/lib/connectors/estoque";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Primeiro passo da tela de produtos: só a lista de categorias, lida de um
 * arquivo pronto. Se ele ainda não existir (antes do primeiro cron), calcula
 * uma vez e guarda.
 */
export async function GET() {
  const guardadas = await lerCategorias();
  if (guardadas) return NextResponse.json({ categorias: guardadas, pronta: true });

  const estoque = await fetchEstoque();
  const categorias = calcularCategorias(estoque.itens);
  if (!estoque.incompleto) await gravarCategorias(categorias);

  return NextResponse.json({
    categorias,
    pronta: false,
    incompleto: Boolean(estoque.incompleto),
    erro: estoque.erro,
  });
}
