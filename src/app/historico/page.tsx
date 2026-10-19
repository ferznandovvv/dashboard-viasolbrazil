"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Cabecalho } from "@/components/Moldura";
import { usePode } from "@/components/sessao";
import { GraficoAnos, MESES_CURTOS } from "@/components/GraficoAnos";
import { brl } from "@/components/viz";
import type { HistoricoMensal } from "@/lib/historico";

const MESES_LONGOS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

/** Nome na tela: deixa claro o que fechou e de quem é o bazar. */
const NOME: Record<string, string> = {
  "Franca Shopping": "Franca Shopping (fechada)",
  Bazar: "Bazar (Loja de Fábrica)",
};
const nome = (l: string) => NOME[l] ?? l;

function Delta({ agora, antes, rotulo }: { agora: number | null; antes: number | null; rotulo?: string }) {
  if (!agora || !antes) return null;
  const pct = Math.round(((agora - antes) / antes) * 100);
  return (
    <span className={`delta ${pct >= 0 ? "up" : "down"}`} title={rotulo}>
      {pct >= 0 ? "↑" : "↓"} {Math.abs(pct)}%
    </span>
  );
}

/** No celular a tabela rola para o lado: abre já nos anos mais recentes. */
const noFim = (el: HTMLDivElement | null) => {
  if (el && !el.dataset.rolou) {
    el.scrollLeft = el.scrollWidth;
    el.dataset.rolou = "1";
  }
};

const soma = (l: (number | null)[]) => (l.some((v) => v !== null) ? l.reduce<number>((t, v) => t + (v ?? 0), 0) : null);

/**
 * Histórico: cada mês comparado com os mesmos meses dos anos anteriores, por
 * loja e do site. Antes da TOTVS e da Shopify, os números vêm da planilha
 * antiga; o bazar da fábrica aparece separado.
 */
