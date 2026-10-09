/**
 * Agenda do aquecimento quando o sistema roda numa máquina própria: faz o
 * papel do cron da Vercel, sem precisar configurar nada no Windows.
 *
 * Só roda no servidor Node (carregado pelo instrumentation.ts).
 */

import { rodandoLocal } from "./credenciais";
import { aquecer, continuarEstoque } from "./aquecer";

/** Horários no fuso de São Paulo, antes das lojas abrirem. */
const HORARIOS = [
  { hora: "06:40", tarefa: aquecer, nome: "aquecimento" },
  { hora: "06:58", tarefa: continuarEstoque, nome: "estoque" },
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

let iniciado = false;

export function iniciarAgendador(): void {
  if (iniciado || !rodandoLocal()) return;
  iniciado = true;

  const feitos = new Set<string>();
  setInterval(() => {
    const { dia, hora } = horaSp();
    for (const h of HORARIOS) {
      const chave = `${dia}|${h.hora}`;
      if (hora === h.hora && !feitos.has(chave)) {
        feitos.add(chave);
        void executar(h.nome, h.tarefa);
      }
    }
  }, 30_000);

  // Depois de ligar o computador, deixa tudo pronto sem esperar a madrugada
  setTimeout(() => void executar("aquecimento ao ligar", aquecer), 60_000);
}
