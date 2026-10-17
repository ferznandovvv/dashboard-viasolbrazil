"use client";

import { useEffect, useMemo, useState } from "react";
import type { Analise as Dados } from "@/lib/crm/analise";
import type { FaixaCliente } from "@/lib/crm/tipos";
import { api, brl } from "./comum";
import { classeFaixa } from "./faixa";

const n = (v: number) => v.toLocaleString("pt-BR");
const reais = (v: number) => (Math.abs(v) >= 1000 ? brl.format(Math.round(v)).replace(/,00$/, "") : brl.format(v).replace(/,00$/, ""));
/** Percentual no jeito brasileiro: inteiro, ou uma casa abaixo de 10%. */
const pc = (v: number | null | undefined) => (v === null || v === undefined ? "–" : `${v.toLocaleString("pt-BR", { maximumFractionDigits: v < 10 ? 1 : 0 })}%`);
const minutos = (m: number | null) => (m === null ? "–" : m < 60 ? `${m} min` : `${Math.floor(m / 60)}h${m % 60 ? String(m % 60).padStart(2, "0") : ""}`);
const NOME_CAMPANHA: Record<string, string> = {
  cashback_creditado: "Cashback creditado",
  cashback_site_perto: "Cashback do site (perto)",
  cashback_site_longe: "Cashback do site (longe)",
  cashback_vencendo: "Cashback vencendo",
  cashback_vencendo_urgente: "Cashback vencendo (último)",
  aniversario: "Aniversário",
  reativacao: "Reativação",
  pos_venda: "Pós-venda",
  boas_vindas: "Boas-vindas",
  avulsa: "Campanhas manuais",
};

