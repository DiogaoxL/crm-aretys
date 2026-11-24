/**
 * Seções da CNAE 2.x (IBGE). A base da Receita traz só o código da subclasse (7 dígitos) e a descrição;
 * a seção sai da divisão (2 primeiros dígitos). Usada para agrupar os segmentos na tela.
 */
export const SECOES: { letra: string; nome: string; divisoes: [number, number] }[] = [
  { letra: "A", nome: "Agropecuária, produção florestal e pesca", divisoes: [1, 3] },
  { letra: "B", nome: "Indústrias extrativas", divisoes: [5, 9] },
  { letra: "C", nome: "Indústrias de transformação", divisoes: [10, 33] },
  { letra: "D", nome: "Eletricidade e gás", divisoes: [35, 35] },
  { letra: "E", nome: "Água, esgoto, resíduos e descontaminação", divisoes: [36, 39] },
  { letra: "F", nome: "Construção", divisoes: [41, 43] },
  { letra: "G", nome: "Comércio e reparação de veículos", divisoes: [45, 47] },
  { letra: "H", nome: "Transporte, armazenagem e correio", divisoes: [49, 53] },
  { letra: "I", nome: "Alojamento e alimentação", divisoes: [55, 56] },
  { letra: "J", nome: "Informação e comunicação", divisoes: [58, 63] },
  { letra: "K", nome: "Atividades financeiras e seguros", divisoes: [64, 66] },
  { letra: "L", nome: "Atividades imobiliárias", divisoes: [68, 68] },
  { letra: "M", nome: "Atividades profissionais, científicas e técnicas", divisoes: [69, 75] },
  { letra: "N", nome: "Atividades administrativas e serviços complementares", divisoes: [77, 82] },
  { letra: "O", nome: "Administração pública, defesa e seguridade social", divisoes: [84, 84] },
  { letra: "P", nome: "Educação", divisoes: [85, 85] },
  { letra: "Q", nome: "Saúde humana e serviços sociais", divisoes: [86, 88] },
  { letra: "R", nome: "Artes, cultura, esporte e recreação", divisoes: [90, 93] },
  { letra: "S", nome: "Outras atividades de serviços", divisoes: [94, 96] },
  { letra: "T", nome: "Serviços domésticos", divisoes: [97, 97] },
  { letra: "U", nome: "Organismos internacionais", divisoes: [99, 99] },
];

/** "8630503" → { letra: "Q", nome: "Saúde humana e serviços sociais" } (null se o código não for válido). */
export function secaoDoCnae(codigo: string): { letra: string; nome: string } | null {
  const divisao = Number(String(codigo).slice(0, 2));
  const s = SECOES.find((x) => divisao >= x.divisoes[0] && divisao <= x.divisoes[1]);
  return s ? { letra: s.letra, nome: s.nome } : null;
}
