#!/usr/bin/env node
/**
 * Netlify Blobs CLI Helper
 *
 * A CLI tool for interacting with Netlify Blobs from GitHub Actions,
 * replacing the Cloudflare R2 wrangler commands.
 *
 * Usage:
 *   node scripts/netlify-blobs.js get <store> <key> --file <local-path>
 *   node scripts/netlify-blobs.js put <store> <key> --file <local-path> [--content-type <type>]
 *   node scripts/netlify-blobs.js delete <store> <key>
 *
 * Environment variables required:
 *   NETLIFY_SITE_ID   — Your Netlify site ID
 *   NETLIFY_AUTH_TOKEN — Your Netlify personal access token
 *
 * Examples:
 *   # Download state database
 *   node scripts/netlify-blobs.js get ews-state ews-main.sqlite --file data/ews-main.sqlite
 *
 *   # Upload dashboard snapshot
 *   node scripts/netlify-blobs.js put ews-public dashboard.json --file tmp/dashboard.json --content-type application/json
 */

const fs = require("node:fs");
const path = require("node:path");

const NETLIFY_API_BASE = "https://api.netlify.com/api/v1";

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Error: ${name} environment variable is required.`);
    process.exit(1);
  }
  return value;
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const command = args[0];
  const store = args[1];
  const key = args[2];
  const options = {};

  for (let i = 3; i < args.length; i++) {
    if (args[i] === "--file" && args[i + 1]) {
      options.file = args[++i];
    } else if (args[i] === "--content-type" && args[i + 1]) {
      options.contentType = args[++i];
    } else if (args[i] === "--metadata" && args[i + 1]) {
      options.metadata = JSON.parse(args[++i]);
    }
  }

  return { command, store, key, options };
}

async function netlifyBlobsRequest(method, storeName, key, options = {}) {
  const siteId = requireEnv("NETLIFY_SITE_ID");
  const token = requireEnv("NETLIFY_AUTH_TOKEN");

  // Netlify Blobs API: https://api.netlify.com/api/v1/blobs/{site_id}/{store}/{key}
  const url = `${NETLIFY_API_BASE}/blobs/${siteId}/${encodeURIComponent(storeName)}/${encodeURIComponent(key)}`;

  const headers = {
    authorization: `Bearer ${token}`,
  };

  if (options.contentType) {
    headers["content-type"] = options.contentType;
  }

  if (options.metadata) {
    headers["x-amz-meta-custom"] = JSON.stringify(options.metadata);
  }

  const init = { method, headers };

  if (options.body) {
    init.body = options.body;
  }

  const response = await fetch(url, init);
  return response;
}

async function getBlob(store, key, filePath) {
  console.log(`Downloading ${store}/${key} -> ${filePath}`);

  const response = await netlifyBlobsRequest("GET", store, key);

  if (!response.ok) {
    if (response.status === 404) {
      console.error(`Not found: ${store}/${key}`);
      process.exit(1);
    }
    const text = await response.text();
    console.error(`Failed to get blob (${response.status}): ${text}`);
    process.exit(1);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, buffer);
  console.log(`Downloaded ${buffer.length} bytes to ${filePath}`);
}

async function putBlob(store, key, filePath, options = {}) {
  console.log(`Uploading ${filePath} -> ${store}/${key}`);

  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  const body = fs.readFileSync(filePath);
  const contentType = options.contentType || "application/octet-stream";

  const response = await netlifyBlobsRequest("PUT", store, key, {
    body,
    contentType,
    metadata: options.metadata,
  });

  if (!response.ok) {
    const text = await response.text();
    console.error(`Failed to upload blob (${response.status}): ${text}`);
    process.exit(1);
  }

  console.log(`Uploaded ${body.length} bytes to ${store}/${key}`);
}

async function deleteBlob(store, key) {
  console.log(`Deleting ${store}/${key}`);

  const response = await netlifyBlobsRequest("DELETE", store, key);

  if (!response.ok && response.status !== 404) {
    const text = await response.text();
    console.error(`Failed to delete blob (${response.status}): ${text}`);
    process.exit(1);
  }

  console.log(`Deleted ${store}/${key}`);
}

async function main() {
  const { command, store, key, options } = parseArgs(process.argv);

  if (!command || !store) {
    console.error("Usage: netlify-blobs.js <get|put|delete> <store> <key> [options]");
    console.error("");
    console.error("Commands:");
    console.error("  get <store> <key> --file <path>     Download a blob to a local file");
    console.error("  put <store> <key> --file <path>     Upload a local file as a blob");
    console.error("  delete <store> <key>                Delete a blob");
    console.error("");
    console.error("Options:");
    console.error("  --file <path>           Local file path");
    console.error("  --content-type <type>   Content type for uploads");
    console.error("  --metadata <json>       JSON metadata for uploads");
    console.error("");
    console.error("Environment:");
    console.error("  NETLIFY_SITE_ID         Netlify site ID");
    console.error("  NETLIFY_AUTH_TOKEN      Netlify personal access token");
    process.exit(1);
  }

  switch (command) {
    case "get":
      if (!key || !options.file) {
        console.error("Usage: netlify-blobs.js get <store> <key> --file <path>");
        process.exit(1);
      }
      await getBlob(store, key, options.file);
      break;

    case "put":
      if (!key || !options.file) {
        console.error("Usage: netlify-blobs.js put <store> <key> --file <path>");
        process.exit(1);
      }
      await putBlob(store, key, options.file, options);
      break;

    case "delete":
      if (!key) {
        console.error("Usage: netlify-blobs.js delete <store> <key>");
        process.exit(1);
      }
      await deleteBlob(store, key);
      break;

    default:
      console.error(`Unknown command: ${command}`);
      process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
