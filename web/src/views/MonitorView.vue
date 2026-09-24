<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowLeft, HomeFilled, Monitor, Cpu, Odometer, Film, FolderOpened } from '@element-plus/icons-vue'
import { api } from '../api'
import Logo from '../components/Logo.vue'

const router = useRouter()
const data = ref(null)
const loading = ref(true)
let pollTimer = null

const BACKEND_NAMES = { nvenc: 'NVIDIA 硬编', nvdec: 'NVIDIA 硬解+软编', qsv: 'Intel 核显', cpu: 'CPU 软转码' }

function fmtBytes(b) {
  if (!b && b !== 0) return '—'
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let n = b
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++ }
  return `${n.toFixed(n >= 100 || i === 0 ? 0 : 1)} ${u[i]}`
}

function fmtUptime(s) {
  if (!s) return '—'
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d) return `${d} 天 ${h} 小时`
  if (h) return `${h} 小时 ${m} 分`
  return `${m} 分`
}

function fmtTime(iso) {
  try { return new Date(iso).toLocaleTimeString('zh-CN', { hour12: false }) } catch { return '—' }
}

const memPct = computed(() => data.value?.system?.mem_used_pct || 0)
const sessions = computed(() => data.value?.transcode?.sessions || [])
const lastUpdate = ref('')
let lastLoadAt = 0

async function load() {
  try {
    data.value = await api.monitor()
    lastLoadAt = Date.now()
    lastUpdate.value = new Date().toLocaleTimeString('zh-CN', { hour12: false })
  } catch {} finally {
    loading.value = false
  }
}

onMounted(() => {
  // 立即加载 + 3 秒自动刷新；页面隐藏时暂停轮询（回到前台立即刷一次），标签页长期挂着也不会白发请求
  load()
  document.addEventListener('visibilitychange', onVisibility)
  pollTimer = setInterval(() => {
    if (!document.hidden) load()
  }, 3000)
})
onBeforeUnmount(() => {
  if (pollTimer) clearInterval(pollTimer)
  document.removeEventListener('visibilitychange', onVisibility)
})

function onVisibility() {
  if (!document.hidden) load()
}
</script>

<template>
  <div class="mon-page">
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
      <span class="title">性能监控</span>
      <span class="live" :class="{ stale: !lastUpdate }">
        <span class="dot"></span>
        {{ lastUpdate ? `实时 · ${lastUpdate}` : '加载中' }}
      </span>
      <div class="spacer"></div>
    </header>

    <main class="mon-main" v-loading="loading">
      <template v-if="data">
        <!-- 系统概览 -->
        <div class="cards">
          <div class="card">
            <div class="card-head"><el-icon><Cpu /></el-icon> CPU</div>
            <div class="big">{{ data.system.cpu_cores }} 核</div>
            <div class="sub" :title="data.system.cpu_model">{{ data.system.cpu_model }}</div>
          </div>
          <div class="card">
            <div class="card-head"><el-icon><Odometer /></el-icon> 内存</div>
            <div class="big">{{ memPct }}%</div>
            <div class="sub">{{ fmtBytes(data.system.mem_total - data.system.mem_free) }} / {{ fmtBytes(data.system.mem_total) }}</div>
            <div class="bar"><div class="bar-fill" :style="{ width: memPct + '%' }" :class="{ warn: memPct > 85 }"></div></div>
          </div>
          <div class="card">
            <div class="card-head"><el-icon><Monitor /></el-icon> 服务进程</div>
            <div class="big">{{ fmtUptime(data.process.node_uptime) }}</div>
            <div class="sub">内存 {{ fmtBytes(data.process.rss) }} · PID {{ data.process.pid }}</div>
          </div>
          <div class="card">
            <div class="card-head"><el-icon><Film /></el-icon> 转码会话</div>
            <div class="big">{{ data.transcode.active }} / {{ data.transcode.max }}</div>
            <div class="sub">{{ data.ffprobe ? 'FFmpeg 已就绪' : 'FFmpeg 未安装' }}</div>
          </div>
          <div class="card">
            <div class="card-head"><el-icon><FolderOpened /></el-icon> 自动入库</div>
            <div class="big">{{ data.watcher.enabled ? '监听中' : '已关闭' }}</div>
            <div class="sub">{{ data.watcher.watching.length }} 个目录{{ data.watcher.pending ? ' · 有变更待扫描' : '' }}</div>
          </div>
          <div class="card">
            <div class="card-head"><el-icon><Monitor /></el-icon> 系统运行</div>
            <div class="big">{{ fmtUptime(data.system.uptime) }}</div>
            <div class="sub">{{ data.system.platform }} · {{ data.system.hostname }}</div>
          </div>
        </div>

        <!-- 转码会话表 -->
        <div class="panel">
          <div class="panel-head">转码会话（3 秒刷新）</div>
          <div v-if="!sessions.length" class="empty">当前没有转码会话</div>
          <div v-else class="session-list">
            <div v-for="s in sessions" :key="s.sid" class="session">
              <div class="s-info">
                <span class="s-title">{{ s.title }}</span>
                <el-tag size="small" :type="s.backend === 'nvenc' ? 'success' : s.backend === 'cpu' ? 'warning' : 'primary'">
                  {{ BACKEND_NAMES[s.backend] || s.backend }}
                </el-tag>
                <el-tag size="small" type="info" effect="plain">{{ s.target_h >= 2000 ? '4K' : '1080p' }}</el-tag>
              </div>
              <div class="s-progress">
                <div class="bar"><div class="bar-fill" :style="{ width: (s.total_duration ? Math.min(100, s.transcoded_to / s.total_duration * 100) : 0) + '%' }"></div></div>
                <span class="s-pct">{{ s.total_duration ? Math.round(s.transcoded_to / s.total_duration * 100) : 0 }}%</span>
              </div>
              <div class="s-meta">
                {{ s.done ? '✓ 转码完成' : s.running ? '转码中' : '已暂停' }}
                · 从 {{ fmtTime(s.started_at) }} 开始
                · 转到 {{ Math.round(s.transcoded_to / 60) }} 分
                <template v-if="s.total_duration">/ 共 {{ Math.round(s.total_duration / 60) }} 分</template>
              </div>
            </div>
          </div>
        </div>
      </template>
    </main>
  </div>
