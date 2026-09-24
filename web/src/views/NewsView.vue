<script setup>
import { onMounted, ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { ArrowLeft, HomeFilled, Film, Calendar, TrendCharts, Star, Plus, Check, Loading, VideoPlay } from '@element-plus/icons-vue'
import { api } from '../api'
import Logo from '../components/Logo.vue'

const router = useRouter()
const data = ref(null)
const loading = ref(true)
const tab = ref('now')
const wanting = ref(0)
const detail = ref(null)
const detailVisible = ref(false)
const detailFull = ref(null)
const detailLoading = ref(false)
const trailerPlaying = ref(false)

const TABS = [
  { key: 'now', label: '正在热映', icon: Film },
  { key: 'soon', label: '即将上映', icon: Calendar },
  { key: 'hot', label: '每周热门', icon: TrendCharts }
]

const items = computed(() => data.value?.[tab.value] || [])

const TMDB_IMG = null // 海报走服务端代理缓存 /covers/news/
function poster(m) {
  return m.poster_url || `/api/news/poster/${m.tmdb_id}`
}

async function load() {
  loading.value = true
  try {
    data.value = await api.news()
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    loading.value = false
  }
}

async function addWant(m) {
  wanting.value = m.tmdb_id
  try {
    await api.newsWant(m.tmdb_id)
    m.in_wishlist = true
    ElMessage.success(`《${m.title}》已加入想看`)
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    wanting.value = 0
  }
}

function openDetail(m) {
  detail.value = m
  detailVisible.value = true
  trailerPlaying.value = false // 预告片默认折叠
  // 拉完整详情：演职员 + 时长 + 预告片
  detailFull.value = null
  detailLoading.value = true
  api.newsDetail(m.tmdb_id)
    .then(d => { detailFull.value = d })
    .catch(() => {})
    .finally(() => { detailLoading.value = false })
}

function fmtDate(d) {
  if (!d) return ''
  return d.replace(/-/g, '.')
}

onMounted(load)
</script>

<template>
  <div class="news-page">
    <header class="topbar">
      <div class="brand" @click="router.push('/')">
        <Logo class="logo" />
        <span>电影中心</span>
      </div>
      <el-tooltip content="返回上一页" placement="bottom">
        <el-button circle @click="router.back()"><el-icon><ArrowLeft /></el-icon></el-button>
      </el-tooltip>
      <el-tooltip content="首页" placement="bottom">
        <el-button circle @click="router.push('/')"><el-icon><HomeFilled /></el-icon></el-button>
      </el-tooltip>
      <span class="title">影讯</span>
      <div class="spacer"></div>
      <el-button text :loading="loading" @click="load">
        <el-icon><Loading /></el-icon>刷新
      </el-button>
    </header>

    <main class="news-main" v-loading="loading">
      <div class="tabs">
        <button
          v-for="t in TABS"
          :key="t.key"
          class="tab"
          :class="{ active: tab === t.key }"
          @click="tab = t.key"
        >
          <el-icon><component :is="t.icon" /></el-icon>
          {{ t.label }}
          <span v-if="data?.[t.key]?.length" class="count">{{ data[t.key].length }}</span>
        </button>
      </div>

      <div v-if="data?.errors?.[tab]" class="err-tip">{{ data.errors[tab] }}</div>

      <div v-else-if="items.length" class="grid">
        <div v-for="m in items" :key="m.tmdb_id" class="card" @click="openDetail(m)">
          <div class="poster-wrap">
            <img v-if="poster(m)" :src="poster(m)" loading="lazy" :alt="m.title" />
            <div v-else class="no-poster">{{ m.title }}</div>
            <span v-if="m.vote_average" class="rate">★ {{ m.vote_average.toFixed(1) }}</span>
            <span v-if="m.in_library" class="in-lib">已在库</span>
          </div>
          <div class="info">
            <div class="name" :title="m.title">{{ m.title }}</div>
            <div class="date">{{ fmtDate(m.release_date) }}</div>
          </div>
          <el-button
            v-if="!m.in_wishlist && !m.in_library"
            class="want-btn"
            size="small"
            circle
            :loading="wanting === m.tmdb_id"
            @click.stop="addWant(m)"
          >
            <el-icon><Plus /></el-icon>
          </el-button>
          <el-button v-else-if="m.in_wishlist" class="want-btn had" size="small" circle @click.stop>
            <el-icon><Star /></el-icon>
          </el-button>
          <el-button v-else class="want-btn had" size="small" circle @click.stop>
            <el-icon><Check /></el-icon>
          </el-button>
        </div>
      </div>
      <el-empty v-else-if="!loading" description="暂无影讯（需在设置中配置 TMDB API Key）" />
    </main>

    <!-- 影片详情弹窗 -->
    <el-dialog v-model="detailVisible" width="720px" append-to-body class="news-detail">
      <div v-if="detail" class="nd-body">
        <div class="nd-poster">
          <img v-if="poster(detail)" :src="poster(detail)" :alt="detail.title" />
        </div>
        <div class="nd-info">
          <div class="nd-title">{{ detail.title }}</div>
          <div v-if="detail.original_title && detail.original_title !== detail.title" class="nd-orig">{{ detail.original_title }}</div>
          <div class="nd-meta">
            <span v-if="detail.year">{{ detail.year }}</span>
            <span v-if="detailFull?.runtime_text"> · {{ detailFull.runtime_text }}</span>
            <span v-if="detail.vote_average"> · TMDB ★ {{ detail.vote_average.toFixed(1) }}</span>
            <span v-if="detail.release_date"> · {{ fmtDate(detail.release_date) }} 上映</span>
          </div>
          <div v-if="detailFull?.genres?.length" class="nd-genres">
            <el-tag v-for="g in detailFull.genres" :key="g" size="small" effect="plain" round>{{ g }}</el-tag>
          </div>
          <div v-if="detail.in_library && detail.movie_id" class="nd-lib">
            <el-tag type="warning" effect="dark" size="small">已在库</el-tag>
            <el-button size="small" @click="router.push(`/movies?movie=${detail.movie_id}`); detailVisible = false">查看详情</el-button>
          </div>
          <div class="nd-overview">{{ (detailFull && detailFull.overview) || detail.overview || '暂无简介' }}</div>
          <div class="nd-actions">
            <el-button
              v-if="!detail.in_wishlist && !detail.in_library"
              type="primary"
              :loading="wanting === detail.tmdb_id"
              @click="addWant(detail)"
            >加入想看</el-button>
            <el-tag v-else-if="detail.in_wishlist" type="warning" effect="plain">已在想看清单</el-tag>
            <el-tag v-else-if="detail.in_library" type="success" effect="plain">已在库</el-tag>
          </div>
        </div>
      </div>

      <!-- 完整详情：导演 / 演员 / 预告片 -->
      <div v-loading="detailLoading" class="nd-extra">
        <template v-if="detailFull">
          <div v-if="detailFull.directors?.length" class="nd-sec">
            <div class="nd-sec-title">导演</div>
            <div class="nd-directors">
              <div v-for="d2 in detailFull.directors" :key="d2.name" class="nd-director">
                <img v-if="d2.profile" :src="d2.profile" :alt="d2.name" loading="lazy" />
                <div v-else class="nd-p-noimg">{{ d2.name[0] }}</div>
                <span class="nd-person-name">{{ d2.name }}</span>
              </div>
            </div>
          </div>
          <div v-if="detailFull.cast?.length" class="nd-sec">
            <div class="nd-sec-title">主演</div>
            <div class="nd-cast">
              <div v-for="c in detailFull.cast" :key="c.name" class="nd-cast-item">
                <img v-if="c.profile" :src="c.profile" :alt="c.name" loading="lazy" />
                <div v-else class="nd-p-noimg">{{ c.name[0] }}</div>
                <div class="nd-cast-name">{{ c.name }}</div>
                <div class="nd-cast-char">{{ c.character }}</div>
              </div>
            </div>
          </div>
          <div v-if="detailFull.trailer" class="nd-sec">
            <div class="nd-sec-title">预告片</div>
            <div v-if="!trailerPlaying" class="nd-trailer-cover" @click="trailerPlaying = true">
              <img v-if="poster(detail)" :src="poster(detail)" :alt="detail.title" loading="lazy" />
              <div class="nd-trailer-play">
                <el-icon :size="44"><VideoPlay /></el-icon>
                <span>{{ detailFull.trailer.name || '播放预告片' }}</span>
              </div>
            </div>
            <div v-else class="nd-trailer">
              <iframe
                :src="`https://www.youtube.com/embed/${detailFull.trailer.key}?rel=0&autoplay=1`"
                :title="detailFull.trailer.name"
                frameborder="0"
                allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
                allowfullscreen
              ></iframe>
            </div>
          </div>
        </template>
      </div>
    </el-dialog>
  </div>
</template>

<style scoped>
.news-page { min-height: 100%; display: flex; flex-direction: column; }

.topbar {
  position: sticky; top: 0; z-index: 20;
  display: flex; align-items: center; gap: 12px;
  padding: 14px 28px;
  background: rgba(16, 14, 12, 0.86);
  backdrop-filter: blur(10px);
  border-bottom: 1px solid #241d16;
}
.brand { display: flex; align-items: center; gap: 9px; font-size: 18px; font-weight: 700; letter-spacing: 2px; cursor: pointer; color: #ece3d2; }
.logo { width: 26px; height: 26px; color: #e0a458; }
.title { font-size: 17px; font-weight: 700; color: #e6c37a; }
.spacer { flex: 1; }

.news-main { flex: 1; max-width: 1400px; width: 100%; margin: 0 auto; padding: 20px 28px 50px; box-sizing: border-box; }

.tabs { display: flex; gap: 10px; margin-bottom: 20px; flex-wrap: wrap; }
.tab {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 8px 18px;
  background: #1a1511;
  border: 1px solid #2e241b;
  border-radius: 20px;
  color: #9a8b74;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;
}
.tab:hover { border-color: #e0a458; color: #d8c9a8; }
.tab.active { background: rgba(224, 164, 88, 0.14); border-color: #e0a458; color: #e6c37a; }
.count { font-size: 12px; opacity: 0.7; }

.err-tip {
  padding: 14px 18px;
  background: rgba(224, 122, 106, 0.08);
  border: 1px solid rgba(224, 122, 106, 0.3);
  border-radius: 8px;
  color: #e07a6a;
  font-size: 13px;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 18px;
}

.card { position: relative; cursor: default; }
.card .poster-wrap { cursor: pointer; }

.poster-wrap {
  position: relative;
  aspect-ratio: 2 / 3;
  border-radius: 8px;
  overflow: hidden;
  background: #1a1511;
  border: 1px solid #2e241b;
}
.poster-wrap img { width: 100%; height: 100%; object-fit: cover; display: block; }
.no-poster {
  width: 100%; height: 100%;
  display: flex; align-items: center; justify-content: center;
  padding: 12px; box-sizing: border-box;
  text-align: center;
  color: #6a5c4a; font-size: 13px;
}

.rate {
  position: absolute; top: 6px; left: 6px;
  background: rgba(16, 14, 12, 0.82);
  color: #e0a458;
  font-size: 12px;
  padding: 2px 7px;
  border-radius: 5px;
}

.in-lib {
  position: absolute; top: 6px; right: 6px;
  background: #e0a458;
  color: #100e0c;
  font-size: 11px;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 5px;
}

.info { margin-top: 8px; }
.name {
  font-size: 14px; font-weight: 600; color: #ece3d2;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.date { font-size: 12px; color: #9a8b74; margin-top: 3px; }

.want-btn {
  position: absolute; bottom: 58px; right: 8px;
}
.want-btn.had { pointer-events: none; opacity: 0.85; }

/* 详情弹窗 */
.nd-body { display: flex; gap: 20px; }
.nd-extra { min-height: 60px; }

.nd-sec { margin-top: 18px; }
.nd-sec-title {
  font-size: 14px; font-weight: 700; color: #e6c37a;
  margin-bottom: 10px;
  padding-bottom: 6px;
  border-bottom: 1px solid #241d16;
}

.nd-directors { display: flex; gap: 16px; flex-wrap: wrap; }
.nd-director { display: flex; align-items: center; gap: 10px; }
.nd-director img, .nd-p-noimg {
  width: 44px; height: 44px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
}
.nd-p-noimg {
  background: #221b14;
  color: #9a8b74;
  display: flex; align-items: center; justify-content: center;
  font-size: 16px;
}
.nd-person-name { font-size: 14px; font-weight: 600; color: #ece3d2; }

.nd-cast {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(88px, 1fr));
  gap: 12px;
}
.nd-cast-item { text-align: center; min-width: 0; }
.nd-cast-item img, .nd-cast-item .nd-p-noimg {
  width: 100%;
  aspect-ratio: 2 / 3;
  border-radius: 6px;
  object-fit: cover;
  display: block;
  margin: 0 auto;
}
.nd-cast-item .nd-p-noimg { font-size: 22px; width: 100%; aspect-ratio: 2 / 3; }
.nd-cast-name {
  font-size: 12px; font-weight: 600; color: #d8c9a8;
  margin-top: 6px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.nd-cast-char {
  font-size: 11px; color: #7d7160;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}

.nd-trailer {
  position: relative;
  width: 100%;
  padding-top: 56.25%;
  border-radius: 8px;
  overflow: hidden;
  background: #000;
}
.nd-trailer iframe {
  position: absolute; inset: 0;
  width: 100%; height: 100%;
  border: 0;
}

/* 折叠态封面：海报 + 播放按钮 */
.nd-trailer-cover {
  position: relative;
  width: 100%;
  padding-top: 56.25%;
  border-radius: 8px;
  overflow: hidden;
  background: #1a1511;
  border: 1px solid #2e241b;
  cursor: pointer;
}
.nd-trailer-cover img {
  position: absolute; inset: 0;
  width: 100%; height: 100%;
  object-fit: cover;
  opacity: 0.55;
  transition: opacity 0.25s, transform 0.25s;
}
.nd-trailer-cover:hover img { opacity: 0.7; transform: scale(1.03); }
.nd-trailer-cover:hover .nd-trailer-play { color: #e6c37a; }
.nd-trailer-play {
  position: absolute; inset: 0;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 10px;
  color: #ece3d2;
  font-size: 14px;
  transition: color 0.25s;
}
.nd-trailer-play .el-icon {
  width: 76px; height: 76px;
  border-radius: 50%;
  background: rgba(16, 14, 12, 0.72);
  border: 2px solid #e0a458;
  display: flex; align-items: center; justify-content: center;
  padding-left: 6px;
}

.nd-genres { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }

.nd-poster {
  width: 180px; flex-shrink: 0;
  aspect-ratio: 2 / 3;
  border-radius: 8px;
  overflow: hidden;
  background: #1a1511;
  border: 1px solid #2e241b;
}
.nd-poster img { width: 100%; height: 100%; object-fit: cover; display: block; }
.nd-info { flex: 1; min-width: 0; }
.nd-title { font-size: 20px; font-weight: 700; color: #ece3d2; }
.nd-orig { font-size: 13px; color: #9a8b74; margin-top: 3px; }
.nd-meta { font-size: 13px; color: #9a8b74; margin-top: 8px; }
.nd-lib { display: flex; align-items: center; gap: 10px; margin-top: 10px; }
.nd-overview {
  font-size: 13px; line-height: 1.7; color: #c9bda6;
  margin-top: 12px;
  display: -webkit-box;
  -webkit-line-clamp: 8;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.nd-actions { margin-top: 16px; }

@media (max-width: 700px) {
  .news-main { padding: 12px 12px 40px; }
  .grid { grid-template-columns: repeat(3, 1fr); gap: 10px; }
  .tabs { gap: 8px; }
  .tab { padding: 6px 13px; font-size: 13px; }
  .nd-body { flex-direction: column; align-items: center; }
  .nd-poster { width: 140px; }
  .nd-info { width: 100%; }
}
</style>
