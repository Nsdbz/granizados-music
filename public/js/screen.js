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
      controls: 1,       // controles nativos de YouTube activados
      rel: 0,            // no mostrar videos relacionados al terminar
      playsinline: 1,
      iv_load_policy: 3, // ocultar anotaciones
      modestbranding: 1
    },
    events: {
      onReady: () => checkQueue(),
      onStateChange: onPlayerStateChange,
      onError: () => videoEnded()
    }
  })
}
 
function onPlayerStateChange(event) {
  if (event.data === YT.PlayerState.ENDED) {
    videoEnded()
  }
  if (event.data === YT.PlayerState.PLAYING) {
    isPlaying = true
    document.getElementById('waitingScreen').style.display = 'none'
  }
}
 
async function checkQueue() {
  try {
    const res = await fetch('/screen/next')
    const data = await res.json()
 
    if (data.empty) {
      if (!isPlaying) {
        document.getElementById('waitingScreen').style.display = 'flex'
      }
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
  document.getElementById('waitingScreen').style.display = 'none'
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
  if (e.key === 'ArrowRight' || e.key === 'n' || e.key === 'N') {
    skipVideo()
  }
})

async function skipVideo() {
  if (!currentVideo) return
  isPlaying = false
  try {
    await fetch(`/screen/played/${currentVideo.id}`, { method: 'DELETE' })
  } catch (e) {}
  currentVideo = null
  if (player) player.stopVideo()
  await checkQueue()
}
