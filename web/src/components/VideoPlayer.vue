<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { ArrowLeft, Cellphone, FullScreen, Mute, RefreshRight, VideoPause, VideoPlay } from '@element-plus/icons-vue'
import { api } from '../api'

const props = defineProps({
  movie: { type: Object, required: true },
  // 字幕轨：-1 = 无字幕；>= 0 = 转码时烧录该轨（直连模式选了字幕会强制走转码）
  subIdx: { type: Number, default: -1 }
})
const visible = defineModel({ type: Boolean, default: false })

const videoRef = ref(null)
const barRef = ref(null)
const state = ref('init') // init | probing | buffering | playing | paused | error | ended
const mode = ref('')       // direct | transcode
const note = ref('')
const sid = ref(null)
const errorMsg = ref('')
const showControls = ref(true)

// 触屏设备（手机/平板）：点击/全屏/系统播放器行为与桌面不同
const isTouch = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches
const canNativeHls = ref(false) // 浏览器原生支持 HLS（iOS Safari）→ 可交给系统播放器
const handedOff = ref(false)    // 已把播放交给系统播放器

// 音量（记忆到 localStorage）
const volume = ref(1)
try {
  const saved = parseFloat(localStorage.getItem('mc_volume'))
  if (Number.isFinite(saved) && saved >= 0 && saved <= 1) volume.value = saved
} catch {}
const isMuted = ref(false)
const lastVol = ref(0.5)

// 进度
const dur = ref(0)        // 影片总时长（秒）
const cur = ref(0)        // 当前播放位置（影片内真实位置）
const bufEnd = ref(0)     // 已缓冲到的位置
const baseStart = ref(0)  // 当前转码会话从影片哪个位置开始（进度换算偏移）
const tcTo = ref(0)       // 服务器已转码到的位置（影片内绝对秒数）
const tcDone = ref(false) // 转码会话是否已全部转完
const dragging = ref(false)
const scrub = ref(0)
const hoverTime = ref(null)
const tipX = ref(0)

let hls = null
let heartbeatTimer = null
let progressTimer = null
let controlsTimer = null

const curPos = computed(() => (dragging.value ? scrub.value : cur.value))
const playPct = computed(() => (dur.value ? Math.min(100, (curPos.value / dur.value) * 100) : 0))
// 缓冲/转码区域都从会话起点开始画（拖动进度重启会话后不会从 0 误显示）
const bufStyle = computed(() => {
  if (!dur.value) return { width: '0%' }
  const l = (baseStart.value / dur.value) * 100
  const w = Math.max(0, Math.min(100, (bufEnd.value / dur.value) * 100) - l)
  return { left: l + '%', width: w + '%' }
})
const tcStyle = computed(() => {
  if (!dur.value) return { width: '0%' }
  const l = (baseStart.value / dur.value) * 100
  const w = Math.max(0, Math.min(100, (tcTo.value / dur.value) * 100) - l)
  return { left: l + '%', width: w + '%' }
})
const showSystemPlayer = computed(() => isTouch && (mode.value === 'direct' || (mode.value === 'transcode' && canNativeHls.value)))

watch(videoRef, v => { if (v) canNativeHls.value = !!v.canPlayType('application/vnd.apple.mpegurl') })

