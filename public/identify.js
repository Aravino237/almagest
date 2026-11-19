// Almagest Identify page: loads the trained MLP (model.json) and classifies an uploaded image locally.
(function () {
  const LABELS = {
    star_field: "Star field", spiral_galaxy: "Spiral galaxy", nebula: "Nebula",
    globular_cluster: "Globular cluster", planet_disc: "Planet / disc"
  };
  const drop = document.getElementById("drop"), file = document.getElementById("file");
  const canvas = document.getElementById("preview"), ctx = canvas.getContext("2d", { willReadFrequently: true });
  const result = document.getElementById("result"), samplesBox = document.getElementById("samples");
  let model = null;

  function el(tag, text, cls) { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; return e; }
  function say(text, cls) { result.replaceChildren(el("p", text, cls)); }

  async function loadModel() {
    try {
      const res = await fetch("model.json"); if (!res.ok) throw new Error("HTTP " + res.status);
      model = await res.json();
      const m = model.meta;
      document.getElementById("meta-note").textContent =
        `About this model: a small neural network (1024 → 128 → 64 → 5) trained on synthetic sky images generated from simple physical models ` +
        `(Plummer-sphere clusters, logarithmic-spiral galaxies, limb-darkened planets and so on). It scores ${(m.val_acc * 100).toFixed(1)}% on held-out synthetic images and ` +
        `${(m.shifted_acc * 100).toFixed(1)}% on a harder synthetic set with extra noise and blur. Real telescope photos look different from synthetic ones, ` +
        `so treat results on real photos as a demonstration, not a measurement. The model also always picks one of its 5 classes: it has no "none of these" option.`;
    } catch (e) {
      say("Couldn't load model.json. Open this page through a local server (VS Code Live Server), not by double-clicking the file.", "err");
    }
  }

  function classify() {
    if (!model) return;
    const pixels = AlmagestClassifier.preprocess(ctx.getImageData(0, 0, canvas.width, canvas.height));
    const ranked = AlmagestClassifier.predict(model, pixels);
    const rows = ranked.map((r, i) => {
      const row = el("div", undefined, "bar-row" + (i === 0 ? " top" : ""));
      const bar = el("div", undefined, "bar"), fill = document.createElement("span");
      fill.style.width = (r.p * 100).toFixed(1) + "%"; bar.append(fill);
      row.append(el("span", LABELS[r.label] || r.label, "lbl"), bar, el("span", (r.p * 100).toFixed(1) + "%", "pct"));
      return row;
    });
    const top = ranked[0];
    const verdict = top.p < 0.6
      ? "Low confidence. This image may not look like any of the 5 classes the model knows."
      : `Most likely: ${LABELS[top.label] || top.label}`;
    result.replaceChildren(el("p", verdict, undefined), ...rows);
    result.firstChild.style.cssText = "color:var(--text-hi); font-size:16px; margin-bottom:10px";
  }

  function drawAndClassify(img) {
    canvas.style.display = "block";
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, 256, 256);
    const s = Math.min(256 / img.width, 256 / img.height), w = img.width * s, h = img.height * s;
    ctx.drawImage(img, (256 - w) / 2, (256 - h) / 2, w, h);   // letterbox into a 256x256 square
    classify();
  }

  function loadFromUrl(url, revoke) {
    const img = new Image();
    img.onload = () => { drawAndClassify(img); if (revoke) URL.revokeObjectURL(url); };
    img.onerror = () => say("That file couldn't be read as an image.", "err");
    img.src = url;
  }
  function handleFile(f) { if (f && f.type.startsWith("image/")) loadFromUrl(URL.createObjectURL(f), true); else say("Please choose an image file.", "err"); }

  drop.addEventListener("click", () => file.click());
  drop.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); file.click(); } });
  file.addEventListener("change", () => handleFile(file.files[0]));
  ["dragenter", "dragover"].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", e => handleFile(e.dataTransfer.files[0]));

  ["star_field_1", "spiral_galaxy_1", "nebula_1", "globular_cluster_1", "planet_disc_1", "planet_disc_2"].forEach(name => {
    const b = el("button"); b.type = "button"; b.title = name.replace(/_\d$/, "").replace(/_/g, " ");
    const i = new Image(); i.src = "samples/" + name + ".png"; i.alt = b.title; b.append(i);
    b.addEventListener("click", () => loadFromUrl("samples/" + name + ".png", false));
    samplesBox.append(b);
  });

  loadModel();
})();
