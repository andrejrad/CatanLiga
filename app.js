const popup    = document.getElementById('popup');
const popTitle = document.getElementById('popup-title');
const popBody  = popup.querySelector('.popup-body');
const closeBtn = popup.querySelector('.popup-close');

// Placeholder body text — replace these later
const content = {
  'O nama':     'O nama — placeholder text.',
  'Pravila':    'Pravila — placeholder text.',
  'Nagrade':    'Nagrade — placeholder text.',
  'Prijava':    'Prijava — placeholder text.',
  'Bodovanje':  'Bodovanje — placeholder text.',
  'Galerija':   'Galerija — placeholder text.',
  'Partneri':   'Partneri — placeholder text.',
};

document.querySelectorAll('.hex-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const title = btn.dataset.title;
    popTitle.textContent = title;
    popBody.textContent  = content[title] ?? '';
    popup.hidden = false;
  });
});

function closePopup() { popup.hidden = true; }

closeBtn.addEventListener('click', closePopup);

popup.addEventListener('click', e => {
  if (e.target === popup) closePopup();
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closePopup();
});
