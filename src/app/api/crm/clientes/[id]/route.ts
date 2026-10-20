import { NextRequest, NextResponse } from "next/server";
import { alterarBase, hojeSp, lerBase, novoId, somarDias } from "@/lib/crm/base";
import { creditosAbertos, gerarCodigo, resgatar, saldoDe } from "@/lib/crm/cashback";
import { resumir } from "@/lib/crm/clientes";
import { enfileirar } from "@/lib/crm/mensagens";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Ficha da cliente: dados, vendas, extrato de cashback e mensagens. */
export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const base = await lerBase();
  const c = base.clientes.find((x) => x.id === id);
  if (!c) return NextResponse.json({ erro: "Cliente não encontrada" }, { status: 404 });
  const vendas = base.vendas.filter((v) => v.clienteId === id).sort((a, b) => b.data.localeCompare(a.data));
  const extrato = base.cashback.filter((m) => m.clienteId === id).sort((a, b) => b.criadoEm.localeCompare(a.criadoEm));
  const mensagens = base.mensagens.filter((m) => m.clienteId === id).sort((a, b) => b.criadoEm.localeCompare(a.criadoEm)).slice(0, 50);
  const recebidas = base.recebidas.filter((r) => r.clienteId === id).sort((a, b) => b.recebidoEm.localeCompare(a.recebidoEm)).slice(0, 50);
  const codigos = base.codigos.filter((x) => x.clienteId === id && !x.usadoEm && x.validade >= hojeSp());
  return NextResponse.json({ cliente: resumir(base, c), vendas, extrato, creditos: creditosAbertos(base, id), mensagens, recebidas, codigos });
}

type Acao =
  | { acao: "optout"; valor: boolean }
  | { acao: "resgate"; valor: number; valorCompra?: number; loja: string; codigo?: string }
  | { acao: "ajuste"; valor: number; obs: string }
  | { acao: "codigo"; valor: number }
  | { acao: "mensagem"; texto: string; loja?: string }
  | { acao: "excluir" };

/** Ações na ficha: opt-out, resgate, ajuste de cashback, código, mensagem avulsa, excluir. */
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const a = (await req.json().catch(() => ({}))) as Acao;
  try {
    const r = await alterarBase((b) => {
      const c = b.clientes.find((x) => x.id === id);
      if (!c) throw new Error("Cliente não encontrada.");
      switch (a.acao) {
        case "optout":
          c.optOut = a.valor;
          c.optOutEm = a.valor ? new Date().toISOString() : undefined;
          // "Voltar a receber" também tira o telefone da lista de quem pediu SAIR
          if (!a.valor && c.telefone && b.naoContatar) delete b.naoContatar[c.telefone];
          if (a.valor) for (const m of b.mensagens) if (m.clienteId === id && m.status === "fila") m.status = "cancelada";
          return { ok: true };
        case "resgate":
          return { movimento: resgatar(b, { clienteId: id, valor: a.valor, valorCompra: a.valorCompra, loja: a.loja, codigo: a.codigo, por: "painel" }) };
        case "ajuste": {
          if (!a.valor) throw new Error("Informe o valor.");
          if (a.valor < 0 && -a.valor > saldoDe(b, id) + 0.009) throw new Error("Ajuste maior que o saldo.");
          b.cashback.push({
            id: novoId(),
            clienteId: id,
            tipo: "ajuste",
            valor: Math.round(a.valor * 100) / 100,
            validade: a.valor > 0 ? somarDias(hojeSp(), b.config.cashbackValidadeDias) : undefined,
            obs: a.obs,
            criadoEm: new Date().toISOString(),
            por: "painel",
          });
          return { ok: true };
        }
        case "codigo": {
          const saldo = saldoDe(b, id);
          if (a.valor <= 0 || a.valor > saldo + 0.009) throw new Error(`Saldo disponível é R$ ${saldo.toFixed(2)}.`);
          const codigo = { codigo: gerarCodigo(b), clienteId: id, valor: Math.round(a.valor * 100) / 100, criadoEm: new Date().toISOString(), validade: somarDias(hojeSp(), 7) };
          b.codigos.push(codigo);
          return { codigo };
        }
        case "mensagem": {
          const res = enfileirar(b, { cliente: c, campanha: "avulsa", loja: a.loja, texto: a.texto, forcar: true });
          if (!res.mensagem) throw new Error(res.motivo ?? "Não entrou na fila.");
          return { mensagem: res.mensagem };
        }
        case "excluir": {
          if (b.vendas.some((v) => v.clienteId === id) || b.cashback.some((m) => m.clienteId === id)) {
            throw new Error("Essa cliente tem vendas ou cashback. Marque como 'não receber' em vez de excluir.");
          }
          b.clientes = b.clientes.filter((x) => x.id !== id);
          b.mensagens = b.mensagens.filter((m) => m.clienteId !== id);
          return { ok: true };
        }
        default:
          throw new Error("Ação desconhecida.");
      }
    });
    return NextResponse.json(r);
  } catch (e) {
    return NextResponse.json({ erro: e instanceof Error ? e.message : "Erro" }, { status: 400 });
  }
}
