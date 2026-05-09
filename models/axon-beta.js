/**
 * axon-beta.js — Axon AI Beta Model Handler
 * API   : GET https://api-faa.my.id/faa/claude-ai?text=<prompt>
 * Fix   : session pakai array [{role, text}], system prompt lebih tegas,
 *         tool hanya muncul kalau user eksplisit minta
 */

import { gotScraping } from 'got-scraping';
import { CookieJar }   from 'tough-cookie';

// ─────────────────────────────────────────────────────────────
//  CONSTANTS
// ─────────────────────────────────────────────────────────────
const API_BASE = 'https://api-faa.my.id/faa/claude-ai';

const UA_POOL = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36 Edg/123.0.0.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
];
const rUA = () => UA_POOL[Math.floor(Math.random() * UA_POOL.length)];

const jar = new CookieJar();

// ─────────────────────────────────────────────────────────────
//  SESSION STORE
//  Struktur: Map<sessionId, { history: Array<{role, text}>, ua: string }>
//  - role: "user" | "assistant"
//  - text: string isi pesan
//  - limit: 20 pesan, kalau lebih hapus 4 yang terlama (persis seperti contoh)
// ─────────────────────────────────────────────────────────────
const sessions = new Map();

function getSession(sessionId) {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, { history: [], ua: rUA() });
  }
  return sessions.get(sessionId);
}

// ─────────────────────────────────────────────────────────────
//  SYSTEM PROMPT
//  Dikirim sebagai bagian pertama dari prompt, sebelum history
// ─────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `Kamu adalah Axon AI, asisten AI cerdas dan serbabisa yang diproduksi oleh tim WebPublish. Owner: Saurus.

== IDENTITAS ==
- Nama kamu: Axon AI. BUKAN Claude, BUKAN ChatGPT, BUKAN Gemini, BUKAN AI buatan Anthropic/OpenAI/Google.
- Kalau ditanya siapa kamu atau dibuat oleh siapa: jawab "Axon AI, dibuat oleh tim WebPublish".
- Gaya bahasa: santai, helpful, natural. Pakai bahasa yang sama dengan user (Indonesia/Inggris).
- Boleh pakai singkatan/slang Indonesia yang wajar.

== TOOLS YANG TERSEDIA ==
Kamu punya tools untuk mengambil data real-time. HANYA gunakan tools ini kalau user SECARA EKSPLISIT meminta sesuatu yang butuh data luar (cari di internet, cek profil, cari video, dst).
Kalau bisa dijawab dari pengetahuanmu sendiri, JAWAB LANGSUNG tanpa tool.

Tulis tag tool di baris PALING PERTAMA responmu (sebelum teks apapun):

[TOOL:websearch|query]         → cari info/berita terbaru di internet
[TOOL:tiktokstalk|username]    → cek profil TikTok seseorang
[TOOL:tiktokvideo|kata kunci]  → cari video TikTok
[TOOL:pinterest|kata kunci]    → cari foto/inspirasi di Pinterest
[TOOL:lyrics|judul artis]      → cari lirik lagu
[TOOL:mcpe|nama addon]         → cari addon Minecraft PE
[TOOL:ssweb|url|desktop]       → screenshot website (mode: desktop/mobile)
[TOOL:tiktokearnings|username] → estimasi penghasilan TikTok
[TOOL:npm|nama-package]        → info package NPM

== ATURAN TOOL ==
- Tulis SATU tag tool di baris pertama respons, sisanya teks biasa
- Jangan pakai tool kalau user hanya chat biasa, tanya coding, minta tulis sesuatu, dll
- Kalau user minta "cari" / "cariin" / "cek" / "screenshot" → pakai tool yang sesuai
- Untuk ssweb: tanya dulu mode-nya kalau user tidak menyebut

== FORMAT KODE ==
- Selalu bungkus kode dengan triple backtick + nama bahasa
- HTML/CSS/JS tulis dalam satu blok

Contoh penggunaan tool yang BENAR:
User: cariin video tiktok kucing lucu
Axon AI:
[TOOL:tiktokvideo|kucing lucu]
Nih videonya! 🐱

Contoh jawaban TANPA tool yang benar:
User: cara bikin button di CSS
Axon AI:
Gampang! Ini contohnya:
\`\`\`css
button { background: blue; color: white; }
\`\`\``;

