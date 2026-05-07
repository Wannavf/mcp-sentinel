import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { LockedTool, ServerConfig } from "./types.js";
import { hashTool } from "./hasher.js";

interface ServerSnapshot {
  transport: "stdio" | "http" | "sse";
  protocolVersion: string;
  serverInfo: { name: string; version: string };
  tools: Record<string, LockedTool>;
}

export interface LiveServerData {
  name: string;
  tools: Record<string, {
    name: string;
    description?: string;
    inputSchema: Record<string, unknown>;
    outputSchema?: Record<string, unknown> | null;
    annotations?: Record<string, unknown>;
  }>;
  protocolVersion: string;
}

export async function snapshotServer(
  name: string,
  config: ServerConfig
): Promise<{ name: string; snapshot: ServerSnapshot }> {
  const transportType = config.transport ?? "stdio";
  if (transportType !== "stdio") {
    throw new Error("Transport " + transportType + " not yet supported.");
  }
  if (!config.command) {
    throw new Error("Server " + name + " is missing command.");
  }

  const mcpTransport = new StdioClientTransport({
    command: config.command,
    args: config.args ?? [],
  });

  const client = new Client(
    { name: "mcp-sentinel", version: "0.1.0" },
    {}
  );

  try {
    await client.connect(mcpTransport);
    const result = await client.listTools();
    const serverInfo = client.getServerVersion();

    const tools: Record<string, LockedTool> = {};
    for (const tool of result.tools) {
      const locked: LockedTool = {
        hash: "",
        description: tool.description,
        inputSchema: (tool.inputSchema as Record<string, unknown>) ?? { type: "object" },
        outputSchema: (tool.outputSchema as Record<string, unknown> | null) ?? null,
        annotations: (tool.annotations as Record<string, unknown>) ?? {},
      };
      locked.hash = hashTool(locked);
      tools[tool.name] = locked;
    }

    await mcpTransport.close();

    return {
      name,
      snapshot: {
        transport: "stdio",
        protocolVersion: serverInfo?.version ?? "unknown",
        serverInfo: {
          name: serverInfo?.name ?? name,
          version: serverInfo?.version ?? "unknown",
        },
        tools,
      },
    };
  } catch (err) {
    await mcpTransport.close().catch(() => {});
    throw err;
  }
}

export async function fetchLiveTools(
  name: string,
  config: ServerConfig
): Promise<LiveServerData> {
  const result = await snapshotServer(name, config);
  const tools: Record<string, LiveServerData["tools"][string]> = {};
  for (const [toolName, locked] of Object.entries(result.snapshot.tools)) {
    tools[toolName] = {
      name: toolName,
      description: locked.description,
      inputSchema: locked.inputSchema,
      outputSchema: locked.outputSchema,
      annotations: locked.annotations,
    };
  }
  return {
    name: result.name,
    tools,
    protocolVersion: result.snapshot.protocolVersion,
  };
}
