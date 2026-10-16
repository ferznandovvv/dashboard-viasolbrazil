"use client";

import type { Conta } from "@/lib/financeiro/tipos";
import { brl } from "./comum";

const SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

/** Valor curto para caber na célula: 1.234 ou 1,2 mil. */
const curto = (v: number) =>
  v >= 10000
    ? `${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`
    : v.toLocaleString("pt-BR", { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 });

/**
 * Calendário do mês: em cada dia, o que vence (ou foi pago) e quanto.
 * Clicar num dia filtra a lista de baixo para aquele dia.
 */
export function Agenda({
  mes,
  hoje,
  contas,
  dia,
  aoEscolherDia,
}: {
  mes: string;
  hoje: string;
  contas: Conta[];
  dia: string;
  aoEscolherDia: (d: string) => void;
}) {
  const [y, m] = mes.split("-").map(Number);
  const primeiroDow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const diasNoMes = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const porDia = new Map<string, Conta[]>();
  for (const c of contas) {
    if (!c.vencimento.startsWith(mes)) continue;
    porDia.set(c.vencimento, [...(porDia.get(c.vencimento) ?? []), c]);
  }

  const celulas: (string | null)[] = [
    ...Array.from({ length: primeiroDow }, () => null),
    ...Array.from({ length: diasNoMes }, (_, i) => `${mes}-${String(i + 1).padStart(2, "0")}`),
  ];
  while (celulas.length % 7) celulas.push(null);

  return (
    <div className="agenda">
      {SEMANA.map((s) => (
        <div key={s} className="agenda-sem">
          {s}
        </div>
      ))}
      {celulas.map((d, i) => {
        if (!d) return <div key={`v${i}`} className="agenda-dia vazio" />;
        const cs = (porDia.get(d) ?? []).sort((a, b) => b.valor - a.valor);
        const abertas = cs.filter((c) => c.status === "aberta");
        const totalAberto = abertas.reduce((s, c) => s + c.valor, 0);
        const totalPago = cs.filter((c) => c.status === "paga").reduce((s, c) => s + (c.valorPago ?? c.valor), 0);
        const vencido = abertas.length > 0 && d < hoje;
        return (
          <button
            key={d}
            className={`agenda-dia${d === hoje ? " hoje" : ""}${d === dia ? " sel" : ""}${vencido ? " vencido" : ""}${
              cs.length ? " tem" : ""
            }`}
            onClick={() => aoEscolherDia(d === dia ? "" : d)}
            title={cs.map((c) => `${c.descricao}: ${brl.format(c.valor)}${c.status === "paga" ? " (paga)" : ""}`).join("\n")}
          >
            <span className="agenda-num">{Number(d.slice(8))}</span>
            {totalAberto > 0 && <span className="agenda-total">{curto(totalAberto)}</span>}
            {totalAberto === 0 && totalPago > 0 && <span className="agenda-total pago">✓ {curto(totalPago)}</span>}
            <span className="agenda-itens">
              {cs.slice(0, 3).map((c) => (
                <span key={c.id} className={`agenda-item${c.status === "paga" ? " pago" : ""}`}>
                  {c.descricao}
                </span>
              ))}
              {cs.length > 3 && <span className="agenda-mais">+{cs.length - 3}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}
