const $ = (id) => document.getElementById(id);
const fields = ["captions", "captionFormat", "prefix", "folder", "askWhereToSave"];
let savedTimer;

function readForm() {
  return {
    captions: $("captions").checked,
    captionFormat: $("captionFormat").value,
    prefix: $("prefix").value,
    folder: $("folder").value,
    askWhereToSave: $("askWhereToSave").checked
  };
}

function fillForm(s) {
  $("captions").checked = s.captions;
  $("captionFormat").value = s.captionFormat;
  $("prefix").value = s.prefix;
  $("folder").value = s.folder;
  $("askWhereToSave").checked = s.askWhereToSave;
  refresh();
}

function refresh() {
  const s = readForm();
  $("captionFormat").disabled = !s.captions;
  $("example").textContent = buildPath({ ...s, folder: "" }, "Author - First line of the note", "mp4");
  const folder = sanitizeFolder(s.folder);
  $("folderPreview").textContent = "Downloads" + (folder ? "/" + folder : "");
  $("folder").disabled = s.askWhereToSave;
}

function save() {
  refresh();
  chrome.storage.sync.set(readForm(), () => {
    $("saved").textContent = "Saved";
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => ($("saved").textContent = ""), 1200);
  });
}

fields.forEach((id) => {
  $(id).addEventListener("input", save);
  $(id).addEventListener("change", save);
});

$("reset").addEventListener("click", () => {
  chrome.storage.sync.set(DEFAULT_SETTINGS, () => fillForm(DEFAULT_SETTINGS));
});

getSettings().then(fillForm);
