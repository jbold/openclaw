import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPrimary = {
  search: vi.fn(async () => []),
  readFile: vi.fn(async () => ({ text: "", path: "MEMORY.md" })),
  status: vi.fn(() => ({
    backend: "qmd" as const,
    provider: "qmd",
    model: "qmd",
    requestedProvider: "qmd",
    files: 0,
    chunks: 0,
    dirty: false,
    workspaceDir: "/tmp",
    dbPath: "/tmp/index.sqlite",
    sources: ["memory" as const],
    sourceCounts: [{ source: "memory" as const, files: 0, chunks: 0 }],
  })),
  sync: vi.fn(async () => {}),
  probeEmbeddingAvailability: vi.fn(async () => ({ ok: true })),
  probeVectorAvailability: vi.fn(async () => true),
  close: vi.fn(async () => {}),
};

const fallbackSearch = vi.fn(async () => [
  {
    path: "MEMORY.md",
    startLine: 1,
    endLine: 1,
    score: 1,
    snippet: "fallback",
    source: "memory" as const,
  },
]);

const fallbackManager = {
  search: fallbackSearch,
  readFile: vi.fn(async () => ({ text: "", path: "MEMORY.md" })),
  status: vi.fn(() => ({
    backend: "builtin" as const,
    provider: "openai",
    model: "text-embedding-3-small",
    requestedProvider: "openai",
    files: 0,
    chunks: 0,
    dirty: false,
    workspaceDir: "/tmp",
    dbPath: "/tmp/index.sqlite",
  })),
  sync: vi.fn(async () => {}),
  probeEmbeddingAvailability: vi.fn(async () => ({ ok: true })),
  probeVectorAvailability: vi.fn(async () => true),
  close: vi.fn(async () => {}),
};

vi.mock("./qmd-manager.js", () => ({
  QmdMemoryManager: {
    create: vi.fn(async () => mockPrimary),
  },
}));

vi.mock("./engram-manager.js", () => ({
  EngramMemoryManager: {
    create: vi.fn(async () => mockPrimary),
  },
}));

vi.mock("./manager.js", () => ({
  MemoryIndexManager: {
    get: vi.fn(async () => fallbackManager),
  },
}));

import { EngramMemoryManager } from "./engram-manager.js";
import { QmdMemoryManager } from "./qmd-manager.js";
import { getMemorySearchManager } from "./search-manager.js";

beforeEach(() => {
  mockPrimary.search.mockClear();
  mockPrimary.readFile.mockClear();
  mockPrimary.status.mockClear();
  mockPrimary.sync.mockClear();
  mockPrimary.probeEmbeddingAvailability.mockClear();
  mockPrimary.probeVectorAvailability.mockClear();
  mockPrimary.close.mockClear();
  fallbackSearch.mockClear();
  fallbackManager.readFile.mockClear();
  fallbackManager.status.mockClear();
  fallbackManager.sync.mockClear();
  fallbackManager.probeEmbeddingAvailability.mockClear();
  fallbackManager.probeVectorAvailability.mockClear();
  fallbackManager.close.mockClear();
  QmdMemoryManager.create.mockClear();
  EngramMemoryManager.create.mockClear();
});

