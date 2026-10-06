<template>
  <section class="page" data-module="pipeline">
    <header class="page-head">
      <div>
        <h2>管线登记管理</h2>
        <p class="page-desc">
          录入管径、材质、敷设深度、投运日期后，系统按城市管网标准自动判定可建档 / 待复核 / 退回补充；
          待复核管线由审核人认领至本单位，外单位只读；多人同时复核时只允许一个结论生效。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记管线</button>
        <button class="btn" type="button" @click="openRules">建档规则设置</button>
        <button class="btn" type="button" @click="exportRows">导出管线清单</button>
      </div>
    </header>

    <div class="unit-bar">
      <span>当前审核单位（可切换演示外单位只读）：</span>
      <select :value="store.unit" @change="onUnitChange">
        <option v-for="unit in ORG_UNITS" :key="unit" :value="unit">{{ unit }}</option>
      </select>
      <span>审核人：{{ store.operator }}</span>
    </div>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <section class="rule-summary">
      <div>
        当前建档口径：<strong>城市管网标准 {{ currentRuleVersion.version }}</strong>
        <span class="muted">（{{ currentRuleVersion.effectiveAt }} 起生效）</span>
      </div>
      <div class="rule-line">
        <span>最小管径 DN{{ currentRuleVersion.minDiameter }}</span>
        <span>覆土 {{ currentRuleVersion.minDepth }}m～{{ currentRuleVersion.maxDepth }}m</span>
        <span>投运年限参考 ≤{{ currentRuleVersion.maxServiceYears }} 年</span>
        <span>淘汰材质：{{ currentRuleVersion.discouragedMaterials.join('、') }}</span>
      </div>
      <div class="rule-line"><span>{{ currentRuleVersion.note }}</span></div>
    </section>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label class="filter-item">
        <span>管线编号 / 位置</span>
        <input v-model="keyword" placeholder="按管线编号、起终点检索" />
      </label>
      <label class="filter-item">
        <span>建档状态</span>
        <select v-model="statusFilter">
          <option value="">全部</option>
          <option v-for="status in statuses" :key="status" :value="status">{{ status }}</option>
        </select>
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th>管线编号 / 类型</th>
          <th>起点 / 终点</th>
          <th>管径规格</th>
          <th>管材类型</th>
          <th>敷设深度</th>
          <th>投运日期</th>
          <th>系统准入判定</th>
          <th>当前巡检准入</th>
          <th>当前状态 / 承办</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td>
            <strong>{{ row.管线编号 }}</strong>
            <span class="cell-sub">{{ row.管线类型 }}</span>
          </td>
          <td>
            <div>{{ row.起点位置 }}</div>
            <span class="cell-sub">至 {{ row.终点位置 }}</span>
          </td>
          <td>{{ row.管径规格 }}</td>
          <td>{{ row.管材类型 }}</td>
          <td>{{ row.敷设深度 }}</td>
          <td>{{ row.投运日期 }}</td>
          <td>
            <span :class="verdictClass(String(row.准入结论))">
              {{ verdictLabel(String(row.准入结论)) }}
            </span>
            <span class="cell-sub">规则 {{ row.规则版本 ?? '—' }}</span>
            <span v-if="row.退回条件" class="cell-sub danger" :title="String(row.退回条件)">
              {{ String(row.退回条件).split('；')[0] }}…
            </span>
          </td>
          <td>
            <span :class="accessOf(row).level === 'allow' ? 'badge ok' : accessOf(row).level === 'caution' ? 'badge warn' : 'badge bad'">
              {{ accessOf(row).label }}
            </span>
            <span class="cell-sub" :title="accessOf(row).reason">按现行 {{ accessOf(row).currentRuleVersion }} 复判</span>
          </td>
          <td>
            <span :class="statusClass(String(row.status))">{{ row.status }}</span>
            <span class="cell-sub">{{ row.承办单位 ? `承办：${row.承办单位}` : '待认领' }}</span>
            <span v-if="row.复核结论" class="cell-sub">复核：{{ row.复核结论 }}</span>
          </td>
          <td class="row-actions">
            <template v-if="String(row.status) === '退回补充'">
              <button class="link" type="button" @click="openResubmit(row)">补充重提</button>
              <button class="link" type="button" @click="openDetail(row)">轨迹</button>
              <button class="link danger-link" type="button" @click="disable(row)">停用</button>
            </template>
            <template v-else-if="String(row.status) === '待复核'">
              <button v-if="!row.承办单位" class="link" type="button" @click="claim(row)">认领至本单位</button>
              <button v-if="!row.承办单位" class="link" type="button" @click="simulateClaimRace(row)">模拟他单位同时认领</button>
              <button v-else-if="String(row.承办单位) === store.unit" class="link" type="button" @click="openReview(row)">给出复核结论</button>
              <span v-else class="muted">外单位承办，仅查看</span>
              <button class="link" type="button" @click="openDetail(row)">轨迹</button>
              <button
                v-if="!row.承办单位 || String(row.承办单位) === store.unit"
                class="link danger-link"
                type="button"
                @click="disable(row)"
              >停用</button>
            </template>
            <template v-else>
              <button class="link" type="button" @click="openDetail(row)">查看</button>
              <button v-if="String(row.status) !== '已停用'" class="link danger-link" type="button" @click="disable(row)">停用</button>
            </template>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td colspan="10" class="empty-state">暂无符合条件的管线，可先登记管线</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条管线记录 · 新提交按现行口径判定，已有管线保留原结论</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <!-- 登记 / 补充重提弹窗 -->
    <div v-if="formModal.show" class="modal-mask" @click.self="closeForm">
      <div class="modal">
        <div class="modal-head">
          <h3>{{ formModal.mode === 'create' ? '登记管线' : `补充资料并重提（${formModal.draft.管线编号}）` }}</h3>
          <button class="btn ghost small" type="button" @click="closeForm">关闭</button>
        </div>
        <div class="modal-body">
          <div class="form-grid">
            <label class="form-field">
              <span>管线编号 *</span>
              <input v-model="formModal.draft.管线编号" placeholder="如 PIPE-0006" />
            </label>
            <label class="form-field">
              <span>管线类型 *</span>
              <input v-model="formModal.draft.管线类型" placeholder="如 污水管 / 雨水管" />
            </label>
            <label class="form-field">
              <span>起点位置 *</span>
              <input v-model="formModal.draft.起点位置" placeholder="起点井位 / 道路交口" />
            </label>
            <label class="form-field">
              <span>终点位置 *</span>
              <input v-model="formModal.draft.终点位置" placeholder="终点井位 / 接入点" />
            </label>
            <label class="form-field">
              <span>管径规格 *（DN300 / 300mm / 0.3m）</span>
              <input v-model="formModal.draft.管径规格" placeholder="如 DN500" />
            </label>
            <label class="form-field">
              <span>管材类型 *</span>
              <input v-model="formModal.draft.管材类型" placeholder="如 球墨铸铁管" list="material-list" />
              <datalist id="material-list">
                <option v-for="item in materialHints" :key="item" :value="item" />
              </datalist>
            </label>
            <label class="form-field">
              <span>敷设深度 *（1.2m / 1200mm）</span>
              <input v-model="formModal.draft.敷设深度" placeholder="如 1.8m" />
            </label>
            <label class="form-field">
              <span>投运日期 *</span>
              <input v-model="formModal.draft.投运日期" type="date" />
            </label>
          </div>

          <div class="preview-panel">
            <h4>
              实时判定预览（按 {{ currentRuleVersion.version }} 口径）：
              <span :class="verdictClass(livePreview.verdict)">{{ livePreview.verdict }}</span>
            </h4>
            <ul v-if="livePreview.issues.length">
              <li v-for="(issue, idx) in livePreview.issues" :key="idx">
                [{{ issue.level === 'hard' ? '退回条件' : '复核关注' }}] {{ issue.message }}
              </li>
            </ul>
            <p v-else-if="fourFieldsFilled" class="muted" style="margin: 4px 0; font-size: 12px;">四项指标全部满足，可直接建档。</p>
            <p v-else class="muted" style="margin: 4px 0; font-size: 12px;">请补全管径、材质、敷设深度、投运日期，系统将自动给出判定。</p>
          </div>
        </div>
        <div class="modal-foot">
          <button class="btn ghost" type="button" @click="closeForm">取消</button>
          <button class="btn primary" type="button" @click="submitForm">
            {{ formModal.mode === 'create' ? '提交登记' : '重新提交' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 复核弹窗 -->
    <div v-if="reviewModal.show && reviewModal.row" class="modal-mask" @click.self="closeReview">
      <div class="modal">
        <div class="modal-head">
          <h3>待复核管线复核：{{ reviewModal.row.管线编号 }}</h3>
          <button class="btn ghost small" type="button" @click="closeReview">关闭</button>
        </div>
        <div class="modal-body">
          <p class="muted" style="margin: 0 0 8px; font-size: 12px;">
            承办单位：{{ reviewModal.row.承办单位 }} ｜ 复核版本号 v{{ reviewModal.baseVersion }}
          </p>
          <table class="data-table">
            <tbody>
              <tr><th>管径规格</th><td>{{ reviewModal.row.管径规格 }}</td><th>管材类型</th><td>{{ reviewModal.row.管材类型 }}</td></tr>
              <tr><th>敷设深度</th><td>{{ reviewModal.row.敷设深度 }}</td><th>投运日期</th><td>{{ reviewModal.row.投运日期 }}</td></tr>
              <tr><th>系统判定依据</th><td colspan="3">{{ reviewModal.row.退回条件 || '—' }}</td></tr>
            </tbody>
          </table>

          <div v-if="reviewModal.raceHint" class="preview-panel" style="background:#fdeceb;">
            <strong class="reject-text">{{ reviewModal.raceHint }}</strong>
            <div class="muted" style="font-size: 12px; margin-top: 4px;">
              并发控制基于复核版本号（CAS）：您打开时是 v{{ reviewModal.baseVersion }}，记录已被推进到
              v{{ liveReviewVersion }}，继续提交会被拦截；关闭重开后再下结论即可成功。
            </div>
          </div>

          <label class="form-field" style="margin-top: 10px;">
            <span>复核说明（退回时将作为补充条件展示给录入人）</span>
            <textarea v-model="reviewModal.comment" placeholder="如：老化评估合格，同意建档；或请补充材质证明 / 覆土防护设计"></textarea>
          </label>

          <div class="preview-panel">
            <h4>办理轨迹</h4>
            <ul class="track-list">
              <li v-for="(track, idx) in tracksOf(reviewModal.row)" :key="idx">
                <span class="track-time">{{ track.time }}</span>
                <strong>{{ track.action }}</strong>
                <span v-if="track.ruleVersion" class="muted">（规则 {{ track.ruleVersion }}）</span>
                <div>{{ track.detail }}</div>
                <div class="muted">{{ track.operator }} · {{ track.unit }}</div>
              </li>
            </ul>
          </div>
        </div>
        <div class="modal-foot">
          <button class="btn ghost" type="button" @click="simulateRace">模拟他人同时复核</button>
          <button class="btn danger" type="button" @click="submitReview('退回补充')">退回补充</button>
          <button class="btn primary" type="button" @click="submitReview('通过建档')">通过建档</button>
        </div>
      </div>
    </div>

    <!-- 详情轨迹弹窗 -->
    <div v-if="detailModal.show && detailModal.row" class="modal-mask" @click.self="closeDetail">
      <div class="modal">
        <div class="modal-head">
          <h3>管线档案：{{ detailModal.row.管线编号 }}</h3>
          <button class="btn ghost small" type="button" @click="closeDetail">关闭</button>
        </div>
        <div class="modal-body">
          <table class="data-table">
            <tbody>
              <tr><th>管线类型</th><td>{{ detailModal.row.管线类型 }}</td><th>当前状态</th><td>{{ detailModal.row.status }}</td></tr>
              <tr><th>起点 / 终点</th><td colspan="3">{{ detailModal.row.起点位置 }} 至 {{ detailModal.row.终点位置 }}</td></tr>
              <tr><th>管径 / 材质</th><td>{{ detailModal.row.管径规格 }} ｜ {{ detailModal.row.管材类型 }}</td><th>深度 / 投运</th><td>{{ detailModal.row.敷设深度 }} ｜ {{ detailModal.row.投运日期 }}</td></tr>
              <tr><th>历史准入结论</th><td>{{ detailModal.row.准入结论 }} <span class="muted">（规则 {{ detailModal.row.规则版本 }}）</span></td><th>承办单位</th><td>{{ detailModal.row.承办单位 || '待认领' }}</td></tr>
            </tbody>
          </table>
          <div class="preview-panel">
            <h4>
              当前巡检准入：
              <span :class="accessOf(detailModal.row).level === 'allow' ? 'badge ok' : accessOf(detailModal.row).level === 'caution' ? 'badge warn' : 'badge bad'">
                {{ accessOf(detailModal.row).label }}
              </span>
            </h4>
            <p style="margin: 4px 0; font-size: 12px;">{{ accessOf(detailModal.row).reason }}</p>
          </div>
          <div class="preview-panel">
            <h4>办理轨迹（只增不改）</h4>
            <ul class="track-list">
              <li v-for="(track, idx) in tracksOf(detailModal.row)" :key="idx">
                <span class="track-time">{{ track.time }}</span>
                <strong>{{ track.action }}</strong>
                <span v-if="track.ruleVersion" class="muted">（规则 {{ track.ruleVersion }}）</span>
                <div>{{ track.detail }}</div>
                <div class="muted">{{ track.operator }} · {{ track.unit }}</div>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>

    <!-- 规则设置弹窗 -->
    <div v-if="rulesModal.show" class="modal-mask" @click.self="closeRules">
      <div class="modal wide">
        <div class="modal-head">
          <h3>城市管网建档准入标准设置</h3>
          <button class="btn ghost small" type="button" @click="closeRules">关闭</button>
        </div>
        <div class="modal-body">
          <p class="muted" style="margin: 0 0 10px; font-size: 12px;">
            保存调整会生成新版本并对之后新提交生效；已有管线保留原结论与原规则版本，但其“当前巡检准入”按新版本实时复判。
          </p>
          <div class="form-grid">
            <label class="form-field">
              <span>新版本生效日期</span>
              <input v-model="rulesModal.effectiveAt" type="date" />
            </label>
            <label class="form-field">
              <span>口径说明</span>
              <input v-model="rulesModal.patch.note" />
            </label>
            <label class="form-field">
              <span>最小管径（mm），低于即退回</span>
              <input v-model.number="rulesModal.patch.minDiameter" type="number" min="0" />
            </label>
            <label class="form-field">
              <span>小管径复核线（mm），低于即待复核</span>
              <input v-model.number="rulesModal.patch.smallDiameterWarn" type="number" min="0" />
            </label>
            <label class="form-field">
              <span>最小覆土（m），低于即退回</span>
              <input v-model.number="rulesModal.patch.minDepth" type="number" min="0" step="0.1" />
            </label>
            <label class="form-field">
              <span>浅覆土复核线（m），低于即待复核</span>
              <input v-model.number="rulesModal.patch.shallowDepthWarn" type="number" min="0" step="0.1" />
            </label>
            <label class="form-field">
              <span>最大覆土（m），超过即退回</span>
              <input v-model.number="rulesModal.patch.maxDepth" type="number" min="0" step="0.1" />
            </label>
            <label class="form-field">
              <span>深覆土复核线（m），超过即待复核</span>
              <input v-model.number="rulesModal.patch.deepDepthWarn" type="number" min="0" step="0.1" />
            </label>
            <label class="form-field">
              <span>投运年限参考（年），超过即待复核</span>
              <input v-model.number="rulesModal.patch.maxServiceYears" type="number" min="0" />
            </label>
            <label class="form-field full">
              <span>允许材质（顿号分隔）</span>
              <input v-model="rulesModal.allowedText" />
            </label>
            <label class="form-field full">
              <span>淘汰 / 限制材质（命中即退回，顿号分隔）</span>
              <input v-model="rulesModal.discouragedText" />
            </label>
          </div>
          <div class="preview-panel">
            <h4>历史版本（仅可查看，不再改动）</h4>
            <ul class="track-list">
              <li v-for="rule in rulesModal.versions" :key="rule.version">
                <span class="track-time">{{ rule.effectiveAt }}</span>
                <strong>{{ rule.version }}</strong>
                <span v-if="rule.version === currentRuleVersion.version" class="badge ok" style="margin-left: 6px;">现行</span>
                <div>{{ rule.note }}</div>
                <div class="muted">DN≥{{ rule.minDiameter }}；覆土 {{ rule.minDepth }}～{{ rule.maxDepth }}m；年限≤{{ rule.maxServiceYears }}年</div>
              </li>
            </ul>
          </div>
        </div>
        <div class="modal-foot">
          <span v-if="rulesModal.error" class="error-text">{{ rulesModal.error }}</span>
          <button class="btn ghost" type="button" @click="closeRules">取消</button>
          <button class="btn primary" type="button" @click="saveRules">保存并发布新版本</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'

import { downloadEntries } from '@/api/local-service'
import {
  currentRule,
  listRuleVersions,
  saveRule,
  type ArchiveRule,
  type RulePatch,
  rulesStorageKey,
} from '@/domain/archive-rules'
import type { AdmissionResult } from '@/domain/admission'
import {
  claimPipeline,
  disablePipeline,
  listPipelines,
  pipelineAccess,
  previewAdmission,
  registerPipeline,
  resubmitPipeline,
  reviewPipeline,
  simulateConcurrentClaim,
  simulateConcurrentReview,
  type OperatorIdentity,
  type PipelineDraft,
  type ReviewOutcome,
} from '@/domain/pipeline-service'
import { invalidateCache, storageKey } from '@/data/local-store'
import type { EntryRow, EntryTrack } from '@/data/types'
import { ORG_UNITS, useSessionStore } from '@/stores/session'

const store = useSessionStore()

const statuses = ['已建档', '待复核', '退回补充', '已停用']
const materialHints = computed(() => [
  ...currentRuleVersion.value.allowedMaterials,
  ...currentRuleVersion.value.discouragedMaterials,
])

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const keyword = ref('')
const statusFilter = ref('')

const currentRuleVersion = ref<ArchiveRule>(currentRule())

const stats = computed(() => {
  const all = listPipelines()
  const pending = all.filter((row) => String(row.status) === '待复核')
  return [
    { label: '管线总数', value: all.length },
    {
      label: '待复核管线',
      value: pending.length,
    },
    {
      label: '暂停巡检管线',
      value: all.filter((row) => !pipelineAccess(row).allowed).length,
    },
  ]
})

const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: listPipelines().filter((row) => String(row.status) === status).length,
  })),
)

