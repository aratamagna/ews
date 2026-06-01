/**
 * Netlify Function: Unified API Router
 *
 * This function acts as a catch-all router for /api/* requests, adapting the
 * Cloudflare Pages Functions convention ({ request, env }) to Netlify Functions.
 *
 * Route matching:
 *   /api/stripe/webhook        → POST stripe webhook handler
 *   /api/stripe/customer-portal→ GET  redirect to Stripe billing portal
 *   /api/signup/create-checkout-session → POST create Stripe checkout
 *   /api/manage/subscriber     → GET|POST manage subscriber settings
 *   /api/admin/subscribers     → POST create manual subscriber
 *   /api/admin/subscriber-history → GET|POST subscriber message history
 *   /api/admin/messaging-status→ GET  check SMS provider status
 *   /api/admin/test-alert      → GET|POST admin test alerts
 *   /api/internal/level5-alert → POST send level 5 notifications
 *   /api/internal/renewal-reminders → POST send renewal reminder batch
 *   /api/internal/anonymize-pending-signups → POST anonymize stale signups
 *   /api/telnyx/webhook        → POST Telnyx inbound/status webhook
 */

import { createD1Adapter } from "./lib/db-adapter.js";

// ─── Route handlers (imported from the original Cloudflare Pages Functions) ──

// Stripe
import { onRequestPost as stripeWebhookPost } from "../../functions/api/stripe/webhook.js";
import { onRequestGet as customerPortalGet } from "../../functions/api/stripe/customer-portal.js";

// Signup
import { onRequestPost as createCheckoutPost } from "../../functions/api/signup/create-checkout-session.js";

// Manage
import {
  onRequestGet as manageSubscriberGet,
  onRequestPost as manageSubscriberPost,
} from "../../functions/api/manage/subscriber.js";

// Admin
import { onRequestPost as adminSubscribersPost } from "../../functions/api/admin/subscribers.js";
import {
  onRequestGet as adminHistoryGet,
  onRequestPost as adminHistoryPost,
} from "../../functions/api/admin/subscriber-history.js";
import { onRequestGet as messagingStatusGet } from "../../functions/api/admin/messaging-status.js";
import {
  onRequestGet as testAlertGet,
  onRequestPost as testAlertPost,
} from "../../functions/api/admin/test-alert.js";

// Internal
import { onRequestPost as level5AlertPost } from "../../functions/api/internal/level5-alert.js";
import { onRequestPost as renewalRemindersPost } from "../../functions/api/internal/renewal-reminders.js";
import { onRequestPost as anonymizeSignupsPost } from "../../functions/api/internal/anonymize-pending-signups.js";

// Telnyx
import { onRequestPost as telnyxWebhookPost } from "../../functions/api/telnyx/webhook.js";

// ─── Route map ───────────────────────────────────────────────────────────────

const ROUTES = [
  // Stripe
  { method: "POST", path: "/api/stripe/webhook", handler: stripeWebhookPost },
  { method: "GET", path: "/api/stripe/customer-portal", handler: customerPortalGet },
  // Signup
  { method: "POST", path: "/api/signup/create-checkout-session", handler: createCheckoutPost },
  // Manage
  { method: "GET", path: "/api/manage/subscriber", handler: manageSubscriberGet },
  { method: "POST", path: "/api/manage/subscriber", handler: manageSubscriberPost },
  // Admin
  { method: "POST", path: "/api/admin/subscribers", handler: adminSubscribersPost },
  { method: "GET", path: "/api/admin/subscriber-history", handler: adminHistoryGet },
  { method: "POST", path: "/api/admin/subscriber-history", handler: adminHistoryPost },
  { method: "GET", path: "/api/admin/messaging-status", handler: messagingStatusGet },
  { method: "GET", path: "/api/admin/test-alert", handler: testAlertGet },
  { method: "POST", path: "/api/admin/test-alert", handler: testAlertPost },
  // Internal
  { method: "POST", path: "/api/internal/level5-alert", handler: level5AlertPost },
  { method: "POST", path: "/api/internal/renewal-reminders", handler: renewalRemindersPost },
  { method: "POST", path: "/api/internal/anonymize-pending-signups", handler: anonymizeSignupsPost },
  // Telnyx
  { method: "POST", path: "/api/telnyx/webhook", handler: telnyxWebhookPost },
];