</template>

<style scoped>
.mon-page { min-height: 100%; display: flex; flex-direction: column; }

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

/* 实时刷新指示灯 */
.live {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  color: #8fd8b4;
}
.live .dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #8fd8b4;
  animation: pulse 1.8s ease-in-out infinite;
}
.live.stale { color: #9a8b74; }
.live.stale .dot { background: #9a8b74; animation: none; }

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.25; }
}

.spacer { flex: 1; }

.mon-main { flex: 1; max-width: 1200px; width: 100%; margin: 0 auto; padding: 24px 28px 50px; box-sizing: border-box; }

.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 14px;
  margin-bottom: 22px;
}

.card {
  background: #1a1511;
  border: 1px solid #2e241b;
  border-radius: 10px;
  padding: 14px 16px;
}

.card-head {
  display: flex; align-items: center; gap: 7px;
  font-size: 12px; color: #9a8b74; margin-bottom: 8px;
}

.big { font-size: 26px; font-weight: 700; color: #e0a458; }

.sub {
  margin-top: 4px; font-size: 12px; color: #9a8b74;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}

.bar {
  margin-top: 10px; height: 5px;
  background: #221b14; border-radius: 3px; overflow: hidden;
}
.bar-fill { height: 100%; background: #e0a458; border-radius: 3px; transition: width 0.5s; }
.bar-fill.warn { background: #e07a6a; }

.panel {
  background: #1a1511;
  border: 1px solid #2e241b;
  border-radius: 10px;
  padding: 16px 18px;
}

.panel-head { font-size: 15px; font-weight: 700; color: #ece3d2; margin-bottom: 14px; }

.empty { text-align: center; padding: 30px 0; color: #6a5c4a; font-size: 13px; }

.session {
  padding: 12px 0;
  border-bottom: 1px solid #241d16;
}
.session:last-child { border-bottom: none; }

.s-info { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.s-title { font-size: 15px; font-weight: 600; color: #ece3d2; }

.s-progress { display: flex; align-items: center; gap: 10px; margin-top: 8px; }
.s-progress .bar { flex: 1; margin-top: 0; }
.s-pct { font-size: 13px; color: #e0a458; min-width: 40px; text-align: right; }

.s-meta { margin-top: 6px; font-size: 12px; color: #9a8b74; }

@media (max-width: 700px) {
  .mon-main { padding: 14px 12px 40px; }
  .cards { grid-template-columns: repeat(2, 1fr); }
}
</style>
