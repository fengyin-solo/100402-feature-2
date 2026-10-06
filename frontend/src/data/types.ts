/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryValue = string | number | boolean | AdmissionSnapshot[] | null | undefined

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: EntryValue
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

/** 建档准入判定结论，三选一：可建档 / 待复核 / 退回补充。 */
export type AdmissionVerdict = '可建档' | '待复核' | '退回补充'

/** 一次准入判定的完整结果。判定按某个规则版本做出，退回/复核时附具体条件。 */
export type AdmissionDecision = {
  verdict: AdmissionVerdict
  /** 当前口径下该管线是否允许继续巡检：缺陷记录关联管线时直接读这个口径。 */
  allowInspection: boolean
  /** 退回补充的具体条件（硬性不满足项）。 */
  rejectReasons: string[]
  /** 触发人工复核的临界条件。 */
  reviewReasons: string[]
  /** 判定所依据的规则版本。 */
  ruleVersion: number
  /** 判定时间，ISO 字符串。 */
  judgedAt: string
}

/** 建档结论快照：随管线存一条，规则调整后历史结论原样保留。 */
export type AdmissionSnapshot = AdmissionDecision & {
  stage: string
}

/** 城市管网建档准入规则（可调整，每次调整生成一个新版本）。 */
export type AdmissionRule = {
  version: number
  /** 最小允许管径，毫米（公称直径 DN）。 */
  minDiameter: number
  /** 最大允许管径，毫米。 */
  maxDiameter: number
  /** 允许建档的最小管顶覆土深度，米。 */
  minDepth: number
  /** 超过该埋深进入人工复核，米。 */
  deepReviewDepth: number
  /** 服役年限超过该值进入复核，年。 */
  serviceLifeReviewYears: number
  /** 服役年限超过该值直接退回，年。 */
  serviceLifeRejectYears: number
  /** 允许的管材目录。 */
  allowedMaterials: string[]
  /** 明令禁用、需要退回报废核实的管材。 */
  bannedMaterials: string[]
  /** 大口径复核阈值，毫米：达到该口径需结构复核。 */
  largeDiameterReview: number
  note: string
  createdAt: string
  createdBy: string
}
