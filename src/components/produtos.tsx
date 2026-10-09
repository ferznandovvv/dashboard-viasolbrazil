"use client";

import { useEffect, useRef, useState } from "react";
import { LOJA_CORES, brl } from "./viz";

interface Linha {
  produto: string;
  pecas: number;
  faturamento: number;
  estoque: number;
  porLoja: Record<string, number>;
  cobertura: number | null;
  situacao: "ruptura" | "acabando" | "ok" | "parado" | "negativo";
  abc: "A" | "B" | "C";
}

interface Transferencia {
  produto: string;
  de: string;
  sobra: number;
  para: string;
  vendeu: number;
  sugestao: number;
}

interface Resposta {
  dias: number;
  semVendas?: boolean;
  estoqueEm?: string;
  categoria: string;
  erro?: string;
  incompleto?: boolean;
  lojasDisponiveis?: string[];
  itens: Linha[];
  transferencias: Transferencia[];
}

interface Categoria {
  nome: string;
  produtos: number;
  pecas: number;
}

const SITUACAO: Record<Linha["situacao"], { rotulo: string; cor: string }> = {
  ruptura: { rotulo: "Ruptura", cor: "var(--c-meli)" },
  acabando: { rotulo: "Acabando", cor: "var(--brand)" },
  ok: { rotulo: "OK", cor: "var(--text-muted)" },
  parado: { rotulo: "Parado", cor: "var(--c-tiktok)" },
  negativo: { rotulo: "Negativo", cor: "var(--c-meli)" },
};

type Filtro = "todos" | "ruptura" | "acabando" | "parado" | "negativo";
/** "loja:Centro" ordena pelo saldo daquela loja. */
type Coluna = "produto" | "pecas" | "faturamento" | "estoque" | "cobertura" | `loja:${string}`;

/** Gera o CSV da lista como ela está na tela. */
function paraCSV(linhas: Linha[], lojas: string[]): string {
  const cab = ["Produto", "Vendidos", "Faturamento", "Estoque", ...lojas, "Cobertura", "Situação"];
  const corpo = linhas.map((l) => [
    `"${l.produto.replace(/"/g, "\"\"")}"`,
    l.pecas,
    l.faturamento.toFixed(2).replace(".", ","),
    l.estoque,
    ...lojas.map((loja) => l.porLoja[loja] ?? 0),
    l.cobertura ?? "",
    SITUACAO[l.situacao].rotulo,
  ]);
  // Ponto e vírgula: é o que o Excel em português espera
  return [cab, ...corpo].map((linha) => linha.join(";")).join("\n");
}

/**
 * Produtos em dois passos: escolher a categoria e só então buscar. A consulta
 * completa é cara demais para rodar sem alguém pedir.
 */
