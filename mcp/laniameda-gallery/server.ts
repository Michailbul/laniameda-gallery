#!/usr/bin/env bun

import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { GALLERY_MCP_INSTRUCTIONS, registerGalleryTools, type JsonRecord } from "./tools";

const API_URL =
  process.env.LANIAMEDA_GALLERY_API_URL?.replace(/\/+$/, "") ??
  process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "") ??
  "http://localhost:3317";

const AGENT_TOKEN = process.env.LANIAMEDA_GALLERY_AGENT_TOKEN?.trim();

try {
  const parsedApiUrl = new URL(API_URL);
  if (!["http:", "https:"].includes(parsedApiUrl.protocol)) {
    throw new Error("LANIAMEDA_GALLERY_API_URL must use http or https.");
  }
} catch (error) {
  throw new Error(
    error instanceof Error
      ? `Invalid LANIAMEDA_GALLERY_API_URL: ${error.message}`
      : "Invalid LANIAMEDA_GALLERY_API_URL.",
  );
}

if (!AGENT_TOKEN) {
  throw new Error(
    "LANIAMEDA_GALLERY_AGENT_TOKEN is required. Create one from /agents in the gallery app.",
  );
}

const apiFetch = async (path: string, body: JsonRecord) => {
  const response = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${AGENT_TOKEN}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(300_000),
  });

  const responseText = await response.text();
  let responseBody: JsonRecord;
  try {
    responseBody = responseText
      ? (JSON.parse(responseText) as JsonRecord)
      : { error: response.statusText };
  } catch {
    responseBody = { error: responseText || response.statusText };
  }

  if (!response.ok) {
    throw new Error(
      typeof responseBody.error === "string"
        ? responseBody.error
        : `Request failed with HTTP ${response.status}`,
    );
  }

  return responseBody;
};

const readLocalFile = (filePath: string) => {
  if (!existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  return {
    base64: readFileSync(filePath).toString("base64"),
    fileName: basename(filePath),
  };
};

const server = new McpServer(
  { name: "laniameda-gallery", version: "0.3.0" },
  { instructions: GALLERY_MCP_INSTRUCTIONS },
);

registerGalleryTools(server, { apiFetch, apiUrl: API_URL, readLocalFile });

await server.connect(new StdioServerTransport());
