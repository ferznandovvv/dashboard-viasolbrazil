"use client";

import { useCallback, useEffect, useState } from "react";
import type { ChannelId, DashboardData } from "@/lib/types";
import { CHANNEL_META, DailyChart, brl, fmtDay } from "@/components/viz";

type Period = { key: string; from: string; to: string };

/** Unidade em foco: a empresa toda, o site (online) ou uma loja física. */
type View =
  | { tipo: "tudo" }
  | { tipo: "site" }
  | { tipo: "canal"; ch: "shopify" | "tiktok" | "meli" }
  | { tipo: "loja"; nome: string };

const ONLINE: ("shopify" | "tiktok" | "meli")[] = ["shopify", "tiktok", "meli"];

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
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
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
    { key: "Ontem", from: shiftDays(today, -1), to: shiftDays(today, -1) },
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

function AdsInline({
  label,
  ads,
}: {
  label: string;
  ads: { spend: number; roas: number; cpa: number; error?: string };
}) {
  return (
    <div className="invest-note">
      <div>
        {label}: <b>{brl.format(ads.spend)}</b>
      </div>
      <div className="muted">
        {ads.spend > 0 && (
          <>ROAS {ads.roas.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}×</>
        )}
        {ads.cpa > 0 && <> · {brl.format(ads.cpa)} por pedido</>}
      </div>
      {ads.error && <div className="err-msg">{ads.error}</div>}
    </div>
  );
}

/** Barrinha de meta do mês usada nos cards da home. */
function MetaMini({ feito, meta }: { feito: number; meta: number }) {
  if (!(meta > 0)) return null;
  const pct = feito / meta;
  return (
    <div className="meta-mini" title={`${brl.format(feito)} de ${brl.format(meta)} no mês`}>
      <div className="meta-mini-bar">
        <div className="meta-mini-fill" style={{ width: `${Math.min(pct * 100, 100)}%` }} />
      </div>
      <span>{(pct * 100).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}% da meta</span>
    </div>
  );
}

