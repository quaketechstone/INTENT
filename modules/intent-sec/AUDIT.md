# AUDIT.md — INT-RLSD（intent.sec.kernel v0.0.1）安全审计

> 配套依据：[HOST-FACTS.md](../../../docs/HOST-FACTS.md)（母体源码级实测）、[SCHEMA.md](./SCHEMA.md)（字段冻结）、[INT-RLSD-产品开发计划.md](../../../docs/INT-RLSD-产品开发计划.md)。
> 纪律：**不推测、不造假**。R1–R16 的"母体预填状态"来自 HOST-FACTS 实测；"安全驱动侧使用结论"是本项目对每一项的实际用法与边界。
> 采集基线：母体 `HOST_VERSION=0.2.2`（联调基线 `9fc5120`）；模块 `0.0.1`；派发书 `DISPATCH-INTENT-SEC-001`。
> 历史采集：§三 的装载结论最初采于 `0.1.12`，2026-10-24 已复测并更新。

---

## 一、R1–R16 母体能力 × 安全驱动侧使用结论

状态缩写：AVAILABLE 可用 / PARTIAL 部分可用 / MISSING 缺失 / UNKNOWN 未知。

| # | 母体能力 | 母体预填状态 | 安全驱动侧**使用结论**（v0.0.1 实际用法） | 证据 |
|---|---|---|---|---|
| R1 | 组件注册表 | AVAILABLE（只读快照） | 不读注册表；驱动以独立 ES Module 装载，仅消费自身三接口 | `index.js` 无 `registry` 访问 |
| R2 | 设计令牌 | PARTIAL（无统一体系） | UI 只用**内联样式 + CSS 变量**（`var(--fg)/var(--border)`），跟随宿主 `data-theme`；不自建主题、不假设设计体系 | `renderPanel` 的 `S` 样式表 |
| R3 | WASM 引擎 | MISSING | 驱动**不直接调用 WASM**；安全判定为纯 TS/JS 逻辑，零 wasm 依赖 | `index.js` 无 wasm 调用 |
| R4 | StateBus | PARTIAL（只读桥两方法） | 不依赖 StateBus；状态自管于模块 `STATE`（闭包），判定纯函数不读共享总线 | `judgeSync` 无总线调用 |
| R5 | CommandBus | MISSING | 不使用；驱动只"判定+记录"，不发起命令 | — |
| R6 | EventBus | MISSING | 不使用；事件以 `sec:v1:events` 结构化落 kv + `exportEvents` 脱敏导出 | `appendEvent` / `exportEvents` |
| R7 | Storage（IndexedDB ns） | PARTIAL（仅 `cache`/`skills`，缺 `sec`） | **双态**：`kv:sec` 获批→`sec:v1:` 前缀；未获批→降级 `kv:cache` + `sec:` 前缀；两态行为一致已测 | `mount` 的 `keyPrefix` 选择；T-08；HOST-FACTS §五 vc |
| R8 | Network | AVAILABLE（http 仅 localhost） | **零 http**：v0.0.1 A 轨声明 `[log,kv:sec]`（B 轨联调变体声明 `[log,kv:cache]`），不申请 net 能力；摘要/回执全本地 | `manifest.capabilities`；`S-09` |
| R9 | Log | AVAILABLE | `ctx.log` 记录装载/判定/事件；通道失败不冒泡（S-08） | `appendEvent` 的 `st.log` |
| R10 | Notify | MISSING | 不使用；PENDING/拒载结论落入面板与事件，不弹通知 | — |
| R11 | Timer | PARTIAL（自管 setInterval + onDispose） | 撤销/TTL 扫描定时器（`≥60s`），经 `ctx.onDispose` 注册清理；A10 验证 | `startScanTimer`；T-12 |
| R12 | Theme | MISSING | 不使用主题 API；跟随宿主 CSS 变量 | 同 R2 |
| R13 | 沙箱 | MISSING（静态融合型=同源运行时） | **无沙箱**：代码审计是唯一防线；驱动仅本地静态来源，不自动装载远程模块 | STATUS.md / GAPS.md R13 |
| R14 | 契约包 | AVAILABLE | SCHEMA.md 对齐 `_source/_checked/_note/expected` 纪律；manifest 九字段冻结 | `SCHEMA.md`；HOST-FACTS §四（B6 以源码 9 项为准） |
| R15 | 装载调度 | AVAILABLE | 依赖宿主十一阶段链路；`sha256` 不符在 verify 拒载；A 轨已在 0.2.2 下 ACTIVE（原 min_host/kv:sec 卡口解除） | HOST-FACTS §五 |
| R16 | 依赖代理 | PARTIAL（v0.0.1 `deps` 必须 `{}`） | `deps={}`；不做任何依赖代理 | `manifest.deps` |
| R17 | `ctx.hostVersion` | MISSING（母体 `ModuleCtx` 无此字段） | 模块 `mount` 读 `ctx.hostVersion` 作版本门参考，母体未提供→恒 undefined；已 `isNonEmptyString` 容错，不依赖其放行/拒绝；母体计划加法式扩展（装配步③） | GAPS.md G11 |

---

## 二、十步判定 × 母体装载链路映射

`judgeSync`（纯函数、`index.js` 第 9 节）编排十步，**每一步一个确定结论**，不读时钟/不读 kv/不抛异常（异常转 `UNAVAILABLE`/`CONFLICT`）。与母体装载链路的职责划分：

