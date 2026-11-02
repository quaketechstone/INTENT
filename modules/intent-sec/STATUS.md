# STATUS.md — INT-RLSD（intent.sec.kernel v0.0.1）实现状态

> 三态纪律（派发书 §11-3 / 计划 §1.1）：**已实现 / 未实现·显式降级 / 未验证**。
> 凡未真正具备的安全能力一律标 **MISSING / UNKNOWN / PARTIAL / GAP**，不得用"模拟实现"冒充生产级。
> 整体验收预期：**PARTIAL**——如实交付 PARTIAL 即达标，伪装 ACCEPTED 即拒收。
> 基线：母体 `0.2.2`（联调基线 `9fc5120`）；本文件每条均可在 `index.js` / `tests/kernel.test.js` 对应验证。
> 冻结状态：**已解除**（2026-10-24 21:16，用户指令）；解除前的验收结论见 `docs/JOINT-ACCEPTANCE-20261024.md`。

---

## 一、已实现（功能闭环，node 单测覆盖）

| 能力 | 实现 | 验证 | 状态 |
|---|---|---|---|
| SecurityRequest 校验（S-03 未知字段 format 拒绝） | `validateRequest` | T-01 | ✅ 已实现 |
| 十态状态机 + 转换表（非法边→CONFLICT，终态不可推进） | `transition` / `CHAIN_STATES` / `TERMINAL_STATES` | X-01 | ✅ 已实现 |
| 策略内核（装载/公理/冲突/VERSION/摘要） | `loadPolicy` / `checkAxioms` / `policyDigest` | T-06 / X-01 | ✅ 已实现 |
| 身份与产物验证（sha256 / manifest / 信任锚 / min_host） | `verifyArtifact` / `verifyArtifactWithDigest` / `verifyCredential` | T-03 / T-04 / T-05 / T-11 | ✅ 已实现 |
| 能力守卫（默认拒绝 / 六要素 / 撤销 / 期限 / 拒绝隐式转授） | `checkCapability` | T-02 / T-07 | ✅ 已实现 |
| 资源守卫（六项配额校验 + 超限落证） | `checkBudget` / `recordOverrun` | T-08 | ✅ 已实现 |
| 证据与回执（十字段 / 三执行状态 / 可验证 / 脱敏） | `buildReceipt` / `verifyReceipt` / `exportEvents` | T-10 / T-13 | ✅ 已实现 |
| 安全诊断（原因 + 缺失证据 + 复现信息） | `diagnose` / `diagnoseLast` | T-07 / T-13 | ✅ 已实现 |
| 意图门（十步 + 重放防御 + 人工确认 PENDING） | `judge` / `judgeSync` | T-01~T-13 | ✅ 已实现 |
| 装载层（幂等 mount / unmount / onDispose 清理） | 默认导出 `mod` | T-12（node 侧） | ✅ 已实现（node 侧） |
| settings.section 安全分区 UI（策略只读 / 信任锚 / 配额三态 / 十枚举 / 审批提示） | `renderPanel` | B 轨无头浏览器实证 | ✅ 已实现（联调态） |
| kv 双态降级（sec:v1: ↔ cache+sec:） | `mount.keyPrefix` 选择 | T-12 / HOST-FACTS §五 vc | ✅ 已实现 |
| 默认策略集 v1.0.0（S-01/03/04/06/07/08/09/11/13/15 机读化，硬公理不可覆盖） | `DEFAULT_POLICY` | T-06 / X-01 | ✅ 已实现 |

---

## 二、未实现 · 显式降级（MISSING / PARTIAL / GAP——如实披露）

