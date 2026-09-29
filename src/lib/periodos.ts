/** Períodos rápidos do filtro, compartilhados entre as telas. */
export type Period = { key: string; from: string; to: string };

/** Data de hoje no fuso de São Paulo (YYYY-MM-DD), calculada no navegador. */
export function spToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function shiftDays(dateKey: string, n: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function buildPresets(): Period[] {
  const today = spToday();
  const [y, m] = today.split("-").map(Number);
  const pad = (n: number) => String(n).padStart(2, "0");
  const prevM = m === 1 ? 12 : m - 1;
  const prevY = m === 1 ? y - 1 : y;
  const lastDayPrev = new Date(y, m - 1, 0).getDate();
  return [
    { key: "Hoje", from: today, to: today },
    { key: "Ontem", from: shiftDays(today, -1), to: shiftDays(today, -1) },
    { key: "Últimos 7 dias", from: shiftDays(today, -6), to: today },
    { key: "Mês atual", from: `${y}-${pad(m)}-01`, to: today },
    {
      key: "Mês passado",
      from: `${prevY}-${pad(prevM)}-01`,
      to: `${prevY}-${pad(prevM)}-${pad(lastDayPrev)}`,
    },
    { key: "Últimos 3 meses", from: shiftDays(today, -89), to: today },
    { key: "Ano atual", from: `${y}-01-01`, to: today },
  ];
}
