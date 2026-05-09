/**
 * axon-beta.js — Axon AI Beta
 * Fix: prompt ringkas, system prompt jadi "first assistant turn",
 *      AI langsung jawab pesan user tanpa nge-loop intro
 */

import { gotScraping } from 'got-scraping';
import { CookieJar }   from 'tough-cookie';

const API_BASE = 'https://api-faa.my.id/faa/claude-ai';

const UA_POOL = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36 Edg/123.0.0.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
];
const rUA = () => UA_POOL[Math.floor(Math.random() * UA_POOL.length)];

const jar = new CookieJar();

// ─── SESSION STORE ────────────────────────────────────────────
// Map<sessionId, { history: [{role, text}], ua: string }>
const sessions = new Map();

function getSession(id) {
  if (!sessions.has(id)) {
    sessions.set(id, { history: [], ua: rUA() });
  }
  return sessions.get(id);
}

// ─── SYSTEM PROMPT (ringkas, langsung ke poin) ────────────────
// Dikirim sebagai turn pertama: User nanya → Axon AI jawab singkat
// Ini cara paling efektif untuk "set karakter" tanpa bikin AI bingung
const SYS_USER = `Mulai sekarang kamu berperan sebagai Axon AI. Ikuti aturan ini selama percakapan:
1. Nama kamu: Axon AI, dibuat oleh tim WebPublish (owner: Saurus). Bukan Claude, bukan ChatGPT, bukan Gemini.
2. Bahasa: santai, natural, ikut bahasa user.
3. Langsung kerjakan apa yang diminta user. Jangan tanya-tanya dulu.
4. Kalau user minta buat kode/html/css/js → langsung buat, jangan nanya "mau yang seperti apa".
5. Tools tersedia (tulis di baris PERTAMA respons HANYA kalau user minta cari/download/cek sesuatu):
   [TOOL:websearch|query] → cari di internet
   [TOOL:tiktokstalk|username] → profil TikTok
   [TOOL:tiktokvideo|keyword] → video TikTok
   [TOOL:pinterest|keyword] → foto Pinterest
   [TOOL:lyrics|judul artis] → lirik lagu
   [TOOL:mcpe|keyword] → addon MCPE
   [TOOL:ssweb|url|desktop] → screenshot web
   [TOOL:tiktokearnings|username] → penghasilan TikTok
   [TOOL:npm|package] → info NPM
6. Jangan pakai tool kalau user chat biasa atau minta buat sesuatu — langsung jawab.
Mengerti? Jawab "Siap!"`;

const SYS_ASSISTANT = `Siap!`;

// ─── BUILD PROMPT ─────────────────────────────────────────────
// Struktur: [sys_user → sys_ai] → [history] → [user baru] → "Axon AI:"
// System prompt disuntik sebagai pasangan turn pertama,
// sehingga API "melihat" AI sudah dalam karakter sejak awal
function buildPrompt(history, newMessage) {
  const lines = [
    // Pasangan karakter (seed) — ringkas & efektif
    `User: ${SYS_USER}`,
    `Axon AI: ${SYS_ASSISTANT}`,
    ``,
  ];

  // History percakapan sebelumnya (max 10 pasang = 20 entry)
  for (const msg of history) {
    const label = msg.role === 'user' ? 'User' : 'Axon AI';
    lines.push(`${label}: ${msg.text}`);
  }

  // Pesan user baru
  lines.push(`User: ${newMessage}`);
  lines.push(`Axon AI:`);

  return lines.join('\n');
}

// ─── FETCH got-scraping ───────────────────────────────────────
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
  if (resp.statusCode !== 200) throw new Error(`HTTP ${resp.statusCode}`);

  let parsed;
  try   { parsed = JSON.parse(resp.body); }
  catch { throw new Error(`Bukan JSON: ${resp.body?.slice(0, 200)}`); }

  if (!parsed?.status) throw new Error(parsed?.message || 'API status false');
  return parsed.result || '';
}

// ─── FETCH FALLBACK native fetch ─────────────────────────────
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

// ─── SEND MESSAGE ─────────────────────────────────────────────
export async function sendMessage(userText, sessionId = 'default') {
  const sess = getSession(sessionId);

  // Build prompt dari history SEBELUM pesan baru ditambah
  const prompt = buildPrompt(sess.history, userText);

  // Simpan pesan user ke history
  sess.history.push({ role: 'user', text: userText });

  let rawReply = '';
  let lastErr  = null;

  // Attempt 1: got-scraping
  try {
    rawReply = await fetchFaa(prompt, sess.ua);
  } catch (err) {
    lastErr = err;
    console.warn('[axon-beta] attempt 1 failed:', err.message);
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
      rawReply = await fetchFaaFallback(prompt, sess.ua);
      lastErr  = null;
    } catch (err3) {
      lastErr = err3;
      console.error('[axon-beta] all failed:', err3.message);
    }
  }

  // Semua gagal
  if (!rawReply) {
    sess.history.pop(); // rollback
    const msg = lastErr?.message || 'Unknown';
    if (msg.includes('CF_BLOCK') || msg.includes('403') || msg.includes('429')) {
      throw new Error('Cloudflare memblokir request. Coba lagi sebentar.');
    }
    if (msg.includes('timeout') || lastErr?.code === 'ECONNABORTED') {
      throw new Error('Request timeout. API sedang lambat.');
    }
    throw new Error(`Gagal: ${msg}`);
  }

  // Bersihkan
  rawReply = cleanReply(rawReply);

  // Simpan reply AI ke history
  sess.history.push({ role: 'assistant', text: rawReply });

  // Limit: max 20 entry, buang 4 terlama
  if (sess.history.length > 20) {
    sess.history.splice(0, 4);
  }

  return rawReply;
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
    .replace(/\u001c[^\n]*/g, '')                       // strip \x1c trailing JSON
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')  // control chars
    .replace(/^Axon AI:\s*/i, '')                        // strip label kalau AI nulis sendiri
    .trim();
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── META ─────────────────────────────────────────────────────
export const meta = {
  id:          'axon-beta',
  name:        'Axon AI Beta',
  description: 'Model default Axon AI oleh WebPublish. Powered by Faa API.',
  badge:       'BETA',
  default:     true,
};
