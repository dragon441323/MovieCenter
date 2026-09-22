<script setup>
import { ref, watch } from 'vue'
import { api } from '../api'
import { formatSize } from '../utils'

const visible = defineModel({ type: Boolean, default: false })

const groups = ref([])
const loading = ref(false)

watch(visible, async v => {
  if (!v) return
  loading.value = true
  try {
    const r = await api.duplicates()
    groups.value = r.groups || []
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <el-dialog v-model="visible" title="重复电影检测" width="760px" top="5vh" append-to-body>
    <div v-loading="loading" class="dup-body">
      <el-empty v-if="!loading && !groups.length" description="没有发现重复的电影（同名影片）" />
      <div v-else class="groups">
        <div v-for="(g, gi) in groups" :key="gi" class="group">
          <div class="group-title">
            {{ g.title }}
            <span v-if="g.years.length" class="years">{{ g.years.join(' / ') }}</span>
            <span class="count">{{ g.entries.length }} 份</span>
          </div>
          <div v-for="e in g.entries" :key="e.id" class="entry">
            <img v-if="e.cover_url" :src="e.cover_url" class="thumb" loading="lazy" alt="" />
            <div v-else class="thumb placeholder">无封面</div>
            <div class="entry-info">
              <div class="path" :title="e.path">{{ e.path }}</div>
              <div class="meta">{{ e.year || '年份未知' }} · {{ formatSize(e.file_size) }}</div>
            </div>
          </div>
        </div>
      </div>
      <div v-if="groups.length" class="tip">
        提示：本平台只做展示，请自行在文件管理器中清理多余副本
      </div>
    </div>
    <template #footer>
      <el-button @click="visible = false">关闭</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.dup-body {
  min-height: 120px;
}

.groups {
  max-height: 60vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.group {
  border: 1px solid #2e241b;
  border-radius: 10px;
  padding: 12px 14px;
}

.group-title {
  font-size: 15px;
  font-weight: 600;
  margin-bottom: 10px;
}

.years {
  color: #9a8b74;
  font-weight: 400;
  margin-left: 8px;
  font-size: 13px;
}

.count {
  margin-left: 10px;
  font-size: 12px;
  color: #d99a4e;
}

.entry {
  display: flex;
  gap: 12px;
  padding: 8px 0;
  border-top: 1px solid #221b14;
}

.thumb {
  width: 44px;
  height: 62px;
  object-fit: cover;
  border-radius: 4px;
  flex-shrink: 0;
  background: #221b14;
}

.thumb.placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  color: #6a5c4a;
  box-sizing: border-box;
}

.entry-info {
  min-width: 0;
}

.path {
  font-size: 13px;
  color: #cfc2ac;
  word-break: break-all;
  line-height: 1.5;
}

.meta {
  margin-top: 4px;
  font-size: 12px;
  color: #9a8b74;
}

.tip {
  margin-top: 12px;
  font-size: 12px;
  color: #7d7160;
}
</style>
