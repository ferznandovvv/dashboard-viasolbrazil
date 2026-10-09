/**
 * Roda uma vez quando o servidor sobe. O import fica dentro do teste de
 * runtime para o empacotador não levar `fs` para o Edge.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { iniciarAgendador } = await import("./lib/agendador");
    iniciarAgendador();
  }
}
