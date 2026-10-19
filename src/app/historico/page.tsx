"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Cabecalho } from "@/components/Moldura";
import { usePode } from "@/components/sessao";
import { GraficoAnos, MESES_CURTOS } from "@/components/GraficoAnos";
import type { HistoricoMensal } from "@/lib/historico";

const MESES_LONGOS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

/** Linhas na ordem da planilha que a Via Sol usava. */
const ORDEM = [
  "Franca Shopping",
  "Centro",
  "Site",
  "Rio de Janeiro",
  "SP — Itaim",
  "Belo Horizonte",
  "Praia Grande",
  "Ribeirão Preto",
  "Loja de Fábrica",
  "Bazar",
  "Fiusa",
];

/** Nome na tela: deixa claro o que fechou e de quem é o bazar. */
const NOME: Record<string, string> = {
  "Franca Shopping": "Franca Shopping (fechada)",
  Bazar: "Bazar (Loja de Fábrica)",
};
const nome = (l: string) => NOME[l] ?? l;

/** Valor em reais sem centavos e sem "R$", para os 12 meses caberem. */
const reais = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
const cheio = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const mesDe = (ano: number, i: number) => `${ano}-${String(i + 1).padStart(2, "0")}`;

/** No celular a tabela rola para o lado: abre já nos meses mais recentes. */
const noFim = (el: HTMLDivElement | null) => {
  if (el && !el.dataset.rolou) {
    el.scrollLeft = el.scrollWidth;
    el.dataset.rolou = "1";
  }
};

/**
 * Histórico: vendas mês a mês de cada loja e do site, um quadro por ano,
 * como na planilha. Antes da TOTVS e da Shopify, os números vêm da planilha
 * antiga; o bazar da fábrica aparece separado. No fim, o gráfico compara os
 * anos.
 */
