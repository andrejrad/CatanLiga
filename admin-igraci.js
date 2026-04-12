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

  if (!listEl || !statusEl || !searchInput) {
    return;
  }

  var allPlayers = [];
  var allRegistrations = [];
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
    ['Ime', 'Prezime', 'Email', 'Prijava', 'Akcije'].forEach(function (label) {
      var th = document.createElement('th');
      th.textContent = label;
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);

    var tbody = document.createElement('tbody');

    filtered.forEach(function (player) {
      var row = document.createElement('tr');

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

        allPlayers = buildPlayerList(allRegistrations);
        renderPlayers();
      },
      function (error) {
        console.error(error);
        listEl.innerHTML = '';
        listEl.appendChild(createMessage('Greška pri učitavanju igrača.'));
      }
    );
  });

  searchInput.addEventListener('input', function () {
    renderPlayers();
  });
})();
