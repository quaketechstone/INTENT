/**
 * 示例 UI 插件：计数面板。
 *
 * 这个插件的用途不是「有用」，是**演示边界**：
 * 它展示了 UI 插件能做什么（渲染自己的界面、读写 kv:cache、注册清理回调），
 * 也展示了它做不到什么（读不到渠道、会话、联网、碰核心槽位）。
 *
 * 约束（与 UI-PLUGIN-CONTRACT.md §3 一致）：
 * - 不碰 `window` / `document.body` / `localStorage` / `indexedDB` / 裸 `fetch`；
 * - 所有节点建在自己的根节点下，卸载时整棵移除；
 * - 样式加 `.hello-plugin` 前缀，避免污染母体与其他插件。
 */

const NS = 'hello'
const KEY_COUNT = 'count'

/** 模块级状态：母体按 id 幂等装载，同一时刻只有一个实例。 */
let rootEl = null
let count = 0

/**
 * 往槽位里渲染。
 *
 * `ctx.slots` 里没有目标槽位是**正常情况**（母体没注册这个槽位，或没授予），
 * 此时安静退出并把原因写进日志——不要抛错，那会让整个插件变成 FAILED，
 * 而真实情况只是「没地方画」。
 */
export async function mount(ctx) {
  const slot = ctx.slots && ctx.slots['plugin.slot.hello']
  if (!slot) {
    ctx.log('未获得 plugin.slot.hello 槽位，跳过渲染（能力不受影响）')
    return
  }

  const kv = ctx.kvNs && ctx.kvNs.cache
  if (kv) {
    try {
      const saved = await kv.get(KEY_COUNT)
      if (typeof saved === 'number' && Number.isFinite(saved)) count = saved
    } catch (e) {
      ctx.log(`读取缓存失败（按 0 继续）：${String(e && e.message ? e.message : e)}`)
    }
  }

  rootEl = document.createElement('div')
  rootEl.className = 'hello-plugin'
  rootEl.innerHTML = `
    <style>
      .hello-plugin { font: 13px/1.6 inherit; color: var(--text); display: flex; flex-direction: column; gap: 8px; }
      .hello-plugin h3 { margin: 0; font-size: 13.5px; font-weight: 650; display: flex; align-items: center; gap: 8px; }
      .hello-plugin .hp-tag {
        font-size: 10.5px; font-weight: 650; padding: 1px 7px; border-radius: 999px;
        background: var(--status-ok-bg); color: var(--status-ok-fg); border: 1px solid var(--status-ok-line);
      }
      .hello-plugin p { margin: 0; color: var(--muted); font-size: 12px; }
      .hello-plugin .hp-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
      .hello-plugin .hp-num {
        font-size: 26px; font-weight: 650; letter-spacing: -.6px;
        font-variant-numeric: tabular-nums; min-width: 42px;
      }
      .hello-plugin button {
        border: 1px solid var(--line); background: var(--surface); color: var(--text);
        border-radius: 8px; min-height: 30px; padding: 0 12px; font-size: 12.5px; cursor: pointer;
      }
      .hello-plugin button:hover { border-color: var(--accent); color: var(--accent); }
      .hello-plugin .hp-note { font-size: 11px; color: var(--subtle); }
    </style>
    <h3>示例插件 <span class="hp-tag">已装载</span></h3>
    <p>它只有一个槽位（plugin.slot.hello）和两项能力（log、kv:cache）。计数存在 kv:cache 里，刷新后还在。</p>
    <div class="hp-row">
      <span class="hp-num" data-hp-count>0</span>
      <button type="button" data-hp-inc>+1</button>
      <button type="button" data-hp-reset>清零</button>
    </div>
    <p class="hp-note" data-hp-note></p>
  `

  const numEl = rootEl.querySelector('[data-hp-count]')
  const noteEl = rootEl.querySelector('[data-hp-note]')

  const paint = () => {
    if (numEl) numEl.textContent = String(count)
    if (noteEl) {
      noteEl.textContent = kv
        ? '计数已持久化到 kv:cache'
        : '没有 kv:cache 授权，计数只在内存里'
    }
  }

  const persist = async () => {
    if (!kv) return
    try {
      await kv.put(KEY_COUNT, count)
    } catch (e) {
      ctx.log(`写入缓存失败：${String(e && e.message ? e.message : e)}`)
    }
  }

  rootEl.querySelector('[data-hp-inc]')?.addEventListener('click', () => {
    count += 1
    paint()
    void persist()
  })
  rootEl.querySelector('[data-hp-reset]')?.addEventListener('click', () => {
    count = 0
    paint()
    void persist()
  })

  paint()
  slot.append(rootEl)

  // 清理回调：母体在 DESTROYED 前统一执行，保证只跑一次。
  // 同时实现 unmount：两条路径都可能先到（母体 destroy 与显式 unmount），
  // 所以清理逻辑必须幂等——这是 LOADER 契约的要求，不是可选项。
  ctx.onDispose(() => {
    rootEl?.remove()
    rootEl = null
  })
}

/** 母体调用；必须幂等（可能没 mount 过，也可能已被 disposer 清过）。 */
export function unmount() {
  rootEl?.remove()
  rootEl = null
}

/** 诊断信息（母体实验室可读）。 */
export function describe() {
  return { id: 'ext.example.hello', mounted: rootEl !== null, count }
}
