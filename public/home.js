(async function () {
  const { api, h, $, clear, fmt } = window.Almagest;
  const user = await window.Almagest.me();
  $(user ? "#user-head" : "#guest-hero").classList.remove("hidden");

  if (user) {
    const hr = new Date().getHours();
    $("#greet").textContent = `${hr < 12 ? "Good morning" : hr < 17 ? "Good afternoon" : "Good evening"}, ${user.displayName}`;
  }

  api("/tonight").then((t) => {
    if (user) $("#greet-sub").textContent = `Sky conditions for ${t.location}.`;
    const stat = (v, l) => h("div", { class: "card" }, h("div", { class: "stat" }, v), h("div", { class: "stat-label" }, l));
    clear($("#sky-stats")).append(
      stat(`${t.moon.illuminationPct}%`, `Moon · ${t.moon.phaseName}`),
      stat(t.sunAlt <= -18 ? "Dark now" : t.dusk ? fmt.time(t.dusk) : "—", t.sunAlt <= -18 ? "astronomical night" : "darkness begins"),
      stat(t.dawn ? fmt.time(t.dawn) : "—", "darkness ends"),
      stat(`${t.moon.alt > 0 ? "Up" : "Down"}`, `Moon ${t.moon.alt > 0 ? "above" : "below"} horizon (${Math.round(t.moon.alt)}°)`));
  }).catch(() => {});

  api("/plan", { method: "POST", body: {} }).then((p) => {
    const box = clear($("#picks"));
    if (p.note) box.append(h("p", { class: "small muted" }, p.note));
    if (!p.recommendations.length) return box.append(h("p", { class: "empty" }, "Nothing above your horizon clears your limits right now."));
    p.recommendations.slice(0, 4).forEach((r) => box.append(h("div", { class: "list-item" },
      h("div", { class: "row" }, h("strong", {}, r.name), h("span", { class: "badge" }, fmt.type(r.type)), r.explore ? h("span", { class: "badge explore" }, "explore") : null,
        h("span", { class: "spacer" }), h("span", { class: "mono small muted" }, `${Math.round(r.score * 100)}%`)),
      h("div", { class: "small muted" }, r.reasons[0] ? r.reasons[0].text : ""))));
    box.append(h("p", { class: "small faint", style: "margin-top:10px" },
      p.model.personalised ? `Personalised from ${p.model.userExamples} of your ratings and logs.` : user ? "Rate a few picks on the Plan page and these will start to adapt to you." : "Sign in to get picks that adapt to you."));
  }).catch((e) => { clear($("#picks")).append(h("p", { class: "err" }, e.message)); });

  api("/events/sky?days=45").then((d) => {
    const box = clear($("#upcoming"));
    d.events.filter((e) => new Date(e.date) > new Date()).slice(0, 5).forEach((e) => box.append(h("div", { class: "list-item" },
      h("div", { class: "row" }, h("strong", {}, e.title), h("span", { class: "spacer" }), h("span", { class: "mono small muted" }, fmt.date(e.date))),
      e.detail ? h("div", { class: "small muted" }, e.detail) : null)));
  }).catch(() => {});

  if (user) {
    const s = await api("/observations/stats");
    $("#my-stats-card").classList.remove("hidden");
    const stat = (v, l) => h("div", {}, h("div", { class: "stat" }, v), h("div", { class: "stat-label" }, l));
    clear($("#my-stats")).append(stat(s.total, "observations"), stat(s.distinct_objects, "distinct objects"),
      stat(s.avg_rating ? s.avg_rating.toFixed(1) : "—", "average rating"), stat(s.last_session ? fmt.date(s.last_session) : "—", "last session"));
  }
})();
