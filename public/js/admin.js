// ─── ESTADO ───────────────────────────────────────────────────────────────────

let allPlaylists    = []
let songToAdd       = null
let selectedForMerge = new Set()
let reportOpen      = false

// ─── INICIO ───────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  init()
  // Atajos de teclado para los inputs principales
  document.getElementById('songSearchInput')?.addEventListener('keydown', e => { if (e.key === 'Enter') searchSongs() })
  document.getElementById('songUrlInput')?.addEventListener('keydown',   e => { if (e.key === 'Enter') loadFromUrl() })
  document.getElementById('playlistUrl')?.addEventListener('keydown',    e => { if (e.key === 'Enter') document.getElementById('playlistName').focus() })
  document.getElementById('playlistName')?.addEventListener('keydown',   e => { if (e.key === 'Enter') document.getElementById('playlistCoverUrl').focus() })
  document.getElementById('addToPlSearchInput')?.addEventListener('keydown', e => { if (e.key === 'Enter') searchForPlaylist() })
})

function init() {
  loadPlaylists()
  loadQueue()
  loadLimit()
  loadReports()
  loadBgPlaylist()
  loadBlocked()
  setInterval(loadQueue,   10000)
  setInterval(loadBlocked, 15000)
}

// ─── TAB PLAYLISTS / BUSCAR CANCIÓN ──────────────────────────────────────────

function switchPlTab(tab) {
  const isPlaylists = tab === 'playlists'
  document.getElementById('panelPlaylists').style.display  = isPlaylists ? '' : 'none'
  document.getElementById('panelSongSearch').style.display = isPlaylists ? 'none' : ''
  document.getElementById('tabPlaylists').className  = 'tab-btn' + (isPlaylists ? ' active' : '')
  document.getElementById('tabSongSearch').className = 'tab-btn' + (isPlaylists ? '' : ' active')
  if (!isPlaylists) {
    setTimeout(() => document.getElementById('plSongSearchInput').focus(), 50)
  }
}

// ─── BUSCAR CANCIÓN EN TODAS LAS PLAYLISTS ────────────────────────────────────

let _songSearchTimer = null

function searchSongsInPlaylists() {
  clearTimeout(_songSearchTimer)
  const q = document.getElementById('plSongSearchInput').value.trim()
  const el = document.getElementById('plSongSearchResults')

  if (!q) {
    el.innerHTML = '<p class="empty-msg" style="padding:14px 0">Escribe para buscar...</p>'
    return
  }

  el.innerHTML = '<p class="loading-msg" style="padding:14px 0">Buscando...</p>'

  _songSearchTimer = setTimeout(async () => {
    try {
      const norm = q.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      const results = []

      for (const pl of allPlaylists) {
        const res   = await fetch(`/playlists/${pl.id}/songs`)
        const songs = await res.json()
        for (const s of songs) {
          const title = s.title.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
          if (title.includes(norm)) {
            results.push({ ...s, playlistId: pl.id, playlistName: pl.name })
          }
        }
      }

      if (!results.length) {
        el.innerHTML = '<p class="empty-msg" style="padding:14px 0">No se encontraron canciones</p>'
        return
      }

      el.innerHTML = results.map(r => `
        <div class="songs-modal-item" id="psr-${r.playlistId}-${r.videoId}">
          ${r.thumbnail
            ? `<img src="${r.thumbnail}" alt="" class="smi-thumb">`
            : '<div class="smi-thumb smi-thumb-ph">🎵</div>'
          }
          <div class="smi-info">
            <div class="smi-title">${r.title}</div>
            <div class="smi-id">📂 ${r.playlistName}</div>
          </div>
          <button class="btn-sm btn-danger smi-del"
            onclick="deleteSongFromPlaylistInline('${esc(r.playlistId)}','${esc(r.videoId)}','${esc(r.title)}')"
            title="Eliminar de la playlist">✕</button>
        </div>
      `).join('')
    } catch (e) {
      el.innerHTML = '<p class="empty-msg" style="padding:14px 0">Error al buscar</p>'
    }
  }, 400)
}

