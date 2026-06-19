// ─── ESTADO GLOBAL ────────────────────────────────────────────────────────────

let allSongs = []
let currentPlaylistId = null
let selectedSong = null

// ─── ID DEL CLIENTE ───────────────────────────────────────────────────────────

function getClientId() {
  let id = localStorage.getItem('granizados_client_id')
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem('granizados_client_id', id)
  }
  return id
}

// ─── INICIO ───────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  loadPlaylists()
})

// ─── VISTA 1: PLAYLISTS ───────────────────────────────────────────────────────

async function loadPlaylists() {
  try {
    const res = await fetch('/playlists')
    const playlists = await res.json()
    const el = document.getElementById('playlistsGrid')

    if (!playlists.length) {
      el.innerHTML = '<p class="empty-msg">No hay playlists disponibles aún</p>'
      return
    }

    el.innerHTML = playlists.map(pl => `
      <div class="playlist-card" onclick="openPlaylist('${pl.id}', '${escAttr(pl.name)}')">
        ${pl.cover
          ? `<img class="pl-icon pl-icon-img" src="${pl.cover}" alt="${escAttr(pl.name)}" onerror="this.outerHTML='<div class=\\'pl-icon\\'>🎵</div>'">`
          : '<div class="pl-icon">🎵</div>'
        }
        <div class="pl-name">${pl.name}</div>
        <div class="pl-meta">${pl.total} canciones</div>
        <div class="pl-arrow">→</div>
      </div>
    `).join('')
  } catch (e) {
    document.getElementById('playlistsGrid').innerHTML = '<p class="empty-msg">Error cargando playlists</p>'
  }
}

// ─── VISTA 2: CANCIONES ───────────────────────────────────────────────────────

async function openPlaylist(id, name) {
  currentPlaylistId = id
  document.getElementById('songsTitle').textContent = name
  document.getElementById('searchInput').value = ''
  document.getElementById('songsList').innerHTML = '<p class="loading-msg">Cargando canciones...</p>'

  showView('viewSongs')

  try {
    const res = await fetch(`/playlists/${id}/songs`)
    allSongs = await res.json()
    renderSongs(allSongs)
  } catch (e) {
    document.getElementById('songsList').innerHTML = '<p class="empty-msg">Error cargando canciones</p>'
  }
}

function renderSongs(songs) {
  const el = document.getElementById('songsList')

  if (!songs.length) {
    el.innerHTML = '<p class="empty-msg">No se encontraron canciones</p>'
    return
  }

  el.innerHTML = songs.map(s => `
    <div class="song-item" onclick="openConfirm('${s.videoId}', '${escAttr(s.title)}', '${s.thumbnail || ''}')">
      ${s.thumbnail
        ? `<img class="s-thumb" src="${s.thumbnail}" alt="${escAttr(s.title)}">`
        : '<div class="s-thumb s-thumb-ph">♪</div>'
      }
      <div class="s-info">
        <div class="s-title">${s.title}</div>
      </div>
      <div class="s-arrow">+</div>
    </div>
  `).join('')
}

function filterSongs() {
  const q = document.getElementById('searchInput').value.toLowerCase().trim()
  if (!q) { renderSongs(allSongs); return }
  const filtered = allSongs.filter(s => s.title.toLowerCase().includes(q))
  renderSongs(filtered)
}

function goBack() {
  showView('viewPlaylists')
  allSongs = []
  currentPlaylistId = null
}

// ─── NAVEGACIÓN ENTRE VISTAS ──────────────────────────────────────────────────

function showView(viewId) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'))
  document.getElementById(viewId).classList.add('active')
}

// ─── MODAL DE CONFIRMACIÓN ────────────────────────────────────────────────────

function openConfirm(videoId, title, thumbnail) {
  selectedSong = { videoId, title, thumbnail }
  document.getElementById('confirmTitle').textContent = title
  const img = document.getElementById('confirmThumb')
  if (thumbnail) {
    img.src = thumbnail
    img.style.display = 'block'
  } else {
    img.style.display = 'none'
  }
  document.getElementById('confirmModal').classList.add('open')
}

function closeModal() {
  document.getElementById('confirmModal').classList.remove('open')
  selectedSong = null
}

// Cerrar modal al tocar fuera
document.addEventListener('click', e => {
  const modal = document.getElementById('confirmModal')
  if (e.target === modal) closeModal()
})

// ─── PEDIR CANCIÓN ────────────────────────────────────────────────────────────

async function confirmRequest() {
  if (!selectedSong) return

  const btn = document.querySelector('.btn-confirm')
  btn.disabled = true
  btn.textContent = 'Enviando...'

  try {
    const res = await fetch('/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        videoId: selectedSong.videoId,
        title: selectedSong.title,
        thumbnail: selectedSong.thumbnail,
        clientId: getClientId()
      })
    })

    const data = await res.json()
    closeModal()

    if (data.ok) {
      showToast('¡Solicitud enviada! El admin la revisará 🎵')
    } else {
      showToast(data.error, true)
    }
  } catch (e) {
    showToast('Error de conexión', true)
  } finally {
    btn.disabled = false
    btn.textContent = 'Sí, pedir 🎵'
  }
}

// ─── TOAST ────────────────────────────────────────────────────────────────────

function showToast(msg, isError = false) {
  const el = document.getElementById('toast')
  el.textContent = msg
  el.className = 'toast show' + (isError ? ' error' : '')
  setTimeout(() => el.classList.remove('show'), 3000)
}

// ─── UTILIDADES ───────────────────────────────────────────────────────────────

function escAttr(str) {
  return (str || '').replace(/'/g, "\\'").replace(/"/g, '&quot;')
}