const accessCache = new Map<number, ReturnType<typeof pipelineAccess>>()
function accessOf(row: EntryRow) {
  const cached = accessCache.get(Number(row.id))
  if (cached) {
    return cached
  }
  const access = pipelineAccess(row)
  accessCache.set(Number(row.id), access)
  return access
}

function tracksOf(row: EntryRow): EntryTrack[] {
  const value = row.tracks
  return Array.isArray(value) ? (value as EntryTrack[]) : []
}

function verdictClass(verdict: string): string {
  if (verdict === '可建档') {
    return 'badge ok'
  }
  if (verdict === '待复核') {
    return 'badge warn'
  }
  if (verdict === '退回补充') {
    return 'badge bad'
  }
  return 'badge neutral'
}

function verdictLabel(verdict: string): string {
  return verdict || '—'
}

function statusClass(status: string): string {
  if (status === '已建档') {
    return 'badge ok'
  }
  if (status === '待复核') {
    return 'badge warn'
  }
  if (status === '退回补充' || status === '已停用') {
    return 'badge bad'
  }
  return 'badge neutral'
}

function identity(): OperatorIdentity {
  return { name: store.operator, unit: store.unit }
}

function reload() {
  errorMessage.value = ''
  accessCache.clear()
  currentRuleVersion.value = currentRule()
  let matched = listPipelines()
  const text = keyword.value.trim()
  if (text) {
    matched = matched.filter((row) =>
      [row.管线编号, row.管线类型, row.起点位置, row.终点位置, row.承办单位]
        .map((value) => String(value ?? ''))
        .some((value) => value.includes(text)),
    )
  }
  if (statusFilter.value) {
    matched = matched.filter((row) => String(row.status) === statusFilter.value)
  }
  rows.value = matched
  total.value = matched.length
}

