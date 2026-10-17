"use client";

import { FAIXAS, type FaixaCliente } from "@/lib/crm/tipos";

/** Classe CSS da faixa (cor do ponto e da barra). */
export const classeFaixa = (f?: FaixaCliente) =>
  `fx-${(f ?? "Sem compra").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, "-")}`;

export const dicaFaixa = (f: FaixaCliente) => FAIXAS.find((x) => x.id === f)?.dica ?? "";

/** Selo pequeno com a faixa, para tabelas e listas. */
export function SeloFaixa({ f }: { f?: FaixaCliente }) {
  return (
    <span className={`fx-selo ${classeFaixa(f)}`} title={f ? dicaFaixa(f) : undefined}>
      <i aria-hidden />
      {f ?? "Sem compra"}
    </span>
  );
}

/**
 * As seis faixas lado a lado, clicáveis: o jeito de ver a base dividida e
 * filtrar ao mesmo tempo. `multi` permite marcar várias (campanha).
 */
export function SeletorFaixas({
  contagens,
  marcadas,
  alternar,
  limpar,
  total,
}: {
  contagens?: Partial<Record<FaixaCliente, number>>;
  marcadas: FaixaCliente[];
  alternar: (f: FaixaCliente) => void;
  limpar: () => void;
  total?: number;
}) {
  return (
    <div className="fx-grade" role="group" aria-label="Faixa da cliente">
      <button className={`fx-cartao fx-todas ${!marcadas.length ? "on" : ""}`} onClick={limpar} aria-pressed={!marcadas.length}>
        <span className="fx-nome">Todas</span>
        <span className="fx-n">{total === undefined ? "" : total.toLocaleString("pt-BR")}</span>
        <span className="fx-dica">a base inteira</span>
      </button>
      {FAIXAS.map((f) => {
        const on = marcadas.includes(f.id);
        const n = contagens?.[f.id];
        return (
          <button key={f.id} className={`fx-cartao ${classeFaixa(f.id)} ${on ? "on" : ""}`} onClick={() => alternar(f.id)} aria-pressed={on}>
            <span className="fx-nome">
              <i aria-hidden />
              {f.id}
            </span>
            <span className="fx-n">{n === undefined ? "" : n.toLocaleString("pt-BR")}</span>
            <span className="fx-dica">{f.dica}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Fileira de botões (lojas, situações) com contagem opcional. */
export function Chips<T extends string>({
  opcoes,
  marcadas,
  alternar,
  rotuloTodas = "Todas",
  limpar,
  contagens,
  totalTodas,
}: {
  opcoes: { id: T; nome: string }[];
  marcadas: T[];
  alternar: (v: T) => void;
  rotuloTodas?: string;
  limpar?: () => void;
  contagens?: Record<string, number>;
  totalTodas?: number;
}) {
  return (
    <div className="ux-chips">
      {limpar && (
        <button className={!marcadas.length ? "on" : ""} onClick={limpar} aria-pressed={!marcadas.length}>
          {rotuloTodas}
          {totalTodas !== undefined && <small>{totalTodas.toLocaleString("pt-BR")}</small>}
        </button>
      )}
      {opcoes.map((o) => {
        const n = contagens?.[o.id];
        const on = marcadas.includes(o.id);
        return (
          <button key={o.id} className={`${on ? "on" : ""} ${contagens && !n && !on ? "vazio" : ""}`} onClick={() => alternar(o.id)} aria-pressed={on}>
            {o.nome}
            {contagens && <small>{(n ?? 0).toLocaleString("pt-BR")}</small>}
          </button>
        );
      })}
    </div>
  );
}
