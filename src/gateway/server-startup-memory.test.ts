import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/config.js";

const { getMemorySearchManagerMock } = vi.hoisted(() => ({
  getMemorySearchManagerMock: vi.fn(),
}));

vi.mock("../memory/index.js", () => ({
  getMemorySearchManager: getMemorySearchManagerMock,
}));

import { startGatewayMemoryBackend } from "./server-startup-memory.js";

describe("startGatewayMemoryBackend", () => {
  beforeEach(() => {
    getMemorySearchManagerMock.mockReset();
  });

  it("skips initialization when memory backend is neither qmd nor engram", async () => {
    const cfg = {
      agents: { list: [{ id: "main", default: true }] },
      memory: { backend: "builtin" },
    } as OpenClawConfig;
    const log = { info: vi.fn(), warn: vi.fn() };

    await startGatewayMemoryBackend({ cfg, log });

    expect(getMemorySearchManagerMock).not.toHaveBeenCalled();
    expect(log.info).not.toHaveBeenCalled();
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("initializes qmd backend for the default agent", async () => {
    const cfg = {
      agents: { list: [{ id: "ops", default: true }, { id: "main" }] },
      memory: { backend: "qmd", qmd: {} },
    } as OpenClawConfig;
    const log = { info: vi.fn(), warn: vi.fn() };
    getMemorySearchManagerMock.mockResolvedValue({ manager: { search: vi.fn() } });

    await startGatewayMemoryBackend({ cfg, log });

    expect(getMemorySearchManagerMock).toHaveBeenCalledWith({ cfg, agentId: "ops" });
    expect(log.info).toHaveBeenCalledWith(
      'qmd memory startup initialization armed for agent "ops"',
    );
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("initializes engram backend for the default agent", async () => {
    const cfg = {
      agents: { list: [{ id: "ops", default: true }, { id: "main" }] },
      memory: { backend: "engram", engram: {} },
    } as OpenClawConfig;
    const log = { info: vi.fn(), warn: vi.fn() };
    getMemorySearchManagerMock.mockResolvedValue({ manager: { search: vi.fn() } });

    await startGatewayMemoryBackend({ cfg, log });

    expect(getMemorySearchManagerMock).toHaveBeenCalledWith({ cfg, agentId: "ops" });
    expect(log.info).toHaveBeenCalledWith(
      'engram memory startup initialization armed for agent "ops"',
    );
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("logs a warning when qmd manager init fails", async () => {
    const cfg = {
      agents: { list: [{ id: "main", default: true }] },
      memory: { backend: "qmd", qmd: {} },
    } as OpenClawConfig;
    const log = { info: vi.fn(), warn: vi.fn() };
    getMemorySearchManagerMock.mockResolvedValue({ manager: null, error: "qmd missing" });

    await startGatewayMemoryBackend({ cfg, log });

    expect(log.warn).toHaveBeenCalledWith(
      'qmd memory startup initialization failed for agent "main": qmd missing',
    );
    expect(log.info).not.toHaveBeenCalled();
  });

  it("logs a warning when engram manager init fails", async () => {
    const cfg = {
      agents: { list: [{ id: "main", default: true }] },
      memory: { backend: "engram", engram: {} },
    } as OpenClawConfig;
    const log = { info: vi.fn(), warn: vi.fn() };
    getMemorySearchManagerMock.mockResolvedValue({ manager: null, error: "engram missing" });

    await startGatewayMemoryBackend({ cfg, log });

    expect(log.warn).toHaveBeenCalledWith(
      'engram memory startup initialization failed for agent "main": engram missing',
    );
    expect(log.info).not.toHaveBeenCalled();
  });
});
