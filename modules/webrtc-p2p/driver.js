const t = (k, p) => globalThis.__INTENT_I18N__?.t?.(k, p) ?? k
/**
 * net.webrtc.p2p —— WebRTC 组件驱动（构建产物，请勿手改）
 * 构建：node scripts/build.mjs   源目录：src/
 * 导出：mount / unmount / createNode / getNode / snapshots / describe
 * 安全边界：驱动级纵深防御，非母体强制隔离（详见 docs/SECURITY.md）
 */

/* ===== src/contract.js ===== */
/**
 * 第二驱动契约的数据形态（唯一事实源）。
 *
 * 本文件只允许出现**冻结的数据**，不得含业务逻辑、不得做 I/O、不得引用 DOM 或 Node 内置。
 * 依据：docs/SCHEMA.md；契约写作顺序见 docs/constitution/DRIVER-DEV-KNOWLEDGE-COLLECTION-20261024.md §3。
 *
 * 为什么独立定义限额而不 import src/protocol.js：
 * protocol.js 使用 Buffer.byteLength（Node 专有），无法在浏览器加载；两份值的一致性
 * 由 tests/contract.test.js 的漂移探测断言保证，而不是靠 import。
 */

const SCHEMA_VERSION = '0.3.0-draft';

/** 仅为冻结嵌套结构，不含业务语义。 */
function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

/** 九个状态（SCHEMA §3）。 */
const STATES = deepFreeze({
  DISCONNECTED: 'DISCONNECTED',
  CONNECTING_SIGNALING: 'CONNECTING_SIGNALING',
  JOINING_ROOM: 'JOINING_ROOM',
  NEGOTIATING: 'NEGOTIATING',
  CHANNEL_OPEN: 'CHANNEL_OPEN',
  RECONNECTING: 'RECONNECTING',
  CLOSING: 'CLOSING',
  CLOSED: 'CLOSED',
  FAILED: 'FAILED',
});

/** 终态：不可出边，复活 = 新实例（SCHEMA §4.5）。 */
const TERMINAL_STATES = deepFreeze([STATES.CLOSED, STATES.FAILED]);

/** 触发名枚举（SCHEMA §4.2）。新增触发必须先改这里。 */
const TRIGGERS = deepFreeze({
  CONNECT: 'connect',
  SOCKET_OPEN: 'socket-open',
  PEER_PRESENT: 'peer-present',
  CHANNEL_OPEN: 'channel-open',
  SIGNALING_LOST: 'signaling-lost',
  BACKOFF_ELAPSED: 'backoff-elapsed',
  DISCONNECT: 'disconnect',
  TIMEOUT: 'timeout',
  ERROR: 'error',
  CLEANUP_DONE: 'cleanup-done',
});

/** state-change 的 reason：表达"谁引发的"，供 UI 与日志分类（SCHEMA §7.1）。 */
const REASONS = deepFreeze({
  USER: 'user',
  REMOTE: 'remote',
  TIMEOUT: 'timeout',
  ERROR: 'error',
  INTERNAL: 'internal',
});

/**
 * 转换表：19 条边，唯一事实源（SCHEMA §4.1）。
 * `cleanup` 列出该边必须执行的副作用键名，实际动作由实现提供（状态机只认键名）。
 */
const TRANSITIONS = deepFreeze([
  { id: 'T01', from: STATES.DISCONNECTED, to: STATES.CONNECTING_SIGNALING, on: TRIGGERS.CONNECT, reason: REASONS.USER, cleanup: ['armSignalingConnectTimer', 'openSocket'] },
  { id: 'T02', from: STATES.CONNECTING_SIGNALING, to: STATES.JOINING_ROOM, on: TRIGGERS.SOCKET_OPEN, reason: REASONS.REMOTE, cleanup: ['clearSignalingConnectTimer', 'sendJoin', 'armRoomJoinTimer'] },
  { id: 'T03', from: STATES.CONNECTING_SIGNALING, to: STATES.FAILED, on: TRIGGERS.TIMEOUT, reason: REASONS.TIMEOUT, cleanup: ['clearSignalingConnectTimer', 'closeSocket', 'releaseSocket'] },
  { id: 'T04', from: STATES.CONNECTING_SIGNALING, to: STATES.FAILED, on: TRIGGERS.ERROR, reason: REASONS.ERROR, cleanup: ['clearSignalingConnectTimer', 'closeSocket', 'releaseSocket'] },
  { id: 'T05', from: STATES.CONNECTING_SIGNALING, to: STATES.CLOSING, on: TRIGGERS.DISCONNECT, reason: REASONS.USER, cleanup: ['clearSignalingConnectTimer', 'closeSocket', 'beginTeardown'] },
  { id: 'T06', from: STATES.JOINING_ROOM, to: STATES.NEGOTIATING, on: TRIGGERS.PEER_PRESENT, reason: REASONS.REMOTE, cleanup: ['clearRoomJoinTimer', 'emitRoomJoined', 'createPeer', 'armChannelOpenTimer'] },
  { id: 'T07', from: STATES.JOINING_ROOM, to: STATES.FAILED, on: TRIGGERS.TIMEOUT, reason: REASONS.TIMEOUT, cleanup: ['clearRoomJoinTimer', 'closeSocket', 'releaseSocket'] },
  { id: 'T08', from: STATES.JOINING_ROOM, to: STATES.FAILED, on: TRIGGERS.ERROR, reason: REASONS.ERROR, cleanup: ['clearRoomJoinTimer', 'closeSocket', 'releaseSocket'] },
  { id: 'T09', from: STATES.JOINING_ROOM, to: STATES.CLOSING, on: TRIGGERS.DISCONNECT, reason: REASONS.USER, cleanup: ['clearRoomJoinTimer', 'closeSocket', 'beginTeardown'] },
  { id: 'T10', from: STATES.NEGOTIATING, to: STATES.CHANNEL_OPEN, on: TRIGGERS.CHANNEL_OPEN, reason: REASONS.REMOTE, cleanup: ['clearChannelOpenTimer', 'releaseIceBuffer', 'emitChannelState'] },
  { id: 'T11', from: STATES.NEGOTIATING, to: STATES.FAILED, on: TRIGGERS.TIMEOUT, reason: REASONS.TIMEOUT, cleanup: ['clearChannelOpenTimer', 'closeChannel', 'closePeer', 'closeSocket', 'releaseChannel', 'releasePeer', 'releaseSocket'] },
  { id: 'T12', from: STATES.NEGOTIATING, to: STATES.FAILED, on: TRIGGERS.ERROR, reason: REASONS.ERROR, cleanup: ['clearChannelOpenTimer', 'closeChannel', 'closePeer', 'closeSocket', 'releaseChannel', 'releasePeer', 'releaseSocket'] },
  { id: 'T13', from: STATES.NEGOTIATING, to: STATES.CLOSING, on: TRIGGERS.DISCONNECT, reason: REASONS.USER, cleanup: ['clearChannelOpenTimer', 'closePeer', 'closeSocket', 'beginTeardown'] },
  { id: 'T14', from: STATES.CHANNEL_OPEN, to: STATES.RECONNECTING, on: TRIGGERS.SIGNALING_LOST, reason: REASONS.REMOTE, cleanup: ['closeChannel', 'closePeer', 'releaseChannel', 'releasePeer', 'releaseSocket', 'armBackoffTimer'] },
  { id: 'T15', from: STATES.CHANNEL_OPEN, to: STATES.CLOSING, on: TRIGGERS.DISCONNECT, reason: REASONS.USER, cleanup: ['beginTeardown'] },
  { id: 'T16', from: STATES.RECONNECTING, to: STATES.CONNECTING_SIGNALING, on: TRIGGERS.BACKOFF_ELAPSED, reason: REASONS.INTERNAL, cleanup: ['clearBackoffTimer', 'countReconnect', 'openSocket', 'armSignalingConnectTimer'] },
  { id: 'T17', from: STATES.RECONNECTING, to: STATES.FAILED, on: TRIGGERS.ERROR, reason: REASONS.ERROR, cleanup: ['clearBackoffTimer', 'releaseSocket', 'releasePeer'] },
  { id: 'T18', from: STATES.RECONNECTING, to: STATES.CLOSING, on: TRIGGERS.DISCONNECT, reason: REASONS.USER, cleanup: ['clearBackoffTimer', 'beginTeardown'] },
  { id: 'T19', from: STATES.CLOSING, to: STATES.CLOSED, on: TRIGGERS.CLEANUP_DONE, reason: REASONS.INTERNAL, cleanup: ['runDisposers', 'releaseAll', 'emitClosed'] },
]);

/** 三阶段超时（SCHEMA §5.1）。键名为阶段名，值为默认毫秒数。 */
const TIMEOUT_STAGES = deepFreeze({
  SIGNALING_CONNECT: 'signalingConnect',
  ROOM_JOIN: 'roomJoin',
  CHANNEL_OPEN: 'channelOpen',
});

const DEFAULT_TIMEOUTS = deepFreeze({
  signalingConnect: 10000,
  roomJoin: 10000,
  channelOpen: 20000,
});

/** 超时下限：低于此值视为配置错误（SCHEMA §5.4）。 */
const MIN_TIMEOUT_MS = 1000;

/** 超时阶段 → 失败码（SCHEMA §5.1）。与 DEFAULT_TIMEOUTS 同键，测试断言两者键集相等。 */
const TIMEOUT_CODES = deepFreeze({
  signalingConnect: 'E_SIGNALING_CONNECT_TIMEOUT',
  roomJoin: 'E_ROOM_JOIN_TIMEOUT',
  channelOpen: 'E_CHANNEL_OPEN_TIMEOUT',
});

/** 重连默认参数（SCHEMA §8.1）。只重连信令，不重放应用消息（§13）。 */
const RECONNECT_DEFAULTS = deepFreeze({
  maxAttempts: 5,
  baseDelayMs: 500,
  maxDelayMs: 8000,
});

/**
 * 清理上限（SCHEMA §5.5）：进入 CLOSING 后最长等待清理的毫秒数。
 * 与母体 destroyDrainMs 对齐（web/src/loader/loader.ts:309-311，2000ms）——
 * 驱动不能比装载器更有耐心，否则母体已判定 DESTROYED 而驱动还在清理。
 */
const CLEANUP_MS = 2000;

/**
 * 契约码表（SCHEMA §6.2）。键即码，值为元数据。
 * layer: 'client' | 'server'；retryable 决定调用方是否应退避重试。
 */
const ERROR_CODES = deepFreeze({
  E_SIGNALING_CONNECT_FAILED: { layer: 'client', retryable: true, message: t("driver.webrtc-p2p.driver.message.1") },
  E_SIGNALING_CONNECT_TIMEOUT: { layer: 'client', retryable: true, message: t("driver.webrtc-p2p.driver.message.2") },
  E_ROOM_JOIN_TIMEOUT: { layer: 'client', retryable: true, message: t("driver.webrtc-p2p.driver.message.3") },
  E_CHANNEL_OPEN_TIMEOUT: { layer: 'client', retryable: true, message: t("driver.webrtc-p2p.driver.message.4") },
  E_NEGOTIATION_FAILED: { layer: 'client', retryable: true, message: t("driver.webrtc-p2p.driver.message.5") },
  E_SIGNALING_LOST: { layer: 'client', retryable: true, message: t("driver.webrtc-p2p.driver.message.6") },
  E_TRANSPORT_LOST: { layer: 'client', retryable: true, message: t("driver.webrtc-p2p.driver.message.7") },
  /**
   * 过期信令：answer 收到的时机不对（本端已换新 offer / 新 PC），或 ICE 候选
   * 对不上当前会话（ICE restart 换了 ufrag）。**不是错误，是必须丢掉的旧数据**——
   * 单独给一个码，是为了不让它被并进 E_NEGOTIATION_FAILED 把会话判死，
   * 同时又能在地面真值里看见"确实有旧信令在飞"。
   */
  E_STALE_SIGNAL: { layer: 'client', retryable: false, message: t("driver.webrtc-p2p.driver.message.8") },
  E_RECONNECT_EXHAUSTED: { layer: 'client', retryable: false, message: t("driver.webrtc-p2p.driver.message.9") },
  E_CHANNEL_NOT_OPEN: { layer: 'client', retryable: false, message: t("driver.webrtc-p2p.driver.message.10") },
  E_MESSAGE_TOO_LARGE: { layer: 'client', retryable: false, message: t("driver.webrtc-p2p.driver.message.11") },
  E_ILLEGAL_STATE: { layer: 'client', retryable: false, message: t("driver.webrtc-p2p.driver.message.12") },
  E_DRIVER_CLOSED: { layer: 'client', retryable: false, message: t("driver.webrtc-p2p.driver.message.13") },
  E_INTERNAL: { layer: 'client', retryable: false, message: t("driver.webrtc-p2p.driver.message.14") },
  E_CONFIG_INVALID: { layer: 'client', retryable: false, message: t("driver.webrtc-p2p.driver.message.15") },
  E_CONFIG_FROZEN: { layer: 'client', retryable: false, message: t("driver.webrtc-p2p.driver.message.16") },
  E_MISSING_CREDENTIAL: { layer: 'client', retryable: false, message: t("driver.webrtc-p2p.driver.message.17") },
  E_ROOM_FULL: { layer: 'server', retryable: false, message: t("driver.webrtc-p2p.driver.message.18") },
  E_INVALID_ROOM_ID: { layer: 'server', retryable: false, message: t("driver.webrtc-p2p.driver.message.19") },
  E_INVALID_SIGNAL: { layer: 'server', retryable: false, message: t("driver.webrtc-p2p.driver.message.20") },
  E_SIGNAL_TOO_LARGE: { layer: 'server', retryable: false, message: t("driver.webrtc-p2p.driver.message.21") },
  E_SIGNALING_MESSAGE_TOO_LARGE: { layer: 'server', retryable: false, message: t("driver.webrtc-p2p.driver.message.22") },
  E_INVALID_MESSAGE: { layer: 'server', retryable: false, message: t("driver.webrtc-p2p.driver.message.23") },
  E_NOT_IN_ROOM: { layer: 'server', retryable: false, message: t("driver.webrtc-p2p.driver.message.24") },
  E_UNKNOWN_MESSAGE_TYPE: { layer: 'server', retryable: false, message: t("driver.webrtc-p2p.driver.message.25") },
  E_UNAUTHORIZED: { layer: 'server', retryable: false, message: t("driver.webrtc-p2p.driver.message.26") },
  E_RATE_LIMITED: { layer: 'server', retryable: true, message: t("driver.webrtc-p2p.driver.message.27") },
  E_UNKNOWN_WIRE_CODE: { layer: 'client', retryable: false, message: t("driver.webrtc-p2p.driver.message.28") },
  // --- rev.3 新增（SCHEMA §18.6 壳与节点）---
  E_NODE_EXISTS: { layer: 'client', retryable: false, message: t("driver.webrtc-p2p.driver.message.29") },
  E_NODE_NOT_FOUND: { layer: 'client', retryable: false, message: t("driver.webrtc-p2p.driver.message.30") },
  E_NODE_LIMIT: { layer: 'client', retryable: false, message: t("driver.webrtc-p2p.driver.message.31") },
  E_SHELL_DISPOSED: { layer: 'client', retryable: false, message: t("driver.webrtc-p2p.driver.message.32") },
  E_CANCELLED: { layer: 'client', retryable: false, message: t("driver.webrtc-p2p.driver.message.33") },
  E_BUFFER_FULL: { layer: 'client', retryable: true, message: t("driver.webrtc-p2p.driver.message.34") },
});

/**
 * wire 码 → 契约码（SCHEMA §6.3）。
 * 现状 9 个 wire 码来自 src/server.js 与 src/protocol.js；未知码走 E_UNKNOWN_WIRE_CODE 并保留 cause。
 */
