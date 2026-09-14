(() => {
  'use strict';

  const $ = (q) => document.querySelector(q);
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  let currentLang = (() => {
    try { return localStorage.getItem('coffeeMilkLang') || (navigator.language && navigator.language.toLowerCase().startsWith('ja') ? 'ja' : 'en'); } catch (_) { return 'en'; }
  })();
  const fmt = (n) => Math.round(n).toLocaleString(currentLang === 'ja' ? 'ja-JP' : 'en-US');

  const els = {
    titleScreen: $('#titleScreen'), gameScreen: $('#gameScreen'), finalScreen: $('#finalScreen'),
    startBtn: $('#startBtn'), titleBtn: $('#titleBtn'), finalTitleBtn: $('#finalTitleBtn'),
    titleLangBtn: $('#titleLangBtn'), langBtn: $('#langBtn'), finalLangBtn: $('#finalLangBtn'),
    soundBtn: $('#soundBtn'), finalSoundBtn: $('#finalSoundBtn'),
    targetSwatch: $('#targetSwatch'), roundLabel: $('#roundLabel'), totalScore: $('#totalScore'),
    coffeeBtn: $('#coffeeBtn'), milkBtn: $('#milkBtn'), vesselArea: $('#vesselArea'), vesselCanvas: $('#vesselCanvas'),
    vesselArt: $('#vesselArt'), liquidMask: $('#liquidMask'), liquid: $('#liquid'), pourStream: $('#pourStream'),
    resultOverlay: $('#resultOverlay'), resultEyebrow: $('#resultEyebrow'), resultTitle: $('#resultTitle'),
    colorScore: $('#colorScore'), volumeScore: $('#volumeScore'), roundScore: $('#roundScore'), resultNote: $('#resultNote'), nextBtn: $('#nextBtn'),
    finalScore: $('#finalScore'), roundBreakdown: $('#roundBreakdown'), againBtn: $('#againBtn')
  };

  // Same physical flow rate in every round. The different vessel capacities make
  // narrow containers fill visually faster, as they should.
  const FLOW_ML_PER_SECOND = 23;
  const ROUNDS = [
    { key:'beaker', name:'BEAKER', asset:'assets/beaker_game.svg', capacity:100, geometry:'linear', blind:false },
    { key:'straight', name:'STRAIGHT GLASS', asset:'assets/straight_glass_game.svg', capacity:88, geometry:'linear', blind:false },
    { key:'test', name:'TEST TUBE', asset:'assets/test_tube_game.svg', capacity:40, geometry:'linear', blind:false },
    { key:'cocktail', name:'COCKTAIL GLASS', asset:'assets/cocktail_glass_game.svg', capacity:118, geometry:'cone', blind:false },
    { key:'opaque', name:'BLIND GLASS', asset:'assets/opaque_glass_game.svg', capacity:90, geometry:'linear', blind:true }
  ];

  const COFFEE_RGB = [70, 38, 25];
  const MILK_RGB = [246, 233, 199];

  let state = null;
  let raf = 0;
  let lastTime = 0;
  let activePour = null;
  let soundOn = true;
  let audio = null;
  let warningOsc = null;
  let warningGain = null;
  let musicTimer = 0;
  let musicStep = 0;
  let lastPaint = 0;
  const PAINT_INTERVAL = 1000 / 36;
  const assetPromises = new Map();
  let fitRaf = 0;
  const ASSET_ASPECT = 1536 / 2048; // 3:4
  // Fixed logical vessel stage. The art and liquid mask always share this exact
  // coordinate system; only the whole stage is scaled to fit the viewport.
  const VESSEL_BASE_W = 420;
  const VESSEL_BASE_H = 560;

  // Normalized liquid interiors measured against the fixed 1536x2048 asset canvas.
  // JS converts these to pixels after every resize/fullscreen change so masks cannot drift.
  const LIQUID_BOUNDS = {
    // Final tuning pass from the latest screenshots.
    // The beaker needed a slightly taller interior so "looks full" and
    // overflow judgement feel aligned. Cocktail is nudged upward a touch so
    // the visible fill meets the rim exactly at 100%.
    beaker:   { left:.1785, right:.1805, top:.1730, bottom:.1360, radius:'0 0 4% 4%' },
    straight: { left:.2640, right:.2640, top:.4520, bottom:.2020, radius:'0 0 2% 2%' },
    test:     { left:.4730, right:.4715, top:.2015, bottom:.1360, radius:'0 0 999px 999px' },
    // Bowl only: the liquid can fill the triangle, never the stem/base, and never above the rim.
    cocktail: { left:.1495, right:.1455, top:.1745, height:.3230, clip:'polygon(0 0,100% 0,50% 100%)', radius:'0' }
  };

  // Slight leniency so a vessel that looks full does not instantly count as overflow.
  const OVERFLOW_LIMITS = {
    beaker: 1.058,
    straight: 1.035,
    test: 1.05,
    cocktail: 1.008,
    opaque: 1.04
  };


  const I18N = {
    en: {
      brandKicker:'PERFECT MIXING GAME',
      titleCopy:'Match the color. Fill it to the edge. Do not spill.',
      ruleOneTitle:'ONE USE', ruleOneDesc:'Each pour button can be used once.',
      ruleColorTitle:'COLOR', ruleColorDesc:'Match the target color as closely as possible.',
      ruleVolumeTitle:'VOLUME', ruleVolumeDesc:'The closer to full, the higher the score.',
      ruleOverflowTitle:'OVERFLOW', ruleOverflowDesc:'Spill even a little and the round is worth zero.',
      start:'START', titleBtn:'TITLE', target:'TARGET', totalScoreLabel:'TOTAL SCORE',
      coffee:'COFFEE', milk:'MILK', oneUseSmall:'1 USE',
      color:'COLOR', volume:'VOLUME', roundScoreLabel:'ROUND SCORE',
      nextRound:'NEXT ROUND', finalResult:'FINAL RESULT',
      finalKicker:'5 ROUNDS COMPLETE', finalScoreLabel:'FINAL SCORE', playAgain:'PLAY AGAIN',
      soundOn:'SOUND ON', soundOff:'SOUND OFF',
      result:'RESULT', overflowTitle:'OVERFLOW',
      roundLabel:(n,total)=>`ROUND ${n} / ${total}`,
      roundEyebrow:n=>`ROUND ${n}`,
      noteOverflow:'The cup overflowed. This round scores zero.',
      notePerfect:'Almost perfect.',
      noteGreat:'Great mix. Push the fill level a little further.',
      noteColorMiss:'The color was the biggest miss.',
      noteVolumeMiss:'Good color. A fuller cup would score much higher.',
      noteBalance:'Good balance. Precision is everything.'
    },
    ja: {
      brandKicker:'完璧な一杯をつくれ',
      titleCopy:'見本の色に合わせて、できるだけたっぷり。こぼしたら0点。',
      ruleOneTitle:'1回のみ', ruleOneDesc:'コーヒーと牛乳は、それぞれ1回だけ注げる。',
      ruleColorTitle:'色', ruleColorDesc:'見本の色に近いほど高得点。',
      ruleVolumeTitle:'量', ruleVolumeDesc:'満杯に近いほど高得点。',
      ruleOverflowTitle:'あふれ', ruleOverflowDesc:'少しでもあふれたら、そのラウンドは0点。',
      start:'はじめる', titleBtn:'タイトル', target:'見本', totalScoreLabel:'合計スコア',
      coffee:'コーヒー', milk:'牛乳', oneUseSmall:'1回のみ',
      color:'色', volume:'量', roundScoreLabel:'ラウンドスコア',
      nextRound:'次のラウンド', finalResult:'最終結果',
      finalKicker:'5ラウンド終了', finalScoreLabel:'最終スコア', playAgain:'もう一度遊ぶ',
      soundOn:'音声 ON', soundOff:'音声 OFF',
      result:'結果', overflowTitle:'あふれた！',
      roundLabel:(n,total)=>`ラウンド ${n} / ${total}`,
      roundEyebrow:n=>`ラウンド ${n}`,
      noteOverflow:'あふれてしまったため、このラウンドは0点。',
      notePerfect:'ほぼ完璧！',
      noteGreat:'かなりいい感じ。あと少しだけ量を攻めよう。',
      noteColorMiss:'今回は色のズレが一番大きかった。',
      noteVolumeMiss:'色はいい感じ。もっと満杯に近づけると高得点！',
      noteBalance:'いいバランス。最後は精度勝負！'
    }
  };

  const tr = (key) => I18N[currentLang][key];

  function resultNoteKey(s) {
    if (state && state.overflow) return 'noteOverflow';
    if (s.points >= 9000) return 'notePerfect';
    if (s.points >= 6500) return 'noteGreat';
    if (s.color < 55) return 'noteColorMiss';
    if (s.volume < 55) return 'noteVolumeMiss';
    return 'noteBalance';
  }

  function updateSoundLabels() {
    const label = soundOn ? tr('soundOn') : tr('soundOff');
    els.soundBtn.textContent = label;
    els.finalSoundBtn.textContent = label;
  }

  function updateLanguageButtons() {
    const label = currentLang === 'ja' ? 'EN' : '日本語';
    [els.titleLangBtn, els.langBtn, els.finalLangBtn].forEach(btn => {
      if (!btn) return;
      btn.textContent = label;
      btn.setAttribute('aria-label', currentLang === 'ja' ? 'Switch to English' : '日本語に切り替え');
    });
  }

  function refreshDynamicText() {
    updateSoundLabels();
    updateLanguageButtons();
    if (!state) return;
    els.roundLabel.textContent = tr('roundLabel')(state.round + 1, ROUNDS.length);
    els.nextBtn.textContent = state.round === ROUNDS.length - 1 ? tr('finalResult') : tr('nextRound');
    els.totalScore.textContent = fmt(state.totalScore);
    if (state.roundFinished && state.results[state.round]) {
      const s = state.results[state.round];
      els.resultEyebrow.textContent = tr('roundEyebrow')(state.round + 1);
      els.resultTitle.textContent = state.overflow ? tr('overflowTitle') : tr('result');
      els.resultNote.textContent = tr(resultNoteKey(s));
    }
    if (els.finalScreen.classList.contains('active')) {
      els.finalScore.textContent = fmt(state.totalScore);
      els.roundBreakdown.innerHTML = state.results.map((r, i) => `<div><span>R${i+1}</span><b>${fmt(r.points)}</b></div>`).join('');
    }
  }

  function applyLanguage() {
    document.documentElement.lang = currentLang === 'ja' ? 'ja' : 'en';
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.dataset.i18n;
      const value = tr(key);
      if (typeof value === 'string') el.textContent = value;
    });
    refreshDynamicText();
  }

  function toggleLanguage() {
    currentLang = currentLang === 'ja' ? 'en' : 'ja';
    try { localStorage.setItem('coffeeMilkLang', currentLang); } catch (_) {}
    applyLanguage();
  }

  function freshState() {
    return { round:0, totalScore:0, results:[], target:50, coffee:0, milk:0, overflow:false, used:{coffee:false,milk:false}, locked:false, roundFinished:false };
  }

  function preloadAsset(url) {
    if (assetPromises.has(url)) return assetPromises.get(url);
    const promise = new Promise(resolve => {
      const img = new Image();
      img.onload = () => resolve();
      img.onerror = () => resolve();
      img.src = url;
      if (img.complete) resolve();
    });
    assetPromises.set(url, promise);
    return promise;
  }

  ROUNDS.forEach(r => preloadAsset(r.asset));

  function showScreen(which) {
    [els.titleScreen, els.gameScreen, els.finalScreen].forEach(x => x.classList.remove('active'));
    which.classList.add('active');
  }

  function mixColor(coffeePercent) {
    const t = clamp(coffeePercent / 100, 0, 1);
    const v = MILK_RGB.map((m, i) => Math.round(m + (COFFEE_RGB[i] - m) * t));
    return `rgb(${v[0]},${v[1]},${v[2]})`;
  }

  function setTarget() {
    state.target = Math.floor(Math.random() * 81) + 10; // 10–90 inclusive
    els.targetSwatch.style.background = mixColor(state.target);
  }

  function currentRound() { return ROUNDS[state.round]; }
  function totalMl() { return state.coffee + state.milk; }
  function fillRatio() { return totalMl() / currentRound().capacity; }
  function overflowLimit() { return OVERFLOW_LIMITS[currentRound().key] || 1.035; }
  function coffeePercent() { const t = totalMl(); return t <= 0 ? 0 : (state.coffee / t) * 100; }

  function visualFillRatio() {
    const f = clamp(fillRatio(), 0, 1);
    return currentRound().geometry === 'cone' ? Math.cbrt(f) : f;
  }

  function updateLiquid() {
    const total = totalMl();
    const ratio = total > 0 ? (state.coffee / total) * 100 : 50;
    els.liquid.style.backgroundColor = mixColor(ratio);
    els.liquid.style.transform = `scaleY(${visualFillRatio()}) translateZ(0)`;
  }

  function applyLiquidMaskGeometry() {
    if (!state) return;
    const r = currentRound();
    if (r.blind) {
      els.liquidMask.style.display = 'none';
      return;
    }
    const b = LIQUID_BOUNDS[r.key];
    if (!b) return;

    // IMPORTANT: never derive the mask from the currently rendered/scaled size.
    // It lives in the same fixed 420x560 logical coordinate system as the vessel art.
    const w = VESSEL_BASE_W;
    const h = VESSEL_BASE_H;
    const left = w * b.left;
    const top = h * b.top;
    const width = w * (1 - b.left - b.right);
    const height = b.height != null ? h * b.height : h * (1 - b.top - b.bottom);

    // Use inline !important because older tuning CSS contains !important geometry.
    // This makes this single source of truth win reliably on every viewport.
    const st = els.liquidMask.style;
    st.setProperty('display', 'block', 'important');
    st.setProperty('left', `${left}px`, 'important');
    st.setProperty('top', `${top}px`, 'important');
    st.setProperty('width', `${Math.max(1, width)}px`, 'important');
    st.setProperty('height', `${Math.max(1, height)}px`, 'important');
    st.setProperty('right', 'auto', 'important');
    st.setProperty('bottom', 'auto', 'important');
    st.setProperty('border-radius', b.radius || '0', 'important');
    st.setProperty('clip-path', b.clip || 'none', 'important');
    st.setProperty('-webkit-clip-path', b.clip || 'none', 'important');
  }

  function fitVesselCanvas() {
    if (!els.gameScreen.classList.contains('active')) return;
    const area = els.vesselArea.getBoundingClientRect();
    if (!area.width || !area.height) return;

    // Keep ONE immutable logical stage and scale the complete stage as a unit.
    // Fullscreen/windowed/mobile therefore cannot desynchronise art and liquid.
    const pad = 4;
    const sx = Math.max(.05, (area.width - pad * 2) / VESSEL_BASE_W);
    const sy = Math.max(.05, (area.height - pad * 2) / VESSEL_BASE_H);
    const scale = Math.min(sx, sy);
    els.vesselCanvas.style.width = `${VESSEL_BASE_W}px`;
    els.vesselCanvas.style.height = `${VESSEL_BASE_H}px`;
    els.vesselCanvas.style.setProperty('--vessel-scale', String(scale));
    applyLiquidMaskGeometry();
  }

  function scheduleVesselFit() {
    if (fitRaf) cancelAnimationFrame(fitRaf);
    fitRaf = requestAnimationFrame(() => {
      fitRaf = 0;
      fitVesselCanvas();
      updateStreamGeometry();
    });
  }

  function forceVesselRefit() {
    // Browsers often report intermediate dimensions while leaving fullscreen.
    // Refit across several layout frames so the final windowed dimensions always win.
    scheduleVesselFit();
    requestAnimationFrame(() => requestAnimationFrame(scheduleVesselFit));
    setTimeout(scheduleVesselFit, 70);
    setTimeout(scheduleVesselFit, 180);
    setTimeout(scheduleVesselFit, 360);
  }

  function updateStreamGeometry() {
    if (!state) return;
    const area = els.vesselArea.getBoundingClientRect();
    const canvas = els.vesselCanvas.getBoundingClientRect();
    if (!area.width || !canvas.height) return;
    const r = currentRound();
    let targetY;
    if (!r.blind) {
      const mask = els.liquidMask.getBoundingClientRect();
      targetY = mask.height ? (mask.top - area.top + 8) : (canvas.top - area.top + canvas.height * .2);
    } else {
      targetY = canvas.top - area.top + canvas.height * .205;
    }
    const startY = Math.max(0, canvas.top - area.top - Math.min(42, canvas.height * .08));
    els.pourStream.style.top = `${startY}px`;
    els.pourStream.style.height = `${Math.max(18, targetY - startY)}px`;
  }

  async function prepareRound(initial = false) {
    stopPour();
    const r = currentRound();
    state.coffee = 0; state.milk = 0; state.overflow = false; state.locked = false; state.roundFinished = false;
    state.used = { coffee:false, milk:false };
    lastPaint = 0;
    setTarget();
    els.roundLabel.textContent = tr('roundLabel')(state.round + 1, ROUNDS.length);
    els.totalScore.textContent = fmt(state.totalScore);
    els.coffeeBtn.classList.remove('used','pouring'); els.milkBtn.classList.remove('used','pouring');
    els.coffeeBtn.disabled = false; els.milkBtn.disabled = false;

    if (!initial) els.vesselArt.classList.add('asset-loading');
    els.vesselCanvas.className = `vessel-canvas ${r.key}${initial ? '' : ' enter'}`;
    els.vesselArt.src = r.asset;
    els.liquid.style.transform = 'scaleY(0) translateZ(0)';
    els.liquid.style.backgroundColor = mixColor(50);
    els.liquidMask.style.visibility = r.blind ? 'hidden' : 'visible';
    els.liquidMask.style.display = r.blind ? 'none' : 'block';
    els.resultOverlay.classList.remove('show'); els.resultOverlay.setAttribute('aria-hidden','true');
    els.nextBtn.textContent = state.round === ROUNDS.length - 1 ? tr('finalResult') : tr('nextRound');

    await preloadAsset(r.asset);
    try { if (els.vesselArt.decode) await els.vesselArt.decode(); } catch (_) {}
    els.vesselArt.classList.remove('asset-loading');
    scheduleVesselFit();

    if (!initial) {
      requestAnimationFrame(() => requestAnimationFrame(() => els.vesselCanvas.classList.remove('enter')));
    }
  }

  function beginGame() {
    state = freshState();
    ensureAudio();
    startMusic();
    showScreen(els.gameScreen);
    scheduleVesselFit();
    void prepareRound(true);
  }

  function goTitle() {
    stopPour(); stopMusic(); stopWarning();
    if (state) state.locked = true;
    showScreen(els.titleScreen);
  }

  function beginPour(type, pointerId) {
    if (!state || state.locked || state.overflow || state.used[type] || activePour) return;
    ensureAudio();
    state.used[type] = true;
    const btn = type === 'coffee' ? els.coffeeBtn : els.milkBtn;
    btn.classList.add('used','pouring');
    try { btn.setPointerCapture(pointerId); } catch (_) {}
    activePour = type;
    els.pourStream.className = `pour-stream active ${type}`;
    updateStreamGeometry();
    lastTime = performance.now();
    updateWarning(fillRatio());
    raf = requestAnimationFrame(tickPour);
    playClick(type);
  }

  function tickPour(now) {
    if (!activePour || state.locked) return;
    const dt = Math.min(.05, Math.max(0, (now - lastTime) / 1000));
    lastTime = now;
    state[activePour] += FLOW_ML_PER_SECOND * dt;
    const f = fillRatio();

    // Physics still runs every animation frame, but DOM/audio updates are throttled.
    // This keeps the held-pour input precise while avoiding mobile jank.
    if (!lastPaint || now - lastPaint >= PAINT_INTERVAL) {
      lastPaint = now;
      updateLiquid();
      updateWarning(f);
    }

    if (f > overflowLimit()) {
      updateLiquid();
      state.overflow = true;
      state.locked = true;
      stopPour();
      playOverflow();
      setTimeout(finishRound, 360);
      return;
    }
    raf = requestAnimationFrame(tickPour);
  }

  function stopPour() {
    if (state && activePour) updateLiquid();
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    if (activePour) {
      const btn = activePour === 'coffee' ? els.coffeeBtn : els.milkBtn;
      btn.classList.remove('pouring');
    }
    activePour = null;
    els.pourStream.className = 'pour-stream';
    stopWarning();
    if (state && !state.locked && state.used.coffee && state.used.milk) {
      state.locked = true;
      setTimeout(finishRound, 250);
    }
  }

  function scoreRound() {
    if (state.overflow) return { color:0, volume:0, points:0, actual:coffeePercent(), fill:fillRatio() };
    const actual = coffeePercent();
    const colorDiff = Math.abs(actual - state.target);
    // Color is now linear: every 1 percentage-point miss costs exactly 1 point.
    // Example: target 60%, actual 52% -> 92 points.
    // Component scores are still rounded UP before multiplication.
    const colorRaw = totalMl() <= 0 ? 0 : Math.max(0, 100 - colorDiff);
    const f = clamp(fillRatio(), 0, 1);
    const volumeRaw = 100 * Math.pow(f, 2.25);
    const color = Math.ceil(clamp(colorRaw, 0, 100));
    const volume = Math.ceil(clamp(volumeRaw, 0, 100));
    const points = color * volume;
    return { color, volume, points, actual, fill:f, colorRaw, volumeRaw };
  }

  function finishRound() {
    if (!state || !state.locked || state.roundFinished) return;
    state.roundFinished = true;
    const s = scoreRound();
    state.totalScore += s.points;
    state.results[state.round] = s;
    els.totalScore.textContent = fmt(state.totalScore);
    els.resultEyebrow.textContent = tr('roundEyebrow')(state.round + 1);
    els.resultTitle.textContent = state.overflow ? tr('overflowTitle') : tr('result');
    els.colorScore.textContent = state.overflow ? '0' : s.color;
    els.volumeScore.textContent = state.overflow ? '0' : s.volume;
    els.roundScore.textContent = fmt(s.points);
    els.resultNote.textContent = tr(resultNoteKey(s));
    els.resultOverlay.classList.add('show'); els.resultOverlay.setAttribute('aria-hidden','false');
    if (!state.overflow && s.points > 0) playResult(s.points);
  }

  function nextRound() {
    els.resultOverlay.classList.remove('show');
    if (state.round >= ROUNDS.length - 1) { showFinal(); return; }

    const nextIndex = state.round + 1;
    // Make sure the NEXT vessel is already decoded before its slide-in starts.
    void preloadAsset(ROUNDS[nextIndex].asset);
    els.vesselCanvas.classList.add('exit');
    setTimeout(async () => {
      state.round = nextIndex;
      await prepareRound(false);
    }, 300);
  }

  function showFinal() {
    stopPour(); stopMusic();
    showScreen(els.finalScreen);
    els.finalScore.textContent = fmt(state.totalScore);
    els.roundBreakdown.innerHTML = state.results.map((r, i) => `<div><span>R${i+1}</span><b>${fmt(r.points)}</b></div>`).join('');
    updateSoundLabels();
  }

  function ensureAudio() {
    if (!audio) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      audio = new Ctx();
    }
    if (audio.state === 'suspended') audio.resume().catch(()=>{});
  }

  function tone(freq, dur=.08, gain=.035, type='sine', when=0) {
    if (!soundOn || !audio) return;
    const t = audio.currentTime + when;
    const o = audio.createOscillator(); const g = audio.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t+.012); g.gain.exponentialRampToValueAtTime(.0001, t+dur);
    o.connect(g); g.connect(audio.destination); o.start(t); o.stop(t+dur+.03);
  }

  function playClick(type) { tone(type === 'coffee' ? 180 : 250, .055, .018, 'triangle'); }
  function playOverflow() { tone(170,.16,.05,'sawtooth'); tone(105,.23,.045,'sawtooth',.09); }
  function playResult(points) { const high = points > 8400; tone(high?523:392,.09,.032,'triangle'); tone(high?659:494,.11,.03,'triangle',.08); tone(high?784:587,.14,.025,'triangle',.16); }

  function updateWarning(fill) {
    // A quiet continuous pitch meter: low from an empty vessel, rising smoothly
    // all the way to full. This is especially important for the blind final round.
    if (!soundOn || !audio || !activePour) { stopWarning(); return; }
    if (!warningOsc) {
      warningOsc = audio.createOscillator(); warningGain = audio.createGain();
      warningOsc.type = 'sine'; warningGain.gain.value = .0001;
      warningOsc.connect(warningGain); warningGain.connect(audio.destination); warningOsc.start();
    }
    const p = clamp(fill, 0, 1);
    warningOsc.frequency.setTargetAtTime(145 + Math.pow(p, 1.35) * 1325, audio.currentTime, .025);
    warningGain.gain.setTargetAtTime(.008 + p * .010, audio.currentTime, .03);
  }

  function stopWarning() {
    if (warningOsc) { try { warningOsc.stop(); } catch(_){} warningOsc.disconnect(); warningOsc = null; }
    if (warningGain) { warningGain.disconnect(); warningGain = null; }
  }

  function startMusic() {
    if (!soundOn) return;
    ensureAudio();
    stopMusic();
    musicStep = 0;
    const seq = [261.63,329.63,392,329.63,293.66,349.23,440,349.23];
    const play = () => {
      if (!soundOn || !audio || !els.gameScreen.classList.contains('active')) return;
      const f = seq[musicStep % seq.length];
      tone(f,.34,.009,'triangle');
      if (musicStep % 4 === 0) tone(f/2,.42,.006,'sine',.02);
      musicStep++;
    };
    play(); musicTimer = window.setInterval(play, 620);
  }

  function stopMusic() { if (musicTimer) clearInterval(musicTimer); musicTimer = 0; }

  function toggleSound() {
    soundOn = !soundOn;
    els.soundBtn.textContent = soundOn ? 'SOUND ON' : 'SOUND OFF';
    updateSoundLabels();
    els.soundBtn.setAttribute('aria-pressed', String(soundOn));
    if (soundOn) { ensureAudio(); if (els.gameScreen.classList.contains('active')) startMusic(); }
    else { stopWarning(); stopMusic(); }
  }

  function bindPour(btn, type) {
    btn.addEventListener('pointerdown', e => { e.preventDefault(); beginPour(type, e.pointerId); });
    btn.addEventListener('pointerup', e => { e.preventDefault(); stopPour(); });
    btn.addEventListener('pointercancel', stopPour);
    btn.addEventListener('lostpointercapture', () => { if (activePour === type) stopPour(); });
  }

  // Prevent double-tap zoom / long-press selection on game controls.
  document.addEventListener('contextmenu', e => { if (e.target.closest('button')) e.preventDefault(); });
  document.addEventListener('dblclick', e => e.preventDefault(), {passive:false});

  bindPour(els.coffeeBtn, 'coffee'); bindPour(els.milkBtn, 'milk');
  els.startBtn.addEventListener('click', beginGame);
  els.againBtn.addEventListener('click', beginGame);
  els.nextBtn.addEventListener('click', nextRound);
  els.titleBtn.addEventListener('click', goTitle); els.finalTitleBtn.addEventListener('click', goTitle);
  els.soundBtn.addEventListener('click', toggleSound); els.finalSoundBtn.addEventListener('click', toggleSound);
  [els.titleLangBtn, els.langBtn, els.finalLangBtn].forEach(btn => btn && btn.addEventListener('click', toggleLanguage));

  // Stop a held pour if the pointer is released outside the button or the tab loses focus.
  window.addEventListener('pointerup', () => { if (activePour) stopPour(); });
  window.addEventListener('blur', () => { if (activePour) stopPour(); });
  window.addEventListener('resize', forceVesselRefit);
  window.addEventListener('orientationchange', forceVesselRefit);
  document.addEventListener('fullscreenchange', forceVesselRefit);
  document.addEventListener('webkitfullscreenchange', forceVesselRefit);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', forceVesselRefit);
  if ('ResizeObserver' in window) {
    const vesselResizeObserver = new ResizeObserver(forceVesselRefit);
    vesselResizeObserver.observe(els.vesselArea);
    vesselResizeObserver.observe(els.gameScreen);
    vesselResizeObserver.observe(document.documentElement);
  }

  applyLanguage();
})();
