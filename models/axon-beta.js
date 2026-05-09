/**
 * axon-beta.js — Axon AI Beta
 * Bypass CF: axios + custom https.Agent (Chrome TLS cipher order)
 * Deps: hanya axios (sudah ada di package.json)
 */

import axios       from 'axios';
import https       from 'https';
import { Buffer }  from 'buffer';

const API_BASE = 'https://api-faa.my.id/faa/claude-ai';

// ─── TLS AGENT mirip Chrome 124 ──────────────────────────────
// CF pakai JA3 fingerprint — cipher order Chrome bikin kita lolos
const CF_AGENT = new https.Agent({
  keepAlive: true,
  rejectUnauthorized: true,
  // Cipher suite order persis Chrome 124
  ciphers: [
    'TLS_AES_128_GCM_SHA256',
    'TLS_AES_256_GCM_SHA384',
    'TLS_CHACHA20_POLY1305_SHA256',
    'ECDHE-ECDSA-AES128-GCM-SHA256',
    'ECDHE-RSA-AES128-GCM-SHA256',
    'ECDHE-ECDSA-AES256-GCM-SHA384',
    'ECDHE-RSA-AES256-GCM-SHA384',
    'ECDHE-ECDSA-CHACHA20-POLY1305',
    'ECDHE-RSA-CHACHA20-POLY1305',
    'ECDHE-RSA-AES128-SHA',
    'ECDHE-RSA-AES256-SHA',
    'AES128-GCM-SHA256',
    'AES256-GCM-SHA384',
    'AES128-SHA',
    'AES256-SHA',
  ].join(':'),
  honorCipherOrder: true,
  minVersion: 'TLSv1.2',
  maxVersion: 'TLSv1.3',
  ecdhCurve: 'X25519:prime256v1:secp384r1',
});

// ─── UA POOL ─────────────────────────────────────────────────
const UA_POOL = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36 Edg/123.0.0.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
];
const rUA = () => UA_POOL[Math.floor(Math.random() * UA_POOL.length)];

// ─── SESSION STORE ────────────────────────────────────────────
const sessions = new Map();

function getSession(id) {
  if (!sessions.has(id)) {
    sessions.set(id, { history: [], ua: rUA(), cookies: '' });
  }
  return sessions.get(id);
}

// ─── SYSTEM PROMPT (seed sebagai turn dialog) ─────────────────
const SYS_USER = `Mulai sekarang kamu berperan sebagai Axon AI. Ikuti aturan ini:
1. Nama kamu: Axon AI, dibuat oleh tim WebPublish (owner: Saurus). Bukan Claude, bukan ChatGPT.
2. Bahasa: santai, ikut bahasa user. Langsung kerjakan permintaan tanpa banyak tanya.
3. Kalau diminta buat kode/html/css/js → langsung buat kodenya.
4. Tools (tulis di baris PERTAMA respons HANYA kalau user minta cari/cek/download):
   [TOOL:websearch|query] [TOOL:tiktokstalk|user] [TOOL:tiktokvideo|kw]
   [TOOL:pinterest|kw] [TOOL:lyrics|judul artis] [TOOL:mcpe|kw]
   [TOOL:ssweb|url|desktop] [TOOL:tiktokearnings|user] [TOOL:npm|pkg]
5. Chat biasa atau minta buat sesuatu → JANGAN pakai tool, langsung jawab.`;

const SYS_AI = `Siap, aku Axon AI dari WebPublish. Mau bantu apa?`;

// ─── BUILD PROMPT ─────────────────────────────────────────────
function buildPrompt(history, newMsg) {
  const lines = [
    `User: ${SYS_USER}`,
    `Axon AI: ${SYS_AI}`,
    '',
  ];

  for (const m of history) {
    lines.push(`${m.role === 'user' ? 'User' : 'Axon AI'}: ${m.text}`);
  }

  lines.push(`User: ${newMsg}`);
  lines.push(`Axon AI:`);
  return lines.join('\n');
}

// ─── AXIOS INSTANCE ───────────────────────────────────────────
const client = axios.create({
  httpsAgent:     CF_AGENT,
  timeout:        90000,
  maxRedirects:   5,
  validateStatus: () => true, // handle status sendiri
  decompress:     true,
});

