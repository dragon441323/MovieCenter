<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowLeft, HomeFilled, Notebook, Delete, Edit, Calendar } from '@element-plus/icons-vue'
import { api } from '../api'
import Logo from '../components/Logo.vue'
import MovieDetail from '../components/MovieDetail.vue'

const router = useRouter()

const loading = ref(false)
const entries = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = 30
const year = ref('')
const years = ref([])

const detailVisible = ref(false)
const detailMovie = ref(null)

const noteDialogVisible = ref(false)
const savingNote = ref(false)
const noteForm = ref({ id: null, note: '' })

const hasMore = computed(() => page.value * pageSize < total.value)

async function load() {
  loading.value = true
  try {
    const r = await api.diary({ page: page.value, page_size: pageSize, year: year.value || undefined })
    entries.value = r.items
    total.value = r.total
    years.value = r.years || []
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    loading.value = false
  }
}

async function loadMore() {
  page.value++
  loading.value = true
  try {
    const r = await api.diary({ page: page.value, page_size: pageSize, year: year.value || undefined })
    entries.value.push(...r.items)
    total.value = r.total
  } catch (e) {
    ElMessage.error(e.message)
    page.value--
  } finally {
    loading.value = false
  }
}

function onYearChange() {
  page.value = 1
  load()
}

function fmtTime(s) {
  if (!s) return ''
  try {
    const d = new Date(s.includes('T') ? s : s.replace(' ', 'T') + (s.endsWith('Z') ? '' : 'Z'))
    return d.toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  } catch {
    return s
  }
}

function sourceLabel(s) {
  if (s === 'seed') return '历史导入'
  if (s === 'play') return '播放记录'
  return '手动记录'
}

function openDetail(entry) {
  detailMovie.value = { ...entry, id: entry.movie_id, title: entry.title }
  detailVisible.value = true
}

async function onOpenMovie(id) {
  try {
    detailMovie.value = await api.movie(id)
    detailVisible.value = true
  } catch (e) {
    ElMessage.error(e.message)
  }
}

function openNoteDialog(entry) {
  noteForm.value = { id: entry.id, note: entry.note || '' }
  noteDialogVisible.value = true
}

async function saveNote() {
  savingNote.value = true
  try {
    const note = noteForm.value.note.trim()
    await api.updateDiaryNote(noteForm.value.id, note)
    const i = entries.value.findIndex(x => x.id === noteForm.value.id)
    if (i >= 0) entries.value[i].note = note
    noteDialogVisible.value = false
    ElMessage.success('日记已保存')
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    savingNote.value = false
  }
}

