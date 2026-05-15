(function () {
  var FIREBASE_WAIT_TRIES = 80;
  var FIREBASE_WAIT_MS = 125;

  var form = document.getElementById('adminSettingsForm');
  var carouselToggle = document.getElementById('settingsCarouselToggle');
  var carouselState = document.getElementById('settingsCarouselState');
  var carouselHint = document.getElementById('settingsCarouselHint');
  var saveBtn = document.getElementById('adminSettingsSaveBtn');
  var statusEl = document.getElementById('adminSettingsStatus');

  if (!form || !carouselToggle || !carouselState || !carouselHint || !saveBtn || !statusEl) {
    return;
  }

  function setStatus(message, isError) {
    statusEl.textContent = message;
    statusEl.style.color = isError ? '#ffb6a6' : '#ffe680';
  }

  function setSaving(isSaving) {
    saveBtn.disabled = isSaving;
    carouselToggle.disabled = isSaving;
    saveBtn.style.opacity = isSaving ? '0.7' : '1';
    saveBtn.style.cursor = isSaving ? 'not-allowed' : 'pointer';
  }

  function refreshToggleLabels() {
    carouselState.textContent = carouselToggle.checked ? 'On' : 'Off';
    carouselHint.textContent = carouselToggle.checked
      ? 'Carousel je trenutno uključen i prikazuje se na početnoj stranici.'
      : 'Carousel je trenutno isključen i ne prikazuje se na početnoj stranici.';
  }

  function waitForFirebase(triesLeft, callback) {
    if (triesLeft <= 0) {
      setStatus('Firebase nije dostupan. Osvježi stranicu.', true);
      return;
    }

    if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length > 0) {
      callback();
      return;
    }

    setTimeout(function () {
      waitForFirebase(triesLeft - 1, callback);
    }, FIREBASE_WAIT_MS);
  }

  waitForFirebase(FIREBASE_WAIT_TRIES, function () {
    var db = firebase.firestore();
    var settingsRef = db.collection('adminSettings').doc('carousel');

    settingsRef.get().then(function (doc) {
      var showCarousel = !!(doc.exists && doc.data() && doc.data().showCarousel === true);
      carouselToggle.checked = showCarousel;
      refreshToggleLabels();
      setStatus('', false);
    }).catch(function (error) {
      console.error(error);
      carouselToggle.checked = false;
      refreshToggleLabels();
      setStatus('Ne mogu učitati postavke.', true);
    });

    carouselToggle.addEventListener('change', refreshToggleLabels);

    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      setSaving(true);
      setStatus('Spremanje postavki u tijeku...', false);

      try {
        await settingsRef.set({
          showCarousel: !!carouselToggle.checked
        }, { merge: true });

        refreshToggleLabels();
        setStatus('Postavke su uspješno spremljene.', false);
      } catch (error) {
        console.error(error);
        setStatus('Spremanje postavki nije uspjelo.', true);
      } finally {
        setSaving(false);
      }
    });
  });
})();
