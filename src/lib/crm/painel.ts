/**
 * Painel gerencial do CRM: um cartão por loja física com a situação do
 * WhatsApp, o atendimento (quem está esperando, tempo de resposta) e a
 * captura de celular no caixa. É o que a Visão geral mostra.
 */

import { LOJAS } from "@/lib/connectors/totvs";
import { diasEntre, hojeSp, somarDias } from "./base";
import { type ResumoAtendimento, resumoAtendimento } from "./atendimento";
import { enviadasHoje } from "./fila";
import { perfis } from "./perfil";
import type { BaseCrm } from "./tipos";
import { linkDaWaakg, tetoDoNumero } from "./tipos";

export type Nivel = "ok" | "atencao" | "critico" | "inativo";

export interface CardLoja {
  loja: string;
  nivel: Nivel;
  alertas: string[];
  numero: { configurado: boolean; ativo: boolean; hoje: number; teto: number; naFila: number };
  atend: {
    conversasHoje: number;
    msgsHoje: number;
    esperando: number;
    maiorEsperaMin: number;
    medianaHoje: number | null;
    mediana7d: number | null;
    /** % respondidas em até 15 min, 7 dias */
    rapidas7d: number | null;
    /** Conversas por dia, 7 dias (mais antigo primeiro) */
    dias: { dia: string; conversas: number }[];
  };
  cadastro: {
    /** Vendas da loja nos últimos 30 dias e quantas com cliente que tem celular */
    vendas30: number;
    comCelular30: number;
    pct30: number | null;
    /** Mesmo número nos 30 dias anteriores, pra ver se está melhorando */
    pctAnterior: number | null;
    /** Clientes que compraram pela primeira vez nos últimos 7 dias, com celular */
    novas7d: number;
    novas7dSemCelular: number;
    /** % por semana, 8 semanas (mais antiga primeiro) */
    semanas: { inicio: string; pct: number | null; vendas: number }[];
    clientes: number;
    pctBase: number | null;
  };
}

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : null);

/** Início do dia de hoje em SP, como ISO UTC. */
const meiaNoiteSp = (hoje: string) => new Date(`${hoje}T00:00:00-03:00`).toISOString();

