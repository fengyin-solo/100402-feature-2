<template>
  <section class="page" data-module="defect">
    <header class="page-head">
      <div>
        <h2>缺陷记录管理</h2>
        <p class="page-desc">
          维护缺陷记录并关联所属管线：档案里保留管线当时的建档结论，同时按现行建档口径实时提示该管线当前是否允许继续巡检。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记缺陷记录</button>
        <button class="btn" type="button" @click="exportRows">导出缺陷记录清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>关联管线巡检准入</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>
            <template v-if="linkOf(row)">
              <div>
                <span :class="linkOf(row)!.access.level === 'allow' ? 'badge ok' : linkOf(row)!.access.level === 'caution' ? 'badge warn' : 'badge bad'">
                  {{ linkOf(row)!.access.label }}
                </span>
                <span class="cell-sub">{{ linkOf(row)!.pipeline.管线编号 }} ｜ 管线状态 {{ linkOf(row)!.pipeline.status }}</span>
              </div>
              <div class="cell-sub" :title="linkOf(row)!.access.reason">{{ linkOf(row)!.access.reason }}</div>
              <div class="cell-sub muted">
                建档原结论：{{ linkOf(row)!.access.archivedVerdict || '—' }}
                （规则 {{ linkOf(row)!.access.archivedRuleVersion }}）；
                现行 {{ linkOf(row)!.access.currentRuleVersion }} 复判：{{ linkOf(row)!.access.currentVerdict }}
              </div>
            </template>
            <span v-else class="badge neutral">未匹配到管线</span>
          </td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 3" class="empty-state">暂无缺陷记录数据，可先登记缺陷记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条缺陷记录记录 · 关联管线暂停巡检时，请先停止该管段巡检派工</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import {
  findPipelineByLabel,
  pipelineAccess,
  type PipelineAccess,
} from '@/domain/pipeline-service'
import { invalidateCache } from '@/data/local-store'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('defect')
const columns = ["缺陷编号", "所属管线", "缺陷类型", "发现位置", "严重等级", "发现日期", "缺陷描述", "记录状态"]
const actions = ["确认缺陷", "标记修复", "忽略缺陷"]
const statuses = ["待确认", "已确认", "已修复", "已忽略"]
const stats = ref([
  { label: "待确认缺陷", value: 0 },
  { label: "已修复缺陷", value: 0 },
  { label: "关联管线暂停巡检", value: 0 },
])

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

type LinkedInfo = { pipeline: EntryRow; access: PipelineAccess }

const linkMap = new Map<number, LinkedInfo>()

function linkOf(row: EntryRow): LinkedInfo | null {
  const id = Number(row.id)
  if (linkMap.has(id)) {
    return linkMap.get(id) ?? null
  }
  const pipeline = findPipelineByLabel(String(row.所属管线 ?? ''))
  if (!pipeline) {
    return null
  }
  const info = { pipeline, access: pipelineAccess(pipeline) }
  linkMap.set(id, info)
  return info
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '缺陷记录登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  linkMap.clear()
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    stats.value = [
      { label: "待确认缺陷", value: payload.items.filter((row) => String(row.status) === '待确认').length },
      { label: "已修复缺陷", value: payload.items.filter((row) => String(row.status) === '已修复').length },
      {
        label: "关联管线暂停巡检",
        value: payload.items.filter((row) => {
          const link = linkOf(row)
          return !!link && !link.access.allowed
        }).length,
      },
    ]
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '缺陷记录列表读取失败'
  }
}

// 规则或管线在其它标签页被调整时，巡检准入徽标跟着刷新。
function onStorage(event: StorageEvent) {
  if (event.key) {
    invalidateCache()
    reload()
  }
}

onMounted(() => {
  reload()
  window.addEventListener('storage', onStorage)
})
</script>
