/* Env Guardian marketing site — motion engine (flowty-style)
   Techniques: animate-on-scroll that REWINDS on scroll-up, scroll-scrubbed
   transforms (continuous, reverses naturally), a pinned Apple-style story
   scene (scroll position picks the app screenshot "frame"), a pinned
   statement whose words light up with scroll, parallax, marquee, tilt and
   a cursor spotlight on bento cards.
   All vanilla JS, no libraries. Honours prefers-reduced-motion. */
(function () {
  var docEl = document.documentElement;
  docEl.classList.add('js'); // progressive enhancement: reveal-hiding only when JS runs
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

  // ---- year ----
  var yr = document.getElementById('yr');
  if (yr) yr.textContent = new Date().getFullYear();

  // ---- Admin Console URL ----------------------------------------------------
  // ★ CHANGE THIS ONE LINE after deploying /dashboard (your Netlify/Vercel URL).
  // Every "Dashboard" button/link on the site ([data-dashboard]) points here.
  var DASHBOARD_URL = 'https://env-guardian-dashboard.vercel.app';
  document.querySelectorAll('[data-dashboard]').forEach(function (a) {
    a.setAttribute('href', DASHBOARD_URL);
  });

  // ---- scroll progress bar ----
  var prog = document.createElement('div');
  prog.id = 'progress';
  document.body.appendChild(prog);

  // ---- nav solidify on scroll ----
  var nav = document.querySelector('.nav');

  // ---- mobile nav ----
  var hamb = document.querySelector('.hamb');
  var links = document.querySelector('.nav-links');
  if (hamb && links) {
    hamb.addEventListener('click', function () { links.classList.toggle('open'); });
    links.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', function () { links.classList.remove('open'); });
    });
  }

  // ---- active nav link ----
  var here = (location.pathname.split('/').pop() || 'index.html');
  document.querySelectorAll('.nav-links a').forEach(function (a) {
    var href = a.getAttribute('href');
    if (href === here || (here === '' && href === 'index.html')) a.classList.add('active');
  });

  // ======================================================================
  // Animate-on-scroll WITH REWIND. We keep observing (never unobserve), so
  // elements re-hide when they leave the viewport and re-animate on re-entry.
  // Stagger is computed per section so each block cascades on its own.
  // ======================================================================
  if (reduced) {
    // reduced motion: show everything, no scroll motion, counters at final value
    document.querySelectorAll('.reveal').forEach(function (el) { el.classList.add('vis'); });
    document.querySelectorAll('[data-count]').forEach(function (el) {
      el.textContent = el.dataset.count + (el.dataset.suffix || '');
    });
  } else {
    document.querySelectorAll('section, header, footer').forEach(function (scope) {
      scope.querySelectorAll('.reveal').forEach(function (el, i) {
        el.style.setProperty('--d', Math.min(i * 75, 460) + 'ms');
      });
    });

    var revealIO = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          e.target.classList.add('vis');
          var c = e.target.matches('[data-count]') ? e.target : e.target.querySelector('[data-count]');
          if (c) animateCount(c);
        } else {
          // rewind: reset so it replays next time it scrolls into view
          e.target.classList.remove('vis');
          var c2 = e.target.matches('[data-count]') ? e.target : e.target.querySelector('[data-count]');
          if (c2) c2.removeAttribute('data-done');
        }
      });
    }, { threshold: 0.14, rootMargin: '0px 0px -10% 0px' });

    document.querySelectorAll('.reveal').forEach(function (el) { revealIO.observe(el); });
  }

  function animateCount(el) {
    if (el.getAttribute('data-done')) return;
    el.setAttribute('data-done', '1');
    var target = parseFloat(el.dataset.count);
    var suffix = el.dataset.suffix || '';
    var dur = 1200, start = performance.now();
    function tick(now) {
      var p = Math.min((now - start) / dur, 1);
      var eased = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.floor(target * eased) + suffix;
      if (p < 1) requestAnimationFrame(tick); else el.textContent = target + suffix;
    }
    requestAnimationFrame(tick);
  }

  // ======================================================================
  // Scroll-scrubbed transforms — continuous motion tied to scroll position
  // (reverses naturally on scroll-up). Add data-scrub="rise|fall|zoom|left|
  // right|rotate|fade" and optional data-scrub-amt="80" to any element.
  // ======================================================================
  var scrubEls = reduced ? [] : Array.prototype.slice.call(document.querySelectorAll('[data-scrub]'));

  function applyScrub() {
    var vh = window.innerHeight;
    for (var i = 0; i < scrubEls.length; i++) {
      var el = scrubEls[i];
      var r = el.getBoundingClientRect();
      // p: 0 when element bottom enters, 1 when it exits the top; 0.5 ~ centered
      var p = (vh - r.top) / (vh + r.height);
      p = clamp01(p);
      var c = (p - 0.5) * 2; // -1 … 1 (centered = 0)
      var amt = parseFloat(el.dataset.scrubAmt || '70');
      var type = el.dataset.scrub, t = '';
      if (type === 'rise') t = 'translateY(' + (-c * amt) + 'px)';
      else if (type === 'fall') t = 'translateY(' + (c * amt) + 'px)';
      else if (type === 'left') t = 'translateX(' + (c * amt) + 'px)';
      else if (type === 'right') t = 'translateX(' + (-c * amt) + 'px)';
      else if (type === 'zoom') t = 'scale(' + (1 + (0.5 - Math.abs(c)) * (amt / 100)) + ')';
      else if (type === 'rotate') t = 'rotate(' + (c * amt) + 'deg)';
      el.style.transform = t;
      if (el.dataset.scrub === 'fade' || el.hasAttribute('data-scrub-fade')) {
        el.style.opacity = String(1 - Math.min(Math.abs(c) * 1.1, 0.75));
      }
    }
  }

  // ======================================================================
  // Hero "live perimeter" stage — flips between the safe and secure states
  // on a loop. CSS transitions handle the crossfades (screen, glow, rings,
  // card copy); JS just toggles data-state, ticks the in-zone clock and
  // adds a light pointer parallax on the floating cards + phone.
  // ======================================================================
  var stage = document.querySelector('.stage');
  if (stage && !reduced) {
    stage.querySelectorAll('.p2-frames img').forEach(function (img) {
      if (img.decode) img.decode().catch(function () {});
    });

    // state loop: linger longer on the interesting (secure) state
    var zoneSecs = 872; // 00:14:32
    var clock = document.getElementById('zone-clock');
    function fmt(s) {
      var m = Math.floor(s / 60), ss = s % 60;
      return '00:' + String(m).padStart(2, '0') + ':' + String(ss).padStart(2, '0');
    }
    setInterval(function () {
      if (stage.dataset.state === 'secure' && clock) {
        zoneSecs++;
        clock.textContent = fmt(zoneSecs);
      }
    }, 1000);
    (function flip() {
      var secure = stage.dataset.state === 'secure';
      setTimeout(function () {
        stage.dataset.state = secure ? 'safe' : 'secure';
        flip();
      }, secure ? 4000 : 5500);
    })();

    // pointer parallax (desktop only): cards drift at different depths
    if (window.matchMedia('(hover:hover)').matches) {
      var layers = [
        { el: stage.querySelector('.fc1'), d: 16 },
        { el: stage.querySelector('.fc2'), d: 22 },
        { el: stage.querySelector('.fc3'), d: 19 },
        { el: stage.querySelector('.fc4'), d: 26 },
        { el: stage.querySelector('.rings'), d: 8 }
      ].filter(function (l) { return l.el; });
      stage.addEventListener('mousemove', function (ev) {
        var r = stage.getBoundingClientRect();
        var x = (ev.clientX - r.left) / r.width - 0.5;
        var y = (ev.clientY - r.top) / r.height - 0.5;
        layers.forEach(function (l) {
          var extra = l.el.classList.contains('rings') ? ' translate(-50%,-50%)' : '';
          l.el.style.transform = 'translate(' + (-x * l.d) + 'px,' + (-y * l.d) + 'px)' + extra;
        });
      });
      stage.addEventListener('mouseleave', function () {
        layers.forEach(function (l) {
          l.el.style.transform = l.el.classList.contains('rings') ? 'translate(-50%,-50%)' : '';
        });
      });
    }
  }

  // ======================================================================
  // Pinned story scene — the Apple technique. The section is 400vh tall and
  // its content is position:sticky, so the user scrolls "through" it while
  // the phone stays put. Scroll progress (0..1) is a pure function of scroll
  // position, so scrolling up rewinds the whole scene for free:
  //   frame f = progress * (frames-1) → crossfade adjacent screenshots,
  //   highlight the matching step, fill the progress bar, shift the glow
  //   from "safe" teal to "secure" indigo.
  // ======================================================================
  var scene = document.querySelector('.scene');
  var sceneParts = null;
  if (scene && !reduced) {
    sceneParts = {
      frames: scene.querySelectorAll('.s-frame'),
      steps: scene.querySelectorAll('.s-step'),
      fill: scene.querySelector('.s-progress i'),
      glowA: scene.querySelector('.sg-a'),
      glowB: scene.querySelector('.sg-b'),
      phone: scene.querySelector('.scene-phone')
    };
    // decode every frame up front so scrubbing never stutters
    sceneParts.frames.forEach(function (img) {
      if (img.decode) img.decode().catch(function () {});
    });
  }

  function applyScene() {
    var s = sceneParts;
    if (!s || !s.frames.length) return;
    var vh = window.innerHeight;
    var r = scene.getBoundingClientRect();
    var total = r.height - vh;
    if (total <= 0) return;
    var p = clamp01(-r.top / total);
    var n = s.frames.length;
    var f = p * (n - 1);
    for (var i = 0; i < n; i++) {
      // linear crossfade between adjacent frames; exact frame = fully opaque
      s.frames[i].style.opacity = String(Math.max(0, 1 - Math.abs(f - i)));
    }
    var act = Math.round(f);
    for (var j = 0; j < s.steps.length; j++) s.steps[j].classList.toggle('on', j === act);
    if (s.fill) s.fill.style.width = (p * 100) + '%';
    // glow shifts from safe-teal to secure-indigo as enforcement arms itself
    var tint = clamp01((f - 0.5) / 1.2);
    if (s.glowA) s.glowA.style.opacity = String(1 - tint);
    if (s.glowB) s.glowB.style.opacity = String(tint);
    if (s.phone) {
      s.phone.style.transform =
        'rotate(' + ((p - 0.5) * 3.2) + 'deg) scale(' + (0.95 + 0.05 * Math.sin(p * Math.PI)) + ')';
    }
  }

  // ======================================================================
  // Scroll-lit statement — split the pinned paragraph into word <span>s,
  // then map scroll progress to "how many words are lit". Scrolling back
  // un-lights them (scrub model: state is a function of scroll position).
  // ======================================================================
  var statement = document.querySelector('.statement');
  var stWords = [];
  if (statement && !reduced) {
    statement.querySelectorAll('[data-words]').forEach(function (rootEl) {
      splitWords(rootEl);
      stWords = stWords.concat(Array.prototype.slice.call(rootEl.querySelectorAll('.w')));
    });
  }

  function splitWords(node) {
    // recursive so inline tags like <b> keep wrapping their (gradient) words
    Array.prototype.slice.call(node.childNodes).forEach(function (child) {
      if (child.nodeType === 3) {
        var parts = child.textContent.split(/(\s+)/);
        var frag = document.createDocumentFragment();
        parts.forEach(function (part) {
          if (!part) return;
          if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(part)); return; }
          var w = document.createElement('span');
          w.className = 'w';
          w.textContent = part;
          frag.appendChild(w);
        });
        node.replaceChild(frag, child);
      } else if (child.nodeType === 1) {
        splitWords(child);
      }
    });
  }

  function applyStatement() {
    if (!stWords.length) return;
    var vh = window.innerHeight;
    var r = statement.getBoundingClientRect();
    var total = r.height - vh;
    if (total <= 0) return;
    var p = clamp01(-r.top / total);
    // finish lighting at ~85% so the full sentence holds on screen for a beat
    var lit = Math.floor(clamp01(p / 0.85) * stWords.length);
    for (var i = 0; i < stWords.length; i++) {
      stWords[i].classList.toggle('lit', i < lit);
    }
  }

  // ---- background blob parallax ----
  var b1 = document.querySelector('.b1'), b2 = document.querySelector('.b2'), b3 = document.querySelector('.b3');

  var ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      var y = window.scrollY;
      var h = docEl.scrollHeight - docEl.clientHeight;
      prog.style.width = (h > 0 ? (y / h) * 100 : 0) + '%';
      if (nav) nav.classList.toggle('scrolled', y > 24);
      if (!reduced) {
        if (b1) b1.style.transform = 'translateY(' + (y * 0.06) + 'px)';
        if (b2) b2.style.transform = 'translateY(' + (-y * 0.05) + 'px)';
        if (b3) b3.style.transform = 'translateY(' + (y * 0.035) + 'px)';
        applyScrub();
        applyScene();
        applyStatement();
      }
      ticking = false;
    });
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  onScroll();

  // ======================================================================
  // Cursor spotlight on bento cards (desktop, hover-capable only)
  // ======================================================================
  if (!reduced && window.matchMedia('(hover:hover)').matches) {
    document.querySelectorAll('.bento .card').forEach(function (card) {
      card.addEventListener('mousemove', function (ev) {
        var r = card.getBoundingClientRect();
        card.style.setProperty('--mx', (ev.clientX - r.left) + 'px');
        card.style.setProperty('--my', (ev.clientY - r.top) + 'px');
      });
    });
  }
})();
