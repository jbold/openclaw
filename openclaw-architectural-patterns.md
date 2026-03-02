# OpenClaw: Architectural Pattern Analysis

_Inferred from design decisions in source code, not documentation._

---

## The Architect's Mental Model

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         CLIENT TIER                                      │
│   ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────┐  │
│   │ macOS App│  │ iOS App  │  │ Android  │  │  Web UI  │  │  CLI   │  │
│   │ (Swift)  │  │ (Swift)  │  │ (Kotlin) │  │  (Lit)   │  │(Cmdr)  │  │
│   └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘  └───┬────┘  │
│        └──────────────┴──────────────┴──────────────┴───────────┘       │
│                              │ WebSocket RPC                            │
│                              │ (RequestFrame / ResponseFrame /          │
│                              │  EventFrame + idempotency keys)          │
└──────────────────────────────┼───────────────────────────────────────────┘
                               ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                     GATEWAY (Local Control Plane)                        │
│                                                                          │
│  ┌────────────────────┐  ┌───────────────────┐  ┌────────────────────┐  │
│  │  WS Server (Hub)   │  │   HTTP Server     │  │  Broadcast Fan-Out │  │
│  │  Set<WsClient>     │  │   (Hono routes)   │  │  (role-scoped,     │  │
│  │  pending: Map<     │  │   plugin routes    │  │   backpressured)   │  │
│  │    id, {resolve}>  │  │   canvas host     │  │                    │  │
│  └─────────┬──────────┘  └─────────┬─────────┘  └────────┬───────────┘  │
│            └────────────────────────┴─────────────────────┘              │
│                              │                                           │
│  ┌───────────────────────────┴──────────────────────────────┐           │
│  │              RPC METHOD DISPATCH (Mediator)               │           │
│  │  agent | chat:send | chat:abort | config:get/set/patch    │           │
│  │  sessions:list/compact/reset | channels:status            │           │
│  │  exec.approval.request/resolve | cron | nodes | talk      │           │
│  └───────────────────────────┬──────────────────────────────┘           │
│                              │                                           │
│  ┌───────────────────────────┴──────────────────────────────┐           │
│  │          EXEC APPROVAL GATE (Human-in-the-Loop)           │           │
│  │                                                           │           │
│  │  Agent requests → broadcast("exec.approval.requested")    │           │
│  │       → all clients see it → first human resolves it      │           │
│  │       → broadcast("exec.approval.resolved")               │           │
│  │       → agent resumes (allow-once | allow-always | deny)  │           │
│  └───────────────────────────┬──────────────────────────────┘           │
│                              │                                           │
│  ┌───────────────────────────┴──────────────────────────────┐           │
│  │              LANE QUEUE SYSTEM (Actor-like)                │           │
│  │                                                           │           │
│  │  ┌────────────┐ ┌────────────┐ ┌──────┐ ┌──────────┐     │           │
│  │  │session:usr1│ │session:usr2│ │ cron │ │ subagent │     │           │
│  │  │ max_c=1    │ │ max_c=1    │ │      │ │          │     │           │
│  │  └─────┬──────┘ └─────┬──────┘ └──┬───┘ └────┬─────┘     │           │
│  │        └───────────────┴───────────┴──────────┘           │           │
│  │               ↓ all enqueue into global "main" lane       │           │
│  │         (double-lane: session serialization +              │           │
│  │          global resource throttling)                       │           │
│  └───────────────────────────┬──────────────────────────────┘           │
│                              │                                           │
│  ┌──────────────┐  ┌────────┴─────────┐  ┌──────────────────┐          │
│  │Config Reload │  │ Hook Dispatch    │  │ Cron Timer       │          │
│  │(chokidar     │  │ (observer:       │  │ (emit started/   │          │
│  │ →debounce    │  │  command:new,    │  │  finished events, │          │
│  │ →diff        │  │  session:start,  │  │  queue system     │          │
│  │ →hot/restart)│  │  agent:bootstrap)│  │  events)          │          │
│  └──────────────┘  └──────────────────┘  └──────────────────┘          │
└──────────────────────────────┬───────────────────────────────────────────┘
                               ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                      AGENT RUNTIME                                       │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────┐       │
