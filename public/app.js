// Shared client code: API client, safe DOM builder, navigation, auth state, toasts.
(function () {
  // Theme (per-browser convenience only)
  try { const t = localStorage.getItem("almagest-theme"); if (t) document.documentElement.dataset.theme = t; } catch (e) {}

  async function api(path, { method = "GET", body } = {}) {
    const res = await fetch("/api" + path, {
      method, credentials: "same-origin",
      headers: body !== undefined ? { "Content-Type": "application/json" } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (res.status === 204) return null;
    let data = null;
    try { data = await res.json(); } catch (e) { /* non-JSON */ }
    if (!res.ok) {
      const err = new Error((data && data.error) || `Request failed (${res.status})`);
      err.status = res.status; err.details = data && data.details;
      throw err;
    }
    return data;
  }

  // h("div", {class: "x", onclick: fn}, "text", child, [children]) — text is always set via textContent.
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else if (k === "class") el.className = v;
      else if (k === "dataset") Object.assign(el.dataset, v);
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid === null || kid === undefined || kid === false) continue;
      el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }
  const $ = (s, root = document) => root.querySelector(s);
  const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };

  let toastTimer;
  function toast(msg, isErr) {
    let t = document.getElementById("toast");
    if (!t) { t = h("div", { id: "toast", role: "status" }); document.body.append(t); }
    t.textContent = msg; t.className = isErr ? "err" : ""; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3600);
  }

  let mePromise;
  function me() {
    if (!mePromise) mePromise = api("/auth/me").then((d) => d.user).catch(() => null);
    return mePromise;
  }
  async function requireLogin() {
    const u = await me();
    if (!u) { location.href = "login.html?next=" + encodeURIComponent(location.pathname.replace(/^\//, "")); throw new Error("redirect"); }
    return u;
  }

  const LINKS = [["index.html", "Tonight"], ["plan.html", "Plan"], ["catalog.html", "Catalog"], ["log.html", "Log"],
    ["events.html", "Events"], ["identify.html", "Identify"], ["orbits.html", "Orbits"], ["assistant.html", "Ask"]];
  const MARK = '<svg width="26" height="26" viewBox="0 0 26 26" fill="none" aria-hidden="true"><circle cx="13" cy="13" r="11.5" stroke="#C9A44C"/><circle cx="13" cy="13" r="1.6" fill="#C9A44C"/><path d="M13 1.5v4M13 20.5v4M1.5 13h4M20.5 13h4" stroke="#C9A44C"/></svg>';

  async function renderNav() {
    const host = document.getElementById("nav");
    if (!host) return;
    const page = location.pathname.split("/").pop() || "index.html";
    const brand = h("a", { class: "brand", href: "index.html" }); brand.innerHTML = MARK; brand.append(h("span", {}, "Almagest"));
    const right = h("div", { class: "nav-right" });
    const themeBtn = h("button", { class: "icon-btn", title: "Toggle light/dark", "aria-label": "Toggle theme", onclick: () => {
      const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
      document.documentElement.dataset.theme = next; try { localStorage.setItem("almagest-theme", next); } catch (e) {}
    } }, "☾ ☀");
    const nav = h("nav", { class: "nav" }, brand,
      h("button", { class: "icon-btn menu-toggle", "aria-label": "Menu", onclick: () => nav.classList.toggle("open") }, "☰"),
      h("ul", { class: "nav-links" }, LINKS.map(([href, label]) => h("li", {}, h("a", { href, class: page === href ? "active" : null }, label)))),
      right);
    host.replaceWith(nav);
    const u = await me();
    right.append(themeBtn);
    if (u) {
      right.append(h("a", { href: "profile.html", class: page === "profile.html" ? "badge brass" : "badge" }, u.displayName),
        h("button", { class: "icon-btn", onclick: async () => { await api("/auth/logout", { method: "POST" }); location.href = "index.html"; } }, "Sign out"));
    } else {
      right.append(h("a", { class: "btn small", href: "login.html?next=" + encodeURIComponent(page) }, "Sign in"));
    }
  }

  const fmt = {
    date: (d) => new Date(d).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }),
    time: (d) => new Date(d).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }),
    dateTime: (d) => new Date(d).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }),
    // value for <input type="datetime-local"> in the browser's local time
    localInput: (d) => { const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 16); },
    type: (t) => ({ galaxy: "Galaxy", nebula: "Nebula", globular_cluster: "Globular cluster", open_cluster: "Open cluster",
      planetary_nebula: "Planetary nebula", double_star: "Double star", planet: "Planet" })[t] || t,
    stars: (n) => "★".repeat(n) + "☆".repeat(5 - n),
  };

  // Show server-side validation errors next to inputs with matching name attributes.
  function showErrors(form, err) {
    form.querySelectorAll(".field-error,.form-error").forEach((e) => e.remove());
    const details = err.details || [];
    let placed = false;
    for (const d of details) {
      const input = form.querySelector(`[name="${d.field}"]`);
      if (input) { input.after(h("div", { class: "field-error" }, d.message)); placed = true; }
    }
    if (!placed) form.append(h("div", { class: "form-error" }, err.message));
  }

  window.Almagest = { api, h, $, clear, toast, me, requireLogin, fmt, showErrors };
  document.addEventListener("DOMContentLoaded", renderNav);
})();
