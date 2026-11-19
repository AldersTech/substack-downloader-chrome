importScripts("settings.js", "page-functions.js");

function fmtTime(ms, sep) {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const r = ms % 1000;
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${p(h)}:${p(m)}:${p(s)}${sep}${p(r, 3)}`;
}

function cuesToSrt(cues) {
  return cues
    .map((c, i) => `${i + 1}\n${fmtTime(c.start, ",")} --> ${fmtTime(c.end, ",")}\n${c.text}\n`)
    .join("\n");
}

function cuesToVtt(cues) {
  return (
    "WEBVTT\n\n" +
    cues.map((c, i) => `${i + 1}\n${fmtTime(c.start, ".")} --> ${fmtTime(c.end, ".")}\n${c.text}\n`).join("\n")
  );
}

function download(options) {
  return new Promise((resolve, reject) =>
    chrome.downloads.download(options, (id) => {
      if (chrome.runtime.lastError || id === undefined) {
        reject(new Error(chrome.runtime.lastError?.message || "Download was cancelled"));
      } else resolve(id);
    })
  );
}

async function runInTab(tabId, func, args = []) {
  const [res] = await chrome.scripting.executeScript({ target: { tabId }, func, args, world: "ISOLATED" });
  return res?.result;
}

async function downloadVideo({ tabId, origin, video }) {
  const settings = await getSettings();
  const base = video.title || `substack-video-${video.id}`;
  const result = { video: false, captions: "skipped" };

  await download({
    url: `${origin}/api/v1/video/upload/${video.id}/src?type=mp4`,
    filename: buildPath(settings, base, "mp4"),
    saveAs: settings.askWhereToSave,
    conflictAction: "uniquify"
  });
  result.video = true;

  if (settings.captions) {
    try {
      const caps = await runInTab(tabId, pageFetchCaptions, [video.id]);
      if (!caps || !caps.cues.length) {
        result.captions = "none";
      } else {
        const ext = settings.captionFormat === "vtt" ? "vtt" : "srt";
        const body = ext === "vtt" ? cuesToVtt(caps.cues) : cuesToSrt(caps.cues);
        const lang = caps.language ? `.${sanitizeFileName(caps.language)}` : "";
        await download({
          url: "data:text/plain;charset=utf-8," + encodeURIComponent(body),
          filename: buildPath(settings, base + lang, ext),
          saveAs: settings.askWhereToSave,
          conflictAction: "uniquify"
        });
        result.captions = "saved";
      }
    } catch (e) {
      result.captions = "error: " + e.message;
    }
  }
  return result;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "download") {
    downloadVideo(msg)
      .then((r) => sendResponse({ ok: true, ...r }))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true; // async response
  }
});
