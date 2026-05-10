/**
 * axon-beta.js — Axon AI Beta
 * API   : GET https://api.siputzx.my.id/api/ai/gptoss120b
 * Params: prompt (teks user), system (persona AI), temperature (default 0.7)
 * Resp  : { status, data: { response } }
 *
 * Session: manual history array [{role, text}], simpan semua pesan,
 *          history diinjek ke dalam param `system` tiap request
 */

const API_BASE    = 'https://api.siputzx.my.id/api/ai/gptoss120b';
const TEMPERATURE = '0.7';

// ─── SESSION STORE ────────────────────────────────────────────
// Map<sessionId, Array<{ role: 'user'|'assistant', text: string }>>
const sessions = new Map();

function getHistory(sessionId) {
  if (!sessions.has(sessionId)) sessions.set(sessionId, []);
  return sessions.get(sessionId);
}

// ─── SYSTEM PERSONA ───────────────────────────────────────────
// Param `system` = karakter AI + history percakapan sebelumnya
// History dimasukkan di sini agar model "ingat" konteks
const BASE_SYSTEM = `Kamu adalah Axon AI, asisten AI cerdas dari tim WebPublish. Owner: Saurus. Kamu Models Axon Ai Beta, Dan Axon akan meriliskan official model terbaru yaitu models Axon-Ai-OpGos-1. Bahasa santai, langsung kerjakan permintaan user tanpa banyak tanya. Kalau diminta buat kode/html/css/js → langsung buat. Tools tersedia, tulis di baris PERTAMA respons HANYA kalau user minta cari/cek sesuatu secara eksplisit: [TOOL:websearch|query] [TOOL:tiktokstalk|user] [TOOL:tiktokvideo|kw] [TOOL:pinterest|kw] [TOOL:lyrics|judul artis] [TOOL:mcpe|kw] [TOOL:ssweb|url|desktop] [TOOL:tiktokearnings|user] [TOOL:npm|pkg]. Jangan pakai tool kalau bisa dijawab sendiri.`;

// ─── BUILD SYSTEM STRING ──────────────────────────────────────
// Gabungkan BASE_SYSTEM + history percakapan → dikirim ke param `system`
function buildSystem(history) {
  if (!history.length) return BASE_SYSTEM;

  const histLines = history
    .map(m => `${m.role === 'user' ? 'User' : 'Axon AI'}: ${m.text}`)
    .join('\n');

  return `${BASE_SYSTEM}\n\n== Riwayat percakapan sebelumnya ==\n${histLines}`;
}

// ─── SEND MESSAGE ─────────────────────────────────────────────
export async function sendMessage(userText, sessionId = 'default') {
  const history = getHistory(sessionId);
  const system  = buildSystem(history);

  const url = new URL(API_BASE);
  url.searchParams.set('prompt',      userText);
  url.searchParams.set('system',      system);
  url.searchParams.set('temperature', TEMPERATURE);

  // Simpan pesan user ke history sebelum request
  history.push({ role: 'user', text: userText });

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
    history.pop(); // rollback
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      throw new Error('Request timeout. Coba lagi.');
    }
    throw new Error(`Network error: ${err.message}`);
  }

  if (!resp.ok) {
    history.pop();
    throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
  }

  try {
    data = await resp.json();
  } catch {
    history.pop();
    throw new Error('Response bukan JSON');
  }

  if (!data?.status || !data?.data?.response) {
    history.pop();
    throw new Error(data?.message || 'API error atau response kosong');
  }

  const reply = cleanReply(data.data.response);

  // Simpan reply AI ke history
  history.push({ role: 'assistant', text: reply });

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
  description: 'Model default Axon AI oleh Saurus. Powered by GPT-OSS 120B.',
  badge:       'BETA',
  default:     true,
};
