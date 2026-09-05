const parser = require("../server/node_modules/cron-parser");
module.exports = {
  validate(value) {
    try {
      parser.parseExpression(value);
      return true;
    } catch {
      return false;
    }
  },
  schedule() {
    throw new Error("Use Cloudflare Cron Triggers");
  },
};
