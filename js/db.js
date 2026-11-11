// Camada de dados: Supabase (partilhado na nuvem) ou modo demonstração (localStorage).
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';

export const TABLES = ['clientes', 'produtos', 'encomendas', 'encomenda_linhas', 'despesas', 'materiais', 'produto_fotos', 'produto_materiais'];
const BUCKET = 'fotos';
// "?demo" no endereço força o modo demonstração (útil para testar sem tocar nos dados reais).
export const demo = !SUPABASE_URL || !SUPABASE_ANON_KEY || new URLSearchParams(location.search).has('demo');

/** Dados em memória: { clientes: [...], produtos: [...], ... } */
export const cache = Object.fromEntries(TABLES.map((t) => [t, []]));

let sb = null;
const DEMO_KEY = 'tmn-demo-v1';

export async function init() {
  if (demo) return;
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/+esm');
  sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: 'tmn-auth' },
  });
}

// ---------- Autenticação ----------
export async function getUser() {
  if (demo) return { email: 'demonstração' };
  const { data } = await sb.auth.getSession();
  return data.session?.user ?? null;
}
export async function signIn(email, password) {
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message === 'Invalid login credentials' ? 'Email ou palavra-passe errados.' : error.message);
}
export async function signOut() {
  if (!demo) await sb.auth.signOut();
}

// ---------- Leitura ----------
export async function loadAll() {
  if (demo) {
    const saved = readDemo();
    for (const t of TABLES) cache[t] = saved[t] ?? [];
    return;
  }
  const results = await Promise.all(TABLES.map(fetchAllRows));
  TABLES.forEach((t, i) => { cache[t] = results[i]; });
}

async function fetchAllRows(table) {
  const page = 1000;
  let from = 0;
  const rows = [];
  for (;;) {
    const { data, error } = await sb.from(table).select('*').order('id').range(from, from + page - 1);
    if (error) throw new Error(error.message);
    rows.push(...data);
    if (data.length < page) return rows;
    from += page;
  }
}

// ---------- Escrita ----------
/** Insere (sem id) ou atualiza (com id). Devolve a linha guardada. */
export async function save(table, row) {
  const clean = { ...row };
  let saved;
  if (demo) {
    if (clean.id == null) clean.id = nextId(table);
    saved = clean;
  } else if (clean.id == null) {
    delete clean.id;
    const { data, error } = await sb.from(table).insert(clean).select().single();
    if (error) throw new Error(error.message);
    saved = data;
  } else {
    const { id, ...rest } = clean;
    const { data, error } = await sb.from(table).update(rest).eq('id', id).select().single();
    if (error) throw new Error(error.message);
    saved = data;
  }
  const list = cache[table];
  const i = list.findIndex((r) => r.id === saved.id);
  const prev = i >= 0 ? list[i] : null;
  if (i >= 0) list[i] = saved; else list.push(saved);
  if (demo) {
    try { writeDemo(); } catch (e) {
      if (prev) list[i] = prev; else list.splice(list.indexOf(saved), 1);
      throw e;
    }
  }
  return saved;
}

export async function remove(table, id) {
  if (table === 'produtos') {
    for (const f of cache.produto_fotos.filter((x) => x.produto_id === id)) await removeFoto(f);
  }
  if (!demo) {
    const { error } = await sb.from(table).delete().eq('id', id);
    if (error) throw new Error(error.message);
  }
  cache[table] = cache[table].filter((r) => r.id !== id);
  // Replicar os efeitos das chaves estrangeiras na cópia em memória.
  if (table === 'encomendas') cache.encomenda_linhas = cache.encomenda_linhas.filter((l) => l.encomenda_id !== id);
  if (table === 'clientes') cache.encomendas.forEach((e) => { if (e.cliente_id === id) e.cliente_id = null; });
  if (table === 'produtos') {
    cache.encomenda_linhas.forEach((l) => { if (l.produto_id === id) l.produto_id = null; });
    cache.produto_materiais = cache.produto_materiais.filter((x) => x.produto_id !== id);
  }
  if (table === 'materiais') cache.produto_materiais = cache.produto_materiais.filter((x) => x.material_id !== id);
  if (demo) writeDemo();
}

/** Guarda a encomenda e sincroniza as suas linhas (insere, atualiza e apaga as removidas). */
export async function saveEncomenda(enc, linhas, removedIds) {
  const saved = await save('encomendas', enc);
  for (const id of removedIds) await remove('encomenda_linhas', id);
  for (const l of linhas) await save('encomenda_linhas', { ...l, encomenda_id: saved.id });
  return saved;
}

