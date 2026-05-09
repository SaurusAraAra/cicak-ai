/**
 * axon-beta.js
 * Model handler — Axon AI Beta
 * API   : GET https://api-faa.my.id/faa/claude-ai?text=<prompt>
 * Author: Faa API (Cloudflare protected — wajib pakai headers lengkap)
 * Resp  : { status, creator, result, timestamp, response_time }
 *
 * Catatan:
 *  - Response kadang ada trailing \u001c{...} — dibersihkan di cleanRawReply()
 *  - Session memory dikelola in-memory per session_id (max ~3000 char context)
 */

import axios from 'axios';

// ── CONFIG ────────────────────────────────────────────────
const API_BASE = 'https://api-faa.my.id/faa/claude-ai';

// Rotate UA biar lebih natural ke Cloudflare
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
];
const rUA = () => USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

// ── SESSION MEMORY ────────────────────────────────────────
const sessions = new Map(); // session_id → context string

// ── SYSTEM PROMPT ─────────────────────────────────────────
const SYSTEM_PROMPT = `Kamu adalah Axon AI, asisten kecerdasan buatan yang dibuat oleh tim WebPublish (owner: Saurus). Kamu membantu pengguna menjawab pertanyaan, menganalisis, menulis, coding, dan banyak lagi.

Kamu memiliki akses ke tools berikut. Gunakan tag tool di akhir responmu jika pengguna memintamu:

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

ATURAN TOOL:
1. Maksimal 1 tag tool per respons
2. Tag tool di baris paling akhir
3. Untuk info terkini, selalu gunakan [TOOL:websearch:...]

KEPRIBADIAN:
- Cerdas, ramah, langsung ke inti
- Jawab dalam Bahasa Indonesia (kecuali diminta lain)
- Tidak lebay, tidak berlebihan emoji
- Jangan sebut diri sebagai AI lain (ChatGPT, Gemini, Qwen, dll)
- Nama kamu: Axon AI`;

// ── SEND MESSAGE ──────────────────────────────────────────
export async function sendMessage(userText, sessionId = 'default') {
  const prevCtx = sessions.get(sessionId) || '';

  // Bangun prompt lengkap: system + history + pesan baru
  const prompt = buildPrompt(prevCtx, userText);

  let rawReply = '';

  try {
    const ua = rUA();

    const { data } = await axios.get(API_BASE, {
      params: { text: prompt },
      headers: {
        // Header wajib untuk bypass Cloudflare
        'User-Agent':                ua,
        'Accept':                    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language':           'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept-Encoding':           'gzip, deflate, br',
        'Connection':                'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest':            'document',
        'Sec-Fetch-Mode':            'navigate',
        'Sec-Fetch-Site':            'none',
        'Sec-Fetch-User':            '?1',
        'Cache-Control':             'max-age=0',
        'Referer':                   'https://api-faa.my.id/',
        'Origin':                    'https://api-faa.my.id',
      },
      timeout: 90000, // API lambat (6s+), kasih waktu lebih
      maxRedirects: 5,
    });

    // Response: { status, result, creator, timestamp, response_time }
    if (!data?.status) {
      throw new Error(data?.message || 'API mengembalikan status false');
    }

    rawReply = data?.result || '';
    if (!rawReply) throw new Error('Result kosong dari API');

    // Bersihkan karakter control aneh di akhir (seperti \u001c{...} dari contoh)
    rawReply = cleanRawReply(rawReply);

  } catch (err) {
    const status  = err?.response?.status;
    const errMsg  = err?.response?.data?.message || err.message;
    console.error(`[axon-beta] API error (HTTP ${status || 'timeout'}):`, errMsg);

    // Cloudflare block detection
    if (status === 403 || status === 429) {
      throw new Error('Akses ditolak oleh Cloudflare. Coba lagi sebentar.');
    }
    if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
      throw new Error('Request timeout. API sedang lambat, coba lagi.');
    }

    throw new Error(`Gagal menghubungi model: ${errMsg}`);
  }

  // Update session context
  sessions.set(sessionId, trimContext(prevCtx, userText, rawReply));

  return rawReply;
}

// ── PARSE TOOL TAG ────────────────────────────────────────
export function parseToolTag(rawReply) {
  // Match: [TOOL:toolname:param] atau [TOOL:toolname:param|extra]
  const tagRx = /\[TOOL:(\w+):([^\]|]+)(?:\|([^\]]+))?\]/i;
  const match  = rawReply.match(tagRx);

  if (!match) {
    return {
      toolName:   null,
      toolParam:  null,
      toolExtra:  null,
      cleanReply: rawReply.trim(),
    };
  }

  return {
    toolName:   match[1].toLowerCase(),
    toolParam:  match[2].trim(),
    toolExtra:  match[3]?.trim() || null,
    cleanReply: rawReply.replace(tagRx, '').trim(),
  };
}

// ── HELPERS ───────────────────────────────────────────────
function buildPrompt(prevCtx, userText) {
  if (prevCtx) {
    return `${SYSTEM_PROMPT}\n\n--- Riwayat percakapan ---\n${prevCtx}\n\n--- Pesan baru ---\nUser: ${userText}\nAxon AI:`;
  }
  return `${SYSTEM_PROMPT}\n\nUser: ${userText}\nAxon AI:`;
}

function trimContext(prev, userMsg, aiReply) {
  // Bersihkan reply dari tool tag sebelum disimpan ke context
  const cleanAI = aiReply.replace(/\[TOOL:[^\]]+\]/gi, '').trim();
  const round   = `User: ${userMsg}\nAxon AI: ${cleanAI}`;
  const combined = prev ? `${prev}\n\n${round}` : round;

  // Maks ~3000 char supaya prompt tidak meledak
  if (combined.length <= 3000) return combined;
  return combined.slice(combined.length - 3000);
}

function cleanRawReply(text) {
  // Hapus trailing control chars seperti \u001c{"character_cooldown":true}
  // dan karakter non-printable lainnya di akhir
  return text
    .replace(/\u001c[^\n]*/g, '')   // strip \x1c + sisa JSON
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // strip control chars
    .trim();
}

// ── META ──────────────────────────────────────────────────
export const meta = {
  id:          'axon-beta',
  name:        'Axon AI Beta',
  description: 'Model default Axon AI oleh WebPublish. Powered by claude via faa API.',
  badge:       'BETA',
  default:     true,
};