function resetFilters() {
  keyword.value = ''
  statusFilter.value = ''
  reload()
}

function onUnitChange(event: Event) {
  store.setUnit((event.target as HTMLSelectElement).value)
  reload()
}

function exportRows() {
  downloadEntries('pipeline')
}

// ---------- 登记 / 补充重提 ----------
type FormModal = {
  show: boolean
  mode: 'create' | 'resubmit'
  id: number | null
  draft: PipelineDraft
}

const emptyDraft = (): PipelineDraft => ({
  管线编号: '',
  管线类型: '',
  起点位置: '',
  终点位置: '',
  管径规格: '',
  管材类型: '',
  敷设深度: '',
  投运日期: '',
})

const formModal = reactive<FormModal>({
  show: false,
  mode: 'create',
  id: null,
  draft: emptyDraft(),
})

const fourFieldsFilled = computed(() =>
  ['管径规格', '管材类型', '敷设深度', '投运日期'].every(
    (field) => String(formModal.draft[field as keyof PipelineDraft] ?? '').trim() !== '',
  ),
)

const livePreview = computed<AdmissionResult>(() => previewAdmission(formModal.draft))

function openCreate() {
  formModal.show = true
  formModal.mode = 'create'
  formModal.id = null
  formModal.draft = emptyDraft()
}