│  │  runEmbeddedPiAgent() — orchestrator loop                    │       │
│  │                                                              │       │
│  │  ┌──────────────┐  ┌────────────────┐  ┌──────────────────┐ │       │
│  │  │ Model        │  │ Auth Profile   │  │ Failover Chain   │ │       │
│  │  │ Resolver     │  │ Rotation       │  │ (Chain of        │ │       │
│  │  │              │  │ (strategy:     │  │  Responsibility) │ │       │
│  │  │              │  │  advance on    │  │                  │ │       │
│  │  │              │  │  cooldown/     │  │ profile[0]→fail  │ │       │
│  │  │              │  │  rate-limit)   │  │ →profile[1]→fail │ │       │
│  │  │              │  │               │  │ →FailoverError   │ │       │
│  │  │              │  │               │  │ →model fallback  │ │       │
│  │  └──────────────┘  └───────────────┘  └──────────────────┘ │       │
│  │                                                              │       │
│  │  ┌──────────────────────────────────────────────────────┐   │       │
│  │  │  TOOL POLICY ENGINE (Layered Strategy)               │   │       │
│  │  │                                                      │   │       │
│  │  │  global → agent → provider → profile → group         │   │       │
│  │  │                                                      │   │       │
│  │  │  makeToolPolicyMatcher(policy)                       │   │       │
│  │  │    → compiles glob patterns → returns matcher fn     │   │       │
│  │  │    → allow/deny with pattern matching                │   │       │
│  │  └──────────────────────────────────────────────────────┘   │       │
│  │                                                              │       │
│  │  ┌──────────────┐  ┌────────────────┐  ┌──────────────────┐ │       │
│  │  │ Sandbox      │  │ Session        │  │ Streaming        │ │       │
│  │  │ (Docker:     │  │ Transcript     │  │ Pipeline         │ │       │
│  │  │  shared/     │  │ + auto-compact │  │ (state machine   │ │       │
│  │  │  agent/      │  │ on overflow    │  │  + block chunker │ │       │
│  │  │  session)    │  │               │  │  + accumulators) │ │       │
│  │  └──────────────┘  └────────────────┘  └──────────────────┘ │       │
│  └──────────────────────────┬───────────────────────────────────┘       │
│                             │                                            │
│  ┌──────────────────────────┴───────────────────────────────┐           │
│  │             TOOL REGISTRY (Factory)                       │           │
│  │  createOpenClawCodingTools(options) →                      │           │
│  │    coding | exec | browser | channel | sessions           │           │
│  │    memory | cron | gateway | canvas | skills              │           │
│  │    + channel-contributed agentTools                        │           │
│  └──────────────────────────┬───────────────────────────────┘           │
│                             │                                            │
│  ┌──────────────────────────┴───────────────────────────────┐           │
│  │          SUBAGENT DELEGATION                              │           │
│  │  sessions_spawn tool → isolated session                   │           │
│  │  restricted policy: no sessions, no gateway, no memory    │           │
│  │  no recursive spawn (prevents fork bombs)                 │           │
│  └──────────────────────────────────────────────────────────┘           │
└──────────────────────────────┬───────────────────────────────────────────┘
                               ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                   CHANNEL DOCK (Plugin Registry)                         │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────┐           │
