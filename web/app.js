const elements = {
  status: document.getElementById('update-status'),
  update: document.getElementById('update-text'),
  error: document.getElementById('error-message'),
  grid: document.getElementById('resource-grid'),
  scrollPrev: document.getElementById('scroll-prev'),
  scrollNext: document.getElementById('scroll-next'),
  count: document.getElementById('container-count'),
  search: document.getElementById('container-search'),
  list: document.getElementById('container-list'),
  name: document.getElementById('selected-name'),
  kind: document.getElementById('selected-kind'),
  state: document.getElementById('selected-state'),
  showHost: document.getElementById('show-host'),
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
let selectedID = 'host'
let records = []
let catalog = []
let latest = null
let cpuPlot
let memoryPlot
let sharedCPUMax = 5
let sharedMemoryMax = 256
let hostMemoryMax = 1
let loading = false
let historyLoaded = false

const numberFormat = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2, minimumFractionDigits: 2 })
const timeFormat = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
})
const axisTimeFormat = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit' })

function cpuText(value) {
  return value == null ? '—' : `${numberFormat.format(value)}%`
}

function memoryText(value) {
  if (value == null) return '—'
  return value >= 1073741824
    ? `${numberFormat.format(value / 1073741824)} GiB`
    : `${numberFormat.format(value / 1048576)} MiB`
}

function stateText(state) {
  const names = { running: '运行中', exited: '已停止', paused: '已暂停', created: '已创建', restarting: '重启中' }
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
  catalog = [...(latest?.containers || [])]
  catalog.sort((a, b) => {
    if ((a.state === 'running') !== (b.state === 'running')) return a.state === 'running' ? -1 : 1
    return (b.memory_bytes || 0) - (a.memory_bytes || 0) || a.name.localeCompare(b.name)
  })
  if (selectedID !== 'host' && !catalog.some((item) => item.id === selectedID)) {
    selectedID = 'host'
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
    updateGridRows()
    requestAnimationFrame(updateScrollButtons)
    return
  }

  const items = visible.map((item) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = `resource-card container-item${item.id === selectedID ? ' active' : ''}`
    button.title = item.name
    button.setAttribute('aria-pressed', String(item.id === selectedID))

    const top = document.createElement('div')
    top.className = 'card-top'
    const name = document.createElement('strong')
    name.className = 'card-name'
    name.textContent = item.name
    const status = document.createElement('span')
    status.className = 'card-state'
    const state = document.createElement('span')
    state.className = `mini-state${item.state === 'running' ? ' running' : ''}`
    status.append(state, stateText(item.state))
    top.append(name, status)

    const values = document.createElement('div')
    values.className = 'card-metrics'
    values.append(...metricLabels(item.state === 'running' ? item.cpu_percent : null, item.state === 'running' ? item.memory_bytes : null))
    button.append(top, values)
    button.addEventListener('click', () => {
      selectedID = selectedID === item.id ? 'host' : item.id
      renderList()
      renderDetail()
    })
    return button
  })
  elements.list.replaceChildren(...items)
  updateGridRows()
  requestAnimationFrame(updateScrollButtons)
}

function updateGridRows() {
  const columns = innerWidth <= 650 ? 1 : innerWidth <= 1150 ? 2 : 4
  elements.grid.classList.toggle('single-row', elements.list.querySelectorAll('.container-item').length <= columns)
}

function updateScrollButtons() {
  const max = elements.grid.scrollWidth - elements.grid.clientWidth
  elements.scrollPrev.disabled = elements.grid.scrollLeft <= 1
  elements.scrollNext.disabled = elements.grid.scrollLeft >= max - 1
}

