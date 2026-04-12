(function () {
  var FIREBASE_WAIT_TRIES = 80;
  var FIREBASE_WAIT_MS = 125;

  var tournamentSelect = document.getElementById('scoreTournamentSelect');
  var statusEl = document.getElementById('scoreEntryStatus');

  var roundViews = {
    1: {
      listEl: document.getElementById('scoreRound1List'),
      tableStatusEl: document.getElementById('scoreRound1TableStatus'),
      saveBtn: document.getElementById('scoreRound1SaveBtn'),
      exportBtn: document.getElementById('scoreRound1ExportBtn'),
      tableFilterSelect: document.getElementById('scoreRound1TableFilter'),
      lockBtn: document.getElementById('scoreRound1LockTableBtn'),
      lockStatusEl: document.getElementById('scoreRound1LockStatus')
    },
    2: {
      listEl: document.getElementById('scoreRound2List'),
      tableStatusEl: document.getElementById('scoreRound2TableStatus'),
      saveBtn: document.getElementById('scoreRound2SaveBtn'),
      exportBtn: document.getElementById('scoreRound2ExportBtn'),
      tableFilterSelect: document.getElementById('scoreRound2TableFilter'),
      lockBtn: document.getElementById('scoreRound2LockTableBtn'),
      lockStatusEl: document.getElementById('scoreRound2LockStatus')
    },
    3: {
      listEl: document.getElementById('scoreRound3List'),
      tableStatusEl: document.getElementById('scoreRound3TableStatus'),
      saveBtn: document.getElementById('scoreRound3SaveBtn'),
      exportBtn: document.getElementById('scoreRound3ExportBtn'),
      tableFilterSelect: document.getElementById('scoreRound3TableFilter'),
      lockBtn: document.getElementById('scoreRound3LockTableBtn'),
      lockStatusEl: document.getElementById('scoreRound3LockStatus')
    }
  };

  var db = null;
  var tournamentsCollection = null;
  var registrationsCollection = null;
  var tableAssignmentsCollection = null;
  var roundScoresCollection = null;
  var scoreRulesCollection = null;
  var scoreConfigCollection = null;

  var allTournaments = [];
  var selectedTournament = null;
  var registrationsById = {};
  var assignmentsByRound = { 1: [], 2: [], 3: [] };
  var scoreValuesByRound = { 1: {}, 2: {}, 3: {} };
  var tableFilterByRound = { 1: '', 2: '', 3: '' };
  var gamePointsCoefficient = 0.5;
  var placeBonusMap = {};
  var tabButtonsByRound = {};

  if (!tournamentSelect || !statusEl || !roundViews[1].listEl || !roundViews[2].listEl || !roundViews[3].listEl) {
    return;
  }

  function setStatus(message, isError) {
    statusEl.textContent = message;
    statusEl.style.color = isError ? '#ffb6a6' : '#ffe680';
  }

  function setRoundLockStatus(round, message, isError) {
    var el = roundViews[round].lockStatusEl;
    el.textContent = message;
    el.style.color = isError ? '#ffb6a6' : '#ffe680';
  }

  function createMessage(text) {
    var p = document.createElement('p');
    p.className = 'admin-note';
    p.textContent = text;
    return p;
  }

  function normalize(value) {
    return (value || '').trim();
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
    return 'Kolo ' + item.round + ' - ' + formatDate(item.date) + ' ' + (item.time || '') + ' - ' + (item.venueName || '');
  }

  function getPlayerName(item) {
    return ((item.firstName || '') + ' ' + (item.lastName || '')).trim();
  }

  function getPlayerSortData(registration, fallbackName) {
    if (registration) {
      return {
        firstName: registration.firstName || '',
        lastName: registration.lastName || ''
      };
    }

    var raw = normalize(fallbackName);
    var parts = raw.split(' ');
    if (parts.length <= 1) {
      return { firstName: raw, lastName: '' };
    }

    return {
      firstName: parts.slice(0, parts.length - 1).join(' '),
      lastName: parts[parts.length - 1]
    };
  }

  function renderTournamentOptions() {
    tournamentSelect.innerHTML = '';

    var placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = allTournaments.length ? 'Odaberi turnir' : 'Trenutno nema aktivnih turnira';
    tournamentSelect.appendChild(placeholder);

    allTournaments.forEach(function (item) {
      var option = document.createElement('option');
      option.value = item.id;
      option.textContent = getTournamentLabel(item);
      tournamentSelect.appendChild(option);
    });

    tournamentSelect.disabled = !allTournaments.length;
  }

  function setRoundButtonsEnabled(round, isEnabled) {
    roundViews[round].saveBtn.disabled = !isEnabled;
    roundViews[round].exportBtn.disabled = !isEnabled;
    roundViews[round].tableFilterSelect.disabled = !isEnabled;
    roundViews[round].lockBtn.disabled = !isEnabled;
  }

  function setAllRoundsEmptyState(message) {
    [1, 2, 3].forEach(function (round) {
      roundViews[round].listEl.innerHTML = '';
      roundViews[round].listEl.appendChild(createMessage(message));
      roundViews[round].tableStatusEl.innerHTML = '';
      roundViews[round].tableStatusEl.appendChild(createMessage(message));
      setRoundButtonsEnabled(round, false);
      roundViews[round].tableFilterSelect.innerHTML = '';
      var option = document.createElement('option');
      option.value = '';
      option.textContent = 'Svi stolovi';
      roundViews[round].tableFilterSelect.appendChild(option);
      tableFilterByRound[round] = '';
      setRoundLockStatus(round, '', false);
    });
    updateTabAvailability();
  }

  function getRoundTableStatuses(round) {
    var statusMap = {};

    buildRoundRows(round).forEach(function (row) {
      if (!statusMap[row.tableNumber]) {
        statusMap[row.tableNumber] = {
          tableNumber: row.tableNumber,
          allLocked: true,
          playerCount: 0
        };
      }

      statusMap[row.tableNumber].playerCount += 1;
      if (!row.locked) {
        statusMap[row.tableNumber].allLocked = false;
      }
    });

    return Object.keys(statusMap)
      .map(function (key) { return statusMap[key]; })
      .sort(function (a, b) { return a.tableNumber - b.tableNumber; });
  }

  function isRoundFullyLocked(round) {
    var statuses = getRoundTableStatuses(round);
    if (!statuses.length) {
      return false;
    }
    return statuses.every(function (item) { return item.allLocked; });
  }

  function canOpenRound(round) {
    if (round <= 1) {
      return true;
    }

    if (!selectedTournament) {
      return false;
    }

    for (var prevRound = 1; prevRound < round; prevRound += 1) {
      if (!isRoundFullyLocked(prevRound)) {
        return false;
      }
    }

    return true;
  }

  function getRoundFromPanelId(targetId) {
    if (targetId === 'panel-score-r1') return 1;
    if (targetId === 'panel-score-r2') return 2;
    if (targetId === 'panel-score-r3') return 3;
    return 1;
  }

  function updateTabAvailability() {
    [1, 2, 3].forEach(function (round) {
      var button = tabButtonsByRound[round];
      if (!button) {
        return;
      }

      var allowed = canOpenRound(round);
      button.disabled = !allowed;
      button.setAttribute('aria-disabled', allowed ? 'false' : 'true');
      button.title = allowed
        ? ''
        : 'Prije ove runde moraš zaključati sve stolove prethodnih rundi.';
    });
  }

  function renderRoundTableStatus(round) {
    var statusListEl = roundViews[round].tableStatusEl;
    statusListEl.innerHTML = '';

    if (!selectedTournament) {
      statusListEl.appendChild(createMessage('Status stolova će biti prikazan nakon odabira turnira.'));
      return;
    }

    var statuses = getRoundTableStatuses(round);
    if (!statuses.length) {
      statusListEl.appendChild(createMessage('Za ovu rundu nema raspoređenih stolova.'));
      return;
    }

    var wrap = document.createElement('div');
    wrap.className = 'tournament-table-wrap';

    var table = document.createElement('table');
    table.className = 'tournament-table';

    var thead = document.createElement('thead');
    var headRow = document.createElement('tr');
    ['Stol broj', 'Status'].forEach(function (label) {
      var th = document.createElement('th');
      th.textContent = label;
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);

    var tbody = document.createElement('tbody');
    statuses.forEach(function (item) {
      var row = document.createElement('tr');

      var tableTd = document.createElement('td');
      tableTd.textContent = String(item.tableNumber);

      var statusTd = document.createElement('td');
      statusTd.textContent = item.allLocked ? 'Zaključan' : 'Igra u toku';

      row.appendChild(tableTd);
      row.appendChild(statusTd);
      tbody.appendChild(row);
    });

    table.appendChild(thead);
    table.appendChild(tbody);
    wrap.appendChild(table);
    statusListEl.appendChild(wrap);
  }

  function buildRoundRows(round) {
    var rows = assignmentsByRound[round].map(function (assignment) {
      var registration = registrationsById[assignment.registrationId] || null;
      var sortData = getPlayerSortData(registration, assignment.playerName || '');
      var score = scoreValuesByRound[round][assignment.registrationId] || {};

      return {
        registrationId: assignment.registrationId,
        playerName: registration ? getPlayerName(registration) : (assignment.playerName || ''),
        tableNumber: assignment.tableNumber,
        place: score.place == null ? '' : String(score.place),
        vp: score.vp == null ? '' : String(score.vp),
        locked: !!score.locked,
        roundPoints: score.roundPoints,
        firstNameSort: sortData.firstName,
        lastNameSort: sortData.lastName
      };
    });

    rows.sort(function (a, b) {
      var lastCmp = (a.lastNameSort || '').localeCompare((b.lastNameSort || ''), 'hr', { sensitivity: 'base' });
      if (lastCmp !== 0) {
        return lastCmp;
      }
      return (a.firstNameSort || '').localeCompare((b.firstNameSort || ''), 'hr', { sensitivity: 'base' });
    });

    return rows;
  }

  function getRowsForSelectedTable(round) {
    var selectedTable = Number(tableFilterByRound[round] || 0);
    if (!selectedTable) {
      return [];
    }

    return buildRoundRows(round).filter(function (row) {
      return row.tableNumber === selectedTable;
    });
  }

  function refreshLockUi(round) {
    var selectedTable = Number(tableFilterByRound[round] || 0);
    var rows = getRowsForSelectedTable(round);
    var lockBtn = roundViews[round].lockBtn;

    if (!selectedTournament || !selectedTable || !rows.length) {
      lockBtn.disabled = true;
      setRoundLockStatus(round, 'Za zaključavanje odaberi stol u filteru.', false);
      return;
    }

    var allLocked = rows.every(function (row) { return row.locked; });
    if (allLocked) {
      lockBtn.disabled = true;
      setRoundLockStatus(round, 'Odabrani stol je već zaključen.', false);
      return;
    }

    lockBtn.disabled = false;
    setRoundLockStatus(round, 'Nakon zaključavanja više nije moguće uređivati Mjesto i VP za taj stol.', false);
  }

  function round2(value) {
    return Number(Number(value).toFixed(2));
  }

  function calculateRoundPoints(place, vp) {
    var bonus = placeBonusMap[place] == null ? 0 : placeBonusMap[place];
    return round2(vp * gamePointsCoefficient + bonus);
  }

  function renderRoundFilter(round, rows) {
    var select = roundViews[round].tableFilterSelect;
    var current = tableFilterByRound[round] || '';

    var tableNumbers = rows
      .map(function (row) { return row.tableNumber; })
      .filter(function (value, index, list) { return list.indexOf(value) === index; })
      .sort(function (a, b) { return a - b; });

    select.innerHTML = '';

    var defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = 'Svi stolovi';
    select.appendChild(defaultOption);

    tableNumbers.forEach(function (tableNumber) {
      var option = document.createElement('option');
      option.value = String(tableNumber);
      option.textContent = 'Stol ' + tableNumber;
      select.appendChild(option);
    });

    select.value = tableNumbers.indexOf(Number(current)) !== -1 ? current : '';
    tableFilterByRound[round] = select.value;
  }

  function getFilteredRoundRows(round) {
    var rows = buildRoundRows(round);
    var selectedTable = Number(tableFilterByRound[round] || 0);

    if (!selectedTable) {
      return rows;
    }

    return rows.filter(function (row) {
      return row.tableNumber === selectedTable;
    });
  }

  function renderRoundTable(round) {
    var listEl = roundViews[round].listEl;
    listEl.innerHTML = '';

    if (!selectedTournament) {
      listEl.appendChild(createMessage('Odaberi turnir za prikaz tablice.'));
      setRoundButtonsEnabled(round, false);
      renderRoundTableStatus(round);
      updateTabAvailability();
      return;
    }

    var allRows = buildRoundRows(round);
    if (!allRows.length) {
      listEl.appendChild(createMessage('Za ovu rundu nema raspoređenih igrača. Prvo postavi raspored stolova.'));
      setRoundButtonsEnabled(round, false);
      renderRoundFilter(round, []);
      refreshLockUi(round);
      renderRoundTableStatus(round);
      updateTabAvailability();
      return;
    }

    setRoundButtonsEnabled(round, true);
    renderRoundFilter(round, allRows);

    var rows = getFilteredRoundRows(round);
    if (!rows.length) {
      listEl.appendChild(createMessage('Nema igrača za odabrani broj stola.'));
      refreshLockUi(round);
      renderRoundTableStatus(round);
      updateTabAvailability();
      return;
    }

    var wrap = document.createElement('div');
    wrap.className = 'tournament-table-wrap';

    var table = document.createElement('table');
    table.className = 'tournament-table';

    var thead = document.createElement('thead');
    var headRow = document.createElement('tr');
    ['Ime i prezime', 'Stol', 'Mjesto', 'VP'].forEach(function (label) {
      var th = document.createElement('th');
      th.textContent = label;
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);

    var tbody = document.createElement('tbody');
    rows.forEach(function (rowData) {
      var row = document.createElement('tr');

      var nameTd = document.createElement('td');
      nameTd.textContent = rowData.playerName;

      var tableTd = document.createElement('td');
      tableTd.textContent = String(rowData.tableNumber);

      var placeTd = document.createElement('td');
      var placeInput = document.createElement('input');
      placeInput.type = 'number';
      placeInput.min = '1';
      placeInput.step = '1';
      placeInput.className = 'table-plan-input';
      placeInput.value = rowData.place;
      placeInput.disabled = rowData.locked;
      placeInput.setAttribute('aria-label', 'Mjesto za ' + rowData.playerName);
      placeInput.addEventListener('input', function () {
        var value = normalize(placeInput.value);
        if (!value) {
          if (!scoreValuesByRound[round][rowData.registrationId]) {
            scoreValuesByRound[round][rowData.registrationId] = { place: null, vp: null };
          }
          scoreValuesByRound[round][rowData.registrationId].place = null;
          return;
        }

        var numberValue = Number(value);
        if (!Number.isInteger(numberValue) || numberValue <= 0) {
          return;
        }

        if (!scoreValuesByRound[round][rowData.registrationId]) {
          scoreValuesByRound[round][rowData.registrationId] = { place: null, vp: null };
        }
        scoreValuesByRound[round][rowData.registrationId].place = numberValue;
      });
      placeTd.appendChild(placeInput);

      var vpTd = document.createElement('td');
      var vpInput = document.createElement('input');
      vpInput.type = 'number';
      vpInput.min = '0';
      vpInput.step = '1';
      vpInput.className = 'table-plan-input';
      vpInput.value = rowData.vp;
      vpInput.disabled = rowData.locked;
      vpInput.setAttribute('aria-label', 'VP za ' + rowData.playerName);
      vpInput.addEventListener('input', function () {
        var value = normalize(vpInput.value);
        if (!value) {
          if (!scoreValuesByRound[round][rowData.registrationId]) {
            scoreValuesByRound[round][rowData.registrationId] = { place: null, vp: null };
          }
          scoreValuesByRound[round][rowData.registrationId].vp = null;
          return;
        }

        var numberValue = Number(value);
        if (!Number.isInteger(numberValue) || numberValue < 0) {
          return;
        }

        if (!scoreValuesByRound[round][rowData.registrationId]) {
          scoreValuesByRound[round][rowData.registrationId] = { place: null, vp: null };
        }
        scoreValuesByRound[round][rowData.registrationId].vp = numberValue;
      });
      vpTd.appendChild(vpInput);

      row.appendChild(nameTd);
      row.appendChild(tableTd);
      row.appendChild(placeTd);
      row.appendChild(vpTd);
      tbody.appendChild(row);
    });

    table.appendChild(thead);
    table.appendChild(tbody);
    wrap.appendChild(table);
    listEl.appendChild(wrap);
    refreshLockUi(round);
    renderRoundTableStatus(round);
    updateTabAvailability();
  }

  function renderAllRounds() {
    renderRoundTable(1);
    renderRoundTable(2);
    renderRoundTable(3);
    updateTabAvailability();
  }

  function getRoundScoreDocId(round, registrationId) {
    return selectedTournament.id + '__round' + round + '__' + registrationId;
  }

  function validateRoundRows(round, rows) {
    for (var i = 0; i < rows.length; i += 1) {
      var row = rows[i];
      var value = scoreValuesByRound[round][row.registrationId] || {};
      var place = value.place;
      var vp = value.vp;

      if (place == null && vp == null) {
        continue;
      }

      if (!Number.isInteger(place) || place <= 0) {
        return 'Runda ' + round + ': Mjesto mora biti cijeli broj veći od 0.';
      }

      if (!Number.isInteger(vp) || vp < 0) {
        return 'Runda ' + round + ': VP mora biti cijeli broj veći ili jednak 0.';
      }
    }

    return '';
  }

  async function saveRound(round) {
    if (!selectedTournament) {
      setStatus('Odaberi turnir prije spremanja.', true);
      return;
    }

    var rows = buildRoundRows(round);
    if (!rows.length) {
      setStatus('Runda ' + round + ' nema igrača za spremanje.', true);
      return;
    }

    var validationMessage = validateRoundRows(round, rows);
    if (validationMessage) {
      setStatus(validationMessage, true);
      return;
    }

    var batch = db.batch();

    rows.forEach(function (row) {
      var docRef = roundScoresCollection.doc(getRoundScoreDocId(round, row.registrationId));
      var data = scoreValuesByRound[round][row.registrationId] || {};
      var place = data.place;
      var vp = data.vp;
      var locked = !!data.locked;

      if (locked) {
        return;
      }

      if (place == null && vp == null) {
        batch.delete(docRef);
        return;
      }

      batch.set(docRef, {
        tournamentId: selectedTournament.id,
        tournamentLabel: getTournamentLabel(selectedTournament),
        round: round,
        registrationId: row.registrationId,
        playerName: row.playerName,
        tableNumber: row.tableNumber,
        place: place,
        vp: vp,
        locked: false,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    });

    try {
      await batch.commit();
      setStatus('Rezultati za rundu ' + round + ' su uspješno spremljeni.', false);
    } catch (error) {
      console.error(error);
      setStatus('Spremanje rezultata za rundu ' + round + ' nije uspjelo.', true);
    }
  }

  async function lockSelectedTable(round) {
    if (!selectedTournament) {
      setStatus('Odaberi turnir prije zaključavanja.', true);
      return;
    }

    var selectedTable = Number(tableFilterByRound[round] || 0);
    if (!selectedTable) {
      setStatus('Za zaključavanje odaberi broj stola u filteru.', true);
      return;
    }

    var rows = getRowsForSelectedTable(round);
    if (!rows.length) {
      setStatus('Nema igrača za odabrani stol.', true);
      return;
    }

    var unlockedRows = rows.filter(function (row) { return !row.locked; });
    if (!unlockedRows.length) {
      setStatus('Odabrani stol je već zaključen.', false);
      refreshLockUi(round);
      return;
    }

    var hasMissing = unlockedRows.some(function (row) {
      var data = scoreValuesByRound[round][row.registrationId] || {};
      return !Number.isInteger(data.place) || data.place <= 0 || !Number.isInteger(data.vp) || data.vp < 0;
    });

    if (hasMissing) {
      setStatus('Prije zaključavanja unesi Mjesto i VP za sve igrače odabranog stola.', true);
      return;
    }

    var batch = db.batch();

    unlockedRows.forEach(function (row) {
      var data = scoreValuesByRound[round][row.registrationId] || {};
      var roundPoints = calculateRoundPoints(data.place, data.vp);
      var docRef = roundScoresCollection.doc(getRoundScoreDocId(round, row.registrationId));

      batch.set(docRef, {
        tournamentId: selectedTournament.id,
        tournamentLabel: getTournamentLabel(selectedTournament),
        round: round,
        registrationId: row.registrationId,
        playerName: row.playerName,
        tableNumber: row.tableNumber,
        place: data.place,
        vp: data.vp,
        roundPoints: roundPoints,
        locked: true,
        lockedAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      scoreValuesByRound[round][row.registrationId] = {
        place: data.place,
        vp: data.vp,
        locked: true,
        roundPoints: roundPoints
      };
    });

    try {
      await batch.commit();
      renderRoundTable(round);
      updateTabAvailability();

      if (isRoundFullyLocked(round) && round < 3) {
        var nextRound = round + 1;
        setStatus('Svi stolovi u rundi ' + round + ' su zaključani. Sada možeš prijeći na rundu ' + nextRound + '.', false);
      } else {
        setStatus('Stol ' + selectedTable + ' u rundi ' + round + ' je zaključen. Bodovi su izračunati po formuli.', false);
      }
    } catch (error) {
      console.error(error);
      setStatus('Zaključavanje stola nije uspjelo.', true);
    }
  }

  function csvEscape(value) {
    var stringValue = String(value == null ? '' : value);
    return '"' + stringValue.replace(/"/g, '""') + '"';
  }

  function exportRoundCsv(round) {
    if (!selectedTournament) {
      setStatus('Odaberi turnir prije exporta.', true);
      return;
    }

    var rows = getFilteredRoundRows(round);
    if (!rows.length) {
      setStatus('Nema podataka za export u odabranoj rundi/filteru.', true);
      return;
    }

    var csvRows = [];
    csvRows.push(['Ime i prezime', 'Stol', 'Mjesto', 'VP'].map(csvEscape).join(','));

    rows.forEach(function (row) {
      var data = scoreValuesByRound[round][row.registrationId] || {};
      csvRows.push([
        row.playerName,
        row.tableNumber,
        data.place == null ? '' : data.place,
        data.vp == null ? '' : data.vp
      ].map(csvEscape).join(','));
    });

    var csv = '\uFEFF' + csvRows.join('\n');
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);

    var link = document.createElement('a');
    link.href = url;
    link.download = 'bodovi-' + selectedTournament.id + '-runda-' + round + '.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    setStatus('CSV export za rundu ' + round + ' je pripremljen.', false);
  }

  async function loadTournamentData(tournamentId) {
    registrationsById = {};
    assignmentsByRound = { 1: [], 2: [], 3: [] };
    scoreValuesByRound = { 1: {}, 2: {}, 3: {} };
    tableFilterByRound = { 1: '', 2: '', 3: '' };

    if (!tournamentId) {
      selectedTournament = null;
      setAllRoundsEmptyState('Odaberi turnir za prikaz tablice.');
      return;
    }

    selectedTournament = allTournaments.find(function (item) {
      return item.id === tournamentId;
    }) || null;

    try {
      var results = await Promise.all([
        registrationsCollection.where('tournamentId', '==', tournamentId).get(),
        tableAssignmentsCollection.where('tournamentId', '==', tournamentId).get(),
        roundScoresCollection.where('tournamentId', '==', tournamentId).get()
      ]);

      results[0].forEach(function (doc) {
        var data = doc.data() || {};
        data.id = doc.id;
        registrationsById[doc.id] = data;
      });

      results[1].forEach(function (doc) {
        var data = doc.data() || {};
        if (!assignmentsByRound[data.round]) {
          return;
        }
        assignmentsByRound[data.round].push({
          registrationId: data.registrationId,
          playerName: data.playerName || '',
          tableNumber: data.tableNumber
        });
      });

      results[2].forEach(function (doc) {
        var data = doc.data() || {};
        if (!scoreValuesByRound[data.round] || !data.registrationId) {
          return;
        }
        scoreValuesByRound[data.round][data.registrationId] = {
          place: data.place,
          vp: data.vp,
          locked: !!data.locked,
          roundPoints: data.roundPoints
        };
      });

      renderAllRounds();
      setStatus('Podaci za turnir su učitani.', false);
    } catch (error) {
      console.error(error);
      setAllRoundsEmptyState('Ne mogu učitati prijave, raspored i rezultate.');
      setStatus('Dohvat podataka nije uspio.', true);
    }
  }

  function initTabs() {
    var tabButtons = document.querySelectorAll('.bodovanje-tab');
    var tabPanels = document.querySelectorAll('.bodovanje-panel');

    function activateTab(button) {
      var targetId = button.getAttribute('data-tab-target');
      var targetRound = getRoundFromPanelId(targetId);

      if (!canOpenRound(targetRound)) {
        setStatus('Ne možeš prijeći u rundu ' + targetRound + ' dok svi stolovi u prethodnim rundama nisu zaključani.', true);
        return;
      }

      tabButtons.forEach(function (tabButton) {
        var isActive = tabButton === button;
        tabButton.classList.toggle('is-active', isActive);
        tabButton.setAttribute('aria-selected', isActive ? 'true' : 'false');
        tabButton.setAttribute('tabindex', isActive ? '0' : '-1');
      });

      tabPanels.forEach(function (panel) {
        var isActive = panel.id === targetId;
        panel.classList.toggle('is-active', isActive);
        panel.hidden = !isActive;
      });

      updateTabAvailability();
    }

    tabButtons.forEach(function (button, index) {
      var roundFromTarget = getRoundFromPanelId(button.getAttribute('data-tab-target'));
      tabButtonsByRound[roundFromTarget] = button;

      button.addEventListener('click', function () {
        activateTab(button);
      });

      button.addEventListener('keydown', function (event) {
        var currentIndex = Array.prototype.indexOf.call(tabButtons, button);
        var nextIndex = currentIndex;

        if (event.key === 'ArrowRight') {
          nextIndex = (currentIndex + 1) % tabButtons.length;
        } else if (event.key === 'ArrowLeft') {
          nextIndex = (currentIndex - 1 + tabButtons.length) % tabButtons.length;
        } else if (event.key === 'Home') {
          nextIndex = 0;
        } else if (event.key === 'End') {
          nextIndex = tabButtons.length - 1;
        } else {
          return;
        }

        event.preventDefault();
        tabButtons[nextIndex].focus();
        activateTab(tabButtons[nextIndex]);
      });

      if (index === 0) {
        activateTab(button);
      }
    });

    updateTabAvailability();
  }

  function initFirebaseConnections() {
    if (!window.firebase || !firebase.apps || !firebase.apps.length) {
      return false;
    }

    db = firebase.firestore();
    tournamentsCollection = db.collection('adminTournaments');
    registrationsCollection = db.collection('registrations');
    tableAssignmentsCollection = db.collection('adminTableAssignments');
    roundScoresCollection = db.collection('adminRoundScores');
    scoreRulesCollection = db.collection('adminScoreRules');
    scoreConfigCollection = db.collection('adminScoreConfig');
    return true;
  }

  async function loadScoringSettings() {
    try {
      var results = await Promise.all([
        scoreRulesCollection.get(),
        scoreConfigCollection.doc('global').get()
      ]);

      placeBonusMap = {};
      results[0].forEach(function (doc) {
        var data = doc.data() || {};
        if (Number.isInteger(data.place) && Number.isInteger(data.points) && data.place > 0) {
          placeBonusMap[data.place] = data.points;
        }
      });

      var configData = results[1].exists ? results[1].data() : null;
      if (configData && typeof configData.gamePointsCoefficient === 'number' && configData.gamePointsCoefficient >= 0) {
        gamePointsCoefficient = configData.gamePointsCoefficient;
      } else {
        gamePointsCoefficient = 0.5;
      }
    } catch (error) {
      console.error(error);
      placeBonusMap = {};
      gamePointsCoefficient = 0.5;
    }
  }

  function loadTournaments() {
    tournamentsCollection
      .orderBy('date', 'asc')
      .get()
      .then(function (snapshot) {
        allTournaments = snapshot.docs.map(function (doc) {
          var data = doc.data() || {};
          data.id = doc.id;
          return data;
        }).filter(function (item) {
          return item.active !== false && !!item.date && !!item.time;
        });

        renderTournamentOptions();
        setAllRoundsEmptyState('Odaberi turnir za prikaz tablice.');
      })
      .catch(function (error) {
        console.error(error);
        renderTournamentOptions();
        setAllRoundsEmptyState('Ne mogu učitati turnire.');
        setStatus('Dohvat turnira nije uspio.', true);
      });
  }

  function waitForFirebaseAndInit() {
    var tries = 0;

    var timer = setInterval(function () {
      tries += 1;

      if (initFirebaseConnections()) {
        clearInterval(timer);
        initTabs();
        loadScoringSettings().then(function () {
          loadTournaments();
        });
        return;
      }

      if (tries >= FIREBASE_WAIT_TRIES) {
        clearInterval(timer);
        setAllRoundsEmptyState('Firebase se nije učitao. Osvježi stranicu.');
        setStatus('Firebase se nije učitao. Osvježi stranicu.', true);
      }
    }, FIREBASE_WAIT_MS);
  }

  tournamentSelect.addEventListener('change', function () {
    loadTournamentData(tournamentSelect.value);
  });

  [1, 2, 3].forEach(function (round) {
    roundViews[round].saveBtn.addEventListener('click', function () {
      saveRound(round);
    });

    roundViews[round].exportBtn.addEventListener('click', function () {
      exportRoundCsv(round);
    });

    roundViews[round].tableFilterSelect.addEventListener('change', function () {
      tableFilterByRound[round] = roundViews[round].tableFilterSelect.value;
      renderRoundTable(round);
    });

    roundViews[round].lockBtn.addEventListener('click', function () {
      lockSelectedTable(round);
    });
  });

  waitForFirebaseAndInit();
})();