// ─────────────────────────────────────────────────────────────
//  BUILD PROMPT
//  Format: [SYSTEM] → [HISTORY] → [PESAN BARU] → "Axon AI:"
// ─────────────────────────────────────────────────────────────
function buildPrompt(history, newMessage) {
  const lines = [];

  // System prompt sebagai blok pertama
  lines.push(SYSTEM_PROMPT);
  lines.push(''); // blank line separator

  // History percakapan sebelumnya
  for (const msg of history) {
    const label = msg.role === 'user' ? 'User' : 'Axon AI';
    lines.push(`${label}: ${msg.text}`);
  }

  // Pesan user baru
  lines.push(`User: ${newMessage}`);

  // Trigger AI untuk melanjutkan sebagai Axon AI
  lines.push(`Axon AI:`);

  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────
//  FETCH — got-scraping (bypass Cloudflare)
// ─────────────────────────────────────────────────────────────
async function fetchFaa(prompt, ua) {
  const url = `${API_BASE}?text=${encodeURIComponent(prompt)}`;

  const resp = await gotScraping({
    url,
    method:    'GET',
    cookieJar: jar,
    headerGeneratorOptions: {
      browsers:         [{ name: 'chrome', minVersion: 120, maxVersion: 124 }],
      devices:          ['desktop'],
      locales:          ['id-ID', 'en-US'],
      operatingSystems: ['windows', 'macos'],
    },
    headers: {
      'user-agent':      ua,
      'accept':          'application/json, */*;q=0.8',
      'accept-language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
      'referer':         'https://api-faa.my.id/',
      'sec-fetch-dest':  'empty',
      'sec-fetch-mode':  'cors',
      'sec-fetch-site':  'same-origin',
      'cache-control':   'no-cache',
      'pragma':          'no-cache',
    },
    timeout:        { request: 90000 },
    retry:          { limit: 0 },
    decompress:     true,
    followRedirect: true,
  });

  if (resp.statusCode === 403 || resp.statusCode === 429) {
    const err = new Error(`CF_BLOCK:${resp.statusCode}`);
    err.cfBlock = true;
    throw err;
  }
  if (resp.statusCode !== 200) {
    throw new Error(`HTTP ${resp.statusCode}`);
  }

  let parsed;
  try   { parsed = JSON.parse(resp.body); }
  catch { throw new Error(`Bukan JSON: ${resp.body?.slice(0, 200)}`); }

  if (!parsed?.status) throw new Error(parsed?.message || 'API status false');

  return parsed.result || '';
}

// ─────────────────────────────────────────────────────────────
//  FETCH FALLBACK — native fetch Node 18+
// ─────────────────────────────────────────────────────────────
async function fetchFaaFallback(prompt, ua) {
  const url  = `${API_BASE}?text=${encodeURIComponent(prompt)}`;
  const resp = await fetch(url, {
    method:  'GET',
    headers: {
      'User-Agent':      ua,
      'Accept':          'application/json, */*',
      'Accept-Language': 'id-ID,id;q=0.9,en;q=0.7',
      'Referer':         'https://api-faa.my.id/',
      'Cache-Control':   'no-cache',
    },
    signal: AbortSignal.timeout(90000),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json();
  if (!data?.status) throw new Error(data?.message || 'API false');
  return data.result || '';
}

// ─────────────────────────────────────────────────────────────
//  SEND MESSAGE — main export
// ─────────────────────────────────────────────────────────────
export async function sendMessage(userText, sessionId = 'default') {
  const sess = getSession(sessionId);

  // Build prompt SEBELUM push pesan baru (history sampai sebelum ini)
  const prompt = buildPrompt(sess.history, userText);

  // Push pesan user ke history
  sess.history.push({ role: 'user', text: userText });

  let rawReply = '';
  let lastErr  = null;

  // Attempt 1: got-scraping
  try {
    rawReply = await fetchFaa(prompt, sess.ua);
  } catch (err) {
    lastErr = err;
    console.warn('[axon-beta] attempt 1 failed:', err.message);

    // CF block → rotate UA + retry
    if (err.cfBlock) {
      sess.ua = rUA();
      await sleep(1500 + Math.random() * 1500);
      try {
        rawReply = await fetchFaa(prompt, sess.ua);
        lastErr  = null;
      } catch (err2) {
        lastErr = err2;
        console.warn('[axon-beta] attempt 2 failed:', err2.message);
      }
    }
  }

  // Attempt 3: native fetch fallback
  if (!rawReply && lastErr) {
    try {
      console.log('[axon-beta] fallback native fetch...');
      rawReply = await fetchFaaFallback(prompt, sess.ua);
      lastErr  = null;
    } catch (err3) {
      lastErr = err3;
      console.error('[axon-beta] all attempts failed:', err3.message);
    }
  }

  // Semua gagal
  if (!rawReply) {
    // Rollback — hapus pesan user yang tadi di-push
    sess.history.pop();
    const msg = lastErr?.message || 'Unknown';
    if (msg.includes('CF_BLOCK') || msg.includes('403') || msg.includes('429')) {
      throw new Error('Cloudflare memblokir request. Coba lagi sebentar.');
    }
    if (msg.includes('timeout') || lastErr?.code === 'ECONNABORTED') {
      throw new Error('Request timeout. API sedang lambat.');
    }
    throw new Error(`Gagal menghubungi API: ${msg}`);
  }

  // Bersihkan reply
  rawReply = cleanReply(rawReply);

  // Push reply AI ke history
  sess.history.push({ role: 'assistant', text: rawReply });

  // Limit: max 20 pesan, kalau lebih hapus 4 terlama (sama kayak contoh)
  if (sess.history.length > 20) {
    sess.history.splice(0, 4);
  }

  return rawReply;
}

// ─────────────────────────────────────────────────────────────
//  PARSE TOOL TAG
//  Support format: [TOOL:name|param] dan [TOOL:name|param|extra]
//  (format baru pakai | bukan : untuk param — sesuai system prompt)
// ─────────────────────────────────────────────────────────────
export function parseToolTag(rawReply) {
  // Match [TOOL:toolname|param] atau [TOOL:toolname|param|extra]
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

// ─────────────────────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────────────────────
function cleanReply(text) {
  return text
    .replace(/\u001c[^\n]*/g, '')                       // strip \x1c + trailing JSON
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')  // strip control chars
    .replace(/^Axon AI:\s*/i, '')                        // strip kalau AI print labelnya sendiri
    .trim();
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─────────────────────────────────────────────────────────────
//  META
// ─────────────────────────────────────────────────────────────
export const meta = {
  id:          'axon-beta',
  name:        'Axon AI Beta',
  description: 'Model default Axon AI oleh WebPublish. Powered by Faa API.',
  badge:       'BETA',
  default:     true,
};
