/**
 * 关键词/关键短语提取
 */

const STOP_WORDS = new Set([
  '的', '是', '在', '和', '了', '有', '我', '你', '他', '她', '它', '们',
  '这', '那', '个', '与', '对', '也', '就', '都', '而', '及', '或', '但',
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'can', 'this', 'that', 'these', 'those',
  'i', 'you', 'he', 'she', 'it', 'we', 'they', 'what', 'which', 'who',
  'when', 'where', 'why', 'how', 'all', 'as', 'if', 'than', 'so', 'no',
  'not', 'only', 'same', 'such', 'more', 'most', 'other', 'some', 'any'
]);

function extractKeyPhrases(text, topN = 15) {
  if (!text || text.length < 10) return [];
  const words = text.match(/[\w\u4e00-\u9fa5]{2,4}(?:\s+[\w\u4e00-\u9fa5]{2,4}){0,2}/g) || [];
  const freq = new Map();
  for (const w of words) {
    const key = w.toLowerCase().trim();
    if (key.length < 2) continue;
    if (STOP_WORDS.has(key)) continue;
    if (/^\d+$/.test(key)) continue;
    freq.set(key, (freq.get(key) || 0) + 1);
  }
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, topN)
    .map(([word]) => word);
}

module.exports = { extractKeyPhrases, STOP_WORDS };
