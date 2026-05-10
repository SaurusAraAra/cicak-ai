/**
 * axon-beta.js — Axon AI Beta
 * API   : GET https://exsalapi.my.id/api/ai/text/gpt-5-mini
 * Params: text, apikey
 * Resp  : { author, status, data: { model, content } }
 *
 * Session: dikelola manual — simpan SEMUA history pesan
 * (tidak ada limit, kecuali kalau mau diatur manual)
 */

const API_BASE = 'https://exsalapi.my.id/api/ai/text/gpt-5-mini';
const API_KEY  = 'freepublic';

// ─── SESSION STORE ────────────────────────────────────────────
// Map<sessionId, Array<{ role: 'user'|'assistant', text: string }>>
// Simpan SEMUA pesan tanpa limit
const sessions = new Map();

function getHistory(sessionId) {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, []);
  }
  return sessions.get(sessionId);
}

// ─── SYSTEM PROMPT ────────────────────────────────────────────
const SYSTEM = `Kamu adalah Axon AI, asisten AI cerdas dari tim WebPublish. Owner: Saurus. Bukan Claude, bukan ChatGPT, bukan Gemini — kamu Axon AI. Bahasa santai, langsung kerjakan permintaan user tanpa banyak tanya. Kalau diminta buat kode/html/css/js → langsung buat. Untuk info real-time, tulis tag di baris PERTAMA respons: [TOOL:websearch|query] [TOOL:tiktokstalk|user] [TOOL:tiktokvideo|kw] [TOOL:pinterest|kw] [TOOL:lyrics|judul artis] [TOOL:mcpe|kw] [TOOL:ssweb|url|desktop] [TOOL:tiktokearnings|user] [TOOL:npm|pkg]. Jangan pakai tool kalau bisa dijawab sendiri.`;

// ─── BUILD PROMPT ─────────────────────────────────────────────
// Format: [SYSTEM] + seluruh history + pesan baru
function buildPrompt(history, newMessage) {
  const lines = [`[SYSTEM: ${SYSTEM}]`, ''];

  for (const msg of history) {
    lines.push(`${msg.role === 'user' ? 'User' : 'Axon AI'}: ${msg.text}`);
  }

  lines.push(`User: ${newMessage}`);
  lines.push(`Axon AI:`);

  return lines.join('\n');
}

// ─── SEND MESSAGE ─────────────────────────────────────────────
export async function sendMessage(userText, sessionId = 'default') {
  const history = getHistory(sessionId);
  const prompt  = buildPrompt(history, userText);

  // Simpan pesan user
  history.push({ role: 'user', text: userText });

  const url = new URL(API_BASE);
  url.searchParams.set('text',   prompt);
  url.searchParams.set('apikey', API_KEY);

  let resp, data;

  try {
    resp = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept':          'application/json, */*',
        'Accept-Language': 'id-ID,id;q=0.9,en;q=0.7',
        'Referer':         'https://exsalapi.my.id/',
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

  if (!data?.status || !data?.data?.content) {
    history.pop();
    throw new Error(data?.message || 'API error');
  }

  // Ganti author jadi Saurus
  data.author = 'Saurus';

  const reply = cleanReply(data.data.content);

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
  description: 'Model default Axon AI oleh Saurus. Powered by GPT-5 Mini.',
  badge:       'BETA',
  default:     true,
};
