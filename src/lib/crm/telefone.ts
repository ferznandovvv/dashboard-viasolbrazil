/**
 * Telefone brasileiro normalizado: só dígitos, com DDI 55.
 * "(16) 99999-8888" → "5516999998888". Celular sem o nono dígito ganha o 9.
 */
export function normalizarTelefone(bruto: string | null | undefined): string | undefined {
  if (!bruto) return undefined;
  let d = String(bruto).replace(/\D/g, "");
  if (!d) return undefined;
  if (d.startsWith("0")) d = d.replace(/^0+/, "");
  if (d.startsWith("55") && d.length >= 12) d = d.slice(2);
  // Agora esperamos DDD + número (10 ou 11 dígitos)
  if (d.length === 10 && /^[1-9]{2}[6-9]/.test(d)) d = `${d.slice(0, 2)}9${d.slice(2)}`; // celular antigo sem o 9
  if (d.length < 10 || d.length > 11) return undefined;
  if (!/^[1-9]{2}/.test(d)) return undefined;
  return `55${d}`;
}

/** É celular (consegue receber WhatsApp)? */
export function ehCelular(normalizado: string | undefined): boolean {
  return Boolean(normalizado && normalizado.length === 13 && normalizado[4] === "9");
}

/** "5516999998888" → "(16) 99999-8888" */
export function formatarTelefone(normalizado?: string): string {
  if (!normalizado) return "";
  const d = normalizado.startsWith("55") ? normalizado.slice(2) : normalizado;
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return normalizado;
}

/** Só dígitos do CPF, ou undefined se não tiver 11. */
export function normalizarCpf(bruto: string | null | undefined): string | undefined {
  const d = (bruto ?? "").replace(/\D/g, "");
  return d.length === 11 ? d : undefined;
}

/** Aceita "1990-05-20", "20/05/1990", "20/05/90", "20-05-1990" e ISO com hora. */
export function normalizarData(bruto: string | null | undefined): string | undefined {
  if (!bruto) return undefined;
  const t = String(bruto).trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (m) {
    let ano = Number(m[3]);
    if (ano < 100) ano += ano > 30 ? 1900 : 2000;
    const dia = m[1].padStart(2, "0");
    const mes = m[2].padStart(2, "0");
    if (Number(mes) < 1 || Number(mes) > 12 || Number(dia) < 1 || Number(dia) > 31) return undefined;
    return `${ano}-${mes}-${dia}`;
  }
  return undefined;
}
