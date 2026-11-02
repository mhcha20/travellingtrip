// Google Places (New) lookups + picking food photos with Claude.
// Photos are fetched live (not stored) and shown with Google's required attribution.
const AnthropicMod = require('@anthropic-ai/sdk');
const Anthropic = AnthropicMod.default || AnthropicMod;

const KEY = () => process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAP_API_KEY || '';
const BASE = 'https://places.googleapis.com/v1/';
const enabled = () => !!KEY();
const PHOTO_NAME = /^places\/[A-Za-z0-9_-]+\/photos\/[A-Za-z0-9_-]+$/;
const PLACE_ID = /^[A-Za-z0-9_-]{10,}$/;

async function gfetch(url, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { 'X-Goog-Api-Key': KEY(), ...(opts.headers || {}) } });
  if (!r.ok) throw new Error(`places ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r;
}

async function search(q) {
  const r = await gfetch(BASE + 'places:searchText', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.primaryTypeDisplayName' },
    body: JSON.stringify({ textQuery: q, languageCode: 'zh-TW', regionCode: 'JP', maxResultCount: 5 }),
  });
  const { places = [] } = await r.json();
  return places.map(p => ({ id: p.id, name: p.displayName?.text, address: p.formattedAddress, lat: p.location?.latitude, lng: p.location?.longitude, rating: p.rating ?? null, ratings: p.userRatingCount ?? 0, type: p.primaryTypeDisplayName?.text || '' }));
}

async function photoUri(name, w = 800) {
  if (!PHOTO_NAME.test(name)) throw new Error('bad photo name');
  const r = await gfetch(`${BASE}${name}/media?maxWidthPx=${Math.min(1600, Math.max(100, w | 0))}&skipHttpRedirect=true`);
  return (await r.json()).photoUri;
}

let claude;
async function pickFood(photos) {
  if (!process.env.ANTHROPIC_API_KEY || photos.length < 2) return null;
  const imgs = await Promise.all(photos.map(async p => {
    try {
      const r = await fetch(await photoUri(p.name, 400));
      return { mime: r.headers.get('content-type') || 'image/jpeg', b64: Buffer.from(await r.arrayBuffer()).toString('base64') };
    } catch { return null; }
  }));
  const content = [];
  imgs.forEach((im, i) => { if (im && /^image\/(jpeg|png|webp|gif)$/.test(im.mime)) { content.push({ type: 'text', text: `Image ${i}:` }, { type: 'image', source: { type: 'base64', media_type: im.mime, data: im.b64 } }); } });
  content.push({ type: 'text', text: 'These are Google Maps photos of a restaurant/hotel/shop. List the indices of images that mainly show food or drinks (dishes, bowls, buffet spreads, desserts), best-looking first. Exclude menus, storefronts, rooms, people, receipts.' });
  claude ??= new Anthropic();
  const res = await claude.beta.messages.create({
    model: 'claude-opus-5-5', max_tokens: 4000,
    betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
    output_config: { effort: 'low', format: { type: 'json_schema', schema: { type: 'object', additionalProperties: false, required: ['food'], properties: { food: { type: 'array', items: { type: 'integer' } } } } } },
    messages: [{ role: 'user', content }],
  });
  if (res.stop_reason === 'refusal') return null;
  const t = res.content.find(b => b.type === 'text');
  return t ? JSON.parse(t.text).food.filter(i => Number.isInteger(i) && i >= 0 && i < photos.length) : null;
}

// Short in-memory cache so opening the tab doesn't re-query Google/Claude every time.
const cache = new Map(); const TTL = 6 * 3600e3;
async function details(id) {
  if (!PLACE_ID.test(id)) throw new Error('bad place id');
  const hit = cache.get(id); if (hit && Date.now() - hit.t < TTL) return hit.v;
  const r = await gfetch(`${BASE}places/${id}?languageCode=zh-TW`, { headers: { 'X-Goog-FieldMask': 'id,displayName,rating,userRatingCount,googleMapsUri,photos' } });
  const p = await r.json();
  const photos = (p.photos || []).slice(0, 10).map(ph => ({ name: ph.name, by: (ph.authorAttributions || []).map(a => a.displayName).filter(Boolean).join(', ') }));
  let order = null;
  try { order = await pickFood(photos); } catch (e) { console.error('food pick failed', e.message); }
  const food = order ? order.map(i => photos[i]) : [];
  const rest = photos.filter(ph => !food.includes(ph));
  const chosen = [...food, ...rest].slice(0, 5);
  const v = { rating: p.rating ?? null, ratings: p.userRatingCount ?? 0, mapsUri: p.googleMapsUri || null, photos: chosen, foodCount: Math.min(food.length, 5) };
  cache.set(id, { t: Date.now(), v });
  return v;
}

module.exports = { enabled, search, details, photoUri };
