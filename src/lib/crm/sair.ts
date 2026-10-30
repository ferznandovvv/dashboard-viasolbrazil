/**
 * A cliente pediu pra não receber mais mensagens? Tem que ser um pedido dela,
 * não uma palavra solta: "me tira uma dúvida", "previsão de sair coleção nova"
 * e propaganda de outra empresa com "digite SAIR" não contam.
 */
export function pedeParaSair(texto?: string): boolean {
  const t = (texto ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return false;
  // Propaganda encaminhada ou de outra empresa: ensina a sair, não está pedindo
  if (/\b(digite|digitar|envie|enviar|responda|responder|mande|mandar|escreva) (a palavra )?(sair|parar|stop)\b/.test(t)) return false;
  const palavras = t.split(" ").length;
  // Pedido claro, em qualquer tamanho de mensagem
  if (/(quero sair (da|dessa|desta) (lista|transmissao)|sair da lista|descadastr|nao (quero|desejo) (mais )?receber|(para|param|parar|pare|parem) de (me )?(mandar|enviar) (mensage|msg|propaganda|promoc)|remov(e|er|a) (meu|o meu) (numero|contato))/.test(t)) return true;
  // Mensagem curta pedindo pra tirar ou parar
  if (palavras <= 10) {
    if (/\bme (tira|tire|retira|retire|remove|remova|exclui|exclua|descadastra)( (da|dessa|desta|do|desse|deste) (lista|grupo|transmissao|contato|cadastro)| daqui| por favor| pf| pfv)?$/.test(t)) return true;
    if (/\bme (tira|tire|retira|retire|remove|remova|exclui|exclua) (da|dessa|desta|do|desse|deste) (lista|grupo|transmissao|contato|cadastro)\b/.test(t)) return true;
    if (/(\bquero sair\b|nao (quero|desejo) mais (mensage|msg)|nao (me )?(mand|envi)(e|em) mais|para de mandar|parem de mandar|nao tenho interesse)/.test(t)) return true;
  }
  const sobra = t.replace(/\b(por favor|pfv|pf|obrigad[ao]s?|obg|ok|ta|eu|quero|so)\b/g, " ").replace(/\s+/g, " ").trim();
  return /^(sair|sai|parar|pare|stop|cancelar|descadastrar|remover|chega)$/.test(sobra);
}
