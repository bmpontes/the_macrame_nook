import * as db from './db.js';

const { cache } = db;
const $view = document.getElementById('view');
const $tabs = document.getElementById('tabs');

// ================= Utilitários =================
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' });
const eur = (n) => money.format(Number(n) || 0);
// Custos por unidade de materiais podem ser frações de cêntimo: mostrar até 4 casas.
const moneyUn = new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 4 });
const eurUn = (n) => moneyUn.format(Number(n) || 0);
const num = (s) => { const n = Number(String(s ?? '').replace(/\s/g, '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };
const fmt2 = (n) => (Math.round((Number(n) || 0) * 100) / 100).toString().replace('.', ',');
const today = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const fmtDate = (s) => (s ? s.slice(0, 10).split('-').reverse().join('/') : '');
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const byId = (table, id) => cache[table].find((r) => r.id === Number(id));
const pref = {
  get(k, d) { try { return localStorage.getItem('tmn-' + k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('tmn-' + k, v); } catch { /* ignorar */ } },
};

/** Tema: 'auto' segue o iPhone; 'claro'/'escuro' forçam. Também ajusta a cor da barra de estado. */
function applyTheme() {
  const t = pref.get('tema', 'auto');
  const root = document.documentElement;
  if (t === 'claro') root.dataset.theme = 'light';
  else if (t === 'escuro') root.dataset.theme = 'dark';
  else delete root.dataset.theme;
  const metas = document.querySelectorAll('meta[name="theme-color"]');
  metas.forEach((m) => {
    const isDarkMeta = m.media.includes('dark');
    m.content = t === 'auto' ? (isDarkMeta ? '#000000' : '#FAF8F7') : (t === 'escuro' ? '#000000' : '#FAF8F7');
  });
}

function toast(msg, isError = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'show' + (isError ? ' error' : '');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.className = ''; }, 2600);
}

async function run(fn, okMsg) {
  try {
    const r = await fn();
    if (okMsg) toast(okMsg);
    return r;
  } catch (e) {
    console.error(e);
    toast(e.message || 'Ocorreu um erro.', true);
    throw e;
  }
}

// ================= Cálculos =================
const linhasDe = (encId) => cache.encomenda_linhas.filter((l) => l.encomenda_id === encId);
const totalLinhas = (ls) => ls.reduce((s, l) => s + num(l.preco_unit) * num(l.quantidade), 0);
const totalEnc = (e) => totalLinhas(linhasDe(e.id));
const clienteNome = (id) => byId('clientes', id)?.nome ?? 'Sem cliente';
const produtoNome = (id) => byId('produtos', id)?.nome ?? 'Produto removido';
function estado(e) {
  const ls = linhasDe(e.id);
  const executado = ls.length > 0 && ls.every((l) => l.executado);
  return { executado, concluida: executado && e.pago && e.enviado };
}
const custoUnitMaterial = (m) => (num(m.quantidade) ? num(m.preco_total) / num(m.quantidade) : 0);

// Materiais usados em cada produto (lista guardada pela calculadora).
const materiaisDe = (pid) => cache.produto_materiais.filter((x) => x.produto_id === pid);
const custoAtualMateriais = (p) =>
  materiaisDe(p.id).reduce((s, x) => s + custoUnitMaterial(byId('materiais', x.material_id) ?? {}) * num(x.quantidade), 0) + num(p.custo_extra);
const round2 = (n) => Math.round(n * 100) / 100;

// ================= Fotos e catálogo =================
const categorias = () => [...new Set(cache.produtos.map((p) => (p.categoria || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt'));
const fotosDe = (pid) => cache.produto_fotos.filter((f) => f.produto_id === pid).sort((a, b) => (b.principal - a.principal) || a.id - b.id);
const fotoPrincipal = (pid) => fotosDe(pid)[0];
const iniciais = (s) => String(s ?? '').trim().split(/\s+/).slice(0, 2).map((w) => w[0] ?? '').join('').toUpperCase();

/** <img> que é preenchida depois (links assinados); sem foto mostra um marcador com as iniciais. */
function fotoTag(foto, size, cls, alt) {
  return foto
    ? `<img class="${cls}" data-foto="${foto.id}" data-size="${size}" alt="${esc(alt)}" decoding="async">`
    : `<span class="${cls} ph" aria-hidden="true">${esc(iniciais(alt))}</span>`;
}

async function hydrate(root) {
  const imgs = [...root.querySelectorAll('img[data-foto]:not([src])')];
  if (!imgs.length) return;
  const pares = imgs.map((i) => [byId('produto_fotos', i.dataset.foto), i.dataset.size, i]).filter(([f]) => f);
  try {
    const urls = await db.fotoUrls(pares.map(([f, size]) => [f, size]));
    for (const [f, size, img] of pares) {
      const u = urls[db.fotoFile(f.caminho, size)];
      if (u) { img.addEventListener('load', () => img.classList.add('loaded'), { once: true }); img.src = u; }
    }
  } catch (e) { console.error(e); }
}

/** Reduz a foto no próprio telemóvel antes de a enviar: versão grande + miniatura (JPEG). */
async function prepararFoto(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('Não foi possível ler esta imagem.'));
      i.src = url;
    });
    const make = (max, quality) => {
      const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      return new Promise((res) => c.toBlob(res, 'image/jpeg', quality));
    };
    // No modo demonstração as fotos ficam no armazenamento do browser (pouco espaço): mais pequenas.
    const [full, thumb] = db.demo
      ? await Promise.all([make(900, 0.72), make(360, 0.7)])
      : await Promise.all([make(1200, 0.8), make(480, 0.75)]);
    return { full, thumb };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function periodo(key) {
  const y = new Date().getFullYear();
  if (key === 'ano') return { de: `${y}-01-01`, ate: `${y}-12-31`, label: String(y) };
  if (key === 'anterior') return { de: `${y - 1}-01-01`, ate: `${y - 1}-12-31`, label: String(y - 1) };
  return { de: '0000-01-01', ate: '9999-12-31', label: 'Sempre' };
}
const noPeriodo = (data, p) => data >= p.de && data <= p.ate;

// ================= Componentes =================
function screen({ title, back, right = '', body, large = !back, center = false }) {
  // Ecrãs com título grande: o botão de ação fica na mesma linha do título.
  // A barra de cima só aparece quando há "Voltar" ou o título é pequeno.
  const bar = (!large || back) ? `
    <header class="bar${large ? ' bar-large' : ''}">
      <div class="bar-side">${back ? `<button class="bar-btn" data-back="${esc(back)}"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>Voltar</button>` : ''}</div>
      <div class="bar-title">${large ? '' : esc(title)}</div>
      <div class="bar-side right">${large ? '' : right}</div>
    </header>` : '';
  return `${bar}
    <main class="content${bar ? '' : ' no-bar'}">
      ${large ? `<div class="title-row${center ? ' center' : ''}"><h1 class="large">${esc(title)}</h1>${right}</div>` : ''}
      ${body}
    </main>`;
}

const chip = (on, label) => `<span class="chip${on ? ' on' : ''}">${label}</span>`;
const segmented = (name, options, value) => `
  <div class="seg" data-seg="${name}">
    ${options.map(([v, l]) => `<button type="button" data-v="${v}" class="${v === value ? 'on' : ''}">${esc(l)}</button>`).join('')}
  </div>`;
const searchBox = (value, placeholder = 'Procurar') => `
  <div class="search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
  <input type="search" id="q" placeholder="${esc(placeholder)}" value="${esc(value)}" autocomplete="off"></div>`;
const empty = (msg) => `<div class="empty">${esc(msg)}</div>`;
const field = (label, input) => `<label class="field"><span>${esc(label)}</span>${input}</label>`;
const toggle = (label, name, on) => `<label class="row toggle"><span>${esc(label)}</span><input type="checkbox" class="switch" name="${name}" ${on ? 'checked' : ''}></label>`;

/** Pequeno formulário numa folha que sobe de baixo. Devolve { campo: valor } ou null se cancelar. */
function formSheet({ title, fields, required = [], submit = 'Guardar' }) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'sheet-wrap';
    wrap.innerHTML = `
      <div class="sheet auto" role="dialog" aria-label="${esc(title)}">
        <div class="sheet-head"><button class="link" data-cancel>Cancelar</button><b>${esc(title)}</b><button class="link strong" data-ok>${esc(submit)}</button></div>
        <form class="sheet-body" onsubmit="return false">
          <div class="list form">${fields.map((f) => field(f.label, f.textarea
            ? `<textarea name="${f.name}" rows="2">${esc(f.value ?? '')}</textarea>`
            : `<input type="text" name="${f.name}" value="${esc(f.value ?? '')}" autocomplete="off">`)).join('')}</div>
          <p class="error" data-err></p>
        </form>
      </div>`;
    document.body.appendChild(wrap);
    const form = wrap.querySelector('form');
    const close = (v) => { wrap.remove(); resolve(v); };
    const ok = () => {
      const d = formData(form);
      const falta = required.find((k) => !String(d[k] ?? '').trim());
      if (falta) {
        wrap.querySelector('[data-err]').textContent = `Preencha o campo “${fields.find((f) => f.name === falta).label}”.`;
        form.querySelector(`[name="${falta}"]`).focus();
        return;
      }
      close(d);
    };
    wrap.addEventListener('click', (ev) => {
      if (ev.target === wrap || ev.target.closest('[data-cancel]')) return close(null);
      if (ev.target.closest('[data-ok]')) ok();
    });
    form.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && ev.target.tagName === 'INPUT') { ev.preventDefault(); ok(); } });
    setTimeout(() => {
      const first = fields.find((f) => !f.value) ?? fields[0];
      form.querySelector(`[name="${first.name}"]`).focus();
    }, 80);
  });
}

