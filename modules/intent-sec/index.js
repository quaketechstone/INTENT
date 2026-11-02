/**
 * INT-RLSD — INTENTOS-root level security driver
 * ============================================================================
 * 模块 id : intent.sec.kernel
 * 版本    : 0.0.1（装配目标母体 0.2.0）
 * 派发书  : DISPATCH-INTENT-SEC-001
 * 契约    : SCHEMA.md（schema_version 1.0.0）
 * 形态    : 单文件纯静态 ES Module，纯 ES2022，零 npm 依赖（派发书 §4.2/§4.4）
 *
 * 纪律：
 * - 判定函数纯函数化：`(request, state) => decision`，不读时钟、不读 kv、不抛异常
 *   （异常转 CONFLICT/UNAVAILABLE）；IO 只发生在 mount / Evidence / Diagnostics 层。
 * - 跨模块数据一律 clone，不共享可变对象。
 * - 不摸全局 indexedDB / fetch / __QUAKE_LOADER__；只用 ctx 通道 + Web 平台 crypto.subtle。
 * - 门放行 ≠ 执行成功：回执 execution_status 默认 EXECUTION_UNVERIFIED。
 * - 回执与事件只存摘要与引用，禁止明文（S-11）。
 */

/* ==========================================================================
 * 0. 常量与冻结件
 * ========================================================================== */

export const MODULE_ID = 'intent.sec.kernel'
export const MODULE_VERSION = '0.0.1'
export const SCHEMA_VERSION = '1.0.0'
export const DISPATCH_ID = 'DISPATCH-INTENT-SEC-001'

/** §3.1 主链十态（冻结，派发书 §6.4 原文顺序）。 */
export const CHAIN_STATES = [
  'RECEIVED',
  'SCHEMA_VALIDATION',
  'IDENTITY_AND_ARTIFACT_CHECK',
  'AUTHORIZATION_CHECK',
  'AXIOM_AND_POLICY_CHECK',
  'RESOURCE_AND_CONSTRAINT_CHECK',
  'AUTHORIZED_FOR_EXECUTION',
  'EXECUTION_BY_APPROVED_COMPONENT',
  'RECEIPT_AND_EVIDENCE',
  'VERIFICATION',
]

/** §3.2 终态（澄清 C1：派发书「十枚举」指主链十态，终态另计）。 */
export const TERMINAL_STATES = ['DENIED', 'CONFLICT', 'PENDING', 'UNAVAILABLE', 'EXPIRED', 'REVOKED']
export const DECISION_STATES = [...CHAIN_STATES, ...TERMINAL_STATES]

/** §3.3 transition 转换表。未在表内登记的事件 → CONFLICT（不得静默继续）。 */
const TRANSITIONS = {
  RECEIVED: { schema_ok: 'SCHEMA_VALIDATION', schema_fail: 'DENIED' },
  SCHEMA_VALIDATION: {
    identity_ok: 'IDENTITY_AND_ARTIFACT_CHECK',
    identity_conditional: 'IDENTITY_AND_ARTIFACT_CHECK',
    digest_mismatch: 'DENIED',
    manifest_forged: 'DENIED',
    anchor_unavailable: 'UNAVAILABLE',
    signature_unverifiable: 'PENDING',
  },
  IDENTITY_AND_ARTIFACT_CHECK: {
    credential_ok: 'AUTHORIZATION_CHECK',
    credential_expired: 'EXPIRED',
    credential_revoked: 'REVOKED',
    credential_pending: 'PENDING',
  },
  AUTHORIZATION_CHECK: {
    authorized: 'AXIOM_AND_POLICY_CHECK',
    unauthorized: 'DENIED',
    scope_missing: 'DENIED',
  },
  AXIOM_AND_POLICY_CHECK: {
    axioms_ok: 'RESOURCE_AND_CONSTRAINT_CHECK',
    axiom_conflict: 'CONFLICT',
    policy_version_conflict: 'CONFLICT',
  },
  RESOURCE_AND_CONSTRAINT_CHECK: {
    budget_ok: 'AUTHORIZED_FOR_EXECUTION',
    budget_exceeded: 'DENIED',
    constraint_expired: 'EXPIRED',
  },
  AUTHORIZED_FOR_EXECUTION: {
    execute: 'EXECUTION_BY_APPROVED_COMPONENT',
    human_approval_missing: 'PENDING',
  },
  EXECUTION_BY_APPROVED_COMPONENT: { execution_reported: 'RECEIPT_AND_EVIDENCE' },
  RECEIPT_AND_EVIDENCE: { receipt_built: 'VERIFICATION' },
  VERIFICATION: { verified: 'VERIFICATION', unverified: 'VERIFICATION' },
}

/**
 * 状态推进。非法转换 / 未登记事件 → CONFLICT；终态不可再推进（返回自身）。
 * 纯函数，不抛异常。
 */
export function transition(state, event) {
  const row = TRANSITIONS[state]
  if (!row) return TERMINAL_STATES.includes(state) ? state : 'CONFLICT'
  const to = row[event]
  return to || (TERMINAL_STATES.includes(state) ? state : 'CONFLICT')
}

/** 执行状态三枚举（§4.3 冻结）。 */
export const EXECUTION_STATUS = ['DECLARED', 'EXECUTION_UNVERIFIED', 'VERIFIED_LOCAL']

