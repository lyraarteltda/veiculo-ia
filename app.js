/**
 * Veículo IA — Main Application Logic
 *
 * Positions a business idea on Alex Hormozi's "Idiot Index" chart (x = difficulty
 * to operate, y = money potential) into one of 5 vehicles.
 *
 *   1. The member's own model (BYOK via OpenRouter) scores a FIXED 14-criterion
 *      rubric (0–10 each, with a one-line reason) + a "sounds cool" factor and the
 *      "who is the billionaire in this?" test.
 *   2. THIS TOOL computes the position deterministically from the rubric (fixed
 *      weights) and classifies the vehicle by zone — the same rubric always lands
 *      on the same point.
 *   3. A second call writes the report (diagnosis, risks, goal fit, next steps and
 *      3 pivots with rubric deltas) grounded ONLY in the video + its original
 *      literature. Pivots are re-scored by the tool and drawn as routes on the chart.
 *
 * Everything renders/exports client-side. The only backend is the shared n8n
 * gate/webhooks. No Supabase in the browser.
 */
const App = (function () {
  'use strict';

  // ── storage slot names (COR-025: never `*KEY = '<hyphenated literal>'`) ──
  var HISTORY_STORE = 'veiculo_ia_history';
  var CURRENT_SLOT = 'veiculo_ia_current';
  var HISTORY_MAX = 30;

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
    1: { n: 1, nome: 'Commodities braçais', mar: 'Recife das Commodities', curto: 'Difícil de operar · pouco dinheiro',
      desc: 'Barreira de entrada baixa, então qualquer um entra: concorrência feroz, escala limitada e muito arrasto operacional. Exemplos do vídeo: restaurante tradicional, academia de serviço, agência para pequenas empresas, varejo físico, organização de eventos.' },
    2: { n: 2, nome: 'Caixa inicial', mar: 'Baía do Caixa Inicial', curto: 'Fácil · pouco dinheiro',
      desc: 'Bons negócios de partida: mais escala e menos complexidade. Uma pessoa com a habilidade certa chega a uma renda de top 1%, mas raramente fica muito maior. Exemplos: dropshipping, serviços leves para casa, máquinas de venda/ATM, wholesale imobiliário, arbitragem de Airbnb, conteúdo de afiliado.' },
    3: { n: 3, nome: 'Dependente de especialista', mar: 'Banco de Areia do Especialista', curto: 'Médio · médio',
      desc: 'Dá para enriquecer com RENDA, mas o negócio depende de você e é difícil de vender — pouco valor de empresa. Exemplos: coaching online, implementação de IA, construção, clínicas de reabilitação, cirurgiões, agências enterprise, influenciadores.' },
    4: { n: 4, nome: 'Empresas com fosso', mar: 'Mar Aberto dos Fossos', curto: 'Difícil · muito dinheiro',
      desc: 'Barreiras de entrada limitam a concorrência: dá para fazer bilhões, mas é muito difícil. Fossos de habilidade, capital, regulação, tempo e efeito de rede. Exemplos: IA de verdade, farmacêutica, manufatura especializada, cannabis, franquias, roll-ups, marketplaces, SaaS, bens de consumo, finanças, bancos, energia/data centers/telecom, cassinos.' },
    5: { n: 5, nome: 'Arbitragem de oferta e demanda', mar: 'Corrente da Arbitragem', curto: 'Fácil · muito dinheiro',
      desc: 'A "terra prometida": demanda forte com concorrência relativamente limitada — vento a favor, oferta restrita ou mudança regulatória. Muitas vezes é uma janela de tempo. Exemplos: med spas, assessoria de patrimônio, GLP-1, Botox, cuidado de idosos, cobrança, gestão de resíduos, sindicalização imobiliária, limpeza comercial, manutenção de elevadores.' }
  };

  var GOALS = {
    fluxo: { label: 'Fluxo de caixa', good: [2, 5], partial: [3, 1], poor: [4] },
    renda: { label: 'Renda alta', good: [3, 5], partial: [2, 4], poor: [1] },
    empresa: { label: 'Valor de empresa', good: [4, 5], partial: [1], poor: [2, 3] },
    bilhoes: { label: 'Bilhões', good: [4], partial: [5], poor: [1, 2, 3] }
  };

  // ── Original literature. `honest` = what is (and is not) claimed. ──
  var SOURCES = [
    { id: 'hormozi_video', short: 'Hormozi 2027', title: 'Alex Hormozi — "How To Make More Money Than You Deserve (My 2027 Framework)" (YouTube)', supports: 'O gráfico do Índice do Idiota, os 5 veículos e seus exemplos, o teste do bilionário ("como é isso no máximo?"), o desconto do "parece legal" e o fechamento: escolha o veículo pelo objetivo, depois reme forte.', honest: 'Framework de um empresário, baseado no que ele viu em mais de 10 mil negócios — não é pesquisa acadêmica.', url: 'https://youtu.be/pwZJcLZc3_Y' },
    { id: 'buffett_1985', short: 'Buffett 1985', title: 'Warren Buffett — Carta aos acionistas da Berkshire Hathaway, 1985', supports: '"Um bom histórico gerencial é muito mais função do barco em que você entra do que de quão bem você rema" — a ideia central de que o veículo importa mais que o esforço.', honest: 'Hormozi conta a história do colega que foi para o aço de memória; a frase do barco está na carta de 1985.', url: 'https://www.berkshirehathaway.com/letters/1985.html' },
    { id: 'buffett_1980', short: 'Buffett 1980', title: 'Warren Buffett — Carta aos acionistas da Berkshire Hathaway, 1980', supports: 'Quando uma gestão brilhante encontra um negócio de economia ruim, é a reputação do negócio que fica intacta — por isso o veículo 1 limita até os melhores operadores.', honest: 'A frase célebre ("...it is the reputation of the business that remains intact") é de Buffett; a aplicação a pequenos negócios é nossa leitura.', url: 'https://www.berkshirehathaway.com/letters/1980.html' },
    { id: 'buffett_fosso', short: 'Fosso econômico', title: 'Warren Buffett — "fosso econômico" (Fortune, 1999; carta de 2007)', supports: 'A vantagem competitiva durável que protege os lucros — a base do veículo 4.', honest: 'Hormozi lista os fossos (habilidade, capital, regulação, tempo, rede); o conceito de "moat" é de Buffett.', url: 'https://www.berkshirehathaway.com/letters/2007ltr.pdf' },
    { id: 'porter', short: 'Porter 1979', title: 'Michael E. Porter — "How Competitive Forces Shape Strategy" (HBR, 1979) e Competitive Strategy (1980)', supports: 'Barreiras de entrada, rivalidade e a estrutura da indústria decidem a lucratividade — explica por que o veículo 1 sofre e o veículo 4 lucra.', honest: 'Porter não fala em "Índice do Idiota"; a ponte entre as cinco forças e o gráfico é interpretação.', url: 'https://hbr.org/1979/03/how-competitive-forces-shape-strategy' },
    { id: 'thiel', short: 'Thiel 2014', title: 'Peter Thiel — Zero to One (2014)', supports: '"Competição é para perdedores": prefira mercados com poucos concorrentes — o mesmo raciocínio do "prefiro competir com 20 do que com 5 milhões".', honest: 'Thiel defende monopólios criativos; Hormozi chega a uma conclusão parecida pela via das barreiras.', url: 'https://en.wikipedia.org/wiki/Zero_to_One' },
    { id: 'warrillow', short: 'Warrillow 2010', title: 'John Warrillow — Built to Sell (2010)', supports: 'Negócios que dependem do fundador não são vendáveis — o limite do veículo 3 (renda alta, pouco valor de empresa).', honest: 'Warrillow escreve sobre como tornar uma empresa de serviço vendável; não usa o gráfico.', url: 'https://en.wikipedia.org/wiki/Built_to_Sell' },
    { id: 'kirzner', short: 'Kirzner 1973', title: 'Israel M. Kirzner — Competition and Entrepreneurship (1973)', supports: 'O empreendedor como alguém alerta a desequilíbrios e oportunidades de arbitragem — a lógica do veículo 5.', honest: 'Teoria econômica austríaca; a ligação com med spas e GLP-1 é aplicação nossa.', url: 'https://en.wikipedia.org/wiki/Israel_Kirzner' },
    { id: 'bcg', short: 'BCG 1970', title: 'Bruce Henderson / BCG — Matriz crescimento-participação (1970)', supports: 'O formato de matriz 2×2 para classificar negócios por dois eixos — o gráfico de Hormozi ecoa esse formato.', honest: 'Os eixos são diferentes (BCG: crescimento × participação de mercado); só a forma é herdada.', url: 'https://www.bcg.com/about/overview/our-history/growth-share-matrix' },
    { id: 'musk', short: 'Musk', title: 'Elon Musk — o "idiot index" original', supports: 'O nome: para Musk, idiot index é o custo de uma peça dividido pelo custo da matéria-prima. Hormozi reaproveita o nome para outra ideia.', honest: 'São conceitos diferentes; só o rótulo foi emprestado.', url: 'https://en.wikipedia.org/wiki/Elon_Musk' },
    { id: 'hormozi_offers', short: '$100M Offers', title: 'Alex Hormozi — $100M Offers (2021), "multidão faminta"', supports: 'Escolha de mercado: dor intensa, poder de compra, fácil de alcançar e crescendo — por isso "mude para um público mais velho e com dinheiro" é um pivô recorrente.', honest: 'Livro do próprio Hormozi, anterior ao vídeo.', url: 'https://www.acquisition.com/books' }
  ];
  var SOURCE_IDS = SOURCES.map(function (s) { return s.id; });
  function sourceById(id) { for (var i = 0; i < SOURCES.length; i++) if (SOURCES[i].id === id) return SOURCES[i]; return SOURCES[0]; }

  // ── Soundings: examples cited in the video, placed by the same rubric ──
  var SOUNDINGS = [
    { t: 'restaurante', x: 66, y: 27 }, { t: 'academia', x: 61, y: 31 }, { t: 'varejo', x: 70, y: 22 }, { t: 'eventos', x: 76, y: 30 },
    { t: 'dropshipping', x: 23, y: 30 }, { t: 'lavagem', x: 29, y: 23 }, { t: 'vending/ATM', x: 15, y: 20 }, { t: 'Airbnb', x: 33, y: 38 },
    { t: 'coaching', x: 42, y: 47 }, { t: 'implementação de IA', x: 47, y: 52 }, { t: 'influenciador', x: 40, y: 57 }, { t: 'cirurgião', x: 56, y: 59 },
    { t: 'SaaS', x: 58, y: 74 }, { t: 'franquia', x: 69, y: 70 }, { t: 'marketplace', x: 78, y: 86 }, { t: 'farmacêutica', x: 89, y: 84 }, { t: 'banco', x: 86, y: 76 },
    { t: 'med spa', x: 43, y: 65 }, { t: 'assessoria de patrimônio', x: 30, y: 76 }, { t: 'limpeza comercial', x: 27, y: 66 }, { t: 'elevadores', x: 37, y: 84 }, { t: 'cobrança', x: 18, y: 68 }
  ];

  var state = { cur: null, wired: false, busy: false, rec: null, recording: false, goal: 'renda' };

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
    clearTimeout(t._tm); t._tm = setTimeout(function () { t.classList.remove('show'); }, 2400);
  }
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }

  // ── Deterministic positioning ─────────────────────────────────────────────
  function normRubric(r) {
    var out = {};
    RKEYS.forEach(function (k) {
      var it = r && r[k];
      var nota = (it && typeof it === 'object') ? it.nota : it;
      out[k] = { nota: clamp(Math.round(num(nota, 5)), 0, 10), porque: clean(it && it.porque) };
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

  // ── Chart (SVG) ───────────────────────────────────────────────────────────
  var CW = 1000, CH = 720, L = 92, R = 962, T = 34, B = 636;
  function px(x) { return L + (x / 100) * (R - L); }
  function py(y) { return B - (y / 100) * (B - T); }

  function chartSVG(opts) {
    opts = opts || {};
    var cur = opts.cur, hist = opts.history || [], showHist = opts.showHistory !== false;
    var o = [];
    o.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + CW + ' ' + CH + '" class="chart-svg" role="img" aria-label="Carta do Índice do Idiota: dificuldade de operar no eixo horizontal, potencial de dinheiro no eixo vertical">');
    o.push('<defs>' +
      '<pattern id="hatch" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="10" stroke="#a8946a" stroke-width="1.2" opacity=".45"/></pattern>' +
      '<marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#0f6b6b"/></marker>' +
      '</defs>');
    o.push('<rect x="0" y="0" width="' + CW + '" height="' + CH + '" fill="#fffdf7"/>');
    // zones
    var mx = px(50), my = py(50);
    o.push('<rect x="' + L + '" y="' + my + '" width="' + (mx - L) + '" height="' + (B - my) + '" fill="#d6e6ec"/>'); // 2
    o.push('<rect x="' + mx + '" y="' + my + '" width="' + (R - mx) + '" height="' + (B - my) + '" fill="#e8d9b0"/>'); // 1
    o.push('<rect x="' + mx + '" y="' + my + '" width="' + (R - mx) + '" height="' + (B - my) + '" fill="url(#hatch)"/>');
    o.push('<rect x="' + L + '" y="' + T + '" width="' + (mx - L) + '" height="' + (my - T) + '" fill="#b5d9d3"/>'); // 5
    o.push('<rect x="' + mx + '" y="' + T + '" width="' + (R - mx) + '" height="' + (my - T) + '" fill="#9fc3d2"/>'); // 4
    // depth contours (decorative)
    o.push('<g fill="none" stroke="#14284a" stroke-width="1" stroke-dasharray="3 5" opacity=".28">' +
      '<path d="M' + L + ' 120 C 250 100, 380 150, 520 110 S 800 70, ' + R + ' 96"/>' +
      '<path d="M' + L + ' 210 C 230 190, 420 240, 560 200 S 820 170, ' + R + ' 186"/>' +
      '<path d="M' + L + ' 470 C 200 450, 330 500, 470 470"/>' +
      '<path d="M' + L + ' 560 C 220 540, 340 590, 470 556"/>' +
      '</g>');
    // zone 3 sandbar
    var z3x = px(38), z3y = py(62), z3w = px(64) - px(38), z3h = py(36) - py(62);
    o.push('<rect x="' + z3x + '" y="' + z3y + '" width="' + z3w + '" height="' + z3h + '" rx="26" fill="#f4efe2" stroke="#14284a" stroke-width="1.6" stroke-dasharray="7 5"/>');
    // grid + ticks
    o.push('<g stroke="#14284a" stroke-width=".6" opacity=".18">');
    for (var g = 10; g < 100; g += 10) {
      o.push('<line x1="' + px(g) + '" y1="' + T + '" x2="' + px(g) + '" y2="' + B + '"/>');
      o.push('<line x1="' + L + '" y1="' + py(g) + '" x2="' + R + '" y2="' + py(g) + '"/>');
    }
    o.push('</g>');
    o.push('<line x1="' + mx + '" y1="' + T + '" x2="' + mx + '" y2="' + B + '" stroke="#14284a" stroke-width="1.4" opacity=".55"/>');
    o.push('<line x1="' + L + '" y1="' + my + '" x2="' + R + '" y2="' + my + '" stroke="#14284a" stroke-width="1.4" opacity=".55"/>');
    // neatline (alternating chart border)
    o.push('<rect x="' + L + '" y="' + T + '" width="' + (R - L) + '" height="' + (B - T) + '" fill="none" stroke="#14284a" stroke-width="2"/>');
    o.push('<rect x="' + (L - 7) + '" y="' + (T - 7) + '" width="' + (R - L + 14) + '" height="' + (B - T + 14) + '" fill="none" stroke="#14284a" stroke-width="5" stroke-dasharray="29 29"/>');
    o.push('<rect x="' + (L - 9.5) + '" y="' + (T - 9.5) + '" width="' + (R - L + 19) + '" height="' + (B - T + 19) + '" fill="none" stroke="#14284a" stroke-width="1"/>');
    // tick labels
    o.push('<g font-family="Menlo,Consolas,monospace" font-size="13" fill="#4a5a74">');
    for (var t = 0; t <= 100; t += 20) {
      o.push('<text x="' + px(t) + '" y="' + (B + 30) + '" text-anchor="middle">' + t + '</text>');
      o.push('<text x="' + (L - 18) + '" y="' + (py(t) + 4) + '" text-anchor="end">' + t + '</text>');
    }
    o.push('</g>');
    // axis titles
    o.push('<text x="' + ((L + R) / 2) + '" y="' + (CH - 12) + '" text-anchor="middle" font-family="Georgia,serif" font-style="italic" font-size="21" fill="#14284a">Dificuldade de operar →</text>');
    o.push('<text transform="translate(26 ' + ((T + B) / 2) + ') rotate(-90)" text-anchor="middle" font-family="Georgia,serif" font-style="italic" font-size="21" fill="#14284a">Potencial de dinheiro →</text>');
    // zone labels
    function zl(x, y, n, line2, anchor) {
      var a = anchor || 'start';
      return '<g font-family="Georgia,serif" fill="#14284a">' +
        '<text x="' + x + '" y="' + y + '" text-anchor="' + a + '" font-size="21" font-style="italic" font-weight="700">' + n + ' · ' + esc(VEHICLES[n].nome) + '</text>' +
        '<text x="' + x + '" y="' + (y + 21) + '" text-anchor="' + a + '" font-size="14.5" font-style="italic" fill="#2e4366">' + esc(line2) + '</text></g>';
    }
    o.push(zl(L + 16, T + 30, 5, VEHICLES[5].mar + ' — fácil, muito dinheiro'));
    o.push(zl(R - 16, T + 30, 4, VEHICLES[4].mar + ' — difícil, muito dinheiro', 'end'));
    o.push(zl(L + 16, B - 34, 2, VEHICLES[2].mar + ' — fácil, pouco dinheiro'));
    o.push(zl(R - 16, B - 34, 1, VEHICLES[1].mar + ' — difícil, pouco dinheiro', 'end'));
    o.push('<text x="' + (z3x + z3w / 2) + '" y="' + (z3y + z3h - 30) + '" text-anchor="middle" font-family="Georgia,serif" font-style="italic" font-weight="700" font-size="18" fill="#14284a">3 · Dependente de especialista</text>');
    o.push('<text x="' + (z3x + z3w / 2) + '" y="' + (z3y + z3h - 12) + '" text-anchor="middle" font-family="Georgia,serif" font-style="italic" font-size="13.5" fill="#2e4366">' + esc(VEHICLES[3].mar) + ' — médio, médio</text>');
    // compass rose (bottom-left corner of zone 2)
    var cx = L + 52, cy = my + 72;
    o.push('<g transform="translate(' + cx + ' ' + cy + ')" opacity=".7"><circle r="30" fill="none" stroke="#14284a" stroke-width="1"/><path d="M0 -36L5 0L0 36L-5 0z" fill="#14284a"/><path d="M-36 0L0 -5L36 0L0 5z" fill="#b5246b"/><circle r="3" fill="#fffdf7" stroke="#14284a"/><text y="-40" text-anchor="middle" font-family="Georgia,serif" font-style="italic" font-size="12" fill="#14284a">N</text></g>');
    // soundings
    if (opts.soundings !== false) {
      o.push('<g font-family="Menlo,Consolas,monospace" font-size="12" fill="#4a5a74">');
      SOUNDINGS.forEach(function (s) {
        o.push('<circle cx="' + px(s.x) + '" cy="' + py(s.y) + '" r="2.4" fill="#4a5a74"/><text x="' + (px(s.x) + 6) + '" y="' + (py(s.y) + 4) + '">' + esc(s.t) + '</text>');
      });
      o.push('</g>');
    }
    // history buoys
    if (showHist && hist.length) {
      hist.forEach(function (h, i) {
        if (cur && h.id === cur.id) return;
        var hx = px(h.x), hy = py(h.y);
        o.push('<g><title>' + esc((i + 1) + '. ' + h.titulo + ' — veículo ' + h.v) + '</title><circle cx="' + hx + '" cy="' + hy + '" r="12" fill="#fffdf7" stroke="#2e4366" stroke-width="2.4"/><text x="' + hx + '" y="' + (hy + 4.5) + '" text-anchor="middle" font-family="Menlo,Consolas,monospace" font-size="12" font-weight="700" fill="#14284a">' + (i + 1) + '</text></g>');
      });
    }
    // pivots
    if (cur && cur.pivots && cur.pivots.length) {
      cur.pivots.forEach(function (p, i) {
        var x1 = px(cur.x), y1 = py(cur.y), x2 = px(p.x), y2 = py(p.y);
        var d = Math.hypot(x2 - x1, y2 - y1);
        if (d < 4) return;
        var ux = (x2 - x1) / d, uy = (y2 - y1) / d;
        o.push('<line x1="' + (x1 + ux * 22) + '" y1="' + (y1 + uy * 22) + '" x2="' + (x2 - ux * 15) + '" y2="' + (y2 - uy * 15) + '" stroke="#0f6b6b" stroke-width="2.4" stroke-dasharray="8 6" marker-end="url(#arrow)"/>');
        o.push('<circle cx="' + x2 + '" cy="' + y2 + '" r="13" fill="#e3f1ee" stroke="#0f6b6b" stroke-width="2.2"/><text x="' + x2 + '" y="' + (y2 + 4.5) + '" text-anchor="middle" font-family="Menlo,Consolas,monospace" font-size="12" font-weight="700" fill="#0f6b6b">P' + (i + 1) + '</text>');
      });
    }
    // current boat
    if (cur) {
      var bx = px(cur.x), by = py(cur.y);
      o.push('<g>' +
        '<circle cx="' + bx + '" cy="' + by + '" r="22" fill="none" stroke="#b5246b" stroke-width="2.4"/>' +
        '<line x1="' + (bx - 30) + '" y1="' + by + '" x2="' + (bx + 30) + '" y2="' + by + '" stroke="#b5246b" stroke-width="1.4"/>' +
        '<line x1="' + bx + '" y1="' + (by - 30) + '" x2="' + bx + '" y2="' + (by + 30) + '" stroke="#b5246b" stroke-width="1.4"/>' +
        '<g transform="translate(' + bx + ' ' + by + ')"><path d="M-13 3h26l-5 7h-16z" fill="#14284a"/><path d="M0 -15v18" stroke="#14284a" stroke-width="2"/><path d="M1.5 -13l10 14h-10z" fill="#b5246b"/><path d="M-1.5 -10l-7 11h7z" fill="#fffdf7" stroke="#14284a" stroke-width="1"/></g>' +
        '</g>');
      var lab = cur.titulo.length > 34 ? cur.titulo.slice(0, 33) + '…' : cur.titulo;
      var lw = Math.max(150, lab.length * 9.4 + 24);
      var lx = bx + 32, ly = by - 44;
      if (lx + lw > R) lx = bx - 32 - lw;
      if (ly < T + 4) ly = by + 26;
      o.push('<g><rect x="' + lx + '" y="' + ly + '" width="' + lw + '" height="40" fill="#14284a"/>' +
        '<text x="' + (lx + 12) + '" y="' + (ly + 17) + '" font-family="Menlo,Consolas,monospace" font-size="11" fill="#f4c9dc" letter-spacing="1">SUA IDEIA · D ' + cur.x + ' · $ ' + cur.y + '</text>' +
        '<text x="' + (lx + 12) + '" y="' + (ly + 33) + '" font-family="Georgia,serif" font-style="italic" font-size="15" fill="#fffdf7">' + esc(lab) + '</text></g>');
    }
    o.push('</svg>');
    return o.join('');
  }

  function renderChart() {
    var hist = lsGet(HISTORY_STORE, []);
    var showH = $('toggle-history') ? $('toggle-history').checked : true;
    $('chart-host').innerHTML = '<div class="chart-scroll">' + chartSVG({ cur: state.cur, history: hist, showHistory: showH }) + '</div>';
    var sc = $('chart-host').querySelector('.chart-scroll');
    if (sc && state.cur && sc.scrollWidth > sc.clientWidth) { sc.scrollLeft = Math.max(0, (px(state.cur.x) / CW) * sc.scrollWidth - sc.clientWidth / 2); }
    var fs = $('fix-strip');
    if (state.cur) {
      fs.hidden = false;
      $('fx-x').textContent = state.cur.x + ' / 100';
      $('fx-y').textContent = state.cur.y + ' / 100';
      $('fx-v').textContent = state.cur.v + ' · ' + VEHICLES[state.cur.v].nome;
      $('fx-g').textContent = GOALS[state.cur.goal] ? GOALS[state.cur.goal].label : '—';
    } else { fs.hidden = true; }
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
    'Vídeo de Alex Hormozi "How To Make More Money Than You Deserve (My 2027 Framework)". Tese: ganhar mais do que "merece" depende menos de inteligência e esforço e mais do TIPO de negócio (o veículo). Ele agrupa negócios num gráfico "Índice do Idiota": eixo horizontal = quão difícil é operar; eixo vertical = quanto dinheiro dá para fazer de forma realista. História de Buffett: um colega mais inteligente e mais trabalhador foi para o aço e ganhou muito menos — por causa do barco.',
    'Veículo 1 — Commodities braçais (difícil, pouco dinheiro): barreira de entrada baixa → concorrência feroz, escala limitada, muito arrasto operacional. Restaurante tradicional, academia de serviço, agência para PME, varejo físico, eventos. Mesmo quem tem sucesso ali ganharia mais aplicando as mesmas habilidades num veículo melhor. Teste: quantos donos de academia de serviço são bilionários? Nenhum (franqueador é outro negócio).',
    'Veículo 2 — Caixa inicial (fácil, pouco dinheiro): mais escala, menos complexidade; uma pessoa com a habilidade certa chega a renda de top 1%, raramente maior. Dropshipping, serviços leves para casa (lavagem, pintura de deck, cortar grama), vending/ATM, wholesale imobiliário, arbitragem de Airbnb, conteúdo de afiliado. Fácil não é ruim: pode ser o veículo certo para gerar caixa, aprender habilidades e juntar capital.',
    'Veículo 3 — Dependente de especialista (médio, médio): dá para ficar rico com RENDA, mas é muito difícil de vender — pouco valor de empresa. Coaching online, implementação de IA, construção, clínicas de reabilitação, cirurgiões, agências enterprise, oportunidades de negócio, influenciadores/marcas de personalidade. Margens altas, time pequeno, "você com uma armadura do Homem de Ferro" (mídia/coaching dão alavanca). Viés de sobrevivência (quantos Joe Rogan existem?). Se depende do fundador, é um "emprego turbinado", não um ativo.',
    'Veículo 4 — Empresas com fosso (difícil, muito dinheiro): barreiras de entrada limitam a concorrência; dá para fazer bilhões mas é muito difícil e demora (composição leva tempo). Fossos: habilidade, capital, regulação/aprovação do governo, tempo, efeito de rede. IA de verdade (não "wrapper"), farmacêutica, manufatura especializada (aeroespacial, chips), cannabis, franquias (unidade com economia forte e modelo que não depende de talento), roll-ups (juntar 20 encanadores numa empresa), marketplaces, SaaS (fosso erodindo com IA), bens de consumo (marca, cadeia de suprimentos, dinheiro), finanças, bancos, energia/data centers/telecom, cassinos. A dificuldade é vantagem: "se todo mundo pode fazer, todo mundo vai fazer"; prefira competir com 20 do que com 5 milhões.',
    'Veículo 5 — Arbitragem de oferta e demanda (fácil, muito dinheiro): demanda com vento a favor, oferta restrita ou mudança regulatória; janelas de tempo. Med spas (o dinheiro está nas pessoas mais velhas: pegue um negócio normal e mude para um público mais velho → 2 a 3x), assessoria de patrimônio (aderente, compõe sozinha), GLP-1, Botox, cuidado de idosos/casas de repouso, cobrança, gestão de resíduos, sindicalização imobiliária (alavancagem do fundo), limpeza comercial (aderente, bons múltiplos), manutenção de elevadores. Desconto do "parece legal": negócio que soa bem num coquetel atrai todo mundo; o que "não soa legal" tem menos concorrência. Pergunta-chave: quanto de parte difícil existe comparado a quantas pessoas tentam superá-la?',
    'Fechamento: escolha o veículo pelo objetivo — fluxo de caixa, renda alta, valor de empresa (precisa ser escalável, transferível e defensável) ou bilhões (mercado enorme + fosso). 60 horas por semana num restaurante ou num software custam o mesmo esforço; só um vira empresa de bilhão. Escolha o barco, depois reme o mais forte possível.',
    'Teste do bilionário: "como é isso quando está no máximo? Quem é o bilionário disso?" — se ninguém escalou ao máximo, desconfie.'
  ].join('\n');

  var SRC_LIST = SOURCES.map(function (s) { return '- ' + s.id + ': ' + s.title + ' — sustenta: ' + s.supports; }).join('\n');

  function rubricMessages(ideia, contexto) {
    var defs = RUBRIC.map(function (r) { return '- ' + r.k + ' (' + r.label + '): ' + r.hint; }).join('\n');
    var sys = [
      'Você é um analista que aplica o framework "Índice do Idiota" de Alex Hormozi. Sua tarefa agora é SÓ pontuar uma rúbrica fixa — a posição no gráfico será calculada por uma fórmula, não por você.',
      KB,
      'RÚBRICA (nota inteira 0–10 para cada critério, com "porque" de no máximo 22 palavras, específico para a ideia):\n' + defs,
      'Também: "parece_legal" (0–10): quão "legal/glamoroso" o negócio soa num coquetel (10 = todo mundo quer fazer; 0 = ninguém quer dizer que faz).',
      'CALIBRAÇÃO (use estas âncoras para manter as notas consistentes; ordem trabalho,habilidade,capital,regulacao,operacao,tempo | teto,margem,escala,fosso,ventos,recorrencia,transferivel,concorrencia | parece_legal):',
      'restaurante tradicional: 9,5,6,5,9,4 | 4,2,2,2,3,4,4,9 | 7',
      'dropshipping: 3,3,2,1,3,1 | 4,3,6,1,3,1,4,9 | 6',
      'coaching online: 6,7,2,1,4,4 | 6,9,4,3,5,5,2,8 | 7',
      'SaaS B2B: 4,8,7,3,6,7 | 9,9,9,6,6,9,8,7 | 8',
      'med spa para público 50+: 5,4,4,4,5,3 | 7,8,5,4,9,7,6,5 | 4',
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
      'Você é um conselheiro de negócios que aplica o framework "Índice do Idiota" de Alex Hormozi e SOMENTE as fontes listadas. Nunca invente números, estudos, casos ou citações; se algo não está nas fontes, fale como raciocínio, não como fato.',
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
      'POSIÇÃO CALCULADA PELA FERRAMENTA: dificuldade ' + cur.x + '/100, dinheiro ' + cur.y + '/100 → VEÍCULO ' + cur.v + ' — ' + veh.nome + ' (' + veh.curto + '). NÃO conteste o veículo; explique-o.',
      'RÚBRICA PONTUADA:\n' + rubTxt,
      'Desconto do "parece legal": nota ' + cur.legal.nota + ' (' + cur.legal.porque + ') → ajuste de ' + cur.legalAdj + ' no eixo do dinheiro.',
      'Teste do bilionário: ' + cur.bil.veredito + (cur.bil.exemplo ? ' — ' + cur.bil.exemplo : '') + '. ' + cur.bil.comentario
    ].filter(Boolean).join('\n\n');
    return [{ role: 'system', content: sys }, { role: 'user', content: user }];
  }

  // ── Normalize the report JSON ─────────────────────────────────────────────
  function normItems(arr, min, max) {
    if (!Array.isArray(arr)) return [];
    return arr.map(function (it) {
      if (typeof it === 'string') return { texto: clean(it), fonte: 'hormozi_video' };
      var f = clean(it && it.fonte);
      return { texto: clean(it && it.texto), fonte: SOURCE_IDS.indexOf(f) !== -1 ? f : 'hormozi_video' };
    }).filter(function (i) { return i.texto; }).slice(0, max);
  }
  function normReport(rep, cur) {
    var r = {
      diagnostico: clean(rep.diagnostico),
      por_que: normItems(rep.por_que, 2, 4),
      riscos: normItems(rep.riscos, 2, 3),
      encaixe: normItems([rep.encaixe || {}], 1, 1)[0] || { texto: '', fonte: 'hormozi_video' },
      passos: normItems(rep.proximos_passos, 3, 5),
      frase: clean(rep.frase_final)
    };
    var piv = Array.isArray(rep.pivos) ? rep.pivos.slice(0, 3) : [];
    cur.pivots = piv.map(function (p) {
      var deltas = {};
      if (p && p.deltas && typeof p.deltas === 'object') {
        Object.keys(p.deltas).forEach(function (k) { if (RKEYS.indexOf(k) !== -1) deltas[k] = clamp(Math.round(num(p.deltas[k], 0)), -4, 4); });
      }
      var r2 = applyDeltas(cur.rubric, deltas);
      var pos = position(r2, cur.legal.nota);
      var f = clean(p && p.fonte);
      return { nome: (clean(p && p.nome) || 'Pivô').replace(/\s*[\(\[]\s*ve[íi]culo\s*\d[^\)\]]*[\)\]]/ig, '').trim(), tipo: clean(p && p.tipo), descricao: clean(p && p.descricao), deltas: deltas, x: pos.x, y: pos.y, v: classify(pos.x, pos.y), fonte: SOURCE_IDS.indexOf(f) !== -1 ? f : 'hormozi_video' };
    });
    return r;
  }

  // ── Report rendering ──────────────────────────────────────────────────────
  function srcChip(id) { var s = sourceById(id); return '<a class="src" href="#src-' + esc(s.id) + '" title="' + esc(s.title) + '">' + esc(s.short) + '</a>'; }
  function listHTML(items, cls) {
    if (!items.length) return '<p class="hint">—</p>';
    return '<ul class="insight-list ' + (cls || '') + '">' + items.map(function (i) { return '<li>' + esc(i.texto) + ' ' + srcChip(i.fonte) + '</li>'; }).join('') + '</ul>';
  }
  function rubricTable(cur) {
    var h = ['<div class="rubric-wrap"><table class="rubric"><thead><tr><th>Critério</th><th>Nota</th><th>Por quê</th></tr></thead><tbody>'];
    h.push('<tr class="axis-row"><td colspan="3">Eixo da dificuldade → ' + cur.x + ' / 100</td></tr>');
    RUBRIC.forEach(function (r, idx) {
      if (idx === 6) h.push('<tr class="axis-row"><td colspan="3">Eixo do dinheiro → ' + cur.y + ' / 100</td></tr>');
      var n = cur.rubric[r.k].nota;
      h.push('<tr><td>' + esc(r.label) + (r.inverse ? ' <span class="hint">(conta contra)</span>' : '') + '</td><td class="score">' + n + '/10<span class="bar' + (r.inverse ? ' inv' : '') + '"><i style="width:' + (n * 10) + '%"></i></span></td><td class="why">' + esc(cur.rubric[r.k].porque) + '</td></tr>');
    });
    h.push('<tr><td>Desconto do "parece legal"</td><td class="score">' + cur.legal.nota + '/10 → ' + (cur.legalAdj > 0 ? '+' : '') + cur.legalAdj + '</td><td class="why">' + esc(cur.legal.porque) + '</td></tr>');
    h.push('</tbody></table></div>');
    return h.join('');
  }
  function renderReport() {
    var cur = state.cur, body = $('report-body');
    if (!cur) { $('report').hidden = true; return; }
    var veh = VEHICLES[cur.v];
    var h = [];
    h.push('<p class="panel-kicker">Relatório de navegação</p>');
    h.push('<h3>' + esc(cur.titulo) + '</h3>');
    h.push('<p>' + esc(cur.resumo || cur.ideia) + '</p>');
    h.push('<div class="vehicle-plate"><div class="vnum">' + cur.v + '</div><div><p class="vname">' + esc(veh.nome) + ' <span class="hint">· ' + esc(veh.curto) + '</span></p><p class="vdesc">' + esc(veh.desc) + '</p></div></div>');
    if (cur.report && cur.report.diagnostico) { h.push('<h4>Diagnóstico</h4><p>' + esc(cur.report.diagnostico) + '</p>'); }
    if (cur.parecidos && cur.parecidos.length) h.push('<p><b>Parecida com:</b> ' + esc(cur.parecidos.join(' · ')) + ' ' + srcChip('hormozi_video') + '</p>');

    var bil = cur.bil;
    var bilTxt = bil.veredito === 'sim' ? 'Sim — existe quem escalou isso ao máximo' : (bil.veredito === 'raro' ? 'Raro — há poucos exemplos' : (bil.exemplo ? 'Não neste formato — quem chegou lá fez outro negócio' : 'Não — ninguém escalou isso a bilhões'));
    h.push('<h4>Teste do bilionário</h4><div class="callout"><b>"Quem é o bilionário disso?"</b> ' + esc(bilTxt) + (bil.exemplo ? ': <b>' + esc(bil.exemplo) + '</b>' : '') + '. ' + esc(bil.comentario) + ' ' + srcChip('hormozi_video') + '</div>');

    var fitLabel = { bom: 'encaixe bom', parcial: 'encaixe parcial', ruim: 'encaixe ruim' }[cur.fit];
    h.push('<h4>Seu objetivo: ' + esc(GOALS[cur.goal].label) + ' <span class="fit-badge fit-' + cur.fit + '">' + fitLabel + '</span></h4>');
    if (cur.report && cur.report.encaixe && cur.report.encaixe.texto) h.push('<p>' + esc(cur.report.encaixe.texto) + ' ' + srcChip(cur.report.encaixe.fonte) + '</p>');

    if (cur.report) {
      h.push('<h4>Por que este veículo</h4>' + listHTML(cur.report.por_que));
      h.push('<h4>Riscos do barco</h4>' + listHTML(cur.report.riscos, 'risk'));
      h.push('<h4>Próximos passos (30 dias)</h4>' + listHTML(cur.report.passos, 'steps'));
    }
    if (cur.pivots && cur.pivots.length) {
      h.push('<h4>Rotas de pivô — como subir na carta</h4><div class="pivots">');
      cur.pivots.forEach(function (p, i) {
        var dx = p.x - cur.x, dy = p.y - cur.y;
        h.push('<div class="pivot"><span class="ptag">P' + (i + 1) + (p.tipo ? ' · ' + esc(p.tipo) : '') + '</span><h5>' + esc(p.nome) + '</h5><p>' + esc(p.descricao) + '</p>' +
          '<div class="pmove">Dificuldade ' + cur.x + ' → ' + p.x + ' (' + (dx >= 0 ? '+' : '') + dx + ') · Dinheiro ' + cur.y + ' → ' + p.y + ' (' + (dy >= 0 ? '+' : '') + dy + ')<br>Veículo ' + cur.v + ' → <b>' + p.v + ' · ' + esc(VEHICLES[p.v].nome) + '</b> ' + srcChip(p.fonte) + '</div></div>');
      });
      h.push('</div>');
    }
    h.push('<h4>A rúbrica (notas da IA, posição calculada pela régua da ferramenta)</h4>' + rubricTable(cur));
    if (cur.report && cur.report.frase) h.push('<p class="closing">' + esc(cur.report.frase) + '</p>');
    h.push('<p class="disclaimer">Modelo: ' + esc(cur.model || '') + ' · ' + esc(new Date(cur.ts).toLocaleString('pt-BR')) + '. Estimativa educacional — não é recomendação de investimento.</p>');
    body.innerHTML = h.join('');
    $('report').hidden = false;
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
    $('empty-state').hidden = which !== 'empty';
    $('loading-state').hidden = which !== 'loading';
    $('error-state').hidden = which !== 'error';
    if (which === 'error') $('error-text').textContent = msg || 'Algo deu errado.';
    $('stage-toolbar').hidden = !state.cur || which === 'loading';
  }
  function setBusy(b) {
    state.busy = b;
    var btn = $('generate-btn');
    btn.disabled = b; btn.classList.toggle('is-busy', b);
  }

  // ── Generate ──────────────────────────────────────────────────────────────
  function generate() {
    if (state.busy) return;
    var ideia = ($('in-ideia').value || '').trim();
    var contexto = ($('in-contexto').value || '').trim();
    if (ideia.length < 12) { toast('Descreva a ideia com um pouco mais de detalhe.'); $('in-ideia').focus(); return; }
    if (!activeKey()) { toast('Conecte sua chave da OpenRouter (ícone da chave, no topo).'); var mk = $('manage-keys-btn'); if (mk) mk.click(); return; }
    stopMic();
    setBusy(true);
    $('report').hidden = true;
    $('loading-title').textContent = 'Tirando as sondagens…';
    $('loading-sub').textContent = 'A IA está pontuando os 14 critérios da rúbrica.';
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
        pivots: [], report: null
      };
      state.cur = cur;
      renderChart();
      $('tb-title').textContent = cur.titulo;
      $('loading-title').textContent = 'Veículo ' + v + ' — ' + VEHICLES[v].nome + '. Traçando as rotas…';
      $('loading-sub').textContent = 'A IA está escrevendo o relatório e os pivôs com base nas fontes.';
      return callJSON(reportMessages(cur), 9000).then(function (rep) {
        cur.report = normReport(rep || {}, cur);
        lsSet(CURRENT_SLOT, cur);
        renderChart(); renderReport();
        showState('done');
        toast('Carta pronta — veículo ' + v + '.');
        var rp = $('stage-toolbar'); if (rp && rp.scrollIntoView && window.innerWidth < 1000) rp.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, function (e) {
        // rubric is valid — keep the chart, surface the report error honestly
        lsSet(CURRENT_SLOT, cur);
        renderReport();
        showState('error', 'A posição foi calculada, mas o relatório falhou: ' + (e && e.message ? e.message : 'erro desconhecido') + ' Clique em "Tentar de novo".');
        $('stage-toolbar').hidden = false;
      });
    }).catch(function (e) {
      var msg = e && e.message === 'NO_KEY' ? 'Conecte sua chave da OpenRouter para gerar.' : (e && e.message) || 'Erro ao gerar.';
      showState('error', msg);
      if (state.cur) $('stage-toolbar').hidden = false;
    }).then(function () { setBusy(false); });
  }

  // ── Voice dictation (Web Speech API, pt-BR) ──────────────────────────────
  function setupMic() {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    var btn = $('mic-btn'), st = $('mic-status');
    if (!SR) {
      btn.disabled = true; btn.title = 'Ditado por voz não disponível neste navegador';
      st.textContent = 'Ditado indisponível aqui — use Chrome, Edge ou Safari.';
      return;
    }
    var base = '';
    btn.addEventListener('click', function () {
      if (state.recording) { stopMic(); return; }
      var rec;
      try { rec = new SR(); } catch (e) { st.textContent = 'Não foi possível iniciar o microfone.'; return; }
      rec.lang = 'pt-BR'; rec.continuous = true; rec.interimResults = true;
      base = $('in-ideia').value.replace(/\s+$/, '');
      rec.onresult = function (ev) {
        var fin = '', inter = '';
        for (var i = 0; i < ev.results.length; i++) {
          var tx = ev.results[i][0].transcript;
          if (ev.results[i].isFinal) fin += tx; else inter += tx;
        }
        var joined = (base ? base + ' ' : '') + (fin + inter).trim();
        $('in-ideia').value = joined.slice(0, 2500);
        updateCount();
        st.textContent = inter ? 'Ouvindo… "' + inter.trim().slice(-40) + '"' : 'Ouvindo…';
      };
      rec.onerror = function (ev) {
        var map = { 'not-allowed': 'Permissão de microfone negada. Libere o microfone no navegador.', 'service-not-allowed': 'Permissão de microfone negada.', 'no-speech': 'Não ouvi nada. Tente de novo.', 'audio-capture': 'Nenhum microfone encontrado.', 'network': 'O ditado precisa de internet.' };
        st.textContent = map[ev.error] || ('Erro no ditado: ' + ev.error);
      };
      rec.onend = function () { state.recording = false; state.rec = null; btn.classList.remove('is-recording'); btn.setAttribute('aria-pressed', 'false'); btn.querySelector('.mic-label').textContent = 'Ditar'; if (/^Ouvindo/.test(st.textContent)) st.textContent = 'Ditado concluído — revise o texto.'; };
      try { rec.start(); } catch (e) { st.textContent = 'Não foi possível iniciar o ditado.'; return; }
      state.rec = rec; state.recording = true;
      btn.classList.add('is-recording'); btn.setAttribute('aria-pressed', 'true'); btn.querySelector('.mic-label').innerHTML = '<span class="rec-dot"></span> Parar';
      st.textContent = 'Ouvindo… fale sua ideia.';
    });
  }
  function stopMic() { if (state.rec) { try { state.rec.stop(); } catch (e) {} } }

  // ── History ───────────────────────────────────────────────────────────────
  function saveCurrent() {
    var cur = state.cur; if (!cur) return;
    var hist = lsGet(HISTORY_STORE, []);
    var i = -1; hist.forEach(function (h, idx) { if (h.id === cur.id) i = idx; });
    if (i === -1) hist.push(cur); else hist[i] = cur;
    while (hist.length > HISTORY_MAX) hist.shift();
    if (lsSet(HISTORY_STORE, hist)) { toast('Salva no histórico (boia nº ' + (i === -1 ? hist.length : i + 1) + ').'); renderChart(); renderLibrary(); }
    else toast('Não foi possível salvar (armazenamento do navegador cheio ou bloqueado).');
  }
  function renderLibrary() {
    var hist = lsGet(HISTORY_STORE, []), el = $('lib-list');
    if (!hist.length) { el.innerHTML = '<p class="lib-empty">Nenhuma ideia salva ainda. Gere uma carta e clique em "Salvar no histórico".</p>'; return; }
    el.innerHTML = hist.map(function (h, i) {
      return '<div class="lib-item"><button class="lib-open" data-id="' + esc(h.id) + '"><b>' + (i + 1) + '. ' + esc(h.titulo) + '</b><span>Veículo ' + h.v + ' · D ' + h.x + ' · $ ' + h.y + ' · ' + esc(new Date(h.ts).toLocaleDateString('pt-BR')) + '</span></button><button class="btn-icon lib-del" data-id="' + esc(h.id) + '" aria-label="Apagar ' + esc(h.titulo) + '" title="Apagar">&times;</button></div>';
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
    $('in-ideia').value = it.ideia || ''; $('in-contexto').value = it.contexto || '';
    setGoal(it.goal || 'renda'); updateCount();
    $('tb-title').textContent = it.titulo;
    lsSet(CURRENT_SLOT, it);
    renderChart(); renderReport(); showState('done');
  }

  // ── Exports ───────────────────────────────────────────────────────────────
  function fname(ext) { return 'veiculo-ia-' + String(state.cur ? state.cur.titulo : 'carta').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) + '.' + ext; }
  function exportPNG() {
    var cur = state.cur; if (!cur) return;
    var veh = VEHICLES[cur.v];
    var inner = chartSVG({ cur: cur, history: [], showHistory: false }).replace('<svg ', '<svg x="40" y="150" width="1520" height="1094" ');
    var W = 1600, H = 1420;
    var title = cur.titulo.length > 60 ? cur.titulo.slice(0, 59) + '…' : cur.titulo;
    var piv = (cur.pivots || []).map(function (p, i) { return 'P' + (i + 1) + ' ' + p.nome + ' → veículo ' + p.v; }).join('   ·   ');
    if (piv.length > 118) piv = piv.slice(0, 117) + '…';
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">' +
      '<rect width="' + W + '" height="' + H + '" fill="#f4efe2"/>' +
      '<text x="40" y="58" font-family="Menlo,Consolas,monospace" font-size="20" letter-spacing="3" fill="#8e1752">VEÍCULO IA · ÍNDICE DO IDIOTA</text>' +
      '<text x="40" y="112" font-family="Georgia,serif" font-style="italic" font-weight="700" font-size="48" fill="#14284a">' + esc(title) + '</text>' +
      inner +
      '<rect x="40" y="1262" width="1520" height="2" fill="#14284a"/>' +
      '<text x="40" y="1306" font-family="Georgia,serif" font-style="italic" font-weight="700" font-size="34" fill="#b5246b">Veículo ' + cur.v + ' · ' + esc(veh.nome) + '</text>' +
      '<text x="1560" y="1306" text-anchor="end" font-family="Menlo,Consolas,monospace" font-size="22" fill="#14284a">Dificuldade ' + cur.x + ' · Dinheiro ' + cur.y + ' · Objetivo: ' + esc(GOALS[cur.goal].label) + '</text>' +
      '<text x="40" y="1346" font-family="Menlo,Consolas,monospace" font-size="18" fill="#0f6b6b">' + esc(piv) + '</text>' +
      '<text x="40" y="1394" font-family="Menlo,Consolas,monospace" font-size="16" fill="#4a5a74">Framework: Alex Hormozi, \u201cMy 2027 Framework\u201d (YouTube) · Ferramenta educacional da Comunidade Maestros da IA · veiculoia.maestrosdaia.com</text>' +
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
  function textSummary() {
    var c = state.cur; if (!c) return '';
    var L1 = ['VEÍCULO IA — ' + c.titulo, c.resumo || c.ideia, '',
      'Posição: dificuldade ' + c.x + '/100 · dinheiro ' + c.y + '/100',
      'Veículo ' + c.v + ' — ' + VEHICLES[c.v].nome + ' (' + VEHICLES[c.v].curto + ')',
      'Objetivo: ' + GOALS[c.goal].label + ' — encaixe ' + c.fit, ''];
    if (c.report) {
      if (c.report.diagnostico) L1.push('DIAGNÓSTICO', c.report.diagnostico, '');
      L1.push('TESTE DO BILIONÁRIO: ' + c.bil.veredito + (c.bil.exemplo ? ' — ' + c.bil.exemplo : '') + '. ' + c.bil.comentario, '');
      L1.push('RISCOS'); c.report.riscos.forEach(function (r) { L1.push('- ' + r.texto + ' [' + sourceById(r.fonte).short + ']'); }); L1.push('');
      L1.push('PRÓXIMOS PASSOS'); c.report.passos.forEach(function (r, i) { L1.push((i + 1) + ') ' + r.texto + ' [' + sourceById(r.fonte).short + ']'); }); L1.push('');
    }
    if (c.pivots && c.pivots.length) { L1.push('PIVÔS'); c.pivots.forEach(function (p, i) { L1.push('P' + (i + 1) + ' ' + p.nome + ': ' + p.descricao + ' → veículo ' + p.v + ' (D ' + p.x + ', $ ' + p.y + ')'); }); L1.push(''); }
    L1.push('RÚBRICA'); RUBRIC.forEach(function (r) { L1.push('- ' + r.label + ': ' + c.rubric[r.k].nota + '/10 — ' + c.rubric[r.k].porque); });
    L1.push('', 'Framework: Alex Hormozi, "How To Make More Money Than You Deserve (My 2027 Framework)". Ferramenta educacional — Comunidade Maestros da IA.');
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
  }
  var EXAMPLES = [
    { i: 'Quero abrir uma academia de bairro com aulas em grupo e personal trainers, mensalidade de R$ 129, em Belo Horizonte.', c: 'sou educador físico, tenho R$ 150 mil', g: 'renda' },
    { i: 'Empresa de limpeza comercial para condomínios e escritórios, com contrato mensal recorrente e equipe própria treinada.', c: 'já trabalhei 6 anos como gerente de facilities', g: 'empresa' },
    { i: 'Mentoria online em grupo para dentistas que querem atrair pacientes de implante pelo Instagram, com aulas ao vivo e comunidade.', c: 'sou dentista com 40 mil seguidores', g: 'renda' }
  ];
  var exIdx = 0;
  function useExample() {
    var ex = EXAMPLES[exIdx % EXAMPLES.length]; exIdx++;
    $('in-ideia').value = ex.i; $('in-contexto').value = ex.c; setGoal(ex.g); updateCount();
    toast('Exemplo preenchido — clique em "Posicionar na carta".');
  }
  function clearForm() {
    stopMic();
    $('in-ideia').value = ''; $('in-contexto').value = ''; updateCount();
    state.cur = null; try { localStorage.removeItem(CURRENT_SLOT); } catch (e) {}
    $('report').hidden = true; renderChart(); showState('empty');
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  function init() {
    if (state.wired) return;
    state.wired = true;
    if (window.ApiKeyManager && ApiKeyManager.renderModelPicker) ApiKeyManager.renderModelPicker('model-select');
    renderOrigins();
    setupMic();
    $('in-ideia').addEventListener('input', updateCount);
    document.querySelectorAll('#goal-chips .chip').forEach(function (c) { c.addEventListener('click', function () { setGoal(c.getAttribute('data-val')); }); });
    $('generate-btn').addEventListener('click', generate);
    $('retry-btn').addEventListener('click', generate);
    $('example-btn').addEventListener('click', useExample);
    $('clear-btn').addEventListener('click', clearForm);
    $('save-btn').addEventListener('click', saveCurrent);
    $('copy-btn').addEventListener('click', copyText);
    $('print-btn').addEventListener('click', function () { window.print(); });
    $('png-btn').addEventListener('click', exportPNG);
    $('toggle-history').addEventListener('change', renderChart);
    $('library-btn').addEventListener('click', function () { renderLibrary(); $('lib-modal').style.display = 'flex'; });
    $('lib-close').addEventListener('click', function () { $('lib-modal').style.display = 'none'; });
    $('lib-modal').querySelector('.modal-overlay').addEventListener('click', function () { $('lib-modal').style.display = 'none'; });
    $('lib-list').addEventListener('click', onLibClick);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { $('lib-modal').style.display = 'none'; } });
    var lo = $('logout-btn');
    if (lo) lo.addEventListener('click', function () { // COR-062
      stopMic();
      var em = $('gate-email'), ph = $('gate-phone'), er = $('gate-error');
      if (em) em.value = ''; if (ph) ph.value = ''; if (er) { er.textContent = ''; er.style.display = 'none'; }
    });
    var last = lsGet(CURRENT_SLOT, null);
    if (last && last.rubric && last.x != null) loadEntry(last);
    else { renderChart(); showState('empty'); }
    updateCount();
  }

  return { init: init, _calc: { position: position, classify: classify, normRubric: normRubric } };
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
