async function extractWithPlaywright() {
  return {
    content: "",
    title: "",
    rendered: false,
    error:
      "Cloudflare deployment uses safe HTML extraction; browser rendering is not enabled",
  };
}
module.exports = {
  extractWithPlaywright,
  closeBrowser: async () => {},
  getBrowser: async () => {
    throw new Error("Browser rendering is not enabled");
  },
};
