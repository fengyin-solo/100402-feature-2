import type { AdmissionDecision, AdmissionRule, AdmissionVerdict } from './types'

// 建档准入规则独立存一份，历史版本全部保留：管线建档时把命中的版本号固化在结论快照里。
const RULE_STORAGE_KEY = 'underground-pipeline-inspection:admission-rules'

// 城市管网常用公称直径系列（GB/T 1048），非标准系列管径需人工复核。
const STANDARD_DN_SERIES = [
  50, 65, 80, 100, 125, 150, 200, 250, 300, 350, 400, 450, 500, 600, 700, 800, 900, 1000,
  1100, 1200, 1300, 1400, 1500, 1600, 1800, 2000, 2200, 2400,
]

export const DEFAULT_RULE: AdmissionRule = {
  version: 1,
  minDiameter: 100,
  maxDiameter: 2000,
  minDepth: 0.7,
  deepReviewDepth: 6,
  serviceLifeReviewYears: 25,
  serviceLifeRejectYears: 40,
  allowedMaterials: ['球墨铸铁管', '钢管', 'PE管', 'HDPE管', 'PVC-U管', '预应力混凝土管', '玻璃钢夹砂管'],
  bannedMaterials: ['灰口铸铁管', '普通铸铁管', '陶土管', '石棉水泥管'],
  largeDiameterReview: 1600,
  note: '城市管网建档准入标准 v1：车行道下管顶覆土不小于 0.7m，禁用灰口铸铁等淘汰管材。',
  createdAt: '2026-01-01T00:00:00.000Z',
  createdBy: '系统',
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function writeStorage(rules: AdmissionRule[]): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(RULE_STORAGE_KEY, JSON.stringify(rules))
  }
}

/**
 * 读取全部规则版本（旧到新）。始终从 localStorage 现读：
 * 多个标签页同时复核时，另一个标签页调整了规则这里也能立刻看到。
 */
export function listRules(): AdmissionRule[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return [clone(DEFAULT_RULE)]
  }
  const raw = window.localStorage.getItem(RULE_STORAGE_KEY)
  if (!raw) {
    const seed = [clone(DEFAULT_RULE)]
    writeStorage(seed)
    return seed
  }
  try {
    const parsed = JSON.parse(raw) as AdmissionRule[]
    if (!Array.isArray(parsed) || parsed.length === 0) {
      const seed = [clone(DEFAULT_RULE)]
      writeStorage(seed)
      return seed
    }
    return parsed
  } catch {
    const seed = [clone(DEFAULT_RULE)]
    writeStorage(seed)
    return seed
  }
}

/** 当前生效规则（版本号最大的一份）。 */
export function currentRule(): AdmissionRule {
  const rules = listRules()
  return rules.reduce((latest, item) => (item.version > latest.version ? item : latest), rules[0])
}

export function ruleOfVersion(version: number): AdmissionRule | undefined {
  return listRules().find((item) => item.version === version)
}

/** 规则调整：生成新版本并立即生效，历史版本保留不动。已有管线不会被重算结论。 */
export function addRule(draft: Omit<AdmissionRule, 'version' | 'createdAt'>): AdmissionRule {
  const rules = listRules()
  const next: AdmissionRule = {
    ...draft,
    version: rules.reduce((max, item) => Math.max(max, item.version), 0) + 1,
    createdAt: new Date().toISOString(),
  }
  const saved = [...rules, next]
  writeStorage(saved)
  return next
}

export function resetRules(): AdmissionRule[] {
  const seed = [clone(DEFAULT_RULE)]
  writeStorage(seed)
  return seed
}

/** 规则引擎输入：页面只负责录入这四项，判定统一在这里做，页面不做业务判断。 */
export type AdmissionInput = {
  diameter?: string | number
  material?: string
  depth?: string | number
  commissionedDate?: string
}

function toNumber(value: string | number | undefined): number | null {
  if (value === undefined || value === null || String(value).trim() === '') {
    return null
  }
  const parsed = Number(String(value).replace(/[^\d.-]/g, ''))
  return Number.isFinite(parsed) ? parsed : null
}

