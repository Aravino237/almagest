(async function () {
  const { api, h, $, clear, fmt, toast, showErrors } = window.Almagest;
  await window.Almagest.requireLogin();
  const [{ profile }, { objects }] = await Promise.all([api("/profile"), api("/objects")]);
  const sel = $("#objectId");
  objects.forEach((o) => sel.append(h("option", { value: o.id }, `${o.name}${o.catalogId && o.catalogId !== o.name ? " (" + o.catalogId + ")" : ""}`)));
  for (const id of ["seeing", "transparency", "rating"]) for (let i = 5; i >= 1; i--) $("#" + id).append(h("option", { value: i }, id === "rating" ? fmt.stars(i) : String(i)));
  $("#seeing").value = 3; $("#transparency").value = 3; $("#rating").value = 4;
  const syncTarget = () => $("#target-wrap").classList.toggle("hidden", !!sel.value);
  sel.onchange = syncTarget;

  let editing = null;
  function resetForm() {
    editing = null; $("#log-form").reset();
    $("#observedAt").value = fmt.localInput(new Date()); $("#lat").value = profile.lat; $("#lon").value = profile.lon;
    $("#seeing").value = 3; $("#transparency").value = 3; $("#rating").value = 4;
    $("#form-title").textContent = "Log an observation"; $("#save-btn").textContent = "Save observation"; $("#cancel-edit").classList.add("hidden");
    syncTarget();
  }
  resetForm();
  const qs = new URLSearchParams(location.search);
  if (qs.get("object")) sel.value = qs.get("object");
  if (qs.get("at")) $("#observedAt").value = fmt.localInput(qs.get("at"));
  syncTarget();
  $("#cancel-edit").onclick = resetForm;

  $("#log-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = {
      objectId: sel.value ? Number(sel.value) : null, targetName: $("#targetName").value || undefined,
      observedAt: new Date($("#observedAt").value).toISOString(), lat: Number($("#lat").value), lon: Number($("#lon").value),
      seeing: Number($("#seeing").value), transparency: Number($("#transparency").value), rating: Number($("#rating").value),
      equipment: $("#equipment").value, notes: $("#notes").value,
    };
    try {
      if (editing) { await api(`/observations/${editing}`, { method: "PUT", body }); toast("Observation updated, and your model was refit."); }
      else {
        const r = await api("/observations", { method: "POST", body });
        if (r.warning) toast(r.warning, true);
        else toast(r.learned ? "Saved. Your recommender learned from this rating." : "Saved. Pick a catalog object next time so it can train your recommender.");
      }
      resetForm(); load(); loadInsights();
    } catch (err) { showErrors(e.target, err); }
  });

  async function load() {
    const [{ observations }, s] = await Promise.all([api("/observations"), api("/observations/stats")]);
    const stat = (v, l) => h("div", { class: "card" }, h("div", { class: "stat" }, v), h("div", { class: "stat-label" }, l));
    clear($("#stats")).append(stat(s.total, "observations"), stat(s.distinct_objects, "distinct objects"),
      stat(s.avg_rating ? s.avg_rating.toFixed(1) : "—", "average rating"),
      stat(s.byType[0] ? fmt.type(s.byType[0].type) : "—", "most-logged type"));
    const list = clear($("#obs-list"));
    if (!observations.length) return list.append(h("p", { class: "empty" }, "No observations yet. Your first log starts training your recommender."));
    observations.forEach((o) => list.append(h("div", { class: "list-item" },
      h("div", { class: "row" }, h("strong", {}, o.targetName), o.objectType ? h("span", { class: "badge" }, fmt.type(o.objectType)) : h("span", { class: "badge" }, "custom"),
        h("span", { class: "stars small" }, fmt.stars(o.rating)), h("span", { class: "spacer" }), h("span", { class: "mono small muted" }, fmt.dateTime(o.observedAt))),
      h("div", { class: "small muted" }, `Seeing ${o.seeing}/5 · transparency ${o.transparency}/5${o.equipment ? " · " + o.equipment : ""}`),
      o.notes ? h("p", { class: "small", style: "margin-top:4px" }, o.notes) : null,
      h("div", { class: "row", style: "margin-top:8px" },
        h("button", { class: "btn ghost small", onclick: () => edit(o) }, "Edit"),
        h("button", { class: "btn danger small", onclick: () => remove(o) }, "Delete")))));
  }

  async function loadInsights() {
    const d = await api("/observations/insights");
    const box = clear($("#insights"));
    if (!d.byType.length) return box.append(h("p", { class: "empty" }, "Log a few observations to see patterns."));
    const block = (title, rows, label) => {
      box.append(h("h3", { style: "font-size:16px;margin-top:14px" }, title));
      rows.forEach((r) => box.append(h("div", { class: "hbar" }, h("span", {}, label(r)),
        h("div", { class: "track" }, h("span", { style: `left:0;width:${(r.avgRating / 5) * 100}%;background:var(--brass)` })),
        h("span", { class: "val" }, `${r.avgRating.toFixed(1)} · n=${r.n}`))));
    };
    block("By seeing (1 = poor, 5 = excellent)", d.bySeeing, (r) => `Seeing ${r.seeing}`);
    block("By transparency", d.byTransparency, (r) => `Transparency ${r.transparency}`);
    block("By kind of object", d.byType, (r) => (r.type === "other" ? "Custom targets" : fmt.type(r.type)));
    block("Most-observed targets", d.topTargets, (r) => r.target);
  }

  function edit(o) {
    editing = o.id; sel.value = o.objectId || ""; $("#targetName").value = o.objectId ? "" : o.targetName;
    $("#observedAt").value = fmt.localInput(o.observedAt); $("#lat").value = o.lat; $("#lon").value = o.lon;
    $("#seeing").value = o.seeing; $("#transparency").value = o.transparency; $("#rating").value = o.rating;
    $("#equipment").value = o.equipment; $("#notes").value = o.notes; syncTarget();
    $("#form-title").textContent = "Edit observation"; $("#save-btn").textContent = "Update"; $("#cancel-edit").classList.remove("hidden");
    $("#log-form").scrollIntoView({ behavior: "smooth", block: "start" });
  }
  async function remove(o) {
    if (!confirm(`Delete your observation of ${o.targetName}?`)) return;
    await api(`/observations/${o.id}`, { method: "DELETE" }); toast("Deleted. Your model was refit without it."); load(); loadInsights();
  }
  load();
  loadInsights();
})();
