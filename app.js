/**
 * Veículo IA — Main Application Logic (v2)
 *
 * Positions a business idea on the "Idiot Index" chart (x = difficulty to
 * operate, y = money potential) into one of 5 vehicles.
 *
 *   1. The member's own model (BYOK via OpenRouter) scores a FIXED 14-criterion
 *      rubric + a "sounds cool" factor + the "who is the billionaire?" test.
 *   2. THIS TOOL computes the position deterministically (fixed weights) and the
 *      vehicle by zone — the same rubric always lands on the same point.
 *   3. A second call writes the report (grounded only in whitelisted sources)
 *      with 3 pivots; the tool re-scores and plots them.
 *   4. "Para onde você quer ir?": the member picks a side of the chart; one call
 *      returns similar businesses scored on the SAME rubric; the tool computes
 *      where each lands and judges the move by the computed delta.
 *
 * Chart: clean SVG (5 zones, 2 axis captions, the idea). Example businesses
 * appear only on hover / tap / keyboard, in a popup. Labels are placed with
 * real getBBox() measurements so the idea label never overlaps anything.
 * Everything runs client-side; the only backend is the shared n8n gate.
 */
const App = (function () {
  'use strict';

  // ── storage slot names (COR-025: never `*KEY = '<hyphenated literal>'`) ──
  var HISTORY_STORE = 'veiculo_ia_history';
  var CURRENT_SLOT = 'veiculo_ia_current';
  var HISTORY_MAX = 30;
  var SVGNS = 'http://www.w3.org/2000/svg';

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
    { k: 'transferivel', axis: 'y', w: 0.10, label: 'Independência do fundador', hint: 'funciona e é vendável sem você (10 = totalmente independente)' },
    { k: 'concorrencia', axis: 'y', w: 0.08, label: 'Saturação da concorrência', hint: 'quantos já fazem igual (10 = saturado). Conta CONTRA o dinheiro.', inverse: true }
  ];
  var RKEYS = RUBRIC.map(function (r) { return r.k; });

  var VEHICLES = {
    1: { n: 1, nome: 'Commodities braçais', curta: 'Commodities braçais', eixo: 'difícil · pouco dinheiro', resumo: 'Qualquer um entra: concorrência feroz, escala limitada e muito arrasto operacional.' },
    2: { n: 2, nome: 'Caixa inicial', curta: 'Caixa inicial', eixo: 'fácil · pouco dinheiro', resumo: 'Bom para começar: uma pessoa chega a uma renda de top 1%, mas raramente fica muito maior.' },
    3: { n: 3, nome: 'Dependente de especialista', curta: 'Especialista', eixo: 'médio · médio', resumo: 'Dá renda alta, mas depende de você e é difícil de vender: pouco valor de empresa.' },
    4: { n: 4, nome: 'Empresas com fosso', curta: 'Fosso', eixo: 'difícil · muito dinheiro', resumo: 'Barreiras de entrada limitam a concorrência: dá para fazer bilhões, mas é muito difícil e demora.' },
    5: { n: 5, nome: 'Arbitragem de oferta e demanda', curta: 'Arbitragem', eixo: 'fácil · muito dinheiro', resumo: 'Demanda forte com pouca concorrência: vento a favor, oferta restrita ou mudança regulatória.' }
  };

  var GOALS = {
    fluxo: { label: 'Fluxo de caixa', obj: 'Gerar fluxo de caixa logo', good: [2, 5], partial: [3, 1], poor: [4] },
    renda: { label: 'Renda alta', obj: 'Ter renda alta', good: [3, 5], partial: [2, 4], poor: [1] },
    empresa: { label: 'Valor de empresa', obj: 'Construir uma empresa que dê para vender', good: [4, 5], partial: [1], poor: [2, 3] },
    bilhoes: { label: 'Bilhões', obj: 'Construir algo de bilhões: mercado enorme e fosso', good: [4], partial: [5], poor: [1, 2, 3] }
  };

  // ── Original literature, in chronological order. `honest` = what is (and is not) claimed. ──
  var SOURCES = [
    { id: 'bcg', year: 1970, short: 'BCG 1970', title: 'Bruce Henderson / BCG — matriz crescimento-participação (1970)', supports: 'O formato de matriz 2×2 para classificar negócios por dois eixos — a carta ecoa esse formato.', honest: 'Os eixos são outros (crescimento × participação de mercado); só a forma é herdada.', url: 'https://www.bcg.com/about/overview/our-history/growth-share-matrix' },
    { id: 'kirzner', year: 1973, short: 'Kirzner 1973', title: 'Israel M. Kirzner — Competition and Entrepreneurship (1973)', supports: 'O empreendedor como alguém alerta a desequilíbrios e oportunidades de arbitragem — a lógica do veículo 5.', honest: 'Teoria econômica austríaca; a ligação com med spas e GLP-1 é aplicação nossa.', url: 'https://en.wikipedia.org/wiki/Israel_Kirzner' },
    { id: 'porter', year: 1979, short: 'Porter 1979', title: 'Michael E. Porter — "How Competitive Forces Shape Strategy" (HBR, 1979) e Competitive Strategy (1980)', supports: 'Barreiras de entrada, rivalidade e a estrutura da indústria decidem a lucratividade — por que o veículo 1 sofre e o veículo 4 lucra.', honest: 'Porter não fala em "Índice do Idiota"; a ponte entre as cinco forças e a carta é interpretação.', url: 'https://hbr.org/1979/03/how-competitive-forces-shape-strategy' },
    { id: 'buffett_1980', year: 1980, short: 'Buffett 1980', title: 'Warren Buffett — carta aos acionistas da Berkshire Hathaway, 1980', supports: 'Quando uma gestão brilhante encontra um negócio de economia ruim, é a reputação do negócio que fica intacta — o limite do veículo 1.', honest: 'A frase é de Buffett; a aplicação a pequenos negócios é nossa leitura.', url: 'https://www.berkshirehathaway.com/letters/1980.html' },
    { id: 'buffett_1985', year: 1985, short: 'Buffett 1985', title: 'Warren Buffett — carta aos acionistas da Berkshire Hathaway, 1985', supports: '"Um bom histórico gerencial é muito mais função do barco em que você entra do que de quão bem você rema" — o veículo importa mais que o esforço.', honest: 'A história do colega que foi para o aço é contada de memória no vídeo; a frase do barco está na carta de 1985.', url: 'https://www.berkshirehathaway.com/letters/1985.html' },
    { id: 'lynch', year: 1989, short: 'Lynch 1989', title: 'Peter Lynch — One Up on Wall Street (1989), cap. 8, "The Perfect Stock, What a Deal!"', supports: 'A ação perfeita "soa chata — ou, melhor ainda, ridícula", "faz algo desagradável", e "é difícil pensar numa indústria mais perfeita do que a de gestão de resíduos". É a raiz do desconto do "parece legal": o que ninguém quer fazer tem menos concorrência.', honest: 'Lynch fala de escolher ações, não de abrir negócios; a ponte com o veículo 5 é nossa. Conferido no texto do livro (copyright 1989).', url: 'https://www.simonandschuster.com/books/One-Up-On-Wall-Street/Peter-Lynch/9780743200400' },
    { id: 'buffett_fosso', year: 1999, short: 'Fosso (Buffett)', title: 'Warren Buffett — o "fosso econômico" (Fortune, 1999; carta de 2007)', supports: 'A vantagem competitiva durável que protege os lucros — a base do veículo 4.', honest: 'O vídeo lista os fossos (habilidade, capital, regulação, tempo, rede); o conceito de "moat" é de Buffett.', url: 'https://www.berkshirehathaway.com/letters/2007ltr.pdf' },
    { id: 'pick', year: 2003, short: 'PICK 2003', title: 'PICK chart (Possible, Implement, Challenge, Kill) — Lockheed Martin; Lean Six Sigma (Michael L. George, 2003)', supports: 'Uma matriz 2×2 de facilidade de implementar × retorno. Os quadrantes batem com os 4 cantos da carta: Possible = fácil e pouco retorno (veículo 2), Implement = fácil e muito retorno (5), Challenge = difícil e muito retorno (4), Kill = difícil e pouco retorno (1).', honest: 'Serve para priorizar projetos de melhoria dentro de uma empresa, não para escolher negócios. Conferido na Wikipedia, que cita George, Lean Six Sigma for Service (2003); não conseguimos abrir o livro.', url: 'https://en.wikipedia.org/wiki/PICK_chart' },
    { id: 'warrillow', year: 2010, short: 'Warrillow 2010', title: 'John Warrillow — Built to Sell (2010)', supports: 'Negócios que dependem do fundador não são vendáveis — o limite do veículo 3 (renda alta, pouco valor de empresa).', honest: 'Warrillow escreve sobre tornar uma empresa de serviço vendável; não usa a carta.', url: 'https://en.wikipedia.org/wiki/Built_to_Sell' },
    { id: 'demarco', year: 2011, short: 'DeMarco 2011', title: 'MJ DeMarco — The Millionaire Fastlane (2011), os cinco "mandamentos" (hoje conhecidos pela sigla CENTS)', supports: 'Controle, Entrada, Necessidade, Tempo e Escala. Entrada (se é fácil entrar, todo mundo entra) explica os veículos 1 e 2; Tempo (o negócio precisa se desligar das suas horas) explica o limite do veículo 3.', honest: 'No livro de 2011 eles são cinco capítulos ("The Commandment of Need / Entry / Control / Scale / Time"); a sigla CENTS veio depois. DeMarco não usa a carta.', url: 'https://www.thefastlaneforum.com/' },
    { id: 'thiel', year: 2014, short: 'Thiel 2014', title: 'Peter Thiel — Zero to One (2014)', supports: '"Competição é para perdedores": prefira mercados com poucos concorrentes — o mesmo raciocínio de "prefiro competir com 20 do que com 5 milhões".', honest: 'Thiel defende monopólios criativos; o vídeo chega a uma conclusão parecida pela via das barreiras.', url: 'https://en.wikipedia.org/wiki/Zero_to_One' },
    { id: 'naval', year: 2018, short: 'Naval 2018', title: 'Naval Ravikant — "How to Get Rich (without getting lucky)", thread no Twitter (31/05/2018)', supports: '"Você não vai ficar rico alugando o seu tempo." Fortuna exige alavancagem: trabalho, capital e código e mídia — estas "sem permissão". É o ponto da "armadura do Homem de Ferro": mídia e coaching alavancam o especialista (veículo 3).', honest: 'Data conferida no próprio tweet; frases conferidas em nav.al/rich, o site do autor. Naval fala de enriquecer em geral, não dos 5 veículos.', url: 'https://nav.al/rich' },
    { id: 'hormozi_offers', year: 2021, short: '$100M Offers', title: 'Alex Hormozi — $100M Offers (2021), a "multidão faminta"', supports: 'Escolha de mercado: dor intensa, poder de compra, fácil de alcançar e crescendo — por isso "mude para um público mais velho e com dinheiro" é um pivô recorrente.', honest: 'Livro do próprio Hormozi, anterior ao vídeo.', url: 'https://www.acquisition.com/books' },
    { id: 'musk', year: 2022, short: 'Musk', title: 'Elon Musk — o "idiot index" original', supports: 'O nome: para Musk, idiot index é o custo de uma peça dividido pelo custo da matéria-prima. O vídeo reaproveita o nome para outra ideia.', honest: 'São conceitos diferentes; só o rótulo foi emprestado. O termo circula em falas de Musk, sem uma publicação única de origem.', url: 'https://en.wikipedia.org/wiki/Elon_Musk' },
    { id: 'hormozi_video', year: 2026, short: 'Hormozi 2026', title: 'Alex Hormozi — "How To Make More Money Than You Deserve (My 2027 Framework)" (YouTube, nov. 2026)', supports: 'A carta do Índice do Idiota, os 5 veículos e seus exemplos, o teste do bilionário ("como é isso no máximo?"), o desconto do "parece legal" e o fechamento: escolha o veículo pelo objetivo, depois reme forte.', honest: 'Não achamos ninguém que tenha publicado antes este mesmo quadro (tipos de negócio em 5 veículos, dificuldade × dinheiro): as peças são mais antigas — veja acima —, mas a síntese é dele. Baseado no que ele viu em mais de 10 mil negócios; não é pesquisa acadêmica.', url: 'https://youtu.be/pwZJcLZc3_Y' }
  ];
  var SOURCE_IDS = SOURCES.map(function (s) { return s.id; });
  function sourceById(id) { for (var i = 0; i < SOURCES.length; i++) if (SOURCES[i].id === id) return SOURCES[i]; return sourceById('hormozi_video'); }

  // ── Example businesses cited in the video (illustrative positions; vehicle = zone) ──
  var EXAMPLES = [
    { t: 'Restaurante tradicional', x: 66, y: 27, w: 1, d: 'Equipe grande, turnos longos e estoque que estraga.', m: 'Margem fina e um concorrente em cada esquina.' },
    { t: 'Academia de serviço', x: 61, y: 31, w: 1, d: 'Instrutores, horários e aparelhos para manter.', m: 'Preço achatado pelas redes; teto preso ao espaço físico.' },
    { t: 'Agência para pequenas empresas', x: 56, y: 33, w: 1, d: 'Cada cliente novo pede mais gente e retrabalho.', m: 'Clientes pequenos, troca alta e preço disputado.' },
    { t: 'Varejo físico', x: 71, y: 21, w: 1, d: 'Ponto, estoque e equipe de loja.', m: 'Margem baixa e guerra de preço.' },
    { t: 'Organização de eventos', x: 78, y: 29, w: 1, d: 'Logística pesada a cada evento.', m: 'Receita que não se repete e muita concorrência.' },
    { t: 'Dropshipping', x: 22, y: 30, w: 2, d: 'Começa com um notebook e anúncios.', m: 'Sem fosso: qualquer um copia o produto.' },
    { t: 'Lavagem e serviços leves para casa', x: 29, y: 22, w: 2, d: 'Pouco capital e habilidade simples.', m: 'Cobra por serviço; o teto é local.' },
    { t: 'Máquinas de venda e ATMs', x: 14, y: 19, w: 2, d: 'Poucas horas por semana para repor e manter.', m: 'Cada máquina rende pouco; difícil ficar grande.' },
    { t: 'Wholesale imobiliário', x: 31, y: 34, w: 2, d: 'A habilidade principal é negociar contratos.', m: 'Comissão por negócio, sem um ativo que acumule.' },
    { t: 'Arbitragem de Airbnb', x: 34, y: 41, w: 2, d: 'Gestão leve de imóveis alugados de terceiros.', m: 'A margem depende do aluguel e das regras da cidade.' },
    { t: 'Conteúdo de afiliado', x: 19, y: 37, w: 2, d: 'Produzir conteúdo e atrair tráfego.', m: 'Depende de plataformas e de comissões alheias.' },
    { t: 'Coaching online', x: 42, y: 47, w: 3, d: 'Seu conhecimento e a sua entrega pessoal.', m: 'Margem alta, mas tudo depende do fundador.' },
    { t: 'Implementação de IA', x: 48, y: 53, w: 3, d: 'Habilidade técnica rara, projeto a projeto.', m: 'Projetos bem pagos; difícil vender a empresa.' },
    { t: 'Construção', x: 60, y: 41, w: 3, d: 'Obra, equipe e capital de giro.', m: 'Contratos grandes, mas pouca recorrência.' },
    { t: 'Cirurgião', x: 56, y: 60, w: 3, d: 'Anos de formação e plantão.', m: 'Renda muito alta; sem você, a empresa vale pouco.' },
    { t: 'Agência enterprise', x: 53, y: 51, w: 3, d: 'Equipe sênior e vendas longas.', m: 'Tíquete alto; o valor está nas pessoas.' },
    { t: 'Influenciador', x: 40, y: 57, w: 3, d: 'Constância de conteúdo e audiência.', m: 'Patrocínio alto para poucos — viés de sobrevivência.' },
    { t: 'Clínica de reabilitação', x: 62, y: 47, w: 3, d: 'Equipe clínica, licenças e cuidado diário.', m: 'Paga bem, mas cresce no ritmo dos especialistas.' },
    { t: 'SaaS', x: 58, y: 75, w: 4, d: 'Time técnico e anos até tracionar.', m: 'Recorrência, margem e escala altas (fosso erodindo com IA).' },
    { t: 'Franquia', x: 69, y: 70, w: 4, d: 'Unidade-modelo validada e regras de franquia.', m: 'Royalties escalam sem operar cada loja.' },
    { t: 'Roll-up', x: 74, y: 65, w: 4, d: 'Capital e integração de várias empresas.', m: 'Juntar empresas pequenas aumenta o valor da soma.' },
    { t: 'Marketplace', x: 79, y: 87, w: 4, d: 'Capital e um efeito de rede difícil de iniciar.', m: 'Quando pega, o efeito de rede vale bilhões.' },
    { t: 'Farmacêutica', x: 90, y: 84, w: 4, d: 'Aprovação regulatória, capital e anos.', m: 'Patentes e fosso regulatório.' },
    { t: 'Banco', x: 86, y: 74, w: 4, d: 'Licença, regulação e muito capital.', m: 'Quem entra ganha quase uma licença para lucrar.' },
    { t: 'Bens de consumo (CPG)', x: 66, y: 80, w: 4, d: 'Marca, cadeia de suprimentos e capital.', m: 'Mercado enorme e uma marca que protege.' },
    { t: 'Energia e data centers', x: 93, y: 91, w: 4, d: 'Regulação, capital e habilidade.', m: 'Contratos longos e poucos competidores.' },
    { t: 'Med spa', x: 43, y: 66, w: 5, d: 'Clínica com protocolos, sem ser hospital.', m: 'Público mais velho e com dinheiro; demanda crescente.' },
    { t: 'Assessoria de patrimônio', x: 30, y: 77, w: 5, d: 'Carteira de clientes e licença.', m: 'O cliente fica e o patrimônio cresce sozinho.' },
    { t: 'Limpeza comercial', x: 26, y: 66, w: 5, d: 'Equipe, mas um serviço simples.', m: 'Contratos recorrentes e bons múltiplos.' },
    { t: 'Manutenção de elevadores', x: 37, y: 84, w: 5, d: 'Técnico especializado; poucos fabricantes.', m: 'Contrato obrigatório e recorrente.' },
    { t: 'Cobrança', x: 17, y: 68, w: 5, d: 'Saber vender e seguir as regras.', m: 'Pouca gente quer fazer, então sobra mercado.' },
    { t: 'Gestão de resíduos', x: 44, y: 74, w: 5, d: 'Licenças e logística de coleta.', m: 'Negócio "sem glamour": menos concorrência.', s: 'lynch' },
    { t: 'Cuidado de idosos', x: 33, y: 71, w: 5, d: 'Equipe de cuidado e licenças.', m: 'Há muito mais idosos do que vagas.' },
    { t: 'GLP-1 e Botox', x: 22, y: 84, w: 5, d: 'Protocolo clínico e prescrição.', m: 'Janela regulatória e demanda explosiva.' },
    { t: 'Sindicalização imobiliária', x: 12, y: 80, w: 5, d: 'Achar negócios e captar investidores.', m: 'A alavancagem do fundo multiplica o ganho.' }
  ];

  var DIRS = {
    up: { label: '↑ mais dinheiro', short: 'mais dinheiro', text: 'mais dinheiro (subir na carta), aceitando um pouco mais de dificuldade se precisar', u: [0, 1] },
    left: { label: '← mais fácil', short: 'mais fácil', text: 'mais fácil de operar (ir para a esquerda), sem perder dinheiro se possível', u: [-1, 0] },
    v5: { label: '↖ fácil e mais dinheiro (veículo 5)', short: 'fácil e mais dinheiro', text: 'o veículo 5: mais fácil e com mais dinheiro (arbitragem de oferta e demanda, vento a favor, público com dinheiro)', u: [-0.7071, 0.7071] },
    v4: { label: '↗ fosso / valor de empresa (veículo 4)', short: 'fosso e valor de empresa', text: 'o veículo 4: mais dinheiro e valor de empresa protegido por fosso, aceitando mais dificuldade', u: [0.7071, 0.7071] }
  };
  var DIR_ORDER = ['up', 'left', 'v5', 'v4'];

  var state = { cur: null, wired: false, busy: false, sugBusy: false, rec: null, recBtn: null, goal: 'renda', tab: 'diag', chartMode: 'diag', g: null, pop: { open: false, pinned: false, hideT: 0, returnFocus: null }, objAuto: true, raf: 0, lastHostW: 0 };

  // ── helpers ──
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  // COR-015: null-like LLM strings → ''
  function clean(v) {
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
  function signed(n) { return (n > 0 ? '+' : (n < 0 ? '−' : '±')) + Math.abs(n); }

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
    var x = 0, y = 0, parts = {};
    RUBRIC.forEach(function (c) {
      var n = rub[c.k].nota;
      var eff = c.inverse ? (10 - n) : n;
      var pts = eff * c.w * 10;
      parts[c.k] = pts;
      if (c.axis === 'x') x += pts; else y += pts;
    });
    var lg = clamp(num(legal, 5), 0, 10);
    var adj = -(lg - 5) * 0.6;
    y += adj;
    return { x: clamp(Math.round(x), 2, 98), y: clamp(Math.round(y), 2, 98), parts: parts, legalAdj: Math.round(adj * 10) / 10 };
  }
  function classify(x, y) {
    if (x >= 38 && x <= 64 && y >= 36 && y <= 62) return 3;
    if (y >= 50) return x < 50 ? 5 : 4;
    return x < 50 ? 2 : 1;
  }
  function goalFit(goal, v) {
    var g = GOALS[goal] || GOALS.renda;
    if (g.good.indexOf(v) !== -1) return 'bom';
    if (g.partial.indexOf(v) !== -1) return 'parcial';
    return 'ruim';
  }
  function applyDeltas(rub, deltas) {
    var r2 = {};
    RKEYS.forEach(function (k) {
      var d = deltas && deltas[k] != null ? clamp(Math.round(num(deltas[k], 0)), -4, 4) : 0;
      r2[k] = { nota: clamp(rub[k].nota + d, 0, 10), porque: rub[k].porque };
    });
    return r2;
  }
  // Which directions make sense from here
  function dirAllowed(cur, d) {
    if (!cur) return false;
    if (d === 'up') return cur.y <= 88;
    if (d === 'left') return cur.x >= 12;
    if (d === 'v5') return cur.v !== 5;
    if (d === 'v4') return cur.v !== 4 && cur.y <= 94;
    return false;
  }
  // Movement is judged by the COMPUTED delta, never by the model's claim.
  function judge(d, dx, dy, v) {
    if (d === 'up') return dy >= 5;
    if (d === 'left') return dx <= -5 && dy >= -6;
    if (d === 'v5') return v === 5 || (dx <= -3 && dy >= 3);
    if (d === 'v4') return v === 4 || (dy >= 6 && dx >= 0);
    return false;
  }
  function dirScore(d, dx, dy) { var u = DIRS[d].u; return dx * u[0] + dy * u[1]; }

  // ── Chart geometry ────────────────────────────────────────────────────────
  // Every SVG font size is >= 18 user units (Arthur's browser has an 18 px
  // minimum font size; smaller sizes would be inflated and collide).
  function geom(mode, hostW) {
    if (mode === 'export') return { W: 1000, H: 640, L: 70, R: 978, T: 16, B: 580, compact: false, fz: { zone: 26, axis: 22, idea: 21, num: 18 }, r: { boat: 22, dot: 15, ex: 7 } };
    if (hostW && hostW < 600) return { W: 560, H: 604, L: 44, R: 550, T: 12, B: 550, compact: true, fz: { zone: 24, axis: 21, idea: 21, num: 18 }, r: { boat: 21, dot: 15, ex: 8 } };
    return { W: 1000, H: 624, L: 66, R: 984, T: 14, B: 568, compact: false, fz: { zone: 26, axis: 22, idea: 21, num: 18 }, r: { boat: 22, dot: 15, ex: 7 } };
  }
  function pxf(g) { return function (x) { return g.L + (x / 100) * (g.R - g.L); }; }
  function pyf(g) { return function (y) { return g.B - (y / 100) * (g.B - g.T); }; }
  function boxOf(g) { var px = pxf(g), py = pyf(g); return { x0: px(38), x1: px(64), y0: py(62), y1: py(36) }; }
  function quadRect(g, z) {
    var px = pxf(g), py = pyf(g), mx = px(50), my = py(50);
    if (z === 5) return { x: g.L, y: g.T, w: mx - g.L, h: my - g.T };
    if (z === 4) return { x: mx, y: g.T, w: g.R - mx, h: my - g.T };
    if (z === 2) return { x: g.L, y: my, w: mx - g.L, h: g.B - my };
    if (z === 1) return { x: mx, y: my, w: g.R - mx, h: g.B - my };
    var b = boxOf(g); return { x: b.x0, y: b.y0, w: b.x1 - b.x0, h: b.y1 - b.y0 };
  }
  function zoneCenter(z) { return { 5: [20, 80], 4: [80, 80], 3: [51, 49], 2: [20, 20], 1: [80, 20] }[z]; }

  function markersFor(cur, tab) {
    if (!cur) return [];
    if (tab === 'rumo' && cur.sugs && cur.sugs.length) {
      return cur.sugs.map(function (s, i) { return { kind: 'sug', n: i + 1, x: s.x, y: s.y, vai: s.vai }; });
    }
    if (tab !== 'rumo' && cur.pivots && cur.pivots.length) {
      return cur.pivots.map(function (p, i) { return { kind: 'pivot', n: i + 1, x: p.x, y: p.y, vai: true }; });
    }
    return [];
  }

  // Spread dots that would sit on top of the boat or of each other (display only;
  // the exact numbers are always shown in the cards).
  function spreadDots(g, cur, list) {
    var px = pxf(g), py = pyf(g);
    var bx = px(cur.x), by = py(cur.y);
    var minB = g.r.boat + g.r.dot + 4, minD = 2 * g.r.dot + 3;
    var placed = [];
    function pushFromBoat(m, i) {
      var dx = m.cx - bx, dy = m.cy - by, d = Math.hypot(dx, dy);
      if (d >= minB) return;
      if (d < 0.5) { var a = -Math.PI / 2 + i * 0.9; dx = Math.cos(a); dy = Math.sin(a); d = 1; }
      m.cx = bx + dx / d * minB; m.cy = by + dy / d * minB;
    }
    list.forEach(function (m, i) {
      m.cx = px(m.x); m.cy = py(m.y);
      pushFromBoat(m, i);
      // nudge only as far as needed so touching dots sit side by side (smallest possible displacement)
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

  function buildSVG(g, o) {
    var px = pxf(g), py = pyf(g), cur = o.cur, p = o.idp;
    var mx = px(50), my = py(50), b = boxOf(g);
    var s = [];
    s.push('<svg xmlns="' + SVGNS + '" viewBox="0 0 ' + g.W + ' ' + g.H + '" class="chart-svg" role="group" aria-label="Carta do Índice do Idiota: dificuldade de operar no eixo horizontal, potencial de dinheiro no eixo vertical">');
    s.push('<defs><clipPath id="' + p + '-clip"><rect x="' + g.L + '" y="' + g.T + '" width="' + (g.R - g.L) + '" height="' + (g.B - g.T) + '"/></clipPath>' +
      '<marker id="' + p + '-ar-t" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#0f6b6b"/></marker>' +
      '<marker id="' + p + '-ar-g" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#7a8494"/></marker></defs>');
    s.push('<rect class="bg" x="0" y="0" width="' + g.W + '" height="' + g.H + '" fill="#fffdf7"/>');
    // zones
    s.push('<rect x="' + g.L + '" y="' + my + '" width="' + (mx - g.L) + '" height="' + (g.B - my) + '" fill="#d6e6ec"/>');
    s.push('<rect x="' + mx + '" y="' + my + '" width="' + (g.R - mx) + '" height="' + (g.B - my) + '" fill="#ece0bf"/>');
    s.push('<rect x="' + g.L + '" y="' + g.T + '" width="' + (mx - g.L) + '" height="' + (my - g.T) + '" fill="#c4e2dc"/>');
    s.push('<rect x="' + mx + '" y="' + g.T + '" width="' + (g.R - mx) + '" height="' + (my - g.T) + '" fill="#a9cbd8"/>');
    s.push('<line x1="' + mx + '" y1="' + g.T + '" x2="' + mx + '" y2="' + g.B + '" stroke="#14284a" stroke-width="1" opacity=".35"/>');
    s.push('<line x1="' + g.L + '" y1="' + my + '" x2="' + g.R + '" y2="' + my + '" stroke="#14284a" stroke-width="1" opacity=".35"/>');
    s.push('<rect x="' + b.x0 + '" y="' + b.y0 + '" width="' + (b.x1 - b.x0) + '" height="' + (b.y1 - b.y0) + '" rx="18" fill="#f4efe2" stroke="#14284a" stroke-width="1.4" stroke-dasharray="7 5"/>');
    s.push('<rect x="' + g.L + '" y="' + g.T + '" width="' + (g.R - g.L) + '" height="' + (g.B - g.T) + '" fill="none" stroke="#14284a" stroke-width="1.5"/>');
    // dynamic layers
    s.push('<g class="hl" clip-path="url(#' + p + '-clip)"></g>');
    if (o.interactive) {
      s.push('<g class="zone-hits">');
      [5, 4, 3, 2, 1].forEach(function (z) {
        var q = quadRect(g, z);
        s.push('<rect class="zone-hit" data-z="' + z + '" tabindex="0" role="button" aria-label="Veículo ' + z + ' · ' + esc(VEHICLES[z].nome) + '. Enter para ver exemplos ou escolher este lado." x="' + q.x + '" y="' + q.y + '" width="' + q.w + '" height="' + q.h + '"' + (z === 3 ? ' rx="18"' : '') + ' fill="transparent"/>');
      });
      s.push('</g>');
    }
    // markers (pivots or suggestions)
    var marks = cur ? spreadDots(g, cur, markersFor(cur, o.tab)) : [];
    o.circles = [];
    o.segs = [];
    if (cur) {
      var bx = px(cur.x), by = py(cur.y);
      s.push('<g class="arrows">');
      marks.forEach(function (m) {
        var d = Math.hypot(m.cx - bx, m.cy - by); if (d < 4) return;
        var ux = (m.cx - bx) / d, uy = (m.cy - by) / d;
        var x1 = bx + ux * (g.r.boat + 3), y1 = by + uy * (g.r.boat + 3), x2 = m.cx - ux * (g.r.dot + 3), y2 = m.cy - uy * (g.r.dot + 3);
        var grey = m.kind === 'sug' && !m.vai;
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
        s.push('<g class="buoy"><title>' + esc((i + 1) + '. ' + h.titulo + ' — veículo ' + h.v) + '</title><circle cx="' + hx + '" cy="' + hy + '" r="13" fill="#fffdf7" stroke="#2e4366" stroke-width="2.4"/><text x="' + hx + '" y="' + (hy + 6.3) + '" text-anchor="middle" font-family="Menlo,Consolas,monospace" font-size="18" font-weight="700" fill="#14284a">' + (i + 1) + '</text></g>');
        o.circles.push({ cx: hx, cy: hy, r: 13 });
      });
      s.push('</g>');
    }
    if (marks.length) {
      s.push('<g class="dots">');
      marks.forEach(function (m) {
        var fill = m.kind === 'pivot' ? '#e3f1ee' : (m.vai ? '#0f6b6b' : '#fffdf7');
        var stroke = m.kind === 'sug' && !m.vai ? '#7a8494' : '#0f6b6b';
        var tc = m.kind === 'sug' && m.vai ? '#ffffff' : (m.kind === 'sug' ? '#4a5a74' : '#0f6b6b');
        s.push('<circle cx="' + m.cx + '" cy="' + m.cy + '" r="' + g.r.dot + '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="2.2"/>' +
          '<text x="' + m.cx + '" y="' + (m.cy + g.fz.num * 0.35) + '" text-anchor="middle" font-family="Menlo,Consolas,monospace" font-size="' + g.fz.num + '" font-weight="700" fill="' + tc + '">' + m.n + '</text>');
        o.circles.push({ cx: m.cx, cy: m.cy, r: g.r.dot });
      });
      s.push('</g>');
    }
    if (cur) {
      var bx2 = px(cur.x), by2 = py(cur.y), r = g.r.boat, k = r / 22;
      s.push('<g class="boat">' +
        '<circle cx="' + bx2 + '" cy="' + by2 + '" r="' + r + '" fill="#fffdf7" fill-opacity=".55" stroke="#b5246b" stroke-width="2.6"/>' +
        '<g transform="translate(' + bx2 + ' ' + by2 + ') scale(' + k + ')"><path d="M-13 3h26l-5 7h-16z" fill="#14284a"/><path d="M0 -15v18" stroke="#14284a" stroke-width="2"/><path d="M1.5 -13l10 14h-10z" fill="#b5246b"/><path d="M-1.5 -10l-7 11h7z" fill="#fffdf7" stroke="#14284a" stroke-width="1"/></g>' +
        '</g>');
      o.circles.push({ cx: bx2, cy: by2, r: r });
    }
    // text: zone labels (placed by layout()), axis captions, idea tag
    s.push('<g class="labels" font-family="Georgia,\'Iowan Old Style\',serif" fill="#14284a">');
    [5, 4, 3, 2, 1].forEach(function (z) {
      s.push('<text class="zl" data-z="' + z + '" font-size="' + g.fz.zone + '" font-style="italic" font-weight="700" stroke="#fffdf7" stroke-opacity=".85" stroke-width="6" stroke-linejoin="round" paint-order="stroke" x="0" y="0">' + z + ' · ' + esc(VEHICLES[z].curta) + '</text>');
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
  function fitText(el, text, x, yTop, maxW, fz0) {
    var fz = fz0, lines = [text];
    setLines(el, lines, x, yTop, fz);
    if (bboxOf(el).w > maxW) { lines = wrap2(text); setLines(el, lines, x, yTop, fz); }
    while (bboxOf(el).w > maxW && fz > 18) { fz -= 1; setLines(el, lines, x, yTop, fz); }
    return { lines: lines, fz: fz };
  }

  function layout(svg, g, o) {
    var px = pxf(g), py = pyf(g), mx = px(50), my = py(50), b = boxOf(g), pad = g.compact ? 10 : 14;
    var circleRects = (o.circles || []).map(function (c) { return { x: c.cx - c.r - 3, y: c.cy - c.r - 3, w: 2 * c.r + 6, h: 2 * c.r + 6 }; });
    var boxRect = { x: b.x0, y: b.y0, w: b.x1 - b.x0, h: b.y1 - b.y0 };
    var placedLabels = [];
    function quadCands(a1, x1, a2, x2, t1, t2, tm) {
      var xm = (x1 + x2) / 2;
      return [[a1, x1, t1, 0], [a1, x1, t2, 0.5], [a2, x2, t1, 1], [a2, x2, t2, 1.5], [a1, x1, tm, 2], [a2, x2, tm, 2.5], ['middle', xm, t1, 3], ['middle', xm, t2, 3.5], ['middle', xm, tm, 4]];
    }
    // Candidate spots per zone label: [anchor, x, top(h), extraCost]. Inside the zone first;
    // zone 3 may sit just outside its box as a last resort (never on top of a marker).
    var cx3 = (b.x0 + b.x1) / 2;
    var specs = {
      5: { maxW: (mx - g.L) - 2 * pad, c: quadCands('start', g.L + pad, 'end', mx - pad, function () { return g.T + pad; }, function (h) { return my - pad - h; }, function (h) { return (g.T + my) / 2 - h / 2; }) },
      4: { maxW: (g.R - mx) - 2 * pad, c: quadCands('end', g.R - pad, 'start', mx + pad, function () { return g.T + pad; }, function (h) { return my - pad - h; }, function (h) { return (g.T + my) / 2 - h / 2; }) },
      2: { maxW: (mx - g.L) - 2 * pad, c: quadCands('start', g.L + pad, 'end', mx - pad, function (h) { return g.B - pad - h; }, function () { return my + pad; }, function (h) { return (my + g.B) / 2 - h / 2; }) },
      1: { maxW: (g.R - mx) - 2 * pad, c: quadCands('end', g.R - pad, 'start', mx + pad, function (h) { return g.B - pad - h; }, function () { return my + pad; }, function (h) { return (my + g.B) / 2 - h / 2; }) },
      3: { maxW: (b.x1 - b.x0) - 12, c: [['middle', cx3, function () { return b.y0 + 8; }, 0], ['middle', cx3, function (h) { return b.y1 - 8 - h; }, 0.5], ['start', b.x0 + 8, function () { return b.y0 + 8; }, 1], ['end', b.x1 - 8, function () { return b.y0 + 8; }, 1], ['start', b.x0 + 8, function (h) { return b.y1 - 8 - h; }, 1], ['end', b.x1 - 8, function (h) { return b.y1 - 8 - h; }, 1], ['middle', cx3, function (h) { return (b.y0 + b.y1) / 2 - h / 2; }, 2], ['middle', cx3, function (h) { return b.y0 - 6 - h; }, 2000], ['middle', cx3, function () { return b.y1 + 6; }, 2000]] }
    };
    [3, 5, 4, 2, 1].forEach(function (z) {
      var el = svg.querySelector('.zl[data-z="' + z + '"]'); if (!el) return;
      var sp = specs[z];
      var txt = el.textContent;
      el.setAttribute('text-anchor', sp.c[0][0]);
      var fit = fitText(el, txt, sp.c[0][1], 0, sp.maxW, g.fz.zone);
      var best = null;
      function tryFit(f, extra) {
        setLines(el, f.lines, sp.c[0][1], 0, f.fz);
        var h = bboxOf(el).h;
        sp.c.forEach(function (cand) {
          var top = cand[2](h);
          el.setAttribute('text-anchor', cand[0]);
          setLines(el, f.lines, cand[1], top, f.fz);
          var bb = bboxOf(el), cost = cand[3] + extra;
          if (bb.y < g.T + 2 || bb.y + bb.h > g.B - 2 || bb.x < g.L + 2 || bb.x + bb.w > g.R - 2) cost += 1e6;
          circleRects.forEach(function (c) { cost += rectOverlap(inflate(bb, 4), c) * 10; });
          (o.segs || []).forEach(function (sg) { if (segHitsRect(sg, inflate(bb, 2))) cost += 300; });
          if (z !== 3) cost += rectOverlap(inflate(bb, 4), boxRect) * 10;
          placedLabels.forEach(function (pl) { cost += rectOverlap(inflate(bb, 4), pl) * 10; });
          if (!best || cost < best.cost) best = { cost: cost, top: top, anchor: cand[0], x: cand[1], f: f };
        });
      }
      tryFit(fit, 0);
      if (best.cost >= 50 && fit.lines.length > 1) {   // crowded: a smaller one-line label may fit where two lines can't
        var fz1 = fit.fz;
        el.setAttribute('text-anchor', sp.c[0][0]);
        setLines(el, [txt], sp.c[0][1], 0, fz1);
        while (bboxOf(el).w > sp.maxW && fz1 > 18) { fz1 -= 1; setLines(el, [txt], sp.c[0][1], 0, fz1); }
        if (bboxOf(el).w <= sp.maxW) tryFit({ lines: [txt], fz: fz1 }, 20);
      }
      el.setAttribute('text-anchor', best.anchor);
      setLines(el, best.f.lines, best.x, best.top, best.f.fz);
      placedLabels.push(bboxOf(el));
    });
    // idea tag: "Sua ideia" — never overlaps a label, dot, arrow or the boat
    var cur = o.cur, tagG = svg.querySelector('.idea-tag');
    if (!cur || !tagG) return;
    var bx = px(cur.x), by = py(cur.y), r = g.r.boat;
    var rect = document.createElementNS(SVGNS, 'rect');
    var txt2 = document.createElementNS(SVGNS, 'text');
    txt2.setAttribute('font-family', 'Georgia,serif'); txt2.setAttribute('font-style', 'italic'); txt2.setAttribute('font-weight', '700');
    txt2.setAttribute('font-size', g.fz.idea); txt2.setAttribute('fill', '#fffdf7'); txt2.textContent = 'Sua ideia';
    tagG.appendChild(rect); tagG.appendChild(txt2);
    txt2.setAttribute('x', 0); txt2.setAttribute('y', 0);
    var tb = bboxOf(txt2), w = tb.w + 18, h = g.fz.idea + 12;
    var obst = placedLabels.map(function (l) { return inflate(l, 4); }).concat(circleRects);
    var cands = [];
    [r + 8, r + 40, r + 80, r + 130].forEach(function (gap, ring) {
      for (var i = 0; i < 12; i++) {
        var a = [0, 180, 90, 270, 30, 150, 330, 210, 60, 120, 300, 240][i] * Math.PI / 180;
        var ccx = bx + Math.cos(a) * (gap + w / 2), ccy = by - Math.sin(a) * (gap + h / 2);
        cands.push({ x: ccx - w / 2, y: ccy - h / 2, ring: ring, order: i });
      }
    });
    var bestT = null;
    cands.forEach(function (c) {
      var rr = { x: c.x, y: c.y, w: w, h: h };
      if (rr.x < g.L + 3 || rr.x + rr.w > g.R - 3 || rr.y < g.T + 3 || rr.y + rr.h > g.B - 3) return;
      var cost = c.ring * 50 + c.order * 0.1;
      obst.forEach(function (ob) { cost += rectOverlap(rr, ob) * 20; });
      (o.segs || []).forEach(function (sg) { if (segHitsRect(sg, rr)) cost += 400; });
      if (!bestT || cost < bestT.cost) bestT = { cost: cost, c: c };
    });
    if (!bestT) bestT = { c: { x: clamp(bx + r + 8, g.L + 3, g.R - w - 3), y: clamp(by - h / 2, g.T + 3, g.B - h - 3), ring: 0 } };
    var c = bestT.c;
    rect.setAttribute('x', c.x); rect.setAttribute('y', c.y); rect.setAttribute('width', w); rect.setAttribute('height', h);
    rect.setAttribute('rx', 5); rect.setAttribute('fill', '#14284a');
    txt2.setAttribute('x', c.x + 9); txt2.setAttribute('y', c.y + h / 2 + g.fz.idea * 0.34);
    if (c.ring > 0) {
      var cx = c.x + w / 2, cy = c.y + h / 2, d = Math.hypot(cx - bx, cy - by) || 1;
      var line = document.createElementNS(SVGNS, 'line');
      line.setAttribute('x1', bx + (cx - bx) / d * (r + 2)); line.setAttribute('y1', by + (cy - by) / d * (r + 2));
      line.setAttribute('x2', cx); line.setAttribute('y2', cy);
      line.setAttribute('stroke', '#14284a'); line.setAttribute('stroke-width', '1.4');
      tagG.insertBefore(line, rect);
    }
  }

  // ── Render the on-screen chart ────────────────────────────────────────────
  function hostWidth() { var h = $('chart-host'); return h ? h.clientWidth : 0; }
  function renderChart() {
    var host = $('chart-host'); if (!host) return;
    var hw = hostWidth() || 800;
    state.lastHostW = hw;
    var g = geom('screen', hw); state.g = g;
    var o = { idp: 'c', cur: state.cur, tab: state.chartMode, interactive: true, showHist: $('toggle-history') && $('toggle-history').checked, history: lsGet(HISTORY_STORE, []) };
    host.innerHTML = buildSVG(g, o);
    var svg = host.querySelector('svg');
    try { layout(svg, g, o); } catch (e) { /* layout is cosmetic; never break the app */ }
    if (state.chartMode === 'rumo' && state.cur && state.cur.dir) drawHL(svg, g, state.cur.dir, 'sel');
    closePopup(false);
    updateHint();
  }
  function updateHint(extra) {
    var h = $('chart-hint'); if (!h) return;
    if (state.tab === 'rumo' && state.cur && !$('result').hidden) {
      h.textContent = extra ? ('Clique para escolher: ' + extra) : 'Clique no lado da carta para onde você quer ir.';
    } else if (!state.cur) {
      h.textContent = 'Passe o mouse ou toque na carta para ver exemplos de negócios.';
    } else if (state.chartMode === 'rumo' && state.cur.sugs && state.cur.sugs.length) {
      h.textContent = 'Passe o mouse ou toque na carta para ver exemplos. Os números são as sugestões de "Para onde ir?".';
    } else {
      h.textContent = 'Passe o mouse ou toque na carta para ver exemplos. Os números são os pivôs do diagnóstico.';
    }
  }

  // ── Pointer → data coordinates ────────────────────────────────────────────
  function toData(evt) {
    var svg = $('chart-host').querySelector('svg'), g = state.g;
    if (!svg || !g || !svg.getScreenCTM()) return null;
    var pt = new DOMPoint(evt.clientX, evt.clientY).matrixTransform(svg.getScreenCTM().inverse());
    var x = (pt.x - g.L) / (g.R - g.L) * 100, y = (g.B - pt.y) / (g.B - g.T) * 100;
    return { x: x, y: y, inside: x >= 0 && x <= 100 && y >= 0 && y <= 100 };
  }
  function dataToClient(x, y) {
    var svg = $('chart-host').querySelector('svg'), g = state.g;
    var ux = pxf(g)(x), uy = pyf(g)(y);
    var pt = new DOMPoint(ux, uy).matrixTransform(svg.getScreenCTM());
    return { x: pt.x, y: pt.y };
  }

  // ── Example popup (hover / tap / keyboard) ────────────────────────────────
  function nearestExamples(x, y, onlyZone) {
    var g = state.g, sx = (g.R - g.L) / 100, sy = (g.B - g.T) / 100;
    var list = EXAMPLES.filter(function (e) { return !onlyZone || classify(e.x, e.y) === onlyZone; })
      .map(function (e) { return { e: e, d: Math.hypot((e.x - x) * sx, (e.y - y) * sy) }; })
      .sort(function (a, b) { return a.d - b.d; });
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
      c.setAttribute('class', 'ex-dot');
      gEx.appendChild(c);
    });
    requestAnimationFrame(function () { Array.prototype.forEach.call(gEx.children, function (c) { c.classList.add('on'); }); });
  }
  function popupHTML(list, zone, pinned) {
    var h = ['<p class="pop-title">Exemplos perto daqui' + (zone ? ' · veículo ' + zone : '') + '</p><ul class="pop-list">'];
    list.forEach(function (e, i) {
      var v = classify(e.x, e.y), src = sourceById(e.s || 'hormozi_video');
      h.push('<li><button type="button" class="pop-item" aria-expanded="false" aria-controls="pop-d' + i + '"><span class="pop-name">' + esc(e.t) + '</span><span class="pop-plus" aria-hidden="true">+</span></button>' +
        '<div class="pop-detail" id="pop-d' + i + '" hidden><p><b>Veículo ' + v + ' · ' + esc(VEHICLES[v].nome) + '</b></p>' +
        '<p><b>Dificuldade:</b> ' + esc(e.d) + '</p><p><b>Dinheiro:</b> ' + esc(e.m) + '</p>' +
        '<p class="pop-src">Fonte: <a class="src" href="#src-' + esc(src.id) + '">' + esc(src.short) + '</a></p></div></li>');
    });
    h.push('</ul><p class="pop-foot">Exemplos citados no vídeo, em posição ilustrativa. ' + (pinned ? 'Esc ou clique fora fecha.' : 'Clique na carta para fixar.') + '</p>');
    return h.join('');
  }
  function placePopup(clientX, clientY) {
    var pop = $('chart-pop'), wrap = $('chart-wrap');
    var wr = wrap.getBoundingClientRect();
    // Narrow screens: dock the list under the chart instead of covering it.
    var dock = wr.width < 600;
    pop.classList.toggle('docked', dock);
    if (dock) { pop.style.left = ''; pop.style.top = ''; return; }
    pop.style.left = '0px'; pop.style.top = '0px';
    var pw = pop.offsetWidth, ph = pop.offsetHeight;
    var cx = clientX - wr.left, cy = clientY - wr.top;
    var x = cx + 18, y = cy - ph / 2;
    if (x + pw > wr.width - 4) x = cx - pw - 18;               // flip to the left of the cursor
    if (x < 4) {                                              // no room on either side: go below/above
      x = clamp(cx - pw / 2, 4, Math.max(4, wr.width - pw - 4));
      y = (cy + 18 + ph <= wr.height - 4) ? cy + 18 : cy - ph - 18;
    }
    y = clamp(y, 4, Math.max(4, wr.height - ph - 4));
    pop.style.left = Math.round(x) + 'px'; pop.style.top = Math.round(y) + 'px';
  }
  function openPopup(list, zone, clientX, clientY, pinned) {
    var pop = $('chart-pop');
    pop.innerHTML = popupHTML(list, zone, pinned);
    pop.hidden = false;
    pop.classList.toggle('pinned', !!pinned);
    state.pop.open = true; state.pop.pinned = !!pinned;
    placePopup(clientX, clientY);
    drawExDots(list);
  }
  function closePopup(restoreFocus) {
    var pop = $('chart-pop'); if (!pop) return;
    pop.hidden = true; pop.innerHTML = '';
    state.pop.open = false; state.pop.pinned = false;
    drawExDots([]);
    if (restoreFocus && state.pop.returnFocus) { try { state.pop.returnFocus.focus(); } catch (e) {} }
    state.pop.returnFocus = null;
  }
  function inDirMode() { return state.tab === 'rumo' && state.cur && !$('result').hidden; }

  function onChartMove(evt) {
    if (evt.pointerType && evt.pointerType !== 'mouse') return;
    var ev = { clientX: evt.clientX, clientY: evt.clientY };
    if (state.raf) return;
    state.raf = requestAnimationFrame(function () {
      state.raf = 0;
      var d = toData(ev); if (!d) return;
      if (inDirMode()) {
        var dir = d.inside ? dirAt(d.x, d.y) : null;
        var svg = $('chart-host').querySelector('svg');
        drawHL(svg, state.g, state.cur.dir, 'sel');
        if (dir) drawHL(svg, state.g, dir, 'hov', true);
        $('chart-host').style.cursor = dir ? 'pointer' : 'default';
        updateHint(dir ? DIRS[dir].label : '');
        return;
      }
      if (state.pop.pinned) return;
      clearTimeout(state.pop.hideT);
      if (!d.inside) { closePopup(false); return; }
      openPopup(nearestExamples(d.x, d.y), classify(d.x, d.y), ev.clientX, ev.clientY, false);
    });
  }
  function onChartLeave() {
    if (inDirMode()) {
      var svg = $('chart-host').querySelector('svg');
      if (svg) drawHL(svg, state.g, state.cur.dir, 'sel');
      updateHint();
      return;
    }
    if (state.pop.pinned) return;
    clearTimeout(state.pop.hideT);
    state.pop.hideT = setTimeout(function () { if (!state.pop.pinned) closePopup(false); }, 320);
  }
  function onChartClick(evt) {
    if (evt.target && evt.target.closest && evt.target.closest('#chart-pop')) return;
    var d = toData(evt); if (!d || !d.inside) return;
    if (inDirMode()) {
      var dir = dirAt(d.x, d.y);
      if (dir) selectDir(dir); else toast('Esse lado não faz sentido a partir daqui.');
      return;
    }
    state.pop.returnFocus = null;
    openPopup(nearestExamples(d.x, d.y), classify(d.x, d.y), evt.clientX, evt.clientY, true);
  }
  function onZoneKey(evt) {
    var el = evt.target;
    if (!el || !el.classList || !el.classList.contains('zone-hit')) return;
    if (evt.key !== 'Enter' && evt.key !== ' ') return;
    evt.preventDefault();
    var z = parseInt(el.getAttribute('data-z'), 10), c = zoneCenter(z);
    if (inDirMode()) {
      var dir = dirAt(c[0], c[1]);
      if (dir) selectDir(dir); else toast('Esse lado não faz sentido a partir daqui.');
      return;
    }
    var pt = dataToClient(c[0], c[1]);
    state.pop.returnFocus = el;
    openPopup(nearestExamples(c[0], c[1], z), z, pt.x, pt.y, true);
    var first = $('chart-pop').querySelector('.pop-item'); if (first) first.focus();
  }
  function onPopClick(evt) {
    var btn = evt.target.closest('.pop-item');
    if (btn) {
      var det = document.getElementById(btn.getAttribute('aria-controls'));
      var open = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', open ? 'false' : 'true');
      btn.querySelector('.pop-plus').textContent = open ? '+' : '−';
      if (det) det.hidden = open;
      if (!state.pop.pinned) { state.pop.pinned = true; $('chart-pop').classList.add('pinned'); }
    }
  }

  // ── Direction mode (tab "Para onde ir?") ──────────────────────────────────
  function dirAt(x, y) {
    var cur = state.cur, g = state.g; if (!cur || !g) return null;
    var z = classify(x, y);
    if (z === 5 && dirAllowed(cur, 'v5')) return 'v5';
    if (z === 4 && dirAllowed(cur, 'v4')) return 'v4';
    var dx = (x - cur.x) * (g.R - g.L) / 100, dy = (y - cur.y) * (g.B - g.T) / 100;
    if (Math.hypot(dx, dy) < g.r.boat) return null;
    var ang = Math.atan2(dy, dx) * 180 / Math.PI; // up = +90 (data y grows upward)
    if (ang >= 45 && ang <= 135 && dirAllowed(cur, 'up')) return 'up';
    if ((ang > 135 || ang < -135) && dirAllowed(cur, 'left')) return 'left';
    return null;
  }
  function drawHL(svg, g, dir, cls, keep) {
    if (!svg || !g) return;
    var hl = svg.querySelector('.hl'); if (!hl) return;
    if (!keep) while (hl.firstChild) hl.removeChild(hl.firstChild);
    if (!dir || !state.cur) return;
    var el, px = pxf(g), py = pyf(g), bx = px(state.cur.x), by = py(state.cur.y), BIG = 4000;
    if (dir === 'v5' || dir === 'v4') {
      var q = quadRect(g, dir === 'v5' ? 5 : 4);
      el = document.createElementNS(SVGNS, 'rect');
      el.setAttribute('x', q.x); el.setAttribute('y', q.y); el.setAttribute('width', q.w); el.setAttribute('height', q.h);
    } else {
      el = document.createElementNS(SVGNS, 'polygon');
      var pts = dir === 'up' ? [[bx, by], [bx - BIG, by - BIG], [bx + BIG, by - BIG]] : [[bx, by], [bx - BIG, by - BIG], [bx - BIG, by + BIG]];
      el.setAttribute('points', pts.map(function (p) { return p.join(','); }).join(' '));
    }
    el.setAttribute('class', 'hl-' + cls);
    hl.appendChild(el);
  }
  function selectDir(dir) {
    if (!state.cur || !dirAllowed(state.cur, dir)) return;
    state.cur.dir = dir;
    lsSet(CURRENT_SLOT, state.cur);
    renderDirButtons();
    var svg = $('chart-host').querySelector('svg');
    drawHL(svg, state.g, dir, 'sel');
    $('sug-status').textContent = 'Lado escolhido: ' + DIRS[dir].label + '. Preencha o que quiser e clique em "Sugerir negócios parecidos".';
  }
  function renderDirButtons() {
    var box = $('dir-buttons'), cur = state.cur; if (!box) return;
    if (!cur) { box.innerHTML = ''; return; }
    box.innerHTML = DIR_ORDER.filter(function (d) { return dirAllowed(cur, d); }).map(function (d) {
      return '<button type="button" class="dir-btn" data-dir="' + d + '" aria-pressed="' + (cur.dir === d ? 'true' : 'false') + '">' + esc(DIRS[d].label) + '</button>';
    }).join('');
    if (cur.dir && !dirAllowed(cur, cur.dir)) cur.dir = null;
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
    'Vídeo "How To Make More Money Than You Deserve (My 2027 Framework)" (Alex Hormozi). Tese: ganhar mais do que "merece" depende menos de inteligência e esforço e mais do TIPO de negócio (o veículo). Gráfico "Índice do Idiota": eixo horizontal = quão difícil é operar; eixo vertical = quanto dinheiro dá para fazer de forma realista. História de Buffett: um colega mais inteligente e mais trabalhador foi para o aço e ganhou muito menos — por causa do barco.',
    'Veículo 1 — Commodities braçais (difícil, pouco dinheiro): barreira de entrada baixa → concorrência feroz, escala limitada, muito arrasto operacional. Restaurante tradicional, academia de serviço, agência para PME, varejo físico, eventos. Mesmo quem tem sucesso ali ganharia mais aplicando as mesmas habilidades num veículo melhor. Teste: quantos donos de academia de serviço são bilionários? Nenhum (franqueador é outro negócio).',
    'Veículo 2 — Caixa inicial (fácil, pouco dinheiro): mais escala, menos complexidade; uma pessoa com a habilidade certa chega a renda de top 1%, raramente maior. Dropshipping, serviços leves para casa, vending/ATM, wholesale imobiliário, arbitragem de Airbnb, conteúdo de afiliado. Fácil não é ruim: pode ser o veículo certo para gerar caixa, aprender habilidades e juntar capital.',
    'Veículo 3 — Dependente de especialista (médio, médio): dá para ficar rico com RENDA, mas é muito difícil de vender — pouco valor de empresa. Coaching online, implementação de IA, construção, clínicas de reabilitação, cirurgiões, agências enterprise, influenciadores. Margens altas, time pequeno, "você com uma armadura do Homem de Ferro" (mídia/coaching dão alavanca). Viés de sobrevivência. Se depende do fundador, é um "emprego turbinado", não um ativo.',
    'Veículo 4 — Empresas com fosso (difícil, muito dinheiro): barreiras de entrada limitam a concorrência; dá para fazer bilhões mas é muito difícil e demora. Fossos: habilidade, capital, regulação, tempo, efeito de rede. IA de verdade, farmacêutica, manufatura especializada, cannabis, franquias, roll-ups, marketplaces, SaaS, bens de consumo, finanças, bancos, energia/data centers/telecom, cassinos. A dificuldade é vantagem: "se todo mundo pode fazer, todo mundo vai fazer"; prefira competir com 20 do que com 5 milhões.',
    'Veículo 5 — Arbitragem de oferta e demanda (fácil, muito dinheiro): demanda com vento a favor, oferta restrita ou mudança regulatória; janelas de tempo. Med spas (o dinheiro está nas pessoas mais velhas: mude um negócio normal para um público mais velho → 2 a 3x), assessoria de patrimônio, GLP-1, Botox, cuidado de idosos, cobrança, gestão de resíduos, sindicalização imobiliária, limpeza comercial, manutenção de elevadores. Desconto do "parece legal": negócio que soa bem num coquetel atrai todo mundo; o que "não soa legal" tem menos concorrência.',
    'Fechamento: escolha o veículo pelo objetivo — fluxo de caixa, renda alta, valor de empresa (escalável, transferível e defensável) ou bilhões (mercado enorme + fosso). Escolha o barco, depois reme o mais forte possível.',
    'Teste do bilionário: "como é isso quando está no máximo? Quem é o bilionário disso?" — se ninguém escalou ao máximo, desconfie.'
  ].join('\n');
  var CALIB = [
    'CALIBRAÇÃO (use estas âncoras para manter as notas consistentes; ordem trabalho,habilidade,capital,regulacao,operacao,tempo | teto,margem,escala,fosso,ventos,recorrencia,transferivel,concorrencia | parece_legal):',
    'restaurante tradicional: 9,5,6,5,9,4 | 4,2,2,2,3,4,4,9 | 7',
    'dropshipping: 3,3,2,1,3,1 | 4,3,6,1,3,1,4,9 | 6',
    'coaching online: 6,7,2,1,4,4 | 6,9,4,3,5,5,2,8 | 7',
    'SaaS B2B: 4,8,7,3,6,7 | 9,9,9,6,6,9,8,7 | 8',
    'med spa para público 50+: 5,4,4,4,5,3 | 7,8,5,4,9,7,6,5 | 4'
  ].join('\n');
  var SRC_LIST = SOURCES.map(function (s) { return '- ' + s.id + ': ' + s.title + ' — sustenta: ' + s.supports; }).join('\n');
  var RUBRIC_DEFS = RUBRIC.map(function (r) { return '- ' + r.k + ' (' + r.label + '): ' + r.hint; }).join('\n');

  function rubricMessages(ideia, contexto) {
    var sys = [
      'Você é um analista que aplica o framework "Índice do Idiota". Sua tarefa agora é SÓ pontuar uma rúbrica fixa — a posição no gráfico será calculada por uma fórmula, não por você.',
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
    var veh = VEHICLES[cur.v];
    var rubTxt = RUBRIC.map(function (r) { return '- ' + r.k + ' = ' + cur.rubric[r.k].nota + (r.inverse ? ' (conta contra)' : '') + ': ' + cur.rubric[r.k].porque; }).join('\n');
    var sys = [
      'Você é um conselheiro de negócios que aplica o framework "Índice do Idiota" e SOMENTE as fontes listadas. Nunca invente números, estudos, casos ou citações; se algo não está nas fontes, fale como raciocínio, não como fato.',
      KB,
      'FONTES PERMITIDAS (cada item do relatório deve citar UMA delas pelo id):\n' + SRC_LIST,
      'PIVÔS: proponha exatamente 3 maneiras concretas de "subir na carta" para ESTA ideia (ex.: mudar para um público mais velho e com dinheiro; roll-up; franquear; criar recorrência/aderência; aproveitar mudança regulatória/janela; ir para o lado "sem glamour" do mercado; tirar a dependência do fundador; construir um fosso). Para cada pivô dê "deltas": variações inteiras de -4 a +4 nas notas da rúbrica que o pivô causaria (só chaves: ' + RKEYS.join(', ') + '). Seja realista: pivôs que aumentam dinheiro muitas vezes aumentam dificuldade. NÃO escreva número de veículo no nome nem na descrição do pivô — a ferramenta recalcula e mostra o veículo de destino.',
      LANG,
      'Responda APENAS com um objeto JSON neste formato exato (sem markdown):',
      '{"diagnostico":"3 a 4 frases: por que a ideia caiu neste veículo e o que isso significa","por_que":[{"texto":"","fonte":"id"}],"riscos":[{"texto":"","fonte":"id"}],"encaixe":{"texto":"2 frases sobre o encaixe entre o veículo e o objetivo declarado","fonte":"id"},"proximos_passos":[{"texto":"ação concreta para os próximos 30 dias","fonte":"id"}],"pivos":[{"nome":"","tipo":"","descricao":"2 frases","deltas":{"chave":0},"fonte":"id"}],"frase_final":"1 frase de fechamento no espírito de escolher o barco e remar forte"}',
      'Quantidades: por_que 2–4 itens; riscos 2–3; proximos_passos 3–5; pivos exatamente 3.'
    ].join('\n\n');
    var user = [
      'IDEIA: ' + cur.ideia,
      cur.contexto ? 'CONTEXTO: ' + cur.contexto : '',
      'OBJETIVO DECLARADO: ' + GOALS[cur.goal].label + ' (encaixe calculado pela ferramenta: ' + cur.fit + ')',
      'POSIÇÃO CALCULADA PELA FERRAMENTA: dificuldade ' + cur.x + '/100, dinheiro ' + cur.y + '/100 → VEÍCULO ' + cur.v + ' — ' + veh.nome + ' (' + veh.eixo + '). NÃO conteste o veículo; explique-o.',
      'RÚBRICA PONTUADA:\n' + rubTxt,
      'Desconto do "parece legal": nota ' + cur.legal.nota + ' (' + cur.legal.porque + ') → ajuste de ' + cur.legalAdj + ' no eixo do dinheiro.',
      'Teste do bilionário: ' + cur.bil.veredito + (cur.bil.exemplo ? ' — ' + cur.bil.exemplo : '') + '. ' + cur.bil.comentario
    ].filter(Boolean).join('\n\n');
    return [{ role: 'system', content: sys }, { role: 'user', content: user }];
  }

  function sugMessages(cur, dir, comp, hist, obj) {
    var rubNotes = RKEYS.map(function (k) { return k + '=' + cur.rubric[k].nota; }).join(', ');
    var sys = [
      'Você sugere negócios PARECIDOS com a ideia de uma pessoa, usando o framework "Índice do Idiota". A ferramenta calcula a posição de cada sugestão com uma fórmula fixa a partir das notas que você der — e julga se ela vai na direção pedida pelo número calculado, não pela sua opinião. Então pontue com honestidade.',
      KB,
      'RÚBRICA (as MESMAS 14 notas inteiras 0–10 da avaliação):\n' + RUBRIC_DEFS,
      'Também "parece_legal" (0–10).',
      CALIB,
      'FONTES PERMITIDAS (cite UMA por sugestão, pelo id):\n' + SOURCE_IDS.join(', '),
      'REGRAS: sugira exatamente 5 negócios reais e concretos no Brasil. Cada um deve reaproveitar as competências e o histórico da pessoa (diga qual) e servir aos objetivos dela (diga como). Eles devem tender a mover a posição na direção pedida, mas NÃO force: se um parecido não move, as notas devem mostrar isso. Não escreva número de veículo nos textos.',
      LANG,
      'Responda APENAS com um objeto JSON neste formato exato (sem markdown):',
      '{"sugestoes":[{"nome":"até 6 palavras","descricao":"1 a 2 frases: o que vende e para quem","porque_parecido":"1 frase: qual competência ou parte do histórico reaproveita","como_serve":"1 frase: como serve aos objetivos","rubrica":{"trabalho":0,"habilidade":0,"capital":0,"regulacao":0,"operacao":0,"tempo":0,"teto":0,"margem":0,"escala":0,"fosso":0,"ventos":0,"recorrencia":0,"transferivel":0,"concorrencia":0},"parece_legal":0,"fonte":"id"}]}'
    ].join('\n\n');
    var user = [
      'IDEIA ATUAL: ' + cur.ideia,
      cur.contexto ? 'CONTEXTO: ' + cur.contexto : '',
      'POSIÇÃO ATUAL (calculada): dificuldade ' + cur.x + '/100, dinheiro ' + cur.y + '/100, veículo ' + cur.v + ' — ' + VEHICLES[cur.v].nome + '.',
      'NOTAS ATUAIS: ' + rubNotes + '; parece_legal=' + cur.legal.nota,
      'DIREÇÃO PEDIDA: ' + DIRS[dir].text + '.',
      'COMPETÊNCIAS: ' + (comp || 'não informado'),
      'HISTÓRICO: ' + (hist || 'não informado'),
      'OBJETIVOS: ' + (obj || GOALS[cur.goal].obj)
    ].filter(Boolean).join('\n\n');
    return [{ role: 'system', content: sys }, { role: 'user', content: user }];
  }

  // ── Normalize the report JSON ─────────────────────────────────────────────
  function normItems(arr, max) {
    if (!Array.isArray(arr)) return [];
    return arr.map(function (it) {
      if (typeof it === 'string') return { texto: clean(it), fonte: 'hormozi_video' };
      var f = clean(it && it.fonte);
      return { texto: clean(it && it.texto), fonte: SOURCE_IDS.indexOf(f) !== -1 ? f : 'hormozi_video' };
    }).filter(function (i) { return i.texto; }).slice(0, max);
  }
  function stripVehicleNo(s) { return String(s || '').replace(/\s*[\(\[]\s*ve[íi]culo\s*\d[^\)\]]*[\)\]]/ig, '').trim(); }
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
      var pos = position(applyDeltas(cur.rubric, deltas), cur.legal.nota);
      var f = clean(p && p.fonte);
      return { nome: stripVehicleNo(clean(p && p.nome)) || 'Pivô', tipo: clean(p && p.tipo), descricao: stripVehicleNo(clean(p && p.descricao)), deltas: deltas, x: pos.x, y: pos.y, v: classify(pos.x, pos.y), fonte: SOURCE_IDS.indexOf(f) !== -1 ? f : 'hormozi_video' };
    });
    return r;
  }
  function normSugs(j, cur, dir) {
    var arr = j && Array.isArray(j.sugestoes) ? j.sugestoes : (Array.isArray(j) ? j : []);
    var out = arr.slice(0, 5).map(function (s) {
      if (!s || typeof s !== 'object' || !s.rubrica) return null;
      var rub = normRubric(s.rubrica);
      var lg = clamp(Math.round(num(s.parece_legal && typeof s.parece_legal === 'object' ? s.parece_legal.nota : s.parece_legal, 5)), 0, 10);
      var pos = position(rub, lg), v = classify(pos.x, pos.y);
      var dx = pos.x - cur.x, dy = pos.y - cur.y, f = clean(s.fonte);
      return {
        nome: stripVehicleNo(clean(s.nome)) || 'Negócio sugerido', descricao: stripVehicleNo(clean(s.descricao)),
        porque: stripVehicleNo(clean(s.porque_parecido)), serve: stripVehicleNo(clean(s.como_serve)),
        rubric: rub, legal: lg, legalAdj: pos.legalAdj, x: pos.x, y: pos.y, v: v, dx: dx, dy: dy,
        vai: judge(dir, dx, dy, v), score: dirScore(dir, dx, dy),
        fonte: SOURCE_IDS.indexOf(f) !== -1 ? f : 'hormozi_video'
      };
    }).filter(Boolean);
    out.sort(function (a, b) { return (b.vai - a.vai) || (b.score - a.score); });
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
      h.push('<tr><td>' + esc(r.label) + (r.inverse ? ' <span class="hint">(conta contra)</span>' : '') + '</td><td class="score">' + n + '/10</td><td class="why">' + (esc(cur.rubric[r.k].porque) || '—') + '</td></tr>');
    });
    h.push('<tr><td>Desconto do "parece legal"</td><td class="score">' + cur.legal.nota + '/10 → ' + (cur.legalAdj > 0 ? '+' : '') + cur.legalAdj + '</td><td class="why">' + (esc(cur.legal.porque) || '—') + '</td></tr>');
    h.push('</tbody></table></div>');
    return h.join('');
  }
  function headerHTML(cur) {
    var veh = VEHICLES[cur.v];
    return '<h3 class="rep-title">' + esc(cur.titulo) + '</h3>' +
      '<dl class="fix-strip"><div><dt>Dificuldade</dt><dd>' + cur.x + '/100</dd></div><div><dt>Dinheiro</dt><dd>' + cur.y + '/100</dd></div>' +
      '<div><dt>Veículo</dt><dd class="v">' + cur.v + ' · ' + esc(veh.curta) + '</dd></div><div><dt>Objetivo</dt><dd>' + esc(GOALS[cur.goal] ? GOALS[cur.goal].label : '—') + '</dd></div></dl>' +
      '<div class="vehicle-plate"><div class="vnum">' + cur.v + '</div><div><p class="vname">' + esc(veh.nome) + ' <span class="hint">· ' + esc(veh.eixo) + '</span></p><p class="vdesc">' + esc(veh.resumo) + '</p></div></div>';
  }
  function renderReport() {
    var cur = state.cur, body = $('report-body');
    if (!cur) { body.innerHTML = ''; return; }
    var h = [headerHTML(cur)];
    if (cur.kind === 'sugestao') {
      h.push('<div class="callout"><b>Sugestão salva.</b> Ela ainda não tem o relatório completo. <button type="button" class="btn-secondary" id="sug-full-btn">Avaliar a fundo</button></div>');
      h.push(section('A rúbrica (notas da IA, posição pela régua da ferramenta)', rubricTable(cur), false));
      body.innerHTML = h.join('');
      var fb = $('sug-full-btn'); if (fb) fb.addEventListener('click', function () { evaluateIdea(cur.ideia); });
      return;
    }
    var rep = cur.report;
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
          var dx = p.x - cur.x, dy = p.y - cur.y;
          pv.push('<div class="pivot"><span class="ptag">' + (i + 1) + (p.tipo ? ' · ' + esc(p.tipo.replace(/[_-]+/g, ' ')) : '') + '</span><h5>' + esc(p.nome) + '</h5><p>' + esc(p.descricao) + '</p>' +
            '<p class="pmove">' + signed(dy) + ' dinheiro · ' + signed(dx) + ' dificuldade · veículo ' + cur.v + ' → <b>' + p.v + '</b> ' + srcChip(p.fonte) + '</p></div>');
        });
        pv.push('</div>');
        h.push(section('Rotas de pivô (os números na carta)', pv.join(''), true));
      }
      h.push(section('Por que este veículo', listHTML(rep.por_que), false));
      h.push(section('Riscos do barco', listHTML(rep.riscos, 'risk'), false));
      if (cur.parecidos && cur.parecidos.length) h.push('<p class="hint">Parecida com: ' + esc(cur.parecidos.join(' · ')) + '</p>');
    }
    h.push(section('A rúbrica completa (notas da IA, posição pela régua da ferramenta)', rubricTable(cur), false));
    if (rep && rep.frase) h.push('<p class="closing">' + esc(rep.frase) + '</p>');
    h.push('<p class="disclaimer">Modelo: ' + esc(cur.model || '') + ' · ' + esc(new Date(cur.ts).toLocaleString('pt-BR')) + '. Estimativa educacional — não é recomendação de investimento.</p>');
    body.innerHTML = h.join('');
  }

  function renderSugs() {
    var cur = state.cur, list = $('sug-list'); if (!list) return;
    if (!cur || !cur.sugs || !cur.sugs.length) { list.innerHTML = ''; return; }
    list.innerHTML = '<p class="sug-head">Rumo: <b>' + esc(DIRS[cur.sugDir] ? DIRS[cur.sugDir].label : '') + '</b> · os números são os mesmos da carta. A posição vem de uma rúbrica rápida; "Avaliar a fundo" refaz a avaliação completa e ela pode mudar.</p>' + cur.sugs.map(function (s, i) {
      return '<article class="sug-card ' + (s.vai ? 'vai' : 'nao') + '">' +
        '<header><span class="sug-num">' + (i + 1) + '</span><h5>' + esc(s.nome) + '</h5><span class="badge ' + (s.vai ? 'b-vai' : 'b-nao') + '">' + (s.vai ? 'vai na direção' : 'não vai') + '</span></header>' +
        '<p class="sug-move">' + signed(s.dy) + ' dinheiro · ' + signed(s.dx) + ' dificuldade · veículo ' + cur.v + ' → ' + s.v + '</p>' +
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
    if (t === 'rumo') { renderDirButtons(); prefillObj(); renderSugs(); }
    renderChart();
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
    closePopup(false);
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
      var v = classify(pos.x, pos.y);
      var b = j.bilionario || {};
      var ver = String(clean(b.veredito) || 'raro').toLowerCase().replace('ã', 'a');
      if (['sim', 'raro', 'nao'].indexOf(ver) === -1) ver = 'raro';
      var cur = {
        id: 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        ts: Date.now(), model: model, ideia: ideia, contexto: contexto, goal: goal,
        titulo: clean(j.titulo) || ideia.slice(0, 40), resumo: clean(j.resumo),
        rubric: rub, legal: legal, legalAdj: pos.legalAdj, x: pos.x, y: pos.y, v: v, fit: goalFit(goal, v),
        parecidos: (Array.isArray(j.parecidos) ? j.parecidos.map(clean).filter(Boolean).slice(0, 3) : []),
        bil: { veredito: ver, exemplo: clean(b.exemplo), comentario: clean(b.comentario) },
        pivots: [], report: null, sugs: [], dir: null, sugDir: null
      };
      state.cur = cur;
      state.tab = 'diag'; state.chartMode = 'diag';
      renderChart();
      $('loading-title').textContent = 'Veículo ' + v + ' — ' + VEHICLES[v].nome + '. Traçando as rotas…';
      $('loading-sub').textContent = 'A IA está escrevendo o diagnóstico e os pivôs com base nas fontes.';
      return callJSON(reportMessages(cur), 9000).then(function (rep) {
        cur.report = normReport(rep || {}, cur);
        lsSet(CURRENT_SLOT, cur);
        renderReport(); showState('done'); setTab('diag');
        toast('Carta pronta — veículo ' + v + '.');
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
    }).then(function () { setBusy(false); });
  }
  function evaluateIdea(text) {
    $('in-ideia').value = String(text || '').slice(0, 2500); updateCount();
    var c = [($('in-contexto').value || '').trim(), ($('in-comp') && $('in-comp').value.trim()) ? 'Competências: ' + $('in-comp').value.trim() : '', ($('in-hist') && $('in-hist').value.trim()) ? 'Histórico: ' + $('in-hist').value.trim() : ''].filter(Boolean);
    var seen = {}; c = c.filter(function (x) { if (seen[x]) return false; seen[x] = 1; return true; });
    $('in-contexto').value = c.join(' · ').slice(0, 400);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    generate();
  }

  // ── "Para onde você quer ir?" — similar businesses ───────────────────────
  function prefillObj() {
    var el = $('in-obj'); if (!el) return;
    if (state.objAuto || !el.value.trim()) { el.value = GOALS[state.goal] ? GOALS[state.goal].obj : ''; state.objAuto = true; }
  }
  function suggest() {
    var cur = state.cur;
    if (!cur || state.sugBusy) return;
    if (!cur.dir) { toast('Escolha primeiro para que lado quer ir (botões ou clique na carta).'); return; }
    if (!activeKey()) { toast('Conecte sua chave da OpenRouter (ícone da chave, no topo).'); return; }
    stopMic();
    var dir = cur.dir;
    var comp = ($('in-comp').value || '').trim(), hist = ($('in-hist').value || '').trim(), obj = ($('in-obj').value || '').trim();
    state.sugBusy = true;
    var btn = $('sug-btn'); btn.disabled = true; btn.classList.add('is-busy');
    $('sug-status').textContent = 'Procurando negócios parecidos que vão para ' + DIRS[dir].short + '…';
    callJSON(sugMessages(cur, dir, comp, hist, obj), 7000).then(function (j) {
      var list = normSugs(j, cur, dir);
      if (!list.length) throw new Error('O modelo não devolveu sugestões válidas.');
      cur.sugs = list; cur.sugDir = dir;
      lsSet(CURRENT_SLOT, cur);
      renderSugs(); renderChart();
      var vai = list.filter(function (s) { return s.vai; }).length;
      $('sug-status').textContent = vai + ' de ' + list.length + ' vão na direção, pela régua da ferramenta. Quer outro lado? Escolha e peça de novo.';
    }).catch(function (e) {
      var msg = e && e.message === 'NO_KEY' ? 'Conecte sua chave da OpenRouter.' : (e && e.message) || 'Erro ao sugerir.';
      $('sug-status').textContent = 'Não deu para sugerir agora: ' + msg + ' Tente de novo.';
    }).then(function () { state.sugBusy = false; btn.disabled = false; btn.classList.remove('is-busy'); });
  }
  function onSugClick(e) {
    var ev = e.target.closest('.sug-eval'), sv = e.target.closest('.sug-save');
    var cur = state.cur; if (!cur || !cur.sugs) return;
    if (ev) {
      var s = cur.sugs[parseInt(ev.getAttribute('data-i'), 10)]; if (!s) return;
      evaluateIdea(s.nome + ': ' + s.descricao);
    } else if (sv) {
      var s2 = cur.sugs[parseInt(sv.getAttribute('data-i'), 10)]; if (!s2) return;
      var entry = {
        id: 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), kind: 'sugestao', ts: Date.now(), model: cur.model,
        ideia: s2.nome + ': ' + s2.descricao, contexto: cur.contexto, goal: cur.goal, titulo: s2.nome, resumo: s2.descricao,
        rubric: s2.rubric, legal: { nota: s2.legal, porque: '' }, legalAdj: s2.legalAdj, x: s2.x, y: s2.y, v: s2.v, fit: goalFit(cur.goal, s2.v),
        parecidos: [], bil: null, pivots: [], report: null, sugs: [], dir: null, sugDir: null, origem: cur.titulo
      };
      pushHistory(entry);
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
    var hist = lsGet(HISTORY_STORE, []), el = $('lib-list');
    if (!hist.length) { el.innerHTML = '<p class="lib-empty">Nenhuma ideia salva ainda. Gere uma carta e use "Salvar no histórico".</p>'; return; }
    el.innerHTML = hist.map(function (h, i) {
      return '<div class="lib-item"><button class="lib-open" data-id="' + esc(h.id) + '"><b>' + (i + 1) + '. ' + esc(h.titulo) + '</b><span>Veículo ' + h.v + ' · D ' + h.x + ' · $ ' + h.y + (h.kind === 'sugestao' ? ' · sugestão' : '') + ' · ' + esc(new Date(h.ts).toLocaleDateString('pt-BR')) + '</span></button><button class="btn-icon lib-del" data-id="' + esc(h.id) + '" aria-label="Apagar ' + esc(h.titulo) + '" title="Apagar">&times;</button></div>';
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
    state.cur = it;
    if (!it.sugs) it.sugs = [];
    $('in-ideia').value = it.ideia || ''; $('in-contexto').value = it.contexto || '';
    setGoal(it.goal || 'renda'); updateCount();
    lsSet(CURRENT_SLOT, it);
    renderReport(); showState('done'); setTab('diag');
  }

  // ── Exports ───────────────────────────────────────────────────────────────
  function fname(ext) { return 'veiculo-ia-' + String(state.cur ? state.cur.titulo : 'carta').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) + '.' + ext; }
  function cut(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
  function exportPNG() {
    var cur = state.cur; if (!cur) return;
    var off = document.createElement('div');
    off.style.cssText = 'position:fixed;left:-12000px;top:0;width:1000px;visibility:hidden;';
    document.body.appendChild(off);
    var g = geom('export'), useSugs = state.chartMode === 'rumo' && cur.sugs && cur.sugs.length;
    var o = { idp: 'e', cur: cur, tab: useSugs ? 'rumo' : 'diag', interactive: false, showHist: false };
    off.innerHTML = buildSVG(g, o);
    var svgEl = off.querySelector('svg');
    try { layout(svgEl, g, o); } catch (e) {}
    if (useSugs && cur.dir) drawHL(svgEl, g, cur.dir, 'sel');
    // inline the highlight style (CSS classes do not travel into the PNG)
    Array.prototype.forEach.call(svgEl.querySelectorAll('.hl-sel'), function (el) { el.setAttribute('fill', '#b5246b'); el.setAttribute('fill-opacity', '0.08'); el.setAttribute('stroke', '#b5246b'); el.setAttribute('stroke-opacity', '0.5'); el.setAttribute('stroke-width', '2'); });
    var CWd = 1520, CHd = Math.round(CWd * g.H / g.W);
    svgEl.setAttribute('x', 40); svgEl.setAttribute('y', 150); svgEl.setAttribute('width', CWd); svgEl.setAttribute('height', CHd);
    var inner = new XMLSerializer().serializeToString(svgEl);
    off.remove();
    var veh = VEHICLES[cur.v], y0 = 150 + CHd + 54;
    var lines = [];
    if (useSugs) {
      lines.push({ t: 'Rumo: ' + DIRS[cur.sugDir].label, c: '#14284a' });
      cur.sugs.forEach(function (s, i) { lines.push({ t: (i + 1) + ' · ' + cut(s.nome, 48) + ' — ' + (s.vai ? 'vai' : 'não vai') + ' · ' + signed(s.dy) + ' dinheiro · ' + signed(s.dx) + ' dificuldade', c: s.vai ? '#0f6b6b' : '#4a5a74' }); });
    } else {
      (cur.pivots || []).forEach(function (p, i) { lines.push({ t: (i + 1) + ' · ' + cut(p.nome, 58) + ' → veículo ' + p.v + ' · ' + signed(p.y - cur.y) + ' dinheiro · ' + signed(p.x - cur.x) + ' dificuldade', c: '#0f6b6b' }); });
    }
    var H = y0 + 52 + lines.length * 34 + 60, W = 1600;
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">' +
      '<rect width="' + W + '" height="' + H + '" fill="#f4efe2"/>' +
      '<text x="40" y="58" font-family="Menlo,Consolas,monospace" font-size="20" letter-spacing="3" fill="#8e1752">VEÍCULO IA · ÍNDICE DO IDIOTA</text>' +
      '<text x="40" y="112" font-family="Georgia,serif" font-style="italic" font-weight="700" font-size="46" fill="#14284a">' + esc(cut(cur.titulo, 58)) + '</text>' +
      inner +
      '<text x="40" y="' + y0 + '" font-family="Georgia,serif" font-style="italic" font-weight="700" font-size="34" fill="#b5246b">Veículo ' + cur.v + ' · ' + esc(veh.nome) + '</text>' +
      '<text x="40" y="' + (y0 + 44) + '" font-family="Menlo,Consolas,monospace" font-size="22" fill="#14284a">Dificuldade ' + cur.x + '/100 · Dinheiro ' + cur.y + '/100 · Objetivo: ' + esc(GOALS[cur.goal].label) + '</text>' +
      lines.map(function (l, i) { return '<text x="40" y="' + (y0 + 92 + i * 34) + '" font-family="Menlo,Consolas,monospace" font-size="20" fill="' + l.c + '">' + esc(l.t) + '</text>'; }).join('') +
      '<text x="40" y="' + (H - 24) + '" font-family="Menlo,Consolas,monospace" font-size="16" fill="#4a5a74">Base: Índice do Idiota, de Alex Hormozi (vídeo, 2026) · ferramenta educacional da Comunidade Maestros da IA · veiculoia.maestrosdaia.com</text>' +
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
      'Veículo ' + c.v + ' — ' + VEHICLES[c.v].nome + ' (' + VEHICLES[c.v].eixo + ')',
      'Objetivo: ' + GOALS[c.goal].label + ' — encaixe ' + c.fit, ''];
    if (c.report) {
      if (c.report.diagnostico) L1.push('DIAGNÓSTICO', c.report.diagnostico, '');
      if (c.bil) L1.push('TESTE DO BILIONÁRIO: ' + c.bil.veredito + (c.bil.exemplo ? ' — ' + c.bil.exemplo : '') + '. ' + c.bil.comentario, '');
      L1.push('PRÓXIMOS PASSOS'); c.report.passos.forEach(function (r, i) { L1.push((i + 1) + ') ' + r.texto + ' [' + sourceById(r.fonte).short + ']'); }); L1.push('');
      L1.push('RISCOS'); c.report.riscos.forEach(function (r) { L1.push('- ' + r.texto + ' [' + sourceById(r.fonte).short + ']'); }); L1.push('');
    }
    if (c.pivots && c.pivots.length) { L1.push('PIVÔS'); c.pivots.forEach(function (p, i) { L1.push((i + 1) + ') ' + p.nome + ': ' + p.descricao + ' → veículo ' + p.v + ' (' + signed(p.y - c.y) + ' dinheiro, ' + signed(p.x - c.x) + ' dificuldade)'); }); L1.push(''); }
    if (c.sugs && c.sugs.length) { L1.push('NEGÓCIOS PARECIDOS (' + (DIRS[c.sugDir] ? DIRS[c.sugDir].label : '') + ')'); c.sugs.forEach(function (s, i) { L1.push((i + 1) + ') ' + s.nome + ' — ' + (s.vai ? 'vai na direção' : 'não vai') + ' (' + signed(s.dy) + ' dinheiro, ' + signed(s.dx) + ' dificuldade): ' + s.descricao); }); L1.push(''); }
    L1.push('RÚBRICA'); RUBRIC.forEach(function (r) { L1.push('- ' + r.label + ': ' + c.rubric[r.k].nota + '/10' + (c.rubric[r.k].porque ? ' — ' + c.rubric[r.k].porque : '')); });
    L1.push('', 'Base: Índice do Idiota, de Alex Hormozi (vídeo, 2026). Ferramenta educacional — Comunidade Maestros da IA.');
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
    $('sug-list').addEventListener('click', onSugClick);
    $('dir-buttons').addEventListener('click', function (e) { var b = e.target.closest('.dir-btn'); if (b) selectDir(b.getAttribute('data-dir')); });
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
    // chart interaction (delegated: the SVG is re-rendered often)
    var host = $('chart-host');
    host.addEventListener('pointermove', onChartMove);
    host.addEventListener('pointerleave', onChartLeave);
    host.addEventListener('click', onChartClick);
    host.addEventListener('keydown', onZoneKey);
    var pop = $('chart-pop');
    pop.addEventListener('click', onPopClick);
    pop.addEventListener('pointerenter', function () { clearTimeout(state.pop.hideT); if (state.pop.open && !state.pop.pinned) { state.pop.pinned = true; pop.classList.add('pinned'); } });
    document.addEventListener('pointerdown', function (e) {
      if (!state.pop.open) return;
      if (e.target.closest && (e.target.closest('#chart-pop') || e.target.closest('#chart-host'))) return;
      closePopup(false);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (state.pop.open) { closePopup(true); return; }
        $('lib-modal').style.display = 'none';
      }
    });
    // source chips open the Origens box and scroll to the source
    document.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('a.src');
      if (!a) return;
      var id = (a.getAttribute('href') || '').replace('#', ''), el = document.getElementById(id);
      if (!el) return;
      e.preventDefault();
      var box = $('origens-box'); if (box) box.open = true;
      closePopup(false);
      setTimeout(function () { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.add('flash'); setTimeout(function () { el.classList.remove('flash'); }, 1600); }, 30);
    });
    $('library-btn').addEventListener('click', function () { renderLibrary(); $('lib-modal').style.display = 'flex'; });
    $('lib-close').addEventListener('click', function () { $('lib-modal').style.display = 'none'; });
    $('lib-modal').querySelector('.modal-overlay').addEventListener('click', function () { $('lib-modal').style.display = 'none'; });
    $('lib-list').addEventListener('click', onLibClick);
    var lo = $('logout-btn');
    if (lo) lo.addEventListener('click', function () { // COR-062
      stopMic(); closePopup(false);
      var em = $('gate-email'), ph = $('gate-phone'), er = $('gate-error');
      if (em) em.value = ''; if (ph) ph.value = ''; if (er) { er.textContent = ''; er.style.display = 'none'; }
    });
    var rt = 0;
    window.addEventListener('resize', function () {
      clearTimeout(rt);
      rt = setTimeout(function () { var w = hostWidth(); if (w && Math.abs(w - state.lastHostW) > 40) renderChart(); }, 160);
    });
    var last = lsGet(CURRENT_SLOT, null);
    if (last && last.rubric && last.x != null) loadEntry(last);
    else { showState('done'); renderChart(); }
    updateCount();
    prefillObj();
  }

  return { init: init, _calc: { position: position, classify: classify, normRubric: normRubric, judge: judge, dirAllowed: dirAllowed, EXAMPLES: EXAMPLES, SOURCES: SOURCES, normSugs: normSugs, geom: geom, buildSVG: buildSVG, layout: layout } };
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
