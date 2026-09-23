<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Close, ArrowLeft, FullScreen, Mute, VideoPlay } from '@element-plus/icons-vue'
import { api } from '../api'

const props = defineProps({
  movie: { type: Object, required: true }
})
const visible = defineModel({ type: Boolean, default: false })

const videoRef = ref(null)
const state = ref('init') // init | probing | buffering | playing | paused | error
const mode = ref('')       // direct | transcode
const note = ref('')
const sid = ref(null)
const errorMsg = ref('')
const showControls = ref(true)
const isMuted = ref(false)
const volume = ref(1)
let hls = null
let heartbeatTimer = null
let controlsTimer = null
let inactivityTimer = null

async function probeAndPlay() {
  state.value = 'probing'
  errorMsg.value = ''
  try {
    const p = await api.streamProbe(props.movie.id)
    note.value = p.note || ''
    if (p.mode === 'direct') {
      mode.value = 'direct'
      startDirect()
    } else {
      mode.value = 'transcode'
      await startTranscode()
    }
  } catch (e) {
    fail(e.message)
  }
}

function startDirect() {
  const v = videoRef.value
  v.src = `/api/stream/${props.movie.id}/direct`
  v.play().catch(() => {})
  state.value = 'buffering'
}

async function startTranscode() {
  try {
    const r = await api.streamTranscode(props.movie.id)
    sid.value = r.sid
    startHeartbeat()
    const url = `/api/stream/session/${r.sid}/index.m3u8`
    const v = videoRef.value
    if (v.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari 原生 HLS
      v.src = url
      v.play().catch(() => {})
    } else {
      const Hls = (await import('hls.js')).default
      if (!Hls.isSupported()) throw new Error('当前浏览器不支持 HLS 播放')
      hls = new Hls({ maxBufferLength: 30, backBufferLength: 30 })
      hls.loadSource(url)
      hls.attachMedia(v)
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (data.fatal) fail('转码流中断：' + data.type)
      })
    }
    state.value = 'buffering'
  } catch (e) {
    fail(e.message)
  }
}

function fail(msg) {
  state.value = 'error'
  errorMsg.value = msg
}

// 转码会话心跳（30s 一次，服务器 10 分钟无心跳自动清理）
function startHeartbeat() {
  stopHeartbeat()
  heartbeatTimer = setInterval(() => {
    if (sid.value) api.streamHeartbeat(sid.value).catch(() => {})
  }, 30000)
}
function stopHeartbeat() {
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null }
}

async function cleanup() {
  stopHeartbeat()
  if (hls) { hls.destroy(); hls = null }
  if (sid.value) {
    try { await api.streamStop(sid.value) } catch {}
    sid.value = null
  }
  const v = videoRef.value
  if (v) { v.pause(); v.removeAttribute('src'); v.load() }
}

function close() {
  cleanup()
  visible.value = false
}

// 错误后降级：本地播放器
async function fallbackLocal() {
  try {
    await api.playMovie(props.movie.id)
    ElMessage.success('已用本地播放器打开')
    close()
  } catch (e) {
    ElMessage.error(e.message)
  }
}

function retry() {
  cleanup().then(probeAndPlay)
}

function togglePlay() {
  const v = videoRef.value
  if (!v) return
  if (v.paused) { v.play().catch(() => {}); state.value = 'playing' }
  else { v.pause(); state.value = 'paused' }
}

function toggleMute() {
  const v = videoRef.value
  if (!v) return
  v.muted = !v.muted
  isMuted.value = v.muted
}

function setVolume(val) {
  const v = videoRef.value
  if (!v) return
  v.volume = val
  v.muted = false
  isMuted.value = false
}

function toggleFullscreen() {
  const el = videoRef.value?.parentElement
  if (!el) return
  if (document.fullscreenElement) document.exitFullscreen()
  else el.requestFullscreen?.()
}

function onVideoEvent(e) {
  const v = videoRef.value
  if (e.type === 'playing') state.value = 'playing'
  else if (e.type === 'waiting') state.value = 'buffering'
  else if (e.type === 'pause') state.value = v?.ended ? 'ended' : 'paused'
  else if (e.type === 'error' && mode.value === 'direct') {
    // 直连解码失败 → 自动转码
    note.value = '浏览器无法直接解码，已切换服务器转码'
    cleanup().then(() => { mode.value = 'transcode'; startTranscode() })
  }
}

function wakeControls() {
  showControls.value = true
  clearTimeout(controlsTimer)
  controlsTimer = setTimeout(() => {
    if (state.value === 'playing') showControls.value = false
  }, 3000)
}

watch(visible, v => {
  if (v) {
    state.value = 'init'
    probeAndPlay()
    wakeControls()
  }
})

function onKeydown(e) {
  if (!visible.value) return
  if (e.key === 'Escape') { if (!document.fullscreenElement) close() }
  else if (e.key === ' ') { e.preventDefault(); togglePlay() }
}
onMounted(() => {
  document.addEventListener('keydown', onKeydown)
  document.addEventListener('mousemove', wakeControls)
})
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown)
  document.removeEventListener('mousemove', wakeControls)
  cleanup()
})

