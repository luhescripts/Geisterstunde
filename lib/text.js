'use strict';

// Artikel werden beim Vergleich ignoriert ("Der Exorzist" == "Exorzist").
const STOPWORDS = new Set(['der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einen', 'einem', 'einer', 'the', 'a', 'an']);

function normalize(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' und ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(w => w && !STOPWORDS.has(w))
    .join(' ');
}

function compact(s) {
  return normalize(s).replace(/ /g, '');
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = new Array(b.length + 1);
  let cur = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[b.length];
}

const digitsOf = s => (normalize(s).match(/\d+/g) || []).join(' ');

// Tippfehler-tolerant: kurze Antworten (<= 3 Zeichen) müssen exakt passen,
// Zahlen immer exakt ("8chan" ist nicht "4chan", "Silent Hill 2" nicht "Silent Hill").
function matches(guess, answers) {
  const g = compact(guess);
  if (!g) return false;
  const gd = digitsOf(guess);
  for (const ans of answers || []) {
    const a = compact(ans);
    if (!a) continue;
    if (digitsOf(ans) !== gd) continue;
    if (g === a) return true;
    if (a.length <= 3) continue;
    const tol = a.length <= 5 ? 1 : a.length <= 10 ? 2 : 3;
    if (Math.abs(g.length - a.length) <= tol && levenshtein(g, a) <= tol) return true;
  }
  return false;
}

function cleanName(s, max = 18) {
  return String(s == null ? '' : s).replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function cleanText(s, max = 120) {
  return String(s == null ? '' : s).replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

module.exports = { normalize, compact, levenshtein, matches, cleanName, cleanText };
