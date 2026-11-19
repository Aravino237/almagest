(function () {
  const { api, h, $, clear, toast } = window.Almagest;
  const chat = $("#chat"), form = $("#ask-form"), input = $("#q");
  const SUGGEST = ["What should I observe tonight?", "Is Saturn visible now?", "Tell me about the Orion Nebula", "How bright is the Moon?", "Upcoming meteor showers", "When does it get dark?", "What do I like to observe?"];
  const tz = -new Date().getTimezoneOffset();

  function bubble(who, text, meta) {
    const b = h("div", { class: "msg " + who }, h("div", { class: "bubble" }, ...String(text).split("\n").flatMap((l, i) => (i ? [h("br"), l] : [l]))));
    if (meta) b.append(h("div", { class: "meta small faint" }, meta));
    chat.append(b); chat.scrollTop = chat.scrollHeight; return b;
  }
  async function ask(text) {
    bubble("me", text);
    const wait = bubble("bot", "Computing…");
    try {
      const r = await api("/assistant", { method: "POST", body: { message: text, tzOffsetMin: tz } });
      wait.remove();
      const tools = r.tools && r.tools.length ? "tools: " + r.tools.join(", ") + " · " : "";
      bubble("bot", r.answer, `${tools}intent: ${r.intent} (${r.confidence})${r.via === "retrieval" ? " · catalog retrieval" : ""}`);
    } catch (e) { wait.remove(); bubble("bot", "Sorry, that failed: " + e.message); }
  }
  clear($("#chips")).append(...SUGGEST.map((s) => h("button", { class: "btn ghost small", type: "button", onclick: () => ask(s) }, s)));
  form.onsubmit = (e) => { e.preventDefault(); const t = input.value.trim(); if (!t) return; input.value = ""; ask(t); };
  bubble("bot", "Hello, I'm Almagest. Ask me about tonight's sky, a catalog object, the Moon, upcoming events, or your own logbook.");
})();
