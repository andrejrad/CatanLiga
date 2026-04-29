(function () {
  var FIREBASE_WAIT_TRIES = 80;
  var FIREBASE_WAIT_MS = 125;

  var form = document.getElementById('registrationForm');
  var firstNameInput = document.getElementById('registrationFirstName');
  var lastNameInput = document.getElementById('registrationLastName');
  var emailInput = document.getElementById('registrationEmail');
  var tournamentSelect = document.getElementById('registrationTournament');
  var noteInput = document.getElementById('registrationNote');
  var consentInput = document.getElementById('registrationConsent');
  var statusEl = document.getElementById('registrationFormStatus');
  var submitButton = document.getElementById('registrationSubmitBtn');
  var capacityInfoEl = document.getElementById('tournamentCapacityInfo');
  var capacityTextEl = document.getElementById('capacityText');

  var db = null;
  var tournamentsCollection = null;
  var registrationsCollection = null;
  var activeTournaments = [];

  if (!form || !firstNameInput || !lastNameInput || !emailInput || !tournamentSelect || !noteInput || !consentInput || !statusEl || !submitButton || !capacityInfoEl || !capacityTextEl) {
    return;
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

  function formatDate(dateValue) {
    if (!dateValue) {
      return '';
    }

    var parts = dateValue.split('-');
    if (parts.length !== 3) {
      return dateValue;
    }

    return parts[2] + '.' + parts[1] + '.' + parts[0] + '.';
  }

  function normalize(value) {
    return (value || '').trim();
  }

  function checkTournamentCapacity() {
    var tournamentId = tournamentSelect.value;
    
    if (!tournamentId) {
      capacityInfoEl.style.display = 'none';
      return;
    }

    var selectedTournament = activeTournaments.find(function (t) {
      return t.id === tournamentId;
    });

    if (!selectedTournament || !selectedTournament.maxCapacity || selectedTournament.maxCapacity === 0) {
      capacityInfoEl.style.display = 'none';
      submitButton.disabled = false;
      return;
    }

    // Check current registrations for this tournament
    if (!registrationsCollection) {
      capacityInfoEl.style.display = 'none';
      return;
    }

    registrationsCollection
      .where('tournamentId', '==', tournamentId)
      .get()
      .then(function (snapshot) {
        var currentCount = snapshot.size;
        var maxCapacity = selectedTournament.maxCapacity;
        var available = Math.max(0, maxCapacity - currentCount);
        var isFull = currentCount >= maxCapacity;

        capacityInfoEl.style.display = 'block';

        if (isFull) {
          capacityTextEl.textContent = '⚠️ TURNIR JE POPUNJEN - Nema više slobodnih mjesta';
          capacityTextEl.style.color = '#ffb6a6';
          capacityTextEl.style.fontWeight = 'bold';
          submitButton.disabled = true;
          submitButton.style.opacity = '0.5';
          submitButton.style.cursor = 'not-allowed';
        } else {
          capacityTextEl.textContent = 'Slobodno još ' + available + ' mjesta od ukupno ' + maxCapacity;
          capacityTextEl.style.color = '#ffe680';
          capacityTextEl.style.fontWeight = 'normal';
          submitButton.disabled = false;
          submitButton.style.opacity = '1';
          submitButton.style.cursor = 'pointer';
        }
      })
      .catch(function (err) {
        console.error('Greška pri provjeri kapaciteta:', err);
        capacityInfoEl.style.display = 'none';
      });
  }

  function initFirebaseConnections() {
    if (!window.firebase || !firebase.apps || !firebase.apps.length) {
      return false;
    }

    db = firebase.firestore();
    tournamentsCollection = db.collection('adminTournaments');
    registrationsCollection = db.collection('registrations');
    return true;
  }

  function renderTournaments() {
    tournamentSelect.innerHTML = '';

    if (!activeTournaments.length) {
      var emptyOption = document.createElement('option');
      emptyOption.value = '';
      emptyOption.textContent = 'Trenutno nema aktivnih turnira';
      tournamentSelect.appendChild(emptyOption);
      tournamentSelect.disabled = true;
      submitButton.disabled = true;
      setStatus('Trenutno nema aktivnih turnira za prijavu.', true);
      return;
    }

    var placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Odaberi turnir';
    tournamentSelect.appendChild(placeholder);

    activeTournaments.forEach(function (item) {
      var option = document.createElement('option');
      option.value = item.id;
      option.textContent = 'Kolo ' + item.round + ' - ' + formatDate(item.date) + ' ' + (item.time || '') + ' - ' + (item.venueName || '');
      option.dataset.label = option.textContent;
      tournamentSelect.appendChild(option);
    });

    tournamentSelect.disabled = false;
    submitButton.disabled = false;
    setStatus('', false);
  }

  // Event listener za promjenu odabranog turnira
  tournamentSelect.addEventListener('change', function () {
    checkTournamentCapacity();
  });

  function loadActiveTournaments() {
    if (!tournamentsCollection) {
      return;
    }

    tournamentsCollection
      .orderBy('date', 'asc')
      .get()
      .then(function (snapshot) {
        var now = new Date();
        var list = [];

        snapshot.forEach(function (doc) {
          var data = doc.data();
          if (data.active === false || !data.date || !data.time) {
            return;
          }

          var eventDate = new Date(data.date + 'T' + data.time);
          if (eventDate <= now) {
            return;
          }

          var closeHoursRaw = Number(data.registrationCloseHours);
          var closeHours = isNaN(closeHoursRaw) || closeHoursRaw < 0 ? 0 : closeHoursRaw;
          var closingTime = new Date(eventDate.getTime() - closeHours * 60 * 60 * 1000);
          if (now >= closingTime) {
            return;
          }

          data.id = doc.id;
          list.push(data);
        });

        list.sort(function (a, b) {
          var aDate = new Date(a.date + 'T' + a.time);
          var bDate = new Date(b.date + 'T' + b.time);
          return aDate - bDate;
        });

        activeTournaments = list;
        renderTournaments();
      })
      .catch(function (error) {
        console.error(error);
        tournamentSelect.innerHTML = '';
        var option = document.createElement('option');
        option.value = '';
        option.textContent = 'Ne mogu učitati turnire';
        tournamentSelect.appendChild(option);
        tournamentSelect.disabled = true;
        submitButton.disabled = true;
        setStatus('Dohvat aktivnih turnira nije uspio. Pokušaj kasnije.', true);
      });
  }

  function waitForFirebaseAndInit() {
    var tries = 0;

    var timer = setInterval(function () {
      tries += 1;

      if (initFirebaseConnections()) {
        clearInterval(timer);
        loadActiveTournaments();
        return;
      }

      if (tries >= FIREBASE_WAIT_TRIES) {
        clearInterval(timer);
        setStatus('Firebase se nije učitao. Osvježi stranicu i pokušaj ponovno.', true);
      }
    }, FIREBASE_WAIT_MS);
  }

  form.addEventListener('submit', async function (event) {
    event.preventDefault();

    var firstName = normalize(firstNameInput.value);
    var lastName = normalize(lastNameInput.value);
    var email = normalize(emailInput.value).toLowerCase();
    var tournamentId = tournamentSelect.value;
    var note = normalize(noteInput.value);
    var consent = !!consentInput.checked;

    if (!registrationsCollection) {
      setStatus('Firebase nije spreman. Pričekaj trenutak i pokušaj ponovno.', true);
      return;
    }

    if (!firstName) {
      setStatus('Unesi ime.', true);
      return;
    }

    if (!lastName) {
      setStatus('Unesi prezime.', true);
      return;
    }

    if (!email || email.indexOf('@') === -1) {
      setStatus('Unesi ispravan email.', true);
      return;
    }

    if (!tournamentId) {
      setStatus('Odaberi turnir.', true);
      return;
    }

    if (!consent) {
      setStatus('Za prijavu moraš prihvatiti Pravila Korištenja i Politiku Privatnosti.', true);
      return;
    }

    var selectedOption = tournamentSelect.options[tournamentSelect.selectedIndex];
    var tournamentLabel = selectedOption ? selectedOption.dataset.label || selectedOption.textContent : '';

    setSubmitting(true);
    setStatus('Provjera dostupnosti mjesta...', false);

    try {
      var dupSnapshot = await registrationsCollection
        .where('email', '==', email)
        .where('tournamentId', '==', tournamentId)
        .get();

      if (!dupSnapshot.empty) {
        setStatus('Ovaj email je već prijavljen za odabrani turnir.', true);
        setSubmitting(false);
        return;
      }

      // Provjera dostupnosti mjesta
      var selectedTournament = activeTournaments.find(function (t) {
        return t.id === tournamentId;
      });

      if (selectedTournament && selectedTournament.maxCapacity && selectedTournament.maxCapacity > 0) {
        var regSnapshot = await registrationsCollection
          .where('tournamentId', '==', tournamentId)
          .get();

        if (regSnapshot.size >= selectedTournament.maxCapacity) {
          setStatus('Turnir je popunjen - nema više slobodnih mjesta.', true);
          setSubmitting(false);
          return;
        }
      }
    } catch (error) {
      console.error(error);
      setStatus('Provjera prijave nije uspjela. Pokušaj ponovno.', true);
      setSubmitting(false);
      return;
    }

    setStatus('Spremanje prijave u tijeku...', false);

    try {
      await registrationsCollection.add({
        firstName: firstName,
        lastName: lastName,
        email: email,
        tournamentId: tournamentId,
        tournamentLabel: tournamentLabel,
        note: note,
        consentAccepted: true,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });

      form.reset();
      setStatus('', false);
      
      var successPopup = document.getElementById('successPopup');
      var successPopupClose = document.getElementById('successPopupClose');
      
      function closePopupAndRedirect() {
        successPopup.hidden = true;
        window.location.href = 'index.html';
      }
      
      successPopup.hidden = false;
      successPopupClose.onclick = closePopupAndRedirect;
      successPopup.onclick = function(e) {
        if (e.target === successPopup) {
          closePopupAndRedirect();
        }
      };
    } catch (error) {
      console.error(error);
      setStatus('Spremanje prijave nije uspjelo. Pokušaj ponovno.', true);
    } finally {
      setSubmitting(false);
    }
  });

  waitForFirebaseAndInit();
})();
