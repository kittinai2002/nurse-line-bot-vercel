// Turso Database client for Vercel Serverless
// Supports both @libsql/client and zero-dependency direct HTTP pipeline

export class MemoryClient {
  constructor() {
    this.accounts = new Map(); // user_id -> created_at
    this.config = new Map();   // user_id -> json
    this.shifts = new Map();   // `${user_id}:${date}:${type}` -> { user_id, date, type }
    this.ui_state = new Map(); // user_id -> { json, expires }
    this.pending = new Map();  // id -> { id, user_id, json, expires }
    this.events = new Map();   // id -> { id, user_id, payload, received, state, response }
    this.outbox = new Map();   // id -> { id, user_id, retry_key, date, type, text, expires, next_attempt, attempts, state, last_status, accepted_at }
  }

  async execute({ sql, args = [] }) {
    const s = sql.trim().replace(/;$/, '').replace(/\s+/g, ' ');

    // CREATE TABLE / INDEX
    if (/^CREATE\s+(TABLE|INDEX)/i.test(s)) {
      return { rows: [], rowsAffected: 0 };
    }

    // ACCOUNTS
    if (/^INSERT OR IGNORE INTO accounts/i.test(s)) {
      const [user_id, created_at] = args;
      if (!this.accounts.has(user_id)) this.accounts.set(user_id, created_at);
      return { rows: [], rowsAffected: 1 };
    }
    if (/^SELECT user_id FROM accounts/i.test(s)) {
      const rows = [...this.accounts.keys()].map(user_id => ({ user_id }));
      return { rows, rowsAffected: 0 };
    }

    // CONFIG
    if (/^SELECT json FROM config WHERE user_id\s*=\s*\?/i.test(s)) {
      const [user_id] = args;
      const json = this.config.get(user_id);
      return { rows: json ? [{ json }] : [], rowsAffected: 0 };
    }
    if (/^INSERT INTO config/i.test(s) || /^INSERT OR REPLACE INTO config/i.test(s)) {
      const [user_id, json] = args;
      this.config.set(user_id, json);
      return { rows: [], rowsAffected: 1 };
    }
    if (/^UPDATE config SET json\s*=\s*\?\s+WHERE user_id\s*=\s*\?/i.test(s)) {
      const [json, user_id] = args;
      this.config.set(user_id, json);
      return { rows: [], rowsAffected: 1 };
    }

    // SHIFTS
    if (/^SELECT date,\s*type FROM shifts WHERE user_id\s*=\s*\?\s+ORDER BY date,\s*type/i.test(s)) {
      const [user_id] = args;
      const rows = [];
      for (const item of this.shifts.values()) {
        if (item.user_id === user_id) rows.push({ date: item.date, type: item.type });
      }
      rows.sort((a, b) => a.date.localeCompare(b.date) || a.type.localeCompare(b.type));
      return { rows, rowsAffected: 0 };
    }
    if (/^SELECT date,\s*type FROM shifts WHERE user_id\s*=\s*\?\s+AND date BETWEEN \?\s+AND \?/i.test(s)) {
      const [user_id, fromDate, toDate] = args;
      const rows = [];
      for (const item of this.shifts.values()) {
        if (item.user_id === user_id && item.date >= fromDate && item.date <= toDate) {
          rows.push({ date: item.date, type: item.type });
        }
      }
      rows.sort((a, b) => a.date.localeCompare(b.date) || a.type.localeCompare(b.type));
      return { rows, rowsAffected: 0 };
    }
    if (/^INSERT (OR REPLACE )?INTO shifts/i.test(s)) {
      const [user_id, date, type] = args;
      this.shifts.set(`${user_id}:${date}:${type}`, { user_id, date, type });
      return { rows: [], rowsAffected: 1 };
    }
    if (/^DELETE FROM shifts WHERE user_id\s*=\s*\?\s+AND date\s*=\s*\?/i.test(s)) {
      const [user_id, date] = args;
      for (const [k, v] of this.shifts.entries()) {
        if (v.user_id === user_id && v.date === date) this.shifts.delete(k);
      }
      return { rows: [], rowsAffected: 1 };
    }

    // UI_STATE
    if (/^SELECT json,\s*expires FROM ui_state WHERE user_id\s*=\s*\?/i.test(s)) {
      const [user_id] = args;
      const val = this.ui_state.get(user_id);
      return { rows: val ? [{ json: val.json, expires: val.expires }] : [], rowsAffected: 0 };
    }
    if (/^INSERT (OR REPLACE )?INTO ui_state/i.test(s)) {
      const [user_id, json, expires] = args;
      this.ui_state.set(user_id, { json, expires });
      return { rows: [], rowsAffected: 1 };
    }
    if (/^DELETE FROM ui_state WHERE user_id\s*=\s*\?/i.test(s)) {
      const [user_id] = args;
      this.ui_state.delete(user_id);
      return { rows: [], rowsAffected: 1 };
    }

    // PENDING
    if (/^INSERT (OR REPLACE )?INTO pending/i.test(s)) {
      const [id, user_id, json, expires] = args;
      this.pending.set(id, { id, user_id, json, expires });
      return { rows: [], rowsAffected: 1 };
    }
    if (/^SELECT \* FROM pending WHERE id\s*=\s*\?\s+AND user_id\s*=\s*\?\s+AND expires\s*>\s*\?/i.test(s)) {
      const [id, user_id, now] = args;
      const item = this.pending.get(id);
      if (item && item.user_id === user_id && item.expires > now) {
        return { rows: [{ ...item }], rowsAffected: 0 };
      }
      return { rows: [], rowsAffected: 0 };
    }
    if (/^DELETE FROM pending WHERE id\s*=\s*\?\s+AND user_id\s*=\s*\?/i.test(s)) {
      const [id, user_id] = args;
      const item = this.pending.get(id);
      if (item && item.user_id === user_id) this.pending.delete(id);
      return { rows: [], rowsAffected: 1 };
    }
    if (/^DELETE FROM pending WHERE expires\s*<\s*\?/i.test(s)) {
      const [now] = args;
      for (const [k, v] of this.pending.entries()) {
        if (v.expires < now) this.pending.delete(k);
      }
      return { rows: [], rowsAffected: 1 };
    }

    // EVENTS
    if (/^INSERT OR IGNORE INTO events/i.test(s)) {
      const [id, user_id, payload, received] = args;
      if (!this.events.has(id)) {
        this.events.set(id, { id, user_id, payload, received, state: 'new', response: null });
      }
      return { rows: [], rowsAffected: 1 };
    }
    if (/^DELETE FROM events WHERE received\s*<\s*\?/i.test(s)) {
      const [cutoff] = args;
      for (const [k, v] of this.events.entries()) {
        if (v.received < cutoff) this.events.delete(k);
      }
      return { rows: [], rowsAffected: 1 };
    }

    // OUTBOX
    if (/^UPDATE outbox SET state='cancelled' WHERE user_id\s*=\s*\?\s+AND date\s*=\s*\?\s+AND state='pending'/i.test(s)) {
      const [user_id, date] = args;
      for (const item of this.outbox.values()) {
        if (item.user_id === user_id && item.date === date && item.state === 'pending') {
          item.state = 'cancelled';
        }
      }
      return { rows: [], rowsAffected: 1 };
    }
    if (/^UPDATE outbox SET state='cancelled' WHERE user_id\s*=\s*\?\s+AND state='pending'/i.test(s)) {
      const [user_id] = args;
      for (const item of this.outbox.values()) {
        if (item.user_id === user_id && item.state === 'pending') item.state = 'cancelled';
      }
      return { rows: [], rowsAffected: 1 };
    }
    if (/^SELECT date,\s*type,\s*state,\s*last_status FROM outbox WHERE user_id\s*=\s*\?/i.test(s)) {
      const [user_id] = args;
      const rows = [];
      for (const item of this.outbox.values()) {
        if (item.user_id === user_id) {
          rows.push({ date: item.date, type: item.type, state: item.state, last_status: item.last_status });
        }
      }
      return { rows: rows.slice(-5).reverse(), rowsAffected: 0 };
    }
    if (/^SELECT \* FROM outbox WHERE user_id\s*=\s*\?/i.test(s)) {
      const [user_id] = args;
      const rows = [];
      for (const item of this.outbox.values()) {
        if (item.user_id === user_id) rows.push({ ...item });
      }
      return { rows, rowsAffected: 0 };
    }
    if (/^INSERT INTO outbox/i.test(s)) {
      const [id, user_id, retry_key, date, type, text, expires, next_attempt] = args;
      const existing = this.outbox.get(id);
      if (existing) {
        if (existing.state === 'cancelled' && !existing.accepted_at) {
          existing.text = text;
          existing.expires = expires;
          existing.next_attempt = next_attempt;
          existing.state = 'pending';
        }
      } else {
        this.outbox.set(id, {
          id, user_id, retry_key, date, type, text, expires, next_attempt,
          attempts: 0, state: 'pending', last_status: 0, accepted_at: null
        });
      }
      return { rows: [], rowsAffected: 1 };
    }
    if (/^UPDATE outbox SET state='expired' WHERE state='pending' AND expires\s*<=\s*\?/i.test(s)) {
      const [now] = args;
      for (const item of this.outbox.values()) {
        if (item.state === 'pending' && item.expires <= now) item.state = 'expired';
      }
      return { rows: [], rowsAffected: 1 };
    }
    if (/^SELECT \* FROM outbox WHERE (user_id\s*=\s*\?\s+AND\s+)?state='pending' AND next_attempt\s*<=\s*\?\s+AND expires\s*>\s*\?/i.test(s)) {
      const argsCopy = [...args];
      let user_id = null;
      if (argsCopy.length === 3) user_id = argsCopy.shift();
      const [now1, now2] = argsCopy;
      const rows = [];
      for (const item of this.outbox.values()) {
        if ((!user_id || item.user_id === user_id) && item.state === 'pending' && item.next_attempt <= now1 && item.expires > now2) {
          rows.push({ ...item });
        }
      }
      return { rows: rows.slice(0, 10), rowsAffected: 0 };
    }
    if (/^UPDATE outbox SET state\s*=\s*\?,\s*last_status\s*=\s*\?,\s*attempts\s*=\s*attempts\+1,\s*next_attempt\s*=\s*\?,\s*accepted_at\s*=\s*\?\s+WHERE id\s*=\s*\?/i.test(s)) {
      const [state, last_status, next_attempt, accepted_at, id] = args;
      const item = this.outbox.get(id);
      if (item) {
        item.state = state;
        item.last_status = last_status;
        item.attempts += 1;
        item.next_attempt = next_attempt;
        item.accepted_at = accepted_at;
      }
      return { rows: [], rowsAffected: 1 };
    }
    if (/^DELETE FROM outbox WHERE expires\s*<\s*\?/i.test(s)) {
      const [cutoff] = args;
      for (const [k, v] of this.outbox.entries()) {
        if (v.expires < cutoff) this.outbox.delete(k);
      }
      return { rows: [], rowsAffected: 1 };
    }

    return { rows: [], rowsAffected: 0 };
  }
}

