// ─── ESTADO ───────────────────────────────────────────────────────────────────

let allPlaylists = []
let songToAdd = null
let selectedForMerge = new Set()

// ─── INICIO ───────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  init()
  document.getElementById('songSearchInput')?.addEventListener('keydown', e => { if (e.key === 'Enter') searchSongs() })
  document.getElementById('playlistUrl')?.addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('playlistName').focus() })
  document.getElementById('playlistName')?.addEventListener('keydown', e => { if (e.key === 'Enter') addPlaylist() })
  document.getElementById('addToPlSearchInput')?.addEventListener('keydown', e => { if (e.key === 'Enter') searchForPlaylist() })
})

function init() {
  loadPlaylists()
  loadQueue()
  loadLimit()
  loadReports()
  loadBlocked()
  setInterval(loadQueue, 10000)
  setInterval(loadBlocked, 15000)
}

// ─── LÍMITE ENTRE PETICIONES ──────────────────────────────────────────────────

async function loadLimit() {
  try {
    const res = await fetch('/admin/request-limit')
    const { minutes } = await res.json()
    document.getElementById('limitInput').value = minutes
    document.getElementById('limitStatus').textContent =
      minutes === 0 ? 'Sin límite activo' : `Actualmente: ${minutes} min`
  } catch (e) {
    document.getElementById('limitStatus').textContent = 'Error cargando'
  }
}

async function saveLimit() {
  const minutes = parseInt(document.getElementById('limitInput').value)
  if (isNaN(minutes) || minutes < 0) { showToast('Valor inválido', true); return }
  const btn = document.querySelector('.btn-save')
  if (btn) { btn.disabled = true; btn.textContent = '...' }
  try {
    const res = await fetch('/admin/request-limit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ minutes })
    })
    let data
    try { data = await res.json() } catch { data = {} }
    if (res.ok && data.ok) {
      showToast(`✅ Límite: ${minutes === 0 ? 'sin límite' : minutes + ' minutos'}`)
      document.getElementById('limitStatus').textContent =
        minutes === 0 ? 'Sin límite activo' : `Actualmente: ${minutes} min`
    } else {
      showToast(data.error || `Error del servidor (${res.status})`, true)
    }
  } catch (e) {
    showToast('No se pudo conectar al servidor', true)
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Guardar' }
  }
}

// ─── BUSCAR CANCIÓN ───────────────────────────────────────────────────────────

async function searchSongs() {
  const q = document.getElementById('songSearchInput').value.trim()
  if (!q) return
  const el = document.getElementById('songSearchResults')
  el.innerHTML = '<p class="loading-msg">Buscando...</p>'
  try {
    const res = await fetch(`/search?q=${encodeURIComponent(q)}`)
    const videos = await res.json()
    if (!videos.length) { el.innerHTML = '<p class="empty-msg">Sin resultados</p>'; return }
    el.innerHTML = videos.map(v => `
      <div class="song-result">
        ${v.thumbnail ? `<img src="${v.thumbnail}" alt="">` : '<div class="thumb-ph">🎵</div>'}
        <div class="song-result-info">
          <div class="song-result-title">${v.title}</div>
          <div class="song-result-artist">${v.artist}</div>
        </div>
        <div style="display:flex;gap:5px;flex-shrink:0">
          <button class="btn-sm btn-add" onclick="addToQueue('${esc(v.videoId)}','${esc(v.title)}','${esc(v.thumbnail||'')}')">+ Cola</button>
          <button class="btn-sm btn-ghost" onclick="openAddToPlaylist('${esc(v.videoId)}','${esc(v.title)}','${esc(v.thumbnail||'')}')">+ Lista</button>
        </div>
      </div>
    `).join('')
  } catch (e) { el.innerHTML = '<p class="empty-msg">Error buscando 😵</p>' }
}

async function addToQueue(videoId, title, thumbnail) {
  try {
    const res = await fetch('/admin/add-to-queue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoId, title, thumbnail })
    })
    const data = await res.json()
    if (data.ok) { showToast(`🔥 "${title}" en cola`); loadQueue() }
    else showToast(data.error, true)
  } catch (e) { showToast('Error de conexión', true) }
}

