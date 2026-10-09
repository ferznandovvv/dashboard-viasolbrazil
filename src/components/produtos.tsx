"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { type Period, buildPresets, spToday } from "@/lib/periodos";
import { fmtDay } from "@/components/viz";

interface Linha {
  produto: string;
  vendidas: number;
  vendasPorLoja: Record<string, number>;
  porLoja: Record<string, number>;
}

interface Resposta {
  modo: "busca" | "vendidos";
  lojas: string[];
  estoqueEm: string;
  estoqueIncompleto: boolean;
  erro?: string;
  itens: Linha[];
  total: number;
  from?: string;
  to?: string;
  lojasSel?: string[];
  top?: number;
  vendasIncompletas?: boolean;
  ignorados?: { produto: string; vendidas: number }[];
}

type Aba = "busca" | "vendidos";

/** Períodos que fazem sentido para decidir reposição. */
const PERIODOS = ["Ontem", "Últimos 7 dias", "Mês atual", "Mês passado"];
const TOPS = [20, 50, 100];

/** Nomes curtos no topo das colunas, para as 8 lojas caberem sem rolar. */
const CURTO: Record<string, string> = {
  "Loja de Fábrica": "Fábrica",
  "Rio de Janeiro": "RJ",
  "Ribeirão Preto": "RP",
  "SP — Itaim": "SP",
  "Belo Horizonte": "BH",
  "Praia Grande": "PG",
};
const curto = (loja: string) => CURTO[loja] ?? loja;

/** Saldo somado das lojas escolhidas (ou de todas, sem escolha). */
function saldoEm(l: Linha, lojas: string[]): number {
  return lojas.reduce((s, loja) => s + (l.porLoja[loja] ?? 0), 0);
}

/**
 * Destaque pelo que importa: quem TEM peça aparece forte; zero e negativo
 * (divergência de inventário) ficam apagados, para não roubar a atenção.
 */
const tom = (v: number) => (v > 0 ? "tem" : v === 0 ? "vazio" : "negativo");

/** Vendeu mais do que tem: precisa repor. */
function precisaRepor(l: Linha, lojas: string[]): boolean {
  return saldoEm(l, lojas) < l.vendidas;
}

/**
 * Produtos e estoque, de dois jeitos:
 *  - Buscar produto: parte do nome → saldo de agora em todas as lojas
 *  - Mais vendidos: loja(s) e período → o que mais saiu, com o saldo ao lado
 */
