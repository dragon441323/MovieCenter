<script setup>
import { computed, onUnmounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useLibraryStore } from '../stores/library'
import { api } from '../api'

const store = useLibraryStore()
const { scanPaths, scanning, scanState } = storeToRefs(store)

const visible = defineModel({ type: Boolean, default: false })
const newPath = ref('')
const adding = ref(false)
const detecting = ref(false)

const apiKey = ref('')
const language = ref('zh-CN')
const proxyUrl = ref('')
const savingKey = ref(false)
const hasKey = computed(() => !!apiKey.value.trim())

const playerPath = ref('')
const detectingPlayer = ref(false)

const testing = ref(false)
const testResult = ref(null)

const batch = ref({ running: false, total: 0, processed: 0, applied: 0, skipped: 0, failed: 0, current: null, errors: [] })
let batchTimer = null

watch(visible, async v => {
  if (v) {
    await store.fetchScanPaths()
    if (!store.scanPaths.length) await detect(true)
    await store.fetchMeta()
    await loadSettings()
    await pollBatchOnce()
    loadDouban()
    pollDoubanOnce()
  } else {
    stopBatchPolling()
    stopDoubanPolling()
  }
})

async function loadSettings() {
  try {
    const s = await api.settings()
    apiKey.value = s.tmdb_api_key
    language.value = s.tmdb_language
    proxyUrl.value = s.tmdb_proxy
    playerPath.value = s.player_path
  } catch (e) {
    ElMessage.error(e.message)
  }
}

async function saveSettings(silent = false) {
  savingKey.value = true
  try {
    const s = await api.saveSettings({
      tmdb_api_key: apiKey.value.trim(),
      tmdb_language: language.value,
      tmdb_proxy: proxyUrl.value.trim(),
      player_path: playerPath.value.trim()
    })
    apiKey.value = s.tmdb_api_key
    language.value = s.tmdb_language
    proxyUrl.value = s.tmdb_proxy
    playerPath.value = s.player_path
    if (!silent) ElMessage.success('设置已保存')
    return true
  } catch (e) {
    ElMessage.error(e.message)
    return false
  } finally {
    savingKey.value = false
  }
}

async function detectPlayer() {
  detectingPlayer.value = true
  try {
    const r = await api.detectPlayer()
    if (r.path) {
      playerPath.value = r.path
      ElMessage.success('已自动检测到 PotPlayer')
      await saveSettings(true)
    } else {
      ElMessage.warning('未检测到 PotPlayer，请手动填写播放器路径')
    }
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    detectingPlayer.value = false
  }
}

async function testConnection() {
  testing.value = true
  testResult.value = null
  try {
    if (!(await saveSettings(true))) return
    testResult.value = await api.testScrape()
  } catch (e) {
    testResult.value = { ok: false, message: e.message }
  } finally {
    testing.value = false
  }
}

async function startBatch() {
  try {
    const r = await api.scrapeBatch()
    if (!r.total) {
      ElMessage.success('没有需要补全的电影，信息都很完整')
      return
    }
    ElMessage.success(`开始同步 ${r.total} 部电影`)
    startBatchPolling()
  } catch (e) {
    ElMessage.error(e.message)
  }
}

function startBatchPolling() {
  stopBatchPolling()
  batchTimer = setInterval(async () => {
    await pollBatchOnce()
    if (!batch.value.running) {
      stopBatchPolling()
      await Promise.all([store.fetchMovies(), store.fetchMeta()])
    }
  }, 1000)
}

async function pollBatchOnce() {
  try {
    const st = await api.scrapeBatchStatus()
    batch.value = st
    if (st.running && !batchTimer) startBatchPolling()
  } catch {}
}

function stopBatchPolling() {
  if (batchTimer) {
    clearInterval(batchTimer)
    batchTimer = null
  }
}

onUnmounted(() => {
  stopBatchPolling()
  stopDoubanPolling()
})

async function detect(silent = false) {
  detecting.value = true
  try {
    const r = await api.detectScanPaths()
    if (r.added.length) {
      ElMessage.success(`已添加 ${r.added.length} 个目录：${r.added.join('、')}`)
    } else if (!silent) {
      if (r.found.length) ElMessage.info('各盘的「电影」目录均已添加')
      else ElMessage.info('未在各盘根目录下找到「电影」文件夹')
    }
    await store.fetchScanPaths()
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    detecting.value = false
  }
}

async function addPath() {
  const p = newPath.value.trim()
  if (!p) return
  adding.value = true
  try {
    await api.addScanPath(p)
    ElMessage.success('目录已添加')
    newPath.value = ''
    await store.fetchScanPaths()
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    adding.value = false
  }
}

