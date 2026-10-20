"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { type Period, buildPresets } from "@/lib/periodos";
import { fmtDay } from "@/components/viz";
import { Abas } from "@/components/Abas";
import { usePode, useSessao } from "@/components/sessao";
import { lojasDaTabela } from "@/lib/tabelasDePreco";
import { SeletorPeriodo } from "@/components/SeletorPeriodo";

interface Linha {
  produto: string;
  vendidas: number;
  vendasPorLoja: Record<string, number>;
  porLoja: Record<string, number>;
  precos?: Record<string, number>;
}

interface Resposta {
  modo: "busca" | "vendidos";
  lojas: string[];
  /** Tabelas de preço, já na ordem da tela (Site, Franca, RP) */
  tabelas?: string[];
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

/** "A, B e C" */
const juntar = (l: string[]) => (l.length > 1 ? `${l.slice(0, -1).join(", ")} e ${l[l.length - 1]}` : l[0] ?? "");

/** Preço sem "R$", para as colunas caberem. */
const preco = (v?: number) =>
  v ? v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—";

/**
 * Destaque pelo que importa: quem TEM peça aparece forte; zero e negativo
 * (divergência de inventário) ficam apagados, para não roubar a atenção.
 */
const tom = (v: number) => (v > 0 ? "tem" : v === 0 ? "vazio" : "negativo");

/**
 * Produtos e estoque, de dois jeitos:
 *  - Buscar produto: parte do nome → saldo de agora em todas as lojas
 *  - Mais vendidos: loja(s) e período → o que mais saiu, com o saldo ao lado
 */
export function Produtos() {
  // Usuário de loja consulta só o estoque; vendas por produto ficam com dono e sócia
  const veVendidos = usePode("produtos");
  // e só das lojas dele (a API já manda só essas)
  const sessao = useSessao();
  const minhas = sessao?.papel === "loja" && sessao.lojas.length ? juntar(sessao.lojas) : "";
  const presets = useMemo(() => buildPresets().filter((p) => PERIODOS.includes(p.key)), []);
  const [aba, setAba] = useState<Aba>("busca");
  const [q, setQ] = useState("");
  const [periodo, setPeriodo] = useState<Period>(
    () => presets.find((p) => p.key === "Mês passado") ?? presets[0]
  );
  const [lojasSel, setLojasSel] = useState<string[]>([]);
  const [top, setTop] = useState(20);
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
    if (p.get("aba") === "vendidos" && veVendidos) setAba("vendidos");
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

  // Mais vendidos: mudou loja, período ou quantidade, a lista já se refaz
  // (com uma pausa curta, para tocar em várias lojas seguidas virar uma busca só)
  useEffect(() => {
    if (!pronto || aba !== "vendidos") return;
    const t = setTimeout(() => verMaisVendidos(periodo, lojasSel, top), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pronto, aba, periodo, lojasSel, top]);

  const trocarAba = (a: Aba) => {
    if (a === aba) return;
    pedido.current++; // descarta resposta em voo da outra aba
    setCarregando(false);
    setDados(null);
    setAba(a);
  };

  const alternarLoja = (loja: string) =>
    setLojasSel((atual) => (atual.includes(loja) ? atual.filter((x) => x !== loja) : [...atual, loja]));

  const ordenar = (col: string) =>
    setOrdem((o) => ({ col, desc: o?.col === col ? !o.desc : true }));
  const seta = (col: string) => (ordem?.col === col ? (ordem.desc ? " ↓" : " ↑") : "");
  /** Cabeçalho que ordena: botão de verdade, para funcionar no teclado e no leitor de tela */
  const cabOrdem = (col: string, rotulo: React.ReactNode, classe = "", titulo?: string) => (
    <th
      key={col}
      className={`ord ${classe}`.trim()}
      title={titulo}
      aria-sort={ordem?.col === col ? (ordem.desc ? "descending" : "ascending") : undefined}
    >
      <button type="button" className="ord-btn" onClick={() => ordenar(col)}>
        {rotulo}
        {seta(col)}
      </button>
    </th>
  );

  const colunasLojas = lojas.length ? lojas : dados?.lojas ?? [];
  const tabelas = dados?.tabelas ?? [];
  const escolhidas = dados?.modo === "vendidos" ? dados.lojasSel ?? [] : [];
  // Nos mais vendidos, o estoque das lojas escolhidas vem logo depois de
  // "Vendidas", para comparar o que vendeu com o que tem; as outras depois
  const colunasEstoque = [
    ...colunasLojas.filter((l) => escolhidas.includes(l)),
    ...colunasLojas.filter((l) => !escolhidas.includes(l)),
  ];
  const ultimaEscolhida = escolhidas.length && escolhidas.length < colunasLojas.length ? colunasEstoque[escolhidas.length - 1] : "";
  const marcaLoja = (loja: string) => (escolhidas.includes(loja) ? ` loja-sel${loja === ultimaEscolhida ? " loja-sel-fim" : ""}` : "");
  const posicao = new Map((dados?.itens ?? []).map((l, i) => [l.produto, i + 1]));

  const lista = (() => {
    if (!dados) return [];
    const itens = dados.itens;
    if (!ordem) return itens;
    const valor = (l: Linha): number | string =>
      ordem.col === "produto"
        ? l.produto
        : ordem.col === "vendidas"
          ? l.vendidas
          : ordem.col.startsWith("preco:")
              ? l.precos?.[ordem.col.slice(6)] ?? 0
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
      ...tabelas.map((t) => `Preço ${t}`),
      ...(vend ? ["Vendidas"] : []),
      ...colunasEstoque,
    ];
    const corpo = lista.map((l) => [
      ...(vend ? [String(posicao.get(l.produto) ?? "")] : []),
      `"${l.produto.replace(/"/g, '""')}"`,
      ...tabelas.map((t) => (l.precos?.[t] ? l.precos[t].toFixed(2).replace(".", ",") : "")),
      ...(vend ? [String(l.vendidas)] : []),
      ...colunasEstoque.map((loja) => String(l.porLoja[loja] ?? 0)),
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
      {veVendidos && (
        <Abas
          rotulo="Produtos"
          abas={[
            { id: "busca", nome: "Buscar produto" },
            { id: "vendidos", nome: "Mais vendidos" },
          ]}
          atual={aba}
          aoMudar={trocarAba}
        />
      )}

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
            Mostra o estoque de agora {minhas ? `em ${minhas}` : "em todas as lojas"}, cada cor e
            tamanho numa linha.
          </div>
        </>
      ) : (
        <>
          <div className="passo">
            <span className="passo-num">1</span> Loja
          </div>
          <div className="filters" role="group" aria-label="Lojas">
            <button className={lojasSel.length === 0 ? "active" : ""} aria-pressed={lojasSel.length === 0} onClick={() => setLojasSel([])}>
              Todas
            </button>
            {colunasLojas.map((loja) => (
              <button
                key={loja}
                className={lojasSel.includes(loja) ? "active" : ""}
                aria-pressed={lojasSel.includes(loja)}
                onClick={() => alternarLoja(loja)}
              >
                {loja}
              </button>
            ))}
          </div>

          <div className="passo">
            <span className="passo-num">2</span> Vendas de quando
          </div>
          <SeletorPeriodo opcoes={presets} atual={periodo} aoMudar={setPeriodo} rotulo="Vendas de quando" />

          <div className="passo">
            <span className="passo-num">3</span> Quantos produtos
          </div>
          <div className="seg" role="group" aria-label="Quantos">
            {TOPS.map((t) => (
              <button key={t} className={top === t ? "on" : ""} aria-pressed={top === t} onClick={() => setTop(t)}>
                {t} mais vendidos
              </button>
            ))}
          </div>

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

            {lista.length === 0 ? (
              <div className="empty">
                {dados.modo === "busca" ? "Nenhum produto com estoque com esse nome." : "Nada para mostrar."}
              </div>
            ) : (
              <>
              {/* Celular: um cartão por produto, com o estoque de cada loja à vista, sem arrastar de lado */}
              <ul className="prod-cartoes">
                {lista.map((l) => (
                  <li key={l.produto}>
                    <b>
                      {dados.modo === "vendidos" && <span className="pos">{posicao.get(l.produto)}º</span>}
                      {l.produto}
                    </b>
                    {(tabelas.length > 0 || dados.modo === "vendidos") && (
                      <p className="prod-cartao-precos">
                        {tabelas.map((t) => `${t} ${preco(l.precos?.[t])}`).join(" · ")}
                        {dados.modo === "vendidos" && `${tabelas.length ? " · " : ""}${l.vendidas} vendidas`}
                      </p>
                    )}
                    <dl className="prod-cartao-lojas">
                      {colunasEstoque.map((loja) => {
                        const v = l.porLoja[loja] ?? 0;
                        return (
                          <div key={loja} className={`${tom(v)}${escolhidas.includes(loja) ? " loja-sel" : ""}`}>
                            <dt>{curto(loja)}</dt>
                            <dd>{v}</dd>
                          </div>
                        );
                      })}
                    </dl>
                  </li>
                ))}
              </ul>
              <div className="tbl-wrap prod-tabela">
                <table className="prod-tbl">
                  <thead>
                    {tabelas.length > 0 && (
                      <tr className="grupo">
                        <th />
                        <th colSpan={tabelas.length} className="fim-preco">Preço</th>
                        {dados.modo === "vendidos" && <th />}
                        <th colSpan={colunasEstoque.length}>Estoque</th>
                      </tr>
                    )}
                    <tr>
                      {cabOrdem("produto", "Produto")}
                      {tabelas.map((t, i) =>
                        cabOrdem(
                          `preco:${t}`,
                          t,
                          `n preco${i === tabelas.length - 1 ? " fim-preco" : ""}`,
                          `Tabela ${t}${lojasDaTabela(t).length ? ` — vale em ${juntar(lojasDaTabela(t).map(curto))}` : ""}`
                        )
                      )}
                      {dados.modo === "vendidos" && cabOrdem("vendidas", "Vendidas", "n")}
                      {colunasEstoque.map((loja) =>
                        cabOrdem(`loja:${loja}`, <abbr title={loja}>{curto(loja)}</abbr>, `n${marcaLoja(loja)}`, loja)
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {lista.map((l) => {
                      return (
                        <tr key={l.produto}>
                          <td>
                            {dados.modo === "vendidos" && (
                              <span className="pos">{posicao.get(l.produto)}º</span>
                            )}
                            {l.produto}
                          </td>
                          {tabelas.map((t, i) => {
                            const v = l.precos?.[t];
                            return (
                              <td key={t} className={`n preco${i === tabelas.length - 1 ? " fim-preco" : ""}`}>
                                {preco(v)}
                              </td>
                            );
                          })}
                          {dados.modo === "vendidos" && <td className="n">{l.vendidas}</td>}
                          {colunasEstoque.map((loja) => {
                            const v = l.porLoja[loja] ?? 0;
                            return (
                              <td
                                key={loja}
                                className={`n ${tom(v)}${marcaLoja(loja)}`}
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
              </>
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
                  , em peças, {minhas ? `de ${minhas}` : "de todas as lojas"}.{" "}
                </>
              )}
              {dados.modo === "vendidos" &&
                "Vendidas = peças vendidas no período nas lojas escolhidas."}
              <span className="so-tela-grande"> Clique no nome de uma coluna para ordenar.</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
