'use strict';

const admin = require('../functions/node_modules/firebase-admin');

const STAGING_PROJECT = 'catan-liga-staging';

async function main() {
  const app = admin.initializeApp(
    {
      credential: admin.credential.applicationDefault(),
      projectId: STAGING_PROJECT,
    },
    'staging-list-multi-users'
  );

  const db = admin.firestore(app);
  const regsSnap = await db.collection('registrations').get();

  const byEmail = new Map();

  regsSnap.forEach((doc) => {
    const data = doc.data() || {};
    const email = String(data.email || '').trim().toLowerCase();
    if (!email) {
      return;
    }

    if (!byEmail.has(email)) {
      byEmail.set(email, {
        firstName: data.firstName || '',
        lastName: data.lastName || '',
        email,
        notes: new Set(),
        tournaments: new Set(),
      });
    }

    const item = byEmail.get(email);
    item.firstName = item.firstName || data.firstName || '';
    item.lastName = item.lastName || data.lastName || '';

    if (data.note) {
      item.notes.add(String(data.note));
    }
    if (data.tournamentId) {
      item.tournaments.add(String(data.tournamentId));
    }
  });

  const duplicated = Array.from(byEmail.values())
    .filter((u) => u.tournaments.size >= 2)
    .map((u) => ({
      firstName: u.firstName,
      lastName: u.lastName,
      email: u.email,
      tournamentCount: u.tournaments.size,
      tournaments: Array.from(u.tournaments),
      notes: Array.from(u.notes),
    }))
    .sort((a, b) => a.email.localeCompare(b.email));

  const seeded = duplicated.filter((u) =>
    u.notes.some((n) => n.indexOf('Staging test - isti korisnik') !== -1)
  );

  const in2 = seeded.filter((u) => u.tournamentCount === 2);
  const in3 = seeded.filter((u) => u.tournamentCount === 3);

  console.log(JSON.stringify({
    totalDuplicatedUsers: duplicated.length,
    seededDuplicateUsers: seeded.length,
    seededIn2Tournaments: in2.length,
    seededIn3Tournaments: in3.length,
    seededUsers: seeded,
  }, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
