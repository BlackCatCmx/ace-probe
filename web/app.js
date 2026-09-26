const elements = {
  status: document.getElementById('update-status'),
  update: document.getElementById('update-text'),
  error: document.getElementById('error-message'),
  count: document.getElementById('container-count'),
  search: document.getElementById('container-search'),
  list: document.getElementById('container-list'),
  name: document.getElementById('selected-name'),
  state: document.getElementById('selected-state'),
  id: document.getElementById('selected-id'),
  cpu: document.getElementById('current-cpu'),
  memory: document.getElementById('current-memory'),
  cpuChart: document.getElementById('cpu-chart'),
  memoryChart: document.getElementById('memory-chart'),
  cpuReadout: document.getElementById('cpu-readout'),
  memoryReadout: document.getElementById('memory-readout'),
  cpuEmpty: document.getElementById('cpu-empty'),
  memoryEmpty: document.getElementById('memory-empty'),
}

let selectedHours = 6
let selectedID = null
let records = []
let catalog = []
let latest = null
let cpuPlot
let memoryPlot
let loading = false

const numberFormat = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2, minimumFractionDigits: 2 })
const timeFormat = new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
})

function cpuText(value) {
  return value == null ? '—' : `${numberFormat.format(value)}%`
}

function memoryText(value) {
  return value == null ? '—' : `${numberFormat.format(value / 1048576)} MiB`
}

function stateText(state) {
  const names = { running: '运行中', exited: '已停止', paused: '已暂停', created: '已创建', restarting: '重启中', removed: '已移除' }
  return names[state] || state
}

function utcDay(time) {
  return new Date(time).toISOString().slice(0, 10)
}

async function readLatest() {
  const response = await fetch('./data/latest.json', { cache: 'no-store' })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`最新数据读取失败：HTTP ${response.status}`)
  return response.json()
}

async function readDay(day) {
  const response = await fetch(`./data/${day}.ndjson`, { cache: 'no-store' })
  if (response.status === 404) return []
  if (!response.ok) throw new Error(`${day} 历史数据读取失败：HTTP ${response.status}`)
  const body = await response.text()
  const lines = body.split('\n')
  lines.pop()
  return lines.filter(Boolean).map((line, index) => {
    try {
      return JSON.parse(line)
    } catch {
      throw new Error(`${day} 历史数据第 ${index + 1} 行损坏`)
    }
  })
}

function makeCatalog() {
  const now = Date.now()
  const entries = new Map()
  for (const record of records) {
    if (record.time < now - 86400000) continue
    for (const metric of record.containers) {
      entries.set(metric.id, { ...metric, lastSeen: record.time })
    }
  }
  const currentIDs = new Set(latest?.containers.map((metric) => metric.id) || [])
  for (const metric of latest?.containers || []) {
    entries.set(metric.id, { ...metric, lastSeen: latest.time })
  }
  catalog = [...entries.values()].map((item) => ({
    ...item,
    state: currentIDs.has(item.id) ? item.state : 'removed',
  }))
  catalog.sort((a, b) => {
    if ((a.state === 'running') !== (b.state === 'running')) return a.state === 'running' ? -1 : 1
    return (b.memory_bytes || 0) - (a.memory_bytes || 0) || a.name.localeCompare(b.name)
  })
  if (!catalog.some((item) => item.id === selectedID)) {
    selectedID = catalog[0]?.id || null
  }
}

function renderList() {
  const query = elements.search.value.trim().toLowerCase()
  const visible = catalog.filter((item) => item.name.toLowerCase().includes(query))
  elements.count.textContent = String(catalog.length)
  if (visible.length === 0) {
    const empty = document.createElement('p')
    empty.className = 'list-empty'
    empty.textContent = catalog.length === 0 ? '暂无容器数据' : '没有匹配的容器'
    elements.list.replaceChildren(empty)
    return
  }

  const items = visible.map((item) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = `container-item${item.id === selectedID ? ' active' : ''}`
    button.title = item.name

    const top = document.createElement('div')
    top.className = 'container-item-top'
    const state = document.createElement('span')
    state.className = `mini-state${item.state === 'running' ? ' running' : ''}`
    const name = document.createElement('span')
    name.className = 'container-item-name'
    name.textContent = item.name
    top.append(state, name)

    const values = document.createElement('div')
    values.className = 'container-item-values'
    values.textContent = item.state === 'running'
      ? `CPU ${cpuText(item.cpu_percent)}    内存 ${memoryText(item.memory_bytes)}`
      : stateText(item.state)
    button.append(top, values)
    button.addEventListener('click', () => {
      selectedID = item.id
      renderList()
      renderDetail()
    })
    return button
  })
  elements.list.replaceChildren(...items)
}

function chartColors() {
  const style = getComputedStyle(document.documentElement)
  return {
    text: style.getPropertyValue('--muted').trim(),
    grid: style.getPropertyValue('--grid').trim(),
    cpu: style.getPropertyValue('--cpu').trim(),
    memory: style.getPropertyValue('--memory').trim(),
  }
}