| 判定步 | 检查内容 | 模块内实现 | 母体是否已有卡口 | 驱动职责 |
|---|---|---|---|---|
| 步骤 1 | schema 校验 | `validateRequest`（未知字段→format 拒绝，S-03） | ✅ loader `validateManifest` 校验九字段 | 复核 + 记录 `applicable_policy_refs:S-03` |
| 步骤 2 | 来源记录 | `subject_ref`/`driver_ref` 声明式引用（非身份证明） | ✅ 代理构造时授权 | 记录 `authorization_refs`，标注"非身份证明" |
| 步骤 3 | 摘要复核 | `canonicalJSON` + 自描述判定；不可复算则标 `input_digest_not_recomputable` | ❌ 母体不复核请求摘要 | 驱动新增（可追溯 A06） |
| 步骤 4 | 能力白名单 | `checkCapability`（六要素 + 撤销 + 期限，S-01 默认拒绝） | ✅ loader `capabilityAllowed` | 复核 + 记录 `S-01/S-09` |
| 步骤 5 | 策略授权 | 本地策略副本（无动态授权通道） | ❌ 母体无策略层 | 驱动新增（结论标作用范围 S-06） |
| 步骤 6 | 公理与策略版本 | `checkAxioms`（冲突→CONFLICT，不挑有利规则） | ❌ 母体不校验策略公理 | 驱动新增（T-06） |
| 步骤 7 | 预算校验 | `checkBudget`（DECLARED：超限记录不中断） | ❌ 母体无强制配额 | 驱动新增（A09；超限事件落证 T-08） |
| 步骤 8 | 凭证验证 | `verifyCredential`（VERIFIED/EXPIRED/REVOKED/PENDING） | ❌ 母体无凭证体系 | 驱动新增（T-05） |
| 步骤 9 | 回执准备 | `buildReceipt` 默认 `EXECUTION_UNVERIFIED`（门放行≠执行成功） | ❌ 母体不生成安全回执 | 驱动新增（T-10；S-07/S-11） |
| 步骤 10 | 人工确认 | `human_approval_operations=['policy.change']` → PENDING + `missing_evidence:['human_approval']` | ❌ 母体无人工确认机制（MISSING） | 驱动新增（不得跳过，落面板提示） |

> 步骤 0（重放防御）：同 `request_id` 已有回执 → 幂等 `DENIED`（T-09）。状态机见 SCHEMA.md：`transition(state,event)` 含 22 条合法边，非法边→`CONFLICT`，终态不可再推进。

---

## 三、装载链路实证结论（母体 0.2.2；原 0.1.12 结论保留为历史对照）

| 变体 | manifest 关键字段 | 实测结果 | 结论 |
|---|---|---|---|
| A 轨（正式件） | `min_host=0.2.0` + `[log,kv:sec]` | 0.2.2 实测 **ACTIVE**；`keyPrefix=sec:v1:`（`__ns=sec` 已暴露） | **ACTIVE**（原 BLOCKED 已解除） |
| A 轨（仅版本门） | `min_host=0.2.0`，`[log,kv:cache]` | 0.1.12 下曾 `FAILED @ validate/version`（B1）；0.2.2 下版本门已通过 | **已解除**（历史对照） |
| B 轨（联调变体） | `min_host=0.1.12`，`[log,kv:cache]` | **ACTIVE**，mount 正常 | 装载链路通畅 ✅ |
| 完整性反例 | sha256 填 64 个 0 | `FAILED @ verify/format: 完整性校验失败` | 卡口生效 ✅ |

> B 轨变体**不进交付包**，仅用于 v0.1.12 下的开发联调，与 A 轨正式件严格隔离（见 GAPS.md / e2e 脚本头注释）。

---

## 四、自检（对照计划 §1.1 八条红线）

1. 未改母体核心/契约/loader/白名单 —— ✅ 仅交付 `web/public/modules/intent-sec/` 树 + `scripts/e2e-intent-sec.py`（A11）。
2. 未申请白名单外能力、未访问未声明 ns、未摸全局对象 —— ✅ 能力三件套冻结；`http`/`bridge` 为 `undefined`；无 `indexedDB`/`fetch`/`window.__QUAKE_LOADER__` 直读（HOST-FACTS §五 vc `ctx` 面）。
3. 未实现能力标 MISSING/UNKNOWN/PARTIAL —— ✅ R3/R5/R6/R10/R12/R13 明确 MISSING；S-02/05/10/12/14 原文缺失→`UNKNOWN_PENDING_SPEC`（不臆造）。
4. 测试状态无 PASS 造假 —— ✅ 五态纪律；A轨 BLOCKED 如实记；A07/A10 的浏览器佐证标 NOT_RUN。
5. AI 不覆盖确定性拒绝 —— ✅ `judgeSync` 为确定性纯函数；`S-07` 公理 `ai_override_allowed:false` 硬编码。
6. 回执/事件只存摘要不存明文 —— ✅ `buildReceipt`/`exportEvents` 仅存 `digest`/`reference`，`S-11` 校验（T-13）。
7. 门放行不宣称执行成功 —— ✅ 回执 `execution_status` 默认 `EXECUTION_UNVERIFIED`；`AUTHORIZED_FOR_EXECUTION` 语义在 UI/文档明示。
8. 单文件交付 —— ✅ `index.js` 单文件（42 命名导出 + 默认导出 `{mount,unmount}`），无次级源文件（SCHEMA §4.2）。

---

*本文件只记录本项目对母体能力的实际用法与装载实证，不作母体能力的外推推测。母体版本或白名单变更后须重新采集。*
