(function () {
  var FIREBASE_WAIT_TRIES = 80;
  var FIREBASE_WAIT_MS = 125;
  var SESSION_KEY = 'adminUnlocked';
  var SESSION_TIME_KEY = 'adminUnlockedAt';
  var SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h

  function redirectToHome() {
    window.location.replace('index.html');
  }

  function isSessionValid() {
    var unlocked = sessionStorage.getItem(SESSION_KEY) === '1';
    if (!unlocked) {
      return false;
    }

    var unlockedAtRaw = sessionStorage.getItem(SESSION_TIME_KEY);
    var unlockedAt = Number(unlockedAtRaw || 0);
    if (!Number.isFinite(unlockedAt) || unlockedAt <= 0) {
      sessionStorage.removeItem(SESSION_KEY);
      sessionStorage.removeItem(SESSION_TIME_KEY);
      return false;
    }

    if (Date.now() - unlockedAt > SESSION_TTL_MS) {
      sessionStorage.removeItem(SESSION_KEY);
      sessionStorage.removeItem(SESSION_TIME_KEY);
      return false;
    }

    return true;
  }

  function unlockSession() {
    sessionStorage.setItem(SESSION_KEY, '1');
    sessionStorage.setItem(SESSION_TIME_KEY, String(Date.now()));
  }

  function waitForFirebase(triesLeft, onReady) {
    if (triesLeft <= 0) {
      alert('Firebase nije dostupan. Pokušaj ponovno.');
      redirectToHome();
      return;
    }

    if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length > 0) {
      onReady();
      return;
    }

    setTimeout(function () {
      waitForFirebase(triesLeft - 1, onReady);
    }, FIREBASE_WAIT_MS);
  }

  function requestPassword(expectedPassword) {
    var tries = 0;

    while (tries < 3) {
      var entered = window.prompt('Unesi admin lozinku:');

      if (entered === null) {
        redirectToHome();
        return;
      }

      if (String(entered) === String(expectedPassword)) {
        unlockSession();
        return;
      }

      tries += 1;
      alert('Pogrešna lozinka. Pokušaj ponovno.');
    }

    alert('Previše neuspjelih pokušaja.');
    redirectToHome();
  }

  function startAuth() {
    if (isSessionValid()) {
      return;
    }

    waitForFirebase(FIREBASE_WAIT_TRIES, function () {
      var db = firebase.firestore();

      db.collection('adminSettings')
        .doc('access')
        .get()
        .then(function (doc) {
          if (!doc.exists) {
            alert('Admin lozinka nije postavljena u bazi. Kreiraj dokument adminSettings/access s poljem password.');
            redirectToHome();
            return;
          }

          var data = doc.data() || {};
          var password = data.password;

          if (typeof password !== 'string' || password.length === 0) {
            alert('Admin lozinka nije ispravno konfigurirana u bazi.');
            redirectToHome();
            return;
          }

          requestPassword(password);
        })
        .catch(function (error) {
          console.error(error);
          alert('Ne mogu provjeriti admin lozinku.');
          redirectToHome();
        });
    });
  }

  startAuth();
})();
