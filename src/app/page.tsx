"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChannelId, DashboardData } from "@/lib/types";

const CHANNEL_META: Record<
  ChannelId,
  { name: string; cssVar: string; envVars: string[] }
> = {
  shopify: {
    name: "Shopify",
    cssVar: "var(--c-shopify)",
    envVars: ["SHOPIFY_STORE_DOMAIN", "SHOPIFY_ADMIN_TOKEN"],
  },
  tiktok: {
    name: "TikTok Shop",
    cssVar: "var(--c-tiktok)",
    envVars: ["TIKTOK_APP_KEY", "TIKTOK_APP_SECRET", "TIKTOK_ACCESS_TOKEN", "TIKTOK_SHOP_CIPHER"],
  },
  meli: {
    name: "Mercado Livre",
    cssVar: "var(--c-meli)",
    envVars: ["ML_CLIENT_ID", "ML_CLIENT_SECRET", "ML_REFRESH_TOKEN"],
  },
};

// Ordem fixa de empilhamento/legenda — nunca muda com filtros
const CHANNEL_ORDER: ChannelId[] = ["shopify", "tiktok", "meli"];

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const brlShort = (v: number) =>
  v >= 1000 ? `R$ ${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil` : brl.format(v);

function fmtDay(dateKey: string) {
  const [, m, d] = dateKey.split("-");
  return `${d}/${m}`;
}

export default function Dashboard() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState("");

  const load = useCallback(async (d: number) => {
    setLoading(true);
    setFetchError("");
    try {
      const res = await fetch(`/api/dashboard?days=${d}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`Erro ${res.status}`);
      setData(await res.json());
    } catch {
      setFetchError("Não foi possível carregar os dados. Tente recarregar a página.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(days);
  }, [days, load]);

  const anyConnected = data?.channels.some((c) => c.connected) ?? false;

  return (
    <main className="wrap">
      <div className="topbar">
        <h1>
          Via Sol Brazil <span>· vendas online</span>
        </h1>
        {data && (
          <span className="updated">
            Atualizado{" "}
            {new Date(data.generatedAt).toLocaleTimeString("pt-BR", {
              hour: "2-digit",
              minute: "2-digit",
              timeZone: "America/Sao_Paulo",
            })}
          </span>
        )}
      </div>

      <div className="filters" role="group" aria-label="Período">
        {[7, 30, 90].map((d) => (
          <button key={d} className={d === days ? "active" : ""} onClick={() => setDays(d)}>
            {d} dias
          </button>
        ))}
      </div>

      {fetchError && <div className="card">{fetchError}</div>}
      {loading && !data && <div className="empty">Carregando…</div>}

      {data && (
        <>
          <div className="tiles">
            <div className="tile">
              <div className="label">Faturamento ({data.days} dias)</div>
              <div className="value">{brl.format(data.totals.revenue)}</div>
            </div>
            <div className="tile">
              <div className="label">Pedidos</div>
              <div className="value">{data.totals.orders.toLocaleString("pt-BR")}</div>
            </div>
            <div className="tile">
              <div className="label">Ticket médio</div>
              <div className="value">{brl.format(data.totals.avgTicket)}</div>
            </div>
          </div>

          <div className="channels">
            {CHANNEL_ORDER.map((id) => {
              const c = data.channels.find((x) => x.channel === id);
              const meta = CHANNEL_META[id];
              if (!c) return null;
              return (
                <div key={id} className="channel-card" style={{ ["--ch-color" as string]: meta.cssVar }}>
                  <div className="head">
                    <span className="name">
                      <span className="ch-dot" style={{ background: meta.cssVar }} />
                      {meta.name}
                    </span>
                    {!c.connected ? (
                      <span className="badge">não conectado</span>
                    ) : c.error ? (
                      <span className="badge err">erro</span>
                    ) : (
                      <span className="badge on">conectado</span>
                    )}
                  </div>
                  {c.connected ? (
                    <>
                      <div className="rev">{brl.format(c.revenue)}</div>
                      <div className="meta">{c.orders.toLocaleString("pt-BR")} pedidos no período</div>
                      {c.error && <div className="err-msg">{c.error}</div>}
                    </>
                  ) : (
                    <div className="setup">
                      Para conectar, adicione nas variáveis de ambiente do projeto:
                      {meta.envVars.map((v) => (
                        <div key={v}>
                          <code>{v}</code>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="card">
            <h2>Faturamento por dia</h2>
            <div className="legend">
              {CHANNEL_ORDER.map((id) => (
                <span key={id} className="item">
                  <span className="swatch" style={{ background: CHANNEL_META[id].cssVar }} />
                  {CHANNEL_META[id].name}
                </span>
              ))}
            </div>
            <DailyChart data={data} />
          </div>

          <div className="card">
            <h2>Últimos pedidos</h2>
            {data.recentOrders.length === 0 ? (
              <div className="empty">
                {anyConnected
                  ? "Nenhum pedido no período."
                  : "Conecte pelo menos um canal para ver os pedidos aqui."}
              </div>
            ) : (
              <div className="orders-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Canal</th>
                      <th>Pedido</th>
                      <th>Data</th>
                      <th>Cliente</th>
                      <th>Status</th>
                      <th className="num">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recentOrders.map((o) => (
                      <tr key={`${o.channel}-${o.id}`}>
                        <td>
                          <span className="ch-dot" style={{ background: CHANNEL_META[o.channel].cssVar }} />
                          {CHANNEL_META[o.channel].name}
                        </td>
                        <td>{o.label}</td>
                        <td className="muted">
                          {new Date(o.createdAt).toLocaleString("pt-BR", {
                            day: "2-digit",
                            month: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                            timeZone: "America/Sao_Paulo",
                          })}
                        </td>
                        <td>{o.customer ?? <span className="muted">—</span>}</td>
                        <td className="muted">{o.status.toLowerCase()}</td>
                        <td className="num">{brl.format(o.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </main>
  );
}

function DailyChart({ data }: { data: DashboardData }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null);

  const W = 960;
  const H = 280;
  const PAD = { top: 12, right: 8, bottom: 28, left: 76 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const daily = data.daily;
  const totals = daily.map((d) => d.shopify + d.tiktok + d.meli);
  const max = Math.max(...totals, 1);

  // Escala com teto "redondo"
  const pow = Math.pow(10, Math.floor(Math.log10(max)));
  const yMax = Math.ceil(max / pow) * pow;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * yMax);

  const n = daily.length;
  const slot = plotW / n;
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
            <text
              x={PAD.left - 8}
              y={y(t) + 4}
              textAnchor="end"
              fontSize={11}
              fill="var(--text-muted)"
            >
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
            Sem vendas no período — conecte um canal para ver o gráfico
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
            <b>
              {brl.format(daily[hover.i].shopify + daily[hover.i].tiktok + daily[hover.i].meli)}
            </b>
          </div>
        </div>
      )}
    </div>
  );
}
