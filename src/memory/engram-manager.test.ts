import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { logWarnMock } = vi.hoisted(() => ({
  logWarnMock: vi.fn(),
}));

type MockChild = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  stdin: { write: (chunk: string) => void; end: () => void };
  kill: (signal?: NodeJS.Signals) => void;
};

function makeChild(stdoutJson: unknown): MockChild {
  const child = new EventEmitter() as MockChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = {
    write: () => {},
    end: () => {
      queueMicrotask(() => {
        child.stdout.emit("data", JSON.stringify(stdoutJson));
        child.emit("close", 0);
      });
    },
  };
  child.kill = () => {};
  return child;
}

vi.mock("../logging/subsystem.js", () => ({
  createSubsystemLogger: () => ({
    warn: logWarnMock,
    debug: vi.fn(),
    info: vi.fn(),
    child: vi.fn(),
  }),
}));

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));

import { spawn as mockedSpawn } from "node:child_process";
import { EngramMemoryManager } from "./engram-manager.js";

const spawnMock = mockedSpawn as unknown as vi.Mock;

describe("EngramMemoryManager", () => {
  beforeEach(() => {
    spawnMock.mockReset();
    logWarnMock.mockReset();
  });

  it("implements search/read/sync/status contract via adapter", async () => {
    spawnMock.mockImplementation((_cmd: string, args: string[]) => {
      if (args[0] === "health") {
        return makeChild({ ok: true, status: { backend_available: true } });
      }
      if (args[0] === "search") {
        return makeChild({
          ok: true,
          data: { results: [{ id: "MEMORY.md", score: 0.91, snippet: "remember this" }] },
          status: { backend_available: true },
        });
      }
      if (args[0] === "fetch") {
        return makeChild({
          ok: true,
          data: { content: ["line 1", "line 2"] },
          status: { backend_available: true },
        });
      }
      if (args[0] === "flush") {
        return makeChild({ ok: true, data: { synced: true }, status: { backend_available: true } });
      }
      return makeChild({ ok: true, status: { backend_available: true } });
    });

    const manager = await EngramMemoryManager.create({
      workspaceDir: "/tmp/workspace",
      command: "engram-openclaw-adapter",
      timeoutMs: 2000,
    });
    expect(manager).toBeTruthy();
    if (!manager) {
      throw new Error("manager missing");
    }

    const hits = await manager.search("hello", { maxResults: 3, minScore: 0.2 });
    expect(hits).toEqual([
      {
        path: "MEMORY.md",
        startLine: 1,
        endLine: 1,
        score: 0.91,
        snippet: "remember this",
        source: "memory",
      },
    ]);

    await expect(manager.readFile({ relPath: "MEMORY.md", from: 1, lines: 2 })).resolves.toEqual({
      text: "line 1\nline 2",
      path: "MEMORY.md",
    });

    await expect(manager.sync?.({ reason: "manual", force: true })).resolves.toBeUndefined();

    const status = manager.status();
    expect(status.backend).toBe("engram");
    expect(status.provider).toBe("engram");
    expect(status.custom?.engram).toBeTruthy();

    await manager.close?.();
  });

  it("returns null when adapter health reports unavailable", async () => {
    spawnMock.mockImplementation(() =>
      makeChild({ ok: true, status: { backend_available: false, degraded: true } }),
    );

    const manager = await EngramMemoryManager.create({
      workspaceDir: "/tmp/workspace",
      command: "engram-openclaw-adapter",
      timeoutMs: 2000,
    });

    expect(manager).toBeNull();
  });

  it("returns null when adapter process cannot be spawned", async () => {
    spawnMock.mockImplementation(() => {
      const child = makeChild({ ok: true });
      queueMicrotask(() => {
        child.emit("error", Object.assign(new Error("spawn failed"), { code: "ENOENT" }));
      });
      return child;
    });

    const manager = await EngramMemoryManager.create({
      workspaceDir: "/tmp/workspace",
      command: "missing-adapter",
      timeoutMs: 2000,
    });

    expect(manager).toBeNull();
  });
});
