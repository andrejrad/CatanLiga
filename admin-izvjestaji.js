(function () {
  var FIREBASE_WAIT_TRIES = 80;
  var FIREBASE_WAIT_MS = 125;

  var statusEl = document.getElementById('izvjestajStatus');
  var tournamentRecordsEl = document.getElementById('tournamentReportRecords');
  var tournamentTableEl = document.getElementById('tournamentReportTable');
  var ligaRankingEl = document.getElementById('ligaRanking');
  var ligaWinnersEl = document.getElementById('ligaWinners');
  var ligaConsistencyEl = document.getElementById('ligaConsistency');
  var ligaActivityEl = document.getElementById('ligaActivity');
  var ligaGrowthEl = document.getElementById('ligaGrowth');
  var ligaVenueEl = document.getElementById('ligaVenue');

  if (!statusEl) {
    return;
  }

  var db = null;
  var allTournaments = [];
  var allRegistrations = [];
  var allScores = [];
  var scoreCoefficient = 0.5;
  var bonusByPlace = {};
  var regById = {};

  var loadState = {
    tournaments: false,
    registrations: false,
    scores: false,
    rules: false,
    config: false
  };

  // ── Utilities ────────────────────────────────────────────────────────────────

  function setStatus(msg, isError) {
    statusEl.textContent = msg;
    statusEl.style.color = isError ? '#ffb6a6' : '#ffe680';
  }

  function normalize(v) {
    return (v || '').toLowerCase().trim();
  }

  function formatPts(v) {
    return Number(v || 0).toFixed(2).replace(/\.00$/, '');
  }

  function formatDate(d) {
    if (!d) {
      return '';
    }
    var p = d.split('-');
    return p.length === 3 ? p[2] + '.' + p[1] + '.' + p[0] + '.' : d;
  }

  function tournamentLabel(t) {
    var venue = t.venueName ? ' \u2013 ' + t.venueName : '';
    return 'Kolo ' + (t.round || '-') + ' \u2013 ' + formatDate(t.date) + (t.time ? ' ' + t.time : '') + venue;
  }

  function tournamentSortValue(t) {
    if (!t || !t.date) {
      return 0;
    }
    var dt = new Date(t.date + 'T' + (t.time || '00:00'));
    return isNaN(dt.getTime()) ? 0 : dt.getTime();
  }

  function computePoints(score) {
    if (typeof score.roundPoints === 'number') {
      return score.roundPoints;
    }
    if (Number.isInteger(score.vp) && Number.isInteger(score.place)) {
      var bonus = bonusByPlace[score.place] == null ? 0 : bonusByPlace[score.place];
      return Number((score.vp * scoreCoefficient + bonus).toFixed(2));
    }
    return 0;
  }

  function getRegEmail(score) {
    var reg = regById[score.registrationId];
    return reg ? normalize(reg.email) : '';
  }

  function playerName(email) {
    var reg = allRegistrations.find(function (r) {
      return normalize(r.email) === email;
    });
    if (reg) {
      var name = ((reg.firstName || '') + ' ' + (reg.lastName || '')).trim();
      if (name) {
        return name;
      }
      if (reg.email) {
        return reg.email;
      }
    }
    return email || 'Nepoznati igra\u010d';
  }

  function createMsg(text) {
    var p = document.createElement('p');
    p.className = 'admin-note';
    p.textContent = text;
    return p;
  }

  function createPill(label, value) {
    var box = document.createElement('div');
    box.className = 'player-stats-pill';
    var lbl = document.createElement('span');
    lbl.className = 'player-stats-pill-label';
    lbl.textContent = label;
    var val = document.createElement('strong');
    val.className = 'player-stats-pill-value';
    val.textContent = value;
    box.appendChild(lbl);
    box.appendChild(val);
    return box;
  }

  function addBackToTopButton(container) {
    if (!container) {
      return;
    }
    var spacer = document.createElement('div');
    spacer.style.marginTop = '0.75rem';

    var btn = document.createElement('a');
    btn.className = 'report-back-to-top';
    btn.href = '#liga-nav-top';
    btn.textContent = '\u2191 Na vrh';

    spacer.appendChild(btn);
    container.appendChild(spacer);
  }

  function buildTable(headers, rows, minWidth) {
    var wrap = document.createElement('div');
    wrap.className = 'tournament-table-wrap';
    wrap.style.marginBottom = '1rem';

    var table = document.createElement('table');
    table.className = 'tournament-table';
    if (minWidth) {
      table.style.minWidth = minWidth;
    }

    var thead = document.createElement('thead');
    var headRow = document.createElement('tr');
    headers.forEach(function (h) {
      var th = document.createElement('th');
      th.textContent = h;
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    var tbody = document.createElement('tbody');
    rows.forEach(function (cells) {
      var tr = document.createElement('tr');
      cells.forEach(function (cell) {
        var td = document.createElement('td');
        td.textContent = String(cell);
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
  }

  // ── Per-tournament aggregation ────────────────────────────────────────────────

  function aggregateTournamentScores(scores) {
    var totals = {};
    scores.forEach(function (s) {
      var email = getRegEmail(s);
      if (!email) {
        return;
      }
      if (!totals[email]) {
        totals[email] = { email: email, totalPoints: 0, wins: 0, totalVp: 0, lastPlace: null, lastRound: -1 };
      }
      totals[email].totalPoints += computePoints(s);
      if (s.place === 1) {
        totals[email].wins++;
      }
      if (Number.isInteger(s.vp)) {
        totals[email].totalVp += s.vp;
      }
      var round = Number(s.round || 0);
      if (round >= totals[email].lastRound && Number.isInteger(s.place)) {
        totals[email].lastRound = round;
        totals[email].lastPlace = s.place;
      }
    });

    return Object.keys(totals).map(function (e) {
      return totals[e];
    }).sort(function (a, b) {
      if (b.totalPoints !== a.totalPoints) {
        return b.totalPoints - a.totalPoints;
      }
      if (b.wins !== a.wins) {
        return b.wins - a.wins;
      }
      if (b.totalVp !== a.totalVp) {
        return b.totalVp - a.totalVp;
      }
      var al = Number.isInteger(a.lastPlace) ? a.lastPlace : 9999;
      var bl = Number.isInteger(b.lastPlace) ? b.lastPlace : 9999;
      return al - bl;
    });
  }

  // ── Main render ───────────────────────────────────────────────────────────────

  function renderAll() {
    allRegistrations.forEach(function (r) {
      regById[r.id] = r;
    });

    var tournaments = allTournaments.slice().sort(function (a, b) {
      return tournamentSortValue(a) - tournamentSortValue(b);
    });

    var scoresByT = {};
    allScores.forEach(function (s) {
      var tid = s.tournamentId || '';
      if (!scoresByT[tid]) {
        scoresByT[tid] = [];
      }
      scoresByT[tid].push(s);
    });

    var regsByT = {};
    allRegistrations.forEach(function (r) {
      var tid = r.tournamentId || '';
      if (!regsByT[tid]) {
        regsByT[tid] = [];
      }
      regsByT[tid].push(r);
    });

    // Compute per-tournament stats
    var seenEmails = {};
    var tStats = tournaments.map(function (t) {
      var tid = t.id;
      var tScores = scoresByT[tid] || [];
      var tRegs = regsByT[tid] || [];

      // Unique scored emails
      var scoredEmailSet = {};
      tScores.forEach(function (s) {
        var email = getRegEmail(s);
        if (email) {
          scoredEmailSet[email] = true;
        }
      });
      var scoredEmails = Object.keys(scoredEmailSet);

      var registered = tRegs.length;
      var scored = scoredEmails.length;

      var newCount = 0;
      var retCount = 0;
      scoredEmails.forEach(function (email) {
        if (seenEmails[email]) {
          retCount++;
        } else {
          newCount++;
        }
      });
      scoredEmails.forEach(function (email) {
        seenEmails[email] = true;
      });

      var cumulativeUnique = Object.keys(seenEmails).length;

      var ranking = aggregateTournamentScores(tScores);
      var winner = ranking.length ? playerName(ranking[0].email) : '\u2013';

      return {
        t: t,
        tid: tid,
        label: tournamentLabel(t),
        registered: registered,
        scored: scored,
        noShow: Math.max(0, registered - scored),
        newPlayers: newCount,
        returningPlayers: retCount,
        winner: winner,
        cumulative: cumulativeUnique,
        ranking: ranking,
        tScores: tScores,
        tRegs: tRegs
      };
    });

    renderTournamentTab(tStats);
    renderLigaTab(tStats, tournaments);
    statusEl.textContent = '';
  }

  // ── Per-tournament tab ────────────────────────────────────────────────────────

  function renderTournamentTab(tStats) {
    tournamentRecordsEl.innerHTML = '';
    tournamentTableEl.innerHTML = '';

    if (!tStats.length) {
      tournamentTableEl.appendChild(createMsg('Nema podataka o turnirima.'));
      return;
    }

    // Record pills
    var maxReg = tStats.reduce(function (best, s) {
      return s.registered > best.registered ? s : best;
    }, tStats[0]);
    var maxScored = tStats.reduce(function (best, s) {
      return s.scored > best.scored ? s : best;
    }, tStats[0]);
    var maxNew = tStats.reduce(function (best, s) {
      return s.newPlayers > best.newPlayers ? s : best;
    }, tStats[0]);
    var maxNoShow = tStats.reduce(function (best, s) {
      var pct = best.registered > 0 ? best.noShow / best.registered : 0;
      var sPct = s.registered > 0 ? s.noShow / s.registered : 0;
      return sPct > pct ? s : best;
    }, tStats[0]);

    tournamentRecordsEl.appendChild(createPill('Najviše prijava', maxReg.registered + ' \u2013 ' + maxReg.label));
    tournamentRecordsEl.appendChild(createPill('Najviše igrača', maxScored.scored + ' \u2013 ' + maxScored.label));
    tournamentRecordsEl.appendChild(createPill('Najviše novih igrača', maxNew.newPlayers + ' \u2013 ' + maxNew.label));

    var noShowPct = maxNoShow.registered > 0
      ? Math.round(maxNoShow.noShow / maxNoShow.registered * 100)
      : 0;
    tournamentRecordsEl.appendChild(createPill('Najviši no-show %', noShowPct + '% \u2013 ' + maxNoShow.label));

    // Table
    var headers = ['Turnir', 'Prijavljeni', 'Odigrali', 'No-show', 'Novi', 'Povratni', 'Pobjednik'];
    var rows = tStats.map(function (s) {
      var noShowStr = s.noShow > 0
        ? s.noShow + ' (' + Math.round(s.noShow / Math.max(s.registered, 1) * 100) + '%)'
        : '0';
      return [s.label, s.registered, s.scored, noShowStr, s.newPlayers, s.returningPlayers, s.winner];
    });

    tournamentTableEl.appendChild(buildTable(headers, rows, '50rem'));
  }

  // ── Liga tab ──────────────────────────────────────────────────────────────────

  function renderLigaTab(tStats, tournaments) {
    var totalTournaments = tournaments.length;

    // Aggregate per-player liga stats from tournament rankings
    var ligaPlayers = {};
    tStats.forEach(function (ts) {
      ts.ranking.forEach(function (item, idx) {
        var email = item.email;
        if (!ligaPlayers[email]) {
          ligaPlayers[email] = {
            email: email,
            totalPoints: 0,
            wins: 0,
            podiums: 0,
            tournamentsPlayed: 0,
            placements: []
          };
        }
        var p = ligaPlayers[email];
        p.totalPoints += item.totalPoints;
        p.wins += item.wins;
        var place = idx + 1;
        if (place <= 3) {
          p.podiums++;
        }
        p.tournamentsPlayed++;
        p.placements.push(place);
      });
    });

    var allLigaItems = Object.keys(ligaPlayers).map(function (email) {
      var p = ligaPlayers[email];
      var n = p.placements.length;
      var avg = n > 0 ? p.placements.reduce(function (a, b) { return a + b; }, 0) / n : 0;
      var variance = n > 1
        ? p.placements.reduce(function (sum, x) { return sum + Math.pow(x - avg, 2); }, 0) / (n - 1)
        : 0;
      return {
        email: email,
        name: playerName(email),
        totalPoints: p.totalPoints,
        wins: p.wins,
        podiums: p.podiums,
        tournamentsPlayed: p.tournamentsPlayed,
        avgPlace: avg,
        stdDev: Math.sqrt(variance)
      };
    });

    // 1. Ukupni ranking
    if (ligaRankingEl) {
      ligaRankingEl.innerHTML = '';
      var rankingSorted = allLigaItems.slice().sort(function (a, b) {
        if (b.totalPoints !== a.totalPoints) {
          return b.totalPoints - a.totalPoints;
        }
        if (b.wins !== a.wins) {
          return b.wins - a.wins;
        }
        return a.name.localeCompare(b.name, 'hr', { sensitivity: 'base' });
      });

      if (!rankingSorted.length) {
        ligaRankingEl.appendChild(createMsg('Nema podataka.'));
      } else {
        ligaRankingEl.appendChild(buildTable(
          ['#', 'Igra\u010d', 'Turniri', 'Bodovi', 'Pobjede'],
          rankingSorted.map(function (p, i) {
            return [i + 1, p.name, p.tournamentsPlayed, formatPts(p.totalPoints), p.wins];
          }),
          '28rem'
        ));
      }
      addBackToTopButton(ligaRankingEl);
    }

    // 2. Najpobjednički igrači
    if (ligaWinnersEl) {
      ligaWinnersEl.innerHTML = '';
      var winnersSorted = allLigaItems.slice().sort(function (a, b) {
        if (b.wins !== a.wins) {
          return b.wins - a.wins;
        }
        if (b.podiums !== a.podiums) {
          return b.podiums - a.podiums;
        }
        return a.name.localeCompare(b.name, 'hr', { sensitivity: 'base' });
      }).filter(function (p) {
        return p.wins > 0 || p.podiums > 0;
      });

      if (!winnersSorted.length) {
        ligaWinnersEl.appendChild(createMsg('Nema podataka.'));
      } else {
        ligaWinnersEl.appendChild(buildTable(
          ['#', 'Igra\u010d', 'Pobjede (1. mj.)', 'Podij (top 3)'],
          winnersSorted.map(function (p, i) {
            return [i + 1, p.name, p.wins, p.podiums];
          }),
          '28rem'
        ));
      }
      addBackToTopButton(ligaWinnersEl);
    }

    // 3. Konzistentnost
    if (ligaConsistencyEl) {
      ligaConsistencyEl.innerHTML = '';
      var consistencySorted = allLigaItems.filter(function (p) {
        return p.tournamentsPlayed >= 2;
      }).slice().sort(function (a, b) {
        if (a.avgPlace !== b.avgPlace) {
          return a.avgPlace - b.avgPlace;
        }
        return a.stdDev - b.stdDev;
      });

      if (!consistencySorted.length) {
        ligaConsistencyEl.appendChild(createMsg('Nema dovoljno podataka (potrebno \u2265 2 turnira po igra\u010du).'));
      } else {
        ligaConsistencyEl.appendChild(buildTable(
          ['#', 'Igra\u010d', 'Turniri', 'Prosj. plasman', 'Std. dev.'],
          consistencySorted.map(function (p, i) {
            return [i + 1, p.name, p.tournamentsPlayed, p.avgPlace.toFixed(1), p.stdDev.toFixed(1)];
          }),
          '30rem'
        ));
      addBackToTopButton(ligaConsistencyEl);
      }
    }

    // 4. Aktivnost igrača
    if (ligaActivityEl) {
      ligaActivityEl.innerHTML = '';
      var activitySorted = allLigaItems.slice().sort(function (a, b) {
        if (b.tournamentsPlayed !== a.tournamentsPlayed) {
          return b.tournamentsPlayed - a.tournamentsPlayed;
        }
        return a.name.localeCompare(b.name, 'hr', { sensitivity: 'base' });
      });

      if (!activitySorted.length) {
        ligaActivityEl.appendChild(createMsg('Nema podataka.'));
      } else {
        ligaActivityEl.appendChild(buildTable(
          ['#', 'Igra\u010d', 'Odigranih turnira', '% od ukupnih'],
          activitySorted.map(function (p, i) {
            var pct = totalTournaments > 0
              ? Math.round(p.tournamentsPlayed / totalTournaments * 100)
              : 0;
            return [i + 1, p.name, p.tournamentsPlayed, pct + '%'];
          }),
          '28rem'
      addBackToTopButton(ligaActivityEl);
        ));
      }
    }

    // 5. Rast baze igrača
    if (ligaGrowthEl) {
      ligaGrowthEl.innerHTML = '';
      if (!tStats.length) {
        ligaGrowthEl.appendChild(createMsg('Nema podataka.'));
      } else {
        ligaGrowthEl.appendChild(buildTable(
          ['Turnir', 'Novi igra\u010di', 'Ukupno jedinstvenih'],
          tStats.map(function (ts) {
            return [ts.label, ts.newPlayers, ts.cumulative];
          }),
          '38rem'
      addBackToTopButton(ligaGrowthEl);
        ));
      }
    }

    // 6. Statistika po lokaciji
    if (ligaVenueEl) {
      ligaVenueEl.innerHTML = '';
      var venueStats = {};
      tStats.forEach(function (ts) {
        var venue = (ts.t.venueName || '').trim() || 'Nepoznata lokacija';
        if (!venueStats[venue]) {
          venueStats[venue] = { venue: venue, count: 0, totalReg: 0, totalScored: 0 };
        }
        venueStats[venue].count++;
        venueStats[venue].totalReg += ts.registered;
        venueStats[venue].totalScored += ts.scored;
      });

      var venueSorted = Object.keys(venueStats).map(function (v) {
        return venueStats[v];
      }).sort(function (a, b) {
        return b.totalReg - a.totalReg;
      });

      if (!venueSorted.length) {
        ligaVenueEl.appendChild(createMsg('Nema podataka.'));
      } else {
        ligaVenueEl.appendChild(buildTable(
          ['Lokacija', 'Turnira', 'Ukupno prijava', 'Prosj. prijava', 'Prosj. igra\u010da'],
          venueSorted.map(function (vs) {
            return [
              vs.venue,
              vs.count,
              vs.totalReg,
              vs.count > 0 ? (vs.totalReg / vs.count).toFixed(1) : '0',
              vs.count > 0 ? (vs.totalScored / vs.count).toFixed(1) : '0'
            ];
          }),
      addBackToTopButton(ligaVenueEl);
          '36rem'
        ));
      }
    }
  }

  // ── Tabs ──────────────────────────────────────────────────────────────────────

  function initTabs() {
    var tabs = document.querySelectorAll('#panel-turniri, #panel-liga')
      ? document.querySelectorAll('.bodovanje-tab')
      : [];

    Array.prototype.forEach.call(tabs, function (tab) {
      tab.addEventListener('click', function () {
        var target = tab.getAttribute('data-tab-target');
        Array.prototype.forEach.call(tabs, function (t) {
          t.classList.remove('is-active');
          t.setAttribute('aria-selected', 'false');
          t.setAttribute('tabindex', '-1');
        });
        var panels = document.querySelectorAll('.bodovanje-panel');
        Array.prototype.forEach.call(panels, function (p) {
          p.classList.remove('is-active');
        });
        tab.classList.add('is-active');
        tab.setAttribute('aria-selected', 'true');
        tab.removeAttribute('tabindex');
        var panel = document.getElementById(target);
        if (panel) {
          panel.classList.add('is-active');
        }
      });
    });
  }

  // ── Firebase loading ──────────────────────────────────────────────────────────

  function checkReady() {
    if (loadState.tournaments && loadState.registrations && loadState.scores && loadState.rules && loadState.config) {
      renderAll();
    }
  }

  function loadData() {
    var tournamentsCollection = db.collection('adminTournaments');
    var registrationsCollection = db.collection('registrations');
    var roundScoresCollection = db.collection('adminRoundScores');
    var scoreRulesCollection = db.collection('adminScoreRules');
    var scoreConfigCollection = db.collection('adminScoreConfig');

    tournamentsCollection.get().then(function (snap) {
      allTournaments = snap.docs.map(function (d) {
        return Object.assign({ id: d.id }, d.data());
      });
      loadState.tournaments = true;
      checkReady();
    }).catch(function (err) {
      setStatus('Gre\u0161ka pri u\u010ditavanju turnira: ' + err.message, true);
    });

    registrationsCollection.get().then(function (snap) {
      allRegistrations = snap.docs.map(function (d) {
        return Object.assign({ id: d.id }, d.data());
      });
      loadState.registrations = true;
      checkReady();
    }).catch(function (err) {
      setStatus('Gre\u0161ka pri u\u010ditavanju prijava: ' + err.message, true);
    });

    roundScoresCollection.get().then(function (snap) {
      allScores = snap.docs.map(function (d) {
        return Object.assign({ id: d.id }, d.data());
      });
      loadState.scores = true;
      checkReady();
    }).catch(function (err) {
      setStatus('Gre\u0161ka pri u\u010ditavanju bodova: ' + err.message, true);
    });

    scoreRulesCollection.orderBy('place').get().then(function (snap) {
      bonusByPlace = {};
      snap.docs.forEach(function (d) {
        var data = d.data();
        if (Number.isInteger(data.place)) {
          bonusByPlace[data.place] = Number(data.points || 0);
        }
      });
      loadState.rules = true;
      checkReady();
    }).catch(function () {
      // Non-critical: fall back to no bonus
      loadState.rules = true;
      checkReady();
    });

    scoreConfigCollection.get().then(function (snap) {
      snap.docs.forEach(function (d) {
        var data = d.data();
        if (typeof data.coefficient === 'number') {
          scoreCoefficient = data.coefficient;
        }
      });
      loadState.config = true;
      checkReady();
    }).catch(function () {
      // Non-critical: fall back to 0.5
      loadState.config = true;
      checkReady();
    });
  }

  function waitForFirebase(tries) {
    if (tries <= 0) {
      setStatus('Firebase se nije u\u010ditao na vrijeme.', true);
      return;
    }
    if (typeof firebase === 'undefined' || !firebase.app || !firebase.firestore) {
      setTimeout(function () { waitForFirebase(tries - 1); }, FIREBASE_WAIT_MS);
      return;
    }
    try {
      db = firebase.firestore();
      loadData();
    } catch (e) {
      setTimeout(function () { waitForFirebase(tries - 1); }, FIREBASE_WAIT_MS);
    }
  }

  initTabs();
  setStatus('U\u010ditavanje podataka...');
  waitForFirebase(FIREBASE_WAIT_TRIES);
})();
