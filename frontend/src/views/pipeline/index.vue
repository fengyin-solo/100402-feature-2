<template>
  <section class="page" data-module="pipeline">
    <header class="page-head">
      <div>
        <h2>管线登记管理</h2>
        <p class="page-desc">
          录入管径、材质、敷设深度、投运日期，系统按城市管网标准判定
          <b>可建档 / 待复核 / 退回补充</b>；待复核管线由认领单位审核，建档结论保留判定时版本，当前巡检准入按最新口径实时判定。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记管线</button>
        <button class="btn" type="button" @click="openRules">准入规则（{{ current.version }} 版）</button>
        <button class="btn" type="button" @click="exportRows">导出管线登记清单</button>
      </div>
    </header>

    <!-- 审核身份切换：纯前端没有登录态，用它模拟不同审核单位/审核人 -->
    <div class="identity-bar">
      <span class="identity-label">当前审核身份：</span>
      <label class="identity-item">
        单位
        <select :value="store.unit" @change="onUnitChange">
          <option v-for="unit in reviewUnits" :key="unit" :value="unit">{{ unit }}</option>
        </select>
      </label>
      <label class="identity-item">
        审核人
        <input :value="store.operator" @change="onOperatorChange" placeholder="审核人姓名" />
      </label>
      <span class="identity-tip">待复核管线只能由认领单位下结论，切换到其他单位可验证只读限制</span>
    </div>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">管线总数</span>
        <strong class="stat-value">{{ stats.total }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">待复核（复核池）</span>
        <strong class="stat-value review-text">{{ stats.review }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">退回补充</span>
        <strong class="stat-value reject-text">{{ stats.rejected }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">当前口径允许巡检</span>
        <strong class="stat-value ok-text">{{ stats.allowInspection }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
      <span class="legend-item legend-rule">判定口径：准入规则 v{{ current.version }}（{{ current.note }}）</span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table pipeline-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>建档原结论</th>
          <th>当前准入口径（v{{ current.version }}）</th>
          <th>当前状态</th>
          <th>复核归属 / 操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] || '—' }}</td>
          <td>
            <div class="verdict-cell">
              <AdmissionBadge
                :verdict="archiveOf(row)?.verdict ?? row.status"
                :allow-inspection="Boolean(archiveOf(row)?.allowInspection)"
              />
              <span class="verdict-meta">判定于 v{{ archiveOf(row)?.ruleVersion ?? '?' }}</span>
            </div>
          </td>
          <td>
            <div class="verdict-cell">
              <AdmissionBadge
                :verdict="decisionOf(row).verdict"
                :allow-inspection="decisionOf(row).allowInspection"
              />
              <span v-if="verdictDrifted(row)" class="verdict-meta drifted">
                规则已调整，与原结论不同，缺陷/巡检按本列执行
              </span>
            </div>
          </td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <template v-if="String(row.status) === '待复核'">
              <span class="claim-info">{{ claimOf(row) || '复核池·未认领' }}</span>
              <button v-if="!claimOf(row)" class="link" type="button" @click="claim(row)">认领给本单位</button>
              <button
                v-else-if="claimOf(row) === store.unit"
                class="link primary-link"
                type="button"
                @click="openReview(row)"
              >
                复核下结论
              </button>
              <span v-else class="readonly-tag">其他单位办理中，只读</span>
            </template>
            <template v-else-if="String(row.status) === '退回补充'">
              <button class="link" type="button" @click="openResubmit(row)">补充资料重报</button>
              <ul class="reason-list">
                <li v-for="reason in lastRejectReasons(row)" :key="reason">{{ reason }}</li>
              </ul>
            </template>
            <template v-else-if="String(row.status) === '已建档'">
              <button class="link danger-link" type="button" @click="deactivate(row)">停用管线</button>
              <button class="link" type="button" @click="openHistory(row)">结论记录</button>
            </template>
            <template v-else>
              <span class="readonly-tag">已停用</span>
            </template>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 4" class="empty-state">暂无管线登记数据，可先登记管线</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条管线登记记录；结论随判定时规则版本留痕，规则调整只影响新提交与当前准入口径</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <!-- 登记管线 -->
    <div v-if="createOpen" class="modal-mask" @click.self="createOpen = false">
      <div class="modal">
        <h3>登记管线</h3>
        <div class="form-grid">
          <label class="form-item">
            <span>管线编号（留空自动生成）</span>
            <input v-model="draft.code" placeholder="如 PIPE-0006" />
          </label>
          <label class="form-item">
            <span>管线类型</span>
            <input v-model="draft.type" placeholder="如 给水管道" />
          </label>
          <label class="form-item">
            <span>起点位置</span>
            <input v-model="draft.start" />
          </label>
          <label class="form-item">
            <span>终点位置</span>
            <input v-model="draft.end" />
          </label>
          <label class="form-item required">
            <span>管径规格（毫米，如 300 或 DN300）</span>
            <input v-model="draft.diameter" placeholder="300" />
          </label>
          <label class="form-item required">
            <span>管材类型（材质）</span>
            <input v-model="draft.material" list="material-options" placeholder="如 球墨铸铁管" />
            <datalist id="material-options">
              <option v-for="item in current.allowedMaterials" :key="item" :value="item" />
              <option v-for="item in current.bannedMaterials" :key="item" :value="item" />
            </datalist>
          </label>
          <label class="form-item required">
            <span>敷设深度（管顶覆土，米）</span>
            <input v-model="draft.depth" placeholder="如 1.2" />
          </label>
          <label class="form-item required">
            <span>投运日期</span>
            <input v-model="draft.commissionedDate" type="date" />
          </label>
        </div>

        <div :class="['preview-box', previewClass]">
          <template v-if="preview">
            <strong>按准入规则 v{{ preview.ruleVersion }} 预判：{{ preview.verdict }}</strong>
            <ul v-if="preview.rejectReasons.length" class="reason-list">
              <li v-for="reason in preview.rejectReasons" :key="reason">退回条件：{{ reason }}</li>
            </ul>
            <ul v-if="preview.reviewReasons.length" class="reason-list">
              <li v-for="reason in preview.reviewReasons" :key="reason">复核条件：{{ reason }}</li>
            </ul>
            <span class="inspect-hint">
              该口径下{{ preview.allowInspection ? '允许' : '暂停' }}继续巡检（缺陷记录关联时同步展示）
            </span>
          </template>
          <span v-else class="muted-text">填写管径、材质、敷设深度、投运日期后自动预判（前四项不参与判定）。</span>
        </div>

        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="createOpen = false">取消</button>
          <button class="btn primary" type="button" @click="submitCreate">提交登记</button>
        </div>
      </div>
    </div>

    <!-- 补正重报 -->
    <div v-if="resubmitTarget" class="modal-mask" @click.self="resubmitTarget = null">
      <div class="modal">
        <h3>补充资料后重新提交 · {{ resubmitTarget[F.code] }}</h3>
        <p class="muted-text">重新判定按当前规则 v{{ current.version }} 执行，原退回结论保留在结论记录里。</p>
        <div class="form-grid">
          <label class="form-item required">
            <span>管径规格（毫米）</span>
            <input v-model="resubmitDraft.diameter" />
          </label>
          <label class="form-item required">
            <span>管材类型</span>
            <input v-model="resubmitDraft.material" list="material-options" />
          </label>
          <label class="form-item required">
            <span>敷设深度（米）</span>
            <input v-model="resubmitDraft.depth" />
          </label>
          <label class="form-item required">
            <span>投运日期</span>
            <input v-model="resubmitDraft.commissionedDate" type="date" />
          </label>
        </div>
        <div v-if="resubmitPreview" :class="['preview-box', verdictClass(resubmitPreview.verdict)]">
          <strong>重新预判：{{ resubmitPreview.verdict }}</strong>
          <ul v-if="resubmitPreview.rejectReasons.length" class="reason-list">
            <li v-for="reason in resubmitPreview.rejectReasons" :key="reason">{{ reason }}</li>
          </ul>
          <ul v-if="resubmitPreview.reviewReasons.length" class="reason-list">
            <li v-for="reason in resubmitPreview.reviewReasons" :key="reason">{{ reason }}</li>
          </ul>
        </div>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="resubmitTarget = null">取消</button>
          <button class="btn primary" type="button" @click="submitResubmit">重新提交</button>
        </div>
      </div>
    </div>

    <!-- 复核下结论 -->
    <div v-if="reviewTarget" class="modal-mask" @click.self="reviewTarget = null">
      <div class="modal">
        <h3>管线复核 · {{ reviewTarget[F.code] }}（{{ store.unit }}）</h3>
        <div class="review-facts">
          <p v-for="reason in decisionOf(reviewTarget).reviewReasons" :key="reason" class="review-reason">
            待核条件：{{ reason }}
          </p>
          <p class="muted-text">
            建档判定依据 v{{ archiveOf(reviewTarget)?.ruleVersion }}，当前审核口径为 v{{ current.version }}；
            复核结论生效后建档，原判定记录保留。
          </p>
        </div>
        <label class="form-item">
          <span>复核结论</span>
          <select v-model="reviewOutcome">
            <option value="建档通过">建档通过（允许建档并恢复巡检）</option>
            <option value="复核退回">退回补充（列明补正条件，暂停巡检）</option>
          </select>
        </label>
        <label class="form-item">
          <span>复核意见 / 退回需补充的具体条件</span>
          <textarea v-model="reviewComment" rows="3" placeholder="如：补充 0.7m 以下覆土段的钢套管防护验收记录"></textarea>
        </label>
        <div class="concurrent-box">
          <p class="muted-text">并发控制：同单位另一名审核人若先提交，你的结论会被版本校验拦截（只一个结论生效）。</p>
          <button class="btn ghost" type="button" @click="simulateRace">
            模拟「李工」此刻抢先提交
          </button>
        </div>
        <p v-if="raceHint" class="error-text">{{ raceHint }}</p>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="reviewTarget = null">取消</button>
          <button class="btn primary" type="button" @click="submitReview">提交复核结论</button>
        </div>
      </div>
    </div>

    <!-- 准入规则版本管理 -->
    <div v-if="rulesOpen" class="modal-mask wide" @click.self="rulesOpen = false">
      <div class="modal">
        <h3>城市管网建档准入规则</h3>
        <p class="muted-text">
          规则调整立即对新提交生效；已有管线保留原建档结论，但其「当前准入口径」按新版本实时重判，缺陷记录同步可见。
        </p>
        <table class="data-table compact">
          <thead>
            <tr>
              <th>版本</th><th>管径范围(mm)</th><th>最小覆土(m)</th><th>深埋复核(m)</th>
              <th>复核年限</th><th>退回年限</th><th>生效时间</th><th>说明</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="rule in rules" :key="rule.version" :class="{ 'version-current': rule.version === current.version }">
              <td>v{{ rule.version }}</td>
              <td>{{ rule.minDiameter }}~{{ rule.maxDiameter }}</td>
              <td>{{ rule.minDepth }}</td>
              <td>{{ rule.deepReviewDepth }}</td>
              <td>{{ rule.serviceLifeReviewYears }} 年</td>
              <td>{{ rule.serviceLifeRejectYears }} 年</td>
              <td>{{ formatDate(rule.createdAt) }}</td>
              <td>{{ rule.note }}</td>
            </tr>
          </tbody>
        </table>

        <h4 class="rule-form-title">调整规则（保存为新版本，不覆盖旧版本）</h4>
        <div class="form-grid">
          <label class="form-item">
            <span>最小管径 DN</span>
            <input v-model.number="ruleDraft.minDiameter" type="number" />
          </label>
          <label class="form-item">
            <span>最大管径 DN</span>
            <input v-model.number="ruleDraft.maxDiameter" type="number" />
          </label>
          <label class="form-item">
            <span>最小管顶覆土（m）</span>
            <input v-model.number="ruleDraft.minDepth" type="number" step="0.1" />
          </label>
          <label class="form-item">
            <span>深埋复核阈值（m）</span>
            <input v-model.number="ruleDraft.deepReviewDepth" type="number" step="0.1" />
          </label>
          <label class="form-item">
            <span>服役复核年限（年）</span>
            <input v-model.number="ruleDraft.serviceLifeReviewYears" type="number" />
          </label>
          <label class="form-item">
            <span>服役退回年限（年）</span>
            <input v-model.number="ruleDraft.serviceLifeRejectYears" type="number" />
          </label>
          <label class="form-item span-2">
            <span>大口径复核阈值 DN</span>
            <input v-model.number="ruleDraft.largeDiameterReview" type="number" />
          </label>
          <label class="form-item span-2">
            <span>调整说明</span>
            <input v-model="ruleDraft.note" placeholder="如：收紧老旧管线服役年限口径" />
          </label>
        </div>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="applySuggestedDraft">填入演示用 v2 收紧口径</button>
          <button class="btn ghost" type="button" @click="rulesOpen = false">关闭</button>
          <button class="btn primary" type="button" @click="saveRule">保存新版本并生效</button>
        </div>
      </div>
    </div>

    <!-- 结论记录 -->
    <div v-if="historyTarget" class="modal-mask" @click.self="historyTarget = null">
      <div class="modal">
        <h3>建档/复核结论记录 · {{ historyTarget[F.code] }}</h3>
        <ol class="history-list">
          <li v-for="(item, index) in historyOf(historyTarget)" :key="index" class="history-item">
            <AdmissionBadge :verdict="item.verdict" :allow-inspection="item.allowInspection" :show-inspection="false" />
            <span class="history-stage">{{ item.stage }}</span>
            <span class="history-meta">依据规则 v{{ item.ruleVersion }} · {{ formatDate(item.judgedAt) }}</span>
            <ul v-if="item.rejectReasons.length" class="reason-list">
              <li v-for="reason in item.rejectReasons" :key="reason">{{ reason }}</li>
            </ul>
            <ul v-if="item.reviewReasons.length" class="reason-list review">
              <li v-for="reason in item.reviewReasons" :key="reason">{{ reason }}</li>
            </ul>
          </li>
        </ol>
        <div class="modal-actions">
          <button class="btn primary" type="button" @click="historyTarget = null">知道了</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import AdmissionBadge from '@/components/AdmissionBadge.vue'
import {
  downloadEntries,
  listEntries,
  runAction as applyAction,
} from '@/api/local-service'
import {
  claimPipeline,
  currentDecision,
  getArchiveSnapshot,
  getHistory,
  nextPipelineCode,
  registerPipeline,
  resubmitPipeline,
  simulateConcurrentReview,
  submitReview as submitReviewResult,
  PIPELINE_FIELDS as F,
  type PipelineDraft,
  type ReviewOutcome,
} from '@/api/pipeline-service'
import {
  addRule,
  currentRule,
  evaluateAdmission,
  listRules,
} from '@/data/admission'
import type {
  AdmissionDecision,
  AdmissionRule,
  AdmissionSnapshot,
  EntryRow,
} from '@/data/types'
import { useSessionStore, REVIEW_UNITS } from '@/stores/session'

const store = useSessionStore()
const reviewUnits = REVIEW_UNITS

const columns = [
  F.code,
  F.type,
  F.start,
  F.end,
  F.diameter,
  F.material,
  F.depth,
  F.commissionedDate,
]
const statuses = ['待建档', '已建档', '待复核', '退回补充', '已停用']

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = [F.code, F.type, F.start]

const current = ref<AdmissionRule>(currentRule())

const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const stats = computed(() => {
  const decisions = rows.value.map((row) => currentDecision(row))
  return {
    total: rows.value.length,
    review: rows.value.filter((row) => String(row.status) === '待复核').length,
    rejected: rows.value.filter((row) => String(row.status) === '退回补充').length,
    allowInspection: decisions.filter((item) => item.allowInspection).length,
  }
})

const decisionCache = new Map<number, AdmissionDecision>()
function decisionOf(row: EntryRow): AdmissionDecision {
  const cached = decisionCache.get(Number(row.id))
  if (cached) {
    return cached
  }
  const decision = currentDecision(row)
  decisionCache.set(Number(row.id), decision)
  return decision
}

function archiveOf(row: EntryRow): AdmissionSnapshot | null {
  return getArchiveSnapshot(row)
}

function historyOf(row: EntryRow): AdmissionSnapshot[] {
  return getHistory(row)
}

function claimOf(row: EntryRow): string {
  return String(row[F.claimUnit] ?? '')
}

function verdictDrifted(row: EntryRow): boolean {
  const archive = archiveOf(row)
  return Boolean(archive && archive.verdict !== decisionOf(row).verdict)
}

function lastRejectReasons(row: EntryRow): string[] {
  const history = getHistory(row)
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (history[index].verdict === '退回补充') {
      return history[index].rejectReasons
    }
  }
  return []
}

