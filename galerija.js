(function () {
  var FIREBASE_WAIT_TRIES = 80;
  var FIREBASE_WAIT_MS = 125;
  var MOBILE_BREAKPOINT = '(max-width: 39.99rem)';
  var tournamentFilter = document.getElementById('publicGalleryTournamentFilter');
  var listEl = document.getElementById('publicGalleryList');

  var zoomOverlay = document.getElementById('publicGalleryZoomOverlay');
  var zoomImage = document.getElementById('publicGalleryZoomImage');
  var zoomCloseBtn = document.getElementById('publicGalleryZoomClose');
  var zoomInBtn = document.getElementById('publicGalleryZoomIn');
  var zoomOutBtn = document.getElementById('publicGalleryZoomOut');
  var zoomResetBtn = document.getElementById('publicGalleryZoomReset');

  var db = null;
  var tournamentsCollection = null;
  var galleryCollection = null;

  var allTournaments = [];
  var allImages = [];
  var displayedImages = [];
  var zoomScale = 1;
  var currentZoomIndex = -1;
  var touchStartX = 0;
  var touchStartY = 0;

  if (!tournamentFilter || !listEl) {
    return;
  }

  function createMessage(text) {
    var p = document.createElement('p');
    p.className = 'admin-note';
    p.textContent = text;
    return p;
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

  function compareTournaments(a, b) {
    var roundA = Number(a.round || 0);
    var roundB = Number(b.round || 0);
    if (roundA !== roundB) {
      return roundA - roundB;
    }

    if ((a.date || '') !== (b.date || '')) {
      return (a.date || '').localeCompare(b.date || '');
    }

    if ((a.time || '') !== (b.time || '')) {
      return (a.time || '').localeCompare(b.time || '');
    }

    return (a.venueName || '').localeCompare((b.venueName || ''), 'hr', { sensitivity: 'base' });
  }

  function formatTournamentLabel(item) {
    var isMobile = !!(window.matchMedia && window.matchMedia(MOBILE_BREAKPOINT).matches);
    var termin = formatDate(item.date || '', isMobile) + ' ' + (item.time || '');
    return 'Kolo ' + (item.round || '') + ' | ' + termin.trim() + ' | ' + (item.venueName || '');
  }

  function renderFilterOptions() {
    var selected = tournamentFilter.value;

    tournamentFilter.innerHTML = '';

    var defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = 'Svi turniri';
    tournamentFilter.appendChild(defaultOption);

    allTournaments
      .slice()
      .sort(compareTournaments)
      .forEach(function (item) {
        var option = document.createElement('option');
        option.value = item.id;
        option.textContent = formatTournamentLabel(item);
        tournamentFilter.appendChild(option);
      });

    if (selected && allTournaments.some(function (item) { return item.id === selected; })) {
      tournamentFilter.value = selected;
    }
  }

  function renderGallery() {
    listEl.innerHTML = '';
    displayedImages = [];

    if (!allImages.length) {
      listEl.appendChild(createMessage('Galerija je trenutno prazna.'));
      return;
    }

    var selectedTournament = tournamentFilter.value;
    var filtered = allImages.filter(function (item) {
      return !selectedTournament || item.tournamentId === selectedTournament;
    });

    filtered.sort(function (a, b) {
      return toMillis(b.uploadedAt) - toMillis(a.uploadedAt);
    });

    if (!filtered.length) {
      listEl.appendChild(createMessage('Nema slika za odabrani turnir.'));
      return;
    }

    filtered.forEach(function (item, imageIndex) {
      displayedImages.push(item);

      var imageBtn = document.createElement('button');
      imageBtn.type = 'button';
      imageBtn.className = 'gallery-image-button';
      imageBtn.setAttribute('aria-label', 'Otvori i uvecaj sliku');

      var image = document.createElement('img');
      image.src = item.imageUrl || '';
      image.alt = 'Fotografija s turnira';
      image.loading = 'lazy';

      imageBtn.appendChild(image);
      imageBtn.addEventListener('click', function () {
        openZoomAtIndex(imageIndex);
      });

      listEl.appendChild(imageBtn);
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

  function openZoomAtIndex(index) {
    if (!zoomOverlay || !zoomImage || !displayedImages.length) {
      return;
    }

    if (index < 0 || index >= displayedImages.length) {
      return;
    }

    var item = displayedImages[index];
    if (!item || !item.imageUrl) {
      return;
    }

    currentZoomIndex = index;
    zoomImage.src = item.imageUrl;
    zoomOverlay.hidden = false;
    document.body.style.overflow = 'hidden';
    updateZoomScale(1);
  }

  function moveZoom(step) {
    if (currentZoomIndex < 0 || !displayedImages.length) {
      return;
    }

    var nextIndex = currentZoomIndex + step;
    if (nextIndex < 0) {
      nextIndex = displayedImages.length - 1;
    }
    if (nextIndex >= displayedImages.length) {
      nextIndex = 0;
    }

    openZoomAtIndex(nextIndex);
  }

  function closeZoom() {
    if (!zoomOverlay || !zoomImage) {
      return;
    }

    zoomOverlay.hidden = true;
    zoomImage.src = '';
    currentZoomIndex = -1;
    document.body.style.overflow = '';
    updateZoomScale(1);
  }

  function initFirebaseConnections() {
    if (!window.firebase || !firebase.apps || !firebase.apps.length) {
      return false;
    }

    db = firebase.firestore();
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
          renderFilterOptions();
          renderGallery();
        }, function () {
          listEl.innerHTML = '';
          listEl.appendChild(createMessage('Ne mogu dohvatiti popis turnira.'));
        });

        galleryCollection.onSnapshot(function (snapshot) {
          allImages = [];
          snapshot.forEach(function (doc) {
            var data = doc.data();
            data.id = doc.id;
            allImages.push(data);
          });
          renderGallery();
        }, function () {
          listEl.innerHTML = '';
          listEl.appendChild(createMessage('Ne mogu ucitati slike galerije.'));
        });

        return;
      }

      if (tries >= FIREBASE_WAIT_TRIES) {
        clearInterval(timer);
        listEl.innerHTML = '';
        listEl.appendChild(createMessage('Firebase se nije ucitao. Pokusaj osvjeziti stranicu.'));
      }
    }, FIREBASE_WAIT_MS);
  }

  tournamentFilter.addEventListener('change', renderGallery);

  if (zoomCloseBtn) {
    zoomCloseBtn.addEventListener('click', closeZoom);
  }

  if (zoomOverlay) {
    zoomOverlay.addEventListener('click', function (event) {
      if (event.target === zoomOverlay) {
        closeZoom();
      }
    });

    zoomOverlay.addEventListener('touchstart', function (event) {
      if (!event.touches || event.touches.length !== 1) {
        return;
      }
      touchStartX = event.touches[0].clientX;
      touchStartY = event.touches[0].clientY;
    }, { passive: true });

    zoomOverlay.addEventListener('touchend', function (event) {
      if (!event.changedTouches || !event.changedTouches.length || zoomOverlay.hidden) {
        return;
      }

      var endX = event.changedTouches[0].clientX;
      var endY = event.changedTouches[0].clientY;
      var deltaX = endX - touchStartX;
      var deltaY = endY - touchStartY;
      var absX = Math.abs(deltaX);
      var absY = Math.abs(deltaY);

      if (absX < 40 || absX <= absY) {
        return;
      }

      if (deltaX < 0) {
        moveZoom(1);
      } else {
        moveZoom(-1);
      }
    }, { passive: true });
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
      return;
    }

    if (!zoomOverlay || zoomOverlay.hidden) {
      return;
    }

    if (event.key === 'ArrowRight') {
      moveZoom(1);
    }

    if (event.key === 'ArrowLeft') {
      moveZoom(-1);
    }
  });

  if (window.matchMedia) {
    var mobileQuery = window.matchMedia(MOBILE_BREAKPOINT);
    if (mobileQuery.addEventListener) {
      mobileQuery.addEventListener('change', function () {
        renderFilterOptions();
      });
    }
  }

  waitForFirebaseAndSubscribe();
})();
