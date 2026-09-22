<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { ArrowLeft, HomeFilled, Film, VideoPlay, Refresh } from '@element-plus/icons-vue'
import { api } from '../api'
import Logo from '../components/Logo.vue'
import MovieDetail from '../components/MovieDetail.vue'

const router = useRouter()

const state = ref('idle') // idle | rolling | result
const current = ref(null)
const flicker = ref(null)
const unwatchedOnly = ref(true)
const byTaste = ref(true)
const detailVisible = ref(false)
const detailMovie = ref(null)
const pool = ref([])
let flickerTimer = null

// 跑马灯灯泡：沿灯环（海报框外扩 17px）周长均匀分布。
// 灯环实际尺寸随海报框实测（响应式），用 px 定位保证严丝合缝。
const BULBS = 26
const RING_PAD = 17
const posterFrameRef = ref(null)
const ringSize = ref({ w: 326, h: 472 })
let ringObserver = null

function bulbPositions(n, W, H) {
  const per = 2 * (W + H)
  const pts = []
  for (let i = 0; i < n; i++) {
    const d = (i / n) * per
    if (d < W) pts.push({ x: d, y: 0 })
    else if (d < W + H) pts.push({ x: W, y: d - W })
    else if (d < 2 * W + H) pts.push({ x: W - (d - W - H), y: H })
    else pts.push({ x: 0, y: H - (d - 2 * W - H) })
  }
  return pts
}
const bulbs = computed(() => bulbPositions(BULBS, ringSize.value.w, ringSize.value.h))

const posterUrl = computed(() => {
  if (state.value === 'rolling') return flicker.value?.cover_url || null
  if (state.value === 'result') return current.value?.cover_url || null
  return null
})

async function roll() {
  if (state.value === 'rolling') return
  state.value = 'rolling'
  const startedAt = Date.now()
  let idx = Math.floor(Math.random() * Math.max(pool.value.length, 1))
  flickerTimer = setInterval(() => {
    if (pool.value.length) {
      idx = (idx + 1) % pool.value.length
      flicker.value = pool.value[idx]
    }
  }, 90)
  try {
    let r
    if (byTaste.value) {
      // 口味模式：按已看影片的偏好加权随机（库太小或无口味数据时服务端退化为纯随机）
      try {
        r = await api.pickByTaste()
      } catch (e) {
        if (!String(e.message).includes('没有未看过')) throw e
        if (unwatchedOnly.value) {
          ElMessage.info('都看完啦！关掉「只拆没看过的」再试试')
          state.value = 'idle'
          return
        }
        r = null
      }
      if (!r) {
        state.value = 'idle'
        return
      }
    }
    if (!r) {
      const params = unwatchedOnly.value ? { watched: false } : {}
      r = await api.pickMovie(params)
    }
    await new Promise(resolve => setTimeout(resolve, Math.max(0, 1100 - (Date.now() - startedAt))))
    current.value = r.movie
    state.value = 'result'
  } catch (e) {
    state.value = 'idle'
    if (String(e.message).includes('没有符合条件') && unwatchedOnly.value) {
      ElMessage.info('都看完啦！关掉「只拆没看过的」再试试')
    } else {
      ElMessage.error(e.message)
    }
  } finally {
    clearInterval(flickerTimer)
    flickerTimer = null
  }
}

function openDetail() {
  if (!current.value) return
  detailMovie.value = current.value
  detailVisible.value = true
}

async function playNow() {
  if (!current.value) return
  try {
    await api.playMovie(current.value.id)
  } catch (e) {
    ElMessage.error(e.message)
  }
}

function onUpdated(movie) {
  current.value = movie
  detailMovie.value = movie
}

async function onOpenMovie(id) {
  try {
    detailMovie.value = await api.movie(id)
    detailVisible.value = true
  } catch (e) {
    ElMessage.error(e.message)
  }
}

