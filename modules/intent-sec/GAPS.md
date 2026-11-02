# GAPS.md — INT-RLSD（intent.sec.kernel v0.0.1）缺口与降级

> 原则（派发书 §11 / 计划 §1.1）：
> - **缺口全部来自母体侧或规范侧**，本项目**不得自行修改母体**（`S-13` 硬公理 `host_core_modification_allowed:false`）；
> - 每个缺口必须写出**后果**与**驱动的降级措施**，不得粉饰为"已实现"；
> - 凡规范未定义、母体未提供的能力，**显式 GAP，不臆造**。
> 配套：AUDIT.md（R1–R16）、STATUS.md（三态 + 配额）、ACCEPTANCE.md（A01–A15）。

---

## 一、母体能力缺口（R1–R16 中的 MISSING/PARTIAL）

| # | 缺口 | 后果（对安全驱动） | 驱动的降级措施 |
|---|---|---|---|
| G1 | **R13 无沙箱**（静态融合型=同源运行时） | 模块与宿主同运行时，"可信"仅指代码经审计，无隔离兜底 | 仅本地静态来源（`modules/intent-sec/`，不自动装载远程模块）；代码审计是唯一防线；文档明示（STATUS R13 / AUDIT R13） |
| G2 | **无签名 / 信任锚验证体系** | 身份结论上限 `CONDITIONAL`；存在签名字段却无验证能力→不得假装通过 | `trust.signature_verification='MISSING'`；有签名字段→`PENDING`（不假装）；信任锚配置明示"非全球信任根"；`VERIFIED` 路径保留但 v0.0.1 不可达 |
| G3 | **无动态授权 / 撤销通道** | 授权=静态白名单（本地策略副本 `grants`）；撤销=本地清单 `revoked`；运行时无法动态授予/撤回 | 授权结论必标作用范围（S-06）；`revoked` 本地数组 + 扫描定时器清理；明确声明"授权源=本地策略副本，母体无动态授权通道" |
| G4 | **无强制配额**（母体不中断执行） | 只能"校验 + 记录 + 上报"，**不能中断越权执行** | 超限事件落 `sec:v1:events`（`recordOverrun`，`enforcement:'DECLARED'`）；settings.section 能力边界面板对用户可见；六配额全部 `DECLARED`，绝不写"已强制" |
| G5 | **无人工确认 UI 机制** | 第十步无法完成人工确认，只能返回 PENDING | `human_approval_operations=['policy.change']`→`PENDING` + `missing_evidence:['human_approval']`；落面板"待人工确认"提示；不跳过（不伪造通过） |
| G6 | **时间源不可信** | 回执/事件时间戳不可作为安全判定依据（可被客户端篡改） | 回执/事件 `time_source='client_untrusted'`；时间仅作记录，不参与任何拒绝/放行判定 |
| G7 | **R2 设计令牌 PARTIAL / R12 主题 MISSING** | 无统一设计体系可复用，UI 不能假设设计语言 | UI 只用内联样式 + CSS 变量（`var(--fg)/var(--border)`），跟随宿主 `data-theme`，不自建主题、不引入 UI 依赖 |

---

## 二、装载阻断缺口（历史：曾导致 A 轨 BLOCKED，2026-10-24 已解除）

| # | 缺口（母体侧） | 后果 | 驱动的降级措施 |
|---|---|---|---|
| B1 | `min_host=0.2.0` vs 母体 `0.1.12` | `validate/version` 拒载 | **已解除**（母体升至 0.2.x，2026-10-24 复测 ACTIVE） |
| B2 | `kv:sec` 不在 loader 能力白名单 `kvNs` | `authorize/permission` 拒载 | **已解除**（`kv:sec` 已授权，`__ns=sec`，`keyPrefix=sec:v1:`） |
| B3 | `sec` 不在 8 ns 白名单（`host/mod.rs`） | 底层 `bad_namespace` | **已解除**（`sec` 已入白名单，实测写入成功） |
| B4 | 新模块不在 `sw.js` precache | 缓存策略不确定 | **已处置**（构建时重建 SW，`modules/**/*.js` 进 precache；e2e 仍关 SW 旁路验证） |

