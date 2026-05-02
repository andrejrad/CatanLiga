(function () {
  var MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;
  var FIREBASE_WAIT_TRIES = 80;
  var FIREBASE_WAIT_MS = 125;
  var MOBILE_BREAKPOINT = '(max-width: 39.99rem)';

  var form = document.getElementById('galleryForm');
  var tournamentSelect = document.getElementById('galleryTournament');
  var imagesInput = document.getElementById('galleryImages');
  var statusEl = document.getElementById('galleryFormStatus');
  var uploadButton = document.getElementById('galleryUploadBtn');
  var selectedTournamentEl = document.getElementById('gallerySelectedTournament');
  var listEl = document.getElementById('galleryList');

  var zoomOverlay = document.getElementById('galleryZoomOverlay');
  var zoomImage = document.getElementById('galleryZoomImage');
  var zoomCloseBtn = document.getElementById('galleryZoomClose');
  var zoomInBtn = document.getElementById('galleryZoomIn');
  var zoomOutBtn = document.getElementById('galleryZoomOut');
  var zoomResetBtn = document.getElementById('galleryZoomReset');

  var db = null;
  var storage = null;
  var tournamentsCollection = null;
  var galleryCollection = null;

  var allTournaments = [];
  var currentTournamentId = '';
  var galleryUnsubscribe = null;
  var currentImages = [];
  var zoomScale = 1;

  if (!form || !tournamentSelect || !imagesInput || !statusEl || !uploadButton || !selectedTournamentEl || !listEl) {
    return;
  }

  function setStatus(message, isError) {
    statusEl.textContent = message;
    statusEl.style.color = isError ? '#ffb6a6' : '#ffe680';
  }

  function setSubmitting(isSubmitting) {
    uploadButton.disabled = isSubmitting;
    uploadButton.style.opacity = isSubmitting ? '0.7' : '1';
    uploadButton.style.cursor = isSubmitting ? 'not-allowed' : 'pointer';
  }

  function createMessage(text) {
    var p = document.createElement('p');
    p.className = 'admin-note';
    p.textContent = text;
    return p;
  }

  function sanitizeFileNamePart(value) {
    return value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
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

  function formatTournamentLabel(item) {
    var isMobile = !!(window.matchMedia && window.matchMedia(MOBILE_BREAKPOINT).matches);
    var termin = formatDate(item.date || '', isMobile) + ' ' + (item.time || '');
    return 'Kolo ' + (item.round || '') + ' | ' + termin.trim() + ' | ' + (item.venueName || '');
  }

  function parseRoundLabel(value) {
    var raw = String(value == null ? '' : value).trim();
    var lower = raw.toLowerCase();
    var match = lower.match(/^(\d+)(?:\.([a-z]+))?$/i);

    if (!match) {
      return {
        major: Number.MAX_SAFE_INTEGER,
        suffix: lower,
        raw: lower
      };
    }

    return {
      major: parseInt(match[1], 10),
      suffix: (match[2] || '').toLowerCase(),
      raw: lower
    };
  }

  function compareTournaments(a, b) {
    var roundA = parseRoundLabel(a.round);
    var roundB = parseRoundLabel(b.round);
    if (roundA.major !== roundB.major) {
      return roundA.major - roundB.major;
    }

    if (!!roundA.suffix !== !!roundB.suffix) {
      return roundA.suffix ? 1 : -1;
    }

    if (roundA.suffix !== roundB.suffix) {
      return roundA.suffix.localeCompare(roundB.suffix, 'hr', { sensitivity: 'base', numeric: true });
    }

    if ((a.date || '') !== (b.date || '')) {
      return (a.date || '').localeCompare(b.date || '');
    }

    if ((a.time || '') !== (b.time || '')) {
      return (a.time || '').localeCompare(b.time || '');
    }

    return (a.venueName || '').localeCompare((b.venueName || ''), 'hr', { sensitivity: 'base' });
  }

  function renderTournamentOptions() {
    var selected = currentTournamentId || tournamentSelect.value;

    tournamentSelect.innerHTML = '';

    var placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = allTournaments.length
      ? 'Odaberi turnir'
      : 'Nema dostupnih turnira';
    tournamentSelect.appendChild(placeholder);

    allTournaments
      .slice()
      .sort(compareTournaments)
      .forEach(function (item) {
        var option = document.createElement('option');
        option.value = item.id;
        option.textContent = formatTournamentLabel(item);
        tournamentSelect.appendChild(option);
      });

    if (selected && allTournaments.some(function (item) { return item.id === selected; })) {
      tournamentSelect.value = selected;
      currentTournamentId = selected;
      updateSelectedTournamentText();
    } else {
      currentTournamentId = '';
      tournamentSelect.value = '';
      selectedTournamentEl.textContent = 'Odaberi turnir za prikaz slika.';
      renderGalleryItems([]);
    }
  }

  function toMillis(value) {
    if (!value) {
      return 0;
    }
    if (typeof value.toMillis === 'function') {
      return value.toMillis();
    }
    if (typeof value === 'number') {
      return value;
    }
    return 0;
  }

  function renderGalleryItems(items) {
    listEl.innerHTML = '';

    if (!currentTournamentId) {
      listEl.appendChild(createMessage('Odaberi turnir za prikaz galerije.'));
      return;
    }

    if (items.length === 0) {
      listEl.appendChild(createMessage('Za odabrani turnir jos nema slika.'));
      return;
    }

    items.forEach(function (item) {
      var card = document.createElement('article');
      card.className = 'gallery-card';

      var imageBtn = document.createElement('button');
      imageBtn.type = 'button';
      imageBtn.className = 'gallery-image-button';
      imageBtn.setAttribute('aria-label', 'Otvori i uvecaj sliku');

      var image = document.createElement('img');
      image.src = item.imageUrl || '';
      image.alt = 'Slika turnira';
      image.loading = 'lazy';

      imageBtn.appendChild(image);
      imageBtn.addEventListener('click', function () {
        openZoom(item.imageUrl || '');
      });

      var actions = document.createElement('div');
      actions.className = 'gallery-actions';

      var openButton = document.createElement('button');
      openButton.type = 'button';
      openButton.className = 'partner-action-btn partner-action-btn-secondary';
      openButton.textContent = 'Otvori';
      openButton.addEventListener('click', function () {
        openZoom(item.imageUrl || '');
      });

      var deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'partner-action-btn';
      deleteButton.textContent = 'Obrisi';
      deleteButton.addEventListener('click', function () {
        deleteImage(item);
      });

      actions.appendChild(openButton);
      actions.appendChild(deleteButton);

      card.appendChild(imageBtn);
      card.appendChild(actions);
      listEl.appendChild(card);
    });
  }

  function updateZoomScale(nextScale) {
    if (!zoomImage) {
      return;
    }

    zoomScale = Math.max(1, Math.min(4, nextScale));
    zoomImage.style.transform = 'scale(' + zoomScale + ')';
    if (zoomResetBtn) {
      zoomResetBtn.textContent = Math.round(zoomScale * 100) + '%';
    }
  }

  function openZoom(url) {
    if (!zoomOverlay || !zoomImage || !url) {
      return;
    }

    zoomImage.src = url;
    zoomOverlay.hidden = false;
    document.body.style.overflow = 'hidden';
    updateZoomScale(1);
  }

  function closeZoom() {
    if (!zoomOverlay || !zoomImage) {
      return;
    }

    zoomOverlay.hidden = true;
    zoomImage.src = '';
    document.body.style.overflow = '';
    updateZoomScale(1);
  }

  async function deleteImage(item) {
    if (!galleryCollection || !storage) {
      setStatus('Firebase nije spreman. Pokusaj ponovno.', true);
      return;
    }

    if (!item || !item.id) {
      return;
    }

    var confirmed = window.confirm('Zelis obrisati ovu sliku?');
    if (!confirmed) {
      return;
    }

    try {
      if (item.imagePath) {
        await storage.ref(item.imagePath).delete();
      }
      await galleryCollection.doc(item.id).delete();
      setStatus('Slika je obrisana.', false);
    } catch (error) {
      console.error(error);
      setStatus('Brisanje slike nije uspjelo.', true);
    }
  }

  function updateSelectedTournamentText() {
    if (!currentTournamentId) {
      selectedTournamentEl.textContent = 'Odaberi turnir za prikaz slika.';
      return;
    }

    var selected = allTournaments.find(function (item) {
      return item.id === currentTournamentId;
    });

    if (!selected) {
      selectedTournamentEl.textContent = 'Odaberi turnir za prikaz slika.';
      return;
    }

    selectedTournamentEl.textContent = 'Prikaz: ' + formatTournamentLabel(selected);
  }

  function subscribeGalleryForTournament(tournamentId) {
    if (galleryUnsubscribe) {
      galleryUnsubscribe();
      galleryUnsubscribe = null;
    }

    currentImages = [];
    renderGalleryItems(currentImages);

    if (!tournamentId || !galleryCollection) {
      return;
    }

    listEl.innerHTML = '';
    listEl.appendChild(createMessage('Ucitavanje slika...'));

    galleryUnsubscribe = galleryCollection
      .where('tournamentId', '==', tournamentId)
      .onSnapshot(function (snapshot) {
        currentImages = [];
        snapshot.forEach(function (doc) {
          var data = doc.data();
          data.id = doc.id;
          currentImages.push(data);
        });

        currentImages.sort(function (a, b) {
          return toMillis(b.uploadedAt) - toMillis(a.uploadedAt);
        });

        renderGalleryItems(currentImages);
      }, function () {
        listEl.innerHTML = '';
        listEl.appendChild(createMessage('Ne mogu ucitati slike za odabrani turnir.'));
      });
  }

  function initFirebaseConnections() {
    if (!window.firebase || !firebase.apps || !firebase.apps.length) {
      return false;
    }

    db = firebase.firestore();
    storage = firebase.storage();
    tournamentsCollection = db.collection('adminTournaments');
    galleryCollection = db.collection('adminGalleryImages');
    return true;
  }

  function waitForFirebaseAndSubscribe() {
    var tries = 0;

    var timer = setInterval(function () {
      tries += 1;

      if (initFirebaseConnections()) {
        clearInterval(timer);

        tournamentsCollection.onSnapshot(function (snapshot) {
          allTournaments = [];
          snapshot.forEach(function (doc) {
            var data = doc.data();
            data.id = doc.id;
            allTournaments.push(data);
          });
          renderTournamentOptions();
        }, function () {
          setStatus('Ne mogu dohvatiti turnire.', true);
        });

        return;
      }

      if (tries >= FIREBASE_WAIT_TRIES) {
        clearInterval(timer);
        setStatus('Firebase se nije ucitao. Provjeri hosting konfiguraciju.', true);
      }
    }, FIREBASE_WAIT_MS);
  }

  tournamentSelect.addEventListener('change', function () {
    currentTournamentId = tournamentSelect.value;
    updateSelectedTournamentText();
    subscribeGalleryForTournament(currentTournamentId);
  });

  form.addEventListener('submit', async function (event) {
    event.preventDefault();

    var tournamentId = tournamentSelect.value;
    var files = imagesInput.files ? Array.prototype.slice.call(imagesInput.files) : [];

    if (!tournamentId) {
      setStatus('Odaberi turnir prije dodavanja slika.', true);
      return;
    }

    if (!files.length) {
      setStatus('Odaberi barem jednu sliku.', true);
      return;
    }

    if (!storage || !galleryCollection) {
      setStatus('Firebase nije spreman. Pricekaj i pokusaj ponovno.', true);
      return;
    }

    for (var i = 0; i < files.length; i += 1) {
      if (!files[i].type || files[i].type.indexOf('image/') !== 0) {
        setStatus('Dozvoljen je samo upload slika.', true);
        return;
      }

      if (files[i].size > MAX_IMAGE_SIZE_BYTES) {
        setStatus('Svaka slika mora biti manja od 10MB.', true);
        return;
      }
    }

    var selectedTournament = allTournaments.find(function (item) {
      return item.id === tournamentId;
    });

    var tournamentLabel = selectedTournament ? formatTournamentLabel(selectedTournament) : '';

    setSubmitting(true);
    setStatus('Upload slika je u tijeku...', false);

    try {
      for (var f = 0; f < files.length; f += 1) {
        var file = files[f];
        var path = 'gallery-images/'
          + tournamentId + '/'
          + Date.now() + '-'
          + f + '-'
          + sanitizeFileNamePart(file.name);

        var ref = storage.ref(path);
        await ref.put(file);
        var url = await ref.getDownloadURL();

        await galleryCollection.add({
          tournamentId: tournamentId,
          tournamentLabel: tournamentLabel,
          imageUrl: url,
          imagePath: path,
          uploadedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
      }

      imagesInput.value = '';
      setStatus('Slike su uspjesno dodane.', false);
    } catch (error) {
      console.error(error);
      setStatus('Upload slika nije uspio.', true);
    } finally {
      setSubmitting(false);
    }
  });

  if (zoomCloseBtn) {
    zoomCloseBtn.addEventListener('click', closeZoom);
  }

  if (zoomOverlay) {
    zoomOverlay.addEventListener('click', function (event) {
      if (event.target === zoomOverlay) {
        closeZoom();
      }
    });
  }

  if (zoomInBtn) {
    zoomInBtn.addEventListener('click', function () {
      updateZoomScale(zoomScale + 0.25);
    });
  }

  if (zoomOutBtn) {
    zoomOutBtn.addEventListener('click', function () {
      updateZoomScale(zoomScale - 0.25);
    });
  }

  if (zoomResetBtn) {
    zoomResetBtn.addEventListener('click', function () {
      updateZoomScale(1);
    });
  }

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && zoomOverlay && !zoomOverlay.hidden) {
      closeZoom();
    }
  });

  if (window.matchMedia) {
    var mobileQuery = window.matchMedia(MOBILE_BREAKPOINT);
    if (mobileQuery.addEventListener) {
      mobileQuery.addEventListener('change', function () {
        renderTournamentOptions();
        updateSelectedTournamentText();
      });
    }
  }

  waitForFirebaseAndSubscribe();
})();