/** Folha de escolha com pesquisa (clientes, produtos, materiais). */
function pick({ title, items, allowNew = false, newLabel = '' }) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'sheet-wrap';
    wrap.innerHTML = `
      <div class="sheet" role="dialog" aria-label="${esc(title)}">
        <div class="sheet-head"><button class="link" data-cancel>Cancelar</button><b>${esc(title)}</b><span></span></div>
        <div class="sheet-search">${searchBox('', 'Procurar')}</div>
        <div class="sheet-list list"></div>
      </div>`;
    document.body.appendChild(wrap);
    const input = wrap.querySelector('input');
    const list = wrap.querySelector('.sheet-list');
    const close = (v) => { wrap.remove(); resolve(v); };
    const draw = () => {
      const q = norm(input.value.trim());
      const found = items.filter((i) => !q || norm(i.label + ' ' + (i.sub ?? '')).includes(q)).slice(0, 150);
      list.innerHTML =
        // Com newLabel o botão de criar aparece sempre no topo; sem ele, só depois de escrever.
        (allowNew && (q || newLabel)
          ? `<button class="item add" data-new><span class="item-main">+ ${q ? `Criar “${esc(input.value.trim())}”` : esc(newLabel)}</span></button>`
          : '') +
        found.map((i) => `<button class="item${'foto' in i ? ' with-thumb' : ''}" data-id="${i.id}">${'foto' in i ? fotoTag(i.foto, 'thumb', 'thumb', i.label) : ''}<span class="item-main">${esc(i.label)}</span>${i.sub ? `<span class="item-sub">${esc(i.sub)}</span>` : ''}</button>`).join('') +
        (!found.length && !(allowNew && q) ? empty('Sem resultados') : '');
      hydrate(list);
    };
    input.addEventListener('input', draw);
    wrap.addEventListener('click', (ev) => {
      if (ev.target === wrap || ev.target.closest('[data-cancel]')) return close(null);
      const b = ev.target.closest('.item');
      if (!b) return;
      if (b.hasAttribute('data-new')) return close({ novo: input.value.trim() });
      close({ id: Number(b.dataset.id) });
    });
    draw();
    setTimeout(() => input.focus(), 50);
  });
}

// ================= Navegação =================
const stack = [];
const routes = [
  [/^\/inicio$/, viewInicio, 'inicio'],
  [/^\/encomendas$/, viewEncomendas, 'encomendas'],
  [/^\/encomenda\/(\w+)$/, viewEncomenda, 'encomendas'],
  [/^\/clientes$/, viewClientes, 'mais'],
  [/^\/cliente\/(\w+)$/, viewCliente, 'mais'],
  [/^\/produtos$/, viewProdutos, 'produtos'],
  [/^\/produto\/(\w+)$/, viewProduto, 'produtos'],
  [/^\/mais$/, viewMais, 'mais'],
  [/^\/despesas$/, viewDespesas, 'despesas'],
  [/^\/despesa\/(\w+)$/, viewDespesa, 'despesas'],
  [/^\/materiais$/, viewMateriais, 'mais'],
  [/^\/material\/(\w+)$/, viewMaterial, 'mais'],
  [/^\/calculadora$/, viewCalculadora, 'mais'],
  [/^\/relatorios$/, viewRelatorios, 'mais'],
];

function go(hash) { location.hash = hash; }

/**
 * Ao tocar num separador de baixo: mostra logo o ecrã com os dados que já tem e,
 * em segundo plano, vai buscar os dados mais recentes ao Supabase e redesenha o ecrã
 * (mantendo a posição do scroll). Não redesenha se entretanto mudou de ecrã ou está a escrever.
 */
let refreshing = null;
function refreshFromTab() {
  if (refreshing) return refreshing;
  const hashAntes = location.hash;
  document.body.classList.add('syncing');
  refreshing = db.loadAll()
    .then(() => {
      const aEscrever = document.activeElement?.matches?.('input, textarea');
      if (location.hash === hashAntes && !aEscrever && !document.querySelector('.sheet-wrap, .viewer')) {
        const y = window.scrollY;
        route({ keepScroll: true });
        window.scrollTo(0, y);
      }
    })
    .catch((e) => { console.error(e); toast('Sem ligação — a mostrar os últimos dados carregados.', true); })
    .finally(() => { refreshing = null; document.body.classList.remove('syncing'); });
  return refreshing;
}
$tabs.addEventListener('click', (ev) => {
  const a = ev.target.closest('a[href]');
  if (!a) return;
  // Mesmo separador: não há mudança de endereço, por isso atualiza já. Outro separador: depois de mudar.
  if (a.getAttribute('href') === location.hash) { ev.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); refreshFromTab(); }
  else setTimeout(refreshFromTab, 0);
});

function route({ keepScroll = false } = {}) {
  const hash = location.hash || '#/inicio';
  if (stack.length > 1 && stack[stack.length - 2] === hash) stack.pop();
  else if (stack[stack.length - 1] !== hash) stack.push(hash);

  const [path, qs] = hash.slice(1).split('?');
  const query = Object.fromEntries(new URLSearchParams(qs || ''));
  for (const [re, view, tab] of routes) {
    const m = path.match(re);
    if (!m) continue;
    $tabs.hidden = false;
    $tabs.querySelectorAll('a').forEach((a) => a.classList.toggle('on', a.dataset.tab === tab));
    const out = view(m[1], query);
    $view.innerHTML = out.html;
    if (!keepScroll) { $view.scrollTop = 0; window.scrollTo(0, 0); }
    bindCommon();
    out.bind?.($view);
    return;
  }
  go('#/inicio');
}

function bindCommon() {
  $view.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', () => {
    if (stack.length > 1) history.back(); else go(b.dataset.back);
  }));
  $view.querySelectorAll('[data-href]').forEach((b) => b.addEventListener('click', () => go(b.dataset.href)));
  hydrate($view);
}

function bindSeg(root, name, onChange) {
  const seg = root.querySelector(`[data-seg="${name}"]`);
  seg?.addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    seg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    onChange(b.dataset.v);
  });
}

function bindSearch(root, onChange) {
  root.querySelector('#q')?.addEventListener('input', (e) => onChange(e.target.value));
}

const formData = (form) => {
  const o = {};
  form.querySelectorAll('[name]').forEach((el) => { o[el.name] = el.type === 'checkbox' ? el.checked : el.value; });
  return o;
};

// ================= Início =================
function viewInicio() {
  const per = 'tudo'; // o Início abre sempre em "Sempre"
  return {
    html: screen({
      title: 'The Macrame Nook',
      center: true,
      body: `
        ${db.demo ? `<div class="banner">Modo demonstração — dados fictícios guardados só neste dispositivo. Configure o Supabase em <code>config.js</code>.</div>` : ''}
        ${segmented('periodo', [['tudo', 'Sempre'], ['ano', 'Este ano'], ['anterior', 'Ano passado']], per)}
        <div id="dash"></div>`,
    }),
    bind(root) {
      const draw = (key) => { root.querySelector('#dash').innerHTML = dashboard(key); bindCommon(); };
      bindSeg(root, 'periodo', (v) => draw(v));
      draw(per);
    },
  };
}