async function deleteSongFromPlaylistInline(playlistId, videoId, title) {
  if (!confirm(`¿Eliminar "${title}" de la playlist?`)) return
  try {
    const res  = await fetch(`/admin/playlists/${playlistId}/songs/${videoId}`, { method: 'DELETE' })
    const data = await res.json()
    if (data.ok) {
      showToast(`"${title}" eliminada`)
      document.getElementById(`psr-${playlistId}-${videoId}`)?.remove()
      const el = document.getElementById('plSongSearchResults')
      if (!el.children.length) {
        el.innerHTML = '<p class="empty-msg" style="padding:14px 0">No se encontraron canciones</p>'
      }
      loadPlaylists()
    } else {
      showToast(data.error || 'Error eliminando', true)
    }
  } catch (e) { showToast('Error de conexión', true) }
}

// ─── TAB BUSCAR / URL ─────────────────────────────────────────────────────────

function switchAddTab(tab) {
  const isSearch = tab === 'search'
  document.getElementById('panelSearch').style.display = isSearch ? '' : 'none'
  document.getElementById('panelUrl').style.display    = isSearch ? 'none' : ''
  document.getElementById('tabSearch').className = 'tab-btn' + (isSearch ? ' active' : '')
  document.getElementById('tabUrl').className    = 'tab-btn' + (isSearch ? '' : ' active')
  document.getElementById('urlPreview').classList.remove('show')
  const errEl = document.getElementById('urlError')
  if (errEl) errEl.style.display = 'none'
}

// ─── IMAGEN EN CREACIÓN DE PLAYLIST ──────────────────────────────────────────

function onNewPlaylistCoverInput(input) {
  const url  = input.value.trim()
  const wrap = document.getElementById('newCoverPreviewWrap')
  const img  = document.getElementById('newCoverPreviewImg')
  if (!url) { wrap.classList.remove('show'); return }
  img.src = url
  img.onload  = () => wrap.classList.add('show')
  img.onerror = () => { wrap.classList.remove('show') }
}

function clearNewCover() {
  document.getElementById('playlistCoverUrl').value = ''
  document.getElementById('newCoverPreviewWrap').classList.remove('show')
  document.getElementById('newCoverPreviewImg').src = ''
}

// ─── URL DE YOUTUBE ───────────────────────────────────────────────────────────

function extractVideoId(input) {
  input = (input || '').trim()
  const short = input.match(/youtu\.be\/([A-Za-z0-9_-]{11})/)
  if (short) return short[1]
  const long  = input.match(/[?&]v=([A-Za-z0-9_-]{11})/)
  if (long)  return long[1]
  const embed = input.match(/\/(?:embed|v)\/([A-Za-z0-9_-]{11})/)
  if (embed) return embed[1]
  if (/^[A-Za-z0-9_-]{11}$/.test(input)) return input
  return null
}

let urlSong = null

async function loadFromUrl() {
  const input   = document.getElementById('songUrlInput').value
  const preview = document.getElementById('urlPreview')
  const errEl   = document.getElementById('urlError')
  preview.classList.remove('show')
  errEl.style.display = 'none'
  urlSong = null

  const videoId = extractVideoId(input)
  if (!videoId) {
    errEl.textContent    = 'URL o ID de YouTube no válido'
    errEl.style.display  = 'block'
    return
  }

  const btn = document.querySelector('[onclick="loadFromUrl()"]')
  if (btn) { btn.disabled = true; btn.textContent = '...' }

  try {
    const res  = await fetch(`/admin/song-info?videoId=${videoId}`)
    const data = await res.json()
    if (!res.ok || data.error) {
      errEl.textContent   = data.error || 'No se pudo obtener información del video'
      errEl.style.display = 'block'
      return
    }
    urlSong = { videoId, title: data.title, thumbnail: data.thumbnail }
    document.getElementById('urlThumb').src       = data.thumbnail || ''
    document.getElementById('urlTitle').textContent   = data.title
    document.getElementById('urlVideoId').textContent = `ID: ${videoId}`
    preview.classList.add('show')
  } catch (e) {
    errEl.textContent   = 'Error de conexión'
    errEl.style.display = 'block'
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Cargar' }
  }
}

