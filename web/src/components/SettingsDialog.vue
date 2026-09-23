<script setup>
import { computed, onUnmounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { ElMessage, ElMessageBox } from 'element-plus'
import { FolderOpened, Connection, Monitor, ArrowDown } from '@element-plus/icons-vue'
import { useLibraryStore } from '../stores/library'
import { api } from '../api'
import DuplicatesDialog from './DuplicatesDialog.vue'

const store = useLibraryStore()
const { scanPaths, scanning, scanState } = storeToRefs(store)

const visible = defineModel({ type: Boolean, default: false })
const activeTab = ref('library')
const newPath = ref('')
const adding = ref(false)
const detecting = ref(false)

const apiKey = ref('')
const language = ref('zh-CN')
const proxyUrl = ref('')
const savingKey = ref(false)
const hasKey = computed(() => !!apiKey.value.trim())
const probeAvailable = ref(null)
const doubanUid = ref('')

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
    loadBackupInfo()
    loadAutostart()
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
    probeAvailable.value = s.probe_available
    doubanUid.value = s.douban_uid || ''
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
      player_path: playerPath.value.trim(),
      douban_uid: doubanUid.value.trim()
    })
    apiKey.value = s.tmdb_api_key
    language.value = s.tmdb_language
    proxyUrl.value = s.tmdb_proxy
    playerPath.value = s.player_path
    doubanUid.value = s.douban_uid || ''
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

async function onScanCommand(cmd) {
  if (scanning.value) return
  if (cmd === 'full') {
    try {
      await ElMessageBox.confirm(
        '完整扫描会重新遍历所有目录（含 ffprobe 画质识别），大库可能较慢。继续吗？',
        '完整扫描',
        { type: 'info', confirmButtonText: '继续', cancelButtonText: '取消' }
      )
    } catch { return }
    await store.triggerAndAwaitScanFull()
  } else {
    await store.triggerAndAwaitScan()
  }
}

// NFO 批量导出
const exportingNfoAll = ref(false)

async function exportNfoAll() {
  try {
    await ElMessageBox.confirm(
      '为库中每部影片在它的文件夹里写入 movie.nfo（Kodi / Emby / Jellyfin 兼容）。已有文件会被覆盖。继续吗？',
      '批量导出 NFO',
      { type: 'info', confirmButtonText: '导出', cancelButtonText: '取消' }
    )
  } catch { return }
  exportingNfoAll.value = true
  try {
    const r = await api.exportNfoAll()
    ElMessage.success(`已导出 ${r.written}/${r.total} 部${r.failed ? `，失败 ${r.failed} 部` : ''}`)
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    exportingNfoAll.value = false
  }
}

const backingUp = ref(false)
const backupInfo = ref({})
const lastBackupTime = computed(() => {
  const t = backupInfo.value.last_backup_at
  if (!t) return ''
  try {
    return new Date(t).toLocaleString('zh-CN', { hour12: false })
  } catch {
    return t
  }
})

const autostartOn = ref(false)
const autostartLoading = ref(false)
const duplicatesVisible = ref(false)

async function loadBackupInfo() {
  try {
    backupInfo.value = await api.backupInfo()
  } catch {}
}

async function backupNow() {
  backingUp.value = true
  try {
    const r = await api.backupNow()
    ElMessage.success(`备份完成：${r.file}`)
    await loadBackupInfo()
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    backingUp.value = false
  }
}

async function loadAutostart() {
  try {
    autostartOn.value = (await api.autostartStatus()).enabled
  } catch {}
}

async function onAutostartChange(v) {
  autostartLoading.value = true
  try {
    await api.setAutostart(v)
    ElMessage.success(v ? '已开启开机自启' : '已关闭开机自启')
  } catch (e) {
    ElMessage.error(e.message)
    autostartOn.value = !v
  } finally {
    autostartLoading.value = false
  }
}

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

