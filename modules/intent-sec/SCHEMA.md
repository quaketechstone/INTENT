# INT-RLSD 安全协议契约（SCHEMA）

| 项 | 值 |
|---|---|
| 契约名称 | INT-RLSD 安全协议契约（SecurityRequest / SecurityDecision / Receipt） |
| 契约版本 | `schema_version = 1.0.0`（对应模块 `version 0.0.1`） |
| 项目 | INT-RLSD（INTENTOS-root level security driver），模块 id `intent.sec.kernel` |
| 派发书 | `DISPATCH-INTENT-SEC-001`（字段名冻结源：§6） |
| 母体实测 | `INT-RLSD/docs/HOST-FACTS.md`（HOST_VERSION 0.1.12、能力目录、ns 白名单） |
| 纪律 | R14 契约包纪律 `_source / _checked / _note / expected`（对齐 `docs/loader/*.json`） |
| 状态 | **P1 定稿（冻结件）** —— 冻结后字段增删改须回本文档登记 |
| 定稿日期 | 2026-10-24 |

> **规范原文缺口声明**：《INTENT-OS 安全驱动 v0.0.1》原文（S-01~S-15 完整条文）**未随派发书交付**。本契约只机读化派发书中**明示引用**的条文（S-01/03/04/06/07/08/09/11/13/15），其余（S-02/S-05/S-10/S-12/S-14）在默认策略集中标 `UNKNOWN_PENDING_SPEC`，**不臆造条文**（派发书 §2 纪律：不要虚构本文之外的能力）。原文到位后按 A15 版本链增补并升 `policy_version`。

---

## 0. 本文档的三类结论：冻结 / 裁决 / 澄清

| 类型 | 含义 | 处置 |
|---|---|---|
| **冻结（FREEZE）** | 派发书 §6 逐字给定 | 不得改动，改即违约 |
| **裁决（DECISION，编号 D-x）** | 派发书未明示，由开发方按规范原则裁决，写入本文档 | 装配评审时复核；母体/派发方可推翻 |
| **澄清（CLARIFY，编号 C-x）** | 与派发书表述存在歧义，需派发方确认 | 记入 GAPS.md，不阻塞开发，按裁决值先行实现 |

---

## 1. SecurityRequest（schema 必校验，未知字段拒绝）

来源：派发书 §6.1（冻结）。十字段齐全、类型正确、`requested_capabilities` ⊆ 已知能力目录、`constraints.valid_until` 缺省不得当永久有效；未知字段 → `format` 拒绝（S-03：字段多不等于权利多）。

### 1.1 字段表

| # | 字段 | 类型 | 必填 | 校验规则 | 违反后果 |
|---|---|---|---|---|---|
| 1 | `request_id` | string | ✅ | uuidv4 正则 `^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`（大小写不敏感） | `format` 拒绝 |
| 2 | `subject_ref` | string | ✅ | 非空；**声明式引用，不是身份证明**（派发书 §6.1 原注） | `format` 拒绝 |
| 3 | `driver_ref` | string | ✅ | 非空；同上 | `format` 拒绝 |
| 4 | `operation` | string | ✅ | 非空；取值见 §4 操作目录 | 未知 operation **不在 schema 层拒绝**，交 Capability Guard 默认拒绝（裁决 D2） |
| 5 | `target_ref` | string \| null | ✅（可为 null） | null 或非空字符串 | 非此二者 → `format` 拒绝 |
| 6 | `input_digest` | string | ✅ | `sha256hex(规范化输入)`，64 位十六进制 | `format` 拒绝 |
| 7 | `requested_capabilities` | string[] | ✅ | 数组（可为空）；每项 ∈ 已知能力目录（§4.1） | 含未知能力 → `format` 拒绝 |
| 8 | `policy_context` | string | ✅ | 非空；策略集 id | `format` 拒绝 |
| 9 | `constraints` | object | ✅ | 键只允许 `scope` / `budget` / `valid_until`（裁决 D3）；结构见 §1.2 | 未知键 → `format` 拒绝 |
| 10 | `evidence_refs` | string[] | ✅ | 数组（可为空）；每项非空字符串 | `format` 拒绝 |

**顶层未知字段**：任何不在上表 10 项内的键 → `format` 拒绝（S-03）。空数组/空对象不视为缺失。

