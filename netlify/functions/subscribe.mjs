// Adds a breakoutpod.com signup (guestbook or fan club) to the beehiiv newsletter.
// Needs two environment variables in Netlify (Site configuration > Environment variables):
//   BEEHIIV_API_KEY         - from beehiiv Settings > API
//   BEEHIIV_PUBLICATION_ID  - starts with "pub_"
// Optional beehiiv custom fields it fills if they exist: Name, Source, Seat, Ticket No

const ALLOWED = [/^https:\/\/(www\.)?breakoutpod\.com$/, /^https:\/\/[a-z0-9-]+\.netlify\.app$/];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const clip = (v, n) => String(v ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, n);
const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export default async (req) => {
  if (req.method !== 'POST') return reply(405, { ok: false, error: 'POST only' });
  const origin = req.headers.get('origin') || '';
  if (origin && !ALLOWED.some((r) => r.test(origin))) return reply(403, { ok: false, error: 'Not allowed' });

  const key = process.env.BEEHIIV_API_KEY;
  const pub = process.env.BEEHIIV_PUBLICATION_ID;
  if (!key || !pub) return reply(503, { ok: false, error: 'Newsletter not configured yet' });

  let d;
  try { d = await req.json(); } catch { return reply(400, { ok: false, error: 'Bad request' }); }
  if (d['bot-field']) return reply(200, { ok: true }); // spam trap: pretend success
  const email = clip(d.email, 120).toLowerCase();
  if (!EMAIL.test(email)) return reply(400, { ok: false, error: 'Enter a valid email address.' });

  const source = d.source === 'fanclub' ? 'Fan club' : 'Guestbook';
  const fields = [
    ['Name', clip(d.name, 40)],
    ['Source', source],
    ['Seat', clip(d.seat, 4)],
    ['Ticket No', clip(d.member, 12)],
  ].filter(([, v]) => v).map(([name, value]) => ({ name, value }));

  const base = {
    email,
    reactivate_existing: false,
    send_welcome_email: true,
    utm_source: 'breakoutpod.com',
    utm_medium: source === 'Fan club' ? 'fanclub' : 'guestbook',
    referring_site: 'https://breakoutpod.com',
  };

  const send = (body) => fetch(`https://api.beehiiv.com/v2/publications/${encodeURIComponent(pub)}/subscriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  try {
    let res = await send({ ...base, custom_fields: fields });
    // If beehiiv rejects the custom fields (e.g. they haven't been created), retry without them.
    if (!res.ok && res.status >= 400 && res.status < 500 && res.status !== 401 && res.status !== 403) {
      res = await send(base);
    }
    if (!res.ok) {
      console.error('beehiiv error', res.status, (await res.text()).slice(0, 300));
      return reply(502, { ok: false, error: 'Could not reach the newsletter.' });
    }
    return reply(200, { ok: true });
  } catch (err) {
    console.error('beehiiv request failed', err);
    return reply(502, { ok: false, error: 'Could not reach the newsletter.' });
  }
};
