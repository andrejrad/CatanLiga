(function () {
  var FIREBASE_WAIT_TRIES = 80;
  var FIREBASE_WAIT_MS = 125;

  var form = document.getElementById('tournamentForm');
  var dateInput = document.getElementById('tournamentDate');
  var venueSelect = document.getElementById('tournamentVenue');
  var timeInput = document.getElementById('tournamentTime');
  var roundInput = document.getElementById('tournamentRound');
  var registrationCloseHoursInput = document.getElementById('tournamentRegistrationCloseHours');
  var maxCapacityInput = document.getElementById('tournamentMaxCapacity');
  var activeInput = document.getElementById('tournamentActive');
  var linkedTournamentsSelect = document.getElementById('tournamentLinkedTournaments');
  var statusEl = document.getElementById('tournamentFormStatus');
  var listEl = document.getElementById('tournamentList');
  var filterRoundSelect = document.getElementById('tournamentFilterRound');
  var filterVenueSelect = document.getElementById('tournamentFilterVenue');
  var submitButton = document.getElementById('tournamentSubmitBtn');
  var cancelEditButton = document.getElementById('tournamentCancelEdit');
  var deleteModal = document.getElementById('tournamentDeleteConfirmModal');
  var deleteModalMessage = document.getElementById('tournamentDeleteConfirmMessage');
  var deleteModalCancel = document.getElementById('tournamentDeleteConfirmCancel');
  var deleteModalYes = document.getElementById('tournamentDeleteConfirmYes');

  var editingTournamentId = null;
  var currentDeletingTournament = null;
  var deleteConfirmationStep = 0;

  var db = null;
  var partnersCollection = null;
  var tournamentsCollection = null;
  var allPartners = [];
  var allTournaments = [];

  if (!form || !dateInput || !venueSelect || !timeInput || !roundInput || !registrationCloseHoursInput || !maxCapacityInput || !activeInput || !linkedTournamentsSelect || !statusEl || !listEl) {
    return;
  }

  function setStatus(message, isError) {
    statusEl.textContent = message;
    statusEl.style.color = isError ? '#ffb6a6' : '#ffe680';
  }

  function setSubmitting(isSubmitting) {
    if (!submitButton) {
      return;
    }
    submitButton.disabled = isSubmitting;
    submitButton.style.opacity = isSubmitting ? '0.7' : '1';
    submitButton.style.cursor = isSubmitting ? 'not-allowed' : 'pointer';
  }

  function parseRoundLabel(value) {
    var raw = String(value == null ? '' : value).trim();
    var lower = raw.toLowerCase();
    var match = lower.match(/^(\d+)(?:\.([a-z]+))?$/i);

    if (!match) {
      return {
        isValid: false,
        raw: raw,
        normalized: lower,
        major: Number.MAX_SAFE_INTEGER,
        suffix: lower
      };
    }

    var major = parseInt(match[1], 10);
    var suffix = (match[2] || '').toLowerCase();

    return {
      isValid: major >= 1,
      raw: raw,
      normalized: String(major) + (suffix ? '.' + suffix : ''),
      major: major,
      suffix: suffix
    };
  }

  function compareRoundLabels(a, b) {
    var parsedA = parseRoundLabel(a);
    var parsedB = parseRoundLabel(b);

    if (parsedA.major !== parsedB.major) {
      return parsedA.major - parsedB.major;
    }

    if (!!parsedA.suffix !== !!parsedB.suffix) {
      return parsedA.suffix ? 1 : -1;
    }

    if (parsedA.suffix !== parsedB.suffix) {
      return parsedA.suffix.localeCompare(parsedB.suffix, 'hr', { sensitivity: 'base', numeric: true });
    }

    return String(a == null ? '' : a).localeCompare(String(b == null ? '' : b), 'hr', { sensitivity: 'base', numeric: true });
  }

  function resetEditMode() {
    editingTournamentId = null;
    activeInput.value = 'true';
    Array.prototype.forEach.call(linkedTournamentsSelect.options, function (option) {
      option.selected = false;
    });
    if (submitButton) {
      submitButton.textContent = 'Dodaj turnir';
    }
    if (cancelEditButton) {
      cancelEditButton.hidden = true;
    }
  }

  function enableEditMode(item) {
    editingTournamentId = item.id;
    dateInput.value = item.date || '';
    timeInput.value = item.time || '';
    roundInput.value = item.round || '';
    registrationCloseHoursInput.value = String(item.registrationCloseHours == null ? 0 : item.registrationCloseHours);
    maxCapacityInput.value = String(item.maxCapacity == null ? 0 : item.maxCapacity);
    activeInput.value = item.active === false ? 'false' : 'true';
    venueSelect.value = item.venueId || '';

    renderLinkedTournamentOptions();
    var linkedIds = Array.isArray(item.linkedTournamentIds) ? item.linkedTournamentIds : [];
    var selectedSet = {};
    linkedIds.forEach(function (id) {
      selectedSet[id] = true;
    });
    Array.prototype.forEach.call(linkedTournamentsSelect.options, function (option) {
      option.selected = !!selectedSet[option.value];
    });

    if (submitButton) {
      submitButton.textContent = 'Spremi izmjene';
    }
    if (cancelEditButton) {
      cancelEditButton.hidden = false;
    }

    setStatus('Uređivanje turnira: kolo ' + item.round + '.', false);
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function getTournamentLabel(item) {
    return 'Kolo ' + (item.round || '') + ' - ' + formatDate(item.date, false) + ' ' + (item.time || '') + ' - ' + (item.venueName || '');
  }

  function sanitizeLinkedTournamentIds(rawIds, selfId) {
    var allowed = {};
    allTournaments.forEach(function (item) {
      allowed[item.id] = true;
    });

    var seen = {};
    var sanitized = [];

    (rawIds || []).forEach(function (rawId) {
      var id = String(rawId || '').trim();
      if (!id || id === selfId || !allowed[id] || seen[id]) {
        return;
      }

      seen[id] = true;
      sanitized.push(id);
    });

    sanitized.sort(function (a, b) {
      return a.localeCompare(b, 'hr', { sensitivity: 'base' });
    });

    return sanitized;
  }

  async function synchronizeLinkedTournaments(tournamentId, nextLinkedIds, previousLinkedIds) {
    if (!tournamentId || !tournamentsCollection) {
      return;
    }

    var nextSet = {};
    var prevSet = {};
    (nextLinkedIds || []).forEach(function (id) { nextSet[id] = true; });
    (previousLinkedIds || []).forEach(function (id) { prevSet[id] = true; });

    var batch = db.batch();
    var hasUpdates = false;

    Object.keys(nextSet).forEach(function (id) {
      if (!id || id === tournamentId) {
        return;
      }

      batch.update(tournamentsCollection.doc(id), {
        linkedTournamentIds: firebase.firestore.FieldValue.arrayUnion(tournamentId)
      });
      hasUpdates = true;
    });

    Object.keys(prevSet).forEach(function (id) {
      if (!id || id === tournamentId || nextSet[id]) {
        return;
      }

      batch.update(tournamentsCollection.doc(id), {
        linkedTournamentIds: firebase.firestore.FieldValue.arrayRemove(tournamentId)
      });
      hasUpdates = true;
    });

    if (hasUpdates) {
      await batch.commit();
    }
  }

  async function deleteTournament(item) {
    if (!tournamentsCollection) {
      setStatus('Firebase nije spreman. Pokušaj ponovno.', true);
      return;
    }

    currentDeletingTournament = item;
    deleteConfirmationStep = 0;
    showDeleteConfirmStep1(item);
  }

  function showDeleteConfirmStep1(item) {
    deleteConfirmationStep = 1;
    deleteModalMessage.textContent =
      'Jeste li sigurni da želite izbrisati turnir za kolo ' +
      item.round +
      ' (' +
      formatDate(item.date, false) +
      ' ' +
      (item.time || '') +
      ')? Ova akcija će izbrisati sve bodove svih igrača s tog turnira.';
    deleteModalYes.textContent = 'Obriši';
    deleteModal.style.display = 'flex';
  }

  function showDeleteConfirmStep2(item) {
    deleteConfirmationStep = 2;
    deleteModalMessage.textContent =
      'Jeste li SIGURNI? Ova akcija se ne može vratiti. Bit će izbrisani svi bodovi svih igrača s turnira kolo ' +
      item.round +
      '.';
    deleteModalYes.textContent = 'DA, OBRIŠI';
  }

  function closeDeleteModal() {
    deleteModal.style.display = 'none';
    currentDeletingTournament = null;
    deleteConfirmationStep = 0;
  }

  async function performTournamentDelete() {
    if (!currentDeletingTournament) return;

    var item = currentDeletingTournament;
    var tournamentId = item.id;

    try {
      // Delete all scores for this tournament
      var scoresSnapshot = await db.collection('adminRoundScores').where('tournamentId', '==', tournamentId).get();

      var batch = db.batch();

      scoresSnapshot.docs.forEach(function (doc) {
        batch.delete(doc.ref);
      });

      // Also delete all table assignments for this tournament
      var assignmentsSnapshot = await db
        .collection('adminTableAssignments')
        .where('tournamentId', '==', tournamentId)
        .get();

      assignmentsSnapshot.docs.forEach(function (doc) {
        batch.delete(doc.ref);
      });

      var linkedSnapshot = await tournamentsCollection
        .where('linkedTournamentIds', 'array-contains', tournamentId)
        .get();

      linkedSnapshot.docs.forEach(function (doc) {
        if (doc.id === tournamentId) {
          return;
        }

        batch.update(doc.ref, {
          linkedTournamentIds: firebase.firestore.FieldValue.arrayRemove(tournamentId)
        });
      });

      // Delete the tournament itself
      batch.delete(tournamentsCollection.doc(tournamentId));

      await batch.commit();

      if (editingTournamentId === tournamentId) {
        form.reset();
        resetEditMode();
      }

      setStatus('Turnir i svi njegovi podaci su uspješno obrisani.', false);
      closeDeleteModal();
    } catch (error) {
      console.error(error);
      setStatus('Brisanje turnira nije uspjelo.', true);
      closeDeleteModal();
    }
  }

  function createMessage(text) {
    var p = document.createElement('p');
    p.className = 'admin-note';
    p.textContent = text;
    return p;
  }

  function renderVenueOptions() {
    var venues = allPartners
      .filter(function (partner) {
        return partner.active !== false && Array.isArray(partner.types) && partner.types.some(function(type) {
          return type.toLowerCase() === 'venue partner';
        });
      })
      .sort(function (a, b) {
        return (a.name || '').localeCompare((b.name || ''), 'hr', { sensitivity: 'base' });
      });

    venueSelect.innerHTML = '';

    var placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = venues.length ? 'Odaberi venue partnera' : 'Nema dostupnih venue partnera';
    venueSelect.appendChild(placeholder);

    venues.forEach(function (venue) {
      var option = document.createElement('option');
      option.value = venue.id;
      option.textContent = venue.name || '';
      option.dataset.name = venue.name || '';
      venueSelect.appendChild(option);
    });
  }

  function renderLinkedTournamentOptions() {
    var selectedSet = {};
    Array.prototype.forEach.call(linkedTournamentsSelect.options, function (option) {
      if (option.selected) {
        selectedSet[option.value] = true;
      }
    });

    if (editingTournamentId) {
      var currentItem = allTournaments.find(function (item) {
        return item.id === editingTournamentId;
      });
      var currentLinked = currentItem && Array.isArray(currentItem.linkedTournamentIds)
        ? currentItem.linkedTournamentIds
        : [];
      currentLinked.forEach(function (id) {
        selectedSet[id] = true;
      });
    }

    linkedTournamentsSelect.innerHTML = '';

    var options = allTournaments
      .filter(function (item) {
        return item.id !== editingTournamentId;
      })
      .slice()
      .sort(function (a, b) {
        if ((a.date || '') !== (b.date || '')) {
          return (a.date || '').localeCompare(b.date || '');
        }
        return compareRoundLabels(a.round, b.round);
      });

    options.forEach(function (item) {
      var option = document.createElement('option');
      option.value = item.id;
      option.textContent = getTournamentLabel(item);
      option.selected = !!selectedSet[item.id];
      linkedTournamentsSelect.appendChild(option);
    });
  }

  function renderTournamentFilters() {
    if (!filterRoundSelect || !filterVenueSelect) {
      return;
    }

    var selectedRound = filterRoundSelect.value;
    var selectedVenue = filterVenueSelect.value;

    var rounds = [];
    var roundSet = {};
    var venues = [];
    var venueSet = {};

    allTournaments.forEach(function (item) {
      var roundVal = String(item.round || '');
      if (roundVal && !roundSet[roundVal]) {
        roundSet[roundVal] = true;
        rounds.push(roundVal);
      }

      var venueVal = item.venueName || '';
      if (venueVal && !venueSet[venueVal]) {
        venueSet[venueVal] = true;
        venues.push(venueVal);
      }
    });

    rounds.sort(function (a, b) {
      return compareRoundLabels(a, b);
    });
    venues.sort(function (a, b) {
      return a.localeCompare(b, 'hr', { sensitivity: 'base' });
    });

    filterRoundSelect.innerHTML = '';
    var roundDefault = document.createElement('option');
    roundDefault.value = '';
    roundDefault.textContent = 'Sva kola';
    filterRoundSelect.appendChild(roundDefault);
    rounds.forEach(function (round) {
      var option = document.createElement('option');
      option.value = round;
      option.textContent = 'Kolo ' + round;
      filterRoundSelect.appendChild(option);
    });

    filterVenueSelect.innerHTML = '';
    var venueDefault = document.createElement('option');
    venueDefault.value = '';
    venueDefault.textContent = 'Svi venue partneri';
    filterVenueSelect.appendChild(venueDefault);
    venues.forEach(function (venueName) {
      var option = document.createElement('option');
      option.value = venueName;
      option.textContent = venueName;
      filterVenueSelect.appendChild(option);
    });

    filterRoundSelect.value = rounds.indexOf(selectedRound) !== -1 ? selectedRound : '';
    filterVenueSelect.value = venues.indexOf(selectedVenue) !== -1 ? selectedVenue : '';
  }

  function formatDate(dateValue, compactYear) {
    if (!dateValue) {
      return '';
    }

    var parts = dateValue.split('-');
    if (parts.length !== 3) {
      return dateValue;
    }

    var year = parts[0];
    if (compactYear) {
      year = year.slice(-2);
    }

    return parts[2] + '.' + parts[1] + '.' + year + '.';
  }

  function getLinkedTournamentDisplay(item) {
    var linkedIds = Array.isArray(item.linkedTournamentIds) ? item.linkedTournamentIds : [];
    var validIds = linkedIds.filter(function (id) {
      return !!id && id !== item.id;
    });

    if (!validIds.length) {
      return {
        hasLinks: false,
        text: '\u2014',
        title: 'Nema povezanih turnira.'
      };
    }

    var linkedItems = validIds.map(function (id) {
      for (var i = 0; i < allTournaments.length; i += 1) {
        if (allTournaments[i].id === id) {
          return allTournaments[i];
        }
      }
      return null;
    }).filter(function (value) {
      return !!value;
    });

    linkedItems.sort(function (a, b) {
      if ((a.date || '') !== (b.date || '')) {
        return (a.date || '').localeCompare(b.date || '');
      }
      return compareRoundLabels(a.round, b.round);
    });

    if (!linkedItems.length) {
      return {
        hasLinks: true,
        text: validIds.join(', '),
        title: 'Povezani ID-evi: ' + validIds.join(', ')
      };
    }

    var rounds = linkedItems.map(function (linkedItem) {
      return String(linkedItem.round || '?');
    });

    return {
      hasLinks: true,
      text: 'Kolo ' + rounds.join(', '),
      title: linkedItems.map(getTournamentLabel).join(' | ')
    };
  }

  function renderTournaments() {
    listEl.innerHTML = '';
    var isMobileCompact = !!(window.matchMedia && window.matchMedia('(max-width: 39.99rem)').matches);

    if (allTournaments.length === 0) {
      listEl.appendChild(createMessage('Nema dodanih turnira.'));
      return;
    }

    renderTournamentFilters();

    var selectedRound = filterRoundSelect ? filterRoundSelect.value : '';
    var selectedVenue = filterVenueSelect ? filterVenueSelect.value : '';

    var filtered = allTournaments.filter(function (item) {
      var roundOk = !selectedRound || String(item.round || '') === selectedRound;
      var venueOk = !selectedVenue || (item.venueName || '') === selectedVenue;
      return roundOk && venueOk;
    });

    if (filtered.length === 0) {
      listEl.appendChild(createMessage('Nema turnira za odabrane filtere.'));
      return;
    }

    var items = filtered.slice().sort(function (a, b) {
      if ((a.date || '') !== (b.date || '')) {
        return (a.date || '').localeCompare(b.date || '');
      }
      if (String(a.round || '') !== String(b.round || '')) {
        return compareRoundLabels(a.round, b.round);
      }
      if ((a.time || '') !== (b.time || '')) {
        return (a.time || '').localeCompare(b.time || '');
      }
      return (a.venueName || '').localeCompare((b.venueName || ''), 'hr', { sensitivity: 'base' });
    });

    var tableWrap = document.createElement('div');
    tableWrap.className = 'tournament-table-wrap';

    var table = document.createElement('table');
    table.className = 'tournament-table';

    var thead = document.createElement('thead');
    var headRow = document.createElement('tr');
    var statusIndex = isMobileCompact ? 4 : 5;
    var firstActionIndex = isMobileCompact ? 6 : 7;
    var secondActionIndex = firstActionIndex + 1;
    var thirdActionIndex = firstActionIndex + 2;
    var headLabels = isMobileCompact
      ? ['Kolo', 'Termin', 'Venue', 'Veze', 'Status', 'Zat.h', '', '', '']
      : ['Kolo', 'Datum', 'Vrijeme', 'Venue', 'Veze', 'Status', 'Zat.h', '', '', ''];

    headLabels.forEach(function (label, index) {
      var th = document.createElement('th');
      th.textContent = label;

      if (index === 0) {
        th.className = 'tournament-col-round';
      }
      if (isMobileCompact && index === 1) {
        th.className = 'tournament-col-termin';
      }
      if (index === statusIndex) {
        th.className = 'tournament-col-status';
        th.setAttribute('aria-label', 'Status');
      }
      if (index === firstActionIndex || index === secondActionIndex || index === thirdActionIndex) {
        th.className = 'tournament-action-head';
      }
      if (index === firstActionIndex) {
        th.setAttribute('aria-label', 'Uredi');
      }
      if (index === secondActionIndex) {
        th.setAttribute('aria-label', 'Aktivacija');
      }
      if (index === thirdActionIndex) {
        th.setAttribute('aria-label', 'Brisanje');
      }

      headRow.appendChild(th);
    });
    thead.appendChild(headRow);

    var tbody = document.createElement('tbody');

    items.forEach(function (item) {
      var row = document.createElement('tr');
      if (item.active === false) {
        row.className = 'tournament-row-inactive';
      }

      var tdRound = document.createElement('td');
      tdRound.textContent = String(item.round || '');
      tdRound.className = 'tournament-col-round';

      var tdDate = document.createElement('td');
      tdDate.textContent = formatDate(item.date, isMobileCompact);
      tdDate.className = isMobileCompact ? 'tournament-termin-cell tournament-col-termin' : '';

      var tdTime = null;
      if (!isMobileCompact) {
        tdTime = document.createElement('td');
        tdTime.textContent = item.time || '';
      } else {
        tdDate.textContent = formatDate(item.date, true) + ' ' + (item.time || '');
      }

      var tdVenue = document.createElement('td');
      tdVenue.textContent = item.venueName || '';
      tdVenue.className = 'tournament-venue-cell';

      var tdLinked = document.createElement('td');
      var linkedDisplay = getLinkedTournamentDisplay(item);
      var linkedWrap = document.createElement('div');
      linkedWrap.className = 'tournament-links-cell';

      var linkedBadge = document.createElement('span');
      linkedBadge.className = linkedDisplay.hasLinks
        ? 'tournament-links-badge tournament-links-badge-on'
        : 'tournament-links-badge tournament-links-badge-off';
      linkedBadge.textContent = linkedDisplay.hasLinks ? 'Povezano' : 'Nema veza';

      var linkedText = document.createElement('span');
      linkedText.className = 'tournament-links-text';
      linkedText.textContent = linkedDisplay.text;

      linkedWrap.appendChild(linkedBadge);
      linkedWrap.appendChild(linkedText);
      tdLinked.appendChild(linkedWrap);
      tdLinked.title = linkedDisplay.title;

      var tdStatus = document.createElement('td');
      tdStatus.className = 'tournament-col-status';
      tdStatus.textContent = isMobileCompact
        ? (item.active === false ? 'Off' : 'On')
        : (item.active === false ? 'Neaktivan' : 'Aktivan');

      var tdCloseHours = document.createElement('td');
      var closeHoursVal = item.registrationCloseHours;
      tdCloseHours.textContent = (closeHoursVal != null && closeHoursVal > 0) ? closeHoursVal + 'h' : '\u2014';
      tdCloseHours.className = 'tournament-close-hours-cell';

      var tdEdit = document.createElement('td');
      tdEdit.className = 'tournament-action-cell';
      var editButton = document.createElement('button');
      editButton.type = 'button';
      editButton.className = 'partner-action-btn tournament-icon-btn';
      editButton.textContent = '✎';
      editButton.setAttribute('aria-label', 'Uredi turnir');
      editButton.title = 'Uredi';
      editButton.addEventListener('click', function () {
        enableEditMode(item);
      });
      tdEdit.appendChild(editButton);

      var tdToggle = document.createElement('td');
      tdToggle.className = 'tournament-action-cell';
      var toggleButton = document.createElement('button');
      toggleButton.type = 'button';
      toggleButton.className = 'partner-action-btn partner-action-btn-secondary tournament-icon-btn';
      toggleButton.textContent = item.active === false ? 'On' : 'Off';
      toggleButton.setAttribute('aria-label', item.active === false ? 'Aktiviraj turnir' : 'Deaktiviraj turnir');
      toggleButton.title = item.active === false ? 'Aktiviraj' : 'Deaktiviraj';
      toggleButton.addEventListener('click', async function () {
        if (!tournamentsCollection) {
          setStatus('Firebase nije spreman. Pokušaj ponovno.', true);
          return;
        }

        try {
          await tournamentsCollection.doc(item.id).update({
            active: item.active === false
          });
          setStatus(
            item.active === false
              ? 'Turnir je ponovno aktiviran.'
              : 'Turnir je deaktiviran.',
            false
          );
        } catch (error) {
          console.error(error);
          setStatus('Promjena statusa turnira nije uspjela.', true);
        }
      });
      tdToggle.appendChild(toggleButton);

      var tdDelete = document.createElement('td');
      tdDelete.className = 'tournament-action-cell';
      var deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'partner-action-btn partner-action-btn-danger tournament-icon-btn';
      deleteButton.textContent = '✕';
      deleteButton.setAttribute('aria-label', 'Obriši turnir');
      deleteButton.title = 'Obriši';
      deleteButton.addEventListener('click', function () {
        deleteTournament(item);
      });
      tdDelete.appendChild(deleteButton);

      row.appendChild(tdRound);
      row.appendChild(tdDate);
      if (tdTime) {
        row.appendChild(tdTime);
      }
      row.appendChild(tdVenue);
      row.appendChild(tdLinked);
      row.appendChild(tdStatus);
      row.appendChild(tdCloseHours);
      row.appendChild(tdEdit);
      row.appendChild(tdToggle);
      row.appendChild(tdDelete);
      tbody.appendChild(row);
    });

    table.appendChild(thead);
    table.appendChild(tbody);
    tableWrap.appendChild(table);
    listEl.appendChild(tableWrap);
  }

  function initFirebaseConnections() {
    if (!window.firebase || !firebase.apps || !firebase.apps.length) {
      return false;
    }

    db = firebase.firestore();
    partnersCollection = db.collection('adminPartners');
    tournamentsCollection = db.collection('adminTournaments');
    return true;
  }

  function subscribeData() {
    partnersCollection.onSnapshot(function (snapshot) {
      allPartners = [];
      snapshot.forEach(function (doc) {
        var data = doc.data();
        data.id = doc.id;
        allPartners.push(data);
      });
      renderVenueOptions();
    }, function () {
      setStatus('Ne mogu dohvatiti venue partnere.', true);
    });

    tournamentsCollection.onSnapshot(function (snapshot) {
      allTournaments = [];
      snapshot.forEach(function (doc) {
        var data = doc.data();
        data.id = doc.id;
        allTournaments.push(data);
      });
      renderLinkedTournamentOptions();
      renderTournaments();
    }, function () {
      listEl.innerHTML = '';
      listEl.appendChild(createMessage('Ne mogu učitati turnire.'));
    });
  }

  function waitForFirebaseAndSubscribe() {
    var tries = 0;

    var timer = setInterval(function () {
      tries += 1;

      if (initFirebaseConnections()) {
        clearInterval(timer);
        subscribeData();
        return;
      }

      if (tries >= FIREBASE_WAIT_TRIES) {
        clearInterval(timer);
        setStatus('Firebase se nije učitao. Provjeri hosting konfiguraciju.', true);
      }
    }, FIREBASE_WAIT_MS);
  }

  form.addEventListener('submit', async function (event) {
    event.preventDefault();

    var venueId = venueSelect.value;
    var venueOption = venueSelect.options[venueSelect.selectedIndex];
    var venueName = venueOption ? venueOption.dataset.name || venueOption.textContent : '';
    var parsedRound = parseRoundLabel(roundInput.value);
    var round = parsedRound.normalized;
    var registrationCloseHours = parseInt(registrationCloseHoursInput.value, 10);
    var isActive = activeInput.value !== 'false';
    var isEditing = !!editingTournamentId;
    var selectedLinkedIds = Array.prototype
      .slice.call(linkedTournamentsSelect.options)
      .filter(function (option) { return option.selected; })
      .map(function (option) { return option.value; });

    if (!tournamentsCollection) {
      setStatus('Firebase nije spreman. Pričekaj trenutak i pokušaj ponovno.', true);
      return;
    }

    if (!dateInput.value) {
      setStatus('Odaberi datum turnira.', true);
      return;
    }

    if (!venueId) {
      setStatus('Odaberi venue partnera.', true);
      return;
    }

    if (!timeInput.value) {
      setStatus('Odaberi vrijeme turnira.', true);
      return;
    }

    if (!parsedRound.isValid) {
      setStatus('Unesi ispravnu oznaku kola (npr. 2 ili 2.a).', true);
      return;
    }

    if (isNaN(registrationCloseHours) || registrationCloseHours < 0) {
      setStatus('Unesi ispravan broj sati za zatvaranje prijava.', true);
      return;
    }

    setSubmitting(true);
    setStatus('Spremanje turnira u tijeku...', false);

    try {
      var previousLinkedIds = [];
      if (isEditing) {
        var editingItem = allTournaments.find(function (item) {
          return item.id === editingTournamentId;
        });
        previousLinkedIds = editingItem && Array.isArray(editingItem.linkedTournamentIds)
          ? editingItem.linkedTournamentIds
          : [];
      }

      var linkedTournamentIds = sanitizeLinkedTournamentIds(selectedLinkedIds, editingTournamentId);
      var payload = {
        date: dateInput.value,
        venueId: venueId,
        venueName: venueName,
        time: timeInput.value,
        round: round,
        registrationCloseHours: registrationCloseHours,
        maxCapacity: parseInt(maxCapacityInput.value, 10) || 0,
        active: isActive,
        linkedTournamentIds: linkedTournamentIds
      };

      if (isEditing) {
        await tournamentsCollection.doc(editingTournamentId).update(payload);
        await synchronizeLinkedTournaments(editingTournamentId, linkedTournamentIds, previousLinkedIds);
        form.reset();
        resetEditMode();
        setStatus('Turnir je uspješno ažuriran.', false);
      } else {
        payload.createdAt = firebase.firestore.FieldValue.serverTimestamp();
        var createdRef = await tournamentsCollection.add(payload);
        await synchronizeLinkedTournaments(createdRef.id, linkedTournamentIds, []);
        form.reset();
        resetEditMode();
        setStatus('Turnir je uspješno dodan.', false);
      }
    } catch (error) {
      console.error(error);
      setStatus('Spremanje nije uspjelo. Provjeri Firebase pravila i pokušaj ponovno.', true);
    } finally {
      setSubmitting(false);
    }
  });

  if (cancelEditButton) {
    cancelEditButton.addEventListener('click', function () {
      form.reset();
      resetEditMode();
      setStatus('Uređivanje otkazano.', false);
    });
  }

  if (filterRoundSelect) {
    filterRoundSelect.addEventListener('change', renderTournaments);
  }

  if (filterVenueSelect) {
    filterVenueSelect.addEventListener('change', renderTournaments);
  }

  // Delete modal event listeners
  if (deleteModalCancel) {
    deleteModalCancel.addEventListener('click', closeDeleteModal);
  }

  if (deleteModalYes) {
    deleteModalYes.addEventListener('click', function () {
      if (deleteConfirmationStep === 1) {
        if (currentDeletingTournament) {
          showDeleteConfirmStep2(currentDeletingTournament);
        }
      } else if (deleteConfirmationStep === 2) {
        performTournamentDelete();
      }
    });
  }

  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      closeDeleteModal();
    }
  });

  resetEditMode();
  waitForFirebaseAndSubscribe();
})();
