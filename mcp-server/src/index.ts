import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const PROXY_URL = "http://127.0.0.1:8000";

const server = new McpServer({
  name: "winston-mcp-server",
  version: "0.1.0",
});

server.tool(
  "check_budget",
  "Checks with the Winston Proxy whether the current project has sufficient budget before proceeding. Call this before any expensive operation. If the result is 'denied', you MUST halt execution immediately.",
  {
    project_id: z.string().describe("The project identifier to check budget for."),
    cost_estimate: z.number().describe("Estimated cost in USD for the planned operation."),
  },
  async ({ project_id, cost_estimate }) => {
    let res: Response;
    try {
      res = await fetch(`${PROXY_URL}/v1/budget/check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id, cost_estimate }),
      });
    } catch (err) {
      return {
        content: [
          {
            type: "text",
            text: `ERROR: Could not reach Winston Proxy at ${PROXY_URL}. Halt execution until the proxy is available. Details: ${String(err)}`,
          },
        ],
      };
    }

    if (res.ok) {
      const data = await res.json();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(data, null, 2),
          },
        ],
      };
    }

    if (res.status === 402) {
      const data = await res.json();
      return {
        content: [
          {
            type: "text",
            text: `BUDGET DENIED — halt execution immediately. Do not make any further LLM or tool calls for this project. Proxy response: ${JSON.stringify(data)}`,
          },
        ],
      };
    }

    // Unexpected error from proxy — fail safe by blocking.
    const text = await res.text();
    return {
      content: [
        {
          type: "text",
          text: `ERROR: Unexpected response from Winston Proxy (HTTP ${res.status}). Halt execution. Details: ${text}`,
        },
      ],
    };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Winston MCP Server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