// ─── MODAL: AGREGAR CANCIÓN A PLAYLIST ───────────────────────────────────────

function openAddToPlaylist(videoId, title, thumbnail) {
  songToAdd = { videoId, title, thumbnail }
  document.getElementById('addModalSongTitle').textContent = title
  document.getElementById('addToPlSearchInput').value = ''
  document.getElementById('addToPlResults').innerHTML = ''
  renderTargetPlaylists()
  document.getElementById('addToPlaylistModal').classList.add('open')
}

function closeAddModal() {
  document.getElementById('addToPlaylistModal').classList.remove('open')
  songToAdd = null
}

function renderTargetPlaylists() {
  const el = document.getElementById('targetPlaylists')
  if (!allPlaylists.length) { el.innerHTML = '<p class="empty-msg">No hay playlists</p>'; return }
  el.innerHTML = allPlaylists.map(pl => `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;background:var(--card2);border-radius:10px;margin-bottom:6px">
      <span style="font-size:.84rem;font-weight:700">${pl.name}</span>
      <button class="btn-sm btn-add" onclick="addSongToPlaylist('${pl.id}')">Agregar</button>
    </div>
  `).join('')
}

async function searchForPlaylist() {
  const q = document.getElementById('addToPlSearchInput').value.trim()
  if (!q) return
  const el = document.getElementById('addToPlResults')
  el.innerHTML = '<p class="loading-msg">Buscando...</p>'
  try {
    const res = await fetch(`/search?q=${encodeURIComponent(q)}`)
    const videos = await res.json()
    el.innerHTML = videos.slice(0, 5).map(v => `
      <div class="song-result">
        ${v.thumbnail ? `<img src="${v.thumbnail}" alt="" style="width:44px;height:33px">` : '<div class="thumb-ph" style="width:44px;height:33px">🎵</div>'}
        <div class="song-result-info"><div class="song-result-title">${v.title}</div></div>
        <button class="btn-sm btn-ghost" onclick="selectSongForPlaylist('${esc(v.videoId)}','${esc(v.title)}','${esc(v.thumbnail||'')}')">Elegir</button>
      </div>
    `).join('')
  } catch (e) { el.innerHTML = '<p class="empty-msg">Error</p>' }
}

function selectSongForPlaylist(videoId, title, thumbnail) {
  songToAdd = { videoId, title, thumbnail }
  document.getElementById('addModalSongTitle').textContent = title
  document.getElementById('addToPlResults').innerHTML = ''
  document.getElementById('addToPlSearchInput').value = ''
}

