import { evaluateAdmission, currentRule, type AdmissionInput } from '@/data/admission'
import { listRows, reloadRows, saveRows } from '@/data/local-store'
import type {
  ActionResult,
  AdmissionDecision,
  AdmissionSnapshot,
  EntryRow,
} from '@/data/types'

// 管线规则字段集中在这里，页面和导出都按这组 key 读写。
export const PIPELINE_FIELDS = {
  code: '管线编号',
  type: '管线类型',
  start: '起点位置',
  end: '终点位置',
  diameter: '管径规格',
  material: '管材类型',
  depth: '敷设深度',
  commissionedDate: '投运日期',
  claimUnit: '复核单位',
} as const

export const HISTORY_KEY = 'admissionHistory'
export const VERSION_KEY = 'rowVersion'

export type PipelineDraft = {
  code: string
  type: string
  start: string
  end: string
  diameter: string
  material: string
  depth: string
  commissionedDate: string
}

export function draftToInput(draft: Pick<PipelineDraft, 'diameter' | 'material' | 'depth' | 'commissionedDate'>): AdmissionInput {
  return {
    diameter: draft.diameter,
    material: draft.material,
    depth: draft.depth,
    commissionedDate: draft.commissionedDate,
  }
}

export function getHistory(row: EntryRow): AdmissionSnapshot[] {
  const value = row[HISTORY_KEY]
  return Array.isArray(value) ? (value as AdmissionSnapshot[]) : []
}

/** 建档时固化的原结论：规则再怎么调整，这条快照都不变。 */
export function getArchiveSnapshot(row: EntryRow): AdmissionSnapshot | null {
  const history = getHistory(row)
  return history.length > 0 ? history[history.length - 1] : null
}

/**
 * 当前准入口径：不管建档结论是哪个版本，一律用最新规则重新判定。
 * 缺陷记录关联管线时展示的「是否允许继续巡检」就读这里。
 */
export function currentDecision(row: EntryRow): AdmissionDecision {
  return evaluateAdmission({
    diameter: row[PIPELINE_FIELDS.diameter] as string,
    material: row[PIPELINE_FIELDS.material] as string,
    depth: row[PIPELINE_FIELDS.depth] as string,
    commissionedDate: row[PIPELINE_FIELDS.commissionedDate] as string,
  })
}

export function nextPipelineCode(rows: EntryRow[]): string {
  const max = rows.reduce((acc, row) => {
    const matched = /PIPE-(\d+)/.exec(String(row[PIPELINE_FIELDS.code] ?? ''))
    return matched ? Math.max(acc, Number(matched[1])) : acc
  }, 0)
  return `PIPE-${String(max + 1).padStart(4, '0')}`
}

function persist(rows: EntryRow[]): void {
  saveRows('pipeline', rows)
}

function statusOfVerdict(verdict: AdmissionDecision['verdict']): string {
  return verdict === '可建档' ? '已建档' : verdict
}

/**
 * 登记管线：录入四项关键信息后按当前规则口径判定。
 * 可建档直接建档；待复核进入复核池等单位认领；退回补充不建档，退回原因随记录留痕。
 */
export function registerPipeline(draft: PipelineDraft, reviewer: string): ActionResult & { id?: number } {
  const decision = evaluateAdmission(draftToInput(draft))
  const rows = reloadRows().pipeline ?? []
  const id = rows.reduce((max, row) => Math.max(max, Number(row.id)), 0) + 1
  const status = statusOfVerdict(decision.verdict)
  const row: EntryRow = {
    id,
    status,
    pending: status !== '已建档',
    abnormal: decision.verdict === '退回补充',
    [PIPELINE_FIELDS.code]: draft.code || nextPipelineCode(rows),
    [PIPELINE_FIELDS.type]: draft.type || '未分类',
    [PIPELINE_FIELDS.start]: draft.start,
    [PIPELINE_FIELDS.end]: draft.end,
    [PIPELINE_FIELDS.diameter]: draft.diameter,
    [PIPELINE_FIELDS.material]: draft.material,
    [PIPELINE_FIELDS.depth]: draft.depth,
    [PIPELINE_FIELDS.commissionedDate]: draft.commissionedDate,
    [PIPELINE_FIELDS.claimUnit]: '',
    [HISTORY_KEY]: [{ ...decision, stage: '建档准入判定' }],
    [VERSION_KEY]: 1,
    登记人: reviewer,
  }
  persist([...rows, row])
  if (decision.verdict === '退回补充') {
    return {
      ok: true,
      id,
      message: `登记已受理但判定为「退回补充」：${decision.rejectReasons.join('；')}`,
    }
  }
  if (decision.verdict === '待复核') {
    return {
      ok: true,
      id,
      message: `判定为「待复核」：${decision.reviewReasons.join('；')}。已进入复核池，等待审核单位认领。`,
    }
  }
  return { ok: true, id, message: '判定为「可建档」，管线已直接建档。' }
}

