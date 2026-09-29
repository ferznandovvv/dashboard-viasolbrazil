"use client";

import Link from "next/link";
import { useState } from "react";
import { Produtos } from "@/components/produtos";
import { type Period, buildPresets } from "@/lib/periodos";

/**
 * Produtos e estoque em página própria: é a consulta mais pesada do sistema,
 * e a dashboard de vendas precisa continuar leve.
 */
export default function PaginaProdutos() {
  const [presets] = useState(buildPresets);
  const [period, setPeriod] = useState<Period>(presets[3]); // Mês atual
  const [sel, setSel] = useState<string[]>([]);
  const [agrup, setAgrup] = useState<"modelo" | "cor" | "tamanho" | "completo">("modelo");

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

      <Produtos
        from={period.from}
        to={period.to}
        units={sel}
        agrup={agrup}
        aoAlternarLoja={alternar}
        aoTrocarAgrup={setAgrup}
      />
    </main>
  );
}
