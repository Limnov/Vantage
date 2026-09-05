const { resolveSafeHttpTarget } = require("../server/src/security/outbound");
// Uses the Workers public-only global fetch network, never a VPC or service binding.
// Redirects remain manual and no caller credentials are forwarded.
module.exports = async function fetchHtml(
  url,
  { timeout = 20000, headers = {} } = {},
) {
  const target = await resolveSafeHttpTarget(url);
  const response = await fetch(target.url.href, {
    redirect: "manual",
    headers,
    signal: AbortSignal.timeout(Math.min(timeout, 30000)),
  });
  const responseHeaders = Object.fromEntries(response.headers);
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel();
    return { status: response.status, headers: responseHeaders, data: "" };
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`HTTP ${response.status}`);
  }
  if (Number(response.headers.get("content-length") || 0) > 5 * 1024 * 1024) {
    await response.body?.cancel();
    throw new Error("page exceeds 5 MiB limit");
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 5 * 1024 * 1024) throw new Error("page exceeds 5 MiB limit");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel();
    throw error;
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return {
    status: response.status,
    headers: responseHeaders,
    data: new TextDecoder().decode(bytes),
  };
};
