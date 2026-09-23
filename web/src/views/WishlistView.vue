<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowLeft, ArrowRight, HomeFilled, Plus, Delete, Link, Connection, Picture, MagicStick } from '@element-plus/icons-vue'
import { api } from '../api'
import Logo from '../components/Logo.vue'
import MovieDetail from '../components/MovieDetail.vue'

const router = useRouter()

const tab = ref('wanted')
const loading = ref(false)
const items = ref([])

const importVisible = ref(false)
const importText = ref('')
const importing = ref(false)
const importResult = ref(null)

const enriching = ref(false)
const matching = ref(false)

// 豆瓣账号同步
const syncVisible = ref(false)
const syncUid = ref('')
const syncStarting = ref(false)
const sync = ref({ running: false, phase: '', total: 0, processed: 0, wantedAdded: 0, wantedExisted: 0, watchedMatched: 0, error: null, finishedAt: null })
let syncTimer = null

const syncPhaseLabel = computed(() => {
  if (sync.value.phase === 'wish') return '正在拉取想看片单…'
  if (sync.value.phase === 'done') return '正在拉取已看片单…'
  return sync.value.running ? '同步中…' : ''
})

async function startSync() {
  const uid = syncUid.value.trim()
  if (uid && !/^\d+$/.test(uid)) {
    ElMessage.warning('UID 需为纯数字')
    return
  }
  syncStarting.value = true
  try {
    const r = await api.doubanWishlistSync(uid || undefined)
    ElMessage.success(`开始同步（想看共 ${r.wish_total} 部，后台进行）`)
    syncVisible.value = false
    startSyncPolling()
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    syncStarting.value = false
  }
}

function startSyncPolling() {
  stopSyncPolling()
  syncTimer = setInterval(async () => {
    try {
      const st = await api.doubanWishlistSyncStatus()
      sync.value = st
      if (!st.running) {
        stopSyncPolling()
        if (st.error) {
          ElMessage.error(`同步失败：${st.error}`)
        } else {
          ElMessage.success(`同步完成：新增想看 ${st.wantedAdded}，已有 ${st.wantedExisted}，已看对号 ${st.watchedMatched} 部`)
        }
        await load()
      }
    } catch {}
  }, 1500)
}

function stopSyncPolling() {
  if (syncTimer) {
    clearInterval(syncTimer)
    syncTimer = null
  }
}

onMounted(() => {
  load()
  // 页面打开时若同步正在进行，接上进度
  api.doubanWishlistSyncStatus().then(st => {
    if (st.running) startSyncPolling()
  }).catch(() => {})
})

onBeforeUnmount(stopSyncPolling)

const detailVisible = ref(false)
const detailMovie = ref(null)

const wantedCount = computed(() => items.value.length)

async function load() {
  loading.value = true
  try {
    const r = await api.wishlist(tab.value === 'all' ? '' : tab.value)
    items.value = r.items
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    loading.value = false
  }
}

function onTabChange() { load() }

async function doImport() {
  if (!importText.value.trim()) return
  importing.value = true
  importResult.value = null
  try {
    const r = await api.importWishlist(importText.value)
    importResult.value = r
    ElMessage.success(`已导入 ${r.imported} 条（${r.matched} 部已在库中）`)
    await load()
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    importing.value = false
  }
}

async function enrich() {
  enriching.value = true
  try {
    const r = await api.enrichWishlist(20)
    if (r.enriched) {
      ElMessage.success(`已为 ${r.enriched} 部影片获取海报`)
      await load()
    } else {
      ElMessage.info('没有需要补海报的条目')
    }
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    enriching.value = false
  }
}

async function matchNow() {
  matching.value = true
  try {
    const r = await api.matchWishlist()
    if (r.matched) {
      ElMessage.success(`新匹配到 ${r.matched} 部库内影片`)
      await load()
    } else {
      ElMessage.info('没有新的匹配')
    }
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    matching.value = false
  }
}

async function markIgnored(item) {
  try {
    await api.setWishlistStatus(item.id, 'ignored')
    await load()
  } catch (e) {
    ElMessage.error(e.message)
  }
}

