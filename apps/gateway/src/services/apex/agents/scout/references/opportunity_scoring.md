# Opportunity Scoring
Score = volume_score * 0.3 + spread_score * 0.2 + time_score * 0.2 + edge_score * 0.3
- volume_score: log(volume_24h) / log(max_volume), capped at 1.0
- spread_score: 1 - (spread / 0.10), min 0
- time_score: 1 if hours_to_close > 1, 0.5 if < 1 hour, 0 if < 10 min
- edge_score: |0.5 - yes_price| / 0.5 (how far from 50/50)
Minimum score to report: 0.3
