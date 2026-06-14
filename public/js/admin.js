// ─── INICIO ───────────────────────────────────────────────────────────────────
 
document.addEventListener('DOMContentLoaded', () => {
  init()
})
 
function init() {
  loadPlaylists()
  loadPending()
  loadQueue()
  loadStats()
 
  setInterval(loadPending, 10000)
  setInterval(loadQueue, 10000)
 
  // Buscar canciones con Enter
  document.getElementById('songSearchInput')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') searchSongs()
  })
}
 
// ─── BUSCAR Y AGREGAR CANCIÓN SUELTA A LA COLA ────────────────────────────────
 
async function searchSongs() {
  const q = document.getElementById('songSearchInput').value.trim()
  if (!q) return
 
  const el = document.getElementById('songSearchResults')
  el.innerHTML = '<p class="loading-msg">Buscando...</p>'
 
  try {
    const res = await fetch(`/search?q=${encodeURIComponent(q)}`)
    const videos = await res.json()
 
    if (!videos.length) {
      el.innerHTML = '<p class="empty-msg">No se encontraron resultados</p>'
      return
    }
 
    el.innerHTML = videos.map(v => `
      <div class="song-result">
        ${v.thumbnail ? `<img src="${v.thumbnail}" alt="${v.title}">` : '<div class="thumb-ph">♪</div>'}
        <div class="song-result-info">
          <div class="song-result-title">${v.title}</div>
          <div class="song-result-artist">${v.artist}</div>
        </div>
        <button class="btn-sm btn-approve" onclick="addToQueue('${v.videoId}', '${escAttr(v.title)}', '${v.thumbnail || ''}')">
          + Cola
        </button>
      </div>
    `).join('')
  } catch (e) {
    el.innerHTML = '<p class="empty-msg">Error buscando canciones</p>'
  }
}
 
async function addToQueue(videoId, title, thumbnail) {
  try {
    const res = await fetch('/admin/add-to-queue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoId, title, thumbnail })
    })
    const data = await res.json()
    if (data.ok) {
      showToast(`✅ "${title}" agregada a la cola`)
      loadQueue()
    } else {
      showToast(data.error, true)
    }
  } catch (e) {
    showToast('Error de conexión', true)
  }
}
 
// ─── PLAYLISTS ────────────────────────────────────────────────────────────────
 
async function loadPlaylists() {
  const res = await fetch('/admin/playlists')
  const playlists = await res.json()
  const el = document.getElementById('playlistsList')
 
  if (!playlists.length) {
    el.innerHTML = '<p class="empty-msg">No hay playlists. Agrega una arriba.</p>'
    return
  }
 
  el.innerHTML = playlists.map(pl => `
    <div class="playlist-row">
      <div class="pl-info">
        <div class="pl-name">${pl.name}</div>
        <div class="pl-meta">${pl.total} canciones</div>
      </div>
      <div class="pl-actions">
        <button class="btn-sm btn-ghost" onclick="reloadPlaylist('${pl.id}', '${pl.name}')">↺ Recargar</button>
        <button class="btn-sm btn-danger" onclick="deletePlaylist('${pl.id}', '${pl.name}')">✕</button>
      </div>
    </div>
  `).join('')
}
 
async function addPlaylist() {
  const url = document.getElementById('playlistUrl').value.trim()
  const name = document.getElementById('playlistName').value.trim()
 
  if (!url || !name) { showToast('Completa el link y el nombre', true); return }
 
  document.getElementById('loadProgress').style.display = 'block'
  document.querySelector('[onclick="addPlaylist()"]').disabled = true
 
  try {
    const res = await fetch('/admin/playlists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, name })
    })
    const data = await res.json()
 
    if (data.ok) {
      showToast(`✅ "${name}" cargada — ${data.total} canciones`)
      document.getElementById('playlistUrl').value = ''
      document.getElementById('playlistName').value = ''
      loadPlaylists()
    } else {
      showToast(data.error, true)
    }
  } catch (e) {
    showToast('Error de conexión', true)
  } finally {
    document.getElementById('loadProgress').style.display = 'none'
    document.querySelector('[onclick="addPlaylist()"]').disabled = false
  }
}
 
async function deletePlaylist(id, name) {
  if (!confirm(`¿Eliminar "${name}"?`)) return
  const res = await fetch(`/admin/playlists/${id}`, { method: 'DELETE' })
  const data = await res.json()
  if (data.ok) { showToast(`"${name}" eliminada`); loadPlaylists() }
}
 
async function reloadPlaylist(id, name) {
  showToast(`Recargando "${name}"...`)
  const res = await fetch(`/admin/playlists/${id}/reload`, { method: 'POST' })
  const data = await res.json()
  if (data.ok) { showToast(`✅ "${name}" actualizada — ${data.total} canciones`); loadPlaylists() }
  else showToast(data.error, true)
}
 
