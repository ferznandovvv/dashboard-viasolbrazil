import { createDecipheriv, scryptSync } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { comCache } from "./cache";
import { env } from "./env";
import { fetchTotvsSales } from "./connectors/totvs";
import { totalShopifyDoMes } from "./connectors/shopify";
import { todaySpKey } from "./types";
import "./credenciais";

/**
 * Vendas mês a mês desde 2023, por loja e do site.
 *
 * Antes da TOTVS e da Shopify, os números vêm da planilha que a Via Sol
 * mantinha (VENDAS_MENSAIS_LOJAS.xlsx). Ela fica no repositório trancada
 * (AES-256-GCM): o código é público e o faturamento não pode ficar à vista.
 * A chave é colada uma vez em Configurações › Integrações.
 *
 * Regra de cada loja em cada mês: vale o sistema (TOTVS ou Shopify) quando
 * ele cobre o mês inteiro — tem venda no mês e também no mês anterior (ou a
 * loja é nova); senão, vale a planilha. Assim o mês em que a TOTVS começou
 * no meio não sai pela metade.
 */

export const INICIO_HISTORICO = "2023-01";
const ARQUIVO = join(process.cwd(), "historico", "vendas-antigas.cifrado.json");

/** O Franca Shopping fechou e a filial 2 da TOTVS passou a ser a Fiusa neste mês. */
const ABERTURA_FIUSA = "2026-08";

/** Ordem das linhas: lojas físicas (o bazar logo depois da fábrica) e o site no fim. */
const ORDEM = [
  "Centro",
  "Franca Shopping",
  "Fiusa",
  "Loja de Fábrica",
  "Bazar",
  "Rio de Janeiro",
  "Ribeirão Preto",
  "SP — Itaim",
  "Belo Horizonte",
  "Praia Grande",
  "Site",
];

type PorMes = Record<string, Record<string, number>>;

interface Planilha {
  meses: PorMes;
  notas?: Record<string, Record<string, string>>;
}

export type SituacaoPlanilha = "ok" | "sem-chave" | "chave-errada" | "sem-arquivo";

export interface HistoricoMensal {
  /** AAAA-MM, do primeiro mês até o atual */
  meses: string[];
  lojas: string[];
  /** mês → loja → valor */
  valores: PorMes;
  /** De onde veio cada número que não é do sistema */
  daPlanilha: Record<string, string[]>;
  notas: Record<string, Record<string, string>>;
  planilha: SituacaoPlanilha;
  /** Até que mês a planilha tem números */
  planilhaAte?: string;
  erros: string[];
  geradoEm: string;
}

/** Abre o arquivo trancado com a chave salva nas integrações. */
async function lerPlanilha(): Promise<{ situacao: SituacaoPlanilha; dados?: Planilha }> {
  const chave = env("HISTORICO_CHAVE").replace(/[\s-]/g, "").toLowerCase();
  if (!chave) return { situacao: "sem-chave" };
  let cifrado: { iv: string; tag: string; dados: string };
  try {
    cifrado = JSON.parse(await readFile(ARQUIVO, "utf8"));
  } catch {
    return { situacao: "sem-arquivo" };
  }
  try {
    const d = createDecipheriv("aes-256-gcm", scryptSync(chave, "viasol-historico", 32), Buffer.from(cifrado.iv, "base64"));
    d.setAuthTag(Buffer.from(cifrado.tag, "base64"));
    const texto = Buffer.concat([d.update(Buffer.from(cifrado.dados, "base64")), d.final()]).toString("utf8");
    return { situacao: "ok", dados: JSON.parse(texto) as Planilha };
  } catch {
    return { situacao: "chave-errada" };
  }
}

const proximoMes = (mes: string) => {
  const [a, m] = mes.split("-").map(Number);
  return m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, "0")}`;
};
const mesAnterior = (mes: string) => {
  const [a, m] = mes.split("-").map(Number);
  return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, "0")}`;
};
function mesesEntre(de: string, ate: string): string[] {
  const out: string[] = [];
  for (let m = de; m <= ate; m = proximoMes(m)) out.push(m);
  return out;
}

/** Notas fiscais da TOTVS somadas por mês e loja, ano a ano (um ano por vez, para não afogar a API). */
async function totvsPorMes(hoje: string, erros: string[]): Promise<PorMes> {
  const out: PorMes = {};
  for (let ano = Number(INICIO_HISTORICO.slice(0, 4)); ano <= Number(hoje.slice(0, 4)); ano++) {
    const fim = `${ano}-12-31` < hoje ? `${ano}-12-31` : hoje;
    const r = await fetchTotvsSales(`${ano}-01-01`, fim);
    if (r.error) erros.push(`TOTVS ${ano}: ${r.error}`);
    for (const o of r.orders) {
      const mes = o.createdAt.slice(0, 7);
      let loja = o.store || "Outras";
      if (loja === "Fiusa" && mes < ABERTURA_FIUSA) loja = "Franca Shopping";
      (out[mes] ??= {})[loja] = (out[mes][loja] ?? 0) + o.total;
    }
  }
  return out;
}

