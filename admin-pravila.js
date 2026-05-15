(function () {
  var MAX_PDF_SIZE_BYTES = 20 * 1024 * 1024;
  var MAX_NAZIV_LENGTH = 120;
  var MAX_OPIS_LENGTH = 500;
  var FIREBASE_WAIT_TRIES = 80;
  var FIREBASE_WAIT_MS = 125;

  var form = document.getElementById('pravilaForm');
  var nazivInput = document.getElementById('pravilaNaziv');
  var opisInput = document.getElementById('pravilaOpis');
  var pdfInput = document.getElementById('pravilaPdf');
  var statusEl = document.getElementById('pravilaFormStatus');
  var listEl = document.getElementById('pravilaList');
  var submitButton = document.getElementById('pravilaSubmitBtn');
  var cancelEditButton = document.getElementById('pravilaCancelEdit');

  var editingDocId = null;
  var allDocs = [];

  var db = null;
  var storage = null;
  var collection = null;

  if (!form || !nazivInput || !opisInput || !pdfInput || !statusEl || !listEl) {
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

  function sanitizeFileNamePart(value) {
    return value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function resetEditMode() {
    editingDocId = null;

    if (submitButton) {
      submitButton.textContent = 'Dodaj dokument';
    }

    if (cancelEditButton) {
      cancelEditButton.hidden = true;
    }

    pdfInput.required = true;
  }

  function enableEditMode(docData) {
    editingDocId = docData.id;

    nazivInput.value = docData.naziv || '';
    opisInput.value = docData.opis || '';

    if (submitButton) {
      submitButton.textContent = 'Spremi izmjene';
    }

    if (cancelEditButton) {
      cancelEditButton.hidden = false;
    }

    pdfInput.required = false;
    setStatus('Uređivanje dokumenta: "' + (docData.naziv || '') + '". PDF je opcionalan pri uređivanju.', false);
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function deleteDoc(docData) {
    if (!collection || !storage) {
      setStatus('Firebase nije spreman. Pokušaj ponovno.', true);
      return;
    }

    var confirmed = window.confirm('Obrisati dokument "' + (docData.naziv || '') + '"?');
    if (!confirmed) {
      return;
    }

    setStatus('Brisanje dokumenta u tijeku...', false);

    try {
      if (docData.pdfPath) {
        await storage.ref().child(docData.pdfPath).delete().catch(function (error) {
          if (error && error.code === 'storage/object-not-found') {
            return;
          }
          throw error;
        });
      }

      await collection.doc(docData.id).delete();

      if (editingDocId === docData.id) {
        form.reset();
        resetEditMode();
      }

      setStatus('Dokument je uspješno obrisan.', false);
    } catch (error) {
      console.error(error);
      setStatus('Brisanje dokumenta nije uspjelo.', true);
    }
  }

  function renderDoc(data) {
    var card = document.createElement('article');
    card.className = 'pravila-admin-card';

    var body = document.createElement('div');

    var title = document.createElement('h3');
    title.textContent = data.naziv || '';

    var opis = null;
    if (data.opis) {
      opis = document.createElement('p');
      opis.className = 'partner-meta';
      opis.textContent = data.opis;
    }

    var pdfLink = document.createElement('p');
    pdfLink.className = 'partner-meta';

    var anchor = document.createElement('a');
    anchor.href = data.pdfUrl || '#';
    anchor.target = '_blank';
    anchor.rel = 'noopener';
    anchor.className = 'contact-link';
    anchor.textContent = 'Otvori PDF';
    pdfLink.appendChild(anchor);

    var actions = document.createElement('div');
    actions.className = 'partner-actions';

    var editButton = document.createElement('button');
    editButton.type = 'button';
    editButton.className = 'partner-action-btn';
    editButton.textContent = 'Uredi';
    editButton.addEventListener('click', function () {
      enableEditMode(data);
    });

    var deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'partner-action-btn partner-action-btn-danger';
    deleteButton.textContent = 'Obriši';
    deleteButton.addEventListener('click', function () {
      deleteDoc(data);
    });

    body.appendChild(title);
    if (opis) {
      body.appendChild(opis);
    }
    body.appendChild(pdfLink);
    actions.appendChild(editButton);
    actions.appendChild(deleteButton);
    body.appendChild(actions);

    card.appendChild(body);
    return card;
  }

  function renderSnapshot(snapshot) {
    allDocs = [];
    snapshot.forEach(function (doc) {
      var data = doc.data();
      data.id = doc.id;
      allDocs.push(data);
    });

    listEl.innerHTML = '';

    if (allDocs.length === 0) {
      var empty = document.createElement('p');
      empty.className = 'admin-note';
      empty.textContent = 'Nema dodanih dokumenata.';
      listEl.appendChild(empty);
      return;
    }

    allDocs.forEach(function (docData) {
      listEl.appendChild(renderDoc(docData));
    });
  }

  function initFirebaseConnections() {
    if (!window.firebase || !firebase.apps || !firebase.apps.length) {
      return false;
    }

    db = firebase.firestore();
    storage = firebase.storage();
    collection = db.collection('adminPravila');
    return true;
  }

  function waitForFirebaseAndSubscribe() {
    var tries = 0;

    var timer = setInterval(function () {
      tries += 1;

      if (initFirebaseConnections()) {
        clearInterval(timer);
        collection
          .orderBy('createdAt', 'desc')
          .onSnapshot(renderSnapshot, function () {
            setStatus('Ne mogu dohvatiti dokumente iz baze.', true);
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

    var pdfFile = pdfInput.files && pdfInput.files[0];
    var naziv = nazivInput.value.trim();
    var opis = opisInput.value.trim();
    var isEditing = !!editingDocId;

    if (!collection || !storage) {
      setStatus('Firebase nije spreman. Pokušaj ponovno.', true);
      return;
    }

    if (!naziv) {
      setStatus('Naziv dokumenta je obavezan.', true);
      return;
    }

    if (naziv.length > MAX_NAZIV_LENGTH) {
      setStatus('Naziv je predugačak (max ' + MAX_NAZIV_LENGTH + ' znakova).', true);
      return;
    }

    if (opis.length > MAX_OPIS_LENGTH) {
      setStatus('Opis je predugačak (max ' + MAX_OPIS_LENGTH + ' znakova).', true);
      return;
    }

    if (!isEditing && !pdfFile) {
      setStatus('Odaberi PDF dokument.', true);
      return;
    }

    if (pdfFile) {
      if (pdfFile.type !== 'application/pdf') {
        setStatus('Odabrana datoteka nije PDF.', true);
        return;
      }

      if (pdfFile.size > MAX_PDF_SIZE_BYTES) {
        setStatus('PDF je prevelik. Maksimalna veličina je 20 MB.', true);
        return;
      }
    }

    setSubmitting(true);
    setStatus(isEditing ? 'Ažuriranje dokumenta...' : 'Učitavanje dokumenta...', false);

    try {
      var pdfUrl = null;
      var pdfPath = null;

      if (pdfFile) {
        var safeName = sanitizeFileNamePart(naziv);
        var timestamp = Date.now();
        pdfPath = 'pravila-pdf/' + safeName + '-' + timestamp + '.pdf';

        var uploadTask = storage.ref().child(pdfPath);
        var snapshot = await uploadTask.put(pdfFile, { contentType: 'application/pdf' });
        pdfUrl = await snapshot.ref.getDownloadURL();
      }

      if (isEditing) {
        var updateData = {
          naziv: naziv,
          opis: opis,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        if (pdfUrl && pdfPath) {
          var existingDoc = allDocs.find(function (d) { return d.id === editingDocId; });

          if (existingDoc && existingDoc.pdfPath) {
            await storage.ref().child(existingDoc.pdfPath).delete().catch(function (err) {
              if (err && err.code === 'storage/object-not-found') {
                return;
              }
              throw err;
            });
          }

          updateData.pdfUrl = pdfUrl;
          updateData.pdfPath = pdfPath;
        }

        await collection.doc(editingDocId).update(updateData);
        setStatus('Dokument je uspješno ažuriran.', false);
      } else {
        await collection.add({
          naziv: naziv,
          opis: opis,
          pdfUrl: pdfUrl,
          pdfPath: pdfPath,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        setStatus('Dokument je uspješno dodan.', false);
      }

      form.reset();
      resetEditMode();
    } catch (error) {
      console.error(error);
      setStatus(isEditing ? 'Ažuriranje nije uspjelo.' : 'Dodavanje dokumenta nije uspjelo.', true);
    } finally {
      setSubmitting(false);
    }
  });

  if (cancelEditButton) {
    cancelEditButton.addEventListener('click', function () {
      form.reset();
      resetEditMode();
      setStatus('', false);
    });
  }

  waitForFirebaseAndSubscribe();
})();
