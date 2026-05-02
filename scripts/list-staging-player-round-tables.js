'use strict';

const fs = require('fs');
const path = require('path');
const admin = require('../functions/node_modules/firebase-admin');

const STAGING_PROJECT = 'catan-liga-staging';
const OUT_MD = path.join(__dirname, 'staging-player-round-tables.md');

function addRoundEntry(player, round, entry) {
  if (!player.rounds[round]) {
    player.rounds[round] = [];
  }
  if (player.rounds[round].indexOf(entry) === -1) {
    player.rounds[round].push(entry);
  }
}

function formatRound(values) {
  if (!values || !values.length) {
    return '-';
  }
  return values.sort().join(', ');
}

async function main() {
  const app = admin.initializeApp(
    {
      credential: admin.credential.applicationDefault(),
      projectId: STAGING_PROJECT,
    },
    'staging-player-round-table-list'
  );

  const db = admin.firestore(app);

  const [regsSnap, assignmentsSnap] = await Promise.all([
    db.collection('registrations').get(),
    db.collection('adminTableAssignments').get(),
  ]);

  const regById = new Map();
  regsSnap.forEach((doc) => {
    regById.set(doc.id, { id: doc.id, ...(doc.data() || {}) });
  });

  const playersByEmail = new Map();

  assignmentsSnap.forEach((doc) => {
    const data = doc.data() || {};
    const regId = data.registrationId;
    const round = Number(data.round || 0);
    const tableNumber = Number(data.tableNumber || 0);

    if (!regId || !round || !tableNumber) {
      return;
    }

    const reg = regById.get(regId);
    if (!reg) {
      return;
    }

    const email = String(reg.email || '').trim().toLowerCase();
    if (!email) {
      return;
    }

    if (!playersByEmail.has(email)) {
      playersByEmail.set(email, {
        name: `${reg.firstName || ''} ${reg.lastName || ''}`.trim(),
        email,
        rounds: { 1: [], 2: [], 3: [] },
      });
    }

    const player = playersByEmail.get(email);
    if (!player.name) {
      player.name = `${reg.firstName || ''} ${reg.lastName || ''}`.trim();
    }

    const label = `T${tableNumber}`;
    addRoundEntry(player, round, label);
  });

  const rows = Array.from(playersByEmail.values())
    .sort((a, b) => a.name.localeCompare(b.name, 'hr', { sensitivity: 'base' }));

  const header = [
    '| Igrac | Runda 1 | Runda 2 | Runda 3 |',
    '|---|---|---|---|',
  ];

  const lines = rows.map((p) => {
    return `| ${p.name} | ${formatRound(p.rounds[1])} | ${formatRound(p.rounds[2])} | ${formatRound(p.rounds[3])} |`;
  });

  const md = header.concat(lines).join('\n') + '\n';
  fs.writeFileSync(OUT_MD, md, 'utf8');

  console.log(`Ukupno igraca: ${rows.length}`);
  console.log(`Datoteka: ${OUT_MD}`);
  console.log('---BEGIN_TABLE---');
  console.log(md);
  console.log('---END_TABLE---');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
