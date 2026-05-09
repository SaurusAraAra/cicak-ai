import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { readFileSync, existsSync } from 'fs';
import rateLimit from 'express-rate-limit';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app  = express();
const PORT = process.env.PORT || 3000;

// ══════════════════════════════════════════════════════════
//  LOAD CONFIG & MODELS
// ══════════════════════════════════════════════════════════
const configPath = path.join(__dirname, 'config.json');
const config     = JSON.parse(readFileSync(configPath, 'utf-8'));

const loadedModels = {}; // { modelId: { meta, sendMessage, parseToolTag } }

for (const m of config.models) {
  const fp = path.join(__dirname, m.file);
  if (!existsSync(fp)) { console.warn(`[model] file not found: ${m.file}`); continue; }
  try {
    const mod = await import(`./${m.file}`);
    loadedModels[m.id] = mod;
    console.log(`[model] loaded: ${m.id} (${m.name})`);
  } catch (e) {
    console.error(`[model] failed to load ${m.id}:`, e.message);
  }
}

const defaultModelId = config.models.find(m => m.default)?.id || config.models[0]?.id;

// ══════════════════════════════════════════════════════════
//  MIDDLEWARE
// ══════════════════════════════════════════════════════════
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Terlalu banyak request. Coba lagi dalam 1 menit.' },
});

// ══════════════════════════════════════════════════════════
//  USER AGENTS
// ══════════════════════════════════════════════════════════
const UAS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0',
];
const rUA   = () => UAS[Math.floor(Math.random() * UAS.length)];
const delay = (mn = 400, mx = 1200) =>
  new Promise(r => setTimeout(r, Math.floor(Math.random() * (mx - mn + 1)) + mn));

// ══════════════════════════════════════════════════════════
//  TOOLS
// ══════════════════════════════════════════════════════════

// 1. Web Search
async function webSearch(query) {
  await delay();
  const res = await axios.get('https://html.duckduckgo.com/html/', {
    params: { q: query },
    headers: { 'User-Agent': rUA(), 'Accept-Language': 'id-ID,id;q=0.9', 'Referer': 'https://duckduckgo.com/' },
    timeout: 20000,
  });
  const $ = cheerio.load(res.data);
  const results = [];
  $('.result__body').each((i, el) => {
    if (i >= 6) return false;
    const title   = $(el).find('.result__title').text().trim();
    const snippet = $(el).find('.result__snippet').text().trim();
    const url     = $(el).find('.result__url').text().trim();
    if (title && snippet) results.push({ title, snippet, url });
  });
  return results;
}

// 2. TikTok Stalk
async function tiktokStalk(username) {
  await delay();
  const res = await axios.get(`https://www.tiktok.com/@${username}`, {
    timeout: 30000,
    headers: {
      'User-Agent': rUA(),
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': 'https://www.google.com/',
      'Sec-Fetch-Dest': 'document', 'Sec-Fetch-Mode': 'navigate',
      'Upgrade-Insecure-Requests': '1',
    },
  });
  const $ = cheerio.load(res.data);
  const raw = $('#__UNIVERSAL_DATA_FOR_REHYDRATION__').text();
  if (!raw) throw new Error('Gagal ambil data dari halaman TikTok.');
  const parsed = JSON.parse(raw);
  const detail = parsed['__DEFAULT_SCOPE__']['webapp.user-detail'];
  if (detail.statusCode !== 0) throw new Error('User tidak ditemukan!');
  return detail.userInfo;
}

// 3. TikTok Video Search
async function tiktokSearch(query) {
  const res = await axios({
    method: 'POST',
    url: 'https://tikwm.com/api/feed/search',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      Cookie: 'current_language=en',
      'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 Chrome/116.0.0.0 Mobile Safari/537.36',
    },
    data: { keywords: query, count: 8, cursor: 0, HD: 1 },
    timeout: 30000,
  });
  const videos = res.data?.data?.videos;
  if (!videos?.length) throw new Error('Tidak ada video ditemukan.');
  return videos.map(v => ({
    title: v.title, cover: v.cover, origin_cover: v.origin_cover,
    play: v.play, wmplay: v.wmplay, music: v.music,
    author: { id: v.author?.id, nickname: v.author?.nickname, avatar: v.author?.avatar, username: v.author?.unique_id },
    stats: { plays: v.play_count, likes: v.digg_count, comments: v.comment_count, shares: v.share_count },
    duration: v.duration, create_time: v.create_time,
  }));
}

