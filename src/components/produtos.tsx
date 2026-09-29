"use client";

import { useEffect, useRef, useState } from "react";
import { brl, corDaLoja } from "./viz";

interface Linha {
  produto: string;
  pecas: number;
  faturamento: number;
  estoque: number;
  porLoja: Record<string, number>;
  cobertura: number | null;
  situacao: "ruptura" | "acabando" | "ok" | "parado";
}

interface Resposta {
  dias: number;
  erro?: string;
  itens: Linha[];
  totais: { produtos: number; rupturas: number; acabando: number; parados: number; pecasEstoque: number };
}

const SITUACAO: Record<Linha["situacao"], { rotulo: string; cor: string }> = {
  ruptura: { rotulo: "Ruptura", cor: "var(--c-meli)" },
  acabando: { rotulo: "Acabando", cor: "var(--brand)" },
  ok: { rotulo: "OK", cor: "var(--text-muted)" },
  parado: { rotulo: "Parado", cor: "var(--c-tiktok)" },
};

type Filtro = "todos" | "ruptura" | "acabando" | "parado";

/** Aba de produtos: o que vendeu no período contra o saldo de hoje. */
export function Produtos({
  from,
  to,
  units,
  agrup,
  lojas,
  aoAlternarLoja,
  aoTrocarAgrup,
}: {
  from: string;
  to: string;
  units: string[];
  agrup: string;
  lojas: string[];
  aoAlternarLoja: (nome: string) => void;
  aoTrocarAgrup: (a: "modelo" | "cor" | "tamanho" | "completo") => void;
}) {
  const [dados, setDados] = useState<Resposta | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [aberto, setAberto] = useState<string | null>(null);
  const pedido = useRef(0);

  useEffect(() => {
    const id = ++pedido.current;
    setCarregando(true);
    const qs =
      `from=${from}&to=${to}&agrup=${agrup}` +
      (units.length ? `&units=${encodeURIComponent(units.join(","))}` : "");
    fetch(`/api/produtos?${qs}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((json: Resposta | null) => {
        if (id === pedido.current && json) setDados(json);
      })
      .catch(() => {
        /* a mensagem de erro aparece quando não há dados */
      })
      .finally(() => {
        if (id === pedido.current) setCarregando(false);
      });
  }, [from, to, units, agrup]);

  const filtrosTopo = (
    <>
      <div className="filters" role="group" aria-label="Lojas">
        {lojas.map((loja) => {
          const ativa = units.includes(loja);
          return (
            <button
              key={loja}
              className={ativa ? "on" : ""}
              onClick={() => aoAlternarLoja(loja)}
              style={ativa ? { background: corDaLoja(loja), borderColor: corDaLoja(loja) } : undefined}
            >
              {loja}
            </button>
          );
        })}
      </div>
      <div className="seg" role="group" aria-label="Agrupar produtos">
        {(["modelo", "cor", "tamanho", "completo"] as const).map((a) => (
          <button key={a} className={agrup === a ? "on" : ""} onClick={() => aoTrocarAgrup(a)}>
            {a === "completo" ? "Completo" : a[0].toUpperCase() + a.slice(1)}
          </button>
        ))}
      </div>
    </>
  );

  if (carregando && !dados)
    return (
      <>
        {filtrosTopo}
        <div className="empty">Carregando produtos…</div>
      </>
    );
  if (!dados) return <div className="card">Não foi possível carregar os produtos.</div>;

  const lista = dados.itens.filter((l) => filtro === "todos" || l.situacao === filtro);
  const t = dados.totais;

  return (
    <div>
      {filtrosTopo}
      <div style={{ opacity: carregando ? 0.6 : 1 }}>
      {dados.erro && <div className="card err-msg">{dados.erro}</div>}

      <div className="tiles">
        <div className="tile">
          <div className="label">Peças em estoque</div>
          <div className="value">{t.pecasEstoque.toLocaleString("pt-BR")}</div>
          <span className="muted" style={{ fontSize: 12 }}>
            {t.produtos.toLocaleString("pt-BR")} produtos
          </span>
        </div>
        <div className="tile">
          <div className="label">Em ruptura</div>
          <div className="value">{t.rupturas.toLocaleString("pt-BR")}</div>
          <span className="muted" style={{ fontSize: 12 }}>
            vendendo e sem saldo
          </span>
        </div>
        <div className="tile">
          <div className="label">Acabando</div>
          <div className="value">{t.acabando.toLocaleString("pt-BR")}</div>
          <span className="muted" style={{ fontSize: 12 }}>
            menos de 15 dias
          </span>
        </div>
        <div className="tile">
          <div className="label">Parados</div>
          <div className="value">{t.parados.toLocaleString("pt-BR")}</div>
          <span className="muted" style={{ fontSize: 12 }}>
            com saldo, sem venda
          </span>
        </div>
      </div>

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
                <th>Produto</th>
                <th className="n">Vendidos</th>
                <th className="n">Faturamento</th>
                <th className="n">Estoque</th>
                <th className="n">Cobertura</th>
                <th>Situação</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((l) => (
                <tr
                  key={l.produto}
                  onClick={() => setAberto(aberto === l.produto ? null : l.produto)}
                  className="clicavel"
                >
                  <td>
                    {l.produto}
                    {aberto === l.produto && (
                      <div className="por-loja">
                        {Object.entries(l.porLoja).length === 0
                          ? "sem saldo em nenhuma loja"
                          : Object.entries(l.porLoja)
                              .sort((a, b) => b[1] - a[1])
                              .map(([loja, qtd]) => `${loja}: ${qtd}`)
                              .join(" · ")}
                      </div>
                    )}
                  </td>
                  <td className="n">{l.pecas.toLocaleString("pt-BR")}</td>
                  <td className="n">{brl.format(l.faturamento)}</td>
                  <td className="n">{l.estoque.toLocaleString("pt-BR")}</td>
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
          Cobertura é o estoque de hoje dividido pela média de venda dos últimos {dados.dias} dias.
          Toque num produto para ver o saldo loja a loja.
        </div>
      </div>
      </div>
    </div>
  );
}