const doubanSync = ref({ running: false, total: 0, processed: 0, applied: 0, skipped: 0, failed: 0, noMatch: null, noRating: 0, hadRating: 0, current: null, aborted: false, message: null, errors: [] })
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
  <el-dialog v-model="visible" title="设置" width="720px" top="4vh" class="settings-dialog">
    <el-tabs v-model="activeTab">
      <!-- 影库 -->
      <el-tab-pane name="library">
        <template #label>
          <span class="tab-label"><el-icon><FolderOpened /></el-icon>影库</span>
        </template>

        <div class="block">
          <div class="block-title">扫描目录</div>
          <div class="add-row">
            <el-input
              v-model="newPath"
              placeholder="例如 D:\电影 或 \\NAS\share\电影（映射盘如 Z:\电影 也可以）"
              @keyup.enter="addPath"
            />
            <el-button type="primary" :loading="adding" @click="addPath">添加</el-button>
          </div>
          <div class="add-row" style="margin-top: 8px">
            <el-button size="small" :loading="detecting" @click="detect()">自动检测各盘「电影」目录</el-button>
          </div>
          <div class="path-list">
            <div v-if="!scanPaths.length" class="empty-tip">尚未添加任何目录</div>
            <div v-for="sp in scanPaths" :key="sp.id" class="path-item">
              <span class="path-text" :title="sp.path">{{ sp.path }}</span>
              <el-button link type="danger" size="small" @click="removePath(sp)">移除</el-button>
            </div>
          </div>
          <div class="set-row">
            <el-dropdown @command="onScanCommand">
              <el-button type="primary" :loading="scanning">
                立即扫描<el-icon class="el-icon--right"><ArrowDown /></el-icon>
              </el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="increment">快速扫描（跳过未变化目录）</el-dropdown-item>
                  <el-dropdown-item command="full">完整扫描（重新遍历所有目录）</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
            <span v-if="scanning" class="hint accent">正在扫描…</span>
            <div v-else-if="lastResult" class="hint">
              上次扫描：新增 {{ lastResult.added }} · 更新 {{ lastResult.updated }} · 缺失 {{ lastResult.missing }} · 共 {{ lastResult.totalMovies }} 部
              <template v-if="lastResult.incremental != null"> · 跳过未变化目录 {{ lastResult.incremental }}</template>
              <div v-if="lastResult.rootErrors?.length" class="warn">
                无法访问：{{ lastResult.rootErrors.map(e => e.path).join('、') }}
              </div>
            </div>
          </div>
          <div class="probe-row">
            <span class="probe-dot" :class="probeAvailable ? 'ok' : 'off'"></span>
            <span class="hint">
              画质识别：{{ probeAvailable
                ? 'ffprobe 深度识别已启用，扫描时读取视频真实分辨率'
                : '仅按文件名识别；安装 FFmpeg（含 ffprobe）并重启后，自动启用深度识别' }}
            </span>
          </div>
        </div>

        <div class="block">
          <div class="block-title">维护</div>
          <div class="set-row">
            <el-button type="danger" plain :loading="cleaning" :disabled="!missingCount" @click="cleanupMissing">
              清理缺失记录
            </el-button>
            <span class="hint">
              <template v-if="missingCount">{{ missingCount }} 条记录的文件已缺失</template>
              <template v-else>当前没有缺失记录</template>
            </span>
          </div>
          <div class="set-row">
            <el-button @click="duplicatesVisible = true">重复电影检测</el-button>
            <span class="hint">查找多个硬盘上的同名影片，便于清理空间</span>
          </div>
          <div class="set-row">
            <el-button :loading="exportingNfoAll" @click="exportNfoAll">批量导出 NFO</el-button>
            <span class="hint">在每部影片的文件夹写入 movie.nfo，供 Kodi / Emby / Jellyfin 读取</span>
          </div>
        </div>
      </el-tab-pane>

      <!-- 数据同步 -->
      <el-tab-pane name="sync">
        <template #label>
          <span class="tab-label"><el-icon><Connection /></el-icon>数据同步</span>
        </template>

        <div class="block">
          <div class="block-title">TMDB（海报 · 简介 · 演职员）</div>
          <div class="set-row">
            <el-input
              v-model="apiKey"
              class="grow"
              placeholder="TMDB API Key（v3 密钥或 v4 Read Access Token）"
              clearable
            />
            <el-button type="primary" :loading="savingKey" @click="saveSettings">保存</el-button>
          </div>
          <div class="set-row">
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
          <div class="set-row">
            <span class="row-label">网络代理</span>
            <el-input
              v-model="proxyUrl"
              class="grow"
              placeholder="http://127.0.0.1:7897（TMDB 直连不通时填写）"
              clearable
            />
          </div>
          <div class="set-row">
            <el-button :loading="testing" @click="testConnection">测试连接</el-button>
            <span v-if="testResult" class="hint-strong" :class="testResult.ok ? 'ok' : 'bad'">
              {{ testResult.message }}
            </span>
            <span v-else class="hint">验证 Key 与代理是否可用</span>
          </div>
          <div class="set-row">
            <el-button type="primary" :disabled="!hasKey" :loading="batch.running" @click="startBatch">
              自动补全缺失信息
            </el-button>
            <span class="hint">
              <template v-if="!hasKey">填写并保存 API Key 后可用</template>
              <template v-else>为缺少简介/封面/年份/分类的电影同步信息（仅高置信度匹配）</template>
            </span>
          </div>
          <div v-if="batch.total" class="batch-box">
            <el-progress
              :percentage="Math.min(100, Math.round((batch.processed / batch.total) * 100))"
              :stroke-width="8"
            />
            <div class="hint">
              进度 {{ batch.processed }}/{{ batch.total }} · 已匹配 {{ batch.applied }} · 未确定 {{ batch.skipped }}
              <template v-if="batch.failed"> · 失败 {{ batch.failed }}</template>
              <template v-if="batch.running && batch.current"> · 正在处理：{{ batch.current }}</template>
            </div>
            <div v-if="batch.errors?.length" class="batch-errors">
              <div v-for="e in batch.errors.slice(0, 5)" :key="e" class="warn">{{ e }}</div>
              <div v-if="batch.errors.length > 5" class="warn">…共 {{ batch.errors.length }} 条</div>
            </div>
          </div>
        </div>

        <div class="block">
          <div class="block-title">豆瓣（评分 · Top 250 · 片单同步）</div>
          <div class="set-row">
            <span class="row-label">我的 UID</span>
            <el-input
              v-model="doubanUid"
              class="grow"
              placeholder="豆瓣个人主页 people/ 后的数字，如 183262992"
              clearable
              @change="() => saveSettings(true)"
            />
            <span class="hint" v-if="doubanUid">已保存，可在「想看清单」页一键同步片单</span>
          </div>
          <div class="set-row">
            <el-button :loading="doubanRefreshing" @click="refreshDouban">刷新榜单</el-button>
            <span class="hint">
              <template v-if="doubanInfo">榜单 {{ doubanInfo.total }} 部 · 库内上榜 {{ doubanInfo.matched }} 部<template v-if="doubanTime"> · {{ doubanTime }}</template></template>
              <template v-else>首次打开页面时会自动抓取</template>
            </span>
          </div>
          <div class="set-row">
            <el-button type="primary" :loading="doubanSync.running" @click="startDoubanSync">同步豆瓣评分</el-button>
            <span class="hint">
              <template v-if="doubanInfo">已有评分 {{ doubanInfo.rated }} 部 / 共 {{ store.meta.stats?.total ?? '—' }} 部</template>
              <template v-else>为库内电影抓取豆瓣评分（已上榜的直接使用榜单数据）</template>
            </span>
          </div>
          <div v-if="doubanSync.total" class="batch-box">
            <el-progress
              :percentage="Math.min(100, Math.round((doubanSync.processed / doubanSync.total) * 100))"
              :stroke-width="8"
              :status="doubanSync.running ? undefined : 'success'"
            />
            <div class="hint">
              进度 {{ doubanSync.processed }}/{{ doubanSync.total }} · 新获取 {{ doubanSync.applied }}<template v-if="doubanSync.noMatch != null"> · 无匹配 {{ doubanSync.noMatch }} · 豆瓣暂无评分 {{ doubanSync.noRating }} · 已有评分 {{ doubanSync.hadRating }}</template><template v-else> · 跳过 {{ doubanSync.skipped }}（含已有评分等）</template>
              <template v-if="doubanSync.failed"> · 失败 {{ doubanSync.failed }}</template>
              <template v-if="doubanSync.running && doubanSync.current"> · 正在处理：{{ doubanSync.current }}</template>
            </div>
            <div v-if="doubanSync.noMatch > 0" class="hint">
              无匹配：豆瓣上没找到与库内标题一致且年份差不超过 1 年的条目（常见于未刮削影片用文件名去搜、冷门片或译名差异），先刮削好片名再同步即可补上
            </div>
            <div v-if="doubanSync.message" class="warn">{{ doubanSync.message }}</div>
            <div v-if="doubanSync.errors?.length" class="batch-errors">
              <div v-for="e in doubanSync.errors.slice(0, 5)" :key="e" class="warn">{{ e }}</div>
              <div v-if="doubanSync.errors.length > 5" class="warn">…共 {{ doubanSync.errors.length }} 条错误</div>
            </div>
          </div>
        </div>
      </el-tab-pane>

      <!-- 系统 -->
      <el-tab-pane name="system">
        <template #label>
          <span class="tab-label"><el-icon><Monitor /></el-icon>系统</span>
        </template>

        <div class="block">
          <div class="block-title">播放器</div>
          <div class="set-row">
            <el-input
              v-model="playerPath"
              class="grow"
              placeholder="PotPlayer 路径，留空则自动检测"
              clearable
            />
            <el-button :loading="detectingPlayer" @click="detectPlayer">自动检测</el-button>
            <el-button type="primary" :loading="savingKey" @click="saveSettings">保存</el-button>
          </div>
          <div class="set-row">
            <span class="hint">播放按钮通过本地 PotPlayer 打开视频文件；未填路径时按常见安装位置自动查找</span>
          </div>
        </div>

        <div class="block">
          <div class="block-title">数据与启动</div>
          <div class="set-row">
            <el-button type="primary" :loading="backingUp" @click="backupNow">立即备份</el-button>
            <span class="hint">
              <template v-if="backupInfo.backups?.length">已有 {{ backupInfo.backups.length }} 份备份<template v-if="lastBackupTime"> · 最近：{{ lastBackupTime }}</template></template>
              <template v-else>备份评分、观看记录等数据（每周自动一次，保留 8 份）</template>
            </span>
          </div>
          <div class="set-row">
            <el-switch v-model="autostartOn" :loading="autostartLoading" @change="onAutostartChange" />
            <span class="row-label-strong">开机自动启动</span>
            <span class="hint">登录 Windows 后后台运行服务，局域网设备随时可访问</span>
          </div>
        </div>
      </el-tab-pane>
    </el-tabs>

    <template #footer>
      <el-button @click="visible = false">关闭</el-button>
    </template>
  </el-dialog>

  <DuplicatesDialog v-model="duplicatesVisible" />
