"use client";

import { useRef, useState } from "react";
import { brl } from "./viz";

export const MESES_CURTOS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** "R$ 1,2 mi", "R$ 850 mil": eixo e rótulos sem poluir. */
export function compacto(v: number): string {
  if (v >= 1_000_000) return `R$ ${(v / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;
  if (v >= 1000) return `R$ ${Math.round(v / 1000).toLocaleString("pt-BR")} mil`;
  return brl.format(v);
}

export interface Ano {
  ano: number;
  /** Um valor por mês (jan…dez); null = sem número */
  valores: (number | null)[];
  cor: string;
}

/**
 * Linhas mês a mês, uma por ano, na mesma escala: o ano atual fica mais
 * escuro. O mês em andamento (`parcial`) sai tracejado e com o ponto vazado.
 * Passando o mouse, mostra todos os anos daquele mês.
 */
export function GraficoAnos({ anos, parcial }: { anos: Ano[]; parcial?: { ano: number; mes: number } }) {
  const caixa = useRef<HTMLDivElement>(null);
  const [foco, setFoco] = useState<{ i: number; x: number } | null>(null);

  const W = 960;
  const H = 320;
  const PAD = { top: 16, right: 64, bottom: 30, left: 76 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const passo = plotW / 11;
  const x = (i: number) => PAD.left + i * passo;

  const max = Math.max(1, ...anos.flatMap((a) => a.valores.map((v) => v ?? 0)));
  const pot = Math.pow(10, Math.floor(Math.log10(max)));
  const yMax = Math.ceil(max / pot) * pot;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * yMax);
  const y = (v: number) => PAD.top + plotH - (v / yMax) * plotH;

  /** Trechos contínuos de cada ano; o último ponto do mês parcial vai à parte, tracejado */
  const trechos = (a: Ano) => {
    const cheios: string[] = [];
    let atual: string[] = [];
    let tracejado: string | null = null;
    a.valores.forEach((v, i) => {
      const ehParcial = parcial?.ano === a.ano && parcial.mes === i;
      if (v === null) {
        if (atual.length) cheios.push(atual.join(" "));
        atual = [];
        return;
      }
      const p = `${x(i)},${y(v)}`;
      if (ehParcial) {
        const ant = a.valores[i - 1];
        if (ant !== null && ant !== undefined) tracejado = `${x(i - 1)},${y(ant)} ${p}`;
      } else atual.push(p);
    });
    if (atual.length) cheios.push(atual.join(" "));
    return { cheios, tracejado };
  };

  const atual = anos[anos.length - 1];
  const ultimoAtual = atual ? atual.valores.reduce<number>((u, v, i) => (v !== null ? i : u), -1) : -1;

  const mover = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.round((px - PAD.left) / passo);
    setFoco(i >= 0 && i < 12 ? { i, x: e.clientX - r.left } : null);
  };

  return (
    <div className="grafico-anos">
      <ul className="legenda-anos" aria-label="Anos">
        {anos.map((a) => (
          <li key={a.ano}>
            <span className="traco" style={{ background: a.cor }} />
            {a.ano}
          </li>
        ))}
      </ul>
      <div className="chart-box" ref={caixa}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`Vendas mês a mês de ${anos.map((a) => a.ano).join(", ")}. Os valores estão na tabela abaixo.`}
          onMouseMove={mover}
          onMouseLeave={() => setFoco(null)}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? "var(--baseline)" : "var(--grid)"} strokeWidth={1} />
              <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill="var(--text-muted)">
                {compacto(t)}
              </text>
            </g>
          ))}
          {MESES_CURTOS.map((m, i) => (
            <text key={m} x={x(i)} y={H - 8} textAnchor="middle" fontSize={11} fill="var(--text-muted)">
              {m}
            </text>
          ))}

          {foco && <line x1={x(foco.i)} x2={x(foco.i)} y1={PAD.top} y2={PAD.top + plotH} stroke="var(--baseline)" strokeWidth={1} />}

          {anos.map((a) => {
            const { cheios, tracejado } = trechos(a);
            return (
              <g key={a.ano}>
                {cheios.map((pts) => (
                  <polyline key={pts} points={pts} fill="none" stroke={a.cor} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                ))}
                {tracejado && <polyline points={tracejado} fill="none" stroke={a.cor} strokeWidth={2} strokeDasharray="4 4" strokeLinecap="round" />}
              </g>
            );
          })}

          {/* Pontos do mês em foco, com anel da cor do fundo */}
          {foco &&
            anos.map((a) => {
              const v = a.valores[foco.i];
              if (v === null || v === undefined) return null;
              const vazado = parcial?.ano === a.ano && parcial.mes === foco.i;
              return (
                <circle key={a.ano} cx={x(foco.i)} cy={y(v)} r={4.5} fill={vazado ? "var(--surface-1)" : a.cor} stroke={vazado ? a.cor : "var(--surface-1)"} strokeWidth={2} />
              );
            })}

          {/* O ano atual leva o rótulo no último ponto */}
          {atual && ultimoAtual >= 0 && (
            <>
              <circle
                cx={x(ultimoAtual)}
                cy={y(atual.valores[ultimoAtual] ?? 0)}
                r={4.5}
                fill={parcial?.ano === atual.ano && parcial.mes === ultimoAtual ? "var(--surface-1)" : atual.cor}
                stroke={parcial?.ano === atual.ano && parcial.mes === ultimoAtual ? atual.cor : "var(--surface-1)"}
                strokeWidth={2}
              />
              <text x={x(ultimoAtual) + 10} y={y(atual.valores[ultimoAtual] ?? 0) + 4} fontSize={12} fontWeight={600} fill="var(--text-primary)">
                {atual.ano}
              </text>
            </>
          )}
        </svg>

        {foco && (
          <div className="tooltip" style={{ left: Math.min(foco.x + 14, (caixa.current?.clientWidth ?? 400) - 200), top: 8 }}>
            <div className="t-date">{MESES_CURTOS[foco.i]}</div>
            {[...anos].reverse().map((a, k, lista) => {
              const v = a.valores[foco.i];
              const ant = lista[k + 1]?.valores[foco.i];
              const pct = v && ant ? Math.round(((v - ant) / ant) * 100) : null;
              return (
                <div key={a.ano} className="t-row">
                  <span>
                    <span className="ch-dot" style={{ background: a.cor }} />
                    {a.ano}
                    {parcial?.ano === a.ano && parcial.mes === foco.i ? " (até hoje)" : ""}
                  </span>
                  <b>
                    {v === null || v === undefined ? "—" : brl.format(v)}
                    {pct !== null && <span className={`delta ${pct >= 0 ? "up" : "down"}`}>{pct >= 0 ? "↑" : "↓"} {Math.abs(pct)}%</span>}
                  </b>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
