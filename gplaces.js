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
async function classifyBatch(photos) {
  const imgs = await Promise.all(photos.map(async p => {
    try {
      const r = await fetch(await photoUri(p.name, 400));
      return { mime: r.headers.get('content-type') || 'image/jpeg', b64: Buffer.from(await r.arrayBuffer()).toString('base64') };
    } catch { return null; }
  }));
  const content = [];
  imgs.forEach((im, i) => { if (im && /^image\/(jpeg|png|webp|gif)$/.test(im.mime)) content.push({ type: 'text', text: `Image ${i}:` }, { type: 'image', source: { type: 'base64', media_type: im.mime, data: im.b64 } }); });
  if (!content.length) return [];
  content.push({ type: 'text', text: 'These are Google Maps photos of a restaurant/hotel/shop. List the indices of images that mainly show food or drinks (dishes, bowls, buffet spreads, desserts), best-looking first. Exclude menus, storefronts, rooms, people, receipts, and near-duplicates of an image already listed.' });
  claude ??= new Anthropic();
  const res = await claude.beta.messages.create({
    model: 'claude-opus-5-5', max_tokens: 4000,
    betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
    output_config: { effort: 'low', format: { type: 'json_schema', schema: { type: 'object', additionalProperties: false, required: ['food'], properties: { food: { type: 'array', items: { type: 'integer' } } } } } },
    messages: [{ role: 'user', content }],
  });
  if (res.stop_reason === 'refusal') return [];
  const t = res.content.find(b => b.type === 'text');
  return t ? [...new Set(JSON.parse(t.text).food)].filter(i => Number.isInteger(i) && i >= 0 && i < photos.length).map(i => photos[i]) : [];
}
// Returns food photos in preference order, or null when classification is unavailable.
async function pickFood(photos) {
  if (!process.env.ANTHROPIC_API_KEY || photos.length < 2) return null;
  const batches = []; for (let i = 0; i < photos.length; i += 15) batches.push(photos.slice(i, i + 15));
  const results = await Promise.all(batches.map(b => classifyBatch(b).catch(e => { console.error('classify', e.message); return []; })));
  return results.flat();
}

const toPhotos = arr => (arr || []).map(ph => ({ name: ph.name, by: (ph.authorAttributions || []).map(a => a.displayName).filter(Boolean).join(', ') }));
async function placeOne(id, lang, mask) {
  const r = await gfetch(`${BASE}places/${id}?languageCode=${lang}`, { headers: { 'X-Goog-FieldMask': mask } });
  return r.json();
}
const distM = (a, b) => { const R = 6371e3, k = Math.PI / 180, x = (b.longitude - a.longitude) * k * Math.cos((a.latitude + b.latitude) * k / 2), y = (b.latitude - a.latitude) * k; return Math.sqrt(x * x + y * y) * R; };
const tokens = s => new Set(String(s || '').toLowerCase().split(/[\s・·,()（）\-]+/).filter(t => t.length >= 3));
// Other Google listings for the same business (e.g. a hotel's restaurant): same name token, within 300 m.
async function relatedPlaces(base, names) {
  if (!base.location) return [];
  const want = new Set(names.flatMap(n => [...tokens(n)]));
  const out = new Map();
  for (const q of names.slice(0, 2).map(n => `${n} レストラン`)) {
    try {
      const r = await gfetch(BASE + 'places:searchText', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Goog-FieldMask': 'places.id,places.displayName,places.location,places.photos' },
        body: JSON.stringify({ textQuery: q, languageCode: 'ja', maxResultCount: 10, locationBias: { circle: { center: base.location, radius: 300 } } }),
      });
      for (const p of (await r.json()).places || []) {
        if (p.id === base.id || !p.location || distM(base.location, p.location) > 300) continue;
        if (![...tokens(p.displayName?.text)].some(t => want.has(t))) continue;
        out.set(p.id, p);
      }
    } catch (e) { console.error('related', e.message); }
  }
  return [...out.values()];
}

// Short in-memory cache so opening the tab doesn't re-query Google/Claude every time.
const cache = new Map(); const TTL = 6 * 3600e3;
async function details(id) {
  if (!PLACE_ID.test(id)) throw new Error('bad place id');
  const hit = cache.get(id); if (hit && Date.now() - hit.t < TTL) return hit.v;
  const mask = 'id,displayName,rating,userRatingCount,googleMapsUri,photos,location';
  const [zh, ja, en] = await Promise.all(['zh-TW', 'ja', 'en'].map(l => placeOne(id, l, mask).catch(() => null)));
  const base = zh || ja || en; if (!base) throw new Error('place not found');
  const related = await relatedPlaces(base, [ja?.displayName?.text, en?.displayName?.text].filter(Boolean));
  const seen = new Set(), all = [];
  for (const src of [zh, ja, en, ...related]) for (const ph of toPhotos(src?.photos)) {
    const key = ph.name.split('/photos/')[1]; if (seen.has(key)) continue; seen.add(key); all.push(ph);
  }
  const pool = all.slice(0, 30);
  let food = null;
  try { food = await pickFood(pool); } catch (e) { console.error('food pick failed', e.message); }
  // Only food shots when Claude found some; otherwise show what Google has.
  const chosen = (food && food.length ? food : pool).slice(0, 10);
  const v = { rating: base.rating ?? null, ratings: base.userRatingCount ?? 0, mapsUri: base.googleMapsUri || null, photos: chosen, foodCount: food ? Math.min(food.length, 10) : 0, scanned: pool.length, related: related.length };
  cache.set(id, { t: Date.now(), v });
  return v;
}

module.exports = { enabled, search, details, photoUri };