### 1.2 `constraints` 子结构

| 键 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `scope` | object | ❌ | 允许键 `namespaces` / `operations` / `resources`（均为 string[]）。**缺失 = 无显式范围 → 判定层按 S-01 拒绝**（派发书 §5.3：拒绝隐式权限继承与转授，显式字段缺失即拒） |
| `budget` | object | ❌ | 允许键见 §1.3，值必须为非负 number。缺失 = 不申明预算，判定层按默认预算校验 |
| `valid_until` | number | ❌ | epoch 毫秒。**缺省时不得当永久有效** → 按策略 `defaults.ttl_ms` 计（`ttl_source="policy_default"`），并在 `SecurityDecision.required_constraints` 中显式标注（裁决 D4）。已过期 → 判定层 `EXPIRED` |

### 1.3 `constraints.budget` 允许键（对齐 §5 配额表六项）

`storage_bytes` / `requests_per_min` / `timers` / `detail_bytes` / `dom_nodes` / `cold_start_ms` —— 全部非负 number，未知键 → `format` 拒绝。

### 1.4 输入规范化（摘要可复现的前提，A06）

1. 字段按 §1.1 的 1→10 顺序排列；
2. 数组内字符串按字典序排序（`requested_capabilities`、`evidence_refs`）；
3. `constraints` / `scope` / `budget` 内键按字典序排序；
4. `null` 保留，不省略；
5. JSON 序列化后取 UTF-8 字节的 `SHA-256`，输出 64 位小写十六进制。

> 摘要实现：浏览器用 `crypto.subtle.digest('SHA-256')`（Web 平台 API，非宿主能力，派发书 §5.6 允许）；node 单测侧用 `node:crypto` 适配，**三处（build / verify / digest）算法必须一致**。

---

## 2. SecurityDecision

来源：派发书 §6.2（冻结）。

| # | 字段 | 类型 | 说明 |
|---|---|---|---|
| 1 | `request_id` | string | 与请求一致 |
| 2 | `status` | string | 状态枚举之一（§3）。主链十态 + 六终态 |
| 3 | `allowed_operations` | string[] | **只列实际授权范围内**的操作，不得宽列 |
| 4 | `denied_operations` | string[] | 与 allowed 互斥 |
| 5 | `applicable_policy_refs` | string[] | 本次判定实际命中的策略条目 id（可追溯，A06） |
| 6 | `authorization_refs` | string[] | 授权依据引用（本地授权记录 key 等） |
| 7 | `required_constraints` | object[] | 放行时必须满足的约束（含 `ttl_source` 标注） |
| 8 | `missing_evidence` | string[] | 缺证清单；第 10 步人工确认缺证填 `["human_approval"]` |
| 9 | `conflicts` | string[] | 冲突条目（公理/策略/版本） |
| 10 | `valid_until` | number \| null | **仅在失效语义已定义时**填；否则 null |
| 11 | `decision_evidence_ref` | string | kv 中本判定的存证 key（A06 实测项） |

**禁止**（派发书 §6.2 末段）：把私钥 / 长期凭证 / 无限权限句柄写进任何字段。

---

## 3. 判定状态机（§6.4）与状态枚举

### 3.1 主链十态（派发书 §6.4 原文顺序，冻结）

```
RECEIVED
  → SCHEMA_VALIDATION
  → IDENTITY_AND_ARTIFACT_CHECK
  → AUTHORIZATION_CHECK
  → AXIOM_AND_POLICY_CHECK
  → RESOURCE_AND_CONSTRAINT_CHECK
  → AUTHORIZED_FOR_EXECUTION
  → EXECUTION_BY_APPROVED_COMPONENT
  → RECEIPT_AND_EVIDENCE
  → VERIFICATION
```

### 3.2 终态（任一步失败 / 冲突 / 缺证，冻结：不得静默继续）

`DENIED` / `CONFLICT` / `PENDING` / `UNAVAILABLE` / `EXPIRED` / `REVOKED`

