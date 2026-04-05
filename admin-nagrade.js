(function () {
  var MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;
  var FIREBASE_WAIT_TRIES = 80;
  var FIREBASE_WAIT_MS = 125;

  var form = document.getElementById('awardForm');
  var placeInput = document.getElementById('awardPlace');
  var descriptionInput = document.getElementById('awardDescription');
  var imageInput = document.getElementById('awardImage');
  var sponsorInput = document.getElementById('awardSponsor');
  var sponsorWebInput = document.getElementById('awardSponsorWeb');
  var statusEl = document.getElementById('awardFormStatus');
  var listEl = document.getElementById('awardsList');
  var submitButton = document.getElementById('awardSubmitBtn');
  var cancelEditButton = document.getElementById('awardCancelEdit');

  var db = null;
  var storage = null;
  var awardsCollection = null;
  var editingAwardId = null;
  var editingAwardData = null;

  if (!form || !placeInput || !descriptionInput || !imageInput || !sponsorInput || !sponsorWebInput || !statusEl || !listEl || !submitButton) {
    return;
  }

  function normalizeWebUrl(value) {
    var trimmed = value.trim();
    if (!trimmed) {
      return '';
    }

    if (/^https?:\/\//i.test(trimmed)) {
      return trimmed;
    }

    return 'https://' + trimmed;
  }

  function sanitizeFileNamePart(value) {
    return value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function setStatus(message, isError) {
    statusEl.textContent = message;
    statusEl.style.color = isError ? '#ffb6a6' : '#ffe680';
  }

  function setSubmitting(isSubmitting) {
    submitButton.disabled = isSubmitting;
    submitButton.style.opacity = isSubmitting ? '0.7' : '1';
    submitButton.style.cursor = isSubmitting ? 'not-allowed' : 'pointer';
  }

  function createMessage(text) {
    var p = document.createElement('p');
    p.className = 'admin-note';
    p.textContent = text;
    return p;
  }

  function resetEditMode() {
    editingAwardId = null;
    editingAwardData = null;
    imageInput.required = true;

    submitButton.textContent = 'Dodaj nagradu';
    if (cancelEditButton) {
      cancelEditButton.hidden = true;
    }
  }

  function enableEditMode(item) {
    editingAwardId = item.id;
    editingAwardData = item;

    placeInput.value = item.place || '';
    descriptionInput.value = item.description || '';
    sponsorInput.value = item.sponsor || '';
    sponsorWebInput.value = item.sponsorWeb || '';

    imageInput.required = false;
    submitButton.textContent = 'Spremi izmjene';
    if (cancelEditButton) {
      cancelEditButton.hidden = false;
    }

    setStatus('Uredivanje nagrade za mjesto #' + String(item.place || '') + '. Slika je opcionalna.', false);
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderAwards(snapshot) {
    var items = [];
    snapshot.forEach(function (doc) {
      var data = doc.data();
      data.id = doc.id;
      items.push(data);
    });

    items.sort(function (a, b) {
      var placeA = Number(a.place || 0);
      var placeB = Number(b.place || 0);
      if (placeA !== placeB) {
        return placeA - placeB;
      }
      return (a.sponsor || '').localeCompare((b.sponsor || ''), 'hr', { sensitivity: 'base' });
    });

    listEl.innerHTML = '';

    if (!items.length) {
      listEl.appendChild(createMessage('Nema dodanih nagrada.'));
      return;
    }

    items.forEach(function (item) {
      var card = document.createElement('article');
      card.className = 'award-card';

      var image = document.createElement('img');
      image.src = item.imageUrl || '';
      image.alt = 'Nagrada za mjesto ' + String(item.place || '');

      var body = document.createElement('div');

      var title = document.createElement('h3');
      title.textContent = 'Mjesto #' + String(item.place || '');

      var description = document.createElement('p');
      description.className = 'partner-meta';
      description.textContent = item.description || '';

      var sponsor = document.createElement('p');
      sponsor.className = 'partner-meta';
      sponsor.textContent = 'Sponsor: ' + (item.sponsor || '');

      var sponsorWeb = document.createElement('p');
      sponsorWeb.className = 'partner-meta';
      sponsorWeb.textContent = 'Web: ';

      var webLink = document.createElement('a');
      webLink.className = 'contact-link';
      webLink.target = '_blank';
      webLink.rel = 'noopener';
      webLink.href = normalizeWebUrl(item.sponsorWeb || '');
      webLink.textContent = item.sponsorWeb || '';
      sponsorWeb.appendChild(webLink);

      var actions = document.createElement('div');
      actions.className = 'partner-actions';

      var editButton = document.createElement('button');
      editButton.type = 'button';
      editButton.className = 'partner-action-btn';
      editButton.textContent = 'Uredi';
      editButton.addEventListener('click', function () {
        enableEditMode(item);
      });

      var deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'partner-action-btn partner-action-btn-secondary';
      deleteButton.textContent = 'Obrisi';
      deleteButton.addEventListener('click', async function () {
        if (!awardsCollection || !storage) {
          setStatus('Firebase nije spreman. Pokusaj ponovno.', true);
          return;
        }

        var confirmed = window.confirm('Zelis obrisati ovu nagradu?');
        if (!confirmed) {
          return;
        }

        try {
          if (item.imagePath) {
            await storage.ref(item.imagePath).delete();
          }
          await awardsCollection.doc(item.id).delete();

          if (editingAwardId === item.id) {
            form.reset();
            resetEditMode();
          }

          setStatus('Nagrada je obrisana.', false);
        } catch (error) {
          console.error(error);
          setStatus('Brisanje nagrade nije uspjelo.', true);
        }
      });

      actions.appendChild(editButton);
      actions.appendChild(deleteButton);

      body.appendChild(title);
      body.appendChild(description);
      body.appendChild(sponsor);
      body.appendChild(sponsorWeb);
      body.appendChild(actions);

      card.appendChild(image);
      card.appendChild(body);
      listEl.appendChild(card);
    });
  }

  function initFirebaseConnections() {
    if (!window.firebase || !firebase.apps || !firebase.apps.length) {
      return false;
    }

    db = firebase.firestore();
    storage = firebase.storage();
    awardsCollection = db.collection('adminAwards');
    return true;
  }

  function waitForFirebaseAndSubscribe() {
    var tries = 0;

    var timer = setInterval(function () {
      tries += 1;

      if (initFirebaseConnections()) {
        clearInterval(timer);

        awardsCollection
          .orderBy('place', 'asc')
          .onSnapshot(renderAwards, function () {
            listEl.innerHTML = '';
            listEl.appendChild(createMessage('Ne mogu ucitati nagrade iz baze.'));
          });

        return;
      }

      if (tries >= FIREBASE_WAIT_TRIES) {
        clearInterval(timer);
        setStatus('Firebase se nije ucitao. Provjeri hosting konfiguraciju.', true);
      }
    }, FIREBASE_WAIT_MS);
  }

  form.addEventListener('submit', async function (event) {
    event.preventDefault();

    var place = parseInt(placeInput.value, 10);
    var description = descriptionInput.value.trim();
    var imageFile = imageInput.files && imageInput.files[0];
    var sponsor = sponsorInput.value.trim();
    var sponsorWeb = sponsorWebInput.value.trim();
    var isEditing = !!editingAwardId;

    if (!awardsCollection || !storage) {
      setStatus('Firebase nije spreman. Pricekaj trenutak i pokusaj ponovno.', true);
      return;
    }

    if (!place || place < 1) {
      setStatus('Unesi ispravno mjesto na turniru.', true);
      return;
    }

    if (!description) {
      setStatus('Opis nagrade je obavezan.', true);
      return;
    }

    if (!isEditing && !imageFile) {
      setStatus('Slika nagrade je obavezna.', true);
      return;
    }

    if (imageFile) {
      if (!imageFile.type || imageFile.type.indexOf('image/') !== 0) {
        setStatus('Dozvoljen je samo upload slika.', true);
        return;
      }

      if (imageFile.size > MAX_IMAGE_SIZE_BYTES) {
        setStatus('Slika je prevelika. Maksimalna velicina je 10MB.', true);
        return;
      }
    }

    if (!sponsor) {
      setStatus('Sponsor je obavezan.', true);
      return;
    }

    if (!sponsorWeb) {
      setStatus('Sponsor web link je obavezan.', true);
      return;
    }

    setSubmitting(true);
    setStatus(isEditing ? 'Spremanje izmjena je u tijeku...' : 'Spremanje nagrade je u tijeku...', false);

    try {
      var payload = {
        place: place,
        description: description,
        sponsor: sponsor,
        sponsorWeb: sponsorWeb,
      };

      if (isEditing) {
        if (imageFile) {
          var newFilePath = 'award-images/'
            + Date.now()
            + '-'
            + place
            + '-'
            + sanitizeFileNamePart(imageFile.name);

          var newImageRef = storage.ref(newFilePath);
          await newImageRef.put(imageFile);
          var newImageUrl = await newImageRef.getDownloadURL();

          payload.imageUrl = newImageUrl;
          payload.imagePath = newFilePath;

          if (editingAwardData && editingAwardData.imagePath) {
            try {
              await storage.ref(editingAwardData.imagePath).delete();
            } catch (deleteError) {
              console.warn(deleteError);
            }
          }
        }

        await awardsCollection.doc(editingAwardId).update(payload);
        form.reset();
        resetEditMode();
        setStatus('Nagrada je uspjesno azurirana.', false);
      } else {
        var filePath = 'award-images/'
          + Date.now()
          + '-'
          + place
          + '-'
          + sanitizeFileNamePart(imageFile.name);

        var imageRef = storage.ref(filePath);
        await imageRef.put(imageFile);
        var imageUrl = await imageRef.getDownloadURL();

        payload.imageUrl = imageUrl;
        payload.imagePath = filePath;
        payload.createdAt = firebase.firestore.FieldValue.serverTimestamp();

        await awardsCollection.add(payload);
        form.reset();
        resetEditMode();
        setStatus('Nagrada je uspjesno dodana.', false);
      }

    } catch (error) {
      console.error(error);
      setStatus(isEditing ? 'Spremanje izmjena nije uspjelo.' : 'Spremanje nagrade nije uspjelo.', true);
    } finally {
      setSubmitting(false);
    }
  });

  if (cancelEditButton) {
    cancelEditButton.addEventListener('click', function () {
      form.reset();
      resetEditMode();
      setStatus('Uredivanje nagrade je otkazano.', false);
    });
  }

  resetEditMode();
  waitForFirebaseAndSubscribe();
})();