async function addUrlToQueue() {
  if (!urlSong) return
  await addToQueue(urlSong.videoId, urlSong.title, urlSong.thumbnail)
  document.getElementById('songUrlInput').value = ''
  document.getElementById('urlPreview').classList.remove('show')
  urlSong = null
}

function addUrlToPlaylist() {
  if (!urlSong) return
  openAddToPlaylist(urlSong.videoId, urlSong.title, urlSong.thumbnail)
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
  const btn = document.querySelector('[onclick="saveLimit()"]')
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
  const q  = document.getElementById('songSearchInput').value.trim()
  if (!q) return
  const el = document.getElementById('songSearchResults')
  el.innerHTML = '<p class="loading-msg">Buscando...</p>'
  try {
    const res    = await fetch(`/search?q=${encodeURIComponent(q)}`)
    const videos = await res.json()
    if (!videos.length) { el.innerHTML = '<p class="empty-msg">Sin resultados</p>'; return }
    el.innerHTML = videos.map(v => `
      <div class="song-result">
        ${v.thumbnail
          ? `<img src="${v.thumbnail}" alt="">`
          : '<div class="thumb-ph">🎵</div>'
        }
        <div class="song-result-info">
          <div class="song-result-title">${v.title}</div>
          <div class="song-result-artist">${v.artist || ''}</div>
        </div>
        <div class="song-result-actions">
          <button class="btn-sm btn-add"   onclick="addToQueue('${esc(v.videoId)}','${esc(v.title)}','${esc(v.thumbnail||'')}')">+ Cola</button>
          <button class="btn-sm btn-ghost" onclick="openAddToPlaylist('${esc(v.videoId)}','${esc(v.title)}','${esc(v.thumbnail||'')}')">+ Lista</button>
        </div>
      </div>
    `).join('')
  } catch (e) { el.innerHTML = '<p class="empty-msg">Error al buscar 😵</p>' }
}

