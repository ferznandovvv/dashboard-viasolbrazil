"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Integracao } from "@/lib/integracoes";

interface Estado {
  local: boolean;
  situacao: Record<string, boolean>;
  /** Final de cada chave em uso e de onde ela vem (nunca o valor inteiro) */
  detalhe?: Record<string, { final: string; origem: string } | null>;
  integracoes: Integracao[];
  atualizador?: { verificadoEm?: string; atualizadoEm?: string; falhou?: string; mensagem?: string } | null;
}

/**
 * Configuração das integrações pelo navegador, para quem roda o sistema
 * numa máquina própria: cola as chaves, salva, e vale na hora.
 */
const quando = (iso?: string) =>
  iso
    ? new Date(iso).toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "America/Sao_Paulo",
      })
    : "—";

export default function Configurar() {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [valores, setValores] = useState<Record<string, string>>({});
  const [salvando, setSalvando] = useState<string | null>(null);
  const [aviso, setAviso] = useState("");
  const [testes, setTestes] = useState<Record<string, { ok: boolean; mensagem: string; detalhes?: string[] } | "testando">>({});

  /** Testa a integração agora, com as chaves que estão valendo. */
  const testar = async (id: string) => {
    setTestes((t) => ({ ...t, [id]: "testando" }));
    try {
      const r = await fetch(`/api/configurar/testar?id=${id}`, { method: "POST" });
      const j = (await r.json()) as { ok: boolean; mensagem: string; detalhes?: string[] };
      setTestes((t) => ({ ...t, [id]: j }));
    } catch {
      setTestes((t) => ({ ...t, [id]: { ok: false, mensagem: "O painel não respondeu." } }));
    }
  };

  const carregar = () =>
    fetch("/api/configurar", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: Estado) => setEstado(j));

  useEffect(() => {
    carregar();
  }, []);

  const salvar = async (integ: Integracao) => {
    const corpo = Object.fromEntries(
      integ.campos.map((c) => [c.nome, valores[c.nome] ?? ""]).filter(([, v]) => v.trim())
    );
    if (Object.keys(corpo).length === 0) {
      setAviso(`Nada para salvar em ${integ.nome} — preencha pelo menos um campo.`);
      return;
    }
    setSalvando(integ.id);
    setAviso("");
    const r = await fetch("/api/configurar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
    });
    const j = await r.json();
    setSalvando(null);
    if (!r.ok) {
      setAviso(j.erro ?? "Não foi possível salvar.");
      return;
    }
    // Limpa os campos: o valor salvo nunca volta para a tela
    setValores((v) => {
      const novo = { ...v };
      for (const c of integ.campos) delete novo[c.nome];
      return novo;
    });
    setAviso(`${integ.nome}: salvo e já valendo. Testando a conexão…`);
    await carregar();
    // Testa na hora: assim dá para saber se a chave nova funciona
    void testar(integ.id);
  };

  if (!estado) return <main className="wrap"><div className="empty">Carregando…</div></main>;

  const pronta = (i: Integracao) =>
    [...i.campos.filter((c) => !c.opcional).map((c) => c.nome), ...(i.geradas ?? [])].every((n) => estado.situacao[n]);
  const temCampos = (i: Integracao) => i.campos.filter((c) => !c.opcional).every((c) => estado.situacao[c.nome]);

  return (
    <main className="wrap">
      <div className="topbar">
        <div className="logo">
          <div>
            <span className="brand-word" role="img" aria-label="Via Sol" />
            <span className="tag">configuração</span>
          </div>
        </div>
        <Link href="/" className="updated">
          ← voltar para vendas
        </Link>
      </div>

      {!estado.local && (
        <div className="card">
          Este sistema está rodando na Vercel — lá as chaves se configuram no painel dela
          (Settings → Environment Variables). Esta tela serve para quando ele roda numa máquina
          própria.
        </div>
      )}

      {aviso && <div className="parcial">{aviso}</div>}

      {estado.local && (
        <div className="rank-aviso" style={{ margin: "0 0 12px" }}>
          {estado.atualizador ? (
            <>
              Atualização automática ligada: versão no ar desde{" "}
              <b>{quando(estado.atualizador.atualizadoEm)}</b> · última conferência no GitHub{" "}
              {quando(estado.atualizador.verificadoEm)}
              {estado.atualizador.mensagem && (
                <>
                  {" "}
                  · última mudança: <b>{estado.atualizador.mensagem}</b>
                </>
              )}
              {estado.atualizador.falhou && " · a última versão baixada não montou — a anterior segue no ar"}
            </>
          ) : (
            <>Atualização automática desligada — abra o sistema pelo iniciar-painel.cmd para ela funcionar.</>
          )}
        </div>
      )}

      <div className="rank-aviso" style={{ margin: "0 0 16px" }}>
        Cole as chaves e salve — vale na hora, sem reiniciar. O que você salva nunca volta a
        aparecer aqui: a tela só mostra se está preenchido.
      </div>

      <div className="config-lista">
        {estado.integracoes.map((i) => (
          <div key={i.id} className="card config-card">
            <div className="config-cab">
              <div>
                <h2>{i.nome}</h2>
                <div className="muted" style={{ fontSize: 12.5 }}>
                  {i.para}
                </div>
              </div>
              <span className={`badge ${pronta(i) ? "on" : ""}`}>
                {pronta(i) ? "conectado" : temCampos(i) && i.autorizar ? "falta autorizar" : "não configurado"}
              </span>
            </div>

            {i.campos.map((c) => (
              <label key={c.nome} className="config-campo">
                <span>
                  {c.rotulo} {estado.situacao[c.nome] && <b className="ok">✓</b>}
                </span>
                <input
                  type={c.visivel ? "text" : "password"}
                  autoComplete="off"
                  placeholder={estado.situacao[c.nome] ? "já salvo — deixe em branco para manter" : ""}
                  value={valores[c.nome] ?? ""}
                  onChange={(e) => setValores((v) => ({ ...v, [c.nome]: e.target.value }))}
                />
                {estado.detalhe?.[c.nome] && (
                  <small className="config-em-uso">
                    em uso: <code>{estado.detalhe[c.nome]!.final}</code>
                    {estado.detalhe[c.nome]!.origem === "tela" ? " · salvo por esta tela" : " · vindo do arquivo .env.local"}
                  </small>
                )}
                {c.dica && <small>{c.dica}</small>}
              </label>
            ))}

            <div className="config-acoes">
              <button className="buscar" style={{ width: "auto" }} onClick={() => salvar(i)} disabled={salvando === i.id}>
                {salvando === i.id ? "Salvando…" : "Salvar"}
              </button>
              {i.autorizar && temCampos(i) && (
                <a className="exportar" href={i.autorizar}>
                  {pronta(i) ? "autorizar de novo" : "autorizar agora →"}
                </a>
              )}
              {temCampos(i) && (
                <button className="exportar" onClick={() => testar(i.id)} disabled={testes[i.id] === "testando"}>
                  {testes[i.id] === "testando" ? "testando…" : "testar conexão"}
                </button>
              )}
            </div>
            {testes[i.id] && testes[i.id] !== "testando" && (
              <div className={`config-teste ${(testes[i.id] as { ok: boolean }).ok ? "ok" : "falha"}`}>
                {(testes[i.id] as { ok: boolean }).ok ? "✓ " : "✗ "}
                {(testes[i.id] as { mensagem: string }).mensagem}
                {!(testes[i.id] as { ok: boolean }).ok && ((testes[i.id] as { detalhes?: string[] }).detalhes?.length ?? 0) > 0 && (
                  <pre className="config-detalhes">{(testes[i.id] as { detalhes: string[] }).detalhes.join("\n")}</pre>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </main>
  );
}
