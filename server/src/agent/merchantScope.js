function explicitSearchWindowDays(goal) {
  const text = String(goal || '').toLocaleLowerCase();
  const match = text.match(/(?:最近|近|过去|last|past|recent)\s*(\d{1,3})\s*(天|日|days?|d|周|星期|weeks?|w|个月|月|months?|mo)/i);
  if (match) {
    const amount = Number(match[1]);
    const unit = match[2].toLocaleLowerCase();
    const multiplier = /周|星期|week|^w$/.test(unit) ? 7 : /月|month|^mo$/.test(unit) ? 30 : 1;
    return Math.min(365, Math.max(1, amount * multiplier));
  }
  if (/(?:最近|近|过去)一个月|(?:last|past|recent)\s+month/i.test(text)) return 30;
  if (/(?:最近|近|过去)(?:一周|一星期)|(?:last|past|recent)\s+week/i.test(text)) return 7;
  return null;
}

function sourceScope({ goal, merchant = {}, source = {}, now = new Date() }) {
  const days = explicitSearchWindowDays(goal);
  if (days === null) return { status: 'not_requested', reason: null };

  const published = Date.parse(String(source.published_date || ''));
  const asOf = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (!Number.isFinite(published)) return { status: 'background', reason: 'publication_date_unknown' };
  if (published < asOf - days * 86400000 || published > asOf + 86400000) {
    return { status: 'background', reason: 'outside_time_window' };
  }

  const title = String(source.title || '');
  const url = String(source.url || '');
  const lead = String(source.excerpt || '').substring(0, 1500);
  if (/forecast|outlook|market size|market share|cagr|预测|市场规模|市场份额/i.test(title)) {
    return { status: 'background', reason: 'long_horizon_or_historical_report' };
  }
  const industry = String(merchant.industry || '').trim();
  const region = String(merchant.region || '').trim();
  const accessoryIndustry = /手机配件|手机周边|phone accessories|mobile accessories|smartphone accessories/i.test(industry);
  const categoryMatch = accessoryIndustry
    ? /手机配件|手机壳|充电宝|移动电源|手机充电|无线充电|保护膜|phone accessories|mobile accessories|smartphone accessories|phone case|phone cover|power bank|portable charger|wireless charg|magsafe|screen protect|charging cable|iphone.{0,30}(?:case|strap|wallet)|(?:case|strap|wallet).{0,30}iphone/i.test(`${title} ${lead}`)
    : !industry || `${title} ${lead}`.toLocaleLowerCase().includes(industry.toLocaleLowerCase());
  if (!categoryMatch) return { status: 'background', reason: 'category_not_established' };

  const usRegion = /^(美国|us|usa|united states)$/i.test(region);
  // A US storefront with a USD price and an available purchase action is a US
  // product lead; a USD price alone on a global announcement is not enough.
  const usStorefrontAvailability = /\b(?:US|USA|United States)\s+(?:Home|Store|Shop)\b/i.test(lead)
    && /\$\s*\d/.test(lead)
    && /\b(?:available now|shop now|order now|in stock)\b/i.test(lead);
  const regionMatch = usRegion
    ? /美国|united states|\bu\.?s\.?a?\b|\bamerican\b/i.test(`${title} ${url}`)
      || /^https?:\/\/(?:www\.)?cpsc\.gov\//i.test(url)
      || /(?:\b(?:in|for|across)\s+(?:the\s+)?(?:united states|u\.s\.|usa)(?=\W|$)|\bus\s+(?:customers?|stores?|retailers?|pricing|availability)\b|\bLos Angeles\b)/i.test(lead)
      || usStorefrontAvailability
    : !region || `${title} ${url}`.toLocaleLowerCase().includes(region.toLocaleLowerCase());
  if (!regionMatch) return { status: 'background', reason: 'region_not_established' };

  return { status: 'in_scope', reason: null };
}

module.exports = { explicitSearchWindowDays, sourceScope };