const stateLabel = {
  init: '准备中…', probing: '正在分析影片编码…', buffering: '缓冲中…',
  playing: '', paused: '已暂停', error: '播放失败', ended: '已结束'
}
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="vp-mask" @click.self="close">
      <div class="vp-stage" @mousemove="wakeControls">
        <video
          ref="videoRef"
          class="vp-video"
          playsinline
          @click="togglePlay"
          @playing="onVideoEvent"
          @waiting="onVideoEvent"
          @pause="onVideoEvent"
          @error="onVideoEvent"
        ></video>

        <!-- 中央状态 -->
        <div v-if="state !== 'playing'" class="vp-center" @click="state === 'error' ? null : togglePlay()">
          <div v-if="state === 'probing' || state === 'buffering' || state === 'init'" class="vp-spinner"></div>
          <el-icon v-else-if="state === 'paused'" :size="64" class="vp-bigicon"><VideoPlay /></el-icon>
          <div v-else-if="state === 'error'" class="vp-error">
            <p>{{ errorMsg }}</p>
            <div class="vp-error-ops">
              <el-button round @click="retry">重试</el-button>
              <el-button type="primary" round @click="fallbackLocal">用本地播放器打开</el-button>
            </div>
          </div>
        </div>

        <!-- 顶栏 -->
        <div class="vp-top" :class="{ hidden: !showControls && state === 'playing' }">
          <el-button circle @click="close"><el-icon><ArrowLeft /></el-icon></el-button>
          <div class="vp-title">
            <span class="t">{{ movie.title }}</span>
            <span v-if="movie.year" class="y font-display">{{ movie.year }}</span>
            <span v-if="mode" class="m">{{ mode === 'direct' ? '直连原画' : '服务器转码 1080p' }}</span>
          </div>
          <el-button circle @click="toggleFullscreen"><el-icon><FullScreen /></el-icon></el-button>
        </div>

        <!-- 底栏 -->
        <div class="vp-bottom" :class="{ hidden: !showControls && state === 'playing' }">
          <div class="vp-ctrl">
            <el-button circle text @click="togglePlay">
              <el-icon :size="26"><VideoPlay v-if="state !== 'playing'" /><component v-else :is="undefined" /></el-icon>
            </el-button>
            <el-button circle text @click="toggleMute"><el-icon :size="22"><Mute v-if="isMuted" /></el-icon></el-button>
            <el-slider v-model="volume" :min="0" :max="1" :step="0.05" style="width: 110px" @input="setVolume" />
            <span v-if="stateLabel[state]" class="vp-state">{{ stateLabel[state] }}</span>
            <span v-else-if="note" class="vp-note">{{ note }}</span>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.vp-mask {
  position: fixed; inset: 0; z-index: 2000;
  background: #000;
  display: flex; align-items: center; justify-content: center;
}

.vp-stage {
  position: relative;
  width: 100%; height: 100%;
  background: #000;
  overflow: hidden;
}

.vp-video { width: 100%; height: 100%; object-fit: contain; }

.vp-center {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  pointer-events: none;
}
.vp-center .vp-error { pointer-events: auto; text-align: center; }
.vp-error p { color: #e07a6a; font-size: 15px; margin: 0 0 16px; }
.vp-error-ops { display: flex; gap: 10px; justify-content: center; }

.vp-spinner {
  width: 52px; height: 52px;
  border: 3px solid rgba(236, 227, 210, 0.15);
  border-top-color: #e0a458;
  border-radius: 50%;
  animation: vp-spin 0.9s linear infinite;
}
@keyframes vp-spin { to { transform: rotate(360deg); } }

.vp-bigicon { color: rgba(236, 227, 210, 0.85); }

.vp-top, .vp-bottom {
  position: absolute; left: 0; right: 0;
  display: flex; align-items: center; gap: 12px;
  padding: 14px 18px;
  transition: opacity 0.25s, transform 0.25s;
  background: linear-gradient(rgba(0,0,0,0.65), transparent);
}
.vp-top { top: 0; }
.vp-bottom { bottom: 0; background: linear-gradient(transparent, rgba(0,0,0,0.65)); justify-content: center; }
.vp-top.hidden { opacity: 0; transform: translateY(-8px); pointer-events: none; }
.vp-bottom.hidden { opacity: 0; transform: translateY(8px); pointer-events: none; }

.vp-title { flex: 1; min-width: 0; display: flex; align-items: baseline; gap: 10px; }
.vp-title .t { font-size: 17px; font-weight: 700; color: #ece3d2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.vp-title .y { color: #e0a458; font-size: 14px; }
.vp-title .m { font-size: 12px; color: #9a8b74; border: 1px solid rgba(154,139,116,0.4); padding: 0 6px; border-radius: 4px; }

.vp-ctrl { display: flex; align-items: center; gap: 10px; color: #ece3d2; }
.vp-state, .vp-note { font-size: 13px; color: #cfc2ac; }
.vp-note { color: #9a8b74; }
</style>
