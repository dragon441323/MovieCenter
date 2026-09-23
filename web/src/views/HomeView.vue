<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { ElMessage } from 'element-plus'
import { Setting, DataAnalysis, CircleCheck, VideoPlay, Star, Trophy, Coin, Grid, MagicStick, Present, Notebook, StarFilled, Collection } from '@element-plus/icons-vue'
import { useLibraryStore } from '../stores/library'
import { api } from '../api'
import { formatSize } from '../utils'
import Logo from '../components/Logo.vue'
import GlobalSearch from '../components/GlobalSearch.vue'
import MovieCard from '../components/MovieCard.vue'
import MovieDetail from '../components/MovieDetail.vue'
import SettingsDialog from '../components/SettingsDialog.vue'

const store = useLibraryStore()
const router = useRouter()
const { rows, scanPaths, scanning } = storeToRefs(store)

const stats = ref({ totals: { total: 0, watched: 0, watch_total: 0, favorites: 0, my_rated: 0, top250: 0, total_size: 0 } })
const detailVisible = ref(false)
const detailMovie = ref(null)
const settingsVisible = ref(false)
const picking = ref(false)
const projectorOn = ref(false)
const daily = ref(null)

const WEEKS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const dailyDate = computed(() => {
  if (!daily.value?.date) return ''
  const [, m, d] = daily.value.date.split('-')
  return `${String(m).padStart(2, '0')}.${String(d).padStart(2, '0')}`
})
const dailyWeek = computed(() => WEEKS[new Date().getDay()])

const featured = computed(() => rows.value.featured || [])
const hasLibrary = computed(() => stats.value.totals.total > 0)

const quickStats = computed(() => [
  { icon: Grid, color: '#e0a458', num: stats.value.totals.total, label: '电影' },
  { icon: CircleCheck, color: '#9aab6e', num: stats.value.totals.watched, label: '已看' },
  { icon: VideoPlay, color: '#c97b5a', num: stats.value.totals.watch_total, label: '累计观看' },
  { icon: Star, color: '#e6c37a', num: stats.value.totals.favorites, label: '收藏' },
  { icon: Trophy, color: '#93c78f', num: stats.value.totals.top250, label: 'Top 250' },
  { icon: Coin, color: '#a08d72', num: formatSize(stats.value.totals.total_size), label: '库容量', small: true }
])

function openDetail(movie) {
  detailMovie.value = movie
  detailVisible.value = true
}

function goPerson(name) {
  detailVisible.value = false
  router.push({ path: '/person', query: { name } })
}

async function onOpenMovie(id) {
  try {
    detailMovie.value = await api.movie(id)
    detailVisible.value = true
  } catch (e) {
    ElMessage.error(e.message)
  }
}

async function playMovie(movie) {
  try {
    await api.playMovie(movie.id)
  } catch (e) {
    ElMessage.error(e.message)
  }
}

async function pickTonight() {
  picking.value = true
  try {
    const movie = await store.pickTonight()
    ElMessage({ message: `今晚就看这部！${movie.title}`, type: 'success' })
    openDetail(movie)
  } catch (e) {
    ElMessage.info(e.message)
  } finally {
    picking.value = false
  }
}

function onUpdated(movie) {
  detailMovie.value = movie
  store.fetchRows()
  store.fetchMeta()
  api.stats().then(s => { stats.value = s }).catch(() => {})
}

onMounted(() => {
  requestAnimationFrame(() => { projectorOn.value = true })
  store.fetchRows()
  store.fetchMeta()
  store.fetchScanPaths()
  api.stats().then(s => { stats.value = s }).catch(() => {})
  api.dailyMovie().then(r => { daily.value = r.movie }).catch(() => {})
  api.doubanTop250()
    .then(() => store.fetchRows())
    .catch(() => {})
})
</script>