// ─── Environment builder ─────────────────────────────────────────────────────

let _cachedDb = null;

function getDatabase() {
  if (_cachedDb) return _cachedDb;

  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;

  if (!url) {
    console.warn("[api] TURSO_DATABASE_URL is not set. Database operations will fail.");
    return null;
  }

  _cachedDb = createD1Adapter(url, authToken);
  return _cachedDb;
}

function buildEnv() {
  // Start with all process.env variables (Netlify injects these from site settings)
  const env = { ...process.env };

  // Wire up the D1-compatible database binding
  env.EWS_NOTIFY_DB = getDatabase();

  return env;
}

// ─── Request/Response adapters ───────────────────────────────────────────────

/**
 * Convert Netlify's event object into a Web API Request.
 * Netlify Functions receive (event, context).
 */
function buildRequest(event) {
  const { httpMethod, headers, body, isBase64Encoded, rawUrl } = event;

  const requestHeaders = new Headers();
  for (const [key, value] of Object.entries(headers || {})) {
    if (value != null) requestHeaders.set(key, value);
  }

  // Map Netlify's client IP header to cf-connecting-ip for compatibility
  const clientIp =
    headers?.["x-nf-client-connection-ip"] || headers?.["x-forwarded-for"]?.split(",")[0]?.trim();
  if (clientIp && !requestHeaders.has("cf-connecting-ip")) {
    requestHeaders.set("cf-connecting-ip", clientIp);
  }

  const init = {
    method: httpMethod,
    headers: requestHeaders,
  };

  // Attach body for non-GET/HEAD requests
  if (body && httpMethod !== "GET" && httpMethod !== "HEAD") {
    if (isBase64Encoded) {
      init.body = Buffer.from(body, "base64");
    } else {
      init.body = body;
    }
    // Ensure duplex is set for Request with body (Node 18+)
    init.duplex = "half";
  }

  return new Request(rawUrl || `https://localhost${event.path}`, init);
}

/**
 * Convert a Web API Response to Netlify's response format.
 */
async function toNetlifyResponse(webResponse) {
  const headers = {};
  webResponse.headers.forEach((value, key) => {
    headers[key] = value;
  });

  // Handle redirects — Netlify needs the Location header
  if (webResponse.status >= 300 && webResponse.status < 400) {
    const location = webResponse.headers.get("location");
    if (location) {
      headers.location = location;
    }
  }

  const body = await webResponse.text();

  return {
    statusCode: webResponse.status,
    headers,
    body,
  };
}

// ─── Route matcher ───────────────────────────────────────────────────────────

function matchRoute(method, path) {
  // Normalize path (strip trailing slash, lowercase)
  const normalizedPath = path.replace(/\/+$/, "").toLowerCase();

  for (const route of ROUTES) {
    if (route.method === method && route.path === normalizedPath) {
      return route.handler;
    }
  }

  return null;
}

// ─── Main handler ────────────────────────────────────────────────────────────

export async function handler(event, context) {
  const method = event.httpMethod;
  const path = event.path;

  // Find matching handler
  const handlerFn = matchRoute(method, path);

  if (!handlerFn) {
    // Return 404 for unmatched API routes
    return {
      statusCode: 404,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        error: "API endpoint not found.",
        method,
        path,
        availableRoutes: ROUTES.map((r) => `${r.method} ${r.path}`),
      }),
    };
  }

  try {
    const request = buildRequest(event);
    const env = buildEnv();

    // Invoke the original Cloudflare Pages Function handler
    const response = await handlerFn({ request, env });
    return await toNetlifyResponse(response);
  } catch (error) {
    console.error(`[api] Unhandled error in ${method} ${path}:`, error);
    return {
      statusCode: 500,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        error: "Internal server error.",
        ...(process.env.NODE_ENV !== "production" ? { message: error.message } : {}),
      }),
    };
  }
}
