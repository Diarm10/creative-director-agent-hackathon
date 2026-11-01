# Demo assets

This folder holds the photos used in the demo.

- `mug.jpg` is the one bundled photo: a plain navy mug on a desk, used for the **Try the mug example** link on the page and for `--job=mug` in `scripts/live-run.ts`. Its EXIF metadata has been removed. It was cropped to the mug and the plain background so that no logo or brand name is visible. A thin unmarked dark edge of a desk item is still visible at the far right, next to the rim.

Rules for any other photo you add here:

- Only photos you took yourself, of a product you own or have the right to use. Nothing taken from the web.
- Remove location and camera data before you commit or share anything: `npm run strip-exif` cleans every image in this folder in place, and `npm run strip-exif -- --check` only reports which images still carry metadata.
- The web page also shrinks each uploaded photo and drops its metadata in the browser before it is sent, but strip the files here too.

Image files here are ignored by git on purpose (see `.gitignore`), so a photo cannot be committed by accident. `README.md` and `mug.jpg` are the allowed exceptions; to allow another file, add a `!demo-assets/<name>` line to `.gitignore` yourself.

To try the product flow without any photo, run `npm run placeholder`. It draws a generic earbuds charging case illustration to `tmp/placeholder-product.jpg`. It is an illustration made by a script, not a photo of any real product.

`catalogue/` holds the 12 sample images for Catalogue mode with `catalogue.csv`. They are illustrations drawn by `scripts/make-demo-assets.ts` (see `catalogue/CREDITS.md`), not photographs. Only the top level of this folder is covered by the image ignore rules above, so that folder is committed.