// 4. Pinterest Search
async function pinterestSearch(query) {
  const dataParam = JSON.stringify({
    options: { query, rs: 'rs', scope: 'pins', redux_normalize_feed: true },
    context: {},
  });
  const url = `https://id.pinterest.com/resource/BaseSearchResource/get/?source_url=/search/pins/?q=${query}&rs=rs&data=${encodeURIComponent(dataParam)}`;
  const res = await axios.get(url, {
    headers: {
      'accept': 'application/json, text/javascript, */*; q=0.01',
      'x-pinterest-appstate': 'active',
      'x-requested-with': 'XMLHttpRequest',
      'user-agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 Chrome/137.0.0.0 Mobile Safari/537.36',
      'referer': 'https://id.pinterest.com/',
    },
    timeout: 20000,
  });
  const results = res.data?.resource_response?.data?.results || [];
  return results.map(pin => ({
    id: pin.id,
    title: pin.seo_alt_text || pin.title || 'No Title',
    image: pin.images?.['474x']?.url || pin.images?.['236x']?.url || pin.images?.orig?.url || null,
    board: pin.board?.name || '-',
    username: pin.pinner?.username || '-',
    source: `https://id.pinterest.com/pin/${pin.id}/`,
  })).filter(p => p.image).slice(0, 12);
}

// 5. Lyrics Search
async function lyricsSearch(query) {
  await delay(300, 800);
  const res = await axios.get(`https://api.genius.com/search?q=${encodeURIComponent(query)}`, {
    headers: { 'Authorization': 'Bearer ' + (process.env.GENIUS_TOKEN || '') },
    timeout: 15000,
  });
  const hits = res.data?.response?.hits?.slice(0, 5) || [];
  if (!hits.length) throw new Error('Lagu tidak ditemukan.');

  // scrape lirik dari halaman genius
  const top  = hits[0].result;
  const page = await axios.get(top.url, { headers: { 'User-Agent': rUA() }, timeout: 20000 });
  const $    = cheerio.load(page.data);
  let lyrics = '';
  $('[data-lyrics-container="true"]').each((_, el) => {
    $(el).find('br').replaceWith('\n');
    lyrics += $(el).text() + '\n\n';
  });
  return {
    title:  top.title,
    artist: top.primary_artist?.name,
    cover:  top.song_art_image_thumbnail_url,
    url:    top.url,
    lyrics: lyrics.trim() || null,
  };
}

// 6. MCPE Addon Search
async function mcpeSearch(query) {
  await delay(300, 800);
  const { data } = await axios.get(`https://mcpedl.org/?s=${encodeURIComponent(query)}`, {
    timeout: 30000,
    headers: { 'User-Agent': rUA() },
  });
  const $ = cheerio.load(data);
  const result = [];
  $('.g-block.size-20 article').each((i, el) => {
    if (i >= 10) return false;
    const title  = $(el).find('.entry-title a').text().trim() || 'No title';
    const link   = $(el).find('.entry-title a').attr('href') || '';
    let   image  = $(el).find('.post-thumbnail img').attr('data-srcset') || $(el).find('.post-thumbnail img').attr('src') || '';
    if (image.includes(',')) image = image.split(',')[0].split(' ')[0];
    const rating = $(el).find('.rating-wrapper span').text().trim() || '-';
    result.push({ title, link, image, rating });
  });
  if (!result.length) throw new Error('Addon tidak ditemukan.');
  return result;
}

