import {NurseBot} from '../src/bot.mjs';
import {TursoDatabase} from '../src/turso.mjs';

let db = null;
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
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers.authorization;
    const querySecret = req.query?.secret;
    if (authHeader !== `Bearer ${cronSecret}` && querySecret !== cronSecret) {
      return res.status(401).json({ error: 'unauthorized' });
    }
  }

  const database = getDb();
  const env = {
    LINE_CHANNEL_SECRET: process.env.LINE_CHANNEL_SECRET,
    LINE_CHANNEL_ACCESS_TOKEN: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    LINE_OWNER_USER_ID: process.env.LINE_OWNER_USER_ID
  };

  try {
    const accounts = await database.execute('SELECT user_id FROM accounts');
    const userIds = accounts.rows.map(r => r.user_id);
    if (env.LINE_OWNER_USER_ID && !userIds.includes(env.LINE_OWNER_USER_ID)) {
      userIds.push(env.LINE_OWNER_USER_ID);
    }

    let processed = 0;
    for (const userId of userIds) {
      try {
        const bot = new NurseBot(database, env, { userId });
        await bot.tick();
        processed++;
      } catch (err) {
        console.error(`tick_failed_for_${userId}`, err);
      }
    }

    return res.status(200).json({ ok: true, users_processed: processed, timestamp: Date.now() });
  } catch (err) {
    console.error('tick_error', err);
    return res.status(500).json({ error: 'tick_failed', message: err.message });
  }
}