const WIRE_TO_CODE = deepFreeze({
  'invalid-or-oversized-message': 'E_SIGNALING_MESSAGE_TOO_LARGE',
  'invalid-json': 'E_INVALID_MESSAGE',
  'invalid-message-shape': 'E_INVALID_MESSAGE',
  'invalid-room-id': 'E_INVALID_ROOM_ID',
  'room-full': 'E_ROOM_FULL',
  'not-in-room': 'E_NOT_IN_ROOM',
  'invalid-signal': 'E_INVALID_SIGNAL',
  'signal-too-large': 'E_SIGNAL_TOO_LARGE',
  'unknown-message-type': 'E_UNKNOWN_MESSAGE_TYPE',
});

/** 事件集（SCHEMA §7.1）。不做旧名别名。 */
const EVENTS = deepFreeze({
  STATE_CHANGE: 'state-change',
  ROOM_JOINED: 'room-joined',
  PEER_STATE: 'peer-state',
  CHANNEL_STATE: 'channel-state',
  TRANSPORT_STATE: 'transport-state',
  MESSAGE: 'message',
  ERROR: 'error',
  CLOSED: 'closed',
});

/**
 * 三个限额，归属不同（SCHEMA §10）。不得合并描述。
 * 一致性由 tests/contract.test.js 与 src/protocol.js 比对。
 */
const LIMITS = deepFreeze({
  MAX_SIGNAL_BYTES: 256 * 1024,
  MAX_PAYLOAD_BYTES: 200 * 1024,
  MAX_DATA_BYTES: 1024 * 1024,
  /** DataChannel 发送缓冲上限（SCHEMA §10）。超限不排队，直接 E_BUFFER_FULL（可重试）。 */
  MAX_BUFFERED_BYTES: 4 * 1024 * 1024,
});

/** 房间 ID 规则（与服务端 validateRoomId 同源）。 */
const ROOM_ID_PATTERN = '^[A-Za-z0-9_-]{3,48}$';

/** DataChannel 标签（发起端创建，接收端由 datachannel 事件获得）。 */
const DATA_CHANNEL_LABEL = 'intent-os-data';

/**
 * 待处理 ICE candidate 队列上限（SCHEMA §4.6）。
 * 超限丢最旧的一条：新候选更可能对应当前网络路径。
 */
const MAX_PENDING_CANDIDATES = 256;

/**
 * 两种形式（SCHEMA §17）。**形式不改变契约任何一条**——
 * 状态机、事件集、错误码、输出形状与形式无关；UI 只是状态的投影 + 输入映射。
 *
 * 注意：这里只描述驱动**自身运行形式**（headless / ui），恰好两种、不得分叉。
 * 母体侧的「装载形态」是另一套词（capability / ui，见 shell.js 的 HOST_LOAD_FORMS），
 * 两者是映射关系而非同一枚举：capability 装载 → headless 运行。
 */
const FORMS = deepFreeze({
  HEADLESS: 'headless',
  UI: 'ui',
});

/**
 * 形式判定（SCHEMA §17.3）：拿到母体授予的槽位 → `ui`，拿不到 → `headless`。
 * 不失败、不抛错（母体 loader.ts:573-579 对未注册槽位静默跳过，宪法第 38 条降级）。
 * 槽位名来自母体注册表，不得自造（K-04）。
 *
 * rev.3（决策②）：母体当前只注册了 `settings.section`，它是**设置页区块**的语义。
 * 本驱动 UI 首版**不冒充聊天侧栏**：按候选顺序探测，命中哪个就按哪个的语义投影。
 * 未来母体若注册 `chat.sidebar`，驱动无需改代码即可切换（候选表已含）。
 */
const UI_SLOT_CANDIDATES = deepFreeze(['chat.sidebar', 'settings.section']);
const UI_SLOT_NAME = UI_SLOT_CANDIDATES[1]; // 兼容别名：当前唯一可能命中的槽位
/** 兼容槽位的真实语义（不得在文档/UI 中称其为聊天侧栏）。 */
const UI_SLOT_SEMANTICS = deepFreeze({
  'chat.sidebar': 'conversation-sidebar',
  'settings.section': 'settings-block',
});

/**
 * 部件枚举（SCHEMA §19）。部件 = 实例内部持有的、会占用真实资源的对象。
 * 状态与部件的一一对应，是"原子对象"的可验证形式。
 */
const PARTS = deepFreeze({
  SOCKET: 'socket',
  PEER: 'peer',
  CHANNEL: 'channel',
  TIMER_SIGNALING_CONNECT: 'timer:signaling-connect',
  TIMER_ROOM_JOIN: 'timer:room-join',
  TIMER_CHANNEL_OPEN: 'timer:channel-open',
  TIMER_BACKOFF: 'timer:backoff',
  ICE_BUFFER: 'iceBuffer',
});

/**
 * 每个状态**允许存在**的部件（白名单，SCHEMA §19）。
 * 不在白名单里的部件在该状态出现即违规——白名单同时承担"禁止"的职责。
 * 终态为空数组：`CLOSED`/`FAILED` 必须零部件，这是原子对象的出口条件。
 */
const PARTS_BY_STATE = deepFreeze({
  DISCONNECTED: [],
  CONNECTING_SIGNALING: [PARTS.SOCKET, PARTS.TIMER_SIGNALING_CONNECT],
  JOINING_ROOM: [PARTS.SOCKET, PARTS.TIMER_ROOM_JOIN],
  NEGOTIATING: [PARTS.SOCKET, PARTS.PEER, PARTS.CHANNEL, PARTS.TIMER_CHANNEL_OPEN, PARTS.ICE_BUFFER],
  CHANNEL_OPEN: [PARTS.SOCKET, PARTS.PEER, PARTS.CHANNEL],
  RECONNECTING: [PARTS.TIMER_BACKOFF],
  CLOSING: [PARTS.SOCKET, PARTS.PEER, PARTS.CHANNEL],
  CLOSED: [],
  FAILED: [],
});

/**
 * 每个状态**必须存在**的部件（最小集，SCHEMA §19）。
 * `NEGOTIATING` 不要求 `channel`：接收端可能尚未收到 `datachannel` 事件。
 * `NEGOTIATING` 不要求 `iceBuffer`：候选可能已全部处理完（空队列 = 部件不存在）。
 * `CLOSING` 不要求任何部件：销毁顺序由实现决定，只要求"最终全部消失"。
 */
const REQUIRED_PARTS = deepFreeze({
  DISCONNECTED: [],
  CONNECTING_SIGNALING: [PARTS.SOCKET, PARTS.TIMER_SIGNALING_CONNECT],
  JOINING_ROOM: [PARTS.SOCKET, PARTS.TIMER_ROOM_JOIN],
  NEGOTIATING: [PARTS.SOCKET, PARTS.PEER, PARTS.TIMER_CHANNEL_OPEN],
  CHANNEL_OPEN: [PARTS.SOCKET, PARTS.PEER, PARTS.CHANNEL],
  RECONNECTING: [PARTS.TIMER_BACKOFF],
  CLOSING: [],
  CLOSED: [],
  FAILED: [],
});

/**
 * 配置来源优先级（SCHEMA §18.2），**由前到后**。
 * 同名配置多处存在时，取靠前者；来源必须可观测（§18.3）。
 */
const CONFIG_SOURCES = deepFreeze(['injected', 'kv', 'manifest', 'default', 'fallback']);

/**
 * 公共 STUN 兜底清单（SCHEMA §18.8，rev.5）。
 *
 * **触发条件极窄**：`injected` / `kv` / `manifest` / `default` 四档**都没有**
 * `iceServers`（是"未提供"，不是"给了空数组"）。显式 `[]` 表示"我只要 host
 * candidate"，不兜底——这是关闭兜底的唯一手段，不额外设开关。
 *
 * 为什么只放 Google 两个：**只放实测可达的**。塞未验证的服务器进兜底，
 * 等于用"列表长度"假装可用性，候选全失败时反而更难排障。
 * 实测记录（2026-10-24，新加坡节点）：`stun.l.google.com:19302` 2ms 通；
 * `stun.cloudflare.com` 不通，故未收录。
 *
 * 中国大陆通常不可达 —— 国内部署必须自建 coturn 或换国内公共 STUN，
 * 通过 `injected` 覆盖，不要把兜底当成"国内也能用"的承诺。
 *
 * **只含 `stun:`，永不含 `turn:`**：TURN 需要长期凭证，兜底不能凭空造出
 * 一份凭证；把 turn 写进兜底只会让 pc 带着空凭证去被 401。
 */
const PUBLIC_STUN_FALLBACK = deepFreeze([
  { urls: ['stun:stun.l.google.com:19302'] },
  { urls: ['stun:stun1.l.google.com:19302'] },
]);

/**
 * 兜底策略（机读，SCHEMA §18.8）。
 * `privacyCost` 不是修辞：走兜底 = 把本机公网地址暴露给第三方 STUN 运营方。
 */
const FALLBACK_POLICY = deepFreeze({
  trigger: 'iceServers-absent-in-all-sources',
  disableBy: 'explicit-empty-array',
  source: 'fallback',
  schemes: ['stun'],
  privacyCost: 'public-ip-disclosed-to-third-party',
  /** 兜底条目永不携带凭证（它们全是 stun:）。 */
  carriesCredential: false,
});

/**
 * 配置字段表（SCHEMA §18.1）。`allowed` 即该字段被允许的来源集合。
 *
 * **本契约不接受任何秘密字段**（`SECRET_FIELDS` 为空，见下）：
 * 密钥只以 `kv.sec` 句柄形式引用，本体永不进入 `config`。
 * 因此 `credentialRef` 只允许 `injected`——句柄由装配方给出，不是配置的一部分。
 */
const CONFIG_FIELDS = deepFreeze({
  signalingUrl: { required: true, allowed: ['injected', 'kv', 'manifest'] },
  /**
   * `required: false`（rev.5）：四档都缺时走公共 STUN 兜底（§18.8），不再报 missing。
   * `fallback` 是独立来源档，不与 `default` 合并——调用方必须能一眼看出
   * "这个值来自外部公共资源"，因为它有隐私代价，而 `default` 没有。
   */
  iceServers: { required: false, allowed: ['injected', 'kv', 'manifest', 'default', 'fallback'] },
  timeouts: { required: false, allowed: ['injected', 'kv', 'default'] },
  reconnect: { required: false, allowed: ['injected', 'kv', 'default'] },
  credentialRef: { required: false, allowed: ['injected'] },
});

/**
 * 承载秘密的字段：**设计上为空**（SCHEMA §18.4）。
 * 这条空表本身是断言：任何人往配置里加秘密字段，必须先把它登记进本表并接受脱敏测试。
 */
const SECRET_FIELDS = deepFreeze([]);

/** 秘密字段在只读投影中的替代值（SCHEMA §18.4）。 */
const REDACTED = '***';

/**
 * 句柄字段：承载"指向秘密的指针"而非秘密本身（SCHEMA §18.4）。
 * 句柄不脱敏（它本身不敏感，且脱敏后无法排障），但**只允许 injected 来源**。
 */
const CONFIG_HANDLE_FIELDS = deepFreeze(['credentialRef']);

/**
 * 秘密注入面（SCHEMA §18.4，rev.4）。
 *
 * `secretProvider` **不是配置字段**：它不进 `CONFIG_FIELDS`、不参与来源优先级、
 * 不进 config、不进 snapshot。它是一项**能力**——装配方告诉驱动"按这个句柄
 * 去哪里取凭证"，驱动只在这一处把句柄换成 `{username, credential}`。
 *
 * 为什么不由驱动自己读 `ctx.kv.sec`：母体 `makeCtx` 的 kv 只绑定 `nsList[0]`
 * （loader.ts:651-654），一个模块只能有一个命名空间；本驱动声明的是 `kv:cache`，
 * 再要 `kv:sec` 会与安全驱动争用同一命名空间（宪法第 24 条最小权限）。
 */
const SECRET_INJECTION = deepFreeze({
  field: 'secretProvider',
  shape: 'function(ref: string) => Promise<{username: string, credential: string}>',
  isConfigField: false,
  allowedSources: ['injected'],
  /** 解析失败一律 E_MISSING_CREDENTIAL；错误里不得带异常文本（可能夹凭据）。 */
  failureCode: 'E_MISSING_CREDENTIAL',
});

/** 配置键名禁用词（SCHEMA §18.4）：出现即视为"试图把秘密塞进配置"。 */
const FORBIDDEN_CONFIG_KEY_PARTS = deepFreeze(['token', 'secret', 'password', 'apikey', 'credential', 'authorization']);

/** 实例化与配置的边界（SCHEMA §18.5）：构造/mount 只做校验与建壳，不建网络资源。 */
const INSTANTIATION_MAY_NOT = deepFreeze(['openSocket', 'createPeerConnection', 'fetch', 'setTimeout']);

/* ==========================================================================
 * rev.3：壳（Shell）与节点（Node）——组件型驱动的实例模型（SCHEMA §18.6）
 *
 * 三层不许混：
 *   模块实例（manifest，母体 registry 按 id 唯一）→ 壳（1 个）→ 节点（0..N 个）
 * 母体看到的是壳；`CHANNEL_OPEN` 永远是节点的状态，不是模块状态。
 * ========================================================================== */

/** 壳的两种生命周期（映射 loader 的 ACTIVE / DESTROYED，不新增装载器状态）。 */
const SHELL_STATES = deepFreeze({
  MOUNTED: 'MOUNTED',
  DISPOSED: 'DISPOSED',
});

/** 节点 ID 规则：默认节点用固定名，显式多节点由调用方给名。 */
const NODE_ID_PATTERN = '^[A-Za-z0-9_-]{1,32}$';
const DEFAULT_NODE_ID = 'default';
/** 单壳节点上限：防"多节点"退化成资源耗尽（每节点独占 socket + pc + 定时器）。 */
const MAX_NODES = 16;

/**
 * 节点对外方法表（SCHEMA §8.2）。`async` 为 true 的方法必须返回 `Promise<Result<T>>`，
 * 为 false 的返回同步快照。这张表是测试断言"接口完整性"的机读依据。
 */
const NODE_API = deepFreeze({
  connect: { async: true, returns: 'Result<void>' },
  send: { async: true, returns: 'Result<void>' },
  close: { async: true, returns: 'Result<void>' },
  state: { async: false, returns: 'NodeSnapshot' },
  subscribe: { async: false, returns: 'unsubscribe' },
  stats: { async: false, returns: 'Stats' },
});

/** `Result` 的两种判别式（SCHEMA §8.1）。`ok` 是唯一判别键，不做三态。 */
const RESULT_DISCRIMINANT = 'ok';

/**
 * 安全边界声明（SCHEMA §20，决策① = B 方案：驱动自持声明）。
 *
 * 这是**如实记录**，不是安全保证。母体 `makeCtx` 只代理 kv/http/bridge，
 * 而 `new WebSocket()` / `new RTCPeerConnection()` 是浏览器全局构造器——
 * 任何模块都能调用，母体既审计不到也拒绝不了（母体当前零 ws/rtc 代码、无 CSP）。
 *
 * 驱动侧做的是**纵深防御**：入口校验 + 来源校验 + 日志脱敏。
 * 不得在任何对外材料中把它表述为"网络出口白名单"或"母体强制隔离"。
 */