describe("getMemorySearchManager caching", () => {
  it("reuses the same QMD manager instance for repeated calls", async () => {
    const cfg = {
      memory: { backend: "qmd", qmd: {} },
      agents: { list: [{ id: "main", default: true, workspace: "/tmp/workspace" }] },
    } as const;

    const first = await getMemorySearchManager({ cfg, agentId: "main" });
    const second = await getMemorySearchManager({ cfg, agentId: "main" });

    expect(first.manager).toBe(second.manager);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(QmdMemoryManager.create).toHaveBeenCalledTimes(1);
  });

  it("evicts failed qmd wrapper so next call retries qmd", async () => {
    const retryAgentId = "retry-agent";
    const cfg = {
      memory: { backend: "qmd", qmd: {} },
      agents: { list: [{ id: retryAgentId, default: true, workspace: "/tmp/workspace" }] },
    } as const;

    mockPrimary.search.mockRejectedValueOnce(new Error("qmd query failed"));
    const first = await getMemorySearchManager({ cfg, agentId: retryAgentId });
    expect(first.manager).toBeTruthy();
    if (!first.manager) {
      throw new Error("manager missing");
    }

    const fallbackResults = await first.manager.search("hello");
    expect(fallbackResults).toHaveLength(1);
    expect(fallbackResults[0]?.path).toBe("MEMORY.md");

    const second = await getMemorySearchManager({ cfg, agentId: retryAgentId });
    expect(second.manager).toBeTruthy();
    expect(second.manager).not.toBe(first.manager);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(QmdMemoryManager.create).toHaveBeenCalledTimes(2);
  });

  it("does not evict a newer cached wrapper when closing an older failed wrapper", async () => {
    const retryAgentId = "retry-agent-close";
    const cfg = {
      memory: { backend: "qmd", qmd: {} },
      agents: { list: [{ id: retryAgentId, default: true, workspace: "/tmp/workspace" }] },
    } as const;

    mockPrimary.search.mockRejectedValueOnce(new Error("qmd query failed"));

    const first = await getMemorySearchManager({ cfg, agentId: retryAgentId });
    expect(first.manager).toBeTruthy();
    if (!first.manager) {
      throw new Error("manager missing");
    }
    await first.manager.search("hello");

    const second = await getMemorySearchManager({ cfg, agentId: retryAgentId });
    expect(second.manager).toBeTruthy();
    if (!second.manager) {
      throw new Error("manager missing");
    }
    expect(second.manager).not.toBe(first.manager);

    await first.manager.close?.();

    const third = await getMemorySearchManager({ cfg, agentId: retryAgentId });
    expect(third.manager).toBe(second.manager);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(QmdMemoryManager.create).toHaveBeenCalledTimes(2);
  });

  it("falls back to builtin search when qmd fails with sqlite busy", async () => {
    const retryAgentId = "retry-agent-busy";
    const cfg = {
      memory: { backend: "qmd", qmd: {} },
      agents: { list: [{ id: retryAgentId, default: true, workspace: "/tmp/workspace" }] },
    } as const;

    mockPrimary.search.mockRejectedValueOnce(
      new Error("qmd index busy while reading results: SQLITE_BUSY: database is locked"),
    );

    const first = await getMemorySearchManager({ cfg, agentId: retryAgentId });
    expect(first.manager).toBeTruthy();
    if (!first.manager) {
      throw new Error("manager missing");
    }

    const results = await first.manager.search("hello");
    expect(results).toHaveLength(1);
    expect(results[0]?.path).toBe("MEMORY.md");
    expect(fallbackSearch).toHaveBeenCalledTimes(1);
  });

  it("uses Engram manager when backend=engram", async () => {
    const cfg = {
      memory: { backend: "engram", engram: {} },
      agents: { list: [{ id: "main", default: true, workspace: "/tmp/workspace" }] },
    } as const;

    const result = await getMemorySearchManager({ cfg, agentId: "main" });

    expect(result.manager).toBeTruthy();
    expect(EngramMemoryManager.create).toHaveBeenCalledTimes(1);
    expect(QmdMemoryManager.create).not.toHaveBeenCalled();
  });

  it("falls back to builtin when Engram manager create returns null", async () => {
    const cfg = {
      memory: { backend: "engram", engram: {} },
      agents: { list: [{ id: "engram-null", default: true, workspace: "/tmp/workspace" }] },
    } as const;
    EngramMemoryManager.create.mockResolvedValueOnce(null);

    const result = await getMemorySearchManager({ cfg, agentId: "engram-null" });

    expect(result.manager).toBe(fallbackManager);
    expect(fallbackSearch).not.toHaveBeenCalled();
  });

  it("falls back to builtin when Engram manager create throws", async () => {
    const cfg = {
      memory: { backend: "engram", engram: {} },
      agents: { list: [{ id: "engram-throw", default: true, workspace: "/tmp/workspace" }] },
    } as const;
    EngramMemoryManager.create.mockRejectedValueOnce(new Error("engram unavailable"));

    const result = await getMemorySearchManager({ cfg, agentId: "engram-throw" });

    expect(result.manager).toBe(fallbackManager);
  });

  it("preserves direct-chat session scope and memory tool contract during engram fallback", async () => {
    const cfg = {
      memory: { backend: "engram", engram: {} },
      agents: { list: [{ id: "engram-scope", default: true, workspace: "/tmp/workspace" }] },
    } as const;
    mockPrimary.search.mockRejectedValueOnce(new Error("engram query failed"));

    const result = await getMemorySearchManager({ cfg, agentId: "engram-scope" });
    expect(result.manager).toBeTruthy();
    if (!result.manager) {
      throw new Error("manager missing");
    }

    const found = await result.manager.search("hello", { sessionKey: "whatsapp:direct-chat:123" });
    expect(found).toHaveLength(1);
    expect(fallbackSearch).toHaveBeenCalledWith("hello", {
      sessionKey: "whatsapp:direct-chat:123",
    });

    await expect(result.manager.readFile({ relPath: "MEMORY.md" })).resolves.toEqual({
      text: "",
      path: "MEMORY.md",
    });
    await expect(result.manager.probeEmbeddingAvailability()).resolves.toEqual({ ok: true });
    await expect(result.manager.probeVectorAvailability()).resolves.toBe(true);
  });
});
