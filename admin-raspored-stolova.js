(function () {
  var FIREBASE_WAIT_TRIES = 80;
  var FIREBASE_WAIT_MS = 125;
  var PLAYERS_PER_TABLE = 4;

  var tournamentSelect = document.getElementById('tableTournamentSelect');
  var statusEl = document.getElementById('tablePlanStatus');

  var roundViews = {
    1: {
      listEl: document.getElementById('round1List'),
      summaryEl: document.getElementById('round1Summary'),
      saveBtn: document.getElementById('round1SaveBtn'),
      exportBtn: document.getElementById('round1ExportBtn'),
      tableFilterSelect: document.getElementById('round1TableFilter'),
      randomBtn: null
    },
    2: {
      listEl: document.getElementById('round2List'),
      summaryEl: document.getElementById('round2Summary'),
      saveBtn: document.getElementById('round2SaveBtn'),
      exportBtn: document.getElementById('round2ExportBtn'),
      tableFilterSelect: document.getElementById('round2TableFilter'),
      randomBtn: document.getElementById('round2RandomBtn')
    },
    3: {
      listEl: document.getElementById('round3List'),
      summaryEl: document.getElementById('round3Summary'),
      saveBtn: document.getElementById('round3SaveBtn'),
      exportBtn: document.getElementById('round3ExportBtn'),
      tableFilterSelect: document.getElementById('round3TableFilter'),
      randomBtn: document.getElementById('round3ArrangeBtn')
    }
  };

  var db = null;
  var tournamentsCollection = null;
  var registrationsCollection = null;
  var tableAssignmentsCollection = null;
  var roundScoresCollection = null;

  var allTournaments = [];
  var selectedTournament = null;
  var tournamentRegistrations = [];
  var assignmentsByRound = {
    1: {},
    2: {},
    3: {}
  };
  var roundFilterSelections = {
    1: '',
    2: '',
    3: ''
  };

  if (!tournamentSelect || !statusEl || !roundViews[1].listEl || !roundViews[2].listEl || !roundViews[3].listEl) {
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

  function setButtonsEnabled(round, isEnabled) {
    var view = roundViews[round];
    view.saveBtn.disabled = !isEnabled;
    view.exportBtn.disabled = !isEnabled;
    if (view.randomBtn) {
      view.randomBtn.disabled = !isEnabled;
    }
  }

  function renderEmptyState(message) {
    Object.keys(roundViews).forEach(function (key) {
      var round = Number(key);
      roundViews[round].listEl.innerHTML = '';
      roundViews[round].listEl.appendChild(createMessage(message));
      roundViews[round].summaryEl.innerHTML = '';
      roundViews[round].summaryEl.appendChild(createMessage(message));
      setButtonsEnabled(round, false);
    });
  }

  function getAssignmentValue(round, registrationId) {
    var item = assignmentsByRound[round][registrationId];
    return item && item.tableNumber ? String(item.tableNumber) : '';
  }

  function setAssignmentValue(round, registration, rawValue) {
    var value = normalize(rawValue);
    var registrationId = registration.id;

    if (!value) {
      delete assignmentsByRound[round][registrationId];
      return;
    }

    var numberValue = Number(value);
    if (!Number.isInteger(numberValue) || numberValue <= 0) {
      delete assignmentsByRound[round][registrationId];
      return;
    }

    assignmentsByRound[round][registrationId] = {
      registrationId: registration.id,
      tournamentId: selectedTournament ? selectedTournament.id : '',
      tournamentLabel: selectedTournament ? getTournamentLabel(selectedTournament) : '',
      round: round,
      playerName: getPlayerName(registration),
      email: registration.email || '',
      note: registration.note || '',
      tableNumber: numberValue
    };
  }

  function sortRegistrations(items) {
    return items.slice().sort(function (a, b) {
      var lastCmp = (a.lastName || '').localeCompare((b.lastName || ''), 'hr', { sensitivity: 'base' });
      if (lastCmp !== 0) {
        return lastCmp;
      }
      return (a.firstName || '').localeCompare((b.firstName || ''), 'hr', { sensitivity: 'base' });
    });
  }

  function getRoundEntries(round) {
    return tournamentRegistrations.map(function (registration) {
      var assignment = assignmentsByRound[round][registration.id] || null;
      return {
        registration: registration,
        tableNumber: assignment ? assignment.tableNumber : null
      };
    });
  }

  function renderRoundFilter(round) {
    var view = roundViews[round];
    var select = view.tableFilterSelect;

    if (!select) {
      return;
    }

    var prev = roundFilterSelections[round] || '';
    var tableNumbers = getRoundEntries(round)
      .map(function (entry) { return entry.tableNumber; })
      .filter(function (value) { return value != null; })
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

    select.value = tableNumbers.indexOf(Number(prev)) !== -1 ? prev : '';
    roundFilterSelections[round] = select.value;
    select.disabled = !selectedTournament || !tournamentRegistrations.length;
  }

  function validateRound(round) {
    var counts = {};
    var entries = getRoundEntries(round);

    for (var i = 0; i < entries.length; i += 1) {
      var tableNumber = entries[i].tableNumber;
      if (tableNumber == null) {
        continue;
      }

      if (!Number.isInteger(tableNumber) || tableNumber <= 0) {
        return 'Broj stola mora biti cijeli broj veći od 0.';
      }

      counts[tableNumber] = (counts[tableNumber] || 0) + 1;
      if (counts[tableNumber] > PLAYERS_PER_TABLE) {
        return 'Stol ' + tableNumber + ' ima više od ' + PLAYERS_PER_TABLE + ' igrača.';
      }
    }

    return '';
  }

  function buildSummary(round) {
    var summary = {};
    var entries = getRoundEntries(round);

    entries.forEach(function (entry) {
      if (entry.tableNumber == null) {
        return;
      }
      if (!summary[entry.tableNumber]) {
        summary[entry.tableNumber] = [];
      }
      summary[entry.tableNumber].push(entry.registration);
    });

    var rows = Object.keys(summary)
      .map(function (key) { return Number(key); })
      .sort(function (a, b) { return a - b; })
      .map(function (tableNumber) {
        return {
          tableNumber: tableNumber,
          players: sortRegistrations(summary[tableNumber])
        };
      });

    return rows;
  }

  function renderSummary(round) {
    var summaryEl = roundViews[round].summaryEl;
    var rows = buildSummary(round);
    summaryEl.innerHTML = '';

    if (!selectedTournament) {
      summaryEl.appendChild(createMessage('Sažetak će biti prikazan nakon odabira turnira.'));
      return;
    }

    if (!rows.length) {
      summaryEl.appendChild(createMessage('Za ovu rundu još nema upisanih stolova.'));
      return;
    }

    var wrap = document.createElement('div');
    wrap.className = 'tournament-table-wrap';

    var table = document.createElement('table');
    table.className = 'tournament-table';

    var thead = document.createElement('thead');
    var headRow = document.createElement('tr');
    ['Stol', 'Broj igrača', 'Igrači'].forEach(function (label) {
      var th = document.createElement('th');
      th.textContent = label;
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);

    var tbody = document.createElement('tbody');
    rows.forEach(function (item) {
      var row = document.createElement('tr');

      var tableTd = document.createElement('td');
      tableTd.textContent = String(item.tableNumber);

      var countTd = document.createElement('td');
      countTd.textContent = String(item.players.length);

      var playersTd = document.createElement('td');
      var playersList = document.createElement('div');
      playersList.style.display = 'grid';
      playersList.style.gap = '0.15rem';
      item.players.forEach(function (player) {
        var playerLine = document.createElement('div');
        playerLine.textContent = getPlayerName(player);
        playersList.appendChild(playerLine);
      });
      playersTd.appendChild(playersList);

      row.appendChild(tableTd);
      row.appendChild(countTd);
      row.appendChild(playersTd);
      tbody.appendChild(row);
    });

    table.appendChild(thead);
    table.appendChild(tbody);
    wrap.appendChild(table);
    summaryEl.appendChild(wrap);
  }

  function renderRoundTable(round) {
    var listEl = roundViews[round].listEl;
    listEl.innerHTML = '';

    if (!selectedTournament) {
      listEl.appendChild(createMessage('Odaberi turnir za prikaz prijavljenih igrača.'));
      setButtonsEnabled(round, false);
      return;
    }

    if (!tournamentRegistrations.length) {
      listEl.appendChild(createMessage('Za odabrani turnir nema prijavljenih igrača.'));
      setButtonsEnabled(round, false);
      return;
    }

    setButtonsEnabled(round, true);
    renderRoundFilter(round);

    var wrap = document.createElement('div');
    wrap.className = 'tournament-table-wrap';

    var table = document.createElement('table');
    table.className = 'tournament-table';

    var thead = document.createElement('thead');
    var headRow = document.createElement('tr');
    ['Ime i prezime', 'Napomena', 'Broj stola'].forEach(function (label) {
      var th = document.createElement('th');
      th.textContent = label;
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);

    var selectedTableFilter = Number(roundFilterSelections[round] || 0);
    var visibleRegistrations = sortRegistrations(tournamentRegistrations).filter(function (registration) {
      if (!selectedTableFilter) {
        return true;
      }
      var assignment = assignmentsByRound[round][registration.id];
      return assignment && assignment.tableNumber === selectedTableFilter;
    });

    if (!visibleRegistrations.length) {
      listEl.appendChild(createMessage('Nema igrača za odabrani broj stola.'));
      return;
    }

    var tbody = document.createElement('tbody');
    visibleRegistrations.forEach(function (registration) {
      var row = document.createElement('tr');

      var nameTd = document.createElement('td');
      nameTd.textContent = getPlayerName(registration);

      var noteTd = document.createElement('td');
      noteTd.textContent = registration.note || '-';

      var tableTd = document.createElement('td');
      var input = document.createElement('input');
      input.type = 'number';
      input.min = '1';
      input.step = '1';
      input.value = getAssignmentValue(round, registration.id);
      input.className = 'table-plan-input';
      input.setAttribute('aria-label', 'Broj stola za ' + getPlayerName(registration));
      input.addEventListener('input', function () {
        setAssignmentValue(round, registration, input.value);
        renderRoundFilter(round);
        renderSummary(round);
      });
      tableTd.appendChild(input);

      row.appendChild(nameTd);
      row.appendChild(noteTd);
      row.appendChild(tableTd);
      tbody.appendChild(row);
    });

    table.appendChild(thead);
    table.appendChild(tbody);
    wrap.appendChild(table);
    listEl.appendChild(wrap);
  }

  function renderAllRounds() {
    renderRoundFilter(1);
    renderRoundFilter(2);
    renderRoundFilter(3);
    renderRoundTable(1);
    renderRoundTable(2);
    renderRoundTable(3);
    renderSummary(1);
    renderSummary(2);
    renderSummary(3);
  }

  function getAssignmentDocId(round, registrationId) {
    return selectedTournament.id + '__round' + round + '__' + registrationId;
  }

  async function saveRound(round) {
    if (!selectedTournament) {
      setStatus('Odaberi turnir prije spremanja.', true);
      return;
    }

    var validationMessage = validateRound(round);
    if (validationMessage) {
      setStatus(validationMessage, true);
      return;
    }

    var batch = db.batch();
    var registrationIds = tournamentRegistrations.map(function (item) { return item.id; });

    registrationIds.forEach(function (registrationId) {
      var docRef = tableAssignmentsCollection.doc(getAssignmentDocId(round, registrationId));
      var assignment = assignmentsByRound[round][registrationId];

      if (assignment && assignment.tableNumber) {
        batch.set(docRef, {
          tournamentId: assignment.tournamentId,
          tournamentLabel: assignment.tournamentLabel,
          round: round,
          registrationId: assignment.registrationId,
          playerName: assignment.playerName,
          email: assignment.email,
          note: assignment.note,
          tableNumber: assignment.tableNumber,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      } else {
        batch.delete(docRef);
      }
    });

    try {
      await batch.commit();
      setStatus('Runda ' + round + ' je uspješno spremljena.', false);
    } catch (error) {
      console.error(error);
      setStatus('Spremanje runde ' + round + ' nije uspjelo.', true);
    }
  }

  function shuffle(items) {
    var copy = items.slice();
    for (var i = copy.length - 1; i > 0; i -= 1) {
      var j = Math.floor(Math.random() * (i + 1));
      var temp = copy[i];
      copy[i] = copy[j];
      copy[j] = temp;
    }
    return copy;
  }

  function generateRandomRound2() {
    if (!selectedTournament) {
      setStatus('Odaberi turnir prije nasumičnog rasporeda.', true);
      return;
    }

    if (!tournamentRegistrations.length) {
      setStatus('Nema prijavljenih igrača za rasporediti.', true);
      return;
    }

    assignmentsByRound[2] = {};
    shuffle(tournamentRegistrations).forEach(function (registration, index) {
      var tableNumber = Math.floor(index / PLAYERS_PER_TABLE) + 1;
      setAssignmentValue(2, registration, String(tableNumber));
    });

    renderRoundTable(2);
    renderSummary(2);
    setStatus('Nasumični raspored za rundu 2 je generiran. Po potrebi ga ručno prilagodi i spremi.', false);
  }

  function compareByTieBreak(a, b) {
    if (b.totalPoints !== a.totalPoints) {
      return b.totalPoints - a.totalPoints;
    }
    if (b.wins !== a.wins) {
      return b.wins - a.wins;
    }
    if (b.totalVp !== a.totalVp) {
      return b.totalVp - a.totalVp;
    }

    var aLastPlace = Number.isInteger(a.lastPlace) ? a.lastPlace : Number.MAX_SAFE_INTEGER;
    var bLastPlace = Number.isInteger(b.lastPlace) ? b.lastPlace : Number.MAX_SAFE_INTEGER;
    if (aLastPlace !== bLastPlace) {
      return aLastPlace - bLastPlace;
    }

    return getPlayerName(a.registration).localeCompare(getPlayerName(b.registration), 'hr', { sensitivity: 'base' });
  }

  function buildRound3OrderFromScores(roundScores) {
    var statsByRegistration = {};

    tournamentRegistrations.forEach(function (registration) {
      statsByRegistration[registration.id] = {
        registration: registration,
        totalPoints: 0,
        wins: 0,
        totalVp: 0,
        lastRound: 0,
        lastPlace: null
      };
    });

    roundScores.forEach(function (score) {
      if (score.round !== 1 && score.round !== 2) {
        return;
      }

      var registrationId = score.registrationId;
      if (!registrationId || !statsByRegistration[registrationId]) {
        return;
      }

      var stats = statsByRegistration[registrationId];
      var points = Number(score.roundPoints || 0);
      var vp = Number(score.vp || 0);
      var place = Number(score.place || 0);

      stats.totalPoints += points;
      stats.totalVp += vp;
      if (place === 1) {
        stats.wins += 1;
      }

      if (Number.isInteger(score.round) && score.round >= stats.lastRound) {
        stats.lastRound = score.round;
        stats.lastPlace = Number.isInteger(place) ? place : stats.lastPlace;
      }
    });

    return Object.values(statsByRegistration).sort(compareByTieBreak);
  }

  async function generateRound3ByStandings() {
    if (!selectedTournament) {
      setStatus('Odaberi turnir prije rasporeda runde 3.', true);
      return;
    }

    if (!tournamentRegistrations.length) {
      setStatus('Nema prijavljenih igrača za rasporediti.', true);
      return;
    }

    try {
      var roundScoresSnapshot = await roundScoresCollection
        .where('tournamentId', '==', selectedTournament.id)
        .get();

      var roundScores = roundScoresSnapshot.docs.map(function (doc) {
        return doc.data() || {};
      });

      var ordered = buildRound3OrderFromScores(roundScores);
      assignmentsByRound[3] = {};

      ordered.forEach(function (item, index) {
        var tableNumber = Math.floor(index / PLAYERS_PER_TABLE) + 1;
        setAssignmentValue(3, item.registration, String(tableNumber));
      });

      renderRoundTable(3);
      renderSummary(3);
      setStatus('Runda 3 je raspoređena prema trenutnom poretku nakon prve dvije runde.', false);
    } catch (error) {
      console.error(error);
      setStatus('Automatski raspored za rundu 3 nije uspio.', true);
    }
  }

  function exportRoundCsv(round) {
    if (!selectedTournament) {
      setStatus('Odaberi turnir prije exporta.', true);
      return;
    }

    if (!tournamentRegistrations.length) {
      setStatus('Nema prijavljenih igrača za export.', true);
      return;
    }

    var validationMessage = validateRound(round);
    if (validationMessage) {
      setStatus(validationMessage, true);
      return;
    }

    var rows = [];
    rows.push(['Ime i prezime', 'Napomena', 'Broj stola'].map(csvEscape).join(','));

    getRoundEntries(round)
      .slice()
      .sort(function (a, b) {
        var tableA = a.tableNumber == null ? Number.MAX_SAFE_INTEGER : a.tableNumber;
        var tableB = b.tableNumber == null ? Number.MAX_SAFE_INTEGER : b.tableNumber;
        if (tableA !== tableB) {
          return tableA - tableB;
        }
        return getPlayerName(a.registration).localeCompare(getPlayerName(b.registration), 'hr', { sensitivity: 'base' });
      })
      .forEach(function (entry) {
        rows.push([
          getPlayerName(entry.registration),
          entry.registration.note || '',
          entry.tableNumber == null ? '' : String(entry.tableNumber)
        ].map(csvEscape).join(','));
      });

    var csv = '\uFEFF' + rows.join('\n');
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = 'raspored-' + selectedTournament.id + '-runda-' + round + '.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    setStatus('CSV export za rundu ' + round + ' je pripremljen.', false);
  }

  function csvEscape(value) {
    var stringValue = String(value == null ? '' : value);
    return '"' + stringValue.replace(/"/g, '""') + '"';
  }

  async function loadAssignmentsForTournament(tournamentId) {
    assignmentsByRound[1] = {};
    assignmentsByRound[2] = {};
    assignmentsByRound[3] = {};

    if (!tournamentId) {
      tournamentRegistrations = [];
      selectedTournament = null;
      renderAllRounds();
      return;
    }

    selectedTournament = allTournaments.find(function (item) {
      return item.id === tournamentId;
    }) || null;

    try {
      var results = await Promise.all([
        registrationsCollection.where('tournamentId', '==', tournamentId).where('attended', '==', true).get(),
        tableAssignmentsCollection.where('tournamentId', '==', tournamentId).get()
      ]);

      tournamentRegistrations = results[0].docs.map(function (doc) {
        var data = doc.data() || {};
        data.id = doc.id;
        return data;
      });

      results[1].forEach(function (doc) {
        var data = doc.data() || {};
        if (!assignmentsByRound[data.round]) {
          return;
        }
        assignmentsByRound[data.round][data.registrationId] = {
          registrationId: data.registrationId,
          tournamentId: data.tournamentId,
          tournamentLabel: data.tournamentLabel,
          round: data.round,
          playerName: data.playerName,
          email: data.email,
          note: data.note,
          tableNumber: data.tableNumber
        };
      });

      renderAllRounds();

      if (!tournamentRegistrations.length) {
        setStatus('Za odabrani turnir nema prijavljenih igrača.', true);
      } else {
        setStatus('Učitano prijava: ' + tournamentRegistrations.length + '.', false);
      }
    } catch (error) {
      console.error(error);
      renderEmptyState('Ne mogu učitati prijave i raspored stolova.');
      setStatus('Dohvat prijava ili rasporeda nije uspio.', true);
    }
  }

  function initTabs() {
    var tabButtons = document.querySelectorAll('.bodovanje-tab');
    var tabPanels = document.querySelectorAll('.bodovanje-panel');

    function activateTab(button) {
      var targetId = button.getAttribute('data-tab-target');

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
    }

    tabButtons.forEach(function (button, index) {
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
    return true;
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
        renderEmptyState('Odaberi turnir za prikaz prijavljenih igrača.');
      })
      .catch(function (error) {
        console.error(error);
        renderTournamentOptions();
        renderEmptyState('Ne mogu učitati turnire.');
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
        loadTournaments();
        return;
      }

      if (tries >= FIREBASE_WAIT_TRIES) {
        clearInterval(timer);
        renderEmptyState('Firebase se nije učitao. Osvježi stranicu.');
        setStatus('Firebase se nije učitao. Osvježi stranicu.', true);
      }
    }, FIREBASE_WAIT_MS);
  }

  tournamentSelect.addEventListener('change', function () {
    loadAssignmentsForTournament(tournamentSelect.value);
  });

  roundViews[1].tableFilterSelect.addEventListener('change', function () {
    roundFilterSelections[1] = roundViews[1].tableFilterSelect.value;
    renderRoundTable(1);
  });

  roundViews[2].tableFilterSelect.addEventListener('change', function () {
    roundFilterSelections[2] = roundViews[2].tableFilterSelect.value;
    renderRoundTable(2);
  });

  roundViews[3].tableFilterSelect.addEventListener('change', function () {
    roundFilterSelections[3] = roundViews[3].tableFilterSelect.value;
    renderRoundTable(3);
  });

  roundViews[1].saveBtn.addEventListener('click', function () {
    saveRound(1);
  });
  roundViews[1].exportBtn.addEventListener('click', function () {
    exportRoundCsv(1);
  });
  roundViews[2].randomBtn.addEventListener('click', function () {
    generateRandomRound2();
  });
  roundViews[2].saveBtn.addEventListener('click', function () {
    saveRound(2);
  });
  roundViews[2].exportBtn.addEventListener('click', function () {
    exportRoundCsv(2);
  });
  roundViews[3].randomBtn.addEventListener('click', function () {
    generateRound3ByStandings();
  });
  roundViews[3].saveBtn.addEventListener('click', function () {
    saveRound(3);
  });
  roundViews[3].exportBtn.addEventListener('click', function () {
    exportRoundCsv(3);
  });

  // Tables Display Overlay
  var showTablesBtn = document.getElementById('showTablesBtn');
  var tablesDisplayOverlay = document.getElementById('tablesDisplayOverlay');
  var closeTablesBtn = document.getElementById('closeTablesBtn');
  var tablesDisplayGrid = document.getElementById('tablesDisplayGrid');
  var tablesRoundBtns = document.querySelectorAll('.tables-round-btn');
  var currentDisplayRound = 1;

  function renderTablesDisplay(round) {
    currentDisplayRound = round;
    tablesDisplayGrid.innerHTML = '';

    if (!selectedTournament) {
      tablesDisplayGrid.appendChild(createMessage('Odaberi turnir za prikaz stolova.'));
      return;
    }

    var summary = buildSummary(round);
    
    if (!summary.length) {
      tablesDisplayGrid.appendChild(createMessage('Za ovu rundu još nema upisanih stolova.'));
      return;
    }

    summary.forEach(function (item) {
      var card = document.createElement('div');
      card.className = 'table-display-card';

      var title = document.createElement('h2');
      title.textContent = 'Stol ' + item.tableNumber;
      card.appendChild(title);

      var playersList = document.createElement('ul');
      playersList.className = 'table-display-players';
      
      item.players.forEach(function (player) {
        var li = document.createElement('li');
        li.textContent = getPlayerName(player);
        playersList.appendChild(li);
      });

      card.appendChild(playersList);
      tablesDisplayGrid.appendChild(card);
    });
  }

  function showTablesOverlay() {
    if (!selectedTournament) {
      setStatus('Odaberi turnir prije prikaza stolova.', true);
      return;
    }

    renderTablesDisplay(currentDisplayRound);
    tablesDisplayOverlay.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function hideTablesOverlay() {
    tablesDisplayOverlay.hidden = true;
    document.body.style.overflow = '';
  }

  showTablesBtn.addEventListener('click', showTablesOverlay);
  closeTablesBtn.addEventListener('click', hideTablesOverlay);

  tablesRoundBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      var round = Number(btn.getAttribute('data-round'));
      
      tablesRoundBtns.forEach(function (b) {
        b.classList.remove('is-active');
      });
      btn.classList.add('is-active');
      
      renderTablesDisplay(round);
    });
  });

  tablesDisplayOverlay.addEventListener('click', function (event) {
    if (event.target === tablesDisplayOverlay) {
      hideTablesOverlay();
    }
  });

  waitForFirebaseAndInit();
})();
