import { NextResponse } from "next/server";
import { LOJAS, totvsConfigured } from "@/lib/connectors/totvs";
import { rodandoLocal } from "@/lib/credenciais";
import { hojeSp, lerBase, somarDias } from "@/lib/crm/base";
import { SEGMENTOS, listarSegmento } from "@/lib/crm/clientes";
import { dentroDaJanela, enviadasHoje } from "@/lib/crm/fila";
import { progresso } from "@/lib/crm/totvs";
import { adaptadorDe } from "@/lib/crm/envio/adaptador";

export const dynamic = "force-dynamic";

/** Visão geral do CRM: números da base, fila, situação dos canais. */
export async function GET() {
  if (!rodandoLocal()) return NextResponse.json({ local: false });
  const base = await lerBase();
  const hoje = hojeSp();
  const mes = hoje.slice(0, 7);
  const semana = somarDias(hoje, -7);

  const comTelefone = base.clientes.filter((c) => c.telefone).length;
  const saldoTotal = Math.round(
    listarSegmento(base, "com_saldo").reduce((s, c) => s + c.saldo, 0) * 100
  ) / 100;

  const msgs = base.mensagens;
  const fila = msgs.filter((m) => m.status === "fila").length;
  const enviadasMes = msgs.filter((m) => m.enviadoEm?.startsWith(mes)).length;
  const respondidasMes = msgs.filter((m) => m.respondidoEm?.startsWith(mes)).length;
  const errosSemana = msgs.filter((m) => m.status === "erro" && m.criadoEm >= semana).length;

  const adaptador = adaptadorDe(base.config);
  const numeros = await Promise.all(
    base.config.numeros.map(async (n) => ({
      ...n,
      sessao: n.sessao,
      hoje: enviadasHoje(base, n.loja, hoje),
      teto: n.tetoDia ?? base.config.tetoDiaPorNumero,
      situacao: adaptador && n.ativo && n.sessao ? await adaptador.situacao(n.sessao) : null,
    }))
  );

  const segmentos = SEGMENTOS.map((s) => ({ ...s, total: listarSegmento(base, s.id).length }));

  return NextResponse.json({
    local: true,
    hoje,
    lojas: Object.values(LOJAS),
    totvs: { configurado: totvsConfigured(), ultima: base.config.ultimaSincTotvs, resultado: base.config.ultimaSincTotvsResultado, desde: base.config.sincVendasDesde, progresso },
    base: { clientes: base.clientes.length, comTelefone, vendas: base.vendas.length, saldoTotal },
    fila: { emEspera: fila, enviadasMes, respondidasMes, errosSemana, pausado: base.config.pausado, dentroDaJanela: dentroDaJanela(base), provedor: adaptador?.nome ?? null },
    numeros,
    segmentos,
    ultimaAutomacao: base.config.ultimaAutomacao,
  });
}
