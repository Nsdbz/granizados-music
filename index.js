require('dotenv').config()
const express = require('express')
const axios = require('axios')
const { Redis } = require('@upstash/redis')

const app = express()
app.use(express.json())
app.use(express.static('public'))

// ─── REDIS ────────────────────────────────────────────────────────────────────

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN
})

// ─── HELPERS DE REDIS ─────────────────────────────────────────────────────────

async function getPlaylists() {
  try { const saved = await redis.get('playlists'); return saved || [] } catch (e) { return [] }
}

async function savePlaylists(playlists) {
  try { await redis.set('playlists', playlists) } catch (e) {}
}

async function getPlaylistSongs(playlistId) {
  try { const saved = await redis.get(`playlist:${playlistId}:songs`); return saved || [] } catch (e) { return [] }
}

async function savePlaylistSongs(playlistId, songs) {
  try { await redis.set(`playlist:${playlistId}:songs`, songs) } catch (e) {}
}

async function getQueue() {
  try { const saved = await redis.get('queue'); return saved || [] } catch (e) { return [] }
}

async function saveQueue(queue) {
  try { await redis.set('queue', queue) } catch (e) {}
}

async function getPending() {
  try { const saved = await redis.get('pending'); return saved || [] } catch (e) { return [] }
}

async function savePending(pending) {
  try { await redis.set('pending', pending) } catch (e) {}
}

async function getRequestLog() {
  try { const saved = await redis.get('request_log'); return saved || {} } catch (e) { return {} }
}

async function saveRequestLog(log) {
  try { await redis.set('request_log', log) } catch (e) {}
}

// ─── LOG DE VIDEOS BLOQUEADOS ─────────────────────────────────────────────────

async function getBlockedLog() {
  try { return await redis.get('blocked_log') || [] } catch (e) { return [] }
}

async function logBlockedVideo(videoId, title, thumbnail) {
  try {
    const log = await getBlockedLog()
    if (log.find(v => v.videoId === videoId)) return
    log.unshift({ videoId, title, thumbnail: thumbnail || null, blockedAt: Date.now() })
    await redis.set('blocked_log', log.slice(0, 100))
  } catch (e) {}
}

// ─── CONFIG (límite entre peticiones) ────────────────────────────────────────

async function getConfig() {
  try { const saved = await redis.get('app_config'); return saved || { requestLimitMinutes: 10 } } catch (e) { return { requestLimitMinutes: 10 } }
}

async function saveConfig(config) {
  try { await redis.set('app_config', config) } catch (e) {}
}

// ─── ESTADÍSTICAS DIARIAS ─────────────────────────────────────────────────────

function getTodayKey() {
  const d = new Date()
  return `daily_stats:${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

async function incrementDailyStat(video) {
  try {
    const key = getTodayKey()
    const stats = await redis.get(key) || {}
    if (stats[video.videoId]) {
      stats[video.videoId].count += 1
    } else {
      stats[video.videoId] = { title: video.title, thumbnail: video.thumbnail, count: 1 }
    }
    await redis.set(key, stats, { ex: 60 * 60 * 24 * 90 })
  } catch (e) {}
}

async function getDailyStats(date) {
  const key = date ? `daily_stats:${date}` : getTodayKey()
  try { return await redis.get(key) || {} } catch (e) { return {} }
}

async function getAvailableDates() {
  const today = new Date()
  const dateStrs = []
  for (let i = 0; i < 30; i++) {
    const d = new Date(today)
    d.setDate(today.getDate() - i)
    dateStrs.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`)
  }
  const results = await Promise.all(dateStrs.map(date => redis.get(`daily_stats:${date}`).catch(() => null)))
  return dateStrs.filter((_, i) => results[i] && Object.keys(results[i]).length > 0)
}

// ─── AUTO PLAYLIST (playlist de fondo o aleatoria entre activas) ─────────────

async function getBackgroundPlaylistId() {
  try { return await redis.get('background_playlist_id') || null } catch (e) { return null }
}