export class TursoDatabase {
  constructor({ url = process.env.TURSO_DATABASE_URL, authToken = process.env.TURSO_AUTH_TOKEN } = {}) {
    this.url = url || ':memory:';
    this.authToken = authToken || '';
    this.client = null;
  }

  async getClient() {
    if (this.client) return this.client;
    if (this.url === ':memory:' || (!this.url.startsWith('libsql://') && !this.url.startsWith('http://') && !this.url.startsWith('https://'))) {
      this.client = new MemoryClient();
      return this.client;
    }

    try {
      const mod = await import('@libsql/client/web').catch(() => import('@libsql/client'));
      this.client = mod.createClient({ url: this.url, authToken: this.authToken });
      return this.client;
    } catch {
      this.client = this.createFetchClient();
      return this.client;
    }
  }

  createFetchClient() {
    let httpUrl = this.url.replace(/^libsql:\/\//, 'https://');
    if (!httpUrl.startsWith('http://') && !httpUrl.startsWith('https://')) httpUrl = 'https://' + httpUrl;
    const pipelineUrl = httpUrl.replace(/\/+$/, '') + '/v2/pipeline';
    const token = this.authToken;

    return {
      async execute({ sql, args = [] }) {
        const formattedArgs = Array.isArray(args)
          ? args.map(arg => {
              if (arg === null || arg === undefined) return { type: 'null' };
              if (typeof arg === 'number') {
                return Number.isInteger(arg) ? { type: 'integer', value: String(arg) } : { type: 'float', value: arg };
              }
              if (typeof arg === 'boolean') return { type: 'integer', value: arg ? '1' : '0' };
              return { type: 'text', value: String(arg) };
            })
          : [];

        const body = {
          requests: [
            { type: 'execute', stmt: { sql, args: formattedArgs } },
            { type: 'close' }
          ]
        };

        const res = await fetch(pipelineUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(body)
        });

        if (!res.ok) {
          const txt = await res.text();
          throw Error(`Turso HTTP error ${res.status}: ${txt}`);
        }

        const data = await res.json();
        const execRes = data.results?.[0]?.response?.result;
        if (!execRes) {
          const err = data.results?.[0]?.response?.error;
          if (err) throw Error(`Turso query error: ${err.message}`);
          return { rows: [], rowsAffected: 0 };
        }

        const cols = execRes.cols?.map(c => c.name) || [];
        const rows = (execRes.rows || []).map(r => {
          const obj = {};
          r.forEach((cell, idx) => {
            const colName = cols[idx];
            let val = cell?.value;
            if (cell?.type === 'integer') val = Number(val);
            else if (cell?.type === 'float') val = Number(val);
            else if (cell?.type === 'null') val = null;
            obj[colName] = val;
          });
          return obj;
        });

        return { rows, rowsAffected: execRes.affected_row_count || 0, lastInsertRowid: execRes.last_insert_rowid };
      }
    };
  }

