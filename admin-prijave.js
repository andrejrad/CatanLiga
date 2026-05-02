(function () {
  var FIREBASE_WAIT_TRIES = 80;
  var FIREBASE_WAIT_MS = 125;

  function resolveProjectId() {
    if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length > 0) {
      var app = firebase.apps[0];
      if (app && app.options && typeof app.options.projectId === 'string' && app.options.projectId.trim()) {
        return app.options.projectId.trim();
      }
    }

    // Hostname fallback for rare race conditions before Firebase init.
    if (window.location && typeof window.location.hostname === 'string') {
      if (window.location.hostname.indexOf('catan-liga-staging') !== -1) {
        return 'catan-liga-staging';
      }
    }

    return 'catan-liga';
  }

  function getMailFunctionBaseUrl() {
    var projectId = resolveProjectId();
    return 'https://us-central1-' + projectId + '.cloudfunctions.net';
  }
  var DEFAULT_TAB = 'overview';

  var tabButtons = Array.prototype.slice.call(document.querySelectorAll('[data-tab-target]'));
  var tabPanels = Array.prototype.slice.call(document.querySelectorAll('[data-tab-panel]'));

  var form = document.getElementById('registrationAdminForm');
  var firstNameInput = document.getElementById('registrationFirstName');
  var lastNameInput = document.getElementById('registrationLastName');
  var emailInput = document.getElementById('registrationEmail');
  var tournamentSelect = document.getElementById('registrationTournament');
  var noteInput = document.getElementById('registrationNote');
  var consentInput = document.getElementById('registrationConsent');
  var submitButton = document.getElementById('registrationSubmitBtn');
  var cancelEditButton = document.getElementById('registrationCancelEdit');
  var exportButton = document.getElementById('registrationsExportBtn');

  var listEl = document.getElementById('registrationsList');
  var statusEl = document.getElementById('registrationsStatus');
  var formStatusEl = document.getElementById('registrationFormStatus');
  var filterTournamentSelect = document.getElementById('registrationsFilterTournament');
  var searchInput = document.getElementById('registrationsSearch');
  var bulkTournamentSelect = document.getElementById('bulkEmailTournamentSelect');
  var bulkSubjectInput = document.getElementById('bulkEmailSubject');
  var bulkBodyInput = document.getElementById('bulkEmailBody');
  var bulkAdminPasswordInput = document.getElementById('bulkEmailAdminPassword');
  var bulkTournamentButton = document.getElementById('bulkEmailTournamentBtn');
  var bulkAllButton = document.getElementById('bulkEmailAllBtn');
  var bulkStatusEl = document.getElementById('bulkEmailStatus');
  var resetStagingDataButton = document.getElementById('resetStagingDataBtn');
  var resetStagingDataStatusEl = document.getElementById('resetStagingDataStatus');

  var db = null;
  var tournamentsCollection = null;
  var registrationsCollection = null;
  var allRegistrations = [];
  var activeTournaments = [];
  var editingRegistrationId = null;

  if (!form || !firstNameInput || !lastNameInput || !emailInput || !tournamentSelect || !noteInput || !consentInput || !submitButton || !cancelEditButton || !exportButton || !listEl || !statusEl || !formStatusEl || !filterTournamentSelect || !searchInput || !bulkTournamentSelect || !bulkSubjectInput || !bulkBodyInput || !bulkAdminPasswordInput || !bulkTournamentButton || !bulkAllButton || !bulkStatusEl) {
    return;
  }

  function setStatus(message, isError) {
    statusEl.textContent = message;
    statusEl.style.color = isError ? '#ffb6a6' : '#ffe680';
  }

  function setFormStatus(message, isError) {
    formStatusEl.textContent = message;
    formStatusEl.style.color = isError ? '#ffb6a6' : '#ffe680';
  }

  function setBulkStatus(message, isError) {
    bulkStatusEl.textContent = message;
    bulkStatusEl.style.color = isError ? '#ffb6a6' : '#ffe680';
  }

  function setResetStatus(message, isError) {
    if (!resetStagingDataStatusEl) {
      return;
    }

    resetStagingDataStatusEl.textContent = message;
    resetStagingDataStatusEl.style.color = isError ? '#ffb6a6' : '#ffe680';
  }

  function createMessage(text) {
    var p = document.createElement('p');
    p.className = 'admin-note';
    p.textContent = text;
    return p;
  }

  function setSubmitting(isSubmitting) {
    submitButton.disabled = isSubmitting;
    submitButton.style.opacity = isSubmitting ? '0.7' : '1';
    submitButton.style.cursor = isSubmitting ? 'not-allowed' : 'pointer';
  }

  function setBulkSubmitting(isSubmitting) {
    bulkTournamentButton.disabled = isSubmitting;
    bulkAllButton.disabled = isSubmitting;
    bulkTournamentButton.style.opacity = isSubmitting ? '0.7' : '1';
    bulkAllButton.style.opacity = isSubmitting ? '0.7' : '1';
    bulkTournamentButton.style.cursor = isSubmitting ? 'not-allowed' : 'pointer';
    bulkAllButton.style.cursor = isSubmitting ? 'not-allowed' : 'pointer';
  }

  function normalize(value) {
    return (value || '').trim();
  }

  function isStagingProject() {
    return resolveProjectId() === 'catan-liga-staging';
  }

  async function deleteCollectionInBatches(collectionName, batchSize) {
    var totalDeleted = 0;

    while (true) {
      var snapshot = await db.collection(collectionName).limit(batchSize).get();
      if (snapshot.empty) {
        break;
      }

      var batch = db.batch();
      snapshot.docs.forEach(function (doc) {
        batch.delete(doc.ref);
      });
      await batch.commit();
      totalDeleted += snapshot.size;
    }

    return totalDeleted;
  }

  async function resetStagingData() {
    if (!db) {
      setResetStatus('Firebase nije spreman. Pokušaj ponovno.', true);
      return;
    }

    if (!isStagingProject()) {
      setResetStatus('Reset je dozvoljen samo na staging projektu.', true);
      return;
    }

    var confirmed = window.confirm('Ovo će obrisati sve rasporede stolova i upisane bodove na STAGINGU. Nastaviti?');
    if (!confirmed) {
      setResetStatus('Reset podataka je otkazan.', true);
      return;
    }

    resetStagingDataButton.disabled = true;
    resetStagingDataButton.style.opacity = '0.7';
    resetStagingDataButton.style.cursor = 'not-allowed';
    setResetStatus('Brisanje staging podataka je u tijeku...', false);

    try {
      var deletedAssignments = await deleteCollectionInBatches('adminTableAssignments', 400);
      var deletedScores = await deleteCollectionInBatches('adminRoundScores', 400);

      setResetStatus(
        'Reset gotovo. Obrisano rasporeda: ' + deletedAssignments + ', bodova: ' + deletedScores + '.',
        false
      );
    } catch (error) {
      console.error(error);
      setResetStatus('Reset podataka nije uspio.', true);
    } finally {
      resetStagingDataButton.disabled = false;
      resetStagingDataButton.style.opacity = '1';
      resetStagingDataButton.style.cursor = 'pointer';
    }
  }

  function formatDateTime(dateObj) {
    if (!dateObj || isNaN(dateObj.getTime())) {
      return '-';
    }

    var dd = String(dateObj.getDate()).padStart(2, '0');
    var mm = String(dateObj.getMonth() + 1).padStart(2, '0');
    var yyyy = String(dateObj.getFullYear());
    var hh = String(dateObj.getHours()).padStart(2, '0');
    var min = String(dateObj.getMinutes()).padStart(2, '0');

    return dd + '.' + mm + '.' + yyyy + '. ' + hh + ':' + min;
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

  function resetEditMode() {
    editingRegistrationId = null;
    submitButton.textContent = 'Dodaj prijavu';
    cancelEditButton.hidden = true;
    form.reset();
  }

  function activateTab(tabName) {
    tabButtons.forEach(function (button) {
      var isActive = button.getAttribute('data-tab-target') === tabName;
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });

    tabPanels.forEach(function (panel) {
      var isActive = panel.getAttribute('data-tab-panel') === tabName;
      panel.classList.toggle('is-active', isActive);
      panel.hidden = !isActive;
    });
  }

  function enableEditMode(item) {
    editingRegistrationId = item.id;
    firstNameInput.value = item.firstName || '';
    lastNameInput.value = item.lastName || '';
    emailInput.value = item.email || '';
    noteInput.value = item.note || '';
    consentInput.checked = !!item.consentAccepted;

    tournamentSelect.value = item.tournamentId || '';
    if (!tournamentSelect.value && item.tournamentLabel) {
      for (var i = 0; i < tournamentSelect.options.length; i++) {
        if (tournamentSelect.options[i].dataset && tournamentSelect.options[i].dataset.label === item.tournamentLabel) {
          tournamentSelect.selectedIndex = i;
          break;
        }
      }
    }

    submitButton.textContent = 'Spremi izmjene';
    cancelEditButton.hidden = false;
    activateTab('create');
    setFormStatus('Uređivanje prijave: ' + (item.firstName || '') + ' ' + (item.lastName || '') + '.', false);
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderTournamentOptions() {
    tournamentSelect.innerHTML = '';
    bulkTournamentSelect.innerHTML = '';

    var placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = activeTournaments.length ? 'Odaberi turnir' : 'Trenutno nema turnira';
    tournamentSelect.appendChild(placeholder);

    var bulkPlaceholder = document.createElement('option');
    bulkPlaceholder.value = '';
    bulkPlaceholder.textContent = activeTournaments.length ? 'Odaberi turnir' : 'Trenutno nema turnira';
    bulkTournamentSelect.appendChild(bulkPlaceholder);

    activeTournaments.forEach(function (item) {
      var option = document.createElement('option');
      option.value = item.id;
      option.textContent = 'Kolo ' + item.round + ' - ' + formatDate(item.date) + ' ' + (item.time || '') + ' - ' + (item.venueName || '');
      option.dataset.label = option.textContent;
      tournamentSelect.appendChild(option);

      var bulkOption = document.createElement('option');
      bulkOption.value = item.id;
      bulkOption.textContent = option.textContent;
      bulkOption.dataset.label = option.textContent;
      bulkTournamentSelect.appendChild(bulkOption);
    });

    tournamentSelect.disabled = !activeTournaments.length;
    bulkTournamentSelect.disabled = !activeTournaments.length;
  }

  function getBulkFormPayload() {
    var tournamentId = bulkTournamentSelect.value;
    var selectedOption = bulkTournamentSelect.options[bulkTournamentSelect.selectedIndex];
    var tournamentLabel = selectedOption ? selectedOption.dataset.label || selectedOption.textContent : '';

    return {
      tournamentId: tournamentId,
      tournamentLabel: tournamentLabel,
      subject: normalize(bulkSubjectInput.value),
      body: normalize(bulkBodyInput.value),
      adminPassword: normalize(bulkAdminPasswordInput.value)
    };
  }

  async function callMailFunction(path, payload) {
    var response = await fetch(getMailFunctionBaseUrl() + path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    var data = null;
    try {
      data = await response.json();
    } catch (error) {
      data = null;
    }

    if (!response.ok || !data || data.ok !== true) {
      var message = data && data.error ? data.error : 'Slanje maila nije uspjelo.';
      throw new Error(message);
    }

    return data;
  }

  async function sendBulkTournamentEmail() {
    var payload = getBulkFormPayload();

    if (!payload.tournamentId) {
      setBulkStatus('Odaberi turnir za slanje.', true);
      return;
    }

    if (!payload.subject) {
      setBulkStatus('Upiši naslov maila.', true);
      return;
    }

    if (!payload.body) {
      setBulkStatus('Upiši tekst maila.', true);
      return;
    }

    if (!payload.adminPassword) {
      setBulkStatus('Upiši admin lozinku za potvrdu slanja.', true);
      return;
    }

    setBulkSubmitting(true);
    setBulkStatus('Slanje maila za odabrano kolo je u tijeku...', false);

    try {
      var result = await callMailFunction('/sendBulkTournamentEmail', payload);
      var sent = result.result && result.result.totalRecipients ? result.result.totalRecipients : 0;
      setBulkStatus('Mail je poslan za odabrano kolo. Primatelja: ' + sent + '.', false);
      bulkAdminPasswordInput.value = '';
    } catch (error) {
      console.error(error);
      setBulkStatus(error.message || 'Slanje maila nije uspjelo.', true);
    } finally {
      setBulkSubmitting(false);
    }
  }

  async function sendBulkAllPlayersEmail() {
    var payload = getBulkFormPayload();

    if (!payload.subject) {
      setBulkStatus('Upiši naslov maila.', true);
      return;
    }

    if (!payload.body) {
      setBulkStatus('Upiši tekst maila.', true);
      return;
    }

    if (!payload.adminPassword) {
      setBulkStatus('Upiši admin lozinku za potvrdu slanja.', true);
      return;
    }

    var confirmed = window.confirm('Poslati mail svim igračima u bazi?');
    if (!confirmed) {
      setBulkStatus('Slanje svim igračima je otkazano.', true);
      return;
    }

    setBulkSubmitting(true);
    setBulkStatus('Slanje maila svim igračima je u tijeku...', false);

    try {
      var result = await callMailFunction('/sendBulkAllPlayersEmail', payload);
      var sent = result.result && result.result.totalRecipients ? result.result.totalRecipients : 0;
      setBulkStatus('Mail je poslan svim igračima. Primatelja: ' + sent + '.', false);
      bulkAdminPasswordInput.value = '';
    } catch (error) {
      console.error(error);
      setBulkStatus(error.message || 'Slanje maila nije uspjelo.', true);
    } finally {
      setBulkSubmitting(false);
    }
  }

  function loadActiveTournaments() {
    if (!tournamentsCollection) {
      return;
    }

    tournamentsCollection
      .orderBy('date', 'asc')
      .get()
      .then(function (snapshot) {
        var list = [];

        snapshot.forEach(function (doc) {
          var data = doc.data();
          if (!data.date || !data.time) {
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

        activeTournaments = list;
        renderTournamentOptions();
      })
      .catch(function (error) {
        console.error(error);
        activeTournaments = [];
        renderTournamentOptions();
        setStatus('Ne mogu učitati turnire.', true);
      });
  }

  function renderFilters() {
    var selected = filterTournamentSelect.value;
    var seen = {};
    var labels = [];

    allRegistrations.forEach(function (item) {
      var label = item.tournamentLabel || 'Nepoznati turnir';
      if (!seen[label]) {
        seen[label] = true;
        labels.push(label);
      }
    });

    labels.sort(function (a, b) {
      return a.localeCompare(b, 'hr', { sensitivity: 'base' });
    });

    filterTournamentSelect.innerHTML = '';
    var defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = 'Svi turniri';
    filterTournamentSelect.appendChild(defaultOption);

    labels.forEach(function (label) {
      var option = document.createElement('option');
      option.value = label;
      option.textContent = label;
      filterTournamentSelect.appendChild(option);
    });

    filterTournamentSelect.value = seen[selected] ? selected : '';
  }

  function renderTable(items) {
    var wrap = document.createElement('div');
    wrap.className = 'tournament-table-wrap';

    var table = document.createElement('table');
    table.className = 'tournament-table';

    var thead = document.createElement('thead');
    var headRow = document.createElement('tr');
    ['✓', 'Ime i prezime', 'Email', 'Napomena', 'Vrijeme prijave', '', ''].forEach(function (label, index) {
      var th = document.createElement('th');
      if (index === 0) {
        th.innerHTML = '<span title="Prisutan">✓</span>';
        th.style.width = '3rem';
        th.style.textAlign = 'center';
      } else {
        th.textContent = label;
      }
      if (index >= 5) {
        th.className = 'tournament-action-head';
      }
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);

    var tbody = document.createElement('tbody');
    items.forEach(function (item) {
      var row = document.createElement('tr');

      var attendedTd = document.createElement('td');
      attendedTd.style.textAlign = 'center';
      var attendedCheckbox = document.createElement('input');
      attendedCheckbox.type = 'checkbox';
      attendedCheckbox.checked = !!item.attended;
      attendedCheckbox.addEventListener('change', async function() {
        try {
          await registrationsCollection.doc(item.id).update({
            attended: attendedCheckbox.checked
          });
        } catch (error) {
          console.error(error);
          attendedCheckbox.checked = !attendedCheckbox.checked;
          setStatus('Ažuriranje prisustva nije uspjelo.', true);
        }
      });
      attendedTd.appendChild(attendedCheckbox);

      var fullNameTd = document.createElement('td');
      fullNameTd.textContent = (item.firstName || '') + ' ' + (item.lastName || '');

      var emailTd = document.createElement('td');
      emailTd.textContent = item.email || '-';

      var noteTd = document.createElement('td');
      noteTd.textContent = item.note || '-';

      var createdTd = document.createElement('td');
      createdTd.textContent = formatDateTime(item.createdAtDate);

      var editTd = document.createElement('td');
      editTd.className = 'tournament-action-cell';
      var editButton = document.createElement('button');
      editButton.type = 'button';
      editButton.className = 'partner-action-btn tournament-icon-btn';
      editButton.textContent = '✎';
      editButton.title = 'Uredi';
      editButton.setAttribute('aria-label', 'Uredi prijavu');
      editButton.addEventListener('click', function () {
        enableEditMode(item);
      });
      editTd.appendChild(editButton);

      var deleteTd = document.createElement('td');
      deleteTd.className = 'tournament-action-cell';
      var deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'partner-action-btn partner-action-btn-danger tournament-icon-btn';
      deleteButton.textContent = '✕';
      deleteButton.title = 'Obriši';
      deleteButton.setAttribute('aria-label', 'Obriši prijavu');
      deleteButton.addEventListener('click', async function () {
        var confirmed = window.confirm('Obrisati prijavu za ' + (item.firstName || '') + ' ' + (item.lastName || '') + '?');
        if (!confirmed) {
          return;
        }

        try {
          await registrationsCollection.doc(item.id).delete();
          if (editingRegistrationId === item.id) {
            resetEditMode();
          }
          setStatus('Prijava je obrisana.', false);
        } catch (error) {
          console.error(error);
          setStatus('Brisanje prijave nije uspjelo.', true);
        }
      });
      deleteTd.appendChild(deleteButton);

      row.appendChild(attendedTd);
      row.appendChild(fullNameTd);
      row.appendChild(emailTd);
      row.appendChild(noteTd);
      row.appendChild(createdTd);
      row.appendChild(editTd);
      row.appendChild(deleteTd);
      tbody.appendChild(row);
    });

    table.appendChild(thead);
    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
  }

  function getFilteredRegistrations() {
    var selectedTournament = filterTournamentSelect.value;
    var searchText = searchInput.value.trim().toLowerCase();

    var filtered = allRegistrations.filter(function (item) {
      var fullName = ((item.firstName || '') + ' ' + (item.lastName || '')).trim().toLowerCase();
      var email = (item.email || '').toLowerCase();
      var tournamentLabel = (item.tournamentLabel || '').toLowerCase();

      var tournamentOk = !selectedTournament || (item.tournamentLabel || '') === selectedTournament;
      var searchOk = !searchText
        || fullName.indexOf(searchText) !== -1
        || email.indexOf(searchText) !== -1
        || tournamentLabel.indexOf(searchText) !== -1;

      return tournamentOk && searchOk;
    });

    filtered.sort(function (a, b) {
      return (b.createdAtDate ? b.createdAtDate.getTime() : 0) - (a.createdAtDate ? a.createdAtDate.getTime() : 0);
    });

    return filtered;
  }

  function csvEscape(value) {
    var stringValue = String(value == null ? '' : value);
    return '"' + stringValue.replace(/"/g, '""') + '"';
  }

  function exportFilteredRegistrationsToCsv() {
    var filtered = getFilteredRegistrations();
    if (!filtered.length) {
      setStatus('Nema prijava za export prema trenutnom filteru.', true);
      return;
    }

    var rows = [];
    rows.push([
      'Ime',
      'Prezime',
      'Email',
      'Turnir',
      'Napomena',
      'Vrijeme prijave'
    ].map(csvEscape).join(','));

    filtered.forEach(function (item) {
      rows.push([
        item.firstName || '',
        item.lastName || '',
        item.email || '',
        item.tournamentLabel || '',
        item.note || '',
        formatDateTime(item.createdAtDate)
      ].map(csvEscape).join(','));
    });

    var csv = '\uFEFF' + rows.join('\n');
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);

    var now = new Date();
    var timestamp = now.getFullYear()
      + String(now.getMonth() + 1).padStart(2, '0')
      + String(now.getDate()).padStart(2, '0')
      + '-'
      + String(now.getHours()).padStart(2, '0')
      + String(now.getMinutes()).padStart(2, '0');

    var link = document.createElement('a');
    link.href = url;
    link.download = 'prijave-' + timestamp + '.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    setStatus('CSV export je uspješno pripremljen.', false);
  }

  function applyFilters() {
    listEl.innerHTML = '';
    
    var selectedTournament = filterTournamentSelect.value;
    if (!selectedTournament) {
      setStatus('Ukupno prijava: 0.', false);
    } else {
      var tournamentOnlyCount = allRegistrations.filter(function (item) {
        return (item.tournamentLabel || '') === selectedTournament;
      }).length;
      setStatus('Ukupno prijava: ' + tournamentOnlyCount + '.', false);
    }
    
    if (!selectedTournament) {
      listEl.appendChild(createMessage('Odaberi turnir za prikaz prijava.'));
      return;
    }

    if (!allRegistrations.length) {
      listEl.appendChild(createMessage('Još nema prijava.'));
      return;
    }

    var filtered = getFilteredRegistrations();

    if (!filtered.length) {
      listEl.appendChild(createMessage('Nema prijava za odabrani turnir.'));
      return;
    }

    listEl.appendChild(renderTable(filtered));
  }

  function renderSnapshot(snapshot) {
    allRegistrations = [];

    snapshot.forEach(function (doc) {
      var data = doc.data();
      var createdAtDate = null;
      if (data.createdAt && typeof data.createdAt.toDate === 'function') {
        createdAtDate = data.createdAt.toDate();
      }
      data.createdAtDate = createdAtDate;
      data.id = doc.id;
      allRegistrations.push(data);
    });

    renderFilters();
    applyFilters();
  }

  function initFirebaseConnections() {
    if (!window.firebase || !firebase.apps || !firebase.apps.length) {
      return false;
    }

    db = firebase.firestore();
    tournamentsCollection = db.collection('adminTournaments');
    registrationsCollection = db.collection('registrations');

    if (resetStagingDataButton) {
      resetStagingDataButton.hidden = !isStagingProject();
    }

    return true;
  }

  function waitForFirebaseAndSubscribe() {
    var tries = 0;

    var timer = setInterval(function () {
      tries += 1;

      if (initFirebaseConnections()) {
        clearInterval(timer);
        loadActiveTournaments();
        registrationsCollection.onSnapshot(renderSnapshot, function (error) {
          console.error(error);
          listEl.innerHTML = '';
          listEl.appendChild(createMessage('Ne mogu učitati prijave.'));
          setStatus('Dohvat prijava nije uspio.', true);
        });
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

    var firstName = normalize(firstNameInput.value);
    var lastName = normalize(lastNameInput.value);
    var email = normalize(emailInput.value).toLowerCase();
    var tournamentId = tournamentSelect.value;
    var note = normalize(noteInput.value);
    var consent = !!consentInput.checked;
    var isEditing = !!editingRegistrationId;

    if (!registrationsCollection) {
      setFormStatus('Firebase nije spreman. Pokušaj ponovno.', true);
      return;
    }

    if (!firstName) {
      setFormStatus('Unesi ime.', true);
      return;
    }

    if (!lastName) {
      setFormStatus('Unesi prezime.', true);
      return;
    }

    if (!email || email.indexOf('@') === -1) {
      setFormStatus('Unesi ispravan email.', true);
      return;
    }

    if (!tournamentId) {
      setFormStatus('Odaberi turnir.', true);
      return;
    }

    if (!consent) {
      setFormStatus('Potrebno je prihvatiti Pravila Korištenja i Politiku Privatnosti.', true);
      return;
    }

    var selectedOption = tournamentSelect.options[tournamentSelect.selectedIndex];
    var tournamentLabel = selectedOption ? selectedOption.dataset.label || selectedOption.textContent : '';

    var payload = {
      firstName: firstName,
      lastName: lastName,
      email: email,
      tournamentId: tournamentId,
      tournamentLabel: tournamentLabel,
      note: note,
      consentAccepted: true
    };

    setSubmitting(true);
    setFormStatus('Provjera duplikata...', false);

    try {
      var dupSnap = await registrationsCollection
        .where('email', '==', email)
        .where('tournamentId', '==', tournamentId)
        .get();

      var duplicate = dupSnap.docs.find(function (doc) {
        return doc.id !== editingRegistrationId;
      });

      if (duplicate) {
        setFormStatus('Ovaj email je već prijavljen za odabrani turnir.', true);
        setSubmitting(false);
        return;
      }
    } catch (error) {
      console.error(error);
      setFormStatus('Provjera duplikata nije uspjela. Pokušaj ponovno.', true);
      setSubmitting(false);
      return;
    }

    setFormStatus(isEditing ? 'Spremanje izmjena u tijeku...' : 'Spremanje prijave u tijeku...', false);

    try {
      if (isEditing) {
        await registrationsCollection.doc(editingRegistrationId).update(payload);
        resetEditMode();
        setFormStatus('Prijava je uspješno ažurirana.', false);
      } else {
        payload.createdAt = firebase.firestore.FieldValue.serverTimestamp();
        await registrationsCollection.add(payload);
        resetEditMode();
        setFormStatus('Prijava je uspješno dodana.', false);
      }
    } catch (error) {
      console.error(error);
      setFormStatus(isEditing ? 'Ažuriranje prijave nije uspjelo.' : 'Dodavanje prijave nije uspjelo.', true);
    } finally {
      setSubmitting(false);
    }
  });

  cancelEditButton.addEventListener('click', function () {
    resetEditMode();
    setFormStatus('Uređivanje prijave je otkazano.', false);
  });

  exportButton.addEventListener('click', exportFilteredRegistrationsToCsv);
  bulkTournamentButton.addEventListener('click', sendBulkTournamentEmail);
  bulkAllButton.addEventListener('click', sendBulkAllPlayersEmail);
  if (resetStagingDataButton) {
    resetStagingDataButton.addEventListener('click', resetStagingData);
  }

  tabButtons.forEach(function (button) {
    button.addEventListener('click', function () {
      activateTab(button.getAttribute('data-tab-target') || DEFAULT_TAB);
    });
  });

  filterTournamentSelect.addEventListener('change', applyFilters);
  searchInput.addEventListener('input', applyFilters);

  activateTab(DEFAULT_TAB);
  resetEditMode();
  setFormStatus('', false);
  setBulkStatus('', false);
  setResetStatus('', false);
  waitForFirebaseAndSubscribe();
})();
