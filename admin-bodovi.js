(function () {
  var FIREBASE_WAIT_TRIES = 80;
  var FIREBASE_WAIT_MS = 125;

  var ruleForm = document.getElementById('scoreRuleForm');
  var placeInput = document.getElementById('scoreRulePlace');
  var pointsInput = document.getElementById('scoreRulePoints');
  var ruleSubmitBtn = document.getElementById('scoreRuleSubmitBtn');
  var ruleStatusEl = document.getElementById('scoreRulesStatus');
  var ruleListEl = document.getElementById('scoreRulesList');

  var coefForm = document.getElementById('scoreCoefForm');
  var coefInput = document.getElementById('scoreGameCoefficient');
  var coefSubmitBtn = document.getElementById('scoreCoefSubmitBtn');
  var coefStatusEl = document.getElementById('scoreCoefStatus');

  if (!ruleForm || !placeInput || !pointsInput || !ruleSubmitBtn || !ruleStatusEl || !ruleListEl || !coefForm || !coefInput || !coefSubmitBtn || !coefStatusEl) {
    return;
  }

  var db = null;
  var scoreRulesCollection = null;
  var scoreConfigCollection = null;
  var allRules = [];

  function normalize(value) {
    return (value || '').trim();
  }

  function setRuleStatus(message, isError) {
    ruleStatusEl.textContent = message;
    ruleStatusEl.style.color = isError ? '#ffb6a6' : '#ffe680';
  }

  function setCoefStatus(message, isError) {
    coefStatusEl.textContent = message;
    coefStatusEl.style.color = isError ? '#ffb6a6' : '#ffe680';
  }

  function createMessage(text) {
    var p = document.createElement('p');
    p.className = 'admin-note';
    p.textContent = text;
    return p;
  }

  function setRuleSubmitting(isSubmitting) {
    ruleSubmitBtn.disabled = isSubmitting;
    ruleSubmitBtn.style.opacity = isSubmitting ? '0.7' : '1';
    ruleSubmitBtn.style.cursor = isSubmitting ? 'not-allowed' : 'pointer';
  }

  function setCoefSubmitting(isSubmitting) {
    coefSubmitBtn.disabled = isSubmitting;
    coefSubmitBtn.style.opacity = isSubmitting ? '0.7' : '1';
    coefSubmitBtn.style.cursor = isSubmitting ? 'not-allowed' : 'pointer';
  }

  function renderRules() {
    ruleListEl.innerHTML = '';

    if (!allRules.length) {
      ruleListEl.appendChild(createMessage('Još nema upisanih pravila.'));
      return;
    }

    var sorted = allRules.slice().sort(function (a, b) {
      return (a.place || 0) - (b.place || 0);
    });

    var wrap = document.createElement('div');
    wrap.className = 'tournament-table-wrap';

    var table = document.createElement('table');
    table.className = 'tournament-table';

    var thead = document.createElement('thead');
    var headRow = document.createElement('tr');
    ['Mjesto', 'Bodovi', ''].forEach(function (label, index) {
      var th = document.createElement('th');
      th.textContent = label;
      if (index === 2) {
        th.className = 'tournament-action-head';
        th.setAttribute('aria-label', 'Brisanje');
      }
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);

    var tbody = document.createElement('tbody');

    sorted.forEach(function (item) {
      var row = document.createElement('tr');

      var placeTd = document.createElement('td');
      placeTd.textContent = String(item.place || '');

      var pointsTd = document.createElement('td');
      pointsTd.textContent = String(item.points || 0);

      var deleteTd = document.createElement('td');
      deleteTd.className = 'tournament-action-cell';

      var deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'partner-action-btn partner-action-btn-danger tournament-icon-btn';
      deleteButton.textContent = '✕';
      deleteButton.title = 'Obriši';
      deleteButton.setAttribute('aria-label', 'Obriši pravilo');
      deleteButton.addEventListener('click', async function () {
        var confirmed = window.confirm('Obrisati pravilo za mjesto ' + item.place + '?');
        if (!confirmed) {
          return;
        }

        try {
          await scoreRulesCollection.doc(item.id).delete();
          setRuleStatus('Pravilo je obrisano.', false);
        } catch (error) {
          console.error(error);
          setRuleStatus('Brisanje pravila nije uspjelo.', true);
        }
      });

      deleteTd.appendChild(deleteButton);

      row.appendChild(placeTd);
      row.appendChild(pointsTd);
      row.appendChild(deleteTd);
      tbody.appendChild(row);
    });

    table.appendChild(thead);
    table.appendChild(tbody);
    wrap.appendChild(table);
    ruleListEl.appendChild(wrap);
  }

  function initFirebaseConnections() {
    if (!window.firebase || !firebase.apps || !firebase.apps.length) {
      return false;
    }

    db = firebase.firestore();
    scoreRulesCollection = db.collection('adminScoreRules');
    scoreConfigCollection = db.collection('adminScoreConfig');
    return true;
  }

  function subscribeRules() {
    scoreRulesCollection.onSnapshot(function (snapshot) {
      allRules = snapshot.docs.map(function (doc) {
        var data = doc.data();
        data.id = doc.id;
        return data;
      });

      renderRules();
    }, function (error) {
      console.error(error);
      ruleListEl.innerHTML = '';
      ruleListEl.appendChild(createMessage('Ne mogu učitati pravila bodovanja.'));
      setRuleStatus('Dohvat pravila nije uspio.', true);
    });
  }

  function subscribeCoefficient() {
    scoreConfigCollection.doc('global').onSnapshot(function (doc) {
      var data = doc.exists ? doc.data() : null;
      var coefficient = data && typeof data.gamePointsCoefficient === 'number' ? data.gamePointsCoefficient : 0.5;
      coefInput.value = String(coefficient);
      setCoefStatus('', false);
    }, function (error) {
      console.error(error);
      setCoefStatus('Dohvat koeficijenta nije uspio.', true);
    });
  }

  function waitForFirebaseAndSubscribe() {
    var tries = 0;

    var timer = setInterval(function () {
      tries += 1;

      if (initFirebaseConnections()) {
        clearInterval(timer);
        subscribeRules();
        subscribeCoefficient();
        return;
      }

      if (tries >= FIREBASE_WAIT_TRIES) {
        clearInterval(timer);
        setRuleStatus('Firebase se nije učitao. Osvježi stranicu.', true);
        setCoefStatus('Firebase se nije učitao. Osvježi stranicu.', true);
      }
    }, FIREBASE_WAIT_MS);
  }

  ruleForm.addEventListener('submit', async function (event) {
    event.preventDefault();

    var place = Number(normalize(placeInput.value));
    var points = Number(normalize(pointsInput.value));

    if (!scoreRulesCollection) {
      setRuleStatus('Firebase nije spreman. Pokušaj ponovno.', true);
      return;
    }

    if (!Number.isInteger(place) || place <= 0) {
      setRuleStatus('Mjesto mora biti cijeli broj veći od 0.', true);
      return;
    }

    if (!Number.isInteger(points) || points < 0) {
      setRuleStatus('Bodovi moraju biti cijeli broj veći ili jednak 0.', true);
      return;
    }

    setRuleSubmitting(true);
    setRuleStatus('Provjera postojećeg mjesta...', false);

    try {
      var existing = await scoreRulesCollection.where('place', '==', place).get();
      if (!existing.empty) {
        setRuleStatus('Pravilo za to mjesto već postoji.', true);
        setRuleSubmitting(false);
        return;
      }

      await scoreRulesCollection.add({
        place: place,
        points: points,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });

      ruleForm.reset();
      setRuleStatus('Pravilo je uspješno dodano.', false);
    } catch (error) {
      console.error(error);
      setRuleStatus('Spremanje pravila nije uspjelo.', true);
    } finally {
      setRuleSubmitting(false);
    }
  });

  coefForm.addEventListener('submit', async function (event) {
    event.preventDefault();

    var coefficient = Number(normalize(coefInput.value));

    if (!scoreConfigCollection) {
      setCoefStatus('Firebase nije spreman. Pokušaj ponovno.', true);
      return;
    }

    if (isNaN(coefficient) || coefficient < 0 || coefficient > 10) {
      setCoefStatus('Koeficijent mora biti broj između 0 i 10.', true);
      return;
    }

    setCoefSubmitting(true);
    setCoefStatus('Spremanje koeficijenta...', false);

    try {
      await scoreConfigCollection.doc('global').set({
        gamePointsCoefficient: coefficient,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      setCoefStatus('Koeficijent je uspješno spremljen.', false);
    } catch (error) {
      console.error(error);
      setCoefStatus('Spremanje koeficijenta nije uspjelo.', true);
    } finally {
      setCoefSubmitting(false);
    }
  });

  waitForFirebaseAndSubscribe();
})();
