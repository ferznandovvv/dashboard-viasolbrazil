/**
 * Agenda do aquecimento quando o sistema roda numa máquina própria: faz o
 * papel do cron da Vercel, sem precisar configurar nada no Windows.
 *
 * Só roda no servidor Node (carregado pelo instrumentation.ts).
 */

import { rodandoLocal } from "./credenciais";
import { aquecer, continuarEstoque } from "./aquecer";
import { completarTelefones, sincronizarDiaria } from "./crm/totvs";
import { sincronizarShopifyDiaria } from "./crm/shopify";
import { rodarAutomacoes } from "./crm/automacoes";
import { processarFila } from "./crm/fila";
import { lerBase as lerBaseCrm } from "./crm/base";

/** Horários no fuso de São Paulo, antes das lojas abrirem. */
const HORARIOS = [
  { hora: "06:40", tarefa: aquecer, nome: "aquecimento" },
  { hora: "06:58", tarefa: continuarEstoque, nome: "estoque" },
  // CRM: puxa as vendas de ontem do TOTVS e, em seguida, gera as mensagens do dia
  { hora: "08:30", tarefa: sincronizarDiaria, nome: "crm sincronização" },
  { hora: "08:45", tarefa: sincronizarShopifyDiaria, nome: "crm shopify" },
];

function horaSp(): { dia: string; hora: string } {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const v = (t: string) => partes.find((p) => p.type === t)?.value ?? "";
  return { dia: `${v("year")}-${v("month")}-${v("day")}`, hora: `${v("hour")}:${v("minute")}` };
}

let rodando = false;

async function executar(nome: string, tarefa: () => Promise<unknown>) {
  if (rodando) return;
  rodando = true;
  const inicio = Date.now();
  try {
    const r = await tarefa();
    console.log(`[agenda] ${nome} ok em ${Math.round((Date.now() - inicio) / 1000)}s`, JSON.stringify(r));
  } catch (e) {
    console.error(`[agenda] ${nome} falhou:`, e instanceof Error ? e.message : e);
  } finally {
    rodando = false;
  }
}

/** Tarefas do CRM não disputam a trava do aquecimento, que pode levar minutos. */
async function executarCrm(nome: string, tarefa: () => Promise<unknown>) {
  const inicio = Date.now();
  try {
    const r = await tarefa();
    console.log(`[agenda] ${nome} ok em ${Math.round((Date.now() - inicio) / 1000)}s`, JSON.stringify(r));
  } catch (e) {
    console.error(`[agenda] ${nome} falhou:`, e instanceof Error ? e.message : e);
  }
}

let iniciado = false;

export function iniciarAgendador(): void {
  if (iniciado || !rodandoLocal()) return;
  iniciado = true;

  const feitos = new Set<string>();

  // Uma vez só: procura o celular que as lojas anotam no endereço do cadastro
  setTimeout(() => {
    lerBaseCrm()
      .then((b) => {
        if (!b.config.telefonesNoEndereco) void executarCrm("crm celular no endereço", () => completarTelefones());
      })
      .catch(() => {});
  }, 90_000);
  setInterval(() => {
    const { dia, hora } = horaSp();
    for (const h of HORARIOS) {
      const chave = `${dia}|${h.hora}`;
      if (hora === h.hora && !feitos.has(chave)) {
        feitos.add(chave);
        void executar(h.nome, h.tarefa);
      }
    }
    // Automações do CRM no horário configurado na própria tela do CRM
    const chaveCrm = `${dia}|crm-automacoes`;
    if (!feitos.has(chaveCrm)) {
      lerBaseCrm()
        .then((b) => {
          if (hora >= b.config.horaAutomacoes && !feitos.has(chaveCrm)) {
            feitos.add(chaveCrm);
            void executarCrm("crm automações", () => rodarAutomacoes());
          }
        })
        .catch(() => {});
    }
  }, 30_000);

  // Fila de envio do CRM: um passo a cada 20 s, independente do aquecimento
  setInterval(() => {
    processarFila()
      .then((r) => {
        if (r.enviadas || r.erros) console.log(`[crm] fila: ${r.enviadas} enviadas, ${r.erros} erros`);
      })
      .catch((e) => console.error("[crm] fila falhou:", e instanceof Error ? e.message : e));
  }, 20_000);

  // Depois de ligar o computador, deixa tudo pronto sem esperar a madrugada
  setTimeout(() => void executar("aquecimento ao ligar", aquecer), 60_000);
}
