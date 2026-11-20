[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Ajwyunsx/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Ajwyunsx/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

# Token Launch Radar

A token-launch radar over DefiLlama's protocol record — a [make.fun](https://make.fun) bounty entry. It reads the house's sealed snapshot (`/input/snapshot.json`, 758 protocols, 40 on the no-token watchlist), models what each protocol's token would be worth at its current record, ranks 198 protocols by implied value with concrete farm steps per row, and ships a static dashboard that renders with no network.

## How it works

- `main.ts` (Node 22) reads the snapshot, scores every protocol (TVL scale, 7d momentum, category multipliers, mcap/TVL comps from protocols that already trade), writes `board.json`, and builds the dossier.
- `lib/model.ts` — the implied-value model and ranking.
- `dashboard/` — the board, a detail view per protocol, and filters. Static files, offline.

## Run

```
node main.ts   # grader: reads /input/snapshot.json, writes /output
```

## License

MIT
