<script setup>
import { ref } from 'vue'

defineProps({
  candidates: { type: Array, default: () => [] },
  scraping: Boolean,
  searching: Boolean,
  looking: Boolean
})

const visible = defineModel({ type: Boolean, default: false })

const emit = defineEmits(['pick', 'search', 'lookup'])

const query = ref('')
const year = ref(null)
const imdbId = ref('')

function doSearch() {
  const q = query.value.trim()
  if (!q) return
  emit('search', { query: q, year: year.value })
}

function doLookup() {
  const id = imdbId.value.trim()
  if (!id) return
  emit('lookup', id)
}
</script>

<template>
  <el-dialog v-model="visible" title="选择 TMDB 匹配结果" width="640px" append-to-body>
    <div v-loading="scraping">
      <div class="search-row">
        <el-input
          v-model="query"
          placeholder="中文搜不到？用英文名 / 原片名搜索 TMDB"
          clearable
          @keyup.enter="doSearch"
        />
        <el-input-number
          v-model="year"
          :min="1888"
          :max="2100"
          :value-on-clear="null"
          controls-position="right"
          placeholder="年份"
          class="year-input"
        />
        <el-button type="primary" :loading="searching" @click="doSearch">搜索</el-button>
      </div>
      <div class="imdb-row">
        <el-input
          v-model="imdbId"
          placeholder="或按 IMDb ID 精确匹配（豆瓣 / 维基可查到），例如 tt1375666"
          clearable
          @keyup.enter="doLookup"
        />
        <el-button :loading="looking" @click="doLookup">匹配</el-button>
      </div>
      <el-divider v-if="candidates.length || !searching" />
      <el-empty v-if="!candidates.length" description="没有匹配结果，试试上方按英文名 / 原名搜索，或用 IMDb ID 精确匹配" />
      <div v-else class="cand-list">
        <div v-for="c in candidates" :key="c.tmdb_id" class="cand" @click="$emit('pick', c)">
          <img v-if="c.poster_url" :src="c.poster_url" loading="lazy" alt="" />
          <div v-else class="no-poster">无海报</div>
          <div class="cand-info">
            <div class="cand-title">
              {{ c.title }}
              <span v-if="c.original_title && c.original_title !== c.title" class="orig">{{ c.original_title }}</span>
            </div>
            <div class="cand-meta">
              {{ c.year || '年份未知' }}
              <template v-if="c.vote_average"> · ★ {{ Number(c.vote_average).toFixed(1) }}</template>
            </div>
            <div class="cand-overview">{{ c.overview || '暂无简介' }}</div>
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

.year-input {
  width: 110px;
  flex-shrink: 0;
}

.imdb-row {
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
  padding: 10px;
  border: 1px solid #232b3b;
  border-radius: 8px;
  cursor: pointer;
  transition: border-color 0.2s, background 0.2s;
}

.cand:hover {
  border-color: #4d8ff0;
  background: rgba(77, 143, 240, 0.06);
}

.cand img,
.no-poster {
  width: 60px;
  height: 90px;
  object-fit: cover;
  border-radius: 4px;
  flex-shrink: 0;
  background: #1a2130;
}

.no-poster {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  color: #4a5568;
  box-sizing: border-box;
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
  color: #8b93a5;
  font-weight: 400;
  margin-left: 6px;
}

.cand-meta {
  font-size: 12px;
  color: #8b93a5;
  margin: 4px 0;
}

.cand-overview {
  font-size: 12px;
  color: #6b7385;
  line-height: 1.6;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