function verdictClass(verdict: string): string {
  if (verdict === '可建档') return 'preview-ok'
  if (verdict === '待复核') return 'preview-review'
  return 'preview-reject'
}

function formatDate(value: string): string {
  if (!value) return '—'
  return new Date(value).toLocaleString('zh-CN', { hour12: false })
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries('pipeline')
}

function reload() {
  errorMessage.value = ''
  decisionCache.clear()
  current.value = currentRule()
  try {
    const payload = listEntries('pipeline', filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '管线登记列表读取失败'
  }
}

function onUnitChange(event: Event) {
  store.setReviewer((event.target as HTMLSelectElement).value, store.operator)
}

function onOperatorChange(event: Event) {
  const value = (event.target as HTMLInputElement).value.trim() || '值班审核人'
  store.setReviewer(store.unit, value)
}

// ---------- 登记 ----------
const createOpen = ref(false)
const emptyDraft = (): PipelineDraft => ({
  code: '',
  type: '',
  start: '',
  end: '',
  diameter: '',
  material: '',
  depth: '',
  commissionedDate: '',
})
const draft = reactive<PipelineDraft>(emptyDraft())

const preview = computed<AdmissionDecision | null>(() => {
  if (!draft.diameter && !draft.material && !draft.depth && !draft.commissionedDate) {
    return null
  }
  return evaluateAdmission({
    diameter: draft.diameter,
    material: draft.material,
    depth: draft.depth,
    commissionedDate: draft.commissionedDate,
  })
})
const previewClass = computed(() => (preview.value ? verdictClass(preview.value.verdict) : ''))

function openCreate() {
  Object.assign(draft, emptyDraft())
  const list = listEntries('pipeline').items
  draft.code = nextPipelineCode(list)
  createOpen.value = true
}

function submitCreate() {
  const result = registerPipeline({ ...draft }, store.operator)
  errorMessage.value = result.message
  if (result.ok) {
    createOpen.value = false
  }
  reload()
}

// ---------- 补正重报 ----------
const resubmitTarget = ref<EntryRow | null>(null)
const resubmitDraft = reactive<PipelineDraft>(emptyDraft())

function openResubmit(row: EntryRow) {
  resubmitTarget.value = row
  Object.assign(resubmitDraft, {
    ...emptyDraft(),
    diameter: String(row[F.diameter] ?? ''),
    material: String(row[F.material] ?? ''),
    depth: String(row[F.depth] ?? ''),
    commissionedDate: String(row[F.commissionedDate] ?? ''),
  })
}

const resubmitPreview = computed(() => {
  if (!resubmitDraft.diameter && !resubmitDraft.material) return null
  return evaluateAdmission({
    diameter: resubmitDraft.diameter,
    material: resubmitDraft.material,
    depth: resubmitDraft.depth,
    commissionedDate: resubmitDraft.commissionedDate,
  })
})

function submitResubmit() {
  if (!resubmitTarget.value) return
  const result = resubmitPipeline(Number(resubmitTarget.value.id), { ...resubmitDraft })
  errorMessage.value = result.message
  resubmitTarget.value = null
  reload()
}

// ---------- 认领与复核 ----------
function claim(row: EntryRow) {
  const result = claimPipeline(Number(row.id), store.unit, store.operator)
  errorMessage.value = result.message
  reload()
}

const reviewTarget = ref<EntryRow | null>(null)
const reviewOutcome = ref<ReviewOutcome>('建档通过')
const reviewComment = ref('')
const reviewVersion = ref(1)
const raceHint = ref('')

function openReview(row: EntryRow) {
  reviewTarget.value = row
  reviewOutcome.value = '建档通过'
  reviewComment.value = ''
  raceHint.value = ''
  reviewVersion.value = Number(row.rowVersion ?? 1)
}

function simulateRace() {
  if (!reviewTarget.value) return
  const result = simulateConcurrentReview(Number(reviewTarget.value.id), store.unit)
  raceHint.value = result.ok ? result.message : result.message
  if (result.ok) {
    reviewVersion.value += 1
  }
}

function submitReview() {
  if (!reviewTarget.value) return
  const result = submitReviewResult(
    Number(reviewTarget.value.id),
    store.unit,
    store.operator,
    reviewOutcome.value,
    reviewComment.value.trim(),
    reviewVersion.value,
  )
  errorMessage.value = result.message
  if (result.ok) {
    reviewTarget.value = null
  }
  reload()
}

function deactivate(row: EntryRow) {
  const result = applyAction('pipeline', Number(row.id), '停用管线')
  errorMessage.value = result.message
  reload()
}

// ---------- 结论记录 ----------
const historyTarget = ref<EntryRow | null>(null)
function openHistory(row: EntryRow) {
  historyTarget.value = row
}

// ---------- 规则 ----------
const rulesOpen = ref(false)
const rules = ref<AdmissionRule[]>([])
const ruleDraft = reactive({
  minDiameter: 100,
  maxDiameter: 2000,
  minDepth: 0.7,
  deepReviewDepth: 6,
  serviceLifeReviewYears: 25,
  serviceLifeRejectYears: 40,
  largeDiameterReview: 1600,
  allowedMaterials: [] as string[],
  bannedMaterials: [] as string[],
  note: '',
})

function openRules() {
  rules.value = listRules()
  const latest = rules.value[rules.value.length - 1]
  Object.assign(ruleDraft, {
    minDiameter: latest.minDiameter,
    maxDiameter: latest.maxDiameter,
    minDepth: latest.minDepth,
    deepReviewDepth: latest.deepReviewDepth,
    serviceLifeReviewYears: latest.serviceLifeReviewYears,
    serviceLifeRejectYears: latest.serviceLifeRejectYears,
    largeDiameterReview: latest.largeDiameterReview,
    allowedMaterials: [...latest.allowedMaterials],
    bannedMaterials: [...latest.bannedMaterials],
    note: '',
  })
  rulesOpen.value = true
}

/** 一键填入一版收紧口径：老管线（如 1998 年投运的 PIPE-0002）原结论保留、当前口径变待复核。 */
function applySuggestedDraft() {
  Object.assign(ruleDraft, {
    minDiameter: 100,
    maxDiameter: 2000,
    minDepth: 0.9,
    deepReviewDepth: 6,
    serviceLifeReviewYears: 20,
    serviceLifeRejectYears: 35,
    largeDiameterReview: 1400,
    note: 'v2 收紧：最小覆土提高到 0.9m，服役 20 年即复核，DN1400 以上需结构复核。',
  })
}

function saveRule() {
  if (ruleDraft.serviceLifeReviewYears >= ruleDraft.serviceLifeRejectYears) {
    errorMessage.value = '规则口径有误：复核年限必须小于退回年限'
    return
  }
  const saved = addRule({
    ...ruleDraft,
    allowedMaterials: [...ruleDraft.allowedMaterials],
    bannedMaterials: [...ruleDraft.bannedMaterials],
    createdBy: `${store.unit} ${store.operator}`,
  })
  rules.value = listRules()
  rulesOpen.value = false
  errorMessage.value = `准入规则 v${saved.version} 已生效：新提交按新口径判定，已有管线保留原结论、当前准入口径已重算。`
  reload()
}

onMounted(reload)
</script>
