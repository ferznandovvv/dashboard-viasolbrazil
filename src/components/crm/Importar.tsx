"use client";

import { useState } from "react";
import type { CampoCliente, CampoVenda } from "@/lib/crm/importar";
import { type Resumo, api } from "./comum";

const CAMPOS_CLIENTE: { id: CampoCliente; nome: string }[] = [
  { id: "ignorar", nome: "(ignorar)" },
  { id: "nome", nome: "Nome" },
  { id: "telefone", nome: "Celular" },
  { id: "cpf", nome: "CPF" },
  { id: "email", nome: "E-mail" },
  { id: "nascimento", nome: "Aniversário" },
  { id: "loja", nome: "Loja" },
  { id: "codigoTotvs", nome: "Código TOTVS" },
];
const CAMPOS_VENDA: { id: CampoVenda; nome: string }[] = [
  { id: "ignorar", nome: "(ignorar)" },
  { id: "data", nome: "Data" },
  { id: "valor", nome: "Valor" },
  { id: "loja", nome: "Loja" },
  { id: "nomeCliente", nome: "Nome da cliente" },
  { id: "telefoneCliente", nome: "Celular da cliente" },
  { id: "cpfCliente", nome: "CPF da cliente" },
  { id: "codigoTotvs", nome: "Código TOTVS da cliente" },
  { id: "idVenda", nome: "Número da nota/pedido" },
  { id: "pecas", nome: "Peças" },
];

interface Preview {
  colunas: string[];
  palpite: string[];
  amostra: string[][];
  linhas: number;
}

