(async function () {
  const { api, h, $, clear, fmt, toast } = window.Almagest;
  const user = await window.Almagest.me();
  $("#at").value = fmt.localInput(new Date());
  $("#loc-mode").onchange = (e) => $("#custom-loc").classList.toggle("hidden", e.target.value !== "custom");

  if (user) {
    const { profile: p } = await api("/profile");
    $("#lat").value = p.lat; $("#lon").value = p.lon;
    clear($("#setup")).append(
      h("div", {}, h("strong", {}, p.locationName)), h("div", {}, `Bortle ${p.bortle} · ${p.apertureMm ? p.apertureMm + " mm aperture" : "naked eye"} · ${p.experience}`),
      h("div", {}, `Limiting magnitude ≈ ${p.limitingMagnitude} · min altitude ${p.minAlt}°`), h("a", { href: "profile.html" }, "Change setup"));
  } else {
    clear($("#setup")).append(h("p", {}, "Planning as a guest: Kattankulathur, Bortle 6, naked eye."),
      h("p", { style: "margin-top:6px" }, h("a", { href: "login.html?next=plan.html" }, "Sign in"), " to save your setup and get recommendations that learn from your ratings."));
  }

  let lastPlan = null, custom = null;
  $("#plan-form").addEventListener("submit", (e) => { e.preventDefault(); run(); });

  async function run() {
    const body = { at: new Date($("#at").value).toISOString() };
    custom = $("#loc-mode").value === "custom" ? { lat: Number($("#lat").value), lon: Number($("#lon").value) } : null;
    if (custom) Object.assign(body, custom);
    const out = clear($("#plan-results"));
    out.append(h("p", { class: "muted" }, "Computing positions and ranking targets…"));
    try { lastPlan = await api("/plan", { method: "POST", body }); render(lastPlan); }
    catch (err) { clear(out).append(h("p", { class: "err" }, err.message)); }
  }

  function render(p) {
    const sum = clear($("#plan-summary"));
    sum.append(h("div", { class: "grid g4", style: "margin-bottom:16px" },
      tile(fmt.dateTime(p.at), p.shifted ? "shifted to darkness" : "session time"),
      tile(`${p.moon.illuminationPct}%`, `${p.moon.phaseName}, ${p.moon.alt > 0 ? "up" : "down"}`),
      tile(`${p.feasible} / ${p.considered}`, "targets within reach"),
      tile(p.limitMag.toFixed(1), "limiting magnitude")));
    if (p.note) sum.append(h("p", { class: "small muted", style: "margin:-4px 0 14px" }, p.note));
    sum.append(h("p", { class: "small faint", style: "margin-bottom:14px" },
      `${p.rejected.belowMinAltitude} objects are below your horizon limit and ${p.rejected.tooFaint} are too faint for your setup. `,
      p.model.personalised ? `Ranking is personalised from ${p.model.userExamples} of your ratings and logs.` : "Ranking uses the community model until you rate a few targets."));

    const out = clear($("#plan-results"));
    if (!p.recommendations.length) return out.append(h("div", { class: "card empty" }, "Nothing clears your limits at this time. Try later in the night or lower the minimum altitude in your profile."));
    p.recommendations.forEach((r, i) => out.append(card(r, i)));
  }
  const tile = (v, l) => h("div", { class: "card", style: "padding:14px" }, h("div", { class: "stat", style: "font-size:24px" }, v), h("div", { class: "stat-label" }, l));

  function card(r, i) {
    const up = h("button", { title: "I'd enjoy this", "aria-label": "Thumbs up" }, "👍");
    const down = h("button", { title: "Not for me", "aria-label": "Thumbs down" }, "👎");
    const send = async (liked) => {
      if (!user) { toast("Sign in to rate targets: your ratings train your personal model.", true); return; }
      up.disabled = down.disabled = true;
      try {
        const res = await api("/feedback", { method: "POST", body: { objectId: r.objectId, liked, at: lastPlan.at, ...(custom || {}) } });
        up.classList.toggle("on", liked); down.classList.toggle("on", !liked);
        toast(`Learned. The model predicted ${Math.round(res.predictedBefore * 100)}% and you said ${liked ? "yes" : "no"}. Updated from ${res.examples} examples.`);
      } catch (err) { toast(err.message, true); }
      finally { up.disabled = down.disabled = false; }
    };
    up.onclick = () => send(true); down.onclick = () => send(false);
    const pct = Math.round(r.score * 100);
    return h("article", { class: "rec" },
      h("div", { class: "rank" }, String(i + 1)),
      h("div", {},
        h("h3", {}, r.name, r.catalogId && r.catalogId !== r.name ? h("span", { class: "badge" }, r.catalogId) : null,
          h("span", { class: "badge brass" }, fmt.type(r.type)), r.explore ? h("span", { class: "badge explore", title: "Picked to learn your taste for a type you haven't rated much" }, "exploration pick") : null),
        h("div", { class: "meta" }, `${r.constellation ? r.constellation + " · " : ""}altitude ${r.alt}° · azimuth ${Math.round(r.az)}° · magnitude ${r.mag}`),
        h("ul", { class: "reasons" }, r.reasons.map((x) => h("li", { class: `${x.effect === "+" ? "plus" : "minus"}${x.personal ? " personal" : ""}` }, x.text)))),
      h("div", { class: "score" },
        h("div", { class: "pct" }, `${pct}%`), h("div", { class: "small muted" }, "predicted enjoyment"),
        h("div", { class: "meter" }, h("span", { style: `width:${pct}%` })),
        h("div", { class: "fb" }, up, down, h("a", { class: "btn ghost small", href: `log.html?object=${r.objectId}&at=${encodeURIComponent(lastPlan.at)}` }, "Log it"))));
  }

  run();
})();
