import { HttpError } from '../lib/http.js';
import { OPS } from './tables.js';
import { RPC } from './rpc-registry.js';

export function parseFilters(query, allowedColumns) {
  const filters = [];
  for (const [key, val] of query.entries()) {
    const m = key.match(/^(eq|gte|lte|gt|lt)\.(.+)$/);
    if (!m) continue;
    const [, op, col] = m;
    if (!allowedColumns.includes(col)) throw new HttpError(400, `bad filter column: ${col}`);
    filters.push({ op, col, val });
  }
  return filters;
}

export async function handleSelect(client, table, cfg, query) {
  const selectParam = query.get('select') || '*';
  const selectCols = selectParam === '*' ? ['*'] : selectParam.split(',').map((s) => s.trim());
  if (!(selectCols.length === 1 && selectCols[0] === '*')) {
    for (const c of selectCols) if (!cfg.columns.includes(c)) throw new HttpError(400, `bad select column: ${c}`);
  }
  const filters = parseFilters(query, cfg.columns);
  const order = query.get('order');
  if (order && !cfg.columns.includes(order)) throw new HttpError(400, 'bad order column');
  const limit = query.get('limit') ? parseInt(query.get('limit'), 10) : null;

  // records.updated_at is the optimistic-concurrency token (push_record compares it for exact equality). node-pg would hand it back as a JS Date,
  // i.e. truncated to milliseconds, so every record pulled from the server looked "changed on another device" at the next push and was force-overwritten.
  // Serve it as a microsecond-precision ISO string, the same shape push_record returns.
  const stamp = (c) => `to_char(${c} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"+00:00"') as ${c}`;
  let outCols = selectCols;
  if (table === 'records') outCols = (selectCols[0] === '*' ? cfg.columns : selectCols).map((c) => (c === 'updated_at' ? stamp(c) : c));
  let sql = `select ${outCols.join(',')} from ${table}`;
  const params = [];
  if (filters.length) {
    sql += ' where ' + filters.map((f) => { params.push(f.val); return `${f.col} ${OPS[f.op]} $${params.length}`; }).join(' and ');
  }
  if (order) sql += ` order by ${order}`;
  if (limit) sql += ` limit ${limit}`;

  const { rows } = await client.query(sql, params);
  return query.get('single') === '1' ? (rows[0] || null) : rows;
}

export async function handleInsert(client, table, cfg, body, onConflictCol) {
  const insertable = cfg.insertable || cfg.columns;
  const cols = Object.keys(body).filter((c) => insertable.includes(c));
  if (!cols.length) throw new HttpError(400, 'nothing to insert');
  const values = cols.map((c) => body[c]);
  const placeholders = cols.map((_, i) => `$${i + 1}`);
  let sql = `insert into ${table} (${cols.join(',')}) values (${placeholders.join(',')})`;
  if (onConflictCol) {
    const updateSet = cols.filter((c) => c !== onConflictCol).map((c) => `${c}=excluded.${c}`).join(',');
    sql += ` on conflict (${onConflictCol}) do update set ${updateSet}`;
  }
  sql += ' returning *';
  const { rows } = await client.query(sql, values);
  return rows[0];
}

export async function handleUpdate(client, table, cfg, body, query) {
  const writable = cfg.writable || cfg.columns;
  const cols = Object.keys(body).filter((c) => writable.includes(c));
  if (!cols.length) throw new HttpError(400, 'nothing to update');
  const filters = parseFilters(query, cfg.columns);
  if (!filters.length) throw new HttpError(400, 'a filter is required to update rows');
  const values = cols.map((c) => body[c]);
  const setClauses = cols.map((c, i) => `${c}=$${i + 1}`);
  let sql = `update ${table} set ${setClauses.join(',')}`;
  if (filters.length) {
    sql += ' where ' + filters.map((f) => { values.push(f.val); return `${f.col} ${OPS[f.op]} $${values.length}`; }).join(' and ');
  }
  sql += ' returning *';
  const { rows } = await client.query(sql, values);
  return rows;
}

export async function callRpc(client, fnName, args) {
  const cfg = RPC[fnName];
  if (!cfg) throw new HttpError(404, 'unknown function');
  const jsonbParams = cfg.jsonb || [];
  const values = cfg.params.map((p) => {
    const v = args[p] !== undefined ? args[p] : (cfg.defaults && p in cfg.defaults ? cfg.defaults[p] : null);
    return jsonbParams.includes(p) && v !== null ? JSON.stringify(v) : v;
  });
  const placeholders = cfg.params.map((_, i) => `$${i + 1}`);
  const { rows } = await client.query(`select ${fnName}(${placeholders.join(',')}) as result`, values);
  return rows[0]?.result;
}