| 终态 | 触发 |
|---|---|
| `DENIED` | 默认拒绝命中（S-01）、未授权、伪造、摘要不符、越权 |
| `CONFLICT` | 公理/策略冲突、策略版本不兼容、**非法状态转换** |
| `PENDING` | 缺证据待补：第 10 步人工确认（`missing_evidence:["human_approval"]`）、`anchor.signature` 存在但无签名验证体系 |
| `UNAVAILABLE` | 信任依赖不可用（信任锚配置缺失，T-11）——**不得默认放行** |
| `EXPIRED` | 凭证/授权到期（`constraints.valid_until` 过期或凭证过期） |
| `REVOKED` | 撤销清单 `sec:v1:revoked` 命中 |

> **澄清 C1**：派发书 §6.2 称 status 取「规范 §3.2 十枚举之一」，但 §6.4 主链恰好十态，而 T-05（过期→EXPIRED、撤销→REVOKED）、T-11（UNAVAILABLE）要求 status 能表达更多取值。**裁决**：`status ∈ 主链十态 + 六终态（共 16 值）`；「十枚举」指主链十态。规范原文到位后复核。

### 3.3 `transition(state, event)` 转换表

| from | event | to | 备注 |
|---|---|---|---|
| `RECEIVED` | `schema_ok` | `SCHEMA_VALIDATION` | |
| `RECEIVED` | `schema_fail` | `DENIED` | 终态 |
| `SCHEMA_VALIDATION` | `identity_ok` \| `identity_conditional` | `IDENTITY_AND_ARTIFACT_CHECK` | CONDITIONAL 允许继续但须标注 |
| `SCHEMA_VALIDATION` | `digest_mismatch` \| `manifest_forged` | `DENIED` | 并落事件 |
| `SCHEMA_VALIDATION` | `anchor_unavailable` | `UNAVAILABLE` | T-11 |
| `SCHEMA_VALIDATION` | `signature_unverifiable` | `PENDING` | 无签名体系，不得假装通过 |
| `IDENTITY_AND_ARTIFACT_CHECK` | `credential_ok` | `AUTHORIZATION_CHECK` | |
| `IDENTITY_AND_ARTIFACT_CHECK` | `credential_expired` | `EXPIRED` | T-05 |
| `IDENTITY_AND_ARTIFACT_CHECK` | `credential_revoked` | `REVOKED` | T-05 |
| `AUTHORIZATION_CHECK` | `authorized` | `AXIOM_AND_POLICY_CHECK` | 六要素通过 |
| `AUTHORIZATION_CHECK` | `unauthorized` \| `scope_missing` | `DENIED` | S-01 |
| `AXIOM_AND_POLICY_CHECK` | `axioms_ok` | `RESOURCE_AND_CONSTRAINT_CHECK` | |
| `AXIOM_AND_POLICY_CHECK` | `axiom_conflict` \| `policy_version_conflict` | `CONFLICT` | T-06 |
| `RESOURCE_AND_CONSTRAINT_CHECK` | `budget_ok` | `AUTHORIZED_FOR_EXECUTION` | |
| `RESOURCE_AND_CONSTRAINT_CHECK` | `budget_exceeded` | `DENIED` | + `recordOverrun`（T-08） |
| `RESOURCE_AND_CONSTRAINT_CHECK` | `constraint_expired` | `EXPIRED` | |
| `AUTHORIZED_FOR_EXECUTION` | `execute` | `EXECUTION_BY_APPROVED_COMPONENT` | **母体 loader 消费到此为止** |
| `AUTHORIZED_FOR_EXECUTION` | `human_approval_missing` | `PENDING` | 第 10 步，不得跳过 |
| `EXECUTION_BY_APPROVED_COMPONENT` | `execution_reported` | `RECEIPT_AND_EVIDENCE` | 执行结果由母体报告 |
| `RECEIPT_AND_EVIDENCE` | `receipt_built` | `VERIFICATION` | |
| `VERIFICATION` | `verified` \| `unverified` | 终态保持 | 回执 `execution_status` 区分 |
| **任意** | **未在上表登记的事件** | **`CONFLICT`** | 非法转换 → CONFLICT（§5.4 冻结），不得静默继续 |
| **终态** | 任意 | **终态自身** | 终态不可再推进 |

---

## 4. 目录与能力

### 4.1 已知能力目录（`requested_capabilities` 的白名单）