async function addToQueue(videoId, title, thumbnail) {
  try {
    const res  = await fetch('/admin/add-to-queue', {
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
    <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;background:var(--card2);border-radius:8px;margin-bottom:6px">
      <span style="font-size:.8rem;font-weight:700">${pl.name}</span>
      <button class="btn-sm btn-add" onclick="addSongToPlaylist('${pl.id}')">Agregar</button>
    </div>
  `).join('')
}

async function searchForPlaylist() {
  const q  = document.getElementById('addToPlSearchInput').value.trim()
  if (!q) return
  const el = document.getElementById('addToPlResults')
  el.innerHTML = '<p class="loading-msg">Buscando...</p>'
  try {
    const res    = await fetch(`/search?q=${encodeURIComponent(q)}`)
    const videos = await res.json()
    el.innerHTML = videos.slice(0, 5).map(v => `
      <div class="song-result">
        ${v.thumbnail
          ? `<img src="${v.thumbnail}" alt="" style="width:44px;height:32px">`
          : '<div class="thumb-ph" style="width:44px;height:32px">🎵</div>'
        }
        <div class="song-result-info">
          <div class="song-result-title">${v.title}</div>
        </div>
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
    const res  = await fetch(`/admin/playlists/${playlistId}/songs`, {
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
  if (e.target === document.getElementById('addToPlaylistModal')) closeAddModal()
  if (e.target === document.getElementById('mergeModal'))         closeMergeModal()
})

// ─── PLAYLIST DE FONDO ────────────────────────────────────────────────────────

async function loadBgPlaylist() {
  try {
    const [resPlaylists, resBg] = await Promise.all([
      fetch('/admin/playlists'),
      fetch('/admin/background-playlist')
    ])
    const playlists = await resPlaylists.json()
    const { id: currentId } = await resBg.json()

    const select = document.getElementById('bgPlaylistSelect')
    select.innerHTML = '<option value="">— Aleatoria entre activas —</option>'
    playlists.filter(p => p.active !== false).forEach(pl => {
      const opt = document.createElement('option')
      opt.value = pl.id
      opt.textContent = pl.name
      if (pl.id === currentId) opt.selected = true
      select.appendChild(opt)
    })

    const current = playlists.find(p => p.id === currentId)
    document.getElementById('bgPlaylistStatus').textContent = current
      ? `Actualmente: ${current.name}`
      : 'Sin playlist fija (aleatoria)'
  } catch (e) {
    document.getElementById('bgPlaylistStatus').textContent = 'Error cargando'
  }
}

async function saveBgPlaylist() {
  const id  = document.getElementById('bgPlaylistSelect').value
  const btn = document.querySelector('[onclick="saveBgPlaylist()"]')
  if (btn) { btn.disabled = true; btn.textContent = '...' }
  try {
    const res  = await fetch('/admin/background-playlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: id || null })
    })
    const data = await res.json()
    if (data.ok) {
      const select = document.getElementById('bgPlaylistSelect')
      const name   = select.options[select.selectedIndex].textContent
      showToast(id ? `✅ Fondo: ${name}` : '✅ Fondo: aleatoria')
      document.getElementById('bgPlaylistStatus').textContent = id
        ? `Actualmente: ${name}`
        : 'Sin playlist fija (aleatoria)'
    } else showToast(data.error, true)
  } catch (e) {
    showToast('Error de conexión', true)
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Guardar' }
  }
}

// ─── PLAYLISTS ────────────────────────────────────────────────────────────────

async function loadPlaylists() {
  try {
    const res = await fetch('/admin/playlists')
    allPlaylists = await res.json()
    renderPlaylists(allPlaylists)
    document.getElementById('playlistBadge').textContent = allPlaylists.length
    loadBgPlaylist()
  } catch (e) {}
}

function filterPlaylists() {
  const q = document.getElementById('plSearchInput').value.toLowerCase().trim()
  renderPlaylists(q ? allPlaylists.filter(p => p.name.toLowerCase().includes(q)) : allPlaylists)
}

function renderPlaylists(playlists) {
  const el     = document.getElementById('playlistsList')
  const emojis = ['🎵','🔥','⚡','💜','🧊','🎶','💥','✨']

  if (!playlists.length) {
    el.innerHTML = '<p class="empty-msg">No hay playlists. Agrega una arriba.</p>'
    return
  }

  el.innerHTML = '<div class="playlist-list">' + playlists.map((pl, i) => {
    const isActive  = pl.active !== false
    const isChecked = selectedForMerge.has(pl.id)
    const coverEl   = pl.cover
      ? `<img class="pl-cover" src="${pl.cover}" alt="" onerror="this.replaceWith(makeCoverPh('${emojis[i % emojis.length]}','${isActive ? '' : 'off'}'))">`
      : `<div class="pl-cover-ph ${isActive ? '' : 'off'}">${emojis[i % emojis.length]}</div>`

    return `
      <div class="playlist-row ${isActive ? '' : 'inactive'} ${isChecked ? 'merge-selected' : ''}">
        <input type="checkbox" class="pl-checkbox" ${isChecked ? 'checked' : ''}
          onchange="toggleMergeSelect('${pl.id}', this.checked)"
          title="Seleccionar para combinar"/>
        <div class="pl-cover-wrap" onclick="openCoverModal('${pl.id}','${esc(pl.cover||'')}')" title="Cambiar imagen de portada">
          ${coverEl}
          <div class="pl-cover-edit-hint">✏️</div>
        </div>
        <div class="pl-info">
          <div class="pl-name">${pl.name}</div>
          <div class="pl-meta">
            ${pl.total} canciones
            <span>·</span>
            <span class="pl-status ${isActive ? 'on' : 'off'}">${isActive ? 'Activa' : 'Inactiva'}</span>
            ${pl.merged ? '<span>·</span><span style="color:var(--purple3)">Fusionada</span>' : ''}
          </div>
        </div>
        <div class="pl-actions">
          <button class="btn-sm ${isActive ? 'btn-toggle-on' : 'btn-toggle-off'}"
            onclick="togglePlaylist('${pl.id}','${esc(pl.name)}')">${isActive ? '● ON' : '○ OFF'}</button>
          <button class="btn-sm btn-ghost" title="Ver y eliminar canciones"
            onclick="openSongsModal('${pl.id}','${esc(pl.name)}',${pl.total})">🎵</button>
          <button class="btn-sm btn-danger"
            onclick="deletePlaylist('${pl.id}','${esc(pl.name)}')">✕</button>
        </div>
      </div>
    `
  }).join('') + '</div>'

  updateMergeFab()
}

// Helper para reemplazar cover con placeholder si la imagen falla
function makeCoverPh(emoji, cls) {
  const div = document.createElement('div')
  div.className = `pl-cover-ph ${cls}`
  div.textContent = emoji
  return div
}

// ─── MERGE ────────────────────────────────────────────────────────────────────

function toggleMergeSelect(id, checked) {
  if (checked) selectedForMerge.add(id)
  else         selectedForMerge.delete(id)
  updateMergeFab()
  const q = document.getElementById('plSearchInput').value.toLowerCase().trim()
  renderPlaylists(q ? allPlaylists.filter(p => p.name.toLowerCase().includes(q)) : allPlaylists)
}

function updateMergeFab() {
  const fab = document.getElementById('mergeFab')
  document.getElementById('mergeFabCount').textContent = selectedForMerge.size
  fab.style.display = selectedForMerge.size >= 2 ? 'block' : 'none'
}

function openMergeModal() {
  const names = allPlaylists.filter(p => selectedForMerge.has(p.id)).map(p => p.name)
  document.getElementById('mergeModalSub').textContent  = names.join(' + ')
  document.getElementById('mergeNameInput').value       = names.join(' + ')
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
    const res  = await fetch('/admin/playlists/merge', {
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
    const res  = await fetch(`/admin/playlists/${id}/toggle`, { method: 'POST' })
    const data = await res.json()
    if (data.ok) {
      showToast(`"${name}" ${data.active ? '✅ activada' : '⏸ desactivada'}`)
      loadPlaylists()
    } else showToast(data.error, true)
  } catch (e) { showToast('Error de conexión', true) }
}

async function deletePlaylist(id, name) {
  if (!confirm(`¿Eliminar "${name}"?`)) return
  try {
    const res = await fetch(`/admin/playlists/${id}`, { method: 'DELETE' })
    if ((await res.json()).ok) { showToast(`"${name}" eliminada`); loadPlaylists() }
  } catch (e) { showToast('Error de conexión', true) }
}

// ─── AGREGAR PLAYLIST ─────────────────────────────────────────────────────────

async function addPlaylist() {
  const url   = document.getElementById('playlistUrl').value.trim()
  const name  = document.getElementById('playlistName').value.trim()
  const cover = document.getElementById('playlistCoverUrl').value.trim()

  if (!url || !name) { showToast('Completa el link y el nombre', true); return }

  document.getElementById('loadProgress').style.display = 'block'
  document.querySelector('[onclick="addPlaylist()"]').disabled = true

  try {
    const res  = await fetch('/admin/playlists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Enviamos cover junto con url y name para guardarlo al crear
      body: JSON.stringify({ url, name, cover: cover || null })
    })
    const data = await res.json()
    if (data.ok) {
      showToast(`✅ "${name}" — ${data.total} canciones`)
      document.getElementById('playlistUrl').value     = ''
      document.getElementById('playlistName').value    = ''
      clearNewCover()
      loadPlaylists()
    } else showToast(data.error, true)
  } catch (e) { showToast('Error de conexión', true) }
  finally {
    document.getElementById('loadProgress').style.display = 'none'
    document.querySelector('[onclick="addPlaylist()"]').disabled = false
  }
}

// ─── REPORTE DIARIO (collapsable, solo peticiones de usuarios) ───────────────
//
// NOTA PARA EL BACKEND:
// El endpoint /admin/reports debe devolver únicamente las canciones solicitadas
// por usuarios vía POST /request. Las canciones añadidas manualmente por el
// admin vía /admin/add-to-queue NO deben contabilizarse en estos reportes.
// Cada objeto del array debe tener: { date: "2024-01-15", totalRequests: 42 }

function toggleReport() {
  reportOpen = !reportOpen
  const btn   = document.getElementById('reportToggleBtn')
  const panel = document.getElementById('reportPanel')
  btn.classList.toggle('open', reportOpen)
  panel.classList.toggle('open', reportOpen)
}

async function loadReports() {
  const el = document.getElementById('reportsList')
  el.innerHTML = '<p class="loading-msg">Cargando...</p>'
  try {
    const res     = await fetch('/admin/reports')
    const reports = await res.json()

    const badge = document.getElementById('reportBadge')
    if (reports.length) {
      badge.textContent    = reports.length
      badge.style.display  = 'inline-flex'
    } else {
      badge.style.display = 'none'
    }

    if (!reports.length) {
      el.innerHTML = '<p class="empty-msg">No hay reportes aún.</p>'
      return
    }

    el.innerHTML = reports.map(r => `
      <div class="stat-row">
        <div class="stat-date">📅 ${r.date}</div>
        <div>
          <span class="stat-count">${r.totalRequests}</span>
          <span class="stat-label">pedidos</span>
        </div>
      </div>
    `).join('')
  } catch (e) {
    el.innerHTML = '<p class="empty-msg">Error cargando reportes</p>'
  }
}

// ─── VIDEOS BLOQUEADOS ────────────────────────────────────────────────────────

async function loadBlocked() {
  try {
    const res  = await fetch('/admin/blocked')
    const list = await res.json()

    const badge    = document.getElementById('blockedBadge')
    const clearBtn = document.getElementById('clearBlockedBtn')
    const el       = document.getElementById('blockedList')

    if (!list.length) {
      badge.style.display    = 'none'
      clearBtn.style.display = 'none'
      el.innerHTML = '<p class="empty-msg">No hay videos con problemas 🎉</p>'
      return
    }

    badge.textContent      = list.length
    badge.style.display    = 'inline-flex'
    clearBtn.style.display = 'inline-flex'

    el.innerHTML = list.map(v => `
      <div class="blocked-item">
        ${v.thumbnail
          ? `<img src="${v.thumbnail}" alt="" style="width:52px;height:37px;border-radius:6px;object-fit:cover;flex-shrink:0;border:1px solid var(--border)">`
          : '<div class="q-thumb-ph" style="width:52px;height:37px">🎵</div>'
        }
        <div style="flex:1;min-width:0">
          <div class="blocked-title">${v.title}</div>
          <div class="blocked-meta">
            ${v.videoId}${v.errorCode != null ? ` · código ${v.errorCode}` : ''} · ${timeAgo(v.blockedAt)}
          </div>
        </div>
        <div style="display:flex;gap:5px;flex-shrink:0">
          <button class="btn-sm btn-ghost" title="Abrir en YouTube"
            onclick="window.open('https://www.youtube.com/watch?v=${v.videoId}','_blank')">▶</button>
          <button class="btn-sm btn-danger" onclick="removeBlocked('${v.videoId}')">✕</button>
        </div>
      </div>
    `).join('')
  } catch (e) {}
}

async function removeBlocked(videoId) {
  try { await fetch(`/admin/blocked/${videoId}`, { method: 'DELETE' }); loadBlocked() } catch (e) {}
}

async function clearBlocked() {
  if (!confirm('¿Limpiar todos los videos con problemas?')) return
  try { await fetch('/admin/blocked', { method: 'DELETE' }); loadBlocked() } catch (e) {}
}

// ─── COLA ─────────────────────────────────────────────────────────────────────

async function loadQueue() {
  try {
    const res   = await fetch('/admin/queue')
    const queue = await res.json()
    document.getElementById('queueBadge').textContent = queue.length

    const el = document.getElementById('queueList')
    if (!queue.length) {
      el.innerHTML = `
        <div class="queue-empty">
          <div class="queue-empty-icon">📭</div>
          <div class="queue-empty-text">La cola está vacía</div>
        </div>`
      return
    }

    el.innerHTML = '<div class="queue-list">' + queue.map((v, i) => `
      <div class="queue-item">
        <div class="q-num ${i === 0 ? 'playing' : ''}">${i === 0 ? '▶' : i + 1}</div>
        ${v.thumbnail
          ? `<img class="q-thumb" src="${v.thumbnail}" alt="">`
          : '<div class="q-thumb-ph">🎵</div>'
        }
        <div class="q-info">
          <div class="q-title">${v.title}</div>
        </div>
        <button class="btn-sm btn-ghost" title="Guardar en playlist"
          onclick="openAddToPlaylist('${esc(v.videoId)}','${esc(v.title)}','${esc(v.thumbnail||'')}')">＋</button>
        <button class="btn-sm btn-danger" onclick="removeFromQueue('${v.id}')">✕</button>
      </div>
    `).join('') + '</div>'
  } catch (e) {}
}

async function removeFromQueue(id) {
  try {
    const res = await fetch(`/admin/queue/${id}`, { method: 'DELETE' })
    if ((await res.json()).ok) loadQueue()
  } catch (e) {}
}

// ─── UTILIDADES ───────────────────────────────────────────────────────────────

function showToast(msg, isError = false) {
  const el = document.getElementById('toast')
  el.textContent = msg
  el.className   = 'toast show' + (isError ? ' error' : '')
  clearTimeout(el._timer)
  el._timer = setTimeout(() => el.classList.remove('show'), 3000)
}

function esc(str) {
  return (str || '').replace(/'/g, "\\'").replace(/"/g, '&quot;')
}

function timeAgo(ts) {
  const m = Math.floor((Date.now() - ts) / 60000)
  if (m < 1)  return 'hace un momento'
  if (m < 60) return `hace ${m} min`
  return `hace ${Math.floor(m / 60)} h`
}

// ─── MODAL: EDITAR PORTADA DE PLAYLIST ───────────────────────────────────────

let editingCoverPlaylistId = null

function openCoverModal(playlistId, currentCover) {
  editingCoverPlaylistId = playlistId
  const input = document.getElementById('coverModalInput')
  const preview = document.getElementById('coverModalPreview')
  const wrap = document.getElementById('coverModalPreviewWrap')
  input.value = currentCover || ''
  if (currentCover) {
    preview.src = currentCover
    wrap.classList.add('show')
  } else {
    wrap.classList.remove('show')
    preview.src = ''
  }
  document.getElementById('coverModal').classList.add('open')
  setTimeout(() => input.focus(), 100)
}

function closeCoverModal() {
  document.getElementById('coverModal').classList.remove('open')
  editingCoverPlaylistId = null
}

function onCoverModalInput(input) {
  const url = input.value.trim()
  const wrap = document.getElementById('coverModalPreviewWrap')
  const img  = document.getElementById('coverModalPreview')
  if (!url) { wrap.classList.remove('show'); return }
  img.src = url
  img.onload  = () => wrap.classList.add('show')
  img.onerror = () => wrap.classList.remove('show')
}

async function saveCover() {
  const url = document.getElementById('coverModalInput').value.trim()
  const btn = document.getElementById('saveCoverBtn')
  btn.disabled = true; btn.textContent = '...'
  try {
    const res  = await fetch(`/admin/playlists/${editingCoverPlaylistId}/cover`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cover: url || null })
    })
    const data = await res.json()
    if (data.ok) {
      showToast(url ? '✅ Portada actualizada' : '✅ Portada eliminada')
      closeCoverModal()
      loadPlaylists()
    } else {
      showToast(data.error || 'Error guardando', true)
    }
  } catch (e) {
    showToast('Error de conexión', true)
  } finally {
    btn.disabled = false; btn.textContent = 'Guardar'
  }
}

