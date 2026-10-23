import PincodeCache from '../models/PincodeCache.js';
import { ApiError, asyncHandler } from '../middleware/error.js';

// PIN code -> post offices, district and state, for every PIN code in India.
// Primary source: India Post (api.postalpincode.in). Fallback: Zippopotam.
// Both URLs can be changed with env vars (PINCODE_API_URL, PINCODE_FALLBACK_URL).
const PRIMARY = () => process.env.PINCODE_API_URL || 'https://api.postalpincode.in/pincode/';
const FALLBACK = () => (process.env.PINCODE_FALLBACK_URL === undefined ? 'https://api.zippopotam.us/in/' : process.env.PINCODE_FALLBACK_URL);
const TIMEOUT = 8000;
const NOT_FOUND_TTL = 24 * 60 * 60 * 1000; // re-check unknown PINs once a day
export const INVALID_PIN = 'Invalid PIN code. Please enter a valid PIN code.';
const PIN = /^[1-9]\d{5}$/;

const tidy = (s) => String(s || '').replace(/\s+/g, ' ').trim();

async function getJson(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (r.status === 404) return { status: 404, data: null };
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return { status: r.status, data: await r.json() };
  } finally {
    clearTimeout(timer);
  }
}

// -> { found: true, district, state, offices } | { found: false }   (throws when the service can't be reached)
async function fromIndiaPost(pin) {
  const { data } = await getJson(PRIMARY() + pin);
  const first = Array.isArray(data) ? data[0] : data;
  if (!first || typeof first !== 'object') throw new Error('Unexpected response');
  const list = Array.isArray(first.PostOffice) ? first.PostOffice : [];
  if (first.Status !== 'Success' || !list.length) {
    if (first.Status === 'Error' || first.Status === '404' || /no records/i.test(first.Message || '')) return { found: false };
    throw new Error(first.Message || 'Unexpected response');
  }
  const offices = list.map((o) => ({
    name: tidy(o.Name),
    district: tidy(o.District),
    state: tidy(o.State),
    block: tidy(o.Block) === 'NA' ? '' : tidy(o.Block),
    branchType: tidy(o.BranchType),
    delivery: tidy(o.DeliveryStatus),
  })).filter((o) => o.name);
  const mostCommon = (key) => {
    const counts = {};
    offices.forEach((o) => { if (o[key]) counts[o[key]] = (counts[o[key]] || 0) + 1; });
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
  };
  return { found: true, district: mostCommon('district'), state: mostCommon('state'), offices, source: 'indiapost' };
}

async function fromZippopotam(pin) {
  if (!FALLBACK()) throw new Error('No fallback');
  const { status, data } = await getJson(FALLBACK() + pin);
  if (status === 404 || !data?.places?.length) return { found: false };
  const offices = data.places.map((p) => ({ name: tidy(p['place name']), district: '', state: tidy(p.state), block: '', branchType: '', delivery: '' })).filter((o) => o.name);
  return { found: true, district: '', state: offices[0]?.state || '', offices, source: 'zippopotam' };
}

// small per-IP limit so the lookup can't be used to hammer the outside services
const hits = new Map();
function tooMany(ip) {
  const now = Date.now();
  const rec = hits.get(ip) || { n: 0, at: now };
  if (now - rec.at > 60000) { rec.n = 0; rec.at = now; }
  rec.n += 1;
  hits.set(ip, rec);
  if (hits.size > 5000) hits.clear();
  return rec.n > 60;
}

// India Post gives districts, not cities: 'Bengaluru Urban' -> 'Bengaluru', 'Mumbai Suburban' -> 'Mumbai', 'Central Delhi' -> 'Delhi'
export function cityFromDistrict(district, state) {
  const d = tidy(district);
  if (/^delhi$/i.test(tidy(state)) || /\bdelhi$/i.test(d)) return d ? 'Delhi' : '';
  return d.replace(/\s+(urban|rural|suburban|city)$/i, '').trim();
}

const shape = (pin, r) => {
  const district = r.district || '';
  const offices = (r.offices || []).map((o) => ({ name: o.name, district: o.district || district, state: o.state || r.state, block: o.block || '', branchType: o.branchType || '' }));
  return { pincode: pin, city: cityFromDistrict(district, r.state), district, state: r.state || '', offices, partial: r.source === 'zippopotam' };
};

// GET /api/pincode/:pin
export const lookupPincode = asyncHandler(async (req, res) => {
  const pin = String(req.params.pin || '').trim();
  if (!PIN.test(pin)) throw new ApiError(400, INVALID_PIN);

  const cached = await PincodeCache.findOne({ pincode: pin }).lean().catch(() => null);
  if (cached && cached.found) return res.json({ success: true, ...shape(pin, cached), cached: true });
  if (cached && !cached.found && Date.now() - new Date(cached.updatedAt).getTime() < NOT_FOUND_TTL) throw new ApiError(404, INVALID_PIN);

  if (tooMany(req.ip)) throw new ApiError(429, 'Too many PIN code lookups. Please wait a minute and try again.');

  let result = null;
  let primaryNotFound = false;
  try {
    result = await fromIndiaPost(pin);
    if (!result.found) { primaryNotFound = true; result = null; }
  } catch (e) {
    console.warn(`[pincode] India Post lookup failed for ${pin}: ${e.message}`);
  }
  if (!result) {
    try {
      const z = await fromZippopotam(pin);
      if (z.found) result = z;
      else if (primaryNotFound) result = { found: false };
    } catch (e) {
      if (primaryNotFound) result = { found: false };
      else console.warn(`[pincode] fallback lookup failed for ${pin}: ${e.message}`);
    }
  }

  if (!result) throw new ApiError(503, 'We could not look up this PIN code right now. Please try again, or type the city yourself.');

  // only cache complete India Post answers and confirmed "not found"; a partial fallback answer is retried next time
  if (!result.found || result.source === 'indiapost') {
    await PincodeCache.findOneAndUpdate(
      { pincode: pin },
      { pincode: pin, found: result.found, district: result.district, state: result.state, offices: result.offices || [], source: result.source },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).catch(() => {});
  }
  if (!result.found) throw new ApiError(404, INVALID_PIN);
  res.json({ success: true, ...shape(pin, result) });
});