async function removePath(sp) {
  try {
    await ElMessageBox.confirm(
      `移除扫描目录 ${sp.path}？已入库的电影记录会保留。`,
      '提示',
      { type: 'warning', confirmButtonText: '移除', cancelButtonText: '取消' }
    )
  } catch { return }
  try {
    await api.removeScanPath(sp.id)
    await store.fetchScanPaths()
  } catch (e) {
    ElMessage.error(e.message)
  }
}

const lastResult = computed(() => scanState.value?.lastResult)

const doubanInfo = ref(null)
const doubanRefreshing = ref(false)
const doubanTime = computed(() => {
  const t = doubanInfo.value?.updated_at
  if (!t) return ''
  const d = new Date(t)
  const pad = n => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}-${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
})

async function loadDouban() {
  try { doubanInfo.value = await api.doubanTop250() } catch {}
}

async function refreshDouban() {
  doubanRefreshing.value = true
  try {
    doubanInfo.value = await api.doubanRefresh()
    ElMessage.success(`榜单已更新，库内上榜 ${doubanInfo.value.matched} 部`)
    await store.fetchMovies()
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    doubanRefreshing.value = false
  }
}

const doubanSync = ref({ running: false, total: 0, processed: 0, applied: 0, skipped: 0, failed: 0, current: null, aborted: false, message: null, errors: [] })
let doubanTimer = null

async function startDoubanSync() {
  try {
    const r = await api.doubanSyncRatings()
    if (!r.total) {
      ElMessage.success('库中没有电影')
      return
    }
    ElMessage.success(`开始同步 ${r.total} 部电影的豆瓣评分`)
    startDoubanPolling()
  } catch (e) {
    ElMessage.error(e.message)
  }
}

function startDoubanPolling() {
  stopDoubanPolling()
  doubanTimer = setInterval(async () => {
    try {
      const st = await api.doubanSyncStatus()
      doubanSync.value = st
      if (!st.running) {
        stopDoubanPolling()
        if (st.message) {
          ElMessage.warning(st.message)
        } else {
          ElMessage.success(`同步完成：已获取 ${st.applied} 部豆瓣评分`)
        }
        await Promise.all([store.fetchMovies(), loadDouban()])
      }
    } catch {}
  }, 1000)
}

async function pollDoubanOnce() {
  try {
    const st = await api.doubanSyncStatus()
    doubanSync.value = st
    if (st.running && !doubanTimer) startDoubanPolling()
  } catch {}
}

function stopDoubanPolling() {
  if (doubanTimer) {
    clearInterval(doubanTimer)
    doubanTimer = null
  }
}

const cleaning = ref(false)
const missingCount = computed(() => store.meta.stats?.missing || 0)

async function cleanupMissing() {
  if (!missingCount.value) return
  try {
    await ElMessageBox.confirm(
      `将删除 ${missingCount.value} 条文件已缺失的电影记录（含其标签与评分历史），此操作不可恢复。确定继续吗？`,
      '清理缺失记录',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
    )
  } catch { return }
  cleaning.value = true
  try {
    const r = await api.cleanupMissing()
    ElMessage.success(`已删除 ${r.removed} 条缺失记录`)
    await Promise.all([store.fetchMovies(), store.fetchMeta()])
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    cleaning.value = false
  }
}
</script>

