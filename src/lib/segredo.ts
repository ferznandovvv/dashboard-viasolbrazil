/**
 * Segredos nas telas de configuração.
 *
 * O dashboard tem uma senha só: quem entra para ver vendas entraria também
 * nessas telas. Por isso o valor vem escondido, e só aparece para quem pedir
 * explicitamente com ?revelar=1 — que é o momento de copiar para a Vercel.
 */
export function mascarar(valor: string, revelar: boolean): string {
  if (revelar) return valor;
  if (!valor) return "";
  const fim = valor.slice(-4);
  return `${"•".repeat(Math.min(valor.length - 4, 24))}${fim}`;
}

/** Aviso padrão para acompanhar o valor escondido. */
export const AVISO_REVELAR =
  '<p style="font-size:12px;color:#8a8880">Valor escondido por segurança. ' +
  'Acrescente <code>?revelar=1</code> no fim do endereço para ver e copiar.</p>';
