/**
 * axon-beta.js — Axon AI Beta Model Handler
 * API   : GET https://api-faa.my.id/faa/claude-ai?text=<prompt>
 * Bypass: got-scraping (TLS fingerprint browser-like) + cookie jar + retry
 * Resp  : { status, creator, result, timestamp, response_time }
 */

import { gotScraping } from 'got-scraping';
import { CookieJar }   from 'tough-cookie';

// ── COOKIE JAR (persist cookies antar request biar CF happy) ──
const jar = new CookieJar();

// ── API CONFIG ────────────────────────────────────────────────
const API_BASE = 'https://api-faa.my.id/faa/claude-ai';

const DESKTOP_UAS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36 Edg/123.0.0.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
];
const rUA = () => DESKTOP_UAS[Math.floor(Math.random() * DESKTOP_UAS.length)];

// ── SESSION MEMORY ────────────────────────────────────────────
// Map: session_id → { history: string, ua: string }
const sessions = new Map();

// ── SYSTEM PROMPT ─────────────────────────────────────────────
const SYSTEM_PROMPT = `Kamu adalah Axon AI, asisten kecerdasan buatan yang dibuat oleh tim WebPublish (owner: Saurus). Kamu membantu pengguna menjawab pertanyaan, menganalisis, menulis, coding, dan banyak lagi.

Kamu punya akses ke tools berikut. Tulis tag tool di baris PALING AKHIR responmu jika dibutuhkan:

TOOLS:
- Cari di internet/Google → [TOOL:websearch:query]
- Cek profil TikTok → [TOOL:tiktokstalk:username]
- Cari video TikTok → [TOOL:tiktokvideo:keyword]
- Cari foto Pinterest → [TOOL:pinterest:keyword]
- Cari lirik lagu → [TOOL:lyrics:judul artis]
- Cari addon MCPE → [TOOL:mcpe:keyword]
- Screenshot website → [TOOL:ssweb:https://url.com|desktop]
- Estimasi penghasilan TikTok → [TOOL:tiktokearnings:username]
- Info package NPM → [TOOL:npm:nama-package]

ATURAN:
1. Maksimal 1 tag tool per respons, di baris paling akhir
2. Untuk info terkini selalu pakai [TOOL:websearch:...]
3. Jangan sebut diri sebagai ChatGPT, Gemini, Claude, Qwen, dll
4. Nama kamu: Axon AI. Jawab dalam Bahasa Indonesia.`;