function openResubmit(row: EntryRow) {
  formModal.show = true
  formModal.mode = 'resubmit'
  formModal.id = Number(row.id)
  formModal.draft = {
    管线编号: String(row.管线编号 ?? ''),
    管线类型: String(row.管线类型 ?? ''),
    起点位置: String(row.起点位置 ?? ''),
    终点位置: String(row.终点位置 ?? ''),
    管径规格: String(row.管径规格 ?? ''),
    管材类型: String(row.管材类型 ?? ''),
    敷设深度: String(row.敷设深度 ?? ''),
    投运日期: String(row.投运日期 ?? ''),
  }
}

function closeForm() {
  formModal.show = false
}

function submitForm() {
  const result =
    formModal.mode === 'create'
      ? registerPipeline(formModal.draft, identity())
      : resubmitPipeline(Number(formModal.id), formModal.draft, identity())
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  errorMessage.value = result.message
  formModal.show = false
  reload()
}

// ---------- 认领 ----------
function claim(row: EntryRow) {
  const result = claimPipeline(
    Number(row.id),
    identity(),
    Number(row.claimVersion ?? 0),
  )
  errorMessage.value = result.ok ? '' : result.message
  reload()
}

function simulateClaimRace(row: EntryRow) {
  const result = simulateConcurrentClaim(Number(row.id), identity())
  errorMessage.value = result.ok
    ? `已模拟并发：${result.message}，您可再点一次“认领至本单位”验证拦截`
    : result.message
  reload()
}

