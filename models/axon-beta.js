/**
 * axon-beta.js — Axon AI Beta
 * API   : GET https://fgsi.dpdns.org/api/ai/xai-grok
 * Params: apikey, text, url (opsional), conversationId (session built-in)
 * Resp  : { data: { result: { answer, conversation_id } } }
 *
 * Session dihandle langsung oleh API via conversationId — tidak perlu
 * kelola history manual. Cukup kirim conversationId yang sama tiap request.
 */

// ─── CONFIG ───────────────────────────────────────────────────
const API_BASE  = 'https://fgsi.dpdns.org/api/ai/xai-grok';
const API_KEY   = 'fgsiapi-eb50c7c-6d';

// ─── SYSTEM PROMPT ────────────────────────────────────────────
// Dikirim sebagai prefix pesan user pertama di setiap sesi baru
// Setelah itu API sudah "ingat" karakter lewat conversationId
const PERSONA_PREFIX = `[Kamu adalah Axon AI, asisten AI dari tim WebPublish (owner: Saurus). Bukan Claude, bukan ChatGPT, bukan Gemini. Bahasa santai, langsung kerjakan apa yang diminta tanpa banyak tanya. Kalau user minta kode/html/css → langsung buat. Tools tersedia, tulis di baris PERTAMA respons HANYA kalau user minta cari/cek sesuatu: [TOOL:websearch|query] [TOOL:tiktokstalk|user] [TOOL:tiktokvideo|kw] [TOOL:pinterest|kw] [TOOL:lyrics|judul artis] [TOOL:mcpe|kw] [TOOL:ssweb|url|desktop] [TOOL:tiktokearnings|user] [TOOL:npm|pkg]. Jika tidak perlu tool, jawab langsung.]\n\n`;

// Track sesi mana yang sudah dapat persona inject (in-memory)
// Setelah restart server, sesi lama di API masih ada tapi persona inject ulang
const injectedSessions = new Set();

// ─── SEND MESSAGE ─────────────────────────────────────────────
export async function sendMessage(userText, sessionId = 'default') {
  // Inject persona hanya di pesan pertama sesi ini (server lifetime)
  let textToSend = userText;
  if (!injectedSessions.has(sessionId)) {
    textToSend = PERSONA_PREFIX + userText;
    injectedSessions.add(sessionId);
  }

  const url = new URL(API_BASE);
  url.searchParams.set('apikey',         API_KEY);
  url.searchParams.set('text',           textToSend);
  url.searchParams.set('url',            '');           // opsional, kosongkan
  url.searchParams.set('conversationId', sessionId);   // API handle session sendiri

  let resp, data;

  try {
    resp = await fetch(url.toString(), {
      method:  'GET',
      headers: {
        'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept':          'application/json, */*',
        'Accept-Language': 'id-ID,id;q=0.9,en;q=0.7',
        'Referer':         'https://fgsi.dpdns.org/',
        'Cache-Control':   'no-cache',
      },
      signal: AbortSignal.timeout(60000),
    });
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      throw new Error('Request timeout. Coba lagi.');
    }
    throw new Error(`Network error: ${err.message}`);
  }

  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
  }

  try {
    data = await resp.json();
  } catch {
    throw new Error('Response bukan JSON');
  }

  // Validasi struktur response
  if (!data?.status || !data?.data?.success) {
    const msg = data?.message || data?.data?.message || 'API error';
    throw new Error(`API gagal: ${msg}`);
  }

  const answer = data?.data?.result?.answer;
  if (!answer) throw new Error('Respons kosong dari API');

  return cleanReply(answer);
}

// ─── PARSE TOOL TAG ───────────────────────────────────────────
// Format: [TOOL:name|param] atau [TOOL:name|param|extra]
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
    .replace(/\u001c[^\n]*/g, '')                       // strip control char
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')  // strip misc control
    .replace(/^\[.*?\]\s*/s, '')                         // strip kalau persona prefix ikut ke reply
    .trim();
}

// ─── META ─────────────────────────────────────────────────────
export const meta = {
  id:          'axon-beta',
  name:        'Axon AI Beta',
  description: 'Model default Axon AI oleh WebPublish. Powered by Fgsi API (xAI Grok).',
  badge:       'BETA',
  default:     true,
};
