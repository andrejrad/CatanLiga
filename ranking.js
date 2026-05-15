(function () {
  var FIREBASE_WAIT_TRIES = 80;
  var FIREBASE_WAIT_MS = 125;

  var ligaListEl = document.getElementById('rankingLigaList');
  var ligaStatusEl = document.getElementById('rankingLigaStatus');
  var turnirListEl = document.getElementById('rankingTurnirList');
  var turnirStatusEl = document.getElementById('rankingTurnirStatus');
  var tournamentSelect = document.getElementById('rankingTournamentSelect');

  if (!ligaListEl || !ligaStatusEl || !turnirListEl || !turnirStatusEl || !tournamentSelect) {
    return;
  }

  var state = {
    coefficient: 0.5,
    bonusByPlace: {},
    registrationsById: {},
    scores: [],
    tournaments: [],
    tournamentOrderMap: {}
  };

  function normalize(value) {
    return (value || '').toLowerCase().trim();
  }

  function formatPoints(value) {
    return Number(value || 0).toFixed(2).replace(/\.00$/, '');
  }

  function setStatus(el, message, isError) {
    el.textContent = message;
    el.style.color = isError ? '#ffb6a6' : '#ffe680';
  }

  function createMessage(text) {
    var p = document.createElement('p');
    p.className = 'admin-note';
    p.textContent = text;
    return p;
  }

  function getPlayerName(registration, score) {
    if (registration) {
      var fullName = ((registration.firstName || '') + ' ' + (registration.lastName || '')).trim();
      if (fullName) {
        return fullName;
      }
      if (registration.email) {
        return registration.email;
      }
    }
    return (score && score.playerName) || 'Nepoznati igrač';
  }

  function getComputedPoints(score) {
    if (typeof score.roundPoints === 'number') {
      return score.roundPoints;
    }

    if (Number.isInteger(score.vp) && Number.isInteger(score.place)) {
      var bonus = state.bonusByPlace[score.place] == null ? 0 : state.bonusByPlace[score.place];
      return Number((score.vp * state.coefficient + bonus).toFixed(2));
    }

    return 0;
  }

  function getScoreOrder(score) {
    var base = state.tournamentOrderMap[score.tournamentId] || 0;
    var round = Number(score.round || 0);
    return base * 10 + round;
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

  function getScorePlayerKey(score) {
    var registration = state.registrationsById[score.registrationId] || null;
    var email = normalize(registration ? registration.email : '');
    return email || ('registration:' + (score.registrationId || score.id));
  }

  function buildTournamentTieBreakContext(scores) {
    var tableVpTotals = {};
    var ratioSums = {};

    scores.forEach(function (score) {
      var round = Number(score.round || 0);
      var tableNumber = Number(score.tableNumber || 0);
      if (!round || !tableNumber || !Number.isInteger(score.vp)) {
        return;
      }

      var tableKey = round + '__' + tableNumber;
      tableVpTotals[tableKey] = (tableVpTotals[tableKey] || 0) + score.vp;
    });

    scores.forEach(function (score) {
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

  function compareByTieBreak(a, b, useExtendedRules) {
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

    if (useExtendedRules) {
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
    }

    return a.playerName.localeCompare(b.playerName, 'hr', { sensitivity: 'base' });
  }

  function buildLinkedTournamentGroupMap(tournaments) {
    var adjacency = {};

    tournaments.forEach(function (t) {
      adjacency[t.id] = adjacency[t.id] || {};
    });

    tournaments.forEach(function (t) {
      var linked = Array.isArray(t.linkedTournamentIds) ? t.linkedTournamentIds : [];
      linked.forEach(function (linkedId) {
        if (!adjacency[t.id] || !adjacency[linkedId]) {
          return;
        }

        adjacency[t.id][linkedId] = true;
        adjacency[linkedId][t.id] = true;
      });
    });

    var visited = {};
    var groupById = {};

    Object.keys(adjacency).forEach(function (startId) {
      if (visited[startId]) {
        return;
      }

      var stack = [startId];
      var component = [];

      while (stack.length) {
        var current = stack.pop();
        if (visited[current]) {
          continue;
        }
        visited[current] = true;
        component.push(current);

        Object.keys(adjacency[current] || {}).forEach(function (neighbor) {
          if (!visited[neighbor]) {
            stack.push(neighbor);
          }
        });
      }

      component.sort(function (a, b) {
        return a.localeCompare(b, 'hr', { sensitivity: 'base' });
      });
      var groupKey = component.join('|');

      component.forEach(function (id) {
        groupById[id] = groupKey;
      });
    });

    return groupById;
  }

  function isBetterTournamentResult(candidate, current) {
    var cmp = compareByTieBreak(candidate, current, true);
    if (cmp !== 0) {
      return cmp < 0;
    }

    var cPlace = Number.isInteger(candidate.rankPlace) ? candidate.rankPlace : Number.MAX_SAFE_INTEGER;
    var xPlace = Number.isInteger(current.rankPlace) ? current.rankPlace : Number.MAX_SAFE_INTEGER;
    if (cPlace !== xPlace) {
      return cPlace < xPlace;
    }

    return candidate.playerName.localeCompare(current.playerName, 'hr', { sensitivity: 'base' }) < 0;
  }

  function aggregateScores(scores) {
    var totals = {};
    var singleTournamentId = null;
    var hasMultipleTournaments = false;

    scores.forEach(function (score) {
      var tid = score.tournamentId || '';
      if (!tid) {
        return;
      }
      if (singleTournamentId == null) {
        singleTournamentId = tid;
      } else if (singleTournamentId !== tid) {
        hasMultipleTournaments = true;
      }
    });

    var useExtendedRules = !!singleTournamentId && !hasMultipleTournaments;
    var tieBreakRatios = useExtendedRules ? buildTournamentTieBreakContext(scores) : {};

    scores.forEach(function (score) {
      var registration = state.registrationsById[score.registrationId] || null;
      var email = normalize(registration ? registration.email : '');
      var key = email || ('registration:' + (score.registrationId || score.id));

      if (!totals[key]) {
        totals[key] = {
          playerKey: key,
          tournamentId: score.tournamentId || '',
          playerName: getPlayerName(registration, score),
          totalPoints: 0,
          wins: 0,
          totalVp: 0,
          lastPlace: null,
          lastOrder: -1,
          registrationCreatedAtMs: getRegistrationCreatedAtMs(registration),
          roundVpRatioByRound: useExtendedRules && tieBreakRatios[key]
            ? tieBreakRatios[key]
            : { 1: null, 2: null, 3: null }
        };
      }

      totals[key].totalPoints += getComputedPoints(score);

      if (score.place === 1) {
        totals[key].wins += 1;
      }
      if (Number.isInteger(score.vp)) {
        totals[key].totalVp += score.vp;
      }

      var order = getScoreOrder(score);
      if (order >= totals[key].lastOrder && Number.isInteger(score.place)) {
        totals[key].lastOrder = order;
        totals[key].lastPlace = score.place;
      }
    });

    return Object.keys(totals)
      .map(function (key) { return totals[key]; })
      .sort(function (a, b) {
        return compareByTieBreak(a, b, useExtendedRules);
      });
  }

  function aggregateLeagueScores() {
    var scoresByTournament = {};
    state.scores.forEach(function (score) {
      var tid = score.tournamentId || '';
      if (!tid) {
        return;
      }
      if (!scoresByTournament[tid]) {
        scoresByTournament[tid] = [];
      }
      scoresByTournament[tid].push(score);
    });

    var groupByTournamentId = buildLinkedTournamentGroupMap(state.tournaments);
    var bestByPlayerAndGroup = {};

    Object.keys(scoresByTournament).forEach(function (tid) {
      var ranking = aggregateScores(scoresByTournament[tid]);

      ranking.forEach(function (item, index) {
        item.rankPlace = index + 1;

        var playerKey = item.playerKey || item.playerName;
        var groupKey = groupByTournamentId[tid] || ('single|' + tid);

        if (!bestByPlayerAndGroup[playerKey]) {
          bestByPlayerAndGroup[playerKey] = {
            playerName: item.playerName,
            registrationCreatedAtMs: item.registrationCreatedAtMs,
            groups: {}
          };
        }

        if (item.registrationCreatedAtMs < bestByPlayerAndGroup[playerKey].registrationCreatedAtMs) {
          bestByPlayerAndGroup[playerKey].registrationCreatedAtMs = item.registrationCreatedAtMs;
        }

        var current = bestByPlayerAndGroup[playerKey].groups[groupKey];
        if (!current || isBetterTournamentResult(item, current)) {
          bestByPlayerAndGroup[playerKey].groups[groupKey] = item;
        }
      });
    });

    return Object.keys(bestByPlayerAndGroup).map(function (playerKey) {
      var entry = bestByPlayerAndGroup[playerKey];
      var selectedResults = Object.keys(entry.groups).map(function (groupKey) {
        return entry.groups[groupKey];
      });

      var aggregate = {
        playerKey: playerKey,
        playerName: entry.playerName,
        totalPoints: 0,
        wins: 0,
        totalVp: 0,
        lastPlace: null,
        lastOrder: -1,
        registrationCreatedAtMs: entry.registrationCreatedAtMs,
        tournamentsPlayed: 0
      };

      selectedResults.forEach(function (result) {
        aggregate.totalPoints += result.totalPoints;
        aggregate.wins += result.wins;
        aggregate.totalVp += result.totalVp;
        aggregate.tournamentsPlayed += 1;

        if (result.lastOrder >= aggregate.lastOrder) {
          aggregate.lastOrder = result.lastOrder;
          aggregate.lastPlace = result.lastPlace;
        }
      });

      return aggregate;
    }).sort(function (a, b) {
      return compareByTieBreak(a, b, false);
    });
  }

  function renderRankingTable(container, items) {
    container.innerHTML = '';

    if (!items.length) {
      container.appendChild(createMessage('Nema podataka za prikaz poretka.'));
      return;
    }

    var wrap = document.createElement('div');
    wrap.className = 'tournament-table-wrap';

    var table = document.createElement('table');
    table.className = 'tournament-table';

    var thead = document.createElement('thead');
    var headRow = document.createElement('tr');
    ['#', 'Igrač', 'Bodovi'].forEach(function (label) {
      var th = document.createElement('th');
      th.textContent = label;
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);

    var tbody = document.createElement('tbody');

    items.forEach(function (item, index) {
      var row = document.createElement('tr');

      var rankTd = document.createElement('td');
      rankTd.textContent = String(index + 1);

      var playerTd = document.createElement('td');
      playerTd.textContent = item.playerName;

      var pointsTd = document.createElement('td');
      pointsTd.textContent = formatPoints(item.totalPoints);

      row.appendChild(rankTd);
      row.appendChild(playerTd);
      row.appendChild(pointsTd);
      tbody.appendChild(row);
    });

    table.appendChild(thead);
    table.appendChild(tbody);
    wrap.appendChild(table);
    container.appendChild(wrap);
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

  function tournamentLabel(item) {
    return 'Kolo ' + item.round + ' - ' + formatDate(item.date) + ' ' + (item.time || '') + ' - ' + (item.venueName || '');
  }

  function renderTournamentOptions() {
    var previous = tournamentSelect.value;

    tournamentSelect.innerHTML = '';
    var placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = state.tournaments.length ? 'Odaberi turnir' : 'Nema dostupnih turnira';
    tournamentSelect.appendChild(placeholder);

    state.tournaments.forEach(function (item) {
      var option = document.createElement('option');
      option.value = item.id;
      option.textContent = tournamentLabel(item);
      tournamentSelect.appendChild(option);
    });

    var stillExists = state.tournaments.some(function (item) { return item.id === previous; });
    tournamentSelect.value = stillExists ? previous : '';
  }

  function renderLigaRanking() {
    var items = aggregateLeagueScores();
    renderRankingTable(ligaListEl, items);
    setStatus(ligaStatusEl, 'Ukupno igrača: ' + items.length + '.', false);
  }

  function renderTurnirRanking() {
    var tournamentId = tournamentSelect.value;
    turnirListEl.innerHTML = '';

    if (!tournamentId) {
      turnirListEl.appendChild(createMessage('Odaberi turnir za prikaz poretka.'));
      setStatus(turnirStatusEl, '', false);
      return;
    }

    var filtered = state.scores.filter(function (score) {
      return score.tournamentId === tournamentId;
    });

    var items = aggregateScores(filtered);
    renderRankingTable(turnirListEl, items);
    setStatus(turnirStatusEl, 'Ukupno igrača na turniru: ' + items.length + '.', false);
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

  function loadData(db) {
    Promise.all([
      db.collection('adminRoundScores').get(),
      db.collection('registrations').get(),
      db.collection('adminScoreRules').get(),
      db.collection('adminScoreConfig').doc('global').get(),
      db.collection('adminTournaments').orderBy('date', 'asc').get()
    ]).then(function (results) {
      var scoresSnapshot = results[0];
      var registrationsSnapshot = results[1];
      var scoreRulesSnapshot = results[2];
      var scoreConfigDoc = results[3];
      var tournamentsSnapshot = results[4];

      state.scores = scoresSnapshot.docs.map(function (doc) {
        var data = doc.data() || {};
        data.id = doc.id;
        return data;
      });

      state.registrationsById = {};
      registrationsSnapshot.forEach(function (doc) {
        state.registrationsById[doc.id] = doc.data() || {};
      });

      state.bonusByPlace = {};
      scoreRulesSnapshot.forEach(function (doc) {
        var data = doc.data() || {};
        if (Number.isInteger(data.place) && Number.isInteger(data.points)) {
          state.bonusByPlace[data.place] = data.points;
        }
      });

      state.coefficient = 0.5;
      if (scoreConfigDoc.exists) {
        var config = scoreConfigDoc.data() || {};
        if (typeof config.gamePointsCoefficient === 'number' && config.gamePointsCoefficient >= 0) {
          state.coefficient = config.gamePointsCoefficient;
        }
      }

      state.tournaments = tournamentsSnapshot.docs.map(function (doc) {
        var data = doc.data() || {};
        data.id = doc.id;
        return data;
      }).filter(function (item) {
        return !!item.date && !!item.time;
      });

      state.tournamentOrderMap = {};
      tournamentsSnapshot.forEach(function (doc) {
        var data = doc.data() || {};
        if (!data.date || !data.time) {
          return;
        }

        var dateTime = new Date(data.date + 'T' + data.time);
        if (isNaN(dateTime.getTime())) {
          return;
        }

        state.tournamentOrderMap[doc.id] = dateTime.getTime();
      });

      renderTournamentOptions();
      renderLigaRanking();
      renderTurnirRanking();
    }).catch(function (error) {
      console.error(error);
      ligaListEl.innerHTML = '';
      ligaListEl.appendChild(createMessage('Ne mogu učitati ligaški poredak.'));
      turnirListEl.innerHTML = '';
      turnirListEl.appendChild(createMessage('Ne mogu učitati turnirski poredak.'));
      setStatus(ligaStatusEl, 'Greška učitavanja podataka.', true);
      setStatus(turnirStatusEl, 'Greška učitavanja podataka.', true);
    });
  }

  function waitForFirebaseAndLoad() {
    var tries = 0;
    var timer = setInterval(function () {
      tries += 1;

      if (window.firebase && firebase.apps && firebase.apps.length) {
        clearInterval(timer);
        initTabs();
        loadData(firebase.firestore());
        return;
      }

      if (tries >= FIREBASE_WAIT_TRIES) {
        clearInterval(timer);
        ligaListEl.innerHTML = '';
        ligaListEl.appendChild(createMessage('Firebase nije dostupan.'));
        turnirListEl.innerHTML = '';
        turnirListEl.appendChild(createMessage('Firebase nije dostupan.'));
      }
    }, FIREBASE_WAIT_MS);
  }

  tournamentSelect.addEventListener('change', function () {
    renderTurnirRanking();
  });

  waitForFirebaseAndLoad();
})();