function goPerson(name) {
  detailVisible.value = false
  router.push({ path: '/person', query: { name } })
}

onMounted(async () => {
  // 实测海报框尺寸 → 灯环尺寸（含 17px 外扩），灯泡按 px 精确落位
  const measure = () => {
    const el = posterFrameRef.value
    if (!el) return
    const r = el.getBoundingClientRect()
    if (r.width > 0 && r.height > 0) {
      ringSize.value = { w: r.width + RING_PAD * 2, h: r.height + RING_PAD * 2 }
    }
  }
  measure()
  if (typeof ResizeObserver !== 'undefined') {
    ringObserver = new ResizeObserver(measure)
    if (posterFrameRef.value) ringObserver.observe(posterFrameRef.value)
  } else {
    window.addEventListener('resize', measure)
  }
  try {
    const r = await api.movies({ page_size: 60, sort: 'created_at', order: 'desc' })
    pool.value = r.items.filter(m => m.cover_url)
  } catch {}
})

onBeforeUnmount(() => {
  if (flickerTimer) clearInterval(flickerTimer)
  if (ringObserver) {
    ringObserver.disconnect()
    ringObserver = null
  }
})
</script>

<template>
  <div class="blind-page">
    <header class="topbar">
      <div class="brand" @click="router.push('/')">
        <Logo class="logo" />
        <span>电影中心</span>
      </div>
      <el-tooltip content="返回上一页" placement="bottom">
        <el-button circle @click="router.back()">
          <el-icon><ArrowLeft /></el-icon>
        </el-button>
      </el-tooltip>
      <el-tooltip content="首页" placement="bottom">
        <el-button circle @click="router.push('/')">
          <el-icon><HomeFilled /></el-icon>
        </el-button>
      </el-tooltip>
    </header>
    <main class="blind-main">
      <div class="stage" :class="state">
        <div class="poster-zone">
          <div class="bulb-ring">
            <span
              v-for="(b, i) in bulbs"
              :key="i"
              class="bulb"
              :style="{ left: b.x + 'px', top: b.y + 'px', '--i': i }"
            ></span>
          </div>
          <div ref="posterFrameRef" class="poster-frame" :class="{ pop: state === 'result' }" :key="state === 'result' ? current?.id : state">
            <img v-if="posterUrl" :src="posterUrl" alt="" />
            <div v-else-if="state === 'idle'" class="frame-idle">
              <Logo class="reel" />
              <span class="frame-q font-display">?</span>
            </div>
            <div v-else class="frame-idle">
              <el-icon :size="40" class="reel-spin"><Film /></el-icon>
            </div>
          </div>
        </div>

        <div class="side">
          <template v-if="state === 'idle'">
            <h1 class="side-title">盲盒放映</h1>
            <p class="side-sub">从你的放映厅里随机拆一部，拆到哪部看哪部。</p>
            <el-button type="primary" size="large" round class="roll-btn" @click="roll">拆一部</el-button>
            <div class="switch-row">
              <el-switch v-model="byTaste" />
              <span class="switch-label">按口味拆（根据已看记录加权）</span>
            </div>
            <div class="switch-row">
              <el-switch v-model="unwatchedOnly" />
              <span class="switch-label">只拆没看过的</span>
            </div>
          </template>

          <div v-else-if="state === 'rolling'" class="rolling-tip">
            <span class="rolling-dots"><i></i><i></i><i></i></span>
            正在拆胶片
          </div>

          <template v-else-if="current">
            <div class="r-kicker">
              <span v-if="current.quality" class="r-q font-display">{{ current.quality }}</span>
              <span v-if="current.categories?.length">{{ current.categories.slice(0, 3).join(' / ') }}</span>
            </div>
            <h2 class="r-title">
              {{ current.title }}<span v-if="current.year" class="r-year font-display">{{ current.year }}</span>
            </h2>
            <div class="r-scores">
              <span v-if="current.douban_rating != null" class="rsc douban"><i class="font-display">{{ Number(current.douban_rating).toFixed(1) }}</i>豆瓣</span>
              <span v-if="current.rating != null" class="rsc tmdb"><i class="font-display">{{ Number(current.rating).toFixed(1) }}</i>TMDB</span>
              <span v-if="current.my_rating != null" class="rsc mine"><i class="font-display">{{ Number(current.my_rating).toFixed(1) }}</i>我的</span>
              <span v-if="current.watched" class="r-watched">已看 {{ current.watch_count || 0 }} 次</span>
            </div>
            <p class="r-synopsis">{{ current.synopsis || '暂无简介' }}</p>
            <div class="r-actions">
              <el-button type="primary" round @click="openDetail">就看这部</el-button>
              <el-button v-if="!current.missing" round @click="playNow">
                <el-icon><VideoPlay /></el-icon>&nbsp;播放
              </el-button>
              <el-button round @click="roll">
                <el-icon><Refresh /></el-icon>&nbsp;再拆一部
              </el-button>
            </div>
            <div class="switch-row">
              <el-switch v-model="byTaste" />
              <span class="switch-label">按口味拆</span>
            </div>
            <div class="switch-row">
              <el-switch v-model="unwatchedOnly" />
              <span class="switch-label">只拆没看过的</span>
            </div>
          </template>
        </div>
      </div>
    </main>

    <MovieDetail v-model="detailVisible" :movie="detailMovie" @updated="onUpdated" @open-movie="onOpenMovie" @open-person="goPerson" />
  </div>