// Cerrar modal de portada al click fuera
document.addEventListener('click', e => {
  if (e.target === document.getElementById('coverModal')) closeCoverModal()
  if (e.target === document.getElementById('songsModal')) closeSongsModal()
})

// ─── MODAL: VER Y ELIMINAR CANCIONES DE PLAYLIST ─────────────────────────────

let songsModalPlaylistId = null
let songsModalAll = []

async function openSongsModal(playlistId, name, total) {
  songsModalPlaylistId = playlistId
  songsModalAll = []
  document.getElementById('songsModalTitle').textContent = name
  document.getElementById('songsModalSub').textContent = `${total} canciones`
  document.getElementById('songsModalSearch').value = ''
  document.getElementById('songsModalList').innerHTML = '<p class="loading-msg">Cargando canciones...</p>'
  document.getElementById('songsModal').classList.add('open')

  try {
    const res = await fetch(`/playlists/${playlistId}/songs`)
    songsModalAll = await res.json()
    renderModalSongs(songsModalAll)
  } catch (e) {
    document.getElementById('songsModalList').innerHTML = '<p class="empty-msg">Error cargando canciones</p>'
  }
}

function closeSongsModal() {
  document.getElementById('songsModal').classList.remove('open')
  songsModalPlaylistId = null
  songsModalAll = []
}

