"use client";

import { useCallback, useEffect, useState } from "react";
import type { DashboardData } from "@/lib/types";
import {
  CHANNEL_META,
  CHANNEL_ORDER,
  DailyChart,
  SunMark,
  brl,
  fmtDay,
} from "@/components/viz";

type Period = { kind: "days"; days: number } | { kind: "custom"; from: string; to: string };

function Delta({ now, before }: { now: number; before: number }) {
  if (before <= 0) return null;
  const pct = ((now - before) / before) * 100;
  const up = pct >= 0;
  return (
    <span className={`delta ${up ? "up" : "down"}`} title="vs período anterior">
      {up ? "↑" : "↓"} {Math.abs(pct).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%
    </span>
  );
}

export default function Dashboard() {
  const [period, setPeriod] = useState<Period>({ kind: "days", days: 30 });
  const [customOpen, setCustomOpen] = useState(false);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState("");

  const load = useCallback(async (p: Period) => {
    setLoading(true);
    setFetchError("");
    const qs =
      p.kind === "days" ? `days=${p.days}` : `from=${p.from}&to=${p.to}`;
    try {
      const res = await fetch(`/api/dashboard?${qs}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`Erro ${res.status}`);
      setData(await res.json());
    } catch {
      setFetchError("Não foi possível carregar os dados. Tente recarregar a página.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(period);
  }, [period, load]);

  // Redirect das autorizações OAuth: TikTok Shop e Mercado Livre devolvem
  // ?code=... para cá; o state diz de qual plataforma veio.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    if (!code) return;
    const target = params.get("state") === "meli" ? "meli" : "tiktok";
    window.location.replace(`/api/${target}/setup?code=${encodeURIComponent(code)}`);
  }, []);

  const anyConnected = data?.channels.some((c) => c.connected) ?? false;
  const maxState = Math.max(...(data?.states.map((s) => s.revenue) ?? [0]), 1);
  const maxProd = Math.max(...(data?.topProducts.map((p) => p.revenue) ?? [0]), 1);

  return (
    <main className="wrap">
      <div className="topbar">
        <div className="logo">
          <SunMark size={44} />
          <div>
            <span className="word">VIA&nbsp;SOL</span>
            <span className="tag">vendas online</span>
          </div>
        </div>
        {data && (
          <span className="updated">
            {fmtDay(data.from)} – {fmtDay(data.to)} · atualizado{" "}
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
          <button
            key={d}
            className={period.kind === "days" && period.days === d ? "active" : ""}
            onClick={() => {
              setCustomOpen(false);
              setPeriod({ kind: "days", days: d });
            }}
          >
            {d} dias
          </button>
        ))}
        <button
          className={period.kind === "custom" ? "active" : ""}
          onClick={() => setCustomOpen((v) => !v)}
        >
          Personalizado
        </button>
        {customOpen && (
          <span className="custom-range">
            <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
            <span className="muted">até</span>
            <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
            <button
              className="apply"
              disabled={!customFrom || !customTo || customFrom > customTo}
              onClick={() => setPeriod({ kind: "custom", from: customFrom, to: customTo })}
            >
              Aplicar
            </button>
          </span>
        )}
      </div>

      {fetchError && <div className="card">{fetchError}</div>}
      {loading && !data && <div className="empty">Carregando…</div>}

      {data && (
        <div style={{ opacity: loading ? 0.6 : 1 }}>
          <div className="tiles">
            <div className="tile">
              <div className="label">Faturamento</div>
              <div className="value">{brl.format(data.totals.revenue)}</div>
              <Delta now={data.totals.revenue} before={data.prevTotals.revenue} />
            </div>
            <div className="tile">
              <div className="label">Pedidos</div>
              <div className="value">{data.totals.orders.toLocaleString("pt-BR")}</div>
              <Delta now={data.totals.orders} before={data.prevTotals.orders} />
            </div>
            <div className="tile">
              <div className="label">Ticket médio</div>
              <div className="value">{brl.format(data.totals.avgTicket)}</div>
              <Delta now={data.totals.avgTicket} before={data.prevTotals.avgTicket} />
            </div>
          </div>

          {data.goal ? (
            <div className="card goal">
              <div className="goal-head">
                <h2>Meta de {data.goal.monthLabel}</h2>
                <span className="muted">
                  {brl.format(data.goal.monthRevenue)} de {brl.format(data.goal.target)} ·
                  projeção {brl.format(data.goal.projection)}
                </span>
              </div>
              <div className="goal-bar">
                <div
                  className="goal-fill"
                  style={{ width: `${Math.min(data.goal.pct * 100, 100)}%` }}
                />
              </div>
              <div className="goal-pct">
                {(data.goal.pct * 100).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%
                da meta
              </div>
            </div>
          ) : (
            <div className="card goal muted" style={{ fontSize: 12 }}>
              Defina a variável <code>META_MENSAL</code> na Vercel (ex.: 100000) para
              acompanhar a meta do mês aqui.
            </div>
          )}

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
                      <div className="rev">
                        {brl.format(c.revenue)} <Delta now={c.revenue} before={c.prevRevenue} />
                      </div>
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
            <DailyChart daily={data.daily} />
          </div>

          <div className="grid-2">
            <div className="card">
              <h2>Produtos mais vendidos</h2>
              {data.topProducts.length === 0 ? (
                <div className="empty">Sem itens no período.</div>
              ) : (
                <div className="rank">
                  {data.topProducts.map((p) => (
                    <div key={p.title} className="rank-row" title={p.title}>
                      <div className="rank-info">
                        <span className="rank-title">
                          <span className="ch-dot" style={{ background: CHANNEL_META[p.channel].cssVar }} />
                          {p.title}
                        </span>
                        <span className="rank-nums">
                          {p.qty}× · <b>{brl.format(p.revenue)}</b>
                        </span>
                      </div>
                      <div className="rank-bar">
                        <div
                          className="rank-fill"
                          style={{
                            width: `${(p.revenue / maxProd) * 100}%`,
                            background: CHANNEL_META[p.channel].cssVar,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="card">
              <h2>Vendas por estado</h2>
              {data.states.length === 0 ? (
                <div className="empty">Sem dados de entrega no período.</div>
              ) : (
                <div className="rank">
                  {data.states.map((s) => (
                    <div key={s.uf} className="rank-row">
                      <div className="rank-info">
                        <span className="rank-title">{s.uf}</span>
                        <span className="rank-nums">
                          {s.orders} ped. · <b>{brl.format(s.revenue)}</b>
                        </span>
                      </div>
                      <div className="rank-bar">
                        <div
                          className="rank-fill"
                          style={{ width: `${(s.revenue / maxState) * 100}%`, background: "var(--brand)" }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
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
        </div>
      )}
    </main>
  );
}