| 能力 | 来源 | v0.0.1 状态 |
|---|---|---|
| `log` | 母体 `CAPABILITY_CATALOG.prefixes` | 模块已声明 |
| `bridge:read` | 母体 `CAPABILITY_CATALOG.prefixes` | 模块**未声明**（S-09 本地化，不申请） |
| `kv:cache` | 母体 `CAPABILITY_CATALOG.kvNs` | 模块已声明（降级 ns） |
| `kv:skills` | 母体 `CAPABILITY_CATALOG.kvNs` | 模块未声明 |
| `kv:sec` | **派发书 §4.3 新增** | 模块已声明；母体未授权 → B2/B3 阻断，降级 `kv:cache` + `sec:` 前缀 |

> 目录 = 母体实测目录 ∪ 派发书申请的 `kv:sec`。**不在表内 → `format` 拒绝**。

### 4.2 已知操作目录（`operation`）

`module.load` / `module.unload` / `capability.use` / `policy.change` / `artifact.verify` / `receipt.issue` / `kv.read` / `kv.write` / `timer.create` / `dom.render`

> 派发书 §6.1 举例 `'module.load' | 'capability.use' | 'policy.change' | ...`。**裁决 D2**：schema 层只校验非空字符串，未知 operation 交由 Capability Guard 按 S-01 默认拒绝（而非 format 拒绝）——理由是"字段多/值未知不等于权利多"在能力面已由 §4.1 卡死，操作面应保留策略可判定空间，且 T-02「未授权操作 → DENIED」需要判定层产出 DENIED 而非 format 错误。

### 4.3 执行状态三枚举（Receipt.execution_status，冻结）

`DECLARED` / `EXECUTION_UNVERIFIED` / `VERIFIED_LOCAL` —— **默认 `EXECUTION_UNVERIFIED`**（客户端无可信执行环境）。门放行 ≠ 执行成功（派发书 §5.4/§11-7）。

---

## 5. Receipt（十字段，派发书 §6.3 冻结）

| # | 字段组 | 实际字段 | 类型 | 说明 |
|---|---|---|---|---|
| 1 | request_id | `request_id` | string | 与请求一致 |
| 2 | subject_ref + driver_ref | `subject_ref`, `driver_ref` | string, string | 引用，非身份证明 |
| 3 | request_digest | `request_digest` | string | sha256hex(规范化 SecurityRequest)，§1.4 |
| 4 | policy_ref + version | `policy_ref`, `policy_version` | string, string | 判定依据可复盘（A06） |
| 5 | authorization_result | `authorization_result` | string | 主链终态 status |
| 6 | execution_status | `execution_status` | string | 三枚举，默认 `EXECUTION_UNVERIFIED` |
| 7 | io_summary | `io_summary` | object | `{ kv_reads, kv_writes, events, bytes }`，只记计数不记内容；**口径见 §5.2** |
| 8 | evidence_refs | `evidence_refs` | string[] | 引用，不存正文 |
| 9 | time + time_source | `time`, `time_source` | number, string | `time_source` 固定 `"client_untrusted"` |
| 10 | unverified_items | `unverified_items` | string[] | 未验证项如实列出（A14） |

**`verifyReceipt(receipt, request, decision)` 必须校验**（派发书 §5.6）：
1. `receipt.request_id === request.request_id === decision.request_id`；
2. `receipt.request_digest === sha256hex(规范化 request)`；
3. `receipt.authorization_result === decision.status`；
4. `receipt.policy_ref/version` 与 `decision.applicable_policy_refs` 可对应。

任一条不符 → `false`。

### 5.1 第 4 条「可对应」的精确定义（2026-10-24 澄清，U-JOINT-1）

`applicable_policy_refs` 是**判定依据引用列表**，元素为字符串，允许两类：

| 形态 | 示例 | 含义 |
|---|---|---|
| 策略引用 | `policy:<policy_id>@<policy_version>` | 本次判定实际采用的策略及其版本 |
| 公理引用 | `S-09` | 本次判定引用的具体公理/规则编号 |

**对应规则**：`receipt.policy_ref`（策略 id）必须能在 `applicable_policy_refs` 中找到至少一个元素，
使该元素**以 `policy:<policy_ref>@` 为前缀**（等价于 `includes(policy_ref)` 且该元素以 `policy:` 开头）。
仅含公理编号（如 `['S-09']`）不满足第 4 条——因为无法据此复盘「用了哪份策略的哪一版」。

