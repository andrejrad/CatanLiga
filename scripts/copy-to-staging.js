/**
 * Copies selected Firestore collections from production to staging.
 * Skips: adminSettings, adminRoundScores, adminTableAssignments, registrations
 *
 * Usage: node scripts/copy-to-staging.js
 * Requires: firebase CLI logged in with sufficient permissions on both projects.
 */

'use strict';

const admin = require('../functions/node_modules/firebase-admin');

const COLLECTIONS_TO_COPY = [
  'adminTournaments',
  'adminPartners',
  'adminGalleryImages',
  'adminScoreRules',
  'adminScoreConfig',
  'adminAwards',
];

const PRODUCTION_PROJECT = 'catan-liga';
const STAGING_PROJECT = 'catan-liga-staging';

const prodApp = admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  projectId: PRODUCTION_PROJECT,
}, 'production');

const stagingApp = admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  projectId: STAGING_PROJECT,
}, 'staging');

const prodDb = admin.firestore(prodApp);
const stagingDb = admin.firestore(stagingApp);

async function copyCollection(collectionName) {
  console.log(`\nKopiram kolekciju: ${collectionName}`);
  const snapshot = await prodDb.collection(collectionName).get();

  if (snapshot.empty) {
    console.log(`  -> Prazna kolekcija, preskačem.`);
    return;
  }

  const BATCH_SIZE = 400;
  let batch = stagingDb.batch();
  let count = 0;
  let total = 0;

  for (const doc of snapshot.docs) {
    const ref = stagingDb.collection(collectionName).doc(doc.id);
    batch.set(ref, doc.data());
    count++;
    total++;

    if (count === BATCH_SIZE) {
      await batch.commit();
      console.log(`  -> Commit ${total} dokumenata...`);
      batch = stagingDb.batch();
      count = 0;
    }
  }

  if (count > 0) {
    await batch.commit();
  }

  console.log(`  -> Kopirano ${total} dokumenata.`);
}

async function main() {
  console.log('=== Kopiranje produkcijskih podataka na staging ===');
  console.log(`Izvor: ${PRODUCTION_PROJECT}`);
  console.log(`Odredište: ${STAGING_PROJECT}`);
  console.log(`Kolekcije: ${COLLECTIONS_TO_COPY.join(', ')}`);

  for (const col of COLLECTIONS_TO_COPY) {
    await copyCollection(col);
  }

  console.log('\n=== Gotovo! ===');
  process.exit(0);
}

main().catch(err => {
  console.error('Greška:', err);
  process.exit(1);
});
