// Shared settings defaults + helpers (loaded by popup, options and background).
const DEFAULT_SETTINGS = {
  captions: true,          // also save closed captions when available
  captionFormat: "srt",    // "srt" or "vtt"
  prefix: "",              // prepended to every file name
  folder: "",              // sub-folder inside the Downloads folder ("" = Downloads itself)
  askWhereToSave: false    // show Chrome's Save As dialog for every download
};

function getSettings() {
  return new Promise((resolve) =>
    chrome.storage.sync.get(DEFAULT_SETTINGS, (s) => resolve({ ...DEFAULT_SETTINGS, ...s }))
  );
}

function sanitizeFileName(name) {
  return (name || "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/:*?"<>|~]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^[.\s-]+|[.\s]+$/g, "")
    .slice(0, 120)
    .trim();
}

function sanitizeFolder(folder) {
  return (folder || "")
    .split(/[\\/]+/)
    .map((part) => sanitizeFileName(part))
    .filter((part) => part && part !== "." && part !== "..")
    .join("/");
}

function buildPath(settings, baseName, ext) {
  const name = sanitizeFileName((settings.prefix || "") + baseName) || "substack-video";
  const folder = sanitizeFolder(settings.folder);
  return (folder ? folder + "/" : "") + name + "." + ext;
}