async function addSongToPlaylist(playlistId) {
  if (!songToAdd) return
  try {
    const res = await fetch(`/admin/playlists/${playlistId}/songs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(songToAdd)
    })
    const data = await res.json()
    if (data.ok) {
      showToast(`✅ "${songToAdd.title}" agregada`)
      closeAddModal()
      loadPlaylists()
    } else showToast(data.error, true)
  } catch (e) { showToast('Error de conexión', true) }
}

// Cerrar modales al click fuera
document.addEventListener('click', e => {
  const addModal = document.getElementById('addToPlaylistModal')
  if (e.target === addModal) closeAddModal()
  const mergeModal = document.getElementById('mergeModal')
  if (e.target === mergeModal) closeMergeModal()
})

// ─── PLAYLISTS ────────────────────────────────────────────────────────────────

async function loadPlaylists() {
  try {
    const res = await fetch('/admin/playlists')
    allPlaylists = await res.json()
    renderPlaylists(allPlaylists)
  } catch (e) {}
}

function filterPlaylists() {
  const q = document.getElementById('plSearchInput').value.toLowerCase().trim()
  renderPlaylists(q ? allPlaylists.filter(p => p.name.toLowerCase().includes(q)) : allPlaylists)
}

function renderPlaylists(playlists) {
  const el = document.getElementById('playlistsList')
  const emojis = ['🎵','🔥','⚡','💜','🧊','🎶','💥','✨']
  if (!playlists.length) { el.innerHTML = '<p class="empty-msg">No hay playlists. Agrega una arriba.</p>'; return }
  el.innerHTML = playlists.map((pl, i) => {
    const isActive = pl.active !== false
    const isChecked = selectedForMerge.has(pl.id)
    return `
      <div class="playlist-row ${isActive ? '' : 'inactive'} ${isChecked ? 'merge-selected' : ''}">
        <input type="checkbox" class="pl-checkbox" ${isChecked ? 'checked' : ''} onchange="toggleMergeSelect('${pl.id}', this.checked)" title="Seleccionar para combinar"/>
        <div class="pl-icon ${isActive ? '' : 'off'}">${emojis[i % emojis.length]}</div>
        <div class="pl-info">
          <div class="pl-name">${pl.name}</div>
          <div class="pl-meta">${pl.total} canciones · <span class="pl-status ${isActive ? 'on' : 'off'}">${isActive ? 'Activa' : 'Inactiva'}</span>${pl.merged ? ' · <span style="color:var(--purple2)">Fusionada</span>' : ''}</div>
        </div>
        <div class="pl-actions">
          <button class="btn-sm ${isActive ? 'btn-toggle-on' : 'btn-toggle-off'}" onclick="togglePlaylist('${pl.id}','${esc(pl.name)}')">${isActive ? '● ON' : '○ OFF'}</button>
          ${!pl.merged ? `<button class="btn-sm btn-ghost" onclick="reloadPlaylist('${pl.id}','${esc(pl.name)}')">↺</button>` : ''}
          <button class="btn-sm btn-ghost" onclick="openCoverModal('${pl.id}','${esc(pl.name)}')">🖼</button>
          <button class="btn-sm btn-danger" onclick="deletePlaylist('${pl.id}','${esc(pl.name)}')">✕</button>
        </div>
      </div>
    `
  }).join('')
  updateMergeFab()
}

function toggleMergeSelect(id, checked) {
  if (checked) selectedForMerge.add(id)
  else selectedForMerge.delete(id)
  updateMergeFab()
  renderPlaylists(allPlaylists.filter(p => {
    const q = document.getElementById('plSearchInput').value.toLowerCase().trim()
    return !q || p.name.toLowerCase().includes(q)
  }))
}

function updateMergeFab() {
  const fab = document.getElementById('mergeFab')
  const count = document.getElementById('mergeFabCount')
  if (selectedForMerge.size >= 2) {
    fab.style.display = 'block'
    count.textContent = selectedForMerge.size
  } else {
    fab.style.display = 'none'
  }
}

function openMergeModal() {
  const names = allPlaylists.filter(p => selectedForMerge.has(p.id)).map(p => p.name)
  document.getElementById('mergeModalSub').textContent = names.join(' + ')
  document.getElementById('mergeNameInput').value = names.join(' + ')
  document.getElementById('mergeModal').classList.add('open')
  setTimeout(() => document.getElementById('mergeNameInput').select(), 100)
}

function closeMergeModal() {
  document.getElementById('mergeModal').classList.remove('open')
}

async function confirmMerge() {
  const name = document.getElementById('mergeNameInput').value.trim()
  if (!name) { showToast('Ponle un nombre a la playlist', true); return }
  const ids = [...selectedForMerge]
  const btn = document.querySelector('#mergeModal .btn-primary')
  btn.disabled = true; btn.textContent = 'Combinando...'
  try {
    const res = await fetch('/admin/playlists/merge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, name })
    })
    const data = await res.json()
    if (data.ok) {
      showToast(`✅ "${name}" — ${data.total} canciones`)
      selectedForMerge.clear()
      closeMergeModal()
      loadPlaylists()
    } else showToast(data.error, true)
  } catch (e) { showToast('Error de conexión', true) }
  finally { btn.disabled = false; btn.textContent = 'Crear playlist combinada' }
}

async function togglePlaylist(id, name) {
  try {
    const res = await fetch(`/admin/playlists/${id}/toggle`, { method: 'POST' })
    const data = await res.json()
    if (data.ok) {
      showToast(`"${name}" ${data.active ? '✅ activada' : '⏸ desactivada'}`)
      loadPlaylists()
    } else showToast(data.error, true)
  } catch (e) { showToast('Error de conexión', true) }
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
      showToast(`✅ "${name}" — ${data.total} canciones`)
      document.getElementById('playlistUrl').value = ''
      document.getElementById('playlistName').value = ''
      loadPlaylists()
    } else showToast(data.error, true)
  } catch (e) { showToast('Error de conexión', true) }
  finally {
    document.getElementById('loadProgress').style.display = 'none'
    document.querySelector('[onclick="addPlaylist()"]').disabled = false
  }
}

async function deletePlaylist(id, name) {
  if (!confirm(`¿Eliminar "${name}"?`)) return
  try {
    const res = await fetch(`/admin/playlists/${id}`, { method: 'DELETE' })
    if ((await res.json()).ok) { showToast(`"${name}" eliminada`); loadPlaylists() }
  } catch (e) { showToast('Error de conexión', true) }
}

async function reloadPlaylist(id, name) {
  showToast(`Recargando "${name}"...`)
  try {
    const res = await fetch(`/admin/playlists/${id}/reload`, { method: 'POST' })
    const data = await res.json()
    if (data.ok) { showToast(`✅ "${name}" — ${data.total} canciones`); loadPlaylists() }
    else showToast(data.error, true)
  } catch (e) { showToast('Error de conexión', true) }
}

// ─── COLA ─────────────────────────────────────────────────────────────────────

async function loadQueue() {
  try {
    const res = await fetch('/admin/queue')
    const queue = await res.json()
    document.getElementById('queueBadge').textContent = queue.length
    const el = document.getElementById('queueList')
    if (!queue.length) { el.innerHTML = '<p class="empty-msg">La cola está vacía</p>'; return }
    el.innerHTML = queue.map((v, i) => `
      <div class="queue-row">
        <div class="q-pos">${i + 1}</div>
        ${v.thumbnail ? `<img src="${v.thumbnail}" alt="">` : '<div class="thumb-ph">🎵</div>'}
        <div class="q-info"><div class="q-title">${v.title}</div></div>
        <button class="btn-sm btn-danger" onclick="removeFromQueue('${v.id}')">✕</button>
      </div>
    `).join('')
  } catch (e) {}
}

async function removeFromQueue(id) {
  try {
    if ((await (await fetch(`/admin/queue/${id}`, { method: 'DELETE' })).json()).ok) loadQueue()
  } catch (e) {}
}

// ─── REPORTES DIARIOS ─────────────────────────────────────────────────────────

async function loadReports() {
  const el = document.getElementById('reportsList')
  el.innerHTML = '<p class="loading-msg">Cargando reportes...</p>'
  try {
    const res = await fetch('/admin/reports')
    const reports = await res.json()
    if (!reports.length) {
      el.innerHTML = '<p class="empty-msg">No hay reportes aún.</p>'
      return
    }
    el.innerHTML = reports.map(r => `
      <div class="report-row">
        <div class="report-date">📅 ${r.date}</div>
        <div class="report-total">${r.totalRequests} pedidos</div>
      </div>
    `).join('')
  } catch (e) {
    el.innerHTML = '<p class="empty-msg">Error cargando reportes</p>'
  }
}

// ─── VIDEOS BLOQUEADOS ───────────────────────────────────────────────────────

async function loadBlocked() {
  try {
    const res = await fetch('/admin/blocked')
    const blocked = await res.json()
    const badge = document.getElementById('blockedBadge')
    const clearBtn = document.getElementById('clearBlockedBtn')
    const el = document.getElementById('blockedList')

    if (blocked.length > 0) {
      badge.textContent = blocked.length
      badge.style.display = 'inline-flex'
      clearBtn.style.display = 'inline-flex'
    } else {
      badge.style.display = 'none'
      clearBtn.style.display = 'none'
      el.innerHTML = '<p class="empty-msg">No hay videos bloqueados registrados 🎉</p>'
      return
    }

    el.innerHTML = blocked.map(v => `
      <div class="request-row" id="blocked-${v.videoId}">
        ${v.thumbnail
          ? `<img src="${v.thumbnail}" alt="" style="width:52px;height:38px;border-radius:7px;object-fit:cover;border:1px solid var(--border);flex-shrink:0">`
          : '<div class="thumb-ph">🚫</div>'
        }
        <div class="req-info">
          <div class="req-title">${v.title}</div>
          <div class="req-time" style="display:flex;gap:8px;align-items:center">
            <span>${timeAgo(v.blockedAt)}</span>
            <a href="https://www.youtube.com/watch?v=${v.videoId}" target="_blank"
               style="color:var(--purple2);font-size:.68rem;font-weight:700;text-decoration:none">
              Ver en YouTube ↗
            </a>
          </div>
        </div>
        <button class="btn-sm btn-danger" onclick="removeBlocked('${v.videoId}')">✕</button>
      </div>
    `).join('')
  } catch (e) {}
}

async function removeBlocked(videoId) {
  try {
    await fetch(`/admin/blocked/${videoId}`, { method: 'DELETE' })
    const row = document.getElementById(`blocked-${videoId}`)
    if (row) { row.style.opacity = '0'; row.style.transition = 'opacity .3s' }
    setTimeout(loadBlocked, 350)
  } catch (e) { showToast('Error eliminando', true) }
}

async function clearBlocked() {
  if (!confirm('¿Limpiar todo el log de videos bloqueados?')) return
  try {
    await fetch('/admin/blocked', { method: 'DELETE' })
    showToast('Log limpiado')
    loadBlocked()
  } catch (e) { showToast('Error', true) }
}

// ─── UTILIDADES ───────────────────────────────────────────────────────────────

function showToast(msg, isError = false) {
  const el = document.getElementById('toast')
  el.textContent = msg
  el.className = 'toast show' + (isError ? ' error' : '')
  setTimeout(() => el.classList.remove('show'), 3000)
}

function esc(str) { return (str || '').replace(/'/g, "\\'") }

function timeAgo(ts) {
  const m = Math.floor((Date.now() - ts) / 60000)
  if (m < 1) return 'hace un momento'
  if (m < 60) return `hace ${m} min`
  return `hace ${Math.floor(m / 60)} h`
}
// ─── PORTADA DE PLAYLIST ──────────────────────────────────────────────────────

let coverPlaylistId = null

function openCoverModal(id, name) {
  coverPlaylistId = id
  document.getElementById('coverModalTitle').textContent = name
  document.getElementById('coverPasteArea').value = ''
  document.getElementById('coverPreview').style.display = 'none'
  document.getElementById('coverPreview').src = ''
  document.getElementById('coverModal').classList.add('open')
}

function closeCoverModal() {
  document.getElementById('coverModal').classList.remove('open')
  coverPlaylistId = null
}

function onCoverPaste(e) {
  const text = e.target.value.trim()
  if (!text) return
  const preview = document.getElementById('coverPreview')
  preview.src = text
  preview.style.display = 'block'
  preview.onerror = () => { preview.style.display = 'none'; showToast('URL de imagen inválida', true) }
}

async function saveCover() {
  if (!coverPlaylistId) return
  const url = document.getElementById('coverPasteArea').value.trim()
  if (!url) { showToast('Pega una URL de imagen primero', true); return }
  try {
    const res = await fetch(`/admin/playlists/${coverPlaylistId}/cover`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cover: url })
    })
    const data = await res.json()
    if (data.ok) {
      showToast('✅ Portada guardada')
      closeCoverModal()
      loadPlaylists()
    } else showToast(data.error, true)
  } catch (e) { showToast('Error de conexión', true) }
}