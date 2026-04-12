(function () {
  var FIREBASE_WAIT_TRIES = 80;
  var FIREBASE_WAIT_MS = 125;

  var bonusTableBody = document.getElementById('bodovanjeBonusTableBody');
  var koloCoefText = document.getElementById('bodovanjeKoloCoefText');
  var koloFormulaText = document.getElementById('bodovanjeKoloFormulaText');
  var koloExampleText = document.getElementById('bodovanjeKoloExampleText');
  var ligaCoefText = document.getElementById('bodovanjeLigaCoefText');
  var ligaFormulaText = document.getElementById('bodovanjeLigaFormulaText');

  if (!bonusTableBody || !koloCoefText || !koloFormulaText || !koloExampleText || !ligaCoefText || !ligaFormulaText) {
    return;
  }

  function formatNumber(value) {
    var fixed = Number(value).toFixed(2);
    if (fixed.indexOf('.') === -1) {
      return fixed;
    }

    fixed = fixed.replace(/0+$/, '');
    fixed = fixed.replace(/\.$/, '');
    return fixed.replace('.', ',');
  }

  function renderBonusTable(rules) {
    bonusTableBody.innerHTML = '';

    rules.forEach(function (rule) {
      var row = document.createElement('tr');

      var placeTd = document.createElement('td');
      placeTd.textContent = String(rule.place) + '. mjesto';

      var pointsTd = document.createElement('td');
      pointsTd.textContent = (rule.points > 0 ? '+' : '') + String(rule.points);

      row.appendChild(placeTd);
      row.appendChild(pointsTd);
      bonusTableBody.appendChild(row);
    });
  }

  function applyTexts(coefficient, rules) {
    var coefText = formatNumber(coefficient);
    var secondPlaceRule = rules.find(function (rule) {
      return rule.place === 2;
    });
    var secondPlaceBonus = secondPlaceRule ? secondPlaceRule.points : 2;
    var exampleResult = 8 * coefficient + secondPlaceBonus;

    koloCoefText.textContent =
      'Dakle, svaka runda donosi ti bodove iz same igre * ' + coefText + ', a zatim i dodatni bonus prema plasmanu nakon svake partije.';

    koloFormulaText.innerHTML =
      '<strong>Formula bodovanja za pojedinačno kolo:</strong> bodovi iz igre * ' + coefText + ' + bonus bodovi za plasman';

    koloExampleText.innerHTML =
      '<strong>Primjer bodovanja:</strong><br />Ako završiš partiju s 8 bodova i budeš 2. za stolom, za tu rundu osvajaš: 8*'
      + coefText + ' + ' + secondPlaceBonus + ' = ' + formatNumber(exampleResult) + ' bodova';

    ligaCoefText.textContent = 'Pobjednički bodovi (VP) osvojeni u partiji * ' + coefText;
    ligaFormulaText.innerHTML =
      '<strong>Formula bodovanja za poredak lige:</strong> bodovi iz igre * ' + coefText + ' + bonus bodovi za plasman';
  }

  function waitForFirebaseAndLoad() {
    var tries = 0;

    var timer = setInterval(function () {
      tries += 1;

      if (window.firebase && firebase.apps && firebase.apps.length) {
        clearInterval(timer);
        loadScoringData(firebase.firestore());
        return;
      }

      if (tries >= FIREBASE_WAIT_TRIES) {
        clearInterval(timer);
      }
    }, FIREBASE_WAIT_MS);
  }

  async function loadScoringData(db) {
    try {
      var rulesPromise = db.collection('adminScoreRules').orderBy('place', 'asc').get();
      var configPromise = db.collection('adminScoreConfig').doc('global').get();

      var results = await Promise.all([rulesPromise, configPromise]);
      var rulesSnap = results[0];
      var configDoc = results[1];

      if (rulesSnap.empty) {
        return;
      }

      var rules = rulesSnap.docs.map(function (doc) {
        var data = doc.data() || {};
        return {
          place: Number(data.place || 0),
          points: Number(data.points || 0)
        };
      }).filter(function (item) {
        return Number.isFinite(item.place) && item.place > 0 && Number.isFinite(item.points) && item.points >= 0;
      });

      if (!rules.length) {
        return;
      }

      var configData = configDoc.exists ? configDoc.data() : null;
      var coefficient = configData && typeof configData.gamePointsCoefficient === 'number'
        ? configData.gamePointsCoefficient
        : 0.5;

      renderBonusTable(rules);
      applyTexts(coefficient, rules);
    } catch (error) {
      console.error(error);
    }
  }

  waitForFirebaseAndLoad();
})();