/** Substitui a lista de materiais de um produto. itens = [{ material_id, quantidade }] */
export async function saveProdutoMateriais(produtoId, itens) {
  const atuais = cache.produto_materiais.filter((x) => x.produto_id === produtoId);
  // Reaproveitar linhas existentes (atualizar), inserir as novas e apagar as que sobram.
  for (let i = 0; i < itens.length; i++) {
    const row = { produto_id: produtoId, material_id: itens[i].material_id, quantidade: itens[i].quantidade };
    if (atuais[i]) row.id = atuais[i].id;
    await save('produto_materiais', row);
  }
  for (const r of atuais.slice(itens.length)) await remove('produto_materiais', r.id);
}

// ---------- Fotos ----------
// Cada foto tem duas versões: "<caminho>.jpg" (grande) e "<caminho>_t.jpg" (miniatura).
// No modo demonstração as imagens ficam dentro da própria linha (data URL), em localStorage.

const fotoFile = (caminho, size) => `${caminho}${size === 'thumb' ? '_t' : ''}.jpg`;

/** Envia uma foto já comprimida ({ full, thumb } = Blob). Devolve a linha de produto_fotos. */
export async function uploadFoto(produtoId, { full, thumb }) {
  const temPrincipal = cache.produto_fotos.some((f) => f.produto_id === produtoId && f.principal);
  const key = (crypto.randomUUID?.() ?? String(Date.now()) + Math.random().toString(16).slice(2)).replace(/-/g, '').slice(0, 16);
  const caminho = `produtos/${produtoId}/${key}`;
  if (demo) {
    const [fullUrl, thumbUrl] = await Promise.all([blobToDataUrl(full), blobToDataUrl(thumb)]);
    const row = { produto_id: produtoId, caminho, principal: !temPrincipal, fullUrl, thumbUrl };
    try {
      return await save('produto_fotos', row);
    } catch {
      throw new Error('Sem espaço no modo demonstração para mais fotos.');
    }
  }
  const opts = { contentType: 'image/jpeg', cacheControl: '31536000', upsert: false };
  const up = async (size, blob) => {
    const { error } = await sb.storage.from(BUCKET).upload(fotoFile(caminho, size), blob, opts);
    if (error) throw new Error('Falha ao enviar a foto: ' + error.message);
  };
  await up('full', full);
  await up('thumb', thumb);
  return save('produto_fotos', { produto_id: produtoId, caminho, principal: !temPrincipal });
}

export async function removeFoto(foto) {
  if (!demo) {
    await sb.storage.from(BUCKET).remove([fotoFile(foto.caminho, 'full'), fotoFile(foto.caminho, 'thumb')]);
  }
  const eraPrincipal = foto.principal;
  await remove('produto_fotos', foto.id);
  if (eraPrincipal) {
    const outra = cache.produto_fotos.find((f) => f.produto_id === foto.produto_id);
    if (outra) await save('produto_fotos', { ...outra, principal: true });
  }
}

export async function setPrincipal(foto) {
  for (const f of cache.produto_fotos.filter((x) => x.produto_id === foto.produto_id && x.principal && x.id !== foto.id)) {
    await save('produto_fotos', { ...f, principal: false });
  }
  await save('produto_fotos', { ...foto, principal: true });
}

// Links assinados (bucket privado). Guardados localmente durante uns dias para o
// browser poder reaproveitar a imagem em cache em vez de a descarregar de novo.
const URL_TTL = 60 * 60 * 24 * 7; // 7 dias
const URL_KEY = 'tmn-foto-urls';
let urlCache = null;
function loadUrlCache() {
  if (urlCache) return urlCache;
  try { urlCache = JSON.parse(localStorage.getItem(URL_KEY) || '{}'); } catch { urlCache = {}; }
  const now = Date.now();
  for (const [k, v] of Object.entries(urlCache)) if (v.exp - now < 864e5) delete urlCache[k];
  return urlCache;
}
function saveUrlCache() {
  try { localStorage.setItem(URL_KEY, JSON.stringify(urlCache)); } catch { /* ignorar */ }
}

