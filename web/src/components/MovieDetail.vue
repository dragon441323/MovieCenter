<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { Star, StarFilled, Film, CircleCheck, CircleCheckFilled, Plus } from '@element-plus/icons-vue'
import { api } from '../api'
import { formatSize } from '../utils'
import { useLibraryStore } from '../stores/library'
import ScrapePickerDialog from './ScrapePickerDialog.vue'

const props = defineProps({
  movie: { type: Object, required: true }
})

const emit = defineEmits(['updated'])

const store = useLibraryStore()
const visible = defineModel({ type: Boolean, default: false })

const editing = ref(false)
const saving = ref(false)
const uploading = ref(false)
const fileInput = ref(null)

const form = reactive({
  title: '', year: null, categories: [], director: '',
  actors: [], tags: [], rating: null, my_rating: null,
  favorite: false, watched: false, watch_count: 0, synopsis: ''
})

watch(() => props.movie, m => {
  if (m) resetForm(m)
})

watch(visible, v => {
  if (!v) editing.value = false
})

function resetForm(m) {
  form.title = m.title
  form.year = m.year
  form.categories = m.categories ? [...m.categories] : []
  form.director = m.director || ''
  form.actors = m.actors ? [...m.actors] : []
  form.tags = m.tags ? m.tags.map(t => t.name) : []
  form.rating = m.rating
  form.my_rating = m.my_rating
  form.favorite = !!m.favorite
  form.watched = !!m.watched
  form.watch_count = m.watch_count || 0
  form.synopsis = m.synopsis || ''
}

async function save() {
  if (!form.title.trim()) {
    ElMessage.warning('标题不能为空')
    return
  }
  saving.value = true
  try {
    const updated = await api.updateMovie(props.movie.id, {
      title: form.title.trim(),
      year: form.year,
      categories: form.categories,
      director: form.director,
      actors: form.actors,
      tags: form.tags,
      rating: form.rating,
      my_rating: form.my_rating,
      favorite: form.favorite,
      watched: form.watched,
      watch_count: form.watch_count,
      synopsis: form.synopsis
    })
    ElMessage.success('已保存')
    editing.value = false
    emit('updated', updated)
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    saving.value = false
  }
}

async function toggleFavorite() {
  try {
    const updated = await api.updateMovie(props.movie.id, { favorite: !props.movie.favorite })
    emit('updated', updated)
  } catch (e) {
    ElMessage.error(e.message)
  }
}

async function toggleWatched() {
  try {
    const updated = await api.updateMovie(props.movie.id, { watched: !props.movie.watched })
    emit('updated', updated)
  } catch (e) {
    ElMessage.error(e.message)
  }
}

async function onMyRate(v) {
  try {
    const updated = await api.updateMovie(props.movie.id, { my_rating: v || null })
    emit('updated', updated)
  } catch (e) {
    ElMessage.error(e.message)
  }
}

async function incWatchCount() {
  try {
    const updated = await api.watchMovie(props.movie.id)
    emit('updated', updated)
  } catch (e) {
    ElMessage.error(e.message)
  }
}

function pickCover() {
  fileInput.value?.click()
}

async function onCoverChange(e) {
  const file = e.target.files?.[0]
  e.target.value = ''
  if (!file) return
  uploading.value = true
  try {
    const updated = await api.uploadCover(props.movie.id, file)
    ElMessage.success('封面已更新')
    emit('updated', updated)
  } catch (err) {
    ElMessage.error(err.message)
  } finally {
    uploading.value = false
  }
}

async function removeCover() {
  try {
    const updated = await api.removeCover(props.movie.id)
    emit('updated', updated)
  } catch (e) {
    ElMessage.error(e.message)
  }
}

const tagOptions = computed(() => {
  const names = new Set(store.meta.tags.map(t => t.name))
  form.tags.forEach(t => names.add(t))
  return [...names].map(n => ({ value: n, label: n }))
})

const categoryOptions = computed(() => {
  const set = new Set(store.meta.categories)
  form.categories.forEach(c => set.add(c))
  return [...set]
})

const videoName = computed(() => {
  const p = props.movie.video_file || ''
  return p.split(/[\\/]/).pop() || p
})

const scraping = ref(false)
const pickerVisible = ref(false)
const candidates = ref([])

