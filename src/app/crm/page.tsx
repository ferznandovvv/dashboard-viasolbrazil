"use client";

import { NavPrincipal } from "@/components/NavPrincipal";
import { useCallback, useEffect, useState } from "react";
import { type Resumo, api } from "@/components/crm/comum";
import { VisaoGeral } from "@/components/crm/VisaoGeral";
import { Clientes } from "@/components/crm/Clientes";
import { Mensagens } from "@/components/crm/Mensagens";
import { Configurar } from "@/components/crm/Configurar";
import { Campanhas } from "@/components/crm/Campanhas";
import type { FiltroCampanha } from "@/lib/crm/tipos";
import { Analise } from "@/components/crm/Analise";

type Aba = "geral" | "campanhas" | "clientes" | "mensagens" | "analise" | "configurar";

/** CRM das lojas físicas: clientes, cashback e mensagens de WhatsApp. */
export default function Crm() {
  const [r, setR] = useState<Resumo | null>(null);
  const [erro, setErro] = useState("");
  const [aba, setAba] = useState<Aba>("geral");
  const [filtroCampanha, setFiltroCampanha] = useState<Partial<FiltroCampanha> | undefined>();

  const carregar = useCallback(async () => {
    try {
      setR(await api<Resumo>("/api/crm/resumo"));
      setErro("");
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro");
    }
  }, []);

  useEffect(() => {
    carregar();
    const t = setInterval(carregar, 60000);
    return () => clearInterval(t);
  }, [carregar]);

  const novaCampanha = (f: Partial<FiltroCampanha>) => {
    setFiltroCampanha(f);
    setAba("campanhas");
  };

  return (
    <main className="wrap">
      <div className="topbar">
        <div className="logo">
          <div>
            <span className="brand-word" role="img" aria-label="Via Sol" />
            <span className="tag">crm das lojas</span>
          </div>
        </div>
        <NavPrincipal atual="/crm" />
        <span className="updated">
          <a href="/crm/loja" target="_blank" rel="noreferrer">
            tela do caixa
          </a>
        </span>
      </div>

      {!r ? (
        <div className="empty">{erro || "Carregando…"}</div>
      ) : !r.local ? (
        <div className="card">O CRM guarda a base de clientes no computador da empresa, então só funciona no sistema rodando lá.</div>
      ) : (
        <>
          <div className="seg abas-prod" role="tablist">
            {(
              [
                ["geral", "Visão geral"],
                ["campanhas", "Campanhas"],
                ["clientes", "Clientes"],
                ["mensagens", "Mensagens"],
                ["analise", "Análise"],
                ["configurar", "Configurar"],
              ] as [Aba, string][]
            ).map(([a, nome]) => (
              <button key={a} className={aba === a ? "on" : ""} onClick={() => setAba(a)}>
                {nome}
              </button>
            ))}
          </div>
          {aba === "geral" && <VisaoGeral />}
          {aba === "campanhas" && (
            <Campanhas lojas={r.lojas} filtroInicial={filtroCampanha} limparFiltroInicial={() => setFiltroCampanha(undefined)} irPara={setAba} />
          )}
          {aba === "clientes" && <Clientes r={r} recarregar={carregar} novaCampanha={novaCampanha} />}
          {aba === "mensagens" && <Mensagens recarregar={carregar} />}
          {aba === "analise" && <Analise validade={r.validade} />}
          {aba === "configurar" && <Configurar r={r} recarregar={carregar} />}
        </>
      )}
    </main>
  );
}