/** 默认策略集 v1.0.0 —— 内联自 spec/policy-default.json（单文件交付，不得拆次级文件）。 */
export const DEFAULT_POLICY = {
  schema_version: '1.0.0',
  policy_id: 'intent-sec.default',
  policy_version: '1.0.0',
  applies_to: { module_id: 'intent.sec.kernel', module_version_range: '0.0.x', host_min: '0.2.0', host_max: '*' },
  axioms: [
    { id: 'S-01', name: '默认拒绝', value: { default_action: 'DENY' }, hard: true, status: 'SPECIFIED' },
    { id: 'S-03', name: '字段多不等于权利多', value: { unknown_field_action: 'REJECT_FORMAT' }, hard: true, status: 'SPECIFIED' },
    { id: 'S-04', name: '完整性不等于可信', value: { artifact_max_verdict: 'CONDITIONAL', verified_trusted_allowed: false }, hard: true, status: 'SPECIFIED' },
    { id: 'S-06', name: '结论必须标注作用范围', value: { decision_must_declare_scope: true }, hard: true, status: 'SPECIFIED' },
    { id: 'S-07', name: 'AI 不得覆盖确定性拒绝', value: { ai_override_allowed: false }, hard: true, status: 'SPECIFIED' },
    { id: 'S-08', name: '不得静默吞掉错误', value: { silent_error_allowed: false, error_mapping: 'CONFLICT_OR_UNAVAILABLE' }, hard: true, status: 'SPECIFIED' },
    { id: 'S-09', name: '本地化优先/最小依赖', value: { network_required: false, declared_capabilities: ['log', 'kv:sec'] }, hard: true, status: 'SPECIFIED' },
    { id: 'S-11', name: '隐私优先/脱敏', value: { plaintext_user_data_in_receipts: false, plaintext_user_data_in_events: false, store_only: ['digest', 'reference'] }, hard: true, status: 'SPECIFIED' },
    { id: 'S-13', name: '不得修改母体核心', value: { host_core_modification_allowed: false }, hard: true, status: 'SPECIFIED' },
    { id: 'S-15', name: '局部失效不拖垮母体', value: { fail_open_on_driver_inactive: true, record_diagnostic_event: true }, hard: true, status: 'SPECIFIED' },
    { id: 'S-02', name: '（条文原文未提供）', value: null, hard: false, status: 'UNKNOWN_PENDING_SPEC' },
    { id: 'S-05', name: '（条文原文未提供）', value: null, hard: false, status: 'UNKNOWN_PENDING_SPEC' },
    { id: 'S-10', name: '（条文原文未提供）', value: null, hard: false, status: 'UNKNOWN_PENDING_SPEC' },
    { id: 'S-12', name: '（条文原文未提供）', value: null, hard: false, status: 'UNKNOWN_PENDING_SPEC' },
    { id: 'S-14', name: '（条文原文未提供）', value: null, hard: false, status: 'UNKNOWN_PENDING_SPEC' },
  ],
  capability_catalog: {
    host_mirror: { prefixes: ['log', 'bridge:read'], kvNs: ['cache', 'skills'], checked_at_host_version: '0.1.12' },
    declared_by_module: ['log', 'kv:sec'],
    known: ['log', 'bridge:read', 'kv:cache', 'kv:skills', 'kv:sec'],
    kv_fallback: { when: 'kv:sec 未授权', use: 'kv:cache', key_prefix: 'sec:', two_state_tested: true },
  },
  operation_catalog: [
    'module.load', 'module.unload', 'capability.use', 'policy.change', 'artifact.verify',
    'receipt.issue', 'kv.read', 'kv.write', 'timer.create', 'dom.render',
  ],
  /** 授权记录：本地策略副本（母体无动态授权通道，§2.3）。结论必须标注作用范围（S-06）。 */
  grants: [
    { grant_id: 'g-log', subject_ref: '*', capability: 'log', operations: ['module.load', 'kv.write', 'timer.create', 'dom.render'], scope: { namespaces: ['sec'] } },
    { grant_id: 'g-policy-change', subject_ref: '*', capability: 'log', operations: ['policy.change'], scope: { namespaces: ['sec'] } },
    { grant_id: 'g-kv-cache', subject_ref: '*', capability: 'kv:cache', operations: ['kv.read', 'kv.write', 'module.load'], scope: { namespaces: ['cache'] } },
    { grant_id: 'g-kv-sec', subject_ref: '*', capability: 'kv:sec', operations: ['kv.read', 'kv.write'], scope: { namespaces: ['sec'] } },
  ],
  quotas: {
    profile: 'static-fused',
    items: {
      storage_bytes: { limit: 10485760, unit: 'bytes', enforcement: 'DECLARED', desc: '存储 10MiB' },
      requests_per_min: { limit: 60, unit: 'count/min', enforcement: 'DECLARED', desc: '请求 60 次/分钟' },
      timers: { limit: 50, unit: 'count', enforcement: 'DECLARED', desc: '定时器 50' },
      detail_bytes: { limit: 65536, unit: 'bytes', enforcement: 'DECLARED', desc: 'detail 64KiB' },
      dom_nodes: { limit: 5000, unit: 'count', enforcement: 'DECLARED', desc: 'DOM 5000' },
      cold_start_ms: { limit: 200, unit: 'ms', enforcement: 'DECLARED', desc: '冷启 200ms' },
    },
    undefined_no_guessing: ['WASM 内存上限', '单次执行时长', '并发数'],
  },
  defaults: {
    ttl_ms: 3600000,
    ttl_source_when_absent: 'policy_default',
    ttl_never_permanent: true,
    on_missing_scope: 'DENIED',
    on_unknown_operation: 'DENIED',
    on_anchor_missing: 'UNAVAILABLE',
    on_anchor_signature_present: 'PENDING',
    execution_status_default: 'EXECUTION_UNVERIFIED',
    time_source: 'client_untrusted',
    timer_scan_interval_ms: 60000,
    /** 裁决 D12：需人工确认的操作（第 10 步，母体无机制 → PENDING）。 */
    human_approval_operations: ['policy.change'],
  },
  trust: { anchor_kind: 'local-config', is_global_trust_root: false, identity_verdict_ceiling: 'CONDITIONAL', signature_verification: 'MISSING' },
  storage: {
    key_prefix: 'sec:v1:',
    fallback_key_prefix: 'sec:',
    keys: { policy: 'policy', trust_anchor: 'trust-anchor', revoked: 'revoked', receipt: 'receipt:', events: 'events' },
    list_prefix_only: 'sec:',
    cross_ns_forbidden: true,
  },
}

/* ==========================================================================
 * 1. 工具层（纯函数）
 * ========================================================================== */

export const REQUEST_FIELDS = [
  'request_id', 'subject_ref', 'driver_ref', 'operation', 'target_ref',
  'input_digest', 'requested_capabilities', 'policy_context', 'constraints', 'evidence_refs',
]
export const CONSTRAINT_KEYS = ['scope', 'budget', 'valid_until']
export const SCOPE_KEYS = ['namespaces', 'operations', 'resources']
export const BUDGET_KEYS = ['storage_bytes', 'requests_per_min', 'timers', 'detail_bytes', 'dom_nodes', 'cold_start_ms']

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const HEX64 = /^[0-9a-f]{64}$/

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0

/** 稳定克隆：跨模块数据不共享可变引用（§4.4）。 */
export function clone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value)
  return JSON.parse(JSON.stringify(value))
}

const utf8 = (s) => new TextEncoder().encode(s)

/** 同步确定性哈希 FNV-1a 64（裁决 D9：用于 policyDigest 可追溯，**不冒充 SHA-256**）。 */
export function fnv1a64hex(text) {
  let h = 0xcbf29ce484222325n
  const P = 0x100000001b3n
  const MASK = (1n << 64n) - 1n
  const bytes = utf8(text)
  for (let i = 0; i < bytes.length; i++) {
    h ^= BigInt(bytes[i])
    h = (h * P) & MASK
  }
  return h.toString(16).padStart(16, '0')
}

/** §1.4 输入规范化：字段定序 + 数组排序 + 键排序，保证摘要可复现（A06）。 */
export function canonicalize(request) {
  const c = clone(request)
  const out = {}
  for (const k of REQUEST_FIELDS) {
    if (k === 'requested_capabilities' || k === 'evidence_refs') {
      out[k] = Array.isArray(c[k]) ? [...c[k]].sort() : c[k]
      continue
    }
    if (k === 'constraints') {
      const cs = c[k] || {}
      const o = {}
      if (isPlainObject(cs.scope)) {
        const s = {}
        for (const sk of SCOPE_KEYS) if (Array.isArray(cs.scope[sk])) s[sk] = [...cs.scope[sk]].sort()
        o.scope = s
      } else if (cs.scope !== undefined) o.scope = cs.scope
      if (isPlainObject(cs.budget)) {
        const b = {}
        for (const bk of BUDGET_KEYS) if (typeof cs.budget[bk] === 'number') b[bk] = cs.budget[bk]
        o.budget = b
      } else if (cs.budget !== undefined) o.budget = cs.budget
      if (cs.valid_until !== undefined) o.valid_until = cs.valid_until
      out[k] = o
      continue
    }
    out[k] = c[k]
  }
  return out
}

export function canonicalJSON(request) {
  return JSON.stringify(canonicalize(request))
}

/**
 * SHA-256（异步）。浏览器走 crypto.subtle（Web 平台 API，派发书 §5.6 允许），
 * node 侧回退 node:crypto 供单测。三处（build/verify/digest）同一算法。
 */
export async function sha256Hex(text) {
  const bytes = utf8(text)
  if (typeof crypto !== 'undefined' && crypto && crypto.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', bytes)
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
  }
  const { createHash } = await import('node:crypto')
  return createHash('sha256').update(bytes).digest('hex')
}

/** semver 比较（简化，足够 min_host/host_min 判定）。 */
export function cmpSemver(a, b) {
  const pa = /^(\d+)\.(\d+)\.(\d+)$/.exec(a || '')
  const pb = /^(\d+)\.(\d+)\.(\d+)$/.exec(b || '')
  if (!pa || !pb) return 0
  for (let i = 1; i <= 3; i++) {
    const d = Number(pa[i]) - Number(pb[i])
    if (d !== 0) return d > 0 ? 1 : -1
  }
  return 0
}

/** 判定层辅助：valid_until 缺省不得当永久有效（裁决 D4）。 */
export function resolveValidity(request, nowMs, defaultTtlMs = DEFAULT_POLICY.defaults.ttl_ms) {
  const vu = request && request.constraints ? request.constraints.valid_until : undefined
  if (typeof vu === 'number' && Number.isFinite(vu)) {
    return { expires_at: vu, ttl_source: 'request', expired: typeof nowMs === 'number' && nowMs > vu }
  }
  if (typeof nowMs !== 'number') return { expires_at: null, ttl_source: null, expired: false }
  return { expires_at: nowMs + defaultTtlMs, ttl_source: 'policy_default', expired: false }
}

/* ==========================================================================
 * 2. SecurityRequest 校验（S-03：未知字段 → format 拒绝）
 * ========================================================================== */

/**
 * @returns {{ok:true, value:object, normalized:object}|{ok:false, errors:Array<{field:string,kind:'format',reason:string}>}}
 */
