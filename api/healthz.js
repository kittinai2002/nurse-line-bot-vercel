export default function handler(req, res) {
  res.status(200).json({ ok: true, service: 'nurse-line-bot-vercel', version: '2.5.0-vercel' });
}