export default function Dashboard() {
  const [presets] = useState(buildPresets);
  const [period, setPeriod] = useState<Period>(presets[3]); // padrão: Mês atual
  const [customOpen, setCustomOpen] = useState(false);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [view, setView] = useState<View>({ tipo: "tudo" });
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState("");
  const [editandoMeta, setEditandoMeta] = useState(false);
  const [metaInput, setMetaInput] = useState("");
  const [metasLocais, setMetasLocais] = useState<Record<string, number>>({});

  const channel = view.tipo === "canal" ? view.ch : view.tipo === "loja" ? "lojas" : "";
  const store = view.tipo === "loja" ? view.nome : "";
  const unidade = view.tipo === "loja" ? view.nome : view.tipo === "tudo" ? "" : "Site";

  useEffect(() => {
    try {
      setMetasLocais(JSON.parse(localStorage.getItem("metas") ?? "{}"));
    } catch {
      /* sem metas locais */
    }
  }, []);

  const load = useCallback(async (p: Period, ch: string, st: string) => {
    setLoading(true);
    setFetchError("");
    const qs =
      `from=${p.from}&to=${p.to}` +
      (ch ? `&channel=${ch}` : "") +
      (st ? `&store=${encodeURIComponent(st)}` : "");
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
    load(period, channel, store);
  }, [period, channel, store, load]);

  // Redirect das autorizações OAuth (TikTok Shop, TikTok Ads e Mercado Livre)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const authCode = params.get("auth_code");
    if (authCode) {
      window.location.replace(`/api/tiktok-ads/setup?auth_code=${encodeURIComponent(authCode)}`);
      return;
    }
    const code = params.get("code");
    if (!code) return;
    const target = params.get("state") === "meli" ? "meli" : "tiktok";
    window.location.replace(`/api/${target}/setup?code=${encodeURIComponent(code)}`);
  }, []);

  const metaDe = (u: string) => data?.metas[u] ?? metasLocais[u] ?? 0;

  async function salvarMeta(u: string) {
    const v = parseFloat(metaInput.replace(/\./g, "").replace(",", "."));
    if (!(v >= 0)) return;
    setEditandoMeta(false);
    try {
      const res = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ unidade: u, meta: v }),
      });
      const json = await res.json().catch(() => ({}));
      if (!json.persisted) throw new Error("sem blob");
    } catch {
      const novas = { ...metasLocais, [u]: v };
      setMetasLocais(novas);
      localStorage.setItem("metas", JSON.stringify(novas));
    }
    load(period, channel, store);
  }

  const online = (data?.channels ?? []).filter((c) => c.channel !== "lojas");
  const siteRevenue = online.reduce((s, c) => s + c.revenue, 0);
  const sitePrev = online.reduce((s, c) => s + c.prevRevenue, 0);
  const siteOrders = online.reduce((s, c) => s + c.orders, 0);
  const lojasCh = data?.channels.find((c) => c.channel === "lojas");

  // Séries do gráfico conforme a unidade em foco
  const chartSeries = (() => {
    if (view.tipo === "canal")
      return [
        { key: view.ch, label: CHANNEL_META[view.ch].name, color: CHANNEL_META[view.ch].cssVar },
      ];
    if (view.tipo === "loja")
      return [{ key: `loja:${view.nome}`, label: view.nome, color: "var(--c-lojas)" }];
    if (view.tipo === "site")
      return ONLINE.map((c) => ({
        key: c,
        label: CHANNEL_META[c].name,
        color: CHANNEL_META[c].cssVar,
      }));
    return [
      { key: "site", label: "Site (online)", color: "var(--c-shopify)" },
      { key: "lojas", label: "Lojas físicas", color: "var(--c-lojas)" },
    ];
  })();
  const dailySeries = (data?.daily ?? []).map((d) =>
    view.tipo === "tudo" ? { ...d, site: d.shopify + d.tiktok + d.meli } : d
  );

  const spendSeries = (() => {
    if (!data) return undefined;
    const fontes: { date: string; spend: number }[][] = [];
    if (
      data.ads.connected &&
      (view.tipo === "site" || (view.tipo === "canal" && view.ch === "shopify"))
    )
      fontes.push(data.ads.daily);
    if (
      data.tiktokAds.connected &&
      (view.tipo === "site" || (view.tipo === "canal" && view.ch === "tiktok"))
    )
      fontes.push(data.tiktokAds.daily);
    if (fontes.length === 0) return undefined;
    const m = new Map<string, number>();
    for (const src of fontes) for (const d of src) m.set(d.date, (m.get(d.date) ?? 0) + d.spend);
    return Array.from(m.entries()).map(([date, spend]) => ({ date, spend }));
  })();

  const maxProd = Math.max(...(data?.topProducts.map((p) => p.revenue) ?? [0]), 1);
  const maxState = Math.max(...(data?.states.map((s) => s.revenue) ?? [0]), 1);

  return (
    <main className="wrap">
      <div className="topbar">
        <div className="logo">
          <div>
            <span className="brand-word" role="img" aria-label="Via Sol" />
            <span className="tag">vendas</span>
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
          {view.tipo !== "tudo" && (
            <div className="unit-head">
              <button className="back" onClick={() => setView({ tipo: "tudo" })}>
                ← Todas as unidades
              </button>
              <h1>
                {view.tipo === "loja"
                  ? view.nome
                  : view.tipo === "canal"
                    ? CHANNEL_META[view.ch].name
                    : "Site — vendas online"}
              </h1>
            </div>
          )}

          <div className="tiles">
            <div className="tile">
              <div className="label">Faturamento</div>
              <div className="value">{brl.format(data.totals.revenue)}</div>
              <Delta now={data.totals.revenue} before={data.prevTotals.revenue} />
            </div>
            <div className="tile">
              <div className="label">{view.tipo === "loja" ? "Vendas" : "Pedidos"}</div>
              <div className="value">{data.totals.orders.toLocaleString("pt-BR")}</div>
              <Delta now={data.totals.orders} before={data.prevTotals.orders} />
            </div>
            <div className="tile">
              <div className="label">Ticket médio</div>
              <div className="value">{brl.format(data.totals.avgTicket)}</div>
              <Delta now={data.totals.avgTicket} before={data.prevTotals.avgTicket} />
            </div>
          </div>

          {/* ——— HOME: só as unidades e o gráfico ——— */}
          {view.tipo === "tudo" && (
            <>
              <div className="channels" style={{ gridTemplateColumns: "1fr" }}>
                <div
                  className="channel-card clickable"
                  style={{ ["--ch-color" as string]: "var(--c-shopify)" }}
                  onClick={() => setView({ tipo: "site" })}
                >
                  <div className="head">
                    <span className="name">
                      <span className="ch-dot" style={{ background: "var(--c-shopify)" }} />
                      Site — vendas online
                    </span>
                    <span className="badge sel-badge">abrir →</span>
                  </div>
                  <div className="rev">
                    {brl.format(siteRevenue)} <Delta now={siteRevenue} before={sitePrev} />
                  </div>
                  <div className="meta">
                    {siteOrders.toLocaleString("pt-BR")} pedidos
                    {siteOrders > 0 && <> · ticket {brl.format(siteRevenue / siteOrders)}</>}
                  </div>
                  <MetaMini feito={data.monthByUnit.Site ?? 0} meta={metaDe("Site")} />
                </div>
              </div>

              {lojasCh && !lojasCh.connected ? (
                <div className="card muted" style={{ fontSize: 12 }}>
                  Lojas físicas não conectadas — configure{" "}
                  {CHANNEL_META.lojas.envVars.map((v) => (
                    <code key={v}>{v}</code>
                  ))}
                </div>
              ) : lojasCh?.error ? (
                <div className="card">
                  <div className="err-msg">Lojas físicas: {lojasCh.error}</div>
                </div>
              ) : (
                <div className="channels stores">
                  {data.stores.map((loja) => (
                    <div
                      key={loja.name}
                      className="channel-card clickable"
                      style={{ ["--ch-color" as string]: "var(--c-lojas)" }}
                      onClick={() => setView({ tipo: "loja", nome: loja.name })}
                    >
                      <div className="head">
                        <span className="name">
                          <span className="ch-dot" style={{ background: "var(--c-lojas)" }} />
                          {loja.name}
                        </span>
                      </div>
                      <div className="rev">
                        {brl.format(loja.revenue)}{" "}
                        <Delta now={loja.revenue} before={loja.prevRevenue} />
                      </div>
                      <div className="meta">
                        {loja.orders.toLocaleString("pt-BR")} vendas
                        {loja.orders > 0 && <> · ticket {brl.format(loja.revenue / loja.orders)}</>}
                      </div>
                      <MetaMini feito={data.monthByUnit[loja.name] ?? 0} meta={metaDe(loja.name)} />
                    </div>
                  ))}
                </div>
              )}

              <div className="card">
                <h2>Faturamento por dia</h2>
                <div className="legend">
                  {chartSeries.map((se) => (
                    <span key={se.key} className="item">
                      <span className="swatch" style={{ background: se.color }} />
                      {se.label}
                    </span>
                  ))}
                </div>
                <DailyChart daily={dailySeries} series={chartSeries} />
              </div>
            </>
          )}

          {/* ——— DETALHE: site, canal ou loja ——— */}
          {view.tipo !== "tudo" && (
            <>
              <div className="card goal">
                <div className="goal-head">
                  <h2>Meta de {data.goal?.monthLabel ?? "este mês"}</h2>
                  <span className="muted">
                    {editandoMeta ? (
                      <span className="goal-edit">
                        <input
                          autoFocus
                          inputMode="numeric"
                          placeholder="ex.: 80000"
                          value={metaInput}
                          onChange={(e) => setMetaInput(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && salvarMeta(unidade)}
                        />
                        <button className="mini" onClick={() => salvarMeta(unidade)}>
                          Salvar
                        </button>
                        <button className="mini ghost" onClick={() => setEditandoMeta(false)}>
                          Cancelar
                        </button>
                      </span>
                    ) : (
                      <>
                        {brl.format(data.monthByUnit[unidade] ?? 0)}
                        {metaDe(unidade) > 0 && <> de {brl.format(metaDe(unidade))}</>} no mês{" "}
                        <button
                          className="mini ghost"
                          onClick={() => {
                            setMetaInput(metaDe(unidade) > 0 ? String(metaDe(unidade)) : "");
                            setEditandoMeta(true);
                          }}
                        >
                          {metaDe(unidade) > 0 ? "editar meta" : "definir meta"}
                        </button>
                      </>
                    )}
                  </span>
                </div>
                {metaDe(unidade) > 0 && (
                  <>
                    <div className="goal-bar">
                      <div
                        className="goal-fill"
                        style={{
                          width: `${Math.min(
                            ((data.monthByUnit[unidade] ?? 0) / metaDe(unidade)) * 100,
                            100
                          )}%`,
                        }}
                      />
                    </div>
                    <div className="goal-pct">
                      {(((data.monthByUnit[unidade] ?? 0) / metaDe(unidade)) * 100).toLocaleString(
                        "pt-BR",
                        { maximumFractionDigits: 0 }
                      )}
                      % da meta de {unidade}
                    </div>
                  </>
                )}
              </div>

              {(view.tipo === "site" || view.tipo === "canal") && (
                <div className="channels">
                  {ONLINE.map((id) => {
                    const c = data.channels.find((x) => x.channel === id);
                    const meta = CHANNEL_META[id];
                    if (!c) return null;
                    const sel = view.tipo === "canal" && view.ch === id;
                    return (
                      <div
                        key={id}
                        className={`channel-card clickable${sel ? " sel" : ""}${
                          view.tipo === "canal" && !sel ? " dim" : ""
                        }`}
                        style={{ ["--ch-color" as string]: meta.cssVar }}
                        onClick={() => setView(sel ? { tipo: "site" } : { tipo: "canal", ch: id })}
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
                              {brl.format(c.revenue)}{" "}
                              <Delta now={c.revenue} before={c.prevRevenue} />
                            </div>
                            <div className="meta">
                              {c.orders.toLocaleString("pt-BR")} pedidos
                              {c.orders > 0 && <> · ticket {brl.format(c.revenue / c.orders)}</>}
                            </div>
                            {id === "shopify" && data.ads.connected && (
                              <AdsInline label="Anúncios (Meta)" ads={data.ads} />
                            )}
                            {id === "tiktok" && data.tiktokAds.connected && (
                              <AdsInline label="Anúncios (TikTok)" ads={data.tiktokAds} />
                            )}
                            {c.error && <div className="err-msg">{c.error}</div>}
                          </>
                        ) : (
                          <div className="setup">
                            Para conectar, adicione nas variáveis de ambiente:
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
              )}

              <div className="card">
                <h2>Faturamento por dia</h2>
                <div className="legend">
                  {chartSeries.map((se) => (
                    <span key={se.key} className="item">
                      <span className="swatch" style={{ background: se.color }} />
                      {se.label}
                    </span>
                  ))}
                  {spendSeries && (
                    <span className="item">
                      <span className="swatch spend-swatch" />
                      Gasto anúncios
                    </span>
                  )}
                </div>
                <DailyChart daily={dailySeries} series={chartSeries} spend={spendSeries} />
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
                            <span className="rank-title">{p.title}</span>
                            <span className="rank-nums">
                              {p.qty}× · <b>{brl.format(p.revenue)}</b>
                            </span>
                          </div>
                          <div className="rank-bar">
                            <div
                              className="rank-fill"
                              style={{
                                width: `${(p.revenue / maxProd) * 100}%`,
                                background: CHANNEL_META[p.channel as ChannelId].cssVar,
                              }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {view.tipo !== "loja" && (
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
                                style={{
                                  width: `${(s.revenue / maxState) * 100}%`,
                                  background: "var(--brand)",
                                }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="card">
                <h2>{view.tipo === "loja" ? "Últimas vendas" : "Últimos pedidos"}</h2>
                {data.recentOrders.length === 0 ? (
                  <div className="empty">Nenhuma venda no período.</div>
                ) : (
                  <div className="orders-table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>{view.tipo === "loja" ? "Loja" : "Canal"}</th>
                          <th>Pedido</th>
                          <th>Data</th>
                          <th>Cliente</th>
                          <th className="num">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.recentOrders.map((o) => (
                          <tr key={`${o.channel}-${o.id}`}>
                            <td>
                              <span
                                className="ch-dot"
                                style={{ background: CHANNEL_META[o.channel].cssVar }}
                              />
                              {o.store ?? CHANNEL_META[o.channel].name}
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
        </div>
      )}
    </main>
  );
}