async function scrape(tmdbId) {
  scraping.value = true
  try {
    const r = await api.scrapeMovie(props.movie.id, tmdbId)
    if (r.status === 'applied') {
      ElMessage.success('TMDB 信息已应用')
      pickerVisible.value = false
      emit('updated', r.movie)
    } else if (r.status === 'candidates') {
      candidates.value = r.candidates
      pickerVisible.value = true
    }
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    scraping.value = false
  }
}
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="editing ? '编辑电影' : '电影详情'"
    width="860px"
    top="5vh"
    class="movie-dialog"
  >
    <div v-if="!editing" class="detail-body">
      <div class="detail-cover">
        <img v-if="movie.cover_url" :src="movie.cover_url" :alt="movie.title" />
        <div v-else class="no-cover"><el-icon :size="44"><Film /></el-icon></div>
      </div>
      <div class="detail-info">
        <div class="head-row">
          <h2>{{ movie.title }}<span v-if="movie.year" class="year">（{{ movie.year }}）</span></h2>
          <div class="head-actions">
            <el-tooltip :content="movie.watched ? '标记为未看' : '标记为已看'" placement="top">
              <el-button
                circle
                :type="movie.watched ? 'success' : 'default'"
                @click="toggleWatched"
              >
                <el-icon><CircleCheckFilled v-if="movie.watched" /><CircleCheck v-else /></el-icon>
              </el-button>
            </el-tooltip>
            <el-tooltip :content="movie.favorite ? '取消收藏' : '收藏'" placement="top">
              <el-button
                circle
                :type="movie.favorite ? 'danger' : 'default'"
                @click="toggleFavorite"
              >
                <el-icon><StarFilled v-if="movie.favorite" /><Star v-else /></el-icon>
              </el-button>
            </el-tooltip>
          </div>
        </div>
        <div class="chips">
          <el-tag v-for="c in movie.categories" :key="c" type="primary" effect="dark">{{ c }}</el-tag>
          <el-tag v-for="t in movie.tags" :key="t.id" effect="plain">{{ t.name }}</el-tag>
        </div>
        <div class="rating-row">
          <span v-if="movie.rating != null" class="score tmdb">TMDB {{ Number(movie.rating).toFixed(1) }}</span>
          <div class="my-rate">
            <span class="my-rate-label">我的评分</span>
            <el-rate
              :model-value="movie.my_rating ?? 0"
              allow-half
              clearable
              :max="10"
              @change="onMyRate"
            />
            <span v-if="movie.my_rating != null" class="my-rate-num">{{ Number(movie.my_rating).toFixed(1) }}</span>
          </div>
        </div>
        <dl class="facts">
          <div class="fact"><dt>导演</dt><dd>{{ movie.director || '—' }}</dd></div>
          <div class="fact"><dt>主演</dt><dd>{{ movie.actors.length ? movie.actors.join(' / ') : '—' }}</dd></div>
          <div class="fact">
            <dt>观看</dt>
            <dd class="watch-dd">
              {{ movie.watch_count || 0 }} 次
              <el-button size="small" circle type="primary" plain title="记一次观看" @click="incWatchCount">
                <el-icon><Plus /></el-icon>
              </el-button>
            </dd>
          </div>
        </dl>
        <p class="synopsis">{{ movie.synopsis || '暂无简介' }}</p>
        <div class="fileinfo">
          <div class="filename" :title="movie.video_file">{{ videoName }}</div>
          <div>{{ formatSize(movie.file_size) }} · {{ movie.path }}</div>
          <div v-if="movie.tmdb_id" class="tmdb-line">TMDB ID: {{ movie.tmdb_id }}</div>
        </div>
      </div>
    </div>

    <div v-else class="detail-body">
      <div class="detail-cover edit">
        <img v-if="movie.cover_url" :src="movie.cover_url" :alt="movie.title" />
        <div v-else class="no-cover"><el-icon :size="44"><Film /></el-icon></div>
        <div class="cover-actions">
          <el-button size="small" :loading="uploading" @click="pickCover">
            {{ movie.cover_url ? '更换封面' : '上传封面' }}
          </el-button>
          <el-button v-if="movie.cover_url" size="small" @click="removeCover">移除封面</el-button>
        </div>
        <input
          ref="fileInput"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          hidden
          @change="onCoverChange"
        />
      </div>
      <el-form label-width="80px" class="edit-form" label-position="left">
        <el-form-item label="标题" required>
          <el-input v-model="form.title" maxlength="200" />
        </el-form-item>
        <div class="form-row">
          <el-form-item label="年份">
            <el-input-number
              v-model="form.year"
              :min="1888"
              :max="2100"
              :value-on-clear="null"
              controls-position="right"
              class="w100"
            />
          </el-form-item>
          <el-form-item label="分类">
            <el-select
              v-model="form.categories"
              multiple
              filterable
              allow-create
              default-first-option
              placeholder="选择或输入分类"
              class="w100"
            >
              <el-option v-for="c in categoryOptions" :key="c" :label="c" :value="c" />
            </el-select>
          </el-form-item>
        </div>
        <el-form-item label="导演">
          <el-input v-model="form.director" maxlength="200" />
        </el-form-item>
        <el-form-item label="演员">
          <el-select
            v-model="form.actors"
            multiple
            filterable
            allow-create
            default-first-option
            placeholder="输入演员名后回车添加"
          />
        </el-form-item>
        <el-form-item label="标签">
          <el-select
            v-model="form.tags"
            multiple
            filterable
            allow-create
            default-first-option
            placeholder="从已有标签选择，或输入新标签"
          >
            <el-option v-for="t in tagOptions" :key="t.value" :label="t.label" :value="t.value" />
          </el-select>
        </el-form-item>
        <div class="form-row">
          <el-form-item label="TMDB评分">
            <el-rate v-model="form.rating" allow-half :max="10" />
          </el-form-item>
          <el-form-item label="我的评分">
            <el-rate v-model="form.my_rating" allow-half :max="10" />
          </el-form-item>
        </div>
        <div class="form-row">
          <el-form-item label="收藏">
            <el-switch v-model="form.favorite" />
          </el-form-item>
          <el-form-item label="已看">
            <el-switch v-model="form.watched" />
          </el-form-item>
          <el-form-item label="观看次数">
            <el-input-number
              v-model="form.watch_count"
              :min="0"
              :max="99999"
              controls-position="right"
              class="w100"
            />
          </el-form-item>
        </div>
        <el-form-item label="简介">
          <el-input v-model="form.synopsis" type="textarea" :rows="4" maxlength="5000" show-word-limit />
        </el-form-item>
      </el-form>
    </div>

    <template #footer>
      <div v-if="!editing">
        <el-button :loading="scraping" @click="scrape()">TMDB 同步</el-button>
        <el-button type="primary" @click="editing = true">编辑信息</el-button>
      </div>
      <div v-else>
        <el-button @click="resetForm(movie)">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </div>
    </template>
  </el-dialog>

  <ScrapePickerDialog v-model="pickerVisible" :candidates="candidates" :scraping="scraping" @pick="c => scrape(c.tmdb_id)" />