async function getRandomSongFromPlaylists() {
  try {
    const playlists = await getPlaylists()
    const active = playlists.filter(p => p.active !== false)
    if (!active.length) return null

    // Si hay playlist de fondo configurada, usar solo esa
    const bgId = await getBackgroundPlaylistId()
    let playlist = null
    if (bgId) {
      playlist = active.find(p => p.id === bgId)
    }
    // Si no hay configurada o no está activa, elegir aleatoriamente
    if (!playlist) {
      playlist = active[Math.floor(Math.random() * active.length)]
    }

    const songs = await getPlaylistSongs(playlist.id)
    if (!songs.length) return null
    const song = songs[Math.floor(Math.random() * songs.length)]
    return { ...song, playlistName: playlist.name }
  } catch (e) { return null }
}

// ─── IDENTIFICADOR DE CLIENTE ─────────────────────────────────────────────────

function getIdentifier(req, clientId) {
  return clientId || req.headers['x-forwarded-for'] || req.socket.remoteAddress
}

// ─── ADMIN: autenticación desactivada ─────────────────────────────────────────

function adminAuth(req, res, next) { next() }

// ─── YOUTUBE: BUSCAR VIDEOS ───────────────────────────────────────────────────

app.get('/search', async (req, res) => {
  const { q } = req.query
  if (!q) return res.status(400).json({ error: 'Falta el término de búsqueda' })
  try {
    const response = await axios.get('https://www.googleapis.com/youtube/v3/search', {
      params: { part: 'snippet', q, type: 'video', maxResults: 10, key: process.env.YOUTUBE_API_KEY }
    })
    res.json(response.data.items.map(item => ({
      videoId: item.id.videoId,
      title: item.snippet.title,
      artist: item.snippet.channelTitle,
      thumbnail: item.snippet.thumbnails.medium?.url
    })))
  } catch (error) { res.status(500).json({ error: 'Error buscando en YouTube' }) }
})

// ─── HELPER: VERIFICAR EMBEDDING ─────────────────────────────────────────────

async function canEmbed(videoId) {
  try {
    const res = await axios.get('https://www.youtube.com/oembed', {
      params: { url: `https://www.youtube.com/watch?v=${videoId}`, format: 'json' },
      timeout: 8000,
      validateStatus: s => s < 500
    })
    // 200 = embeddable, 401/403 = bloqueado, 404 = no existe
    return res.status === 200
  } catch (e) {
    // Si hay error de red o timeout, conservar la canción (no eliminarla por error de conexión)
    console.log(`canEmbed error para ${videoId}:`, e.code || e.message)
    return true
  }
}

async function fetchYoutubePlaylist(playlistId) {
  let songs = []
  let pageToken = null

  do {
    const params = { part: 'snippet', playlistId, maxResults: 50, key: process.env.YOUTUBE_API_KEY }
    if (pageToken) params.pageToken = pageToken
    const response = await axios.get('https://www.googleapis.com/youtube/v3/playlistItems', { params })
    const tracks = response.data.items
      .filter(item => item.snippet.resourceId.videoId)
      .map(item => ({
        videoId: item.snippet.resourceId.videoId,
        title: item.snippet.title,
        thumbnail: item.snippet.thumbnails.medium?.url || item.snippet.thumbnails.default?.url
      }))
    songs = [...songs, ...tracks]
    pageToken = response.data.nextPageToken || null
  } while (pageToken)

  // ── Paso 1: filtrar embeddables en lote ──────────────────────────────────
  const embeddable = []
  for (let i = 0; i < songs.length; i += 50) {
    const batch = songs.slice(i, i + 50)
    const ids = batch.map(s => s.videoId).join(',')
    try {
      const statusRes = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
        params: { part: 'status', id: ids, key: process.env.YOUTUBE_API_KEY }
      })
      const embeddableIds = new Set(
        statusRes.data.items
          .filter(v => v.status.embeddable === true)
          .map(v => v.id)
      )
      batch.forEach(song => {
        if (embeddableIds.has(song.videoId)) embeddable.push(song)
      })
    } catch (e) {
      console.log('Error verificando embedding del lote:', e.message)
      embeddable.push(...batch)
    }
  }

  console.log(`Playlist: ${songs.length} totales, ${embeddable.length} embeddables`)
  return embeddable
}

// ─── ADMIN: INFO DE VIDEO POR ID ─────────────────────────────────────────────

