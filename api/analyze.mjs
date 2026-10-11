// Photo → foods, calories and macros. Runs on Vercel; the browser never sees the API key.
import Anthropic from '@anthropic-ai/sdk';

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['meal_name', 'items', 'notes'],
  properties: {
    meal_name: { type: 'string', description: 'Short name for the whole plate, like "Chicken burrito bowl".' },
    notes: { type: 'string', description: 'One sentence on what was assumed about portion sizes, or empty.' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'portion', 'calories', 'protein', 'carbs', 'fat', 'confidence'],
        properties: {
          name: { type: 'string' },
          portion: { type: 'string', description: 'Estimated amount, like "1 cup" or "150 g".' },
          calories: { type: 'number' },
          protein: { type: 'number', description: 'grams' },
          carbs: { type: 'number', description: 'grams' },
          fat: { type: 'number', description: 'grams' },
          confidence: { type: 'string', enum: ['low', 'medium', 'high'] }
        }
      }
    }
  }
};

const PROMPT = `Look at this photo of food. Identify each distinct food or drink, estimate the portion on the plate from visual cues (plate size, utensils, packaging), and estimate calories and grams of protein, carbohydrate and fat for that portion using typical nutrition data.

Rules:
- One item per distinct food. Combine identical pieces (three tacos is one item with portion "3 tacos").
- If the photo is a nutrition label or packaging, read the label and report one item per serving shown.
- If there is no food in the photo, return an empty items list and say so in notes.
- Round calories to whole numbers and macros to one decimal.`;

async function verifyUser(request) {
  const url = (process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
  const key = (process.env.SUPABASE_PUBLISHABLE_KEY || '').trim();
  const auth = request.headers.authorization || '';
  if (!url || !key || !auth.startsWith('Bearer ')) return false;
  const r = await fetch(`${url}/auth/v1/user`, { headers: { apikey: key, authorization: auth } });
  return r.ok;
}

export default async function handler(request, response) {
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'POST') { response.setHeader('Allow', 'POST'); return response.status(405).end(JSON.stringify({ error: 'Method not allowed.' })); }
  if (!process.env.ANTHROPIC_API_KEY) return response.status(503).end(JSON.stringify({ error: 'Set ANTHROPIC_API_KEY in Vercel to enable photo logging.' }));
  if (!(await verifyUser(request))) return response.status(401).end(JSON.stringify({ error: 'Sign in to analyze a photo.' }));

  const body = typeof request.body === 'string' ? JSON.parse(request.body || '{}') : (request.body || {});
  const data = typeof body.image === 'string' ? body.image.replace(/^data:image\/\w+;base64,/, '') : '';
  const mediaType = ['image/jpeg', 'image/png', 'image/webp'].includes(body.media_type) ? body.media_type : 'image/jpeg';
  if (!data || data.length > 6_000_000) return response.status(400).end(JSON.stringify({ error: 'Send one image under 4 MB.' }));
  const hint = typeof body.hint === 'string' ? body.hint.trim().slice(0, 200) : '';

  // An organization-level key must name a workspace; a key created inside a workspace does not.
  const workspace = (process.env.ANTHROPIC_WORKSPACE_ID || '').trim();
  const client = new Anthropic(workspace ? { defaultHeaders: { 'anthropic-workspace-id': workspace } } : {});
  try {
    const result = await client.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 4096,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data } },
          { type: 'text', text: hint ? `${PROMPT}\n\nThe person says: "${hint}"` : PROMPT }
        ]
      }]
    });
    if (result.stop_reason === 'refusal') return response.status(422).end(JSON.stringify({ error: 'This photo could not be analyzed. Try another angle.' }));
    const text = result.content.filter(b => b.type === 'text').map(b => b.text).join('');
    const parsed = JSON.parse(text);
    return response.status(200).end(JSON.stringify(parsed));
  } catch (error) {
    console.error('analyze error', error?.status, error?.message);
    const status = error?.status === 429 ? 429 : error?.status === 401 ? 401 : 502;
    const detail = (error?.message || String(error)).slice(0, 300);
    const msg = status === 429 ? 'The photo service is busy. Try again in a moment.' : status === 401 ? 'The ANTHROPIC_API_KEY in Vercel was rejected. Check the key and redeploy.' : `Could not analyze the photo: ${detail}`;
    return response.status(status).end(JSON.stringify({ error: msg }));
  }
}
