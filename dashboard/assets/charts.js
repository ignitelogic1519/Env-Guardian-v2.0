// ── Env Guardian — lightweight SVG charts (no libraries) ────────────────────
// Mark specs: bars ≤24px with a 4px rounded data-end (square at the baseline),
// hairline solid gridlines, text in ink tokens (never the series color),
// per-mark hover tooltips with hit targets larger than the mark.
window.EGCharts = (() => {
  const NS = "http://www.w3.org/2000/svg";
  const INK = "#c7cfe6", MUTED = "#8d99b8", GRID = "rgba(255,255,255,.07)", AXIS = "rgba(255,255,255,.16)";

  // ── shared tooltip ──
  const tipEl = () => document.getElementById("vizTip");
  function showTip(html, ev) {
    const t = tipEl(); if (!t) return;
    t.innerHTML = html; t.classList.add("on");
    moveTip(ev);
  }
  function moveTip(ev) {
    const t = tipEl(); if (!t) return;
    const pad = 14, w = t.offsetWidth, h = t.offsetHeight;
    let x = ev.clientX + pad, y = ev.clientY - h - 10;
    if (x + w > innerWidth - 8) x = ev.clientX - w - pad;
    if (y < 8) y = ev.clientY + pad;
    t.style.left = x + "px"; t.style.top = y + "px";
  }
  function hideTip() { tipEl()?.classList.remove("on"); }

  // clean y-axis ticks (0 / 5 / 10 …)
  function niceStep(max, ticks = 4) {
    if (max <= 0) return 1;
    const raw = max / ticks, mag = Math.pow(10, Math.floor(Math.log10(raw)));
    for (const m of [1, 2, 2.5, 5, 10]) if (raw <= m * mag) return m * mag;
    return 10 * mag;
  }
  const fmtN = (n) => n >= 1000 ? (n / 1000).toFixed(n % 1000 ? 1 : 0) + "K" : String(n);

  function svgEl(tag, attrs) {
    const el = document.createElementNS(NS, tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    return el;
  }

  // column with a 4px rounded top, square baseline
  function colPath(x, w, yTop, yBase) {
    const r = Math.min(4, w / 2, Math.max(0, yBase - yTop));
    return `M${x},${yBase} L${x},${yTop + r} Q${x},${yTop} ${x + r},${yTop} ` +
           `L${x + w - r},${yTop} Q${x + w},${yTop} ${x + w},${yTop + r} L${x + w},${yBase} Z`;
  }

  // ── column chart: data = [{label, value, tip?}] ─────────────────────────
  function column(host, data, opts = {}) {
    const color = opts.color || "#3987e5";
    const W = 640, H = 230, padL = 40, padR = 8, padT = 12, padB = 28;
    const iw = W - padL - padR, ih = H - padT - padB, yBase = padT + ih;
    const max = Math.max(1, ...data.map((d) => d.value));
    const step = niceStep(max), top = Math.ceil(max / step) * step;

    const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": opts.label || "chart" });

    for (let v = 0; v <= top; v += step) {
      const y = yBase - (v / top) * ih;
      svg.appendChild(svgEl("line", { x1: padL, x2: W - padR, y1: y, y2: y, stroke: v === 0 ? AXIS : GRID, "stroke-width": 1 }));
      const t = svgEl("text", { x: padL - 7, y: y + 3.5, "text-anchor": "end", "font-size": 10, fill: MUTED, style: "font-variant-numeric:tabular-nums" });
      t.textContent = fmtN(v); svg.appendChild(t);
    }

    const band = iw / data.length, barW = Math.min(24, band * 0.55);
    const labelEvery = Math.max(1, Math.ceil(data.length / 7));

    data.forEach((d, i) => {
      const cx = padL + band * i + band / 2, x = cx - barW / 2;
      const hVal = (d.value / top) * ih, yTop = yBase - hVal;
      let bar = null;
      if (d.value > 0) {
        bar = svgEl("path", { d: colPath(x, barW, yTop, yBase), fill: color });
        svg.appendChild(bar);
      } else {
        bar = svgEl("rect", { x, y: yBase - 2, width: barW, height: 2, rx: 1, fill: GRID });
        svg.appendChild(bar);
      }
      if (i % labelEvery === 0) {
        const t = svgEl("text", { x: cx, y: H - 8, "text-anchor": "middle", "font-size": 10, fill: MUTED });
        t.textContent = d.label; svg.appendChild(t);
      }
      // hit target bigger than the mark — the full band, full height
      const hit = svgEl("rect", { x: padL + band * i, y: padT, width: band, height: ih, fill: "transparent", style: "cursor:default" });
      hit.addEventListener("mouseenter", (ev) => { bar.setAttribute("opacity", ".75"); showTip(d.tip || `<b>${d.label}</b>${d.value}`, ev); });
      hit.addEventListener("mousemove", moveTip);
      hit.addEventListener("mouseleave", () => { bar.removeAttribute("opacity"); hideTip(); });
      svg.appendChild(hit);
    });

    host.innerHTML = ""; host.appendChild(svg);
  }

  // ── horizontal bars: data = [{label, value, display?, tip?}] ────────────
  function hbars(host, data, opts = {}) {
    const color = opts.color || "#3987e5";
    const W = 640, row = 34, padT = 4;
    const H = padT + data.length * row + 4;
    const labelW = 172, valueW = 66;
    const x0 = labelW + 10, iw = W - x0 - valueW;
    const max = Math.max(1, ...data.map((d) => d.value));

    const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": opts.label || "chart" });
    svg.appendChild(svgEl("line", { x1: x0, x2: x0, y1: padT, y2: H - 4, stroke: AXIS, "stroke-width": 1 }));

    data.forEach((d, i) => {
      const y = padT + i * row + row / 2;
      const lbl = svgEl("text", { x: labelW, y: y + 4, "text-anchor": "end", "font-size": 11.5, fill: INK });
      lbl.textContent = d.label.length > 26 ? d.label.slice(0, 25) + "…" : d.label;
      svg.appendChild(lbl);

      const w = Math.max(2, (d.value / max) * iw);
      // rounded data-end (right), square at the baseline (left)
      const bar = svgEl("path", {
        d: `M${x0},${y - 8} L${x0 + w - 4},${y - 8} Q${x0 + w},${y - 8} ${x0 + w},${y - 4} L${x0 + w},${y + 4} Q${x0 + w},${y + 8} ${x0 + w - 4},${y + 8} L${x0},${y + 8} Z`,
        fill: color,
      });
      svg.appendChild(bar);

      const val = svgEl("text", { x: x0 + w + 8, y: y + 4, "font-size": 11.5, fill: MUTED, style: "font-variant-numeric:tabular-nums" });
      val.textContent = d.display ?? d.value; svg.appendChild(val);

      const hit = svgEl("rect", { x: 0, y: padT + i * row, width: W, height: row, fill: "transparent" });
      hit.addEventListener("mouseenter", (ev) => { bar.setAttribute("opacity", ".75"); showTip(d.tip || `<b>${d.label}</b>${d.display ?? d.value}`, ev); });
      hit.addEventListener("mousemove", moveTip);
      hit.addEventListener("mouseleave", () => { bar.removeAttribute("opacity"); hideTip(); });
      svg.appendChild(hit);
    });

    host.innerHTML = ""; host.appendChild(svg);
  }

  // ── geofence polygon preview ────────────────────────────────────────────
  function polygon(host, points) {
    const W = 640, H = 300, pad = 34;
    host.innerHTML = "";
    if (!Array.isArray(points) || points.length < 3) {
      host.innerHTML = `<div class="empty">No zone polygon set</div>`; return;
    }
    const lats = points.map((p) => p.lat), lngs = points.map((p) => p.lng);
    const minLa = Math.min(...lats), maxLa = Math.max(...lats);
    const minLo = Math.min(...lngs), maxLo = Math.max(...lngs);
    const sx = (W - pad * 2) / Math.max(1e-9, maxLo - minLo);
    const sy = (H - pad * 2) / Math.max(1e-9, maxLa - minLa);
    const s = Math.min(sx, sy);
    const ox = (W - (maxLo - minLo) * s) / 2, oy = (H - (maxLa - minLa) * s) / 2;
    const px = (p) => ({ x: ox + (p.lng - minLo) * s, y: H - (oy + (p.lat - minLa) * s) });

    const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, class: "zone-svg", role: "img", "aria-label": "Restricted zone preview" });
    for (let i = 1; i < 8; i++) {
      svg.appendChild(svgEl("line", { x1: (W / 8) * i, x2: (W / 8) * i, y1: 0, y2: H, stroke: GRID, "stroke-width": 1 }));
      if (i < 4) svg.appendChild(svgEl("line", { x1: 0, x2: W, y1: (H / 4) * i, y2: (H / 4) * i, stroke: GRID, "stroke-width": 1 }));
    }
    const d = points.map((p, i) => { const c = px(p); return `${i ? "L" : "M"}${c.x.toFixed(1)},${c.y.toFixed(1)}`; }).join(" ") + " Z";
    svg.appendChild(svgEl("path", { d, fill: "rgba(208,59,59,.14)", stroke: "#d03b3b", "stroke-width": 2, "stroke-linejoin": "round" }));
    points.forEach((p, i) => {
      const c = px(p);
      svg.appendChild(svgEl("circle", { cx: c.x, cy: c.y, r: 5, fill: "#d03b3b", stroke: "#151a2c", "stroke-width": 2 }));
      const t = svgEl("text", { x: c.x + 9, y: c.y - 7, "font-size": 10.5, fill: MUTED });
      t.textContent = `P${i + 1}`; svg.appendChild(t);
    });
    host.appendChild(svg);
  }

  return { column, hbars, polygon, showTip, hideTip };
})();
