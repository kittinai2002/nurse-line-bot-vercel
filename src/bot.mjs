import {randomUUID, createHmac, timingSafeEqual} from 'node:crypto';
import {DEFAULT_CONFIG,TYPES,bangkokDate,nextMonth,parseSchedule,validTime,validDate,normalizeMonth,assertNoOverlap,thaiDate,timeDescription,remindersDue,reminderText} from './domain.mjs';
import {decorateMessage} from './cards.mjs';
import {calendarMessage} from './calendar.mjs';
import {handleFlow,handlePostback,reply,validPostback} from './flow.mjs';

export function verifySignature(raw, signature, secret) {
  if (!secret || typeof signature !== 'string') return false;
  const expected = createHmac('sha256', secret).update(raw).digest();
  const got = Buffer.from(signature, 'base64');
  return expected.length === got.length && timingSafeEqual(expected, got);
}

export const message = reply;

export class NurseBot {
  constructor(db, env, { fetchFn = fetch, now = () => Date.now(), userId = env.LINE_OWNER_USER_ID } = {}) {
    this.db = db;
    this.env = env;
    this.fetch = fetchFn;
    this.now = now;
    this.userId = userId;
  }

  async ensureUser() {
    await this.db.execute('INSERT OR IGNORE INTO accounts(user_id, created_at) VALUES(?, ?)', [this.userId, this.now()]);
  }

  async config() {
    await this.ensureUser();
    const res = await this.db.execute('SELECT json FROM config WHERE user_id = ?', [this.userId]);
    if (res.rows.length) {
      return JSON.parse(res.rows[0].json);
    }
    const def = DEFAULT_CONFIG();
    await this.db.execute('INSERT INTO config(user_id, json) VALUES(?, ?)', [this.userId, JSON.stringify(def)]);
    return def;
  }

  async saveConfig(c) {
    await this.ensureUser();
    await this.db.execute('INSERT INTO config(user_id, json) VALUES(?, ?) ON CONFLICT(user_id) DO UPDATE SET json = excluded.json', [this.userId, JSON.stringify(c)]);
  }

  async rows() {
    await this.ensureUser();
    const res = await this.db.execute('SELECT date, type FROM shifts WHERE user_id = ? ORDER BY date, type', [this.userId]);
    return res.rows.map(r => ({ date: r.date, type: r.type }));
  }

  async cancelPending() {
    await this.db.execute("UPDATE outbox SET state='cancelled' WHERE user_id = ? AND state='pending'", [this.userId]);
  }

  async getUiState() {
    const res = await this.db.execute('SELECT json, expires FROM ui_state WHERE user_id = ?', [this.userId]);
    return res.rows[0] || null;
  }

  async saveUiState(s, expires) {
    await this.db.execute('INSERT INTO ui_state(user_id, json, expires) VALUES(?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET json = excluded.json, expires = excluded.expires', [this.userId, JSON.stringify(s), expires]);
  }

  async clearUiState() {
    await this.db.execute('DELETE FROM ui_state WHERE user_id = ?', [this.userId]);
  }

  async deleteShifts(dates) {
    for (const date of dates) {
      await this.db.execute('DELETE FROM shifts WHERE user_id = ? AND date = ?', [this.userId, date]);
      await this.db.execute("UPDATE outbox SET state='cancelled' WHERE user_id = ? AND date = ? AND state='pending'", [this.userId, date]);
    }
  }

  async handlePostback(postback) {
    return await handlePostback(this, postback);
  }

