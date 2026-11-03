// "Paste a link, fill in the rest": reads a public post page, asks Claude which place it features,
// then (if configured) finds it on Google Places.
const dns = require('dns').promises;
const net = require('net');
const AnthropicMod = require('@anthropic-ai/sdk');
const Anthropic = AnthropicMod.default || AnthropicMod;
const gplaces = require('./gplaces');

const AREAS = ['登別', '札幌', '小樽', '洞爺湖', '新千歲機場', '北海道其他', '大阪', '京都', '神戶', '奈良', '關西其他', '其他'];
const KINDS = ['food', 'sight', 'shop', 'stay', 'other'];
const CUISINES = ['拉麵', '壽司', '迴轉壽司', '海鮮丼', '海鮮', '蟹', '燒肉', '成吉思汗', '串燒', '爐端燒', '天婦羅', '炸豬扒', '居酒屋', '湯咖喱', '和牛', '鰻魚', '河豚', '龍蝦', '烏冬', '蕎麥麵', '大阪燒', '章魚燒', '串炸', '火鍋', '定食', '自助餐', '甜品', '咖啡', '麵包', '酒吧'];

function privateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80') || v.startsWith('::ffff:') && privateIp(v.slice(7));
}
async function assertPublic(u) {
  if (!/^https?:$/.test(u.protocol)) throw new Error('only http(s)');
  const addrs = await dns.lookup(u.hostname, { all: true });
  if (!addrs.length || addrs.some(a => privateIp(a.address))) throw new Error('blocked host');
}

const decode = s => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));

// Fetches the page openly (honest user agent, no bot-check workarounds) and keeps the useful text.
async function readPage(raw) {
  let u = new URL(raw);
  let res;
  for (let hop = 0; hop < 4; hop++) {
    await assertPublic(u);
    res = await fetch(u, { redirect: 'manual', signal: AbortSignal.timeout(10000), headers: { 'User-Agent': 'TravelTripLinkPreview/1.0 (personal trip planner)', 'Accept-Language': 'zh-HK,zh-TW;q=0.9,ja;q=0.8,en;q=0.7' } });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) { u = new URL(res.headers.get('location'), u); continue; }
    break;
  }
  if (!res.ok) return { ok: false, status: res.status, text: '' };
  const reader = res.body.getReader(); const chunks = []; let n = 0;
  while (n < 1.5e6) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); n += value.length; }
  reader.cancel().catch(() => {});
  const html = Buffer.concat(chunks).toString('utf8');
  const metas = [...html.matchAll(/<meta\s[^>]*(?:property|name)=["']((?:og|twitter):[^"']+|description)["'][^>]*content=["']([^"']*)["'][^>]*>/gi)]
    .concat([...html.matchAll(/<meta\s[^>]*content=["']([^"']*)["'][^>]*(?:property|name)=["']((?:og|twitter):[^"']+|description)["'][^>]*>/gi)].map(m => [m[0], m[2], m[1]]))
    .filter(m => !/image|url|site_name|type|card|player/i.test(m[1]))
    .map(m => `${m[1]}: ${decode(m[2])}`);
  const title = decode((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '').trim();
  const ld = [...html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1].trim()).join('\n').slice(0, 4000);
  const body = decode(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim().slice(0, 4000);
  const text = [title && `title: ${title}`, ...new Set(metas), ld && `json-ld: ${ld}`, body && `page text: ${body}`].filter(Boolean).join('\n').slice(0, 12000);
  return { ok: true, status: res.status, text, finalUrl: u.href };
}

const SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['found', 'name', 'name_local', 'area', 'kind', 'cuisines', 'maps_query', 'note', 'confidence', 'reason', 'verified', 'sources'],
  properties: {
    found: { type: 'boolean', description: 'true if a specific place (shop, restaurant, hotel, sight) was identified' },
    name: { type: 'string', description: 'ONLY the place name in Traditional Chinese as Hong Kong people would say it (keep brand names as-is), optionally with the branch, e.g. 「蟹座 札幌」「米福 梅田店」. Never put descriptions, cuisine or advice in the name; those go in note.' },
    name_local: { type: 'string', description: 'ONLY the official name in Japanese (or the local language), including branch name if any. No descriptions.' },
    cuisines: { type: 'array', items: { type: 'string' }, description: `For food places (and hotel restaurants/breakfasts): 1-4 short Traditional Chinese food-type tags. Prefer these: ${CUISINES.join('、')}. Use a new short tag only if none fit. Empty array for non-food places.` },
    area: { type: 'string', enum: AREAS },
    kind: { type: 'string', enum: KINDS, description: 'food=restaurant/cafe/market, sight=attraction, shop=shopping, stay=hotel/ryokan' },
    maps_query: { type: 'string', description: 'Best Google Maps search text, e.g. official Japanese name + city' },
    note: { type: 'string', description: 'Short notes in Cantonese-style Traditional Chinese: what to eat/do, prices, opening hours, booking tips, from the post' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    reason: { type: 'string', description: 'One line in Traditional Chinese on how the place was identified and what the web search confirmed or contradicted' },
    verified: { type: 'string', description: 'Traditional Chinese: what was checked online (official name, branch address, current prices/hours, still open?) and any differences from the post' },
    sources: { type: 'array', items: { type: 'string' }, description: 'Up to 3 URLs actually used from web search (official site, Tabelog, Google, news)' },
  },
};

let client;
async function identify(url, page, userText) {
  client ??= new Anthropic();
  const prompt = `A friend shared this social media link about a place to visit on a trip to Hokkaido and Osaka (Feb 2027).
URL: ${url}
${page.text ? `Public page content:\n${page.text}` : `The page could not be read (status ${page.status ?? 'error'}).`}
${userText ? `Text the user pasted from the post:\n${userText}` : ''}

Identify the specific place the post features, then ALWAYS use web search to verify it before answering, even when the post names it:
- the official name (Japanese) and the exact branch/address the post refers to,
- current prices, opening hours, closing days and booking method (posts are often out of date),
- whether it is still open (not closed or relocated).
If the post does not name the place, use web search to identify it from the details; never guess a name you cannot support.
In the notes, prefer the verified current facts and mention where they differ from the post. Fill in every field.`;
  const base = {
    model: 'claude-opus-5-5', max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
  };
  const messages = [{ role: 'user', content: prompt }];
  let res;
  try {
    for (let turn = 0; turn < 4; turn++) {
      res = await client.beta.messages.create({ ...base, messages, tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 8 }] });
      if (res.stop_reason !== 'pause_turn') break;
      messages.push({ role: 'assistant', content: res.content });
    }
  } catch (e) {
    console.error('identify with search failed, retrying without', e.message);
    res = await client.beta.messages.create({ ...base, messages: [{ role: 'user', content: prompt }] });
  }
  if (res.stop_reason === 'refusal') throw new Error('refused');
  const t = [...res.content].reverse().find(b => b.type === 'text');
  if (!t) throw new Error('no output');
  return JSON.parse(t.text);
}

async function importLink(url, userText) {
  let page = { ok: false, text: '' };
  try { page = await readPage(url); } catch (e) { page = { ok: false, text: '', status: e.message }; }
  if (!page.text && !userText) return { pageOk: false, extracted: null, candidates: [] };
  const extracted = await identify(url, page, (userText || '').slice(0, 6000));
  let candidates = [];
  if (extracted.found && gplaces.enabled()) {
    try { candidates = (await gplaces.search(extracted.maps_query || extracted.name_local || extracted.name)).slice(0, 3); } catch (e) { console.error('places search', e.message); }
  }
  return { pageOk: !!page.text, extracted, candidates };
}

module.exports = { importLink };