app.get('/admin/song-info', adminAuth, async (req, res) => {
  const { videoId } = req.query
  if (!videoId) return res.status(400).json({ error: 'Falta el videoId' })
  try {
    const response = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
      params: { part: 'snippet', id: videoId, key: process.env.YOUTUBE_API_KEY }
    })
    const item = response.data.items?.[0]
    if (!item) return res.status(404).json({ error: 'Video no encontrado' })
    res.json({
      videoId,
      title: item.snippet.title,
      thumbnail: item.snippet.thumbnails.medium?.url || item.snippet.thumbnails.default?.url || null
    })
  } catch (e) {
    res.status(500).json({ error: 'Error consultando YouTube' })
  }
})

// ─── ADMIN: CONFIG ────────────────────────────────────────────────────────────

app.get('/admin/config', adminAuth, async (req, res) => {
  try { res.json(await getConfig()) }
  catch (error) { res.status(500).json({ error: error.message }) }
})

app.post('/admin/config', adminAuth, async (req, res) => {
  try {
    const config = await getConfig()
    if (req.body.requestLimitMinutes !== undefined) {
      const mins = parseInt(req.body.requestLimitMinutes)
      if (isNaN(mins) || mins < 0) return res.status(400).json({ error: 'Valor inválido' })
      config.requestLimitMinutes = mins
    }
    await saveConfig(config)
    res.json({ ok: true, config })
  } catch (error) { res.status(500).json({ error: error.message }) }
})

app.get('/admin/request-limit', adminAuth, async (req, res) => {
  try {
    const config = await getConfig()
    res.json({ minutes: config.requestLimitMinutes ?? 10 })
  } catch (error) { res.status(500).json({ error: error.message }) }
})

app.post('/admin/request-limit', adminAuth, async (req, res) => {
  try {
    const mins = parseInt(req.body.minutes)
    if (isNaN(mins) || mins < 0) return res.status(400).json({ error: 'Valor inválido' })
    const config = await getConfig()
    config.requestLimitMinutes = mins
    await saveConfig(config)
    res.json({ ok: true, minutes: mins })
  } catch (error) { res.status(500).json({ error: error.message }) }
})

app.get("/admin/reports", adminAuth, async (req, res) => {
  try {
    const dates = await getAvailableDates()
    const statsAll = await Promise.all(dates.map(date => getDailyStats(date)))
    const reports = dates.map((date, i) => {
      const videos = Object.values(statsAll[i])
      const totalRequests = videos.reduce((acc, v) => acc + v.count, 0)
      const [y, m, d] = date.split("-")
      return { date: `${d}/${m}/${y}`, totalRequests }
    })
    res.json(reports)
  } catch (error) { res.status(500).json({ error: error.message }) }
})

// ─── ADMIN: PLAYLISTS ─────────────────────────────────────────────────────────

app.get('/admin/playlists', adminAuth, async (req, res) => {
  try { res.json(await getPlaylists()) }
  catch (error) { res.status(500).json({ error: error.message }) }
})

app.post('/admin/playlists', adminAuth, async (req, res) => {
  const { url, name, cover } = req.body
  if (!url || !name) return res.status(400).json({ error: 'Faltan url y nombre' })
  let playlistId = url
  const match = url.match(/[?&]list=([^&]+)/)
  if (match) playlistId = match[1]
  try {
    const songs = await fetchYoutubePlaylist(playlistId)
    if (!songs.length) return res.status(400).json({ error: 'No se encontraron videos reproducibles en esa playlist (todos tienen restricción de embedding)' })
    const playlists = await getPlaylists()
    const exists = playlists.find(p => p.youtubeId === playlistId)
    if (exists) return res.status(400).json({ error: 'Esa playlist ya está agregada' })
    const id = `pl_${Date.now()}`
    playlists.push({ id, youtubeId: playlistId, name, cover: cover || null, total: songs.length, active: true, createdAt: Date.now() })
    await savePlaylists(playlists)
    await savePlaylistSongs(id, songs)
    res.json({ ok: true, name, total: songs.length, filtered: true })
  } catch (error) { res.status(500).json({ error: 'No se pudo cargar la playlist. Verifica que sea pública.' }) }
})

app.delete('/admin/playlists/:id', adminAuth, async (req, res) => {
  try {
    let playlists = await getPlaylists()
    playlists = playlists.filter(p => p.id !== req.params.id)
    await savePlaylists(playlists)
    await redis.del(`playlist:${req.params.id}:songs`)
    res.json({ ok: true })
  } catch (error) { res.status(500).json({ error: error.message }) }
})

