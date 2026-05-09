/**
 * axon-beta.js
 * Model handler — Axon AI Beta
 * API: https://ai.siputzx.my.id (siputzx)
 * Endpoint: POST /
 * Body: { content, user, model }
 */

import axios from 'axios';

// ── CONFIG ───────────────────────────────────────────────
const API_URL = 'https://ai.siputzx.my.id';
const MODEL   = 'qwen3-coder-plus';   // model beta siputzx

// ── SESSION MEMORY ────────────────────────────────────────
// Simpan history per session_id (in-memory, reset on restart)
const sessions = new Map(); // session_id → string (context ringkas)

// ── SYSTEM PROMPT ─────────────────────────────────────────
const SYSTEM_PROMPT = `Kamu adalah Axon AI, asisten kecerdasan buatan cerdas yang dibuat oleh tim WebPublish (owner: Saurus). Kamu membantu pengguna menjawab pertanyaan, menganalisis informasi, menulis, coding, dan banyak lagi.

Kamu memiliki akses ke tools berikut. Jika pengguna memintamu melakukan salah satu hal ini, gunakan tag tool yang sesuai di akhir responmu:

TOOLS YANG TERSEDIA:
- Cari di internet/web/Google → [TOOL:websearch:query]
- Cek profil TikTok → [TOOL:tiktokstalk:username]
- Cari video TikTok → [TOOL:tiktokvideo:keyword]
- Cari foto Pinterest → [TOOL:pinterest:keyword]
- Cari lirik lagu → [TOOL:lyrics:judul artis]
- Cari addon MCPE → [TOOL:mcpe:keyword]
- Screenshot website → [TOOL:ssweb:https://url.com|desktop]
- Estimasi penghasilan TikTok → [TOOL:tiktokearnings:username]
- Info package NPM → [TOOL:npm:nama-package]

ATURAN TOOL:
1. Gunakan maksimal 1 tag tool per respons
2. Tag tool ditulis di baris terakhir respons, tidak di tengah
3. Jika butuh cari informasi terkini, gunakan [TOOL:websearch:...]
4. Jawab dulu sebelum tool jika perlu konteks

KEPRIBADIAN:
- Cerdas, ramah, dan to the point
- Jawaban dalam Bahasa Indonesia (kecuali diminta lain)
- Tidak lebay, tidak pakai emoji berlebihan
- Jika tidak tahu sesuatu, cari dulu via websearch daripada mengarang

Nama kamu: Axon AI. Jangan pernah menyebut diri sebagai AI lain (ChatGPT, Gemini, dll).`;

// ── SEND MESSAGE ─────────────────────────────────────────
export async function sendMessage(userText, sessionId = 'default') {
  // Ambil context session sebelumnya
  const prevContext = sessions.get(sessionId) || '';

  // Gabungkan context + pesan baru ke dalam content
  const fullContent = prevContext
    ? `${prevContext}\n\nUser: ${userText}`
    : userText;

  let reply = '';

  try {
    const { data } = await axios.post(
      `${API_URL}/`,
      {
        content: `${SYSTEM_PROMPT}\n\n${fullContent}`,
        user:    sessionId,
        model:   MODEL,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Accept':       'application/json',
          'User-Agent':   'AxonAI/1.0 (+https://webpublish.id)',
        },
        timeout: 60000,
      }
    );

    // API returns: { result: "..." }
    reply = data?.result || data?.response || data?.message || '';
    if (!reply && typeof data === 'string') reply = data;
    if (!reply) throw new Error('Empty response dari API');

  } catch (err) {
    const status = err?.response?.status;
    const msg    = err?.response?.data?.message || err.message;
    console.error(`[axon-beta] API error (${status}):`, msg);
    throw new Error(`Gagal menghubungi model: ${msg}`);
  }

  // Simpan context baru (ringkas: hanya 3 pasang terakhir agar tidak overflow)
  const newContext = trimContext(prevContext, userText, reply);
  sessions.set(sessionId, newContext);

  return reply;
}

// ── PARSE TOOL TAG ────────────────────────────────────────
/**
 * Ekstrak [TOOL:name:param|extra] dari reply AI
 * Returns: { toolName, toolParam, toolExtra, cleanReply }
 */
export function parseToolTag(rawReply) {
  const tagRx = /\[TOOL:(\w+):([^\]|]+)(?:\|([^\]]+))?\]/i;
  const match  = rawReply.match(tagRx);

  if (!match) {
    return { toolName: null, toolParam: null, toolExtra: null, cleanReply: rawReply.trim() };
  }

  const toolName  = match[1].toLowerCase();
  const toolParam = match[2].trim();
  const toolExtra = match[3]?.trim() || null;
  const cleanReply = rawReply.replace(tagRx, '').trim();

  return { toolName, toolParam, toolExtra, cleanReply };
}

// ── HELPERS ───────────────────────────────────────────────
function trimContext(prev, userMsg, aiReply) {
  // Tambah ronde baru
  const round = `User: ${userMsg}\nAxon AI: ${aiReply}`;

  // Gabungkan dan potong agar tidak terlalu panjang (maks ~3000 char)
  const combined = prev ? `${prev}\n\n${round}` : round;
  if (combined.length <= 3000) return combined;

  // Potong dari depan
  return combined.slice(combined.length - 3000);
}

export const meta = {
  id:          'axon-beta',
  name:        'Axon AI Beta',
  description: 'Model default Axon AI dari tim WebPublish. Cerdas, cepat, dan lengkap dengan tools.',
  badge:       'BETA',
  default:     true,
};
