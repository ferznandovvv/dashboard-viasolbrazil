import { NextRequest, NextResponse } from "next/server";
import { exigir } from "@/lib/financeiro/auth";
import { alterarBase, novoId } from "@/lib/financeiro/base";
import { validarRateio } from "@/lib/financeiro/rateio";
import { type Conta, type ParteRateio, somarMeses } from "@/lib/financeiro/tipos";
import { todaySpKey } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Contas a pagar. Filtros: ?mes=YYYY-MM (vencimento), ?empresa=id,
 * ?status=abertas|pagas|vencidas|todas, ?q=texto. O resumo de cima ignora os
 * filtros de mês e status: vencidas são vencidas em qualquer mês.
 */
export async function GET(req: NextRequest) {
  const atual = await exigir(req);
  if (atual instanceof NextResponse) return atual;
  const { base } = atual;
  const sp = req.nextUrl.searchParams;
  const mes = sp.get("mes") ?? "";
  const empresa = sp.get("empresa") ?? "";
  const status = sp.get("status") ?? "abertas";
  const q = (sp.get("q") ?? "").trim().toLowerCase();
  const hoje = todaySpKey();
  const daqui7 = somarDias(hoje, 7);

  const daEmpresa = base.contas.filter((c) => !empresa || c.empresaId === empresa);
  const abertas = daEmpresa.filter((c) => c.status === "aberta");
  const soma = (cs: Conta[]) => cs.reduce((s, c) => s + c.valor, 0);
  const vencidas = abertas.filter((c) => c.vencimento < hoje);
  const venceHoje = abertas.filter((c) => c.vencimento === hoje);
  const proximas = abertas.filter((c) => c.vencimento > hoje && c.vencimento <= daqui7);
  const pagasMes = daEmpresa.filter((c) => c.status === "paga" && (c.pagoEm ?? "").startsWith(hoje.slice(0, 7)));

  const busca = (c: Conta) => {
    if (!q) return true;
    const cat = base.categorias.find((x) => x.id === c.categoriaId)?.nome ?? "";
    return `${c.descricao} ${c.fornecedor} ${c.observacao} ${cat}`.toLowerCase().includes(q);
  };
  const lista = daEmpresa
    .filter((c) =>
      status === "vencidas"
        ? c.status === "aberta" && c.vencimento < hoje
        : status === "abertas"
          ? c.status === "aberta"
          : status === "pagas"
            ? c.status === "paga"
            : true
    )
    // Vencidas aparecem sempre, mesmo de outro mês: não podem sumir da vista
    .filter((c) => !mes || c.vencimento.startsWith(mes) || (status !== "pagas" && c.status === "aberta" && c.vencimento < hoje))
    .filter(busca)
    .sort((a, b) => a.vencimento.localeCompare(b.vencimento) || a.descricao.localeCompare(b.descricao));

  // Quanto cada empresa tem para pagar no mês (vale o filtro de mês, não o de empresa)
  const mesRef = mes || hoje.slice(0, 7);
  const porEmpresa = base.empresas
    .filter((e) => e.ativa || base.contas.some((c) => c.empresaId === e.id && c.status === "aberta"))
    .map((e) => {
      const dela = base.contas.filter((c) => c.empresaId === e.id);
      const abertasMes = dela.filter((c) => c.status === "aberta" && c.vencimento.startsWith(mesRef));
      const vencidasDela = dela.filter((c) => c.status === "aberta" && c.vencimento < hoje);
      const pagasNoMes = dela.filter((c) => c.status === "paga" && (c.pagoEm ?? "").startsWith(mesRef));
      return {
        empresaId: e.id,
        nome: e.nome,
        aPagar: soma(abertasMes),
        qtd: abertasMes.length,
        vencido: soma(vencidasDela),
        pago: pagasNoMes.reduce((s, c) => s + (c.valorPago ?? c.valor), 0),
      };
    })
    .filter((x) => x.aPagar || x.vencido || x.pago);

  const nomes = new Map(base.usuarios.map((u) => [u.id, u.nome]));
  // Para o painel "pagar hoje", que mostra todas as empresas
  const todasAbertas = base.contas.filter((c) => c.status === "aberta");
  const proximaData = todasAbertas
    .map((c) => c.vencimento)
    .filter((d) => d > hoje)
    .sort()[0];
  return NextResponse.json({
    hoje,
    resumo: {
      vencidas: { qtd: vencidas.length, total: soma(vencidas) },
      hoje: { qtd: venceHoje.length, total: soma(venceHoje) },
      proximos7: { qtd: proximas.length, total: soma(proximas) },
      pagasMes: { qtd: pagasMes.length, total: pagasMes.reduce((s, c) => s + (c.valorPago ?? c.valor), 0) },
    },
    contas: lista.map((c) => ({
      ...c,
      criadoPorNome: nomes.get(c.criadoPor) ?? "",
      pagoPorNome: c.pagoPor ? nomes.get(c.pagoPor) ?? "" : "",
    })),
    totalLista: soma(lista),
    porEmpresa,
    // Painel do dia: em aberto vencendo até daqui a 7 dias (inclui as já
    // vencidas). Vale qualquer filtro — mostra todas as empresas
    proximos: todasAbertas
      .filter((c) => c.vencimento <= daqui7)
      .sort((a, b) => a.vencimento.localeCompare(b.vencimento) || b.valor - a.valor)
      .map((c) => ({ ...c, criadoPorNome: nomes.get(c.criadoPor) ?? "", pagoPorNome: "" })),
    amanha: somarDias(hoje, 1),
    proxima: proximaData ? { vencimento: proximaData, total: soma(todasAbertas.filter((c) => c.vencimento === proximaData)) } : null,
  });
}

