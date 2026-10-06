import type { ArchiveRule } from './archive-rules'

/**
 * 建档准入判定引擎：录入管径、材质、敷设深度、投运日期后，
 * 按城市管网标准给出 可建档 / 待复核 / 退回补充 三档结论，
 * 退回时逐条给出具体条件。
 */

export type AdmissionVerdict = '可建档' | '待复核' | '退回补充'

export type AdmissionIssue = {
  level: 'hard' | 'warn'
  field: '管径规格' | '管材类型' | '敷设深度' | '投运日期'
  message: string
}

export type AdmissionResult = {
  verdict: AdmissionVerdict
  issues: AdmissionIssue[]
  hardIssues: AdmissionIssue[]
  warnIssues: AdmissionIssue[]
  /** 退回时给录入人的补充条件清单（文案直接可用） */
  rejectReasons: string[]
  ruleVersion: string
}

/** 解析管径，支持 DN300、300mm、0.3m 等写法，统一成 mm */
export function parseDiameter(text: string): number | null {
  const raw = text.trim()
  if (!raw) {
    return null
  }
  const meter = raw.match(/^([\d.]+)\s*m$/i)
  if (meter) {
    const value = Number(meter[1])
    return Number.isFinite(value) && value > 0 ? value * 1000 : null
  }
  const match = raw.match(/(\d+(?:\.\d+)?)/)
  if (!match) {
    return null
  }
  const value = Number(match[1])
  if (!Number.isFinite(value) || value <= 0) {
    return null
  }
  // DN/毫米口径按 mm，纯数字也按 mm
  return value
}

/** 解析敷设深度，统一成 m */
export function parseDepth(text: string): number | null {
  const raw = text.trim()
  if (!raw) {
    return null
  }
  const millimeter = /mm|毫米/i.test(raw)
  const match = raw.match(/(\d+(?:\.\d+)?)/)
  if (!match) {
    return null
  }
  let value = Number(match[1])
  if (!Number.isFinite(value) || value < 0) {
    return null
  }
  if (millimeter || (!/m|米/i.test(raw) && value >= 10)) {
    value = value / 1000
  }
  return value
}

function isValidDateText(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text.trim())) {
    return false
  }
  const date = new Date(`${text.trim()}T00:00:00`)
  return !Number.isNaN(date.getTime())
}

export type PipelineAdmissionInput = {
  管径规格: string
  管材类型: string
  敷设深度: string
  投运日期: string
}

