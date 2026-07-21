"use client";

import { useEffect, useState } from "react";
import type { DailyPoint } from "@/lib/types";
import { CHANNEL_META, CHANNEL_ORDER, DailyChart, brl } from "@/components/viz";

interface TvData {
  generatedAt: string;
  today: { revenue: number; orders: number; shopify: number; tiktok: number; meli: number };
  daily: DailyPoint[];
}

/** Modo TV: tela cheia pra deixar num monitor, atualiza sozinha a cada minuto. */
export default function TvPage() {
  const [data, setData] = useState<TvData | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/tv", { cache: "no-store" });
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

  return (
    <main className="tv">
      <div className="tv-head">
        <div className="logo">
          <div>
            <span className="brand-word lg" role="img" aria-label="Via Sol" />
            <span className="tag">vendas de hoje</span>
          </div>
        </div>
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
            <div>
              <div className="hero-label">Faturamento de hoje</div>
              <div className="hero">{brl.format(data.today.revenue)}</div>
            </div>
            <div className="tv-ch">
              <span className="hero-label">Pedidos</span>
              <span className="n">{data.today.orders}</span>
            </div>
            {CHANNEL_ORDER.map((id) => (
              <div key={id} className="tv-ch">
                <span className="hero-label">
                  <span className="ch-dot" style={{ background: CHANNEL_META[id].cssVar }} />
                  {CHANNEL_META[id].name}
                </span>
                <span className="n">{brl.format(data.today[id])}</span>
              </div>
            ))}
          </div>

          <div className="card tv-chart">
            <h2>Últimos 14 dias</h2>
            <DailyChart daily={data.daily} height={340} />
          </div>
        </>
      )}
    </main>
  );
}