interface NovaConta {
  descricao: string;
  fornecedor?: string;
  empresaId: string;
  categoriaId: string;
  valor: number;
  vencimento: string;
  competencia?: string;
  forma?: string;
  observacao?: string;
  /** Quantas vezes lançar, mês a mês */
  vezes?: number;
  /** parcelado = "1/3, 2/3…"; mensal = conta fixa que se repete */
  repetir?: "parcelado" | "mensal";
  /** Divisão entre empresas (valores de cada parcela) */
  rateio?: ParteRateio[];
  /**
   * Pagamento já feito (comprovante de PIX, compra no cartão): entra direto
   * como paga. Parcelado, cada parcela fica paga na data dela.
   */
  jaPago?: boolean;
  chavePix?: string;
  codigoBoleto?: string;
}

/** Lança uma conta — ou várias, quando parcelada ou mensal. */
export async function POST(req: NextRequest) {
  const atual = await exigir(req);
  if (atual instanceof NextResponse) return atual;
  const { usuario } = atual;
  const n = (await req.json().catch(() => ({}))) as NovaConta;
  const erro = validar(n);
  if (erro) return NextResponse.json({ erro }, { status: 400 });

  const vezes = Math.min(Math.max(Math.round(n.vezes ?? 1), 1), 60);
  const lote = vezes > 1 ? novoId() : undefined;
  const competencia = n.competencia && /^\d{4}-\d{2}$/.test(n.competencia) ? n.competencia : n.vencimento.slice(0, 7);
  const agora = new Date().toISOString();
  const valor = Math.round(Number(n.valor) * 100) / 100;

  try {
    const criadas = await alterarBase((base) => {
      const r = validarRateio(n.rateio, valor, base, n.empresaId);
      if (r.erro) throw new Error(r.erro);
      if (!base.empresas.some((e) => e.id === n.empresaId)) throw new Error("Empresa não encontrada.");
      if (!base.categorias.some((c) => c.id === n.categoriaId)) throw new Error("Categoria não encontrada.");
      const novas: Conta[] = Array.from({ length: vezes }, (_, i) => {
        const vencimento = somarMeses(n.vencimento, i);
        return {
          id: novoId(),
          descricao: n.descricao.trim(),
          fornecedor: (n.fornecedor ?? "").trim(),
          empresaId: n.empresaId,
          categoriaId: n.categoriaId,
          valor,
          vencimento,
          competencia: somarMeses(competencia, i),
          forma: n.forma ?? "",
          parcela: vezes > 1 && n.repetir !== "mensal" ? `${i + 1}/${vezes}` : undefined,
          lote,
          observacao: (n.observacao ?? "").trim(),
          rateio: r.rateio?.map((p) => ({ ...p })),
          chavePix: (n.chavePix ?? "").trim().slice(0, 140) || undefined,
          // O código do boleto é de um mês só: nas repetições, só na primeira
          codigoBoleto: i === 0 ? (n.codigoBoleto ?? "").trim().slice(0, 80) || undefined : undefined,
          criadoPor: usuario.id,
          criadoEm: agora,
          ...(n.jaPago
            ? { status: "paga" as const, pagoEm: vencimento, valorPago: valor, pagoPor: usuario.id }
            : { status: "aberta" as const }),
        };
      });
      base.contas.push(...novas);
      return novas.map((c) => c.id);
    });
    return NextResponse.json({ ok: true, criadas: criadas.length, ids: criadas });
  } catch (e) {
    return NextResponse.json({ erro: e instanceof Error ? e.message : "Erro" }, { status: 400 });
  }
}

function validar(n: Partial<NovaConta>): string | null {
  if (!n.descricao?.trim()) return "Escreva uma descrição.";
  if (!n.empresaId) return "Escolha a empresa.";
  if (!n.categoriaId) return "Escolha a categoria.";
  if (!(Number(n.valor) > 0)) return "Valor precisa ser maior que zero.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(n.vencimento ?? "")) return "Escolha o vencimento.";
  return null;
}

function somarDias(dia: string, n: number): string {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