async function probeAndPlay() {
  state.value = 'probing'
  errorMsg.value = ''
  cur.value = 0
  bufEnd.value = 0
  baseStart.value = 0
  try {
    const p = await api.streamProbe(props.movie.id)
    note.value = p.note || ''
    if (p.duration) dur.value = p.duration
    // 直连无法烧字幕：选了字幕就强制走转码
    if (p.mode === 'direct' && props.subIdx < 0) {
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
  applyVolume()
  v.src = `/api/stream/${props.movie.id}/direct`
  v.play().catch(() => { state.value = 'paused' })
  state.value = 'buffering'
}

async function startTranscode() {
  try {
    const r = await api.streamTranscode(props.movie.id, null, props.subIdx)
    sid.value = r.sid
    baseStart.value = Number(r.startAt) || 0
    startHeartbeat()
    startProgressPoll()
    await attachStream()
    state.value = 'buffering'
  } catch (e) {
    fail(e.message)
  }
}

async function attachStream() {
  const v = videoRef.value
  const url = `/api/stream/session/${sid.value}/index.m3u8`
  applyVolume()
  let Hls = null
  try { Hls = (await import('hls.js')).default } catch {}
  if (Hls?.isSupported()) {
    // MSE 可用（Chrome/Edge/Firefox/桌面 Safari）：hls.js 转封装播放。
    // 注意不能用 canPlayType('...mpegurl') 判定走原生 HLS —— Chrome 也会返回 'maybe'，
    // 会把 m3u8 直接塞给 video.src，原生管线解不了 MPEG-TS，播放必然失败。
    hls = new Hls({
      maxBufferLength: 30,
      backBufferLength: 30,
      startPosition: 0,      // 从会话起点播放，不跳"直播边缘"
      lowLatencyMode: false
    })
    hls.loadSource(url)
    hls.attachMedia(v)
    hls.on(Hls.Events.ERROR, (_e, data) => {
      if (data.fatal) fail('转码流中断：' + data.type)
    })
    // 播放列表每次更新（新分段产出）即刷新"已转码"位置：
    // 以 m3u8 分段总时长为准 —— 源 PTS 有间隙的影片（蓝光原盘等）上，
    // 它比服务器 -progress 管道报的编码器位置更贴近实际可拖动范围
    hls.on(Hls.Events.LEVEL_UPDATED, (_e, data) => {
      const total = data.details?.totalduration || 0
      const to = baseStart.value + total
      if (total > 0 && to > tcTo.value) tcTo.value = to
    })
    v.play().catch(() => { state.value = 'paused' })
  } else if (v.canPlayType('application/vnd.apple.mpegurl')) {
    // 无 MSE 但原生支持 HLS（iOS Safari 等）：交给浏览器原生 HLS
    v.src = url
    v.addEventListener('loadedmetadata', () => { try { v.currentTime = 0 } catch {} }, { once: true })
    v.play().catch(() => { state.value = 'paused' })
  } else {
    throw new Error('当前浏览器不支持 HLS 播放')
  }
}

// 拖动进度到转码尚未覆盖的位置：以该位置为起点重启转码会话
async function restartTranscodeAt(t) {
  state.value = 'buffering'
  teardownSession()
  try {
    const r = await api.streamTranscode(props.movie.id, Math.round(t * 10) / 10, props.subIdx)
    sid.value = r.sid
    baseStart.value = Number(r.startAt) || t
    cur.value = baseStart.value
    startHeartbeat()
    startProgressPoll()
    await attachStream()
  } catch (e) {
    fail(e.message)
  }
}

// ---------- 心跳 & 错误 ----------

// 周期心跳：告诉服务器"会话还在用"，否则 10 分钟无心跳会被回收
function startHeartbeat() {
  stopHeartbeat()
  heartbeatTimer = setInterval(() => {
    if (sid.value) api.streamHeartbeat(sid.value).catch(() => {})
  }, 60 * 1000)
}

function stopHeartbeat() {
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null }
}

// 轮询服务器转码进度：进度条"已转码"条纹 + 文字提示
function startProgressPoll() {
  stopProgressPoll()
  progressTimer = setInterval(async () => {
    if (!sid.value) return
    try {
      const r = await api.streamProgress(sid.value)
      // 单调不减：LEVEL_UPDATED（播放列表实况）与管道值取大者，避免条纹回跳
      tcTo.value = Math.max(tcTo.value, r.transcodedTo || 0)
      tcDone.value = !!r.done
    } catch { /* 会话已结束等，静默 */ }
  }, 3000)
}

function stopProgressPoll() {
  if (progressTimer) { clearInterval(progressTimer); progressTimer = null }
}

function fail(msg) {
  stopHeartbeat()
  stopProgressPoll()
  tcTo.value = 0
  tcDone.value = false
  state.value = 'error'
  errorMsg.value = msg || '播放失败'
}

function teardownSession() {
  stopHeartbeat()
  stopProgressPoll()
  tcTo.value = 0
  tcDone.value = false
  if (hls) { hls.destroy(); hls = null }
  if (sid.value) {
    api.streamStop(sid.value).catch(() => {})
    sid.value = null
  }
  const v = videoRef.value
  if (v) { v.pause(); v.removeAttribute('src'); v.load() }
}

function close() {
  teardownSession()
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
  teardownSession()
  probeAndPlay()
}

// ---------- 播放控制 ----------

function togglePlay() {
  if (handedOff.value) { resumeWebPlayer(); return }
  const v = videoRef.value
  if (!v) return
  if (v.paused) { v.play().catch(() => {}); state.value = 'playing' }
  else { v.pause(); state.value = 'paused' }
}

function onCenterClick() {
  if (state.value === 'error') return
  if (state.value === 'ended') {
    seekTo(0)
    videoRef.value?.play().catch(() => {})
  } else togglePlay()
}

function seekTo(t) {
  const v = videoRef.value
  if (!v || !dur.value) return
  t = Math.min(Math.max(0, t), Math.max(0, dur.value - 0.5))
  if (mode.value === 'direct') {
    v.currentTime = t
    cur.value = t
    return
  }
  // 转码模式：落在当前会话已转码范围内可直接跳，否则重启会话
  const local = t - baseStart.value
  if (local >= 0 && local <= (v.duration || 0) - 1.5) {
    v.currentTime = local
    cur.value = t
  } else {
    restartTranscodeAt(t)
  }
}

function nudge(delta) {
  if (dur.value) seekTo(curPos.value + delta)
}

function toggleMute() {
  if (volume.value === 0) { setVolume(lastVol.value || 0.5); return }
  isMuted.value = !isMuted.value
  const v = videoRef.value
  if (v) v.muted = isMuted.value
}

function setVolume(val) {
  val = Math.min(1, Math.max(0, val))
  volume.value = val
  if (val > 0) lastVol.value = val
  localStorage.setItem('mc_volume', String(val))
  isMuted.value = val === 0
  const v = videoRef.value
  if (v) { v.volume = val; v.muted = val === 0 }
}

function applyVolume() {
  const v = videoRef.value
  if (!v) return
  v.volume = volume.value
  v.muted = isMuted.value
}

function toggleFullscreen() {
  const v = videoRef.value
  const el = v?.parentElement
  if (!el) return
  if (document.fullscreenElement || document.webkitFullscreenElement) {
    ;(document.exitFullscreen || document.webkitExitFullscreen)?.call(document)
    return
  }
  if (el.requestFullscreen) el.requestFullscreen()
  else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen()
  else if (v.webkitEnterFullscreen) v.webkitEnterFullscreen() // iOS：无元素全屏 API，交给系统播放器接管
}

// 手机：单击只呼出控制条，双击全屏；桌面：单击播放/暂停，双击全屏
function onVideoClick() {
  if (isTouch) { wakeControls(); return }
  togglePlay()
}

// 交给系统播放器（新标签页原生播放，手机上自动全屏）
function openSystemPlayer() {
  let url = ''
  if (mode.value === 'direct') url = `/api/stream/${props.movie.id}/direct`
  else if (sid.value) url = `/api/stream/session/${sid.value}/index.m3u8`
  else return
  window.open(url, '_blank')
  const v = videoRef.value
  if (v && !v.paused) v.pause() // 网页端暂停（保留心跳，转码会话不会被回收）
  handedOff.value = true
}

function resumeWebPlayer() {
  handedOff.value = false
  const v = videoRef.value
  if (!v) return
  if (mode.value === 'transcode') {
    // 跳到当前转码进度附近 ≈ 系统播放器刚看过的位置
    try { v.currentTime = Math.max(0, (v.duration || 0) - 3) } catch {}
  }
  v.play().catch(() => {})
}

// ---------- 进度条 ----------

function fmt(s) {
  if (!Number.isFinite(s) || s < 0) s = 0
  const t = Math.floor(s)
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const sec = String(t % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

function posFromEvent(e) {
  const r = barRef.value?.getBoundingClientRect()
  if (!r || !r.width) return { frac: 0, x: 0 }
  const x = Math.min(Math.max(0, e.clientX - r.left), r.width)
  return { frac: x / r.width, x }
}

function onBarDown(e) {
  if (!dur.value) return
  dragging.value = true
  wakeControls()
  barRef.value?.setPointerCapture(e.pointerId)
  const { frac, x } = posFromEvent(e)
  scrub.value = frac * dur.value
  tipX.value = x
}

function onBarMove(e) {
  if (!dur.value) return
  const { frac, x } = posFromEvent(e)
  hoverTime.value = frac * dur.value
  tipX.value = x
  if (dragging.value) scrub.value = frac * dur.value
}

function onBarUp(e) {
  if (!dragging.value) return
  dragging.value = false
  const { frac } = posFromEvent(e)
  seekTo(frac * dur.value)
}

function onBarLeave() {
  if (!dragging.value) hoverTime.value = null
}

// ---------- 事件 ----------

function onVideoEvent(e) {
  const v = videoRef.value
  if (e.type === 'playing') state.value = 'playing'
  else if (e.type === 'waiting') state.value = 'buffering'
  else if (e.type === 'pause') state.value = v?.ended ? 'ended' : 'paused'
  else if (e.type === 'error' && mode.value === 'direct') {
    // 直连解码失败 → 自动转码
    note.value = '浏览器无法直接解码，已切换服务器转码'
    teardownSession()
    mode.value = 'transcode'
    startTranscode()
  }
}

function onTimeUpdate() {
  const v = videoRef.value
  if (!v || dragging.value) return
  const off = mode.value === 'transcode' ? baseStart.value : 0
  cur.value = off + v.currentTime
  const b = v.buffered
  if (b && b.length) bufEnd.value = off + b.end(b.length - 1)
  if (mode.value === 'direct' && isFinite(v.duration) && v.duration > 0) dur.value = v.duration
}

function onLoadedMeta() {
  const v = videoRef.value
  if (mode.value === 'direct' && v?.duration && isFinite(v.duration)) dur.value = v.duration
}

function wakeControls() {
  showControls.value = true
  clearTimeout(controlsTimer)
  controlsTimer = setTimeout(() => {
    if (state.value === 'playing') showControls.value = false
  }, 3000)
}

function onWheel(e) {
  if (!['init', 'probing', 'error'].includes(state.value)) e.preventDefault()
  setVolume(volume.value + (e.deltaY < 0 ? 0.05 : -0.05))
}

function onKeydown(e) {
  if (!visible.value) return
  if (e.key === 'Escape') { if (!document.fullscreenElement) close(); return }
  if (e.target?.closest?.('.el-slider, input, textarea')) return
  if (e.key === ' ') { e.preventDefault(); togglePlay() }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); nudge(-10) }
  else if (e.key === 'ArrowRight') { e.preventDefault(); nudge(10) }
  else if (e.key === 'ArrowUp') { e.preventDefault(); setVolume(volume.value + 0.1) }
  else if (e.key === 'ArrowDown') { e.preventDefault(); setVolume(volume.value - 0.1) }
  else if (e.key === 'm' || e.key === 'M') toggleMute()
  else if (e.key === 'f' || e.key === 'F') toggleFullscreen()
}

// 全屏播放时锁定页面滚动：桌面隐藏滚动条，手机触摸不再拖动底层页面
function setPageScrollLock(lock) {
  const html = document.documentElement
  html.classList.toggle('mc-scroll-lock', lock)
}

watch(visible, v => {
  if (v) {
    state.value = 'init'
    dur.value = 0
    tcTo.value = 0
    tcDone.value = false
    handedOff.value = false
    setPageScrollLock(true)
    probeAndPlay()
    wakeControls()
  } else {
    setPageScrollLock(false)
  }
})

onMounted(() => {
  document.addEventListener('keydown', onKeydown)
  document.addEventListener('mousemove', wakeControls)
  // 页面刷新/关闭标签时保底停止转码会话（keepalive 请求在页面卸载后仍会送达）
  window.addEventListener('pagehide', onUnloadStop)
})
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown)
  document.removeEventListener('mousemove', wakeControls)
  window.removeEventListener('pagehide', onUnloadStop)
  setPageScrollLock(false)
  teardownSession()
})

