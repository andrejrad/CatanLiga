/**
 * Normalize staging registrations so each tournament has exactly 50 records.
 *
 * Steps:
 * 1) Delete all documents from registrations collection in staging.
 * 2) Insert 50 random registrations for each tournament in adminTournaments.
 *
 * Usage: node scripts/normalize-staging-registrations.js
 */

'use strict';

const admin = require('../functions/node_modules/firebase-admin');

const STAGING_PROJECT = 'catan-liga-staging';
const REGISTRATIONS_PER_TOURNAMENT = 50;
const DELETE_BATCH_SIZE = 400;
const WRITE_BATCH_SIZE = 400;

const FIRST_NAMES = [
  'Ivan', 'Marko', 'Luka', 'Petar', 'Ana', 'Mia', 'Sara', 'Ema', 'Iva', 'Klara',
  'Nikola', 'Matej', 'Filip', 'Josip', 'Karlo', 'Toni', 'Lea', 'Nika', 'Marin', 'Tea'
];

const LAST_NAMES = [
  'Horvat', 'Kovacic', 'Babic', 'Novak', 'Maric', 'Jurisic', 'Peric', 'Pavic', 'Knez', 'Grgic',
  'Brkic', 'Mikic', 'Milic', 'Varga', 'Katic', 'Brajkovic', 'Santic', 'Tomic', 'Bosnjak', 'Rukavina'
];

function randFrom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function makeTournamentLabel(tournamentData) {
  const round = tournamentData.round || '?';
  const date = tournamentData.date || '';
  const time = tournamentData.time || '';
  const venueName = tournamentData.venueName || '';
  return `Kolo ${round} - ${date} ${time} - ${venueName}`.trim();
}

function makeEmail(firstName, lastName, tournamentId, idx) {
  const cleanFirst = String(firstName).toLowerCase();
  const cleanLast = String(lastName).toLowerCase();
  const suffix = `${Date.now()}${Math.floor(Math.random() * 100000)}${idx}`;
  return `${cleanFirst}.${cleanLast}.${tournamentId}.${suffix}@staging.test`;
}

async function deleteAllRegistrations(db) {
  let totalDeleted = 0;

  while (true) {
    const snap = await db.collection('registrations').limit(DELETE_BATCH_SIZE).get();
    if (snap.empty) {
      break;
    }

    const batch = db.batch();
    snap.docs.forEach((doc) => {
      batch.delete(doc.ref);
    });
    await batch.commit();

    totalDeleted += snap.size;
    console.log(`Obrisano registracija: ${totalDeleted}`);
  }

  return totalDeleted;
}

async function seedRegistrations(db) {
  const tournamentsSnap = await db.collection('adminTournaments').get();
  if (tournamentsSnap.empty) {
    throw new Error('Nema turnira u staging adminTournaments.');
  }

  let totalInserted = 0;

  for (const tournamentDoc of tournamentsSnap.docs) {
    const tournamentId = tournamentDoc.id;
    const tournamentData = tournamentDoc.data() || {};
    const tournamentLabel = makeTournamentLabel(tournamentData);

    let batch = db.batch();
    let inBatch = 0;

    for (let i = 0; i < REGISTRATIONS_PER_TOURNAMENT; i += 1) {
      const firstName = randFrom(FIRST_NAMES);
      const lastName = randFrom(LAST_NAMES);
      const email = makeEmail(firstName, lastName, tournamentId, i);
      const note = Math.random() < 0.3 ? 'Staging test prijava' : '';

      const ref = db.collection('registrations').doc();
      batch.set(ref, {
        firstName,
        lastName,
        email,
        tournamentId,
        tournamentLabel,
        note,
        consentAccepted: true,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      inBatch += 1;
      totalInserted += 1;

      if (inBatch === WRITE_BATCH_SIZE) {
        await batch.commit();
        batch = db.batch();
        inBatch = 0;
      }
    }

    if (inBatch > 0) {
      await batch.commit();
    }

    const countSnap = await db.collection('registrations').where('tournamentId', '==', tournamentId).get();
    console.log(`Turnir ${tournamentId}: ${countSnap.size} registracija`);
  }

  return totalInserted;
}

async function main() {
  const app = admin.initializeApp(
    {
      credential: admin.credential.applicationDefault(),
      projectId: STAGING_PROJECT,
    },
    'staging-normalize-registrations'
  );

  const db = admin.firestore(app);

  console.log('Brisem postojecu registrations kolekciju u stagingu...');
  const deleted = await deleteAllRegistrations(db);
  console.log(`Ukupno obrisano: ${deleted}`);

  console.log('Upisujem tocno 50 registracija po turniru...');
  const inserted = await seedRegistrations(db);
  console.log(`Ukupno umetnuto: ${inserted}`);

  console.log('Normalizacija gotova.');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Greska tijekom normalizacije:', error);
    process.exit(1);
  });
