"use client";

import { useRef, useState } from "react";
import type { ChannelId, DailyPoint } from "@/lib/types";

export const CHANNEL_META: Record<
  ChannelId,
  { name: string; cssVar: string; envVars: string[] }
> = {
  shopify: {
    name: "Shopify",
    cssVar: "var(--c-shopify)",
    envVars: ["SHOPIFY_ADMIN_TOKEN"],
  },
  tiktok: {
    name: "TikTok Shop",
    cssVar: "var(--c-tiktok)",
    envVars: ["TIKTOK_APP_KEY", "TIKTOK_APP_SECRET", "TIKTOK_REFRESH_TOKEN", "TIKTOK_SHOP_CIPHER"],
  },
  meli: {
    name: "Mercado Livre",
    cssVar: "var(--c-meli)",
    envVars: ["ML_CLIENT_ID", "ML_CLIENT_SECRET", "ML_REFRESH_TOKEN"],
  },
};

// Ordem fixa de empilhamento/legenda — nunca muda com filtros
export const CHANNEL_ORDER: ChannelId[] = ["shopify", "tiktok", "meli"];

export const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
export const brlShort = (v: number) =>
  v >= 1000
    ? `R$ ${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`
    : brl.format(v);

export function fmtDay(dateKey: string) {
  const [, m, d] = dateKey.split("-");
  return `${d}/${m}`;
}

/** Sol radial da identidade Via Sol, redesenhado em SVG. */
export function SunMark({ size = 40 }: { size?: number }) {
  const rays = [];
  const N = 18;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const long = i % 3 !== 1;
    const r1 = 11;
    const r2 = long ? 20 : 16.5;
    rays.push(
      <line
        key={i}
        x1={22 + r1 * Math.cos(a)}
        y1={22 + r1 * Math.sin(a)}
        x2={22 + r2 * Math.cos(a)}
        y2={22 + r2 * Math.sin(a)}
      />
    );
  }
  return (
    <svg className="sun" width={size} height={size} viewBox="0 0 44 44" aria-hidden="true">
      <g stroke="currentColor" strokeWidth={2} strokeLinecap="round">
        {rays}
      </g>
    </svg>
  );
}

export function DailyChart({ daily, height = 280 }: { daily: DailyPoint[]; height?: number }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null);

  const W = 960;
  const H = height;
  const PAD = { top: 12, right: 8, bottom: 28, left: 76 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const totals = daily.map((d) => d.shopify + d.tiktok + d.meli);
  const max = Math.max(...totals, 1);

  const pow = Math.pow(10, Math.floor(Math.log10(max)));
  const yMax = Math.ceil(max / pow) * pow;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * yMax);

  const n = daily.length;
  const slot = plotW / Math.max(n, 1);
  const barW = Math.max(3, Math.min(28, slot - 2));
  const y = (v: number) => PAD.top + plotH - (v / yMax) * plotH;

  const hasData = totals.some((t) => t > 0);

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.floor((px - PAD.left) / slot);
    if (i >= 0 && i < n) {
      setHover({ i, x: e.clientX - rect.left, y: e.clientY - rect.top });
    } else {
      setHover(null);
    }
  }

  return (
    <div className="chart-box" ref={boxRef}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label="Gráfico de faturamento diário por canal"
      >
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(t)}
              y2={y(t)}
              stroke={t === 0 ? "var(--baseline)" : "var(--grid)"}
              strokeWidth={1}
            />
            <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill="var(--text-muted)">
              {brlShort(t)}
            </text>
          </g>
        ))}

        {daily.map((d, i) => {
          const x = PAD.left + i * slot + (slot - barW) / 2;
          const segs: { v: number; color: string }[] = [
            { v: d.shopify, color: "var(--c-shopify)" },
            { v: d.tiktok, color: "var(--c-tiktok)" },
            { v: d.meli, color: "var(--c-meli)" },
          ];
          let acc = 0;
          const total = d.shopify + d.tiktok + d.meli;
          return (
            <g key={d.date}>
              {segs.map((s, si) => {
                if (s.v <= 0) return null;
                const y0 = y(acc);
                const y1 = y(acc + s.v);
                acc += s.v;
                const isTop = acc === total;
                const h = Math.max(y0 - y1, 1);
                return (
                  <path
                    key={si}
                    d={
                      isTop && h > 4
                        ? `M ${x} ${y0} L ${x} ${y1 + 4} Q ${x} ${y1} ${x + 4} ${y1} L ${x + barW - 4} ${y1} Q ${x + barW} ${y1} ${x + barW} ${y1 + 4} L ${x + barW} ${y0} Z`
                        : `M ${x} ${y0} L ${x} ${y1} L ${x + barW} ${y1} L ${x + barW} ${y0} Z`
                    }
                    fill={s.color}
                    stroke="var(--surface-1)"
                    strokeWidth={si > 0 ? 2 : 0}
                  />
                );
              })}
              {hover?.i === i && total > 0 && (
                <rect
                  x={x - 2}
                  y={y(total) - 2}
                  width={barW + 4}
                  height={y(0) - y(total) + 2}
                  fill="none"
                  stroke="var(--text-muted)"
                  strokeWidth={1}
                  rx={5}
                />
              )}
            </g>
          );
        })}

        {daily.map((d, i) => {
          const every = n > 60 ? 14 : n > 14 ? 7 : n > 7 ? 2 : 1;
          if (i % every !== 0) return null;
          return (
            <text
              key={d.date}
              x={PAD.left + i * slot + slot / 2}
              y={H - 8}
              textAnchor="middle"
              fontSize={11}
              fill="var(--text-muted)"
            >
              {fmtDay(d.date)}
            </text>
          );
        })}

        {!hasData && (
          <text x={W / 2} y={H / 2} textAnchor="middle" fontSize={13} fill="var(--text-muted)">
            Sem vendas no período
          </text>
        )}
      </svg>

      {hover && (
        <div
          className="tooltip"
          style={{
            left: Math.min(hover.x + 14, (boxRef.current?.clientWidth ?? 400) - 180),
            top: Math.max(hover.y - 90, 0),
          }}
        >
          <div className="t-date">{fmtDay(daily[hover.i].date)}</div>
          {CHANNEL_ORDER.map((id) => (
            <div key={id} className="t-row">
              <span>
                <span className="ch-dot" style={{ background: CHANNEL_META[id].cssVar }} />
                {CHANNEL_META[id].name}
              </span>
              <b>{brl.format(daily[hover.i][id])}</b>
            </div>
          ))}
          <div className="t-row" style={{ marginTop: 4 }}>
            <span>Total</span>
            <b>{brl.format(daily[hover.i].shopify + daily[hover.i].tiktok + daily[hover.i].meli)}</b>
          </div>
        </div>
      )}
    </div>
  );
}
