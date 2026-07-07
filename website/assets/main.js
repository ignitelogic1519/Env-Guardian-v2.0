/* Env Guardian marketing site — interactions (flowty-style motion) */
(function () {
  // progressive enhancement: reveal-hiding only activates when JS is running
  document.documentElement.classList.add('js');
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // year
  var yr = document.getElementById('yr');
  if (yr) yr.textContent = new Date().getFullYear();

  // scroll progress bar
  var prog = document.createElement('div');
  prog.id = 'progress';
  document.body.appendChild(prog);
  function updateProgress() {
    var h = document.documentElement;
    var max = h.scrollHeight - h.clientHeight;
    prog.style.width = (max > 0 ? (h.scrollTop / max) * 100 : 0) + '%';
  }

  // nav: solidify once scrolled
  var nav = document.querySelector('.nav');
  function updateNav() { if (nav) nav.classList.toggle('scrolled', window.scrollY > 24); }

  window.addEventListener('scroll', function () { updateProgress(); updateNav(); }, { passive: true });
  updateProgress(); updateNav();

  // mobile nav
  var hamb = document.querySelector('.hamb');
  var links = document.querySelector('.nav-links');
  if (hamb && links) {
    hamb.addEventListener('click', function () { links.classList.toggle('open'); });
    links.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', function () { links.classList.remove('open'); });
    });
  }

  // active nav link by filename
  var here = (location.pathname.split('/').pop() || 'index.html');
  document.querySelectorAll('.nav-links a').forEach(function (a) {
    var href = a.getAttribute('href');
    if (href === here || (here === '' && href === 'index.html')) a.classList.add('active');
  });

  // scroll reveal + counters — stagger is computed per SECTION so each block of
  // cards cascades on its own (the flowty feel), instead of one global counter.
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      e.target.classList.add('vis');
      var counter = e.target.matches('[data-count]') ? e.target : e.target.querySelector('[data-count]');
      if (counter) animateCount(counter);
      io.unobserve(e.target);
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });

  document.querySelectorAll('section, header, footer').forEach(function (scope) {
    var items = scope.querySelectorAll('.reveal');
    items.forEach(function (el, i) {
      el.style.transitionDelay = Math.min(i * 80, 480) + 'ms';
      io.observe(el);
    });
  });
  // reveals outside any section (safety net)
  document.querySelectorAll('.reveal').forEach(function (el) {
    if (!el.style.transitionDelay) { el.style.transitionDelay = '0ms'; io.observe(el); }
  });

  function animateCount(el) {
    if (el.dataset.done) return;
    el.dataset.done = '1';
    var target = parseFloat(el.dataset.count);
    var suffix = el.dataset.suffix || '';
    var dur = 1200, start = performance.now();
    function tick(now) {
      var p = Math.min((now - start) / dur, 1);
      var eased = 1 - Math.pow(1 - p, 3); // ease-out cubic
      el.textContent = Math.floor(target * eased) + suffix;
      if (p < 1) requestAnimationFrame(tick); else el.textContent = target + suffix;
    }
    requestAnimationFrame(tick);
  }

  // pointer tilt on the hero phone stack (desktop only)
  var tilt = document.querySelector('.tilt');
  if (tilt && !reduced && window.matchMedia('(hover:hover)').matches) {
    var phones = tilt.querySelectorAll('.phone');
    tilt.addEventListener('mousemove', function (ev) {
      var r = tilt.getBoundingClientRect();
      var x = (ev.clientX - r.left) / r.width - 0.5;   // -0.5 … 0.5
      var y = (ev.clientY - r.top) / r.height - 0.5;
      phones.forEach(function (p, i) {
        var depth = i === 0 ? 6 : 10;
        p.style.transform = p.dataset.base + ' rotateY(' + (x * depth) + 'deg) rotateX(' + (-y * depth) + 'deg)';
      });
    });
    tilt.addEventListener('mouseleave', function () {
      phones.forEach(function (p) { p.style.transform = p.dataset.base; });
    });
    // capture each phone's resting transform so tilt composes with it
    phones.forEach(function (p) {
      p.dataset.base = getComputedStyle(p).transform === 'none' ? '' : getComputedStyle(p).transform;
    });
  }

  // subtle parallax on background blobs
  if (!reduced) {
    window.addEventListener('scroll', function () {
      var y = window.scrollY;
      var b1 = document.querySelector('.b1'), b3 = document.querySelector('.b3');
      if (b1) b1.style.transform = 'translateY(' + (y * 0.05) + 'px)';
      if (b3) b3.style.transform = 'translateY(' + (-y * 0.04) + 'px)';
    }, { passive: true });
  }
})();