function disable(row: EntryRow) {
  const result = disablePipeline(Number(row.id), identity())
  errorMessage.value = result.ok ? '' : result.message
  reload()
}

// ---------- 复核（带并发控制） ----------
type ReviewModalState = {
  show: boolean
  row: EntryRow | null
  baseVersion: number
  comment: string
  raceHint: string
}

const reviewModal = reactive<ReviewModalState>({
  show: false,
  row: null,
  baseVersion: 0,
  comment: '',
  raceHint: '',
})

const liveReviewVersion = computed(() =>
  reviewModal.row ? Number(reviewModal.row.reviewVersion ?? 0) : 0,
)

function openReview(row: EntryRow) {
  reviewModal.show = true
  reviewModal.row = { ...row }
  reviewModal.baseVersion = Number(row.reviewVersion ?? 0)
  reviewModal.comment = ''
  reviewModal.raceHint = ''
}

function closeReview() {
  reviewModal.show = false
  reviewModal.row = null
}

function refreshReviewRow() {
  if (!reviewModal.row) {
    return
  }
  const latest = listPipelines().find(
    (row) => Number(row.id) === Number(reviewModal.row?.id),
  )
  if (latest) {
    reviewModal.row = { ...latest }
  }
}

function simulateRace() {
  if (!reviewModal.row) {
    return
  }
  const result = simulateConcurrentReview(Number(reviewModal.row.id), identity())
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  refreshReviewRow()
  reviewModal.raceHint = '另一名审核人已抢先完成提交（模拟），您的结论将不会生效'
  reload()
}

