import * as db from './db.js';
import { PESSOAS } from '../config.js';

const { cache } = db;
const $view = document.getElementById('view');
const $tabs = document.getElementById('tabs');

// ================= Utilitários =================
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' });
const eur = (n) => money.format(Number(n) || 0);
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

function periodo(key) {
  const y = new Date().getFullYear();
  if (key === 'ano') return { de: `${y}-01-01`, ate: `${y}-12-31`, label: String(y) };
  if (key === 'anterior') return { de: `${y - 1}-01-01`, ate: `${y - 1}-12-31`, label: String(y - 1) };
  return { de: '0000-01-01', ate: '9999-12-31', label: 'Sempre' };
}
const noPeriodo = (data, p) => data >= p.de && data <= p.ate;

// ================= Componentes =================
function screen({ title, back, right = '', body, large = !back }) {
  return `
    <header class="bar${large ? ' bar-large' : ''}">
      <div class="bar-side">${back ? `<button class="bar-btn" data-back="${esc(back)}"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>Voltar</button>` : ''}</div>
      <div class="bar-title">${large ? '' : esc(title)}</div>
      <div class="bar-side right">${right}</div>
    </header>
    <main class="content">
      ${large ? `<h1 class="large">${esc(title)}</h1>` : ''}
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

/** Folha de escolha com pesquisa (clientes, produtos, materiais). */
function pick({ title, items, allowNew = false }) {
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
        (allowNew && q ? `<button class="item add" data-new><span class="item-main">+ Criar “${esc(input.value.trim())}”</span></button>` : '') +
        found.map((i) => `<button class="item" data-id="${i.id}"><span class="item-main">${esc(i.label)}</span>${i.sub ? `<span class="item-sub">${esc(i.sub)}</span>` : ''}</button>`).join('') +
        (!found.length && !(allowNew && q) ? empty('Sem resultados') : '');
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
  [/^\/clientes$/, viewClientes, 'clientes'],
  [/^\/cliente\/(\w+)$/, viewCliente, 'clientes'],
  [/^\/produtos$/, viewProdutos, 'produtos'],
  [/^\/produto\/(\w+)$/, viewProduto, 'produtos'],
  [/^\/mais$/, viewMais, 'mais'],
  [/^\/despesas$/, viewDespesas, 'mais'],
  [/^\/despesa\/(\w+)$/, viewDespesa, 'mais'],
  [/^\/materiais$/, viewMateriais, 'mais'],
  [/^\/material\/(\w+)$/, viewMaterial, 'mais'],
  [/^\/calculadora$/, viewCalculadora, 'mais'],
  [/^\/relatorios$/, viewRelatorios, 'mais'],
];

function go(hash) { location.hash = hash; }

function route() {
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
    $view.scrollTop = 0;
    window.scrollTo(0, 0);
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
  const per = pref.get('periodo', 'ano');
  return {
    html: screen({
      title: 'The Macrame Nook',
      right: `<button class="bar-btn" data-href="#/encomenda/nova">+ Nova</button>`,
      body: `
        ${db.demo ? `<div class="banner">Modo demonstração — dados fictícios guardados só neste dispositivo. Configure o Supabase em <code>config.js</code>.</div>` : ''}
        ${segmented('periodo', [['ano', 'Este ano'], ['anterior', 'Ano passado'], ['tudo', 'Sempre']], per)}
        <div id="dash"></div>`,
    }),
    bind(root) {
      const draw = (key) => { root.querySelector('#dash').innerHTML = dashboard(key); bindCommon(); };
      bindSeg(root, 'periodo', (v) => { pref.set('periodo', v); draw(v); });
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
      <div class="kpi"><span>Vendas pagas</span><b>${eur(vendas)}</b></div>
      <div class="kpi"><span>Despesas</span><b>${eur(despesas)}</b></div>
      <div class="kpi wide ${vendas - despesas >= 0 ? 'pos' : 'neg'}"><span>Lucro · ${esc(p.label)}</span><b>${eur(vendas - despesas)}</b></div>
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
      <span class="item-right">${eur(totalLinhas(ls))}</span>
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
      right: `<button class="bar-btn" data-href="#/encomenda/nova">+ Nova</button>`,
      body: `
        ${searchBox('', 'Cliente, nº ou descrição')}
        ${segmented('f', [['curso', 'Em curso'], ['pagar', 'Por pagar'], ['enviar', 'Por enviar'], ['concluidas', 'Concluídas'], ['todas', 'Todas']], f)}
        <p class="hint" id="count"></p>
        <div class="list" id="lista"></div>`,
    }),
    bind(root) {
      const draw = () => {
        const qq = norm(q.trim());
        const rows = cache.encomendas.filter(filtros[f]).filter((e) => !qq ||
          norm(clienteNome(e.cliente_id)).includes(qq) || String(e.id) === qq.replace('#', '') ||
          norm(e.notas).includes(qq) || linhasDe(e.id).some((l) => norm(l.descricao).includes(qq) || norm(produtoNome(l.produto_id)).includes(qq)))
          .sort(sortEnc);
        root.querySelector('#count').textContent = `${rows.length} ${rows.length === 1 ? 'encomenda' : 'encomendas'} · ${eur(rows.reduce((s, e) => s + totalEnc(e), 0))}`;
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
          title: 'Cliente', allowNew: true,
          items: [...cache.clientes].sort((a, b) => a.nome.localeCompare(b.nome, 'pt')).map((c) => ({ id: c.id, label: c.nome, sub: c.contacto })),
        });
        if (!r) return;
        if (r.novo) {
          const c = await run(() => db.save('clientes', { nome: r.novo }), 'Cliente criado');
          enc.cliente_id = c.id;
        } else enc.cliente_id = r.id;
        showCliente();
      });

      const drawLinhas = () => {
        const box = root.querySelector('#linhas');
        box.innerHTML = linhas.map((l, i) => `
          <div class="line-card" data-i="${i}">
            <div class="line-top">
              <b>${esc(produtoNome(l.produto_id))}</b>
              <button type="button" class="icon-btn" data-del aria-label="Remover"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
            </div>
            <input type="text" data-k="descricao" value="${esc(l.descricao)}" placeholder="Descrição (cor, nome, tamanho…)">
            <div class="line-grid">
              <div class="stepper"><button type="button" data-step="-1">−</button><input type="text" inputmode="numeric" data-k="quantidade" value="${l.quantidade}"><button type="button" data-step="1">+</button></div>
              <label class="price">€ <input type="text" inputmode="decimal" data-k="preco_unit" value="${fmt2(l.preco_unit)}"></label>
              <label class="mini-toggle"><input type="checkbox" class="switch" data-k="executado" ${l.executado ? 'checked' : ''}><span>Feito</span></label>
            </div>
          </div>`).join('') || empty('Ainda sem produtos');
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
            .map((p) => ({ id: p.id, label: p.nome, sub: eur(p.preco) })),
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
      title: 'Clientes',
      right: `<button class="bar-btn" data-href="#/cliente/novo">+ Novo</button>`,
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
  let f = pref.get('filtroProd', 'ativos');
  return {
    html: screen({
      title: 'Produtos',
      right: `<button class="bar-btn" data-href="#/produto/novo">+ Novo</button>`,
      body: `${searchBox('', 'Procurar produto')}${segmented('f', [['ativos', 'Ativos'], ['vendidos', 'Mais vendidos'], ['todos', 'Todos']], f)}<div class="list" id="lista"></div>`,
    }),
    bind(root) {
      const vend = vendidosPorProduto();
      const draw = () => {
        const qq = norm(q.trim());
        let rows = cache.produtos.filter((p) => (f === 'todos' || p.ativo !== false) && (!qq || norm(p.nome).includes(qq)));
        rows = f === 'vendidos'
          ? rows.sort((a, b) => (vend.get(b.id)?.qt ?? 0) - (vend.get(a.id)?.qt ?? 0))
          : rows.sort((a, b) => a.nome.localeCompare(b.nome, 'pt'));
        root.querySelector('#lista').innerHTML = rows.map((p) => {
          const margem = num(p.preco) - num(p.custo);
          return `<button class="item" data-href="#/produto/${p.id}">
            <span class="item-main">${esc(p.nome)}${p.ativo === false ? ' <span class="chip">inativo</span>' : ''}</span>
            <span class="item-right">${eur(p.preco)}</span>
            <span class="item-sub">custo ${eur(p.custo)} · margem ${eur(margem)} · ${vend.get(p.id)?.qt ?? 0} vendidos</span>
          </button>`;
        }).join('') || empty('Nenhum produto');
        bindCommon();
      };
      bindSearch(root, (v) => { q = v; draw(); });
      bindSeg(root, 'f', (v) => { f = v; pref.set('filtroProd', v); draw(); });
      draw();
    },
  };
}

function viewProduto(id) {
  const isNew = id === 'novo';
  const p = isNew ? { nome: '', preco: 0, custo: 0, ativo: true } : byId('produtos', id);
  if (!p) return notFound('#/produtos');
  const v = vendidosPorProduto().get(p.id) ?? { qt: 0, total: 0 };
  const usado = !isNew && cache.encomenda_linhas.some((l) => l.produto_id === p.id);
  return {
    html: screen({
      title: isNew ? 'Novo produto' : p.nome,
      back: '#/produtos',
      right: `<button class="bar-btn strong" id="guardar">Guardar</button>`,
      body: `
        <form id="f" onsubmit="return false">
          <div class="list form">
            ${field('Nome', `<input type="text" name="nome" value="${esc(p.nome)}" autocomplete="off">`)}
            ${field('Preço de venda (€)', `<input type="text" inputmode="decimal" name="preco" value="${fmt2(p.preco)}">`)}
            ${field('Custo de produção (€)', `<input type="text" inputmode="decimal" name="custo" value="${fmt2(p.custo)}">`)}
            ${toggle('Ativo (aparece nas novas encomendas)', 'ativo', p.ativo !== false)}
          </div>
          <div class="kpis">
            <div class="kpi"><span>Margem</span><b id="margem"></b></div>
            ${isNew ? '' : `<div class="kpi"><span>Vendidos</span><b>${v.qt} · ${eur(v.total)}</b></div>`}
          </div>
          <button type="button" class="btn ghost" data-href="#/calculadora${isNew ? '' : `?produto=${p.id}`}">Calcular custo com materiais</button>
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
      root.querySelector('#guardar').addEventListener('click', async () => {
        const d = formData(form);
        if (!d.nome.trim()) return toast('O nome é obrigatório.', true);
        const saved = await run(() => db.save('produtos', { ...(isNew ? {} : { id: p.id }), nome: d.nome.trim(), preco: num(d.preco), custo: num(d.custo), ativo: d.ativo }), 'Produto guardado');
        if (isNew) { history.replaceState(null, '', `#/produto/${saved.id}`); stack[stack.length - 1] = `#/produto/${saved.id}`; route(); }
      });
      root.querySelector('#apagar')?.addEventListener('click', async () => {
        if (usado) {
          if (!confirm('Este produto aparece em encomendas, por isso fica só desativado (deixa de aparecer nas novas encomendas). Continuar?')) return;
          await run(() => db.save('produtos', { ...p, ativo: false }), 'Produto desativado');
          route();
        } else {
          if (!confirm(`Apagar ${p.nome}?`)) return;
          await run(() => db.remove('produtos', p.id), 'Produto apagado');
          go('#/produtos');
        }
      });
    },
  };
}

