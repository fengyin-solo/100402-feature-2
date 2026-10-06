import { defineStore } from 'pinia'

// 可切换的审核单位：待复核管线被某个单位认领后，其他单位只能查看。
export const REVIEW_UNITS = ['城东管网所', '城西管网所', '城南管网所']

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '王工',
    unit: '城东管网所',
    shiftLabel: '白班 08:00-20:00',
    scope: '城市地下管网巡检养护管理系统',
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    /** 切换当前审核身份（单位 + 姓名）。纯前端没有登录态，用它模拟不同单位/审核人。 */
    setReviewer(unit: string, operator: string) {
      this.unit = unit
      this.operator = operator
    },
  },
})