async function montar(): Promise<HistoricoMensal> {
  const hoje = todaySpKey();
  const atual = hoje.slice(0, 7);
  const erros: string[] = [];
  const { situacao, dados } = await lerPlanilha();
  const planilha = dados?.meses ?? {};
  const mesesPlanilha = Object.keys(planilha).sort();
  const meses = mesesEntre(INICIO_HISTORICO, atual);

  const sistema = await totvsPorMes(hoje, erros);

  // Site pela Shopify só a partir do fim da planilha (um mês antes, para a
  // regra do mês anterior); sem planilha, os últimos 12 meses
  const ultimoSite = mesesPlanilha.filter((m) => planilha[m].Site).pop();
  const desdeSite = ultimoSite ? mesAnterior(ultimoSite) : meses[Math.max(0, meses.length - 12)];
  for (const mes of meses.filter((m) => m >= desdeSite)) {
    const t = await totalShopifyDoMes(mes);
    if (t === null) {
      erros.push(`Shopify ${mes}: sem resposta`);
      continue;
    }
    if (t > 0) (sistema[mes] ??= {}).Site = t;
  }

  const nomes = new Set<string>();
  for (const fonte of [planilha, sistema]) for (const m of Object.values(fonte)) Object.keys(m).forEach((l) => nomes.add(l));
  const lojas = Array.from(nomes).sort((a, b) => (ORDEM.indexOf(a) + 1 || 90) - (ORDEM.indexOf(b) + 1 || 90));

  const valores: PorMes = {};
  const daPlanilha: Record<string, string[]> = {};
  const notas: Record<string, Record<string, string>> = JSON.parse(JSON.stringify(dados?.notas ?? {}));
  const anotar = (mes: string, loja: string, texto: string) => ((notas[mes] ??= {})[loja] = texto);

  for (const mes of meses) {
    const ant = mesAnterior(mes);
    for (const loja of lojas) {
      const sis = sistema[mes]?.[loja] ?? 0;
      const pla = planilha[mes]?.[loja];
      const cobre = sis > 0 && (pla === undefined || (sistema[ant]?.[loja] ?? 0) > 0 || planilha[ant]?.[loja] === undefined);
      const v = cobre ? sis : (pla ?? sis);
      if (!v) continue;
      (valores[mes] ??= {})[loja] = Math.round(v * 100) / 100;
      if (!cobre && pla !== undefined) (daPlanilha[mes] ??= []).push(loja);
    }

    // O bazar acontece na fábrica: quando a fábrica vem da TOTVS, o valor do
    // bazar (da planilha) sai de dentro dela, para os dois ficarem separados
    const bazar = planilha[mes]?.Bazar;
    const fabricaDaPlanilha = daPlanilha[mes]?.includes("Loja de Fábrica");
    if (bazar && !fabricaDaPlanilha && valores[mes]?.["Loja de Fábrica"] !== undefined) {
      const fabrica = valores[mes]["Loja de Fábrica"];
      if (fabrica >= bazar) {
        valores[mes]["Loja de Fábrica"] = Math.round((fabrica - bazar) * 100) / 100;
        anotar(mes, "Bazar", "valor da planilha, separado das vendas da fábrica na TOTVS");
      } else {
        delete valores[mes].Bazar;
        anotar(mes, "Loja de Fábrica", "inclui o bazar");
      }
    }
  }

  return {
    meses,
    lojas,
    valores,
    daPlanilha,
    notas,
    planilha: situacao,
    planilhaAte: mesesPlanilha[mesesPlanilha.length - 1],
    erros,
    geradoEm: new Date().toISOString(),
  };
}

/** Para o botão "testar" das integrações: a chave abre a planilha? */
export async function testarPlanilha(): Promise<{ ok: boolean; mensagem: string }> {
  const { situacao, dados } = await lerPlanilha();
  if (situacao === "sem-chave") return { ok: false, mensagem: "Cole a chave das vendas antigas." };
  if (situacao === "sem-arquivo") return { ok: false, mensagem: "O arquivo das vendas antigas não está nesta instalação." };
  if (situacao === "chave-errada") return { ok: false, mensagem: "Essa chave não abre o arquivo. Confira se colou inteira." };
  const meses = Object.keys(dados?.meses ?? {}).sort();
  const nome = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString("pt-BR", { month: "short", year: "numeric", timeZone: "UTC" });
  return { ok: true, mensagem: `Funcionando — ${meses.length} meses, de ${nome(meses[0])} a ${nome(meses[meses.length - 1])}. Veja em Histórico.` };
}

/** O histórico pronto. A primeira montagem busca anos da TOTVS; depois, o que mudou. */
export function historicoMensal(): Promise<HistoricoMensal> {
  return comCache("historico-mensal", montar, 15 * 60000);
}