const SECURITY_BOUNDARY = deepFreeze({
  /** 声明方式：驱动自持，母体零改动。 */
  mode: 'driver-self-declared',
  /** 真正受母体能力代理约束的通道。 */
  hostProxied: ['log', 'kv:cache', 'kv:skills', 'kv:sec', 'http:<origin>', 'bridge:read'],
  /** 不受代理约束、由浏览器直接提供的出口（本驱动实际使用）。 */
  hostUnproxied: ['WebSocket', 'RTCPeerConnection', 'RTCDataChannel'],
  /** 母体是否对本驱动的网络出口施加强制隔离。 */
  hostEnforced: false,
  /** 驱动自查项（纵深防御，逐项在配置阶段执行）。 */
  driverChecks: [
    'signalingUrl.scheme-in-(wss,ws)',
    'signalingUrl.no-credentials-in-url',
    'signalingUrl.ws-only-for-localhost',
    'iceServers.entry-shape',
    'iceServers.url-scheme-in-(stun,stuns,turn,turns)',
    'iceServers.turn-requires-credential-ref',
    'config.source-attribution',
    'credentialRef.kv-sec-only',
  ],
  /** 对外表述纪律：这句话必须原样出现在 README/安全文档/测试报告。 */
  claim: 'driver-level-defense-in-depth; NOT host-enforced egress isolation',
});

/* ===== src/result.js ===== */
/**
 * Result 构造器与失败对象（SCHEMA §8.1 / §6.5）。
 *
 * 纪律（CA-D-03 的推广）：
 * 1. 构造器与验证器同源——本文件是**唯一**的 Result 产出点，实现里不得手写 `{ok:...}`。
 * 2. 失败对象字段固定，不允许各方法自己拼字段（K-01 的教训）。
 * 3. 不抛异常表达业务失败；异常只留给"程序写错了"（TypeError 一类）。
 */


/**
 * @typedef {{ok: true, value?: any}} Ok
 * @typedef {{ok: false, error: DriverErrorShape}} Fail
 * @typedef {{code: string, message: string, retryable: boolean, layer: string,
 *            from?: string, trigger?: string, field?: string, source?: string,
 *            missing?: string[], unknown?: string[], detail?: any}} DriverErrorShape
 */

/** 成功。`value` 省略时得到 `{ok:true}`。 */
function ok(value) {
  return value === undefined ? { ok: true } : { ok: true, value };
}

/**
 * 失败。`code` 必须在 ERROR_CODES 里（拼错即抛，属于编程错误，不是业务失败）。
 * @param {string} code
 * @param {object} [extra]
 */
function fail(code, extra) {
  const meta = ERROR_CODES[code];
  if (!meta) throw new TypeError(`未知契约码：${code}（新增码必须先登记进 contract.js）`);
  const err = {
    code,
    message: meta.message,
    retryable: meta.retryable,
    layer: meta.layer,
  };
  if (extra) {
    for (const key of ['from', 'trigger', 'field', 'source', 'missing', 'unknown', 'detail']) {
      if (extra[key] !== undefined) err[key] = extra[key];
    }
  }
  return { ok: false, error: err };
}

/** 判定一个值是不是 Result（只认判别键，不认 instanceof——跨 realm 安全）。 */
function isResult(v) {
  return !!v && typeof v === 'object' && typeof v.ok === 'boolean';
}

/** 取错误码；成功返回 null。用于 stats.lastErrorCode 与日志。 */
function codeOf(result) {
  return result && result.ok === false ? result.error.code : null;
}

/* ===== src/config.js ===== */
/**
 * 配置解析与冻结（SCHEMA §18）。
 *
 * 四条纪律：
 * 1. **只解析，不 I/O**：唯一的异步动作是读一次 `kv`（§18.5 明确允许）与
 *    调用一次 `secretProvider`（凭据句柄解析，§18.4）。
 * 2. **不静默丢弃**：未知键、非法来源、禁用词一律结构化拒绝（§18.2）。
 * 3. **秘密不进配置**：`config` 里只有 `credentialRef` 句柄；解析出的
 *    `{username, credential}` 走**独立返回字段 `iceAuth`**，不并入 config、
 *    不进快照、不进日志（§18.4）。
 * 4. **失败信息不含秘密**：provider 抛错时只报 `detail:'provider-threw'`，
 *    绝不把 `e.message` 带出去——异常文本里常常夹着凭据。
 *
 * 来源优先级：injected > kv > manifest > default > fallback（§18.2）。
 * `fallback` 只对 `iceServers` 生效，且只在四档**都未提供**时触发——
 * 它不是一个"更弱的默认值"，而是"外部公共资源"，有隐私代价（§18.8）。
 * `manifest` 档是**构建期内联**（母体 ctx 不含 manifest，运行时读不到），
 * 由入口文件传入常量；不得据此宣称"驱动运行时可读自身 manifest"（宪法第 41 条）。
 */


const KV_CONFIG_KEY = 'net.webrtc.p2p/config';
const CREDENTIAL_REF_RE = /^kv:sec\/[A-Za-z0-9_.:-]{1,64}$/;
const ICE_URL_RE = /^(stuns?|turns?):[^\s]+$/i;

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const isNonEmptyString = (v) => typeof v === 'string' && v.length > 0;

/** 逐字段记录来源（§18.3 可观测性）。 */
function attribute(field, source) {
  return { field, source };
}

/**
 * 信令 URL 自检（§20 驱动侧纵深防御，**不是**母体强制隔离）。
 * ws:// 仅允许 localhost（开发）；生产必须 wss://；URL 内不得带凭据。
 */
function checkSignalingUrl(url) {
  if (!isNonEmptyString(url)) return { code: 'E_CONFIG_INVALID', extra: { field: 'signalingUrl' } };
  let u;
  try {
    u = new URL(url);
  } catch {
    return { code: 'E_CONFIG_INVALID', extra: { field: 'signalingUrl', detail: 'not-a-url' } };
  }
  if (u.username || u.password) {
    return { code: 'E_CONFIG_INVALID', extra: { field: 'signalingUrl', detail: 'credentials-in-url' } };
  }
  if (u.protocol === 'wss:') return null;
  if (u.protocol === 'ws:') {
    const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]';
    return local ? null : { code: 'E_CONFIG_INVALID', extra: { field: 'signalingUrl', detail: 'ws-not-localhost' } };
  }
  return { code: 'E_CONFIG_INVALID', extra: { field: 'signalingUrl', detail: 'scheme-not-ws' } };
}

/** ICE 服务器条目自检：形状 + scheme + turn 必须配 credentialRef。 */
function checkIceServers(list, hasCredentialRef) {
  if (!Array.isArray(list)) return { field: 'iceServers', detail: 'not-array' };
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    if (!isPlainObject(s)) return { field: `iceServers[${i}]`, detail: 'not-object' };
    const urls = typeof s.urls === 'string' ? [s.urls] : s.urls;
    if (!Array.isArray(urls) || urls.length === 0) return { field: `iceServers[${i}].urls`, detail: 'empty' };
    for (const u of urls) {
      if (typeof u !== 'string' || !ICE_URL_RE.test(u)) {
        return { field: `iceServers[${i}].urls`, detail: 'bad-scheme' };
      }
      if (/^turns?:/i.test(u) && !hasCredentialRef) {
        return { field: `iceServers[${i}].urls`, detail: 'turn-requires-credentialRef' };
      }
    }
    // 凭据本体不得出现在配置里（§18.4）：只允许通过 credentialRef 指向 kv.sec
    if (s.credential !== undefined || s.username !== undefined) {
      return { field: `iceServers[${i}]`, detail: 'inline-credential-forbidden' };
    }
  }
  return null;
}

function checkTimeouts(t) {
  if (!isPlainObject(t)) return { field: 'timeouts', detail: 'not-object' };
  for (const k of Object.keys(t)) {
    if (!(k in DEFAULT_TIMEOUTS)) return { field: `timeouts.${k}`, detail: 'unknown-key' };
    const v = t[k];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < MIN_TIMEOUT_MS) {
      return { field: `timeouts.${k}`, detail: `lt-${MIN_TIMEOUT_MS}` };
    }
  }
  return null;
}

function checkReconnect(r) {
  if (!isPlainObject(r)) return { field: 'reconnect', detail: 'not-object' };
  for (const k of Object.keys(r)) {
    if (!(k in RECONNECT_DEFAULTS)) return { field: `reconnect.${k}`, detail: 'unknown-key' };
  }
  const { maxAttempts, baseDelayMs, maxDelayMs } = { ...RECONNECT_DEFAULTS, ...r };
  if (!Number.isInteger(maxAttempts) || maxAttempts < 0 || maxAttempts > 10) {
    return { field: 'reconnect.maxAttempts', detail: 'out-of-range' };
  }
  if (!Number.isFinite(baseDelayMs) || baseDelayMs < 100) return { field: 'reconnect.baseDelayMs', detail: 'lt-100' };
  if (!Number.isFinite(maxDelayMs) || maxDelayMs < baseDelayMs) {
    return { field: 'reconnect.maxDelayMs', detail: 'lt-base' };
  }
  return null;
}

/**
 * 解析配置。
 * @param {object|undefined|null} input 调用方注入（= injected 来源）
 * @param {{readKv?: (key: string) => Promise<unknown>,
 *          readSecret?: (ref: string) => Promise<{username: string, credential: string}>,
 *          manifestDefaults?: object}} [opts]
 * @returns {Promise<{ok:true,value:{config:object,sources:object,iceAuth:object|null}}|{ok:false,error:object}>}
 */
async function resolveConfig(input, opts = {}) {
  const injected = input === undefined || input === null ? {} : input;
  if (!isPlainObject(injected)) {
    return fail('E_CONFIG_INVALID', { field: 'root', detail: 'not-object' });
  }

  // 1) 键名合法性：未知键与禁用词都不静默丢弃（§18.2）
  const unknown = [];
  for (const key of Object.keys(injected)) {
    if (!(key in CONFIG_FIELDS)) {
      unknown.push(key);
      continue;
    }
    const lower = key.toLowerCase();
    if (FORBIDDEN_CONFIG_KEY_PARTS.some((p) => lower.includes(p)) && key !== 'credentialRef') {
      return fail('E_CONFIG_INVALID', { field: key, detail: 'forbidden-secret-key' });
    }
  }
  if (unknown.length) return fail('E_CONFIG_INVALID', { unknown });

  // 2) 读一次 kv（唯一允许的异步动作）
  let kvConfig = null;
  if (typeof opts.readKv === 'function') {
    try {
      const raw = await opts.readKv(KV_CONFIG_KEY);
      if (isPlainObject(raw)) kvConfig = raw;
      else if (typeof raw === 'string' && raw) {
        try {
          const parsed = JSON.parse(raw);
          if (isPlainObject(parsed)) kvConfig = parsed;
        } catch {
          /* 坏数据按缺失处理，不阻断（配置层不承担存储修复） */
        }
      }
    } catch {
      /* kv 不可用 = 该档缺失；不因此失败（最小权限环境可能没有 kv 能力） */
    }
  }
  const manifestDefaults = isPlainObject(opts.manifestDefaults) ? opts.manifestDefaults : {};

  // 3) 逐字段按优先级取值并记录来源
  const config = {};
  const sources = {};
  const pick = (field) => {
    const meta = CONFIG_FIELDS[field];
    for (const src of CONFIG_SOURCES) {
      if (!meta.allowed.includes(src)) continue;
      const bag = src === 'injected' ? injected : src === 'kv' ? kvConfig : src === 'manifest' ? manifestDefaults : null;
      if (bag && bag[field] !== undefined) return { value: bag[field], source: src };
    }
    return null;
  };

  const credentialRef = pick('credentialRef');
  const hasCredentialRef = !!(credentialRef && isNonEmptyString(credentialRef.value));

  /** 解析出的 TURN 凭证：**独立于 config**，只有 Node 私有字段能持有（§18.4）。 */
  let iceAuth = null;

  // credentialRef：只允许 injected，且必须是 kv:sec 句柄
  if (credentialRef) {
    if (credentialRef.source !== 'injected') {
      return fail('E_CONFIG_INVALID', { field: 'credentialRef', source: credentialRef.source, detail: 'injected-only' });
    }
    if (!CREDENTIAL_REF_RE.test(credentialRef.value)) {
      return fail('E_CONFIG_INVALID', { field: 'credentialRef', detail: 'not-kv-sec-handle' });
    }
    config.credentialRef = credentialRef.value;
    sources.credentialRef = credentialRef.source;

    /**
     * 句柄 → 凭证。这是全工程**唯一**能把秘密取出来的位置。
     *
     * 为什么由调用方注入 `readSecret` 而不是驱动自己读 `ctx.kv`：
     * 母体 `makeCtx` 的 kv 只绑定 `nsList[0]`（loader.ts:651-654），
     * 一个模块只能有一个命名空间。本驱动声明的是 `kv:cache`（配置档），
     * 若再要 `kv:sec` 就会与安全驱动争用同一命名空间，且属宪法第 24 条
     * 最小权限的越界。所以秘密的**存储位置**由装配方决定，驱动只声明
     * "我需要一个能按句柄取到凭证的能力"——注入的是能力，不是数据。
     */
    if (typeof opts.readSecret !== 'function') {
      return fail('E_MISSING_CREDENTIAL', { field: 'credentialRef', detail: 'no-secret-provider' });
    }
    let raw;
    try {
      raw = await opts.readSecret(credentialRef.value);
    } catch {
      // 刻意丢弃 e.message：异常文本常夹带凭据（§18.4 表述纪律）
      return fail('E_MISSING_CREDENTIAL', { field: 'credentialRef', detail: 'provider-threw' });
    }
    if (!isPlainObject(raw) || !isNonEmptyString(raw.username) || !isNonEmptyString(raw.credential)) {
      return fail('E_MISSING_CREDENTIAL', { field: 'credentialRef', detail: 'bad-secret-shape' });
    }
    iceAuth = Object.freeze({ username: raw.username, credential: raw.credential });
  }

  // signalingUrl
  const sig = pick('signalingUrl');
  if (!sig) return fail('E_CONFIG_INVALID', { missing: ['signalingUrl'] });
  const sigErr = checkSignalingUrl(sig.value);
  if (sigErr) return fail(sigErr.code, sigErr.extra);
  config.signalingUrl = sig.value;
  sources.signalingUrl = sig.source;

  /**
   * iceServers（rev.5）：四档都**未提供** → 公共 STUN 兜底（§18.8）。
   *
   * 这里必须区分两件事，混了就丢掉调用方的表达力：
   * - `undefined`（未提供）→ 兜底。调用方没表态，给一个能用的默认。
   * - `[]`（显式空）    → 尊重，仅 host candidate，**不兜底**。这是"我就要直连"
   *                        的明确表达，也是关闭兜底的唯一手段（不另设开关）。
   *
   * 兜底也要过 `checkIceServers` 自检——不因为"是自己写的常量"就跳过校验。
   */
  const ice = pick('iceServers');
  const iceValue = ice ? ice.value : PUBLIC_STUN_FALLBACK;
  const iceSource = ice ? ice.source : 'fallback';
  const iceErr = checkIceServers(iceValue, hasCredentialRef);
  if (iceErr) return fail('E_CONFIG_INVALID', { field: iceErr.field, detail: iceErr.detail });
  config.iceServers = iceValue;
  sources.iceServers = iceSource;

  // timeouts
  const t = pick('timeouts');
  if (t) {
    const tErr = checkTimeouts(t.value);
    if (tErr) return fail('E_CONFIG_INVALID', { field: tErr.field, detail: tErr.detail });
    config.timeouts = { ...DEFAULT_TIMEOUTS, ...t.value };
    sources.timeouts = t.source;
  } else {
    config.timeouts = { ...DEFAULT_TIMEOUTS };
    sources.timeouts = 'default';
  }

  // reconnect
  const r = pick('reconnect');
  if (r) {
    const rErr = checkReconnect(r.value);
    if (rErr) return fail('E_CONFIG_INVALID', { field: rErr.field, detail: rErr.detail });
    config.reconnect = { ...RECONNECT_DEFAULTS, ...r.value };
    sources.reconnect = r.source;
  } else {
    config.reconnect = { ...RECONNECT_DEFAULTS };
    sources.reconnect = 'default';
  }

  // 4) 冻结：返回深冻结副本，调用方拿不到可变引用
  return ok({
    config: freezeDeep(config),
    sources: Object.freeze(sources),
    // 凭证单独返回：不进 config、不进 projectConfig、不进 snapshot
    iceAuth,
  });
}

