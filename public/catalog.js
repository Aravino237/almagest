(async function () {
  const { api, h, $, clear, fmt } = window.Almagest;
  const user = await window.Almagest.me();
  let loc = { lat: 12.82, lon: 80.04, name: "Kattankulathur" };
  if (user) { const { profile: p } = await api("/profile"); loc = { lat: p.lat, lon: p.lon, name: p.locationName }; }
  const TYPES = ["", "galaxy", "nebula", "globular_cluster", "open_cluster", "planetary_nebula", "double_star", "planet"];
  let type = "", selected = null, timer;
  const chips = $("#type-chips");
  TYPES.forEach((t) => chips.append(h("button", { class: "chip" + (t === "" ? " active" : ""), type: "button", dataset: { t }, onclick: (e) => {
    type = t; chips.querySelectorAll(".chip").forEach((c) => c.classList.toggle("active", c.dataset.t === t)); load(); } }, t ? fmt.type(t) : "All")));
  $("#q").addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(load, 250); });

  async function load() {
    const qs = new URLSearchParams({ lat: loc.lat, lon: loc.lon });
    if ($("#q").value.trim()) qs.set("q", $("#q").value.trim());
    if (type) qs.set("type", type);
    const { objects } = await api("/objects?" + qs);
    const body = clear($("#rows"));
    if (!objects.length) body.append(h("tr", {}, h("td", { colspan: 4, class: "empty" }, "No matches.")));
    objects.forEach((o) => body.append(h("tr", { class: "click" + (selected === o.slug ? " sel" : ""), tabindex: 0, onclick: () => show(o), onkeydown: (e) => { if (e.key === "Enter") show(o); } },
      h("td", {}, h("strong", {}, o.name), o.catalogId && o.catalogId !== o.name ? h("span", { class: "faint small" }, " " + o.catalogId) : null),
      h("td", { class: "muted" }, fmt.type(o.type)), h("td", { class: "mono" }, o.magnitude.toFixed(1)),
      h("td", { class: "mono", style: o.altNow > 0 ? "color:var(--ok)" : "color:var(--faint)" }, `${o.altNow}°`))));
  }

  async function show(o) {
    selected = o.slug;
    document.querySelectorAll("#rows tr").forEach((tr) => tr.classList.remove("sel"));
    const d = clear($("#detail"));
    d.append(h("div", { class: "eyebrow" }, fmt.type(o.type) + (o.constellation ? " · " + o.constellation : "")), h("h2", {}, o.name),
      h("p", { class: "muted" }, o.description),
      h("div", { class: "row small mono muted", style: "margin:10px 0" }, `mag ${o.magnitude.toFixed(1)}`, `· size ${o.sizeArcmin}′`, `· now ${o.altNow}°`),
      h("h3", { style: "font-size:16px;margin-top:14px" }, `Altitude over the next 12 hours from ${loc.name}`));
    const canvas = h("canvas", { class: "chart", width: 760, height: 480, "aria-label": "Altitude chart" });
    d.append(canvas, h("p", { class: "small faint" }, "Gold line: the object's altitude. Shaded: astronomical darkness (Sun below −18°)."),
      h("a", { class: "btn small", href: `log.html?object=${o.id}`, style: "margin-top:10px" }, "Log an observation"));
    const t = await api(`/objects/${o.slug}/track?lat=${loc.lat}&lon=${loc.lon}&hours=12`);
    draw(canvas, t.points);
  }

  function draw(c, pts) {
    const g = c.getContext("2d"), W = c.width, H = c.height, pad = { l: 52, r: 16, t: 16, b: 44 };
    const css = getComputedStyle(document.documentElement);
    const col = (v) => css.getPropertyValue(v).trim();
    g.clearRect(0, 0, W, H);
    const x = (i) => pad.l + (i / (pts.length - 1)) * (W - pad.l - pad.r);
    const y = (a) => pad.t + ((90 - a) / 180) * (H - pad.t - pad.b);
    g.fillStyle = "rgba(76,122,120,0.18)";
    pts.forEach((p, i) => { if (i < pts.length - 1 && p.sunAlt <= -18) g.fillRect(x(i), pad.t, x(i + 1) - x(i) + 0.5, H - pad.t - pad.b); });
    g.font = "20px 'IBM Plex Mono', monospace"; g.fillStyle = col("--muted"); g.strokeStyle = col("--line"); g.lineWidth = 1;
    for (const a of [-90, -45, 0, 45, 90]) { g.beginPath(); g.moveTo(pad.l, y(a)); g.lineTo(W - pad.r, y(a)); g.stroke(); g.fillText(a + "°", 4, y(a) + 6); }
    g.strokeStyle = col("--muted"); g.setLineDash([6, 6]); g.beginPath(); g.moveTo(pad.l, y(0)); g.lineTo(W - pad.r, y(0)); g.stroke(); g.setLineDash([]);
    pts.forEach((p, i) => { if (i % 12 === 0) g.fillText(fmt.time(p.t), Math.min(x(i) - 28, W - 120), H - 12); });
    g.strokeStyle = col("--brass"); g.lineWidth = 3; g.beginPath();
    pts.forEach((p, i) => (i ? g.lineTo(x(i), y(p.alt)) : g.moveTo(x(i), y(p.alt)))); g.stroke();
  }
  load();
})();
