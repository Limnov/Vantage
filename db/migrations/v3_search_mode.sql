-- ============================================================
-- Vantage v3.0 - 搜索模式字段（SQLite）
-- ============================================================
-- search_mode 已纳入 canonical db/schema.sql。这里仅负责对旧数据回填。

UPDATE watchlist
SET search_mode = 'product'
WHERE type IN ('product', 'brand')
  AND (search_mode IS NULL OR search_mode = '');

UPDATE watchlist
SET search_mode = 'news'
WHERE type IN ('keyword', 'topic', 'url')
  AND (search_mode IS NULL OR search_mode = '');