export function validateRequest(input, opts = {}) {
  const known = Array.isArray(opts.knownCapabilities) ? opts.knownCapabilities : DEFAULT_POLICY.capability_catalog.known
  const errors = []
  const fail = (field, reason) => errors.push({ field, kind: 'format', reason })

  if (!isPlainObject(input)) return { ok: false, errors: [{ field: '<root>', kind: 'format', reason: '请求不是对象' }] }

  for (const k of Object.keys(input)) if (!REQUEST_FIELDS.includes(k)) fail(k, '未知字段（S-03：字段多不等于权利多）')
  for (const k of REQUEST_FIELDS) if (input[k] === undefined) fail(k, '必填字段缺失')

  if (typeof input.request_id !== 'string' || !UUID_V4.test(input.request_id)) fail('request_id', '必须是 uuidv4')
  if (!isNonEmptyString(input.subject_ref)) fail('subject_ref', '必须是非空字符串（声明式引用，非身份证明）')
  if (!isNonEmptyString(input.driver_ref)) fail('driver_ref', '必须是非空字符串')
  if (!isNonEmptyString(input.operation)) fail('operation', '必须是非空字符串')
  if (input.target_ref !== null && !isNonEmptyString(input.target_ref)) fail('target_ref', '必须是 null 或非空字符串')
  if (typeof input.input_digest !== 'string' || !HEX64.test(input.input_digest)) fail('input_digest', '必须是 64 位十六进制 sha256')

  if (!Array.isArray(input.requested_capabilities)) fail('requested_capabilities', '必须是数组')
  else {
    for (const c of input.requested_capabilities) {
      if (typeof c !== 'string' || !c.length) fail('requested_capabilities', '元素必须是非空字符串')
      else if (!known.includes(c)) fail('requested_capabilities', `未知能力：${c}`)
    }
  }

  if (!isNonEmptyString(input.policy_context)) fail('policy_context', '必须是非空字符串')

  const cs = input.constraints
  if (!isPlainObject(cs)) fail('constraints', '必须是对象')
  else {
    for (const k of Object.keys(cs)) if (!CONSTRAINT_KEYS.includes(k)) fail(`constraints.${k}`, `未知键（只允许 ${CONSTRAINT_KEYS.join('/')}）`)
    if (cs.scope !== undefined) {
      if (!isPlainObject(cs.scope)) fail('constraints.scope', '必须是对象')
      else {
        for (const k of Object.keys(cs.scope)) {
          if (!SCOPE_KEYS.includes(k)) fail(`constraints.scope.${k}`, `未知键（只允许 ${SCOPE_KEYS.join('/')}）`)
          else if (!Array.isArray(cs.scope[k]) || !cs.scope[k].every(isNonEmptyString)) fail(`constraints.scope.${k}`, '必须是非空字符串数组')
        }
      }
    }
    if (cs.budget !== undefined) {
      if (!isPlainObject(cs.budget)) fail('constraints.budget', '必须是对象')
      else {
        for (const k of Object.keys(cs.budget)) {
          if (!BUDGET_KEYS.includes(k)) fail(`constraints.budget.${k}`, `未知键（只允许 ${BUDGET_KEYS.join('/')}）`)
          else if (typeof cs.budget[k] !== 'number' || !Number.isFinite(cs.budget[k]) || cs.budget[k] < 0) fail(`constraints.budget.${k}`, '必须是非负 number')
        }
      }
    }
    if (cs.valid_until !== undefined && (typeof cs.valid_until !== 'number' || !Number.isFinite(cs.valid_until))) {
      fail('constraints.valid_until', '必须是 number（epoch 毫秒）')
    }
  }

  if (!Array.isArray(input.evidence_refs)) fail('evidence_refs', '必须是数组')
  else if (!input.evidence_refs.every(isNonEmptyString)) fail('evidence_refs', '元素必须是非空字符串')

  if (errors.length) return { ok: false, errors }
  return { ok: true, value: clone(input), normalized: canonicalize(input) }
}

/* ==========================================================================
 * 3. M1 Policy Core（策略内核）
 * ========================================================================== */

/**
 * 装载/覆盖策略。硬公理（hard=true）不可被 kv 覆盖（防止策略绕过安全底线）。
 * 同一公理 id 出现冲突值 → CONFLICT，不准自行挑有利规则（§5.1）。
 */
export function loadPolicy(raw, opts = {}) {
  const base = clone(opts.base || DEFAULT_POLICY)
  const errors = []
  if (raw === undefined || raw === null) return { ok: true, policy: base }
  if (!isPlainObject(raw)) return { ok: false, errors: [{ code: 'FORMAT', reason: '策略不是对象' }] }
  if (!isNonEmptyString(raw.policy_id)) errors.push({ code: 'FORMAT', reason: 'policy_id 缺失' })
  if (!isNonEmptyString(raw.policy_version)) errors.push({ code: 'FORMAT', reason: 'policy_version 缺失' })

  const baseById = new Map(base.axioms.map((a) => [a.id, a]))
  const seen = new Map()
  for (const a of Array.isArray(raw.axioms) ? raw.axioms : []) {
    if (!a || typeof a.id !== 'string') { errors.push({ code: 'FORMAT', reason: 'axiom 缺少 id' }); continue }
    if (seen.has(a.id) && JSON.stringify(seen.get(a.id)) !== JSON.stringify(a.value)) {
      errors.push({ code: 'CONFLICT', reason: `公理 ${a.id} 出现互相冲突的取值` })
      continue
    }
    seen.set(a.id, a.value)
    const b = baseById.get(a.id)
    if (b && b.hard && JSON.stringify(b.value) !== JSON.stringify(a.value)) {
      errors.push({ code: 'CONFLICT', reason: `硬公理 ${a.id} 不可被覆盖` })
      continue
    }
    if (b) b.value = clone(a.value)
    else base.axioms.push(clone(a))
  }

  // 版本不兼容检测（§5.1 必做）
  const apply = raw.applies_to || base.applies_to
  if (apply && isNonEmptyString(apply.host_min) && isNonEmptyString(opts.hostVersion)) {
    if (cmpSemver(opts.hostVersion, apply.host_min) < 0) {
      errors.push({ code: 'VERSION', reason: `策略要求母体 >= ${apply.host_min}，当前 ${opts.hostVersion}` })
    }
  }
  if (errors.length) return { ok: false, errors }

  base.policy_id = raw.policy_id || base.policy_id
  base.policy_version = raw.policy_version || base.policy_version
  if (raw.applies_to) base.applies_to = clone(raw.applies_to)
  if (Array.isArray(raw.grants)) base.grants = clone(raw.grants)
  if (raw.quotas && raw.quotas.items) base.quotas.items = clone(raw.quotas.items)
  if (raw.defaults) base.defaults = { ...base.defaults, ...clone(raw.defaults) }
  if (raw.trust) base.trust = { ...base.trust, ...clone(raw.trust) }
  if (raw.capability_catalog) base.capability_catalog = { ...base.capability_catalog, ...clone(raw.capability_catalog) }
  if (Array.isArray(raw.operation_catalog)) base.operation_catalog = clone(raw.operation_catalog)
  return { ok: true, policy: base }
}

/** 公理/版本检查。冲突显式返回，不自行挑有利规则（§5.1 / T-06）。 */
export function checkAxioms(operation, policyState = DEFAULT_POLICY, opts = {}) {
  const conflicts = []
  const byId = new Map((policyState.axioms || []).map((a) => [a.id, a]))
  const S01 = byId.get('S-01')
  if (!S01 || S01.value?.default_action !== 'DENY') conflicts.push('S-01 默认拒绝公理缺失或被篡改')
  const S07 = byId.get('S-07')
  if (!S07 || S07.value?.ai_override_allowed !== false) conflicts.push('S-07 AI 不得覆盖确定性拒绝 被篡改')
  const S04 = byId.get('S-04')
  if (!S04 || S04.value?.verified_trusted_allowed !== false) conflicts.push('S-04 完整性≠可信 被篡改')
  const S13 = byId.get('S-13')
  if (!S13 || S13.value?.host_core_modification_allowed !== false) conflicts.push('S-13 不得修改母体核心 被篡改')

  if (conflicts.length) return { ok: false, code: 'CONFLICT', detail: { conflicts } }

  // 版本不兼容
  const apply = policyState.applies_to
  if (apply && isNonEmptyString(apply.host_min) && isNonEmptyString(opts.hostVersion)) {
    if (cmpSemver(opts.hostVersion, apply.host_min) < 0) {
      return { ok: false, code: 'VERSION', detail: { host: opts.hostVersion, required: apply.host_min } }
    }
  }
  if (apply && isNonEmptyString(apply.module_version_range) && isNonEmptyString(opts.moduleVersion)) {
    const m = /^(\d+)\.(\d+)\.x$/.exec(apply.module_version_range)
    if (m) {
      const mv = /^(\d+)\.(\d+)\.(\d+)$/.exec(opts.moduleVersion)
      if (mv && (mv[1] !== m[1] || mv[2] !== m[2])) {
        return { ok: false, code: 'VERSION', detail: { module: opts.moduleVersion, range: apply.module_version_range } }
      }
    }
  }
  return { ok: true }
}