│  │  ChannelPlugin — Faceted Adapter Contract                 │           │
│  │                                                           │           │
│  │  Required:  id, meta, capabilities, config                │           │
│  │  Optional:  auth, messaging, groups, mentions, threading  │           │
│  │             pairing, security, streaming, commands,        │           │
│  │             onboarding, status, gateway, elevated,         │           │
│  │             directory, resolver, actions, heartbeat,       │           │
│  │             agentTools                                     │           │
│  │                                                           │           │
│  │  (~20 optional adapter facets — implement what you need)  │           │
│  └───────────────────────────┬──────────────────────────────┘           │
│            ┌─────────────────┼─────────────────────┐                    │
│            ▼                 ▼                     ▼                    │
│   ┌──────────────┐  ┌──────────────┐      ┌──────────────┐            │
│   │ Core (7)     │  │ Core (5)     │      │ Extensions   │            │
│   │ WhatsApp     │  │ Telegram     │      │ (workspace   │            │
│   │ Discord      │  │ Slack        │      │  packages)   │            │
│   │ Signal       │  │ iMessage     │      │ MS Teams     │            │
│   │ Line         │  │ Feishu       │      │ Matrix       │            │
│   │ GoogleChat   │  │ Nostr        │      │ Zalo, etc.   │            │
│   │ (+ web/API)  │  │              │      │              │            │
│   └──────────────┘  └──────────────┘      └──────────────┘            │
└──────────────────────────────────────────────────────────────────────────┘
                               ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                     SESSION ROUTING                                      │
│                                                                          │
│  Key format: agent:<agentId>:<channel>:<scope>:<peerId>[:thread:<id>]   │
│                                                                          │
│  Scopes: main | per-peer | per-channel-peer | per-account-channel-peer  │
│                                                                          │
│  Identity links: cross-channel peer unification                          │
│  (same human on WhatsApp + Telegram → single session)                   │
│                                                                          │
│  Subagent keys: agent:<id>:subagent:<task>                              │
│  Thread keys:   ...:thread:<threadId>                                    │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Part I: Classical GoF Patterns

### 1. Adapter (Structural)

`src/channels/plugins/types.plugin.ts`, `src/channels/plugins/`, `extensions/`

The `ChannelPlugin` interface normalizes ~15 messaging platforms behind a uniform contract. The rest of the system programs against this interface; no platform-specific code leaks out.

```typescript
type ChannelPlugin<ResolvedAccount = any> = {
  id: ChannelId;
  meta: ChannelMeta;
  capabilities: ChannelCapabilities;
  config: ChannelConfigAdapter<ResolvedAccount>;
  auth?: ChannelAuthAdapter;
  messaging?: ChannelMessagingAdapter;
  groups?: ChannelGroupAdapter;
  mentions?: ChannelMentionAdapter;
  threading?: ChannelThreadingAdapter;
  streaming?: ChannelStreamingAdapter;
  pairing?: ChannelPairingAdapter;
  security?: ChannelSecurityAdapter<ResolvedAccount>;
  elevated?: ChannelElevatedAdapter;
  // ~20 optional adapter facets
};
```

### 2. Strategy (Behavioral)

`src/agents/pi-tools.policy.ts`, `src/agents/tool-policy.ts`

`makeToolPolicyMatcher(policy)` compiles glob patterns into a matcher closure swapped per execution context. Policies resolve hierarchically: `global → agent → provider → profile → group → sender`.

```typescript
function makeToolPolicyMatcher(policy: SandboxToolPolicy) {
  const deny = compilePatterns(policy.deny);
  const allow = compilePatterns(policy.allow);
  return (name: string) => {
    if (matchesAny(normalized, deny)) return false;
    if (allow.length === 0) return true;
    return matchesAny(normalized, allow);
  };
}
```

### 3. Observer / Pub-Sub (Behavioral)

Three distinct implementations:

**a) Gateway Broadcast** — `src/gateway/server-broadcast.ts`
Fan-out to `Set<GatewayWsClient>` with role-based filtering and backpressure (`dropIfSlow`).

**b) Internal Hooks** — `src/hooks/internal-hooks.ts`
Registry keyed by event type/action: `registerInternalHook("command:new", handler)`.

**c) Agent Events** — `src/infra/agent-events.ts`
`Set<listener>` emitting agent lifecycle events with monotonic sequence numbers.

### 4. Mediator (Behavioral)

`src/gateway/server-methods/`, `src/gateway/server.impl.ts`

The gateway mediates all client-to-subsystem interactions through RPC dispatch. Clients never communicate directly.

### 5. Chain of Responsibility (Behavioral)

`src/agents/pi-embedded-runner/run.ts` (lines 277-523), `src/agents/failover-error.ts`, `src/agents/auth-profiles.ts`

