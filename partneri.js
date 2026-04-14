(function () {
  var FIREBASE_WAIT_TRIES = 80;
  var FIREBASE_WAIT_MS = 125;

  var listEl = document.getElementById('publicPartnersList');
  var db = null;
  var partnersCollection = null;

  if (!listEl) {
    return;
  }

  function createMessage(text) {
    var p = document.createElement('p');
    p.className = 'admin-note';
    p.textContent = text;
    return p;
  }

  function normalizeWebUrl(value) {
    var raw = (value || '').trim();
    if (!raw) {
      return '';
    }

    if (/^https?:\/\//i.test(raw)) {
      return raw;
    }

    return 'https://' + raw;
  }

  function renderPartnerCard(data) {
    var card = document.createElement('article');
    card.className = 'public-partner-card';

    var body = document.createElement('div');

    var logoWrap = document.createElement('div');
    logoWrap.className = 'public-partner-logo-wrap';

    var logo = document.createElement('img');
    logo.alt = (data.name || 'Partner') + ' logo';
    logo.src = data.logoUrl || '';
    logoWrap.appendChild(logo);

    var titleRow = document.createElement('div');
    titleRow.className = 'public-partner-title-row';

    var name = document.createElement('h3');
    name.className = 'public-partner-name';
    name.textContent = data.name || '';

    var types = document.createElement('p');
    types.className = 'public-partner-types';
    types.textContent = (data.types || []).join(', ');

    var description = document.createElement('p');
    description.className = 'public-partner-description';
    description.textContent = data.description || '';

    var webLink = null;
    if (data.web) {
      webLink = document.createElement('a');
      webLink.className = 'public-partner-web';
      webLink.href = normalizeWebUrl(data.web) || '#';
      webLink.target = '_blank';
      webLink.rel = 'noopener';
      webLink.textContent = data.web || '';
    }

    titleRow.appendChild(name);

    body.appendChild(titleRow);
    body.appendChild(logoWrap);
    body.appendChild(types);
    body.appendChild(description);
    if (webLink) {
      body.appendChild(webLink);
    }

    card.appendChild(body);
    return card;
  }

  function renderPartners(snapshot) {
    var partners = [];
    snapshot.forEach(function (doc) {
      var data = doc.data();
      if (data.active === false) {
        return;
      }
      partners.push(data);
    });

    partners.sort(function (a, b) {
      return (a.name || '').localeCompare((b.name || ''), 'hr', { sensitivity: 'base' });
    });

    listEl.innerHTML = '';

    if (partners.length === 0) {
      listEl.appendChild(createMessage('Trenutno nema dostupnih partnera.'));
      return;
    }

    partners.forEach(function (partner) {
      listEl.appendChild(renderPartnerCard(partner));
    });
  }

  function initFirebaseConnections() {
    if (!window.firebase || !firebase.apps || !firebase.apps.length) {
      return false;
    }

    db = firebase.firestore();
    partnersCollection = db.collection('adminPartners');
    return true;
  }

  function waitForFirebaseAndSubscribe() {
    var tries = 0;

    var timer = setInterval(function () {
      tries += 1;

      if (initFirebaseConnections()) {
        clearInterval(timer);
        partnersCollection.onSnapshot(renderPartners, function () {
          listEl.innerHTML = '';
          listEl.appendChild(createMessage('Ne mogu učitati partnere. Pokušaj ponovno kasnije.'));
        });
        return;
      }

      if (tries >= FIREBASE_WAIT_TRIES) {
        clearInterval(timer);
        listEl.innerHTML = '';
        listEl.appendChild(createMessage('Firebase se nije učitao.'));
      }
    }, FIREBASE_WAIT_MS);
  }

  waitForFirebaseAndSubscribe();
})();
