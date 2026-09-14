# THE COFFEE MILK

A five-round browser game. Match the target coffee/milk color and fill each vessel as close to the edge as possible without overflowing.

## Run
Open `index.html` directly, or host the folder with GitHub Pages.

## Core rules
- Five rounds: beaker, straight glass, test tube, cocktail glass, blind cup.
- Target coffee ratio is randomly selected from 10% to 90% each round.
- COFFEE and MILK can each be held once per round. Releasing a button consumes that pour.
- Physical pour rate is identical for every vessel. Smaller capacities therefore fill faster.
- Round score = nonlinear color score × nonlinear volume score, maximum 5,000.
- Overflow = 0 points for the round.
- Maximum final score = 25,000.
- The final blind cup hides the liquid; the rising warning tone near full is the main cue.

## Assets
The five vessel SVGs in `assets/` are the supplied game assets and are displayed without redrawing their appearance.
