/* Env Guardian marketing site — motion engine (flowty-style)
   Techniques: animate-on-scroll that REWINDS on scroll-up, scroll-scrubbed
   transforms (continuous, reverses naturally), parallax, marquee, tilt.
   All vanilla JS, no libraries. Honours prefers-reduced-motion. */
(function () {
  var docEl = document.documentElement;
  docEl.classList.add('js'); // progressive enhancement: reveal-hiding only when JS runs
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---- year ----
  var yr = document.getElementById('yr');
  if (yr) yr.textContent = new Date().getFullYear();

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
      p = p < 0 ? 0 : p > 1 ? 1 : p;
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
      }
      ticking = false;
    });
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  onScroll();

  // ======================================================================
  // Pointer tilt on the hero phone stack (desktop, hover-capable only)
  // ======================================================================
  var tilt = document.querySelector('.tilt');
  if (tilt && !reduced && window.matchMedia('(hover:hover)').matches) {
    var phones = tilt.querySelectorAll('.phone');
    phones.forEach(function (p) {
      var cur = getComputedStyle(p).transform;
      p.dataset.base = (cur === 'none' ? '' : cur);
    });
    tilt.addEventListener('mousemove', function (ev) {
      var r = tilt.getBoundingClientRect();
      var x = (ev.clientX - r.left) / r.width - 0.5;
      var y = (ev.clientY - r.top) / r.height - 0.5;
      phones.forEach(function (p, i) {
        var depth = i === 0 ? 7 : 11;
        p.style.transform = p.dataset.base + ' rotateY(' + (x * depth) + 'deg) rotateX(' + (-y * depth) + 'deg)';
      });
    });
    tilt.addEventListener('mouseleave', function () {
      phones.forEach(function (p) { p.style.transform = p.dataset.base; });
    });
  }
})();
