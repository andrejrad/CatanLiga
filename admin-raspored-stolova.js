(function () {
  var FIREBASE_WAIT_TRIES = 80;
  var FIREBASE_WAIT_MS = 125;
  var PLAYERS_PER_TABLE = 4;

  function resolveProjectId() {
    if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length > 0) {
      var app = firebase.apps[0];
      if (app && app.options && typeof app.options.projectId === 'string' && app.options.projectId.trim()) {
        return app.options.projectId.trim();
      }
    }

    if (window.location && typeof window.location.hostname === 'string') {
      if (window.location.hostname.indexOf('catan-liga-staging') !== -1) {
        return 'catan-liga-staging';
      }
    }

    return 'catan-liga';
  }

  function isStagingProject() {
    return resolveProjectId() === 'catan-liga-staging';
  }

  var tournamentSelect = document.getElementById('tableTournamentSelect');
  var statusEl = document.getElementById('tablePlanStatus');

  var roundViews = {
    1: {
      listEl: document.getElementById('round1List'),
      summaryEl: document.getElementById('round1Summary'),
      saveBtn: document.getElementById('round1SaveBtn'),
      exportBtn: document.getElementById('round1ExportBtn'),
      tableFilterSelect: document.getElementById('round1TableFilter'),
      randomBtn: document.getElementById('round1RandomBtn')
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
  var roundTabButtons = {
    1: document.getElementById('tab-runda-1'),
    2: document.getElementById('tab-runda-2'),
    3: document.getElementById('tab-runda-3')
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

  function getRoundConflictWarnings(round, assignmentMap) {
    var warnings = [];
    var sourceAssignments = assignmentMap || assignmentsByRound[round] || {};

    if (round <= 1) {
      return warnings;
    }

    tournamentRegistrations.forEach(function (registration) {
      var assignment = sourceAssignments[registration.id] || null;
      var tableNumber = assignment && assignment.tableNumber;

      if (!Number.isInteger(tableNumber) || tableNumber <= 0) {
        return;
      }

      if (hasPlayedTableBeforeRound(registration.id, round, tableNumber)) {
        warnings.push('Igrač ' + getPlayerName(registration) + ' već je igrao za stolom ' + tableNumber + '.');
      }
    });

    return warnings;
  }

  function buildConflictConfirmationMessage(round, warnings, actionLabel) {
    var maxPreview = 8;
    var preview = warnings.slice(0, maxPreview);
    var lines = [
      'Pronađeni su konflikti u rasporedu za rundu ' + round + '.',
      ''
    ];

    preview.forEach(function (warning) {
      lines.push('- ' + warning);
    });

    if (warnings.length > maxPreview) {
      lines.push('- ... i još ' + (warnings.length - maxPreview) + ' konflikta.');
    }

    lines.push('');
    lines.push('Želiš li ipak ' + actionLabel + '?');
    return lines.join('\n');
  }

  function getRoundConflictCount(round) {
    return getRoundConflictWarnings(round).length;
  }

  function getRoundLabel(round) {
    var conflictCount = getRoundConflictCount(round);
    return conflictCount ? 'Runda ' + round + ' (' + conflictCount + ' konflikta)' : 'Runda ' + round;
  }

  function updateRoundLabels() {
    Object.keys(roundViews).forEach(function (key) {
      var round = Number(key);
      var label = getRoundLabel(round);
      var tabButton = roundTabButtons[round];

      if (tabButton) {
        tabButton.textContent = label;
      }
    });

    if (typeof tablesRoundBtns !== 'undefined' && tablesRoundBtns) {
      tablesRoundBtns.forEach(function (btn) {
        var round = Number(btn.getAttribute('data-round'));
        btn.textContent = getRoundLabel(round);
      });
    }
  }

  function getTableConflictWarning(round, registration, tableNumber) {
    if (round <= 1) {
      return '';
    }

    if (!Number.isInteger(tableNumber) || tableNumber <= 0) {
      return '';
    }

    if (!hasPlayedTableBeforeRound(registration.id, round, tableNumber)) {
      return '';
    }

    return 'Igrač je već igrao za stolom ' + tableNumber + ' u ranijoj rundi ovog turnira.';
  }

  function updateAssignmentConflictState(round, registration, row, tableCell, input) {
    var existingNote = tableCell.querySelector('.table-assignment-conflict-note');
    if (existingNote) {
      existingNote.remove();
    }

    row.classList.remove('table-assignment-conflict-row');
    input.classList.remove('table-assignment-conflict-input');
    input.removeAttribute('title');

    var tableNumber = Number(normalize(input.value));
    var warning = getTableConflictWarning(round, registration, tableNumber);
    if (!warning) {
      return;
    }

    row.classList.add('table-assignment-conflict-row');
    input.classList.add('table-assignment-conflict-input');
    input.title = warning;

    var note = document.createElement('div');
    note.className = 'table-assignment-conflict-note';
    note.textContent = warning;
    tableCell.appendChild(note);
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
        updateAssignmentConflictState(round, registration, row, tableTd, input);
        renderRoundFilter(round);
        renderSummary(round);
      });
      tableTd.appendChild(input);

      updateAssignmentConflictState(round, registration, row, tableTd, input);

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
    updateRoundLabels();
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

    var conflictWarnings = getRoundConflictWarnings(round);
    if (conflictWarnings.length) {
      var confirmedConflictSave = window.confirm(buildConflictConfirmationMessage(round, conflictWarnings, 'spremiti ovaj raspored'));
      if (!confirmedConflictSave) {
        setStatus('Spremanje runde ' + round + ' je otkazano zbog konflikta u rasporedu.', true);
        return;
      }
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
      if (conflictWarnings.length) {
        setStatus('Runda ' + round + ' je spremljena uz prihvaćen konflikt u rasporedu.', false);
      } else {
        setStatus('Runda ' + round + ' je uspješno spremljena.', false);
      }
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

  function getTableCount(playerCount) {
    return Math.ceil(playerCount / PLAYERS_PER_TABLE);
  }

  function buildTableCapacities(playerCount) {
    var capacities = {};
    var tableCount = getTableCount(playerCount);
    var remainder = playerCount % PLAYERS_PER_TABLE;

    for (var tableNumber = 1; tableNumber <= tableCount; tableNumber += 1) {
      capacities[tableNumber] = PLAYERS_PER_TABLE;
    }

    if (tableCount > 0 && remainder > 0) {
      capacities[tableCount] = remainder;
    }

    return capacities;
  }

  function getPlayedTablesBeforeRound(registrationId, round) {
    var playedTables = {};

    for (var currentRound = 1; currentRound < round; currentRound += 1) {
      var assignment = assignmentsByRound[currentRound][registrationId];
      if (assignment && Number.isInteger(assignment.tableNumber) && assignment.tableNumber > 0) {
        playedTables[assignment.tableNumber] = true;
      }
    }

    return playedTables;
  }

  function hasPlayedTableBeforeRound(registrationId, round, tableNumber) {
    return !!getPlayedTablesBeforeRound(registrationId, round)[tableNumber];
  }

  function getAvailableTablesForRegistration(registrationId, round, capacities) {
    var playedTables = getPlayedTablesBeforeRound(registrationId, round);

    return Object.keys(capacities)
      .map(function (key) { return Number(key); })
      .filter(function (tableNumber) {
        return capacities[tableNumber] > 0 && !playedTables[tableNumber];
      })
      .sort(function (a, b) { return a - b; });
  }

  function solvePlayerTableAssignments(players, round, capacities, assignments) {
    if (players.length === 0) {
      return true;
    }

    var rankedPlayers = players.slice().sort(function (a, b) {
      return a.availableTables.length - b.availableTables.length;
    });
    var nextPlayer = rankedPlayers[0];
    var remainingPlayers = rankedPlayers.slice(1);
    var candidateTables = shuffle(nextPlayer.availableTables).filter(function (tableNumber) {
      return capacities[tableNumber] > 0;
    });

    for (var i = 0; i < candidateTables.length; i += 1) {
      var tableNumber = candidateTables[i];
      assignments[nextPlayer.registration.id] = tableNumber;
      capacities[tableNumber] -= 1;

      var updatedPlayers = [];
      var isValid = true;

      for (var j = 0; j < remainingPlayers.length; j += 1) {
        var player = remainingPlayers[j];
        var nextAvailableTables = player.availableTables.filter(function (candidate) {
          return capacities[candidate] > 0;
        });

        if (!nextAvailableTables.length) {
          isValid = false;
          break;
        }

        updatedPlayers.push({
          registration: player.registration,
          availableTables: nextAvailableTables
        });
      }

      if (isValid && solvePlayerTableAssignments(updatedPlayers, round, capacities, assignments)) {
        return true;
      }

      capacities[tableNumber] += 1;
      delete assignments[nextPlayer.registration.id];
    }

    return false;
  }

  function buildRound2Assignments() {
    var capacities = buildTableCapacities(tournamentRegistrations.length);
    var players = shuffle(tournamentRegistrations).map(function (registration) {
      return {
        registration: registration,
        availableTables: getAvailableTablesForRegistration(registration.id, 2, capacities)
      };
    });
    var resolvedAssignments = {};

    if (!solvePlayerTableAssignments(players, 2, capacities, resolvedAssignments)) {
      return null;
    }

    return resolvedAssignments;
  }

  function getAllowedTablesForGroup(group, round, tableCount) {
    var allowed = [];

    for (var tableNumber = 1; tableNumber <= tableCount; tableNumber += 1) {
      var allAllowed = group.every(function (item) {
        return !hasPlayedTableBeforeRound(item.registration.id, round, tableNumber);
      });

      if (allAllowed) {
        allowed.push(tableNumber);
      }
    }

    return allowed;
  }

  function solveGroupTableAssignments(groups, tableNumbers, assignments) {
    if (groups.length === 0) {
      return true;
    }

    var rankedGroups = groups.slice().sort(function (a, b) {
      return a.allowedTables.length - b.allowedTables.length;
    });
    var nextGroup = rankedGroups[0];
    var remainingGroups = rankedGroups.slice(1);
    var candidateTables = shuffle(nextGroup.allowedTables).filter(function (tableNumber) {
      return tableNumbers.indexOf(tableNumber) !== -1;
    });

    for (var i = 0; i < candidateTables.length; i += 1) {
      var tableNumber = candidateTables[i];
      assignments[nextGroup.groupIndex] = tableNumber;

      var remainingTableNumbers = tableNumbers.filter(function (candidate) {
        return candidate !== tableNumber;
      });
      var updatedGroups = [];
      var isValid = true;

      for (var j = 0; j < remainingGroups.length; j += 1) {
        var group = remainingGroups[j];
        var nextAllowedTables = group.allowedTables.filter(function (candidate) {
          return candidate !== tableNumber;
        });

        if (!nextAllowedTables.length) {
          isValid = false;
          break;
        }

        updatedGroups.push({
          groupIndex: group.groupIndex,
          players: group.players,
          allowedTables: nextAllowedTables
        });
      }

      if (isValid && solveGroupTableAssignments(updatedGroups, remainingTableNumbers, assignments)) {
        return true;
      }

      delete assignments[nextGroup.groupIndex];
    }

    return false;
  }

  function buildRound3Assignments(ordered) {
    var tableCount = getTableCount(ordered.length);
    var tableNumbers = [];
    var groups = [];

    for (var tableNumber = 1; tableNumber <= tableCount; tableNumber += 1) {
      tableNumbers.push(tableNumber);
    }

    for (var index = 0; index < ordered.length; index += PLAYERS_PER_TABLE) {
      var players = ordered.slice(index, index + PLAYERS_PER_TABLE);
      groups.push({
        groupIndex: groups.length,
        players: players,
        allowedTables: getAllowedTablesForGroup(players, 3, tableCount)
      });
    }

    var groupAssignments = {};
    if (!solveGroupTableAssignments(groups, tableNumbers, groupAssignments)) {
      return null;
    }

    var resolvedAssignments = {};
    groups.forEach(function (group) {
      var assignedTable = groupAssignments[group.groupIndex];
      group.players.forEach(function (item) {
        resolvedAssignments[item.registration.id] = assignedTable;
      });
    });

    return resolvedAssignments;
  }

  function buildSequentialAssignments(ordered) {
    var resolvedAssignments = {};

    ordered.forEach(function (item, index) {
      resolvedAssignments[item.registration.id] = Math.floor(index / PLAYERS_PER_TABLE) + 1;
    });

    return resolvedAssignments;
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

    var round2Assignments = buildRound2Assignments();
    if (!round2Assignments) {
      setStatus('Ne mogu generirati rundu 2 bez ponavljanja stola po igraču. Provjeri raspored prve runde.', true);
      return;
    }

    assignmentsByRound[2] = {};
    tournamentRegistrations.forEach(function (registration) {
      var tableNumber = round2Assignments[registration.id];
      setAssignmentValue(2, registration, String(tableNumber));
    });

    renderRoundTable(2);
    renderSummary(2);
    setStatus('Nasumični raspored za rundu 2 je generiran bez ponavljanja stola po igraču. Po potrebi ga ručno prilagodi i spremi.', false);
  }

  function generateRandomRound1() {
    if (!isStagingProject()) {
      setStatus('Random raspored za rundu 1 dostupan je samo na stagingu.', true);
      return;
    }

    if (!selectedTournament) {
      setStatus('Odaberi turnir prije random rasporeda.', true);
      return;
    }

    if (!tournamentRegistrations.length) {
      setStatus('Nema prijavljenih igrača za rasporediti.', true);
      return;
    }

    var ordered = shuffle(tournamentRegistrations).map(function (registration) {
      return { registration: registration };
    });
    var resolvedAssignments = buildSequentialAssignments(ordered);

    assignmentsByRound[1] = {};
    tournamentRegistrations.forEach(function (registration) {
      var tableNumber = resolvedAssignments[registration.id];
      setAssignmentValue(1, registration, String(tableNumber));
    });

    renderRoundTable(1);
    renderSummary(1);
    setStatus('Random raspored za rundu 1 je generiran. Po potrebi ga ručno prilagodi i spremi.', false);
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
      var round3Assignments = buildRound3Assignments(ordered);
      if (!round3Assignments) {
        var fallbackAssignments = buildSequentialAssignments(ordered);
        var fallbackAssignmentData = {};

        ordered.forEach(function (item) {
          fallbackAssignmentData[item.registration.id] = {
            tableNumber: fallbackAssignments[item.registration.id]
          };
        });

        var fallbackWarnings = getRoundConflictWarnings(3, fallbackAssignmentData);
        var confirmedConflict = window.confirm(buildConflictConfirmationMessage(3, fallbackWarnings, 'prihvatiti konflikt i generirati ovaj raspored'));
        if (!confirmedConflict) {
          setStatus('Generiranje runde 3 je otkazano jer raspored bez konflikta nije pronađen.', true);
          return;
        }

        round3Assignments = fallbackAssignments;
      }

      assignmentsByRound[3] = {};

      ordered.forEach(function (item) {
        setAssignmentValue(3, item.registration, String(round3Assignments[item.registration.id]));
      });

      renderRoundTable(3);
      renderSummary(3);
      if (getRoundConflictWarnings(3).length) {
        setStatus('Runda 3 je raspoređena prema trenutnom poretku uz prihvaćen konflikt u rasporedu.', false);
      } else {
        setStatus('Runda 3 je raspoređena prema trenutnom poretku bez ponavljanja stola po igraču.', false);
      }
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

    if (roundViews[1].randomBtn) {
      roundViews[1].randomBtn.hidden = !isStagingProject();
    }

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
        loadShowPublicSetting();
        return;
      }

      if (tries >= FIREBASE_WAIT_TRIES) {
        clearInterval(timer);
        renderEmptyState('Firebase se nije učitao. Osvježi stranicu.');
        setStatus('Firebase se nije učitao. Osvježi stranicu.', true);
      }
    }, FIREBASE_WAIT_MS);
  }

  var showPublicToggle = document.getElementById('showPublicToggle');
  var showPublicStatusEl = document.getElementById('showPublicStatus');

  function loadShowPublicSetting() {
    if (!db || !showPublicToggle) return;
    db.collection('adminSettings').doc('tableSchedule').get()
      .then(function (docSnap) {
        if (docSnap.exists) {
          showPublicToggle.checked = docSnap.data().showPublicButton === true;
        } else {
          showPublicToggle.checked = false;
        }
      })
      .catch(function (err) {
        console.error('Greška čitanja postavke:', err);
      });
  }

  if (showPublicToggle) {
    showPublicToggle.addEventListener('change', function () {
      if (!db) return;
      var isOn = showPublicToggle.checked;
      showPublicStatusEl.textContent = 'Spremanje...';
      showPublicStatusEl.style.color = '';
      db.collection('adminSettings').doc('tableSchedule').set({
        showPublicButton: isOn
      }).then(function () {
        showPublicStatusEl.textContent = isOn ? 'Gumb je vidljiv igračima.' : 'Gumb je skriven igračima.';
        showPublicStatusEl.style.color = '';
      }).catch(function (err) {
        showPublicStatusEl.textContent = 'Greška: ' + err.message;
        showPublicStatusEl.style.color = '#ff6b6b';
        showPublicToggle.checked = !isOn;
      });
    });
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

  roundViews[1].randomBtn.addEventListener('click', function () {
    generateRandomRound1();
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
