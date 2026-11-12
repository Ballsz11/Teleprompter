/* ============================================================
   Teleprompter — app logic
   No dependencies. Works from file:// or any static host.
   ============================================================ */

(function () {
  'use strict';

  var KEY = 'teleprompter.v1';

  /* ---------------------------------------------------------
     Elements (script is loaded at the end of <body>)
     --------------------------------------------------------- */
  var $ = function (id) { return document.getElementById(id); };

  var editorView    = $('editor-view');
  var prompterView  = $('prompter-view');
  var textarea      = $('script-input');
  var scriptMeta    = $('script-meta');
  var startBtn      = $('start-btn');
  var pasteBtn      = $('paste-btn');
  var clearBtn      = $('clear-btn');
  var themeBtn      = $('theme-btn');
  var stage         = $('stage');
  var scroller      = $('text-scroller');
  var scriptText    = $('script-text');
  var controls      = $('controls');
  var playBtn       = $('play-btn');
  var playIcon      = $('play-icon');
  var restartBtn    = $('restart-btn');
  var mirrorBtn     = $('mirror-btn');
  var fullscreenBtn = $('fullscreen-btn');
  var editBtn       = $('edit-btn');
  var speedSlider   = $('speed-slider');
  var speedValue    = $('speed-value');
  var fontSlider    = $('font-slider');
  var fontValue     = $('font-value');
  var progressFill  = $('progress-fill');
  var timeLeftEl    = $('time-left');
  var toastEl       = $('toast');

  /* ---------------------------------------------------------
     State (persisted to localStorage)
     --------------------------------------------------------- */
  var state = {
    script: '',
    fontSize: window.innerWidth <= 720 ? 34 : 52,
    wpm: 160,
    mirror: false,
    theme: 'dark'
  };

  loadState();

  var pxPerWord   = 0;   // vertical pixels one "word" of scroll costs
  var totalWords  = 0;
  var playing     = false;
  var rafId       = null;
  var lastTs      = 0;
  var pendingPx   = 0;   // sub-pixel scroll remainder between frames
  var saveTimer   = null;
  var hideTimer   = null;
  var toastTimer  = null;

  /* ---------------------------------------------------------
     Persistence
     --------------------------------------------------------- */
  function loadState() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return;
      var s = JSON.parse(raw);
      if (!s || typeof s !== 'object') return;
      if (typeof s.script === 'string') state.script = s.script;
      if (isFinite(s.fontSize)) state.fontSize = clamp(+s.fontSize, 20, 160);
      if (isFinite(s.wpm)) state.wpm = clamp(+s.wpm, 60, 400);
      if (typeof s.mirror === 'boolean') state.mirror = s.mirror;
      if (s.theme === 'light' || s.theme === 'dark') state.theme = s.theme;
    } catch (e) { /* corrupted or unavailable storage — keep defaults */ }
  }

  function saveState(now) {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    var write = function () {
      try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
    };
    if (now) write();
    else saveTimer = setTimeout(write, 250);
  }

  /* ---------------------------------------------------------
     Small helpers
     --------------------------------------------------------- */
  function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }

  function countWords() {
    var t = state.script.trim();
    return t ? t.split(/\s+/).length : 0;
  }

  function fmtTime(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    var m = Math.floor(sec / 60);
    var s = Math.floor(sec % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastEl.classList.remove('show');
    }, 2400);
  }

  /* ---------------------------------------------------------
     Applying settings
     --------------------------------------------------------- */
  function applyTheme() {
    document.body.setAttribute('data-theme', state.theme);
    themeBtn.textContent = state.theme === 'dark' ? '☀️' : '🌙';
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', state.theme === 'dark' ? '#0b0e14' : '#f2f4f9');
  }

  function applyFont() {
    scriptText.style.fontSize = state.fontSize + 'px';
    fontSlider.value = String(state.fontSize);
    fontValue.textContent = state.fontSize + 'px';
    computeMetrics();
    var max = maxScroll();
    if (scroller.scrollTop > max) scroller.scrollTop = max;
  }

  function applyWpm() {
    speedSlider.value = String(state.wpm);
    speedValue.textContent = state.wpm + ' wpm';
    updateMeta();
    updateTimeLeft();
  }

  function applyMirror() {
    scriptText.classList.toggle('mirrored', state.mirror);
    mirrorBtn.setAttribute('aria-pressed', state.mirror ? 'true' : 'false');
    mirrorBtn.classList.toggle('is-active', state.mirror);
  }

  function setFontSize(px) {
    state.fontSize = clamp(Math.round(px / 2) * 2, 20, 160);
    applyFont();
    updateProgress();
    saveState();
  }

  function setWpm(wpm) {
    state.wpm = clamp(Math.round(wpm / 5) * 5, 60, 400);
    applyWpm();
    saveState();
  }

  function setMirror(on) {
    state.mirror = !!on;
    applyMirror();
    saveState();
  }

  /* ---------------------------------------------------------
     Script rendering + metrics
     --------------------------------------------------------- */
  function renderScript() {
    scriptText.textContent = state.script;
    computeMetrics();
  }

  function updateMeta() {
    totalWords = countWords();
    startBtn.disabled = totalWords === 0;
    if (totalWords === 0) {
      scriptMeta.textContent = '0 words';
    } else {
      var sec = totalWords * 60 / state.wpm;
      scriptMeta.textContent =
        totalWords + (totalWords === 1 ? ' word · about ' : ' words · about ') +
        fmtTime(sec) + ' at ' + state.wpm + ' wpm';
    }
  }

  // Vertical pixels one word consumes (total text height / word count).
  // Scroll speed = pxPerWord * wpm / 60, which makes the WPM slider
  // accurate regardless of font size or screen width.
  function computeMetrics() {
    var words = countWords();
    var h = scriptText.offsetHeight;
    if (words > 0 && h > 0) {
      pxPerWord = h / words;
    } else {
      var fs = state.fontSize;
      var lineH = fs * 1.55;
      var lineW = Math.max(240, scroller.clientWidth - 48);
      var wordsPerLine = Math.max(1, lineW / (3.3 * fs));
      pxPerWord = lineH / wordsPerLine;
    }
  }

  function pxPerSecond() {
    return pxPerWord * state.wpm / 60;
  }

  /* ---------------------------------------------------------
     Scrolling / playback
     --------------------------------------------------------- */
  function maxScroll() {
    return Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  }

  function updateProgress() {
    var max = maxScroll();
    var p = max > 0 ? clamp(scroller.scrollTop / max, 0, 1) : 0;
    progressFill.style.width = (p * 100).toFixed(2) + '%';
    updateTimeLeft(p);
  }

  function updateTimeLeft(progress) {
    if (typeof progress !== 'number') {
      var max = maxScroll();
      progress = max > 0 ? clamp(scroller.scrollTop / max, 0, 1) : 0;
    }
    var total = totalWords * 60 / state.wpm;
    timeLeftEl.textContent = fmtTime(total * (1 - progress));
  }

  function tick(ts) {
    if (!playing) return;
    if (!lastTs) lastTs = ts;
    var dt = Math.min(0.1, (ts - lastTs) / 1000); // clamp tab-switch jumps
    lastTs = ts;

    var max = maxScroll();
    if (max > 0 && scroller.scrollTop >= max - 0.5) {
      scroller.scrollTop = max;
      updateProgress();
      setPlaying(false);
      toast('📄 End of script');
      return;
    }

    pendingPx += pxPerSecond() * dt;
    var target = scroller.scrollTop + pendingPx;
    scroller.scrollTop = target;
    // If the browser rounds scrollTop, carry the remainder so slow
    // speeds never stall.
    pendingPx = target - scroller.scrollTop;
    updateProgress();
    rafId = requestAnimationFrame(tick);
  }

  function setPlaying(v) {
    if (v === playing) return;
    playing = v;
    playIcon.textContent = playing ? '⏸' : '▶';
    playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    if (playing) {
      lastTs = 0;
      pendingPx = 0;
      rafId = requestAnimationFrame(tick);
      pokeControls();
    } else {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = null;
      if (hideTimer) clearTimeout(hideTimer);
      controls.classList.remove('is-hidden');
    }
  }

  function togglePlay() {
    if (!playing && maxScroll() > 0 && scroller.scrollTop >= maxScroll() - 1) {
      scroller.scrollTop = 0; // replay from the top after finishing
    }
    setPlaying(!playing);
  }

  function restart() {
    scroller.scrollTop = 0;
    updateProgress();
  }

  /* ---------------------------------------------------------
     Views
     --------------------------------------------------------- */
  function showView(name) {
    var prompter = name === 'prompter';
    editorView.hidden = prompter;
    prompterView.hidden = !prompter;
    document.body.classList.toggle('is-prompting', prompter);

    if (prompter) {
      renderScript();
      scroller.scrollTop = 0;
      requestAnimationFrame(function () {
        computeMetrics();
        updateProgress();
      });
      try { stage.focus({ preventScroll: true }); } catch (e) { stage.focus(); }
    } else {
      setPlaying(false);
    }
  }

  function startPrompting() {
    if (!state.script.trim()) {
      toast('✍️ Write or paste a script first');
      textarea.focus();
      return;
    }
    showView('prompter');
  }

  function goToEditor() {
    setPlaying(false);
    exitFullscreen();
    showView('editor');
    try { textarea.focus({ preventScroll: true }); } catch (e) { textarea.focus(); }
  }

  /* ---------------------------------------------------------
     Fullscreen (with a CSS fallback for iOS Safari)
     --------------------------------------------------------- */
  function fullscreenElement() {
    return document.fullscreenElement || document.webkitFullscreenElement || null;
  }

  function isFullscreenActive() {
    return !!fullscreenElement() || stage.classList.contains('is-pseudo-fullscreen');
  }

  function syncFullscreenBtn() {
    var on = isFullscreenActive();
    fullscreenBtn.classList.toggle('is-active', on);
    fullscreenBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    fullscreenBtn.title = on ? 'Exit fullscreen (F)' : 'Fullscreen (F)';
    pokeControls();
  }

  function exitFullscreen() {
    stage.classList.remove('is-pseudo-fullscreen');
    var el = fullscreenElement();
    var exit = document.exitFullscreen || document.webkitExitFullscreen;
    if (el && exit) {
      var p = exit.call(document);
      if (p && p.catch) p.catch(function () {});
    }
    syncFullscreenBtn();
  }

  function toggleFullscreen() {
    if (isFullscreenActive()) { exitFullscreen(); return; }
    var req = stage.requestFullscreen || stage.webkitRequestFullscreen;
    if (req) {
      var p = req.call(stage);
      if (p && p.catch) p.catch(function () {
        stage.classList.add('is-pseudo-fullscreen');
        syncFullscreenBtn();
      });
    } else {
      stage.classList.add('is-pseudo-fullscreen');
      syncFullscreenBtn();
    }
  }

  /* ---------------------------------------------------------
     Auto-hiding controls while playing in fullscreen
     --------------------------------------------------------- */
  function pokeControls() {
    controls.classList.remove('is-hidden');
    if (hideTimer) clearTimeout(hideTimer);
    if (playing && isFullscreenActive()) {
      hideTimer = setTimeout(function () {
        if (playing && isFullscreenActive()) controls.classList.add('is-hidden');
      }, 2600);
    }
  }

  ['pointermove', 'pointerdown', 'touchstart', 'keydown'].forEach(function (ev) {
    document.addEventListener(ev, pokeControls, { passive: true });
  });

  /* ---------------------------------------------------------
     Toast-free clipboard paste with graceful fallback
     --------------------------------------------------------- */
  function insertAtCursor(text) {
    var start = textarea.selectionStart;
    var end = textarea.selectionEnd;
    var before = textarea.value.slice(0, start);
    var after = textarea.value.slice(end);
    var sep = before && !/\n$/.test(before) ? '\n\n' : '';
    textarea.value = before + sep + text + after;
    var pos = before.length + sep.length + text.length;
    textarea.setSelectionRange(pos, pos);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.focus();
  }

  async function pasteFromClipboard() {
    try {
      if (!navigator.clipboard || !navigator.clipboard.readText) throw new Error('unsupported');
      var text = await navigator.clipboard.readText();
      if (!text) { toast('Clipboard is empty'); return; }
      insertAtCursor(text);
      toast('📋 Pasted');
    } catch (e) {
      textarea.focus();
      var mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
      toast('Press ' + (mac ? '⌘' : 'Ctrl') + '+V to paste');
    }
  }

  /* ---------------------------------------------------------
     Editor events
     --------------------------------------------------------- */
  textarea.addEventListener('input', function () {
    state.script = textarea.value;
    updateMeta();
    saveState();
  });

  startBtn.addEventListener('click', startPrompting);
  pasteBtn.addEventListener('click', pasteFromClipboard);

  clearBtn.addEventListener('click', function () {
    if (!textarea.value) return;
    if (!window.confirm('Clear the script?')) return;
    textarea.value = '';
    state.script = '';
    updateMeta();
    saveState(true);
    textarea.focus();
  });

  themeBtn.addEventListener('click', function () {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    applyTheme();
    saveState();
  });

  /* ---------------------------------------------------------
     Prompter control events
     --------------------------------------------------------- */
  playBtn.addEventListener('click', togglePlay);
  restartBtn.addEventListener('click', restart);
  editBtn.addEventListener('click', goToEditor);
  fullscreenBtn.addEventListener('click', toggleFullscreen);
  mirrorBtn.addEventListener('click', function () { setMirror(!state.mirror); });

  speedSlider.addEventListener('input', function () {
    setWpm(Number(speedSlider.value));
  });

  fontSlider.addEventListener('input', function () {
    setFontSize(Number(fontSlider.value));
  });

  scroller.addEventListener('scroll', updateProgress, { passive: true });

  document.addEventListener('fullscreenchange', syncFullscreenBtn);
  document.addEventListener('webkitfullscreenchange', syncFullscreenBtn);

  /* ---------------------------------------------------------
     Keyboard shortcuts
     --------------------------------------------------------- */
  document.addEventListener('keydown', function (e) {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;

    var t = e.target;
    var tag = t ? t.tagName : '';
    var typing = tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT' ||
                 (t && t.isContentEditable);
    if (typing) return;
    if (tag === 'BUTTON' && (e.key === ' ' || e.key === 'Spacebar' || e.key === 'Enter')) return;

    if (prompterView.hidden) return; // shortcuts are prompter-only

    switch (e.key) {
      case ' ':
      case 'Spacebar':
        e.preventDefault();
        togglePlay();
        break;
      case 'ArrowUp':
        e.preventDefault();
        setWpm(state.wpm + 5);
        break;
      case 'ArrowDown':
        e.preventDefault();
        setWpm(state.wpm - 5);
        break;
      case 'ArrowRight':
      case '+':
      case '=':
        e.preventDefault();
        setFontSize(state.fontSize + 2);
        break;
      case 'ArrowLeft':
      case '-':
      case '_':
        e.preventDefault();
        setFontSize(state.fontSize - 2);
        break;
      case 'r':
      case 'R':
        restart();
        break;
      case 'm':
      case 'M':
        setMirror(!state.mirror);
        break;
      case 'f':
      case 'F':
        toggleFullscreen();
        break;
      case 'e':
      case 'E':
        goToEditor();
        break;
      case 'Escape':
        if (stage.classList.contains('is-pseudo-fullscreen')) {
          stage.classList.remove('is-pseudo-fullscreen');
          syncFullscreenBtn();
        } else if (!fullscreenElement()) {
          goToEditor();
        }
        break;
    }
  });

  /* ---------------------------------------------------------
     Keep metrics fresh on resize / reflow
     --------------------------------------------------------- */
  function relayout() {
    computeMetrics();
    updateProgress();
  }

  window.addEventListener('resize', relayout);
  window.addEventListener('orientationchange', relayout);

  if (window.ResizeObserver) {
    var ro = new ResizeObserver(relayout);
    ro.observe(scroller);
    ro.observe(scriptText);
  }

  // Never lose the script on close
  window.addEventListener('pagehide', function () { saveState(true); });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') saveState(true);
  });

  /* ---------------------------------------------------------
     Init
     --------------------------------------------------------- */
  applyTheme();
  textarea.value = state.script;
  renderScript();
  applyFont();
  applyWpm();
  applyMirror();
  updateMeta();
  syncFullscreenBtn();
  showView('editor');
})();
