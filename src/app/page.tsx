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

type Period = { key: string; from: string; to: string };

/** Data de hoje no fuso de São Paulo (YYYY-MM-DD), calculada no navegador. */
function spToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function shiftDays(dateKey: string, n: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

function buildPresets(): Period[] {
  const today = spToday();
  const [y, m] = today.split("-").map(Number);
  const pad = (n: number) => String(n).padStart(2, "0");
  const prevM = m === 1 ? 12 : m - 1;
  const prevY = m === 1 ? y - 1 : y;
  const lastDayPrev = new Date(y, m - 1, 0).getDate();
  return [
    { key: "Hoje", from: today, to: today },
    { key: "Últimos 7 dias", from: shiftDays(today, -6), to: today },
    { key: "Mês atual", from: `${y}-${pad(m)}-01`, to: today },
    {
      key: "Mês passado",
      from: `${prevY}-${pad(prevM)}-01`,
      to: `${prevY}-${pad(prevM)}-${pad(lastDayPrev)}`,
    },
    { key: "Últimos 3 meses", from: shiftDays(today, -89), to: today },
    { key: "Ano atual", from: `${y}-01-01`, to: today },
  ];
}

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
  const [presets] = useState(buildPresets);
  const [period, setPeriod] = useState<Period>(presets[0]); // padrão: Hoje
  const [customOpen, setCustomOpen] = useState(false);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [channel, setChannel] = useState<"" | "shopify" | "tiktok" | "meli">("");
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState("");
  // Meta editável na tela
  const [editingGoal, setEditingGoal] = useState(false);
  const [goalInput, setGoalInput] = useState("");
  const [localGoal, setLocalGoal] = useState(0);

  useEffect(() => {
    const v = parseFloat(localStorage.getItem("metaMensal") ?? "");
    if (v > 0) setLocalGoal(v);
  }, []);

  const load = useCallback(async (p: Period, ch: string) => {
    setLoading(true);
    setFetchError("");
    const qs = `from=${p.from}&to=${p.to}${ch ? `&channel=${ch}` : ""}`;
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
    load(period, channel);
  }, [period, channel, load]);

  async function saveGoal() {
    const v = parseFloat(goalInput.replace(/\./g, "").replace(",", "."));
    if (!(v >= 0)) return;
    setEditingGoal(false);
    try {
      const res = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ metaMensal: v }),
      });
      const json = await res.json().catch(() => ({}));
      if (!json.persisted) {
        localStorage.setItem("metaMensal", String(v));
        setLocalGoal(v);
      }
    } catch {
      localStorage.setItem("metaMensal", String(v));
      setLocalGoal(v);
    }
    load(period, channel);
  }

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
        {presets.map((p) => (
          <button
            key={p.key}
            className={period.key === p.key ? "active" : ""}
            onClick={() => {
              setCustomOpen(false);
              setPeriod(p);
            }}
          >
            {p.key}
          </button>
        ))}
        <button
          className={period.key === "custom" ? "active" : ""}
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
              onClick={() => setPeriod({ key: "custom", from: customFrom, to: customTo })}
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

          {data.goal && (() => {
            const target = data.goal.target > 0 ? data.goal.target : localGoal;
            const pct = target > 0 ? data.goal.monthRevenue / target : 0;
            return (
              <div className="card goal">
                <div className="goal-head">
                  <h2>Meta de {data.goal.monthLabel}</h2>
                  <span className="muted">
                    {editingGoal ? (
                      <span className="goal-edit">
                        <input
                          autoFocus
                          inputMode="numeric"
                          placeholder="ex.: 150000"
                          value={goalInput}
                          onChange={(e) => setGoalInput(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && saveGoal()}
                        />
                        <button className="mini" onClick={saveGoal}>Salvar</button>
                        <button className="mini ghost" onClick={() => setEditingGoal(false)}>
                          Cancelar
                        </button>
                      </span>
                    ) : (
                      <>
                        {target > 0 ? (
                          <>
                            {brl.format(data.goal.monthRevenue)} de {brl.format(target)} ·
                            projeção {brl.format(data.goal.projection)}{" "}
                          </>
                        ) : (
                          <>
                            {brl.format(data.goal.monthRevenue)} no mês ·
                            projeção {brl.format(data.goal.projection)}{" "}
                          </>
                        )}
                        <button
                          className="mini ghost"
                          onClick={() => {
                            setGoalInput(target > 0 ? String(target) : "");
                            setEditingGoal(true);
                          }}
                        >
                          {target > 0 ? "editar meta" : "definir meta"}
                        </button>
                      </>
                    )}
                  </span>
                </div>
                {target > 0 && (
                  <>
                    <div className="goal-bar">
                      <div className="goal-fill" style={{ width: `${Math.min(pct * 100, 100)}%` }} />
                    </div>
                    <div className="goal-pct">
                      {(pct * 100).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}% da meta
                    </div>
                  </>
                )}
              </div>
            );
          })()}

          <div className="channels">
            {CHANNEL_ORDER.map((id) => {
              const c = data.channels.find((x) => x.channel === id);
              const meta = CHANNEL_META[id];
              if (!c) return null;
              const sel = channel === id;
              const dim = channel !== "" && !sel;
              return (
                <div
                  key={id}
                  className={`channel-card clickable${sel ? " sel" : ""}${dim ? " dim" : ""}`}
                  style={{ ["--ch-color" as string]: meta.cssVar }}
                  onClick={() => setChannel(sel ? "" : id)}
                  title={sel ? "Clique para ver todos os canais" : `Clique para filtrar por ${meta.name}`}
                >
                  <div className="head">
                    <span className="name">
                      <span className="ch-dot" style={{ background: meta.cssVar }} />
                      {meta.name}
                    </span>
                    {sel ? (
                      <span className="badge sel-badge">filtrando ✕</span>
                    ) : !c.connected ? (
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
            <h2>
              Faturamento por dia
              {channel && (
                <span className="filter-note"> — só {CHANNEL_META[channel].name}</span>
              )}
            </h2>
            <div className="legend">
              {(channel ? [channel] : CHANNEL_ORDER).map((id) => (
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
