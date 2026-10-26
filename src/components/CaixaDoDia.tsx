import type { CaixaDoDia as Caixa } from "@/app/api/loja/route";

const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const hora = (iso: string) =>
  new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/** "CARTAO CREDITO" → "Cartao credito": a TOTVS manda tudo em caixa alta */
export function nomeForma(f: string): string {
  return f === f.toUpperCase() ? f.charAt(0) + f.slice(1).toLowerCase() : f;
}

function contagem(vendas: number, trocas: number): string {
  const partes = [vendas ? plural(vendas, "venda", "vendas") : "", trocas ? plural(trocas, "troca", "trocas") : ""];
  return partes.filter(Boolean).join(" + ");
}

/**
 * O caixa do dia pelas notas da TOTVS: quanto entrou em cada forma de
 * pagamento e quanto voltou em troca ou devolução. Troco, sangria e
 * suprimento ficam só no PDV.
 */
export function CaixaDoDia({ c }: { c: Caixa }) {
  const maior = Math.max(1, ...c.formas.map((f) => f.valor));
  const vazio = !c.formas.length && !c.devolvido;
  const voltas = [c.trocas ? plural(c.trocas, "troca", "trocas") : "", c.devolucoes ? plural(c.devolucoes, "devolução", "devoluções") : ""]
    .filter(Boolean)
    .join(" e ");

  return (
    <section className="card caixa-dia" aria-labelledby="caixa-dia-titulo">
      <div className="caixa-dia-cab">
        <div>
          <h2 id="caixa-dia-titulo">Caixa de hoje</h2>
          <p className="caixa-dia-sub">
            {vazio ? "Nenhuma venda hoje ainda." : `${plural(c.vendas, "venda", "vendas")}${c.ultima ? ` · última às ${hora(c.ultima)}` : ""}`}
          </p>
        </div>
        {!vazio && (
          <div className="caixa-dia-total">
            <b>{reais(c.liquido)}</b>
            <small>{c.devolvido > 0 ? "líquido, já sem as devoluções" : "total do dia"}</small>
          </div>
        )}
      </div>

      {!vazio && (
        <ul className="caixa-dia-formas" aria-label="Por forma de pagamento">
          {c.formas.map((f) => (
            <li key={f.forma}>
              <span className="caixa-dia-forma">{nomeForma(f.forma)}</span>
              <span className="caixa-dia-barra" aria-hidden="true">
                <i style={{ width: `${(f.valor / maior) * 100}%` }} />
              </span>
              <b>{reais(f.valor)}</b>
              <small>{contagem(f.vendas, f.trocas)}</small>
            </li>
          ))}
          {c.devolvido > 0 && (
            <li className="caixa-dia-volta">
              <span className="caixa-dia-forma">Voltou ({voltas})</span>
              <span className="caixa-dia-barra" aria-hidden="true" />
              <b>−{reais(c.devolvido)}</b>
              <small>peças devolvidas</small>
            </li>
          )}
        </ul>
      )}

      <p className="caixa-dia-nota">
        Pelas notas emitidas na TOTVS, atualiza a cada 5 minutos. Troco, sangria e suprimento não aparecem aqui: confira a gaveta no fechamento do PDV.
      </p>
    </section>
  );
}