<template>
  <div class="home">
    <header class="topbar">
      <div class="brand">
        <Logo class="logo" />
        <span>电影中心</span>
      </div>
      <el-button class="pick-btn" round :loading="picking" @click="pickTonight">
        <el-icon v-if="!picking"><MagicStick /></el-icon>&nbsp;今晚看什么
      </el-button>
      <GlobalSearch @open-movie="onOpenMovie" />
      <el-tooltip content="扫描目录 / 设置" placement="bottom">
        <el-button circle @click="settingsVisible = true">
          <el-icon><Setting /></el-icon>
        </el-button>
      </el-tooltip>
    </header>

    <!-- 功能导航 -->
    <nav class="nav-cards">
      <button class="nav-card" @click="$router.push('/movies')">
        <span class="nc-icon" style="--c: #e0a458"><el-icon :size="22"><Grid /></el-icon></span>
        <span class="nc-body">
          <span class="nc-title">电影库</span>
          <span class="nc-desc">浏览全部 {{ stats.totals.total }} 部影片</span>
        </span>
      </button>
      <button class="nav-card" @click="$router.push('/blindbox')">
        <span class="nc-icon" style="--c: #d99a4e"><el-icon :size="22"><Present /></el-icon></span>
        <span class="nc-body">
          <span class="nc-title">盲盒放映</span>
          <span class="nc-desc">随机拆一部，支持按口味</span>
        </span>
      </button>
      <button class="nav-card" @click="$router.push('/wishlist')">
        <span class="nc-icon" style="--c: #e6c37a"><el-icon :size="22"><StarFilled /></el-icon></span>
        <span class="nc-body">
          <span class="nc-title">想看清单</span>
          <span class="nc-desc">同步豆瓣想看，到手自动对号</span>
        </span>
      </button>
      <button class="nav-card" @click="$router.push('/playlists')">
        <span class="nc-icon" style="--c: #c9a0e0"><el-icon :size="22"><Collection /></el-icon></span>
        <span class="nc-body">
          <span class="nc-title">我的片单</span>
          <span class="nc-desc">自定义专题收藏</span>
        </span>
      </button>
      <button class="nav-card" @click="$router.push('/diary')">
        <span class="nc-icon" style="--c: #8fd8b4"><el-icon :size="22"><Notebook /></el-icon></span>
        <span class="nc-body">
          <span class="nc-title">观影日记</span>
          <span class="nc-desc">{{ stats.totals.watch_total }} 次观看的时间线</span>
        </span>
      </button>
      <button class="nav-card" @click="$router.push('/stats')">
        <span class="nc-icon" style="--c: #93c78f"><el-icon :size="22"><DataAnalysis /></el-icon></span>
        <span class="nc-body">
          <span class="nc-title">统计面板</span>
          <span class="nc-desc">观影报告 · 类型 · 排行</span>
        </span>
      </button>
    </nav>

    <main class="home-main">
      <!-- 空库引导 -->
      <div v-if="!hasLibrary && !scanPaths.length" class="empty-hero">
        <Logo class="empty-logo" />
        <h2>把硬盘里的电影搬进你的放映厅</h2>
        <p>各硬盘根目录下的「电影」文件夹（如 D:\电影）会自动识别入库<br />本地硬盘与 NAS 目录都支持，入库后可一键同步海报和资料</p>
        <div class="hero-actions">
          <el-button size="large" @click="settingsVisible = true">添加电影目录</el-button>
          <el-button type="primary" size="large" :loading="scanning" @click="store.triggerAndAwaitScan()">立即扫描</el-button>
        </div>
      </div>

      <template v-else>
        <!-- 银幕：精选轮播 -->
        <div v-if="featured.length" class="screen" :class="{ on: projectorOn }">
          <el-carousel height="430px" :interval="6500" arrow="hover" indicator-position="none" trigger="click">
            <el-carousel-item v-for="m in featured" :key="m.id">
              <div class="slide" @click="openDetail(m)">
                <div class="slide-bg" :style="{ backgroundImage: `url(${m.cover_url})` }"></div>
                <div class="slide-shade"></div>
                <div class="slide-body">
                  <img class="slide-poster" :src="m.cover_url" :alt="m.title" loading="lazy" />
                  <div class="slide-info">
                    <div class="kicker">
                      <span v-if="m.douban_rank" class="rank-badge font-display">TOP {{ m.douban_rank }}</span>
                      <span v-if="m.categories?.length" class="cats">{{ m.categories.slice(0, 3).join(' / ') }}</span>
                    </div>
                    <h2 class="slide-title">
                      {{ m.title }}<span v-if="m.year" class="slide-year font-display">{{ m.year }}</span>
                    </h2>
                    <div class="slide-scores">
                      <span v-if="m.douban_rating != null" class="sc douban"><i class="font-display">{{ Number(m.douban_rating).toFixed(1) }}</i>豆瓣</span>
                      <span v-if="m.rating != null" class="sc tmdb"><i class="font-display">{{ Number(m.rating).toFixed(1) }}</i>TMDB</span>
                      <span v-if="m.my_rating != null" class="sc mine"><i class="font-display">{{ Number(m.my_rating).toFixed(1) }}</i>我的</span>
                    </div>
                    <p class="slide-synopsis">{{ m.synopsis || '暂无简介' }}</p>
                    <div class="slide-actions" @click.stop>
                      <el-button type="primary" size="large" round @click="openDetail(m)">查看详情</el-button>
                      <el-button size="large" round @click="playMovie(m)">
                        <el-icon><VideoPlay /></el-icon>&nbsp;播放
                      </el-button>
                    </div>
                  </div>
                </div>
              </div>
            </el-carousel-item>
          </el-carousel>
        </div>

        <!-- 今日放映：当日排片票根 -->
        <section v-if="daily" class="daily">
          <div class="daily-ticket">
            <div class="daily-stub">
              <span class="daily-label">今日放映</span>
              <span class="daily-date font-display">{{ dailyDate }}</span>
              <span class="daily-week">{{ dailyWeek }}</span>
            </div>
            <div class="daily-main" @click="openDetail(daily)">
              <img class="daily-poster" :src="daily.cover_url" :alt="daily.title" loading="lazy" v-if="daily.cover_url" />
              <div class="daily-info">
                <h3 class="daily-title">
                  {{ daily.title }}<span v-if="daily.year" class="daily-year font-display">{{ daily.year }}</span>
                </h3>
                <div class="daily-meta">
                  <span v-if="daily.quality" class="daily-q font-display">{{ daily.quality }}</span>
                  <span v-if="daily.douban_rating != null" class="sc douban"><i class="font-display">{{ Number(daily.douban_rating).toFixed(1) }}</i>豆瓣</span>
                  <span v-if="daily.rating != null" class="sc tmdb"><i class="font-display">{{ Number(daily.rating).toFixed(1) }}</i>TMDB</span>
                  <span v-if="daily.my_rating != null" class="sc mine"><i class="font-display">{{ Number(daily.my_rating).toFixed(1) }}</i>我的</span>
                  <span v-if="daily.categories?.length" class="daily-cats">{{ daily.categories.slice(0, 3).join(' / ') }}</span>
                </div>
                <p class="daily-synopsis">{{ daily.synopsis || '暂无简介' }}</p>
                <div class="daily-actions" @click.stop>
                  <el-button size="small" round @click="openDetail(daily)">详情</el-button>
                  <el-button v-if="!daily.missing" size="small" round type="primary" @click="playMovie(daily)">
                    <el-icon><VideoPlay /></el-icon>&nbsp;播放
                  </el-button>
                  <span v-if="daily.watched" class="replay-tag">重映 · 已看 {{ daily.watch_count || 0 }} 次</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <!-- 统计速览 -->
        <div class="quick-stats">
          <button v-for="q in quickStats" :key="q.label" class="qcard" @click="$router.push('/stats')">
            <span class="qicon" :style="{ color: q.color }">
              <el-icon :size="18"><component :is="q.icon" /></el-icon>
            </span>
            <span class="qnum font-display" :class="{ small: q.small }">{{ q.num }}</span>
            <span class="qlabel">{{ q.label }}</span>
          </button>
        </div>

        <!-- 推荐位 -->
        <section v-if="rows.recent_watched.length" class="row-section">
          <div class="sec-head">
            <h3 class="sec-title">最近观看</h3>
            <el-button link type="primary" class="sec-more" @click="$router.push('/movies')">查看全部</el-button>
          </div>
          <div class="h-scroll">
            <MovieCard v-for="m in rows.recent_watched" :key="m.id" :movie="m" @open="openDetail" @play="playMovie" />
          </div>
        </section>

        <section v-if="rows.top_unwatched.length" class="row-section">
          <div class="sec-head">
            <h3 class="sec-title">高分未看</h3>
            <el-button link type="primary" class="sec-more" @click="$router.push('/movies')">查看全部</el-button>
          </div>
          <div class="h-scroll">
            <MovieCard v-for="m in rows.top_unwatched" :key="m.id" :movie="m" @open="openDetail" @play="playMovie" />
          </div>
        </section>

        <section v-if="rows.top250.length" class="row-section">
          <div class="sec-head">
            <h3 class="sec-title">豆瓣 Top 250 · 已入库 {{ rows.top250.length }} 部</h3>
            <el-button link type="primary" class="sec-more" @click="$router.push('/movies')">查看全部</el-button>
          </div>
          <div class="h-scroll">
            <MovieCard v-for="m in rows.top250" :key="m.id" :movie="m" @open="openDetail" @play="playMovie" />
          </div>
        </section>
      </template>
    </main>

    <MovieDetail v-model="detailVisible" :movie="detailMovie" @updated="onUpdated" @open-movie="onOpenMovie" @open-person="goPerson" />
    <SettingsDialog v-model="settingsVisible" />
  </div>
