(function () {
  var FIREBASE_WAIT_TRIES = 80;
  var FIREBASE_WAIT_MS = 125;

  var listEl = document.getElementById('registrationsList');
  var statusEl = document.getElementById('registrationsStatus');
  var filterTournamentSelect = document.getElementById('registrationsFilterTournament');
  var searchInput = document.getElementById('registrationsSearch');

  var db = null;
  var registrationsCollection = null;
  var allRegistrations = [];

  if (!listEl || !statusEl || !filterTournamentSelect || !searchInput) {
    return;
  }

  function setStatus(message, isError) {
    statusEl.textContent = message;
    statusEl.style.color = isError ? '#ffb6a6' : '#ffe680';
  }

  function createMessage(text) {
    var p = document.createElement('p');
    p.className = 'admin-note';
    p.textContent = text;
    return p;
  }

  function formatDateTime(dateObj) {
    if (!dateObj || isNaN(dateObj.getTime())) {
      return '-';
    }

    var dd = String(dateObj.getDate()).padStart(2, '0');
    var mm = String(dateObj.getMonth() + 1).padStart(2, '0');
    var yyyy = String(dateObj.getFullYear());
    var hh = String(dateObj.getHours()).padStart(2, '0');
    var min = String(dateObj.getMinutes()).padStart(2, '0');

    return dd + '.' + mm + '.' + yyyy + '. ' + hh + ':' + min;
  }

  function renderFilters() {
    var selected = filterTournamentSelect.value;
    var seen = {};
    var labels = [];

    allRegistrations.forEach(function (item) {
      var label = item.tournamentLabel || 'Nepoznati turnir';
      if (!seen[label]) {
        seen[label] = true;
        labels.push(label);
      }
    });

    labels.sort(function (a, b) {
      return a.localeCompare(b, 'hr', { sensitivity: 'base' });
    });

    filterTournamentSelect.innerHTML = '';
    var defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = 'Svi turniri';
    filterTournamentSelect.appendChild(defaultOption);

    labels.forEach(function (label) {
      var option = document.createElement('option');
      option.value = label;
      option.textContent = label;
      filterTournamentSelect.appendChild(option);
    });

    filterTournamentSelect.value = seen[selected] ? selected : '';
  }

  function renderTable(items) {
    var wrap = document.createElement('div');
    wrap.className = 'tournament-table-wrap';

    var table = document.createElement('table');
    table.className = 'tournament-table';

    var thead = document.createElement('thead');
    var headRow = document.createElement('tr');
    ['Ime i prezime', 'Email', 'Turnir', 'Napomena', 'Vrijeme prijave'].forEach(function (label) {
      var th = document.createElement('th');
      th.textContent = label;
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);

    var tbody = document.createElement('tbody');
    items.forEach(function (item) {
      var row = document.createElement('tr');

      var fullNameTd = document.createElement('td');
      fullNameTd.textContent = (item.firstName || '') + ' ' + (item.lastName || '');

      var emailTd = document.createElement('td');
      emailTd.textContent = item.email || '-';

      var tournamentTd = document.createElement('td');
      tournamentTd.textContent = item.tournamentLabel || '-';

      var noteTd = document.createElement('td');
      noteTd.textContent = item.note || '-';

      var createdTd = document.createElement('td');
      createdTd.textContent = formatDateTime(item.createdAtDate);

      row.appendChild(fullNameTd);
      row.appendChild(emailTd);
      row.appendChild(tournamentTd);
      row.appendChild(noteTd);
      row.appendChild(createdTd);
      tbody.appendChild(row);
    });

    table.appendChild(thead);
    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
  }

  function applyFilters() {
    listEl.innerHTML = '';

    if (!allRegistrations.length) {
      listEl.appendChild(createMessage('Još nema prijava.'));
      return;
    }

    var selectedTournament = filterTournamentSelect.value;
    var searchText = searchInput.value.trim().toLowerCase();

    var filtered = allRegistrations.filter(function (item) {
      var fullName = ((item.firstName || '') + ' ' + (item.lastName || '')).trim().toLowerCase();
      var email = (item.email || '').toLowerCase();
      var tournamentLabel = (item.tournamentLabel || '').toLowerCase();

      var tournamentOk = !selectedTournament || (item.tournamentLabel || '') === selectedTournament;
      var searchOk = !searchText
        || fullName.indexOf(searchText) !== -1
        || email.indexOf(searchText) !== -1
        || tournamentLabel.indexOf(searchText) !== -1;

      return tournamentOk && searchOk;
    });

    if (!filtered.length) {
      listEl.appendChild(createMessage('Nema prijava za odabrani filter.'));
      return;
    }

    filtered.sort(function (a, b) {
      return (b.createdAtDate ? b.createdAtDate.getTime() : 0) - (a.createdAtDate ? a.createdAtDate.getTime() : 0);
    });

    listEl.appendChild(renderTable(filtered));
  }

  function renderSnapshot(snapshot) {
    allRegistrations = [];

    snapshot.forEach(function (doc) {
      var data = doc.data();
      var createdAtDate = null;
      if (data.createdAt && typeof data.createdAt.toDate === 'function') {
        createdAtDate = data.createdAt.toDate();
      }
      data.createdAtDate = createdAtDate;
      data.id = doc.id;
      allRegistrations.push(data);
    });

    renderFilters();
    applyFilters();
    setStatus('Ukupno prijava: ' + allRegistrations.length + '.', false);
  }

  function initFirebaseConnections() {
    if (!window.firebase || !firebase.apps || !firebase.apps.length) {
      return false;
    }

    db = firebase.firestore();
    registrationsCollection = db.collection('registrations');
    return true;
  }

  function waitForFirebaseAndSubscribe() {
    var tries = 0;

    var timer = setInterval(function () {
      tries += 1;

      if (initFirebaseConnections()) {
        clearInterval(timer);
        registrationsCollection.onSnapshot(renderSnapshot, function (error) {
          console.error(error);
          listEl.innerHTML = '';
          listEl.appendChild(createMessage('Ne mogu učitati prijave.'));
          setStatus('Dohvat prijava nije uspio.', true);
        });
        return;
      }

      if (tries >= FIREBASE_WAIT_TRIES) {
        clearInterval(timer);
        setStatus('Firebase se nije učitao. Provjeri hosting konfiguraciju.', true);
      }
    }, FIREBASE_WAIT_MS);
  }

  filterTournamentSelect.addEventListener('change', applyFilters);
  searchInput.addEventListener('input', applyFilters);

  waitForFirebaseAndSubscribe();
})();
