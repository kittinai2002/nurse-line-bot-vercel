import {verifySignature, NurseBot} from '../src/bot.mjs';
import {TursoDatabase} from '../src/turso.mjs';

let db = null;
let schemaInit = false;

function getDb() {
  if (!db) {
    db = new TursoDatabase({
      url: process.env.TURSO_DATABASE_URL,
      authToken: process.env.TURSO_AUTH_TOKEN
    });
  }
  return db;
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({ ok: true, message: 'LINE Webhook endpoint ready. Send POST from LINE.' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const signature = req.headers['x-line-signature'];
  const channelSecret = process.env.LINE_CHANNEL_SECRET;

  // Read raw body
  let rawBody = '';
  if (typeof req.body === 'string') {
    rawBody = req.body;
  } else if (Buffer.isBuffer(req.body)) {
    rawBody = req.body.toString('utf8');
  } else if (req.body && typeof req.body === 'object') {
    rawBody = JSON.stringify(req.body);
  } else {
    // If body stream is unparsed
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    rawBody = Buffer.concat(chunks).toString('utf8');
  }

  if (!verifySignature(rawBody, signature, channelSecret)) {
    return res.status(401).json({ error: 'invalid_signature' });
  }

  let body;
  try {
    body = typeof req.body === 'object' && !Buffer.isBuffer(req.body) ? req.body : JSON.parse(rawBody);
  } catch {
    return res.status(400).json({ error: 'invalid_json' });
  }

  if (!Array.isArray(body.events)) {
    return res.status(400).json({ error: 'invalid_events' });
  }

  const database = getDb();
  if (!schemaInit) {
    try {
      await database.initSchema();
      schemaInit = true;
    } catch (err) {
      console.error('schema_init_error', err);
    }
  }

  const env = {
    LINE_CHANNEL_SECRET: process.env.LINE_CHANNEL_SECRET,
    LINE_CHANNEL_ACCESS_TOKEN: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    LINE_OWNER_USER_ID: process.env.LINE_OWNER_USER_ID
  };

  // Process all incoming events
  const promises = body.events.map(async (event) => {
    if (event.source?.type !== 'user' || !event.source?.userId) return;
    const bot = new NurseBot(database, env, { userId: event.source.userId });
    await bot.processEvent(event);
  });

  await Promise.allSettled(promises);

  return res.status(200).json({ ok: true });
}
