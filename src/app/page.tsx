"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import type { ChannelId, DailyPoint, DashboardData } from "@/lib/types";
import { CHANNEL_META, DailyChart, brl, corDaLoja, fmtDay } from "@/components/viz";

type Period = { key: string; from: string; to: string };

/** Unidades selecionadas: "Site" e/ou nomes de lojas. Vazio = visão geral. */
type Canal = "shopify" | "tiktok" | "meli";

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

/** Tempo do dia a partir do código WMO. */
function tempoIcone(codigo: number): string {
  if (codigo === 0) return "☀️";
  if (codigo <= 2) return "🌤️";
  if (codigo === 3) return "☁️";
  if (codigo <= 48) return "🌫️";
  if (codigo <= 67) return "🌧️";
  if (codigo <= 77) return "🌨️";
  if (codigo <= 82) return "🌦️";
  return "⛈️";
}

/** Correlação simples (Pearson) entre duas séries. */
function correlacao(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 3) return 0;
  const mA = a.reduce((s, v) => s + v, 0) / n;
  const mB = b.reduce((s, v) => s + v, 0) / n;
  let num = 0, dA = 0, dB = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - mA) * (b[i] - mB);
    dA += (a[i] - mA) ** 2;
    dB += (b[i] - mB) ** 2;
  }
  return dA && dB ? num / Math.sqrt(dA * dB) : 0;
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
  const [sel, setSel] = useState<string[]>([]);
  const [canal, setCanal] = useState<Canal | "">("");
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState("");
  const [editandoMeta, setEditandoMeta] = useState(false);
  const [metaInput, setMetaInput] = useState("");
  const [metasLocais, setMetasLocais] = useState<Record<string, number>>({});
  const [porLoja, setPorLoja] = useState(true);
  const [agrup, setAgrup] = useState<"modelo" | "cor" | "tamanho" | "completo">("modelo");
  const [cache] = useState<Map<string, DashboardData>>(() => new Map());
  // Identifica a última busca pedida: respostas atrasadas de filtros antigos
  // não podem sobrescrever o filtro atual
  const pedidoAtual = useRef(0);

  const soSite = sel.length === 1 && sel[0] === "Site";
  const unidade = sel.length === 1 ? sel[0] : "";
  const alternar = (nome: string) => {
    setCanal("");
    setSel((atual) =>
      atual.includes(nome) ? atual.filter((x) => x !== nome) : [...atual, nome]
    );
  };

  useEffect(() => {
    try {
      setMetasLocais(JSON.parse(localStorage.getItem("metas") ?? "{}"));
    } catch {
      /* sem metas locais */
    }
  }, []);

  const load = useCallback(
    async (p: Period, unidades: string[], ch: string) => {
      const qs =
        `from=${p.from}&to=${p.to}` +
        (unidades.length ? `&units=${encodeURIComponent(unidades.join(","))}` : "") +
        (ch ? `&channel=${ch}` : "");
      const id = ++pedidoAtual.current;
      // Mostra na hora o que já foi visto e revalida em segundo plano
      const salvo = cache.get(qs);
      if (salvo) setData(salvo);
      setLoading(true);
      setFetchError("");

      // Etapa rápida: canais online primeiro, para a tela sair do "carregando"
      // enquanto as lojas físicas ainda estão sendo buscadas
      if (!salvo) {
        fetch(`/api/dashboard?${qs}&sem=lojas`, { cache: "no-store" })
          .then((r) => (r.ok ? r.json() : null))
          .then((parcial: DashboardData | null) => {
            if (parcial && id === pedidoAtual.current && !cache.has(qs)) setData(parcial);
          })
          .catch(() => {
            /* a busca completa logo abaixo é quem manda */
          });
      }

      try {
        const res = await fetch(`/api/dashboard?${qs}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`Erro ${res.status}`);
        const json = (await res.json()) as DashboardData;
        cache.set(qs, json);
        if (id === pedidoAtual.current) setData(json);
      } catch {
        if (!salvo && id === pedidoAtual.current)
          setFetchError(
            "As lojas físicas não responderam a tempo. O que está na tela pode estar incompleto — recarregue a página."
          );
      } finally {
        if (id === pedidoAtual.current) setLoading(false);
      }
    },
    [cache]
  );

  const selKey = sel.join(",");
  useEffect(() => {
    load(period, selKey ? selKey.split(",") : [], canal);
  }, [period, selKey, canal, load]);

  // Aquece os períodos que costumam ser os próximos cliques, sem travar a tela
  useEffect(() => {
    if (loading) return;
    const alvos = presets.filter((p) => p.key !== period.key).slice(0, 5);
    let cancelado = false;
    const timer = setTimeout(async () => {
      // Um de cada vez: em paralelo o pré-carregamento competiria com a tela
      for (const p of alvos) {
        if (cancelado) return;
        const qs =
          `from=${p.from}&to=${p.to}` +
          (selKey ? `&units=${encodeURIComponent(selKey)}` : "") +
          (canal ? `&channel=${canal}` : "");
        if (cache.has(qs)) continue;
        try {
          const r = await fetch(`/api/dashboard?${qs}`, { cache: "no-store" });
          if (r.ok) cache.set(qs, (await r.json()) as DashboardData);
        } catch {
          /* pré-carregamento é oportunista: falhou, o clique busca de novo */
        }
      }
    }, 1500);
    return () => {
      cancelado = true;
      clearTimeout(timer);
    };
  }, [loading, period, selKey, canal, presets, cache]);

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
    load(period, sel, canal);
  }

  const querSite = sel.length === 0 || sel.includes("Site");
  const online = (data?.channels ?? []).filter((c) => c.channel !== "lojas");
  const siteRevenue = online.reduce((s, c) => s + c.revenue, 0);
  const sitePrev = online.reduce((s, c) => s + c.prevRevenue, 0);
  const siteOrders = online.reduce((s, c) => s + c.orders, 0);
  const lojasCh = data?.channels.find((c) => c.channel === "lojas");

  // Séries do gráfico conforme a unidade em foco
  const serieDaUnidade = (u: string) =>
    u === "Site"
      ? { key: "site", label: "Site (online)", color: "var(--c-shopify)" }
      : { key: `loja:${u}`, label: u, color: corDaLoja(u) };

  const chartSeries = (() => {
    if (canal)
      return [{ key: canal, label: CHANNEL_META[canal].name, color: CHANNEL_META[canal].cssVar }];
    if (soSite)
      return ONLINE.map((c) => ({
        key: c,
        label: CHANNEL_META[c].name,
        color: CHANNEL_META[c].cssVar,
      }));
    if (sel.length > 0) return sel.map(serieDaUnidade);
    if (porLoja)
      return [
        { key: "site", label: "Site (online)", color: "var(--c-shopify)" },
        ...(data?.stores ?? []).map((l) => ({
          key: `loja:${l.name}`,
          label: l.name,
          color: corDaLoja(l.name),
        })),
      ];
    return [
      { key: "site", label: "Site (online)", color: "var(--c-shopify)" },
      { key: "lojas", label: "Lojas físicas", color: "var(--c-lojas)" },
    ];
  })();
  const dailySeries: DailyPoint[] = (data?.daily ?? []).map((d) => ({
    ...d,
    site: d.shopify + d.tiktok + d.meli,
  }));

  const spendSeries = (() => {
    if (!data) return undefined;
    const fontes: { date: string; spend: number }[][] = [];
    if (data.ads.connected && soSite && (!canal || canal === "shopify"))
      fontes.push(data.ads.daily);
    if (data.tiktokAds.connected && soSite && (!canal || canal === "tiktok"))
      fontes.push(data.tiktokAds.daily);
    if (fontes.length === 0) return undefined;
    const m = new Map<string, number>();
    for (const src of fontes) for (const d of src) m.set(d.date, (m.get(d.date) ?? 0) + d.spend);
    return Array.from(m.entries()).map(([date, spend]) => ({ date, spend }));
  })();

  const maxProd = Math.max(
    ...((data?.products?.[agrup] ?? data?.topProducts ?? []).map((p) => p.revenue) ?? [0]),
    1
  );
  const maxState = Math.max(...(data?.states.map((s) => s.revenue) ?? [0]), 1);

  /**
   * Ranking de vendedoras — mesmo card na home (todas as lojas) e no detalhe
   * de uma loja selecionada.
   */
  const cardVendedoras = () => {
    const todas = data?.sellers ?? [];
    if (todas.length === 0) return null;
    const lista = todas;
    const maior = Math.max(...todas.map((x) => x.revenue), 1);
    const semNome = (v: { name: string }) => v.name.startsWith("Sem vendedora no caixa");
    // Quanto do faturamento das lojas ficou sem dono
    const semDono = todas.filter(semNome).reduce((s, v) => s + v.revenue, 0);
    const totalLojas = todas.reduce((s, v) => s + v.revenue, 0);
    return (
      <div className="card">
        <h2>Ranking de vendedoras</h2>
        {semDono > 0 && (
          <div className="rank-aviso">
            {((semDono / totalLojas) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%
            do faturamento das lojas saiu do caixa sem vendedora registrada
          </div>
        )}
        <div className="rank">
          {lista.map((v, i) => (
            <div
              key={v.name}
              className={`rank-row${semNome(v) ? " anon" : ""}`}
              title={v.stores.join(", ")}
            >
              <div className="rank-info">
                <span className="rank-title">
                  {semNome(v) ? "Sem vendedora" : `${i + 1}º ${v.name}`}
                </span>
                <span className="rank-nums">
                  {v.orders} vendas · <b>{brl.format(v.revenue)}</b>
                </span>
              </div>
              <div className="rank-bar">
                <div
                  className="rank-fill"
                  style={{
                    width: `${(v.revenue / maior) * 100}%`,
                    background: semNome(v)
                      ? "var(--text-muted)"
                      : v.stores.length === 1
                        ? corDaLoja(v.stores[0])
                        : "var(--brand)",
                  }}
                />
              </div>
              <span className="rank-sub">
                {v.stores.length === 1 ? `${v.stores[0]} · ` : `${v.stores.join(", ")} · `}
                ticket {brl.format(v.avgTicket)} · {v.avgPieces.toFixed(1)} peças/venda
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  };

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
      </div>

      {customOpen && (
        <div className="custom-range">
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
        </div>
      )}

      {fetchError && <div className="card">{fetchError}</div>}
      {loading && !data && <div className="empty">Carregando…</div>}
      {data?.partial && (
        <div className="parcial">Lojas físicas ainda carregando — os números abaixo são só do site.</div>
      )}

      {data && (
        <div style={{ opacity: loading ? 0.6 : 1 }}>
          {sel.length > 0 && (
            <div className="unit-head">
              <h1>{canal ? CHANNEL_META[canal].name : sel.join(" + ")}</h1>
              <button
                className="back"
                onClick={() => {
                  setSel([]);
                  setCanal("");
                }}
              >
                limpar filtro ✕
              </button>
            </div>
          )}

          {sel.length > 0 && (
          <div className="tiles">
            <div className="tile">
              <div className="label">Faturamento</div>
              <div className="value">{brl.format(data.totals.revenue)}</div>
              <Delta now={data.totals.revenue} before={data.prevTotals.revenue} />
            </div>
            <div className="tile">
              <div className="label">{soSite ? "Pedidos" : "Vendas"}</div>
              <div className="value">{data.totals.orders.toLocaleString("pt-BR")}</div>
              <Delta now={data.totals.orders} before={data.prevTotals.orders} />
            </div>
            <div className="tile">
              <div className="label">Ticket médio</div>
              <div className="value">{brl.format(data.totals.avgTicket)}</div>
              <Delta now={data.totals.avgTicket} before={data.prevTotals.avgTicket} />
            </div>
            {data.totals.pieces > 0 && (
              <div className="tile">
                <div className="label">Peças por venda</div>
                <div className="value">
                  {data.totals.avgPieces.toLocaleString("pt-BR", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </div>
                <span className="muted" style={{ fontSize: 12 }}>
                  {data.totals.pieces.toLocaleString("pt-BR")} peças
                </span>{" "}
                <Delta now={data.totals.avgPieces} before={data.prevTotals.avgPieces} />
              </div>
            )}
            {data.totals.discount > 0 && (
              <div className="tile">
                <div className="label">Descontos</div>
                <div className="value">{brl.format(data.totals.discount)}</div>
                <span className="muted" style={{ fontSize: 12 }}>
                  {(
                    (data.totals.discount / (data.totals.revenue + data.totals.discount)) *
                    100
                  ).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}
                  % do bruto
                </span>
              </div>
            )}
          </div>
          )}

          {/* ——— Unidades: sempre visíveis, funcionam como filtro ——— */}
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
          ) : null}

          <div className="channels stores">
            {[
              {
                nome: "Site",
                cor: "var(--c-shopify)",
                receita: siteRevenue,
                anterior: sitePrev,
                pedidos: siteOrders,
                rotulo: "pedidos",
              },
              ...data.stores.map((l) => ({
                nome: l.name,
                cor: corDaLoja(l.name),
                receita: l.revenue,
                anterior: l.prevRevenue,
                pedidos: l.orders,
                rotulo: "vendas",
              })),
            ].map((u) => {
              const ativo = sel.includes(u.nome);
              return (
                <div
                  key={u.nome}
                  className={`channel-card clickable${ativo ? " sel" : ""}${
                    sel.length > 0 && !ativo ? " dim" : ""
                  }`}
                  style={{ ["--ch-color" as string]: u.cor }}
                  onClick={() => alternar(u.nome)}
                  title={ativo ? "Clique para tirar do filtro" : "Clique para somar ao filtro"}
                >
                  <div className="head">
                    <span className="name">
                      <span className="ch-dot" style={{ background: u.cor }} />
                      {u.nome}
                    </span>
                    {ativo && <span className="badge sel-badge">✕</span>}
                  </div>
                  <div className="rev">
                    {brl.format(u.receita)} <Delta now={u.receita} before={u.anterior} />
                  </div>
                  <div className="meta">
                    {u.pedidos.toLocaleString("pt-BR")} {u.rotulo}
                    {u.pedidos > 0 && <> · ticket {brl.format(u.receita / u.pedidos)}</>}
                  </div>
                  <MetaMini feito={data.monthByUnit[u.nome] ?? 0} meta={metaDe(u.nome)} />
                </div>
              );
            })}
          </div>

          <div className="card">
            <div className="goal-head">
              <h2>Faturamento por dia</h2>
              {sel.length === 0 && (
                <button className="mini ghost" onClick={() => setPorLoja((v) => !v)}>
                  {porLoja ? "agrupar lojas" : "ver por loja"}
                </button>
              )}
            </div>
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

          {sel.length === 0 && cardVendedoras()}

          {/* ——— Detalhe da seleção ——— */}
          {sel.length > 0 && (
            <>
              {unidade && (
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
                      {(() => {
                        const hoje = spToday();
                        const [y, m, d] = hoje.split("-").map(Number);
                        const diasNoMes = new Date(y, m, 0).getDate();
                        const restam = diasNoMes - d + 1;
                        const falta = metaDe(unidade) - (data.monthByUnit[unidade] ?? 0);
                        if (falta <= 0)
                          return (
                            <b style={{ color: "var(--good)" }}>
                              {" "}
                              · meta batida, {brl.format(-falta)} acima 🎉
                            </b>
                          );
                        const porDia = falta / restam;
                        const feitoPorDia = (data.monthByUnit[unidade] ?? 0) / d;
                        return (
                          <>
                            {" "}
                            · faltam <b>{brl.format(falta)}</b> em {restam}{" "}
                            {restam === 1 ? "dia" : "dias"} ={" "}
                            <b
                              style={{
                                color: porDia <= feitoPorDia ? "var(--good)" : "var(--critical)",
                              }}
                            >
                              {brl.format(porDia)}/dia
                            </b>{" "}
                            <span className="muted">
                              (ritmo atual: {brl.format(feitoPorDia)}/dia)
                            </span>
                          </>
                        );
                      })()}
                    </div>
                  </>
                )}
              </div>
              )}

              {soSite && (
                <div className="channels">
                  {ONLINE.map((id) => {
                    const c = data.channels.find((x) => x.channel === id);
                    const meta = CHANNEL_META[id];
                    if (!c) return null;
                    const ativo = canal === id;
                    return (
                      <div
                        key={id}
                        className={`channel-card clickable${ativo ? " sel" : ""}${
                          canal && !ativo ? " dim" : ""
                        }`}
                        style={{ ["--ch-color" as string]: meta.cssVar }}
                        onClick={() => setCanal(ativo ? "" : id)}
                      >
                        <div className="head">
                          <span className="name">
                            <span className="ch-dot" style={{ background: meta.cssVar }} />
                            {meta.name}
                          </span>
                          {ativo ? (
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

              <div className="grid-2">
                <div className="card">
                  <div className="goal-head">
                    <h2>Produtos mais vendidos</h2>
                    <span className="seg">
                      {(["modelo", "cor", "tamanho", "completo"] as const).map((g) => (
                        <button
                          key={g}
                          className={agrup === g ? "on" : ""}
                          onClick={() => setAgrup(g)}
                        >
                          {g === "modelo"
                            ? "Modelo"
                            : g === "cor"
                              ? "Cor"
                              : g === "tamanho"
                                ? "Tamanho"
                                : "Completo"}
                        </button>
                      ))}
                    </span>
                  </div>
                  {(data.products?.[agrup] ?? data.topProducts).length === 0 ? (
                    <div className="empty">Sem itens no período.</div>
                  ) : (
                    <div className="rank">
                      {(data.products?.[agrup] ?? data.topProducts).map((p) => (
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
                                background:
                                  unidade && unidade !== "Site"
                                    ? corDaLoja(unidade)
                                    : CHANNEL_META[p.channel as ChannelId].cssVar,
                              }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {cardVendedoras()}

                {querSite && data.affiliates?.shipments > 0 && (
                  <div className="card">
                    <h2>Envios para afiliadas (TikTok)</h2>
                    <div className="tiles tiles-2">
                      <div className="tile">
                        <div className="label">Envios</div>
                        <div className="value">
                          {data.affiliates.shipments.toLocaleString("pt-BR")}
                        </div>
                        <Delta
                          now={data.affiliates.shipments}
                          before={data.affiliates.prevShipments}
                        />
                      </div>
                      <div className="tile">
                        <div className="label">Peças enviadas</div>
                        <div className="value">
                          {data.affiliates.pieces.toLocaleString("pt-BR")}
                        </div>
                      </div>
                    </div>
                    {data.affiliates.products.length > 0 && (
                      <div className="rank" style={{ marginTop: 12 }}>
                        {data.affiliates.products.map((p) => (
                          <div key={p.title} className="rank-row" title={p.title}>
                            <div className="rank-info">
                              <span className="rank-title">{p.title}</span>
                              <span className="rank-nums">
                                <b>{p.qty}</b> peças
                              </span>
                            </div>
                            <div className="rank-bar">
                              <div
                                className="rank-fill"
                                style={{
                                  width: `${(p.qty / Math.max(...data.affiliates.products.map((x) => x.qty), 1)) * 100}%`,
                                  background: "var(--c-tiktok)",
                                }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="rank-aviso" style={{ margin: "12px 0 0" }}>
                      Pedidos de R$ 0,00 não entram no faturamento nem no ticket médio.
                    </div>
                  </div>
                )}

                {data.payments.length > 1 && (
                  <div className="card">
                    <h2>Formas de pagamento</h2>
                    <div className="rank">
                      {data.payments.map((pg) => (
                        <div key={pg.name} className="rank-row">
                          <div className="rank-info">
                            <span className="rank-title">{pg.name}</span>
                            <span className="rank-nums">
                              {pg.orders} · <b>{brl.format(pg.revenue)}</b>
                            </span>
                          </div>
                          <div className="rank-bar">
                            <div
                              className="rank-fill"
                              style={{
                                width: `${(pg.revenue / Math.max(...data.payments.map((x) => x.revenue), 1)) * 100}%`,
                                background: "var(--c-tiktok)",
                              }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {querSite && (
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

              {data.weather.length > 0 && (() => {
                const porData = new Map(
                  dailySeries.map((d) => [
                    d.date,
                    chartSeries.reduce((t, se) => t + Number(d[se.key] ?? 0), 0),
                  ])
                );
                const dias = data.weather.filter((w) => porData.has(w.date));
                if (dias.length < 5) return null;

                // Cada dia entra em exatamente uma categoria
                const categoria = (w: (typeof dias)[0]) =>
                  w.chuva >= 1 || w.codigo >= 51 ? "chuva" : w.codigo <= 1 ? "sol" : "nublado";

                // Sábado vende mais que terça: comparamos cada dia com a média
                // do mesmo dia da semana, para o tempo não levar a culpa/crédito
                const semana = new Map<number, number[]>();
                for (const w of dias) {
                  const dow = new Date(`${w.date}T12:00:00-03:00`).getDay();
                  semana.set(dow, [...(semana.get(dow) ?? []), porData.get(w.date) ?? 0]);
                }
                const mediaDow = new Map(
                  Array.from(semana.entries()).map(([dow, vs]) => [
                    dow,
                    vs.reduce((a, b) => a + b, 0) / vs.length,
                  ])
                );

                const grupos = (["sol", "nublado", "chuva"] as const).map((cat) => {
                  const ds = dias.filter((w) => categoria(w) === cat);
                  const valores = ds.map((w) => porData.get(w.date) ?? 0);
                  const indices = ds.map((w) => {
                    const dow = new Date(`${w.date}T12:00:00-03:00`).getDay();
                    const base = mediaDow.get(dow) ?? 0;
                    return base > 0 ? (porData.get(w.date) ?? 0) / base : 1;
                  });
                  return {
                    cat,
                    dias: ds.length,
                    media: valores.length
                      ? valores.reduce((a, b) => a + b, 0) / valores.length
                      : 0,
                    indice: indices.length
                      ? indices.reduce((a, b) => a + b, 0) / indices.length
                      : 1,
                  };
                });

                const corrTemp = correlacao(
                  dias.map((w) => w.tmax),
                  dias.map((w) => porData.get(w.date) ?? 0)
                );
                const sol = grupos.find((g) => g.cat === "sol")!;
                const chuva = grupos.find((g) => g.cat === "chuva")!;
                const rotulo = { sol: "☀️ Sol", nublado: "☁️ Nublado", chuva: "🌧️ Chuva" };
                const confiavel = sol.dias >= 3 && chuva.dias >= 3;

                return (
                  <div className="card">
                    <h2>Tempo × vendas</h2>
                    <div className="weather-row">
                      {dias.slice(-28).map((w) => (
                        <span
                          key={w.date}
                          className="wday"
                          title={`${fmtDay(w.date)} · ${w.tmax.toFixed(0)}°C · ${w.chuva.toFixed(
                            1
                          )}mm · ${brl.format(porData.get(w.date) ?? 0)}`}
                        >
                          <span className="ic">{tempoIcone(w.codigo)}</span>
                          {w.tmax.toFixed(0)}°
                        </span>
                      ))}
                    </div>
                    <div className="wcorr">
                      {grupos.map((g) => (
                        <span className="item" key={g.cat}>
                          <span className="k">{rotulo[g.cat]}</span>
                          <span className="n">{g.dias > 0 ? brl.format(g.media) : "—"}</span>
                          <span className="muted" style={{ fontSize: 11 }}>
                            média por dia · {g.dias} {g.dias === 1 ? "dia" : "dias"}
                            {g.dias >= 3 && (
                              <>
                                {" "}
                                ·{" "}
                                <b style={{ color: g.indice >= 1 ? "var(--good)" : "var(--critical)" }}>
                                  {g.indice >= 1 ? "+" : ""}
                                  {((g.indice - 1) * 100).toLocaleString("pt-BR", {
                                    maximumFractionDigits: 0,
                                  })}
                                  %
                                </b>{" "}
                                vs. o normal do dia da semana
                              </>
                            )}
                          </span>
                        </span>
                      ))}
                    </div>
                    <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>
                      {confiavel ? (
                        <>
                          Ajustado pelo dia da semana, dia de sol rende{" "}
                          <b>
                            {(((sol.indice - chuva.indice) / chuva.indice) * 100).toLocaleString(
                              "pt-BR",
                              { maximumFractionDigits: 0 }
                            )}
                            %
                          </b>{" "}
                          {sol.indice >= chuva.indice ? "a mais" : "a menos"} que dia de chuva.{" "}
                        </>
                      ) : (
                        <>
                          Poucos dias de cada tipo no período ({sol.dias} de sol, {chuva.dias} de
                          chuva) — escolha um período maior para a comparação ficar confiável.{" "}
                        </>
                      )}
                      Correlação entre temperatura e faturamento: <b>{corrTemp.toFixed(2)}</b>
                      {Math.abs(corrTemp) < 0.3
                        ? " (fraca)"
                        : corrTemp > 0
                          ? " — calor puxa as vendas para cima"
                          : " — vende mais no frio"}
                      .
                    </p>
                  </div>
                );
              })()}

              {data.hours.length > 0 && (() => {
                const maxH = Math.max(...data.hours.map((h) => h.revenue), 1);
                const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
                const mapa = new Map(data.hours.map((h) => [`${h.dow}-${h.hour}`, h]));
                const horas = Array.from({ length: 24 }, (_, i) => i).filter((h) =>
                  data.hours.some((x) => x.hour === h)
                );
                const hMin = Math.min(...horas, 8);
                const hMax = Math.max(...horas, 20);
                const faixa = Array.from({ length: hMax - hMin + 1 }, (_, i) => hMin + i);
                return (
                  <div className="card">
                    <h2>Horários de pico</h2>
                    <div className="heat-wrap">
                    <div
                      className="heat"
                      style={{ gridTemplateColumns: `34px repeat(${faixa.length}, 1fr)` }}
                    >
                      <span />
                      {faixa.map((h) => (
                        <span key={h} className="hh">
                          {h % 3 === 0 ? h : ""}
                        </span>
                      ))}
                      {DIAS.map((nome, dow) => (
                        <Fragment key={nome}>
                          <span className="lbl">{nome}</span>
                          {faixa.map((h) => {
                            const c = mapa.get(`${dow}-${h}`);
                            const int = c ? c.revenue / maxH : 0;
                            return (
                              <span
                                key={`${dow}-${h}`}
                                className="cell"
                                style={{
                                  background:
                                    int > 0
                                      ? `color-mix(in srgb, var(--brand) ${Math.round(
                                          15 + int * 85
                                        )}%, transparent)`
                                      : undefined,
                                }}
                                title={
                                  c
                                    ? `${nome} ${h}h · ${c.orders} vendas · ${brl.format(c.revenue)}`
                                    : `${nome} ${h}h · sem vendas`
                                }
                              />
                            );
                          })}
                        </Fragment>
                      ))}
                    </div>
                    </div>
                  </div>
                );
              })()}

              <div className="card">
                <h2>{soSite ? "Últimos pedidos" : "Últimas vendas"}</h2>
                {data.recentOrders.length === 0 ? (
                  <div className="empty">Nenhuma venda no período.</div>
                ) : (
                  <div className="orders-table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Unidade</th>
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
                                style={{
                                  background: o.store
                                    ? corDaLoja(o.store)
                                    : CHANNEL_META[o.channel].cssVar,
                                }}
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
