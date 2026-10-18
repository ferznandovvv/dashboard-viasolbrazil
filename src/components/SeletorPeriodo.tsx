"use client";

import { useState } from "react";
import { type Period, spToday } from "@/lib/periodos";

/**
 * Escolha do período, igual em todas as telas: vale assim que toca, sem botão
 * de aplicar. "Personalizado" já abre com as datas do período que estava na
 * tela, para só ajustar; o destaque fica sempre no que está valendo.
 */
export function SeletorPeriodo({
  opcoes,
  atual,
  aoMudar,
  rotulo = "Período",
}: {
  opcoes: Period[];
  atual: Period;
  aoMudar: (p: Period) => void;
  rotulo?: string;
}) {
  const [aberto, setAberto] = useState(atual.key === "custom");
  const [de, setDe] = useState(atual.key === "custom" ? atual.from : "");
  const [ate, setAte] = useState(atual.key === "custom" ? atual.to : "");
  const personalizado = aberto || atual.key === "custom";
  // Período personalizado que veio de fora (link, recarregar): mostra as datas dele
  const deTela = de || (atual.key === "custom" ? atual.from : "");
  const ateTela = ate || (atual.key === "custom" ? atual.to : "");
  const invertido = Boolean(deTela && ateTela && deTela > ateTela);

  const trocarDatas = (d: string, a: string) => {
    setDe(d);
    setAte(a);
    if (d && a && d <= a) aoMudar({ key: "custom", from: d, to: a });
  };

  return (
    <div className="periodo">
      <div className="filters" role="group" aria-label={rotulo}>
        {opcoes.map((p) => {
          const on = !personalizado && atual.key === p.key;
          return (
            <button
              key={p.key}
              type="button"
              className={on ? "active" : ""}
              aria-pressed={on}
              onClick={() => {
                setAberto(false);
                aoMudar(p);
              }}
            >
              {p.key}
            </button>
          );
        })}
        <button
          type="button"
          className={personalizado ? "active" : ""}
          aria-pressed={personalizado}
          aria-expanded={personalizado}
          onClick={() => {
            const d = deTela || atual.from;
            const a = ateTela || atual.to;
            setAberto(true);
            trocarDatas(d, a);
          }}
        >
          Personalizado
        </button>
      </div>
      {personalizado && (
        <div className="custom-range">
          <label>
            <span className="so-leitor">Data inicial</span>
            <input type="date" value={deTela} max={spToday()} onChange={(e) => trocarDatas(e.target.value, ateTela)} />
          </label>
          <span className="muted" aria-hidden="true">
            até
          </span>
          <label>
            <span className="so-leitor">Data final</span>
            <input type="date" value={ateTela} max={spToday()} onChange={(e) => trocarDatas(deTela, e.target.value)} />
          </label>
          {invertido && (
            <span className="erro-campo" role="alert">
              A data inicial precisa ser antes da final.
            </span>
          )}
        </div>
      )}
    </div>
  );
}