/** 只读投影：逐字段 `{value, source}`，秘密字段恒 `***`（本驱动无秘密字段）。 */
function projectConfig(config, sources) {
  const out = {};
  for (const key of Object.keys(config)) {
    out[key] = {
      value: key === 'credentialRef' ? REDACTED : config[key],
      source: sources[key] ?? 'default',
    };
  }
  return Object.freeze(out);
}

/** 校验 roomId（运行期入参，不是配置）。 */
function isValidRoomId(roomId) {
  return typeof roomId === 'string' && new RegExp(ROOM_ID_PATTERN).test(roomId);
}

function freezeDeep(v) {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const k of Object.keys(v)) freezeDeep(v[k]);
  }
  return v;
}

/* ===== src/node.js ===== */
/**
 * 节点（Node）：一个完整的 WebRTC 端（SCHEMA §15–§19、§18.6）。
 *
 * 一个 Node = 一条独立连接 = 一套独立部件（socket/peer/channel/4 个定时器/iceBuffer）。
 * Node 不感知母体、不感知 Shell；一切外部副作用走注入的 `env`（§9）。
 * 这样状态机可以在没有浏览器、没有网络的条件下逐边测试。
 *
 * 实现纪律：
 * - 状态跃迁只能经 `#apply`，副作用只能经 `EFFECTS` 表（键名与 TRANSITIONS.cleanup 同源）。
 * - 部件增删与跃迁同 tick（§19.3）：`#apply` 里先执行副作用、再切状态、再断言部件表。
 * - 不抛业务异常：对外一律 `Promise<Result<T>>`。
 */


const T = TRIGGERS;

/** 终态判定。 */
const isTerminal = (s) => TERMINAL_STATES.includes(s);

/** 按 `from + trigger` 查边（唯一事实源是 TRANSITIONS，不在代码里写 if-else 链）。 */
function findEdge(from, on) {
  return TRANSITIONS.find((e) => e.from === from && e.on === on) || null;
}

/** 定时器键名 → 部件名。 */
const TIMER_PARTS = {
  armSignalingConnectTimer: PARTS.TIMER_SIGNALING_CONNECT,
  armRoomJoinTimer: PARTS.TIMER_ROOM_JOIN,
  armChannelOpenTimer: PARTS.TIMER_CHANNEL_OPEN,
  armBackoffTimer: PARTS.TIMER_BACKOFF,
};
const CLEAR_EFFECTS = {
  clearSignalingConnectTimer: PARTS.TIMER_SIGNALING_CONNECT,
  clearRoomJoinTimer: PARTS.TIMER_ROOM_JOIN,
  clearChannelOpenTimer: PARTS.TIMER_CHANNEL_OPEN,
  clearBackoffTimer: PARTS.TIMER_BACKOFF,
};

class Node {
  /**
   * @param {object} opts
   * @param {string} opts.nodeId
   * @param {object} opts.env   { openSocket, createPeerConnection, now, setTimeout, clearTimeout }
   * @param {object} opts.config  已冻结配置（config.js 产出）
   * @param {object} opts.sources 逐字段来源
   * @param {{username:string, credential:string}|null} [opts.iceAuth]
   *   TURN 凭证。**只存在本实例的私有字段**：不进 config、不进 snapshot、
   *   不进 stats、不进日志（§18.4）。每次建 pc 时临时合进 iceServers。
   * @param {(event: string, detail: object) => void} [opts.onEvent]
   */
  constructor({ nodeId, env, config, sources, iceAuth = null, onEvent }) {
    if (!nodeId) throw new TypeError(t("driver.webrtc-p2p.driver.error.2"));
    if (!env || typeof env.openSocket !== 'function' || typeof env.createPeerConnection !== 'function') {
      throw new TypeError(t("driver.webrtc-p2p.driver.error.3"));
    }
    this.nodeId = nodeId;
    this._env = env;
    this._config = config;
    this._sources = sources;
    /** TURN 凭证：私有字段，任何投影面都读不到（§18.4）。 */
    this._iceAuth = iceAuth || null;
    this._onEvent = onEvent || (() => {});

    this._state = STATES.DISCONNECTED;
    /** @type {Map<string, any>} 部件表：键必须是 PARTS 中的值 */
    this._parts = new Map();
    this._subs = new Set();

    this._roomId = null;
    this._initiator = false;
    this._peerCount = 0;
    this._frozen = false;
    this._disposed = false;
    this._closing = null;
    this._deferred = null;
    this._lastEvent = null;
    /** 传输自愈账本：{ attempts, lastAt }；CHANNEL_OPEN 下 ICE 失效时用 */
    this._transportRecovery = null;
    /** 信令串行队列（见 _enqueueSignal）：SDP 处理有 await，必须一条条来 */
    this._signalQueue = Promise.resolve();
    /** 协商代号：每发一份 offer 自增；`_pendingGen` 是当前在等哪一代的 answer */
    this._gen = 0;
    this._pendingGen = null;

    this._stats = {
      messagesSent: 0,
      messagesReceived: 0,
      bytesSent: 0,
      bytesReceived: 0,
      reconnects: 0,
      lastErrorCode: null,
      /**
       * 失败原因的人话补充。只有 lastErrorCode 时，"E_NEGOTIATION_FAILED" 无法区分
       * 是 setRemoteDescription 撞了非法状态、还是 createAnswer 抛错——真机排障时
       * 这一句往往就是唯一线索（面板「复制诊断」会带上）。
       */
      lastErrorDetail: null,
      /**
       * ICE 候选摘要（`L:host/.local×2 R:host×2`）。真机排障的唯一抓手：
       * 只剩一句 `ice-failed` 时，无法区分「候选根本没交换」「只拿到 .local
       * （mDNS 名解析不了）」「候选都到了但一对都没通」——三者修法完全不同。
       */
      iceSummary: '',
    };

    /** 候选账本：本地发出的 / 远端收到的，按 `type/地址形态` 记 */
    this._ice = { local: [], remote: [], dropped: 0 };
  }

  /* ------------------------------------------------------------------ 只读面 */

  get state() {
    return this._state;
  }

  /** 对外快照（§16.2 封闭性：只给状态、配置投影、统计、最近事件）。 */
  /**
   * 建 pc 时实际使用的 ICE 配置：把 `_iceAuth` 合进 **turn/turns** 条目。
   *
   * 为什么在这里合而不是在 config 里合：config 是冻结的、可投影的、会被
   * `snapshot()` 读到的；凭证一旦进 config 就等于公开（§18.4）。
   * 这里每次新建对象，不改 `this._config.iceServers`（它被深冻结）。
   * stun 条目不带凭证——给它加 username/credential 会让浏览器把 STUN
   * 请求也走长期凭证流程，既无效又有害。
   */
  _peerIceServers() {
    const list = this._config.iceServers;
    if (!this._iceAuth) return list;
    return list.map((server) => {
      const urls = typeof server.urls === 'string' ? [server.urls] : server.urls || [];
      const needsAuth = urls.some((u) => /^turns?:/i.test(u));
      return needsAuth
        ? { ...server, username: this._iceAuth.username, credential: this._iceAuth.credential }
        : server;
    });
  }

  /**
   * 记一条候选（本地发出 / 远端收到）。
   *
   * 记的是「类型 + 地址形态」而不是完整候选：真机日志里能看懂的只有
   * `host/.local`（mDNS 名，能否解析取决于浏览器与系统权限）、`host/ip`（真实内网地址）、
   * `srflx/ip`（STUN 反射，同机两端拿到的是同一个公网地址，靠 NAT 回环）、`relay`。
   * 同一台手机上两个节点能不能直连，全看有没有 `host/ip` 或 `.local` 能不能解析。
   */
  _noteCandidate(side, cand) {
    const c = cand || {};
    const raw = typeof c.candidate === 'string' ? c.candidate : '';
    const type = c.type || (/typ\s+(\w+)/.exec(raw) || [])[1] || '?';
    const addr = c.address || c.ip || (/candidate:\S+ \d+ \w+ \d+ (\S+)/.exec(raw) || [])[1] || '';
    const shape = /\.local$/i.test(addr) ? '.local' : !addr ? '?' : addr.includes(':') ? 'v6' : 'ip';
    const list = side === 'local' ? this._ice.local : this._ice.remote;
    list.push(`${type}/${shape}`);
    if (list.length > 24) list.shift();
    this._stats.iceSummary = this._iceSummary();
  }

  _iceSummary() {
    const cnt = (arr) => {
      if (!arr.length) return '0';
      const m = new Map();
      for (const k of arr) m.set(k, (m.get(k) || 0) + 1);
      return [...m.entries()].map(([k, n]) => `${k}×${n}`).join(',');
    };
    const drop = this._ice.dropped > 0 ? ` drop:${this._ice.dropped}` : '';
    return `L:${cnt(this._ice.local)} R:${cnt(this._ice.remote)}${drop}`;
  }

  /**
   * 失败时的 ICE 全貌（含 getStats 的候选对状态）。
   *
   * 自有账本只能说明"交换了什么"，`candidate-pair` 才说明"试了什么、为什么没通"：
   * - `pairs:0` → 没有可配对的候选（多半是候选没到，或全是 mDNS 名解析不了）；
   * - `pairs:2[failed,failed]` → 配对存在但打洞全败（同机两端常见于只有 srflx、NAT 不回环）。
   */
  async _describeIce(pc) {
    let out = this._iceSummary();
    try {
      const st = await pc.getStats();
      let local = 0;
      let remote = 0;
      const pairs = [];
      st.forEach((r) => {
        if (!r) return;
        if (r.type === 'local-candidate') local += 1;
        else if (r.type === 'remote-candidate') remote += 1;
        else if (r.type === 'candidate-pair') pairs.push(`${r.state}${r.selected ? '*' : ''}`);
      });
      out += ` stats[L${local} R${remote}] pairs:${pairs.length ? pairs.join(',') : 0}`;
    } catch {
      /* getStats 不可用（PC 已关）：自有账本已经够用 */
    }
    return out;
  }

  snapshot() {
    return Object.freeze({
      nodeId: this.nodeId,
      state: this._state,
      roomId: this._roomId,
      initiator: this._initiator,
      peerCount: this._peerCount,
      config: projectConfig(this._config, this._sources),
      stats: Object.freeze({ ...this._stats }),
      lastEvent: this._lastEvent,
    });
  }

  /**
   * 诊断面：部件名列表。**不属于契约可观测面**（§16.2），仅供测试与排障。
   * 命名以下划线开头，提醒调用方不要依赖。
   */
  _inspectParts() {
    return [...this._parts.keys()].sort();
  }

  stats() {
    return Object.freeze({ ...this._stats });
  }

  /** 订阅快照。回调同步触发一次当前快照（订阅即得现状，避免"等下一次变化"）。 */
  subscribe(cb) {
    if (typeof cb !== 'function') throw new TypeError(t("driver.webrtc-p2p.driver.error.4"));
    this._subs.add(cb);
    try {
      cb(this.snapshot());
    } catch {
      /* 订阅者异常不影响驱动 */
    }
    return () => this._subs.delete(cb);
  }

  /* ------------------------------------------------------------------ 公开方法 */

  /**
   * 建连。只在 `CHANNEL_OPEN` 或 `FAILED`/`CLOSED` 时 resolve。
   * @param {{roomId: string, initiator?: boolean}} options
   * @returns {Promise<{ok:true,value?:any}|{ok:false,error:object}>}
   */
  async connect(options) {
    const opts = options || {};
    if (this._disposed) return fail('E_DRIVER_CLOSED');

    if (this._state === STATES.CHANNEL_OPEN) {
      return ok({ state: this._state, peerCount: this._peerCount });
    }
    if (isTerminal(this._state)) return fail('E_DRIVER_CLOSED');
    if (this._state !== STATES.DISCONNECTED) {
      return fail('E_ILLEGAL_STATE', { from: this._state, trigger: 'connect' });
    }
    if (!isValidRoomId(opts.roomId)) return fail('E_INVALID_ROOM_ID', { field: 'roomId' });

    this._roomId = opts.roomId;
    this._initiator = opts.initiator === true;
    this._frozen = true; // 首次 connect 起配置冻结（§18.3）

    const d = deferred();
    this._deferred = d;
    this._apply(T.CONNECT);
    return d.promise;
  }

  /**
   * 发送。判定顺序固定（§8.3），不可调换。
   * @param {string|object} data
   */
  async send(data) {
    if (isTerminal(this._state)) return fail('E_DRIVER_CLOSED');
    if (this._state !== STATES.CHANNEL_OPEN) {
      return fail('E_ILLEGAL_STATE', { from: this._state, trigger: 'send' });
    }
    const channel = this._parts.get(PARTS.CHANNEL);
    if (!channel || channel.readyState !== 'open') return fail('E_CHANNEL_NOT_OPEN');

    let serialized;
    try {
      serialized = typeof data === 'string' ? data : JSON.stringify(data);
    } catch {
      return fail('E_CONFIG_INVALID', { field: 'data', detail: 'not-serializable' });
    }
    if (typeof serialized !== 'string') {
      return fail('E_CONFIG_INVALID', { field: 'data', detail: 'not-serializable' });
    }
    const bytes = new TextEncoder().encode(serialized).byteLength;
    if (bytes > LIMITS.MAX_DATA_BYTES) {
      return fail('E_MESSAGE_TOO_LARGE', { detail: { bytes, limit: LIMITS.MAX_DATA_BYTES } });
    }
    // 缓冲上限：不排队，直接可重试拒绝（SCHEMA §8.6 第 6 步）
    const buffered = typeof channel.bufferedAmount === 'number' ? channel.bufferedAmount : 0;
    if (buffered + bytes > LIMITS.MAX_BUFFERED_BYTES) {
      return fail('E_BUFFER_FULL', {
        detail: { buffered, bytes, limit: LIMITS.MAX_BUFFERED_BYTES },
      });
    }
    try {
      channel.send(serialized);
    } catch (e) {
      return fail('E_CHANNEL_NOT_OPEN', { detail: String(e && e.message) });
    }
    this._stats.messagesSent += 1;
    this._stats.bytesSent += bytes;
    return ok({ bytes });
  }

  /**
   * 关闭。幂等；任意非终态可调；会取消进行中的 connect。
   * @returns {Promise<{ok:true,value?:any}|{ok:false,error:object}>}
   */
  async close() {
    if (this._disposed) return ok({ state: this._state, alreadyClosed: true });
    if (isTerminal(this._state)) {
      return ok({ state: this._state, alreadyClosed: true });
    }
    if (this._state === STATES.DISCONNECTED) {
      // 空操作：不跃迁、不发事件（§8.2）
      this._disposed = true;
      return ok({ state: STATES.DISCONNECTED, alreadyClosed: false });
    }
    if (this._state === STATES.CLOSING) return this._closing || ok({ state: STATES.CLOSING });
    this._apply(T.DISCONNECT);
    return this._closing || ok({ state: this._state });
  }

  /* ------------------------------------------------------------------ 状态机核心 */

  /**
   * 唯一跃迁入口。
   * @param {string} trigger
   * @param {object} [payload]
   */
  _apply(trigger, payload = {}) {
    const edge = findEdge(this._state, trigger);
    if (!edge) {
      // 非法转换不抛：记事件 + 返回（§4.4）。CLOSING 期间的一切传输事件都落在这里。
      this._emit(EVENTS.ERROR, {
        code: 'E_ILLEGAL_STATE',
        from: this._state,
        trigger,
        ignored: true,
      });
      return null;
    }
    const from = this._state;
    // 1) 副作用（与跃迁同 tick）
    for (const effect of edge.cleanup) {
      const fn = this._effects[effect];
      if (!fn) throw new Error(`契约声明了未实现的副作用：${effect}（${edge.id}）`);
      fn.call(this, payload);
    }
    // 2) 切状态
    this._state = edge.to;
    // 3) 断言部件表（§19.3 第 2 条）
    this._assertParts(edge.id);
    // 4) 事件与订阅者
    this._emit(EVENTS.STATE_CHANGE, { from, to: edge.to, trigger, reason: edge.reason });
    this._settle(edge, payload);
    return edge;
  }

