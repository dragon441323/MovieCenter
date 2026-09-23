<script setup>
import { ref, watch } from 'vue'
import { api } from '../api'

const props = defineProps({
  collectionId: { type: Number, default: null }
})

const visible = defineModel({ type: Boolean, default: false })
const emit = defineEmits(['open-movie'])

const name = ref('')
const parts = ref([])
const loading = ref(false)

watch(visible, async v => {
  if (!v || !props.collectionId) return
  loading.value = true
  parts.value = []
  try {
    const r = await api.collection(props.collectionId)
    name.value = r.name
    parts.value = r.parts || []
  } catch (e) {
    parts.value = []
    name.value = ''
  } finally {
    loading.value = false
  }
})

function openPart(p) {
  if (!p.in_library || !p.movie_id) return
  visible.value = false
  emit('open-movie', p.movie_id)
}
</script>

<template>
  <el-dialog v-model="visible" :title="`合集 · ${name || '系列'}`" width="820px" top="6vh" append-to-body>
    <div v-loading="loading" class="col-body">
      <div class="parts">
        <div
          v-for="(p, i) in parts"
          :key="p.tmdb_id"
          class="part"
          :class="{ missing: !p.in_library, clickable: p.in_library }"
          @click="openPart(p)"
        >
          <img v-if="p.poster_url" :src="p.poster_url" :alt="p.title" loading="lazy" />
          <div v-else class="no-poster">无海报</div>
          <div class="idx">{{ i + 1 }}</div>
          <div v-if="!p.in_library" class="badge">未入库</div>
          <div class="part-title" :title="p.title">{{ p.title }}</div>
          <div class="part-year">{{ p.year || '—' }}</div>
        </div>
      </div>
      <el-empty v-if="!loading && !parts.length" description="暂无合集信息" />
    </div>
    <template #footer>
      <el-button @click="visible = false">关闭</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.col-body {
  min-height: 160px;
}

.parts {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
  gap: 16px 14px;
  max-height: 62vh;
  overflow-y: auto;
}

.part {
  position: relative;
  cursor: default;
}

.part.clickable {
  cursor: pointer;
}

.part.missing {
  opacity: 0.45;
  filter: grayscale(0.6);
}

.part img,
.no-poster {
  width: 100%;
  aspect-ratio: 2 / 3;
  object-fit: cover;
  border-radius: 8px;
  background: #221b14;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.35);
}

.no-poster {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: #6a5c4a;
  box-sizing: border-box;
}

.idx {
  position: absolute;
  top: 6px;
  left: 6px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: rgba(10, 14, 20, 0.8);
  color: #ece3d2;
  font-size: 12px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}

.badge {
  position: absolute;
  top: 6px;
  right: 6px;
  background: rgba(230, 162, 60, 0.9);
  color: #10151f;
  font-size: 11px;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 10px;
}

.part-title {
  margin-top: 8px;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.part-year {
  font-size: 12px;
  color: #9a8b74;
}

@media (max-width: 700px) {
  .col-grid { grid-template-columns: repeat(3, minmax(0, 1fr)) !important; }
}
</style>