export function Produtos({
  from,
  to,
  units,
  agrup,
  aoAlternarLoja,
  comVendas,
  aoPedirVendas,
}: {
  from: string;
  to: string;
  units: string[];
  agrup: string;
  aoAlternarLoja: (nome: string) => void;
  comVendas: boolean;
  aoPedirVendas: () => void;
}) {
  const [categorias, setCategorias] = useState<Categoria[] | null>(null);
  const [categoria, setCategoria] = useState("");
  // Filtros escolhidos × filtros já consultados: a busca é cara demais para
  // disparar a cada clique, então ela espera o botão
  const [consulta, setConsulta] = useState<{
    q: string;
    cat: string;
    from: string;
    to: string;
    units: string[];
    agrup: string;
    /** Estoque sozinho responde em uma consulta; a venda do período é cara */
    comVendas: boolean;
  } | null>(null);
  const [dados, setDados] = useState<Resposta | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [falha, setFalha] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [busca, setBusca] = useState("");
  const [ordem, setOrdem] = useState<{ col: Coluna; desc: boolean }>({
    col: "estoque",
    desc: true,
  });
  const pedido = useRef(0);
  const guardado = useRef<Map<string, Resposta>>(new Map());

  // Categoria e busca também sobrevivem à recarga
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const cat = p.get("cat") ?? "";
    const q = p.get("q") ?? "";
    if (cat) setCategoria(cat);
    if (q) setBusca(q);
    if (cat || q) setConsulta({ q, cat, from, to, units, agrup, comVendas: false });
    // só na montagem: depois disso quem manda é o botão
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!consulta) return;
    const p = new URLSearchParams(window.location.search);
    if (consulta.cat) p.set("cat", consulta.cat);
    else p.delete("cat");
    if (consulta.q) p.set("q", consulta.q);
    else p.delete("q");
    window.history.replaceState(null, "", `?${p.toString()}`);
  }, [consulta]);

  // A lista de categorias é leve e vem do estoque já em cache
  useEffect(() => {
    fetch("/api/produtos/categorias", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { categorias?: Categoria[] } | null) => setCategorias(j?.categorias ?? []))
      .catch(() => setCategorias([]));
  }, []);

  useEffect(() => {
    if (!consulta) {
      setDados(null);
      return;
    }
    const id = ++pedido.current;
    const qs =
      `cat=${encodeURIComponent(consulta.cat)}&q=${encodeURIComponent(consulta.q)}` +
      `&from=${consulta.from}&to=${consulta.to}` +
      `&agrup=${consulta.agrup}` +
      (consulta.units.length ? `&units=${encodeURIComponent(consulta.units.join(","))}` : "") +
      (consulta.comVendas ? "" : "&sem=vendas");
    const salvo = guardado.current.get(qs);
    if (salvo) {
      setDados(salvo);
      setCarregando(false);
      return;
    }
    setCarregando(true);
    setFalha("");

    fetch(`/api/produtos?${qs}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Erro ${r.status}`))))
      .then((json: Resposta) => {
        guardado.current.set(qs, json);
        if (id === pedido.current) setDados(json);
      })
      .catch((e: Error) => {
        if (id === pedido.current) setFalha(e.message);
      })
      .finally(() => {
        if (id === pedido.current) setCarregando(false);
      });
  }, [consulta]);

  const lojas = Object.keys(LOJA_CORES);
  const carregarVendas = () => {
    aoPedirVendas();
    if (consulta) setConsulta({ ...consulta, comVendas: true });
  };

  const pendente =
    Boolean(categoria || busca.trim()) &&
    (!consulta ||
      consulta.q !== busca.trim() ||
      consulta.cat !== categoria ||
      consulta.from !== from ||
      consulta.to !== to ||
      consulta.agrup !== agrup ||
      consulta.units.join(",") !== units.join(",") ||
      consulta.comVendas !== comVendas);
  const buscar = () => {
    const q = busca.trim();
    setConsulta({ q, cat: categoria, from, to, units, agrup, comVendas });
  };

  const ordenar = (col: Coluna) =>
    setOrdem((o) => ({ col, desc: o.col === col ? !o.desc : true }));

  const baixarCSV = () => {
    const csv = paraCSV(lista, comSaldo);
    const url = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `produtos-${consulta?.cat || consulta?.q || "lista"}-${from}-a-${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };
  // Todas as lojas, sempre: "zero em Belo Horizonte" também é resposta
  const comSaldo = lojas;
  const lista = (dados?.itens ?? [])
    .filter((l) => filtro === "todos" || l.situacao === filtro)
    .sort((a, b) => {
      const dir = ordem.desc ? -1 : 1;
      if (ordem.col === "produto") return a.produto.localeCompare(b.produto, "pt-BR") * dir;
      if (ordem.col.startsWith("loja:")) {
        const loja = ordem.col.slice(5);
        return ((a.porLoja[loja] ?? 0) - (b.porLoja[loja] ?? 0)) * dir;
      }
      if (ordem.col === "cobertura") {
        // Sem venda não tem cobertura: fica sempre no fim
        const va = a.cobertura ?? Number.MAX_SAFE_INTEGER;
        const vb = b.cobertura ?? Number.MAX_SAFE_INTEGER;
        return (va - vb) * dir;
      }
      return (
        (a[ordem.col as "pecas" | "faturamento" | "estoque"] -
          b[ordem.col as "pecas" | "faturamento" | "estoque"]) *
        dir
      );
    });

  return (
    <div>
      {/* Passo 1 — categoria */}
      <div className="passo">
        <span className="passo-num">1</span> Escolha a categoria
      </div>
      {categorias === null ? (
        <div className="empty">Carregando categorias…</div>
      ) : (
        <div className="filters" role="group" aria-label="Categorias">
          <button
            className={categoria === "TOP20" ? "active" : ""}
            onClick={() => setCategoria(categoria === "TOP20" ? "" : "TOP20")}
            title="Os 20 produtos que mais saíram no período, de todas as categorias"
          >
            ★ 20 mais vendidos
          </button>
          {categorias.map((c) => (
            <button
              key={c.nome}
              className={categoria === c.nome ? "active" : ""}
              onClick={() => setCategoria(categoria === c.nome ? "" : c.nome)}
              title={`${c.produtos} produtos · ${c.pecas} peças em estoque`}
            >
              {c.nome}
            </button>
          ))}
        </div>
      )}

      <input
        className="busca"
        type="search"
        placeholder="…ou busque pelo nome do produto (ex.: cortininha)"
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && pendente) buscar();
        }}
      />

      {!categoria && !busca.trim() && (
        <div className="empty">
          Nenhum produto carregado ainda — escolha uma categoria acima, depois as lojas, e toque em
          buscar.
        </div>
      )}

      {(categoria || busca.trim()) && (
        <>
          <div className="passo">
            <span className="passo-num">2</span> Filtre se quiser
          </div>
          <div className="filters" role="group" aria-label="Lojas">
            {lojas.map((loja) => (
              <button
                key={loja}
                className={units.includes(loja) ? "active" : ""}
                onClick={() => aoAlternarLoja(loja)}
              >
                {loja}
              </button>
            ))}
          </div>
          <button className="buscar" onClick={buscar} disabled={carregando || !pendente}>
            {carregando
              ? "Buscando…"
              : pendente
                ? `Ver ${busca.trim() || (categoria === "TOP20" ? "os mais vendidos" : categoria)}`
                : "Resultado abaixo"}
          </button>
        </>
      )}

      {consulta && carregando && !dados && (
        <div className="empty">
          Buscando {categoria === "TOP20" ? "os mais vendidos" : categoria}…
        </div>
      )}
      {consulta && falha && (
        <div className="card">
          Não foi possível carregar ({falha}). A primeira busca de cada categoria é a mais pesada;
          tente de novo em instantes.
        </div>
      )}

      {consulta && dados && (
        <div style={{ opacity: carregando ? 0.6 : 1 }}>
          {pendente && !carregando && (
            <div className="parcial">
              Isto é o resultado do filtro anterior — toque no botão acima para atualizar.
            </div>
          )}
          {dados.erro && <div className="card err-msg">{dados.erro}</div>}
          {dados.semVendas && (
            <div className="parcial">
              Só estoque — é a consulta rápida. As vendas do período são o que demora, então elas
              vêm só se você pedir.{" "}
              <button className="link" onClick={carregarVendas} disabled={carregando}>
                {carregando ? "carregando vendas…" : "trazer as vendas do período"}
              </button>
            </div>
          )}
          {dados.incompleto && (
            <div className="parcial">
              A foto do estoque ainda está sendo montada (são quase 18 mil produtos) — pode faltar
              produto. Busque de novo em 1 ou 2 minutos, até este aviso sumir.
            </div>
          )}

          {dados.transferencias.length > 0 && (
            <div className="card">
              <h2>Sugestões de transferência</h2>
              <div className="rank-aviso" style={{ margin: "0 0 10px" }}>
                Parado numa loja, vendendo e sem saldo em outra.
              </div>
              <div className="transf">
                {dados.transferencias.map((t) => (
                  <div key={`${t.produto}-${t.de}-${t.para}`} className="transf-linha">
                    <span className="transf-prod">{t.produto}</span>
                    <span className="transf-mov">
                      <b>{t.de}</b> ({t.sobra} parad{t.sobra === 1 ? "a" : "as"}) → <b>{t.para}</b>{" "}
                      (vendeu {t.vendeu}, sem saldo)
                    </span>
                    <span className="transf-qtd">enviar ~{t.sugestao}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="seg" role="group" aria-label="Situação">
            {(["todos", "ruptura", "acabando", "parado", "negativo"] as Filtro[]).map((f) => (
              <button key={f} className={filtro === f ? "on" : ""} onClick={() => setFiltro(f)}>
                {f === "todos" ? "Todos" : SITUACAO[f].rotulo}
              </button>
            ))}
          </div>

          <div className="card">
            <div className="tbl-wrap">
              <table className="prod-tbl">
                <thead>
                  <tr>
                    <th className="ord" onClick={() => ordenar("produto")}>
                      {consulta.cat === "TOP20" ? "20 mais vendidos" : dados.categoria}
                      {ordem.col === "produto" ? (ordem.desc ? " ↓" : " ↑") : ""}
                    </th>
                    {!dados.semVendas && (
                      <>
                        <th className="n ord" onClick={() => ordenar("pecas")}>
                          Vendeu{ordem.col === "pecas" ? (ordem.desc ? " ↓" : " ↑") : ""}
                        </th>
                        <th className="n ord" onClick={() => ordenar("faturamento")}>
                          R${ordem.col === "faturamento" ? (ordem.desc ? " ↓" : " ↑") : ""}
                        </th>
                      </>
                    )}
                    {!dados.semVendas && (
                      <th className="n ord" onClick={() => ordenar("estoque")}>
                        Estoque{ordem.col === "estoque" ? (ordem.desc ? " ↓" : " ↑") : ""}
                      </th>
                    )}
                    {comSaldo.map((l) => (
                      <th
                        key={l}
                        className="n ord"
                        onClick={() => ordenar(`loja:${l}`)}
                        title={`Ordenar pelo saldo de ${l}`}
                      >
                        {l}
                        {ordem.col === `loja:${l}` ? (ordem.desc ? " ↓" : " ↑") : ""}
                      </th>
                    ))}
                    {!dados.semVendas && (
                      <>
                        <th className="n ord" onClick={() => ordenar("cobertura")}>
                          Cobertura{ordem.col === "cobertura" ? (ordem.desc ? " ↓" : " ↑") : ""}
                        </th>
                        <th>Situação</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {lista.map((l) => (
                    <tr key={l.produto}>
                      <td>{l.produto}</td>
                      {!dados.semVendas && (
                        <>
                          <td className="n">{l.pecas.toLocaleString("pt-BR")}</td>
                          <td className="n">{brl.format(l.faturamento)}</td>
                        </>
                      )}
                      {!dados.semVendas && (
                        <td className="n">
                          <b style={l.estoque < 0 ? { color: "var(--c-meli)" } : undefined}>
                            {l.estoque.toLocaleString("pt-BR")}
                          </b>
                        </td>
                      )}
                      {comSaldo.map((loja) => (
                        <td
                          key={loja}
                          className={`n loja-col${ordem.col === `loja:${loja}` ? " ordenada" : ""}`}
                        >
                          {l.porLoja[loja] ?? 0}
                        </td>
                      ))}
                      {!dados.semVendas && (
                        <>
                          <td className="n">{l.cobertura === null ? "—" : `${l.cobertura} d`}</td>
                          <td>
                            <span className="sit" style={{ color: SITUACAO[l.situacao].cor }}>
                              {SITUACAO[l.situacao].rotulo}
                            </span>
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {comSaldo.length > 3 && (
              <div className="rank-aviso" style={{ margin: "8px 0 0" }}>
                Arraste a tabela para o lado para ver todas as lojas.
              </div>
            )}
            {lista.length === 0 && <div className="empty">Nenhum produto nessa situação.</div>}
            {lista.length > 0 && (
              <button className="exportar" onClick={baixarCSV}>
                Baixar em planilha ({lista.length} linhas)
              </button>
            )}
            <div className="rank-aviso" style={{ margin: "12px 0 0" }}>
              {dados.estoqueEm && (
              <>
                Saldo de{" "}
                {new Date(dados.estoqueEm).toLocaleString("pt-BR", {
                  day: "2-digit",
                  month: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                  timeZone: "America/Sao_Paulo",
                })}
                .{" "}
              </>
            )}
            {dados.semVendas ? (
              "Números por loja, em peças."
            ) : (
              <>
                {consulta.units.length > 0 ? (
                  <>
                    <b>Vendas de {consulta.units.join(", ")}</b>, mas o estoque é de{" "}
                    <b>todas as lojas</b> — é assim que dá para ver quem tem peça para remanejar.{" "}
                  </>
                ) : null}
                Venda é do período escolhido. Cobertura = quantos dias o saldo dura no ritmo dos
                últimos {dados.dias} dias.
              </>
            )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
