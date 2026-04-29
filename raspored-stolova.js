(function () {
  var FIREBASE_WAIT_TRIES = 80;
  var FIREBASE_WAIT_MS = 125;

  var tournamentSelect = document.getElementById('publicTableTournamentSelect');
  var tableFilterSelect = document.getElementById('publicTableFilterSelect');
  var searchInput = document.getElementById('publicTableSearch');
  var statusEl = document.getElementById('publicTableStatus');
  var listEl = document.getElementById('publicTableList');

  var db = null;
  var tournamentsCollection = null;
  var registrationsCollection = null;
  var assignmentsCollection = null;
  var scoresCollection = null;

  var allTournaments = [];
  var selectedTournament = null;
  var allRows = [];

  if (!tournamentSelect || !tableFilterSelect || !searchInput || !statusEl || !listEl) {
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
    tournamentsCollection = db.collection('adminTournaments');
    registrationsCollection = db.collection('registrations');
    assignmentsCollection = db.collection('adminTableAssignments');
    scoresCollection = db.collection('adminRoundScores');
    return true;
  }

  function renderTournamentOptions() {
    tournamentSelect.innerHTML = '';

    var placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = allTournaments.length ? 'Odaberi turnir' : 'Trenutno nema turnira';
    tournamentSelect.appendChild(placeholder);

    allTournaments.forEach(function (item) {
      var option = document.createElement('option');
      option.value = item.id;
      option.textContent = getTournamentLabel(item);
      tournamentSelect.appendChild(option);
    });

    tournamentSelect.disabled = !allTournaments.length;
  }

  function renderTableFilterOptions(rows) {
    tableFilterSelect.innerHTML = '';

    var defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = 'Svi nezaključani stolovi';
    tableFilterSelect.appendChild(defaultOption);

    var seen = {};
    var tableNumbers = [];

    rows.forEach(function (row) {
      var tableNumber = Number(row.tableNumber || 0);
      if (!tableNumber || seen[tableNumber]) {
        return;
      }
      seen[tableNumber] = true;
      tableNumbers.push(tableNumber);
    });

    tableNumbers.sort(function (a, b) { return a - b; });

    tableNumbers.forEach(function (tableNumber) {
      var option = document.createElement('option');
      option.value = String(tableNumber);
      option.textContent = 'Stol ' + tableNumber;
      tableFilterSelect.appendChild(option);
    });

    tableFilterSelect.disabled = !rows.length;
  }

  function renderRows(rows) {
    listEl.innerHTML = '';

    if (!selectedTournament) {
      listEl.appendChild(createMessage('Odaberi turnir za prikaz rasporeda.'));
      return;
    }

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
    ['Prezime', 'Ime', 'Stol'].forEach(function (label) {
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

      var tableTd = document.createElement('td');
      tableTd.textContent = String(item.tableNumber || '');

      row.appendChild(lastNameTd);
      row.appendChild(firstNameTd);
      row.appendChild(tableTd);
      tbody.appendChild(row);
    });

    table.appendChild(thead);
    table.appendChild(tbody);
    wrap.appendChild(table);
    listEl.appendChild(wrap);
  }

  function applyFiltersAndRender() {
    var tableFilter = tableFilterSelect.value;
    var search = normalize(searchInput.value);

    var filtered = allRows.filter(function (row) {
      var tableOk = !tableFilter || String(row.tableNumber) === tableFilter;
      if (!tableOk) {
        return false;
      }

      if (!search) {
        return true;
      }

      var fullName = normalize((row.firstName || '') + ' ' + (row.lastName || ''));
      var reverseName = normalize((row.lastName || '') + ' ' + (row.firstName || ''));
      return fullName.indexOf(search) !== -1 || reverseName.indexOf(search) !== -1;
    });

    renderRows(filtered);
  }

  function getUnlockedTablesMap(assignments, scoreDocs) {
    var assignedByTable = {};
    assignments.forEach(function (item) {
      var tableNumber = Number(item.tableNumber || 0);
      if (!tableNumber) {
        return;
      }
      if (!assignedByTable[tableNumber]) {
        assignedByTable[tableNumber] = [];
      }
      assignedByTable[tableNumber].push(item.registrationId);
    });

    var lockedByReg = {};
    scoreDocs.forEach(function (item) {
      if (!item || !item.registrationId) {
        return;
      }
      lockedByReg[item.registrationId] = !!item.locked;
    });

    var unlockedTables = {};
    Object.keys(assignedByTable).forEach(function (tableKey) {
      var regIds = assignedByTable[tableKey];
      if (!regIds.length) {
        return;
      }

      var allLocked = regIds.every(function (registrationId) {
        return lockedByReg[registrationId] === true;
      });

      if (!allLocked) {
        unlockedTables[tableKey] = true;
      }
    });

    return unlockedTables;
  }

  async function loadTournamentData(tournamentId) {
    selectedTournament = allTournaments.find(function (item) {
      return item.id === tournamentId;
    }) || null;

    allRows = [];
    renderRows([]);
    tableFilterSelect.innerHTML = '<option value="">Svi nezaključani stolovi</option>';
    tableFilterSelect.disabled = true;
    searchInput.value = '';
    searchInput.disabled = true;

    if (!selectedTournament) {
      return;
    }

    setStatus('Učitavanje rasporeda stolova...', false);

    try {
      var results = await Promise.all([
        registrationsCollection.where('tournamentId', '==', tournamentId).where('attended', '==', true).get(),
        assignmentsCollection.where('tournamentId', '==', tournamentId).where('round', '==', 1).get(),
        scoresCollection.where('tournamentId', '==', tournamentId).where('round', '==', 1).get()
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
          tableNumber: data.tableNumber
        });
      });

      var scoreDocs = [];
      results[2].forEach(function (doc) {
        scoreDocs.push(doc.data() || {});
      });

      var unlockedTables = getUnlockedTablesMap(assignments, scoreDocs);

      allRows = assignments
        .filter(function (item) {
          var tableNumber = Number(item.tableNumber || 0);
          return tableNumber && unlockedTables[String(tableNumber)] && registrationsById[item.registrationId];
        })
        .map(function (item) {
          var reg = registrationsById[item.registrationId] || {};
          return {
            firstName: reg.firstName || '',
            lastName: reg.lastName || '',
            tableNumber: Number(item.tableNumber || 0)
          };
        })
        .sort(function (a, b) {
          var byLast = (a.lastName || '').localeCompare((b.lastName || ''), 'hr', { sensitivity: 'base' });
          if (byLast !== 0) {
            return byLast;
          }
          return (a.firstName || '').localeCompare((b.firstName || ''), 'hr', { sensitivity: 'base' });
        });

      renderTableFilterOptions(allRows);
      searchInput.disabled = !allRows.length;
      applyFiltersAndRender();

      if (!allRows.length) {
        setStatus('Za odabrani turnir nema podataka za nezaključane stolove.', false);
      } else {
        setStatus('Prikazani su pristigli igrači po nezaključanim stolovima (runda 1).', false);
      }
    } catch (error) {
      console.error(error);
      setStatus('Ne mogu učitati raspored stolova za odabrani turnir.', true);
      listEl.innerHTML = '';
      listEl.appendChild(createMessage('Ne mogu učitati podatke.'));
    }
  }

  function loadTournaments() {
    tournamentsCollection.orderBy('date', 'asc').get().then(function (snapshot) {
      var list = [];

      snapshot.forEach(function (doc) {
        var data = doc.data() || {};
        if (!data.date || !data.time || data.active === false) {
          return;
        }
        data.id = doc.id;
        list.push(data);
      });

      list.sort(function (a, b) {
        var aDate = new Date(a.date + 'T' + a.time);
        var bDate = new Date(b.date + 'T' + b.time);
        return aDate - bDate;
      });

      allTournaments = list;
      renderTournamentOptions();

      if (!allTournaments.length) {
        setStatus('Trenutno nema aktivnih turnira.', true);
      } else {
        setStatus('', false);
      }
    }).catch(function (error) {
      console.error(error);
      tournamentSelect.innerHTML = '<option value="">Ne mogu učitati turnire</option>';
      tournamentSelect.disabled = true;
      setStatus('Dohvat turnira nije uspio.', true);
    });
  }

  function waitForFirebaseAndInit() {
    var tries = 0;

    var timer = setInterval(function () {
      tries += 1;

      if (initFirebaseConnections()) {
        clearInterval(timer);
        loadTournaments();
        return;
      }

      if (tries >= FIREBASE_WAIT_TRIES) {
        clearInterval(timer);
        setStatus('Firebase se nije učitao. Osvježi stranicu i pokušaj ponovno.', true);
      }
    }, FIREBASE_WAIT_MS);
  }

  tournamentSelect.addEventListener('change', function () {
    loadTournamentData(tournamentSelect.value);
  });

  tableFilterSelect.addEventListener('change', applyFiltersAndRender);
  searchInput.addEventListener('input', applyFiltersAndRender);

  waitForFirebaseAndInit();
})();