<template>
  <el-dialog v-model="visible" title="设置" width="680px" top="4vh">
    <h3 class="section-title">扫描目录</h3>
    <div class="add-row">
      <el-input
        v-model="newPath"
        placeholder="例如 D:\电影 或 \\NAS\share\电影（映射盘如 Z:\电影 也可以）"
        @keyup.enter="addPath"
      />
      <el-button type="primary" :loading="adding" @click="addPath">添加</el-button>
    </div>

    <div class="detect-row">
      <el-button size="small" :loading="detecting" @click="detect()">自动检测各盘「电影」目录</el-button>
      <span class="tip">自动识别每个硬盘根目录下的「电影」文件夹</span>
    </div>

    <div class="path-list">
      <div v-if="!scanPaths.length" class="empty-tip">尚未添加任何目录</div>
      <div v-for="sp in scanPaths" :key="sp.id" class="path-item">
        <span class="path-text" :title="sp.path">{{ sp.path }}</span>
        <el-button link type="danger" size="small" @click="removePath(sp)">移除</el-button>
      </div>
    </div>

    <div class="scan-row">
      <el-button type="primary" :loading="scanning" @click="store.triggerAndAwaitScan()">立即扫描</el-button>
      <span v-if="scanning" class="scan-hint">正在扫描…</span>
      <div v-else-if="lastResult" class="scan-result">
        上次扫描：新增 {{ lastResult.added }} · 更新 {{ lastResult.updated }} · 缺失 {{ lastResult.missing }} · 库中共 {{ lastResult.totalMovies }} 部
        <div v-if="lastResult.rootErrors?.length" class="scan-errors">
          无法访问：{{ lastResult.rootErrors.map(e => e.path).join('、') }}
        </div>
      </div>
    </div>

    <div class="scan-row cleanup-row">
      <el-button type="danger" plain :loading="cleaning" :disabled="!missingCount" @click="cleanupMissing">
        清理缺失记录
      </el-button>
      <span class="tip">
        <template v-if="missingCount">删除 {{ missingCount }} 条文件已缺失的电影记录（不会影响仍存在的电影）</template>
        <template v-else>当前没有缺失记录</template>
      </span>
    </div>

    <el-divider content-position="left">播放器</el-divider>

    <div class="tmdb-row">
      <el-input
        v-model="playerPath"
        class="key-input"
        placeholder="PotPlayer 路径，留空则自动检测（如 C:\Program Files\DAUM\PotPlayer\PotPlayerMini64.exe）"
        clearable
      />
      <el-button :loading="detectingPlayer" @click="detectPlayer">自动检测</el-button>
      <el-button type="primary" :loading="savingKey" @click="saveSettings">保存</el-button>
    </div>
    <div class="tmdb-row">
      <span class="tip">播放时通过本地 PotPlayer 打开视频文件；未填路径时会按常见安装位置自动查找</span>
    </div>

    <el-divider content-position="left">TMDB 数据同步</el-divider>

    <div class="tmdb-row">
      <el-input
        v-model="apiKey"
        class="key-input"
        placeholder="TMDB API Key（v3 密钥或 v4 Read Access Token）"
        clearable
      />
      <el-button type="primary" :loading="savingKey" @click="saveSettings">保存</el-button>
    </div>

    <div class="tmdb-row">
      <span class="row-label">元数据语言</span>
      <el-select v-model="language" class="lang-select" @change="() => saveSettings()">
        <el-option label="简体中文" value="zh-CN" />
        <el-option label="繁體中文" value="zh-TW" />
        <el-option label="English" value="en-US" />
      </el-select>
      <el-link
        type="primary"
        href="https://www.themoviedb.org/settings/api"
        target="_blank"
        class="get-key"
      >免费获取 API Key</el-link>
    </div>

    <div class="tmdb-row">
      <span class="row-label">网络代理</span>
      <el-input
        v-model="proxyUrl"
        class="key-input"
        placeholder="http://127.0.0.1:7897（Clash Verge 默认；不需要可留空）"
        clearable
      />
    </div>

    <div class="tmdb-row">
      <el-button :loading="testing" @click="testConnection">测试连接</el-button>
      <span v-if="testResult" class="test-result" :class="testResult.ok ? 'ok' : 'bad'">
        {{ testResult.message }}
      </span>
      <span v-else class="tip">TMDB 直连不通时（超时/fetch failed），填写本机代理地址</span>
    </div>

    <div class="tmdb-row">
      <el-button type="primary" :disabled="!hasKey" :loading="batch.running" @click="startBatch">
        自动补全缺失信息
      </el-button>
      <span v-if="!hasKey" class="tip">填写并保存 API Key 后可用</span>
      <span v-else class="tip">为缺少简介/封面/年份/分类的电影同步 TMDB 信息（仅高置信度匹配）</span>
    </div>

    <div v-if="batch.total" class="batch-box">
      <el-progress
        :percentage="Math.min(100, Math.round((batch.processed / batch.total) * 100))"
        :stroke-width="8"
      />
      <div class="batch-stats">
        进度 {{ batch.processed }}/{{ batch.total }} · 已匹配 {{ batch.applied }} · 未确定 {{ batch.skipped }}
        <template v-if="batch.failed"> · 失败 {{ batch.failed }}</template>
        <template v-if="batch.running && batch.current"> · 正在处理：{{ batch.current }}</template>
      </div>
      <div v-if="batch.errors?.length" class="batch-errors">
        <div v-for="e in batch.errors.slice(0, 5)" :key="e" class="batch-error">{{ e }}</div>
        <div v-if="batch.errors.length > 5" class="batch-error">…共 {{ batch.errors.length }} 条</div>
      </div>
    </div>

    <el-divider content-position="left">豆瓣 Top 250</el-divider>

    <div class="tmdb-row">
      <el-button type="primary" :loading="doubanRefreshing" @click="refreshDouban">刷新榜单</el-button>
      <span v-if="doubanInfo" class="tip">
        榜单 {{ doubanInfo.total }} 部 · 库内上榜 {{ doubanInfo.matched }} 部<template v-if="doubanTime"> · 更新于 {{ doubanTime }}</template>
      </span>
      <span v-else class="tip">抓取豆瓣 Top 250 榜单，自动标记库内上榜电影（卡片和详情页显示徽章）</span>
    </div>
    <div class="tmdb-row">
      <el-button type="primary" :loading="doubanSync.running" @click="startDoubanSync">同步豆瓣评分</el-button>
      <span v-if="doubanInfo" class="tip">
        已有豆瓣评分 {{ doubanInfo.rated }} 部 / 共 {{ store.meta.stats?.total ?? '—' }} 部
      </span>
      <span v-else class="tip">为库内电影抓取豆瓣评分（已上榜 Top 250 的直接使用榜单数据）</span>
    </div>
    <div v-if="doubanSync.total" class="batch-box">
      <el-progress
        :percentage="Math.min(100, Math.round((doubanSync.processed / doubanSync.total) * 100))"
        :stroke-width="8"
        :status="doubanSync.running ? undefined : 'success'"
      />
      <div class="batch-stats">
        进度 {{ doubanSync.processed }}/{{ doubanSync.total }} · 已获取 {{ doubanSync.applied }} · 无匹配 {{ doubanSync.skipped }}<template v-if="doubanSync.failed"> · 失败 {{ doubanSync.failed }}</template><template v-if="doubanSync.running && doubanSync.current"> · 正在处理：{{ doubanSync.current }}</template>
      </div>
      <div v-if="doubanSync.message" class="batch-error">{{ doubanSync.message }}</div>
      <div v-if="doubanSync.errors?.length" class="batch-errors">
        <div v-for="e in doubanSync.errors.slice(0, 5)" :key="e" class="batch-error">{{ e }}</div>
        <div v-if="doubanSync.errors.length > 5" class="batch-error">…共 {{ doubanSync.errors.length }} 条错误</div>
      </div>
    </div>
    <div class="tmdb-row">
      <span class="tip">打开页面时会自动抓取并每天检查更新；电影墙排序中可选择「豆瓣 Top 250」按名次浏览</span>
    </div>

    <template #footer>
      <el-button @click="visible = false">关闭</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.section-title {
  margin: 0 0 12px;
  font-size: 15px;
}