**实现约束**：判定函数在返回任何终态（放行/拒绝/待确认）时，`applicable_policy_refs`
**必须**至少包含一条 `policy:<id>@<ver>`。该校验对放行与拒绝**同等执行**，
不得因列表为空而跳过（历史实现曾在放行路径跳过，等于该条从未生效）。

### 5.2 `io_summary` 计数口径（2026-10-24 澄清，U-JOINT-4）

四个字段均为**本次判定操作**（单次 `judge` 调用）产生的计数，**不是**模块生命周期累计值：

| 字段 | 口径 |
|---|---|
| `kv_reads` | 本次判定为检查重放而读取存储的次数（有 kv 能力时 1，否则 0） |
| `kv_writes` | 本次判定写入回执的次数（回执成功落盘即为 1） |
| `events` | 本次判定追加到事件流的事件数（judge 事件计 1） |
| `bytes` | 本次判定涉及的 IO 字节量；**驱动未真实执行时为 0**，不得以回执自身体积等自指值填充 |

累计统计（面板「KV 读/写」）由模块自身 `usage` 维护，与回执 `io_summary` 是两套口径，
不得互相代入。

**隐私（S-11）**：回执与事件**只存摘要与引用**，禁止明文用户数据、请求正文、他模块数据。

---

## 6. 双轨交付定义（用户 2026-10-24 拍板：双轨）

| 轨 | 名称 | manifest | 用途 | 装载结论 |
|---|---|---|---|---|
| **A 轨** | 正式交付件 | 派发书冻结契约：`min_host="0.2.0"`，`capabilities=["log","kv:sec"]`（单 ns 声明，双态隔离待母体暴露 `__ns` 后生效） | 交付 / 装配 / 验收（A01–A15） | 母体 0.1.12 下 **BLOCKED**（B1 版本门 + B2 `kv:sec` 未授权），如实记录 |
| **B 轨** | 联调变体 | `min_host="0.1.12"`，`capabilities=["log","kv:cache"]`，kv 走 `sec:` 前缀降级 | P3–P5 的 e2e 现在就能真跑，不空等母体排期 | **ACTIVE**（已实证） |

**两轨共用同一份 `index.js` 逻辑**（七模块代码完全一致），差异只在 `manifest.json` 与 kv 前缀策略：
- kv 访问封装：`kv:sec` 可用 → `sec:v1:*`；否则 `kv:cache` + `sec:` 前缀（两态行为一致，双态都测）；
- v0.0.1 交付包内 `manifest.json` 为 **A 轨**；B 轨 manifest 由 e2e 脚本在测试站点就地生成（`INT-RLSD/scripts/`），**不进交付包**。

---

## 7. 裁决与澄清登记（待装配评审复核）

| 编号 | 类型 | 内容 |
|---|---|---|
| **D1** | 裁决 | 「十枚举」= 主链十态；`status` 实取 16 值（见 C1） |
| **D2** | 裁决 | 未知 `operation` 不在 schema 层拒绝，交判定层 DENIED |
| **D3** | 裁决 | `constraints` 只允许 `scope`/`budget`/`valid_until` 三键，未知键 format 拒绝 |
| **D4** | 裁决 | `valid_until` 缺省 → 套用策略 `defaults.ttl_ms` 并标 `ttl_source="policy_default"`，永不解释为永久有效 |
| **D5** | 裁决 | `constraints.scope` 缺失 → 判定层 DENIED（非 format 拒绝），落实"拒绝隐式继承与转授" |
| **C1** | 澄清 | 派发书「十枚举」与 T-05/T-11 的 EXPIRED/REVOKED/UNAVAILABLE 取值冲突（见 §3.2） |
| **C2** | 澄清 | S-02/S-05/S-10/S-12/S-14 条文原文缺失 → 默认策略集标 `UNKNOWN_PENDING_SPEC` |
| **C3** | 澄清 | 派发书「manifest 十字段」vs 母体 `validateManifest` 实测 9 项 → 以母体源码 9 项为准（B6 已消解） |

---

*本文件是 D3 交付物（`web/public/modules/intent-sec/SCHEMA.md`）的定稿源，存于 `INT-RLSD/spec/`，装配时随交付树复制。字段冻结后任何变更须同时升 `schema_version` 并在 ACCEPTANCE.md 登记。*