function metricLabels(cpu, memory) {
  return [['CPU', cpuText(cpu)], ['内存', memoryText(memory)]].map(([label, value]) => {
    const metric = document.createElement('span')
    const caption = document.createElement('small')
    const amount = document.createElement('strong')
    caption.textContent = label
    amount.textContent = value
    metric.append(caption, amount)
    return metric
  })
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
    height: node.clientHeight,
    padding: [12, 10, 0, 0],
    legend: { show: false },
    cursor: { points: { show: false } },
    scales: { y: { range: () => {
      if (selectedID === 'host') return [0, unit === '%' ? 100 : hostMemoryMax]
      return [0, unit === '%' ? sharedCPUMax : sharedMemoryMax]
    } } },
    axes: [
      {
        stroke: colors.text,
        grid: { stroke: colors.grid, width: 1 },
        ticks: { stroke: colors.grid },
        values: (_, values) => values.map((value) => axisTimeFormat.format(new Date(value * 1000))),
      },
      {
        size: unit === '%' ? 54 : 82,
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
  const isHost = selectedID === 'host'
  const selected = isHost ? latest?.host : catalog.find((item) => item.id === selectedID)
  elements.kind.textContent = isHost ? '宿主机' : '当前容器'
  elements.name.textContent = isHost ? '宿主机' : selected?.name || '请选择容器'
  elements.id.textContent = isHost
    ? `含系统进程与容器 · 总内存 ${memoryText(selected?.memory_total_bytes)}`
    : selected ? selected.id.slice(0, 12) : '—'
  elements.state.textContent = isHost ? '本机' : selected ? stateText(selected.state) : '—'
  elements.state.className = `state-badge${isHost || selected?.state === 'running' ? ' running' : ''}`
  elements.showHost.hidden = isHost
  elements.cpu.textContent = isHost || selected?.state === 'running' ? cpuText(selected?.cpu_percent) : '—'
  elements.memory.textContent = isHost || selected?.state === 'running' ? memoryText(selected?.memory_bytes) : '—'

  const now = Date.now()
  const start = now - selectedHours * 3600000
  if (isHost) {
    const total = selected?.memory_total_bytes ?? records.findLast((record) => record.host)?.host.memory_total_bytes
    hostMemoryMax = total == null ? 1 : total / 1048576
  } else {
    const currentIDs = new Set(catalog.map((item) => item.id))
    let cpuPeak = 0
    let memoryPeak = 0
    for (const record of records) {
      if (record.time < start || record.time > now) continue
      for (const item of record.containers) {
        if (!currentIDs.has(item.id)) continue
        if (item.cpu_percent != null) cpuPeak = Math.max(cpuPeak, item.cpu_percent)
        if (item.memory_bytes != null) memoryPeak = Math.max(memoryPeak, item.memory_bytes / 1048576)
      }
    }
    if (latest && latest.time >= start && latest.time <= now) {
      for (const item of catalog) {
        if (item.cpu_percent != null) cpuPeak = Math.max(cpuPeak, item.cpu_percent)
        if (item.memory_bytes != null) memoryPeak = Math.max(memoryPeak, item.memory_bytes / 1048576)
      }
    }
    sharedCPUMax = Math.max(5, Math.ceil(cpuPeak * 1.4))
    sharedMemoryMax = Math.max(256, Math.ceil(memoryPeak * 1.4 / 64) * 64)
  }
  const times = []
  const cpu = []
  const memory = []
  let previousTime = null
  for (const record of records) {
    if (record.time < start || record.time > now) continue
    const metric = isHost ? record.host : record.containers.find((item) => item.id === selectedID)
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
    const newLatest = await readLatest()
    const lastTime = records.at(-1)?.time
    if (!historyLoaded || (newLatest && (!lastTime || newLatest.time - lastTime > 90000 || utcDay(newLatest.time) !== utcDay(lastTime)))) {
      const [yesterday, today] = await Promise.all([
        readDay(utcDay(now - 86400000)),
        readDay(utcDay(now)),
      ])
      records = [...yesterday, ...today].filter((record) => record.time >= now - 86400000).sort((a, b) => a.time - b.time)
      historyLoaded = true
    } else if (newLatest && newLatest.time > lastTime) {
      records.push(newLatest)
      records = records.filter((record) => record.time >= now - 86400000)
    }
    latest = newLatest
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
elements.showHost.addEventListener('click', () => {
  selectedID = 'host'
  renderList()
  renderDetail()
})
document.addEventListener('click', (event) => {
  if (selectedID === 'host' || event.target.closest('button, input, label, a')) return
  selectedID = 'host'
  renderList()
  renderDetail()
})
elements.scrollPrev.addEventListener('click', () => elements.grid.scrollBy({ left: -elements.grid.clientWidth * 0.8, behavior: 'smooth' }))
elements.scrollNext.addEventListener('click', () => elements.grid.scrollBy({ left: elements.grid.clientWidth * 0.8, behavior: 'smooth' }))
elements.grid.addEventListener('scroll', updateScrollButtons)
new ResizeObserver(updateScrollButtons).observe(elements.grid)
addEventListener('resize', updateGridRows)

let dragStart = null
let dragged = false
elements.grid.addEventListener('pointerdown', (event) => {
  if (event.pointerType !== 'mouse' || event.button !== 0 || elements.grid.scrollWidth <= elements.grid.clientWidth) return
  dragStart = { x: event.clientX, left: elements.grid.scrollLeft }
  dragged = false
})
document.addEventListener('pointermove', (event) => {
  if (!dragStart) return
  const distance = event.clientX - dragStart.x
  if (Math.abs(distance) <= 5 && !dragged) return
  dragged = true
  elements.grid.scrollLeft = dragStart.left - distance
  event.preventDefault()
})
document.addEventListener('pointerup', () => { dragStart = null })
elements.grid.addEventListener('click', (event) => {
  if (!dragged) return
  event.preventDefault()
  event.stopPropagation()
  dragged = false
}, true)

createCharts()
const resizeObserver = new ResizeObserver(() => {
  cpuPlot.setSize({ width: elements.cpuChart.clientWidth, height: elements.cpuChart.clientHeight })
  memoryPlot.setSize({ width: elements.memoryChart.clientWidth, height: elements.memoryChart.clientHeight })
})
resizeObserver.observe(elements.cpuChart)
resizeObserver.observe(elements.memoryChart)
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  createCharts()
  renderDetail()
})
load()
setInterval(load, 60000)