</template>

<style scoped>
.blind-page {
  min-height: 100%;
  display: flex;
  flex-direction: column;
}

.topbar {
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 14px 28px;
  background: rgba(16, 14, 12, 0.86);
  backdrop-filter: blur(10px);
  border-bottom: 1px solid #241d16;
}

.brand {
  display: flex;
  align-items: center;
  gap: 9px;
  font-size: 18px;
  font-weight: 700;
  letter-spacing: 2px;
  white-space: nowrap;
  cursor: pointer;
  color: #ece3d2;
}

.logo {
  width: 26px;
  height: 26px;
  color: #e0a458;
}

.blind-main {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 30px 24px 50px;
  box-sizing: border-box;
}

.stage {
  display: flex;
  align-items: center;
  gap: 54px;
}

/* ---------- 跑马灯灯泡 ---------- */
.poster-zone {
  position: relative;
  width: min(292px, 66vw);
  flex-shrink: 0;
}

.bulb-ring {
  position: absolute;
  inset: -17px;
  pointer-events: none;
}

.bulb {
  position: absolute;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #33291f;
  transform: translate(-50%, -50%);
}

.stage.idle .bulb {
  animation: twinkle 3.2s ease-in-out infinite;
  animation-delay: calc(var(--i) * 0.19s);
}

