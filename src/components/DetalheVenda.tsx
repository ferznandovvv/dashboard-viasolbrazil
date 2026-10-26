"use client";

import { useEffect, useState } from "react";
import type { NormalizedOrder } from "@/lib/types";
import { nomeForma } from "./CaixaDoDia";
import { brl } from "./viz";

/** Vendas de loja já abertas nesta visita: abrir de novo não consulta a TOTVS outra vez */
const jaBuscadas = new Map<string, NormalizedOrder>();

/**
 * O que tem dentro de uma venda: produtos, forma de pagamento, vendedora e
 * desconto. Os pedidos online já chegam com os produtos; a venda de loja vem
 * sem eles quando nenhuma loja está selecionada, e aí busca só esta nota.
 */
export function DetalheVenda({ o }: { o: NormalizedOrder }) {
  const buscar = o.channel === "lojas" && !o.items?.length;
  const [v, setV] = useState<NormalizedOrder | null>(buscar ? (jaBuscadas.get(o.id) ?? null) : o);
  const [erro, setErro] = useState("");

  useEffect(() => {
    if (!buscar || jaBuscadas.has(o.id)) return;
    let vivo = true;
    fetch(`/api/venda?${new URLSearchParams({ id: o.id, data: o.createdAt.slice(0, 10) })}`, { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!vivo) return;
        if (r.ok && j.venda) {
          jaBuscadas.set(o.id, j.venda);
          setV(j.venda);
        } else setErro(j.erro ?? `A TOTVS não respondeu (HTTP ${r.status}).`);
      })
      .catch(() => vivo && setErro("Sem conexão para buscar os produtos."));
    return () => {
      vivo = false;
    };
  }, [buscar, o.id, o.createdAt]);

  const d = v ?? o;
  const pecas = Math.abs(d.qty ?? 0);
  const itens = d.items ?? [];

  return (
    <div className="venda-det">
      <dl className="venda-det-info">
        {!d.devolucao && (
          <div>
            <dt>Pagamento</dt>
            <dd>{d.payment ? nomeForma(d.payment) : "não informado"}</dd>
          </div>
        )}
        {d.seller && (
          <div>
            <dt>Vendedora</dt>
            <dd>{d.seller}</dd>
          </div>
        )}
        {pecas > 0 && (
          <div>
            <dt>{d.devolucao ? "Peças que voltaram" : "Peças"}</dt>
            <dd>{pecas}</dd>
          </div>
        )}
        {(d.discount ?? 0) > 0 && (
          <div>
            <dt>Desconto</dt>
            <dd>{brl.format(d.discount!)}</dd>
          </div>
        )}
      </dl>

      {itens.length > 0 ? (
        <ul className="venda-det-itens" aria-label={d.devolucao ? "Peças devolvidas" : "Produtos"}>
          {itens.map((it, i) => (
            <li key={i}>
              <span className="venda-det-qtd">{Math.abs(it.qty)}×</span>
              <span>{it.title}</span>
              <b>{brl.format(Math.abs(it.revenue))}</b>
            </li>
          ))}
        </ul>
      ) : erro ? (
        <p className="venda-det-msg">Não deu para buscar os produtos: {erro}</p>
      ) : buscar && !v ? (
        <p className="venda-det-msg" role="status">
          Buscando os produtos na TOTVS…
        </p>
      ) : (
        <p className="venda-det-msg">Esta venda veio sem a lista de produtos.</p>
      )}
    </div>
  );
}
