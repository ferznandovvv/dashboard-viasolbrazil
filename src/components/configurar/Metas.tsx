"use client";

import { useEffect, useState } from "react";

/** Converte "45.000" ou "45000,50" em número; vazio vira 0 (sem meta). */
const lerReais = (t: string) => {
  const limpo = t.replace(/[^\d,.]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
  return limpo ? Number(limpo) : 0;
};
const mostrar = (v: number) => (v ? v.toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : "");

/**
 * Configurações › Metas: a meta do mês de cada loja e do online, num lugar só.
 * É a mesma meta que aparece em Vendas e na tela da loja (e que a tela da
 * loja divide entre as vendedoras).
 */
export function Metas() {
  const [unidades, setUnidades] = useState<string[]>([]);
  const [valores, setValores] = useState<Record<string, string>>({});
  const [salvos, setSalvos] = useState<Record<string, number>>({});
  const [estado, setEstado] = useState<"" | "salvando" | "salvo" | string>("");

  useEffect(() => {
    Promise.all([
      fetch("/api/config", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/acesso/aparelhos", { cache: "no-store" }).then((r) => r.json()),
    ])
      .then(([cfg, ap]: [{ metas?: Record<string, number> }, { lojas: string[] }]) => {
        const metas = cfg.metas ?? {};
        setUnidades(["Site", ...ap.lojas]);
        setSalvos(metas);
        setValores(Object.fromEntries(Object.entries(metas).map(([u, v]) => [u, mostrar(v)])));
      })
      .catch(() => setEstado("Não consegui carregar as metas. Recarregue a página."));
  }, []);

  const mudadas = unidades.filter((u) => lerReais(valores[u] ?? "") !== (salvos[u] ?? 0));

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mudadas.length) return;
    setEstado("salvando");
    try {
      for (const u of mudadas) {
        const r = await fetch("/api/config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ unidade: u, meta: lerReais(valores[u] ?? "") }),
        });
        if (!r.ok) throw new Error();
      }
      setSalvos({ ...salvos, ...Object.fromEntries(mudadas.map((u) => [u, lerReais(valores[u] ?? "")])) });
      setEstado("salvo");
    } catch {
      setEstado("Não deu para salvar todas. Confira e tente de novo.");
    }
  };

  if (!unidades.length) return <div className="empty">{estado || "Carregando…"}</div>;

  const mes = new Date().toLocaleDateString("pt-BR", { month: "long", timeZone: "America/Sao_Paulo" });
  return (
    <form className="card metas-cfg" onSubmit={salvar}>
      <h2>Meta do mês de cada loja</h2>
      <p className="pessoas-ajuda">
        Vale para {mes} e continua nos próximos meses até você mudar. Aparece em Vendas e na tela da loja, que divide a
        meta da loja entre as vendedoras. Deixe em branco para ficar sem meta.
      </p>
      <div className="metas-cfg-grade">
        {unidades.map((u) => (
          <div key={u} className="campo">
            <label htmlFor={`meta-${u}`}>{u === "Site" ? "Online (site e marketplaces)" : u}</label>
            <div className="metas-cfg-valor">
              <span aria-hidden="true">R$</span>
              <input
                id={`meta-${u}`}
                inputMode="decimal"
                value={valores[u] ?? ""}
                onChange={(e) => {
                  setValores({ ...valores, [u]: e.target.value });
                  setEstado("");
                }}
                placeholder="sem meta"
              />
            </div>
          </div>
        ))}
      </div>
      <div className="pessoas-acoes">
        <button type="submit" className="btn btn-pri" disabled={!mudadas.length || estado === "salvando"}>
          {estado === "salvando" ? "Salvando…" : mudadas.length ? `Salvar ${mudadas.length === 1 ? "1 meta" : `${mudadas.length} metas`}` : "Salvar metas"}
        </button>
        <span role="status" className={estado && estado !== "salvo" && estado !== "salvando" ? "erro-campo" : "metas-cfg-ok"}>
          {estado === "salvo" ? "Metas salvas." : estado !== "salvando" ? estado : ""}
        </span>
      </div>
    </form>
  );
}