  async execute(sql, args = []) {
    const client = await this.getClient();
    const query = typeof sql === 'string' ? { sql, args } : sql;
    return await client.execute(query);
  }

  async initSchema() {
    const stmts = [
      `CREATE TABLE IF NOT EXISTS accounts (user_id TEXT PRIMARY KEY, created_at INTEGER NOT NULL);`,
      `CREATE TABLE IF NOT EXISTS config (user_id TEXT PRIMARY KEY, json TEXT NOT NULL);`,
      `CREATE TABLE IF NOT EXISTS shifts (user_id TEXT NOT NULL, date TEXT NOT NULL, type TEXT NOT NULL, PRIMARY KEY(user_id, date, type));`,
      `CREATE TABLE IF NOT EXISTS ui_state (user_id TEXT PRIMARY KEY, json TEXT NOT NULL, expires INTEGER NOT NULL);`,
      `CREATE TABLE IF NOT EXISTS pending (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, json TEXT NOT NULL, expires INTEGER NOT NULL);`,
      `CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, payload TEXT, received INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'new', response TEXT);`,
      `CREATE TABLE IF NOT EXISTS outbox (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, retry_key TEXT NOT NULL, date TEXT NOT NULL, type TEXT NOT NULL, text TEXT NOT NULL, expires INTEGER NOT NULL, next_attempt INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, state TEXT NOT NULL DEFAULT 'pending', last_status INTEGER, accepted_at INTEGER);`,
      `CREATE INDEX IF NOT EXISTS outbox_due ON outbox(state, next_attempt);`,
      `CREATE INDEX IF NOT EXISTS shifts_user_date ON shifts(user_id, date);`
    ];
    for (const sql of stmts) {
      await this.execute(sql);
    }
  }
}
