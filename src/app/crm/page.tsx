"use client";

import { NavPrincipal } from "@/components/NavPrincipal";
import { useCallback, useEffect, useState } from "react";
import { type Resumo, api } from "@/components/crm/comum";
import { VisaoGeral } from "@/components/crm/VisaoGeral";
import { Clientes } from "@/components/crm/Clientes";
import { Mensagens } from "@/components/crm/Mensagens";
import { Importar } from "@/components/crm/Importar";
import { Configurar } from "@/components/crm/Configurar";

type Aba = "geral" | "clientes" | "mensagens" | "importar" | "configurar";

/** CRM das lojas físicas: clientes, cashback e mensagens de WhatsApp. */
export default function Crm() {
  const [r, setR] = useState<Resumo | null>(null);
  const [erro, setErro] = useState("");
  const [aba, setAba] = useState<Aba>("geral");
  const [segmento, setSegmento] = useState<string | undefined>();

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

  const irPara = (a: "clientes", seg?: string) => {
    setSegmento(seg);
    setAba(a);
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
                ["clientes", "Clientes"],
                ["mensagens", "Mensagens"],
                ["importar", "Importar"],
                ["configurar", "Configurar"],
              ] as [Aba, string][]
            ).map(([a, nome]) => (
              <button key={a} className={aba === a ? "on" : ""} onClick={() => setAba(a)}>
                {nome}
              </button>
            ))}
          </div>
          {aba === "geral" && <VisaoGeral r={r} recarregar={carregar} irPara={irPara} />}
          {aba === "clientes" && <Clientes r={r} segmentoInicial={segmento} recarregar={carregar} />}
          {aba === "mensagens" && <Mensagens recarregar={carregar} />}
          {aba === "importar" && <Importar r={r} recarregar={carregar} />}
          {aba === "configurar" && <Configurar recarregar={carregar} />}
        </>
      )}
    </main>
  );
}