/** 策略摘要（同步、确定性，裁决 D9：fnv1a64，不冒充 SHA-256）。判定依据可追溯（A06）。 */
export function policyDigest(policyState = DEFAULT_POLICY) {
  const slim = {
    policy_id: policyState.policy_id,
    policy_version: policyState.policy_version,
    axioms: (policyState.axioms || []).map((a) => [a.id, a.value]),
    quotas: policyState.quotas ? policyState.quotas.items : null,
    grants: policyState.grants || [],
  }
  return `policy:${policyState.policy_id}@${policyState.policy_version}:${fnv1a64hex(JSON.stringify(slim))}`
}

/* ==========================================================================
 * 4. M2 Identity & Artifact Verifier（身份与产物验证器）
 * ========================================================================== */

/** 同步纯函数版（摘要由调用方注入，供单测与纯逻辑复用）。 */
export function verifyArtifactWithDigest(args = {}) {
  const { actualDigest, expectedSha256, manifest, anchor, hostVersion } = args
  if (!isNonEmptyString(actualDigest) || !isNonEmptyString(expectedSha256)) {
    return { verdict: 'DENIED', reason: '摘要缺失或不合法（默认拒绝 S-01）', unverified: ['artifact_digest'] }
  }
  if (actualDigest !== expectedSha256) {
    return { verdict: 'DENIED', reason: '摘要不匹配：产物完整性校验失败', unverified: [] }
  }
  if (manifest) {
    if (isNonEmptyString(manifest.min_host) && isNonEmptyString(hostVersion) && cmpSemver(hostVersion, manifest.min_host) < 0) {
      return { verdict: 'DENIED', reason: `manifest 要求母体 >= ${manifest.min_host}，当前 ${hostVersion}`, unverified: [] }
    }
    if (manifest.id !== undefined && !isNonEmptyString(manifest.id)) {
      return { verdict: 'DENIED', reason: 'manifest.id 不合法', unverified: [] }
    }
  }
  // 信任锚缺失 → UNAVAILABLE，不得默认放行（T-11）
  if (!anchor || !isPlainObject(anchor)) {
    return { verdict: 'UNAVAILABLE', reason: '信任锚配置缺失，身份结论不可用', unverified: ['publisher_identity'] }
  }
  // 有签名字段但无签名验证体系 → PENDING，不假装通过（§5.2）
  if (anchor.signature !== undefined || (manifest && manifest.signature !== undefined)) {
    return { verdict: 'PENDING', reason: '存在签名字段但无签名验证体系（MISSING），不得假装通过', unverified: ['signature'] }
  }
  // 锚内已验证签名登记 → VERIFIED（v0.0.1 无此能力，路径保留）
  if (Array.isArray(anchor.verified_signatures) && anchor.verified_signatures.includes(actualDigest)) {
    return { verdict: 'VERIFIED', reason: '锚内已验证签名登记命中', unverified: [] }
  }
  // 完整性已验 ≠ 可信：结论上限 CONDITIONAL（S-04）
  const registered = Array.isArray(anchor.artifacts) && anchor.artifacts.includes(actualDigest)
  return {
    verdict: 'CONDITIONAL',
    reason: registered
      ? '摘要匹配且锚内登记：完整性已验，可信度未验（S-04，上限 CONDITIONAL）'
      : '摘要匹配但锚内未登记：完整性已验，发布者身份未验（S-04，上限 CONDITIONAL）',
    unverified: ['publisher_identity', 'signature'],
  }
}

/** 异步版：内部算 SHA-256（浏览器 crypto.subtle）。v0.0.1 可达值不含 VERIFIED（无签名体系）。 */
export async function verifyArtifact(args = {}) {
  try {
    if (args.content === undefined || args.content === null) {
      return { verdict: 'DENIED', reason: '产物内容缺失（默认拒绝 S-01）', unverified: ['artifact_digest'] }
    }
    const text = typeof args.content === 'string' ? args.content : JSON.stringify(args.content)
    const actualDigest = await sha256Hex(text)
    return verifyArtifactWithDigest({ ...args, actualDigest })
  } catch (e) {
    // S-08：不得静默吞掉
    return { verdict: 'UNAVAILABLE', reason: `摘要计算失败：${String(e && e.message ? e.message : e)}`, unverified: ['artifact_digest'] }
  }
}

/** 凭证验证：VERIFIED / EXPIRED / REVOKED / PENDING（时间以参数注入，保持纯函数）。 */
export function verifyCredential(cred, now, opts = {}) {
  const revoked = Array.isArray(opts.revoked) ? opts.revoked : []
  if (!cred || !isPlainObject(cred)) {
    return { verdict: 'PENDING', reason: '凭证缺失，缺证待补', missing_evidence: ['credential'] }
  }
  if (!isNonEmptyString(cred.id)) return { verdict: 'PENDING', reason: '凭证 id 缺失', missing_evidence: ['credential.id'] }
  if (revoked.some((r) => r && r.id === cred.id) || cred.revoked === true) {
    return { verdict: 'REVOKED', reason: '凭证已撤销（撤销清单命中）', missing_evidence: [] }
  }
  if (typeof cred.expires_at === 'number' && typeof now === 'number' && now > cred.expires_at) {
    return { verdict: 'EXPIRED', reason: '凭证已过期', missing_evidence: [] }
  }
  if (cred.signature !== undefined) {
    return { verdict: 'PENDING', reason: '凭证含签名字段但无签名验证体系，不得假装通过', missing_evidence: ['signature_verification'] }
  }
  if (typeof cred.expires_at !== 'number') {
    return { verdict: 'PENDING', reason: '凭证缺少有效期，不得当永久有效', missing_evidence: ['credential.expires_at'] }
  }
  return { verdict: 'VERIFIED', reason: '本地策略内凭证，有效期内且未被撤销', missing_evidence: [] }
}

/* ==========================================================================
 * 5. M3 Capability Guard（能力守卫）
 * ========================================================================== */

/**
 * 六要素检查（主体/客体/操作/范围/期限/预算）+ 默认拒绝（S-01）
 * + 拒绝隐式权限继承与转授（显式字段缺失即拒）。纯函数。
 */
export function checkCapability(args = {}) {
  const { subject, capability, operation, scope, budget, now, policyState = DEFAULT_POLICY, revoked = [] } = args
  const base = { status: 'DENIED', constraints: [], reason: '' }
  const deny = (reason, extra = {}) => ({ ...base, reason, ...extra })

  if (!isNonEmptyString(subject)) return deny('主体缺失（S-01 默认拒绝）')
  if (!isNonEmptyString(capability)) return deny('能力标识缺失')
  if (!isNonEmptyString(operation)) return deny('操作缺失')

  // 未知操作 → 判定层拒绝（裁决 D2）
  const ops = policyState.operation_catalog || []
  if (ops.length && !ops.includes(operation)) return deny(`未知操作：${operation}（不在操作目录）`)

  // 撤销清单命中 → REVOKED
  const hit = (revoked || []).find((r) => r && r.id === subject)
  if (hit) {
    if (!hit.until || typeof now !== 'number' || now <= hit.until) {
      return { ...base, status: 'REVOKED', reason: `主体在撤销清单内：${hit.reason || '未注明原因'}` }
    }
  }
  // 显式范围缺失 → 拒（拒绝隐式继承与转授，裁决 D5）
  if (!isPlainObject(scope) || Object.keys(scope).length === 0) {
    return deny('未声明显式作用范围（拒绝隐式权限继承与转授）', { missing_evidence: ['scope'] })
  }
  // 转授检查：声明了 delegated_from 但无 delegation_chain → 拒
  if (args.delegated_from !== undefined && !Array.isArray(args.delegation_chain)) {
    return deny('声明转授但缺少 delegation_chain（拒绝隐式转授）', { missing_evidence: ['delegation_chain'] })
  }

  // 授权源 = 本地策略副本（母体无动态授权通道，§2.3）
  const grants = (policyState.grants || []).filter(
    (g) => g.capability === capability && (g.subject_ref === '*' || g.subject_ref === subject)
      && (!Array.isArray(g.operations) || g.operations.includes(operation)),
  )
  if (!grants.length) return deny(`未授权：${subject} 对 ${capability} 的 ${operation}（S-01 默认拒绝）`)

  // 范围收敛：请求 scope 必须是授权 scope 的子集
  const gScope = grants[0].scope || {}
  for (const [k, want] of Object.entries(scope)) {
    const allow = Array.isArray(gScope[k]) ? gScope[k] : null
    if (!allow) return deny(`作用范围键 ${k} 未被授权`, { missing_evidence: [`scope.${k}`] })
    if (!Array.isArray(want) || !want.every((v) => allow.includes(v))) {
      return deny(`作用范围越权：${k} 超出授权范围`, { missing_evidence: [`scope.${k}`] })
    }
  }

  // 期限
  const validity = resolveValidity({ constraints: { valid_until: args.valid_until } }, now, policyState.defaults?.ttl_ms)
  if (validity.expired) return { ...base, status: 'EXPIRED', reason: '授权已到期' }

  // 预算（超限不在此处判定，交由 Resource Guard；此处仅要求显式声明）
  const constraints = [{
    scope,
    valid_until: validity.expires_at,
    ttl_source: validity.ttl_source,
    grant_ref: grants[0].grant_id,
    note: '结论基于本地策略副本，母体无动态授权通道（S-06 作用范围已标注）',
  }]
  return { status: 'AUTHORIZED_FOR_EXECUTION', constraints, reason: `授权命中 ${grants[0].grant_id}` }
}

