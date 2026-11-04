const t = (k, p) => globalThis.__INTENT_I18N__?.t?.(k, p) ?? k
/**
 * 示例 Shell Provider：紧凑外壳。
 *
 * 它做的事：把「左侧宽侧栏 + 顶栏」换成「左侧窄图标栏 + 顶部一行」，
 * 内容区仍是母体的视图容器（母体会把 `#view` 搬进 `[data-shell-content]`）。
 *
 * 三条约束（与 SHELL-PROVIDER-CONTRACT.md §3 一致）：
 * 1. **不碰授权**。它没有能力去改判定结果，安全界面也不在它的 DOM 子树里。
 * 2. **导航用 hash**。`<a href="#view=drivers">` 是纯 DOM 行为，母体监听 hashchange。
 *    这正是「外壳不需要任何新能力」的实现方式（架构决策 D-2）。
 * 3. **自己清理**。`unmount` 必须把节点与监听都撤掉——母体回退内置外壳时不会替它清。
 *
 * 它读的两个 DOM 事实：
 * - `ctx.slots['shell.root']` 上的 `data-views`：母体写的导航清单（id/label/icon）；
 * - `location.hash`：当前视图（公开事实，不是权限通道）。
 */

let rootEl = null
let onHash = null

/** 从宿主节点的 data-views 读导航清单；读不到就用一份最小清单。 */
function readViews(host) {
  try {
    const raw = host && host.dataset ? host.dataset.views : ''
    const list = raw ? JSON.parse(raw) : []
    if (Array.isArray(list) && list.length) return list
  } catch {
    /* 解析失败按最小清单处理：外壳不该因为一个属性格式不对就整个不显示 */
  }
  return [
    { id: 'desktop', label: t("shell.compact.shell.label.1") },
    { id: 'drivers', label: t("shell.compact.shell.label.2") },
    { id: 'extensions', label: t("shell.compact.shell.label.3") },
    { id: 'settings', label: t("shell.compact.shell.label.4") },
  ]
}

/** 当前视图 id（从 hash 读；非法值当桌面）。 */
function currentView() {
  try {
    const m = /(?:^#|&)view=([a-z-]+)/.exec(location.hash)
    return m ? m[1] : 'desktop'
  } catch {
    return 'desktop'
  }
}

export async function mount(ctx) {
  const host = ctx.slots && ctx.slots['shell.root']
  if (!host) {
    ctx.log('未获得 shell.root 槽位，外壳无法接管界面')
    return
  }
  const views = readViews(host)

  rootEl = document.createElement('div')
  rootEl.className = 'compact-shell'
  rootEl.innerHTML = `
    <style>
      .compact-shell {
        display: flex; flex-direction: column; height: 100%; min-height: 0;
        background: var(--bg); color: var(--text); font: 13px/1.55 inherit;
      }
      .cs-top {
        display: flex; align-items: center; gap: 12px; flex: none;
        height: 46px; padding: 0 14px; border-bottom: 1px solid var(--line);
        background: var(--surface);
      }
      .cs-brand { font-weight: 700; letter-spacing: -.3px; font-size: 13.5px; }
      .cs-brand i { color: var(--accent); font-style: normal; }
      .cs-crumb { font-size: 12px; color: var(--muted); }
      .cs-hint { margin-left: auto; font-size: 11px; color: var(--subtle); }
      .cs-body { flex: 1; min-height: 0; display: flex; }
      .cs-rail {
        flex: none; width: 58px; display: flex; flex-direction: column; gap: 4px;
        padding: 10px 6px; border-right: 1px solid var(--line); background: var(--surface);
      }
      .cs-rail a {
        display: flex; flex-direction: column; align-items: center; gap: 3px;
        padding: 7px 2px; border-radius: 9px; text-decoration: none;
        color: var(--muted); font-size: 10px; line-height: 1.2; text-align: center;
      }
      .cs-rail a svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.7; }
      .cs-rail a:hover { background: var(--surface-2); color: var(--text); }
      .cs-rail a[aria-current="page"] { background: var(--accent-soft); color: var(--accent); font-weight: 650; }
      .cs-content { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; overflow-y: auto; }
      /* 母体搬进来的节点需要撑满内容区 */
      .cs-content > * { min-height: 0; }
      .cs-content #view { flex: 1; }
    </style>
    <div class="cs-top">
      <span class="cs-brand">intent<i>.</i>os</span>
      <span class="cs-crumb" data-cs-crumb></span>
      <span class="cs-hint">${t('shell.compact.shell.text.1')}</span>
    </div>
    <div class="cs-body">
      <nav class="cs-rail" aria-label="${t('mother.shell.html.aria.1')}"></nav>
      <main class="cs-content" data-shell-content></main>
    </div>
  `

  const rail = rootEl.querySelector('.cs-rail')
  const crumb = rootEl.querySelector('[data-cs-crumb]')
  for (const v of views) {
    const a = document.createElement('a')
    a.href = `#view=${encodeURIComponent(v.id)}`
    a.dataset.csNav = v.id
    a.innerHTML = `<svg aria-hidden="true"><use href="#${v.icon || 'i-desktop'}"/></svg><span>${v.label}</span>`
    rail.append(a)
  }

  const sync = () => {
    const cur = currentView()
    for (const a of rail.querySelectorAll('a')) {
      if (a.dataset.csNav === cur) a.setAttribute('aria-current', 'page')
      else a.removeAttribute('aria-current')
    }
    const found = views.find((v) => v.id === cur)
    if (crumb) crumb.textContent = found ? found.label : ''
  }
  sync()
  onHash = sync
  // 监听 hashchange 只为高亮，不参与导航——导航是浏览器对 <a href="#..."> 的默认行为。
  window.addEventListener('hashchange', onHash)

  host.append(rootEl)
  ctx.log('紧凑外壳已接管界面')
}

/** 必须幂等：母体回退时可能先调 unmount 再 destroy，也可能只调其中一个。 */
export function unmount() {
  if (onHash) {
    window.removeEventListener('hashchange', onHash)
    onHash = null
  }
  rootEl?.remove()
  rootEl = null
}

export function describe() {
  return { id: 'ext.example.compact-shell', mounted: rootEl !== null }
}