</template>

<style scoped>
.tab-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.block {
  padding: 6px 2px 4px;
}

.block + .block {
  margin-top: 18px;
  border-top: 1px solid #241d16;
  padding-top: 16px;
}

.block-title {
  font-size: 13px;
  font-weight: 700;
  color: #cfc2ac;
  margin-bottom: 12px;
}

.add-row {
  display: flex;
  gap: 10px;
}

.grow {
  flex: 1;
}

.set-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}

.set-row:last-child {
  margin-bottom: 0;
}

.row-label {
  font-size: 13px;
  color: #9a8b74;
  flex-shrink: 0;
}

.row-label-strong {
  font-size: 13px;
  font-weight: 600;
  color: #cfc2ac;
  white-space: nowrap;
}

.lang-select {
  width: 140px;
}

.get-key {
  font-size: 13px;
}

.hint {
  font-size: 12px;
  color: #9a8b74;
  line-height: 1.7;
}

.hint.accent {
  color: #e0a458;
}

.hint-strong {
  font-size: 12px;
}

.hint-strong.ok {
  color: #9aab6e;
}

.hint-strong.bad {
  color: #e07a6a;
}

.warn {
  font-size: 12px;
  color: #d99a4e;
  line-height: 1.7;
}

.probe-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
}

.probe-dot {
  flex-shrink: 0;
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.probe-dot.ok {
  background: #9aab6e;
  box-shadow: 0 0 7px rgba(154, 171, 110, 0.7);
}

.probe-dot.off {
  background: #7d7160;
}

.path-list {
  margin: 12px 0 14px;
  border: 1px solid #2e241b;
  border-radius: 8px;
  min-height: 56px;
  padding: 4px 12px;
}

.empty-tip {
  color: #7d7160;
  font-size: 13px;
  padding: 16px 0;
  text-align: center;
}

.path-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px solid #221b14;
}

.path-item:last-child {
  border-bottom: none;
}

.path-text {
  font-size: 13px;
  color: #cfc2ac;
  word-break: break-all;
}

.batch-box {
  padding: 4px 0 8px;
}

.batch-errors {
  margin-top: 6px;
  padding: 8px 10px;
  background: rgba(230, 162, 60, 0.08);
  border-radius: 6px;
}

/* ---------- 移动端 ---------- */
@media (max-width: 700px) {
  .settings-dialog :deep(.el-dialog) { top: 2vh !important; }
  .settings-dialog :deep(.el-tabs__header) { margin-bottom: 10px; }
  .set-row { flex-wrap: wrap; gap: 8px; }
  .add-row { flex-direction: column; align-items: stretch; }
  .path-item { flex-wrap: wrap; }
}
</style>
