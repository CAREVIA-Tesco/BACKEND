// Service list changes (Nov 2026). Runs on every start-up; each step only changes what still needs it.
//  - removes BHS, Neuro Rehab Test and Diagnostic Rehab from the website services
//  - renames "Doctor Visit" to "General Medicine"
//  - BHS professionals become BHMS (homeopathy) and are listed under Homeopathy
//  - professionals keep only the visit types their profession allows
//    (nurses, care takers, lab centres: home visits; homeopathy: clinic and online)
import { Service } from '../models/Catalog.js';
import Provider from '../models/Provider.js';
import SiteContent from '../models/SiteContent.js';
import Counter from '../models/Counter.js';
import { isRemovedService, RENAMED_SERVICES, PROFESSION_VISIT_TYPES } from '../utils/serviceRules.js';

const TYPES = ['home', 'clinic', 'online'];

export async function applyServiceUpdates() {
  // never stop the server from starting because of this clean-up
  try { await run(); } catch (err) { console.error('[services] update skipped:', err.message); }
}

async function run() {
  const done = [];

  // 1. removed services (once: an admin may add a service with one of these names again later)
  const once = !(await Counter.exists({ _id: 'migration:services-2026-11' }));
  const removed = once ? (await Service.find()).filter(isRemovedService) : [];
  if (removed.length) {
    await Service.deleteMany({ _id: { $in: removed.map((s) => s._id) } });
    done.push(`removed ${removed.map((s) => s.name).join(', ')}`);
  }
  const removedNames = removed.map((s) => s.name);

  // 2. renamed services
  for (const [from, to] of Object.entries(once ? RENAMED_SERVICES : {})) {
    if (await Service.exists({ name: to })) continue;
    const r = await Service.updateOne({ name: from }, { $set: { name: to } });
    if (r.modifiedCount) done.push(`renamed ${from} to ${to}`);
  }
  if (once) await Service.updateOne({ key: 'doctor-visit', short: 'Online & clinic consults' }, { $set: { short: 'Consult a general physician' } });

  // homeopathy is offered by Homeopathy Doctors and BHMS professionals, at the clinic or online
  const homeo = await Service.findOne({ key: 'homeopathy' });
  if (homeo && once) {
    let mod = false;
    if (!(homeo.professions || []).includes('BHMS')) { homeo.professions = [...(homeo.professions || ['Homeopathy Doctor']), 'BHMS']; mod = true; }
    if (/at home or online/.test(homeo.desc || '')) { homeo.desc = homeo.desc.replace('at home or online', 'at the clinic or online'); mod = true; }
    if (mod) await homeo.save();
  }

  // 3. BHS professionals -> BHMS (homeopathy)
  const bhs = await Provider.updateMany({ profession: 'BHS' }, { $set: { profession: 'BHMS', spec: 'Homeopathy Doctor', isDoctor: true } });
  if (bhs.modifiedCount) done.push(`${bhs.modifiedCount} BHS professional(s) moved to BHMS`);
  await Provider.updateMany({ spec: 'BHS' }, { $set: { spec: 'Homeopathy Doctor' } });
  // removed services are taken off professionals' service lists
  // and renamed ones get their new name (done per profile, so it works on every MongoDB-compatible server)
  const gone = (n) => removedNames.includes(n) || isRemovedService({ name: n });
  const old = (n) => gone(n) || !!RENAMED_SERVICES[n];
  const rename = (n) => RENAMED_SERVICES[n] || n;
  for (const p of once ? await Provider.find().select('servicesOffered services').lean() : []) {
    const set = {};
    if ((p.servicesOffered || []).some(old)) set.servicesOffered = [...new Set(p.servicesOffered.filter((n) => !gone(n)).map(rename))];
    if ((p.services || []).some((x) => old(x?.name))) set.services = p.services.filter((x) => !gone(x?.name)).map((x) => ({ ...x, name: rename(x.name) }));
    if (Object.keys(set).length) await Provider.updateOne({ _id: p._id }, { $set: set });
  }

  // 4. visit types allowed per profession
  let fixed = 0;
  for (const [profession, allowed] of Object.entries(PROFESSION_VISIT_TYPES)) {
    for (const p of await Provider.find({ profession })) {
      const ct = p.consultTypes || {};
      if (!TYPES.some((t) => typeof ct[t] === 'boolean')) continue; // older profile: limited when read
      if (!TYPES.some((t) => ct[t] && !allowed.includes(t))) continue;
      const next = Object.fromEntries(TYPES.map((t) => [t, !!ct[t] && allowed.includes(t)]));
      if (!TYPES.some((t) => next[t])) next[allowed.includes('online') ? 'online' : allowed[0]] = true;
      await Provider.updateOne({ _id: p._id }, { $set: { consultTypes: next } });
      fixed += 1;
    }
  }
  if (fixed) done.push(`visit types limited for ${fixed} professional(s)`);

  // 5. website text saved in the database
  const jobs = await SiteContent.findOne({ key: 'jobs' });
  if (jobs && jobs.items.some((j) => j?.category === 'BHS' || j?.category === 'Doctor Visit')) {
    jobs.items = jobs.items.filter((j) => j?.category !== 'BHS').map((j) => (j?.category === 'Doctor Visit' ? { ...j, category: 'General Medicine', title: j.title === 'Doctor Visit Specialist' ? 'General Medicine Doctor' : j.title } : j));
    jobs.markModified('items'); await jobs.save();
  }
  const faqs = await SiteContent.findOne({ key: 'faqs' });
  const oldFaq = 'baby care, Ayurveda and basic health services (BHS) such as vitals checks and sample collection.';
  if (faqs && faqs.items.some((f) => String(f?.a || '').includes(oldFaq))) {
    faqs.items = faqs.items.map((f) => (String(f?.a || '').includes(oldFaq) ? { ...f, a: f.a.replace(oldFaq, 'baby care, Ayurveda, Homeopathy and lab tests with home sample collection.') } : f));
    faqs.markModified('items'); await faqs.save();
  }

  if (once) await Counter.updateOne({ _id: 'migration:services-2026-11' }, { $set: { seq: 1 } }, { upsert: true });
  if (done.length) console.log(`[services] ${done.join('; ')}`);
}
