# How the 2028 Campaign Simulator Works

This explains what `sim2028` (the "2028 Campaign Simulator" at `docs/sim2028.html`) actually does under the hood, in plain language. If you just want to know "can I trust this," "why does it show a range instead of a number," or "what's actually happening when I click Start," this is for you.

## The big idea

Most election forecasts show you one number: "Candidate X has a 70% chance." This tool instead lets you **live through an entire fictional campaign** — June through Election Day — and see how a forecast built on genuinely noisy information evolves over time, the same way a real forecaster (or an anxious voter refreshing polls) experiences it.

The trick that makes this work: the simulator secretly decides the *real* outcome on day one, but never shows it to you. Everything you see from June through the eve of the election is a simulated *poll* — noisy, sometimes misleading, always uncertain — of that hidden truth. Only on "election night" does the curtain drop and the real result get counted out, state by state.

Same seed (the random number in the setup card) always produces the exact same fictional election, so you can share a link and someone else sees the identical campaign play out.

## Step 1: Decide what "actually" happens (in secret)

Before you see a single poll, the simulator rolls the dice once to invent a real 2028 outcome. This uses real history as its starting point:

- **Every state starts at its 2024 result.** No trend projection, no "this state has been drifting right for 3 cycles so let's keep extrapolating" — just last election's number. The developers tested adding a trend and it made predictions *worse*: states that seemed to be drifting one way (Wisconsin, Michigan, Pennsylvania rightward; North Carolina, Georgia leftward) kept reversing course. A trend line would have called the wrong direction roughly half the time — a coin flip dressed up as insight.
- **A random shock nudges every state from there**, sized by that state's own historical volatility (how much it has actually moved cycle-to-cycle in the past) and by how "turbulent" this particular simulated election year happens to be. Some real years are calm — 2024 barely moved anyone. Some are seismic — 2016 reshuffled nearly 20 states. The simulator randomly picks which kind of year this is, so you don't get an artificially "average" cycle every time.
- **Nearby, similar states move together, not independently.** If Wisconsin shifts right, Michigan and Pennsylvania probably do too — they're demographically and economically similar, so whatever's driving the shift likely hits all three. The simulator groups states into political-geography regions for exactly this reason, and even overrides the obvious geographic grouping when the electoral behavior says otherwise (Pennsylvania is grouped with the Rust Belt, not the Mid-Atlantic, because it moves with Wisconsin and Michigan far more than with New York).
- **The national popular vote is chosen separately**, using whatever mode you picked in the setup card (a realistic random draw clustered around "close," a manual override like "D+3," last cycle's actual number, etc.). Whatever value gets picked is exactly what the election lands on — nothing fuzzes it further.
- **Home state gets a small, deliberate nudge**, covered in its own section below.

This whole hidden result is computed once, instantly, and then locked in. Everything else in the simulator is just *revealing* it slowly and imperfectly.

## Step 2: Simulate a campaign of noisy polls

This is the part that makes June feel different from November. Each month, what you see isn't the truth — it's a simulated poll of the truth, and it's wrong in two different ways at once:

1. **An early "mirage."** A single random bias gets picked at the start of the whole campaign — think of it as "the polls in this particular election happen to be a bit off in this particular direction." Crucially, its effect on what you see **shrinks every month**, because in June a big chunk of the electorate genuinely hasn't made up their mind, so a poll can only be as good as how settled people actually are. By November almost everyone's decided, so this effect mostly (not entirely — see below) fades away. This is why a state can plausibly show as red in June and blue in November without any pollster doing anything wrong — a large slice of voters simply hadn't picked a side yet.
2. **A fresh wobble every single month.** On top of the mirage, every monthly snapshot gets its own independent sampling noise — a brand new "poll" with its own margin of error, the same way a real poll never perfectly nails the electorate even with a great methodology. This noise never disappears, not even on Election Eve — there's always a small irreducible amount of "the poll could still be a couple points off," exactly like reality.

Both effects are also correlated the same way the hidden truth was — polling misses in Wisconsin tend to come with polling misses in Michigan and Pennsylvania, because whatever real-world blind spot causes one usually causes the others.

One more subtlety: a state's position *relative to the country* (e.g. "Texas leans 8 points redder than the nation") is treated as much more stable and well-understood than *which way the national mood is currently blowing*. That matches reality — nobody doubts in June that Florida leans red; what's genuinely unclear in June is who's winning nationally.

There's also an optional **"Nailbiter mode"**: after the true result is set, any race that's already naturally close gets squeezed even closer to a toss-up (blowouts are left alone) — for people who want a tense night without breaking the internal logic of a landslide year.

## Step 3: Forecast honestly from what's visible

At every step of the campaign, the forecast card (win probabilities, EV range, tipping-point state) is built **only from the simulated polls you can see — never from the hidden truth**. This is the same discipline a real forecaster has to follow: you can't peek at the answer key.

Technically, this is done by running **3,000 simulated alternate versions of "what if the polls are off by a plausible amount"** around the current poll numbers, using the same "similar states miss together" logic as before. In each of those 3,000 imagined universes, it tallies up who wins the electoral college, and:

- The **share of the 3,000 universes where a candidate wins** becomes their win probability.
- The spread of electoral-vote totals across those 3,000 becomes the 80%/90% range you see.
- For each universe, it finds the single state whose flip would have flipped the whole outcome — the **tipping-point state** — and reports whichever state plays that role most often. This mirrors how real forecasters (538, Silver Bulletin, etc.) talk about the "decisive" state, rather than treating all states as equally important.

The uncertainty in this forecast shrinks as the campaign goes on (more of the mirage bias has faded, so the polls are more trustworthy) but is deliberately never allowed to collapse to false certainty on a genuinely close race — a "Confident forecasts" toggle exists for people who'd rather see the older, narrower, more decisive-looking numbers instead of the wider, research-calibrated defaults.

The polling-error assumptions aren't arbitrary — they're tuned to match real published research on how wrong American polls actually were in 2016, 2020, and 2024 (national error of a couple points in a clean year, more like 4-5 points in a foggy one), and a dev script (`calibrate.mjs`) exists purely to stress-test the simulator against those real benchmarks across thousands of runs.

## Home state advantage: real, but modest

If you give a candidate a home state, they get a small boost there — but the model is deliberately conservative about this, because the actual research on "favorite son" effects (does a running mate or nominee's home state genuinely swing for them?) mostly finds very little measurable effect. Real crossover appeal does exist (a popular governor outrunning their party at home), but that's a different, more local phenomenon than a maximally nationalized presidential race, so it doesn't translate cleanly.

Practically:
- You choose a "Home state realism" level — Off, Subtle, Noticeable, or Wacky — which caps how big the boost can possibly be.
- The boost is scaled down further by how "locked-in" that particular state's electorate is historically. A state that barely moves for anyone (like a very safe state) barely moves even at "Wacky." A more persuadable state can move more.
- The boost always reshapes the map without secretly tilting the overall national number — if one state gets nudged blue, the map re-balances so nothing sneaks in a hidden national advantage.

Note that the choice of candidate is otherwise **cosmetic** — it changes the name and portrait you see, not the math, except through this one narrow home-state channel.

## Election night: the reveal

Once you click through to election night, the simulator hands its hidden true result off to the site's shared election-night engine — the same engine used for real historical years elsewhere on the site. It manufactures realistic-looking vote counts that add up to the intended result, and then plays the count out state-by-state, complete with call timing, a call log, and pundit commentary, exactly like watching a real election night unfold — except this time, you already lived through the campaign that led here.

## In one paragraph

The simulator measures how much each state has historically moved and how tightly it tracks the national mood, uses that to invent one hidden "true" outcome for a fictional 2028 election, then spends June through November showing you increasingly-accurate-but-never-perfect simulated polls of that hidden truth — polls that start out clouded by undecided voters and stay a little noisy even at the very end. At every point along the way, the forecast you see is built honestly from those noisy polls alone, using thousands of simulated what-ifs to produce win probabilities and a most-likely tipping-point state. Then election night reveals what was true all along.
