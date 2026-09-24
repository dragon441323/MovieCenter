<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Star, StarFilled, Film, CircleCheck, CircleCheckFilled, Plus, CaretRight, Refresh, ArrowDown, Monitor } from '@element-plus/icons-vue'
import { api } from '../api'
import { formatSize } from '../utils'
import { useLibraryStore } from '../stores/library'
import ScrapePickerDialog from './ScrapePickerDialog.vue'
import DoubanPickerDialog from './DoubanPickerDialog.vue'
import CollectionDialog from './CollectionDialog.vue'
import VideoPlayer from './VideoPlayer.vue'

const props = defineProps({
  movie: { type: Object, required: true }
})

const emit = defineEmits(['updated', 'open-movie', 'open-person'])

const store = useLibraryStore()
const visible = defineModel({ type: Boolean, default: false })

const editing = ref(false)
const saving = ref(false)
const uploading = ref(false)
const fileInput = ref(null)

const form = reactive({
  title: '', year: null, categories: [], countries: [], director: '',
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
  form.original_title = m.original_title || ''
  form.year = m.year
  form.categories = m.categories ? [...m.categories] : []
  form.countries = m.countries ? [...m.countries] : []
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
      original_title: form.original_title.trim(),
      year: form.year,
      categories: form.categories,
      countries: form.countries,
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
    loadRatings()
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
    loadRatings()
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

async function play() {
  try {
    await api.playMovie(props.movie.id)
  } catch (e) {
    ElMessage.error(e.message)
  }
}

// 播放方式选择弹窗
const playChoiceVisible = ref(false)
const playProbe = ref(null)
const playProbing = ref(false)
const subChoice = ref(-1)   // 在线播放字幕轨（-1 = 无字幕）
const webSubIdx = ref(-1)   // 传给网页播放器的字幕轨
const webTargetH = ref(1080) // 传给网页播放器的转码目标高度
const audioChoice = ref(0)  // 在线播放音轨（第几条）
const webAudioIdx = ref(0)  // 传给网页播放器的音轨

// 探测编码 + 按记忆偏好初始化字幕/分辨率选择（默认中文优先自动选轨；上次选了"无字幕"则默认关）
async function probeForPlay() {
  playProbe.value = null
  playProbing.value = true
  try {
    playProbe.value = await api.streamProbe(props.movie.id)
  } catch {
    playProbe.value = null
  } finally {
    playProbing.value = false
  }
  let pref = null
  try { pref = localStorage.getItem('mc_sub_pref') } catch {}
  subChoice.value = pref === 'off' ? -1 : (playProbe.value?.defaultSub ?? -1)
  // 分辨率偏好：上次选过 4K 就保持 4K（源不够 4K 时服务端会自动取源高度）
  let hp = null
  try { hp = parseInt(localStorage.getItem('mc_target_h')) } catch {}
  webTargetH.value = hp === 2160 ? 2160 : 1080
  // 音轨默认第一条（不记偏好：多音轨片少，每次看第一条（通常为国语/原声主轨）更可预期）
  audioChoice.value = 0
}

// 是否显示分辨率选择：源超过 1080p 才有意义（4K 片选 4K/1080p）
const showQualityChoice = computed(() =>
  (playProbe.value?.probe_ok && (playProbe.value.height || 0) > 1200) ||
  (playProbe.value?.probe_ok && playProbe.value.mode === 'transcode' && (playProbe.value.height || 0) > 1080)
)

async function openPlayChoice() {
  playChoiceVisible.value = true
  await probeForPlay()
}

// 字幕轨下拉文字：内嵌轨语言标记转中文
const SUB_LANG_NAMES = { zho: '中文', chi: '中文', zh: '中文', eng: '英语', jpn: '日语', kor: '韩语' }
function subLabel(s) {
  if (s.kind === 'file') return `外挂 · ${s.label}`
  const lang = SUB_LANG_NAMES[s.lang] || (s.lang ? s.lang.toUpperCase() : '')
  return lang ? `${s.label} · ${lang}` : s.label
}

function choosePlay(mode) {
  playChoiceVisible.value = false
  if (mode === 'web') {
    // 记住字幕/分辨率偏好
    try {
      localStorage.setItem('mc_sub_pref', subChoice.value === -1 ? 'off' : 'auto')
      localStorage.setItem('mc_target_h', String(webTargetH.value))
    } catch {}
    webSubIdx.value = subChoice.value
    webAudioIdx.value = audioChoice.value
    visible.value = false // 关闭详情弹窗，全屏播放
    openWebPlayer()
  } else play()
}

// 供父组件调用：打开详情的同时弹出播放方式选择
async function openWithPlay() {
  playChoiceVisible.value = true
  await probeForPlay()
}

defineExpose({ openWithPlay })

// 网页播放器（直连/服务器转码）
const webPlayerVisible = ref(false)

function openWebPlayer() {
  webPlayerVisible.value = true
}

// 评分历史
const ratings = ref([])
const ratingLoading = ref(false)
const noteDialogVisible = ref(false)
const savingNote = ref(false)
const noteForm = reactive({ id: null, note: '' })

async function loadRatings() {
  if (!props.movie?.id) return
  ratingLoading.value = true
  try {
    const data = await api.movieRatings(props.movie.id)
    ratings.value = data.items
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    ratingLoading.value = false
  }
}

function openNoteDialog(r) {
  noteForm.id = r.id
  noteForm.note = r.note || ''
  noteDialogVisible.value = true
}

async function saveNote() {
  savingNote.value = true
  try {
    const note = noteForm.note.trim()
    await api.updateRatingNote(props.movie.id, noteForm.id, note)
    const i = ratings.value.findIndex(x => x.id === noteForm.id)
    if (i >= 0) ratings.value[i].note = note
    noteDialogVisible.value = false
    ElMessage.success('评价已保存')
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    savingNote.value = false
  }
}

async function removeRating(r) {
  try {
    await ElMessageBox.confirm('删除这条评分记录？', '提示', { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' })
  } catch { return }
  try {
    await api.removeRating(props.movie.id, r.id)
    ratings.value = ratings.value.filter(x => x.id !== r.id)
  } catch (e) {
    ElMessage.error(e.message)
  }
}

// SQLite datetime('now') 为 UTC，转本地时间展示
function formatHistoryTime(s) {
  if (!s) return ''
  const [date, time] = s.split(' ')
  if (!date || !time) return s
  const [y, mo, da] = date.split('-').map(Number)
  const [h, mi] = time.split(':').map(Number)
  return new Date(Date.UTC(y, mo - 1, da, h, mi)).toLocaleString('zh-CN', { hour12: false })
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

const countryOptions = computed(() => {
  const set = new Set(store.meta.countries)
  form.countries.forEach(c => set.add(c))
  return [...set]
})

const videoName = computed(() => {
  const p = props.movie.video_file || ''
  return p.split(/[\\/]/).pop() || p
})

const directorNames = computed(() =>
  String(props.movie.director || '').split(/[\/、,，;；|]/).map(s => s.trim()).filter(Boolean)
)

// 优先展示 TMDB 原名；没有时回退解析标题中的英文部分（如「星际穿越 Interstellar」→ Interstellar）
const displayOriginal = computed(() => {
  const t = props.movie.title || ''
  const orig = props.movie.original_title || ''
  if (orig && orig !== t) return orig
  if (orig === t) return ''
  const m = t.match(/([A-Za-z][A-Za-z0-9 .'&:()-]*)/)
  const parsed = m ? m[0].trim() : ''
  return parsed && parsed !== t ? parsed : ''
})

const scraping = ref(false)
const pickerVisible = ref(false)
// 豆瓣手动匹配
const doubanPickerVisible = ref(false)
const doubanCandidates = ref([])
const doubanSearching = ref(false)
const doubanBinding = ref(false)

async function onDoubanSearch(q) {
  doubanSearching.value = true
  try {
    const r = await api.doubanSearch(props.movie.id, q)
    doubanCandidates.value = r.candidates
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    doubanSearching.value = false
  }
}

async function onDoubanPick(c) {
  return onDoubanBind(c.doubanId)
}

async function onDoubanBind(doubanId) {
  doubanBinding.value = true
  try {
    const r = await api.doubanBind(props.movie.id, doubanId)
    ElMessage.success(r.douban_rating != null ? `豆瓣评分已更新：${Number(r.douban_rating).toFixed(1)}` : '已绑定豆瓣条目（该条目暂无评分）')
    doubanPickerVisible.value = false
    emit('updated', { ...props.movie, douban_id: r.douban_id, douban_rating: r.douban_rating })
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    doubanBinding.value = false
  }
}

/** 「数据同步」下拉菜单入口 */
const syncingData = ref(false)

async function onSyncCommand(cmd) {
  if (cmd === 'tmdb') return scrape()
  if (cmd === 'douban-manual') {
    doubanCandidates.value = []
    doubanPickerVisible.value = true
    return
  }
  if (cmd === 'douban') {
    syncingData.value = true
    try {
      const r = await api.doubanSyncMovie(props.movie.id)
      if (r.matched) {
        ElMessage.success(r.douban_rating != null ? `豆瓣评分已同步：${Number(r.douban_rating).toFixed(1)}` : '已匹配豆瓣条目（暂无评分）')
        emit('updated', { ...props.movie, douban_id: r.douban_id, douban_rating: r.douban_rating })
      } else {
        // 自动匹配失败 → 引导手动
        ElMessage.warning('自动匹配没找到，试试手动匹配')
        doubanCandidates.value = []
        doubanPickerVisible.value = true
      }
    } catch (e) {
      ElMessage.error(e.message)
    } finally {
      syncingData.value = false
    }
  }
}
const candidates = ref([])
const collectionVisible = ref(false)
const searching = ref(false)
const looking = ref(false)

// 相似推荐
const similar = ref([])
const similarLoading = ref(false)

async function loadSimilar() {
  if (!props.movie?.id) return
  similarLoading.value = true
  try {
    const r = await api.similarMovies(props.movie.id)
    similar.value = r.items || []
  } catch {
    similar.value = []
  } finally {
    similarLoading.value = false
  }
}

watch(() => props.movie?.id, id => {
  if (id) {
    loadSimilar()
    loadRatings()
  }
})

// 画质重识别
const reprobing = ref(false)

async function reprobeQuality() {
  reprobing.value = true
  try {
    const updated = await api.reprobeQuality(props.movie.id)
    ElMessage.success(`画质已更新为 ${updated.quality || '未知'}`)
    emit('updated', updated)
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    reprobing.value = false
  }
}

// NFO 导出
const exportingNfo = ref(false)

async function exportNfo() {
  exportingNfo.value = true
  try {
    const r = await api.exportNfo(props.movie.id)
    ElMessage.success(`NFO 已导出到影片文件夹`)
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    exportingNfo.value = false
  }
}

// 加入片单
const playlistVisible = ref(false)
const playlists = ref([])
const playlistsLoading = ref(false)
const newPlaylistName = ref('')
const addingPlaylist = ref(false)

async function openPlaylistDialog() {
  playlistVisible.value = true
  playlistsLoading.value = true
  try {
    const r = await api.playlists()
    playlists.value = r.items
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    playlistsLoading.value = false
  }
}

async function addTo(pl) {
  try {
    await api.addToPlaylist(pl.id, props.movie.id)
    ElMessage.success(`已加入「${pl.name}」`)
    playlistVisible.value = false
  } catch (e) {
    ElMessage.error(e.message)
  }
}

async function createAndAdd() {
  const name = newPlaylistName.value.trim()
  if (!name) return
  addingPlaylist.value = true
  try {
    const created = await api.createPlaylist(name)
    await api.addToPlaylist(created.id, props.movie.id)
    ElMessage.success(`已创建「${name}」并加入`)
    newPlaylistName.value = ''
    playlistVisible.value = false
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    addingPlaylist.value = false
  }
}

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

async function onManualSearch({ query, year }) {
  searching.value = true
  try {
    candidates.value = await api.scrapeSearch(query, year)
    pickerVisible.value = true
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    searching.value = false
  }
}

async function onLookup(imdbId) {
  looking.value = true
  try {
    const r = await api.scrapeMovie(props.movie.id, null, imdbId)
    if (r.status === 'applied') {
      ElMessage.success('TMDB 信息已应用')
      pickerVisible.value = false
      emit('updated', r.movie)
    }
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    looking.value = false
  }
}
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="editing ? '编辑电影' : '电影详情'"
    width="min(50vw, 1000px)"
    align-center
    class="movie-dialog"
  >
    <div v-if="!editing" class="detail-body">
      <div class="detail-cover">
        <img v-if="movie.cover_url" :src="movie.cover_url" :alt="movie.title" />
        <div v-else class="no-cover"><el-icon :size="44"><Film /></el-icon></div>
      </div>
      <div class="detail-info">
        <div class="head-row">
          <div class="title-block">
            <h2>{{ movie.title }}<span v-if="movie.year" class="year">（{{ movie.year }}）</span></h2>
            <div v-if="displayOriginal" class="orig-title">{{ displayOriginal }}</div>
            <div v-if="movie.douban_rank" class="douban-tag">豆瓣 Top 250 第 {{ movie.douban_rank }} 名</div>
          </div>
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
          <el-tag
            v-if="movie.collection_name"
            class="collection-tag"
            type="warning"
            effect="dark"
            title="查看系列"
            @click="collectionVisible = true"
          >{{ movie.collection_name }} ▸</el-tag>
        </div>
        <div class="rating-row">
          <span v-if="movie.rating != null" class="score tmdb">TMDB {{ Number(movie.rating).toFixed(1) }}</span>
          <span v-if="movie.douban_rating != null" class="score douban">豆瓣 {{ Number(movie.douban_rating).toFixed(1) }}</span>
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
        <div v-loading="ratingLoading" class="rating-history">
          <div class="rh-header"><span class="rh-title">评分历史</span></div>
          <div v-if="!ratings.length" class="rh-empty">暂无记录，修改「我的评分」后自动添加</div>
          <div v-for="r in ratings" :key="r.id" class="rh-item">
            <div class="rh-body">
              <div class="rh-main">
                <span class="rh-rating">★ {{ r.rating != null ? Number(r.rating).toFixed(1) : '—' }}</span>
                <span class="rh-time">{{ formatHistoryTime(r.created_at) }}</span>
              </div>
              <div v-if="r.note" class="rh-note">{{ r.note }}</div>
            </div>
            <div class="rh-actions">
              <el-button link type="primary" size="small" @click="openNoteDialog(r)">
                {{ r.note ? '编辑评价' : '写评价' }}
              </el-button>
              <el-button link type="danger" size="small" @click="removeRating(r)">删除</el-button>
            </div>
          </div>
        </div>
        <dl class="facts">
          <div class="fact">
            <dt>导演</dt>
            <dd>
              <template v-if="directorNames.length">
                <template v-for="(n, i) in directorNames" :key="n">
                  <a class="person-link" @click="emit('open-person', n)">{{ n }}</a><span v-if="i < directorNames.length - 1" class="p-sep"> / </span>
                </template>
              </template>
              <template v-else>—</template>
            </dd>
          </div>
          <div class="fact">
            <dt>主演</dt>
            <dd>
              <template v-if="movie.actors.length">
                <template v-for="(a, i) in movie.actors" :key="a">
                  <a class="person-link" @click="emit('open-person', a)">{{ a }}</a><span v-if="i < movie.actors.length - 1" class="p-sep"> / </span>
                </template>
              </template>
              <template v-else>—</template>
            </dd>
          </div>
          <div class="fact"><dt>国家</dt><dd>{{ movie.countries?.length ? movie.countries.join(' / ') : '—' }}</dd></div>
          <div class="fact">
            <dt>画质</dt>
            <dd class="quality-dd">
              {{ movie.quality || '—' }}
              <el-tooltip content="用 ffprobe 读取视频真实分辨率" placement="top">
                <el-button
                  size="small"
                  circle
                  plain
                  title="重新识别画质"
                  :loading="reprobing"
                  @click="reprobeQuality"
                >
                  <el-icon v-if="!reprobing"><Refresh /></el-icon>
                </el-button>
              </el-tooltip>
            </dd>
          </div>
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

        <!-- 相似推荐 -->
        <div v-if="similarLoading || similar.length" class="similar">
          <div class="sim-head">喜欢这部的人还看了</div>
          <div class="sim-list">
            <div v-for="s in similar" :key="s.id" class="sim-item" @click="emit('open-movie', s.id)">
              <img v-if="s.cover_url" :src="s.cover_url" loading="lazy" alt="" />
              <div v-else class="sim-ph">{{ s.title }}</div>
              <div class="sim-title" :title="s.title">{{ s.title }}</div>
              <div v-if="s.similarity" class="sim-score">匹配 {{ Math.round(s.similarity * 10) / 10 }}</div>
            </div>
          </div>
        </div>

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
        <el-form-item label="英文名">
          <el-input v-model="form.original_title" maxlength="200" placeholder="原名 / 英文名（可留空，留空时自动从标题提取）" />
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
        <div class="form-row">
          <el-form-item label="国家">
            <el-select
              v-model="form.countries"
              multiple
              filterable
              allow-create
              default-first-option
              placeholder="选择或输入国家/地区"
              class="w100"
            >
              <el-option v-for="c in countryOptions" :key="c" :label="c" :value="c" />
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
      <div v-if="!editing" class="detail-actions">
        <el-button v-if="!movie.missing" type="primary" @click="openPlayChoice">立即播放</el-button>
        <el-dropdown trigger="click" @command="onSyncCommand">
          <el-button :loading="syncingData">
            数据同步<el-icon class="el-icon--right"><ArrowDown /></el-icon>
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="tmdb" :disabled="syncingData">同步 TMDB 信息</el-dropdown-item>
              <el-dropdown-item command="douban" :disabled="syncingData">同步豆瓣评分</el-dropdown-item>
              <el-dropdown-item command="douban-manual" divided :disabled="syncingData">手动匹配豆瓣…</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
        <el-button @click="openPlaylistDialog">加入片单</el-button>
        <el-button @click="editing = true">编辑信息</el-button>
        <el-tooltip content="导出 movie.nfo 到影片文件夹（Kodi/Emby/Jellyfin 兼容）" placement="top">
          <el-button :loading="exportingNfo" @click="exportNfo">NFO</el-button>
        </el-tooltip>
      </div>
      <div v-else>
        <el-button @click="resetForm(movie)">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </div>
    </template>
  </el-dialog>

  <ScrapePickerDialog
    v-model="pickerVisible"
    :candidates="candidates"
    :scraping="scraping"
    :searching="searching"
    :looking="looking"
    @pick="c => scrape(c.tmdb_id)"
    @search="onManualSearch"
    @lookup="onLookup"
  />

  <DoubanPickerDialog
    v-model="doubanPickerVisible"
    :candidates="doubanCandidates"
    :searching="doubanSearching"
    :binding="doubanBinding"
    @pick="onDoubanPick"
    @search="onDoubanSearch"
    @bind="onDoubanBind"
  />

  <el-dialog v-model="noteDialogVisible" title="写评价" width="480px" append-to-body>
    <el-input
      v-model="noteForm.note"
      type="textarea"
      :rows="5"
      maxlength="1000"
      show-word-limit
      placeholder="写下你对这部电影的评价…"
    />
    <template #footer>
      <el-button @click="noteDialogVisible = false">取消</el-button>
      <el-button type="primary" :loading="savingNote" @click="saveNote">保存</el-button>
    </template>
  </el-dialog>

  <CollectionDialog
    v-model="collectionVisible"
    :collection-id="movie?.collection_id"
    @open-movie="id => emit('open-movie', id)"
  />

  <el-dialog v-model="playlistVisible" title="加入片单" width="420px" append-to-body>
    <div v-loading="playlistsLoading">
      <div v-if="!playlistsLoading && !playlists.length" class="pl-empty-tip">还没有片单，输入名称创建一个</div>
      <div v-for="pl in playlists" :key="pl.id" class="pl-pick" @click="addTo(pl)">
        <span class="pl-pick-name">{{ pl.name }}</span>
        <span class="pl-pick-count">{{ pl.movie_count }} 部</span>
      </div>
      <div class="pl-new">
        <el-input v-model="newPlaylistName" placeholder="新建片单名称" maxlength="50" @keyup.enter="createAndAdd" />
        <el-button type="primary" :loading="addingPlaylist" @click="createAndAdd">新建并加入</el-button>
      </div>
    </div>
  </el-dialog>

  <VideoPlayer v-model="webPlayerVisible" :movie="movie" :sub-idx="webSubIdx" :target-h="webTargetH" :audio-idx="webAudioIdx" />

  <el-dialog v-model="playChoiceVisible" title="选择播放方式" width="480px" append-to-body>
    <div class="pc-probe" v-loading="playProbing">
      <template v-if="playProbe?.probe_ok">
        影片编码：<b>{{ playProbe.video_codec }}{{ playProbe.audio_codec ? ' / ' + playProbe.audio_codec : '' }}</b>
        <template v-if="playProbe.width"> · {{ playProbe.height }}p</template>
      </template>
      <template v-else-if="!playProbing">未安装 FFmpeg，无法探测编码</template>
      <template v-else>正在分析影片编码…</template>
    </div>
    <div class="pc-subs" v-if="playProbe?.probe_ok && playProbe.audios?.length > 1">
      <div class="pc-subs-head">在线播放音轨</div>
      <el-select v-model="audioChoice" class="pc-subs-select">
        <el-option v-for="a in playProbe.audios" :key="a.rel" :value="a.rel" :label="a.label" />
      </el-select>
      <div class="pc-subs-tip">多音轨影片可选择国语 / 原声等；转码后生效</div>
    </div>
    <div class="pc-subs" v-if="playProbe?.probe_ok && playProbe.subs?.length">
      <div class="pc-subs-head">在线播放字幕</div>
      <el-select v-model="subChoice" class="pc-subs-select">
        <el-option label="无字幕" :value="-1" />
        <el-option v-for="s in playProbe.subs" :key="s.idx" :value="s.idx" :label="subLabel(s)" />
      </el-select>
      <div class="pc-subs-tip">字幕将在服务器转码时烧进画面，播放中无法动态开关</div>
    </div>
    <div class="pc-subs" v-if="showQualityChoice">
      <div class="pc-subs-head">在线播放画质</div>
      <el-radio-group v-model="webTargetH" size="small">
        <el-radio-button :value="1080">1080p（流畅）</el-radio-button>
        <el-radio-button :value="2160">4K 原画质（吃带宽）</el-radio-button>
      </el-radio-group>
    </div>
    <div class="pc-cards">
      <div class="pc-card" @click="choosePlay('web')">
        <div class="pc-icon"><el-icon :size="30"><Monitor /></el-icon></div>
        <div class="pc-body">
          <div class="pc-title">在线播放</div>
          <div class="pc-desc">
            {{ playProbe?.mode === 'direct'
              ? (subChoice >= 0 ? '选了字幕：将转码并烧录字幕' : '原画质直连，浏览器直接播放')
              : playProbe?.mode === 'transcode'
                ? `服务器转码 ${webTargetH === 2160 ? '4K' : '1080p'}，手机平板可看`
                : '手机 / 平板 / 电视浏览器均可' }}
          </div>
        </div>
      </div>
      <div class="pc-card" @click="choosePlay('local')">
        <div class="pc-icon local"><el-icon :size="30"><CaretRight /></el-icon></div>
        <div class="pc-body">
          <div class="pc-title">本地播放</div>
          <div class="pc-desc">调用 PotPlayer，支持全部编码与音轨</div>
        </div>
      </div>
    </div>
  </el-dialog>
</template>

<style scoped>
/* 底部操作区：下拉按钮被 el-dropdown 包裹后不再命中 .el-button + .el-button 的默认间距，手动补齐统一间隔 */
.detail-actions {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}
.detail-actions .el-button + .el-button {
  margin-left: 0;
}
.detail-actions .el-dropdown {
  line-height: 1;
}

.movie-dialog :deep(.el-dialog) {
  border-radius: 10px;
  border: 1px solid #2e241b;
}

/* ---------- 相似推荐 ---------- */
.similar { margin-top: 4px; }

.sim-head {
  font-size: 13px;
  font-weight: 700;
  color: #cfc2ac;
  margin-bottom: 10px;
}

.sim-list {
  display: flex;
  gap: 10px;
  overflow-x: auto;
  padding-bottom: 6px;
}

.sim-item {
  flex-shrink: 0;
  width: 84px;
  cursor: pointer;
  text-align: center;
}

.sim-item img {
  width: 84px;
  height: 126px;
  object-fit: cover;
  border-radius: 6px;
  box-shadow: 0 3px 10px rgba(0, 0, 0, 0.45);
  transition: transform 0.2s, box-shadow 0.2s;
}

.sim-item:hover img {
  transform: translateY(-3px);
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(224, 164, 88, 0.5);
}

.sim-ph {
  width: 84px;
  height: 126px;
  border-radius: 6px;
  background: #221b14;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px;
  font-size: 12px;
  line-height: 1.4;
  color: rgba(236, 227, 210, 0.45);
  box-sizing: border-box;
}

.sim-title {
  margin-top: 6px;
  font-size: 12px;
  color: #ece3d2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sim-score {
  font-size: 11px;
  color: #9a8b74;
}

.quality-dd {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

/* ---------- 加入片单 ---------- */
.pl-empty-tip { font-size: 13px; color: #9a8b74; margin-bottom: 10px; }

.pl-pick {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border: 1px solid #2e241b;
  border-radius: 8px;
  margin-bottom: 8px;
  cursor: pointer;
  transition: border-color 0.2s, background 0.2s;
}
.pl-pick:hover { border-color: rgba(224, 164, 88, 0.55); background: #241d16; }

.pl-pick-name { font-size: 14px; color: #ece3d2; }
.pl-pick-count { font-size: 12px; color: #9a8b74; }

.pl-new { display: flex; gap: 8px; margin-top: 12px; }

.movie-dialog :deep(.el-dialog__body) {
  max-height: calc(100vh - 180px);
  overflow-y: auto;
}

.detail-body {
  display: flex;
  gap: 30px;
  min-height: 380px;
}

.detail-cover {
  flex: 0 0 30%;
  min-width: 220px;
  max-width: 360px;
}

.detail-cover img,
.no-cover {
  width: 100%;
  aspect-ratio: 2 / 3;
  object-fit: cover;
  border-radius: 12px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.5);
}

.no-cover {
  display: flex;
  align-items: center;
  justify-content: center;
  background: #221b14;
  color: #6a5c4a;
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

.title-block {
  min-width: 0;
}

.orig-title {
  font-size: 14px;
  color: #9a8b74;
  margin-top: 2px;
  word-break: break-word;
}

.douban-tag {
  display: inline-block;
  margin-top: 8px;
  font-size: 12px;
  font-weight: 600;
  color: #93c78f;
  background: rgba(147, 199, 143, 0.1);
  border: 1px solid rgba(147, 199, 143, 0.35);
  padding: 2px 10px;
  border-radius: 20px;
}

.head-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.head-row h2 {
  margin: 0;
  font-size: 26px;
  line-height: 1.4;
}

.year {
  font-size: 16px;
  color: #9a8b74;
  font-weight: 400;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 10px 0 4px;
}

.collection-tag {
  cursor: pointer;
}

.rating-row {
  display: flex;
  gap: 20px;
  align-items: center;
  margin: 4px 0;
}

.rating-row .score {
  font-family: 'Bebas Neue', 'Segoe UI', 'Microsoft YaHei', sans-serif;
  font-size: 21px;
  font-weight: 400;
  letter-spacing: 0.04em;
  line-height: 1;
}

.rating-history {
  margin: 6px 0;
  border: 1px solid #2e241b;
  border-radius: 8px;
  padding: 8px 12px;
  max-height: 180px;
  overflow-y: auto;
}

.rh-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 2px;
}

.rh-title {
  font-size: 12px;
  color: #9a8b74;
  font-weight: 600;
}

.rh-empty {
  font-size: 12px;
  color: #7d7160;
  text-align: center;
  padding: 8px 0;
}

.rh-item {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 0;
  border-top: 1px solid #221b14;
}

.rh-item:first-of-type {
  border-top: none;
}

.rh-body {
  min-width: 0;
  flex: 1;
}

.rh-main {
  display: flex;
  gap: 10px;
  align-items: baseline;
}

.rh-rating {
  color: #8fd8b4;
  font-family: 'Bebas Neue', 'Segoe UI', sans-serif;
  font-size: 16px;
  white-space: nowrap;
}

.rh-time {
  font-size: 12px;
  color: #7d7160;
}

.rh-note {
  font-size: 12px;
  color: #cfc2ac;
  line-height: 1.6;
  margin-top: 2px;
  word-break: break-word;
}

.rh-actions {
  flex-shrink: 0;
  display: flex;
  gap: 4px;
}

.score.tmdb {
  color: #e6c37a;
}

.score.douban {
  color: #93c78f;
}

.my-rate {
  display: flex;
  align-items: center;
  gap: 10px;
}

.my-rate-label {
  font-size: 13px;
  font-weight: 400;
  color: #9a8b74;
}

.my-rate-num {
  color: #8fd8b4;
  font-family: 'Bebas Neue', 'Segoe UI', sans-serif;
  font-size: 19px;
  line-height: 1;
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
  color: #9a8b74;
  flex: 0 0 3em;
}

.fact dd {
  margin: 0;
}

.person-link {
  color: #cfc2ac;
  cursor: pointer;
  transition: color 0.2s;
}

.person-link:hover {
  color: #e0a458;
}

.p-sep {
  color: #4e4438;
}

.synopsis {
  flex: 1;
  overflow-y: auto;
  max-height: 300px;
  margin: 8px 0;
  line-height: 1.8;
  font-size: 14px;
  color: #cfc2ac;
  white-space: pre-line;
}

.fileinfo {
  font-size: 12px;
  color: #7d7160;
  line-height: 1.7;
  word-break: break-all;
  border-top: 1px solid #2e241b;
  padding-top: 10px;
}

.filename {
  color: #9a8b74;
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

/* ---------- 播放方式选择 ---------- */
.pc-probe {
  font-size: 13px;
  color: #9a8b74;
  padding: 8px 2px 14px;
  border-bottom: 1px solid #241d16;
  margin-bottom: 14px;
}
.pc-probe b { color: #cfc2ac; }

/* 字幕选择 */
.pc-subs {
  margin: -2px 0 14px;
}
.pc-subs-head { font-size: 13px; color: #9a8b74; margin-bottom: 8px; }
.pc-subs-select { width: 100%; }
.pc-subs-tip { font-size: 12px; color: #6f6452; margin-top: 7px; }

.pc-cards { display: flex; flex-direction: column; gap: 12px; }

.pc-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px;
  background: #1a1511;
  border: 1px solid #2e241b;
  border-radius: 10px;
  cursor: pointer;
  transition: border-color 0.2s, transform 0.2s, background 0.2s;
}
.pc-card:hover {
  border-color: rgba(224, 164, 88, 0.55);
  background: #201a13;
  transform: translateY(-2px);
}

.pc-icon {
  flex-shrink: 0;
  width: 52px;
  height: 52px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(224, 164, 88, 0.14);
  color: #e0a458;
}
.pc-icon.local { background: rgba(154, 171, 110, 0.14); color: #9aab6e; }

.pc-body { flex: 1; min-width: 0; }
.pc-title { font-size: 15px; font-weight: 700; color: #ece3d2; }
.pc-desc { margin-top: 3px; font-size: 12.5px; color: #9a8b74; line-height: 1.5; }

@media (max-width: 700px) {
  .pc-cards { gap: 10px; }
  .pc-card { padding: 13px; }
}

/* ---------- 移动端 ---------- */
@media (max-width: 700px) {
  .detail-body {
    flex-direction: column;
    gap: 16px;
    min-height: auto;
  }
  .detail-cover {
    flex: none;
    min-width: 0;
    max-width: 200px;
    margin: 0 auto;
    width: 55%;
  }
  .movie-dialog :deep(.el-dialog__body) {
    max-height: calc(100vh - 130px);
  }
  .head-actions {
    flex-direction: column-reverse;
    gap: 6px;
  }
  .chips { justify-content: flex-start; }
  .similar { margin-top: 10px; }
  .sim-list { gap: 8px; }
  .sim-item { width: 74px; }
  .sim-item img, .sim-ph { width: 74px; height: 111px; }
  .facts { grid-template-columns: 1fr; }
  .fileinfo { font-size: 12px; word-break: break-all; }
}
</style>
