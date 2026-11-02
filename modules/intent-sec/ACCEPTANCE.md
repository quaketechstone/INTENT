# ACCEPTANCE.md — INT-RLSD（intent.sec.kernel v0.0.1）自验收

> 五态纪律：**PASS / FAIL / BLOCKED / NOT_RUN / NOT_APPLICABLE**。
> 证据形态：文件路径 + 测试输出（`node --test` / e2e）+ 源码行，不接受口头宣称。
> 整体结论：**PARTIAL**——功能单元全部 PASS；A 轨已在母体 `0.2.x` 下装载至 **ACTIVE**（2026-10-24 联调实测，B1/B2 卡口解除）；未闭合项见 `GAPS.md`（签名锚 / 动态授权 / 强制配额 / 审批 UI / 时间源）。
> 配套：AUDIT.md（R1–R16）、STATUS.md（三态 + 配额）、GAPS.md（缺口与降级）、SCHEMA.md（字段冻结）。

---

## 一、A01–A15 逐条对照

| 编号 | 条件 | 结论 | 证据 | 备注 |
|---|---|---|---|---|
| A01 | 能创建并校验安全请求 | **PASS** | `tests/kernel.test.js` T-01；`SCHEMA.md` 字段表 + `validateRequest` | 未知字段/未知能力/未知键→format 拒绝 |
| A02 | 受保护操作确定性授权检查 | **PASS** | T-02；`checkCapability` 源码（默认拒绝 S-01） | 未知操作 `nuke.everything`→DENIED |
| A03 | 未授权操作被可靠拒绝 | **PASS** | T-02 / T-03 / T-07 | 越权 ns（convos）→DENIED + `missing_evidence` |
| A04 | 签名和摘要验证有真实测试 | **PASS** | T-04（`verifyArtifact` 摘要不符→DENIED） | 三处 SHA-256 算法一致（build/verify/digest） |
| A05 | 策略/公理冲突显式返回 | **PASS** | T-06 / T-11 | 硬公理不可覆盖→CONFLICT；VERSION 冲突显式；信任锚缺失→UNAVAILABLE |
| A06 | 判定含可追溯依据 | **PASS** | T-09 / T-13；`judge` 写 `decision_evidence_ref`；`policyDigest` 确定性（X-01） | 输入摘要 + 策略版本 + 判定路径可复盘 |
| A07 | 关键操作生成与真实执行关联的回执 | **PASS**（函数）/ 集成 **PASS** | T-10；`e2e-intent-sec-joint` J7/J7b（回执落盘 `sec:v1:receipt:*`、verifyReceipt 通过、篡改 `authorization_result` 即 false、拒绝回执亦可自验） | 2026-10-24 联合调试实测；期间修正 IO 层绕过 `buildReceipt` 导致自验必失败的缺陷（见 `docs/JOINT-DEBUG-intent-sec-20261024.md` §4.4） |
| A08 | 凭证有效期与撤销机制经过验证 | **PASS** | T-05 | EXPIRED / REVOKED / PENDING 全覆盖 |
| A09 | 配额能力缺口已明确披露 | **PASS** | `STATUS.md` 配额章节（六项 DECLARED + 三项 GAP）；T-08 + e2e 第 4 项面板可见 | 满足配额四步 + T-08 + STATUS 三项证据 |
| A10 | 生命周期与副作用清理经过测试 | **PASS**（node）/ 集成 **PASS** | T-12；`e2e-intent-sec-joint` J9/J11（destroy→DESTROYED、节点摘除、门面抛 `ModuleDestroyedError`、二次幂等；重装同 id 单记录、面板唯一） | 2026-10-24 联合调试实测，真实 `destroy` 无残留 |
| A11 | 母体未被未经授权修改 | **PASS** | `git diff` 仅触及 `INT-RLSD/`（§4.1 目录树）与 `scripts/e2e-intent-sec.py` | 未触碰 `web/src`、`crates`、`check.sh`、`LOADER.md`、`sw.js`、`contract.ts`、`host/mod.rs` |
| A12 | R1–R16 均有状态和证据 | **PASS** | `AUDIT.md` 第一节（每项含"母体预填状态 + 安全驱动侧使用结论 + 证据"） | — |
| A13 | 构建/测试/安全扫描/依赖材料完整 | **PASS** | `node --test` **14/14 PASS**（T-01~T-13 + X-01）；零 npm 依赖声明（`package.json` `type:module`，无 `dependencies`）；e2e 脚本语法校验通过 | 模块本身零依赖；e2e 仅 dev 期依赖 playwright |
| A14 | 未解决风险没有被隐藏 | **PASS** | `GAPS.md`（R13/签名锚/动态授权/强制配额/审批UI/时间源 + 每缺口"后果+降级"）；`STATUS.md` 三态齐全（MISSING/UNKNOWN/PARTIAL/GAP/BLOCKED） | 无"模拟实现冒充生产级" |
| A15 | 源码/契约/产物/测试版本可追溯 | **PASS** | `manifest.json` 的 `sha256=38bdc3e77b6586ee012a652b2f44f6421e2c6adb864f565847d42dea9e37b672` 经 `sha256sum index.js` **实测一致**（联调后重算）；`version=0.0.1`；`_dispatch=DISPATCH-INTENT-SEC-001` | 三者可对账 |