app.post('/admin/playlists/:id/reload', adminAuth, async (req, res) => {
  try {
    const playlists = await getPlaylists()
    const playlist = playlists.find(p => p.id === req.params.id)
    if (!playlist) return res.status(404).json({ error: 'Playlist no encontrada' })
    const songs = await fetchYoutubePlaylist(playlist.youtubeId)
    playlist.total = songs.length
    await savePlaylists(playlists)
    await savePlaylistSongs(playlist.id, songs)
    res.json({ ok: true, total: songs.length })
  } catch (error) { res.status(500).json({ error: error.message }) }
})

app.post('/admin/playlists/:id/toggle', adminAuth, async (req, res) => {
  try {
    const playlists = await getPlaylists()
    const playlist = playlists.find(p => p.id === req.params.id)
    if (!playlist) return res.status(404).json({ error: 'Playlist no encontrada' })
    playlist.active = playlist.active === false ? true : false
    await savePlaylists(playlists)
    res.json({ ok: true, active: playlist.active })
  } catch (error) { res.status(500).json({ error: error.message }) }
})

app.post('/admin/playlists/:id/cover', adminAuth, async (req, res) => {
  const { cover } = req.body
  if (!cover) return res.status(400).json({ error: 'Falta la URL de la portada' })
  try {
    const playlists = await getPlaylists()
    const playlist = playlists.find(p => p.id === req.params.id)
    if (!playlist) return res.status(404).json({ error: 'Playlist no encontrada' })
    playlist.cover = cover
    await savePlaylists(playlists)
    res.json({ ok: true })
  } catch (error) { res.status(500).json({ error: error.message }) }
})

app.post('/admin/playlists/merge', adminAuth, async (req, res) => {
  const { ids, name } = req.body
  if (!ids || ids.length < 2 || !name) return res.status(400).json({ error: 'Necesitas al menos 2 playlists y un nombre' })
  try {
    const playlists = await getPlaylists()
    let allSongs = []
    const seen = new Set()
    for (const id of ids) {
      const songs = await getPlaylistSongs(id)
      for (const s of songs) {
        if (!seen.has(s.videoId)) { seen.add(s.videoId); allSongs.push(s) }
      }
    }
    if (!allSongs.length) return res.status(400).json({ error: 'Las playlists seleccionadas no tienen canciones' })
    const newId = `pl_${Date.now()}`
    playlists.push({ id: newId, youtubeId: null, name, total: allSongs.length, active: true, merged: true, sourceIds: ids, createdAt: Date.now() })
    await savePlaylists(playlists)
    await savePlaylistSongs(newId, allSongs)
    res.json({ ok: true, name, total: allSongs.length })
  } catch (error) { res.status(500).json({ error: error.message }) }
})

app.post('/admin/playlists/:id/songs', adminAuth, async (req, res) => {
  const { videoId, title, thumbnail } = req.body
  if (!videoId || !title) return res.status(400).json({ error: 'Faltan datos de la canción' })
  try {
    const playlists = await getPlaylists()
    const playlist = playlists.find(p => p.id === req.params.id)
    if (!playlist) return res.status(404).json({ error: 'Playlist no encontrada' })
    const songs = await getPlaylistSongs(req.params.id)
    if (songs.find(s => s.videoId === videoId)) return res.status(400).json({ error: 'Esa canción ya está en la playlist' })
    songs.push({ videoId, title, thumbnail: thumbnail || null })
    playlist.total = songs.length
    await savePlaylists(playlists)
    await savePlaylistSongs(req.params.id, songs)
    res.json({ ok: true, total: songs.length })
  } catch (error) { res.status(500).json({ error: error.message }) }
})

// ─── REPARAR PLAYLIST ─────────────────────────────────────────────────────────

