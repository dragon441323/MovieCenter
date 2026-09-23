<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowLeft, HomeFilled, Plus, Delete, Edit, Collection } from '@element-plus/icons-vue'
import { api } from '../api'
import Logo from '../components/Logo.vue'
import MovieCard from '../components/MovieCard.vue'
import MovieDetail from '../components/MovieDetail.vue'

const route = useRoute()
const router = useRouter()

const lists = ref([])
const loading = ref(false)
const current = ref(null)      // { playlist, movies }
const detailVisible = ref(false)
const detailMovie = ref(null)

// 新建/编辑对话框
const editVisible = ref(false)
const editForm = ref({ id: null, name: '', description: '' })
const saving = ref(false)

const viewId = computed(() => Number(route.query.id) || null)

async function loadLists() {
  loading.value = true
  try {
    const r = await api.playlists()
    lists.value = r.items
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    loading.value = false
  }
}

async function openList(id) {
  try {
    current.value = await api.playlist(id)
    router.replace({ query: { id } })
  } catch (e) {
    ElMessage.error(e.message)
  }
}

function backToLists() {
  current.value = null
  router.replace({ query: {} })
  loadLists()
}

function openCreate() {
  editForm.value = { id: null, name: '', description: '' }
  editVisible.value = true
}

function openEdit(l) {
  editForm.value = { id: l.id, name: l.name, description: l.description || '' }
  editVisible.value = true
}

async function saveList() {
  const { id, name, description } = editForm.value
  if (!name.trim()) {
    ElMessage.warning('请输入片单名称')
    return
  }
  saving.value = true
  try {
    if (id) {
      await api.updatePlaylist(id, { name: name.trim(), description: description.trim() })
      ElMessage.success('已保存')
    } else {
      const r = await api.createPlaylist(name.trim(), description.trim())
      ElMessage.success('片单已创建')
      await loadLists()
      openList(r.id)
    }
    editVisible.value = false
    if (current.value && id === current.value.playlist.id) {
      current.value = await api.playlist(id)
    }
    loadLists()
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    saving.value = false
  }
}

