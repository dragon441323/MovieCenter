<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { ArrowLeft } from '@element-plus/icons-vue'
import { api } from '../api'
import { formatSize } from '../utils'
import EChart from '../components/EChart.vue'
import Logo from '../components/Logo.vue'

const stats = ref(null)
const loading = ref(false)

const axisStyle = {
  axisLine: { lineStyle: { color: '#4a3c2c' } },
  axisLabel: { color: '#9a8b74' },
  splitLine: { lineStyle: { color: '#2e241b' } }
}

// 年度报告
const reportYear = ref(String(new Date().getFullYear()))
const report = ref(null)
const reportLoading = ref(false)

async function loadReport() {
  reportLoading.value = true
  try {
    report.value = await api.diaryReport(reportYear.value)
  } catch {
    report.value = null
  } finally {
    reportLoading.value = false
  }
}

watch(reportYear, loadReport)

const reportYears = computed(() => {
  const now = new Date().getFullYear()
  const list = []
  for (let y = now; y >= now - 10; y--) list.push(String(y))
  return list
})

const monthOption = computed(() => {
  if (!report.value) return {}
  return {
    grid: { left: 8, right: 16, top: 20, bottom: 4, containLabel: true },
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'category', data: report.value.months.map(m => m.month + '月'), ...axisStyle },
    yAxis: { type: 'value', ...axisStyle, minInterval: 1 },
    series: [{
      type: 'line',
      smooth: true,
      data: report.value.months.map(m => m.count),
      areaStyle: { opacity: 0.18 },
      itemStyle: { color: '#e0a458' },
      lineStyle: { width: 2.5 }
    }]
  }
})

function barOption(data, { horizontal = false, color = '#e0a458' } = {}) {
  const names = data.map(d => d.name)
  const values = data.map(d => d.count)
  return {
    grid: { left: 8, right: 16, top: 20, bottom: 4, containLabel: true },
    tooltip: { trigger: 'axis' },
    xAxis: horizontal
      ? { type: 'value', ...axisStyle }
      : { type: 'category', data: names, ...axisStyle, axisLabel: { ...axisStyle.axisLabel, interval: 0, rotate: names.length > 8 ? 32 : 0 } },
    yAxis: horizontal
      ? { type: 'category', data: [...names].reverse(), ...axisStyle }
      : { type: 'value', ...axisStyle },
    series: [{
      type: 'bar',
      data: horizontal ? [...values].reverse() : values,
      itemStyle: { color, borderRadius: horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0] },
      barMaxWidth: 30
    }]
  }
}

function pieOption(data) {
  // ECharts 饼图需要 {name, value}，后端返回 {name, count}
  const pieData = (data || []).map(d => ({ name: d.name, value: d.count }))
  return {
    tooltip: { trigger: 'item' },
    legend: { type: 'scroll', orient: 'vertical', right: 0, top: 'middle', textStyle: { color: '#9a8b74' } },
    series: [{
      type: 'pie',
      radius: ['42%', '72%'],
      center: ['34%', '50%'],
      data: pieData,
      label: { color: '#9a8b74' },
      itemStyle: { borderColor: '#1a1511', borderWidth: 2 }
    }]
  }
}

onMounted(async () => {
  loading.value = true
  try {
    stats.value = await api.stats()
  } finally {
    loading.value = false
  }
  loadReport()
})
</script>