function submitReview(outcome: ReviewOutcome) {
  if (!reviewModal.row) {
    return
  }
  const result = reviewPipeline(
    Number(reviewModal.row.id),
    outcome,
    reviewModal.comment.trim(),
    identity(),
    reviewModal.baseVersion,
  )
  if (!result.ok) {
    errorMessage.value = result.message
    refreshReviewRow()
    reviewModal.raceHint = '版本已变化：已有其他结论先生效，您本次提交被拦截'
    reload()
    return
  }
  errorMessage.value = ''
  closeReview()
  reload()
}

// ---------- 详情 ----------
const detailModal = reactive<{ show: boolean; row: EntryRow | null }>({
  show: false,
  row: null,
})

function openDetail(row: EntryRow) {
  detailModal.show = true
  detailModal.row = { ...row }
}

function closeDetail() {
  detailModal.show = false
  detailModal.row = null
}

// ---------- 规则设置 ----------
type RulesModalState = {
  show: boolean
  effectiveAt: string
  allowedText: string
  discouragedText: string
  versions: ArchiveRule[]
  error: string
  patch: RulePatch
}

const todayText = () => new Date().toISOString().slice(0, 10)

const rulesModal = reactive<RulesModalState>({
  show: false,
  effectiveAt: todayText(),
  allowedText: '',
  discouragedText: '',
  versions: [],
  error: '',
  patch: {
    note: '',
    minDiameter: 200,
    smallDiameterWarn: 300,
    allowedMaterials: [],
    discouragedMaterials: [],
    minDepth: 0.7,
    shallowDepthWarn: 0.9,
    maxDepth: 8,
    deepDepthWarn: 6,
    maxServiceYears: 30,
  },
})

