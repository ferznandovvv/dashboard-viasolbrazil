import { NextRequest, NextResponse } from "next/server";
import { exigir } from "@/lib/financeiro/auth";
import type { Conta, Sugestao } from "@/lib/financeiro/tipos";

export const dynamic = "force-dynamic";

/**
 * O que já foi lançado, para o formulário completar sozinho: o último
 * lançamento de cada fornecedor e de cada descrição, do mais usado ao menos.
 */
export async function GET(req: NextRequest) {
  const atual = await exigir(req);
  if (atual instanceof NextResponse) return atual;
  const recentes = [...atual.base.contas].sort((a, b) => b.vencimento.localeCompare(a.vencimento));

  const juntar = (chave: (c: Conta) => string) => {
    const m = new Map<string, Sugestao>();
    for (const c of recentes) {
      const k = chave(c).trim().toLowerCase();
      if (!k) continue;
      const ja = m.get(k);
      if (ja) {
        ja.vezes += 1;
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
        em: c.vencimento,
        vezes: 1,
      });
    }
    return Array.from(m.values()).sort((a, b) => b.vezes - a.vezes).slice(0, 300);
  };

  return NextResponse.json({ porFornecedor: juntar((c) => c.fornecedor), porDescricao: juntar((c) => c.descricao) });
}
