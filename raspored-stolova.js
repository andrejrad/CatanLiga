(function () {
  var FIREBASE_WAIT_TRIES = 80;
  var FIREBASE_WAIT_MS = 125;

  var searchInput = document.getElementById('publicTableSearch');
  var statusEl = document.getElementById('publicTableStatus');
  var listEl = document.getElementById('publicTableList');

  var db = null;
  var tournamentsCollection = null;
  var registrationsCollection = null;
  var assignmentsCollection = null;
  var scoresCollection = null;

  var allRows = [];

  if (!searchInput || !statusEl || !listEl) {
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

  function normalize(value) {
    return (value || '').toLowerCase().trim();
  }

  function formatDate(dateValue) {
    if (!dateValue) {
      return '';
    }
    var parts = dateValue.split('-');
    if (parts.length !== 3) {
      return dateValue;
    }
    return parts[2] + '.' + parts[1] + '.' + parts[0] + '.';
  }

  function getTournamentLabel(item) {
    return 'Kolo ' + (item.round || '-') + ' - ' + formatDate(item.date) + ' ' + (item.time || '') + ' - ' + (item.venueName || '');
  }

  function initFirebaseConnections() {
    if (!window.firebase || !firebase.apps || !firebase.apps.length) {
      return false;
    }

    db = firebase.firestore();
    registrationsCollection = db.collection('registrations');
    assignmentsCollection = db.collection('adminTableAssignments');
    scoresCollection = db.collection('adminRoundScores');
    return true;
  }

  function renderRows(rows) {
    listEl.innerHTML = '';

    if (!rows.length) {
      listEl.appendChild(createMessage('Nema pristiglih igrača za nezaključane stolove.'));
      return;
    }

    var wrap = document.createElement('div');
    wrap.className = 'tournament-table-wrap';

    var table = document.createElement('table');
    table.className = 'tournament-table';

    var thead = document.createElement('thead');
    var headRow = document.createElement('tr');
    ['Prezime', 'Ime', 'Runda', 'Stol'].forEach(function (label) {
      var th = document.createElement('th');
      th.textContent = label;
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);

    var tbody = document.createElement('tbody');
    rows.forEach(function (item) {
      var row = document.createElement('tr');

      var lastNameTd = document.createElement('td');
      lastNameTd.textContent = item.lastName || '';

      var firstNameTd = document.createElement('td');
      firstNameTd.textContent = item.firstName || '';

      var roundTd = document.createElement('td');
      roundTd.textContent = String(item.round || '');

      var tableTd = document.createElement('td');
      tableTd.textContent = String(item.tableNumber || '');

      row.appendChild(lastNameTd);
      row.appendChild(firstNameTd);
      row.appendChild(roundTd);
      row.appendChild(tableTd);
      tbody.appendChild(row);
    });

    table.appendChild(thead);
    table.appendChild(tbody);
    wrap.appendChild(table);
    listEl.appendChild(wrap);
  }

  function applyFiltersAndRender() {
    var search = normalize(searchInput.value);

    var filtered = allRows.filter(function (row) {
      if (!search) {
        return true;
      }
      var fullName = normalize((row.firstName || '') + ' ' + (row.lastName || ''));
      var reverseName = normalize((row.lastName || '') + ' ' + (row.firstName || ''));
      return fullName.indexOf(search) !== -1 || reverseName.indexOf(search) !== -1;
    });

    renderRows(filtered);
  }

  function getUnlockedTableKeysMap(assignments, scoreDocs) {
    var assignedByTable = {};
    assignments.forEach(function (item) {
      var tableNumber = Number(item.tableNumber || 0);
      if (!tableNumber) {
        return;
      }

      var tournamentId = item.tournamentId || '';
      var round = Number(item.round || 0);
      if (!tournamentId || !round) {
        return;
      }

      var tableKey = tournamentId + '__r' + round + '__t' + tableNumber;
      if (!assignedByTable[tableKey]) {
        assignedByTable[tableKey] = {
          round: round,
          regIds: []
        };
      }
      assignedByTable[tableKey].regIds.push(item.registrationId);
    });

    var lockedByRegRound = {};
    scoreDocs.forEach(function (item) {
      if (!item || !item.registrationId) {
        return;
      }

      var round = Number(item.round || 0);
      if (!round) {
        return;
      }

      lockedByRegRound[item.registrationId + '__r' + round] = !!item.locked;
    });

    var unlockedTables = {};
    Object.keys(assignedByTable).forEach(function (tableKey) {
      var regIds = assignedByTable[tableKey].regIds;
      var round = assignedByTable[tableKey].round;
      if (!regIds.length) {
        return;
      }

      var allLocked = regIds.every(function (registrationId) {
        return lockedByRegRound[registrationId + '__r' + round] === true;
      });

      if (!allLocked) {
        unlockedTables[tableKey] = true;
      }
    });

    return unlockedTables;
  }

  async function loadAllUnlockedTables() {
    allRows = [];
    renderRows([]);
    setStatus('Učitavanje rasporeda stolova...', false);

    try {
      var results = await Promise.all([
        registrationsCollection.where('attended', '==', true).get(),
        assignmentsCollection.get(),
        scoresCollection.get()
      ]);

      var registrationsById = {};
      results[0].forEach(function (doc) {
        registrationsById[doc.id] = doc.data() || {};
      });

      var assignments = [];
      results[1].forEach(function (doc) {
        var data = doc.data() || {};
        assignments.push({
          registrationId: data.registrationId,
          tournamentId: data.tournamentId,
          round: Number(data.round || 0),
          tableNumber: data.tableNumber
        });
      });

      var scoreDocs = [];
      results[2].forEach(function (doc) {
        scoreDocs.push(doc.data() || {});
      });

      var unlockedTables = getUnlockedTableKeysMap(assignments, scoreDocs);

      allRows = assignments
        .filter(function (item) {
          var tableNumber = Number(item.tableNumber || 0);
          var tournamentId = item.tournamentId || '';
          var round = Number(item.round || 0);
          var tableKey = tournamentId + '__r' + round + '__t' + tableNumber;
          return tableNumber && round && tournamentId && unlockedTables[tableKey] && registrationsById[item.registrationId];
        })
        .map(function (item) {
          var reg = registrationsById[item.registrationId] || {};
          return {
            firstName: reg.firstName || '',
            lastName: reg.lastName || '',
            round: Number(item.round || 0),
            tableNumber: Number(item.tableNumber || 0)
          };
        })
        .sort(function (a, b) {
          if ((a.round || 0) !== (b.round || 0)) {
            return (a.round || 0) - (b.round || 0);
          }
          if ((a.tableNumber || 0) !== (b.tableNumber || 0)) {
            return (a.tableNumber || 0) - (b.tableNumber || 0);
          }
          var byLast = (a.lastName || '').localeCompare((b.lastName || ''), 'hr', { sensitivity: 'base' });
          if (byLast !== 0) {
            return byLast;
          }
          return (a.firstName || '').localeCompare((b.firstName || ''), 'hr', { sensitivity: 'base' });
        });

      applyFiltersAndRender();

      if (!allRows.length) {
        setStatus('Nema podataka za nezaključane stolove.', false);
      } else {
        setStatus('Prikaz svih nezaključanih stolova (sve runde): ' + allRows.length + ' igrača.', false);
      }
    } catch (error) {
      console.error(error);
      setStatus('Ne mogu učitati raspored stolova.', true);
      listEl.innerHTML = '';
      listEl.appendChild(createMessage('Ne mogu učitati podatke.'));
    }
  }

  function waitForFirebaseAndInit() {
    var tries = 0;

    var timer = setInterval(function () {
      tries += 1;

      if (initFirebaseConnections()) {
        clearInterval(timer);
        loadAllUnlockedTables();
        return;
      }

      if (tries >= FIREBASE_WAIT_TRIES) {
        clearInterval(timer);
        setStatus('Firebase se nije učitao. Osvježi stranicu i pokušaj ponovno.', true);
      }
    }, FIREBASE_WAIT_MS);
  }

  searchInput.addEventListener('input', applyFiltersAndRender);

  waitForFirebaseAndInit();
})();