function dashboard(key) {
  const p = periodo(key);
  const encs = cache.encomendas.filter((e) => noPeriodo(e.data, p));
  const pagas = encs.filter((e) => e.pago);
  const vendas = pagas.reduce((s, e) => s + totalEnc(e), 0);
  const despesas = cache.despesas.filter((d) => noPeriodo(d.data, p)).reduce((s, d) => s + num(d.total), 0);

  const abertas = cache.encomendas.filter((e) => !estado(e).concluida);
  const porReceber = cache.encomendas.filter((e) => !e.pago).reduce((s, e) => s + totalEnc(e), 0);
  const porFazer = abertas.reduce((s, e) => s + linhasDe(e.id).filter((l) => !l.executado).reduce((a, l) => a + num(l.quantidade), 0), 0);
  const porEnviar = cache.encomendas.filter((e) => !e.enviado && estado(e).executado).length;
  const porPagar = cache.encomendas.filter((e) => !e.pago).length;

  const top = topProdutos(pagas).slice(0, 5);
  const recentes = [...abertas].sort(sortEnc).slice(0, 5);

  return `
    <div class="kpis">
      <div class="kpi wide hero ${vendas - despesas >= 0 ? 'pos' : 'neg'}"><span>Lucro · ${esc(p.label)}</span><b>${eur(vendas - despesas)}</b></div>
      <div class="kpi"><span>Vendas pagas</span><b>${eur(vendas)}</b></div>
      <div class="kpi"><span>Despesas</span><b>${eur(despesas)}</b></div>
    </div>

    <h2 class="section">Para tratar</h2>
    <div class="list">
      <button class="item" data-href="#/encomendas?f=curso"><span class="item-main">Peças por fazer</span><span class="badge">${porFazer}</span></button>
      <button class="item" data-href="#/encomendas?f=enviar"><span class="item-main">Prontas para enviar</span><span class="badge">${porEnviar}</span></button>
      <button class="item" data-href="#/encomendas?f=pagar"><span class="item-main">Por pagar</span><span class="item-right">${porPagar} · ${eur(porReceber)}</span></button>
    </div>

    <h2 class="section">Encomendas em curso</h2>
    <div class="list">${recentes.map(encRow).join('') || empty('Tudo concluído 🎉')}</div>

    <h2 class="section">Mais vendidos · ${esc(p.label)}</h2>
    <div class="list">
      ${top.map((t) => `<div class="item static"><span class="item-main">${esc(t.nome)}</span><span class="item-right">${t.qt} un · ${eur(t.total)}</span></div>`).join('') || empty('Sem vendas neste período')}
    </div>`;
}

function topProdutos(encs) {
  const ids = new Set(encs.map((e) => e.id));
  const m = new Map();
  for (const l of cache.encomenda_linhas) {
    if (!ids.has(l.encomenda_id)) continue;
    const k = l.produto_id ?? 0;
    const r = m.get(k) ?? { nome: produtoNome(l.produto_id), qt: 0, total: 0 };
    r.qt += num(l.quantidade);
    r.total += num(l.quantidade) * num(l.preco_unit);
    m.set(k, r);
  }
  return [...m.values()].sort((a, b) => b.qt - a.qt || b.total - a.total);
}

// ================= Encomendas =================
const sortEnc = (a, b) => (b.data > a.data ? 1 : b.data < a.data ? -1 : b.id - a.id);

function encRow(e) {
  const st = estado(e);
  const ls = linhasDe(e.id);
  const n = ls.reduce((s, l) => s + num(l.quantidade), 0);
  return `
    <button class="item" data-href="#/encomenda/${e.id}">
      <span class="item-main">${esc(clienteNome(e.cliente_id))}</span>
      <span class="item-right amount">${eur(totalLinhas(ls))}</span>
      <span class="item-sub">#${e.id} · ${fmtDate(e.data)} · ${n} ${n === 1 ? 'peça' : 'peças'}</span>
      <span class="chips">${chip(st.executado, 'Feito')}${chip(e.pago, 'Pago')}${chip(e.enviado, 'Enviado')}</span>
    </button>`;
}

function viewEncomendas(_, query) {
  let f = query.f || pref.get('filtroEnc', 'curso');
  let q = '';
  const filtros = {
    curso: (e) => !estado(e).concluida,
    pagar: (e) => !e.pago,
    enviar: (e) => !e.enviado && estado(e).executado,
    concluidas: (e) => estado(e).concluida,
    todas: () => true,
  };
  if (!filtros[f]) f = 'curso';
  return {
    html: screen({
      title: 'Encomendas',
      right: `<button class="bar-btn add" data-href="#/encomenda/nova"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>Nova</button>`,
      body: `
        ${searchBox('', 'Cliente, nº ou descrição')}
        ${segmented('f', [['curso', 'Em curso'], ['pagar', 'Por pagar'], ['enviar', 'Por enviar'], ['concluidas', 'Concluídas'], ['todas', 'Todas']], f)}
        <div class="summary" id="count"></div>
        <div class="list" id="lista"></div>`,
    }),
    bind(root) {
      const draw = () => {
        const qq = norm(q.trim());
        const rows = cache.encomendas.filter(filtros[f]).filter((e) => !qq ||
          norm(clienteNome(e.cliente_id)).includes(qq) || String(e.id) === qq.replace('#', '') ||
          norm(e.notas).includes(qq) || linhasDe(e.id).some((l) => norm(l.descricao).includes(qq) || norm(produtoNome(l.produto_id)).includes(qq)))
          .sort(sortEnc);
        root.querySelector('#count').innerHTML = `<span>${rows.length} ${rows.length === 1 ? 'encomenda' : 'encomendas'}</span><b>${eur(rows.reduce((s, e) => s + totalEnc(e), 0))}</b>`;
        root.querySelector('#lista').innerHTML = rows.slice(0, 300).map(encRow).join('') || empty('Nenhuma encomenda');
        bindCommon();
      };
      bindSeg(root, 'f', (v) => { f = v; pref.set('filtroEnc', v); draw(); });
      bindSearch(root, (v) => { q = v; draw(); });
      draw();
    },
  };
}

function viewEncomenda(id, query) {
  const isNew = id === 'nova';
  const orig = isNew ? null : byId('encomendas', id);
  if (!isNew && !orig) return notFound('#/encomendas');
  const enc = isNew
    ? { data: today(), cliente_id: query.cliente ? Number(query.cliente) : null, pago: false, enviado: false, notas: '' }
    : { ...orig };
  const linhas = isNew ? [] : linhasDe(orig.id).map((l) => ({ ...l }));
  const removed = [];

  return {
    html: screen({
      title: isNew ? 'Nova encomenda' : `Encomenda #${orig.id}`,
      back: '#/encomendas',
      right: `<button class="bar-btn strong" id="guardar">Guardar</button>`,
      body: `
        <form id="f" onsubmit="return false">
          <div class="list form">
            <button type="button" class="item" id="cliente"><span class="item-label">Cliente</span><span class="item-right" id="clienteNome"></span></button>
            ${field('Data', `<input type="date" name="data" value="${esc(enc.data)}">`)}
            ${toggle('Pago', 'pago', enc.pago)}
            ${toggle('Enviado', 'enviado', enc.enviado)}
          </div>
          <h2 class="section">Produtos</h2>
          <div id="linhas"></div>
          <button type="button" class="btn ghost" id="addLinha">+ Adicionar produto</button>
          <div class="total-row"><span>Total</span><b id="total"></b></div>
          <h2 class="section">Notas</h2>
          <div class="list form"><textarea name="notas" rows="3" placeholder="Morada de envio, pormenores…">${esc(enc.notas)}</textarea></div>
          ${isNew ? '' : `<button type="button" class="btn danger" id="apagar">Apagar encomenda</button>`}
        </form>`,
    }),
    bind(root) {
      const form = root.querySelector('#f');
      const showCliente = () => { root.querySelector('#clienteNome').textContent = enc.cliente_id ? clienteNome(enc.cliente_id) : 'Escolher…'; };
      showCliente();

      root.querySelector('#cliente').addEventListener('click', async () => {
        const r = await pick({
          title: 'Cliente', allowNew: true, newLabel: 'Novo cliente',
          items: [...cache.clientes].sort((a, b) => a.nome.localeCompare(b.nome, 'pt')).map((c) => ({ id: c.id, label: c.nome, sub: c.contacto })),
        });
        if (!r) return;
        if (r.novo !== undefined) {
          // Ficha rápida do novo cliente (o nome escrito na pesquisa já vem preenchido).
          const d = await formSheet({
            title: 'Novo cliente',
            fields: [
              { name: 'nome', label: 'Nome', value: r.novo },
              { name: 'morada', label: 'Morada', textarea: true },
              { name: 'contacto', label: 'Contacto (telefone ou email)' },
            ],
            required: ['nome'],
          });
          if (!d) return;
          const c = await run(() => db.save('clientes', { nome: d.nome.trim(), morada: d.morada.trim() || null, contacto: d.contacto.trim() || null }), 'Cliente criado');
          enc.cliente_id = c.id;
        } else enc.cliente_id = r.id;
        showCliente();
      });

      const drawLinhas = () => {
        const box = root.querySelector('#linhas');
        box.innerHTML = linhas.map((l, i) => `
          <div class="line-card" data-i="${i}">
            <div class="line-top">
              ${fotoTag(fotoPrincipal(l.produto_id), 'thumb', 'thumb', produtoNome(l.produto_id))}
              <b class="grow">${esc(produtoNome(l.produto_id))}</b>
              <button type="button" class="icon-btn" data-del aria-label="Remover"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
            </div>
            <input type="text" data-k="descricao" value="${esc(l.descricao)}" placeholder="Descrição (cor, nome, tamanho…)">
            <div class="line-grid">
              <div class="stepper"><button type="button" data-step="-1">−</button><input type="text" inputmode="numeric" data-k="quantidade" value="${l.quantidade}"><button type="button" data-step="1">+</button></div>
              <label class="price">€ <input type="text" inputmode="decimal" data-k="preco_unit" value="${fmt2(l.preco_unit)}"></label>
              <label class="mini-toggle"><input type="checkbox" class="switch" data-k="executado" ${l.executado ? 'checked' : ''}><span>Feito</span></label>
            </div>
          </div>`).join('') || empty('Ainda sem produtos');
        hydrate(box);
        drawTotal();
      };
      const drawTotal = () => { root.querySelector('#total').textContent = eur(totalLinhas(linhas)); };

      root.querySelector('#linhas').addEventListener('input', (ev) => {
        const card = ev.target.closest('.line-card'); const k = ev.target.dataset.k;
        if (!card || !k) return;
        const l = linhas[card.dataset.i];
        l[k] = k === 'executado' ? ev.target.checked : k === 'descricao' ? ev.target.value : num(ev.target.value);
        drawTotal();
      });
      root.querySelector('#linhas').addEventListener('change', (ev) => {
        const card = ev.target.closest('.line-card');
        if (card && ev.target.dataset.k === 'executado') linhas[card.dataset.i].executado = ev.target.checked;
      });
      root.querySelector('#linhas').addEventListener('click', (ev) => {
        const card = ev.target.closest('.line-card');
        if (!card) return;
        const i = Number(card.dataset.i);
        const step = ev.target.closest('[data-step]');
        if (step) {
          linhas[i].quantidade = Math.max(1, num(linhas[i].quantidade) + Number(step.dataset.step));
          card.querySelector('[data-k="quantidade"]').value = linhas[i].quantidade;
          drawTotal();
        }
        if (ev.target.closest('[data-del]')) {
          const [l] = linhas.splice(i, 1);
          if (l.id) removed.push(l.id);
          drawLinhas();
        }
      });

      root.querySelector('#addLinha').addEventListener('click', async () => {
        const r = await pick({
          title: 'Produto', allowNew: true,
          items: cache.produtos.filter((p) => p.ativo !== false).sort((a, b) => a.nome.localeCompare(b.nome, 'pt'))
            .map((p) => ({ id: p.id, label: p.nome, sub: [eur(p.preco), p.categoria].filter(Boolean).join(' · '), foto: fotoPrincipal(p.id) })),
        });
        if (!r) return;
        let p;
        if (r.novo) {
          const preco = num(prompt(`Preço de venda de “${r.novo}” (€):`, '0'));
          p = await run(() => db.save('produtos', { nome: r.novo, preco, custo: 0, ativo: true }), 'Produto criado');
        } else p = byId('produtos', r.id);
        linhas.push({ produto_id: p.id, preco_unit: num(p.preco), quantidade: 1, descricao: '', executado: false });
        drawLinhas();
      });

      root.querySelector('#guardar').addEventListener('click', async () => {
        const d = formData(form);
        Object.assign(enc, { data: d.data || today(), pago: d.pago, enviado: d.enviado, notas: d.notas });
        if (!linhas.length && !confirm('A encomenda não tem produtos. Guardar mesmo assim?')) return;
        const btn = root.querySelector('#guardar'); btn.disabled = true;
        try {
          const clean = linhas.map(({ id, produto_id, preco_unit, quantidade, descricao, executado }) =>
            ({ ...(id ? { id } : {}), produto_id, preco_unit: num(preco_unit), quantidade: Math.max(1, Math.round(num(quantidade))), descricao: descricao || null, executado: !!executado }));
          const saved = await run(() => db.saveEncomenda(enc, clean, removed), 'Encomenda guardada');
          if (isNew) history.replaceState(null, '', `#/encomenda/${saved.id}`);
          stack[stack.length - 1] = `#/encomenda/${saved.id}`;
          if (stack.length > 1) history.back(); else go('#/encomendas');
        } catch { btn.disabled = false; }
      });

      root.querySelector('#apagar')?.addEventListener('click', async () => {
        if (!confirm(`Apagar a encomenda #${orig.id}? Não é possível desfazer.`)) return;
        await run(() => db.remove('encomendas', orig.id), 'Encomenda apagada');
        go('#/encomendas');
      });

      drawLinhas();
    },
  };
}