function onUnloadStop() {
  if (!sid.value) return
  try {
    fetch(`/api/stream/session/${sid.value}/stop`, { method: 'POST', keepalive: true }).catch(() => {})
  } catch {}
}

const stateLabel = {
  init: '准备中…', probing: '正在分析影片编码…', buffering: '缓冲中…',
  playing: '', paused: '已暂停', error: '播放失败', ended: '已结束'
}
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="vp-mask" @click.self="close">
      <div class="vp-stage" @mousemove="wakeControls" @wheel="onWheel">
        <video
          ref="videoRef"
          class="vp-video"
          playsinline
          @click="onVideoClick"
          @dblclick="toggleFullscreen"
          @playing="onVideoEvent"
          @waiting="onVideoEvent"
          @pause="onVideoEvent"
          @error="onVideoEvent"
          @timeupdate="onTimeUpdate"
          @progress="onTimeUpdate"
          @loadedmetadata="onLoadedMeta"
        ></video>

        <!-- 已交给系统播放器 -->
        <div v-if="handedOff" class="vp-center vp-handoff">
          <p>已用系统播放器打开，网页端已暂停</p>
          <el-button type="primary" round @click="resumeWebPlayer">返回网页播放</el-button>
        </div>

        <!-- 中央状态 -->
        <div v-else-if="state !== 'playing'" class="vp-center" @click="onCenterClick">
          <div v-if="state === 'probing' || state === 'buffering' || state === 'init'" class="vp-spinner"></div>
          <el-icon v-else-if="state === 'paused'" :size="64" class="vp-bigicon"><VideoPlay /></el-icon>
          <el-icon v-else-if="state === 'ended'" :size="64" class="vp-bigicon"><RefreshRight /></el-icon>
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
        </div>

        <!-- 底栏控制条 -->
        <div class="vp-bottom" :class="{ hidden: !showControls && state === 'playing' }">
          <div class="vp-ctrl">
            <el-button circle text @click="togglePlay" title="播放/暂停（空格）">
              <el-icon :size="26">
                <VideoPause v-if="state === 'playing'" />
                <VideoPlay v-else />
              </el-icon>
            </el-button>

            <span class="vp-time">{{ fmt(curPos) }} / {{ fmt(dur) }}</span>
            <span
              v-if="mode === 'transcode' && dur && tcTo > 0"
              class="vp-tcinfo"
              :title="tcDone ? '本会话已全部转码完成，可随意拖动进度' : '服务器已转码到的位置（条纹区域），拖到这里不用重新转码'"
            >{{ tcDone ? '✓ 转码完成' : '已转码 ' + fmt(tcTo) }}</span>

            <div
              ref="barRef"
              class="vp-progress"
              :class="{ dragging: dragging }"
              @pointerdown="onBarDown"
              @pointermove="onBarMove"
              @pointerup="onBarUp"
              @pointercancel="onBarUp"
              @pointerleave="onBarLeave"
            >
              <div class="vp-bar">
                <div v-if="mode === 'transcode'" class="vp-tc" :style="tcStyle"></div>
                <div class="vp-buf" :style="bufStyle"></div>
                <div class="vp-play" :style="{ width: playPct + '%' }"><i class="vp-knob"></i></div>
              </div>
              <div v-if="hoverTime !== null || dragging" class="vp-tip" :style="{ left: tipX + 'px' }">
                {{ fmt(dragging ? scrub : hoverTime) }}
              </div>
            </div>

            <div class="vp-vol">
              <el-button circle text @click="toggleMute" :title="isMuted ? '取消静音（M）' : '静音（M）'">
                <svg v-if="!isMuted" viewBox="0 0 24 24" width="22" height="22" fill="none"
                     stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M11 5 6 9H3v6h3l5 4V5z" fill="currentColor" stroke="none"/>
                  <path v-if="volume > 0.02" d="M15.5 8.5a5 5 0 0 1 0 7"/>
                  <path v-if="volume > 0.5" d="M18.5 5.5a9.2 9.2 0 0 1 0 13"/>
                </svg>
                <el-icon v-else :size="22"><Mute /></el-icon>
              </el-button>
              <el-slider v-model="volume" :min="0" :max="1" :step="0.05" class="vp-volslider" @input="setVolume" />
            </div>

            <el-button v-if="showSystemPlayer" circle text @click="openSystemPlayer" title="用系统播放器打开">
              <el-icon :size="22"><Cellphone /></el-icon>
            </el-button>

            <el-button circle text @click="toggleFullscreen" title="全屏（F）">
              <el-icon :size="22"><FullScreen /></el-icon>
            </el-button>

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
  user-select: none;
}
.vp-top { top: 0; }
.vp-bottom {
  bottom: 0;
  background: linear-gradient(transparent, rgba(0,0,0,0.65));
  padding: 8px 18px 12px;
}
.vp-top.hidden { opacity: 0; transform: translateY(-8px); pointer-events: none; }
.vp-bottom.hidden { opacity: 0; transform: translateY(8px); pointer-events: none; }

