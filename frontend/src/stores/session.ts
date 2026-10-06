import { defineStore } from 'pinia'

// 演示用单位池：可在管线登记页切换当前审核单位，验证“待复核管线只能由认领单位操作”。
export const ORG_UNITS = [
  '市排水管理中心',
  '城东管网养护所',
  '城西管网养护所',
  '第三方检测单位',
]

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '值班管理员',
    unit: ORG_UNITS[0],
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
    setUnit(unit: string) {
      this.unit = unit
    },
  },
})
