#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';

function usage() {
  console.log('Usage: node scripts/fetch_snapshot.mjs [--post|--get] --token <SNAPSHOT_TOKEN> [--weekId YYYY-MM-DD] [--site <url>]');
  process.exit(1);
}

const argv = process.argv.slice(2);
let mode = 'post';
let token = process.env.SNAPSHOT_TOKEN || null;
let weekId = null;
let site = process.env.SITE_URL || 'https://iryspredict.xyz';

for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--post') { mode = 'post'; continue; }
  if (a === '--get') { mode = 'get'; continue; }
  if (a === '--token' && argv[i+1]) { token = argv[++i]; continue; }
  if (a === '--weekId' && argv[i+1]) { weekId = argv[++i]; continue; }
  if (a === '--site' && argv[i+1]) { site = argv[++i]; continue; }
  if (a === '-h' || a === '--help') usage();
}

if (!token) {
  console.error('Missing SNAPSHOT_TOKEN: pass --token or set SNAPSHOT_TOKEN env var');
  process.exit(2);
}

async function callApi() {
  try {
    const base = site.replace(/\/+$/,'');
    if (mode === 'post') {
      const res = await fetch(`${base}/api/snapshot_week`, { method: 'POST', headers: { 'x-snapshot-token': token } });
      if (!res.ok) {
        const text = await res.text().catch(()=>null);
        throw new Error(`POST failed ${res.status}: ${text}`);
      }
      const j = await res.json();
      const wid = j.weekId;
      if (!wid) throw new Error('No weekId in response');
      await saveSnapshot(wid, j);
      console.log(`Saved snapshot ${wid}`);
      return;
    }

    // GET mode
    if (!weekId) {
      console.error('GET mode requires --weekId YYYY-MM-DD');
      process.exit(3);
    }
    const res = await fetch(`${base}/api/snapshot_week?weekId=${encodeURIComponent(weekId)}`, { headers: { 'x-snapshot-token': token } });
    if (!res.ok) {
      const text = await res.text().catch(()=>null);
      throw new Error(`GET failed ${res.status}: ${text}`);
    }
    const j = await res.json();
    await saveSnapshot(weekId, j.snapshot ? j.snapshot : j);
    console.log(`Saved snapshot ${weekId}`);
  } catch (err) {
    console.error('Error:', err?.message || String(err));
    process.exit(4);
  }
}

async function saveSnapshot(wid, payload) {
  const dir = path.join(process.cwd(), 'snapshots');
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${wid}.json`);
  await fs.writeFile(file, JSON.stringify(payload, null, 2), 'utf8');
}

callApi();
