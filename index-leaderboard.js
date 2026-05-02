(function () {
  var FIREBASE_WAIT_TRIES = 80;
  var FIREBASE_WAIT_MS = 125;

  var leaderboardBody = document.getElementById('indexLeaderboardBody');
  if (!leaderboardBody) {
    return;
  }

  function normalize(value) {
    return (value || '').toLowerCase().trim();
  }

  function formatPoints(value) {
    return Number(value || 0).toFixed(2).replace(/\.00$/, '');
  }

  function getPlayerName(registration) {
    if (!registration) {
      return '';
    }
    return ((registration.firstName || '') + ' ' + (registration.lastName || '')).trim() || registration.email || 'Nepoznati igrač';
  }

  function renderRows(items) {
    leaderboardBody.innerHTML = '';

    if (!items.length) {
      leaderboardBody.innerHTML = '<tr><td class="lb-rank">-</td><td class="lb-name">Nema podataka</td><td class="lb-pts">0</td></tr>';
      return;
    }

    items.slice(0, 5).forEach(function (item, index) {
      var tr = document.createElement('tr');

      var rankTd = document.createElement('td');
      rankTd.className = 'lb-rank';
      rankTd.textContent = String(index + 1);

      var nameTd = document.createElement('td');
      nameTd.className = 'lb-name';
      nameTd.textContent = item.playerName;

      var pointsTd = document.createElement('td');
      pointsTd.className = 'lb-pts';
      pointsTd.textContent = formatPoints(item.totalPoints);

      tr.appendChild(rankTd);
      tr.appendChild(nameTd);
      tr.appendChild(pointsTd);
      leaderboardBody.appendChild(tr);
    });
  }

  function buildBonusMap(scoreRulesSnapshot) {
    var map = {};
    scoreRulesSnapshot.forEach(function (doc) {
      var data = doc.data() || {};
      if (Number.isInteger(data.place) && Number.isInteger(data.points)) {
        map[data.place] = data.points;
      }
    });
    return map;
  }

  function computePoints(score, coefficient, bonusByPlace) {
    if (typeof score.roundPoints === 'number') {
      return score.roundPoints;
    }

    if (Number.isInteger(score.vp) && Number.isInteger(score.place)) {
      var bonus = bonusByPlace[score.place] == null ? 0 : bonusByPlace[score.place];
      return Number((score.vp * coefficient + bonus).toFixed(2));
    }

    return 0;
  }

  function buildTournamentOrderMap(tournamentsSnapshot) {
    var map = {};

    tournamentsSnapshot.forEach(function (doc) {
      var data = doc.data() || {};
      if (!data.date || !data.time) {
        return;
      }

      var dateTime = new Date(data.date + 'T' + data.time);
      if (isNaN(dateTime.getTime())) {
        return;
      }

      map[doc.id] = dateTime.getTime();
    });

    return map;
  }

  function getScoreOrder(score, tournamentOrderMap) {
    var base = tournamentOrderMap[score.tournamentId] || 0;
    var round = Number(score.round || 0);
    return base * 10 + round;
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

    return a.playerName.localeCompare(b.playerName, 'hr', { sensitivity: 'base' });
  }

  function aggregateLeague(scoresSnapshot, registrationsSnapshot, tournamentsSnapshot, coefficient, bonusByPlace) {
    var registrationsById = {};
    registrationsSnapshot.forEach(function (doc) {
      registrationsById[doc.id] = doc.data() || {};
    });

    var tournamentOrderMap = buildTournamentOrderMap(tournamentsSnapshot);

    var totals = {};

    scoresSnapshot.forEach(function (doc) {
      var score = doc.data() || {};
      var registration = registrationsById[score.registrationId] || null;
      var email = normalize(registration ? registration.email : '');
      var key = email || ('registration:' + (score.registrationId || doc.id));
      var name = getPlayerName(registration) || score.playerName || 'Nepoznati igrač';
      var points = computePoints(score, coefficient, bonusByPlace);

      if (!totals[key]) {
        totals[key] = {
          playerName: name,
          totalPoints: 0,
          wins: 0,
          totalVp: 0,
          lastPlace: null,
          lastOrder: -1
        };
      }
      totals[key].totalPoints += points;

      if (score.place === 1) {
        totals[key].wins += 1;
      }
      if (Number.isInteger(score.vp)) {
        totals[key].totalVp += score.vp;
      }

      var order = getScoreOrder(score, tournamentOrderMap);
      if (order >= totals[key].lastOrder && Number.isInteger(score.place)) {
        totals[key].lastOrder = order;
        totals[key].lastPlace = score.place;
      }
    });

    return Object.keys(totals)
      .map(function (key) { return totals[key]; })
      .sort(compareByTieBreak);
  }

  function loadLeaderboard(db) {
    Promise.all([
      db.collection('adminRoundScores').get(),
      db.collection('registrations').get(),
      db.collection('adminScoreRules').get(),
      db.collection('adminScoreConfig').doc('global').get(),
      db.collection('adminTournaments').get()
    ]).then(function (results) {
      var scoresSnapshot = results[0];
      var registrationsSnapshot = results[1];
      var scoreRulesSnapshot = results[2];
      var scoreConfigDoc = results[3];
      var tournamentsSnapshot = results[4];

      var coefficient = 0.5;
      if (scoreConfigDoc.exists) {
        var config = scoreConfigDoc.data() || {};
        if (typeof config.gamePointsCoefficient === 'number' && config.gamePointsCoefficient >= 0) {
          coefficient = config.gamePointsCoefficient;
        }
      }

      var bonusByPlace = buildBonusMap(scoreRulesSnapshot);
      var ranking = aggregateLeague(scoresSnapshot, registrationsSnapshot, tournamentsSnapshot, coefficient, bonusByPlace);
      renderRows(ranking);
    }).catch(function (error) {
      console.error(error);
      leaderboardBody.innerHTML = '<tr><td class="lb-rank">-</td><td class="lb-name">Greška učitavanja</td><td class="lb-pts">-</td></tr>';
    });
  }

  function loadTableScheduleVisibility(db) {
    var btn = document.getElementById('rasporedStolovaBtn');
    if (!btn) return;
    db.collection('adminSettings').doc('tableSchedule').get()
      .then(function (docSnap) {
        if (docSnap.exists && docSnap.data().showPublicButton === true) {
          btn.style.display = '';
        } else {
          btn.style.display = 'none';
        }
      })
      .catch(function () {
        btn.style.display = 'none';
      });
  }

  function waitForFirebaseAndLoad() {
    var tries = 0;
    var timer = setInterval(function () {
      tries += 1;

      if (window.firebase && firebase.apps && firebase.apps.length) {
        clearInterval(timer);
        loadLeaderboard(firebase.firestore());
        loadTableScheduleVisibility(firebase.firestore());
        return;
      }

      if (tries >= FIREBASE_WAIT_TRIES) {
        clearInterval(timer);
        leaderboardBody.innerHTML = '<tr><td class="lb-rank">-</td><td class="lb-name">Firebase nije dostupan</td><td class="lb-pts">-</td></tr>';
      }
    }, FIREBASE_WAIT_MS);
  }

  waitForFirebaseAndLoad();
})();
