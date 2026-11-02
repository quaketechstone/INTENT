/**
 * D4 能力探针（零能力声明）：site.example.probe.nocap
 *
 * manifest 只声明 log。按 LOADER.md §3，未声明能力在代理构造期即被裁剪，
 * 模块侧应拿到 undefined——本模块把探测结果写入 window.__PROBE_RESULT__，
 * 供 scripts/e2e-capability.py 断言「无第二条通道」。
 */
export default {
  mount(ctx) {
    const result = {
      kv: typeof ctx.kv,
      http: typeof ctx.http,
      bridge: typeof ctx.bridge,
      log: typeof ctx.log,
      slots: typeof ctx.slots,
    }
    window.__PROBE_RESULT__ = result
    ctx.log(`probe-nocap: ${JSON.stringify(result)}`)
  },
}
