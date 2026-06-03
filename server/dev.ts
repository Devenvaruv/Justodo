import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createServer as createViteServer, loadEnv } from "vite";
import automationTasksHandler from "../api/automation/tasks";
import tasksHandler from "../api/tasks";

const mode = process.env.NODE_ENV || "development";
const env = loadEnv(mode, process.cwd(), "");

for (const [key, value] of Object.entries(env)) {
  process.env[key] = process.env[key] ?? value;
}

const port = Number(process.env.PORT || 3000);
const vite = await createViteServer({
  appType: "spa",
  server: {
    middlewareMode: true
  }
});

const server = createServer(async (request, response) => {
  if (request.url?.startsWith("/api/automation/tasks")) {
    await handleApiRequest(request, response, automationTasksHandler);
    return;
  }

  if (request.url?.startsWith("/api/tasks")) {
    await handleApiRequest(request, response, tasksHandler);
    return;
  }

  vite.middlewares(request, response, () => {
    response.statusCode = 404;
    response.end("Not found");
  });
});

server.listen(port, () => {
  console.log(`Justodo dev server running at http://localhost:${port}`);
});

async function handleApiRequest(
  request: IncomingMessage,
  response: ServerResponse,
  handler: (request: VercelRequest, response: VercelResponse) => Promise<void>
) {
  const requestUrl = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  const body = shouldReadBody(request.method) ? await readJsonBody(request) : undefined;
  const requestAdapter = Object.assign(request, {
    query: parseQuery(requestUrl.searchParams),
    body
  }) as VercelRequest;

  const responseAdapter = Object.assign(response, {
    status(statusCode: number) {
      response.statusCode = statusCode;
      return responseAdapter;
    },
    json(payload: unknown) {
      if (!response.hasHeader("Content-Type")) {
        response.setHeader("Content-Type", "application/json");
      }

      response.end(JSON.stringify(payload));
      return responseAdapter;
    }
  }) as VercelResponse;

  await handler(requestAdapter, responseAdapter);
}

function shouldReadBody(method: string | undefined) {
  return method === "POST" || method === "PATCH" || method === "PUT";
}

async function readJsonBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const rawBody = Buffer.concat(chunks).toString("utf8");

  if (!rawBody) {
    return {};
  }

  try {
    return JSON.parse(rawBody) as unknown;
  } catch {
    return rawBody;
  }
}

function parseQuery(searchParams: URLSearchParams) {
  const query: Record<string, string | string[]> = {};

  for (const [key, value] of searchParams) {
    const currentValue = query[key];

    if (Array.isArray(currentValue)) {
      currentValue.push(value);
    } else if (currentValue) {
      query[key] = [currentValue, value];
    } else {
      query[key] = value;
    }
  }

  return query;
}
