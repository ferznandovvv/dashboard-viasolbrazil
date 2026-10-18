"use client";

import { useEffect, useState } from "react";

interface Situacao {
  precisaDono: boolean;
  senhaAntiga: boolean;
  pedeSenhaPainel: boolean;
}

/** Volta para a página que a pessoa tentou abrir, se for deste sistema. */
function destino(padrao: string): string {
  const volta = new URLSearchParams(window.location.search).get("volta") ?? "";
  return volta.startsWith("/") && !volta.startsWith("//") ? volta : padrao;
}

export default function Entrar() {
  const [sit, setSit] = useState<Situacao | null>(null);
  const [f, setF] = useState({ nome: "", login: "", senha: "", confirma: "", senhaPainel: "" });
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    fetch("/api/login")
      .then((r) => r.json())
      .then(setSit)
      .catch(() => setSit({ precisaDono: false, senhaAntiga: true, pedeSenhaPainel: false }));
  }, []);

  const criando = Boolean(sit?.precisaDono);
  const campo = (k: keyof typeof f) => ({
    id: `entrar-${k}`,
    value: f[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value }),
  });

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setErro("");
    if (criando && f.senha !== f.confirma) return setErro("As duas senhas não estão iguais.");
    setEnviando(true);
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(criando ? { acao: "criar-dono", ...f } : { login: f.login, senha: f.senha }),
    }).catch(() => null);
    const j = (await res?.json().catch(() => ({}))) as { inicio?: string; erro?: string };
    setEnviando(false);
    if (res?.ok) window.location.href = destino(j.inicio ?? "/");
    else setErro(j?.erro ?? "Não deu para entrar. Confira a internet e tente de novo.");
  }

  return (
    <main className="login-wrap">
      <form className="login-card" onSubmit={enviar} aria-describedby={erro ? "entrar-erro" : undefined}>
        <span className="brand-word" role="img" aria-label="Via Sol" />
        <h1>{criando ? "Primeiro acesso" : "Entrar no painel"}</h1>
        {criando && <p className="login-dica">Crie a sua conta de dono. Depois você cadastra as outras pessoas em Configurações.</p>}

        {criando && (
          <div className="campo">
            <label htmlFor="entrar-nome">Seu nome</label>
            <input {...campo("nome")} autoComplete="name" required />
          </div>
        )}
        <div className="campo">
          <label htmlFor="entrar-login">Usuário</label>
          <input {...campo("login")} autoComplete="username" autoCapitalize="none" spellCheck={false} autoFocus required={criando} />
        </div>
        <div className="campo">
          <label htmlFor="entrar-senha">Senha</label>
          <input {...campo("senha")} type="password" autoComplete={criando ? "new-password" : "current-password"} required />
        </div>
        {criando && (
          <div className="campo">
            <label htmlFor="entrar-confirma">Repita a senha</label>
            <input {...campo("confirma")} type="password" autoComplete="new-password" required />
          </div>
        )}
        {criando && sit?.pedeSenhaPainel && (
          <div className="campo">
            <label htmlFor="entrar-senhaPainel">Senha atual do painel</label>
            <input {...campo("senhaPainel")} type="password" autoComplete="off" required />
            <span className="dica">A senha que todo mundo usava até hoje. Prova que é você.</span>
          </div>
        )}

        {erro && (
          <p className="login-error" id="entrar-erro" role="alert">
            {erro}
          </p>
        )}
        {/* Não trava enquanto a tela carrega: quem digita rápido e dá Enter já entra */}
        <button type="submit" className="btn btn-pri" disabled={enviando}>
          {enviando ? "Entrando…" : criando ? "Criar conta e entrar" : "Entrar"}
        </button>
        {!criando && sit?.senhaAntiga && (
          <p className="login-dica">Ainda não tem usuário? Deixe o usuário em branco e use a senha antiga do painel.</p>
        )}
        {!criando && (
          <details className="login-ajuda">
            <summary>Esqueci meu usuário ou a senha</summary>
            <p>Peça para o dono do painel trocar a sua senha em Configurações › Pessoas e acessos.</p>
            <p>
              Se você é o dono: no computador da empresa, abra a pasta do painel e dê dois cliques em{" "}
              <b>esqueci-a-senha.cmd</b>. Ele mostra todos os usuários e deixa escolher uma senha nova.
            </p>
          </details>
        )}
      </form>
    </main>
  );
}
