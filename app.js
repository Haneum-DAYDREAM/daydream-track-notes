/* DAYDREAM TRACK NOTES — flipbook + track player
   Page/plate artwork stays untouched; the viewer only frames it. */
(function () {
  'use strict';

  var PAGE_COUNT = 16;
  var PAGE_RATIO = 128 / 182; // width / height of every plate

  var TRACKS = [
    { num: '01', title: 'Imagine',        scene: 'Scene 01', page: 3,  id: '3yeYTi52VxI' },
    { num: '02', title: 'Daydream',       scene: 'Scene 02', page: 4,  id: 'aWkPxOeKW_E' },
    { num: '03', title: 'Kingdom come',   scene: 'Scene 03', page: 5,  id: 'QPyb9n1LjKs' },
    { num: '04', title: 'WANNA',          scene: 'Scene 04', page: 6,  id: 'EJHtJSoVoz8' },
    { num: '05', title: 'Hélas',          scene: 'Scene 05', page: 8,  id: 'rInM7pCtx7k' },
    { num: '06', title: 'Only 1',         scene: 'Scene 06', page: 10, id: 'U8p40vMBbQc' },
    { num: '07', title: 'Imperfect',      scene: 'Scene 07', page: 12, id: 'AhA2AQbiPfc' },
    { num: '08', title: 'After the dream', scene: 'Scene 08', page: 13, id: '2iJ_tbRQwIw' },
    { num: '09', title: 'MidsummerNight', scene: 'Scene 09', page: 14, id: 'XcT1uqzITfE' }
  ];

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
  var playBtn = el('playBtn');
  var prevTrackBtn = el('prevTrack');
  var nextTrackBtn = el('nextTrack');
  var progressEl = el('progress');
  var progressFill = el('progressFill');
  var progressKnob = el('progressKnob');
  var tCur = el('tCur');
  var tDur = el('tDur');
  var playerNote = el('playerNote');
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

  var pageFlip = null;
  var isSpread = true;
  // on touch devices the viewer owns the gestures (the library's own touch drag
  // leaves the flip in a busy state and swallows the next swipe)
  var ownGestures = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  var currentIndex = 0;      // 0-based index of the left-most visible plate
  var focusTrack = 0;        // track shown in the bar
  var focusLock = false;     // keep focusTrack on the next flip (programmatic jumps)
  var userStarted = false;   // has the user pressed play at least once
  var player = null;
  var playerReady = false;
  var playerFailed = false;
  var pendingPlay = false;
  var isPlaying = false;
  var tickTimer = null;
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
    availW = Math.max(availW, 120);
    availH = Math.max(availH, 160);

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
    pageFlip.on('changeOrientation', function () {
      // library switched between single page and spread on its own
      onFlip(pageFlip.getCurrentPageIndex());
    });
  }

  function relayout() {
    if (!pageFlip) { return; }
    var m = metrics();
    var keep = currentIndex;
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

  function onFlip(index) {
    currentIndex = index;
    var plates = visiblePlates(index);
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
    setTrack(main, userStarted);
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
    if (state === 'read' || tries > 14) { cb(); return; }
    window.setTimeout(function () { whenRead(cb, tries + 1); }, 24);
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

  function setTrack(index, play) {
    if (index < 0 || index >= TRACKS.length) { return; }
    var changed = index !== focusTrack;
    focusTrack = index;
    var t = TRACKS[index];

    barScene.textContent = t.scene;
    barTitle.textContent = t.title;
    updateTocActive();

    if (changed) {
      clearPlayerNote();
      barId.classList.add('is-changing');
      window.setTimeout(function () { barId.classList.remove('is-changing'); }, 220);
      progressFill.style.width = '0%';
      progressKnob.style.left = '0%';
      tCur.textContent = '0:00';
      tDur.textContent = '0:00';
    }
    cueTrack(t.id, !!play);
  }

  function cueTrack(id, play) {
    if (playerFailed) { return; }
    if (!playerReady) {
      pendingId = id;
      pendingPlay = pendingPlay || !!play;
      return;
    }
    if (play) {
      player.loadVideoById(id);
    } else if (currentVideoId !== id) {
      player.cueVideoById(id);
    }
    currentVideoId = id;
  }

  var pendingId = null;
  var currentVideoId = null;

  function togglePlay() {
    if (playerFailed) { return; }
    if (!userStarted) {
      userStarted = true;
      playBtn.classList.remove('is-idle');
      playBtn.setAttribute('aria-label', '일시정지');
      if (playerReady) {
        player.loadVideoById(TRACKS[focusTrack].id);
        currentVideoId = TRACKS[focusTrack].id;
      } else {
        pendingPlay = true;
      }
      return;
    }
    if (!playerReady) { pendingPlay = true; return; }

    if (isPlaying) {
      player.pauseVideo();
    } else {
      var dur = 0;
      try { dur = player.getDuration() || 0; } catch (e) { dur = 0; }
      var cur = 0;
      try { cur = player.getCurrentTime() || 0; } catch (e) { cur = 0; }
      if (dur > 0 && dur - cur < 1) { player.seekTo(0, true); }
      player.playVideo();
    }
  }

  function stepTrack(dir) {
    var nextIndex = (focusTrack + dir + TRACKS.length) % TRACKS.length;
    goToTrack(nextIndex);
  }

  function goToTrack(index) {
    if (!pageFlip) { setTrack(index, false); return; }
    var target = TRACKS[index].page - 1;
    focusTrack = index;
    var plates = visiblePlates(currentIndex);
    if (plates.indexOf(TRACKS[index].page) !== -1) {
      setTrack(index, userStarted);
      return;
    }
    focusLock = true;
    setTrack(index, false);
    if (target !== currentIndex) {
      pageFlip.turnToPage(target);
    }
    // after the turn, playback follows the new track
    if (userStarted) {
      window.setTimeout(function () {
        if (playerReady && currentVideoId !== TRACKS[focusTrack].id) {
          player.loadVideoById(TRACKS[focusTrack].id);
          currentVideoId = TRACKS[focusTrack].id;
        }
      }, 420);
    }
  }

  /* ---------------- YouTube ---------------- */

  function loadYouTubeApi() {
    if (window.YT && window.YT.Player) { initPlayer(); return; }
    var tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    tag.async = true;
    tag.onerror = function () { onPlayerFailed(); };
    document.head.appendChild(tag);

    window.onYouTubeIframeAPIReady = function () { initPlayer(); };
    window.setTimeout(function () {
      if (!playerReady && !playerFailed) { onPlayerFailed(); }
    }, 12000);
  }

  function initPlayer() {
    if (player || playerFailed) { return; }
    var vars = {
      autoplay: 0,
      controls: 0,
      disablekb: 1,
      modestbranding: 1,
      rel: 0,
      playsinline: 1,
      fs: 0,
      iv_load_policy: 3,
      enablejsapi: 1
    };
    if (location.protocol === 'http:' || location.protocol === 'https:') {
      vars.origin = location.origin;
    }
    try {
      player = new YT.Player('ytPlayer', {
        width: '100%',
        height: '100%',
        videoId: TRACKS[focusTrack].id,
        playerVars: vars,
        events: {
          onReady: onPlayerReady,
          onStateChange: onPlayerState,
          onError: onPlayerError
        }
      });
    } catch (err) {
      onPlayerFailed();
    }
  }

  function onPlayerReady() {
    playerReady = true;
    currentVideoId = TRACKS[focusTrack].id;
    // the dark plate stays over the player until the first sound actually plays
    if (pendingId && pendingId !== currentVideoId) {
      if (pendingPlay) { player.loadVideoById(pendingId); } else { player.cueVideoById(pendingId); }
      currentVideoId = pendingId;
      pendingId = null;
    }
    if (pendingPlay) {
      pendingPlay = false;
      userStarted = true;
      playBtn.classList.remove('is-idle');
      playBtn.setAttribute('aria-label', '일시정지');
      player.loadVideoById(TRACKS[focusTrack].id);
      currentVideoId = TRACKS[focusTrack].id;
    }
    startTick();
  }

  function onPlayerState(e) {
    isPlaying = (e.data === 1);
    if (isPlaying) { playerNote.classList.add('is-hidden'); }
    playBtn.classList.toggle('is-playing', isPlaying);
    if (userStarted) {
      playBtn.classList.toggle('is-idle', false);
      playBtn.setAttribute('aria-label', isPlaying ? '일시정지' : '재생');
    }
  }

  var lastErrorCode = null;

  function onPlayerError(e) {
    lastErrorCode = e && e.data;
    // 2/5/100/101/150: this clip (or this network) cannot play in the embed.
    // Keep the magazine and the other tracks usable, and point to YouTube.
    showPlayerNote(
      '이 영상은 삽입 재생이 제한됩니다',
      'https://www.youtube.com/watch?v=' + (currentVideoId || TRACKS[focusTrack].id)
    );
  }

  function showPlayerNote(text, url) {
    playerNote.classList.remove('is-hidden');
    playerNote.classList.add('is-error');
    playerNote.innerHTML = '<span>' + text + '</span><br><a href="' + url +
      '" target="_blank" rel="noopener">YouTube에서 열기 \u2197</a>';
  }

  function clearPlayerNote() {
    if (!playerNote.classList.contains('is-error')) { return; }
    playerNote.classList.remove('is-error');
    playerNote.innerHTML = '<span class="player-tag">Official audio</span>';
  }

  function onPlayerFailed() {
    playerFailed = true;
    playerNote.classList.remove('is-hidden');
    playerNote.classList.add('is-error');
    playerNote.textContent = 'YouTube 음원을 불러오지 못했습니다';
  }

  function startTick() {
    if (tickTimer) { return; }
    tickTimer = window.setInterval(tick, 250);
  }

  function tick() {
    if (!playerReady || !player) { return; }
    var dur = 0, cur = 0;
    try { dur = player.getDuration() || 0; cur = player.getCurrentTime() || 0; } catch (err) { return; }
    if (dur > 0) {
      var pct = Math.min(100, (cur / dur) * 100);
      progressFill.style.width = pct + '%';
      progressKnob.style.left = pct + '%';
      progressEl.setAttribute('aria-valuenow', Math.round(pct));
      tCur.textContent = fmt(cur);
      tDur.textContent = fmt(dur);
    }
  }

  function fmt(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return m + ':' + (s < 10 ? '0' + s : s);
  }

  function seekFromEvent(evt) {
    if (!playerReady || !player) { return; }
    var rect = progressEl.getBoundingClientRect();
    var x = (evt.touches ? evt.touches[0].clientX : evt.clientX) - rect.left;
    var ratio = Math.max(0, Math.min(1, x / rect.width));
    var dur = 0;
    try { dur = player.getDuration() || 0; } catch (err) { return; }
    if (!dur) { return; }
    player.seekTo(dur * ratio, true);
    progressFill.style.width = (ratio * 100) + '%';
    progressKnob.style.left = (ratio * 100) + '%';
  }

  /* ---------------- zoom view ---------------- */

  var zv = {
    open: false, scale: 1, min: 1, max: 3, x: 0, y: 0, plate: 1,
    pointers: new Map(), pinch: null, lastTap: 0, lastTapX: 0, lastTapY: 0
  };

  function setZoomPlate(n) {
    zv.plate = Math.min(PAGE_COUNT, Math.max(1, n));
    zoomCanvas.innerHTML = '';
    var img = document.createElement('img');
    img.src = plateSrc(zv.plate);
    img.alt = 'Plate ' + pad(zv.plate);
    img.draggable = false;
    zoomCanvas.appendChild(img);
    zoomLabel.textContent = pad(zv.plate) + ' / ' + PAGE_COUNT;
    zoomPrev.disabled = zv.plate <= 1;
    zoomNext.disabled = zv.plate >= PAGE_COUNT;
    clampPan();
    applyZoom();
  }

  function openZoom() {
    if (!pageFlip) { return; }
    var plates = visiblePlates(currentIndex);
    closeToc();
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

  function closeZoom() {
    if (!zv.open) { return; }
    zv.open = false;
    zoomEl.classList.remove('is-open');
    zoomEl.setAttribute('aria-hidden', 'true');
    zv.pointers.clear();
    zv.pinch = null;
    window.setTimeout(function () {
      if (!zv.open) { zoomEl.hidden = true; }
    }, 300);
    if (zoomBtn) { zoomBtn.focus({ preventScroll: true }); }
  }

  function applyZoom() {
    zoomCanvas.style.transform = 'translate3d(' + zv.x + 'px,' + zv.y + 'px,0) scale(' + zv.scale + ')';
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
        var target = parseInt(b.dataset.page, 10) - 1;
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
    playBtn.addEventListener('click', togglePlay);
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

    progressEl.addEventListener('click', seekFromEvent);
    wireZoom();
    progressEl.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        e.stopPropagation();
        if (!playerReady) { return; }
        var cur = player.getCurrentTime() || 0;
        player.seekTo(Math.max(0, cur + (e.key === 'ArrowRight' ? 5 : -5)), true);
      }
    });

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
      else if (e.key === ' ' || e.code === 'Space') {
        if (e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) { return; }
        e.preventDefault();
        togglePlay();
      } else if (e.key === 't' || e.key === 'T') {
        if (tocEl.classList.contains('is-open')) { closeToc(); } else { openToc(); }
      }
    });

    var resizeTimer = null;
    window.addEventListener('resize', function () {
      if (resizeTimer) { window.clearTimeout(resizeTimer); }
      resizeTimer = window.setTimeout(function () {
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
      }, 260);
    });

    // horizontal swipe on touch screens (kept alongside the library's own gestures;
    // skipped when the library already turned the page during this gesture)
    // horizontal swipe on touch screens. Capture-phase, so a library handler that
    // stops propagation cannot hide the gesture; the decision is deferred a tick so
    // the library's own flip (if any) is counted first and not repeated.
    var swipe = null;
    var suppressClickUntil = 0;
    stageEl.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1) { swipe = null; return; }
      swipe = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now(), index: currentIndex };
    }, { passive: true, capture: true });

    stageEl.addEventListener('touchmove', function (e) {
      if (!swipe || !e.touches || !e.touches.length) { return; }
      swipe.lastX = e.touches[0].clientX;
      swipe.lastY = e.touches[0].clientY;
    }, { passive: true, capture: true });

    stageEl.addEventListener('touchend', function (e) {
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
    }, { passive: true, capture: true });

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
    setTrack(0, false);
    playBtn.classList.add('is-idle');
    loadYouTubeApi();
  }

  buildToc();
  wire();
  preload();

  // opt-in hook for automated checks (?debug=1)
  if (location.search.indexOf('debug=1') !== -1) {
    window.__tn = {
      state: function () {
        return {
          page: currentIndex,
          spread: isSpread,
          track: focusTrack,
          videoId: currentVideoId,
          ready: playerReady,
          failed: playerFailed,
          started: userStarted,
          playing: isPlaying,
          playerState: (playerReady && player && player.getPlayerState) ? player.getPlayerState() : -1,
          time: (playerReady && player && player.getCurrentTime) ? player.getCurrentTime() : 0,
          error: lastErrorCode
        };
      },
      goToTrack: goToTrack,
      flipState: function () { try { return pageFlip.getState(); } catch (e) { return 'n/a'; } },
      flipNext: function () { pageFlip.flipNext(); }
    };
  }
})();
