"use client";

import { useEffect, useState } from "react";
import { brl, corDaLoja } from "@/components/viz";

interface Vendedora {
  nome: string;
  vendidoMes: number;
  vendidoHoje: number;
  vendasMes: number;
  meta: number;
  pct: number;
  falta: number;
  porDia: number;
}

interface Dados {
  loja: string;
  geradoEm: string;
  mesLabel: string;
  diasRestantes: number;
  metaLoja: number;
  vendidoLoja: number;
  pctLoja: number;
  semVendedora: number;
  vendedoras: Vendedora[];
  erro?: string;
  lojas?: string[];
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
/** Valor sem centavos: na tela da loja, número grande e limpo */
const reais = (v: number) => brl.format(Math.round(v)).replace(/,00$/, "");

/**
 * Tela da loja: fica num tablet ou TV, mostrando a meta de cada vendedora e
 * da loja no mês. Atualiza sozinha.
 */
export default function TelaLoja() {
  const [dados, setDados] = useState<Dados | null>(null);
  const [lojas, setLojas] = useState<string[]>([]);
  const [params, setParams] = useState<{ nome: string; k: string } | null>(null);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    setParams({ nome: p.get("nome") ?? "", k: p.get("k") ?? "" });
  }, []);

  useEffect(() => {
    if (!params) return;
    let vivo = true;
    const carregar = async () => {
      const qs = new URLSearchParams({ nome: params.nome, ...(params.k ? { k: params.k } : {}) });
      try {
        const r = await fetch(`/api/loja?${qs}`, { cache: "no-store" });
        const j = (await r.json()) as Dados;
        if (!vivo) return;
        if (r.ok) setDados(j);
        else setLojas(j.lojas ?? []);
      } catch {
        /* mantém o último dado na tela */
      }
    };
    carregar();
    // De cinco em cinco minutos: venda não muda de segundo em segundo, e cada
    // atualização é uma consulta à TOTVS
    const t = setInterval(carregar, 5 * 60000);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, [params]);

  // Sem loja escolhida: lista para montar o link de cada tela
  if (params && !params.nome) {
    return <EscolherLoja k={params.k} />;
  }
  if (!dados && lojas.length) {
    return <EscolherLoja k={params?.k ?? ""} />;
  }
  if (!dados) return <main className="tela-loja"><div className="empty">Carregando…</div></main>;

  const cor = corDaLoja(dados.loja);

  return (
    <main className="tela-loja" style={{ ["--cor-loja" as string]: cor }}>
      <header className="tl-cab">
        <div>
          <span className="brand-word" role="img" aria-label="Via Sol" />
          <h1>{dados.loja}</h1>
        </div>
        <div className="tl-quando">
          meta de {dados.mesLabel}
          <br />
          faltam <b>{dados.diasRestantes}</b> {dados.diasRestantes === 1 ? "dia" : "dias"}
        </div>
      </header>

      {dados.metaLoja > 0 ? (
        <section className="tl-loja">
          <div className="tl-loja-num">
            <span className="tl-grande">{pct(dados.pctLoja)}</span>
            <span>
              da meta da loja · {reais(dados.vendidoLoja)} de {reais(dados.metaLoja)}
            </span>
          </div>
          <div className="tl-barra grande">
            <div style={{ width: `${Math.min(dados.pctLoja, 1) * 100}%` }} />
          </div>
        </section>
      ) : (
        <section className="tl-loja">
          A meta desta loja ainda não foi definida. Ela é definida na dashboard, ao entrar na
          loja.
        </section>
      )}

      <section className="tl-grade">
        {dados.vendedoras.map((v) => (
          <div key={v.nome} className={`tl-card${v.pct >= 1 ? " bateu" : ""}`}>
            <div className="tl-nome">{v.nome}</div>
            <div className="tl-pct">{pct(v.pct)}</div>
            <div className="tl-barra">
              <div style={{ width: `${Math.min(v.pct, 1) * 100}%` }} />
            </div>
            <div className="tl-linha">
              <span>vendido</span>
              <b>{reais(v.vendidoMes)}</b>
            </div>
            <div className="tl-linha">
              <span>meta</span>
              <b>{reais(v.meta)}</b>
            </div>
            {v.pct >= 1 ? (
              <div className="tl-bateu">meta batida 🎉</div>
            ) : (
              <div className="tl-linha destaque">
                <span>precisa por dia</span>
                <b>{reais(v.porDia)}</b>
              </div>
            )}
            {v.vendidoHoje > 0 && <div className="tl-hoje">hoje: {reais(v.vendidoHoje)}</div>}
          </div>
        ))}
      </section>

      <footer className="tl-rodape">
        {dados.vendedoras.length > 0 && dados.metaLoja > 0 && (
          <>
            Meta da loja dividida entre as {dados.vendedoras.length} vendedoras que venderam nos
            últimos 30 dias.{" "}
          </>
        )}
        {dados.semVendedora > 0 && (
          <>{reais(dados.semVendedora)} saíram do caixa sem vendedora registrada. </>
        )}
        Atualizado às{" "}
        {new Date(dados.geradoEm).toLocaleTimeString("pt-BR", {
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "America/Sao_Paulo",
        })}
        .
      </footer>
    </main>
  );
}

/** Lista das lojas, para abrir a tela de cada uma. */
function EscolherLoja({ k }: { k: string }) {
  const lojas = [
    "Centro",
    "Fiusa",
    "Loja de Fábrica",
    "Rio de Janeiro",
    "Ribeirão Preto",
    "SP — Itaim",
    "Belo Horizonte",
    "Praia Grande",
  ];
  return (
    <main className="wrap">
      <div className="topbar">
        <div className="logo">
          <div>
            <span className="brand-word" role="img" aria-label="Via Sol" />
            <span className="tag">tela das lojas</span>
          </div>
        </div>
      </div>
      <div className="rank-aviso" style={{ margin: "0 0 14px" }}>
        Abra a tela da loja no tablet ou TV de lá e deixe aberta — ela atualiza sozinha.
      </div>
      <div className="filters" role="group">
        {lojas.map((l) => (
          <a
            key={l}
            className="tl-escolha"
            href={`/loja?nome=${encodeURIComponent(l)}${k ? `&k=${encodeURIComponent(k)}` : ""}`}
          >
            {l}
          </a>
        ))}
      </div>
    </main>
  );
}
