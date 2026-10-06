<template>
  <section class="page" data-module="defect">
    <header class="page-head">
      <div>
        <h2>缺陷记录管理</h2>
        <p class="page-desc">
          围绕缺陷编号、所属管线、缺陷类型、发现位置做登记、筛选与状态流转；
          <b>关联管线时同步展示当前准入规则下是否允许继续巡检</b>（规则调整后按最新口径显示，老管线的建档原结论不受影响）。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记缺陷记录</button>
        <button class="btn" type="button" @click="exportRows">导出缺陷记录清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">待确认缺陷</span>
        <strong class="stat-value">{{ pendingCount }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">已修复缺陷</span>
        <strong class="stat-value">{{ fixedCount }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">关联管线已停止巡检</span>
        <strong class="stat-value reject-text">{{ blockedCount }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">关联管线允许巡检</span>
        <strong class="stat-value ok-text">{{ allowedCount }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>管线当前准入（v{{ ruleVersion }}）</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>
            <template v-if="linkOf(row)">
              <div class="verdict-cell">
                <AdmissionBadge
                  :verdict="linkOf(row)!.decision.verdict"
                  :allow-inspection="linkOf(row)!.decision.allowInspection"
                />
                <span v-if="linkOf(row)!.drifted" class="verdict-meta drifted">
                  原建档结论（v{{ linkOf(row)!.archiveVersion }}）已被新口径调整
                </span>
                <span class="verdict-meta">管线状态：{{ linkOf(row)!.status }}</span>
              </div>
            </template>
            <span v-else class="readonly-tag">未匹配到管线 {{ row['所属管线'] }}</span>
          </td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              :class="{ 'danger-link': action === '忽略缺陷' }"
              type="button"
              :disabled="!canRunAction(action, row)"
              :title="actionTip(action, row)"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 3" class="empty-state">暂无缺陷记录数据，可先登记缺陷记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条缺陷记录；巡检准入取管线的当前判定，不取建档时的历史结论</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <!-- 登记缺陷记录 -->
    <div v-if="createOpen" class="modal-mask" @click.self="createOpen = false">
      <div class="modal">
        <h3>登记缺陷记录</h3>
        <div class="form-grid">
          <label class="form-item required">
            <span>所属管线编号</span>
            <input v-model="draft.pipelineCode" list="pipeline-options" placeholder="如 PIPE-0001" />
            <datalist id="pipeline-options">
              <option v-for="pipeline in pipelineOptions" :key="String(pipeline.id)" :value="String(pipeline['管线编号'])">
                {{ pipeline['管线类型'] }} · {{ pipeline['起点位置'] }}
              </option>
            </datalist>
          </label>
          <label class="form-item required">
            <span>缺陷类型</span>
            <input v-model="draft.defectType" placeholder="如 管道渗漏" />
          </label>
          <label class="form-item required">
            <span>发现位置</span>
            <input v-model="draft.location" />
          </label>
          <label class="form-item">
            <span>严重等级</span>
            <select v-model="draft.severity">
              <option>一般</option>
              <option>较重</option>
              <option>严重</option>
              <option>危急</option>
            </select>
          </label>
          <label class="form-item required">
            <span>发现日期</span>
            <input v-model="draft.commissionedDate" type="date" />
          </label>
          <label class="form-item span-2">
            <span>缺陷描述</span>
            <textarea v-model="draft.description" rows="2"></textarea>
          </label>
        </div>

        <div v-if="pipelinePreview" :class="['preview-box', verdictClass(pipelinePreview.decision.verdict)]">
          <strong>
            关联管线 {{ draft.pipelineCode }} 当前判定：{{ pipelinePreview.decision.verdict }} ·
            {{ pipelinePreview.decision.allowInspection ? '允许继续巡检' : '停止继续巡检' }}
          </strong>
          <span v-if="pipelinePreview.drifted" class="verdict-meta drifted">
            该管线建档时为「{{ pipelinePreview.archiveVerdict }}」（v{{ pipelinePreview.archiveVersion }}），规则调整后口径已变化
          </span>
          <ul v-if="pipelinePreview.decision.rejectReasons.length" class="reason-list">
            <li v-for="reason in pipelinePreview.decision.rejectReasons" :key="reason">{{ reason }}</li>
          </ul>
          <ul v-if="pipelinePreview.decision.reviewReasons.length" class="reason-list">
            <li v-for="reason in pipelinePreview.decision.reviewReasons" :key="reason">{{ reason }}</li>
          </ul>
        </div>
        <div v-else-if="draft.pipelineCode.trim()" class="preview-box preview-reject">
          <strong>未匹配到管线「{{ draft.pipelineCode }}」，请先在管线登记中建档</strong>
        </div>

        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="createOpen = false">取消</button>
          <button
            class="btn primary"
            type="button"
            :disabled="!canSubmit"
            :title="!canSubmit && submitBlockedReason ? submitBlockedReason : ''"
            @click="submitCreate"
          >
            提交登记
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import AdmissionBadge from '@/components/AdmissionBadge.vue'
import {
  createDefect,
  downloadEntries,
  listEntries,
  runAction as applyAction,
} from '@/api/local-service'
import {
  currentDecision,
  currentRule,
  findPipelineByCode,
  getArchiveSnapshot,
} from '@/api/pipeline-service'
import type { AdmissionDecision, EntryRow } from '@/data/types'

const columns = ["缺陷编号", "所属管线", "缺陷类型", "发现位置", "严重等级", "发现日期", "缺陷描述"]
const actions = ["确认缺陷", "标记修复", "忽略缺陷"]
const statuses = ["待确认", "已确认", "已修复", "已忽略"]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = ["缺陷编号", "所属管线", "缺陷类型"]
const ruleVersion = ref(currentRule().version)

type LinkedInfo = {
  decision: AdmissionDecision
  status: string
  drifted: boolean
  archiveVersion: number | null
  archiveVerdict: string
}

const linkCache = new Map<string, LinkedInfo | null>()
function linkOf(row: EntryRow): LinkedInfo | null {
  const code = String(row['所属管线'] ?? '')
  if (linkCache.has(code)) {
    return linkCache.get(code) ?? null
  }
  const pipeline = findPipelineByCode(code)
  if (!pipeline) {
    linkCache.set(code, null)
    return null
  }
  const decision = currentDecision(pipeline)
  const archive = getArchiveSnapshot(pipeline)
  const info: LinkedInfo = {
    decision,
    status: String(pipeline.status),
    drifted: Boolean(archive && archive.verdict !== decision.verdict),
    archiveVersion: archive?.ruleVersion ?? null,
    archiveVerdict: archive?.verdict ?? '—',
  }
  linkCache.set(code, info)
  return info
}

const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const pendingCount = computed(() => rows.value.filter((row) => String(row.status) === '待确认').length)
const fixedCount = computed(() => rows.value.filter((row) => String(row.status) === '已修复').length)
const blockedCount = computed(
  () => rows.value.filter((row) => linkOf(row)?.decision.allowInspection === false).length,
)
const allowedCount = computed(
  () => rows.value.filter((row) => linkOf(row)?.decision.allowInspection === true).length,
)

/** 管线已被当前规则判停时，不允许再对缺陷推进巡检类动作（确认缺陷意味着安排巡检核实）。 */
function canRunAction(action: string, row: EntryRow): boolean {
  if (action !== '确认缺陷') return true
  return linkOf(row)?.decision.allowInspection ?? true
}

function actionTip(action: string, row: EntryRow): string {
  if (!canRunAction(action, row)) {
    return '关联管线当前判定为停止巡检，需先在管线登记中完成复核或补正'
  }
  return ''
}

function verdictClass(verdict: string): string {
  if (verdict === '可建档') return 'preview-ok'
  if (verdict === '待复核') return 'preview-review'
  return 'preview-reject'
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries('defect')
}

// ---------- 登记 ----------
const createOpen = ref(false)
const draft = reactive({
  pipelineCode: '',
  defectType: '',
  location: '',
  severity: '一般',
  commissionedDate: new Date().toISOString().slice(0, 10),
  description: '',
})

const pipelineOptions = ref<EntryRow[]>([])

const pipelinePreview = computed(() => {
  const code = draft.pipelineCode.trim()
  if (!code) return null
  const pipeline = findPipelineByCode(code)
  if (!pipeline) return null
  const decision = currentDecision(pipeline)
  const archive = getArchiveSnapshot(pipeline)
  return {
    decision,
    drifted: Boolean(archive && archive.verdict !== decision.verdict),
    archiveVersion: archive?.ruleVersion ?? null,
    archiveVerdict: archive?.verdict ?? '—',
  }
})

const submitBlockedReason = computed(() => {
  if (!draft.pipelineCode.trim() || !draft.defectType.trim() || !draft.location.trim()) {
    return '请先填写所属管线、缺陷类型与发现位置'
  }
  if (!pipelinePreview.value) {
    return '所属管线不存在，无法登记缺陷'
  }
  if (!pipelinePreview.value.decision.allowInspection) {
    return '关联管线当前停止巡检，请先完成管线复核或补正'
  }
  return ''
})

const canSubmit = computed(() => submitBlockedReason.value === '')

function openCreate() {
  errorMessage.value = ''
  Object.assign(draft, {
    pipelineCode: '',
    defectType: '',
    location: '',
    severity: '一般',
    commissionedDate: new Date().toISOString().slice(0, 10),
    description: '',
  })
  pipelineOptions.value = listEntries('pipeline').items
  createOpen.value = true
}

function submitCreate() {
  const result = createDefect({
    pipelineCode: draft.pipelineCode,
    defectType: draft.defectType,
    location: draft.location,
    severity: draft.severity,
    foundDate: draft.commissionedDate,
    description: draft.description,
  })
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  createOpen.value = false
  errorMessage.value = result.message
  reload()
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction('defect', Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  linkCache.clear()
  ruleVersion.value = currentRule().version
  try {
    const payload = listEntries('defect', filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '缺陷记录列表读取失败'
  }
}

onMounted(reload)
</script>