// ================= Clientes =================
function viewClientes() {
  let q = '';
  return {
    html: screen({
      title: 'Clientes', back: '#/mais', large: true,
      right: `<button class="bar-btn add" data-href="#/cliente/novo"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>Novo</button>`,
      body: `${searchBox('', 'Nome, morada ou contacto')}<p class="hint" id="count"></p><div class="list" id="lista"></div>`,
    }),
    bind(root) {
      const gasto = new Map();
      for (const e of cache.encomendas) if (e.pago) gasto.set(e.cliente_id, (gasto.get(e.cliente_id) ?? 0) + totalEnc(e));
      const draw = () => {
        const qq = norm(q.trim());
        const rows = cache.clientes.filter((c) => !qq || norm(`${c.nome} ${c.morada} ${c.contacto}`).includes(qq))
          .sort((a, b) => a.nome.localeCompare(b.nome, 'pt'));
        root.querySelector('#count').textContent = `${rows.length} clientes`;
        root.querySelector('#lista').innerHTML = rows.map((c) => `
          <button class="item" data-href="#/cliente/${c.id}">
            <span class="item-main">${esc(c.nome)}</span>
            <span class="item-right">${gasto.get(c.id) ? eur(gasto.get(c.id)) : ''}</span>
            ${c.contacto ? `<span class="item-sub">${esc(c.contacto)}</span>` : ''}
          </button>`).join('') || empty('Nenhum cliente');
        bindCommon();
      };
      bindSearch(root, (v) => { q = v; draw(); });
      draw();
    },
  };
}

function contactoLink(c) {
  const s = String(c ?? '').trim();
  if (!s) return '';
  if (s.includes('@') && !s.startsWith('@')) return `<a class="btn small" href="mailto:${esc(s)}">Email</a>`;
  const digits = s.replace(/[^\d+]/g, '');
  if (digits.length >= 9) return `<a class="btn small" href="tel:${esc(digits)}">Ligar</a><a class="btn small" href="sms:${esc(digits)}">SMS</a>`;
  return '';
}

function viewCliente(id) {
  const isNew = id === 'novo';
  const c = isNew ? { nome: '', morada: '', contacto: '' } : byId('clientes', id);
  if (!c) return notFound('#/clientes');
  const encs = isNew ? [] : cache.encomendas.filter((e) => e.cliente_id === c.id).sort(sortEnc);
  const gasto = encs.filter((e) => e.pago).reduce((s, e) => s + totalEnc(e), 0);
  return {
    html: screen({
      title: isNew ? 'Novo cliente' : c.nome,
      back: '#/clientes',
      right: `<button class="bar-btn strong" id="guardar">Guardar</button>`,
      body: `
        <form id="f" onsubmit="return false">
          <div class="list form">
            ${field('Nome', `<input type="text" name="nome" value="${esc(c.nome)}" required autocomplete="off">`)}
            ${field('Morada', `<textarea name="morada" rows="2">${esc(c.morada)}</textarea>`)}
            ${field('Contacto', `<input type="text" name="contacto" value="${esc(c.contacto)}" autocomplete="off">`)}
          </div>
          <div class="actions">${contactoLink(c.contacto)}</div>
          ${isNew ? '' : `
            <div class="kpis"><div class="kpi"><span>Encomendas</span><b>${encs.length}</b></div><div class="kpi"><span>Total pago</span><b>${eur(gasto)}</b></div></div>
            <h2 class="section">Encomendas</h2>
            <button type="button" class="btn ghost" data-href="#/encomenda/nova?cliente=${c.id}">+ Nova encomenda para este cliente</button>
            <div class="list">${encs.map(encRow).join('') || empty('Sem encomendas')}</div>
            <button type="button" class="btn danger" id="apagar">Apagar cliente</button>`}
        </form>`,
    }),
    bind(root) {
      root.querySelector('#guardar').addEventListener('click', async () => {
        const d = formData(root.querySelector('#f'));
        if (!d.nome.trim()) return toast('O nome é obrigatório.', true);
        const saved = await run(() => db.save('clientes', { ...(isNew ? {} : { id: c.id }), nome: d.nome.trim(), morada: d.morada.trim() || null, contacto: d.contacto.trim() || null }), 'Cliente guardado');
        if (isNew) { history.replaceState(null, '', `#/cliente/${saved.id}`); stack[stack.length - 1] = `#/cliente/${saved.id}`; route(); }
      });
      root.querySelector('#apagar')?.addEventListener('click', async () => {
        const msg = encs.length ? `Este cliente tem ${encs.length} encomenda(s), que ficam “Sem cliente”. Apagar mesmo assim?` : `Apagar ${c.nome}?`;
        if (!confirm(msg)) return;
        await run(() => db.remove('clientes', c.id), 'Cliente apagado');
        go('#/clientes');
      });
    },
  };
}

// ================= Produtos =================
function vendidosPorProduto() {
  const pagas = new Set(cache.encomendas.filter((e) => e.pago).map((e) => e.id));
  const m = new Map();
  for (const l of cache.encomenda_linhas) {
    if (!pagas.has(l.encomenda_id)) continue;
    const r = m.get(l.produto_id) ?? { qt: 0, total: 0 };
    r.qt += num(l.quantidade); r.total += num(l.quantidade) * num(l.preco_unit);
    m.set(l.produto_id, r);
  }
  return m;
}

