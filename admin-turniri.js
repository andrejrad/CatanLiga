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

  if (!form || !dateInput || !venueSelect || !timeInput || !roundInput || !registrationCloseHoursInput || !maxCapacityInput || !activeInput || !statusEl || !listEl) {
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

  function resetEditMode() {
    editingTournamentId = null;
    activeInput.value = 'true';
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

    if (submitButton) {
      submitButton.textContent = 'Spremi izmjene';
    }
    if (cancelEditButton) {
      cancelEditButton.hidden = false;
    }

    setStatus('Uređivanje turnira: kolo ' + item.round + '.', false);
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
      return Number(a) - Number(b);
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
      if ((a.round || 0) !== (b.round || 0)) {
        return (a.round || 0) - (b.round || 0);
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
    var headLabels = isMobileCompact
      ? ['Kolo', 'Termin', 'Venue', 'Status', 'Zat.h', '', '', '']
      : ['Kolo', 'Datum', 'Vrijeme', 'Venue', 'Status', 'Zat.h', '', '', ''];

    headLabels.forEach(function (label, index) {
      var th = document.createElement('th');
      th.textContent = label;

      if (index === 0) {
        th.className = 'tournament-col-round';
      }
      if (isMobileCompact && index === 1) {
        th.className = 'tournament-col-termin';
      }
      if ((isMobileCompact && index === 3) || (!isMobileCompact && index === 4)) {
        th.className = 'tournament-col-status';
        th.setAttribute('aria-label', 'Status');
      }
      if ((isMobileCompact && (index === 5 || index === 6 || index === 7)) || (!isMobileCompact && (index === 6 || index === 7 || index === 8))) {
        th.className = 'tournament-action-head';
      }
      if ((isMobileCompact && index === 5) || (!isMobileCompact && index === 6)) {
        th.setAttribute('aria-label', 'Uredi');
      }
      if ((isMobileCompact && index === 6) || (!isMobileCompact && index === 7)) {
        th.setAttribute('aria-label', 'Aktivacija');
      }
      if ((isMobileCompact && index === 7) || (!isMobileCompact && index === 8)) {
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
    var round = parseInt(roundInput.value, 10);
    var registrationCloseHours = parseInt(registrationCloseHoursInput.value, 10);
    var isActive = activeInput.value !== 'false';
    var isEditing = !!editingTournamentId;

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

    if (!round || round < 1) {
      setStatus('Unesi ispravno kolo.', true);
      return;
    }

    if (isNaN(registrationCloseHours) || registrationCloseHours < 0) {
      setStatus('Unesi ispravan broj sati za zatvaranje prijava.', true);
      return;
    }

    setSubmitting(true);
    setStatus('Spremanje turnira u tijeku...', false);

    try {
      var payload = {
        date: dateInput.value,
        venueId: venueId,
        venueName: venueName,
        time: timeInput.value,
        round: round,
        registrationCloseHours: registrationCloseHours,
        maxCapacity: parseInt(maxCapacityInput.value, 10) || 0,
        active: isActive
      };

      if (isEditing) {
        await tournamentsCollection.doc(editingTournamentId).update(payload);
        form.reset();
        resetEditMode();
        setStatus('Turnir je uspješno ažuriran.', false);
      } else {
        payload.createdAt = firebase.firestore.FieldValue.serverTimestamp();
        await tournamentsCollection.add(payload);
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
