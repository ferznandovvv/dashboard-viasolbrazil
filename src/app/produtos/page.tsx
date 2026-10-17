"use client";

import { Cabecalho } from "@/components/Moldura";
import { Produtos } from "@/components/produtos";

/**
 * Produtos e estoque em página própria: é a consulta mais pesada do sistema,
 * e a dashboard de vendas precisa continuar leve.
 */
export default function PaginaProdutos() {
  return (
    <main className="wrap">
      <Cabecalho titulo="Produtos e estoque" />

      <Produtos />
    </main>
  );
}