</template>

<style scoped>
.home {
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
  margin-right: auto;
  color: #ece3d2;
}

.logo {
  width: 26px;
  height: 26px;
  color: #e0a458;
}

.pick-btn {
  font-weight: 600;
}

/* ---------- 功能导航卡片 ---------- */
.nav-cards {
  display: flex;
  gap: 12px;
  padding: 16px 28px 4px;
  max-width: 1440px;
  margin: 0 auto;
  width: 100%;
  box-sizing: border-box;
  overflow-x: auto;
}

.nav-card {
  flex: 1 1 0;
  min-width: 170px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 13px 16px;
  background: #1a1511;
  border: 1px solid #2e241b;
  border-radius: 12px;
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  transition: border-color 0.2s, transform 0.2s, box-shadow 0.2s, background 0.2s;
}

.nav-card:hover {
  border-color: color-mix(in srgb, var(--c) 55%, transparent);
  background: #201a13;
  transform: translateY(-3px);
  box-shadow: 0 10px 26px rgba(0, 0, 0, 0.45);
}

.nc-icon {
  flex-shrink: 0;
  width: 42px;
  height: 42px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--c);
  background: color-mix(in srgb, var(--c) 13%, transparent);
}

.nc-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.nc-title {
  font-size: 14px;
  font-weight: 700;
  color: #ece3d2;
  white-space: nowrap;
}

