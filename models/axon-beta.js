/**
 * axon-beta.js — Axon AI Beta
 * API   : GET https://exsalapi.my.id/api/ai/text/gpt-5-mini
 * Params: text, apikey
 * Session: dikelola manual (history array per sessionId)
 */

const API_BASE = 'https://exsalapi.my.id/api/ai/text/gpt-5-mini';
const API_KEY  = 'freepublic';

// ─── SESSION STORE ────────────────────────────────────────────
// Map<sessionId, Array<{ role: 'user'|'assistant', text: string }>>
const sessions = new Map();

function getSession(id) {
  if (!sessions.has(id)) sessions.set(id, []);
  return sessions.get(id);
}

// ─── SYSTEM PROMPT ────────────────────────────────────────────
const SYSTEM = `Kamu adalah Axon AI, asisten AI cerdas dari tim WebPublish (owner: Saurus). Bukan Claude, bukan ChatGPT, bukan Gemini.
Gaya bahasa santai, natural, ikut bahasa user. Langsung kerjakan apa yang diminta — jangan tanya-tanya dulu.
Kalau user minta buat kode/html/css/js → langsung buat.

Tools tersedia, tulis di baris PERTAMA respons HANYA kalau user minta cari/cek sesuatu di luar:
[TOOL:websearch|query]          → cari info/berita internet
[TOOL:tiktokstalk|username]     → profil TikTok
[TOOL:tiktokvideo|keyword]      → cari video TikTok
[TOOL:pinterest|keyword]        → cari foto Pinterest
[TOOL:lyrics|judul artis]       → lirik lagu
[TOOL:mcpe|keyword]             → addon MCPE
[TOOL:ssweb|url|desktop]        → screenshot website
[TOOL:tiktokearnings|username]  → estimasi penghasilan TikTok
[TOOL:npm|package]              → info package NPM

Jangan pakai tool kalau user chat biasa atau minta buat sesuatu — jawab langsung.`;

// ─── BUILD PROMPT ─────────────────────────────────────────────
// Format: system → history → pesan baru → "Axon AI:"
function buildPrompt(history, newMessage) {
  const lines = [];

  // System sebagai turn seed
  lines.push(`System: ${SYSTEM}`);
  lines.push('');

  // History percakapan
  for (const msg of history) {
    lines.push(`${msg.role === 'user' ? 'User' : 'Axon AI'}: ${msg.text}`);
  }

  // Pesan baru
  lines.push(`User: ${newMessage}`);
  lines.push(`Axon AI:`);

  return lines.join('\n');
}

// ─── FETCH ────────────────────────────────────────────────────
async function callAPI(prompt) {
  const url = new URL(API_BASE);
  url.searchParams.set('text',   prompt);
  url.searchParams.set('apikey', API_KEY);

  const resp = await fetch(url.toString(), {
    method:  'GET',
    headers: {
      'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept':          'application/json, */*',
      'Accept-Language': 'id-ID,id;q=0.9,en;q=0.7',
      'Cache-Control':   'no-cache',
    },
    signal: AbortSignal.timeout(60000),
  });

  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

  const raw = await resp.text();

  let data;
  try { data = JSON.parse(raw); }
  catch { throw new Error(`Bukan JSON: ${raw.slice(0, 200)}`); }

  // Coba berbagai kemungkinan struktur response
  const answer =
    data?.result   ||
    data?.response ||
    data?.answer   ||
    data?.data?.result   ||
    data?.data?.response ||
    data?.data?.answer   ||
    data?.message  ||
    null;

  if (!answer) throw new Error(`Respons kosong. Raw: ${raw.slice(0, 200)}`);

  return String(answer);
}

// ─── SEND MESSAGE ─────────────────────────────────────────────
export async function sendMessage(userText, sessionId = 'default') {
  const history = getSession(sessionId);
  const prompt  = buildPrompt(history, userText);

  // Push user ke history
  history.push({ role: 'user', text: userText });

  let rawReply;
  try {
    rawReply = await callAPI(prompt);
  } catch (err) {
    history.pop(); // rollback kalau gagal
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      throw new Error('Request timeout. Coba lagi.');
    }
    throw new Error(`Gagal: ${err.message}`);
  }

  rawReply = cleanReply(rawReply);

  // Push reply AI ke history
  history.push({ role: 'assistant', text: rawReply });

  // Limit 20 entry, buang 4 terlama
  if (history.length > 20) history.splice(0, 4);

  return rawReply;
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
  description: 'Model default Axon AI oleh WebPublish. Powered by GPT-5 Mini.',
  badge:       'BETA',
  default:     true,
};
