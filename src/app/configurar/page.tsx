"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Integracao } from "@/lib/integracoes";

interface Estado {
  local: boolean;
  situacao: Record<string, boolean>;
  integracoes: Integracao[];
}

/**
 * Configuração das integrações pelo navegador, para quem roda o sistema
 * numa máquina própria: cola as chaves, salva, e vale na hora.
 */
export default function Configurar() {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [valores, setValores] = useState<Record<string, string>>({});
  const [salvando, setSalvando] = useState<string | null>(null);
  const [aviso, setAviso] = useState("");

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
    setAviso(`${integ.nome}: salvo e já valendo.`);
    carregar();
  };

  if (!estado) return <main className="wrap"><div className="empty">Carregando…</div></main>;

  const pronta = (i: Integracao) =>
    [...i.campos.map((c) => c.nome), ...(i.geradas ?? [])].every((n) => estado.situacao[n]);
  const temCampos = (i: Integracao) => i.campos.every((c) => estado.situacao[c.nome]);

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
                  type="password"
                  autoComplete="off"
                  placeholder={estado.situacao[c.nome] ? "já salvo — deixe em branco para manter" : ""}
                  value={valores[c.nome] ?? ""}
                  onChange={(e) => setValores((v) => ({ ...v, [c.nome]: e.target.value }))}
                />
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
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