/* ==========================================================================
 * 6. M5 Resource Guard（资源守卫）—— 只能 DECLARED：校验 + 记录 + 上报
 * ========================================================================== */

export function checkBudget(args = {}) {
  const { requested = {}, limits = {}, usage = {} } = args
  const exceeded = []
  const remaining = {}
  for (const key of BUDGET_KEYS) {
    const limit = typeof limits[key] === 'number' ? limits[key] : undefined
    if (limit === undefined) continue
    const used = typeof usage[key] === 'number' ? usage[key] : 0
    const want = typeof requested[key] === 'number' ? requested[key] : 0
    const next = used + want
    remaining[key] = Math.max(0, limit - next)
    if (next > limit) exceeded.push({ item: key, limit, used, requested: want, next })
  }
  return exceeded.length ? { ok: false, exceeded, remaining } : { ok: true, remaining }
}

/** 超限事件（结构化）。写入由 IO 层（mount 注入 sink）执行。 */
export function recordOverrun(event, sink) {
  const rec = {
    kind: 'overrun',
    at: event && event.at !== undefined ? event.at : null,
    time_source: 'client_untrusted',
    item: event?.item ?? null,
    limit: event?.limit ?? null,
    observed: event?.next ?? null,
    request_digest: event?.request_digest ?? null,
    enforcement: 'DECLARED',
    note: '母体无强制配额：仅校验+记录+上报，未中断执行（§5.5）',
  }
  if (typeof sink === 'function') { try { sink(rec) } catch { /* S-08：记录层失败不冒泡为静默 */ } }
  return rec
}

/* ==========================================================================
 * 7. M6 Evidence & Receipt（证据与回执）
 * ========================================================================== */

/** 同步纯函数版（requestDigest 由调用方注入）。 */
export function buildReceiptWithDigest(request, decision, execution = {}, requestDigest = '', opts = {}) {
  const policy = opts.policyState || DEFAULT_POLICY
  const exStatus = EXECUTION_STATUS.includes(execution.execution_status)
    ? execution.execution_status
    : policy.defaults.execution_status_default
  return {
    request_id: request?.request_id ?? null,
    subject_ref: request?.subject_ref ?? null,
    driver_ref: request?.driver_ref ?? null,
    request_digest: requestDigest,
    policy_ref: policy.policy_id,
    policy_version: policy.policy_version,
    authorization_result: decision?.status ?? null,
    execution_status: exStatus,
    io_summary: {
      kv_reads: Number(execution.kv_reads || 0),
      kv_writes: Number(execution.kv_writes || 0),
      events: Number(execution.events || 0),
      bytes: Number(execution.bytes || 0),
    },
    evidence_refs: Array.isArray(execution.evidence_refs) ? clone(execution.evidence_refs) : (Array.isArray(request?.evidence_refs) ? clone(request.evidence_refs) : []),
    time: typeof opts.now === 'number' ? opts.now : (execution.at ?? null),
    time_source: 'client_untrusted',
    unverified_items: Array.isArray(execution.unverified_items) ? clone(execution.unverified_items) : ['execution_not_attested'],
  }
}

/** 异步版：内部算规范化请求摘要。 */
export async function buildReceipt(request, decision, execution = {}, opts = {}) {
  const digest = opts.requestDigest || (await sha256Hex(canonicalJSON(request)))
  return buildReceiptWithDigest(request, decision, execution, digest, opts)
}

/** 同步版校验（摘要注入）。对应关系：request_id / request_digest / authorization_result / policy。 */
export function verifyReceiptWithDigest(receipt, request, decision, requestDigest) {
  if (!receipt || !request || !decision) return false
  if (receipt.request_id !== request.request_id) return false
  if (receipt.request_id !== decision.request_id) return false
  if (receipt.request_digest !== requestDigest) return false
  if (receipt.authorization_result !== decision.status) return false
  // SCHEMA §5.1：policy_ref 必须与 applicable_policy_refs 中一条 `policy:<id>@<ver>` 对应。
  // 列表为空不再跳过——跳过等于该条校验从未生效（历史放行路径即如此）。
  const refs = Array.isArray(decision.applicable_policy_refs) ? decision.applicable_policy_refs : []
  const hit = refs.some((r) => String(r).startsWith(`policy:${receipt.policy_ref}@`))
  if (!hit) return false
  return true
}

export async function verifyReceipt(receipt, request, decision) {
  const digest = await sha256Hex(canonicalJSON(request))
  return verifyReceiptWithDigest(receipt, request, decision, digest)
}

/* ==========================================================================
 * 8. M7 Security Diagnostics（安全诊断）
 * ========================================================================== */

/**
 * 结构化诊断：拒绝原因 + 缺失证据 + 复现信息（输入摘要 + 策略版本 + 判定路径）。
 * 纪律：不得因「分析需要」拉取全量用户数据/他模块数据/请求正文（§5.7）。
 */
export function diagnose(input = {}, opts = {}) {
  const policy = opts.policyState || DEFAULT_POLICY
  const loadError = input.loadError || null
  const denial = input.judgeDenial || null
  const overrun = input.overrun || null

  let code = 'OK'
  let reason = '无异常'
  const missing_evidence = []
  const path = []

  if (loadError) {
    code = String(loadError.kind || 'ERROR').toUpperCase()
    reason = String(loadError.reason || '装载失败')
    path.push(`load:${loadError.stage || 'unknown'}`)
    if (loadError.kind === 'permission') missing_evidence.push('host_capability_grant')
    if (loadError.kind === 'version') missing_evidence.push('host_version_upgrade')
  } else if (denial) {
    code = String(denial.status || 'DENIED')
    reason = String(denial.reason || '判定未放行')
    if (Array.isArray(denial.missing_evidence)) missing_evidence.push(...denial.missing_evidence)
    if (Array.isArray(denial.path)) path.push(...denial.path)
  } else if (overrun) {
    code = 'OVERRUN'
    reason = `配额超限（${overrun.item || 'unknown'}），仅记录未中断`
    path.push('resource_guard')
  }

  return {
    code,
    reason,
    missing_evidence: [...new Set(missing_evidence)],
    repro: {
      input_digest: input.input_digest || null,
      request_digest: opts.requestDigest || null,
      policy_ref: policy.policy_id,
      policy_version: policy.policy_version,
      policy_digest: policyDigest(policy),
      path,
      time_source: 'client_untrusted',
    },
  }
}

