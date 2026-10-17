"use client";

import { useRef } from "react";

export interface Aba<T extends string> {
  id: T;
  nome: React.ReactNode;
}

/**
 * Abas acessíveis: o leitor de tela anuncia "aba, 1 de 3, selecionada", o Tab
 * entra só na aba atual e as setas (e Home/End) passam de uma para outra.
 * `className` mantém o desenho de cada lugar (abas do módulo, seletor .seg).
 */
export function Abas<T extends string>({
  abas,
  atual,
  aoMudar,
  rotulo,
  className = "abas-modulo",
}: {
  abas: Aba<T>[];
  atual: T;
  aoMudar: (id: T) => void;
  rotulo: string;
  className?: string;
}) {
  const lista = useRef<HTMLDivElement>(null);

  const teclas = (e: React.KeyboardEvent, i: number) => {
    const destino =
      e.key === "ArrowRight" ? (i + 1) % abas.length
      : e.key === "ArrowLeft" ? (i - 1 + abas.length) % abas.length
      : e.key === "Home" ? 0
      : e.key === "End" ? abas.length - 1
      : -1;
    if (destino < 0) return;
    e.preventDefault();
    aoMudar(abas[destino].id);
    lista.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[destino]?.focus();
  };

  return (
    <div ref={lista} className={className} role="tablist" aria-label={rotulo}>
      {abas.map((a, i) => {
        const on = a.id === atual;
        return (
          <button
            key={a.id}
            type="button"
            role="tab"
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            className={on ? "on" : ""}
            onClick={() => aoMudar(a.id)}
            onKeyDown={(e) => teclas(e, i)}
          >
            {a.nome}
          </button>
        );
      })}
    </div>
  );
}