Auth profile candidates tried in order; on failure, the chain advances. If all profiles exhausted, `FailoverError` triggers a second chain at the model level.

```
profile[0] → try → rate_limit → cooldown → advance →
profile[1] → try → auth_error → advance →
profile[2] → try → succeed   (or all exhausted → FailoverError → model fallback)
```

### 6. Factory (Creational)

`src/cli/deps.ts`, `src/agents/pi-tools.ts`, `src/gateway/server-methods/exec-approval.ts`

No class hierarchies. Everything is created via factory functions:
- `createDefaultDeps()` — CLI dependency injection
- `createOpenClawCodingTools(options)` — agent tool array
- `createExecApprovalHandlers(manager)` — RPC handler map
- `createGatewayBroadcaster(params)` — broadcast system
- `createNodeSubscriptionManager()` — device pub/sub

### 7. State Machine (Behavioral)

`src/agents/pi-embedded-subscribe.ts`

Multi-buffer streaming parser with `blockState` (`thinking`, `final`), delta buffers, tool metadata accumulation, and explicit state transitions as the LLM stream arrives.

### 8. Proxy (Structural)

`src/agents/pi-embedded-runner/run.ts`

Auth profile rotation wraps the real provider API behind `authStorage.setRuntimeApiKey()`. The caller sees one model endpoint; the proxy swaps credentials transparently on failover.

### 9. Template Method (Behavioral)

`src/agents/pi-embedded-runner/run/attempt.ts`

Fixed orchestration skeleton: build payloads → call model → parse stream → collect results. Provider-specific details filled in via injected params rather than subclass overrides (functional template method).

### 10. Facade (Structural)

`src/channels/dock.ts`

`getChannelDock()` — single entry point hiding plugin catalog, loading, config resolution, and status behind one call.

### 11. Composite (Structural)

`src/agents/tool-policy.ts`

`expandToolGroups()` expands group names into leaf tool names. Allow/deny rules compose as a tree into a single matcher. Tool groups are composites; individual tools are leaves.

---

## Part II: Modern Distributed Systems Patterns

### 12. Control Plane / Data Plane Separation

`src/gateway/` (control) vs `src/agents/pi-embedded-runner/` (data)

Gateway orchestrates but doesn't compute. Agent runtime handles LLM inference and tool execution. N clients can control a single local agent runtime.

### 13. Lane-Based Concurrency (Actor Model)

`src/process/command-queue.ts`, `src/process/lanes.ts`, `src/agents/pi-embedded-runner/lanes.ts`

Named lanes with per-lane serialization (`maxConcurrent=1`). Recursive `pump()` drains each lane. The Actor model in ~90 lines, no framework.

```typescript
type LaneState = {
  lane: string;
  queue: QueueEntry[];
  active: number;
  maxConcurrent: number;
  draining: boolean;
};
const lanes = new Map<string, LaneState>();
```

### 14. Idempotency Keys

`src/gateway/server/ws-connection/message-handler.ts`

Every RPC request carries an `idempotencyKey`. Duplicate requests on reconnect are detected and deduplicated.

### 15. Backpressure (dropIfSlow)

`src/gateway/server-broadcast.ts`

Slow WebSocket clients get events dropped rather than buffered. Sequence number gap detection enables client-side reconciliation.

### 16. Hot Reload with Diff Planning

`src/gateway/config-reload.ts`

`chokidar file watch → debounce → diff → buildReloadPlan → selective restart`. Identifies which subsystems need restart vs. hot-apply.

### 17. Sidecar Pattern

`src/agents/sandbox.ts`

Docker containers spawned alongside the agent process for isolated tool execution with configurable resource limits, network isolation, and optional VNC.

---

## Part III: Emergent Agentic AI Patterns

### 18. ReAct (Reason + Act)

`src/agents/pi-embedded-runner/run/attempt.ts`, `src/agents/pi-embedded-subscribe.ts`

LLM reasons (including `<thinking>` blocks) → emits tool calls → receives results → reasons again. The streaming pipeline parses this interleaved stream in real time.