/** 脱敏导出：只出摘要与引用，禁止明文（S-11）。 */
export function exportEvents(events = [], filter = {}) {
  const limit = typeof filter.limit === 'number' ? filter.limit : 200
  return (Array.isArray(events) ? events : [])
    .filter((e) => !filter.kind || e.kind === filter.kind)
    .filter((e) => !filter.code || e.code === filter.code)
    .slice(-limit)
    .map((e) => ({
      kind: e.kind ?? null,
      code: e.code ?? null,
      at: e.at ?? null,
      time_source: 'client_untrusted',
      request_digest: e.request_digest ?? null,
      reason: typeof e.reason === 'string' ? e.reason.slice(0, 200) : null,
      enforcement: e.enforcement ?? null,
    }))
}

/* ==========================================================================
 * 9. M4 Intent Gate（意图执行门）—— 十步检查
 * ========================================================================== */

const emptyDecision = (request) => ({
  request_id: request?.request_id ?? null,
  status: 'RECEIVED',
  allowed_operations: [],
  denied_operations: [],
  applicable_policy_refs: [],
  authorization_refs: [],
  required_constraints: [],
  missing_evidence: [],
  conflicts: [],
  valid_until: null,
  decision_evidence_ref: null,
  path: [],
})

/**
 * 纯函数判定（不读时钟、不读 kv、不抛异常）。单测直接调用本函数。
 * opts: { policyState, revoked, anchor, credential, now, usage, hostVersion, limits }
 */
export function judgeSync(request, opts = {}) {
  const policy = opts.policyState || DEFAULT_POLICY
  const d = emptyDecision(request)
  const push = (state) => { d.status = state; d.path.push(state) }
  const applicable = (ref) => { if (!d.applicable_policy_refs.includes(ref)) d.applicable_policy_refs.push(ref) }
  // 判定所依据的策略本身也是「适用引用」：SCHEMA §5 第 4 条要求回执的 policy_ref 能与
  // applicable_policy_refs 对应。仅记公理编号（S-xx）时该条无法满足 —— 拒绝类回执会
  // 自己验不过自己（2026-10-24 联调实测）。此处补 `policy:<id>@<ver>` 引用，不改变校验强度。
  applicable(`policy:${policy.policy_id}@${policy.policy_version}`)
  const limits = opts.limits || Object.fromEntries(Object.entries(policy.quotas.items).map(([k, v]) => [k, v.limit]))

  const sink = typeof opts.diagnosticSink === 'function' ? opts.diagnosticSink : null
  const die = () => {
    if (sink) {
      try {
        sink({ kind: 'judge', code: d.status, request_digest: opts.requestDigest || null, reason: d.reason || null })
      } catch { /* 记录层失败不影响判定结论（S-08：不静默，已落 reason） */ }
    }
    return d
  }

  try {
    /* 步骤 0：重放检测（同 request_id 已有回执 → 拒绝并显式标记，T-09） */
    if (opts.replay === true) {
      d.status = 'DENIED'
      d.reason = '重放请求：同一 request_id 已有回执（幂等拒绝）'
      d.replay = true
      d.denied_operations.push(request.operation)
      return die()
    }

    /* 步骤 1：schema 校验 */
    const v = validateRequest(request, { knownCapabilities: policy.capability_catalog?.known })
    if (!v.ok) {
      d.status = transition(d.status, 'schema_fail')
      d.path.push('SCHEMA_VALIDATION')
      d.reason = `请求格式校验失败：${v.errors.map((e) => e.field).join(', ')}`
      d.format_errors = v.errors
      applicable('S-03')
      return die()
    }
    push(transition(d.status, 'schema_ok'))

    /* 步骤 2：来源记录（subject_ref / driver_ref 是声明式引用，不是身份证明） */
    if (!isNonEmptyString(request.subject_ref) || !isNonEmptyString(request.driver_ref)) {
      d.status = 'DENIED'
      d.reason = '来源记录不完整'
      d.missing_evidence.push('subject_ref/driver_ref')
      return die()
    }
    d.authorization_refs.push(`subject:${request.subject_ref}`, `driver:${request.driver_ref}`)

    /* 步骤 3：摘要复核（裁决 D11：自描述请求可复核，否则记为不可复算） */
    const selfDigest = fnv1a64hex(canonicalJSON(request)) // 同步占位，真实 SHA-256 在异步层
    if (typeof opts.requestDigest === 'string' && opts.requestDigest.length === 64) {
      if (opts.requestDigest === request.input_digest) {
        d.authorization_refs.push(`digest:self-describing:${selfDigest}`)
      } else {
        d.unverified_items = ['input_digest_not_recomputable']
      }
    } else {
      d.unverified_items = ['input_digest_not_recomputable']
    }

    /* 步骤 4：能力白名单（Capability Guard：六要素 + 撤销 + 期限，S-01 默认拒绝） */
    const caps = request.requested_capabilities || []
    const declared = policy.capability_catalog?.declared_by_module || []
    for (const cap of caps) {
      if (!declared.includes(cap)) {
        d.status = 'DENIED'
        d.denied_operations.push(cap)
        d.reason = `能力 ${cap} 不在模块声明范围内（最小权限）`
        applicable('S-09')
        return die()
      }
    }
    const validity = resolveValidity(request, opts.now, policy.defaults?.ttl_ms)
    const capResult = checkCapability({
      subject: request.subject_ref,
      capability: caps[0] || 'log',
      operation: request.operation,
      scope: request.constraints?.scope,
      budget: request.constraints?.budget,
      now: opts.now,
      valid_until: request.constraints?.valid_until,
      policyState: policy,
      revoked: opts.revoked || [],
      delegated_from: opts.delegated_from,
      delegation_chain: opts.delegation_chain,
    })
    if (capResult.status !== 'AUTHORIZED_FOR_EXECUTION') {
      d.status = capResult.status
      d.reason = capResult.reason
      if (Array.isArray(capResult.missing_evidence)) d.missing_evidence.push(...capResult.missing_evidence)
      d.denied_operations.push(request.operation)
      applicable('S-01')
      return die()
    }
    d.required_constraints = capResult.constraints || []
    d.valid_until = validity.expires_at
    push(transition(d.status, 'identity_ok'))

    /* 步骤 8（十步编号保留：执行位置落在身份阶段，裁决 D14——状态机仅在
       IDENTITY_AND_ARTIFACT_CHECK 定义 credential_* 事件，判定结论不变） */
    const cred = opts.credential
    if (cred) {
      const cv = verifyCredential(cred, opts.now, { revoked: opts.revoked || [] })
      if (cv.verdict !== 'VERIFIED') {
        d.status = cv.verdict === 'EXPIRED' ? transition(d.status, 'credential_expired')
          : cv.verdict === 'REVOKED' ? transition(d.status, 'credential_revoked')
            : transition(d.status, 'credential_pending')
        d.reason = cv.reason
        d.missing_evidence.push(...(cv.missing_evidence || []))
        d.path.push('STEP8')
        return die()
      }
      d.authorization_refs.push(`credential:${cred.id}`)
    }
    push(transition(d.status, 'credential_ok'))

    /* 步骤 5：策略授权（本地策略副本；母体无动态授权通道，结论已标注作用范围 S-06）
       策略引用已在 judgeSync 起手按 SCHEMA §5.1 记为 policy:<id>@<ver>，此处不再重复
       （历史此处补的是无前缀 <id>@<ver>，与 §5.1 的两种合法形态都不符，已删）。 */
    if (Array.isArray(capResult.constraints)) {
      for (const c of capResult.constraints) if (c.grant_ref) d.authorization_refs.push(`grant:${c.grant_ref}`)
    }
    push(transition(d.status, 'authorized'))

    /* 步骤 6：公理与策略版本（冲突显式返回，不自行挑有利规则） */
    const ax = checkAxioms(request.operation, policy, { hostVersion: opts.hostVersion, moduleVersion: MODULE_VERSION })
    if (!ax.ok) {
      d.status = ax.code === 'VERSION' ? transition(d.status, 'policy_version_conflict') : transition(d.status, 'axiom_conflict')
      d.reason = ax.code
      d.conflicts = ax.detail?.conflicts || [JSON.stringify(ax.detail || {})]
      return die()
    }
    push(transition(d.status, 'axioms_ok'))

    /* 步骤 7：预算校验（DECLARED：超限记录不中断，§5.5） */
    const b = checkBudget({ requested: request.constraints?.budget || {}, limits, usage: opts.usage || {} })
    if (!b.ok) {
      for (const ex of b.exceeded) {
        recordOverrun({ ...ex, request_digest: opts.requestDigest || null, at: opts.now }, opts.overrunSink)
      }
      d.status = transition(d.status, 'budget_exceeded')
      d.reason = `配额超限（DECLARED，仅记录）：${b.exceeded.map((e) => e.item).join(', ')}`
      applicable('quota:DECLARED')
      return die()
    }
    if (validity.expired) {
      d.status = transition(d.status, 'constraint_expired')
      d.reason = '约束有效期已过'
      return die()
    }
    push(transition(d.status, 'budget_ok'))

    /* 步骤 9：回执准备（执行状态默认未验证，客户端无可信执行环境） */
    d.execution_status_default = policy.defaults.execution_status_default

    /* 步骤 10：人工确认（母体无机制 → PENDING，不得跳过） */
    const needApproval = (policy.defaults?.human_approval_operations || []).includes(request.operation)
    if (needApproval && !request.evidence_refs.includes('human_approval')) {
      d.status = transition(d.status, 'human_approval_missing')
      d.reason = '第 10 步人工确认：母体无人工确认机制（MISSING），不得跳过'
      d.missing_evidence.push('human_approval')
      d.path.push('STEP10')
      return die()
    }

    /* 放行：仅代表「门放行」，不代表业务执行成功（§5.4） */
    d.status = 'AUTHORIZED_FOR_EXECUTION'
    d.allowed_operations = [request.operation]
    return d
  } catch (e) {
    // S-08：异常不得静默吞掉，转为显式 CONFLICT/UNAVAILABLE
    d.status = 'UNAVAILABLE'
    d.reason = `判定过程异常：${String(e && e.message ? e.message : e)}`
    d.conflicts = ['judge_internal_error']
    return die()
  }
}

