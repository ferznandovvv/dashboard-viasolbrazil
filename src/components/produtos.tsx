"use client";

import { useEffect, useRef, useState } from "react";
import { brl } from "./viz";

interface Linha {
  produto: string;
  pecas: number;
  faturamento: number;
  estoque: number;
  porLoja: Record<string, number>;
  cobertura: number | null;
  situacao: "ruptura" | "acabando" | "ok" | "parado";
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
};

type Filtro = "todos" | "ruptura" | "acabando" | "parado";

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
  aoTrocarAgrup,
}: {
  from: string;
  to: string;
  units: string[];
  agrup: string;
  aoAlternarLoja: (nome: string) => void;
  aoTrocarAgrup: (a: "modelo" | "cor" | "tamanho" | "completo") => void;
}) {
  const [categorias, setCategorias] = useState<Categoria[] | null>(null);
  const [categoria, setCategoria] = useState("");
  const [dados, setDados] = useState<Resposta | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [falha, setFalha] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const pedido = useRef(0);
  const guardado = useRef<Map<string, Resposta>>(new Map());

  // A lista de categorias é leve e vem do estoque já em cache
  useEffect(() => {
    fetch("/api/produtos/categorias", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { categorias?: Categoria[] } | null) => setCategorias(j?.categorias ?? []))
      .catch(() => setCategorias([]));
  }, []);

  useEffect(() => {
    if (!categoria) {
      setDados(null);
      return;
    }
    const id = ++pedido.current;
    const qs =
      `cat=${encodeURIComponent(categoria)}&from=${from}&to=${to}&agrup=${agrup}` +
      (units.length ? `&units=${encodeURIComponent(units.join(","))}` : "");
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
  }, [categoria, from, to, units, agrup]);

  const lojas = dados?.lojasDisponiveis ?? [];
  const comSaldo = lojas.filter((l) => dados?.itens.some((i) => (i.porLoja[l] ?? 0) !== 0));
  const lista = (dados?.itens ?? []).filter((l) => filtro === "todos" || l.situacao === filtro);

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

      {!categoria && (
        <div className="empty">
          Nenhum produto carregado ainda — escolha uma categoria acima para ver estoque e venda.
        </div>
      )}

      {categoria && (
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
          <div className="seg" role="group" aria-label="Agrupar">
            {(["modelo", "cor", "tamanho", "completo"] as const).map((a) => (
              <button key={a} className={agrup === a ? "on" : ""} onClick={() => aoTrocarAgrup(a)}>
                {a === "completo" ? "Completo" : a[0].toUpperCase() + a.slice(1)}
              </button>
            ))}
          </div>
        </>
      )}

      {categoria && carregando && !dados && (
        <div className="empty">
          Buscando {categoria === "TOP20" ? "os mais vendidos" : categoria}…
        </div>
      )}
      {categoria && falha && (
        <div className="card">
          Não foi possível carregar ({falha}). A primeira busca de cada categoria é a mais pesada;
          tente de novo em instantes.
        </div>
      )}

      {categoria && dados && (
        <div style={{ opacity: carregando ? 0.6 : 1 }}>
          {dados.erro && <div className="card err-msg">{dados.erro}</div>}
          {dados.incompleto && (
            <div className="parcial">
              Primeira carga ainda incompleta — recarregue em alguns minutos para ver tudo.
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
            {(["todos", "ruptura", "acabando", "parado"] as Filtro[]).map((f) => (
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
                    <th>{categoria === "TOP20" ? "20 mais vendidos" : categoria}</th>
                    <th className="n">Vendeu</th>
                    <th className="n">R$</th>
                    <th className="n">Estoque</th>
                    {comSaldo.map((l) => (
                      <th key={l} className="n">
                        {l}
                      </th>
                    ))}
                    <th className="n">Cobertura</th>
                    <th>Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {lista.map((l) => (
                    <tr key={l.produto}>
                      <td>{l.produto}</td>
                      <td className="n">{l.pecas.toLocaleString("pt-BR")}</td>
                      <td className="n">{brl.format(l.faturamento)}</td>
                      <td className="n">
                        <b>{l.estoque.toLocaleString("pt-BR")}</b>
                      </td>
                      {comSaldo.map((loja) => (
                        <td key={loja} className="n loja-col">
                          {l.porLoja[loja] ?? 0}
                        </td>
                      ))}
                      <td className="n">{l.cobertura === null ? "—" : `${l.cobertura} d`}</td>
                      <td>
                        <span className="sit" style={{ color: SITUACAO[l.situacao].cor }}>
                          {SITUACAO[l.situacao].rotulo}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {lista.length === 0 && <div className="empty">Nenhum produto nessa situação.</div>}
            <div className="rank-aviso" style={{ margin: "12px 0 0" }}>
              Estoque é o saldo de agora; venda é do período escolhido. Cobertura = quantos dias o
              saldo dura no ritmo dos últimos {dados.dias} dias.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