function viewProdutos() {
  let q = '';
  let modo = pref.get('modoProd', 'catalogo');
  let f = pref.get('filtroProd', 'ativos');
  let cat = '';
  const cats = categorias();
  return {
    html: screen({
      title: 'Produtos',
      right: `<button class="bar-btn add" data-href="#/produto/novo"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>Novo</button>`,
      body: `
        ${searchBox('', 'Procurar produto')}
        ${segmented('modo', [['catalogo', 'Catálogo'], ['lista', 'Lista e custos']], modo)}
        ${cats.length ? `<div class="cats" id="cats">${['', ...cats].map((c) => `<button type="button" data-c="${esc(c)}" class="${c === cat ? 'on' : ''}">${esc(c || 'Todas')}</button>`).join('')}</div>` : ''}
        <div id="filtro"></div>
        <div id="lista"></div>`,
    }),
    bind(root) {
      const vend = vendidosPorProduto();
      const draw = () => {
        const qq = norm(q.trim());
        root.querySelector('#filtro').innerHTML = modo === 'lista'
          ? segmented('f', [['ativos', 'Ativos'], ['vendidos', 'Mais vendidos'], ['todos', 'Todos']], f) : '';
        bindSeg(root, 'f', (v) => { f = v; pref.set('filtroProd', v); draw(); });
        let rows = cache.produtos.filter((p) =>
          (modo === 'catalogo' ? p.ativo !== false : (f === 'todos' || p.ativo !== false)) &&
          (!cat || p.categoria === cat) &&
          (!qq || norm(`${p.nome} ${p.categoria} ${p.descricao}`).includes(qq)));
        rows = modo === 'lista' && f === 'vendidos'
          ? rows.sort((a, b) => (vend.get(b.id)?.qt ?? 0) - (vend.get(a.id)?.qt ?? 0))
          : rows.sort((a, b) => a.nome.localeCompare(b.nome, 'pt'));
        const box = root.querySelector('#lista');
        if (modo === 'catalogo') {
          box.className = 'grid';
          box.innerHTML = rows.map((p) => `
            <button class="card" data-href="#/produto/${p.id}">
              ${fotoTag(fotoPrincipal(p.id), 'thumb', 'card-img', p.nome)}
              <span class="card-body"><span class="card-name">${esc(p.nome)}</span><span class="card-price">${eur(p.preco)}</span></span>
            </button>`).join('') || `<div class="empty wide">Nenhum produto</div>`;
        } else {
          box.className = 'list';
          box.innerHTML = rows.map((p) => {
            const margem = num(p.preco) - num(p.custo);
            return `<button class="item with-thumb has-stack" data-href="#/produto/${p.id}">
              ${fotoTag(fotoPrincipal(p.id), 'thumb', 'thumb', p.nome)}
              <span class="item-main">${esc(p.nome)}${p.ativo === false ? ' <span class="chip">inativo</span>' : ''}</span>
              <span class="item-right stack"><b class="amount">${eur(vend.get(p.id)?.total ?? 0)}</b><small>${vend.get(p.id)?.qt ?? 0} ${(vend.get(p.id)?.qt ?? 0) === 1 ? 'vendido' : 'vendidos'}</small></span>
              <span class="item-sub">preço ${eur(p.preco)} · custo ${eur(p.custo)} · margem ${eur(margem)}</span>
            </button>`;
          }).join('') || empty('Nenhum produto');
        }
        bindCommon();
      };
      bindSearch(root, (v) => { q = v; draw(); });
      bindSeg(root, 'modo', (v) => { modo = v; pref.set('modoProd', v); draw(); });
      root.querySelector('#cats')?.addEventListener('click', (ev) => {
        const b = ev.target.closest('button');
        if (!b) return;
        cat = b.dataset.c;
        root.querySelectorAll('#cats button').forEach((x) => x.classList.toggle('on', x === b));
        draw();
      });
      draw();
    },
  };
}

function viewProduto(id) {
  const isNew = id === 'novo';
  const p = isNew ? { nome: '', preco: 0, custo: 0, ativo: true, categoria: '', descricao: '', detalhes: '' } : byId('produtos', id);
  if (!p) return notFound('#/produtos');
  const v = vendidosPorProduto().get(p.id) ?? { qt: 0, total: 0 };
  const usado = !isNew && cache.encomenda_linhas.some((l) => l.produto_id === p.id);
  const mats = isNew ? [] : materiaisDe(p.id).map((x) => ({ x, m: byId('materiais', x.material_id) })).filter((u) => u.m);
  const custoAtual = isNew ? 0 : round2(custoAtualMateriais(p));
  const desatualizado = mats.length > 0 && Math.abs(custoAtual - num(p.custo)) > 0.009;
  return {
    html: screen({
      title: isNew ? 'Novo produto' : p.nome,
      back: '#/produtos',
      right: `<button class="bar-btn strong" id="guardar">Guardar</button>`,
      body: `
        ${isNew ? `<p class="hint">Guarde o produto para depois lhe adicionar fotos.</p>` : `<div id="galeria"></div>`}
        <form id="f" onsubmit="return false">
          <div class="list form">
            ${field('Nome', `<input type="text" name="nome" value="${esc(p.nome)}" autocomplete="off">`)}
            ${field('Categoria', `<input type="text" name="categoria" value="${esc(p.categoria)}" list="dl-cats" placeholder="Natal, Decoração…" autocomplete="off">
              <datalist id="dl-cats">${categorias().map((c) => `<option value="${esc(c)}">`).join('')}</datalist>`)}
            ${field('Descrição', `<textarea name="descricao" rows="3" placeholder="Como é, para que serve…">${esc(p.descricao)}</textarea>`)}
            ${field('Medidas / cores disponíveis', `<input type="text" name="detalhes" value="${esc(p.detalhes)}" autocomplete="off">`)}
          </div>
          <div class="list form">
            ${field('Preço de venda (€)', `<input type="text" inputmode="decimal" name="preco" value="${fmt2(p.preco)}">`)}
            ${field('Custo de produção (€)', `<input type="text" inputmode="decimal" name="custo" value="${fmt2(p.custo)}">`)}
            ${toggle('Ativo (aparece no catálogo e nas encomendas)', 'ativo', p.ativo !== false)}
          </div>
          <div class="kpis">
            <div class="kpi"><span>Margem</span><b id="margem"></b></div>
            ${isNew ? '' : `<div class="kpi"><span>Vendidos</span><b>${v.qt} · ${eur(v.total)}</b></div>`}
          </div>
          ${isNew ? '' : `
            <h2 class="section">Materiais por peça${mats.length ? `<span>${eur(custoAtual)}</span>` : ''}</h2>
            ${desatualizado ? `<div class="banner warn">Os preços dos materiais mudaram: o custo atual é <b>${eur(custoAtual)}</b> (guardado: ${eur(p.custo)}).
              <button type="button" class="link-btn" id="atualizarCusto">Atualizar custo</button></div>` : ''}
            <div class="list">
              ${mats.map(({ x, m }) => `
                <button type="button" class="item" data-href="#/material/${m.id}">
                  <span class="item-main">${esc(m.nome)}</span>
                  <span class="item-right">${eur(custoUnitMaterial(m) * num(x.quantidade))}</span>
                  <span class="item-sub">${fmt2(x.quantidade)} × ${eurUn(custoUnitMaterial(m))}/un</span>
                </button>`).join('')}
              ${mats.length && num(p.custo_extra) ? `<div class="item static"><span class="item-main">Outros custos</span><span class="item-right">${eur(p.custo_extra)}</span></div>` : ''}
              ${mats.length ? `<div class="item static total"><span class="item-main">Custo de produção</span><span class="item-right">${eur(custoAtual)}</span></div>` : empty('Ainda sem materiais associados')}
            </div>`}
          <button type="button" class="btn ghost" data-href="#/calculadora${isNew ? '' : `?produto=${p.id}`}">${mats.length ? 'Editar materiais e custo' : 'Calcular custo com materiais'}</button>
          ${isNew ? '' : `<button type="button" class="btn danger" id="apagar">${usado ? 'Desativar produto' : 'Apagar produto'}</button>`}
        </form>`,
    }),
    bind(root) {
      const form = root.querySelector('#f');
      const drawMargem = () => {
        const d = formData(form); const pr = num(d.preco); const cu = num(d.custo);
        root.querySelector('#margem').textContent = `${eur(pr - cu)}${cu ? ` (${Math.round(((pr - cu) / cu) * 100)}%)` : ''}`;
      };
      form.addEventListener('input', drawMargem); drawMargem();

      root.querySelector('#atualizarCusto')?.addEventListener('click', async () => {
        await run(() => db.save('produtos', { ...p, custo: custoAtual }), 'Custo de produção atualizado');
        route();
      });

      // ---- Galeria ----
      const drawGaleria = () => {
        const box = root.querySelector('#galeria');
        if (!box) return;
        const fotos = fotosDe(p.id);
        box.innerHTML = `
          <div class="gallery">
            ${fotos.map((f, i) => `<button type="button" class="g-item" data-i="${i}">
              ${fotoTag(f, 'thumb', 'g-img', p.nome)}${f.principal && fotos.length > 1 ? '<span class="g-star">Principal</span>' : ''}</button>`).join('')}
            <label class="g-add"><svg viewBox="0 0 24 24"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>
              <span>${fotos.length ? 'Mais fotos' : 'Adicionar fotos'}</span>
              <input type="file" accept="image/*" multiple hidden></label>
          </div>`;
        hydrate(box);
        box.querySelectorAll('.g-item').forEach((b) => b.addEventListener('click', () => viewer(fotosDe(p.id), Number(b.dataset.i), drawGaleria)));
        box.querySelector('input[type=file]').addEventListener('change', async (ev) => {
          const files = [...ev.target.files];
          ev.target.value = '';
          for (let i = 0; i < files.length; i++) {
            toast(`A enviar foto ${i + 1} de ${files.length}…`);
            try {
              const blobs = await prepararFoto(files[i]);
              await db.uploadFoto(p.id, blobs);
              drawGaleria();
            } catch (e) {
              console.error(e);
              toast(e.message || 'Não foi possível enviar a foto.', true);
              return;
            }
          }
          toast(files.length === 1 ? 'Foto adicionada' : `${files.length} fotos adicionadas`);
        });
      };
      drawGaleria();

      root.querySelector('#guardar').addEventListener('click', async () => {
        const d = formData(form);
        if (!d.nome.trim()) return toast('O nome é obrigatório.', true);
        const saved = await run(() => db.save('produtos', {
          ...(isNew ? {} : { id: p.id }), nome: d.nome.trim(), preco: num(d.preco), custo: num(d.custo), ativo: d.ativo,
          categoria: d.categoria.trim() || null, descricao: d.descricao.trim() || null, detalhes: d.detalhes.trim() || null,
        }), 'Produto guardado');
        if (isNew) { history.replaceState(null, '', `#/produto/${saved.id}`); stack[stack.length - 1] = `#/produto/${saved.id}`; route(); }
      });
      root.querySelector('#apagar')?.addEventListener('click', async () => {
        if (usado) {
          if (!confirm('Este produto aparece em encomendas, por isso fica só desativado (deixa de aparecer no catálogo e nas novas encomendas). Continuar?')) return;
          await run(() => db.save('produtos', { ...p, ativo: false }), 'Produto desativado');
          route();
        } else {
          const n = fotosDe(p.id).length;
          if (!confirm(`Apagar ${p.nome}${n ? ` e as suas ${n} foto(s)` : ''}? Não é possível desfazer.`)) return;
          await run(() => db.remove('produtos', p.id), 'Produto apagado');
          go('#/produtos');
        }
      });
    },
  };
}

