# Galaxy morphology model (GPU training)

Fine-tunes a pretrained CNN on **Galaxy10 DECaLS**: 17,736 real galaxy images from the DESI Legacy Imaging Surveys, labelled by Galaxy Zoo volunteers into 10 morphology classes. Trained results are exported to ONNX and served by Almagest's Identify page.

## Windows + NVIDIA GPU, step by step

Open **PowerShell** (not the Mac terminal) in the `ml-galaxy` folder.

1. **Check the GPU is visible:** `nvidia-smi` should list your RTX card. If the command isn't found, install the latest NVIDIA driver first.
2. **Python 3.10–3.12:** `python --version`. Install from python.org if needed (tick "Add to PATH").
3. **Make an environment:**
   ```powershell
   python -m venv .venv
   .venv\Scripts\activate
   ```
4. **Install PyTorch with CUDA.** Go to https://pytorch.org, choose *Stable · Windows · Pip · Python · CUDA*, and run the command it shows. It looks like `pip install torch torchvision --index-url https://download.pytorch.org/whl/cu1xx`.
5. **Install the rest:** `pip install -r requirements.txt`
6. **Check PyTorch sees the GPU:**
   ```powershell
   python -c "import torch; print(torch.cuda.is_available(), torch.cuda.get_device_name(0))"
   ```
   It must print `True` and your card's name. If it prints `False`, step 4 installed the CPU build: uninstall torch and redo step 4 with the CUDA command.
7. **Download the dataset (2.5 GB):** `python download.py`. It checks the SHA-256 checksum, and you can re-run it if it stops.
8. **Train:** `python train.py`
   - It prints one line per epoch. Lines ending in `*best` are new best validation scores.
   - If you get `CUDA out of memory`, run `python train.py --batch 32`.
   - For a quick test first, run `python train.py --limit 2000 --epochs 3`.
9. **Result:** at the end it prints the **test accuracy and macro-F1 on images held out from training**, writes `runs/latest/results.json`, `confusion.png` and `curves.png`, and saves `galaxy10.onnx` + `galaxy10.json` into `../models/`.

## Use it in Almagest

On the machine that runs the Almagest server, `models/galaxy10.onnx` and `models/galaxy10.json` must exist (copy them across if you trained on another computer), then:

```bash
npm install onnxruntime-node     # only needed if the Identify card says it isn't installed
npm start
```

Open **Identify**: the *Galaxy morphology* card switches on and shows the model's measured test accuracy.

## Why it's built this way

- **Pretrained start (ImageNet weights).** Fine-tuning usually beats training from scratch on a dataset this size. Use `--no-pretrained` if you're offline.
- **Rotation / flip / scale augmentation.** Galaxies have no "up", so the model is shown them at random angles.
- **Honest evaluation.** The test set is used once, at the end. Class weights and macro-F1 are used because "Cigar smooth" has only 334 images.
- **Temperature scaling** is fitted on the validation set, so a reported "80%" should be right about 80% of the time (see the `ece` value in `results.json`).
- **Test-time augmentation** averages predictions over 8 rotations/flips.

## Limits to state in your report

- It only knows 10 galaxy types and will label anything, including non-galaxies.
- It was trained on DESI Legacy Survey cutouts. Amateur photos from other cameras and processing may do worse, and that isn't measured here.
- Galaxy Zoo labels come from volunteer votes, so some are genuinely ambiguous, and that limits the achievable accuracy.
- `make_fake_data.py` only exists to smoke-test the code without the download. Its images are not galaxies.
