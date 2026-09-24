<script setup>
import { ref } from 'vue'

defineProps({
  candidates: { type: Array, default: () => [] },
  searching: Boolean,
  binding: Boolean
})

const visible = defineModel({ type: Boolean, default: false })

const emit = defineEmits(['pick', 'search', 'bind'])

const query = ref('')
const doubanId = ref('')

function doSearch() {
  const q = query.value.trim()
  if (!q) return
  emit('search', q)
}

function doBind() {
  const id = doubanId.value.trim().replace(/^.*subject\/(\d+).*$/, '$1')
  if (!/^\d+$/.test(id)) return
  emit('bind', id)
}
</script>

<template>
  <el-dialog v-model="visible" title="手动匹配豆瓣条目" width="640px" append-to-body>
    <div v-loading="binding">
      <div class="search-row">
        <el-input
          v-model="query"
          placeholder="用中文名 / 原名搜索豆瓣"
          clearable
          @keyup.enter="doSearch"
        />
        <el-button type="primary" :loading="searching" @click="doSearch">搜索</el-button>
      </div>
      <div class="id-row">
        <el-input
          v-model="doubanId"
          placeholder="或直接粘贴豆瓣条目链接 / ID，如 https://movie.douban.com/subject/1292052/"
          clearable
          @keyup.enter="doBind"
        />
        <el-button :loading="binding" @click="doBind">绑定</el-button>
      </div>
      <el-divider v-if="candidates.length || !searching" />
      <el-empty v-if="!candidates.length" description="没有搜索结果，试试原名搜索，或直接粘贴豆瓣条目链接" />
      <div v-else class="cand-list">
        <div v-for="c in candidates" :key="c.doubanId" class="cand" @click="$emit('pick', c)">
          <div class="cand-info">
            <div class="cand-title">
              {{ c.zh }}
              <span v-if="c.orig && c.orig !== c.zh" class="orig">{{ c.orig }}</span>
            </div>
            <div class="cand-meta">
              {{ c.year || '年份未知' }}
              <template v-if="c.rating"> · 豆瓣 {{ Number(c.rating).toFixed(1) }}</template>
              <template v-else> · 暂无评分</template>
            </div>
            <div v-if="c.aliases?.length" class="cand-alias">又名：{{ c.aliases.join(' / ') }}</div>
          </div>
        </div>
      </div>
    </div>
  </el-dialog>
</template>

<style scoped>
.search-row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.id-row {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-top: 10px;
}

.cand-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 60vh;
  overflow-y: auto;
}

.cand {
  display: flex;
  gap: 14px;
  padding: 10px 14px;
  border: 1px solid #2e241b;
  border-radius: 8px;
  cursor: pointer;
  transition: border-color 0.2s, background 0.2s;
}

.cand:hover {
  border-color: #e0a458;
  background: rgba(224, 164, 88, 0.06);
}

.cand-info {
  min-width: 0;
  flex: 1;
}

.cand-title {
  font-size: 15px;
  font-weight: 600;
}

.orig {
  font-size: 12px;
  color: #9a8b74;
  font-weight: 400;
  margin-left: 6px;
}

.cand-meta {
  font-size: 12px;
  color: #9a8b74;
  margin: 4px 0;
}

.cand-alias {
  font-size: 12px;
  color: #7d7160;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
