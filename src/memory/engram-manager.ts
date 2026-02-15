import { spawn } from "node:child_process";
import type { OpenClawConfig } from "../config/config.js";
import type { ResolvedMemoryBackendConfig } from "./backend-config.js";
import type {
  MemoryEmbeddingProbeResult,
  MemorySearchManager,
  MemorySearchResult,
} from "./types.js";
import { resolveAgentWorkspaceDir } from "../agents/agent-scope.js";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("memory");
const DEFAULT_COMMAND = "engram-openclaw-adapter";
const DEFAULT_TIMEOUT_MS = 4_000;

type CreateParams =
  | {
      workspaceDir: string;
      command?: string;
      timeoutMs?: number;
    }
  | {
      cfg: OpenClawConfig;
      agentId: string;
      resolved: ResolvedMemoryBackendConfig;
    };

type AdapterResponse = {
  ok?: boolean;
  data?: Record<string, unknown>;
  status?: Record<string, unknown>;
};

export class EngramMemoryManager implements MemorySearchManager {
  static async create(params: CreateParams): Promise<EngramMemoryManager | null> {
    const options =
      "cfg" in params
        ? {
            workspaceDir: resolveAgentWorkspaceDir(params.cfg, params.agentId),
            command: params.cfg.memory?.engram?.command || DEFAULT_COMMAND,
            timeoutMs: params.cfg.memory?.engram?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          }
        : {
            workspaceDir: params.workspaceDir,
            command: params.command || DEFAULT_COMMAND,
            timeoutMs: params.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          };

    const manager = new EngramMemoryManager(options);
    try {
      const health = await manager.exec("health", {});
      if (!health || health.status?.backend_available === false) {
        return null;
      }
      return manager;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn(`engram adapter unavailable: ${message}`);
      return null;
    }
  }

  private constructor(
    private readonly opts: { workspaceDir: string; command: string; timeoutMs: number },
  ) {}

  async search(
    query: string,
    opts?: { maxResults?: number; minScore?: number; sessionKey?: string },
  ): Promise<MemorySearchResult[]> {
    const response = await this.exec("search", { query, ...opts });
    const results = (response.data?.results as Array<Record<string, unknown>> | undefined) ?? [];
    return results.map((entry) => ({
      path: String(entry.id ?? entry.path ?? "MEMORY.md"),
      startLine: 1,
      endLine: 1,
      score: Number(entry.score ?? 0),
      snippet: String(entry.snippet ?? ""),
      source: "memory",
    }));
  }

  async readFile(params: {
    relPath: string;
    from?: number;
    lines?: number;
  }): Promise<{ text: string; path: string }> {
    const response = await this.exec("fetch", params);
    const lines = (response.data?.content as string[] | undefined) ?? [];
    return { text: lines.join("\n"), path: params.relPath };
  }

  status() {
    return {
      backend: "engram" as const,
      provider: "engram",
      workspaceDir: this.opts.workspaceDir,
      custom: { engram: { command: this.opts.command } },
    };
  }

  async sync(params?: { reason?: string; force?: boolean }): Promise<void> {
    await this.exec("flush", params ?? {});
  }

  async probeEmbeddingAvailability(): Promise<MemoryEmbeddingProbeResult> {
    return { ok: true };
  }

  async probeVectorAvailability(): Promise<boolean> {
    return true;
  }

  async close(): Promise<void> {
    return;
  }

  private async exec(
    subcommand: string,
    payload: Record<string, unknown>,
  ): Promise<AdapterResponse> {
    return await new Promise<AdapterResponse>((resolve, reject) => {
      const child = spawn(this.opts.command, [subcommand], {
        cwd: this.opts.workspaceDir,
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      const timeout = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error(`engram adapter timeout (${subcommand})`));
      }, this.opts.timeoutMs);

      child.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });
      child.stdout.on("data", (chunk) => {
        stdout += String(chunk);
      });
      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });
      child.on("close", (code) => {
        clearTimeout(timeout);
        if (code !== 0) {
          reject(new Error(stderr || `engram adapter exited with code ${code}`));
          return;
        }
        try {
          const parsed = JSON.parse(stdout || "{}");
          resolve(parsed as AdapterResponse);
        } catch {
          reject(new Error("engram adapter returned invalid JSON"));
        }
      });

      child.stdin.write(JSON.stringify({ workspaceDir: this.opts.workspaceDir, ...payload }));
      child.stdin.end();
    });
  }
}
