# Almagest: 6-minute demo script

**Before you start:** open the deployed URL 5 minutes earlier (cold start), sign in as `demo@almagest.dev` / `DemoPass123` in one tab, keep a signed-out tab ready, and have the IEEE paper open.

| Min | Show | Say |
|---|---|---|
| 0:00 | **Tonight** page | "Almagest is a portal for astronomy enthusiasts. Positions come from the VSOP87 theory through astronomy-engine, not from a lookup table." |
| 0:45 | **Plan** (signed in) | "Physics first: altitude, limiting magnitude from Bortle and aperture, darkness. Then a logistic model ranks what survives. Each pick has reasons that follow the learned weights." Point at the 👍/👎 and say it retrains instantly. |
| 1:45 | **Log** → add one observation | "Observations go to MongoDB (documents with evolving fields). Users, profiles, catalog and model weights are in PostgreSQL. A rated log is also a training example." |
| 2:30 | **Plan** again | "Compare with a signed-out tab: this demo user rates galaxies low under Bortle 6, so they rank lower for them. That is the per-user offset on top of shared weights." |
| 3:15 | **Ask** page (the AI part) | Ask, in order: "What should I observe tonight?", "Is Saturn visible now?", "When does it get dark?", "What do I like to observe?", then "qwzx vbnm". |
| 4:30 | Point at the grey line under each answer | "Each answer lists the tools that produced it. The assistant classifies intent with TF-IDF, extracts the object, and calls the real ephemeris or recommender. It cannot invent numbers, and it refuses gibberish instead of guessing." |
| 5:15 | `/api/health`, then Render dashboard | "Express on Render, PostgreSQL on Neon, MongoDB on Atlas. It auto-migrates on boot. 33 automated tests." |
| 5:45 | Paper | "The IEEE paper reports the ablation: physics filter and hierarchical model each add measurable precision; astropy agreement is within arcseconds." |

## The AI components, honestly
1. **Recommender**: a hierarchical logistic regression (global weights plus per-user offset), trained online by SGD, with a UCB-style exploration slot. This is the core ML.
2. **Ask Almagest**: a grounded assistant, not an LLM. TF-IDF nearest-centroid intent classifier (9 intents), entity extraction over the catalog, tool routing. Held-out accuracy: run `node scripts/eval-intents.js`. The FRESH set (written after tuning) is the honest number; the DEV set is optimistic.

## Likely questions
- **"Is this a real AI?"** The recommender learns from user data. The assistant is a retrieval-and-tool-routing system by design, so answers are verifiable. An LLM could replace the classifier later; the tools stay the same.
- **"Why not ChatGPT/an LLM API?"** Hallucinated sky positions are worse than none; a grounded system is testable (see `test/assistant.test.js`), free to run, and needs no key.
- **"Why two databases?"** Relational constraints for users, catalog and model weights; flexible documents for the logbook. Honest trade-off: no cross-database transaction, so a failure between the Mongo write and the Postgres update is not rolled back (paper, limitations).
- **"How do you know the astronomy is right?"** Compared with astropy on 500 cases: median errors of a few arcseconds (paper, Table on accuracy).
- **"How does it scale?"** Plan computation is about 5 ms; the bottleneck would be the single Node process and the free-tier databases.
- **"What is the cold-start problem?"** New users get the shared global model plus the prior; personalisation starts after the first few ratings.
- **"What are the weaknesses?"** Evaluation is on simulated users (paper, limitations); the intent test set is author-written; the free tier sleeps.
