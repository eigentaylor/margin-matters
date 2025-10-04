# Quick test & dependency-graph instructions

Run these commands from the repository root (PowerShell):


## Install Node dependencies

npm install


## Install Playwright browsers (required once)

npm run playwright:install


## Unit tests (Jest)

npm run test:unit


## Run Playwright UI screenshot test

npm run test:ui


## Generate dependency graphs for inspection

npm run madge:tester
npm run madge:election-night
npm run depcruise:tester
npm run depcruise:election-night


Notes:

- Playwright will create screenshots/snapshots under tests/playwright/. The first run will establish golden images.
- madge will output PNGs to docs/ (docs/madge-tester.png, docs/madge-election-night.png).
- depcruise outputs dot files to docs/ which you can render with Graphviz:
  dot -Tpng docs/depcruise-tester.dot -o docs/depcruise-tester.png
  dot -Tpng docs/depcruise-election-night.dot -o docs/depcruise-election-night.png

If npm is not found in your PATH, ensure Node.js is installed and available to PowerShell.
