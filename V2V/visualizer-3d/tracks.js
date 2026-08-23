export function buildVehicleTracks(frames) {
  const tracks = new Map();
  for (const frame of frames) {
    for (const update of frame.list) {
      if (!tracks.has(update.id)) tracks.set(update.id, []);
      tracks.get(update.id).push(update);
    }
  }
  return tracks;
}

export function sampleTrack(track, targetTime) {
  if (!track?.length || targetTime < track[0].t) return null;
  let low = 0;
  let high = track.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (track[middle].t <= targetTime) low = middle;
    else high = middle - 1;
  }
  const current = track[low];
  const next = track[Math.min(low + 1, track.length - 1)];
  const mix = current === next ? 0 : Math.max(0, Math.min(1, (targetTime - current.t) / (next.t - current.t)));
  return { current, next, mix, age: targetTime - current.t };
}