@keyframes twinkle {
  0%, 100% { background: #33291f; box-shadow: none; }
  40% { background: #6b5638; box-shadow: 0 0 6px rgba(230, 195, 122, 0.35); }
}

.stage.rolling .bulb {
  animation: chase 0.9s linear infinite;
  animation-delay: calc(var(--i) * -0.9s / 26);
}

@keyframes chase {
  0%, 100% { background: #33291f; box-shadow: none; }
  10% { background: #e6c37a; box-shadow: 0 0 12px rgba(230, 195, 122, 0.9); }
  22% { background: #33291f; box-shadow: none; }
}

.stage.result .bulb {
  animation: glow 2.6s ease-in-out infinite;
  animation-delay: calc(var(--i) * 0.1s);
}

@keyframes glow {
  0%, 100% { background: #4a3a26; }
  45% { background: #e0a458; box-shadow: 0 0 9px rgba(224, 164, 88, 0.75); }
}

/* ---------- 海报框 ---------- */
.poster-frame {
  position: relative;
  aspect-ratio: 2 / 3;
  border-radius: 10px;
  overflow: hidden;
  background: #1a1511;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.6), 0 0 0 1px #2c231b;
}

.poster-frame img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.poster-frame.pop {
  animation: pop 0.5s cubic-bezier(0.2, 0.9, 0.3, 1.2);
}

@keyframes pop {
  from { transform: scale(0.82); filter: brightness(1.8) saturate(0.4); }
  to { transform: scale(1); filter: none; }
}

.frame-idle {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 18px;
  background:
    repeating-linear-gradient(0deg, transparent 0 34px, rgba(224, 164, 88, 0.045) 34px 35px),
    repeating-linear-gradient(90deg, transparent 0 34px, rgba(224, 164, 88, 0.045) 34px 35px);
}

.reel {
  width: 64px;
  height: 64px;
  color: #6a5c4a;
  animation: spin 16s linear infinite;
}

.reel-spin {
  color: #6a5c4a;
  animation: spin 1.2s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.frame-q {
  font-size: 44px;
  color: #4e4438;
  line-height: 1;
}

/* ---------- 右侧信息 ---------- */
.side {
  min-width: 0;
  max-width: 460px;
}

.side-title {
  margin: 0 0 8px;
  font-size: 34px;
  color: #ece3d2;
}

.side-sub {
  margin: 0 0 26px;
  font-size: 14px;
  line-height: 1.8;
  color: #9a8b74;
}

.roll-btn {
  font-size: 17px;
  font-weight: 700;
  letter-spacing: 2px;
  padding: 20px 42px;
  height: auto;
}

.switch-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 20px;
}

.switch-label {
  font-size: 13px;
  color: #9a8b74;
}

.rolling-tip {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 15px;
  color: #cfc2ac;
  letter-spacing: 3px;
}

.rolling-dots {
  display: inline-flex;
  gap: 5px;
}

.rolling-dots i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #e0a458;
  animation: dot-jump 0.9s ease-in-out infinite;
}

.rolling-dots i:nth-child(2) { animation-delay: 0.15s; }
.rolling-dots i:nth-child(3) { animation-delay: 0.3s; }

@keyframes dot-jump {
  0%, 100% { opacity: 0.25; transform: translateY(0); }
  45% { opacity: 1; transform: translateY(-5px); }
}

.r-kicker {
  display: flex;
  align-items: baseline;
  gap: 12px;
  font-size: 13px;
  color: #9a8b74;
}

.r-q {
  font-size: 13px;
  color: #e6c37a;
  border: 1px solid rgba(230, 195, 122, 0.45);
  border-radius: 5px;
  padding: 0 6px;
}

.r-title {
  margin: 10px 0 6px;
  font-size: 32px;
  line-height: 1.3;
  color: #ece3d2;
  display: flex;
  align-items: baseline;
  gap: 12px;
  flex-wrap: wrap;
}

.r-year {
  font-size: 24px;
  color: #e0a458;
  font-weight: 400;
}

.r-scores {
  display: flex;
  align-items: baseline;
  gap: 18px;
  flex-wrap: wrap;
  margin-bottom: 4px;
}

.rsc {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  font-size: 12px;
  color: #9a8b74;
}

.rsc i {
  font-style: normal;
  font-size: 22px;
}

.rsc.douban i { color: #93c78f; }
.rsc.tmdb i { color: #e6c37a; }
.rsc.mine i { color: #8fd8b4; }

.r-watched {
  font-size: 12px;
  color: #9aab6e;
}

.r-synopsis {
  margin: 10px 0 22px;
  font-size: 13.5px;
  line-height: 1.85;
  color: #cfc2ac;
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.r-actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

@media (max-width: 860px) {
  .stage {
    flex-direction: column;
    gap: 34px;
  }

  .side {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
  }

  .r-scores,
  .r-actions {
    justify-content: center;
  }

  .r-title {
    justify-content: center;
  }
}
</style>
