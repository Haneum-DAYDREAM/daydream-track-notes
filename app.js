/* DAYDREAM TRACK NOTES — flipbook + track player
   Page/plate artwork stays untouched; the viewer only frames it. */
(function () {
  'use strict';

  var PAGE_COUNT = 16;
  var PAGE_RATIO = 128 / 182; // width / height of every plate
  var PLATE_W = 1008;         // the plates' own pixel size — the zoom view always
  var PLATE_H = 1434;         // shows them at this ratio, never stretched to fit

  /* JANG HANEUM · 2nd EP [DAYDREAM] — Apple Music album 1888138163
     (2026-03-30, 9 tracks). Each scene points the official dark embed at its
     own track: subscribers hear the full song, non-subscribers the 30s preview,
     and neither gets a video pre-roll. */
  var AM_ALBUM = '1888138163';
  var TRACKS = [
    { num: '01', title: 'Imagine',        scene: 'Scene 01', page: 3,  am: '1888138167' },
    { num: '02', title: 'Daydream',       scene: 'Scene 02', page: 4,  am: '1888138171' },
    { num: '03', title: 'Kingdom come',   scene: 'Scene 03', page: 5,  am: '1888138265' },
    { num: '04', title: 'WANNA',          scene: 'Scene 04', page: 6,  am: '1888138269' },
    { num: '05', title: 'Hélas',          scene: 'Scene 05', page: 8,  am: '1888138273' },
    { num: '06', title: 'Only 1',         scene: 'Scene 06', page: 10, am: '1888138278' },
    { num: '07', title: 'Imperfect',      scene: 'Scene 07', page: 12, am: '1888138282' },
    { num: '08', title: 'After the dream', scene: 'Scene 08', page: 13, am: '1888138287' },
    { num: '09', title: 'MidsummerNight', scene: 'Scene 09', page: 14, am: '1888138290' }
  ];

  function embedSrc(t) {
    return 'https://embed.music.apple.com/kr/album/daydream/' + AM_ALBUM +
      '?i=' + t.am + '&theme=dark';
  }

  // plate number -> track index (plates 1, 2, 16 carry no track)
  var PLATE_TRACK = {
    3: 0, 4: 1, 5: 2,
    6: 3, 7: 3,
    8: 4, 9: 4,
    10: 5, 11: 5,
    12: 6, 13: 7,
    14: 8, 15: 8
  };

  var el = function (id) { return document.getElementById(id); };

  var bookEl = el('book');
  var stageEl = el('stage');
  var counterEl = el('counter');
  var prevBtn = el('prevBtn');
  var nextBtn = el('nextBtn');
  var tocBtn = el('tocBtn');
  var tocEl = el('toc');
  var tocList = el('tocList');
  var tocBackdrop = el('tocBackdrop');
  var tocClose = el('tocClose');
  var barId = document.querySelector('.bar-id');
  var barScene = el('barScene');
  var barTitle = el('barTitle');
  var prevTrackBtn = el('prevTrack');
  var nextTrackBtn = el('nextTrack');
  var amPlayer = el('amPlayer');
  var loadingEl = el('loading');
  var loadingBar = el('loadingBar');
  var loadingCount = el('loadingCount');

  var zoomEl = el('zoom');
  var zoomBtn = el('zoomBtn');
  var zoomStage = el('zoomStage');
  var zoomCanvas = el('zoomCanvas');
  var zoomPct = el('zoomPct');
  var zoomLabel = el('zoomLabel');
  var zoomIn = el('zoomIn');
  var zoomOut = el('zoomOut');
  var zoomFit = el('zoomFit');
  var zoomClose = el('zoomClose');
  var zoomHint = el('zoomHint');
  var zoomPrev = el('zoomPrev');
  var zoomNext = el('zoomNext');

  var wrapEl = document.querySelector('.book-wrap');

  var pageFlip = null;
  var isSpread = true;
  var orientationFixAt = 0;
  // on touch devices the viewer owns the gestures (the library's own touch drag
  // leaves the flip in a busy state and swallows the next swipe)
  var ownGestures = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  var currentIndex = 0;      // 0-based index of the left-most visible plate
  var focusTrack = 0;        // track shown in the bar
  var focusLock = false;     // keep focusTrack on the next flip (programmatic jumps)
  var currentEmbedId = TRACKS[0].am;  // the track the markup already points the embed at
  var resizing = false;

  /* ---------------- plates ---------------- */

  function plateSrc(n) {
    return './pages/p' + (n < 10 ? '0' + n : n) + '.jpg';
  }

  function preload() {
    var loaded = 0;
    var done = false;

    function step() {
      loaded += 1;
      var pct = Math.round((loaded / PAGE_COUNT) * 100);
      loadingBar.style.width = pct + '%';
      loadingCount.textContent = loaded + ' / ' + PAGE_COUNT;
      if (loaded >= PAGE_COUNT && !done) {
        done = true;
        window.setTimeout(start, 180);
      }
    }

    for (var i = 1; i <= PAGE_COUNT; i++) {
      var img = new Image();
      img.onload = step;
      img.onerror = step;
      img.src = plateSrc(i);
    }
    // safety: never leave the reader waiting on one slow plate
    window.setTimeout(function () {
      if (!done) { done = true; start(); }
    }, 6000);
  }

  function buildPages() {
    var frag = document.createDocumentFragment();
    for (var i = 1; i <= PAGE_COUNT; i++) {
      var page = document.createElement('div');
      page.className = 'page';
      var img = document.createElement('img');
      img.src = plateSrc(i);
      img.alt = '';
      img.draggable = false;
      img.decoding = 'async';
      page.appendChild(img);
      frag.appendChild(page);
    }
    bookEl.innerHTML = '';
    bookEl.appendChild(frag);
  }

  /* ---------------- geometry ---------------- */

  function metrics() {
    var cs = window.getComputedStyle(stageEl);
    var availW = stageEl.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    var availH = stageEl.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    availW = Math.max(availW, 96);
    availH = Math.max(availH, 110);

    var spread = (availW / availH) >= 1.16;
    var pageW = spread
      ? Math.min(availW / 2, availH * PAGE_RATIO)
      : Math.min(availW, availH * PAGE_RATIO);
    var pageH = pageW / PAGE_RATIO;

    return { spread: spread, pageW: Math.floor(pageW), pageH: Math.floor(pageH) };
  }

  function applySize(m) {
    bookEl.style.width = (m.spread ? m.pageW * 2 : m.pageW) + 'px';
    bookEl.style.height = m.pageH + 'px';
  }

  /* ---------------- flipbook ---------------- */

  function createFlip(m) {
    // StPageFlip.destroy() takes its block element out of the document, so the
    // book has to be put back before it can hold pages again — otherwise a
    // relayout (window resize, orientation change) leaves a detached book and a
    // black stage that never comes back.
    if (!bookEl.parentNode && wrapEl) { wrapEl.appendChild(bookEl); }
    buildPages();
    applySize(m);
    isSpread = m.spread;

    pageFlip = new St.PageFlip(bookEl, {
      width: m.pageW,
      height: m.pageH,
      size: 'fixed',
      minWidth: 120,
      maxWidth: 1200,
      minHeight: 160,
      maxHeight: 1700,
      drawShadow: true,
      maxShadowOpacity: 0.34,
      showCover: true,
      usePortrait: true,
      startPage: currentIndex,
      flippingTime: 760,
      useMouseEvents: !ownGestures,
      showPageCorners: true,
      clickEventForward: true,
      swipeDistance: 24,
      mobileScrollSupport: true,
      autoSize: false,
      startZIndex: 4
    });

    pageFlip.loadFromHTML(bookEl.querySelectorAll('.page'));
    pageFlip.on('flip', function (e) { onFlip(e.data); });
    pageFlip.on('changeState', function (e) {
      if (e.data === 'read') { renderBookState(); }
    });
    pageFlip.on('changeOrientation', function (e) {
      // The library switched between single page and spread on its own. If it
      // disagrees with the size we laid out, our page indexes stop matching its
      // spreads (that is how a reader ends up on a '05-06' that draws nothing),
      // so rebuild both around the same layout.
      var landscape = (e && e.data) ? (e.data === 'landscape') : true;
      if (landscape !== isSpread) {
        var now = Date.now();
        if (now - orientationFixAt > 600) {
          orientationFixAt = now;
          window.setTimeout(function () { if (pageFlip) { relayout(); } }, 0);
        }
        return;
      }
      onFlip(pageFlip.getCurrentPageIndex());
    });
  }

  function relayout() {
    if (!pageFlip) { return; }
    var m = metrics();
    var keep = normalizeIndex(currentIndex, m.spread);
    try { pageFlip.destroy(); } catch (err) { /* already gone */ }
    pageFlip = null;
    currentIndex = keep;
    createFlip(m);
    renderNav();
    renderBookState();
  }

  function visiblePlates(index) {
    var left = index + 1;
    if (isSpread && index > 0 && index < PAGE_COUNT - 1) { return [left, left + 1]; }
    return [left];
  }

  /* A spread's left page is always index 0, an odd index, or the very last
     page — [2,3]=1, [4,5]=3 … So any other index (which is what a single-page
     mode or a mid-animation report can hand us) belongs to the spread opened
     before it. Keeping every index inside that set is what keeps the counter,
     the turn target and the library's own spreads in step. */
  function normalizeIndex(index, spreadMode) {
    var spread = (spreadMode === undefined) ? isSpread : !!spreadMode;
    index = Math.round(Number(index) || 0);
    if (!spread) { return Math.min(PAGE_COUNT - 1, Math.max(0, index)); }
    if (index <= 0) { return 0; }
    if (index >= PAGE_COUNT - 1) { return PAGE_COUNT - 1; }
    return (index % 2 === 1) ? index : index - 1;
  }

  function onFlip(index) {
    currentIndex = normalizeIndex(index);
    var plates = visiblePlates(currentIndex);
    renderCounter(plates);
    renderNav();
    // the closed/open shift waits until the leaf has landed
    window.clearTimeout(bookShiftTimer);
    bookShiftTimer = window.setTimeout(renderBookState, 820);
    if (!pageFlip || pageFlip.getState() === 'read') { renderBookState(); }

    var candidates = [];
    for (var i = 0; i < plates.length; i++) {
      var t = PLATE_TRACK[plates[i]];
      if (t !== undefined && candidates.indexOf(t) === -1) { candidates.push(t); }
    }
    if (!candidates.length) { return; }

    if (focusLock) {
      focusLock = false;
      if (candidates.indexOf(focusTrack) !== -1) { return; }
    }
    if (candidates.indexOf(focusTrack) !== -1) { return; }

    // the spread's main track: the left plate's track, else the right one's
    var main = PLATE_TRACK[plates[0]];
    if (main === undefined) { main = candidates[0]; }
    setTrack(main);
  }

  /* ---------------- header / nav ---------------- */

  function pad(n) { return n < 10 ? '0' + n : String(n); }

  function renderCounter(plates) {
    if (plates.length > 1) {
      counterEl.textContent = pad(plates[0]) + '\u2013' + pad(plates[1]) + ' / ' + PAGE_COUNT;
    } else {
      counterEl.textContent = pad(plates[0]) + ' / ' + PAGE_COUNT;
    }
  }

  var bookShiftTimer = null;

  function renderNav() {
    if (!pageFlip) { return; }
    var i = currentIndex;
    prevBtn.disabled = i <= 0;
    nextBtn.disabled = i >= PAGE_COUNT - 1;
  }

  // a closed book (cover, curtain call) sits in the middle of the stage
  function renderBookState() {
    var closedCover = isSpread && currentIndex === 0;
    var closedBack = isSpread && currentIndex >= PAGE_COUNT - 1;
    bookEl.style.transform = closedCover ? 'translateX(-25%)'
      : closedBack ? 'translateX(25%)' : 'translateX(0)';
    bookEl.classList.toggle('is-spread', isSpread && !closedCover && !closedBack);
  }

  function whenRead(cb, tries) {
    tries = tries || 0;
    if (!pageFlip) { return; }
    var state = 'read';
    try { state = pageFlip.getState(); } catch (err) { state = 'read'; }
    // a page turn takes ~760ms; turning in the middle of one leaves the
    // library's spread and ours describing different pages
    if (state === 'read' || tries > 60) { cb(); return; }
    window.setTimeout(function () { whenRead(cb, tries + 1); }, 16);
  }

  function next() {
    if (!pageFlip) { return; }
    // leaving a closed cover: settle the book into spread position just before it opens
    if (isSpread && currentIndex === 0) {
      bookEl.style.transform = 'translateX(0)';
      window.setTimeout(function () {
        if (isSpread && currentIndex === 0) { pageFlip.flipNext(); }
      }, 190);
      return;
    }
    pageFlip.flipNext();
  }

  function prev() {
    if (!pageFlip) { return; }
    pageFlip.flipPrev();
  }

  /* ---------------- track bar ---------------- */

  function setTrack(index) {
    if (index < 0 || index >= TRACKS.length) { return; }
    if (index === focusTrack) { cueTrack(index); return; }
    focusTrack = index;
    var t = TRACKS[index];

    barScene.textContent = t.scene;
    barTitle.textContent = t.title;
    updateTocActive();
    barId.classList.add('is-changing');
    window.setTimeout(function () { barId.classList.remove('is-changing'); }, 220);
    cueTrack(index);
  }

  /* The Apple Music embed is its own player and has no external JS API, so a
     change of scene only re-points the iframe at that track's page. The reader
     presses the embed's own ▶ once — no pre-roll, no muted autoplay to fight. */
  function cueTrack(index) {
    var t = TRACKS[index];
    if (!amPlayer || t.am === currentEmbedId) { return; }
    currentEmbedId = t.am;
    amPlayer.setAttribute('src', embedSrc(t));
    amPlayer.setAttribute('title', 'Apple Music — ' + t.num + ' ' + t.title +
      ' · 장한음 DAYDREAM');
  }

  function stepTrack(dir) {
    var nextIndex = (focusTrack + dir + TRACKS.length) % TRACKS.length;
    goToTrack(nextIndex);
  }

  function goToTrack(index) {
    if (index < 0 || index >= TRACKS.length) { return; }
    if (!pageFlip) { setTrack(index); return; }
    var target = normalizeIndex(TRACKS[index].page - 1);
    var plates = visiblePlates(currentIndex);
    if (plates.indexOf(TRACKS[index].page) !== -1) {
      setTrack(index);
      return;
    }
    // hold this scene through the turn, even if the landing spread carries two tracks
    focusLock = true;
    setTrack(index);
    if (target !== currentIndex) { pageFlip.turnToPage(target); }
  }


  /* the bottom bar is Apple Music's own embed — no player API to drive */

  /* ---------------- zoom view ---------------- */

  var zv = {
    open: false, scale: 1, min: 1, max: 3, x: 0, y: 0, plate: 1,
    pointers: new Map(), pinch: null, lastTap: 0, lastTapX: 0, lastTapY: 0
  };
  var zoomHideTimer = null;

  /* Fit the plate inside the zoom canvas at its own 1008:1434 ratio. The box is
     written in pixels so the picture is never squeezed by max-width alone: the
     width/height attributes carry the ratio before the file has decoded. */
  function layoutPlate() {
    var img = zoomCanvas.querySelector('img');
    if (!img) { return; }
    var nw = img.naturalWidth || PLATE_W;
    var nh = img.naturalHeight || PLATE_H;
    if (!nw || !nh) { return; }
    var boxW = zoomCanvas.clientWidth;
    var boxH = zoomCanvas.clientHeight;
    if (boxW < 8 || boxH < 8) { return; }
    var ratio = nw / nh;
    var w = Math.min(boxW, boxH * ratio);
    var h = w / ratio;
    img.style.width = w + 'px';
    img.style.height = h + 'px';
    clampPan();
    applyZoom();
  }

  function setZoomPlate(n) {
    zv.plate = Math.min(PAGE_COUNT, Math.max(1, n));
    zoomCanvas.innerHTML = '';
    var img = document.createElement('img');
    img.width = PLATE_W;
    img.height = PLATE_H;
    img.alt = 'Plate ' + pad(zv.plate);
    img.draggable = false;
    img.addEventListener('load', layoutPlate);
    img.src = plateSrc(zv.plate);
    zoomCanvas.appendChild(img);
    zoomLabel.textContent = pad(zv.plate) + ' / ' + PAGE_COUNT;
    zoomPrev.disabled = zv.plate <= 1;
    zoomNext.disabled = zv.plate >= PAGE_COUNT;
    layoutPlate();
  }

  function openZoom() {
    if (!pageFlip) { return; }
    var plates = visiblePlates(currentIndex);
    closeToc();
    window.clearTimeout(zoomHideTimer);
    zoomEl.hidden = false;
    zoomEl.setAttribute('aria-hidden', 'false');
    zv.open = true;
    zv.scale = 1; zv.x = 0; zv.y = 0;
    setZoomPlate(plates[0]);
    zoomCanvas.style.transition = 'none';
    applyZoom();
    window.requestAnimationFrame(function () {
      zoomEl.classList.add('is-open');
      zoomCanvas.style.transition = '';
    });
    zoomHint.classList.remove('is-faded');
    zoomClose.focus({ preventScroll: true });
  }

  /* Leave the reader where the zoom view left them: the book (and with it the
     track bar) moves to the plate last seen. If that plate is already on screen
     nothing is reloaded or turned. */
  function spreadIndexFor(plate) {
    if (plate <= 1) { return 0; }
    if (plate >= PAGE_COUNT) { return PAGE_COUNT - 1; }
    // spreads run [2,3] [4,5] … so an odd plate sits on the right of the one before it
    return (plate % 2 === 0) ? plate - 1 : plate - 2;
  }

  function syncBookToPlate(plate) {
    if (!pageFlip) { return; }
    plate = Math.min(PAGE_COUNT, Math.max(1, plate));
    if (visiblePlates(currentIndex).indexOf(plate) !== -1) { return; }
    var target = normalizeIndex(isSpread ? spreadIndexFor(plate) : plate - 1);
    target = Math.min(PAGE_COUNT - 1, Math.max(0, target));
    if (target === currentIndex) { return; }
    focusLock = false;   // the bar follows the spread the reader lands on
    showSpreadAt(target);
  }

  /* Turn only once the library is at rest, then check it actually got there —
     a turn it swallowed (or re-showed away when an animation ended) would leave
     the stage with no page drawn at all. */
  function showSpreadAt(target) {
    whenRead(function () {
      if (!pageFlip) { return; }
      try { pageFlip.turnToPage(target); } catch (err) { /* nothing to turn */ }
      window.setTimeout(function () { verifySpreadAt(target); }, 70);
    }, 0);
  }

  function verifySpreadAt(target) {
    if (!pageFlip) { return; }
    var landed = normalizeIndex(pageFlip.getCurrentPageIndex());
    if (landed !== target) {
      try { pageFlip.turnToPage(target); } catch (err) { /* nothing to turn */ }
      landed = normalizeIndex(pageFlip.getCurrentPageIndex());
    }
    onFlip(landed);
    if (!pagesPainted()) {
      // nothing is drawn: rebuild the book at the size this layout wants rather
      // than leave the stage showing an empty dark rectangle
      relayout();
      window.setTimeout(function () {
        if (!pageFlip) { return; }
        onFlip(normalizeIndex(currentIndex));
        repaintBook();
      }, 60);
      return;
    }
    repaintBook();
  }

  function pagesPainted() {
    var pages = bookEl.querySelectorAll('.page');
    for (var i = 0; i < pages.length; i++) {
      var cs = window.getComputedStyle(pages[i]);
      if (cs.display === 'none' || cs.visibility === 'hidden') { continue; }
      if (pages[i].getBoundingClientRect().width > 8) { return true; }
    }
    return false;
  }

  /* Closing must leave nothing of the viewer's layer behind: a full-screen
     fixed overlay holding a primed, scaled plate is exactly what desktop
     browsers keep painting as a black screen after the viewer is gone. So the
     overlay is made invisible on its own (visibility, not only opacity), and
     the plate bitmap, its layer and the book underneath are rebuilt. */
  function closeZoom() {
    if (!zv.open) { return; }
    var lastPlate = zv.plate;
    zv.open = false;
    zoomEl.classList.remove('is-open');
    zoomEl.setAttribute('aria-hidden', 'true');
    zv.pointers.clear();
    zv.pinch = null;
    zoomHint.classList.add('is-faded');
    window.clearTimeout(zoomHideTimer);
    zoomHideTimer = window.setTimeout(function () {
      if (zv.open) { return; }
      zoomEl.hidden = true;
      zoomCanvas.innerHTML = '';
      zoomCanvas.style.transition = 'none';
      zoomCanvas.style.transform = '';
      window.requestAnimationFrame(function () { zoomCanvas.style.transition = ''; });
      // the viewer can come down on a book that had nothing painted under it
      if (!pagesPainted()) { relayout(); }
      repaintBook();
    }, 340);
    syncBookToPlate(lastPlate);
    if (zoomBtn) { zoomBtn.focus({ preventScroll: true }); }
  }

  /* force the book back through paint/raster once the overlay is gone: if the
     browser dropped the book's tiles while it was covered, nothing else on the
     page would ask it to draw them again */
  function repaintBook() {
    if (!pageFlip) { return; }
    var keep = bookEl.style.transform;
    bookEl.style.transform = 'none';
    void bookEl.offsetWidth;
    bookEl.style.transform = keep;
    renderBookState();
  }

  function applyZoom() {
    zoomCanvas.style.transform = 'translate(' + zv.x + 'px,' + zv.y + 'px) scale(' + zv.scale + ')';
    zoomPct.textContent = Math.round(zv.scale * 100) + '%';
    zoomIn.disabled = zv.scale >= zv.max - 0.001;
    zoomOut.disabled = zv.scale <= zv.min + 0.001;
  }

  function clampPan() {
    var img = zoomCanvas.querySelector('img');
    if (!img) { return; }
    var w = img.offsetWidth * zv.scale;
    var h = img.offsetHeight * zv.scale;
    var overW = Math.max(0, (w - zoomCanvas.clientWidth) / 2);
    var overH = Math.max(0, (h - zoomCanvas.clientHeight) / 2);
    zv.x = Math.min(overW, Math.max(-overW, zv.x));
    zv.y = Math.min(overH, Math.max(-overH, zv.y));
  }

  function zoomTo(next, clientX, clientY) {
    next = Math.min(zv.max, Math.max(zv.min, next));
    if (Math.abs(next - zv.scale) < 0.001) { return; }
    var r = zoomStage.getBoundingClientRect();
    var cx = (clientX === undefined ? r.left + r.width / 2 : clientX) - (r.left + r.width / 2);
    var cy = (clientY === undefined ? r.top + r.height / 2 : clientY) - (r.top + r.height / 2);
    var k = next / zv.scale;
    zv.x = cx - k * (cx - zv.x);
    zv.y = cy - k * (cy - zv.y);
    zv.scale = next;
    if (zv.scale <= zv.min + 0.001) { zv.x = 0; zv.y = 0; }
    clampPan();
    applyZoom();
    if (Math.abs(zv.scale - zv.min) > 0.01) { zoomHint.classList.add('is-faded'); }
  }

  function resetZoom() {
    zv.scale = zv.min; zv.x = 0; zv.y = 0;
    zoomCanvas.style.transition = 'transform .26s cubic-bezier(.25,.7,.25,1)';
    applyZoom();
    window.setTimeout(function () { zoomCanvas.style.transition = ''; }, 280);
  }

  function wireZoom() {
    zoomBtn.addEventListener('click', openZoom);
    zoomClose.addEventListener('click', closeZoom);
    zoomIn.addEventListener('click', function () { zoomTo(zv.scale * 1.35); });
    zoomOut.addEventListener('click', function () { zoomTo(zv.scale / 1.35); });
    zoomFit.addEventListener('click', resetZoom);
    zoomPrev.addEventListener('click', function () { setZoomPlate(zv.plate - 1); });
    zoomNext.addEventListener('click', function () { setZoomPlate(zv.plate + 1); });

    zoomStage.addEventListener('wheel', function (e) {
      e.preventDefault();
      zoomTo(zv.scale * (e.deltaY < 0 ? 1.12 : 0.89), e.clientX, e.clientY);
    }, { passive: false });

    function twoPointerDistance() {
      var pts = Array.from(zv.pointers.values());
      return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    }
    function twoPointerMid() {
      var pts = Array.from(zv.pointers.values());
      return { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
    }

    zoomStage.addEventListener('pointerdown', function (e) {
      zoomStage.setPointerCapture(e.pointerId);
      zv.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      zv.downX = e.clientX;
      zv.downY = e.clientY;
      if (zv.pointers.size === 2) {
        zv.pinch = { dist: twoPointerDistance(), scale: zv.scale };
        zoomStage.classList.add('is-pinching');
      }
      zoomStage.classList.add('is-dragging');
    });

    zoomStage.addEventListener('pointermove', function (e) {
      var prev = zv.pointers.get(e.pointerId);
      if (!prev) { return; }
      zv.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (zv.pointers.size >= 2 && zv.pinch) {
        var d = twoPointerDistance();
        if (zv.pinch.dist > 0) {
          var mid = twoPointerMid();
          zoomTo(zv.pinch.scale * (d / zv.pinch.dist), mid.x, mid.y);
        }
        return;
      }
      if (zv.scale <= zv.min + 0.001) { return; }
      zv.x += e.clientX - prev.x;
      zv.y += e.clientY - prev.y;
      zoomStage.classList.add('is-dragging');
      clampPan();
      applyZoom();
      zoomHint.classList.add('is-faded');
    });

    function endPointer(e) {
      var wasSolo = zv.pointers.size === 1;
      zv.pointers.delete(e.pointerId);
      if (zv.pointers.size < 2) { zv.pinch = null; zoomStage.classList.remove('is-pinching'); }
      if (zv.pointers.size === 0) {
        zoomStage.classList.remove('is-dragging');
        // at fit size a horizontal swipe steps through the plates
        if (wasSolo && zv.scale <= zv.min + 0.01 && zv.downX !== undefined) {
          var dx = e.clientX - zv.downX;
          var dy = e.clientY - zv.downY;
          if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.3) {
            setZoomPlate(zv.plate + (dx < 0 ? 1 : -1));
          }
        }
      }
    }
    zoomStage.addEventListener('pointerup', endPointer);
    zoomStage.addEventListener('pointercancel', endPointer);

    // double click / double tap toggles fit ↔ 2x at that point
    zoomStage.addEventListener('dblclick', function (e) {
      e.preventDefault();
      zoomTo(zv.scale > 1.05 ? zv.min : Math.min(2, zv.max), e.clientX, e.clientY);
    });
    zoomStage.addEventListener('pointerup', function (e) {
      if (e.pointerType === 'mouse') { return; }
      var now = Date.now();
      if (now - zv.lastTap < 320 && Math.hypot(e.clientX - zv.lastTapX, e.clientY - zv.lastTapY) < 30) {
        zoomTo(zv.scale > 1.05 ? zv.min : Math.min(2, zv.max), e.clientX, e.clientY);
        zv.lastTap = 0;
      } else {
        zv.lastTap = now; zv.lastTapX = e.clientX; zv.lastTapY = e.clientY;
      }
    });
  }

  /* ---------------- pinch zoom on the stage ---------------- */

  /* The magnifier opens a viewer of its own; this is the quick gesture — two
     fingers on the book scale and move the spread where it stands. While the
     book is scaled, one finger moves it (a drag must not turn the page), and a
     tap puts it back to fit. */
  var bz = {
    scale: 1, max: 4, x: 0, y: 0, pinch: null, pan: null
  };

  function applyBaseZoom() {
    if (bz.scale <= 1.001) {
      bz.scale = 1; bz.x = 0; bz.y = 0;
      wrapEl.style.transform = '';
      stageEl.classList.remove('is-zoomed');
      return;
    }
    wrapEl.style.transform =
      'translate(' + bz.x.toFixed(1) + 'px,' + bz.y.toFixed(1) + 'px) scale(' + bz.scale.toFixed(3) + ')';
    stageEl.classList.add('is-zoomed');
  }

  function clampBasePan() {
    var r = stageEl.getBoundingClientRect();
    var overX = Math.max(0, (r.width * bz.scale - r.width) / 2);
    var overY = Math.max(0, (r.height * bz.scale - r.height) / 2);
    bz.x = Math.min(overX, Math.max(-overX, bz.x));
    bz.y = Math.min(overY, Math.max(-overY, bz.y));
  }

  function resetBaseZoom() {
    bz.pinch = null;
    bz.pan = null;
    bz.scale = 1;
    bz.x = 0;
    bz.y = 0;
    applyBaseZoom();
  }

  /* ---------------- table of contents ---------------- */

  function buildToc() {
    TRACKS.forEach(function (t, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'toc-item';
      b.dataset.track = String(i);
      b.innerHTML =
        '<span class="toc-num">' + t.num + '</span>' +
        '<span class="toc-name">' + t.title + '</span>' +
        '<span class="toc-page"><span>' + t.scene + '</span><span>p. ' + pad(t.page) + '</span></span>';
      b.addEventListener('click', function () {
        goToTrack(i);
        closeToc();
      });
      tocList.appendChild(b);
    });

    Array.prototype.forEach.call(document.querySelectorAll('.toc-aux'), function (b) {
      b.addEventListener('click', function () {
        var target = normalizeIndex(parseInt(b.dataset.page, 10) - 1);
        focusLock = false;
        pageFlip.turnToPage(target);
        closeToc();
      });
    });
  }

  function updateTocActive() {
    Array.prototype.forEach.call(tocList.children, function (item) {
      item.classList.toggle('is-active', Number(item.dataset.track) === focusTrack);
    });
  }

  function openToc() {
    tocEl.classList.add('is-open');
    tocEl.setAttribute('aria-hidden', 'false');
    tocBackdrop.hidden = false;
    window.requestAnimationFrame(function () { tocBackdrop.classList.add('is-open'); });
    tocBtn.setAttribute('aria-expanded', 'true');
  }

  function closeToc() {
    tocEl.classList.remove('is-open');
    tocEl.setAttribute('aria-hidden', 'true');
    tocBackdrop.classList.remove('is-open');
    tocBtn.setAttribute('aria-expanded', 'false');
    window.setTimeout(function () {
      if (!tocEl.classList.contains('is-open')) { tocBackdrop.hidden = true; }
    }, 380);
  }

  /* ---------------- wiring ---------------- */

  function wire() {
    nextBtn.addEventListener('click', next);
    prevBtn.addEventListener('click', prev);
    prevTrackBtn.addEventListener('click', function () { stepTrack(-1); });
    nextTrackBtn.addEventListener('click', function () { stepTrack(1); });

    tocBtn.addEventListener('click', function () {
      if (tocEl.classList.contains('is-open')) { closeToc(); } else { openToc(); }
    });
    tocClose.addEventListener('click', closeToc);
    tocBackdrop.addEventListener('click', closeToc);

    // tap left/right half to turn, on devices where the viewer owns gestures
    bookEl.addEventListener('click', function (e) {
      if (!ownGestures) { return; }
      var r = bookEl.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right) { return; }
      if (e.clientX - r.left > r.width / 2) { next(); } else { prev(); }
    });

    wireZoom();

    document.addEventListener('keydown', function (e) {
      if (zv.open) {
        if (e.key === 'Escape') { closeZoom(); }
        else if (e.key === '+' || e.key === '=') { zoomTo(zv.scale * 1.25); }
        else if (e.key === '-' || e.key === '_') { zoomTo(zv.scale / 1.25); }
        else if (e.key === '0') { resetZoom(); }
        else if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); if (zv.scale <= zv.min + 0.01) { setZoomPlate(zv.plate + 1); } }
        else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); if (zv.scale <= zv.min + 0.01) { setZoomPlate(zv.plate - 1); } }
        else if (e.key === ' ') { e.preventDefault(); }
        return;
      }
      if (e.key === 'ArrowRight' || e.key === 'PageDown') { next(); }
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { prev(); }
      else if (e.key === 'Escape') { closeToc(); }
      else if (e.key === 't' || e.key === 'T') {
        if (tocEl.classList.contains('is-open')) { closeToc(); } else { openToc(); }
      }
    });

    var resizeTimer = null;
    window.addEventListener('resize', function () {
      if (resizeTimer) { window.clearTimeout(resizeTimer); }
      resizeTimer = window.setTimeout(function () {
        resetBaseZoom();
        if (zv.open) { layoutPlate(); }
        var m = metrics();
        if (!pageFlip) { applySize(m); return; }
        var changed = (m.spread !== isSpread) ||
          Math.abs(bookEl.clientWidth - (m.spread ? m.pageW * 2 : m.pageW)) > 2 ||
          Math.abs(bookEl.clientHeight - m.pageH) > 2;
        if (changed) { relayout(); }
      }, 160);
    });

    var lastW = window.innerWidth;
    var lastH = window.innerHeight;
    window.addEventListener('orientationchange', function () {
      window.setTimeout(function () {
        if (window.innerWidth !== lastW || window.innerHeight !== lastH) {
          lastW = window.innerWidth; lastH = window.innerHeight; relayout();
        }
        resetBaseZoom();
        if (zv.open) { layoutPlate(); }
      }, 260);
    });

    // Horizontal swipe on touch screens. Capture-phase, so a library handler that
    // stops propagation cannot hide the gesture; the decision is deferred a tick so
    // the library's own flip (if any) is counted first and not repeated.
    // Two fingers are taken before the library sees them: they scale/move the spread
    // (pinch zoom) instead of turning a page.
    var swipe = null;
    var suppressClickUntil = 0;

    function touchPair(e) {
      var a = e.touches[0];
      var b = e.touches[1];
      return {
        d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
        mx: (a.clientX + b.clientX) / 2,
        my: (a.clientY + b.clientY) / 2
      };
    }

    stageEl.addEventListener('touchstart', function (e) {
      if (zv.open) { return; }
      if (e.touches.length >= 2) {
        e.preventDefault();
        e.stopPropagation();
        swipe = null;
        bz.pan = null;
        var p = touchPair(e);
        bz.pinch = { d: p.d, mx: p.mx, my: p.my, scale: bz.scale, x: bz.x, y: bz.y };
        suppressClickUntil = Date.now() + 600;
        return;
      }
      if (bz.scale > 1.001 && e.touches.length === 1) {
        // scaled in: one finger moves the spread
        e.preventDefault();
        e.stopPropagation();
        swipe = null;
        var t0 = e.touches[0];
        bz.pan = { x: t0.clientX, y: t0.clientY, bx: bz.x, by: bz.y, moved: false };
        return;
      }
      if (e.touches.length !== 1) { swipe = null; return; }
      swipe = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now(), index: currentIndex };
    }, { passive: false, capture: true });

    stageEl.addEventListener('touchmove', function (e) {
      if (bz.pinch && e.touches.length >= 2) {
        e.preventDefault();
        e.stopPropagation();
        var p = touchPair(e);
        if (bz.pinch.d > 0) {
          bz.scale = Math.min(bz.max, Math.max(1, bz.pinch.scale * (p.d / bz.pinch.d)));
        }
        if (bz.scale <= 1.001) {
          bz.scale = 1; bz.x = 0; bz.y = 0;
        } else {
          bz.x = bz.pinch.x + (p.mx - bz.pinch.mx);
          bz.y = bz.pinch.y + (p.my - bz.pinch.my);
          clampBasePan();
        }
        applyBaseZoom();
        return;
      }
      if (bz.pan && e.touches.length === 1) {
        e.preventDefault();
        e.stopPropagation();
        var t1 = e.touches[0];
        var px = t1.clientX - bz.pan.x;
        var py = t1.clientY - bz.pan.y;
        if (Math.abs(px) > 4 || Math.abs(py) > 4) { bz.pan.moved = true; }
        bz.x = bz.pan.bx + px;
        bz.y = bz.pan.by + py;
        clampBasePan();
        applyBaseZoom();
        return;
      }
      if (!swipe || !e.touches || !e.touches.length) { return; }
      swipe.lastX = e.touches[0].clientX;
      swipe.lastY = e.touches[0].clientY;
    }, { passive: false, capture: true });

    stageEl.addEventListener('touchend', function (e) {
      if (bz.pinch) {
        if (e.touches.length >= 2) { return; }
        bz.pinch = null;
        suppressClickUntil = Date.now() + 250;
        // barely off fit? call it fit, so the spread never sits a hair oversized
        if (bz.scale < 1.08) { resetBaseZoom(); return; }
        if (e.touches.length === 1) {
          var rest = e.touches[0];
          bz.pan = { x: rest.clientX, y: rest.clientY, bx: bz.x, by: bz.y, moved: true };
        }
        return;
      }
      if (bz.pan) {
        var wasMoved = bz.pan.moved;
        bz.pan = null;
        suppressClickUntil = Date.now() + 420;
        // a tap on a scaled spread puts it back to fit
        if (!wasMoved) { resetBaseZoom(); }
        return;
      }
      if (!swipe) { return; }
      var s = swipe;
      swipe = null;
      var t = (e.changedTouches && e.changedTouches[0]) || null;
      var x = t ? t.clientX : s.lastX;
      var y = t ? t.clientY : s.lastY;
      if (x === undefined || y === undefined) { return; }
      if (Math.abs(x - s.x) >= 64) { suppressClickUntil = Date.now() + 700; }
      window.setTimeout(function () {
        var dx = x - s.x;
        var dy = y - s.y;
        if (Date.now() - s.t > 1200) { return; }
        if (Math.abs(dx) < 64 || Math.abs(dx) < Math.abs(dy) * 1.4) { return; }
        // the library may still be holding a corner from this same gesture
        whenRead(function () {
          if (currentIndex !== s.index) { return; }
          if (dx < 0) { next(); } else { prev(); }
        }, 0);
      }, 0);
    }, { passive: false, capture: true });

    // a swipe also produces a synthetic click; keep it from turning the page again
    stageEl.addEventListener('click', function (e) {
      if (Date.now() < suppressClickUntil) {
        e.stopPropagation();
        e.preventDefault();
      }
    }, true);
  }

  /* ---------------- boot ---------------- */

  function start() {
    loadingEl.classList.add('is-done');
    var m = metrics();
    createFlip(m);
    bookEl.classList.add('is-ready');
    onFlip(0);
    renderNav();
    renderBookState();
    setTrack(0);
  }

  buildToc();
  wire();
  preload();

  // Safari's own page pinch would fight the spread's pinch zoom
  ['gesturestart', 'gesturechange', 'gestureend'].forEach(function (name) {
    document.addEventListener(name, function (e) { e.preventDefault(); }, { passive: false });
  });

  // opt-in hook for automated checks (?debug=1)
  if (location.search.indexOf('debug=1') !== -1) {
    window.__tn = {
      state: function () {
        return {
          page: currentIndex,
          spread: isSpread,
          track: focusTrack,
          embed: amPlayer ? amPlayer.getAttribute('src') : null,
          embedTitle: amPlayer ? amPlayer.getAttribute('title') : null,
          trackTitle: TRACKS[focusTrack].title
        };
      },
      goToTrack: goToTrack,
      zoom: function () {
        var img = zoomCanvas.querySelector('img');
        var r = img ? img.getBoundingClientRect() : null;
        return {
          open: zv.open, plate: zv.plate, scale: zv.scale,
          natural: img ? [img.naturalWidth, img.naturalHeight] : null,
          rect: r ? [r.width, r.height] : null
        };
      },
      openZoom: openZoom,
      closeZoom: closeZoom,
      setZoomPlate: setZoomPlate,
      syncBookToPlate: syncBookToPlate,
      normalizeIndex: normalizeIndex,
      onFlip: function (i) { onFlip(i); },
      flipState: function () { try { return pageFlip.getState(); } catch (e) { return 'n/a'; } },
      flipNext: function () { pageFlip.flipNext(); }
    };
  }
})();
