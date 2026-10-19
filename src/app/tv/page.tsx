"use client";

import { useEffect, useRef, useState } from "react";
import type { DailyPoint } from "@/lib/types";
import { DailyChart, brl, corDaLoja } from "@/components/viz";

interface Loja {
  nome: string;
  total: number;
  pedidos: number;
}

interface TvData {
  generatedAt: string;
  today: {
    revenue: number;
    orders: number;
    online: number;
    onlinePedidos: number;
    lojas: number;
    lojasPedidos: number;
    lojasPorLoja: Loja[];
    lojasSemConexao: boolean;
  };
  daily: DailyPoint[];
}

const ONLINE = "var(--c-online)";
const vendas = (n: number) => `${n} ${n === 1 ? "venda" : "vendas"}`;

/**
 * Altura do gráfico em unidades do desenho (que tem 960 de largura) para ele
 * ocupar exatamente o espaço que sobra na tela, sem rolagem.
 */
function useAlturaQueCabe(ativo: boolean) {
  const caixa = useRef<HTMLDivElement>(null);
  const [altura, setAltura] = useState(340);
  useEffect(() => {
    const el = caixa.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect;
      if (width > 0 && height > 0) setAltura(Math.max(160, Math.floor((960 * height) / width)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ativo]);
  return { caixa, altura };
}

/**
 * Modo TV: tela cheia pra deixar num monitor, atualiza sozinha a cada minuto.
 * Tudo cabe numa tela só: o total do dia, o online somado, cada loja física
 * e os últimos 14 dias.
 */
export default function TvPage() {
  const [data, setData] = useState<TvData | null>(null);
  const { caixa, altura } = useAlturaQueCabe(data !== null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        // Repassa o código da URL: a API do modo TV exige o mesmo código
        const k = new URLSearchParams(window.location.search).get("k") ?? "";
        const res = await fetch(`/api/tv${k ? `?k=${encodeURIComponent(k)}` : ""}`, {
          cache: "no-store",
        });
        if (res.ok && alive) setData(await res.json());
      } catch {
        /* mantém o último dado na tela */
      }
    };
    load();
    const t = setInterval(load, 60000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const lojas = data?.today.lojasPorLoja ?? [];

  return (
    <main className="tv">
      <div className="tv-head">
        <span className="brand-word lg" role="img" aria-label="Via Sol" />
        {data && (
          <span className="updated">
            atualizado{" "}
            {new Date(data.generatedAt).toLocaleTimeString("pt-BR", {
              hour: "2-digit",
              minute: "2-digit",
              timeZone: "America/Sao_Paulo",
            })}
          </span>
        )}
      </div>

      {!data ? (
        <div className="empty">Carregando…</div>
      ) : (
        <>
          <div className="tv-row">
            <div className="tv-total">
              <h1 className="hero-label">Vendas de hoje</h1>
              <div className="hero">{brl.format(data.today.revenue)}</div>
            </div>
            <div className="tv-ch">
              <span className="hero-label">
                <span className="ch-dot" style={{ background: ONLINE }} />
                Online
              </span>
              <span className="n">{brl.format(data.today.online)}</span>
              <span className="sub">{vendas(data.today.onlinePedidos)}</span>
            </div>
            <div className="tv-ch">
              <span className="hero-label">Lojas físicas</span>
              <span className="n">{brl.format(data.today.lojas)}</span>
              <span className="sub">{vendas(data.today.lojasPedidos)}</span>
            </div>
          </div>

          <section aria-label="Lojas físicas hoje">
            {data.today.lojasSemConexao && (
              <p className="tv-aviso">Sem conexão com a TOTVS: os valores das lojas podem estar incompletos.</p>
            )}
            <ul className="tv-lojas" style={{ "--colunas": Math.max(4, Math.ceil(lojas.length / 2)) } as React.CSSProperties}>
              {lojas.map((l) => (
                <li key={l.nome} className="tv-loja" style={{ borderLeftColor: corDaLoja(l.nome) }}>
                  <span className="nome">{l.nome}</span>
                  <span className={`n${l.total ? "" : " zero"}`}>{brl.format(l.total)}</span>
                  <span className="sub">{vendas(l.pedidos)}</span>
                </li>
              ))}
            </ul>
          </section>

          <div className="card tv-chart">
            <h2>Últimos 14 dias</h2>
            <div className="tv-grafico" ref={caixa}>
              <DailyChart
                daily={data.daily}
                series={[
                  { key: "online", label: "Online", color: ONLINE },
                  ...lojas.map((l) => ({ key: `loja:${l.nome}`, label: l.nome, color: corDaLoja(l.nome) })),
                ]}
                height={altura}
              />
            </div>
          </div>
        </>
      )}
    </main>
  );
}
