import { NextRequest, NextResponse } from "next/server";
import { exigir } from "@/lib/financeiro/auth";
import type { Sugestao } from "@/lib/financeiro/tipos";

export const dynamic = "force-dynamic";

/**
 * O que já foi lançado, para o formulário sugerir: o último lançamento de cada
 * combinação descrição + fornecedor + empresa ("Claro" da loja do Rio e
 * "Claro" do Litoral são sugestões diferentes), do mais recente ao mais antigo.
 */
export async function GET(req: NextRequest) {
  const atual = await exigir(req);
  if (atual instanceof NextResponse) return atual;
  const recentes = [...atual.base.contas].sort((a, b) => b.vencimento.localeCompare(a.vencimento));
  const m = new Map<string, Sugestao>();
  for (const c of recentes) {
    const k = `${c.descricao.trim().toLowerCase()}|${c.fornecedor.trim().toLowerCase()}|${c.empresaId}`;
    const ja = m.get(k);
    if (ja) {
      ja.vezes += 1;
      // A chave PIX pode estar só num lançamento mais antigo
      if (!ja.chavePix && c.chavePix) ja.chavePix = c.chavePix;
      continue;
    }
    m.set(k, {
      fornecedor: c.fornecedor,
      descricao: c.descricao,
      empresaId: c.empresaId,
      categoriaId: c.categoriaId,
      forma: c.forma,
      valor: c.valor,
      rateio: c.rateio,
      chavePix: c.chavePix,
      em: c.vencimento,
      vezes: 1,
    });
  }
  return NextResponse.json({ lancamentos: Array.from(m.values()).slice(0, 500) });
}
