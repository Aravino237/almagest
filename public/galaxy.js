(async function () {
  const { api, h, $, clear } = window.Almagest;
  let st;
  try { st = await api("/galaxy/status"); } catch (e) { $("#galaxy-status").textContent = "Couldn't reach the server."; return; }
  if (!st.available) {
    $("#galaxy-status").textContent = "The galaxy model isn't installed yet. Train it on a GPU with ml-galaxy/train.py (see the README), restart the server, and this card will switch on.";
    return;
  }
  $("#galaxy-status").textContent = `${st.arch} fine-tuned on ${st.dataset} (real galaxy photos). Classifies into 10 morphology classes, running on the server.`;
  $("#galaxy-body").classList.remove("hidden");
  $("#g-note").textContent = `Held-out test accuracy ${(st.testAccuracy * 100).toFixed(1)}% and macro-F1 ${(st.testMacroF1 * 100).toFixed(1)}% on ${st.nTest} images the model never trained on (calibration error ${(st.ece * 100).toFixed(1)}%). `
    + "These are measured on DESI Legacy Survey cutouts. Photos from other telescopes, cameras or processing can look different and may do worse. The model only knows these 10 galaxy types, so it will label anything you give it, even a non-galaxy.";

  const drop = $("#g-drop"), file = $("#g-file"), canvas = $("#g-preview"), out = $("#g-result");
  const S = st.size, c2 = document.createElement("canvas"); c2.width = c2.height = S;
  const g2 = c2.getContext("2d", { willReadFrequently: true });
  drop.onclick = () => file.click();
  drop.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") file.click(); };
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("over"); };
  drop.ondragleave = () => drop.classList.remove("over");
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove("over"); if (e.dataTransfer.files[0]) run(e.dataTransfer.files[0]); };
  file.onchange = () => file.files[0] && run(file.files[0]);

  function toBase64(bytes) { let s = ""; for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192)); return btoa(s); }

  async function run(f) {
    clear(out).append(h("p", { class: "muted" }, "Classifying…"));
    const url = URL.createObjectURL(f);
    try {
      const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error("That file isn't an image the browser can read.")); i.src = url; });
      // centre-crop to a square, then scale to the model's input size
      const side = Math.min(img.width, img.height), sx = (img.width - side) / 2, sy = (img.height - side) / 2;
      canvas.style.display = "block"; canvas.getContext("2d").drawImage(img, sx, sy, side, side, 0, 0, 256, 256);
      g2.imageSmoothingQuality = "high"; g2.drawImage(img, sx, sy, side, side, 0, 0, S, S);
      const rgba = g2.getImageData(0, 0, S, S).data, rgb = new Uint8Array(S * S * 3);
      for (let i = 0; i < S * S; i++) { rgb[i * 3] = rgba[i * 4]; rgb[i * 3 + 1] = rgba[i * 4 + 1]; rgb[i * 3 + 2] = rgba[i * 4 + 2]; }
      const { predictions } = await api("/galaxy/classify", { method: "POST", body: { pixels: toBase64(rgb) } });
      clear(out);
      const top = predictions[0];
      out.append(h("p", {}, top.probability < 0.5 ? "Uncertain. Best guess: " : "Most likely: ", h("strong", {}, top.label)));
      predictions.slice(0, 5).forEach((p, i) => out.append(h("div", { class: "bar-row" + (i === 0 ? " top" : "") },
        h("span", { class: "lbl" }, p.label), h("div", { class: "bar" }, h("span", { style: `width:${(p.probability * 100).toFixed(1)}%` })),
        h("span", { class: "pct" }, (p.probability * 100).toFixed(1) + "%"))));
    } catch (e) { clear(out).append(h("p", { class: "err" }, e.message)); }
    finally { URL.revokeObjectURL(url); }
  }
})();
