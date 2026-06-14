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
 
async function getVideoStats() {
  try { const saved = await redis.get('video_stats'); return saved || {} } catch (e) { return {} }
}
 
async function incrementVideoStat(video) {
  try {
    const stats = await getVideoStats()
    if (stats[video.videoId]) {
      stats[video.videoId].count += 1
    } else {
      stats[video.videoId] = { title: video.title, thumbnail: video.thumbnail, count: 1 }
    }
    await redis.set('video_stats', stats)
  } catch (e) {}
}
 
// ─── AUTO PLAYLIST ────────────────────────────────────────────────────────────
// Cuando la cola está vacía, la pantalla puede pedir un video aleatorio
// de las playlists disponibles para que nunca haya silencio.
 
async function getRandomSongFromPlaylists() {
  try {
    const playlists = await getPlaylists()
    if (!playlists.length) return null
 
    // Escoger una playlist aleatoria
    const playlist = playlists[Math.floor(Math.random() * playlists.length)]
    const songs = await getPlaylistSongs(playlist.id)
    if (!songs.length) return null
 
    // Escoger una canción aleatoria de esa playlist
    const song = songs[Math.floor(Math.random() * songs.length)]
    return { ...song, playlistName: playlist.name }
  } catch (e) {
    return null
  }
}
 
// ─── IDENTIFICADOR DE CLIENTE ─────────────────────────────────────────────────
 
function getIdentifier(req, clientId) {
  return clientId || req.headers['x-forwarded-for'] || req.socket.remoteAddress
}
 
// ─── ADMIN: autenticación desactivada ─────────────────────────────────────────
 
function adminAuth(req, res, next) {
  next()
}
 
// ─── YOUTUBE: BUSCAR VIDEOS ───────────────────────────────────────────────────
 
app.get('/search', async (req, res) => {
  const { q } = req.query
  if (!q) return res.status(400).json({ error: 'Falta el término de búsqueda' })
 
  try {
    const response = await axios.get('https://www.googleapis.com/youtube/v3/search', {
      params: {
        part: 'snippet',
        q,
        type: 'video',
        maxResults: 10,
        videoCategoryId: '10',
        key: process.env.YOUTUBE_API_KEY
      }
    })
 
    const videos = response.data.items.map(item => ({
      videoId: item.id.videoId,
      title: item.snippet.title,
      artist: item.snippet.channelTitle,
      thumbnail: item.snippet.thumbnails.medium?.url
    }))
 
    res.json(videos)
  } catch (error) {
    res.status(500).json({ error: 'Error buscando en YouTube' })
  }
})
 
// ─── YOUTUBE: CARGAR PLAYLIST COMPLETA ───────────────────────────────────────
 
