/**
 * axon-beta.js — Axon AI Beta
 * API   : GET https://exsalapi.my.id/api/ai/text/gpt-5-mini
 * Params: text, apikey
 * Resp  : { author, status, data: { model, content } }
 * Session: dikelola manual via Map (history per sessionId)
 */

const API_BASE = 'https://exsalapi.my.id/api/ai/text/gpt-5-mini';
const API_KEY  = 'freepublic';

// ─── SESSION STORE ────────────────────────────────────────────
// Map<sessionId, Array<{ role: 'user'|'assistant', text: string }>>
const sessions = new Map();

function getHistory(sessionId) {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, []);
  }
  return sessions.get(sessionId);
}

// ─── SYSTEM PROMPT ────────────────────────────────────────────
const SYSTEM = `Kamu adalah Axon AI, asisten AI cerdas dari tim WebPublish. Owner: Saurus.
Identitas: Nama kamu Axon AI. Bukan GPT, bukan Claude, bukan Gemini. Kalau ditanya siapa pembuatmu, jawab "Saurus dari tim WebPublish".
Gaya: santai, natural, ikut bahasa user (Indonesia/Inggris). Langsung kerjakan perintah tanpa banyak tanya.
Kalau diminta buat kode/html/css/js → langsung buat, jangan nanya-nanya dulu.
Tools (tulis di baris PERTAMA respons, HANYA kalau user eksplisit minta cari/cek/download):
[TOOL:websearch|query] → cari info/berita
[TOOL:tiktokstalk|username] → profil TikTok
[TOOL:tiktokvideo|keyword] → video TikTok
[TOOL:pinterest|keyword] → foto Pinterest
[TOOL:lyrics|judul artis] → lirik lagu
[TOOL:mcpe|keyword] → addon MCPE
[TOOL:ssweb|url|desktop] → screenshot web (tanya mode jika tidak disebutkan)
[TOOL:tiktokearnings|username] → estimasi penghasilan TikTok
[TOOL:npm|package] → info package NPM
Jangan pakai tool kalau user chat biasa atau minta buat sesuatu — jawab langsung.`;

// ─── BUILD PROMPT ─────────────────────────────────────────────
// Format: system → history → pesan baru → "Axon AI:"
function buildPrompt(history, newMessage) {
  const lines = [];

  // System sebagai turn pertama (seed karakter)
  lines.push(`System: ${SYSTEM}`);
  lines.push('');

  // History percakapan sebelumnya
  for (const msg of history) {
    lines.push(`${msg.role === 'user' ? 'User' : 'Axon AI'}: ${msg.text}`);
  }

  // Pesan user baru + trigger
  lines.push(`User: ${newMessage}`);
  lines.push(`Axon AI:`);

  return lines.join('\n');
}

// ─── FETCH API ────────────────────────────────────────────────
async function fetchAPI(prompt) {
  const url = new URL(API_BASE);
  url.searchParams.set('text',   prompt);
  url.searchParams.set('apikey', API_KEY);

  const resp = await fetch(url.toString(), {
    method:  'GET',
    headers: {
      'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept':          'application/json, */*',
      'Accept-Language': 'id-ID,id;q=0.9,en;q=0.7',
      'Referer':         'https://exsalapi.my.id/',
      'Cache-Control':   'no-cache',
    },
    signal: AbortSignal.timeout(60000),
  });

  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);

  let data;
  try   { data = await resp.json(); }
  catch { throw new Error('Response bukan JSON'); }

  if (!data?.status) throw new Error(data?.message || 'API status false');

  const content = data?.data?.content;
  if (!content)   throw new Error('Respons kosong dari API');

  return content;
}

// ─── SEND MESSAGE ─────────────────────────────────────────────
export async function sendMessage(userText, sessionId = 'default') {
  const history = getHistory(sessionId);

  // Build prompt dari history sebelum pesan baru
  const prompt = buildPrompt(history, userText);

  // Push pesan user
  history.push({ role: 'user', text: userText });

  let reply;
  try {
    reply = await fetchAPI(prompt);
  } catch (err) {
    history.pop(); // rollback kalau gagal
    const msg = err.message || 'Unknown';
    if (msg.includes('timeout') || err.name === 'TimeoutError') {
      throw new Error('Request timeout. Coba lagi.');
    }
    throw new Error(`Gagal: ${msg}`);
  }

  // Bersihkan reply
  reply = cleanReply(reply);

  // Push reply AI
  history.push({ role: 'assistant', text: reply });

  // Limit: max 20 entry, buang 4 terlama
  if (history.length > 20) {
    history.splice(0, 4);
  }

  return reply;
}

// ─── PARSE TOOL TAG ───────────────────────────────────────────
export function parseToolTag(rawReply) {
  const tagRx = /\[TOOL:(\w+)\|([^\]|]+)(?:\|([^\]]+))?\]/i;
  const match  = rawReply.match(tagRx);

  if (!match) {
    return { toolName: null, toolParam: null, toolExtra: null, cleanReply: rawReply.trim() };
  }

  return {
    toolName:   match[1].toLowerCase(),
    toolParam:  match[2].trim(),
    toolExtra:  match[3]?.trim() || null,
    cleanReply: rawReply.replace(tagRx, '').trim(),
  };
}

// ─── HELPERS ──────────────────────────────────────────────────
function cleanReply(text) {
  return text
    .replace(/\u001c[^\n]*/g, '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/^Axon AI:\s*/i, '')
    .trim();
}

// ─── META ─────────────────────────────────────────────────────
export const meta = {
  id:          'axon-beta',
  name:        'Axon AI Beta',
  description: 'Model default Axon AI oleh Saurus. Powered by GPT-5 Mini.',
  badge:       'BETA',
  default:     true,
};