// 7. Screenshot Website
async function ssWeb(url, mode = 'desktop') {
  if (!url.startsWith('https://')) throw new Error('URL harus diawali https://');
  const isM    = mode === 'mobile';
  const payload = {
    url,
    browserWidth:       isM ? 375  : 1920,
    browserHeight:      isM ? 812  : 1080,
    fullPage:           false,
    deviceScaleFactor:  isM ? 2    : 1,
    format:             'png',
  };
  const { data } = await axios.post('https://gcp.imagy.app/screenshot/createscreenshot', payload, {
    headers: {
      'content-type': 'application/json',
      referer: 'https://imagy.app/full-page-screenshot-taker/',
      'user-agent': rUA(),
    },
    timeout: 30000,
  });
  if (!data.fileUrl) throw new Error('Gagal generate screenshot.');
  return { url, mode, imageUrl: data.fileUrl };
}

// 8. TikTok Earnings
async function tiktokEarnings(username) {
  const clean = username.replace(/^@+/, '');
  const { data } = await axios.get(`https://backend.exolyt.com/calculator/${clean}`, {
    headers: {
      'User-Agent': rUA(),
      'Accept': 'application/json',
      'Referer': 'https://exolyt.com/',
      'Origin': 'https://exolyt.com',
    },
    timeout: 12000,
  });
  const user     = data?.data?.user;
  const earnings = data?.data?.earnings;
  if (!user) throw new Error('User tidak ditemukan.');
  return {
    nickname:   user.nickName,
    unique_id:  user.uniqueId,
    avatar:     user.cover,
    followers:  user.fans,
    likes:      user.heart,
    videos:     user.video,
    engagement: parseFloat((user.engagement * 100).toFixed(2)),
    earnings: {
      per_post_min:     `$${earnings?.min?.toFixed(2)}`,
      per_post_max:     `$${earnings?.max?.toFixed(2)}`,
      per_post_min_idr: `Rp${Math.round((earnings?.min || 0) * 16000).toLocaleString('id-ID')}`,
      per_post_max_idr: `Rp${Math.round((earnings?.max || 0) * 16000).toLocaleString('id-ID')}`,
    },
  };
}

// 9. NPM Info
async function npmInfo(pkg) {
  const { data } = await axios.get(`https://registry.npmjs.org/${pkg}`, { timeout: 15000 });
  const versions   = data.versions;
  const allver     = Object.keys(versions);
  const verLatest  = allver[allver.length - 1];
  const verFirst   = allver[0];
  const pkgLatest  = versions[verLatest];
  return {
    name:             pkg,
    description:      data.description || null,
    author:           data.author?.name || null,
    license:          pkgLatest.license || null,
    homepage:         data.homepage || null,
    repository:       data.repository?.url || null,
    version_latest:   verLatest,
    version_first:    verFirst,
    total_versions:   allver.length,
    deps_latest:      Object.keys(pkgLatest.dependencies || {}).length,
    published_at:     data.time.created,
    latest_published: data.time[verLatest],
    keywords:         data.keywords || [],
  };
}

// ══════════════════════════════════════════════════════════
//  TOOL DISPATCHER
// ══════════════════════════════════════════════════════════
async function runTool(name, param, extra) {
  switch (name) {
    case 'websearch':     return { type: 'websearch',     data: await webSearch(param) };
    case 'tiktokstalk':   return { type: 'tiktokstalk',   data: await tiktokStalk(param) };
    case 'tiktokvideo':   return { type: 'tiktokvideo',   data: await tiktokSearch(param) };
    case 'pinterest':     return { type: 'pinterest',     data: await pinterestSearch(param) };
    case 'lyrics':        return { type: 'lyrics',        data: await lyricsSearch(param) };
    case 'mcpe':          return { type: 'mcpe',          data: await mcpeSearch(param) };
    case 'ssweb':         return { type: 'ssweb',         data: await ssWeb(param, extra || 'desktop') };
    case 'tiktokearnings':return { type: 'tiktokearnings',data: await tiktokEarnings(param) };
    case 'npm':           return { type: 'npm',           data: await npmInfo(param) };
    default:              return null;
  }
}

// ══════════════════════════════════════════════════════════
//  API: daftar model (untuk frontend)
// ══════════════════════════════════════════════════════════
app.get('/api/models', (_, res) => {
  res.json({
    ok: true,
    models: config.models.map(m => ({
      id:          m.id,
      name:        m.name,
      description: m.description,
      badge:       m.badge,
      default:     m.default || false,
    })),
  });
});