// ── FETCH WITH GOT-SCRAPING ───────────────────────────────────
async function fetchAPI(prompt, ua) {
  const url = `${API_BASE}?text=${encodeURIComponent(prompt)}`;

  const resp = await gotScraping({
    url,
    method:          'GET',
    cookieJar:       jar,
    headerGeneratorOptions: {
      browsers: [
        { name: 'chrome', minVersion: 120, maxVersion: 124 },
      ],
      devices:    ['desktop'],
      locales:    ['id-ID', 'en-US'],
      operatingSystems: ['windows', 'macos', 'linux'],
    },
    headers: {
      'user-agent':                ua,
      'accept':                    'application/json, text/html, */*;q=0.8',
      'accept-language':           'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
      'accept-encoding':           'gzip, deflate, br',
      'referer':                   'https://api-faa.my.id/',
      'sec-fetch-dest':            'empty',
      'sec-fetch-mode':            'cors',
      'sec-fetch-site':            'same-origin',
      'cache-control':             'no-cache',
      'pragma':                    'no-cache',
      'dnt':                       '1',
    },
    timeout:      { request: 90000 },
    retry:        { limit: 0 }, // manual retry di bawah
    decompress:   true,
    followRedirect: true,
  });

  const status = resp.statusCode;

  if (status === 403 || status === 429) {
    throw Object.assign(new Error(`CF_BLOCK:${status}`), { cfBlock: true, status });
  }
  if (status !== 200) {
    throw new Error(`HTTP ${status}: ${resp.body?.slice(0, 200)}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(resp.body);
  } catch {
    throw new Error(`Response bukan JSON: ${resp.body?.slice(0, 200)}`);
  }

  if (!parsed?.status) {
    throw new Error(parsed?.message || 'API status false');
  }

  return parsed.result || '';
}

// ── FALLBACK: native fetch (Node 18+) ────────────────────────
async function fetchAPIFallback(prompt, ua) {
  const url = `${API_BASE}?text=${encodeURIComponent(prompt)}`;

  const resp = await fetch(url, {
    method:  'GET',
    headers: {
      'User-Agent':      ua,
      'Accept':          'application/json, */*',
      'Accept-Language': 'id-ID,id;q=0.9,en;q=0.7',
      'Referer':         'https://api-faa.my.id/',
      'Cache-Control':   'no-cache',
      'Pragma':          'no-cache',
    },
    signal: AbortSignal.timeout(90000),
  });

  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

  const data = await resp.json();
  if (!data?.status) throw new Error(data?.message || 'API false');
  return data.result || '';
}

// ── SEND MESSAGE (main export) ────────────────────────────────
export async function sendMessage(userText, sessionId = 'default') {
  // Ambil/buat session
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, { history: '', ua: rUA() });
  }
  const sess = sessions.get(sessionId);

  // Bangun prompt
  const prompt = buildPrompt(sess.history, userText);

  let rawReply = '';
  let lastErr  = null;

  // === Attempt 1: got-scraping ===
  try {
    rawReply = await fetchAPI(prompt, sess.ua);
  } catch (err) {
    lastErr = err;
    console.warn('[axon-beta] got-scraping failed:', err.message);

    // Jika CF block, rotate UA dan coba sekali lagi
    if (err.cfBlock) {
      sess.ua = rUA();
      try {
        await sleep(2000 + Math.random() * 2000);
        rawReply = await fetchAPI(prompt, sess.ua);
        lastErr  = null;
      } catch (err2) {
        lastErr = err2;
        console.warn('[axon-beta] got-scraping retry failed:', err2.message);
      }
    }
  }

  // === Attempt 2: native fetch fallback ===
  if (!rawReply && lastErr) {
    try {
      console.log('[axon-beta] trying native fetch fallback...');
      rawReply = await fetchAPIFallback(prompt, sess.ua);
      lastErr  = null;
    } catch (err3) {
      lastErr = err3;
      console.error('[axon-beta] all attempts failed:', err3.message);
    }
  }

  if (!rawReply) {
    const msg = lastErr?.message || 'Unknown error';
    if (msg.includes('CF_BLOCK') || msg.includes('403') || msg.includes('429')) {
      throw new Error('Cloudflare memblokir request. Coba lagi dalam beberapa detik.');
    }
    if (lastErr?.code === 'ECONNABORTED' || lastErr?.code === 'UND_ERR_CONNECT_TIMEOUT') {
      throw new Error('Request timeout. API sedang lambat, coba lagi.');
    }
    throw new Error(`Gagal menghubungi API: ${msg}`);
  }

  // Bersihkan reply
  rawReply = cleanReply(rawReply);

  // Simpan ke session history
  sess.history = trimContext(sess.history, userText, rawReply);

  return rawReply;
}

// ── PARSE TOOL TAG ────────────────────────────────────────────
export function parseToolTag(rawReply) {
  const tagRx = /\[TOOL:(\w+):([^\]|]+)(?:\|([^\]]+))?\]/i;
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

// ── HELPERS ───────────────────────────────────────────────────
function buildPrompt(history, userText) {
  if (history) {
    return `${SYSTEM_PROMPT}\n\n--- Riwayat ---\n${history}\n\n--- Sekarang ---\nUser: ${userText}\nAxon AI:`;
  }
  return `${SYSTEM_PROMPT}\n\nUser: ${userText}\nAxon AI:`;
}

function trimContext(prev, userMsg, aiReply) {
  const cleanAI  = aiReply.replace(/\[TOOL:[^\]]+\]/gi, '').trim();
  const newRound = `User: ${userMsg}\nAxon AI: ${cleanAI}`;
  const combined = prev ? `${prev}\n\n${newRound}` : newRound;
  // Maks 3000 char
  return combined.length <= 3000 ? combined : combined.slice(combined.length - 3000);
}

function cleanReply(text) {
  return text
    .replace(/\u001c[^\n]*/g, '')           // strip \x1c + trailing JSON ({"character_cooldown":true})
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // strip control chars
    .trim();
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── META ──────────────────────────────────────────────────────
export const meta = {
  id:          'axon-beta',
  name:        'Axon AI Beta',
  description: 'Model default Axon AI oleh WebPublish. Powered by Faa API.',
  badge:       'BETA',
  default:     true,
};
