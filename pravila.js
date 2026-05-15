(function () {
  var FIREBASE_WAIT_TRIES = 80;
  var FIREBASE_WAIT_MS = 125;

  var listEl = document.getElementById('pravila-docs-list');
  var db = null;

  if (!listEl) {
    return;
  }

  function createMessage(text) {
    var p = document.createElement('p');
    p.className = 'admin-note';
    p.textContent = text;
    return p;
  }

  function renderDocCard(data) {
    var card = document.createElement('article');
    card.className = 'pravila-public-card';

    var icon = document.createElement('div');
    icon.className = 'pravila-public-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>';

    var body = document.createElement('div');
    body.className = 'pravila-public-body';

    var title = document.createElement('h3');
    title.className = 'pravila-public-title';
    title.textContent = data.naziv || '';

    body.appendChild(title);

    if (data.opis) {
      var opis = document.createElement('p');
      opis.className = 'pravila-public-opis';
      opis.textContent = data.opis;
      body.appendChild(opis);
    }

    var link = document.createElement('a');
    link.className = 'page-cta-btn pravila-public-btn';
    link.href = data.pdfUrl || '#';
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = 'Otvori PDF';

    card.appendChild(icon);
    card.appendChild(body);
    card.appendChild(link);

    return card;
  }

  function initFirebaseConnections() {
    if (!window.firebase || !firebase.apps || !firebase.apps.length) {
      return false;
    }

    db = firebase.firestore();
    return true;
  }

  function waitForFirebaseAndLoad() {
    var tries = 0;

    var timer = setInterval(function () {
      tries += 1;

      if (initFirebaseConnections()) {
        clearInterval(timer);
        loadDocs();
        return;
      }

      if (tries >= FIREBASE_WAIT_TRIES) {
        clearInterval(timer);
        listEl.innerHTML = '';
        listEl.appendChild(createMessage('Ne mogu učitati pravila. Pokušaj osvježiti stranicu.'));
      }
    }, FIREBASE_WAIT_MS);
  }

  async function loadDocs() {
    try {
      var snapshot = await db
        .collection('adminPravila')
        .orderBy('createdAt', 'asc')
        .get();

      listEl.innerHTML = '';

      if (snapshot.empty) {
        listEl.appendChild(createMessage('Pravila još nisu dodana.'));
        return;
      }

      snapshot.forEach(function (doc) {
        var data = doc.data();
        data.id = doc.id;
        listEl.appendChild(renderDocCard(data));
      });
    } catch (error) {
      console.error(error);
      listEl.innerHTML = '';
      listEl.appendChild(createMessage('Greška pri učitavanju pravila.'));
    }
  }

  waitForFirebaseAndLoad();
})();
