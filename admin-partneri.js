(function () {
  var MAX_LOGO_SIZE_BYTES = 10 * 1024 * 1024;
  var MAX_DESCRIPTION_LENGTH = 130;
  var FIREBASE_WAIT_TRIES = 80;
  var FIREBASE_WAIT_MS = 125;

  var form = document.getElementById('partnerForm');
  var nameInput = document.getElementById('partnerName');
  var logoInput = document.getElementById('partnerLogo');
  var contactInput = document.getElementById('partnerContact');
  var webInput = document.getElementById('partnerWeb');
  var descriptionInput = document.getElementById('partnerDescription');
  var statusEl = document.getElementById('partnerFormStatus');
  var listEl = document.getElementById('partnersList');
  var typeFilterSelect = document.getElementById('partnerTypeFilter');
  var nameSearchInput = document.getElementById('partnerNameSearch');
  var submitButton = document.getElementById('partnerSubmitBtn');
  var cancelEditButton = document.getElementById('partnerCancelEdit');

  var editingPartnerId = null;
  var editingPartnerData = null;
  var allPartners = [];

  var db = null;
  var storage = null;
  var partnersCollection = null;

  if (!form || !nameInput || !logoInput || !contactInput || !webInput || !descriptionInput || !statusEl || !listEl) {
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

  function getSelectedTypes() {
    var checked = form.querySelectorAll('input[name="partnerType"]:checked');
    return Array.prototype.map.call(checked, function (item) {
      return item.value;
    });
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

  function createEmptyState(message) {
    var empty = document.createElement('p');
    empty.className = 'admin-note partner-empty';
    empty.textContent = message;
    return empty;
  }

  function sanitizeFileNamePart(value) {
    return value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function setTypeSelections(typeValues) {
    var selectedMap = {};
    (typeValues || []).forEach(function (value) {
      selectedMap[value] = true;
    });

    var typeInputs = form.querySelectorAll('input[name="partnerType"]');
    Array.prototype.forEach.call(typeInputs, function (input) {
      input.checked = !!selectedMap[input.value];
    });
  }

  function resetEditMode() {
    editingPartnerId = null;
    editingPartnerData = null;

    if (submitButton) {
      submitButton.textContent = 'Dodaj partnera';
    }

    if (cancelEditButton) {
      cancelEditButton.hidden = true;
    }

    logoInput.required = true;
  }

  function enableEditMode(partnerData) {
    editingPartnerId = partnerData.id;
    editingPartnerData = partnerData;

    nameInput.value = partnerData.name || '';
    contactInput.value = partnerData.contact || '';
    webInput.value = partnerData.web || '';
    descriptionInput.value = partnerData.description || '';
    setTypeSelections(partnerData.types || []);

    if (submitButton) {
      submitButton.textContent = 'Spremi izmjene';
    }

    if (cancelEditButton) {
      cancelEditButton.hidden = false;
    }

    logoInput.required = false;
    setStatus('Uređivanje partnera: "' + (partnerData.name || '') + '". Logo je opcionalan.', false);
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderPartner(data) {
    var card = document.createElement('article');
    card.className = 'partner-card';
    if (data.active === false) {
      card.classList.add('partner-card-inactive');
    }

    var image = document.createElement('img');
    image.alt = data.name + ' logo';
    image.src = data.logoUrl || '';

    var body = document.createElement('div');

    var title = document.createElement('h3');
    title.textContent = data.name;

    var contact = document.createElement('p');
    contact.className = 'partner-meta';
    contact.textContent = 'Kontakt: ' + data.contact;

    var web = document.createElement('p');
    web.className = 'partner-meta';
    web.textContent = 'Web: ';

    var webLink = document.createElement('a');
    webLink.href = normalizeWebUrl(data.web || '');
    webLink.target = '_blank';
    webLink.rel = 'noopener';
    webLink.className = 'contact-link';
    webLink.textContent = data.web || '';
    web.appendChild(webLink);

    var types = document.createElement('p');
    types.className = 'partner-meta';
    types.textContent = 'Tip partnera: ' + (data.types || []).join(', ');

    var description = document.createElement('p');
    description.className = 'partner-meta';
    description.textContent = data.description;

    var state = document.createElement('p');
    state.className = 'partner-meta';
    state.textContent = 'Status: ' + (data.active === false ? 'Neaktivan' : 'Aktivan');

    var actions = document.createElement('div');
    actions.className = 'partner-actions';

    var editButton = document.createElement('button');
    editButton.type = 'button';
    editButton.className = 'partner-action-btn';
    editButton.textContent = 'Uredi';
    editButton.addEventListener('click', function () {
      enableEditMode(data);
    });

    var toggleButton = document.createElement('button');
    toggleButton.type = 'button';
    toggleButton.className = 'partner-action-btn partner-action-btn-secondary';
    toggleButton.textContent = data.active === false ? 'Aktiviraj' : 'Deaktiviraj';
    toggleButton.addEventListener('click', async function () {
      if (!partnersCollection) {
        setStatus('Firebase nije spreman. Pokušaj ponovno.', true);
        return;
      }

      try {
        await partnersCollection.doc(data.id).update({
          active: data.active === false
        });
        setStatus(
          data.active === false
            ? 'Partner je ponovno aktiviran.'
            : 'Partner je deaktiviran i neće se prikazivati na javnoj stranici.',
          false
        );
      } catch (error) {
        console.error(error);
        setStatus('Promjena statusa nije uspjela.', true);
      }
    });

    body.appendChild(title);
    body.appendChild(contact);
    body.appendChild(web);
    body.appendChild(types);
    body.appendChild(state);
    body.appendChild(description);
    actions.appendChild(editButton);
    actions.appendChild(toggleButton);
    body.appendChild(actions);

    card.appendChild(image);
    card.appendChild(body);
    return card;
  }

  function renderSnapshot(snapshot) {
    allPartners = [];
    snapshot.forEach(function (doc) {
      var data = doc.data();
      data.id = doc.id;
      allPartners.push(data);
    });

    applyFilters();
  }

  function applyFilters() {
    var selectedType = typeFilterSelect ? typeFilterSelect.value : '';
    var searchText = nameSearchInput ? nameSearchInput.value.trim().toLowerCase() : '';

    var filtered = allPartners.filter(function (partner) {
      var partnerTypes = partner.types || [];
      var typeOk = !selectedType || partnerTypes.indexOf(selectedType) !== -1;
      var nameOk = !searchText || (partner.name || '').toLowerCase().indexOf(searchText) !== -1;
      return typeOk && nameOk;
    });

    listEl.innerHTML = '';

    if (filtered.length === 0) {
      listEl.appendChild(createEmptyState('Nema partnera za odabrani filter.'));
      return;
    }

    filtered.forEach(function (partner) {
      listEl.appendChild(renderPartner(partner));
    });
  }

  function initFirebaseConnections() {
    if (!window.firebase || !firebase.apps || !firebase.apps.length) {
      return false;
    }

    db = firebase.firestore();
    storage = firebase.storage();
    partnersCollection = db.collection('adminPartners');
    return true;
  }

  function waitForFirebaseAndSubscribe() {
    var tries = 0;

    var timer = setInterval(function () {
      tries += 1;

      if (initFirebaseConnections()) {
        clearInterval(timer);
        partnersCollection
          .orderBy('createdAt', 'desc')
          .onSnapshot(renderSnapshot, function () {
            setStatus('Ne mogu dohvatiti partnere iz baze.', true);
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

    var selectedTypes = getSelectedTypes();
    var logoFile = logoInput.files && logoInput.files[0];
    var name = nameInput.value.trim();
    var contact = contactInput.value.trim();
    var web = webInput.value.trim();
    var description = descriptionInput.value.trim();
    var isEditing = !!editingPartnerId;

    if (!partnersCollection || !storage) {
      setStatus('Firebase nije spreman. Pričekaj trenutak i pokušaj ponovno.', true);
      return;
    }

    if (!name) {
      setStatus('Polje Ime je obavezno.', true);
      return;
    }

    if (!isEditing && !logoFile) {
      setStatus('Polje Logo je obavezno.', true);
      return;
    }

    if (logoFile && logoFile.size > MAX_LOGO_SIZE_BYTES) {
      setStatus('Logo je prevelik. Maksimalna veličina je 10MB.', true);
      return;
    }

    if (!contact) {
      setStatus('Polje Kontakt je obavezno.', true);
      return;
    }

    if (!web) {
      setStatus('Polje Web je obavezno.', true);
      return;
    }

    if (!description) {
      setStatus('Polje Kratki opis je obavezno.', true);
      return;
    }

    if (description.length > MAX_DESCRIPTION_LENGTH) {
      setStatus('Kratki opis može imati maksimalno 130 znakova.', true);
      return;
    }

    if (selectedTypes.length === 0) {
      setStatus('Odaberi barem jedan tip partnera.', true);
      return;
    }

    setSubmitting(true);
    setStatus('Spremanje partnera u tijeku...', false);

    try {
      var payload = {
        name: name,
        contact: contact,
        web: web,
        types: selectedTypes,
        description: description
      };

      if (!isEditing) {
        var sanitizedName = sanitizeFileNamePart(name) || 'partner';
        var fileExt = (logoFile.name.split('.').pop() || 'jpg').toLowerCase();
        var logoPath = 'partner-logos/' + Date.now() + '-' + sanitizedName + '.' + fileExt;

        var logoRef = storage.ref().child(logoPath);
        var uploadTaskSnapshot = await logoRef.put(logoFile, {
          contentType: logoFile.type || 'image/jpeg'
        });
        var logoUrl = await uploadTaskSnapshot.ref.getDownloadURL();

        payload.logoUrl = logoUrl;
        payload.logoPath = logoPath;
        payload.active = true;
        payload.createdAt = firebase.firestore.FieldValue.serverTimestamp();

        await partnersCollection.add(payload);
        form.reset();
        resetEditMode();
        setStatus('Partner je uspješno dodan i spremljen.', false);
      } else {
        if (logoFile) {
          var editSanitizedName = sanitizeFileNamePart(name) || 'partner';
          var editFileExt = (logoFile.name.split('.').pop() || 'jpg').toLowerCase();
          var editLogoPath = 'partner-logos/' + Date.now() + '-' + editSanitizedName + '.' + editFileExt;

          var editLogoRef = storage.ref().child(editLogoPath);
          var editUploadSnapshot = await editLogoRef.put(logoFile, {
            contentType: logoFile.type || 'image/jpeg'
          });
          var editLogoUrl = await editUploadSnapshot.ref.getDownloadURL();

          payload.logoUrl = editLogoUrl;
          payload.logoPath = editLogoPath;

          if (editingPartnerData && editingPartnerData.logoPath) {
            storage.ref().child(editingPartnerData.logoPath).delete().catch(function () {
              return;
            });
          }
        }

        await partnersCollection.doc(editingPartnerId).update(payload);
        form.reset();
        resetEditMode();
        setStatus('Partner je uspješno ažuriran.', false);
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

  if (typeFilterSelect) {
    typeFilterSelect.addEventListener('change', applyFilters);
  }

  if (nameSearchInput) {
    nameSearchInput.addEventListener('input', applyFilters);
  }

  listEl.innerHTML = '';
  listEl.appendChild(createEmptyState('Učitavanje partnera...'));
  resetEditMode();
  waitForFirebaseAndSubscribe();
})();
