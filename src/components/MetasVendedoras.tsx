"use client";

import { useEffect, useState } from "react";
import type { CaixaDoDia as Caixa } from "@/app/api/loja/route";
import { CaixaDoDia } from "./CaixaDoDia";

interface Vendedora {
  nome: string;
  vendidoMes: number;
  vendidoHoje: number;
  meta: number;
  pct: number;
  porDia: number;
}

interface Dados {
  diasRestantes: number;
  metaLoja: number;
  vendedoras: Vendedora[];
  semVendedora: number;
  conectado: boolean;
  caixa?: Caixa;
}

const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const pct = (v: number) => `${Math.round(v * 100)}%`;
const primeiroNome = (n: string) => n.split(" ")[0].toLowerCase().replace(/^./, (c) => c.toUpperCase());

/**
 * O caixa de hoje e a meta de cada vendedora, numa consulta só à TOTVS.
 * Era a antiga "tela das lojas"; agora fica dentro da tela da loja.
 */
export function CaixaEMetas({ loja }: { loja: string }) {
  const [d, setD] = useState<Dados | null>(null);

  useEffect(() => {
    let vivo = true;
    // No aparelho da loja, o código da TV vem no endereço
    const k = new URLSearchParams(window.location.search).get("k") ?? "";
    const carregar = () =>
      fetch(`/api/loja?${new URLSearchParams({ nome: loja, ...(k ? { k } : {}) })}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => vivo && j && setD(j))
        .catch(() => {});
    void carregar();
    // De cinco em cinco minutos: cada atualização é uma consulta à TOTVS
    const t = setInterval(carregar, 5 * 60000);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, [loja]);

  if (!d) return null;
  return (
    <>
      {d.conectado && d.caixa && <CaixaDoDia c={d.caixa} />}
      <MetasVendedoras d={d} />
    </>
  );
}

/** Meta de cada vendedora no mês: a meta da loja dividida entre quem vendeu nos últimos 30 dias. */
function MetasVendedoras({ d }: { d: Dados }) {
  if (!d.metaLoja || !d.vendedoras.length) return null;

  return (
    <section className="card metas-vend" aria-labelledby="metas-vend-titulo">
      <h2 id="metas-vend-titulo">Meta de cada vendedora</h2>
      <p className="metas-vend-sub">
        Meta da loja dividida entre as {d.vendedoras.length} vendedoras que venderam nos últimos 30 dias · faltam{" "}
        {d.diasRestantes} {d.diasRestantes === 1 ? "dia" : "dias"}
      </p>
      <ul className="metas-vend-grade">
        {d.vendedoras.map((v) => {
          const bateu = v.pct >= 1;
          return (
            <li key={v.nome} className={bateu ? "bateu" : ""}>
              <div className="metas-vend-topo">
                <b>{primeiroNome(v.nome)}</b>
                <span className="metas-vend-pct">{pct(v.pct)}</span>
              </div>
              <div
                className="metas-vend-barra"
                role="progressbar"
                aria-label={`Meta de ${primeiroNome(v.nome)}`}
                aria-valuenow={Math.round(v.pct * 100)}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <i style={{ width: `${Math.min(v.pct, 1) * 100}%` }} />
              </div>
              <dl>
                <div>
                  <dt>Vendido</dt>
                  <dd>{reais(v.vendidoMes)}</dd>
                </div>
                <div>
                  <dt>Meta</dt>
                  <dd>{reais(v.meta)}</dd>
                </div>
                <div className="destaque">
                  <dt>{bateu ? "Meta batida" : "Precisa por dia"}</dt>
                  <dd>{bateu ? "✓" : reais(v.porDia)}</dd>
                </div>
              </dl>
              {v.vendidoHoje > 0 && <p className="metas-vend-hoje">Hoje: {reais(v.vendidoHoje)}</p>}
            </li>
          );
        })}
      </ul>
      {d.semVendedora > 0 && (
        <p className="metas-vend-sub">{reais(d.semVendedora)} saíram do caixa no mês sem vendedora registrada.</p>
      )}
    </section>
  );
}
