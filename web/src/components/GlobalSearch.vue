<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Search, Film, User, Collection, PriceTag, Star } from '@element-plus/icons-vue'
import { api } from '../api'

const router = useRouter()
const emit = defineEmits(['open-movie'])

const keyword = ref('')
const visible = ref(false)
const loading = ref(false)
const result = ref(null)
const activeIndex = ref(0)
const boxRef = ref(null)
const inputRef = ref(null)
let searchTimer = null

const flatItems = computed(() => {
  if (!result.value) return []
  const items = []
  for (const m of result.value.movies) items.push({ type: 'movie', label: m.title, sub: m.year ? String(m.year) : '', cover: m.cover_url, data: m })
  for (const p of result.value.people) items.push({ type: 'person', label: p.name, sub: p.is_director ? '导演' : '演员', data: p })
  for (const pl of result.value.playlists) items.push({ type: 'playlist', label: pl.name, sub: `片单 · ${pl.movie_count} 部`, data: pl })
  for (const t of result.value.tags) items.push({ type: 'tag', label: t.name, sub: `标签 · ${t.movie_count} 部`, data: t })
  for (const w of result.value.wishlist) items.push({ type: 'wishlist', label: w.title, sub: w.year ? `${w.year} · 想看` : '想看', cover: w.poster_url, data: w })
  return items
})

watch(keyword, v => {
  clearTimeout(searchTimer)
  const q = v.trim()
  if (!q) {
    visible.value = false
    result.value = null
    return
  }
  visible.value = true
  loading.value = true
  searchTimer = setTimeout(async () => {
    try {
      const r = await api.globalSearch(q, 8)
      if (keyword.value.trim() === r.q || !r.q) result.value = r
    } catch {
      result.value = null
    } finally {
      loading.value = false
    }
  }, 300)
})

watch(flatItems, () => { activeIndex.value = 0 })

function move(delta) {
  if (!flatItems.value.length) return
  activeIndex.value = (activeIndex.value + delta + flatItems.value.length) % flatItems.value.length
  nextTick(() => {
    boxRef.value?.querySelector(`[data-idx="${activeIndex.value}"]`)?.scrollIntoView({ block: 'nearest' })
  })
}

function pick(item) {
  if (!item) return
  visible.value = false
  keyword.value = ''
  switch (item.type) {
    case 'movie':
      emit('open-movie', item.data.id)
      break
    case 'person':
      router.push({ path: '/person', query: { name: item.data.name } })
      break
    case 'playlist':
      router.push({ path: '/playlists', query: { id: item.data.id } })
      break
    case 'tag':
      router.push({ path: '/movies' })
      // 借用 store 筛选：跳转后由 MoviesView 读取 query
      router.push({ path: '/movies', query: { tag: item.data.name } })
      break
    case 'wishlist':
      router.push({ path: '/wishlist' })
      break
  }
}

function onKeydown(e) {
  if (e.key === 'ArrowDown') { e.preventDefault(); move(1) }
  else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1) }
  else if (e.key === 'Enter') { e.preventDefault(); pick(flatItems.value[activeIndex.value]) }
  else if (e.key === 'Escape') { visible.value = false }
}

function onDocClick(e) {
  if (!e.target.closest('.gsearch')) visible.value = false
}
document.addEventListener('click', onDocClick)
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick)
  clearTimeout(searchTimer)
})

const typeIcon = { movie: Film, person: User, playlist: Collection, tag: PriceTag, wishlist: Star }
</script>

<template>
  <div class="gsearch">
    <el-input
      ref="inputRef"
      v-model="keyword"
      placeholder="全局搜索：电影 / 人物 / 标签 / 片单…"
      clearable
      :prefix-icon="Search"
      @focus="keyword.trim() && (visible = true)"
      @keydown="onKeydown"
    />
    <div v-if="visible" class="gsearch-panel">
      <div v-if="loading" class="gs-hint">搜索中…</div>
      <template v-else-if="result">
        <div v-if="!flatItems.length" class="gs-hint">没有找到「{{ result.q }}」相关内容</div>
        <div v-else ref="boxRef" class="gs-list">
          <div
            v-for="(item, i) in flatItems"
            :key="item.type + item.label + i"
            :data-idx="i"
            class="gs-item"
            :class="{ active: i === activeIndex }"
            @mouseenter="activeIndex = i"
            @click="pick(item)"
          >
            <img v-if="item.cover" class="gs-cover" :src="item.cover" loading="lazy" alt="" />
            <span v-else class="gs-icon"><el-icon :size="15"><component :is="typeIcon[item.type]" /></el-icon></span>
            <span class="gs-label">{{ item.label }}</span>
            <span class="gs-sub">{{ item.sub }}</span>
          </div>
        </div>
        <div class="gs-footer">↑↓ 选择 · Enter 打开 · Esc 关闭</div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.gsearch { position: relative; width: 320px; }

.gsearch :deep(.el-input__wrapper) {
  background: #1a1511;
  box-shadow: 0 0 0 1px #2e241b inset;
}

.gsearch-panel {
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  right: 0;
  z-index: 100;
  background: #1a1511;
  border: 1px solid #3a2e22;
  border-radius: 10px;
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.6);
  overflow: hidden;
}

.gs-hint {
  padding: 22px 16px;
  text-align: center;
  font-size: 13px;
  color: #9a8b74;
}

.gs-list { max-height: 420px; overflow-y: auto; }

.gs-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  cursor: pointer;
}

.gs-item.active { background: #241d16; }

.gs-cover {
  width: 26px;
  height: 39px;
  border-radius: 4px;
  object-fit: cover;
  flex-shrink: 0;
}

.gs-icon {
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  background: #241d16;
  color: #e0a458;
  flex-shrink: 0;
}

.gs-label {
  flex: 1;
  min-width: 0;
  font-size: 13.5px;
  color: #ece3d2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.gs-sub {
  flex-shrink: 0;
  font-size: 12px;
  color: #6a5c4a;
}

.gs-footer {
  padding: 7px 12px;
  font-size: 11px;
  color: #5c5142;
  border-top: 1px solid #241d16;
  text-align: center;
}

@media (max-width: 700px) { .gsearch { width: 180px; } }

@media (max-width: 700px) {
  .gsearch { width: 100% !important; flex-basis: 100%; order: 10; }
  .gsearch-panel { position: fixed; left: 10px; right: 10px; top: 64px; width: auto; }
}
</style>
