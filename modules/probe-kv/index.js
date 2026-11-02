/**
 * D4 能力探针（kv:cache 授权）：site.example.probe.kv
 *
 * manifest 声明 log + kv:cache。mount 时验证授权通道真实可用：
 * put → get 往返后 del 清理探针键；同时确认未声明的 http/bridge 仍不可达。
 * 结果写入 window.__KV_PROBE__，供 scripts/e2e-capability.py 断言。
 */
export default {
  async mount(ctx) {
    const out = {
      hasKv: typeof ctx.kv,
      hasHttp: typeof ctx.http,
      hasBridge: typeof ctx.bridge,
      put: null,
      get: null,
      del: null,
    }
    try {
      await ctx.kv.put('module-probe:self-test', 'ok')
      out.put = true
      out.get = await ctx.kv.get('module-probe:self-test')
      await ctx.kv.del('module-probe:self-test')
      out.del = true
    } catch (e) {
      out.error = String((e && e.message) || e)
    }
    window.__KV_PROBE__ = out
    ctx.log(`probe-kv: ${JSON.stringify(out)}`)
  },
}