<template>
  <div v-loading="loading" class="stats-page">
    <header class="stats-topbar">
      <div class="stats-brand" @click="$router.push('/')">
        <Logo class="stats-logo" />
        <span>电影中心</span>
      </div>
      <el-button link @click="$router.push('/')">
        <el-icon><ArrowLeft /></el-icon> 返回影库
      </el-button>
      <span class="title">统计面板</span>
    </header>

    <div v-if="stats" class="stats-body">
      <div class="cards">
        <div class="card">
          <div class="num font-display">{{ stats.totals.total }}</div>
          <div class="label">电影总数</div>
        </div>
        <div class="card">
          <div class="num font-display">{{ stats.totals.watched }}</div>
          <div class="label">已看</div>
        </div>
        <div class="card">
          <div class="num font-display">{{ stats.totals.watch_total }}</div>
          <div class="label">累计观看次数</div>
        </div>
        <div class="card">
          <div class="num font-display">{{ stats.totals.favorites }}</div>
          <div class="label">收藏</div>
        </div>
        <div class="card">
          <div class="num font-display">{{ stats.totals.my_rated }}</div>
          <div class="label">我评过分的</div>
        </div>
        <div class="card">
          <div class="num font-display">{{ stats.totals.top250 }}</div>
          <div class="label">豆瓣 Top250 在库</div>
        </div>
        <div class="card">
          <div class="num font-display small">{{ formatSize(stats.totals.total_size) }}</div>
          <div class="label">库容量</div>
        </div>
      </div>

      <!-- 年度观影报告 -->
      <div class="report" v-loading="reportLoading">
        <div class="report-head">
          <h3 class="report-title font-display">{{ reportYear }} 年度观影报告</h3>
          <el-select v-model="reportYear" style="width: 110px" size="small">
            <el-option v-for="y in reportYears" :key="y" :label="y + ' 年'" :value="y" />
          </el-select>
        </div>
        <template v-if="report && report.total_watched">
          <div class="report-cards">
            <div class="rc"><div class="rn font-display">{{ report.total_watched }}</div><div class="rl">观影次数</div></div>
            <div class="rc"><div class="rn font-display">{{ report.unique_movies }}</div><div class="rl">不同影片</div></div>
            <div class="rc"><div class="rn font-display">{{ report.avg_rating ?? '—' }}</div><div class="rl">平均评分</div></div>
            <div class="rc"><div class="rn font-display">{{ report.notes_written }}</div><div class="rl">写下的日记</div></div>
            <div v-if="report.favorite" class="rc fav" @click="$router.push('/diary')">
              <div class="rn font-display">{{ report.favorite.rating.toFixed(1) }}</div>
              <div class="rl">年度最爱 · {{ report.favorite.title }}</div>
            </div>
          </div>
          <div class="report-charts">
            <div class="chart-card">
              <h3>月度观影曲线</h3>
              <EChart :option="monthOption" />
            </div>
            <div class="chart-card">
              <h3>年度类型分布</h3>
              <EChart :option="pieOption(report.categories)" />
            </div>
          </div>
          <div v-if="report.five_star.length" class="five-star">
            <span class="fs-label">年度五星片单</span>
            <div class="fs-list">
              <div v-for="f in report.five_star" :key="f.id" class="fs-item">
                <img v-if="f.cover_url" :src="f.cover_url" loading="lazy" alt="" />
                <span class="fs-title">{{ f.title }}</span>
                <span class="fs-rate font-display">★{{ f.rating.toFixed(1) }}</span>
              </div>
            </div>
          </div>
        </template>
        <div v-else-if="!reportLoading" class="report-empty">{{ reportYear }} 年还没有观影记录</div>
      </div>

      <div class="charts">
        <div class="chart-card">
          <h3>我的评分分布</h3>
          <EChart :option="barOption(stats.my_rating_dist, { color: '#8fd8b4' })" />
        </div>
        <div class="chart-card">
          <h3>豆瓣评分分布</h3>
          <EChart :option="barOption(stats.douban_dist, { color: '#e0a458' })" />
        </div>
        <div class="chart-card">
          <h3>类型分布</h3>
          <EChart :option="pieOption(stats.categories)" />
        </div>
        <div class="chart-card">
          <h3>年代分布</h3>
          <EChart :option="barOption(stats.decades, { color: '#c97b5a' })" />
        </div>
        <div class="chart-card">
          <h3>导演 TOP 10</h3>
          <EChart :option="barOption(stats.directors, { horizontal: true, color: '#d99a4e' })" />
        </div>
        <div class="chart-card">
          <h3>演员 TOP 10</h3>
          <EChart :option="barOption(stats.actors, { horizontal: true, color: '#c98a8a' })" />
        </div>
        <div class="chart-card wide">
          <h3>观影次数排行</h3>
          <EChart :option="barOption(stats.most_watched, { horizontal: true, color: '#8fd8b4' })" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.stats-page {
  min-height: 100%;
}