export default function PaginaHistorico() {
  const podeConfigurar = usePode("config");
  const [d, setD] = useState<HistoricoMensal | null>(null);
  const [erro, setErro] = useState("");
  const [ver, setVer] = useState("tudo");
  const [comparavel, setComparavel] = useState(true);

  useEffect(() => {
    fetch("/api/historico", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setD)
      .catch(() => setErro("Não consegui carregar o histórico. Recarregue a página."));
  }, []);

  const calc = useMemo(() => {
    if (!d) return null;
    const mesAtual = d.meses[d.meses.length - 1];
    const anoAtual = Number(mesAtual.slice(0, 4));
    const idxAtual = Number(mesAtual.slice(5)) - 1;
    const anos = Array.from(new Set(d.meses.map((m) => Number(m.slice(0, 4)))));
    const fisicas = d.lojas.filter((l) => l !== "Site");

    /** Valor de um mês para o recorte escolhido; null = sem número */
    const valor = (mes: string, recorte: string): number | null => {
      const v = d.valores[mes];
      if (!v) return null;
      const lojas = recorte === "tudo" ? d.lojas : recorte === "fisicas" ? fisicas : [recorte];
      const presentes = lojas.filter((l) => v[l] !== undefined);
      return presentes.length ? presentes.reduce((t, l) => t + v[l], 0) : null;
    };
    const doAno = (ano: number, recorte: string) =>
      MESES_CURTOS.map((_, i) => {
        const mes = `${ano}-${String(i + 1).padStart(2, "0")}`;
        return mes > mesAtual ? null : valor(mes, recorte);
      });
    return { mesAtual, anoAtual, idxAtual, anos, fisicas, valor, doAno };
  }, [d]);

  if (!d || !calc) {
    return (
      <main className="wrap">
        <Cabecalho titulo="Histórico de vendas" />
        <div className="empty">{erro || "Carregando o histórico… a primeira vez pode levar alguns minutos, porque busca anos da TOTVS."}</div>
      </main>
    );
  }

  const { anoAtual, idxAtual, anos, fisicas, doAno } = calc;
  const porAno = new Map(anos.map((a) => [a, doAno(a, ver)]));
  const tons = ["var(--ano-1)", "var(--ano-2)", "var(--ano-3)", "var(--ano-4)"];
  const noGrafico = anos.slice(-4).map((ano, i, l) => ({ ano, valores: porAno.get(ano)!, cor: tons[4 - l.length + i] }));

  // Até o último mês fechado do ano atual: é o que dá para comparar com os anos anteriores
  const ate = idxAtual - 1;
  const ytd = (ano: number) => (ate >= 0 ? soma(porAno.get(ano)?.slice(0, ate + 1) ?? []) : null);
  const anoInteiro = (ano: number) => soma(porAno.get(ano) ?? []);
  const periodo = ate >= 0 ? `jan–${MESES_CURTOS[ate]}` : "";

  const notasDoRecorte = Object.entries(d.notas)
    .flatMap(([mes, n]) => Object.entries(n).filter(([l]) => l === ver).map(([, texto]) => ({ mes, texto })))
    .sort((a, b) => a.mes.localeCompare(b.mes));
  const temNota = (mes: string) => notasDoRecorte.some((n) => n.mes === mes);
  const nomeMes = (mes: string) => `${MESES_LONGOS[Number(mes.slice(5)) - 1]} de ${mes.slice(0, 4)}`;

  // Tabela por loja: soma do ano inteiro ou só até o último mês fechado
  const ateLoja = comparavel && ate >= 0 ? ate : 11;
  const totalLoja = (recorte: string, ano: number) => soma(doAno(ano, recorte).slice(0, ateLoja + 1));
  const linhasLoja = [
    ...fisicas.map((l) => ({ chave: l, rotulo: nome(l), classe: "" })),
    { chave: "fisicas", rotulo: "Lojas físicas", classe: "subtotal" },
    ...(d.lojas.includes("Site") ? [{ chave: "Site", rotulo: "Site", classe: "" }] : []),
    { chave: "tudo", rotulo: "Total", classe: "total" },
  ];

  return (
    <main className="wrap historico">
      <Cabecalho titulo="Histórico de vendas">
        <label className="hist-ver">
          <span>Ver</span>
          <select value={ver} onChange={(e) => setVer(e.target.value)}>
            <option value="tudo">Tudo (lojas e site)</option>
            <option value="fisicas">Lojas físicas</option>
            {d.lojas.map((l) => (
              <option key={l} value={l}>
                {nome(l)}
              </option>
            ))}
          </select>
        </label>
      </Cabecalho>

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

      <div className="tiles">
        {ate >= 0 && (
          <div className="tile">
            <div className="label">
              {periodo} de {anoAtual}
            </div>
            <div className="value">{ytd(anoAtual) === null ? "—" : brl.format(ytd(anoAtual)!)}</div>
            <Delta agora={ytd(anoAtual)} antes={ytd(anoAtual - 1)} rotulo={`vs ${periodo} de ${anoAtual - 1}`} />
            {ytd(anoAtual - 1) !== null && <span className="hist-vs">vs {periodo} de {anoAtual - 1}</span>}
          </div>
        )}
        {anos.includes(anoAtual - 1) && (
          <div className="tile">
            <div className="label">{anoAtual - 1} inteiro</div>
            <div className="value">{anoInteiro(anoAtual - 1) === null ? "—" : brl.format(anoInteiro(anoAtual - 1)!)}</div>
            <Delta agora={anoInteiro(anoAtual - 1)} antes={anoInteiro(anoAtual - 2)} rotulo={`vs ${anoAtual - 2}`} />
            {anoInteiro(anoAtual - 2) !== null && <span className="hist-vs">vs {anoAtual - 2}</span>}
          </div>
        )}
      </div>

      <section className="card">
        <h2>Mês a mês — {ver === "tudo" ? "lojas e site" : ver === "fisicas" ? "lojas físicas" : nome(ver)}</h2>
        <GraficoAnos anos={noGrafico} parcial={{ ano: anoAtual, mes: idxAtual }} />
        <p className="hist-rodape">
          {MESES_LONGOS[idxAtual]} de {anoAtual} vai até hoje (linha tracejada). Passe o mouse para ver todos os anos de um mês.
        </p>
      </section>

      <section className="card">
        <h2>Tabela mês a mês</h2>
        <div className="tbl-wrap" ref={noFim} tabIndex={0} role="region" aria-label="Tabela mês a mês">
          <table className="prod-tbl hist-tbl" style={{ "--anos": anos.length } as React.CSSProperties}>
            <thead>
              <tr>
                <th scope="col">Mês</th>
                {anos.map((a) => (
                  <th key={a} scope="col" className="n">
                    {a}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {MESES_LONGOS.map((m, i) => (
                <tr key={m}>
                  <th scope="row">{m}</th>
                  {anos.map((a, k) => {
                    const v = porAno.get(a)![i];
                    const mes = `${a}-${String(i + 1).padStart(2, "0")}`;
                    const atual = a === anoAtual && i === idxAtual;
                    return (
                      <td key={a} className="n">
                        {v === null ? <span className="vazio">—</span> : reais(v)}
                        {temNota(mes) && (
                          <sup className="hist-nota" title={notasDoRecorte.find((n) => n.mes === mes)?.texto}>
                            *
                          </sup>
                        )}
                        {atual && v !== null && <small className="hist-parcial">até hoje</small>}
                        {k > 0 && !atual && <Delta agora={v} antes={porAno.get(anos[k - 1])![i]} rotulo={`vs ${m} de ${anos[k - 1]}`} />}
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr className="total">
                <th scope="row">Total do ano</th>
                {anos.map((a) => (
                  <td key={a} className="n">
                    {anoInteiro(a) === null ? "—" : reais(anoInteiro(a)!)}
                    {a === anoAtual && <small className="hist-parcial">até hoje</small>}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        {notasDoRecorte.length > 0 && (
          <ul className="hist-notas">
            {notasDoRecorte.map((n) => (
              <li key={n.mes}>
                * {nomeMes(n.mes)}: {n.texto}.
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <div className="hist-cab">
          <h2>Por loja, ano a ano</h2>
          {ate >= 0 && (
            <div className="ux-chips" role="group" aria-label="Período de cada ano">
              <button type="button" className={comparavel ? "on" : ""} aria-pressed={comparavel} onClick={() => setComparavel(true)}>
                {periodo} de cada ano
              </button>
              <button type="button" className={!comparavel ? "on" : ""} aria-pressed={!comparavel} onClick={() => setComparavel(false)}>
                Ano inteiro
              </button>
            </div>
          )}
        </div>
        <div className="tbl-wrap" ref={noFim} tabIndex={0} role="region" aria-label="Vendas por loja, ano a ano">
          <table className="prod-tbl hist-tbl" style={{ "--anos": anos.length } as React.CSSProperties}>
            <thead>
              <tr>
                <th scope="col">Loja</th>
                {anos.map((a) => (
                  <th key={a} scope="col" className="n">
                    {a}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {linhasLoja.map((l) => (
                <tr key={l.chave} className={l.classe}>
                  <th scope="row">{l.rotulo}</th>
                  {anos.map((a, k) => {
                    const v = totalLoja(l.chave, a);
                    return (
                      <td key={a} className="n">
                        {v === null ? <span className="vazio">—</span> : reais(v)}
                        {k > 0 && (comparavel || a !== anoAtual) && <Delta agora={v} antes={totalLoja(l.chave, anos[k - 1])} rotulo={`vs ${anos[k - 1]}`} />}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="hist-rodape">
          {comparavel && ate >= 0
            ? `Cada ano somado de janeiro a ${MESES_LONGOS[ate]}, para comparar o mesmo período.`
            : `${anoAtual} vai até hoje.`}
        </p>
      </section>

      <p className="hist-rodape">
        Meses sem TOTVS ou Shopify vêm da planilha antiga{d.planilhaAte ? ` (até ${nomeMes(d.planilhaAte)})` : ""}. O Franca
        Shopping fechou em julho de 2026 e a Fiusa abriu em agosto. O bazar é da Loja de Fábrica e aparece separado. Os
        marketplaces (TikTok Shop, Mercado Livre e Shopee) não entram aqui.
        {d.erros.length > 0 && ` Alguns meses podem estar incompletos: ${d.erros.join("; ")}.`}
      </p>
    </main>
  );
}

/** Valor inteiro em reais na tabela (sem centavos, para caber). */
function reais(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}
