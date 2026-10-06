/**
 * 城市管网建档准入规则（城市管网标准）。
 * 规则带版本号与生效时间，整体存 localStorage；调整口径时追加新版本，不覆盖旧版本，
 * 这样已有管线的建档结论可以一直关联到当时生效的规则版本。
 */

export type ArchiveRule = {
  /** 版本号，如 2026.1；每次保存调整自动递增末位 */
  version: string
  effectiveAt: string
  note: string
  /** 允许的最小管径，mm */
  minDiameter: number
  /** 小于该管径（mm）仅判待复核，提示补充运行依据 */
  smallDiameterWarn: number
  /** 标准允许采用的管材 */
  allowedMaterials: string[]
  /** 禁止新建档的管材：命中直接退回补充 */
  discouragedMaterials: string[]
  /** 最小覆土（敷设深度），m */
  minDepth: number
  /** 低于该覆土（m）仅判待复核 */
  shallowDepthWarn: number
  /** 最大允许敷设深度，m */
  maxDepth: number
  /** 超过该深度（m）仅判待复核，需结构复核 */
  deepDepthWarn: number
  /** 投运年限超过该值判待复核（管线老旧） */
  maxServiceYears: number
}

export const DEFAULT_ARCHIVE_RULE: ArchiveRule = {
  version: '2026.1',
  effectiveAt: '2026-01-01',
  note: '城市管网建档准入基准口径（管径 / 材质 / 敷设深度 / 投运年限）',
  minDiameter: 200,
  smallDiameterWarn: 300,
  allowedMaterials: ['球墨铸铁管', '钢管', 'PE管', 'HDPE管', 'UPVC管', '钢筋混凝土管', '玻璃钢夹砂管'],
  discouragedMaterials: ['灰口铸铁管', '陶土管', '镀锌钢管', '石棉水泥管'],
  minDepth: 0.7,
  shallowDepthWarn: 0.9,
  maxDepth: 8,
  deepDepthWarn: 6,
  maxServiceYears: 30,
}

const RULES_STORAGE_KEY = 'underground-pipeline-inspection:archive-rules'
const CURRENT_VERSION_KEY = 'underground-pipeline-inspection:archive-rules-current'

type RuleState = {
  versions: ArchiveRule[]
  currentVersion: string
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function initialState(): RuleState {
  return { versions: [clone(DEFAULT_ARCHIVE_RULE)], currentVersion: DEFAULT_ARCHIVE_RULE.version }
}

function readState(): RuleState {
  if (typeof window === 'undefined' || !window.localStorage) {
    return initialState()
  }
  const raw = window.localStorage.getItem(RULES_STORAGE_KEY)
  if (!raw) {
    const state = initialState()
    writeState(state)
    return state
  }
  try {
    const parsed = JSON.parse(raw) as RuleState
    if (!Array.isArray(parsed.versions) || !parsed.versions.length || !parsed.currentVersion) {
      const state = initialState()
      writeState(state)
      return state
    }
    return parsed
  } catch {
    const state = initialState()
    writeState(state)
    return state
  }
}

function writeState(state: RuleState): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(RULES_STORAGE_KEY, JSON.stringify(state))
    window.localStorage.setItem(CURRENT_VERSION_KEY, state.currentVersion)
  }
}

export function listRuleVersions(): ArchiveRule[] {
  return readState().versions.map((item) => ({ ...item }))
}

export function currentRule(): ArchiveRule {
  const state = readState()
  const found =
    state.versions.find((item) => item.version === state.currentVersion) ??
    state.versions[state.versions.length - 1]
  return { ...found }
}

export function ruleByVersion(version: string): ArchiveRule | null {
  const found = readState().versions.find((item) => item.version === version)
  return found ? { ...found } : null
}

export type RulePatch = Omit<ArchiveRule, 'version' | 'effectiveAt'>

/**
 * 保存调整后的口径：追加一个新版本（版本末位 +1），当前口径切到新版本。
 * 已有管线不动，仍按其登记时记录的版本展示原结论。
 */
export function saveRule(patch: RulePatch, effectiveAt: string): ArchiveRule {
  const state = readState()
  const latest = state.versions[state.versions.length - 1]
  const segments = latest.version.split('.')
  const lastSeq = Number(segments[segments.length - 1])
  segments[segments.length - 1] = String(Number.isFinite(lastSeq) ? lastSeq + 1 : 1)
  const next: ArchiveRule = { ...clone(patch), version: segments.join('.'), effectiveAt }
  state.versions.push(next)
  state.currentVersion = next.version
  writeState(state)
  return { ...next }
}

export function rulesStorageKey(): string {
  return RULES_STORAGE_KEY
}