export function evaluateAdmission(
  input: PipelineAdmissionInput,
  rule: ArchiveRule,
  today: Date = new Date(),
): AdmissionResult {
  const issues: AdmissionIssue[] = []

  // 1. 管径
  const diameterText = input.管径规格 ?? ''
  if (!diameterText.trim()) {
    issues.push({ level: 'hard', field: '管径规格', message: '管径规格未录入，无法校核最小管径' })
  } else {
    const diameter = parseDiameter(diameterText)
    if (diameter === null) {
      issues.push({
        level: 'hard',
        field: '管径规格',
        message: `管径「${diameterText}」无法识别，请按 DN300 / 300mm / 0.3m 等格式填写`,
      })
    } else if (diameter < rule.minDiameter) {
      issues.push({
        level: 'hard',
        field: '管径规格',
        message: `管径 DN${Math.round(diameter)} 小于标准最小 DN${rule.minDiameter}，不符合最小管径要求`,
      })
    } else if (diameter < rule.smallDiameterWarn) {
      issues.push({
        level: 'warn',
        field: '管径规格',
        message: `管径 DN${Math.round(diameter)} 小于 DN${rule.smallDiameterWarn}，建议复核过流能力与设计依据`,
      })
    }
  }

  // 2. 材质
  const material = (input.管材类型 ?? '').trim()
  if (!material) {
    issues.push({ level: 'hard', field: '管材类型', message: '管材类型未录入，无法校核材质适用性' })
  } else {
    const allowed = rule.allowedMaterials.some(
      (item) => material === item || material.includes(item) || item.includes(material),
    )
    const discouraged = rule.discouragedMaterials.some(
      (item) => material === item || material.includes(item) || item.includes(material),
    )
    if (discouraged) {
      issues.push({
        level: 'hard',
        field: '管材类型',
        message: `管材「${material}」属淘汰/限制材质，标准不允许据此建档，请补充材质证明或更换管材登记`,
      })
    } else if (!allowed) {
      issues.push({
        level: 'warn',
        field: '管材类型',
        message: `管材「${material}」不在标准列明材质清单内，需人工核实质保资料后再建档`,
      })
    }
  }

  // 3. 敷设深度（覆土）
  const depthText = input.敷设深度 ?? ''
  if (!depthText.trim()) {
    issues.push({ level: 'hard', field: '敷设深度', message: '敷设深度未录入，无法校核覆土厚度' })
  } else {
    const depth = parseDepth(depthText)
    if (depth === null) {
      issues.push({
        level: 'hard',
        field: '敷设深度',
        message: `敷设深度「${depthText}」无法识别，请按 1.2m / 1200mm 等格式填写`,
      })
    } else if (depth < rule.minDepth) {
      issues.push({
        level: 'hard',
        field: '敷设深度',
        message: `覆土 ${depth}m 小于车行道最小覆土 ${rule.minDepth}m，不满足荷载防护要求`,
      })
    } else if (depth < rule.shallowDepthWarn) {
      issues.push({
        level: 'warn',
        field: '敷设深度',
        message: `覆土 ${depth}m 偏浅（建议不低于 ${rule.shallowDepthWarn}m），请复核防护措施`,
      })
    } else if (depth > rule.maxDepth) {
      issues.push({
        level: 'hard',
        field: '敷设深度',
        message: `覆土 ${depth}m 超过最大允许深度 ${rule.maxDepth}m，请补充专项结构论证`,
      })
    } else if (depth > rule.deepDepthWarn) {
      issues.push({
        level: 'warn',
        field: '敷设深度',
        message: `覆土 ${depth}m 超过 ${rule.deepDepthWarn}m，需结构专业复核后建档`,
      })
    }
  }

  // 4. 投运日期
  const dateText = (input.投运日期 ?? '').trim()
  if (!dateText) {
    issues.push({ level: 'hard', field: '投运日期', message: '投运日期未录入，无法校核服役年限' })
  } else if (!isValidDateText(dateText)) {
    issues.push({
      level: 'hard',
      field: '投运日期',
      message: `投运日期「${dateText}」不是有效日期，请按 YYYY-MM-DD 填写`,
    })
  } else {
    const commissioned = new Date(`${dateText}T00:00:00`)
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate())
    if (commissioned.getTime() > todayStart.getTime()) {
      issues.push({
        level: 'hard',
        field: '投运日期',
        message: `投运日期 ${dateText} 晚于当前日期，属于未投运管线，请补充投运计划后再登记`,
      })
    } else {
      const serviceYears =
        (todayStart.getTime() - commissioned.getTime()) / (365.25 * 24 * 60 * 60 * 1000)
      if (serviceYears > rule.maxServiceYears) {
        issues.push({
          level: 'warn',
          field: '投运日期',
          message: `已投运约 ${serviceYears.toFixed(1)} 年，超过 ${rule.maxServiceYears} 年参考年限，建议复核老化评估资料`,
        })
      }
    }
  }

  const hardIssues = issues.filter((item) => item.level === 'hard')
  const warnIssues = issues.filter((item) => item.level === 'warn')
  const verdict: AdmissionVerdict =
    hardIssues.length > 0 ? '退回补充' : warnIssues.length > 0 ? '待复核' : '可建档'

  return {
    verdict,
    issues,
    hardIssues,
    warnIssues,
    rejectReasons: issues.map((item) => item.message),
    ruleVersion: rule.version,
  }
}

/** 结论对应管线状态 */
export function verdictToStatus(verdict: AdmissionVerdict): string {
  if (verdict === '可建档') {
    return '已建档'
  }
  if (verdict === '待复核') {
    return '待复核'
  }
  return '退回补充'
}
