import { timingSafeEqual } from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ApiError, insertTask } from "../_lib/task-service";
import type { CreateTaskRequest } from "../../shared/tasks";

export default async function handler(request: VercelRequest, response: VercelResponse) {
  try {
    if (request.method !== "POST") {
      response.setHeader("Allow", "POST");
      response.status(405).json({ error: "Method not allowed" });
      return;
    }

    if (!isAuthorized(request)) {
      response.status(401).json({ error: "Missing or invalid automation API token" });
      return;
    }

    const task = await insertTask(parseBody<CreateTaskRequest>(request));
    response.status(201).json({ task });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown server error";
    const statusCode = error instanceof ApiError ? error.statusCode : 500;
    response.status(statusCode).json({ error: message });
  }
}

function isAuthorized(request: VercelRequest) {
  const expectedToken = process.env.JUSTODO_API_TOKEN;

  if (!expectedToken) {
    throw new ApiError(500, "Missing JUSTODO_API_TOKEN. Add an automation API token to .env or Vercel environment variables.");
  }

  const actualToken = getRequestToken(request);
  return Boolean(actualToken && constantTimeEquals(expectedToken, actualToken));
}

function getRequestToken(request: VercelRequest) {
  const authorization = request.headers.authorization;

  if (authorization?.startsWith("Bearer ")) {
    return authorization.slice("Bearer ".length).trim();
  }

  const apiKey = request.headers["x-api-key"];
  return Array.isArray(apiKey) ? apiKey[0] : apiKey;
}

function constantTimeEquals(expectedToken: string, actualToken: string) {
  const expected = Buffer.from(expectedToken);
  const actual = Buffer.from(actualToken);

  if (expected.length !== actual.length) {
    return false;
  }

  return timingSafeEqual(expected, actual);
}

function parseBody<T>(request: VercelRequest): T {
  if (typeof request.body === "string") {
    return JSON.parse(request.body || "{}") as T;
  }

  return (request.body || {}) as T;
}