/**
 * 母体钩子接口：loader 在 authorize 之后、实例化前调用（§10.2-4）。
 * 只消费到 AUTHORIZED_FOR_EXECUTION；执行是母体 loader 的事。
 * 异步：需要算规范化请求摘要并落存证（IO 层）。
 */
export async function judge(request, opts = {}) {
  const st = STATE
  const o = {
    policyState: st?.policy || DEFAULT_POLICY,
    revoked: st?.revoked || [],
    anchor: st?.anchor || null,
    now: opts.now !== undefined ? opts.now : (st?.clock ? st.clock() : Date.now()),
    usage: st?.usage || {},
    hostVersion: st?.hostVersion,
    limits: st?.limits,
    credential: opts.credential,
    delegated_from: opts.delegated_from,
    delegation_chain: opts.delegation_chain,
    overrunSink: st ? (rec) => appendEvent(st, { ...rec, request_digest: null }) : undefined,
  }
  let requestDigest = null
  try {
    requestDigest = await sha256Hex(canonicalJSON(request))
  } catch {
    requestDigest = null
  }
  o.requestDigest = requestDigest
  // 回执 io_summary 口径 = 本次判定操作的计数（SCHEMA §5.2），与模块累计 usage 是两套口径。
  let opKvReads = 0
  if (st && st.kv) {
    try {
      const prevRef = `${st.keyPrefix}${st.policy.storage.keys.receipt}${request.request_id}`
      opKvReads = 1 // 已发起重放探测，无论命中与否都算一次读
      o.replay = !!(await st.kv.get(prevRef))
    } catch { o.replay = false }
  }
  const d = judgeSync(request, o)

  // 落存证（IO 层，只存摘要与引用，S-11）
  if (st) {
    const ref = `${st.keyPrefix}${st.policy.storage.keys.receipt}${request.request_id}`
    d.decision_evidence_ref = ref
    try {
      // 十字段回执必须由 buildReceipt 生成（SCHEMA §5 冻结结构）。
      // 2026-10-24 联调修正：此处原为手写对象，字段名写成 status/missing_evidence/path，
      // 与 verifyReceipt 读取的 authorization_result 不一致 —— 自己写的回执自己验不过。
      // 判定理由与路径仍在事件流里留痕，回执只保留契约字段（S-11 只存摘要与引用）。
      const receipt = await buildReceipt(
        request,
        d,
        {
          kv_reads: opKvReads,
          kv_writes: 1, // 本次写入回执本身
          events: 1, // 本次判定的 judge 事件
          evidence_refs: Array.isArray(request.evidence_refs) ? request.evidence_refs : [],
          unverified_items: [...new Set([...(d.unverified_items || []), 'execution_not_attested'])],
        },
        { requestDigest, policyState: st.policy, now: st.clock ? st.clock() : Date.now() },
      )
      // 2026-10-24 二次修正：此处曾写 receipt.io_summary.bytes = JSON.stringify(receipt).length，
      // 属事后改写构造器输出（与本次要修的「绕过 buildReceipt」同类），且自指不稳定、全仓无消费方。
      // 本驱动此时并未真实执行（unverified_items 含 execution_not_attested），无 IO 字节量可记，
      // 故保持构造器默认 0，不做任何事后覆盖。
      await st.kv.put(ref, receipt)
      st.usage.kv_writes = (st.usage.kv_writes || 0) + 1
    } catch (e) {
      appendEvent(st, { kind: 'error', code: 'EVIDENCE_WRITE_FAILED', reason: String(e && e.message ? e.message : e) })
    }
    appendEvent(st, {
      kind: 'judge',
      code: d.status,
      request_digest: requestDigest,
      reason: d.reason || null,
      enforcement: null,
    })
    // 面板联动：最近判定 + 待人工确认（第 10 步 PENDING）
    st.lastStatus = d.status
    if (d.status === 'PENDING') {
      st.pending.push({ request_id: d.request_id, operation: request?.operation, missing_evidence: d.missing_evidence })
    }
    if (typeof st.refresh === 'function') { try { st.refresh() } catch { /* UI 刷新失败不影响判定结论 */ } }
  }
  return d
}

/* ==========================================================================
 * 10. 模块运行时状态与 IO 层（mount / Diagnostics / Evidence 专用）
 * ========================================================================== */

let STATE = null

function appendEvent(st, ev) {
  const rec = { at: st.clock ? st.clock() : null, time_source: 'client_untrusted', ...ev }
  st.events.push(rec)
  if (st.events.length > 500) st.events.splice(0, st.events.length - 500)
  if (typeof st.log === 'function') {
    try { st.log(`[intent-sec] ${rec.kind || 'event'} ${rec.code || ''} ${rec.reason || ''}`.trim()) } catch { /* 日志通道失败不冒泡 */ }
  }
}

/** 撤销/TTL 扫描定时器（≥60s，必须 onDispose 清理，A10）。 */
function startScanTimer(st, ctx) {
  const interval = Math.max(60000, st.policy.defaults?.timer_scan_interval_ms || 60000)
  const id = setInterval(() => {
    const now = st.clock ? st.clock() : Date.now()
    const before = st.revoked.length
    st.revoked = st.revoked.filter((r) => !r.until || now <= r.until)
    if (st.revoked.length !== before) {
      appendEvent(st, { kind: 'scan', code: 'REVOKED_TTL_CLEANED', reason: `清理过期撤销项 ${before - st.revoked.length} 条` })
    }
  }, interval)
  ctx.onDispose(() => clearInterval(id))
  st.timers.push(id)
}

/* ---------- UI：settings.section 安全分区（内联样式 + CSS 变量，R2/R12 降级） ---------- */

function el(tag, opts = {}) {
  const n = document.createElement(tag)
  if (opts.text) n.textContent = opts.text
  if (opts.style) n.style.cssText = opts.style
  if (opts.cls) n.className = opts.cls
  if (opts.attrs) for (const [k, v] of Object.entries(opts.attrs)) n.setAttribute(k, String(v))
  return n
}

const S = {
  wrap: 'display:flex;flex-direction:column;gap:12px;padding:12px;border:1px solid var(--border, rgba(128,128,128,.3));border-radius:8px;margin:8px 0;',
  title: 'font-size:14px;font-weight:600;margin:0 0 4px;color:var(--fg, inherit);',
  hint: 'font-size:12px;opacity:.7;margin:2px 0;color:var(--fg, inherit);',
  row: 'display:flex;justify-content:space-between;gap:8px;font-size:12px;padding:2px 0;color:var(--fg, inherit);',
  badge: 'font-size:11px;padding:1px 6px;border-radius:4px;border:1px solid var(--border, rgba(128,128,128,.3));',
  list: 'margin:0;padding-left:18px;font-size:12px;color:var(--fg, inherit);',
}

