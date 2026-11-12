/**
 * Veículo IA — Main Application Logic (v3)
 *
 * Positions a business idea on a 2×2 board (x = difficulty to operate,
 * y = money potential) adapted from the "Idiot Index":
 *   - 4 quadrants: Arbitragem (easy, high), Fosso (hard, high),
 *     Caixa inicial (easy, low), Commodities braçais (hard, low).
 *   - The video's "expert-dependent" vehicle is NOT a place on the board: it is
 *     the ANCHOR badge ("Âncora: depende de você"), driven by the rubric's
 *     founder-independence score (transferível ≤ 4), in any quadrant
 *     (Built to Sell logic).
 *
 *   1. The member's own model (BYOK via OpenRouter) scores a FIXED 14-criterion
 *      rubric. THIS TOOL computes the position with fixed weights.
 *   2. A second call writes the report (whitelisted sources only) + 3 pivots.
 *   3. The member DRAGS a destination buoy on the board (or uses chips / arrow
 *      keys); one call returns similar businesses scored on the same rubric;
 *      the tool places each one and judges the distance to the destination.
 *
 * Everything runs client-side; the only backend is the shared n8n gate.
 */
const App = (function () {
  'use strict';

  var HISTORY_STORE = 'veiculo_ia_history';
  var CURRENT_SLOT = 'veiculo_ia_current';
  var HISTORY_MAX = 30;
  var SVGNS = 'http://www.w3.org/2000/svg';
  var NEAR = 15;          // "chega perto": within 15 points (of 100) of the destination
  var EDGE = 6;           // boundary note: within ±6 of a midline
  var ANCHOR_MAX = 4;     // anchor badge: founder independence ≤ 4

  // ── The rubric (fixed). axis x = difficulty to operate, y = money potential ──
  var RUBRIC = [
    { k: 'trabalho', axis: 'x', w: 0.22, label: 'Intensidade de mão de obra', hint: 'quantas pessoas/horas o negócio consome para crescer (10 = muito braçal)' },
    { k: 'habilidade', axis: 'x', w: 0.20, label: 'Barreira de habilidade', hint: 'quão rara é a competência necessária para operar bem (10 = muito rara)' },
    { k: 'capital', axis: 'x', w: 0.18, label: 'Capital necessário', hint: 'dinheiro para começar e escalar (10 = muito capital)' },
    { k: 'regulacao', axis: 'x', w: 0.14, label: 'Regulação e licenças', hint: 'aprovações do governo, compliance (10 = pesada)' },
    { k: 'operacao', axis: 'x', w: 0.16, label: 'Complexidade operacional', hint: 'logística, estoque, equipe, arrasto do dia a dia (10 = muito complexa)' },
    { k: 'tempo', axis: 'x', w: 0.10, label: 'Tempo até maturar', hint: 'quanto tempo leva para dar certo / compor (10 = muitos anos)' },
    { k: 'teto', axis: 'y', w: 0.18, label: 'Teto do mercado', hint: 'tamanho do maior exemplo possível — "como é isso no máximo?" (10 = bilhões)' },
    { k: 'margem', axis: 'y', w: 0.12, label: 'Margem', hint: 'lucro bruto por venda (10 = margem altíssima)' },
    { k: 'escala', axis: 'y', w: 0.14, label: 'Escalabilidade', hint: 'receita cresce sem crescer gente na mesma proporção (10 = muito escalável)' },
    { k: 'fosso', axis: 'y', w: 0.14, label: 'Força do fosso', hint: 'barreiras que protegem o lucro: habilidade, capital, regulação, tempo, efeito de rede (10 = fosso largo)' },
    { k: 'ventos', axis: 'y', w: 0.14, label: 'Vento a favor (oferta × demanda)', hint: 'demanda crescendo mais que a oferta, mudança regulatória, público com dinheiro (10 = vento forte)' },
    { k: 'recorrencia', axis: 'y', w: 0.10, label: 'Recorrência e aderência', hint: 'cliente fica e paga de novo (10 = muito "grudento")' },
    { k: 'transferivel', axis: 'y', w: 0.10, label: 'Independência do fundador', hint: 'funciona e é vendável sem você (10 = totalmente independente; 4 ou menos = depende de você)' },
    { k: 'concorrencia', axis: 'y', w: 0.08, label: 'Saturação da concorrência', hint: 'quantos já fazem igual (10 = saturado). Conta CONTRA o dinheiro.', inverse: true }
  ];
  var RKEYS = RUBRIC.map(function (r) { return r.k; });

  // ── The 4 quadrants (board) + the anchor badge ──
  var QUADS = {
    arb: { nome: 'Arbitragem', eixo: 'fácil · muito dinheiro', hv: 5,
      resumo: 'Demanda forte e pouca concorrência: vento a favor, oferta restrita ou mudança de regra.',
      dificil: 'Conseguir clientes e agir enquanto a janela está aberta.', dinheiro: 'Preço sustentado pela demanda e clientes que ficam.',
      armadilha: 'A janela fecha: quando todo mundo descobre, vira commodity.', serve: 'Fluxo de caixa, renda alta e valor de empresa (sem âncora).',
      exemplos: ['Med spa', 'Assessoria de patrimônio', 'Limpeza comercial', 'Manutenção de elevadores'], src: 'hormozi_video' },
    fos: { nome: 'Fosso', eixo: 'difícil · muito dinheiro', hv: 4,
      resumo: 'Barreiras de entrada protegem o lucro: habilidade, capital, regulação, tempo ou efeito de rede.',
      dificil: 'Capital, anos e equipe para atravessar a barreira.', dinheiro: 'Pouca concorrência depois que você está do lado de dentro.',
      armadilha: 'Ficar sem fôlego antes de chegar ao outro lado do fosso.', serve: 'Valor de empresa e bilhões; renda alta mais tarde.',
      exemplos: ['SaaS', 'Franquia', 'Marketplace', 'Farmacêutica'], src: 'buffett_fosso' },
    cai: { nome: 'Caixa inicial', eixo: 'fácil · pouco dinheiro', hv: 2,
      resumo: 'Fácil de começar e de operar: uma pessoa chega a uma boa renda, raramente a uma empresa grande.',
      dificil: 'Pouca coisa — o difícil é se destacar entre muitos.', dinheiro: 'Caixa rápido, aprendizado e capital para o próximo barco.',
      armadilha: 'Ficar para sempre num negócio sem teto e sem fosso.', serve: 'Fluxo de caixa; aprender e juntar capital.',
      exemplos: ['Dropshipping', 'Serviços leves para casa', 'Máquinas de venda', 'Conteúdo de afiliado'], src: 'demarco' },
    com: { nome: 'Commodities braçais', eixo: 'difícil · pouco dinheiro', hv: 1,
      resumo: 'Qualquer um entra: a concorrência espreme o preço e crescer exige mais gente.',
      dificil: 'Equipe, turnos, estoque e operação todo dia.', dinheiro: 'Margem fina e preço disputado.',
      armadilha: 'Trabalhar mais para ganhar o mesmo: as mesmas habilidades renderiam mais em outro barco.', serve: 'Pouco — no máximo fluxo de caixa local.',
      exemplos: ['Restaurante tradicional', 'Academia de serviço', 'Agência para pequenas empresas', 'Organização de eventos'], src: 'buffett_1980' }
  };
  var QORDER = ['arb', 'fos', 'cai', 'com'];
  var ANCHOR = { nome: 'Âncora: depende de você', linha: 'gera renda, mas vale pouco na venda',
    resumo: 'O negócio só anda com você: gera renda, mas vale pouco na venda.',
    quando: 'Independência do fundador de 4 ou menos (de 10) na rúbrica — em qualquer quadrante.',
    armadilha: 'Confundir renda alta com empresa valiosa: um "emprego turbinado".',
    serve: 'Renda alta; atrapalha valor de empresa e bilhões.',
    soltar: 'Processos escritos, equipe que entrega sem você, contratos recorrentes, produto no lugar de hora.',
    exemplos: ['Coaching online', 'Cirurgião', 'Influenciador', 'Implementação de IA'], src: 'warrillow' };

  var GOALS = {
    fluxo: { label: 'Fluxo de caixa', obj: 'Gerar fluxo de caixa logo' },
    renda: { label: 'Renda alta', obj: 'Ter renda alta' },
    empresa: { label: 'Valor de empresa', obj: 'Construir uma empresa que dê para vender' },
    bilhoes: { label: 'Bilhões', obj: 'Construir algo de bilhões: mercado enorme e fosso' }
  };

  // ── Original literature, in chronological order. `honest` = what is (and is not) claimed. ──
  var SOURCES = [
    { id: 'bcg', year: 1970, short: 'BCG 1970', title: 'Bruce Henderson / BCG — matriz crescimento-participação (1970)', supports: 'O formato de matriz 2×2 para classificar negócios por dois eixos — a carta ecoa esse formato.', honest: 'Os eixos são outros (crescimento × participação de mercado); só a forma é herdada.', url: 'https://www.bcg.com/about/overview/our-history/growth-share-matrix' },
    { id: 'kirzner', year: 1973, short: 'Kirzner 1973', title: 'Israel M. Kirzner — Competition and Entrepreneurship (1973)', supports: 'O empreendedor como alguém alerta a desequilíbrios e oportunidades de arbitragem — a lógica do quadrante Arbitragem.', honest: 'Teoria econômica austríaca; a ligação com med spas e GLP-1 é aplicação nossa.', url: 'https://en.wikipedia.org/wiki/Israel_Kirzner' },
    { id: 'porter', year: 1979, short: 'Porter 1979', title: 'Michael E. Porter — "How Competitive Forces Shape Strategy" (HBR, 1979) e Competitive Strategy (1980)', supports: 'Barreiras de entrada, rivalidade e a estrutura da indústria decidem a lucratividade — por que Commodities braçais sofre e Fosso lucra.', honest: 'Porter não fala em "Índice do Idiota"; a ponte entre as cinco forças e a carta é interpretação.', url: 'https://hbr.org/1979/03/how-competitive-forces-shape-strategy' },
    { id: 'buffett_1980', year: 1980, short: 'Buffett 1980', title: 'Warren Buffett — carta aos acionistas da Berkshire Hathaway, 1980', supports: 'Quando uma gestão brilhante encontra um negócio de economia ruim, é a reputação do negócio que fica intacta — o limite de Commodities braçais.', honest: 'A frase é de Buffett; a aplicação a pequenos negócios é nossa leitura.', url: 'https://www.berkshirehathaway.com/letters/1980.html' },
    { id: 'buffett_1985', year: 1985, short: 'Buffett 1985', title: 'Warren Buffett — carta aos acionistas da Berkshire Hathaway, 1985', supports: '"Um bom histórico gerencial é muito mais função do barco em que você entra do que de quão bem você rema" — o veículo importa mais que o esforço.', honest: 'A história do colega que foi para o aço é contada de memória no vídeo; a frase do barco está na carta de 1985.', url: 'https://www.berkshirehathaway.com/letters/1985.html' },
    { id: 'lynch', year: 1989, short: 'Lynch 1989', title: 'Peter Lynch — One Up on Wall Street (1989), cap. 8, "The Perfect Stock, What a Deal!"', supports: 'A ação perfeita "soa chata — ou, melhor ainda, ridícula", "faz algo desagradável", e "é difícil pensar numa indústria mais perfeita do que a de gestão de resíduos". É a raiz do desconto do "parece legal": o que ninguém quer fazer tem menos concorrência.', honest: 'Lynch fala de escolher ações, não de abrir negócios; a ponte com o quadrante Arbitragem é nossa. Conferido no texto do livro (copyright 1989).', url: 'https://www.simonandschuster.com/books/One-Up-On-Wall-Street/Peter-Lynch/9780743200400' },
    { id: 'buffett_fosso', year: 1999, short: 'Fosso (Buffett)', title: 'Warren Buffett — o "fosso econômico" (Fortune, 1999; carta de 2007)', supports: 'A vantagem competitiva durável que protege os lucros — a base do quadrante Fosso.', honest: 'O vídeo lista os fossos (habilidade, capital, regulação, tempo, rede); o conceito de "moat" é de Buffett.', url: 'https://www.berkshirehathaway.com/letters/2007ltr.pdf' },
    { id: 'pick', year: 2003, short: 'PICK 2003', title: 'PICK chart (Possible, Implement, Challenge, Kill) — Lockheed Martin; Lean Six Sigma (Michael L. George, 2003)', supports: 'Uma matriz 2×2 de facilidade de implementar × retorno. Os quadrantes batem com os da carta: Possible = Caixa inicial, Implement = Arbitragem, Challenge = Fosso, Kill = Commodities braçais.', honest: 'Serve para priorizar projetos de melhoria dentro de uma empresa, não para escolher negócios. Conferido na Wikipedia, que cita George, Lean Six Sigma for Service (2003); não conseguimos abrir o livro.', url: 'https://en.wikipedia.org/wiki/PICK_chart' },
    { id: 'warrillow', year: 2010, short: 'Warrillow 2010', title: 'John Warrillow — Built to Sell (2010)', supports: 'Negócio que depende do fundador não é vendável. É a lógica da âncora "depende de você": renda alta, pouco valor de empresa — em qualquer quadrante.', honest: 'Warrillow escreve sobre tornar uma empresa de serviço vendável; não usa a carta. Transformar o "veículo 3" do vídeo em âncora é adaptação nossa.', url: 'https://en.wikipedia.org/wiki/Built_to_Sell' },
    { id: 'demarco', year: 2011, short: 'DeMarco 2011', title: 'MJ DeMarco — The Millionaire Fastlane (2011), os cinco "mandamentos" (hoje conhecidos pela sigla CENTS)', supports: 'Controle, Entrada, Necessidade, Tempo e Escala. Entrada (se é fácil entrar, todo mundo entra) explica Caixa inicial e Commodities braçais; Tempo (o negócio precisa se desligar das suas horas) explica a âncora.', honest: 'No livro de 2011 eles são cinco capítulos ("The Commandment of Need / Entry / Control / Scale / Time"); a sigla CENTS veio depois. DeMarco não usa a carta.', url: 'https://www.thefastlaneforum.com/' },
    { id: 'thiel', year: 2014, short: 'Thiel 2014', title: 'Peter Thiel — Zero to One (2014)', supports: '"Competição é para perdedores": prefira mercados com poucos concorrentes — o mesmo raciocínio de "prefiro competir com 20 do que com 5 milhões".', honest: 'Thiel defende monopólios criativos; o vídeo chega a uma conclusão parecida pela via das barreiras.', url: 'https://en.wikipedia.org/wiki/Zero_to_One' },
    { id: 'naval', year: 2018, short: 'Naval 2018', title: 'Naval Ravikant — "How to Get Rich (without getting lucky)", thread no Twitter (31/05/2018)', supports: '"Você não vai ficar rico alugando o seu tempo." Fortuna exige alavancagem: trabalho, capital e código e mídia — estas "sem permissão". Mídia e produto soltam a âncora do especialista.', honest: 'Data conferida no próprio tweet; frases conferidas em nav.al/rich, o site do autor. Naval fala de enriquecer em geral, não da carta.', url: 'https://nav.al/rich' },
    { id: 'hormozi_offers', year: 2021, short: '$100M Offers', title: 'Alex Hormozi — $100M Offers (2021), a "multidão faminta"', supports: 'Escolha de mercado: dor intensa, poder de compra, fácil de alcançar e crescendo — por isso "mude para um público mais velho e com dinheiro" é um pivô recorrente.', honest: 'Livro do próprio Hormozi, anterior ao vídeo.', url: 'https://www.acquisition.com/books' },
    { id: 'musk', year: 2022, short: 'Musk', title: 'Elon Musk — o "idiot index" original', supports: 'O nome: para Musk, idiot index é o custo de uma peça dividido pelo custo da matéria-prima. O vídeo reaproveita o nome para outra ideia.', honest: 'São conceitos diferentes; só o rótulo foi emprestado. O termo circula em falas de Musk, sem uma publicação única de origem.', url: 'https://en.wikipedia.org/wiki/Elon_Musk' },
    { id: 'hormozi_video', year: 2026, short: 'Hormozi 2026', title: 'Alex Hormozi — "How To Make More Money Than You Deserve (My 2027 Framework)" (YouTube, nov. 2026)', supports: 'Os 5 veículos (dificuldade × dinheiro) e seus exemplos, o teste do bilionário ("como é isso no máximo?"), o desconto do "parece legal" e o fechamento: escolha o veículo pelo objetivo, depois reme forte.', honest: 'Não achamos ninguém que tenha publicado antes este mesmo quadro: as peças são mais antigas — veja acima —, mas a síntese é dele. Aqui os veículos 1, 2, 4 e 5 viram os quatro quadrantes e o veículo 3 vira a âncora. Baseado no que ele viu em mais de 10 mil negócios; não é pesquisa acadêmica.', url: 'https://youtu.be/pwZJcLZc3_Y' }
  ];
  var SOURCE_IDS = SOURCES.map(function (s) { return s.id; });
  function sourceById(id) { for (var i = 0; i < SOURCES.length; i++) if (SOURCES[i].id === id) return SOURCES[i]; return sourceById('hormozi_video'); }

  // ── Example businesses cited in the video (illustrative positions; tr = founder independence 0–10) ──
  var EXAMPLES = [
    { t: 'Restaurante tradicional', x: 66, y: 27, w: 'com', tr: 4, d: 'Equipe grande, turnos longos e estoque que estraga.', m: 'Margem fina e um concorrente em cada esquina.' },
    { t: 'Academia de serviço', x: 61, y: 31, w: 'com', tr: 5, d: 'Instrutores, horários e aparelhos para manter.', m: 'Preço achatado pelas redes; teto preso ao espaço físico.' },
    { t: 'Agência para pequenas empresas', x: 56, y: 33, w: 'com', tr: 3, d: 'Cada cliente novo pede mais gente e retrabalho.', m: 'Clientes pequenos, troca alta e preço disputado.' },
    { t: 'Varejo físico', x: 71, y: 21, w: 'com', tr: 5, d: 'Ponto, estoque e equipe de loja.', m: 'Margem baixa e guerra de preço.' },
    { t: 'Organização de eventos', x: 78, y: 29, w: 'com', tr: 3, d: 'Logística pesada a cada evento.', m: 'Receita que não se repete e muita concorrência.' },
    { t: 'Construção', x: 60, y: 41, w: 'com', tr: 4, d: 'Obra, equipe e capital de giro.', m: 'Contratos grandes, mas pouca recorrência.' },
    { t: 'Clínica de reabilitação', x: 62, y: 47, w: 'com', tr: 4, d: 'Equipe clínica, licenças e cuidado diário.', m: 'Paga bem, mas cresce no ritmo dos especialistas.' },
    { t: 'Dropshipping', x: 22, y: 30, w: 'cai', tr: 5, d: 'Começa com um notebook e anúncios.', m: 'Sem fosso: qualquer um copia o produto.' },
    { t: 'Lavagem e serviços leves para casa', x: 29, y: 22, w: 'cai', tr: 4, d: 'Pouco capital e habilidade simples.', m: 'Cobra por serviço; o teto é local.' },
    { t: 'Máquinas de venda e ATMs', x: 14, y: 19, w: 'cai', tr: 7, d: 'Poucas horas por semana para repor e manter.', m: 'Cada máquina rende pouco; difícil ficar grande.' },
    { t: 'Wholesale imobiliário', x: 31, y: 34, w: 'cai', tr: 3, d: 'A habilidade principal é negociar contratos.', m: 'Comissão por negócio, sem um ativo que acumule.' },
    { t: 'Arbitragem de Airbnb', x: 34, y: 41, w: 'cai', tr: 6, d: 'Gestão leve de imóveis alugados de terceiros.', m: 'A margem depende do aluguel e das regras da cidade.' },
    { t: 'Conteúdo de afiliado', x: 19, y: 37, w: 'cai', tr: 5, d: 'Produzir conteúdo e atrair tráfego.', m: 'Depende de plataformas e de comissões alheias.' },
    { t: 'Coaching online', x: 42, y: 47, w: 'cai', tr: 2, d: 'Seu conhecimento e a sua entrega pessoal.', m: 'Margem alta, mas tudo depende do fundador.' },
    { t: 'Implementação de IA', x: 48, y: 53, w: 'arb', tr: 3, d: 'Habilidade técnica rara, projeto a projeto.', m: 'Projetos bem pagos; difícil vender a empresa.' },
    { t: 'Influenciador', x: 40, y: 57, w: 'arb', tr: 1, d: 'Constância de conteúdo e audiência.', m: 'Patrocínio alto para poucos — viés de sobrevivência.' },
    { t: 'Cirurgião', x: 56, y: 60, w: 'fos', tr: 1, d: 'Anos de formação e plantão.', m: 'Renda muito alta; sem você, a empresa vale pouco.' },
    { t: 'Agência enterprise', x: 53, y: 51, w: 'fos', tr: 4, d: 'Equipe sênior e vendas longas.', m: 'Tíquete alto; o valor está nas pessoas.' },
    { t: 'SaaS', x: 58, y: 75, w: 'fos', tr: 8, d: 'Time técnico e anos até tracionar.', m: 'Recorrência, margem e escala altas (fosso erodindo com IA).' },
    { t: 'Franquia', x: 69, y: 70, w: 'fos', tr: 8, d: 'Unidade-modelo validada e regras de franquia.', m: 'Royalties escalam sem operar cada loja.' },
    { t: 'Roll-up', x: 74, y: 65, w: 'fos', tr: 7, d: 'Capital e integração de várias empresas.', m: 'Juntar empresas pequenas aumenta o valor da soma.' },
    { t: 'Marketplace', x: 79, y: 87, w: 'fos', tr: 8, d: 'Capital e um efeito de rede difícil de iniciar.', m: 'Quando pega, o efeito de rede vale bilhões.' },
    { t: 'Farmacêutica', x: 90, y: 84, w: 'fos', tr: 8, d: 'Aprovação regulatória, capital e anos.', m: 'Patentes e fosso regulatório.' },
    { t: 'Banco', x: 86, y: 74, w: 'fos', tr: 9, d: 'Licença, regulação e muito capital.', m: 'Quem entra ganha quase uma licença para lucrar.' },
    { t: 'Bens de consumo (CPG)', x: 66, y: 80, w: 'fos', tr: 8, d: 'Marca, cadeia de suprimentos e capital.', m: 'Mercado enorme e uma marca que protege.' },
    { t: 'Energia e data centers', x: 93, y: 91, w: 'fos', tr: 8, d: 'Regulação, capital e habilidade.', m: 'Contratos longos e poucos competidores.' },
    { t: 'Med spa', x: 43, y: 66, w: 'arb', tr: 6, d: 'Clínica com protocolos, sem ser hospital.', m: 'Público mais velho e com dinheiro; demanda crescente.' },
    { t: 'Assessoria de patrimônio', x: 30, y: 77, w: 'arb', tr: 5, d: 'Carteira de clientes e licença.', m: 'O cliente fica e o patrimônio cresce sozinho.' },
    { t: 'Limpeza comercial', x: 26, y: 66, w: 'arb', tr: 7, d: 'Equipe, mas um serviço simples.', m: 'Contratos recorrentes e bons múltiplos.' },
    { t: 'Manutenção de elevadores', x: 37, y: 84, w: 'arb', tr: 7, d: 'Técnico especializado; poucos fabricantes.', m: 'Contrato obrigatório e recorrente.' },
    { t: 'Cobrança', x: 17, y: 68, w: 'arb', tr: 6, d: 'Saber vender e seguir as regras.', m: 'Pouca gente quer fazer, então sobra mercado.' },
    { t: 'Gestão de resíduos', x: 44, y: 74, w: 'arb', tr: 8, d: 'Licenças e logística de coleta.', m: 'Negócio "sem glamour": menos concorrência.', s: 'lynch' },
    { t: 'Cuidado de idosos', x: 33, y: 71, w: 'arb', tr: 6, d: 'Equipe de cuidado e licenças.', m: 'Há muito mais idosos do que vagas.' },
    { t: 'GLP-1 e Botox', x: 22, y: 84, w: 'arb', tr: 4, d: 'Protocolo clínico e prescrição.', m: 'Janela regulatória e demanda explosiva.' },
    { t: 'Sindicalização imobiliária', x: 12, y: 80, w: 'arb', tr: 4, d: 'Achar negócios e captar investidores.', m: 'A alavancagem do fundo multiplica o ganho.' }
  ];

  // Secondary / keyboard fallback for choosing a destination
  var CHIPS = {
    up: { label: '↑ mais dinheiro', at: function (c) { return [c.x, Math.min(96, c.y + 25)]; } },
    left: { label: '← mais fácil', at: function (c) { return [Math.max(4, c.x - 25), c.y]; } },
    arb: { label: '↖ Arbitragem', at: function (c) { return [clamp(Math.min(c.x - 12, 30), 4, 96), clamp(Math.max(c.y + 12, 70), 4, 96)]; } },
    fos: { label: '↗ Fosso', at: function (c) { return [clamp(Math.max(c.x + 8, 70), 4, 96), clamp(Math.max(c.y + 12, 70), 4, 96)]; } }
  };

  var state = { cur: null, wired: false, busy: false, sugBusy: false, rec: null, recBtn: null, goal: 'renda', tab: 'diag', chartMode: 'diag', g: null,
    lens: { open: false, pinned: false, key: '', hideT: 0 }, card: { open: false, key: '', btn: null }, objAuto: true, raf: 0, lastHostW: 0, justDragged: false };
  var drag = { pending: false, active: false, id: null, sx: 0, sy: 0, cx: 0, cy: 0, x: 0, y: 0, raf: 0, kbd: false, exKey: '' };

  // ── helpers ──
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function clean(v) { // COR-015
    if (v == null) return '';
    var s = String(v).trim();
    if (/^(null|undefined|n\/a|na|-|—|none|nenhum|nenhuma)$/i.test(s)) return '';
    return s;
  }
  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
  function num(v, d) { var n = parseFloat(v); return isNaN(n) ? d : n; }
  function toast(msg) {
    var t = $('toast'); if (!t) return;
    t.textContent = msg; t.classList.add('show');
    clearTimeout(t._tm); t._tm = setTimeout(function () { t.classList.remove('show'); }, 2600);
  }
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  function signed(n) { n = Math.round(n); return (n > 0 ? '+' : (n < 0 ? '−' : '±')) + Math.abs(n); }
  function cut(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
  function reducedMotion() { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } }
  function headerBottom() { var h = document.querySelector('.app-header'); return h ? Math.max(0, h.getBoundingClientRect().bottom) : 0; }
  function narrow() { var w = $('chart-wrap'); return !!w && w.getBoundingClientRect().width < 600; }

  // ── Deterministic positioning ─────────────────────────────────────────────
  function normRubric(r) {
    var out = {};
    RKEYS.forEach(function (k) {
      var it = r && r[k];
      var nota = (it && typeof it === 'object') ? it.nota : it;
      out[k] = { nota: clamp(Math.round(num(nota, 5)), 0, 10), porque: clean(it && typeof it === 'object' ? it.porque : '') };
    });
    return out;
  }
  function position(rub, legal) {
    var x = 0, y = 0;
    RUBRIC.forEach(function (c) {
      var n = rub[c.k].nota;
      var pts = (c.inverse ? (10 - n) : n) * c.w * 10;
      if (c.axis === 'x') x += pts; else y += pts;
    });
    var adj = -(clamp(num(legal, 5), 0, 10) - 5) * 0.6;
    y += adj;
    return { x: clamp(Math.round(x), 2, 98), y: clamp(Math.round(y), 2, 98), legalAdj: Math.round(adj * 10) / 10 };
  }
  function quad(x, y) { return y >= 50 ? (x < 50 ? 'arb' : 'fos') : (x < 50 ? 'cai' : 'com'); }
  function anchorOf(rub) { return !!(rub && rub.transferivel && rub.transferivel.nota <= ANCHOR_MAX); }
  function boundary(x, y) {
    var nx = Math.abs(x - 50) <= EDGE, ny = Math.abs(y - 50) <= EDGE;
    if (nx && ny) return 'no centro da carta, na fronteira entre os quatro quadrantes';
    if (nx) { var top = y >= 50; return 'na fronteira entre ' + QUADS[top ? 'arb' : 'cai'].nome + ' e ' + QUADS[top ? 'fos' : 'com'].nome; }
    if (ny) { var left = x < 50; return 'na fronteira entre ' + QUADS[left ? 'cai' : 'com'].nome + ' e ' + QUADS[left ? 'arb' : 'fos'].nome; }
    return '';
  }
  function goalFit(goal, q, anchor) {
    if (goal === 'fluxo') return (q === 'cai' || q === 'arb') ? 'bom' : (q === 'com' ? 'parcial' : 'ruim');
    if (goal === 'renda') { if (q === 'com') return anchor ? 'parcial' : 'ruim'; if (anchor || q === 'arb') return 'bom'; return 'parcial'; } // Commodities+âncora: parcial (the two rules conflict there)
    if (goal === 'empresa') { if (q === 'cai') return 'ruim'; if (q === 'fos' || q === 'arb') return anchor ? 'parcial' : 'bom'; return 'parcial'; }
    if (goal === 'bilhoes') { if (q === 'fos' && !anchor) return 'bom'; return q === 'arb' ? 'parcial' : 'ruim'; }
    return 'parcial';
  }
  function applyDeltas(rub, deltas) {
    var r2 = {};
    RKEYS.forEach(function (k) {
      var d = deltas && deltas[k] != null ? clamp(Math.round(num(deltas[k], 0)), -4, 4) : 0;
      r2[k] = { nota: clamp(rub[k].nota + d, 0, 10), porque: rub[k].porque };
    });
    return r2;
  }
  // Bring any stored entry (v1/v2/v3) to the v3 shape
  function normalizeEntry(e) {
    if (!e || e.x == null) return e;
    e.q = quad(e.x, e.y);
    e.anchor = anchorOf(e.rubric);
    e.fit = goalFit(e.goal, e.q, e.anchor);
    (e.pivots || []).forEach(function (p) {
      p.q = quad(p.x, p.y);
      if (p.anchor == null) p.anchor = e.rubric ? anchorOf(applyDeltas(e.rubric, p.deltas || {})) : false;
    });
    if (!e.target) e.target = null;
    if (e.sugs && e.sugs.length && e.sugs[0].dist == null) { e.sugs = []; e.sugTarget = null; }
    if (!e.sugs) e.sugs = [];
    if (e.sugs.length && e.target && e.sugTarget && (e.sugTarget.x !== e.target.x || e.sugTarget.y !== e.target.y)) { e.sugs = []; e.sugTarget = null; }
    e.sugs.forEach(function (s) { s.perto = s.dist <= NEAR; });
    return e;
  }

  // ── Chart geometry ────────────────────────────────────────────────────────
  // Every SVG font size is >= 18 user units (Arthur's browser has an 18 px
  // minimum font size; smaller sizes would be inflated and collide).
  function geom(mode, hostW) {
    if (mode === 'export') return { W: 1000, H: 640, L: 70, R: 978, T: 16, B: 580, compact: false, fz: { zone: 26, axis: 22, idea: 21, num: 18, ro: 20 }, r: { boat: 22, dot: 15, ex: 7, buoy: 14 } };
    if (hostW && hostW < 600) return { W: 560, H: 604, L: 44, R: 550, T: 12, B: 550, compact: true, fz: { zone: 24, axis: 21, idea: 21, num: 18, ro: 20 }, r: { boat: 21, dot: 15, ex: 8, buoy: 15 } };
    return { W: 1000, H: 624, L: 66, R: 984, T: 14, B: 568, compact: false, fz: { zone: 26, axis: 22, idea: 21, num: 18, ro: 20 }, r: { boat: 22, dot: 15, ex: 7, buoy: 14 } };
  }
  function pxf(g) { return function (x) { return g.L + (x / 100) * (g.R - g.L); }; }
  function pyf(g) { return function (y) { return g.B - (y / 100) * (g.B - g.T); }; }
  function quadRect(g, q) {
    var mx = pxf(g)(50), my = pyf(g)(50);
    if (q === 'arb') return { x: g.L, y: g.T, w: mx - g.L, h: my - g.T };
    if (q === 'fos') return { x: mx, y: g.T, w: g.R - mx, h: my - g.T };
    if (q === 'cai') return { x: g.L, y: my, w: mx - g.L, h: g.B - my };
    return { x: mx, y: my, w: g.R - mx, h: g.B - my };
  }
  var QFILL = { arb: '#c4e2dc', fos: '#a9cbd8', cai: '#d6e6ec', com: '#ece0bf' };

  function markersFor(cur, mode) {
    if (!cur) return [];
    if (mode === 'rumo' && cur.sugs && cur.sugs.length) return cur.sugs.map(function (s, i) { return { kind: 'sug', n: i + 1, x: s.x, y: s.y, ok: s.perto, anchor: s.anchor }; });
    if (mode !== 'rumo' && cur.pivots && cur.pivots.length) return cur.pivots.map(function (p, i) { return { kind: 'pivot', n: i + 1, x: p.x, y: p.y, ok: true, anchor: p.anchor }; });
    return [];
  }
  // Nudge dots that would sit on the boat or on each other — smallest displacement only
  function spreadDots(g, cur, list) {
    var px = pxf(g), py = pyf(g), bx = px(cur.x), by = py(cur.y);
    var minB = g.r.boat + g.r.dot + 4, minD = 2 * g.r.dot + 3, placed = [];
    function pushFromBoat(m, i) {
      var dx = m.cx - bx, dy = m.cy - by, d = Math.hypot(dx, dy);
      if (d >= minB) return;
      if (d < 0.5) { var a = -Math.PI / 2 + i * 0.9; dx = Math.cos(a); dy = Math.sin(a); d = 1; }
      m.cx = bx + dx / d * minB; m.cy = by + dy / d * minB;
    }
    list.forEach(function (m, i) {
      m.cx = px(m.x); m.cy = py(m.y);
      pushFromBoat(m, i);
      for (var it = 0; it < 24; it++) {
        var moved = false;
        placed.forEach(function (p, j) {
          var dx = m.cx - p.cx, dy = m.cy - p.cy, d = Math.hypot(dx, dy);
          if (d >= minD) return;
          if (d < 0.5) { var a = (i + j) % 2 ? 0 : Math.PI; dx = Math.cos(a); dy = Math.sin(a); d = 1; }
          m.cx += dx / d * (minD - d + 0.5); m.cy += dy / d * (minD - d + 0.5); moved = true;
        });
        pushFromBoat(m, i);
        m.cx = clamp(m.cx, g.L + g.r.dot + 2, g.R - g.r.dot - 2);
        m.cy = clamp(m.cy, g.T + g.r.dot + 2, g.B - g.r.dot - 2);
        if (!moved) break;
      }
      placed.push(m);
    });
    return list;
  }
  function anchorGlyph(cx, cy, r) {
    return '<g class="anchor-glyph" transform="translate(' + cx + ' ' + cy + ') scale(' + (r / 9) + ')"><circle r="9" fill="#14284a" stroke="#fffdf7" stroke-width="1.5"/>' +
      '<path d="M0 -4.6v10M-3.4 -1.4h6.8M-5.4 1.6c0 3 2.5 4.4 5.4 4.4s5.4-1.4 5.4-4.4" fill="none" stroke="#fffdf7" stroke-width="1.6" stroke-linecap="round"/>' +
      '<circle cy="-6" r="1.3" fill="none" stroke="#fffdf7" stroke-width="1.2"/></g>';
  }

  function buildSVG(g, o) {
    var px = pxf(g), py = pyf(g), cur = o.cur, p = o.idp;
    var mx = px(50), my = py(50), s = [];
    s.push('<svg xmlns="' + SVGNS + '" viewBox="0 0 ' + g.W + ' ' + g.H + '" class="chart-svg" role="img" aria-label="Carta com quatro quadrantes: dificuldade de operar no eixo horizontal, potencial de dinheiro no eixo vertical">');
    s.push('<defs><clipPath id="' + p + '-clip"><rect x="' + g.L + '" y="' + g.T + '" width="' + (g.R - g.L) + '" height="' + (g.B - g.T) + '"/></clipPath>' +
      '<marker id="' + p + '-ar-t" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#0f6b6b"/></marker>' +
      '<marker id="' + p + '-ar-g" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#7a8494"/></marker></defs>');
    s.push('<rect class="bg" x="0" y="0" width="' + g.W + '" height="' + g.H + '" fill="#fffdf7"/>');
    QORDER.forEach(function (q) { var r = quadRect(g, q); s.push('<rect x="' + r.x + '" y="' + r.y + '" width="' + r.w + '" height="' + r.h + '" fill="' + QFILL[q] + '"/>'); });
    s.push('<g class="qhl">');
    QORDER.forEach(function (q) { var r = quadRect(g, q); s.push('<rect class="qhl-r" data-q="' + q + '" x="' + r.x + '" y="' + r.y + '" width="' + r.w + '" height="' + r.h + '"/>'); });
    s.push('</g>');
    s.push('<line x1="' + mx + '" y1="' + g.T + '" x2="' + mx + '" y2="' + g.B + '" stroke="#14284a" stroke-width="1" opacity=".35"/>');
    s.push('<line x1="' + g.L + '" y1="' + my + '" x2="' + g.R + '" y2="' + my + '" stroke="#14284a" stroke-width="1" opacity=".35"/>');
    s.push('<rect x="' + g.L + '" y="' + g.T + '" width="' + (g.R - g.L) + '" height="' + (g.B - g.T) + '" fill="none" stroke="#14284a" stroke-width="1.5"/>');
    var marks = cur ? spreadDots(g, cur, markersFor(cur, o.mode)) : [];
    o.circles = []; o.segs = [];
    if (cur) {
      var bx = px(cur.x), by = py(cur.y);
      s.push('<g class="arrows">');
      marks.forEach(function (m) {
        var d = Math.hypot(m.cx - bx, m.cy - by); if (d < 4) return;
        var ux = (m.cx - bx) / d, uy = (m.cy - by) / d;
        var x1 = bx + ux * (g.r.boat + 3), y1 = by + uy * (g.r.boat + 3), x2 = m.cx - ux * (g.r.dot + 3), y2 = m.cy - uy * (g.r.dot + 3);
        var grey = m.kind === 'sug' && !m.ok;
        s.push('<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" stroke="' + (grey ? '#7a8494' : '#0f6b6b') + '" stroke-width="1.6"' + (grey ? ' stroke-dasharray="5 5"' : '') + ' marker-end="url(#' + p + (grey ? '-ar-g' : '-ar-t') + ')"/>');
        o.segs.push([x1, y1, x2, y2]);
      });
      s.push('</g>');
    }
    if (o.showHist && o.history && o.history.length) {
      s.push('<g class="hist">');
      o.history.forEach(function (h, i) {
        if (cur && h.id === cur.id) return;
        var hx = px(h.x), hy = py(h.y);
        s.push('<g class="buoy-h"><title>' + esc((i + 1) + '. ' + h.titulo) + '</title><circle cx="' + hx + '" cy="' + hy + '" r="13" fill="#fffdf7" stroke="#2e4366" stroke-width="2.4"/><text x="' + hx + '" y="' + (hy + 6.3) + '" text-anchor="middle" font-family="Menlo,Consolas,monospace" font-size="18" font-weight="700" fill="#14284a">' + (i + 1) + '</text></g>');
        o.circles.push({ cx: hx, cy: hy, r: 13 });
      });
      s.push('</g>');
    }
    if (marks.length) {
      s.push('<g class="dots">');
      marks.forEach(function (m) {
        var fill = m.kind === 'pivot' ? '#e3f1ee' : (m.ok ? '#0f6b6b' : '#fffdf7');
        var stroke = m.kind === 'sug' && !m.ok ? '#7a8494' : '#0f6b6b';
        var tc = m.kind === 'sug' && m.ok ? '#ffffff' : (m.kind === 'sug' ? '#4a5a74' : '#0f6b6b');
        s.push('<circle cx="' + m.cx + '" cy="' + m.cy + '" r="' + g.r.dot + '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="2.2"/>' +
          '<text x="' + m.cx + '" y="' + (m.cy + g.fz.num * 0.35) + '" text-anchor="middle" font-family="Menlo,Consolas,monospace" font-size="' + g.fz.num + '" font-weight="700" fill="' + tc + '">' + m.n + '</text>');
        if (m.anchor) s.push(anchorGlyph(m.cx + g.r.dot * 0.85, m.cy - g.r.dot * 0.85, 7.5));
        o.circles.push({ cx: m.cx, cy: m.cy, r: g.r.dot + (m.anchor ? 6 : 0) });
      });
      s.push('</g>');
    }
    if (cur) {
      var bx2 = px(cur.x), by2 = py(cur.y), r = g.r.boat, k = r / 22;
      s.push('<g class="boat">' +
        '<circle cx="' + bx2 + '" cy="' + by2 + '" r="' + r + '" fill="#fffdf7" fill-opacity=".55" stroke="#b5246b" stroke-width="2.6"/>' +
        '<g transform="translate(' + bx2 + ' ' + by2 + ') scale(' + k + ')"><path d="M-13 3h26l-5 7h-16z" fill="#14284a"/><path d="M0 -15v18" stroke="#14284a" stroke-width="2"/><path d="M1.5 -13l10 14h-10z" fill="#b5246b"/><path d="M-1.5 -10l-7 11h7z" fill="#fffdf7" stroke="#14284a" stroke-width="1"/></g>' +
        (cur.anchor ? anchorGlyph(bx2 + r * 0.78, by2 + r * 0.78, 10) : '') +
        '</g>');
      o.circles.push({ cx: bx2, cy: by2, r: r + (cur.anchor ? 8 : 0) });
      if (o.target) {
        var tx = px(o.target.x), ty = py(o.target.y);
        o.circles.push({ cx: tx, cy: ty, r: g.r.buoy + 4 });
        o.segs.push([bx2, by2, tx, ty]);
      }
    }
    s.push('<g class="dest"></g>');
    s.push('<g class="labels" font-family="Georgia,\'Iowan Old Style\',serif" fill="#14284a">');
    QORDER.forEach(function (q) {
      s.push('<text class="zl" data-q="' + q + '" font-size="' + g.fz.zone + '" font-style="italic" font-weight="700" stroke="#fffdf7" stroke-opacity=".85" stroke-width="6" stroke-linejoin="round" paint-order="stroke" x="0" y="0">' + esc(QUADS[q].nome) + '</text>');
    });
    var axY = g.B + (g.compact ? 34 : 38);
    s.push('<text class="ax" x="' + ((g.L + g.R) / 2) + '" y="' + axY + '" text-anchor="middle" font-size="' + g.fz.axis + '" font-style="italic" fill="#2e4366">fácil ← Dificuldade de operar → difícil</text>');
    s.push('<text class="ax" transform="translate(' + (g.L - 16) + ' ' + ((g.T + g.B) / 2) + ') rotate(-90)" text-anchor="middle" font-size="' + g.fz.axis + '" font-style="italic" fill="#2e4366">pouco ← Potencial de dinheiro → muito</text>');
    s.push('</g>');
    s.push('<g class="idea-tag"></g>');
    s.push('<g class="ex-dots"></g>');
    s.push('</svg>');
    return s.join('');
  }

  // ── Layout pass: real measurements, no overlaps ───────────────────────────
  function rectOverlap(a, b) {
    var w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    var h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    return (w > 0 && h > 0) ? w * h : 0;
  }
  function inflate(r, m) { return { x: r.x - m, y: r.y - m, w: r.w + 2 * m, h: r.h + 2 * m }; }
  function segHitsRect(sg, r) {
    for (var i = 0; i <= 24; i++) {
      var t = i / 24, x = sg[0] + (sg[2] - sg[0]) * t, y = sg[1] + (sg[3] - sg[1]) * t;
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return true;
    }
    return false;
  }
  function bboxOf(el) { var bb = el.getBBox(); return { x: bb.x, y: bb.y, w: bb.width, h: bb.height }; }
  function setLines(el, lines, x, yTop, fz) {
    while (el.firstChild) el.removeChild(el.firstChild);
    el.setAttribute('font-size', fz);
    el.setAttribute('aria-label', lines.join(' '));
    lines.forEach(function (ln, i) {
      var ts = document.createElementNS(SVGNS, 'tspan');
      ts.setAttribute('x', x);
      ts.setAttribute('y', yTop + fz * 0.8 + i * fz * 1.12);
      ts.textContent = ln;
      el.appendChild(ts);
    });
  }
  function wrap2(text) {
    var words = text.split(' ');
    if (words.length < 2) return [text];
    var best = null;
    for (var i = 1; i < words.length; i++) {
      var a = words.slice(0, i).join(' '), b = words.slice(i).join(' ');
      var score = Math.max(a.length, b.length);
      if (!best || score < best.score) best = { score: score, lines: [a, b] };
    }
    return best.lines;
  }

  // Places the 4 zone names (with room for the "i" button at the outer side) and the
  // "Sua ideia" tag. Returns the "i" centres in user units.
  function layout(svg, g, o) {
    var px = pxf(g), py = pyf(g), mx = px(50), my = py(50), pad = g.compact ? 10 : 14;
    var iw = o.iw || 0, gap = iw ? 6 : 0;
    var circleRects = (o.circles || []).map(function (c) { return { x: c.cx - c.r - 3, y: c.cy - c.r - 3, w: 2 * c.r + 6, h: 2 * c.r + 6 }; });
    var placed = [], info = {};
    function cands(near, nearX, far, farX, t1, t2, tm) {
      return [[near, nearX, t1, 0], [near, nearX, t2, 0.5], [far, farX, t1, 1], [far, farX, t2, 1.5], [near, nearX, tm, 2], [far, farX, tm, 2.5]];
    }
    var specs = {
      arb: { maxW: (mx - g.L) - 2 * pad - iw - gap, c: cands('start', g.L + pad, 'end', mx - pad, function () { return g.T + pad; }, function (h) { return my - pad - h; }, function (h) { return (g.T + my) / 2 - h / 2; }) },
      fos: { maxW: (g.R - mx) - 2 * pad - iw - gap, c: cands('end', g.R - pad, 'start', mx + pad, function () { return g.T + pad; }, function (h) { return my - pad - h; }, function (h) { return (g.T + my) / 2 - h / 2; }) },
      cai: { maxW: (mx - g.L) - 2 * pad - iw - gap, c: cands('start', g.L + pad, 'end', mx - pad, function (h) { return g.B - pad - h; }, function () { return my + pad; }, function (h) { return (my + g.B) / 2 - h / 2; }) },
      com: { maxW: (g.R - mx) - 2 * pad - iw - gap, c: cands('end', g.R - pad, 'start', mx + pad, function (h) { return g.B - pad - h; }, function () { return my + pad; }, function (h) { return (my + g.B) / 2 - h / 2; }) }
    };
    QORDER.forEach(function (q) {
      var el = svg.querySelector('.zl[data-q="' + q + '"]'); if (!el) return;
      var sp = specs[q], txt = QUADS[q].nome, fz = g.fz.zone, lines = [txt];
      el.setAttribute('text-anchor', 'start');
      setLines(el, lines, 0, 0, fz);
      if (bboxOf(el).w > sp.maxW) {                       // shrink first (one line reads best), then wrap
        while (bboxOf(el).w > sp.maxW && fz > 20) { fz -= 1; setLines(el, lines, 0, 0, fz); }
        if (bboxOf(el).w > sp.maxW) { fz = g.fz.zone; lines = wrap2(txt); setLines(el, lines, 0, 0, fz); while (bboxOf(el).w > sp.maxW && fz > 18) { fz -= 1; setLines(el, lines, 0, 0, fz); } }
      }
      var h = bboxOf(el).h, best = null;
      sp.c.forEach(function (cand) {
        var anchor = cand[0], edge = cand[1], top = cand[2](h);
        var tx = anchor === 'start' ? edge + iw + gap : edge - iw - gap;
        el.setAttribute('text-anchor', anchor);
        setLines(el, lines, tx, top, fz);
        var bb = bboxOf(el);
        var full = anchor === 'start' ? { x: bb.x - iw - gap, y: Math.min(bb.y, top), w: bb.w + iw + gap, h: Math.max(bb.h, iw) } : { x: bb.x, y: Math.min(bb.y, top), w: bb.w + iw + gap, h: Math.max(bb.h, iw) };
        var cost = cand[3];
        if (full.y < g.T + 1 || full.y + full.h > g.B - 1 || full.x < g.L + 1 || full.x + full.w > g.R - 1) cost += 1e6;
        circleRects.forEach(function (c) { cost += rectOverlap(inflate(full, 4), c) * 10; });
        (o.segs || []).forEach(function (sg) { if (segHitsRect(sg, inflate(full, 2))) cost += 300; });
        placed.forEach(function (pl) { cost += rectOverlap(inflate(full, 4), pl) * 10; });
        if (!best || cost < best.cost) best = { cost: cost, anchor: anchor, tx: tx, top: top, edge: edge, full: full };
      });
      el.setAttribute('text-anchor', best.anchor);
      setLines(el, lines, best.tx, best.top, fz);
      placed.push(best.full);
      var lineMid = best.top + fz * 0.52;
      info[q] = { cx: best.anchor === 'start' ? best.edge + iw / 2 : best.edge - iw / 2, cy: lineMid };
    });
    // idea tag: "Sua ideia" — never overlaps a label, dot, arrow, buoy or the boat
    var cur = o.cur, tagG = svg.querySelector('.idea-tag');
    if (!cur || !tagG) return { info: info };
    var bx = px(cur.x), by = py(cur.y), r = g.r.boat + (cur.anchor ? 8 : 0);
    var rect = document.createElementNS(SVGNS, 'rect');
    var txt2 = document.createElementNS(SVGNS, 'text');
    txt2.setAttribute('font-family', 'Georgia,serif'); txt2.setAttribute('font-style', 'italic'); txt2.setAttribute('font-weight', '700');
    txt2.setAttribute('font-size', g.fz.idea); txt2.setAttribute('fill', '#fffdf7'); txt2.textContent = 'Sua ideia';
    tagG.appendChild(rect); tagG.appendChild(txt2);
    txt2.setAttribute('x', 0); txt2.setAttribute('y', 0);
    var tb = bboxOf(txt2), w = tb.w + 18, h2 = g.fz.idea + 12;
    var obst = placed.map(function (l) { return inflate(l, 4); }).concat(circleRects);
    var best2 = null;
    [r + 8, r + 40, r + 80, r + 130].forEach(function (gp, ring) {
      for (var i = 0; i < 12; i++) {
        var a = [0, 180, 90, 270, 30, 150, 330, 210, 60, 120, 300, 240][i] * Math.PI / 180;
        var cx = bx + Math.cos(a) * (gp + w / 2), cy = by - Math.sin(a) * (gp + h2 / 2);
        var rr = { x: cx - w / 2, y: cy - h2 / 2, w: w, h: h2 };
        if (rr.x < g.L + 3 || rr.x + rr.w > g.R - 3 || rr.y < g.T + 3 || rr.y + rr.h > g.B - 3) continue;
        var cost = ring * 50 + i * 0.1;
        obst.forEach(function (ob) { cost += rectOverlap(rr, ob) * 20; });
        (o.segs || []).forEach(function (sg) { if (segHitsRect(sg, rr)) cost += 400; });
        if (!best2 || cost < best2.cost) best2 = { cost: cost, rr: rr, ring: ring };
      }
    });
    if (!best2) best2 = { rr: { x: clamp(bx + r + 8, g.L + 3, g.R - w - 3), y: clamp(by - h2 / 2, g.T + 3, g.B - h2 - 3), w: w, h: h2 }, ring: 0 };
    var c = best2.rr;
    rect.setAttribute('x', c.x); rect.setAttribute('y', c.y); rect.setAttribute('width', w); rect.setAttribute('height', h2);
    rect.setAttribute('rx', 5); rect.setAttribute('fill', '#14284a');
    txt2.setAttribute('x', c.x + 9); txt2.setAttribute('y', c.y + h2 / 2 + g.fz.idea * 0.34);
    if (best2.ring > 0) {
      var ccx = c.x + w / 2, ccy = c.y + h2 / 2, d = Math.hypot(ccx - bx, ccy - by) || 1;
      var line = document.createElementNS(SVGNS, 'line');
      line.setAttribute('x1', bx + (ccx - bx) / d * (r + 2)); line.setAttribute('y1', by + (ccy - by) / d * (r + 2));
      line.setAttribute('x2', ccx); line.setAttribute('y2', ccy);
      line.setAttribute('stroke', '#14284a'); line.setAttribute('stroke-width', '1.4');
      tagG.insertBefore(line, rect);
    }
    return { info: info };
  }

  // ── Destination (drag / keyboard / chips) ────────────────────────────────
  function destText(cur, t) {
    t = t || cur.target; if (!t) return '';
    return signed(t.y - cur.y) + ' dinheiro · ' + signed(t.x - cur.x) + ' dificuldade · ' + QUADS[quad(t.x, t.y)].nome;
  }
  function ensureDest(svg, g) {
    var d = svg.querySelector('.dest'); if (!d) return null;
    if (!d.querySelector('.route')) {
      var route = document.createElementNS(SVGNS, 'line'); route.setAttribute('class', 'route'); d.appendChild(route);
      var buoy = document.createElementNS(SVGNS, 'g'); buoy.setAttribute('class', 'buoy');
      buoy.innerHTML = '<circle class="buoy-ring" r="' + g.r.buoy + '"/><circle class="buoy-core" r="5"/>';
      d.appendChild(buoy);
      var ro = document.createElementNS(SVGNS, 'g'); ro.setAttribute('class', 'readout'); ro.setAttribute('visibility', 'hidden');
      ro.innerHTML = '<rect rx="6"/><text class="ro1" font-family="Georgia,serif" font-weight="700" font-size="' + g.fz.ro + '"></text><text class="ro2" font-family="Georgia,serif" font-style="italic" font-size="' + g.fz.ro + '"></text>';
      d.appendChild(ro);
    }
    return d;
  }
  function drawDest(svg, g, x, y, live) {
    var cur = state.cur; if (!svg || !g || !cur) return;
    var d = ensureDest(svg, g); if (!d) return;
    var px = pxf(g), py = pyf(g), bx = px(cur.x), by = py(cur.y), tx = px(x), ty = py(y);
    var route = d.querySelector('.route'), buoy = d.querySelector('.buoy'), ro = d.querySelector('.readout');
    var dd = Math.hypot(tx - bx, ty - by) || 1, ux = (tx - bx) / dd, uy = (ty - by) / dd;
    var show = dd > g.r.boat + g.r.buoy + 4;
    route.setAttribute('x1', bx + ux * (g.r.boat + 3)); route.setAttribute('y1', by + uy * (g.r.boat + 3));
    route.setAttribute('x2', tx - ux * (g.r.buoy + 3)); route.setAttribute('y2', ty - uy * (g.r.buoy + 3));
    route.setAttribute('visibility', show ? 'visible' : 'hidden');
    buoy.setAttribute('transform', 'translate(' + tx + ' ' + ty + ')');
    if (!live) { ro.setAttribute('visibility', 'hidden'); return; }
    var t1 = ro.querySelector('.ro1'), t2 = ro.querySelector('.ro2'), rect = ro.querySelector('rect');
    var near = nearestExamples(x, y).slice(0, 2).map(function (e) { return cut(e.t, 24); });
    t1.textContent = destText(cur, { x: Math.round(x), y: Math.round(y) });
    t2.textContent = near.length ? 'perto: ' + near.join(' · ') : '';
    t1.setAttribute('x', 0); t1.setAttribute('y', 0); t2.setAttribute('x', 0); t2.setAttribute('y', g.fz.ro * 1.2);
    var b1 = bboxOf(t1), b2 = bboxOf(t2), w = Math.max(b1.w, b2.w) + 20, h = g.fz.ro * 2.4 + 14;
    var off = g.r.buoy + 10, spots = [[tx + off, ty - off - h], [tx - off - w, ty - off - h], [tx + off, ty + off], [tx - off - w, ty + off]];
    var pick = spots[0];
    for (var i = 0; i < spots.length; i++) {
      var sx = spots[i][0], sy = spots[i][1];
      if (sx >= g.L + 2 && sx + w <= g.R - 2 && sy >= g.T + 2 && sy + h <= g.B - 2 && rectOverlap({ x: sx, y: sy, w: w, h: h }, { x: bx - g.r.boat, y: by - g.r.boat, w: 2 * g.r.boat, h: 2 * g.r.boat }) === 0) { pick = spots[i]; break; }
    }
    var rx = clamp(pick[0], g.L + 2, g.R - w - 2), ry = clamp(pick[1], g.T + 2, g.B - h - 2);
    rect.setAttribute('x', rx); rect.setAttribute('y', ry); rect.setAttribute('width', w); rect.setAttribute('height', h);
    t1.setAttribute('x', rx + 10); t1.setAttribute('y', ry + 8 + g.fz.ro * 0.92);
    t2.setAttribute('x', rx + 10); t2.setAttribute('y', ry + 8 + g.fz.ro * 2.12);
    ro.setAttribute('visibility', 'visible');
  }
  function setQHL(svg, q) {
    if (!svg) return;
    Array.prototype.forEach.call(svg.querySelectorAll('.qhl-r'), function (r) { r.classList.toggle('on', r.getAttribute('data-q') === q); });
  }
  function canDrag() { return !!state.cur && !$('result').hidden && !state.busy; }
  function startDrag() {
    var svg = $('chart-host').querySelector('svg'); if (!svg) return;
    hideLens(true); closeCard(false);
    $('dest-go').hidden = true;
    svg.classList.add('dragging');
    var boat = svg.querySelector('.boat'); if (boat) boat.classList.add('ghost');
  }
  function moveDest(x, y) {
    var svg = $('chart-host').querySelector('svg'), g = state.g; if (!svg) return;
    drag.x = clamp(x, 2, 98); drag.y = clamp(y, 2, 98);
    drawDest(svg, g, drag.x, drag.y, true);
    setQHL(svg, quad(drag.x, drag.y));
    var list = nearestExamples(drag.x, drag.y).slice(0, 3), key = list.map(function (e) { return e.t; }).join('|');
    if (key !== drag.exKey) { drag.exKey = key; drawExDots(list); }
  }
  function endDrag(commit) {
    var svg = $('chart-host').querySelector('svg');
    if (svg) { svg.classList.remove('dragging'); var boat = svg.querySelector('.boat'); if (boat) boat.classList.remove('ghost'); setQHL(svg, null); }
    drag.exKey = ''; drawExDots([]);
    if (commit) commitTarget(drag.x, drag.y);
    else if (state.cur && state.cur.target) { drawDest(svg, state.g, state.cur.target.x, state.cur.target.y, false); placeDestGo(); }
    else if (svg) { var d = svg.querySelector('.dest'); if (d) while (d.firstChild) d.removeChild(d.firstChild); }
  }
  function commitTarget(x, y) {
    var cur = state.cur; if (!cur) return;
    cur.target = { x: Math.round(clamp(x, 2, 98)), y: Math.round(clamp(y, 2, 98)) };
    if (cur.sugs && cur.sugs.length && !(cur.sugTarget && cur.sugTarget.x === cur.target.x && cur.sugTarget.y === cur.target.y)) {
      cur.sugs = []; cur.sugTarget = null;            // old suggestions answered another destination
      var st = $('sug-status'); if (st) st.textContent = 'Novo destino. Clique em "Sugerir negócios para chegar aqui".';
    }
    lsSet(CURRENT_SLOT, cur);
    announce('Destino: ' + destText(cur));
    if (state.tab !== 'rumo') setTab('rumo'); else { renderChart(); renderRumo(); }
  }
  function announce(t) { var a = $('dest-live'); if (a) a.textContent = t; }

  // pointer handling: mouse/pen drag anywhere on the board; touch only from the boat handle
  function onDown(e) {
    if (!canDrag() || e.pointerType === 'touch' || e.button !== 0) return;
    if (e.target.closest && e.target.closest('.zinfo,.dest-go,#chart-pop,#zone-card')) return;
    var d = toData(e); if (!d || !d.inside) return;
    drag.pending = true; drag.active = false; drag.kbd = false; drag.id = e.pointerId; drag.sx = e.clientX; drag.sy = e.clientY;
    try { $('chart-host').setPointerCapture(e.pointerId); } catch (_) {}
  }
  function onHandleDown(e) {
    if (!canDrag()) return;
    e.preventDefault();
    drag.pending = false; drag.active = true; drag.kbd = false; drag.id = e.pointerId; drag.sx = e.clientX; drag.sy = e.clientY;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) {}
    startDrag();
    queueMove(e);
  }
  function queueMove(e) {
    drag.cx = e.clientX; drag.cy = e.clientY;
    if (drag.raf) return;
    drag.raf = requestAnimationFrame(function () {
      drag.raf = 0;
      if (!drag.active) return;
      var d = toData({ clientX: drag.cx, clientY: drag.cy }); if (d) moveDest(d.x, d.y);
    });
  }
  function onDragMove(e) {
    if (drag.id == null || e.pointerId !== drag.id) return false;
    if (drag.pending && !drag.active) {
      if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 5) return true;
      drag.active = true; drag.pending = false; startDrag();
    }
    if (drag.active) { queueMove(e); return true; }
    return false;
  }
  function onDragUp(e) {
    if (drag.id == null || e.pointerId !== drag.id) return;
    var was = drag.active;
    drag.pending = false; drag.active = false; drag.id = null;
    if (drag.raf) { cancelAnimationFrame(drag.raf); drag.raf = 0; var d = toData({ clientX: e.clientX, clientY: e.clientY }); if (was && d) { drag.x = clamp(d.x, 2, 98); drag.y = clamp(d.y, 2, 98); } }
    if (was) { state.justDragged = true; setTimeout(function () { state.justDragged = false; }, 60); endDrag(true); }
  }
  function onDragCancel(e) {
    if (drag.id == null || e.pointerId !== drag.id) return;
    var was = drag.active; drag.pending = false; drag.active = false; drag.id = null;
    if (was) endDrag(false);
  }
  // keyboard: focus the board, arrows move the buoy, Enter suggests, Esc cancels
  function onBoardKey(e) {
    if (e.target !== $('chart-wrap')) return;
    var k = e.key;
    if (k === 'Escape') {
      if (state.card.open) { closeCard(true); e.preventDefault(); return; }
      if (state.lens.open) { hideLens(true); e.preventDefault(); return; }
      if (drag.kbd) { drag.kbd = false; endDrag(false); e.preventDefault(); }
      return;
    }
    if (!canDrag()) return;
    var dirs = { ArrowUp: [0, 1], ArrowDown: [0, -1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
    if (dirs[k]) {
      e.preventDefault();
      var step = e.shiftKey ? 10 : 2;
      if (!drag.kbd) { var t = state.cur.target || { x: state.cur.x, y: state.cur.y }; drag.x = t.x; drag.y = t.y; drag.kbd = true; startDrag(); }
      moveDest(drag.x + dirs[k][0] * step, drag.y + dirs[k][1] * step);
      announce(destText(state.cur, { x: Math.round(drag.x), y: Math.round(drag.y) }));
      return;
    }
    if (k === 'Enter') {
      e.preventDefault();
      if (drag.kbd) { drag.kbd = false; endDrag(true); }
      if (state.cur.target) suggest(); else toast('Use as setas para escolher um destino na carta.');
    }
  }
  function setTargetFromChip(key) {
    var cur = state.cur; if (!cur || !CHIPS[key]) return;
    var at = CHIPS[key].at(cur);
    commitTarget(at[0], at[1]);
  }

  // ── Render the on-screen chart ────────────────────────────────────────────
  function hostWidth() { var h = $('chart-host'); return h ? h.clientWidth : 0; }
  function renderChart() {
    var host = $('chart-host'); if (!host) return;
    var hw = hostWidth() || 800;
    state.lastHostW = hw;
    var g = geom('screen', hw); state.g = g;
    var scale = hw / g.W;
    var cur = state.cur;
    var o = { idp: 'c', cur: cur, mode: state.chartMode, iw: 30 / scale, target: cur && cur.target, showHist: $('toggle-history') && $('toggle-history').checked, history: lsGet(HISTORY_STORE, []).map(normalizeEntry) };
    host.innerHTML = buildSVG(g, o);
    host.classList.toggle('can-drag', !!cur && !$('result').hidden);
    var svg = host.querySelector('svg'), res = null;
    try { res = layout(svg, g, o); } catch (e) { /* layout is cosmetic; never break the app */ }
    if (cur && cur.target) drawDest(svg, g, cur.target.x, cur.target.y, false);
    placeInfoButtons(svg, g, res && res.info);
    placeHandle(); placeDestGo();
    hideLens(true);
    updateHint();
  }
  function wrapPoint(svg, ux, uy) {
    var wr = $('chart-wrap').getBoundingClientRect();
    var pt = new DOMPoint(ux, uy).matrixTransform(svg.getScreenCTM());
    return { x: pt.x - wr.left, y: pt.y - wr.top };
  }
  function placeInfoButtons(svg, g, info) {
    var box = $('info-btns'); if (!box) return;
    box.innerHTML = '';
    if (!svg || !info) return;
    QORDER.forEach(function (q) {
      if (!info[q]) return;
      var p = wrapPoint(svg, info[q].cx, info[q].cy);
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'zinfo'; b.textContent = 'i';
      b.setAttribute('data-q', q); b.setAttribute('aria-expanded', 'false'); b.setAttribute('aria-controls', 'zone-card');
      b.setAttribute('aria-label', 'O que é o quadrante ' + QUADS[q].nome + '?');
      b.style.left = Math.round(p.x - 15) + 'px'; b.style.top = Math.round(p.y - 15) + 'px';
      box.appendChild(b);
    });
  }
  function placeHandle() {
    var h = $('boat-handle'), svg = $('chart-host').querySelector('svg'), g = state.g;
    if (!h) return;
    if (!state.cur || !svg || $('result').hidden) { h.hidden = true; return; }
    var p = wrapPoint(svg, pxf(g)(state.cur.x), pyf(g)(state.cur.y));
    h.style.left = Math.round(p.x - 28) + 'px'; h.style.top = Math.round(p.y - 28) + 'px';
    h.hidden = false;
  }
  function placeDestGo() {
    var b = $('dest-go'), svg = $('chart-host').querySelector('svg'), g = state.g, cur = state.cur;
    if (!b) return;
    var done = cur && cur.target && cur.sugTarget && cur.sugTarget.x === cur.target.x && cur.sugTarget.y === cur.target.y && cur.sugs && cur.sugs.length;
    if (!cur || !cur.target || !svg || $('result').hidden || done || state.sugBusy) { b.hidden = true; return; }
    b.hidden = false;
    var p = wrapPoint(svg, pxf(g)(cur.target.x), pyf(g)(cur.target.y));
    var wr = $('chart-wrap').getBoundingClientRect(), bw = b.offsetWidth, bh = b.offsetHeight;
    // Next to the buoy, on the first side that covers no corner "i", the boat or the buoy itself.
    var avoid = [].slice.call(document.querySelectorAll('#info-btns .zinfo, #boat-handle')).filter(function (el) { return !el.hidden; }).map(function (el) {
      var r = el.getBoundingClientRect(); return { l: r.left - wr.left - 4, t: r.top - wr.top - 4, r: r.right - wr.left + 4, b: r.bottom - wr.top + 4 };
    });
    avoid.push({ l: p.x - 16, t: p.y - 16, r: p.x + 16, b: p.y + 16 });
    var cands = [[p.x - bw / 2, p.y + 22], [p.x - bw / 2, p.y - 22 - bh], [p.x + 24, p.y - bh / 2], [p.x - 24 - bw, p.y - bh / 2]];
    var best = null;
    cands.forEach(function (c, i) {
      var l = clamp(c[0], 4, wr.width - bw - 4), t = clamp(c[1], 4, wr.height - bh - 4), cost = i * 0.5;
      avoid.forEach(function (a) { var ox = Math.min(l + bw, a.r) - Math.max(l, a.l), oy = Math.min(t + bh, a.b) - Math.max(t, a.t); if (ox > 0 && oy > 0) cost += ox * oy; });
      if (!best || cost < best.cost) best = { l: l, t: t, cost: cost };
    });
    b.style.left = Math.round(best.l) + 'px'; b.style.top = Math.round(best.t) + 'px';
  }
  function updateHint() {
    var h = $('chart-hint'); if (!h) return;
    var hover = false; try { hover = window.matchMedia('(hover: hover)').matches; } catch (e) {}
    if (!state.cur || $('result').hidden) h.textContent = hover ? 'Passe o mouse na carta para ver exemplos. O "i" de cada canto explica o quadrante.' : 'Toque na carta para ver exemplos. O "i" de cada canto explica o quadrante.';
    else h.textContent = hover ? 'Arraste na carta (ou o barco) até onde você quer chegar. Pelo teclado: setas e Enter.' : 'Arraste o barco até onde você quer chegar. Toque na carta para ver exemplos.';
  }

  // ── Pointer → data coordinates ────────────────────────────────────────────
  function toData(evt) {
    var svg = $('chart-host').querySelector('svg'), g = state.g;
    if (!svg || !g || !svg.getScreenCTM()) return null;
    var pt = new DOMPoint(evt.clientX, evt.clientY).matrixTransform(svg.getScreenCTM().inverse());
    var x = (pt.x - g.L) / (g.R - g.L) * 100, y = (g.B - pt.y) / (g.B - g.T) * 100;
    return { x: x, y: y, inside: x >= 0 && x <= 100 && y >= 0 && y <= 100 };
  }

  // ── Example lens (hover / tap) — stable: re-renders only when the set changes ──
  function nearestExamples(x, y) {
    var g = state.g || geom('screen', 800), sx = (g.R - g.L) / 100, sy = (g.B - g.T) / 100;
    var list = EXAMPLES.map(function (e) { return { e: e, d: Math.hypot((e.x - x) * sx, (e.y - y) * sy) }; }).sort(function (a, b) { return a.d - b.d; });
    var lim = Math.max(list.length ? list[0].d * 2.2 : 0, (g.R - g.L) * 0.16);
    var out = [];
    list.forEach(function (it) { if (out.length < 4 && (out.length < 2 || it.d <= lim)) out.push(it.e); });
    return out;
  }
  function drawExDots(list) {
    var svg = $('chart-host').querySelector('svg'); if (!svg) return;
    var gEx = svg.querySelector('.ex-dots'), g = state.g; if (!gEx) return;
    while (gEx.firstChild) gEx.removeChild(gEx.firstChild);
    list.forEach(function (e) {
      var c = document.createElementNS(SVGNS, 'circle');
      c.setAttribute('cx', pxf(g)(e.x)); c.setAttribute('cy', pyf(g)(e.y)); c.setAttribute('r', g.r.ex);
      c.setAttribute('class', 'ex-dot'); gEx.appendChild(c);
    });
    requestAnimationFrame(function () { Array.prototype.forEach.call(gEx.children, function (c) { c.classList.add('on'); }); });
  }
  function exAnchor(e) { return e.tr <= ANCHOR_MAX; }
  function lensHTML(list, pinned) {
    var h = ['<p class="pop-title">Exemplos perto daqui</p><ul class="pop-list">'];
    list.forEach(function (e, i) {
      var q = quad(e.x, e.y), src = sourceById(e.s || 'hormozi_video');
      h.push('<li><button type="button" class="pop-item" aria-expanded="false" aria-controls="pop-d' + i + '"><span class="pop-name">' + esc(e.t) + (exAnchor(e) ? ' <span class="anc" title="Âncora: depende de você">⚓</span>' : '') + '</span><span class="pop-plus" aria-hidden="true">+</span></button>' +
        '<div class="pop-detail" id="pop-d' + i + '" hidden><p><b>' + esc(QUADS[q].nome) + '</b> · ' + esc(QUADS[q].eixo) + (exAnchor(e) ? ' · ⚓ depende de você' : '') + '</p>' +
        '<p><b>Dificuldade:</b> ' + esc(e.d) + '</p><p><b>Dinheiro:</b> ' + esc(e.m) + '</p>' +
        '<p class="pop-src">Fonte: <a class="src" href="#src-' + esc(src.id) + '">' + esc(src.short) + '</a></p></div></li>');
    });
    h.push('</ul><p class="pop-foot">Exemplos citados no vídeo, em posição ilustrativa. ' + (pinned ? 'Esc ou clique fora fecha.' : 'Clique para fixar.') + '</p>');
    return h.join('');
  }
  function showLens(list, pinned) {
    var pop = $('chart-pop'), key = list.map(function (e) { return e.t; }).join('|') + (pinned ? '#p' : '');
    clearTimeout(state.lens.hideT);
    if (state.lens.open && state.lens.key === key) return;            // same set: don't move, don't flicker
    pop.innerHTML = lensHTML(list, pinned);
    state.lens.open = true; state.lens.pinned = !!pinned; state.lens.key = key;
    pop.classList.toggle('pinned', !!pinned);
    pop.setAttribute('aria-hidden', 'false');
    if (narrow()) { pop.classList.add('sheet'); pop.style.left = ''; pop.style.top = ''; }
    else {
      pop.classList.remove('sheet');
      var svg = $('chart-host').querySelector('svg'), g = state.g, wr = $('chart-wrap').getBoundingClientRect();
      var pts = list.map(function (e) { return wrapPoint(svg, pxf(g)(e.x), pyf(g)(e.y)); });
      var maxX = Math.max.apply(null, pts.map(function (p) { return p.x; })), minX = Math.min.apply(null, pts.map(function (p) { return p.x; }));
      var cy = pts.reduce(function (a, p) { return a + p.y; }, 0) / pts.length;
      var pw = pop.offsetWidth || 340, ph = pop.offsetHeight || 240;
      var x = maxX + 18; if (x + pw > wr.width - 4) x = minX - 18 - pw; if (x < 4) x = clamp(maxX - pw / 2, 4, wr.width - pw - 4);
      var y = clamp(cy - ph / 2, 4, Math.max(4, wr.height - ph - 4));
      pop.style.left = Math.round(x) + 'px'; pop.style.top = Math.round(y) + 'px';
    }
    pop.classList.add('on');
    drawExDots(list);
  }
  function hideLens(now) {
    var pop = $('chart-pop'); if (!pop) return;
    clearTimeout(state.lens.hideT);
    var go = function () {
      pop.classList.remove('on'); pop.setAttribute('aria-hidden', 'true');
      state.lens.open = false; state.lens.pinned = false; state.lens.key = '';
      if (!drag.active && !drag.kbd) drawExDots([]);
    };
    if (now) go(); else state.lens.hideT = setTimeout(go, 280);
  }
  function onChartMove(evt) {
    if (onDragMove(evt)) return;
    if (evt.pointerType && evt.pointerType !== 'mouse') return;
    if (state.lens.pinned || drag.kbd) return;
    var ev = { clientX: evt.clientX, clientY: evt.clientY };
    if (state.raf) return;
    state.raf = requestAnimationFrame(function () {
      state.raf = 0;
      if (drag.active || state.lens.pinned) return;
      var d = toData(ev); if (!d) return;
      if (!d.inside) { hideLens(false); return; }
      showLens(nearestExamples(d.x, d.y), false);
    });
  }
  function onChartLeave() { if (!state.lens.pinned && !drag.active) hideLens(false); }
  function onChartClick(evt) {
    if (state.justDragged) return;
    if (evt.target && evt.target.closest && evt.target.closest('.zinfo,.dest-go,#chart-pop,#zone-card')) return;
    var d = toData(evt); if (!d || !d.inside) return;
    state.lens.key = '';
    showLens(nearestExamples(d.x, d.y), true);
  }
  function onPopClick(evt) {
    var btn = evt.target.closest('.pop-item');
    if (!btn) return;
    var det = document.getElementById(btn.getAttribute('aria-controls'));
    var open = btn.getAttribute('aria-expanded') === 'true';
    btn.setAttribute('aria-expanded', open ? 'false' : 'true');
    btn.querySelector('.pop-plus').textContent = open ? '+' : '−';
    if (det) det.hidden = open;
    if (!state.lens.pinned) { state.lens.pinned = true; state.lens.key += '#p'; $('chart-pop').classList.add('pinned'); }
  }

  // ── Corner "i" cards ──────────────────────────────────────────────────────
  function cardHTML(key) {
    var isA = key === 'anchor', c = isA ? ANCHOR : QUADS[key];
    var h = ['<div class="zc-head"><h3 tabindex="-1">' + (isA ? '⚓ ' + esc(ANCHOR.nome) : esc(c.nome) + ' <span class="zc-eixo">· ' + esc(c.eixo) + '</span>') + '</h3><button type="button" class="zc-close" aria-label="Fechar">×</button></div>'];
    h.push('<p class="zc-mean">' + esc(c.resumo) + '</p>');
    if (isA) h.push('<p><b>Quando aparece:</b> ' + esc(ANCHOR.quando) + '</p>');
    else h.push('<p><b>O que pesa:</b> ' + esc(c.dificil) + '</p><p><b>O que dá dinheiro:</b> ' + esc(c.dinheiro) + '</p>');
    h.push('<p><b>Armadilha:</b> ' + esc(c.armadilha) + '</p><p><b>Serve para:</b> ' + esc(c.serve) + '</p>');
    if (isA) h.push('<p><b>Como soltar:</b> ' + esc(ANCHOR.soltar) + '</p>');
    h.push('<p><b>Exemplos:</b> ' + esc(c.exemplos.join(' · ')) + '</p>');
    h.push('<p class="zc-src">Origem: ' + srcChip(c.src) + (isA ? ' — no vídeo, era o "veículo 3" (depende do especialista).' : ' — no vídeo, ' + (c.hv ? 'o veículo ' + c.hv : '') + '.') + '</p>');
    return h.join('');
  }
  function openCard(key, btn) {
    var card = $('zone-card');
    if (state.card.open && state.card.key === key) { closeCard(true); return; }
    if (state.card.btn) state.card.btn.setAttribute('aria-expanded', 'false');
    hideLens(true);
    card.innerHTML = cardHTML(key);
    state.card = { open: true, key: key, btn: btn };
    if (btn) btn.setAttribute('aria-expanded', 'true');
    var wrap = $('chart-wrap'), inWrap = btn && wrap.contains(btn);
    card.classList.remove('sheet');
    if (narrow() || !inWrap) { card.classList.add('sheet'); card.style.left = ''; card.style.top = ''; }
    card.hidden = false;
    if (!card.classList.contains('sheet')) {
      var wr = wrap.getBoundingClientRect(), br = btn.getBoundingClientRect(), cw = card.offsetWidth, ch = card.offsetHeight;
      var bl = br.left - wr.left, bt = br.top - wr.top;
      var leftSide = key === 'arb' || key === 'cai', topSide = key === 'arb' || key === 'fos';
      var x = leftSide ? bl : bl + br.width - cw;
      var y = topSide ? bt + br.height + 6 : bt - ch - 6;
      card.style.left = Math.round(clamp(x, 4, wr.width - cw - 4)) + 'px';
      // A bottom-corner card opens upward; if even at the top of the page it would hide under the
      // sticky header (tall card at an 18 px minimum font), open it downward instead.
      var hb = headerBottom();
      if (!topSide && wr.top + window.pageYOffset + y < hb + 8) y = bt + br.height + 6;
      card.style.top = Math.round(y) + 'px';   // may extend past the board: never cover its own corner
      var cr = card.getBoundingClientRect(), dy = 0;
      if (cr.top < hb + 8) dy = cr.top - hb - 8;
      else if (cr.bottom > window.innerHeight - 8) dy = Math.min(cr.bottom - window.innerHeight + 8, cr.top - hb - 8);
      if (dy) window.scrollBy({ top: dy, behavior: reducedMotion() ? 'auto' : 'smooth' });
    }
    var hd = card.querySelector('h3'); if (hd) hd.focus({ preventScroll: true });
  }
  function closeCard(restore) {
    var card = $('zone-card'); if (!card || !state.card.open) return;
    card.hidden = true; card.innerHTML = '';
    var b = state.card.btn;
    if (b) b.setAttribute('aria-expanded', 'false');
    state.card = { open: false, key: '', btn: null };
    if (restore && b && document.body.contains(b)) { try { b.focus(); } catch (e) {} }
  }


  // ── LLM (OpenRouter BYOK) ─────────────────────────────────────────────────
  function activeKey() {
    var k = window.ApiKeyManager && ApiKeyManager.getActiveKey ? ApiKeyManager.getActiveKey() : null;
    return k && k.key ? k : null;
  }
  // Throws { emptyContent:true } when the model answered with empty content (COR-035).
  function fetchContent(messages, temperature, maxTokens) {
    var key = activeKey();
    if (!key) return Promise.reject(new Error('NO_KEY'));
    var model = (window.ApiKeyManager && ApiKeyManager.getModel) ? ApiKeyManager.getModel() : 'google/gemini-3.8-flash';
    var isDeepSeek = model.indexOf('deepseek/') === 0;
    var body = { model: model, messages: messages, temperature: (temperature == null ? 0.5 : temperature), max_tokens: maxTokens || 8000 };
    if (!isDeepSeek) body.reasoning = { effort: 'low' }; // COR-034/035
    function doFetch() {
      var ctrl = ('AbortController' in window) ? new AbortController() : null;
      var to = ctrl ? setTimeout(function () { ctrl.abort(); }, 180000) : null;
      return fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + key.key, 'Content-Type': 'application/json', 'HTTP-Referer': location.origin, 'X-Title': 'Veiculo IA' },
        body: JSON.stringify(body),
        signal: ctrl ? ctrl.signal : undefined
      }).then(function (r) {
        return r.text().then(function (txt) {
          if (to) clearTimeout(to);
          if (!r.ok) {
            var msg = 'Erro ' + r.status;
            try { var j = JSON.parse(txt); msg = (j.error && (j.error.message || j.error)) || msg; } catch (e) {}
            if (r.status === 401) msg = 'Chave inválida ou sem permissão. Confira sua chave da OpenRouter.';
            else if (r.status === 402) msg = 'Créditos insuficientes na sua conta OpenRouter.';
            else if (r.status === 429) msg = 'Muitas requisições. Aguarde alguns segundos e tente de novo.';
            var e = new Error(String(msg)); e.httpStatus = r.status; throw e;
          }
          var data = JSON.parse(txt);
          var choice = (data.choices && data.choices[0]) || {};
          var content = (choice.message && choice.message.content) || '';
          if (!content || !String(content).trim()) { var em = new Error('Resposta vazia do modelo.'); em.emptyContent = true; throw em; }
          return String(content);
        });
      }, function (err) {
        if (to) clearTimeout(to);
        if (err && err.name === 'AbortError') throw new Error('O modelo demorou demais para responder. Tente de novo ou escolha um modelo mais rápido.');
        throw new Error('Falha de rede ao falar com a OpenRouter. Verifique sua conexão.');
      });
    }
    function run() {
      return doFetch().catch(function (e) {
        if (e && e.emptyContent && body.reasoning) { delete body.reasoning; return doFetch(); } // COR-035 net
        throw e;
      });
    }
    if (window.RateLimiter && RateLimiter.executeWithLimit) return RateLimiter.executeWithLimit('openrouter', run);
    return run();
  }
  function stripToObject(s) {
    s = String(s).replace(/```json/gi, '').replace(/```/g, '').trim();
    var a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a !== -1 && b !== -1 && b > a) s = s.slice(a, b + 1);
    return s;
  }
  function tryParse(s) { try { return JSON.parse(s); } catch (e) { return null; } }
  function parseJSONLadder(raw) {
    var s = stripToObject(raw);
    var o = tryParse(s); if (o) return o;
    var s2 = s.replace(/,\s*([}\]])/g, '$1'); o = tryParse(s2); if (o) return o;
    var s3 = s2.replace(/[\x00-\x1f]+/g, ' '); o = tryParse(s3); if (o) return o;
    var s4 = s3.replace(/[“”]/g, '"').replace(/[‘’]/g, "'"); o = tryParse(s4); if (o) return o;
    return null;
  }
  function callJSON(messages, maxTokens) {
    return fetchContent(messages, 0.5, maxTokens).then(function (txt) {
      var obj = parseJSONLadder(txt);
      if (obj) return obj;
      var strict = messages.concat([{ role: 'user', content: 'Sua resposta anterior NÃO era um JSON válido. Responda novamente APENAS com o objeto JSON pedido, com aspas retas ("), sem markdown, sem comentários, sem texto antes ou depois.' }]);
      return fetchContent(strict, 0.3, maxTokens).then(function (txt2) { // COR-032 reroll
        var obj2 = parseJSONLadder(txt2);
        if (obj2) return obj2;
        throw new Error('O modelo não devolveu um JSON válido. Tente gerar novamente.');
      });
    });
  }



  // ── Prompts ───────────────────────────────────────────────────────────────
  var LANG = 'Escreva SEMPRE em português do Brasil, com acentuação correta, frases claras e diretas, sem jargão em inglês desnecessário.';
  var KB = [
    'BASE DE CONHECIMENTO (use SOMENTE isto — não invente estatísticas, casos ou citações):',
    'Vídeo "How To Make More Money Than You Deserve (My 2027 Framework)" (Alex Hormozi). Tese: ganhar mais do que "merece" depende menos de inteligência e esforço e mais do TIPO de negócio (o veículo). Eixos: quão difícil é operar × quanto dinheiro dá para fazer. História de Buffett: um colega mais inteligente e mais trabalhador foi para o aço e ganhou muito menos — por causa do barco.',
    'ESTA FERRAMENTA usa 4 QUADRANTES (os veículos 1, 2, 4 e 5 do vídeo) e trata o veículo 3 como uma ÂNCORA que pode aparecer em qualquer quadrante:',
    '- Commodities braçais (difícil, pouco dinheiro; veículo 1): barreira de entrada baixa → concorrência feroz, escala limitada, muito arrasto operacional. Restaurante tradicional, academia de serviço, agência para PME, varejo físico, eventos. Mesmo quem tem sucesso ali ganharia mais aplicando as mesmas habilidades num veículo melhor.',
    '- Caixa inicial (fácil, pouco dinheiro; veículo 2): uma pessoa com a habilidade certa chega a renda de top 1%, raramente maior. Dropshipping, serviços leves para casa, vending/ATM, wholesale imobiliário, arbitragem de Airbnb, conteúdo de afiliado. Fácil não é ruim: serve para gerar caixa, aprender e juntar capital.',
    '- Fosso (difícil, muito dinheiro; veículo 4): barreiras de entrada limitam a concorrência — habilidade, capital, regulação, tempo, efeito de rede. IA de verdade, farmacêutica, manufatura especializada, franquias, roll-ups, marketplaces, SaaS, bens de consumo, finanças, bancos, energia/data centers. "Se todo mundo pode fazer, todo mundo vai fazer"; prefira competir com 20 do que com 5 milhões.',
    '- Arbitragem (fácil, muito dinheiro; veículo 5): demanda com vento a favor, oferta restrita ou mudança regulatória; janelas de tempo. Med spas (o dinheiro está nas pessoas mais velhas), assessoria de patrimônio, GLP-1, Botox, cuidado de idosos, cobrança, gestão de resíduos, sindicalização imobiliária, limpeza comercial, manutenção de elevadores. Desconto do "parece legal": o que não soa bem num coquetel tem menos concorrência.',
    '- ÂNCORA "depende de você" (o veículo 3 do vídeo: coaching, implementação de IA, cirurgiões, agências, influenciadores): o negócio gera renda, mas vale pouco na venda porque depende do fundador — um "emprego turbinado" (lógica de Built to Sell). A ferramenta liga a âncora quando a nota de independência do fundador é 4 ou menos, em QUALQUER quadrante.',
    'Fechamento: escolha o veículo pelo objetivo — fluxo de caixa, renda alta, valor de empresa (escalável, transferível e defensável) ou bilhões (mercado enorme + fosso). Escolha o barco, depois reme o mais forte possível.',
    'Teste do bilionário: "como é isso quando está no máximo? Quem é o bilionário disso?" — se ninguém escalou ao máximo, desconfie.'
  ].join('\n');
  var CALIB = [
    'CALIBRAÇÃO (use estas âncoras para manter as notas consistentes; ordem trabalho,habilidade,capital,regulacao,operacao,tempo | teto,margem,escala,fosso,ventos,recorrencia,transferivel,concorrencia | parece_legal):',
    'restaurante tradicional: 9,5,6,5,9,4 | 4,2,2,2,3,4,4,9 | 7',
    'dropshipping: 3,3,2,1,3,1 | 4,3,6,1,3,1,5,9 | 6',
    'coaching online: 6,7,2,1,4,4 | 6,9,4,3,5,5,2,8 | 7',
    'SaaS B2B: 4,8,7,3,6,7 | 9,9,9,6,6,9,8,7 | 8',
    'med spa para público 50+: 5,4,4,4,5,3 | 7,8,5,4,9,7,6,5 | 4',
    'Independência do fundador (transferivel): 4 ou menos quando o negócio não funciona nem se vende sem a pessoa; 7 ou mais quando há processos, equipe e contratos que andam sozinhos.'
  ].join('\n');
  var SRC_LIST = SOURCES.map(function (s) { return '- ' + s.id + ': ' + s.title + ' — sustenta: ' + s.supports; }).join('\n');
  var RUBRIC_DEFS = RUBRIC.map(function (r) { return '- ' + r.k + ' (' + r.label + '): ' + r.hint; }).join('\n');
  function posText(e) {
    return 'dificuldade ' + e.x + '/100, dinheiro ' + e.y + '/100 → quadrante ' + QUADS[e.q].nome + ' (' + QUADS[e.q].eixo + ')' +
      (e.anchor ? '; ÂNCORA ligada (independência do fundador ' + e.rubric.transferivel.nota + '/10: depende de você)' : '; sem âncora') +
      (boundary(e.x, e.y) ? '; ' + boundary(e.x, e.y) : '');
  }

  function rubricMessages(ideia, contexto) {
    var sys = [
      'Você é um analista que aplica o framework "Índice do Idiota". Sua tarefa agora é SÓ pontuar uma rúbrica fixa — a posição na carta será calculada por uma fórmula, não por você.',
      KB,
      'RÚBRICA (nota inteira 0–10 para cada critério, com "porque" de no máximo 22 palavras, específico para a ideia):\n' + RUBRIC_DEFS,
      'Também: "parece_legal" (0–10): quão "legal/glamoroso" o negócio soa num coquetel (10 = todo mundo quer fazer; 0 = ninguém quer dizer que faz).',
      CALIB,
      'Seja honesto e cético: não infle notas de dinheiro por entusiasmo. Considere o contexto do Brasil quando a ideia for local.',
      LANG,
      'Responda APENAS com um objeto JSON neste formato exato (sem markdown):',
      '{"titulo":"nome curto da ideia (máx. 6 palavras)","resumo":"a ideia reescrita em 1 frase","rubrica":{"trabalho":{"nota":0,"porque":""},"habilidade":{...},"capital":{...},"regulacao":{...},"operacao":{...},"tempo":{...},"teto":{...},"margem":{...},"escala":{...},"fosso":{...},"ventos":{...},"recorrencia":{...},"transferivel":{...},"concorrencia":{...}},"parece_legal":{"nota":0,"porque":""},"parecidos":["até 3 exemplos do vídeo mais parecidos com a ideia"],"bilionario":{"veredito":"sim | raro | nao","exemplo":"empresa/pessoa real que escalou isso ao máximo, ou vazio se não houver","comentario":"1 frase"}}'
    ].join('\n\n');
    var user = 'IDEIA DE NEGÓCIO:\n' + ideia + (contexto ? '\n\nCONTEXTO DO EMPREENDEDOR:\n' + contexto : '');
    return [{ role: 'system', content: sys }, { role: 'user', content: user }];
  }

  function reportMessages(cur) {
    var rubTxt = RUBRIC.map(function (r) { return '- ' + r.k + ' = ' + cur.rubric[r.k].nota + (r.inverse ? ' (conta contra)' : '') + ': ' + cur.rubric[r.k].porque; }).join('\n');
    var sys = [
      'Você é um conselheiro de negócios que aplica o framework "Índice do Idiota" e SOMENTE as fontes listadas. Nunca invente números, estudos, casos ou citações; se algo não está nas fontes, fale como raciocínio, não como fato.',
      KB,
      'FONTES PERMITIDAS (cada item do relatório deve citar UMA delas pelo id):\n' + SRC_LIST,
      'PIVÔS: proponha exatamente 3 maneiras concretas de "subir na carta" para ESTA ideia (ex.: mudar para um público mais velho e com dinheiro; roll-up; franquear; criar recorrência; aproveitar uma janela regulatória; ir para o lado "sem glamour" do mercado; soltar a âncora tirando a dependência do fundador; construir um fosso). Para cada pivô dê "deltas": variações inteiras de -4 a +4 nas notas da rúbrica (só chaves: ' + RKEYS.join(', ') + '). Seja realista. NÃO escreva nome de quadrante nem número de veículo no nome ou na descrição do pivô — a ferramenta recalcula e mostra o destino.',
      LANG,
      'Responda APENAS com um objeto JSON neste formato exato (sem markdown):',
      '{"diagnostico":"3 a 4 frases: por que a ideia caiu neste quadrante (e na âncora, se ligada) e o que isso significa","por_que":[{"texto":"","fonte":"id"}],"riscos":[{"texto":"","fonte":"id"}],"encaixe":{"texto":"2 frases sobre o encaixe entre a posição e o objetivo declarado","fonte":"id"},"proximos_passos":[{"texto":"ação concreta para os próximos 30 dias","fonte":"id"}],"pivos":[{"nome":"","tipo":"","descricao":"2 frases","deltas":{"chave":0},"fonte":"id"}],"frase_final":"1 frase de fechamento no espírito de escolher o barco e remar forte"}',
      'Quantidades: por_que 2–4 itens; riscos 2–3; proximos_passos 3–5; pivos exatamente 3.'
    ].join('\n\n');
    var user = [
      'IDEIA: ' + cur.ideia,
      cur.contexto ? 'CONTEXTO: ' + cur.contexto : '',
      'OBJETIVO DECLARADO: ' + GOALS[cur.goal].label + ' (encaixe calculado pela ferramenta: ' + cur.fit + ')',
      'POSIÇÃO CALCULADA PELA FERRAMENTA: ' + posText(cur) + '. NÃO conteste a posição; explique-a.',
      'RÚBRICA PONTUADA:\n' + rubTxt,
      'Desconto do "parece legal": nota ' + cur.legal.nota + ' (' + cur.legal.porque + ') → ajuste de ' + cur.legalAdj + ' no eixo do dinheiro.',
      'Teste do bilionário: ' + cur.bil.veredito + (cur.bil.exemplo ? ' — ' + cur.bil.exemplo : '') + '. ' + cur.bil.comentario
    ].filter(Boolean).join('\n\n');
    return [{ role: 'system', content: sys }, { role: 'user', content: user }];
  }

  // What KIND of business lives at the destination, in words, plus the video's example businesses
  // nearest to that point. Deliberately no formula and no target averages: with numbers the model
  // back-solves the scores to land on the point, and "chega perto" stops meaning anything (COR-071).
  function targetProfile(t) {
    var dx = t.x <= 35 ? 'fáceis de operar (pouca mão de obra, habilidade comum, pouco capital, pouca regulação, operação simples, resultado rápido)'
      : t.x >= 65 ? 'difíceis de operar (habilidade rara, capital, licenças, operação pesada ou anos para maturar, que afastam os concorrentes)'
      : 'de dificuldade média (alguma habilidade, capital ou operação, mas nada que leve anos)';
    var dy = t.y >= 65 ? 'que dão muito dinheiro (mercado grande, margem alta, crescem sem crescer a equipe na mesma proporção, com fosso ou vento a favor, cliente recorrente, funcionam sem o dono)'
      : t.y <= 35 ? 'que dão pouco dinheiro (teto baixo, margem apertada ou muita concorrência)'
      : 'que dão dinheiro médio (boa margem ou bom mercado, mas não os dois com folga)';
    var near = EXAMPLES.map(function (e) { return { e: e, d: Math.hypot(e.x - t.x, e.y - t.y) }; }).sort(function (a, b) { return a.d - b.d; }).slice(0, 3).map(function (o) { return o.e.t; });
    return [
      'O QUE EXISTE NESSE DESTINO: negócios ' + dx + ' e ' + dy + '. Só como referência do perfil, não para copiar: ' + near.join(', ') + ' ficam perto desse ponto no vídeo. Procure negócios com esse perfil que reaproveitem as competências e o histórico da pessoa.',
      'Pontue cada sugestão com honestidade, como se fosse avaliá-la do zero, sem mirar números: a posição sai da conta da ferramenta, e uma nota inflada para "chegar" engana a pessoa.'
    ].join('\n');
  }
  function sugMessages(cur, t, comp, hist, obj) {
    var rubNotes = RKEYS.map(function (k) { return k + '=' + cur.rubric[k].nota; }).join(', ');
    var tq = quad(t.x, t.y);
    var sys = [
      'Você sugere negócios PARECIDOS com a ideia de uma pessoa, usando o framework "Índice do Idiota". A ferramenta calcula a posição de cada sugestão com uma fórmula fixa a partir das notas que você der — e mede a distância até o destino pelo número calculado, não pela sua opinião. Então pontue com honestidade.',
      KB,
      'RÚBRICA (as MESMAS 14 notas inteiras 0–10 da avaliação):\n' + RUBRIC_DEFS,
      'Também "parece_legal" (0–10).',
      CALIB,
      'FONTES PERMITIDAS (cite UMA por sugestão, pelo id):\n' + SOURCE_IDS.join(', '),
      'REGRAS: sugira exatamente 5 negócios reais e concretos no Brasil. Cada um deve reaproveitar as competências e o histórico da pessoa (diga qual) e servir aos objetivos dela (diga como). Eles devem tender a cair PERTO DO DESTINO, mas NÃO force: se um parecido não chega lá, as notas devem mostrar isso. Não escreva nome de quadrante nem número de veículo nos textos.',
      LANG,
      'Responda APENAS com um objeto JSON neste formato exato (sem markdown):',
      '{"sugestoes":[{"nome":"até 6 palavras","descricao":"1 a 2 frases: o que vende e para quem","porque_parecido":"1 frase: qual competência ou parte do histórico reaproveita","como_serve":"1 frase: como serve aos objetivos","rubrica":{"trabalho":0,"habilidade":0,"capital":0,"regulacao":0,"operacao":0,"tempo":0,"teto":0,"margem":0,"escala":0,"fosso":0,"ventos":0,"recorrencia":0,"transferivel":0,"concorrencia":0},"parece_legal":0,"fonte":"id"}]}'
    ].join('\n\n');
    var user = [
      'IDEIA ATUAL: ' + cur.ideia,
      cur.contexto ? 'CONTEXTO: ' + cur.contexto : '',
      'POSIÇÃO ATUAL (calculada): ' + posText(cur) + '.',
      'NOTAS ATUAIS: ' + rubNotes + '; parece_legal=' + cur.legal.nota,
      'DESTINO escolhido na carta: dificuldade ' + t.x + '/100, dinheiro ' + t.y + '/100 → ' + QUADS[tq].nome + ' (' + QUADS[tq].eixo + '). Mudança desejada: ' + signed(t.y - cur.y) + ' dinheiro, ' + signed(t.x - cur.x) + ' dificuldade.',
      targetProfile(t),
      'COMPETÊNCIAS: ' + (comp || 'não informado'),
      'HISTÓRICO: ' + (hist || 'não informado'),
      'OBJETIVOS: ' + (obj || GOALS[cur.goal].obj)
    ].filter(Boolean).join('\n\n');
    return [{ role: 'system', content: sys }, { role: 'user', content: user }];
  }

  // ── Normalize model output ────────────────────────────────────────────────
  function normItems(arr, max) {
    if (!Array.isArray(arr)) return [];
    return arr.map(function (it) {
      if (typeof it === 'string') return { texto: clean(it), fonte: 'hormozi_video' };
      var f = clean(it && it.fonte);
      return { texto: clean(it && it.texto), fonte: SOURCE_IDS.indexOf(f) !== -1 ? f : 'hormozi_video' };
    }).filter(function (i) { return i.texto; }).slice(0, max);
  }
  function stripVehicleNo(s) { return String(s || '').replace(/\s*[\(\[]\s*(ve[íi]culo\s*\d|quadrante)[^\)\]]*[\)\]]/ig, '').trim(); }
  function normReport(rep, cur) {
    var r = {
      diagnostico: clean(rep.diagnostico),
      por_que: normItems(rep.por_que, 4),
      riscos: normItems(rep.riscos, 3),
      encaixe: normItems([rep.encaixe || {}], 1)[0] || { texto: '', fonte: 'hormozi_video' },
      passos: normItems(rep.proximos_passos, 5),
      frase: clean(rep.frase_final)
    };
    var piv = Array.isArray(rep.pivos) ? rep.pivos.slice(0, 3) : [];
    cur.pivots = piv.map(function (p) {
      var deltas = {};
      if (p && p.deltas && typeof p.deltas === 'object') {
        Object.keys(p.deltas).forEach(function (k) { if (RKEYS.indexOf(k) !== -1) deltas[k] = clamp(Math.round(num(p.deltas[k], 0)), -4, 4); });
      }
      var r2 = applyDeltas(cur.rubric, deltas), pos = position(r2, cur.legal.nota), f = clean(p && p.fonte);
      return { nome: stripVehicleNo(clean(p && p.nome)) || 'Pivô', tipo: clean(p && p.tipo), descricao: stripVehicleNo(clean(p && p.descricao)), deltas: deltas, x: pos.x, y: pos.y, q: quad(pos.x, pos.y), anchor: anchorOf(r2), fonte: SOURCE_IDS.indexOf(f) !== -1 ? f : 'hormozi_video' };
    });
    return r;
  }
  function normSugs(j, cur, t) {
    var arr = j && Array.isArray(j.sugestoes) ? j.sugestoes : (Array.isArray(j) ? j : []);
    var out = arr.slice(0, 5).map(function (s) {
      if (!s || typeof s !== 'object' || !s.rubrica) return null;
      var rub = normRubric(s.rubrica);
      var lg = clamp(Math.round(num(s.parece_legal && typeof s.parece_legal === 'object' ? s.parece_legal.nota : s.parece_legal, 5)), 0, 10);
      var pos = position(rub, lg), f = clean(s.fonte);
      var dist = Math.round(Math.hypot(pos.x - t.x, pos.y - t.y));
      return {
        nome: stripVehicleNo(clean(s.nome)) || 'Negócio sugerido', descricao: stripVehicleNo(clean(s.descricao)),
        porque: stripVehicleNo(clean(s.porque_parecido)), serve: stripVehicleNo(clean(s.como_serve)),
        rubric: rub, legal: lg, legalAdj: pos.legalAdj, x: pos.x, y: pos.y, q: quad(pos.x, pos.y), anchor: anchorOf(rub),
        dx: pos.x - cur.x, dy: pos.y - cur.y, dist: dist, perto: dist <= NEAR,
        fonte: SOURCE_IDS.indexOf(f) !== -1 ? f : 'hormozi_video'
      };
    }).filter(Boolean);
    out.sort(function (a, b) { return a.dist - b.dist; });
    return out;
  }

  // ── Report rendering ──────────────────────────────────────────────────────
  function srcChip(id) { var s = sourceById(id); return '<a class="src" href="#src-' + esc(s.id) + '" title="' + esc(s.title) + '">' + esc(s.short) + '</a>'; }
  function listHTML(items, cls) {
    if (!items.length) return '<p class="hint">—</p>';
    return '<ul class="insight-list ' + (cls || '') + '">' + items.map(function (i) { return '<li>' + esc(i.texto) + ' ' + srcChip(i.fonte) + '</li>'; }).join('') + '</ul>';
  }
  function section(title, body, open) { return '<details class="rsec"' + (open ? ' open' : '') + '><summary>' + esc(title) + '</summary><div class="rsec-body">' + body + '</div></details>'; }
  function rubricTable(cur) {
    var h = ['<div class="rubric-wrap"><table class="rubric"><thead><tr><th>Critério</th><th>Nota</th><th>Por quê</th></tr></thead><tbody>'];
    h.push('<tr class="axis-row"><td colspan="3">Dificuldade → ' + cur.x + ' / 100</td></tr>');
    RUBRIC.forEach(function (r, idx) {
      if (idx === 6) h.push('<tr class="axis-row"><td colspan="3">Dinheiro → ' + cur.y + ' / 100</td></tr>');
      var n = cur.rubric[r.k].nota;
      h.push('<tr><td>' + esc(r.label) + (r.inverse ? ' <span class="hint">(conta contra)</span>' : '') + (r.k === 'transferivel' && n <= ANCHOR_MAX ? ' <span class="hint">⚓ âncora</span>' : '') + '</td><td class="score">' + n + '/10</td><td class="why">' + (esc(cur.rubric[r.k].porque) || '—') + '</td></tr>');
    });
    h.push('<tr><td>Desconto do "parece legal"</td><td class="score">' + cur.legal.nota + '/10 → ' + (cur.legalAdj > 0 ? '+' : '') + cur.legalAdj + '</td><td class="why">' + (esc(cur.legal.porque) || '—') + '</td></tr>');
    h.push('</tbody></table></div>');
    return h.join('');
  }
  function anchorLine() { return '<p class="anchor-line"><span class="anc-ico" aria-hidden="true">⚓</span> <b>' + esc(ANCHOR.nome) + '</b> — ' + esc(ANCHOR.linha) + '. <button type="button" class="zinfo zinfo-inline" data-q="anchor" aria-expanded="false" aria-controls="zone-card" aria-label="O que é a âncora?">i</button></p>'; }
  function headerHTML(cur) {
    var qd = QUADS[cur.q], bnd = boundary(cur.x, cur.y);
    return '<h3 class="rep-title">' + esc(cur.titulo) + '</h3>' +
      '<dl class="fix-strip"><div><dt>Dificuldade</dt><dd>' + cur.x + '/100</dd></div><div><dt>Dinheiro</dt><dd>' + cur.y + '/100</dd></div>' +
      '<div><dt>Quadrante</dt><dd class="v">' + esc(qd.nome) + (cur.anchor ? ' ⚓' : '') + '</dd></div><div><dt>Objetivo</dt><dd>' + esc(GOALS[cur.goal] ? GOALS[cur.goal].label : '—') + '</dd></div></dl>' +
      '<div class="vehicle-plate"><div><p class="vname">' + esc(qd.nome) + ' <span class="hint">· ' + esc(qd.eixo) + '</span></p><p class="vdesc">' + esc(qd.resumo) + '</p></div></div>' +
      (cur.anchor ? anchorLine() : '') +
      (bnd ? '<p class="edge-line">Fica ' + esc(bnd) + ': leia as duas zonas, a posição exata depende de poucas notas.</p>' : '');
  }
  function renderReport() {
    var cur = state.cur, body = $('report-body');
    if (!cur) { body.innerHTML = ''; return; }
    var h = [headerHTML(cur)];
    if (cur.kind === 'sugestao') {
      h.push('<div class="callout"><b>Sugestão salva.</b> Ela ainda não tem o diagnóstico completo. <button type="button" class="btn-secondary" id="sug-full-btn">Avaliar a fundo</button></div>');
      h.push(section('A rúbrica (notas da IA, posição pela régua da ferramenta)', rubricTable(cur), false));
      body.innerHTML = h.join('');
      var fb = $('sug-full-btn'); if (fb) fb.addEventListener('click', function () { evaluateIdea(cur.ideia); });
      return;
    }
    var rep = cur.report;
    if (rep && (!cur.ver || cur.ver < 3)) h.push('<p class="edge-line">Este diagnóstico foi escrito na versão anterior da carta (com 5 veículos). Clique em <b>Posicionar na carta</b> para refazer com os 4 quadrantes e a âncora.</p>');
    if (rep && rep.diagnostico) h.push('<p class="diag">' + esc(rep.diagnostico) + '</p>');
    var bil = cur.bil || { veredito: 'raro', exemplo: '', comentario: '' };
    var bilTxt = bil.veredito === 'sim' ? 'Sim, existe quem escalou isso ao máximo' : (bil.veredito === 'raro' ? 'Raro: há poucos exemplos' : (bil.exemplo ? 'Não neste formato; quem chegou lá fez outro negócio' : 'Não: ninguém escalou isso a bilhões'));
    h.push('<div class="callout"><b>Quem é o bilionário disso?</b> ' + esc(bilTxt) + (bil.exemplo ? ': <b>' + esc(bil.exemplo) + '</b>' : '') + '. ' + esc(bil.comentario) + ' ' + srcChip('hormozi_video') + '</div>');
    var fitLabel = { bom: 'encaixe bom', parcial: 'encaixe parcial', ruim: 'encaixe ruim' }[cur.fit];
    h.push('<p class="fit-line"><b>Seu objetivo — ' + esc(GOALS[cur.goal].label) + '</b> <span class="fit-badge fit-' + cur.fit + '">' + fitLabel + '</span>' + (rep && rep.encaixe && rep.encaixe.texto ? '<br>' + esc(rep.encaixe.texto) + ' ' + srcChip(rep.encaixe.fonte) : '') + '</p>');
    if (rep) {
      h.push(section('Próximos passos (30 dias)', listHTML(rep.passos, 'steps'), true));
      if (cur.pivots && cur.pivots.length) {
        var pv = ['<div class="pivots">'];
        cur.pivots.forEach(function (p, i) {
          pv.push('<div class="pivot"><span class="ptag">' + (i + 1) + (p.tipo ? ' · ' + esc(p.tipo.replace(/[_-]+/g, ' ')) : '') + '</span><h5>' + esc(p.nome) + '</h5><p>' + esc(p.descricao) + '</p>' +
            '<p class="pmove">' + signed(p.y - cur.y) + ' dinheiro · ' + signed(p.x - cur.x) + ' dificuldade · ' + esc(QUADS[cur.q].nome) + ' → <b>' + esc(QUADS[p.q].nome) + '</b>' + (p.anchor ? ' ⚓' : '') + ' ' + srcChip(p.fonte) + '</p></div>');
        });
        pv.push('</div>');
        h.push(section('Rotas de pivô (os números na carta)', pv.join(''), true));
      }
      h.push(section('Por que este quadrante', listHTML(rep.por_que), false));
      h.push(section('Riscos do barco', listHTML(rep.riscos, 'risk'), false));
      if (cur.parecidos && cur.parecidos.length) h.push('<p class="hint">Parecida com: ' + esc(cur.parecidos.join(' · ')) + '</p>');
    }
    h.push(section('A rúbrica completa (notas da IA, posição pela régua da ferramenta)', rubricTable(cur), false));
    if (rep && rep.frase) h.push('<p class="closing">' + esc(rep.frase) + '</p>');
    h.push('<p class="disclaimer">Modelo: ' + esc(cur.model || '') + ' · ' + esc(new Date(cur.ts).toLocaleString('pt-BR')) + '. Estimativa educacional — não é recomendação de investimento.</p>');
    body.innerHTML = h.join('');
  }

  function renderRumo() {
    var cur = state.cur, sm = $('dest-summary'), chips = $('dir-buttons'); if (!sm) return;
    if (!cur) { sm.textContent = ''; chips.innerHTML = ''; return; }
    if (cur.target) {
      var b = boundary(cur.target.x, cur.target.y);
      sm.innerHTML = '<b>Destino:</b> ' + esc(destText(cur)) + (b ? ' <span class="hint">(' + esc(b) + ')</span>' : '');
    } else sm.textContent = 'Arraste na carta (ou o barco) até onde você quer chegar.';
    chips.innerHTML = '<span class="chips-lead">ou escolha um rumo:</span>' + Object.keys(CHIPS).map(function (k) {
      var at = CHIPS[k].at(cur);
      if (Math.hypot(at[0] - cur.x, at[1] - cur.y) < 5) return '';
      return '<button type="button" class="dir-btn" data-dir="' + k + '">' + esc(CHIPS[k].label) + '</button>';
    }).join('');
    $('sug-btn').disabled = !cur.target || state.sugBusy;
    prefillObj();
    renderSugs();
  }
  function renderSugs() {
    var cur = state.cur, list = $('sug-list'); if (!list) return;
    if (!cur || !cur.sugs || !cur.sugs.length) { list.innerHTML = ''; return; }
    var t = cur.sugTarget || cur.target;
    list.innerHTML = '<p class="sug-head">Para chegar em <b>' + esc(QUADS[quad(t.x, t.y)].nome) + '</b> (dificuldade ' + t.x + ', dinheiro ' + t.y + ') · ordenado pela distância calculada. A posição vem de uma rúbrica rápida; "Avaliar a fundo" refaz a avaliação completa e ela pode mudar.</p>' + cur.sugs.map(function (s, i) {
      return '<article class="sug-card ' + (s.perto ? 'vai' : 'nao') + '">' +
        '<header><span class="sug-num">' + (i + 1) + '</span><h5>' + esc(s.nome) + '</h5><span class="badge ' + (s.perto ? 'b-vai' : 'b-nao') + '">' + (s.perto ? 'chega perto' : 'fica longe') + '</span></header>' +
        '<p class="sug-move">a ' + s.dist + ' pontos do destino · ' + signed(s.dy) + ' dinheiro · ' + signed(s.dx) + ' dificuldade · ' + esc(QUADS[s.q].nome) + (s.anchor ? ' · ⚓ depende de você' : '') + '</p>' +
        (s.descricao ? '<p>' + esc(s.descricao) + '</p>' : '') +
        (s.porque ? '<p><b>Por que é parecido:</b> ' + esc(s.porque) + '</p>' : '') +
        (s.serve ? '<p><b>Como serve aos seus objetivos:</b> ' + esc(s.serve) + ' ' + srcChip(s.fonte) + '</p>' : '') +
        '<div class="sug-actions"><button type="button" class="btn-primary sug-eval" data-i="' + i + '">Avaliar a fundo</button><button type="button" class="btn-secondary sug-save" data-i="' + i + '">Salvar no histórico</button></div>' +
        '</article>';
    }).join('');
  }
  function renderOrigins() {
    $('origins-list').innerHTML = SOURCES.map(function (s) {
      return '<li id="src-' + esc(s.id) + '"><span class="oid">' + esc(s.short) + '</span><br><b>' + esc(s.title) + '</b><br>' + esc(s.supports) +
        '<span class="ohonest">Honestidade: ' + esc(s.honest) + '</span>' +
        (s.url ? '<a href="' + esc(s.url) + '" target="_blank" rel="noopener noreferrer">Ver fonte</a>' : '') + '</li>';
    }).join('');
  }

  // ── UI state ──────────────────────────────────────────────────────────────
  function showState(which, msg) {
    $('loading-state').hidden = which !== 'loading';
    $('error-state').hidden = which !== 'error';
    if (which === 'error') $('error-text').textContent = msg || 'Algo deu errado.';
    var has = !!state.cur && which !== 'loading';
    $('result').hidden = !has;
    $('stage-head').hidden = !has;
    if (has) $('tb-title').textContent = state.cur.titulo;
  }
  function setBusy(b) {
    state.busy = b;
    var btn = $('generate-btn');
    btn.disabled = b; btn.classList.toggle('is-busy', b);
  }
  function setTab(t) {
    if (['diag', 'rumo', 'export'].indexOf(t) === -1) t = 'diag';
    state.tab = t;
    if (t !== 'export') state.chartMode = t;
    document.querySelectorAll('#result-tabs [role="tab"]').forEach(function (b) {
      var on = b.getAttribute('data-tab') === t;
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
    });
    $('panel-diag').hidden = t !== 'diag';
    $('panel-rumo').hidden = t !== 'rumo';
    $('panel-export').hidden = t !== 'export';
    closeCard(false);
    renderChart();
    if (t === 'rumo') renderRumo();
  }

  // ── Generate (full assessment) ────────────────────────────────────────────
  function generate() {
    if (state.busy) return;
    var ideia = ($('in-ideia').value || '').trim();
    var contexto = ($('in-contexto').value || '').trim();
    if (ideia.length < 12) { toast('Descreva a ideia com um pouco mais de detalhe.'); $('in-ideia').focus(); return; }
    if (!activeKey()) { toast('Conecte sua chave da OpenRouter (ícone da chave, no topo).'); var mk = $('manage-keys-btn'); if (mk) mk.click(); return; }
    stopMic();
    setBusy(true);
    hideLens(true); closeCard(false);
    $('loading-title').textContent = 'Tirando as sondagens…';
    $('loading-sub').textContent = 'A IA está pontuando os 14 critérios da rúbrica.';
    var prev = state.cur;
    state.cur = null;
    renderChart();
    showState('loading');
    var goal = state.goal;
    var model = ApiKeyManager.getModel ? ApiKeyManager.getModel() : '';
    callJSON(rubricMessages(ideia, contexto), 6000).then(function (j) {
      if (!j || typeof j !== 'object' || !j.rubrica) throw new Error('O modelo não devolveu a rúbrica completa. Tente gerar novamente.');
      var rub = normRubric(j.rubrica);
      var legalRaw = j.parece_legal;
      var legal = { nota: clamp(Math.round(num(legalRaw && typeof legalRaw === 'object' ? legalRaw.nota : legalRaw, 5)), 0, 10), porque: clean(legalRaw && legalRaw.porque) };
      var pos = position(rub, legal.nota);
      var b = j.bilionario || {};
      var ver = String(clean(b.veredito) || 'raro').toLowerCase().replace('ã', 'a');
      if (['sim', 'raro', 'nao'].indexOf(ver) === -1) ver = 'raro';
      var cur = normalizeEntry({
        id: 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        ver: 3, ts: Date.now(), model: model, ideia: ideia, contexto: contexto, goal: goal,
        titulo: clean(j.titulo) || ideia.slice(0, 40), resumo: clean(j.resumo),
        rubric: rub, legal: legal, legalAdj: pos.legalAdj, x: pos.x, y: pos.y,
        parecidos: (Array.isArray(j.parecidos) ? j.parecidos.map(clean).filter(Boolean).slice(0, 3) : []),
        bil: { veredito: ver, exemplo: clean(b.exemplo), comentario: clean(b.comentario) },
        pivots: [], report: null, sugs: [], target: null, sugTarget: null
      });
      state.cur = cur;
      state.tab = 'diag'; state.chartMode = 'diag';
      renderChart();
      $('loading-title').textContent = QUADS[cur.q].nome + (cur.anchor ? ' ⚓' : '') + '. Traçando as rotas…';
      $('loading-sub').textContent = 'A IA está escrevendo o diagnóstico e os pivôs com base nas fontes.';
      return callJSON(reportMessages(cur), 9000).then(function (rep) {
        cur.report = normReport(rep || {}, cur);
        lsSet(CURRENT_SLOT, cur);
        renderReport(); showState('done'); setTab('diag');
        toast('Carta pronta — ' + QUADS[cur.q].nome + (cur.anchor ? ', com âncora' : '') + '.');
      }, function (e) {
        lsSet(CURRENT_SLOT, cur);
        renderReport(); showState('error', 'A posição foi calculada, mas o diagnóstico falhou: ' + (e && e.message ? e.message : 'erro desconhecido') + ' Clique em "Tentar de novo".');
        $('result').hidden = false; $('stage-head').hidden = false; setTab('diag');
      });
    }).catch(function (e) {
      state.cur = prev;
      var msg = e && e.message === 'NO_KEY' ? 'Conecte sua chave da OpenRouter para gerar.' : (e && e.message) || 'Erro ao gerar.';
      showState('error', msg);
      renderChart();
    }).then(function () { setBusy(false); placeHandle(); });
  }
  function evaluateIdea(text) {
    $('in-ideia').value = String(text || '').slice(0, 2500); updateCount();
    var c = [($('in-contexto').value || '').trim(), ($('in-comp') && $('in-comp').value.trim()) ? 'Competências: ' + $('in-comp').value.trim() : '', ($('in-hist') && $('in-hist').value.trim()) ? 'Histórico: ' + $('in-hist').value.trim() : ''].filter(Boolean);
    var seen = {}; c = c.filter(function (x) { if (seen[x]) return false; seen[x] = 1; return true; });
    $('in-contexto').value = c.join(' · ').slice(0, 400);
    window.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' });
    generate();
  }

  // ── Suggestions toward the destination ────────────────────────────────────
  function prefillObj() {
    var el = $('in-obj'); if (!el) return;
    if (state.objAuto || !el.value.trim()) { el.value = GOALS[state.goal] ? GOALS[state.goal].obj : ''; state.objAuto = true; }
  }
  function suggest() {
    var cur = state.cur;
    if (!cur || state.sugBusy) return;
    if (!cur.target) { toast('Arraste na carta até onde você quer chegar (ou use um rumo).'); return; }
    if (!activeKey()) { toast('Conecte sua chave da OpenRouter (ícone da chave, no topo).'); return; }
    stopMic();
    if (state.tab !== 'rumo') setTab('rumo');
    var t = { x: cur.target.x, y: cur.target.y };
    var comp = ($('in-comp').value || '').trim(), hist = ($('in-hist').value || '').trim(), obj = ($('in-obj').value || '').trim();
    state.sugBusy = true;
    var btn = $('sug-btn'); btn.disabled = true; btn.classList.add('is-busy');
    $('dest-go').hidden = true;
    $('sug-status').textContent = 'Procurando negócios parecidos que cheguem perto de ' + QUADS[quad(t.x, t.y)].nome + '…';
    callJSON(sugMessages(cur, t, comp, hist, obj), 7000).then(function (j) {
      var list = normSugs(j, cur, t);
      if (!list.length) throw new Error('O modelo não devolveu sugestões válidas.');
      cur.sugs = list; cur.sugTarget = t;
      lsSet(CURRENT_SLOT, cur);
      renderChart(); renderRumo();
      var perto = list.filter(function (s) { return s.perto; }).length;
      $('sug-status').textContent = perto + ' de ' + list.length + ' chegam perto do destino (até ' + NEAR + ' pontos), pela régua da ferramenta. Arraste o destino e peça de novo quando quiser.';
    }).catch(function (e) {
      var msg = e && e.message === 'NO_KEY' ? 'Conecte sua chave da OpenRouter.' : (e && e.message) || 'Erro ao sugerir.';
      $('sug-status').textContent = 'Não deu para sugerir agora: ' + msg + ' Tente de novo.';
    }).then(function () { state.sugBusy = false; btn.classList.remove('is-busy'); btn.disabled = !state.cur || !state.cur.target; placeDestGo(); });
  }
  function onSugClick(e) {
    var ev = e.target.closest('.sug-eval'), sv = e.target.closest('.sug-save');
    var cur = state.cur; if (!cur || !cur.sugs) return;
    if (ev) {
      var s = cur.sugs[parseInt(ev.getAttribute('data-i'), 10)]; if (!s) return;
      evaluateIdea(s.nome + ': ' + s.descricao);
    } else if (sv) {
      var s2 = cur.sugs[parseInt(sv.getAttribute('data-i'), 10)]; if (!s2) return;
      pushHistory(normalizeEntry({
        id: 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), kind: 'sugestao', ts: Date.now(), model: cur.model,
        ideia: s2.nome + ': ' + s2.descricao, contexto: cur.contexto, goal: cur.goal, titulo: s2.nome, resumo: s2.descricao,
        rubric: s2.rubric, legal: { nota: s2.legal, porque: '' }, legalAdj: s2.legalAdj, x: s2.x, y: s2.y,
        parecidos: [], bil: null, pivots: [], report: null, sugs: [], target: null, sugTarget: null, origem: cur.titulo
      }));
    }
  }

  // ── Voice dictation (Web Speech API, pt-BR) — one field at a time ────────
  function setupMics() {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    document.querySelectorAll('.btn-mic').forEach(function (btn) {
      var field = $(btn.getAttribute('data-target')), st = $(btn.getAttribute('data-status'));
      if (!field) return;
      if (!SR) {
        btn.disabled = true; btn.title = 'Ditado por voz não disponível neste navegador';
        if (st && btn.getAttribute('data-target') === 'in-ideia') st.textContent = 'Ditado indisponível aqui — use Chrome, Edge ou Safari.';
        return;
      }
      btn.addEventListener('click', function () {
        if (state.rec && state.recBtn === btn) { stopMic(); return; }
        stopMic();
        var rec;
        try { rec = new SR(); } catch (e) { if (st) st.textContent = 'Não foi possível iniciar o microfone.'; return; }
        rec.lang = 'pt-BR'; rec.continuous = true; rec.interimResults = true;
        var max = parseInt(field.getAttribute('maxlength') || '2500', 10);
        var base = field.value.replace(/\s+$/, '');
        rec.onresult = function (ev) {
          var fin = '', inter = '';
          for (var i = 0; i < ev.results.length; i++) {
            var tx = ev.results[i][0].transcript;
            if (ev.results[i].isFinal) fin += tx; else inter += tx;
          }
          field.value = ((base ? base + ' ' : '') + (fin + inter).trim()).slice(0, max);
          field.dispatchEvent(new Event('input', { bubbles: true }));
          if (st) st.textContent = 'Ouvindo…';
        };
        rec.onerror = function (ev) {
          var map = { 'not-allowed': 'Permissão de microfone negada. Libere o microfone no navegador.', 'service-not-allowed': 'Permissão de microfone negada.', 'no-speech': 'Não ouvi nada. Tente de novo.', 'audio-capture': 'Nenhum microfone encontrado.', 'network': 'O ditado precisa de internet.' };
          if (st) st.textContent = map[ev.error] || ('Erro no ditado: ' + ev.error);
        };
        rec.onend = function () {
          if (state.rec === rec) { state.rec = null; state.recBtn = null; }
          btn.classList.remove('is-recording'); btn.setAttribute('aria-pressed', 'false'); btn.querySelector('.mic-label').textContent = 'Ditar';
          if (st && /^Ouvindo/.test(st.textContent)) st.textContent = 'Ditado concluído — revise o texto.';
        };
        try { rec.start(); } catch (e) { if (st) st.textContent = 'Não foi possível iniciar o ditado.'; return; }
        state.rec = rec; state.recBtn = btn;
        btn.classList.add('is-recording'); btn.setAttribute('aria-pressed', 'true'); btn.querySelector('.mic-label').textContent = 'Parar';
        if (st) st.textContent = 'Ouvindo… fale agora.';
      });
    });
  }
  function stopMic() { if (state.rec) { try { state.rec.stop(); } catch (e) {} } }



  // ── History ───────────────────────────────────────────────────────────────
  function pushHistory(entry) {
    var hist = lsGet(HISTORY_STORE, []);
    var i = -1; hist.forEach(function (h, idx) { if (h.id === entry.id) i = idx; });
    if (i === -1) hist.push(entry); else hist[i] = entry;
    while (hist.length > HISTORY_MAX) hist.shift();
    if (lsSet(HISTORY_STORE, hist)) { toast('Salvo no histórico (nº ' + (i === -1 ? hist.length : i + 1) + '). Ligue "Comparar com o histórico" para ver na carta.'); renderLibrary(); if ($('toggle-history').checked) renderChart(); }
    else toast('Não foi possível salvar (armazenamento do navegador cheio ou bloqueado).');
  }
  function saveCurrent() { if (state.cur) pushHistory(state.cur); }
  function renderLibrary() {
    var hist = lsGet(HISTORY_STORE, []).map(normalizeEntry), el = $('lib-list');
    if (!hist.length) { el.innerHTML = '<p class="lib-empty">Nenhuma ideia salva ainda. Gere uma carta e use "Salvar no histórico".</p>'; return; }
    el.innerHTML = hist.map(function (h, i) {
      return '<div class="lib-item"><button class="lib-open" data-id="' + esc(h.id) + '"><b>' + (i + 1) + '. ' + esc(h.titulo) + '</b><span>' + esc(QUADS[h.q].nome) + (h.anchor ? ' ⚓' : '') + ' · D ' + h.x + ' · $ ' + h.y + (h.kind === 'sugestao' ? ' · sugestão' : '') + ' · ' + esc(new Date(h.ts).toLocaleDateString('pt-BR')) + '</span></button><button class="btn-icon lib-del" data-id="' + esc(h.id) + '" aria-label="Apagar ' + esc(h.titulo) + '" title="Apagar">&times;</button></div>';
    }).join('');
  }
  function onLibClick(e) {
    var openB = e.target.closest('.lib-open'), delB = e.target.closest('.lib-del');
    var hist = lsGet(HISTORY_STORE, []);
    if (openB) {
      var it = hist.filter(function (h) { return h.id === openB.getAttribute('data-id'); })[0];
      if (it) { loadEntry(it); $('lib-modal').style.display = 'none'; }
    } else if (delB) {
      var id = delB.getAttribute('data-id');
      lsSet(HISTORY_STORE, hist.filter(function (h) { return h.id !== id; }));
      renderLibrary(); renderChart(); toast('Ideia apagada do histórico.');
    }
  }
  function loadEntry(it) {
    state.cur = normalizeEntry(it);
    $('in-ideia').value = it.ideia || ''; $('in-contexto').value = it.contexto || '';
    setGoal(it.goal || 'renda'); updateCount();
    lsSet(CURRENT_SLOT, state.cur);
    renderReport(); showState('done'); setTab('diag');
  }

  // ── Exports ───────────────────────────────────────────────────────────────
  function fname(ext) { return 'veiculo-ia-' + String(state.cur ? state.cur.titulo : 'carta').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) + '.' + ext; }
  function exportPNG() {
    var cur = state.cur; if (!cur) return;
    var off = document.createElement('div');
    off.style.cssText = 'position:fixed;left:-12000px;top:0;width:1000px;visibility:hidden;';
    document.body.appendChild(off);
    var g = geom('export'), useSugs = state.chartMode === 'rumo' && cur.sugs && cur.sugs.length;
    var o = { idp: 'e', cur: cur, mode: useSugs ? 'rumo' : 'diag', iw: 0, target: useSugs ? (cur.sugTarget || cur.target) : null, showHist: false };
    off.innerHTML = buildSVG(g, o);
    var svgEl = off.querySelector('svg');
    try { layout(svgEl, g, o); } catch (e) {}
    if (o.target) drawDest(svgEl, g, o.target.x, o.target.y, false);
    // inline the CSS-styled bits (classes do not travel into the PNG)
    Array.prototype.forEach.call(svgEl.querySelectorAll('.route'), function (el) { el.setAttribute('stroke', '#b5246b'); el.setAttribute('stroke-width', '2'); el.setAttribute('stroke-dasharray', '7 6'); el.setAttribute('fill', 'none'); });
    Array.prototype.forEach.call(svgEl.querySelectorAll('.buoy-ring'), function (el) { el.setAttribute('fill', '#fffdf7'); el.setAttribute('stroke', '#b5246b'); el.setAttribute('stroke-width', '3'); });
    Array.prototype.forEach.call(svgEl.querySelectorAll('.buoy-core'), function (el) { el.setAttribute('fill', '#b5246b'); });
    Array.prototype.forEach.call(svgEl.querySelectorAll('.qhl-r'), function (el) { el.setAttribute('fill', 'none'); });
    var CWd = 1520, CHd = Math.round(CWd * g.H / g.W);
    svgEl.setAttribute('x', 40); svgEl.setAttribute('y', 150); svgEl.setAttribute('width', CWd); svgEl.setAttribute('height', CHd);
    var inner = new XMLSerializer().serializeToString(svgEl);
    off.remove();
    var qd = QUADS[cur.q], y0 = 150 + CHd + 54, bnd = boundary(cur.x, cur.y);
    var lines = [];
    if (cur.anchor) lines.push({ t: '⚓ ' + ANCHOR.nome + ' — ' + ANCHOR.linha, c: '#14284a' });
    if (bnd) lines.push({ t: 'Fica ' + bnd, c: '#4a5a74' });
    if (useSugs) {
      var t = o.target;
      lines.push({ t: 'Destino: ' + QUADS[quad(t.x, t.y)].nome + ' · ' + signed(t.y - cur.y) + ' dinheiro · ' + signed(t.x - cur.x) + ' dificuldade', c: '#8e1752' });
      cur.sugs.forEach(function (s, i) { lines.push({ t: (i + 1) + ' · ' + cut(s.nome, 46) + ' — ' + (s.perto ? 'chega perto' : 'fica longe') + ' (a ' + s.dist + ' pts)' + (s.anchor ? ' ⚓' : ''), c: s.perto ? '#0f6b6b' : '#4a5a74' }); });
    } else {
      (cur.pivots || []).forEach(function (p, i) { lines.push({ t: (i + 1) + ' · ' + cut(p.nome, 56) + ' → ' + QUADS[p.q].nome + (p.anchor ? ' ⚓' : '') + ' · ' + signed(p.y - cur.y) + ' dinheiro · ' + signed(p.x - cur.x) + ' dificuldade', c: '#0f6b6b' }); });
    }
    var H = y0 + 52 + lines.length * 34 + 60, W = 1600;
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">' +
      '<rect width="' + W + '" height="' + H + '" fill="#f4efe2"/>' +
      '<text x="40" y="58" font-family="Menlo,Consolas,monospace" font-size="20" letter-spacing="3" fill="#8e1752">VEÍCULO IA · ÍNDICE DO IDIOTA</text>' +
      '<text x="40" y="112" font-family="Georgia,serif" font-style="italic" font-weight="700" font-size="46" fill="#14284a">' + esc(cut(cur.titulo, 58)) + '</text>' +
      inner +
      '<text x="40" y="' + y0 + '" font-family="Georgia,serif" font-style="italic" font-weight="700" font-size="34" fill="#b5246b">' + esc(qd.nome) + ' · ' + esc(qd.eixo) + (cur.anchor ? ' · ⚓' : '') + '</text>' +
      '<text x="40" y="' + (y0 + 44) + '" font-family="Menlo,Consolas,monospace" font-size="22" fill="#14284a">Dificuldade ' + cur.x + '/100 · Dinheiro ' + cur.y + '/100 · Objetivo: ' + esc(GOALS[cur.goal].label) + '</text>' +
      lines.map(function (l, i) { return '<text x="40" y="' + (y0 + 92 + i * 34) + '" font-family="Menlo,Consolas,monospace" font-size="20" fill="' + l.c + '">' + esc(l.t) + '</text>'; }).join('') +
      '<text x="40" y="' + (H - 24) + '" font-family="Menlo,Consolas,monospace" font-size="16" fill="#4a5a74">Base: Índice do Idiota, de Alex Hormozi (vídeo, 2026), adaptado em 4 quadrantes + âncora · Comunidade Maestros da IA · veiculoia.maestrosdaia.com</text>' +
      '</svg>';
    var img = new Image();
    img.onload = function () {
      try {
        var c = document.createElement('canvas'); c.width = W * 1.5; c.height = H * 1.5;
        var ctx = c.getContext('2d'); ctx.scale(1.5, 1.5); ctx.drawImage(img, 0, 0);
        var url = c.toDataURL('image/png'); // COR-064: synchronous
        var a = document.createElement('a'); a.href = url; a.download = fname('png');
        document.body.appendChild(a); a.click(); a.remove();
        toast('Carta baixada (PNG).');
      } catch (e) { toast('Não foi possível gerar o PNG neste navegador.'); }
    };
    img.onerror = function () { toast('Não foi possível gerar o PNG neste navegador.'); };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }
  function printReport() {
    var ds = Array.prototype.slice.call(document.querySelectorAll('#report-body details'));
    var was = ds.map(function (d) { return d.open; });
    var prevTab = state.tab;
    ds.forEach(function (d) { d.open = true; });
    if (prevTab !== 'diag') setTab('diag');
    setTimeout(function () {
      window.print();
      ds.forEach(function (d, i) { d.open = was[i]; });
      if (prevTab !== 'diag') setTab(prevTab);
    }, 60);
  }

  function textSummary() {
    var c = state.cur; if (!c) return '';
    var L1 = ['VEÍCULO IA — ' + c.titulo, c.resumo || c.ideia, '',
      'Posição: dificuldade ' + c.x + '/100 · dinheiro ' + c.y + '/100',
      'Quadrante: ' + QUADS[c.q].nome + ' (' + QUADS[c.q].eixo + ')' + (c.anchor ? ' · ⚓ ' + ANCHOR.nome + ' — ' + ANCHOR.linha : ''),
      boundary(c.x, c.y) ? 'Fica ' + boundary(c.x, c.y) : '',
      'Objetivo: ' + GOALS[c.goal].label + ' — encaixe ' + c.fit, ''].filter(function (l, i) { return l !== '' || i === 2 || i === 7; });
    if (c.report) {
      if (c.report.diagnostico) L1.push('DIAGNÓSTICO', c.report.diagnostico, '');
      if (c.bil) L1.push('TESTE DO BILIONÁRIO: ' + c.bil.veredito + (c.bil.exemplo ? ' — ' + c.bil.exemplo : '') + '. ' + c.bil.comentario, '');
      L1.push('PRÓXIMOS PASSOS'); c.report.passos.forEach(function (r, i) { L1.push((i + 1) + ') ' + r.texto + ' [' + sourceById(r.fonte).short + ']'); }); L1.push('');
      L1.push('RISCOS'); c.report.riscos.forEach(function (r) { L1.push('- ' + r.texto + ' [' + sourceById(r.fonte).short + ']'); }); L1.push('');
    }
    if (c.pivots && c.pivots.length) { L1.push('PIVÔS'); c.pivots.forEach(function (p, i) { L1.push((i + 1) + ') ' + p.nome + ': ' + p.descricao + ' → ' + QUADS[p.q].nome + (p.anchor ? ' ⚓' : '') + ' (' + signed(p.y - c.y) + ' dinheiro, ' + signed(p.x - c.x) + ' dificuldade)'); }); L1.push(''); }
    if (c.sugs && c.sugs.length) { var t = c.sugTarget || c.target; L1.push('NEGÓCIOS PARECIDOS — destino ' + QUADS[quad(t.x, t.y)].nome + ' (dificuldade ' + t.x + ', dinheiro ' + t.y + ')'); c.sugs.forEach(function (s, i) { L1.push((i + 1) + ') ' + s.nome + ' — ' + (s.perto ? 'chega perto' : 'fica longe') + ' (a ' + s.dist + ' pts)' + (s.anchor ? ' ⚓' : '') + ': ' + s.descricao); }); L1.push(''); }
    L1.push('RÚBRICA'); RUBRIC.forEach(function (r) { L1.push('- ' + r.label + ': ' + c.rubric[r.k].nota + '/10' + (c.rubric[r.k].porque ? ' — ' + c.rubric[r.k].porque : '')); });
    L1.push('', 'Base: Índice do Idiota, de Alex Hormozi (vídeo, 2026), adaptado em 4 quadrantes + âncora. Ferramenta educacional — Comunidade Maestros da IA.');
    return L1.join('\n');
  }
  function copyText() {
    var t = textSummary(); if (!t) return;
    var done = function () { toast('Relatório copiado.'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(done, function () { fallbackCopy(t); done(); });
    else { fallbackCopy(t); done(); }
  }
  function fallbackCopy(t) { var ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (e) {} ta.remove(); }



  // ── Form bits ─────────────────────────────────────────────────────────────
  function updateCount() { $('ideia-count').textContent = ($('in-ideia').value || '').length; }
  function setGoal(g) {
    state.goal = GOALS[g] ? g : 'renda';
    document.querySelectorAll('#goal-chips .chip').forEach(function (c) { c.setAttribute('aria-pressed', c.getAttribute('data-val') === state.goal ? 'true' : 'false'); });
    if (state.objAuto) { var el = $('in-obj'); if (el) el.value = GOALS[state.goal].obj; }
  }
  var IDEA_EXAMPLES = [
    { i: 'Quero abrir uma academia de bairro com aulas em grupo e personal trainers, mensalidade de R$ 129, em Belo Horizonte.', c: 'sou educador físico, tenho R$ 150 mil', g: 'renda' },
    { i: 'Empresa de limpeza comercial para condomínios e escritórios, com contrato mensal recorrente e equipe própria treinada.', c: 'já trabalhei 6 anos como gerente de facilities', g: 'empresa' },
    { i: 'Mentoria online em grupo para dentistas que querem atrair pacientes de implante pelo Instagram, com aulas ao vivo e comunidade.', c: 'sou dentista com 40 mil seguidores', g: 'renda' }
  ];
  var exIdx = 0;
  function useExample() {
    var ex = IDEA_EXAMPLES[exIdx % IDEA_EXAMPLES.length]; exIdx++;
    $('in-ideia').value = ex.i; $('in-contexto').value = ex.c; setGoal(ex.g); updateCount();
    toast('Exemplo preenchido — clique em "Posicionar na carta".');
  }
  function clearForm() {
    stopMic();
    $('in-ideia').value = ''; $('in-contexto').value = ''; updateCount();
    state.cur = null; try { localStorage.removeItem(CURRENT_SLOT); } catch (e) {}
    showState('done'); renderChart();
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  function init() {
    if (state.wired) return;
    state.wired = true;
    if (window.ApiKeyManager && ApiKeyManager.renderModelPicker) ApiKeyManager.renderModelPicker('model-select');
    renderOrigins();
    setupMics();
    $('in-ideia').addEventListener('input', updateCount);
    $('in-obj').addEventListener('input', function () { state.objAuto = false; });
    document.querySelectorAll('#goal-chips .chip').forEach(function (c) { c.addEventListener('click', function () { setGoal(c.getAttribute('data-val')); }); });
    $('generate-btn').addEventListener('click', generate);
    $('retry-btn').addEventListener('click', generate);
    $('example-btn').addEventListener('click', useExample);
    $('clear-btn').addEventListener('click', clearForm);
    $('save-btn').addEventListener('click', saveCurrent);
    $('copy-btn').addEventListener('click', copyText);
    $('print-btn').addEventListener('click', printReport);
    $('png-btn').addEventListener('click', exportPNG);
    $('sug-btn').addEventListener('click', suggest);
    $('dest-go').addEventListener('click', suggest);
    $('sug-list').addEventListener('click', onSugClick);
    $('dir-buttons').addEventListener('click', function (e) { var b = e.target.closest('.dir-btn'); if (b) setTargetFromChip(b.getAttribute('data-dir')); });
    document.querySelectorAll('#result-tabs [role="tab"]').forEach(function (b) {
      b.addEventListener('click', function () { setTab(b.getAttribute('data-tab')); });
      b.addEventListener('keydown', function (e) {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        var tabs = Array.prototype.slice.call(document.querySelectorAll('#result-tabs [role="tab"]'));
        var i = tabs.indexOf(b) + (e.key === 'ArrowRight' ? 1 : -1);
        var nb = tabs[(i + tabs.length) % tabs.length]; setTab(nb.getAttribute('data-tab')); nb.focus();
      });
    });
    $('toggle-history').addEventListener('change', renderChart);
    // board interaction (delegated: the SVG is re-rendered on state changes, never per pointer move)
    var host = $('chart-host');
    host.addEventListener('pointerdown', onDown);
    host.addEventListener('pointermove', onChartMove);
    host.addEventListener('pointerup', onDragUp);
    host.addEventListener('pointercancel', onDragCancel);
    host.addEventListener('pointerleave', onChartLeave);
    host.addEventListener('click', onChartClick);
    var hd = $('boat-handle');
    hd.addEventListener('pointerdown', onHandleDown);
    hd.addEventListener('pointermove', onDragMove);
    hd.addEventListener('pointerup', onDragUp);
    hd.addEventListener('pointercancel', onDragCancel);
    $('chart-wrap').addEventListener('keydown', onBoardKey);
    var pop = $('chart-pop');
    pop.addEventListener('click', onPopClick);
    pop.addEventListener('pointerenter', function () { clearTimeout(state.lens.hideT); if (state.lens.open && !state.lens.pinned) { state.lens.pinned = true; state.lens.key += '#p'; pop.classList.add('pinned'); } });
    // corner "i" buttons + anchor "i" (delegated: they are re-created on render)
    document.addEventListener('click', function (e) {
      var zb = e.target.closest && e.target.closest('.zinfo');
      if (zb) { e.preventDefault(); openCard(zb.getAttribute('data-q'), zb); return; }
      var cl = e.target.closest && e.target.closest('.zc-close');
      if (cl) { closeCard(true); return; }
      var a = e.target.closest && e.target.closest('a.src');
      if (!a) return;
      var id = (a.getAttribute('href') || '').replace('#', ''), el = document.getElementById(id);
      if (!el) return;
      e.preventDefault();
      var box = $('origens-box'); if (box) box.open = true;
      hideLens(true); closeCard(false);
      setTimeout(function () { el.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'center' }); el.classList.add('flash'); setTimeout(function () { el.classList.remove('flash'); }, 1600); }, 30);
    });
    document.addEventListener('pointerdown', function (e) {
      var t = e.target;
      if (state.card.open && !(t.closest && (t.closest('#zone-card') || t.closest('.zinfo')))) closeCard(false);
      if (state.lens.open && !(t.closest && (t.closest('#chart-pop') || t.closest('#chart-host')))) hideLens(true);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (state.card.open) { closeCard(true); return; }
      if (state.lens.open) { hideLens(true); return; }
      $('lib-modal').style.display = 'none';
    });
    $('library-btn').addEventListener('click', function () { renderLibrary(); $('lib-modal').style.display = 'flex'; });
    $('lib-close').addEventListener('click', function () { $('lib-modal').style.display = 'none'; });
    $('lib-modal').querySelector('.modal-overlay').addEventListener('click', function () { $('lib-modal').style.display = 'none'; });
    $('lib-list').addEventListener('click', onLibClick);
    var lo = $('logout-btn');
    if (lo) lo.addEventListener('click', function () { // COR-062
      stopMic(); hideLens(true); closeCard(false);
      var em = $('gate-email'), ph = $('gate-phone'), er = $('gate-error');
      if (em) em.value = ''; if (ph) ph.value = ''; if (er) { er.textContent = ''; er.style.display = 'none'; }
    });
    var rt = 0;
    window.addEventListener('resize', function () {
      clearTimeout(rt);
      rt = setTimeout(function () { var w = hostWidth(); if (w && Math.abs(w - state.lastHostW) > 40) renderChart(); else { placeHandle(); placeDestGo(); renderChartButtonsOnly(); } }, 160);
    });
    var last = lsGet(CURRENT_SLOT, null);
    if (last && last.rubric && last.x != null) loadEntry(last);
    else { showState('done'); renderChart(); }
    updateCount();
    prefillObj();
  }
  function renderChartButtonsOnly() { renderChart(); }


  return { init: init, _calc: { position: position, quad: quad, anchorOf: anchorOf, boundary: boundary, goalFit: goalFit, normRubric: normRubric, normSugs: normSugs, normalizeEntry: normalizeEntry, EXAMPLES: EXAMPLES, SOURCES: SOURCES, geom: geom, buildSVG: buildSVG, layout: layout } };
})();

// ── App init triggers: event + DOMContentLoaded + MutationObserver (COR-008/044) ──
(function () {
  var started = false;
  function go() { if (started) return; started = true; App.init(); }
  document.addEventListener('maestria:app-ready', go);
  window.addEventListener('maestria:app-ready', go);
  document.addEventListener('DOMContentLoaded', function () {
    var app = document.getElementById('app-screen');
    if (app && app.classList.contains('active')) setTimeout(go, 100);
    if (app) {
      var mo = new MutationObserver(function () { if (app.classList.contains('active')) go(); });
      mo.observe(app, { attributes: true, attributeFilter: ['class'] });
    }
  });
})();
