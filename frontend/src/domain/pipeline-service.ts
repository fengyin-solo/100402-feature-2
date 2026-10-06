import { currentRule } from '@/domain/archive-rules'
import {
  evaluateAdmission,
  verdictToStatus,
  type AdmissionResult,
  type PipelineAdmissionInput,
} from '@/domain/admission'
import { listRows, saveRows } from '@/data/local-store'
import type { EntryRow, EntryTrack } from '@/data/types'

/**
 * 管线建档领域服务：
 * - 登记/重新提交按当前规则口径自动判定；
 * - 待复核管线可由审核人认领至本单位，外单位只读；
 * - 认领与出结论用版本号做并发控制（CAS），多人同时复核只允许一个结论生效；
 * - 规则调整不动历史结论，但按当前口径实时计算“是否允许继续巡检”，供缺陷记录关联展示。
 */

export type OperatorIdentity = {
  name: string
  unit: string
}

export type PipelineDraft = {
  管线编号: string
  管线类型: string
  起点位置: string
  终点位置: string
  管径规格: string
  管材类型: string
  敷设深度: string
  投运日期: string
}

export type ServiceResult = {
  ok: boolean
  message: string
  row?: EntryRow
}

export type PipelineAccess = {
  allowed: boolean
  /** allow=可继续巡检；caution=允许但需关注；deny=暂停巡检 */
  level: 'allow' | 'caution' | 'deny'
  label: string
  reason: string
  /** 该管线登记/复核时的历史结论及其规则版本（保留原口径） */
  archivedVerdict: string
  archivedRuleVersion: string
  /** 按当前规则口径实时复判的结论 */
  currentVerdict: string
  currentRuleVersion: string
}

function nowText(): string {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(
    now.getHours(),
  )}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
}

function tracksOf(row: EntryRow): EntryTrack[] {
  const value = row.tracks
  return Array.isArray(value) ? (value as EntryTrack[]) : []
}

function appendTrack(row: EntryRow, track: EntryTrack): EntryTrack[] {
  return [...tracksOf(row), track]
}

export function listPipelines(): EntryRow[] {
  return listRows('pipeline')
}

export function getPipeline(id: number): EntryRow | null {
  return listPipelines().find((row) => Number(row.id) === id) ?? null
}

function nextId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

function validateDraft(draft: PipelineDraft): string | null {
  if (!draft.管线编号.trim()) {
    return '请填写管线编号'
  }
  if (!draft.管线类型.trim()) {
    return '请填写管线类型'
  }
  if (!draft.起点位置.trim() || !draft.终点位置.trim()) {
    return '请填写起点位置和终点位置'
  }
  const duplicate = listPipelines().some(
    (row) => String(row.管线编号) === draft.管线编号.trim(),
  )
  if (duplicate) {
    return `管线编号 ${draft.管线编号.trim()} 已存在，请勿重复登记`
  }
  return null
}

function persist(rows: EntryRow[]): void {
  saveRows('pipeline', rows)
}

/** 登记管线：按当前城市管网标准自动给出建档判定 */
export function registerPipeline(
  draft: PipelineDraft,
  operator: OperatorIdentity,
): ServiceResult {
  const error = validateDraft(draft)
  if (error) {
    return { ok: false, message: error }
  }
  const rule = currentRule()
  const admission = evaluateAdmission(draft, rule)
  const status = verdictToStatus(admission.verdict)
  const rows = listPipelines()
  const track: EntryTrack = {
    time: nowText(),
    operator: operator.name,
    unit: operator.unit,
    action: '登记建档',
    detail: `按规则 ${rule.version} 判定「${admission.verdict}」${
      admission.rejectReasons.length ? `：${admission.rejectReasons.join('；')}` : ''
    }`,
    ruleVersion: rule.version,
  }
  const row: EntryRow = {
    id: nextId(rows),
    status,
    pending: status !== '已停用',
    abnormal: status === '退回补充',
    ...draft,
    准入结论: admission.verdict,
    退回条件: admission.rejectReasons.join('；'),
    规则版本: rule.version,
    承办单位: '',
    复核人: '',
    复核结论: '',
    复核时间: '',
    claimVersion: 0,
    reviewVersion: 0,
    tracks: [track],
  }
  persist([...rows, row])
  return {
    ok: true,
    row,
    message:
      admission.verdict === '退回补充'
        ? `登记完成，系统判定「退回补充」：${admission.rejectReasons.join('；')}`
        : `登记完成，系统按规则 ${rule.version} 判定「${admission.verdict}」`,
  }
}