/** O que a base diz: onde está o dinheiro, quando a cliente volta, como cada loja está. */
export function Analise({ validade }: { validade: number }) {
  const [d, setD] = useState<Dados | null>(null);
  const [erro, setErro] = useState("");
  const [lojaVend, setLojaVend] = useState("");
  useEffect(() => {
    api<Dados>("/api/crm/analise").then(setD).catch((e) => setErro(e.message));
  }, []);

  const vendedoras = useMemo(() => (d ? d.porVendedora.filter((v) => !lojaVend || v.loja === lojaVend) : []), [d, lojaVend]);
  if (!d) return <div className="empty">{erro || "Calculando…"}</div>;

  const pctIdent = d.base.vendasTotal ? Math.round((d.base.vendasIdentificadas / d.base.vendasTotal) * 100) : 0;
  const ouro = d.rfm.find((f) => f.faixa === "Ouro");
  const maxRec = Math.max(1, ...d.recompra.faixas.map((f) => f.n));
  const maxReceitaLoja = Math.max(1, ...d.porLoja.map((l) => l.receita));
  const maxMediana = Math.max(1, ...d.atendimento.map((a) => a.medianaMin ?? 0));
  const cb = d.cashback;
  const cbTotal = Math.max(1, cb.creditado);
  // Em que faixa de dias cai a validade do cashback
  const limites = [30, 60, 90, 180, 365, 99999];
  const faixaValidade = limites.findIndex((l) => validade <= l);

  return (
    <div className="an">
      <p className="an-intro">
        Calculado das {n(d.base.vendasTotal)} vendas carregadas
        {d.periodo.de && ` desde ${d.periodo.de.slice(8, 10)}/${d.periodo.de.slice(5, 7)}/${d.periodo.de.slice(0, 4)} (${d.periodo.meses} meses)`}.
        {d.periodo.meses < 12 && " Com menos de um ano de histórico, ninguém aparece como Parada e a recompra fica subestimada: vale carregar mais meses em Configurar → Dados."}
      </p>

      <div className="an-kpis">
        <div className="an-kpi">
          <span className="an-kpi-v">{n(d.ano.ativas)}</span>
          <span className="an-kpi-r">clientes compraram nos últimos 12 meses</span>
        </div>
        <div className="an-kpi">
          <span className="an-kpi-v">{reais(d.ano.gastoMedio)}</span>
          <span className="an-kpi-r">gasto médio por cliente no ano, em compras de {reais(d.ano.ticket)} em média</span>
        </div>
        <div className="an-kpi">
          <span className="an-kpi-v">{pc(d.recompra.taxa)}</span>
          <span className="an-kpi-r">
            voltaram pra comprar de novo ({n(d.recompra.voltaram)} de {n(d.recompra.elegiveis)} com a primeira compra há 6+ meses)
          </span>
        </div>
        <div className={`an-kpi ${pctIdent < 50 ? "ruim" : ""}`}>
          <span className="an-kpi-v">{pctIdent}%</span>
          <span className="an-kpi-r">das vendas têm a cliente identificada; o resto é consumidor final, sem histórico nem cashback</span>
        </div>
      </div>

      <section className="card an-dinheiro">
        <h2>Onde está o dinheiro</h2>
        {ouro && ouro.clientes > 0 && (
          <p className="an-frase">
            As clientes Ouro são {pc(ouro.pctClientes)} da base e trazem {pc(ouro.pctReceita)} da receita. Cada uma gastou {reais(ouro.ticket)} em média.
          </p>
        )}
        <div className="an-legenda">
          <span>
            <i className="an-leg-cli" /> % das clientes
          </span>
          <span>
            <i className="an-leg-rec" /> % da receita
          </span>
        </div>
        <div className="an-faixas">
          {d.rfm.map((f) => (
            <div key={f.faixa} className={`an-faixa ${classeFaixa(f.faixa as FaixaCliente)}`}>
              <div className="an-faixa-nome">
                <b>
                  <i aria-hidden />
                  {f.faixa}
                </b>
                <small>{f.descricao}</small>
              </div>
              <div className="an-faixa-barras">
                <div className="an-par" title={`${f.clientes} clientes`}>
                  <span className="an-bar cli" style={{ width: `${f.pctClientes}%` }} />
                  <em>{pc(f.pctClientes)}</em>
                </div>
                <div className="an-par" title={reais(f.receita)}>
                  <span className="an-bar rec" style={{ width: `${f.pctReceita}%` }} />
                  <em>{pc(f.pctReceita)}</em>
                </div>
              </div>
              <div className="an-faixa-num">
                <b>{n(f.clientes)}</b> clientes
                <small>{reais(f.receita)}</small>
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="an-dupla">
        <section className="card">
          <h2>Quando ela volta</h2>
          {d.recompra.medianaDias === null ? (
            <p className="muted">Ainda não tem cliente com segunda compra no período carregado.</p>
          ) : (
            <>
              <p className="an-frase">
                Metade das que voltam, voltam em até {d.recompra.medianaDias} dias. O cashback de {validade} dias alcança {pc(d.recompra.dentroDaValidade ?? 0)} dessas voltas.
              </p>
              <div className="an-colunas" role="img" aria-label="Dias até a segunda compra">
                {d.recompra.faixas.map((f, i) => (
                  <div key={f.faixa} className={`an-col ${i <= faixaValidade ? "dentro" : ""}`} title={`${f.faixa}: ${f.n} clientes`}>
                    <span className="an-col-v">{f.n || ""}</span>
                    <span className="an-col-b" style={{ height: `${(f.n / maxRec) * 100}%` }} />
                    <span className="an-col-r">{f.faixa.replace("mais de um ano", "1 ano+").replace(" dias", "d")}</span>
                  </div>
                ))}
              </div>
              <div className="an-legenda">
                <span>
                  <i className="an-leg-rec" /> dentro da validade do cashback
                </span>
                <span>
                  <i className="an-leg-cli" /> depois
                </span>
              </div>
            </>
          )}
        </section>

        <section className="card">
          <h2>Cashback</h2>
          {!cb.creditado ? (
            <p className="muted">Nenhum cashback creditado ainda. Começa a contar com as vendas novas, a partir da carga diária do TOTVS.</p>
          ) : (
            <>
              <p className="an-frase">
                {reais(cb.creditado)} creditados.{" "}
                {cb.taxaResgate !== null ? `${pc(cb.taxaResgate)} do que já venceu ou foi usado acabou virando compra.` : "Nenhum crédito venceu ou foi usado ainda."}
              </p>
              <div className="an-pilha" role="img" aria-label="Divisão do cashback creditado">
                <span className="usado" style={{ width: `${(cb.resgatado / cbTotal) * 100}%` }} />
                <span className="aberto" style={{ width: `${(cb.emAberto / cbTotal) * 100}%` }} />
                <span className="vencido" style={{ width: `${(cb.expirado / cbTotal) * 100}%` }} />
              </div>
              <div className="an-pilha-leg">
                <span>
                  <i className="usado" /> Usado <b>{reais(cb.resgatado)}</b>
                </span>
                <span>
                  <i className="aberto" /> Em aberto <b>{reais(cb.emAberto)}</b>
                </span>
                <span>
                  <i className="vencido" /> Venceu <b>{reais(cb.expirado)}</b>
                </span>
              </div>
              <p className="muted an-nota">No varejo de moda, costuma-se usar de 20% a 40%. O que vence não custa nada; é isso que torna 15% pagável.</p>
            </>
          )}
        </section>
      </div>

      <section className="card">
        <h2>Lojas</h2>
        <div className="tbl-wrap">
          <table className="prod-tbl fin-tbl an-tbl">
            <thead>
              <tr>
                <th>Loja</th>
                <th style={{ width: "26%" }}>Receita no período</th>
                <th className="n">Ticket</th>
                <th style={{ width: "18%" }}>Vendas com cliente</th>
                <th style={{ width: "18%" }}>Clientes com celular</th>
              </tr>
            </thead>
            <tbody>
              {d.porLoja.map((l) => (
                <tr key={l.loja}>
                  <td className="fin-desc">{l.loja}</td>
                  <td>
                    <div className="an-linha">
                      <span className="an-bar rec" style={{ width: `${(l.receita / maxReceitaLoja) * 100}%` }} />
                      <em>{reais(l.receita)}</em>
                    </div>
                  </td>
                  <td className="n">{reais(l.ticket)}</td>
                  <td>
                    <Medidor pct={l.pctIdentificadas} />
                  </td>
                  <td>
                    <Medidor pct={l.pctTelefone} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="an-dupla">
        <section className="card">
          <h2>Tempo de resposta no WhatsApp</h2>
          {!d.atendimento.length ? (
            <p className="muted">Aparece quando os números das lojas estiverem conectados. Conta toda conversa, inclusive quando é a cliente que chama, só no horário de atendimento.</p>
          ) : (
            <>
              <p className="muted an-nota">Mediana da primeira resposta, últimos 30 dias. Mais rápida em cima.</p>
              {d.atendimento.map((a) => (
                <div key={a.loja} className="an-rank">
                  <span className="an-rank-nome">{a.loja}</span>
                  <span className="an-linha">
                    <span className={`an-bar ${a.medianaMin !== null && a.medianaMin > 15 ? "lento" : "rapido"}`} style={{ width: `${((a.medianaMin ?? 0) / maxMediana) * 100}%` }} />
                    <em>{minutos(a.medianaMin)}</em>
                  </span>
                  <span className="an-rank-sub">
                    {a.conversas} conversas{a.rapidas !== null ? `, ${a.rapidas}% em até 15 min` : ""}
                  </span>
                </div>
              ))}
            </>
          )}
        </section>

        <section className="card">
          <div className="fin-cab">
            <h2>Celular por vendedora</h2>
            <select className="fin-select" value={lojaVend} onChange={(e) => setLojaVend(e.target.value)} aria-label="Loja">
              <option value="">Todas as lojas</option>
              {Array.from(new Set(d.porVendedora.map((v) => v.loja))).map((l) => (
                <option key={l}>{l}</option>
              ))}
            </select>
          </div>
          {!vendedoras.length ? (
            <p className="muted">Rode a carga do TOTVS de novo pra trazer a vendedora de cada nota.</p>
          ) : (
            <>
              <p className="muted an-nota">Das vendas de cada uma, quantas saíram com cliente que tem celular. Quem menos pega aparece primeiro.</p>
              <div className="an-vend">
                {vendedoras.map((v) => (
                  <div key={`${v.vendedora}|${v.loja}`} className="an-rank">
                    <span className="an-rank-nome">
                      {v.vendedora.split(" ").slice(0, 2).map((x) => x.charAt(0) + x.slice(1).toLowerCase()).join(" ")}
                      {!lojaVend && <small>{v.loja}</small>}
                    </span>
                    <Medidor pct={v.vendas ? Math.round((v.comTelefone / v.vendas) * 100) : 0} />
                    <span className="an-rank-sub">{v.vendas} vendas</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      </div>

      <section className="card">
        <h2>Mensagens que saíram</h2>
        {!d.campanhas.length ? (
          <p className="muted">Nada enviado ainda. Quando o modo sombra for desligado, aqui aparece quem respondeu, quem pediu pra sair, quem usou o código e quem comprou em até 14 dias.</p>
        ) : (
          <div className="tbl-wrap">
            <table className="prod-tbl fin-tbl">
              <thead>
                <tr>
                  <th>Mensagem</th>
                  <th className="n">Enviadas</th>
                  <th className="n">Responderam</th>
                  <th className="n">Pediram pra sair</th>
                  <th className="n">Usaram o código</th>
                  <th className="n">Compraram em 14 dias</th>
                </tr>
              </thead>
              <tbody>
                {d.campanhas.map((c) => (
                  <tr key={c.campanha}>
                    <td className="fin-desc">{NOME_CAMPANHA[c.campanha] ?? c.campanha}</td>
                    <td className="n">{n(c.enviadas)}</td>
                    <td className="n">{c.enviadas ? Math.round((c.respondidas / c.enviadas) * 100) : 0}%</td>
                    <td className={`n ${c.enviadas && c.sair / c.enviadas > 0.02 ? "vencida" : ""}`}>{c.sair || ""}</td>
                    <td className="n">{c.codigosUsados || ""}</td>
                    <td className="n">
                      {c.compraram14d || ""}
                      {c.receita14d > 0 && <div className="fin-sub">{reais(c.receita14d)}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

/** Barra de 0 a 100% com o número ao lado; abaixo de 50% fica em alerta. */
function Medidor({ pct }: { pct: number }) {
  return (
    <span className="an-linha">
      <span className={`an-bar ${pct < 50 ? "baixo" : "bom"}`} style={{ width: `${pct}%` }} />
      <em>{Math.round(pct)}%</em>
    </span>
  );
}
