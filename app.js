(() => {
'use strict';

/* ---------- Config (from the spec) ---------- */
const HOLD_MS = 250;     // long-press threshold
const MOVE_TOL = 15;     // max drift while holding
const RADIUS = 92;       // layout radius
const SPREAD = 140;      // arc width in degrees
const R_MIN = 30, R_MAX = 150; // active hit band

const ACTIONS = [
  {id:'save', label:'Save',      d:'M6 3h12v18l-6-4-6 4z'},
  {id:'like', label:'Like',      d:'M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z'},
  {id:'share',label:'Share',     d:'M12 3v12M7 8l5-5 5 5M5 14v6h14v-6'},
  {id:'copy', label:'Copy link', d:'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1'},
  {id:'hide', label:'Hide',      d:'M3 3l18 18M10.5 6.2A9 9 0 0 1 12 6c5 0 8.500 4 9.500 6a14 14 0 0 1-3 3.800M6.600 7.600A14 14 0 0 0 2.500 12C3.500 14 7 18 12 18c1.500 0 2.800-.4 4-.9'}
];

const TITLES = ['Moss and stone desk','Tiny balcony garden','Hand-bound sketchbooks','Sunday bread, scored',
  'Blue tile bathroom','Paper lantern night','Cold brew ritual','Ceramic mug shelf','Ferns in the window',
  'Linen and walnut bedroom','Pocket-size travel kit','Woodblock print wall','Indigo dyeing day',
  'Quiet reading nook','Citrus on the counter','Hanging planter ideas','Brass and glass lamps','Slow morning table'];
const PAL = [['#5B4BFF','#2DD4A7','#FFD166'],['#FF5E8A','#FFB86B','#5B4BFF'],['#0FB5AE','#4E6BFF','#FFE066'],
  ['#FF7A59','#A855F7','#FFF1A8'],['#22C55E','#0EA5E9','#FDE68A'],['#F43F5E','#6366F1','#A7F3D0']];

/* ---------- Elements & state ---------- */
const $ = id => document.getElementById(id);
const feed = $('feed'), menu = $('menu'), scrim = $('scrim'), toast = $('toast'), count = $('count'), hint = $('hint');
const s = {pin:null, id:null, sx:0, sy:0, timer:0, active:false, hover:-1, ox:0, oy:0, angles:[], items:[], closeT:0};
let lastHidden = null;

/* ---------- Feed ---------- */
TITLES.forEach((t, i) => {
  const p = PAL[i % PAL.length], h = 150 + ((i * 97) % 190);
  const el = document.createElement('article');
  el.className = 'pin'; el.dataset.id = i;
  el.innerHTML = `<div class="art" style="--h:${h}px;--a:${p[0]};--b:${p[1]};--c:${p[2]}"></div><p class="cap">${t}</p>`;
  feed.appendChild(el);
});

/* ---------- Haptics & audio ---------- */
const buzz = p => navigator.vibrate && navigator.vibrate(p);
let ac;
const ctx = () => { ac = ac || new (window.AudioContext || window.webkitAudioContext)(); if (ac.state === 'suspended') ac.resume(); return ac; };
function tone(f0, f1, dur, type = 'sine', vol = .15, at = 0) {
  try {
    const c = ctx(), t = c.currentTime + at, o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    o.connect(g).connect(c.destination); o.start(t); o.stop(t + dur + .02);
  } catch (e) {}
}
const sfx = {
  pop:   () => tone(120, 240, .025, 'sine', .3),
  click: () => tone(2000, 2000, .008, 'square', .04),
  chime: () => { tone(880, 880, .06); tone(1760, 1760, .06); },
  sweep: () => tone(400, 100, .03, 'sine', .2)
};

/* ---------- Polar hit-testing ---------- */
function hoverIndex(x, y) {
  const dx = x - s.ox, dy = y - s.oy, r = Math.hypot(dx, dy);
  if (r < R_MIN || r > R_MAX) return -1;
  const t = Math.atan2(dy, dx);
  const half = (SPREAD / (ACTIONS.length - 1)) / 2 * Math.PI / 180;
  let best = -1, bd = Infinity;
  s.angles.forEach((a, i) => {
    const d = Math.abs(Math.atan2(Math.sin(t - a), Math.cos(t - a)));
    if (d <= half && d < bd) { bd = d; best = i; }
  });
  return best;
}

/* ---------- Menu lifecycle ---------- */
function open() {
  const W = innerWidth, H = innerHeight;
  s.ox = Math.min(Math.max(s.sx, 40), W - 40);
  s.oy = Math.min(Math.max(s.sy, 40), H - 40);
  let c = s.oy < RADIUS + 90 ? 90 : -90;               // fan up, or down near the top edge
  if (s.ox < RADIUS + 60) c += c < 0 ? 40 : -40;       // lean right near the left edge
  else if (s.ox > W - RADIUS - 60) c += c < 0 ? -40 : 40; // lean left near the right edge
  const step = SPREAD / (ACTIONS.length - 1);
  s.angles = ACTIONS.map((_, i) => (c - SPREAD / 2 + i * step) * Math.PI / 180);

  clearTimeout(s.closeT);
  menu.className = 'menu ' + (c < 0 ? 'up' : 'dn');
  menu.style.transform = `translate(${s.ox}px,${s.oy}px)`;
  menu.innerHTML = ACTIONS.map((a, i) =>
    `<div class="item" data-label="${a.label}" style="--i:${i};--x:${(Math.cos(s.angles[i]) * RADIUS).toFixed(1)}px;--y:${(Math.sin(s.angles[i]) * RADIUS).toFixed(1)}px"><svg viewBox="0 0 24 24"><path d="${a.d}"/></svg></div>`).join('');
  s.items = [...menu.children];
  s.active = true; s.hover = -1;
  try { s.pin.setPointerCapture(s.id); } catch (e) {}
  s.pin.classList.replace('pressing', 'lifted');
  menu.getBoundingClientRect();                         // flush so the open transition plays
  menu.classList.add('open'); scrim.classList.add('on'); hint.classList.add('off');
  buzz(18); sfx.pop();
}

function setHover(i) {
  if (i === s.hover) return;
  s.items.forEach((el, k) => el.classList.toggle('hot', k === i));
  menu.classList.toggle('hov', i >= 0);
  s.hover = i;
  if (i >= 0) { buzz(6); sfx.click(); }
}

function release(commit) {
  const i = commit ? s.hover : -1;
  if (i >= 0) {
    s.items[i].classList.add('hot'); menu.classList.add('go');
    run(ACTIONS[i].id, s.pin); buzz([12, 40, 12]); sfx.chime();
  } else { buzz(6); sfx.sweep(); }
  close();
}

function close() {
  menu.classList.remove('open', 'hov'); scrim.classList.remove('on');
  s.pin.classList.remove('lifted', 'pressing');
  s.active = false; s.hover = -1; s.pin = null;
  s.closeT = setTimeout(() => { menu.innerHTML = ''; menu.className = 'menu'; }, 450);
}

function cancelHold() {
  clearTimeout(s.timer);
  if (s.pin) s.pin.classList.remove('pressing');
  s.pin = null;
}

/* ---------- Actions ---------- */
function say(msg) {
  toast.textContent = msg; toast.classList.add('on');
  clearTimeout(say.t); say.t = setTimeout(() => toast.classList.remove('on'), 2200);
}

function run(id, pin) {
  const title = pin.querySelector('.cap').textContent;
  if (id === 'save' || id === 'like') {
    const k = id === 'save' ? 'saved' : 'liked', on = pin.classList.toggle(k);
    say(k === 'saved' ? (on ? 'Saved to your board' : 'Removed from your board') : (on ? 'Liked' : 'Like removed'));
    count.textContent = feed.querySelectorAll('.saved').length + ' saved';
  } else if (id === 'hide') {
    pin.classList.add('gone'); lastHidden = pin; say('Hidden. Tap here to undo');
    setTimeout(() => { if (pin.classList.contains('gone')) pin.hidden = true; }, 300);
  } else {
    const url = location.href.split('#')[0] + '#pin-' + pin.dataset.id;
    if (id === 'share' && navigator.share) navigator.share({title, url}).catch(() => {});
    else (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject())
      .then(() => say('Link copied'), () => say('Could not copy the link'));
  }
}

toast.addEventListener('click', () => {
  if (!lastHidden) return;
  lastHidden.hidden = false; lastHidden.classList.remove('gone'); lastHidden = null; say('Pin restored');
});

/* ---------- Gesture wiring ---------- */
feed.addEventListener('pointerdown', e => {
  const pin = e.target.closest('.pin');
  if (!pin || s.pin || (e.pointerType === 'mouse' && e.button)) return;
  ctx();                                                // unlock audio on a user gesture
  s.pin = pin; s.id = e.pointerId; s.sx = e.clientX; s.sy = e.clientY;
  pin.classList.add('pressing');
  s.timer = setTimeout(open, HOLD_MS);
});

addEventListener('pointermove', e => {
  if (!s.pin || e.pointerId !== s.id) return;
  if (s.active) setHover(hoverIndex(e.clientX, e.clientY));
  else if (Math.hypot(e.clientX - s.sx, e.clientY - s.sy) > MOVE_TOL) cancelHold();
});

addEventListener('pointerup', e => {
  if (!s.pin || e.pointerId !== s.id) return;
  if (s.active) release(true); else cancelHold();
});

addEventListener('pointercancel', e => {
  if (!s.pin || e.pointerId !== s.id) return;
  if (s.active) release(false); else cancelHold();
});

// Once the menu is open, stop the page from scrolling under the finger.
document.addEventListener('touchmove', e => { if (s.active) e.preventDefault(); }, {passive:false});
feed.addEventListener('contextmenu', e => e.preventDefault());
})();
