import { NextRequest, NextResponse } from "next/server";
import { alterarBase, lerBase } from "@/lib/crm/base";
import { type Segmento, SEGMENTOS, listarSegmento, resumir, salvarCliente } from "@/lib/crm/clientes";
import { normalizarTelefone } from "@/lib/crm/telefone";

export const dynamic = "force-dynamic";

/** Lista de clientes: por segmento, loja e busca. Devolve no máximo 500. */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const seg = (q.get("segmento") ?? "todos") as Segmento;
  if (!SEGMENTOS.some((s) => s.id === seg)) return NextResponse.json({ erro: "Segmento inválido" }, { status: 400 });
  const loja = q.get("loja") || undefined;
  const busca = (q.get("busca") ?? "").trim().toLowerCase();
  const base = await lerBase();
  let lista = listarSegmento(base, seg, loja);
  if (busca) {
    const dig = busca.replace(/\D/g, "");
    lista = lista.filter(
      (c) => c.nome.toLowerCase().includes(busca) || (dig.length >= 4 && (c.telefone?.includes(dig) || c.cpf?.includes(dig)))
    );
  }
  return NextResponse.json({ total: lista.length, clientes: lista.slice(0, 500) });
}

/** Cria ou edita uma cliente pelo painel. */
export async function POST(req: NextRequest) {
  const d = (await req.json().catch(() => ({}))) as {
    id?: string;
    nome?: string;
    telefone?: string;
    cpf?: string;
    email?: string;
    nascimento?: string;
    lojaOrigem?: string;
    optIn?: boolean;
    obs?: string;
  };
  if (d.telefone && !normalizarTelefone(d.telefone)) return NextResponse.json({ erro: "Telefone inválido. Use DDD + número." }, { status: 400 });
  try {
    const cliente = await alterarBase((b) => {
      if (d.id) {
        const c = b.clientes.find((x) => x.id === d.id);
        if (!c) throw new Error("Cliente não encontrada.");
        if (d.nome !== undefined) c.nome = d.nome.trim() || c.nome;
        if (d.telefone !== undefined) {
          const tel = normalizarTelefone(d.telefone);
          if (tel && b.clientes.some((x) => x.id !== c.id && x.telefone === tel)) throw new Error("Já existe outra cliente com esse telefone.");
          c.telefone = tel;
        }
        if (d.cpf !== undefined) c.cpf = d.cpf.replace(/\D/g, "") || undefined;
        if (d.email !== undefined) c.email = d.email.trim() || undefined;
        if (d.nascimento !== undefined) c.nascimento = d.nascimento || undefined;
        if (d.lojaOrigem !== undefined) c.lojaOrigem = d.lojaOrigem || undefined;
        if (d.optIn !== undefined) c.optIn = d.optIn;
        if (d.obs !== undefined) c.obs = d.obs.trim() || undefined;
        c.atualizadoEm = new Date().toISOString();
        return resumir(b, c);
      }
      const { cliente } = salvarCliente(b, { nome: d.nome ?? "", telefone: d.telefone, cpf: d.cpf, email: d.email, nascimento: d.nascimento, lojaOrigem: d.lojaOrigem, optIn: d.optIn ?? false, obs: d.obs }, "painel");
      return resumir(b, cliente);
    });
    return NextResponse.json({ cliente });
  } catch (e) {
    return NextResponse.json({ erro: e instanceof Error ? e.message : "Erro" }, { status: 400 });
  }
}