function serviceYears(commissionedDate: string | undefined, now: Date): number | null {
  if (!commissionedDate || !/^\d{4}-\d{2}-\d{2}/.test(commissionedDate)) {
    return null
  }
  const commissioned = new Date(commissionedDate.slice(0, 10))
  if (Number.isNaN(commissioned.getTime())) {
    return null
  }
  const ms = now.getTime() - commissioned.getTime()
  if (ms < 0) {
    return null
  }
  return Math.floor(ms / (365.25 * 24 * 3600 * 1000))
}

/**
 * 按城市管网标准判定建档准入。
 * 退回补充：硬性条件不满足（缺项、越界、禁用管材、超期服役）；
 * 待复核：临界条件命中（大口径、非标准系列、超深埋、临近设计年限），需要人工确认；
 * 其余可建档。退回优先级高于复核。
 */
export function evaluateAdmission(
  input: AdmissionInput,
  rule: AdmissionRule = currentRule(),
  now: Date = new Date(),
): AdmissionDecision {
  const rejectReasons: string[] = []
  const reviewReasons: string[] = []

  const diameter = toNumber(input.diameter)
  if (diameter === null) {
    rejectReasons.push('管径未按毫米（DN）填写有效数值，无法核对规格')
  } else if (diameter < rule.minDiameter || diameter > rule.maxDiameter) {
    rejectReasons.push(
      `管径 DN${diameter} 超出城市管网允许范围（DN${rule.minDiameter}~DN${rule.maxDiameter}），请核实规格后补报`,
    )
  } else {
    if (diameter >= rule.largeDiameterReview) {
      reviewReasons.push(`DN${diameter} 为大口径管段（≥DN${rule.largeDiameterReview}），需结构安全复核`)
    }
    if (!STANDARD_DN_SERIES.includes(diameter)) {
      reviewReasons.push(`DN${diameter} 不在国标公称直径常用系列内，请复核规格来源`)
    }
  }

  const material = String(input.material ?? '').trim()
  if (!material) {
    rejectReasons.push('管材（材质）未填写，无法核对是否在准入目录内')
  } else if (rule.bannedMaterials.some((item) => material.includes(item))) {
    rejectReasons.push(`管材「${material}」属明令淘汰/禁用管材，不予建档，请补充更新改造情况`)
  } else if (!rule.allowedMaterials.some((item) => material.includes(item) || item.includes(material))) {
    reviewReasons.push(`管材「${material}」不在常用准入目录内，需核实管材标准与验收资料`)
  }

  const depth = toNumber(input.depth)
  if (depth === null) {
    rejectReasons.push('敷设深度（管顶覆土）未按米填写有效数值，无法核对埋深标准')
  } else if (depth < rule.minDepth) {
    rejectReasons.push(
      `管顶覆土 ${depth}m 小于车行道下最小覆土 ${rule.minDepth}m，不满足抗荷载要求，请补充防护或改线资料`,
    )
  } else if (depth > rule.deepReviewDepth) {
    reviewReasons.push(`埋深 ${depth}m 超过 ${rule.deepReviewDepth}m，需复核地下空间与施工安全`)
  }

  if (!input.commissionedDate) {
    rejectReasons.push('投运日期未填写，无法核对服役年限与设计使用年限')
  } else {
    const years = serviceYears(input.commissionedDate, now)
    if (years === null) {
      rejectReasons.push(`投运日期「${input.commissionedDate}」无法识别或晚于今天，请按 YYYY-MM-DD 补填`)
    } else if (years > rule.serviceLifeRejectYears) {
      rejectReasons.push(
        `已投运 ${years} 年，超过设计使用年限（${rule.serviceLifeRejectYears} 年），需先做检测评估或更新改造`,
      )
    } else if (years > rule.serviceLifeReviewYears) {
      reviewReasons.push(`已投运 ${years} 年，超过 ${rule.serviceLifeReviewYears} 年，需复核剩余寿命与检测报告`)
    }
  }

  const verdict: AdmissionVerdict =
    rejectReasons.length > 0 ? '退回补充' : reviewReasons.length > 0 ? '待复核' : '可建档'

  return {
    verdict,
    // 当前巡检口径：退回补充的管线一律停止继续巡检；待复核管线在复核结论出来前暂停巡检。
    allowInspection: verdict === '可建档',
    rejectReasons,
    reviewReasons,
    ruleVersion: rule.version,
    judgedAt: now.toISOString(),
  }
}