/** Importação por CSV: escolhe o arquivo, confere o mapeamento das colunas, importa. */
export function Importar({ r, recarregar }: { r: Resumo; recarregar: () => Promise<void> }) {
  const [alvo, setAlvo] = useState<"clientes" | "vendas">("clientes");
  const [csv, setCsv] = useState("");
  const [nomeArq, setNomeArq] = useState("");
  const [prev, setPrev] = useState<Preview | null>(null);
  const [mapa, setMapa] = useState<string[]>([]);
  const [lojaPadrao, setLojaPadrao] = useState("");
  const [optIn, setOptIn] = useState(true);
  const [creditar, setCreditar] = useState(false);
  const [res, setRes] = useState("");
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);

  const lerArquivo = async (f: File | undefined, alvoAtual = alvo) => {
    if (!f) return;
    setErro("");
    setRes("");
    const buf = await f.arrayBuffer();
    // TOTVS e Excel costumam exportar em Windows-1252; UTF-8 é a tentativa padrão
    let texto = new TextDecoder("utf-8", { fatal: false }).decode(buf);
    if (texto.includes("�")) texto = new TextDecoder("windows-1252").decode(buf);
    setCsv(texto);
    setNomeArq(f.name);
    try {
      const p = await api<Preview>("/api/crm/importar", { method: "POST", body: JSON.stringify({ tipo: "preview", csv: texto, alvo: alvoAtual }) });
      setPrev(p);
      setMapa(p.palpite);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro");
    }
  };

  const importar = async () => {
    setOcupado(true);
    setErro("");
    try {
      const x = await api<{ linhas: number; criados: number; atualizados: number; vendas: number; ignorados: number; avisos: string[] }>("/api/crm/importar", {
        method: "POST",
        body: JSON.stringify({ tipo: alvo, csv, mapa, lojaPadrao: lojaPadrao || undefined, optIn, creditar }),
      });
      setRes(
        `${x.linhas} linhas lidas: ${alvo === "vendas" ? `${x.vendas} vendas novas, ` : ""}${x.criados} clientes criadas, ${x.atualizados} atualizadas, ${x.ignorados} ignoradas.${x.avisos.length ? ` ${x.avisos.join(" ")}` : ""}`
      );
      setPrev(null);
      setCsv("");
      await recarregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro");
    } finally {
      setOcupado(false);
    }
  };

  const campos = alvo === "clientes" ? CAMPOS_CLIENTE : CAMPOS_VENDA;
  const faltaObrigatorio = alvo === "clientes" ? !mapa.includes("nome") : !mapa.includes("data") || !mapa.includes("valor");

  return (
    <div>
      <div className="card">
        <h2>Importar planilha (CSV)</h2>
        <div className="muted" style={{ marginBottom: 12 }}>
          Para base antiga ou quando a API não trouxer algum dado. Exporte do TOTVS (ou do Excel) em CSV; separado por ponto e vírgula ou vírgula, tanto faz. A primeira linha precisa ser o cabeçalho. Clientes repetidas (mesmo celular, CPF ou código) são completadas, não duplicadas.
        </div>
        <div className="fin-barra">
          <div className="seg">
            <button className={alvo === "clientes" ? "on" : ""} onClick={() => { setAlvo("clientes"); setPrev(null); }}>Clientes</button>
            <button className={alvo === "vendas" ? "on" : ""} onClick={() => { setAlvo("vendas"); setPrev(null); }}>Vendas</button>
          </div>
          <input type="file" accept=".csv,.txt,text/csv" onChange={(e) => lerArquivo(e.target.files?.[0])} />
          {nomeArq && prev && <span className="muted">{nomeArq}: {prev.linhas} linhas</span>}
        </div>

        {prev && (
          <>
            <div className="tbl-wrap" style={{ margin: "12px 0" }}>
              <table className="prod-tbl">
                <thead>
                  <tr>
                    {prev.colunas.map((c, i) => (
                      <th key={i}>
                        <div>{c}</div>
                        <select className="fin-select crm-mapa" value={mapa[i] ?? "ignorar"} onChange={(e) => setMapa(mapa.map((m, j) => (j === i ? e.target.value : m)))}>
                          {campos.map((k) => (
                            <option key={k.id} value={k.id}>{k.nome}</option>
                          ))}
                        </select>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {prev.amostra.map((l, i) => (
                    <tr key={i}>
                      {prev.colunas.map((_, j) => (
                        <td key={j} className="muted">{l[j]}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="fin-grid">
              <label className="config-campo">
                <span>Loja padrão (se a planilha não tiver coluna de loja)</span>
                <select value={lojaPadrao} onChange={(e) => setLojaPadrao(e.target.value)}>
                  <option value="">(nenhuma)</option>
                  {r.lojas.map((l) => <option key={l}>{l}</option>)}
                </select>
              </label>
            </div>
            {alvo === "clientes" ? (
              <label className="fin-check"><input type="checkbox" checked={optIn} onChange={(e) => setOptIn(e.target.checked)} /> Marcar como aceitaram receber mensagens (são clientes que deram o telefone na loja)</label>
            ) : (
              <label className="fin-check"><input type="checkbox" checked={creditar} onChange={(e) => setCreditar(e.target.checked)} /> Gerar cashback destas vendas (desmarque para histórico antigo)</label>
            )}
            {faltaObrigatorio && <div className="muted">{alvo === "clientes" ? "Marque qual coluna é o Nome." : "Marque as colunas de Data e Valor."}</div>}
            <button className="mini" disabled={ocupado || faltaObrigatorio} onClick={importar}>
              {ocupado ? "Importando…" : `Importar ${prev.linhas} linhas`}
            </button>
          </>
        )}
        {res && <div className="crm-aviso">{res}</div>}
        {erro && <div className="login-error">{erro}</div>}
      </div>

      <div className="card">
        <h2>Diagnóstico da API do TOTVS</h2>
        <div className="muted" style={{ marginBottom: 10 }}>
          Mostra uma nota e um cadastro crus, como a API devolve, para conferir os nomes dos campos de telefone, aniversário e código do cliente. Use na primeira vez.
        </div>
        <Diag rota="/api/crm/totvs" />
      </div>

      <div className="card">
        <h2>Diagnóstico da Shopify</h2>
        <div className="muted" style={{ marginBottom: 10 }}>
          Mostra um pedido cru. Confira se telefone da cliente e o aceite de SMS vêm preenchidos; se vierem null, o app da Shopify precisa da permissão de leitura de clientes.
        </div>
        <Diag rota="/api/crm/shopify" />
      </div>
    </div>
  );
}

function Diag({ rota }: { rota: string }) {
  const [saida, setSaida] = useState("");
  const [ocupado, setOcupado] = useState(false);
  return (
    <div>
      <button
        className="mini ghost"
        disabled={ocupado}
        onClick={async () => {
          setOcupado(true);
          try {
            const r = await api(rota, { method: "POST", body: JSON.stringify({ acao: "diag" }) });
            setSaida(JSON.stringify(r, null, 2));
          } catch (e) {
            setSaida(e instanceof Error ? e.message : "Erro");
          } finally {
            setOcupado(false);
          }
        }}
      >
        {ocupado ? "Consultando…" : "Consultar"}
      </button>
      {saida && <pre className="crm-pre">{saida}</pre>}
    </div>
  );
}