  /** 状态跃迁后，把 connect 的 deferred 结算掉。 */
  _settle(edge, payload) {
    const d = this._deferred;
    if (!d || d.done) return;
    if (edge.to === STATES.CHANNEL_OPEN) {
      d.resolve(ok({ state: edge.to, peerCount: this._peerCount }));
      d.done = true;
      this._deferred = null;
    } else if (edge.to === STATES.FAILED) {
      const code = payload && payload.code ? payload.code : this._stats.lastErrorCode || 'E_INTERNAL';
      d.resolve(fail(code, { from: edge.from, trigger: edge.on }));
      d.done = true;
      this._deferred = null;
    } else if (edge.to === STATES.CLOSED) {
      d.resolve(fail('E_CANCELLED', { from: edge.from, trigger: edge.on }));
      d.done = true;
      this._deferred = null;
    }
  }

  /** 部件表断言：白名单 + 必需集（§19.3 第 1、2 条）。违规即实现 bug，直接抛。 */
  _assertParts(edgeId) {
    const allowed = PARTS_BY_STATE[this._state];
    const required = REQUIRED_PARTS[this._state];
    if (!allowed || !required) throw new Error(t("driver.webrtc-p2p.driver.error.6", { _state: this._state }));
    const present = new Set(this._parts.keys());
    const extra = [...present].filter((p) => !allowed.includes(p));
    const missing = required.filter((p) => !present.has(p));
    if (extra.length || missing.length) {
      throw new Error(
        `部件表违规（${edgeId} → ${this._state}）：多余 [${extra.join(',')}] 缺失 [${missing.join(',')}]`,
      );
    }
  }

  /* ------------------------------------------------------------------ 部件操作 */

  _putPart(name, value) {
    this._parts.set(name, value);
  }

  _takePart(name) {
    const v = this._parts.get(name);
    this._parts.delete(name);
    return v;
  }

  _hasPart(name) {
    return this._parts.has(name);
  }

  _armTimer(partName, ms, onFire) {
    const prev = this._parts.get(partName);
    if (prev) this._env.clearTimeout(prev);
    const handle = this._env.setTimeout(() => {
      this._parts.delete(partName);
      onFire();
    }, ms);
    this._putPart(partName, handle);
  }

  _clearTimer(partName) {
    const handle = this._parts.get(partName);
    if (handle !== undefined) {
      this._env.clearTimeout(handle);
      this._parts.delete(partName);
    }
  }

  /* ------------------------------------------------------------------ 副作用表 */

  /**
   * 副作用表：键名必须与 TRANSITIONS[].cleanup 完全一致。
   * 测试会断言"契约里出现的键，这里都有实现"——这是契约与实现的唯一绑定点。
   */
  get _effects() {
    return EFFECTS;
  }

  /* ------------------------------------------------------------------ 事件 */

  _emit(type, detail = {}) {
    this._lastEvent = Object.freeze({ type, at: this._env.now(), ...detail });
    try {
      this._onEvent(type, detail);
    } catch {
      /* 转发方异常不影响驱动 */
    }
    for (const cb of this._subs) {
      try {
        cb(this.snapshot());
      } catch {
        /* 订阅者异常不影响驱动 */
      }
    }
  }
}

/* ==========================================================================
 * 副作用实现表（键 = TRANSITIONS.cleanup 中的字符串）
 * ========================================================================== */

const EFFECTS = {
  /* --- 定时器 --- */
  armSignalingConnectTimer() {
    const ms = this._config.timeouts.signalingConnect;
    this._armTimer(PARTS.TIMER_SIGNALING_CONNECT, ms, () => {
      this._stats.lastErrorCode = 'E_SIGNALING_CONNECT_TIMEOUT';
      this._apply(T.TIMEOUT, { code: 'E_SIGNALING_CONNECT_TIMEOUT', stage: 'signalingConnect' });
    });
  },
  clearSignalingConnectTimer() {
    this._clearTimer(PARTS.TIMER_SIGNALING_CONNECT);
  },
  armRoomJoinTimer() {
    const ms = this._config.timeouts.roomJoin;
    this._armTimer(PARTS.TIMER_ROOM_JOIN, ms, () => {
      this._stats.lastErrorCode = 'E_ROOM_JOIN_TIMEOUT';
      this._apply(T.TIMEOUT, { code: 'E_ROOM_JOIN_TIMEOUT', stage: 'roomJoin' });
    });
  },
  clearRoomJoinTimer() {
    this._clearTimer(PARTS.TIMER_ROOM_JOIN);
  },
  armChannelOpenTimer() {
    const ms = this._config.timeouts.channelOpen;
    this._armTimer(PARTS.TIMER_CHANNEL_OPEN, ms, () => {
      this._stats.lastErrorCode = 'E_CHANNEL_OPEN_TIMEOUT';
      this._apply(T.TIMEOUT, { code: 'E_CHANNEL_OPEN_TIMEOUT', stage: 'channelOpen' });
    });
  },
  clearChannelOpenTimer() {
    this._clearTimer(PARTS.TIMER_CHANNEL_OPEN);
  },
  armBackoffTimer() {
    const { baseDelayMs, maxDelayMs } = this._config.reconnect;
    const n = this._stats.reconnects;
    const ms = Math.min(baseDelayMs * 2 ** n, maxDelayMs);
    this._armTimer(PARTS.TIMER_BACKOFF, ms, () => {
      /**
       * 重连上限判定放在**定时器回调**里，不放在 cleanup 里：
       * cleanup 执行时 `_state` 尚未切换，此时 `_apply` 会以旧状态为起点重入状态机。
       * 回调触发时已是 RECONNECTING，走 T17（RECONNECTING --ERROR--> FAILED）即可，
       * 不需要为"次数耗尽"新增一条边。
       */
      const { maxAttempts } = this._config.reconnect;
      if (this._stats.reconnects >= maxAttempts) {
        this._stats.lastErrorCode = 'E_RECONNECT_EXHAUSTED';
        this._apply(T.ERROR, { code: 'E_RECONNECT_EXHAUSTED', attempts: this._stats.reconnects });
        return;
      }
      this._apply(T.BACKOFF_ELAPSED);
    });
  },
  clearBackoffTimer() {
    this._clearTimer(PARTS.TIMER_BACKOFF);
  },

  /* --- 信令 socket --- */
  openSocket() {
    const socket = this._env.openSocket(this._config.signalingUrl);
    this._putPart(PARTS.SOCKET, socket);
    socket.onopen = () => {
      if (this._state === STATES.CONNECTING_SIGNALING) this._apply(T.SOCKET_OPEN);
    };
    socket.onmessage = (event) => this._onSignal(event && event.data);
    socket.onerror = () => {
      if (this._state === STATES.CONNECTING_SIGNALING) {
        this._stats.lastErrorCode = 'E_SIGNALING_CONNECT_FAILED';
        this._apply(T.ERROR, { code: 'E_SIGNALING_CONNECT_FAILED' });
      } else if (this._state === STATES.JOINING_ROOM) {
        this._stats.lastErrorCode = 'E_SIGNALING_CONNECT_FAILED';
        this._apply(T.ERROR, { code: 'E_SIGNALING_CONNECT_FAILED' });
      } else if (this._state === STATES.NEGOTIATING) {
        this._stats.lastErrorCode = 'E_NEGOTIATION_FAILED';
        this._stats.lastErrorDetail = `socket-error@${this._state}`;
        this._apply(T.ERROR, { code: 'E_NEGOTIATION_FAILED' });
      }
    };
    socket.onclose = () => {
      /**
       * 连接阶段（CONNECTING_SIGNALING）由 onerror / 连接超时负责，避免双路径。
       *
       * 但 JOINING_ROOM / NEGOTIATING 必须在这里兜底：手机锁屏、Wi-Fi 切 4G、
       * 进电梯/隧道、系统回收后台 WebView，socket 经常**只触发 close、不触发
       * error**。旧实现只认 CHANNEL_OPEN，于是节点永远停在 JOINING_ROOM——面板
       * 显示「等对端」，实际信令早就断了，对端再进房也收不到 peer-joined。
       * 这是僵尸态：只能干等房间超时（最长 120s）才报错，期间任何操作都无效。
       */
      if (this._state === STATES.CHANNEL_OPEN) {
        this._apply(T.SIGNALING_LOST);
      } else if (this._state === STATES.JOINING_ROOM || this._state === STATES.NEGOTIATING) {
        this._stats.lastErrorCode = 'E_SIGNALING_CONNECT_FAILED';
        this._stats.lastErrorDetail = `socket-closed@${this._state}`;
        this._apply(T.ERROR, { code: 'E_SIGNALING_CONNECT_FAILED', detail: 'socket-closed' });
      }
    };
  },
  closeSocket() {
    const socket = this._parts.get(PARTS.SOCKET);
    if (!socket) return;
    try {
      socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
      socket.close();
    } catch {
      /* 关闭失败不改变结论：资源仍由 releaseSocket 解除引用 */
    }
  },
  releaseSocket() {
    this._takePart(PARTS.SOCKET);
  },
  sendJoin() {
    const socket = this._parts.get(PARTS.SOCKET);
    if (!socket) throw new Error(t("driver.webrtc-p2p.driver.error.8"));
    socket.send(JSON.stringify({ type: 'join', roomId: this._roomId }));
  },

  /* --- 对端与通道 --- */
  createPeer() {
    const pc = this._env.createPeerConnection({ iceServers: this._peerIceServers() });
    this._putPart(PARTS.PEER, pc);

    pc.onicecandidate = (event) => {
      if (!event || !event.candidate) return;
      const payload = typeof event.candidate.toJSON === 'function' ? event.candidate.toJSON() : event.candidate;
      this._noteCandidate('local', payload);
      this._sendSignal('ice-candidate', payload);
    };
    pc.onconnectionstatechange = () => {
      this._emit(EVENTS.TRANSPORT_STATE, { state: pc.connectionState, iceState: pc.iceConnectionState });
      if (pc.connectionState === 'failed') {
        if (this._state === STATES.NEGOTIATING) {
          this._stats.lastErrorCode = 'E_NEGOTIATION_FAILED';
          this._stats.lastErrorDetail = `ice-failed@${this._state}(ice=${pc.iceConnectionState} · ${this._iceSummary()})`;
          this._apply(T.ERROR, { code: 'E_NEGOTIATION_FAILED', detail: this._stats.lastErrorDetail });
          // 补上候选对状态（异步，失败也已经判完，这里只是把原因写全）
          void this._describeIce(pc).then((more) => {
            this._stats.lastErrorDetail = `ice-failed@${this._state}(ice=${pc.iceConnectionState} · ${more})`;
          });
        } else if (this._state === STATES.CHANNEL_OPEN) {
          /**
           * 通道已开之后 ICE 失效（跨网打洞断、NAT 映射被回收、Wi-Fi/蜂窝切换）：
           * 状态机里 CHANNEL_OPEN 只有 signaling-lost / disconnect 两条出边，
           * 没有"传输失败"的出口——所以这里既不跃迁、也不假装还活着，而是
           * **就地自愈**：发起方做一次 ICE restart（重新收集候选、重新连通性检查，
           * DataChannel 与 DTLS 关联保留），应答方等对方的新 offer。
           *
           * 这条路径是「打通后维持住」的关键：没有它，通道一断就永久假活，
           * 面板一直显示"可收发"，实际数据全丢。
           */
          this._recoverTransport('failed');
        }
      } else if (pc.connectionState === 'connected') {
        // 恢复即清账：把上一轮的失败标记与重试计数归零，避免下次误判"已放弃"
        this._transportRecovery = null;
        if (this._stats.lastErrorCode === 'E_TRANSPORT_LOST') this._stats.lastErrorCode = null;
      }
    };
    pc.ondatachannel = (event) => this._attachChannel(event.channel);

    if (this._initiator) {
      this._attachChannel(pc.createDataChannel(DATA_CHANNEL_LABEL, { ordered: true }));
    }
    // 协商由 peer-present 之后立即触发：发起方 createOffer
    if (this._initiator) this._negotiate();
  },
  closePeer() {
    const pc = this._parts.get(PARTS.PEER);
    if (!pc) return;
    try {
      pc.onicecandidate = pc.onconnectionstatechange = pc.ondatachannel = null;
      pc.close();
    } catch {
      /* 同上：close 失败不改变"不再使用"的结论 */
    }
  },
  releasePeer() {
    this._takePart(PARTS.PEER);
  },
  closeChannel() {
    const ch = this._parts.get(PARTS.CHANNEL);
    if (!ch) return;
    try {
      ch.onopen = ch.onmessage = ch.onclose = ch.onerror = null;
      ch.close();
    } catch {
      /* 同上 */
    }
  },
  releaseChannel() {
    this._takePart(PARTS.CHANNEL);
  },
  releaseIceBuffer() {
    this._takePart(PARTS.ICE_BUFFER);
  },
  emitChannelState() {
    const ch = this._parts.get(PARTS.CHANNEL);
    this._emit(EVENTS.CHANNEL_STATE, { state: ch ? ch.readyState : 'open' });
  },
  emitRoomJoined() {
    this._emit(EVENTS.ROOM_JOINED, { roomId: this._roomId, peerCount: this._peerCount });
  },
  countReconnect() {
    this._stats.reconnects += 1;
  },

  /* --- 关闭 --- */
  beginTeardown() {
    if (this._closing) return;
    this._closing = this._teardown();
  },
  runDisposers() {
    /* Node 自身不注册外部 disposer；壳负责。保留键位以对齐契约。 */
  },
  releaseAll() {
    for (const name of [...this._parts.keys()]) this._parts.delete(name);
    this._assertParts('releaseAll');
  },
  emitClosed() {
    this._disposed = true;
    this._emit(EVENTS.CLOSED, { nodeId: this.nodeId, state: STATES.CLOSED });
  },
};

/* ==========================================================================
 * 传输事件处理（不属于状态跃迁表，属于"输入"）
 * ========================================================================== */

Node.prototype._attachChannel = function attachChannel(channel) {
  this._putPart(PARTS.CHANNEL, channel);
  channel.onopen = () => {
    if (this._state === STATES.NEGOTIATING) this._apply(T.CHANNEL_OPEN);
  };
  channel.onmessage = (event) => {
    this._stats.messagesReceived += 1;
    const raw = event && event.data;
    this._stats.bytesReceived += typeof raw === 'string' ? new TextEncoder().encode(raw).byteLength : 0;
    let data = raw;
    let format = 'text';
    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          data = parsed;
          format = 'json';
        }
      } catch {
        /* 非 JSON 即 text（§7.1.2） */
      }
    }
    this._emit(EVENTS.MESSAGE, { data, format });
  };
  channel.onclose = () => {
    this._emit(EVENTS.CHANNEL_STATE, { state: 'closed' });
    // 通道在"已开"状态下自己关了：多半是 ICE 先断。走同一条自愈路径
    // （pc 的 failed 事件可能紧随其后，cooldown 会去重）。
    if (this._state === STATES.CHANNEL_OPEN) this._recoverTransport('channel-closed');
  };
  channel.onerror = () => {
    this._emit(EVENTS.CHANNEL_STATE, { state: 'error' });
  };
};

Node.prototype._sendSignal = function sendSignal(signalType, payload) {
  const socket = this._parts.get(PARTS.SOCKET);
  if (!socket) return;
  try {
    socket.send(JSON.stringify({ type: 'signal', signalType, payload }));
  } catch {
    /* 信令发不出去由 socket.onerror/onclose 统一处理 */
  }
};