.nc-desc {
  font-size: 12px;
  color: #9a8b74;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

@media (max-width: 1100px) {
  .nav-cards { flex-wrap: wrap; }
  .nav-card { flex: 1 1 30%; min-width: 150px; }
}

@media (max-width: 700px) {
  .nav-card { flex: 1 1 100%; }
}

.home-main {
  flex: 1;
  width: 100%;
  max-width: 1440px;
  margin: 0 auto;
  padding: 26px 28px 44px;
  box-sizing: border-box;
}

/* ---------- 银幕 ---------- */
.screen {
  border-radius: 6px;
  overflow: hidden;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.55), 0 0 0 1px #2c231b;
  margin-bottom: 30px;
  filter: brightness(0.25) saturate(0.6);
  transition: filter 1.6s ease;
}

.screen.on {
  filter: brightness(1) saturate(1);
}

.slide {
  position: relative;
  height: 100%;
  cursor: pointer;
}

.slide-bg {
  position: absolute;
  inset: -50px;
  background-size: cover;
  background-position: center;
  filter: blur(28px) brightness(0.42);
  animation: kb 26s ease-in-out infinite alternate;
}

@keyframes kb {
  from { transform: scale(1.05) translateX(-1.2%); }
  to { transform: scale(1.16) translateX(1.2%); }
}

.slide-shade {
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, rgba(16, 14, 12, 0.86) 0%, rgba(16, 14, 12, 0.38) 58%, rgba(16, 14, 12, 0.6) 100%),
    linear-gradient(180deg, transparent 55%, #100e0c 100%);
}

.slide-body {
  position: relative;
  height: 100%;
  display: flex;
  align-items: center;
  gap: 40px;
  padding: 30px 52px;
  box-sizing: border-box;
}

.slide-poster {
  height: 88%;
  max-height: 348px;
  aspect-ratio: 2 / 3;
  object-fit: cover;
  border-radius: 8px;
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.65);
  flex-shrink: 0;
}