> 上述 B1–B4 均属派发书 §10.2 母体维护者职责；本项目不越权修改 `contract.ts` / `host/mod.rs` / `sw.js`。

---

## 三、规范与契约缺口

| # | 缺口 | 后果 | 降级措施 |
|---|---|---|---|
| G8 | **S-02 / S-05 / S-10 / S-12 / S-14 条文原文未提供** | 无法机读化这几条安全公理 | `DEFAULT_POLICY.axioms` 中对应条目标 `status:'UNKNOWN_PENDING_SPEC'`，值 `null`，**不臆造**条文（与派发书 §6 纪律一致） |
| G9 | **WASM 内存上限 / 单次执行时长 / 并发数 未定义** | 无法强制这三类配额 | 列入 `quotas.undefined_no_guessing`，Status 标 **GAP**；不写假数值 |
| G10 | **宿主真实 `destroy` 的 `onDispose` 触发约定**（见 §三·G13 与 HOST-FACTS §8.3 已确认机制） | 真实 `L.destroy('intent.sec.kernel')` 对 URL 来源装载静默无操作（registry/disposer 同用 `idOf(mid)`，但 `load({url})` 的 registry key=URL、`destroy(id)` 按 id 查表未命中即早退） | 模块自身 `unmount()` / `onDispose` 清理逻辑已 node 验证正确（T-12）；B 轨 e2e 走对象来源（key=id）故 destroy 正常；母体修复排期中（registry re-key），不阻塞交付 |
| G11 | **`ctx.hostVersion` 母体不存在**（接口假设） | 模块 `mount` 内 `loadPolicy(raw, { hostVersion: ctx.hostVersion })` 读取；母体 `ModuleCtx`（`web/src/loader/types.ts`）无此字段，运行时恒为 undefined；版本门判定实际依赖策略 `host_min` 而非 ctx 注入 | 已 `isNonEmptyString` 容错（缺失则不参与放行/拒绝）；母体计划加法式增加该字段（装配步③）；驱动侧仅记录，按纪律显式 GAP |
| G12 | **`kv.__ns` 母体不暴露 + 仅认第一个 ns**（接口假设 + 双态失效） | 模块用 `kv.__ns === 'sec'` 探测双态，母体 kv 代理不暴露 `__ns`（探测恒 false）；且代理所有操作走 `asStoreName(nsList[0])`，**只认声明的第一个 ns**——A 轨曾声明 `[cache,sec]` 时即使批准 sec 也全落 cache，双态隔离空转 | A 轨 manifest 改为单 ns 声明 `["log","kv:sec"]`，与母体代理实现精确匹配；双态检测待母体暴露 `__ns` 后真实生效；当前全跑降级（cache + `sec:` 前缀），功能可用 |

---

## 四、降级纪律小结（不得违反）

1. **不越权改母体**：所有 G1–G7、B1–B4 的"根因修复"都在母体侧，驱动只做**诚实降级**。
2. **不臆造能力**：G8/G9 的未知项标 UNKNOWN/GAP，绝不以"模拟实现"冒充。
3. **不伪装状态**：A 轨曾因 B1/B2 BLOCKED，如实记（已于 2026-10-24 解除，现为 ACTIVE）；配额只标 DECLARED，不写已强制。
4. **门放行≠执行成功**：`AUTHORIZED_FOR_EXECUTION` 仅代表"门放行"，回执默认 `EXECUTION_UNVERIFIED`（G6 时间源亦不可信）。

---

*本文件随母体升版（0.2.0）、`sec` ns 授权、规范条文补齐而持续更新；每关闭一项即在对应行标注"已闭合 + 复测证据"。*
