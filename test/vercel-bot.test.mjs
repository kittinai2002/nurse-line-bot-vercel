import test from 'node:test';
import assert from 'node:assert/strict';
import {TursoDatabase} from '../src/turso.mjs';
import {NurseBot, verifySignature} from '../src/bot.mjs';
import {parseSchedule, DEFAULT_CONFIG, shiftRange, remindersDue, assertNoOverlap, bangkokDate, nextMonth} from '../src/domain.mjs';

const owner = 'U' + 'a'.repeat(32);

async function fixture(now = Date.parse('2026-11-01T07:00:00+07:00')) {
  const db = new TursoDatabase({ url: ':memory:' });
  await db.initSchema();
  const clock = { value: now };
  const env = { LINE_OWNER_USER_ID: owner, LINE_CHANNEL_SECRET: 'test-secret', LINE_CHANNEL_ACCESS_TOKEN: 'fake-token' };
  const bot = new NurseBot(db, env, { now: () => clock.value, fetchFn: async () => new Response('{}', { status: 200 }) });
  return { db, clock, bot, env };
}

test('Thai year, multi shifts, explicit day off and invalid days', () => {
  const rows = parseSchedule('เพิ่มเวร 2569-11\n1 ช บ\n2 ด\n3 ห');
  assert.deepEqual(rows[0], { date: '2026-11-01', types: ['เช้า', 'บ่าย'] });
  assert.deepEqual(rows[2].types, []);
  for (const text of ['เพิ่มเวร 2026-02\n30 ช', 'เพิ่มเวร 2026-11\n1 ช\n1 บ', 'เพิ่มเวร 2026-11\n1 ช ห', 'เพิ่มเวร 2026-11\n1 X', 'เพิ่มเวร 2026-11\n1 ช ช']) {
    assert.throws(() => parseSchedule(text));
  }
});

test('midnight shifts are dated by start; Bangkok year rollover', () => {
  const c = DEFAULT_CONFIG();
  const night = shiftRange('2026-11-02', 'ดึก', c);
  const evening = shiftRange('2026-11-01', 'บ่าย', c);
  assert.equal(new Date(night.start).toISOString(), '2026-11-01T17:00:00.000Z');
  assert.equal(evening.end, night.start);
  assert.equal(bangkokDate(Date.parse('2026-12-31T18:00:00Z')), '2027-01-01');
  assert.equal(nextMonth(Date.parse('2026-12-15T00:00:00Z')), '2027-01');
});

test('database operations and schedule workflow in Turso async model', async () => {
  const { bot } = await fixture();
  await bot.handle('ยืนยันเวลาเวร');

  const preview = await bot.handle('เพิ่มเวร 2026-11\n1 ช\n2 บ');
  assert.equal((await bot.rows()).length, 0);

  const confirmMsg = preview.quickReply.items[0].action.text;
  await bot.handle(confirmMsg);
  const rows = await bot.rows();
  assert.equal(rows.length, 2);
  assert.deepEqual(rows, [{ date: '2026-11-01', type: 'เช้า' }, { date: '2026-11-02', type: 'บ่าย' }]);

  const todayView = await bot.handle('เวรวันนี้');
  assert.ok(todayView.text.includes('เวรเช้า') || todayView.text.includes('08:00'));

  const calView = await bot.handle('ตารางเวรของฉัน');
  assert.equal(calView.type, 'flex');
});

test('flow postback and setting shift hours', async () => {
  const { bot } = await fixture();
  const menu = await bot.handle('เมนู');
  assert.ok(menu.text.includes('เหมียวเตือนเวร'));

  const settings = await bot.handle('ตั้งค่า');
  assert.ok(settings.text.includes('ตั้งค่า'));

  const changeLead = await bot.handle('เตือนล่วงหน้า 45');
  assert.ok(changeLead.text.includes('45 นาที'));
  assert.equal((await bot.config()).lead, 45);
});

test('reminder enqueue and outbox processing', async () => {
  const { bot, clock } = await fixture(Date.parse('2026-11-01T06:00:00+07:00'));
  await bot.handle('ยืนยันเวลาเวร');
  const p = await bot.handle('เพิ่มเวร 2026-11\n1 ช');
  await bot.handle(p.quickReply.items[0].action.text);
  await bot.handle('เปิดแจ้งเตือน');
  assert.equal((await bot.config()).enabled, true);

  // Advance time to 07:00 (60 minutes before 08:00 shift)
  clock.value = Date.parse('2026-11-01T07:00:00+07:00');
  await bot.enqueueReminders();

  const outboxRes = await bot.db.execute('SELECT * FROM outbox WHERE user_id = ?', [bot.userId]);
  assert.equal(outboxRes.rows.length, 1);
  assert.equal(outboxRes.rows[0].type, 'เช้า');
});