// ─── SOLICITUDES PENDIENTES ───────────────────────────────────────────────────
 
async function loadPending() {
  const res = await fetch('/admin/pending')
  const pending = await res.json()
 
  const badge = document.getElementById('pendingBadge')
  badge.textContent = pending.length
  badge.style.display = pending.length > 0 ? 'inline-flex' : 'none'
 
  const el = document.getElementById('pendingList')
  if (!pending.length) {
    el.innerHTML = '<p class="empty-msg">No hay solicitudes pendientes</p>'
    return
  }
 
  el.innerHTML = pending.map(p => `
    <div class="request-row" id="req-${p.id}">
      ${p.thumbnail ? `<img src="${p.thumbnail}" alt="${p.title}">` : '<div class="thumb-ph">♪</div>'}
      <div class="req-info">
        <div class="req-title">${p.title}</div>
        <div class="req-time">${timeAgo(p.timestamp)}</div>
      </div>
      <div class="req-actions">
        <button class="btn-sm btn-approve" onclick="approve('${p.id}', '${escAttr(p.title)}')">✓ Aprobar</button>
        <button class="btn-sm btn-danger" onclick="reject('${p.id}')">✕</button>
      </div>
    </div>
  `).join('')
}
 
async function approve(id, title) {
  const res = await fetch(`/admin/pending/${id}/approve`, { method: 'POST' })
  const data = await res.json()
  if (data.ok) { showToast(`✅ "${title}" agregada a la cola`); loadPending(); loadQueue(); loadStats() }
  else showToast(data.error, true)
}
 
async function reject(id) {
  const res = await fetch(`/admin/pending/${id}/reject`, { method: 'POST' })
  const data = await res.json()
  if (data.ok) {
    const card = document.getElementById(`req-${id}`)
    if (card) { card.style.opacity = '0'; card.style.transition = 'opacity 0.3s' }
    setTimeout(loadPending, 350)
  }
}
 
// ─── COLA ─────────────────────────────────────────────────────────────────────
 
async function loadQueue() {
  const res = await fetch('/admin/queue')
  const queue = await res.json()
 
  document.getElementById('queueBadge').textContent = queue.length
 
  const el = document.getElementById('queueList')
  if (!queue.length) {
    el.innerHTML = '<p class="empty-msg">La cola está vacía</p>'
    return
  }
 
  el.innerHTML = queue.map((v, i) => `
    <div class="queue-row">
      <div class="q-pos">${i + 1}</div>
      ${v.thumbnail ? `<img src="${v.thumbnail}" alt="${v.title}">` : '<div class="thumb-ph">♪</div>'}
      <div class="q-info">
        <div class="q-title">${v.title}</div>
      </div>
      <button class="btn-sm btn-danger" onclick="removeFromQueue('${v.id}')">✕</button>
    </div>
  `).join('')
}
 
async function removeFromQueue(id) {
  const res = await fetch(`/admin/queue/${id}`, { method: 'DELETE' })
  const data = await res.json()
  if (data.ok) loadQueue()
}
 
// ─── ESTADÍSTICAS ─────────────────────────────────────────────────────────────
 
async function loadStats() {
  const res = await fetch('/admin/stats')
  const { totalRequests, topVideos } = await res.json()
 
  document.getElementById('totalCount').textContent = totalRequests
 
  const el = document.getElementById('statsList')
  if (!topVideos.length) {
    el.innerHTML = '<p class="empty-msg">Aún no hay estadísticas</p>'
    return
  }
 
  const max = topVideos[0].count
  el.innerHTML = topVideos.map((v, i) => `
    <div class="stat-row">
      <div class="stat-rank">#${i + 1}</div>
      ${v.thumbnail ? `<img src="${v.thumbnail}" alt="${v.title}">` : '<div class="thumb-ph">♪</div>'}
      <div class="stat-info">
        <div class="stat-title">${v.title}</div>
        <div class="stat-bar-wrap">
          <div class="stat-bar" style="width:${Math.round((v.count / max) * 100)}%"></div>
        </div>
      </div>
      <div class="stat-count">${v.count}x</div>
    </div>
  `).join('')
}
 
// ─── UTILIDADES ───────────────────────────────────────────────────────────────
 
function showToast(msg, isError = false) {
  const el = document.getElementById('toast')
  el.textContent = msg
  el.className = 'toast show' + (isError ? ' error' : '')
  setTimeout(() => el.classList.remove('show'), 3000)
}
 
function escAttr(str) {
  return (str || '').replace(/'/g, "\\'")
}
 
function timeAgo(timestamp) {
  const diff = Date.now() - timestamp
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'hace un momento'
  if (mins < 60) return `hace ${mins} min`
  return `hace ${Math.floor(mins / 60)} h`
}