async function markWantedAgain(item) {
  try {
    await api.setWishlistStatus(item.id, 'wanted')
    await load()
  } catch (e) {
    ElMessage.error(e.message)
  }
}

async function removeItem(item) {
  try {
    await ElMessageBox.confirm(`删除「${item.title}」？`, '提示', { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' })
  } catch { return }
  try {
    await api.removeWishlistItem(item.id)
    items.value = items.value.filter(x => x.id !== item.id)
  } catch (e) {
    ElMessage.error(e.message)
  }
}

async function openMovie(item) {
  if (!item.movie_id) return
  try {
    detailMovie.value = await api.movie(item.movie_id)
    detailVisible.value = true
  } catch (e) {
    ElMessage.error(e.message)
  }
}

onMounted(load)
</script>

<template>
  <div class="wish-page">
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
      <span class="title">想看清单</span>
      <div class="spacer"></div>
    </header>

    <main class="wish-main">
      <!-- 动作卡片 -->
      <div class="action-cards">
        <div class="action-card primary" @click="syncVisible = true">
          <div class="ac-icon"><el-icon :size="26"><Link /></el-icon></div>
          <div class="ac-body">
            <div class="ac-title">豆瓣账号同步</div>
            <div class="ac-desc">输入 UID，一键拉取想看 + 已看片单，评分与观影记录自动对号</div>
          </div>
          <el-icon class="ac-arrow"><ArrowRight /></el-icon>
        </div>
        <div class="action-card" @click="importVisible = true">
          <div class="ac-icon"><el-icon :size="26"><Plus /></el-icon></div>
          <div class="ac-body">
            <div class="ac-title">粘贴导入</div>
            <div class="ac-desc">复制豆瓣想看列表文本，粘贴解析入库</div>
          </div>
          <el-icon class="ac-arrow"><ArrowRight /></el-icon>
        </div>
        <div class="action-card" @click="matchNow">
          <div class="ac-icon"><el-icon :size="26"><Connection /></el-icon></div>
          <div class="ac-body">
            <div class="ac-title">匹配库内影片</div>
            <div class="ac-desc">把想看条目和本地影库对号，已有的标记「已入库」</div>
          </div>
          <el-icon class="ac-arrow"><ArrowRight /></el-icon>
        </div>
        <div class="action-card" @click="enrich">
          <div class="ac-icon"><el-icon :size="26"><Picture /></el-icon></div>
          <div class="ac-body">
            <div class="ac-title">补全海报</div>
            <div class="ac-desc">用 TMDB 为缺海报的条目搜索下载海报</div>
          </div>
          <el-icon class="ac-arrow"><ArrowRight /></el-icon>
        </div>
      </div>

      <div class="toolbar">
        <el-radio-group v-model="tab" @change="onTabChange">
          <el-radio-button value="wanted">想看</el-radio-button>
          <el-radio-button value="obtained">已入库</el-radio-button>
          <el-radio-button value="all">全部</el-radio-button>
        </el-radio-group>
      </div>

      <!-- 同步进度 -->
      <div v-if="sync.running" class="sync-box">
        <el-progress :percentage="sync.total ? Math.min(100, Math.round(sync.processed / sync.total * 100)) : 0" :stroke-width="8" />
        <div class="hint">{{ syncPhaseLabel }} 已处理 {{ sync.processed }} 部（防限流，每页间隔 1.2 秒，请耐心等待）</div>
      </div>

      <div v-if="!loading && !items.length" class="empty">
        <el-icon :size="44"><MagicStick /></el-icon>
        <p v-if="tab === 'wanted'">想看清单是空的</p>
        <p v-else-if="tab === 'obtained'">还没有想看的影片入库</p>
        <p v-else>没有条目</p>
        <p v-if="tab === 'obtained'" class="sub">下载想看的电影放进影库目录，扫描后会自动出现在这里并标记「已入库」</p>
        <p v-else class="sub">点上方「豆瓣账号同步」拉取你的豆瓣想看片单，或「粘贴导入」</p>
      </div>

      <div v-loading="loading" class="grid">
        <div v-for="w in items" :key="w.id" class="wish-card" :class="{ got: w.status === 'obtained' }">
          <div class="poster" @click="openMovie(w)">
            <img v-if="w.poster_url" :src="w.poster_url" loading="lazy" alt="" />
            <div v-else class="ph"><span>{{ w.title }}</span></div>
            <span v-if="w.status === 'obtained'" class="badge ok">已入库</span>
            <span v-else-if="w.status === 'ignored'" class="badge off">已忽略</span>
            <span v-if="w.status === 'obtained' && w.douban_rating" class="badge db font-display">豆瓣 {{ Number(w.douban_rating).toFixed(1) }}</span>
          </div>
          <div class="info">
            <div class="t" :title="w.title">{{ w.title }}</div>
            <div class="m">
              <span v-if="w.year" class="font-display">{{ w.year }}</span>
              <span v-if="w.original_title" class="orig">{{ w.original_title }}</span>
            </div>
            <div class="ops">
              <el-button v-if="w.status === 'wanted'" link size="small" @click="markIgnored(w)">忽略</el-button>
              <el-button v-else-if="w.status === 'ignored'" link size="small" @click="markWantedAgain(w)">恢复</el-button>
              <el-button link type="danger" size="small" @click="removeItem(w)">删除</el-button>
            </div>
          </div>
        </div>
      </div>
    </main>

    <MovieDetail v-model="detailVisible" :movie="detailMovie" @updated="m => (detailMovie = m)" @open-movie="id => openMovie({ movie_id: id })" />

    <el-dialog v-model="syncVisible" title="豆瓣账号同步" width="480px">
      <p class="imp-tip">
        输入豆瓣 UID，自动同步你的「想看」和「已看」片单：
        想看直接进清单（带海报和评分）；已看的自动和库内影片对号（标记已看、回填你的豆瓣评分、写入观影日记）。
      </p>
      <el-input v-model="syncUid" placeholder="豆瓣 UID（个人主页地址里 people/ 后面的数字）" clearable>
        <template #prepend>UID</template>
      </el-input>
      <p class="imp-tip" style="margin-top: 8px">
        前提：豆瓣隐私设置允许陌生人查看你的「想看」「看过」。大列表同步需几分钟（防限流限速）。
      </p>
      <template #footer>
        <el-button @click="syncVisible = false">取消</el-button>
        <el-button type="primary" :loading="syncStarting" @click="startSync">开始同步</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="importVisible" title="导入豆瓣想看列表" width="560px">
      <p class="imp-tip">
        打开 <a href="https://movie.douban.com/mine" target="_blank">豆瓣 - 我的电影</a> → 想看，
        复制列表内容粘贴到下方（每行一部，支持「片名 / 原名 (年份)」、带序号等格式）。
        已在库中的影片会自动标记为「已入库」。
      </p>
      <el-input
        v-model="importText"
        type="textarea"
        :rows="10"
        placeholder="例如：
霸王别姬 / Farewell My Concubine (1993)
1. 星际穿越 (2014)
2. 阿凡达"
      />
      <div v-if="importResult" class="imp-result">
        解析 {{ importResult.parsed }} 条 · 新导入 {{ importResult.imported }} · 重复 {{ importResult.duplicated }} · 库中已有 {{ importResult.matched }}
      </div>
      <template #footer>
        <el-button @click="importVisible = false">关闭</el-button>
        <el-button type="primary" :loading="importing" @click="doImport">导入</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.wish-page { min-height: 100%; display: flex; flex-direction: column; }

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

.wish-main { flex: 1; max-width: 1440px; width: 100%; margin: 0 auto; padding: 22px 28px 50px; box-sizing: border-box; }

.toolbar { display: flex; align-items: center; justify-content: space-between; gap: 14px; margin-bottom: 18px; flex-wrap: wrap; }
.tools { display: flex; gap: 8px; }

/* ---------- 动作卡片 ---------- */
.action-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 14px;
  margin-bottom: 22px;
}

.action-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px 18px;
  background: #1a1511;
  border: 1px solid #2e241b;
  border-radius: 10px;
  cursor: pointer;
  transition: border-color 0.2s, transform 0.2s, box-shadow 0.2s;
}

