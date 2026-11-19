(function () {
  const { api, $, showErrors } = window.Almagest;
  const params = new URLSearchParams(location.search);
  const next = (params.get("next") || "index.html").replace(/[^a-z.\-]/gi, "") || "index.html";
  let mode = params.get("mode") === "signup" ? "signup" : "login";

  function setMode(m) {
    mode = m;
    $("#tab-login").classList.toggle("active", m === "login");
    $("#tab-signup").classList.toggle("active", m === "signup");
    $("#name-wrap").classList.toggle("hidden", m === "login");
    $("#pw-hint").hidden = m === "login";
    $("#auth-title").textContent = m === "login" ? "Welcome back" : "Join Almagest";
    $("#auth-submit").textContent = m === "login" ? "Sign in" : "Create account";
    $("#password").autocomplete = m === "login" ? "current-password" : "new-password";
  }
  $("#tab-login").onclick = () => setMode("login");
  $("#tab-signup").onclick = () => setMode("signup");
  setMode(mode);

  $("#auth-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target, btn = $("#auth-submit");
    const body = { email: $("#email").value, password: $("#password").value };
    if (mode === "signup") body.displayName = $("#displayName").value;
    btn.disabled = true;
    try {
      await api(mode === "login" ? "/auth/login" : "/auth/signup", { method: "POST", body });
      location.href = mode === "signup" ? "profile.html?welcome=1" : next;
    } catch (err) { showErrors(form, err); }
    finally { btn.disabled = false; }
  });
})();
