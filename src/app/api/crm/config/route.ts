import { NextRequest, NextResponse } from "next/server";
import { LOJAS } from "@/lib/connectors/totvs";
import { alterarBase, copiaDeSeguranca, lerBase } from "@/lib/crm/base";
import { CAMPANHAS, type ConfigCrm, type Modelo } from "@/lib/crm/tipos";
import { adaptadorDe } from "@/lib/crm/envio/adaptador";

export const dynamic = "force-dynamic";

const mascarar = (s?: string) => (s ? `${s.slice(0, 4)}…${s.slice(-3)}` : "");

/** Configuração e modelos de mensagem. Chaves vêm mascaradas. */
export async function GET(req: NextRequest) {
  const base = await lerBase();
  const origem = `${req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "")}://${req.headers.get("x-forwarded-host") ?? req.headers.get("host")}`;
  return NextResponse.json({
    config: { ...base.config, waakgApiKey: mascarar(base.config.waakgApiKey), cloudApiToken: mascarar(base.config.cloudApiToken) },
    temWaakgApiKey: Boolean(base.config.waakgApiKey),
    temCloudApiToken: Boolean(base.config.cloudApiToken),
    modelos: base.modelos,
    campanhas: CAMPANHAS,
    lojas: Object.values(LOJAS),
    webhookUrl: `${origem}/api/crm/webhook?t=${base.config.webhookSegredo}`,
  });
}

type Pedido =
  | { tipo: "config"; config: Partial<ConfigCrm> }
  | { tipo: "modelo"; modelo: Modelo }
  | { tipo: "testar-numero"; loja: string }
  | { tipo: "backup" };

const num = (v: unknown, padrao: number, min = 0, max = 1_000_000) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : padrao;
};