// ══════════════════════════════════════════════════════════
//  CHAT ENDPOINT
// ══════════════════════════════════════════════════════════
app.post('/api/chat', chatLimiter, async (req, res) => {
  try {
    const { text, session_id, model_id } = req.body;
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ ok: false, error: 'Text diperlukan' });
    }

    // sanitasi input
    const safeText = text.trim().slice(0, 4000);

    // pilih model
    const selectedId = model_id && loadedModels[model_id] ? model_id : defaultModelId;
    const model      = loadedModels[selectedId];
    if (!model) return res.status(500).json({ ok: false, error: 'Model tidak tersedia.' });

    // kirim ke model
    const rawReply = await model.sendMessage(safeText, session_id || 'default');

    // parse tool tag
    const { toolName, toolParam, toolExtra, cleanReply } = model.parseToolTag(rawReply);

    let toolResult = null;
    if (toolName) {
      try {
        toolResult = await runTool(toolName, toolParam, toolExtra);
        console.log(`[tool] ${toolName}("${toolParam}") → ok`);
      } catch (toolErr) {
        console.error(`[tool] ${toolName} error:`, toolErr.message);
        toolResult = { type: toolName, error: toolErr.message };
      }
    }

    res.json({ ok: true, reply: cleanReply, tool: toolResult, model: selectedId });

  } catch (err) {
    console.error('[chat error]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ══════════════════════════════════════════════════════════
//  DIRECT TOOL ENDPOINTS
// ══════════════════════════════════════════════════════════
app.get('/api/tools/websearch',      async (req, res) => { try { res.json({ status: true, data: await webSearch(req.query.q) }); } catch(e) { res.status(500).json({ status: false, message: e.message }); } });
app.get('/api/tools/tiktokstalk',    async (req, res) => { try { res.json({ status: true, data: await tiktokStalk(req.query.user) }); } catch(e) { res.status(500).json({ status: false, message: e.message }); } });
app.get('/api/tools/tiktokvideo',    async (req, res) => { try { res.json({ status: true, data: await tiktokSearch(req.query.q) }); } catch(e) { res.status(500).json({ status: false, message: e.message }); } });
app.get('/api/tools/pinterest',      async (req, res) => { try { res.json({ status: true, data: await pinterestSearch(req.query.q) }); } catch(e) { res.status(500).json({ status: false, message: e.message }); } });
app.get('/api/tools/lyrics',         async (req, res) => { try { res.json({ status: true, data: await lyricsSearch(req.query.q) }); } catch(e) { res.status(500).json({ status: false, message: e.message }); } });
app.get('/api/tools/mcpe',           async (req, res) => { try { res.json({ status: true, data: await mcpeSearch(req.query.q) }); } catch(e) { res.status(500).json({ status: false, message: e.message }); } });
app.get('/api/tools/ssweb',          async (req, res) => { try { res.json({ status: true, data: await ssWeb(req.query.url, req.query.mode) }); } catch(e) { res.status(500).json({ status: false, message: e.message }); } });
app.get('/api/tools/tiktokearnings', async (req, res) => { try { res.json({ status: true, data: await tiktokEarnings(req.query.user) }); } catch(e) { res.status(500).json({ status: false, message: e.message }); } });
app.get('/api/tools/npm',            async (req, res) => { try { res.json({ status: true, data: await npmInfo(req.query.q) }); } catch(e) { res.status(500).json({ status: false, message: e.message }); } });

// ══════════════════════════════════════════════════════════
//  SPA ROUTES
// ══════════════════════════════════════════════════════════
app.get('/',       (_, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/chat',   (_, res) => res.sendFile(path.join(__dirname, 'public', 'chat.html')));
app.get('/saurus', (_, res) => res.sendFile(path.join(__dirname, 'public', 'chat.html')));

app.use((_, res) => {
  const f = path.join(__dirname, 'public', '404.html');
  res.status(404).sendFile(f, e => { if (e) res.status(404).send('404'); });
});

app.listen(PORT, () => console.log(`✓ Axon AI running on port ${PORT}`));