"use client";

import { Cabecalho } from "@/components/Moldura";
import { Abas } from "@/components/Abas";
import { useCallback, useEffect, useState } from "react";
import type { UsuarioPublico } from "@/lib/financeiro/tipos";
import { type Cadastros as DadosCadastros, api } from "@/components/financeiro/comum";
import { Contas } from "@/components/financeiro/Contas";
import { Dre } from "@/components/financeiro/Dre";
import { Cadastros } from "@/components/financeiro/Cadastros";

type Aba = "contas" | "dre" | "cadastros";

interface Sessao {
  local: boolean;
  usuario?: UsuarioPublico | null;
}

/** Financeiro: contas a pagar, DRE e cadastros. Quem entra é a pessoa logada no sistema. */
export default function Financeiro() {
  const [sessao, setSessao] = useState<Sessao | null>(null);
  const [cad, setCad] = useState<DadosCadastros | null>(null);
  const [aba, setAba] = useState<Aba>("contas");

  const carregarCadastros = useCallback(async () => {
    setCad(await api<DadosCadastros>("/api/financeiro/cadastros"));
  }, []);

  const carregar = useCallback(async () => {
    const s = await api<Sessao>("/api/financeiro/sessao");
    setSessao(s);
    if (s.usuario) await carregarCadastros();
  }, [carregarCadastros]);

  useEffect(() => {
    carregar().catch(() => setSessao({ local: true, usuario: null }));
  }, [carregar]);

  const u = sessao?.usuario;
  const veDre = u?.papel === "admin" || u?.veDre;
  return (
    <main className="wrap">
      <Cabecalho titulo="Financeiro">
        {u?.somenteVer && <span className="selo-consulta">Só consulta</span>}
      </Cabecalho>

      {!sessao ? (
        <div className="empty">Carregando…</div>
      ) : !sessao.local ? (
        <div className="card">O financeiro guarda os lançamentos no computador da empresa, então só funciona no sistema rodando lá.</div>
      ) : !u ? (
        <div className="card">Seu usuário não tem acesso ao financeiro.</div>
      ) : !cad ? (
        <div className="empty">Carregando…</div>
      ) : (
        <>
          <Abas
            rotulo="Financeiro"
            abas={[
              { id: "contas" as Aba, nome: "Contas a pagar" },
              ...(veDre ? [{ id: "dre" as Aba, nome: "DRE" }] : []),
              ...(u.somenteVer ? [] : [{ id: "cadastros" as Aba, nome: u.papel === "admin" ? "Cadastros" : "Categorias" }]),
            ]}
            atual={aba}
            aoMudar={setAba}
          />
          {aba === "contas" && <Contas cad={cad} usuario={u} aoMudarCadastros={carregarCadastros} />}
          {aba === "dre" && veDre && <Dre cad={cad} />}
          {aba === "cadastros" && !u.somenteVer && <Cadastros cad={cad} admin={u.papel === "admin"} aoMudar={carregarCadastros} />}
        </>
      )}
    </main>
  );
}