  async handle(text) {
    const c = await this.config();
    text = text.trim();
    if (['ปฏิทินเวร','ตารางของฉัน'].includes(text)) text = 'ตารางเวรของฉัน';
    if (['เว็บ','จัดการเวร','เปิดเว็บ'].includes(text)) text = 'เมนู';

    const guided = await handleFlow(this, text);
    if (guided) return guided;

    if (text === 'ยืนยันเวลาเวร') {
      c.confirmed = true;
      await this.saveConfig(c);
      return message(`✅ ยืนยันเวลาเวรแล้ว\n${TYPES.map(t=>timeDescription(t,c)).join('\n')}\n\nเพิ่มตารางแล้วพิมพ์ เปิดแจ้งเตือน เมื่อพร้อม`);
    }

    if (text.startsWith('ตั้งเวลา ')) {
      const m = /^ตั้งเวลา\s+(เช้า|บ่าย|ดึก)\s+(\d{2}:\d{2})\s+(\d{2}:\d{2})$/.exec(text);
      if (!m || !validTime(m[2]) || !validTime(m[3]) || m[2] === m[3]) {
        return message('ใช้รูปแบบ ตั้งเวลา เช้า 08:00 16:00 และเวลาเริ่มกับเวลาจบต้องไม่ตรงกัน');
      }
      c.times[m[1]] = [m[2], m[3]];
      const rows = await this.rows();
      assertNoOverlap(rows, c);
      c.confirmed = false;
      c.enabled = false;
      await this.saveConfig(c);
      await this.cancelPending();
      return message(`บันทึกเวลา${m[1]}แล้ว และพักการเตือนเพื่อรอยืนยัน\nพิมพ์ ตั้งค่า เพื่อตรวจสอบและยืนยันเวลาอีกครั้ง`);
    }

    if (text.startsWith('เตือนล่วงหน้า ')) {
      const m = /^เตือนล่วงหน้า\s+(\d+)$/.exec(text);
      const lead = Number(m?.[1]);
      if (!m || lead < 5 || lead > 1440) return message('ตั้งเวลาเตือนล่วงหน้าได้ 5–1440 นาที เช่น เตือนล่วงหน้า 60');
      c.lead = lead;
      await this.saveConfig(c);
      await this.cancelPending();
      return message(`✅ ตั้งเตือนล่วงหน้า ${lead} นาทีแล้ว`, [['กลับตั้งค่า','ตั้งค่า'],['เมนูหลัก','เมนู']]);
    }

    if (text === 'เปิดแจ้งเตือน') {
      if (!c.confirmed) return message('ตรวจเวลาเวรก่อนเปิดแจ้งเตือน\nเลือกเวลาให้ตรงกับที่ทำงาน แล้วกดใช้เวลาชุดนี้', [['ตั้งเวลาเวร','ตั้งเวลาเวร'],['เมนูหลัก','เมนู']]);
      const rows = await this.rows();
      if (!rows.some(r => r.date >= bangkokDate(this.now()) && r.type !== 'หยุด')) {
        return message('ยังไม่มีเวรปัจจุบันหรืออนาคต\nลงเวรแล้วกลับมาเปิดแจ้งเตือนได้เลย', [['ลงเวร','ลงเวร'],['เมนูหลัก','เมนู']]);
      }
      c.enabled = true;
      await this.saveConfig(c);
      return message(`🔔 เปิดแจ้งเตือนแล้ว ก่อนขึ้นเวร ${c.lead} นาที\nตรวจสอบว่าเพิ่มเพื่อน OA และเปิดการแจ้งเตือน LINE ไว้ด้วยนะครับ`);
    }

    if (text === 'ปิดแจ้งเตือน') {
      c.enabled = false;
      await this.saveConfig(c);
      await this.cancelPending();
      return message('🔕 ปิดแจ้งเตือนแล้ว ตารางเวรยังอยู่ครบครับ');
    }

    if (['เวรวันนี้','เวรพรุ่งนี้','เวรวันพรุ่งนี้'].includes(text)) {
      const tomorrow = text !== 'เวรวันนี้';
      const day = tomorrow ? 'พรุ่งนี้' : 'วันนี้';
      const date = bangkokDate(this.now() + (tomorrow ? 86400000 : 0));
      const rows = await this.rows();
      const currentRows = rows.filter(r => r.date === date);
      const summary = currentRows.length
        ? currentRows.map(r => r.type === 'หยุด' ? '🌿 วันหยุด' : timeDescription(r.type, c)).join('\n')
        : `ยังไม่ได้บันทึกเวร${day} (ไม่ได้หมายถึงวันหยุด)`;
      return message(`📅 เวร${day}\nวันที่เริ่มเวร ${thaiDate(date)}\n${summary}\n\nแจ้งเตือน ${c.enabled?'เปิด':'ปิด'}`, [['ดูเวรพรุ่งนี้','เวรพรุ่งนี้'],['แก้เวรวันที่แสดง','ลงเวร '+date],['ตารางของฉัน','ตารางเวรของฉัน']]);
    }

    if (text.startsWith('เวรวันที่ ')) {
      const date = text.slice('เวรวันที่ '.length).trim();
      if (!validDate(date) || date < '2020-01-01' || date > '2100-12-31') return message('วันที่ไม่ถูกต้อง', [['ปฏิทินเวร','ตารางเวรของฉัน'],['เมนูหลัก','เมนู']]);
      const rows = await this.rows();
      const currentRows = rows.filter(r => r.date === date);
      return message(`🐾 เวรวันที่ ${thaiDate(date)}\n${currentRows.length ? currentRows.map(r => r.type === 'หยุด' ? '🌿 วันหยุด' : timeDescription(r.type, c)).join('\n') : 'ยังไม่ได้ลงเวรในวันที่เลือก (ไม่ได้หมายถึงวันหยุด)'}\nวันที่แสดงคือวันที่เริ่มเวร`, [['แก้เวรวันที่เลือก','ลงเวร '+date],['กลับปฏิทิน','ตารางเวร '+date.slice(0,7)],['เมนูหลัก','เมนู']]);
    }

    if (text === 'ตารางเวรของฉัน' || text.startsWith('ตารางเวร ')) {
      const month = text === 'ตารางเวรของฉัน' ? bangkokDate(this.now()).slice(0,7) : normalizeMonth(text.slice(8).trim());
      const rows = await this.rows();
      return calendarMessage(month, rows, this.now());
    }

    if (text === 'รายการเวร' || text.startsWith('รายการเวร ')) {
      const month = text === 'รายการเวร' ? bangkokDate(this.now()).slice(0,7) : normalizeMonth(text.slice('รายการเวร '.length).trim());
      const allRows = await this.rows();
      const rows = allRows.filter(r => r.date.startsWith(month));
      const dates = [...new Set(rows.map(r => r.date))];
      return message(`🐾 รายการเวร ${month}\n${dates.length ? dates.map(d => `${Number(d.slice(-2))}: ${rows.filter(r=>r.date===d).map(r=>r.type).join(' + ')}`).join('\n') : 'ยังไม่มีตารางเดือนนี้'}\nวันที่แสดงคือวันที่เริ่มเวร`, [['กลับปฏิทิน','ตารางเวร '+month],['ลง/แก้เวร','ลงเวร'],['เมนูหลัก','เมนู']]);
    }

    if (text.startsWith('เพิ่มเวร ')) {
      const updates = parseSchedule(text);
      const dates = new Set(updates.map(u => u.date));
      const currentRows = await this.rows();
      const rows = [...currentRows.filter(r => !dates.has(r.date)), ...updates.flatMap(u => (u.types.length ? u.types : ['หยุด']).map(type => ({ date: u.date, type })))];
      assertNoOverlap(rows, c);

      const id = randomUUID().slice(0, 8);
      await this.db.execute('INSERT INTO pending(id, user_id, json, expires) VALUES(?, ?, ?, ?)', [id, this.userId, JSON.stringify(updates), this.now() + 10 * 60000]);
      return message(`ตรวจสอบตารางก่อนบันทึก\n${updates.map(u => `${thaiDate(u.date)}: ${u.types.join(' + ')||'หยุด'}`).join('\n')}\n\nวันที่ในรายการจะแทนที่เวรเดิม ยืนยันภายใน 10 นาที`, [['ยืนยันบันทึก', `ยืนยัน ${id}`], ['ยกเลิก', `ยกเลิก ${id}`]]);
    }

    if (/^ยืนยัน [a-f0-9-]{8}$/.test(text)) {
      const id = text.split(' ')[1];
      const res = await this.db.execute('SELECT * FROM pending WHERE id = ? AND user_id = ? AND expires > ?', [id, this.userId, this.now()]);
      const pending = res.rows[0];
      if (!pending) return message('รายการนี้หมดอายุหรือบันทึกแล้ว ส่งตารางใหม่ได้ครับ');

      const updates = JSON.parse(pending.json);
      const dates = new Set(updates.map(u => u.date));
      const currentRows = await this.rows();
      const combined = [...currentRows.filter(r => !dates.has(r.date)), ...updates.flatMap(u => (u.types.length ? u.types : ['หยุด']).map(type => ({ date: u.date, type })))];
      assertNoOverlap(combined, c);

      for (const u of updates) {
        await this.db.execute('DELETE FROM shifts WHERE user_id = ? AND date = ?', [this.userId, u.date]);
        await this.db.execute("UPDATE outbox SET state='cancelled' WHERE user_id = ? AND date = ? AND state='pending'", [this.userId, u.date]);
        for (const type of u.types.length ? u.types : ['หยุด']) {
          await this.db.execute('INSERT INTO shifts(user_id, date, type) VALUES(?, ?, ?)', [this.userId, u.date, type]);
        }
      }
      await this.db.execute('DELETE FROM pending WHERE id = ? AND user_id = ?', [id, this.userId]);
      return message(`✅ บันทึก ${updates.length} วันแล้ว\nแจ้งเตือน: ${c.enabled ? 'เปิด' : 'ปิด'}`, [...(c.enabled ? [] : [[c.confirmed ? 'เปิดแจ้งเตือน' : 'ตั้งเวลาเวร', c.confirmed ? 'เปิดแจ้งเตือน' : 'ตั้งเวลาเวร']]), ['ลงเวรเพิ่ม','ลงเวร'], ['ดูตาราง','ตารางเวร '+updates[0].date.slice(0,7)], ['เมนูหลัก','เมนู']]);
    }

    if (/^ยกเลิก [a-f0-9-]{8}$/.test(text)) {
      await this.db.execute('DELETE FROM pending WHERE id = ? AND user_id = ?', [text.split(' ')[1], this.userId]);
      return message('ยกเลิกรายการแล้ว ตารางเดิมไม่เปลี่ยนครับ');
    }

    if (text === 'สถานะ') {
      const res = await this.db.execute('SELECT date, type, state, last_status FROM outbox WHERE user_id = ? ORDER BY rowid DESC LIMIT 5', [this.userId]);
      const names = { sent:'LINE รับข้อความแล้ว', pending:'รอส่ง/ลองใหม่', failed:'ส่งไม่สำเร็จ', expired:'เลยเวลาเตือน', cancelled:'ยกเลิก' };
      return message(`แจ้งเตือน: ${c.enabled ? 'เปิด' : 'ปิด'}\n${res.rows.map(l => `${l.date} ${l.type}: ${names[l.state]||l.state}${l.last_status ? ' ('+l.last_status+')' : ''}`).join('\n') || 'ยังไม่มีประวัติส่ง'}\n\nสถานะรับข้อความจาก API ไม่ใช่การยืนยันว่าเปิดอ่านแล้ว`);
    }

    return message('ยังไม่เข้าใจข้อความนี้\nกดลงเวรเพื่อลงแบบเลือกวันและเวร หรือกลับเมนูหลัก', [['ลง/แก้เวร','ลงเวร'],['เมนูหลัก','เมนู']]);
  }

