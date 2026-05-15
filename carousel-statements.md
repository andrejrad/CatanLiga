# Catan Liga Zagreb — Carousel Statements

A rotating carousel of 15 fun/sarcastic statements to display on the site.
Suggested display: auto-rotate every **5–6 seconds**, fade or slide transition.

---

## Statements

```js
const carouselStatements = [
  "Prvo mjesto ne znači da si najbolji. Znači da svi ostali još nisu dostigli svoj vrhunac. Uživaj dok traje.",
  "Negdje u Zagrebu, netko upravo optužuje kockice za namještanje.",
  "Treće mjesto: Švicarska ljestvice. Tehnički si u igri, ali nitko te se zapravo ne boji.",
  "Razlika između prvog i drugog mjesta samo je broj. Ponižavajući, duši iscrpljujući broj.",
  "Svaki tjedan se zakuneš da ćeš igrati drugačije. Svaki tjedan završiš s previše ovce i bez rude.",
  "Sredina ljestvice je samo gornja polovica donje polovice. Perspektiva je sve.",
  "U Tramvaju 14 ima više strategije nego na pola stolova večeras.",
  "Bodovi ne lažu. Kockice lažu. Ljestvica je čula sve isprike i ostaje ravnodušna.",
  "Robber nije osobni napad. Ali ako te pogodi tri puta zaredom, jest.",
  "Igraš Catan u Zagrebu. Već si poseban. Ljestvica se ne slaže, ali to je njezin problem.",
  "Longest Road nije životni cilj. A opet, nekima jest.",
  "Ako si prošli tjedan bio prvi, a ovaj tjedan nisi — dobrodošao u iskustvo koje grade karakter.",
  "Netko na ovoj ljestvici pobijedio je s tri settlements i jednom cestom. Ne pitaj kako. Ne pokušavaj replicirati.",
  "U Maksimiru rastu drveća. U Catanu rastu gradovi. Neki od vas još uvijek sade šume.",
  "Prijavio si se na turnir. Platio si kotizaciju. Napravio si strategiju. Kockice nisu čule ni jednu od tih informacija.",
];
```

---

## Suggested HTML Structure

```html
<div class="carousel">
  <p class="carousel-text"></p>
  <div class="carousel-dots"></div>
</div>
```

---

## Suggested CSS

```css
.carousel {
  text-align: center;
  padding: 1.5rem 2rem;
  min-height: 80px;
}

.carousel-text {
  font-size: 1rem;
  font-style: italic;
  opacity: 1;
  transition: opacity 0.5s ease;
  color: inherit; /* match your site's text color */
}

.carousel-text.fade {
  opacity: 0;
}

.carousel-dots {
  display: flex;
  justify-content: center;
  gap: 6px;
  margin-top: 0.75rem;
}

.carousel-dots span {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.3;
  transition: opacity 0.3s;
}

.carousel-dots span.active {
  opacity: 1;
}
```

---

## Suggested JavaScript

```js
const carouselStatements = [
  "Prvo mjesto ne znači da si najbolji. Znači da svi ostali još nisu dostigli svoj vrhunac. Uživaj dok traje.",
  "Negdje u Zagrebu, netko upravo optužuje kockice za namještanje.",
  "Treće mjesto: Švicarska ljestvice. Tehnički si u igri, ali nitko te se zapravo ne boji.",
  "Razlika između prvog i drugog mjesta samo je broj. Ponižavajući, duši iscrpljujući broj.",
  "Svaki tjedan se zakuneš da ćeš igrati drugačije. Svaki tjedan završiš s previše ovce i bez rude.",
  "Sredina ljestvice je samo gornja polovica donje polovice. Perspektiva je sve.",
  "U Tramvaju 14 ima više strategije nego na pola stolova večeras.",
  "Bodovi ne lažu. Kockice lažu. Ljestvica je čula sve isprike i ostaje ravnodušna.",
  "Robber nije osobni napad. Ali ako te pogodi tri puta zaredom, jest.",
  "Igraš Catan u Zagrebu. Već si poseban. Ljestvica se ne slaže, ali to je njezin problem.",
  "Longest Road nije životni cilj. A opet, nekima jest.",
  "Ako si prošli tjedan bio prvi, a ovaj tjedan nisi — dobrodošao u iskustvo koje grade karakter.",
  "Netko na ovoj ljestvici pobijedio je s tri settlements i jednom cestom. Ne pitaj kako. Ne pokušavaj replicirati.",
  "U Maksimiru rastu drveća. U Catanu rastu gradovi. Neki od vas još uvijek sade šume.",
  "Prijavio si se na turnir. Platio si kotizaciju. Napravio si strategiju. Kockice nisu čule ni jednu od tih informacija.",
];

let current = 0;
const textEl = document.querySelector(".carousel-text");
const dotsContainer = document.querySelector(".carousel-dots");

// Build dots
carouselStatements.forEach((_, i) => {
  const dot = document.createElement("span");
  if (i === 0) dot.classList.add("active");
  dotsContainer.appendChild(dot);
});

function updateDots(index) {
  document.querySelectorAll(".carousel-dots span").forEach((dot, i) => {
    dot.classList.toggle("active", i === index);
  });
}

function showNext() {
  textEl.classList.add("fade");

  setTimeout(() => {
    current = (current + 1) % carouselStatements.length;
    textEl.textContent = carouselStatements[current];
    updateDots(current);
    textEl.classList.remove("fade");
  }, 500); // matches CSS transition duration
}

// Init
textEl.textContent = carouselStatements[0];

// Rotate every 6 seconds
setInterval(showNext, 6000);
```

---

## Notes for implementation

- Place the `<div class="carousel">` wherever you want it on the page — below the leaderboard or above the footer works well.
- The JS can go in your existing script file or inline at the bottom of the page.
- If your site uses a CSS framework or existing color variables, replace `color: inherit` with your actual text color token.
- The `"Ivan"` placeholder from the original list was removed — all 15 statements are generic and safe to use as-is without dynamic data.
