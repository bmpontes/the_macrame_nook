// Camada de dados: Supabase (partilhado na nuvem) ou modo demonstração (localStorage).
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';

export const TABLES = ['clientes', 'produtos', 'encomendas', 'encomenda_linhas', 'despesas', 'materiais'];
export const demo = !SUPABASE_URL || !SUPABASE_ANON_KEY;

/** Dados em memória: { clientes: [...], produtos: [...], ... } */
export const cache = Object.fromEntries(TABLES.map((t) => [t, []]));

let sb = null;
const DEMO_KEY = 'tmn-demo-v1';

export async function init() {
  if (demo) return;
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm');
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
  if (i >= 0) list[i] = saved; else list.push(saved);
  if (demo) writeDemo();
  return saved;
}

export async function remove(table, id) {
  if (!demo) {
    const { error } = await sb.from(table).delete().eq('id', id);
    if (error) throw new Error(error.message);
  }
  cache[table] = cache[table].filter((r) => r.id !== id);
  // Replicar os efeitos das chaves estrangeiras na cópia em memória.
  if (table === 'encomendas') cache.encomenda_linhas = cache.encomenda_linhas.filter((l) => l.encomenda_id !== id);
  if (table === 'clientes') cache.encomendas.forEach((e) => { if (e.cliente_id === id) e.cliente_id = null; });
  if (table === 'produtos') cache.encomenda_linhas.forEach((l) => { if (l.produto_id === id) l.produto_id = null; });
  if (demo) writeDemo();
}

/** Guarda a encomenda e sincroniza as suas linhas (insere, atualiza e apaga as removidas). */
export async function saveEncomenda(enc, linhas, removedIds) {
  const saved = await save('encomendas', enc);
  for (const id of removedIds) await remove('encomenda_linhas', id);
  for (const l of linhas) await save('encomenda_linhas', { ...l, encomenda_id: saved.id });
  return saved;
}

// ---------- Modo demonstração ----------
function nextId(table) {
  return cache[table].reduce((m, r) => Math.max(m, r.id), 0) + 1;
}
function writeDemo() {
  try { localStorage.setItem(DEMO_KEY, JSON.stringify(cache)); } catch { /* sem armazenamento */ }
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
      { id: 1, nome: 'Bola de Natal 8cm', preco: 6, custo: 1.2, ativo: true },
      { id: 2, nome: 'Estrela', preco: 3.5, custo: 0.6, ativo: true },
      { id: 3, nome: 'Suporte de vaso', preco: 15, custo: 4.1, ativo: true },
      { id: 4, nome: 'Porta-chaves com nome', preco: 5, custo: 0.9, ativo: true },
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
    materiais: [
      { id: 1, nome: 'Fio algodão 3mm (rolo 200m)', quantidade: 200, preco_total: 12.5 },
      { id: 2, nome: 'Argola madeira 40mm', quantidade: 6, preco_total: 1.25 },
      { id: 3, nome: 'Bola esferovite 7cm', quantidade: 3, preco_total: 1.5 },
    ],
  };
}
