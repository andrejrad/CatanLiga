(function () {
  var FIREBASE_WAIT_TRIES = 80;
  var FIREBASE_WAIT_MS = 125;

  var wrapEl = document.getElementById('partnerDetailWrap');
  if (!wrapEl) {
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

  function getPartnerIdFromUrl() {
    var params = new URLSearchParams(window.location.search || '');
    return (params.get('id') || '').trim();
  }

  function renderPartner(data) {
    wrapEl.innerHTML = '';

    var card = document.createElement('article');
    card.className = 'partner-detail-card';

    var logoWrap = document.createElement('div');
    logoWrap.className = 'partner-detail-logo-wrap';

    var logo = document.createElement('img');
    logo.className = 'partner-detail-logo';
    logo.src = data.logoUrl || '';
    logo.alt = (data.name || 'Partner') + ' logo';
    logoWrap.appendChild(logo);

    var name = document.createElement('h2');
    name.className = 'partner-detail-title';
    name.textContent = data.name || 'Partner';

    var types = document.createElement('p');
    types.className = 'partner-detail-meta';
    types.textContent = (data.types || []).join(', ');

    var description = document.createElement('p');
    description.className = 'partner-detail-description';
    description.textContent = data.description || '';

    card.appendChild(logoWrap);
    card.appendChild(name);
    card.appendChild(types);
    card.appendChild(description);

    if (data.contact) {
      var contact = document.createElement('p');
      contact.className = 'partner-detail-meta';
      contact.textContent = 'Kontakt: ' + data.contact;
      card.appendChild(contact);
    }

    if (data.web) {
      var web = document.createElement('a');
      web.className = 'partner-detail-link';
      web.href = normalizeWebUrl(data.web) || '#';
      web.target = '_blank';
      web.rel = 'noopener';
      web.textContent = data.web;
      card.appendChild(web);
    }

    wrapEl.appendChild(card);
  }

  function loadPartner() {
    var partnerId = getPartnerIdFromUrl();
    if (!partnerId) {
      wrapEl.innerHTML = '';
      wrapEl.appendChild(createMessage('Nedostaje ID partnera.'));
      return;
    }

    var db = firebase.firestore();
    db.collection('adminPartners').doc(partnerId).get().then(function (doc) {
      if (!doc.exists) {
        wrapEl.innerHTML = '';
        wrapEl.appendChild(createMessage('Partner nije pronađen.'));
        return;
      }

      var data = doc.data();
      if (data.active === false) {
        wrapEl.innerHTML = '';
        wrapEl.appendChild(createMessage('Partner trenutno nije javno dostupan.'));
        return;
      }

      renderPartner(data);
    }).catch(function () {
      wrapEl.innerHTML = '';
      wrapEl.appendChild(createMessage('Ne mogu učitati detalje partnera.'));
    });
  }

  function waitForFirebaseAndLoad() {
    var tries = 0;

    var timer = setInterval(function () {
      tries += 1;

      if (window.firebase && firebase.apps && firebase.apps.length) {
        clearInterval(timer);
        loadPartner();
        return;
      }

      if (tries >= FIREBASE_WAIT_TRIES) {
        clearInterval(timer);
        wrapEl.innerHTML = '';
        wrapEl.appendChild(createMessage('Firebase se nije učitao.'));
      }
    }, FIREBASE_WAIT_MS);
  }

  waitForFirebaseAndLoad();
})();