app.post('/admin/playlists/:id/fix', adminAuth, async (req, res) => {
  try {
    const playlists = await getPlaylists()
    const playlist = playlists.find(p => p.id === req.params.id)
    if (!playlist) return res.status(404).json({ error: 'Playlist no encontrada' })

    const songs = await getPlaylistSongs(req.params.id)
    if (!songs.length) return res.json({ ok: true, fixed: 0, removed: 0, total: 0 })

    console.log(`Reparando playlist "${playlist.name}" — ${songs.length} canciones`)

    let removed = 0
    const repairedSongs = []

    for (const song of songs) {
      const embeddable = await canEmbed(song.videoId)
      if (embeddable) {
        repairedSongs.push(song)
      } else {
        console.log(`Bloqueado: "${song.title}" (${song.videoId})`)
        await logBlockedVideo(song.videoId, song.title, song.thumbnail)
        removed++
      }
    }

    playlist.total = repairedSongs.length
    await savePlaylists(playlists)
    await savePlaylistSongs(req.params.id, repairedSongs)

    console.log(`Reparación completa: ${removed} eliminadas, ${repairedSongs.length} restantes`)
    res.json({ ok: true, removed, total: repairedSongs.length })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.post('/admin/add-to-queue', adminAuth, async (req, res) => {
  const { videoId, title, thumbnail } = req.body
  if (!videoId || !title) return res.status(400).json({ error: 'Datos incompletos' })
  try {
    const queue = await getQueue()
    queue.push({
      id: `admin_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      videoId, title,
      thumbnail: thumbnail || null,
      requestedBy: 'admin',
      approvedAt: Date.now()
    })
    await saveQueue(queue)
    await incrementDailyStat({ videoId, title, thumbnail })
    res.json({ ok: true })
  } catch (error) { res.status(500).json({ error: error.message }) }
})

// ─── ADMIN: COLA Y SOLICITUDES ────────────────────────────────────────────────

app.get('/admin/pending', adminAuth, async (req, res) => {
  try { res.json((await getPending()).sort((a, b) => a.timestamp - b.timestamp)) }
  catch (error) { res.status(500).json({ error: error.message }) }
})

app.post('/admin/pending/:id/approve', adminAuth, async (req, res) => {
  try {
    const pending = await getPending()
    const request = pending.find(p => p.id === req.params.id)
    if (!request) return res.status(404).json({ error: 'Solicitud no encontrada' })
    const queue = await getQueue()
    queue.push({ id: request.id, videoId: request.videoId, title: request.title, thumbnail: request.thumbnail, requestedBy: request.clientId, approvedAt: Date.now() })
    await saveQueue(queue)
    await incrementDailyStat(request)
    await savePending(pending.filter(p => p.id !== req.params.id))
    res.json({ ok: true })
  } catch (error) { res.status(500).json({ error: error.message }) }
})

app.post('/admin/pending/:id/reject', adminAuth, async (req, res) => {
  try {
    const pending = await getPending()
    await savePending(pending.filter(p => p.id !== req.params.id))
    res.json({ ok: true })
  } catch (error) { res.status(500).json({ error: error.message }) }
})

app.get('/admin/queue', adminAuth, async (req, res) => {
  try { res.json(await getQueue()) }
  catch (error) { res.status(500).json({ error: error.message }) }
})

app.delete('/admin/queue/:id', adminAuth, async (req, res) => {
  try {
    const queue = await getQueue()
    await saveQueue(queue.filter(v => v.id !== req.params.id))
    res.json({ ok: true })
  } catch (error) { res.status(500).json({ error: error.message }) }
})

// ─── ADMIN: ESTADÍSTICAS DIARIAS ─────────────────────────────────────────────

app.get('/admin/stats', adminAuth, async (req, res) => {
  try {
    const { date } = req.query
    const stats = await getDailyStats(date)
    const videos = Object.values(stats)
    const totalRequests = videos.reduce((acc, v) => acc + v.count, 0)
    res.json({ date: date || getTodayKey().replace('daily_stats:', ''), totalRequests })
  } catch (error) { res.status(500).json({ error: error.message }) }
})

app.get('/admin/stats/dates', adminAuth, async (req, res) => {
  try { res.json(await getAvailableDates()) }
  catch (error) { res.status(500).json({ error: error.message }) }
})

app.get('/admin/clear-queue', async (req, res) => {
  await saveQueue([])
  res.json({ ok: true })
})

app.get('/admin/blocked', adminAuth, async (req, res) => {
  try { res.json(await getBlockedLog()) }
  catch (e) { res.status(500).json({ error: e.message }) }
})

app.delete('/admin/blocked/:videoId', adminAuth, async (req, res) => {
  try {
    const log = await getBlockedLog()
    await redis.set('blocked_log', log.filter(v => v.videoId !== req.params.videoId))
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.delete('/admin/blocked', adminAuth, async (req, res) => {
  try { await redis.set('blocked_log', []); res.json({ ok: true }) }
  catch (e) { res.status(500).json({ error: e.message }) }
})

// ─── ADMIN: PLAYLIST DE FONDO ────────────────────────────────────────────────

app.get('/admin/background-playlist', adminAuth, async (req, res) => {
  try {
    const id = await getBackgroundPlaylistId()
    res.json({ id })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/admin/background-playlist', adminAuth, async (req, res) => {
  try {
    const { id } = req.body
    if (id) {
      await redis.set('background_playlist_id', id)
    } else {
      await redis.del('background_playlist_id')
    }
    res.json({ ok: true, id: id || null })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ─── CLIENTE: VER PLAYLISTS Y CANCIONES ───────────────────────────────────────

app.get('/playlists', async (req, res) => {
  try {
    const all = await getPlaylists()
    res.json(all.filter(p => p.active !== false))
  }
  catch (error) { res.status(500).json({ error: error.message }) }
})

app.get('/playlists/:id/songs', async (req, res) => {
  try { res.json(await getPlaylistSongs(req.params.id)) }
  catch (error) { res.status(500).json({ error: error.message }) }
})

// ─── CLIENTE: PEDIR CANCIÓN ───────────────────────────────────────────────────

app.post('/request', async (req, res) => {
  const { videoId, title, thumbnail, clientId } = req.body

  console.log('Request recibido:', title)

  if (!videoId || !title) {
    return res.status(400).json({ error: 'Datos incompletos' })
  }

  const identifier = getIdentifier(req, clientId)
  const config = await getConfig()
  const LIMIT_MS = config.requestLimitMinutes * 60 * 1000
  const log = await getRequestLog()
  const now = Date.now()

  if (LIMIT_MS > 0 && log[identifier] && now - log[identifier] < LIMIT_MS) {
    const remaining = Math.ceil((LIMIT_MS - (now - log[identifier])) / 60000)
    return res.status(429).json({
      error: `⏳ Puedes pedir otra canción en ${remaining} minuto${remaining !== 1 ? 's' : ''}`
    })
  }

  try {
    const queue = await getQueue()
    queue.push({
      id: `req_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      videoId,
      title,
      thumbnail: thumbnail || null,
      requestedBy: identifier,
      approvedAt: Date.now()
    })
    await saveQueue(queue)
    await incrementDailyStat({ videoId, title, thumbnail })

    if (LIMIT_MS > 0) {
      log[identifier] = now
      await saveRequestLog(log)
    }

    res.json({ ok: true, message: '¡Canción agregada a la cola!' })
  } catch (error) {
    console.log('Error en /request:', error.message)
    res.status(500).json({ error: 'No se pudo enviar la solicitud' })
  }
})

// ─── PANTALLA ─────────────────────────────────────────────────────────────────

app.get('/screen/next', async (req, res) => {
  try {
    const queue = await getQueue()
    if (queue.length) return res.json(queue[0])
    const randomSong = await getRandomSongFromPlaylists()
    if (randomSong) return res.json({ ...randomSong, id: `auto_${Date.now()}`, auto: true })
    res.json({ empty: true })
  } catch (error) { res.json({ empty: true }) }
})

app.delete('/screen/played/:id', async (req, res) => {
  try {
    const queue = await getQueue()
    await saveQueue(queue.filter(v => v.id !== req.params.id))
    res.json({ ok: true })
  } catch (error) { res.status(500).json({ error: error.message }) }
})

app.post('/screen/report-error', async (req, res) => {
  try {
    const { videoId, title, thumbnail, errorCode } = req.body
    if (videoId && title) await logBlockedVideo(videoId, title, thumbnail, errorCode)
    res.json({ ok: true })
  } catch (e) { res.json({ ok: false }) }
})

app.get('/screen/queue', async (req, res) => {
  try { res.json(await getQueue()) }
  catch (error) { res.json([]) }
})

// ─── SERVIDOR ─────────────────────────────────────────────────────────────────

app.listen(process.env.PORT || 3000, '0.0.0.0', () => {
  console.log(`\n🎬 GranizadosMusic corriendo en http://localhost:${process.env.PORT || 3000}`)
  console.log(`Admin: http://localhost:${process.env.PORT || 3000}/admin.html\n`)
})