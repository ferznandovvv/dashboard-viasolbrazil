"use client";

import { Cabecalho } from "@/components/Moldura";
import { PainelAtendimento } from "@/components/crm/VisaoGeral";

/** Atendimento das lojas no WhatsApp: quem espera, quanto demora, o que vira venda. */
export default function Atendimento() {
  return (
    <main className="wrap">
      <Cabecalho titulo="Atendimento das lojas">
        <a className="btn btn-sec btn-sm" href="/crm/loja" target="_blank" rel="noreferrer">
          Abrir o painel da loja <span className="so-leitor">(abre em outra aba)</span>
        </a>
      </Cabecalho>
      <PainelAtendimento />
    </main>
  );
}