---

## 二、整体验收结论

```
整体状态：PARTIAL（如实）
- 功能单元：A01~A15 全部 PASS（A07/A10 的浏览器集成佐证已于 2026-10-24 联合调试补齐）
- 装载态：A 轨正式件在母体 0.2.x 下 **ACTIVE**（2026-10-24 联调；原 0.1.12 下的 B1/B2 卡口已解除）
- 已收敛项：母体 0.2.0 + kv:sec 授权后 A 轨 **ACTIVE**，A07/A10 集成佐证复测 PASS
- 未收敛项：GAPS.md 所列签名锚 / 动态授权 / 强制配额 / 审批 UI / 时间源仍未闭合，故整体仍记 PARTIAL
```

---

## 三、八条红线自检（派发书 §11 / 计划 §1.1）

| # | 红线 | 自检结果 |
|---|---|---|
| 1 | 不改母体核心/契约/loader/白名单 | ✅ PASS（A11） |
| 2 | 不申请白名单外能力 / 不访问未声明 ns / 不摸全局对象 | ✅ PASS（能力三件套冻结；`ctx` 面 `http`/`bridge=undefined`；无 `indexedDB`/`fetch`/`__QUAKE_LOADER__` 直读） |
| 3 | 未验证能力必须标 MISSING/UNKNOWN/PARTIAL | ✅ PASS（R3/R5/R6/R10/R12/R13 MISSING；S-02/05/10/12/14 UNKNOWN_PENDING_SPEC；配额 DECLARED/PARTIAL；WASM 内存等 GAP） |
| 4 | 测试状态禁止 PASS 造假 | ✅ PASS（五态纪律；BLOCKED/NOT_RUN 如实记） |
| 5 | AI 不得覆盖确定性拒绝 | ✅ PASS（`judgeSync` 确定性纯函数；`S-07` 硬编码） |
| 6 | 回执/事件只存摘要不存明文 | ✅ PASS（`S-11`；T-13 脱敏导出） |
| 7 | 门放行不宣称执行成功 | ✅ PASS（回执默认 EXECUTION_UNVERIFIED；UI/文档明示） |
| 8 | 单文件交付 | ✅ PASS（`index.js` 单文件，42 命名导出 + 默认导出，无次级源文件） |

---

## 四、git diff 审计范围（A11 佐证）

> 本交付包提交后，`git diff --stat` 应仅包含以下路径（计划 §4.1 / §2.1 允许范围）：

```
INT-RLSD/docs/                         # 计划、HOST-FACTS（项目文档）
INT-RLSD/spec/                         # P1 契约冻结件
INT-RLSD/delivery/web/public/modules/intent-sec/   # D1 index.js / D2 manifest.json / D3 SCHEMA.md
                                                  # D4 tests/ / D6 AUDIT.md / D7 STATUS.md
                                                  # D8 ACCEPTANCE.md / D9 GAPS.md
scripts/e2e-intent-sec.py              # D5 浏览器 e2e（计划 §2.1 明确提交到母体仓库 scripts/）
```

任何超出上述范围的改动（如 `web/src/loader/contract.ts`、`crates/core/src/host/mod.rs`、`sw.js`、`check.sh`）均**不属于本项目**，由母体维护者按派发书 §10.2 实施。

---

*本自验收基于 v0.0.1 在母体 0.2.2（`9fc5120`）下的实测；母体升版或白名单变更后须重新执行 node --test 与 e2e-intent-sec-joint.py 并刷新本文件。*