async function removeList(l) {
  try {
    await ElMessageBox.confirm(`删除片单「${l.name}」？（${l.movie_count} 部影片不受影响）`, '提示',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' })
  } catch { return }
  try {
    await api.deletePlaylist(l.id)
    if (current.value?.playlist.id === l.id) backToLists()
    else loadLists()
    ElMessage.success('已删除')
  } catch (e) {
    ElMessage.error(e.message)
  }
}

async function removeFromList(movie) {
  if (!current.value) return
  try {
    await api.removeFromPlaylist(current.value.playlist.id, movie.id)
    current.value = await api.playlist(current.value.playlist.id)
    loadLists()
  } catch (e) {
    ElMessage.error(e.message)
  }
}

function openDetail(movie) {
  detailMovie.value = movie
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

function onUpdated(movie) {
  detailMovie.value = movie
  if (current.value) {
    const i = current.value.movies.findIndex(m => m.id === movie.id)
    if (i >= 0) current.value.movies[i] = movie
  }
}

onMounted(async () => {
  await loadLists()
  if (viewId.value) openList(viewId.value)
})

watch(viewId, id => {
  if (!id && current.value) current.value = null
  else if (id && current.value?.playlist.id !== id) openList(id)
})
</script>

<template>
  <div class="pl-page">
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
      <span class="title">我的片单</span>
      <div class="spacer"></div>
    </header>

    <main class="pl-main">
      <!-- 片单列表 -->
      <template v-if="!current">
        <div class="pl-toolbar">
          <el-button type="primary" round @click="openCreate">
            <el-icon><Plus /></el-icon>&nbsp;新建片单
          </el-button>
          <span class="hint">{{ lists.length }} 个片单 · 在电影详情页可将影片加入片单</span>
        </div>

        <div v-if="!loading && !lists.length" class="empty">
          <el-icon :size="44"><Collection /></el-icon>
          <p>还没有片单</p>
          <p class="sub">建一个「周末片单」「诺兰专题」，把想集中看的影片收进一起</p>
        </div>

        <div v-loading="loading" class="pl-grid">
          <div v-for="l in lists" :key="l.id" class="pl-card" @click="openList(l.id)">
            <div class="pl-covers">
              <img v-for="(c, i) in l.covers.slice(0, 4)" :key="i" :src="c" class="cov c{{ i }}" loading="lazy" alt="" />
              <div v-if="!l.covers.length" class="cov-empty"><el-icon :size="26"><Collection /></el-icon></div>
            </div>
            <div class="pl-info">
              <div class="pl-name" :title="l.name">{{ l.name }}</div>
              <div class="pl-desc" :title="l.description">{{ l.description || '—' }}</div>
              <div class="pl-meta">{{ l.movie_count }} 部影片</div>
            </div>
            <div class="pl-ops" @click.stop>
              <el-tooltip content="编辑片单" placement="top">
                <button class="icon-btn edit" @click="openEdit(l)"><el-icon><Edit /></el-icon></button>
              </el-tooltip>
              <el-tooltip content="删除片单" placement="top">
                <button class="icon-btn del" @click="removeList(l)"><el-icon><Delete /></el-icon></button>
              </el-tooltip>
            </div>
          </div>
        </div>
      </template>

      <!-- 片单详情 -->
      <template v-else>
        <div class="pl-detail-head">
          <el-button link @click="backToLists"><el-icon><ArrowLeft /></el-icon> 全部片单</el-button>
          <h2 class="pl-detail-title">{{ current.playlist.name }}</h2>
          <span v-if="current.playlist.description" class="pl-detail-desc">{{ current.playlist.description }}</span>
          <span class="pl-detail-count">{{ current.movies.length }} 部</span>
          <div class="pl-detail-ops">
            <el-tooltip content="编辑片单" placement="top">
              <button class="icon-btn edit always" @click="openEdit(current.playlist)"><el-icon><Edit /></el-icon></button>
            </el-tooltip>
          </div>
        </div>

        <div v-if="!current.movies.length" class="empty">
          <el-icon :size="44"><Collection /></el-icon>
          <p>片单还是空的</p>
          <p class="sub">到电影库打开影片详情，点「加入片单」按钮即可</p>
        </div>

        <div class="detail-grid">
          <div v-for="(m, i) in current.movies" :key="m.id" class="detail-cell">
            <span class="ordinal font-display">{{ i + 1 }}</span>
            <MovieCard :movie="m" @open="openDetail" @play="p => api.playMovie(p.id).catch(e => ElMessage.error(e.message))" />
            <el-button class="cell-remove" link type="danger" size="small" @click="removeFromList(m)">
              <el-icon><Delete /></el-icon>&nbsp;移出
            </el-button>
          </div>
        </div>
      </template>
    </main>

    <MovieDetail v-model="detailVisible" :movie="detailMovie" @updated="onUpdated" @open-movie="onOpenMovie" />

    <el-dialog v-model="editVisible" :title="editForm.id ? '编辑片单' : '新建片单'" width="460px">
      <el-form label-width="60px">
        <el-form-item label="名称" required>
          <el-input v-model="editForm.name" maxlength="50" placeholder="例如：周末片单" />
        </el-form-item>
        <el-form-item label="简介">
          <el-input v-model="editForm.description" type="textarea" :rows="2" maxlength="200" placeholder="这个片单是关于什么的（可选）" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveList">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.pl-page { min-height: 100%; display: flex; flex-direction: column; }

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

.pl-main { flex: 1; max-width: 1440px; width: 100%; margin: 0 auto; padding: 24px 28px 50px; box-sizing: border-box; }

.pl-toolbar { display: flex; align-items: center; gap: 14px; margin-bottom: 20px; }
.hint { font-size: 13px; color: #9a8b74; }

.empty { text-align: center; padding: 90px 0; color: #6a5c4a; }
.empty p { margin: 12px 0 0; font-size: 15px; color: #9a8b74; }
.empty .sub { font-size: 13px; }

/* 卡片列表 */
.pl-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(290px, 1fr));
  gap: 16px;
}

.pl-card {
  display: flex;
  gap: 14px;
  padding: 14px;
  background: #1a1511;
  border: 1px solid #2e241b;
  border-radius: 10px;
  cursor: pointer;
  transition: border-color 0.2s, transform 0.2s;
}
.pl-card:hover { border-color: rgba(224, 164, 88, 0.5); transform: translateY(-2px); }

.pl-covers {
  position: relative;
  width: 72px;
  height: 104px;
  flex-shrink: 0;
  border-radius: 8px;
  overflow: hidden;
  background: #221b14;
}
.pl-covers img {
  position: absolute;
  width: 54px;
  height: 82px;
  object-fit: cover;
  border-radius: 4px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.5);
}
.pl-covers img:nth-child(1) { left: 2px; top: 2px; z-index: 4; }
.pl-covers img:nth-child(2) { left: 16px; top: 11px; z-index: 3; }
.pl-covers img:nth-child(3) { right: 16px; top: 11px; z-index: 2; }
.pl-covers img:nth-child(4) { right: 2px; bottom: 2px; z-index: 1; }

.cov-empty {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  color: #4e4438;
}

.pl-info { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.pl-name { font-size: 15px; font-weight: 700; color: #ece3d2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pl-desc { margin-top: 3px; font-size: 12px; color: #9a8b74; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pl-meta { margin-top: auto; font-size: 12px; color: #e0a458; }

/* 悬停浮现的圆角图标按钮（编辑/删除） */
.pl-ops {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 8px;
  opacity: 0;
  transform: translateX(6px);
  transition: opacity 0.2s, transform 0.2s;
}
.pl-card:hover .pl-ops { opacity: 1; transform: translateX(0); }

.icon-btn {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  border: 1px solid #3a2e22;
  background: #241d16;
  color: #cfc2ac;
  cursor: pointer;
  font-size: 14px;
  transition: all 0.18s;
}

.icon-btn.edit:hover {
  color: #e0a458;
  border-color: rgba(224, 164, 88, 0.65);
  background: rgba(224, 164, 88, 0.12);
  transform: scale(1.08);
}

.icon-btn.del:hover {
  color: #e07a6a;
  border-color: rgba(224, 122, 106, 0.65);
  background: rgba(224, 122, 106, 0.12);
  transform: scale(1.08);
}

/* 详情页头部常显的编辑按钮 */
.icon-btn.always { opacity: 1; transform: none; }

/* 详情 */
.pl-detail-head {
  display: flex; align-items: baseline; gap: 14px; flex-wrap: wrap;
  margin-bottom: 20px; padding-bottom: 12px;
  border-bottom: 1px solid #241d16;
}
.pl-detail-head :deep(.el-button) { align-self: center; }
.pl-detail-title { margin: 0; font-size: 24px; color: #ece3d2; }
.pl-detail-desc { font-size: 13px; color: #9a8b74; }
.pl-detail-count { font-size: 13px; color: #e0a458; }
.pl-detail-ops { margin-left: auto; }

.detail-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(168px, 1fr));
  gap: 18px 14px;
}

.detail-cell { position: relative; }

.ordinal {
  position: absolute;
  top: 6px; left: 6px;
  z-index: 5;
  min-width: 26px;
  height: 26px;
  padding: 0 6px;
  display: flex; align-items: center; justify-content: center;
  font-size: 14px;
  color: #100e0c;
  background: rgba(224, 164, 88, 0.92);
  border-radius: 7px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.5);
}

.cell-remove { margin-top: 4px; width: 100%; }

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
  .pl-main { padding: 14px 12px 40px; }
  .pl-grid { grid-template-columns: 1fr; }
  .detail-grid { grid-template-columns: repeat(3, 1fr); }
  .pl-detail-head { flex-wrap: wrap; gap: 8px; }
  .pl-detail-title { font-size: 20px; }
}
</style>