function openRules() {
  const rule = currentRule()
  rulesModal.show = true
  rulesModal.effectiveAt = todayText()
  rulesModal.allowedText = rule.allowedMaterials.join('、')
  rulesModal.discouragedText = rule.discouragedMaterials.join('、')
  rulesModal.versions = listRuleVersions().slice().reverse()
  rulesModal.error = ''
  rulesModal.patch = {
    note: rule.note,
    minDiameter: rule.minDiameter,
    smallDiameterWarn: rule.smallDiameterWarn,
    allowedMaterials: [...rule.allowedMaterials],
    discouragedMaterials: [...rule.discouragedMaterials],
    minDepth: rule.minDepth,
    shallowDepthWarn: rule.shallowDepthWarn,
    maxDepth: rule.maxDepth,
    deepDepthWarn: rule.deepDepthWarn,
    maxServiceYears: rule.maxServiceYears,
  }
}

function closeRules() {
  rulesModal.show = false
}

function splitMaterials(text: string): string[] {
  return text
    .split(/[、,，\s]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function saveRules() {
  const allowedMaterials = splitMaterials(rulesModal.allowedText)
  const discouragedMaterials = splitMaterials(rulesModal.discouragedText)
  if (!allowedMaterials.length) {
    rulesModal.error = '至少保留一种允许材质'
    return
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(rulesModal.effectiveAt)) {
    rulesModal.error = '请选择新版本生效日期'
    return
  }
  const patch: RulePatch = {
    ...rulesModal.patch,
    allowedMaterials,
    discouragedMaterials,
  }
  if (
    patch.minDiameter <= 0 ||
    patch.smallDiameterWarn < patch.minDiameter ||
    patch.minDepth <= 0 ||
    patch.maxDepth <= patch.minDepth ||
    patch.maxServiceYears <= 0
  ) {
    rulesModal.error = '阈值不合法：复核线不得严于退回线，深度区间、年限必须为正'
    return
  }
  saveRule(patch, rulesModal.effectiveAt)
  rulesModal.show = false
  reload()
}

// 其它标签页（另一名审核人）认领/复核或调规则后，本页丢弃缓存并重载。
function onStorage(event: StorageEvent) {
  if (event.key === storageKey() || event.key === rulesStorageKey()) {
    invalidateCache()
    refreshReviewRow()
    reload()
  }
}

onMounted(() => {
  reload()
  window.addEventListener('storage', onStorage)
})
onUnmounted(() => {
  window.removeEventListener('storage', onStorage)
})
</script>
<style scoped>
.danger-link {
  color: #b42318;
}
</style>