async function removeEntry(entry) {
  try {
    await ElMessageBox.confirm('删除这条观影记录？', '提示', { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' })
  } catch { return }
  try {
    await api.removeDiary(entry.id)
    entries.value = entries.value.filter(x => x.id !== entry.id)
    total.value--
  } catch (e) {
    ElMessage.error(e.message)
  }
}

onMounted(load)
</script>

<template>
  <div class="diary-page">
    <header class="topbar">
      <div class="brand" @click="router.push('/')">
        <Logo class="logo" />
        <span>电影中心</span>
      </div>
      <el-tooltip content="返回上一页" placement="bottom">
        <el-button circle @click="router.back()"><el-icon><ArrowLeft /></el-icon></el-button>
      </el-tooltip>
      <el-tooltip content="首页" placement="bottom">
        <el-button circle @click="router.push('/')"><el-icon><HomeFilled /></el-icon></el-button>
      </el-tooltip>
      <span class="title">观影日记</span>
      <div class="spacer"></div>
      <el-select v-model="year" placeholder="全部年份" clearable style="width: 120px" @change="onYearChange">
        <el-option v-for="y in years" :key="y" :label="y + ' 年'" :value="y" />
      </el-select>
    </header>

    <main class="diary-main">
      <div v-if="!loading && !entries.length" class="empty">
        <el-icon :size="44"><Notebook /></el-icon>
        <p>还没有观影记录</p>
        <p class="sub">播放电影或点「记一次观看」后，这里会自动生成日记</p>
      </div>

      <div v-loading="loading" class="timeline">
        <div v-for="e in entries" :key="e.id" class="entry" @click="openDetail(e)">
          <img v-if="e.cover_url" :src="e.cover_url" class="cover" loading="lazy" alt="" />
          <div v-else class="cover ph"><el-icon :size="22"><Calendar /></el-icon></div>
          <div class="body">
            <div class="row1">
              <span class="t">{{ e.title }}</span>
              <span v-if="e.year" class="y font-display">{{ e.year }}</span>
              <span v-if="e.rating != null" class="my-r font-display">★ {{ Number(e.rating).toFixed(1) }}</span>
              <span v-if="e.quality" class="q">{{ e.quality }}</span>
            </div>
            <div class="row2">
              <span class="time">{{ fmtTime(e.watched_at) }}</span>
              <span class="src">{{ sourceLabel(e.source) }}</span>
              <template v-if="e.categories?.length">
                <span v-for="c in e.categories.slice(0, 3)" :key="c" class="cat">{{ c }}</span>
              </template>
            </div>
            <p v-if="e.note" class="note">{{ e.note }}</p>
          </div>
          <div class="ops" @click.stop>
            <el-button link size="small" @click="openNoteDialog(e)">
              <el-icon><Edit /></el-icon>&nbsp;{{ e.note ? '编辑' : '写日记' }}
            </el-button>
            <el-button link type="danger" size="small" @click="removeEntry(e)">
              <el-icon><Delete /></el-icon>&nbsp;删除
            </el-button>
          </div>
        </div>
      </div>

      <div v-if="hasMore" class="more">
        <el-button :loading="loading" round @click="loadMore">加载更多</el-button>
      </div>
    </main>

    <MovieDetail v-model="detailVisible" :movie="detailMovie" @updated="m => (detailMovie = m)" @open-movie="onOpenMovie" />

    <el-dialog v-model="noteDialogVisible" title="写日记" width="480px" append-to-body>
      <el-input
        v-model="noteForm.note"
        type="textarea"
        :rows="5"
        maxlength="1000"
        show-word-limit
        placeholder="写下这次观影的感受…"
      />
      <template #footer>
        <el-button @click="noteDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="savingNote" @click="saveNote">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.diary-page { min-height: 100%; display: flex; flex-direction: column; }

.topbar {
  position: sticky; top: 0; z-index: 20;
  display: flex; align-items: center; gap: 12px;
  padding: 14px 28px;
  background: rgba(16, 14, 12, 0.86);
  backdrop-filter: blur(10px);
  border-bottom: 1px solid #241d16;
}
.brand { display: flex; align-items: center; gap: 9px; font-size: 18px; font-weight: 700; letter-spacing: 2px; cursor: pointer; color: #ece3d2; }
.logo { width: 26px; height: 26px; color: #e0a458; }
.title { font-size: 17px; font-weight: 700; color: #e6c37a; }
.spacer { flex: 1; }

.diary-main { flex: 1; max-width: 980px; width: 100%; margin: 0 auto; padding: 26px 24px 50px; box-sizing: border-box; }

.empty { text-align: center; padding: 90px 0; color: #6a5c4a; }
.empty p { margin: 12px 0 0; font-size: 15px; color: #9a8b74; }
.empty .sub { font-size: 13px; }

.timeline { display: flex; flex-direction: column; gap: 12px; }

.entry {
  display: flex; gap: 14px; align-items: flex-start;
  background: #1a1511; border: 1px solid #2e241b; border-radius: 10px;
  padding: 12px 14px; cursor: pointer;
  transition: border-color 0.2s, transform 0.2s;
}
.entry:hover { border-color: rgba(224, 164, 88, 0.5); transform: translateY(-2px); }

.cover { width: 58px; height: 87px; border-radius: 6px; object-fit: cover; flex-shrink: 0; box-shadow: 0 3px 10px rgba(0,0,0,0.45); }
.cover.ph { display: flex; align-items: center; justify-content: center; background: #221b14; color: #4e4438; }

.body { flex: 1; min-width: 0; }
.row1 { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.t { font-size: 16px; font-weight: 700; color: #ece3d2; }
.y { font-size: 14px; color: #e0a458; }
.my-r { font-size: 13px; color: #8fd8b4; }
.q { font-size: 12px; color: #9a8b74; border: 1px solid rgba(154,139,116,0.4); border-radius: 4px; padding: 0 5px; }

.row2 { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 4px; font-size: 12px; color: #9a8b74; }
.src { color: #6a5c4a; }
.cat { background: #241d16; border-radius: 4px; padding: 0 6px; }

.note { margin: 8px 0 0; font-size: 13px; line-height: 1.7; color: #cfc2ac; white-space: pre-wrap; word-break: break-word; }

.ops { display: flex; flex-direction: column; gap: 2px; align-items: flex-end; flex-shrink: 0; }

.more { text-align: center; margin-top: 20px; }

/* ---------- 移动端顶栏 ---------- */
@media (max-width: 700px) {
  .topbar {
    flex-wrap: wrap;
    padding: 10px 12px;
    gap: 8px;
  }
  .topbar .search,
  .topbar .sort,
  .topbar .pick-btn {
    width: auto;
    flex: 1 1 auto;
  }
  .topbar .search { min-width: 140px; order: 10; flex-basis: 100%; }
  .gsearch { width: 100% !important; order: 10; flex-basis: 100%; }
  .spacer, .topbar-spacer { flex: 1 1 auto; }
}

/* ---------- 移动端 ---------- */
@media (max-width: 700px) {
  .diary-main { padding: 16px 12px 40px; }
  .entry { padding: 10px; gap: 10px; }
  .cover { width: 46px; height: 69px; }
  .t { font-size: 14px; }
  .ops { flex-direction: row; align-items: center; }
}
</style>