/** Visualizador de fotos em ecrã inteiro, com deslizar, "principal" e apagar. */
function viewer(fotos, start, onChange) {
  if (!fotos.length) return;
  const wrap = document.createElement('div');
  wrap.className = 'viewer';
  wrap.innerHTML = `
    <div class="viewer-top"><button class="v-btn" data-close aria-label="Fechar"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button><span id="v-count"></span><span></span></div>
    <div class="viewer-track">${fotos.map((f) => `<div class="viewer-slide">${fotoTag(f, 'full', 'viewer-img', '')}</div>`).join('')}</div>
    <div class="viewer-bottom"><button class="v-btn text" data-principal>★ Principal</button><button class="v-btn text danger" data-del>Apagar</button></div>`;
  document.body.appendChild(wrap);
  const track = wrap.querySelector('.viewer-track');
  const idx = () => Math.round(track.scrollLeft / track.clientWidth);
  const update = () => {
    const i = idx();
    wrap.querySelector('#v-count').textContent = `${i + 1} / ${fotos.length}`;
    const btn = wrap.querySelector('[data-principal]');
    btn.disabled = fotos[i].principal;
    btn.textContent = fotos[i].principal ? '★ Foto principal' : '☆ Tornar principal';
  };
  track.addEventListener('scroll', () => requestAnimationFrame(update), { passive: true });
  requestAnimationFrame(() => { track.scrollLeft = start * track.clientWidth; update(); });
  hydrate(wrap);
  const close = () => { wrap.remove(); onChange?.(); };
  const onKey = (e) => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } };
  document.addEventListener('keydown', onKey);
  wrap.querySelector('[data-close]').addEventListener('click', close);
  wrap.querySelector('[data-principal]').addEventListener('click', async () => {
    await run(() => db.setPrincipal(fotos[idx()]), 'Foto principal definida');
    close();
  });
  wrap.querySelector('[data-del]').addEventListener('click', async () => {
    if (!confirm('Apagar esta foto? Não é possível desfazer.')) return;
    await run(() => db.removeFoto(fotos[idx()]), 'Foto apagada');
    close();
  });
}