.add-row {
  display: flex;
  gap: 10px;
}

.detect-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 10px;
}

.tip {
  font-size: 12px;
  color: #6b7385;
}

.path-list {
  margin: 16px 0;
  border: 1px solid #232b3b;
  border-radius: 8px;
  min-height: 60px;
  padding: 6px 12px;
}

.empty-tip {
  color: #6b7385;
  font-size: 13px;
  padding: 18px 0;
  text-align: center;
}

.path-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px solid #1a2230;
}

.path-item:last-child {
  border-bottom: none;
}

.path-text {
  font-size: 13px;
  color: #c0c7d4;
  word-break: break-all;
}

.scan-row {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}

.scan-hint {
  color: #4d8ff0;
  font-size: 13px;
}

.scan-result {
  font-size: 13px;
  color: #8b93a5;
  line-height: 1.8;
}

.scan-errors {
  color: #e6a23c;
}

.cleanup-row {
  margin-top: 10px;
}

.tmdb-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 14px;
}

.key-input {
  flex: 1;
}

.row-label {
  font-size: 13px;
  color: #8b93a5;
  flex-shrink: 0;
}

.lang-select {
  width: 140px;
}

.get-key {
  font-size: 13px;
}

.batch-box {
  padding: 4px 0 8px;
}

.batch-stats {
  margin-top: 6px;
  font-size: 12px;
  color: #8b93a5;
  line-height: 1.7;
}

.batch-errors {
  margin-top: 6px;
  padding: 8px 10px;
  background: rgba(230, 162, 60, 0.08);
  border-radius: 6px;
}

.batch-error {
  font-size: 12px;
  color: #e6a23c;
  line-height: 1.7;
  word-break: break-all;
}

.test-result {
  font-size: 12px;
}

.test-result.ok {
  color: #67c23a;
}

.test-result.bad {
  color: #f56c6c;
}
</style>