.stats-topbar {
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 14px 28px;
  background: rgba(16, 14, 12, 0.86);
  backdrop-filter: blur(10px);
  border-bottom: 1px solid #241d16;
}

.stats-brand {
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

.stats-logo {
  width: 26px;
  height: 26px;
  color: #e0a458;
}

.title {
  font-size: 18px;
  font-weight: 700;
}

.stats-body {
  max-width: 1440px;
  margin: 0 auto;
  padding: 24px 28px 40px;
}

.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 14px;
  margin-bottom: 24px;
}

.card {
  background: #1a1511;
  border: 1px solid #2e241b;
  border-radius: 8px;
  padding: 18px 16px;
  text-align: center;
}

.num {
  font-size: 34px;
  color: #e0a458;
}

.num.small {
  font-size: 22px;
  line-height: 44px;
}

.label {
  margin-top: 6px;
  font-size: 12px;
  color: #9a8b74;
}

.charts {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 18px;
}

/* ---------- 年度报告 ---------- */
.report {
  background: #1a1511;
  border: 1px solid #2e241b;
  border-radius: 8px;
  padding: 18px 20px 16px;
  margin-bottom: 24px;
}

.report-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}

.report-title {
  margin: 0;
  font-size: 20px;
  color: #e6c37a;
  letter-spacing: 1px;
}

.report-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}

.rc {
  background: #221b14;
  border: 1px solid #2e241b;
  border-radius: 8px;
  padding: 14px 12px;
  text-align: center;
}

.rc.fav { cursor: pointer; border-color: rgba(224, 164, 88, 0.45); }
.rc.fav:hover { border-color: rgba(224, 164, 88, 0.8); }

.rn { font-size: 30px; color: #e0a458; }

.rl { margin-top: 4px; font-size: 12px; color: #9a8b74; }

.report-charts {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
  margin-bottom: 14px;
}

.report-empty {
  text-align: center;
  padding: 26px 0 18px;
  color: #6a5c4a;
  font-size: 14px;
}

.five-star { margin-top: 6px; }

.fs-label {
  display: inline-block;
  font-size: 14px;
  font-weight: 700;
  color: #e6c37a;
  margin-bottom: 10px;
}

.fs-list {
  display: flex;
  gap: 12px;
  overflow-x: auto;
  padding-bottom: 6px;
}

.fs-item {
  flex-shrink: 0;
  width: 92px;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.fs-item img {
  width: 92px;
  height: 138px;
  object-fit: cover;
  border-radius: 6px;
  box-shadow: 0 3px 12px rgba(0, 0, 0, 0.45);
}

.fs-title {
  font-size: 12px;
  color: #ece3d2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.fs-rate { font-size: 12px; color: #8fd8b4; }

@media (max-width: 900px) {
  .charts {
    grid-template-columns: 1fr;
  }
  .report-charts {
    grid-template-columns: 1fr;
  }
}

.chart-card {
  background: #1a1511;
  border: 1px solid #2e241b;
  border-radius: 8px;
  padding: 16px 18px 8px;
}

.chart-card.wide {
  grid-column: 1 / -1;
}

.chart-card h3 {
  margin: 0 0 8px;
  font-size: 15px;
  color: #cfc2ac;
}

@media (max-width: 900px) {
  .charts {
    grid-template-columns: 1fr;
  }
}

/* ---------- 移动端 ---------- */
@media (max-width: 700px) {
  .stats-body { padding: 16px 12px 40px; }
  .cards { grid-template-columns: repeat(3, 1fr); gap: 8px; }
  .num { font-size: 24px; }
  .rc .rn { font-size: 22px; }
  .fs-item img { width: 64px; height: 96px; }
  .fs-item { width: 64px; }
}
</style>
