// Functions injected into the Substack tab with chrome.scripting.executeScript.
// Each one must be fully self-contained (no references to outer scope), because
// Chrome serializes the function source and runs it inside the page.
// Running in the page means requests carry the reader's Substack session, so
// paid/subscriber-only videos work as long as you can watch them.

/** Finds the videos on the current page; the current note/post's own video comes first. */
async function pageFindVideos() {
  const origin = location.origin;
  const found = new Map();
  const add = (id, info) => {
    if (!id) return;
    const prev = found.get(id) || {};
    found.set(id, { ...prev, ...info, id, primary: prev.primary || info.primary || false });
  };
  const firstLine = (text) =>
    (text || "").split("\n").map((s) => s.trim()).find(Boolean)?.slice(0, 80) || "";

  // 1. Notes: ask Substack's API which video is attached to this exact note.
  const noteMatch = location.pathname.match(/\/note\/c-(\d+)/);
  if (noteMatch) {
    try {
      const res = await fetch(`${origin}/api/v1/reader/comment/${noteMatch[1]}`);
      if (res.ok) {
        const data = await res.json();
        const c = data?.item?.comment;
        for (const a of c?.attachments || []) {
          const mu = a.mediaUpload || {};
          const id = a.media_upload_id || mu.id;
          if (a.type === "video" || mu.media_type === "video") {
            add(id, {
              primary: true,
              title: [c.name || c.handle, firstLine(c.body)].filter(Boolean).join(" - ") || `note-${noteMatch[1]}`,
              duration: mu.duration,
              width: mu.width,
              height: mu.height,
              thumb: mu.thumbnail_url
            });
          }
        }
      }
    } catch (e) { /* fall back to the DOM below */ }
  }

  // 2. Every Substack video player on the page.
  const pageTitle =
    document.querySelector("h1.post-title, h1")?.textContent?.trim() ||
    document.title.replace(/\s*\|\s*Substack\s*$/i, "").trim();
  const domIds = [];
  document.querySelectorAll("video").forEach((v) => {
    let id = v.dataset.videoId;
    if (!id) {
      const srcs = [v.currentSrc, v.src, ...[...v.querySelectorAll("source")].map((s) => s.src)];
      for (const s of srcs) {
        const m = (s || "").match(/\/video\/upload\/([0-9a-f-]{36})\//i);
        if (m) { id = m[1]; break; }
      }
    }
    if (id && !domIds.includes(id)) domIds.push(id);
  });

  // On a /p/ post the first player belongs to the post itself.
  const isPost = /\/p\//.test(location.pathname);
  for (const [i, id] of domIds.entries()) {
    if (!found.has(id)) {
      add(id, {
        primary: !noteMatch && isPost && i === 0,
        title: domIds.length > 1 ? `${pageTitle} (${i + 1})` : pageTitle
      });
    }
  }

  // 3. Fill in missing metadata (duration / resolution / thumbnail).
  await Promise.all(
    [...found.values()].filter((v) => v.duration == null).slice(0, 12).map(async (v) => {
      try {
        const r = await fetch(`${origin}/api/v1/video/upload/${v.id}`);
        if (!r.ok) return;
        const m = await r.json();
        Object.assign(v, { duration: m.duration, width: m.width, height: m.height, thumb: m.thumbnail_url });
      } catch (e) {}
    })
  );

  const list = [...found.values()];
  list.sort((a, b) => Number(b.primary) - Number(a.primary));
  // If nothing was flagged primary but there's only one video, it's the one.
  if (list.length === 1) list[0].primary = true;
  return { origin, url: location.href, videos: list };
}

/** Downloads the closed-caption track for a video and returns merged cues. */
async function pageFetchCaptions(videoId) {
  const origin = location.origin;
  const master = await fetch(`${origin}/api/v1/video/upload/${videoId}/src?type=hls`);
  if (!master.ok) throw new Error(`Couldn't load the video stream (HTTP ${master.status})`);
  const masterUrl = master.url;
  const masterText = await master.text();

  // Pick a subtitle track: DEFAULT=YES, then English, then the first one.
  const tracks = masterText
    .split("\n")
    .filter((l) => l.startsWith("#EXT-X-MEDIA:") && /TYPE=SUBTITLES/.test(l))
    .map((l) => {
      const attr = (k) => (l.match(new RegExp(`${k}="?([^",]*)"?`)) || [])[1];
      return { uri: attr("URI"), lang: attr("LANGUAGE"), name: attr("NAME"), def: attr("DEFAULT") === "YES" };
    })
    .filter((t) => t.uri);
  if (!tracks.length) return null;
  const track = tracks.find((t) => t.def) || tracks.find((t) => /^en/i.test(t.lang || "")) || tracks[0];

  const playlistUrl = new URL(track.uri, masterUrl).href;
  const playlist = await (await fetch(playlistUrl)).text();
  const segments = playlist
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => new URL(l, playlistUrl).href);

  // Fetch segments a few at a time.
  const texts = new Array(segments.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(6, segments.length) }, async () => {
      while (next < segments.length) {
        const i = next++;
        const r = await fetch(segments[i]);
        if (!r.ok) throw new Error(`Caption segment ${i} failed (HTTP ${r.status})`);
        texts[i] = await r.text();
      }
    })
  );

  const toMs = (t) => {
    const p = t.trim().split(":");
    const [s, ms] = p.pop().split(".");
    const h = p.length === 2 ? +p[0] : 0;
    const m = +p[p.length - 1] || 0;
    return ((h * 60 + m) * 60 + +s) * 1000 + +(ms || 0);
  };

  const cues = [];
  const seen = new Set();
  for (const vtt of texts) {
    const blocks = vtt.replace(/\r/g, "").split(/\n\n+/);
    for (const block of blocks) {
      const lines = block.split("\n");
      const ti = lines.findIndex((l) => l.includes("-->"));
      if (ti === -1) continue;
      const [a, b] = lines[ti].split("-->");
      const start = toMs(a);
      const end = toMs(b.trim().split(/\s+/)[0]);
      const text = lines.slice(ti + 1).join("\n").trim();
      if (!text) continue;
      const key = `${start}|${end}|${text}`;
      if (seen.has(key)) continue; // cues that straddle segments are repeated
      seen.add(key);
      cues.push({ start, end, text });
    }
  }
  cues.sort((x, y) => x.start - y.start);
  return { language: track.lang || "", name: track.name || "", cues };
}
