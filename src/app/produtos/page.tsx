"use client";

import { NavPrincipal } from "@/components/NavPrincipal";
import { Produtos } from "@/components/produtos";

/**
 * Produtos e estoque em página própria: é a consulta mais pesada do sistema,
 * e a dashboard de vendas precisa continuar leve.
 */
export default function PaginaProdutos() {
  return (
    <main className="wrap">
      <div className="topbar">
        <div className="logo">
          <div>
            <span className="brand-word" role="img" aria-label="Via Sol" />
            <span className="tag">produtos e estoque</span>
          </div>
        </div>
        <NavPrincipal atual="/produtos" />
      </div>

      <Produtos />
    </main>
  );
}