  async line(path, payload, retryKey) {
    payload = { ...payload, messages: payload.messages.map(decorateMessage) };
    const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.env.LINE_CHANNEL_ACCESS_TOKEN}` };
    if (retryKey) headers['X-Line-Retry-Key'] = retryKey;
    const response = await this.fetch(`https://api.line.me/v2/bot/message/${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000)
    });
    return { status: response.status, accepted: response.ok || (response.status === 409 && !!response.headers.get('x-line-accepted-request-id')) };
  }

  // Handle incoming event immediately in Serverless environment
  async processEvent(e) {
    if (e.source?.type !== 'user' || !e.source?.userId) return null;
    if (Math.abs(this.now() - e.timestamp) > 10 * 60000) return null;

    const payload = { type: e.type, text: e.message?.text, replyToken: e.replyToken, timestamp: e.timestamp, postback: e.type==='postback'?{data:e.postback.data,params:{date:e.postback.params?.date,time:e.postback.params?.time}}:undefined };
    await this.db.execute('INSERT OR IGNORE INTO events(id, user_id, payload, received) VALUES(?, ?, ?, ?)', [e.webhookEventId, this.userId, JSON.stringify(payload), this.now()]);

    let replyMessage = null;
    if (e.type === 'unfollow') {
      const c = await this.config();
      c.enabled = false;
      await this.saveConfig(c);
      await this.cancelPending();
    } else {
      try {
        if (e.type === 'follow') replyMessage = await this.handle('เมนู');
        else if (e.type === 'postback') replyMessage = await this.handlePostback(e.postback);
        else if (e.type === 'message' && e.message?.type === 'text') replyMessage = await this.handle(e.message.text);
      } catch (err) {
        replyMessage = message(`ยังไม่ได้บันทึก\n${String(err.message).slice(0,250)}`, [['ลองขั้นตอนเดิม','ทำต่อ'],['เมนูหลัก','เมนู']]);
      }
    }

    if (replyMessage && e.replyToken && (this.now() - e.timestamp <= 55000)) {
      try {
        await this.line('reply', { replyToken: e.replyToken, messages: [replyMessage] });
      } catch (err) {
        console.error('reply_error', err);
      }
    }

    return replyMessage;
  }

  async enqueueReminders() {
    const c = await this.config();
    const now = this.now();
    const today = bangkokDate(now);
    const next = bangkokDate(now + 86400000);
    const res = await this.db.execute('SELECT date, type FROM shifts WHERE user_id = ? AND date BETWEEN ? AND ?', [this.userId, today, next]);
    const rows = res.rows.map(r => ({ date: r.date, type: r.type }));

    for (const r of remindersDue(rows, c, now)) {
      const reminderId = `${this.userId}:${r.key}`;
      await this.db.execute(`INSERT INTO outbox(id, user_id, retry_key, date, type, text, expires, next_attempt) VALUES(?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET text = excluded.text, expires = excluded.expires, next_attempt = excluded.next_attempt, state = 'pending'
        WHERE outbox.state = 'cancelled' AND outbox.accepted_at IS NULL`,
        [reminderId, this.userId, randomUUID(), r.date, r.type, reminderText(r, c), r.expires, now]
      );
    }
  }

  async sendOutbox() {
    const now = this.now();
    await this.db.execute("UPDATE outbox SET state='expired' WHERE state='pending' AND expires <= ?", [now]);
    const c = await this.config();
    if (!c.enabled) return;

    const res = await this.db.execute("SELECT * FROM outbox WHERE user_id = ? AND state='pending' AND next_attempt <= ? AND expires > ? ORDER BY next_attempt LIMIT 5", [this.userId, now, now]);
    for (const job of res.rows) {
      let result = { status: 0, accepted: false };
      try {
        result = await this.line('push', { to: this.userId, messages: [message(job.text)] }, job.retry_key);
      } catch (err) {
        console.error('push_failed', err);
      }
      const state = result.accepted ? 'sent' : result.status >= 400 && result.status < 500 && result.status !== 429 ? 'failed' : 'pending';
      const nextAttempt = this.now() + Math.min(300000, 30000 * 2 ** Math.min(job.attempts, 4));
      await this.db.execute('UPDATE outbox SET state = ?, last_status = ?, attempts = attempts + 1, next_attempt = ?, accepted_at = ? WHERE id = ?',
        [state, result.status, nextAttempt, result.accepted ? this.now() : null, job.id]
      );
    }
  }

  async tick() {
    await this.enqueueReminders();
    await this.sendOutbox();
    await this.db.execute('DELETE FROM pending WHERE expires < ?', [this.now()]);
    await this.db.execute('DELETE FROM events WHERE received < ?', [this.now() - 86400000]);
    await this.db.execute('DELETE FROM outbox WHERE expires < ?', [this.now() - 90 * 86400000]);
  }
}
