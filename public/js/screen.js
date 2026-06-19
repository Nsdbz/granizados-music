let player = null
let currentVideo = null
let isPlaying = false

function startPlayer() {
  document.getElementById('startScreen').style.display = 'none'
  document.getElementById('playerScreen').style.display = 'block'
  checkQueue()
  setInterval(checkQueue, 5000)
}

function onYouTubeIframeAPIReady() {
  player = new YT.Player('ytPlayer', {
    width: '100%',
    height: '100%',
    playerVars: {
      autoplay: 1,
      controls: 1,
      rel: 0,
      playsinline: 1,
      iv_load_policy: 3,
      modestbranding: 1
    },
    events: {
      onReady: () => checkQueue(),
      onStateChange: onPlayerStateChange,
      onError: (e) => handleVideoError(e)
    }
  })
}

function onPlayerStateChange(event) {
  if (event.data === YT.PlayerState.ENDED) {
    videoEnded()
  }
  if (event.data === YT.PlayerState.BUFFERING || event.data === YT.PlayerState.PLAYING) {
    isPlaying = true
    hideWaitingScreen()
  }
}

// ─── MANEJO DE ERRORES ────────────────────────────────────────────────────────
// Si un video falla simplemente salta al siguiente (las playlists ya están saneadas)

async function handleVideoError(event) {
  if (!currentVideo) return
  console.log('Error YouTube código:', event.data, '— saltando:', currentVideo.title)

  // Reportar al backend que este video falló en pantalla
  try {
    await fetch('/screen/report-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        videoId: currentVideo.videoId,
        title: currentVideo.title,
        thumbnail: currentVideo.thumbnail || null,
        errorCode: event.data
      })
    })
  } catch (e) {}

  await videoEnded()
}

// ─── PANTALLA DE ESPERA ───────────────────────────────────────────────────────

function hideWaitingScreen() {
  document.getElementById('waitingScreen').style.display = 'none'
}

function showWaitingScreen() {
  const ws = document.getElementById('waitingScreen')
  ws.innerHTML = `
    <div class="waiting-icon">🎵</div>
    <div class="waiting-title">GranizadosMusic</div>
    <div class="waiting-sub">Escanea el QR para pedir una canción</div>
    <div class="waiting-dots"><span></span><span></span><span></span></div>
  `
  ws.style.display = 'flex'
}

// ─── COLA ─────────────────────────────────────────────────────────────────────

async function checkQueue() {
  try {
    const res = await fetch('/screen/next')
    const data = await res.json()

    if (data.empty) {
      if (!isPlaying) showWaitingScreen()
      return
    }

    if (!isPlaying || !currentVideo) {
      playVideo(data)
    }
  } catch (e) {}
}

function playVideo(video) {
  if (!player || !player.loadVideoById) return
  currentVideo = video
  isPlaying = true
  hideWaitingScreen()
  player.loadVideoById(video.videoId)
}

async function videoEnded() {
  isPlaying = false
  if (!currentVideo) return

  try {
    await fetch(`/screen/played/${currentVideo.id}`, { method: 'DELETE' })
  } catch (e) {}

  currentVideo = null
  await checkQueue()
}

document.addEventListener('keydown', e => {
  if (e.key === 'ArrowRight' || e.key === 'n' || e.key === 'N') skipVideo()
})

async function skipVideo() {
  if (!currentVideo) return
  isPlaying = false
  try {
    await fetch(`/screen/played/${currentVideo.id}`, { method: 'DELETE' })
  } catch (e) {}
  currentVideo = null
  if (player) player.stopVideo()
  showWaitingScreen()
  await checkQueue()
}