export default function PaginaHistorico() {
  const podeConfigurar = usePode("config");
  const [d, setD] = useState<HistoricoMensal | null>(null);
  const [erro, setErro] = useState("");
  const [ver, setVer] = useState("tudo");

  useEffect(() => {
    fetch("/api/historico", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setD)
      .catch(() => setErro("Não consegui carregar o histórico. Recarregue a página."));
  }, []);

  if (!d) {
    return (
      <main className="wrap">
        <Cabecalho titulo="Histórico de vendas" />
        <div className="empty">{erro || "Carregando o histórico… a primeira vez pode levar alguns minutos, porque busca anos da TOTVS."}</div>
      </main>
    );
  }

  const mesAtual = d.meses[d.meses.length - 1];
  const anoAtual = Number(mesAtual.slice(0, 4));
  const idxAtual = Number(mesAtual.slice(5)) - 1;
  const anos = Array.from(new Set(d.meses.map((m) => Number(m.slice(0, 4)))));
  const lojas = [...d.lojas].sort((a, b) => (ORDEM.indexOf(a) + 1 || 90) - (ORDEM.indexOf(b) + 1 || 90));
  const valor = (loja: string, mes: string) => d.valores[mes]?.[loja];
  const nota = (loja: string, mes: string) => d.notas[mes]?.[loja];
  const nomeMes = (mes: string) => `${MESES_LONGOS[Number(mes.slice(5)) - 1]} de ${mes.slice(0, 4)}`;

  // Gráfico: um recorte (tudo, lojas físicas ou uma loja), um ano por linha
  const fisicas = d.lojas.filter((l) => l !== "Site");
  const doRecorte = (mes: string) => {
    const v = d.valores[mes];
    if (!v || mes > mesAtual) return null;
    const escolhidas = ver === "tudo" ? d.lojas : ver === "fisicas" ? fisicas : [ver];
    const presentes = escolhidas.filter((l) => v[l] !== undefined);
    return presentes.length ? presentes.reduce((t, l) => t + v[l], 0) : null;
  };
  const tons = ["var(--ano-1)", "var(--ano-2)", "var(--ano-3)", "var(--ano-4)"];
  const noGrafico = anos.slice(-4).map((ano, i, l) => ({
    ano,
    valores: MESES_CURTOS.map((_, m) => doRecorte(mesDe(ano, m))),
    cor: tons[4 - l.length + i],
  }));

  return (
    <main className="wrap historico">
      <Cabecalho titulo="Histórico de vendas" />

      {d.planilha !== "ok" && (
        <div className="card hist-aviso">
          {d.planilha === "sem-chave" && "As vendas de antes da TOTVS ainda não aparecem: falta colar a chave das vendas antigas"}
          {d.planilha === "chave-errada" && "A chave das vendas antigas não abre o arquivo. Confira a chave"}
          {d.planilha === "sem-arquivo" && "O arquivo das vendas antigas não está nesta instalação. Peça para atualizar o sistema"}
          {d.planilha !== "sem-arquivo" &&
            (podeConfigurar ? (
              <>
                {" "}
                em <Link href="/configurar?aba=integracoes">Configurações › Integrações</Link>.
              </>
            ) : (
              " em Configurações › Integrações (com o usuário do dono)."
            ))}
        </div>
      )}

      {[...anos].reverse().map((ano) => {
        const comValor = lojas.filter((l) => MESES_CURTOS.some((_, i) => valor(l, mesDe(ano, i)) !== undefined));
        const doMes = (i: number) => {
          const mes = mesDe(ano, i);
          const v = comValor.map((l) => valor(l, mes)).filter((x): x is number => x !== undefined);
          return v.length ? v.reduce((t, x) => t + x, 0) : undefined;
        };
        const totalAno = (l: string) => MESES_CURTOS.reduce((t, _, i) => t + (valor(l, mesDe(ano, i)) ?? 0), 0);
        const notasDoAno = comValor.flatMap((l) =>
          MESES_CURTOS.map((_, i) => mesDe(ano, i))
            .filter((mes) => nota(l, mes))
            .map((mes) => ({ chave: `${l}|${mes}`, texto: `${nome(l)}, ${nomeMes(mes)}: ${nota(l, mes)}` }))
        );
        const futuro = (i: number) => ano === anoAtual && i > idxAtual;
        const geral = comValor.reduce((t, l) => t + totalAno(l), 0);
        return (
          <section key={ano} className="card">
            <h2>Vendas mês a mês — {ano}</h2>
            {comValor.length === 0 ? (
              <div className="empty">Sem vendas registradas em {ano}.</div>
            ) : (
              <div className="tbl-wrap" ref={noFim} tabIndex={0} role="region" aria-label={`Vendas mês a mês de ${ano}`}>
                <table className="prod-tbl hist-tbl hist-matriz">
                  <thead>
                    <tr>
                      <th scope="col">Loja</th>
                      {MESES_CURTOS.map((m, i) => (
                        <th key={m} scope="col" className="n">
                          <abbr title={MESES_LONGOS[i]}>{m}</abbr>
                          {ano === anoAtual && i === idxAtual && (
                            <sup className="hist-nota" title="vai até hoje">
                              *
                            </sup>
                          )}
                        </th>
                      ))}
                      <th scope="col" className="n">
                        Total
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {comValor.map((l) => (
                      <tr key={l}>
                        <th scope="row">{nome(l)}</th>
                        {MESES_CURTOS.map((m, i) => {
                          const v = valor(l, mesDe(ano, i));
                          const n = nota(l, mesDe(ano, i));
                          return (
                            <td key={m} className="n" title={v !== undefined ? cheio(v) : undefined}>
                              {v !== undefined ? reais(v) : futuro(i) ? "" : <span className="vazio">—</span>}
                              {n && (
                                <sup className="hist-nota" title={n}>
                                  *
                                </sup>
                              )}
                            </td>
                          );
                        })}
                        <td className="n total-linha" title={cheio(totalAno(l))}>
                          {reais(totalAno(l))}
                        </td>
                      </tr>
                    ))}
                    <tr className="total">
                      <th scope="row">Total</th>
                      {MESES_CURTOS.map((m, i) => {
                        const v = doMes(i);
                        return (
                          <td key={m} className="n" title={v !== undefined ? cheio(v) : undefined}>
                            {v !== undefined ? reais(v) : ""}
                          </td>
                        );
                      })}
                      <td className="n" title={cheio(geral)}>
                        {reais(geral)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
            {(ano === anoAtual || notasDoAno.length > 0) && (
              <ul className="hist-notas">
                {ano === anoAtual && <li>* {MESES_LONGOS[idxAtual]} vai até hoje.</li>}
                {notasDoAno.map((n) => (
                  <li key={n.chave}>* {n.texto}.</li>
                ))}
              </ul>
            )}
          </section>
        );
      })}

      <section className="card">
        <div className="hist-cab">
          <h2>Comparar os anos</h2>
          <label className="hist-ver">
            <span>Ver</span>
            <select value={ver} onChange={(e) => setVer(e.target.value)}>
              <option value="tudo">Tudo (lojas e site)</option>
              <option value="fisicas">Lojas físicas</option>
              {lojas.map((l) => (
                <option key={l} value={l}>
                  {nome(l)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <GraficoAnos anos={noGrafico} parcial={{ ano: anoAtual, mes: idxAtual }} />
        <p className="hist-rodape">
          {MESES_LONGOS[idxAtual]} de {anoAtual} vai até hoje (linha tracejada). Passe o mouse para ver todos os anos de um mês.
        </p>
      </section>

      <p className="hist-rodape">
        Valores em reais (passe o mouse para ver os centavos). Meses sem TOTVS ou Shopify vêm da planilha antiga
        {d.planilhaAte ? ` (até ${nomeMes(d.planilhaAte)})` : ""}. O Franca Shopping fechou em julho de 2026 e a Fiusa
        abriu em agosto. Os marketplaces (TikTok Shop, Mercado Livre e Shopee) não entram aqui.
        {d.erros.length > 0 && ` Alguns meses podem estar incompletos: ${d.erros.join("; ")}.`}
      </p>
    </main>
  );
}