// ================= Mais =================
function viewMais() {
  return {
    html: screen({
      title: 'Mais',
      body: `
        <div class="list">
          <button class="item" data-href="#/despesas"><span class="item-main">Despesas</span><span class="item-right">›</span></button>
          <button class="item" data-href="#/relatorios"><span class="item-main">Relatórios</span><span class="item-right">›</span></button>
          <button class="item" data-href="#/calculadora"><span class="item-main">Calculadora de custo</span><span class="item-right">›</span></button>
          <button class="item" data-href="#/materiais"><span class="item-main">Materiais</span><span class="item-right">›</span></button>
        </div>
        <div class="list">
          <button class="item" id="atualizar"><span class="item-main">Atualizar dados</span></button>
          <button class="item" id="exportar"><span class="item-main">Exportar cópia de segurança (JSON)</span></button>
          ${db.demo ? `<button class="item" id="reset"><span class="item-main">Repor dados de demonstração</span></button>` : `<button class="item" id="sair"><span class="item-main danger-text">Terminar sessão</span></button>`}
        </div>
        <div class="about"><img src="icons/logo.png" alt="" width="72" height="72"><p>The Macrame Nook<br><small>${db.demo ? 'Modo demonstração' : 'Sessão: ' + esc(currentUser?.email ?? '')}</small></p></div>`,
    }),
    bind(root) {
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
      title: 'Despesas', back: '#/mais',
      right: `<button class="bar-btn" data-href="#/despesa/nova">+ Nova</button>`,
      body: `${searchBox('', 'Procurar despesa')}${segmented('p', [['ano', 'Este ano'], ['anterior', 'Ano passado'], ['tudo', 'Sempre']], per)}<div id="tot"></div><div id="lista"></div>`,
    }),
    bind(root) {
      const draw = () => {
        const p = periodo(per); const qq = norm(q.trim());
        const rows = cache.despesas.filter((d) => noPeriodo(d.data, p) && (!qq || norm(d.descricao).includes(qq)))
          .sort((a, b) => (b.data > a.data ? 1 : b.data < a.data ? -1 : b.id - a.id));
        const total = rows.reduce((s, d) => s + num(d.total), 0);
        const porPessoa = PESSOAS.map((n) => [n, rows.filter((d) => d.pago_por === n).reduce((s, d) => s + num(d.total), 0)]);
        root.querySelector('#tot').innerHTML = `<div class="kpis"><div class="kpi wide"><span>Total · ${esc(p.label)}</span><b>${eur(total)}</b></div>
          ${porPessoa.map(([n, v]) => `<div class="kpi"><span>Pago por ${esc(n)}</span><b>${eur(v)}</b></div>`).join('')}</div>`;
        const groups = new Map();
        for (const d of rows) { const k = d.data.slice(0, 7); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(d); }
        root.querySelector('#lista').innerHTML = [...groups].map(([k, ds]) => `
          <h2 class="section">${MESES[Number(k.slice(5, 7)) - 1]} ${k.slice(0, 4)}<span>${eur(ds.reduce((s, d) => s + num(d.total), 0))}</span></h2>
          <div class="list">${ds.map((d) => `
            <button class="item" data-href="#/despesa/${d.id}">
              <span class="item-main">${esc(d.descricao || 'Sem descrição')}</span><span class="item-right">${eur(d.total)}</span>
              <span class="item-sub">${fmtDate(d.data)}${d.pago_por ? ' · ' + esc(d.pago_por) : ''}</span>
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
  const d = isNew ? { data: today(), descricao: '', total: 0, pago_por: null } : byId('despesas', id);
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
          <h2 class="section">Pago por</h2>
          ${segmented('pp', [['', '—'], ...PESSOAS.map((n) => [n, n])], d.pago_por ?? '')}
          ${isNew ? '' : `<button type="button" class="btn danger" id="apagar">Apagar despesa</button>`}
        </form>`,
    }),
    bind(root) {
      let pagoPor = d.pago_por ?? '';
      bindSeg(root, 'pp', (v) => { pagoPor = v; });
      root.querySelector('#guardar').addEventListener('click', async () => {
        const f = formData(root.querySelector('#f'));
        if (!num(f.total)) return toast('Indique o valor.', true);
        await run(() => db.save('despesas', { ...(isNew ? {} : { id: d.id }), data: f.data || today(), descricao: f.descricao.trim() || null, total: num(f.total), pago_por: pagoPor || null }), 'Despesa guardada');
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
      right: `<button class="bar-btn" data-href="#/material/novo">+ Novo</button>`,
      body: `${searchBox('', 'Procurar material')}<div class="list" id="lista"></div>`,
    }),
    bind(root) {
      const draw = () => {
        const qq = norm(q.trim());
        root.querySelector('#lista').innerHTML = cache.materiais.filter((m) => !qq || norm(m.nome).includes(qq))
          .sort((a, b) => a.nome.localeCompare(b.nome, 'pt'))
          .map((m) => `<button class="item" data-href="#/material/${m.id}">
            <span class="item-main">${esc(m.nome)}</span><span class="item-right">${eur(custoUnitMaterial(m))}/un</span>
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
          ${isNew ? '' : `<button type="button" class="btn danger" id="apagar">Apagar material</button>`}
        </form>`,
    }),
    bind(root) {
      const form = root.querySelector('#f');
      const drawUnit = () => { const f = formData(form); root.querySelector('#unit').textContent = eur(custoUnitMaterial(f)); };
      form.addEventListener('input', drawUnit); drawUnit();
      root.querySelector('#guardar').addEventListener('click', async () => {
        const f = formData(form);
        if (!f.nome.trim()) return toast('O nome é obrigatório.', true);
        await run(() => db.save('materiais', { ...(isNew ? {} : { id: m.id }), nome: f.nome.trim(), quantidade: num(f.quantidade) || 1, preco_total: num(f.preco_total) }), 'Material guardado');
        if (stack.length > 1) history.back(); else go('#/materiais');
      });
      root.querySelector('#apagar')?.addEventListener('click', async () => {
        if (!confirm(`Apagar ${m.nome}?`)) return;
        await run(() => db.remove('materiais', m.id), 'Material apagado');
        go('#/materiais');
      });
    },
  };
}

// ================= Calculadora =================
function viewCalculadora(_, query) {
  const alvo = query.produto ? byId('produtos', query.produto) : null;
  const itens = [];
  let margem = num(pref.get('margem', '35'));
  return {
    html: screen({
      title: 'Calculadora', back: alvo ? `#/produto/${alvo.id}` : '#/mais',
      body: `
        ${alvo ? `<p class="hint">Para o produto: <b>${esc(alvo.nome)}</b></p>` : ''}
        <h2 class="section">Materiais usados</h2>
        <div id="itens"></div>
        <button type="button" class="btn ghost" id="add">+ Adicionar material</button>
        <div class="list form">
          ${field('Outros custos (€) — embalagem, portes, tempo…', `<input type="text" inputmode="decimal" id="extra" value="0">`)}
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
        const custo = itens.reduce((s, i) => s + custoUnitMaterial(byId('materiais', i.id) ?? {}) * num(i.qt), 0) + num(root.querySelector('#extra').value);
        margem = num(root.querySelector('#margem').value);
        pref.set('margem', String(margem));
        const pvp = custo * (1 + margem / 100);
        root.querySelector('#custo').textContent = eur(custo);
        root.querySelector('#pvp').textContent = eur(pvp);
        return { custo: Math.round(custo * 100) / 100, pvp: Math.round(pvp * 100) / 100 };
      };
      const draw = () => {
        root.querySelector('#itens').innerHTML = itens.map((i, k) => {
          const m = byId('materiais', i.id);
          return `<div class="line-card" data-k="${k}">
            <div class="line-top"><b>${esc(m?.nome)}</b><button type="button" class="icon-btn" data-del aria-label="Remover"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
            <div class="line-grid"><label class="price">Qt <input type="text" inputmode="decimal" data-qt value="${fmt2(i.qt)}"></label>
            <span class="muted">× ${eur(custoUnitMaterial(m))} = <b>${eur(custoUnitMaterial(m) * num(i.qt))}</b></span></div></div>`;
        }).join('') || empty('Adicione os materiais usados numa peça');
        calc();
      };
      root.querySelector('#itens').addEventListener('change', (ev) => {
        const card = ev.target.closest('.line-card');
        if (card && ev.target.hasAttribute('data-qt')) { itens[card.dataset.k].qt = num(ev.target.value); draw(); }
      });
      root.querySelector('#itens').addEventListener('click', (ev) => {
        const card = ev.target.closest('.line-card');
        if (card && ev.target.closest('[data-del]')) { itens.splice(Number(card.dataset.k), 1); draw(); }
      });
      root.querySelector('#extra').addEventListener('input', calc);
      root.querySelector('#margem').addEventListener('input', calc);
      root.querySelector('#add').addEventListener('click', async () => {
        const r = await pick({ title: 'Material', items: [...cache.materiais].sort((a, b) => a.nome.localeCompare(b.nome, 'pt')).map((m) => ({ id: m.id, label: m.nome, sub: `${eur(custoUnitMaterial(m))}/un` })) });
        if (!r) return;
        itens.push({ id: r.id, qt: 1 }); draw();
      });
      root.querySelector('#aplicar').addEventListener('click', async () => {
        const { custo, pvp } = calc();
        let p = alvo;
        if (!p) {
          const r = await pick({ title: 'Guardar no produto', allowNew: true, items: [...cache.produtos].sort((a, b) => a.nome.localeCompare(b.nome, 'pt')).map((x) => ({ id: x.id, label: x.nome, sub: `${eur(x.preco)} · custo ${eur(x.custo)}` })) });
          if (!r) return;
          p = r.novo ? { nome: r.novo, preco: pvp, custo, ativo: true } : byId('produtos', r.id);
        }
        const mudarPreco = p.id == null || confirm(`Custo de produção de “${p.nome}”: ${eur(custo)}.\n\nAtualizar também o preço de venda para ${eur(pvp)}? (Cancelar = manter ${eur(p.preco)})`);
        const saved = await run(() => db.save('produtos', { ...p, custo, preco: mudarPreco ? pvp : p.preco }), 'Produto atualizado');
        go(`#/produto/${saved.id}`);
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
  window.addEventListener('hashchange', route);
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