function filterModalSongs() {
  const q = document.getElementById('songsModalSearch').value.toLowerCase().trim()
  renderModalSongs(q ? songsModalAll.filter(s => s.title.toLowerCase().includes(q)) : songsModalAll)
}

function renderModalSongs(songs) {
  const el = document.getElementById('songsModalList')
  if (!songs.length) {
    el.innerHTML = '<p class="empty-msg">No se encontraron canciones</p>'
    return
  }
  el.innerHTML = songs.map(s => `
    <div class="songs-modal-item" id="smi-${s.videoId}">
      ${s.thumbnail
        ? `<img src="${s.thumbnail}" alt="" class="smi-thumb">`
        : '<div class="smi-thumb smi-thumb-ph">🎵</div>'
      }
      <div class="smi-info">
        <div class="smi-title">${s.title}</div>
        <div class="smi-id">${s.videoId}</div>
      </div>
      <button class="btn-sm btn-danger smi-del" onclick="deleteSongFromPlaylist('${s.videoId}','${esc(s.title)}')" title="Eliminar canción">✕</button>
    </div>
  `).join('')
}

async function deleteSongFromPlaylist(videoId, title) {
  if (!confirm(`¿Eliminar "${title}" de la playlist?`)) return
  try {
    const res  = await fetch(`/admin/playlists/${songsModalPlaylistId}/songs/${videoId}`, { method: 'DELETE' })
    const data = await res.json()
    if (data.ok) {
      showToast(`"${title}" eliminada`)
      songsModalAll = songsModalAll.filter(s => s.videoId !== videoId)
      document.getElementById('songsModalSub').textContent = `${songsModalAll.length} canciones`
      filterModalSongs()
      loadPlaylists()
    } else {
      showToast(data.error || 'Error eliminando', true)
    }
  } catch (e) { showToast('Error de conexión', true) }
}