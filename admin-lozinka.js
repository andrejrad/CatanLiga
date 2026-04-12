(function () {
  var FIREBASE_WAIT_TRIES = 80;
  var FIREBASE_WAIT_MS = 125;

  var form = document.getElementById('adminPasswordForm');
  var currentInput = document.getElementById('adminCurrentPassword');
  var newInput = document.getElementById('adminNewPassword');
  var confirmInput = document.getElementById('adminConfirmPassword');
  var saveBtn = document.getElementById('adminPasswordSaveBtn');
  var statusEl = document.getElementById('adminPasswordStatus');

  if (!form || !currentInput || !newInput || !confirmInput || !saveBtn || !statusEl) {
    return;
  }

  function setStatus(message, isError) {
    statusEl.textContent = message;
    statusEl.style.color = isError ? '#ffb6a6' : '#ffe680';
  }

  function setSaving(isSaving) {
    saveBtn.disabled = isSaving;
    saveBtn.style.opacity = isSaving ? '0.7' : '1';
    saveBtn.style.cursor = isSaving ? 'not-allowed' : 'pointer';
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
    var settingsRef = db.collection('adminSettings').doc('access');

    form.addEventListener('submit', async function (event) {
      event.preventDefault();

      var currentPassword = currentInput.value;
      var newPassword = newInput.value;
      var confirmPassword = confirmInput.value;

      if (!newPassword || newPassword.length < 6) {
        setStatus('Nova lozinka mora imati barem 6 znakova.', true);
        return;
      }

      if (newPassword !== confirmPassword) {
        setStatus('Potvrda lozinke se ne podudara.', true);
        return;
      }

      setSaving(true);
      setStatus('Spremanje nove lozinke u tijeku...', false);

      try {
        var doc = await settingsRef.get();
        if (!doc.exists) {
          setStatus('Dokument adminSettings/access ne postoji u bazi.', true);
          return;
        }

        var data = doc.data() || {};
        if (String(data.password || '') !== String(currentPassword)) {
          setStatus('Trenutna lozinka nije točna.', true);
          return;
        }

        await settingsRef.set({
          password: newPassword,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        form.reset();
        setStatus('Lozinka je uspješno promijenjena.', false);
      } catch (error) {
        console.error(error);
        setStatus('Promjena lozinke nije uspjela.', true);
      } finally {
        setSaving(false);
      }
    });
  });
})();
