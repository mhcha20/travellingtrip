// Reads a photographed receipt with Claude and returns structured fields.
const AnthropicMod = require('@anthropic-ai/sdk');
const Anthropic = AnthropicMod.default || AnthropicMod;

const CATEGORIES = ['交通', '住宿', '餐飲', '購物', '門票/活動', '藥妝', '通訊', '其他'];

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['is_receipt', 'date', 'store', 'store_zh', 'total', 'currency', 'category', 'tax', 'payment', 'items', 'summary_zh'],
  properties: {
    is_receipt: { type: 'boolean', description: 'false if the photo is not a receipt/invoice' },
    date: { type: 'string', description: 'Purchase date as YYYY-MM-DD, or empty string if unreadable' },
    store: { type: 'string', description: 'Store name as printed' },
    store_zh: { type: 'string', description: 'Store name in Traditional Chinese (Hong Kong usage)' },
    total: { type: 'number', description: 'Final amount paid, including tax' },
    currency: { type: 'string', enum: ['JPY', 'HKD', 'OTHER'] },
    category: { type: 'string', enum: CATEGORIES },
    tax: { type: 'number', description: 'Consumption tax amount shown, 0 if none' },
    payment: { type: 'string', description: 'Payment method shown (現金, クレジット, Suica...), or empty string' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'name_zh', 'qty', 'price'],
        properties: {
          name: { type: 'string', description: 'Item name as printed' },
          name_zh: { type: 'string', description: 'Short Traditional Chinese translation of what the item is' },
          qty: { type: 'number' },
          price: { type: 'number', description: 'Line total for this item' },
        },
      },
    },
    summary_zh: { type: 'string', description: 'One short Traditional Chinese line describing what was bought' },
  },
};

const PROMPT = `This is a photo of a receipt from a trip to Japan (Hokkaido / Osaka, February 2027).
Extract the fields in the schema.
- Dates may be printed as 2027年2月18日, 2027/02/18, 27-02-18 or in the Reiwa era (令和9年 = 2027). Return YYYY-MM-DD.
- "total" is the amount actually paid (合計 / お会計 / 税込), not 預り (cash handed over) or お釣り (change).
- List every purchased line item. Skip discount lines unless they are the only information; skip subtotal/tax lines.
- Translate item names into short Traditional Chinese as used in Hong Kong.
- Pick the category that best fits the store: restaurants/cafes/convenience-store food = 餐飲, drugstores = 藥妝, trains/taxis/buses = 交通.
If the image is not a receipt, set is_receipt to false and leave the other fields empty or 0.`;

let client;
function enabled() { return !!process.env.ANTHROPIC_API_KEY; }

async function scanReceipt(dataUrl) {
  const m = /^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/.exec(dataUrl);
  if (!m) throw new Error('bad image');
  client ??= new Anthropic();
  const response = await client.beta.messages.create({
    model: 'claude-opus-5-5',
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } },
        { type: 'text', text: PROMPT },
      ],
    }],
  });
  if (response.stop_reason === 'refusal') throw new Error('refused');
  const text = response.content.find(b => b.type === 'text');
  if (!text) throw new Error('no output');
  return JSON.parse(text.text);
}

module.exports = { scanReceipt, enabled };
