(async function () {
  const { api, h, $, clear, fmt, toast, showErrors } = window.Almagest;
  const user = await window.Almagest.me();
  const KINDS = [["", "All"], ["moon", "Moon"], ["planet", "Planets"], ["eclipse", "Eclipses"], ["meteor", "Meteors"]];
  let kind = "", sky = [];
  const chips = $("#kind-chips");
  KINDS.forEach(([k, l]) => chips.append(h("button", { class: "chip" + (k === "" ? " active" : ""), type: "button", dataset: { k }, onclick: () => {
    kind = k; chips.querySelectorAll(".chip").forEach((c) => c.classList.toggle("active", c.dataset.k === k)); renderSky(); } }, l)));

  const when = (d) => { const x = new Date(d); return h("div", { class: "when" }, h("b", {}, x.getDate()), x.toLocaleDateString(undefined, { month: "short" }).toUpperCase()); };
  function renderSky() {
    const box = clear($("#sky-events"));
    const list = sky.filter((e) => !kind || e.kind === kind);
    if (!list.length) return box.append(h("p", { class: "empty" }, "Nothing of this kind in the next 120 days."));
    list.forEach((e) => box.append(h("div", { class: "ev" }, when(e.date),
      h("div", {}, h("strong", {}, e.title), e.detail ? h("div", { class: "small muted" }, e.detail) : null),
      h("span", { class: "mono small faint" }, e.kind === "meteor" ? "night of" : fmt.time(e.date)))));
  }
  try { sky = (await api("/events/sky?days=120")).events; renderSky(); }
  catch (err) { clear($("#sky-events")).append(h("p", { class: "err" }, err.message)); }

  async function loadCommunity() {
    const { events } = await api("/events/community");
    const box = clear($("#community"));
    if (!events.length) box.append(h("p", { class: "empty" }, "No upcoming star parties yet." + (user ? " Host the first one." : "")));
    events.forEach((e) => {
      const rsvp = h("button", { class: e.going ? "btn small" : "btn ghost small", onclick: async () => {
        if (!user) return toast("Sign in to RSVP.", true);
        await api(`/events/community/${e.id}/rsvp`, { method: "POST" }); loadCommunity(); } }, e.going ? "Going ✓" : "I'm going");
      box.append(h("div", { class: "list-item" },
        h("strong", {}, e.title), h("div", { class: "small muted" }, `${fmt.dateTime(e.startsAt)} · ${e.locationName}`),
        h("div", { class: "small faint" }, `Hosted by ${e.host} · ${e.rsvps} going`),
        e.description ? h("p", { class: "small", style: "margin-top:4px" }, e.description) : null,
        h("div", { class: "row", style: "margin-top:8px" }, rsvp,
          e.mine ? h("button", { class: "btn danger small", onclick: async () => {
            if (!confirm("Cancel this event?")) return; await api(`/events/community/${e.id}`, { method: "DELETE" }); loadCommunity(); } }, "Cancel event") : null)));
    });
  }
  loadCommunity();

  if (user) {
    $("#host-card").classList.remove("hidden");
    $("#event-form").addEventListener("submit", async (ev) => {
      ev.preventDefault();
      try {
        await api("/events/community", { method: "POST", body: { title: $("#title").value, startsAt: $("#startsAt").value ? new Date($("#startsAt").value).toISOString() : "",
          locationName: $("#locationName").value, description: $("#description").value } });
        ev.target.reset(); toast("Star party posted."); loadCommunity();
      } catch (err) { showErrors(ev.target, err); }
    });
  }
})();
