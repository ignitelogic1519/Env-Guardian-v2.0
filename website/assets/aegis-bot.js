/* ===== Aegis — floating guardrailed assistant for Env Guardian ===== */
(function () {
  "use strict";

  /* ---------- Mascot faces (emotions) ---------- */
  function shield(inner) {
    return '<svg class="agsvg ag-mascot" viewBox="0 0 150 162" role="img" aria-label="Aegis">'
      + '<defs><linearGradient id="agg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#4f6ef7"/><stop offset="1" stop-color="#14b8a6"/></linearGradient></defs>'
      + '<path d="M75 6 L138 29 V78 C138 122 110 144 75 154 C40 144 12 122 12 78 V29 Z" fill="url(#agg)"/>'
      + '<path d="M75 6 L138 29 V78 C138 122 110 144 75 154 C40 144 12 122 12 78 V29 Z" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="3"/>'
      + '<rect x="40" y="54" width="70" height="50" rx="18" fill="#fff" opacity=".96"/>'
      + inner + '</svg>';
  }
  function agFace(emo) {
    var eyesN = '<g class="ag-blink"><circle cx="61" cy="78" r="7.5" fill="#16204a"/><circle cx="89" cy="78" r="7.5" fill="#16204a"/></g>';
    var cheeks = '<circle cx="49" cy="90" r="4" fill="#ffb4a2" opacity=".7"/><circle cx="101" cy="90" r="4" fill="#ffb4a2" opacity=".7"/>';
    var eyes = eyesN, mouth = '', acc = '', ch = true;
    if (emo === 'love') {
      eyes = '<path d="M52 80 Q60 70 68 80" stroke="#16204a" stroke-width="4" fill="none" stroke-linecap="round"/><path d="M82 80 Q90 70 98 80" stroke="#16204a" stroke-width="4" fill="none" stroke-linecap="round"/>';
      mouth = '<path d="M56 90 Q75 114 94 90 Q75 100 56 90 Z" fill="#16204a"/>';
      acc = '<text x="112" y="40" font-size="20">💖</text>';
    } else if (emo === 'neutral') {
      mouth = '<line x1="62" y1="96" x2="88" y2="96" stroke="#16204a" stroke-width="4" stroke-linecap="round"/>';
    } else if (emo === 'confused') {
      eyes = '<circle cx="61" cy="78" r="7.5" fill="#16204a"/><circle cx="89" cy="79" r="6" fill="#16204a"/><path d="M50 66 Q56 61 62 65" stroke="#16204a" stroke-width="3" fill="none" stroke-linecap="round"/>';
      mouth = '<path d="M58 96 q6 -7 11 0 q5 7 11 0" stroke="#16204a" stroke-width="4" fill="none" stroke-linecap="round"/>';
      acc = '<text x="110" y="42" font-size="26" fill="#f59e0b" font-weight="800">?</text>';
      ch = false;
    } else if (emo === 'sad') {
      mouth = '<path d="M60 100 Q75 90 90 100" stroke="#16204a" stroke-width="4" fill="none" stroke-linecap="round"/>';
      acc = '<circle cx="99" cy="90" r="4" fill="#7cc4ff"/>';
      ch = false;
    } else if (emo === 'thinking') {
      eyes = '<circle cx="61" cy="75" r="7.5" fill="#16204a"/><circle cx="89" cy="75" r="7.5" fill="#16204a"/>';
      mouth = '<circle cx="75" cy="97" r="5" fill="none" stroke="#16204a" stroke-width="4"/>';
      acc = '<text x="110" y="44" font-size="22">💭</text>';
      ch = false;
    } else { /* happy */
      mouth = '<path d="M58 92 Q75 108 92 92" stroke="#16204a" stroke-width="4" fill="none" stroke-linecap="round"/>';
    }
    return shield(eyes + mouth + (ch ? cheeks : '') + acc);
  }

  /* ---------- Idle "tricks" + facts ---------- */
  var ACTIONS = [
    { e: '⚽', l: 'playing football' }, { e: '🚀', l: 'flying a rocket' },
    { e: '🏢', l: 'heading to the office' }, { e: '🎮', l: 'playing video games' },
    { e: '🧮', l: 'using a calculator' }, { e: '📊', l: 'giving a presentation' },
    { e: '☕', l: 'on a coffee break' }, { e: '📱', l: 'locking a phone' },
    { e: '🗺️', l: 'mapping a zone' }, { e: '🔒', l: 'securing an app' },
    { e: '🏋️', l: 'working out' }, { e: '🎸', l: 'playing guitar' },
    { e: '🍕', l: 'grabbing pizza' }, { e: '🎨', l: 'painting' },
    { e: '📚', l: 'reading the policy' }, { e: '✈️', l: 'travelling' },
    { e: '🎯', l: 'hitting targets' }, { e: '🧑‍💻', l: 'writing some code' },
    { e: '🕵️', l: 'investigating a log' }, { e: '🎤', l: 'presenting on stage' },
    { e: '🧘', l: 'meditating' }, { e: '🛰️', l: 'watching the perimeter' }
  ];
  var FACTS = [
    'Env Guardian works on personal phones — <b>no factory reset</b>.',
    'Only <b>approved apps</b> run inside your zone.',
    'Unapproved apps <b>lose their internet</b> in-zone.',
    'Every entry &amp; block is <b>logged</b> for audits.',
    'Presence is verified by a <b>QR scan</b>.',
    'A stolen device <b>can’t be re-registered</b>.',
    '<b>Per-app time limits</b> keep the team focused.',
    'Full access <b>returns the moment you leave</b>.',
    'Runs across Xiaomi, Oppo, Samsung &amp; more.',
    'Set it up once — <b>devices enforce themselves</b>.'
  ];

  /* ---------- Knowledge base (business only) ---------- */
  var KB = [
    { k: ['what is', 'about', 'product', 'explain', 'env guardian', 'overview'], a: 'Env Guardian is a BYOD mobile-security app. When a personal phone enters a restricted zone, it blocks unapproved apps, cuts their network and verifies presence — then restores full access when the person leaves. All with <b>no factory reset</b>.' },
    { k: ['how', 'work', 'works', 'flow', 'step'], a: 'Four automatic steps: (1) enroll once, (2) entering the zone brings the app forward, (3) scan the QR and enforcement engages, (4) leaving restores everything. There’s a visual walkthrough on the <b>How it works</b> page!' },
    { k: ['zone', 'geofence', 'location', 'boundary', 'perimeter', 'map', 'gps'], a: 'You draw the restricted area as a map polygon. Enforcement activates <b>only inside it</b> — outside, the phone behaves completely normally.' },
    { k: ['block', 'blocking', 'app', 'apps', 'whitelist', 'allow', 'restrict'], a: 'Inside the zone only whitelisted apps run — anything else is instantly sent back to the home screen. Admins manage the allow-list globally or per device.' },
    { k: ['time limit', 'minutes', 'usage', 'budget', 'screen time', 'limit'], a: 'Admins can allow an app but cap it to a <b>daily budget</b> (say 30 min). Usage is measured on-device and the app is blocked once the budget is spent.' },
    { k: ['qr', 'scan', 'authenticate', 'presence', 'verify', 'code'], a: 'Presence is proven with a physical <b>QR scan</b> inside the zone. It can be fixed, or a rotating time-based (TOTP) code that can’t be reused from a photo.' },
    { k: ['network', 'internet', 'vpn', 'data', 'connection', 'bandwidth'], a: 'The <b>Network Guard</b> is a local, no-root VPN that cuts internet to unapproved apps while in-zone, then restores it on exit.' },
    { k: ['steal', 'stolen', 'theft', 'lost', 'bind', 're-register', 'reregister'], a: 'Each device is permanently <b>bound to its first owner</b>, so a lost or stolen phone can’t be re-registered under someone else.' },
    { k: ['privacy', 'personal', 'private', 'track', 'spy', 'monitor me'], a: 'Privacy is core: enforcement only happens <b>inside the zone</b>. Outside, nothing is controlled and no personal data is collected — only zone activity is reported.' },
    { k: ['wipe', 'reset', 'enroll', 'mdm', 'byod', 'personal phone', 'format'], a: 'No factory reset, no corporate enrollment. It runs as a normal app with granted permissions — that’s what makes it <b>BYOD-friendly</b>.' },
    { k: ['secure', 'tamper', 'bypass', 'disable', 'break', 'safe', 'cheat', 'defeat'], a: 'On BYOD nothing is 100% unbreakable, so we focus on <b>detection</b>: disabling the enforcer, VPN or accessibility raises a tamper flag that’s reported and can auto-lock the device. Deterrent-grade, with a full audit trail.' },
    { k: ['log', 'compliance', 'report', 'audit', 'telemetry', 'evidence'], a: 'Every allow/block is logged with a timestamp, and devices heartbeat status, location and a compliance score to the server in real time — <b>audit-ready</b> evidence.' },
    { k: ['industry', 'use case', 'who uses', 'education', 'exam', 'hospital', 'bank', 'office', 'data center', 'manufacturing', 'government'], a: 'It fits any high-trust space: corporate floors, exam halls, hospitals, data centres, R&D labs, government, finance and more. See the <b>Solutions</b> page for benefits per industry!' },
    { k: ['price', 'pricing', 'cost', 'how much', 'fee', 'license', 'quote'], a: 'For exact numbers let’s talk — but it’s built to be economical: the backend and database run on free cloud tiers and the app is distributed privately. Tap <b>Request a demo</b> and we’ll tailor a quote.' },
    { k: ['android', 'ios', 'iphone', 'device', 'oem', 'xiaomi', 'samsung', 'oppo', 'realme', 'vivo', 'support'], a: 'It targets <b>Android</b> across major OEMs (Samsung, Xiaomi, Oppo, Realme, Vivo…), with guided setup to survive aggressive battery-savers.' },
    { k: ['deploy', 'install', 'setup', 'hosting', 'server', 'database', 'render', 'neon'], a: 'The backend hosts on Render, the database on Neon, and the app installs as an APK. Admins configure zones and rules from a dashboard or the database.' },
    { k: ['demo', 'contact', 'buy', 'purchase', 'talk', 'sales', 'trial', 'pilot'], a: 'Love it! Head to the <b>Contact</b> page and hit <b>Request a demo</b> — we’ll set up a live zone on a real phone for you.' },
    { k: ['dashboard', 'admin', 'manage', 'control', 'configure', 'console'], a: 'Admins set the zone, whitelist and time limits, watch live device status and can remotely lock a device — from a dashboard or the database today, with a fuller web console on the roadmap.' },
    { k: ['offline', 'no internet', 'connection lost'], a: 'The device keeps its last known policy and <b>enforces locally</b> even if the network drops, then resyncs when it’s back.' },
    { k: ['timer', 'time in zone', 'duration', 'clock'], a: 'Once verified, a live <b>time-in-zone</b> timer runs on-screen and in the notification, tracking how long the device has been inside.' },
    { k: ['feature', 'features', 'capabilit', 'what can it do'], a: 'Highlights: geofenced zones, zero-trust app blocking, per-app time limits, QR presence auth, network guard (VPN), anti-theft binding and live compliance. Want detail on any one?' },
    { k: ['why', 'better', 'trust', 'advantage', 'benefit', 'reliable'], a: 'Because it secures the phones you can’t own or wipe — controlling risk <b>by location</b>, respecting personal privacy, detecting tampering, and giving you an audit trail. No enrollment friction.' },
    { k: ['help', 'options', 'topics', 'what can you'], a: 'I can explain how Env Guardian works, its features, security, privacy, industries, pricing and setup — or point you to a demo. What would you like to know?' }
  ];
  var SECRET_RE = /(pass ?word|api ?key|secret|token|credential|private key|\.env|database url|connection string|source code|admin ?pass|root access|ssh key)/i;
  var GREET_RE = /^(hi|hello|hey|yo|hii|namaste|greetings|good (morning|afternoon|evening))\b/i;
  var THANKS_RE = /(thank|thanks|thx|great|awesome|cool|nice)/i;
  var BYE_RE = /(bye|goodbye|see you|that'?s all|no more|exit|quit)/i;

  function respond(raw) {
    var t = (raw || '').toLowerCase().trim();
    if (!t) return { a: 'Ask me anything about Env Guardian! 😊', emo: 'happy' };
    if (SECRET_RE.test(t)) return { a: 'Ha — nice try! 😅 I’ll never share passwords, API keys, tokens or any internal secrets. I can only help with <b>product &amp; business</b> questions. Want to know how the security actually works instead?', emo: 'confused', noRate: true };
    if (BYE_RE.test(t)) return { a: 'Thanks for chatting! Before you go, mind sharing a quick thought? 👇', emo: 'happy', bye: true, noRate: true };
    if (GREET_RE.test(t)) return { a: 'Hi there! 👋 I’m Aegis, the Env Guardian guide. Ask me about how it works, features, privacy, industries or pricing.', emo: 'happy', noRate: true };
    // score KB
    var best = null, bestScore = 0;
    for (var i = 0; i < KB.length; i++) {
      var s = 0;
      for (var j = 0; j < KB[i].k.length; j++) { if (t.indexOf(KB[i].k[j]) !== -1) s++; }
      if (s > bestScore) { bestScore = s; best = KB[i]; }
    }
    if (best && bestScore > 0) return { a: best.a, emo: 'happy' };
    if (THANKS_RE.test(t)) return { a: 'You’re very welcome! 💙 Anything else about Env Guardian I can help with?', emo: 'love', noRate: true };
    return { a: 'Hmm, that one’s outside my zone 🤔 — I only cover Env Guardian and how it helps organizations. Try asking about <b>features, privacy, security, industries</b> or <b>pricing</b>.', emo: 'confused', noRate: true };
  }

  /* ---------- Build widget ---------- */
  var w = document.createElement('div');
  w.id = 'aegis-widget';
  w.innerHTML =
    '<div class="ag-bar">' +
    '<div class="ag-idle" id="agIdle"></div>' +
    '<button class="ag-launcher" id="agLauncher" aria-label="Chat with Aegis">' +
      '<span class="ag-prop" id="agProp"></span><span class="ag-dot"></span>' +
      '<span id="agLaunchFace">' + agFace('happy') + '</span>' +
      '<span class="ag-label">Ask&nbsp;Aegis</span></button>' +
    '</div>' +
    '<div class="ag-panel" id="agPanel" role="dialog" aria-label="Chat with Aegis">' +
      '<div class="ag-head">' +
        '<span id="agHeadFace">' + agFace('happy') + '</span>' +
        '<div><b>Aegis</b><small>Perimeter guide · online</small></div><span class="sp"></span>' +
        '<button class="ag-icbtn" id="agEnd">End</button>' +
        '<button class="ag-icbtn" id="agClose" aria-label="Close">✕</button>' +
      '</div>' +
      '<div class="ag-msgs" id="agMsgs"></div>' +
      '<div class="ag-chips" id="agChips"></div>' +
      '<form class="ag-input" id="agForm"><input id="agText" placeholder="Ask about Env Guardian…" autocomplete="off" aria-label="Message"><button type="submit" aria-label="Send">➤</button></form>' +
    '</div>';
  document.body.appendChild(w);

  var idle = document.getElementById('agIdle');
  var launcher = document.getElementById('agLauncher');
  var prop = document.getElementById('agProp');
  var msgs = document.getElementById('agMsgs');
  var chipsEl = document.getElementById('agChips');
  var form = document.getElementById('agForm');
  var input = document.getElementById('agText');
  var headFace = document.getElementById('agHeadFace');
  var launchFace = document.getElementById('agLaunchFace');
  var started = false, ratedCount = 0, feedbackShown = false, bubbleTimer;

  /* ---------- Idle cycle ---------- */
  var ai = 0, fi = 0, showFact = false;
  function setProp(e) { prop.textContent = e; prop.style.animation = 'none'; void prop.offsetWidth; prop.style.animation = ''; }
  function hop() { var s = launchFace.querySelector('.ag-mascot'); if (!s) return; s.classList.remove('ag-hop'); void s.offsetWidth; s.classList.add('ag-hop'); }
  function idleTick() {
    if (w.classList.contains('open')) return;
    var act = ACTIONS[ai % ACTIONS.length]; ai++;
    setProp(act.e); hop();
    if (showFact) { idle.innerHTML = '💡 ' + FACTS[fi % FACTS.length] + ' <b>Click me →</b>'; fi++; }
    else { idle.innerHTML = 'Aegis is ' + act.l + ' ' + act.e; }
    showFact = !showFact;
    idle.classList.add('show');
    clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(function () { idle.classList.remove('show'); }, 4300);
  }
  setInterval(idleTick, 5000);
  setTimeout(idleTick, 1200);

  /* ---------- Chat helpers ---------- */
  function scrollDown() { msgs.scrollTop = msgs.scrollHeight; }
  function setHead(emo) { headFace.innerHTML = agFace(emo); var s = headFace.querySelector('.ag-mascot'); if (s) { s.classList.remove('ag-tilt'); void s.offsetWidth; s.classList.add('ag-tilt'); } }
  function addMsg(html, who) {
    var d = document.createElement('div');
    d.className = 'ag-msg ' + (who === 'user' ? 'ag-user' : 'ag-bot');
    d.innerHTML = html; msgs.appendChild(d); scrollDown(); return d;
  }
  function typing(cb) {
    var t = document.createElement('div');
    t.className = 'ag-msg ag-bot ag-typing';
    t.innerHTML = '<i></i><i></i><i></i>'; msgs.appendChild(t); scrollDown();
    setTimeout(function () { t.remove(); cb(); }, 650 + Math.random() * 600);
  }
  function addRating() {
    var row = document.createElement('div');
    row.className = 'ag-rate';
    row.innerHTML = 'Was this helpful? <span class="ag-stars">' +
      '<span data-s="1">⭐</span><span data-s="2">⭐</span><span data-s="3">⭐</span><span data-s="4">⭐</span><span data-s="5">⭐</span></span>';
    msgs.appendChild(row); scrollDown();
    var stars = row.querySelectorAll('.ag-stars span');
    stars.forEach(function (st, idx) {
      st.addEventListener('mouseenter', function () { stars.forEach(function (x, k) { x.classList.toggle('on', k <= idx); }); });
      st.addEventListener('click', function () {
        var n = parseInt(st.dataset.s, 10);
        var emo = n >= 5 ? 'love' : n >= 4 ? 'happy' : n === 3 ? 'neutral' : 'sad';
        var say = { 5: 'Yay, thank you! 💖 You made my shield sparkle.', 4: 'Glad that helped! 😊', 3: 'Noted — I’ll keep improving. 🙂', 2: 'Sorry it wasn’t better. 😔 I’ll work on it.', 1: 'Oh no — I’ll do better, promise. 😔' }[n];
        setHead(emo);
        row.outerHTML = '<div class="ag-rate ag-thanks">' + '⭐'.repeat(n) + ' — ' + say + '</div>';
        scrollDown();
        ratedCount++;
        if (ratedCount >= 2 && !feedbackShown) setTimeout(showFeedback, 700);
      });
    });
  }
  function showFeedback() {
    if (feedbackShown) return; feedbackShown = true;
    setHead('thinking');
    var fb = document.createElement('div');
    fb.className = 'ag-fb';
    fb.innerHTML = '<h4>Help me get better 💭</h4>' +
      '<textarea id="agFb1" rows="2" placeholder="What could have been better?"></textarea>' +
      '<textarea id="agFb2" rows="2" placeholder="Any customization you’d like to see?"></textarea>' +
      '<button id="agFbSend">Send feedback</button>';
    msgs.appendChild(fb); scrollDown();
    document.getElementById('agFbSend').addEventListener('click', function () {
      var v1 = (document.getElementById('agFb1').value || '').trim();
      var v2 = (document.getElementById('agFb2').value || '').trim();
      fb.remove();
      setHead('love');
      var extra = '';
      if (v1 || v2) {
        var body = encodeURIComponent('Better: ' + v1 + '\nCustomization: ' + v2);
        extra = ' <a href="mailto:ignite.logic1519@gmail.com?subject=Aegis%20feedback&body=' + body + '" style="color:var(--accent,#4f6ef7);font-weight:600">Send to our team →</a>';
      }
      addMsg('Thank you so much — this genuinely helps us improve! 💙' + extra, 'bot');
    });
  }

  function send(text) {
    if (!text.trim()) return;
    addMsg(text.replace(/</g, '&lt;'), 'user');
    input.value = '';
    setHead('thinking');
    typing(function () {
      var r = respond(text);
      addMsg(r.a, 'bot');
      setHead(r.emo);
      if (!r.noRate) addRating();
      if (r.bye) setTimeout(showFeedback, 500);
    });
  }

  var CHIPS = ['How does it work?', 'Key features', 'Is my privacy safe?', 'Which industries?', 'Pricing', 'Book a demo'];
  function renderChips() {
    chipsEl.innerHTML = '';
    CHIPS.forEach(function (c) {
      var b = document.createElement('button');
      b.className = 'ag-chip'; b.textContent = c;
      b.addEventListener('click', function () { send(c); });
      chipsEl.appendChild(b);
    });
  }

  function openChat() {
    w.classList.add('open');
    idle.classList.remove('show');
    if (!started) {
      started = true;
      renderChips();
      setTimeout(function () {
        addMsg('Hi, I’m <b>Aegis</b> 👋 your Env Guardian guide. Ask me anything about the product — or tap a suggestion below!', 'bot');
      }, 200);
    }
    setTimeout(function () { input.focus(); }, 350);
  }
  function closeChat() { w.classList.remove('open'); }

  launcher.addEventListener('click', openChat);
  document.getElementById('agClose').addEventListener('click', closeChat);
  document.getElementById('agEnd').addEventListener('click', function () {
    addMsg('Thanks for chatting! One quick thing before you go 👇', 'bot');
    setHead('happy'); showFeedback();
  });
  form.addEventListener('submit', function (e) { e.preventDefault(); send(input.value); });
})();