export function painel(base: BaseCrm): { lojas: CardLoja[]; hoje: ResumoAtendimento; semana: ResumoAtendimento } {
  const hoje = hojeSp();
  const atHoje = resumoAtendimento(base, 1, meiaNoiteSp(hoje));
  const at7 = resumoAtendimento(base, 7);
  const prf = perfis(base, hoje);
  const temCel = new Map(base.clientes.map((c) => [c.id, Boolean(c.telefone)]));
  const d30 = somarDias(hoje, -30);
  const d60 = somarDias(hoje, -60);
  const d7 = somarDias(hoje, -7);
  const inicioSemanas = somarDias(hoje, -56);

  // Conversas por loja e dia (telefones distintos que escreveram)
  const porDia = new Map<string, Set<string>>();
  const desde7 = meiaNoiteSp(somarDias(hoje, -6));
  for (const a of base.atendimento) {
    if (a.de !== "cliente" || a.em < desde7) continue;
    const dia = new Date(new Date(a.em).getTime() - 3 * 3600000).toISOString().slice(0, 10);
    const k = `${a.loja}|${dia}`;
    (porDia.get(k) ?? porDia.set(k, new Set()).get(k)!).add(a.telefone);
  }

  const lojas = Object.values(LOJAS).map((loja): CardLoja => {
    const n = base.config.numeros.find((x) => x.loja === loja);
    const configurado = Boolean(n?.sessao);
    const ativo = Boolean(n?.ativo && n.sessao);
    const lh = atHoje.lojas.find((l) => l.loja === loja);
    const l7 = at7.lojas.find((l) => l.loja === loja);
    const pend = at7.pendentes.filter((p) => p.loja === loja);

    // Captura de celular pelas vendas da loja
    let vendas30 = 0;
    let cel30 = 0;
    let vendasAnt = 0;
    let celAnt = 0;
    const sem = new Map<number, { v: number; c: number }>();
    for (const v of base.vendas) {
      if (v.loja !== loja || v.valor <= 0) continue;
      const d = v.data.slice(0, 10);
      if (d < d60) continue;
      const ok = Boolean(v.clienteId && temCel.get(v.clienteId));
      if (d > d30) {
        vendas30++;
        if (ok) cel30++;
      } else {
        vendasAnt++;
        if (ok) celAnt++;
      }
      if (d > inicioSemanas) {
        const i = Math.min(7, Math.floor((diasEntre(inicioSemanas, d) - 1) / 7));
        const s = sem.get(i) ?? sem.set(i, { v: 0, c: 0 }).get(i)!;
        s.v++;
        if (ok) s.c++;
      }
    }
    let novas = 0;
    let novasSem = 0;
    let clientes = 0;
    let comCel = 0;
    for (const c of base.clientes) {
      const p = prf.get(c.id);
      if (p?.loja !== loja) continue;
      clientes++;
      if (c.telefone) comCel++;
      if (p.primeira && p.primeira > d7) {
        if (c.telefone) novas++;
        else novasSem++;
      }
    }

    const card: CardLoja = {
      loja,
      nivel: "ok",
      alertas: [],
      numero: {
        configurado,
        ativo,
        hoje: enviadasHoje(base, loja, hoje),
        teto: tetoDoNumero(base.config, n, hoje),
        naFila: base.mensagens.filter((m) => m.loja === loja && m.status === "fila").length,
      },
      atend: {
        conversasHoje: lh?.conversas ?? 0,
        msgsHoje: lh?.mensagensClientes ?? 0,
        esperando: pend.length,
        maiorEsperaMin: pend[0]?.esperando ?? 0,
        medianaHoje: lh?.medianaMin ?? null,
        mediana7d: l7?.medianaMin ?? null,
        rapidas7d: l7 ? pct(l7.rapidas, l7.respondidas) : null,
        dias: Array.from({ length: 7 }, (_, i) => {
          const dia = somarDias(hoje, i - 6);
          return { dia, conversas: porDia.get(`${loja}|${dia}`)?.size ?? 0 };
        }),
      },
      cadastro: {
        vendas30,
        comCelular30: cel30,
        pct30: pct(cel30, vendas30),
        pctAnterior: pct(celAnt, vendasAnt),
        novas7d: novas,
        novas7dSemCelular: novasSem,
        semanas: Array.from({ length: 8 }, (_, i) => {
          const s = sem.get(i);
          return { inicio: somarDias(inicioSemanas, i * 7 + 1), pct: s ? pct(s.c, s.v) : null, vendas: s?.v ?? 0 };
        }),
        clientes,
        pctBase: pct(comCel, clientes),
      },
    };

    // Semáforo: o que a gerente precisa olhar primeiro
    const a = card.alertas;
    let nivel: Nivel = ativo ? "ok" : "inativo";
    const piora = (nv: Nivel) => {
      const ordem: Nivel[] = ["inativo", "ok", "atencao", "critico"];
      if (ordem.indexOf(nv) > ordem.indexOf(nivel)) nivel = nv;
    };
    if (configurado && !ativo) a.push("Número desligado no CRM");
    if (card.atend.maiorEsperaMin > 60) {
      a.push(`${pend.filter((p) => p.esperando > 60).length} esperando há mais de 1h`);
      piora("critico");
    } else if (card.atend.esperando) {
      a.push(`${card.atend.esperando} esperando resposta`);
      piora("atencao");
    }
    if (card.atend.mediana7d !== null && card.atend.mediana7d > 15) {
      a.push(`Responde em ${card.atend.mediana7d} min (mediana)`);
      piora("atencao");
    }
    if (card.cadastro.pct30 !== null && card.cadastro.vendas30 >= 10 && card.cadastro.pct30 < 50) {
      a.push(`Só ${card.cadastro.pct30}% das vendas com celular`);
      if (nivel !== "inativo") piora("atencao");
    }
    card.nivel = nivel;
    return card;
  });

  return { lojas, hoje: atHoje, semana: at7 };
}

/** Detalhe de uma loja: atendimento no período e captura de celular por vendedora. */
export function detalheLoja(base: BaseCrm, loja: string, dias: number) {
  const hoje = hojeSp();
  const at = resumoAtendimento(base, dias);
  const desde = somarDias(hoje, -dias);
  const temCel = new Map(base.clientes.map((c) => [c.id, Boolean(c.telefone)]));
  const porVend = new Map<string, { vendas: number; comCelular: number; semCliente: number }>();
  for (const v of base.vendas) {
    if (v.loja !== loja || v.valor <= 0 || v.data.slice(0, 10) <= desde) continue;
    const nome = v.vendedoraCpf ? (base.vendedoras?.[v.vendedoraCpf] ?? `CPF •••${v.vendedoraCpf.slice(3, 9)}`) : "Sem vendedora na nota";
    const a = porVend.get(nome) ?? porVend.set(nome, { vendas: 0, comCelular: 0, semCliente: 0 }).get(nome)!;
    a.vendas++;
    if (!v.clienteId) a.semCliente++;
    else if (temCel.get(v.clienteId)) a.comCelular++;
  }
  return {
    loja,
    dias,
    atendimento: at.lojas.find((l) => l.loja === loja) ?? null,
    pendentes: at.pendentes.filter((p) => p.loja === loja),
    vendedoras: Array.from(porVend, ([nome, a]) => ({ nome, ...a, pct: pct(a.comCelular, a.vendas) }))
      .filter((x) => x.vendas >= 3)
      .sort((x, y) => (y.pct ?? 0) - (x.pct ?? 0)),
    gatewayUrl: linkDaWaakg(base.config),
  };
}
