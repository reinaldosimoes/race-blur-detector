# Race Blur Detector

A desktop app to quickly cull blurry photos from running race shoots. Built with Electron.

## What it does

- Scans a folder of JPEGs and scores each for sharpness
- **Center-weighted analysis** — prioritizes sharpness in the middle of the frame where runners typically are, so a sharp background with a blurry subject still gets flagged
- Visual grid with color-coded badges (sharp / borderline / blurry)
- Adjustable threshold slider to tune sensitivity to your shoot
- Filter and sort by sharpness score
- Select photos individually or bulk-select all blurry ones
- Moves selected photos to a `review_blurry/` subfolder (non-destructive)
- Double-click any photo for a full-size lightbox preview

## How it works

Uses the **Laplacian variance** method — sharp images have high variance (lots of edges), blurry images have low variance. The score is a weighted blend of the full-frame and center-crop analysis, so motion blur on runners gets caught even when the background is tack-sharp.

## Quick start

```bash
# Clone and install
git clone git@github.com:reinaldosimoes/race-blur-detector.git
cd race-blur-detector
npm install

# Run
npm start
```

Requires Node.js 18+ and npm.

## Building for distribution

```bash
# macOS .app
npm run dist

# Output will be in the dist/ folder
```

## Usage tips

- **Start with the default threshold (100)** and adjust based on your results
- Use **"Blurriest first"** sort to quickly review the worst offenders
- The **borderline** category (yellow) catches photos near the threshold — review these manually
- Photos are **moved, not deleted** — you can always move them back from the `review_blurry/` folder

## License

MIT
