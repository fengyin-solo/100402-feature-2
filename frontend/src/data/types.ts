/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

/** 管线登记/复核过程中追加的轨迹事件，只增不改。 */
export type EntryTrack = {
  time: string
  operator: string
  unit: string
  action: string
  detail: string
  ruleVersion?: string
}

/** 单元格允许承载的扩展值：管线模块会在行内存放轨迹数组。 */
export type EntryValue = string | number | boolean | EntryTrack[]

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
