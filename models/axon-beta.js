/**
 * axon-beta.js — Axon AI Beta
 * Bypass chain:
 *   1. Playwright Chromium (real browser, bypass CF sepenuhnya)
 *   2. got-scraping (TLS fingerprint spoof)
 *   3. undici (custom TLS options)
 *   4. native fetch fallback
 */

import { CookieJar } from 'tough-cookie';

const API_BASE = 'https://api-faa.my.id/faa/claude-ai';

const UA_POOL = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36 Edg/123.0.0.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
];
const rUA = () => UA_POOL[Math.floor(Math.random() * UA_POOL.length)];
const jar = new CookieJar();

// ─── CF cookies dari Playwright disimpan di sini ──────────────
let cfCookieCache = null;   // { cookies: string, ua: string, ts: number }
const CF_COOKIE_TTL = 25 * 60 * 1000; // 25 menit

// ─── SESSION STORE ────────────────────────────────────────────
const sessions = new Map();
function getSession(id) {
  if (!sessions.has(id)) sessions.set(id, { history: [], ua: rUA() });
  return sessions.get(id);
}

// ─── SYSTEM PROMPT ────────────────────────────────────────────
const SYS_USER = `Mulai sekarang kamu berperan sebagai Axon AI. Ikuti aturan ini selama percakapan:
1. Nama kamu: Axon AI, dibuat oleh tim WebPublish (owner: Saurus). Bukan Claude, bukan ChatGPT, bukan Gemini.
2. Bahasa: santai, natural, ikut bahasa user.
3. Langsung kerjakan apa yang diminta user. Jangan tanya-tanya dulu kalau sudah jelas.
4. Kalau user minta buat kode/html/css/js → langsung buat, jangan nanya "mau yang seperti apa".
5. Tools tersedia (tulis di baris PERTAMA respons HANYA kalau user minta cari/cek data real-time):
   [TOOL:websearch|query] → cari di internet
   [TOOL:tiktokstalk|username] → profil TikTok
   [TOOL:tiktokvideo|keyword] → video TikTok
   [TOOL:pinterest|keyword] → foto Pinterest
   [TOOL:lyrics|judul artis] → lirik lagu
   [TOOL:mcpe|keyword] → addon MCPE
   [TOOL:ssweb|url|desktop] → screenshot web
   [TOOL:tiktokearnings|username] → penghasilan TikTok
   [TOOL:npm|package] → info NPM
6. Jangan pakai tool kalau user chat biasa atau minta buat sesuatu. Langsung jawab.
Mengerti?`;

const SYS_ASSISTANT = `Siap! Aku Axon AI, asisten dari WebPublish. Mau bantu apa?`;

function buildPrompt(history, newMessage) {
  const lines = [
    `User: ${SYS_USER}`,
    `Axon AI: ${SYS_ASSISTANT}`,
    ``,
  ];
  for (const msg of history) {
    lines.push(`${msg.role === 'user' ? 'User' : 'Axon AI'}: ${msg.text}`);
  }
  lines.push(`User: ${newMessage}`);
  lines.push(`Axon AI:`);
  return lines.join('\n');
}

// ═══════════════════════════════════════════════════════════════
//  METHOD 1: PLAYWRIGHT (real Chromium browser)
//  - Bypass CF sepenuhnya karena pakai browser asli
//  - Cache cf_clearance cookie biar tidak perlu buka browser tiap request
// ═══════════════════════════════════════════════════════════════
async function fetchViaPlaywright(prompt) {
  let playwright, browser, context, page;
  try {
    playwright = await import('playwright');
  } catch {
    throw new Error('Playwright not available');
  }

  const url = `${API_BASE}?text=${encodeURIComponent(prompt)}`;

  try {
    browser = await playwright.chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-zygote',
        '--single-process',          // penting di Railway (container)
        '--disable-extensions',
        '--disable-background-networking',
        '--disable-default-apps',
        '--disable-sync',
        '--disable-translate',
        '--hide-scrollbars',
        '--metrics-recording-only',
        '--mute-audio',
        '--safebrowsing-disable-auto-update',
      ],
    });

    const ua = rUA();
    context = await browser.newContext({
      userAgent: ua,
      locale: 'id-ID',
      extraHTTPHeaders: {
        'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept': 'application/json, */*',
      },
    });

    page = await context.newPage();

    // Kalau ada CF cookie cache yang masih valid, inject dulu
    if (cfCookieCache && Date.now() - cfCookieCache.ts < CF_COOKIE_TTL) {
      await context.addCookies(cfCookieCache.cookies);
    }

    // Navigate ke API URL
    const response = await page.goto(url, {
      waitUntil: 'networkidle',
      timeout: 30000,
    });

    // Kalau masih CF challenge page, tunggu
    let bodyText = await page.evaluate(() => document.body.innerText).catch(() => '');

    // Cek apakah ada CF challenge
    if (response?.status() === 403 || bodyText.includes('Just a moment') || bodyText.includes('challenge')) {
      // Tunggu CF selesai (max 15 detik)
      await page.waitForFunction(
        () => !document.title.includes('Just a moment') && document.body.innerText.length > 20,
        { timeout: 15000 }
      ).catch(() => {});
      bodyText = await page.evaluate(() => document.body.innerText).catch(() => '');
    }

    // Simpan CF cookies untuk request berikutnya
    const cookies = await context.cookies();
    cfCookieCache = { cookies, ts: Date.now() };

    // Parse JSON dari body
    let parsed;
    try {
      // Coba ambil dari response body langsung
      const rawBody = bodyText.trim();
      // Kadang playwright dapet pre-formatted, ambil dari pre tag
      const preText = await page.evaluate(() => {
        const pre = document.querySelector('pre, body');
        return pre?.innerText || document.body.innerText;
      }).catch(() => rawBody);

      parsed = JSON.parse(preText.trim());
    } catch {
      throw new Error(`Playwright: response bukan JSON — ${bodyText.slice(0, 200)}`);
    }

    if (!parsed?.status) throw new Error(parsed?.message || 'API status false');
    return parsed.result || '';

  } finally {
    await page?.close().catch(() => {});
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
  }
}