/** 退回补充的管线补齐资料后重新提交：按新口径重新判定 */
export function resubmitPipeline(
  id: number,
  draft: PipelineDraft,
  operator: OperatorIdentity,
): ServiceResult {
  const rows = listPipelines()
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的管线` }
  }
  const current = rows[index]
  if (String(current.status) !== '退回补充') {
    return { ok: false, message: `管线当前为「${current.status}」，不能补充重提` }
  }
  if (
    String(current.管线编号) !== draft.管线编号.trim() &&
    rows.some((row) => String(row.管线编号) === draft.管线编号.trim())
  ) {
    return { ok: false, message: `管线编号 ${draft.管线编号.trim()} 已存在` }
  }
  const rule = currentRule()
  const admission = evaluateAdmission(draft, rule)
  const status = verdictToStatus(admission.verdict)
  const track: EntryTrack = {
    time: nowText(),
    operator: operator.name,
    unit: operator.unit,
    action: '补充重提',
    detail: `按规则 ${rule.version} 重新判定「${admission.verdict}」${
      admission.rejectReasons.length ? `：${admission.rejectReasons.join('；')}` : ''
    }`,
    ruleVersion: rule.version,
  }
  const updated: EntryRow = {
    ...current,
    ...draft,
    status,
    pending: status !== '已停用',
    abnormal: status === '退回补充',
    准入结论: admission.verdict,
    退回条件: admission.rejectReasons.join('；'),
    规则版本: rule.version,
    承办单位: '',
    复核人: '',
    复核结论: '',
    复核时间: '',
    claimVersion: 0,
    reviewVersion: 0,
    tracks: appendTrack(current, track),
  }
  const next = [...rows]
  next[index] = updated
  persist(next)
  return {
    ok: true,
    row: updated,
    message: `已重新提交，系统按规则 ${rule.version} 判定「${admission.verdict}」`,
  }
}

/**
 * 认领待复核管线到自己单位；其它单位之后只能查看。
 * expectedClaimVersion 做并发控制：两个单位同时认领，只有一个能生效。
 */
export function claimPipeline(
  id: number,
  operator: OperatorIdentity,
  expectedClaimVersion: number,
): ServiceResult {
  const rows = listPipelines()
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的管线` }
  }
  const current = rows[index]
  if (String(current.status) !== '待复核') {
    return { ok: false, message: `管线当前为「${current.status}」，不在待复核池` }
  }
  const owner = String(current.承办单位 ?? '')
  if (owner && owner !== operator.unit) {
    return { ok: false, message: `该待复核管线已由「${owner}」认领，贵单位只能查看` }
  }
  if (owner === operator.unit) {
    return { ok: false, message: '本单位已认领该管线，可直接给出复核结论' }
  }
  const actualClaimVersion = Number(current.claimVersion ?? 0)
  if (actualClaimVersion !== expectedClaimVersion) {
    return {
      ok: false,
      message: '认领失败：就在刚才已有其他单位抢先认领该管线，刷新后只能查看',
    }
  }
  const track: EntryTrack = {
    time: nowText(),
    operator: operator.name,
    unit: operator.unit,
    action: '认领复核',
    detail: `${operator.unit} 认领该待复核管线`,
  }
  const updated: EntryRow = {
    ...current,
    承办单位: operator.unit,
    复核人: operator.name,
    claimVersion: actualClaimVersion + 1,
    tracks: appendTrack(current, track),
  }
  const next = [...rows]
  next[index] = updated
  persist(next)
  return { ok: true, row: updated, message: `已认领至「${operator.unit}」，请给出复核结论` }
}

/**
 * 并发演练：模拟另一家单位抢先认领未认领管线，
 * 推进 claimVersion；随后本单位再点认领将因版本不一致被拒绝。
 */