.action-card:hover {
  border-color: rgba(224, 164, 88, 0.55);
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
}

.action-card.primary {
  border-color: rgba(224, 164, 88, 0.5);
  background: linear-gradient(135deg, #241d14, #1a1511 60%);
}

.ac-icon {
  flex-shrink: 0;
  width: 48px;
  height: 48px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(224, 164, 88, 0.14);
  color: #e0a458;
}

.ac-body { flex: 1; min-width: 0; }

.ac-title {
  font-size: 15px;
  font-weight: 700;
  color: #ece3d2;
}

.ac-desc {
  margin-top: 3px;
  font-size: 12px;
  line-height: 1.5;
  color: #9a8b74;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.ac-arrow {
  flex-shrink: 0;
  color: #6a5c4a;
  transition: transform 0.2s, color 0.2s;
}

.action-card:hover .ac-arrow {
  transform: translateX(3px);
  color: #e0a458;
}

@media (max-width: 900px) {
  .action-cards { grid-template-columns: 1fr; }
}

.empty { text-align: center; padding: 90px 0; color: #6a5c4a; }
.empty p { margin: 12px 0 0; font-size: 15px; color: #9a8b74; }
.empty .sub { font-size: 13px; }

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 18px;
}

.wish-card { min-width: 0; }
.wish-card .poster {
  position: relative; aspect-ratio: 2 / 3; border-radius: 8px; overflow: hidden;
  background: #1a1511; outline: 1px solid rgba(44,35,27,0.6);
  cursor: pointer; box-shadow: 0 2px 10px rgba(0,0,0,0.4);
}
.wish-card .poster img { width: 100%; height: 100%; object-fit: cover; display: block; }
.ph {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  padding: 12px; text-align: center; font-size: 13px; line-height: 1.5; color: rgba(236,227,210,0.4);
}
.badge {
  position: absolute; top: 8px; left: 8px;
  font-size: 12px; border-radius: 6px; padding: 1px 7px;
  backdrop-filter: blur(4px);
}
.badge.ok { background: rgba(122,138,84,0.92); color: #0f0d0b; }
.badge.off { background: rgba(90,78,62,0.92); color: #d8ccb8; }
.badge.db { left: auto; right: 8px; top: auto; bottom: 8px; background: rgba(224,164,88,0.9); color: #100e0c; font-size: 11px; }

.sync-box {
  background: #1a1511;
  border: 1px solid #2e241b;
  border-radius: 8px;
  padding: 14px 16px;
  margin-bottom: 18px;
}

.sync-box .hint { margin-top: 8px; font-size: 13px; color: #9a8b74; }

.wish-card.got .poster { outline-color: rgba(154,171,110, 0.5); }

.info { padding: 8px 2px 0; }
.t { font-size: 13px; font-weight: 600; color: #ece3d2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.m { margin-top: 2px; font-size: 12px; color: #9a8b74; display: flex; gap: 6px; align-items: baseline; min-height: 16px; }
.orig { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 110px; }
.ops { margin-top: 4px; display: flex; gap: 2px; }

.imp-tip { margin: 0 0 10px; font-size: 13px; line-height: 1.7; color: #9a8b74; }
.imp-tip a { color: #e0a458; }
.imp-result { margin-top: 10px; font-size: 13px; color: #8fd8b4; }

/* ---------- 移动端顶栏 ---------- */
@media (max-width: 700px) {
  .topbar {
    flex-wrap: wrap;
    padding: 10px 12px;
    gap: 8px;
  }
  .topbar .search,
  .topbar .sort,
  .topbar .pick-btn {
    width: auto;
    flex: 1 1 auto;
  }
  .topbar .search { min-width: 140px; order: 10; flex-basis: 100%; }
  .gsearch { width: 100% !important; order: 10; flex-basis: 100%; }
  .spacer, .topbar-spacer { flex: 1 1 auto; }
}

/* ---------- 移动端 ---------- */
@media (max-width: 700px) {
  .wish-main { padding: 14px 12px 40px; }
  .toolbar { flex-direction: column; align-items: stretch; }
  .grid { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
  .action-cards { grid-template-columns: 1fr; gap: 10px; }
  .action-card { padding: 12px 14px; }
}
</style>
