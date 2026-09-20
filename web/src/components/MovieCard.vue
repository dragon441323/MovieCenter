<script setup>
import { computed, ref, watch } from 'vue'
import { Film } from '@element-plus/icons-vue'

const props = defineProps({
  movie: { type: Object, required: true }
})

defineEmits(['open'])

const imgError = ref(false)
watch(() => props.movie.cover_url, () => { imgError.value = false })

const hasCover = computed(() => props.movie.cover_url && !imgError.value)

const hue = computed(() => {
  let h = 0
  for (const ch of props.movie.title || '') h = (h * 31 + ch.codePointAt(0)) % 360
  return h
})
</script>

<template>
  <div class="movie-card" @click="$emit('open', movie)">
    <div
      class="poster"
      :style="hasCover ? null : { background: `linear-gradient(160deg, hsl(${hue} 42% 24%), hsl(${(hue + 40) % 360} 48% 12%))` }"
    >
      <img v-if="hasCover" :src="movie.cover_url" :alt="movie.title" loading="lazy" @error="imgError = true" />
      <div v-else class="placeholder">
        <el-icon :size="34"><Film /></el-icon>
        <span class="ph-title">{{ movie.title }}</span>
      </div>
      <span v-if="movie.my_rating != null" class="rating-badge">★ {{ Number(movie.my_rating).toFixed(1) }}</span>
      <div class="overlay">
        <span class="marks">
          <span v-if="movie.watched" class="watched">✓</span>
          <span v-if="movie.favorite" class="fav">♥</span>
        </span>
      </div>
    </div>
    <div class="info">
      <div class="title" :title="movie.title">{{ movie.title }}</div>
      <div class="meta">
        {{ movie.year || '—' }}<template v-if="movie.categories?.length"> · {{ movie.categories[0] }}</template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.movie-card {
  cursor: pointer;
}

.poster {
  position: relative;
  aspect-ratio: 2 / 3;
  border-radius: 10px;
  overflow: hidden;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.35);
  transition: box-shadow 0.25s, transform 0.25s;
}

.movie-card:hover .poster {
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.55);
  transform: translateY(-4px);
}

.poster img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  transition: transform 0.3s;
}

.movie-card:hover .poster img {
  transform: scale(1.06);
}

.placeholder {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 14px;
  color: rgba(255, 255, 255, 0.55);
}

.ph-title {
  font-size: 13px;
  text-align: center;
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.rating-badge {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 2;
  background: rgba(10, 14, 20, 0.78);
  color: #6fe3c1;
  font-size: 12px;
  font-weight: 700;
  padding: 3px 9px;
  border-radius: 20px;
  backdrop-filter: blur(4px);
}

.overlay {
  position: absolute;
  inset: auto 0 0 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding: 18px 10px 6px;
  background: linear-gradient(transparent, rgba(0,  0, 0, 0.75));
  opacity: 0;
  transition: opacity 0.25s;
}

.movie-card:hover .overlay {
  opacity: 1;
}

.marks {
  display: flex;
  gap: 10px;
  align-items: center;
}

.watched {
  color: #67c23a;
  font-size: 14px;
  font-weight: 700;
}

.fav {
  color: #f56c6c;
  font-size: 14px;
}

.info {
  padding: 8px 2px 0;
}

.title {
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.meta {
  margin-top: 2px;
  font-size: 12px;
  color: #8b93a5;
}
</style>
