(async function () {
  const { api, h, $, clear, toast, showErrors } = window.Almagest;
  await window.Almagest.requireLogin();
  if (new URLSearchParams(location.search).get("welcome")) toast("Welcome! Set your location and equipment so the planner knows your limits.");
  const LABEL = { bias: "Baseline", altitude: "Altitude above horizon", reach_margin: "Within equipment reach", moon_glare: "Moonlight interference",
    surface_dimness: "Low surface brightness", apparent_size: "Apparent size", novelty: "Something new to you", beginner_faint: "Faintness (for your level)" };

  function fill(p) {
    for (const k of ["locationName", "lat", "lon", "bortle", "apertureMm", "experience", "minAlt"]) $("#" + k).value = p[k];
    if (![...$("#apertureMm").options].some((o) => Number(o.value) === p.apertureMm)) $("#apertureMm").append(new Option(`${p.apertureMm} mm`, p.apertureMm, true, true));
    $("#limit-line").textContent = `With this setup Almagest estimates your limiting magnitude at about ${p.limitingMagnitude}.`;
  }
  fill((await api("/profile")).profile);

  $("#geo").onclick = () => {
    if (!navigator.geolocation) return toast("Geolocation isn't available in this browser.", true);
    navigator.geolocation.getCurrentPosition((pos) => { $("#lat").value = pos.coords.latitude.toFixed(4); $("#lon").value = pos.coords.longitude.toFixed(4); toast("Location filled in. Remember to save."); },
      () => toast("Couldn't get your location.", true));
  };
  $("#profile-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const { profile } = await api("/profile", { method: "PUT", body: {
        locationName: $("#locationName").value, lat: Number($("#lat").value), lon: Number($("#lon").value), bortle: Number($("#bortle").value),
        apertureMm: Number($("#apertureMm").value), experience: $("#experience").value, minAlt: Number($("#minAlt").value) } });
      fill(profile); toast("Setup saved.");
    } catch (err) { showErrors(e.target, err); }
  });

  async function loadModel() {
    const m = await api("/model/me");
    $("#model-summary").textContent = m.examples
      ? `Trained on ${m.examples} of your examples (thumbs and rated logs). The community model has absorbed ${m.globalUpdates} updates from all users.`
      : "No personal examples yet, so you're getting the community model. Rate targets on the Plan page or log observations to train it.";
    const box = clear($("#affinities"));
    const max = Math.max(1, ...m.affinities.map((a) => Math.abs(a.personal)));
    m.affinities.forEach((a) => {
      const w = (Math.abs(a.personal) / max) * 50;
      box.append(h("div", { class: "hbar" }, h("span", {}, a.label.charAt(0).toUpperCase() + a.label.slice(1)),
        h("div", { class: "track" }, h("div", { class: "mid" }),
          h("span", { style: `left:${a.personal >= 0 ? 50 : 50 - w}%;width:${w}%;background:${a.personal >= 0 ? "var(--ok)" : "var(--alert)"}` })),
        h("span", { class: "val" }, (a.personal >= 0 ? "+" : "") + a.personal.toFixed(2))));
    });
    const tb = clear($("#weights"));
    m.features.filter((f) => !f.feature.startsWith("type:")).forEach((f) => tb.append(h("tr", {},
      h("td", {}, LABEL[f.feature] || f.feature), h("td", { class: "mono muted" }, f.prior.toFixed(2)),
      h("td", { class: "mono muted" }, f.global.toFixed(2)), h("td", { class: "mono" }, f.effective.toFixed(2)))));
    const rec = clear($("#recent"));
    if (!m.recent.length) rec.append(h("p", { class: "empty" }, "Nothing yet."));
    m.recent.forEach((r) => rec.append(h("div", { class: "row small", style: "padding:5px 0" },
      h("span", { class: "badge" }, r.source === "log" ? "logbook" : "thumbs"), h("strong", {}, r.name),
      h("span", { class: "spacer" }), h("span", { class: "mono muted" }, r.source === "log" ? `label ${Number(r.label).toFixed(2)}` : r.label >= 0.5 ? "👍" : "👎"))));
  }
  loadModel();
  $("#reset-model").onclick = async () => {
    if (!confirm("Delete all your training examples and reset your personal model? Your logbook entries stay.")) return;
    await api("/model/me", { method: "DELETE" }); toast("Personal model reset."); loadModel();
  };
})();
