/**
 * Cloudflare Worker Relay
 * Routes all incoming traffic to the configured backend (TARGET_DOMAIN)
 */

export default {
  async fetch(request, env, ctx) {
    return handleRequest(request, env);
  },
};

async function handleRequest(request, env) {
  // Read TARGET_DOMAIN from environment variables
  const targetDomain = env.TARGET_DOMAIN;

  if (!targetDomain) {
    return new Response("Misconfigured: TARGET_DOMAIN is not set", {
      status: 500,
      headers: { "Content-Type": "text/plain" },
    });
  }

  // Remove trailing slash from target domain
  const targetBase = targetDomain.replace(/\/$/, "");

  const url = new URL(request.url);

  // Construct upstream URL
  const upstreamUrl = `${targetBase}${url.pathname}${url.search}`;

  // Headers to strip (hop-by-hop headers)
  const headersToStrip = [
    "host",
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
  ];

  // Clone and filter request headers
  const filteredHeaders = new Headers(request.headers);

  headersToStrip.forEach((header) => {
    filteredHeaders.delete(header.toLowerCase());
  });

  // Preserve client IP (Cloudflare provides CF-Connecting-IP)
  const clientIP =
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For") ||
    request.headers.get("X-Real-IP");

  if (clientIP) {
    filteredHeaders.set("X-Forwarded-For", clientIP);
    filteredHeaders.set("X-Real-IP", clientIP);
  }

  // Set correct Host header for upstream
  filteredHeaders.set("Host", new URL(targetBase).hostname);

  // Prepare fetch options
  const fetchOptions = {
    method: request.method,
    headers: filteredHeaders,
    redirect: "manual",
  };

  // Include body for non-GET/HEAD requests
  if (request.method !== "GET" && request.method !== "HEAD") {
    fetchOptions.body = request.body;
  }

  try {
    // Forward request to upstream
    const response = await fetch(upstreamUrl, fetchOptions);

    // Clone response headers and strip hop-by-hop headers
    const responseHeaders = new Headers(response.headers);
    
    headersToStrip.forEach((header) => {
      responseHeaders.delete(header.toLowerCase());
    });

    // Return proxied response
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error("Relay failed:", error);
    return new Response("Bad Gateway: Relay Failed", {
      status: 502,
      headers: { "Content-Type": "text/plain" },
    });
  }
}
