"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Produtos } from "@/components/produtos";
import { type Period, buildPresets } from "@/lib/periodos";

/**
 * Produtos e estoque em página própria: é a consulta mais pesada do sistema,
 * e a dashboard de vendas precisa continuar leve.
 */
type Agrup = "modelo" | "cor" | "tamanho" | "completo";

export default function PaginaProdutos() {
  const [presets] = useState(buildPresets);
  const [period, setPeriod] = useState<Period>(presets[3]); // Mês atual
  const [sel, setSel] = useState<string[]>([]);
  const [agrup, setAgrup] = useState<Agrup>("modelo");
  const [pronto, setPronto] = useState(false);
  // Estoque é sempre o de agora: período só entra quando se pede a venda
  const [comVendas, setComVendas] = useState(false);

  // Recupera a escolha anterior: recarregar a página não pode zerar o filtro
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const periodo = p.get("periodo");
    const achado = presets.find((x) => x.key === periodo);
    if (achado) setPeriod(achado);
    const lojas = p.get("lojas");
    if (lojas) setSel(lojas.split(",").filter(Boolean));
    const a = p.get("agrup") as Agrup | null;
    if (a) setAgrup(a);
    setPronto(true);
  }, [presets]);

  // E guarda a atual, sem criar entrada nova no histórico do navegador
  useEffect(() => {
    if (!pronto) return;
    const p = new URLSearchParams(window.location.search);
    p.set("periodo", period.key);
    p.set("agrup", agrup);
    if (sel.length) p.set("lojas", sel.join(","));
    else p.delete("lojas");
    window.history.replaceState(null, "", `?${p.toString()}`);
  }, [pronto, period, sel, agrup]);

  const alternar = (nome: string) =>
    setSel((atual) => (atual.includes(nome) ? atual.filter((x) => x !== nome) : [...atual, nome]));

  return (
    <main className="wrap">
      <div className="topbar">
        <div className="logo">
          <div>
            <span className="brand-word" role="img" aria-label="Via Sol" />
            <span className="tag">produtos e estoque</span>
          </div>
        </div>
        <Link href="/" className="updated">
          ← voltar para vendas
        </Link>
      </div>

      {comVendas && (
        <>
          <div className="passo">
            <span className="passo-num">3</span> Período das vendas
          </div>
          <div className="filters" role="group" aria-label="Período">
            {presets.map((p) => (
              <button
                key={p.key}
                className={period.key === p.key ? "active" : ""}
                onClick={() => setPeriod(p)}
              >
                {p.key}
              </button>
            ))}
          </div>
        </>
      )}

      <Produtos
        from={period.from}
        to={period.to}
        units={sel}
        agrup={agrup}
        aoAlternarLoja={alternar}
        aoTrocarAgrup={setAgrup}
        comVendas={comVendas}
        aoPedirVendas={() => setComVendas(true)}
      />
    </main>
  );
}
