"use client";

import { useEffect, useState } from "react";
import type { Analise as Dados } from "@/lib/crm/analise";
import { api, brl } from "./comum";

const pct = (v: number | null | undefined) => (v === null || v === undefined ? "" : `${v}%`);

/** A base falando: o que ela diz sobre as regras do programa. */
export function Analise({ validade }: { validade: number }) {
  const [d, setD] = useState<Dados | null>(null);
  const [erro, setErro] = useState("");
  useEffect(() => {
    api<Dados>("/api/crm/analise").then(setD).catch((e) => setErro(e.message));
  }, []);
  if (!d) return <div className="empty">{erro || "Calculando…"}</div>;

  const maxFaixa = Math.max(1, ...d.recompra.faixas.map((f) => f.n));
  const pctTel = d.base.clientes ? Math.round((d.base.comTelefone / d.base.clientes) * 100) : 0;
  const pctAniv = d.base.clientes ? Math.round((d.base.comAniversario / d.base.clientes) * 100) : 0;
  const pctIdent = d.base.vendasTotal ? Math.round((d.base.vendasIdentificadas / d.base.vendasTotal) * 100) : 0;

  return (
    <div>
      <div className="muted" style={{ marginBottom: 12 }}>
        Calculado das {d.base.vendasTotal.toLocaleString("pt-BR")} vendas carregadas{d.periodo.de && <> ({d.periodo.meses} meses, desde {d.periodo.de.slice(8, 10)}/{d.periodo.de.slice(5, 7)}/{d.periodo.de.slice(0, 4)})</>}. Quanto mais histórico carregado, mais confiáveis os números de recompra.
      </div>

      <div className="tiles">
        <div className={`tile ${pctTel < 50 ? "alerta" : ""}`}>
          <div className="label">Clientes com celular</div>
          <div className="value">{pctTel}%</div>
          <div className="muted">{d.base.comTelefone.toLocaleString("pt-BR")} de {d.base.clientes.toLocaleString("pt-BR")}. Sem isso não tem mensagem</div>
        </div>
        <div className={`tile ${pctIdent < 50 ? "alerta" : ""}`}>
          <div className="label">Vendas com cliente identificado</div>
          <div className="value">{pctIdent}%</div>
          <div className="muted">O resto saiu como consumidor final: não gera cashback nem histórico</div>
        </div>
        <div className="tile">
          <div className="label">Com aniversário</div>
          <div className="value">{pctAniv}%</div>
          <div className="muted">Campanha de aniversário só alcança essas</div>
        </div>
        <div className="tile">
          <div className="label">Taxa de recompra</div>
          <div className="value">{d.recompra.taxa === null ? "sem dado" : `${d.recompra.taxa}%`}</div>
          <div className="muted">{d.recompra.voltaram} de {d.recompra.elegiveis} clientes com primeira compra há 6+ meses voltaram</div>
        </div>
      </div>

      <div className="grid-2 crm-grid">
        <div className="card">
          <h2>Quando ela volta</h2>
          {d.recompra.medianaDias === null ? (
            <div className="muted">Ainda não tem clientes com segunda compra no período carregado.</div>
          ) : (
            <>
              <div style={{ marginBottom: 10 }}>
                Metade das que voltam, voltam em até <b>{d.recompra.medianaDias} dias</b>. Com validade de <b>{validade} dias</b>, o cashback alcança <b>{pct(d.recompra.dentroDaValidade)}</b> das recompras naturais.
              </div>
              {d.recompra.faixas.map((f) => (
                <div key={f.faixa} className="rank-row an-barra">
                  <span className="an-rotulo">{f.faixa}</span>
                  <span className="rank-bar"><span className="rank-fill" style={{ width: `${(f.n / maxFaixa) * 100}%` }} /></span>
                  <span className="an-n">{f.n}</span>
                </div>
              ))}
              <div className="muted" style={{ marginTop: 8 }}>
                Leitura: se a maioria volta em 60 a 90 dias sozinha, 15% pra todas é pagar por uma volta que já aconteceria. Vale pensar em percentual maior só pra quem comprou uma vez e nunca voltou.
              </div>
            </>
          )}
        </div>

        <div className="card">
          <h2>Faixas de cliente (RFM simplificado)</h2>
          <table className="prod-tbl fin-tbl">
            <thead>
              <tr>
                <th>Faixa</th>
                <th className="n">Clientes</th>
                <th className="n">Receita</th>
                <th className="n">% receita</th>
                <th className="n">Gasto médio</th>
              </tr>
            </thead>
            <tbody>
              {d.rfm.map((f) => (
                <tr key={f.faixa}>
                  <td>
                    <div className="fin-desc">{f.faixa}</div>
                    <div className="fin-sub">{f.descricao}</div>
                  </td>
                  <td className="n">{f.clientes}</td>
                  <td className="n">{brl.format(f.receita)}</td>
                  <td className="n">{f.pctReceita}%</td>
                  <td className="n">{brl.format(f.ticket)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="muted" style={{ marginTop: 8 }}>Ouro e Prata é onde a reativação paga; Nova é onde o cashback decide se vira segunda compra.</div>
        </div>
      </div>

      <div className="card">
        <h2>Cobertura por loja</h2>
        <div className="tbl-wrap">
          <table className="prod-tbl fin-tbl">
            <thead>
              <tr>
                <th>Loja</th>
                <th className="n">Vendas</th>
                <th className="n">Com cliente</th>
                <th className="n">Clientes</th>
                <th className="n">Com celular</th>
              </tr>
            </thead>
            <tbody>
              {d.porLoja.map((l) => (
                <tr key={l.loja}>
                  <td className="fin-desc">{l.loja}</td>
                  <td className="n">{l.vendas}</td>
                  <td className={`n ${l.pctIdentificadas < 50 ? "vencida" : ""}`}>{l.pctIdentificadas}%</td>
                  <td className="n">{l.clientes}</td>
                  <td className={`n ${l.pctTelefone < 50 ? "vencida" : ""}`}>{l.pctTelefone}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2>Cobertura por vendedora</h2>
        <div className="muted" style={{ marginBottom: 8 }}>Quem menos cadastra celular aparece primeiro. Esse é o número pra acompanhar por semana e amarrar na meta.</div>
        {!d.porVendedora.length ? (
          <div className="muted">Rode a carga do TOTVS de novo pra trazer a vendedora de cada nota.</div>
        ) : (
          <div className="tbl-wrap">
            <table className="prod-tbl fin-tbl">
              <thead>
                <tr>
                  <th>Vendedora</th>
                  <th>Loja</th>
                  <th className="n">Vendas</th>
                  <th className="n">Com cliente</th>
                  <th className="n">Cliente com celular</th>
                </tr>
              </thead>
              <tbody>
                {d.porVendedora.map((v) => (
                  <tr key={`${v.vendedora}|${v.loja}`}>
                    <td className="fin-desc">{v.vendedora}</td>
                    <td>{v.loja}</td>
                    <td className="n">{v.vendas}</td>
                    <td className={`n ${v.pctIdentificadas < 50 ? "vencida" : ""}`}>{v.pctIdentificadas}%</td>
                    <td className={`n ${v.pctTelefone < 50 ? "vencida" : ""}`}>{v.pctTelefone}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="grid-2 crm-grid">
        <div className="card">
          <h2>Campanhas</h2>
          {!d.campanhas.length ? (
            <div className="muted">Nada enviado ainda. Quando sair do modo sombra, aqui aparece resposta, SAIR, código usado e compra em até 14 dias.</div>
          ) : (
            <table className="prod-tbl fin-tbl">
              <thead>
                <tr>
                  <th>Campanha</th>
                  <th className="n">Enviadas</th>
                  <th className="n">Responderam</th>
                  <th className="n">SAIR</th>
                  <th className="n">Código usado</th>
                  <th className="n">Compraram em 14d</th>
                </tr>
              </thead>
              <tbody>
                {d.campanhas.map((c) => (
                  <tr key={c.campanha}>
                    <td className="fin-desc">{c.campanha.replace(/_/g, " ")}</td>
                    <td className="n">{c.enviadas}</td>
                    <td className="n">{c.enviadas ? Math.round((c.respondidas / c.enviadas) * 100) : 0}%</td>
                    <td className={`n ${c.enviadas && c.sair / c.enviadas > 0.02 ? "vencida" : ""}`}>{c.sair}</td>
                    <td className="n">{c.codigosUsados}</td>
                    <td className="n">
                      {c.compraram14d}
                      {c.receita14d > 0 && <div className="fin-sub">{brl.format(c.receita14d)}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="card">
          <h2>Cashback</h2>
          <div className="tiles tiles-2">
            <div className="tile"><div className="label">Creditado</div><div className="value" style={{ fontSize: 22 }}>{brl.format(d.cashback.creditado)}</div></div>
            <div className="tile"><div className="label">Em aberto</div><div className="value" style={{ fontSize: 22 }}>{brl.format(d.cashback.emAberto)}</div></div>
            <div className="tile"><div className="label">Resgatado</div><div className="value" style={{ fontSize: 22 }}>{brl.format(d.cashback.resgatado)}</div></div>
            <div className="tile"><div className="label">Taxa de resgate</div><div className="value" style={{ fontSize: 22 }}>{d.cashback.taxaResgate === null ? "sem dado" : `${d.cashback.taxaResgate}%`}</div><div className="muted">do que já venceu ou foi usado</div></div>
          </div>
          <div className="muted" style={{ marginTop: 8 }}>No varejo de moda a taxa de resgate costuma ficar entre 20 e 40%. O resto vence e custa zero; é isso que torna 15% pagável.</div>
        </div>
      </div>
    </div>
  );
}
