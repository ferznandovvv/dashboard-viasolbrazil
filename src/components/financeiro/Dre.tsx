"use client";

import { Fragment, useEffect, useState } from "react";
import type { GrupoDre, LinhaDre } from "@/lib/financeiro/tipos";
import { type Cadastros, api, hojeSp, nomeMes } from "./comum";

interface Resposta {
  ano: number;
  regime: "competencia" | "caixa";
  meses: string[];
  linhas: LinhaDre[];
  avisos: string[];
  unidades: string[];
}

/** Valor em reais, sem centavos, para caberem 12 meses lado a lado. */
const num = (v: number) =>
  Math.round(v) === 0 ? "—" : `${v < 0 ? "−" : ""}R$ ${Math.round(Math.abs(v)).toLocaleString("pt-BR")}`;
const pct = (v: number) => (v === 0 ? "—" : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`);

/** DRE do ano, mês a mês, por competência ou por caixa. */
export function Dre({ cad }: { cad: Cadastros }) {
  const anoAtual = Number(hojeSp().slice(0, 4));
  const [ano, setAno] = useState(anoAtual);
  const [empresa, setEmpresa] = useState("");
  const [regime, setRegime] = useState<"competencia" | "caixa">("competencia");
  const [dados, setDados] = useState<Resposta | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState("");
  const [abertos, setAbertos] = useState<Set<GrupoDre>>(new Set());

  useEffect(() => {
    let vivo = true;
    setCarregando(true);
    setErro("");
    api<Resposta>(`/api/financeiro/dre?${new URLSearchParams({ ano: String(ano), empresa, regime })}`)
      .then((j) => vivo && setDados(j))
      .catch((e) => vivo && setErro(e.message))
      .finally(() => vivo && setCarregando(false));
    return () => {
      vivo = false;
    };
  }, [ano, empresa, regime]);

  const alternar = (g: GrupoDre) =>
    setAbertos((a) => {
      const n = new Set(a);
      if (n.has(g)) n.delete(g);
      else n.add(g);
      return n;
    });

  const empresas = cad.empresas.filter((e) => e.ativa);
  return (
    <div>
      <div className="fin-barra">
        <div className="seg" role="group" aria-label="Regime">
          <button className={regime === "competencia" ? "on" : ""} onClick={() => setRegime("competencia")}>
            Competência
          </button>
          <button className={regime === "caixa" ? "on" : ""} onClick={() => setRegime("caixa")}>
            Caixa
          </button>
        </div>
        <select className="fin-select" value={ano} onChange={(e) => setAno(Number(e.target.value))}>
          {[anoAtual, anoAtual - 1, anoAtual - 2].map((a) => (
            <option key={a}>{a}</option>
          ))}
        </select>
        {empresas.length > 1 && (
          <select className="fin-select" value={empresa} onChange={(e) => setEmpresa(e.target.value)}>
            <option value="">Todas as empresas</option>
            {empresas.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nome}
              </option>
            ))}
          </select>
        )}
      </div>

      {erro && <div className="card err-msg">{erro}</div>}
      {carregando && !dados && (
        <div className="empty">Somando as vendas do ano… na primeira vez pode levar um minuto.</div>
      )}
      {dados && dados.avisos.length > 0 && (
        <div className="parcial">Receita incompleta — {dados.avisos.join(" · ")}</div>
      )}

      {dados && (
        <div className="card" style={{ opacity: carregando ? 0.6 : 1 }}>
          <div className="tbl-wrap">
            <table className="prod-tbl fin-dre">
              <thead>
                <tr>
                  <th>{dados.ano}</th>
                  {dados.meses.map((m) => (
                    <th key={m} className="n">
                      {nomeMes(m)}
                    </th>
                  ))}
                  <th className="n">Total</th>
                </tr>
              </thead>
              <tbody>
                {dados.linhas.map((l) => {
                  if (l.tipo === "categoria" && !abertos.has(l.grupo!)) return null;
                  const despesa = l.tipo === "grupo" || l.tipo === "categoria";
                  const fmt = l.tipo === "margem" ? pct : num;
                  return (
                    <Fragment key={l.chave}>
                      <tr className={`dre-${l.tipo}`}>
                        <td>
                          {l.tipo === "grupo" ? (
                            <button className="dre-abrir" onClick={() => alternar(l.grupo!)} disabled={l.total === 0}>
                              <span className="dre-seta">{l.total === 0 ? "" : abertos.has(l.grupo!) ? "▾" : "▸"}</span>
                              (−) {l.rotulo}
                            </button>
                          ) : l.tipo === "subtotal" ? (
                            <>= {l.rotulo}</>
                          ) : (
                            l.rotulo
                          )}
                        </td>
                        {l.valores.map((v, i) => (
                          <td key={i} className={`n${(l.tipo === "subtotal" || l.tipo === "margem") && v < 0 ? " neg" : ""}`}>
                            {despesa ? num(-v) : fmt(v)}
                          </td>
                        ))}
                        <td className={`n total${(l.tipo === "subtotal" || l.tipo === "margem") && l.total < 0 ? " neg" : ""}`}>
                          {despesa ? num(-l.total) : fmt(l.total)}
                        </td>
                      </tr>
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="rank-aviso" style={{ margin: "12px 0 0" }}>
            {regime === "competencia"
              ? "Competência: cada despesa entra no mês a que ela se refere (o aluguel de outubro conta em outubro), já paga ou não. Mostra se o mês deu lucro."
              : "Caixa: só o que já saiu do banco, no mês em que foi pago (o aluguel de outubro pago em 5/11 conta em novembro). Mostra o dinheiro que entrou e saiu."}{" "}
            A receita é a venda do mês ({dados.unidades.length ? dados.unidades.join(", ") : "nenhuma loja ligada à empresa"}).
            Clique num grupo para ver as categorias.

          </div>
        </div>
      )}
    </div>
  );
}
