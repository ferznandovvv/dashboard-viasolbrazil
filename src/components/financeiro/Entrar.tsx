"use client";

import { useState } from "react";
import { api } from "./comum";

/** Login do financeiro — ou, no primeiro acesso, criação do administrador. */
export function Entrar({ primeiro, aoEntrar }: { primeiro: boolean; aoEntrar: () => void }) {
  const [nome, setNome] = useState("");
  const [login, setLogin] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    setEnviando(true);
    setErro("");
    try {
      await api(primeiro ? "/api/financeiro/setup" : "/api/financeiro/sessao", {
        method: "POST",
        body: JSON.stringify({ nome, login, senha }),
      });
      aoEntrar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não deu certo.");
    } finally {
      setEnviando(false);
    }
  };

  return (
    <form className="card fin-entrar" onSubmit={enviar}>
      <h2>{primeiro ? "Primeiro acesso ao financeiro" : "Entrar no financeiro"}</h2>
      {primeiro && (
        <p className="muted" style={{ fontSize: 13, margin: "0 0 14px" }}>
          Crie o seu usuário de administrador. Depois você cadastra a equipe em Cadastros → Usuários.
        </p>
      )}
      {primeiro && (
        <label className="config-campo">
          <span>Seu nome</span>
          <input value={nome} onChange={(e) => setNome(e.target.value)} autoFocus />
        </label>
      )}
      <label className="config-campo">
        <span>Usuário</span>
        <input
          value={login}
          onChange={(e) => setLogin(e.target.value)}
          autoFocus={!primeiro}
          autoCapitalize="none"
          placeholder="ex.: fernando"
        />
      </label>
      <label className="config-campo">
        <span>Senha{primeiro && " (mínimo 6 caracteres)"}</span>
        <input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} />
      </label>
      {erro && <div className="err-msg" style={{ marginBottom: 10 }}>{erro}</div>}
      <button className="buscar" disabled={enviando}>
        {enviando ? "Entrando…" : primeiro ? "Criar e entrar" : "Entrar"}
      </button>
    </form>
  );
}