</template>

<style scoped>
.detail-body {
  display: flex;
  gap: 24px;
  min-height: 380px;
}

.detail-cover {
  flex: 0 0 220px;
}

.detail-cover img,
.no-cover {
  width: 220px;
  aspect-ratio: 2 / 3;
  object-fit: cover;
  border-radius: 10px;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.45);
}

.no-cover {
  display: flex;
  align-items: center;
  justify-content: center;
  background: #1a2130;
  color: #4a5568;
  box-sizing: border-box;
}

.detail-cover.edit {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.cover-actions {
  display: flex;
  gap: 8px;
  justify-content: center;
}

.detail-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.head-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.head-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.head-row h2 {
  margin: 0;
  font-size: 22px;
  line-height: 1.4;
}

.year {
  font-size: 16px;
  color: #8b93a5;
  font-weight: 400;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 10px 0 4px;
}

.rating-row {
  display: flex;
  gap: 18px;
  align-items: center;
  margin: 4px 0;
  font-size: 15px;
  font-weight: 700;
}

.score.tmdb {
  color: #ffc24a;
}

.my-rate {
  display: flex;
  align-items: center;
  gap: 10px;
}

.my-rate-label {
  font-size: 13px;
  font-weight: 400;
  color: #8b93a5;
}

.my-rate-num {
  color: #6fe3c1;
  font-size: 14px;
  font-weight: 700;
}

.watch-dd {
  display: flex;
  align-items: center;
  gap: 8px;
}

.facts {
  margin: 8px 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.fact {
  display: flex;
  font-size: 14px;
}

.fact dt {
  color: #8b93a5;
  flex: 0 0 3em;
}

.fact dd {
  margin: 0;
}

.synopsis {
  flex: 1;
  overflow-y: auto;
  max-height: 200px;
  margin: 8px 0;
  line-height: 1.8;
  font-size: 14px;
  color: #c0c7d4;
  white-space: pre-line;
}

.fileinfo {
  font-size: 12px;
  color: #6b7385;
  line-height: 1.7;
  word-break: break-all;
  border-top: 1px solid #232b3b;
  padding-top: 10px;
}

.filename {
  color: #8b93a5;
}

.edit-form {
  flex: 1;
  min-width: 0;
}

.form-row {
  display: flex;
  gap: 16px;
}

.form-row .el-form-item {
  flex: 1;
}

.w100 {
  width: 100%;
}
</style>