/** 退回补充后补正资料重新提交：按当前（可能已调整的）规则口径重新判定，历史结论保留。 */
export function resubmitPipeline(id: number, draft: PipelineDraft): ActionResult {
  const rows = reloadRows().pipeline ?? []
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的管线` }
  }
  if (String(rows[index].status) !== '退回补充') {
    return { ok: false, message: '只有「退回补充」的管线可以补正后重新提交' }
  }
  const decision = evaluateAdmission(draftToInput(draft))
  const status = statusOfVerdict(decision.verdict)
  const updated: EntryRow = {
    ...rows[index],
    ...{
      [PIPELINE_FIELDS.diameter]: draft.diameter,
      [PIPELINE_FIELDS.material]: draft.material,
      [PIPELINE_FIELDS.depth]: draft.depth,
      [PIPELINE_FIELDS.commissionedDate]: draft.commissionedDate,
    },
    status,
    pending: status !== '已建档',
    abnormal: decision.verdict === '退回补充',
    [PIPELINE_FIELDS.claimUnit]: decision.verdict === '待复核' ? '' : rows[index][PIPELINE_FIELDS.claimUnit],
    [HISTORY_KEY]: [...getHistory(rows[index]), { ...decision, stage: '补正后重新判定' }],
    [VERSION_KEY]: Number(rows[index][VERSION_KEY] ?? 1) + 1,
  }
  const next = [...rows]
  next[index] = updated
  persist(next)
  if (decision.verdict === '退回补充') {
    return { ok: true, message: `重新判定仍为「退回补充」：${decision.rejectReasons.join('；')}` }
  }
  if (decision.verdict === '待复核') {
    return { ok: true, message: `重新判定为「待复核」：${decision.reviewReasons.join('；')}` }
  }
  return { ok: true, message: '补正资料符合当前口径，重新判定为「可建档」，已建档。' }
}

/**
 * 待复核管线认领：审核人把管线分配给自己单位。
 * 认领同样走乐观锁，两个单位同时点认领只有一个能成功。
 */
export function claimPipeline(id: number, unit: string, reviewer: string): ActionResult {
  const rows = reloadRows().pipeline ?? []
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的管线` }
  }
  const row = rows[index]
  if (String(row.status) !== '待复核') {
    return { ok: false, message: '只有待复核管线可以认领' }
  }
  const owner = String(row[PIPELINE_FIELDS.claimUnit] ?? '')
  if (owner) {
    return owner === unit
      ? { ok: false, message: `该管线已由本单位（${unit}）认领` }
      : { ok: false, message: `该管线已被 ${owner} 认领，其他单位只能查看` }
  }
  const updated: EntryRow = {
    ...row,
    [PIPELINE_FIELDS.claimUnit]: unit,
    [VERSION_KEY]: Number(row[VERSION_KEY] ?? 1) + 1,
    认领人: reviewer,
    认领时间: new Date().toLocaleString('zh-CN', { hour12: false }),
  }
  const next = [...rows]
  next[index] = updated
  persist(next)
  return { ok: true, message: `已将该管线分配给本单位（${unit}），可由本单位审核人下结论` }
}

export type ReviewOutcome = '建档通过' | '复核退回'

/**
 * 提交复核结论。两个关键约束：
 * 1. 只有认领单位能提交，其他单位只读；
 * 2. rowVersion 乐观锁——同一管线被多人同时复核时，先提交的结论生效，后提交的被拒绝。
 */
