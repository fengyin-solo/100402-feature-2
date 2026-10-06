<template>
  <span class="admission-cell">
    <span :class="['badge', verdictClass]">{{ verdict }}</span>
    <span v-if="showInspection" :class="['inspect-tag', allowInspection ? 'ok' : 'stop']">
      {{ allowInspection ? '允许巡检' : '停止巡检' }}
    </span>
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import type { AdmissionVerdict } from '@/data/types'

const props = withDefaults(
  defineProps<{
    verdict: AdmissionVerdict | string
    allowInspection?: boolean
    showInspection?: boolean
  }>(),
  { allowInspection: false, showInspection: true },
)

const verdictClass = computed(() => {
  switch (props.verdict) {
    case '可建档':
      return 'badge-ok'
    case '待复核':
      return 'badge-review'
    case '退回补充':
      return 'badge-reject'
    default:
      return 'badge-muted'
  }
})
</script>
