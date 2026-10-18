"use client";

import { Cabecalho } from "@/components/Moldura";
import { Abas } from "@/components/Abas";
import { usePode } from "@/components/sessao";
import { useCallback, useEffect, useState } from "react";
import { type Resumo, api } from "@/components/crm/comum";
import { VisaoGeral } from "@/components/crm/VisaoGeral";
import { Clientes } from "@/components/crm/Clientes";
import { Campanhas } from "@/components/crm/Campanhas";
import type { FiltroCampanha } from "@/lib/crm/tipos";
import { Analise } from "@/components/crm/Analise";

type Aba = "geral" | "campanhas" | "clientes" | "analise";

/** As configurações do CRM ficam em Configurações, junto com as do resto do sistema */
const CONFIG_CRM = "/configurar?aba=crm";

/** CRM das lojas físicas: clientes, cashback e mensagens de WhatsApp. */
export default function Crm() {
  const [r, setR] = useState<Resumo | null>(null);
  const [erro, setErro] = useState("");
  const [aba, setAba] = useState<Aba>("geral");
  const [filtroCampanha, setFiltroCampanha] = useState<Partial<FiltroCampanha> | undefined>();
  const podeConfig = usePode("config");

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

  // Link direto para uma aba; o endereço antigo da aba Configurar leva para Configurações › CRM
  useEffect(() => {
    const a = new URLSearchParams(window.location.search).get("aba");
    if (a === "configurar") window.location.replace(CONFIG_CRM);
    else if (a === "geral" || a === "campanhas" || a === "clientes" || a === "analise") setAba(a);
  }, []);

  const novaCampanha = (f: Partial<FiltroCampanha>) => {
    setFiltroCampanha(f);
    setAba("campanhas");
  };

  return (
    <main className="wrap">
      <Cabecalho titulo="CRM das lojas">
        {podeConfig && (
          <a className="btn btn-sec btn-sm" href={CONFIG_CRM}>
            Configurações do CRM
          </a>
        )}
        <a className="btn btn-sec btn-sm" href="/crm/loja" target="_blank" rel="noreferrer">
          Abrir a tela da loja <span className="so-leitor">(abre em outra aba)</span>
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
              ] as [Aba, string][]
            ).map(([id, nome]) => ({ id, nome }))}
            atual={aba}
            aoMudar={setAba}
          />
          {aba === "geral" && <VisaoGeral r={r} />}
          {aba === "campanhas" && (
            <Campanhas lojas={r.lojas} filtroInicial={filtroCampanha} limparFiltroInicial={() => setFiltroCampanha(undefined)} irPara={() => (window.location.href = CONFIG_CRM)} recarregar={carregar} />
          )}
          {aba === "clientes" && <Clientes r={r} recarregar={carregar} novaCampanha={novaCampanha} />}
          {aba === "analise" && <Analise validade={r.validade} />}
        </>
      )}
    </main>
  );
}
