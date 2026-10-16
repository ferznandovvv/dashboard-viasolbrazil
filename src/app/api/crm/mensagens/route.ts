import { NextRequest, NextResponse } from "next/server";
import { alterarBase, lerBase } from "@/lib/crm/base";
import { type Segmento, SEGMENTOS, listarSegmento } from "@/lib/crm/clientes";
import { rodarAutomacoes } from "@/lib/crm/automacoes";
import { processarFila } from "@/lib/crm/fila";
import { enfileirar, renderizar } from "@/lib/crm/mensagens";
import { adaptadorDe } from "@/lib/crm/envio/adaptador";
import type { StatusMensagem } from "@/lib/crm/tipos";
import { normalizarTelefone } from "@/lib/crm/telefone";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Mensagens (fila e histórico) e respostas recebidas. */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const status = q.get("status") as StatusMensagem | "todas" | null;
  const base = await lerBase();
  const nomes = new Map(base.clientes.map((c) => [c.id, c.nome]));
  let lista = base.mensagens;
  if (status && status !== "todas") lista = lista.filter((m) => m.status === status);
  const mensagens = lista
    .sort((a, b) => b.criadoEm.localeCompare(a.criadoEm))
    .slice(0, 300)
    .map((m) => ({ ...m, cliente: nomes.get(m.clienteId) ?? "?" }));
  const recebidas = base.recebidas
    .sort((a, b) => b.recebidoEm.localeCompare(a.recebidoEm))
    .slice(0, 100)
    .map((r) => ({ ...r, cliente: r.clienteId ? nomes.get(r.clienteId) : undefined }));
  const porStatus: Record<string, number> = {};
  for (const m of base.mensagens) porStatus[m.status] = (porStatus[m.status] ?? 0) + 1;
  return NextResponse.json({ mensagens, recebidas, porStatus });
}

type Pedido =
  | { acao: "processar" }
  | { acao: "automacoes" }
  | { acao: "cancelar"; id: string }
  | { acao: "cancelar-fila" }
  | { acao: "teste"; telefone: string; loja: string; texto: string }
  | { acao: "avulsa"; segmento: Segmento; loja?: string; texto: string; limite?: number };

export async function POST(req: NextRequest) {
  const p = (await req.json().catch(() => ({}))) as Pedido;
  try {
    switch (p.acao) {
      case "processar":
        return NextResponse.json(await processarFila(true));
      case "automacoes": {
        const r = await rodarAutomacoes(true);
        return NextResponse.json(r ?? { aviso: "já rodou hoje" });
      }
      case "cancelar":
        await alterarBase((b) => {
          const m = b.mensagens.find((x) => x.id === p.id);
          if (m && m.status === "fila") m.status = "cancelada";
        });
        return NextResponse.json({ ok: true });
      case "cancelar-fila": {
        const n = await alterarBase((b) => {
          let n = 0;
          for (const m of b.mensagens) if (m.status === "fila") (m.status = "cancelada"), n++;
          return n;
        });
        return NextResponse.json({ canceladas: n });
      }
      case "teste": {
        // Envio direto, fora da fila: para conferir que o número está respondendo
        const base = await lerBase();
        const adaptador = adaptadorDe(base.config);
        if (!adaptador) return NextResponse.json({ erro: "Configure o provedor primeiro." }, { status: 400 });
        const n = base.config.numeros.find((x) => x.loja === p.loja && x.sessao);
        if (!n) return NextResponse.json({ erro: "Essa loja não tem sessão configurada." }, { status: 400 });
        const tel = normalizarTelefone(p.telefone);
        if (!tel) return NextResponse.json({ erro: "Telefone inválido." }, { status: 400 });
        const r = await adaptador.enviarTexto(n.sessao, tel, p.texto?.trim() || "Teste do CRM Via Sol.");
        return NextResponse.json(r, { status: r.ok ? 200 : 502 });
      }
      case "avulsa": {
        if (!SEGMENTOS.some((s) => s.id === p.segmento)) return NextResponse.json({ erro: "Segmento inválido." }, { status: 400 });
        if (!p.texto?.trim()) return NextResponse.json({ erro: "Escreva o texto." }, { status: 400 });
        const r = await alterarBase((b) => {
          const alvo = listarSegmento(b, p.segmento, p.loja).slice(0, p.limite ?? 500);
          const lote = `avulsa-${Date.now()}`;
          const res = { enfileiradas: 0, puladas: {} as Record<string, number> };
          for (const c of alvo) {
            const loja = c.ultimaLoja ?? c.lojaOrigem;
            const texto = renderizar(p.texto, c, loja ?? "");
            const e = enfileirar(b, { cliente: c, campanha: "avulsa", loja, texto, chave: `${lote}-${c.id}` });
            if (e.mensagem) res.enfileiradas++;
            else res.puladas[e.motivo ?? "?"] = (res.puladas[e.motivo ?? "?"] ?? 0) + 1;
          }
          return res;
        });
        return NextResponse.json(r);
      }
      default:
        return NextResponse.json({ erro: "Ação desconhecida." }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ erro: e instanceof Error ? e.message : "Erro" }, { status: 400 });
  }
}