### 19. Human-in-the-Loop (Approval Gate)

`src/gateway/exec-approval-manager.ts`, `src/gateway/server-methods/exec-approval.ts`

First-class architectural primitive:
1. Agent emits `exec.approval.request`
2. Gateway broadcasts to ALL connected clients
3. Agent suspends via `waitForDecision()` (Promise-based)
4. Human on any device resolves: `allow-once | allow-always | deny`
5. Agent resumes

```typescript
async waitForDecision(record, timeoutMs): Promise<ExecApprovalDecision | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => { resolve(null); }, timeoutMs);
    this.pending.set(record.id, { record, resolve, timer });
  });
}
```

### 20. Multi-Agent Delegation with Least Privilege

`src/agents/pi-tools.policy.ts` (`DEFAULT_SUBAGENT_TOOL_DENY`), `src/agents/tools/sessions-spawn-tool.ts`

Subagents get isolated session keys and restricted tool policies. Recursive spawn is blocked (fork bomb prevention).

```typescript
const DEFAULT_SUBAGENT_TOOL_DENY = [
  "sessions_list", "sessions_history", "sessions_send",
  "sessions_spawn", "gateway", "agents_list",
  "memory_search", "memory_get",
];
```

### 21. Cognitive Resource Management

`src/agents/context-window-guard.ts`, `src/agents/pi-embedded-runner/compact.ts`, `src/agents/pi-embedded-runner/run.ts`

Context window treated as scarce memory:
- **Guard**: blocks models below hard minimum token count
- **Auto-compaction**: summarizes transcript on overflow and retries (like page swapping)
- **Thinking fallback**: downgrades thinking mode (`on` → `off`) and retries
- **Overflow classification**: `context_overflow` vs `compaction_failure`

### 22. Provider-Polymorphic Tool Schemas

`src/agents/pi-tools.ts`

Same logical tool, schema adapted per LLM provider dialect. Claude handles `anyOf`, Gemini doesn't. `format` property avoided in schemas. Tool behavior is constant; contract adapts to consumer.

---

## Part IV: Novel Patterns (Not in Any Textbook)

### 23. Faceted Adapter Composition

`src/channels/plugins/types.plugin.ts`

Not a single adapter — a composition of ~20 optional adapter facets. Each channel implements only facets its platform supports. Trait composition at the type level without language-level traits. Avoids both the "god interface" and "adapter per concern" problems.

### 24. Broadcast Consent (Distributed Human Approval)

`src/gateway/server-methods/exec-approval.ts`

Broadcasts to ALL clients, accepts FIRST response. Not consensus, not leader election, not request-response. The decision-maker is completely decoupled from the requester.

### 25. Dual-Lane Serialization

`src/agents/pi-embedded-runner/run.ts` (lines 90-91)

Agent runs double-enqueued on session lane + global lane:
```typescript
return enqueueSession(() =>
  enqueueGlobal(async () => { /* agent run */ }));
```
Session lane: correctness (no interleaving). Global lane: resource throttling.

### 26. Cross-Channel Identity Resolution

`src/routing/session-key.ts`

`identityLinks` unify the same human across platforms. WhatsApp user + Telegram user → single session via `resolveLinkedPeerId()`.

### 27. Multi-Surface Event Relay

`src/gateway/server-chat.ts`

Agent events filtered and routed per-client: WebSocket broadcast (web/desktop), node subscriptions (mobile, session-scoped), verbose tool events (opt-in only). Internal `runId` mapped to client-facing `clientRunId`.

### 28. Session Routing as Addressing Scheme

`src/routing/session-key.ts`, `src/sessions/session-key-utils.ts`

Hierarchical key: `agent:<agentId>:<channel>:<scope>:<peerId>[:thread:<threadId>]`
Encodes agent identity, platform, scope, peer, and thread in one parseable string.

---

## Quick-Reference Taxonomy

