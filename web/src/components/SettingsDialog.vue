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

const testing = ref(false)
const testResult = ref(null)

const batch = ref({ running: false, total: 0, processed: 0, applied: 0, skipped: 0, failed: 0, current: null, errors: [] })
let batchTimer = null

watch(visible, async v => {
  if (v) {
    await store.fetchScanPaths()
    if (!store.scanPaths.length) await detect(true)
    await loadSettings()
    await pollBatchOnce()
  } else {
    stopBatchPolling()
  }
})

async function loadSettings() {
  try {
    const s = await api.settings()
    apiKey.value = s.tmdb_api_key
    language.value = s.tmdb_language
    proxyUrl.value = s.tmdb_proxy
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
      tmdb_proxy: proxyUrl.value.trim()
    })
    apiKey.value = s.tmdb_api_key
    language.value = s.tmdb_language
    proxyUrl.value = s.tmdb_proxy
    if (!silent) ElMessage.success('设置已保存')
    return true
  } catch (e) {
    ElMessage.error(e.message)
    return false
  } finally {
    savingKey.value = false
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

onUnmounted(stopBatchPolling)

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
