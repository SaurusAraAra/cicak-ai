/**
 * axon-opgos-1.js — Axon AI OpGos-1
 * API   : GET https://api.siputzx.my.id/api/ai/gemini
 * Params: text, cookie (random stabil per sesi), promptSystem, imageurl (opsional)
 * Resp  : { status, data: { response } }
 *
 * Session: manual history array [{role, text}], simpan semua pesan
 * Vision : kalau ada imageUrl → dikirim ke param imageurl
 */

const API_BASE = 'https://api.siputzx.my.id/api/ai/gemini';

function randCookie() {
  return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
}

// ─── SESSION STORE ────────────────────────────────────────────
const sessions = new Map();

function getSession(sessionId) {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, { history: [], cookie: randCookie() });
  }
  return sessions.get(sessionId);
}

// ─── SYSTEM PROMPT ────────────────────────────────────────────
const BASE_SYSTEM = `Kamu adalah Axon AI, asisten AI multimodal cerdas dari tim WebPublish. Owner: Saurus. Bukan Claude, bukan ChatGPT, bukan Gemini. Nama kamu Axon AI OpGos-1. Bahasa santai, langsung kerjakan permintaan tanpa banyak tanya. Kalau diminta buat kode/html/css/js langsung buat. Kamu bisa melihat dan menganalisis gambar yang dikirim user. Tools tersedia, tulis di baris PERTAMA respons HANYA kalau user minta cari/cek sesuatu: [TOOL:websearch|query] [TOOL:tiktokstalk|user] [TOOL:tiktokvideo|kw] [TOOL:pinterest|kw] [TOOL:lyrics|judul artis] [TOOL:mcpe|kw] [TOOL:ssweb|url|desktop] [TOOL:tiktokearnings|user] [TOOL:npm|pkg]. Jangan pakai tool kalau bisa dijawab sendiri.`;

function buildSystem(history) {
  if (!history.length) return BASE_SYSTEM;
  const histLines = history
    .map(m => `${m.role === 'user' ? 'User' : 'Axon AI'}: ${m.text}`)
    .join('\n');
  return `${BASE_SYSTEM}\n\n== Riwayat percakapan ==\n${histLines}`;
}

// ─── SEND MESSAGE ─────────────────────────────────────────────
export async function sendMessage(userText, sessionId = 'default', imageUrl = null) {
  const sess   = getSession(sessionId);
  const system = buildSystem(sess.history);

  const url = new URL(API_BASE);
  url.searchParams.set('text',         userText);
  url.searchParams.set('cookie',       sess.cookie);
  url.searchParams.set('promptSystem', system);
  if (imageUrl) url.searchParams.set('imageurl', imageUrl);

  const userEntry = imageUrl ? `${userText} [gambar: ${imageUrl}]` : userText;
  sess.history.push({ role: 'user', text: userEntry });

  let resp, data;

  try {
    resp = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept':          'application/json, */*',
        'Accept-Language': 'id-ID,id;q=0.9,en;q=0.7',
        'Referer':         'https://api.siputzx.my.id/',
        'Cache-Control':   'no-cache',
      },
      signal: AbortSignal.timeout(60000),
    });
  } catch (err) {
    sess.history.pop();
    throw new Error(err.name === 'TimeoutError' || err.name === 'AbortError'
      ? 'Request timeout. Coba lagi.'
      : `Network error: ${err.message}`);
  }

  if (!resp.ok) {
    sess.history.pop();
    throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
  }

  try { data = await resp.json(); }
  catch { sess.history.pop(); throw new Error('Response bukan JSON'); }

  if (!data?.status || !data?.data?.response) {
    sess.history.pop();
    throw new Error(data?.message || 'API error atau response kosong');
  }

  const reply = cleanReply(data.data.response);
  sess.history.push({ role: 'assistant', text: reply });

  return reply;
}

// ─── PARSE TOOL TAG ───────────────────────────────────────────
export function parseToolTag(rawReply) {
  const tagRx = /\[TOOL:(\w+)\|([^\]|]+)(?:\|([^\]]+))?\]/i;
  const match  = rawReply.match(tagRx);
  if (!match) return { toolName: null, toolParam: null, toolExtra: null, cleanReply: rawReply.trim() };
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
  id:          'axon-opgos-1',
  name:        'Axon AI OpGos-1',
  description: 'Model gaul. Bisa membaca dan menganalisis gambar.',
  badge:       'VISION',
  bisagambar:  true,
  default:     false,
};
