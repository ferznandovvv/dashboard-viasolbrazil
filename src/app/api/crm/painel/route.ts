import { NextRequest, NextResponse } from "next/server";
import { LOJAS } from "@/lib/connectors/totvs";
import { lerBase } from "@/lib/crm/base";
import { adaptadorDe } from "@/lib/crm/envio/adaptador";
import { dentroDaJanela } from "@/lib/crm/fila";
import { detalheLoja, painel } from "@/lib/crm/painel";
import { nomearPendentes } from "@/lib/crm/contatos";
import { linkDaWaakg } from "@/lib/crm/tipos";
import { aprenderVendedoras } from "@/lib/crm/vendasLoja";
import { vendasPeloWhatsApp } from "@/lib/crm/whatsLoja";
import { envioPorNumero } from "@/lib/crm/envioPainel";
import { resumoEcommerce } from "@/lib/crm/ecommerce";
import { cashbackDoMes, voltaramPorLoja } from "@/lib/crm/resumoMes";
import { listarCampanhas } from "@/lib/crm/campanhas";
import { oficialDe } from "@/lib/crm/tipos";

export const dynamic = "force-dynamic";

/** Painel gerencial (um cartão por loja) ou, com ?loja=, o detalhe de uma loja. */
export async function GET(req: NextRequest) {
  const base = await lerBase();
  const loja = req.nextUrl.searchParams.get("loja");
  await aprenderVendedoras(base).catch(() => {});
  if (loja) {
    if (!Object.values(LOJAS).includes(loja) && loja !== "Site") return NextResponse.json({ erro: "Loja não encontrada" }, { status: 400 });
    const dias = Math.min(90, Math.max(1, Number(req.nextUrl.searchParams.get("dias")) || 7));
    const d = detalheLoja(base, loja, dias);
    return NextResponse.json({ ...d, pendentes: await nomearPendentes(base, d.pendentes) });
  }

  const p = painel(base);
  const adaptador = adaptadorDe(base.config);
  // Situação de cada número direto na WA-AKG (conectado ou não)
  const situacoes = await Promise.all(
    p.lojas.map(async (l) => {
      const n = base.config.numeros.find((x) => x.loja === l.loja);
      if (!adaptador || !n?.sessao || !n.ativo) return null;
      return adaptador.situacao(n.sessao);
    })
  );
  const inicioMes = `${new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 7)}-01`;
  const lojas = p.lojas.map((l, i) => {
    const s = situacoes[i];
    if (s && !s.conectado) {
      l.alertas.unshift("WhatsApp desconectado");
      l.nivel = "critico";
    }
    const w = vendasPeloWhatsApp(base, l.loja, inicioMes);
    return { ...l, conectado: s ? s.conectado : null, detalheNumero: s?.detalhe, peloWhats: { vendas: w.vendas, valor: w.valor, pctVendas: w.pctVendas } };
  });

  const cfg = base.config;
  return NextResponse.json({
    lojas,
    geral: {
      conversasHoje: p.hoje.lojas.reduce((s, l) => s + l.conversas, 0),
      esperando: p.semana.pendentes.length,
      maiorEsperaMin: p.semana.pendentes[0]?.esperando ?? 0,
      mediana7d: p.semana.medianaMin,
      rapidas7d: p.semana.respondidas ? Math.round((p.semana.rapidas / p.semana.respondidas) * 100) : null,
      respondidas7d: p.semana.respondidas,
      // Celular no caixa é só das lojas físicas
      vendas30: lojas.filter((l) => l.loja !== "Site").reduce((s, l) => s + l.cadastro.vendas30, 0),
      comCelular30: lojas.filter((l) => l.loja !== "Site").reduce((s, l) => s + l.cadastro.comCelular30, 0),
      conectados: lojas.filter((l) => l.conectado).length,
      numeros: lojas.filter((l) => l.numero.ativo).length,
      eventos: base.atendimento.length,
    },
    pendentes: await nomearPendentes(base, p.semana.pendentes.slice(0, 100)),
    // Quem respondeu SAIR (ou parecido) nos últimos 60 dias
    sairam: Object.entries(base.naoContatar ?? {})
      .filter(([, x]) => x.em >= new Date(Date.now() - 60 * 86400000).toISOString())
      .sort((a, b) => b[1].em.localeCompare(a[1].em))
      .slice(0, 50)
      .map(([telefone, x]) => ({ telefone, nome: base.clientes.find((c) => c.telefone === telefone)?.nome, ...x })),
    devolucoes: (base.devolucoes ?? [])
      .filter((d) => d.vistoEm >= new Date(Date.now() - 30 * 86400000).toISOString() && (d.clienteId || d.tipo === "cancelamento"))
      .sort((a, b) => b.data.localeCompare(a.data))
      .slice(0, 60)
      .map((d) => ({ ...d, nome: base.clientes.find((c) => c.id === d.clienteId)?.nome ?? d.nomeNaNota })),
    envioNumeros: envioPorNumero(base).map((n) => ({ ...n, conectado: n.provedor === "oficial" ? null : (lojas.find((l) => l.loja === n.loja)?.conectado ?? null) })),
    ecommerce: resumoEcommerce(base, 7),
    cashbackMes: cashbackDoMes(base),
    voltaram: voltaramPorLoja(base),
    // Retorno de cada campanha nos últimos 30 dias (só as que mandaram ou simularam algo)
    retorno: (() => {
      const c = listarCampanhas(base);
      return [
        ...c.automaticas.map((a) => ({ id: a.id, nome: a.nome, manual: false, r: a.resultado })),
        ...c.manuais.filter((m) => m.criadaEm >= new Date(Date.now() - 30 * 86400000).toISOString()).map((m) => ({ id: m.id, nome: m.nome, manual: true, r: m.resultado })),
      ].filter((x) => x.r.total > 0);
    })(),
    siteSombra: oficialDe(cfg).sombra,
    envio: {
      modoSombra: cfg.modoSombra,
      pausado: cfg.pausado,
      provedor: adaptador?.nome ?? null,
      dentroDaJanela: dentroDaJanela(base),
      naFila: base.mensagens.filter((m) => m.status === "fila").length,
      inicio: cfg.envioInicio,
      fim: cfg.envioFim,
    },
    gatewayUrl: linkDaWaakg(cfg),
  });
}
