import { NextRequest, NextResponse } from "next/server";
import { exigir } from "@/lib/financeiro/auth";
import { alterarBase } from "@/lib/financeiro/base";
import { validarRateio } from "@/lib/financeiro/rateio";
import type { ParteRateio } from "@/lib/financeiro/tipos";
import { todaySpKey } from "@/lib/types";

export const dynamic = "force-dynamic";

type Pedido =
  | { acao: "pagar"; pagoEm?: string; valorPago?: number }
  | { acao: "reabrir" }
  | { acao: "reagendar"; vencimento: string }
  | {
      acao: "editar";
      descricao: string;
      fornecedor?: string;
      empresaId: string;
      categoriaId: string;
      valor: number;
      vencimento: string;
      competencia: string;
      forma?: string;
      observacao?: string;
      rateio?: ParteRateio[];
      chavePix?: string;
      codigoBoleto?: string;
    };

/** Dar baixa, desfazer a baixa ou editar uma conta. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const atual = await exigir(req);
  if (atual instanceof NextResponse) return atual;
  const { usuario } = atual;
  const { id } = await params;
  const p = (await req.json().catch(() => ({}))) as Pedido;

  try {
    await alterarBase((base) => {
      const c = base.contas.find((x) => x.id === id);
      if (!c) throw new Error("Conta não encontrada.");
      const agora = new Date().toISOString();
      if (p.acao === "pagar") {
        c.status = "paga";
        c.pagoEm = /^\d{4}-\d{2}-\d{2}$/.test(p.pagoEm ?? "") ? p.pagoEm : todaySpKey();
        c.valorPago = Number(p.valorPago) > 0 ? Math.round(Number(p.valorPago) * 100) / 100 : c.valor;
        c.pagoPor = usuario.id;
      } else if (p.acao === "reabrir") {
        c.status = "aberta";
        c.pagoEm = undefined;
        c.valorPago = undefined;
        c.pagoPor = undefined;
      } else if (p.acao === "reagendar") {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(p.vencimento ?? "")) throw new Error("Escolha a nova data.");
        if (p.vencimento !== c.vencimento) {
          c.reagendamentos = [...(c.reagendamentos ?? []), { de: c.vencimento, para: p.vencimento, em: agora, por: usuario.id }];
          c.vencimento = p.vencimento;
        }
      } else if (p.acao === "editar") {
        if (!p.descricao?.trim() || !(Number(p.valor) > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(p.vencimento ?? ""))
          throw new Error("Confira descrição, valor e vencimento.");
        if (!base.empresas.some((e) => e.id === p.empresaId)) throw new Error("Empresa não encontrada.");
        if (!base.categorias.some((x) => x.id === p.categoriaId)) throw new Error("Categoria não encontrada.");
        const valor = Math.round(Number(p.valor) * 100) / 100;
        const r = validarRateio(p.rateio, valor, base, p.empresaId);
        if (r.erro) throw new Error(r.erro);
        Object.assign(c, {
          rateio: r.rateio,
          descricao: p.descricao.trim(),
          fornecedor: (p.fornecedor ?? "").trim(),
          empresaId: p.empresaId,
          categoriaId: p.categoriaId,
          valor,
          vencimento: p.vencimento,
          competencia: /^\d{4}-\d{2}$/.test(p.competencia ?? "") ? p.competencia : p.vencimento.slice(0, 7),
          forma: p.forma ?? "",
          observacao: (p.observacao ?? "").trim(),
          chavePix: (p.chavePix ?? "").trim().slice(0, 140) || undefined,
          codigoBoleto: (p.codigoBoleto ?? "").trim().slice(0, 80) || undefined,
        });
      } else throw new Error("Pedido desconhecido.");
      c.alteradoEm = agora;
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ erro: e instanceof Error ? e.message : "Erro" }, { status: 400 });
  }
}

/** Exclui — quem lançou ou o administrador. ?lote=1 exclui as parcelas em aberto juntas. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const atual = await exigir(req);
  if (atual instanceof NextResponse) return atual;
  const { usuario } = atual;
  const { id } = await params;
  const todoLote = req.nextUrl.searchParams.get("lote") === "1";

  try {
    const removidas = await alterarBase((base) => {
      const c = base.contas.find((x) => x.id === id);
      if (!c) throw new Error("Conta não encontrada.");
      if (usuario.papel !== "admin" && c.criadoPor !== usuario.id)
        throw new Error("Só quem lançou ou o administrador pode excluir.");
      const sai = (x: (typeof base.contas)[0]) =>
        x.id === id || (todoLote && !!c.lote && x.lote === c.lote && x.status === "aberta");
      const antes = base.contas.length;
      base.contas = base.contas.filter((x) => !sai(x));
      return antes - base.contas.length;
    });
    return NextResponse.json({ ok: true, removidas });
  } catch (e) {
    return NextResponse.json({ erro: e instanceof Error ? e.message : "Erro" }, { status: 400 });
  }
}