export function simulateConcurrentClaim(id: number, operator: OperatorIdentity): ServiceResult {
  const rows = listPipelines()
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的管线` }
  }
  const current = rows[index]
  if (String(current.status) !== '待复核' || current.承办单位) {
    return { ok: false, message: '仅未认领的待复核管线能做认领并发演练' }
  }
  const rivalUnit = operator.unit === '城东管网养护所' ? '城西管网养护所' : '城东管网养护所'
  const track: EntryTrack = {
    time: nowText(),
    operator: `并发认领人（模拟/${rivalUnit}）`,
    unit: rivalUnit,
    action: '认领抢先（模拟）',
    detail: `模拟 ${rivalUnit} 与贵单位同时认领并先生效`,
  }
  const updated: EntryRow = {
    ...current,
    承办单位: rivalUnit,
    复核人: `并发认领人（模拟/${rivalUnit}）`,
    claimVersion: Number(current.claimVersion ?? 0) + 1,
    tracks: appendTrack(current, track),
  }
  const next = [...rows]
  next[index] = updated
  persist(next)
  return { ok: true, row: updated, message: `已模拟 ${rivalUnit} 抢先认领，再点认领将被拦截` }
}

export type ReviewOutcome = '通过建档' | '退回补充'

/**
 * 提交复核结论。expectedVersion 做并发控制：
 * 认领/出结论期间版本被别人抢先推进，则本次结论不生效。
 */
export function reviewPipeline(
  id: number,
  outcome: ReviewOutcome,
  comment: string,
  operator: OperatorIdentity,
  expectedVersion: number,
): ServiceResult {
  const rows = listPipelines()
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的管线` }
  }
  const current = rows[index]
  if (String(current.status) !== '待复核') {
    return { ok: false, message: `管线当前为「${current.status}」，复核结论只能提交一次` }
  }
  if (String(current.承办单位 ?? '') !== operator.unit) {
    return {
      ok: false,
      message: current.承办单位
        ? `该管线由「${current.承办单位}」承办，贵单位只能查看`
        : '请先将领用管线认领至本单位，再提交复核结论',
    }
  }
  const actualVersion = Number(current.reviewVersion ?? 0)
  if (actualVersion !== expectedVersion) {
    return {
      ok: false,
      message: '检测到其他人同时在复核该管线，对方结论已先生效，您本次结论未保存，请刷新后查看',
    }
  }
  const rule = currentRule()
  const status = outcome === '通过建档' ? '已建档' : '退回补充'
  const track: EntryTrack = {
    time: nowText(),
    operator: operator.name,
    unit: operator.unit,
    action: outcome === '通过建档' ? '复核通过' : '复核退回',
    detail: `复核结论「${outcome}」${comment ? `；说明：${comment}` : ''}`,
    ruleVersion: rule.version,
  }
  const updated: EntryRow = {
    ...current,
    status,
    pending: true,
    abnormal: status === '退回补充',
    复核人: operator.name,
    复核结论: outcome,
    复核时间: track.time,
    准入结论: outcome === '通过建档' ? '可建档' : '退回补充',
    退回条件: outcome === '退回补充' ? comment || '复核不通过，请按复核意见补充资料' : '',
    reviewVersion: actualVersion + 1,
    tracks: appendTrack(current, track),
  }
  const next = [...rows]
  next[index] = updated
  persist(next)
  return { ok: true, row: updated, message: `复核结论「${outcome}」已生效，其他同时提交将被拦截` }
}

/**
 * 并发演练：模拟“另一名审核人”抢先完成复核（仍记为本单位），
 * 推进 reviewVersion 并追加轨迹；随后提交的结论会因版本不一致被拒绝。
 */
