const t = (k, p) => globalThis.__INTENT_I18N__?.t?.(k, p) ?? k
/**
 * 示范动态模块：site.example.hello
 *
 * 证明装载全链路：mount(ctx) 收到能力代理与挂载槽位；
 * 清理走 ctx.onDispose（母体 DESTROYED 前统一执行且只跑一次）。
 * 本文件是纯静态 ES Module（不经 vite 打包），只能使用 ctx 提供的能力。
 */
export default {
  mount(ctx) {
    ctx.log('hello: mounted')
    const host = ctx.slots['settings.section']
    if (!host) {
      ctx.log('hello: 没有拿到 settings.section 槽位，降级为不渲染')
      return
    }
    const box = document.createElement('div')
    box.className = 'module-hello'
    box.dataset.module = 'site.example.hello'
    box.textContent = t("module.hello.module.text.2")
    host.append(box)

    // 演示「卸载≠隐藏」：定时器必须在 DESTROYED 前真正停掉
    let ticks = 0
    const timer = window.setInterval(() => {
      ticks += 1
      ctx.log(`hello: tick ${ticks}`)
    }, 5000)

    ctx.onDispose(() => {
      window.clearInterval(timer)
      box.remove()
      ctx.log('hello: disposed（定时器与 DOM 已清理）')
    })
  },
  unmount() {
    // 主动卸载钩子；幂等保证由母体 disposer 集负责
  },
}
