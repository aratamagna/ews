/**
 * Netlify Function: Dashboard JSON Proxy
 *
 * Serves dashboard snapshots from Netlify Blobs at public URLs:
 *   /data/dashboard.json
 *   /data/military-dashboard.json
 *   /data/untracked-dashboard.json
 *   /data/rss.xml
 *
 * This replaces the Cloudflare R2 public bucket URLs that the client
 * previously fetched from directly.
 */

import { getStore } from "@netlify/blobs";

const STORE_NAME = "ews-public";

const ALLOWED_KEYS = new Set([
  "dashboard.json",
  "military-dashboard.json",
  "untracked-dashboard.json",
  "rss.xml",
]);

const CONTENT_TYPES = {
  "dashboard.json": "application/json; charset=utf-8",
  "military-dashboard.json": "application/json; charset=utf-8",
  "untracked-dashboard.json": "application/json; charset=utf-8",
  "rss.xml": "application/rss+xml; charset=utf-8",
};

export default async function handler(request, context) {
  const url = new URL(request.url);
  // Extract key from path: /data/dashboard.json -> dashboard.json
  const key = url.pathname.replace(/^\/data\//, "");

  if (!ALLOWED_KEYS.has(key)) {
    return new Response(JSON.stringify({ error: "Not found." }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }

  try {
    const store = getStore(STORE_NAME);
    const blob = await store.get(key, { type: "arrayBuffer" });

    if (!blob) {
      return new Response(JSON.stringify({ error: "Snapshot not available yet. Run the refresh workflow first." }), {
        status: 404,
        headers: {
          "content-type": "application/json",
          "cache-control": "no-cache",
        },
      });
    }

    const contentType = CONTENT_TYPES[key] || "application/octet-stream";

    return new Response(blob, {
      status: 200,
      headers: {
        "content-type": contentType,
        "cache-control": "public, max-age=300",
        "access-control-allow-origin": "*",
      },
    });
  } catch (error) {
    console.error(`[dashboard-proxy] Error fetching ${key}:`, error);
    return new Response(JSON.stringify({ error: "Failed to load snapshot." }), {
      status: 502,
      headers: { "content-type": "application/json" },
    });
  }
}

export const config = {
  path: "/data/*",
};