export function simulateConcurrentReview(id: number, operator: OperatorIdentity): ServiceResult {
  const rows = listPipelines()
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的管线` }
  }
  const current = rows[index]
  if (String(current.status) !== '待复核') {
    return { ok: false, message: '管线已不在复核中，无法再模拟并发' }
  }
  if (String(current.承办单位 ?? '') !== operator.unit) {
    return { ok: false, message: '只有本单位承办的管线才能做并发演练' }
  }
  const rival = `并发复核人（模拟/${operator.unit}）`
  const track: EntryTrack = {
    time: nowText(),
    operator: rival,
    unit: operator.unit,
    action: '并发抢先（模拟）',
    detail: '模拟另一名审核人同时提交并先生效',
  }
  const updated: EntryRow = {
    ...current,
    reviewVersion: Number(current.reviewVersion ?? 0) + 1,
    tracks: appendTrack(current, track),
  }
  const next = [...rows]
  next[index] = updated
  persist(next)
  return { ok: true, row: updated, message: '已模拟他人抢先提交，现在提交结论将被拦截' }
}

export function disablePipeline(id: number, operator: OperatorIdentity): ServiceResult {
  const rows = listPipelines()
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的管线` }
  }
  const current = rows[index]
  if (String(current.status) === '已停用') {
    return { ok: false, message: '管线已停用，无需重复操作' }
  }
  const track: EntryTrack = {
    time: nowText(),
    operator: operator.name,
    unit: operator.unit,
    action: '停用管线',
    detail: '人工停用',
  }
  const updated: EntryRow = {
    ...current,
    status: '已停用',
    pending: false,
    abnormal: true,
    reviewVersion: Number(current.reviewVersion ?? 0) + 1,
    tracks: appendTrack(current, track),
  }
  const next = [...rows]
  next[index] = updated
  persist(next)
  return { ok: true, row: updated, message: '管线已停用' }
}

/** 登记表单实时预览判定结果，不落库 */
export function previewAdmission(draft: PipelineAdmissionInput): AdmissionResult {
  return evaluateAdmission(draft, currentRule())
}

/**
 * 当前是否允许继续巡检：
 * 历史建档结论保持不动（保留原规则版本），巡检准入永远按当前规则口径实时复判。
 */
export function pipelineAccess(row: EntryRow): PipelineAccess {
  const rule = currentRule()
  const admission = evaluateAdmission(
    {
      管径规格: String(row.管径规格 ?? ''),
      管材类型: String(row.管材类型 ?? ''),
      敷设深度: String(row.敷设深度 ?? ''),
      投运日期: String(row.投运日期 ?? ''),
    },
    rule,
  )
  const archivedVerdict = String(row.准入结论 ?? row.status ?? '')
  const archivedRuleVersion = String(row.规则版本 ?? '—')

  if (String(row.status) === '已停用') {
    return {
      allowed: false,
      level: 'deny',
      label: '暂停巡检',
      reason: '管线已停用，停用期间不得继续巡检',
      archivedVerdict,
      archivedRuleVersion,
      currentVerdict: admission.verdict,
      currentRuleVersion: rule.version,
    }
  }
  if (String(row.status) === '待建档') {
    return {
      allowed: false,
      level: 'deny',
      label: '暂停巡检',
      reason: '管线尚未完成建档，建档通过后方可巡检',
      archivedVerdict,
      archivedRuleVersion,
      currentVerdict: admission.verdict,
      currentRuleVersion: rule.version,
    }
  }

  if (admission.verdict === '退回补充') {
    return {
      allowed: false,
      level: 'deny',
      label: '暂停巡检',
      reason: `按当前规则 ${rule.version} 复判不满足准入：${admission.rejectReasons.join('；')}`,
      archivedVerdict,
      archivedRuleVersion,
      currentVerdict: admission.verdict,
      currentRuleVersion: rule.version,
    }
  }
  if (admission.verdict === '待复核') {
    return {
      allowed: false,
      level: 'caution',
      label: '复核前暂停',
      reason: `按当前规则 ${rule.version} 需复核：${admission.rejectReasons.join('；')}`,
      archivedVerdict,
      archivedRuleVersion,
      currentVerdict: admission.verdict,
      currentRuleVersion: rule.version,
    }
  }
  return {
    allowed: true,
    level: 'allow',
    label: '可继续巡检',
    reason:
      archivedRuleVersion === rule.version
        ? `历史结论与当前规则 ${rule.version} 一致`
        : `历史按规则 ${archivedRuleVersion} 建档，当前规则 ${rule.version} 复判仍满足准入`,
    archivedVerdict,
    archivedRuleVersion,
    currentVerdict: admission.verdict,
    currentRuleVersion: rule.version,
  }
}

/** 缺陷记录按“所属管线”文本（管线编号）匹配管线 */
export function findPipelineByLabel(label: string): EntryRow | null {
  const text = label.trim()
  if (!text) {
    return null
  }
  const rows = listPipelines()
  return (
    rows.find((row) => String(row.管线编号) === text) ??
    rows.find((row) => text.includes(String(row.管线编号)) || String(row.管线编号).includes(text)) ??
    null
  )
}
