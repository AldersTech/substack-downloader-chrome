const content = document.getElementById("content");
const summary = document.getElementById("summary");

document.getElementById("openSettings").addEventListener("click", () => chrome.runtime.openOptionsPage());

function fmtDuration(sec) {
  if (!sec) return "";
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return (h ? `${h}:${String(m).padStart(2, "0")}` : `${m}`) + `:${String(s).padStart(2, "0")}`;
}

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const c of children) if (c != null) e.append(c);
  return e;
}

function showMessage(text) {
  content.replaceChildren(el("p", { class: "muted" }, text));
}

async function renderSummary() {
  const s = await getSettings();
  const where = s.askWhereToSave
    ? "Asks where to save"
    : "Saves to Downloads" + (sanitizeFolder(s.folder) ? `/${sanitizeFolder(s.folder)}` : "");
  const caps = s.captions ? `captions on (.${s.captionFormat})` : "captions off";
  summary.textContent = `${where} · ${caps}` + (s.prefix ? ` · prefix "${s.prefix}"` : "");
}

async function init() {
  renderSummary();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/^https?:/.test(tab.url || "")) {
    return showMessage("Open a Substack note or post with a video, then click this button again.");
  }

  let data;
  try {
    const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: pageFindVideos });
    data = res?.result;
  } catch (e) {
    return showMessage("Can't read this page. Open a Substack note or post with a video.");
  }
  if (!data?.videos?.length) return showMessage("No Substack video found on this page.");

  const list = el("ul", { class: "videos" });
  data.videos.forEach((v, i) => {
    const status = el("div", { class: "status" });
    const btn = el("button", { class: "primary" }, "Download");
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      btn.textContent = "Starting…";
      status.textContent = "";
      const res = await chrome.runtime.sendMessage({ type: "download", tabId: tab.id, origin: data.origin, video: v });
      if (!res?.ok) {
        btn.disabled = false;
        btn.textContent = "Download";
        status.textContent = res?.error || "Download failed.";
        status.className = "status error";
        return;
      }
      btn.textContent = "Downloading";
      const capMsg =
        res.captions === "saved" ? "Captions saved." :
        res.captions === "none" ? "No captions available for this video." :
        res.captions.startsWith("error") ? "Captions failed: " + res.captions.slice(7) : "";
      status.textContent = "Video download started. " + capMsg;
      status.className = "status ok";
    });

    const meta = [
      v.primary && data.videos.length > 1 ? "This post" : null,
      fmtDuration(v.duration),
      v.height ? `${v.height}p` : null
    ].filter(Boolean).join(" · ");

    list.append(
      el("li", { class: v.primary ? "video primary-video" : "video" },
        v.thumb ? el("img", { src: v.thumb, alt: "" }) : el("div", { class: "thumb-placeholder" }),
        el("div", { class: "info" },
          el("div", { class: "title", title: v.title || "" }, v.title || `Video ${i + 1}`),
          el("div", { class: "meta" }, meta),
          status
        ),
        btn
      )
    );
  });
  content.replaceChildren(list);
}

init();