export async function POST(req: NextRequest) {
  const p = (await req.json().catch(() => ({}))) as Pedido;
  try {
    if (p.tipo === "testar-numero") {
      const base = await lerBase();
      const adaptador = adaptadorDe(base.config);
      if (!adaptador) return NextResponse.json({ erro: "Configure o provedor primeiro." }, { status: 400 });
      const n = base.config.numeros.find((x) => x.loja === p.loja);
      if (!n?.sessao) return NextResponse.json({ erro: "Essa loja não tem sessão configurada." }, { status: 400 });
      return NextResponse.json(await adaptador.situacao(n.sessao));
    }
    if (p.tipo === "backup") {
      const base = await lerBase();
      return NextResponse.json({ backup: await copiaDeSeguranca(base, true) });
    }
    await alterarBase((b) => {
      if (p.tipo === "config") {
        const c = p.config;
        const atual = b.config;
        const nova: ConfigCrm = {
          ...atual,
          cashbackPct: num(c.cashbackPct, atual.cashbackPct, 0, 100),
          cashbackValidadeDias: num(c.cashbackValidadeDias, atual.cashbackValidadeDias, 1, 3650),
          cashbackCompraMinima: num(c.cashbackCompraMinima, atual.cashbackCompraMinima),
          cashbackResgateMinimo: num(c.cashbackResgateMinimo, atual.cashbackResgateMinimo),
          cashbackSite: c.cashbackSite !== undefined ? Boolean(c.cashbackSite) : atual.cashbackSite,
          siteNasAutomacoes: c.siteNasAutomacoes !== undefined ? Boolean(c.siteNasAutomacoes) : atual.siteNasAutomacoes,
          cashbackMaxPctDaCompra: num(c.cashbackMaxPctDaCompra, atual.cashbackMaxPctDaCompra, 0, 100),
          cashbackMultiploCompra: num(c.cashbackMultiploCompra, atual.cashbackMultiploCompra, 0, 20),
          avisoVencimentoDias: num(c.avisoVencimentoDias, atual.avisoVencimentoDias, 1, 60),
          avisoVencimentoUrgenteDias: num(c.avisoVencimentoUrgenteDias, atual.avisoVencimentoUrgenteDias, 0, 30),
          aniversarioOferta: typeof c.aniversarioOferta === "string" ? c.aniversarioOferta.trim() : atual.aniversarioOferta,
          aniversarioQuando: c.aniversarioQuando === "dia" || c.aniversarioQuando === "inicio_mes" ? c.aniversarioQuando : atual.aniversarioQuando,
          reativacaoFaixas: Array.isArray(c.reativacaoFaixas)
            ? c.reativacaoFaixas
                .map((f) => ({ minimo: num(f?.minimo, 0), oferta: String(f?.oferta ?? "").trim() }))
                .filter((f) => f.oferta && f.minimo >= 0)
            : atual.reativacaoFaixas,
          posVendaDias: num(c.posVendaDias, atual.posVendaDias, 1, 60),
          reativacaoDias: num(c.reativacaoDias, atual.reativacaoDias, 7, 3650),
          reativacaoTicketMinimo: num(c.reativacaoTicketMinimo, atual.reativacaoTicketMinimo),
          reativacaoIntervaloDias: num(c.reativacaoIntervaloDias, atual.reativacaoIntervaloDias, 7, 3650),
          provedor: c.provedor && ["waakg", "cloudapi", "nenhum"].includes(c.provedor) ? c.provedor : atual.provedor,
          waakgUrl: c.waakgUrl !== undefined ? c.waakgUrl.trim().replace(/\/+$/, "") || undefined : atual.waakgUrl,
          // Chave só muda se vier uma nova (a tela mostra mascarada)
          waakgApiKey: c.waakgApiKey && !c.waakgApiKey.includes("…") ? c.waakgApiKey.trim() : atual.waakgApiKey,
          cloudApiToken: c.cloudApiToken && !c.cloudApiToken.includes("…") ? c.cloudApiToken.trim() : atual.cloudApiToken,
          numeros: Array.isArray(c.numeros)
            ? c.numeros
                .filter((n) => n && typeof n.loja === "string")
                .map((n) => ({ loja: n.loja, sessao: String(n.sessao ?? "").trim(), ativo: Boolean(n.ativo), tetoDia: n.tetoDia ? num(n.tetoDia, 20, 1, 500) : undefined, vendedora: String(n.vendedora ?? "").trim() || undefined }))
            : atual.numeros,
          envioInicio: num(c.envioInicio, atual.envioInicio, 0, 23),
          envioFim: num(c.envioFim, atual.envioFim, 1, 24),
          envioDias: Array.isArray(c.envioDias) ? c.envioDias.map(Number).filter((d) => d >= 0 && d <= 6) : atual.envioDias,
          tetoDiaPorNumero: num(c.tetoDiaPorNumero, atual.tetoDiaPorNumero, 1, 500),
          intervaloMinSeg: num(c.intervaloMinSeg, atual.intervaloMinSeg, 10, 3600),
          intervaloMaxSeg: num(c.intervaloMaxSeg, atual.intervaloMaxSeg, 10, 7200),
          maxSemResposta: num(c.maxSemResposta, atual.maxSemResposta, 1, 20),
          horaAutomacoes: typeof c.horaAutomacoes === "string" && /^\d{2}:\d{2}$/.test(c.horaAutomacoes) ? c.horaAutomacoes : atual.horaAutomacoes,
          pausado: c.pausado !== undefined ? Boolean(c.pausado) : atual.pausado,
          modoSombra: c.modoSombra !== undefined ? Boolean(c.modoSombra) : atual.modoSombra,
          maxMensagensMes: num(c.maxMensagensMes, atual.maxMensagensMes, 1, 30),
          backupDir: c.backupDir !== undefined ? c.backupDir.trim() || undefined : atual.backupDir,
        };
        if (nova.intervaloMaxSeg < nova.intervaloMinSeg) nova.intervaloMaxSeg = nova.intervaloMinSeg;
        if (nova.envioFim <= nova.envioInicio) throw new Error("O fim do horário de envio precisa ser depois do início.");
        b.config = nova;
      } else if (p.tipo === "modelo") {
        if (!CAMPANHAS.some((c) => c.id === p.modelo.campanha)) throw new Error("Campanha desconhecida.");
        const variacoes = (p.modelo.variacoes ?? []).map((v) => String(v).trim()).filter(Boolean).slice(0, 10);
        const existente = b.modelos.find((m) => m.campanha === p.modelo.campanha);
        if (existente) {
          existente.ativo = Boolean(p.modelo.ativo);
          existente.variacoes = variacoes;
        } else b.modelos.push({ campanha: p.modelo.campanha, ativo: Boolean(p.modelo.ativo), variacoes });
      } else throw new Error("Pedido desconhecido.");
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ erro: e instanceof Error ? e.message : "Erro" }, { status: 400 });
  }
}
