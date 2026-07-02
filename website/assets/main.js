/* Env Guardian marketing site — interactions */
(function () {
  // year
  var yr = document.getElementById('yr');
  if (yr) yr.textContent = new Date().getFullYear();

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

  // scroll reveal + counters
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      e.target.classList.add('vis');
      if (e.target.dataset.count) animateCount(e.target);
      io.unobserve(e.target);
    });
  }, { threshold: 0.14 });

  document.querySelectorAll('.reveal').forEach(function (el, i) {
    el.style.transitionDelay = (i % 4 * 70) + 'ms';
    io.observe(el);
  });
  document.querySelectorAll('[data-count]').forEach(function (el) { io.observe(el); });

  function animateCount(el) {
    var target = parseFloat(el.dataset.count);
    var suffix = el.dataset.suffix || '';
    var dur = 1100, start = performance.now();
    function tick(now) {
      var p = Math.min((now - start) / dur, 1);
      var val = Math.floor(target * (0.5 - Math.cos(p * Math.PI) / 2)); // ease
      el.textContent = val + suffix;
      if (p < 1) requestAnimationFrame(tick); else el.textContent = target + suffix;
    }
    requestAnimationFrame(tick);
  }

  // subtle parallax on hero blobs
  window.addEventListener('scroll', function () {
    var y = window.scrollY;
    var b1 = document.querySelector('.b1'), b3 = document.querySelector('.b3');
    if (b1) b1.style.transform = 'translateY(' + (y * 0.06) + 'px)';
    if (b3) b3.style.transform = 'translateY(' + (-y * 0.05) + 'px)';
  }, { passive: true });
})();
