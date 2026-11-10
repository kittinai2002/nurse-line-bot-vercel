import {verifySignature, NurseBot} from '../src/bot.mjs';
import {TursoDatabase} from '../src/turso.mjs';

// Disable Vercel's default body parser so we can read the raw Buffer for HMAC SHA256 verification
export const config = {
  api: {
    bodyParser: false,
  },
};

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
  const channelSecret = (process.env.LINE_CHANNEL_SECRET || '').trim();

  if (!channelSecret) {
    console.error('Missing LINE_CHANNEL_SECRET in environment variables');
    return res.status(500).json({ error: 'missing_channel_secret' });
  }

  // Read raw body Buffer for HMAC verification
  let rawBuffer;
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    rawBuffer = Buffer.concat(chunks);
  } catch (err) {
    console.error('Failed to read request body stream', err);
    return res.status(400).json({ error: 'failed_to_read_body' });
  }

  if (!verifySignature(rawBuffer, signature, channelSecret)) {
    console.error('Invalid LINE signature verification');
    return res.status(401).json({ error: 'invalid_signature' });
  }

  let body;
  try {
    body = JSON.parse(rawBuffer.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'invalid_json' });
  }

  if (!Array.isArray(body.events)) {
    return res.status(400).json({ error: 'invalid_events' });
  }

  // LINE Verify button sends {"events":[], ...}
  if (body.events.length === 0) {
    return res.status(200).json({ ok: true, message: 'webhook_verified' });
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
    LINE_CHANNEL_SECRET: channelSecret,
    LINE_CHANNEL_ACCESS_TOKEN: (process.env.LINE_CHANNEL_ACCESS_TOKEN || '').trim(),
    LINE_OWNER_USER_ID: (process.env.LINE_OWNER_USER_ID || '').trim()
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
