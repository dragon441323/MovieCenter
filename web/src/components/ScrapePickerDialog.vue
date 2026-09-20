<script setup>
defineProps({
  candidates: { type: Array, default: () => [] },
  scraping: Boolean
})

const visible = defineModel({ type: Boolean, default: false })

defineEmits(['pick'])
</script>

<template>
  <el-dialog v-model="visible" title="选择 TMDB 匹配结果" width="600px" append-to-body>
    <div v-loading="scraping">
      <el-empty v-if="!candidates.length" description="TMDB 未找到匹配结果，可在编辑中修改标题后重试" />
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