.vp-title { flex: 1; min-width: 0; display: flex; align-items: baseline; gap: 10px; }
.vp-title .t { font-size: 17px; font-weight: 700; color: #ece3d2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.vp-title .y { color: #e0a458; font-size: 14px; }
.vp-title .m { font-size: 12px; color: #9a8b74; border: 1px solid rgba(154,139,116,0.4); padding: 0 6px; border-radius: 4px; }

.vp-ctrl { display: flex; align-items: center; gap: 12px; color: #ece3d2; width: 100%; }

.vp-time {
  font-size: 13px; color: #ece3d2; white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

/* 进度条 */
.vp-progress {
  flex: 1; min-width: 120px;
  padding: 8px 0;
  position: relative;
  cursor: pointer;
  touch-action: none;
}
.vp-bar {
  position: relative; height: 4px; border-radius: 2px;
  background: rgba(236, 227, 210, 0.18);
  transition: height 0.15s;
}
.vp-progress:hover .vp-bar, .vp-progress.dragging .vp-bar { height: 6px; }
.vp-buf {
  position: absolute; left: 0; top: 0; bottom: 0;
  border-radius: 2px;
  background: rgba(236, 227, 210, 0.28);
}
/* 服务器已转码区域（琥珀色斜纹，比浏览器缓冲更远） */
.vp-tc {
  position: absolute; top: 0; bottom: 0; left: 0;
  border-radius: 2px;
  background: repeating-linear-gradient(-45deg, rgba(224, 164, 88, 0.34) 0 4px, rgba(224, 164, 88, 0.08) 4px 9px);
  pointer-events: none;
}
.vp-tcinfo {
  font-size: 12px; color: #b09a78; white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.vp-play {
  position: absolute; left: 0; top: 0; bottom: 0;
  border-radius: 2px;
  background: #e0a458;
}
.vp-knob {
  position: absolute; right: -7px; top: 50%;
  width: 14px; height: 14px;
  border-radius: 50%;
  background: #e0a458;
  transform: translateY(-50%) scale(0);
  transition: transform 0.15s;
}
.vp-progress:hover .vp-knob, .vp-progress.dragging .vp-knob { transform: translateY(-50%) scale(1); }
.vp-tip {
  position: absolute; bottom: 24px;
  transform: translateX(-50%);
  background: rgba(20, 16, 12, 0.92);
  color: #ece3d2;
  font-size: 12px;
  padding: 3px 8px;
  border-radius: 4px;
  pointer-events: none;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

/* 音量 */
.vp-vol { display: flex; align-items: center; gap: 6px; }
.vp-volslider { width: 110px; }

.vp-state, .vp-note { font-size: 13px; color: #cfc2ac; white-space: nowrap; }
.vp-note { color: #9a8b74; }

.vp-handoff { pointer-events: auto; }
.vp-handoff p { color: #ece3d2; font-size: 15px; margin: 0 0 16px; }

/* 手机端：隐藏音量条（用硬件音量键），压缩间距保证全屏按钮可见 */
@media (max-width: 640px) {
  .vp-vol { display: none; }
  .vp-time { font-size: 11px; }
  .vp-progress { min-width: 60px; }
  .vp-ctrl { gap: 8px; }
}
</style>