function renderPanel(st, host, moduleId) {
  const root = el('div', { cls: 'module-intent-sec', style: S.wrap })
  // 归属标识优先取母体注入的 ctx.id（U-JOINT-3）；旧母体不注入时回退常量，保持向下兼容。
  root.setAttribute('data-module', moduleId || MODULE_ID)
  root.setAttribute('data-intent-sec-version', MODULE_VERSION)

  root.append(el('div', { text: `INT-RLSD 安全驱动 v${MODULE_VERSION}`, style: S.title }))
  root.append(el('div', { text: '根级安全判定内核 · 门放行 ≠ 执行成功', style: S.hint }))

  // 策略（只读展示）
  const p = el('div')
  p.append(el('div', { text: '策略集（只读）', style: S.title + ';font-size:12px' }))
  const row1 = el('div', { style: S.row })
  row1.append(el('span', { text: `${st.policy.policy_id}@${st.policy.policy_version}` }))
  row1.append(el('span', { text: st.policyDigest, style: S.hint + ';font-size:11px' }))
  p.append(row1)
  root.append(p)

  // 信任锚（明示非全球信任根）
  const t = el('div')
  t.append(el('div', { text: '信任锚', style: S.title + ';font-size:12px' }))
  const anchorText = st.anchor
    ? `已配置（${st.anchor.kind || 'local-config'}）— 非全球信任根，身份结论上限 CONDITIONAL`
    : '未配置 — 身份结论不可用（UNAVAILABLE），不默认放行'
  t.append(el('div', { text: anchorText, style: S.hint }))
  root.append(t)

  // 能力边界面板：配额三态对用户可见（§7-3，不得只写在文档里）
  const q = el('div')
  q.append(el('div', { text: '能力边界（配额执行状态）', style: S.title + ';font-size:12px' }))
  for (const [k, it] of Object.entries(st.policy.quotas.items)) {
    const r = el('div', { style: S.row })
    r.append(el('span', { text: `${it.desc}（${k}）` }))
    r.append(el('span', { text: it.enforcement, style: S.badge }))
    q.append(r)
  }
  const g = el('div', { style: S.row })
  g.append(el('span', { text: '未定义配额（不臆造）' }))
  g.append(el('span', { text: 'GAP', style: S.badge }))
  q.append(g)
  q.append(el('div', { text: `WASM 内存 / 单次执行时长 / 并发数：${st.policy.quotas.undefined_no_guessing.join('、')} — 需任务契约明确，v0.0.1 未定义`, style: S.hint }))
  root.append(q)

  // 诊断面板（十枚举可查）
  const dg = el('div')
  dg.append(el('div', { text: '判定状态（主链十态 + 终态）', style: S.title + ';font-size:12px' }))
  const ul = el('ul', { style: S.list })
  for (const s of DECISION_STATES) ul.append(el('li', { text: s }))
  dg.append(ul)
  const st2 = el('div', { style: S.row })
  const statusNode = el('span', { text: `最近判定：${st.lastStatus || '—'}` })
  const eventsNode = el('span', { text: `事件 ${st.events.length} 条`, style: S.hint })
  st2.append(statusNode, eventsNode)
  dg.append(st2)
  root.append(dg)

  // 审批 PENDING 提示容器（第 10 步，母体无人工确认机制；判定后刷新）
  const pendingNode = el('div')
  root.append(pendingNode)

  // 判定后刷新（不重建整棵树，只更新状态区与待确认区）
  st.statusNode = statusNode
  st.eventsNode = eventsNode
  st.pendingNode = pendingNode
  st.refresh = () => {
    if (st.statusNode) st.statusNode.textContent = `最近判定：${st.lastStatus || '—'}`
    if (st.eventsNode) st.eventsNode.textContent = `事件 ${st.events.length} 条`
    if (!st.pendingNode) return
    st.pendingNode.textContent = ''
    if (!st.pending.length) return
    st.pendingNode.append(el('div', { text: `待人工确认 ${st.pending.length} 项`, style: S.title + ';font-size:12px' }))
    const pl = el('ul', { style: S.list })
    for (const m of st.pending.slice(-5)) {
      pl.append(el('li', { text: `${m.request_id} · ${m.operation} · 缺证 ${(m.missing_evidence || []).join('/')}` }))
    }
    st.pendingNode.append(pl)
    st.pendingNode.append(el('div', { text: '母体无人工确认机制（MISSING）：第 10 步返回 PENDING，不跳过', style: S.hint }))
  }
  st.refresh()

  host.append(root)
  return root
}

/* ==========================================================================
 * 11. 默认导出：mount / unmount（母体契约三接口之一）
 * ========================================================================== */

const mod = {
  async mount(ctx) {
    if (STATE) return // 幂等：重复 mount 不重建
    const kv = ctx && ctx.kv ? ctx.kv : null
    const log = ctx && typeof ctx.log === 'function' ? ctx.log : () => {}
    const policy = loadPolicy(undefined).policy
    // kv 双态：kv:sec 获批 → sec:v1:；降级 → cache ns + sec: 前缀（D13）
    const hasSecNs = !!(kv && typeof kv.__ns === 'string' && kv.__ns === 'sec')
    const keyPrefix = hasSecNs ? policy.storage.key_prefix : policy.storage.fallback_key_prefix
    const st = {
      ctx, kv, log,
      policy,
      policyDigest: policyDigest(policy),
      keyPrefix,
      hasSecNs,
      anchor: null,
      revoked: [],
      usage: {},
      events: [],
      pending: [],
      timers: [],
      nodes: [],
      lastStatus: null,
      clock: () => Date.now(),
    }

    // 播种/读取策略
    try {
      if (kv) {
        const raw = await kv.get(`${keyPrefix}${policy.storage.keys.policy}`)
        if (raw) {
          const r = loadPolicy(raw, { hostVersion: ctx.hostVersion })
          if (r.ok) {
            st.policy = r.policy
            st.policyDigest = policyDigest(r.policy)
          } else {
            appendEvent(st, { kind: 'policy', code: r.errors[0]?.code || 'FORMAT', reason: r.errors.map((e) => e.reason).join('; ') })
          }
        } else {
          await kv.put(`${keyPrefix}${policy.storage.keys.policy}`, st.policy)
        }
        const anchor = await kv.get(`${keyPrefix}${policy.storage.keys.trust_anchor}`)
        if (anchor) st.anchor = anchor
        const revoked = await kv.get(`${keyPrefix}${policy.storage.keys.revoked}`)
        if (Array.isArray(revoked)) st.revoked = revoked
      }
    } catch (e) {
      appendEvent(st, { kind: 'error', code: 'KV_INIT_FAILED', reason: String(e && e.message ? e.message : e) })
    }

    STATE = st
    startScanTimer(st, ctx)

    // 槽位渲染（拿不到则降级：只跑逻辑不渲染，不抛错）
    const host = ctx && ctx.slots ? ctx.slots['settings.section'] : null
    if (host && typeof document !== 'undefined') {
      try {
        const node = renderPanel(st, host, ctx.id)
        st.nodes.push(node)
        ctx.onDispose(() => {
          try { node.remove() } catch { /* 幂等清理 */ }
        })
      } catch (e) {
        appendEvent(st, { kind: 'error', code: 'UI_RENDER_FAILED', reason: String(e && e.message ? e.message : e) })
      }
    } else {
      log('[intent-sec] 未拿到 settings.section 槽位，降级为只跑逻辑不渲染')
    }

    ctx.onDispose(() => {
      for (const id of st.timers) clearInterval(id)
      st.timers.length = 0
      STATE = null
    })

    log(`[intent-sec] mounted v${MODULE_VERSION} keyPrefix=${keyPrefix} ns=${hasSecNs ? 'sec' : 'cache(fallback)'}`)
  },

  unmount() {
    if (!STATE) return
    for (const id of STATE.timers) clearInterval(id)
    STATE.timers.length = 0
    for (const n of STATE.nodes) { try { n.remove() } catch { /* 幂等 */ } }
    STATE.nodes.length = 0
    STATE = null
  },
}

export default mod

/* ==========================================================================
 * 12. 诊断与导出（IO 层包装，供 UI / e2e 调用）
 * ========================================================================== */

export function getState() {
  return STATE ? { ...STATE, policy: clone(STATE.policy), events: exportEvents(STATE.events) } : null
}

export function diagnoseLast(opts = {}) {
  const st = STATE
  const last = st && st.events.length ? st.events[st.events.length - 1] : null
  return diagnose(last || {}, { policyState: st ? st.policy : DEFAULT_POLICY, requestDigest: last?.request_digest || null })
}