async function fetchYoutubePlaylist(playlistId) {
  let songs = []
  let pageToken = null
 
  do {
    const params = {
      part: 'snippet',
      playlistId,
      maxResults: 50,
      key: process.env.YOUTUBE_API_KEY
    }
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
 
  return songs
}
 
// ─── ADMIN: PLAYLISTS ─────────────────────────────────────────────────────────
 
app.get('/admin/playlists', adminAuth, async (req, res) => {
  try { res.json(await getPlaylists()) }
  catch (error) { res.status(500).json({ error: error.message }) }
})
 
app.post('/admin/playlists', adminAuth, async (req, res) => {
  const { url, name } = req.body
  if (!url || !name) return res.status(400).json({ error: 'Faltan url y nombre' })
 
  let playlistId = url
  const match = url.match(/[?&]list=([^&]+)/)
  if (match) playlistId = match[1]
 
  try {
    const songs = await fetchYoutubePlaylist(playlistId)
    if (!songs.length) return res.status(400).json({ error: 'No se encontraron videos en esa playlist' })
 
    const playlists = await getPlaylists()
    const exists = playlists.find(p => p.youtubeId === playlistId)
    if (exists) return res.status(400).json({ error: 'Esa playlist ya está agregada' })
 
    const id = `pl_${Date.now()}`
    playlists.push({ id, youtubeId: playlistId, name, total: songs.length, createdAt: Date.now() })
    await savePlaylists(playlists)
    await savePlaylistSongs(id, songs)
 
    res.json({ ok: true, name, total: songs.length })
  } catch (error) {
    res.status(500).json({ error: 'No se pudo cargar la playlist. Verifica que sea pública.' })
  }
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
 
// ─── ADMIN: AGREGAR CANCIÓN DIRECTO A LA COLA ─────────────────────────────────
// El admin puede buscar cualquier canción y agregarla directamente a la cola
// sin que pase por el flujo de solicitudes de los clientes.
 
app.post('/admin/add-to-queue', adminAuth, async (req, res) => {
  const { videoId, title, thumbnail } = req.body
  if (!videoId || !title) return res.status(400).json({ error: 'Datos incompletos' })
 
  try {
    const queue = await getQueue()
    queue.push({
      id: `admin_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      videoId,
      title,
      thumbnail: thumbnail || null,
      requestedBy: 'admin',
      approvedAt: Date.now()
    })
    await saveQueue(queue)
    await incrementVideoStat({ videoId, title, thumbnail })
    res.json({ ok: true })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
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
    queue.push({
      id: request.id,
      videoId: request.videoId,
      title: request.title,
      thumbnail: request.thumbnail,
      requestedBy: request.clientId,
      approvedAt: Date.now()
    })
    await saveQueue(queue)
    await incrementVideoStat(request)
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
 
app.get('/admin/stats', adminAuth, async (req, res) => {
  try {
    const stats = await getVideoStats()
    const videos = Object.values(stats)
    const totalRequests = videos.reduce((acc, v) => acc + v.count, 0)
    const topVideos = videos.sort((a, b) => b.count - a.count).slice(0, 10)
    res.json({ totalRequests, topVideos })
  } catch (error) { res.status(500).json({ error: error.message }) }
})
 
app.get('/admin/clear-queue', async (req, res) => {
  await saveQueue([])
  res.json({ ok: true })
})
 
// ─── CLIENTE: VER PLAYLISTS Y CANCIONES ───────────────────────────────────────
 
app.get('/playlists', async (req, res) => {
  try { res.json(await getPlaylists()) }
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
 
  try {
    let finalVideoId = videoId
    let finalThumbnail = thumbnail
 
    // Buscar el video oficial en YouTube
    try {
      const searchRes = await axios.get('https://www.googleapis.com/youtube/v3/search', {
        params: {
          part: 'snippet',
          q: `${title} official video`,
          type: 'video',
          maxResults: 1,
          key: process.env.YOUTUBE_API_KEY
        }
      })
 
      const results = searchRes.data.items
      if (results && results.length > 0) {
        finalVideoId = results[0].id.videoId
        finalThumbnail = results[0].snippet.thumbnails.medium?.url
        console.log('Video oficial encontrado:', results[0].snippet.title)
      }
    } catch (searchErr) {
      console.log('Búsqueda fallida, usando video original:', searchErr.message)
    }
 
    const queue = await getQueue()
    queue.push({
      id: `req_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      videoId: finalVideoId,
      title,
      thumbnail: finalThumbnail || null,
      requestedBy: identifier,
      approvedAt: Date.now()
    })
    await saveQueue(queue)
    await incrementVideoStat({ videoId: finalVideoId, title, thumbnail: finalThumbnail })
 
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
 
    // Cola vacía — devolver una canción aleatoria de las playlists
    const randomSong = await getRandomSongFromPlaylists()
    if (randomSong) {
      return res.json({ ...randomSong, id: `auto_${Date.now()}`, auto: true })
    }
 
    res.json({ empty: true })
  } catch (error) {
    res.json({ empty: true })
  }
})
 
app.delete('/screen/played/:id', async (req, res) => {
  try {
    const queue = await getQueue()
    // Solo eliminar de la cola si es un video pedido (no auto)
    // Los videos auto no están en la cola así que no hay nada que eliminar
    await saveQueue(queue.filter(v => v.id !== req.params.id))
    res.json({ ok: true })
  } catch (error) { res.status(500).json({ error: error.message }) }
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