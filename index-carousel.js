(function () {
  var FIREBASE_WAIT_TRIES = 80;
  var FIREBASE_WAIT_MS = 125;
  var CAROUSEL_ROTATE_MS = 6000;

  var carouselEl = document.getElementById('indexCarousel');
  var textEl = document.getElementById('indexCarouselText');
  var dotsEl = document.getElementById('indexCarouselDots');

  if (!carouselEl || !textEl || !dotsEl) {
    return;
  }

  var carouselStatements = [
    'Prvo mjesto ne znači da si najbolji. Znači da svi ostali još nisu dostigli svoj vrhunac. Uživaj dok traje.',
    'Negdje u Zagrebu, netko upravo optužuje kockice za namještanje.',
    'Treće mjesto: Švicarska ljestvice. Tehnički si u igri, ali nitko te se zapravo ne boji.',
    'Razlika između prvog i drugog mjesta samo je broj. Ponižavajući, duši iscrpljujući broj.',
    'Svaki tjedan se zakuneš da ćeš igrati drugačije. Svaki tjedan završiš s previše ovce i bez rude.',
    'Sredina ljestvice je samo gornja polovica donje polovice. Perspektiva je sve.',
    'U Tramvaju 14 ima više strategije nego na pola stolova večeras.',
    'Bodovi ne lažu. Kockice lažu. Ljestvica je čula sve isprike i ostaje ravnodušna.',
    'Robber nije osobni napad. Ali ako te pogodi tri puta zaredom, jest.',
    'Igraš Catan u Zagrebu. Već si poseban. Ljestvica se ne slaže, ali to je njezin problem.',
    'Longest Road nije životni cilj. A opet, nekima jest.',
    'Ako si prošli tjedan bio prvi, a ovaj tjedan nisi - dobrodošao u iskustvo koje grade karakter.',
    'Netko na ovoj ljestvici pobijedio je s tri settlements i jednom cestom. Ne pitaj kako. Ne pokušavaj replicirati.',
    'U Maksimiru rastu drveća. U Catanu rastu gradovi. Neki od vas još uvijek sade šume.',
    'Prijavio si se na turnir. Platio si kotizaciju. Napravio si strategiju. Kockice nisu čule ni jednu od tih informacija.'
  ];

  var currentIndex = 0;
  var rotationTimer = null;
  var isMounted = false;

  function buildDots() {
    dotsEl.innerHTML = '';
    carouselStatements.forEach(function (_, idx) {
      var dot = document.createElement('span');
      dot.className = idx === 0 ? 'active' : '';
      dotsEl.appendChild(dot);
    });
  }

  function updateDots(nextIndex) {
    var dots = dotsEl.querySelectorAll('span');
    dots.forEach(function (dot, idx) {
      dot.classList.toggle('active', idx === nextIndex);
    });
  }

  function showStatement(index) {
    textEl.classList.add('fade');
    setTimeout(function () {
      textEl.textContent = carouselStatements[index];
      updateDots(index);
      textEl.classList.remove('fade');
    }, 260);
  }

  function startRotation() {
    if (rotationTimer) {
      clearInterval(rotationTimer);
    }

    rotationTimer = setInterval(function () {
      currentIndex = (currentIndex + 1) % carouselStatements.length;
      showStatement(currentIndex);
    }, CAROUSEL_ROTATE_MS);
  }

  function mountCarousel() {
    if (!carouselStatements.length || isMounted) {
      return;
    }

    isMounted = true;
    carouselEl.hidden = false;
    currentIndex = 0;
    textEl.textContent = carouselStatements[0];
    buildDots();
    startRotation();
  }

  function unmountCarousel() {
    if (rotationTimer) {
      clearInterval(rotationTimer);
      rotationTimer = null;
    }

    isMounted = false;
    carouselEl.hidden = true;
  }

  function waitForFirebaseAndLoad() {
    var tries = 0;
    var timer = setInterval(function () {
      tries += 1;

      if (window.firebase && firebase.apps && firebase.apps.length) {
        clearInterval(timer);
        firebase.firestore()
          .collection('adminSettings')
          .doc('carousel')
          .onSnapshot(function (docSnap) {
            var shouldShow = !!(docSnap.exists && docSnap.data() && docSnap.data().showCarousel === true);
            if (shouldShow) {
              mountCarousel();
            } else {
              unmountCarousel();
            }
          }, function () {
            unmountCarousel();
          });
        return;
      }

      if (tries >= FIREBASE_WAIT_TRIES) {
        clearInterval(timer);
        unmountCarousel();
      }
    }, FIREBASE_WAIT_MS);
  }

  waitForFirebaseAndLoad();
})();
