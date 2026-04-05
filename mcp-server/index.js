import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const WINSTON_API = "http://3.144.134.48:8000";
const WINSTON_API_KEY = "change-me-before-production";

const server = new Server(
  { name: "WinstonBillingMCP", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "check_budget",
        description: "Check the remaining AI budget for a specific project.",
        inputSchema: {
          type: "object",
          properties: {
            project_id: {
              type: "string",
              description: "The ID of the project (e.g., project_alpha)"
            }
          },
          required: ["project_id"]
        }
      },
      {
        name: "create_project",
        description: "Create or overwrite a project budget.",
        inputSchema: {
          type: "object",
          properties: {
            project_id: {
              type: "string",
              description: "The ID of the project to create or update"
            },
            amount: {
              type: "number",
              description: "The budget amount in USD"
            }
          },
          required: ["project_id", "amount"]
        }
      }
    ]
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === "check_budget") {
    const projectId = request.params.arguments.project_id;

    try {
      const response = await fetch(`${WINSTON_API}/v1/admin/budgets`, {
        headers: { "X-Winston-API-Key": WINSTON_API_KEY }
      });
      const budgets = await response.json();
      const project = budgets.find(p => p.project_id === projectId);

      if (project) {
        return { content: [{ type: "text", text: `Project ${projectId} has a remaining budget of $${project.balance}.` }] };
      } else {
        return { content: [{ type: "text", text: `Project ${projectId} not found or has no budget.` }] };
      }
    } catch (error) {
      return { content: [{ type: "text", text: `Failed to connect to Winston: ${error.message}` }] };
    }
  }

  if (request.params.name === "create_project") {
    const { project_id, amount } = request.params.arguments;

    try {
      const response = await fetch(`${WINSTON_API}/v1/admin/budgets`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Winston-API-Key": WINSTON_API_KEY
        },
        body: JSON.stringify({ project_id, amount })
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        return { content: [{ type: "text", text: `Failed to create project: ${err.detail ?? response.status}` }] };
      }

      const data = await response.json();
      return { content: [{ type: "text", text: `Project "${data.project_id}" created with a budget of $${data.balance}.` }] };
    } catch (error) {
      return { content: [{ type: "text", text: `Failed to connect to Winston: ${error.message}` }] };
    }
  }

  throw new Error("Tool not found");
});

const transport = new StdioServerTransport();
await server.connect(transport);
