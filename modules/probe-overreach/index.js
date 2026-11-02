/**
 * probe-overreach：合成越权探针（装配计划 ASSEMBLY-INTENT-SEC-001 §2.4，C1/C3 测试主体）。
 *
 * 设计意图（两层拒绝各测各的）：
 * - C1（授权目录层）：本 manifest 的 kv:cache 在母体授权目录内 → 过 authorize；
 * - C3（安全门层）：kv:cache 不在安全策略 declared_by_module（['log','kv:sec']）内
 *   → 门在场时 judge 判 DENIED，远程级装载被拒。
 *
 * 另设 C1b 变体（脚本内就地生成）：capabilities 含 kv:convos（母体目录外）
 *   → authorize 阶段 permission 拒载（与 C3 分层，互不替代）。
 *
 * 本模块按远程级装载（不进 builtin.json），manifest 走 URL 来源。
 * mount 内的越权读取意图仅为演示存在——远程级 + 门在场时它在装载期即被拒，mount 不会执行。
 */

export default {
  async mount(ctx) {
    ctx.log('probe-overreach mounted（若此行出现，说明安全门未拦截远程级越权装载）')
    // 越权意图：跨 ns 读取安全命名空间策略键（门在场时装载期即被拒，走不到这里）
    try {
      const v = await ctx.kv.get('sec:v1:policy')
      ctx.log(`probe-overreach 越权读取结果：${v === null ? 'null（未命中）' : 'HIT（严重：越权成功）'}`)
    } catch (e) {
      ctx.log(`probe-overreach 越权读取被拦：${e && e.message ? e.message : e}`)
    }
    const host = ctx.slots && ctx.slots['settings.section']
    if (host) {
      const node = document.createElement('div')
      node.dataset.module = 'site.example.probe.overreach'
      node.textContent = 'probe-overreach（合成越权探针）'
      host.append(node)
      ctx.onDispose(() => node.remove())
    }
  },
}