/** Devolve { [ficheiro]: url } para uma lista de [foto, 'thumb'|'full']. */
export async function fotoUrls(pedidos) {
  const out = {};
  if (demo) {
    for (const [f, size] of pedidos) out[fotoFile(f.caminho, size)] = size === 'thumb' ? f.thumbUrl : f.fullUrl;
    return out;
  }
  const c = loadUrlCache();
  const faltam = [];
  for (const [f, size] of pedidos) {
    const file = fotoFile(f.caminho, size);
    if (c[file]) out[file] = c[file].url; else faltam.push(file);
  }
  if (faltam.length) {
    const unique = [...new Set(faltam)];
    for (let i = 0; i < unique.length; i += 100) {
      const { data, error } = await sb.storage.from(BUCKET).createSignedUrls(unique.slice(i, i + 100), URL_TTL);
      if (error) throw new Error(error.message);
      for (const d of data) {
        if (!d.signedUrl) continue;
        c[d.path] = { url: d.signedUrl, exp: Date.now() + URL_TTL * 1000 };
        out[d.path] = d.signedUrl;
      }
    }
    saveUrlCache();
  }
  return out;
}
export { fotoFile };

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

// ---------- Modo demonstração ----------
function nextId(table) {
  return cache[table].reduce((m, r) => Math.max(m, r.id), 0) + 1;
}
function writeDemo() {
  try { localStorage.setItem(DEMO_KEY, JSON.stringify(cache)); } catch (e) {
    if (e?.name === 'QuotaExceededError') throw e; // sem espaço: avisar quem chamou
  }
}
function readDemo() {
  try {
    const raw = localStorage.getItem(DEMO_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignorar */ }
  return demoSeed();
}
export function resetDemo() {
  try { localStorage.removeItem(DEMO_KEY); } catch { /* ignorar */ }
}

function demoSeed() {
  const y = new Date().getFullYear();
  const d = (m, day) => `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return {
    clientes: [
      { id: 1, nome: 'Ana Exemplo', morada: 'Rua das Flores 1, Lisboa', contacto: '910000001' },
      { id: 2, nome: 'Beatriz Teste', morada: 'Av. Central 22, Porto', contacto: 'beatriz@example.com' },
      { id: 3, nome: 'Carla Demo', morada: '', contacto: '930000003' },
    ],
    produtos: [
      { id: 1, nome: 'Bola de Natal 8cm', preco: 6, custo: 1.2, ativo: true, categoria: 'Natal', descricao: 'Bola em macramé feita à mão, com fita para pendurar.', detalhes: 'Branco, cru, dourado' },
      { id: 2, nome: 'Estrela', preco: 3.5, custo: 0.6, ativo: true, categoria: 'Natal', descricao: '', detalhes: '10 cm' },
      { id: 3, nome: 'Suporte de vaso', preco: 15, custo: 4.1, ativo: true, categoria: 'Decoração', descricao: 'Suporte suspenso para vasos até 15 cm.', detalhes: '90 cm de comprimento' },
      { id: 4, nome: 'Porta-chaves com nome', preco: 5, custo: 0.9, ativo: true, categoria: 'Porta-chaves', descricao: 'Personalizado com o nome à escolha.', detalhes: '' },
    ],
    encomendas: [
      { id: 1, data: d(1, 12), cliente_id: 1, pago: true, enviado: true, notas: '' },
      { id: 2, data: d(2, 3), cliente_id: 2, pago: true, enviado: false, notas: 'Entregar em mão' },
      { id: 3, data: d(2, 20), cliente_id: 3, pago: false, enviado: false, notas: '' },
    ],
    encomenda_linhas: [
      { id: 1, encomenda_id: 1, produto_id: 1, preco_unit: 6, quantidade: 4, descricao: 'Brancas', executado: true },
      { id: 2, encomenda_id: 1, produto_id: 2, preco_unit: 3.5, quantidade: 2, descricao: '', executado: true },
      { id: 3, encomenda_id: 2, produto_id: 3, preco_unit: 15, quantidade: 1, descricao: 'Cor natural', executado: true },
      { id: 4, encomenda_id: 3, produto_id: 4, preco_unit: 5, quantidade: 3, descricao: 'Nomes: Rita, Tomás, Leonor', executado: false },
    ],
    despesas: [
      { id: 1, data: d(1, 5), descricao: 'Fio de algodão 3mm', total: 24.5, pago_por: 'Jéssica' },
      { id: 2, data: d(1, 18), descricao: 'Argolas de madeira', total: 8.9, pago_por: 'Bernardo' },
    ],
    produto_fotos: [],
    produto_materiais: [],
    materiais: [
      { id: 1, nome: 'Fio algodão 3mm (rolo 200m)', quantidade: 200, preco_total: 12.5 },
      { id: 2, nome: 'Argola madeira 40mm', quantidade: 6, preco_total: 1.25 },
      { id: 3, nome: 'Bola esferovite 7cm', quantidade: 3, preco_total: 1.5 },
    ],
  };
}