// ─── FETCH dengan cookie persistence ─────────────────────────
async function fetchFaa(prompt, sess) {
  const url = `${API_BASE}?text=${encodeURIComponent(prompt)}`;

  const headers = {
    'User-Agent':                sess.ua,
    'Accept':                    'application/json, text/html, */*;q=0.8',
    'Accept-Language':           'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
    'Accept-Encoding':           'gzip, deflate, br',
    'Referer':                   'https://api-faa.my.id/',
    'Origin':                    'https://api-faa.my.id',
    'Sec-Fetch-Dest':            'empty',
    'Sec-Fetch-Mode':            'cors',
    'Sec-Fetch-Site':            'same-origin',
    'Sec-CH-UA':                 '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
    'Sec-CH-UA-Mobile':          '?0',
    'Sec-CH-UA-Platform':        '"Windows"',
    'Cache-Control':             'no-cache',
    'Pragma':                    'no-cache',
    'Connection':                'keep-alive',
    ...(sess.cookies ? { 'Cookie': sess.cookies } : {}),
  };

  const resp = await client.get(url, { headers });

  // Simpan cookies dari response untuk request berikutnya
  const setCookie = resp.headers['set-cookie'];
  if (setCookie) {
    const cookieStr = (Array.isArray(setCookie) ? setCookie : [setCookie])
      .map(c => c.split(';')[0])
      .join('; ');
    // Merge dengan cookie lama
    const existing = sess.cookies ? sess.cookies.split('; ') : [];
    const newCookies = cookieStr.split('; ');
    const cookieMap = {};
    [...existing, ...newCookies].forEach(c => {
      const [k, v] = c.split('=');
      if (k) cookieMap[k.trim()] = v || '';
    });
    sess.cookies = Object.entries(cookieMap).map(([k,v]) => `${k}=${v}`).join('; ');
  }

  const status = resp.status;

  if (status === 403 || status === 429) {
    const err = new Error(`CF_BLOCK:${status}`);
    err.cfBlock = true;
    err.status  = status;
    throw err;
  }
  if (status !== 200) throw new Error(`HTTP ${status}`);

  const raw = typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data);

  let parsed;
  try {
    parsed = typeof resp.data === 'object' ? resp.data : JSON.parse(raw);
  } catch {
    throw new Error(`Bukan JSON: ${raw.slice(0, 200)}`);
  }

  if (!parsed?.status) throw new Error(parsed?.message || 'API status false');
  return parsed.result || '';
}

// ─── SEND MESSAGE ─────────────────────────────────────────────
export async function sendMessage(userText, sessionId = 'default') {
  const sess   = getSession(sessionId);
  const prompt = buildPrompt(sess.history, userText);

  sess.history.push({ role: 'user', text: userText });

  let rawReply = '';
  let lastErr  = null;

  // Attempt 1
  try {
    rawReply = await fetchFaa(prompt, sess);
  } catch (err) {
    lastErr = err;
    console.warn('[axon-beta] attempt 1 failed:', err.message);

    if (err.cfBlock) {
      // Rotate UA + tunggu sebentar
      sess.ua = rUA();
      await sleep(2000 + Math.random() * 2000);
      try {
        rawReply = await fetchFaa(prompt, sess);
        lastErr  = null;
      } catch (err2) {
        lastErr = err2;
        console.warn('[axon-beta] attempt 2 failed:', err2.message);
      }
    }
  }

  // Attempt 3: native fetch (beda TLS stack dari axios)
  if (!rawReply && lastErr) {
    try {
      console.log('[axon-beta] trying native fetch...');
      rawReply = await fetchFaaFallback(prompt, sess.ua);
      lastErr  = null;
    } catch (err3) {
      lastErr = err3;
      console.error('[axon-beta] all failed:', err3.message);
    }
  }

  if (!rawReply) {
    sess.history.pop();
    const msg = lastErr?.message || 'Unknown';
    if (msg.includes('CF_BLOCK') || msg.includes('403') || msg.includes('429'))
      throw new Error('Cloudflare memblokir request. Coba lagi sebentar.');
    if (msg.includes('timeout') || msg.includes('ECONNABORTED'))
      throw new Error('Request timeout. API lambat, coba lagi.');
    throw new Error(`Gagal: ${msg}`);
  }

  rawReply = cleanReply(rawReply);
  sess.history.push({ role: 'assistant', text: rawReply });

  if (sess.history.length > 20) sess.history.splice(0, 4);

  return rawReply;
}

// ─── FALLBACK native fetch ────────────────────────────────────
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

// ─── HELPERS ─────────────────────────────────────────────────
function cleanReply(text) {
  return text
    .replace(/\u001c[^\n]*/g, '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/^Axon AI:\s*/i, '')
    .trim();
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

export const meta = {
  id:          'axon-beta',
  name:        'Axon AI Beta',
  description: 'Model default Axon AI oleh WebPublish. Powered by Faa API.',
  badge:       'BETA',
  default:     true,
};
