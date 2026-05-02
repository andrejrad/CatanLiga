(function () {
  var FIREBASE_WAIT_TRIES = 80;
  var FIREBASE_WAIT_MS = 125;

  var listEl = document.getElementById('igraciList');
  var statusEl = document.getElementById('igraciStatus');
  var searchInput = document.getElementById('igraciSearch');
  var editModal = document.getElementById('editPlayerModal');
  var deleteModal = document.getElementById('deleteConfirmModal');
  var editFirstNameInput = document.getElementById('editPlayerFirstName');
  var editLastNameInput = document.getElementById('editPlayerLastName');
  var editCancelBtn = document.getElementById('editPlayerCancel');
  var editSaveBtn = document.getElementById('editPlayerSave');
  var deleteCancelBtn = document.getElementById('deleteConfirmCancel');
  var deleteYesBtn = document.getElementById('deleteConfirmYes');
  var deleteConfirmMessage = document.getElementById('deleteConfirmMessage');
  var statsModal = document.getElementById('playerStatsModal');
  var statsNameEl = document.getElementById('playerStatsName');
  var statsSummaryEl = document.getElementById('playerStatsSummary');
  var statsTableWrapEl = document.getElementById('playerStatsTableWrap');
  var statsCloseBtn = document.getElementById('playerStatsClose');

  if (!listEl || !statusEl || !searchInput) {
    return;
  }

  var allPlayers = [];
  var allRegistrations = [];
  var allScores = [];
  var allTournaments = [];
  var registrationsById = {};
  var bonusByPlace = {};
  var scoreCoefficient = 0.5;
  var sortState = {
    key: 'lastName',
    direction: 'asc'
  };
  var statsLoadState = {
    scores: false,
    tournaments: false,
    rules: false,
    config: false
  };
  var currentEditingEmail = null;
  var currentDeleteEmail = null;
  var deleteConfirmationStep = 0;
  var db = null;

  function createMessage(text) {
    var p = document.createElement('p');
    p.className = 'admin-note';
    p.textContent = text;
    return p;
  }

  function normalize(value) {
    return (value || '').toLowerCase().trim();
  }

  function formatPoints(value) {
    return Number(value || 0).toFixed(2).replace(/\.00$/, '');
  }

  function getPlayerDisplayName(player) {
    return ((player.firstName || '') + ' ' + (player.lastName || '')).trim() || player.email || 'Nepoznati igrač';
  }

  function createStatsPill(label, value) {
    var box = document.createElement('div');
    box.className = 'player-stats-pill';

    var labelEl = document.createElement('span');
    labelEl.className = 'player-stats-pill-label';
    labelEl.textContent = label;

    var valueEl = document.createElement('strong');
    valueEl.className = 'player-stats-pill-value';
    valueEl.textContent = value;

    box.appendChild(labelEl);
    box.appendChild(valueEl);
    return box;
  }

  function getComputedPoints(score) {
    if (typeof score.roundPoints === 'number') {
      return score.roundPoints;
    }

    if (Number.isInteger(score.vp) && Number.isInteger(score.place)) {
      var bonus = bonusByPlace[score.place] == null ? 0 : bonusByPlace[score.place];
      return Number((score.vp * scoreCoefficient + bonus).toFixed(2));
    }

    return 0;
  }

  function getScorePlayerKey(score) {
    var registration = registrationsById[score.registrationId] || null;
    var email = normalize(registration ? registration.email : '');
    return email || ('registration:' + (score.registrationId || score.id || 'unknown'));
  }

  function getScorePlayerName(score) {
    var registration = registrationsById[score.registrationId] || null;
    if (registration) {
      var name = ((registration.firstName || '') + ' ' + (registration.lastName || '')).trim();
      if (name) {
        return name;
      }
      if (registration.email) {
        return registration.email;
      }
    }
    return score.playerName || 'Nepoznati igrač';
  }

  function getRegistrationCreatedAtMs(registration) {
    if (!registration || !registration.createdAt) {
      return Number.MAX_SAFE_INTEGER;
    }

    var createdAt = registration.createdAt;
    if (typeof createdAt.toDate === 'function') {
      var dt = createdAt.toDate();
      var ts = dt && typeof dt.getTime === 'function' ? dt.getTime() : NaN;
      return Number.isFinite(ts) ? ts : Number.MAX_SAFE_INTEGER;
    }

    var parsed = new Date(createdAt).getTime();
    return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
  }

  function buildTournamentTieBreakContext(scoresForTournament) {
    var tableVpTotals = {};
    var ratioSums = {};

    scoresForTournament.forEach(function (score) {
      var round = Number(score.round || 0);
      var tableNumber = Number(score.tableNumber || 0);
      if (!round || !tableNumber || !Number.isInteger(score.vp)) {
        return;
      }

      var tableKey = round + '__' + tableNumber;
      tableVpTotals[tableKey] = (tableVpTotals[tableKey] || 0) + score.vp;
    });

    scoresForTournament.forEach(function (score) {
      var round = Number(score.round || 0);
      var tableNumber = Number(score.tableNumber || 0);
      if (!round || !tableNumber || !Number.isInteger(score.vp)) {
        return;
      }

      var key = getScorePlayerKey(score);
      var tableKey = round + '__' + tableNumber;
      var tableTotal = Number(tableVpTotals[tableKey] || 0);
      if (tableTotal <= 0) {
        return;
      }

      var ratio = score.vp / tableTotal;
      if (!ratioSums[key]) {
        ratioSums[key] = {};
      }
      if (!ratioSums[key][round]) {
        ratioSums[key][round] = { sum: 0, count: 0 };
      }

      ratioSums[key][round].sum += ratio;
      ratioSums[key][round].count += 1;
    });

    var ratioAverages = {};
    Object.keys(ratioSums).forEach(function (key) {
      ratioAverages[key] = {};
      [1, 2, 3].forEach(function (round) {
        var cell = ratioSums[key][round];
        ratioAverages[key][round] = cell && cell.count > 0 ? (cell.sum / cell.count) : null;
      });
    });

    return ratioAverages;
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

    var rounds = [3, 2, 1];
    for (var i = 0; i < rounds.length; i += 1) {
      var round = rounds[i];
      var aRatio = typeof a.roundVpRatioByRound[round] === 'number' ? a.roundVpRatioByRound[round] : -1;
      var bRatio = typeof b.roundVpRatioByRound[round] === 'number' ? b.roundVpRatioByRound[round] : -1;

      if (aRatio !== bRatio) {
        return bRatio - aRatio;
      }
    }

    if (a.registrationCreatedAtMs !== b.registrationCreatedAtMs) {
      return a.registrationCreatedAtMs - b.registrationCreatedAtMs;
    }

    return a.playerName.localeCompare(b.playerName, 'hr', { sensitivity: 'base' });
  }

  function aggregateTournament(scoresForTournament) {
    var totals = {};
    var tieBreakRatios = buildTournamentTieBreakContext(scoresForTournament);

    scoresForTournament.forEach(function (score) {
      var key = getScorePlayerKey(score);
      var registration = registrationsById[score.registrationId] || null;
      if (!totals[key]) {
        totals[key] = {
          key: key,
          playerName: getScorePlayerName(score),
          totalPoints: 0,
          wins: 0,
          totalVp: 0,
          lastPlace: null,
          lastRound: -1,
          registrationCreatedAtMs: getRegistrationCreatedAtMs(registration),
          roundVpRatioByRound: tieBreakRatios[key] || { 1: null, 2: null, 3: null }
        };
      }

      var round = Number(score.round || 0);
      var place = score.place;

      totals[key].totalPoints += getComputedPoints(score);
      if (place === 1) {
        totals[key].wins += 1;
      }
      if (Number.isInteger(score.vp)) {
        totals[key].totalVp += score.vp;
      }
      if (round >= totals[key].lastRound && Number.isInteger(place)) {
        totals[key].lastRound = round;
        totals[key].lastPlace = place;
      }
    });

    return Object.keys(totals)
      .map(function (key) { return totals[key]; })
      .sort(compareByTieBreak);
  }

  function formatTournamentLabel(tournament) {
    if (!tournament) {
      return 'Nepoznati turnir';
    }
    var date = tournament.date || '';
    var time = tournament.time || '';
    var venue = tournament.venueName || '';

    if (!date && !time && !venue) {
      return 'Nepoznati turnir';
    }

    return 'Kolo ' + (tournament.round || '-') + ' - ' + date + ' ' + time + (venue ? ' - ' + venue : '');
  }

  function getTournamentSortValue(tournamentId) {
    var tournament = allTournaments.find(function (item) {
      return item.id === tournamentId;
    });

    if (!tournament || !tournament.date || !tournament.time) {
      return 0;
    }

    var dateTime = new Date(tournament.date + 'T' + tournament.time);
    if (isNaN(dateTime.getTime())) {
      return 0;
    }

    return dateTime.getTime();
  }

  function isStatsReady() {
    return statsLoadState.scores && statsLoadState.tournaments && statsLoadState.rules && statsLoadState.config;
  }

  function openStatsModal(player) {
    if (!statsModal || !statsNameEl || !statsSummaryEl || !statsTableWrapEl) {
      return;
    }

    var playerName = getPlayerDisplayName(player);
    statsNameEl.textContent = 'Statistika: ' + playerName;
    statsSummaryEl.innerHTML = '';
    statsTableWrapEl.innerHTML = '';

    if (!isStatsReady()) {
      statsTableWrapEl.appendChild(createMessage('Statistika se još učitava. Pokušaj ponovno za nekoliko sekundi.'));
      statsModal.style.display = 'flex';
      return;
    }

    var playerKey = normalize(player.email);
    var scoresByTournament = {};

    allScores.forEach(function (score) {
      if (getScorePlayerKey(score) !== playerKey) {
        return;
      }

      var tournamentId = score.tournamentId || 'unknown';
      if (!scoresByTournament[tournamentId]) {
        scoresByTournament[tournamentId] = true;
      }
    });

    var tournamentIds = Object.keys(scoresByTournament);
    var rows = tournamentIds
      .map(function (tournamentId) {
        var tournamentScores = allScores.filter(function (score) {
          return score.tournamentId === tournamentId;
        });

        var playerTournamentScores = allScores
          .filter(function (score) {
            return score.tournamentId === tournamentId && getScorePlayerKey(score) === playerKey;
          })
          .sort(function (a, b) {
            return (a.round || 0) - (b.round || 0);
          });

        var ranking = aggregateTournament(tournamentScores);
        var playerIndex = ranking.findIndex(function (item) {
          return item.key === playerKey;
        });

        if (playerIndex === -1) {
          return null;
        }

        var tournament = allTournaments.find(function (item) {
          return item.id === tournamentId;
        }) || null;

        return {
          tournamentId: tournamentId,
          tournamentLabel: formatTournamentLabel(tournament),
          place: playerIndex + 1,
          totalPoints: ranking[playerIndex].totalPoints,
          roundDetails: playerTournamentScores.map(function (score) {
            return {
              round: score.round || '-',
              place: Number.isInteger(score.place) ? score.place : '-',
              points: getComputedPoints(score)
            };
          }),
          sortValue: getTournamentSortValue(tournamentId)
        };
      })
      .filter(function (item) {
        return !!item;
      })
      .sort(function (a, b) {
        return a.sortValue - b.sortValue;
      });

    var totalTournaments = rows.length;
    var totalPoints = rows.reduce(function (sum, item) {
      return sum + item.totalPoints;
    }, 0);

    statsSummaryEl.appendChild(createStatsPill('Ukupno odigranih turnira', String(totalTournaments)));
    statsSummaryEl.appendChild(createStatsPill('Ukupno osvojenih bodova', formatPoints(totalPoints)));

    if (!rows.length) {
      statsTableWrapEl.appendChild(createMessage('Igrač još nema evidentirane rezultate turnira.'));
      statsModal.style.display = 'flex';
      return;
    }

    var tableWrap = document.createElement('div');
    tableWrap.className = 'tournament-table-wrap';

    var table = document.createElement('table');
    table.className = 'tournament-table';

    var thead = document.createElement('thead');
    var headRow = document.createElement('tr');
    ['Turnir', 'Mjesto', 'Bodovi'].forEach(function (label) {
      var th = document.createElement('th');
      th.textContent = label;
      if (label === 'Turnir') {
        th.className = 'player-stats-col-tournament';
      }
      if (label === 'Mjesto') {
        th.className = 'player-stats-col-place';
      }
      if (label === 'Bodovi') {
        th.className = 'player-stats-col-points';
      }
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);

    var tbody = document.createElement('tbody');
    rows.forEach(function (item) {
      var row = document.createElement('tr');

      var tdTournament = document.createElement('td');
      tdTournament.className = 'player-stats-col-tournament';
      tdTournament.textContent = item.tournamentLabel;

      var tdPlace = document.createElement('td');
      tdPlace.className = 'player-stats-col-place';
      tdPlace.textContent = String(item.place) + '.';

      var tdPoints = document.createElement('td');
      tdPoints.className = 'player-stats-col-points';
      tdPoints.textContent = formatPoints(item.totalPoints);

      row.appendChild(tdTournament);
      row.appendChild(tdPlace);
      row.appendChild(tdPoints);
      tbody.appendChild(row);

      var detailRow = document.createElement('tr');
      detailRow.className = 'player-stats-round-row';

      var detailTd = document.createElement('td');
      detailTd.colSpan = 3;

      if (item.roundDetails.length) {
        item.roundDetails.forEach(function (detail) {
          var line = document.createElement('div');
          line.textContent = 'Runda ' + detail.round + ': mjesto ' + detail.place + ', bodovi ' + formatPoints(detail.points);
          detailTd.appendChild(line);
        });
      } else {
        detailTd.textContent = 'Nema podataka po rundama.';
      }

      detailTd.style.fontSize = '0.78rem';
      detailTd.style.color = '#f3d9b1';
      detailTd.style.background = 'rgba(30, 14, 6, 0.45)';

      detailRow.appendChild(detailTd);
      tbody.appendChild(detailRow);
    });

    table.appendChild(thead);
    table.appendChild(tbody);
    tableWrap.appendChild(table);
    statsTableWrapEl.appendChild(tableWrap);

    statsModal.style.display = 'flex';
  }

  function closeStatsModal() {
    if (!statsModal) {
      return;
    }
    statsModal.style.display = 'none';
  }

  function renderPlayers() {
    var query = normalize(searchInput.value);

    var filtered = query
      ? allPlayers.filter(function (player) {
          return (
            normalize(player.firstName).indexOf(query) !== -1 ||
            normalize(player.lastName).indexOf(query) !== -1 ||
            normalize(player.email).indexOf(query) !== -1
          );
        })
      : allPlayers;

    filtered = filtered.slice().sort(function (a, b) {
      if (sortState.key === 'registrationCount') {
        var countCmp = (a.registrationCount || 0) - (b.registrationCount || 0);
        if (countCmp === 0) {
          countCmp = a.lastName.localeCompare(b.lastName, 'hr', { sensitivity: 'base' });
          if (countCmp === 0) {
            countCmp = a.firstName.localeCompare(b.firstName, 'hr', { sensitivity: 'base' });
          }
        }
        return sortState.direction === 'asc' ? countCmp : -countCmp;
      }

      var fieldA = (a[sortState.key] || '').toString();
      var fieldB = (b[sortState.key] || '').toString();
      var textCmp = fieldA.localeCompare(fieldB, 'hr', { sensitivity: 'base' });
      if (textCmp === 0) {
        textCmp = (a.registrationCount || 0) - (b.registrationCount || 0);
      }

      return sortState.direction === 'asc' ? textCmp : -textCmp;
    });

    listEl.innerHTML = '';

    if (filtered.length === 0) {
      listEl.appendChild(createMessage('Nema igrača za zadanu pretragu.'));
      statusEl.textContent = '';
      return;
    }

    statusEl.textContent = 'Prikazano: ' + filtered.length + ' igrač' + (filtered.length === 1 ? '' : filtered.length < 5 ? 'a' : 'a');

    var tableWrap = document.createElement('div');
    tableWrap.className = 'tournament-table-wrap';

    var table = document.createElement('table');
    table.className = 'tournament-table';

    var thead = document.createElement('thead');
    var headRow = document.createElement('tr');

    function getSortArrow(key) {
      if (sortState.key !== key) {
        return '';
      }
      return sortState.direction === 'asc' ? ' ▲' : ' ▼';
    }

    function createHeader(label, sortKey) {
      var th = document.createElement('th');
      if (!sortKey) {
        th.textContent = label;
        return th;
      }

      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'nav-btn';
      btn.style.fontSize = '0.82rem';
      btn.style.fontWeight = '700';
      btn.style.letterSpacing = '0.02em';
      btn.style.textAlign = 'left';
      btn.style.textShadow = 'none';
      btn.textContent = label + getSortArrow(sortKey);
      btn.setAttribute('aria-label', 'Sortiraj po ' + label);
      btn.addEventListener('click', function () {
        if (sortState.key === sortKey) {
          sortState.direction = sortState.direction === 'asc' ? 'desc' : 'asc';
        } else {
          sortState.key = sortKey;
          sortState.direction = 'asc';
        }
        renderPlayers();
      });

      th.appendChild(btn);
      return th;
    }

    [
      createHeader('Ime', 'firstName'),
      createHeader('Prezime', 'lastName'),
      createHeader('Email', ''),
      createHeader('Prijava', 'registrationCount'),
      createHeader('Akcije', '')
    ].forEach(function (th) {
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);

    var tbody = document.createElement('tbody');

    filtered.forEach(function (player) {
      var row = document.createElement('tr');
      row.className = 'player-row-clickable';
      row.title = 'Klikni za statistiku igrača';
      row.tabIndex = 0;
      row.addEventListener('click', function (event) {
        if (event.target && event.target.closest && event.target.closest('button')) {
          return;
        }
        openStatsModal(player);
      });
      row.addEventListener('keydown', function (event) {
        if (event.target !== row) {
          return;
        }
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openStatsModal(player);
        }
      });

      var tdFirst = document.createElement('td');
      tdFirst.textContent = player.firstName;

      var tdLast = document.createElement('td');
      tdLast.textContent = player.lastName;

      var tdEmail = document.createElement('td');
      tdEmail.textContent = player.email;
      tdEmail.style.wordBreak = 'break-all';

      var tdCount = document.createElement('td');
      tdCount.textContent = player.registrationCount;
      tdCount.style.textAlign = 'center';

      var tdActions = document.createElement('td');
      tdActions.style.textAlign = 'center';
      tdActions.style.whiteSpace = 'nowrap';

      var statsBtn = document.createElement('button');
      statsBtn.className = 'btn-icon';
      statsBtn.title = 'Prikaži statistiku';
      statsBtn.setAttribute('aria-label', 'Prikaži statistiku igrača');
      statsBtn.innerHTML =
        '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false" style="display:block; margin:auto;" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
        + '<line x1="5" y1="20" x2="5" y2="10"></line>'
        + '<line x1="12" y1="20" x2="12" y2="4"></line>'
        + '<line x1="19" y1="20" x2="19" y2="13"></line>'
        + '</svg>';
      statsBtn.style.marginRight = '8px';
      statsBtn.addEventListener('click', function () {
        openStatsModal(player);
      });

      var editBtn = document.createElement('button');
      editBtn.className = 'btn-icon';
      editBtn.title = 'Uredi igrača';
      editBtn.innerHTML = '✎'; // Pencil icon
      editBtn.style.marginRight = '8px';
      editBtn.addEventListener('click', function () {
        openEditModal(player);
      });

      var deleteBtn = document.createElement('button');
      deleteBtn.className = 'btn-icon';
      deleteBtn.title = 'Obriši igrača';
      deleteBtn.innerHTML = '🗑'; // Trash icon
      deleteBtn.style.color = '#d9534f';
      deleteBtn.addEventListener('click', function () {
        openDeleteConfirm(player);
      });

      tdActions.appendChild(statsBtn);
      tdActions.appendChild(editBtn);
      tdActions.appendChild(deleteBtn);

      row.appendChild(tdFirst);
      row.appendChild(tdLast);
      row.appendChild(tdEmail);
      row.appendChild(tdCount);
      row.appendChild(tdActions);
      tbody.appendChild(row);
    });

    table.appendChild(thead);
    table.appendChild(tbody);
    tableWrap.appendChild(table);
    listEl.appendChild(tableWrap);
  }

  function buildPlayerList(registrations) {
    var map = {};

    registrations.forEach(function (reg) {
      var email = (reg.email || '').toLowerCase().trim();
      if (!email) return;

      if (!map[email]) {
        map[email] = {
          firstName: reg.firstName || '',
          lastName: reg.lastName || '',
          email: email,
          registrationCount: 0,
          registrationIds: []
        };
      }
      map[email].registrationCount++;
      map[email].registrationIds.push(reg.id);
    });

    return Object.values(map).sort(function (a, b) {
      var lastCmp = a.lastName.localeCompare(b.lastName, 'hr', { sensitivity: 'base' });
      if (lastCmp !== 0) return lastCmp;
      return a.firstName.localeCompare(b.firstName, 'hr', { sensitivity: 'base' });
    });
  }

  function openEditModal(player) {
    currentEditingEmail = player.email;
    editFirstNameInput.value = player.firstName;
    editLastNameInput.value = player.lastName;
    editModal.style.display = 'flex';
    editFirstNameInput.focus();
  }

  function closeEditModal() {
    editModal.style.display = 'none';
    currentEditingEmail = null;
  }

  function savePlayerEdit() {
    if (!currentEditingEmail) return;

    var firstName = editFirstNameInput.value.trim();
    var lastName = editLastNameInput.value.trim();

    if (!firstName || !lastName) {
      alert('Ime i prezime su obavezni.');
      return;
    }

    var playerToEdit = allPlayers.find(function (p) {
      return p.email === currentEditingEmail;
    });

    if (!playerToEdit) return;

    var registrationIds = playerToEdit.registrationIds || [];

    var batch = db.batch();
    registrationIds.forEach(function (regId) {
      var regRef = db.collection('registrations').doc(regId);
      batch.update(regRef, {
        firstName: firstName,
        lastName: lastName,
        updatedAt: new Date()
      });
    });

    batch
      .commit()
      .then(function () {
        closeEditModal();
        alert('Igrač ažuriran.');
      })
      .catch(function (error) {
        console.error('Greška pri ažuriranju:', error);
        alert('Greška pri ažuriranju igrača.');
      });
  }

  function openDeleteConfirm(player) {
    currentDeleteEmail = player.email;
    deleteConfirmationStep = 0;
    showDeleteConfirmStep1(player);
  }

  function showDeleteConfirmStep1(player) {
    deleteConfirmationStep = 1;
    deleteConfirmMessage.textContent =
      'Jeste li sigurni da želite izbrisati ovog igrača (' +
      player.firstName +
      ' ' +
      player.lastName +
      ')? Ova akcija će izbrisati sve bodove i cijeli histori vezani uz ovog igrača.';
    deleteYesBtn.textContent = 'Obriši';
    deleteModal.style.display = 'flex';
  }

  function showDeleteConfirmStep2(player) {
    deleteConfirmationStep = 2;
    deleteConfirmMessage.textContent =
      'Jeste li SIGURNI? Ova akcija se ne može vratiti. Bit će izbrisani svi bodovi i histori od ' +
      player.firstName +
      ' ' +
      player.lastName +
      ' sa svih turnira i rundi.';
    deleteYesBtn.textContent = 'DA, OBRIŠI';
  }

  function closeDeleteConfirm() {
    deleteModal.style.display = 'none';
    currentDeleteEmail = null;
    deleteConfirmationStep = 0;
  }

  function performDelete() {
    if (!currentDeleteEmail) return;

    var playerToDelete = allPlayers.find(function (p) {
      return p.email === currentDeleteEmail;
    });

    if (!playerToDelete) return;

    var registrationIds = playerToDelete.registrationIds || [];

    var batch = db.batch();

    // Delete all registrations for this player
    registrationIds.forEach(function (regId) {
      var regRef = db.collection('registrations').doc(regId);
      batch.delete(regRef);
    });

    // Delete all scores for this player
    db.collection('adminRoundScores')
      .where('registrationId', 'in', registrationIds)
      .get()
      .then(function (snapshot) {
        snapshot.docs.forEach(function (doc) {
          batch.delete(doc.ref);
        });

        // Delete all table assignments for this player
        return db.collection('adminTableAssignments').where('registrationId', 'in', registrationIds).get();
      })
      .then(function (snapshot) {
        snapshot.docs.forEach(function (doc) {
          batch.delete(doc.ref);
        });

        return batch.commit();
      })
      .then(function () {
        closeDeleteConfirm();
        alert('Igrač i svi njegovi podaci su izbrisani.');
      })
      .catch(function (error) {
        console.error('Greška pri brisanju:', error);
        alert('Greška pri brisanju igrača.');
      });
  }

  function waitForFirebase(tries, callback) {
    if (tries <= 0) {
      listEl.innerHTML = '';
      listEl.appendChild(createMessage('Firebase nije dostupan. Osvježi stranicu.'));
      return;
    }
    if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length > 0) {
      callback();
    } else {
      setTimeout(function () {
        waitForFirebase(tries - 1, callback);
      }, FIREBASE_WAIT_MS);
    }
  }

  // Event listeners for modal
  editCancelBtn.addEventListener('click', closeEditModal);
  editSaveBtn.addEventListener('click', savePlayerEdit);
  deleteCancelBtn.addEventListener('click', closeDeleteConfirm);
  if (statsCloseBtn) {
    statsCloseBtn.addEventListener('click', closeStatsModal);
  }
  if (statsModal) {
    statsModal.addEventListener('click', function (event) {
      if (event.target === statsModal) {
        closeStatsModal();
      }
    });
  }
  deleteYesBtn.addEventListener('click', function () {
    if (deleteConfirmationStep === 1) {
      var player = allPlayers.find(function (p) {
        return p.email === currentDeleteEmail;
      });
      if (player) {
        showDeleteConfirmStep2(player);
      }
    } else if (deleteConfirmationStep === 2) {
      performDelete();
    }
  });

  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      closeEditModal();
      closeDeleteConfirm();
      closeStatsModal();
    }
  });

  waitForFirebase(FIREBASE_WAIT_TRIES, function () {
    db = firebase.firestore();
    var registrationsCollection = db.collection('registrations');

    registrationsCollection.onSnapshot(
      function (snapshot) {
        allRegistrations = snapshot.docs.map(function (doc) {
          return Object.assign({ id: doc.id }, doc.data());
        });

        registrationsById = {};
        allRegistrations.forEach(function (registration) {
          registrationsById[registration.id] = registration;
        });

        allPlayers = buildPlayerList(allRegistrations);
        renderPlayers();
      },
      function (error) {
        console.error(error);
        listEl.innerHTML = '';
        listEl.appendChild(createMessage('Greška pri učitavanju igrača.'));
      }
    );

    db.collection('adminRoundScores').onSnapshot(
      function (snapshot) {
        allScores = snapshot.docs.map(function (doc) {
          return Object.assign({ id: doc.id }, doc.data());
        });
        statsLoadState.scores = true;
      },
      function (error) {
        console.error('Greška pri učitavanju bodova igrača:', error);
      }
    );

    db.collection('adminTournaments').onSnapshot(
      function (snapshot) {
        allTournaments = snapshot.docs.map(function (doc) {
          return Object.assign({ id: doc.id }, doc.data());
        });
        statsLoadState.tournaments = true;
      },
      function (error) {
        console.error('Greška pri učitavanju turnira:', error);
      }
    );

    db.collection('adminScoreRules').onSnapshot(
      function (snapshot) {
        bonusByPlace = {};
        snapshot.forEach(function (doc) {
          var data = doc.data() || {};
          if (Number.isInteger(data.place) && Number.isInteger(data.points)) {
            bonusByPlace[data.place] = data.points;
          }
        });
        statsLoadState.rules = true;
      },
      function (error) {
        console.error('Greška pri učitavanju pravila bodovanja:', error);
      }
    );

    db.collection('adminScoreConfig').doc('global').onSnapshot(
      function (doc) {
        scoreCoefficient = 0.5;
        if (doc.exists) {
          var config = doc.data() || {};
          if (typeof config.gamePointsCoefficient === 'number' && config.gamePointsCoefficient >= 0) {
            scoreCoefficient = config.gamePointsCoefficient;
          }
        }
        statsLoadState.config = true;
      },
      function (error) {
        console.error('Greška pri učitavanju koeficijenta bodovanja:', error);
      }
    );
  });

  searchInput.addEventListener('input', function () {
    renderPlayers();
  });
})();
