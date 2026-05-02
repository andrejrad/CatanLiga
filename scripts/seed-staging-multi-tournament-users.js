/**
 * Adds multi-tournament users to staging registrations:
 * - 10 users that appear in exactly 2 tournaments
 * - 10 users that appear in all 3 tournaments
 *
 * Usage: node scripts/seed-staging-multi-tournament-users.js
 */

'use strict';

const admin = require('../functions/node_modules/firebase-admin');

const STAGING_PROJECT = 'catan-liga-staging';
const TWO_TOURNAMENT_USERS = 10;
const THREE_TOURNAMENT_USERS = 10;

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

function shuffle(arr) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

function makeTournamentLabel(tournamentData) {
  const round = tournamentData.round || '?';
  const date = tournamentData.date || '';
  const time = tournamentData.time || '';
  const venueName = tournamentData.venueName || '';
  return `Kolo ${round} - ${date} ${time} - ${venueName}`.trim();
}

function createUser(index, groupTag) {
  const firstName = randFrom(FIRST_NAMES);
  const lastName = randFrom(LAST_NAMES);
  const suffix = `${Date.now()}${Math.floor(Math.random() * 100000)}${index}`;
  const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}.${groupTag}.${suffix}@staging.test`;
  return { firstName, lastName, email };
}

async function insertRegistration(db, tournament, user, note) {
  const ref = db.collection('registrations').doc();
  await ref.set({
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    tournamentId: tournament.id,
    tournamentLabel: tournament.label,
    note,
    consentAccepted: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

async function main() {
  const app = admin.initializeApp(
    {
      credential: admin.credential.applicationDefault(),
      projectId: STAGING_PROJECT,
    },
    'staging-multi-tournament-seed'
  );

  const db = admin.firestore(app);

  const tournamentsSnap = await db.collection('adminTournaments').get();
  if (tournamentsSnap.size < 3) {
    throw new Error('Potrebna su barem 3 turnira u staging adminTournaments.');
  }

  const tournaments = tournamentsSnap.docs.slice(0, 3).map((doc) => {
    const data = doc.data() || {};
    return {
      id: doc.id,
      label: makeTournamentLabel(data),
    };
  });

  const pairs = [
    [0, 1],
    [0, 2],
    [1, 2],
  ];

  let insertedTwoTournament = 0;
  let insertedThreeTournament = 0;

  for (let i = 0; i < TWO_TOURNAMENT_USERS; i += 1) {
    const user = createUser(i, 'pair');
    const pair = randFrom(pairs);

    await insertRegistration(db, tournaments[pair[0]], user, 'Staging test - isti korisnik u 2 turnira');
    await insertRegistration(db, tournaments[pair[1]], user, 'Staging test - isti korisnik u 2 turnira');

    insertedTwoTournament += 1;
  }

  for (let i = 0; i < THREE_TOURNAMENT_USERS; i += 1) {
    const user = createUser(i, 'triple');
    const order = shuffle([0, 1, 2]);

    await insertRegistration(db, tournaments[order[0]], user, 'Staging test - isti korisnik u 3 turnira');
    await insertRegistration(db, tournaments[order[1]], user, 'Staging test - isti korisnik u 3 turnira');
    await insertRegistration(db, tournaments[order[2]], user, 'Staging test - isti korisnik u 3 turnira');

    insertedThreeTournament += 1;
  }

  console.log('Dodano korisnika u 2 turnira:', insertedTwoTournament);
  console.log('Dodano korisnika u 3 turnira:', insertedThreeTournament);

  for (const t of tournaments) {
    const countSnap = await db.collection('registrations').where('tournamentId', '==', t.id).get();
    console.log(`Turnir ${t.id}: ukupno registracija ${countSnap.size}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Greška:', error);
    process.exit(1);
  });