| 能力（规范预期） | v0.0.1 实际状态 | 降级措施 / 边界 | 状态标记 |
|---|---|---|---|
| 沙箱隔离（R13） | 静态融合型=同源运行时，代码审计是唯一防线；仅本地静态来源 | 文档明示；不自动装载远程模块 | **MISSING** |
| 签名 / 信任锚验证体系 | 无真实签名验证；`trust.signature_verification='MISSING'`；有签名字段→PENDING 不假装通过 | 信任锚配置明示"非全球信任根"，身份结论上限 CONDITIONAL | **MISSING** |
| 动态授权 / 撤销通道 | 授权源=本地策略副本（`grants`）；撤销=本地清单 `revoked`；无运行时通道 | 结论必标作用范围（S-06） | **MISSING** |
| 强制配额执行 | 只能"校验 + 记录 + 上报"，**不能中断执行**（母体无强制配额） | 超限事件落 `sec:v1:events`，UI 能力边界面板对用户可见 | **PARTIAL** |
| 人工确认 UI 机制 | 第十步返回 PENDING + `missing_evidence:['human_approval']`，落面板提示；母体无确认机制 | 不跳过；PENDING 提示见 settings.section | **MISSING** |
| 策略热更新 UI | 策略随包 + kv 覆盖；设置页只读展示 | 不提供热更新编辑器 | **PARTIAL** |
| 可信时间源 | 回执 `time_source='client_untrusted'` | 时间仅作记录，不作安全判定依据 | **MISSING** |
| WASM 内存上限 / 单次执行时长 / 并发数 | 规范未定义，模块不臆造 | `quotas.undefined_no_guessing` 显式列出，标 GAP | **GAP** |
| ~~真实装载到 ACTIVE（母体 0.1.12 下）~~ | 已在母体 `0.2.2` 下装载至 **ACTIVE**（2026-10-24 联调 J1/J2） | 原 B1/B2 卡口解除；`kv:sec` 已授权，`keyPrefix=sec:v1:` | **已解除**（原 BLOCKED） |

---

## 三、未验证（NOT_RUN / 环境受限，如实标注）

| 项 | 说明 | 当前状态 |
|---|---|---|
| A07 回执与真实执行关联（e2e 落盘读取） | 函数层 T-10 PASS；联调 J7/J7b 实测回执落盘 `sec:v1:receipt:*`、自验通过、篡改即 false | **函数 PASS / 集成 PASS** |
| A10 浏览器侧生命周期销毁残留佐证 | node 侧 T-12 PASS；联调 J9/J11 实测 destroy→DESTROYED、节点摘除、门面抛 `ModuleDestroyedError`、二次幂等 | **node PASS / 浏览器 PASS** |
| 线上 VERSION 对照 | 产物中无 `SITE_VERSION_URL` 字面量；联调站点可能无 `VERSION` 文件 | **NOT_APPLICABLE**（见 e2e 第 7 项） |

---

## 四、配额执行状态逐行标注（计划 S5.3 / A09）

> 纪律：v0.0.1 **全部只能 DECLARED**（预算校验 + 超限落事件 + UI 可见），**不得写"已强制"**。未定义项标 GAP，不臆造。

| 配额项 | 限值 | enforcement | 说明 |
|---|---|---|---|
| `storage_bytes` 存储 | 10 MiB (10485760) | **DECLARED** | 校验 + 记录；不中断 |
| `requests_per_min` 请求频率 | 60 次/分钟 | **DECLARED** | 同上 |
| `timers` 定时器 | 50 | **DECLARED** | 自管，受 `onDispose` 清理 |
| `detail_bytes` detail 体积 | 64 KiB (65536) | **DECLARED** | 同上 |
| `dom_nodes` DOM 节点 | 5000 | **DECLARED** | 面板受控渲染 |
| `cold_start_ms` 冷启 | 200 ms | **DECLARED** | 仅声明，非硬中断 |
| `WASM 内存上限` | — | **GAP** | 规范未定义，不臆造 |
| `单次执行时长` | — | **GAP** | 同上 |
| `并发数` | — | **GAP** | 同上 |

> 上述六项 DECLARED 已通过 `T-08`（超 `requests_per_min`→拒 + 落证）验证，并在 settings.section **能力边界面板**对用户可见（非仅文档声明），满足 A09 四步 + T-08 + STATUS.md 三项证据。

---

*本文件状态随母体版本/白名单推进与实测复测更新；任何"未实现"项不得改写为"已实现"。*