export function Produtos() {
  const presets = useMemo(() => buildPresets().filter((p) => PERIODOS.includes(p.key)), []);
  const [aba, setAba] = useState<Aba>("busca");
  const [q, setQ] = useState("");
  const [periodo, setPeriodo] = useState<Period>(
    () => presets.find((p) => p.key === "Mês passado") ?? presets[0]
  );
  const [customAberto, setCustomAberto] = useState(false);
  const [customDe, setCustomDe] = useState("");
  const [customAte, setCustomAte] = useState("");
  const [lojasSel, setLojasSel] = useState<string[]>([]);
  const [top, setTop] = useState(20);
  const [soRepor, setSoRepor] = useState(false);
  const [dados, setDados] = useState<Resposta | null>(null);
  const [lojas, setLojas] = useState<string[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [falha, setFalha] = useState("");
  const [ordem, setOrdem] = useState<{ col: string; desc: boolean } | null>(null);
  const [pronto, setPronto] = useState(false);
  const pedido = useRef(0);

  const consultar = async (qs: string) => {
    const id = ++pedido.current;
    setCarregando(true);
    setFalha("");
    try {
      const r = await fetch(`/api/produtos?${qs}`, { cache: "no-store" });
      const j = (await r.json()) as Resposta;
      if (id !== pedido.current) return;
      setDados(j);
      if (j.lojas?.length) setLojas(j.lojas);
      setOrdem(null);
    } catch {
      if (id === pedido.current) setFalha("Não consegui buscar agora. Tente de novo.");
    } finally {
      if (id === pedido.current) setCarregando(false);
    }
  };

  const verMaisVendidos = (p = periodo, ls = lojasSel, t = top) => {
    setAba("vendidos");
    consultar(
      `modo=vendidos&from=${p.from}&to=${p.to}&top=${t}` +
        (ls.length ? `&lojas=${encodeURIComponent(ls.join(","))}` : "")
    );
  };

  // Lista das lojas para os filtros (a consulta vazia só devolve isso)
  useEffect(() => {
    fetch("/api/produtos?modo=busca", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: Resposta) => j.lojas?.length && setLojas(j.lojas))
      .catch(() => {});
  }, []);

  // Recarregar a página volta para a mesma consulta
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const lsUrl = (p.get("lojas") ?? "").split(",").filter(Boolean);
    const tUrl = Number(p.get("top")) || 20;
    const de = p.get("de") ?? "";
    const ate = p.get("ate") ?? "";
    const perUrl =
      presets.find((x) => x.key === p.get("periodo")) ??
      (de && ate ? { key: "custom", from: de, to: ate } : null);
    if (lsUrl.length) setLojasSel(lsUrl);
    setTop(tUrl);
    if (perUrl) setPeriodo(perUrl);
    if (p.get("aba") === "vendidos") verMaisVendidos(perUrl ?? periodo, lsUrl, tUrl);
    else if (p.get("q")) setQ(p.get("q") ?? "");
    setPronto(true);
    // só na montagem
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!pronto) return;
    const p = new URLSearchParams();
    p.set("aba", aba);
    if (aba === "busca") {
      if (q.trim()) p.set("q", q.trim());
    } else {
      if (periodo.key === "custom") {
        p.set("de", periodo.from);
        p.set("ate", periodo.to);
      } else p.set("periodo", periodo.key);
      if (lojasSel.length) p.set("lojas", lojasSel.join(","));
      p.set("top", String(top));
    }
    window.history.replaceState(null, "", `?${p.toString()}`);
  }, [pronto, aba, q, periodo, lojasSel, top]);

  // Busca por nome é instantânea (filtra a foto do estoque): vai enquanto digita
  useEffect(() => {
    if (!pronto || aba !== "busca") return;
    const termo = q.trim();
    if (termo.length < 2) {
      setDados(null);
      return;
    }
    const t = setTimeout(() => consultar(`modo=busca&q=${encodeURIComponent(termo)}`), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, aba, pronto]);

  const trocarAba = (a: Aba) => {
    if (a === aba) return;
    pedido.current++; // descarta resposta em voo da outra aba
    setCarregando(false);
    setDados(null);
    setSoRepor(false);
    setAba(a);
  };

  const alternarLoja = (loja: string) =>
    setLojasSel((atual) => (atual.includes(loja) ? atual.filter((x) => x !== loja) : [...atual, loja]));

  const ordenar = (col: string) =>
    setOrdem((o) => ({ col, desc: o?.col === col ? !o.desc : true }));
  const seta = (col: string) => (ordem?.col === col ? (ordem.desc ? " ↓" : " ↑") : "");

  const colunasLojas = lojas.length ? lojas : dados?.lojas ?? [];
  const escolhidas = dados?.modo === "vendidos" ? dados.lojasSel ?? [] : [];
  const posicao = new Map((dados?.itens ?? []).map((l, i) => [l.produto, i + 1]));

  const lista = (() => {
    if (!dados) return [];
    let itens = dados.itens;
    if (dados.modo === "vendidos" && soRepor && escolhidas.length)
      itens = itens.filter((l) => precisaRepor(l, escolhidas));
    if (!ordem) return itens;
    const valor = (l: Linha): number | string =>
      ordem.col === "produto"
        ? l.produto
        : ordem.col === "vendidas"
          ? l.vendidas
          : ordem.col === "sel"
            ? saldoEm(l, escolhidas)
            : l.porLoja[ordem.col.slice(5)] ?? 0;
    return [...itens].sort((a, b) => {
      const va = valor(a);
      const vb = valor(b);
      const c = typeof va === "string" ? va.localeCompare(vb as string, "pt-BR") : va - (vb as number);
      return ordem.desc ? -c : c;
    });
  })();

  const baixarCSV = () => {
    if (!dados) return;
    const vend = dados.modo === "vendidos";
    const cab = [
      ...(vend ? ["Posição"] : []),
      "Produto",
      ...(vend ? ["Vendidas"] : []),
      ...(vend && escolhidas.length ? [`Estoque ${escolhidas.join(" + ")}`] : []),
      ...colunasLojas,
    ];
    const corpo = lista.map((l) => [
      ...(vend ? [String(posicao.get(l.produto) ?? "")] : []),
      `"${l.produto.replace(/"/g, '""')}"`,
      ...(vend ? [String(l.vendidas)] : []),
      ...(vend && escolhidas.length ? [String(saldoEm(l, escolhidas))] : []),
      ...colunasLojas.map((loja) => String(l.porLoja[loja] ?? 0)),
    ]);
    const csv = [cab, ...corpo].map((r) => r.join(";")).join("\n");
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = vend
      ? `mais-vendidos-${escolhidas.join("-") || "todas"}-${dados.from}-a-${dados.to}.csv`
      : `estoque-${q.trim() || "busca"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const nomePeriodo =
    periodo.key === "custom" ? `${fmtDay(periodo.from)} a ${fmtDay(periodo.to)}` : periodo.key;

  return (
    <div>
      <div className="seg abas-prod" role="tablist">
        <button className={aba === "busca" ? "on" : ""} onClick={() => trocarAba("busca")}>
          Buscar produto
        </button>
        <button className={aba === "vendidos" ? "on" : ""} onClick={() => trocarAba("vendidos")}>
          Mais vendidos
        </button>
      </div>

      {aba === "busca" ? (
        <>
          <input
            className="busca"
            autoFocus
            placeholder="Digite parte do nome (ex.: bolsa lari, top maresias)"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <div className="rank-aviso" style={{ margin: "4px 0 0" }}>
            Mostra o estoque de agora em todas as lojas, cada cor e tamanho numa linha.
          </div>
        </>
      ) : (
        <>
          <div className="passo">
            <span className="passo-num">1</span> Loja <span className="muted">(nenhuma = todas)</span>
          </div>
          <div className="filters" role="group" aria-label="Lojas">
            {colunasLojas.map((loja) => (
              <button
                key={loja}
                className={lojasSel.includes(loja) ? "active" : ""}
                onClick={() => alternarLoja(loja)}
              >
                {loja}
              </button>
            ))}
          </div>

          <div className="passo">
            <span className="passo-num">2</span> Vendas de quando
          </div>
          <div className="filters" role="group" aria-label="Período">
            {presets.map((p) => (
              <button
                key={p.key}
                className={periodo.key === p.key ? "active" : ""}
                onClick={() => {
                  setCustomAberto(false);
                  setPeriodo(p);
                }}
              >
                {p.key}
              </button>
            ))}
            <button
              className={periodo.key === "custom" ? "active" : ""}
              onClick={() => setCustomAberto((v) => !v)}
            >
              Personalizado
            </button>
          </div>
          {customAberto && (
            <div className="custom-range">
              <input type="date" value={customDe} max={spToday()} onChange={(e) => setCustomDe(e.target.value)} />
              <span className="muted">até</span>
              <input type="date" value={customAte} max={spToday()} onChange={(e) => setCustomAte(e.target.value)} />
              <button
                className="apply"
                disabled={!customDe || !customAte || customDe > customAte}
                onClick={() => {
                  setPeriodo({ key: "custom", from: customDe, to: customAte });
                  setCustomAberto(false);
                }}
              >
                Aplicar
              </button>
            </div>
          )}

          <div className="passo">
            <span className="passo-num">3</span> Quantos produtos
          </div>
          <div className="seg" role="group" aria-label="Quantos">
            {TOPS.map((t) => (
              <button key={t} className={top === t ? "on" : ""} onClick={() => setTop(t)}>
                {t} mais vendidos
              </button>
            ))}
          </div>

          <button className="buscar" onClick={() => verMaisVendidos()} disabled={carregando}>
            {carregando ? "Buscando as vendas…" : "Ver os mais vendidos"}
          </button>
          {carregando && (
            <div className="rank-aviso" style={{ margin: "6px 0 0" }}>
              Na primeira vez que um período é pedido, a TOTVS demora alguns minutos para mandar as
              vendas. Depois ele fica guardado e abre na hora.
            </div>
          )}
        </>
      )}

      {falha && <div className="card err-msg">{falha}</div>}
      {aba === "busca" && carregando && !dados && <div className="empty">Buscando…</div>}

      {dados && (
        <div style={{ opacity: carregando ? 0.6 : 1, marginTop: 16 }}>
          {dados.erro && <div className="card err-msg">{dados.erro}</div>}
          {dados.estoqueIncompleto && (
            <div className="parcial">
              A foto do estoque ainda está sendo montada (são quase 18 mil produtos) — pode faltar
              produto. Tente de novo em 1 ou 2 minutos, até este aviso sumir.
            </div>
          )}
          {dados.vendasIncompletas && (
            <div className="parcial">
              Ainda faltam dias de venda nesse período — a TOTVS não mandou tudo a tempo. Clique em
              ver de novo em 1 ou 2 minutos.
            </div>
          )}

          <div className="card">
            {dados.modo === "vendidos" ? (
              <div className="goal-head">
                <h2>
                  {dados.top} mais vendidos · {escolhidas.length ? escolhidas.join(" + ") : "todas as lojas"}
                </h2>
                <span className="muted">
                  {nomePeriodo}
                  {dados.from && dados.to && ` (${fmtDay(dados.from)} a ${fmtDay(dados.to)})`}
                </span>
              </div>
            ) : (
              <div className="goal-head">
                <h2>{dados.total.toLocaleString("pt-BR")} variações com estoque</h2>
                {dados.total > dados.itens.length && (
                  <span className="muted">mostrando as primeiras {dados.itens.length} — refine a busca</span>
                )}
              </div>
            )}

            {dados.modo === "vendidos" && (dados.ignorados?.length ?? 0) > 0 && (
              <div className="rank-aviso" style={{ margin: "0 0 10px" }}>
                Fora da lista por enquanto:{" "}
                {dados.ignorados!.map((i) => `${i.produto} (${i.vendidas})`).join(", ")}
              </div>
            )}

            {dados.modo === "vendidos" && escolhidas.length > 0 && (
              <label className="so-repor">
                <input type="checkbox" checked={soRepor} onChange={(e) => setSoRepor(e.target.checked)} />
                Só o que precisa repor (vendeu mais do que tem em {escolhidas.join(" + ")})
              </label>
            )}

            {lista.length === 0 ? (
              <div className="empty">
                {dados.modo === "busca" ? "Nenhum produto com estoque com esse nome." : "Nada para mostrar."}
              </div>
            ) : (
              <div className="tbl-wrap">
                <table className="prod-tbl">
                  <thead>
                    <tr>
                      <th className="ord" onClick={() => ordenar("produto")}>
                        Produto{seta("produto")}
                      </th>
                      {dados.modo === "vendidos" && (
                        <th className="n ord" onClick={() => ordenar("vendidas")}>
                          Vendidas{seta("vendidas")}
                        </th>
                      )}
                      {dados.modo === "vendidos" && escolhidas.length > 0 && (
                        <th className="n ord col-sel" onClick={() => ordenar("sel")}>
                          Estoque {escolhidas.length === 1 ? curto(escolhidas[0]) : "escolhidas"}
                          {seta("sel")}
                        </th>
                      )}
                      {colunasLojas.map((loja) => (
                        <th key={loja} className="n ord" title={loja} onClick={() => ordenar(`loja:${loja}`)}>
                          {curto(loja)}
                          {seta(`loja:${loja}`)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {lista.map((l) => {
                      const saldoSel = saldoEm(l, escolhidas);
                      const repor = dados.modo === "vendidos" && escolhidas.length > 0 && saldoSel < l.vendidas;
                      return (
                        <tr key={l.produto}>
                          <td>
                            {dados.modo === "vendidos" && (
                              <span className="pos">{posicao.get(l.produto)}º</span>
                            )}
                            {l.produto}
                          </td>
                          {dados.modo === "vendidos" && <td className="n">{l.vendidas}</td>}
                          {dados.modo === "vendidos" && escolhidas.length > 0 && (
                            <td className={`n col-sel ${tom(saldoSel)}`}>
                              {repor && <span className="repor-tag">repor</span>}
                              {saldoSel}
                            </td>
                          )}
                          {colunasLojas.map((loja) => {
                            const v = l.porLoja[loja] ?? 0;
                            return (
                              <td
                                key={loja}
                                className={`n ${tom(v)}`}
                              >
                                {v}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {lista.length > 0 && (
              <button className="exportar" onClick={baixarCSV}>
                Baixar em planilha ({lista.length} linhas)
              </button>
            )}
            <div className="rank-aviso" style={{ margin: "12px 0 0" }}>
              {dados.estoqueEm && (
                <>
                  Estoque de{" "}
                  {new Date(dados.estoqueEm).toLocaleString("pt-BR", {
                    day: "2-digit",
                    month: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                    timeZone: "America/Sao_Paulo",
                  })}
                  , em peças, de todas as lojas.{" "}
                </>
              )}
              {dados.modo === "vendidos" &&
                "Vendidas = peças vendidas no período nas lojas escolhidas. \"repor\" = tem menos do que vendeu."}
              {" "}Clique no nome de uma coluna para ordenar.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