// ================= Mais =================
function viewMais() {
  return {
    html: screen({
      title: 'Mais',
      body: `
        <div class="list">
          <button class="item" data-href="#/clientes"><span class="item-main">Clientes</span><span class="item-right">›</span></button>
          <button class="item" data-href="#/relatorios"><span class="item-main">Relatórios</span><span class="item-right">›</span></button>
          <button class="item" data-href="#/calculadora"><span class="item-main">Calculadora de custo</span><span class="item-right">›</span></button>
          <button class="item" data-href="#/materiais"><span class="item-main">Materiais</span><span class="item-right">›</span></button>
        </div>
        <h2 class="section">Aspeto</h2>
        <div class="list plain"><div class="setting"><span>Tema</span>
          ${segmented('tema', [['auto', 'Automático'], ['claro', 'Claro'], ['escuro', 'Escuro']], pref.get('tema', 'auto'))}
        </div></div>
        <div class="list">
          <button class="item" id="atualizar"><span class="item-main">Atualizar dados</span></button>
          <button class="item" id="exportar"><span class="item-main">Exportar cópia de segurança (JSON)</span></button>
          ${db.demo ? `<button class="item" id="reset"><span class="item-main">Repor dados de demonstração</span></button>` : `<button class="item" id="sair"><span class="item-main danger-text">Terminar sessão</span></button>`}
        </div>
        <div class="about"><img src="icons/logo.png" alt="" width="72" height="72"><p>The Macrame Nook<br><small>${db.demo ? 'Modo demonstração' : 'Sessão: ' + esc(currentUser?.email ?? '')}</small></p></div>`,
    }),
    bind(root) {
      bindSeg(root, 'tema', (v) => { pref.set('tema', v); applyTheme(); });
      root.querySelector('#atualizar').addEventListener('click', async () => { await run(() => db.loadAll(), 'Dados atualizados'); });
      root.querySelector('#exportar').addEventListener('click', () => {
        const blob = new Blob([JSON.stringify(cache, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = `macrame-nook-${today()}.json`; a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      });
      root.querySelector('#reset')?.addEventListener('click', async () => {
        if (!confirm('Repor os dados de demonstração?')) return;
        db.resetDemo(); await db.loadAll(); toast('Dados repostos');
      });
      root.querySelector('#sair')?.addEventListener('click', async () => {
        await db.signOut(); location.hash = ''; location.reload();
      });
    },
  };
}

// ================= Despesas =================
function viewDespesas() {
  let q = '';
  let per = pref.get('periodoDesp', 'ano');
  return {
    html: screen({
      title: 'Despesas',
      right: `<button class="bar-btn add" data-href="#/despesa/nova"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>Nova</button>`,
      body: `${searchBox('', 'Procurar despesa')}${segmented('p', [['ano', 'Este ano'], ['anterior', 'Ano passado'], ['tudo', 'Sempre']], per)}<div id="tot"></div><div id="lista"></div>`,
    }),
    bind(root) {
      const draw = () => {
        const p = periodo(per); const qq = norm(q.trim());
        const rows = cache.despesas.filter((d) => noPeriodo(d.data, p) && (!qq || norm(d.descricao).includes(qq)))
          .sort((a, b) => (b.data > a.data ? 1 : b.data < a.data ? -1 : b.id - a.id));
        const total = rows.reduce((s, d) => s + num(d.total), 0);
        root.querySelector('#tot').innerHTML = `<div class="kpis"><div class="kpi wide"><span>Total · ${esc(p.label)}</span><b>${eur(total)}</b></div></div>`;
        const groups = new Map();
        for (const d of rows) { const k = d.data.slice(0, 7); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(d); }
        root.querySelector('#lista').innerHTML = [...groups].map(([k, ds]) => `
          <h2 class="section">${MESES[Number(k.slice(5, 7)) - 1]} ${k.slice(0, 4)}<span>${eur(ds.reduce((s, d) => s + num(d.total), 0))}</span></h2>
          <div class="list">${ds.map((d) => `
            <button class="item" data-href="#/despesa/${d.id}">
              <span class="item-main">${esc(d.descricao || 'Sem descrição')}</span><span class="item-right">${eur(d.total)}</span>
              <span class="item-sub">${fmtDate(d.data)}</span>
            </button>`).join('')}</div>`).join('') || empty('Sem despesas neste período');
        bindCommon();
      };
      bindSearch(root, (v) => { q = v; draw(); });
      bindSeg(root, 'p', (v) => { per = v; pref.set('periodoDesp', v); draw(); });
      draw();
    },
  };
}

function viewDespesa(id) {
  const isNew = id === 'nova';
  const d = isNew ? { data: today(), descricao: '', total: 0 } : byId('despesas', id);
  if (!d) return notFound('#/despesas');
  return {
    html: screen({
      title: isNew ? 'Nova despesa' : 'Despesa', back: '#/despesas',
      right: `<button class="bar-btn strong" id="guardar">Guardar</button>`,
      body: `
        <form id="f" onsubmit="return false">
          <div class="list form">
            ${field('Data', `<input type="date" name="data" value="${esc(d.data)}">`)}
            ${field('Descrição', `<input type="text" name="descricao" value="${esc(d.descricao)}" placeholder="Loja e material" autocomplete="off">`)}
            ${field('Total (€)', `<input type="text" inputmode="decimal" name="total" value="${isNew ? '' : fmt2(d.total)}" placeholder="0,00">`)}
          </div>
          ${isNew ? '' : `<button type="button" class="btn danger" id="apagar">Apagar despesa</button>`}
        </form>`,
    }),
    bind(root) {
      root.querySelector('#guardar').addEventListener('click', async () => {
        const f = formData(root.querySelector('#f'));
        if (!num(f.total)) return toast('Indique o valor.', true);
        await run(() => db.save('despesas', { ...(isNew ? {} : { id: d.id }), data: f.data || today(), descricao: f.descricao.trim() || null, total: num(f.total) }), 'Despesa guardada');
        if (stack.length > 1) history.back(); else go('#/despesas');
      });
      root.querySelector('#apagar')?.addEventListener('click', async () => {
        if (!confirm('Apagar esta despesa?')) return;
        await run(() => db.remove('despesas', d.id), 'Despesa apagada');
        go('#/despesas');
      });
    },
  };
}

// ================= Materiais =================
function viewMateriais() {
  let q = '';
  return {
    html: screen({
      title: 'Materiais', back: '#/mais',
      right: `<button class="bar-btn add" data-href="#/material/novo"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>Novo</button>`,
      body: `${searchBox('', 'Procurar material')}<div class="list" id="lista"></div>`,
    }),
    bind(root) {
      const draw = () => {
        const qq = norm(q.trim());
        root.querySelector('#lista').innerHTML = cache.materiais.filter((m) => !qq || norm(m.nome).includes(qq))
          .sort((a, b) => a.nome.localeCompare(b.nome, 'pt'))
          .map((m) => `<button class="item" data-href="#/material/${m.id}">
            <span class="item-main">${esc(m.nome)}</span><span class="item-right">${eurUn(custoUnitMaterial(m))}/un</span>
            <span class="item-sub">${fmt2(m.quantidade)} un por ${eur(m.preco_total)}</span></button>`).join('') || empty('Nenhum material');
        bindCommon();
      };
      bindSearch(root, (v) => { q = v; draw(); });
      draw();
    },
  };
}

function viewMaterial(id) {
  const isNew = id === 'novo';
  const m = isNew ? { nome: '', quantidade: 1, preco_total: 0 } : byId('materiais', id);
  if (!m) return notFound('#/materiais');
  const usos = isNew ? [] : cache.produto_materiais.filter((x) => x.material_id === m.id)
    .map((x) => ({ x, p: byId('produtos', x.produto_id) })).filter((u) => u.p)
    .sort((a, b) => a.p.nome.localeCompare(b.p.nome, 'pt'));
  return {
    html: screen({
      title: isNew ? 'Novo material' : m.nome, back: '#/materiais',
      right: `<button class="bar-btn strong" id="guardar">Guardar</button>`,
      body: `
        <form id="f" onsubmit="return false">
          <div class="list form">
            ${field('Nome', `<input type="text" name="nome" value="${esc(m.nome)}" autocomplete="off">`)}
            ${field('Quantidade comprada (unidades, metros…)', `<input type="text" inputmode="decimal" name="quantidade" value="${fmt2(m.quantidade)}">`)}
            ${field('Preço pago (€)', `<input type="text" inputmode="decimal" name="preco_total" value="${fmt2(m.preco_total)}">`)}
          </div>
          <div class="kpis"><div class="kpi wide"><span>Custo por unidade</span><b id="unit"></b></div></div>
          ${isNew ? '' : `
            <h2 class="section">Usado em</h2>
            <div class="list">${usos.map(({ x, p }) => `
              <button type="button" class="item with-thumb" data-href="#/produto/${p.id}">
                ${fotoTag(fotoPrincipal(p.id), 'thumb', 'thumb', p.nome)}
                <span class="item-main">${esc(p.nome)}</span>
                <span class="item-right">${eur(custoUnitMaterial(m) * num(x.quantidade))}</span>
                <span class="item-sub">${fmt2(x.quantidade)} un por peça</span>
              </button>`).join('') || empty('Ainda não está associado a nenhum produto')}</div>
            <button type="button" class="btn danger" id="apagar">Apagar material</button>`}
        </form>`,
    }),
    bind(root) {
      const form = root.querySelector('#f');
      const drawUnit = () => { const f = formData(form); root.querySelector('#unit').textContent = eurUn(custoUnitMaterial(f)); };
      form.addEventListener('input', drawUnit); drawUnit();
      root.querySelector('#guardar').addEventListener('click', async () => {
        const f = formData(form);
        if (!f.nome.trim()) return toast('O nome é obrigatório.', true);
        await run(() => db.save('materiais', { ...(isNew ? {} : { id: m.id }), nome: f.nome.trim(), quantidade: num(f.quantidade) || 1, preco_total: num(f.preco_total) }), 'Material guardado');
        if (stack.length > 1) history.back(); else go('#/materiais');
      });
      root.querySelector('#apagar')?.addEventListener('click', async () => {
        const msg = usos.length
          ? `${m.nome} é usado em ${usos.length} produto(s) e será retirado da lista de materiais desses produtos. Apagar mesmo assim?`
          : `Apagar ${m.nome}?`;
        if (!confirm(msg)) return;
        await run(() => db.remove('materiais', m.id), 'Material apagado');
        go('#/materiais');
      });
    },
  };
}

// ================= Calculadora =================
function viewCalculadora(_, query) {
  const alvo = query.produto ? byId('produtos', query.produto) : null;
  // Com produto: começar pela lista guardada desse produto.
  const itens = alvo ? materiaisDe(alvo.id).map((x) => ({ id: x.material_id, qt: num(x.quantidade) })) : [];
  let margem = alvo?.margem != null ? num(alvo.margem) : num(pref.get('margem', '35'));
  const extraInicial = alvo ? num(alvo.custo_extra) : 0;
  return {
    html: screen({
      title: 'Calculadora', back: alvo ? `#/produto/${alvo.id}` : '#/mais',
      body: `
        ${alvo ? `<p class="hint">Para o produto: <b>${esc(alvo.nome)}</b>${itens.length ? ' · lista guardada carregada' : ''}</p>` : ''}
        <h2 class="section">Materiais usados</h2>
        <div id="itens"></div>
        <button type="button" class="btn ghost" id="add">+ Adicionar material</button>
        <div class="list form">
          ${field('Outros custos (€) — embalagem, portes, tempo…', `<input type="text" inputmode="decimal" id="extra" value="${fmt2(extraInicial)}">`)}
          ${field('Margem (%)', `<input type="text" inputmode="decimal" id="margem" value="${fmt2(margem)}">`)}
        </div>
        <div class="kpis">
          <div class="kpi"><span>Custo de produção</span><b id="custo"></b></div>
          <div class="kpi"><span>Preço de venda sugerido</span><b id="pvp"></b></div>
        </div>
        <button type="button" class="btn" id="aplicar">${alvo ? `Guardar em “${esc(alvo.nome)}”` : 'Guardar num produto…'}</button>`,
    }),
    bind(root) {
      const calc = () => {
        const extra = num(root.querySelector('#extra').value);
        const custo = itens.reduce((s, i) => s + custoUnitMaterial(byId('materiais', i.id) ?? {}) * num(i.qt), 0) + extra;
        margem = num(root.querySelector('#margem').value);
        pref.set('margem', String(margem));
        const pvp = custo * (1 + margem / 100);
        root.querySelector('#custo').textContent = eur(custo);
        root.querySelector('#pvp').textContent = eur(pvp);
        return { custo: round2(custo), pvp: round2(pvp), extra: round2(extra) };
      };
      const draw = () => {
        root.querySelector('#itens').innerHTML = itens.map((i, k) => {
          const m = byId('materiais', i.id);
          return `<div class="line-card" data-k="${k}">
            <div class="line-top"><b class="grow">${esc(m?.nome ?? 'Material removido')}</b><button type="button" class="icon-btn" data-del aria-label="Remover"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
            <div class="line-grid"><label class="price">Qt <input type="text" inputmode="decimal" data-qt value="${fmt2(i.qt)}"></label>
            <span class="muted">× ${eurUn(custoUnitMaterial(m ?? {}))} = <b data-sub>${eur(custoUnitMaterial(m ?? {}) * num(i.qt))}</b></span></div></div>`;
        }).join('') || empty('Adicione os materiais usados numa peça');
        calc();
      };
      root.querySelector('#itens').addEventListener('input', (ev) => {
        const card = ev.target.closest('.line-card');
        if (!card || !ev.target.hasAttribute('data-qt')) return;
        const i = itens[card.dataset.k];
        i.qt = num(ev.target.value);
        card.querySelector('[data-sub]').textContent = eur(custoUnitMaterial(byId('materiais', i.id) ?? {}) * i.qt);
        calc();
      });
      root.querySelector('#itens').addEventListener('click', (ev) => {
        const card = ev.target.closest('.line-card');
        if (card && ev.target.closest('[data-del]')) { itens.splice(Number(card.dataset.k), 1); draw(); }
      });
      root.querySelector('#extra').addEventListener('input', calc);
      root.querySelector('#margem').addEventListener('input', calc);
      root.querySelector('#add').addEventListener('click', async () => {
        const r = await pick({ title: 'Material', allowNew: true, items: [...cache.materiais].sort((a, b) => a.nome.localeCompare(b.nome, 'pt')).map((m) => ({ id: m.id, label: m.nome, sub: `${eurUn(custoUnitMaterial(m))}/un` })) });
        if (!r) return;
        let matId = r.id;
        if (r.novo) {
          const qt = num(prompt(`Quantidade comprada de “${r.novo}” (unidades, metros…):`, '1')) || 1;
          const preco = num(prompt('Quanto pagou por essa quantidade (€)?', '0'));
          matId = (await run(() => db.save('materiais', { nome: r.novo, quantidade: qt, preco_total: preco }), 'Material criado')).id;
        }
        if (itens.some((i) => i.id === matId)) { toast('Esse material já está na lista — altere a quantidade.'); return; }
        itens.push({ id: matId, qt: 1 }); draw();
      });
      root.querySelector('#aplicar').addEventListener('click', async () => {
        const { custo, pvp, extra } = calc();
        let p = alvo;
        if (!p) {
          const r = await pick({ title: 'Guardar no produto', allowNew: true, items: [...cache.produtos].sort((a, b) => a.nome.localeCompare(b.nome, 'pt')).map((x) => ({ id: x.id, label: x.nome, sub: `${eur(x.preco)} · custo ${eur(x.custo)}`, foto: fotoPrincipal(x.id) })) });
          if (!r) return;
          p = r.novo ? { nome: r.novo, preco: pvp, custo, ativo: true } : byId('produtos', r.id);
          if (p.id != null && materiaisDe(p.id).length && !confirm(`“${p.nome}” já tem uma lista de materiais guardada. Substituir pela atual?`)) return;
        }
        const mudarPreco = p.id == null || confirm(`Custo de produção de “${p.nome}”: ${eur(custo)}.\n\nAtualizar também o preço de venda para ${eur(pvp)}? (Cancelar = manter ${eur(p.preco)})`);
        const btn = root.querySelector('#aplicar'); btn.disabled = true;
        try {
          const saved = await run(async () => {
            const prod = await db.save('produtos', { ...p, custo, custo_extra: extra, margem, preco: mudarPreco ? pvp : p.preco });
            await db.saveProdutoMateriais(prod.id, itens.filter((i) => byId('materiais', i.id)).map((i) => ({ material_id: i.id, quantidade: num(i.qt) })));
            return prod;
          }, 'Custo e materiais guardados');
          if (alvo && stack.length > 1) history.back(); else go(`#/produto/${saved.id}`);
        } catch { btn.disabled = false; }
      });
      draw();
    },
  };
}

// ================= Relatórios =================
function viewRelatorios() {
  let per = pref.get('periodoRel', 'ano');
  return {
    html: screen({
      title: 'Relatórios', back: '#/mais',
      body: `${segmented('p', [['ano', 'Este ano'], ['anterior', 'Ano passado'], ['tudo', 'Sempre']], per)}<div id="rel"></div>`,
    }),
    bind(root) {
      const draw = () => {
        const p = periodo(per);
        const pagas = cache.encomendas.filter((e) => e.pago && noPeriodo(e.data, p));
        // Vendas por mês
        const meses = new Map();
        for (const e of pagas) { const k = e.data.slice(0, 7); meses.set(k, (meses.get(k) ?? 0) + totalEnc(e)); }
        const despMes = new Map();
        for (const d of cache.despesas.filter((x) => noPeriodo(x.data, p))) { const k = d.data.slice(0, 7); despMes.set(k, (despMes.get(k) ?? 0) + num(d.total)); }
        const keys = [...new Set([...meses.keys(), ...despMes.keys()])].sort().reverse();
        const max = Math.max(1, ...keys.map((k) => Math.max(meses.get(k) ?? 0, despMes.get(k) ?? 0)));
        // Clientes
        const cli = new Map();
        for (const e of pagas) cli.set(e.cliente_id, (cli.get(e.cliente_id) ?? 0) + totalEnc(e));
        const topCli = [...cli].sort((a, b) => b[1] - a[1]).slice(0, 15);
        const prods = topProdutos(pagas);

        root.querySelector('#rel').innerHTML = `
          <h2 class="section">Por mês<span class="legend"><i class="lg-v"></i>vendas <i class="lg-d"></i>despesas</span></h2>
          <div class="list bars">${keys.map((k) => `
            <div class="bar-row"><span class="bar-label">${MESES[Number(k.slice(5, 7)) - 1].slice(0, 3)} ${k.slice(2, 4)}</span>
              <div class="bar-track"><div class="bar-v" style="width:${((meses.get(k) ?? 0) / max) * 100}%"></div><div class="bar-d" style="width:${((despMes.get(k) ?? 0) / max) * 100}%"></div></div>
              <span class="bar-val">${eur(meses.get(k) ?? 0)}<br><small>${eur(despMes.get(k) ?? 0)}</small></span></div>`).join('') || empty('Sem dados')}</div>

          <h2 class="section">Produtos vendidos</h2>
          <div class="list">${prods.map((t) => `<div class="item static"><span class="item-main">${esc(t.nome)}</span><span class="item-right">${t.qt} un · ${eur(t.total)}</span></div>`).join('') || empty('Sem vendas')}</div>

          <h2 class="section">Melhores clientes</h2>
          <div class="list">${topCli.map(([id, v]) => `<button class="item" ${id ? `data-href="#/cliente/${id}"` : ''}><span class="item-main">${esc(clienteNome(id))}</span><span class="item-right">${eur(v)}</span></button>`).join('') || empty('Sem vendas')}</div>`;
        bindCommon();
      };
      bindSeg(root, 'p', (v) => { per = v; pref.set('periodoRel', v); draw(); });
      draw();
    },
  };
}

function notFound(back) {
  return { html: screen({ title: 'Não encontrado', back, body: empty('Este registo já não existe.') }) };
}

// ================= Login e arranque =================
let currentUser = null;

function showLogin(errMsg = '') {
  $tabs.hidden = true;
  $view.innerHTML = `
    <main class="login">
      <img src="icons/logo.png" alt="The Macrame Nook" width="140" height="140">
      <form id="login" class="list form">
        ${field('Email', `<input type="email" name="email" autocomplete="username" required>`)}
        ${field('Palavra-passe', `<input type="password" name="password" autocomplete="current-password" required>`)}
      </form>
      <p class="error" id="err">${esc(errMsg)}</p>
      <button class="btn" form="login" type="submit">Entrar</button>
    </main>`;
  $view.querySelector('#login').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = formData(ev.target);
    const btn = $view.querySelector('button[type=submit]'); btn.disabled = true; btn.textContent = 'A entrar…';
    try {
      await db.signIn(f.email.trim(), f.password);
      await start();
    } catch (e) {
      showLogin(e.message);
    }
  });
}

async function start() {
  currentUser = await db.getUser();
  if (!currentUser) return showLogin();
  $view.innerHTML = `<div class="loading"><img src="icons/logo.png" alt="" width="96" height="96"><p>A carregar…</p></div>`;
  try {
    await db.loadAll();
  } catch (e) {
    $view.innerHTML = `<div class="loading"><p>Não foi possível carregar os dados.<br><small>${esc(e.message)}</small></p><button class="btn" onclick="location.reload()">Tentar novamente</button></div>`;
    return;
  }
  window.addEventListener('hashchange', () => route());
  // Ao voltar à app (ex.: a outra pessoa fez alterações), recarregar os dados se não estiver a editar.
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', async () => {
    if (document.hidden) { hiddenAt = Date.now(); return; }
    if (Date.now() - hiddenAt < 30_000) return;
    const editing = /\/(encomenda|cliente|produto|despesa|material)\/|calculadora/.test(location.hash);
    try { await db.loadAll(); if (!editing) route(); } catch { /* sem rede */ }
  });
  route();
}

(async () => {
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js');
  try {
    await db.init();
  } catch {
    $view.innerHTML = `<div class="loading"><p>Sem ligação à internet.</p><button class="btn" onclick="location.reload()">Tentar novamente</button></div>`;
    return;
  }
  start();
})();
