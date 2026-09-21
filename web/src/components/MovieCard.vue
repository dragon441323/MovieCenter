<script setup>
import { computed, ref, watch } from 'vue'
import { Film, CaretRight } from '@element-plus/icons-vue'

const props = defineProps({
  movie: { type: Object, required: true }
})

defineEmits(['open', 'play'])

const imgError = ref(false)
watch(() => props.movie.cover_url, () => { imgError.value = false })

const hasCover = computed(() => props.movie.cover_url && !imgError.value)

const qualityClass = computed(() => 'q-' + String(props.movie.quality || '').replace(/\./g, '-'))

const hue = computed(() => {
  let h = 0
  for (const ch of props.movie.title || '') h = (h * 31 + ch.codePointAt(0)) % 360
  return 20 + (h % 40)
})
</script>

<template>
  <div class="movie-card" @click="$emit('open', movie)">
    <div
      class="poster"
      :style="hasCover ? null : { background: `linear-gradient(165deg, hsl(${hue} 26% 22%), hsl(${(hue + 18) % 60 + 20} 30% 11%))` }"
    >
      <img v-if="hasCover" :src="movie.cover_url" :alt="movie.title" loading="lazy" @error="imgError = true" />
      <div v-else class="placeholder">
        <el-icon :size="34"><Film /></el-icon>
        <span class="ph-title">{{ movie.title }}</span>
      </div>
      <span v-if="movie.douban_rank" class="douban-badge font-display">TOP {{ movie.douban_rank }}</span>
      <div class="badges-tr">
        <span v-if="movie.my_rating != null" class="rating-badge font-display">{{ Number(movie.my_rating).toFixed(1) }}</span>
        <span v-if="movie.quality" class="quality-badge font-display" :class="qualityClass">{{ movie.quality }}</span>
      </div>
      <div class="overlay">
        <button v-if="!movie.missing" class="play-btn" title="用 PotPlayer 播放" @click.stop="$emit('play', movie)">
          <el-icon :size="20"><CaretRight /></el-icon>
        </button>
        <span class="marks">
          <span v-if="movie.watched" class="watched">✓</span>
          <span v-if="movie.favorite" class="fav">♥</span>
        </span>
      </div>
    </div>
    <div class="info">
      <div class="title" :title="movie.title">{{ movie.title }}</div>
      <div class="meta">
        <span v-if="movie.year" class="font-display yr">{{ movie.year }}</span>
        <span v-else>—</span>
        <template v-if="movie.categories?.length"><span class="dot">·</span>{{ movie.categories[0] }}</template>
      </div>
      <div class="rates">
        <span v-if="movie.rating != null" class="tmdb-rate font-display">{{ Number(movie.rating).toFixed(1) }}</span>
        <span v-if="movie.douban_rating != null" class="db-rate font-display">{{ Number(movie.douban_rating).toFixed(1) }}</span>
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
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.4);
  outline: 1px solid rgba(44, 35, 27, 0.6);
  outline-offset: -1px;
  transition: box-shadow 0.25s, transform 0.25s, outline-color 0.25s;
}

.movie-card:hover .poster {
  box-shadow: 0 14px 34px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(224, 164, 88, 0.55);
  transform: translateY(-4px);
  outline-color: transparent;
}

.poster img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  transition: transform 0.35s;
}

.movie-card:hover .poster img {
  transform: scale(1.05);
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
  color: rgba(236, 227, 210, 0.4);
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
  background: rgba(16, 14, 12, 0.82);
  color: #e0a458;
  font-size: 15px;
  padding: 2px 8px 1px;
  border-radius: 6px;
  backdrop-filter: blur(4px);
}

.badges-tr {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 2;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
}

.quality-badge {
  font-size: 13px;
  letter-spacing: 0.05em;
  padding: 1px 7px 0;
  border-radius: 6px;
  background: rgba(16, 14, 12, 0.82);
  backdrop-filter: blur(4px);
  border: 1px solid rgba(154, 139, 116, 0.45);
  color: #9a8b74;
}

.quality-badge.q-8K,
.quality-badge.q-4K {
  color: #e6c37a;
  border-color: rgba(230, 195, 122, 0.55);
}

.quality-badge.q-1080p {
  color: #cfc2ac;
  border-color: rgba(207, 194, 172, 0.45);
}

.douban-badge {
  position: absolute;
  top: 8px;
  left: 8px;
  z-index: 2;
  background: #e0a458;
  color: #100e0c;
  font-size: 13px;
  padding: 2px 7px 1px;
  border-radius: 6px;
}

.overlay {
  position: absolute;
  inset: auto 0 0 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 10px 6px;
  background: linear-gradient(transparent, rgba(10, 8, 6, 0.82));
  opacity: 0;
  transition: opacity 0.25s;
}

.movie-card:hover .overlay {
  opacity: 1;
}

.play-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: 1px solid rgba(236, 227, 210, 0.35);
  cursor: pointer;
  color: #ece3d2;
  background: rgba(16, 14, 12, 0.5);
  backdrop-filter: blur(4px);
  transition: background 0.2s, transform 0.2s, border-color 0.2s;
}

.play-btn:hover {
  background: #e0a458;
  border-color: #e0a458;
  color: #100e0c;
  transform: scale(1.1);
}

.marks {
  display: flex;
  gap: 10px;
  align-items: center;
}

.watched {
  color: #9aab6e;
  font-size: 14px;
  font-weight: 700;
}

.fav {
  color: #e07a6a;
  font-size: 14px;
}

.info {
  padding: 8px 2px 0;
}

.title {
  font-size: 13px;
  font-weight: 600;
  color: #ece3d2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.meta {
  margin-top: 2px;
  font-size: 12px;
  color: #9a8b74;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  display: flex;
  align-items: baseline;
  gap: 5px;
}

.yr {
  font-size: 13px;
  color: #cfc2ac;
}

.dot {
  color: #4e4438;
}

.rates {
  margin-top: 2px;
  font-size: 14px;
  display: flex;
  gap: 10px;
  min-height: 16px;
  white-space: nowrap;
}

.tmdb-rate {
  color: #e6c37a;
}

.db-rate {
  color: #93c78f;
}
</style>
