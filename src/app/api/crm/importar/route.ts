import { NextRequest, NextResponse } from "next/server";
import { alterarBase } from "@/lib/crm/base";
import { type CampoCliente, type CampoVenda, adivinharCliente, adivinharVenda, importarClientes, importarVendas, lerCsv } from "@/lib/crm/importar";

export const dynamic = "force-dynamic";

type Pedido =
  | { tipo: "preview"; csv: string; alvo: "clientes" | "vendas" }
  | { tipo: "clientes"; csv: string; mapa: CampoCliente[]; lojaPadrao?: string; optIn?: boolean; temCabecalho?: boolean }
  | { tipo: "vendas"; csv: string; mapa: CampoVenda[]; lojaPadrao?: string; creditar?: boolean; temCabecalho?: boolean };

/** Importação por CSV em dois passos: preview (colunas + palpite) e importar com o mapa escolhido. */
export async function POST(req: NextRequest) {
  const p = (await req.json().catch(() => ({}))) as Pedido;
  if (!("csv" in p) || !p.csv?.trim()) return NextResponse.json({ erro: "Arquivo vazio." }, { status: 400 });
  if (p.csv.length > 30_000_000) return NextResponse.json({ erro: "Arquivo grande demais (máximo 30 MB)." }, { status: 400 });
  const linhas = lerCsv(p.csv);
  if (!linhas.length) return NextResponse.json({ erro: "Não achei linhas no arquivo." }, { status: 400 });

  if (p.tipo === "preview") {
    const cab = linhas[0];
    const palpite = cab.map((c) => (p.alvo === "clientes" ? adivinharCliente(c) : adivinharVenda(c)));
    return NextResponse.json({ colunas: cab, palpite, amostra: linhas.slice(1, 6), linhas: linhas.length - 1 });
  }

  const dados = p.temCabecalho === false ? linhas : linhas.slice(1);
  try {
    const r = await alterarBase((b) =>
      p.tipo === "clientes"
        ? importarClientes(b, dados, p.mapa, p.lojaPadrao, p.optIn ?? true)
        : importarVendas(b, dados, p.mapa, p.lojaPadrao, p.creditar ?? false)
    );
    return NextResponse.json(r);
  } catch (e) {
    return NextResponse.json({ erro: e instanceof Error ? e.message : "Erro" }, { status: 400 });
  }
}