export function submitReview(
  id: number,
  unit: string,
  reviewer: string,
  outcome: ReviewOutcome,
  comment: string,
  expectedVersion: number,
): ActionResult {
  const rows = reloadRows().pipeline ?? []
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的管线` }
  }
  const row = rows[index]
  const owner = String(row[PIPELINE_FIELDS.claimUnit] ?? '')
  if (!owner) {
    return { ok: false, message: '该管线尚未被任何单位认领，请先分配给本单位' }
  }
  if (owner !== unit) {
    return { ok: false, message: `该管线由 ${owner} 负责复核，本单位（${unit}）只能查看` }
  }
  const currentVersion = Number(row[VERSION_KEY] ?? 1)
  // 版本校验先于状态校验：他人抢先下结论后，明确告知并发冲突，而不是只提示状态已变。
  if (currentVersion !== expectedVersion) {
    return {
      ok: false,
      message: `并发冲突：你打开后该管线已被其他审核人复核（版本 ${expectedVersion} → ${currentVersion}），以最先提交的结论为准，请刷新后查看`,
    }
  }
  if (String(row.status) !== '待复核') {
    return { ok: false, message: '该管线已不在待复核状态，结论已生效，无需重复复核' }
  }

  const decision = evaluateAdmission({
    diameter: row[PIPELINE_FIELDS.diameter] as string,
    material: row[PIPELINE_FIELDS.material] as string,
    depth: row[PIPELINE_FIELDS.depth] as string,
    commissionedDate: row[PIPELINE_FIELDS.commissionedDate] as string,
  })
  const approved = outcome === '建档通过'
  const status = approved ? '已建档' : '退回补充'
  const snapshot: AdmissionSnapshot = {
    ...decision,
    verdict: approved ? '可建档' : '退回补充',
    allowInspection: approved,
    rejectReasons: approved ? [] : decision.rejectReasons.length ? decision.rejectReasons : ['复核不通过：' + (comment || '资料不满足建档要求')],
    reviewReasons: decision.reviewReasons,
    stage: `复核结论·${outcome}（${unit} ${reviewer}：${comment || '无'}）`,
  }
  const updated: EntryRow = {
    ...row,
    status,
    pending: status !== '已建档',
    abnormal: !approved,
    [HISTORY_KEY]: [...getHistory(row), snapshot],
    [VERSION_KEY]: currentVersion + 1,
    复核人: reviewer,
    复核时间: new Date().toLocaleString('zh-CN', { hour12: false }),
    复核意见: comment,
  }
  const next = [...rows]
  next[index] = updated
  persist(next)
  return { ok: true, message: approved ? '复核结论「建档通过」已生效，管线建档完成。' : '复核结论「退回补充」已生效，已通知登记人补正。' }
}

/**
 * 并发演示桩：模拟同一单位的另一名审核人在你填写结论期间抢先提交。
 * 直接改库并推进版本号，随后自己的提交会因版本不匹配被拒绝——只允许一个结论生效。
 */
export function simulateConcurrentReview(id: number, unit: string): ActionResult {
  const rows = reloadRows().pipeline ?? []
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的管线` }
  }
  const row = rows[index]
  if (String(row.status) !== '待复核' || String(row[PIPELINE_FIELDS.claimUnit] ?? '') !== unit) {
    return { ok: false, message: '仅已被本单位认领的待复核管线可演示并发复核' }
  }
  const decision = evaluateAdmission({
    diameter: row[PIPELINE_FIELDS.diameter] as string,
    material: row[PIPELINE_FIELDS.material] as string,
    depth: row[PIPELINE_FIELDS.depth] as string,
    commissionedDate: row[PIPELINE_FIELDS.commissionedDate] as string,
  })
  const currentVersion = Number(row[VERSION_KEY] ?? 1)
  const snapshot: AdmissionSnapshot = {
    ...decision,
    stage: `复核结论·建档通过（${unit} 李工：演示用抢先结论）`,
  }
  const updated: EntryRow = {
    ...row,
    status: '已建档',
    pending: false,
    abnormal: false,
    [HISTORY_KEY]: [...getHistory(row), snapshot],
    [VERSION_KEY]: currentVersion + 1,
    复核人: '李工',
    复核时间: new Date().toLocaleString('zh-CN', { hour12: false }),
    复核意见: '演示用：另一名审核人抢先通过',
  }
  const next = [...rows]
  next[index] = updated
  persist(next)
  return { ok: true, message: `已模拟 ${unit} 李工抢先提交「建档通过」，现在提交你的结论会被并发拦截。` }
}

/** 缺陷记录侧：按管线编号取当前准入口径（不跨模块直接读，统一从这里取）。 */
export function findPipelineByCode(code: string): EntryRow | undefined {
  return (reloadRows().pipeline ?? []).find(
    (row) => String(row[PIPELINE_FIELDS.code] ?? '') === String(code ?? '').trim(),
  )
}

export { currentRule }