Node.prototype._negotiate = async function negotiate(iceRestart = false) {
  const pc = this._parts.get(PARTS.PEER);
  if (!pc) return;
  try {
    const offer = iceRestart ? await pc.createOffer({ iceRestart: true }) : await pc.createOffer();
    await pc.setLocalDescription(offer);
    const desc = pc.localDescription;
    /**
     * 协商代号：每发一份 offer 自增一次，随 payload 一起发出去，应答方原样回填。
     * 用途只有一个——认出"这份 answer 属于哪一代 offer"（见 answer 分支）。
     */
    this._gen = (this._gen || 0) + 1;
    this._pendingGen = this._gen;
    const payload = typeof desc.toJSON === 'function' ? desc.toJSON() : desc;
    this._sendSignal('offer', { ...payload, __gen: this._gen });
  } catch (e) {
    /**
     * 这里曾经写成 `${signalType}: ...`——但 `_negotiate` 里根本没有 signalType 变量，
     * 于是 catch 自己先抛 ReferenceError：错误详情丢了，`_apply(T.ERROR)` 也没执行，
     * 节点就卡在 NEGOTIATING 一直等到 45s 超时。真机表现是"点了没反应，过一会儿才报错"。
     */
    this._stats.lastErrorCode = 'E_NEGOTIATION_FAILED';
    this._stats.lastErrorDetail = `create-offer: ${String(e && e.message).slice(0, 160)}`;
    if (this._state === STATES.NEGOTIATING) {
      this._apply(T.ERROR, { code: 'E_NEGOTIATION_FAILED', detail: String(e && e.message) });
    }
  }
};

/**
 * CHANNEL_OPEN 状态下的传输自愈。
 *
 * 为什么放在这里而不是状态机里：契约给 CHANNEL_OPEN 只留了两条出边
 * （signaling-lost / disconnect），传输层抖动不构成"连接结束"——它会自己好，
 * 或者需要一次 ICE restart。把它做成跃迁会让一次 5 秒的网络抖动直接把会话判死。
 *
 * 纪律：
 * - 发起方最多 restart 两次、间隔 ≥5s（防抖，也防双方同时重协商产生 glare）；
 * - 应答方不主动 restart，只等对方的新 offer（`_handleSignalPayload` 已支持
 *   CHANNEL_OPEN 下接收 offer 并回 answer）；
 * - 每次失败都 `E_TRANSPORT_LOST` 上报，面板据此把"假活"标红。
 */
Node.prototype._recoverTransport = function recoverTransport(reason) {
  const now = this._env.now();
  // lastAt 初值取 -Infinity：首次失效必须立刻尝试，不能被"冷却"误挡
  const rec = this._transportRecovery || { attempts: 0, lastAt: -Infinity };
  const MAX_ATTEMPTS = 2;
  const COOLDOWN_MS = 5000;

  this._stats.lastErrorCode = 'E_TRANSPORT_LOST';
  this._emit(EVENTS.ERROR, { code: 'E_TRANSPORT_LOST', reason, attempts: rec.attempts });

  if (!this._initiator) return; // 应答方等对方 offer，不自行重协商
  if (rec.attempts >= MAX_ATTEMPTS) return; // 已用尽，保持现状并让面板显式提示
  if (now - rec.lastAt < COOLDOWN_MS) return; // 冷却窗口内不重复发起

  this._transportRecovery = { attempts: rec.attempts + 1, lastAt: now };
  this._negotiate(true);
};

Node.prototype._onSignal = async function onSignal(raw) {
  if (this._state === STATES.CLOSING || isTerminal(this._state)) return;
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    this._emit(EVENTS.ERROR, { code: 'E_INVALID_MESSAGE', detail: 'invalid-json' });
    return;
  }
  if (!msg || typeof msg !== 'object') {
    this._emit(EVENTS.ERROR, { code: 'E_INVALID_MESSAGE', detail: 'invalid-shape' });
    return;
  }

  switch (msg.type) {
    case 'ready': {
      this._peerCount = Number(msg.peerCount) || 1;
      if (this._state === STATES.JOINING_ROOM && this._peerCount >= 2 && this._initiator) {
        this._apply(T.PEER_PRESENT);
      }
      break;
    }
    case 'peer-joined': {
      this._peerCount = 2;
      if (this._state === STATES.JOINING_ROOM && this._initiator) {
        this._apply(T.PEER_PRESENT);
      } else if (this._state === STATES.CHANNEL_OPEN && this._initiator) {
        /**
         * 对端重连 / 重新入房（手机切后台回来、刷新页面、断网重连都会触发）。
         *
         * 对端那边往往是一个**全新的 RTCPeerConnection**，它只会等一份新 offer。
         * 这时候两条路都不行：
         * - 重放上一轮的旧 offer：SDP 与 ICE 凭据都是上一代的，对端要么拿过期凭据
         *   重协商（表现是"连上几秒又掉"），要么直接 setRemoteDescription 抛错进
         *   E_NEGOTIATION_FAILED；
         * - 什么都不做：对端停在 NEGOTIATING 干等到超时（E_CHANNEL_OPEN_TIMEOUT）。
         * 所以这里必须重新协商一次（带 ICE restart，顺手换掉可能已失效的候选）。
         *
         * **只在 CHANNEL_OPEN 下重协商**。NEGOTIATING 下不能重发：那时上一份 offer
         * 还在飞，而母体方言层会把 outbox 里的旧 offer 一起重放给对端——对端会先答
         * 旧 offer，本端再用这份"上一代的 answer"去配新 offer，ICE 凭据对不上，
         * 通道永远打不开（e2e L28 就是这么炸的）。NEGOTIATING 的晚到场景由重放覆盖。
         */
        this._negotiate(true);
      }
      break;
    }
    case 'signal': {
      /**
       * **必须串行**：SDP 处理里有多个 await（setRemoteDescription / _flushIce /
       * createAnswer / setLocalDescription），一旦两条信令的处理器交错执行，
       * 状态就会被对方改掉——现场实测到的报错是
       * `createAnswer: PeerConnection cannot create an answer in a state other than
       * have-remote-offer`（第 1 条 offer 在 await 里被第 2 条 rollback 回 stable，
       * 回来再 createAnswer 就非法）。10 轮自测里稳定复现 1~2 轮。
       *
       * 交错从哪来：zsjws 不存历史，方言层会把"对端未进房时发出的 offer/ICE"在
       * peer-joined 时重放一遍；若那条 offer 其实已经投递过，对端就会**连收两份
       * 相同的 offer**，两个 async 处理器同时在跑。
       *
       * 队列化后：同一节点的信令严格按到达顺序一条条处理完再处理下一条，
       * 配合下面的重复 offer 去重，状态不会再被并发改坏。
       */
      this._enqueueSignal(msg.signalType, msg.payload);
      break;
    }
    case 'peer-left': {
      this._peerCount = Math.max(0, this._peerCount - 1);
      this._emit(EVENTS.PEER_STATE, { state: 'left', peerCount: this._peerCount });
      break;
    }
    case 'error': {
      const code = WIRE_TO_CODE[msg.code] || 'E_UNKNOWN_WIRE_CODE';
      this._stats.lastErrorCode = code;
      this._emit(EVENTS.ERROR, { code, wire: msg.code });
      if (this._state === STATES.CONNECTING_SIGNALING) this._apply(T.ERROR, { code });
      else if (this._state === STATES.JOINING_ROOM) this._apply(T.ERROR, { code });
      else if (this._state === STATES.NEGOTIATING) this._apply(T.ERROR, { code });
      break;
    }
    default:
      this._emit(EVENTS.ERROR, { code: 'E_UNKNOWN_MESSAGE_TYPE', detail: msg.type });
  }
};

Node.prototype._enqueueSignal = function enqueueSignal(signalType, payload) {
  const prev = this._signalQueue || Promise.resolve();
  this._signalQueue = prev.then(async () => {
    if (this._state === STATES.CLOSING || isTerminal(this._state)) return;
    try {
      await this._handleSignalPayload(signalType, payload);
    } catch (e) {
      // _handleSignalPayload 内部已兜住大部分异常；这里是最后一道，保证队列不会
      // 因为一条坏信令变成 rejected promise（那会让后续所有信令都被跳过）。
      this._stats.lastErrorCode = 'E_NEGOTIATION_FAILED';
      this._stats.lastErrorDetail = `${signalType}: ${String(e && e.message).slice(0, 160)}`;
      if (this._state === STATES.NEGOTIATING) {
        this._apply(T.ERROR, { code: 'E_NEGOTIATION_FAILED', detail: String(e && e.message) });
      } else {
        this._emit(EVENTS.ERROR, { code: 'E_NEGOTIATION_FAILED', detail: String(e && e.message) });
      }
    }
  });
  return this._signalQueue;
};

Node.prototype._handleSignalPayload = async function handleSignalPayload(signalType, payload) {
  // 先记账再处理：哪怕这条候选后面被丢掉，也能看出"到过、但没用上"
  if (signalType === 'ice-candidate') this._noteCandidate('remote', payload);
  // 收到 offer 说明对端已在房间：接收端此前可能还停在 JOINING_ROOM
  if (this._state === STATES.JOINING_ROOM && signalType === 'offer') {
    this._peerCount = 2;
    this._apply(T.PEER_PRESENT);
  }
  /**
   * 应答端在还没收到 offer 时（仍在 JOINING_ROOM），对端的 ICE 候选可能先到——
   * 发起方一进房就开始收集候选，而应答方的 PEER_PRESENT 要等 offer 才触发。
   * 旧实现走到下面的 return 就**直接丢掉**这些候选，等 PC 建好时已经晚了：
   * 丢光了就只剩 offer 之后的零星候选，偶发 ICE 检查失败 → 状态机判
   * E_NEGOTIATION_FAILED（真机表现是"连了四五秒又失败"，重来一次可能就好）。
   * 这里先入缓冲，等 PEER_PRESENT 建好 PC、setRemoteDescription 之后由
   * _flushIce 统一补进去。
   */
  if (this._state === STATES.JOINING_ROOM && signalType === 'ice-candidate') {
    const buf = this._parts.get(PARTS.ICE_BUFFER) || [];
    buf.push(payload);
    while (buf.length > MAX_PENDING_CANDIDATES) buf.shift();
    this._putPart(PARTS.ICE_BUFFER, buf);
    return;
  }
  if (this._state !== STATES.NEGOTIATING && this._state !== STATES.CHANNEL_OPEN) {
    if (signalType === 'ice-candidate') this._ice.dropped += 1;
    return;
  }
  let pc = this._parts.get(PARTS.PEER);
  if (!pc) {
    if (signalType === 'ice-candidate') this._ice.dropped += 1;
    return;
  }
  /**
   * 信令重连后旧 PC 可能已经关了（切后台被冻结、连接被服务端判死后重连都会发生）。
   * 这时任何 SDP/ICE 操作都会抛 InvalidStateError("signalingState is 'closed'")，
   * 被下面的 catch 兜住后整个会话直接判 E_NEGOTIATION_FAILED——用户看到的是
   * "刚回到前台就失败"，但真实原因只是**用了一个已经死掉的 PC**。
   * 所以先确认 PC 可用，不可用就换一个新的再处理这条信令。
   */
  if (pc.signalingState === 'closed' || pc.connectionState === 'closed') {
    this._rebuildPeer();
    pc = this._parts.get(PARTS.PEER);
    if (!pc) return;
  }

  try {
    if (signalType === 'offer') {
      /**
       * 重复 / 冲突 offer 的防御（现场踩过：E_NEGOTIATION_FAILED）。
       *
       * 信令断连重连后，服务端会给先到者再发一次 peer-joined；对端若把上一轮
       * offer 重发一遍，本端可能正处在 have-remote-offer（上一条还没应答完）或
       * stable。直接 setRemoteDescription 会抛 InvalidStateError，整个会话被判
       * E_NEGOTIATION_FAILED —— 用户看到的只是"连上了又断了"。
       *
       * - SDP 与当前 remoteDescription 完全一致：重复投递。不重设（会破坏现有会话），
       *   只补发一次 answer —— 上一次 answer 很可能在信令断连时丢了。
       * - 处于 have-remote-offer / have-local-offer：先 rollback 回 stable 再接受。
       */
      const remoteSdp = pc.remoteDescription && pc.remoteDescription.sdp;
      const incomingSdp = payload && payload.sdp;
      if (remoteSdp && incomingSdp && remoteSdp === incomingSdp) {
        /**
         * 同一份 offer 的**重复投递**（方言层重放 + 原始投递都到了）。
         *
         * - stable：上一条已经答完，answer 可能丢在信令断连里，补发一次即可；
         * - have-remote-offer：**上一条正在答**（createAnswer 还在 await 里）。
         *   绝不能在这里 rollback —— 那会把正在处理的处理器打回 stable，
         *   它回来再 createAnswer 就抛 "cannot create an answer in a state other
         *   than have-remote-offer"。重复投递本身不需要任何动作，直接丢弃。
         */
        if (pc.signalingState === 'stable') {
          const again = pc.currentLocalDescription || pc.localDescription;
          if (again) {
            const desc = typeof again.toJSON === 'function' ? again.toJSON() : again;
            // 同一份 offer 的重发，代际号必须原样带回，否则对端会当成过期 answer 丢掉
            this._sendSignal('answer', payload && payload.__gen != null ? { ...desc, __gen: payload.__gen } : desc);
          }
        }
        return;
      }
      if (pc.signalingState === 'have-remote-offer' || pc.signalingState === 'have-local-offer') {
        try {
          await pc.setLocalDescription({ type: 'rollback' });
        } catch {
          /* 不支持 rollback 的旧实现：继续走原路径，由下面的 catch 如实上报 */
        }
      }
      await pc.setRemoteDescription(payload);
      await this._flushIce();
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      const desc = pc.localDescription;
      const answerPayload = typeof desc.toJSON === 'function' ? desc.toJSON() : desc;
      this._sendSignal(
        'answer',
        payload && payload.__gen != null ? { ...answerPayload, __gen: payload.__gen } : answerPayload,
      );
    } else if (signalType === 'answer') {
      /**
       * 只接受"正在等的那份 answer"。信令重连 / 对端重建之后，对端上一轮发的
       * answer 可能还在路上，此时本端已经换成了新 offer（甚至新 PC）——
       * 直接 setRemoteDescription 会抛 InvalidStateError，把会话判死。
       * 这种过期 answer 没有任何价值，丢掉即可。
       */
      if (pc.signalingState !== 'have-local-offer') {
        this._emit(EVENTS.ERROR, { code: 'E_STALE_SIGNAL', detail: `answer@${pc.signalingState}` });
        return;
      }
      /**
       * 光看 signalingState 不够：**上一代的 answer 也可能正好落在 have-local-offer 上**
       * ——本端刚发了新 offer（ICE restart / 对端重进房后的重新协商），旧 answer 恰好
       * 这时到达，状态合法、内容过期，setRemoteDescription 要么直接抛
       * `Failed to set remote answer sdp`（实测踩到，整轮判 E_NEGOTIATION_FAILED），
       * 要么被接受、用旧 ICE 凭据建出一条永远连不上的链路。
       *
       * 判代际用**协议内自带的序号**（`__gen`），不猜 SDP：
       * 每发一份 offer 就 +1，并把它写在 payload 里；应答方原样回填进 answer。
       * 这样"这份 answer 是哪一代 offer 的"是确定的。
       * 对端若不是本驱动（不回填 __gen），按老行为接受，保持互通。
       *
       * 注意别用 `a=ice-ufrag` 比对：offer 与 answer 的 ufrag 是**各自生成**的，
       * 本来就不同，拿它判代际会把所有正常 answer 全丢掉（踩过这个坑）。
       */
      if (payload && payload.__gen != null && this._pendingGen != null && payload.__gen !== this._pendingGen) {
        this._emit(EVENTS.ERROR, {
          code: 'E_STALE_SIGNAL',
          detail: `answer-gen:${payload.__gen}≠${this._pendingGen}`,
        });
        return;
      }
      const { __gen: _gen, ...answerDesc } = payload || {};
      await pc.setRemoteDescription(answerDesc);
      await this._flushIce();
    } else if (signalType === 'ice-candidate') {
      if (pc.remoteDescription) {
        // ICE restart 之后旧候选必然对不上新的 ufrag：单条失败不能拖垮协商
        try {
          await pc.addIceCandidate(payload);
        } catch (e) {
          this._emit(EVENTS.ERROR, { code: 'E_STALE_SIGNAL', detail: `ice:${String(e && e.message).slice(0, 80)}` });
        }
      } else {
        const buf = this._parts.get(PARTS.ICE_BUFFER) || [];
        buf.push(payload);
        while (buf.length > MAX_PENDING_CANDIDATES) buf.shift();
        this._putPart(PARTS.ICE_BUFFER, buf);
      }
    } else {
      this._emit(EVENTS.ERROR, { code: 'E_INVALID_SIGNAL', detail: signalType });
    }
  } catch (e) {
    this._stats.lastErrorCode = 'E_NEGOTIATION_FAILED';
    this._stats.lastErrorDetail = `${signalType}: ${String(e && e.message).slice(0, 160)}`;
    if (this._state === STATES.NEGOTIATING) {
      this._apply(T.ERROR, { code: 'E_NEGOTIATION_FAILED', detail: String(e && e.message) });
    } else {
      this._emit(EVENTS.ERROR, { code: 'E_NEGOTIATION_FAILED', detail: String(e && e.message) });
    }
  }
};

