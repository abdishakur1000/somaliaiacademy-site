// Somali AI Academy — interactions (vanilla, no dependencies)
(function () {
  'use strict';

  var doc = document.documentElement;
  doc.classList.add('js');

  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  /* ---------- scroll progress + learning-path fill ---------- */
  var bar = document.querySelector('.progress');
  var pathEl = document.querySelector('.path');
  var pathFill = document.querySelector('.path-fill');
  var nodes = [].slice.call(document.querySelectorAll('.lv-node'));

  function updateScrollUI() {
    var max = doc.scrollHeight - window.innerHeight;
    if (bar) bar.style.transform = 'scaleX(' + (max > 0 ? window.scrollY / max : 0) + ')';

    if (pathEl && pathFill && !reducedMotion) {
      var r = pathEl.getBoundingClientRect();
      var mid = window.innerHeight * 0.55;
      var p = Math.max(0, Math.min(1, (mid - r.top) / r.height));
      pathFill.style.transform = 'scaleY(' + p.toFixed(4) + ')';
      nodes.forEach(function (n) {
        var nr = n.getBoundingClientRect();
        n.classList.toggle('lit', nr.top + nr.height / 2 < mid);
      });
    }
  }
  if (reducedMotion) nodes.forEach(function (n) { n.classList.add('lit'); });

  var ticking = false;
  window.addEventListener('scroll', function () {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(function () { updateScrollUI(); ticking = false; });
    }
  }, { passive: true });
  window.addEventListener('resize', updateScrollUI);
  updateScrollUI();

  /* ---------- scroll reveal ---------- */
  var revealEls = document.querySelectorAll('.reveal');
  if (!reducedMotion && 'IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('in');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });
    revealEls.forEach(function (el) { io.observe(el); });
  } else {
    revealEls.forEach(function (el) { el.classList.add('in'); });
  }

  /* ---------- 3D tilt (desktop pointers only) ---------- */
  if (finePointer && !reducedMotion) {
    document.querySelectorAll('.tilt').forEach(function (card) {
      var glare = card.querySelector('.glare');
      var raf = null;

      card.addEventListener('mousemove', function (e) {
        var rect = card.getBoundingClientRect();
        var px = (e.clientX - rect.left) / rect.width;
        var py = (e.clientY - rect.top) / rect.height;
        if (raf) cancelAnimationFrame(raf);
        raf = requestAnimationFrame(function () {
          var rx = (0.5 - py) * 8;
          var ry = (px - 0.5) * 10;
          card.style.transform =
            'perspective(1100px) rotateX(' + rx.toFixed(2) + 'deg) rotateY(' + ry.toFixed(2) + 'deg) translateY(-5px)';
          if (glare) {
            glare.style.background =
              'radial-gradient(circle at ' + (px * 100).toFixed(1) + '% ' + (py * 100).toFixed(1) + '%, rgba(255,255,255,.14), transparent 55%)';
          }
        });
      });

      card.addEventListener('mouseleave', function () {
        if (raf) cancelAnimationFrame(raf);
        card.style.transform = '';
        if (glare) glare.style.background = 'none';
      });
    });
  }

  /* ---------- chat replay (typing animation) ---------- */
  var chatBody = document.querySelector('.chat-body');
  if (chatBody && !reducedMotion) {
    doc.classList.add('play-chat');

    var topSeq = [].slice.call(chatBody.children).filter(function (el) {
      return el.classList.contains('seq');
    });

    function showEl(el) { el.classList.add('show'); }

    function typeInto(msg, done) {
      var span = msg.querySelector('.typed');
      var full = msg.getAttribute('data-type') || (span ? span.textContent : '');
      if (!span) { done(); return; }
      span.textContent = '';
      msg.classList.add('typing-now');
      var i = 0;
      (function tick() {
        if (i <= full.length) {
          span.textContent = full.slice(0, i);
          i++;
          setTimeout(tick, 22);
        } else {
          msg.classList.remove('typing-now');
          done();
        }
      })();
    }

    function playFrom(idx) {
      if (idx >= topSeq.length) return;
      var el = topSeq[idx];
      showEl(el);

      if (el.hasAttribute('data-type')) {
        typeInto(el, function () { setTimeout(function () { playFrom(idx + 1); }, 350); });
        return;
      }

      var lis = [].slice.call(el.querySelectorAll('li.seq'));
      if (lis.length) {
        lis.forEach(function (li, k) {
          setTimeout(function () {
            showEl(li);
            if (k === lis.length - 1) setTimeout(function () { playFrom(idx + 1); }, 420);
          }, 300 + k * 280);
        });
        return;
      }

      setTimeout(function () { playFrom(idx + 1); }, 700);
    }

    setTimeout(function () { playFrom(0); }, 700);
  }

  /* ---------- particle network in hero ---------- */
  var header = document.querySelector('header');
  var canvas = document.getElementById('net');
  if (canvas && !reducedMotion && header) {
    var ctx = canvas.getContext('2d');
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var W = 0, H = 0, pts = [], rafId = null, running = false;
    var LINK = 120;

    function resizeNet() {
      W = header.clientWidth;
      H = header.clientHeight;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      var count = W < 700 ? 30 : 64;
      pts = [];
      for (var i = 0; i < count; i++) {
        pts.push({
          x: Math.random() * W,
          y: Math.random() * H,
          vx: (Math.random() - 0.5) * 0.35,
          vy: (Math.random() - 0.5) * 0.35
        });
      }
    }

    function step() {
      ctx.clearRect(0, 0, W, H);
      var i, j, p, q, dx, dy, d;
      for (i = 0; i < pts.length; i++) {
        p = pts[i];
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0 || p.x > W) p.vx *= -1;
        if (p.y < 0 || p.y > H) p.vy *= -1;
      }
      for (i = 0; i < pts.length; i++) {
        p = pts[i];
        for (j = i + 1; j < pts.length; j++) {
          q = pts[j];
          dx = p.x - q.x; dy = p.y - q.y;
          d = Math.sqrt(dx * dx + dy * dy);
          if (d < LINK) {
            ctx.strokeStyle = 'rgba(34,211,238,' + (0.3 * (1 - d / LINK)).toFixed(3) + ')';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(q.x, q.y);
            ctx.stroke();
          }
        }
        ctx.fillStyle = 'rgba(124,196,255,.7)';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 1.7, 0, Math.PI * 2);
        ctx.fill();
      }
      rafId = requestAnimationFrame(step);
    }

    function start() { if (!running) { running = true; rafId = requestAnimationFrame(step); } }
    function stop() { running = false; if (rafId) cancelAnimationFrame(rafId); rafId = null; }

    resizeNet();
    window.addEventListener('resize', resizeNet);

    var heroVisible = true;
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        heroVisible = entries[0].isIntersecting;
        heroVisible && !document.hidden ? start() : stop();
      }, { threshold: 0.05 }).observe(header);
    } else {
      start();
    }
    document.addEventListener('visibilitychange', function () {
      document.hidden || !heroVisible ? stop() : start();
    });
  }
})();
