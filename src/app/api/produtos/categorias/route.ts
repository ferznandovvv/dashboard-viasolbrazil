import { NextResponse } from "next/server";
import { fetchEstoque } from "@/lib/connectors/estoque";
import { categoriaDe } from "@/lib/produtos";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Lista as categorias existentes, com quantos produtos e peças cada uma tem.
 * É o primeiro passo da tela: nada pesado carrega antes de escolher uma.
 */
export async function GET() {
  const estoque = await fetchEstoque();

  const m = new Map<string, { nome: string; produtos: number; pecas: number }>();
  for (const item of estoque.itens) {
    const cat = categoriaDe(item.nome);
    if (!cat) continue;
    const e = m.get(cat) ?? { nome: cat, produtos: 0, pecas: 0 };
    e.produtos += 1;
    e.pecas += Object.values(item.porLoja).reduce((s, q) => s + q, 0);
    m.set(cat, e);
  }

  const categorias = Array.from(m.values())
    .filter((c) => c.produtos >= 3) // nomes soltos não viram categoria
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));

  return NextResponse.json({
    categorias,
    incompleto: Boolean(estoque.incompleto),
    erro: estoque.erro,
  });
}