.slide-info {
  min-width: 0;
  max-width: 640px;
}

.kicker {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 14px;
  color: #9a8b74;
}

.rank-badge {
  background: #e0a458;
  color: #100e0c;
  font-size: 14px;
  padding: 2px 8px 1px;
  border-radius: 6px;
}

.cats {
  color: #cfc2ac;
}

.slide-title {
  margin: 12px 0 6px;
  font-size: 40px;
  line-height: 1.22;
  font-weight: 800;
  color: #ece3d2;
  display: flex;
  align-items: baseline;
  gap: 14px;
  text-shadow: 0 4px 18px rgba(0, 0, 0, 0.55);
}

.slide-year {
  font-size: 30px;
  color: #e0a458;
  font-weight: 400;
}

.slide-scores {
  display: flex;
  gap: 20px;
  margin: 10px 0 6px;
}

.sc {
  display: inline-flex;
  align-items: baseline;
  gap: 7px;
  font-size: 12px;
  color: #9a8b74;
}

.sc i {
  font-style: normal;
  font-size: 24px;
}

.sc.douban i { color: #93c78f; }
.sc.tmdb i { color: #e6c37a; }
.sc.mine i { color: #8fd8b4; }

.slide-synopsis {
  margin: 10px 0 20px;
  font-size: 14px;
  line-height: 1.9;
  color: #cfc2ac;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.slide-actions {
  display: flex;
  gap: 14px;
}

@media (max-width: 760px) {
  .slide-body {
    flex-direction: column;
    justify-content: center;
    padding: 24px;
    gap: 18px;
    text-align: center;
  }

  .slide-poster {
    height: auto;
    width: 148px;
  }

  .slide-title {
    font-size: 26px;
    justify-content: center;
    flex-wrap: wrap;
  }

  .kicker,
  .slide-scores,
  .slide-actions {
    justify-content: center;
  }
}

/* ---------- 今日放映 ---------- */
.daily {
  margin-bottom: 30px;
}

.daily-ticket {
  position: relative;
  display: flex;
  background: #17120d;
  border: 1px solid var(--line);
  border-radius: 10px;
  overflow: hidden;
  transition: box-shadow 0.25s, border-color 0.25s;
}

.daily-ticket:hover {
  border-color: rgba(224, 164, 88, 0.4);
  box-shadow: 0 14px 34px rgba(0, 0, 0, 0.45);
}

.daily-stub {
  position: relative;
  flex: 0 0 148px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 5px;
  background: #1e1710;
  border-right: 2px dashed #3a2e20;
}

/* 票根打孔 */
.daily-stub::before,
.daily-stub::after {
  content: '';
  position: absolute;
  right: -9px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--bg);
  z-index: 1;
}

.daily-stub::before { top: -8px; }
.daily-stub::after { bottom: -8px; }

.daily-label {
  font-size: 13px;
  letter-spacing: 5px;
  text-indent: 5px;
  color: var(--accent);
  font-weight: 600;
}

.daily-date {
  font-size: 42px;
  line-height: 1;
  color: var(--text);
}

.daily-week {
  font-size: 13px;
  color: var(--muted);
}

.daily-main {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 18px 24px;
  cursor: pointer;
}

.daily-poster {
  width: 86px;
  aspect-ratio: 2 / 3;
  object-fit: cover;
  border-radius: 6px;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.5);
  flex-shrink: 0;
}

.daily-info {
  min-width: 0;
  flex: 1;
}

.daily-title {
  margin: 0;
  font-size: 22px;
  font-weight: 700;
  color: var(--text);
  display: flex;
  align-items: baseline;
  gap: 10px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.daily-year {
  font-size: 18px;
  color: var(--accent);
  font-weight: 400;
}

.daily-meta {
  display: flex;
  align-items: baseline;
  gap: 16px;
  margin-top: 4px;
  flex-wrap: wrap;
}

.daily-q {
  font-size: 13px;
  color: #e6c37a;
  border: 1px solid rgba(230, 195, 122, 0.45);
  border-radius: 5px;
  padding: 0 6px;
}

.daily-cats {
  font-size: 12px;
  color: var(--muted);
}

.daily-synopsis {
  margin: 6px 0 10px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--text-2);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.daily-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.replay-tag {
  font-size: 12px;
  color: #9aab6e;
  border: 1px solid rgba(154, 171, 110, 0.4);
  padding: 1px 9px;
  border-radius: 12px;
}

@media (max-width: 760px) {
  .daily-ticket {
    flex-direction: column;
  }

  .daily-stub {
    flex: none;
    flex-direction: row;
    gap: 14px;
    padding: 10px;
    border-right: none;
    border-bottom: 2px dashed #3a2e20;
  }

  .daily-stub::before,
  .daily-stub::after {
    right: auto;
    bottom: -9px;
  }

  .daily-stub::before { left: -8px; }
  .daily-stub::after { right: -8px; }

  .daily-date {
    font-size: 26px;
  }

  .daily-main {
    flex-direction: column;
    text-align: center;
  }

  .daily-title {
    justify-content: center;
    white-space: normal;
  }

  .daily-meta,
  .daily-actions {
    justify-content: center;
  }
}

/* ---------- 统计速览 ---------- */
.quick-stats {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 12px;
  margin-bottom: 28px;
}

@media (max-width: 1100px) {
  .quick-stats { grid-template-columns: repeat(3, 1fr); }
}

@media (max-width: 620px) {
  .quick-stats { grid-template-columns: repeat(2, 1fr); }
}

.qcard {
  display: flex;
  align-items: center;
  gap: 12px;
  background: transparent;
  border: none;
  border-left: 2px solid #2c231b;
  border-radius: 0;
  padding: 10px 4px 10px 14px;
  cursor: pointer;
  text-align: left;
  transition: border-color 0.25s;
}

.qcard:hover {
  border-left-color: #e0a458;
}

.qcard:hover .qnum {
  color: #e0a458;
}

.qicon {
  display: flex;
}

.qnum {
  font-size: 30px;
  line-height: 1;
  color: #ece3d2;
  transition: color 0.25s;
}

.qnum.small {
  font-size: 19px;
  line-height: 1.4;
}

.qlabel {
  font-size: 12px;
  color: #9a8b74;
  align-self: flex-end;
  padding-bottom: 3px;
}

/* ---------- 进入电影库 ---------- */
.cta-zone {
  display: flex;
  justify-content: center;
  margin-bottom: 34px;
}

.cta-btn {
  font-size: 16px;
  font-weight: 700;
  letter-spacing: 1px;
  padding: 22px 44px;
  height: auto;
}

/* ---------- 推荐位 ---------- */
.row-section {
  margin-bottom: 32px;
}

.sec-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 12px;
  border-bottom: 1px solid #241d16;
  padding-bottom: 10px;
}

.sec-title {
  margin: 0;
  font-size: 17px;
  font-weight: 700;
  color: #ece3d2;
}

.sec-more {
  margin-left: auto;
}

.h-scroll {
  display: flex;
  gap: 14px;
  overflow-x: auto;
  padding-bottom: 8px;
}

.h-scroll :deep(.movie-card) {
  flex: 0 0 138px;
}

/* ---------- 空库 ---------- */
.empty-hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 120px 20px 0;
  text-align: center;
}

.empty-logo {
  width: 64px;
  height: 64px;
  color: #e0a458;
}

.empty-hero h2 {
  margin: 0;
  font-size: 24px;
  color: #ece3d2;
}

.empty-hero p {
  margin: 0;
  color: #9a8b74;
  max-width: 480px;
  line-height: 1.9;
}

.hero-actions {
  display: flex;
  gap: 12px;
  margin-top: 8px;
}

/* ---------- 移动端银幕 ---------- */
@media (max-width: 700px) {
  .screen :deep(.el-carousel) { height: 520px !important; }
  .screen :deep(.el-carousel__container) { height: 520px !important; }
  .slide-body {
    flex-direction: column;
    align-items: center;
    text-align: center;
    padding: 18px 16px;
    gap: 14px;
  }
  .slide-poster { height: 240px; max-height: 240px; }
  .slide-info { max-width: 100%; display: flex; flex-direction: column; align-items: center; }
  .slide-synopsis { display: none; }
  .slide-title { font-size: 22px; }
  .daily-ticket { flex-direction: column; }
  .daily-main { flex-direction: column; }
  .daily-poster { width: 60%; margin: 0 auto; }
}
</style>
