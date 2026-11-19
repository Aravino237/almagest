// Two sets: DEV (used while tuning the training phrases, so optimistic) and FRESH (written afterwards, never tuned on).
// Held-out intent accuracy for the Ask Almagest classifier. The test questions are NOT in src/ai/intents.js.
// Caveat: written by the project author, so it measures coverage of intended phrasings, not real-user diversity.
const { classify } = require("../src/ai/assistant");
const T = {
  plan: ["what are the best things to see tonight", "recommend targets for my telescope", "suggest an observing plan for this evening", "what should I look at after dark", "plan a stargazing night for me", "good objects to view right now", "what do you recommend observing", "help me choose targets"],
  position: ["where is saturn in the sky", "is jupiter visible now", "how high is m42 at the moment", "when can I spot mars", "is the pleiades above the horizon", "what altitude is venus", "can I see the whirlpool galaxy tonight", "which direction should I look for andromeda"],
  moon: ["how full is the moon", "what is tonight's moon phase", "will the moon interfere with faint targets", "how much moonlight is there", "is the moon up now", "current lunar illumination", "should I worry about the moon", "moon brightness today"],
  events: ["when is the next meteor shower", "any eclipses coming up", "what is the next planetary opposition", "list upcoming astronomical events", "date of next lunar eclipse", "events in the sky this month", "is a meteor shower coming", "upcoming celestial happenings"],
  dark: ["what time does it get dark tonight", "when does astronomical night begin", "when does twilight end", "when is the sky fully dark", "what time is dawn", "how many hours of darkness do I have", "when can I start observing after sunset", "when does night end"],
  about: ["what is the crab nebula", "explain globular clusters", "tell me about the ring nebula", "what are open clusters", "describe the sombrero galaxy", "how far is the orion nebula", "who wrote the almagest", "what is a planetary nebula"],
  stats: ["how many nights have I observed", "summarise my logbook", "what is in my observation log", "my observing numbers", "how many things have I logged", "which targets did I observe most", "show my log statistics", "total observations I made"],
  affinity: ["what do I like to observe", "what has almagest learned about my taste", "which object types do I rate highly", "why does the model favour certain objects", "what does the model know about me", "my favourite kinds of targets", "how personal are my picks", "which types do I prefer"],
  help: ["hi", "hello there", "what can you help me with", "how does this assistant work", "help me", "who are you", "what can I ask", "hey almagest"],
};
const FRESH = {
  plan: ["which targets would suit tonight's sky", "I have a small scope, what should I try first", "make me an observing list", "anything good to look at this evening"],
  position: ["is neptune above my horizon", "how far up is the andromeda galaxy right now", "where should I aim to find saturn", "can the hercules cluster be seen at this hour"],
  moon: ["is the moon bright tonight", "what does the moon look like now", "how lit is the moon", "does moonlight matter for observing today"],
  events: ["are there any meteor showers this month", "when will the next lunar eclipse happen", "what's the next big sky event", "upcoming opposition dates"],
  dark: ["when will it be properly dark", "what time does astronomical twilight finish", "how long is the night tonight", "at what time does dawn break"],
  about: ["what exactly is a globular cluster", "give me some facts about the pinwheel galaxy", "what is the beehive cluster", "why is it called the almagest"],
  stats: ["how many observations are in my log", "what have I logged so far", "give me my observing stats", "what do I observe most"],
  affinity: ["which kinds of objects does the model think I like", "what have my ratings taught the recommender", "do I prefer nebulae or galaxies", "how has my profile been learned"],
  help: ["hello almagest", "what are you able to do", "can you help me", "how do I use this"],
};
function run(name, set) {
  let ok = 0, n = 0; const miss = [];
  for (const [intent, qs] of Object.entries(set)) for (const q of qs) { const r = classify(q); n++; if (r.intent === intent) ok++; else miss.push(`  "${q}" -> ${r.intent} (${r.confidence}), expected ${intent}`); }
  console.log(`${name} intent accuracy: ${ok}/${n} = ${(100 * ok / n).toFixed(1)}%`);
  if (miss.length) console.log(miss.join("\n"));
  return { ok, n };
}
run("DEV  ", T);
const r = run("FRESH", FRESH);
module.exports = { T, FRESH };
