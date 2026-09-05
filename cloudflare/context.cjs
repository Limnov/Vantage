const { AsyncLocalStorage } = require("node:async_hooks");
const scope = new AsyncLocalStorage();
function current() {
  const value = scope.getStore();
  if (!value) throw new Error("Cloudflare request context is missing");
  return value;
}
module.exports = { scope, current };
