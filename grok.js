// xAI Grok calls. Used when XAI_API_KEY is set; Claude remains the fallback.
const MODEL = () => process.env.XAI_MODEL || 'grok-4.7';
const enabled = () => !!process.env.XAI_API_KEY;

async function xai(path, body, ms) {
  const res = await fetch('https://api.x.ai' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.XAI_API_KEY },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(ms || 120000),
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = {}; }
  if (!res.ok) {
    const msg = data?.error?.message || data?.error || text.slice(0, 300);
    throw new Error('xai ' + res.status + ' ' + (typeof msg === 'string' ? msg : JSON.stringify(msg)).slice(0, 400));
  }
  return data;
}

function parseJsonText(s) {
  if (s && typeof s === 'object') return s;
  const t = String(s || '').trim();
  try { return JSON.parse(t); } catch { /* fall through */ }
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return JSON.parse(fenced[1]);
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
  throw new Error('no json');
}

function chatText(data) {
  const c = data.choices?.[0]?.message?.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map(p => p.text || '').join('');
  return '';
}

function responsesText(data) {
  if (typeof data.output_text === 'string' && data.output_text) return data.output_text;
  const out = [];
  for (const item of data.output || []) {
    if (typeof item.text === 'string') out.push(item.text);
    const content = item.content;
    if (typeof content === 'string') out.push(content);
    if (Array.isArray(content)) for (const p of content) if (p.text) out.push(p.text);
  }
  return out.join('\n') || chatText(data);
}

function asChatContent(content) {
  return content.map(p => {
    if (p.type === 'input_text') return { type: 'text', text: p.text };
    if (p.type === 'input_image') {
      const url = typeof p.image_url === 'string' ? p.image_url : p.image_url?.url;
      return { type: 'image_url', image_url: { url, detail: p.detail || 'high' } };
    }
    return p;
  });
}

async function completeJson({ input, schema, name, tools }) {
  const format = { type: 'json_schema', name, schema, strict: true };
  const slow = tools ? 180000 : 120000;
  try {
    const data = await xai('/v1/responses', {
      model: MODEL(),
      input,
      ...(tools ? { tools } : {}),
      text: { format },
    }, slow);
    return parseJsonText(responsesText(data));
  } catch (e) {
    console.error('grok responses schema failed', e.message);
  }
  if (tools) {
    try {
      const nudged = input.map(m => typeof m.content === 'string'
        ? { ...m, content: m.content + '\n\nReply with ONLY a JSON object matching this schema, no markdown:\n' + JSON.stringify(schema) }
        : m);
      const data = await xai('/v1/responses', { model: MODEL(), input: nudged, tools }, slow);
      return parseJsonText(responsesText(data));
    } catch (e) {
      console.error('grok responses search failed', e.message);
    }
  }
  const messages = input.map(m => ({
    role: m.role,
    content: Array.isArray(m.content) ? asChatContent(m.content) : m.content,
  }));
  try {
    const data = await xai('/v1/chat/completions', {
      model: MODEL(),
      messages,
      temperature: 0,
      response_format: { type: 'json_schema', json_schema: { name, schema, strict: true } },
    });
    return parseJsonText(chatText(data));
  } catch (e) {
    console.error('grok json_schema failed, trying json_object', e.message);
    const data = await xai('/v1/chat/completions', {
      model: MODEL(),
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: 'Return only JSON matching this schema:\n' + JSON.stringify(schema) }, ...messages],
    });
    return parseJsonText(chatText(data));
  }
}

function visionJson({ dataUrl, prompt, schema, name }) {
  return completeJson({
    schema, name,
    input: [{
      role: 'user',
      content: [
        { type: 'input_image', image_url: dataUrl, detail: 'high' },
        { type: 'input_text', text: prompt },
      ],
    }],
  });
}

function visionContent({ content, schema, name }) {
  return completeJson({ schema, name, input: [{ role: 'user', content }] });
}

function searchJson({ prompt, schema, name }) {
  return completeJson({
    schema, name,
    tools: [{ type: 'web_search' }],
    input: [{ role: 'user', content: prompt }],
  });
}

module.exports = { enabled, visionJson, visionContent, searchJson };
