(function () {
  var FIREBASE_WAIT_TRIES = 80;
  var FIREBASE_WAIT_MS = 125;

  var listEl = document.getElementById('publicAwardsList');

  var db = null;
  var awardsCollection = null;

  if (!listEl) {
    return;
  }

  function normalizeWebUrl(value) {
    var trimmed = (value || '').trim();
    if (!trimmed) {
      return '';
    }

    if (/^https?:\/\//i.test(trimmed)) {
      return trimmed;
    }

    return 'https://' + trimmed;
  }

  function createMessage(text) {
    var p = document.createElement('p');
    p.className = 'admin-note';
    p.textContent = text;
    return p;
  }

  function renderAwards(snapshot) {
    var items = [];
    snapshot.forEach(function (doc) {
      var data = doc.data();
      data.id = doc.id;
      items.push(data);
    });

    items.sort(function (a, b) {
      var orderA = Number(a.sortOrder) || 0;
      var orderB = Number(b.sortOrder) || 0;
      return orderA - orderB;
    });

    listEl.innerHTML = '';

    if (!items.length) {
      listEl.appendChild(createMessage('Nagrade ce biti uskoro dostupne.'));
      return;
    }

    items.forEach(function (item) {
      var card = document.createElement('article');
      card.className = 'award-card';

      var image = document.createElement('img');
      image.src = item.imageUrl || '';
      image.alt = 'Nagrada za mjesto ' + String(item.place || '');

      var body = document.createElement('div');

      var title = document.createElement('h3');
      title.textContent = String(item.place || '');

      var description = document.createElement('p');
      description.className = 'partner-meta';
      description.textContent = item.description || '';

      var sponsor = document.createElement('p');
      sponsor.className = 'partner-meta';
      sponsor.textContent = 'Sponsor: ' + (item.sponsor || '');

      var sponsorWeb = document.createElement('p');
      sponsorWeb.className = 'partner-meta';
      sponsorWeb.textContent = 'Web: ';

      var webLink = document.createElement('a');
      webLink.className = 'contact-link';
      webLink.href = normalizeWebUrl(item.sponsorWeb || '');
      webLink.target = '_blank';
      webLink.rel = 'noopener';
      webLink.textContent = item.sponsorWeb || '';
      sponsorWeb.appendChild(webLink);

      body.appendChild(title);
      body.appendChild(description);
      body.appendChild(sponsor);
      body.appendChild(sponsorWeb);

      card.appendChild(image);
      card.appendChild(body);
      listEl.appendChild(card);
    });
  }

  function initFirebaseConnections() {
    if (!window.firebase || !firebase.apps || !firebase.apps.length) {
      return false;
    }

    db = firebase.firestore();
    awardsCollection = db.collection('adminAwards');
    return true;
  }

  function waitForFirebaseAndSubscribe() {
    var tries = 0;

    var timer = setInterval(function () {
      tries += 1;

      if (initFirebaseConnections()) {
        clearInterval(timer);

        awardsCollection.onSnapshot(renderAwards, function () {
          listEl.innerHTML = '';
          listEl.appendChild(createMessage('Ne mogu ucitati nagrade.'));
        });

        return;
      }

      if (tries >= FIREBASE_WAIT_TRIES) {
        clearInterval(timer);
        listEl.innerHTML = '';
        listEl.appendChild(createMessage('Firebase se nije ucitao. Pokusaj osvjeziti stranicu.'));
      }
    }, FIREBASE_WAIT_MS);
  }

  waitForFirebaseAndSubscribe();
})();
