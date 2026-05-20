function matchChannels(missionText, goalText, channels) {
  const STOP_WORDS = new Set(['the','and','to','a','i','my','of','in','for','on','with','is','are','we','that','this','an','it','be','at','by','or','from','but','not','as','up','so','if','do','go','get','you','your','our','their','have','has','been','was','will','can','all','one','two','how','why','what','when','who','more','into']);

  const text = (missionText + ' ' + goalText).toLowerCase();
  const tokens = new Set(
    text.split(/\W+/).filter(w => w.length > 2 && !STOP_WORDS.has(w))
  );

  const scored = channels.map(ch => {
    const tags = ch.tags || [];
    const score = tags.filter(t => tokens.has(t)).length;
    return { ...ch, score, suggested: false };
  });

  scored.sort((a, b) => b.score - a.score);

  let suggestedCount = 0;
  for (const ch of scored) {
    if (ch.score > 0 && suggestedCount < 2) {
      ch.suggested = true;
      suggestedCount++;
    }
  }

  return scored;
}