function makePlot(node, readout, color, unit) {
  const colors = chartColors()
  const format = unit === '%' ? cpuText : (value) => `${numberFormat.format(value)} MiB`
  return new uPlot({
    width: node.clientWidth,
    height: 230,
    padding: [12, 10, 0, 0],
    legend: { show: false },
    cursor: { points: { show: false } },
    axes: [
      {
        stroke: colors.text,
        grid: { stroke: colors.grid, width: 1 },
        ticks: { stroke: colors.grid },
        values: (_, values) => values.map((value) => new Date(value * 1000).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })),
      },
      {
        stroke: colors.text,
        grid: { stroke: colors.grid, width: 1 },
        ticks: { stroke: colors.grid },
        values: (_, values) => values.map((value) => Number.isFinite(value) ? numberFormat.format(value) : ''),
      },
    ],
    series: [{}, { label: unit, stroke: color, width: 2, spanGaps: false, points: { show: false } }],
    hooks: {
      setCursor: [(plot) => {
        const index = plot.cursor.idx
        if (index == null) return
        const time = plot.data[0][index]
        const value = plot.data[1][index]
        readout.textContent = `${timeFormat.format(new Date(time * 1000))} · ${value == null ? '无采样' : format(value)}`
      }],
    },
  }, [[], []], node)
}

function createCharts() {
  cpuPlot?.destroy()
  memoryPlot?.destroy()
  const colors = chartColors()
  cpuPlot = makePlot(elements.cpuChart, elements.cpuReadout, colors.cpu, '%')
  memoryPlot = makePlot(elements.memoryChart, elements.memoryReadout, colors.memory, 'MiB')
}

function renderDetail() {
  const selected = catalog.find((item) => item.id === selectedID)
  elements.name.textContent = selected?.name || '请选择容器'
  elements.id.textContent = selected ? selected.id.slice(0, 12) : '—'
  elements.state.textContent = selected ? stateText(selected.state) : '—'
  elements.state.className = `state-badge${selected?.state === 'running' ? ' running' : ''}`
  elements.cpu.textContent = selected?.state === 'running' ? cpuText(selected.cpu_percent) : '—'
  elements.memory.textContent = selected?.state === 'running' ? memoryText(selected.memory_bytes) : '—'

  const now = Date.now()
  const start = now - selectedHours * 3600000
  const times = []
  const cpu = []
  const memory = []
  let previousTime = null
  for (const record of records) {
    if (record.time < start || record.time > now) continue
    const metric = record.containers.find((item) => item.id === selectedID)
    if (!metric) continue
    const time = record.time / 1000
    if (previousTime !== null && time - previousTime > 90) {
      times.push(previousTime + 60)
      cpu.push(null)
      memory.push(null)
    }
    times.push(time)
    cpu.push(metric.cpu_percent)
    memory.push(metric.memory_bytes == null ? null : metric.memory_bytes / 1048576)
    previousTime = time
  }

  cpuPlot.setData([times, cpu])
  memoryPlot.setData([times, memory])
  cpuPlot.setScale('x', { min: start / 1000, max: now / 1000 })
  memoryPlot.setScale('x', { min: start / 1000, max: now / 1000 })
  elements.cpuEmpty.hidden = cpu.some((value) => value != null)
  elements.memoryEmpty.hidden = memory.some((value) => value != null)
  const lastCPU = cpu.findLastIndex((value) => value != null)
  const lastMemory = memory.findLastIndex((value) => value != null)
  elements.cpuReadout.textContent = lastCPU < 0 ? '—' : `${timeFormat.format(new Date(times[lastCPU] * 1000))} · ${cpuText(cpu[lastCPU])}`
  elements.memoryReadout.textContent = lastMemory < 0 ? '—' : `${timeFormat.format(new Date(times[lastMemory] * 1000))} · ${numberFormat.format(memory[lastMemory])} MiB`
}

function renderStatus() {
  elements.status.classList.remove('stale', 'error')
  if (!latest) {
    elements.status.classList.add('stale')
    elements.update.textContent = '等待首次采样'
    return
  }
  const stale = Date.now() - latest.time > 150000
  if (stale) elements.status.classList.add('stale')
  elements.update.textContent = `${stale ? '数据未更新' : '更新于'} ${timeFormat.format(new Date(latest.time))}`
}

async function load() {
  if (loading) return
  loading = true
  try {
    const now = Date.now()
    const [newLatest, yesterday, today] = await Promise.all([
      readLatest(),
      readDay(utcDay(now - 86400000)),
      readDay(utcDay(now)),
    ])
    latest = newLatest
    records = [...yesterday, ...today].sort((a, b) => a.time - b.time)
    makeCatalog()
    renderStatus()
    renderList()
    renderDetail()
    elements.error.hidden = true
  } catch (error) {
    elements.status.classList.add('error')
    elements.update.textContent = '数据读取失败'
    elements.error.textContent = error.message
    elements.error.hidden = false
  } finally {
    loading = false
  }
}

document.querySelectorAll('[data-hours]').forEach((button) => {
  button.addEventListener('click', () => {
    selectedHours = Number(button.dataset.hours)
    document.querySelectorAll('[data-hours]').forEach((item) => item.classList.toggle('active', item === button))
    renderDetail()
  })
})
elements.search.addEventListener('input', renderList)

createCharts()
const resizeObserver = new ResizeObserver(() => {
  cpuPlot.setSize({ width: elements.cpuChart.clientWidth, height: 230 })
  memoryPlot.setSize({ width: elements.memoryChart.clientWidth, height: 230 })
})
resizeObserver.observe(elements.cpuChart)
resizeObserver.observe(elements.memoryChart)
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  createCharts()
  renderDetail()
})
load()
setInterval(load, 60000)