Node.prototype._flushIce = async function flushIce() {
  const pc = this._parts.get(PARTS.PEER);
  const buf = this._takePart(PARTS.ICE_BUFFER);
  if (!pc || !buf) return;
  for (const c of buf) {
    try {
      await pc.addIceCandidate(c);
    } catch {
      /* 单条候选失败不阻断其余候选 */
    }
  }
};

/**
 * 换一个全新的 RTCPeerConnection（通道一起换）。
 *
 * 只用于"旧 PC 已经不可用"这一种情况：信令重连回来、发现 peer 处于 closed。
 * 发起方换完会立刻重发 offer（createPeer 自带），应答方换完就等对端的新 offer。
 * 注意这里**不动信令 socket**——连接是好的，坏的只是协商层。
 */
Node.prototype._rebuildPeer = function rebuildPeer() {
  this._stats.lastErrorCode = null;
  this._transportRecovery = null;
  EFFECTS.closeChannel.call(this);
  EFFECTS.releaseChannel.call(this);
  EFFECTS.closePeer.call(this);
  EFFECTS.releasePeer.call(this);
  EFFECTS.releaseIceBuffer.call(this);
  EFFECTS.createPeer.call(this);
};

/* ==========================================================================
 * 关闭流程（异步，受 CLEANUP_MS 上限约束）
 * ========================================================================== */

Node.prototype._teardown = async function teardown() {
  const started = this._env.now();
  // 部件关闭是同步的；这里串行执行，保证"先通道、再对端、最后信令"
  try {
    EFFECTS.closeChannel.call(this);
    EFFECTS.closePeer.call(this);
    EFFECTS.closeSocket.call(this);
  } catch {
    /* 单个部件关闭异常不阻断其余 */
  }
  for (const name of Object.values(TIMER_PARTS)) this._clearTimer(name);

  // 给底层 onclose 回调一个微任务窗口，再判定清理是否超时
  await Promise.resolve();
  const waited = this._env.now() - started;
  this._drainWaitedMs = waited;
  this._cleanupIncomplete = waited > CLEANUP_MS;
  this._apply(T.CLEANUP_DONE);
  return ok({ state: this._state });
};

/* ==========================================================================
 * 工具
 * ========================================================================== */

function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve, done: false };
}

/* ===== src/shell.js ===== */
/**
 * 壳（Shell）：组件型驱动的实例容器（SCHEMA §18.6）。
 *
 * 一个 manifest 模块实例 = 一个 Shell = 0..N 个 Node。
 * 母体 `registry` 按 id 唯一，只约束 Shell，不约束 Node——这是多房间/多对端
 * 不需要多份 manifest 的原因，也是"不修改母体 Loader"的实现基础。
 *
 * Shell 不持有任何连接资源；连接资源全部归 Node（宪法第 22 条：谁创建谁释放）。
 */


const NODE_ID_RE = new RegExp(NODE_ID_PATTERN);

/**
 * 母体装载形态词表（与驱动自身 FORMS 是映射关系，不是同一枚举）：
 *   capability → FORMS.HEADLESS（无 UI 装载，只给能力，不占槽位）
 *   ui         → FORMS.UI      （带 UI 装载，把 UI 投影到槽位）
 * 驱动运行形式仍只有 headless / ui 两种（SCHEMA §17 不得分叉）。
 */
const HOST_LOAD_FORMS = Object.freeze({ CAPABILITY: 'capability', UI: 'ui' });

class Shell {
  /**
   * @param {object} opts
   * @param {object} opts.ctx        母体注入的能力上下文（§24）
   * @param {object} opts.env        传输环境（默认浏览器全局，测试注入假实现）
   * @param {object} [opts.manifestDefaults] 构建期内联的 manifest 配置档
   * @param {(event:string, detail:object)=>void} [opts.onEvent]
   */
  constructor({ ctx, env, manifestDefaults = {}, onEvent } = {}) {
    if (!ctx) throw new TypeError(t("driver.webrtc-p2p.driver.error.9"));
    if (!env) throw new TypeError(t("driver.webrtc-p2p.driver.error.10"));
    this.ctx = ctx;
    this.env = env;
    this.manifestDefaults = manifestDefaults;
    this.onEvent = onEvent || (() => {});

    this.state = SHELL_STATES.MOUNTED;
    /** @type {Map<string, Node>} */
    this.nodes = new Map();
    /** @type {Map<string, object>} nodeId → handle（冻结门面） */
    this.handles = new Map();
    this.disposePromise = null;

    // 形式在 mount 时一次性判定，生命周期内不可切换（§17.4 F-4）。
    //
    // 两种装载类型（母体 ctx.form 显式指定时优先采信，未指定则按槽位推断以兼容旧母体）：
    //   capability（无 UI 装载）—— 只要能力，不渲染任何 DOM；母体此时不授予槽位，
    //                              即便误授予也一律忽略（形态边界不靠母体单方面保证）。
    //   ui（带 UI 装载）        —— 目的就是把 UI 挂到槽位上；请求了 ui 却没有槽位，
    //                              如实记 uiDegraded（能力仍可用），不把形态偷换成 headless。
    const requestedForm =
      ctx.form === HOST_LOAD_FORMS.UI || ctx.form === HOST_LOAD_FORMS.CAPABILITY ? ctx.form : null;
    const hit = UI_SLOT_CANDIDATES.find((name) => ctx.slots && ctx.slots[name]);
    this.formSource = requestedForm ? 'host-requested' : 'slot-inferred';
    this.uiDegraded = false;
    if (requestedForm === HOST_LOAD_FORMS.CAPABILITY) {
      this.form = FORMS.HEADLESS;
      this.uiSlot = null;
      this.uiSlotSemantics = null;
      try {
        ctx.log('[net.webrtc.p2p] 按 capability（无 UI）形态装载：不占用任何槽位');
      } catch {
        /* 日志通道异常不影响装载 */
      }
    } else if (requestedForm === HOST_LOAD_FORMS.UI) {
      this.form = FORMS.UI;
      this.uiSlot = hit || null;
      this.uiSlotSemantics = hit ? UI_SLOT_SEMANTICS[hit] : null;
      this.uiDegraded = !hit;
      if (!hit) {
        try {
          ctx.log('[net.webrtc.p2p] 请求 ui 形态但未获槽位：UI 无处投影（连接能力不受影响）');
        } catch {
          /* 日志通道异常不影响装载 */
        }
      }
    } else {
      this.form = hit ? FORMS.UI : FORMS.HEADLESS;
      this.uiSlot = hit || null;
      this.uiSlotSemantics = hit ? UI_SLOT_SEMANTICS[hit] : null;
      if (!hit) {
        // 槽位缺失 → 降级 headless，记 warn 不失败（宪法第 38 条）
        try {
          ctx.log('[net.webrtc.p2p] 未获槽位，按 headless 运行（连接能力不受影响）');
        } catch {
          /* 日志通道异常不影响装载 */
        }
      }
    }
  }

  /**
   * 创建节点。**只校验 + 建壳，不发网络请求**（§18.5）。
   * @param {object} [cfg] { nodeId?, signalingUrl, iceServers, timeouts?, reconnect?, credentialRef?,
   *                         secretProvider? }
   *   `secretProvider(ref) => Promise<{username, credential}>` 不是配置项，不参与配置解析、
   *   不进快照；它是**能力注入**（装配方决定秘密存在哪），见 §18.4。
   * @returns {Promise<{ok:true,value:object}|{ok:false,error:object}>}
   */
  async createNode(cfg) {
    if (this.state === SHELL_STATES.DISPOSED) return fail('E_SHELL_DISPOSED');

    const input = cfg || {};
    const nodeId = input.nodeId === undefined ? DEFAULT_NODE_ID : input.nodeId;
    if (typeof nodeId !== 'string' || !NODE_ID_RE.test(nodeId)) {
      return fail('E_CONFIG_INVALID', { field: 'nodeId', detail: 'pattern' });
    }
    if (this.nodes.has(nodeId)) return fail('E_NODE_EXISTS', { detail: nodeId });
    if (this.nodes.size >= MAX_NODES) return fail('E_NODE_LIMIT', { detail: MAX_NODES });

    // nodeId 与 secretProvider 都不参与配置解析：
    // 前者是实例标识，后者是取秘密的能力（不是配置数据）。
    const { nodeId: _ignored, secretProvider, ...configInput } = input;
    if (secretProvider !== undefined && typeof secretProvider !== 'function') {
      return fail('E_CONFIG_INVALID', { field: 'secretProvider', detail: 'not-a-function' });
    }
    const resolved = await resolveConfig(configInput, {
      readKv: this.ctx.kv ? (key) => this.ctx.kv.get(key) : undefined,
      readSecret: secretProvider,
      manifestDefaults: this.manifestDefaults,
    });
    if (!resolved.ok) return resolved;

    // 销毁竞态：解析期间 Shell 可能已被销毁（配置读取是异步的）
    if (this.state === SHELL_STATES.DISPOSED) return fail('E_SHELL_DISPOSED');

    const node = new Node({
      nodeId,
      env: this.env,
      config: resolved.value.config,
      sources: resolved.value.sources,
      iceAuth: resolved.value.iceAuth,
      /**
       * 终态即释放名额（§18.6 N-8）。
       *
       * 节点进 `CLOSED` / `FAILED` 时，连接资源已经在跃迁副作用里关掉了（T03/T04/T07/
       * T08/T11/T12/T17/T19 都带 close+release），它不再持有任何东西；但 `nodes` 表里
       * 那条记录原来永不删除——于是「重建 = 新 nodeId」＋「上限 16」合起来，等于
       * **一个页面生命周期内最多建 16 个节点，关掉的不回收**。
       *
       * 现场表现（也是"是不是只能建一个节点"这个疑问的来源）：反复重连/自愈/自测的
       * 页面，nodeId 后缀一路涨到 `lab-b-9`，再往后 `createNode` 一律 `E_NODE_LIMIT`，
       * 任何重建都失败，看起来就像"这个页面只能有一个节点"。
       */
      onEvent: (event, detail) => {
        if (
          event === EVENTS.STATE_CHANGE &&
          (detail.to === STATES.CLOSED || detail.to === STATES.FAILED)
        ) {
          this.nodes.delete(nodeId);
          this.handles.delete(nodeId);
        }
        this.onEvent(event, { nodeId, ...detail });
      },
    });
    this.nodes.set(nodeId, node);

    /**
     * 走公共 STUN 兜底时留一条日志（§18.8）。
     *
     * 这不是噪音：兜底会把本机公网地址暴露给第三方 STUN 运营方，
     * 装配方有权在日志里看到"这次连接用了外部公共资源"。
     * 只写日志、不改行为——兜底本身是正常的降级路径，不是错误。
     */
    if (resolved.value.sources.iceServers === 'fallback' && typeof this.ctx.log === 'function') {
      const urls = PUBLIC_STUN_FALLBACK.flatMap((s) => (typeof s.urls === 'string' ? [s.urls] : s.urls));
      this.ctx.log(
        `[net.webrtc.p2p] ${nodeId}: 未提供 iceServers，已启用公共 STUN 兜底（${urls.join(', ')}）；` +
          '本机公网地址会暴露给该服务运营方，生产环境请注入自建 STUN/TURN',
      );
    }

    /**
     * 归还名额。两种时机都要：①节点自己走到终态（CLOSED/FAILED，见上面 onEvent）；
     * ②调用方主动 `close()`——注意 `DISCONNECTED` 上的 close 是契约规定的"空操作"
     * （§8.2 不跃迁、不发事件），节点不会进 CLOSED，如果只靠事件回收，**建了没连就
     * 丢弃的节点会永久占着名额**，一样能把 16 个耗光。
     */
    const release = () => {
      const st = node.snapshot().state;
      if (st === STATES.CLOSED || st === STATES.FAILED || st === STATES.DISCONNECTED) {
        if (this.nodes.get(nodeId) === node) this.nodes.delete(nodeId);
        if (this.handles.get(nodeId) === handle) this.handles.delete(nodeId);
      }
    };

    const handle = makeHandle(node, release);
    this.handles.set(nodeId, handle);
    return ok(handle);
  }

  /** 按 id 取句柄；不存在返回 undefined（不抛）。 */
  getNode(nodeId = DEFAULT_NODE_ID) {
    return this.handles.get(nodeId);
  }

  /** 节点快照列表（诊断/UI 用）。 */
  snapshots() {
    return [...this.nodes.values()].map((n) => n.snapshot());
  }

  /**
   * 销毁壳：关闭全部节点，重复调用安全（§11、决策③）。
   * 单个节点 close 失败不阻断其余；最终状态一定是 DISPOSED。
   */
  async dispose() {
    if (this.disposePromise) return this.disposePromise;
    this.state = SHELL_STATES.DISPOSED;
    const all = [...this.nodes.values()];
    this.disposePromise = (async () => {
      const results = await Promise.allSettled(all.map((n) => n.close()));
      const failed = results.filter((r) => r.status === 'rejected').length;
      this.nodes.clear();
      this.handles.clear();
      return ok({ closed: all.length, failed });
    })();
    return this.disposePromise;
  }
}

/**
 * 节点句柄：只暴露契约方法（§8.2 NODE_API），内部状态机不外露。
 * 冻结后不可被调用方替换方法（防止"外面套一层假装成功"）。
 */
function makeHandle(node, onClosed = () => {}) {
  const handle = {
    nodeId: node.nodeId,
    // 显式 async：句柄方法的"异步语义"必须由函数本身保证，
    // 不能依赖被调方恰好返回 Promise（否则调用方 try/catch 与 await 行为不一致）。
    connect: async (options) => node.connect(options),
    send: async (data) => node.send(data),
    close: async () => {
      try {
        return await node.close();
      } finally {
        // 无论 close 成功与否都尝试归还名额：失败时节点仍是活的，release 会自己判断不删
        onClosed();
      }
    },
    state: () => node.snapshot(),
    stats: () => node.stats(),
    subscribe: (cb) => node.subscribe(cb),
    /** 非契约面：诊断部件（下划线前缀，调用方不得依赖）。 */
    _inspectParts: () => node._inspectParts(),
  };
  return Object.freeze(handle);
}

