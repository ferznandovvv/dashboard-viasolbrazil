"use client";

import { Cabecalho } from "@/components/Moldura";
import { Abas } from "@/components/Abas";
import { useCallback, useEffect, useState } from "react";
import { type Resumo, api } from "@/components/crm/comum";
import { VisaoGeral } from "@/components/crm/VisaoGeral";
import { Clientes } from "@/components/crm/Clientes";
import { Configurar } from "@/components/crm/Configurar";
import { Campanhas } from "@/components/crm/Campanhas";
import type { FiltroCampanha } from "@/lib/crm/tipos";
import { Analise } from "@/components/crm/Analise";

type Aba = "geral" | "campanhas" | "clientes" | "analise" | "configurar";

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
      <Cabecalho titulo="CRM das lojas">
        <a className="btn btn-sec btn-sm" href="/crm/loja" target="_blank" rel="noreferrer">
          Abrir o painel da loja <span className="so-leitor">(abre em outra aba)</span>
        </a>
      </Cabecalho>

      {!r ? (
        <div className="empty">{erro || "Carregando…"}</div>
      ) : !r.local ? (
        <div className="card">O CRM guarda a base de clientes no computador da empresa, então só funciona no sistema rodando lá.</div>
      ) : (
        <>
          <Abas
            rotulo="CRM"
            abas={(
              [
                ["geral", "Visão geral"],
                ["campanhas", "Campanhas"],
                ["clientes", "Clientes"],
                ["analise", "Análise"],
                ["configurar", "Configurar"],
              ] as [Aba, string][]
            ).map(([id, nome]) => ({ id, nome }))}
            atual={aba}
            aoMudar={setAba}
          />
          {aba === "geral" && <VisaoGeral r={r} />}
          {aba === "campanhas" && (
            <Campanhas lojas={r.lojas} filtroInicial={filtroCampanha} limparFiltroInicial={() => setFiltroCampanha(undefined)} irPara={setAba} recarregar={carregar} />
          )}
          {aba === "clientes" && <Clientes r={r} recarregar={carregar} novaCampanha={novaCampanha} />}
          {aba === "analise" && <Analise validade={r.validade} />}
          {aba === "configurar" && <Configurar r={r} recarregar={carregar} />}
        </>
      )}
    </main>
  );
}
