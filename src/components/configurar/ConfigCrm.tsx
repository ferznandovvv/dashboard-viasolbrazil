"use client";

import { useCallback, useEffect, useState } from "react";
import { type Resumo, api } from "@/components/crm/comum";
import { Configurar } from "@/components/crm/Configurar";

/**
 * Configurações › CRM: cashback, automações, envio, números de WhatsApp,
 * textos, dados e backup do CRM. É a mesma tela que ficava dentro do CRM,
 * agora junto com as outras configurações do sistema.
 */
export function ConfigCrm() {
  const [r, setR] = useState<Resumo | null>(null);
  const [erro, setErro] = useState("");

  const carregar = useCallback(async () => {
    try {
      setR(await api<Resumo>("/api/crm/resumo"));
      setErro("");
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro");
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  if (!r) return <div className="empty">{erro || "Carregando…"}</div>;
  if (!r.local) return <div className="card">O CRM guarda a base de clientes no computador da empresa, então só funciona no sistema rodando lá.</div>;
  return <Configurar r={r} recarregar={carregar} />;
}
