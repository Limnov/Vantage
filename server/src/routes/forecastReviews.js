/**
 * 预测回评 API。
 *
 * GET  /api/forecast-reviews            组织范围内的回评记录
 * POST /api/forecast-reviews/:id/review 手动触发一次回评（owner/admin）
 */

const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { requireAuth, requireOrgRole } = require('../middleware/auth');
const store = require('../agent/store');
const { runReview } = require('../agent/forecastReviewRunner');

const router = express.Router();

function resolveOrgId(req) {
  if (req.currentOrgId) return req.currentOrgId;
  if (req.user?.is_system_admin) return parseInt(req.query?.orgId || req.body?.orgId || 0, 10) || 0;
  return 0;
}

router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const orgId = resolveOrgId(req);
  if (!orgId) {
    return res.status(400).json({ error: 'organization context required (send X-Org-ID)' });
  }
  const reportId = Number(req.query.reportId) || null;
  const status = typeof req.query.status === 'string' && req.query.status ? req.query.status : null;
  return res.json(await store.listForecastReviews({
    orgId,
    reportId,
    status,
    limit: req.query.limit,
    offset: req.query.offset
  }));
}));

router.post('/:id/review', requireAuth, requireOrgRole('owner', 'admin'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'bad_request', message: 'Valid review id required' });
  }
  const orgId = resolveOrgId(req);
  const review = await store.getForecastReview(id, req.user?.is_system_admin ? null : orgId);
  if (!review) return res.status(404).json({ error: 'Not found' });
  if (!req.user?.is_system_admin && review.org_id !== orgId) {
    return res.status(403).json({ error: 'forbidden' });
  }
  if (review.status === 'evaluating') {
    return res.status(409).json({ error: 'review_in_progress' });
  }
  const claimed = await store.claimForecastReview(id);
  if (!claimed) {
    return res.status(409).json({ error: 'not_pending', status: review.status });
  }
  try {
    const outcome = await runReview(review);
    return res.json({
      ok: true,
      outcome,
      review: await store.getForecastReview(id, review.org_id)
    });
  } catch (error) {
    const { terminal, attempts } = await store.failForecastReview(id, error.message);
    return res.status(502).json({ ok: false, error: error.message, terminal, attempts });
  }
}));

module.exports = router;