// ═══════════════════════════════════════════════════════════════
//  METHOD 2: GOT-SCRAPING (TLS fingerprint spoof)
// ═══════════════════════════════════════════════════════════════
async function fetchViaGotScraping(prompt, ua) {
  let gotScraping;
  try {
    ({ gotScraping } = await import('got-scraping'));
  } catch {
    throw new Error('got-scraping not available');
  }

  const url = `${API_BASE}?text=${encodeURIComponent(prompt)}`;

  const resp = await gotScraping({
    url,
    method: 'GET',
    cookieJar: jar,
    headerGeneratorOptions: {
      browsers: [{ name: 'chrome', minVersion: 120, maxVersion: 124 }],
      devices: ['desktop'],
      locales: ['id-ID', 'en-US'],
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
    timeout: { request: 60000 },
    retry: { limit: 0 },
    decompress: true,
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

// ═══════════════════════════════════════════════════════════════
//  METHOD 3: UNDICI (custom TLS cipher)
// ═══════════════════════════════════════════════════════════════
async function fetchViaUndici(prompt, ua) {
  let undici;
  try {
    undici = await import('undici');
  } catch {
    throw new Error('undici not available');
  }

  const url  = `${API_BASE}?text=${encodeURIComponent(prompt)}`;
  const resp = await undici.fetch(url, {
    method: 'GET',
    headers: {
      'User-Agent':                ua,
      'Accept':                    'application/json, */*;q=0.8',
      'Accept-Language':           'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
      'Accept-Encoding':           'gzip, deflate, br',
      'Referer':                   'https://api-faa.my.id/',
      'Sec-CH-UA':                 '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
      'Sec-CH-UA-Mobile':          '?0',
      'Sec-CH-UA-Platform':        '"Windows"',
      'Sec-Fetch-Dest':            'empty',
      'Sec-Fetch-Mode':            'cors',
      'Sec-Fetch-Site':            'same-origin',
      'Cache-Control':             'no-cache',
      'Pragma':                    'no-cache',
      'DNT':                       '1',
    },
    signal: AbortSignal.timeout(60000),
  });

  if (resp.status === 403 || resp.status === 429) {
    const err = new Error(`CF_BLOCK:${resp.status}`);
    err.cfBlock = true;
    throw err;
  }
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

  const data = await resp.json();
  if (!data?.status) throw new Error(data?.message || 'API false');
  return data.result || '';
}

// ═══════════════════════════════════════════════════════════════
//  METHOD 4: NATIVE FETCH fallback
// ═══════════════════════════════════════════════════════════════
async function fetchViaNative(prompt, ua) {
  const url  = `${API_BASE}?text=${encodeURIComponent(prompt)}`;
  const resp = await fetch(url, {
    method: 'GET',
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

// ═══════════════════════════════════════════════════════════════
//  SEND MESSAGE — coba semua method berurutan
// ═══════════════════════════════════════════════════════════════
export async function sendMessage(userText, sessionId = 'default') {
  const sess   = getSession(sessionId);
  const prompt = buildPrompt(sess.history, userText);

  sess.history.push({ role: 'user', text: userText });

  const ua      = sess.ua;
  const methods = [
    { name: 'playwright',   fn: () => fetchViaPlaywright(prompt)        },
    { name: 'got-scraping', fn: () => fetchViaGotScraping(prompt, ua)   },
    { name: 'undici',       fn: () => fetchViaUndici(prompt, ua)        },
    { name: 'native-fetch', fn: () => fetchViaNative(prompt, ua)        },
  ];

  let rawReply = '';
  let lastErr  = null;

  for (const method of methods) {
    try {
      console.log(`[axon-beta] trying ${method.name}...`);
      rawReply = await method.fn();
      if (rawReply) {
        console.log(`[axon-beta] success via ${method.name}`);
        break;
      }
    } catch (err) {
      lastErr = err;
      console.warn(`[axon-beta] ${method.name} failed: ${err.message}`);

      // Jangan lanjut ke method berikutnya kalau bukan CF-related error
      // (misal: Playwright binary tidak ada → langsung ke got-scraping)
      if (err.message.includes('not available') || err.message.includes('Executable')) {
        continue; // skip, coba method berikutnya
      }

      // Kalau CF block, rotate UA sebelum coba method berikutnya
      if (err.cfBlock) {
        sess.ua = rUA();
        await sleep(800);
      }
    }
  }

  if (!rawReply) {
    sess.history.pop(); // rollback
    const msg = lastErr?.message || 'Semua method gagal';
    if (msg.includes('CF_BLOCK') || msg.includes('403') || msg.includes('429')) {
      throw new Error('Cloudflare memblokir semua request. Coba lagi dalam beberapa detik.');
    }
    if (msg.includes('timeout') || lastErr?.code === 'ECONNABORTED') {
      throw new Error('Request timeout. API sedang lambat.');
    }
    throw new Error(`Gagal terhubung ke API: ${msg}`);
  }

  rawReply = cleanReply(rawReply);

  sess.history.push({ role: 'assistant', text: rawReply });

  if (sess.history.length > 20) {
    sess.history.splice(0, 4);
  }

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

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── META ─────────────────────────────────────────────────────
export const meta = {
  id:          'axon-beta',
  name:        'Axon AI Beta',
  description: 'Model default Axon AI oleh WebPublish. Powered by Faa API.',
  badge:       'BETA',
  default:     true,
};