/* ===== src/env.js ===== */
/**
 * 传输环境（SCHEMA §9）。
 *
 * **本文件是全工程唯一允许出现 `new WebSocket(` / `new RTCPeerConnection(` 的地方。**
 * 其余模块一律经 `env.*` 间接调用，测试据此可做静态扫描（tests/boundary.test.js）。
 *
 * 为什么要有这一层：
 * 1. 状态机与超时可以在无浏览器、无网络条件下逐边测试（注入假 socket / 假时钟）；
 * 2. 把"浏览器全局构造器"这个事实收在一个文件里，安全边界文档才有唯一落点（§20）。
 */

/**
 * 浏览器默认环境。
 * @param {object} [g] 全局对象（测试可传沙箱）
 */
function browserEnv(g = globalThis) {
  if (!g || typeof g.WebSocket !== 'function') {
    throw new TypeError(t("driver.webrtc-p2p.driver.error.11"));
  }
  if (typeof g.RTCPeerConnection !== 'function') {
    throw new TypeError(t("driver.webrtc-p2p.driver.error.12"));
  }
  return {
    openSocket(url) {
      return new g.WebSocket(url);
    },
    createPeerConnection(config) {
      return new g.RTCPeerConnection(config);
    },
    now: () => Date.now(),
    setTimeout: (fn, ms) => g.setTimeout(fn, ms),
    clearTimeout: (handle) => g.clearTimeout(handle),
  };
}

/**
 * 无传输环境：只用于"配置与状态机"的离线校验（不建任何连接）。
 * `createNode` 可以用它建壳，但 `connect()` 会立即失败——这是刻意的，
 * 避免"以为连上了"的假象。
 */
function offlineEnv(g = globalThis) {
  return {
    openSocket() {
      throw new Error(t("driver.webrtc-p2p.driver.error.13"));
    },
    createPeerConnection() {
      throw new Error(t("driver.webrtc-p2p.driver.error.14"));
    },
    now: () => Date.now(),
    setTimeout: (fn, ms) => g.setTimeout(fn, ms),
    clearTimeout: (handle) => g.clearTimeout(handle),
  };
}

/* ===== src/ui.js ===== */
/**
 * UI 投影模块（SCHEMA §17.2）—— 驱动自渲染的最小实现（v1：状态投影 + 基础输入映射）。
 *
 * 纪律（§17.5）：
 *  - F-2 纯投影：只读 shell.state / shell.snapshots() / 节点 subscribe() 渲染；
 *        不从 DOM 反推状态、不缓存第二份状态。
 *  - F-3 槽位缺失或环境无 DOM（Node 测试用 {} 充当槽位）→ 直接不挂载，不抛错。
 *  - F-4 形式在 mount 时判定一次（shell.form），本模块只在该形式为 ui 时挂载。
 *
 * 为什么单独成模块：驱动侧 UI 与母体解耦——任何母体只要注册 `chat.sidebar` /
 * `settings.section` 槽位，驱动即可自行投影；母体不需要认识本驱动。
 *
 * 不做的事：不覆盖全局 CSS（全部内联样式）、不改母体布局、不新增状态/事件/错误码。
 */


/** 状态 → 中文短语（仅展示用，不参与任何判定）。 */
const STATE_TEXT = {
  [SHELL_STATES.MOUNTED]: t("driver.webrtc-p2p.driver.text.2"),
  [SHELL_STATES.DISPOSED]: t("driver.webrtc-p2p.driver.text.3"),
  [STATES.CLOSED]: t("driver.webrtc-p2p.driver.text.4"),
  [STATES.FAILED]: t("driver.webrtc-p2p.driver.text.5"),
  [STATES.DISCONNECTED]: t("driver.webrtc-p2p.driver.text.6"),
  [STATES.CONNECTING]: t("driver.webrtc-p2p.driver.text.7"),
  [STATES.CONNECTED]: t("driver.webrtc-p2p.driver.text.8"),
  [STATES.CHANNEL_OPEN]: t("driver.webrtc-p2p.driver.text.9"),
  [STATES.RECONNECTING]: t("driver.webrtc-p2p.driver.text.10"),
};

function stateText(s) {
  return STATE_TEXT[s] || s || '—';
}

/**
 * 错误码 → 可读原因 + 下一步动作（仅展示，不改变任何驱动行为）。
 * 人机测试发现：只显示 `E_CONFIG_INVALID` 时用户不知道要做什么；
 * 信令地址属装配方注入（injected > kv > manifest > default），UI 不代填。
 */
const ERR_TEXT = {
  E_CONFIG_INVALID: t("driver.webrtc-p2p.driver.text.11"),
  E_NODE_EXISTS: t("driver.webrtc-p2p.driver.text.12"),
  E_NODE_LIMIT: t("driver.webrtc-p2p.driver.text.13"),
  E_SHELL_DISPOSED: t("driver.webrtc-p2p.driver.text.14"),
};

function errText(code) {
  if (!code) return t("driver.webrtc-p2p.driver.text.15");
  return ERR_TEXT[code] ? `${ERR_TEXT[code]}（${code}）` : code;
}

/**
 * 挂载 UI 投影。
 * @param {{ctx:object, shell:object}} args
 * @returns {{dispose:()=>void}|null} 未挂载（headless / 无 DOM）返回 null
 */
function mountUi({ ctx, shell }) {
  if (!shell || shell.form !== FORMS.UI) return null;
  const slot = shell.uiSlot && ctx && ctx.slots ? ctx.slots[shell.uiSlot] : null;
  // Node 测试环境槽位是普通对象（无 appendChild）；无 document 同样跳过——降级 headless，不抛错。
  if (!slot || typeof slot.appendChild !== 'function' || typeof document === 'undefined') return null;

  const root = document.createElement('div');
  root.className = 'webrtc-driver-ui';
  root.dataset.driverUi = 'net.webrtc.p2p';
  root.style.cssText = [
    'display:flex',
    'flex-direction:column',
    'gap:6px',
    'padding:8px 10px',
    'border:1px solid var(--line, #e3e6ee)',
    'border-radius:10px',
    'background:var(--surface, #fff)',
    'font-size:12px',
    'line-height:1.5',
    'color:var(--text, #1c2230)',
  ].join(';');

  const head = document.createElement('div');
  head.style.cssText = 'display:flex;align-items:center;gap:8px;flex-wrap:wrap';
  const title = document.createElement('strong');
  title.textContent = 'WebRTC P2P';
  const badge = document.createElement('span');
  badge.dataset.driverUiState = '1';
  badge.style.cssText =
    'font-size:11px;padding:1px 7px;border-radius:999px;background:var(--accent-soft, #eef0fb);color:var(--accent, #4b61d1);font-weight:600';
  const meta = document.createElement('span');
  meta.dataset.driverUiMeta = '1';
  meta.style.cssText = 'color:var(--muted, #6b7280);font-size:11px';
  head.append(title, badge, meta);

  const actions = document.createElement('div');
  actions.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap';
  const mkBtn = (label) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.style.cssText =
      'font-size:11.5px;padding:3px 10px;border-radius:7px;border:1px solid var(--line, #e3e6ee);background:var(--surface-2, #f6f7fb);color:inherit;cursor:pointer';
    return b;
  };
  const addBtn = mkBtn(t("driver.webrtc-p2p.driver.text.16"));
  const refreshBtn = mkBtn(t("driver.webrtc-p2p.driver.text.17"));
  actions.append(addBtn, refreshBtn);

  const list = document.createElement('div');
  list.dataset.driverUiNodes = '1';
  list.style.cssText = 'display:flex;flex-direction:column;gap:4px';

  const note = document.createElement('div');
  note.style.cssText = 'color:var(--muted, #6b7280);font-size:10.5px';

  root.append(head, actions, list, note);
  slot.append(root);

  /** 已订阅的节点句柄（避免重复 subscribe）。 */
  const watched = new Set();
  const unsubs = [];

  function render() {
    badge.textContent = stateText(shell.state);
    meta.textContent = t("driver.webrtc-p2p.driver.text.18", { uiSlot: shell.uiSlot, size: shell.nodes.size });
    list.textContent = '';
    const snaps = shell.snapshots();
    if (!snaps.length) {
      const empty = document.createElement('div');
      empty.style.cssText = 'color:var(--muted, #6b7280);font-size:11px';
      empty.textContent = t("driver.webrtc-p2p.driver.text.19");
      list.append(empty);
    }
    for (const s of snaps) {
      const row = document.createElement('div');
      row.dataset.driverUiNode = s.nodeId;
      row.style.cssText = 'display:flex;align-items:center;gap:8px;justify-content:space-between';
      const info = document.createElement('span');
      info.textContent = `${s.nodeId} · ${stateText(s.state)}`;
      const close = mkBtn(t("driver.webrtc-p2p.driver.text.20"));
      close.dataset.driverUiClose = s.nodeId;
      close.onclick = async () => {
        const h = shell.getNode(s.nodeId);
        if (h) {
          try {
            await h.close();
          } catch {
            /* 关闭失败不阻塞 UI */
          }
        }
        render();
      };
      row.append(info, close);
      list.append(row);
    }
    note.textContent = t("driver.webrtc-p2p.driver.text.21");
  }

  /** 订阅某个节点的事件：事件即状态投影的刷新信号。 */
  function watch(handle) {
    if (!handle || watched.has(handle) || typeof handle.subscribe !== 'function') return;
    watched.add(handle);
    try {
      const off = handle.subscribe(() => render());
      if (typeof off === 'function') unsubs.push(off);
    } catch {
      /* 订阅失败不影响投影 */
    }
  }

  addBtn.onclick = async () => {
    const r = await shell.createNode({});
    if (r && r.ok) {
      watch(r.value);
      render();
    } else {
      note.textContent = t("driver.webrtc-p2p.driver.text.22", { arg1: errText(r && r.error ? r.error.code : null) });
    }
  };
  refreshBtn.onclick = () => {
    for (const h of shell.handles.values()) watch(h);
    render();
  };

  // 初次渲染：把已有节点纳入订阅
  for (const h of shell.handles.values()) watch(h);
  render();

  return {
    dispose() {
      for (const off of unsubs.splice(0)) {
        try {
          off();
        } catch {
          /* 退订失败不影响销毁 */
        }
      }
      watched.clear();
      root.remove();
    },
  };
}

/* ===== src/index.js ===== */
/**
 * 驱动入口（SCHEMA §8、§17、§18.6）。
 *
 * 导出面只有命名导出——**不能用 `export default`**：
 * 母体 `createExportFacade` 把 `default` 记为 unsupported（loader.ts:126-129），
 * 入口会被静默吞掉（宪法第 41 条：这属于"看起来装了、其实没导出"）。
 *
 * 装载链路（母体十一阶段，零改动）：
 *   builtin.json 条目 → load(url) → validate → authorize → fetch → verify → import
 *   → mount(ctx) → ACTIVE → 外部调 createNode(cfg) → 得句柄
 */


/**
 * 构建期内联的 manifest 配置档（§18.2 的 `manifest` 来源）。
 * 母体 ctx 不含 manifest，运行时读不到自己的清单；此常量由 `scripts/build.mjs`
 * 从 `public/manifest.json` 的 `driverConfig` 段**在构建期替换**（标记见下一行）。
 * 源码直跑（测试 import src/index.js）时为空对象 = 该档不提供任何默认值。
 *
 * 纪律：`credentialRef` 不允许出现在这里——它只能来自 injected（§18.4）。
 */
const MANIFEST_DEFAULTS = Object.freeze(/* @build:manifest-defaults */ {});

/** @type {Shell|null} 单例壳（与 manifest 模块实例一一对应） */
let shell = null;
/** 母体 ctx 留存：createNode 在 ACTIVE 后调用，此时 ctx 仍有效 */
let hostCtx = null;
/** UI 投影句柄（form=ui 且槽位可用时非空；headless 恒为 null）。 */
let uiHandle = null;

/**
 * ① 装载：只建壳，不发网络请求（K-08）。
 * 幂等：重复调用不重建（宪法第 20 条）。
 * @param {object} ctx
 */
async function mount(ctx) {
  if (shell) return ok({ alreadyMounted: true, form: shell.form });
  if (!ctx || typeof ctx !== 'object') return fail('E_CONFIG_INVALID', { field: 'ctx' });

  hostCtx = ctx;
  let env;
  try {
    env = browserEnv();
  } catch (e) {
    // 环境不具备 WebRTC：仍建壳（headless 可用性由调用方判断），但建连必失败。
    // 这里不抛，避免"一个可选能力让整个驱动装载失败"（宪法第 38 条同旨）。
    ctx.log?.(`[net.webrtc.p2p] 环境缺少 WebRTC：${e.message}（装载继续，建连将失败）`);
    env = null;
  }
  if (!env) {
    // 用一个显式失败的环境，让 connect() 给出确定错误而不是 TypeError
    env = {
      openSocket() {
        throw new Error('E_NO_WEBRTC');
      },
      createPeerConnection() {
        throw new Error('E_NO_WEBRTC');
      },
      now: () => Date.now(),
      setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
      clearTimeout: (h) => globalThis.clearTimeout(h),
    };
  }

  shell = new Shell({
    ctx,
    env,
    manifestDefaults: MANIFEST_DEFAULTS,
    onEvent: (event, detail) => {
      try {
        ctx.log?.(`[net.webrtc.p2p] ${event} ${JSON.stringify(detail)}`);
      } catch {
        /* 日志失败不影响驱动 */
      }
    },
  });

  // UI 投影：form=ui 且槽位可用时挂载；headless / 无 DOM（Node 测试）时 mountUi 返回 null，不抛错。
  uiHandle = mountUi({ ctx, shell });

  // 母体销毁时统一释放（与 unmount 双路径，dispose 幂等）
  ctx.onDispose?.(() => {
    const s = shell;
    const u = uiHandle;
    shell = null;
    uiHandle = null;
    u?.dispose();
    s?.dispose();
  });

  return ok({
    form: shell.form,
    formSource: shell.formSource,
    uiDegraded: shell.uiDegraded,
    uiSlot: shell.uiSlot,
    uiSlotSemantics: shell.uiSlotSemantics,
  });
}

/**
 * ② 卸载：关闭全部节点（§11）。幂等。
 */
async function unmount() {
  const s = shell;
  const u = uiHandle;
  shell = null;
  uiHandle = null;
  hostCtx = null;
  u?.dispose();
  if (!s) return ok({ alreadyDisposed: true });
  return s.dispose();
}

/**
 * ③ 建节点：组件实例化的唯一入口（§18.6）。
 * 返回 `Promise<Result<NodeHandle>>`；任何失败都以 Result 表达，不抛。
 * @param {object} [cfg]
 */
async function createNode(cfg) {
  if (!shell) return fail('E_SHELL_DISPOSED');
  return shell.createNode(cfg);
}

/** 按 id 取句柄（默认节点用 DEFAULT_NODE_ID）。不存在返回 undefined。 */
function getNode(nodeId = DEFAULT_NODE_ID) {
  return shell ? shell.getNode(nodeId) : undefined;
}

/** 全部节点快照（UI 投影与诊断用）。 */
function snapshots() {
  return shell ? shell.snapshots() : [];
}

/** 当前形式（headless/ui）、形态来源与命中的槽位；未装载返回 null。 */
function describe() {
  if (!shell) return null;
  return Object.freeze({
    form: shell.form,
    /** 'host-requested'（母体显式指定装载形态）| 'slot-inferred'（按槽位推断，旧母体） */
    formSource: shell.formSource,
    /** 请求 ui 形态但无槽位可投影（能力仍可用）；不是「已渲染」的反面证据。 */
    uiDegraded: shell.uiDegraded,
    uiSlot: shell.uiSlot,
    uiSlotSemantics: shell.uiSlotSemantics,
    state: shell.state,
    nodeCount: shell.nodes.size,
    disposed: shell.state === SHELL_STATES.DISPOSED,
  });
}

export { mount, unmount, createNode, getNode, snapshots, describe };
