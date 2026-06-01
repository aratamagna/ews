/**
 * Netlify-specific request context helpers.
 *
 * On Netlify, the client IP is available via:
 *   - x-nf-client-connection-ip (Netlify's native header)
 *   - x-forwarded-for (standard proxy header)
 *
 * The API router maps these to cf-connecting-ip for compatibility with the
 * original Cloudflare functions, but this module provides direct access when
 * needed.
 */

/**
 * Get the real client IP from a Netlify request event.
 * @param {object} event - Netlify function event
 * @returns {string|null}
 */
export function getClientIp(event) {
  const headers = event.headers || {};
  return (
    headers["x-nf-client-connection-ip"] ||
    headers["cf-connecting-ip"] ||
    headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    null
  );
}

/**
 * Get the user agent from a Netlify request event.
 * @param {object} event - Netlify function event
 * @returns {string|null}
 */
export function getUserAgent(event) {
  return event.headers?.["user-agent"] || null;
}