| #  | Pattern | Category | Primary Location(s) |
|----|---------|----------|---------------------|
| 1  | Adapter | GoF | `src/channels/plugins/types.plugin.ts`, `extensions/` |
| 2  | Strategy | GoF | `src/agents/pi-tools.policy.ts`, `src/agents/tool-policy.ts` |
| 3  | Observer / Pub-Sub | GoF | `src/gateway/server-broadcast.ts`, `src/hooks/internal-hooks.ts`, `src/infra/agent-events.ts` |
| 4  | Mediator | GoF | `src/gateway/server-methods/`, `src/gateway/server.impl.ts` |
| 5  | Chain of Responsibility | GoF | `src/agents/pi-embedded-runner/run.ts`, `src/agents/failover-error.ts` |
| 6  | Factory | GoF | `src/cli/deps.ts`, `src/agents/pi-tools.ts` |
| 7  | State Machine | GoF | `src/agents/pi-embedded-subscribe.ts` |
| 8  | Proxy | GoF | `src/agents/pi-embedded-runner/run.ts` (auth rotation) |
| 9  | Template Method | GoF | `src/agents/pi-embedded-runner/run/attempt.ts` |
| 10 | Facade | GoF | `src/channels/dock.ts` |
| 11 | Composite | GoF | `src/agents/tool-policy.ts` |
| 12 | Control Plane / Data Plane | Distributed | `src/gateway/` vs `src/agents/` |
| 13 | Lane-Based Concurrency | Distributed | `src/process/command-queue.ts`, `src/process/lanes.ts` |
| 14 | Idempotency Keys | Distributed | `src/gateway/server/ws-connection/message-handler.ts` |
| 15 | Backpressure | Distributed | `src/gateway/server-broadcast.ts` |
| 16 | Hot Reload / Diff Planning | Distributed | `src/gateway/config-reload.ts` |
| 17 | Sidecar | Distributed | `src/agents/sandbox.ts` |
| 18 | ReAct (Reason + Act) | Agentic AI | `src/agents/pi-embedded-runner/run/attempt.ts` |
| 19 | Human-in-the-Loop | Agentic AI | `src/gateway/exec-approval-manager.ts`, `src/gateway/server-methods/exec-approval.ts` |
| 20 | Multi-Agent Delegation | Agentic AI | `src/agents/pi-tools.policy.ts`, `src/agents/tools/sessions-spawn-tool.ts` |
| 21 | Cognitive Resource Mgmt | Agentic AI | `src/agents/context-window-guard.ts`, `src/agents/pi-embedded-runner/compact.ts` |
| 22 | Provider-Polymorphic Schemas | Agentic AI | `src/agents/pi-tools.ts` |
| 23 | Faceted Adapter Composition | Novel | `src/channels/plugins/types.plugin.ts` |
| 24 | Broadcast Consent | Novel | `src/gateway/server-methods/exec-approval.ts` |
| 25 | Dual-Lane Serialization | Novel | `src/agents/pi-embedded-runner/run.ts` |
| 26 | Cross-Channel Identity | Novel | `src/routing/session-key.ts` |
| 27 | Multi-Surface Event Relay | Novel | `src/gateway/server-chat.ts` |
| 28 | Session Routing as Address | Novel | `src/routing/session-key.ts`, `src/sessions/session-key-utils.ts` |

---

## What the Architect Optimized For

| Priority | How It's Achieved |
|----------|-------------------|
| **Channel-agnostic reasoning** | Faceted adapter hides all platform complexity; the agent never knows which platform it's talking through |
| **Local-first, multi-device control** | Gateway runs locally; any device connects via WebSocket; broadcast consent distributes approval across devices |
| **Safety without friction** | Human-in-the-loop is async, multi-device, non-blocking; subagent delegation enforces least-privilege; tool policies layer hierarchically |
| **Graceful degradation** | Two-tier failover (auth profiles → model fallback), thinking level downgrade, auto-compaction on overflow, provider schema normalization |
| **Composability over inheritance** | Zero class hierarchies; factories, closures, typed option bags, and faceted adapters replace traditional OOP entirely |

---

_GoF patterns appear throughout as internalized grammar, not named vocabulary. What's genuinely new are patterns arising from non-deterministic agents operating in multi-surface, multi-channel, human-supervised environments._
